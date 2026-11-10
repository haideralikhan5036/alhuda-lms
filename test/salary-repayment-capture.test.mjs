// Salary Restructuring Phase 2 — repayment-plan capture tests.
// Part W: drives the REAL cloudflare/worker.js against a fake D1
// (node:sqlite) and proves the /api/advances/request endpoint stores
// validated plan fields, rejects bad plans server-side, keeps legacy
// (plan-less) requests valid, and moves NO money in this phase.
// Part F: executes the REAL teacher.html advance functions in a vm —
// flag OFF reproduces today's exact submit payload; flag ON renders
// the plan section, drives its dynamic fields, and puts the plan on
// the payload; the teacher My Advance Requests list words the plan
// when present. (Phase 2 shipped the const OFF; Phase 3 flipped the
// shipped const ON — the harness still exercises both positions.)
// Part A: executes the REAL js/leaves.js review-card renderer — a
// planned request shows its plan; a plan-less one renders
// byte-identically to before Phase 2.
// Run from the repo root:  node test/salary-repayment-capture.test.mjs
// Requires: node >= 22.5 (node:sqlite).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEACHER = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
const LEAVES = fs.readFileSync(path.join(REPO_ROOT, 'js/leaves.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// =====================================================================
// Part W — Worker endpoint (real Worker + FakeD1)
// =====================================================================
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'salplan-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = ['test', 'worker', 'secret', '42'].join('-');
const ORIGIN = 'https://alhuda-lms.vercel.app';

class FakeStatement {
  constructor(db, sql) { this._db = db; this._sql = sql; this._params = []; }
  bind(...params) { this._params = params; return this; }
  async all() { const results = this._db.prepare(this._sql).all(...this._params); return { results, success: true, meta: {} }; }
  async run() { const r = this._db.prepare(this._sql).run(...this._params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
  async first() { const row = this._db.prepare(this._sql).get(...this._params); return row === undefined ? null : row; }
}
class FakeD1 {
  constructor() { this._db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new FakeStatement(this._db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
  async exec(sql) { this._db.exec(sql); return { success: true }; }
  seed(sql, ...params) { this._db.prepare(sql).run(...params); }
  q(sql, ...params) { return this._db.prepare(sql).all(...params); }
  q1(sql, ...params) { const r = this._db.prepare(sql).get(...params); return r === undefined ? null : r; }
}

const fakeDb = new FakeD1();
const baseEnv = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: fakeDb };
const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  teacherA: await createSessionToken({ sub: 'TCH-A', role: 'teacher' }, WORKER_SECRET),
  teacherB: await createSessionToken({ sub: 'TCH-B', role: 'teacher' }, WORKER_SECRET),
};
async function call(url, { method = 'POST', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const req = new Request(url, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, baseEnv, {});
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, data };
}
const advReq = (token, body) => call('https://worker.test/api/advances/request', { token, body });
const planOf = (id) => fakeDb.q1('SELECT repayment_method, installment_amount FROM advance_requests WHERE id = ?', id);

// Pre-create the OLD (schema v5) advance_requests shape BEFORE the
// schema boot, so the boot's try/ALTER path — not just the fresh
// CREATE TABLE — is what adds the plan columns (the live migration).
await fakeDb.exec(`CREATE TABLE advance_requests (
  id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, teacher_name TEXT,
  period TEXT NOT NULL, advance_type TEXT NOT NULL,
  requested_amount REAL NOT NULL, approved_amount REAL,
  status TEXT DEFAULT 'Pending', reason TEXT, reviewer_comment TEXT,
  reviewed_by TEXT, adjustment_id TEXT, requested_at TEXT,
  decided_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
)`);
{
  const r = await call('https://worker.test/api/db', { token: TOK.owner, body: { table: 'families', action: 'select' } });
  check('W setup: owner /api/db boot -> 200', r.status === 200, r.text.slice(0, 200));
  const cols = fakeDb.q('PRAGMA table_info(advance_requests)').map((c) => c.name);
  check('W setup: ALTER migration adds repayment_method + installment_amount to a v5 table',
    cols.includes('repayment_method') && cols.includes('installment_amount'), cols.join(','));
  const marker = fakeDb.q1("SELECT value FROM system_settings WHERE key = 'schema_version'");
  check('W setup: schema marker is v6', marker && marker.value === '2026-11-07-v8', JSON.stringify(marker));
  const h = await call('https://worker.test/api/health', { method: 'GET' });
  check('W setup: health reports plan-capture release + schema v6',
    h.status === 200 && h.data && h.data.version === '2026-11-10-teacher-self-reset' && h.data.schema === '2026-11-07-v8', h.text.slice(0, 200));
}
fakeDb.seed("INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)",
  'TCH-A', 'Teacher A', JSON.stringify({ salary_slips: {} }), 'Active');
fakeDb.seed("INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)",
  'TCH-B', 'Teacher B', JSON.stringify({ salary_slips: {} }), 'Active');
fakeDb.seed("INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, base_subtotal, bonus, deduction_total, advance_deducted, net_payable, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  'SAL-TA-10', 'TCH-A', '2026-10', 'AH-SAL-202610-AAAAAA', 'October 2026', 40000, 0, 0, 0, 40000, 'Pending');
fakeDb.seed("INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, base_subtotal, bonus, deduction_total, advance_deducted, net_payable, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  'SAL-TB-10', 'TCH-B', '2026-10', 'AH-SAL-202610-BBBBBB', 'October 2026', 30000, 0, 0, 0, 30000, 'Pending');

{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'custom', custom_amount: 10000 });
  check('W legacy: plan-less request still accepted (200)', r.status === 200 && r.data && r.data.ok === true, r.text.slice(0, 200));
  const row = r.data && r.data.request ? planOf(r.data.request.id) : null;
  check('W legacy: plan columns store NULL; response echoes nulls',
    !!row && row.repayment_method === null && row.installment_amount === null &&
    r.data.request.repayment_method === null && r.data.request.installment_amount === null, JSON.stringify(row));
}
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'full', repayment_method: 'full', installment_amount: 9999 });
  check('W full: full advance with plan accepted', r.status === 200 && r.data && r.data.ok === true, r.text.slice(0, 200));
  const row = r.data && r.data.request ? planOf(r.data.request.id) : null;
  check('W full: method stored; stray installment NULLED server-side',
    !!row && row.repayment_method === 'full' && row.installment_amount === null, JSON.stringify(row));
}
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'custom', custom_amount: 5000, repayment_method: 'weekly' });
  check('W invalid: unknown repayment method refused (400)', r.status === 400, r.text.slice(0, 200));
  const n = fakeDb.q("SELECT id FROM advance_requests WHERE teacher_id = 'TCH-A' AND requested_amount = 5000");
  check('W invalid: refused request wrote no row', n.length === 0);
}
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'custom', custom_amount: 6000, repayment_method: 'fixed' });
  check('W invalid: fixed plan without installment refused (400)', r.status === 400, r.text.slice(0, 200));
  const r2 = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'custom', custom_amount: 6000, repayment_method: 'fixed', installment_amount: 0 });
  check('W invalid: fixed plan with zero installment refused (400)', r2.status === 400, r2.text.slice(0, 200));
  const n = fakeDb.q("SELECT id FROM advance_requests WHERE teacher_id = 'TCH-A' AND requested_amount = 6000");
  check('W invalid: no rows from refused fixed plans', n.length === 0);
}
let fixedReq;
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'custom', custom_amount: 15000, repayment_method: 'fixed', installment_amount: 5000 });
  check('W fixed: valid fixed plan accepted', r.status === 200 && r.data && r.data.ok === true, r.text.slice(0, 200));
  fixedReq = r.data && r.data.request;
  const row = fixedReq ? planOf(fixedReq.id) : null;
  check('W fixed: stored fixed / 5000 and echoed in the response',
    !!row && row.repayment_method === 'fixed' && Number(row.installment_amount) === 5000 &&
    fixedReq.repayment_method === 'fixed' && Number(fixedReq.installment_amount) === 5000, JSON.stringify(row));
}
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'custom', custom_amount: 15000, repayment_method: 'fixed', installment_amount: 5000 });
  check('W fixed: identical re-submit is the existing duplicate (no second row)',
    r.status === 200 && r.data && r.data.duplicate === true && fixedReq && r.data.request.id === fixedReq.id, r.text.slice(0, 200));
  const n = fakeDb.q("SELECT id FROM advance_requests WHERE teacher_id = 'TCH-A' AND requested_amount = 15000 AND status = 'Pending'");
  check('W fixed: still exactly one pending row', n.length === 1);
}
{
  const r = await advReq(TOK.teacherA, { period: '2026-10', advance_type: 'custom', custom_amount: 8000, repayment_method: 'manual', installment_amount: 1234 });
  check('W manual: manual plan accepted', r.status === 200 && r.data && r.data.ok === true, r.text.slice(0, 200));
  const row = r.data && r.data.request ? planOf(r.data.request.id) : null;
  check('W manual: method stored; stray installment NULLED server-side',
    !!row && row.repayment_method === 'manual' && row.installment_amount === null, JSON.stringify(row));
}
{
  const r = await advReq(TOK.teacherB, { period: '2026-10', advance_type: 'custom', custom_amount: 12000, repayment_method: 'custom', installment_amount: 3000 });
  check('W custom plan: valid custom plan accepted', r.status === 200 && r.data && r.data.ok === true, r.text.slice(0, 200));
  const row = r.data && r.data.request ? planOf(r.data.request.id) : null;
  check('W custom plan: stored custom / 3000',
    !!row && row.repayment_method === 'custom' && Number(row.installment_amount) === 3000, JSON.stringify(row));
  const r2 = await advReq(TOK.teacherB, { period: '2026-10', advance_type: 'custom', custom_amount: 7000, repayment_method: 'custom' });
  check('W invalid: custom plan without installment refused (400)', r2.status === 400, r2.text.slice(0, 200));
}
{
  const slip = fakeDb.q1('SELECT net_payable, advance_deducted FROM salary_slips WHERE id = ?', 'SAL-TA-10');
  const adj = fakeDb.q("SELECT id FROM salary_adjustments WHERE kind = 'advance'");
  check('W safety: plan capture moved NO money (slip untouched, zero ledger rows)',
    !!slip && Number(slip.net_payable) === 40000 && Number(slip.advance_deducted) === 0 && adj.length === 0,
    JSON.stringify(slip) + ' adj=' + adj.length);
}

// =====================================================================
// Part F — teacher.html frontend (real functions in a vm + fake DOM)
// =====================================================================
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

class FakeEl {
  constructor(id, classAttr, attrs, doc) {
    this.id = id || '';
    this._doc = doc || null;
    this._set = new Set(String(classAttr || '').split(/\s+/).filter(Boolean));
    this._attrs = attrs || {};
    this.style = {};
    this.value = '';
    this.innerText = '';
    this.disabled = false;
    this._html = '';
    this.parentElement = null;
    this.children = [];
    const self = this;
    this.classList = {
      add: (...cs) => cs.forEach((c) => self._set.add(c)),
      remove: (...cs) => cs.forEach((c) => self._set.delete(c)),
      toggle: (c, force) => {
        const want = force === undefined ? !self._set.has(c) : !!force;
        if (want) self._set.add(c); else self._set.delete(c);
        return want;
      },
      contains: (c) => self._set.has(c),
    };
  }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  set innerHTML(v) { this._html = String(v); if (this._doc) this._doc._registerFromHtml(this._html, this); }
  get innerHTML() { return this._html; }
  insertBefore(el, ref) { el.parentElement = this; this.children.push(el); if (this._doc && el.id) this._doc._register(el); return el; }
}
class FakeDoc {
  constructor() { this.registry = new Map(); this.loose = []; }
  _register(el) { if (el && el.id) this.registry.set(el.id, el); }
  _registerFromHtml(html, parent) {
    for (const m of String(html).matchAll(/<(\w+)([^>]*)>/g)) {
      const attrs = m[2];
      const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
      const cls = (attrs.match(/\bclass="([^"]*)"/) || [])[1] || '';
      const a = {};
      const dp = attrs.match(/\bdata-adv-plan="([^"]+)"/); if (dp) a['data-adv-plan'] = dp[1];
      const df = attrs.match(/\bdata-adv-plan-fixed="([^"]+)"/); if (df) a['data-adv-plan-fixed'] = df[1];
      // Id-less controls (the plan option cards + chips) are tracked
      // loosely so class-based querySelectorAll can find them, exactly
      // as a real DOM would.
      if (!id) {
        if (cls.includes('adv-plan-btn') || cls.includes('adv-plan-fixed-chip')) {
          const el = new FakeEl('', cls, a, this);
          el.parentElement = parent;
          this.loose.push(el);
        }
        continue;
      }
      if (this.registry.has(id)) continue;
      const el = new FakeEl(id, cls, a, this);
      el.parentElement = parent;
      this.registry.set(id, el);
    }
  }
  getElementById(id) { return this.registry.get(id) || null; }
  querySelectorAll(sel) {
    const all = [...this.registry.values(), ...this.loose];
    if (sel.includes('.adv-plan-btn')) return all.filter((e) => e._set.has('adv-plan-btn'));
    if (sel.includes('.adv-plan-fixed-chip')) return all.filter((e) => e._set.has('adv-plan-fixed-chip'));
    if (sel.includes('.adv-type-btn')) return all.filter((e) => e._set.has('adv-type-btn'));
    return [];
  }
  querySelector() { return null; }
  createElement() { return new FakeEl('', '', {}, this); }
}

const TEACHER_FNS = ['_tAdvNetOf', '_tAdvPeriodOf', '_tAdvLabelOf', '_tAdvSelectedSlip', 'selectAdvanceType',
  'refreshAdvanceAmountText', '_tAdvAuthHeaders', 'buildAdvanceRepaymentPlanSection', 'selectAdvanceRepaymentPlan',
  'selectAdvancePlanFixedAmount', 'submitTeacherAdvanceRequest', 'loadTeacherAdvanceRequests'];

function bootTeacherVm(flagOn) {
  const doc = new FakeDoc();
  const mk = (id, cls = '', value = '') => { const el = new FakeEl(id, cls, {}, doc); el.value = value; doc._register(el); return el; };
  mk('tAdvPeriod', '', '2026-10');
  mk('tAdvCustomAmount', '', '10000');
  const reason = mk('tAdvReason');
  const reasonWrap = new FakeEl('', '', {}, doc);
  const formCard = new FakeEl('', '', {}, doc);
  reason.parentElement = reasonWrap;
  reasonWrap.parentElement = formCard;
  mk('tAdvSubmitBtn');
  mk('tAdvAmountText');
  mk('tAdvAmountHint');
  mk('tAdvCustomBox', 'hidden');
  mk('tAdvMyList');
  const fetches = [];
  const notifies = [];
  const sandbox = {
    console,
    document: doc,
    FeeTables: {
      periodFromLabel: (l) => (l === 'October 2026' ? '2026-10' : null),
      labelFromPeriod: (p) => (p === '2026-10' ? 'October 2026' : p),
    },
    CURRENT_TEACHER: { id: 'TCH-A' },
    lmsNotify: (m) => notifies.push(String(m)),
    getTeacherWorkerBase: () => 'https://worker.test',
    loadTeacherPreviousSalaries: () => {},
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null, setItem: () => {} },
    db: null,
    fetch: async (url, opts) => {
      fetches.push({ url, body: opts && opts.body });
      return { ok: true, status: 200, json: async () => ({ ok: true, request: { id: 'ADV-NEW' } }) };
    },
  };
  sandbox.window = sandbox;
  sandbox.ADVANCE_REPAYMENT_PLANS_ENABLED = flagOn;
  vm.createContext(sandbox);
  const prelude = [
    "let _TADV_SLIPS = [{ month: 'October 2026', net_payable: 20000, base_subtotal: 20000, bonus: 0, deduction: 0, advance_deducted: 0 }];",
    "let _TADV_TYPE = 'custom';",
    'let _TADV_SUBMITTING = false;',
    "let _TADV_PLAN = 'full';",
    'let _TADV_PLAN_FIXED_AMOUNT = 5000;',
  ].join('\n');
  vm.runInContext(prelude + '\n' + TEACHER_FNS.map((n) => extractFunction(TEACHER, n)).join('\n'), sandbox);
  return { sandbox, doc, fetches, notifies, formCard };
}
const runIn = (env, code) => vm.runInContext(code, env.sandbox);

// Static gates: the shipped flag is ON — the v7 Worker deploy
// (release 2026-11-10-teacher-self-reset) was verified live via
// /api/health on 2026-11-07 before this flip landed, so plan
// capture is live together with the ledger. The builder is only
// invoked behind the flag, and the plan section exists nowhere in
// static markup.
check('F static: shipped flag is ON (v7 Worker deploy verified live)', TEACHER.includes('const ADVANCE_REPAYMENT_PLANS_ENABLED = true;'));
check('F static: builder invoked only behind the flag',
  TEACHER.includes('if (ADVANCE_REPAYMENT_PLANS_ENABLED) buildAdvanceRepaymentPlanSection();'));
check('F static: no plan section in static form markup', !TEACHER.includes('id="tAdvPlanSection"'));

{ // Flag OFF — today's exact payload, no plan section anywhere.
  const env = bootTeacherVm(false);
  await runIn(env, 'submitTeacherAdvanceRequest()');
  check('F off: exactly one request sent', env.fetches.length === 1, 'fetches=' + env.fetches.length);
  check('F off: payload is byte-identical to the Batch B payload',
    env.fetches.length === 1 && env.fetches[0].body === '{"period":"2026-10","advance_type":"custom","custom_amount":10000}',
    env.fetches.length ? String(env.fetches[0].body) : 'no fetch');
  check('F off: no plan section was built', env.doc.getElementById('tAdvPlanSection') === null);
}

{ // Flag ON (harness only) — section, dynamic fields, payload plans.
  const env = bootTeacherVm(true);
  await runIn(env, 'buildAdvanceRepaymentPlanSection()');
  const section = env.doc.getElementById('tAdvPlanSection');
  check('F on: plan section built into the form', !!section && env.formCard.children.includes(section));
  await runIn(env, 'buildAdvanceRepaymentPlanSection()');
  check('F on: builder is idempotent (still one section)', env.formCard.children.length === 1);
  const planBtns = env.doc.querySelectorAll('#tAdvPlanGroup .adv-plan-btn');
  check('F on: four plan options rendered (full/fixed/custom/manual)',
    planBtns.length === 4 && ['full', 'fixed', 'custom', 'manual'].every((m) => planBtns.some((b) => b.getAttribute('data-adv-plan') === m)),
    'btns=' + planBtns.length);
  check('F on: installment boxes + manual note start hidden',
    env.doc.getElementById('tAdvPlanFixedBox').classList.contains('hidden') &&
    env.doc.getElementById('tAdvPlanCustomBox').classList.contains('hidden') &&
    env.doc.getElementById('tAdvPlanManualNote').classList.contains('hidden'));

  const submit = async () => {
    env.doc.getElementById('tAdvCustomAmount').value = '10000';
    await runIn(env, 'submitTeacherAdvanceRequest()');
    return env.fetches.length ? JSON.parse(env.fetches[env.fetches.length - 1].body) : null;
  };

  await runIn(env, "selectAdvanceRepaymentPlan('fixed')");
  check('F on: fixed shows only the fixed installment box',
    !env.doc.getElementById('tAdvPlanFixedBox').classList.contains('hidden') &&
    env.doc.getElementById('tAdvPlanCustomBox').classList.contains('hidden'));
  await runIn(env, 'selectAdvancePlanFixedAmount(10000)');
  let body = await submit();
  check('F on: fixed submit carries repayment_method + chosen chip amount',
    !!body && body.repayment_method === 'fixed' && body.installment_amount === 10000, JSON.stringify(body));

  await runIn(env, "selectAdvanceRepaymentPlan('custom')");
  check('F on: custom shows only the custom amount box',
    env.doc.getElementById('tAdvPlanFixedBox').classList.contains('hidden') &&
    !env.doc.getElementById('tAdvPlanCustomBox').classList.contains('hidden'));
  env.doc.getElementById('tAdvPlanCustomAmount').value = '3000';
  body = await submit();
  check('F on: custom submit carries repayment_method + entered amount',
    !!body && body.repayment_method === 'custom' && body.installment_amount === 3000, JSON.stringify(body));

  await runIn(env, "selectAdvanceRepaymentPlan('full')");
  body = await submit();
  check('F on: full submit carries the method and NO installment key',
    !!body && body.repayment_method === 'full' && !('installment_amount' in body), JSON.stringify(body));

  await runIn(env, "selectAdvanceRepaymentPlan('manual')");
  check('F on: manual shows its explainer note, boxes hidden',
    !env.doc.getElementById('tAdvPlanManualNote').classList.contains('hidden') &&
    env.doc.getElementById('tAdvPlanFixedBox').classList.contains('hidden') &&
    env.doc.getElementById('tAdvPlanCustomBox').classList.contains('hidden'));
  body = await submit();
  check('F on: manual submit carries the method and NO installment key',
    !!body && body.repayment_method === 'manual' && !('installment_amount' in body), JSON.stringify(body));

  const before = env.fetches.length;
  await runIn(env, "selectAdvanceRepaymentPlan('custom')");
  env.doc.getElementById('tAdvPlanCustomAmount').value = '99999';
  await submit();
  check('F on: custom installment above the advance amount is refused client-side',
    env.fetches.length === before && env.notifies.some((m) => m.includes('cannot exceed')), env.notifies.join(' | '));
  env.doc.getElementById('tAdvPlanCustomAmount').value = '';
  await submit();
  check('F on: empty custom installment is refused client-side',
    env.fetches.length === before && env.notifies.some((m) => m.includes('more than 0')), env.notifies.join(' | '));

  // My Advance Requests: the plan is worded when present, absent for legacy.
  const rows = [
    { id: 'ADV-1', advance_type: 'custom', requested_amount: 15000, approved_amount: null, status: 'Pending', period: '2026-10', period_label: 'October 2026', requested_at: '2026-11-01T09:00:00Z', reason: null, reviewer_comment: null, repayment_method: 'fixed', installment_amount: 5000 },
    { id: 'ADV-2', advance_type: 'custom', requested_amount: 9000, approved_amount: null, status: 'Pending', period: '2026-10', period_label: 'October 2026', requested_at: '2026-11-02T09:00:00Z', reason: null, reviewer_comment: null, repayment_method: null, installment_amount: null },
  ];
  env.sandbox.db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  };
  await runIn(env, 'loadTeacherAdvanceRequests()');
  const listHtml = env.doc.getElementById('tAdvMyList').innerHTML;
  check('F list: planned request shows its plan in plain words',
    listHtml.includes('Repayment plan: Fixed Installment — 5,000 PKR per salary'), listHtml.slice(0, 300));
  check('F list: legacy request shows no plan line',
    (listHtml.match(/Repayment plan:/g) || []).length === 1);
}

// =====================================================================
// Part A — admin review card (real js/leaves.js renderer)
// =====================================================================
{
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(['_advanceEsc', '_advancePlanText', 'renderAdvanceSalaryRequestItem'].map((n) => extractFunction(LEAVES, n)).join('\n'), sandbox);
  const render = (item) => vm.runInContext(`renderAdvanceSalaryRequestItem(${JSON.stringify(item)})`, sandbox);
  const baseReq = { id: 'ADV-1', advance_type: 'custom', requested_amount: 15000, period: '2026-10', period_label: 'October 2026', requested_at: '2026-11-01T10:00:00Z', reason: 'Family need' };
  const item = (req) => ({ teacher: { id: 'TCH-A', full_name: 'Teacher A' }, request: req });

  const fixedHtml = render(item({ ...baseReq, repayment_method: 'fixed', installment_amount: 5000 }));
  check('A card: fixed plan renders as "Fixed — PKR 5,000 per salary"',
    fixedHtml.includes('Repayment Plan:') && fixedHtml.includes('Fixed — PKR 5,000 per salary'));
  const customHtml = render(item({ ...baseReq, repayment_method: 'custom', installment_amount: 3000 }));
  check('A card: custom plan renders distinctly from fixed',
    customHtml.includes('Custom — PKR 3,000 per salary') && !customHtml.includes('Fixed —'));
  const manualHtml = render(item({ ...baseReq, repayment_method: 'manual', installment_amount: null }));
  check('A card: manual plan renders its own wording', manualHtml.includes('Manual — teacher decides an amount before each salary'));
  const fullHtml = render(item({ ...baseReq, repayment_method: 'full', installment_amount: null }));
  check('A card: full plan renders', fullHtml.includes('Full Deduction — entire advance from the next eligible salary'));
  const legacyHtml = render(item({ ...baseReq }));
  const legacyNullHtml = render(item({ ...baseReq, repayment_method: null, installment_amount: null }));
  check('A card: plan-less request shows no plan block', !legacyHtml.includes('Repayment Plan'));
  check('A card: plan-less rendering is byte-identical (absent keys vs NULLs)', legacyHtml === legacyNullHtml);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILURES: ' + failed.map((f) => f.name).join(' ; ')); process.exit(1); }
