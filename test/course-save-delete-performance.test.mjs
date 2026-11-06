// Course save/delete PERFORMANCE suite (2026-11-06).
//
// The complaint: saving in the Page Editor and deleting a book took
// "tooooo much time" on real books. Root cause measured from the old
// code (live scale: 5 books, 1,081 BOOK_PAGE rows):
//   - Editor save: the chunked sync rewrote EVERY book's EVERY page
//     row, one HTTP request per row (~1,084 sequential calls to change
//     a handful of pages).
//   - Book delete: 549 sequential storage deletes + 549 sequential row
//     deletes + a commit sync that re-upserted every OTHER book's
//     pages (~1,634 calls for the 549-page book; ~1,130 for a 44-page
//     book, dominated by the commit).
// This suite pins the fixed behaviour with COUNTING fakes:
//   - editor save writes ONLY the edited book's changed positions
//     (array-batched) + index/mirror, and shows "Saving… d/t" progress;
//   - delete removes page rows with ONE IN-list delete per 90 keys,
//     runs storage deletes in a bounded pool (max 6 in flight), commits
//     catalog-only, and shows "Deleting… d/t" progress;
//   - final D1 state is identical to the old flows'.
// All data is synthetic; production functions run extracted, unmodified.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CURRICULUM = fs.readFileSync(path.join(REPO_ROOT, 'js/curriculum.js'), 'utf8');
const CURRICULUM_DATA = fs.readFileSync(path.join(REPO_ROOT, 'curriculum_data.js'), 'utf8');

function extractFunction(src, name) {
  const re = new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`);
  const m = src.match(re);
  if (!m) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', m.index);
  let depth = 0;
  const start = m.index;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated function: ' + name);
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---------------------------------------------------------------------------
// COUNTING fake D1 (system_settings only)
// ---------------------------------------------------------------------------
class SelBuilder {
  constructor(db) { this._db = db; this._filters = []; this._limit = null; }
  eq(col, val) { this._filters.push([col, val]); return this; }
  limit(n) { this._limit = n; return this; }
  then(res, rej) {
    this._db.selectCalls++;
    let out = this._db._all();
    for (const [c, v] of this._filters) out = out.filter((r) => String(r[c]) === String(v));
    if (this._limit != null) out = out.slice(0, this._limit);
    return Promise.resolve({ data: out, error: null }).then(res, rej);
  }
}
class DelBuilder {
  constructor(db) { this._db = db; this._filters = []; }
  eq(col, val) { this._filters.push([col, val, 'eq']); return this; }
  in(col, vals) { this._filters.push([col, vals, 'in']); return this; }
  then(res, rej) {
    let result = { data: null, error: null };
    for (const f of this._filters) result = this._db._delete(f[0], f[1], f[2]);
    return Promise.resolve(result).then(res, rej);
  }
}
class CountingDb {
  constructor(seedRows) {
    this.rows = new Map();
    for (const r of seedRows) this.rows.set(r.key, { id: r.id, key: r.key, value: r.value });
    this.selectCalls = 0;
    this.upsertCalls = [];  // [{ keys: [...] }] one entry per HTTP-level call
    this.deleteCalls = [];  // [{ desc }]
    this.pageWrites = [];   // every BOOK_PAGE key written, in order
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
    const rows = Array.isArray(vals) ? vals : [vals];
    this.upsertCalls.push({ keys: rows.map((r) => r.key) });
    for (const row of rows) {
      if (row.key && row.key.startsWith('BOOK_PAGE_')) this.pageWrites.push(row.key);
      this.rows.set(row.key, { id: row.id, key: row.key, value: row.value });
    }
    return { data: null, error: null };
  }
  _delete(col, val, op) {
    if (op === 'in') {
      this.deleteCalls.push({ desc: col + ' IN (' + val.length + ')' });
      const set = new Set(val.map((v) => String(v)));
      for (const [k, r] of [...this.rows.entries()]) if (set.has(String(r[col]))) this.rows.delete(k);
    } else {
      this.deleteCalls.push({ desc: col + '=' + val });
      for (const [k, r] of [...this.rows.entries()]) if (String(r[col]) === String(val)) this.rows.delete(k);
    }
    return { data: null, error: null };
  }
  getRow(key) { const r = this.rows.get(key); return r ? { ...r } : null; }
  keys() { return [...this.rows.keys()]; }
  pageKeys(bookId) { return this.keys().filter((k) => k.startsWith(`BOOK_PAGE_${bookId}_`)); }
}

// ---------------------------------------------------------------------------
// DOM / storage stubs
// ---------------------------------------------------------------------------
function makeElement(id) {
  const el = {
    id, value: '', innerText: '', textContent: '', disabled: false, style: {},
    _html: '', _htmlHistory: [],
    classList: {
      _set: new Set(),
      add(...cs) { cs.forEach((c) => this._set.add(c)); },
      remove(...cs) { cs.forEach((c) => this._set.delete(c)); },
      toggle(c, force) { if (force === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (force) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    querySelectorAll: () => [],
    getAttribute: () => null,
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); this._htmlHistory.push(String(v)); },
  });
  return el;
}
function makeDocumentStub() {
  const els = new Map();
  return {
    getElementById: (id) => { if (!els.has(id)) els.set(id, makeElement(id)); return els.get(id); },
    createElement: () => makeElement('anon'),
    _els: els,
  };
}
class FakeURL extends URL {
  static createObjectURL() { return 'blob:fake-thumb'; }
  static revokeObjectURL() {}
}
function makeLocalStorageStub(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// ---------------------------------------------------------------------------
// Fixtures (all SYNTHETIC)
// ---------------------------------------------------------------------------
const W = 'https://worker.test/api/storage?key=';
const U = (n) => W + 'course_material%2F' + n + '.webp';
const BUILTINS_TOMBSTONE = ['tafseer-ibn-kathir-english', 'namaz-wudu-guide', 'tafseer-bayan-ul-quran-urdu', 'holy-quran-16-line', 'noorani-qaida'];

function paraPages(p, n) { const out = []; for (let i = 1; i <= n; i++) out.push(U('big_p' + p + '_' + i)); return out; }
const bigBook = {
  id: 'custom-BIG', title: 'Big Para Book', category: 'quran', category_label: 'The Holy Quran',
  paras_data: { '1': paraPages(1, 20), '2': paraPages(2, 20), '3': paraPages(3, 20) },
  paras: [1, 2, 3].map((p) => ({ para: p, name_en: 'Para ' + p, name_ur: '', page_start: (p - 1) * 20 + 1, page_end: p * 20, total_pages: 20 })),
  pages: [...paraPages(1, 20), ...paraPages(2, 20), ...paraPages(3, 20)],
  total_pages: 60, total_paras: 30,
};
const sideBook = {
  id: 'custom-SIDE', title: 'Side Book', category: 'qaida', category_label: 'Qaida & Primers',
  pages: [1, 2, 3, 4, 5, 6, 7].map((i) => U('side_' + i)), total_pages: 7,
};
const delBook = {
  id: 'custom-DEL', title: 'Del Book', category: 'qaida', category_label: 'Qaida & Primers',
  pages: Array.from({ length: 30 }, (_, i) => U('del_' + (i + 1))), total_pages: 30,
};
const metaOf = (b) => ({ ...b, pages: [], total_pages: b.total_pages });
function seedRows(books) {
  const rows = [
    { id: 'SYS-CUSTOM-BOOKS-INDEX', key: 'alhuda_custom_books_index', value: JSON.stringify(books.map(metaOf)) },
    { id: 'SYS-CUSTOM-BOOKS-ALL', key: 'alhuda_custom_books', value: JSON.stringify(books.map(metaOf)) },
    { id: 'SYS-DELETED-BOOKS', key: 'alhuda_deleted_books', value: JSON.stringify(BUILTINS_TOMBSTONE) },
  ];
  for (const b of books) {
    b.pages.forEach((v, i) => rows.push({ id: `SYS-${b.id}-P${i}`, key: `BOOK_PAGE_${b.id}_${i}`, value: v }));
  }
  return rows;
}
function seedLocal(books) {
  return {
    alhuda_custom_books: JSON.stringify(books),
    alhuda_deleted_books: JSON.stringify(BUILTINS_TOMBSTONE),
  };
}

const FN_NAMES = [
  'getCustomBooks', 'saveCustomBooks', 'syncCustomBooksToD1Chunked',
  'getDeletedBookIds', 'saveDeletedBookIds', 'getBuiltinAllowlist',
  'hydrateCustomBooksFromCloudflareD1', 'getAllAvailableBooks',
  '_mergeEffectiveBooks', '_catalogIndexOf', '_runBoundedPool',
  '_upsertPageRowsBatched', '_saveBookPagesScoped', '_commitCatalogOnly',
  '_r2KeyFromPageValue', '_collectBookDeletionPlan', '_deleteStorageObject',
  'handleDeleteCurriculumBook',
  'pageEditorEsc', 'pageEditorParaList', 'pageEditorIsParaBook',
  'pageEditorRealPages', 'pageEditorParaPagesOf', 'openPageEditor',
  'pageEditorLoadWorkingList', 'renderPageEditor', 'loadPageEditorThumb',
  'pageEditorSelectPara', 'pageEditorAddFiles', 'pageEditorStageFiles',
  'pageEditorUploadPage', 'pageEditorToggleSelect', 'pageEditorRemoveOne',
  'pageEditorRemoveSelected', 'pageEditorMove', 'pageEditorDismissUploadErrors',
  'pageEditorStagedValues', 'pageEditorIsDirty', 'pageEditorIsStructural',
  'pageEditorBuildUpdatedBook', 'savePageEditor', 'requestClosePageEditor',
  'pageEditorAnchorValue', 'pageEditorAnchorsDirty', 'pageEditorValidateAnchors',
  'pageEditorOrigStartChanged',
];
function buildSource() {
  const pe = CURRICULUM.match(/let PAGE_EDITOR = null;/);
  const inf = CURRICULUM.match(/const _bookDeleteInFlight = new Set\(\);/);
  const chunk = CURRICULUM.match(/const _PAGE_UPSERT_CHUNK = \d+;/);
  if (!pe || !inf || !chunk) throw new Error('declaration not found in js/curriculum.js');
  return "let _lastCatalogSyncError = '';\nlet CURRENT_CURRICULUM_CATEGORY = 'all';\n"
    + pe[0] + '\n' + inf[0] + '\n' + chunk[0] + '\n'
    + extractFunction(CURRICULUM_DATA, 'getBookParaPages') + '\n'
    + FN_NAMES.map((n) => extractFunction(CURRICULUM, n)).join('\n');
}

function makeEditorWorld(books) {
  const db = new CountingDb(seedRows(books));
  const localStorage = makeLocalStorageStub(seedLocal(books));
  const documentStub = makeDocumentStub();
  const notifications = [];
  const ctx = vm.createContext({
    console, localStorage, db, document: documentStub, URL: FakeURL,
    setTimeout, clearTimeout,
    fetch: async () => ({ ok: true, status: 200, blob: async () => ({ size: 10, type: 'image/webp' }) }),
    window: {
      ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'],
      getLmsAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      uploadToCloudflareR2: async (dataUrl, folder, filename) => 'https://worker.test/api/storage?key=' + encodeURIComponent('course_material/' + filename),
    },
    CURRENT_ROLE: 'owner',
    ALHUDA_CURRICULUM: [],
    QURAN_PARAS_INFO: [],
    compressImageToWebP: async (file) => 'data:image/webp;base64,' + (file ? file.name : 'unnamed'),
    lmsConfirm: async () => true,
    lmsNotify: (msg, o) => { notifications.push({ msg: String(msg), opts: o || {} }); },
    openModal: () => {}, closeModal: () => {}, loadCurriculumLibrary: () => {},
  });
  vm.runInContext(buildSource(), ctx);
  return { db, localStorage, document: documentStub, notifications, ctx, run: (code) => vm.runInContext(code, ctx) };
}
async function freshBook(db, bookId) {
  const localStorage = makeLocalStorageStub({});
  const ctx = vm.createContext({
    console, localStorage, db, URL: FakeURL, setTimeout, clearTimeout,
    window: { ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'] },
    CURRENT_CURRICULUM_CATEGORY: 'all', ALHUDA_CURRICULUM: [], QURAN_PARAS_INFO: [],
    loadCurriculumLibrary: () => {},
  });
  const src = ['getCustomBooks', 'getDeletedBookIds', 'getBuiltinAllowlist', 'hydrateCustomBooksFromCloudflareD1', 'getAllAvailableBooks']
    .map((n) => extractFunction(CURRICULUM, n)).join('\n')
    + '\n' + extractFunction(CURRICULUM_DATA, 'getBookParaPages');
  vm.runInContext("let _lastCatalogSyncError = '';\n" + src, ctx);
  await vm.runInContext('hydrateCustomBooksFromCloudflareD1()', ctx);
  return vm.runInContext(`(function () { const b = getAllAvailableBooks().find(function (x) { return x.id === '${bookId}'; }); return b || null; })()`, ctx);
}

// ---------------------------------------------------------------------------
// A) Editor save: append 2 pages to the LAST para of a 60-page book
// ---------------------------------------------------------------------------
{
  const w = makeEditorWorld([bigBook, sideBook]);
  check('A open: para book opens', await w.run(`openPageEditor('custom-BIG')`) === true);
  await w.run('pageEditorSelectPara(3)');
  await w.run(`pageEditorStageFiles([{ name: 'a1.png' }, { name: 'a2.png' }], 21)`);
  const okSave = await w.run('savePageEditor()');
  check('A save: succeeds', okSave === true, JSON.stringify(w.notifications.map((n) => n.msg)));
  const bigWrites = w.db.pageWrites.filter((k) => k.startsWith('BOOK_PAGE_custom-BIG_'));
  const sideWrites = w.db.pageWrites.filter((k) => k.startsWith('BOOK_PAGE_custom-SIDE_'));
  check('A writes: ONLY the 2 appended positions of the edited book', JSON.stringify(bigWrites) === JSON.stringify(['BOOK_PAGE_custom-BIG_60', 'BOOK_PAGE_custom-BIG_61']), JSON.stringify(bigWrites));
  check('A writes: ZERO page writes to the other book', sideWrites.length === 0, JSON.stringify(sideWrites));
  const pageBatchCalls = w.db.upsertCalls.filter((c) => c.keys.length > 0 && c.keys.every((k) => k.startsWith('BOOK_PAGE_')));
  check('A calls: changed rows went in ONE batched upsert call', pageBatchCalls.length === 1 && pageBatchCalls[0].keys.length === 2, JSON.stringify(w.db.upsertCalls.map((c) => c.keys.length)));
  check('A calls: total upserts = batch + index + mirror (3), selects = 1', w.db.upsertCalls.length === 3 && w.db.selectCalls === 1, 'upserts=' + w.db.upsertCalls.length + ' selects=' + w.db.selectCalls);
  check('A calls: no deletes for a pure append', w.db.deleteCalls.length === 0, JSON.stringify(w.db.deleteCalls));
  const btnHist = w.document.getElementById('btnSavePageEditor')._htmlHistory;
  check('A progress: save button showed "Saving… d/t" reaching the total', btnHist.some((h) => /Saving… 4\/4/.test(h)), JSON.stringify(btnHist));
  const fresh = await freshBook(w.db, 'custom-BIG');
  check('A fresh: 62 pages persisted, the 2 appended pages are the new uploads, position 59 untouched', !!fresh && fresh.pages.length === 62 && !bigBook.pages.includes(fresh.pages[60]) && !bigBook.pages.includes(fresh.pages[61]) && fresh.pages[60] !== fresh.pages[61] && fresh.pages[59] === bigBook.pages[59], fresh && String(fresh.pages.length));
}

// ---------------------------------------------------------------------------
// B) Editor save: insert at the START of para 2 (flat position 20)
// ---------------------------------------------------------------------------
{
  const w = makeEditorWorld([bigBook, sideBook]);
  await w.run(`openPageEditor('custom-BIG')`);
  await w.run('pageEditorSelectPara(2)');
  await w.run(`pageEditorStageFiles([{ name: 'ins.png' }], 0)`);
  const okSave = await w.run('savePageEditor()');
  check('B save: succeeds', okSave === true, JSON.stringify(w.notifications.map((n) => n.msg)));
  const positions = w.db.pageWrites.filter((k) => k.startsWith('BOOK_PAGE_custom-BIG_')).map((k) => Number(k.slice('BOOK_PAGE_custom-BIG_'.length)));
  check('B writes: only positions from the insertion point onward (20..60)', positions.length === 41 && Math.min(...positions) === 20 && Math.max(...positions) === 60, JSON.stringify(positions));
  check('B writes: ZERO page writes to the other book', w.db.pageWrites.filter((k) => k.startsWith('BOOK_PAGE_custom-SIDE_')).length === 0);
  const fresh = await freshBook(w.db, 'custom-BIG');
  check('B fresh: inserted page sits at flat position 20, position 19 untouched, total 61', !!fresh && fresh.pages.length === 61 && fresh.pages[20].includes('page_1') && !bigBook.pages.includes(fresh.pages[20]) && fresh.pages[19] === bigBook.pages[19], fresh && String(fresh.pages.length));
}

// ---------------------------------------------------------------------------
// C) Delete a 30-page book: pooled storage deletes + ONE IN row delete
// ---------------------------------------------------------------------------
{
  const books = [bigBook, sideBook, delBook];
  const db = new CountingDb(seedRows(books));
  const localStorage = makeLocalStorageStub(seedLocal(books));
  const documentStub = makeDocumentStub();
  const notifications = [];
  let inFlight = 0, maxInFlight = 0, storageDeletes = 0;
  const fetchMock = (url, init = {}) => {
    if ((init.method || 'GET') === 'DELETE') {
      storageDeletes++;
      inFlight++; if (inFlight > maxInFlight) maxInFlight = inFlight;
      return new Promise((resolve) => setTimeout(() => {
        inFlight--;
        resolve({ ok: true, status: 200, json: async () => ({ ok: true, deleted: true }) });
      }, 10));
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  const ctx = vm.createContext({
    console, localStorage, db, fetch: fetchMock, URL, setTimeout, clearTimeout,
    window: {
      ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'],
      getLmsAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
    },
    document: documentStub,
    CURRENT_ROLE: 'owner', CURRENT_CURRICULUM_CATEGORY: 'all', ALHUDA_CURRICULUM: [],
    lmsConfirm: async () => true,
    lmsNotify: (msg, o) => { notifications.push({ msg: String(msg), opts: o || {} }); },
    loadCurriculumLibrary: () => {},
  });
  vm.runInContext(buildSource(), ctx);
  await vm.runInContext(`handleDeleteCurriculumBook('custom-DEL', 'Del Book')`, ctx);

  check('C storage: exactly 30 object deletes', storageDeletes === 30, String(storageDeletes));
  check('C storage: concurrency bounded (max in flight <= 6) and parallel (> 1)', maxInFlight <= 6 && maxInFlight > 1, 'max=' + maxInFlight);
  check('C rows: page rows removed with ONE IN-list delete call', db.deleteCalls.length === 1 && db.deleteCalls[0].desc === 'key IN (30)', JSON.stringify(db.deleteCalls));
  check('C commit: ZERO page-row upserts for the surviving books', db.pageWrites.length === 0, JSON.stringify(db.pageWrites.slice(0, 5)));
  check('C calls: upserts are tombstone + index + mirror only (3)', db.upsertCalls.length === 3, JSON.stringify(db.upsertCalls.map((c) => c.keys)));
  const idx = JSON.parse(db.getRow('alhuda_custom_books_index').value);
  check('C state: catalog index no longer contains the book', !idx.some((b) => b.id === 'custom-DEL'));
  check('C state: no BOOK_PAGE rows remain for the book', db.pageKeys('custom-DEL').length === 0);
  check('C state: surviving books keep all their page rows (60 + 7)', db.pageKeys('custom-BIG').length === 60 && db.pageKeys('custom-SIDE').length === 7);
  check('C state: tombstone gained the deleted id', JSON.parse(db.getRow('alhuda_deleted_books').value).includes('custom-DEL'));
  check('C state: local mirror no longer contains the book', !JSON.parse(localStorage.getItem('alhuda_custom_books')).some((b) => b.id === 'custom-DEL'));
  check('C notify: exactly one success notification', notifications.length === 1 && notifications[0].msg.includes('🗑️'), JSON.stringify(notifications.map((n) => n.msg)));
  const hist = documentStub.getElementById('btnDeleteCurriculumBookModal')._htmlHistory;
  const progressNums = hist.map((h) => { const m = h.match(/Deleting… (\d+)\/(\d+)/); return m ? Number(m[1]) : null; }).filter((n) => n !== null);
  check('C progress: delete button showed increasing counts reaching 60/60', progressNums.length >= 3 && progressNums[progressNums.length - 1] === 60 && progressNums.every((n, i) => i === 0 || n >= progressNums[i - 1]), JSON.stringify(progressNums));
}

// ---------------------------------------------------------------------------
// D) The bounded pool itself: limit honoured, stop-on-error stops queueing
// ---------------------------------------------------------------------------
{
  const w = makeEditorWorld([sideBook]);
  const out = await w.run(`(async function () {
    let inF = 0, maxF = 0, attempted = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const res = await _runBoundedPool(items, 6, async function (n) {
      attempted++; inF++; if (inF > maxF) maxF = inF;
      await new Promise((r) => setTimeout(r, 5));
      inF--;
      if (n === 7) throw new Error('boom-7');
    }, { stopOnError: true });
    return { failures: res.failures.length, attempted: attempted, maxF: maxF };
  })()`);
  check('D pool: never more than 6 in flight', out.maxF <= 6 && out.maxF > 1, JSON.stringify(out));
  check('D pool: first failure collected, queue stopped early (attempted < 20)', out.failures === 1 && out.attempted < 20 && out.attempted >= 8, JSON.stringify(out));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\ncourse-save-delete-performance: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
