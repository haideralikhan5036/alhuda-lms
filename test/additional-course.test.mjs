// Additional Course (Task 1) tests — teacher lesson recording:
//  A) Sentinel plumbing: the Additional Course option exists in BOTH the
//     main modal and the advance-form population; the change handlers
//     short-circuit for the sentinel (custom inputs shown, page cell +
//     para/language hidden) and NEVER resolve it to allBooks[0]; a
//     catalogue book restores the normal form.
//  B) Save branch (REAL saveAttendanceAndLessonNotes, stubbed environment):
//     sentinel payload shape exactly (book_id, book_title = entered name,
//     content_type 'additional', lesson_name, page null, para null,
//     language null); missing course/lesson name notifies and saves nothing;
//     a catalogue book still saves its own title + page.
//  C) Display guards: teacher history, parent latest/history and the
//     dashboard widget all key their "Page N" label and reader button on
//     the sentinel; the reader entry points early-return for it; the
//     Teacher 360 parser (REAL _parseLessonDetails360) surfaces the lesson
//     name with no Page suffix for sentinel records.
// Run from the repo root:  node test/additional-course.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHER_HTML = read('teacher.html');
const PARENT_HTML = read('parent.html');
const DASHBOARD_JS = read('js/dashboard.js');
const PROFILES360_JS = read('js/profiles360.js');

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
  const m = src.match(new RegExp(`const ${name} = '[^']+';`));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

// ---- A) structural: sentinel option + short-circuits exist ----
check('main modal population appends the Additional Course option',
  TEACHER_HTML.includes('<option value="${ADDITIONAL_COURSE_ID}">Additional Course</option>'));
check('advance-form population appends the Additional Course option',
  (TEACHER_HTML.match(/Additional Course<\/option>/g) || []).length >= 2);
check('main change handler short-circuits on the sentinel before the catalogue fallback',
  extractFunction(TEACHER_HTML, 'onTeacherCourseBookChanged').includes("bookId === ADDITIONAL_COURSE_ID"));
check('advance change handler short-circuits on the sentinel before the catalogue fallback',
  extractFunction(TEACHER_HTML, 'onAdvanceCourseBookChanged').includes("bookId === ADDITIONAL_COURSE_ID"));
check('main save handler branches on the sentinel before the book lookup',
  extractFunction(TEACHER_HTML, 'saveAttendanceAndLessonNotes').includes("bookId === ADDITIONAL_COURSE_ID"));
check('advance save handler branches on the sentinel',
  extractFunction(TEACHER_HTML, 'handleAdvanceClassSubmit').includes('isAdditionalCourse'));
check('teacher reader early-returns for the sentinel',
  extractFunction(TEACHER_HTML, 'openDigitalBookReader').includes("bookId === ADDITIONAL_COURSE_ID"));
check('parent reader early-returns for the sentinel',
  extractFunction(PARENT_HTML, 'openParentDigitalReader').includes("bookId === 'additional-course'"));
check('teacher history guards the Page label + Read button on the sentinel',
  TEACHER_HTML.includes('isAddCourseHist'));
check('parent latest cards guard the Page badge + Revise button on the sentinel',
  PARENT_HTML.includes('isAddCourse'));
check('parent history topic guards the Page suffix on the sentinel',
  PARENT_HTML.includes("meta.book_id === 'additional-course'"));
check('dashboard widget guards the Pg label + Read button on the sentinel',
  DASHBOARD_JS.includes('isAddCourseDash'));

// ---- A2) behavioural: change handler + visibility helper (REAL functions) ----
function stubEl() {
  return {
    value: '', innerHTML: '', style: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
  };
}
function makeDoc() {
  const els = {};
  const pageCell = { style: {} };
  const ids = ['attCoursePageSelect', 'attQuranParaContainer', 'attQuranParaSelect',
    'attTafseerLanguageContainer', 'attTafseerLanguageSelect', 'attParaLabelText',
    'attAdditionalCourseContainer', 'attAdditionalCourseName', 'attAdditionalLessonName'];
  ids.forEach(id => { els[id] = stubEl(); });
  els.attCoursePageSelect.closest = () => ({ parentElement: pageCell });
  els.attAdditionalCourseContainer.classList.add('hidden');
  return { els, pageCell, getElementById: (id) => els[id] || null };
}
{
  const doc = makeDoc();
  const sandbox = {
    console, document: doc,
    getTeacherAllBooks: () => [{ id: 'c1', title: 'Custom Essentials', category: 'essentials', total_pages: 5 }],
  };
  const code = extractConst(TEACHER_HTML, 'ADDITIONAL_COURSE_ID') + '\n'
    + extractFunction(TEACHER_HTML, 'setAdditionalCourseMode') + '\n'
    + extractFunction(TEACHER_HTML, 'buildLessonPageOptions') + '\n'
    + extractFunction(TEACHER_HTML, 'onTeacherCourseBookChanged');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  // Sentinel selected: custom inputs shown, page cell + para/lang hidden.
  vm.runInContext(`onTeacherCourseBookChanged('additional-course')`, sandbox);
  check('sentinel change: custom container shown',
    !doc.els.attAdditionalCourseContainer.classList.contains('hidden'));
  check('sentinel change: page cell hidden', doc.pageCell.style.display === 'none');
  check('sentinel change: para + language containers hidden',
    doc.els.attQuranParaContainer.classList.contains('hidden') &&
    doc.els.attTafseerLanguageContainer.classList.contains('hidden'));
  // Catalogue book selected: form restored, custom inputs cleared + hidden.
  doc.els.attAdditionalCourseName.value = 'Stale Name';
  vm.runInContext(`onTeacherCourseBookChanged('c1')`, sandbox);
  check('catalogue change: custom container hidden again',
    doc.els.attAdditionalCourseContainer.classList.contains('hidden'));
  check('catalogue change: custom inputs cleared',
    doc.els.attAdditionalCourseName.value === '');
  check('catalogue change: page cell restored', doc.pageCell.style.display === '');
  check('catalogue change: page options generated (5)',
    (doc.els.attCoursePageSelect.innerHTML.match(/<option/g) || []).length === 5);
}

// ---- B) behavioural: save branch (REAL saveAttendanceAndLessonNotes) ----
async function runSave({ selectValue, courseName, lessonName }) {
  const upserts = [];
  const notifies = [];
  const el = (value = '') => ({ value, innerHTML: '', disabled: false });
  const els = {
    attScheduleId: el('SCH-1'), attStudentId: el('STU-1'), attSelectedStatus: el('Present'),
    attAdvanceTargetDate: el(''), attCourseBookSelect: el(selectValue),
    attAdditionalCourseName: el(courseName), attAdditionalLessonName: el(lessonName),
    attCoursePageSelect: el('3'), attLineRange: el('Lines 1-5'), attSabaqResult: el('Pass'),
    attSabaqRating: el('5'), attLessonNotes: el('Good work'),
    attTafseerLanguageSelect: el('ur'), attQuranParaSelect: el('1'),
    btnSaveAttendance: el(''),
  };
  const sandbox = {
    console, lmsNotify: (m) => notifies.push(m),
    document: { getElementById: (id) => els[id] || null },
    CURRENT_TEACHER: { id: 'TCH-1' },
    getTeacherAllBooks: () => [{ id: 'q1', title: 'Qaida Book', category: 'qaida', total_pages: 10 }],
    db: { from: () => ({ upsert: async (rows) => { upserts.push(rows); return { error: null }; } }) },
    notifyClassSessionSync: () => {}, closeAttendanceModal: () => {},
    loadTeacherPortalData: async () => {},
  };
  // Lesson History: the save now stamps the PKT date via the REAL
  // getPktNowParts (extracted, not stubbed) -- the sandbox must provide
  // it, like every other production dependency of the save function.
  const code = extractConst(TEACHER_HTML, 'ADDITIONAL_COURSE_ID') + '\n'
    + extractFunction(TEACHER_HTML, 'getPktNowParts') + '\n'
    + extractFunction(TEACHER_HTML, 'saveAttendanceAndLessonNotes');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  await vm.runInContext('saveAttendanceAndLessonNotes()', sandbox);
  return { upserts, notifies };
}
{
  const { upserts, notifies } = await runSave({
    selectValue: 'additional-course', courseName: 'Arabic Grammar Basics', lessonName: 'Lesson 5: Past Tense Verbs',
  });
  check('sentinel save: one upsert, only the success notification (no validation notification)',
    upserts.length === 1 && notifies.every(a => a.includes('Saved Successfully')), `notifies: ${JSON.stringify(notifies)}`);
  const payload = upserts.length ? JSON.parse(upserts[0][0].lesson_notes) : {};
  check('sentinel save: payload book_id is the sentinel', payload.book_id === 'additional-course');
  check('sentinel save: book_title is the entered course name', payload.book_title === 'Arabic Grammar Basics');
  check('sentinel save: content_type additional + lesson_name carried', payload.content_type === 'additional' && payload.lesson_name === 'Lesson 5: Past Tense Verbs');
  check('sentinel save: page/para/language are null (never a fake Page 1)', payload.page === null && payload.para === null && payload.language === null);
  check('sentinel save: status/rating/remarks preserved', payload.status === 'Pass' && payload.rating === 5 && payload.remarks === 'Good work');
  check('sentinel save: same schedule/student/date associations', upserts[0][0].schedule_id === 'SCH-1' && upserts[0][0].student_id === 'STU-1' && upserts[0][0].status === 'Completed');

  const missing = await runSave({ selectValue: 'additional-course', courseName: '', lessonName: 'Some lesson' });
  check('sentinel save: missing course name notifies and saves nothing', missing.notifies.length === 1 && missing.upserts.length === 0);
  const missing2 = await runSave({ selectValue: 'additional-course', courseName: 'Some course', lessonName: '   ' });
  check('sentinel save: blank lesson name notifies and saves nothing', missing2.notifies.length === 1 && missing2.upserts.length === 0);

  const cat = await runSave({ selectValue: 'q1', courseName: '', lessonName: '' });
  const catPayload = cat.upserts.length ? JSON.parse(cat.upserts[0][0].lesson_notes) : {};
  check('catalogue save unchanged: own title + page', catPayload.book_id === 'q1' && catPayload.book_title === 'Qaida Book' && catPayload.page === 3);
}

// ---- C) Teacher 360 parser (REAL function, profiles360.js) ----
{
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(PROFILES360_JS, '_parseLessonDetails360'), sandbox);
  const sentinel = vm.runInContext(`_parseLessonDetails360({ lesson_notes: JSON.stringify({ book_id: 'additional-course', book_title: 'Arabic Grammar Basics', lesson_name: 'Lesson 5: Past Tense Verbs', page: null }) })`, sandbox);
  check('360 parser: sentinel title shows lesson name, no Page suffix',
    sentinel.summaryTitle === 'Arabic Grammar Basics — Lesson 5: Past Tense Verbs');
  const normal = vm.runInContext(`_parseLessonDetails360({ lesson_notes: JSON.stringify({ book_title: 'Qaida Book', page: 7 }) })`, sandbox);
  check('360 parser: catalogue record unchanged', normal.summaryTitle === 'Qaida Book • Page 7');
}

const failed = results.filter(r => !r.pass);
console.log(`---\nadditional-course: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
