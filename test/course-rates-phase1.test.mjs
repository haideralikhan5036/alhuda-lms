// Course Payment Settings — Phase 1 (owner commission 2026-11-03, design
// proposal SALARY-ASSIGNMENT-DESIGN-PROPOSAL-2026-11-03 as updated by the
// owner: Tajweed rate 2500; the generic "Tafseer-ul-Quran" catalogue entry
// removed — its name maps to English Tafseer at the same 4500 the old
// substring rule produced; Basic Salary minimum 20000 added to settings).
// Phase 1 = the central settings store + settings screen + ONE unified
// course list feeding the Add Student / Trial / 360-Edit dropdowns.
// Student records keep storing the course NAME; the payroll engine is NOT
// touched in this phase (it adopts the catalogue in Phase 2).
// Drives the REAL Worker for the read/write scope of the new settings key
// and EXECUTES js/course-catalogue.js in a vm for the catalogue logic.
// Run from the repo root:  node test/course-rates-phase1.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-secret-' + 'x'.repeat(48);
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
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'T-A', role: 'teacher' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};

{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: schema boot -> 200', boot.status === 200, 'got ' + boot.status);
}
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('TCH-MGR-1', 'Manager One', 'Active')");
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-A', 'Teacher A', 'Active')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
const RATES_JSON = JSON.stringify({ version: 1, weekend_rate: 3200, basic_salary_pkr: 20000, courses: [{ id: 'crs-tajweed', name: 'Advanced Tajweed Rules', monthly_rate: 2500, active: true, aliases: ['Tajweed'] }] });
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('SYS-COURSE-RATES', 'course_rates_v1', ?)", RATES_JSON);
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('SYS-LOGO', 'alhuda_logo', 'data:image/png;base64,xx')");

// ---- Worker scope for the new key ----
{
  const m = await dbPost(TOK.manager, { table: 'system_settings', action: 'select', filters: eq('key', 'course_rates_v1') });
  check('manager CAN read the course_rates_v1 row', m.status === 200 && ((m.json.data || []).length) === 1 && String(m.json.data[0].value || '').includes('crs-tajweed'), 'status ' + m.status + ' rows ' + ((m.json.data || []).length));
  const t = await dbPost(TOK.teacher, { table: 'system_settings', action: 'select', filters: eq('key', 'course_rates_v1') });
  // SUPERSEDED 2026-11-05 (Salary Commission #2 Phase 3b): teachers MAY
  // now read this one key — the teacher portal's live salary card prices
  // the teacher's own month from these central rates. Writes and all
  // other keys stay denied (see test/worker-teacher-rates-read.test.mjs).
  check('teacher CAN read course_rates_v1 (Commission #2 Phase 3b)', t.status === 200 && ((t.json.data || []).length) === 1, 'rows ' + ((t.json.data || []).length));
  const p = await dbPost(TOK.parent, { table: 'system_settings', action: 'select', filters: eq('key', 'course_rates_v1') });
  check('parent CANNOT read course_rates_v1', ((p.json.data || []).length) === 0, 'rows ' + ((p.json.data || []).length));

  const forged = JSON.stringify({ version: 1, weekend_rate: 1, basic_salary_pkr: 1, courses: [] });
  await dbPost(TOK.manager, { table: 'system_settings', action: 'upsert', values: { id: 'SYS-COURSE-RATES', key: 'course_rates_v1', value: forged } });
  const after = await dbPost(TOK.owner, { table: 'system_settings', action: 'select', filters: eq('key', 'course_rates_v1') });
  check('manager write to course_rates_v1 is DENIED (value unchanged)', ((after.json.data || []).length) === 1 && String(after.json.data[0].value || '').includes('crs-tajweed'), 'value after manager upsert: ' + String((after.json.data || [])[0]?.value || '').slice(0, 60));

  const upd = JSON.stringify({ version: 1, weekend_rate: 3300, basic_salary_pkr: 20000, courses: [] });
  await dbPost(TOK.owner, { table: 'system_settings', action: 'upsert', values: { id: 'SYS-COURSE-RATES', key: 'course_rates_v1', value: upd } });
  const after2 = await dbPost(TOK.owner, { table: 'system_settings', action: 'select', filters: eq('key', 'course_rates_v1') });
  check('owner CAN write course_rates_v1', ((after2.json.data || []).length) === 1 && String(after2.json.data[0].value || '').includes('3300'), 'value: ' + String((after2.json.data || [])[0]?.value || '').slice(0, 60));

  const h = await call('/api/health', { method: 'GET' });
  check('health reports the course-rates release', h.status === 200 && h.json && h.json.version === '2026-11-06-annotated-pages', 'got ' + (h.json && h.json.version));
}

// ---- Catalogue module executed in a vm ----
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/course-catalogue.js'), 'utf8');
function makeSelect(id) {
  return {
    id, children: [], value: '',
    set innerHTML(v) { if (v === '') this.children = []; },
    get innerHTML() { return ''; },
    appendChild(opt) { this.children.push(opt); if (this.children.length === 1) this.value = opt.value; },
  };
}
const selects = { stuCourseSelect: makeSelect('stuCourseSelect'), trialCourse: makeSelect('trialCourse') };
const store = {};
const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  document: {
    readyState: 'complete',
    getElementById: (id) => selects[id] || null,
    createElement: () => ({ value: '', textContent: '' }),
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  addEventListener: () => {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);

{
  const CC = sandbox.window.CourseCatalogue;
  check('module exposes CourseCatalogue', !!CC && typeof CC.getSettings === 'function');
  const s = CC.getSettings();
  check('defaults carry 8 courses', Array.isArray(s.courses) && s.courses.length === 8, 'n=' + (s.courses || []).length);
  const byId = Object.fromEntries(s.courses.map((c) => [c.id, c]));
  check('Tajweed rate is the owner-updated 2500', byId['crs-tajweed'] && byId['crs-tajweed'].monthly_rate === 2500, 'got ' + (byId['crs-tajweed'] || {}).monthly_rate);
  check('no standalone generic Tafseer entry (owner removed it)', !s.courses.some((c) => c.name === 'Tafseer-ul-Quran'));
  check('weekend rate 3200 + basic salary 20000 in defaults', s.weekend_rate === 3200 && s.basic_salary_pkr === 20000, 'wk=' + s.weekend_rate + ' bs=' + s.basic_salary_pkr);
  const taf = CC.resolveByName('Tafseer-ul-Quran');
  check("'Tafseer-ul-Quran' resolves to English Tafseer at 4500 (same as today's rule)", !!taf && taf.id === 'crs-tafseer-english' && taf.monthly_rate === 4500, 'got ' + (taf && taf.id + '/' + taf.monthly_rate));
  const naz = CC.resolveByName('Nazra Quran with Tajweed');
  check("trial alias 'Nazra Quran with Tajweed' resolves to Quran Reading", !!naz && naz.id === 'crs-quran-reading');
  const isl = CC.resolveByName('Islamic Studies & Daily Duas');
  check("trial alias 'Islamic Studies & Daily Duas' resolves at 3500", !!isl && isl.id === 'crs-islamic-studies' && isl.monthly_rate === 3500);
  check('unknown course resolves to null (no silent default in the catalogue layer)', CC.resolveByName('Underwater Basket Weaving') === null);

  const stuOpts = selects.stuCourseSelect.children.map((o) => o.value);
  check('Add Student select is filled from the catalogue (8 canonical names)', stuOpts.length === 8 && stuOpts.includes('Noorani Qaida') && stuOpts.includes('English Translation & Tafseer') && !stuOpts.includes('Tafseer-ul-Quran'), stuOpts.join(' | '));
  const triOpts = selects.trialCourse.children.map((o) => o.value);
  check('Trial select uses the SAME canonical list', triOpts.length === 8 && triOpts.includes('Advanced Tajweed Rules') && !triOpts.includes('Nazra Quran with Tajweed'), triOpts.join(' | '));
}

// ---- Structural: portal wiring ----
{
  const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
  check('index.html has the settings tab section', html.includes('id="tab-settings"') && html.includes('id="courseRatesTableBody"'));
  check('index.html sidebar button opens the settings tab', html.includes('data-tab="tab-settings"'));
  check('index.html has weekend + basic salary inputs', html.includes('id="weekendRateInput"') && html.includes('id="basicSalaryInput"'));
  check('index.html loads course-catalogue.js', html.includes('<script src="js/course-catalogue.js"></script>'));
  const p360 = fs.readFileSync(path.join(REPO_ROOT, 'js/profiles360.js'), 'utf8');
  check('360 edit course is a catalogue <select> (free-text input removed)', p360.includes('<select id="fwEditStuCourse"') && !p360.includes('<input type="text" id="fwEditStuCourse"'));
  check('360 edit populates the course select after render', p360.includes('populate360CourseSelect'));
  const payroll = fs.readFileSync(path.join(REPO_ROOT, 'js/payroll.js'), 'utf8');
  check('Payroll engine evolution: Phase 1 left it untouched, Phase 2 switched the compile to the catalogue, Phase 3 removed the legacy substring function (see payroll-engine-catalogue + profiles360-convergence suites)', payroll.includes('resolveAssignmentRate') && !payroll.includes('getStudentCourseSalaryRate'));
  const wrk = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare/worker.js'), 'utf8');
  check('worker allowlists course_rates_v1 for manager reads only in the read predicate', wrk.includes("k === 'course_rates_v1'"));
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(' ; ')); process.exit(1); }
