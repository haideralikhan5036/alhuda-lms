// Quran Original Page Numbering (2026-11-06) — para-based books display
// each page's ORIGINAL (printed) page number instead of restarting at
// Page 1 per para. Design (see the investigation report):
//   * book.paras entries gain an OPTIONAL orig_start (the printed page
//     number of the para's first page); absent => defaults to the
//     para's global page_start, so un-anchored books need no migration.
//   * Conversion lives in ONE shared helper (js/lesson-history.js,
//     exposed as LessonHistory.* and window.OrigPages) keyed off
//     book.paras — never the hardcoded registries.
//   * Saved records keep their semantics: `page` stays para-relative
//     and the resolver contract is untouched; teacher writers ADD
//     `orig_page`; displays prefer the stored orig_page, else convert.
//   * The Page Editor edits anchors (strictly increasing across paras)
//     and labels cards by original number.
// Everything below executes the REAL functions in vm harnesses in the
// style of the existing suites (fixtures only — no live data).
// Run from the repo root:  node test/quran-original-numbering.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const LH_SRC = read('js/lesson-history.js');
const CURR = read('js/curriculum.js');
const CDATA = read('curriculum_data.js');
const TEACHER = read('teacher.html');
const PARENT = read('parent.html');
const P360 = read('js/profiles360.js');
const INDEX_HTML = read('index.html');
const SECURITY = read('js/security.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}
function seg(src, from, to) {
  const a = src.indexOf(from);
  const b = to ? src.indexOf(to, a + 1) : -1;
  return a < 0 ? '' : src.slice(a, b < 0 ? undefined : b);
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
// Fixtures — a Quran-shaped book: P1 20 pages, P2 18, P3 22 (global 1-60),
// mirroring the real book's uneven para lengths (NOT the registries'
// invented uniform 18).
// ---------------------------------------------------------------------------
const U = (prefix, n) => Array.from({ length: n }, (_, i) => 'https://cdn.test/' + prefix + (i + 1) + '.webp');
function quranParas(anchor2, anchor3) {
  const paras = [
    { para: 1, name_en: 'Alif Lam Meem', page_start: 1, page_end: 20, total_pages: 20 },
    { para: 2, name_en: 'Sayaqul', page_start: 21, page_end: 38, total_pages: 18 },
    { para: 3, name_en: 'Tilkal Rusul', page_start: 39, page_end: 60, total_pages: 22 },
  ];
  if (anchor2 != null) paras[1].orig_start = anchor2;
  if (anchor3 != null) paras[2].orig_start = anchor3;
  return paras;
}
const QURAN_DEFAULT = { id: 'quran-default', title: 'HOLY QURAN 16 LINE', category: 'quran', total_pages: 60, pages: U('q', 60), paras: quranParas() };
const QURAN_ANCHORED = { id: 'quran-anchored', title: 'HOLY QURAN 16 LINE', category: 'quran', total_pages: 60, pages: U('q', 60), paras: quranParas(102, 121) };
const QAIDA = { id: 'qaida-flat', title: 'Qaida Book', category: 'qaida', total_pages: 33, pages: U('n', 33) };

// Load the real shared module once; its API objects are plain closures
// and are reused as window.LessonHistory in the later vm worlds.
function loadLessonHistory(extra = {}) {
  const sandbox = { console, URL, FormData, fetch: async () => { throw new Error('no fetch in unit tests'); }, ...extra };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LH_SRC + '\nthis.__LH = LessonHistory; this.__OP = OrigPages;', sandbox);
  return sandbox;
}
const lhWorld = loadLessonHistory();
const LH = lhWorld.__LH;
const OP = lhWorld.__OP;
if (!LH || !OP) { console.log('FAIL | OrigPages helper did not load'); process.exit(1); }

// ===========================================================================
// A) The shared conversion helper
// ===========================================================================
check('helper: exposed on LessonHistory AND as window.OrigPages',
  typeof LH.origPageFor === 'function' && typeof OP.origPageFor === 'function' && OP.origPageFor === LH.origPageFor);
check('helper: default anchors reproduce global positions (para 2 rel 1 -> 21)',
  OP.origPageFor(QURAN_DEFAULT, 2, 1) === 21 && OP.origStartFor(QURAN_DEFAULT, 2) === 21);
check('helper: default anchors, para edges (P1 last -> 20, P2 last -> 38, P3 last -> 60)',
  OP.origPageFor(QURAN_DEFAULT, 1, 20) === 20 && OP.origPageFor(QURAN_DEFAULT, 2, 18) === 38 && OP.origPageFor(QURAN_DEFAULT, 3, 22) === 60);
check('helper: default range + book-end total (last original = 60)',
  JSON.stringify(OP.origRangeFor(QURAN_DEFAULT, 2)) === '[21,38]' && OP.lastOrigPageFor(QURAN_DEFAULT) === 60);
check('helper: custom anchor shifts its para (P2 rel 1 -> 102, rel 18 -> 119)',
  OP.origPageFor(QURAN_ANCHORED, 2, 1) === 102 && OP.origPageFor(QURAN_ANCHORED, 2, 18) === 119);
check('helper: anchor on para 3 does NOT alter para 2 or para 1 numbers',
  OP.origPageFor(QURAN_ANCHORED, 1, 20) === 20 && OP.origPageFor(QURAN_ANCHORED, 2, 5) === 106 && OP.origPageFor(QURAN_ANCHORED, 3, 1) === 121);
check('helper: anchored book-end total follows the last para anchor (121+22-1 = 142)',
  OP.lastOrigPageFor(QURAN_ANCHORED) === 142);
check('helper: inverse round-trips (orig -> rel -> orig)',
  [1, 2, 3].every((p) => [1, 5, 9].every((r) => OP.relPageForOrig(QURAN_ANCHORED, p, OP.origPageFor(QURAN_ANCHORED, p, r)) === r)));
check('helper: out-of-range original -> null (below start, in the gap, past end)',
  OP.relPageForOrig(QURAN_ANCHORED, 2, 101) === null && OP.relPageForOrig(QURAN_ANCHORED, 2, 120) === null && OP.relPageForOrig(QURAN_ANCHORED, 3, 143) === null);
check('helper: para-relative page beyond the para length -> null',
  OP.origPageFor(QURAN_ANCHORED, 2, 19) === null && OP.origPageFor(QURAN_DEFAULT, 1, 21) === null && OP.origPageFor(QURAN_DEFAULT, 2, 0) === null);
check('helper: para missing from book.paras -> null (never the registry)', OP.origPageFor(QURAN_DEFAULT, 7, 1) === null);
check('helper: flat book converts nothing', OP.origPageFor(QAIDA, 1, 1) === null && OP.lastOrigPageFor(QAIDA) === null && OP.origStartFor(QAIDA, 1) === null);

// origPageForEntry — the render-time display resolver for history rows.
check('entry: stored orig_page wins over conversion (payload object raw)',
  OP.origPageForEntry({ bookId: 'quran-anchored', para: 2, page: 5, raw: { book_id: 'quran-anchored', para: 2, page: 5, orig_page: 105 } }, [QURAN_ANCHORED]) === 105);
check('entry: stored orig_page wins via the attendance row lesson_notes',
  OP.origPageForEntry({ bookId: 'quran-anchored', para: 2, page: 5, raw: { lesson_notes: JSON.stringify({ para: 2, page: 5, orig_page: 105 }) } }, [QURAN_ANCHORED]) === 105);
check('entry: stored orig_page wins via a raw JSON string',
  OP.origPageForEntry({ bookId: 'quran-anchored', para: 2, page: 5, raw: JSON.stringify({ orig_page: 105 }) }, [QURAN_ANCHORED]) === 105);
check('entry: legacy record WITHOUT orig_page converts via anchors (102 + 5 - 1 = 106)',
  OP.origPageForEntry({ bookId: 'quran-anchored', para: 2, page: 5, raw: { para: 2, page: 5 } }, [QURAN_ANCHORED]) === 106);
check('entry: legacy record on a default-anchored book converts to the global position (25)',
  OP.origPageForEntry({ bookId: 'quran-default', para: 2, page: 5, raw: {} }, [QURAN_DEFAULT]) === 25);
check('entry: flat-book record is not convertible (renders as stored)',
  OP.origPageForEntry({ bookId: 'qaida-flat', para: null, page: 7, raw: {} }, [QAIDA]) === null);
check('entry: unknown book / missing para -> null',
  OP.origPageForEntry({ bookId: 'nope', para: 2, page: 5, raw: {} }, [QURAN_ANCHORED]) === null &&
  OP.origPageForEntry({ bookId: 'quran-anchored', para: null, page: 5, raw: {} }, [QURAN_ANCHORED]) === null);
// The resolver contract is untouched by the helper's arrival.
check('resolver: para-relative contract unchanged (para 2 page 5 still resolves para-relatively)',
  (() => { const r = LH.resolveLessonPage({ bookId: 'quran-default', page: 5, para: 2 }, [QURAN_DEFAULT]); return r.ok === true && r.displayPage === 5 && r.pageIndex === 4; })());

// ===========================================================================
// B) Page Editor — anchors (harness mirrors test/course-material-editor)
// ===========================================================================
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
    this.writeLog = [];
  }
  from() {
    const self = this;
    return { select: () => new SelBuilder(self), upsert: (vals) => Promise.resolve(self._upsert(vals)), delete: () => new DelBuilder(self) };
  }
  _all() { return [...this.rows.values()].map((r) => ({ ...r })); }
  _upsert(vals) {
    this.writeLog.push({ op: 'upsert', key: vals.key });
    if (this.failUpsertFor && vals.key === this.failUpsertFor) return { data: null, error: { message: 'upsert denied by fake' } };
    this.rows.set(vals.key, { id: vals.id, key: vals.key, value: vals.value });
    return { data: null, error: null };
  }
  _deleteWhere(col, val) {
    this.writeLog.push({ op: 'delete', key: col + '=' + val });
    for (const [k, r] of [...this.rows.entries()]) if (String(r[col]) === String(val)) this.rows.delete(k);
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
class FakeURL extends URL { static createObjectURL() { return 'blob:fake-thumb'; } static revokeObjectURL() {} }

const EDITOR_QURAN = {
  id: 'custom-QN', title: 'HOLY QURAN (TEST)', category: 'quran', category_label: 'The Holy Quran',
  paras: quranParas(), pages: U('q', 60), total_pages: 60, total_paras: 3,
};
const metaOf = (b) => ({ ...b, pages: [], total_pages: b.total_pages });
function editorSeedRows(books) {
  const rows = [
    { id: 'SYS-CUSTOM-BOOKS-INDEX', key: 'alhuda_custom_books_index', value: JSON.stringify(books.map(metaOf)) },
    { id: 'SYS-CUSTOM-BOOKS-ALL', key: 'alhuda_custom_books', value: JSON.stringify(books.map(metaOf)) },
    { id: 'SYS-DELETED-BOOKS', key: 'alhuda_deleted_books', value: JSON.stringify([]) },
  ];
  for (const b of books) b.pages.forEach((v, i) => rows.push({ id: `SYS-${b.id}-P${i}`, key: `BOOK_PAGE_${b.id}_${i}`, value: v }));
  return rows;
}
const EDITOR_FN_NAMES = [
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
  'pageEditorAnchorValue', 'pageEditorAnchorsDirty', 'pageEditorValidateAnchors',
  'pageEditorOrigStartChanged',
];
function editorBuildSource() {
  const decl = CURR.match(/let PAGE_EDITOR = null;/);
  if (!decl) throw new Error('PAGE_EDITOR declaration not found in js/curriculum.js');
  return "let _lastCatalogSyncError = '';\nlet CURRENT_CURRICULUM_CATEGORY = 'all';\n" + decl[0] + '\n'
    + extractFunction(CDATA, 'getBookParaPages') + '\n'
    + EDITOR_FN_NAMES.map((n) => extractFunction(CURR, n)).join('\n');
}
function makeEditorWorld(books, db) {
  const localStorage = makeLocalStorageStub({
    alhuda_custom_books: JSON.stringify(books),
    alhuda_deleted_books: JSON.stringify([]),
  });
  const documentStub = makeDocumentStub();
  const notifications = [];
  const confirmLog = [];
  const ctx = vm.createContext({
    console, localStorage, db, document: documentStub, URL: FakeURL,
    setTimeout, clearTimeout, fetch: async () => ({ ok: true, status: 200, blob: async () => ({ size: 10, type: 'image/webp' }) }),
    window: {
      ALHUDA_BUILTIN_ALLOWLIST: ['interactive-madani-qaida'],
      getLmsAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      uploadToCloudflareR2: async (dataUrl, folder, filename) => 'https://worker.test/api/storage?key=' + encodeURIComponent('course_material/' + filename),
    },
    CURRENT_ROLE: 'owner',
    ALHUDA_CURRICULUM: [{ id: 'interactive-madani-qaida', title: 'Al-Huda Interactive E-Qaida', category: 'qaida' }],
    QURAN_PARAS_INFO: [],
    compressImageToWebP: async (file) => 'data:image/webp;base64,' + (file ? file.name : 'unnamed'),
    lmsConfirm: async (msg) => { confirmLog.push(String(msg)); return true; },
    lmsNotify: (msg, o) => { notifications.push({ msg: String(msg), opts: o || {} }); },
    openModal: () => {}, closeModal: () => {}, loadCurriculumLibrary: () => {},
  });
  ctx.window.window = ctx.window;
  vm.runInContext(editorBuildSource(), ctx);
  return { db, localStorage, document: documentStub, notifications, confirmLog, ctx, run: (code) => vm.runInContext(code, ctx) };
}
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
    .map((n) => extractFunction(CURR, n)).join('\n')
    + '\n' + extractFunction(CDATA, 'getBookParaPages');
  vm.runInContext("let _lastCatalogSyncError = '';\n" + src, ctx);
  return { localStorage, ctx, run: (code) => vm.runInContext(code, ctx) };
}
async function freshBook(db, bookId) {
  const fresh = makeFreshLoadWorld(db);
  await fresh.run('hydrateCustomBooksFromCloudflareD1()');
  return fresh.run(`(function () { const b = getAllAvailableBooks().find(function (x) { return x.id === '${bookId}'; }); return b || null; })()`);
}

check('editor markup: anchor field exists in the para row, wired to its handler',
  INDEX_HTML.includes('id="pageEditorOrigStart"') && INDEX_HTML.includes('pageEditorOrigStartChanged(this.value)')
  && INDEX_HTML.includes("Original page # of this Para's first page"));

{
  const db = new FakeSettingsDb(editorSeedRows([EDITOR_QURAN]));
  const w = makeEditorWorld([EDITOR_QURAN], db);
  check('editor: para book opens', await w.run(`openPageEditor('custom-QN')`) === true);
  check('editor: effective anchors default to the global page_starts',
    w.run('JSON.stringify(PAGE_EDITOR.origAnchors)') === '{"1":1,"2":21,"3":39}', w.run('JSON.stringify(PAGE_EDITOR.origAnchors)'));
  check('editor: anchor field prefilled with the effective anchor (Para 1 -> 1)',
    w.document.getElementById('pageEditorOrigStart').value === '1', w.document.getElementById('pageEditorOrigStart').value);
  const listHtml1 = w.document.getElementById('pageEditorList').innerHTML;
  check('editor: cards labelled by ORIGINAL number with para-relative context',
    listHtml1.includes('Page 1') && listHtml1.includes('Page 20') && listHtml1.includes('Para 1 &bull; page 1 of 20'),
    listHtml1.slice(0, 300));

  await w.run('pageEditorSelectPara(2)');
  check('editor: Para 2 anchor prefilled with its global start (21)',
    w.document.getElementById('pageEditorOrigStart').value === '21');
  const listHtml2 = w.document.getElementById('pageEditorList').innerHTML;
  check('editor: Para 2 cards run 21..38 under default anchors',
    listHtml2.includes('Page 21') && listHtml2.includes('Page 38') && !listHtml2.includes('Page 39'));

  w.run(`pageEditorOrigStartChanged('102')`);
  const listHtml3 = w.document.getElementById('pageEditorList').innerHTML;
  check('editor: changing the anchor relabels the cards (102..119)',
    listHtml3.includes('Page 102') && listHtml3.includes('Page 119') && !listHtml3.includes('Page 21'));
  check('editor: anchor-only change is dirty but NOT structural',
    w.run('pageEditorIsDirty()') === true && w.run('pageEditorIsStructural()') === false);
  // Anchors must increase across the WHOLE book: moving Para 2 to 102
  // obliges Para 3 to move past 119 as well (a real admin anchoring a
  // 15-line-style book does exactly this). Set Para 3 to 121.
  await w.run('pageEditorSelectPara(3)');
  w.run(`pageEditorOrigStartChanged('121')`);
  const listHtml4 = w.document.getElementById('pageEditorList').innerHTML;
  check('editor: Para 3 cards relabel from its own anchor (121..142)',
    listHtml4.includes('Page 121') && listHtml4.includes('Page 142'));

  const pageRowsBefore = db.pageKeys('custom-QN').map((k) => k + '=' + db.getRow(k).value).join('|');
  const confirmsBeforeSave = w.confirmLog.length;
  const okSave = await w.run('savePageEditor()');
  check('editor: anchor-only save succeeds with no history warning during the save',
    okSave === true && w.confirmLog.length === confirmsBeforeSave, JSON.stringify(w.confirmLog));
  const pageRowsAfter = db.pageKeys('custom-QN').map((k) => k + '=' + db.getRow(k).value).join('|');
  check('editor: anchor-only save leaves every page row byte-identical', pageRowsBefore === pageRowsAfter);
  const saved = await freshBook(db, 'custom-QN');
  check('editor: changed anchors persist through a fresh hydration (Para 2 = 102, Para 3 = 121)',
    saved && saved.paras.find((p) => p.para === 2).orig_start === 102 && saved.paras.find((p) => p.para === 3).orig_start === 121,
    JSON.stringify(saved && saved.paras));
  check('editor: the untouched para keeps its effective anchor (Para 1 = 1)',
    saved.paras.find((p) => p.para === 1).orig_start === 1);

  // Rejection world: seed from the SAVED book (Para 2 anchored at 102).
  const savedFull = { ...saved, pages: U('q', 60) };
  const w2 = makeEditorWorld([savedFull], db);
  await w2.run(`openPageEditor('custom-QN')`);
  check('editor: reopened editor prefills the saved anchor (Para 2 -> 102)',
    (await w2.run('pageEditorSelectPara(2)'), w2.document.getElementById('pageEditorOrigStart').value === '102'));
  await w2.run('pageEditorSelectPara(3)');
  w2.run(`pageEditorOrigStartChanged('100')`); // 100 <= 102: overlaps Para 2's range
  const writesBefore = db.writeLog.length;
  const badSave = await w2.run('savePageEditor()');
  const rejection = w2.notifications.map((n) => n.msg).join('\n');
  check('editor: non-increasing anchors are rejected, naming both conflicting paras',
    badSave === false && rejection.includes('Para 3') && rejection.includes('Para 2'), rejection.slice(0, 200));
  check('editor: a rejected save writes NOTHING', db.writeLog.length === writesBefore);
  const stillSaved = await freshBook(db, 'custom-QN');
  check('editor: stored anchors unchanged after the rejection (Para 3 still 121)',
    stillSaved.paras.find((p) => p.para === 3).orig_start === 121);
  w2.run(`pageEditorOrigStartChanged('0')`);
  const zeroSave = await w2.run('savePageEditor()');
  check('editor: a zero anchor is rejected as not a positive whole number',
    zeroSave === false && w2.notifications.some((n) => n.msg.includes('positive whole number') && n.msg.includes('Para 3')));
}

// ===========================================================================
// C) Teacher lesson form + Advance form — labels, boundary lookup, writers
// ===========================================================================
function makeTeacherWorld() {
  const localStorage = makeLocalStorageStub({
    alhuda_custom_books: JSON.stringify([QURAN_DEFAULT, QURAN_ANCHORED, QAIDA]),
    alhuda_deleted_books: JSON.stringify([]),
  });
  const documentStub = makeDocumentStub();
  const sandbox = {
    console, localStorage, document: documentStub, setTimeout, clearTimeout,
    LessonHistory: LH,
    ADDITIONAL_COURSE_ID: 'additional-course',
    getTeacherAllBooks: () => [QURAN_DEFAULT, QURAN_ANCHORED, QAIDA],
    updateTeacherCoursePreview: () => {},
    setAdditionalCourseMode: () => {},
    fetch: async () => { throw new Error('no fetch in unit tests'); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const parasListDecl = seg(TEACHER, 'const QURAN_PARAS_LIST = [', '];') + '];';
  const src = parasListDecl + '\n'
    + extractFunction(CURR, 'getCustomBooks') + '\n'
    + extractFunction(CDATA, 'getBookParaPages') + '\n'
    + extractFunction(TEACHER, 'teacherParasListFor') + '\n'
    + extractFunction(TEACHER, 'onTeacherQuranParaChanged') + '\n'
    + extractFunction(TEACHER, 'onTeacherCourseBookChanged') + '\n'
    + extractFunction(TEACHER, 'onAdvanceQuranParaChanged');
  vm.runInContext(src, sandbox);
  return { sandbox, document: documentStub, run: (code) => vm.runInContext(code, sandbox) };
}
{
  const tw = makeTeacherWorld();
  // Dropdown labels: original numbers; values stay para-relative.
  tw.document.getElementById('attCourseBookSelect').value = 'quran-anchored';
  tw.run('onTeacherQuranParaChanged(2)');
  const pageOpts = tw.document.getElementById('attCoursePageSelect').innerHTML;
  check('teacher form: dropdown labels are ORIGINAL numbers (102..119 for anchored Para 2)',
    pageOpts.includes('<option value="1">Page 102 (Para 2)</option>') && pageOpts.includes('<option value="18">Page 119 (Para 2)</option>'), pageOpts.slice(0, 160));
  check('teacher form: dropdown VALUES stay para-relative (1..18, no 102 as a value)',
    !pageOpts.includes('value="102"') && pageOpts.includes('<option value="18">'));
  tw.document.getElementById('attCourseBookSelect').value = 'quran-default';
  tw.run('onTeacherQuranParaChanged(2)');
  const pageOptsD = tw.document.getElementById('attCoursePageSelect').innerHTML;
  check('teacher form: default anchors label Para 2 as the global positions (21..38)',
    pageOptsD.includes('<option value="1">Page 21 (Para 2)</option>') && pageOptsD.includes('<option value="18">Page 38 (Para 2)</option>'));
  // Advance form follows the same rule.
  tw.document.getElementById('advCourseBookSelect').value = 'quran-anchored';
  tw.run('onAdvanceQuranParaChanged(2)');
  const advOpts = tw.document.getElementById('advCoursePageSelect').innerHTML;
  check('advance form: dropdown labels are ORIGINAL numbers, values para-relative',
    advOpts.includes('<option value="1">Page 102 (Para 2)</option>') && !advOpts.includes('value="102"'), advOpts.slice(0, 160));
  // Boundary page: global page 20 is Para 1's LAST page in the real book
  // (the registry's invented ranges end Para 1 at 18 and would put it in
  // Para 2). The lookup must follow book.paras.
  tw.run(`onTeacherCourseBookChanged('quran-default', null, 20)`);
  check('teacher form: boundary page 20 resolves to Para 1 under book.paras, not the registry',
    String(tw.document.getElementById('attQuranParaSelect').value) === '1', 'para=' + tw.document.getElementById('attQuranParaSelect').value);
  check('teacher form: boundary page keeps its para-relative value (20)',
    String(tw.document.getElementById('attCoursePageSelect').value) === '20', 'page=' + tw.document.getElementById('attCoursePageSelect').value);
  check('teacher form: para options come from the BOOK (3 paras, not the registry 30)',
    (tw.document.getElementById('attQuranParaSelect').innerHTML.match(/<option/g) || []).length === 3
    && tw.document.getElementById('attQuranParaSelect').innerHTML.includes('<option value="1">Para 1: Alif Lam Meem'),
    tw.document.getElementById('attQuranParaSelect').innerHTML.slice(0, 200));

  // Writers: both payloads gain orig_page; `page` semantics untouched.
  // The exact stored expressions are extracted from the real writers and
  // evaluated, so this tests the shipped expression, not a copy.
  const modalSave = extractFunction(TEACHER, 'saveAttendanceAndLessonNotes');
  const advSave = extractFunction(TEACHER, 'handleAdvanceClassSubmit');
  check('writers: end-class save still writes page: page (para-relative, unchanged)',
    /page: page,/.test(modalSave));
  check('writers: advance save still writes page conditionally (unchanged)',
    /page: isAdditionalCourse \? null : page,/.test(advSave));
  // The expression itself contains commas (a function call), so it is
  // captured up to the `line_range:` key that follows it in both writers.
  const exprOf = (fnSrc) => { const m = fnSrc.match(/orig_page:\s*(.+),\n\s*line_range:/); return m ? m[1] : null; };
  const modalExpr = exprOf(modalSave);
  const advExpr = exprOf(advSave);
  check('writers: both teacher writers write orig_page', !!modalExpr && !!advExpr);
  const evalExpr = (expr, scope) => new Function('book', 'selectedPara', 'page', 'isAdditionalCourse', 'window',
    'return (' + expr + ');')(scope.book, scope.selectedPara, scope.page, scope.isAdditionalCourse, { LessonHistory: LH });
  check('writers: end-class orig_page = the displayed original (anchor 102, rel page 5 -> 106)',
    evalExpr(modalExpr, { book: QURAN_ANCHORED, selectedPara: 2, page: 5, isAdditionalCourse: false }) === 106);
  check('writers: end-class orig_page is null for a flat book (no para)',
    evalExpr(modalExpr, { book: QAIDA, selectedPara: null, page: 5, isAdditionalCourse: false }) === null);
  check('writers: advance orig_page converts the same way',
    evalExpr(advExpr, { book: QURAN_ANCHORED, selectedPara: 2, page: 5, isAdditionalCourse: false }) === 106);
  check('writers: advance orig_page is null for Additional Course',
    evalExpr(advExpr, { book: null, selectedPara: null, page: null, isAdditionalCourse: true }) === null);
}

// ===========================================================================
// D) History displays — stored orig_page wins, legacy converts, flat same
// ===========================================================================
// D1) Parent lesson cards (+ hero), executing the real renderer.
{
  const documentStub = makeDocumentStub();
  const sandbox = {
    console, document: documentStub, setTimeout, clearTimeout,
    LessonHistory: LH,
    PARENT_SCHEDULE_MAP: {},
    getAllAvailableBooks: () => [QURAN_ANCHORED, QAIDA],
    fetch: async () => { throw new Error('no fetch in unit tests'); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SECURITY, sandbox);
  vm.runInContext('let LATEST_SABAQ_META = null;\n'
    + extractFunction(PARENT, 'parentIsAttendedStatus') + '\n'
    + extractFunction(PARENT, 'parentLessonOrigPage') + '\n'
    + extractFunction(PARENT, 'renderRecentSabaqLogs'), sandbox);
  const mkLog = (payload) => {
    const row = { id: 'L', student_id: 'S1', date: '2026-11-01', status: 'Completed', lesson_notes: JSON.stringify(payload) };
    row._lhEntry = LH.normalizeLessonRow(row, 'Teacher One');
    return row;
  };
  const logs = [
    mkLog({ book_id: 'quran-anchored', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, orig_page: 105, status: 'Pass' }),
    mkLog({ book_id: 'quran-anchored', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, status: 'Pass' }),
    mkLog({ book_id: 'qaida-flat', book_title: 'Qaida Book', page: 7, status: 'Pass' }),
  ];
  vm.runInContext('this.__render = renderRecentSabaqLogs;', sandbox);
  sandbox.__render(logs, 'Teacher One');
  const html = documentStub.getElementById('parentLessonNotesContainer').innerHTML;
  check('parent cards: record WITH orig_page shows it verbatim (105, not the converted 106)',
    html.includes('Page 105') && html.includes('Revise Page 105'), html.slice(0, 200));
  check('parent cards: legacy record WITHOUT orig_page shows the converted original (106)',
    html.includes('Page 106') && html.includes('Revise Page 106'));
  check('parent cards: the reader call still receives the PARA-RELATIVE page (5) and para (2)',
    html.includes(`, 5, 2,`));
  check('parent cards: flat-book record renders exactly as before (Page 7)',
    html.includes('Page 7') && html.includes('Revise Page 7'));
  check('parent hero: latest lesson button shows the stored original page (Pg 105)',
    documentStub.getElementById('btnOpenLatestSabaq').innerHTML.includes('Pg 105'),
    documentStub.getElementById('btnOpenLatestSabaq').innerHTML);
}
// D2) Admin 360 lesson table title via the real payload parser.
{
  const sandbox = { console, LessonHistory: LH, getAllAvailableBooks: () => [QURAN_ANCHORED, QAIDA], fetch: async () => { throw new Error('no fetch'); } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(P360, '_parseLessonDetails360') + '\nthis.__parse = _parseLessonDetails360;', sandbox);
  const parse = sandbox.__parse;
  const stored = parse({ lesson_notes: JSON.stringify({ book_id: 'quran-anchored', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, orig_page: 105 }) });
  check('360 table: record WITH orig_page titles with it verbatim', stored.summaryTitle === 'HOLY QURAN 16 LINE • Page 105', stored.summaryTitle);
  check('360 table: the stored `page` field itself stays para-relative (5)', stored.page === 5, String(stored.page));
  const legacy = parse({ lesson_notes: JSON.stringify({ book_id: 'quran-anchored', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5 }) });
  check('360 table: legacy record converts at render (Page 106)', legacy.summaryTitle === 'HOLY QURAN 16 LINE • Page 106', legacy.summaryTitle);
  const flat = parse({ lesson_notes: JSON.stringify({ book_title: 'Qaida Book', page: 7 }) });
  check('360 table: flat-book record unchanged (Qaida Book • Page 7)', flat.summaryTitle === 'Qaida Book • Page 7', flat.summaryTitle);
}

// ===========================================================================
// E) Readers — original indicator + the paras-only global-open quirk fix
// ===========================================================================
{
  const readerQuran = { id: 'quran-reader', title: 'HOLY QURAN 16 LINE', category: 'quran', total_pages: 60, pages: U('q', 60), paras: quranParas(null, 42) };
  const localStorage = makeLocalStorageStub({
    alhuda_custom_books: JSON.stringify([readerQuran, QAIDA]),
    alhuda_deleted_books: JSON.stringify([]),
  });
  const documentStub = makeDocumentStub();
  // renderReaderCurrentPage reads jumpSelect.options — give elements the
  // extra surface the reader touches.
  const origGet = documentStub.getElementById;
  documentStub.getElementById = (id) => { const el = origGet(id); if (!el.options) el.options = []; return el; };
  const sandbox = {
    console, localStorage, document: documentStub, setTimeout: () => 0, clearTimeout: () => {},
    LessonHistory: LH,
    fetch: async () => { throw new Error('no fetch in unit tests'); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LH_SRC, sandbox);
  vm.runInContext(CDATA, sandbox);
  const readerSrc = `
    let CURRENT_READER_BOOK = null;
    let CURRENT_READER_PAGE = 1;
    let CURRENT_READER_PARA = 1;
    let CURRENT_READER_ZOOM = 1.0;
    let READER_BASE_W = 0;
    let READER_BASE_H = 0;
    let READER_ERROR_TIMER = null;
    function applyReaderZoom() {}
    function showReaderPageError() {}
    function initOrResizeAnnotationCanvas() {}
    function setupReaderPanningAndWheel() {}
    function openModal() {}
    function loadReaderPageImage(img, url, cb) { img.src = url; }
  ` + seg(CURR, 'function openDigitalBookReader(', 'function populateReaderJumpSelect')
    + seg(CURR, 'function populateReaderJumpSelect', 'function renderReaderCurrentPage')
    + seg(CURR, 'function renderReaderCurrentPage()', '// Loads a reader page image');
  vm.runInContext(readerSrc, sandbox);
  const run = (code) => vm.runInContext(code, sandbox);

  // Global open at page 25 with NO para on a PARAS-ONLY book (no
  // paras_data — the real Quran book's shape): the para is Para 2
  // (21-38) and the page must convert to para-relative 5. Before the
  // fix the paras_data gate left PAGE = 25 while PARA = 2.
  await run(`openDigitalBookReader('quran-reader', 25)`);
  check('reader: global open on a paras-only book lands on the right para (2)',
    run('CURRENT_READER_PARA') === 2, 'para=' + run('CURRENT_READER_PARA'));
  check('reader: global open converts the page to para-relative (25 -> 5)',
    run('CURRENT_READER_PAGE') === 5, 'page=' + run('CURRENT_READER_PAGE'));
  check('reader: indicator shows the ORIGINAL number and the book-end original total (Para 2 • Page 25 of 63)',
    documentStub.getElementById('readerPageIndicator').innerText === 'Para 2 • Page 25 of 63',
    documentStub.getElementById('readerPageIndicator').innerText);
  check('reader: top indicator shows the original page (Juz 2 • P25)',
    documentStub.getElementById('readerPageIndicatorTop').innerText === 'Juz 2 • P25',
    documentStub.getElementById('readerPageIndicatorTop').innerText);
  // Para 3 carries the custom anchor 42: its first page displays 42 and
  // the book-end total is 42 + 22 - 1 = 63 (asserted above).
  run('CURRENT_READER_PARA = 3; CURRENT_READER_PAGE = 1; renderReaderCurrentPage();');
  check('reader: anchored Para 3 first page displays its original number (Para 3 • Page 42 of 63)',
    documentStub.getElementById('readerPageIndicator').innerText === 'Para 3 • Page 42 of 63',
    documentStub.getElementById('readerPageIndicator').innerText);
  // Flat books are untouched.
  await run(`openDigitalBookReader('qaida-flat', 7)`);
  check('reader: flat book indicator unchanged (Page 7 of 33)',
    documentStub.getElementById('readerPageIndicator').innerText === 'Page 7 of 33',
    documentStub.getElementById('readerPageIndicator').innerText);
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\nquran-original-numbering: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
