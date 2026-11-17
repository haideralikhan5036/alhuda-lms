// Fee Dashboard + Form Improvements — form cleanup (#5, #6) + Remind All (#7).
// Structural checks (the form lost only what the brief names, the shared
// leave core + Ledger/Matrix one-tap survive) plus the REAL
// sendBulkPendingFeeReminders / sendBulkDefaulterReminders3Plus wrappers
// from js/fees.js (extracted by name) against a fake DOM, proving the
// two-step confirm gate: first click sends NOTHING, Cancel sends nothing,
// Confirm sends once, the auto 4th-of-month trigger runs without a confirm.
// Run from the repo root: node test/fee-phase6-form-cleanup-remind.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const LEAVES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/leaves.js'), 'utf8');
const PHASE6_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase6.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

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
function extractConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error('const not found: ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  let state = null;
  let escaped = false;
  for (; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (state === 'line') { if (c === '\n') state = null; continue; }
    if (state === 'block') { if (c === '*' && next === '/') { state = null; i++; } continue; }
    if (state === "'" || state === '"' || state === '`') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === state) state = null;
      continue;
    }
    if (c === '/' && next === '/') { state = 'line'; i++; continue; }
    if (c === '/' && next === '*') { state = 'block'; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { state = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error('unbalanced braces extracting ' + name);
  return src.slice(start, i) + ';';
}

// ---- pure remind confirm config ----------------------------------------------
{
  const windowObj = {};
  const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(PHASE6_SRC, sandbox);
  const F = windowObj.FeePhase6;
  const pending = F.remindAllConfirmConfig({ kind: 'pending', period: 'November 2026', total: 2, withEmail: 2, quotaNote: 'Safe Quota Notice: Free Gmail has a daily limit of 100 emails/day. To keep your official account safe, dispatching will process up to 85 emails in this batch.' });
  const defs = F.remindAllConfirmConfig({ kind: 'defaulters', total: 1, withEmail: 1 });
  check('remind config: the question is the brief exact wording', F.REMIND_ALL_QUESTION === 'Are you sure you want to send fee reminders to all eligible families?');
  check('remind config: pending confirm uses the exact question', pending.message.indexOf(F.REMIND_ALL_QUESTION) !== -1);
  check('remind config: defaulters confirm uses the exact question', defs.message.indexOf(F.REMIND_ALL_QUESTION) !== -1);
  check('remind config: confirm button reads Confirm & Send Reminders', pending.confirmText === 'Confirm & Send Reminders' && defs.confirmText === 'Confirm & Send Reminders');
  check('remind config: cancel button reads Cancel', pending.cancelText === 'Cancel' && defs.cancelText === 'Cancel');
  check('remind config: the scope is named in the message', pending.message.indexOf('Pending Families') !== -1 && defs.message.indexOf('3+ Month Defaulter') !== -1);
  check('remind config: the quota note is kept above the question', pending.message.indexOf('Safe Quota Notice') !== -1 && pending.message.indexOf('Safe Quota Notice') < pending.message.indexOf(F.REMIND_ALL_QUESTION));
}

// ---- structural: the form lost only what the brief names ----------------------
{
  check('form: the leave checkbox is gone from the form', !INDEX_SRC.includes('chkFeeFormLeave'));
  check('form: the leave reason box is gone', !INDEX_SRC.includes('feeFormLeaveBox'));
  check('form: the leave wiring is gone from fees.js', !FEES_SRC.includes('toggleFeeFormLeaveMode') && !FEES_SRC.includes('submitFeeFormLeave') && !FEES_SRC.includes('updateFeeFormLeaveSummary'));
  check('form: the Month Statuses switcher card is gone', !INDEX_SRC.includes('feeStatusSwitcherCard'));
  check('form: the switcher render + staged state are gone from fees.js', !FEES_SRC.includes('renderFeeStatusSwitcher') && !FEES_SRC.includes('FEE_STATUS_STAGED') && !FEES_SRC.includes('saveStagedMonthStatuses'));
  check('form: the switcher enrollment helpers are gone from fees.js', !FEES_SRC.includes('applyFeeEnrollmentUntil') && !FEES_SRC.includes('clearFeeEnrollmentDate'));
  check('form: the Multi Month selector replaced the fixed-month dropdown', INDEX_SRC.includes('feeMultiMonthGrid') && INDEX_SRC.includes('Multi Month Payments') && !INDEX_SRC.includes('feeSelectAdvanceMonths'));
  check('form: the receipts month-filter chip exists', INDEX_SRC.includes('feeReceiptsMonthChip') && INDEX_SRC.includes('feeReceiptsMonthChipText'));
  check('form: fee-phase6.js loads after fee-phase5.js', INDEX_SRC.indexOf('js/fee-phase6.js') > INDEX_SRC.indexOf('js/fee-phase5.js') && INDEX_SRC.indexOf('js/fee-phase6.js') !== -1);
  check('form: the Leave tab still exists (untouched)', INDEX_SRC.includes('id="tab-leaves"'));
  check('form: the shared leave core applyStudentLeave survives in leaves.js', LEAVES_SRC.includes('function applyStudentLeave'));
  check('form: the Ledger one-tap mark path survives', FEES_SRC.includes('function ledgerMarkMonthPaid') && FEES_SRC.includes('function ledgerMarkMonthUnpaid'));
  check('form: the Matrix modal one-tap path survives', FEES_SRC.includes('function matrixStatusButtonsHtml') || FEES_SRC.includes('matrixStatusButtonsHtml'));
  check('form: the shared mark path markMonthPaid/markMonthUnpaid survives', FEES_SRC.includes('function markMonthPaid') && FEES_SRC.includes('function markMonthUnpaid'));
  check('form: enrollment stays reachable via the Matrix modal action', FEES_SRC.includes("'set_admission_date'"));
  check('form: the Remind All buttons still call the same handlers', INDEX_SRC.includes('sendBulkPendingFeeReminders()') && INDEX_SRC.includes('sendBulkDefaulterReminders3Plus()'));
  check('form: js/fee-phase3.js is kept (its tests still run)', fs.existsSync(path.join(REPO_ROOT, 'js/fee-phase3.js')));
  check('form: js/fee-phase4.js leave helpers are kept as module exports', fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase4.js'), 'utf8').includes('planFeeFormLeave'));
  check('form: no Roman Urdu in the new Phase 6 UI strings', !/chhutti|tumhara|mujhe|krna ha|hata do/.test(FEES_SRC.slice(FEES_SRC.indexOf('function remindAllConfirmConfig') >= 0 ? 0 : 0)));
}

// ---- Remind All: the REAL wrappers against a fake DOM -------------------------
function makeElement(hiddenByDefault) {
  const classes = new Set(hiddenByDefault ? ['hidden'] : []);
  const attrs = {};
  return {
    value: '', innerText: '', innerHTML: '', className: '', checked: false, disabled: false,
    dataset: {}, style: {},
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => attrs[k],
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { if (force === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (force) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    appendChild: () => {},
    addEventListener: () => {},
    querySelectorAll: () => []
  };
}

function makeRemindHarness(role, confirmAnswer) {
  const elements = new Map();
  const documentStub = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, makeElement(false));
      return elements.get(id);
    },
    createElement: () => makeElement(false),
    querySelectorAll: () => []
  };
  documentStub.getElementById('btnRemindAllPendingMonth').disabled = false;
  documentStub.getElementById('btnRemindAll3PlusDefaulters').disabled = false;
  const store = {};
  const localStorageStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  const confirmCalls = [];
  const notifyCalls = [];
  const relayCalls = [];
  const parentEmailCalls = [];
  const windowStub = {
    lmsNotify: (m) => { notifyCalls.push(String(m)); },
    lmsConfirm: async (opts) => { confirmCalls.push(opts); return confirmAnswer; },
    sendViaOfficialEmailRelay: async (payload) => { relayCalls.push(payload); return { success: true, message: 'ok' }; },
    sendParentEmailViaNotify: async (payload) => { parentEmailCalls.push(payload); return { success: true }; }
  };
  const phaseSandbox = { window: windowStub, document: documentStub, console, setTimeout, clearTimeout };
  phaseSandbox.globalThis = phaseSandbox;
  vm.runInNewContext(PHASE6_SRC, phaseSandbox);
  const factory = new Function('window', 'document', 'localStorage', 'console', `
    ${extractConst(FEES_SRC, 'FEE_CONFIG')}
    let CURRENT_ROLE = '${role}';
    let CLOUD_FEE_RECORDS_CACHE = null;
    let CACHED_PENDING_FEE_LIST = [
      { familyId: 'FAM-A', parentName: 'Paid Family', email: 'a@example.com', dueAmount: 5000 },
      { familyId: 'FAM-B', parentName: 'Unpaid Family', email: 'b@example.com', dueAmount: 5000 }
    ];
    let CACHED_THREE_MONTH_DEFAULTERS = [
      { familyId: 'FAM-F', familyName: 'Defaulter Family', email: 'f@example.com', monthsDue: 3, outstanding: 15000 }
    ];
    let FEE_PENDING_REMIND_RUNNING = false;
    let FEE_DEFAULTER_REMIND_RUNNING = false;
    const lmsNotify = window.lmsNotify || (() => {});
    const lmsConfirm = (...args) => window.lmsConfirm(...args);
    function academyName() { return 'Al-Huda Islamic Centre'; }
    function getFamilyEmailAddress(fam) { return fam && fam.email ? fam.email : ''; }
    function buildPendingMonthReminderEmail(item) { return { subject: 'Fee Reminder — ' + item.parentName, plainText: 'Please pay your pending fee.', htmlBody: '<p>Please pay.</p>', offEmail: 'accounts@alhuda.example' }; }
    function buildDefaulter3PlusEmail(item) { return { subject: 'Fee Reminder — ' + item.familyName, plainText: 'Please pay your pending fee.', htmlBody: '<p>Please pay.</p>', offEmail: 'accounts@alhuda.example' }; }
    ${extractFunction(FEES_SRC, 'sendBulkPendingFeeRemindersInner')}
    ${extractFunction(FEES_SRC, 'sendBulkPendingFeeReminders')}
    ${extractFunction(FEES_SRC, 'sendBulkDefaulterReminders3PlusInner')}
    ${extractFunction(FEES_SRC, 'sendBulkDefaulterReminders3Plus')}
    return { sendBulkPendingFeeReminders, sendBulkDefaulterReminders3Plus, setRole: (r) => { CURRENT_ROLE = r; } };
  `);
  const api = factory(windowStub, documentStub, localStorageStub, console);
  return { api, el: (id) => documentStub.getElementById(id), confirmCalls, notifyCalls, relayCalls, parentEmailCalls, store };
}

{
  // Pending Remind All, OWNER role: Cancel sends nothing.
  const h = makeRemindHarness('owner', false);
  await h.api.sendBulkPendingFeeReminders();
  check('pending remind (owner): Cancel sends nothing', h.relayCalls.length === 0 && h.parentEmailCalls.length === 0);
  check('pending remind (owner): the confirm was shown before any send', h.confirmCalls.length === 1 && (typeof h.confirmCalls[0] === 'object' ? h.confirmCalls[0].message : h.confirmCalls[0]).indexOf('Are you sure you want to send fee reminders to all eligible families?') !== -1);
  check('pending remind (owner): Cancel leaves no dispatch record', !Object.keys(h.store).some((k) => k.indexOf('alhuda_bulk_pending_reminder_') === 0));
}

{
  // Pending Remind All, OWNER role: Confirm sends once per eligible family.
  const h = makeRemindHarness('owner', true);
  await h.api.sendBulkPendingFeeReminders();
  check('pending remind (owner): Confirm sends once per eligible family', h.relayCalls.length === 2, 'sent=' + h.relayCalls.length);
  check('pending remind (owner): the result is reported after sending', h.notifyCalls.some((m) => m.indexOf('2') !== -1 && m.toLowerCase().indexOf('reminder') !== -1));
  check('pending remind (owner): the dispatch is recorded', Object.keys(h.store).some((k) => k.indexOf('alhuda_bulk_pending_reminder_') === 0));
}

{
  // Pending Remind All, MANAGER role: the same two-step gate applies.
  const h = makeRemindHarness('manager', false);
  await h.api.sendBulkPendingFeeReminders();
  check('pending remind (manager): Cancel sends nothing', h.relayCalls.length === 0 && h.parentEmailCalls.length === 0);
  const h2 = makeRemindHarness('manager', true);
  await h2.api.sendBulkPendingFeeReminders();
  check('pending remind (manager): Confirm sends once per eligible family', h2.parentEmailCalls.length === 2, 'sent=' + h2.parentEmailCalls.length);
}

{
  // Pending Remind All, AUTO 4th-of-month trigger: no confirm, sends run.
  const h = makeRemindHarness('owner', false);
  await h.api.sendBulkPendingFeeReminders(true);
  check('pending remind (auto): the 4th-of-month trigger is NOT blocked by a confirm', h.confirmCalls.length === 0);
  check('pending remind (auto): the auto trigger still sends', h.relayCalls.length === 2, 'sent=' + h.relayCalls.length);
}

{
  // Pending Remind All: a second concurrent click is a no-op.
  const h = makeRemindHarness('owner', true);
  const p1 = h.api.sendBulkPendingFeeReminders();
  const p2 = h.api.sendBulkPendingFeeReminders();
  await Promise.all([p1, p2]);
  check('pending remind: a concurrent second click sends nothing extra', h.relayCalls.length === 2, 'sent=' + h.relayCalls.length);
}

{
  // Defaulters Remind All: the same two-step gate, both roles.
  const h = makeRemindHarness('owner', false);
  await h.api.sendBulkDefaulterReminders3Plus();
  check('defaulters remind (owner): Cancel sends nothing', h.relayCalls.length === 0 && h.parentEmailCalls.length === 0);
  check('defaulters remind (owner): the confirm was shown first', h.confirmCalls.length === 1);
  const h2 = makeRemindHarness('owner', true);
  await h2.api.sendBulkDefaulterReminders3Plus();
  check('defaulters remind (owner): Confirm sends once per defaulter', h2.relayCalls.length === 1, 'sent=' + h2.relayCalls.length);
  const h3 = makeRemindHarness('manager', false);
  await h3.api.sendBulkDefaulterReminders3Plus();
  check('defaulters remind (manager): Cancel sends nothing', h3.relayCalls.length === 0 && h3.parentEmailCalls.length === 0);
  const h4 = makeRemindHarness('manager', true);
  await h4.api.sendBulkDefaulterReminders3Plus();
  check('defaulters remind (manager): Confirm sends once per defaulter', h4.parentEmailCalls.length === 1, 'sent=' + h4.parentEmailCalls.length);
  const h5 = makeRemindHarness('owner', true);
  const q1 = h5.api.sendBulkDefaulterReminders3Plus();
  const q2 = h5.api.sendBulkDefaulterReminders3Plus();
  await Promise.all([q1, q2]);
  check('defaulters remind: a concurrent second click sends nothing extra', h5.relayCalls.length === 1, 'sent=' + h5.relayCalls.length);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
