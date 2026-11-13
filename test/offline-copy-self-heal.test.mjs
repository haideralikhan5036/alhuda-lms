// Offline-copy self-heal (owner voice note 2026-11-13, build
// 2026-11-13): the "Offline copy shown" banner used to sit on screen
// until a manual refresh, because a single transient failure fell
// straight to the local mirror and nothing re-checked while the tab
// stayed open. This suite proves, against the REAL
// js/cloudflare-db.js in a vm over scripted fetch:
//
//   Part 1 — the shared db layer: a transient probe/POST failure is
//   re-probed once (~2 s) and heals with NO banner; a persistent
//   failure shows the banner with the honest "reconnecting
//   automatically" text; a probe 401 WITH a token is session-expired
//   (event dispatched, token cleared, no mirror rows, no banner) while
//   a probe 401 WITHOUT a token (pre-login) dispatches nothing; a
//   POST 401 is never re-probed; the background heal timer re-checks
//   while the banner shows and stops when hidden / tab hidden /
//   logged out; login views never show the banner (Batch 3.6 gate).
//   Part 2 — structural pins in teacher.html / parent.html /
//   js/navigation.js / js/dashboard.js (listeners, active-tab
//   recovery, session-expired listeners).
//   Part 3 — the REAL portal functions in a vm: the teacher
//   'alhuda-d1-live' listener refetches when the banner shows even
//   with no degraded flag; the teacher + parent session-expired
//   listeners route to their login views (guarded to logged-in
//   sessions); navigation.js reloadActiveAdminTab calls the right
//   loader per active tab; the admin 'alhuda-d1-live' listener
//   refetches the active tab (auth-gated).
//
// Run from the repo root:  node test/offline-copy-self-heal.test.mjs
// Requires: node >= 22.5. All records are SYNTHETIC.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const SHIM_SRC = read('js/cloudflare-db.js');
const TEACHER_SRC = read('teacher.html');
const PARENT_SRC = read('parent.html');
const NAV_SRC = read('js/navigation.js');
const DASH_SRC = read('js/dashboard.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}
const flush = (ms = 10) => new Promise((r) => setTimeout(r, ms));

function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] || null,
    get length() { return m.size; },
    _map: m,
  };
}

const MIRROR_KEY = 'alhuda_cloudflare_local_db_v1';
const MIGRATED_KEY = 'alhuda_d1_initial_sync_done_v1';
function mirrorSeed(rows) {
  const store = { families: [], students: [], teachers: [], class_schedules: [], attendance_logs: [], payments: [], salary_slips: [], salary_adjustments: [], leave_requests: [], trial_students: [], system_settings: [] };
  Object.assign(store, rows);
  return { [MIRROR_KEY]: JSON.stringify(store), [MIGRATED_KEY]: 'true' };
}

// Load a fresh shim instance with scripted fetch. probe/post are
// arrays consumed in order; each entry: 'ok' | '401' | '500' |
// 'throw' | { ok, data }. 'ok' probe -> { ok:true, d1_bound:true };
// 'ok' post -> { data: [SCH-LIVE row] }.
async function loadShim({ probe, post, mirror = {}, tokens = {}, loginVisible = false }) {
  const session = makeStorage(tokens);
  const local = makeStorage(mirror);
  const fetchCalls = [];
  const dispatched = [];
  const intervals = [];
  const clearedIntervals = [];
  let pi = 0; let qi = 0;
  const scripted = (seq, idx, isProbe) => {
    const r = seq[Math.min(idx, seq.length - 1)];
    if (r === 'throw') throw new Error('network down');
    if (r === '401') return { ok: false, status: 401, json: async () => ({}) };
    if (r === '500') return { ok: false, status: 500, json: async () => ({}) };
    if (r && typeof r === 'object') return { ok: true, status: 200, json: async () => r };
    if (isProbe) return { ok: true, status: 200, json: async () => ({ ok: true, d1_bound: true }) };
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'SCH-LIVE', teacher_id: 'TCH-1' }] }) };
  };
  const fetchStub = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const isProbe = method === 'GET' && String(url).endsWith('/api/db');
    fetchCalls.push({ url, method, probe: isProbe });
    return scripted(isProbe ? probe : post, isProbe ? pi++ : qi++, isProbe);
  };
  const bannerEls = {};
  const doc = {
    hidden: false,
    body: { prepend(el) { bannerEls[el.id] = el; } },
    createElement() {
      const el = { id: '', style: {}, textContent: '',
        setAttribute() {},
        remove() { delete bannerEls[this.id]; } };
      return el;
    },
    getElementById: (id) => {
      if (bannerEls[id]) return bannerEls[id];
      if (id === 'loginView' || id === 'ownerLoginView' || id === 'parentLoginView') {
        return { classList: { contains: (c) => (c === 'hidden' ? !loginVisible : false) } };
      }
      return null;
    },
    addEventListener: () => {},
  };
  const sandbox = {
    console, fetch: fetchStub, setTimeout, clearTimeout,
    setInterval: (cb, ms) => { const id = intervals.length + 1; intervals.push({ id, cb, ms }); return id; },
    clearInterval: (id) => { clearedIntervals.push(id); },
    AbortController,
    sessionStorage: session, localStorage: local,
    document: doc,
    CustomEvent: class { constructor(t) { this.type = t; } },
    location: { hostname: 'test.local', pathname: '/teacher.html' },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.getComputedStyle = () => ({ display: loginVisible ? 'block' : 'none' });
  sandbox.addEventListener = () => {};
  sandbox.dispatchEvent = (ev) => { dispatched.push(ev && ev.type); return true; };
  vm.createContext(sandbox);
  vm.runInContext(SHIM_SRC, sandbox);
  return { sandbox, session, local, fetchCalls, dispatched, intervals, clearedIntervals, bannerEls, doc };
}

function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

function extractListener(src, eventName) {
  const needle = `window.addEventListener('${eventName}'`;
  const start = src.indexOf(needle);
  if (start < 0) throw new Error('listener not found: ' + eventName);
  const arrow = src.indexOf('=>', start);
  let j = arrow + 2;
  while (src[j] === ' ' || src[j] === '\n' || src[j] === '\t' || src[j] === '\r') j++;
  if (src[j] !== '{') {
    // Expression-body arrow: the statement ends at the first ';'.
    const semi = src.indexOf(';', arrow);
    if (semi < 0) throw new Error('listener end not found: ' + eventName);
    return src.slice(start, semi + 1);
  }
  let i = j;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  // The brace matcher already consumed the handler's closing '}',
  // so the call ends with ');' right after it.
  let end = src.indexOf(');', i);
  if (end < 0) throw new Error('listener end not found: ' + eventName);
  return src.slice(start, end + 2);
}

// ===========================================================================
// Part 1 — shared db layer
// ===========================================================================

// ---- 1a. Transient probe failure heals: NO banner, live data ----------
{
  const { sandbox, bannerEls, fetchCalls } = await loadShim({
    probe: ['500', 'ok'], post: ['ok'],
    mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }),
    tokens: { alhuda_teacher_token: 'good-token' },
  });
  const res = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('1a transient probe failure: live data returned', res && res._lmsSource === 'd1' && Array.isArray(res.data) && res.data[0].id === 'SCH-LIVE', JSON.stringify({ s: res && res._lmsSource, d: res && res.data }));
  check('1a transient probe failure: NO banner shown', !bannerEls['lms-mirror-stale-banner'] && sandbox.__lmsMirrorStale !== true, JSON.stringify({ b: !!bannerEls['lms-mirror-stale-banner'], s: sandbox.__lmsMirrorStale }));
  check('1a transient probe failure: re-probe ran (probe, re-probe, post)', fetchCalls.filter((c) => c.probe).length === 2 && fetchCalls.filter((c) => !c.probe).length === 1, JSON.stringify(fetchCalls.map((c) => (c.probe ? 'GET' : 'POST'))));
}

// ---- 1b. Transient POST throw heals via re-probe + POST retry ---------
{
  const { sandbox, bannerEls, fetchCalls } = await loadShim({
    probe: ['ok', 'ok'], post: ['throw', 'ok'],
    mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }),
    tokens: { alhuda_teacher_token: 'good-token' },
  });
  const res = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('1b transient POST throw: live data returned after retry', res && res._lmsSource === 'd1' && res.data[0].id === 'SCH-LIVE', JSON.stringify({ s: res && res._lmsSource }));
  check('1b transient POST throw: NO banner shown', !bannerEls['lms-mirror-stale-banner'], JSON.stringify({ b: !!bannerEls['lms-mirror-stale-banner'] }));
  check('1b transient POST throw: POST retried once (2 POSTs)', fetchCalls.filter((c) => !c.probe).length === 2, 'posts=' + fetchCalls.filter((c) => !c.probe).length);
}

// ---- 1c. Persistent failure: banner shows, honest retrying text -------
{
  const { sandbox, bannerEls, intervals } = await loadShim({
    probe: ['500', '500'], post: ['ok'],
    mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }),
    tokens: { alhuda_teacher_token: 'good-token' },
  });
  const res = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('1c persistent failure: mirror rows returned', res && res._lmsSource === 'mirror' && res.data[0].id === 'SCH-M1', JSON.stringify({ s: res && res._lmsSource }));
  check('1c persistent failure: banner shows + flag set', !!bannerEls['lms-mirror-stale-banner'] && sandbox.__lmsMirrorStale === true, JSON.stringify({ b: !!bannerEls['lms-mirror-stale-banner'], s: sandbox.__lmsMirrorStale }));
  check('1c persistent failure: banner text says reconnecting automatically', String(bannerEls['lms-mirror-stale-banner'].textContent || '').includes('Reconnecting automatically'), String(bannerEls['lms-mirror-stale-banner'].textContent));
  check('1c persistent failure: background heal timer started (30 s)', intervals.length === 1 && intervals[0].ms === 30000, JSON.stringify(intervals.map((i) => i.ms)));
}

// ---- 1d. Probe 401 WITH token = session expired, never offline --------
{
  const { sandbox, session, bannerEls, dispatched } = await loadShim({
    probe: ['401', '401'], post: ['ok'],
    mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }),
    tokens: { alhuda_teacher_token: 'dead-token' },
  });
  const res = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('1d probe 401 with token: SESSION_EXPIRED error', res && res.error && res.error.code === 'SESSION_EXPIRED', JSON.stringify(res && res.error));
  check('1d probe 401 with token: data is null (no stale mirror)', res && res.data === null, JSON.stringify(res && res.data));
  check('1d probe 401 with token: session-expired event dispatched', dispatched.includes('alhuda-session-expired'), JSON.stringify(dispatched));
  check('1d probe 401 with token: dead token cleared', session.getItem('alhuda_teacher_token') === null);
  check('1d probe 401 with token: NO offline banner', !bannerEls['lms-mirror-stale-banner'], JSON.stringify({ b: !!bannerEls['lms-mirror-stale-banner'] }));
}

// ---- 1e. Probe 401 WITHOUT token (pre-login): nothing dispatched -------
{
  const { sandbox, bannerEls, dispatched } = await loadShim({
    probe: ['401', '401'], post: ['ok'],
    mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }),
    tokens: {},
  });
  const res = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('1e pre-login probe 401: no session-expired dispatch', !dispatched.includes('alhuda-session-expired'), JSON.stringify(dispatched));
  check('1e pre-login probe 401: mirror fallback, no error', res && res._lmsSource === 'mirror' && res.error === null, JSON.stringify({ s: res && res._lmsSource, e: res && res.error }));
  check('1e pre-login probe 401: banner shows (rows on screen, not a login view)', !!bannerEls['lms-mirror-stale-banner'], JSON.stringify({ b: !!bannerEls['lms-mirror-stale-banner'] }));
}

// ---- 1f. POST 401 is never re-probed -----------------------------------
{
  const { sandbox, fetchCalls } = await loadShim({
    probe: ['ok'], post: ['401'],
    mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }),
    tokens: { alhuda_teacher_token: 'dead-token' },
  });
  const res = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('1f POST 401: SESSION_EXPIRED error', res && res.error && res.error.code === 'SESSION_EXPIRED', JSON.stringify(res && res.error));
  check('1f POST 401: exactly one probe + one POST (no re-probe)', fetchCalls.length === 2 && fetchCalls.filter((c) => c.probe).length === 1, JSON.stringify(fetchCalls.map((c) => (c.probe ? 'GET' : 'POST'))));
}

// ---- 1g. Heal timer: banner clears when D1 answers again --------------
{
  const ctx = await loadShim({
    probe: ['500', '500', 'ok'], post: ['ok'],
    mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }),
    tokens: { alhuda_teacher_token: 'good-token' },
  });
  const { sandbox, bannerEls, intervals, clearedIntervals, dispatched } = ctx;
  await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('1g heal: banner showing before the timer fires', !!bannerEls['lms-mirror-stale-banner'], JSON.stringify({ b: !!bannerEls['lms-mirror-stale-banner'] }));
  // The heal tick re-probes (scripted 'ok' now) -> notifyD1Live fires.
  await intervals[0].cb();
  await flush(20);
  check('1g heal: timer tick fired alhuda-d1-live', dispatched.includes('alhuda-d1-live'), JSON.stringify(dispatched));
  // The next live read hides the banner and stops the timer.
  const live = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('1g heal: live read after heal returns live data', live && live._lmsSource === 'd1', JSON.stringify({ s: live && live._lmsSource }));
  check('1g heal: banner hidden after live read', !bannerEls['lms-mirror-stale-banner'] && sandbox.__lmsMirrorStale === false, JSON.stringify({ b: !!bannerEls['lms-mirror-stale-banner'], s: sandbox.__lmsMirrorStale }));
  check('1g heal: timer stopped when banner hid', clearedIntervals.length >= 1, JSON.stringify(clearedIntervals));
}

// ---- 1h. Heal timer does nothing while the tab is hidden --------------
{
  const ctx = await loadShim({
    probe: ['500', '500', 'ok'], post: ['ok'],
    mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }),
    tokens: { alhuda_teacher_token: 'good-token' },
  });
  const { sandbox, intervals, fetchCalls } = ctx;
  await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  const callsBefore = fetchCalls.length;
  ctx.doc.hidden = true;
  await intervals[0].cb();
  await flush(20);
  check('1h heal hidden tab: no probe while hidden', fetchCalls.length === callsBefore, `before=${callsBefore} after=${fetchCalls.length}`);
}

// ---- 1i. Heal timer stops when logged out ------------------------------
{
  const ctx = await loadShim({
    probe: ['500', '500', 'ok'], post: ['ok'],
    mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }),
    tokens: { alhuda_teacher_token: 'good-token' },
  });
  const { sandbox, session, intervals, clearedIntervals, fetchCalls } = ctx;
  await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  session.removeItem('alhuda_teacher_token');
  // Drop the in-memory token cache too (same as a logout wipe).
  sandbox.window.clearWorkerTokens();
  const callsBefore = fetchCalls.length;
  await intervals[0].cb();
  await flush(20);
  check('1i heal logged out: no probe after logout', fetchCalls.length === callsBefore, `before=${callsBefore} after=${fetchCalls.length}`);
  check('1i heal logged out: timer stopped', clearedIntervals.length >= 1, JSON.stringify(clearedIntervals));
}

// ---- 1j. Login views never show the banner (Batch 3.6 gate) -----------
{
  const { sandbox, bannerEls } = await loadShim({
    probe: ['500', '500'], post: ['ok'],
    mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }),
    tokens: {},
    loginVisible: true,
  });
  const res = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('1j login view: mirror read still works', res && res._lmsSource === 'mirror', JSON.stringify({ s: res && res._lmsSource }));
  check('1j login view: NO banner on the login screen', !bannerEls['lms-mirror-stale-banner'] && sandbox.__lmsMirrorStale !== true, JSON.stringify({ b: !!bannerEls['lms-mirror-stale-banner'], s: sandbox.__lmsMirrorStale }));
}

// ===========================================================================
// Part 2 — structural pins
// ===========================================================================
{
  check('2a teacher: session-expired listener present + routes to login view',
    TEACHER_SRC.includes("window.addEventListener('alhuda-session-expired'") && TEACHER_SRC.includes('showLoginView()'));
  check('2b teacher: d1-live listener refetches when the banner shows (not only degraded)',
    TEACHER_SRC.includes('__lmsMirrorStale') && TEACHER_SRC.includes("window.addEventListener('alhuda-d1-live'"));
  check('2c teacher: visibility/online recovery also fires on banner (not only degraded flag)',
    TEACHER_SRC.includes('recoverTeacherClassesIfDegraded') && TEACHER_SRC.includes('__lmsMirrorStale'));
  check('2d parent: d1-live listener present (refetch on heal)',
    PARENT_SRC.includes("window.addEventListener('alhuda-d1-live'"));
  check('2e parent: session-expired listener present + routes to parent login view',
    PARENT_SRC.includes("window.addEventListener('alhuda-session-expired'") && PARENT_SRC.includes('showParentLoginView()'));
  check('2f navigation: reloadActiveAdminTab exists with all tab loaders',
    NAV_SRC.includes('function reloadActiveAdminTab()') &&
    ['loadDashboardData', 'loadAttendanceList', 'loadFamiliesAndStudents', 'loadTeachers',
     'calculateMonthlySalaries', 'loadFeeBillingLedger', 'loadTrialClassesData',
     'loadLeaveManagementData', 'loadCurriculumLibrary', 'initScheduleSearch']
      .every((fn) => NAV_SRC.includes(fn)));
  check('2g dashboard: heartbeat reloads the active tab (not dashboard only)',
    DASH_SRC.includes('reloadActiveAdminTab()'));
  check('2h dashboard: d1-live + visibility recovery use the active-tab helper, auth-gated',
    DASH_SRC.includes('hasAdminSession()') && DASH_SRC.includes("window.addEventListener('alhuda-d1-live'"));
  check('2i shim: quick re-probe + heal timer present, banner text is honest',
    SHIM_SRC.includes('quickReprobeD1') && SHIM_SRC.includes('MIRROR_HEAL_INTERVAL_MS') &&
    SHIM_SRC.includes('Reconnecting automatically'));
  check('2j shim: probe 401 with a token dispatches session-expired (pre-login stays silent)',
    SHIM_SRC.includes('alhuda-session-expired') && SHIM_SRC.includes('tokenAtProbe'));
}

// ===========================================================================
// Part 3 — REAL portal functions in a vm
// ===========================================================================

// ---- 3a. Teacher d1-live listener: refetch on banner, not only degraded --
{
  const src = extractListener(TEACHER_SRC, 'alhuda-d1-live');
  const listeners = {};
  let loadCalls = 0;
  const sandbox = {
    console,
    window: null,
    addEventListener: (ev, cb) => { listeners[ev] = cb; },
    _teacherClassesDegraded: null,
    CURRENT_TEACHER: { id: 'TCH-1' },
    _teacherLoadInFlight: false,
    loadTeacherPortalData: () => { loadCalls++; },
    __lmsMirrorStale: false,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  // Healthy page, no banner: no refetch.
  listeners['alhuda-d1-live']();
  check('3a teacher d1-live: healthy page does NOT refetch', loadCalls === 0, 'calls=' + loadCalls);
  // Banner showing, no degraded flag: refetch (the fixed gap).
  sandbox.__lmsMirrorStale = true;
  listeners['alhuda-d1-live']();
  check('3a teacher d1-live: banner showing refetches even with no degraded flag', loadCalls === 1, 'calls=' + loadCalls);
  // In-flight load: no stacked second load.
  sandbox._teacherLoadInFlight = true;
  listeners['alhuda-d1-live']();
  check('3a teacher d1-live: in-flight load is not stacked', loadCalls === 1, 'calls=' + loadCalls);
  // Degraded flag set (old path still works).
  sandbox._teacherLoadInFlight = false;
  sandbox.__lmsMirrorStale = false;
  sandbox._teacherClassesDegraded = { kind: 'mirror' };
  listeners['alhuda-d1-live']();
  check('3a teacher d1-live: degraded flag still refetches', loadCalls === 2, 'calls=' + loadCalls);
}

// ---- 3b. Teacher session-expired listener: login view, guarded ----------
{
  const src = extractListener(TEACHER_SRC, 'alhuda-session-expired');
  const listeners = {};
  let loginShown = 0;
  const sandbox = {
    console,
    window: null,
    addEventListener: (ev, cb) => { listeners[ev] = cb; },
    CURRENT_TEACHER: { id: 'TCH-1' },
    showLoginView: () => { loginShown++; },
    location: { reload: () => {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  listeners['alhuda-session-expired']();
  check('3b teacher session-expired: login view shown for a logged-in teacher', loginShown === 1, 'shown=' + loginShown);
  sandbox.CURRENT_TEACHER = null;
  listeners['alhuda-session-expired']();
  check('3b teacher session-expired: ignored when not logged in (pre-login invariant)', loginShown === 1, 'shown=' + loginShown);
}

// ---- 3c. Parent listeners: d1-live refetch + session-expired login -----
{
  const liveSrc = extractListener(PARENT_SRC, 'alhuda-d1-live');
  const expSrc = extractListener(PARENT_SRC, 'alhuda-session-expired');
  const listeners = {};
  let syncCalls = 0; let loginShown = 0;
  const sandbox = {
    console,
    window: null,
    addEventListener: (ev, cb) => { listeners[ev] = cb; },
    CURRENT_AUTH_FAMILY: { id: 'FAM-1' },
    scheduleParentPortalLiveSync: () => { syncCalls++; },
    showParentLoginView: () => { loginShown++; },
    location: { reload: () => {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(liveSrc, sandbox);
  vm.runInContext(expSrc, sandbox);
  listeners['alhuda-d1-live']();
  check('3c parent d1-live: refetches the current view on heal', syncCalls === 1, 'calls=' + syncCalls);
  listeners['alhuda-session-expired']();
  check('3c parent session-expired: login view shown for a logged-in family', loginShown === 1, 'shown=' + loginShown);
  sandbox.CURRENT_AUTH_FAMILY = null;
  listeners['alhuda-session-expired']();
  check('3c parent session-expired: ignored when not logged in', loginShown === 1, 'shown=' + loginShown);
}

// ---- 3d. navigation.js reloadActiveAdminTab: right loader per tab -------
{
  const fnSrc = extractFunction(NAV_SRC, 'reloadActiveAdminTab');
  const calls = [];
  const mkBtn = (tab) => ({ getAttribute: (a) => (a === 'data-tab' ? tab : null) });
  const sandbox = {
    console,
    window: {},
    document: {
      querySelector: (sel) => {
        if (sel === '.sidebar-nav-btn.active') return sandbox.__activeBtn;
        return null;
      },
    },
    __activeBtn: null,
    loadDashboardData: () => { calls.push('dashboard'); },
    loadAttendanceList: () => { calls.push('attendance'); },
    loadFamiliesAndStudents: () => { calls.push('families'); },
    loadTeachers: () => { calls.push('teachers'); },
    calculateMonthlySalaries: () => { calls.push('salaries'); },
    loadFeeBillingLedger: () => { calls.push('invoices'); },
    loadTrialClassesData: () => { calls.push('trials'); },
    loadLeaveManagementData: () => { calls.push('leaves'); },
    loadCurriculumLibrary: () => { calls.push('curriculum'); },
    initScheduleSearch: () => { calls.push('schedule-search'); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fnSrc + '\nreloadActiveAdminTab.__exposed = true;', sandbox);
  // The function declaration lives in the vm global scope; call it.
  const run = (tab) => {
    sandbox.__activeBtn = tab ? mkBtn(tab) : null;
    calls.length = 0;
    return vm.runInContext('reloadActiveAdminTab()', sandbox);
  };
  check('3d reloadActiveAdminTab: families tab loads families', run('tab-families') === true && calls[0] === 'families', JSON.stringify(calls));
  check('3d reloadActiveAdminTab: dashboard tab loads dashboard', run('tab-dashboard') === true && calls[0] === 'dashboard', JSON.stringify(calls));
  check('3d reloadActiveAdminTab: salaries tab loads salaries', run('tab-salaries') === true && calls[0] === 'salaries', JSON.stringify(calls));
  check('3d reloadActiveAdminTab: no active tab loads nothing', run(null) === false && calls.length === 0, JSON.stringify(calls));
  check('3d reloadActiveAdminTab: unknown tab loads nothing', run('tab-nope') === false && calls.length === 0, JSON.stringify(calls));
}

// ---- 3e. Admin d1-live listener: active tab, auth-gated ------------------
{
  const src = extractListener(DASH_SRC, 'alhuda-d1-live');
  const listeners = {};
  let reloadCalls = 0; let dashCalls = 0;
  const sandbox = {
    console,
    window: null,
    addEventListener: (ev, cb) => { listeners[ev] = cb; },
    hasAdminSession: true,
    reloadActiveAdminTab: () => { reloadCalls++; },
    loadDashboardData: () => { dashCalls++; },
  };
  // The extracted listener references hasAdminSession() as a bare
  // function — bind the sandbox flag through a real function.
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('function hasAdminSession() { return __hasSession; }', sandbox);
  sandbox.__hasSession = true;
  vm.runInContext(src, sandbox);
  listeners['alhuda-d1-live']();
  check('3e admin d1-live: refetches the ACTIVE tab (not always dashboard)', reloadCalls === 1 && dashCalls === 0, `reload=${reloadCalls} dash=${dashCalls}`);
  sandbox.__hasSession = false;
  listeners['alhuda-d1-live']();
  check('3e admin d1-live: no load when logged out', reloadCalls === 1 && dashCalls === 0, `reload=${reloadCalls} dash=${dashCalls}`);
  // Fallback when the helper is absent: dashboard loader still runs.
  delete sandbox.reloadActiveAdminTab;
  sandbox.__hasSession = true;
  listeners['alhuda-d1-live']();
  check('3e admin d1-live: falls back to dashboard loader without the helper', dashCalls === 1, `dash=${dashCalls}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\noffline-copy-self-heal: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join('; ')); process.exit(1); }
