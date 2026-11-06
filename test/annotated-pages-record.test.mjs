// Annotated Lesson Pages — Phase A: record plumbing (js/lesson-history.js).
// `annotated_pages: [{key, para, page, orig_page, seq}]` inside the
// lesson_notes JSON is parsed/normalized beside the legacy `image_key`:
// parseLessonNotes -> annotatedPages (camelCase, seq-ordered, renumbered
// 1..n), normalizeLessonRow carries it, dedupe keeps the latest row's
// array. Legacy records (image_key only, plain text, or no field) behave
// exactly as before.
// Run from the repo root:  node test/annotated-pages-record.test.mjs
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
if (!LH) { console.log('FAIL | LessonHistory module did not load'); process.exit(1); }

const K1 = 'scoped-teacher-T1/111_annotated_quran_para2_page25.webp';
const K2 = 'scoped-teacher-T1/222_annotated_quran_para2_page26.webp';
const K3 = 'scoped-teacher-T1/333_annotated_quran_para2_page27.webp';

// --- 1. Full payload: annotated_pages parsed, sorted, camelCased --------
const full = LH.parseLessonNotes(JSON.stringify({
  book_id: 'holy-quran-16-line', book_title: 'Holy Quran', para: 2, page: 5,
  status: 'Pass', image_key: 'scoped-teacher-T1/old-photo.png',
  annotated_pages: [
    { key: K2, para: 2, page: 6, orig_page: 26, seq: 2 },
    { key: K1, para: 2, page: 5, orig_page: 25, seq: 1 },
    { key: K3, para: '2', page: '7', orig_page: '27', seq: 3 }
  ]
}));
check('parse: annotatedPages present beside imageKey', Array.isArray(full.annotatedPages) && full.imageKey === 'scoped-teacher-T1/old-photo.png');
check('parse: entries sorted by stored seq', full.annotatedPages.map(e => e.key).join('|') === [K1, K2, K3].join('|'));
check('parse: camelCase + numeric coercion (orig_page -> origPage)',
  full.annotatedPages[0].origPage === 25 && full.annotatedPages[2].para === 2 && full.annotatedPages[2].page === 7 && full.annotatedPages[2].origPage === 27);
check('parse: seq renumbered 1..n in display order', full.annotatedPages.map(e => e.seq).join(',') === '1,2,3');

// --- 2. Malformed entries are dropped, never invented --------------------
const messy = LH.parseLessonNotes(JSON.stringify({
  book_id: 'b1',
  annotated_pages: [
    { para: 1, page: 2, orig_page: 2, seq: 1 },          // no key -> dropped
    { key: '', para: 1, page: 3, seq: 2 },               // empty key -> dropped
    'not-an-object',                                     // dropped
    { key: K1, para: null, page: null, orig_page: null } // key only -> kept, nulls stay null
  ]
}));
check('parse: keyless/non-object entries dropped', Array.isArray(messy.annotatedPages) && messy.annotatedPages.length === 1 && messy.annotatedPages[0].key === K1);
check('parse: missing para/page/orig stay null (never Page 1)', messy.annotatedPages[0].para === null && messy.annotatedPages[0].page === null && messy.annotatedPages[0].origPage === null);

const notArray = LH.parseLessonNotes(JSON.stringify({ book_id: 'b1', annotated_pages: 'scoped-teacher-T1/x.webp' }));
check('parse: non-array annotated_pages -> null', notArray.annotatedPages === null);
const emptyArr = LH.parseLessonNotes(JSON.stringify({ book_id: 'b1', annotated_pages: [] }));
check('parse: empty annotated_pages -> null', emptyArr.annotatedPages === null);

// --- 3. Legacy records: annotatedPages null, everything else unchanged ---
const legacy = LH.parseLessonNotes(JSON.stringify({
  book_id: 'holy-quran-16-line', book_title: 'Holy Quran', para: 2, page: 14,
  line_range: 'Lines 1-5', line_box: 'Line 5, Box 2', status: 'Pass', remarks: 'Good',
  additional_lesson: 'Namaz', image_key: 'scoped-teacher-T1/img.png'
}));
check('legacy: annotatedPages null when field absent', legacy.annotatedPages === null);
check('legacy: every pre-existing field unchanged',
  legacy.bookId === 'holy-quran-16-line' && legacy.para === 2 && legacy.page === 14 &&
  legacy.lineRange === 'Lines 1-5' && legacy.lineBox === 'Line 5, Box 2' && legacy.result === 'Pass' &&
  legacy.remarks === 'Good' && legacy.additionalLesson === 'Namaz' && legacy.imageKey === 'scoped-teacher-T1/img.png');

const plain = LH.parseLessonNotes('Class started by teacher at 09:00 AM PKT');
check('legacy: plain-text note -> annotatedPages null, remarks intact', plain.annotatedPages === null && plain.remarks === 'Class started by teacher at 09:00 AM PKT' && plain.imageKey === null);
check('parse: empty/absent payload -> null overall', LH.parseLessonNotes('') === null && LH.parseLessonNotes(null) === null && LH.parseLessonNotes(undefined) === null);

// --- 4. normalizeLessonRow carries the array -----------------------------
const row = LH.normalizeLessonRow({
  id: 'L1', schedule_id: 'SC1', student_id: 'ST1', teacher_id: 'T1',
  date: '2026-11-06', status: 'Completed', created_at: '2026-11-06T10:00:00Z',
  lesson_notes: JSON.stringify({ book_id: 'holy-quran-16-line', para: 2, page: 5, annotated_pages: [{ key: K1, para: 2, page: 5, orig_page: 25, seq: 1 }] })
}, 'Ustadh A');
check('normalize: annotatedPages carried onto the entry', Array.isArray(row.annotatedPages) && row.annotatedPages.length === 1 && row.annotatedPages[0].key === K1 && row.annotatedPages[0].origPage === 25);
const rowLegacy = LH.normalizeLessonRow({
  id: 'L2', schedule_id: 'SC2', student_id: 'ST1', date: '2026-11-05', status: 'Completed',
  lesson_notes: JSON.stringify({ book_title: 'Qaida', page: 3, image_key: 'scoped-teacher-T1/img.png' })
});
check('normalize: legacy row -> annotatedPages null, imageKey intact', rowLegacy.annotatedPages === null && rowLegacy.imageKey === 'scoped-teacher-T1/img.png');

// --- 5. Dedupe: latest row's array wins; pairing untouched ---------------
const deduped = LH.dedupeLessonRows([
  { id: 'R1', schedule_id: 'SC9', student_id: 'ST1', teacher_id: 'T1', date: '2026-11-06', status: 'Running', created_at: '2026-11-06T09:00:00Z', started_at: '2026-11-06T09:00:00Z', lesson_notes: '' },
  { id: 'R2', schedule_id: 'SC9', student_id: 'ST1', teacher_id: 'T1', date: '2026-11-06', status: 'Completed', created_at: '2026-11-06T09:35:00Z', completed_at: '2026-11-06T09:35:00Z', lesson_notes: JSON.stringify({ book_title: 'Quran', page: 5, annotated_pages: [{ key: K1, para: 2, page: 5, orig_page: 25, seq: 1 }] }) },
  { id: 'R3', schedule_id: 'SC9', student_id: 'ST1', teacher_id: 'T1', date: '2026-11-06', status: 'Completed', created_at: '2026-11-06T10:00:00Z', completed_at: '2026-11-06T10:00:00Z', lesson_notes: JSON.stringify({ book_title: 'Quran', page: 6, annotated_pages: [{ key: K2, para: 2, page: 6, orig_page: 26, seq: 1 }, { key: K3, para: 2, page: 7, orig_page: 27, seq: 2 }] }) }
]);
check('dedupe: one entry for the class+date', deduped.length === 1);
check('dedupe: latest save wins the annotated pages', Array.isArray(deduped[0].annotatedPages) && deduped[0].annotatedPages.map(e => e.key).join('|') === [K2, K3].join('|'));
check('dedupe: started/completed pairing still applied', deduped[0].startedAt === '2026-11-06T09:00:00Z' && deduped[0].completedAt === '2026-11-06T10:00:00Z' && deduped[0].durationMins === 60);

// --- 6. Round-trip: writer shape -> parse -> normalize -------------------
const writerPayload = {
  book_id: 'holy-quran-16-line', para: 2, page: 5, orig_page: 25,
  annotated_pages: [
    { key: K1, para: 2, page: 5, orig_page: 25, seq: 1 },
    { key: K2, para: 2, page: 6, orig_page: 26, seq: 2 }
  ]
};
const rt = LH.normalizeLessonRow({ id: 'L9', student_id: 'ST1', date: '2026-11-06', status: 'Completed', lesson_notes: JSON.stringify(writerPayload) });
check('round-trip: writer payload survives stringify/parse intact',
  rt.annotatedPages.length === 2 && rt.annotatedPages[1].key === K2 && rt.annotatedPages[1].origPage === 26 && rt.annotatedPages[1].seq === 2);

const failed = results.filter(r => !r.pass);
console.log('annotated-pages-record: ' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exit(1);
