// Slow-classes recovery tests — (1) the db shim's honest failure
// behaviour (401-on-read surfacing, D1 vs mirror provenance, no false
// session prompt on the pre-login probe), (2) the admin PKT date helper
// (real function source extracted from js/config.js), (3) the admin
// dashboard class-table render (real js/dashboard.js in a vm with fake
// DOM elements): a failed/mirror load must never render as "no
// classes".
// Run from the repo root:  node test/slow-classes-recovery.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHIM_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/cloudflare-db.js'), 'utf8');
const DASH_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/dashboard.js'), 'utf8');
const CONFIG_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/config.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

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
function mirrorSeed(rows) {
  const store = { families: [], students: [], teachers: [], class_schedules: [], attendance_logs: [], payments: [], salary_slips: [], salary_adjustments: [], leave_requests: [], trial_students: [], system_settings: [] };
  Object.assign(store, rows);
  return { [MIRROR_KEY]: JSON.stringify(store) };
}

// Load a fresh shim instance with a scripted fetch. probe: 'ok'|'401'|
// '500'. post: 'ok'|'401'|'throw'. Returns the sandbox (db on window).
async function loadShim({ probe, post, mirror = {}, tokens = {} }) {
  const session = makeStorage(tokens);
  const local = makeStorage(mirror);
  const fetchCalls = [];
  const fetchStub = async (url, opts = {}) => {
    fetchCalls.push({ url, method: opts.method || 'GET' });
    const isProbe = (opts.method || 'GET') === 'GET' && String(url).endsWith('/api/db');
    if (isProbe) {
      if (probe === '401') return { ok: false, status: 401, json: async () => ({}) };
      if (probe === '500') return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ ok: true, d1_bound: true }) };
    }
    if (post === '401') return { ok: false, status: 401, json: async () => ({}) };
    if (post === 'throw') throw new Error('network down');
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'SCH-LIVE', day_of_week: 3 }] }) };
  };
  const sandbox = {
    console, fetch: fetchStub, setTimeout, clearTimeout,
    sessionStorage: session, localStorage: local,
    document: { addEventListener: () => {}, hidden: false },
    CustomEvent: class { constructor(t) { this.type = t; } },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {}; sandbox.dispatchEvent = () => {};
  vm.createContext(sandbox);
  vm.runInContext(SHIM_SRC, sandbox);
  return { sandbox, session, local, fetchCalls };
}

// ---- 1a. 401 on a READ returns SESSION_EXPIRED (not mirror rows) -----
{
  const { sandbox, session } = await loadShim({ probe: 'ok', post: '401', tokens: { alhuda_teacher_token: 'dead-token' } });
  const res = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('401 on read: error code is SESSION_EXPIRED', res && res.error && res.error.code === 'SESSION_EXPIRED', JSON.stringify(res && res.error));
  check('401 on read: data is null (no stale mirror presented)', res && res.data === null, JSON.stringify(res && res.data));
  check('401 on read: dead token cleared', session.getItem('alhuda_teacher_token') === null);
}

// ---- 1b. Live success is tagged d1; mirror fallback tagged mirror ---
{
  const { sandbox } = await loadShim({ probe: 'ok', post: 'ok' });
  const live = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('live read: _lmsSource is d1', live && live._lmsSource === 'd1', String(live && live._lmsSource));

  const m = await loadShim({ probe: '500', post: 'ok', mirror: mirrorSeed({ class_schedules: [{ id: 'SCH-M1', teacher_id: 'TCH-1' }] }) });
  const mir = await m.sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('mirror read: _lmsSource is mirror', mir && mir._lmsSource === 'mirror', String(mir && mir._lmsSource));
  check('mirror read: error is null but rows come from mirror', mir && mir.error === null && Array.isArray(mir.data) && mir.data.length === 1 && mir.data[0].id === 'SCH-M1', JSON.stringify(mir && mir.data));
}

// ---- 1c. Pre-login probe 401: NO session-expired prompt --------------
{
  const { sandbox } = await loadShim({ probe: '401', post: 'ok', mirror: mirrorSeed({}) });
  const res = await sandbox.db.from('class_schedules').select('*').eq('teacher_id', 'TCH-1');
  check('pre-login probe 401: no SESSION_EXPIRED error', !(res && res.error && res.error.code === 'SESSION_EXPIRED'), JSON.stringify(res && res.error));
  check('pre-login probe 401: falls back to mirror (empty, not an error)', res && res._lmsSource === 'mirror' && res.error === null, JSON.stringify({ s: res && res._lmsSource, e: res && res.error }));
}

// ---- 1d. Probe-settled helper exists and resolves ---------------------
{
  const { sandbox } = await loadShim({ probe: 'ok', post: 'ok' });
  check('waitForD1ProbeSettled is exposed', typeof sandbox.window.waitForD1ProbeSettled === 'function');
  const settled = await sandbox.window.waitForD1ProbeSettled();
  check('waitForD1ProbeSettled resolves true on a live probe', settled === true, String(settled));
}

// ---- 2. Admin PKT helper (real source from config.js) -----------------
{
  const start = CONFIG_SRC.indexOf('function getAdminPktNowParts()');
  const end = CONFIG_SRC.indexOf('window.getAdminPktNowParts', start);
  check('PKT helper: extractable from config.js source', start !== -1 && end > start);
  if (start !== -1 && end > start) {
    const fnSrc = CONFIG_SRC.slice(start, end);
    check('PKT helper: uses Asia/Karachi (not UTC)', fnSrc.includes('Asia/Karachi'));
    const sb = { console };
    vm.createContext(sb);
    vm.runInContext(fnSrc + '\nthis.__pkt = getAdminPktNowParts;', sb);
    const pkt = sb.__pkt();
    check('PKT helper: date is YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(pkt.date), pkt.date);
    check('PKT helper: day is Mon=1..Sun=7', pkt.day >= 1 && pkt.day <= 7, String(pkt.day));
    const dow = new Date(Date.UTC(...pkt.date.split('-').map((v, i) => i === 1 ? Number(v) - 1 : Number(v)), 12)).getUTCDay();
    check('PKT helper: day matches the weekday of its date', pkt.day === (dow === 0 ? 7 : dow), `${pkt.date} day=${pkt.day} dow=${dow}`);
    check('PKT helper: minutes in range', pkt.minutes >= 0 && pkt.minutes < 1440, String(pkt.minutes));
    const intlParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const intlDate = `${intlParts.find(p => p.type === 'year').value}-${intlParts.find(p => p.type === 'month').value}-${intlParts.find(p => p.type === 'day').value}`;
    check('PKT helper: date equals independent Intl PKT date', pkt.date === intlDate, `${pkt.date} vs ${intlDate}`);
  }
}

// ---- 3. Dashboard render: degraded must never read as "no classes" ---
class FakeEl {
  constructor() {
    this._cls = new Set(['hidden']);
    this.innerText = ''; this.innerHTML = ''; this.value = '';
    this.classList = { add: (...c) => c.forEach(x => this._cls.add(x)), remove: (...c) => c.forEach(x => this._cls.delete(x)), contains: (c) => this._cls.has(c) };
  }
}
{
  const els = new Map();
  const getEl = (id) => { if (!els.has(id)) els.set(id, new FakeEl()); return els.get(id); };
  const sandbox = {
    console, setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {},
    document: { getElementById: getEl, addEventListener: () => {}, createElement: () => new FakeEl(), body: new FakeEl(), hidden: false },
    location: { hostname: 'test' },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.window.innerWidth = 1200; sandbox.addEventListener = () => {}; sandbox.dispatchEvent = () => {};
  vm.createContext(sandbox);
  vm.runInContext(DASH_SRC, sandbox);
  const render = (classes, degraded, filter = 'all') => {
    vm.runInContext(`DASHBOARD_CLASSES = ${JSON.stringify(classes)}; DASH_CLASSES_DEGRADED = ${JSON.stringify(degraded)}; CURRENT_DASH_FILTER = ${JSON.stringify(filter)}; renderDashboardClassesTable();`, sandbox);
  };
  const banner = () => els.get('dashClassesStatusBanner');
  const empty = () => els.get('dashEmptyState');
  const row = { id: 'S1', start_time: '10:00', end_time: '10:30', students: { name: 'Synthetic Student', id: 'ST-1' }, teachers: { full_name: 'Synthetic Teacher' }, courses: { name: 'Quran Studies' }, startMin: 600, endMin: 630, isLive: false, isCurrentSlot: false, isRunningMarked: false, isPast: false, isUpcoming: true, isTrial: false, isLeaveStudent: false, status: 'SCHEDULED', badgeClass: '', filterCategory: 'remaining', log: null };

  render([], null);
  check('render clean+empty: banner hidden, empty state shown', banner()._cls.has('hidden') && !empty()._cls.has('hidden') && els.get('dashEmptyStateTitle').innerText === 'No Classes Scheduled Today');

  render([], { kind: 'mirror' });
  check('render degraded+empty: banner shown with Retry, empty state hidden', !banner()._cls.has('hidden') && banner().innerHTML.includes('Retry') && empty()._cls.has('hidden'));

  render([], { kind: 'session' });
  check('render session-expired+empty: login prompt shown, empty state hidden', banner().innerHTML.includes('Session expired') && banner().innerHTML.includes('Log in again') && empty()._cls.has('hidden'));

  render([row], { kind: 'mirror' });
  check('render degraded+rows: stale banner shown AND rows rendered', !banner()._cls.has('hidden') && banner().innerHTML.includes('offline') && els.get('dashClassesTableBody').innerHTML.includes('Synthetic Student'));

  render([row], null);
  check('render clean+rows: banner hidden, rows rendered', banner()._cls.has('hidden') && els.get('dashClassesTableBody').innerHTML.includes('Synthetic Student'));
}

const failed = results.filter(x => !x.pass).length;
console.log(`\nslow-classes-recovery: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
