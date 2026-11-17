// Trials Audit Batch 1 (2026-11-17) — F1, F2, F3, F4, F5, F6, F8, F10, F11, F12.
// Executes the REAL trials.js functions (extracted by name) against a fake
// DOM + fake db, plus the REAL isDashboardTrialClass (js/dashboard.js),
// openTrialEmailModal (js/email.js) and countActiveTrialFamilies
// (js/families.js). Every check below FAILS on the pre-fix code: the new
// pure helpers do not exist there (extraction throws), and the behavioural
// checks pin the fixed behaviour (4-day mapping, toggle-down persistence,
// Discontinued in D1, auto-send dispatch, banner updates, structured
// trial flags, no measured rate with zero decisions, familyId payload).
// Run from the repo root: node test/trials-audit-batch1.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TRIALS_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/trials.js'), 'utf8');
const EMAIL_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/email.js'), 'utf8');
const DASHBOARD_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/dashboard.js'), 'utf8');
const FAMILIES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/families.js'), 'utf8');
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
        // The real engine generates an id on insert; the fake does the
        // same (deterministic counter) so id-based deletes stay precise.
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
  'formatTrialDayShort', 'calculateTrial3Days', 'handleTrialTeacherSelection',
  'autoSendTrialEmail', 'markTrialDiscontinuedInD1',
  'updateTrialKpis', 'renderTrialCards', 'renderTeacherPerformanceBanner',
  'filterTrialCards', 'prepareAddTrialModal', 'handleSaveTrialClass',
  'toggleTrialSession', 'deleteTrial',
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
  const trialEmailCalls = [];
  const tables = {
    students: structuredClone(opts.students || []),
    families: structuredClone(opts.families || []),
    class_schedules: structuredClone(opts.schedules || []),
    attendance_logs: structuredClone(opts.logs || []),
    teachers: structuredClone(opts.teachers || []),
  };
  const db = makeFakeDb(tables, opts.fail || {});
  const ctx = {
    document: documentStub, localStorage: localStorageStub, console, setTimeout, clearTimeout, db,
    lmsNotify: (msg) => notifies.push(String(msg)),
    lmsConfirm: async () => (opts.confirm !== undefined ? opts.confirm : true),
    openModal: (id) => openedModals.push(id),
    closeModal: (id) => closedModals.push(id),
    dispatchEmailNow: () => dispatchCalls.push(1),
    openTrialEmailModal: (id) => trialEmailCalls.push(id),
    getEligibleTeachers: (list) => (list || []).filter(t => t.employee_type !== 'manager'),
    validateEligibleTeacherBackend: async () => ({ valid: true }),
    getNextFamilyId: () => 'FAM-900',
    getNextStudentId: () => 'STU-900',
    filterOutExistingScheduleRows: async (sid, tid, rows) => rows,
    loadDashboardData: () => {},
    loadFamiliesAndStudents: () => {},
    academyName: () => 'Al-Huda Islamic Centre',
  };
  const factory = new Function('ctx', `
    const { document, localStorage, console, setTimeout, clearTimeout, db,
      lmsNotify, lmsConfirm, openModal, closeModal, dispatchEmailNow, openTrialEmailModal,
      getEligibleTeachers, validateEligibleTeacherBackend, getNextFamilyId, getNextStudentId,
      filterOutExistingScheduleRows, loadDashboardData, loadFamiliesAndStudents, academyName } = ctx;
    let ALL_TRIALS = [];
    let ALL_TEACHERS = [];
    let ALL_FAMILIES = [];
    let CURRENT_TRIAL_FILTER = 'active';
    let CURRENT_TRIAL_TEACHER_FILTER = 'all';
    let CURRENT_ROLE = 'owner';
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
  return { api, tables, notifies, openedModals, closedModals, dispatchCalls, trialEmailCalls,
    el: (id) => documentStub.getElementById(id) };
}

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

function makeEmailWorld(trials, teachers) {
  const payloads = [];
  const factory = new Function('ctx', `
    const { openEmailPreviewModal, ALL_TRIALS, ALL_TEACHERS } = ctx;
    ${extractFunction(EMAIL_SRC, 'openTrialEmailModal')}
    return { openTrialEmailModal };
  `);
  const api = factory({
    openEmailPreviewModal: (p) => payloads.push(p),
    ALL_TRIALS: trials, ALL_TEACHERS: teachers,
  });
  return { api, payloads };
}

const dashApi = new Function(`${extractFunction(DASHBOARD_SRC, 'isDashboardTrialClass')}\nreturn { isDashboardTrialClass };`)();
const famApi = new Function(`${extractFunction(FAMILIES_SRC, 'countActiveTrialFamilies')}\nreturn { countActiveTrialFamilies };`)();

// ---- F1: one Active predicate (trialIsActive) -------------------------------
{
  const w = makeTrialsWorld();
  const t = w.api.trialIsActive;
  check('F1 trialIsActive: Active with 0 sessions is Active', t({ status: 'Active', conducted_sessions: 0 }) === true);
  check('F1 trialIsActive: Active with 2 sessions is Active', t({ status: 'Active', conducted_sessions: 2 }) === true);
  check('F1 trialIsActive: Completed 3/3 is NOT Active', t({ status: 'Completed', conducted_sessions: 3 }) === false);
  check('F1 trialIsActive: Converted is NOT Active', t({ status: 'Converted', conducted_sessions: 0 }) === false);
  check('F1 trialIsActive: Discontinued is NOT Active', t({ status: 'Discontinued', conducted_sessions: 1 }) === false);
  check('F1 trialIsActive: null trial is NOT Active', t(null) === false);
}

// ---- F1: pill + KPI use the shared predicate --------------------------------
{
  const w = makeTrialsWorld();
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [
    mkTrial({ id: 'TRL-A', student_name: 'Amina Active', conducted_sessions: 0, status: 'Active' }),
    mkTrial({ id: 'TRL-B', student_id: 'STU-2', student_name: 'Bilal Active', conducted_sessions: 2, status: 'Active' }),
    mkTrial({ id: 'TRL-C', student_id: 'STU-3', student_name: 'Completed Kid', conducted_sessions: 3, status: 'Completed' }),
    mkTrial({ id: 'TRL-D', student_id: 'STU-4', student_name: 'Converted Kid', conducted_sessions: 3, status: 'Converted' }),
    mkTrial({ id: 'TRL-E', student_id: 'STU-5', student_name: 'Discontinued Kid', conducted_sessions: 1, status: 'Discontinued' }),
  ];
  w.api.filterTrialCards('active');
  const html = w.el('trialsListContainer').innerHTML;
  check('F1 pill Active shows the two Active trials', html.includes('Amina Active') && html.includes('Bilal Active'));
  check('F1 pill Active excludes Completed 3/3 (old code showed it)', !html.includes('Completed Kid'), 'Completed Kid still in Active pill');
  check('F1 pill Active excludes Converted + Discontinued', !html.includes('Converted Kid') && !html.includes('Discontinued Kid'));
  w.api.updateTrialKpis();
  check('F1 KPI Active counts 2 (same predicate as the pill)', w.el('trialsKpiActive').innerText === 2, String(w.el('trialsKpiActive').innerText));
  check('F1 KPI Completed counts 1', w.el('trialsKpiCompleted').innerText === 1, String(w.el('trialsKpiCompleted').innerText));
  check('F1 KPI Converted counts 1', w.el('trialsKpiConverted').innerText === 1, String(w.el('trialsKpiConverted').innerText));
  check('F1 KPI Total counts 5', w.el('trialsKpiTotal').innerText === 5, String(w.el('trialsKpiTotal').innerText));
}

// ---- F2: convert day-mapping -------------------------------------------------
{
  const w = makeTrialsWorld();
  const m = w.api.trialConvertDaysToSchedule;
  check('F2 "4 Days (Mon - Thu)" books 4 days Mon-Thu', JSON.stringify(m('4 Days (Mon - Thu)')) === JSON.stringify([1, 2, 3, 4]), JSON.stringify(m('4 Days (Mon - Thu)')));
  check('F2 "5 Days (Mon - Fri)" books 5 days', JSON.stringify(m('5 Days (Mon - Fri)')) === JSON.stringify([1, 2, 3, 4, 5]));
  check('F2 "3 Days (Mon, Wed, Fri)" books Mon/Wed/Fri', JSON.stringify(m('3 Days (Mon, Wed, Fri)')) === JSON.stringify([1, 3, 5]));
  check('F2 "2 Days (Sat - Sun)" books weekend', JSON.stringify(m('2 Days (Sat - Sun)')) === JSON.stringify([6, 7]));
  check('F2 "6 Days (Mon - Sat)" books 6 days', JSON.stringify(m('6 Days (Mon - Sat)')) === JSON.stringify([1, 2, 3, 4, 5, 6]));
  check('F2 "7 Days (Everyday)" books all 7 days', JSON.stringify(m('7 Days (Everyday)')) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]));
  check('F2 unknown label falls back to Mon-Fri', JSON.stringify(m('Something else')) === JSON.stringify([1, 2, 3, 4, 5]));
}

// ---- F10: conversion rate ----------------------------------------------------
{
  const w = makeTrialsWorld();
  const r = w.api.trialConversionRate;
  check('F10 zero trials -> no measured rate (null, not 0%)', r([]) === null);
  check('F10 two undecided trials -> no measured rate (null)', r([{ status: 'Active' }, { status: 'Active' }]) === null);
  check('F10 one Converted -> 100%', r([{ status: 'Converted' }]) === 100);
  check('F10 one Discontinued -> 0% (a real decision)', r([{ status: 'Discontinued' }]) === 0);
  check('F10 one Converted + one Discontinued -> 50%', r([{ status: 'Converted' }, { status: 'Discontinued' }]) === 50);
}

// ---- F10: teacher banner ------------------------------------------------------
{
  const w = makeTrialsWorld();
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [
    mkTrial({ id: 'TRL-A', student_name: 'Amina Active', conducted_sessions: 0, status: 'Active' }),
    mkTrial({ id: 'TRL-B', student_id: 'STU-2', student_name: 'Bilal Active', conducted_sessions: 1, status: 'Active' }),
  ];
  w.api.renderTeacherPerformanceBanner('TCH-1');
  const html = w.el('trialTeacherPerformanceBanner').innerHTML;
  check('F10 banner with zero decisions shows "No Decisions Yet", not 0%', html.includes('No Decisions Yet') && !html.includes('0% Conversion'), html.slice(0, 400));
  check('F10 banner with zero decisions says so in plain words', html.includes('No trials decided yet'));
  check('F10 banner Active In-Progress counts 2', html.includes('text-purple-300 mt-0.5">2</div>'));

  w.api.ALL_TRIALS = [
    mkTrial({ id: 'TRL-A', student_name: 'Amina Active', conducted_sessions: 0, status: 'Active' }),
    mkTrial({ id: 'TRL-B', student_id: 'STU-2', student_name: 'Completed Kid', conducted_sessions: 3, status: 'Completed' }),
    mkTrial({ id: 'TRL-C', student_id: 'STU-3', student_name: 'Converted Kid', conducted_sessions: 3, status: 'Converted' }),
  ];
  w.api.renderTeacherPerformanceBanner('TCH-1');
  const html2 = w.el('trialTeacherPerformanceBanner').innerHTML;
  check('F10 banner Active In-Progress excludes Completed 3/3 (old code counted it)', html2.includes('text-purple-300 mt-0.5">1</div>'), 'Active In-Progress is not 1');
  check('F10 banner with one decision shows 100% Conversion (1 of 1 decided)', html2.includes('100% Conversion (1 of 1 decided)'));
}

// ---- F4: status derivation from D1 notes --------------------------------------
{
  const w = makeTrialsWorld();
  const d = w.api.trialStatusFromD1Notes;
  check('F4 converted wins over everything', d({ isConvertedNow: true, trialStatus: 'Discontinued', mirrorStatus: 'Active' }) === 'Converted');
  check('F4 D1 Discontinued beats a local Active mirror', d({ isConvertedNow: false, trialStatus: 'Discontinued', mirrorStatus: 'Active' }) === 'Discontinued');
  check('F4 D1 Active keeps a local Completed mirror', d({ isConvertedNow: false, trialStatus: 'Active', mirrorStatus: 'Completed' }) === 'Completed');
  check('F4 D1 Active with no mirror is Active', d({ isConvertedNow: false, trialStatus: 'Active', mirrorStatus: null }) === 'Active');
  check('F4 no D1 status and no mirror defaults to Active', d({ isConvertedNow: false, trialStatus: undefined, mirrorStatus: null }) === 'Active');
}

// ---- F12: search phone normalisation ------------------------------------------
{
  const w = makeTrialsWorld();
  const s = w.api.trialMatchesSearch;
  const t = mkTrial({ student_name: 'Ahmed Bilal', parent_name: 'Bilal Ahmed', whatsapp: '0333 123 4567', course: 'Noorani Qaida', country: 'Pakistan', teacher_name: 'Danyal Usman' });
  check('F12 digits-only query matches a number stored with spaces', s(t, '3331234567') === true);
  check('F12 full digits query matches a number stored with spaces', s(t, '03331234567') === true);
  check('F12 name search still works', s(t, 'ahmed') === true);
  check('F12 course search still works', s(t, 'qaida') === true);
  check('F12 non-matching query returns false', s(t, 'zzz-no-match') === false);
  check('F12 empty query matches everything', s(t, '') === true);
}

// ---- F8: dashboard Trials KPI uses structured flags ----------------------------
{
  const isT = dashApi.isDashboardTrialClass;
  check('F8 schedule status Trial is a trial class', isT({ status: 'Trial', students: { status: 'Active', notes: '{}' } }) === true);
  check('F8 student status Trial is a trial class', isT({ status: 'Active', students: { status: 'Trial', notes: '{}' } }) === true);
  check('F8 active trial notes (is_trial true) is a trial class', isT({ status: 'Active', students: { status: 'Active', notes: '{"is_trial":true}' } }) === true);
  check('F8 converted student is NOT a trial class (old code counted it)', isT({ status: 'Active', students: { status: 'Active', notes: '{"is_trial":false,"converted_from_trial":"TRL-1","trial_history":{"was_trial":true}}' } }) === false);
  check('F8 notes mentioning "trial" in words is NOT a trial class', isT({ status: 'Active', students: { status: 'Active', notes: '{"note":"trial class discussed"}' } }) === false);
  check('F8 regular student with no trial flags is NOT a trial class', isT({ status: 'Active', students: { status: 'Active', notes: '{}' } }) === false);
  check('F8 schedule with no student notes is NOT a trial class', isT({ status: 'Active', students: null }) === false);
}

// ---- F4: families info counter --------------------------------------------------
{
  const c = famApi.countActiveTrialFamilies;
  const fams = [
    { status: 'Trial', notes: '{"trial_history":{"trial_status":"Active"}}' },
    { status: 'Trial', notes: '{"trial_history":{"trial_status":"Discontinued"}}' },
    { status: 'Trial', notes: '{}' },
    { status: 'Active', notes: '{}' },
    { status: 'Trial', notes: { trial_history: { trial_status: 'Discontinued' } } },
  ];
  check('F4 families counter counts Active trial families only (2 of 5)', c(fams) === 2, String(c(fams)));
  check('F4 families counter tolerates malformed notes', c([{ status: 'Trial', notes: '{not json' }]) === 1);
}

// ---- F3: toggle-down deletes the log so a reload cannot resurrect it -------
{
  const w = makeTrialsWorld();
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [mkTrial({ conducted_sessions: 0, status: 'Active' })];
  await w.api.toggleTrialSession('TRL-1', 1);
  check('F3 toggle up marks session 1 and writes one log', w.api.ALL_TRIALS[0].conducted_sessions === 1 && w.tables.attendance_logs.length === 1, JSON.stringify(w.tables.attendance_logs));
  check('F3 toggle-up log is a Present trial-session log', w.tables.attendance_logs[0].status === 'Present' && String(w.tables.attendance_logs[0].lesson_notes || '').includes('3-Day Trial Session 1/3'));
  await w.api.toggleTrialSession('TRL-1', 2);
  await w.api.toggleTrialSession('TRL-1', 3);
  check('F3 three toggles up: 3 sessions, status Completed', w.api.ALL_TRIALS[0].conducted_sessions === 3 && w.api.ALL_TRIALS[0].status === 'Completed' && w.tables.attendance_logs.length === 3);
  await w.api.toggleTrialSession('TRL-1', 3);
  check('F3 toggle down 3->2 removes exactly one log', w.api.ALL_TRIALS[0].conducted_sessions === 2 && w.tables.attendance_logs.length === 2, `sessions=${w.api.ALL_TRIALS[0].conducted_sessions} logs=${w.tables.attendance_logs.length}`);
  check('F3 toggle down 3->2 flips status back to Active', w.api.ALL_TRIALS[0].status === 'Active');
  w.api.applyTrialAttendanceLogs(w.api.ALL_TRIALS, w.tables.attendance_logs);
  check('F3 lowered count survives the loader raise-only recompute', w.api.ALL_TRIALS[0].conducted_sessions === 2 && w.api.ALL_TRIALS[0].status === 'Active', `sessions=${w.api.ALL_TRIALS[0].conducted_sessions}`);
}
{
  // Pre-fix inflated data: the mirror says 1 but two trial logs exist
  // (the old toggle-down wrote a NEW log while lowering the mirror).
  const w = makeTrialsWorld({
    logs: [
      { id: 'ATT-1', student_id: 'STU-1', teacher_id: 'TCH-1', date: '2026-11-17', status: 'Present', lesson_notes: '3-Day Trial Session 1/3 Logged' },
      { id: 'ATT-2', student_id: 'STU-1', teacher_id: 'TCH-1', date: '2026-11-17', status: 'Present', lesson_notes: '3-Day Trial Session 1/3 Logged' },
    ],
  });
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [mkTrial({ conducted_sessions: 1, status: 'Active' })];
  await w.api.toggleTrialSession('TRL-1', 1);
  check('F3 toggle down cleans up inflated logs to the new count (0)', w.api.ALL_TRIALS[0].conducted_sessions === 0 && w.tables.attendance_logs.length === 0, `logs=${w.tables.attendance_logs.length}`);
  w.api.applyTrialAttendanceLogs(w.api.ALL_TRIALS, w.tables.attendance_logs);
  check('F3 inflated-data cleanup survives the loader recompute', w.api.ALL_TRIALS[0].conducted_sessions === 0);
}
{
  // A non-trial log for the same student must never be deleted.
  const w = makeTrialsWorld({
    logs: [
      { id: 'ATT-1', student_id: 'STU-1', teacher_id: 'TCH-1', date: '2026-11-17', status: 'Present', lesson_notes: '3-Day Trial Session 1/3 Logged' },
      { id: 'ATT-9', student_id: 'STU-1', teacher_id: 'TCH-1', date: '2026-11-17', status: 'Present', lesson_notes: 'Regular class' },
    ],
  });
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [mkTrial({ conducted_sessions: 1, status: 'Active' })];
  await w.api.toggleTrialSession('TRL-1', 1);
  check('F3 toggle down keeps a non-trial log for the same student', w.tables.attendance_logs.length === 1 && w.tables.attendance_logs[0].lesson_notes === 'Regular class', JSON.stringify(w.tables.attendance_logs));
}

// ---- F4: Discontinue persists in D1 -------------------------------------------
{
  const stuNotes = JSON.stringify({ is_trial: true, trial_history: { was_trial: true, trial_id: 'TRL-1', trial_status: 'Active' } });
  const famNotes = JSON.stringify({ trial_history: { trial_status: 'Active' } });
  const w = makeTrialsWorld({
    students: [{ id: 'STU-1', notes: stuNotes }],
    families: [{ id: 'FAM-1', notes: famNotes }],
    schedules: [{ id: 'SCH-1', student_id: 'STU-1', teacher_id: 'TCH-1', day_of_week: 1, start_time: '16:00:00' }],
  });
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [mkTrial({ conducted_sessions: 1, status: 'Active' })];
  await w.api.deleteTrial('TRL-1');
  const stuAfter = JSON.parse(w.tables.students[0].notes);
  const famAfter = JSON.parse(w.tables.families[0].notes);
  check('F4 Discontinue writes trial_status Discontinued to the student notes', stuAfter.trial_history.trial_status === 'Discontinued', w.tables.students[0].notes);
  check('F4 Discontinue keeps the other student note keys (was_trial)', stuAfter.trial_history.was_trial === true && stuAfter.is_trial === true);
  check('F4 Discontinue writes trial_status Discontinued to the family notes', famAfter.trial_history.trial_status === 'Discontinued', w.tables.families[0].notes);
  check('F4 Discontinue still removes the trial schedules', w.tables.class_schedules.length === 0);
  check('F4 Discontinue flips the local mirror too', w.api.ALL_TRIALS[0].status === 'Discontinued');
  check('F4 Discontinue does not warn when the D1 write succeeded', !w.notifies.some(m => m.includes('could not be saved to the server')));
}
{
  // A failed D1 write must be said out loud, not swallowed.
  const w = makeTrialsWorld({
    students: [{ id: 'STU-1', notes: '{"trial_history":{"trial_status":"Active"}}' }],
    families: [{ id: 'FAM-1', notes: '{"trial_history":{"trial_status":"Active"}}' }],
    fail: { updateErrorFor: new Set(['students']) },
  });
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_TRIALS = [mkTrial({ conducted_sessions: 1, status: 'Active' })];
  await w.api.deleteTrial('TRL-1');
  check('F4 a failed D1 Discontinued write is reported honestly', w.notifies.some(m => m.includes('could not be saved to the server')), w.notifies.join(' | '));
  check('F4 the mirror still flips locally even when the D1 write fails', w.api.ALL_TRIALS[0].status === 'Discontinued');
}
{
  // Manager may not discontinue at all (pre-existing guard, unchanged).
  const w = makeTrialsWorld();
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.CURRENT_ROLE = 'manager';
  w.api.ALL_TRIALS = [mkTrial({ conducted_sessions: 1, status: 'Active' })];
  await w.api.deleteTrial('TRL-1');
  check('F4 manager Discontinue is still refused', w.api.ALL_TRIALS[0].status === 'Active' && w.tables.students.length === 0);
}

// ---- F6: the two missing functions ----------------------------------------------
{
  const w = makeTrialsWorld();
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.calculateTrial3Days('2026-11-17');
  check('F6 Day 1/2/3 banner shows the 3 dates from the start date',
    w.el('trialDay1Badge').innerText === 'Tue, 17 Nov' &&
    w.el('trialDay2Badge').innerText === 'Wed, 18 Nov' &&
    w.el('trialDay3Badge').innerText === 'Thu, 19 Nov',
    [w.el('trialDay1Badge').innerText, w.el('trialDay2Badge').innerText, w.el('trialDay3Badge').innerText].join(' / '));
  w.api.calculateTrial3Days('2026-11-30');
  check('F6 banner rolls over the month boundary (30 Nov -> 1/2 Dec)',
    w.el('trialDay1Badge').innerText === 'Mon, 30 Nov' &&
    w.el('trialDay2Badge').innerText === 'Tue, 1 Dec' &&
    w.el('trialDay3Badge').innerText === 'Wed, 2 Dec',
    [w.el('trialDay1Badge').innerText, w.el('trialDay2Badge').innerText, w.el('trialDay3Badge').innerText].join(' / '));
  w.api.calculateTrial3Days('');
  check('F6 empty date resets the banner to Select Date / -- / --',
    w.el('trialDay1Badge').innerText === 'Select Date' &&
    w.el('trialDay2Badge').innerText === '--' &&
    w.el('trialDay3Badge').innerText === '--');
  w.api.calculateTrial3Days('not-a-date');
  check('F6 invalid date resets the banner instead of throwing', w.el('trialDay1Badge').innerText === 'Select Date');

  w.el('trialMeetingLink').value = '';
  w.api.handleTrialTeacherSelection('TCH-1');
  check('F6 picking a teacher fills the meeting link from the teacher Zoom link', w.el('trialMeetingLink').value === 'https://zoom.us/j/111111', w.el('trialMeetingLink').value);
  w.el('trialMeetingLink').value = 'https://zoom.us/j/typed-by-hand';
  w.api.handleTrialTeacherSelection('TCH-1');
  check('F6 picking a teacher never overwrites a hand-typed meeting link', w.el('trialMeetingLink').value === 'https://zoom.us/j/typed-by-hand');
  w.el('trialMeetingLink').value = '';
  w.api.handleTrialTeacherSelection('TCH-2');
  check('F6 picking a teacher without a Zoom link leaves the field empty', w.el('trialMeetingLink').value === '');

  const today = new Date().toISOString().slice(0, 10);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(today + 'T00:00:00Z');
  const expectedDay1 = `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  w.api.prepareAddTrialModal();
  check('F6 opening the modal shows today in the Day 1 banner (not "Select Date")', w.el('trialDay1Badge').innerText === expectedDay1, `${w.el('trialDay1Badge').innerText} vs ${expectedDay1}`);
  check('F6 opening the modal defaults the start date to today', w.el('trialStartDate').value === today);
}

// ---- F5: Auto-Send actually dispatches --------------------------------------------
{
  const w = makeTrialsWorld();
  let previewed = 0;
  w.api.autoSendTrialEmail(() => { previewed++; });
  await new Promise(r => setTimeout(r, 700));
  check('F5 auto-send opens the preview', previewed === 1);
  check('F5 auto-send then runs the existing dispatch', w.dispatchCalls.length === 1, String(w.dispatchCalls.length));
}

// ---- F12: save validations + happy path ---------------------------------------------
function fillTrialForm(w, over = {}) {
  const v = {
    trialParentName: 'Bilal Ahmed', trialParentPhone: '0333 1234567', trialEmail: 'bilal@example.com',
    trialCountry: 'Pakistan', trialTimezone: 'Asia/Karachi', trialStudentName: 'Ahmed',
    trialStudentAge: '8', trialStudentGender: 'Male', trialCourse: 'Noorani Qaida & Basic Arabic',
    trialTeacherSelect: 'TCH-1', trialStartDate: new Date().toISOString().slice(0, 10),
    trialPktSlot: '16:00 - 16:30', trialStudentTime: '', trialMeetingLink: '',
    ...over,
  };
  for (const [id, val] of Object.entries(v)) w.el(id).value = val;
  w.el('trialSendWelcomeEmail').checked = !!over.autoSend;
  return v;
}
const fakeEvent = { preventDefault: () => {} };
{
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const w = makeTrialsWorld();
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_FAMILIES = [];
  fillTrialForm(w, { trialStartDate: yesterday });
  await w.api.handleSaveTrialClass(fakeEvent);
  check('F12 a past start date is refused', w.notifies.some(m => m.includes('cannot be in the past')), w.notifies.join(' | '));
  check('F12 a past start date writes nothing', w.tables.families.length === 0 && w.tables.students.length === 0 && w.tables.class_schedules.length === 0);
  check('F12 a refused save re-enables the button', w.el('btnSaveTrial').disabled === false);
}
{
  const w = makeTrialsWorld();
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_FAMILIES = [];
  fillTrialForm(w, { trialParentPhone: 'abc' });
  await w.api.handleSaveTrialClass(fakeEvent);
  check('F12 a non-numeric phone is refused', w.notifies.some(m => m.includes('valid WhatsApp number')), w.notifies.join(' | '));
  check('F12 a non-numeric phone writes nothing', w.tables.families.length === 0 && w.tables.students.length === 0);
}
{
  const w = makeTrialsWorld();
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_FAMILIES = [];
  fillTrialForm(w, { trialParentPhone: '12345' });
  await w.api.handleSaveTrialClass(fakeEvent);
  check('F12 a too-short phone is refused', w.notifies.some(m => m.includes('valid WhatsApp number')), w.notifies.join(' | '));
  check('F12 a too-short phone writes nothing', w.tables.families.length === 0 && w.tables.students.length === 0);
}
{
  const w = makeTrialsWorld();
  w.api.ALL_TEACHERS = TEACHERS;
  w.api.ALL_FAMILIES = [];
  fillTrialForm(w, { autoSend: true });
  await w.api.handleSaveTrialClass(fakeEvent);
  check('F12 valid form writes the family row (status Trial)', w.tables.families.length === 1 && w.tables.families[0].status === 'Trial', JSON.stringify(w.tables.families));
  check('F12 valid form writes the student row (status Trial)', w.tables.students.length === 1 && w.tables.students[0].status === 'Trial');
  check('F12 valid form books 3 schedule rows', w.tables.class_schedules.length === 3, String(w.tables.class_schedules.length));
  check('F12 valid form records the trial in the mirror', w.api.ALL_TRIALS.length === 1 && w.api.ALL_TRIALS[0].status === 'Active');
  check('F12 valid form announces success', w.notifies.some(m => m.includes('Booked Successfully')), w.notifies.join(' | '));
  check('F12 valid form re-enables the button', w.el('btnSaveTrial').disabled === false);
  await new Promise(r => setTimeout(r, 1000));
  check('F5 end-to-end: a booked trial with Auto-Send opens the email preview', w.trialEmailCalls.length === 1, String(w.trialEmailCalls.length));
  check('F5 end-to-end: a booked trial with Auto-Send dispatches the email', w.dispatchCalls.length === 1, String(w.dispatchCalls.length));
}

// ---- F11: trial email payload carries familyId ----------------------------------------
{
  const { api, payloads } = makeEmailWorld(
    [mkTrial({ id: 'TRL-9', family_id: 'FAM-021', student_name: 'Ahmed', parent_name: 'Bilal', email: 'b@x.com' })],
    TEACHERS,
  );
  api.openTrialEmailModal('TRL-9');
  check('F11 trial email payload includes familyId', payloads.length === 1 && payloads[0].familyId === 'FAM-021', JSON.stringify(payloads[0]));
  check('F11 trial email payload is still a trial email', payloads[0].type === 'trial' && payloads[0].studentName === 'Ahmed');
}

// ---- Static wiring guards (the call sites must use the new helpers) -------------------
{
  const loaderSrc = extractFunction(TRIALS_SRC, 'loadTrialClassesData');
  check('WIRING loader derives status through trialStatusFromD1Notes (F4)', loaderSrc.includes('trialStatusFromD1Notes('));
  check('WIRING loader syncs sessions through applyTrialAttendanceLogs (F3)', loaderSrc.includes('applyTrialAttendanceLogs('));
  const convertSrc = extractFunction(TRIALS_SRC, 'handleConvertTrialSubmit');
  check('WIRING convert uses trialConvertDaysToSchedule (F2)', convertSrc.includes('trialConvertDaysToSchedule(days_per_week)'));
  check('WIRING convert auto-send dispatches after the preview (F5)', convertSrc.includes('autoSendTrialEmail('));
  check('WIRING convert email payload carries familyId (F11)', convertSrc.includes('familyId: canonicalFamId'));
  const saveSrc = extractFunction(TRIALS_SRC, 'handleSaveTrialClass');
  check('WIRING Add Trial auto-send dispatches after the preview (F5)', saveSrc.includes('autoSendTrialEmail('));
  const toggleSrc = extractFunction(TRIALS_SRC, 'toggleTrialSession');
  check('WIRING toggle-down deletes the session log (F3)', toggleSrc.includes(".delete().eq('id'"));
  const deleteSrc = extractFunction(TRIALS_SRC, 'deleteTrial');
  check('WIRING Discontinue persists to D1 (F4)', deleteSrc.includes('markTrialDiscontinuedInD1('));
  const emailModalSrc = extractFunction(EMAIL_SRC, 'openTrialEmailModal');
  check('WIRING trial email modal payload carries familyId (F11)', emailModalSrc.includes('familyId: trial.family_id'));
  check('WIRING index.html still calls calculateTrial3Days on date change (F6)', INDEX_SRC.includes('onchange="calculateTrial3Days(this.value)"'));
  check('WIRING index.html still calls handleTrialTeacherSelection on teacher change (F6)', INDEX_SRC.includes('onchange="handleTrialTeacherSelection(this.value)"'));
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
process.exitCode = failed.length ? 1 : 0;
