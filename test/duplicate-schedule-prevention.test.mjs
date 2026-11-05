// Duplicate-schedule prevention (2026-11-05; investigation
// DUPLICATE-ASSIGNMENT-INVESTIGATION-2026-11-05 §4/§7). Root cause:
// class_schedules had no natural-key protection anywhere — the server
// minted a fresh id per booking request and never checked
// (student_id, teacher_id, day_of_week, start_time), and the browser
// mirror upserted its own locally-id'd copies over the server's rows.
// This suite drives the REAL Worker (which delegates /api/db to
// functions/api/db.js) plus execution/structural checks on the client
// twins. Run from the repo root:
//   node test/duplicate-schedule-prevention.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dedupe-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = ['test', 'worker', 'secret', '42'].join('-');
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
}
class FakeR2 {
  constructor() { this._map = new Map(); }
  async get(key) { const v = this._map.get(key); if (!v) return null; return { body: v, httpMetadata: { contentType: 'image/png' }, httpEtag: '"fake"' }; }
  async put(key, body) { this._map.set(key, typeof body === 'string' ? body : 'bytes'); return { key }; }
}

const fakeDb = new FakeD1();
const fakeR2 = new FakeR2();
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, DB: fakeDb, STORAGE: fakeR2 };

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function call(pathname, { token = null, body = null, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request('https://worker.test' + pathname, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}
const dbPost = (token, body) => call('/api/db', { token, body });
const eq = (column, value) => [{ column, op: 'eq', value }];

const TOK = {
  owner: await createSessionToken({ sub: 'Faheem', role: 'owner' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'T-A', role: 'teacher' }, WORKER_SECRET),
};

const schedRows = async (studentId) => {
  const r = await dbPost(TOK.owner, { table: 'class_schedules', action: 'select', filters: eq('student_id', studentId) });
  return (r.json && r.json.data) || [];
};
const bookingRow = (day, start = '09:00', end = '09:30', extra = {}) => ({
  student_id: 'ST-1', teacher_id: 'T-A', day_of_week: day,
  start_time: start, end_time: end, status: 'Active', ...extra,
});

// ---- setup ----
{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: schema boot -> 200', boot.status === 200, 'got ' + boot.status);
}
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-A', 'Teacher A', 'Active')");
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-B', 'Teacher B', 'Active')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id, status) VALUES ('ST-1', 'FAM-1', 'Child One', 'T-A', 'Active')");

// ---- the repro: same id-less booking insert twice ----
{
  const first = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(1), bookingRow(2)] });
  check('first booking insert lands (200)', first.status === 200, 'got ' + first.status + ' ' + first.text.slice(0, 120));
  check('two rows exist after the first insert', (await schedRows('ST-1')).length === 2);

  const second = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(1), bookingRow(2)] });
  check('REPRO: the identical second insert is rejected 409', second.status === 409, 'got ' + second.status);
  check('the 409 names the duplicate class', !!(second.json && second.json.error && /Duplicate class schedule/.test(second.json.error.message || '')), JSON.stringify(second.json).slice(0, 160));
  check('the 409 carries failedIndex 0 and no insertedIds', !!second.json && second.json.failedIndex === 0 && Array.isArray(second.json.insertedIds) && second.json.insertedIds.length === 0);
  check('still exactly two rows (nothing extra written)', (await schedRows('ST-1')).length === 2);
}

// ---- a batch that conflicts only on its second row writes NOTHING ----
{
  const batch = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(3), bookingRow(1)] });
  check('mixed batch (new Wed + duplicate Mon) is rejected 409', batch.status === 409, 'got ' + batch.status);
  check('failedIndex points at the duplicate row (1)', !!batch.json && batch.json.failedIndex === 1, JSON.stringify(batch.json).slice(0, 160));
  const rows = await schedRows('ST-1');
  check('the new Wed row did NOT land (batch writes nothing)', rows.length === 2 && !rows.some(r => Number(r.day_of_week) === 3), 'rows ' + rows.length);
}

// ---- within-batch duplicate ----
{
  const batch = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(4), bookingRow(4)] });
  check('within-batch duplicate (Thu twice, no ids) is rejected 409', batch.status === 409, 'got ' + batch.status);
  check('still exactly two rows', (await schedRows('ST-1')).length === 2);
}

// ---- upsert: the mirror-sync path ----
{
  const rowsBefore = await schedRows('ST-1');
  const monRow = rowsBefore.find(r => Number(r.day_of_week) === 1);
  const mirrorCopy = { ...bookingRow(1), id: 'SCH-LOCALCOPY1' };
  const up = await dbPost(TOK.owner, { table: 'class_schedules', action: 'upsert', values: [mirrorCopy] });
  check('mirror-copy upsert is accepted without error (200)', up.status === 200, 'got ' + up.status + ' ' + up.text.slice(0, 120));
  const after = await schedRows('ST-1');
  check('the mirror copy was SKIPPED (still two rows, local id absent)',
    after.length === 2 && !after.some(r => r.id === 'SCH-LOCALCOPY1'), 'rows ' + after.length);

  const replace = await dbPost(TOK.owner, { table: 'class_schedules', action: 'upsert', values: [{ ...bookingRow(1, '09:00', '09:45'), id: monRow.id }] });
  check('upsert with the SAME id still works (replace semantics)', replace.status === 200, 'got ' + replace.status);
  const afterReplace = await schedRows('ST-1');
  const monAfter = afterReplace.find(r => r.id === monRow.id);
  check('the same-id upsert updated the row (end 09:45), count unchanged',
    afterReplace.length === 2 && monAfter && String(monAfter.end_time).slice(0, 5) === '09:45',
    JSON.stringify(monAfter).slice(0, 140));
}

// ---- the teacher-token path carries the same guard ----
{
  const dup = await dbPost(TOK.teacher, { table: 'class_schedules', action: 'insert', values: [bookingRow(2)] });
  check('teacher-role duplicate insert is also rejected 409', dup.status === 409, 'got ' + dup.status);
  check('row count unchanged after the teacher attempt', (await schedRows('ST-1')).length === 2);
}

// ---- legitimate bookings stay legal ----
{
  const wed = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(3)] });
  check('legit: a different day inserts fine', wed.status === 200, 'got ' + wed.status);
  const later = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(1, '10:00', '10:30')] });
  check('legit: same day at a different start time inserts fine', later.status === 200, 'got ' + later.status);
  const otherTeacher = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(1, '09:00', '09:30', { teacher_id: 'T-B' })] });
  check('legit: same slot with a DIFFERENT teacher (transfer target) inserts fine', otherTeacher.status === 200, 'got ' + otherTeacher.status);

  const rowsNow = await schedRows('ST-1');
  const tbRow = rowsNow.find(r => r.teacher_id === 'T-B');
  const del = await dbPost(TOK.owner, { table: 'class_schedules', action: 'delete', filters: eq('id', tbRow.id) });
  check('setup: delete the other-teacher row', del.status === 200, 'got ' + del.status);
  const rebook = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(1, '09:00', '09:30', { teacher_id: 'T-B' })] });
  check('legit: re-booking after the original was deleted inserts fine', rebook.status === 200, 'got ' + rebook.status);

  const sixty = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(6, '09:00', '10:00', { duration_mins: 60 })] });
  check('legit: a single 60-minute row inserts fine', sixty.status === 200, 'got ' + sixty.status);

  const withSeconds = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(7, '09:00:00', '09:30:00')] });
  check("legit: a 'HH:MM:SS' start inserts fine on a fresh day", withSeconds.status === 200, 'got ' + withSeconds.status);
  const fiveChar = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: [bookingRow(7, '09:00', '09:30')] });
  check("format-proof: the same class spelled 'HH:MM' is a duplicate (409)", fiveChar.status === 409, 'got ' + fiveChar.status);
}

// ---- client twins: structural + execution ----
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
function extractFn(src, startMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) return null;
  let depth = 0; let begun = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; begun = true; }
    else if (src[i] === '}') { depth--; if (begun && depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}
{
  const shim = read('js/cloudflare-db.js');
  check('shim: syncLocalStoreToD1Once protects class_schedules via the natural-key fetch',
    shim.includes('fetchExistingD1ScheduleKeys') &&
    shim.includes("if (table === 'class_schedules')") &&
    shim.includes('existing.byKey.has(k)'));
  const keyFnSrc = extractFn(shim, 'function scheduleNaturalKeyOf(row)');
  check('shim: scheduleNaturalKeyOf extractable', !!keyFnSrc);
  if (keyFnSrc) {
    const keyOf = new Function(keyFnSrc + '; return scheduleNaturalKeyOf;')();
    check("shim key: '09:00' and '09:00:00' collide; day 2 and '2' collide",
      keyOf({ student_id: 'S', teacher_id: 'T', day_of_week: 2, start_time: '09:00' }) ===
      keyOf({ student_id: 'S', teacher_id: 'T', day_of_week: '2', start_time: '09:00:00' }));
    check('shim key: a different teacher is a different key',
      keyOf({ student_id: 'S', teacher_id: 'T', day_of_week: 2, start_time: '09:00' }) !==
      keyOf({ student_id: 'S', teacher_id: 'U', day_of_week: 2, start_time: '09:00' }));
    check('shim key: an incomplete row has no key (left to existing validation)',
      keyOf({ student_id: 'S', day_of_week: 2, start_time: '09:00' }) === null);
  }

  const sched = read('js/schedule.js');
  check('schedule.js: in-flight guard wraps the booking handler',
    sched.includes('_slotBookingInFlight') && sched.includes('await _handleConfirmSlotBookingImpl(e)'));
  const partStart = sched.indexOf('const alreadyBookedDays = [];');
  const partEnd = sched.indexOf('const conflictingDetails = [];');
  check('schedule.js: already-booked partition sits before the conflict computation',
    partStart > 0 && partEnd > partStart &&
    sched.indexOf('await fetchTeacherSchedules();', sched.indexOf('async function _handleConfirmSlotBookingImpl')) < partStart);
  if (partStart > 0 && partEnd > partStart) {
    const slice = sched.slice(partStart, partEnd);
    const runPartition = (schedules, targetDays) => {
      const notices = [];
      const fn = new Function('CURRENT_TEACHER_SCHEDULES', 'student_id', 'CURRENT_MATRIX_TEACHER', 'targetDays', 'ACTIVE_START_TIME', 'lmsNotify', 'DAY_NAMES',
        slice + '\nreturn { alreadyBookedDays, remainingDays };');
      const out = fn(schedules, 'ST-1', { id: 'T-A', full_name: 'Teacher A' }, targetDays, '09:00',
        (m) => notices.push(m), { 1: 'Mon', 2: 'Tue', 3: 'Wed' });
      return { out, notices };
    };
    const fixture = [
      { student_id: 'ST-1', teacher_id: 'T-A', day_of_week: 1, start_time: '09:00:00' },
      { student_id: 'ST-1', teacher_id: 'T-A', day_of_week: 2, start_time: '11:00' },
      { student_id: 'ST-9', teacher_id: 'T-A', day_of_week: 3, start_time: '09:00' },
    ];
    const partial = runPartition(fixture, [1, 2, 3]);
    check('partition: same student+teacher+day+start is already booked; other days remain',
      !!partial.out && partial.out.alreadyBookedDays.join() === '1' && partial.out.remainingDays.join() === '2,3',
      JSON.stringify(partial.out));
    const all = runPartition(fixture, [1]);
    check('partition: when every day is already booked it notifies and adds nothing',
      all.out === undefined && all.notices.length === 1 && /already booked with Teacher A/.test(all.notices[0]) && /nothing new was added/.test(all.notices[0]),
      JSON.stringify(all.notices));
  }

  const teacherHtml = read('teacher.html');
  check('teacher.html: in-flight guard + already-booked partition present',
    teacherHtml.includes('_teacherAddScheduleInFlight') &&
    teacherHtml.includes('const alreadyBookedDays = [];') &&
    teacherHtml.includes('const daysToCheck = [];') &&
    teacherHtml.includes('nothing new was added'));

  const trials = read('js/trials.js');
  const filterSrc = extractFn(trials, 'async function filterOutExistingScheduleRows(studentId, teacherId, rows)');
  check('trials.js: existing-row filter extractable and wired at both insert sites',
    !!filterSrc && (trials.match(/filterOutExistingScheduleRows\(/g) || []).length >= 3);
  if (filterSrc) {
    const existing = [
      { student_id: 'ST-1', teacher_id: 'T-A', day_of_week: 1, start_time: '09:00:00' },
      { student_id: 'ST-1', teacher_id: 'T-B', day_of_week: 2, start_time: '09:00' },
    ];
    const dbStub = { from: () => ({ select: () => ({ eq: async () => ({ data: existing, error: null }) }) }) };
    const filterFn = new Function('db', filterSrc + '; return filterOutExistingScheduleRows;')(dbStub);
    const candidate = [
      { student_id: 'ST-1', teacher_id: 'T-A', day_of_week: 1, start_time: '09:00' },
      { student_id: 'ST-1', teacher_id: 'T-A', day_of_week: 2, start_time: '09:00' },
      { student_id: 'ST-1', teacher_id: 'T-A', day_of_week: 3, start_time: '09:00' },
    ];
    const kept = await filterFn('ST-1', 'T-A', candidate);
    check('trials filter: drops the existing natural key (HH:MM vs HH:MM:SS), keeps other-teacher and new days',
      kept.length === 2 && kept.every(r => Number(r.day_of_week) !== 1), JSON.stringify(kept));
    const keptNone = await filterFn('ST-1', 'T-A', [candidate[0]]);
    check('trials filter: all-dropped yields an empty list (insert skipped by callers)', keptNone.length === 0);
  }
}

const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
