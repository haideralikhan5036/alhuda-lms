// Zoom workflow (Phase 3) tests.
// A. Server guard: a delivered session (Completed, or legacy Present)
// is terminal for teacher/manager /api/db writes — the frontend guard
// is now enforced server-side. Re-saves within the delivered set pass,
// remarks-only edits pass, owner stays the repair path.
// B. Ownership model: teacher-default changes overwrite only synced
// copies (empty or equal to the previous default); distinct session /
// student links are preserved; both student notes keys + the mirror
// cache are updated for synced rows.
// C. Save-time Zoom validation: one shared rule (zoom.us hosts, https,
// meeting paths, bare 8-11 digit codes) at every save point; old
// stored values are never re-validated.
// D. Labels + architecture: "Join Zoom" launches (Waiting), "Start
// Class" starts (Running), launch is idempotent, a student joining
// Zoom cannot change LMS status (no Zoom API/webhook exists).
// Run from the repo root:  node test/zoom-workflow.test.mjs
// Requires: node >= 22.5 (node:sqlite).
// All teachers, schedules, and links below are SYNTHETIC test markers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

// The validator is a classic script that sets window.LmsZoomLinks.
globalThis.window = globalThis;
await import(pathToFileURL(path.join(REPO_ROOT, 'js/zoom-links.js')).href);
const ZoomLinks = globalThis.LmsZoomLinks;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zoomwf-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-secret-zoom-workflow';
const ORIGIN = 'https://alhuda-lms.vercel.app';

class FakeStatement {
  constructor(db, sql) { this._db = db; this._sql = sql; this._params = []; }
  bind(...params) { this._params = params; return this; }
  async all() { const results = this._db.prepare(this._sql).all(...this._params); return { results, success: true, meta: {} }; }
  async run() { const r = this._db.prepare(this._sql).run(...this._params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
  async first() { const row = this._db.prepare(this._sql).get(...this._params); return row === undefined ? null : row; }
}
class FakeD1 {
  constructor() { this._db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new FakeStatement(this._db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
  async exec(sql) { this._db.exec(sql); return { success: true }; }
  seed(sql, ...params) { this._db.prepare(sql).run(...params); }
  q(sql, ...params) { return this._db.prepare(sql).all(...params); }
  q1(sql, ...params) { const r = this._db.prepare(sql).get(...params); return r === undefined ? null : r; }
  close() { try { this._db.close(); } catch (e) {} }
}

const fakeDb = new FakeD1();
const baseEnv = { WORKER_AUTH_SECRET: WORKER_SECRET, DB: fakeDb };

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'TCH-T', role: 'teacher' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
};

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function call(url, { method = 'POST', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const req = new Request(url, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, baseEnv, {});
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, data };
}
const dbPost = (token, body) => call('https://worker.test/api/db', { token, body });

// ---- Setup -----------------------------------------------------------------
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', r.status === 200, r.text.slice(0, 200));
}
fakeDb.seed("INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)",
  'TCH-T', 'Teacher T', JSON.stringify({ salary_slips: {} }), 'Active');
fakeDb.seed("INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)",
  'TCH-MGR-1', 'Manager One', JSON.stringify({ employee_type: 'manager', salary_slips: {} }), 'Active');
const LOG = (id, sched, date, status) =>
  fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, status, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id, sched, 'STU-1', 'TCH-T', date, status, '');
LOG('LOG-COMP', 'SCH-1', '2026-10-29', 'Completed');
LOG('LOG-PRES', 'SCH-2', '2026-10-29', 'Present');
LOG('LOG-WAIT', 'SCH-3', '2026-10-29', 'Waiting');
LOG('LOG-SCHED', 'SCH-4', '2026-10-29', 'Scheduled');
const statusOf = (id) => { const r = fakeDb.q1('SELECT status FROM attendance_logs WHERE id = ?', id); return r && r.status; };

// ---- A. Server guard: upsert by id ------------------------------------------
{
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'upsert', values: { id: 'LOG-COMP', schedule_id: 'SCH-1', student_id: 'STU-1', teacher_id: 'TCH-T', class_date: '2026-10-29', status: 'Waiting' } });
  check('guard: teacher upsert Completed -> Waiting denied (403)', r.status === 403, r.text.slice(0, 200));
  check('guard: denied write lands nowhere (still Completed)', statusOf('LOG-COMP') === 'Completed');
}
{
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'upsert', values: { id: 'LOG-COMP', schedule_id: 'SCH-1', student_id: 'STU-1', teacher_id: 'TCH-T', class_date: '2026-10-29', status: 'Completed', remarks: 're-save' } });
  check('guard: teacher re-save Completed -> Completed allowed (200)', r.status === 200, r.text.slice(0, 200));
}
{
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'upsert', values: { id: 'LOG-PRES', schedule_id: 'SCH-2', student_id: 'STU-1', teacher_id: 'TCH-T', class_date: '2026-10-29', status: 'Completed' } });
  check('guard: legacy Present -> Completed allowed (within delivered set)', r.status === 200 && statusOf('LOG-PRES') === 'Completed', r.text.slice(0, 200));
}
{
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'upsert', values: { id: 'LOG-PRES', schedule_id: 'SCH-2', student_id: 'STU-1', teacher_id: 'TCH-T', class_date: '2026-10-29', status: 'Absent' } });
  check('guard: delivered -> Absent denied (403)', r.status === 403, r.text.slice(0, 200));
}
{
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'upsert', values: { id: 'LOG-WAIT', schedule_id: 'SCH-3', student_id: 'STU-1', teacher_id: 'TCH-T', class_date: '2026-10-29', status: 'Running' } });
  check('guard: Waiting -> Running allowed (normal flow)', r.status === 200 && statusOf('LOG-WAIT') === 'Running', r.text.slice(0, 200));
}
{
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'upsert', values: { id: 'LOG-SCHED', schedule_id: 'SCH-4', student_id: 'STU-1', teacher_id: 'TCH-T', class_date: '2026-10-29', status: 'Completed' } });
  check('guard: Scheduled -> Completed allowed (attendance modal flow)', r.status === 200 && statusOf('LOG-SCHED') === 'Completed', r.text.slice(0, 200));
}
{
  // Upsert resolved by schedule+date (no id) against a Completed row.
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'upsert', values: { schedule_id: 'SCH-1', student_id: 'STU-1', teacher_id: 'TCH-T', class_date: '2026-10-29', status: 'Leave' } });
  check('guard: schedule+date resolution denies Completed -> Leave (403)', r.status === 403, r.text.slice(0, 200));
}
{
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'upsert', values: { schedule_id: 'SCH-9', student_id: 'STU-1', teacher_id: 'TCH-T', class_date: '2026-10-29', status: 'Waiting' } });
  check('guard: brand-new row (no existing log) allowed', r.status === 200, r.text.slice(0, 200));
}
{
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'upsert', values: { student_id: 'STU-1', teacher_id: 'TCH-T', class_date: '2026-10-29', status: 'Waiting' } });
  check('guard: unresolvable row with a status change fails closed (403)', r.status === 403, r.text.slice(0, 200));
}

// ---- A2. Server guard: update path + roles -----------------------------------
{
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'update', values: { status: 'Leave' }, filters: [{ column: 'id', op: 'eq', value: 'LOG-COMP' }] });
  check('guard: teacher update Completed -> Leave denied (403)', r.status === 403, r.text.slice(0, 200));
  check('guard: update denial lands nowhere (still Completed)', statusOf('LOG-COMP') === 'Completed');
}
{
  const r = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'update', values: { remarks: 'note only' }, filters: [{ column: 'id', op: 'eq', value: 'LOG-COMP' }] });
  check('guard: remarks-only update on a Completed row allowed (no status touched)', r.status === 200, r.text.slice(0, 200));
}
{
  const r = await dbPost(TOK.manager, { table: 'attendance_logs', action: 'update', values: { status: 'Running' }, filters: [{ column: 'id', op: 'eq', value: 'LOG-COMP' }] });
  check('guard: manager update Completed -> Running denied (403)', r.status === 403, r.text.slice(0, 200));
}
{
  const r = await dbPost(TOK.owner, { table: 'attendance_logs', action: 'update', values: { status: 'Waiting' }, filters: [{ column: 'id', op: 'eq', value: 'LOG-COMP' }] });
  check('guard: owner update stays the repair path (200)', r.status === 200 && statusOf('LOG-COMP') === 'Waiting', r.text.slice(0, 200));
}

// ---- C. Shared validator (real js/zoom-links.js) ------------------------------
const validCases = [
  ['https://zoom.us/j/123456789', 'https://zoom.us/j/123456789'],
  ['https://us06web.zoom.us/j/4215?pwd=abc', null], // host + path ok (query kept)
  ['https://zoom.us/s/123456789', null],
  ['https://zoom.us/my/teacherroom', null],
  ['https://zoom.us/w/123456789', null],
  ['421567890', 'https://zoom.us/j/421567890'],
  ['', ''],
];
for (const [input, expected] of validCases) {
  const out = ZoomLinks.normalizeZoomInput(input);
  check(`validator: accepts "${input}"`, out.ok && (expected === null || out.normalized === expected), JSON.stringify(out));
}
const invalidCases = [
  'http://zoom.us/j/123456789',
  'https://meet.google.com/abc-def-ghi',
  'https://zoom.us.evil.com/j/123456789',
  'javascript:alert(1)',
  'https://zoom.us/x/123456789',
  'not a link at all',
  '12345',
  'https://zoom.us/',
];
for (const input of invalidCases) {
  const out = ZoomLinks.normalizeZoomInput(input);
  check(`validator: rejects "${input}"`, !out.ok && !!out.error, JSON.stringify(out));
}

// ---- B/C/D. Structural ---------------------------------------------------------
const TEACHERS = read('js/teachers.js');
const P360 = read('js/profiles360.js');
const SCHEDULE = read('js/schedule.js');
const FAMILIES = read('js/families.js');
const TEACHER = read('teacher.html');
const INDEX = read('index.html');
const PARENT = read('parent.html');
const WORKER = read('cloudflare/worker.js');

check('sync: compares against the previous default (oldZoomLink)',
  TEACHERS.includes('oldZoomLink') && TEACHERS.includes('isSyncedCopy'));
check('sync: blind schedule overwrite removed',
  !TEACHERS.includes(".update({ meeting_link: cleanLink })\n          .eq('teacher_id', teacherId)"));
check('sync: student update writes BOTH notes keys',
  TEACHERS.includes('parsed.meeting_link = cleanLink') && TEACHERS.includes('parsed.zoom_link = cleanLink'));
check('sync: student mirror cache updated for synced rows',
  TEACHERS.includes("profiles[s.id].meeting_link = cleanLink"));
check('sync: trials deliberately untouched (no trial overwrite)',
  TEACHERS.includes('Trial classes are deliberately NOT synced'));
check('teacher save: writes the zoom_link COLUMN on update + insert',
  TEACHERS.includes('working_shift, zoom_link') && TEACHERS.includes('rate_per_slot, working_shift, zoom_link, status'));
check('teacher save: validates the link before writing',
  TEACHERS.includes('normalizeZoomInput(zoom_link)'));
check('teacher save: sync receives the old default',
  TEACHERS.includes('syncTeacherZoomToAllStudents(editTeacherId, zoom_link, oldZoomLink)'));
check('360 save: validates + writes the column + passes the old default',
  P360.includes('normalizeZoomInput(zoom_link)') && P360.includes('rate_per_slot,\n      zoom_link') &&
  P360.includes('syncTeacherZoomToAllStudents(teacherId, zoom_link, oldZoomLink360)'));
check('360 reassignment: manual student link validated',
  P360.includes('normalizeZoomInput(inputZoom)'));
check('slot edit: session link validated + normalized value stored',
  SCHEDULE.includes('normalizeZoomInput(newZoom)') && SCHEDULE.includes('payload.meeting_link = newZoomChecked'));
check('student creation: manual link validated',
  FAMILIES.includes('normalizeZoomInput(zoomInputVal)'));
check('teacher schedule creation: custom link validated',
  TEACHER.includes('normalizeZoomInput(customZoom)') && TEACHER.includes('customZoomChecked || CURRENT_TEACHER.zoom_link'));
check('validator: loaded by admin + teacher portals',
  INDEX.includes('js/zoom-links.js') && TEACHER.includes('js/zoom-links.js'));
check('labels: Scheduled-branch Zoom button says Join Zoom (not Start Class)',
  TEACHER.includes("launchTeacherZoomClassById('${escapeJsAttr(c.id)}')") &&
  TEACHER.includes('<i class="fa-solid fa-video"></i> Join Zoom'));
check('labels: real Start buttons still say START CLASS',
  (TEACHER.match(/START CLASS/g) || []).length >= 4);
check('labels: student-list Zoom title says Join Zoom Class',
  TEACHER.includes('title="Join Zoom Class for'));
check('launch: https-only check + zoommtg deep link kept',
  TEACHER.includes('zoommtg://zoom.us/join') && TEACHER.includes("startsWith('https://')"));
check('launch: idempotent upsert on schedule+date',
  TEACHER.includes("onConflict: 'schedule_id,date'"));
check('server: delivered-transition guard wired for teacher/manager',
  WORKER.includes('attendanceDeliveredTransitionDenied') &&
  WORKER.includes("error: 'A completed session cannot be changed to another status.'"));
check('architecture: no Zoom API or webhook exists (student join cannot change status)',
  !WORKER.includes('api.zoom.us') && !TEACHER.includes('api.zoom.us') && !WORKER.includes('/api/zoom'));
check('parent: no attendance status writes (select-only by role)',
  !/from\('attendance_logs'\)\.(insert|update|upsert)/.test(PARENT));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
