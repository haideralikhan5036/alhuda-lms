// Announcements reach the portals (owner report 2026-10-29: admin
// announcements never showed in the Teacher Portal). Root cause: the
// list lived only in the admin browser's localStorage + a shared-sync
// blob the portals never read, and the Worker denied teacher/parent
// reads of any new system_settings key. Fix: admin dual-writes the
// list to a D1 system_settings row; the Worker allowlists that key
// for teacher + parent reads; both portals render a noticeboard
// banner filtered by audience. Drives the REAL Worker via the house
// harness + structural checks on the three frontends.
// Run from the repo root:  node test/announcements-portals.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ann-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-secret-'.repeat(4) + 'announcements';
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
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, DB: fakeDb, STORAGE: fakeR2, ALLOWED_ORIGINS: ORIGIN };

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
  teacher: await createSessionToken({ sub: 'T-A', role: 'teacher' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};

{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: schema boot -> 200', boot.status === 200, 'got ' + boot.status);
}
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-A', 'Teacher A', 'Active')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES ('ST-1', 'FAM-1', 'Child One', 'T-A')");
const ANN_JSON = JSON.stringify([{ id: 'ANN-1', title: 'Assalamu Alaikum', message: 'Portals notice.', target: 'both', created_at: '2026-10-29 10:00' }]);
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('SYS-ANNOUNCEMENTS', 'alhuda_official_announcements', ?)", ANN_JSON);
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('SYS-LOGO', 'alhuda_logo', 'data:image/png;base64,xx')");

// ---- Worker read allowlist ----
{
  const t = await dbPost(TOK.teacher, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_official_announcements') });
  check('teacher CAN read the announcements row', t.status === 200 && ((t.json.data || []).length) === 1 && String(t.json.data[0].value || '').includes('Assalamu Alaikum'), 'status ' + t.status + ' rows ' + ((t.json.data || []).length));
  const p = await dbPost(TOK.parent, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_official_announcements') });
  check('parent CAN read the announcements row', p.status === 200 && ((p.json.data || []).length) === 1, 'status ' + p.status + ' rows ' + ((p.json.data || []).length));
  const tl = await dbPost(TOK.teacher, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_logo') });
  check('teacher still CANNOT read other keys (logo)', ((tl.json.data || []).length) === 0, 'rows ' + ((tl.json.data || []).length));
  const pl = await dbPost(TOK.parent, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_logo') });
  check('parent still CANNOT read other keys (logo)', ((pl.json.data || []).length) === 0, 'rows ' + ((pl.json.data || []).length));
  const w = await dbPost(TOK.teacher, { table: 'system_settings', action: 'upsert', values: { id: 'SYS-ANNOUNCEMENTS', key: 'alhuda_official_announcements', value: '[]' } });
  check('teacher WRITE to system_settings still denied', w.status === 403 || (w.json && w.json.ok === false), 'status ' + w.status);
  const h = await call('/api/health', { method: 'GET' });
  check('health reports the announcements release', h.status === 200 && h.json && h.json.version === '2026-10-29-announcements', 'got ' + (h.json && h.json.version));
}

// ---- Frontend wiring (structural) ----
const DASH = fs.readFileSync(path.join(REPO_ROOT, 'js/dashboard.js'), 'utf8');
const TEACHER = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
const PARENT = fs.readFileSync(path.join(REPO_ROOT, 'parent.html'), 'utf8');
check('admin save dual-writes the settings row', DASH.includes('function pushAnnouncementsToSettings') && DASH.includes("key: 'alhuda_official_announcements'") && DASH.includes("id: 'SYS-ANNOUNCEMENTS'"));
check('admin migrates pre-existing announcements once', DASH.includes('_annSettingsPushDone'));
check('teacher portal has the banner container', TEACHER.includes('id="teacherAnnouncementsBanner"'));
check('teacher loader reads the D1 row + filters audience', TEACHER.includes('function loadTeacherAnnouncements()') && TEACHER.includes("a.target === 'teachers' || a.target === 'both'"));
check('parent portal has the banner container', PARENT.includes('id="parentAnnouncementsBanner"'));
check('parent loader reads the D1 row + filters audience', PARENT.includes('function loadParentAnnouncements()') && PARENT.includes("a.target === 'students' || a.target === 'both'"));
check('portal banners escape announcement text', TEACHER.includes('function annEscT') && PARENT.includes('function annEscP'));

const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
