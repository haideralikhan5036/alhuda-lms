// Phase 3.3 (teacher data-loss batch) — tests for P2-19, P2-20, P2-21,
// P2-22, P2-23, P2-26. Drives the REAL js/lesson-history.js (vm-loaded)
// and the REAL cloudflare/worker.js (temp ESM copy + FakeD1 over
// node:sqlite, same harness shape as test/audit-p1-backend-fixes).
// teacher.html items that cannot run headless (portal load, modal saves)
// are covered by structural guards on the real file text plus, for
// P2-20, the extracted real helper function run in a vm.
// Run from the repo root:  node test/phase3-teacher-data-loss.test.mjs
// Requires: node >= 22.5 (node:sqlite).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' :: ' + String(detail || '').slice(0, 300)}`);
}

// ==== Part A: shared lesson-history reader (P2-19) ===========================
const LH_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/lesson-history.js'), 'utf8');
const lhSandbox = { console, URL, FormData, fetch: async () => { throw new Error('no fetch in unit tests'); } };
lhSandbox.window = lhSandbox; lhSandbox.globalThis = lhSandbox;
vm.createContext(lhSandbox);
vm.runInContext(LH_SRC + '\nthis.__LH = LessonHistory;', lhSandbox);
const LH = lhSandbox.__LH;
if (!LH) { console.log('FAIL | LessonHistory module did not load'); process.exit(1); }

const logRow = (id, status, created, notesObj) => ({
  id, schedule_id: 'SCH-1', student_id: 'STU-1', teacher_id: 'TCH-1',
  date: '2026-10-28', status, created_at: created,
  lesson_notes: notesObj === null ? '' : JSON.stringify(notesObj),
});
const regular = (id, created, page) => logRow(id, 'Completed', created, { book_id: 'q', book_title: 'Quran', page });
const advance = (id, created, page) => logRow(id, 'Advance Class', created, { book_id: 'q', book_title: 'Quran', page, is_advance_class: true, advance_target_date: '2026-10-29' });

{
  // The audit case: regular saved, then an advance saved for the same
  // slot/day. Old dedupe showed 1 entry (latest-created won); now both.
  const out = LH.dedupeLessonRows([regular('R1', '2026-10-28T10:00:00Z', 5), advance('R2', '2026-10-28T11:00:00Z', 9)]);
  check('P2-19 advance after regular -> 2 entries, regular intact', out.length === 2 && out.some((e) => e.status === 'Completed' && e.page === 5) && out.some((e) => e.status === 'Advance Class' && e.page === 9), JSON.stringify(out.map((e) => e.status + ':p' + e.page)));
  // Reverse order: advance first, regular re-saved later. The regular
  // re-save must not swallow the advance either.
  const out2 = LH.dedupeLessonRows([advance('R2', '2026-10-28T10:00:00Z', 9), regular('R1', '2026-10-28T11:00:00Z', 5)]);
  check('P2-19 regular re-save after advance -> still 2 entries', out2.length === 2 && out2.some((e) => e.status === 'Advance Class' && e.page === 9) && out2.some((e) => e.status === 'Completed' && e.page === 5), JSON.stringify(out2.map((e) => e.status + ':p' + e.page)));
  // Same-kind re-saves still collapse to the latest (no duplication).
  const out3 = LH.dedupeLessonRows([regular('R1', '2026-10-28T10:00:00Z', 5), regular('R3', '2026-10-28T12:00:00Z', 6)]);
  check('P2-19 regular re-save still collapses to latest only', out3.length === 1 && out3[0].page === 6, JSON.stringify(out3.map((e) => e.status + ':p' + e.page)));
  const out4 = LH.dedupeLessonRows([advance('R2', '2026-10-28T10:00:00Z', 9), advance('R4', '2026-10-28T12:00:00Z', 10)]);
  check('P2-19 advance re-save still collapses to latest only', out4.length === 1 && out4[0].page === 10, JSON.stringify(out4.map((e) => e.status + ':p' + e.page)));
  // Payload-flag-only advance (status stored as something else but the
  // payload marks it advance) is still separated, never masked.
  const flagged = logRow('R5', 'Completed', '2026-10-28T13:00:00Z', { book_id: 'q', book_title: 'Quran', page: 12, is_advance_class: true, advance_target_date: '2026-10-29' });
  const out5 = LH.dedupeLessonRows([regular('R1', '2026-10-28T10:00:00Z', 5), flagged]);
  check('P2-19 payload-flagged advance separated from regular', out5.length === 2 && out5.some((e) => e.isAdvanceClass === true && e.page === 12), JSON.stringify(out5.map((e) => e.status + ':p' + e.page + ':adv=' + e.isAdvanceClass)));
  // Schedule-less rows still pass through untouched.
  const noSched = [
    { id: 'N1', student_id: 'STU-1', teacher_id: 'TCH-1', date: '2026-10-28', status: 'Completed', created_at: '2026-10-28T10:00:00Z', lesson_notes: JSON.stringify({ book_id: 'q', page: 1 }) },
    { id: 'N2', student_id: 'STU-1', teacher_id: 'TCH-1', date: '2026-10-28', status: 'Completed', created_at: '2026-10-28T11:00:00Z', lesson_notes: JSON.stringify({ book_id: 'q', page: 2 }) },
  ];
  check('P2-19 schedule-less rows pass through ungrouped', LH.dedupeLessonRows(noSched).length === 2);
  // Normalization flags.
  check('P2-19 normalize: Completed is not advance', LH.normalizeLessonRow(regular('R1', '2026-10-28T10:00:00Z', 5)).isAdvanceClass === false);
  check('P2-19 normalize: Advance Class status is advance', LH.normalizeLessonRow(advance('R2', '2026-10-28T10:00:00Z', 9)).isAdvanceClass === true);
}

// ==== Part B: teacher.html — real helper + structural guards =================
const TEACHER_SRC = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
{
  // P2-20: extract the REAL helper from teacher.html and run it.
  const m = TEACHER_SRC.match(/function appendTeacherRequestToHistory\(meta, singleKey, historyKey, reqObj\) \{[\s\S]*?\n    \}/);
  check('P2-20 helper present and extractable from teacher.html', !!m, 'helper regex missed');
  if (m) {
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(m[0] + '\nthis.__append = appendTeacherRequestToHistory;', sb);
    const append = sb.__append;
    const meta = { manager_notes: ['keep-me'], leave_request: { id: 'OLD', status: 'pending' }, leave_history: [{ id: 'OLD', status: 'pending' }] };
    append(meta, 'leave_request', 'leave_history', { id: 'NEW', status: 'pending' });
    check('P2-20 second request keeps first pending in history', meta.leave_history.length === 2 && meta.leave_history[0].id === 'OLD' && meta.leave_history[1].id === 'NEW', JSON.stringify(meta.leave_history));
    check('P2-20 single field still means latest request', meta.leave_request.id === 'NEW');
    check('P2-20 other meta keys untouched', Array.isArray(meta.manager_notes) && meta.manager_notes[0] === 'keep-me');
    const fresh = {};
    append(fresh, 'time_change_request', 'time_change_history', { id: 'T1', status: 'pending' });
    check('P2-20 missing history list starts as [] then appends', Array.isArray(fresh.time_change_history) && fresh.time_change_history.length === 1 && fresh.time_change_request.id === 'T1');
    const broken = { reschedule_history: 'not-an-array' };
    append(broken, 'reschedule_request', 'reschedule_history', { id: 'R1', status: 'pending' });
    check('P2-20 non-array history resets safely, request kept', Array.isArray(broken.reschedule_history) && broken.reschedule_history.length === 1);
  }
  // All three submit sites call the helper with the right history keys.
  check('P2-20 leave submit appends to leave_history', TEACHER_SRC.includes("appendTeacherRequestToHistory(meta, 'leave_request', 'leave_history', reqObj)"));
  check('P2-20 reschedule submit appends to reschedule_history', TEACHER_SRC.includes("appendTeacherRequestToHistory(meta, 'reschedule_request', 'reschedule_history', reqObj)"));
  check('P2-20 time-change submit appends to time_change_history', TEACHER_SRC.includes("appendTeacherRequestToHistory(meta, 'time_change_request', 'time_change_history', reqObj)"));
  // P2-21: no server delete of class_schedules remains in teacher.html.
  check('P2-21 no class_schedules delete left in teacher.html', !TEACHER_SRC.includes("from('class_schedules').delete()"));
  // P2-23: every remaining allBooks[0] is a comment or the modal-open
  // default (an initial dropdown value, not a stale-id resolution).
  const codeLines = TEACHER_SRC.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const remaining = codeLines.filter((l) => l.includes('allBooks[0]'));
  check('P2-23 only the modal-open default still uses allBooks[0]', remaining.length === 1 && remaining[0].includes('onAdvanceCourseBookChanged'), JSON.stringify(remaining));
  const notFoundCount = (TEACHER_SRC.match(/Course book not found/g) || []).length;
  check('P2-23 fail-closed message present at all fixed sites (>=8)', notFoundCount >= 8, 'found ' + notFoundCount);
  // P2-26: the Absent/Leave transition branch preserves prior JSON.
  // (Slice to notifyClassSessionSync: the branch itself contains a
  // JSON.parse try/catch, so slicing to the next 'try {' would cut the
  // branch short before the preservation lines.)
  const branchStart = TEACHER_SRC.indexOf("targetStatus === 'Absent' || targetStatus === 'Leave'");
  const branchEnd = TEACHER_SRC.indexOf('notifyClassSessionSync', branchStart);
  const branch = branchStart >= 0 && branchEnd > branchStart ? TEACHER_SRC.slice(branchStart, branchEnd) : '';
  check('P2-26 transition Absent/Leave branch preserves prior JSON', branch.includes('const next = { ...preserved };') && branch.includes('next.status = targetStatus'), branch.slice(0, 200));
  check('P2-26 old bare remarks overwrite is gone from that branch', !branch.includes('if (notes) upsertData.lesson_notes = notes;'), branch.slice(0, 300));
  // P2-23 save-path guards: both saves abort before building a payload
  // under a missing book.
  check('P2-23 main save aborts on missing book', TEACHER_SRC.includes('if (!book) { lmsNotify("Course book not found. Please choose another book."); return; }'));
  check('P2-23 advance save aborts on missing book', TEACHER_SRC.includes('if (!isAdditionalCourse && !book) { lmsNotify("Course book not found. Please choose another book."); return; }'));
}

// ==== Part C: Worker P2-22 scope check (FakeD1) ==============================
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'phase33-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'phase33-test-secret-only';
const ORIGIN = 'https://alhuda-lms.vercel.app';
class FakeStatement {
  constructor(db, sql) { this._db = db; this._sql = sql; this._params = []; }
  bind(...params) { this._params = params; return this; }
  async all() { return { results: this._db.prepare(this._sql).all(...this._params), success: true, meta: {} }; }
  async run() { const r = this._db.prepare(this._sql).run(...this._params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
  async first() { const row = this._db.prepare(this._sql).get(...this._params); return row === undefined ? null : row; }
}
class FakeD1 {
  constructor() { this._db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new FakeStatement(this._db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
  async exec(sql) { this._db.exec(sql); return { success: true }; }
}
const fakeDb = new FakeD1();
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, OWNER_USERNAME: 'owner-test', ALLOWED_ORIGINS: ORIGIN, DB: fakeDb };
const eq = (column, value) => [{ column, op: 'eq', value }];
async function call(pathname, { token = null, body = null, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request('https://worker.test' + pathname, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, json };
}
const dbPost = (token, body) => call('/api/db', { token, body });
const TOK_OWNER = await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET);

{
  const boot = await dbPost(TOK_OWNER, { table: 'families', action: 'select' });
  check('P2-22 schema boot', boot.status === 200, boot.text.slice(0, 200));
  const seedT = await dbPost(TOK_OWNER, { table: 'teachers', action: 'insert', values: { id: 'TCH-OWN', full_name: 'Own Teacher', address: '{}' } });
  check('P2-22 seed teacher', seedT.status === 200, seedT.text.slice(0, 200));
  const seedOwn = await dbPost(TOK_OWNER, { table: 'students', action: 'insert', values: { id: 'STU-OWN', family_id: 'FAM-1', name: 'Own Student', assigned_teacher_id: 'TCH-OWN', status: 'Active', notes: '{}' } });
  check('P2-22 seed assigned student', seedOwn.status === 200, seedOwn.text.slice(0, 200));
  const seedFree = await dbPost(TOK_OWNER, { table: 'students', action: 'insert', values: { id: 'STU-FREE', family_id: 'FAM-1', name: 'Free Student', assigned_teacher_id: '', status: 'Active', notes: '{}' } });
  check('P2-22 seed unassigned student', seedFree.status === 200, seedFree.text.slice(0, 200));
  // Tokens minted AFTER seeding (marker determinism, same as P1 tests).
  const tokOwn = await createSessionToken({ sub: 'TCH-OWN', role: 'teacher' }, WORKER_SECRET);
  const sched = (studentId, day, start) => ({ student_id: studentId, day_of_week: day, start_time: start, end_time: '17:30:00', status: 'Active' });
  const ownIns = await dbPost(tokOwn, { table: 'class_schedules', action: 'insert', values: sched('STU-OWN', 1, '17:00:00') });
  check('P2-22 teacher insert for assigned student -> 200', ownIns.status === 200, ownIns.text.slice(0, 200));
  const ownRows = await dbPost(TOK_OWNER, { table: 'class_schedules', action: 'select', filters: eq('student_id', 'STU-OWN') });
  check('P2-22 assigned-student row landed under own teacher_id', ownRows.status === 200 && Array.isArray(ownRows.json?.data) && ownRows.json.data.length === 1 && ownRows.json.data[0].teacher_id === 'TCH-OWN', ownRows.text.slice(0, 300));
  const freeIns = await dbPost(tokOwn, { table: 'class_schedules', action: 'insert', values: sched('STU-FREE', 2, '17:00:00') });
  check('P2-22 teacher insert for unassigned student -> 403', freeIns.status === 403, freeIns.text.slice(0, 200));
  const freeRows = await dbPost(TOK_OWNER, { table: 'class_schedules', action: 'select', filters: eq('student_id', 'STU-FREE') });
  check('P2-22 denied insert wrote no row', freeRows.status === 200 && Array.isArray(freeRows.json?.data) && freeRows.json.data.length === 0, freeRows.text.slice(0, 300));
  const noStu = await dbPost(tokOwn, { table: 'class_schedules', action: 'insert', values: { day_of_week: 3, start_time: '17:00:00', end_time: '17:30:00', status: 'Active' } });
  check('P2-22 teacher insert with missing student_id -> 403 (fail closed)', noStu.status === 403, noStu.text.slice(0, 200));
  const ownId = ownRows.json.data[0].id;
  const ownRe = await dbPost(tokOwn, { table: 'class_schedules', action: 'upsert', values: { id: ownId, student_id: 'STU-OWN', day_of_week: 1, start_time: '18:00:00', end_time: '18:30:00', status: 'Active' } });
  check('P2-22 teacher re-save of own slot -> 200 (unchanged)', ownRe.status === 200, ownRe.text.slice(0, 200));
  const batch = await dbPost(tokOwn, { table: 'class_schedules', action: 'insert', values: [sched('STU-OWN', 6, '17:00:00'), sched('STU-FREE', 6, '17:00:00')] });
  check('P2-22 mixed batch (one out-of-scope) -> 403 whole batch', batch.status === 403, batch.text.slice(0, 200));
  const batchRows = await dbPost(TOK_OWNER, { table: 'class_schedules', action: 'select', filters: eq('day_of_week', 6) });
  check('P2-22 denied batch wrote neither row', batchRows.status === 200 && Array.isArray(batchRows.json?.data) && batchRows.json.data.length === 0, batchRows.text.slice(0, 300));
  const ownerFree = await dbPost(TOK_OWNER, { table: 'class_schedules', action: 'insert', values: sched('STU-FREE', 2, '17:00:00') });
  check('P2-22 owner insert for unassigned student -> 200 (unchanged semantics)', ownerFree.status === 200, ownerFree.text.slice(0, 200));
  // Release discipline: this batch must not bump the release.
  const health = await call('/api/health', { method: 'GET' });
  check('P2-22 WORKER_RELEASE not bumped', health.status === 200 && health.json && health.json.version === '2026-10-28-audit-p1', health.text.slice(0, 200));
}

// ==== Summary =================================================================
const failed = results.filter((r) => !r.pass);
console.log('---');
console.log(`phase3-teacher-data-loss: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) { console.log('FAILED:'); for (const f of failed) console.log(' - ' + f.name); process.exit(1); }
