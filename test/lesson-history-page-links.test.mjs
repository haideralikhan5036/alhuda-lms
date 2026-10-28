// Lesson History page links — canonical resolver unit tests + fallback
// removal assertions for the touched readers / history call sites.
// Run from the repo root:  node test/lesson-history-page-links.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/lesson-history.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const sandbox = { console, URL, FormData, fetch: async () => { throw new Error('no fetch in unit tests'); } };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC + '\nthis.__LH = LessonHistory;', sandbox);
const LH = sandbox.__LH;
if (!LH || typeof LH.resolveLessonPage !== 'function') { console.log('FAIL | resolver did not load'); process.exit(1); }

// --- Fixture catalogs -------------------------------------------------------
function qaidaPages(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push('https://worker.test/api/storage?key=course_material/qaida-p' + i + '.png');
  return out;
}
const QAIDA_EN = { id: 'custom-1790853704135', title: 'Qaida Noorania Eng', category: 'qaida', total_pages: 33, pages: qaidaPages(33) };
const ISLAMIC_STUDIES = { id: 'custom-1790859594841', title: 'Islamic Studies Grade 1', category: 'essentials', total_pages: 164, pages: qaidaPages(164).map((u, i) => u.replace('qaida-p', 'isl-p')) };
const E_QAIDA = { id: 'interactive-madani-qaida', title: 'Al-Huda Interactive E-Qaida', category: 'qaida', total_pages: 49, is_interactive: true };
const CUSTOM_QURAN = { id: 'custom-1790959311209', title: 'HOLY QURAN 16 LINE', category: 'quran', total_pages: 549, pages: qaidaPages(549).map((u, i) => u.replace('qaida-p', 'q-p')) };
const BUILTIN_QURAN = { id: 'holy-quran-16-line', title: 'The Holy Quran (16-Line Tajweed)', category: 'quran', total_pages: 548, paras: [{ para: 1, page_start: 1, page_end: 18, total_pages: 18 }, { para: 2, page_start: 19, page_end: 36, total_pages: 18 }, { para: 3, page_start: 37, page_end: 54, total_pages: 18 }] };
const BOOKS = [QAIDA_EN, ISLAMIC_STUDIES, E_QAIDA, CUSTOM_QURAN, BUILTIN_QURAN];

// --- 1. Exact custom-book page: display 18 -> index 17 ----------------------
{
  const r = LH.resolveLessonPage({ bookId: 'custom-1790853704135', page: 18, para: null, isAdditionalCourse: false }, BOOKS);
  check('custom book: display 18 resolves ok', r.ok === true, JSON.stringify(r));
  check('custom book: pageIndex 17 (display N -> pages[N-1], converted once)', r.pageIndex === 17);
  check('custom book: url is the 18th page, not page 1', typeof r.url === 'string' && r.url.includes('qaida-p18.png'), r.url);
  check('custom book: viewerMode image', r.viewerMode === 'image');
  check('custom book: displayPage echoes saved page', r.displayPage === 18);
}
// --- 2. Same page number, different courses -> correct book -----------------
{
  const a = LH.resolveLessonPage({ bookId: 'custom-1790853704135', page: 18, para: null }, BOOKS);
  const b = LH.resolveLessonPage({ bookId: 'custom-1790859594841', page: 18, para: null }, BOOKS);
  check('same page number: Qaida vs Islamic Studies resolve to different books', a.ok && b.ok && a.book.id !== b.book.id && a.url !== b.url, a.url + ' / ' + b.url);
  check('same page number: Islamic Studies page 18 is its own image', b.url.includes('isl-p18.png'), b.url);
}
// --- 3. Para-relative Quran: para 3 page 5 -> para slice index 4 ------------
{
  const r = LH.resolveLessonPage({ bookId: 'custom-1790959311209', page: 5, para: 3 }, BOOKS);
  check('para book: para 3 page 5 resolves ok', r.ok === true, JSON.stringify(r));
  check('para book: pageIndex 4 (para-relative, not global)', r.pageIndex === 4);
  // Custom Quran pages[] are global: para 3 starts at global 37 -> index 36 + 4 = 40 -> q-p41
  check('para book: url is para 3 fifth page (global p41), not global p5', r.url.includes('q-p41.png'), r.url);
  check('para book: para echoed', r.para === 3);
}
// --- 4. Para-less Quran -> PARA_REQUIRED, never a global-page guess ---------
{
  const r = LH.resolveLessonPage({ bookId: 'custom-1790959311209', page: 5, para: null }, BOOKS);
  check('para-less Quran: PARA_REQUIRED', r.ok === false && r.reason === 'PARA_REQUIRED', JSON.stringify(r));
  const r2 = LH.resolveLessonPage({ bookId: 'holy-quran-16-line', page: 5, para: null }, BOOKS);
  check('para-less built-in Quran: PARA_REQUIRED', r2.ok === false && r2.reason === 'PARA_REQUIRED', JSON.stringify(r2));
}
// --- 5. Interactive Qaida lesson numbers ------------------------------------
{
  const r = LH.resolveLessonPage({ bookId: 'interactive-madani-qaida', page: 18, para: null }, BOOKS);
  check('interactive Qaida: page 18 -> lesson 18', r.ok === true && r.pageIndex === 17 && r.viewerMode === 'interactive', JSON.stringify(r));
  const bad = LH.resolveLessonPage({ bookId: 'interactive-madani-qaida', page: 50, para: null }, BOOKS);
  check('interactive Qaida: page 50 out of range (never clamped to 49)', bad.ok === false && bad.reason === 'PAGE_OUT_OF_RANGE', JSON.stringify(bad));
}
// --- 6. Sentinel / title-only / missing book / missing page ----------------
{
  check('sentinel: ADDITIONAL_COURSE', LH.resolveLessonPage({ bookId: 'additional-course', page: null, isAdditionalCourse: true }, BOOKS).reason === 'ADDITIONAL_COURSE');
  check('sentinel by id alone: ADDITIONAL_COURSE', LH.resolveLessonPage({ bookId: 'additional-course', page: 5 }, BOOKS).reason === 'ADDITIONAL_COURSE');
  check('title-only record: NO_BOOK_ID (never title-matched)', LH.resolveLessonPage({ bookId: null, bookTitle: 'Qaida Nooraniya Eng', page: 18 }, BOOKS).reason === 'NO_BOOK_ID');
  check('unknown book: BOOK_NOT_FOUND (never first-book fallback)', LH.resolveLessonPage({ bookId: 'custom-unknown', page: 18 }, BOOKS).reason === 'BOOK_NOT_FOUND');
  check('tombstoned/missing-from-list book: BOOK_NOT_FOUND', LH.resolveLessonPage({ bookId: 'noorani-qaida', page: 18 }, BOOKS).reason === 'BOOK_NOT_FOUND');
  check('missing page: PAGE_MISSING (never page 1)', LH.resolveLessonPage({ bookId: 'custom-1790853704135', page: null }, BOOKS).reason === 'PAGE_MISSING');
  check('missing page empty string: PAGE_MISSING', LH.resolveLessonPage({ bookId: 'custom-1790853704135', page: '' }, BOOKS).reason === 'PAGE_MISSING');
}
// --- 7. Out of range / holes / no pages -------------------------------------
{
  check('page 34 of 33-page book: PAGE_OUT_OF_RANGE', LH.resolveLessonPage({ bookId: 'custom-1790853704135', page: 34 }, BOOKS).reason === 'PAGE_OUT_OF_RANGE');
  check('page 0: PAGE_OUT_OF_RANGE', LH.resolveLessonPage({ bookId: 'custom-1790853704135', page: 0 }, BOOKS).reason === 'PAGE_OUT_OF_RANGE');
  const holed = { id: 'custom-holed', title: 'Holed', category: 'qaida', total_pages: 33, pages: qaidaPages(33) };
  holed.pages[17] = undefined; // hole at display page 18
  check('hole at page 18: PAGE_NOT_AVAILABLE (never page 19)', LH.resolveLessonPage({ bookId: 'custom-holed', page: 18 }, [holed]).reason === 'PAGE_NOT_AVAILABLE');
  const svgBook = { id: 'custom-svg', title: 'Svg', category: 'qaida', total_pages: 5, pages: ['data:image/svg+xml;base64,xxx', 'x', 'x', 'x', 'x'] };
  check('placeholder SVG page: PAGE_NOT_AVAILABLE', LH.resolveLessonPage({ bookId: 'custom-svg', page: 1 }, [svgBook]).reason === 'PAGE_NOT_AVAILABLE');
  check('built-in Quran with no pages array + para: PAGE_NOT_AVAILABLE', LH.resolveLessonPage({ bookId: 'holy-quran-16-line', page: 5, para: 2 }, [BUILTIN_QURAN]).reason === 'PAGE_NOT_AVAILABLE');
  const noPages = { id: 'custom-nopages', title: 'NoPages', category: 'qaida', total_pages: 10 };
  check('non-para book with no pages array: PAGE_NOT_AVAILABLE', LH.resolveLessonPage({ bookId: 'custom-nopages', page: 3 }, [noPages]).reason === 'PAGE_NOT_AVAILABLE');
  check('para page beyond para length: PAGE_OUT_OF_RANGE', LH.resolveLessonPage({ bookId: 'custom-1790959311209', page: 19, para: 1 }, BOOKS).reason === 'PAGE_OUT_OF_RANGE');
}
// --- 8. Language passthrough + reason messages -------------------------------
{
  const r = LH.resolveLessonPage({ bookId: 'custom-1790853704135', page: 2, language: 'en' }, BOOKS);
  check('language passed through untouched', r.ok === true && r.language === 'en');
  check('reason message: BOOK_NOT_FOUND is the admin honest text', LH.lessonPageReasonMessage('BOOK_NOT_FOUND') === 'Course book not found.');
  check('reason message: every reason has a plain sentence', ['ADDITIONAL_COURSE', 'NO_BOOK_ID', 'BOOK_NOT_FOUND', 'PAGE_MISSING', 'PARA_REQUIRED', 'PAGE_OUT_OF_RANGE', 'PAGE_NOT_AVAILABLE'].every((k) => typeof LH.lessonPageReasonMessage(k) === 'string' && LH.lessonPageReasonMessage(k).length > 0));
}
// --- 9. Refresh helper: one bounded re-hydration ----------------------------
{
  let books = [];
  const r = await LH.resolveLessonPageWithRefresh(
    { bookId: 'custom-1790853704135', page: 18, para: null },
    () => books,
    async () => { books = BOOKS; }
  );
  check('refresh: BOOK_NOT_FOUND then hydration fills list -> ok', r.ok === true && r.pageIndex === 17, JSON.stringify(r));
  const r2 = await LH.resolveLessonPageWithRefresh(
    { bookId: 'custom-1790853704135', page: 18, para: null },
    () => [],
    async () => { throw new Error('hydration down'); }
  );
  check('refresh: failed hydration yields honest final reason', r2.ok === false && r2.reason === 'BOOK_NOT_FOUND', JSON.stringify(r2));
  const r3 = await LH.resolveLessonPageWithRefresh(
    { bookId: 'custom-1790853704135', page: 18, para: null },
    () => BOOKS,
    async () => { throw new Error('must not be called when already ok'); }
  );
  check('refresh: no hydration call when first resolution succeeds', r3.ok === true);
}
// --- 10. Fallback-removal assertions (touched readers / call sites) ---------
{
  const teacher = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
  const parent = fs.readFileSync(path.join(REPO_ROOT, 'parent.html'), 'utf8');
  const dash = fs.readFileSync(path.join(REPO_ROOT, 'js/dashboard.js'), 'utf8');
  const curr = fs.readFileSync(path.join(REPO_ROOT, 'js/curriculum.js'), 'utf8');
  const tReader = teacher.slice(teacher.indexOf('function openDigitalBookReader'), teacher.indexOf('CURRENT_READER_BOOK = book'));
  // Strip line comments: a comment describing the removed fallback must
  // not itself trip the assertion — only executable code counts.
  const tReaderCode = tReader.replace(/\/\/[^\n]*/g, '');
  check('teacher reader: no allBooks[0] fallback', !tReaderCode.includes('allBooks[0]'), tReaderCode.slice(0, 200));
  check('teacher reader: honest alert on unknown book', tReader.includes('alert("Course book not found.")'));
  const pReader = parent.slice(parent.indexOf('function openParentDigitalReader'), parent.indexOf('ACTIVE_READER_BOOK = book'));
  check('parent reader: no first-qaida fallback', !pReader.includes("includes('qaida')") && !pReader.includes('allBooks[0]'));
  check('parent reader: honest alert on unknown book', pReader.includes('alert("Course book not found.")'));
  check('dashboard: no invented noorani-qaida-classic id', !dash.includes('noorani-qaida-classic'));
  check('dashboard: Read button routes via resolver opener', dash.includes('openAdminSavedLessonPage'));
  const todayBtn = teacher.slice(teacher.indexOf('const lessonReadBtn'), teacher.indexOf('const lessonReadBtn') + 1200);
  check('teacher today card: no invented holy-quran-16-line default', !todayBtn.includes('holy-quran-16-line'));
  check('teacher today card: routes via resolver opener', todayBtn.includes('openTeacherSavedLessonPage'));
  check('parent hero: no page-1 holy-quran fallback open', !parent.includes("openParentDigitalReader('holy-quran-16-line', 1)"));
  check('parent recent/table: route via resolver opener', parent.includes('openParentSavedLessonPage'));
  check('teacher history tab: Read button routes via resolver opener', teacher.includes('openTeacherHistoryLessonPage'));
  check('curriculum deep link: para passes through', curr.includes("params.get('para')"));
  const prof = fs.readFileSync(path.join(REPO_ROOT, 'js/profiles360.js'), 'utf8');
  check('360: table + inspector Open-page buttons exist', prof.includes('open360LessonPageFromTable') && prof.includes('open360LessonPageFromInspector'));
  check('360: zero reader calls before fix are now wired (openDigitalBookReader in 360 opener)', prof.includes('openDigitalBookReader(res.book.id'));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\nlesson-history-page-links: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
