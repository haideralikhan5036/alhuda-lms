// Salary-advance workflow (Batch B, Parts 2-3) tests.
// Drives the REAL cloudflare/worker.js (via temp ESM copies) against a
// fake D1 backed by Node's built-in SQLite (node:sqlite), plus structural
// checks on the teacher/admin frontend pieces.
// Run from the repo root:  node test/salary-advance-workflow.test.mjs
// Requires: node >= 22.5 (node:sqlite).
// All teachers, slips, and amounts below are SYNTHETIC test markers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'saladv-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-only-secret-for-salary-advance-suite';
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
const baseEnv = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: fakeDb };

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
  teacherA: await createSessionToken({ sub: 'TCH-A', role: 'teacher' }, WORKER_SECRET),
  teacherB: await createSessionToken({ sub: 'TCH-B', role: 'teacher' }, WORKER_SECRET),
  teacherMgr: await createSessionToken({ sub: 'TCH-MGR-1', role: 'teacher' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
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

// ---- Setup: schema boot + seeds ------------------------------------------
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', r.status === 200, r.text.slice(0, 200));
  const t = fakeDb.q1("SELECT name FROM sqlite_master WHERE type='table' AND name='advance_requests'");
  check('setup: advance_requests table created by schema boot', !!t);
}
fakeDb.seed("INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)",
  'TCH-A', 'Teacher A', JSON.stringify({ salary_slips: {} }), 'Active');
fakeDb.seed("INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)",
  'TCH-B', 'Teacher B', JSON.stringify({ salary_slips: {
    'TCH-B_September_2026': { teacher_id: 'TCH-B', month: 'September 2026', base_subtotal: 20000, bonus: 0, deduction: 0, net_payable: 20000, status: 'Pending', slip_key: 'TCH-B_September_2026' }
  } }), 'Active');
fakeDb.seed("INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)",
  'TCH-MGR-1', 'Manager One', JSON.stringify({ employee_type: 'manager', salary_slips: {} }), 'Active');
fakeDb.seed("INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, base_subtotal, bonus, deduction_total, advance_deducted, net_payable, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  'SAL-TA-10', 'TCH-A', '2026-10', 'AH-SAL-202610-AAAAAA', 'October 2026', 40000, 0, 0, 0, 40000, 'Pending');
fakeDb.seed("INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, base_subtotal, bonus, deduction_total, advance_deducted, net_payable, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  'SAL-TB-10', 'TCH-B', '2026-10', 'AH-SAL-202610-BBBBBB', 'October 2026', 30000, 0, 0, 0, 30000, 'Pending');
fakeDb.seed("INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, base_subtotal, bonus, deduction_total, advance_deducted, net_payable, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  'SAL-TM-10', 'TCH-MGR-1', '2026-10', 'AH-SAL-202610-CCCCCC', 'October 2026', 50000, 0, 0, 0, 50000, 'Pending');

// ---- Request creation ------------------------------------------------------
let reqFull, reqCustom;
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'full' });
  check('request: full advance computes server-side net (40000)', r.status === 200 && r.data && r.data.ok && r.data.request && r.data.request.requested_amount === 40000, r.text.slice(0, 200));
  check('request: full request is Pending for own teacher only', r.data.request.status === 'Pending' && r.data.request.teacher_id === 'TCH-A' && r.data.request.period === '2026-10');
  reqFull = r.data.request;
  const slip = fakeDb.q1('SELECT net_payable FROM salary_slips WHERE id = ?', 'SAL-TA-10');
  check('request: pending request does NOT move the slip net', slip && Number(slip.net_payable) === 40000);
}
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'full' });
  check('request: identical pending re-submit returns existing, no duplicate', r.status === 200 && r.data && r.data.duplicate === true && r.data.request.id === reqFull.id, r.text.slice(0, 200));
  const n = fakeDb.q("SELECT id FROM advance_requests WHERE teacher_id = 'TCH-A' AND period = '2026-10' AND status = 'Pending'");
  check('request: still exactly one pending row for teacher+period+type+amount', n.length === 1);
}
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'custom', custom_amount: 50000 });
  check('request: custom above net refused (400)', r.status === 400, r.text.slice(0, 200));
}
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'custom', custom_amount: 10000, reason: 'Family need' });
  check('request: custom within net accepted', r.status === 200 && r.data && r.data.ok && r.data.request.requested_amount === 10000, r.text.slice(0, 200));
  reqCustom = r.data.request;
}
{
  const r = await advReq(TOK.teacherA, { period: '2026-13', advance_type: 'full' });
  check('request: malformed period refused (400)', r.status === 400);
  const r2 = await advReq(TOK.teacherA, { period: '2999-01', advance_type: 'full' });
  check('request: future period refused (400)', r2.status === 400);
  const r3 = await advReq(TOK.teacherA, { period: '2026-08', advance_type: 'full' });
  check('request: period with no salary record refused (422)', r3.status === 422, r3.text.slice(0, 200));
}
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'full', teacher_id: 'TCH-B' });
  check('request: client-supplied teacher_id ignored (still own account)', r.status === 200 && r.data && r.data.duplicate === true && r.data.request.teacher_id === 'TCH-A');
  const r2 = await advReq(TOK.owner, { period: '2026-10', advance_type: 'full' });
  check('request: owner cannot request (403)', r2.status === 403);
  const r3 = await advReq(TOK.manager, { period: '2026-10', advance_type: 'full' });
  check('request: manager cannot request (403)', r3.status === 403);
  const r4 = await advReq(null, { period: '2026-10', advance_type: 'full' });
  check('request: anonymous refused (401)', r4.status === 401);
}
{
  // Blob-only slip: teacher B has no table row for 2026-09, only a blob entry.
  const r = await advReq(TOK.teacherB, { period: '2026-09', advance_type: 'full' });
  check('request: blob-only slip resolves (20000)', r.status === 200 && r.data && r.data.request.requested_amount === 20000, r.text.slice(0, 200));
  var reqBlob = r.data.request;
  const r2 = await advReq(TOK.teacherB, { period: '2026-10', advance_type: 'half' });
  check('request: half computes floor(net/2) = 15000', r2.status === 200 && r2.data.request.requested_amount === 15000, r2.text.slice(0, 200));
  var reqHalf = r2.data.request;
  globalThis.__reqBlob = reqBlob;
  globalThis.__reqHalf = reqHalf;
}

// ---- Decisions ---------------------------------------------------------------
{
  const r = await advDecide(TOK.teacherA, { request_id: reqFull.id, decision: 'approved' });
  check('decide: teacher cannot approve own request (403)', r.status === 403);
}
{
  const r = await advDecide(TOK.manager, { request_id: reqFull.id, decision: 'approved' });
  check('decide: manager approves regular teacher request', r.status === 200 && r.data && r.data.ok, r.text.slice(0, 300));
  check('decide: approval returns the updated slip figures', r.data && r.data.updated_slip && r.data.updated_slip.advance_deducted === 40000 && r.data.updated_slip.net_payable === 0, JSON.stringify(r.data && r.data.updated_slip));
  const adj = fakeDb.q("SELECT * FROM salary_adjustments WHERE kind = 'advance' AND teacher_id = 'TCH-A' AND period = '2026-10'");
  check('decide: exactly one advance adjustment row created', adj.length === 1, 'count=' + adj.length);
  check('decide: adjustment carries amount + recovery period + request link', adj.length === 1 && Number(adj[0].amount) === 40000 && Number(adj[0].recovery_per_month) === 40000 && Number(adj[0].advance_remaining) === 0 && String(adj[0].legacy_json || '').includes(reqFull.id));
  const slip = fakeDb.q1('SELECT advance_deducted, net_payable FROM salary_slips WHERE id = ?', 'SAL-TA-10');
  check('decide: slip advance_deducted + net updated', slip && Number(slip.advance_deducted) === 40000 && Number(slip.net_payable) === 0);
  const tRow = fakeDb.q1('SELECT address FROM teachers WHERE id = ?', 'TCH-A');
  const meta = JSON.parse(tRow.address || '{}');
  const blobEntry = Object.values(meta.salary_slips || {}).find((e) => e && (e.month === 'October 2026'));
  check('decide: blob slip entry mirrors advance + net', !!blobEntry && Number(blobEntry.advance_deducted) === 40000 && Number(blobEntry.net_payable) === 0);
  const req = fakeDb.q1('SELECT status, approved_amount, adjustment_id FROM advance_requests WHERE id = ?', reqFull.id);
  check('decide: request marked Approved with amount + adjustment link', req && req.status === 'Approved' && Number(req.approved_amount) === 40000 && !!req.adjustment_id);
  const audit = fakeDb.q("SELECT * FROM audit_log WHERE table_name = 'advance_requests' AND record_id = ?", reqFull.id);
  check('decide: metadata-only audit entry written (no amount column exists)', audit.length === 1 && audit[0].action === 'advance_approve');
}
{
  const r = await advDecide(TOK.owner, { request_id: reqFull.id, decision: 'approved' });
  check('decide: double approval replays, creates no second row', r.status === 200 && r.data && r.data.replayed === true, r.text.slice(0, 200));
  const adj = fakeDb.q("SELECT * FROM salary_adjustments WHERE kind = 'advance' AND teacher_id = 'TCH-A' AND period = '2026-10'");
  check('decide: still exactly one adjustment after replay', adj.length === 1);
}
{
  const r = await advDecide(TOK.owner, { request_id: reqCustom.id, decision: 'approved' });
  check('decide: approval over current net refused (409) with current net', r.status === 409 && r.data && r.data.current_net === 0, r.text.slice(0, 200));
  const req = fakeDb.q1('SELECT status FROM advance_requests WHERE id = ?', reqCustom.id);
  check('decide: over-net request stays Pending', req && req.status === 'Pending');
}
{
  const r = await advDecide(TOK.owner, { request_id: reqCustom.id, decision: 'rejected', reviewer_comment: 'Net already used by the full advance.' });
  check('decide: rejection succeeds', r.status === 200 && r.data && r.data.ok, r.text.slice(0, 200));
  const req = fakeDb.q1('SELECT status, reviewer_comment, approved_amount FROM advance_requests WHERE id = ?', reqCustom.id);
  check('decide: rejection preserves request + comment, no approved amount', req && req.status === 'Rejected' && req.reviewer_comment === 'Net already used by the full advance.' && req.approved_amount == null);
  const adj = fakeDb.q("SELECT * FROM salary_adjustments WHERE kind = 'advance' AND teacher_id = 'TCH-A' AND period = '2026-10'");
  check('decide: rejection created no salary record', adj.length === 1);
  const r2 = await advDecide(TOK.owner, { request_id: reqCustom.id, decision: 'approved' });
  check('decide: decided request cannot flip decisions (409)', r2.status === 409);
}
{
  // Manager-account target: seeded pending request for TCH-MGR-1.
  fakeDb.seed("INSERT INTO advance_requests (id, teacher_id, teacher_name, period, advance_type, requested_amount, status, requested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    'ADV-MGR-1', 'TCH-MGR-1', 'Manager One', '2026-10', 'full', 50000, 'Pending', new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  const r = await advDecide(TOK.manager, { request_id: 'ADV-MGR-1', decision: 'approved' });
  check('decide: manager cannot decide a manager-account request (403)', r.status === 403, r.text.slice(0, 200));
  const r2 = await advDecide(TOK.owner, { request_id: 'ADV-MGR-1', decision: 'approved' });
  check('decide: owner CAN decide a manager-account request', r2.status === 200 && r2.data && r2.data.ok, r2.text.slice(0, 200));
  // Self-approval: manager token whose sub equals the requester id.
  fakeDb.seed("INSERT INTO advance_requests (id, teacher_id, teacher_name, period, advance_type, requested_amount, status, requested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    'ADV-SELF-1', 'TCH-MGR-1', 'Manager One', '2026-10', 'custom', 1000, 'Pending', new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  const r3 = await advDecide(TOK.manager, { request_id: 'ADV-SELF-1', decision: 'approved' });
  check('decide: reviewer cannot be the requester (403)', r3.status === 403);
}
{
  // Parent review: approval above the requested amount is refused — a
  // reviewer may approve less, never more (see the decide handler).
  const reqHalf0 = globalThis.__reqHalf;
  const r = await advDecide(TOK.owner, { request_id: reqHalf0.id, decision: 'approved', approved_amount: 20000 });
  check('decide: approval above requested amount refused (400)', r.status === 400, r.text.slice(0, 200));
  const req = fakeDb.q1('SELECT status FROM advance_requests WHERE id = ?', reqHalf0.id);
  check('decide: over-requested approval leaves request Pending', req && req.status === 'Pending');
}
{
  // Blob-only approval promotes the slip to a table row.
  const reqBlob = globalThis.__reqBlob;
  const r = await advDecide(TOK.owner, { request_id: reqBlob.id, decision: 'approved' });
  check('decide: blob-only approval succeeds', r.status === 200 && r.data && r.data.ok, r.text.slice(0, 300));
  const slip = fakeDb.q1("SELECT advance_deducted, net_payable FROM salary_slips WHERE teacher_id = 'TCH-B' AND period = '2026-09'");
  check('decide: blob slip promoted to table row with advance applied', !!slip && Number(slip.advance_deducted) === 20000 && Number(slip.net_payable) === 0);
  const reqHalf = globalThis.__reqHalf;
  const r2 = await advDecide(TOK.owner, { request_id: reqHalf.id, decision: 'approved' });
  check('decide: half approval applies (net 30000 -> 15000)', r2.status === 200 && r2.data && r2.data.updated_slip && r2.data.updated_slip.net_payable === 15000, r2.text.slice(0, 200));
}

// ---- /api/db scoping for the new table ---------------------------------------
{
  const r = await dbPost(TOK.teacherA, { table: 'advance_requests', action: 'select' });
  const rows = (r.data && r.data.data) || [];
  check('db: teacher selects only own advance requests', r.status === 200 && rows.length > 0 && rows.every((x) => String(x.teacher_id) === 'TCH-A'), r.text.slice(0, 200));
  const r2 = await dbPost(TOK.teacherA, { table: 'advance_requests', action: 'insert', values: { teacher_id: 'TCH-A', period: '2026-10', advance_type: 'full', requested_amount: 1 } });
  check('db: teacher insert on advance_requests denied (403)', r2.status === 403, r2.text.slice(0, 200));
  const r3 = await dbPost(TOK.teacherA, { table: 'advance_requests', action: 'update', values: { status: 'Approved' }, filters: [{ column: 'id', op: 'eq', value: reqFull.id }] });
  check('db: teacher update on advance_requests denied (403)', r3.status === 403);
  const r4 = await dbPost(TOK.manager, { table: 'advance_requests', action: 'update', values: { status: 'Approved' }, filters: [{ column: 'id', op: 'eq', value: reqFull.id }] });
  check('db: manager update on advance_requests denied (must use endpoint)', r4.status === 403);
  const r5 = await dbPost(TOK.owner, { table: 'advance_requests', action: 'delete', filters: [{ column: 'id', op: 'eq', value: reqFull.id }] });
  check('db: advance_requests never hard-deleted, even by owner (403)', r5.status === 403);
  const r6 = await dbPost(TOK.manager, { table: 'advance_requests', action: 'select' });
  const mRows = (r6.data && r6.data.data) || [];
  check('db: manager select hides manager-account requests', r6.status === 200 && mRows.every((x) => String(x.teacher_id) !== 'TCH-MGR-1'), r.text.slice(0, 200));
  const r7 = await dbPost(TOK.parent, { table: 'advance_requests', action: 'select' });
  check('db: parent has no advance-request access (403)', r7.status === 403);
}

// ---- Frontend structural checks ------------------------------------------------
{
  const teacherHtml = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
  const leavesJs = fs.readFileSync(path.join(REPO_ROOT, 'js/leaves.js'), 'utf8');
  const feeTables = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-tables.js'), 'utf8');
  const workerSrc = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare/worker.js'), 'utf8');
  check('ui: teacher salary section has advance form + list + summary + stale note',
    teacherHtml.includes('id="tAdvPeriod"') && teacherHtml.includes('id="tAdvSubmitBtn"') &&
    teacherHtml.includes('Request Advance Salary') && teacherHtml.includes('id="tAdvMyList"') &&
    teacherHtml.includes('id="tSalSummaryBody"') && teacherHtml.includes('id="tSalStaleNote"'));
  check('ui: teacher voucher table has an Approved Advances column',
    teacherHtml.includes('Approved Advances'));
  check('ui: teacher form offers full / half / custom types',
    teacherHtml.includes('data-adv-type="full"') && teacherHtml.includes('data-adv-type="half"') && teacherHtml.includes('data-adv-type="custom"'));
  check('ui: teacher advance submit uses the Worker endpoint, not /api/db',
    teacherHtml.includes("/api/advances/request") && !/submitTeacherAdvanceRequest[\s\S]{0,2000}db\.from\('advance_requests'\)\.insert/.test(teacherHtml));
  check('ui: Requests modal has advance approve/decline handlers',
    leavesJs.includes('handleApproveAdvanceRequest') && leavesJs.includes('handleDeclineAdvanceRequest') &&
    leavesJs.includes("requestType: 'advance_salary'") && leavesJs.includes('/api/advances/decide'));
  check('ui: canonical net + newest-wins merge helpers exist',
    feeTables.includes('netPayable:') && feeTables.includes('mergeSlipLists:') && feeTables.includes('labelFromPeriod:'));
  check('ui: teacher salary preview no longer consults the salary_read_v1 flag',
    !/loadTeacherPreviousSalaries[\s\S]{0,4000}getReadMode/.test(teacherHtml));
  check('release: WORKER_RELEASE is the commission release',
    /const WORKER_RELEASE = '2026-10-29-phase4'/.test(workerSrc));
  check('release: no native alert/confirm/prompt in new teacher advance code',
    !/submitTeacherAdvanceRequest[\s\S]{0,8000}\b(alert|confirm|prompt)\(/.test(teacherHtml));
}

// ---- Summary ---------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}`);
if (failed.length) {
  for (const f of failed) console.log('FAILED: ' + f.name);
  process.exit(1);
}
