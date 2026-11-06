// Course-book permanent deletion — frontend flow (js/curriculum.js).
// Runs the REAL extracted functions (handleDeleteCurriculumBook and its
// helpers, the catalog sync, the hydration re-poison guard) in a vm
// against a stateful fake system_settings db and a mocked storage fetch.
//
// The regression being pinned: before this fix, deleting a custom book
// only wrote a tombstone AFTER a catalog sync that re-upserted the book,
// so the hydration re-poison guard stripped the tombstone on the next
// load and the book came back as an empty shell. The happy-path scenario
// below deletes a book, then simulates a FRESH device load (empty
// localStorage, real hydrate + guard) and requires the book to stay gone.
// Run from the repo root:  node test/course-book-permanent-delete.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const CURRICULUM = read('js/curriculum.js');

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

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------
function makeLocalStorageStub(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    _data: data,
  };
}
class SelBuilder {
  constructor(db) { this._db = db; this._filters = []; this._limit = null; }
  eq(col, val) { this._filters.push([col, val]); return this; }
  limit(n) { this._limit = n; return this; }
  then(res, rej) {
    let out = this._db._all();
    for (const [c, v] of this._filters) out = out.filter((r) => String(r[c]) === String(v));
    if (this._limit != null) out = out.slice(0, this._limit);
    return Promise.resolve({ data: out, error: null }).then(res, rej);
  }
}
class DelBuilder {
  constructor(db) { this._db = db; this._filters = []; }
  eq(col, val) { this._filters.push([col, val]); return this; }
  then(res, rej) {
    let result = { data: null, error: null };
    for (const [c, v] of this._filters) result = this._db._deleteWhere(c, v);
    return Promise.resolve(result).then(res, rej);
  }
}
class FakeSettingsDb {
  constructor(seedRows) {
    this.rows = new Map();
    for (const r of seedRows) this.rows.set(r.key, { id: r.id, key: r.key, value: r.value });
    this.failUpsertFor = null;
    this.failDelete = false;
    this.upsertLog = [];
    this.deleteLog = [];
  }
  from() {
    const self = this;
    return {
      select: () => new SelBuilder(self),
      upsert: (vals) => Promise.resolve(self._upsert(vals)),
      delete: () => new DelBuilder(self),
    };
  }
  _all() { return [...this.rows.values()].map((r) => ({ ...r })); }
  _upsert(vals) {
    this.upsertLog.push(vals.key);
    if (this.failUpsertFor && vals.key === this.failUpsertFor) {
      return { data: null, error: { message: 'upsert denied by fake' } };
    }
    this.rows.set(vals.key, { id: vals.id, key: vals.key, value: vals.value });
    return { data: null, error: null };
  }
  _deleteWhere(col, val) {
    this.deleteLog.push(col + '=' + val);
    if (this.failDelete) return { data: null, error: { message: 'delete denied by fake' } };
    for (const [k, r] of [...this.rows.entries()]) {
      if (String(r[col]) === String(val)) this.rows.delete(k);
    }
    return { data: null, error: null };
  }
  getRow(key) { const r = this.rows.get(key); return r ? { ...r } : null; }
  keys() { return [...this.rows.keys()]; }
}

// ---------------------------------------------------------------------------
// Fixtures (all values SYNTHETIC)
// ---------------------------------------------------------------------------
const W = 'https://worker.test/api/storage?key=';
const urlA1 = W + 'course_material%2Faaa_p1.webp';
const urlA2 = W + 'course_material%2Faaa_p2.webp';
const urlA3 = W + 'course_material%2Faaa_p3.webp';
const urlB1 = W + 'course_material%2Fbbb_p1.webp';
const urlB2 = W + 'course_material%2Fbbb_p2.webp';
const BUILTINS_TOMBSTONE = ['tafseer-ibn-kathir-english', 'namaz-wudu-guide', 'tafseer-bayan-ul-quran-urdu', 'holy-quran-16-line', 'noorani-qaida'];

const bookALocal = { id: 'custom-A', title: 'Book A', total_pages: 3, pages: [urlA1, urlA2, 'data:image/webp;base64,LOCALONLY'] };
const bookBLocal = { id: 'custom-B', title: 'Book B', total_pages: 2, pages: [urlB1, urlB2] };
const metaOf = (b) => ({ ...b, pages: [], total_pages: b.total_pages });

function seedRows() {
  return [
    { id: 'SYS-CUSTOM-BOOKS-INDEX', key: 'alhuda_custom_books_index', value: JSON.stringify([metaOf(bookALocal), metaOf(bookBLocal)]) },
    { id: 'SYS-CUSTOM-BOOKS-ALL', key: 'alhuda_custom_books', value: JSON.stringify([metaOf(bookALocal), metaOf(bookBLocal)]) },
    { id: 'SYS-custom-A-P0', key: 'BOOK_PAGE_custom-A_0', value: urlA1 },
    { id: 'SYS-custom-A-P1', key: 'BOOK_PAGE_custom-A_1', value: urlA2 },
    { id: 'SYS-custom-A-P2', key: 'BOOK_PAGE_custom-A_2', value: urlA3 },
    { id: 'SYS-custom-B-P0', key: 'BOOK_PAGE_custom-B_0', value: urlB1 },
    { id: 'SYS-custom-B-P1', key: 'BOOK_PAGE_custom-B_1', value: urlB2 },
    { id: 'SYS-DELETED-BOOKS', key: 'alhuda_deleted_books', value: JSON.stringify(BUILTINS_TOMBSTONE) },
  ];
}
function seedLocal() {
  return {
    alhuda_custom_books: JSON.stringify([bookALocal, bookBLocal]),
    alhuda_deleted_books: JSON.stringify(BUILTINS_TOMBSTONE),
  };
}

const FN_NAMES = [
  'getCustomBooks', 'saveCustomBooks', 'syncCustomBooksToD1Chunked',
  'getDeletedBookIds', 'saveDeletedBookIds', 'getBuiltinAllowlist',
  'hydrateCustomBooksFromCloudflareD1', 'getAllAvailableBooks',
  '_r2KeyFromPageValue', '_collectBookDeletionPlan', '_deleteStorageObject',
  'handleDeleteCurriculumBook',
];
function buildSource() {
  const decl = CURRICULUM.match(/const _bookDeleteInFlight = new Set\(\);/);
  if (!decl) throw new Error('in-flight declaration not found in js/curriculum.js');
  return "let _lastCatalogSyncError = '';\n" + decl[0] + '\n'
    + FN_NAMES.map((n) => extractFunction(CURRICULUM, n)).join('\n');
}

function makeWorld(opts = {}) {
  const db = new FakeSettingsDb(seedRows());
  if (opts.failUpsertFor) db.failUpsertFor = opts.failUpsertFor;
  if (opts.failDelete) db.failDelete = true;
  const localStorage = makeLocalStorageStub(seedLocal());
  const notifications = [];
  const fetchCalls = [];
  let confirmCalls = 0;
  let libraryLoads = 0;
  const fetchMock = (url, init = {}) => {
    fetchCalls.push({ url: String(url), method: init.method || 'GET' });
    if (opts.storageDelay) {
      return new Promise((resolve) => setTimeout(() => resolve({
        ok: true, status: 200, json: async () => ({ ok: true, deleted: true }),
      }), opts.storageDelay));
    }
    if (opts.storageFail) {
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ ok: false, error: 'internal_error' }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, deleted: true }) });
  };
  const ctx = vm.createContext({
    console, localStorage, db, fetch: fetchMock, URL, setTimeout, clearTimeout,
    window: {
      ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'],
      getLmsAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
    },
    document: { getElementById: () => null },
    CURRENT_ROLE: opts.role || 'owner',
    CURRENT_CURRICULUM_CATEGORY: 'all',
    ALHUDA_CURRICULUM: [],
    lmsConfirm: async () => { confirmCalls++; return opts.confirm !== false; },
    lmsNotify: (msg, o) => { notifications.push({ msg: String(msg), opts: o || {} }); },
    loadCurriculumLibrary: () => { libraryLoads++; },
  });
  vm.runInContext(buildSource(), ctx);
  return {
    db, localStorage, notifications, fetchCalls, ctx,
    get confirmCalls() { return confirmCalls; },
    get libraryLoads() { return libraryLoads; },
    run: (code) => vm.runInContext(code, ctx),
  };
}
// A fresh-device world: empty localStorage, the SAME fake D1.
function makeFreshLoadWorld(db) {
  const localStorage = makeLocalStorageStub({});
  const ctx = vm.createContext({
    console, localStorage, db, URL, setTimeout, clearTimeout,
    window: { ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'] },
    CURRENT_CURRICULUM_CATEGORY: 'all',
    ALHUDA_CURRICULUM: [],
    loadCurriculumLibrary: () => {},
  });
  vm.runInContext(buildSource(), ctx);
  return { localStorage, ctx, run: (code) => vm.runInContext(code, ctx) };
}
const deletedKeys = (world) => world.fetchCalls.filter((c) => c.method === 'DELETE')
  .map((c) => new URL(c.url).searchParams.get('key')).sort();
const indexIds = (db) => JSON.parse(db.getRow('alhuda_custom_books_index').value).map((b) => b.id).sort();
const tombstoneIds = (db) => JSON.parse(db.getRow('alhuda_deleted_books').value);

// ---------------------------------------------------------------------------
// 0) Key parser units
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  check('parser: absolute storage URL -> course_material key', w.run(`_r2KeyFromPageValue('${urlA1}')`) === 'course_material/aaa_p1.webp');
  check('parser: relative storage URL -> key', w.run(`_r2KeyFromPageValue('/api/storage?key=course_material%2Frel_p1.webp')`) === 'course_material/rel_p1.webp');
  check('parser: data URI -> no key', w.run(`_r2KeyFromPageValue('data:image/webp;base64,AAAA')`) === '');
  check('parser: non-storage URL -> no key', w.run(`_r2KeyFromPageValue('https://x.test/plain.png')`) === '');
  check('parser: out-of-prefix key -> no key', w.run(`_r2KeyFromPageValue('${W}documents%2Fsecret.pdf')`) === '');
  check('parser: null/undefined safe', w.run(`_r2KeyFromPageValue(null)`) === '' && w.run(`_r2KeyFromPageValue(undefined)`) === '');
}

// ---------------------------------------------------------------------------
// 1) Happy path + fresh-load regression (THE reported bug)
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  await w.run(`handleDeleteCurriculumBook('custom-A', 'Book A')`);
  check('happy: every R2 object deleted (incl. page only present in D1)', JSON.stringify(deletedKeys(w)) === JSON.stringify(['course_material/aaa_p1.webp', 'course_material/aaa_p2.webp', 'course_material/aaa_p3.webp']), JSON.stringify(deletedKeys(w)));
  check('happy: catalog index no longer contains the book', JSON.stringify(indexIds(w.db)) === JSON.stringify(['custom-B']), JSON.stringify(indexIds(w.db)));
  check('happy: legacy mirror no longer contains the book', JSON.stringify(JSON.parse(w.db.getRow('alhuda_custom_books').value).map((b) => b.id)) === JSON.stringify(['custom-B']));
  check('happy: BOOK_PAGE rows for the book are gone', !w.db.keys().some((k) => k.startsWith('BOOK_PAGE_custom-A_')), w.db.keys().join(','));
  check('happy: other book page rows untouched', w.db.keys().filter((k) => k.startsWith('BOOK_PAGE_custom-B_')).length === 2);
  check('happy: tombstone keeps built-ins and gains the deleted id', BUILTINS_TOMBSTONE.every((id) => tombstoneIds(w.db).includes(id)) && tombstoneIds(w.db).includes('custom-A'), JSON.stringify(tombstoneIds(w.db)));
  check('happy: local mirror no longer contains the book', !JSON.parse(w.localStorage.getItem('alhuda_custom_books')).some((b) => b.id === 'custom-A'));
  check('happy: exactly one success notification, no error', w.notifications.length === 1 && w.notifications[0].msg.includes('🗑️'), JSON.stringify(w.notifications.map((n) => n.msg)));
  check('happy: library re-rendered after success', w.libraryLoads === 1);

  // Fresh device: empty localStorage, real hydrate + re-poison guard.
  const fresh = makeFreshLoadWorld(w.db);
  await fresh.run('hydrateCustomBooksFromCloudflareD1()');
  const avail = fresh.run('getAllAvailableBooks().map(b => b.id)');
  check('REGRESSION: deleted book stays gone after a fresh load', !avail.includes('custom-A'), JSON.stringify(avail));
  check('REGRESSION: surviving book still listed after fresh load', avail.includes('custom-B'), JSON.stringify(avail));
  check('REGRESSION: guard did NOT strip the deleted id from the D1 tombstone', tombstoneIds(w.db).includes('custom-A'), JSON.stringify(tombstoneIds(w.db)));
}

// ---------------------------------------------------------------------------
// 2) Storage (R2) failure: stop in phase 1, nothing else touched
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ storageFail: true });
  await w.run(`handleDeleteCurriculumBook('custom-A', 'Book A')`);
  check('r2-fail: deletion stops at the first failed object', w.fetchCalls.filter((c) => c.method === 'DELETE').length === 1, String(w.fetchCalls.length));
  check('r2-fail: INCOMPLETE error shown, no success', w.notifications.length === 1 && w.notifications[0].msg.includes('INCOMPLETE') && !w.notifications[0].msg.includes('🗑️'), JSON.stringify(w.notifications.map((n) => n.msg)));
  check('r2-fail: D1 index untouched', JSON.stringify(indexIds(w.db)) === JSON.stringify(['custom-A', 'custom-B']));
  check('r2-fail: BOOK_PAGE rows untouched', w.db.keys().filter((k) => k.startsWith('BOOK_PAGE_custom-A_')).length === 3);
  check('r2-fail: tombstone untouched', !tombstoneIds(w.db).includes('custom-A'));
  check('r2-fail: local mirror untouched, no re-render', JSON.parse(w.localStorage.getItem('alhuda_custom_books')).length === 2 && w.libraryLoads === 0);
}

// ---------------------------------------------------------------------------
// 3) BOOK_PAGE row-delete failure: stop before the commit point
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ failDelete: true });
  await w.run(`handleDeleteCurriculumBook('custom-A', 'Book A')`);
  check('row-fail: R2 objects were deleted first (3 calls)', deletedKeys(w).length === 3, JSON.stringify(deletedKeys(w)));
  check('row-fail: INCOMPLETE error shown, no success', w.notifications.length === 1 && w.notifications[0].msg.includes('INCOMPLETE'), JSON.stringify(w.notifications.map((n) => n.msg)));
  check('row-fail: catalog commit never ran (index intact)', JSON.stringify(indexIds(w.db)) === JSON.stringify(['custom-A', 'custom-B']));
  check('row-fail: tombstone never written', !tombstoneIds(w.db).includes('custom-A'));
  check('row-fail: local mirror untouched, no re-render', JSON.parse(w.localStorage.getItem('alhuda_custom_books')).length === 2 && w.libraryLoads === 0);
}

// ---------------------------------------------------------------------------
// 4) Catalog (commit) failure: honest INCOMPLETE, book returns on refresh
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ failUpsertFor: 'alhuda_custom_books_index' });
  await w.run(`handleDeleteCurriculumBook('custom-A', 'Book A')`);
  const msg = w.notifications.length === 1 ? w.notifications[0].msg : '';
  check('catalog-fail: INCOMPLETE error shown, no success claim', w.notifications.length === 1 && msg.includes('INCOMPLETE') && !msg.includes('🗑️'), JSON.stringify(w.notifications.map((n) => n.msg)));
  check('catalog-fail: wording admits partial removal (never "nothing happened")', msg.includes('Some parts may already have been removed'), msg.slice(0, 120));
  check('catalog-fail: D1 index still contains the book (commit failed)', indexIds(w.db).includes('custom-A'));
  check('catalog-fail: no re-render on failure', w.libraryLoads === 0);
  const fresh = makeFreshLoadWorld(w.db);
  await fresh.run('hydrateCustomBooksFromCloudflareD1()');
  const avail = fresh.run('getAllAvailableBooks().map(b => b.id)');
  check('catalog-fail: book is back on a fresh load (honest incomplete state, retry possible)', avail.includes('custom-A'), JSON.stringify(avail));
}

// ---------------------------------------------------------------------------
// 5) Double invocation: single execution
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ storageDelay: 15 });
  const p1 = w.run(`handleDeleteCurriculumBook('custom-A', 'Book A')`);
  const p2 = w.run(`handleDeleteCurriculumBook('custom-A', 'Book A')`);
  await Promise.all([p1, p2]);
  check('double-invoke: storage deletes ran exactly once per object', deletedKeys(w).length === 3, JSON.stringify(deletedKeys(w)));
  check('double-invoke: exactly one success notification', w.notifications.filter((n) => n.msg.includes('🗑️')).length === 1, JSON.stringify(w.notifications.map((n) => n.msg)));
  check('double-invoke: book deleted once, cleanly', JSON.stringify(indexIds(w.db)) === JSON.stringify(['custom-B']));
}

// ---------------------------------------------------------------------------
// 6) Manager session: no delete path at all
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ role: 'manager' });
  await w.run(`handleDeleteCurriculumBook('custom-A', 'Book A')`);
  check('manager: Access Denied notification', w.notifications.length === 1 && w.notifications[0].msg.includes('Access Denied'), JSON.stringify(w.notifications.map((n) => n.msg)));
  check('manager: confirm never offered, no fetch, no writes', w.confirmCalls === 0 && w.fetchCalls.length === 0 && w.db.upsertLog.length === 0 && w.db.deleteLog.length === 0);
  check('manager: catalog untouched', JSON.stringify(indexIds(w.db)) === JSON.stringify(['custom-A', 'custom-B']));
}

// ---------------------------------------------------------------------------
// 7) Owner declines the confirmation: nothing happens
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ confirm: false });
  await w.run(`handleDeleteCurriculumBook('custom-A', 'Book A')`);
  check('declined: no fetch, no writes, no notification', w.fetchCalls.length === 0 && w.db.upsertLog.length === 0 && w.db.deleteLog.length === 0 && w.notifications.length === 0);
  check('declined: catalog untouched', JSON.stringify(indexIds(w.db)) === JSON.stringify(['custom-A', 'custom-B']));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\ncourse-book-permanent-delete: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
