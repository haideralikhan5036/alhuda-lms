// Batch 7 lifecycle test — Fix 1 (family deactivation persists):
//  A) the engine-level activation guard, driven through the REAL
//     cloudflare/worker.js + functions/api/db.js against a fake D1
//     (owner / manager / parent writers; family-first protocol passes;
//     notes-only parent writes keep working);
//  B) the client derivation + load-time write-back guard, by loading the
//     REAL js/config.js in a vm with a mock db (a stored Inactive family
//     is never flipped back to Active; aligning towards Inactive works);
//  C) the mirror one-time sync insert-if-absent rule, by loading the
//     REAL js/cloudflare-db.js in a vm with a mock fetch (existing D1
//     students/families are never overwritten by stale mirror rows).
// Run from the repo root:  node test/batch7-lifecycle.test.mjs
// Requires: node >= 22.5 (node:sqlite). All values below are SYNTHETIC.
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

// ============================================================================
// A) Engine guard through the Worker surface
// ============================================================================
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'batch7-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'batch7' + '-test-' + 'signing-key';
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
}
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: new FakeD1() };

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'MGR-1', role: 'manager' }, WORKER_SECRET),
  parentDead: await createSessionToken({ sub: 'FAM-DEAD', role: 'parent' }, WORKER_SECRET),
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
const GUARD_MSG = 'Reactivate the family before activating its students';

// ---- Seed -------------------------------------------------------------------
await dbPost(TOK.owner, { table: 'families', action: 'select' }); // boots ensureSchema
let r = await dbPost(TOK.owner, { table: 'teachers', action: 'insert', values: { id: 'MGR-1', full_name: 'Test Manager', address: JSON.stringify({ employee_type: 'manager', emp_id: 'MGR-1' }) } });
check('seed manager row', r.status === 200, r.text.slice(0, 160));
r = await dbPost(TOK.owner, { table: 'families', action: 'insert', values: { id: 'FAM-LIVE', parent_name: 'Live Family', status: 'Active', notes: '{}' } });
check('seed active family', r.status === 200, r.text.slice(0, 160));
r = await dbPost(TOK.owner, { table: 'families', action: 'insert', values: { id: 'FAM-DEAD', parent_name: 'Dead Family', status: 'Inactive', notes: '{}' } });
check('seed deactivated family', r.status === 200, r.text.slice(0, 160));

// ---- Insert guard -------------------------------------------------------------
r = await dbPost(TOK.owner, { table: 'students', action: 'insert', values: { id: 'STU-BLOCKED-1', family_id: 'FAM-DEAD', name: 'Blocked Kid', status: 'Active', notes: '{}' } });
check('owner INSERT Active student into deactivated family -> 403', r.status === 403 && r.text.includes(GUARD_MSG), String(r.status) + ' ' + r.text.slice(0, 160));
r = await dbPost(TOK.owner, { table: 'students', action: 'select', filters: eq('id', 'STU-BLOCKED-1') });
check('blocked insert created NO row', rows(r).length === 0);

r = await dbPost(TOK.owner, { table: 'students', action: 'insert', values: { id: 'STU-BLOCKED-2', family_id: 'FAM-DEAD', name: 'No Status Kid', notes: '{}' } });
check('owner INSERT student with status omitted (defaults Active) into deactivated family -> 403', r.status === 403 && r.text.includes(GUARD_MSG), String(r.status) + ' ' + r.text.slice(0, 160));

r = await dbPost(TOK.owner, { table: 'students', action: 'insert', values: { id: 'STU-DEAD-1', family_id: 'FAM-DEAD', name: 'Quiet Kid', status: 'Inactive', notes: '{}' } });
check('owner INSERT Inactive student into deactivated family -> 200', r.status === 200, r.text.slice(0, 160));

r = await dbPost(TOK.owner, { table: 'students', action: 'insert', values: { id: 'STU-LIVE-1', family_id: 'FAM-LIVE', name: 'Live Kid', status: 'Active', notes: '{}' } });
check('owner INSERT Active student into ACTIVE family -> 200', r.status === 200, r.text.slice(0, 160));

// ---- Update guard ---------------------------------------------------------------
r = await dbPost(TOK.owner, { table: 'students', action: 'update', values: { status: 'Active' }, filters: eq('id', 'STU-DEAD-1') });
check('owner UPDATE student to Active inside deactivated family -> 403', r.status === 403 && r.text.includes(GUARD_MSG), String(r.status) + ' ' + r.text.slice(0, 160));
r = await dbPost(TOK.owner, { table: 'students', action: 'select', filters: eq('id', 'STU-DEAD-1') });
check('blocked update left the student Inactive', rows(r).length === 1 && rows(r)[0].status === 'Inactive');

r = await dbPost(TOK.owner, { table: 'students', action: 'update', values: { status: 'Leave' }, filters: eq('id', 'STU-DEAD-1') });
check("UPDATE to 'Leave' (counts as active) inside deactivated family -> 403", r.status === 403, String(r.status) + ' ' + r.text.slice(0, 120));

r = await dbPost(TOK.manager, { table: 'students', action: 'update', values: { status: 'Active' }, filters: eq('id', 'STU-DEAD-1') });
check('MANAGER update to Active inside deactivated family -> 403 (guard is role-independent)', r.status === 403 && r.text.includes(GUARD_MSG), String(r.status) + ' ' + r.text.slice(0, 160));

r = await dbPost(TOK.owner, { table: 'students', action: 'update', values: { notes: '{"leave_request":{"reason":"test"}}' }, filters: eq('id', 'STU-DEAD-1') });
check('notes-only UPDATE (no status key) inside deactivated family -> 200', r.status === 200, r.text.slice(0, 160));

// ---- Upsert guard -----------------------------------------------------------------
r = await dbPost(TOK.owner, { table: 'students', action: 'upsert', values: { id: 'STU-BLOCKED-3', family_id: 'FAM-DEAD', name: 'Mirror Kid', status: 'Active', notes: '{}' } });
check('owner UPSERT Active student into deactivated family -> 403', r.status === 403 && r.text.includes(GUARD_MSG), String(r.status) + ' ' + r.text.slice(0, 160));

// ---- Parent writers -----------------------------------------------------------------
r = await dbPost(TOK.parentDead, { table: 'students', action: 'update', values: { notes: '{"leave_request":{"reason":"parent leave"}}' }, filters: eq('id', 'STU-DEAD-1') });
check('PARENT notes-only update on own child in deactivated family -> 200 (leave flow keeps working)', r.status === 200, String(r.status) + ' ' + r.text.slice(0, 160));
r = await dbPost(TOK.parentDead, { table: 'students', action: 'update', values: { status: 'Active' }, filters: eq('id', 'STU-DEAD-1') });
check('PARENT update of own child to Active inside deactivated family -> 403 guard', r.status === 403 && r.text.includes(GUARD_MSG), String(r.status) + ' ' + r.text.slice(0, 160));

// ---- Authorized family-first protocol passes -----------------------------------------
r = await dbPost(TOK.owner, { table: 'families', action: 'update', values: { status: 'Active' }, filters: eq('id', 'FAM-DEAD') });
check('step 1 of protocol: family row set Active -> 200', r.status === 200, r.text.slice(0, 160));
r = await dbPost(TOK.owner, { table: 'students', action: 'update', values: { status: 'Active' }, filters: eq('id', 'STU-DEAD-1') });
check('step 2 of protocol: student activation now passes -> 200', r.status === 200, r.text.slice(0, 160));
r = await dbPost(TOK.owner, { table: 'students', action: 'select', filters: eq('id', 'STU-DEAD-1') });
check('student is Active after the protocol', rows(r).length === 1 && rows(r)[0].status === 'Active');

// ============================================================================
// B) config.js derivation + load-time write-back guard (vm, mock db)
// ============================================================================
const CONFIG_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/config.js'), 'utf8');
{
  const calls = { updates: [], deletes: [] };
  const stuActive = { id: 'STU-C1', family_id: 'FAM-C1', name: 'Active Kid', status: 'Active', notes: '{}' };
  const stuInactive = { id: 'STU-C2', family_id: 'FAM-C2', name: 'Quiet Kid', status: 'Inactive', notes: '{}' };
  const canned = {
    families: [
      { id: 'FAM-C1', parent_name: 'Stored Dead', status: 'Inactive', whatsapp: '111', notes: '{}', students: [stuActive] },
      { id: 'FAM-C2', parent_name: 'Derived Dead', status: 'Active', whatsapp: '222', notes: '{}', students: [stuInactive] },
    ],
    students: [stuActive, stuInactive],
    teachers: [{ id: 'TCH-C1', full_name: 'Teacher C' }],
    class_schedules: [],
  };
  function builder(table) {
    const b = {
      _updateVals: null, _eq: null,
      select() { return b; },
      order() { return b; },
      update(vals) { b._updateVals = vals; return b; },
      delete() { calls.deletes.push({ table }); return b; },
      eq(col, val) { if (b._updateVals) calls.updates.push({ table, values: b._updateVals, col, val }); b._eq = [col, val]; return b; },
      then(res) { res({ data: b._updateVals ? [] : (canned[table] || []), error: null }); },
    };
    return b;
  }
  const storageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 };
  // The sandbox IS the window (as in a browser, where the var-declared
  // globals and window.* are the same object).
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    supabase: { createClient: () => ({ from: (t) => builder(t) }) },
    localStorage: storageStub,
    sessionStorage: storageStub,
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
    innerWidth: 800,
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(CONFIG_SRC, sandbox);
  const W = sandbox;

  check('config.js exposes isFamilyDeactivated', typeof W.isFamilyDeactivated === 'function');
  check('derivation: stored Inactive family with an Active student is DEACTIVATED (authoritative)',
    W.isFamilyDeactivated({ id: 'FAM-X', status: 'Inactive', students: [{ id: 'STU-X', family_id: 'FAM-X', status: 'Active', notes: '{}' }] }) === true);
  check('derivation: Active family with ALL students inactive is deactivated (derivation still adds)',
    W.isFamilyDeactivated({ id: 'FAM-Y', status: 'Active', students: [{ id: 'STU-Y', family_id: 'FAM-Y', status: 'Inactive', notes: '{}' }] }) === true);
  check('derivation: Active family with an Active student is NOT deactivated',
    W.isFamilyDeactivated({ id: 'FAM-Z', status: 'Active', students: [{ id: 'STU-Z', family_id: 'FAM-Z', status: 'Active', notes: '{}' }] }) === false);

  await W.ensureCoreLmsDataLoaded({ force: true });
  const activeFlips = calls.updates.filter(u => u.table === 'families' && u.values && u.values.status === 'Active');
  check('load-time write-back NEVER writes families status Active', activeFlips.length === 0, JSON.stringify(calls.updates));
  const inactiveWrites = calls.updates.filter(u => u.table === 'families' && u.values && u.values.status === 'Inactive' && u.val === 'FAM-C2');
  check('load-time write-back still aligns towards Inactive (FAM-C2)', inactiveWrites.length === 1, JSON.stringify(calls.updates));
  const famC1 = (W.ALL_FAMILIES || []).find(f => f.id === 'FAM-C1');
  check('in-memory FAM-C1 stays Inactive after load', !!famC1 && famC1.status === 'Inactive', famC1 && famC1.status);
  const famC2 = (W.ALL_FAMILIES || []).find(f => f.id === 'FAM-C2');
  check('in-memory FAM-C2 becomes Inactive after load', !!famC2 && famC2.status === 'Inactive', famC2 && famC2.status);
}

// ============================================================================
// C) cloudflare-db.js mirror sync insert-if-absent (vm, mock fetch)
// ============================================================================
const CFDB_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/cloudflare-db.js'), 'utf8');
{
  const mirror = {
    families: [{ id: 'FAM-EXIST', parent_name: 'Stale Family', status: 'Active' }],
    students: [
      { id: 'STU-EXIST', family_id: 'FAM-EXIST', name: 'Stale Student', status: 'Active' },
      { id: 'STU-NEW', family_id: 'FAM-EXIST', name: 'New Student', status: 'Active' },
    ],
    teachers: [{ id: 'TCH-M1', full_name: 'Mirror Teacher' }],
    class_schedules: [], attendance_logs: [], payments: [], salary_slips: [],
    salary_adjustments: [], leave_requests: [], trial_students: [], system_settings: [],
  };
  const lsData = new Map([['alhuda_cloudflare_local_db_v1', JSON.stringify(mirror)]]);
  const localStorageStub = {
    getItem: (k) => (lsData.has(k) ? lsData.get(k) : null),
    setItem: (k, v) => { lsData.set(k, String(v)); },
    removeItem: (k) => { lsData.delete(k); },
    key: (i) => [...lsData.keys()][i] || null,
    get length() { return lsData.size; },
  };
  const sessionStub = { getItem: () => 'tok', setItem: () => {}, removeItem: () => {} };
  const posts = [];
  async function mockFetch(url, options = {}) {
    const method = options.method || 'GET';
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ ok: true, d1_bound: true }) };
    }
    const body = JSON.parse(options.body || '{}');
    posts.push(body);
    if (body.action === 'select' && body.table === 'students') return { ok: true, status: 200, json: async () => ({ data: [{ id: 'STU-EXIST' }], error: null }) };
    if (body.action === 'select' && body.table === 'families') return { ok: true, status: 200, json: async () => ({ data: [{ id: 'FAM-EXIST' }], error: null }) };
    if (body.action === 'select') return { ok: true, status: 200, json: async () => ({ data: [{ id: 'TCH-M1', full_name: 'Mirror Teacher' }], error: null }) };
    return { ok: true, status: 200, json: async () => ({ data: [], error: null }) };
  }
  class FakeCustomEvent { constructor(type) { this.type = type; } }
  const windowObj = {
    localStorage: localStorageStub,
    sessionStorage: sessionStub,
    location: { hostname: 'test.local' },
    addEventListener: () => {},
    dispatchEvent: () => true,
  };
  const sandbox = {
    window: windowObj, console, setTimeout, clearTimeout,
    localStorage: localStorageStub, sessionStorage: sessionStub,
    document: { addEventListener: () => {}, hidden: true },
    fetch: mockFetch, CustomEvent: FakeCustomEvent,
    AbortController, Blob: class {}, URL: { createObjectURL: () => '' }, FileReader: class {},
  };
  sandbox.globalThis = sandbox;
  windowObj.window = windowObj;
  vm.runInNewContext(CFDB_SRC, sandbox);

  // A normal select triggers the probe; the probe success kicks off the
  // one-time sync (unawaited) — poll until its upserts have been captured.
  await windowObj.db.from('teachers').select('*');
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (posts.some(p => p.action === 'upsert' && p.table === 'teachers')) break;
    await new Promise(res => setTimeout(res, 25));
  }
  const stuUpserts = posts.filter(p => p.action === 'upsert' && p.table === 'students');
  check('mirror sync pushed students at all', stuUpserts.length === 1, JSON.stringify(posts.map(p => p.table + ':' + p.action)));
  const pushedStuIds = stuUpserts.length ? (stuUpserts[0].values || []).map(x => x.id) : [];
  check('existing D1 student NOT overwritten by the mirror (STU-EXIST filtered out)', !pushedStuIds.includes('STU-EXIST'), JSON.stringify(pushedStuIds));
  check('genuinely new mirror student IS pushed (STU-NEW)', pushedStuIds.includes('STU-NEW'), JSON.stringify(pushedStuIds));
  const famUpserts = posts.filter(p => p.action === 'upsert' && p.table === 'families');
  check('families upsert skipped entirely when the only mirror family already exists in D1', famUpserts.length === 0, JSON.stringify(famUpserts));
  const tchUpserts = posts.filter(p => p.action === 'upsert' && p.table === 'teachers');
  check('other tables keep the old behaviour (teachers upserted)', tchUpserts.length === 1 && (tchUpserts[0].values || []).some(x => x.id === 'TCH-M1'));
  check('migration flag set after the sync', lsData.get('alhuda_d1_initial_sync_done_v1') === 'true');
}

const failed = results.filter((x) => !x.pass);
console.log('---');
console.log(`batch7-lifecycle: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
