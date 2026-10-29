// Book reader paper redesign (owner directive 2026-10-29) — the dark
// "computerized" reader becomes a warm, natural book preview in all
// three portals: paper-white container, warm desk stage, light calm
// toolbars, the page presented as a real sheet with a soft warm
// shadow. All ids, handlers and reader logic are unchanged. The same
// change teaches the page loaders to report the HTTP status, so an
// expired 8-hour session says "Session expired. Please log in again."
// instead of looking like a broken book page.
// Run from the repo root:  node test/reader-paper-redesign.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const INDEX = read('index.html');
const TEACHER = read('teacher.html');
const PARENT = read('parent.html');
const CURR = read('js/curriculum.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}
function readerSeg(html, marker) {
  const a = html.indexOf(marker);
  const b = html.indexOf('\n  <!--', a + 2000);
  return html.slice(a, b);
}
const TSEG = readerSeg(TEACHER, '<div id="modalDigitalBookReader"');
const ISEG = readerSeg(INDEX, '<div id="modalDigitalBookReader"');
const PSEG = readerSeg(PARENT, '<div id="modalParentBookReader"');

for (const [label, seg] of [['teacher', TSEG], ['admin', ISEG], ['parent', PSEG]]) {
  check(label + ': paper-white reader container', seg.includes('bg-[#faf6ee]'));
  check(label + ': warm desk stage', seg.includes('bg-[#eae1cf]'));
  check(label + ': dark reader shell is gone', !seg.includes('bg-[#18181b]') && !seg.includes('bg-[#09090b]'));
  check(label + ': soft warm backdrop', seg.includes('bg-stone-900/60'));
  check(label + ': warm paper page shadow', seg.includes('rgba(74,60,35,0.35)'));
}
check('teacher: annotation toolbar is light too', TSEG.includes('id="readerAnnotationToolbar" class="hidden bg-[#fffdf9]'));
check('teacher: Annotate is a solid emerald action', TSEG.includes('bg-emerald-600 hover:bg-emerald-500 text-white'));
check('admin/teacher: dark-select CSS no longer targets the reader',
  !INDEX.includes('#modalDigitalBookReader select') && !TEACHER.includes('#modalDigitalBookReader select'));
check('reader structure preserved (teacher ids + handlers)',
  TSEG.includes('id="readerPageImg"') && TSEG.includes('id="readerPageSlider"') && TSEG.includes('onclick="changeReaderPage(-1)"') && TSEG.includes('id="readerAnnotationCanvas"'));
check('reader structure preserved (parent ids + handlers)',
  PSEG.includes('id="parentReaderPageImg"') && PSEG.includes('onclick="parentReaderTurnLeft()"'));
check('interactive e-Qaida stage untouched (still its own dark lab)',
  TSEG.includes('bg-slate-950/95'));

for (const [label, src] of [['teacher loader', TEACHER], ['admin loader', CURR], ['parent loader', PARENT]]) {
  check(label + ': fetch failure carries the HTTP status', src.includes('err.status = res.status') && src.includes('onFetchError(err && err.status)'));
  check(label + ': 401 shows the session-expired message', src.includes("if (status === 401)") && src.includes("'Session expired. Please log in again.'"));
}
for (const [label, src] of [['teacher', TEACHER], ['admin', CURR], ['parent', PARENT]]) {
  check(label + ': non-401 fetch failures name the HTTP status in the error',
    src.includes("'Could not load this page. (HTTP ' + status + ')'"));
}
check('honest load errors preserved (no fabricated pages)',
  TEACHER.includes("'Could not load this page.'") && PARENT.includes("'Could not load this page.'") && CURR.includes("'Could not load this page.'"));

// Course Materials Library picker (teacher) — same paper theme
// (owner follow-up 2026-10-29: 'ye wala preview bhi theek karo,
// same as the previous one').
const libStart = TEACHER.indexOf('id="modalTeacherLibraryPicker"');
const LIB = TEACHER.slice(libStart, TEACHER.indexOf('id="teacherLibraryGrid"'));
check('library picker: paper container + white header/footer',
  LIB.includes('bg-[#faf6ee]') && LIB.includes('Official Course Materials Library'));
check('library picker: dark shell gone', !LIB.includes('bg-slate-900') && !LIB.includes('bg-slate-950'));
check('library cards are clean white book cards',
  TEACHER.includes('bg-white border border-stone-200 hover:border-emerald-500 rounded-2xl p-0 overflow-hidden'));
check('library filter toggle uses the light palette too',
  TEACHER.includes("bg-white text-stone-600 border border-stone-200 hover:bg-stone-100 transition whitespace-nowrap flex-shrink-0';"));


// ---- Session-token recovery + Annotate restyle (2026-10-29 evening) ----
const DB = read('js/cloudflare-db.js');
function fnSeg(srcText, marker, len) { const a = srcText.indexOf(marker); return a < 0 ? '' : srcText.slice(a, a + len); }
check('db shim: portal-aware token selection exists', DB.includes('function portalTokenKey()') && DB.includes('keys.unshift(own)'));
check('db shim: teacher portal maps to the teacher token key', DB.includes("if (p.indexOf('teacher') !== -1) return 'alhuda_teacher_token';"));
check('db shim: setWorkerToken stores under the portal key, owner by default', DB.includes("const key = portalTokenKey() || 'alhuda_owner_token';"));
check('teacher loader: a 401 clears the dead token', fnSeg(TEACHER, 'function loadTeacherReaderPageImage', 2400).includes('window.clearWorkerTokens'));
check('parent loader: a 401 clears the dead token', fnSeg(PARENT, 'function loadParentReaderPageImage', 2400).includes('window.clearWorkerTokens'));
check('admin loader: a 401 clears the dead token', fnSeg(CURR, 'function loadReaderPageImage', 2400).includes('window.clearWorkerTokens'));
const ASEG = fnSeg(TEACHER, 'id="readerAnnotationToolbar"', 9500);
check('annotate: tool buttons are sleek white pills', ASEG.includes('rounded-full bg-white border border-stone-200 shadow-sm text-stone-600'));
check('annotate: separators are light (no dark zinc in the toolbar)', !ASEG.includes('bg-zinc-700'));
check('annotate: Save Page is an emerald gradient pill', ASEG.includes('bg-gradient-to-b from-emerald-500 to-emerald-700'));
check('annotate: active tool uses a soft emerald gradient', TEACHER.includes('background: linear-gradient(180deg, #059669, #047857) !important;'));


// ---- Annotate drawing fixes (owner report 2026-10-29, late evening) ----
const SELSEG = fnSeg(TEACHER, 'function selectAnnotationTool', 1500);
check('annotate: tool selection no longer paints buttons dark zinc', !SELSEG.includes('bg-zinc-800') && !SELSEG.includes('bg-zinc-700'));
check('annotate: tool selection toggles the active class (emerald gradient CSS)', SELSEG.includes("classList.add('active')"));
const TOGSEG = fnSeg(TEACHER, 'function toggleReaderWhiteboard', 2200);
check('annotate: whiteboard toggle never paints the Annotate button dark', !TOGSEG.includes('bg-zinc-800'));
const MOVESEG = fnSeg(TEACHER, "canvas.addEventListener('pointermove'", 4200);
check('annotate: live stroke resets the transform before scaling (no dpr-squared offset)', MOVESEG.includes('if (ctx.resetTransform) ctx.resetTransform();'));
check('annotate: stroke also ends on a window-level pointerup', TEACHER.includes("window.addEventListener('pointerup', handlePointerEnd);"));


// ---- Reader fetch retry + technical detail (2026-10-29, late) ----
check('teacher loader: status-less failures retry (attempt < 2)', fnSeg(TEACHER, 'function loadTeacherReaderPageImage', 3400).includes('attempt < 2'));
check('parent loader: status-less failures retry (attempt < 2)', fnSeg(PARENT, 'function loadParentReaderPageImage', 3400).includes('attempt < 2'));
check('admin loader: status-less failures retry (attempt < 2)', fnSeg(CURR, 'function loadReaderPageImage', 3400).includes('attempt < 2'));
check('teacher error box: technical detail line rendered', TEACHER.includes('Technical detail: ') && TEACHER.includes('TEACHER_READER_LAST_DETAIL'));
check('parent error box: technical detail line rendered', PARENT.includes('Technical detail: ') && PARENT.includes('PARENT_READER_LAST_DETAIL'));
check('admin error box: technical detail line rendered', CURR.includes('Technical detail: ') && CURR.includes('READER_LAST_DETAIL'));


// ---- Reader load-sequence guard (2026-10-29, late) ----
check('teacher loader: load sequence guard present', TEACHER.includes('TEACHER_READER_LOAD_SEQ') && TEACHER.includes('seq !== TEACHER_READER_LOAD_SEQ'));
check('parent loader: load sequence guard present', PARENT.includes('PARENT_READER_LOAD_SEQ') && PARENT.includes('seq !== PARENT_READER_LOAD_SEQ'));
check('admin loader: load sequence guard present', CURR.includes('READER_LOAD_SEQ') && CURR.includes('seq !== READER_LOAD_SEQ'));
check('teacher onload: success clears a stale error box', fnSeg(TEACHER, 'img.onload = () =>', 400).includes("getElementById('readerPageError')"));
check('parent onload: success clears a stale error box', PARENT.includes("img.onload = () => { if (PARENT_READER_ERROR_TIMER)") && PARENT.includes("getElementById('parentReaderPageError')"));
check('admin onload: success clears a stale error box', fnSeg(CURR, 'img.onload = function()', 400).includes("getElementById('readerPageError')"));


// ---- Reader error grace period (2026-10-29, late) ----
check('teacher error: 1.2s grace wrapper present', TEACHER.includes('TEACHER_READER_ERROR_TIMER') && TEACHER.includes('showTeacherReaderPageErrorNow') && TEACHER.includes('}, 1200);'));
check('parent error: 1.2s grace wrapper present', PARENT.includes('PARENT_READER_ERROR_TIMER') && PARENT.includes('showParentReaderPageErrorNow') && PARENT.includes('}, 1200);'));
check('admin error: 1.2s grace wrapper present', CURR.includes('READER_ERROR_TIMER') && CURR.includes('showReaderPageErrorNow') && CURR.includes('}, 1200);'));
check('teacher onload: success cancels a pending error', fnSeg(TEACHER, 'img.onload = () =>', 500).includes('clearTimeout(TEACHER_READER_ERROR_TIMER)'));
check('parent onload: cancels pending error + hides parent errbox', PARENT.includes('clearTimeout(PARENT_READER_ERROR_TIMER)') && PARENT.includes("getElementById('parentReaderPageError')"));
check('admin onload: success cancels a pending error', fnSeg(CURR, 'img.onload = function()', 500).includes('clearTimeout(READER_ERROR_TIMER)'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
