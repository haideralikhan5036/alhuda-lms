// Batch 6B worker test — financial tables (payments / salary_slips /
// salary_adjustments): schema, plain-INSERT uniqueness, DELETE rejection,
// the full role access matrix, manager legacy_json blanking, manager salary
// invisibility, and the fee_tables_v1 flag read/write split.
// Drives the REAL cloudflare/worker.js + functions/api/db.js against a fake
// D1 backed by Node's built-in SQLite (node:sqlite).
// Run from the repo root:  node test/batch6b-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite). All values below are SYNTHETIC.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'batch6b-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'batch6b' + '-test-' + 'signing-key';
const ORIGIN = 'https://alhuda-lms.vercel.app';
const CONTACT_MARKER = 'CONTACT-MARKER-6B-SYNTHETIC';

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
}
const fakeDb = new FakeD1();
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: fakeDb };

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'MGR-1', role: 'manager' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'TCH-1', role: 'teacher' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};

async function dbPost(token, body) {
  const req = new Request('https://worker.test/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, json };
}
const rows = (r) => (r.json && r.json.data) || [];
const eq = (column, value) => [{ column, op: 'eq', value }];

// ---- Seed: schema boot + staff + families (as owner) -----------------------
await dbPost(TOK.owner, { table: 'families', action: 'select' }); // boots ensureSchema
let r = await dbPost(TOK.owner, { table: 'teachers', action: 'insert', values: { id: 'TCH-1', full_name: 'Test Teacher', address: JSON.stringify({ employee_type: 'teacher' }) } });
check('seed teacher row', r.status === 200, r.text.slice(0, 200));
r = await dbPost(TOK.owner, { table: 'teachers', action: 'insert', values: { id: 'MGR-1', full_name: 'Test Manager', address: JSON.stringify({ employee_type: 'manager', emp_id: 'MGR-1' }) } });
check('seed manager row', r.status === 200, r.text.slice(0, 200));
r = await dbPost(TOK.owner, { table: 'families', action: 'insert', values: { id: 'FAM-1', parent_name: 'Family One', notes: '{}' } });
check('seed family 1', r.status === 200, r.text.slice(0, 200));
r = await dbPost(TOK.owner, { table: 'families', action: 'insert', values: { id: 'FAM-2', parent_name: 'Family Two', notes: '{}' } });
check('seed family 2', r.status === 200, r.text.slice(0, 200));

// ---- payments: insert + plain-INSERT uniqueness ----------------------------
const legacyJson = JSON.stringify({ receiptNo: 'AH-REC-20261022-TST001', whatsapp: CONTACT_MARKER, amountPaid: 100 });
r = await dbPost(TOK.owner, { table: 'payments', action: 'insert', values: { family_id: 'FAM-1', receipt_no: 'AH-REC-20261022-TST001', amount_paid: 100, billing_period: '2026-10', legacy_json: legacyJson, legacy_source: 'fee_form' } });
check('owner inserts payment with new columns', r.status === 200, r.text.slice(0, 200));
const payId = rows(r)[0] && rows(r)[0].id;
check('payment id carries PAY- prefix', typeof payId === 'string' && payId.startsWith('PAY-'), String(payId));

r = await dbPost(TOK.owner, { table: 'payments', action: 'insert', values: { family_id: 'FAM-2', receipt_no: 'AH-REC-20261022-TST001', amount_paid: 999 } });
check('duplicate receipt_no (different id) rejected 409', r.status === 409, String(r.status) + ' ' + r.text.slice(0, 160));
check('duplicate error message is the clear one', r.text.includes('Duplicate receipt number'), r.text.slice(0, 160));
r = await dbPost(TOK.owner, { table: 'payments', action: 'select' });
const pays = rows(r);
check('first payment NOT overwritten by the duplicate attempt', pays.length === 1 && Number(pays[0].amount_paid) === 100 && pays[0].family_id === 'FAM-1', JSON.stringify(pays).slice(0, 200));

r = await dbPost(TOK.owner, { table: 'payments', action: 'insert', values: { receipt_no: 'AH-REC-NOFAM-1', amount_paid: 5 } });
check('payment without family_id rejected 400', r.status === 400 && r.text.includes('family_id is required'), String(r.status) + ' ' + r.text.slice(0, 160));

r = await dbPost(TOK.owner, { table: 'payments', action: 'insert', values: { family_id: 'FAM-2', receipt_no: 'AH-REC-FAM2-001', amount_paid: 50, billing_period: '2026-10' } });
check('second family payment inserts', r.status === 200, r.text.slice(0, 160));

// ---- DELETE rejected for every role ----------------------------------------
r = await dbPost(TOK.owner, { table: 'payments', action: 'delete', filters: eq('id', payId) });
check('owner DELETE on payments denied', r.status >= 400, String(r.status));
r = await dbPost(TOK.manager, { table: 'payments', action: 'delete', filters: eq('id', payId) });
check('manager DELETE on payments denied', r.status >= 400, String(r.status));
r = await dbPost(TOK.owner, { table: 'payments', action: 'select', filters: eq('id', payId) });
check('payment still exists after DELETE attempts', rows(r).length === 1);

// ---- salary_slips: uniqueness + upsert -------------------------------------
r = await dbPost(TOK.owner, { table: 'salary_slips', action: 'insert', values: { teacher_id: 'TCH-1', period: '2026-10', slip_no: 'AH-SAL-202610-TST001', base_subtotal: 5000, net_payable: 5000, status: 'Pending' } });
check('owner inserts teacher slip', r.status === 200, r.text.slice(0, 200));
const slipId = rows(r)[0] && rows(r)[0].id;
check('slip id carries SAL- prefix', typeof slipId === 'string' && slipId.startsWith('SAL-'), String(slipId));

r = await dbPost(TOK.owner, { table: 'salary_slips', action: 'insert', values: { teacher_id: 'TCH-1', period: '2026-10', slip_no: 'AH-SAL-202610-OTHER1', net_payable: 1 } });
check('duplicate (teacher_id, period) rejected 409 with clear message', r.status === 409 && r.text.includes('A slip already exists for this teacher and month'), String(r.status) + ' ' + r.text.slice(0, 160));
r = await dbPost(TOK.owner, { table: 'salary_slips', action: 'select', filters: eq('teacher_id', 'TCH-1') });
check('first slip intact after duplicate attempt', rows(r).length === 1 && Number(rows(r)[0].net_payable) === 5000);

r = await dbPost(TOK.owner, { table: 'salary_slips', action: 'insert', values: { teacher_id: 'TCH-1', period: '2026-11', slip_no: 'AH-SAL-202610-TST001', net_payable: 1 } });
check('duplicate slip_no rejected 409', r.status === 409 && r.text.includes('A slip already exists for this teacher and month'), String(r.status) + ' ' + r.text.slice(0, 160));

r = await dbPost(TOK.owner, { table: 'salary_slips', action: 'upsert', values: { id: slipId, teacher_id: 'TCH-1', period: '2026-10', slip_no: 'AH-SAL-202610-TST001', net_payable: 6500, status: 'Paid', paid_at: '2026-10-31T00:00:00.000Z' } });
check('financial upsert with existing id updates in place', r.status === 200, r.text.slice(0, 160));
r = await dbPost(TOK.owner, { table: 'salary_slips', action: 'select', filters: eq('id', slipId) });
check('upsert updated the same row (net 6500, Paid)', rows(r).length === 1 && Number(rows(r)[0].net_payable) === 6500 && rows(r)[0].status === 'Paid');

r = await dbPost(TOK.owner, { table: 'salary_slips', action: 'insert', values: { teacher_id: 'MGR-1', period: '2026-10', slip_no: 'AH-SAL-202610-MGR001', net_payable: 9000, status: 'Pending' } });
check('owner inserts manager slip (seed)', r.status === 200, r.text.slice(0, 160));
const mgrSlipId = rows(r)[0] && rows(r)[0].id;

r = await dbPost(TOK.owner, { table: 'salary_slips', action: 'delete', filters: eq('id', slipId) });
check('owner DELETE on salary_slips denied', r.status >= 400, String(r.status));

// ---- salary_adjustments ------------------------------------------------------
r = await dbPost(TOK.owner, { table: 'salary_adjustments', action: 'insert', values: { teacher_id: 'TCH-1', period: '2026-10', kind: 'deduction', amount: 500, legacy_json: JSON.stringify({ id: 'DED-TST-1' }) } });
check('owner inserts adjustment', r.status === 200, r.text.slice(0, 160));
const adjId = rows(r)[0] && rows(r)[0].id;
check('adjustment id carries ADJ- prefix', typeof adjId === 'string' && adjId.startsWith('ADJ-'), String(adjId));
r = await dbPost(TOK.owner, { table: 'salary_adjustments', action: 'insert', values: { teacher_id: 'MGR-1', period: '2026-10', kind: 'deduction', amount: 700, legacy_json: JSON.stringify({ id: 'DED-TST-MGR' }) } });
check('owner inserts manager adjustment (seed)', r.status === 200, r.text.slice(0, 160));
r = await dbPost(TOK.manager, { table: 'salary_adjustments', action: 'delete', filters: eq('id', adjId) });
check('manager DELETE on salary_adjustments denied', r.status >= 400, String(r.status));

// cancel via UPDATE (the allowed path) works on financial tables
r = await dbPost(TOK.owner, { table: 'salary_adjustments', action: 'update', values: { status: 'Cancelled', cancel_reason: 'entered twice' }, filters: eq('id', adjId) });
check('cancel via UPDATE works on adjustments', r.status === 200, r.text.slice(0, 160));

// ---- Access matrix -----------------------------------------------------------
r = await dbPost(TOK.manager, { table: 'salary_slips', action: 'select' });
const mgrSeen = rows(r).map((x) => x.teacher_id);
check('manager sees teacher slips', mgrSeen.includes('TCH-1'), JSON.stringify(mgrSeen));
check('manager does NOT see manager slips (incl. his own)', !mgrSeen.includes('MGR-1'), JSON.stringify(mgrSeen));

r = await dbPost(TOK.manager, { table: 'salary_adjustments', action: 'select' });
const mgrAdj = rows(r).map((x) => x.teacher_id);
check('manager sees teacher adjustments only', mgrAdj.includes('TCH-1') && !mgrAdj.includes('MGR-1'), JSON.stringify(mgrAdj));

r = await dbPost(TOK.manager, { table: 'salary_slips', action: 'insert', values: { teacher_id: 'MGR-1', period: '2026-11', slip_no: 'AH-SAL-202611-MGR002', net_payable: 1 } });
check('manager insert of a manager slip rejected 403', r.status === 403, String(r.status) + ' ' + r.text.slice(0, 160));
check('manager-slip write rejection message is exact', r.text.includes('Managers cannot create or edit salary records for manager accounts.'), r.text.slice(0, 200));

r = await dbPost(TOK.manager, { table: 'salary_slips', action: 'update', values: { net_payable: 1 }, filters: eq('id', mgrSlipId) });
check('manager update of a manager slip (id only, no teacher_id) rejected 403', r.status === 403 && r.text.includes('Managers cannot create or edit salary records for manager accounts.'), String(r.status) + ' ' + r.text.slice(0, 160));

r = await dbPost(TOK.manager, { table: 'salary_slips', action: 'insert', values: { teacher_id: 'TCH-1', period: '2026-11', slip_no: 'AH-SAL-202611-TCH002', net_payable: 4000 } });
check('manager CAN insert a teacher slip', r.status === 200, r.text.slice(0, 160));

r = await dbPost(TOK.manager, { table: 'payments', action: 'select' });
check('manager payments response contains NO contact marker anywhere', !r.text.includes(CONTACT_MARKER));
check('manager payments rows have legacy_json blanked', rows(r).length >= 1 && rows(r).every((x) => x.legacy_json === null), r.text.slice(0, 200));
r = await dbPost(TOK.owner, { table: 'payments', action: 'select', filters: eq('id', payId) });
check('owner payments response DOES include legacy_json', r.text.includes(CONTACT_MARKER), r.text.slice(0, 160));

r = await dbPost(TOK.teacher, { table: 'salary_slips', action: 'select' });
const tchSeen = rows(r);
check('teacher sees ONLY own slips', tchSeen.length >= 1 && tchSeen.every((x) => x.teacher_id === 'TCH-1'), JSON.stringify(tchSeen.map((x) => x.teacher_id)));
r = await dbPost(TOK.teacher, { table: 'salary_slips', action: 'insert', values: { teacher_id: 'TCH-1', period: '2027-01', slip_no: 'AH-SAL-202701-TCH003' } });
check('teacher insert on salary_slips denied', r.status >= 400, String(r.status));
r = await dbPost(TOK.teacher, { table: 'payments', action: 'select' });
check('teacher payments denied', r.status >= 400, String(r.status));

r = await dbPost(TOK.parent, { table: 'payments', action: 'select' });
const parPays = rows(r);
check('parent sees ONLY own family payments', parPays.length === 1 && parPays[0].family_id === 'FAM-1', JSON.stringify(parPays.map((x) => x.family_id)));
r = await dbPost(TOK.parent, { table: 'payments', action: 'insert', values: { family_id: 'FAM-1', receipt_no: 'AH-REC-PAR-1' } });
check('parent insert on payments denied', r.status >= 400, String(r.status));
r = await dbPost(TOK.parent, { table: 'salary_slips', action: 'select' });
check('parent salary_slips denied', r.status >= 400, String(r.status));

// ---- fee_tables_v1 flag split ------------------------------------------------
r = await dbPost(TOK.owner, { table: 'system_settings', action: 'upsert', values: { key: 'fee_tables_v1', value: 'on' } });
check('owner can set fee_tables_v1', r.status === 200, r.text.slice(0, 160));
r = await dbPost(TOK.owner, { table: 'system_settings', action: 'upsert', values: { key: 'unrelated_key_6b', value: 'x' } });
check('owner can set an unrelated settings key (seed)', r.status === 200, r.text.slice(0, 160));
r = await dbPost(TOK.manager, { table: 'system_settings', action: 'select', filters: eq('key', 'fee_tables_v1') });
check('manager CAN read fee_tables_v1', rows(r).length === 1 && rows(r)[0].value === 'on', r.text.slice(0, 200));
r = await dbPost(TOK.manager, { table: 'system_settings', action: 'select', filters: eq('key', 'unrelated_key_6b') });
check('manager can NOT read unrelated settings keys', rows(r).length === 0, r.text.slice(0, 160));
r = await dbPost(TOK.manager, { table: 'system_settings', action: 'upsert', values: { key: 'fee_tables_v1', value: 'off' } });
check('manager can NOT write fee_tables_v1', r.status >= 400, String(r.status) + ' ' + r.text.slice(0, 120));

const failed = results.filter((x) => !x.pass);
console.log('---');
console.log(`batch6b-worker: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
