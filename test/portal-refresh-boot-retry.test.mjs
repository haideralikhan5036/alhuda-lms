// Portal refresh: a VALID session must survive a page refresh even when
// the boot-time server re-check fails transiently (regression
// investigation 2026-11-17).
//
// Root cause: the three boots that re-verify the record against the
// backend — teacherBootOnReady (teacher.html), initializePortal
// (parent.html), managerBootOnReady (manager.html) — make ONE attempt
// and treat ANY failure (network blip, Worker cold start, slow probe,
// mirror miss) exactly like an invalid session, dropping the user to
// the login screen. The login POSTs retry 3x (PRs #140/#142) but the
// boots never got the same treatment. The manager boot is worst:
// fetchManagersFromBackend swallows every error into {managers: []},
// so a transient failure DELETES the valid token.
//
// The fix (per portal): retry the re-check up to 3 attempts with the
// same [700, 1500]ms backoff as the login retry; only an AUTHORITATIVE
// failure drops to login (a SESSION_EXPIRED error, or a live 'd1'
// answer with no eligible record). After exhausted transient failures
// the teacher/parent boots restore the session snapshot the login flow
// already stored in sessionStorage (tab-close still ends it — the
// snapshot lives in sessionStorage, and every data call still needs
// the valid token; a 401 still routes to login). The manager boot
// keeps the token on transient failure instead of deleting it.
//
// This suite EXECUTES the real boot functions in vm worlds with a
// scripted db stub (house pattern). setTimeout stays real so the
// backoff is genuinely exercised; delays are recorded and asserted.
// Run from the repo root:  node test/portal-refresh-boot-retry.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHER = read('teacher.html');
const PARENT = read('parent.html');
const MANAGER = read('manager.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// Brace-aware extractor: strings, template literals (with ${}
// interpolation), and comments must not disturb the brace count —
// parseEmployeeMeta contains the string literal '{', which breaks a
// naive counter and would swallow the rest of the script block.
// The body's opening brace is the first '{' AFTER the parameter
// list closes, so default values such as `accountsMap = {}` cannot
// end the extraction early.
function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = start;
  let pdepth = 0;
  let inParams = false;
  let paramsDone = false;
  let depth = 0;
  const stack = [{ kind: 'code' }];
  for (; i < src.length; i++) {
    const ch = src[i];
    const top = stack[stack.length - 1];
    if (top.kind === 'single' || top.kind === 'double') {
      if (ch === '\\') { i++; continue; }
      if ((top.kind === 'single' && ch === "'") || (top.kind === 'double' && ch === '"')) stack.pop();
      continue;
    }
    if (top.kind === 'line') { if (ch === '\n') stack.pop(); continue; }
    if (top.kind === 'block') { if (ch === '*' && src[i + 1] === '/') { stack.pop(); i++; } continue; }
    if (top.kind === 'template') {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') { stack.pop(); continue; }
      if (ch === '$' && src[i + 1] === '{') {
        stack.push({ kind: 'code', interp: true, entryDepth: depth });
        i++; depth++;
        continue;
      }
      continue;
    }
    if (ch === "'") { stack.push({ kind: 'single' }); continue; }
    if (ch === '"') { stack.push({ kind: 'double' }); continue; }
    if (ch === '`') { stack.push({ kind: 'template' }); continue; }
    if (ch === '/' && src[i + 1] === '/') { stack.push({ kind: 'line' }); i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { stack.push({ kind: 'block' }); i++; continue; }
    if (!paramsDone) {
      if (ch === '(') { pdepth++; inParams = true; continue; }
      if (ch === ')') {
        pdepth--;
        if (inParams && pdepth === 0) paramsDone = true;
        continue;
      }
      continue;
    }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0 && stack.length === 1) { i++; break; }
      if (top.interp && depth === top.entryDepth) stack.pop();
      continue;
    }
  }
  return src.slice(start, i);
}

function makeToken(role, sub, expInSec = 3600) {
  const payload = Buffer.from(JSON.stringify({
    role, sub, exp: Math.floor(Date.now() / 1000) + expInSec,
  })).toString('base64url');
  return payload + '.sig';
}

class FakeEl {
  constructor(id) {
    this.id = id; this.value = ''; this.innerHTML = ''; this.innerText = '';
    this.style = {}; this.files = [];
    const set = new Set();
    this.classList = {
      add: (...cs) => cs.forEach(c => set.add(c)),
      remove: (...cs) => cs.forEach(c => set.delete(c)),
      contains: (c) => set.has(c),
      toggle: (c, force) => {
        if (force === undefined) { set.has(c) ? set.delete(c) : set.add(c); return set.has(c); }
        force ? set.add(c) : set.delete(c); return !!force;
      },
    };
    this._set = set;
  }
  closest() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
}

function makeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

// A chainable db stub: from(table).select().eq()/order().single() is
// awaited directly. Outcomes are scripted per table as a queue of
// { data, error, source } or { throw: 'message' }.
function makeDbStub(script) {
  const calls = [];
  const db = {
    from(table) {
      const q = {
        _table: table,
        select() { return q; },
        eq() { return q; },
        order() { return q; },
        single() { return q; },
        then(onF, onR) {
          calls.push(table);
          const queue = script[table] || [];
          const next = queue.length ? queue.shift() : { data: null, error: null, source: 'd1' };
          if (next && next.throw) return Promise.reject(new Error(next.throw)).then(onF, onR);
          const res = { data: next.data ?? null, error: next.error ?? null };
          if (next.source) res._lmsSource = next.source;
          return Promise.resolve(res).then(onF, onR);
        },
      };
      return q;
    },
    _calls: calls,
  };
  return db;
}

function baseSandbox(pathname) {
  const els = {};
  const el = (id) => {
    if (!els[id]) els[id] = new FakeEl(id);
    return els[id];
  };
  const delays = [];
  const realSetTimeout = setTimeout;
  const sandbox = {
    console,
    // vm contexts have no atob/btoa: the token decoders need them.
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    document: {
      getElementById: (id) => {
        if (!els[id]) els[id] = new FakeEl(id);
        return els[id];
      },
      addEventListener() {},
      readyState: 'complete',
    },
    localStorage: makeStore(),
    sessionStorage: makeStore(),
    setTimeout: (fn, ms) => { delays.push(ms); return realSetTimeout(fn, ms); },
    clearTimeout: (id) => clearTimeout(id),
    setInterval: () => 0,
    clearInterval: () => {},
    innerWidth: 800,
    __delays: delays,
    __el: el,
    __els: els,
  };
  sandbox.window = sandbox;
  sandbox.location = {
    pathname, search: '', hash: '',
    replace: (u) => { sandbox.__replaced = u; },
    reload: () => {},
  };
  sandbox.history = { replaceState: () => {}, pushState: () => {} };
  return sandbox;
}

// ---------------------------------------------------------------------
// TEACHER BOOT
// ---------------------------------------------------------------------
function teacherEnv(script, { snapshot = true } = {}) {
  const sandbox = baseSandbox('/teacher.html');
  const db = makeDbStub(script);
  sandbox.db = db;
  sandbox.__dbCalls = db._calls;
  sandbox.toggleDesktopSidebar = () => {};
  sandbox.restoreTeacherSalaryGroupState = () => {};
  sandbox.restoreTeacherTabFromHash = () => {};
  sandbox.loadTeacherPortalDataCalls = 0;
  sandbox.loadTeacherPortalData = () => { sandbox.loadTeacherPortalDataCalls++; };
  sandbox.sessionStorage.setItem('alhuda_teacher_token', makeToken('teacher', 'TCH-1'));
  if (snapshot) {
    sandbox.sessionStorage.setItem('alhuda_teacher_session', JSON.stringify({
      id: 'TCH-1', full_name: 'Test Teacher', working_shift: 'Morning',
      zoom_link: '', username: 'test', status: 'Active',
    }));
  }
  const parts = [
    'let CURRENT_TEACHER = null;',
    extractFunction(TEACHER, 'parseEmployeeMeta'),
    extractFunction(TEACHER, 'classifyEmployeeRole'),
    extractFunction(TEACHER, 'isEligibleTeacherAccount'),
    extractFunction(TEACHER, 'normalizeTeacherSession'),
    extractFunction(TEACHER, 'decodeJwtPayload'),
    extractFunction(TEACHER, 'getTeacherToken'),
    extractFunction(TEACHER, 'clearTeacherToken'),
    extractFunction(TEACHER, 'showDashboardView'),
    extractFunction(TEACHER, 'showLoginView'),
    extractFunction(TEACHER, 'teacherBootOnReady'),
  ];
  vm.createContext(sandbox);
  vm.runInContext(parts.join('\n'), sandbox);
  const run = (expr) => vm.runInContext(expr, sandbox);
  return {
    sandbox, run,
    dashboardShown: () => !sandbox.__els['dashboardView']._set.has('hidden') && sandbox.__els['loginView']._set.has('hidden'),
    loginShown: () => !sandbox.__els['loginView']._set.has('hidden'),
    tokenKept: () => !!sandbox.sessionStorage.getItem('alhuda_teacher_token'),
    teacherCalls: () => db._calls.filter(t => t === 'teachers').length,
  };
}
const TEACHER_ROW = { id: 'TCH-1', full_name: 'Test Teacher', status: 'Active', working_shift: 'Morning', zoom_link: '', address: '{}' };

// T1: transient failures, then success -> dashboard, token kept, backoff used
{
  const env = teacherEnv({ teachers: [{ throw: 'network down' }, { throw: 'network down' }, { data: TEACHER_ROW, source: 'd1' }] });
  await env.run('teacherBootOnReady()');
  check('teacher boot: two transient failures then success still restores the dashboard',
    env.dashboardShown(), 'loginShown=' + env.loginShown());
  check('teacher boot: token kept after transient failures', env.tokenKept());
  check('teacher boot: re-check retried with the login backoff [700, 1500]',
    JSON.stringify(env.sandbox.__delays) === JSON.stringify([700, 1500]),
    'delays=' + JSON.stringify(env.sandbox.__delays));
  check('teacher boot: exactly 3 re-check attempts', env.teacherCalls() === 3, 'calls=' + env.teacherCalls());
}

// T2: SESSION_EXPIRED -> login at once, no retry
{
  const env = teacherEnv({ teachers: [{ data: null, error: { message: 'Session expired', code: 'SESSION_EXPIRED' }, source: 'd1' }] });
  await env.run('teacherBootOnReady()');
  check('teacher boot: SESSION_EXPIRED drops to login immediately', env.loginShown());
  check('teacher boot: SESSION_EXPIRED is not retried', env.teacherCalls() === 1, 'calls=' + env.teacherCalls());
}

// T3: all attempts fail transiently, snapshot present -> dashboard from snapshot
{
  const env = teacherEnv({ teachers: [{ throw: 'down' }, { throw: 'down' }, { throw: 'down' }] });
  await env.run('teacherBootOnReady()');
  check('teacher boot: exhausted transient failures restore the dashboard from the session snapshot',
    env.dashboardShown(), 'loginShown=' + env.loginShown());
  check('teacher boot: token kept when the dashboard is restored from the snapshot', env.tokenKept());
  check('teacher boot: snapshot restore still loads portal data (live re-verify follows)',
    env.sandbox.loadTeacherPortalDataCalls === 1, 'calls=' + env.sandbox.loadTeacherPortalDataCalls);
}

// T4: all attempts fail transiently, NO snapshot -> login, but the token is kept
{
  const env = teacherEnv({ teachers: [{ throw: 'down' }, { throw: 'down' }, { throw: 'down' }] }, { snapshot: false });
  await env.run('teacherBootOnReady()');
  check('teacher boot: no snapshot + exhausted failures falls back to login', env.loginShown());
  check('teacher boot: transient failure never deletes the valid token', env.tokenKept());
}

// T5: live answer with no record -> authoritative, login after ONE attempt
{
  const env = teacherEnv({ teachers: [{ data: null, error: null, source: 'd1' }] });
  await env.run('teacherBootOnReady()');
  check('teacher boot: live answer with no teacher record drops to login', env.loginShown());
  check('teacher boot: authoritative absence is not retried', env.teacherCalls() === 1, 'calls=' + env.teacherCalls());
}

// T6: mirror answer WITH the row -> dashboard (mirror rows are usable)
{
  const env = teacherEnv({ teachers: [{ data: TEACHER_ROW, source: 'mirror' }] });
  await env.run('teacherBootOnReady()');
  check('teacher boot: mirror answer carrying the teacher row restores the dashboard',
    env.dashboardShown());
}

// T7: expired token -> removed, login shown
{
  const env = teacherEnv({ teachers: [] });
  env.sandbox.sessionStorage.setItem('alhuda_teacher_token', makeToken('teacher', 'TCH-1', -10));
  await env.run('teacherBootOnReady()');
  check('teacher boot: expired token is removed and login is shown',
    env.loginShown() && !env.tokenKept());
}

// ---------------------------------------------------------------------
// PARENT BOOT
// ---------------------------------------------------------------------
function parentEnv(script, { snapshot = true } = {}) {
  const sandbox = baseSandbox('/parent.html');
  const db = makeDbStub(script);
  sandbox.db = db;
  sandbox.populateStudentDropdown = () => {};
  sandbox.renderCurrentStudentData = async () => {};
  sandbox.renderPortalLibrary = () => {};
  sandbox.restoreParentTabFromHash = () => {};
  sandbox.sessionStorage.setItem('alhuda_parent_token', makeToken('parent', 'FAM-1'));
  if (snapshot) {
    sandbox.sessionStorage.setItem('alhuda_parent_session', JSON.stringify({
      family_id: 'FAM-1', parent_name: 'Test Parent', selected_student_id: null,
    }));
  }
  const parts = [
    'let CURRENT_AUTH_FAMILY = null; let ALL_STUDENTS = []; let CURRENT_STUDENT = null;',
    extractFunction(PARENT, 'decodeParentJwtPayload'),
    extractFunction(PARENT, 'getParentToken'),
    extractFunction(PARENT, 'clearParentToken'),
    extractFunction(PARENT, 'showParentLoginView'),
    extractFunction(PARENT, 'showParentDashboardView'),
    extractFunction(PARENT, 'initializePortal'),
  ];
  vm.createContext(sandbox);
  vm.runInContext(parts.join('\n'), sandbox);
  const run = (expr) => vm.runInContext(expr, sandbox);
  return {
    sandbox, run,
    dashboardShown: () => sandbox.__els['parentLoginView']._set.has('hidden') && !sandbox.__els['parentMainPortalContent']._set.has('hidden'),
    loginShown: () => !sandbox.__els['parentLoginView']._set.has('hidden'),
    tokenKept: () => !!sandbox.sessionStorage.getItem('alhuda_parent_token'),
    familiesCalls: () => db._calls.filter(t => t === 'families').length,
  };
}
const FAMILY_ROW = { id: 'FAM-1', parent_name: 'Test Parent', status: 'Active' };

// P1: transient failures, then success -> dashboard
{
  const env = parentEnv({
    families: [{ throw: 'network down' }, { throw: 'network down' }, { data: FAMILY_ROW, source: 'd1' }],
    students: [{ data: [{ id: 'STU-1', family_id: 'FAM-1', name: 'Kid', status: 'Active' }], source: 'd1' }],
  });
  await env.run('initializePortal()');
  check('parent boot: two transient failures then success still restores the dashboard',
    env.dashboardShown(), 'loginShown=' + env.loginShown());
  check('parent boot: token kept after transient failures', env.tokenKept());
  check('parent boot: re-check retried with the login backoff [700, 1500]',
    JSON.stringify(env.sandbox.__delays) === JSON.stringify([700, 1500]),
    'delays=' + JSON.stringify(env.sandbox.__delays));
}

// P2: SESSION_EXPIRED -> login at once, no retry
{
  const env = parentEnv({
    families: [{ data: null, error: { message: 'Session expired', code: 'SESSION_EXPIRED' }, source: 'd1' }],
  });
  await env.run('initializePortal()');
  check('parent boot: SESSION_EXPIRED drops to login immediately', env.loginShown());
  check('parent boot: SESSION_EXPIRED is not retried', env.familiesCalls() === 1, 'calls=' + env.familiesCalls());
}

// P3: all attempts fail transiently, snapshot present -> dashboard from snapshot
{
  const env = parentEnv({ families: [{ throw: 'down' }, { throw: 'down' }, { throw: 'down' }] });
  await env.run('initializePortal()');
  check('parent boot: exhausted transient failures restore the dashboard from the session snapshot',
    env.dashboardShown(), 'loginShown=' + env.loginShown());
  check('parent boot: token kept when the dashboard is restored from the snapshot', env.tokenKept());
}

// P4: live answer with no family -> authoritative, login after ONE attempt
{
  const env = parentEnv({ families: [{ data: null, error: null, source: 'd1' }] });
  await env.run('initializePortal()');
  check('parent boot: live answer with no family record drops to login', env.loginShown());
  check('parent boot: authoritative absence is not retried', env.familiesCalls() === 1, 'calls=' + env.familiesCalls());
}

// ---------------------------------------------------------------------
// MANAGER BOOT (manager.html gate page)
// ---------------------------------------------------------------------
function managerEnv(script) {
  const sandbox = baseSandbox('/manager.html');
  const db = makeDbStub(script);
  sandbox.db = db;
  sandbox.sessionStorage.setItem('alhuda_manager_token', makeToken('manager', 'TCH-MGR'));
  const parts = [
    extractFunction(MANAGER, 'parseEmployeeMeta'),
    extractFunction(MANAGER, 'classifyEmployeeRole'),
    extractFunction(MANAGER, 'isEligibleManagerAccount'),
    extractFunction(MANAGER, 'resolveManagerCredentials'),
    extractFunction(MANAGER, 'decodeJwtPayload'),
    extractFunction(MANAGER, 'fetchManagersFromBackend'),
    extractFunction(MANAGER, 'managerBootOnReady'),
  ];
  vm.createContext(sandbox);
  vm.runInContext(parts.join('\n'), sandbox);
  const run = (expr) => vm.runInContext(expr, sandbox);
  return {
    sandbox, run,
    redirected: () => sandbox.__replaced === 'index.html?role=manager',
    formShown: () => { const e = sandbox.__els['managerLoginContainer']; return !!e && !e._set.has('hidden'); },
    tokenKept: () => !!sandbox.sessionStorage.getItem('alhuda_manager_token'),
    teachersCalls: () => db._calls.filter(t => t === 'teachers').length,
  };
}
const MANAGER_ROW = {
  id: 'TCH-MGR', full_name: 'Haider Ali Khan', status: 'Active',
  address: JSON.stringify({ employee_type: 'manager', emp_id: 'MGR-001', username: 'haider' }),
};
const PLAIN_TEACHER_ROW = { id: 'TCH-9', full_name: 'Some Teacher', status: 'Active', address: '{}' };

// M1: transient failures, then success -> redirect into the portal
{
  const env = managerEnv({
    teachers: [{ throw: 'network down' }, { throw: 'network down' }, { data: [MANAGER_ROW], source: 'd1' }],
    families: [{ data: [], source: 'd1' }],
  });
  await env.run('managerBootOnReady()');
  check('manager boot: two transient failures then success still redirects into the portal',
    env.redirected(), 'formShown=' + env.formShown());
  check('manager boot: token kept after transient failures', env.tokenKept());
  check('manager boot: re-check retried with the login backoff [700, 1500]',
    JSON.stringify(env.sandbox.__delays) === JSON.stringify([700, 1500]),
    'delays=' + JSON.stringify(env.sandbox.__delays));
}

// M2: all attempts fail transiently -> form shown, but the token is KEPT
{
  const env = managerEnv({
    teachers: [{ throw: 'down' }, { throw: 'down' }, { throw: 'down' }],
    families: [{ data: [], source: 'd1' }],
  });
  await env.run('managerBootOnReady()');
  check('manager boot: exhausted transient failures show the login form', env.formShown());
  check('manager boot: transient failure never deletes the valid token', env.tokenKept());
  check('manager boot: no redirect on transient failure', !env.redirected());
}

// M3: live answer, manager genuinely not found -> token deleted (authoritative)
{
  const env = managerEnv({
    teachers: [{ data: [PLAIN_TEACHER_ROW], source: 'd1' }],
    families: [{ data: [], source: 'd1' }],
  });
  await env.run('managerBootOnReady()');
  check('manager boot: live answer with no manager record deletes the token and shows the form',
    env.formShown() && !env.tokenKept());
  check('manager boot: authoritative absence is not retried', env.teachersCalls() === 1, 'calls=' + env.teachersCalls());
}

// M4: happy path still redirects
{
  const env = managerEnv({
    teachers: [{ data: [MANAGER_ROW], source: 'd1' }],
    families: [{ data: [], source: 'd1' }],
  });
  await env.run('managerBootOnReady()');
  check('manager boot: valid token + eligible record redirects into the portal', env.redirected());
}

const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
process.exit(failed.length ? 1 : 0);
