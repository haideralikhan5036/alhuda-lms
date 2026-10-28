// Batch 7A authentication-hardening worker test — D1 login throttling +
// lockout, server-side session revocation, PBKDF2 password upgrade.
// Drives the REAL cloudflare/worker.js (via a temp ESM copy) against a
// fake D1 backed by Node's built-in SQLite (node:sqlite), so the login,
// set-password, logout, unlock, sign-out-everywhere, and /api/db
// revocation gates run end-to-end on real SQL.
// Run from the repo root:  node test/batch7a-auth-hardening.test.mjs
// Requires: node >= 22.5 (node:sqlite). All "passwords" below are
// synthetic test markers, never real credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'batch7a-auth-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'batch7a-test-worker-secret';
const ORIGIN = 'https://alhuda-lms.vercel.app';
const OWNER_USER = 'owner-test';
const OWNER_PW = 'Owner-Strong-99';

// ---- Fake D1 over real in-memory SQLite ------------------------------------
class FakeStatement {
  constructor(db, sql) { this._db = db; this._sql = sql; this._params = []; }
  bind(...params) { this._params = params; return this; }
  async all() {
    const results = this._db.prepare(this._sql).all(...this._params);
    return { results, success: true, meta: {} };
  }
  async run() {
    const r = this._db.prepare(this._sql).run(...this._params);
    return { success: true, meta: { changes: Number(r.changes || 0) } };
  }
  async first() {
    const row = this._db.prepare(this._sql).get(...this._params);
    return row === undefined ? null : row;
  }
}
class FakeD1 {
  constructor() { this._db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new FakeStatement(this._db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
  async exec(sql) { this._db.exec(sql); return { success: true }; }
  raw(sql, ...params) { return this._db.prepare(sql).all(...params); } // test-only reads
  seed(sql, ...params) { this._db.prepare(sql).run(...params); } // test-only writes
  close() { try { this._db.close(); } catch (e) {} }
}

const fakeDb = new FakeD1();
const env = {
  WORKER_AUTH_SECRET: WORKER_SECRET,
  OWNER_USERNAME: OWNER_USER,
  OWNER_PASSWORD_HASH: createHash('sha256').update(OWNER_PW).digest('hex'),
  ALLOWED_ORIGINS: ORIGIN,
  DB: fakeDb,
};

// Count SELECTs against the two revocation tables, for the cost test.
let authSelectCount = 0;
{
  const origPrepare = fakeDb.prepare.bind(fakeDb);
  fakeDb.prepare = (sql) => {
    if (/^\s*SELECT/i.test(sql) && (sql.includes('auth_revoked_tokens') || sql.includes('auth_subject_valid_after'))) authSelectCount++;
    return origPrepare(sql);
  };
}

// ---- Helpers ---------------------------------------------------------------
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' :: ' + String(detail || '').slice(0, 300)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eq = (column, value) => [{ column, op: 'eq', value }];

async function call(pathname, { token = null, ip = null, body = null, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (ip) headers['cf-connecting-ip'] = ip;
  const req = new Request('https://worker.test' + pathname, {
    method, headers, body: body === null ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, headers: res.headers, text, json };
}
const staffLogin = (identifier, password, ip, role = 'teacher') =>
  call('/api/auth/staff-login', { ip, body: { identifier, password, role } });
const ownerLogin = (username, password, ip) =>
  call('/api/auth/login', { ip, body: { username, password } });
const dbPost = (token, body) => call('/api/db', { token, body });
const authPost = (token, pathname, body, ip = null) => call(pathname, { token, ip, body });

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'MGR-TEST', role: 'manager' }, WORKER_SECRET),
};

// Legacy salted format: sha256$<32 hex salt>$<64 hex hash> of
// SHA-256(saltHex + ':' + password).
function hashLegacy(pw) {
  const saltHex = randomBytes(16).toString('hex');
  return `sha256$${saltHex}$${createHash('sha256').update(saltHex + ':' + pw).digest('hex')}`;
}
// PBKDF2 format the worker writes: pbkdf2$<iter>$<32 hex salt>$<64 hex hash>.
function hashPbkdf2(pw, iterations = 10000, saltHex = null) {
  const salt = saltHex || randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(pw, Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}
async function seedTeacher(id, username, passwordHash, fullName = 'Test Teacher') {
  const r = await dbPost(TOK.owner, { table: 'teachers', action: 'insert', values: { id, full_name: fullName, address: JSON.stringify({ username, password: passwordHash }) } });
  check(`seed teacher ${id}`, r.status === 200, r.text.slice(0, 200));
  return r;
}
async function seedFamily(id, username, passwordHash) {
  const r = await dbPost(TOK.owner, { table: 'families', action: 'insert', values: { id, parent_name: 'Test Family ' + id, status: 'Active', notes: JSON.stringify({ portal_credentials: { username, password: passwordHash } }) } });
  check(`seed family ${id}`, r.status === 200, r.text.slice(0, 200));
  return r;
}
async function readTeacher(id) {
  const r = await dbPost(TOK.owner, { table: 'teachers', action: 'select', filters: eq('id', id) });
  return (r.json && r.json.data && r.json.data[0]) || null;
}
async function readFamily(id) {
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select', filters: eq('id', id) });
  return (r.json && r.json.data && r.json.data[0]) || null;
}
function parseField(v) { try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch (e) { return {}; } }

// ---- Boot schema ------------------------------------------------------------
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' }); // boots ensureSchema
  check('schema boot', r.status === 200, r.text.slice(0, 200));
  const tables = fakeDb.raw("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'auth_%'").map((x) => x.name).sort();
  check('auth tables created', tables.includes('auth_throttle') && tables.includes('auth_revoked_tokens') && tables.includes('auth_subject_valid_after'), tables.join(','));
  const marker = fakeDb.raw("SELECT value FROM system_settings WHERE key='schema_version'");
  check('schema version bumped to v2', marker.length === 1 && marker[0].value === '2026-10-28-v2', JSON.stringify(marker));
}

// ---- T1: legacy login outcomes preserved ------------------------------------
await seedTeacher('TCH-LEG', 'legacyteach', hashLegacy('Legacy-Teach-99'));
await seedTeacher('TCH-PLAIN', 'plainteach', 'not-a-hash-plaintext');
{
  const ip = '10.7.0.1';
  const ok = await staffLogin('legacyteach', 'Legacy-Teach-99', ip);
  check('legacy sha256$ teacher login -> 200 + token', ok.status === 200 && !!ok.json.token, ok.text.slice(0, 200));
  const wrong = await staffLogin('legacyteach', 'Wrong-Password-1', ip);
  const unknown = await staffLogin('no-such-teacher', 'Wrong-Password-1', ip);
  check('wrong password -> 401 Invalid username or password.', wrong.status === 401 && wrong.json && wrong.json.error === 'Invalid username or password.', wrong.text.slice(0, 200));
  check('unknown user -> identical 401 body (no enumeration)', unknown.status === 401 && JSON.stringify(unknown.json) === JSON.stringify(wrong.json), unknown.text.slice(0, 200));
  const plain = await staffLogin('plainteach', 'not-a-hash-plaintext', ip);
  check('plaintext slot -> distinct no_password_set 401 (unchanged)', plain.status === 401 && plain.json && plain.json.error === 'no_password_set', plain.text.slice(0, 200));
}

// ---- T2: transparent upgrade to PBKDF2 --------------------------------------
// (A fresh teacher: T1's successful login already upgraded TCH-LEG.)
await seedTeacher('TCH-LEG2', 'legacyteach2', hashLegacy('Legacy2-Teach-99'));
{
  const ip = '10.7.0.2';
  const before = await readTeacher('TCH-LEG2');
  const beforePw = parseField(before.address).password;
  check('teacher starts on legacy format', typeof beforePw === 'string' && beforePw.startsWith('sha256$'), String(beforePw).slice(0, 40));
  const ok = await staffLogin('legacyteach2', 'Legacy2-Teach-99', ip);
  check('legacy login still works (upgrade path)', ok.status === 200 && !!ok.json.token, ok.text.slice(0, 200));
  const after = await readTeacher('TCH-LEG2');
  const afterPw = parseField(after.address).password;
  check('stored hash upgraded to pbkdf2$10000$ in same slot', typeof afterPw === 'string' && afterPw.startsWith('pbkdf2$10000$'), String(afterPw).slice(0, 40));
  const again = await staffLogin('legacyteach2', 'Legacy2-Teach-99', ip);
  check('upgraded hash verifies on next login', again.status === 200 && !!again.json.token, again.text.slice(0, 200));
  const after2 = await readTeacher('TCH-LEG2');
  check('PBKDF2 hash NOT rewritten on every login', parseField(after2.address).password === afterPw, '');
}

// ---- T3: PBKDF2 vectors, stronger hash never downgraded, cap ----------------
await seedTeacher('TCH-PBK', 'pbkteach', hashPbkdf2('Pbk-Teach-99', 10000));
await seedTeacher('TCH-STRONG', 'strongteach', hashPbkdf2('Strong-Teach-99', 100000));
await seedTeacher('TCH-OVERCAP', 'overcapteach', hashPbkdf2('Overcap-Teach-99', 1000001));
{
  const ip = '10.7.0.3';
  const v = await staffLogin('pbkteach', 'Pbk-Teach-99', ip);
  check('pbkdf2$10000$ vector verifies', v.status === 200 && !!v.json.token, v.text.slice(0, 200));
  const s = await staffLogin('strongteach', 'Strong-Teach-99', ip);
  check('pbkdf2$100000$ (above current, below cap) verifies', s.status === 200 && !!s.json.token, s.text.slice(0, 200));
  const sRow = await readTeacher('TCH-STRONG');
  check('stronger hash NOT downgraded to 10000', parseField(sRow.address).password.startsWith('pbkdf2$100000$'), String(parseField(sRow.address).password).slice(0, 40));
  const o = await staffLogin('overcapteach', 'Overcap-Teach-99', ip);
  check('over-cap iterations fail closed (401, no derive)', o.status === 401, o.text.slice(0, 200));
  const bad = await staffLogin('pbkteach', 'Wrong-Password-1', ip);
  check('wrong password against PBKDF2 hash -> 401', bad.status === 401, bad.text.slice(0, 200));
}

// ---- T4: account lock, Retry-After, lock expiry ------------------------------
await seedTeacher('TCH-LOCK', 'lockteach', hashLegacy('Lock-Teach-99'));
{
  const ip = '10.7.0.4';
  let last = null;
  for (let i = 0; i < 5; i++) last = await staffLogin('lockteach', 'Wrong-Password-1', ip);
  check('5th failed attempt trips the lock (429)', last.status === 429, last.text.slice(0, 200));
  check('lock response carries Retry-After + friendly message', last.headers.get('Retry-After') && /Too many attempts\. Please try again in \d+ minutes\./.test(last.text), last.text.slice(0, 200) + ' Retry-After=' + last.headers.get('Retry-After'));
  const whileLocked = await staffLogin('lockteach', 'Lock-Teach-99', ip);
  check('correct password while locked still 429 (no oracle)', whileLocked.status === 429, whileLocked.text.slice(0, 200));
  // Expire the lock directly (simulates time passing) — the account row
  // is keyed by HMAC, so find it via the throttle table contents.
  const rows = fakeDb.raw("SELECT kind, key_hash, locked_until FROM auth_throttle WHERE kind='account'");
  check('account throttle row recorded', rows.length >= 1 && rows.some((r) => Number(r.locked_until) > Date.now()), JSON.stringify(rows).slice(0, 200));
  fakeDb.seed('UPDATE auth_throttle SET locked_until = ? WHERE kind = ?', Date.now() - 1000, 'account');
  const afterExpiry = await staffLogin('lockteach', 'Lock-Teach-99', ip);
  check('lock expiry: correct password works again', afterExpiry.status === 200 && !!afterExpiry.json.token, afterExpiry.text.slice(0, 200));
}

// ---- T5: progressive lock + quiet-window reset --------------------------------
await seedTeacher('TCH-PROG', 'progteach', hashLegacy('Prog-Teach-99'));
{
  const ip = '10.7.0.5';
  for (let i = 0; i < 5; i++) await staffLogin('progteach', 'Wrong-Password-1', ip);
  const locked = await staffLogin('progteach', 'Wrong-Password-1', ip);
  check('progressive account locked after 5 failures', locked.status === 429, locked.text.slice(0, 200));
  fakeDb.seed('UPDATE auth_throttle SET locked_until = ? WHERE kind = ?', Date.now() - 1000, 'account');
  await staffLogin('progteach', 'Wrong-Password-1', ip); // one failure after expiry
  const rows = fakeDb.raw("SELECT locked_until, fail_count FROM auth_throttle WHERE kind='account'");
  const progRow = rows.find((r) => Number(r.locked_until) > Date.now());
  const mins = progRow ? (Number(progRow.locked_until) - Date.now()) / 60000 : 0;
  check('repeat cycle re-locks doubled (~30 min, capped 60)', !!progRow && mins > 25 && mins < 35, 'mins=' + mins.toFixed(1) + ' ' + JSON.stringify(rows).slice(0, 200));
  // Quiet window: a stale window resets the counter instead of re-locking.
  fakeDb.seed('UPDATE auth_throttle SET window_start = ?, locked_until = NULL, fail_count = 5 WHERE kind = ?', Date.now() - 16 * 60 * 1000, 'account');
  const quiet = await staffLogin('progteach', 'Wrong-Password-1', ip);
  check('stale window resets counter (401, not 429)', quiet.status === 401, quiet.text.slice(0, 200));
}

// ---- T6: per-IP block ---------------------------------------------------------
{
  const ip = '10.7.1.1';
  const ids = ['ipblock-a', 'ipblock-b', 'ipblock-c', 'ipblock-d', 'ipblock-e'];
  let seq = [];
  for (const id of ids.slice(0, 4)) for (let i = 0; i < 4; i++) seq.push(await staffLogin(id, 'Wrong-Password-1', ip));
  for (let i = 0; i < 3; i++) seq.push(await staffLogin('ipblock-e', 'Wrong-Password-1', ip));
  check('first 19 failures from one IP are 401', seq.every((r) => r.status === 401), seq.map((r) => r.status).join(','));
  const twentieth = await staffLogin('ipblock-e', 'Wrong-Password-1', ip);
  check('20th failure from one IP trips the IP block (429)', twentieth.status === 429, twentieth.text.slice(0, 200));
  const freshSameIp = await staffLogin('ipblock-f', 'Wrong-Password-1', ip);
  check('fresh account from blocked IP -> 429', freshSameIp.status === 429, freshSameIp.text.slice(0, 200));
  const freshOtherIp = await staffLogin('ipblock-f', 'Wrong-Password-1', '10.7.1.2');
  check('same account from another IP -> 401 (block is per-IP)', freshOtherIp.status === 401, freshOtherIp.text.slice(0, 200));
}

// ---- T7: success resets the account counter ----------------------------------
await seedTeacher('TCH-RESET', 'resetteach', hashLegacy('Reset-Teach-99'));
{
  const ip = '10.7.0.7';
  for (let i = 0; i < 3; i++) await staffLogin('resetteach', 'Wrong-Password-1', ip);
  const ok = await staffLogin('resetteach', 'Reset-Teach-99', ip);
  check('success after failures -> 200', ok.status === 200, ok.text.slice(0, 200));
  const seq = [];
  for (let i = 0; i < 5; i++) seq.push(await staffLogin('resetteach', 'Wrong-Password-1', ip));
  check('after reset, 4 more failures are still 401 (counter was cleared)', seq.slice(0, 4).every((r) => r.status === 401), seq.map((r) => r.status).join(','));
  check('after reset, 5th failure trips the lock again (429)', seq[4].status === 429, seq[4].text.slice(0, 200));
}

// ---- T8: owner never permanently locked; unlock is owner-only -----------------
{
  const ip = '10.7.2.1';
  for (let i = 0; i < 5; i++) await ownerLogin(OWNER_USER, 'Wrong-Password-1', ip);
  const locked = await ownerLogin(OWNER_USER, 'Wrong-Password-1', ip);
  check('owner account locks like any account (429)', locked.status === 429, locked.text.slice(0, 200));
  const mgrUnlock = await authPost(TOK.manager, '/api/auth/unlock', { kind: 'account', role: 'owner', identifier: OWNER_USER });
  check('manager cannot unlock anyone (403)', mgrUnlock.status === 403, mgrUnlock.text.slice(0, 200));
  const ghostUnlock = await authPost(TOK.owner, '/api/auth/unlock', { kind: 'account', role: 'teacher', identifier: 'no-such-account' });
  check('unlock for unknown identifier still { ok: true } (no enumeration)', ghostUnlock.status === 200 && ghostUnlock.json && ghostUnlock.json.ok === true, ghostUnlock.text.slice(0, 200));
  const unlock = await authPost(TOK.owner, '/api/auth/unlock', { kind: 'account', role: 'owner', identifier: OWNER_USER });
  check('owner unlock clears the lock', unlock.status === 200 && unlock.json && unlock.json.ok === true, unlock.text.slice(0, 200));
  const backIn = await ownerLogin(OWNER_USER, OWNER_PW, ip);
  check('owner logs in again after unlock', backIn.status === 200 && !!backIn.json.token, backIn.text.slice(0, 200));
  // And a lock expires on its own, too: re-lock, force expiry, log in.
  for (let i = 0; i < 5; i++) await ownerLogin(OWNER_USER, 'Wrong-Password-1', ip);
  fakeDb.seed('UPDATE auth_throttle SET locked_until = ? WHERE kind = ?', Date.now() - 1000, 'account');
  const expired = await ownerLogin(OWNER_USER, OWNER_PW, ip);
  check('owner lock expires (no permanent lockout)', expired.status === 200 && !!expired.json.token, expired.text.slice(0, 200));
}

// ---- T9: enumeration-safe timing smoke (coarse, not a proof) ------------------
// Fresh identifiers, 4 attempts each: a 5th would trip the account lock
// and skew the averages with fast 429s.
await seedTeacher('TCH-TIMING', 'timingteach', hashLegacy('Timing-Teach-99'));
{
  const ip = '10.7.0.9';
  const timeIt = async (fn, n) => {
    const t0 = Date.now();
    for (let i = 0; i < n; i++) await fn();
    return (Date.now() - t0) / n;
  };
  const wrongAvg = await timeIt(() => staffLogin('timingteach', 'Wrong-Password-1', ip), 4);
  const unknownAvg = await timeIt(() => staffLogin('no-such-teacher-xyz', 'Wrong-Password-1', ip), 4);
  check('unknown-user path costs roughly what wrong-password costs (dummy verify smoke)', unknownAvg > wrongAvg * 0.1 && unknownAvg < wrongAvg * 10, `wrongAvg=${wrongAvg.toFixed(1)}ms unknownAvg=${unknownAvg.toFixed(1)}ms`);
}

// ---- T10: concurrent attempts --------------------------------------------------
// Read-modify-write throttling is best-effort under bursts by design (a
// lock may engage a few attempts late, never unboundedly), so this test
// does NOT assert an exact post-burst count — it asserts the burst is
// safe (no 500/503, no corruption) and the lock still engages on
// sequential follow-ups.
await seedTeacher('TCH-BURST', 'burstteach', hashLegacy('Burst-Teach-99'));
{
  const ip = '10.7.0.10';
  const burst = await Promise.all(Array.from({ length: 30 }, () => staffLogin('burstteach', 'Wrong-Password-1', ip)));
  check('burst of 30 concurrent failures: no server errors', burst.every((r) => r.status === 401 || r.status === 429), burst.map((r) => r.status).join(','));
  const rows = fakeDb.raw("SELECT fail_count FROM auth_throttle WHERE kind='account'");
  check('burst recorded failures (row exists, count >= 1)', rows.length >= 1 && rows.some((r) => Number(r.fail_count) >= 1), JSON.stringify(rows).slice(0, 200));
  let locked = false;
  for (let i = 0; i < 5 && !locked; i++) {
    const r = await staffLogin('burstteach', 'Wrong-Password-1', ip);
    if (r.status === 429) locked = true;
  }
  check('lock still engages on sequential follow-ups after a burst', locked, '');
}

// ---- T11: logout revokes the presented token -----------------------------------
await seedTeacher('TCH-LOGOUT', 'logoutteach', hashLegacy('Logout-Teach-99'));
{
  const ip = '10.7.0.11';
  const login = await staffLogin('logoutteach', 'Logout-Teach-99', ip);
  const token = login.json.token;
  const before = await dbPost(token, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-LOGOUT') });
  check('token works before logout', before.status === 200, before.text.slice(0, 200));
  const out = await authPost(token, '/api/auth/logout', {});
  check('logout -> 200 { ok: true }', out.status === 200 && out.json && out.json.ok === true, out.text.slice(0, 200));
  const after = await dbPost(token, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-LOGOUT') });
  check('token rejected after logout (401)', after.status === 401, after.text.slice(0, 200));
  const again = await authPost(token, '/api/auth/logout', {});
  check('logout is idempotent (second call still ok)', again.status === 200 && again.json && again.json.ok === true, again.text.slice(0, 200));
  const garbage = await authPost('garbage-token', '/api/auth/logout', {});
  check('logout with garbage token is a harmless ok (no-op)', garbage.status === 200 && garbage.json && garbage.json.ok === true, garbage.text.slice(0, 200));
  const none = await call('/api/auth/logout', { body: {} });
  check('logout with no token -> 401', none.status === 401, none.text.slice(0, 200));
}

// ---- T12: password reset revokes earlier tokens --------------------------------
await seedTeacher('TCH-RESETPW', 'resetpwteach', hashLegacy('Resetpw-Teach-99'));
{
  const ip = '10.7.0.12';
  const login = await staffLogin('resetpwteach', 'Resetpw-Teach-99', ip);
  const oldToken = login.json.token;
  const before = await dbPost(oldToken, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-RESETPW') });
  check('token works before password reset', before.status === 200, before.text.slice(0, 200));
  await sleep(1100); // cross the 1-second iat boundary so the marker is strictly later
  const set = await authPost(TOK.owner, '/api/auth/set-password', { role: 'teacher', identifier: 'resetpwteach', newPassword: 'Resetpw-New-99' });
  check('owner set-password succeeds', set.status === 200 && set.json && set.json.ok === true, set.text.slice(0, 200));
  const markers = fakeDb.raw('SELECT reason FROM auth_subject_valid_after');
  check('password_reset marker recorded', markers.some((m) => m.reason === 'password_reset'), JSON.stringify(markers).slice(0, 200));
  const after = await dbPost(oldToken, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-RESETPW') });
  check('earlier token rejected after password reset (401)', after.status === 401, after.text.slice(0, 200));
  const fresh = await staffLogin('resetpwteach', 'Resetpw-New-99', ip);
  check('login with the new password works', fresh.status === 200 && !!fresh.json.token, fresh.text.slice(0, 200));
  const freshUse = await dbPost(fresh.json.token, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-RESETPW') });
  check('token issued after the marker works', freshUse.status === 200, freshUse.text.slice(0, 200));
  const oldPw = await staffLogin('resetpwteach', 'Resetpw-Teach-99', ip);
  check('old password no longer works', oldPw.status === 401, oldPw.text.slice(0, 200));
}

// ---- T13: deactivation revokes (update path, cache cleared) --------------------
await seedFamily('FAM-DEACT', 'deactparent', hashLegacy('Deact-Parent-99'));
{
  const ip = '10.7.0.13';
  const login = await staffLogin('deactparent', 'Deact-Parent-99', ip, 'parent');
  const token = login.json.token;
  const before = await dbPost(token, { table: 'families', action: 'select', filters: eq('id', 'FAM-DEACT') });
  check('parent token works before deactivation', before.status === 200, before.text.slice(0, 200));
  await sleep(1100);
  const upd = await dbPost(TOK.owner, { table: 'families', action: 'update', values: { status: 'Inactive' }, filters: eq('id', 'FAM-DEACT') });
  check('deactivation update succeeds', upd.status === 200, upd.text.slice(0, 200));
  const markers = fakeDb.raw('SELECT reason FROM auth_subject_valid_after');
  check('deactivation marker recorded', markers.some((m) => m.reason === 'deactivated'), JSON.stringify(markers).slice(0, 200));
  const after = await dbPost(token, { table: 'families', action: 'select', filters: eq('id', 'FAM-DEACT') });
  check('token rejected after deactivation (401)', after.status === 401, after.text.slice(0, 200));
}

// ---- T14: deletion revokes (delete path, cache cleared from id filters) --------
await seedFamily('FAM-DEL', 'delparent', hashLegacy('Del-Parent-99'));
{
  const ip = '10.7.0.14';
  const login = await staffLogin('delparent', 'Del-Parent-99', ip, 'parent');
  const token = login.json.token;
  const before = await dbPost(token, { table: 'families', action: 'select', filters: eq('id', 'FAM-DEL') });
  check('parent token works before deletion', before.status === 200, before.text.slice(0, 200));
  await sleep(1100);
  const del = await dbPost(TOK.owner, { table: 'families', action: 'delete', filters: eq('id', 'FAM-DEL') });
  check('deletion succeeds', del.status === 200, del.text.slice(0, 200));
  const markers = fakeDb.raw('SELECT reason FROM auth_subject_valid_after');
  check('deletion marker recorded', markers.some((m) => m.reason === 'deleted'), JSON.stringify(markers).slice(0, 200));
  const after = await dbPost(token, { table: 'families', action: 'select', filters: eq('id', 'FAM-DEL') });
  check('token rejected after deletion (401)', after.status === 401, after.text.slice(0, 200));
}

// ---- T15: sign-out-everywhere ---------------------------------------------------
await seedTeacher('TCH-SOE', 'soeteach', hashLegacy('Soe-Teach-99'));
{
  const ip = '10.7.0.15';
  const login = await staffLogin('soeteach', 'Soe-Teach-99', ip);
  const token = login.json.token;
  const before = await dbPost(token, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-SOE') });
  check('token works before sign-out-everywhere', before.status === 200, before.text.slice(0, 200));
  const mgrSoe = await authPost(TOK.manager, '/api/auth/sign-out-everywhere', { subject: 'TCH-SOE' });
  check('manager cannot sign out everywhere (403)', mgrSoe.status === 403, mgrSoe.text.slice(0, 200));
  await sleep(1100);
  const soe = await authPost(TOK.owner, '/api/auth/sign-out-everywhere', { subject: 'TCH-SOE' });
  check('owner sign-out-everywhere succeeds', soe.status === 200 && soe.json && soe.json.ok === true, soe.text.slice(0, 200));
  const after = await dbPost(token, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-SOE') });
  check('earlier token rejected after sign-out-everywhere (401)', after.status === 401, after.text.slice(0, 200));
  const fresh = await staffLogin('soeteach', 'Soe-Teach-99', ip);
  check('fresh login after sign-out-everywhere works', fresh.status === 200 && !!fresh.json.token, fresh.text.slice(0, 200));
  // Owner signing out their own username ends their own session too.
  const ownerTok = (await ownerLogin(OWNER_USER, OWNER_PW, '10.7.2.2')).json.token;
  const ownerBefore = await dbPost(ownerTok, { table: 'families', action: 'select' });
  check('owner token works before self sign-out', ownerBefore.status === 200, ownerBefore.text.slice(0, 200));
  await sleep(1100);
  const selfSoe = await authPost(TOK.owner, '/api/auth/sign-out-everywhere', { subject: OWNER_USER });
  check('owner self sign-out-everywhere succeeds', selfSoe.status === 200 && selfSoe.json && selfSoe.json.ok === true, selfSoe.text.slice(0, 200));
  const ownerAfter = await dbPost(ownerTok, { table: 'families', action: 'select' });
  check('owner token rejected after self sign-out (401)', ownerAfter.status === 401, ownerAfter.text.slice(0, 200));
}

// ---- T16: revocation cost (<=2 indexed lookups) + cache behavior ---------------
await seedTeacher('TCH-COST', 'costteach', hashLegacy('Cost-Teach-99'));
{
  const ip = '10.7.0.16';
  const login = await staffLogin('costteach', 'Cost-Teach-99', ip);
  const token = login.json.token;
  authSelectCount = 0;
  const first = await dbPost(token, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-COST') });
  check('first request: both revocation lookups run (<=2)', first.status === 200 && authSelectCount === 2, 'count=' + authSelectCount);
  authSelectCount = 0;
  const second = await dbPost(token, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-COST') });
  check('second request: marker cached, only revoked-token lookup (1)', second.status === 200 && authSelectCount === 1, 'count=' + authSelectCount);
  // A marker write clears the same-isolate cache: the next request does
  // a fresh marker lookup again (and rejects the token).
  await sleep(1100); // cross the 1-second iat boundary so the marker is strictly later
  await authPost(TOK.owner, '/api/auth/sign-out-everywhere', { subject: 'TCH-COST' });
  authSelectCount = 0;
  const third = await dbPost(token, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-COST') });
  check('after marker write: fresh marker lookup again + token rejected', third.status === 401 && authSelectCount === 2, 'status=' + third.status + ' count=' + authSelectCount);
}

// ---- T17: owner env credential (legacy hex + pbkdf2$ forms) --------------------
{
  const ip = '10.7.2.3';
  const legacy = await ownerLogin(OWNER_USER, OWNER_PW, ip);
  check('owner env legacy SHA-256 hex still verifies', legacy.status === 200 && !!legacy.json.token, legacy.text.slice(0, 200));
  env.OWNER_PASSWORD_HASH = hashPbkdf2(OWNER_PW, 10000);
  const pbk = await ownerLogin(OWNER_USER, OWNER_PW, '10.7.2.4');
  check('owner env pbkdf2$ value verifies (format-prefix support)', pbk.status === 200 && !!pbk.json.token, pbk.text.slice(0, 200));
  const wrong = await ownerLogin(OWNER_USER, 'Wrong-Password-1', '10.7.2.5');
  check('owner env wrong password -> 401', wrong.status === 401, wrong.text.slice(0, 200));
  env.OWNER_PASSWORD_HASH = createHash('sha256').update(OWNER_PW).digest('hex'); // restore
}

// ---- T18: set-password throttle (D1 mechanism, separate allowance) --------------
await seedTeacher('TCH-SETPW', 'setpwteach', hashLegacy('Setpw-Teach-99'));
{
  const ip = '10.7.3.1';
  const seq = [];
  for (let i = 0; i < 30; i++) {
    seq.push(await authPost(TOK.owner, '/api/auth/set-password', { role: 'teacher', identifier: 'setpwteach', newPassword: 'Setpw-New-99' }, ip));
  }
  check('first 29 set-password calls succeed', seq.slice(0, 29).every((r) => r.status === 200), seq.map((r) => r.status).join(','));
  check('30th set-password call trips the setpw throttle (429)', seq[29].status === 429 && !!seq[29].headers.get('Retry-After'), seq[29].text.slice(0, 200));
  const otherIp = await authPost(TOK.owner, '/api/auth/set-password', { role: 'teacher', identifier: 'setpwteach', newPassword: 'Setpw-New-99' }, '10.7.3.2');
  check('set-password from another IP still works', otherIp.status === 200, otherIp.text.slice(0, 200));
}

// ---- T19: frontend logout wiring (content checks on real files) ----------------
{
  const authJs = fs.readFileSync(path.join(REPO_ROOT, 'js/auth.js'), 'utf8');
  const teacherHtml = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
  const parentHtml = fs.readFileSync(path.join(REPO_ROOT, 'parent.html'), 'utf8');
  const toolHtml = fs.readFileSync(path.join(REPO_ROOT, 'set-teacher-passwords.html'), 'utf8');
  check('js/auth.js logouts call /api/auth/logout', (authJs.match(/\/api\/auth\/logout/g) || []).length >= 1, '');
  check('logoutTeacherPortal calls clearAllLmsLocalState', /logoutTeacherPortal[\s\S]{0,1200}clearAllLmsLocalState/.test(authJs), '');
  check('teacher.html logout calls /api/auth/logout', teacherHtml.includes('/api/auth/logout'), '');
  check('parent.html logout calls /api/auth/logout', parentHtml.includes('/api/auth/logout'), '');
  check('tool page has unlock section + endpoints', toolHtml.includes('stepUnlock') && toolHtml.includes('/api/auth/unlock') && toolHtml.includes('/api/auth/sign-out-everywhere'), '');
}

// ---- Summary -------------------------------------------------------------------
const passed = results.filter((r) => r.pass).length;
console.log(`\nBatch 7A: ${passed}/${results.length} checks passed`);
for (const r of results.filter((r) => !r.pass)) console.log('FAILED: ' + r.name);
process.exit(passed === results.length ? 0 : 1);
