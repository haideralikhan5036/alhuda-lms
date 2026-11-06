// Course Material Page Editor (js/curriculum.js + curriculum_data.js).
// Runs the REAL editor functions, the REAL chunked catalog sync and the
// REAL hydration in a vm against a stateful fake system_settings db.
// Every editing scenario ends with a FRESH-vm hydration (empty
// localStorage, same fake D1) asserting the persisted page order,
// count and URLs — the "does it survive a refresh" proof.
//
// The sync hardening under test: in the editor save path the BOOK_PAGE
// rows are written BEFORE the catalog index, and when a book shrinks
// its surplus tail rows are deleted by `key` filter before the index
// is written. The fake db keeps one ordered write log to prove it.
// Run from the repo root:  node test/course-material-editor.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const CURRICULUM = read('js/curriculum.js');
const CURRICULUM_DATA = read('curriculum_data.js');
const INDEX_HTML = read('index.html');

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
    this.writeLog = []; // ordered: { op: 'upsert'|'delete', key }
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
    // Perf fix (2026-11-06): the scoped editor save upserts page rows as
    // an ARRAY in one call (the real shim/engine accept value arrays).
    // The fake applies rows in order and logs one entry per row, so the
    // existing write-order assertions keep their meaning.
    if (Array.isArray(vals)) {
      for (const row of vals) {
        const r = this._upsert(row);
        if (r && r.error) return r;
      }
      return { data: null, error: null };
    }
    this.writeLog.push({ op: 'upsert', key: vals.key });
    if (this.failUpsertFor && vals.key === this.failUpsertFor) {
      return { data: null, error: { message: 'upsert denied by fake' } };
    }
    this.rows.set(vals.key, { id: vals.id, key: vals.key, value: vals.value });
    return { data: null, error: null };
  }
  _deleteWhere(col, val) {
    this.writeLog.push({ op: 'delete', key: col + '=' + val });
    for (const [k, r] of [...this.rows.entries()]) {
      if (String(r[col]) === String(val)) this.rows.delete(k);
    }
    return { data: null, error: null };
  }
  getRow(key) { const r = this.rows.get(key); return r ? { ...r } : null; }
  keys() { return [...this.rows.keys()]; }
  pageKeys(bookId) { return this.keys().filter((k) => k.startsWith(`BOOK_PAGE_${bookId}_`)).sort(); }
}

function makeElement(id) {
  return {
    id, value: '', innerHTML: '', innerText: '', textContent: '',
    disabled: false, style: {},
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

// ---------------------------------------------------------------------------
// Fixtures (all values SYNTHETIC)
// ---------------------------------------------------------------------------
const W = 'https://worker.test/api/storage?key=';
const U = (n) => W + 'course_material%2F' + n + '.webp';
const BUILTINS_TOMBSTONE = ['tafseer-ibn-kathir-english', 'namaz-wudu-guide', 'tafseer-bayan-ul-quran-urdu', 'holy-quran-16-line', 'noorani-qaida'];

const flatBook = {
  id: 'custom-F', title: 'Flat Book', category: 'qaida', category_label: 'Qaida & Primers',
  pages: [U('f1'), U('f2'), U('f3'), U('f4'), U('f5')], total_pages: 5,
};
const paraBook = {
  id: 'custom-P', title: 'Para Book', category: 'tafseer', category_label: 'Tafseer & Translation',
  paras_data: { '1': [U('p1a'), U('p1b')], '2': [U('p2a'), U('p2b'), U('p2c')] },
  paras: [
    { para: 1, name_en: 'Alif Lam Meem', name_ur: 'الم', page_start: 1, page_end: 2, total_pages: 2 },
    { para: 2, name_en: 'Sayaqul', name_ur: 'سيقول', page_start: 3, page_end: 5, total_pages: 3 },
  ],
  pages: [U('p1a'), U('p1b'), U('p2a'), U('p2b'), U('p2c')], total_pages: 5, total_paras: 30,
};
const rangeBook = {
  id: 'custom-R', title: 'Range Book', category: 'quran', category_label: 'The Holy Quran',
  paras: [
    { para: 1, name_en: 'Alif Lam Meem', name_ur: 'الم', page_start: 1, page_end: 2, total_pages: 2 },
    { para: 2, name_en: 'Sayaqul', name_ur: 'سيقول', page_start: 3, page_end: 4, total_pages: 2 },
  ],
  pages: [U('r1'), U('r2'), U('r3'), U('r4')], total_pages: 4, total_paras: 30,
};
const ALL_BOOKS = [flatBook, paraBook, rangeBook];
const metaOf = (b) => ({ ...b, pages: [], total_pages: b.total_pages });

function seedRows() {
  const rows = [
    { id: 'SYS-CUSTOM-BOOKS-INDEX', key: 'alhuda_custom_books_index', value: JSON.stringify(ALL_BOOKS.map(metaOf)) },
    { id: 'SYS-CUSTOM-BOOKS-ALL', key: 'alhuda_custom_books', value: JSON.stringify(ALL_BOOKS.map(metaOf)) },
    { id: 'SYS-DELETED-BOOKS', key: 'alhuda_deleted_books', value: JSON.stringify(BUILTINS_TOMBSTONE) },
  ];
  for (const b of ALL_BOOKS) {
    b.pages.forEach((v, i) => rows.push({ id: `SYS-${b.id}-P${i}`, key: `BOOK_PAGE_${b.id}_${i}`, value: v }));
  }
  return rows;
}
function seedLocal() {
  return {
    alhuda_custom_books: JSON.stringify(ALL_BOOKS),
    alhuda_deleted_books: JSON.stringify(BUILTINS_TOMBSTONE),
  };
}

const FN_NAMES = [
  'getCustomBooks', 'getDeletedBookIds', 'getBuiltinAllowlist',
  'syncCustomBooksToD1Chunked', 'hydrateCustomBooksFromCloudflareD1',
  'getAllAvailableBooks', 'renderCurriculumGrid',
  'pageEditorEsc', 'pageEditorParaList', 'pageEditorIsParaBook',
  'pageEditorRealPages', 'pageEditorParaPagesOf', 'openPageEditor',
  'pageEditorLoadWorkingList', 'renderPageEditor', 'loadPageEditorThumb',
  'pageEditorSelectPara', 'pageEditorAddFiles', 'pageEditorStageFiles',
  'pageEditorUploadPage', 'pageEditorToggleSelect', 'pageEditorRemoveOne',
  'pageEditorRemoveSelected', 'pageEditorMove', 'pageEditorDismissUploadErrors',
  'pageEditorStagedValues', 'pageEditorIsDirty', 'pageEditorIsStructural',
  'pageEditorBuildUpdatedBook', 'savePageEditor', 'requestClosePageEditor',
  // Original-page anchors (2026-11-06): the editor section gained these
  // functions; the extraction list must name them or the vm world lacks
  // functions the real page loads with the rest of curriculum.js.
  'pageEditorAnchorValue', 'pageEditorAnchorsDirty', 'pageEditorValidateAnchors',
  'pageEditorOrigStartChanged',
  // Perf fix (2026-11-06): savePageEditor now saves through the scoped
  // path; the extraction list must name its helpers or the vm world
  // lacks code the real page loads with the rest of curriculum.js.
  '_mergeEffectiveBooks', '_catalogIndexOf', '_runBoundedPool',
  '_upsertPageRowsBatched', '_saveBookPagesScoped',
];
function buildSource() {
  const decl = CURRICULUM.match(/let PAGE_EDITOR = null;/);
  if (!decl) throw new Error('PAGE_EDITOR declaration not found in js/curriculum.js');
  // Perf fix (2026-11-06): _upsertPageRowsBatched reads the module-level
  // chunk-size const; inject its declaration like PAGE_EDITOR's.
  const chunkDecl = CURRICULUM.match(/const _PAGE_UPSERT_CHUNK = \d+;/);
  if (!chunkDecl) throw new Error('_PAGE_UPSERT_CHUNK declaration not found in js/curriculum.js');
  return "let _lastCatalogSyncError = '';\nlet CURRENT_CURRICULUM_CATEGORY = 'all';\n" + decl[0] + '\n' + chunkDecl[0] + '\n'
    + extractFunction(CURRICULUM_DATA, 'getBookParaPages') + '\n'
    + FN_NAMES.map((n) => extractFunction(CURRICULUM, n)).join('\n');
}

function makeWorld(opts = {}) {
  const db = new FakeSettingsDb(seedRows());
  const localStorage = makeLocalStorageStub(seedLocal());
  const documentStub = makeDocumentStub();
  const notifications = [];
  const confirmLog = [];
  const confirmQueue = (opts.confirmQueue || []).slice();
  const openedModals = [];
  const closedModals = [];
  let libraryLoads = 0;
  const badUploads = opts.badUploads || [];
  const ctx = vm.createContext({
    console, localStorage, db, document: documentStub, URL: FakeURL,
    setTimeout, clearTimeout, fetch: async () => ({ ok: true, status: 200, blob: async () => ({ size: 10, type: 'image/webp' }) }),
    window: {
      ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'],
      getLmsAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      uploadToCloudflareR2: async (dataUrl, folder, filename) => {
        if (badUploads.some((b) => String(dataUrl).includes(b))) return dataUrl; // silent data-URI fallback, as the real helper does on storage failure
        return 'https://worker.test/api/storage?key=' + encodeURIComponent('course_material/' + filename);
      },
    },
    CURRENT_ROLE: opts.role || 'owner',
    ALHUDA_CURRICULUM: [{ id: 'interactive-madani-qaida', title: 'Al-Huda Interactive E-Qaida', category: 'qaida' }],
    QURAN_PARAS_INFO: [],
    // The creation pipeline's compression step, stubbed: decodes the
    // fake file name into a data URL; 'corrupt' files fail to decode.
    compressImageToWebP: async (file) => {
      if (file && String(file.name).includes('corrupt')) throw new Error('image decode failed');
      return 'data:image/webp;base64,' + (file ? file.name : 'unnamed');
    },
    lmsConfirm: async (msg) => { confirmLog.push(String(msg)); return confirmQueue.length ? confirmQueue.shift() : true; },
    lmsNotify: (msg, o) => { notifications.push({ msg: String(msg), opts: o || {} }); },
    openModal: (id) => { openedModals.push(id); },
    closeModal: (id) => { closedModals.push(id); },
    loadCurriculumLibrary: () => { libraryLoads++; },
  });
  vm.runInContext(buildSource(), ctx);
  return {
    db, localStorage, document: documentStub, notifications, confirmLog,
    openedModals, closedModals, ctx,
    get libraryLoads() { return libraryLoads; },
    run: (code) => vm.runInContext(code, ctx),
  };
}
// A fresh-device world: empty localStorage, the SAME fake D1.
function makeFreshLoadWorld(db) {
  const localStorage = makeLocalStorageStub({});
  const ctx = vm.createContext({
    console, localStorage, db, URL: FakeURL, setTimeout, clearTimeout,
    window: { ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'] },
    CURRENT_CURRICULUM_CATEGORY: 'all',
    ALHUDA_CURRICULUM: [],
    QURAN_PARAS_INFO: [],
    loadCurriculumLibrary: () => {},
  });
  const src = ['getCustomBooks', 'getDeletedBookIds', 'getBuiltinAllowlist', 'hydrateCustomBooksFromCloudflareD1', 'getAllAvailableBooks']
    .map((n) => extractFunction(CURRICULUM, n)).join('\n')
    + '\n' + extractFunction(CURRICULUM_DATA, 'getBookParaPages');
  vm.runInContext("let _lastCatalogSyncError = '';\n" + src, ctx);
  return { localStorage, ctx, run: (code) => vm.runInContext(code, ctx) };
}
async function freshBook(db, bookId) {
  const fresh = makeFreshLoadWorld(db);
  await fresh.run('hydrateCustomBooksFromCloudflareD1()');
  return fresh.run(`(function () { const b = getAllAvailableBooks().find(function (x) { return x.id === '${bookId}'; }); return b || null; })()`);
}
const stagedValues = (w) => w.run('pageEditorStagedValues()');
const fileOf = (name) => ({ name });

// ---------------------------------------------------------------------------
// 0) Markup + grid entry
// ---------------------------------------------------------------------------
{
  check('markup: page editor modal exists in index.html', INDEX_HTML.includes('id="modalPageEditor"'));
  check('markup: modal wires save / close / add-files handlers',
    INDEX_HTML.includes('onclick="savePageEditor()"') && INDEX_HTML.includes('onclick="requestClosePageEditor()"') && INDEX_HTML.includes('onchange="pageEditorAddFiles(this)"'));
  const w = makeWorld();
  w.run(`renderCurriculumGrid(getAllAvailableBooks())`);
  const html = w.document.getElementById('curriculumGrid').innerHTML;
  check('grid: Edit Pages entry on the custom book card', html.includes("openPageEditor('custom-F')"), html.slice(0, 200));
  check('grid: NO Edit Pages entry for the built-in book', !html.includes("openPageEditor('interactive-madani-qaida')"));
}

// ---------------------------------------------------------------------------
// 1) Add at end (pure append, no history warning) + fresh-load proof
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  check('open: flat book opens in the editor', await w.run(`openPageEditor('custom-F')`) === true);
  check('open: modal opened, staged = 5 originals', w.openedModals.includes('modalPageEditor') && stagedValues(w).length === 5);
  const okStage = await w.run(`pageEditorStageFiles([{ name: 'new1.png' }, { name: 'new2.png' }], 5)`);
  check('append: both files staged as new', okStage === true && stagedValues(w).length === 7 && w.run('PAGE_EDITOR.staged[6].isNew') === true);
  check('append: list render shows 7 page cards with numbers', (w.document.getElementById('pageEditorList').innerHTML.match(/data-editor-thumb-idx=/g) || []).length === 7
    && w.document.getElementById('pageEditorList').innerHTML.includes('Page 7'));
  const okSave = await w.run('savePageEditor()');
  check('append: save succeeds with NO lesson-history confirmation', okSave === true && w.confirmLog.length === 0, JSON.stringify(w.confirmLog));
  check('append: success notification, editor closed, library re-rendered',
    w.notifications.some((n) => n.msg.includes('✅ Pages saved')) && w.closedModals.includes('modalPageEditor') && w.libraryLoads === 1);
  check('append: new BOOK_PAGE rows written', w.db.pageKeys('custom-F').length === 7 && w.db.getRow('BOOK_PAGE_custom-F_6').value.includes('page_2.webp'));
  const fresh = await freshBook(w.db, 'custom-F');
  check('append: FRESH LOAD order + count persisted', !!fresh && fresh.pages.length === 7
    && fresh.pages.slice(0, 5).every((v, i) => v === flatBook.pages[i]) && fresh.total_pages === 7, JSON.stringify(fresh && fresh.pages));
}

// ---------------------------------------------------------------------------
// 2) Insert before a middle page (structural: warning shown)
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  await w.run(`openPageEditor('custom-F')`);
  await w.run(`pageEditorStageFiles([{ name: 'mid.png' }], 1)`);
  check('insert: staged order has the new page at position 2',
    stagedValues(w)[0] === flatBook.pages[0] && stagedValues(w)[2] === flatBook.pages[1] && stagedValues(w).length === 6);
  const okSave = await w.run('savePageEditor()');
  check('insert: lesson-history warning WAS shown before saving', okSave === true && w.confirmLog.some((m) => m.includes('page NUMBER')), JSON.stringify(w.confirmLog));
  const fresh = await freshBook(w.db, 'custom-F');
  check('insert: FRESH LOAD persisted the inserted order', !!fresh && fresh.pages.length === 6
    && fresh.pages[0] === flatBook.pages[0] && fresh.pages[2] === flatBook.pages[1] && fresh.pages[5] === flatBook.pages[4]);
}

// ---------------------------------------------------------------------------
// 3) Remove a middle page: tail row deleted, pages written before index
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  await w.run(`openPageEditor('custom-F')`);
  w.run('pageEditorRemoveOne(2)');
  check('remove: staged drops page 3 only', JSON.stringify(stagedValues(w)) === JSON.stringify([flatBook.pages[0], flatBook.pages[1], flatBook.pages[3], flatBook.pages[4]]));
  const okSave = await w.run('savePageEditor()');
  check('remove: save succeeds (warning confirmed by default)', okSave === true && w.confirmLog.length === 1);
  const log = w.db.writeLog;
  const firstPageUpsert = log.findIndex((e) => e.op === 'upsert' && e.key.startsWith('BOOK_PAGE_custom-F_'));
  const indexUpsert = log.findIndex((e) => e.op === 'upsert' && e.key === 'alhuda_custom_books_index');
  const tailDelete = log.findIndex((e) => e.op === 'delete' && e.key === 'key=BOOK_PAGE_custom-F_4');
  check('hardening: page rows written BEFORE the catalog index', firstPageUpsert >= 0 && indexUpsert > firstPageUpsert, JSON.stringify(log.slice(0, 4)));
  check('hardening: surplus tail row deleted by key, before the index write', tailDelete > firstPageUpsert && tailDelete < indexUpsert, JSON.stringify(log));
  check('remove: D1 holds exactly the 4 surviving rows in order',
    JSON.stringify(w.db.pageKeys('custom-F')) === JSON.stringify(['BOOK_PAGE_custom-F_0', 'BOOK_PAGE_custom-F_1', 'BOOK_PAGE_custom-F_2', 'BOOK_PAGE_custom-F_3'])
    && w.db.getRow('BOOK_PAGE_custom-F_2').value === flatBook.pages[3]);
  const fresh = await freshBook(w.db, 'custom-F');
  check('remove: FRESH LOAD shows 4 pages, shifted correctly', !!fresh && fresh.pages.length === 4 && fresh.pages[2] === flatBook.pages[3] && fresh.total_pages === 4);
}

// ---------------------------------------------------------------------------
// 4) Multi-select removal: review confirm lists pages; decline stages none
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ confirmQueue: [false, true] });
  await w.run(`openPageEditor('custom-F')`);
  w.run('pageEditorToggleSelect(0, true); pageEditorToggleSelect(3, true);');
  const declined = await w.run('pageEditorRemoveSelected()');
  check('multi-remove: review confirm names count + page numbers', w.confirmLog.length === 1 && w.confirmLog[0].includes('2 page(s)') && w.confirmLog[0].includes('Pages: 1, 4'), JSON.stringify(w.confirmLog));
  check('multi-remove: declining the review stages NOTHING out', declined === false && stagedValues(w).length === 5);
  w.run('pageEditorToggleSelect(0, true); pageEditorToggleSelect(3, true);');
  const accepted = await w.run('pageEditorRemoveSelected()');
  check('multi-remove: accepting stages exactly pages 1 and 4 out', accepted === true
    && JSON.stringify(stagedValues(w)) === JSON.stringify([flatBook.pages[1], flatBook.pages[2], flatBook.pages[4]]));
  const okSave = await w.run('savePageEditor()');
  const fresh = await freshBook(w.db, 'custom-F');
  check('multi-remove: FRESH LOAD persisted', okSave === true && !!fresh && JSON.stringify(fresh.pages) === JSON.stringify([flatBook.pages[1], flatBook.pages[2], flatBook.pages[4]]));
}

// ---------------------------------------------------------------------------
// 5) Reorder via move controls + boundary no-ops
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  await w.run(`openPageEditor('custom-F')`);
  w.run('pageEditorMove(0, -1)');
  check('reorder: moving the first page up is a no-op', JSON.stringify(stagedValues(w)) === JSON.stringify(flatBook.pages));
  w.run('pageEditorMove(4, -1); pageEditorMove(3, -1);');
  const expected = [flatBook.pages[0], flatBook.pages[1], flatBook.pages[4], flatBook.pages[2], flatBook.pages[3]];
  check('reorder: move-up twice brings page 5 to position 3', JSON.stringify(stagedValues(w)) === JSON.stringify(expected), JSON.stringify(stagedValues(w)));
  const okSave = await w.run('savePageEditor()');
  check('reorder: save asked the history warning', okSave === true && w.confirmLog.some((m) => m.includes('page NUMBER')));
  const fresh = await freshBook(w.db, 'custom-F');
  check('reorder: FRESH LOAD persisted the new sequence', !!fresh && JSON.stringify(fresh.pages) === JSON.stringify(expected));
}

// ---------------------------------------------------------------------------
// 6) Para book with paras_data: edit ONE para only
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  check('para: editor opens as para-based with para 1 staged', await w.run(`openPageEditor('custom-P')`) === true
    && w.run('PAGE_EDITOR.isPara') === true && JSON.stringify(stagedValues(w)) === JSON.stringify(paraBook.paras_data['1']));
  await w.run('pageEditorSelectPara(2)');
  check('para: switching loads para 2 pages', JSON.stringify(stagedValues(w)) === JSON.stringify(paraBook.paras_data['2']));
  w.run('pageEditorRemoveOne(0)');
  const okSave = await w.run('savePageEditor()');
  check('para: save succeeds', okSave === true);
  const idx = JSON.parse(w.db.getRow('alhuda_custom_books_index').value).find((b) => b.id === 'custom-P');
  check('para: paras_data of the OTHER para untouched', JSON.stringify(idx.paras_data['1']) === JSON.stringify(paraBook.paras_data['1']));
  check('para: edited para rows updated', JSON.stringify(idx.paras_data['2']) === JSON.stringify([paraBook.paras_data['2'][1], paraBook.paras_data['2'][2]]));
  check('para: ranges recomputed (para 1 same, para 2 shifted)', idx.paras[0].page_start === 1 && idx.paras[0].page_end === 2
    && idx.paras[1].page_start === 3 && idx.paras[1].page_end === 4 && idx.paras[1].total_pages === 2, JSON.stringify(idx.paras));
  check('para: tail BOOK_PAGE row pruned', JSON.stringify(w.db.pageKeys('custom-P')) === JSON.stringify(['BOOK_PAGE_custom-P_0', 'BOOK_PAGE_custom-P_1', 'BOOK_PAGE_custom-P_2', 'BOOK_PAGE_custom-P_3']));
  const fresh = makeFreshLoadWorld(w.db);
  await fresh.run('hydrateCustomBooksFromCloudflareD1()');
  check('para: FRESH LOAD para slices resolve correctly',
    JSON.stringify(fresh.run(`getBookParaPages(getAllAvailableBooks().find(function (x) { return x.id === 'custom-P'; }), 1)`)) === JSON.stringify(paraBook.paras_data['1'])
    && JSON.stringify(fresh.run(`getBookParaPages(getAllAvailableBooks().find(function (x) { return x.id === 'custom-P'; }), 2)`)) === JSON.stringify([paraBook.paras_data['2'][1], paraBook.paras_data['2'][2]]));
}

// ---------------------------------------------------------------------------
// 7) Para book with ranges only: slice edit, ranges recomputed, no
//    paras_data invented; append inside a para needs no warning
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  await w.run(`openPageEditor('custom-R')`);
  await w.run(`pageEditorStageFiles([{ name: 'extra.png' }], 2)`);
  const okSave = await w.run('savePageEditor()');
  check('range-para: in-para append saves WITHOUT the history warning', okSave === true && w.confirmLog.length === 0, JSON.stringify(w.confirmLog));
  const idx = JSON.parse(w.db.getRow('alhuda_custom_books_index').value).find((b) => b.id === 'custom-R');
  check('range-para: no paras_data invented by the save', !('paras_data' in idx) || idx.paras_data == null, JSON.stringify(Object.keys(idx)));
  check('range-para: ranges recomputed across both paras', idx.paras[0].page_start === 1 && idx.paras[0].page_end === 3 && idx.paras[0].total_pages === 3
    && idx.paras[1].page_start === 4 && idx.paras[1].page_end === 5 && idx.paras[1].total_pages === 2, JSON.stringify(idx.paras));
  const fresh = makeFreshLoadWorld(w.db);
  await fresh.run('hydrateCustomBooksFromCloudflareD1()');
  check('range-para: FRESH LOAD para 2 slice intact after para 1 grew',
    JSON.stringify(fresh.run(`getBookParaPages(getAllAvailableBooks().find(function (x) { return x.id === 'custom-R'; }), 2)`)) === JSON.stringify([rangeBook.pages[2], rangeBook.pages[3]]));
}

// ---------------------------------------------------------------------------
// 8) Warning matrix: declining the history warning aborts the save
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ confirmQueue: [false] });
  await w.run(`openPageEditor('custom-F')`);
  w.run('pageEditorRemoveOne(1)');
  const okSave = await w.run('savePageEditor()');
  check('warn-decline: save aborted, NOTHING written', okSave === false && w.db.writeLog.length === 0, JSON.stringify(w.db.writeLog));
  check('warn-decline: editor still open with staged changes intact', w.run('PAGE_EDITOR !== null') === true && stagedValues(w).length === 4);
  check('warn-decline: no success notification', !w.notifications.some((n) => n.msg.includes('✅')));
}

// ---------------------------------------------------------------------------
// 9) Failed uploads: named, not staged, and they BLOCK the save
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ badUploads: ['bad.png'] });
  await w.run(`openPageEditor('custom-F')`);
  const staged = await w.run(`pageEditorStageFiles([{ name: 'good.png' }, { name: 'bad.png' }, { name: 'corrupt.png' }], 5)`);
  check('upload-fail: good file staged, failed files NOT staged', staged === false && stagedValues(w).length === 6 && w.run('PAGE_EDITOR.staged[5].isNew') === true);
  check('upload-fail: failures recorded by name', JSON.stringify(w.run('PAGE_EDITOR.uploadErrors')) === JSON.stringify(['bad.png', 'corrupt.png']), JSON.stringify(w.run('PAGE_EDITOR.uploadErrors')));
  check('upload-fail: notification names the failed files', w.notifications.some((n) => n.msg.includes('bad.png') && n.msg.includes('corrupt.png')), JSON.stringify(w.notifications.map((n) => n.msg)));
  const blocked = await w.run('savePageEditor()');
  check('upload-fail: save BLOCKED while the notice stands (nothing written)', blocked === false && w.db.writeLog.length === 0);
  w.run('pageEditorDismissUploadErrors()');
  const okSave = await w.run('savePageEditor()');
  const fresh = await freshBook(w.db, 'custom-F');
  check('upload-fail: after dismiss, save persists the good page only', okSave === true && !!fresh && fresh.pages.length === 6 && fresh.pages[5].includes('page_1.webp'));
}

// ---------------------------------------------------------------------------
// 10) Mid-save store failure: honest error, editor intact, retry converges
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  w.db.failUpsertFor = 'BOOK_PAGE_custom-F_2';
  await w.run(`openPageEditor('custom-F')`);
  w.run('pageEditorRemoveOne(0)');
  const failed = await w.run('savePageEditor()');
  check('save-fail: save reports failure with an error notification', failed === false
    && w.notifications.some((n) => n.opts.type === 'error' && n.msg.includes('could NOT be saved')), JSON.stringify(w.notifications.map((n) => n.msg)));
  check('save-fail: editor stays open, staged changes intact', w.run('PAGE_EDITOR !== null') === true && stagedValues(w).length === 4 && !w.closedModals.includes('modalPageEditor'));
  check('save-fail: local mirror NOT advanced past the failed save', JSON.parse(w.localStorage.getItem('alhuda_custom_books')).find((b) => b.id === 'custom-F').pages.length === 5);
  w.db.failUpsertFor = null;
  const retried = await w.run('savePageEditor()');
  const fresh = await freshBook(w.db, 'custom-F');
  check('save-fail: retry succeeds and FRESH LOAD converges to the staged state', retried === true && !!fresh
    && JSON.stringify(fresh.pages) === JSON.stringify(flatBook.pages.slice(1)), JSON.stringify(fresh && fresh.pages));
}

// ---------------------------------------------------------------------------
// 11) Roles: manager can edit + save; built-ins cannot be opened
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ role: 'manager' });
  check('manager: editor opens for a custom book', await w.run(`openPageEditor('custom-F')`) === true);
  await w.run(`pageEditorStageFiles([{ name: 'mgr.png' }], 5)`);
  check('manager: save succeeds through the same path', await w.run('savePageEditor()') === true);
  const fresh = await freshBook(w.db, 'custom-F');
  check('manager: FRESH LOAD shows the manager-saved page', !!fresh && fresh.pages.length === 6);
}
{
  const w = makeWorld();
  const opened = await w.run(`openPageEditor('interactive-madani-qaida')`);
  check('built-in: editor refuses (no uploaded pages) with an explanation', opened === false && w.run('PAGE_EDITOR') === null
    && w.notifications.some((n) => n.opts.type === 'error'));
}

// ---------------------------------------------------------------------------
// 12) Closing with unsaved changes asks first; para switch asks too
// ---------------------------------------------------------------------------
{
  const w = makeWorld({ confirmQueue: [false, true] });
  await w.run(`openPageEditor('custom-F')`);
  w.run('pageEditorRemoveOne(0)');
  await w.run('requestClosePageEditor()');
  check('close-guard: declining keeps the editor open', !w.closedModals.includes('modalPageEditor') && w.run('PAGE_EDITOR !== null') === true);
  await w.run('requestClosePageEditor()');
  check('close-guard: confirming discards and closes', w.closedModals.includes('modalPageEditor') && w.run('PAGE_EDITOR') === null);
}
{
  const w = makeWorld({ confirmQueue: [false] });
  await w.run(`openPageEditor('custom-P')`);
  w.run('pageEditorRemoveOne(0)');
  await w.run('pageEditorSelectPara(2)');
  check('para-switch guard: declining keeps para 1 and its staged changes', w.run('PAGE_EDITOR.para') === 1 && stagedValues(w).length === 1);
}

// ---------------------------------------------------------------------------
// 13) Add-files control: insert-before position read from the modal inputs
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  await w.run(`openPageEditor('custom-F')`);
  w.document.getElementById('pageEditorInsertMode').value = 'before';
  w.document.getElementById('pageEditorInsertBefore').value = '3';
  await w.run(`pageEditorAddFiles({ files: [{ name: 'ins.png' }], value: 'x' })`);
  check('add-control: file inserted before page 3', stagedValues(w).length === 6 && stagedValues(w)[2].includes('page_1.webp') && stagedValues(w)[3] === flatBook.pages[2], JSON.stringify(stagedValues(w)));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\ncourse-material-editor: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
