// Salary Restructuring Phase 3 — plan-based advance ledger tests.
// Part W drives the REAL cloudflare/worker.js against a fake D1
// (node:sqlite) and proves the new money flow end to end:
//   - plan approval needs NO slip and NO current-net cap; the only cap
//     is the requested amount; approval writes ONE ledger row
//     (advance_remaining = approved, recovery_per_month per plan) and
//     touches no slip;
//   - POST /api/advances/apply-recovery distributes a finalized slip's
//     stored advance_deducted across outstanding balances (FIFO,
//     per-cycle caps, remaining caps), is idempotent, and refuses
//     bad actors/targets;
//   - legacy (plan-less) approval keeps the exact Batch B behaviour in
//     the same database.
// Part P executes the REAL js/payroll.js in a vm: the pure recovery
// planner, the compile's planned recovery (incl. net-headroom cap and
// saved-figure-wins), the manual plan's zero recovery, and the
// save -> apply-recovery sequencing against stubbed FeeTables/fetch.
// Run from the repo root:  node test/salary-advance-ledger.test.mjs
// Requires: node >= 22.5 (node:sqlite).
// All teachers, slips, and amounts below are SYNTHETIC test markers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// =====================================================================
// Part W — real Worker + FakeD1
// =====================================================================
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'saladv3-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = ['test', 'only', 'ledger', 'secret', '7'].join('-');
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
  teacherC: await createSessionToken({ sub: 'TCH-C', role: 'teacher' }, WORKER_SECRET),
  teacherD: await createSessionToken({ sub: 'TCH-D', role: 'teacher' }, WORKER_SECRET),
  teacherE: await createSessionToken({ sub: 'TCH-E', role: 'teacher' }, WORKER_SECRET),
  teacherF: await createSessionToken({ sub: 'TCH-F', role: 'teacher' }, WORKER_SECRET),
  teacherG: await createSessionToken({ sub: 'TCH-G', role: 'teacher' }, WORKER_SECRET),
  teacherL: await createSessionToken({ sub: 'TCH-L', role: 'teacher' }, WORKER_SECRET),
  teacherMgr: await createSessionToken({ sub: 'TCH-MGR-1', role: 'teacher' }, WORKER_SECRET),
};

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
const dbPost = (token, body) => call('https://worker.test/api/db', { token, body });

function seedTeacher(id, name, meta = {}) {
  fakeDb.seed('INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)',
    id, name, JSON.stringify({ salary_slips: {}, ...meta }), 'Active');
}
function seedSlip(id, teacherId, period, monthLabel, base, advanceDeducted, net, extra = {}) {
  fakeDb.seed(
    'INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, base_subtotal, bonus, deduction_total, advance_deducted, net_payable, status, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, teacherId, period, 'AH-SAL-' + period.replace('-', '') + '-' + id.slice(-4), monthLabel,
    base, 0, 0, advanceDeducted, net, 'Pending', extra.cancelled_at || null);
}
const adjOf = (teacherId) => fakeDb.q("SELECT * FROM salary_adjustments WHERE teacher_id = ? AND kind = 'advance' ORDER BY created_at ASC", teacherId);
const recoveriesOf = (teacherId) => fakeDb.q('SELECT * FROM advance_recoveries WHERE teacher_id = ? ORDER BY created_at ASC, adjustment_id ASC', teacherId);

// ---- Setup ---------------------------------------------------------------
{
  const h = await call('https://worker.test/api/health', { method: 'GET' });
  check('W setup: health reports the Phase 3 release + schema',
    h.status === 200 && h.data && h.data.version === '2026-11-10-teacher-self-reset' && h.data.schema === '2026-11-07-v8',
    h.text.slice(0, 200));
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('W setup: owner /api/db boot -> 200', r.status === 200, r.text.slice(0, 200));
  const t = fakeDb.q1("SELECT name FROM sqlite_master WHERE type='table' AND name='advance_recoveries'");
  check('W setup: advance_recoveries table created by schema boot', !!t);
  const u = fakeDb.q1("SELECT sql FROM sqlite_master WHERE type='table' AND name='advance_recoveries'");
  check('W setup: UNIQUE(slip_id, adjustment_id) is on the table', !!u && /UNIQUE/.test(u.sql) && u.sql.includes('slip_id') && u.sql.includes('adjustment_id'));
}
['TCH-A', 'TCH-C', 'TCH-D', 'TCH-E', 'TCH-F', 'TCH-G', 'TCH-H', 'TCH-L'].forEach((id) => seedTeacher(id, 'Teacher ' + id.slice(4)));
seedTeacher('TCH-MGR-1', 'Manager One', { employee_type: 'manager' });

// ---- Plan approval: no slip needed, no net cap, ledger row only ---------
let reqA1;
{
  // TCH-A has NO slip for 2026-10 at all.
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'custom', custom_amount: 8000, repayment_method: 'fixed', installment_amount: 2000 });
  check('W plan-req: plan request for a slip-less period is accepted (custom)', r.status === 200 && r.data && r.data.ok, r.text.slice(0, 200));
  reqA1 = r.data.request;
  const over = await advDecide(TOK.owner, { request_id: reqA1.id, decision: 'approved', approved_amount: 9000 });
  check('W plan-decide: approve MORE than requested is refused (400)', over.status === 400, over.text.slice(0, 160));
  const still = fakeDb.q1('SELECT status FROM advance_requests WHERE id = ?', reqA1.id);
  check('W plan-decide: refused approval leaves the request Pending, no ledger row',
    still && still.status === 'Pending' && adjOf('TCH-A').length === 0);
  const less = await advDecide(TOK.owner, { request_id: reqA1.id, decision: 'approved', approved_amount: 6000 });
  check('W plan-decide: approve LESS than requested succeeds without any slip',
    less.status === 200 && less.data && less.data.ok === true, less.text.slice(0, 200));
  check('W plan-decide: response carries the plan, and NO updated_slip',
    !!less.data.repayment_plan && less.data.repayment_plan.method === 'fixed' &&
    less.data.repayment_plan.recovery_per_month === 2000 && less.data.repayment_plan.advance_remaining === 6000 &&
    !('updated_slip' in less.data), JSON.stringify(less.data).slice(0, 220));
  const rows = adjOf('TCH-A');
  check('W plan-decide: exactly one ledger row, remaining = approved, rpm = installment',
    rows.length === 1 && Number(rows[0].advance_remaining) === 6000 && Number(rows[0].recovery_per_month) === 2000 && Number(rows[0].amount) === 6000,
    JSON.stringify(rows));
  const meta = JSON.parse(rows[0].legacy_json || '{}');
  check('W plan-decide: ledger meta carries the plan + request id FIRST key',
    meta.repayment_method === 'fixed' && meta.installment_amount === 2000 &&
    rows[0].legacy_json.startsWith('{"advance_request_id":"' + reqA1.id + '"'));
  const slips = fakeDb.q("SELECT id FROM salary_slips WHERE teacher_id = 'TCH-A'");
  check('W plan-decide: approval created NO slip and folded nothing', slips.length === 0);
}
{
  // Full plan + approve-less: rpm follows the APPROVED amount.
  const r = await advReq(TOK.teacherA, { period: '2026-11', advance_type: 'custom', custom_amount: 6000, repayment_method: 'full' });
  const d = await advDecide(TOK.owner, { request_id: r.data.request.id, decision: 'approved', approved_amount: 4500 });
  const rows = adjOf('TCH-A').filter((x) => x.period === '2026-11');
  check('W plan-decide: full plan approve-less -> remaining = rpm = approved amount',
    d.status === 200 && rows.length === 1 && Number(rows[0].advance_remaining) === 4500 && Number(rows[0].recovery_per_month) === 4500,
    JSON.stringify(rows));
  const replay = await advDecide(TOK.owner, { request_id: r.data.request.id, decision: 'approved' });
  check('W plan-decide: replayed approval is idempotent (no second ledger row)',
    replay.status === 200 && replay.data && replay.data.replayed === true && adjOf('TCH-A').length === 2);
  const flip = await advDecide(TOK.owner, { request_id: r.data.request.id, decision: 'rejected' });
  check('W plan-decide: decided request is terminal (flip -> 409)', flip.status === 409);
}
{
  // Bars survive for plan requests: teacher cannot decide; a manager
  // cannot decide a manager account's request; the owner can.
  const r = await advReq(TOK.teacherMgr, { period: '2026-10', advance_type: 'custom', custom_amount: 5000, repayment_method: 'fixed', installment_amount: 1000 });
  check('W plan-bars: manager-account teacher can request', r.status === 200 && r.data && r.data.ok, r.text.slice(0, 160));
  const byTeacher = await advDecide(TOK.teacherA, { request_id: r.data.request.id, decision: 'approved' });
  check('W plan-bars: a teacher token cannot decide (403)', byTeacher.status === 403);
  const byManager = await advDecide(TOK.manager, { request_id: r.data.request.id, decision: 'approved' });
  check('W plan-bars: a manager cannot decide a manager account request (403)', byManager.status === 403, byManager.text.slice(0, 160));
  const byOwner = await advDecide(TOK.owner, { request_id: r.data.request.id, decision: 'approved' });
  check('W plan-bars: the owner CAN approve a manager account plan request',
    byOwner.status === 200 && adjOf('TCH-MGR-1').length === 1 && Number(adjOf('TCH-MGR-1')[0].advance_remaining) === 5000);
}

// ---- Fixed lifecycle: 15,000 at 5,000/salary ----------------------------
let adjC;
{
  const r = await advReq(TOK.teacherC, { period: '2026-10', advance_type: 'custom', custom_amount: 15000, repayment_method: 'fixed', installment_amount: 5000 });
  const d = await advDecide(TOK.owner, { request_id: r.data.request.id, decision: 'approved' });
  check('W fixed: approval opens the 15,000 balance', d.status === 200 && adjOf('TCH-C').length === 1);
  adjC = adjOf('TCH-C')[0];
  check('W fixed: ledger row remaining 15000, rpm 5000', Number(adjC.advance_remaining) === 15000 && Number(adjC.recovery_per_month) === 5000);
}
seedSlip('SAL-C-11', 'TCH-C', '2026-11', 'November 2026', 40000, 5000, 35000);
seedSlip('SAL-C-12', 'TCH-C', '2026-12', 'December 2026', 40000, 5000, 35000);
seedSlip('SAL-C-01', 'TCH-C', '2027-01', 'January 2027', 40000, 5000, 35000);
seedSlip('SAL-C-02', 'TCH-C', '2027-02', 'February 2027', 40000, 5000, 35000);
{
  const a1 = await advRecover(TOK.owner, { slip_id: 'SAL-C-11' });
  check('W fixed: slip 1 recovers 5000, balance 10000',
    a1.status === 200 && a1.data.applied.length === 1 && a1.data.applied[0].amount === 5000 && a1.data.applied[0].balance_after === 10000 && a1.data.outstanding_total === 10000,
    a1.text.slice(0, 220));
  // Cross-teacher safety: TCH-H's slip claims an advance deduction but
  // TCH-H has no ledger rows — nothing may move anywhere.
  seedSlip('SAL-H-11', 'TCH-H', '2026-11', 'November 2026', 30000, 5000, 25000);
  const cross = await advRecover(TOK.owner, { slip_id: 'SAL-H-11' });
  check('W fixed: another teacher slip with no ledger rows moves nothing',
    cross.status === 200 && cross.data.applied.length === 0 && Number(adjOf('TCH-C')[0].advance_remaining) === 10000 && recoveriesOf('TCH-H').length === 0);
  const a2 = await advRecover(TOK.owner, { slip_id: 'SAL-C-12' });
  check('W fixed: slip 2 recovers 5000, balance 5000',
    a2.status === 200 && a2.data.applied.length === 1 && a2.data.applied[0].balance_after === 5000 && a2.data.outstanding_total === 5000);
  // Double finalization of slip 1 (replayed AFTER slip 2): pure replay.
  const replay = await advRecover(TOK.owner, { slip_id: 'SAL-C-11' });
  check('W fixed: re-applying slip 1 returns the recorded recovery and moves NOTHING',
    replay.status === 200 && replay.data.applied.length === 0 && replay.data.already_applied.length === 1 &&
    replay.data.already_applied[0].amount === 5000 && replay.data.already_applied[0].balance_after === 10000 &&
    Number(adjOf('TCH-C')[0].advance_remaining) === 5000 && recoveriesOf('TCH-C').length === 2,
    replay.text.slice(0, 220));
  const a3 = await advRecover(TOK.owner, { slip_id: 'SAL-C-01' });
  check('W fixed: slip 3 recovers the final 5000, balance 0',
    a3.status === 200 && a3.data.applied.length === 1 && a3.data.applied[0].balance_after === 0 && a3.data.outstanding_total === 0);
  const a4 = await advRecover(TOK.owner, { slip_id: 'SAL-C-02' });
  check('W fixed: NO fourth deduction once the balance is settled',
    a4.status === 200 && a4.data.applied.length === 0 && recoveriesOf('TCH-C').length === 3);
  const recs = recoveriesOf('TCH-C');
  check('W fixed: recovery rows carry slip/period/balance_after, source auto, requested_amount NULL',
    recs.length === 3 && recs.map((x) => Number(x.balance_after)).join(',') === '10000,5000,0' &&
    recs.every((x) => x.source === 'auto' && x.requested_amount === null && x.adjustment_id === adjC.id) &&
    recs.map((x) => x.period).join(',') === '2026-11,2026-12,2027-01');
}

// ---- Full plan with insufficient net: partial, remainder carries --------
{
  const r = await advReq(TOK.teacherD, { period: '2026-10', advance_type: 'custom', custom_amount: 20000, repayment_method: 'full' });
  await advDecide(TOK.owner, { request_id: r.data.request.id, decision: 'approved' });
  check('W full: approval of 20,000 full plan (no slip, no net cap)', adjOf('TCH-D').length === 1 && Number(adjOf('TCH-D')[0].advance_remaining) === 20000);
  // The finalized November slip could only deduct 12,000 (its whole
  // headroom — compile-side cap, proven in Part P): net exactly 0.
  seedSlip('SAL-D-11', 'TCH-D', '2026-11', 'November 2026', 12000, 12000, 0);
  const a1 = await advRecover(TOK.owner, { slip_id: 'SAL-D-11' });
  check('W full: partial recovery 12000 applied, remainder 8000 carries',
    a1.status === 200 && a1.data.applied.length === 1 && a1.data.applied[0].amount === 12000 && a1.data.applied[0].balance_after === 8000 && a1.data.outstanding_total === 8000,
    a1.text.slice(0, 220));
  const slip = fakeDb.q1('SELECT net_payable FROM salary_slips WHERE id = ?', 'SAL-D-11');
  check('W full: the slip net stays exactly 0 (endpoint never rewrites the slip)', Number(slip.net_payable) === 0);
  seedSlip('SAL-D-12', 'TCH-D', '2026-12', 'December 2026', 30000, 8000, 22000);
  const a2 = await advRecover(TOK.owner, { slip_id: 'SAL-D-12' });
  check('W full: next slip recovers the carried 8000, balance settled',
    a2.status === 200 && a2.data.applied.length === 1 && a2.data.applied[0].balance_after === 0 && a2.data.outstanding_total === 0);
}

// ---- Custom plan: final installment capped at remaining -----------------
{
  const r = await advReq(TOK.teacherE, { period: '2026-10', advance_type: 'custom', custom_amount: 7000, repayment_method: 'custom', installment_amount: 3000 });
  await advDecide(TOK.owner, { request_id: r.data.request.id, decision: 'approved' });
  seedSlip('SAL-E-11', 'TCH-E', '2026-11', 'November 2026', 30000, 3000, 27000);
  seedSlip('SAL-E-12', 'TCH-E', '2026-12', 'December 2026', 30000, 3000, 27000);
  seedSlip('SAL-E-01', 'TCH-E', '2027-01', 'January 2027', 30000, 3000, 27000);
  await advRecover(TOK.owner, { slip_id: 'SAL-E-11' });
  await advRecover(TOK.owner, { slip_id: 'SAL-E-12' });
  check('W custom: two installments of 3000 leave 1000', Number(adjOf('TCH-E')[0].advance_remaining) === 1000);
  const a3 = await advRecover(TOK.owner, { slip_id: 'SAL-E-01' });
  check('W custom: final recovery capped at the remaining 1000 even though the slip claims 3000',
    a3.status === 200 && a3.data.applied.length === 1 && a3.data.applied[0].amount === 1000 && a3.data.applied[0].balance_after === 0,
    a3.text.slice(0, 220));
}

// ---- Manual plan: balance stored, automatic recovery is zero ------------
{
  const r = await advReq(TOK.teacherF, { period: '2026-10', advance_type: 'custom', custom_amount: 9000, repayment_method: 'manual' });
  const d = await advDecide(TOK.owner, { request_id: r.data.request.id, decision: 'approved' });
  const rows = adjOf('TCH-F');
  check('W manual: approval stores the ledger row (remaining = approved, rpm = 0)',
    d.status === 200 && rows.length === 1 && Number(rows[0].advance_remaining) === 9000 && Number(rows[0].recovery_per_month) === 0,
    JSON.stringify(rows));
  seedSlip('SAL-F-11', 'TCH-F', '2026-11', 'November 2026', 30000, 0, 30000);
  const a1 = await advRecover(TOK.owner, { slip_id: 'SAL-F-11' });
  check('W manual: apply-recovery deducts 0 for a manual balance in Phase 3',
    a1.status === 200 && a1.data.applied.length === 0 && a1.data.outstanding_total === 9000 && recoveriesOf('TCH-F').length === 0);
}

// ---- Pending + rejected: no ledger row, no deduction --------------------
{
  const p = await advReq(TOK.teacherG, { period: '2026-10', advance_type: 'custom', custom_amount: 5000, repayment_method: 'fixed', installment_amount: 1000 });
  check('W pending: an undecided plan request creates no ledger row', p.status === 200 && adjOf('TCH-G').length === 0);
  const rj = await advReq(TOK.teacherG, { period: '2026-11', advance_type: 'custom', custom_amount: 4000, repayment_method: 'fixed', installment_amount: 1000 });
  const dec = await advDecide(TOK.owner, { request_id: rj.data.request.id, decision: 'rejected', reviewer_comment: 'Not now' });
  check('W rejected: rejection succeeds and moves no money',
    dec.status === 200 && adjOf('TCH-G').length === 0 && recoveriesOf('TCH-G').length === 0);
  seedSlip('SAL-G-11', 'TCH-G', '2026-11', 'November 2026', 25000, 0, 25000);
  const a = await advRecover(TOK.owner, { slip_id: 'SAL-G-11' });
  check('W pending/rejected: finalizing a slip for that teacher recovers nothing',
    a.status === 200 && a.data.applied.length === 0 && a.data.outstanding_total === 0);
}

// ---- apply-recovery refusals ---------------------------------------------
{
  const missing = await advRecover(TOK.owner, { slip_id: 'SAL-NOPE' });
  check('W refuse: nonexistent slip -> 404, nothing moves', missing.status === 404);
  const byTeacher = await advRecover(TOK.teacherC, { slip_id: 'SAL-C-11' });
  check('W refuse: a teacher token cannot apply recovery (403)', byTeacher.status === 403);
  seedSlip('SAL-TM-11', 'TCH-MGR-1', '2026-11', 'November 2026', 50000, 0, 50000);
  const mgrOnMgr = await advRecover(TOK.manager, { slip_id: 'SAL-TM-11' });
  check('W refuse: a manager cannot apply recovery on a manager account slip (403)', mgrOnMgr.status === 403, mgrOnMgr.text.slice(0, 160));
  const ownerOnMgr = await advRecover(TOK.owner, { slip_id: 'SAL-TM-11' });
  check('W refuse: the owner CAN finalize a manager slip (no rows to apply)',
    ownerOnMgr.status === 200 && ownerOnMgr.data.applied.length === 0);
  seedSlip('SAL-X-11', 'TCH-G', '2027-03', 'March 2027', 10000, 1000, 9000, { cancelled_at: '2026-11-20T00:00:00.000Z' });
  const cancelled = await advRecover(TOK.owner, { slip_id: 'SAL-X-11' });
  check('W refuse: a cancelled slip -> 422, nothing moves', cancelled.status === 422 && recoveriesOf('TCH-G').length === 0);
  const noId = await advRecover(TOK.owner, {});
  check('W refuse: missing slip_id -> 400', noId.status === 400);
}

// ---- Engine scoping for advance_recoveries --------------------------------
{
  const own = await dbPost(TOK.teacherC, { table: 'advance_recoveries', action: 'select', filters: [] });
  check('W scope: teacher reads advance_recoveries (own rows only)',
    own.status === 200 && own.data && Array.isArray(own.data.data) && own.data.data.length === 3 && own.data.data.every((r) => r.teacher_id === 'TCH-C'),
    own.text.slice(0, 200));
  const write = await dbPost(TOK.teacherC, { table: 'advance_recoveries', action: 'insert', values: { id: 'REC-FAKE', adjustment_id: 'X', slip_id: 'Y', teacher_id: 'TCH-C', period: '2026-11', amount: 1, balance_after: 0, source: 'auto' } });
  check('W scope: teacher INSERT into advance_recoveries is denied', write.status !== 200 || !(write.data && write.data.ok), write.text.slice(0, 160));
  check('W scope: the denied insert wrote nothing', recoveriesOf('TCH-C').length === 3);
}

// ---- Legacy coexistence: plan-less approval = exact Batch B --------------
{
  seedSlip('SAL-L-10', 'TCH-L', '2026-10', 'October 2026', 30000, 0, 30000);
  const r = await advReq(TOK.teacherL, { period: '2026-10', advance_type: 'custom', custom_amount: 10000 });
  check('W legacy: plan-less request carries NULL plan fields',
    r.status === 200 && r.data.request.repayment_method === null && r.data.request.installment_amount === null);
  const d = await advDecide(TOK.owner, { request_id: r.data.request.id, decision: 'approved' });
  check('W legacy: approval returns updated_slip (Batch B shape)',
    d.status === 200 && !!d.data.updated_slip && Number(d.data.updated_slip.advance_deducted) === 10000 && Number(d.data.updated_slip.net_payable) === 20000,
    d.text.slice(0, 220));
  const rows = adjOf('TCH-L');
  check('W legacy: adjustment settled immediately (remaining 0, recovery = full amount)',
    rows.length === 1 && Number(rows[0].advance_remaining) === 0 && Number(rows[0].recovery_per_month) === 10000);
  const slip = fakeDb.q1('SELECT advance_deducted, net_payable FROM salary_slips WHERE id = ?', 'SAL-L-10');
  check('W legacy: the period slip was folded at approval (same-period rule intact)',
    Number(slip.advance_deducted) === 10000 && Number(slip.net_payable) === 20000);
  check('W legacy: no recovery rows are written by a legacy approval', recoveriesOf('TCH-L').length === 0);
}

// =====================================================================
// Part P — real js/payroll.js in a vm
// =====================================================================
console.log('--- Part P: payroll compile + planner + save sequencing ---');
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
const TABLES = { teachers: [], students: [], class_schedules: [], courses: [], student_assignments: [], salary_adjustments: [] };
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
const fetchCalls = [];
let fetchResponder = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, applied: [], outstanding_total: 0 }) });
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
  fetch: async (url, opts) => { fetchCalls.push({ url: String(url), opts }); return fetchResponder(url, opts); },
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

// ---- Planner unit checks (the real compute function) ---------------------
{
  const C = (rows, headroom) => JSON.parse(run(`JSON.stringify(window.PayrollAdvanceRecovery.compute(${JSON.stringify(rows)}, ${headroom}))`));
  const fixed = [{ adjustment_id: 'ADJ-1', remaining: 15000, recovery_per_month: 5000, method: 'fixed' }];
  const p1 = C(fixed, 40000);
  check('P plan: fixed 15000 @ 5000 with ample headroom -> 5000, after 10000', p1.total === 5000 && p1.items[0].balance_after === 10000 && p1.outstanding_after === 10000);
  const p2 = C([{ adjustment_id: 'ADJ-1', remaining: 10000, recovery_per_month: 5000, method: 'fixed' }], 40000);
  const p3 = C([{ adjustment_id: 'ADJ-1', remaining: 5000, recovery_per_month: 5000, method: 'fixed' }], 40000);
  check('P plan: cycles 2 and 3 deduct 5000 each, balance reaches 0', p2.total === 5000 && p2.outstanding_after === 5000 && p3.total === 5000 && p3.outstanding_after === 0);
  check('P plan: a settled balance yields NO fourth deduction', C([], 40000).total === 0 && C([{ adjustment_id: 'ADJ-1', remaining: 0, recovery_per_month: 5000, method: 'fixed' }], 40000).total === 0);
  const full = C([{ adjustment_id: 'ADJ-2', remaining: 20000, recovery_per_month: 20000, method: 'full' }], 12000);
  check('P plan: full plan capped by headroom -> 12000 (net exactly 0), 8000 carries', full.total === 12000 && full.outstanding_after === 8000);
  const custom = C([{ adjustment_id: 'ADJ-3', remaining: 1000, recovery_per_month: 3000, method: 'custom' }], 9000);
  check('P plan: custom final installment capped at remaining', custom.total === 1000 && custom.items[0].balance_after === 0);
  check('P plan: manual plan (rpm 0) plans zero recovery', C([{ adjustment_id: 'ADJ-4', remaining: 9000, recovery_per_month: 0, method: 'manual' }], 30000).total === 0);
  const fifo = C([
    { adjustment_id: 'ADJ-A', remaining: 4000, recovery_per_month: 4000, method: 'full' },
    { adjustment_id: 'ADJ-B', remaining: 9000, recovery_per_month: 3000, method: 'fixed' }
  ], 5000);
  check('P plan: FIFO across two advances respects the shared headroom', fifo.total === 5000 && fifo.items.length === 2 && fifo.items[0].amount === 4000 && fifo.items[1].amount === 1000 && fifo.outstanding_after === 8000);
}

// ---- Ledger loader: only plan rows with a balance are loaded -------------
{
  TABLES.salary_adjustments = [
    { id: 'ADJ-P1', teacher_id: 'TCH-P', kind: 'advance', advance_remaining: 7000, recovery_per_month: 1000, cancelled_at: null, created_at: '2026-11-01T00:00:00.000Z', legacy_json: JSON.stringify({ advance_request_id: 'R1', repayment_method: 'fixed', installment_amount: 1000 }) },
    { id: 'ADJ-P2', teacher_id: 'TCH-P', kind: 'advance', advance_remaining: 0, recovery_per_month: 9000, cancelled_at: null, created_at: '2026-10-01T00:00:00.000Z', legacy_json: JSON.stringify({ advance_request_id: 'R0', advance_type: 'full', recovery_period: '2026-10' }) },
    { id: 'ADJ-P3', teacher_id: 'TCH-P', kind: 'advance', advance_remaining: 3000, recovery_per_month: 3000, cancelled_at: '2026-11-05T00:00:00.000Z', created_at: '2026-11-02T00:00:00.000Z', legacy_json: JSON.stringify({ advance_request_id: 'R2', repayment_method: 'full' }) },
    { id: 'ADJ-P4', teacher_id: 'TCH-P', kind: 'bonus', advance_remaining: 5000, recovery_per_month: 5000, cancelled_at: null, created_at: '2026-11-03T00:00:00.000Z', legacy_json: JSON.stringify({ repayment_method: 'full' }) }
  ];
  const map = JSON.parse(await run(`(async () => JSON.stringify(await window.PayrollAdvanceRecovery.loadLedger()))()`));
  check('P ledger: only the live plan row loads (settled legacy, cancelled, non-advance excluded)',
    !!map['TCH-P'] && map['TCH-P'].length === 1 && map['TCH-P'][0].adjustment_id === 'ADJ-P1' && map['TCH-P'][0].remaining === 7000,
    JSON.stringify(map));
  TABLES.salary_adjustments = [];
}

// ---- Compile integration (fixed-basis records, live branch) --------------
function fixedTeacher(id, monthly) {
  return {
    id, full_name: 'Fixed ' + id, phone: '0300', status: 'Active', created_at: '2020-01-15T00:00:00',
    address: JSON.stringify({ employee_type: 'manager', monthly_salary: monthly, fixed_salary_history: [{ amount: monthly, effective_from: '2026-02', note: '', set_by: 'owner', set_at: '' }] })
  };
}
function resetCompile() {
  TABLES.teachers = []; TABLES.students = []; TABLES.class_schedules = []; TABLES.student_assignments = []; TABLES.salary_adjustments = [];
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
const planRow = (id, teacherId, remaining, rpm, method) => ({
  id, teacher_id: teacherId, kind: 'advance', advance_remaining: remaining, recovery_per_month: rpm,
  cancelled_at: null, created_at: '2026-11-01T00:00:00.000Z',
  legacy_json: JSON.stringify({ advance_request_id: 'REQ-' + id, repayment_method: method, installment_amount: method === 'fixed' || method === 'custom' ? rpm : null })
});
{
  resetCompile();
  TABLES.teachers = [fixedTeacher('FIX-D', 12000)];
  TABLES.salary_adjustments = [planRow('ADJ-D', 'FIX-D', 20000, 20000, 'full')];
  const slips = await compile();
  const s = slips['FIX-D'];
  check('P compile: full plan + low salary -> advance_deducted = whole headroom, net exactly 0',
    !!s && Number(s.advance_deducted) === 12000 && Number(s.net_payable) === 0, JSON.stringify(s && { a: s.advance_deducted, n: s.net_payable }));
  check('P compile: the slip carries the recovery plan (8000 still outstanding after)',
    !!s.advance_recovery && s.advance_recovery.total === 12000 && s.advance_recovery.outstanding_after === 8000);
}
{
  resetCompile();
  TABLES.teachers = [fixedTeacher('FIX-C', 50000)];
  let remaining = 15000;
  const seen = [];
  for (const month of ['November 2026', 'December 2026', 'January 2027', 'February 2027']) {
    MONTH = month; sandbox.document.getElementById('salaryMonthSelect').value = month;
    TABLES.salary_adjustments = remaining > 0 ? [planRow('ADJ-C', 'FIX-C', remaining, 5000, 'fixed')] : [];
    const slips = await compile();
    const s = slips['FIX-C'];
    seen.push(Number(s.advance_deducted));
    remaining = Math.max(0, remaining - Number(s.advance_deducted));
  }
  check('P compile: fixed lifecycle across 4 months deducts 5000/5000/5000/0',
    seen.join(',') === '5000,5000,5000,0', seen.join(','));
}
{
  resetCompile();
  TABLES.teachers = [fixedTeacher('FIX-M', 30000)];
  TABLES.salary_adjustments = [planRow('ADJ-M', 'FIX-M', 9000, 0, 'manual')];
  const slips = await compile();
  const s = slips['FIX-M'];
  check('P compile: manual plan deducts 0, net untouched, no plan attached',
    !!s && Number(s.advance_deducted) === 0 && Number(s.net_payable) === 30000 && !s.advance_recovery);
}
{
  resetCompile();
  TABLES.teachers = [fixedTeacher('FIX-S', 50000)];
  TABLES.salary_adjustments = [planRow('ADJ-S', 'FIX-S', 15000, 5000, 'fixed')];
  store.set('alhuda_teacher_salaries', JSON.stringify({
    'FIX-S_November_2026': { teacher_id: 'FIX-S', month: 'November 2026', base_subtotal: 50000, bonus: 0, deduction: 0, advance_deducted: 7000, net_payable: 43000, status: 'Pending', student_items_snapshot: [] }
  }));
  const slips = await compile();
  const s = slips['FIX-S'];
  check('P compile: a saved advance figure wins over the plan (no double-count on recompile)',
    !!s && Number(s.advance_deducted) === 7000 && Number(s.net_payable) === 43000, JSON.stringify(s && { a: s.advance_deducted, n: s.net_payable }));
}

// ---- Save -> apply-recovery sequencing ------------------------------------
{
  resetCompile();
  TABLES.teachers = [fixedTeacher('FIX-Q', 50000)];
  TABLES.salary_adjustments = [planRow('ADJ-Q', 'FIX-Q', 15000, 5000, 'fixed')];
  const slips = await compile();
  const compiled = slips['FIX-Q'];
  check('P save: fixture compile plans a 5000 recovery', !!compiled && Number(compiled.advance_deducted) === 5000);
  run('CURRENT_SLIP_TEACHER_ID = "FIX-Q"');
  sandbox.CURRENT_SLIP_DATA = compiled;
  fetchCalls.length = 0;
  fetchResponder = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, applied: [{ adjustment_id: 'ADJ-Q', amount: 5000, balance_after: 10000 }], outstanding_total: 10000 }) });
  sandbox.window.FeeTables = {
    dualWriteSlip: async () => ({ ok: true, slipNo: 'AH-SAL-202611-QQQQQQ', row: { id: 'SAL-Q-11' } })
  };
  await run('saveSalarySlipRecord()');
  await new Promise((r) => setTimeout(r, 60));
  const recCalls = fetchCalls.filter((c) => c.url.endsWith('/api/advances/apply-recovery'));
  check('P save: after a successful table write, apply-recovery is called once with the slip row id',
    recCalls.length === 1 && JSON.parse(recCalls[0].opts.body).slip_id === 'SAL-Q-11' &&
    String(recCalls[0].opts.headers.Authorization || '').includes('fixture-owner-token'),
    JSON.stringify(fetchCalls.map((c) => c.url)));
  // A failed table write must NOT call apply-recovery.
  fetchCalls.length = 0;
  sandbox.window.FeeTables = { dualWriteSlip: async () => ({ ok: false, slipNo: null, row: null }) };
  await run('saveSalarySlipRecord()');
  await new Promise((r) => setTimeout(r, 60));
  check('P save: when the slip table write fails, apply-recovery is NEVER called',
    fetchCalls.filter((c) => c.url.endsWith('/api/advances/apply-recovery')).length === 0);
  // Zero-advance slip: no call either.
  fetchCalls.length = 0;
  sandbox.window.FeeTables = { dualWriteSlip: async () => ({ ok: true, slipNo: 'AH-SAL-202611-QQQQQQ', row: { id: 'SAL-Q-12' } }) };
  await run('window.applyAdvanceRecoveryAfterSlipSave("SAL-Q-12", 0)');
  check('P save: a slip with no advance deduction triggers no recovery call', fetchCalls.length === 0);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILURES: ' + failed.map((f) => f.name).join(' ; ')); process.exit(1); }
