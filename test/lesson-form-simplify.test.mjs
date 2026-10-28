// Lesson-form simplify (Batch A, 2026-10-29 commission Part 1) tests.
// The teacher lesson form is now minimal, in this exact order:
//   (1) Course selection (catalogue OR Additional Course)
//   (2) Page selection directly below (authoritative pages for standard
//       courses; an optional free-text reference for Additional Course)
//   (3) ONE "Additional Lesson / Description" box, shared by both paths
//   (4) ONE compact remarks area: five predefined remarks as chips
//       (NOT a dropdown), free text still allowed.
// Additional Course: custom course name (required) + optional reference +
// shared description. The old separate "Lesson Name" input is gone: the
// shared description is stored as lesson_name for Additional Course and
// as additional_lesson for standard courses, so history shows it once.
// The removed Lines/Assessment/Rating controls survive as hidden inputs
// (same ids, same defaults) so old records round-trip on edit and the
// existing save/reopen code works unchanged.
// Run from the repo root:  node test/lesson-form-simplify.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHER_HTML = read('teacher.html');
const PARENT_HTML = read('parent.html');
const LH_SRC = read('js/lesson-history.js');
const PROFILES360_SRC = read('js/profiles360.js');
const WORKER_SRC = read('cloudflare/worker.js');
const GUARD_SRC = read('test/batch7b-headers-health-guard.test.mjs');

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

// ---- A) structural: the minimal form in both modals ----
const REMARKS = ['MashaAllah', 'Very Good', 'Not Bad', 'Not Too Good', 'Very Bad'];
for (const prefix of ['att', 'adv']) {
  for (const r of REMARKS) {
    check(`${prefix}: remark chip "${r}" exists`,
      TEACHER_HTML.includes(`data-remark="${r}"`));
  }
  check(`${prefix}: remarks are chips, not a select (no remarks dropdown id)`,
    !TEACHER_HTML.includes(`id="${prefix}RemarkSelect"`) &&
    !TEACHER_HTML.includes(`id="${prefix}SabaqRemark"`));
  check(`${prefix}: remarks input is a single-line input, not a textarea`,
    new RegExp(`<input type="text" id="${prefix}LessonNotes"`).test(TEACHER_HTML));
  check(`${prefix}: custom container has course-name + reference inputs`,
    TEACHER_HTML.includes(`id="${prefix}AdditionalCourseName"`) &&
    TEACHER_HTML.includes(`id="${prefix}AdditionalCourseReference"`));
  check(`${prefix}: description input exists with the shared label nearby`,
    TEACHER_HTML.includes(`id="${prefix}AdditionalLesson"`));
  check(`${prefix}: lines/assessment/rating kept as hidden inputs (old values round-trip)`,
    TEACHER_HTML.includes(`<input type="hidden" id="${prefix}LineRange"`) &&
    TEACHER_HTML.includes(`<input type="hidden" id="${prefix}SabaqResult" value="Pass"`) &&
    TEACHER_HTML.includes(`<input type="hidden" id="${prefix}SabaqRating" value="5"`));
}
check('no separate Lesson Name input remains anywhere',
  !TEACHER_HTML.includes('AdditionalLessonName'));
check('shared description label used in both forms',
  (TEACHER_HTML.match(/Additional Lesson \/ Description/g) || []).length >= 2);
check('no visible Lines/Assessment/Rating labels remain',
  !TEACHER_HTML.includes('Lines / Verses (Optional)') &&
  !TEACHER_HTML.includes('Lesson Assessment:') &&
  !TEACHER_HTML.includes('Recitation Quality:'));
check('vacation promo box removed from the attendance modal',
  !TEACHER_HTML.includes('triggerLeaveRequestFromAttendanceModal'));

// Field order: course select < page select < description input < remarks chips.
// Checked inside each modal's region (att modal precedes adv modal in the file).
{
  const attCourse = TEACHER_HTML.indexOf('id="attCourseBookSelect"');
  const attPage = TEACHER_HTML.indexOf('id="attCoursePageSelect"');
  const attDesc = TEACHER_HTML.indexOf('id="attAdditionalLesson"');
  const attChips = TEACHER_HTML.indexOf('id="attRemarkChips"');
  check('att order: course < page < description < remarks chips',
    attCourse > 0 && attCourse < attPage && attPage < attDesc && attDesc < attChips);
  const advCourse = TEACHER_HTML.indexOf('id="advCourseBookSelect"');
  const advPage = TEACHER_HTML.indexOf('id="advCoursePageSelect"');
  const advDesc = TEACHER_HTML.indexOf('id="advAdditionalLesson"');
  const advChips = TEACHER_HTML.indexOf('id="advRemarkChips"');
  check('adv order: course < page < description < remarks chips',
    advCourse > 0 && advCourse < advPage && advPage < advDesc && advDesc < advChips);
}

// ---- B) behavioural: toggle + chips (REAL functions, stub DOM) ----
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
function makeToggleDoc(prefix) {
  const els = {};
  const pageCell = { style: {} };
  const ids = [prefix + 'CoursePageSelect', prefix + 'QuranParaContainer',
    prefix + 'TafseerLanguageContainer', prefix + 'AdditionalCourseContainer',
    prefix + 'AdditionalCourseName', prefix + 'AdditionalCourseReference'];
  ids.forEach(id => { els[id] = stubEl(); });
  els[prefix + 'CoursePageSelect'].closest = () => ({ parentElement: pageCell });
  els[prefix + 'AdditionalCourseContainer'].classList.add('hidden');
  return { els, pageCell, getElementById: (id) => els[id] || null };
}
for (const prefix of ['att', 'adv']) {
  const doc = makeToggleDoc(prefix);
  const sandbox = { console, document: doc };
  const code = `const ADDITIONAL_COURSE_ID = 'additional-course';\n`
    + extractFunction(TEACHER_HTML, 'setAdditionalCourseMode');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  vm.runInContext(`setAdditionalCourseMode('${prefix}', true)`, sandbox);
  check(`${prefix} toggle: additional shows custom container + hides page cell`,
    !doc.els[prefix + 'AdditionalCourseContainer'].classList.contains('hidden') &&
    doc.pageCell.style.display === 'none');
  doc.els[prefix + 'AdditionalCourseName'].value = 'Stale';
  doc.els[prefix + 'AdditionalCourseReference'].value = 'Stale Ref';
  vm.runInContext(`setAdditionalCourseMode('${prefix}', false)`, sandbox);
  check(`${prefix} toggle: catalogue hides container, clears name + reference, restores page cell`,
    doc.els[prefix + 'AdditionalCourseContainer'].classList.contains('hidden') &&
    doc.els[prefix + 'AdditionalCourseName'].value === '' &&
    doc.els[prefix + 'AdditionalCourseReference'].value === '' &&
    doc.pageCell.style.display === '');
}
{
  // Chip behaviour: tapping a chip fills the remarks input and marks it
  // active; typing custom text clears the active chip.
  const btns = REMARKS.map(r => {
    const b = stubEl();
    b.getAttribute = (a) => (a === 'data-remark' ? r : null);
    return b;
  });
  const inp = stubEl();
  const box = { querySelectorAll: () => btns };
  const doc = { getElementById: (id) => (id === 'attLessonNotes' ? inp : id === 'attRemarkChips' ? box : null) };
  const sandbox = { console, document: doc };
  const code = `const LESSON_REMARK_CHIPS = ['MashaAllah', 'Very Good', 'Not Bad', 'Not Too Good', 'Very Bad'];\n`
    + extractFunction(TEACHER_HTML, 'syncRemarkChips') + '\n'
    + extractFunction(TEACHER_HTML, 'selectRemarkChip');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  vm.runInContext(`selectRemarkChip('att', 'Very Good')`, sandbox);
  check('chip tap: remarks input filled with the chip text', inp.value === 'Very Good');
  check('chip tap: matching chip active, others inactive',
    btns[1].classList.contains('bg-emerald-600') && btns[1].classList.contains('text-white') &&
    !btns[0].classList.contains('bg-emerald-600'));
  inp.value = 'Custom free-text remark';
  vm.runInContext(`syncRemarkChips('att')`, sandbox);
  check('custom text: no chip stays active', !btns.some(b => b.classList.contains('bg-emerald-600')));
}

// ---- C) standard courses keep authoritative pages (REAL builder) ----
{
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(TEACHER_HTML, 'buildLessonPageOptions'), sandbox);
  const withChaptersTotal = vm.runInContext(
    `buildLessonPageOptions({ chapters: [{ page_start: 1, title: 'A' }, { page_start: 9, title: 'B' }], total_pages: 20 })`, sandbox);
  check('page options: total_pages beats chapter maxStart (numeric 1..20)',
    (withChaptersTotal.match(/<option/g) || []).length === 20);
  const withChaptersOnly = vm.runInContext(
    `buildLessonPageOptions({ chapters: [{ page_start: 1, title: 'A' }, { page_start: 9, title: 'B' }], total_pages: 5 })`, sandbox);
  check('page options: chapter options kept when total_pages does not exceed maxStart',
    withChaptersOnly.includes('Page 1') && withChaptersOnly.includes('Page 9'));
  const noChapters = vm.runInContext(
    `buildLessonPageOptions({ total_pages: 7 })`, sandbox);
  check('page options: chapter-less book uses total_pages',
    (noChapters.match(/<option/g) || []).length === 7);
}

// ---- D) shared history reader: new record + old shapes ----
{
  const sandbox = { console, URL, FormData, fetch: async () => { throw new Error('no fetch in unit tests'); } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LH_SRC + '\nthis.__LH = LessonHistory;', sandbox);
  const LH = sandbox.__LH;
  const fresh = LH.normalizeLessonRow({
    id: 'L9', schedule_id: 'SC9', student_id: 'ST9', teacher_id: 'T9',
    date: '2026-10-29', status: 'Completed', created_at: '2026-10-29T10:00:00Z',
    lesson_notes: JSON.stringify({
      book_id: 'additional-course', book_title: 'Arabic Grammar Basics',
      content_type: 'additional', lesson_name: 'Past Tense Verbs',
      page_reference: 'Lesson 5', page: null, para: null, language: null,
      remarks: 'Very Good', additional_lesson: null,
    }),
  }, 'Teacher A');
  check('reader: new additional record parses page_reference', fresh.pageReference === 'Lesson 5');
  check('reader: new additional record title is course — description',
    LH.entryTitle(fresh) === 'Arabic Grammar Basics — Past Tense Verbs');
  check('reader: new additional record has no page, no double description',
    fresh.page === null && fresh.additionalLesson === null);
  const old = LH.normalizeLessonRow({
    id: 'L8', date: '2026-10-20', status: 'Completed',
    lesson_notes: JSON.stringify({
      book_id: 'additional-course', book_title: 'Arabic Grammar Basics',
      lesson_name: 'Lesson 5: Past Tense Verbs', additional_lesson: 'Morning Duas',
      page: null,
    }),
  }, null);
  check('reader: OLD additional shape (lesson_name + additional_lesson) still parses',
    old.lessonName === 'Lesson 5: Past Tense Verbs' && old.additionalLesson === 'Morning Duas' &&
    old.pageReference === null);
  const plain = LH.parseLessonNotes('Just a plain old note');
  check('reader: legacy plain-text notes still parse, pageReference null',
    plain && plain.remarks === 'Just a plain old note' && plain.pageReference === null);
}

// ---- E) 360 parser + displays carry the reference ----
{
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(PROFILES360_SRC, '_parseLessonDetails360'), sandbox);
  const withRef = vm.runInContext(`_parseLessonDetails360({ lesson_notes: JSON.stringify({ book_id: 'additional-course', book_title: 'Arabic Grammar Basics', lesson_name: 'Past Tense Verbs', page: null, page_reference: 'Lesson 5' }) })`, sandbox);
  check('360 parser: reference appended to title, no Page suffix',
    withRef.summaryTitle === 'Arabic Grammar Basics — Past Tense Verbs • Ref: Lesson 5');
  const withoutRef = vm.runInContext(`_parseLessonDetails360({ lesson_notes: JSON.stringify({ book_id: 'additional-course', book_title: 'Arabic Grammar Basics', lesson_name: 'Past Tense Verbs', page: null }) })`, sandbox);
  check('360 parser: old record without reference keeps the exact old title',
    withoutRef.summaryTitle === 'Arabic Grammar Basics — Past Tense Verbs');
  check('teacher today-card shows the reference for additional courses',
    TEACHER_HTML.includes('pMeta.page_reference'));
  check('teacher history card shows the reference',
    TEACHER_HTML.includes('e.pageReference'));
  check('parent history shows the reference',
    PARENT_HTML.includes('page_reference'));
}

// ---- F) save/reopen paths reference the new fields (structural) ----
check('att save: sentinel stores page_reference + lesson_name from the shared description',
  extractFunction(TEACHER_HTML, 'saveAttendanceAndLessonNotes').includes('page_reference: customReference')
  && extractFunction(TEACHER_HTML, 'saveAttendanceAndLessonNotes').includes('lesson_name: additionalLesson'));
check('att save: only the course name is required for Additional Course',
  extractFunction(TEACHER_HTML, 'saveAttendanceAndLessonNotes').includes('Please enter the additional course name.'));
check('att reopen: restores reference + description from lesson_name with fallback',
  TEACHER_HTML.includes("parsedNotes.page_reference") &&
  TEACHER_HTML.includes("parsedNotes?.lesson_name || parsedNotes?.additional_lesson"));
check('att reopen: chip state synced after restore',
  TEACHER_HTML.includes("syncRemarkChips('att')"));
check('adv save: sentinel stores page_reference + lesson_name from the shared description',
  extractFunction(TEACHER_HTML, 'handleAdvanceClassSubmit').includes('page_reference: isAdditionalCourse')
  && extractFunction(TEACHER_HTML, 'handleAdvanceClassSubmit').includes('lesson_name: isAdditionalCourse ? (advAdditionalLesson'));
check('adv save: only the course name is required for Additional Course',
  extractFunction(TEACHER_HTML, 'handleAdvanceClassSubmit').includes('Please enter the additional course name.'));

// ---- G) release untouched ----
check('WORKER_RELEASE untouched (2026-10-29-phase3)',
  WORKER_SRC.includes("const WORKER_RELEASE = '2026-10-29-phase3'"));
check('batch7b guard constant still pins the same release',
  GUARD_SRC.includes("const WORKER_RELEASE = '2026-10-29-phase3'"));

const failed = results.filter(r => !r.pass);
console.log(`---\nlesson-form-simplify: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
