// Advance requests WITHOUT a generated slip (Phase 1) tests.
// Phase 1 rule change: a period without a salary slip is no longer a
// hard block at REQUEST time. Full/half are undefined without a net,
// so they still need a slip — but a custom amount may be requested
// now; it stays Pending, uncapped, until Administration generates the
// slip AND approves it. The decide handler is unchanged: approval
// still requires a slip and caps against the then-current net.
// Submitting creates no payment, slip, deduction, or ledger entry.
// Also covered: the schema-version bump (Batch B added the
// advance_requests table without bumping, so live D1 skipped schema
// creation) and the migration SQL file.
// Run from the repo root:  node test/advance-request-no-slip.test.mjs
// Requires: node >= 22.5 (node:sqlite).
// All teachers, slips, and amounts below are SYNTHETIC test markers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'advnoslip-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-secret-advance-no-slip';
const ORIGIN = 'https://alhuda-lms.vercel.app';

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
  q(sql, ...params) { return this._db.prepare(sql).all(...params); }
  q1(sql, ...params) { const r = this._db.prepare(sql).get(...params); return r === undefined ? null : r; }
  close() { try { this._db.close(); } catch (e) {} }
}

const fakeDb = new FakeD1();
const baseEnv = { WORKER_AUTH_SECRET: WORKER_SECRET, DB: fakeDb };

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  teacherNoSlip: await createSessionToken({ sub: 'TCH-NOSLIP', role: 'teacher' }, WORKER_SECRET),
  teacherWithSlip: await createSessionToken({ sub: 'TCH-WITHSLIP', role: 'teacher' }, WORKER_SECRET),
};

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function call(url, { method = 'POST', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const req = new Request(url, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, baseEnv, {});
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, data };
}
const advReq = (token, body) => call('https://worker.test/api/advances/request', { token, body });
const advDecide = (token, body) => call('https://worker.test/api/advances/decide', { token, body });
const dbPost = (token, body) => call('https://worker.test/api/db', { token, body });

// Current PKT period, computed exactly the way the server does (UTC+5).
const currentPeriod = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7);
const [curY, curM] = currentPeriod.split('-').map(Number);
const nextPeriod = curM === 12 ? `${curY + 1}-01` : `${curY}-${String(curM + 1).padStart(2, '0')}`;
// A past period (always <= current, safe in any future year the suite runs).
const pastPeriod = '2026-09';

// ---- Setup: schema boot + seeds ------------------------------------------
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', r.status === 200, r.text.slice(0, 200));
  const t = fakeDb.q1("SELECT name FROM sqlite_master WHERE type='table' AND name='advance_requests'");
  check('setup: advance_requests table created by schema boot', !!t);
  const marker = fakeDb.q1("SELECT value FROM system_settings WHERE key = 'schema_version'");
  check('setup: schema marker is the bumped v3 (Batch B miss repaired)', marker && marker.value === '2026-10-29-v3', JSON.stringify(marker));
}
fakeDb.seed("INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)",
  'TCH-NOSLIP', 'Teacher No Slip', JSON.stringify({ salary_slips: {} }), 'Active');
fakeDb.seed("INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)",
  'TCH-WITHSLIP', 'Teacher With Slip', JSON.stringify({ salary_slips: {} }), 'Active');
fakeDb.seed("INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, base_subtotal, bonus, deduction_total, advance_deducted, net_payable, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  'SAL-WS-10', 'TCH-WITHSLIP', '2026-10', 'AH-SAL-202610-WWWWWW', 'October 2026', 40000, 0, 0, 0, 40000, 'Pending');

// ---- Slip-less requests ----------------------------------------------------
let slipLessReq;
{
  const r = await advReq(TOK.teacherNoSlip, { period: pastPeriod, advance_type: 'custom', custom_amount: 15000, reason: 'Family need' });
  check('no-slip: custom request accepted for a period without a slip (200, Pending)',
    r.status === 200 && r.data && r.data.ok && r.data.request && r.data.request.status === 'Pending' && r.data.request.requested_amount === 15000, r.text.slice(0, 300));
  check('no-slip: response reports salary_net null + salary_pending true',
    r.data && r.data.salary_net === null && r.data.salary_pending === true, r.text.slice(0, 300));
  slipLessReq = r.data.request;
  const slips = fakeDb.q('SELECT id FROM salary_slips WHERE teacher_id = ?', 'TCH-NOSLIP');
  const adjs = fakeDb.q('SELECT id FROM salary_adjustments WHERE teacher_id = ?', 'TCH-NOSLIP');
  check('no-slip: submitting creates NO slip, NO adjustment, NO ledger entry', slips.length === 0 && adjs.length === 0);
}
{
  const r = await advReq(TOK.teacherNoSlip, { period: pastPeriod, advance_type: 'full' });
  check('no-slip: full advance without a slip refused (422)', r.status === 422, r.text.slice(0, 200));
  const r2 = await advReq(TOK.teacherNoSlip, { period: pastPeriod, advance_type: 'half' });
  check('no-slip: half advance without a slip refused (422)', r2.status === 422, r2.text.slice(0, 200));
}
{
  const r = await advReq(TOK.teacherNoSlip, { period: pastPeriod, advance_type: 'custom', custom_amount: 15000 });
  check('no-slip: identical pending re-submit returns existing, no duplicate',
    r.status === 200 && r.data && r.data.duplicate === true && r.data.request.id === slipLessReq.id, r.text.slice(0, 300));
  const n = fakeDb.q("SELECT id FROM advance_requests WHERE teacher_id = 'TCH-NOSLIP' AND period = ? AND status = 'Pending'", pastPeriod);
  check('no-slip: still exactly one pending row for teacher+period+type+amount', n.length === 1, JSON.stringify(n));
}
{
  const r = await advReq(TOK.teacherNoSlip, { period: pastPeriod, advance_type: 'custom', custom_amount: 20000 });
  check('no-slip: a different amount for the same period is a NEW request (policy permits distinct requests)',
    r.status === 200 && r.data && r.data.ok && !r.data.duplicate && r.data.request.requested_amount === 20000, r.text.slice(0, 300));
}
{
  const r = await advReq(TOK.teacherNoSlip, { period: nextPeriod, advance_type: 'custom', custom_amount: 1000 });
  check('no-slip: future period still refused (400)', r.status === 400, r.text.slice(0, 200));
  const r2 = await advReq(TOK.teacherNoSlip, { period: '2026-13', advance_type: 'custom', custom_amount: 1000 });
  check('no-slip: malformed period still refused (400)', r2.status === 400);
}
{
  const r = await advReq(TOK.teacherNoSlip, { period: pastPeriod, advance_type: 'custom', custom_amount: 5000, teacher_id: 'TCH-WITHSLIP' });
  check('no-slip: client-supplied teacher_id is ignored (row belongs to the token)',
    r.status === 200 && r.data && r.data.request.teacher_id === 'TCH-NOSLIP', r.text.slice(0, 300));
}
{
  const r = await advReq(TOK.owner, { period: pastPeriod, advance_type: 'custom', custom_amount: 1000 });
  check('no-slip: owner cannot request (teacher-only, 403)', r.status === 403);
  const r2 = await advReq(null, { period: pastPeriod, advance_type: 'custom', custom_amount: 1000 });
  check('no-slip: unauthenticated request refused (401)', r2.status === 401);
}
{
  // The current PKT period without a slip — the "upcoming month" case.
  const r = await advReq(TOK.teacherNoSlip, { period: currentPeriod, advance_type: 'custom', custom_amount: 12000 });
  check('no-slip: current period without a slip accepts a custom request',
    r.status === 200 && r.data && r.data.ok && r.data.request.period === currentPeriod, r.text.slice(0, 300));
}

// ---- Decide behaviour around a missing slip ----------------------------------
{
  const r = await advDecide(TOK.owner, { request_id: slipLessReq.id, decision: 'approved' });
  check('decide: approval BEFORE any slip exists refused (422), request stays Pending',
    r.status === 422, r.text.slice(0, 300));
  const row = fakeDb.q1('SELECT status FROM advance_requests WHERE id = ?', slipLessReq.id);
  check('decide: request still Pending after refused approval', row && row.status === 'Pending');
}
{
  // Administration generates the slip AFTER the request, then approves.
  fakeDb.seed("INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, base_subtotal, bonus, deduction_total, advance_deducted, net_payable, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    'SAL-NS-09', 'TCH-NOSLIP', pastPeriod, 'AH-SAL-202609-NNNNNN', 'September 2026', 30000, 0, 0, 0, 30000, 'Pending');
  const r = await advDecide(TOK.owner, { request_id: slipLessReq.id, decision: 'approved' });
  check('decide: approval AFTER the slip exists succeeds',
    r.status === 200 && r.data && r.data.ok && r.data.request.status === 'Approved', r.text.slice(0, 300));
  const adjs = fakeDb.q("SELECT id FROM salary_adjustments WHERE teacher_id = 'TCH-NOSLIP' AND period = ? AND kind = 'advance' AND cancelled_at IS NULL", pastPeriod);
  check('decide: exactly ONE adjustment row for the approval', adjs.length === 1, JSON.stringify(adjs));
  const slip = fakeDb.q1('SELECT advance_deducted, net_payable FROM salary_slips WHERE id = ?', 'SAL-NS-09');
  check('decide: slip folds the advance (deducted 15000, net 15000)',
    slip && Number(slip.advance_deducted) === 15000 && Number(slip.net_payable) === 15000, JSON.stringify(slip));
  const r2 = await advDecide(TOK.owner, { request_id: slipLessReq.id, decision: 'approved' });
  check('decide: replaying the same approval creates no second adjustment',
    r2.status === 200 && r2.data && r2.data.replayed === true &&
    fakeDb.q("SELECT id FROM salary_adjustments WHERE teacher_id = 'TCH-NOSLIP' AND period = ? AND kind = 'advance' AND cancelled_at IS NULL", pastPeriod).length === 1,
    r2.text.slice(0, 300));
}

// ---- Slip-backed behaviour unchanged (regression) ---------------------------
{
  const r = await advReq(TOK.teacherWithSlip, { period: '2026-10', advance_type: 'full' });
  check('regression: slip-backed full still computes server-side net (40000)',
    r.status === 200 && r.data && r.data.ok && r.data.request.requested_amount === 40000 && r.data.salary_net === 40000 && r.data.salary_pending === false, r.text.slice(0, 300));
  const r2 = await advReq(TOK.teacherWithSlip, { period: '2026-10', advance_type: 'custom', custom_amount: 50000 });
  check('regression: slip-backed custom above net still refused (400)', r2.status === 400);
}

// ---- Structural: frontend + version + migration ------------------------------
const TEACHER = read('teacher.html');
const WORKER = read('cloudflare/worker.js');
const DBJS = read('functions/api/db.js');
const MIGRATION = read('cloudflare/migrations/advance-requests-table.sql');
check('structural: teacher form always offers the current period (curPeriodNoSlip)',
  TEACHER.includes('curPeriodNoSlip'));
check('structural: teacher note explains slip-less requests (custom only, stays pending)',
  TEACHER.includes('you can still request an advance for it below (custom amount only)'));
check('structural: teacher amount hint explains slip-less custom',
  TEACHER.includes('full/half advances need a generated slip'));
check('structural: teacher submit surfaces the pending-slip state',
  TEACHER.includes('No slip exists for this period yet'));
check('structural: worker refuses full/half without a slip with a plain message',
  WORKER.includes('A full or half advance needs a generated salary slip for this period'));
check('structural: schema version bumped to v3 in db.js and worker health constant',
  DBJS.includes("const SCHEMA_VERSION = '2026-10-29-v3'") && WORKER.includes("const HEALTH_SCHEMA_VERSION = '2026-10-29-v3'"));
check('structural: migration SQL creates advance_requests idempotently',
  MIGRATION.includes('CREATE TABLE IF NOT EXISTS advance_requests'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
