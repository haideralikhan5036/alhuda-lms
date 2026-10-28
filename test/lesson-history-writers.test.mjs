// Unified Lesson History — writer + portal wiring tests (structural
// assertions over the REAL source files, plus reader-module guard rails).
// Run from the repo root:  node test/lesson-history-writers.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHER_HTML = read('teacher.html');
const PARENT_HTML = read('parent.html');
const P360 = read('js/profiles360.js');
const LH = read('js/lesson-history.js');
const WORKER = read('cloudflare/worker.js');

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

const modalSave = extractFunction(TEACHER_HTML, 'saveAttendanceAndLessonNotes');
const advSave = extractFunction(TEACHER_HTML, 'handleAdvanceClassSubmit');
const openModal = extractFunction(TEACHER_HTML, 'openAttendanceModal');
const cards = extractFunction(PARENT_HTML, 'renderRecentSabaqLogs');
const attTable = extractFunction(PARENT_HTML, 'renderAttendanceTable');
const heroReader = extractFunction(PARENT_HTML, 'openLatestSabaqReader');
const form360 = extractFunction(P360, 'submitRecordDailyLessonForm');

// --- 1. PKT date on both teacher save paths ------------------------------
check('modal save stamps PKT date', /getPktNowParts\(\)\.date/.test(modalSave));
check('modal save has no UTC-date stamp', !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(modalSave));
check('advance save stamps PKT date', /getPktNowParts\(\)\.date/.test(advSave));
check('advance save has no UTC-date stamp', !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(advSave));

// --- 2. additional_lesson: ONE key, both saves, never lesson_name -------
check('modal save writes additional_lesson', /additional_lesson:/.test(modalSave));
check('advance save writes additional_lesson', /additional_lesson:/.test(advSave));
check('no second additional-lesson key invented', !/additionalLesson:/.test(modalSave) && !/additionalLesson:/.test(advSave));
// Lesson-form simplify (Batch A) deliberately changed this: the old
// separate "Lesson Name" input is gone, so the modal save now stores the
// shared description box as lesson_name for Additional Course
// (lesson_name: additionalLesson) instead of a dedicated customLesson
// variable. The key itself is untouched — only its source changed.
check('Additional Course lesson_name now comes from the shared description box',
  /lesson_name: additionalLesson/.test(modalSave));

// --- 3. Image: inputs, carry-through, loud failure ------------------------
// Lesson-form simplify (Batch A) deliberately removed the file inputs
// from the minimal lesson form (new uploads are not offered there); the
// hidden key inputs are kept so an image on an OLD record survives an
// edit/re-save, and history views keep rendering it via image_key. The
// save-side upload blocks remain (guarded) but are unreachable without
// a file input.
check('modal keeps hidden image key, file input removed', !TEACHER_HTML.includes('id="attLessonImageFile"') && TEACHER_HTML.includes('id="attLessonImageKey"'));
check('advance form keeps hidden image key, file input removed', !TEACHER_HTML.includes('id="advLessonImageFile"') && TEACHER_HTML.includes('id="advLessonImageKey"'));
check('modal save writes image_key', /image_key:/.test(modalSave));
check('advance save writes image_key', /image_key:/.test(advSave));
check('modal save uploads before save via loud-fail helper', /uploadLessonImageOrThrow/.test(modalSave));
check('advance save uploads before save via loud-fail helper', /uploadLessonImageOrThrow/.test(advSave));
check('restore refills additional lesson + image key', openModal.includes('attAdditionalLesson') && openModal.includes('attLessonImageKey'));
check('status change preserves prior JSON', modalSave.includes('_ATT_PRIOR_NOTES') && modalSave.includes('preserved'));
check('reader module upload never falls back to dataUrl', /uploadLessonImageOrThrow/.test(LH) && !/readAsDataURL/.test(LH) && /throw new Error\('Lesson image upload failed'/.test(LH));

// --- 4. 360-form writer fix ------------------------------------------------
check('360 form has Additional Lesson input', P360.includes('id="fwLessonAdditional"'));
check('360 form sets teacher_id', /teacher_id/.test(form360) && form360.includes('upsertRow.teacher_id'));
check('360 form sets schedule_id when known', form360.includes('upsertRow.schedule_id'));
check('360 form writes additional_lesson', /additional_lesson/.test(form360));
check('360 fetch uses per-student caps, not family-wide 120', P360.includes('.limit(500)') && !P360.includes('.limit(120)'));
check('360 history has date selector wiring', P360.includes('set360LessonHistoryDate') && P360.includes('lessonHistoryDate'));
check('360 inspector renders full entries incl. image + duration', P360.includes('data-lh-img-key') && P360.includes('formatActualDuration'));

// --- 5. Teacher history view ----------------------------------------------
check('teacher history section + nav exist', TEACHER_HTML.includes('sectionTeacherLessonHistory') && TEACHER_HTML.includes('sbNavHistory'));
check('teacher history uses shared reader', TEACHER_HTML.includes('renderTeacherLessonHistory') && TEACHER_HTML.includes('LessonHistory.dedupeLessonRows'));
check('teacher history has date input + full-history reset', TEACHER_HTML.includes('lhTeacherDateInput') && TEACHER_HTML.includes('Show full history'));

// --- 6. Parent: date selector, no fake fallbacks ---------------------------
check('parent has per-child date selector', PARENT_HTML.includes('id="parentLessonDateInput"') && PARENT_HTML.includes('setParentLessonDate'));
check('parent cards: no Page-1 fallback', !/Page \$\{Number\(pageNum\) \|\| 1\}/.test(cards));
check('parent cards: no first-book fallback', !/book_id \|\| 'noorani-qaida'/.test(cards));
check('parent cards: show additional lesson + duration + image', cards.includes('additionalLesson') && cards.includes('formatActualDuration') && cards.includes('data-lh-img-key'));
check('parent table: no Page-1 fallback', !/Page \$\{Number\(meta\.page\) \|\| 1\}/.test(attTable));
check('parent table: no first-book fallback', !/book_id \|\| 'holy-quran-16-line'/.test(attTable));
check('parent hero reader: no record fallback', !/book_id \|\| 'holy-quran-16-line'/.test(heroReader) && !/page \|\| 1/.test(heroReader));

// --- 7. Worker UNION scope present (behavior covered by worker suite) -----
check('worker: teacher attendance_logs select uses OR scope', /op: 'or', value: \[eq\('teacher_id', sub\), inList\('student_id', assigned\)\]/.test(WORKER));
check('worker: rowInScope mirrors UNION', WORKER.includes("case 'attendance_logs':") && /row\.teacher_id\) === sub \|\| scope\.studentIds\.includes\(String\(row\.student_id\)\)/.test(WORKER));
check('worker: lesson-image storage allowance exists', WORKER.includes('isLessonImageKeyReadable'));

const failed = results.filter((r) => !r.pass).length;
console.log(`\nlesson-history-writers: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
