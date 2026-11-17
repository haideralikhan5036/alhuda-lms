// Teacher lesson form — ADVANCE modal + COVER classes + fail-closed modal
// context (regression investigation 2026-11-17).
//
// The end-class (attendance) modal was scoped to the student's assigned
// courses by PR #104 and that code is byte-identical since (28/28 in
// teacher-lesson-course-from-student.test.mjs). What the investigation
// found broken is the OTHER lesson-recording surface and the paths
// around it:
//
//  1. The ADVANCE Class modal (openAdvanceClassModal) populates its
//     Course dropdown with the FULL global book list for every student
//     and only *suggests* a book by a name heuristic — a teacher can
//     pick and save any unrelated course. It was never student-scoped
//     (git log -S: untouched since the advance feature landed).
//  2. The suggestion heuristic names book id 'quran-16-line', which
//     does not exist (the real book is 'holy-quran-16-line'), so for a
//     Quran student the select takes no value and
//     onAdvanceCourseBookChanged notifies "Course book not found" with
//     no pages populated.
//  3. Cover classes resolve their course ONLY from the
//     cover_assignments snapshot; when the source schedule's
//     course_name is empty the cover teacher sees "No course assigned"
//     instead of the student's course.
//  4. populateTeacherCourseBooks shows the FULL global list whenever
//     the modal's student context is null (stale class id, missing
//     join) — a fail-open leak. It must fail closed (placeholder +
//     Additional Course) when a student context was supplied but the
//     student could not be resolved; the boot-time no-context fill
//     keeps the global list.
//
// This suite EXECUTES the real modal functions from teacher.html in a
// vm with fixture books / catalogue / students (house pattern, cf.
// test/teacher-lesson-course-from-student.test.mjs).
// Run from the repo root:  node test/teacher-lesson-course-advance-cover.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHER_HTML = read('teacher.html');
const PROFILES_360 = read('js/profiles360.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// Brace-aware extractor: strings, template literals (with ${}
// interpolation), and comments must not disturb the brace count —
// a string literal such as '{' would otherwise swallow the rest of
// the script block. The body's opening brace is the first '{' AFTER
// the parameter list closes, so default values such as
// `accountsMap = {}` cannot end the extraction early.
function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = start;
  let pdepth = 0;
  let inParams = false;
  let paramsDone = false;
  let depth = 0;
  const stack = [{ kind: 'code' }];
  for (; i < src.length; i++) {
    const ch = src[i];
    const top = stack[stack.length - 1];
    if (top.kind === 'single' || top.kind === 'double') {
      if (ch === '\\') { i++; continue; }
      if ((top.kind === 'single' && ch === "'") || (top.kind === 'double' && ch === '"')) stack.pop();
      continue;
    }
    if (top.kind === 'line') { if (ch === '\n') stack.pop(); continue; }
    if (top.kind === 'block') { if (ch === '*' && src[i + 1] === '/') { stack.pop(); i++; } continue; }
    if (top.kind === 'template') {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') { stack.pop(); continue; }
      if (ch === '$' && src[i + 1] === '{') {
        stack.push({ kind: 'code', interp: true, entryDepth: depth });
        i++; depth++;
        continue;
      }
      continue;
    }
    if (ch === "'") { stack.push({ kind: 'single' }); continue; }
    if (ch === '"') { stack.push({ kind: 'double' }); continue; }
    if (ch === '`') { stack.push({ kind: 'template' }); continue; }
    if (ch === '/' && src[i + 1] === '/') { stack.push({ kind: 'line' }); i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { stack.push({ kind: 'block' }); i++; continue; }
    if (!paramsDone) {
      if (ch === '(') { pdepth++; inParams = true; continue; }
      if (ch === ')') {
        pdepth--;
        if (inParams && pdepth === 0) paramsDone = true;
        continue;
      }
      continue;
    }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0 && stack.length === 1) { i++; break; }
      if (top.interp && depth === top.entryDepth) stack.pop();
      continue;
    }
  }
  return src.slice(start, i);
}
function extractDecl(src, name) {
  const idx = src.search(new RegExp(`(?:const|let|var) ${name} =`));
  if (idx < 0) throw new Error('decl not found: ' + name);
  const end = src.indexOf(';', idx);
  return src.slice(idx, end + 1);
}

// ---- Fixtures (same shapes as teacher-lesson-course-from-student) -------
const BOOKS = [
  { id: 'custom-qaida-eng', title: 'Qaida Noorania Eng', category: 'qaida', category_label: 'Qaida', total_pages: 33 },
  { id: 'noorani-qaida-classic', title: 'Noorani Qaida Classic', category: 'qaida', category_label: 'Qaida', total_pages: 49 },
  { id: 'holy-quran-16-line', title: 'HOLY QURAN 16 LINE', category: 'quran', category_label: 'Quran', total_pages: 549, paras: [{ para: 1, page_start: 1, page_end: 20, total_pages: 20 }, { para: 2, page_start: 21, page_end: 38, total_pages: 18 }] },
  { id: 'custom-nazra-nocat', title: 'Nazra Quran Book', category: '', category_label: '', total_pages: 100 },
  { id: 'custom-tafseer-ur', title: 'Tafseer Urdu', category: 'tafseer', category_label: 'Tafseer', language: 'ur', total_pages: 200 },
  { id: 'custom-tafseer-en', title: 'Al Tafseer English', category: 'tafseer', category_label: 'Tafseer', language: 'en', total_pages: 295 },
  { id: 'custom-islamic-1', title: 'Islamic Studies Grade 1', category: 'islamic-studies', category_label: 'Islamic Studies', total_pages: 164 },
  { id: 'custom-arabic-1', title: 'Arabic Language Book', category: 'arabic', category_label: 'Arabic', total_pages: 80 },
  { id: 'custom-essentials', title: 'Essential Duas', category: 'essentials', category_label: 'Essentials', total_pages: 20 },
];
const COURSES = [
  { id: 'crs-noorani-qaida', name: 'Noorani Qaida', active: true, aliases: ['Noorani Qaida & Basic Arabic'] },
  { id: 'crs-quran-reading', name: 'Quran Reading with Tajweed', active: true, aliases: ['Quran Reading', 'Nazra Quran'] },
  { id: 'crs-tafseer-english', name: 'English Translation & Tafseer', active: true, aliases: ['Tafseer-ul-Quran', 'English Tafseer'] },
  { id: 'crs-tafseer-urdu', name: 'Urdu Translation & Tafseer', active: true, aliases: ['Urdu Tafseer'] },
  { id: 'crs-islamic-studies', name: 'Islamic Studies & Tarbiyah', active: true, aliases: ['Islamic Studies'] },
  { id: 'crs-arabic', name: 'Arabic Language & Grammar', active: true, aliases: ['Arabic'] },
];
const stu = (courseName, id = 'STU-1', extra = {}) => ({
  id, name: 'Fixture Student ' + id, status: 'Active',
  assigned_teacher_id: 'TCH-1',
  course_id: courseName === 'Quran Reading' ? 'Nazra Quran' : courseName,
  notes: JSON.stringify(courseName ? { course_name: courseName } : {}),
  ...extra,
});

// A <select> stub with browser value semantics (copied from
// teacher-lesson-course-from-student.test.mjs).
class FakeSelect {
  constructor() { this._options = []; this._value = ''; this._innerHTML = ''; }
  closest() { return null; }
  set innerHTML(html) {
    this._innerHTML = html;
    this._options = [];
    const re = /<option\s+value="([^"]*)"([^>]*)>([^<]*)<\/option>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      this._options.push({ value: m[1], disabled: /\bdisabled\b/.test(m[2]), label: m[3] });
    }
    this._value = this._options.length ? this._options[0].value : '';
  }
  get innerHTML() { return this._innerHTML; }
  get options() { return this._options; }
  set value(v) { const s = String(v); this._value = this._options.some(o => o.value === s) ? s : ''; }
  get value() { return this._value; }
}
class FakeEl {
  constructor(id) {
    this.id = id; this.value = ''; this.innerHTML = ''; this.innerText = '';
    this.style = {}; this.files = [];
    const set = new Set();
    this.classList = {
      add: (...cs) => cs.forEach(c => set.add(c)),
      remove: (...cs) => cs.forEach(c => set.delete(c)),
      contains: (c) => set.has(c),
      toggle: (c, force) => {
        if (force === undefined) { set.has(c) ? set.delete(c) : set.add(c); return set.has(c); }
        force ? set.add(c) : set.delete(c); return !!force;
      },
    };
    this._set = set;
  }
  closest() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
}

function makeEnv() {
  const notifies = [];
  const els = {};
  const el = (id) => {
    if (!els[id]) {
      els[id] = (id === 'attCourseBookSelect' || id === 'advCourseBookSelect' || id === 'advStudentSelect' ||
        id === 'advCoursePageSelect' || id === 'advQuranParaSelect' || id === 'attCoursePageSelect')
        ? new FakeSelect() : new FakeEl(id);
    }
    return els[id];
  };
  const store = new Map();
  const sandbox = {
    console,
    document: { getElementById: (id) => els[id] || null },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    sessionStorage: {
      getItem: (k) => (store.has('ss:' + k) ? store.get('ss:' + k) : null),
      setItem: (k, v) => store.set('ss:' + k, String(v)),
      removeItem: (k) => store.delete('ss:' + k),
    },
    getTeacherAllBooks: () => BOOKS.slice(),
    Assignments: {
      studentCourseName: (student) => {
        if (!student) return '';
        let name = '';
        if (student.notes) {
          try {
            const n = typeof student.notes === 'string' ? JSON.parse(student.notes) : student.notes;
            name = (n && (n.course_name || n.course || n.trial_course)) || '';
          } catch (e) {}
        }
        if (!name && student.course_id && typeof student.course_id === 'string' && !/^[0-9a-f-]{20,}$/i.test(student.course_id)) name = student.course_id;
        return String(name || '');
      },
    },
    CourseCatalogue: {
      resolveByName: (name) => {
        const target = String(name || '').trim().toLowerCase();
        if (!target) return null;
        for (const c of COURSES) if (c.name.toLowerCase() === target) return c;
        for (const c of COURSES) for (const a of (c.aliases || [])) if (String(a).trim().toLowerCase() === target) return c;
        return null;
      },
      getSettings: () => ({ courses: COURSES }),
    },
    QURAN_PARAS_LIST: [
      { para: 1, name: 'Alif Lam Meem', page_start: 1, page_end: 20 },
      { para: 2, name: 'Sayaqool', page_start: 21, page_end: 38 },
    ],
    lmsNotify: (msg) => { notifies.push(String(msg)); },
    escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    onTeacherCourseBookChanged: (v) => { sandbox.__attChangeCalls.push(v); },
    selectAttendanceStatus: (s) => { sandbox.__statusCalls.push(s); },
    showTeacherLessonImagePreview: () => {},
    renderAttAnnotatedPagesStrip: () => {},
    pushTeacherModalHistory: () => {},
    CURRENT_TEACHER: { id: 'TCH-1', full_name: 'Test Teacher', zoom_link: '' },
    __attChangeCalls: [],
    __statusCalls: [],
  };
  sandbox.window = sandbox;
  sandbox.__notifies = notifies;
  sandbox.__el = el;
  // Pre-create every element the modal code touches so getElementById
  // never returns null mid-flow (unknown ids stay null on purpose).
  ['attScheduleId', 'attStudentId', 'attModalSubtitle', 'attLastSabaqBadge',
    'attAdditionalCourseName', 'attAdditionalCourseReference', 'attLineRange',
    'attLineBox', 'attSabaqResult', 'attSabaqRating', 'attLessonNotes',
    'attAdditionalLesson', 'attLessonImageKey', 'attLessonImageFile',
    'attCourseBookSelect', 'attCoursePageSelect',
    'advStudentSelect', 'advTargetDate', 'advCourseBookSelect',
    'advCoursePageSelect', 'advQuranParaContainer', 'advQuranParaSelect',
    'advTafseerLanguageContainer', 'advTafseerLanguageSelect',
    'advParaLabelText', 'advAdditionalCourseContainer',
    'advAdditionalCourseName', 'advAdditionalCourseReference',
    'advLessonImageFile', 'advLessonImageKey', 'advLineBox', 'advLessonNotes',
    'advRemarkChips', 'advStudentMetaNotice', 'advStudentMetaText',
    'modalTeacherAdvanceClass', 'attAdditionalCourseContainer',
    'attTafseerLanguageContainer', 'attQuranParaContainer',
    'modalTeacherAttendance',
  ].forEach((id) => el(id));

  const parts = [
    extractDecl(TEACHER_HTML, 'ADDITIONAL_COURSE_ID'),
    extractDecl(TEACHER_HTML, '_attCourseStudentCtx'),
    extractDecl(TEACHER_HTML, '_ATT_PRIOR_NOTES'),
    extractDecl(TEACHER_HTML, 'ADVANCE_SELECTED_STUDENT'),
    extractFunction(TEACHER_HTML, '_resolveCatalogueCourse'),
    extractFunction(TEACHER_HTML, '_courseBookFamily'),
    extractFunction(TEACHER_HTML, '_booksForCourseFamily'),
    extractFunction(TEACHER_HTML, '_resolveStudentCourseBooks'),
    extractFunction(TEACHER_HTML, 'getStudentCourseBooks'),
    extractFunction(TEACHER_HTML, 'populateTeacherCourseBooks'),
    extractFunction(TEACHER_HTML, 'isPortalRegularStudent'),
    extractFunction(TEACHER_HTML, 'isPortalStudentDeactivated'),
    extractFunction(TEACHER_HTML, 'isPortalStudentOnLeave'),
    extractFunction(TEACHER_HTML, 'setAdditionalCourseMode'),
    extractFunction(TEACHER_HTML, 'syncRemarkChips'),
    extractFunction(TEACHER_HTML, 'buildLessonPageOptions'),
    extractFunction(TEACHER_HTML, 'teacherParasListFor'),
    extractFunction(TEACHER_HTML, 'onAdvanceQuranParaChanged'),
    extractFunction(TEACHER_HTML, 'onAdvanceCourseBookChanged'),
    extractFunction(TEACHER_HTML, 'populateAdvanceClassStudents'),
    extractFunction(TEACHER_HTML, 'onAdvanceStudentChanged'),
    extractFunction(TEACHER_HTML, 'openAdvanceClassModal'),
    extractFunction(TEACHER_HTML, 'openAttendanceModal'),
  ];
  // populateAdvanceCourseBooks is the fix's new helper: absent on main
  // (the advance modal populates inline there), present after the fix.
  let hasAdvPopulate = false;
  try {
    parts.push(extractFunction(TEACHER_HTML, 'populateAdvanceCourseBooks'));
    hasAdvPopulate = true;
  } catch (e) { /* expected on main: fail-first structural check below */ }
  vm.createContext(sandbox);
  vm.runInContext(parts.join('\n'), sandbox);
  sandbox.__hasAdvPopulate = hasAdvPopulate;
  const run = (expr) => vm.runInContext(expr, sandbox);
  return {
    sandbox, run, notifies, els,
    advVals: () => el('advCourseBookSelect').options.map(o => o.value),
    advSelected: () => el('advCourseBookSelect').value,
    attVals: () => el('attCourseBookSelect').options.map(o => o.value),
    attSelected: () => el('attCourseBookSelect').value,
    setLists: (students) => {
      sandbox.ASSIGNED_STUDENTS = students;
      sandbox.ACTIVE_ASSIGNED_STUDENTS = students;
      sandbox.LEAVE_ASSIGNED_STUDENTS = [];
      sandbox.ALL_TEACHER_SCHEDULES = [];
      sandbox.TODAY_CLASSES = [];
    },
  };
}

// ---- 1) Advance modal: Quran student sees ONLY Quran books -------------
{
  const env = makeEnv();
  const quranStu = stu('Quran Reading', 'STU-Q');
  env.setLists([quranStu, stu('Noorani Qaida', 'STU-K'), stu('Islamic Studies', 'STU-I')]);
  env.run('openAdvanceClassModal()');
  check('advance: Quran student dropdown is quran books + Additional Course only',
    JSON.stringify(env.advVals()) === JSON.stringify(['holy-quran-16-line', 'custom-nazra-nocat', 'additional-course']),
    env.advVals().join(','));
  check('advance: no qaida/tafseer/islamic/arabic/essentials leakage for the Quran student',
    !env.advVals().some(v => ['custom-qaida-eng', 'noorani-qaida-classic', 'custom-tafseer-en', 'custom-tafseer-ur', 'custom-islamic-1', 'custom-arabic-1', 'custom-essentials'].includes(v)));
  check('advance: a real Quran book is preselected (never a stale id)',
    env.advSelected() === 'holy-quran-16-line', 'value=' + env.advSelected());
  check('advance: no "Course book not found" notify for the Quran student',
    !env.notifies.some(m => m.includes('Course book not found')));
  check('advance: page options populated for the selected Quran book',
    env.els['advCoursePageSelect'].options.length > 0,
    'pages=' + env.els['advCoursePageSelect'].options.length);
}

// ---- 2) Advance modal: switching students re-scopes ----------------------
{
  const env = makeEnv();
  const quranStu = stu('Quran Reading', 'STU-Q');
  const qaidaStu = stu('Noorani Qaida', 'STU-K');
  env.setLists([quranStu, qaidaStu]);
  env.run('openAdvanceClassModal()');
  env.sandbox.__stuId = 'STU-K';
  env.run('onAdvanceStudentChanged(__stuId)');
  check('advance: switching to the Qaida student shows qaida books only',
    JSON.stringify(env.advVals()) === JSON.stringify(['custom-qaida-eng', 'noorani-qaida-classic', 'additional-course']),
    env.advVals().join(','));
  check('advance: no Quran books leak into the Qaida student form',
    !env.advVals().some(v => v === 'holy-quran-16-line' || v === 'custom-nazra-nocat'));
  check('advance: Qaida book preselected after the switch',
    env.advSelected() === 'custom-qaida-eng', 'value=' + env.advSelected());
}

// ---- 3) Advance modal: student with no assigned course -------------------
{
  const env = makeEnv();
  const noCourse = stu('', 'STU-N');
  env.setLists([noCourse]);
  env.run('openAdvanceClassModal()');
  check('advance: no-course student gets the placeholder + Additional Course only',
    env.advVals().length === 2 && env.advVals()[0] === '' && env.advVals()[1] === 'additional-course',
    env.advVals().join(','));
  check('advance: no-course student has Additional Course selected (free-text path)',
    env.advSelected() === 'additional-course', 'value=' + env.advSelected());
}

// ---- 4) Advance modal: Additional Lesson (Duas/Namaz) untouched ----------
check('advance: Additional Lesson input (Duas/Namaz) still in the markup',
  TEACHER_HTML.includes('id="advAdditionalLesson"') &&
  TEACHER_HTML.includes('Namaz: Surah Fatiha, Duas: Morning Duas'));
check('advance: save still carries additional_lesson for standard courses',
  TEACHER_HTML.includes("additional_lesson: isAdditionalCourse ? null : (advAdditionalLesson || null)"));
check('advance: the student-scoping helper exists and the modal uses it',
  makeEnv().sandbox.__hasAdvPopulate && TEACHER_HTML.includes('populateAdvanceCourseBooks('));

// ---- 5) End-class modal: fail-closed when the student cannot be resolved --
{
  const env = makeEnv();
  env.setLists([stu('Quran Reading', 'STU-Q')]);
  // A stale class id: in no list, no joined student row, no student id.
  env.sandbox.__sid = 'SCH-STALE';
  env.run(`openAttendanceModal(__sid)`);
  check('end-class: stale class id does NOT open the global book list',
    !env.attVals().includes('custom-qaida-eng') && !env.attVals().includes('custom-islamic-1'),
    env.attVals().join(','));
  check('end-class: stale class id shows the no-course placeholder + Additional Course',
    env.attVals().length === 2 && env.attVals()[0] === '' && env.attVals()[1] === 'additional-course' &&
    env.attSelected() === 'additional-course',
    env.attVals().join(',') + ' value=' + env.attSelected());
}

// ---- 6) End-class modal: own-class scoping still works (regression guard) --
{
  const env = makeEnv();
  const quranStu = stu('Quran Reading', 'STU-Q');
  env.setLists([quranStu]);
  env.sandbox.TODAY_CLASSES = [{
    id: 'SCH-1', student_id: 'STU-Q', course_name: 'Quran Reading',
    start_time: '10:00', end_time: '10:30',
    students: quranStu, log: null,
  }];
  env.sandbox.__sid = 'SCH-1';
  env.run(`openAttendanceModal(__sid)`);
  check('end-class: own Quran class still scoped to quran books only',
    JSON.stringify(env.attVals()) === JSON.stringify(['holy-quran-16-line', 'custom-nazra-nocat', 'additional-course']),
    env.attVals().join(','));
}

// ---- 7) End-class modal: COVER class with a populated snapshot -----------
{
  const env = makeEnv();
  // The cover teacher has no record of this student: the class carries
  // only the cover snapshot (synthetic students object + course_name).
  env.setLists([]);
  env.sandbox.TODAY_CLASSES = [{
    id: 'SCH-COV', student_id: 'STU-COV', course_name: 'Quran Reading',
    start_time: '11:00', end_time: '11:30', isCoverClass: true,
    students: { id: 'STU-COV', name: 'Covered Student', status: 'Active', course: 'Quran Reading' },
    log: null,
  }];
  env.sandbox.__sid = 'SCH-COV';
  env.run(`openAttendanceModal(__sid)`);
  check('end-class: cover class with a course snapshot is scoped to quran books',
    JSON.stringify(env.attVals()) === JSON.stringify(['holy-quran-16-line', 'custom-nazra-nocat', 'additional-course']),
    env.attVals().join(','));
}

// ---- 8) End-class modal: COVER class with an EMPTY snapshot ---------------
{
  const env = makeEnv();
  env.setLists([]);
  env.sandbox.TODAY_CLASSES = [{
    id: 'SCH-COV2', student_id: 'STU-COV', course_name: '',
    start_time: '11:00', end_time: '11:30', isCoverClass: true,
    students: { id: 'STU-COV', name: 'Covered Student', status: 'Active', course: '' },
    log: null,
  }];
  env.sandbox.__sid = 'SCH-COV2';
  env.run(`openAttendanceModal(__sid)`);
  check('end-class: cover class with an empty snapshot fails closed (no global list)',
    env.attVals().length === 2 && env.attVals()[0] === '' && env.attVals()[1] === 'additional-course',
    env.attVals().join(','));
}

// ---- 9) Cover snapshot: assign stores the student's stored course --------
check('cover assign stores the student stored course when the schedule has none',
  PROFILES_360.includes('scheduleRow.course_name ||') &&
  /course_name:\s*scheduleRow\.course_name\s*\|\|[\s\S]{0,160}?studentCourseName\(student\)/.test(PROFILES_360),
  'profiles360.js cover insert must fall back to Assignments.studentCourseName(student)');

// ---- 10) Boot-time no-context fill keeps the global list ------------------
{
  const env = makeEnv();
  env.run('populateTeacherCourseBooks()');
  check('boot fill (no context): global list preserved for the hidden dropdown',
    env.attVals().length === BOOKS.length + 1 && env.attVals()[env.attVals().length - 1] === 'additional-course',
    env.attVals().join(','));
}

const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
process.exit(failed.length ? 1 : 0);
