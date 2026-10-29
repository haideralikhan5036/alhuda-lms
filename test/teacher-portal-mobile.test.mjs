// Teacher portal mobile-first redesign (Batch C2) tests.
// Scope: teacher.html only — no backend, no Worker, no data changes.
// The layer preserves the theme (same brand palette, fonts, Tailwind
// components) and every workflow; it adapts layout, touch targets,
// and type hierarchy for phones. Wide tables other than the two card
// tables keep their contained horizontal scroll by design.
// Run from the repo root:  node test/teacher-portal-mobile.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHER = read('teacher.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- A) viewport + layer presence ----
check('viewport resizes for the on-screen keyboard',
  TEACHER.includes('interactive-widget=resizes-content'));
check('mobile-first layer block exists',
  TEACHER.includes('Batch C2: teacher-portal mobile-first layer'));
check('theme preserved: brand palette still configured',
  TEACHER.includes("brandDark: '#064e3b'") && TEACHER.includes("brandEmerald: '#059669'") && TEACHER.includes("brandGold: '#C5A880'"));
check('theme preserved: same font families',
  TEACHER.includes('Inter') && TEACHER.includes('Plus Jakarta Sans'));

// ---- B) touch targets, forms, focus ----
const LAYER = TEACHER.slice(TEACHER.indexOf('Batch C2: teacher-portal mobile-first layer'));
check('sidebar nav rows are 44px on phones',
  LAYER.includes('#teacherSidebar .sidebar-nav-btn { min-height: 44px;'));
check('sidebar never wider than the phone',
  LAYER.includes('#teacherSidebar { max-width: 86vw; }'));
check('form controls use 16px text on phones (no iOS focus-zoom)',
  LAYER.includes('font-size: 16px;') && LAYER.includes('min-height: 44px;'));
check('portal buttons are 44px tall on phones',
  LAYER.includes('#teacherMainContainer button, div.fixed[id^="modal"] button { min-height: 44px; }'));
check('modal icon buttons (incl. close) are 44px wide on phones',
  LAYER.includes('button[aria-label] { min-width: 44px; }'));
check('visible keyboard focus ring in brand emerald',
  LAYER.includes(':focus-visible') && LAYER.includes('outline: 2px solid #059669;'));

// ---- C) type hierarchy (bold only where it matters) ----
check('form labels step down from bold to medium',
  LAYER.includes('label.font-bold') && LAYER.includes('font-weight: 500;'));
check('supporting paragraphs step down to regular',
  LAYER.includes('p.text-slate-500') && LAYER.includes('font-weight: 400;'));
check('headings/amounts keep strong weights (no global de-bold)',
  !LAYER.includes('* { font-weight') && !LAYER.includes('font-black { font-weight'));

// ---- D) tables -> cards for the two primary tables ----
check("Today's Classes table wrapper is a card table",
  TEACHER.includes('overflow-x-auto touch-scroll tcard') && TEACHER.includes('min-w-[700px]'));
check('Student List table wrapper is a card table',
  TEACHER.includes('overflow-x-auto touch-scroll tcard') && TEACHER.includes('min-w-[680px]'));
for (const label of ['Time', 'Student', 'Course', 'Lesson', 'Attendance']) {
  check(`classes row carries data-label="${label}"`, TEACHER.includes(`data-label="${label}"`));
}
for (const label of ['#', 'Student', 'Course', 'Schedule', 'Status']) {
  check(`student row carries data-label="${label}"`, TEACHER.includes(`data-label="${label}"`));
}
check('card CSS hides thead and labels cells from data-label',
  LAYER.includes('.tcard thead { display: none; }') && LAYER.includes('content: attr(data-label)'));
check('card CSS keeps other tables scrolling (no global table rewrite)',
  !LAYER.includes('table { display: block') && LAYER.includes('.tcard table { min-width: 0; display: block;'));
check('card cells do not clip lesson text',
  LAYER.includes('.tcard td .truncate') && LAYER.includes('white-space: normal;'));

// ---- E) workflows intact: row actions + handlers still referenced ----
check('student row actions intact (schedule, history)',
  TEACHER.includes("openTeacherAddScheduleModal('${escapeJsAttr(st.id)}')") &&
  TEACHER.includes("openTeacherLessonHistoryForStudent('${escapeJsAttr(st.id)}')"));
check('class row actions intact (actionButtons placeholder kept)',
  TEACHER.includes('${actionButtons}'));
check('salary advance form still wired (C1 note element kept)',
  TEACHER.includes('id="tAdvPeriodNote"') && TEACHER.includes('periodOptionsForSlips'));
check('no mock data introduced by the layer',
  !LAYER.includes('Test Student') && !LAYER.includes('John Doe'));

// ---- F) dialogs fit phones ----
check('dialog panels use full phone width and dvh height',
  LAYER.includes('div.fixed[id^="modal"] > div { width: 100%; max-height: 92dvh; }'));

// ---- G) CSS braces balance in the layer ----
{
  const css = LAYER.slice(0, LAYER.indexOf('</style>'));
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  check('mobile layer CSS braces balance', open > 0 && open === close, `open=${open} close=${close}`);
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
