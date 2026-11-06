// Lesson Line & Box Note (2026-11-06) — the teacher lesson form gains ONE
// long free-text box directly under the Page field ("Line & Box No.
// (optional)", e.g. "Line 5, Box 2") so the teacher can note the line /
// box number by hand. Design:
//   * Stored additively on the lesson payload as `line_box` (trimmed,
//     capped at 120 chars); blank => null (standard writers) / key absent
//     (main writer's Additional Course branch, mirroring orig_page).
//   * Travels everywhere orig_page travels: both teacher writers ->
//     attendance_logs.lesson_notes (opaque JSON string end to end) ->
//     LessonHistory.parseLessonNotes/normalizeLessonRow (`lineBox`) ->
//     Teacher history cards, Parent cards + attendance topic, Admin 360
//     table title (summaryTitle) + inspector.
//   * Records without the field render byte-identically to before.
// Everything below executes the REAL functions in vm harnesses in the
// style of the existing suites (fixtures only — no live data).
// Run from the repo root:  node test/lesson-line-box-note.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const LH_SRC = read('js/lesson-history.js');
const TEACHER = read('teacher.html');
const PARENT = read('parent.html');
const P360 = read('js/profiles360.js');
const SECURITY = read('js/security.js');

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
function extractConst(src, name) {
  const m = src.match(new RegExp(`const ${name} = [^;]+;`));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

// Fixtures (mirroring the quran suite's shapes).
function quranParas(anchor2) {
  const paras = [
    { para: 1, name_en: 'Alif Lam Meem', page_start: 1, page_end: 20, total_pages: 20 },
    { para: 2, name_en: 'Sayaqul', page_start: 21, page_end: 38, total_pages: 18 },
    { para: 3, name_en: 'Tilkal Rusul', page_start: 39, page_end: 60, total_pages: 22 },
  ];
  if (anchor2 != null) paras[1].orig_start = anchor2;
  return paras;
}
const QURAN_DEFAULT = { id: 'quran-default', title: 'HOLY QURAN 16 LINE', category: 'quran', total_pages: 60, paras: quranParas() };
const QURAN_ANCHORED = { id: 'quran-anchored', title: 'HOLY QURAN 16 LINE', category: 'quran', total_pages: 60, paras: quranParas(102) };
const QAIDA = { id: 'qaida-flat', title: 'Qaida Book', category: 'qaida', total_pages: 33 };

// The REAL shared module, loaded once and reused as LessonHistory.
function loadLessonHistory() {
  const sandbox = { console, URL, FormData, fetch: async () => { throw new Error('no fetch in unit tests'); } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LH_SRC + '\nthis.__LH = LessonHistory;', sandbox);
  return sandbox.__LH;
}
const LH = loadLessonHistory();
if (!LH) { console.log('FAIL | LessonHistory did not load'); process.exit(1); }
const NL = String.fromCharCode(10);

// ===========================================================================
// A) Form structure — one long box directly under each Page field
// ===========================================================================
{
  check('form: both inputs exist with the exact label, placeholder and 120 cap',
    (TEACHER.match(/Line &amp; Box No\. \(optional\)/g) || []).length === 2 &&
    TEACHER.includes('id="attLineBox" maxlength="120" placeholder="e.g. Line 5, Box 2"') &&
    TEACHER.includes('id="advLineBox" maxlength="120" placeholder="e.g. Line 5, Box 2"'));
  check('form: main box sits between the Page select and the hidden line-range input',
    TEACHER.indexOf('id="attCoursePageSelect"') < TEACHER.indexOf('id="attLineBox"') &&
    TEACHER.indexOf('id="attLineBox"') < TEACHER.indexOf('id="attLineRange"'));
  check('form: advance box sits between its Page select and hidden line-range input',
    TEACHER.indexOf('id="advCoursePageSelect"') < TEACHER.indexOf('id="advLineBox"') &&
    TEACHER.indexOf('id="advLineBox"') < TEACHER.indexOf('id="advLineRange"'));

  // The box must live INSIDE the Page field's wrapper div — that wrapper
  // is exactly what setAdditionalCourseMode hides in Additional Course
  // mode, so the box hides/shows together with the Page field itself.
  const wrapperEnd = (labelIdx) => {
    const openIdx = TEACHER.lastIndexOf('<div>', labelIdx);
    const re = /<div\b|<\/div>/g;
    re.lastIndex = openIdx;
    let depth = 0, m;
    while ((m = re.exec(TEACHER))) {
      if (m[0] === '</div>') { depth--; if (depth === 0) return re.lastIndex; }
      else depth++;
    }
    return -1;
  };
  const label1 = TEACHER.indexOf('Page / Chapter / Portion *:');
  const label2 = TEACHER.indexOf('Page / Chapter / Portion *:', label1 + 1);
  const attBox = TEACHER.indexOf('id="attLineBox"');
  const advBox = TEACHER.indexOf('id="advLineBox"');
  check('form: main box is inside the Page wrapper div (hides with it for Additional Course)',
    label1 > 0 && attBox > label1 && attBox < wrapperEnd(label1));
  check('form: advance box is inside its Page wrapper div',
    label2 > 0 && advBox > label2 && advBox < wrapperEnd(label2));
}

// ===========================================================================
// B) Main writer — REAL saveAttendanceAndLessonNotes in a vm
// ===========================================================================
async function runMainSave({ bookId, lineBox, para = '1', page = '3', status = 'Present', priorNotes = null, courseName = '', reference = '', description = '' }) {
  const upserts = [];
  const notifies = [];
  const el = (value = '') => ({ value, innerHTML: '', disabled: false });
  const els = {
    attScheduleId: el('SCH-1'), attStudentId: el('STU-1'), attSelectedStatus: el(status),
    attAdvanceTargetDate: el(''), attCourseBookSelect: el(bookId),
    attAdditionalCourseName: el(courseName), attAdditionalCourseReference: el(reference),
    attAdditionalLesson: el(description),
    attCoursePageSelect: el(page), attLineRange: el(''), attLineBox: el(lineBox),
    attSabaqResult: el('Pass'), attSabaqRating: el('5'), attLessonNotes: el('Good work'),
    attTafseerLanguageSelect: el('ur'), attQuranParaSelect: el(para),
    attLessonImageKey: el(''), btnSaveAttendance: el(''),
  };
  const sandbox = {
    console, lmsNotify: (m) => notifies.push(m),
    document: { getElementById: (id) => els[id] || null },
    CURRENT_TEACHER: { id: 'TCH-1' },
    _ATT_PRIOR_NOTES: priorNotes,
    window: { LessonHistory: { origPageFor: () => 21 } },
    getTeacherAllBooks: () => [QAIDA, { id: 'holy-quran-16-line', title: 'HOLY QURAN 16 LINE', category: 'quran', total_pages: 60, paras: quranParas() }],
    db: { from: () => ({ upsert: async (rows) => { upserts.push(rows); return { error: null }; } }) },
    notifyClassSessionSync: () => {}, closeAttendanceModal: () => {},
    loadTeacherPortalData: async () => {},
  };
  const code = extractConst(TEACHER, 'ADDITIONAL_COURSE_ID') + '\n'
    + extractFunction(TEACHER, 'getPktNowParts') + NL
    + extractFunction(TEACHER, 'saveAttendanceAndLessonNotes');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  await vm.runInContext('saveAttendanceAndLessonNotes()', sandbox);
  return { upserts, notifies };
}
const PRE_CHANGE_MAIN_KEYS = ['advance_target_date', 'additional_lesson', 'book_id', 'book_title',
  'content_type', 'image_key', 'is_advance_class', 'language', 'line_range', 'orig_page',
  'page', 'para', 'rating', 'recorded_at', 'remarks', 'status'];
let savedQuranNotes = null;
{
  const filled = await runMainSave({ bookId: 'qaida-flat', lineBox: '  Line 5, Box 2  ' });
  const p1 = filled.upserts.length ? JSON.parse(filled.upserts[0][0].lesson_notes) : {};
  check('main save: filled box stored trimmed and exact as line_box', p1.line_box === 'Line 5, Box 2', JSON.stringify(p1.line_box));
  check('main save: page semantics untouched alongside the note', p1.page === 3 && p1.book_id === 'qaida-flat');

  const blank = await runMainSave({ bookId: 'qaida-flat', lineBox: '   ' });
  const p2 = blank.upserts.length ? JSON.parse(blank.upserts[0][0].lesson_notes) : {};
  check('main save: blank box stores line_box null', p2.line_box === null);
  check('main save: blank record = pre-change shape + only the new key',
    JSON.stringify(Object.keys(p2).filter(k => k !== 'line_box').sort()) === JSON.stringify([...PRE_CHANGE_MAIN_KEYS].sort()),
    Object.keys(p2).sort().join(','));

  const long = await runMainSave({ bookId: 'qaida-flat', lineBox: 'x'.repeat(150) });
  const p3 = long.upserts.length ? JSON.parse(long.upserts[0][0].lesson_notes) : {};
  check('main save: value capped at 120 chars', typeof p3.line_box === 'string' && p3.line_box.length === 120);

  const quran = await runMainSave({ bookId: 'holy-quran-16-line', lineBox: 'Line 5, Box 2', para: '2', page: '1' });
  const p4 = quran.upserts.length ? JSON.parse(quran.upserts[0][0].lesson_notes) : {};
  check('main save: note travels alongside orig_page on a para-book record',
    p4.line_box === 'Line 5, Box 2' && p4.orig_page === 21 && p4.page === 1 && p4.para === 2, JSON.stringify(p4));
  savedQuranNotes = quran.upserts[0][0].lesson_notes;

  const addl = await runMainSave({ bookId: 'additional-course', lineBox: 'Line 9, Box 9', courseName: 'Arabic Grammar Basics', description: 'Past Tense Verbs' });
  const p5 = addl.upserts.length ? JSON.parse(addl.upserts[0][0].lesson_notes) : {};
  check('main save: Additional Course branch gains NO line_box key (mirrors orig_page there)',
    addl.upserts.length === 1 && !('line_box' in p5) && p5.lesson_name === 'Past Tense Verbs');

  const absent = await runMainSave({
    bookId: 'qaida-flat', lineBox: '', status: 'Absent',
    priorNotes: { book_id: 'quran-anchored', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, orig_page: 105, line_box: 'Line 5, Box 2', status: 'Pass', remarks: 'old' },
  });
  const p6 = absent.upserts.length ? JSON.parse(absent.upserts[0][0].lesson_notes) : {};
  check('main save: status change to Absent preserves the prior note (spread copy)',
    p6.line_box === 'Line 5, Box 2' && p6.status === 'Absent' && absent.upserts[0][0].status === 'Absent');
}

// ===========================================================================
// C) Advance writer — REAL handleAdvanceClassSubmit in a vm
// ===========================================================================
async function runAdvSave({ bookId, lineBox, courseName = '' }) {
  const upserts = [];
  const el = (value = '') => ({ value, innerHTML: '', disabled: false });
  const els = {
    advStudentSelect: el('STU-1'), advTargetDate: el('2026-11-10'), advReasonSelect: el('Other'),
    advCourseBookSelect: el(bookId), advCoursePageSelect: el('4'),
    advLineRange: el(''), advLineBox: el(lineBox),
    advSabaqResult: el('Pass'), advSabaqRating: el('5'), advLessonNotes: el(''),
    advAdditionalLesson: el(''), advAdditionalCourseName: el(courseName),
    advAdditionalCourseReference: el(''), advLessonImageKey: el(''),
    advTafseerLanguageSelect: el('ur'), advQuranParaSelect: el('1'),
    btnSaveAdvanceClass: el(''),
  };
  const sandbox = {
    console, lmsNotify: () => {},
    document: { getElementById: (id) => els[id] || null },
    window: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    CURRENT_TEACHER: { id: 'TCH-1', full_name: 'Teacher One' },
    ALL_TEACHER_SCHEDULES: [],
    ADVANCE_SELECTED_STUDENT: { name: 'Test Student' },
    getTeacherAllBooks: () => [QAIDA],
    db: { from: () => ({ upsert: async (rows) => { upserts.push(rows); return { error: null }; } }) },
    closeAdvanceClassModal: () => {}, loadTeacherPortalData: async () => {},
  };
  const code = extractConst(TEACHER, 'ADDITIONAL_COURSE_ID') + NL
    + extractFunction(TEACHER, 'getPktNowParts') + NL
    + extractFunction(TEACHER, 'handleAdvanceClassSubmit');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  await vm.runInContext('handleAdvanceClassSubmit(null)', sandbox);
  return upserts;
}
{
  const filled = await runAdvSave({ bookId: 'qaida-flat', lineBox: 'Line 3, Box 1' });
  const a1 = filled.length ? JSON.parse(filled[0][0].lesson_notes) : {};
  check('advance save: filled box stored exact as line_box (same key as main writer)',
    a1.line_box === 'Line 3, Box 1' && a1.is_advance_class === true && a1.page === 4, JSON.stringify(a1.line_box));

  const blank = await runAdvSave({ bookId: 'qaida-flat', lineBox: '' });
  const a2 = blank.length ? JSON.parse(blank[0][0].lesson_notes) : {};
  check('advance save: blank box stores line_box null', blank.length === 1 && a2.line_box === null);

  const addl = await runAdvSave({ bookId: 'additional-course', lineBox: 'Line 9, Box 9', courseName: 'Arabic Grammar Basics' });
  const a3 = addl.length ? JSON.parse(addl[0][0].lesson_notes) : {};
  check('advance save: Additional Course stores line_box null (mirrors orig_page in this writer)',
    addl.length === 1 && a3.line_box === null && a3.page === null);
}

// ===========================================================================
// D) Round-trip — save -> stored JSON string -> shared reader (THE hop)
// ===========================================================================
{
  const parsed = LH.parseLessonNotes(savedQuranNotes);
  check('round-trip: parseLessonNotes returns the note as lineBox', parsed && parsed.lineBox === 'Line 5, Box 2');
  const entry = LH.normalizeLessonRow({ id: 'L1', date: '2026-11-06', status: 'Completed', lesson_notes: savedQuranNotes }, 'Teacher One');
  check('round-trip: normalized entry carries lineBox', entry && entry.lineBox === 'Line 5, Box 2');

  const rows = [
    { id: 'L0', schedule_id: 'SCH-9', student_id: 'STU-1', teacher_id: 'TCH-1', date: '2026-11-05', status: 'Completed', created_at: '2026-11-05T10:00:00Z', lesson_notes: JSON.stringify({ book_id: 'qaida-flat', book_title: 'Qaida Book', page: 3, status: 'Pass' }) },
    { id: 'L1', schedule_id: 'SCH-9', student_id: 'STU-1', teacher_id: 'TCH-1', date: '2026-11-05', status: 'Completed', created_at: '2026-11-05T11:00:00Z', lesson_notes: savedQuranNotes },
  ];
  const deduped = LH.dedupeLessonRows(rows, {});
  check('round-trip: dedupe keeps the LATEST record note (never dropped by the merge)',
    deduped.length === 1 && deduped[0].lineBox === 'Line 5, Box 2', JSON.stringify(deduped.map(d => d.lineBox)));

  check('reader: legacy payload without line_box parses to lineBox null',
    LH.parseLessonNotes(JSON.stringify({ book_id: 'qaida-flat', page: 3 })).lineBox === null);
  check('reader: legacy plain-text note parses to lineBox null',
    LH.parseLessonNotes('Revision of yesterday').lineBox === null);
  const legacyEntry = LH.normalizeLessonRow({ date: '2026-11-01', status: 'Completed', lesson_notes: JSON.stringify({ book_id: 'qaida-flat', page: 3 }) }, null);
  check('reader: legacy entry lineBox is null (displays stay byte-identical)', legacyEntry.lineBox === null);
}

// ===========================================================================
// E) Display surfaces — REAL renderers
// ===========================================================================
function makeElement(id) {
  return {
    id, value: id && id.endsWith('StudentSelect') ? 'all' : '', innerHTML: '', textContent: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    style: {},
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

// E1) Teacher history cards (real renderTeacherLessonHistory, stubbed db).
{
  const documentStub = makeDocumentStub();
  const mkRow = (payload, id) => ({ id, schedule_id: null, student_id: 'STU-1', teacher_id: 'TCH-1', date: '2026-11-06', status: 'Completed', created_at: '2026-11-06T10:00:00Z', lesson_notes: JSON.stringify(payload), teachers: { full_name: 'Teacher One' } });
  const rows = [
    mkRow({ book_id: 'quran-default', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, line_box: 'Line 5, Box 2', status: 'Pass' }, 'T1'),
    mkRow({ book_id: 'quran-default', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, status: 'Pass' }, 'T2'),
  ];
  const sandbox = {
    console, document: documentStub, URL,
    CURRENT_TEACHER: { id: 'TCH-1', full_name: 'Teacher One' },
    ACTIVE_ASSIGNED_STUDENTS: [{ id: 'STU-1', name: 'Test Student' }], LEAVE_ASSIGNED_STUDENTS: [], ALL_TEACHER_SCHEDULES: [],
    getTeacherAllBooks: () => [QURAN_DEFAULT],
    db: { from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: rows }) }) }) }) },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.LessonHistory = LH;
  vm.createContext(sandbox);
  vm.runInContext(SECURITY, sandbox);
  vm.runInContext('let _LH_TEACHER_LIMIT = 100; let _LH_TEACHER_BLOB_URLS = []; let _LH_TEACHER_VISIBLE_ENTRIES = [];' + NL
    + extractFunction(TEACHER, '_lhTeacherRevokeBlobs') + NL
    + extractFunction(TEACHER, 'renderTeacherLessonHistory') + NL
    + 'this.__render = renderTeacherLessonHistory;', sandbox);
  await sandbox.__render(false);
  const html = documentStub.getElementById('lhTeacherHistoryList').innerHTML;
  check('teacher history: note renders right after the page (Para 2 • Page 25 • Line 5, Box 2)',
    html.includes('Para 2 • Page 25 • Line 5, Box 2'), html.slice(0, 300));
  check('teacher history: legacy card renders exactly as before (no note text, no stray separator)',
    html.includes('Para 2 • Page 25') && (html.match(/Line 5, Box 2/g) || []).length === 1);
}

// E2) Parent lesson cards (real renderRecentSabaqLogs).
{
  const documentStub = makeDocumentStub();
  const sandbox = {
    console, document: documentStub, setTimeout, clearTimeout,
    LessonHistory: LH, PARENT_SCHEDULE_MAP: {},
    getAllAvailableBooks: () => [QURAN_DEFAULT],
    fetch: async () => { throw new Error('no fetch in unit tests'); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SECURITY, sandbox);
  vm.runInContext('let LATEST_SABAQ_META = null;' + NL
    + extractFunction(PARENT, 'parentIsAttendedStatus') + NL
    + extractFunction(PARENT, 'parentLessonOrigPage') + NL
    + extractFunction(PARENT, 'renderRecentSabaqLogs') + NL
    + 'this.__render = renderRecentSabaqLogs;', sandbox);
  const mkLog = (payload) => {
    const row = { id: 'L', student_id: 'S1', date: '2026-11-01', status: 'Completed', lesson_notes: JSON.stringify(payload) };
    row._lhEntry = LH.normalizeLessonRow(row, 'Teacher One');
    return row;
  };
  sandbox.__render([
    mkLog({ book_id: 'quran-default', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, line_box: 'Line 5, Box 2', status: 'Pass' }),
    mkLog({ book_id: 'quran-default', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, status: 'Pass' }),
  ], 'Teacher One');
  const html = documentStub.getElementById('parentLessonNotesContainer').innerHTML;
  check('parent cards: badge shows the note right after the page (Page 25 • Line 5, Box 2)',
    html.includes('Page 25 • Line 5, Box 2') || html.includes('Page 25 &bull; Line 5, Box 2'), html.slice(0, 300));
  check('parent cards: legacy card has no note (exactly one occurrence overall)',
    (html.match(/Line 5, Box 2/g) || []).length === 1);
}

// E3) Parent attendance table topic (real renderAttendanceTable).
{
  const documentStub = makeDocumentStub();
  const sandbox = {
    console, document: documentStub,
    LessonHistory: LH, PARENT_SCHEDULE_MAP: {},
    getAllAvailableBooks: () => [QURAN_DEFAULT],
    fetch: async () => { throw new Error('no fetch in unit tests'); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SECURITY, sandbox);
  vm.runInContext(extractFunction(PARENT, 'parentIsAttendedStatus') + NL
    + extractFunction(PARENT, 'parentLessonOrigPage') + NL
    + extractFunction(PARENT, 'renderAttendanceTable') + NL
    + 'this.__render = renderAttendanceTable;', sandbox);
  const mkLog = (payload) => {
    const row = { id: 'L', student_id: 'S1', date: '2026-11-01', status: 'Completed', lesson_notes: JSON.stringify(payload) };
    row._lhEntry = LH.normalizeLessonRow(row, 'Teacher One');
    return row;
  };
  sandbox.__render([
    mkLog({ book_id: 'quran-default', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, line_box: 'Line 5, Box 2', status: 'Pass' }),
    mkLog({ book_id: 'quran-default', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, status: 'Pass' }),
  ], 'Teacher One');
  const html = documentStub.getElementById('attendanceTableBody').innerHTML;
  check('parent attendance topic: note appended after the page segment',
    html.includes('(Page 25) • Line 5, Box 2'), html.slice(0, 400));
  check('parent attendance topic: legacy row byte-identical to the pre-change topic',
    html.includes('HOLY QURAN 16 LINE • Para 2 (Page 25)') && (html.match(/Line 5, Box 2/g) || []).length === 1);
}

// E4) Admin 360 — real _parseLessonDetails360 (table title + parsed field),
//     plus the inspector's ordering (structural: the inspector lives inside
//     the 360 workspace template and is not separately extractable; its two
//     inputs — en.lineBox and p.lineBox — are both proven behaviourally).
{
  const sandbox = { console, LessonHistory: LH, getAllAvailableBooks: () => [QURAN_ANCHORED, QAIDA], fetch: async () => { throw new Error('no fetch'); } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(P360, '_parseLessonDetails360') + NL + 'this.__parse = _parseLessonDetails360;', sandbox);
  const parse = sandbox.__parse;
  const withNote = parse({ lesson_notes: JSON.stringify({ book_id: 'quran-anchored', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5, line_box: 'Line 5, Box 2' }) });
  check('360 table: title appends the raw note right after the (converted) page',
    withNote.summaryTitle === 'HOLY QURAN 16 LINE • Page 106 • Line 5, Box 2', withNote.summaryTitle);
  check('360 parser: lineBox exposed for the inspector fallback', withNote.lineBox === 'Line 5, Box 2');
  const legacy = parse({ lesson_notes: JSON.stringify({ book_id: 'quran-anchored', book_title: 'HOLY QURAN 16 LINE', para: 2, page: 5 }) });
  check('360 table: legacy title unchanged and lineBox empty',
    legacy.summaryTitle === 'HOLY QURAN 16 LINE • Page 106' && legacy.lineBox === '');
  const plain = parse({ lesson_notes: 'Revision of yesterday' });
  check('360 parser: plain-text record unchanged (lineBox empty)', plain.lineBox === '' && plain.summaryTitle === 'Revision of yesterday');

  const pagePushIdx = P360.indexOf('progressBits.push(`Page ${_dispPage360}`)');
  const lineBoxIdx = P360.indexOf("progressBits.push(en.lineBox)", pagePushIdx);
  const pLineBoxIdx = P360.indexOf("progressBits.push(p.lineBox)", pagePushIdx);
  const refIdx = P360.indexOf("progressBits.push(`Ref: ${en.pageReference}`)", pagePushIdx);
  check('360 inspector: note bits sit after the Page bit and before the Ref bit',
    pagePushIdx > 0 && lineBoxIdx > pagePushIdx && pLineBoxIdx > pagePushIdx && refIdx > lineBoxIdx && refIdx > pLineBoxIdx);
}

// ===========================================================================
// F) Reopen / edit — the attendance modal IS the lesson edit UI: it must
//    pre-fill the box from the record being edited (structural, mirroring
//    the writers suite's restore checks on the same function).
// ===========================================================================
{
  const openModal = extractFunction(TEACHER, 'openAttendanceModal');
  check('reopen: box pre-filled from the prior record in BOTH restore branches',
    (openModal.match(/attLineBox'\)\.value = parsedNotes\.line_box \|\| ''/g) || []).length === 2);
  check('reopen: box cleared for a fresh record', openModal.includes("attLineBox').value = '';"));
  const advOpen = extractFunction(TEACHER, 'openAdvanceClassModal');
  check('advance modal: box cleared on open (create-only form)', advOpen.includes("getElementById('advLineBox')"));
}

const failed = results.filter(r => !r.pass);
console.log(`---\nlesson-line-box-note: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
