// Batch 4 worker + static tests: B13 fake books, S8 fabricated Zoom links,
// S14 terminology, B14 parent leave (pending request pattern + parent scoping).
// Run from the repo root:  node test/batch4-books-zoom-leave.test.mjs
// Requires: node >= 22.5 (node:sqlite for the worker harness part).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ===========================================================================
// A. Static checks
// ===========================================================================
const curriculumData = read('curriculum_data.js');
const curriculumJs = read('js/curriculum.js');
const parentHtml = read('parent.html');
const teacherHtml = read('teacher.html');
const leavesJs = read('js/leaves.js');
const teachersJs = read('js/teachers.js');
const familiesJs = read('js/families.js');
const trialsJs = read('js/trials.js');
const profiles360 = read('js/profiles360.js');
const dashboardJs = read('js/dashboard.js');

// --- B13: allowlist present in ALL FOUR merge implementations ---------------
check('B13 allowlist defined in curriculum_data.js', curriculumData.includes('ALHUDA_BUILTIN_ALLOWLIST'));
check('B13 allowlist used in js/curriculum.js merge', curriculumJs.includes('ALHUDA_BUILTIN_ALLOWLIST'));
check('B13 allowlist used in parent.html merge', parentHtml.includes('ALHUDA_BUILTIN_ALLOWLIST'));
check('B13 allowlist used in teacher.html merge', teacherHtml.includes('ALHUDA_BUILTIN_ALLOWLIST'));
{
  const i = curriculumData.indexOf('getPageUrl');
  const body = curriculumData.slice(i, i + 900);
  check('B13 getPageUrl no longer falls through to the SVG generator', !body.includes('generateDynamicSvgDataUri') && body.includes("return '';"), body.slice(0, 120));
}

// --- S8: fabrication gone ----------------------------------------------------
for (const [name, src] of [['teachers.js', teachersJs], ['families.js', familiesJs], ['trials.js', trialsJs], ['profiles360.js', profiles360]]) {
  check(`S8 no fabricated zoom pattern in ${name}`,
    !src.includes('zoom.us/j/${') && !src.includes('pwd=alhuda_') && !src.includes('alhuda-class') && !src.includes('9876543210'));
}
check('S8 DEMO ROOM label gone everywhere', !teachersJs.includes('DEMO ROOM') && !familiesJs.includes('DEMO ROOM'));
check('S8 teacher card shows not-set text', teachersJs.includes('Class link not set yet'));
check('S8 parent portal shows not-set text', parentHtml.includes('Class link not set yet'));
check('S8 teacher portal shows not-set text', teacherHtml.includes('Class link not set yet'));
check('S8 old not-configured wording gone from portals', !teacherHtml.includes('Zoom meeting not configured') && !parentHtml.includes('Zoom meeting not configured'));
{
  const i = familiesJs.indexOf('function getCanonicalTeacherZoomLink');
  const body = familiesJs.slice(i, i + 2200);
  check('S8 getCanonicalTeacherZoomLink never fabricates', i >= 0 && !body.includes('zoom.us/j/') && !body.includes('pwd=alhuda_'), body.slice(0, 100));
}

// --- S14: terminology ---------------------------------------------------------
check('S14 old strings gone from parent.html',
  !parentHtml.includes('Sabaq Progress') && !parentHtml.includes('Qari / Ustadh') &&
  !parentHtml.includes('Sabaq / Topic') && !parentHtml.includes('Read Sabaq') &&
  !parentHtml.includes('Direct notification to Academy Ustadh'));
check('S14 old strings gone from teacher.html', !teacherHtml.includes('Sabaq logs') && !teacherHtml.includes('record Sabaq progress'));
check('S14 demo record renamed in dashboard.js', !dashboardJs.includes('Qari Abdul Rehman'));
check('S14 no Ustadh/Qari left in portals', !parentHtml.includes('Ustadh') && !teacherHtml.includes('Ustadh') && !parentHtml.includes('Qari /') && !teacherHtml.includes('Qari /'));

// --- B14: parent leave handler ------------------------------------------------
{
  const i = parentHtml.indexOf('async function handleLeaveRequestSubmit');
  const region = parentHtml.slice(i, i + 7000);
  check('B14 handler exists', i >= 0);
  check('B14 handler creates a PENDING request', region.includes("status: 'pending'"));
  check('B14 handler marks source parent', region.includes("source: 'parent'"));
  check('B14 handler writes leave_request', region.includes('leave_request'));
  check('B14 handler never writes the On Leave status', !region.includes("'On Leave'") && !region.includes('"On Leave"'));
  check('B14 handler drops the old leave_info write', !region.includes('leave_info'));
  check('B14 end-date field + validation present',
    parentHtml.includes('leaveEndDateInput') && region.includes('End date cannot be before the start date.') && region.includes('Start date cannot be in the past.'));
  check('B14 truthful success sentence present', region.includes('Your leave request has been sent to the administration for approval.'));
  check('B14 truthful failure text present', region.includes('could NOT be sent'));
  check('B14 false notification claim gone repo-wide in parent.html', !parentHtml.includes('notified in real time'));
  check('B14 parent request list view present', parentHtml.includes('Your Leave Requests') && parentHtml.includes('renderParentLeaveRequests'));
  check('B14 admin modal labels parent requests', leavesJs.includes('Parent Request') && leavesJs.includes('isParentRequest'));
  check('B14 modal subtitle is truthful', parentHtml.includes('Requests are reviewed by the administration.') && !parentHtml.includes('Academy Ustadh'));
}

// ===========================================================================
// B. Books — functional: curriculum_data.js merge with EMPTY tombstone
// ===========================================================================
{
  const store = new Map();
  const customs = [
    { id: 'custom-111', title: 'Qaida Noorania Eng', total_pages: 33, pages: ['https://x.test/p1', 'https://x.test/p2'] },
    { id: 'custom-222', title: 'Islamic Studies Grade 1', total_pages: 164, pages: ['https://x.test/a1'] },
    { id: 'custom-333', title: 'HOLY QURAN 16 LINE', total_pages: 549, pages: ['https://x.test/q1'] },
  ];
  store.set('alhuda_custom_books', JSON.stringify(customs));
  store.set('alhuda_deleted_books', '[]'); // tombstone EMPTIED on purpose
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const sandbox = { console, localStorage, sessionStorage: localStorage, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(curriculumData, sandbox, { filename: 'curriculum_data.js' });
  const books = sandbox.getAllAvailableBooks();
  const ids = books.map((b) => b.id);
  check('B13 functional: real custom books listed', ['custom-111', 'custom-222', 'custom-333'].every((id) => ids.includes(id)), ids.join(','));
  check('B13 functional: Interactive Qaida exception listed', ids.includes('interactive-madani-qaida'), ids.join(','));
  check('B13 functional: NO fake built-in listed with empty tombstone',
    !ids.includes('noorani-qaida') && !ids.includes('holy-quran-16-line') &&
    !ids.includes('tafseer-ibn-kathir-english') && !ids.includes('tafseer-bayan-ul-quran-urdu') &&
    !ids.includes('namaz-wudu-guide'), ids.join(','));
  check('B13 functional: exactly 4 books listed', books.length === 4, 'got ' + books.length);
  const fakeUrl = sandbox.CURRICULUM_DATA.getPageUrl('holy-quran-16-line', 5, 1, undefined);
  check('B13 functional: getPageUrl(fake book) returns empty, never an SVG', fakeUrl === '', JSON.stringify(fakeUrl).slice(0, 60));
  const realUrl = sandbox.CURRICULUM_DATA.getPageUrl('custom-111', 2, 1, undefined);
  check('B13 functional: getPageUrl(real book) returns the real page', realUrl === 'https://x.test/p2', String(realUrl));
  const missingUrl = sandbox.CURRICULUM_DATA.getPageUrl('custom-111', 99, 1, undefined);
  check('B13 functional: getPageUrl(missing real page) returns empty, never an SVG', missingUrl === '', JSON.stringify(missingUrl).slice(0, 60));
}

// ===========================================================================
// C. Worker — parent scoping for leave requests stored in students.notes
// ===========================================================================
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'batch4-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

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

const WORKER_SECRET = 'batch4-test-secret';
const ORIGIN = 'https://alhuda-lms.vercel.app';
const fakeDb = new FakeD1();
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: fakeDb };
const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  parentA: await createSessionToken({ sub: 'FAM-A', role: 'parent' }, WORKER_SECRET),
};

async function dbPost(token, body) {
  const req = new Request('https://worker.test/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, data };
}
const eqId = (v) => [{ column: 'id', op: 'eq', value: v }];
function rowOf(resp, id) {
  const rows = (resp.data && resp.data.data) || [];
  return (Array.isArray(rows) ? rows : [rows]).find((r) => r && String(r.id) === String(id)) || null;
}

{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('B14 setup: schema boot 200', boot.status === 200, 'got ' + boot.status);
}
fakeDb.seed('INSERT INTO families (id, parent_name, notes) VALUES (?, ?, ?)', 'FAM-A', 'Parent A', '{}');
fakeDb.seed('INSERT INTO families (id, parent_name, notes) VALUES (?, ?, ?)', 'FAM-B', 'Parent B', '{}');
fakeDb.seed('INSERT INTO students (id, family_id, name, status, notes) VALUES (?, ?, ?, ?, ?)', 'STU-A1', 'FAM-A', 'Child A1', 'Active', '{}');
fakeDb.seed('INSERT INTO students (id, family_id, name, status, notes) VALUES (?, ?, ?, ?, ?)', 'STU-B1', 'FAM-B', 'Child B1', 'Active', '{}');

const leaveNotes = JSON.stringify({
  leave_request: { id: 'REQ-TEST-1', student_id: 'STU-A1', student_name: 'Child A1', start_date: '2026-11-02', return_date: '2026-11-06', reason: 'Family Travel', notes: '', status: 'pending', requested_at: '2026-10-22T00:00:00.000Z', source: 'parent', parent_name: 'Parent A' },
  leave_history: [{ id: 'REQ-TEST-1', status: 'pending' }],
});

{
  // Parent A creates a pending leave request on their OWN child (notes only).
  const r = await dbPost(TOK.parentA, { table: 'students', action: 'update', values: { notes: leaveNotes }, filters: eqId('STU-A1') });
  check('B14 parent writes leave request on OWN child -> 200', r.status === 200, 'got ' + r.status);
  const own = await dbPost(TOK.owner, { table: 'students', action: 'select' });
  const stu = rowOf(own, 'STU-A1');
  check('B14 own child notes hold the pending request', !!stu && String(stu.notes).includes('REQ-TEST-1') && String(stu.notes).includes('"pending"'));
  check('B14 own child STATUS unchanged by the request', !!stu && stu.status === 'Active', stu && stu.status);
}
{
  // Parent A tries to write a leave request onto ANOTHER family's child.
  const evil = JSON.stringify({ leave_request: { id: 'REQ-EVIL', status: 'pending', source: 'parent' } });
  await dbPost(TOK.parentA, { table: 'students', action: 'update', values: { notes: evil }, filters: eqId('STU-B1') });
  const own = await dbPost(TOK.owner, { table: 'students', action: 'select' });
  const stuB = rowOf(own, 'STU-B1');
  check('B14 cross-family write does NOT land', !!stuB && !String(stuB.notes).includes('REQ-EVIL'), stuB && String(stuB.notes).slice(0, 60));
  // Parent A cannot READ the other family's child either.
  const read = await dbPost(TOK.parentA, { table: 'students', action: 'select', filters: eqId('STU-B1') });
  check('B14 cross-family read returns no row', !rowOf(read, 'STU-B1'));
  const readOwn = await dbPost(TOK.parentA, { table: 'students', action: 'select' });
  const rows = (readOwn.data && readOwn.data.data) || [];
  check('B14 parent select returns ONLY own children', Array.isArray(rows) && rows.length === 1 && String(rows[0].id) === 'STU-A1', JSON.stringify(rows).slice(0, 120));
}


// ===========================================================================
// D. Option B — date-scoped leave approval (derived window)
// ===========================================================================
{
  // Extract the REAL helper from js/leaves.js and exercise it.
  const start = leavesJs.indexOf('function isStudentOnLeaveNow');
  check('B-opt helper exists in js/leaves.js', start >= 0);
  let depth = 0, end = -1;
  for (let i = leavesJs.indexOf('{', start); i < leavesJs.length; i++) {
    if (leavesJs[i] === '{') depth++;
    if (leavesJs[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const helperSrc = leavesJs.slice(start, end);
  const isStudentOnLeaveNow = new Function(helperSrc + '; return isStudentOnLeaveNow;')();
  const T = '2026-10-22';
  const meta = (o) => Object.assign({ on_leave: true, leave_start_date: '2026-10-20', return_date: '2026-10-25' }, o || {});
  check('B-opt legacy stored Leave counts', isStudentOnLeaveNow({ status: 'Leave' }, null, T) === true);
  check('B-opt inside window = on leave', isStudentOnLeaveNow({ status: 'Active' }, meta(), T) === true);
  check('B-opt start day = on leave', isStudentOnLeaveNow({ status: 'Active' }, meta({ leave_start_date: T }), T) === true);
  check('B-opt future window = NOT yet', isStudentOnLeaveNow({ status: 'Active' }, meta({ leave_start_date: '2026-11-01', return_date: '2026-11-05' }), T) === false);
  check('B-opt return day = back automatically', isStudentOnLeaveNow({ status: 'Active' }, meta({ return_date: T }), T) === false);
  check('B-opt after window = not on leave', isStudentOnLeaveNow({ status: 'Active' }, meta({ return_date: '2026-10-21' }), T) === false);
  check('B-opt dateless on_leave = on leave (legacy-safe)', isStudentOnLeaveNow({ status: 'Active' }, { on_leave: true }, T) === true);
  check('B-opt on_leave false = not on leave', isStudentOnLeaveNow({ status: 'Active' }, meta({ on_leave: false }), T) === false);
  check('B-opt no meta + Active = not on leave', isStudentOnLeaveNow({ status: 'Active' }, null, T) === false);
  check('B-opt helper used at scan + tab sites', (leavesJs.match(/isStudentOnLeaveNow\(/g) || []).length >= 3);
  check('B-opt NO status: Leave write remains in leaves.js', !leavesJs.includes("status: 'Leave'") && !leavesJs.includes('status: "Leave"'));
  check('B-opt window wording in approve + mark alerts', (leavesJs.match(/starts and ends automatically/g) || []).length >= 2);
  check('B-opt Upcoming badge present', leavesJs.includes('Upcoming Leave'));
  // Teacher + parent use the same window rule.
  check('B-opt teacher isPortalStudentOnLeave is windowed',
    teacherHtml.includes('if (start && today < start) return false;') && teacherHtml.includes('if (ret && today >= ret) return false;'));
  check('B-opt parent status label helper present with window rule',
    parentHtml.includes('function parentStudentStatusLabel') && parentHtml.includes('on_leave'));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
process.exit(failed.length ? 1 : 0);
