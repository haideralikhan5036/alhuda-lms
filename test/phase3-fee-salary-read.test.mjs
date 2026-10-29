// Phase 3.1 (fee/salary read path) — tests for P1-5, P1-7/6D-3, P2-13, P2-14.
// Part A drives the REAL cloudflare/worker.js (via a temp ESM copy) against
// a fake D1 backed by Node's built-in SQLite: parent/teacher/manager reads
// of the three finance read-switch flags, write denials, and teacher
// salary_slips scoping. Part B loads js/fee-tables.js in a vm with a mock
// db client: loadSlipsForTeacher, unionTableWithLegacy, diffSlipLists.
// Part C is structural: teacher.html loads fee-tables.js after
// cloudflare-db.js, profiles360.js uses the union helper.
// Run from the repo root:  node test/phase3-fee-salary-read.test.mjs
// Requires: node >= 22.5 (node:sqlite). All "passwords" below are
// synthetic test markers, never real credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'phase31-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'phase31-test-secret';
const ORIGIN = 'https://alhuda-lms.vercel.app';
const OWNER_USER = 'owner-test';
const OWNER_PW = 'Owner-Strong-99';

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
  seed(sql, ...params) { this._db.prepare(sql).run(...params); }
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

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${cond ? '' : ' :: ' + String(detail || '').slice(0, 300)}`);
}
const eq = (column, value) => [{ column, op: 'eq', value }];
const rows = (r) => (r.json && r.json.data) || [];

async function call(pathname, { token = null, body = null, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request('https://worker.test' + pathname, {
    method, headers, body: body === null ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, json };
}
const dbPost = (token, body) => call('/api/db', { token, body });

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-P31', role: 'parent' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'TCH-P31', role: 'teacher' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR31', role: 'manager' }, WORKER_SECRET),
};

// ---- Boot schema + seeds ----------------------------------------------------
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('schema boot', r.status === 200, r.text.slice(0, 200));
}
fakeDb.seed('INSERT INTO families (id, parent_name, status, notes) VALUES (?, ?, ?, ?)',
  'FAM-P31', 'Test Parent', 'Active', JSON.stringify({ portal_credentials: { username: 'fam31' } }));
fakeDb.seed('INSERT INTO teachers (id, full_name, address) VALUES (?, ?, ?)',
  'TCH-P31', 'Test Teacher', JSON.stringify({ username: 'teach31' }));
fakeDb.seed('INSERT INTO teachers (id, full_name, address) VALUES (?, ?, ?)',
  'TCH-MGR31', 'Test Manager', JSON.stringify({ username: 'mgr31', employee_type: 'manager', emp_id: 'MGR-901' }));
fakeDb.seed('INSERT INTO teachers (id, full_name, address) VALUES (?, ?, ?)',
  'TCH-OTHER', 'Other Teacher', JSON.stringify({ username: 'teachother' }));
for (const [id, key, value] of [
  ['SYS-P1', 'fee_read_parent', 'on'],
  ['SYS-P2', 'fee_read_360', 'compare'],
  ['SYS-P3', 'salary_read_v1', 'on'],
  ['SYS-P4', 'alhuda_custom_books', '[]'],
  ['SYS-P5', 'alhuda_logo', 'logo-url'],
  ['SYS-P6', 'some_other_key', 'sensitive-ish'],
]) {
  fakeDb.seed('INSERT INTO system_settings (id, key, value) VALUES (?, ?, ?)', id, key, value);
}
fakeDb.seed('INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, net_payable, status, legacy_key, legacy_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  'SAL-P1', 'TCH-P31', '2026-01', 'AH-SAL-202601-ABCDEF', 'January 2026', 50000, 'Paid', 'TCH-P31_January_2026', JSON.stringify({ student_items_snapshot: [] }));
fakeDb.seed('INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, net_payable, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
  'SAL-P2', 'TCH-OTHER', '2026-01', 'AH-SAL-202601-GHIJKL', 'January 2026', 40000, 'Paid');

// ==== Part A1: P1-5 — parent flag reads ======================================
{
  const r1 = await dbPost(TOK.parent, { table: 'system_settings', action: 'select', filters: eq('key', 'fee_read_parent') });
  check('P1-5 parent reads fee_read_parent -> 1 row, on', r1.status === 200 && rows(r1).length === 1 && rows(r1)[0].value === 'on', r1.text.slice(0, 200));
  const r2 = await dbPost(TOK.parent, { table: 'system_settings', action: 'select', filters: eq('key', 'fee_read_360') });
  check('P1-5 parent reads fee_read_360 -> 1 row, compare', r2.status === 200 && rows(r2).length === 1 && rows(r2)[0].value === 'compare', r2.text.slice(0, 200));
  const r3 = await dbPost(TOK.parent, { table: 'system_settings', action: 'select', filters: eq('key', 'salary_read_v1') });
  check('P1-5 parent reads salary_read_v1 -> 1 row, on', r3.status === 200 && rows(r3).length === 1 && rows(r3)[0].value === 'on', r3.text.slice(0, 200));
  const r4 = await dbPost(TOK.parent, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_custom_books') });
  check('P1-5 parent catalog key still readable', r4.status === 200 && rows(r4).length === 1, r4.text.slice(0, 200));
  const r5 = await dbPost(TOK.parent, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_logo') });
  check('P1-5 parent logo still dropped', r5.status === 200 && rows(r5).length === 0, r5.text.slice(0, 200));
  const r6 = await dbPost(TOK.parent, { table: 'system_settings', action: 'select', filters: eq('key', 'some_other_key') });
  check('P1-5 parent other key still dropped', r6.status === 200 && rows(r6).length === 0, r6.text.slice(0, 200));
  const r7 = await dbPost(TOK.parent, { table: 'system_settings', action: 'select' });
  const keys7 = rows(r7).map((row) => row.key);
  check('P1-5 parent unfiltered select returns only catalog + flag keys',
    r7.status === 200 && !keys7.includes('alhuda_logo') && !keys7.includes('some_other_key') &&
    keys7.includes('fee_read_parent') && keys7.includes('alhuda_custom_books'), JSON.stringify(keys7));
  const w1 = await dbPost(TOK.parent, { table: 'system_settings', action: 'update', values: { value: 'off' }, filters: eq('key', 'fee_read_parent') });
  check('P1-5 parent flag write still denied', w1.status !== 200, w1.text.slice(0, 200));
  const w2 = await dbPost(TOK.parent, { table: 'system_settings', action: 'insert', values: { id: 'SYS-ATTACK', key: 'fee_read_parent', value: 'on' } });
  check('P1-5 parent flag insert still denied', w2.status !== 200, w2.text.slice(0, 200));
}

// ==== Part A2: teacher + manager flag reads, teacher slip scope =============
{
  const t1 = await dbPost(TOK.teacher, { table: 'system_settings', action: 'select', filters: eq('key', 'salary_read_v1') });
  check('6D-3 teacher reads salary_read_v1 -> 1 row, on', t1.status === 200 && rows(t1).length === 1 && rows(t1)[0].value === 'on', t1.text.slice(0, 200));
  const t2 = await dbPost(TOK.teacher, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_logo') });
  check('6D-3 teacher logo still dropped', t2.status === 200 && rows(t2).length === 0, t2.text.slice(0, 200));
  const t3 = await dbPost(TOK.teacher, { table: 'salary_slips', action: 'select', filters: eq('teacher_id', 'TCH-P31') });
  check('6D-3 teacher reads own slip -> 1 row, slip_no matches', t3.status === 200 && rows(t3).length === 1 && rows(t3)[0].slip_no === 'AH-SAL-202601-ABCDEF', t3.text.slice(0, 200));
  const t4 = await dbPost(TOK.teacher, { table: 'salary_slips', action: 'select', filters: eq('teacher_id', 'TCH-OTHER') });
  check('6D-3 teacher cannot read another teacher slip', t4.status === 200 && rows(t4).length === 0, t4.text.slice(0, 200));
  const m1 = await dbPost(TOK.manager, { table: 'system_settings', action: 'select', filters: eq('key', 'fee_read_360') });
  check('P1-5 manager reads fee_read_360 -> 1 row, compare', m1.status === 200 && rows(m1).length === 1 && rows(m1)[0].value === 'compare', m1.text.slice(0, 200));
  const m2 = await dbPost(TOK.manager, { table: 'system_settings', action: 'select', filters: eq('key', 'salary_read_v1') });
  check('P1-5 manager reads salary_read_v1 -> 1 row, on', m2.status === 200 && rows(m2).length === 1 && rows(m2)[0].value === 'on', m2.text.slice(0, 200));
  const m3 = await dbPost(TOK.manager, { table: 'system_settings', action: 'select', filters: eq('key', 'some_other_key') });
  check('P1-5 manager other key still dropped', m3.status === 200 && rows(m3).length === 0, m3.text.slice(0, 200));
  const m4 = await dbPost(TOK.manager, { table: 'system_settings', action: 'update', values: { value: 'off' }, filters: eq('key', 'fee_read_360') });
  check('P1-5 manager flag write still denied (catalog-gated)', m4.status !== 200, m4.text.slice(0, 200));
}

// ==== Part B: fee-tables helpers in a vm =====================================
{
  const CODE = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-tables.js'), 'utf8');
  function makeMockDb({ slipRows = [], failSelect = false } = {}) {
    const calls = [];
    function from(table) {
      const state = { filters: [] };
      const b = {
        select() { return b; },
        eq(col, val) { state.filters.push([col, val]); return b; },
        limit() { return b; },
        then(resolve, reject) {
          try {
            calls.push(table + ':select');
            if (failSelect) { resolve({ data: null, error: { message: 'mock select failure' } }); return; }
            let out = table === 'salary_slips' ? slipRows : [];
            out = out.filter((row) => state.filters.every(([c, v]) => String(row[c]) === String(v)));
            resolve({ data: out.map((r) => ({ ...r })), error: null });
          } catch (e) { reject(e); }
        },
      };
      return b;
    }
    return { from, calls };
  }
  const sandbox = {
    window: {},
    console,
    JSON, Object, Array, String, Number, Math, Date, parseFloat, parseInt, isFinite,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);
  const FT = sandbox.window.FeeTables;
  check('B fee-tables exposes 6D-3 helpers', !!FT && typeof FT.loadSlipsForTeacher === 'function' && typeof FT.unionTableWithLegacy === 'function' && typeof FT.diffSlipLists === 'function');

  // unionTableWithLegacy (P2-13)
  const tableRecs = [{ receiptNo: 'R1', amountPaid: 100 }, { amountPaid: 5 }];
  const legacyRecs = [{ receiptNo: 'R1', amountPaid: 99 }, { receiptNo: 'R2', amountPaid: 50 }];
  const u = FT.unionTableWithLegacy(tableRecs, legacyRecs, 'FAM-1');
  check('P2-13 union keeps table row on key conflict', u.length === 3 && u[0].amountPaid === 100, JSON.stringify(u));
  check('P2-13 union appends legacy-only receipt', u.some((r) => r.receiptNo === 'R2'), JSON.stringify(u));
  check('P2-13 union keeps numberless table row', u.some((r) => !r.receiptNo && r.amountPaid === 5), JSON.stringify(u));
  const uEmpty = FT.unionTableWithLegacy([], legacyRecs, 'FAM-1');
  check('P2-13 empty table list falls back to legacy receipts', uEmpty.length === 2, JSON.stringify(uEmpty));
  const uCase = FT.unionTableWithLegacy([{ receiptNo: 'ah-rec-1' }], [{ receiptNo: 'AH-REC-1' }], 'FAM-1');
  check('P2-13 dedup key is case-insensitive on receiptNo', uCase.length === 1, JSON.stringify(uCase));

  // diffSlipLists (6D-3 compare)
  const d = FT.diffSlipLists(
    [{ slip_key: 'T1_January_2026', status: 'Paid', net_payable: 100, month: 'January 2026' }],
    [{ slip_key: 'T1_January_2026', status: 'Pending', net_payable: 100, month: 'January 2026' },
     { slip_key: 'T1_February_2026', status: 'Paid', net_payable: 50, month: 'February 2026' }],
  );
  check('6D-3 diff reports blob-only slip as missingInTable', d.missingInTable.length === 1 && d.missingInTable[0] === 'T1_February_2026', JSON.stringify(d));
  check('6D-3 diff reports status change', d.changed.length === 1 && d.changed[0].field === 'status' && d.changed[0].table === 'Paid', JSON.stringify(d));
  check('6D-3 diff reports no missingInBlob when table is a subset', d.missingInBlob.length === 0, JSON.stringify(d));
  const d2 = FT.diffSlipLists(
    [{ slip_key: 'T1_January_2026', status: 'Paid', net_payable: 100 }, { slip_key: 'T1_March_2026', status: 'Paid', net_payable: 70 }],
    [{ slip_key: 'T1_January_2026', status: 'Paid', net_payable: 100 }],
  );
  check('6D-3 diff reports table-only slip as missingInBlob', d2.missingInBlob.length === 1 && d2.missingInBlob[0] === 'T1_March_2026', JSON.stringify(d2));

  // loadSlipsForTeacher (6D-3 read)
  const slipRow = {
    teacher_id: 'T1', slip_no: 'AH-SAL-202601-ABCDEF', status: 'Paid', net_payable: 50000,
    month_label: 'January 2026', legacy_key: 'T1_January_2026',
    legacy_json: JSON.stringify({ student_items_snapshot: [{ name: 'Kid', final_rate: 100 }] }),
  };
  sandbox.db = makeMockDb({ slipRows: [slipRow, { teacher_id: 'T2', slip_no: 'OTHER', status: 'Paid' }] });
  const slips = await FT.loadSlipsForTeacher('T1');
  check('6D-3 loadSlipsForTeacher returns legacy shape for own rows only',
    Array.isArray(slips) && slips.length === 1 && slips[0].slip_key === 'T1_January_2026' &&
    slips[0].net_payable === 50000 && slips[0].slip_no === 'AH-SAL-202601-ABCDEF' &&
    Array.isArray(slips[0].student_items_snapshot), JSON.stringify(slips));
  sandbox.db = makeMockDb({ slipRows: [slipRow], failSelect: true });
  const slipsFail = await FT.loadSlipsForTeacher('T1');
  check('6D-3 loadSlipsForTeacher failure -> null (caller falls back)', slipsFail === null, JSON.stringify(slipsFail));
  delete sandbox.db;
  const slipsNoDb = await FT.loadSlipsForTeacher('T1');
  check('6D-3 loadSlipsForTeacher without db client -> null', slipsNoDb === null, JSON.stringify(slipsNoDb));
}

// ==== Part C: structural guards ==============================================
{
  const TEACHER_HTML = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
  check('C teacher.html loads fee-tables.js after cloudflare-db.js',
    TEACHER_HTML.indexOf('js/cloudflare-db.js') > -1 && TEACHER_HTML.indexOf('js/fee-tables.js') > TEACHER_HTML.indexOf('js/cloudflare-db.js'));
  // Salary-advance workflow (Batch B) deliberately changed this: the
  // teacher's OWN voucher list no longer consults the salary_read_v1
  // flag (default off) — that flag-gated read was the preview's
  // staleness root cause (an admin edit landing in the ungated store
  // stayed invisible). The list now always merges the table + blob
  // stores newest-wins via FeeTables.mergeSlipLists. The flag itself
  // still exists (fee-tables.js READ_FLAG_SALARY + diffSlipLists) and
  // still gates the Family 360 / admin compare paths; only the
  // teacher's own list is ungated. The worker flag allowlist check
  // below is unchanged.
  check('C teacher.html salary list merges table + blob newest-wins (flag ungated for own list)',
    TEACHER_HTML.includes('loadSlipsForTeacher') && TEACHER_HTML.includes('mergeSlipLists') && !/loadTeacherPreviousSalaries[\s\S]{0,4000}getReadMode/.test(TEACHER_HTML));
  const P360 = fs.readFileSync(path.join(REPO_ROOT, 'js/profiles360.js'), 'utf8');
  check('C profiles360 360 list uses unionTableWithLegacy', P360.includes('unionTableWithLegacy'));
  const WORKER = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare/worker.js'), 'utf8');
  check('C worker defines the shared fee-read flag allowlist', WORKER.includes('isFeeReadFlagKey') && WORKER.includes("k === 'fee_read_parent'") && WORKER.includes("k === 'salary_read_v1'"));
  check('C worker release is the commission release (2026-10-29-announcements)', WORKER.includes("const WORKER_RELEASE = '2026-10-29-announcements'"));
}

const failed = results.filter((r) => !r.pass);
console.log(`\nPhase 3.1 fee/salary read tests: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('Failures: ' + failed.map((f) => f.name).join(' | '));
  process.exitCode = 1;
}
fakeDb.close();
