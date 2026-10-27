// Urgent Issue 2 test — teacher catalog sync + tombstone self-heal:
//  A) Worker surface (REAL cloudflare/worker.js + functions/api/db.js
//     against a fake D1): teacher SELECT on system_settings returns ONLY
//     catalog keys + the tombstone; teacher INSERT/UPDATE/DELETE on
//     system_settings are denied; manager and owner behaviour unchanged;
//     parent system_settings select stays denied.
//  B) Admin re-poison guard (REAL hydrateCustomBooksFromCloudflareD1,
//     extracted from js/curriculum.js): a tombstoned allowlisted built-in
//     (interactive-madani-qaida) is stripped from the merged tombstone and
//     the healed list is pushed back to D1, while the other five
//     tombstoned built-ins stay tombstoned.
//  C) Teacher hydrate guard (REAL hydrateTeacherCustomBooksFromD1,
//     extracted from teacher.html): the teacher's local tombstone copy is
//     healed the same way (no D1 push-back — teachers cannot write).
//  D) Admin grid (REAL renderCurriculumGrid, extracted): no Delete button
//     for allowlisted built-ins; Delete still offered for custom books.
//  E) getBuiltinAllowlist fallback behaviour.
// Run from the repo root:  node test/urgent2-catalog-sync.test.mjs
// Requires: node >= 22.5 (node:sqlite). All values below are SYNTHETIC.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const CURRICULUM = read('js/curriculum.js');
const TEACHER_HTML = read('teacher.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}
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
function makeLocalStorageStub(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    _data: data,
  };
}

// ===========================================================================
// A) Worker surface
// ===========================================================================
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'urgent2-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'urgent' + '-test-' + 'secret';
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
const keySet = (r) => rows(r).map((x) => x.key).sort();

await dbPost(TOK.owner, { table: 'families', action: 'select' }); // boots ensureSchema
const TOMBSTONE = ['tafseer-ibn-kathir-english', 'namaz-wudu-guide', 'tafseer-bayan-ul-quran-urdu', 'holy-quran-16-line', 'noorani-qaida', 'interactive-madani-qaida'];
const SEED_SETTINGS = [
  ['SYS-IDX', 'alhuda_custom_books_index', '[]'],
  ['SYS-CAT', 'alhuda_custom_books', '[]'],
  ['SYS-P0', 'BOOK_PAGE_custom-1_0', 'https://example.test/p0'],
  ['SYS-DEL', 'alhuda_deleted_books', JSON.stringify(TOMBSTONE)],
  ['SYS-FLAG', 'fee_tables_v1', 'on'],
  ['SYS-LOGO', 'alhuda_logo', 'https://example.test/logo'],
  ['SYS-RND', 'some_other_key', 'secret-ish-value'],
];
for (const [id, key, value] of SEED_SETTINGS) {
  const r = await dbPost(TOK.owner, { table: 'system_settings', action: 'insert', values: { id, key, value } });
  if (r.status !== 200) check('seed settings row ' + key, false, r.text.slice(0, 160));
}

{
  const r = await dbPost(TOK.teacher, { table: 'system_settings', action: 'select' });
  check('teacher SELECT system_settings -> 200 (no longer denied)', r.status === 200, String(r.status) + ' ' + r.text.slice(0, 160));
  const keys = keySet(r);
  check('teacher sees ONLY catalog keys + tombstone', JSON.stringify(keys) === JSON.stringify(['BOOK_PAGE_custom-1_0', 'alhuda_custom_books', 'alhuda_custom_books_index', 'alhuda_deleted_books']), JSON.stringify(keys));
}
{
  const r = await dbPost(TOK.teacher, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_deleted_books') });
  check('teacher can read the tombstone row itself', r.status === 200 && rows(r).length === 1 && rows(r)[0].key === 'alhuda_deleted_books', String(r.status));
}
{
  const r = await dbPost(TOK.teacher, { table: 'system_settings', action: 'insert', values: { id: 'SYS-EVIL', key: 'alhuda_custom_books', value: '[]' } });
  check('teacher INSERT system_settings -> denied', r.status === 403, String(r.status) + ' ' + r.text.slice(0, 120));
  const r2 = await dbPost(TOK.teacher, { table: 'system_settings', action: 'update', values: { value: '[]' }, filters: eq('key', 'alhuda_deleted_books') });
  check('teacher UPDATE system_settings -> denied', r2.status === 403, String(r2.status));
  const r3 = await dbPost(TOK.teacher, { table: 'system_settings', action: 'delete', filters: eq('key', 'alhuda_deleted_books') });
  check('teacher DELETE system_settings -> denied', r3.status === 403, String(r3.status));
}
{
  const r = await dbPost(TOK.manager, { table: 'system_settings', action: 'select' });
  check('manager SELECT unchanged (catalog + logo + flag, NO tombstone)', JSON.stringify(keySet(r)) === JSON.stringify(['BOOK_PAGE_custom-1_0', 'alhuda_custom_books', 'alhuda_custom_books_index', 'alhuda_logo', 'fee_tables_v1']), JSON.stringify(keySet(r)));
}
{
  const r = await dbPost(TOK.owner, { table: 'system_settings', action: 'select' });
  // SLOW-CLASSES FIX: ensureSchema now records a 'schema_version'
  // marker row in system_settings (the cold-isolate fast path), so
  // the owner-visible key set is the seeds PLUS that one legitimate
  // row. The check stays an exact full-set equality — nothing else
  // may appear or disappear.
  check('owner SELECT unchanged (all keys + schema_version marker)', JSON.stringify(keySet(r)) === JSON.stringify([...SEED_SETTINGS.map(s => s[1]), 'schema_version'].sort()), JSON.stringify(keySet(r)));
}
{
  const r = await dbPost(TOK.parent, { table: 'system_settings', action: 'select' });
  check('parent SELECT system_settings stays denied', r.status === 403, String(r.status));
}

// ===========================================================================
// B) Admin re-poison guard (real hydrate, extracted)
// ===========================================================================
function makeSettingsDb(allSettings, upserts) {
  return {
    from: (table) => ({
      select: () => ({
        then: (res) => { res({ data: allSettings, error: null }); },
      }),
      upsert: (vals) => {
        upserts.push(vals);
        return { then: (res) => { res({ data: null, error: null }); } };
      },
    }),
  };
}
{
  const localStorage = makeLocalStorageStub({ alhuda_deleted_books: JSON.stringify(['interactive-madani-qaida']) });
  const upserts = [];
  const allSettings = [
    { key: 'alhuda_custom_books_index', value: JSON.stringify([{ id: 'custom-1', title: 'Qaida Noorania Eng', total_pages: 0 }]) },
    { key: 'alhuda_deleted_books', value: JSON.stringify(TOMBSTONE) },
  ];
  const ctx = vm.createContext({
    console, localStorage,
    db: makeSettingsDb(allSettings, upserts),
    window: { ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'] },
  });
  vm.runInContext(
    extractFunction(CURRICULUM, 'getDeletedBookIds') + '\n' +
    extractFunction(CURRICULUM, 'getBuiltinAllowlist') + '\n' +
    extractFunction(CURRICULUM, 'hydrateCustomBooksFromCloudflareD1'),
    ctx
  );
  await vm.runInContext('hydrateCustomBooksFromCloudflareD1()', ctx);
  const healedLocal = JSON.parse(localStorage.getItem('alhuda_deleted_books') || '[]');
  check('admin guard: e-Qaida stripped from local tombstone', !healedLocal.includes('interactive-madani-qaida'), JSON.stringify(healedLocal));
  check('admin guard: other five tombstoned ids KEPT', ['tafseer-ibn-kathir-english', 'namaz-wudu-guide', 'tafseer-bayan-ul-quran-urdu', 'holy-quran-16-line', 'noorani-qaida'].every((id) => healedLocal.includes(id)), JSON.stringify(healedLocal));
  const pushed = upserts.find((u) => u.key === 'alhuda_deleted_books');
  const pushedList = pushed ? JSON.parse(pushed.value) : null;
  check('admin guard: healed list pushed back to D1 (self-heal)', !!pushed && !pushedList.includes('interactive-madani-qaida') && pushedList.length === 5, JSON.stringify(pushedList));
  const keptBooks = JSON.parse(localStorage.getItem('alhuda_custom_books') || '[]');
  check('admin guard: live custom book still cached', keptBooks.some((b) => b.id === 'custom-1'));
}

// ===========================================================================
// C) Teacher hydrate guard (real hydrate, extracted)
// ===========================================================================
{
  const localStorage = makeLocalStorageStub({});
  const allSettings = [
    { key: 'alhuda_custom_books_index', value: JSON.stringify([{ id: 'custom-1', title: 'Qaida Noorania Eng', total_pages: 0 }]) },
    { key: 'alhuda_deleted_books', value: JSON.stringify(TOMBSTONE) },
  ];
  const ctx = vm.createContext({
    console, localStorage,
    db: makeSettingsDb(allSettings, []),
    window: { ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'] },
  });
  vm.runInContext(extractFunction(TEACHER_HTML, 'hydrateTeacherCustomBooksFromD1'), ctx);
  await vm.runInContext('hydrateTeacherCustomBooksFromD1()', ctx);
  const healedLocal = JSON.parse(localStorage.getItem('alhuda_deleted_books') || '[]');
  check('teacher hydrate: e-Qaida stripped from local tombstone', !healedLocal.includes('interactive-madani-qaida'), JSON.stringify(healedLocal));
  check('teacher hydrate: other five tombstoned ids KEPT', ['tafseer-ibn-kathir-english', 'namaz-wudu-guide', 'tafseer-bayan-ul-quran-urdu', 'holy-quran-16-line', 'noorani-qaida'].every((id) => healedLocal.includes(id)), JSON.stringify(healedLocal));
}

// ===========================================================================
// D) Admin grid Delete guard (real renderCurriculumGrid, extracted)
// ===========================================================================
{
  let htmlOut = '';
  const container = {};
  Object.defineProperty(container, 'innerHTML', { set(v) { htmlOut = v; }, get() { return htmlOut; } });
  const ctx = vm.createContext({
    console,
    document: { getElementById: (id) => (id === 'curriculumGrid' ? container : null) },
    window: { ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'] },
    CURRENT_ROLE: 'owner',
  });
  vm.runInContext(
    extractFunction(CURRICULUM, 'getBuiltinAllowlist') + '\n' +
    extractFunction(CURRICULUM, 'renderCurriculumGrid'),
    ctx
  );
  vm.runInContext(`renderCurriculumGrid([
    { id: 'interactive-madani-qaida', title: 'Al-Huda Interactive E-Qaida', category: 'qaida' },
    { id: 'custom-1', title: 'Qaida Noorania Eng', category: 'qaida' },
  ])`, ctx);
  const deleteCalls = (htmlOut.match(/handleDeleteCurriculumBook\('([^']+)'/g) || []).map((s) => s.match(/'([^']+)'/)[1]);
  check('grid: NO Delete button for allowlisted built-in e-Qaida', !deleteCalls.includes('interactive-madani-qaida'), JSON.stringify(deleteCalls));
  check('grid: Delete button still offered for custom books', deleteCalls.includes('custom-1'), JSON.stringify(deleteCalls));
}

// ===========================================================================
// E) getBuiltinAllowlist fallback
// ===========================================================================
{
  const ctx = vm.createContext({ console });
  vm.runInContext(extractFunction(CURRICULUM, 'getBuiltinAllowlist'), ctx);
  const fb = vm.runInContext('getBuiltinAllowlist()', ctx);
  check('allowlist fallback is [interactive-madani-qaida] when window list absent', JSON.stringify(fb) === JSON.stringify(['interactive-madani-qaida']), JSON.stringify(fb));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`---\nurgent2-catalog-sync: ${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
