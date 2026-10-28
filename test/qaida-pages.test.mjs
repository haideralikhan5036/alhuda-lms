// Dynamic Qaida page numbering (Task 2) tests — REAL buildLessonPageOptions
// extracted from teacher.html, plus structural guards on both form handlers:
//  A) Chapter-first shadowing case: a book with 12 chapters (page_start
//     1..12) but total_pages 32 offers 1..32 — the reported cap is gone,
//     and the rule is generic (a total_pages of 30 offers 30, nothing is
//     hardcoded to 30 or 32).
//  B) Equal case unchanged: 49 chapters with page_start 1..49 and
//     total_pages 49 keeps the chapter options (with titles).
//  C) Chapterless books unchanged: total_pages loop, pages.length
//     fallback, and the 32 default when metadata is absent; the advance
//     form's 120 cap still applies to the numeric range only.
//  D) total_pages below the largest chapter page_start keeps chapters.
//  E) Both handlers replace the page select wholesale on course change
//     (no stale options). NOTE (Batch 3.3, audit P2-23): the old
//     allBooks[0] fallback for unresolvable NON-sentinel ids — once
//     documented here as deliberately preserved for auto-select — is
//     REMOVED. A stale/deleted book id now fails closed ('Course book
//     not found.') instead of silently showing the first catalogue
//     book's pages, which could then be saved under the wrong title.
//     Auto-select callers passing an unresolvable id get the toast and
//     pick a book manually; the save paths fail closed too.
// Run from the repo root:  node test/qaida-pages.test.mjs
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

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(extractFunction(TEACHER_HTML, 'buildLessonPageOptions'), sandbox);
const opts = (book, cap) => vm.runInContext(
  `buildLessonPageOptions(${JSON.stringify(book)}${cap === undefined ? '' : `, ${cap}`})`, sandbox);
const countOpts = (html) => (html.match(/<option/g) || []).length;
const values = (html) => [...html.matchAll(/value="(\d+)"/g)].map(m => Number(m[1]));

// A) shadowing case: 12 chapters, total_pages 32 -> 1..32
{
  const book = {
    id: 'noorani-qaida', title: 'Noorani Qaida (Complete)', category: 'qaida',
    total_pages: 32,
    chapters: Array.from({ length: 12 }, (_, i) => ({ page_start: i + 1, title: `Takhti ${i + 1}` })),
  };
  const html = opts(book);
  check('shadowing case: 12 chapters + total_pages 32 offers 32 options', countOpts(html) === 32, `got ${countOpts(html)}`);
  const v = values(html);
  check('shadowing case: values are exactly 1..32', v.length === 32 && v[0] === 1 && v[31] === 32);
  check('shadowing case: no chapter titles leak into the numeric range', !html.includes('Takhti'));
  // Generic rule proof: a different total offers exactly that many (no hardcode).
  const html30 = opts({ ...book, total_pages: 30 });
  check('rule is generic: total_pages 30 offers 30 (nothing hardcoded)', countOpts(html30) === 30);
}

// B) equal case: 49 chapters, total_pages 49 -> chapter options kept
{
  const book = {
    id: 'interactive-madani-qaida', title: 'Al-Huda Interactive E-Qaida', category: 'qaida',
    total_pages: 49,
    chapters: Array.from({ length: 49 }, (_, i) => ({ page_start: i + 1, title: `Chapter ${i + 1}` })),
  };
  const html = opts(book);
  check('equal case: 49 chapters + total_pages 49 keeps chapter options', countOpts(html) === 49 && html.includes('Chapter 49'));
}

// C) chapterless books
{
  check('chapterless: total_pages 33 offers 1..33',
    countOpts(opts({ id: 'c1', total_pages: 33 })) === 33);
  check('chapterless: pages.length fallback offers pages count',
    countOpts(opts({ id: 'c2', pages: Array.from({ length: 7 }) })) === 7);
  check('chapterless: no metadata keeps the existing 32 default',
    countOpts(opts({ id: 'c3' })) === 32);
  check('advance cap: total_pages 549 with cap 120 offers 120',
    countOpts(opts({ id: 'c4', total_pages: 549 }, 120)) === 120);
  check('advance cap: chapters are NOT capped by the 120 limit (kept chapters survive the cap)',
    (() => {
      const h = opts({ id: 'c5', total_pages: 10, chapters: [{ page_start: 1, title: 'A' }, { page_start: 200, title: 'B' }] }, 120);
      return countOpts(h) === 2 && h.includes('value="200"');
    })());
}

// D) total_pages below the largest chapter page_start keeps chapters
{
  const book = {
    id: 'x', total_pages: 32,
    chapters: [{ page_start: 1, title: 'A' }, { page_start: 50, title: 'B' }],
  };
  const html = opts(book);
  check('total below max chapter start keeps chapter options',
    countOpts(html) === 2 && html.includes('value="50"'));
}

// E) structural: both handlers use the shared generator + wholesale refresh
{
  const main = extractFunction(TEACHER_HTML, 'onTeacherCourseBookChanged');
  const adv = extractFunction(TEACHER_HTML, 'onAdvanceCourseBookChanged');
  check('main handler builds pages via buildLessonPageOptions',
    main.includes('buildLessonPageOptions(book)'));
  check('advance handler builds pages via buildLessonPageOptions with the 120 cap',
    adv.includes('buildLessonPageOptions(book, 120)'));
  check('main handler replaces the page select wholesale (no stale options)',
    main.includes('pageSelect.innerHTML = buildLessonPageOptions(book)'));
  check('advance handler replaces the page select wholesale (no stale options)',
    adv.includes('pSelect.innerHTML = buildLessonPageOptions(book, 120)'));
}
{
  // Real no-hardcode check: the generator contains no numeric literal used
  // as a page bound other than the pre-existing 32 metadata default.
  const gen = extractFunction(TEACHER_HTML, 'buildLessonPageOptions');
  const hasSuspiciousBound = /<=\s*(12|30|32)\b|Math\.min\([^)]*\b(12|30|32)\b/.test(gen);
  check('generator has no hardcoded 12/30/32 bound', !hasSuspiciousBound);
  const main = extractFunction(TEACHER_HTML, 'onTeacherCourseBookChanged');
  // Batch 3.3 (audit P2-23) supersedes the old documented fallback (see
  // header note E): a stale/deleted book id must fail closed instead of
  // silently resolving to the first catalogue book.
  check('P2-23: course-book handler fails closed, no allBooks[0] fallback',
    !main.includes('|| allBooks[0]') && main.includes('Course book not found'));
}

const failed = results.filter(r => !r.pass);
console.log(`---\nqaida-pages: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join(' | ')); process.exit(1); }
