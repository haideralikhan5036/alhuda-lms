// Unified Lesson History — Worker scope tests (UNION teacher scope +
// lesson-image storage allowance). Drives the REAL cloudflare/worker.js
// against a fake D1 (node:sqlite) and a fake R2 bucket.
// Run from the repo root:  node test/lesson-history-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-history-worker-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-worker-auth-secret';
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
  close() { try { this._db.close(); } catch (e) {} }
}

class FakeR2 {
  constructor() { this._map = new Map(); }
  async get(key) {
    const v = this._map.get(key);
    if (!v) return null;
    return { body: v, httpMetadata: { contentType: 'image/png' }, httpEtag: '"fake-etag"' };
  }
  async put(key, body) { this._map.set(key, typeof body === 'string' ? body : 'bytes'); return { key }; }
}

const fakeDb = new FakeD1();
const fakeR2 = new FakeR2();
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: fakeDb, STORAGE: fakeR2 };

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function dbPost(token, body) {
  const req = new Request('https://worker.test/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

async function storageGet(token, key) {
  const req = new Request('https://worker.test/api/storage?key=' + encodeURIComponent(key), {
    headers: { 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
  });
  const res = await worker.fetch(req, env, {});
  return { status: res.status };
}

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  teacherNew: await createSessionToken({ sub: 'T-NEW', role: 'teacher' }, WORKER_SECRET),
  teacherOld: await createSessionToken({ sub: 'T-OLD', role: 'teacher' }, WORKER_SECRET),
  parent1: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
  parent2: await createSessionToken({ sub: 'FAM-2', role: 'parent' }, WORKER_SECRET),
};

// ---- Setup: schema boot + seeds ---------------------------------------------
{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', boot.status === 200, 'got ' + boot.status);
}
fakeDb.seed("INSERT INTO teachers (id, full_name) VALUES ('T-NEW', 'New Teacher')");
fakeDb.seed("INSERT INTO teachers (id, full_name) VALUES ('T-OLD', 'Old Teacher')");
fakeDb.seed("INSERT INTO teachers (id, full_name) VALUES ('T-THIRD', 'Third Teacher')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-2', 'Parent Two')");
// ST-1 shifted from T-OLD to T-NEW (assigned_teacher_id = T-NEW).
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES ('ST-1', 'FAM-1', 'Student One', 'T-NEW')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES ('ST-2', 'FAM-2', 'Student Two', 'T-THIRD')");
const IMG_OLD = 'scoped-teacher-T-OLD/lesson1.png';
const IMG_OTHER = 'scoped-teacher-T-THIRD/other.png';
fakeDb.seed(
  "INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status, lesson_notes, created_at) VALUES ('L-OLD', 'SC-1', 'ST-1', 'T-OLD', '2026-10-10', '2026-10-10', 'Completed', ?, '2026-10-10T09:00:00Z')",
  JSON.stringify({ book_title: 'Qaida', page: 5, remarks: 'old teacher record', image_key: IMG_OLD })
);
fakeDb.seed(
  "INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status, lesson_notes, created_at) VALUES ('L-NEW', 'SC-1', 'ST-1', 'T-NEW', '2026-10-12', '2026-10-12', 'Completed', ?, '2026-10-12T09:00:00Z')",
  JSON.stringify({ book_title: 'Qaida', page: 6, remarks: 'new teacher record' })
);
fakeDb.seed(
  "INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status, lesson_notes, created_at) VALUES ('L-OTHER', 'SC-2', 'ST-2', 'T-THIRD', '2026-10-11', '2026-10-11', 'Completed', ?, '2026-10-11T09:00:00Z')",
  JSON.stringify({ book_title: 'Quran', page: 3, remarks: 'other family', image_key: IMG_OTHER })
);
await fakeR2.put(IMG_OLD, 'fake-png-bytes-old');
await fakeR2.put(IMG_OTHER, 'fake-png-bytes-other');
await fakeR2.put('scoped-teacher-T-NEW/unrelated.png', 'unrelated-bytes');

async function logIds(token) {
  const r = await dbPost(token, { table: 'attendance_logs', action: 'select' });
  const rows = (r.data && r.data.data) || [];
  return { status: r.status, ids: rows.map((x) => x.id).sort() };
}

// ---- UNION scope -------------------------------------------------------------
{
  const tNew = await logIds(TOK.teacherNew);
  check('UNION: new teacher sees shifted student old-teacher log', tNew.ids.includes('L-OLD'), 'got ' + tNew.ids.join(','));
  check('UNION: new teacher sees own log', tNew.ids.includes('L-NEW'));
  check('UNION: new teacher does NOT see unassigned student log', !tNew.ids.includes('L-OTHER'), 'got ' + tNew.ids.join(','));

  const tOld = await logIds(TOK.teacherOld);
  check('UNION: old teacher KEEPS own log after shift', tOld.ids.includes('L-OLD'), 'got ' + tOld.ids.join(','));
  check('UNION: old teacher does NOT see new teacher log', !tOld.ids.includes('L-NEW'), 'got ' + tOld.ids.join(','));

  const p1 = await logIds(TOK.parent1);
  check('parent scope: own family logs incl. old-teacher log', p1.ids.includes('L-OLD') && p1.ids.includes('L-NEW'));
  check('parent scope: other family log excluded', !p1.ids.includes('L-OTHER'));

  // Writes stay own-record only: new teacher cannot mutate the old log.
  const upd = await dbPost(TOK.teacherNew, {
    table: 'attendance_logs', action: 'update',
    values: { status: 'Absent' }, filters: [{ column: 'id', op: 'eq', value: 'L-OLD' }]
  });
  const after = await dbPost(TOK.owner, { table: 'attendance_logs', action: 'select', filters: [{ column: 'id', op: 'eq', value: 'L-OLD' }] });
  const row = (after.data && after.data.data && after.data.data[0]) || null;
  check('writes: teacher update cannot touch another teacher log', row && row.status === 'Completed', 'status=' + (row && row.status));
}

// ---- Lesson-image storage allowance ------------------------------------------
{
  check('storage: owning parent reads old-teacher image', (await storageGet(TOK.parent1, IMG_OLD)).status === 200);
  check('storage: other family parent denied', (await storageGet(TOK.parent2, IMG_OLD)).status === 403);
  check('storage: assigned (new) teacher reads old-teacher image', (await storageGet(TOK.teacherNew, IMG_OLD)).status === 200);
  check('storage: old teacher reads own-prefix image', (await storageGet(TOK.teacherOld, IMG_OLD)).status === 200);
  check('storage: unassigned teacher denied other image', (await storageGet(TOK.teacherNew, IMG_OTHER)).status === 403);
  check('storage: owning parent (FAM-2) reads other image', (await storageGet(TOK.parent2, IMG_OTHER)).status === 200);
  check('storage: key-guessing denied (no referencing row)', (await storageGet(TOK.parent1, 'scoped-teacher-T-NEW/unrelated.png')).status === 403);
  check('storage: unreferenced key -> 403 (no existence leak)', (await storageGet(TOK.parent1, 'scoped-teacher-T-OLD/nope.png')).status === 403);
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\nlesson-history-worker: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
