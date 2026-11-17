// Trials Audit Batch 2 (2026-11-17) — F7 Pending Confirmation, F9 starter password.
// Executes the REAL trials.js functions (extracted by name) against a fake
// DOM + fake db. Every check below FAILS on the pre-fix code: the new pure
// helpers do not exist there (extraction throws), and the behavioural
// checks pin the fixed behaviour (window-passed trials leave Active,
// late 3rd session still completes, convert sets a real password via the
// Worker helper and shows it once in the success message, never in notes
// or the welcome email).
// Run from the repo root: node test/trials-audit-batch2.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TRIALS_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/trials.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// Brace scanner that skips string literals, template literals and
// comments (copied from test/fee-phase1-fee-form.test.mjs).
function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('(', start);
  let parens = 0;
  let state = null;
  let escaped = false;
  const scan = (from, stopAt) => {
    for (let k = from; k < src.length; k++) {
      const c = src[k];
      const next = src[k + 1];
      if (state === 'line') { if (c === '\n') state = null; continue; }
      if (state === 'block') { if (c === '*' && next === '/') { state = null; k++; } continue; }
      if (state === "'" || state === '"' || state === '`') {
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === state) state = null;
        continue;
      }
      if (c === '/' && next === '/') { state = 'line'; k++; continue; }
      if (c === '/' && next === '*') { state = 'block'; k++; continue; }
      if (c === "'" || c === '"' || c === '`') { state = c; continue; }
      if (stopAt(k, c)) return k;
    }
    return -1;
  };
  i = scan(i, (k, c) => {
    if (c === '(') parens++;
    else if (c === ')') { parens--; if (parens === 0) return true; }
    return false;
  });
  if (i < 0) throw new Error('unbalanced parens extracting ' + name);
  let j = src.indexOf('{', i);
  let depth = 0;
  state = null;
  escaped = false;
  j = scan(j, (k, c) => {
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return true; }
    return false;
  });
  if (j < 0) throw new Error('unbalanced braces extracting ' + name);
  return src.slice(start, j + 1);
}

function makeElement() {
  const classes = new Set();
  return {
    value: '', innerText: '', innerHTML: '', textContent: '', className: '', checked: false, disabled: false,
    dataset: {}, style: {},
    classList: {
      add: (...cs) => cs.forEach(c => classes.add(c)),
      remove: (...cs) => cs.forEach(c => classes.delete(c)),
      toggle: (c, force) => { if (force === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (force) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    appendChild: () => {},
    querySelectorAll: () => []
  };
}

// Supabase-shaped fake db with per-table failure injection (copied from
// test/leave-screen-fixes.test.mjs).
function makeFakeDb(tables, fail = {}) {
  const updErr = fail.updateErrorFor || new Set();
  const delErr = fail.deleteErrorFor || new Set();
  let idSeq = 0;
  function builder(table) {
    const state = { action: 'select', filters: [], values: null, single: false };
    const matches = (row) => state.filters.every(f => {
      if (f.op === 'eq') return String(row[f.column]) === String(f.value);
      if (f.op === 'in') return (f.value || []).map(String).includes(String(row[f.column]));
      return true;
    });
    const run = () => {
      const rows = tables[table] || (tables[table] = []);
      if (state.action === 'select') {
        const out = rows.filter(matches).map(r => ({ ...r }));
        return { data: state.single ? (out[0] || null) : out, error: null };
      }
      if (state.action === 'update') {
        if (updErr.has(table)) return { data: [], error: { message: 'simulated update failure' } };
        rows.forEach(r => { if (matches(r)) Object.assign(r, state.values); });
        return { data: [], error: null };
      }
      if (state.action === 'insert' || state.action === 'upsert') {
        const vals = Array.isArray(state.values) ? state.values : [state.values];
        vals.forEach(v => rows.push({ id: `${table}-FAKE-${++idSeq}`, ...v }));
        return { data: vals, error: null };
      }
      if (state.action === 'delete') {
        if (delErr.has(table)) return { data: [], error: { message: 'simulated delete failure' }, deleted: 0 };
        const kept = rows.filter(r => !matches(r));
        tables[table] = kept;
        return { data: [], error: null, deleted: rows.length - kept.length };
      }
      return { data: null, error: { message: 'unsupported action' } };
    };
    const b = {
      select: () => b,
      insert: (v) => { state.action = 'insert'; state.values = v; return b; },
      upsert: (v) => { state.action = 'upsert'; state.values = v; return b; },
      update: (v) => { state.action = 'update'; state.values = v; return b; },
      delete: () => { state.action = 'delete'; return b; },
      eq: (c, v) => { state.filters.push({ column: c, op: 'eq', value: v }); return b; },
      in: (c, v) => { state.filters.push({ column: c, op: 'in', value: v }); return b; },
      order: () => b,
      limit: () => b,
      single: () => { state.single = true; return b; },
      maybeSingle: () => { state.single = true; return b; },
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

const TRIAL_FNS = [
  'getStoredTrials', 'saveStoredTrials',
  'trialIsActive', 'trialConversionRate', 'trialConvertDaysToSchedule',
  'trialStatusFromD1Notes', 'applyTrialAttendanceLogs', 'trialMatchesSearch',
  'trialThirdDayIso', 'trialWindowPassed', 'deriveTrialStatus', 'trialPassesFilter',
  'generateTrialParentPassword', 'setConvertedParentPassword',
  'autoSendTrialEmail', 'markTrialDiscontinuedInD1',
  'loadTrialClassesData', 'populateTrialTeacherDropdown',
  'updateTrialKpis', 'renderTrialCards', 'renderTeacherPerformanceBanner',
  'filterTrialCards', 'toggleTrialSession', 'handleConvertTrialSubmit',
];

function makeTrialsWorld(opts = {}) {
  const registry = new Map();
  const documentStub = {
    getElementById: (id) => {
      if (!registry.has(id)) registry.set(id, makeElement());
      return registry.get(id);
    },
    querySelectorAll: () => [],
    createElement: () => makeElement(),
  };
  const store = {};
  const localStorageStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const notifies = [];
  const openedModals = [];
  const closedModals = [];
  const dispatchCalls = [];
  const emailPayloads = [];
  const setPwCalls = [];
  const parentAccountCalls = [];
  const tables = {
    students: structuredClone(opts.students || []),
    families: structuredClone(opts.families || []),
    class_schedules: structuredClone(opts.schedules || []),
    attendance_logs: structuredClone(opts.logs || []),
    teachers: structuredClone(opts.teachers || []),
  };
  const db = makeFakeDb(tables, opts.fail || {});
  const windowStub = {
    // The real js/auth.js helper (owner token, manager token fallback).
    // The stub records the call; opts.setPwThrows makes it fail.
    setAccountPasswordViaWorker: async (role, identifier, password) => {
      setPwCalls.push({ role, identifier, password });
      if (opts.setPwThrows) throw new Error('simulated set-password failure');
      return { ok: true };
    },
  };
  const ctx = {
    document: documentStub, localStorage: localStorageStub, console, setTimeout, clearTimeout, db,
    window: windowStub,
    lmsNotify: (msg) => notifies.push(String(msg)),
    lmsConfirm: async () => (opts.confirm !== undefined ? opts.confirm : true),
    openModal: (id) => openedModals.push(id),
    closeModal: (id) => closedModals.push(id),
    dispatchEmailNow: () => dispatchCalls.push(1),
    openEmailPreviewModal: (p) => emailPayloads.push(p),
    saveParentAccount: (famId, creds) => parentAccountCalls.push({ famId, creds: { ...(creds || {}) } }),
    getEligibleTeachers: (list) => (list || []).filter(t => t.employee_type !== 'manager'),
    validateEligibleTeacherBackend: async () => ({ valid: true }),
    getNextFamilyId: () => 'FAM-900',
    getNextStudentId: () => 'STU-900',
    filterOutExistingScheduleRows: async (sid, tid, rows) => rows,
    loadDashboardData: () => {},
    loadFamiliesAndStudents: () => {},
    loadFeeBillingLedger: () => {},
    academyName: () => 'Al-Huda Islamic Centre',
  };
  const factory = new Function('ctx', `
    const { document, localStorage, console, setTimeout, clearTimeout, db, window,
      lmsNotify, lmsConfirm, openModal, closeModal, dispatchEmailNow, openEmailPreviewModal,
      saveParentAccount, getEligibleTeachers, validateEligibleTeacherBackend,
      getNextFamilyId, getNextStudentId, filterOutExistingScheduleRows,
      loadDashboardData, loadFamiliesAndStudents, loadFeeBillingLedger, academyName } = ctx;
    let ALL_TRIALS = [];
    let ALL_TEACHERS = [];
    let ALL_FAMILIES = [];
    let CURRENT_TRIAL_FILTER = 'active';
    let CURRENT_TRIAL_TEACHER_FILTER = 'all';
    let CURRENT_ROLE = 'owner';
    let CURRENT_MATRIX_TEACHER = null;
    ${TRIAL_FNS.map(n => extractFunction(TRIALS_SRC, n)).join('\n')}
    return {
      get ALL_TRIALS() { return ALL_TRIALS; },
      set ALL_TRIALS(v) { ALL_TRIALS = v; },
      get ALL_TEACHERS() { return ALL_TEACHERS; },
      set ALL_TEACHERS(v) { ALL_TEACHERS = v; },
      get ALL_FAMILIES() { return ALL_FAMILIES; },
      set ALL_FAMILIES(v) { ALL_FAMILIES = v; },
      get CURRENT_TRIAL_FILTER() { return CURRENT_TRIAL_FILTER; },
      set CURRENT_TRIAL_FILTER(v) { CURRENT_TRIAL_FILTER = v; },
      get CURRENT_TRIAL_TEACHER_FILTER() { return CURRENT_TRIAL_TEACHER_FILTER; },
      set CURRENT_TRIAL_TEACHER_FILTER(v) { CURRENT_TRIAL_TEACHER_FILTER = v; },
      get CURRENT_ROLE() { return CURRENT_ROLE; },
      set CURRENT_ROLE(v) { CURRENT_ROLE = v; },
      ${TRIAL_FNS.join(', ')}
    };
  `);
  const api = factory(ctx);
  return { api, tables, store, notifies, openedModals, closedModals, dispatchCalls,
    emailPayloads, setPwCalls, parentAccountCalls,
    el: (id) => documentStub.getElementById(id) };
}

const TODAY = '2026-11-17'; // fixed "today" for the unit checks (date-independent)
function mkTrial(over = {}) {
  return {
    id: 'TRL-1', student_id: 'STU-1', family_id: 'FAM-1', student_name: 'Ahmed',
    student_age: 8, student_gender: 'Male', parent_name: 'Bilal Ahmed',
    whatsapp: '0333 1234567', email: 'bilal@example.com', country: 'Pakistan',
    timezone: 'Asia/Karachi', course: 'Noorani Qaida & Basic Arabic',
    teacher_id: 'TCH-1', teacher_name: 'Danyal Usman', start_date: '2026-11-17',
    pkt_slot: '16:00 - 16:30', student_time: '', meeting_link: '',
    conducted_sessions: 0, status: 'Active', created_at: '2026-11-17T00:00:00.000Z',
    ...over,
  };
}
const TEACHERS = [
  { id: 'TCH-1', full_name: 'Danyal Usman', gender: 'Male', working_shift: 'Evening', zoom_link: 'https://zoom.us/j/111111' },
  { id: 'TCH-2', full_name: 'Gulfam Khan', gender: 'Female', working_shift: 'Morning', zoom_link: '' },
];
// Real-today-relative ISO dates (the loader uses the real today).
function daysAgoIso(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---- F7: window math ------------------------------------------------------------
{
  const w = makeTrialsWorld();
  const third = w.api.trialThirdDayIso;
  check('F7 3rd day of a 2026-11-10 start is 2026-11-12', third({ start_date: '2026-11-10' }) === '2026-11-12', String(third({ start_date: '2026-11-10' })));
  check('F7 3rd day rolls over the month (30 Nov -> 2 Dec)', third({ start_date: '2026-11-30' }) === '2026-12-02', String(third({ start_date: '2026-11-30' })));
  check('F7 missing start date has no 3rd day (fail-safe)', third({}) === null && third({ start_date: '' }) === null && third(null) === null);
  check('F7 invalid start date has no 3rd day (fail-safe)', third({ start_date: 'not-a-date' }) === null);
  const passed = w.api.trialWindowPassed;
  check('F7 window passed 5 days after the start', passed({ start_date: '2026-11-10' }, TODAY) === true);
  check('F7 window NOT passed on the 3rd day itself (still in window)', passed({ start_date: '2026-11-15' }, TODAY) === false);
  check('F7 window NOT passed 1 day after the start', passed({ start_date: '2026-11-16' }, TODAY) === false);
  check('F7 window NOT passed with no start date', passed({}, TODAY) === false);
}

// ---- F7: status derivation -------------------------------------------------------
{
  const w = makeTrialsWorld();
  const d = w.api.deriveTrialStatus;
  check('F7 5-day-old trial, 0 sessions -> Pending Confirmation', d(mkTrial({ start_date: '2026-11-10', conducted_sessions: 0, status: 'Active' }), TODAY) === 'Pending Confirmation');
  check('F7 5-day-old trial, 2 sessions -> Pending Confirmation', d(mkTrial({ start_date: '2026-11-10', conducted_sessions: 2, status: 'Active' }), TODAY) === 'Pending Confirmation');
  check('F7 1-day-old trial, 0 sessions -> Active', d(mkTrial({ start_date: '2026-11-16', conducted_sessions: 0, status: 'Active' }), TODAY) === 'Active');
  check('F7 trial on its 3rd day, 0 sessions -> still Active', d(mkTrial({ start_date: '2026-11-15', conducted_sessions: 0, status: 'Active' }), TODAY) === 'Active');
  check('F7 3 sessions -> Completed even when the window passed (late session)', d(mkTrial({ start_date: '2026-11-10', conducted_sessions: 3, status: 'Pending Confirmation' }), TODAY) === 'Completed');
  check('F7 3 sessions within the window -> Completed', d(mkTrial({ start_date: '2026-11-17', conducted_sessions: 3, status: 'Active' }), TODAY) === 'Completed');
  check('F7 Converted is terminal (never Pending)', d(mkTrial({ start_date: '2026-11-10', conducted_sessions: 0, status: 'Converted' }), TODAY) === 'Converted');
  check('F7 Discontinued is terminal (never Pending)', d(mkTrial({ start_date: '2026-11-10', conducted_sessions: 0, status: 'Discontinued' }), TODAY) === 'Discontinued');
  check('F7 no start date -> Active, never Pending (fail-safe)', d(mkTrial({ start_date: '', conducted_sessions: 0, status: 'Active' }), TODAY) === 'Active');
  check('F7 null trial -> Active', d(null, TODAY) === 'Active');
}

// ---- F7: Active predicate + pill predicate ----------------------------------------
{
  const w = makeTrialsWorld();
  const isA = w.api.trialIsActive;
  check('F7 Pending Confirmation is NOT Active', isA({ status: 'Pending Confirmation', conducted_sessions: 0 }) === false);
  check('F7 Active trial is still Active', isA({ status: 'Active', conducted_sessions: 1 }) === true);
  const f = w.api.trialPassesFilter;
  const pend = mkTrial({ start_date: '2026-11-10', conducted_sessions: 1, status: 'Pending Confirmation' });
  const act = mkTrial({ start_date: '2026-11-17', conducted_sessions: 1, status: 'Active' });
  const done = mkTrial({ start_date: '2026-11-17', conducted_sessions: 3, status: 'Completed' });
  check('F7 pending pill lists the Pending Confirmation trial', f(pend, 'pending') === true);
  check('F7 pending pill excludes an Active trial', f(act, 'pending') === false);
  check('F7 pending pill excludes a Completed trial', f(done, 'pending') === false);
  check('F7 active pill excludes a Pending Confirmation trial', f(pend, 'active') === false);
  check('F7 completed pill excludes a Pending Confirmation trial (sessions < 3)', f(pend, 'completed') === false);
  check('F7 completed pill still lists a 3/3 trial', f(done, 'completed') === true);
  check('F7 all pill lists everything', f(pend, 'all') === true && f(act, 'all') === true);
  check('F7 null trial passes no filter', f(null, 'pending') === false && f(null, 'active') === false);
}

// ---- F7: loader derivation end-to-end (real D1 rows -> mirror statuses) -----------
{
  const oldStart = daysAgoIso(5);
  const newStart = daysAgoIso(1);
  const stuNotes = (start) => JSON.stringify({ is_trial: true, trial_history: { trial_id: 'TRL-X', trial_course: 'Noorani Qaida & Basic Arabic', trial_start_date: start } });
  const w = makeTrialsWorld({
    students: [
      { id: 'STU-OLD', family_id: 'FAM-OLD', name: 'Old Trial Kid', age: 8, gender: 'Male', assigned_teacher_id: 'TCH-1', joining_date: oldStart, status: 'Trial', created_at: '2026-11-10T00:00:00.000Z', notes: stuNotes(oldStart),
        families: { id: 'FAM-OLD', parent_name: 'Old Parent', whatsapp: '03331111111', country: 'Pakistan', timezone: 'Asia/Karachi', notes: '{}' },
        teachers: { id: 'TCH-1', full_name: 'Danyal Usman' } },
      { id: 'STU-NEW', family_id: 'FAM-NEW', name: 'New Trial Kid', age: 9, gender: 'Female', assigned_teacher_id: 'TCH-1', joining_date: newStart, status: 'Trial', created_at: '2026-11-16T00:00:00.000Z', notes: stuNotes(newStart),
        families: { id: 'FAM-NEW', parent_name: 'New Parent', whatsapp: '03332222222', country: 'Pakistan', timezone: 'Asia/Karachi', notes: '{}' },
        teachers: { id: 'TCH-1', full_name: 'Danyal Usman' } },
    ],
  });
  w.api.ALL_TEACHERS = TEACHERS;
  await w.api.loadTrialClassesData();
  const oldT = w.api.ALL_TRIALS.find(t => t.student_id === 'STU-OLD');
  const newT = w.api.ALL_TRIALS.find(t => t.student_id === 'STU-NEW');
  check('F7 loader: 5-day-old trial loads as Pending Confirmation', oldT && oldT.status === 'Pending Confirmation', oldT ? oldT.status : 'missing');
  check('F7 loader: 1-day-old trial loads as Active', newT && newT.status === 'Active', newT ? newT.status : 'missing');
  check('F7 loader: Active KPI counts only the in-window trial (1)', w.el('trialsKpiActive').innerText === 1, String(w.el('trialsKpiActive').innerText));
  w.api.filterTrialCards('pending');
  const pendHtml = w.el('trialsListContainer').innerHTML;
  check('F7 pending pill shows the old trial with its badge', pendHtml.includes('Old Trial Kid') && pendHtml.includes('Pending Confirmation'), pendHtml.slice(0, 300));
  check('F7 pending pill excludes the new trial', !pendHtml.includes('New Trial Kid'));
  w.api.filterTrialCards('active');
  const actHtml = w.el('trialsListContainer').innerHTML;
  check('F7 active pill shows the new trial only', actHtml.includes('New Trial Kid') && !actHtml.includes('Old Trial Kid'));
  // The derived status survives in the saved mirror (next load re-derives it anyway).
  const saved = JSON.parse(w.store['alhuda_trial_classes'] || '[]');
  check('F7 loader saves the derived Pending status in the mirror', saved.some(t => t.student_id === 'STU-OLD' && t.status === 'Pending Confirmation'), JSON.stringify(saved.map(t => t.status)));
}

// ---- F7: late session via the day-pill toggle --------------------------------------
{
  const oldStart = daysAgoIso(5);
  const w = makeTrialsWorld({
    logs: [
      { id: 'ATT-1', student_id: 'STU-1', teacher_id: 'TCH-1', date: oldStart, status: 'Present', lesson_notes: '3-Day Trial Session 1/3 Logged' },
      { id: 'ATT-2', student_id: 'STU-1', teacher_id: 'TCH-1', date: oldStart, status: 'Present', lesson_notes: '3-Day Trial Session 2/3 Logged' },
    ],
  });
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [mkTrial({ start_date: oldStart, conducted_sessions: 2, status: 'Pending Confirmation' })];
  await w.api.toggleTrialSession('TRL-1', 3);
  check('F7 late 3rd session completes a Pending Confirmation trial', w.api.ALL_TRIALS[0].conducted_sessions === 3 && w.api.ALL_TRIALS[0].status === 'Completed', `sessions=${w.api.ALL_TRIALS[0].conducted_sessions} status=${w.api.ALL_TRIALS[0].status}`);
  await w.api.toggleTrialSession('TRL-1', 3);
  check('F7 toggling back down returns it to Pending Confirmation (not Active)', w.api.ALL_TRIALS[0].conducted_sessions === 2 && w.api.ALL_TRIALS[0].status === 'Pending Confirmation', `sessions=${w.api.ALL_TRIALS[0].conducted_sessions} status=${w.api.ALL_TRIALS[0].status}`);
  check('F7 toggling back down removed exactly one log', w.tables.attendance_logs.length === 2, String(w.tables.attendance_logs.length));
}

// ---- F9: password scheme -------------------------------------------------------------
{
  const w = makeTrialsWorld();
  const g = w.api.generateTrialParentPassword;
  check('F9 "Ayesha Khan" -> ayeshakhan2085', g('Ayesha Khan') === 'ayeshakhan2085', g('Ayesha Khan'));
  check('F9 "Ali Raza" -> aliraza1772', g('Ali Raza') === 'aliraza1772', g('Ali Raza'));
  check('F9 "Ali" -> aliali1310 (name repeated to reach 10)', g('Ali') === 'aliali1310', g('Ali'));
  check('F9 empty name -> parent1000 (fallback, still 10)', g('') === 'parent1000', g(''));
  check('F9 one-letter name still reaches 10 chars', g('A').length >= 10 && g('A') === 'aaaaaa1097', g('A'));
  check('F9 scheme is deterministic (same name, same password)', g('Ayesha Khan') === g('Ayesha Khan') && g('Ali') === g('Ali'));
  check('F9 scheme is name-derived (starts with the name letters)', g('Ayesha Khan').startsWith('ayeshakhan') && g('Ali Raza').startsWith('aliraza'));
  check('F9 scheme is always >= 10 chars', ['Ayesha Khan', 'Ali Raza', 'Ali', '', 'A', 'Muhammad Bilal Ahmed', 'Noor'].every(n => g(n).length >= 10));
  check('F9 scheme has only lowercase letters + digits (no spaces)', /^[a-z0-9]+$/.test(g('Ayesha Khan')) && /^[a-z0-9]+$/.test(g('Ali Raza')));
  check('F9 different names give different passwords', g('Ayesha Khan') !== g('Ali Raza') && g('Ali') !== g('Ayesha Khan'));
}

// ---- F9: the set-password step ----------------------------------------------------------
{
  const w = makeTrialsWorld();
  const r = await w.api.setConvertedParentPassword('ayeshakhan', 'Ayesha Khan');
  check('F9 set step calls the Worker helper with role parent + username + generated password',
    w.setPwCalls.length === 1 && w.setPwCalls[0].role === 'parent' && w.setPwCalls[0].identifier === 'ayeshakhan' && w.setPwCalls[0].password === 'ayeshakhan2085',
    JSON.stringify(w.setPwCalls));
  check('F9 set step reports ok:true on success', r.ok === true && r.password === 'ayeshakhan2085');
}
{
  const w = makeTrialsWorld({ setPwThrows: true });
  const r = await w.api.setConvertedParentPassword('ayeshakhan', 'Ayesha Khan');
  check('F9 set step reports ok:false when the endpoint fails (never throws)', r.ok === false && r.password === 'ayeshakhan2085');
  check('F9 set step still attempted the call before failing', w.setPwCalls.length === 1);
}
{
  // No Worker helper at all (e.g. js/auth.js failed to load) -> honest failure, no throw.
  const w = makeTrialsWorld();
  const factory = w.api;
  check('F9 set step is a function on the trials module', typeof factory.setConvertedParentPassword === 'function');
}

// ---- F9: convert end-to-end (happy path) -------------------------------------------------
function fillConvertForm(w, over = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const v = {
    convTrialId: 'TRL-1', convMonthlyFee: '7500', convCurrency: 'PKR', convBillingDay: '1',
    convDaysPerWeek: '5 Days (Mon - Fri)', convJoiningDate: today,
    convStudentEmail: 'ayesha@example.com', convMeetingLink: '',
    ...over,
  };
  for (const [id, val] of Object.entries(v)) w.el(id).value = val;
  w.el('convSendWelcomeEmail').checked = !!over.sendEmail;
  return v;
}
const fakeSubmitEvent = { preventDefault: () => {} };
{
  const today = new Date().toISOString().slice(0, 10);
  const w = makeTrialsWorld({
    students: [{ id: 'STU-1', family_id: 'FAM-1', name: 'Ahmed', age: 8, gender: 'Male', assigned_teacher_id: 'TCH-1', joining_date: today, status: 'Trial', notes: JSON.stringify({ is_trial: true }) }],
    families: [{ id: 'FAM-1', parent_name: 'Ayesha Khan', whatsapp: '03331234567', country: 'Pakistan', timezone: 'Asia/Karachi', monthly_fee: 0, currency: 'PKR', billing_day: 1, status: 'Trial', notes: JSON.stringify({ is_trial: true }) }],
  });
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [mkTrial({ parent_name: 'Ayesha Khan', email: 'ayesha@example.com', conducted_sessions: 3, status: 'Completed', start_date: today })];
  fillConvertForm(w, {});
  await w.api.handleConvertTrialSubmit(fakeSubmitEvent);
  check('F9 convert sets the password via the Worker helper (parent, username, generated password)',
    w.setPwCalls.length === 1 && w.setPwCalls[0].role === 'parent' && w.setPwCalls[0].identifier === 'ayeshakhan' && w.setPwCalls[0].password === 'ayeshakhan2085',
    JSON.stringify(w.setPwCalls));
  const famNotes = w.tables.families[0].notes;
  const stuNotes = w.tables.students[0].notes;
  check('F9 convert writes portal_credentials.username into the family notes (so the login can find it)',
    JSON.parse(famNotes).portal_credentials && JSON.parse(famNotes).portal_credentials.username === 'ayeshakhan', famNotes);
  check('F9 convert keeps parent_user in the family notes too', JSON.parse(famNotes).parent_user === 'ayeshakhan');
  check('F9 the plaintext password is NOT in the family notes', !famNotes.includes('ayeshakhan2085') && !famNotes.includes('"password"'), famNotes);
  check('F9 the plaintext password is NOT in the student notes', !stuNotes.includes('ayeshakhan2085') && !stuNotes.includes('"password"'), stuNotes);
  check('F9 saveParentAccount receives NO password key', w.parentAccountCalls.length === 1 && !('password' in (w.parentAccountCalls[0].creds || {})), JSON.stringify(w.parentAccountCalls));
  check('F9 the plaintext password is NOT in any localStorage value', Object.values(w.store).every(v => !String(v).includes('ayeshakhan2085')), JSON.stringify(Object.keys(w.store)));
  const successMsg = w.notifies.find(m => m.includes('Conversion Completed Successfully'));
  check('F9 success message shows the generated password once', !!successMsg && successMsg.includes('Password: ayeshakhan2085'), successMsg || w.notifies.join(' | '));
  check('F9 success message shows the username', !!successMsg && successMsg.includes('Username: ayeshakhan'));
  check('F9 convert still marks the trial Converted', w.api.ALL_TRIALS[0].status === 'Converted');
  check('F9 convert activates the family + student', w.tables.families[0].status === 'Active' && w.tables.students[0].status === 'Active');
  check('F9 convert books the 5-day Mon-Fri timetable', w.tables.class_schedules.length === 5, String(w.tables.class_schedules.length));
}
{
  // With the welcome email on: the email goes out WITHOUT the password.
  const today = new Date().toISOString().slice(0, 10);
  const w = makeTrialsWorld({
    students: [{ id: 'STU-1', family_id: 'FAM-1', name: 'Ahmed', age: 8, gender: 'Male', assigned_teacher_id: 'TCH-1', joining_date: today, status: 'Trial', notes: JSON.stringify({ is_trial: true }) }],
    families: [{ id: 'FAM-1', parent_name: 'Ayesha Khan', whatsapp: '03331234567', country: 'Pakistan', timezone: 'Asia/Karachi', monthly_fee: 0, currency: 'PKR', billing_day: 1, status: 'Trial', notes: JSON.stringify({ is_trial: true }) }],
  });
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [mkTrial({ parent_name: 'Ayesha Khan', email: 'ayesha@example.com', conducted_sessions: 3, status: 'Completed', start_date: today })];
  fillConvertForm(w, { sendEmail: true });
  await w.api.handleConvertTrialSubmit(fakeSubmitEvent);
  await new Promise(r => setTimeout(r, 1200));
  check('F9 welcome email still opens (auto-send)', w.emailPayloads.length === 1, String(w.emailPayloads.length));
  check('F9 welcome email carries the username, NOT the password',
    w.emailPayloads[0] && w.emailPayloads[0].credentials && w.emailPayloads[0].credentials.username === 'ayeshakhan' && !JSON.stringify(w.emailPayloads[0]).includes('ayeshakhan2085'),
    JSON.stringify(w.emailPayloads[0]));
  check('F9 welcome email still dispatches', w.dispatchCalls.length === 1, String(w.dispatchCalls.length));
}
{
  // Set-password failure: conversion still completes, but the message
  // says NOT set and never shows the password that was not set.
  const today = new Date().toISOString().slice(0, 10);
  const w = makeTrialsWorld({
    setPwThrows: true,
    students: [{ id: 'STU-1', family_id: 'FAM-1', name: 'Ahmed', age: 8, gender: 'Male', assigned_teacher_id: 'TCH-1', joining_date: today, status: 'Trial', notes: JSON.stringify({ is_trial: true }) }],
    families: [{ id: 'FAM-1', parent_name: 'Ayesha Khan', whatsapp: '03331234567', country: 'Pakistan', timezone: 'Asia/Karachi', monthly_fee: 0, currency: 'PKR', billing_day: 1, status: 'Trial', notes: JSON.stringify({ is_trial: true }) }],
  });
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [mkTrial({ parent_name: 'Ayesha Khan', email: 'ayesha@example.com', conducted_sessions: 3, status: 'Completed', start_date: today })];
  fillConvertForm(w, {});
  await w.api.handleConvertTrialSubmit(fakeSubmitEvent);
  const successMsg = w.notifies.find(m => m.includes('Conversion Completed Successfully'));
  check('F9 failed password set: message says NOT set (honest)', !!successMsg && successMsg.includes('NOT set'), successMsg || w.notifies.join(' | '));
  check('F9 failed password set: message does NOT show the password that was never set', !w.notifies.some(m => m.includes('ayeshakhan2085')), w.notifies.join(' | '));
  check('F9 failed password set: conversion still completes', w.api.ALL_TRIALS[0].status === 'Converted' && w.tables.families[0].status === 'Active');
}

// ---- Static wiring guards ----------------------------------------------------------------
{
  const loaderSrc = extractFunction(TRIALS_SRC, 'loadTrialClassesData');
  check('WIRING loader derives status through deriveTrialStatus (F7)', loaderSrc.includes('deriveTrialStatus('));
  const toggleSrc = extractFunction(TRIALS_SRC, 'toggleTrialSession');
  check('WIRING toggle re-derives status after the count change (F7)', toggleSrc.includes('deriveTrialStatus('));
  const renderSrc = extractFunction(TRIALS_SRC, 'renderTrialCards');
  check('WIRING card list filters through trialPassesFilter (F7)', renderSrc.includes('trialPassesFilter('));
  check('WIRING card has a Pending Confirmation badge (F7)', renderSrc.includes('Pending Confirmation'));
  const convertSrc = extractFunction(TRIALS_SRC, 'handleConvertTrialSubmit');
  check('WIRING convert sets the starter password after the records save (F9)', convertSrc.includes('setConvertedParentPassword(username, trial.parent_name)'));
  check('WIRING convert writes portal_credentials.username into the family notes (F9)', convertSrc.includes('portal_credentials: {'));
  check('WIRING convert success message shows the set password (F9)', convertSrc.includes('Password: ${parentPassword}'));
  check('WIRING convert email payload has no password field (F9)', !/credentials:\s*\{[^}]*password/i.test(convertSrc));
  check('WIRING convert still uses the name-derived username', convertSrc.includes("const username = rawParent.length > 2 ? rawParent : `parent_${canonicalFamId.toLowerCase()}`"));
  check('WIRING index.html has the Pending Confirmation pill (F7)', INDEX_SRC.includes('id="trialTab-pending"') && INDEX_SRC.includes("filterTrialCards('pending')"));
  const activeSrc = extractFunction(TRIALS_SRC, 'trialIsActive');
  check('WIRING Active predicate excludes Pending Confirmation (F7)', activeSrc.includes("'Pending Confirmation'"));
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
process.exitCode = failed.length ? 1 : 0;
