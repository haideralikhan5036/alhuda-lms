// Batch 7 restore + loading test — Fix 2 (no teacher auto-restore) and
// Fix 3 (portal loading):
//  A) toggleSingleStudentDeactivate (REAL function, extracted from
//     js/profiles360.js) reactivating a student in a deactivated family:
//     family is reactivated FIRST, the student returns with
//     assigned_teacher_id NULL, residual schedules are deleted, the
//     notes archive (payroll proration memory) is preserved, and the
//     toast says no teacher is assigned.
//  B) submitEditSingleStudentForm (REAL function): a blank teacher field
//     on an inactive -> active edit stays NULL (no auto-substitution);
//     an explicitly chosen teacher is honoured as a manual assignment.
//  C) cloudflare-db.js probe recovery (REAL file in a vm): a failed
//     probe degrades to the mirror, is NOT retried inside the cooldown,
//     and IS retried after it — recovery fires 'alhuda-d1-live'.
//  D) Structural guards for the loading fixes (batch6d2 style).
// Run from the repo root:  node test/batch7-restore-loading.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const PROFILES = read('js/profiles360.js');
const CFDB = read('js/cloudflare-db.js');
const CONFIG = read('js/config.js');
const DASHBOARD = read('js/dashboard.js');
const TEACHER_HTML = read('teacher.html');
const MANAGER_HTML = read('manager.html');
const AUTH = read('js/auth.js');
const DBJS = read('functions/api/db.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6; // keep the async modifier
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// ---- Shared recording db stub -------------------------------------------------
function makeRecordingDb(calls) {
  function builder(table) {
    const b = {
      _action: null, _vals: null,
      select() { b._action = 'select'; return b; },
      update(vals) { b._action = 'update'; b._vals = vals; return b; },
      delete() { b._action = 'delete'; return b; },
      eq(col, val) {
        if (b._action === 'update') calls.push({ kind: 'update', table, values: b._vals, col, val });
        else if (b._action === 'delete') calls.push({ kind: 'delete', table, col, val });
        return b;
      },
      then(res) { res({ data: null, error: null }); },
    };
    return b;
  }
  return { from: (t) => builder(t) };
}
function makeLocalStorageStub(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    _data: data,
  };
}
const EXTRACTED = [
  extractFunction(PROFILES, '_parseStudentStructuredNotes'),
  extractFunction(PROFILES, '_saveStudentRecordBackend'),
  extractFunction(PROFILES, 'toggleSingleStudentDeactivate'),
  extractFunction(PROFILES, 'submitEditSingleStudentForm'),
].join('\n');
function buildProfilesSandbox({ windowObj, dbStub, localStorageStub, notifySink, documentStub }) {
  const factory = new Function(
    'window', 'db', 'localStorage', 'document', 'lmsConfirm', 'isFamilyDeactivated',
    'buildStudentDatabasePayload', 'syncFamilyStatusFromStudentsBackend', '_notify360',
    'openFamily360Profile', '_closeWorkspaceModal', 'validateEligibleTeacherBackend',
    EXTRACTED + '\nreturn { toggleSingleStudentDeactivate, submitEditSingleStudentForm };'
  );
  return factory(
    windowObj,
    dbStub,
    localStorageStub,
    documentStub || { getElementById: () => null },
    async () => true,
    (f) => ['inactive', 'deactivated'].includes(String((f && f.status) || '').toLowerCase()),
    (fields) => ({ dbPayload: fields, memRecord: fields }),
    async () => ({ familyStatus: 'Active', activeStudentCount: 1 }),
    (msg, type) => notifySink.push({ msg, type }),
    async () => {},
    () => {},
    async () => ({ valid: true })
  );
}

// ============================================================================
// A) Student toggle reactivation
// ============================================================================
{
  const calls = [];
  const notifySink = [];
  const student = {
    id: 'STU-1', family_id: 'FAM-1', name: 'Kid One', status: 'Inactive',
    assigned_teacher_id: null, course_id: 'Nazra Quran',
    notes: JSON.stringify({
      previous_teacher_id_before_deactivation: 'TCH-OLD',
      previous_teacher_name_before_deactivation: 'Old Teacher',
      archived_schedules_before_deactivation: [{ id: 'SCH-OLD', teacher_id: 'TCH-OLD' }],
      deactivation_date: '2026-10-01',
      family_deactivated: true,
    }),
  };
  const family = { id: 'FAM-1', parent_name: 'Fam One', status: 'Inactive', students: [student] };
  const windowObj = {
    ALL_STUDENTS: [student],
    ALL_TEACHERS: [{ id: 'TCH-OLD', full_name: 'Old Teacher' }],
    ALL_FAMILIES: [family],
    RAW_ALL_FAMILIES: [family],
    ALL_CLASS_SCHEDULES: [{ id: 'SCH-OLD', student_id: 'STU-1', teacher_id: 'TCH-OLD' }],
  };
  const ls = makeLocalStorageStub({ alhuda_student_profiles: JSON.stringify({ 'STU-1': { assigned_teacher_id: 'TCH-OLD' } }) });
  const api = buildProfilesSandbox({ windowObj, dbStub: makeRecordingDb(calls), localStorageStub: ls, notifySink });

  await api.toggleSingleStudentDeactivate('FAM-1', 'STU-1');

  const famUpdateIdx = calls.findIndex(c => c.kind === 'update' && c.table === 'families');
  const stuUpdateIdx = calls.findIndex(c => c.kind === 'update' && c.table === 'students');
  check('A: family row reactivated (explicit authorized action)', famUpdateIdx >= 0 && calls[famUpdateIdx].values.status === 'Active', JSON.stringify(calls).slice(0, 240));
  check('A: family-first order (family write precedes student write)', famUpdateIdx >= 0 && stuUpdateIdx > famUpdateIdx);
  const stuUpd = stuUpdateIdx >= 0 ? calls[stuUpdateIdx] : null;
  check('A: student saved Active', !!stuUpd && stuUpd.values.status === 'Active', stuUpd && JSON.stringify(stuUpd.values).slice(0, 160));
  check('A: student saved with assigned_teacher_id NULL (no auto-restore)', !!stuUpd && stuUpd.values.assigned_teacher_id === null, stuUpd && JSON.stringify(stuUpd.values).slice(0, 200));
  const savedNotes = stuUpd ? JSON.parse(stuUpd.values.notes) : {};
  check('A: notes archive PRESERVED (previous teacher + archived schedules kept for payroll)',
    savedNotes.previous_teacher_id_before_deactivation === 'TCH-OLD' && Array.isArray(savedNotes.archived_schedules_before_deactivation) && savedNotes.archived_schedules_before_deactivation.length === 1,
    JSON.stringify(savedNotes).slice(0, 200));
  check('A: deactivation meta cleared + reactivated_at stamped', savedNotes.family_deactivated === undefined && typeof savedNotes.reactivated_at === 'string');
  check('A: residual schedule rows deleted (F2.3)', calls.some(c => c.kind === 'delete' && c.table === 'class_schedules' && c.col === 'student_id' && c.val === 'STU-1'), JSON.stringify(calls).slice(0, 240));
  check('A: in-memory schedules filtered', windowObj.ALL_CLASS_SCHEDULES.length === 0);
  check('A: toast says NO teacher assigned', notifySink.some(n => String(n.msg).includes('No teacher assigned')), JSON.stringify(notifySink).slice(0, 200));
  const profiles = JSON.parse(ls._data.get('alhuda_student_profiles') || '{}');
  check('A: local profile cache synced to null teacher', profiles['STU-1'] && profiles['STU-1'].assigned_teacher_id === null);
}

// ============================================================================
// B) Edit-Student save
// ============================================================================
function editFormDocument(teacherValue) {
  const fields = {
    fwEditStuName: 'Kid Two', fwEditStuJoinDate: '2026-01-05', fwEditStuAge: '9',
    fwEditStuGender: 'Male', fwEditStuStatus: 'Active', fwEditStuCourse: 'Nazra Quran',
    fwEditStuTeacher: teacherValue, fwEditStuDays: '5 Days (Mon-Fri)', fwEditStuZoom: '',
  };
  return { getElementById: (id) => (id in fields ? { value: fields[id] } : null) };
}
async function runEditScenario(teacherValue) {
  const calls = [];
  const notifySink = [];
  const student = {
    id: 'STU-2', family_id: 'FAM-1', name: 'Kid Two', status: 'Inactive',
    assigned_teacher_id: null, course_id: 'Nazra Quran',
    notes: JSON.stringify({ previous_teacher_id_before_deactivation: 'TCH-OLD', days_per_week: '5 Days (Mon-Fri)' }),
  };
  const family = { id: 'FAM-1', parent_name: 'Fam One', status: 'Active', students: [student] };
  const windowObj = {
    ALL_STUDENTS: [student],
    ALL_TEACHERS: [{ id: 'TCH-OLD', full_name: 'Old Teacher' }, { id: 'TCH-NEW', full_name: 'New Teacher' }],
    ALL_FAMILIES: [family],
    RAW_ALL_FAMILIES: [family],
    ALL_CLASS_SCHEDULES: [{ id: 'SCH-LEFT', student_id: 'STU-2', teacher_id: 'TCH-OLD' }],
  };
  const api = buildProfilesSandbox({
    windowObj, dbStub: makeRecordingDb(calls), localStorageStub: makeLocalStorageStub(),
    notifySink, documentStub: editFormDocument(teacherValue),
  });
  await api.submitEditSingleStudentForm({ preventDefault() {} }, 'FAM-1', 'STU-2');
  return { calls, windowObj };
}
{
  const { calls } = await runEditScenario('');
  const stuUpd = calls.find(c => c.kind === 'update' && c.table === 'students');
  check('B: blank teacher on inactive->active edit stays NULL (no auto-substitution)', !!stuUpd && stuUpd.values.assigned_teacher_id === null, stuUpd && JSON.stringify(stuUpd.values).slice(0, 200));
  check('B: student status saved Active', !!stuUpd && stuUpd.values.status === 'Active');
  check('B: residual schedule rows deleted on the transition (F2.3)', calls.some(c => c.kind === 'delete' && c.table === 'class_schedules' && c.val === 'STU-2'));
}
{
  const { calls } = await runEditScenario('TCH-NEW');
  const stuUpd = calls.find(c => c.kind === 'update' && c.table === 'students');
  check('B: explicitly chosen teacher IS honoured (manual assignment preserved)', !!stuUpd && stuUpd.values.assigned_teacher_id === 'TCH-NEW', stuUpd && JSON.stringify(stuUpd.values).slice(0, 200));
}

// ============================================================================
// C) Probe recovery in cloudflare-db.js (vm)
// ============================================================================
{
  let fakeNow = 1_000_000;
  class FakeDate extends Date { static now() { return fakeNow; } }
  let probeAttempts = 0;
  const dispatched = [];
  async function mockFetch(url, options = {}) {
    const method = options.method || 'GET';
    if (method === 'GET') {
      probeAttempts++;
      if (probeAttempts === 1) throw new TypeError('network down');
      return { ok: true, status: 200, json: async () => ({ ok: true, d1_bound: true }) };
    }
    const body = JSON.parse(options.body || '{}');
    if (body.action === 'select' && body.table === 'teachers') {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'TCH-1', full_name: 'Live Teacher' }], error: null }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [], error: null }) };
  }
  const lsStub = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 };
  const sessionStub = { getItem: () => 'tok', setItem: () => {}, removeItem: () => {} };
  class FakeCustomEvent { constructor(type) { this.type = type; } }
  const windowObj = {
    localStorage: lsStub, sessionStorage: sessionStub,
    location: { hostname: 'test.local' },
    addEventListener: () => {},
    dispatchEvent: (ev) => { dispatched.push(ev && ev.type); return true; },
  };
  const sandbox = {
    window: windowObj, console, setTimeout, clearTimeout,
    localStorage: lsStub, sessionStorage: sessionStub,
    document: { addEventListener: () => {}, hidden: true },
    fetch: mockFetch, CustomEvent: FakeCustomEvent, Date: FakeDate,
    AbortController, Blob: class {}, URL: { createObjectURL: () => '' }, FileReader: class {},
  };
  sandbox.globalThis = sandbox;
  windowObj.window = windowObj;
  vm.runInNewContext(CFDB, sandbox);

  const r1 = await windowObj.db.from('teachers').select('*');
  check('C: failed probe -> mirror result (empty), no throw', Array.isArray(r1.data) && r1.data.length === 0, JSON.stringify(r1).slice(0, 120));
  check('C: client reports DEGRADED after failed probe', windowObj.isCloudflareD1Degraded() === true && windowObj.isCloudflareD1Live() === false);
  const r2 = await windowObj.db.from('teachers').select('*');
  check('C: inside the cooldown the probe is NOT retried (still mirror)', probeAttempts === 1 && Array.isArray(r2.data) && r2.data.length === 0, 'probeAttempts=' + probeAttempts);
  fakeNow += 6000; // past the 5 s cooldown
  const r3 = await windowObj.db.from('teachers').select('*');
  check('C: after the cooldown the probe IS retried and live data loads', probeAttempts === 2 && Array.isArray(r3.data) && r3.data.length === 1, 'probeAttempts=' + probeAttempts + ' ' + JSON.stringify(r3).slice(0, 120));
  check('C: client reports LIVE after recovery', windowObj.isCloudflareD1Live() === true);
  check("C: recovery fired the 'alhuda-d1-live' repaint event", dispatched.includes('alhuda-d1-live'), JSON.stringify(dispatched));
}

// ============================================================================
// D) Structural guards
// ============================================================================
check('D: profiles360 has no teacher-restore identifiers left', !PROFILES.includes('restoredTeacherId') && !PROFILES.includes('candidateTchId'));
check('D: profiles360 toast no longer celebrates a restore', !PROFILES.includes('restored to Teacher Student List'));
check('D: profiles360 toast states no teacher is assigned', PROFILES.includes('No teacher assigned — assign one manually when ready'));
check('D: engine guard present for insert/upsert AND update paths', (DBJS.match(/await familyRowIsDeactivated\(d1,/g) || []).length === 2, String((DBJS.match(/await familyRowIsDeactivated\(d1,/g) || []).length));
check('D: cloudflare-db has the named timeout + cooldown constants', CFDB.includes('D1_FETCH_TIMEOUT_MS = 12000') && CFDB.includes('D1_PROBE_RETRY_COOLDOWN_MS = 5000'));
check('D: cloudflare-db uses AbortController + online re-probe + live event', CFDB.includes('AbortController') && CFDB.includes("addEventListener('online'") && CFDB.includes('alhuda-d1-live') && CFDB.includes('window.isCloudflareD1Live'));
check('D: config core load settles branches with a timeout helper', CONFIG.includes('settleCoreBranch') && CONFIG.includes('CORE_BRANCH_TIMEOUT_MS'));
{
  const onloadStart = CONFIG.indexOf('window.onload = async function()');
  const onloadEnd = CONFIG.indexOf('function toggleSidebar()', onloadStart);
  const onloadSrc = CONFIG.slice(onloadStart, onloadEnd);
  check('D: boot awaits core before the dashboard (corePromise.then)', onloadSrc.includes('corePromise.then') && onloadSrc.includes('loadDashboardData()'));
  check('D: boot 60 s dashboard timer removed (single timer rule)', !onloadSrc.includes('60000'));
}
check('D: dashboard has run-guard + settled branches + pending state + live repaint',
  DASHBOARD.includes('_dashRunSeq') && DASHBOARD.includes('_dashLoadInflight') && DASHBOARD.includes('dashSettleBranch') && DASHBOARD.includes('paintDashboardPendingState') && DASHBOARD.includes("addEventListener('alhuda-d1-live'"));
check('D: teacher portal fetches in parallel + login resets the probe',
  TEACHER_HTML.includes('studentsPromise') && TEACHER_HTML.includes('profileRefreshPromise') && TEACHER_HTML.includes('advanceLogsPromise') && TEACHER_HTML.includes('resetCloudflareD1Availability'));
check('D: manager login resets the probe', MANAGER_HTML.includes('resetCloudflareD1Availability'));
{
  const gateStart = AUTH.indexOf('function getAuthenticatedManagerSession()');
  const gateSrc = AUTH.slice(gateStart, gateStart + 1800);
  check('D: manager gate validates the manager token role + expiry', gateSrc.includes('alhuda_manager_token') && gateSrc.includes("payload.role !== 'manager'") && gateSrc.includes('payload.exp'));
}

const failed = results.filter((x) => !x.pass);
console.log('---');
console.log(`batch7-restore-loading: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
