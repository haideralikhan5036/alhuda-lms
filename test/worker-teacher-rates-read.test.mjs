// Salary Commission #2 Phase 3b (2026-11-05): the teacher portal's
// live salary card prices the teacher's own month from the central
// course rates, so a teacher may READ the single course_rates_v1
// system_settings key — the same single-key allowlist pattern as the
// announcements key (PR #84). Everything else stays exactly as locked
// as before: teacher writes denied, other keys denied, parents do NOT
// gain the rates key, and the assignment ledger stays denied to
// teachers. Drives the REAL Worker via the house harness.
// Run from the repo root:  node test/worker-teacher-rates-read.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rates-read-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = ['test', 'worker', 'secret', '42'].join('-');
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
}
class FakeR2 {
  constructor() { this._map = new Map(); }
  async get(key) { const v = this._map.get(key); if (!v) return null; return { body: v, httpMetadata: { contentType: 'image/png' }, httpEtag: '"fake"' }; }
  async put(key, body) { this._map.set(key, typeof body === 'string' ? body : 'bytes'); return { key }; }
}

const fakeDb = new FakeD1();
const fakeR2 = new FakeR2();
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, DB: fakeDb, STORAGE: fakeR2 };

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function call(pathname, { token = null, body = null, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request('https://worker.test' + pathname, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}
const dbPost = (token, body) => call('/api/db', { token, body });
const eq = (column, value) => [{ column, op: 'eq', value }];

const TOK = {
  owner: await createSessionToken({ sub: 'Faheem', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'T-MGR', role: 'manager' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'T-A', role: 'teacher' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};

{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: schema boot -> 200', boot.status === 200, 'got ' + boot.status);
}
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-A', 'Teacher A', 'Active')");
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-MGR', 'Manager One', 'Active')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES ('ST-1', 'FAM-1', 'Child One', 'T-A')");
const RATES_JSON = JSON.stringify({ version: 1, weekend_rate: 3200, basic_salary_pkr: 20000, courses: [{ id: 'crs-noorani-qaida', name: 'Noorani Qaida', monthly_rate: 2200, active: true, aliases: [] }] });
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('SYS-COURSE-RATES', 'course_rates_v1', ?)", RATES_JSON);
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('SYS-ACADEMY-PROFILE', 'academy_profile_v1', '{\"name\":\"Al-Huda Islamic Centre\"}')");
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('SYS-LOGO', 'alhuda_logo', 'data:image/png;base64,xx')");

// ---- The new read ----
{
  const t = await dbPost(TOK.teacher, { table: 'system_settings', action: 'select', filters: eq('key', 'course_rates_v1') });
  check('teacher CAN read the course_rates_v1 row', t.status === 200 && ((t.json.data || []).length) === 1 && String(t.json.data[0].value || '').includes('Noorani Qaida'), 'status ' + t.status + ' rows ' + ((t.json.data || []).length));
  const m = await dbPost(TOK.manager, { table: 'system_settings', action: 'select', filters: eq('key', 'course_rates_v1') });
  check('manager still CAN read course_rates_v1 (no regression)', m.status === 200 && ((m.json.data || []).length) === 1, 'status ' + m.status + ' rows ' + ((m.json.data || []).length));
}

// ---- Everything else stays locked ----
{
  const tp = await dbPost(TOK.teacher, { table: 'system_settings', action: 'select', filters: eq('key', 'academy_profile_v1') });
  check('teacher still CANNOT read academy_profile_v1', ((tp.json.data || []).length) === 0, 'rows ' + ((tp.json.data || []).length));
  const tl = await dbPost(TOK.teacher, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_logo') });
  check('teacher still CANNOT read other keys (logo)', ((tl.json.data || []).length) === 0, 'rows ' + ((tl.json.data || []).length));
  const p = await dbPost(TOK.parent, { table: 'system_settings', action: 'select', filters: eq('key', 'course_rates_v1') });
  check('parent does NOT gain the rates key', ((p.json.data || []).length) === 0, 'rows ' + ((p.json.data || []).length));
  const w = await dbPost(TOK.teacher, { table: 'system_settings', action: 'upsert', values: { id: 'SYS-COURSE-RATES', key: 'course_rates_v1', value: '{}' } });
  check('teacher WRITE to system_settings still denied', w.status === 403 || (w.json && w.json.ok === false), 'status ' + w.status);
  const ledger = await dbPost(TOK.teacher, { table: 'student_assignments', action: 'select' });
  check('teacher read of the assignment ledger still denied', ledger.status === 403 || ((ledger.json.data || []).length) === 0, 'status ' + ledger.status);
  const h = await call('/api/health', { method: 'GET' });
  check('health still reports the slots release + schema v5', h.status === 200 && h.json && h.json.version === '2026-11-06-course-delete' && h.json.schema === '2026-11-05-v5', 'got ' + (h.json && h.json.version) + '/' + (h.json && h.json.schema));
}

const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
