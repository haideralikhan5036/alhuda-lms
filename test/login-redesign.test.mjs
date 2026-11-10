// Fee-style login re-skin (2026-11-10) — the Fee Management portal
// login design (Batch 24 + Batch 25 autofill fix) applied to
// teacher.html, parent.html and manager.html on the owner's explicit
// instruction ("make the LMS logins like the fee management login").
// This REPLACES the 2026-11-07 split-card (lgn-) skin. These pins lock
// the deal:
//   * every PRE-EXISTING login id, handler and label survives exactly
//     once — the re-skin is a skin change, never a rewrite of login
//     logic (the sign-in handlers are byte-untouched);
//   * the fee-design landmarks are present per surface: dark #06382a
//     screen, centred dark card, dark pill fields with the autofill
//     override, gold pill CTA with dots/done states, confetti layer,
//     shake keyframes;
//   * per-portal rules hold: teacher keeps body zoom 0.85
//     (desktop-scoped since the 2026-11-10 mobile fix), parent
//     gains NO zoom, manager keeps the PR #128 fixed-body rule
//     (its zoom desktop-scoped since the 2026-11-10 mobile fix);
//   * EXECUTED proof: the REAL fee-style wiring script from each file
//     runs in a vm over a fake DOM built from the REAL markup —
//     submit applies the dots (loading) state, the real error box
//     appearing applies the shake state, and the real success signal
//     (login view dismissed / manager session stored) applies the
//     success state and bursts exactly 30 confetti pieces.
// End-to-end execution of the real handlers in Chromium (stubbed
// /api/auth) is recorded with the build in the goal files.
// LOGIN RESILIENCE (2026-11-10): the REAL parent + manager sign-in
// handlers are also executed below (extracted verbatim into a vm
// over the fake DOM) with scripted fetch sequences, proving the new
// retry loop: a network throw or a 502/503 first attempt no longer
// fails the sign-in, persistent failure lands on the existing
// unreachable message after exactly 3 attempts, and a 401 is never
// retried.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const count = (src, needle) => src.split(needle).length - 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SURFACES = [
  {
    file: 'teacher.html',
    ids: ['loginView', 'loginUsername', 'loginPassword', 'passToggleIcon',
      'loginErrorMsg', 'loginErrorText', 'roleMismatchBanner', 'roleMismatchTitle',
      'roleMismatchDesc', 'btnSubmitLogin'],
    handlers: ['onsubmit="handleTeacherSignIn(event)"', 'onclick="togglePassVisibility()"'],
    wording: ['Teacher Portal Login', 'Teacher Operations Portal', 'Login to Teacher Portal',
      'Email / Username / Teacher ID', 'Enter your username or Teacher ID', 'Authorized personnel only.'],
    panelCopy: 'Authorized personnel only.',
    viewId: 'loginView', formId: 'loginForm', wrapId: 'loginBtnWrap',
    errId: 'loginErrorMsg', layerId: 'loginConfettiLayer', cardId: 'loginCard',
    success: 'view',
  },
  {
    file: 'parent.html',
    ids: ['parentLoginView', 'parentLoginUsername', 'parentLoginPassword', 'parentPassToggleIcon',
      'parentLoginErrorMsg', 'parentLoginErrorText', 'parentRoleMismatchBanner',
      'parentRoleMismatchTitle', 'parentRoleMismatchDesc', 'btnSubmitParentLogin'],
    handlers: ['onsubmit="handleParentSignIn(event)"', 'onclick="toggleParentPassVisibility()"'],
    wording: ['Parent &amp; Student Login', 'Parent &amp; Student Portal', 'Login to Parent Portal',
      'Username / Family ID / Email', 'Enter Parent Username or Family ID', 'Authorized access only.'],
    panelCopy: 'Authorized access only.',
    viewId: 'parentLoginView', formId: 'parentLoginForm', wrapId: 'parentLoginBtnWrap',
    errId: 'parentLoginErrorMsg', layerId: 'parentLoginConfettiLayer', cardId: 'parentLoginCard',
    success: 'view',
  },
  {
    file: 'manager.html',
    ids: ['managerLoginContainer', 'mgrLoginUsername', 'mgrLoginPassword', 'mgrPassToggleIcon',
      'mgrLoginErrorMsg', 'mgrLoginErrorText', 'mgrRoleMismatchBanner', 'mgrRoleMismatchTitle',
      'mgrRoleMismatchDesc', 'btnSubmitMgrLogin'],
    handlers: ['onsubmit="handleManagerSignIn(event)"', 'onclick="toggleMgrPassVisibility()"'],
    wording: ['Manager Portal Login', 'Manager Operations Portal', 'Login to Manager Portal',
      'Username / Manager ID / Email', 'Enter Manager Username or ID (e.g. MGR-001)',
      'Authorized personnel only.'],
    panelCopy: 'Authorized personnel only.',
    viewId: null, formId: 'mgrLoginForm', wrapId: 'mgrLoginBtnWrap',
    errId: 'mgrLoginErrorMsg', layerId: 'mgrLoginConfettiLayer', cardId: 'mgrLoginCard',
    success: 'session',
  },
];

for (const s of SURFACES) {
  const src = read(s.file);
  for (const id of s.ids) {
    ok(count(src, `id="${id}"`) === 1, `${s.file}: login id #${id} present exactly once`);
  }
  for (const h of s.handlers) {
    ok(src.includes(h), `${s.file}: handler preserved: ${h}`);
  }
  for (const w of s.wording) {
    ok(src.includes(w), `${s.file}: real wording preserved: "${w}"`);
  }
  // Fee-design landmarks.
  for (const lm of ['class="flg-card"', 'class="flg-pill"', 'class="flg-cta"',
    'flg-screen', 'flg-dots', 'flg-done', 'flg-confetti',
    'src="alhuda_logo.jpg"', 'AL-HUDA ISLAMIC CENTRE', 'Signed In',
    'Secure Authentication System']) {
    ok(src.includes(lm), `${s.file}: fee-design landmark present: ${lm}`);
  }
  // The Batch 25 autofill fix, scoped to the login pill fields.
  ok(src.includes('input:-webkit-autofill') && src.includes('0 0 0 1000px #06382a inset'),
    `${s.file}: autofill override present (fields stay dark when Chrome autofills)`);
  // The animation mechanics: shake + confetti + dots keyframes.
  for (const kf of ['@keyframes flgBtnShake', '@keyframes flgConfettiFly',
    '@keyframes flgDotBounce', '@keyframes flgBtnGlow']) {
    ok(src.includes(kf), `${s.file}: keyframes present: ${kf}`);
  }

  // Desktop split layout (2026-11-10, owner-approved mockup v2):
  // brand panel left + form column right at >=1024px only. Below
  // the breakpoint the stacked card must render exactly as the
  // fee-style re-skin left it, so the split-only pieces are hidden
  // by default and the outside copy line stays the mobile one.
  for (const lm of ['class="flg-brand-panel"', 'class="flg-form-col"',
    'class="flg-logo-halo"', 'class="flg-brand-deco"', 'class="flg-bd-ring"',
    'class="flg-bd-circle"', 'class="flg-bd-dots"', 'class="flg-bd-gold"',
    'class="flg-panel-copy"', 'flg-outside-copy']) {
    ok(src.includes(lm), `${s.file}: split landmark present: ${lm}`);
  }
  ok(count(src, 'class="flg-brand-panel"') === 1 && count(src, 'class="flg-form-col"') === 1 &&
     count(src, 'class="flg-logo-halo"') === 1,
    `${s.file}: exactly one brand panel + form column + halo`);
  for (const rule of ['@media (min-width: 1024px)', 'width: 1140px',
    'grid-template-columns: 1.12fr 0.88fr',
    'border-left: 1px solid rgba(197,168,128,.28)',
    '.flg-panel-copy { display: none; }', '.flg-brand-deco { display: none; }',
    '.flg-outside-copy { display: none; }']) {
    ok(src.includes(rule), `${s.file}: split rule present: ${rule}`);
  }
  // The halo sizing is desktop-only: the base logo rule keeps the
  // stacked-card 92px size (mobile presentation unchanged).
  ok(src.includes('width: 92px; height: 92px'), `${s.file}: base logo size unchanged (mobile)`);
  ok(src.includes('.flg-brand-panel .flg-logo { width: 168px; height: 168px; margin: 0; }'),
    `${s.file}: desktop halo logo size pinned`);
  // The in-panel copy carries THIS surface's own outside-copy text.
  const panelCopyAt = src.indexOf('class="flg-panel-copy"');
  ok(panelCopyAt > -1 && src.slice(panelCopyAt, panelCopyAt + 120).includes(s.panelCopy),
    `${s.file}: in-panel copy carries the surface wording: ${s.panelCopy}`);
  // Document order: brand panel, then form column, both in the card.
  ok(src.indexOf('class="flg-brand-panel"') > src.indexOf('class="flg-card"') &&
     src.indexOf('class="flg-form-col"') > src.indexOf('class="flg-brand-panel"'),
    `${s.file}: brand panel then form column inside the card`);
  // New wiring ids exist exactly once.
  for (const id of [s.formId, s.wrapId, s.layerId, s.cardId]) {
    ok(count(src, `id="${id}"`) === 1, `${s.file}: wiring id #${id} present exactly once`);
  }
  // The old split-card skin is fully gone.
  ok(!src.includes('lgn-'), `${s.file}: no lgn- classes remain`);
  // The role-mismatch banner and the error element live INSIDE the new
  // card (they appear after the card opens in document order).
  ok(src.indexOf('class="flg-card"') > -1 && src.indexOf(s.ids[6]) > src.indexOf('class="flg-card"'),
    `${s.file}: role-mismatch banner sits inside the fee-style card`);
  // Inline scripts still parse.
  const dir = mkdtempSync(path.join(tmpdir(), 'flg-syntax-'));
  const scripts = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  scripts.forEach((code, i) => {
    const f = path.join(dir, `s${i}.js`);
    writeFileSync(f, code);
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
    catch { ok(false, `${s.file}: inline script block ${i} parses`); }
  });
}

// Per-portal rules.
const teacher = read('teacher.html');
// RE-PINNED 2026-11-10 (owner mobile fix): the teacher body zoom is
// now desktop-scoped, exactly as in index.html / manager.html
// (PR #139) — unscoped it painted the teacher portal at 85% width
// on phones, leaving a blank strip down the right edge. Desktop
// keeps the exact same 85% scale, and no unscoped body zoom may
// remain in the file.
ok(teacher.includes('@media (min-width: 1024px) { body { zoom: 0.85; } }') &&
  !teacher.replace('@media (min-width: 1024px) { body { zoom: 0.85; } }', '').includes('body { zoom'),
  'teacher: body zoom 0.85 desktop-scoped (2026-11-10 mobile fix)');
// RE-PINNED 2026-11-10: the login view backdrop is now the fee
// design's flg-screen (#06382a) instead of the tui-login-bg gradient —
// the backdrop changed because the whole login was re-skinned on the
// owner's instruction; tui- shell classes are otherwise untouched.
ok(teacher.includes('id="loginView" class="flg-screen '), 'teacher: login view carries the fee-style flg-screen backdrop');
ok(!teacher.includes('id="loginView" class="tui-login-bg'), 'teacher: tui-login-bg no longer on the login view (replaced by flg-screen)');

const parent = read('parent.html');
ok(!/body\s*\{[^}]*zoom/.test(parent), 'parent: NO body zoom added (parent portal stays 100%)');

const manager = read('manager.html');
// RE-PINNED 2026-11-10 (owner mobile fix): the zoom half of the
// PR #128 body rule is now desktop-scoped, exactly as in index.html —
// unscoped it painted this gate at 85% width on phones. The fixed
// full-bleed body itself is unchanged and applies at every width,
// and no unscoped body zoom may remain in the file.
ok(manager.includes('body { position: fixed; inset: 0; overflow-y: auto; }') &&
  manager.includes('@media (min-width: 1024px) { body { zoom: 0.85; } }') &&
  !manager.replace('@media (min-width: 1024px) { body { zoom: 0.85; } }', '').includes('body { zoom'),
  'manager: PR #128 fixed body intact, zoom desktop-scoped (2026-11-10 mobile fix)');
ok(manager.includes('for="mgrLoginUsername"') && manager.includes('for="mgrLoginPassword"'),
  'manager: username/password labels carry for= (added by the 2026-11-07 redesign; they had none)');

// ---------------------------------------------------------------------
// Executed proof: the REAL wiring script per surface, in a vm over a
// fake DOM built from the REAL markup.
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
      add: (...cs) => cs.forEach((c) => this._set.add(c)),
      remove: (...cs) => cs.forEach((c) => this._set.delete(c)),
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
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 55 }; }
}

function bootWiring(src) {
  const registry = new Map();
  for (const m of src.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const tag = m[0];
    const cls = (tag.match(/class="([^"]*)"/) || [])[1] || '';
    const type = (tag.match(/type="([^"]*)"/) || [])[1] || '';
    if (!registry.has(m[2])) registry.set(m[2], new FakeEl(m[2], cls, { type }));
  }
  const observers = [];
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    disconnect() {}
  }
  const store = new Map();
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: FakeMutationObserver,
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    document: {
      getElementById: (id) => registry.get(id) || null,
      createElement: () => new FakeEl('', '', {}),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const script = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).find((code) => code.includes('Fee-style login states'));
  if (!script) throw new Error('wiring script not found');
  vm.runInContext(script, sandbox);
  return { registry, flush: () => observers.forEach((o) => o.cb([], o)), store, session: sandbox.sessionStorage };
}

for (const s of SURFACES) {
  const src = read(s.file);
  const { registry, flush, store, session } = bootWiring(src);
  const form = registry.get(s.formId);
  const wrap = registry.get(s.wrapId);
  const err = registry.get(s.errId);
  const layer = registry.get(s.layerId);
  layer.parentElement = registry.get(s.cardId);
  ok(form && wrap && err && layer, `${s.file}: wiring boot found form/wrap/error/layer`);
  ok(!wrap.classList.contains('flg-is-loading') && !wrap.classList.contains('flg-is-error')
    && !wrap.classList.contains('flg-is-success'), `${s.file}: button wrap starts in the resting state`);

  // Submit -> dots (loading) state.
  form.__fire('submit');
  ok(wrap.classList.contains('flg-is-loading'), `${s.file}: submit applies the dots loading state`);

  // The REAL failure signal: the handler un-hides the error box.
  err.classList.remove('hidden');
  flush();
  ok(wrap.classList.contains('flg-is-error') && !wrap.classList.contains('flg-is-loading'),
    `${s.file}: real error path applies the shake state and clears loading`);

  // Retry -> loading again; then the REAL success signal.
  err.classList.add('hidden');
  wrap.classList.remove('flg-is-error');
  form.__fire('submit');
  ok(wrap.classList.contains('flg-is-loading'), `${s.file}: retry applies the loading state again`);
  if (s.success === 'view') {
    registry.get(s.viewId).classList.add('hidden');
    flush();
  } else {
    // The manager gate writes the session and redirects in the same
    // breath, so the wiring must react SYNCHRONOUSLY inside that
    // write — assert before any timer gets a chance to run. (In a
    // real browser the redirect replaces the document immediately,
    // so the burst is created but the gate is gone in the same beat;
    // that instant navigation is the handler's own design.)
    session.setItem('alhuda_manager_session', '{}');
    ok(wrap.classList.contains('flg-is-success'),
      `${s.file}: success state applied synchronously with the real session write`);
    ok(layer.children.length === 30,
      `${s.file}: confetti burst created synchronously with the real session write`);
    await sleep(200);
  }
  ok(wrap.classList.contains('flg-is-success'), `${s.file}: real success applies the success state`);
  ok(layer.children.length === 30, `${s.file}: success bursts exactly 30 confetti pieces (got ${layer.children.length})`);
}

// ---------------------------------------------------------------------
// LOGIN RESILIENCE (2026-11-10) — executed: the REAL parent + manager
// sign-in handlers against scripted fetch sequences.
// ---------------------------------------------------------------------
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

// --- parent: parentServerLogin classifies the outcome ---------------
function bootParentLogin(fetchImpl) {
  const src = read('parent.html');
  const sandbox = { console, setTimeout, clearTimeout, fetch: fetchImpl };
  sandbox.window = { location: { hostname: 'alhuda-lms.vercel.app' } };
  vm.createContext(sandbox);
  vm.runInContext(`
    ${extractFunction(src, 'getParentWorkerBase')}
    ${extractFunction(src, 'parentServerLogin')}
    this.__login = parentServerLogin;
  `, sandbox);
  return sandbox.__login;
}
{
  let calls = 0;
  const login = bootParentLogin(async () => {
    calls++;
    if (calls === 1) throw new Error('network down');
    return { ok: true, status: 200, json: async () => ({ ok: true, token: 'ptok', id: 'FAM-1' }) };
  });
  const r = await login('fam1', 'correct');
  ok(calls === 2 && r.ok === true && r.token === 'ptok',
    'parent login: network throw then success returns the token (2 fetches)');
}
{
  let calls = 0;
  const login = bootParentLogin(async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ ok: true, token: 'ptok', id: 'FAM-1' }) };
  });
  const r = await login('fam1', 'correct');
  ok(calls === 2 && r.ok === true && r.token === 'ptok',
    'parent login: 503 then success returns the token (2 fetches)');
}
{
  let calls = 0;
  const login = bootParentLogin(async () => { calls++; throw new Error('network down'); });
  const r = await login('fam1', 'correct');
  ok(calls === 3 && r.unreachable === true,
    'parent login: all attempts down reports unreachable after exactly 3 fetches');
}
{
  let calls = 0;
  const login = bootParentLogin(async () => {
    calls++;
    return { ok: false, status: 401, json: async () => ({ error: 'no_password_set' }) };
  });
  const r = await login('fam1', 'correct');
  ok(calls === 1 && r.unauthorized === true && r.error === 'no_password_set',
    'parent login: 401 is never retried and keeps its error code (1 fetch)');
}

// --- manager: the real gate handler, full flow ------------------------
function bootManagerLogin(fetchImpl) {
  const src = read('manager.html');
  const registry = new Map();
  for (const m of src.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const tag = m[0];
    const cls = (tag.match(/class="([^"]*)"/) || [])[1] || '';
    const type = (tag.match(/type="([^"]*)"/) || [])[1] || '';
    if (!registry.has(m[2])) registry.set(m[2], new FakeEl(m[2], cls, { type }));
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
    console, setTimeout, clearTimeout, fetch: fetchImpl,
    sessionStorage: storage(sessionStore),
    localStorage: storage(localStore),
    document: {
      getElementById: (id) => registry.get(id) || null,
      createElement: () => new FakeEl('', '', {}),
    },
  };
  sandbox.window = {
    location: { hostname: 'alhuda-lms.vercel.app', replace: (u) => replaced.push(u) },
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    async function fetchManagersFromBackend() { return { managers: [], accountsMap: {} }; }
    function resolveManagerCredentials() { return { emp_id: '', username: '', role_title: '' }; }
    ${extractFunction(src, 'handleManagerSignIn')}
    this.__login = handleManagerSignIn;
  `, sandbox);
  return { login: sandbox.__login, registry, sessionStore, replaced };
}
const mgrOkResponse = () => ({
  ok: true, status: 200,
  json: async () => ({ ok: true, token: 'mtok', id: 'MGR-001', emp_id: 'MGR-001', full_name: 'Mgr', username: 'mgr' }),
});
{
  let calls = 0;
  const b = bootManagerLogin(async () => {
    calls++;
    if (calls === 1) throw new Error('network down');
    return mgrOkResponse();
  });
  b.registry.get('mgrLoginUsername').value = 'mgr';
  b.registry.get('mgrLoginPassword').value = 'correct';
  await b.login({ preventDefault() {} });
  ok(calls === 2 && b.sessionStore.get('alhuda_manager_token') === 'mtok' &&
    !!b.sessionStore.get('alhuda_manager_session') &&
    b.replaced.includes('index.html?role=manager') &&
    b.registry.get('mgrLoginErrorMsg').classList.contains('hidden'),
    'manager login: network throw then success stores the session and redirects, NO error shown');
}
{
  let calls = 0;
  const b = bootManagerLogin(async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 503, json: async () => ({}) };
    return mgrOkResponse();
  });
  b.registry.get('mgrLoginUsername').value = 'mgr';
  b.registry.get('mgrLoginPassword').value = 'correct';
  await b.login({ preventDefault() {} });
  ok(calls === 2 && b.sessionStore.get('alhuda_manager_token') === 'mtok' &&
    b.replaced.includes('index.html?role=manager'),
    'manager login: 503 then success stores the session and redirects');
}
{
  let calls = 0;
  const b = bootManagerLogin(async () => { calls++; throw new Error('network down'); });
  b.registry.get('mgrLoginUsername').value = 'mgr';
  b.registry.get('mgrLoginPassword').value = 'correct';
  await b.login({ preventDefault() {} });
  ok(calls === 3 && !b.sessionStore.get('alhuda_manager_token') &&
    b.registry.get('mgrLoginErrorText').innerText === 'Cannot reach the server. Please try again.' &&
    !b.registry.get('mgrLoginErrorMsg').classList.contains('hidden'),
    'manager login: all attempts down shows the existing unreachable message after 3 fetches');
}
{
  let calls = 0;
  const b = bootManagerLogin(async () => {
    calls++;
    return { ok: false, status: 401, json: async () => ({ error: 'no_password_set' }) };
  });
  b.registry.get('mgrLoginUsername').value = 'mgr';
  b.registry.get('mgrLoginPassword').value = 'correct';
  await b.login({ preventDefault() {} });
  ok(calls === 1 &&
    b.registry.get('mgrLoginErrorText').innerText === 'No password set. Ask the administrator to set one.',
    'manager login: 401 is never retried and keeps its exact message (1 fetch)');
}

if (failures === 0) console.log('login-redesign: all assertions passed');
process.exit(failures ? 1 : 0);
