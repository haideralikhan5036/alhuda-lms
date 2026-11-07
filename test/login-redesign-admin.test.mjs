// Owner login redesign (2026-11-07): the approved split-card skin
// applied to #ownerLoginView in index.html — the last of the four
// login surfaces. This suite proves, against the REAL index.html and
// the REAL js/auth.js functions:
//   1. only the login region changed skin: every preserved element
//      (ids, labels, input attributes, submit handler, password
//      toggle wiring, error box) is intact, the new lgn- landmarks
//      are present, and NO flagship aui- classes leaked into the
//      gate (shell styles stay out, login styles stay in);
//   2. the PR #127 guarantees survive: the view is still the fixed
//      inset-0 gate under the 85% body zoom, and the stacked mobile
//      layout lives below the 1024px portal breakpoint;
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
check('view keeps the dark full-bleed gradient classes',
  LOGIN.includes('bg-gradient-to-br from-slate-950 via-[#022c22] to-slate-900'));
check('form keeps the real submit handler + autocomplete off',
  LOGIN.includes('<form onsubmit="handleOwnerSignIn(event)" class="lgn-form" autocomplete="off">'));
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
  LOGIN.includes('<img src="alhuda_logo.jpg" alt="Al-Huda Islamic Centre" class="lgn-logo">') &&
  LOGIN.includes('AL-HUDA ISLAMIC CENTRE') && LOGIN.includes('Owner &amp; Admin Control Center') &&
  LOGIN.includes('Owner &amp; Director Login') &&
  LOGIN.includes('Sign in with authorized credentials to access LMS Admin') &&
  LOGIN.includes('&copy; 2026 Al-Huda Islamic Centre. Authorized personnel only.'));

check('new landmarks: split card + panel + form side',
  LOGIN.includes('class="lgn-card"') && LOGIN.includes('class="lgn-panel"') &&
  LOGIN.includes('class="lgn-formside"') && LOGIN.includes('class="lgn-form-inner"'));
check('new landmarks: illustration scene (slice-filled) + seam + mobile swoosh',
  LOGIN.includes('class="lgn-scene"') && LOGIN.includes('preserveAspectRatio="xMidYMid slice"') &&
  LOGIN.includes('class="lgn-seam"') && LOGIN.includes('class="lgn-swoosh"'));
check('new landmarks: underline input rows + pill CTA with gold chip',
  count(LOGIN, 'class="lgn-input-row"') === 2 && LOGIN.includes('class="lgn-cta"') &&
  LOGIN.includes('class="lgn-cta-chip"'));
check('backdrop decorations ride along (desktop)',
  LOGIN.includes('class="lgn-deco lgn-deco-tl"') && LOGIN.includes('class="lgn-deco lgn-deco-br"'));
check('NO flagship aui- classes inside the login view', !LOGIN.includes('aui-'));
check('old centred-card skin is gone',
  !LOGIN.includes('max-w-md w-full my-auto') &&
  !LOGIN.includes('bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden'));

// ---------------------------------------------------------------------
// Part B — the CSS contract (PR #127 + the lgn- stylesheet)
// ---------------------------------------------------------------------
check('PR #127: view is still the fixed inset-0 gate with safe centring',
  /#ownerLoginView \{\s*position: fixed;\s*inset: 0;\s*overflow-y: auto;\s*justify-content: safe center;\s*\}/.test(INDEX));
check('PR #127: portal scale stays 85% (body zoom)',
  INDEX.includes('body { zoom: 0.85; }'));
check('lgn- stylesheet: desktop split card (radius 28, panel 46%)',
  INDEX.includes('.lgn-card {') && INDEX.includes('border-radius: 28px') &&
  INDEX.includes('flex: 0 0 46%'));
check('lgn- stylesheet: stacked layout below the portal breakpoint',
  /@media \(max-width: 1023px\) \{\s*\.lgn-deco \{ display: none; \}/.test(INDEX) &&
  INDEX.includes('.lgn-panel { flex: none; height: 248px; }') &&
  INDEX.includes('.lgn-seam { display: none; }') &&
  INDEX.includes('border-radius: 26px 26px 0 0'));
check('lgn- stylesheet: no global element selectors leak out of the gate',
  !/^\s*(section|form|input|button|img|h1|h2|p)\s*\{/m.test(
    INDEX.slice(INDEX.indexOf('.lgn-deco {'), INDEX.indexOf('/* Responsive Mobile & Desktop Layout Engine */'))));

// ---------------------------------------------------------------------
// Part C — fake DOM from the REAL markup + REAL auth.js execution
// ---------------------------------------------------------------------
class FakeEl {
  constructor(id, classAttr, attrs) {
    this.id = id;
    this._set = new Set(String(classAttr || '').split(/\s+/).filter(Boolean));
    this._attrs = attrs || {};
    this.style = {};
    this.value = '';
    this.type = this._attrs.type || '';
    this.innerText = '';
    this.textContent = '';
    this.innerHTML = '';
    this.classList = {
      add: (...cs) => cs.forEach(c => this._set.add(c)),
      remove: (...cs) => cs.forEach(c => this._set.delete(c)),
      contains: (c) => this._set.has(c),
    };
  }
  get className() { return [...this._set].join(' '); }
  set className(v) { this._set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
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
    ${extractFunction(AUTH_JS, 'getWorkerBase')}
    ${extractFunction(AUTH_JS, 'callServerLogout')}
    ${extractFunction(AUTH_JS, 'getOwnerToken')}
    ${extractFunction(AUTH_JS, 'decodeTokenPayload')}
    ${extractFunction(AUTH_JS, 'getAuthenticatedOwnerSession')}
    ${extractFunction(AUTH_JS, 'showOwnerLoginView')}
    ${extractFunction(AUTH_JS, 'showMainAppView')}
    ${extractFunction(AUTH_JS, 'toggleOwnerPassVisibility')}
    ${extractFunction(AUTH_JS, 'handleOwnerSignIn')}
    ${extractFunction(AUTH_JS, 'updateRoleHeaderBadge')}
    ${extractFunction(AUTH_JS, 'switchUserRole')}
    ${extractFunction(AUTH_JS, 'initRoleFromUrl')}
    ${extractFunction(AUTH_JS, 'logoutOwnerPortal')}
    this.__api = { showOwnerLoginView, showMainAppView, toggleOwnerPassVisibility,
      handleOwnerSignIn, initRoleFromUrl, logoutOwnerPortal };
  `, sandbox);
  return { api: sandbox.__api, registry, sessionStore, localStore, replaced };
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
  await failed.api.handleOwnerSignIn({ preventDefault() {} });
  check('failed sign-in shows the real error inside the new card + stays on the gate',
    !failed.registry.get('ownerLoginErrorMsg').classList.contains('hidden') &&
    failed.registry.get('ownerLoginErrorText').innerText === 'Invalid username or password.' &&
    loginShown(failed.registry) && !appShown(failed.registry));

  const good = boot({
    fetchImpl: async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, token: ownerToken(Math.floor(Date.now() / 1000) + 3600) }),
    }),
  });
  good.api.showOwnerLoginView();
  good.registry.get('ownerLoginUsername').value = 'Faheem';
  good.registry.get('ownerLoginPassword').value = 'correct';
  await good.api.handleOwnerSignIn({ preventDefault() {} });
  check('successful sign-in stores the token, hides the gate, opens the flagship shell',
    !!good.sessionStore.get('alhuda_owner_token') &&
    good.localStore.get('alhuda_active_portal_role') === 'owner' &&
    !loginShown(good.registry) && appShown(good.registry) &&
    good.registry.get('ownerLoginErrorMsg').classList.contains('hidden'));
  check('sign-in recorded NO navigation away from index.html', good.replaced.length === 0);

  // --- logout returns to the NEW login view ---------------------------
  await good.api.logoutOwnerPortal();
  check('logout returns to the new login view with fields cleared + token wiped',
    loginShown(good.registry) && !appShown(good.registry) &&
    good.registry.get('ownerLoginUsername').value === '' &&
    good.registry.get('ownerLoginPassword').value === '' &&
    !good.sessionStore.get('alhuda_owner_token'));
}

console.log('---');
console.log(`login-redesign-admin: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
