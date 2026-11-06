// Annotated Lesson Pages — Phase C: Teacher annotation Save flow.
// The reader's old "Save Page" download is GONE (no downloadAnnotatedPage,
// no anchor download). "Save Pages" now flattens every marked page of the
// current book (original + markings at natural size), uploads each via
// LessonHistory.uploadLessonImageOrThrow (WebP q0.85, PNG-capability
// fallback) and stages the keys in ANNOTATION_SAVED with a student/class
// context snapshot — the end-class save (Phase D) does the attaching.
// Pins: 1-page and 3-page saves with correct para/page/orig_page; no
// duplicate uploads on repeated clicks or click-spam; re-marking
// supersedes (even a same-count change); a failed upload stays dirty and
// only it retries; NO context => no upload, marks kept, plain message;
// claim/clear rules (close asks before discarding unsaved marks, staged
// pages survive close, a second session starts clean, other books'
// unsaved marks are pruned on book open).
// Everything executes the REAL teacher.html functions in a vm harness.
// Run from the repo root:  node test/annotated-pages-teacher-save.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHER = read('teacher.html');
const LH_SRC = read('js/lesson-history.js');

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
function extractLet(src, name) {
  const m = src.match(new RegExp(`let ${name} = [^;]+;`));
  if (!m) throw new Error('let not found: ' + name);
  return m[0];
}

// The REAL shared module (origPageFor is exercised for real).
function loadLessonHistory() {
  const sandbox = { console, URL, FormData, fetch: async () => { throw new Error('no fetch'); } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LH_SRC + '\nthis.__LH = LessonHistory;', sandbox);
  return sandbox.__LH;
}
const LH = loadLessonHistory();

// Fixtures: anchored Quran (para 2 starts at original page 21).
const QURAN = {
  id: 'holy-quran-16-line', title: 'HOLY QURAN 16 LINE', category: 'quran', total_pages: 60,
  paras: [
    { para: 1, name_en: 'Alif Lam Meem', page_start: 1, page_end: 20, total_pages: 20 },
    { para: 2, name_en: 'Sayaqul', page_start: 21, page_end: 38, total_pages: 18 },
    { para: 3, name_en: 'Tilkal Rusul', page_start: 39, page_end: 60, total_pages: 22 }
  ]
};
const OTHER_BOOK = { id: 'qaida-flat', title: 'Qaida Book', category: 'qaida', total_pages: 33 };
const pen = (x) => ({ id: 'a' + x, type: 'pen', color: '#dc2626', strokeWidth: 4, points: [{ x: 0.1 + x / 100, y: 0.2 }, { x: 0.5, y: 0.6 }] });

// ---------------------------------------------------------------------------
// vm harness with a mock DOM
// ---------------------------------------------------------------------------
function makeHarness() {
  const notifies = [];
  const uploads = [];
  const fetches = [];
  let uploadImpl = async (file) => 'scoped-teacher-T1/' + Date.now() + '_' + file.name;
  let confirmAnswer = true;
  const confirmCalls = [];

  const ctxCalls = [];
  const ctxStub = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { ctxCalls.push('stroke'); },
    fill() {}, strokeRect() {}, ellipse() {}, fillText() {}, clearRect() {}, setTransform() {},
    resetTransform() {}, scale() {}, drawImage() { ctxCalls.push('drawImage'); }
  };
  const fakeCanvas = () => ({
    width: 0, height: 0, style: {},
    getContext: () => ctxStub,
    toBlob(cb, type) { cb(new Blob(['fake-image-bytes'], { type: type || 'image/webp' })); }
  });

  function classList(initial = []) {
    const s = new Set(initial);
    return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), contains: (c) => s.has(c) };
  }
  function el(opts = {}) {
    return Object.assign({
      value: '', disabled: false, textContent: '', innerHTML: '',
      classList: classList(opts.hidden ? ['hidden'] : []),
      style: {},
      querySelector: () => spanStub
    }, opts.props || {});
  }
  const spanStub = { textContent: 'Save Pages' };
  const els = {
    attScheduleId: el(), attStudentId: el(),
    modalTeacherAttendance: el({ hidden: true }),
    modalTeacherAdvanceClass: el({ hidden: true }),
    advStudentSelect: el(),
    btnSaveAnnotatedPages: el(),
    readerPageImg: el({ props: { naturalWidth: 1200, naturalHeight: 1700, clientWidth: 600, clientHeight: 850 } }),
    readerImageStage: el(),
    readerAnnotationCanvas: el({ props: { width: 600, height: 850, style: { width: '600px', height: '850px' }, getContext: () => ctxStub } }),
    modalDigitalBookReader: el()
  };
  els.btnSaveAnnotatedPages.querySelector = () => spanStub;

  const documentMock = {
    fullscreenElement: null,
    getElementById: (id) => els[id] || null,
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : el())
  };
  class FakeImage {
    constructor() { this.naturalWidth = 1200; this.naturalHeight = 1700; this.clientWidth = 600; this.clientHeight = 850; }
    set src(v) { this._src = v; if (this.onload) queueMicrotask(() => this.onload()); }
    get src() { return this._src; }
  }
  let objectUrlSeq = 0;
  const sandbox = {
    console, setTimeout, queueMicrotask, JSON, Math, Date, Promise, File, Blob, FormData,
    document: documentMock,
    Image: FakeImage,
    URL: { createObjectURL: () => 'blob:fake-' + (++objectUrlSeq), revokeObjectURL: () => {} },
    fetch: async (url, opts) => { fetches.push({ url, opts }); return { ok: true, blob: async () => new Blob(['img'], { type: 'image/webp' }) }; },
    getLmsAuthHeaders: () => ({ Authorization: 'Bearer teacher-token' }),
    CURRICULUM_DATA: { getPageUrl: (bookId, page, para) => 'https://worker.test/api/storage?key=' + encodeURIComponent('course_material/' + bookId + '_para' + para + '_p' + page + '.webp') },
    lmsNotify: (msg, opts) => { notifies.push({ msg: String(msg), type: (opts && opts.type) || 'info' }); },
    lmsConfirm: async (opts) => { confirmCalls.push(opts); return confirmAnswer; },
    resetReaderZoom: () => {},
    popTeacherModalHistory: () => {},
    pushTeacherModalHistory: () => {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const LHstub = Object.create(LH);
  LHstub.uploadLessonImageOrThrow = async (file) => { uploads.push(file); return uploadImpl(file); };
  sandbox.window.LessonHistory = LHstub;

  const FN = [
    'getReaderPageKey', 'drawSingleAnnotationAction', 'redrawCurrentPageAnnotations',
    'parseReaderPageKey', 'annotationFingerprint', 'annotationContextSnapshot',
    'annotationMarkedPageKeys', 'annotationPageIsDirty', 'annotationDirtyPageKeys',
    'clearAllAnnotationMarks', 'pruneAnnotationMarksForOtherBooks',
    'refreshAnnotationSaveButton', 'setAnnotationSaveProgress',
    'loadReaderPageImageElement', 'buildAnnotatedPageCanvas', 'annotatedCanvasToBlob',
    'saveAnnotatedPages', 'closeDigitalBookReader', 'performCloseDigitalBookReader'
  ];
  const code = [
    extractLet(TEACHER, 'CURRENT_READER_BOOK'), extractLet(TEACHER, 'CURRENT_READER_PAGE'),
    extractLet(TEACHER, 'CURRENT_READER_PARA'), extractLet(TEACHER, 'TODAY_CLASSES'),
    extractLet(TEACHER, 'ANNOTATION_STORE'), extractLet(TEACHER, 'ANNOTATION_UNDO_STACK'),
    extractLet(TEACHER, 'ANNOTATION_SAVED'), extractLet(TEACHER, 'ANNOTATION_SAVE_IN_FLIGHT'),
    extractLet(TEACHER, 'ANNOTATION_SAVE_FAILED'), extractLet(TEACHER, 'ANNOTATION_STAGING_SEQ'),
    ...FN.map(n => extractFunction(TEACHER, n))
  ].join('\n');
  vm.runInContext(code + '\nthis.__api = { saveAnnotatedPages, closeDigitalBookReader, annotationContextSnapshot, annotationMarkedPageKeys, annotationDirtyPageKeys, annotationPageIsDirty, buildAnnotatedPageCanvas, pruneAnnotationMarksForOtherBooks, parseReaderPageKey };', sandbox);

  return {
    sandbox, els, spanStub, notifies, uploads, fetches, confirmCalls, ctxCalls,
    api: sandbox.__api,
    setUploadImpl: (fn) => { uploadImpl = fn; },
    setConfirmAnswer: (v) => { confirmAnswer = v; },
    run: (codeStr) => vm.runInContext(codeStr, sandbox)
  };
}
const key = (para, page, bookId = 'holy-quran-16-line') => `${bookId}_para${para}_p${page}`;
function openAttendanceCtx(h, sched = 'SCH-1', stu = 'STU-1') {
  h.els.attScheduleId.value = sched;
  h.els.attStudentId.value = stu;
  h.els.modalTeacherAttendance.classList.remove('hidden');
}
function setupReader(h, para = 2, page = 5) {
  h.run(`CURRENT_READER_BOOK = ${JSON.stringify(QURAN)}; CURRENT_READER_PARA = ${para}; CURRENT_READER_PAGE = ${page};`);
}

// ===========================================================================
// A) Structure — download is gone, Save Pages is wired
// ===========================================================================
{
  check('structure: Save Pages button wired to saveAnnotatedPages()',
    TEACHER.includes('id="btnSaveAnnotatedPages" onclick="saveAnnotatedPages()"') && TEACHER.includes('Save Pages'));
  check('structure: downloadAnnotatedPage fully removed', !TEACHER.includes('downloadAnnotatedPage'));
  // The annotation engine must contain no download sink at all. (An
  // unrelated toDataURL exists elsewhere in teacher.html — the salary
  // voucher's html2canvas -> jsPDF export — and is out of scope.)
  const engineBlock = TEACHER.slice(TEACHER.indexOf('WHITEBOARD & PAGE ANNOTATION ENGINE'), TEACHER.indexOf('Keyboard & Wheel controls'));
  check('structure: no download sink inside the annotation engine',
    !/\.download\s*=/.test(TEACHER) && !engineBlock.includes('toDataURL') && !engineBlock.includes('.download'));
}

// ===========================================================================
// B) One page, saved from the lesson form's context
// ===========================================================================
{
  const h = makeHarness();
  setupReader(h, 2, 5);
  openAttendanceCtx(h);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}] = [${JSON.stringify(pen(1))}, ${JSON.stringify(pen(2))}];`);
  await h.api.saveAnnotatedPages();
  const saved = h.run(`ANNOTATION_SAVED[${JSON.stringify(key(2, 5))}]`);
  check('save-1: exactly one upload', h.uploads.length === 1, 'uploads=' + h.uploads.length);
  check('save-1: upload is a WebP File naming book/para/ORIGINAL page',
    h.uploads[0] instanceof File && h.uploads[0].type === 'image/webp' && /annotated_holy-quran-16-line_para2_page25_s[0-9a-z]+\.webp/.test(h.uploads[0].name), h.uploads[0] && h.uploads[0].name);
  check('save-1: staged entry carries key/para/page/orig_page/context',
    !!saved && saved.key.indexOf('scoped-teacher-T1/') === 0 && saved.para === 2 && saved.page === 5 && saved.origPage === 25 &&
    saved.context.scheduleId === 'SCH-1' && saved.context.studentId === 'STU-1' && saved.context.source === 'attendance',
    JSON.stringify(saved));
  const okMsg = h.notifies.find(n => n.type !== 'error');
  check('save-1: success copy is honest (attaches when the lesson is saved, not now)',
    !!okMsg && okMsg.msg.includes('will attach') && okMsg.msg.includes('when you save the lesson'), okMsg && okMsg.msg);
  check('save-1: page no longer dirty', h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}]`) !== undefined && !h.api.annotationPageIsDirty(key(2, 5)));

  // D) repeated click with no changes uploads nothing again
  await h.api.saveAnnotatedPages();
  check('save-again: repeated click creates no duplicate upload', h.uploads.length === 1, 'uploads=' + h.uploads.length);
}

// ===========================================================================
// C) Three pages across paras — order, per-page identity, auth fetch
// ===========================================================================
{
  const h = makeHarness();
  setupReader(h, 2, 5);
  openAttendanceCtx(h);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(3, 1))}] = [${JSON.stringify(pen(3))}];`);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 6))}] = [${JSON.stringify(pen(4))}];`);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}] = [${JSON.stringify(pen(5))}];`);
  await h.api.saveAnnotatedPages();
  check('save-3: three uploads', h.uploads.length === 3, 'uploads=' + h.uploads.length);
  check('save-3: uploads ordered by (para, page)',
    h.uploads.map(f => f.name).join(' ').includes('para2_page25') &&
    h.uploads[0].name.includes('para2_page25') && h.uploads[1].name.includes('para2_page26') && h.uploads[2].name.includes('para3_page39'),
    h.uploads.map(f => f.name).join(','));
  const e3 = h.run(`ANNOTATION_SAVED[${JSON.stringify(key(3, 1))}]`);
  check('save-3: para 3 page 1 staged with its own original page (39)', !!e3 && e3.para === 3 && e3.page === 1 && e3.origPage === 39, JSON.stringify(e3));
  check('save-3: non-current pages were auth-fetched as storage pages',
    h.fetches.length === 2 && h.fetches.every(f => f.opts && f.opts.headers && f.opts.headers.Authorization === 'Bearer teacher-token'),
    'fetches=' + h.fetches.length);
  check('save-3: all pages clean after save', h.api.annotationDirtyPageKeys().length === 0);

  // E) re-mark: same action COUNT, different marks -> dirty again, supersedes
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 6))}] = [${JSON.stringify(pen(9))}];`);
  check('remark: same-count change is dirty (fingerprint, not count)', h.api.annotationPageIsDirty(key(2, 6)) === true);
  const oldKey = h.run(`ANNOTATION_SAVED[${JSON.stringify(key(2, 6))}].key`);
  await h.api.saveAnnotatedPages();
  const newKey = h.run(`ANNOTATION_SAVED[${JSON.stringify(key(2, 6))}].key`);
  check('remark: only the re-marked page re-uploads', h.uploads.length === 4, 'uploads=' + h.uploads.length);
  check('remark: staged key superseded, never duplicated', newKey !== oldKey && h.api.annotationDirtyPageKeys().length === 0);
}

// ===========================================================================
// F) Failure + retry: failed page stays dirty, retry uploads only it
// ===========================================================================
{
  const h = makeHarness();
  setupReader(h, 2, 5);
  openAttendanceCtx(h);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}] = [${JSON.stringify(pen(1))}];`);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 6))}] = [${JSON.stringify(pen(2))}];`);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 7))}] = [${JSON.stringify(pen(3))}];`);
  let failPage26 = true;
  h.setUploadImpl(async (file) => {
    if (failPage26 && file.name.includes('page26')) throw new Error('network down');
    return 'scoped-teacher-T1/' + Date.now() + '_' + file.name;
  });
  await h.api.saveAnnotatedPages();
  check('retry: two of three pages staged', h.run(`Object.keys(ANNOTATION_SAVED).length`) === 2);
  check('retry: failed page stays dirty, saved pages stay clean',
    h.api.annotationPageIsDirty(key(2, 6)) === true && h.api.annotationPageIsDirty(key(2, 5)) === false);
  const errMsg = h.notifies.find(n => n.type === 'error');
  check('retry: failure copy names the retry and keeps the marks',
    !!errMsg && errMsg.msg.includes('Retry Save') && errMsg.msg.includes('still on the pages'), errMsg && errMsg.msg);
  check('retry: button flips to Retry Save', h.spanStub.textContent === 'Retry Save', h.spanStub.textContent);
  failPage26 = false;
  await h.api.saveAnnotatedPages();
  check('retry: second attempt uploads ONLY the failed page', h.uploads.length === 4, 'uploads=' + h.uploads.length);
  check('retry: all pages staged after retry, button back to Save Pages',
    h.run(`Object.keys(ANNOTATION_SAVED).length`) === 3 && h.spanStub.textContent === 'Save Pages');
}

// ===========================================================================
// G/H) Context rules — refusal without identity, Running-class inference
// ===========================================================================
{
  const h = makeHarness();
  setupReader(h, 2, 5);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}] = [${JSON.stringify(pen(1))}];`);
  await h.api.saveAnnotatedPages();
  const errMsg = h.notifies.find(n => n.type === 'error');
  check('no-context: nothing uploaded', h.uploads.length === 0);
  check('no-context: plain staff message, marks kept',
    !!errMsg && errMsg.msg.includes('can only be saved from a student') && errMsg.msg.includes('nothing was lost'),
    errMsg && errMsg.msg);
  check('no-context: markings untouched in the store', (h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}]`) || []).length === 1);

  // Two Running classes: inference is NOT safe -> still refused.
  h.run(`TODAY_CLASSES = [
    { id: 'SCH-A', student_id: 'STU-A', log: { status: 'Running' } },
    { id: 'SCH-B', student_id: 'STU-B', log: { status: 'Running' } }
  ];`);
  check('two-running: snapshot refuses to guess', h.api.annotationContextSnapshot() === null);
  await h.api.saveAnnotatedPages();
  check('two-running: still nothing uploaded', h.uploads.length === 0);

  // Exactly one Running class: bound to it.
  h.run(`TODAY_CLASSES = [
    { id: 'SCH-A', student_id: 'STU-A', log: { status: 'Running' } },
    { id: 'SCH-B', student_id: 'STU-B', log: { status: 'Completed' } }
  ];`);
  const snap = h.api.annotationContextSnapshot();
  check('one-running: snapshot is that class', !!snap && snap.scheduleId === 'SCH-A' && snap.studentId === 'STU-A' && snap.source === 'running', JSON.stringify(snap));
  await h.api.saveAnnotatedPages();
  check('one-running: save proceeds under that context', h.uploads.length === 1);
}

// ===========================================================================
// I/J/K) Claim & clear — close rules, second-student cleanliness, prune
// ===========================================================================
{
  const h = makeHarness();
  setupReader(h, 2, 5);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}] = [${JSON.stringify(pen(1))}];`);

  // Dirty marks + teacher says "Stay & Save": reader stays open, marks stay.
  h.setConfirmAnswer(false);
  h.api.closeDigitalBookReader();
  await new Promise(r => setTimeout(r, 10));
  check('close-dirty: discard was ASKED (not silent)', h.confirmCalls.length === 1);
  check('close-dirty: staying keeps reader open and marks intact',
    !h.els.modalDigitalBookReader.classList.contains('hidden') && (h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}]`) || []).length === 1);

  // Teacher discards: marks cleared, reader closes.
  h.setConfirmAnswer(true);
  h.api.closeDigitalBookReader();
  await new Promise(r => setTimeout(r, 10));
  check('close-discard: marks cleared on discard', h.run(`Object.keys(ANNOTATION_STORE).length`) === 0);
  check('close-discard: reader closed', h.els.modalDigitalBookReader.classList.contains('hidden'));

  // A second student opens the same book/page: completely clean.
  h.run(`CURRENT_READER_PARA = 2; CURRENT_READER_PAGE = 5;`);
  check('leak: second session starts with zero marks and zero dirty pages',
    h.api.annotationMarkedPageKeys('holy-quran-16-line').length === 0 && h.api.annotationDirtyPageKeys().length === 0);
}
{
  // Saved pages survive the close (staged for the merge); their marks clear.
  const h = makeHarness();
  setupReader(h, 2, 5);
  openAttendanceCtx(h);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}] = [${JSON.stringify(pen(1))}];`);
  await h.api.saveAnnotatedPages();
  h.api.closeDigitalBookReader();
  await new Promise(r => setTimeout(r, 10));
  check('close-saved: no discard prompt for saved pages', h.confirmCalls.length === 0);
  check('close-saved: staged entry survives for the end-class merge', !!h.run(`ANNOTATION_SAVED[${JSON.stringify(key(2, 5))}]`));
  check('close-saved: on-screen marks cleared for the next session', h.run(`Object.keys(ANNOTATION_STORE).length`) === 0);
}
{
  // Book change: other books' unsaved marks pruned, staged entries kept.
  const h = makeHarness();
  setupReader(h, 2, 5);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}] = [${JSON.stringify(pen(1))}];`);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(1, 3, 'qaida-flat'))}] = [${JSON.stringify(pen(2))}];`);
  h.run(`ANNOTATION_SAVED[${JSON.stringify(key(1, 3, 'qaida-flat'))}] = { key: 'scoped-teacher-T1/x.webp', bookId: 'qaida-flat', para: 1, page: 3, origPage: null, actionCount: 1, fingerprint: 'x', context: { scheduleId: 'SCH-9', studentId: 'STU-9', source: 'attendance' } };`);
  h.api.pruneAnnotationMarksForOtherBooks('holy-quran-16-line');
  check('prune: other book unsaved marks dropped on book open', h.run(`ANNOTATION_STORE[${JSON.stringify(key(1, 3, 'qaida-flat'))}]`) === undefined);
  check('prune: current book marks kept', (h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}]`) || []).length === 1);
  check('prune: other book STAGED entry kept for its own merge', !!h.run(`ANNOTATION_SAVED[${JSON.stringify(key(1, 3, 'qaida-flat'))}]`));
}

// ===========================================================================
// L/M) Composite + click-spam guard
// ===========================================================================
{
  const h = makeHarness();
  setupReader(h, 2, 5);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}] = [${JSON.stringify(pen(1))}];`);
  const canvas = await h.api.buildAnnotatedPageCanvas(QURAN, 2, 5, [pen(1)]);
  check('composite: natural size of the page image', canvas.width === 1200 && canvas.height === 1700, canvas.width + 'x' + canvas.height);
  check('composite: base image drawn, then actions replayed', h.ctxCalls.filter(c => c === 'drawImage').length === 1 && h.ctxCalls.includes('stroke'));
}
{
  const h = makeHarness();
  setupReader(h, 2, 5);
  openAttendanceCtx(h);
  h.run(`ANNOTATION_STORE[${JSON.stringify(key(2, 5))}] = [${JSON.stringify(pen(1))}];`);
  let release;
  h.setUploadImpl(() => new Promise(res => { release = () => res('scoped-teacher-T1/slow.webp'); }));
  const p1 = h.api.saveAnnotatedPages();
  const p2 = h.api.saveAnnotatedPages(); // spam click while in flight
  await new Promise(r => setTimeout(r, 20)); // let the first save reach the uploader
  release();
  await Promise.all([p1, p2]);
  check('spam: concurrent Save clicks upload once', h.uploads.length === 1, 'uploads=' + h.uploads.length);
}

const failed = results.filter(r => !r.pass);
console.log('annotated-pages-teacher-save: ' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exit(1);
