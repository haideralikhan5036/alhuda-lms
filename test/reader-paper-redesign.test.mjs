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
check('teacher: annotation toolbar is light too', TSEG.includes('id="readerAnnotationToolbar" class="hidden bg-white'));
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
check('honest load errors preserved (no fabricated pages)',
  TEACHER.includes("'Could not load this page.'") && PARENT.includes("'Could not load this page.'") && CURR.includes("'Could not load this page.'"));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
