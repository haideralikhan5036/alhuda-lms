// Annotated Lesson Pages — Phase D: end-class writer merge.
// The staged pages from the reader's Save Pages are merged into the
// lesson payload INSIDE saveAttendanceAndLessonNotes (and, for pages
// staged from the Advance form, inside handleAdvanceClassSubmit):
// claim = snapshot (student + schedule) AND book must match; union with
// the prior record's pages (a staged page supersedes the prior image of
// the same para/page); seq renumbered in (para, page) order; claimed
// staging entries are released only after the row lands. Both clobber
// paths are pinned: the form's fresh payload build (this merge) and the
// Completed transition's plain-text overwrite (a payload carrying an
// image or annotated pages is preserved, plain-text priors unaffected).
// The Additional Course branch never claims staged pages but keeps
// prior ones. Absent/Leave saves keep prior pages via the spread.
// Everything executes the REAL teacher.html functions in vm harnesses.
// Run from the repo root:  node test/annotated-pages-merge.test.mjs
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
// Slice-to-next-function variant for transitionClassSessionState: its
// parameter list destructures an object (braces defeat the naive
// extractor's depth count) and its body contains a '{' string literal
// (which defeats it from the other side). The portal's top-level
// functions all sit at the same 4-space indent, so the function runs
// until the next top-level declaration; its own closing brace is the
// last '}' before that point.
function extractFunctionBalanced(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  const rest = src.slice(start + 10);
  const nextFn = rest.search(/\n    (async )?function [A-Za-z_$]/);
  const slice = nextFn >= 0 ? src.slice(start, start + 10 + nextFn) : src.slice(start);
  return slice.slice(0, slice.lastIndexOf('}') + 1);
}
function extractConst(src, name) {
  const m = src.match(new RegExp(`const ${name} = [^;]+;`));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}
function extractLet(src, name) {
  const m = src.match(new RegExp(`let ${name} = [^;]+;`));
  if (!m) throw new Error('let not found: ' + name);
  return m[0];
}
const NL = String.fromCharCode(10);

function loadLessonHistory() {
  const sandbox = { console, URL, FormData, fetch: async () => { throw new Error('no fetch'); } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LH_SRC + '\nthis.__LH = LessonHistory;', sandbox);
  return sandbox.__LH;
}
const LH = loadLessonHistory();

const QURAN = {
  id: 'holy-quran-16-line', title: 'HOLY QURAN 16 LINE', category: 'quran', total_pages: 60,
  paras: [
    { para: 1, name_en: 'Alif Lam Meem', page_start: 1, page_end: 20, total_pages: 20 },
    { para: 2, name_en: 'Sayaqul', page_start: 21, page_end: 38, total_pages: 18 },
    { para: 3, name_en: 'Tilkal Rusul', page_start: 39, page_end: 60, total_pages: 22 }
  ]
};
const QAIDA = { id: 'qaida-flat', title: 'Qaida Book', category: 'qaida', total_pages: 33 };
const pageKey = (para, page, bookId = 'holy-quran-16-line') => `${bookId}_para${para}_p${page}`;
function stagedEntry({ key, para = 2, page = 5, origPage = 25, bookId = 'holy-quran-16-line', scheduleId = 'SCH-1', studentId = 'STU-1', source = 'attendance' }) {
  return { key, bookId, para, page, origPage, actionCount: 2, fingerprint: '10:99', context: { scheduleId, studentId, source } };
}

// ---------------------------------------------------------------------------
// Main-writer harness (mirrors the line-box suite, plus annotation state)
// ---------------------------------------------------------------------------
async function runMainSave({ bookId = 'holy-quran-16-line', status = 'Present', priorNotes = null, staged = {}, para = '2', page = '5', courseName = '' } = {}) {
  const upserts = [];
  const el = (value = '') => ({ value, innerHTML: '', disabled: false });
  const els = {
    attScheduleId: el('SCH-1'), attStudentId: el('STU-1'), attSelectedStatus: el(status),
    attAdvanceTargetDate: el(''), attCourseBookSelect: el(bookId),
    attAdditionalCourseName: el(courseName), attAdditionalCourseReference: el(''),
    attAdditionalLesson: el(''), attCoursePageSelect: el(page), attLineRange: el(''), attLineBox: el(''),
    attSabaqResult: el('Pass'), attSabaqRating: el('5'), attLessonNotes: el('Good work'),
    attTafseerLanguageSelect: el('ur'), attQuranParaSelect: el(para),
    attLessonImageKey: el(''), btnSaveAttendance: el('')
  };
  const sandbox = {
    console, lmsNotify: () => {},
    document: { getElementById: (id) => els[id] || null },
    CURRENT_TEACHER: { id: 'TCH-1' },
    _ATT_PRIOR_NOTES: priorNotes,
    window: { LessonHistory: LH },
    getTeacherAllBooks: () => [QAIDA, QURAN],
    db: { from: () => ({ upsert: async (rows) => { upserts.push(rows); return { error: null }; } }) },
    notifyClassSessionSync: () => {}, closeAttendanceModal: () => {},
    loadTeacherPortalData: async () => {}
  };
  const code = extractConst(TEACHER, 'ADDITIONAL_COURSE_ID') + NL
    + extractLet(TEACHER, 'ANNOTATION_SAVED') + NL
    + extractLet(TEACHER, 'ANNOTATION_STORE') + NL
    + extractLet(TEACHER, 'ANNOTATION_UNDO_STACK') + NL
    + extractFunction(TEACHER, 'getPktNowParts') + NL
    + extractFunction(TEACHER, 'claimAnnotatedPagesForLesson') + NL
    + extractFunction(TEACHER, 'releaseClaimedAnnotatedPages') + NL
    + extractFunction(TEACHER, 'saveAttendanceAndLessonNotes') + NL
    + 'ANNOTATION_SAVED = ' + JSON.stringify(staged) + ';';
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  await vm.runInContext('saveAttendanceAndLessonNotes()', sandbox);
  const stagedAfter = vm.runInContext('ANNOTATION_SAVED', sandbox);
  const payload = upserts.length ? JSON.parse(upserts[0][0].lesson_notes) : null;
  return { upserts, payload, stagedAfter };
}

// ===========================================================================
// 1) The merge: staged pages attach, in order, and are released
// ===========================================================================
{
  const staged = {};
  staged[pageKey(2, 6)] = stagedEntry({ key: 'scoped-teacher-TCH-1/222_b.webp', para: 2, page: 6, origPage: 26 });
  staged[pageKey(2, 5)] = stagedEntry({ key: 'scoped-teacher-TCH-1/111_a.webp', para: 2, page: 5, origPage: 25 });
  staged[pageKey(2, 7)] = stagedEntry({ key: 'scoped-teacher-TCH-1/333_c.webp', para: 2, page: 7, origPage: 27, studentId: 'STU-2' }); // another student's
  const r = await runMainSave({ staged });
  const ap = r.payload && r.payload.annotated_pages;
  check('merge: payload carries the two claimed pages', Array.isArray(ap) && ap.length === 2, JSON.stringify(ap));
  check('merge: entries in (para,page) order with seq + orig_page in payload shape',
    ap[0].key.endsWith('111_a.webp') && ap[0].seq === 1 && ap[0].orig_page === 25 && ap[0].para === 2 && ap[0].page === 5 &&
    ap[1].key.endsWith('222_b.webp') && ap[1].seq === 2 && ap[1].orig_page === 26);
  check('merge: claimed staging entries released after the save landed',
    !(pageKey(2, 5) in r.stagedAfter) && !(pageKey(2, 6) in r.stagedAfter));
  check('merge: the other student\'s staged page is NOT claimed and stays staged',
    pageKey(2, 7) in r.stagedAfter);
  check('merge: rest of the payload untouched', r.payload.book_id === 'holy-quran-16-line' && r.payload.page === 5 && r.payload.orig_page === 25);
}

// ===========================================================================
// 2) Claim discipline: wrong schedule / wrong book / no staging at all
// ===========================================================================
{
  const staged = {};
  staged[pageKey(2, 5)] = stagedEntry({ key: 'scoped-teacher-TCH-1/111_a.webp', scheduleId: 'SCH-9' }); // different class of the same student
  const r = await runMainSave({ staged });
  check('claim: schedule mismatch is not claimed', r.payload && !('annotated_pages' in r.payload) && (pageKey(2, 5) in r.stagedAfter));
}
{
  const staged = {};
  staged[pageKey(1, 3, 'qaida-flat')] = stagedEntry({ key: 'scoped-teacher-TCH-1/qaida.webp', para: 1, page: 3, origPage: null, bookId: 'qaida-flat' });
  const r = await runMainSave({ staged }); // saving a QURAN lesson
  check('claim: book mismatch is not claimed', r.payload && !('annotated_pages' in r.payload) && (pageKey(1, 3, 'qaida-flat') in r.stagedAfter));
}
{
  const r = await runMainSave({ staged: {} });
  check('claim: nothing staged, nothing prior -> payload has NO annotated_pages key (legacy shape)',
    r.payload && !('annotated_pages' in r.payload));
}

// ===========================================================================
// 3) Prior union + supersede; reopening an edited lesson keeps its pages
// ===========================================================================
{
  const prior = {
    book_id: 'holy-quran-16-line', para: 2, page: 5, status: 'Pass',
    annotated_pages: [
      { key: 'scoped-teacher-TCH-1/old5.webp', para: 2, page: 5, orig_page: 25, seq: 1 },
      { key: 'scoped-teacher-TCH-1/old6.webp', para: 2, page: 6, orig_page: 26, seq: 2 }
    ]
  };
  const r = await runMainSave({ priorNotes: prior, staged: {} });
  const ap = r.payload && r.payload.annotated_pages;
  check('prior: reopening + re-saving keeps both attached pages', Array.isArray(ap) && ap.length === 2 && ap[0].key.endsWith('old5.webp') && ap[1].key.endsWith('old6.webp'), JSON.stringify(ap));

  const staged = {};
  staged[pageKey(2, 5)] = stagedEntry({ key: 'scoped-teacher-TCH-1/new5.webp', para: 2, page: 5, origPage: 25 });
  const r2 = await runMainSave({ priorNotes: prior, staged });
  const ap2 = r2.payload && r2.payload.annotated_pages;
  check('prior: a re-marked page SUPERSEDES its prior image (no duplicate page)',
    Array.isArray(ap2) && ap2.length === 2 && ap2[0].key.endsWith('new5.webp') && ap2[1].key.endsWith('old6.webp'), JSON.stringify(ap2));
}

// ===========================================================================
// 4) Additional Course: never claims staged, keeps prior; Absent keeps prior
// ===========================================================================
{
  const staged = {};
  staged[pageKey(2, 5)] = stagedEntry({ key: 'scoped-teacher-TCH-1/111_a.webp' });
  const prior = { book_id: 'holy-quran-16-line', annotated_pages: [{ key: 'scoped-teacher-TCH-1/old5.webp', para: 2, page: 5, orig_page: 25, seq: 1 }] };
  const r = await runMainSave({ bookId: 'additional-course', courseName: 'Arabic Grammar', priorNotes: prior, staged });
  check('additional: staged book pages are NOT claimed by an Additional Course save',
    r.payload && (pageKey(2, 5) in r.stagedAfter));
  check('additional: prior pages survive an Additional Course re-save',
    Array.isArray(r.payload.annotated_pages) && r.payload.annotated_pages.length === 1 && r.payload.annotated_pages[0].key.endsWith('old5.webp'));

  const absent = await runMainSave({ status: 'Absent', priorNotes: prior, staged });
  check('absent: prior annotated_pages preserved by the status-change spread',
    absent.payload && Array.isArray(absent.payload.annotated_pages) && absent.payload.annotated_pages[0].key.endsWith('old5.webp') && absent.payload.status === 'Absent');
  check('absent: staged pages are not consumed by a status-only save', pageKey(2, 5) in absent.stagedAfter);
}

// ===========================================================================
// 5) Clobber path 1: the Completed transition's plain-text overwrite
// ===========================================================================
async function runTransition({ priorNotes, targetStatus = 'Completed', notes = 'Class completed at 10:00 AM PKT' }) {
  const upserts = [];
  const sandbox = {
    console, lmsNotify: () => {},
    document: { getElementById: () => null },
    CURRENT_TEACHER: { id: 'TCH-1' },
    TODAY_CLASSES: [{ id: 'SCH-1', student_id: 'STU-1', log: { status: 'Running', lesson_notes: priorNotes, started_at: '2026-11-06T09:00:00Z' } }],
    db: { from: () => ({ upsert: async (rows) => { upserts.push(rows); return { error: null }; } }) },
    notifyClassSessionSync: () => {}
  };
  const code = extractLet(TEACHER, 'TODAY_CLASSES') + NL
    + extractFunction(TEACHER, 'getPktNowParts') + NL
    + extractFunctionBalanced(TEACHER, 'transitionClassSessionState') + NL
    + 'TODAY_CLASSES = ' + JSON.stringify(sandbox.TODAY_CLASSES) + ';';
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  await vm.runInContext(`transitionClassSessionState({ scheduleId: 'SCH-1', studentId: 'STU-1', teacherId: 'TCH-1', targetStatus: ${JSON.stringify(targetStatus)}, notes: ${JSON.stringify(notes)} })`, sandbox);
  return upserts;
}
{
  const payloadWithPages = JSON.stringify({ book_id: 'holy-quran-16-line', page: 5, image_key: 'scoped-teacher-TCH-1/photo.webp', annotated_pages: [{ key: 'scoped-teacher-TCH-1/111_a.webp', para: 2, page: 5, orig_page: 25, seq: 1 }] });
  const r = await runTransition({ priorNotes: payloadWithPages });
  check('transition: a payload carrying annotated pages is NOT overwritten by the completion text',
    r.length === 1 && !('lesson_notes' in r[0][0]) && r[0][0].status === 'Completed', JSON.stringify(r[0] && r[0][0]));

  const r2 = await runTransition({ priorNotes: 'Class started by teacher at 09:00 AM PKT' });
  check('transition: plain-text prior still receives the completion text (normal case unchanged)',
    r2.length === 1 && r2[0][0].lesson_notes === 'Class completed at 10:00 AM PKT');

  const r3 = await runTransition({ priorNotes: JSON.stringify({ book_id: 'qaida-flat', page: 3, status: 'Pass' }) });
  check('transition: a payload WITHOUT images still receives the completion text',
    r3.length === 1 && r3[0][0].lesson_notes === 'Class completed at 10:00 AM PKT');
}

// ===========================================================================
// 6) Advance writer: claims only advance-staged pages for its own student
// ===========================================================================
async function runAdvSave({ bookId = 'qaida-flat', staged = {}, studentId = 'STU-1', courseName = '' } = {}) {
  const upserts = [];
  const el = (value = '') => ({ value, innerHTML: '', disabled: false });
  const els = {
    advStudentSelect: el(studentId), advTargetDate: el('2026-11-10'), advReasonSelect: el('Other'),
    advCourseBookSelect: el(bookId), advCoursePageSelect: el('3'),
    advLineRange: el(''), advLineBox: el(''),
    advSabaqResult: el('Pass'), advSabaqRating: el('5'), advLessonNotes: el(''),
    advAdditionalLesson: el(''), advAdditionalCourseName: el(courseName),
    advAdditionalCourseReference: el(''), advLessonImageKey: el(''),
    advTafseerLanguageSelect: el('ur'), advQuranParaSelect: el('1'),
    btnSaveAdvanceClass: el('')
  };
  const sandbox = {
    console, lmsNotify: () => {},
    document: { getElementById: (id) => els[id] || null },
    window: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    CURRENT_TEACHER: { id: 'TCH-1', full_name: 'Teacher One' },
    ALL_TEACHER_SCHEDULES: [],
    ADVANCE_SELECTED_STUDENT: { name: 'Test Student' },
    getTeacherAllBooks: () => [QAIDA, QURAN],
    db: { from: () => ({ upsert: async (rows) => { upserts.push(rows); return { error: null }; } }) },
    closeAdvanceClassModal: () => {}, loadTeacherPortalData: async () => {}
  };
  const code = extractConst(TEACHER, 'ADDITIONAL_COURSE_ID') + NL
    + extractLet(TEACHER, 'ANNOTATION_SAVED') + NL
    + extractLet(TEACHER, 'ANNOTATION_STORE') + NL
    + extractLet(TEACHER, 'ANNOTATION_UNDO_STACK') + NL
    + extractFunction(TEACHER, 'getPktNowParts') + NL
    + extractFunction(TEACHER, 'claimAnnotatedPagesForLesson') + NL
    + extractFunction(TEACHER, 'releaseClaimedAnnotatedPages') + NL
    + extractFunction(TEACHER, 'handleAdvanceClassSubmit') + NL
    + 'ANNOTATION_SAVED = ' + JSON.stringify(staged) + ';';
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  await vm.runInContext('handleAdvanceClassSubmit(null)', sandbox);
  const stagedAfter = vm.runInContext('ANNOTATION_SAVED', sandbox);
  const payload = upserts.length ? JSON.parse(upserts[0][0].lesson_notes) : null;
  return { upserts, payload, stagedAfter };
}
{
  const staged = {};
  staged[pageKey(1, 3, 'qaida-flat')] = stagedEntry({ key: 'scoped-teacher-TCH-1/adv.webp', para: 1, page: 3, origPage: null, bookId: 'qaida-flat', scheduleId: null, source: 'advance' });
  staged[pageKey(1, 4, 'qaida-flat')] = stagedEntry({ key: 'scoped-teacher-TCH-1/class.webp', para: 1, page: 4, origPage: null, bookId: 'qaida-flat', source: 'attendance' });
  const r = await runAdvSave({ staged });
  const ap = r.payload && r.payload.annotated_pages;
  check('advance: advance-staged page attaches to the advance record',
    Array.isArray(ap) && ap.length === 1 && ap[0].key.endsWith('adv.webp') && ap[0].seq === 1, JSON.stringify(ap));
  check('advance: normal-class annotations do NOT leak into the advance record',
    !(pageKey(1, 4, 'qaida-flat') in ({})) && (pageKey(1, 4, 'qaida-flat') in r.stagedAfter));
  check('advance: claimed entry released after the save', !(pageKey(1, 3, 'qaida-flat') in r.stagedAfter));

  const addl = await runAdvSave({ bookId: 'additional-course', courseName: 'Arabic Grammar', staged });
  check('advance: Additional Course advance claims nothing', addl.payload && !('annotated_pages' in addl.payload));
}

// ===========================================================================
// 7) Reopen strip: the modal lists already-attached pages
// ===========================================================================
{
  const stripBox = { classList: { _s: new Set(['hidden']), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } } };
  const stripList = { innerHTML: '' };
  const sandbox = {
    console,
    document: { getElementById: (id) => (id === 'attAnnotatedPagesBox' ? stripBox : id === 'attAnnotatedPagesList' ? stripList : null) }
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(TEACHER, 'renderAttAnnotatedPagesStrip') + NL
    + 'this.__strip = renderAttAnnotatedPagesStrip;', sandbox);
  sandbox.__strip([{ key: 'k1', para: 2, page: 5, orig_page: 25, seq: 1 }, { key: 'k2', para: 2, page: 6, orig_page: 26, seq: 2 }]);
  check('strip: two attached pages are listed with ORIGINAL page numbers',
    !stripBox.classList.contains('hidden') && stripList.innerHTML.includes('2 annotated pages attached') && stripList.innerHTML.includes('Page 25') && stripList.innerHTML.includes('Page 26'), stripList.innerHTML);
  sandbox.__strip(null);
  check('strip: no attached pages -> box hidden and emptied', stripBox.classList.contains('hidden') && stripList.innerHTML === '');
  check('strip: openAttendanceModal refreshes the strip from the record',
    TEACHER.includes('renderAttAnnotatedPagesStrip(parsedNotes && parsedNotes.annotated_pages)'));
}

// ===========================================================================
// 8) Claim unit checks (direct)
// ===========================================================================
{
  const sandbox = { console };
  vm.createContext(sandbox);
  const code = extractLet(TEACHER, 'ANNOTATION_SAVED') + NL
    + extractFunction(TEACHER, 'claimAnnotatedPagesForLesson') + NL
    + 'this.__claim = claimAnnotatedPagesForLesson;';
  vm.runInContext(code, sandbox);
  const claim = sandbox.__claim;
  const setSaved = (obj) => vm.runInContext('ANNOTATION_SAVED = ' + JSON.stringify(obj), sandbox);

  setSaved({ [pageKey(2, 5)]: stagedEntry({ key: 'scoped-teacher-TCH-1/r.webp', source: 'running', scheduleId: 'SCH-1' }) });
  const c1 = claim({ scheduleId: 'SCH-1', studentId: 'STU-1', bookId: 'holy-quran-16-line', source: 'attendance', prior: null });
  check('claim-unit: running-class staging is claimed by that class\'s save', !!c1 && c1.pages.length === 1 && c1.pageKeys.length === 1);

  setSaved({ [pageKey(2, 5)]: stagedEntry({ key: 'scoped-teacher-TCH-1/a.webp', source: 'advance', scheduleId: null }) });
  const c2 = claim({ scheduleId: 'SCH-1', studentId: 'STU-1', bookId: 'holy-quran-16-line', source: 'attendance', prior: null });
  check('claim-unit: advance-staged page may attach to the same student\'s same-day lesson (book+student match)',
    !!c2 && c2.pages.length === 1);
  const c3 = claim({ scheduleId: 'SCH-1', studentId: 'STU-2', bookId: 'holy-quran-16-line', source: 'attendance', prior: null });
  check('claim-unit: a different student never claims it', c3 === null);

  setSaved({ [pageKey(2, 5)]: Object.assign(stagedEntry({ key: 'scoped-teacher-TCH-1/n.webp' }), { context: null }) });
  const c4 = claim({ scheduleId: 'SCH-1', studentId: 'STU-1', bookId: 'holy-quran-16-line', source: 'attendance', prior: null });
  check('claim-unit: an unbound (context-less) entry is never claimed', c4 === null);
}

const failed = results.filter(r => !r.pass);
console.log('annotated-pages-merge: ' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exit(1);
