// Teacher lesson form: the attendance modal's Course dropdown must be
// populated from THIS student's assigned courses (student record +
// the ended class's own course), not the global book list. Executes the
// REAL helper + populate extracted from teacher.html in a vm with
// fixture books / catalogue / students (house pattern, cf.
// test/additional-course.test.mjs).
// Run from the repo root:  node test/teacher-lesson-course-from-student.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
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
function extractDecl(src, name) {
  const idx = src.search(new RegExp(`(?:const|let|var) ${name} =`));
  if (idx < 0) throw new Error('decl not found: ' + name);
  const end = src.indexOf(';', idx);
  return src.slice(idx, end + 1);
}

// ---- Fixtures -------------------------------------------------------------
// Library order matters: the Urdu tafseer deliberately precedes the
// English one so the language-first ordering is exercised.
const BOOKS = [
  { id: 'custom-qaida-eng', title: 'Qaida Noorania Eng', category: 'qaida', category_label: 'Qaida', total_pages: 33 },
  { id: 'noorani-qaida-classic', title: 'Noorani Qaida Classic', category: 'qaida', category_label: 'Qaida', total_pages: 49 },
  { id: 'holy-quran-16-line', title: 'HOLY QURAN 16 LINE', category: 'quran', category_label: 'Quran', total_pages: 549 },
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
const stu = (courseName, id = 'STU-1') => ({
  id, name: 'Fixture Student',
  notes: JSON.stringify(courseName ? { course_name: courseName } : {}),
});

// A <select> stub with browser value semantics: setting innerHTML
// rebuilds the option list; assigning a value that is not an option
// leaves the select with no selection ('').
class FakeSelect {
  constructor() { this._options = []; this._value = ''; this._innerHTML = ''; }
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

function makeEnv() {
  const select = new FakeSelect();
  const additionalLesson = { value: '' };
  const calls = [];
  const sandbox = {
    console,
    document: {
      getElementById: (id) => (id === 'attCourseBookSelect' ? select : (id === 'attAdditionalLesson' ? additionalLesson : null)),
    },
    getTeacherAllBooks: () => BOOKS.slice(),
    // Faithful stubs of the real modules' relevant surface.
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
        if (!name && student.course_id && typeof student.course_id === 'string') name = student.course_id;
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
    onTeacherCourseBookChanged: (v) => { calls.push(v); },
  };
  const code = [
    extractDecl(TEACHER_HTML, 'ADDITIONAL_COURSE_ID'),
    extractDecl(TEACHER_HTML, '_attCourseStudentCtx'),
    extractFunction(TEACHER_HTML, '_resolveCatalogueCourse'),
    extractFunction(TEACHER_HTML, '_courseBookFamily'),
    extractFunction(TEACHER_HTML, '_booksForCourseFamily'),
    extractFunction(TEACHER_HTML, '_resolveStudentCourseBooks'),
    extractFunction(TEACHER_HTML, 'getStudentCourseBooks'),
    extractFunction(TEACHER_HTML, 'populateTeacherCourseBooks'),
  ].join('\n');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const run = (expr) => vm.runInContext(expr, sandbox);
  // Students/matchedClass are passed through the sandbox global to keep
  // the vm expressions simple.
  const populate = (defaultBookId, student, matchedClass) => {
    sandbox.__def = defaultBookId;
    sandbox.__stu = student;
    sandbox.__cls = matchedClass;
    run(`populateTeacherCourseBooks(__def, (__stu === undefined && __cls === undefined) ? undefined : { student: __stu, matchedClass: __cls })`);
  };
  const populateNoArgs = () => run('populateTeacherCourseBooks()');
  const helper = (student, matchedClass) => {
    sandbox.__stu = student; sandbox.__cls = matchedClass;
    return run('getStudentCourseBooks(__stu, __cls)').map(b => b.id);
  };
  return { select, calls, additionalLesson, populate, populateNoArgs, helper };
}
const optVals = (env) => env.select.options.map(o => o.value);

// ---- 1) single course -----------------------------------------------------
{
  const env = makeEnv();
  env.populate(null, stu('Noorani Qaida'), null);
  check('single course: only qaida books + Additional Course',
    JSON.stringify(optVals(env)) === JSON.stringify(['custom-qaida-eng', 'noorani-qaida-classic', 'additional-course']),
    optVals(env).join(','));
  check('single course: first qaida book preselected',
    env.select.value === 'custom-qaida-eng' && env.calls[env.calls.length - 1] === 'custom-qaida-eng',
    'value=' + env.select.value);
}

// ---- 2) legacy combined course string -------------------------------------
{
  const env = makeEnv();
  env.populate(null, stu('Noorani Qaida / Quran Reading'), null);
  check('combined legacy string: qaida + quran books only (incl. category-less book via title match)',
    JSON.stringify(optVals(env)) === JSON.stringify(['custom-qaida-eng', 'noorani-qaida-classic', 'holy-quran-16-line', 'custom-nazra-nocat', 'additional-course']),
    optVals(env).join(','));
  check('combined: no tafseer/islamic/arabic/essentials leakage',
    !optVals(env).some(v => ['custom-tafseer-en', 'custom-tafseer-ur', 'custom-islamic-1', 'custom-arabic-1', 'custom-essentials'].includes(v)));
}

// ---- 3) catalogue id stored as the course ---------------------------------
{
  const env = makeEnv();
  env.populate(null, stu('crs-tafseer-english'), null);
  check('catalogue id course: tafseer books only, English-language book first',
    JSON.stringify(optVals(env)) === JSON.stringify(['custom-tafseer-en', 'custom-tafseer-ur', 'additional-course']),
    optVals(env).join(','));
  check('catalogue id course: English tafseer preselected', env.select.value === 'custom-tafseer-en', 'value=' + env.select.value);
}

// ---- 4) the ended class's own course wins the preselect --------------------
{
  const env = makeEnv();
  const student = stu('Islamic Studies');
  const matchedClass = { id: 'SCH-1', student_id: 'STU-1', course_name: 'Quran Reading' };
  check('helper: class course first, student course still listed',
    JSON.stringify(env.helper(student, matchedClass)) === JSON.stringify(['holy-quran-16-line', 'custom-nazra-nocat', 'custom-islamic-1']),
    env.helper(student, matchedClass).join(','));
  env.populate(null, student, matchedClass);
  check('class priority: quran book preselected over the student-course book',
    env.select.value === 'holy-quran-16-line', 'value=' + env.select.value);
  check('class priority: islamic book remains in the dropdown',
    optVals(env).includes('custom-islamic-1'));
}

// ---- 5) Smart Resume inside the student's list -----------------------------
{
  const env = makeEnv();
  env.populate('holy-quran-16-line', stu('Noorani Qaida / Quran Reading'), null);
  check('smart resume: previous book in the list is preselected',
    env.select.value === 'holy-quran-16-line', 'value=' + env.select.value);
}

// ---- 6) removed course + stale resume book --------------------------------
{
  const env = makeEnv();
  // The student once had Noorani Qaida; the admin removed it — the
  // record now holds only Quran Reading, and the previous lesson's
  // book (a qaida book) must NOT come back.
  env.populate('noorani-qaida-classic', stu('Quran Reading'), null);
  check('removed course: no qaida books appear anymore',
    !optVals(env).some(v => v === 'custom-qaida-eng' || v === 'new-noorani' || v === 'noorani-qaida-classic'),
    optVals(env).join(','));
  check('stale resume book NOT selected; first assigned book selected instead',
    env.select.value === 'holy-quran-16-line', 'value=' + env.select.value);
}

// ---- 7) no course assigned --------------------------------------------------
{
  const env = makeEnv();
  env.populate(null, stu(''), null);
  const opts = env.select.options;
  check('no course: first option is the disabled placeholder with the exact message',
    opts.length === 2 && opts[0].value === '' && opts[0].disabled === true &&
    opts[0].label === 'No course assigned to this student — ask the admin to assign a course',
    JSON.stringify(opts));
  check('no course: Additional Course present and selected (free-text path opens)',
    opts[1].value === 'additional-course' && env.select.value === 'additional-course' &&
    env.calls[env.calls.length - 1] === 'additional-course',
    'value=' + env.select.value);
  check('no course: a save can never write the placeholder (select value is the sentinel, never "")',
    env.select.value !== '');
}

// ---- 8) two students back-to-back + refresh re-applies the SAME student ----
{
  const env = makeEnv();
  env.populate(null, stu('crs-tafseer-english', 'STU-A'), null);
  check('student A: tafseer list shown', optVals(env).includes('custom-tafseer-en'));
  env.populate(null, stu('Noorani Qaida', 'STU-B'), null);
  check('student B: none of A\u2019s exclusive books leak into B\u2019s form',
    !optVals(env).some(v => v === 'custom-tafseer-en' || v === 'custom-tafseer-ur') && optVals(env).includes('custom-qaida-eng'),
    optVals(env).join(','));
  env.populateNoArgs();
  check('books refresh (no args) re-applies the SAME (B) student list from the stash',
    JSON.stringify(optVals(env)) === JSON.stringify(['custom-qaida-eng', 'noorani-qaida-classic', 'additional-course']),
    optVals(env).join(','));
}

// ---- 9) no context ever: global behaviour preserved -------------------------
{
  const env = makeEnv();
  env.populate('holy-quran-16-line', undefined, undefined);
  check('no context: dropdown is the full global list + Additional Course',
    optVals(env).length === BOOKS.length + 1 && optVals(env)[optVals(env).length - 1] === 'additional-course',
    optVals(env).join(','));
  check('no context: requested default selected as before', env.select.value === 'holy-quran-16-line', 'value=' + env.select.value);
}

// ---- 10) helper edge cases ---------------------------------------------------
{
  const env = makeEnv();
  check('helper: null student -> no books', JSON.stringify(env.helper(null, null)) === '[]');
  check('helper: course matching no book contributes nothing (no fake options)',
    JSON.stringify(env.helper(stu('Arabic'), null)) === JSON.stringify(['custom-arabic-1']),
    env.helper(stu('Arabic'), null).join(','));
}

// ---- 11) structural wiring ----------------------------------------------------
check('open flow passes the student context to populate',
  TEACHER_HTML.includes('populateTeacherCourseBooks(suggestedBook, { student: _attCtxStudent, matchedClass: _attCtxClass })'));
check('open flow runs the change handler for the ACTUALLY selected book',
  TEACHER_HTML.includes("onTeacherCourseBookChanged(document.getElementById('attCourseBookSelect')?.value || suggestedBook, resumePara, nextPage)"));
check('full student record resolution uses the portal student lists with the class join as fallback',
  TEACHER_HTML.includes('ASSIGNED_STUDENTS') && TEACHER_HTML.includes('_attCtxClass.students'));
check('attAdditionalLesson input untouched in markup (supplementary lessons preserved)',
  TEACHER_HTML.includes('id="attAdditionalLesson"'));
check('advance modal keeps its own book select + inline populate in openAdvanceClassModal (untouched)',
  TEACHER_HTML.includes('id="advCourseBookSelect"') && TEACHER_HTML.includes('function openAdvanceClassModal'));
check('populate signature carries the optional student context',
  /function populateTeacherCourseBooks\(defaultBookId = null, studentCtx\)/.test(TEACHER_HTML));

const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
