// Salary Restructuring Phase 4 — manual per-cycle repayments + admin
// plan changes + final sequencing flag.
// Part W drives the REAL cloudflare/worker.js against a fake D1
// (node:sqlite) and proves:
//   - advance_manual_requests: submission validation, ONE active
//     submission per teacher+period (existing returned, no 2nd row),
//     confirm/adjust/reject at slip time (reason rules), recovery
//     through the SAME apply-recovery path (source 'manual',
//     requested_amount recorded), no submission / pending / rejected
//     => ZERO recovery, decided submissions are terminal/consumed;
//   - POST /api/advances/change-plan: admin-only, reason required,
//     future cycles only (past recovery rows untouched), stored in
//     the adjustment's plan + plan_changes history and mirrored onto
//     the advance_requests row; bars (own record, manager targets);
//   - engine scoping for the new table (own-rows reads, no writes).
// Part P executes the REAL js/payroll.js in a vm: the ledger loader's
// manual amounts, the planner's manual branch (decided amount for
// the period, adjusted figure, no-submission zero, Phase 3 signature
// back-compat), and compile integration across months.
// Part T executes the REAL teacher.html functions in a vm: the
// manual section ships behind ADVANCE_MANUAL_SUBMISSIONS_ENABLED
// (shipped ON since the flip PR, after the v8 Worker deploy was
// verified live on 2026-11-07; nothing built while off, even without
// the const declared), and with the flag on renders
// submitted-vs-final
// amounts with the admin reason and posts submissions correctly.
// Run from the repo root:  node test/salary-manual-cycles.test.mjs
// Requires: node >= 22.5 (node:sqlite).
// All teachers, slips, and amounts below are SYNTHETIC test markers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEACHER = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// =====================================================================
// Part W — real Worker + FakeD1
// =====================================================================
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'salman4-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = ['test', 'only', 'manual', 'secret', '4'].join('-');
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
}

const fakeDb = new FakeD1();
const baseEnv = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: fakeDb };
const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
  teacherMgr: await createSessionToken({ sub: 'TCH-MGR-1', role: 'teacher' }, WORKER_SECRET),
};
for (const id of ['TCH-M1', 'TCH-M2', 'TCH-M3', 'TCH-M4', 'TCH-M5', 'TCH-M6', 'TCH-M7', 'TCH-M8', 'TCH-M9']) {
  TOK[id] = await createSessionToken({ sub: id, role: 'teacher' }, WORKER_SECRET);
}
TOK['TCH-MGR-1'] = TOK.teacherMgr;
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
const advRecover = (token, body) => call('https://worker.test/api/advances/apply-recovery', { token, body });
const manReq = (token, body) => call('https://worker.test/api/advances/manual-request', { token, body });
const manList = (token, body) => call('https://worker.test/api/advances/manual-list', { token, body });
const manDecide = (token, body) => call('https://worker.test/api/advances/manual-decide', { token, body });
const changePlan = (token, body) => call('https://worker.test/api/advances/change-plan', { token, body });
const dbPost = (token, body) => call('https://worker.test/api/db', { token, body });

function seedTeacher(id, name, meta = {}) {
  fakeDb.seed('INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)',
    id, name, JSON.stringify({ salary_slips: {}, ...meta }), 'Active');
}
function seedSlip(id, teacherId, period, monthLabel, base, advanceDeducted, net) {
  fakeDb.seed(
    'INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, base_subtotal, bonus, deduction_total, advance_deducted, net_payable, status, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
    id, teacherId, period, 'AH-SAL-' + period.replace('-', '') + '-' + id.slice(-4), monthLabel,
    base, 0, 0, advanceDeducted, net, 'Pending');
}
const adjOf = (teacherId) => fakeDb.q("SELECT * FROM salary_adjustments WHERE teacher_id = ? AND kind = 'advance' ORDER BY created_at ASC", teacherId);
const recoveriesOf = (teacherId) => fakeDb.q('SELECT * FROM advance_recoveries WHERE teacher_id = ? ORDER BY created_at ASC, adjustment_id ASC', teacherId);
const manualOf = (teacherId) => fakeDb.q('SELECT * FROM advance_manual_requests WHERE teacher_id = ? ORDER BY created_at ASC', teacherId);

// Create an approved plan advance through the real endpoints and
// return its ledger row.
async function makePlanAdvance(teacherId, amount, plan) {
  const body = { period: '2026-10', advance_type: 'custom', custom_amount: amount, repayment_method: plan.method };
  if (plan.installment) body.installment_amount = plan.installment;
  const r = await advReq(TOK[teacherId], body);
  if (!(r.status === 200 && r.data && r.data.ok)) throw new Error('advance request failed for ' + teacherId + ': ' + r.text);
  const d = await advDecide(TOK.owner, { request_id: r.data.request.id, decision: 'approved' });
  if (!(d.status === 200 && d.data && d.data.ok)) throw new Error('advance decide failed for ' + teacherId + ': ' + d.text);
  return adjOf(teacherId)[0];
}

// ---- Setup ---------------------------------------------------------------
{
  const h = await call('https://worker.test/api/health', { method: 'GET' });
  check('W setup: health reports the Phase 4 release + schema v9',
    h.status === 200 && h.data && h.data.version === '2026-11-13-teacher-cover' && h.data.schema === '2026-11-13-v9',
    h.text.slice(0, 200));
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('W setup: owner /api/db boot -> 200', r.status === 200, r.text.slice(0, 200));
  const t = fakeDb.q1("SELECT name FROM sqlite_master WHERE type='table' AND name='advance_manual_requests'");
  check('W setup: advance_manual_requests table created by schema boot', !!t);
  const idx = fakeDb.q1("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_advance_manual_requests_active'");
  check('W setup: ONE-ACTIVE partial UNIQUE index exists (status set + recovery_id IS NULL)',
    !!idx && /UNIQUE/i.test(idx.sql) && idx.sql.includes('recovery_id IS NULL') && idx.sql.includes("'pending'"), idx && idx.sql);
  const marker = fakeDb.q1("SELECT value FROM system_settings WHERE key = 'schema_version'");
  check('W setup: schema marker is 2026-11-13-v9', !!marker && marker.value === '2026-11-13-v9', JSON.stringify(marker));
}
for (const id of ['TCH-M1', 'TCH-M2', 'TCH-M3', 'TCH-M4', 'TCH-M5', 'TCH-M6', 'TCH-M7', 'TCH-M8', 'TCH-M9']) seedTeacher(id, 'Teacher ' + id.slice(4));
seedTeacher('TCH-MGR-1', 'Manager One', { employee_type: 'manager' });

// ---- Submission validation ------------------------------------------------
let adjM1, adjM2;
{
  adjM1 = await makePlanAdvance('TCH-M1', 9000, { method: 'manual' });
  adjM2 = await makePlanAdvance('TCH-M2', 9000, { method: 'manual' });
  check('W setup: manual advances open with rpm 0 and full remaining',
    Number(adjM1.advance_remaining) === 9000 && Number(adjM1.recovery_per_month) === 0 &&
    Number(adjM2.advance_remaining) === 9000);
  const zero = await manReq(TOK['TCH-M1'], { adjustment_id: adjM1.id, period: '2026-11', amount: 0 });
  check('W submit: amount 0 refused (400)', zero.status === 400);
  const over = await manReq(TOK['TCH-M1'], { adjustment_id: adjM1.id, period: '2026-11', amount: 99999 });
  check('W submit: amount above the remaining balance refused (400)', over.status === 400 && over.data && over.data.advance_remaining === 9000, over.text.slice(0, 160));
  const future = await manReq(TOK['TCH-M1'], { adjustment_id: adjM1.id, period: '2027-06', amount: 1000 });
  check('W submit: future period refused (400)', future.status === 400);
  const early = await manReq(TOK['TCH-M1'], { adjustment_id: adjM1.id, period: '2026-09', amount: 1000 });
  check('W submit: period before the advance period refused (400)', early.status === 400);
  const alien = await manReq(TOK['TCH-M2'], { adjustment_id: adjM1.id, period: '2026-11', amount: 1000 });
  check('W submit: another teacher adjustment refused (403)', alien.status === 403);
  const byOwner = await manReq(TOK.owner, { adjustment_id: adjM1.id, period: '2026-11', amount: 1000 });
  check('W submit: owner token cannot submit for a teacher (403)', byOwner.status === 403);
  check('W submit: refused submissions wrote no rows', manualOf('TCH-M1').length === 0 && manualOf('TCH-M2').length === 0);
}
{
  // A fixed-plan adjustment is not a manual target (uses M4's advance
  // later in the plan-change flow; created here while still fixed).
  var adjM4 = await makePlanAdvance('TCH-M4', 10000, { method: 'fixed', installment: 2000 });
  const wrong = await manReq(TOK['TCH-M4'], { adjustment_id: adjM4.id, period: '2026-11', amount: 1000 });
  check('W submit: submission against a FIXED-plan adjustment refused (400)',
    wrong.status === 400 && /manual repayment plan/.test(wrong.text), wrong.text.slice(0, 160));
  check('W submit: no row written for the fixed-plan attempt', manualOf('TCH-M4').length === 0);
}

// ---- Confirm lifecycle: submit -> confirm -> finalize -> balance drops ---
let manM1;
{
  const s = await manReq(TOK['TCH-M1'], { adjustment_id: adjM1.id, period: '2026-11', amount: 4000 });
  check('W confirm: submission accepted as pending', s.status === 200 && s.data && s.data.ok && s.data.manual_request.status === 'pending', s.text.slice(0, 200));
  manM1 = s.data.manual_request;
  const dup = await manReq(TOK['TCH-M1'], { adjustment_id: adjM1.id, period: '2026-11', amount: 3000 });
  check('W confirm: a second ACTIVE submission for the period returns the existing row (no duplicate)',
    dup.status === 200 && dup.data && dup.data.duplicate === true && dup.data.manual_request.id === manM1.id && manualOf('TCH-M1').length === 1,
    dup.text.slice(0, 200));
  const mine = await manList(TOK['TCH-M1'], {});
  check('W list: the teacher sees exactly their own submission',
    mine.status === 200 && mine.data.manual_requests.length === 1 && mine.data.manual_requests[0].id === manM1.id);
  const dec = await manDecide(TOK.owner, { manual_request_id: manM1.id, decision: 'confirmed' });
  check('W confirm: admin confirms the submitted amount',
    dec.status === 200 && dec.data.manual_request.status === 'confirmed' && dec.data.manual_request.final_amount === 4000, dec.text.slice(0, 200));
  const replay = await manDecide(TOK.owner, { manual_request_id: manM1.id, decision: 'confirmed' });
  check('W confirm: the same decision replays idempotently', replay.status === 200 && replay.data.replayed === true);
  const flip = await manDecide(TOK.owner, { manual_request_id: manM1.id, decision: 'rejected', admin_reason: 'Changed my mind' });
  check('W confirm: a decided submission is terminal (flip -> 409)', flip.status === 409);
  // The finalized November slip carries exactly the confirmed amount
  // (the planner's output — Part P proves the compile side).
  seedSlip('SAL-M1-11', 'TCH-M1', '2026-11', 'November 2026', 30000, 4000, 26000);
  const rec = await advRecover(TOK.owner, { slip_id: 'SAL-M1-11' });
  check('W confirm: finalization recovers the confirmed amount as a MANUAL recovery',
    rec.status === 200 && rec.data.applied.length === 1 && rec.data.applied[0].amount === 4000 &&
    rec.data.applied[0].source === 'manual' && rec.data.applied[0].requested_amount === 4000 &&
    rec.data.applied[0].balance_after === 5000 && rec.data.outstanding_total === 5000,
    rec.text.slice(0, 240));
  const row = fakeDb.q1('SELECT * FROM advance_manual_requests WHERE id = ?', manM1.id);
  check('W confirm: the submission is consumed (recovery_id + applied_amount stamped)',
    !!row && !!row.recovery_id && Number(row.applied_amount) === 4000);
  const recRow = recoveriesOf('TCH-M1')[0];
  check('W confirm: the recovery row records source manual + the submitted amount',
    !!recRow && recRow.source === 'manual' && Number(recRow.requested_amount) === 4000 && recRow.id === row.recovery_id);
  const again = await manDecide(TOK.owner, { manual_request_id: manM1.id, decision: 'confirmed' });
  check('W confirm: a consumed submission can no longer be decided (409)', again.status === 409);
  const late = await manReq(TOK['TCH-M1'], { adjustment_id: adjM1.id, period: '2026-11', amount: 1000 });
  check('W confirm: submitting for an already-finalized period is refused (409)', late.status === 409, late.text.slice(0, 160));
}

// ---- Adjust lifecycle ------------------------------------------------------
{
  const s = await manReq(TOK['TCH-M2'], { adjustment_id: adjM2.id, period: '2026-11', amount: 5000 });
  const manM2 = s.data.manual_request;
  const noReason = await manDecide(TOK.owner, { manual_request_id: manM2.id, decision: 'adjusted', admin_amount: 3500 });
  check('W adjust: adjusting WITHOUT a reason is refused (400)', noReason.status === 400, noReason.text.slice(0, 160));
  const still = fakeDb.q1('SELECT status FROM advance_manual_requests WHERE id = ?', manM2.id);
  check('W adjust: the refused adjustment leaves the submission pending', !!still && still.status === 'pending');
  const over = await manDecide(TOK.owner, { manual_request_id: manM2.id, decision: 'adjusted', admin_amount: 99999, admin_reason: 'Too much' });
  check('W adjust: an adjusted amount above the remaining balance is refused (400)', over.status === 400);
  const adj = await manDecide(TOK.owner, { manual_request_id: manM2.id, decision: 'adjusted', admin_amount: 3500, admin_reason: 'Partial month' });
  check('W adjust: adjust with a reason succeeds; final amount = the admin figure',
    adj.status === 200 && adj.data.manual_request.status === 'adjusted' &&
    adj.data.manual_request.final_amount === 3500 && adj.data.manual_request.amount === 5000 &&
    adj.data.manual_request.admin_reason === 'Partial month', adj.text.slice(0, 240));
  const mine = await manList(TOK['TCH-M2'], {});
  check('W adjust: the TEACHER sees the final amount + the admin reason',
    mine.status === 200 && mine.data.manual_requests.length === 1 &&
    mine.data.manual_requests[0].final_amount === 3500 && mine.data.manual_requests[0].admin_reason === 'Partial month');
  seedSlip('SAL-M2-11', 'TCH-M2', '2026-11', 'November 2026', 30000, 3500, 26500);
  const rec = await advRecover(TOK.owner, { slip_id: 'SAL-M2-11' });
  check('W adjust: finalization deducts the ADJUSTED amount; the recovery keeps the submitted figure',
    rec.status === 200 && rec.data.applied.length === 1 && rec.data.applied[0].amount === 3500 &&
    rec.data.applied[0].requested_amount === 5000 && rec.data.applied[0].balance_after === 5500,
    rec.text.slice(0, 240));
  const row = fakeDb.q1('SELECT * FROM advance_manual_requests WHERE id = ?', manM2.id);
  check('W adjust: applied_amount on the submission is the adjusted figure', !!row && Number(row.applied_amount) === 3500);
}

// ---- Reject lifecycle -------------------------------------------------------
{
  const adjM3 = await makePlanAdvance('TCH-M3', 6000, { method: 'manual' });
  const s = await manReq(TOK['TCH-M3'], { adjustment_id: adjM3.id, period: '2026-11', amount: 3000 });
  const manM3 = s.data.manual_request;
  const noReason = await manDecide(TOK.owner, { manual_request_id: manM3.id, decision: 'rejected' });
  check('W reject: rejecting WITHOUT a reason is refused (400)', noReason.status === 400);
  const rej = await manDecide(TOK.owner, { manual_request_id: manM3.id, decision: 'rejected', admin_reason: 'No budget this month' });
  check('W reject: reject with a reason succeeds', rej.status === 200 && rej.data.manual_request.status === 'rejected');
  seedSlip('SAL-M3-11', 'TCH-M3', '2026-11', 'November 2026', 30000, 0, 30000);
  const rec = await advRecover(TOK.owner, { slip_id: 'SAL-M3-11' });
  check('W reject: a rejected submission recovers ZERO; the balance is untouched',
    rec.status === 200 && rec.data.applied.length === 0 && Number(adjOf('TCH-M3')[0].advance_remaining) === 6000 && recoveriesOf('TCH-M3').length === 0);
  const again = await manReq(TOK['TCH-M3'], { adjustment_id: adjM3.id, period: '2026-10', amount: 2500 });
  check('W reject: the teacher may submit again (a rejected row is not active)',
    again.status === 200 && again.data && again.data.ok && !again.data.duplicate && again.data.manual_request.status === 'pending',
    again.text.slice(0, 200));
}

// ---- Pending is not money; no submission is not money -----------------------
{
  const adjM8 = await makePlanAdvance('TCH-M8', 7000, { method: 'manual' });
  await manReq(TOK['TCH-M8'], { adjustment_id: adjM8.id, period: '2026-11', amount: 4000 }); // stays PENDING
  seedSlip('SAL-M8-11', 'TCH-M8', '2026-11', 'November 2026', 30000, 4000, 26000);
  const rec = await advRecover(TOK.owner, { slip_id: 'SAL-M8-11' });
  check('W pending: an UNDECIDED submission recovers nothing even when the slip claims the amount',
    rec.status === 200 && rec.data.applied.length === 0 && Number(adjOf('TCH-M8')[0].advance_remaining) === 7000 && recoveriesOf('TCH-M8').length === 0,
    rec.text.slice(0, 200));
  const adjM9 = await makePlanAdvance('TCH-M9', 5000, { method: 'manual' });
  seedSlip('SAL-M9-11', 'TCH-M9', '2026-11', 'November 2026', 30000, 0, 30000);
  const rec9 = await advRecover(TOK.owner, { slip_id: 'SAL-M9-11' });
  check('W none: NO submission for the period => zero recovery (Decision 7 pin)',
    rec9.status === 200 && rec9.data.applied.length === 0 && Number(adjOf('TCH-M9')[0].advance_remaining) === 5000);
}

// ---- Manager bars ------------------------------------------------------------
{
  const adjMgr = await makePlanAdvance('TCH-MGR-1', 6000, { method: 'manual' });
  const s = await manReq(TOK.teacherMgr, { adjustment_id: adjMgr.id, period: '2026-11', amount: 2000 });
  check('W bars: a manager-account teacher can submit a manual repayment', s.status === 200 && s.data && s.data.ok, s.text.slice(0, 160));
  const byManager = await manDecide(TOK.manager, { manual_request_id: s.data.manual_request.id, decision: 'confirmed' });
  check('W bars: a MANAGER cannot decide a manager account submission (403)', byManager.status === 403);
  const byOwner = await manDecide(TOK.owner, { manual_request_id: s.data.manual_request.id, decision: 'confirmed' });
  check('W bars: the OWNER can decide it', byOwner.status === 200 && byOwner.data.manual_request.status === 'confirmed');
  const mgrList = await manList(TOK.manager, {});
  check('W bars: the manager list excludes manager-account submissions (and their own)',
    mgrList.status === 200 && mgrList.data.manual_requests.every((r) => r.teacher_id !== 'TCH-MGR-1'),
    mgrList.text.slice(0, 200));
  const ownerList = await manList(TOK.owner, { period: '2026-11' });
  check('W bars: the owner list for the period includes the manager-account submission',
    ownerList.status === 200 && ownerList.data.manual_requests.some((r) => r.teacher_id === 'TCH-MGR-1'));
  // A manager CAN decide an ordinary teacher's submission.
  const adjM5 = await makePlanAdvance('TCH-M5', 5000, { method: 'manual' });
  const s5 = await manReq(TOK['TCH-M5'], { adjustment_id: adjM5.id, period: '2026-11', amount: 1500 });
  const byMgr = await manDecide(TOK.manager, { manual_request_id: s5.data.manual_request.id, decision: 'confirmed' });
  check('W bars: a manager CAN decide an ordinary teacher submission',
    byMgr.status === 200 && byMgr.data.manual_request.status === 'confirmed', byMgr.text.slice(0, 160));
  const byTeacher = await manDecide(TOK['TCH-M5'], { manual_request_id: s5.data.manual_request.id, decision: 'confirmed' });
  check('W bars: a teacher token cannot decide at all (403)', byTeacher.status === 403);
}

// ---- Plan change (Decision 6) --------------------------------------------------
{
  // adjM4: fixed 10,000 @ 2,000 (created earlier). One cycle recovers.
  seedSlip('SAL-M4-11', 'TCH-M4', '2026-11', 'November 2026', 40000, 2000, 38000);
  const r1 = await advRecover(TOK.owner, { slip_id: 'SAL-M4-11' });
  check('W plan: first cycle recovers the original installment 2000',
    r1.status === 200 && r1.data.applied.length === 1 && r1.data.applied[0].amount === 2000 && Number(adjOf('TCH-M4')[0].advance_remaining) === 8000);
  const noReason = await changePlan(TOK.owner, { adjustment_id: adjM4.id, installment_amount: 3000 });
  check('W plan: a plan change WITHOUT a reason is refused (400)', noReason.status === 400);
  const noop = await changePlan(TOK.owner, { adjustment_id: adjM4.id, repayment_method: 'fixed', installment_amount: 2000, reason: 'Same thing' });
  check('W plan: a no-op change is refused (400)', noop.status === 400);
  const ch = await changePlan(TOK.owner, { adjustment_id: adjM4.id, installment_amount: 3000, reason: 'Teacher asked for faster repayment' });
  check('W plan: installment change succeeds; response carries the new plan',
    ch.status === 200 && ch.data.ok && ch.data.repayment_plan.method === 'fixed' &&
    ch.data.repayment_plan.installment_amount === 3000 && ch.data.repayment_plan.recovery_per_month === 3000 &&
    ch.data.plan_change.from_installment === 2000 && ch.data.plan_change.to_installment === 3000 &&
    ch.data.plan_change.reason === 'Teacher asked for faster repayment', ch.text.slice(0, 260));
  const rowAfter = adjOf('TCH-M4')[0];
  const metaAfter = JSON.parse(rowAfter.legacy_json || '{}');
  check('W plan: ledger row updated (rpm 3000) with the change in plan_changes; request id still FIRST key',
    Number(rowAfter.recovery_per_month) === 3000 && metaAfter.installment_amount === 3000 &&
    Array.isArray(metaAfter.plan_changes) && metaAfter.plan_changes.length === 1 &&
    rowAfter.legacy_json.startsWith('{"advance_request_id":"'));
  const reqRow = fakeDb.q1('SELECT repayment_method, installment_amount FROM advance_requests WHERE adjustment_id = ?', adjM4.id);
  check('W plan: the originating request row mirrors the new plan (teacher sees the current plan)',
    !!reqRow && reqRow.repayment_method === 'fixed' && Number(reqRow.installment_amount) === 3000);
  seedSlip('SAL-M4-12', 'TCH-M4', '2026-12', 'December 2026', 40000, 3000, 37000);
  const r2 = await advRecover(TOK.owner, { slip_id: 'SAL-M4-12' });
  check('W plan: the NEXT cycle uses the NEW installment (3000)',
    r2.status === 200 && r2.data.applied.length === 1 && r2.data.applied[0].amount === 3000 && Number(adjOf('TCH-M4')[0].advance_remaining) === 5000);
  const past = recoveriesOf('TCH-M4');
  check('W plan: PAST recovery rows are never rewritten (2000 / balance_after 8000 stands)',
    past.length === 2 && Number(past[0].amount) === 2000 && Number(past[0].balance_after) === 8000 && Number(past[1].amount) === 3000,
    JSON.stringify(past));
  // Method change fixed -> manual, then the manual flow works on it.
  const ch2 = await changePlan(TOK.owner, { adjustment_id: adjM4.id, repayment_method: 'manual', reason: 'Switching to manual control' });
  check('W plan: method change to manual succeeds (rpm becomes 0)',
    ch2.status === 200 && ch2.data.repayment_plan.method === 'manual' && ch2.data.repayment_plan.recovery_per_month === 0 &&
    ch2.data.repayment_plan.installment_amount === null, ch2.text.slice(0, 200));
  const meta2 = JSON.parse(adjOf('TCH-M4')[0].legacy_json || '{}');
  check('W plan: plan history accumulates (2 entries, latest is the manual switch)',
    Array.isArray(meta2.plan_changes) && meta2.plan_changes.length === 2 && meta2.plan_changes[1].to_method === 'manual');
  const sub = await manReq(TOK['TCH-M4'], { adjustment_id: adjM4.id, period: '2026-10', amount: 2500 });
  check('W plan: after the switch, manual submissions are accepted on the same advance',
    sub.status === 200 && sub.data && sub.data.ok, sub.text.slice(0, 160));
  await manDecide(TOK.owner, { manual_request_id: sub.data.manual_request.id, decision: 'confirmed' });
  seedSlip('SAL-M4-10', 'TCH-M4', '2026-10', 'October 2026', 40000, 2500, 37500);
  const r3 = await advRecover(TOK.owner, { slip_id: 'SAL-M4-10' });
  check('W plan: the switched-to-manual advance recovers through the manual path',
    r3.status === 200 && r3.data.applied.length === 1 && r3.data.applied[0].source === 'manual' &&
    r3.data.applied[0].amount === 2500 && Number(adjOf('TCH-M4')[0].advance_remaining) === 2500,
    r3.text.slice(0, 200));
}
{
  // Settled advance: no plan change. Legacy advance: no plan at all.
  await makePlanAdvance('TCH-M6', 5000, { method: 'full' });
  seedSlip('SAL-M6-11', 'TCH-M6', '2026-11', 'November 2026', 30000, 5000, 25000);
  await advRecover(TOK.owner, { slip_id: 'SAL-M6-11' });
  const settled = adjOf('TCH-M6')[0];
  check('W plan: fixture advance is fully settled', Number(settled.advance_remaining) === 0);
  const chSettled = await changePlan(TOK.owner, { adjustment_id: settled.id, repayment_method: 'fixed', installment_amount: 1000, reason: 'Try' });
  check('W plan: changing a SETTLED advance is refused (422)', chSettled.status === 422, chSettled.text.slice(0, 160));
  seedSlip('SAL-M7-10', 'TCH-M7', '2026-10', 'October 2026', 30000, 0, 30000);
  const lr = await advReq(TOK['TCH-M7'], { period: '2026-10', advance_type: 'custom', custom_amount: 5000 });
  await advDecide(TOK.owner, { request_id: lr.data.request.id, decision: 'approved' });
  const legacyAdj = adjOf('TCH-M7')[0];
  const chLegacy = await changePlan(TOK.owner, { adjustment_id: legacyAdj.id, repayment_method: 'fixed', installment_amount: 1000, reason: 'Try' });
  check('W plan: a legacy (plan-less) advance has no plan to change (400)', chLegacy.status === 400, chLegacy.text.slice(0, 160));
  // Manager bars on plan change: manager target refused, plain teacher allowed.
  const mgrAdj = adjOf('TCH-MGR-1')[0];
  const byMgr = await changePlan(TOK.manager, { adjustment_id: mgrAdj.id, repayment_method: 'fixed', installment_amount: 1000, reason: 'Try' });
  check('W plan: a MANAGER cannot change a manager account plan (403)', byMgr.status === 403);
  const mgrOk = await changePlan(TOK.manager, { adjustment_id: adjOf('TCH-M5')[0].id, repayment_method: 'fixed', installment_amount: 1500, reason: 'Manager review' });
  check('W plan: a manager CAN change an ordinary teacher plan',
    mgrOk.status === 200 && mgrOk.data.repayment_plan.method === 'fixed' && mgrOk.data.repayment_plan.recovery_per_month === 1500,
    mgrOk.text.slice(0, 200));
  const byTeacher = await changePlan(TOK['TCH-M5'], { adjustment_id: adjOf('TCH-M5')[0].id, repayment_method: 'full', reason: 'Self serve' });
  check('W plan: a teacher token cannot change plans (403)', byTeacher.status === 403);
}

// ---- Engine scoping for advance_manual_requests --------------------------------
{
  const own = await dbPost(TOK['TCH-M1'], { table: 'advance_manual_requests', action: 'select', filters: [] });
  check('W scope: teacher reads advance_manual_requests (own rows only)',
    own.status === 200 && own.data && Array.isArray(own.data.data) && own.data.data.length === 1 && own.data.data.every((r) => r.teacher_id === 'TCH-M1'),
    own.text.slice(0, 200));
  const before = manualOf('TCH-M1').length;
  const write = await dbPost(TOK['TCH-M1'], { table: 'advance_manual_requests', action: 'insert', values: { id: 'AMR-FAKE', teacher_id: 'TCH-M1', adjustment_id: adjM1.id, period: '2026-12', amount: 1, status: 'confirmed' } });
  check('W scope: teacher INSERT into advance_manual_requests is denied',
    (write.status !== 200 || !(write.data && write.data.ok)) && manualOf('TCH-M1').length === before, write.text.slice(0, 160));
  const del = await dbPost(TOK.owner, { table: 'advance_manual_requests', action: 'delete', filters: [{ column: 'id', op: 'eq', value: manM1.id }] });
  check('W scope: even the OWNER cannot hard-delete a manual submission (financial record)',
    manualOf('TCH-M1').length === before, del.text.slice(0, 160));
}

// =====================================================================
// Part P — real js/payroll.js in a vm
// =====================================================================
console.log('--- Part P: payroll planner + compile with manual amounts ---');
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
let FAKE_NOW = '2026-11-30T12:00:00';
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [FAKE_NOW])); }
  static now() { return new Date(FAKE_NOW).getTime(); }
}
let MONTH = 'November 2026';
function makeElement(id) {
  return {
    id, innerHTML: '', innerText: '', value: id === 'salaryMonthSelect' ? MONTH : '',
    appendChild() {}, remove() {}, setAttribute() {}, querySelectorAll() { return []; },
    classList: {
      _set: new Set(id === 'payrollWarnings' ? ['hidden'] : []),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      toggle(c, force) { if (force === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (force) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    }
  };
}
const elements = {};
const store = new Map();
const sessionStore = new Map([['alhuda_lms_owner_token', 'fixture-owner-token']]);
const TABLES = { teachers: [], students: [], class_schedules: [], courses: [], student_assignments: [], salary_adjustments: [], advance_manual_requests: [] };
let ACCOUNTS = {};
function qb(table) {
  const state = { filters: {}, orderCol: null };
  const run = () => {
    let rows = (TABLES[table] || []).filter((r) => Object.entries(state.filters).every(([k, v]) => String(r[k]) === String(v)));
    if (state.orderCol) rows = rows.slice().sort((a, b) => (String(a[state.orderCol]) < String(b[state.orderCol]) ? -1 : 1));
    return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
  };
  const q = {
    select() { return q; },
    eq(k, v) { state.filters[k] = v; return q; },
    order(col) { state.orderCol = col; return q; },
    then(res, rej) { return run().then(res, rej); },
    insert() { return Promise.resolve({ data: null, error: null }); },
    upsert() { return Promise.resolve({ data: null, error: null }); },
    update() { return { eq() { return Promise.resolve({ data: null, error: null }); } }; }
  };
  return q;
}
const sandbox = {
  console, Set, Map, Promise, Date: FakeDate, Math, JSON, Number, String, Boolean, Array, Object, RegExp, Error, Intl, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URLSearchParams,
  document: {
    readyState: 'loading',
    getElementById(id) { return elements[id] || (elements[id] = makeElement(id)); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    createElement() { return makeElement('x'); },
    body: makeElement('body')
  },
  localStorage: {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); }
  },
  sessionStorage: {
    getItem(k) { return sessionStore.has(k) ? sessionStore.get(k) : null; },
    setItem(k, v) { sessionStore.set(k, String(v)); },
    removeItem(k) { sessionStore.delete(k); }
  },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, applied: [], outstanding_total: 0 }) }),
  db: { from: (t) => qb(t) },
  getTeacherAccounts() { return ACCOUNTS; },
  lmsNotify() {},
  lmsConfirm() { return Promise.resolve(true); },
  openModal() {}, closeModal() {}
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`
  var ALL_TEACHERS = [], ALL_STUDENTS = [], ALL_CLASS_SCHEDULES = [], ALL_ASSIGNMENTS = [];
  let ALL_TEACHER_SALARIES = {};
  var CURRENT_SLIP_DATA = null, CURRENT_SLIP_TEACHER_ID = null, CURRENT_ROLE = 'owner';
`, sandbox, { filename: 'prelude.js' });
{
  const CONFIG = read('js/config.js');
  const a = CONFIG.indexOf('function getEmployeeRoleClassification');
  const b = CONFIG.indexOf('window.StaffCategories = StaffCategories;');
  vm.runInContext(CONFIG.slice(a, b + 'window.StaffCategories = StaffCategories;'.length), sandbox, { filename: 'config-classifier.js' });
  const c = CONFIG.indexOf('function fixedSalaryCurrentMonth');
  const d = CONFIG.indexOf('window.FixedSalary = FixedSalary;');
  vm.runInContext(CONFIG.slice(c, d + 'window.FixedSalary = FixedSalary;'.length), sandbox, { filename: 'config-fixedsalary.js' });
}
for (const f of ['js/course-catalogue.js', 'js/assignments.js', 'js/payroll.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}
const run = (code) => vm.runInContext(code, sandbox);
const planRow = (id, teacherId, remaining, rpm, method) => ({
  id, teacher_id: teacherId, kind: 'advance', advance_remaining: remaining, recovery_per_month: rpm,
  cancelled_at: null, created_at: '2026-11-01T00:00:00.000Z',
  legacy_json: JSON.stringify({ advance_request_id: 'REQ-' + id, repayment_method: method, installment_amount: method === 'fixed' || method === 'custom' ? rpm : null })
});
const manRowDb = (id, adjId, teacherId, period, amount, status, extra = {}) => ({
  id, teacher_id: teacherId, adjustment_id: adjId, period, amount, status,
  admin_amount: extra.admin_amount != null ? extra.admin_amount : null,
  admin_reason: extra.admin_reason || null, applied_amount: null,
  recovery_id: extra.recovery_id || null, created_at: '2026-11-02T00:00:00.000Z'
});

// ---- Loader: decided manual submissions land on the ledger entry --------
{
  TABLES.salary_adjustments = [planRow('ADJ-PM', 'TCH-PM', 9000, 0, 'manual')];
  TABLES.advance_manual_requests = [
    manRowDb('AMR-1', 'ADJ-PM', 'TCH-PM', '2026-11', 4000, 'confirmed'),
    manRowDb('AMR-2', 'ADJ-PM', 'TCH-PM', '2026-12', 5000, 'adjusted', { admin_amount: 3500, admin_reason: 'Partial month' }),
    manRowDb('AMR-3', 'ADJ-PM', 'TCH-PM', '2026-10', 9999, 'pending'),
    manRowDb('AMR-4', 'ADJ-PM', 'TCH-PM', '2026-09', 2000, 'confirmed', { recovery_id: 'REC-OLD' }),
    manRowDb('AMR-5', 'ADJ-PM', 'TCH-PM', '2027-01', 3000, 'rejected')
  ];
  const map = JSON.parse(await run(`(async () => JSON.stringify(await window.PayrollAdvanceRecovery.loadLedger()))()`));
  const entry = map['TCH-PM'] && map['TCH-PM'][0];
  check('P loader: the manual entry carries ONLY decided + unconsumed submissions, keyed by period',
    !!entry && entry.manual_amounts['2026-11'] && entry.manual_amounts['2026-11'].amount === 4000 &&
    entry.manual_amounts['2026-12'] && entry.manual_amounts['2026-12'].amount === 3500 &&
    entry.manual_amounts['2026-12'].requested_amount === 5000 &&
    !entry.manual_amounts['2026-10'] && !entry.manual_amounts['2026-09'] && !entry.manual_amounts['2027-01'],
    JSON.stringify(entry && entry.manual_amounts));
  TABLES.salary_adjustments = [];
  TABLES.advance_manual_requests = [];
}

// ---- Planner: the manual branch ------------------------------------------
{
  const C = (rows, headroom, period) => JSON.parse(run(`JSON.stringify(window.PayrollAdvanceRecovery.compute(${JSON.stringify(rows)}, ${headroom}${period ? `, ${JSON.stringify(period)}` : ''}))`));
  const manEntry = {
    adjustment_id: 'ADJ-PM', remaining: 9000, recovery_per_month: 0, method: 'manual',
    manual_amounts: {
      '2026-11': { amount: 4000, requested_amount: 4000, manual_request_id: 'AMR-1' },
      '2026-12': { amount: 3500, requested_amount: 5000, manual_request_id: 'AMR-2' }
    }
  };
  const nov = C([manEntry], 30000, '2026-11');
  check('P plan: a confirmed submission plans its amount for ITS period (source manual)',
    nov.total === 4000 && nov.items.length === 1 && nov.items[0].source === 'manual' &&
    nov.items[0].requested_amount === 4000 && nov.items[0].manual_request_id === 'AMR-1' && nov.items[0].balance_after === 5000,
    JSON.stringify(nov));
  const dec = C([manEntry], 30000, '2026-12');
  check('P plan: an adjusted submission plans the ADMIN figure; requested_amount keeps the submitted one',
    dec.total === 3500 && dec.items[0].requested_amount === 5000, JSON.stringify(dec));
  check('P plan: a period with NO decided submission plans zero (Decision 7)',
    C([manEntry], 30000, '2027-01').total === 0);
  check('P plan: the Phase 3 call shape (no period argument) still plans zero for manual',
    C([manEntry], 30000).total === 0);
  check('P plan: the manual amount is capped by the slip headroom like any plan',
    C([manEntry], 2500, '2026-11').total === 2500);
  const fifo = C([
    { adjustment_id: 'ADJ-F', remaining: 4000, recovery_per_month: 2000, method: 'fixed', manual_amounts: {} },
    manEntry
  ], 5000, '2026-11');
  check('P plan: FIFO mixes auto + manual under one headroom (2000 auto + 3000 manual)',
    fifo.total === 5000 && fifo.items.length === 2 && fifo.items[0].amount === 2000 && fifo.items[0].source === 'auto' &&
    fifo.items[1].amount === 3000 && fifo.items[1].source === 'manual', JSON.stringify(fifo));
}

// ---- Compile integration across months -------------------------------------
function fixedTeacher(id, monthly) {
  return {
    id, full_name: 'Fixed ' + id, phone: '0300', status: 'Active', created_at: '2020-01-15T00:00:00',
    address: JSON.stringify({ employee_type: 'manager', monthly_salary: monthly, fixed_salary_history: [{ amount: monthly, effective_from: '2026-02', note: '', set_by: 'owner', set_at: '' }] })
  };
}
function resetCompile() {
  TABLES.teachers = []; TABLES.students = []; TABLES.class_schedules = []; TABLES.student_assignments = []; TABLES.salary_adjustments = []; TABLES.advance_manual_requests = [];
  ACCOUNTS = {}; store.clear(); FAKE_NOW = '2026-11-30T12:00:00'; MONTH = 'November 2026';
  sandbox.document.getElementById('salaryMonthSelect').value = MONTH;
}
async function compile() {
  sandbox.ALL_TEACHERS = TABLES.teachers;
  sandbox.ALL_STUDENTS = TABLES.students;
  sandbox.ALL_CLASS_SCHEDULES = TABLES.class_schedules;
  await run('calculateMonthlySalaries(true)');
  return run('ALL_TEACHER_SALARIES');
}
{
  resetCompile();
  TABLES.teachers = [fixedTeacher('FIX-PM', 30000)];
  TABLES.salary_adjustments = [planRow('ADJ-PM2', 'FIX-PM', 9000, 0, 'manual')];
  TABLES.advance_manual_requests = [manRowDb('AMR-C1', 'ADJ-PM2', 'FIX-PM', '2026-11', 4000, 'confirmed')];
  let slips = await compile();
  let s = slips['FIX-PM'];
  check('P compile: November slip deducts the confirmed manual amount; the plan item is sourced manual',
    !!s && Number(s.advance_deducted) === 4000 && Number(s.net_payable) === 26000 &&
    !!s.advance_recovery && s.advance_recovery.items.length === 1 && s.advance_recovery.items[0].source === 'manual',
    JSON.stringify(s && { a: s.advance_deducted, n: s.net_payable }));
  MONTH = 'December 2026'; sandbox.document.getElementById('salaryMonthSelect').value = MONTH;
  TABLES.advance_manual_requests = [manRowDb('AMR-C2', 'ADJ-PM2', 'FIX-PM', '2026-12', 5000, 'adjusted', { admin_amount: 3500, admin_reason: 'Partial month' })];
  slips = await compile();
  s = slips['FIX-PM'];
  check('P compile: December slip deducts the ADJUSTED amount (3500, not the submitted 5000)',
    !!s && Number(s.advance_deducted) === 3500 && Number(s.net_payable) === 26500,
    JSON.stringify(s && { a: s.advance_deducted, n: s.net_payable }));
  MONTH = 'January 2027'; sandbox.document.getElementById('salaryMonthSelect').value = MONTH;
  TABLES.advance_manual_requests = [];
  slips = await compile();
  s = slips['FIX-PM'];
  check('P compile: a month with NO submission deducts nothing (balance untouched)',
    !!s && Number(s.advance_deducted) === 0 && Number(s.net_payable) === 30000 && !s.advance_recovery);
}

// =====================================================================
// Part T — teacher.html manual section (real functions in a vm)
// =====================================================================
console.log('--- Part T: teacher manual section (flag-gated) ---');
function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
class FakeEl {
  constructor(id, classAttr, attrs, doc) {
    this.id = id || '';
    this._doc = doc || null;
    this._set = new Set(String(classAttr || '').split(/\s+/).filter(Boolean));
    this._attrs = attrs || {};
    this.style = {};
    this.value = '';
    this.innerText = '';
    this.disabled = false;
    this._html = '';
    this.parentElement = null;
    this.children = [];
    const self = this;
    this.classList = {
      add: (...cs) => cs.forEach((c) => self._set.add(c)),
      remove: (...cs) => cs.forEach((c) => self._set.delete(c)),
      toggle: (c, force) => {
        const want = force === undefined ? !self._set.has(c) : !!force;
        if (want) self._set.add(c); else self._set.delete(c);
        return want;
      },
      contains: (c) => self._set.has(c),
    };
  }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  set innerHTML(v) { this._html = String(v); if (this._doc) this._doc._registerFromHtml(this._html, this); }
  get innerHTML() { return this._html; }
  insertBefore(el, ref) { el.parentElement = this; this.children.push(el); if (this._doc && el.id) this._doc._register(el); return el; }
}
class FakeDoc {
  constructor() { this.registry = new Map(); this.loose = []; }
  _register(el) { if (el && el.id) this.registry.set(el.id, el); }
  _registerFromHtml(html, parent) {
    for (const m of String(html).matchAll(/<(\w+)([^>]*)>/g)) {
      const attrs = m[2];
      const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
      if (!id || this.registry.has(id)) continue;
      const cls = (attrs.match(/\bclass="([^"]*)"/) || [])[1] || '';
      const el = new FakeEl(id, cls, {}, this);
      el.parentElement = parent;
      this.registry.set(id, el);
    }
  }
  getElementById(id) { return this.registry.get(id) || null; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  createElement() { return new FakeEl('', '', {}, this); }
}
const TEACHER_FNS_T = ['_tAdvLabelOf', '_tAdvAuthHeaders', 'loadTeacherAdvanceRequests', 'buildTeacherManualSection',
  '_tManualPeriodOptions', 'renderTeacherManualSection', 'submitTeacherManualRepayment'];
const T_REQ_ROWS = [{
  id: 'ADV-T1', teacher_id: 'TCH-T', advance_type: 'custom', requested_amount: 9000, approved_amount: 9000,
  status: 'Approved', period: '2026-10', period_label: 'October 2026', requested_at: '2026-10-05T09:00:00Z',
  reason: null, reviewer_comment: null, repayment_method: 'manual', installment_amount: null, adjustment_id: 'ADJ-T1'
}];
const T_ADJ_ROWS = [{
  id: 'ADJ-T1', teacher_id: 'TCH-T', kind: 'advance', advance_remaining: 9000, recovery_per_month: 0,
  cancelled_at: null, period: '2026-10',
  legacy_json: JSON.stringify({
    advance_request_id: 'ADV-T1', repayment_method: 'manual', installment_amount: null,
    plan_changes: [{ from_method: 'fixed', from_installment: 2000, to_method: 'manual', to_installment: null, reason: 'Teacher asked to control it', changed_by: 'owner1', changed_at: '2026-11-02T10:00:00.000Z' }]
  })
}];
const T_MAN_ROWS = [
  { id: 'AMR-T2', teacher_id: 'TCH-T', adjustment_id: 'ADJ-T1', period: '2026-11', amount: 5000, status: 'adjusted', admin_amount: 3500, admin_reason: 'Partial month', applied_amount: null, recovery_id: null, created_at: '2026-11-03T09:00:00Z' },
  { id: 'AMR-T1', teacher_id: 'TCH-T', adjustment_id: 'ADJ-T1', period: '2026-10', amount: 2000, status: 'confirmed', admin_amount: null, admin_reason: null, applied_amount: 2000, recovery_id: 'REC-T1', created_at: '2026-10-04T09:00:00Z' }
];
function tChain(rows) {
  const p = Promise.resolve({ data: rows, error: null });
  return {
    select: () => tChain(rows), eq: () => tChain(rows), order: () => tChain(rows),
    then: (res, rej) => p.then(res, rej)
  };
}
function bootTeacherManual(flagMode) {
  const doc = new FakeDoc();
  const mk = (id) => { const el = new FakeEl(id, '', {}, doc); doc._register(el); return el; };
  const myList = mk('tAdvMyList');
  const card = new FakeEl('', '', {}, doc);
  const section = new FakeEl('', '', {}, doc);
  myList.parentElement = card;
  card.parentElement = section;
  const fetches = [];
  const notifies = [];
  const tables = { advance_requests: T_REQ_ROWS, salary_adjustments: T_ADJ_ROWS, advance_manual_requests: T_MAN_ROWS };
  const sb = {
    console,
    document: doc,
    FeeTables: {
      labelFromPeriod: (p) => ({ '2026-10': 'October 2026', '2026-11': 'November 2026' })[p] || p,
      periodFromLabel: (l) => ({ 'October 2026': '2026-10', 'November 2026': '2026-11' })[l] || null,
    },
    CURRENT_TEACHER: { id: 'TCH-T' },
    lmsNotify: (m) => notifies.push(String(m)),
    getTeacherWorkerBase: () => 'https://worker.test',
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null, setItem: () => {} },
    db: { from: (t) => tChain(tables[t] || []) },
    fetch: async (url, opts) => {
      fetches.push({ url: String(url), body: opts && opts.body });
      return { ok: true, status: 200, json: async () => ({ ok: true, manual_request: { id: 'AMR-NEW', status: 'pending' } }) };
    },
  };
  sb.window = sb;
  vm.createContext(sb);
  let prelude = 'let _TADV_MANUAL_SUBMITTING = false;\n';
  if (flagMode === 'on') prelude += 'var ADVANCE_MANUAL_SUBMISSIONS_ENABLED = true;\n';
  if (flagMode === 'off') prelude += 'var ADVANCE_MANUAL_SUBMISSIONS_ENABLED = false;\n';
  vm.runInContext(prelude + TEACHER_FNS_T.map((n) => extractFunction(TEACHER, n)).join('\n'), sb);
  return { sandbox: sb, doc, fetches, notifies };
}
const runT = (env, code) => vm.runInContext(code, env.sandbox);

check('T static: the shipped manual flag is ON (v8 Worker deploy verified live)', TEACHER.includes('const ADVANCE_MANUAL_SUBMISSIONS_ENABLED = true;'));
check('T static: no manual section exists in the static markup (script-built only)', !TEACHER.includes('id="tAdvManualSection"'));
check('T static: the section render is invoked only behind the flag guard',
  TEACHER.includes("typeof ADVANCE_MANUAL_SUBMISSIONS_ENABLED !== 'undefined') && ADVANCE_MANUAL_SUBMISSIONS_ENABLED"));

{ // Flag OFF (const not even declared — the Phase 3 harness shape):
  // nothing is built, nothing throws, Phase 3 list behaviour intact.
  const env = bootTeacherManual('absent');
  await runT(env, 'loadTeacherAdvanceRequests()');
  check('T off: no manual section is built while the flag is off', env.doc.getElementById('tAdvManualSection') === null);
  const listHtml = env.doc.getElementById('tAdvMyList').innerHTML;
  check('T off: the requests list still shows the remaining balance (Phase 3 behaviour)',
    listHtml.includes('remaining balance: 9,000 PKR'), listHtml.slice(0, 240));
  check('T off: the admin plan-change note still shows (data-driven, renders only when a change exists)',
    listHtml.includes('Plan changed by Administration') && listHtml.includes('Teacher asked to control it'), listHtml.slice(0, 300));
}
{ // Flag OFF declared false: same outcome.
  const env = bootTeacherManual('off');
  await runT(env, 'loadTeacherAdvanceRequests()');
  check('T off(false): no manual section is built', env.doc.getElementById('tAdvManualSection') === null);
}
{ // Flag ON (harness only): section, submitted-vs-final wording, submit.
  const env = bootTeacherManual('on');
  await runT(env, 'loadTeacherAdvanceRequests()');
  await new Promise((r) => setTimeout(r, 20));
  const section = env.doc.getElementById('tAdvManualSection');
  check('T on: the manual section is built into the Request page', !!section);
  const body = env.doc.getElementById('tAdvManualBody');
  const bodyHtml = body ? body.innerHTML : '';
  check('T on: the form shows the open manual balance', bodyHtml.includes('remaining balance: 9,000 PKR'), bodyHtml.slice(0, 240));
  check('T on: an adjusted submission shows submitted vs FINAL + the admin reason',
    bodyHtml.includes('Administration set the November 2026 deduction to 3,500 PKR (you submitted 5,000 PKR)') && bodyHtml.includes('Reason: Partial month'),
    bodyHtml.slice(0, 400));
  check('T on: an applied submission shows the amount actually deducted',
    bodyHtml.includes('Deducted from your October 2026 salary: 2,000 PKR'), bodyHtml.slice(0, 400));
  env.doc.getElementById('tManPeriod-ADJ-T1').value = '2026-11';
  env.doc.getElementById('tManAmount-ADJ-T1').value = '4500';
  await runT(env, "submitTeacherManualRepayment('ADJ-T1')");
  const call1 = env.fetches.find((f) => f.url.endsWith('/api/advances/manual-request'));
  check('T on: submitting posts { adjustment_id, period, amount } to the manual endpoint',
    !!call1 && call1.body === '{"adjustment_id":"ADJ-T1","period":"2026-11","amount":4500}',
    call1 ? String(call1.body) : 'no fetch');
  check('T on: the teacher is told the submission landed',
    env.notifies.some((m) => m.includes('Repayment submitted for November 2026')), env.notifies.join(' | '));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILURES: ' + failed.map((f) => f.name).join(' ; ')); process.exit(1); }
