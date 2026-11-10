// Owner login redesign — the skin on #ownerLoginView in index.html.
// Originally the 2026-11-07 split-card (lgn-) skin; RE-SKINNED
// 2026-11-10 to the Fee Management portal login design (flg-) on the
// owner's instruction, like the other three portals. This suite
// proves, against the REAL index.html and the REAL js/auth.js
// functions:
//   1. only the login region changed skin: every preserved element
//      (ids, labels, input attributes, submit handler, password
//      toggle wiring, error box) is intact, the new flg- landmarks
//      are present, and NO flagship aui- classes leaked into the
//      gate (shell styles stay out, login styles stay in);
//   2. the PR #127 guarantees survive: the view is still the fixed
//      inset-0 gate under the body zoom (desktop-scoped to >=1024px
//      since the 2026-11-10 owner mobile fix), and the stacked
//      mobile layout lives below the 1024px portal breakpoint;
//   3. the REAL auth functions, executed in a vm over a fake DOM
//      built from the REAL markup, keep the exact show/hide
//      contract: boot with no session shows the new login, boot with
//      a restored owner session NEVER shows it, a failed sign-in
//      surfaces the real error box inside the new card, a successful
//      sign-in hides the gate and opens the flagship shell, the
//      password toggle flips type + icon, and logout returns to the
//      new login view with the fields cleared.
// Run from the repo root:  node test/login-redesign-admin.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INDEX = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const AUTH_JS = fs.readFileSync(path.join(REPO_ROOT, 'js/auth.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('PASS | ' + name); }
  else { failed++; console.log('FAIL | ' + name + (detail ? ' :: ' + detail : '')); }
}
const count = (hay, needle) => hay.split(needle).length - 1;

// The login region: the view div up to the app wrapper.
const LOGIN = INDEX.slice(INDEX.indexOf('<div id="ownerLoginView"'),
  INDEX.indexOf('<div id="mainAppWrapper"'));

// ---------------------------------------------------------------------
// Part A — structure: preserved contract + new landmarks
// ---------------------------------------------------------------------
for (const id of ['ownerLoginView', 'ownerLoginUsername', 'ownerLoginPassword',
  'ownerPassToggleIcon', 'btnSubmitOwnerLogin', 'ownerLoginErrorMsg', 'ownerLoginErrorText']) {
  check(`preserved id exists exactly once: ${id}`, count(INDEX, `id="${id}"`) === 1);
  check(`preserved id lives inside the login view: ${id}`, LOGIN.includes(`id="${id}"`));
}
check('view still starts hidden (no flash before boot decides)',
  LOGIN.startsWith('<div id="ownerLoginView" class="hidden '));
check('view carries the fee-style backdrop class (dark #06382a via .flg-screen)',
  LOGIN.includes('flg-screen'));
check('form keeps the real submit handler + autocomplete off',
  LOGIN.includes('<form id="ownerLoginForm" onsubmit="handleOwnerSignIn(event)" class="flg-form" autocomplete="off">'));
check('username input keeps its real attributes',
  LOGIN.includes('<input type="text" id="ownerLoginUsername" required placeholder="Enter username" autocomplete="username"'));
check('password input keeps its real attributes',
  LOGIN.includes('<input type="password" id="ownerLoginPassword" required placeholder="Enter password" autocomplete="current-password"'));
check('labels keep their for= wiring + real text',
  LOGIN.includes('<label for="ownerLoginUsername"') && LOGIN.includes('Username / Admin ID') &&
  LOGIN.includes('<label for="ownerLoginPassword"') && LOGIN.includes('Password'));
check('password toggle keeps its real wiring + aria-label',
  LOGIN.includes('onclick="toggleOwnerPassVisibility()"') &&
  LOGIN.includes('aria-label="Show or hide password"') &&
  LOGIN.includes('<i id="ownerPassToggleIcon" class="fa-regular fa-eye"></i>'));
check('error box keeps its ids + default text',
  LOGIN.includes('id="ownerLoginErrorMsg"') && LOGIN.includes('id="ownerLoginErrorText"') &&
  LOGIN.includes('Invalid username or password.'));
check('submit keeps its real label',
  LOGIN.includes('id="btnSubmitOwnerLogin"') && LOGIN.includes('Login to Control Center'));
check('brand block is the real one (logo, name, tagline, heading, sub, footer)',
  LOGIN.includes('<img class="flg-logo" src="alhuda_logo.jpg" alt="Al-Huda Islamic Centre">') &&
  LOGIN.includes('AL-HUDA ISLAMIC CENTRE') && LOGIN.includes('Owner &amp; Admin Control Center') &&
  LOGIN.includes('Owner &amp; Director Login') &&
  LOGIN.includes('Sign in with authorized credentials to access LMS Admin') &&
  LOGIN.includes('&copy; 2026 Al-Huda Islamic Centre. Authorized personnel only.'));

check('new landmarks: centred dark card + neumorphic deco shapes',
  LOGIN.includes('class="flg-card"') && LOGIN.includes('class="flg-deco"') &&
  LOGIN.includes('class="flg-nd flg-nd-halo"'));
check('new landmarks: dark pill fields + gold pill CTA with dots/done states',
  count(LOGIN, 'class="flg-pill"') === 2 && LOGIN.includes('class="flg-cta"') &&
  LOGIN.includes('class="flg-dots"') && LOGIN.includes('class="flg-done"'));
check('new landmarks: button wrap + confetti layer for the success burst',
  LOGIN.includes('id="ownerLoginBtnWrap"') && LOGIN.includes('id="ownerLoginConfettiLayer"') &&
  LOGIN.includes('Signed In') && LOGIN.includes('Secure Authentication System'));
check('NO flagship aui- classes inside the login view', !LOGIN.includes('aui-'));
// Desktop split layout (2026-11-10, owner-approved mockup v2):
// brand panel left + form column right at >=1024px; the stacked
// card below the breakpoint is untouched in presentation.
check('split landmarks: brand panel + form column + halo + deco + panel copy',
  LOGIN.includes('class="flg-brand-panel"') && LOGIN.includes('class="flg-form-col"') &&
  LOGIN.includes('class="flg-logo-halo"') && LOGIN.includes('class="flg-brand-deco"') &&
  LOGIN.includes('class="flg-bd-ring"') && LOGIN.includes('class="flg-bd-circle"') &&
  LOGIN.includes('class="flg-bd-dots"') && LOGIN.includes('class="flg-bd-gold"') &&
  LOGIN.includes('class="flg-panel-copy"'));
check('split: outside copy line tagged for desktop hiding (still the mobile line)',
  LOGIN.includes('relative flg-outside-copy'));
check('split: brand panel precedes the form column inside the card',
  LOGIN.indexOf('class="flg-brand-panel"') > LOGIN.indexOf('class="flg-card"') &&
  LOGIN.indexOf('class="flg-form-col"') > LOGIN.indexOf('class="flg-brand-panel"'));
check('old centred-card skin is gone',
  !LOGIN.includes('max-w-md w-full my-auto') &&
  !LOGIN.includes('bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden'));
check('the 2026-11-07 split-card skin is fully gone', !LOGIN.includes('lgn-'));

// ---------------------------------------------------------------------
// Part B — the CSS contract (PR #127 + the flg- stylesheet)
// ---------------------------------------------------------------------
check('PR #127: view is still the fixed inset-0 gate with safe centring',
  /#ownerLoginView \{\s*position: fixed;\s*inset: 0;\s*overflow-y: auto;\s*justify-content: safe center;\s*\}/.test(INDEX));
// RE-PINNED 2026-11-10 (owner mobile fix): the PR #127 body zoom is
// now scoped to desktop widths — unscoped it painted the portal at
// 85% width on phones (blank strip down the right edge). Desktop
// keeps the exact same 85% scale; no unscoped body zoom may remain.
check('PR #127: portal scale stays 85% on desktop only (body zoom media-scoped, 2026-11-10 mobile fix)',
  INDEX.includes('@media (min-width: 1024px) { body { zoom: 0.85; } }') &&
  !INDEX.replace('@media (min-width: 1024px) { body { zoom: 0.85; } }', '').includes('body { zoom'));
check('flg- stylesheet: dark card (radius 38) on the #06382a screen',
  INDEX.includes('.flg-card {') && INDEX.includes('border-radius: 38px') &&
  INDEX.includes('#06382a'));
check('flg- stylesheet: Batch 25 autofill override (fields never paint white)',
  INDEX.includes('input:-webkit-autofill') && INDEX.includes('0 0 0 1000px #06382a inset'));
check('flg- stylesheet: shake + confetti + dots keyframes present',
  INDEX.includes('@keyframes flgBtnShake') && INDEX.includes('@keyframes flgConfettiFly') &&
  INDEX.includes('@keyframes flgDotBounce'));
check('split stylesheet: wide grid card at the desktop breakpoint only',
  INDEX.includes('@media (min-width: 1024px)') &&
  INDEX.includes('grid-template-columns: 1.12fr 0.88fr') &&
  INDEX.includes('width: 1140px'));
check('split stylesheet: halo + gold hairline + split pieces hidden by default',
  INDEX.includes('.flg-logo-halo') && INDEX.includes('width: 218px; height: 218px') &&
  INDEX.includes('border-left: 1px solid rgba(197,168,128,.28)') &&
  INDEX.includes('.flg-panel-copy { display: none; }') &&
  INDEX.includes('.flg-outside-copy { display: none; }'));
check('split stylesheet: base card keeps the stacked 400px width (mobile unchanged)',
  /\.flg-card \{\s+position: relative; z-index: 1;\s+width: 400px;/.test(INDEX));
check('flg- stylesheet: deco shapes hidden on small screens',
  /@media \(max-width: 900px\) \{\s*\.flg-deco \{ display: none; \}/.test(INDEX));
check('flg- stylesheet: no global element selectors leak out of the gate',
  !/^\s*(section|form|input|button|img|h1|h2|p)\s*\{/m.test(
    INDEX.slice(INDEX.indexOf('.flg-screen {'), INDEX.indexOf('/* Responsive Mobile & Desktop Layout Engine */'))));

// ---------------------------------------------------------------------
// Part C — fake DOM from the REAL markup + REAL auth.js execution
// ---------------------------------------------------------------------
const mkStyle = () => { const s = {}; s.setProperty = (k, v) => { s[k] = v; }; return s; };
class FakeEl {
  constructor(id, classAttr, attrs) {
    this.id = id;
    this._set = new Set(String(classAttr || '').split(/\s+/).filter(Boolean));
    this._attrs = attrs || {};
    this.style = mkStyle();
    this.value = '';
    this.type = this._attrs.type || '';
    this.innerText = '';
    this.textContent = '';
    this.innerHTML = '';
    this.children = [];
    this.parentElement = null;
    this.disabled = false;
    this._listeners = {};
    this.classList = {
      add: (...cs) => cs.forEach(c => this._set.add(c)),
      remove: (...cs) => cs.forEach(c => this._set.delete(c)),
      contains: (c) => this._set.has(c),
    };
  }
  get className() { return [...this._set].join(' '); }
  set className(v) { this._set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  __fire(t) { (this._listeners[t] || []).forEach((fn) => fn({ preventDefault() {} })); }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  remove() {
    if (this.parentElement) {
      const i = this.parentElement.children.indexOf(this);
      if (i >= 0) this.parentElement.children.splice(i, 1);
      this.parentElement = null;
    }
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 55 }; }
}
function buildRegistry() {
  const registry = new Map();
  for (const m of INDEX.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const tag = m[0];
    const cls = (tag.match(/class="([^"]*)"/) || [])[1] || '';
    const type = (tag.match(/type="([^"]*)"/) || [])[1] || '';
    if (!registry.has(m[2])) registry.set(m[2], new FakeEl(m[2], cls, { type }));
  }
  return registry;
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
const b64url = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ownerToken = (exp) => b64url({ sub: 'Faheem', role: 'owner', exp }) + '.fakesig';

function boot({ fetchImpl } = {}) {
  const registry = buildRegistry();
  // The confetti layer's parent is the card in the real DOM.
  const layerEl = registry.get('ownerLoginConfettiLayer');
  const cardEl = registry.get('ownerLoginCard');
  if (layerEl && cardEl) layerEl.parentElement = cardEl;
  const observers = [];
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    disconnect() {}
  }
  const sessionStore = new Map();
  const localStore = new Map();
  const storage = (store) => ({
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  });
  const replaced = [];
  const sandbox = {
    console,
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    AbortController,
    setTimeout, clearTimeout,
    URLSearchParams,
    MutationObserver: FakeMutationObserver,
    sessionStorage: storage(sessionStore),
    localStorage: storage(localStore),
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
    document: {
      title: 'Admin',
      getElementById: (id) => registry.get(id) || null,
      querySelectorAll: () => [],
      createElement: (tag) => new FakeEl('', '', {}),
    },
  };
  sandbox.window = {
    location: {
      search: '', pathname: '/', hostname: 'alhuda-lms.vercel.app',
      replace: (u) => replaced.push(u),
    },
    history: { replaceState: () => {} },
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(`
    let CURRENT_ROLE = 'owner';
    let ACTIVE_MANAGER_ID = null;
    function closeModal() {}
    ${extractFunction(AUTH_JS, 'getWorkerBase')}
    ${extractFunction(AUTH_JS, 'callServerLogout')}
    ${extractFunction(AUTH_JS, 'getOwnerToken')}
    ${extractFunction(AUTH_JS, 'decodeTokenPayload')}
    ${extractFunction(AUTH_JS, 'getAuthenticatedOwnerSession')}
    ${extractFunction(AUTH_JS, 'showOwnerLoginView')}
    ${extractFunction(AUTH_JS, 'showMainAppView')}
    ${extractFunction(AUTH_JS, 'toggleOwnerPassVisibility')}
    ${extractFunction(AUTH_JS, 'handleOwnerSignIn')}
    ${extractFunction(AUTH_JS, 'handleTeacherLoginSubmit')}
    ${extractFunction(AUTH_JS, 'updateRoleHeaderBadge')}
    ${extractFunction(AUTH_JS, 'switchUserRole')}
    ${extractFunction(AUTH_JS, 'initRoleFromUrl')}
    ${extractFunction(AUTH_JS, 'logoutOwnerPortal')}
    this.__api = { showOwnerLoginView, showMainAppView, toggleOwnerPassVisibility,
      handleOwnerSignIn, handleTeacherLoginSubmit, initRoleFromUrl, logoutOwnerPortal };
  `, sandbox);
  // Run the REAL fee-style wiring script from index.html in the same
  // context, so the decorative button states are driven by the real
  // handler flow below (submit dispatch + the real error box / view
  // mutations the handler performs).
  const wiring = [...INDEX.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).find((code) => code.includes('Fee-style login states'));
  if (!wiring) throw new Error('fee-style wiring script not found in index.html');
  vm.runInContext(wiring, sandbox);
  const flushObservers = () => observers.forEach((o) => o.cb([], o));
  return { api: sandbox.__api, registry, sessionStore, localStore, replaced, flushObservers };
}
const loginShown = (r) => {
  const v = r.get('ownerLoginView');
  return !v.classList.contains('hidden') && v.classList.contains('flex');
};
const appShown = (r) => {
  const v = r.get('mainAppWrapper');
  return !v.classList.contains('hidden') && v.classList.contains('flex');
};

// --- show/hide contract, both directions ------------------------------
{
  const { api, registry } = boot();
  api.showOwnerLoginView();
  check('showOwnerLoginView shows the new gate + hides the shell',
    loginShown(registry) && !appShown(registry));
  api.showMainAppView();
  check('showMainAppView hides the gate + shows the shell',
    !loginShown(registry) && appShown(registry));
}

// --- password toggle: type + icon flip --------------------------------
{
  const { api, registry } = boot();
  const pass = registry.get('ownerLoginPassword');
  const icon = registry.get('ownerPassToggleIcon');
  check('toggle setup: password starts masked with the eye icon',
    pass.type === 'password' && icon.className === 'fa-regular fa-eye');
  api.toggleOwnerPassVisibility();
  check('toggle reveals the password + swaps to the eye-slash icon',
    pass.type === 'text' && icon.className === 'fa-regular fa-eye-slash');
  api.toggleOwnerPassVisibility();
  check('toggle masks it again + restores the eye icon',
    pass.type === 'password' && icon.className === 'fa-regular fa-eye');
}

// --- boot restore: no session -> gate; owner session -> never the gate
{
  const noSession = boot();
  const r1 = noSession.api.initRoleFromUrl();
  check('boot with no session lands on the new login view',
    r1 === false && loginShown(noSession.registry) && !appShown(noSession.registry));

  const restored = boot();
  restored.sessionStore.set('alhuda_owner_token',
    ownerToken(Math.floor(Date.now() / 1000) + 3600));
  const r2 = restored.api.initRoleFromUrl();
  check('boot with a restored owner session opens the shell, login never shown',
    r2 === true && !loginShown(restored.registry) && appShown(restored.registry));

  const expired = boot();
  expired.sessionStore.set('alhuda_owner_token',
    ownerToken(Math.floor(Date.now() / 1000) - 60));
  const r3 = expired.api.initRoleFromUrl();
  check('boot with an EXPIRED owner token falls back to the login view',
    r3 === false && loginShown(expired.registry) && !appShown(expired.registry));
}

// --- sign-in flows through the real handler ---------------------------
{
  const empty = boot();
  await empty.api.handleOwnerSignIn({ preventDefault() {} });
  check('empty submit shows the real error box with the empty-fields message',
    !empty.registry.get('ownerLoginErrorMsg').classList.contains('hidden') &&
    empty.registry.get('ownerLoginErrorText').innerText === 'Please enter both username and password.');

  const failed = boot({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }),
  });
  failed.api.showOwnerLoginView();
  failed.registry.get('ownerLoginUsername').value = 'Faheem';
  failed.registry.get('ownerLoginPassword').value = 'wrong';
  failed.registry.get('ownerLoginForm').__fire('submit');
  check('fee-style wiring: form submit applies the dots loading state',
    failed.registry.get('ownerLoginBtnWrap').classList.contains('flg-is-loading'));
  await failed.api.handleOwnerSignIn({ preventDefault() {} });
  failed.flushObservers();
  check('failed sign-in shows the real error inside the new card + stays on the gate',
    !failed.registry.get('ownerLoginErrorMsg').classList.contains('hidden') &&
    failed.registry.get('ownerLoginErrorText').innerText === 'Invalid username or password.' &&
    loginShown(failed.registry) && !appShown(failed.registry));
  check('fee-style wiring: the real failed login applies the shake state',
    failed.registry.get('ownerLoginBtnWrap').classList.contains('flg-is-error') &&
    !failed.registry.get('ownerLoginBtnWrap').classList.contains('flg-is-loading'));

  const good = boot({
    fetchImpl: async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, token: ownerToken(Math.floor(Date.now() / 1000) + 3600) }),
    }),
  });
  good.api.showOwnerLoginView();
  good.registry.get('ownerLoginUsername').value = 'Faheem';
  good.registry.get('ownerLoginPassword').value = 'correct';
  good.registry.get('ownerLoginForm').__fire('submit');
  check('fee-style wiring: submit on the success path applies the dots loading state',
    good.registry.get('ownerLoginBtnWrap').classList.contains('flg-is-loading'));
  await good.api.handleOwnerSignIn({ preventDefault() {} });
  good.flushObservers();
  check('successful sign-in stores the token, hides the gate, opens the flagship shell',
    !!good.sessionStore.get('alhuda_owner_token') &&
    good.localStore.get('alhuda_active_portal_role') === 'owner' &&
    !loginShown(good.registry) && appShown(good.registry) &&
    good.registry.get('ownerLoginErrorMsg').classList.contains('hidden'));
  check('fee-style wiring: real success applies the success state + bursts 30 confetti pieces',
    good.registry.get('ownerLoginBtnWrap').classList.contains('flg-is-success') &&
    good.registry.get('ownerLoginConfettiLayer').children.length === 30);
  check('sign-in recorded NO navigation away from index.html', good.replaced.length === 0);

  // --- logout returns to the NEW login view ---------------------------
  await good.api.logoutOwnerPortal();
  check('logout returns to the new login view with fields cleared + token wiped',
    loginShown(good.registry) && !appShown(good.registry) &&
    good.registry.get('ownerLoginUsername').value === '' &&
    good.registry.get('ownerLoginPassword').value === '' &&
    !good.sessionStore.get('alhuda_owner_token'));
}

// --- LOGIN RESILIENCE (2026-11-10): the real handlers retry transient
// failures instead of failing on the first dropped connection. The
// misleading setup-era "deploy the Worker" message is gone for good.
{
  check('the setup-era message is fully gone from js/auth.js',
    !AUTH_JS.includes('SECURITY-SETUP') &&
    !AUTH_JS.includes('Authentication server is not available') &&
    !INDEX.includes('SECURITY-SETUP'));
  check('the honest connection message replaced it',
    AUTH_JS.includes('Cannot reach the server right now. Check your internet connection and try again.'));

  const okResponse = () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, token: ownerToken(Math.floor(Date.now() / 1000) + 3600) }),
  });

  // (a) first fetch throws (dropped connection), second succeeds.
  let callsA = 0;
  const retryThrow = boot({
    fetchImpl: async () => {
      callsA++;
      if (callsA === 1) throw new Error('network down');
      return okResponse();
    },
  });
  retryThrow.api.showOwnerLoginView();
  retryThrow.registry.get('ownerLoginUsername').value = 'Faheem';
  retryThrow.registry.get('ownerLoginPassword').value = 'correct';
  await retryThrow.api.handleOwnerSignIn({ preventDefault() {} });
  check('owner login: network throw then success signs in, NO error shown',
    callsA === 2 && !!retryThrow.sessionStore.get('alhuda_owner_token') &&
    appShown(retryThrow.registry) &&
    retryThrow.registry.get('ownerLoginErrorMsg').classList.contains('hidden'));

  // (b) first response is a 503 edge status, second succeeds.
  let callsB = 0;
  const retry503 = boot({
    fetchImpl: async () => {
      callsB++;
      if (callsB === 1) return { ok: false, status: 503, json: async () => ({}) };
      return okResponse();
    },
  });
  retry503.api.showOwnerLoginView();
  retry503.registry.get('ownerLoginUsername').value = 'Faheem';
  retry503.registry.get('ownerLoginPassword').value = 'correct';
  await retry503.api.handleOwnerSignIn({ preventDefault() {} });
  check('owner login: 503 then success signs in, NO error shown',
    callsB === 2 && !!retry503.sessionStore.get('alhuda_owner_token') &&
    appShown(retry503.registry) &&
    retry503.registry.get('ownerLoginErrorMsg').classList.contains('hidden'));

  // (c) every attempt throws -> the NEW connection message, 3 attempts.
  let callsC = 0;
  const allDown = boot({
    fetchImpl: async () => { callsC++; throw new Error('network down'); },
  });
  allDown.api.showOwnerLoginView();
  allDown.registry.get('ownerLoginUsername').value = 'Faheem';
  allDown.registry.get('ownerLoginPassword').value = 'correct';
  await allDown.api.handleOwnerSignIn({ preventDefault() {} });
  check('owner login: all attempts down shows the new connection message after 3 tries',
    callsC === 3 &&
    !allDown.registry.get('ownerLoginErrorMsg').classList.contains('hidden') &&
    allDown.registry.get('ownerLoginErrorText').innerText ===
      'Cannot reach the server right now. Check your internet connection and try again.' &&
    loginShown(allDown.registry) && !appShown(allDown.registry));

  // (d) 401 is NOT retried: invalid-credentials path is byte-identical.
  let callsD = 0;
  const denied = boot({
    fetchImpl: async () => {
      callsD++;
      return { ok: false, status: 401, json: async () => ({ ok: false }) };
    },
  });
  denied.api.showOwnerLoginView();
  denied.registry.get('ownerLoginUsername').value = 'Faheem';
  denied.registry.get('ownerLoginPassword').value = 'wrong';
  await denied.api.handleOwnerSignIn({ preventDefault() {} });
  check('owner login: 401 answers invalid credentials with exactly ONE fetch (no retry storm)',
    callsD === 1 &&
    denied.registry.get('ownerLoginErrorText').innerText === 'Invalid username or password.' &&
    loginShown(denied.registry));

  // (e) staff login (js/auth.js handler): throw then success.
  let callsE = 0;
  const staffRetry = boot({
    fetchImpl: async () => {
      callsE++;
      if (callsE === 1) throw new Error('network down');
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, token: 'staff-token', id: 'TCH-1' }),
      };
    },
  });
  staffRetry.registry.get('tLoginUser').value = 'teacher1';
  staffRetry.registry.get('tLoginPass').value = 'correct';
  await staffRetry.api.handleTeacherLoginSubmit({ preventDefault() {} });
  check('staff login: network throw then success stores the token and navigates, NO error shown',
    callsE === 2 && staffRetry.sessionStore.get('alhuda_teacher_token') === 'staff-token' &&
    staffRetry.replaced.includes('teacher.html') &&
    staffRetry.registry.get('teacherLoginError').classList.contains('hidden'));

  // (e2) staff login: 503 then a deactivated 401 keeps its exact message.
  let callsE2 = 0;
  const staffDeactivated = boot({
    fetchImpl: async () => {
      callsE2++;
      if (callsE2 === 1) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: false, status: 401, json: async () => ({ error: 'account_deactivated' }) };
    },
  });
  staffDeactivated.registry.get('tLoginUser').value = 'teacher1';
  staffDeactivated.registry.get('tLoginPass').value = 'correct';
  await staffDeactivated.api.handleTeacherLoginSubmit({ preventDefault() {} });
  check('staff login: 503 retried, then deactivated 401 shows its exact message',
    callsE2 === 2 &&
    staffDeactivated.registry.get('teacherLoginError').innerText ===
      'This account is deactivated. Please contact the administrator.');
}

console.log('---');
console.log(`login-redesign-admin: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
