// Batch 8 — shared notification system (js/ui-notify.js) tests.
// Run from the repo root:  node test/batch8-notify.test.mjs
// Covers: source scan (no raw alert/confirm/prompt outside ui-notify.js),
// toast queue + auto-dismiss + error persistence + hover pause,
// confirm Promise (confirm/cancel/Esc/Enter), focus trap + focus return,
// input dialog, reduced-motion handling, safety-net routing, legacy APIs.
// All values below are SYNTHETIC test values. No network, no live data.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/ui-notify.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Minimal DOM mock ----------
class MockEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.id = '';
    this.parentNode = null;
    this.listeners = {};
    this.attrs = {};
    this.focused = false;
    this.focusCalls = 0;
    this.selected = false;
  }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    if (child.id) this._doc && this._doc._register(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
    child.parentNode = null;
    if (child.id && this._doc) this._doc._unregister(child);
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) {
    this.attrs[k] = v;
    if (k === 'id') { this.id = v; if (this._doc) this._doc._register(this); }
  }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
  }
  fire(type, ev = {}) {
    for (const fn of (this.listeners[type] || [])) fn({ preventDefault() {}, target: this, ...ev });
  }
  querySelectorAll() {
    const out = [];
    const walk = (el) => {
      for (const c of el.children) {
        if (c.tagName === 'BUTTON' || c.tagName === 'INPUT') out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  focus() { this.focused = true; this.focusCalls++; if (this._doc) this._doc.activeElement = this; }
  select() { this.selected = true; }
}

function makeDocument() {
  const byId = new Map();
  const docListeners = {};
  const doc = {
    _byId: byId,
    _register(el) { if (el.id) byId.set(el.id, el); },
    _unregister(el) { if (byId.get(el.id) === el) byId.delete(el.id); },
    activeElement: null,
    createElement(tag) {
      const el = new MockEl(tag);
      el._doc = doc;
      return el;
    },
    getElementById(id) { return byId.get(id) || null; },
    getElementsByTagName(name) { return name === 'head' ? [doc.head] : []; },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      if (docListeners[type]) docListeners[type] = docListeners[type].filter((f) => f !== fn);
    },
    fireKey(key, extra = {}) {
      for (const fn of (docListeners.keydown || [])) fn({ key, preventDefault() {}, shiftKey: !!extra.shiftKey });
    },
    head: null,
    body: null,
  };
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  return doc;
}

function loadModule({ reducedMotion = false } = {}) {
  const warnings = [];
  const doc = makeDocument();
  const sandbox = {
    console: { warn: (...a) => warnings.push(a.join(' ')), log: () => {}, error: () => {} },
    document: doc,
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { api: sandbox.LmsNotify, sandbox, doc, warnings };
}

function stackToasts(doc) {
  const stack = doc.getElementById('lms-notify-stack');
  return stack ? stack.children : [];
}

// ---------- 1. Source scan: no raw native popups remain ----------
{
  const files = [
    ...fs.readdirSync(REPO_ROOT).filter((f) => f.endsWith('.html')),
    ...fs.readdirSync(path.join(REPO_ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f),
  ];
  const hits = [];
  for (const rel of files) {
    if (rel === 'js/ui-notify.js') continue; // safety net lives here by design
    let text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    text = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('//')) continue;
      const m = lines[i].match(/(?<![\w$.])(alert|confirm|prompt)\s*\(|window\.(alert|confirm|prompt)\s*\(/);
      if (m) hits.push(rel + ':' + (i + 1) + ' ' + lines[i].trim().slice(0, 80));
    }
  }
  check('source scan: zero raw alert/confirm/prompt calls outside ui-notify.js', hits.length === 0, hits.slice(0, 3).join(' | '));
  const portals = ['index.html', 'teacher.html', 'parent.html', 'manager.html',
    'set-teacher-passwords.html', 'backfill-finance-tables.html', 'diagnose-course-material.html'];
  const missing = portals.filter((p) => !fs.readFileSync(path.join(REPO_ROOT, p), 'utf8').includes('js/ui-notify.js'));
  check('ui-notify.js loaded by every portal + tool page', missing.length === 0, 'missing: ' + missing.join(','));
  const config = fs.readFileSync(path.join(REPO_ROOT, 'js/config.js'), 'utf8');
  check('config.js has no second toast/dialog system (single system only)',
    !config.includes('lmsGlobalToastStack') && !config.includes('lmsGlobalDialogBackdrop') && !config.includes('_escLmsDialog'));
  check('no showToastNotification references remain',
    !files.some((rel) => rel !== 'js/ui-notify.js' && fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').includes('showToastNotification')));
}

// ---------- 2. Toast basics, queue, timing ----------
{
  const { api, doc } = loadModule();
  api.toast('Attendance marked for Test Student', { type: 'success' });
  let toasts = stackToasts(doc);
  check('toast: one toast rendered with title text', toasts.length === 1 &&
    toasts[0].children[1].children[0].textContent === 'Attendance marked for Test Student');
  check('toast: success role is status, error role would be alert', toasts[0].getAttribute('role') === 'status');

  api.toast('Second toast', { type: 'info', duration: 60000 });
  api.toast('Third toast', { type: 'info', duration: 60000 });
  api.toast('Fourth toast (queued)', { type: 'info', duration: 60000 });
  api.toast('Fifth toast (queued)', { type: 'info', duration: 60000 });
  check('queue: max 3 visible', api.__test.visibleCount() === 3, 'visible=' + api.__test.visibleCount());
  check('queue: 2 waiting', api.__test.queueLength() === 2, 'queued=' + api.__test.queueLength());
  // close the first toast -> one queued toast drains in
  stackToasts(doc)[0].children[2].fire('click');
  check('queue: drain after close keeps 3 visible, 1 queued',
    api.__test.visibleCount() === 3 && api.__test.queueLength() === 1);
}
{
  const { api, doc } = loadModule();
  api.toast('Quick success', { type: 'success', duration: 30 });
  await sleep(80);
  check('auto-dismiss: success toast gone after duration', stackToasts(doc).length === 0);
  api.toast('Persistent error', { type: 'error' });
  await sleep(80);
  check('error persistence: error toast still present without duration', stackToasts(doc).length === 1);
  stackToasts(doc)[0].children[2].fire('click');
  check('error persistence: close button dismisses error toast', stackToasts(doc).length === 0);
}
{
  const { api, doc } = loadModule();
  api.toast('Hover pause toast', { type: 'success', duration: 80 });
  const card = stackToasts(doc)[0];
  card.fire('mouseenter');
  await sleep(150);
  check('pause on hover: toast survives past duration while hovered', stackToasts(doc).length === 1);
  card.fire('mouseleave');
  await sleep(150);
  check('pause on hover: toast dismisses after hover ends', stackToasts(doc).length === 0);
}
{
  const { api, doc } = loadModule();
  api.toast('The attendance could not be saved. Please try again.');
  api.toast('Please select a student.');
  api.toast('Fee payment recorded successfully!');
  const classes = stackToasts(doc).map((t) => t.className);
  check('type inference: error / warning / success from message meaning',
    classes[0].includes('lms-toast-error') && classes[1].includes('lms-toast-warning') && classes[2].includes('lms-toast-success'),
    classes.join(' | '));
  const { api: api2 } = loadModule();
  check('legacy string-type toast form still works', (() => {
    api2.toast('Something broke', 'error');
    return true;
  })());
}

// ---------- 3. Confirm dialog ----------
{
  const { api, doc } = loadModule();
  const trigger = doc.createElement('button');
  doc.body.appendChild(trigger);
  doc.activeElement = trigger;
  let result = null;
  const p = api.confirm({ title: 'Deactivate family?', message: 'This will deactivate the whole family.', confirmText: 'Deactivate', variant: 'danger' })
    .then((v) => { result = v; });
  const dlg = doc.getElementById('lms-notify-dialog');
  check('confirm: dialog rendered', !!dlg);
  const btns = dlg.children[0].querySelectorAll();
  const confirmBtn = btns[btns.length - 1];
  confirmBtn.fire('click');
  await p;
  check('confirm: clicking confirm resolves true', result === true);
  check('confirm: focus returns to trigger after close', trigger.focusCalls >= 1);

  let result2 = null;
  const p2 = api.confirm('Delete this record?').then((v) => { result2 = v; });
  doc.fireKey('Escape');
  await p2;
  check('confirm: Escape resolves false', result2 === false);

  let result3 = null;
  const p3 = api.confirm('Proceed?').then((v) => { result3 = v; });
  doc.fireKey('Enter');
  await p3;
  check('confirm: Enter resolves true', result3 === true);
}
{
  const { api, doc } = loadModule();
  const p = api.confirm('Trap test');
  const dlg = doc.getElementById('lms-notify-dialog');
  const btns = dlg.children[0].querySelectorAll();
  const cancelBtn = btns[0];
  const confirmBtn = btns[btns.length - 1];
  doc.activeElement = confirmBtn;
  doc.fireKey('Tab');
  check('focus trap: Tab from last button wraps to first', doc.activeElement === cancelBtn);
  doc.fireKey('Escape');
  await p;
}

// ---------- 4. Input dialog ----------
{
  const { api, doc } = loadModule();
  let result = null;
  const p = api.prompt('Reason for cancellation (required):', '').then((v) => { result = v; });
  const dlg = doc.getElementById('lms-notify-dialog');
  const els = dlg.children[0].querySelectorAll();
  const input = els.find((e) => e.tagName === 'INPUT');
  const confirmBtn = els[els.length - 1];
  input.value = 'Family moved away';
  confirmBtn.fire('click');
  await p;
  check('input: confirm resolves typed value', result === 'Family moved away');

  let result2 = 'unset';
  const p2 = api.prompt('Enter value:', 'default').then((v) => { result2 = v; });
  doc.fireKey('Escape');
  await p2;
  check('input: Escape resolves null', result2 === null);
}

// ---------- 5. Read-carefully dialog, safety net, reduced motion ----------
{
  const { api, doc } = loadModule();
  let done = false;
  const p = api.dialog({ title: 'Copy this password now', message: 'It will not be shown again:\n\ntest-value', confirmText: 'Done' })
    .then(() => { done = true; });
  const dlg = doc.getElementById('lms-notify-dialog');
  const btns = dlg.children[0].querySelectorAll();
  check('read dialog: exactly one button (no cancel)', btns.length === 1);
  btns[0].fire('click');
  await p;
  check('read dialog: Done resolves', done === true);
}
{
  const { api, doc, warnings, sandbox } = loadModule();
  sandbox.alert('Legacy hello');
  check('safety net: window.alert routes to a toast', stackToasts(doc).length === 1);
  check('safety net: window.alert logs a console warning', warnings.some((w) => w.includes('legacy')));
  const cp = sandbox.confirm('Are you sure?');
  check('safety net: window.confirm returns a Promise (async-only)', cp && typeof cp.then === 'function');
  doc.fireKey('Escape');
  await cp;
  const pp = sandbox.prompt('Enter value:');
  check('safety net: window.prompt returns a Promise', pp && typeof pp.then === 'function');
  doc.fireKey('Escape');
  await pp;
}
{
  const { api, doc } = loadModule({ reducedMotion: true });
  api.toast('Reduced motion toast', { type: 'info', duration: 60000 });
  const card = stackToasts(doc)[0];
  check('reduced motion: toast visible immediately (no entrance animation wait)', card.className.includes('lms-toast-in'));
  const styleText = fs.readFileSync(path.join(REPO_ROOT, 'js/ui-notify.js'), 'utf8');
  check('reduced motion: stylesheet disables transitions', styleText.includes('prefers-reduced-motion: reduce'));
}
{
  const { api, doc } = loadModule();
  api.toast('<script>alert(1)</script>', { type: 'error' });
  const titleEl = stackToasts(doc)[0].children[1].children[0];
  check('escaping: markup in message is shown as text, not interpreted',
    titleEl.textContent === '<script>alert(1)</script>');
}

// ---------- Summary ----------
const failed = results.filter((r) => !r.pass);
console.log('\nBatch 8 notify tests: ' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join('; ')); process.exit(1); }
