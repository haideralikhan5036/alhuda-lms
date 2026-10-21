// Teacher advance-class email (Batch 5, B10) worker test.
// Drives the REAL cloudflare/worker.js (via a temp ESM copy) against a
// fake D1 backed by Node's built-in SQLite (node:sqlite) and a mock
// Apps Script relay (local HTTPS, 302-redirect like the real script)
// whose JSON replies are configurable per case.
// Run from the repo root:  node test/teacher-email-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite), openssl (throwaway cert).
// All addresses/names below are SYNTHETIC test markers.
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teacher-email-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
try { execSync('openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 2 -nodes -subj "/CN=127.0.0.1"', { cwd: TMP, stdio: 'ignore' }); }
catch (e) { console.error('openssl is required for this test'); process.exit(2); }
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const SECRET = 'test-relay-secret-value';
const WORKER_SECRET = 'teacher-email-test-secret';
const ORIGIN = 'https://alhuda-lms.vercel.app';
const FAM1_EMAIL = 'parent-one@example.test';
const FAM3_EMAIL = 'parent-three@example.test';

// ---- capture worker logs to prove no address/secret/URL leakage ------------
const capturedLogs = [];
for (const m of ['log', 'warn', 'error']) {
  const orig = console[m].bind(console);
  console[m] = (...a) => { capturedLogs.push(a.map(String).join(' ')); orig(...a); };
}

// ---- mock Apps Script relay --------------------------------------------------
// /r1 answers 302 -> /r2 (like the real script); /r2 records the forwarded
// JSON and replies with the configurable relayReply.
const received = [];
let hitR1 = 0;
let relayReply = { status: 200, body: '{"success":true}' };
const server = https.createServer({ key: fs.readFileSync(path.join(TMP, 'key.pem')), cert: fs.readFileSync(path.join(TMP, 'cert.pem')) }, (req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    if (req.url === '/r1' && req.method === 'POST') { hitR1++; res.writeHead(302, { Location: '/r2' }); res.end(); return; }
    if (req.url === '/r2') {
      let parsed = null;
      try { parsed = JSON.parse(data); } catch (e) {}
      received.push({ method: req.method, body: parsed, rawLen: data.length });
      res.writeHead(relayReply.status, { 'Content-Type': 'application/json' });
      res.end(relayReply.body);
      return;
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ---- Fake D1 over real in-memory SQLite ---------------------------------------
class FakeStatement {
  constructor(db, sql) { this._db = db; this._sql = sql; this._params = []; }
  bind(...params) { this._params = params; return this; }
  async all() { const results = this._db.prepare(this._sql).all(...this._params); return { results, success: true, meta: {} }; }
  async run() { const r = this._db.prepare(this._sql).run(...this._params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
  async first() { const row = this._db.prepare(this._sql).get(...this._params); return row === undefined ? null : row; }
}
class FakeD1 {
  constructor() { this._db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new FakeStatement(this._db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
  async exec(sql) { this._db.exec(sql); return { success: true }; }
  seed(sql, ...params) { this._db.prepare(sql).run(...params); }
  close() { try { this._db.close(); } catch (e) {} }
}

const fakeDb = new FakeD1();
const baseEnv = {
  WORKER_AUTH_SECRET: WORKER_SECRET,
  RELAY_URL: `https://127.0.0.1:${PORT}/r1`,
  RELAY_SECRET: SECRET,
  ALLOWED_ORIGINS: ORIGIN,
  DB: fakeDb,
};

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  teacherA: await createSessionToken({ sub: 'TCH-A', role: 'teacher' }, WORKER_SECRET),
  teacherB: await createSessionToken({ sub: 'TCH-B', role: 'teacher' }, WORKER_SECRET),
  teacherC: await createSessionToken({ sub: 'TCH-C', role: 'teacher' }, WORKER_SECRET),
};

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function callAdvance({ token, body, env = baseEnv, ip }) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (ip) headers['cf-connecting-ip'] = ip;
  const req = new Request('https://worker.test/api/email/advance-class', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, data };
}

const validBody = (studentId) => ({
  studentId, template: 'advance-class', scheduledDate: '2026-10-25',
  bookTitle: 'Noorani Qaida', page: 12, lineRange: '1-5',
  sabaqResult: 'Excellent', rating: 5, remarks: 'Great progress.',
});

// ---- Setup: schema boot + seeds ------------------------------------------------
{
  const req = new Request('https://worker.test/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOK.owner, 'Origin': ORIGIN },
    body: JSON.stringify({ table: 'families', action: 'select' }),
  });
  const res = await worker.fetch(req, baseEnv, {});
  check('setup: owner /api/db boot -> 200', res.status === 200, 'got ' + res.status);
}
fakeDb.seed('INSERT INTO teachers (id, full_name) VALUES (?, ?)', 'TCH-A', 'Teacher Alpha');
fakeDb.seed('INSERT INTO teachers (id, full_name) VALUES (?, ?)', 'TCH-B', 'Teacher Beta');
fakeDb.seed('INSERT INTO teachers (id, full_name) VALUES (?, ?)', 'TCH-C', 'Teacher Gamma');
fakeDb.seed('INSERT INTO families (id, parent_name, email, notes) VALUES (?, ?, ?, ?)',
  'FAM-1', 'Parent One', FAM1_EMAIL, '{}');
fakeDb.seed('INSERT INTO families (id, parent_name, email, notes) VALUES (?, ?, ?, ?)',
  'FAM-2', 'Parent Two', null, '{}');
fakeDb.seed('INSERT INTO families (id, parent_name, email, notes) VALUES (?, ?, ?, ?)',
  'FAM-3', 'Parent Three', null, JSON.stringify({ portal_credentials: { email: FAM3_EMAIL } }));
fakeDb.seed('INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES (?, ?, ?, ?)',
  'STU-1', 'FAM-1', 'Student One', 'TCH-A');
fakeDb.seed('INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES (?, ?, ?, ?)',
  'STU-2', 'FAM-1', 'Student Two', 'TCH-B');
fakeDb.seed('INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES (?, ?, ?, ?)',
  'STU-3', 'FAM-2', 'Student Three', 'TCH-A');
fakeDb.seed('INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES (?, ?, ?, ?)',
  'STU-4', 'FAM-1', 'Student Four', null);
fakeDb.seed('INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES (?, ?, ?, ?)',
  'STU-5', 'FAM-3', 'Student Five', 'TCH-A');
fakeDb.seed('INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES (?, ?, ?, ?)',
  'STU-6', 'FAM-1', 'Student Six', 'TCH-C');
fakeDb.seed('INSERT INTO class_schedules (id, student_id, teacher_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
  'SCH-1', 'STU-4', 'TCH-A', 1, '10:00', '10:30');

// ---- (a) happy path: own student, relay payload, NO address in response --------
{
  relayReply = { status: 200, body: '{"success":true}' };
  const before = received.length;
  const r = await callAdvance({ token: TOK.teacherA, body: validBody('STU-1') });
  check('B10 (a) teacher A -> own student STU-1: 200 ok:true', r.status === 200 && r.data && r.data.ok === true, 'got ' + r.status + ' ' + r.text.slice(0, 160));
  check('B10 (a) response carries quota keys (null/false when relay gives none)',
    r.data && r.data.quotaRemaining === null && r.data.quotaExceeded === false, JSON.stringify(r.data));
  check('B10 (a) response NEVER contains the family address', !r.text.includes(FAM1_EMAIL), r.text.slice(0, 200));
  const hit = received[received.length - 1] || {};
  const b = hit.body || {};
  check('B10 (a) relay got exactly one new send', received.length === before + 1, 'delta=' + (received.length - before));
  check('B10 (a) relay to === the family column address', b.to === FAM1_EMAIL, 'to=' + b.to);
  check('B10 (a) relay subject matches the template exactly',
    b.subject === '🌟 Advance Class Completed: Student One (2026-10-25) — Al-Huda Islamic Centre', 'subject=' + b.subject);
  check('B10 (a) relay text has greeting, student, dates, material, performance, remarks',
    typeof b.text === 'string' &&
    b.text.includes('Assalamu Alaikum wa Rahmatullah Parent One,') &&
    b.text.includes('originally scheduled for 2026-10-25') &&
    b.text.includes('• Student Name: Student One') &&
    b.text.includes('• Instructor: Teacher Alpha') &&
    b.text.includes('• Course Material: Noorani Qaida (Page 12, Lines 1-5)') &&
    b.text.includes('• Performance: Excellent (5 / 5 Stars)') &&
    b.text.includes('• Teacher Remarks: Great progress.') &&
    b.text.includes('ADVANCE CLASS SESSION DETAILS:'),
    (b.text || '').slice(0, 300));
  check('B10 (a) relay html is the text with <br/> line breaks', typeof b.html === 'string' && b.html.includes('<br/>') && b.html.includes('Student One'), '');
  check('B10 (a) relay received the secret field', b.secret === SECRET && b.relaySecret === SECRET, 'secret fields mismatch');
}

// ---- (a2) scope via class_schedules (no direct assignment) ----------------------
{
  const r = await callAdvance({ token: TOK.teacherA, body: validBody('STU-4') });
  check('B10 (a2) teacher A -> schedule-only student STU-4: 200 (scope union)', r.status === 200 && r.data && r.data.ok === true, 'got ' + r.status + ' ' + r.text.slice(0, 160));
}

// ---- (a3) recipient falls back to the notes-JSON email ---------------------------
{
  const r = await callAdvance({ token: TOK.teacherA, body: validBody('STU-5') });
  const hit = received[received.length - 1] || {};
  check('B10 (a3) notes-only email family: 200, relay to === notes address, response hides it',
    r.status === 200 && r.data && r.data.ok === true && (hit.body || {}).to === FAM3_EMAIL && !r.text.includes(FAM3_EMAIL),
    'got ' + r.status + ' to=' + (hit.body || {}).to);
}

// ---- (b) another teacher's student -> 403 -----------------------------------------
{
  const r = await callAdvance({ token: TOK.teacherA, body: validBody('STU-2') });
  check('B10 (b) teacher A -> teacher B student STU-2: 403 own-students error',
    r.status === 403 && r.data && /own students/i.test(r.data.error || ''), 'got ' + r.status + ' ' + r.text.slice(0, 160));
}

// ---- (c) anonymous -> 401 ------------------------------------------------------------
{
  const r = await callAdvance({ body: validBody('STU-1') });
  check('B10 (c) no token -> 401', r.status === 401, 'got ' + r.status);
}

// ---- (d) owner token -> 403 (teacher-only endpoint) -----------------------------------
{
  const r = await callAdvance({ token: TOK.owner, body: validBody('STU-1') });
  check('B10 (d) owner token -> 403 Only teachers',
    r.status === 403 && r.data && /Only teachers/i.test(r.data.error || ''), 'got ' + r.status + ' ' + r.text.slice(0, 160));
}

// ---- (e) relay quota-exceeded verdict (HTTP 200, success:false) -------------------------
{
  relayReply = { status: 200, body: '{"success":false,"error":"Daily email limit reached","quotaRemaining":0}' };
  const r = await callAdvance({ token: TOK.teacherA, body: validBody('STU-1') });
  check('B10 (e) relay quota verdict -> ok:false, quotaExceeded:true, truthful error',
    r.data && r.data.ok === false && r.data.quotaExceeded === true && r.data.quotaRemaining === 0 &&
    /Daily email limit reached/.test(r.data.error || ''),
    'got ' + r.status + ' ' + r.text.slice(0, 200));
  check('B10 (e) quota failure is NOT a 200 (email was not sent)', r.status === 502, 'got ' + r.status);
}

// ---- (f) relay success with quotaRemaining ------------------------------------------------
{
  relayReply = { status: 200, body: '{"success":true,"quotaRemaining":7}' };
  const r = await callAdvance({ token: TOK.teacherA, body: validBody('STU-1') });
  check('B10 (f) relay success + quotaRemaining:7 -> ok:true quotaRemaining===7',
    r.status === 200 && r.data && r.data.ok === true && r.data.quotaRemaining === 7 && r.data.quotaExceeded === false,
    'got ' + r.status + ' ' + r.text.slice(0, 160));
}

// ---- (g) the 302 redirect hop is followed with a re-POST -----------------------------------
{
  relayReply = { status: 200, body: '{"success":true}' };
  const r1Before = hitR1;
  const recvBefore = received.length;
  const r = await callAdvance({ token: TOK.teacherA, body: validBody('STU-1') });
  const hit = received[received.length - 1] || {};
  check('B10 (g) 302 hop followed (r1 hit +1) and re-POSTed intact to /r2',
    r.status === 200 && hitR1 === r1Before + 1 && received.length === recvBefore + 1 &&
    hit.method === 'POST' && hit.rawLen > 100 && (hit.body || {}).to === FAM1_EMAIL,
    `r1 delta=${hitR1 - r1Before} method=${hit.method} rawLen=${hit.rawLen}`);
}

// ---- (h) relay unreachable -> truthful 502 ------------------------------------------------------
{
  const r = await callAdvance({ token: TOK.teacherA, body: validBody('STU-1'), env: { ...baseEnv, RELAY_URL: 'https://127.0.0.1:1/closed' } });
  check('B10 (h) relay unreachable -> 502 ok:false',
    r.status === 502 && r.data && r.data.ok === false && /unreachable/i.test(r.data.error || ''),
    'got ' + r.status + ' ' + r.text.slice(0, 160));
}

// ---- (i) validation ------------------------------------------------------------------------------
{
  const bad1 = await callAdvance({ token: TOK.teacherA, body: { studentId: 'STU-1', scheduledDate: '25-10-2026' } });
  check('B10 (i) bad scheduledDate -> 400', bad1.status === 400, 'got ' + bad1.status);
  const bad2 = await callAdvance({ token: TOK.teacherA, body: { studentId: 'STU-1', scheduledDate: '2026-10-25', evil: 1 } });
  check('B10 (i) unknown field -> 400 Unexpected field', bad2.status === 400 && /Unexpected field/.test(bad2.data?.error || ''), 'got ' + bad2.status + ' ' + bad2.text.slice(0, 120));
  const bad3 = await callAdvance({ token: TOK.teacherA, body: { studentId: 'STU-1', scheduledDate: '2026-10-25', rating: 9 } });
  check('B10 (i) rating 9 -> 400', bad3.status === 400, 'got ' + bad3.status);
  const bad4 = await callAdvance({ token: TOK.teacherA, body: { scheduledDate: '2026-10-25' } });
  check('B10 (i) missing studentId -> 400', bad4.status === 400, 'got ' + bad4.status);
  const bad5 = await callAdvance({ token: TOK.teacherA, body: { studentId: 'STU-1', scheduledDate: '2026-10-25', template: 'something-else' } });
  check('B10 (i) wrong template -> 400', bad5.status === 400, 'got ' + bad5.status);
}

// ---- (j) family with NO email anywhere -> 422 -------------------------------------------------------
{
  const r = await callAdvance({ token: TOK.teacherA, body: validBody('STU-3') });
  check('B10 (j) family without any email -> 422 No email address on file',
    r.status === 422 && r.data && /No email address on file/i.test(r.data.error || ''),
    'got ' + r.status + ' ' + r.text.slice(0, 160));
}

// ---- (k) per-teacher daily cap: 30 pass, the 31st is 429 ----------------------------------------------
{
  relayReply = { status: 200, body: '{"success":true}' };
  let okCount = 0;
  for (let i = 0; i < 30; i++) {
    const r = await callAdvance({ token: TOK.teacherC, body: validBody('STU-6'), ip: '203.0.113.9' });
    if (r.status === 200 && r.data && r.data.ok === true) okCount++;
  }
  check('B10 (k) first 30 sends of the day succeed', okCount === 30, 'ok=' + okCount + '/30');
  const r31 = await callAdvance({ token: TOK.teacherC, body: validBody('STU-6'), ip: '203.0.113.9' });
  check('B10 (k) 31st send -> 429 Daily email limit for teachers',
    r31.status === 429 && r31.data && /Daily email limit for teachers/i.test(r31.data.error || ''),
    'got ' + r31.status + ' ' + r31.text.slice(0, 160));
}

// ---- (l) logs never leak the address, the secret, or the relay URL --------------------------------------
{
  // Only WORKER log lines count (the harness's own PASS/FAIL lines are
  // captured too and legitimately mention /r1//r2 in a check name).
  const blob = capturedLogs.filter((l) => !/^(PASS|FAIL) \|/.test(l)).join('\n');
  check('B10 (l) logs contain no family address', !blob.includes(FAM1_EMAIL) && !blob.includes(FAM3_EMAIL), 'LEAKED');
  check('B10 (l) logs contain no relay secret', !blob.includes(SECRET), 'LEAKED');
  check('B10 (l) logs contain no relay URL', !blob.includes('/r1') && !blob.includes('/r2') && !blob.includes(String(PORT)), 'LEAKED');
}

server.close();
fakeDb.close();
fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(' - ' + f.name + ' :: ' + f.detail)); process.exit(1); }
