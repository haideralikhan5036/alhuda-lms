// Annotated Lesson Pages — Phase B: Worker read authorization.
// `isLessonImageKeyReadable` now also matches a key recorded in a row's
// `annotated_pages[].key`, with every existing scope rule unchanged
// (parent = own family only, teacher = own recordings UNION assigned
// students, authorization derives from the RECORD — never the key shape).
// Drives the REAL cloudflare/worker.js against a fake D1 (node:sqlite)
// and a fake R2 bucket, mirroring test/lesson-history-worker.test.mjs.
// Run from the repo root:  node test/annotated-pages-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'annotated-pages-worker-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
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
  close() { try { this._db.close(); } catch (e) {} }
}
class FakeR2 {
  constructor() { this._map = new Map(); }
  async get(key) {
    const v = this._map.get(key);
    if (!v) return null;
    return { body: v, httpMetadata: { contentType: 'image/webp' }, httpEtag: '"fake-etag"' };
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
async function health() {
  const req = new Request('https://worker.test/api/health', { headers: { 'Origin': ORIGIN } });
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

const TOK = {
  owner: await createSessionToken({ sub: 'Faheem', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
  teacherNew: await createSessionToken({ sub: 'T-NEW', role: 'teacher' }, WORKER_SECRET),
  teacherOld: await createSessionToken({ sub: 'T-OLD', role: 'teacher' }, WORKER_SECRET),
  teacherThird: await createSessionToken({ sub: 'T-THIRD', role: 'teacher' }, WORKER_SECRET),
  parent1: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
  parent2: await createSessionToken({ sub: 'FAM-2', role: 'parent' }, WORKER_SECRET),
};

// ---- Setup ------------------------------------------------------------------
{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', boot.status === 200, 'got ' + boot.status);
  const h = await health();
  check('health reports the annotated-pages release', h.status === 200 && h.data && h.data.version === '2026-11-07-manual-cycles', 'got ' + (h.data && h.data.version));
}
fakeDb.seed("INSERT INTO teachers (id, full_name) VALUES ('T-NEW', 'New Teacher')");
fakeDb.seed("INSERT INTO teachers (id, full_name) VALUES ('T-OLD', 'Old Teacher')");
fakeDb.seed("INSERT INTO teachers (id, full_name) VALUES ('T-THIRD', 'Third Teacher')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-2', 'Parent Two')");
// ST-1 (FAM-1) shifted from T-OLD to T-NEW; ST-2 (FAM-2) taught by T-THIRD.
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES ('ST-1', 'FAM-1', 'Student One', 'T-NEW')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES ('ST-2', 'FAM-2', 'Student Two', 'T-THIRD')");

// Annotated keys live under the RECORDING teacher's scoped prefix (T-OLD).
const ANN_1 = 'scoped-teacher-T-OLD/111_annotated_holy-quran_para2_page25_s1.webp';
const ANN_2 = 'scoped-teacher-T-OLD/222_annotated_holy-quran_para2_page26_s1.webp';
const LEGACY_IMG = 'scoped-teacher-T-OLD/legacy-photo.png';
const MENTIONED = 'scoped-teacher-T-OLD/333_annotated_holy-quran_para2_page27_s1.webp'; // named in remarks text only
const LOOKALIKE = 'scoped-teacher-T-OLD/999_annotated_holy-quran_para2_page25_s9.webp'; // in NO record
fakeDb.seed(
  "INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status, lesson_notes, created_at) VALUES ('L-ANN', 'SC-1', 'ST-1', 'T-OLD', '2026-11-06', '2026-11-06', 'Completed', ?, '2026-11-06T09:00:00Z')",
  JSON.stringify({
    book_id: 'holy-quran-16-line', book_title: 'Holy Quran', para: 2, page: 5, orig_page: 25,
    image_key: LEGACY_IMG,
    annotated_pages: [
      { key: ANN_1, para: 2, page: 5, orig_page: 25, seq: 1 },
      { key: ANN_2, para: 2, page: 6, orig_page: 26, seq: 2 }
    ]
  })
);
fakeDb.seed(
  "INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status, lesson_notes, created_at) VALUES ('L-TEXT', 'SC-1', 'ST-1', 'T-NEW', '2026-11-05', '2026-11-05', 'Completed', ?, '2026-11-05T09:00:00Z')",
  JSON.stringify({ book_title: 'Quran', page: 7, remarks: 'see the marked page at ' + MENTIONED + ' for revision' })
);
for (const k of [ANN_1, ANN_2, LEGACY_IMG, MENTIONED, LOOKALIKE]) await fakeR2.put(k, 'fake-webp-bytes');

// ---- Annotated-page read matrix ----------------------------------------------
{
  check('annotated: owning parent reads page 1', (await storageGet(TOK.parent1, ANN_1)).status === 200);
  check('annotated: owning parent reads page 2', (await storageGet(TOK.parent1, ANN_2)).status === 200);
  check('annotated: other-family parent denied', (await storageGet(TOK.parent2, ANN_1)).status === 403);
  check('annotated: assigned teacher (union scope) reads', (await storageGet(TOK.teacherNew, ANN_1)).status === 200);
  check('annotated: recording teacher reads (own recording, other prefix rule)', (await storageGet(TOK.teacherOld, ANN_2)).status === 200);
  check('annotated: unassigned teacher denied', (await storageGet(TOK.teacherThird, ANN_1)).status === 403);
  check('annotated: owner unrestricted', (await storageGet(TOK.owner, ANN_1)).status === 200);
  check('annotated: manager unrestricted', (await storageGet(TOK.manager, ANN_2)).status === 200);
  check('annotated: well-formed key in NO record denied (parent)', (await storageGet(TOK.parent1, LOOKALIKE)).status === 403);
  check('annotated: well-formed key in NO record denied (teacher)', (await storageGet(TOK.teacherNew, LOOKALIKE)).status === 403);
  check('annotated: key merely mentioned in remarks text denied (Phase-4 rule)', (await storageGet(TOK.parent1, MENTIONED)).status === 403);
  check('annotated: no token -> 401', (await storageGet('', ANN_1)).status === 401);
}

// ---- Legacy image_key behaviour unchanged -------------------------------------
{
  check('legacy: owning parent still reads image_key', (await storageGet(TOK.parent1, LEGACY_IMG)).status === 200);
  check('legacy: other-family parent still denied image_key', (await storageGet(TOK.parent2, LEGACY_IMG)).status === 403);
  check('legacy: assigned teacher still reads image_key', (await storageGet(TOK.teacherNew, LEGACY_IMG)).status === 200);
  check('legacy: unassigned teacher still denied image_key', (await storageGet(TOK.teacherThird, LEGACY_IMG)).status === 403);
}

const failed = results.filter((r) => !r.pass).length;
console.log('\nannotated-pages-worker: ' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
