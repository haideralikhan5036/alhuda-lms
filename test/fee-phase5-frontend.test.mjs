// Fee Upgrade Phase 5 — PDF storage in R2 (#71).
// Executes the REAL js/fee-phase5.js in a vm sandbox, plus the REAL glue
// functions extracted from js/fees.js (storeFeePdfForReceipt,
// feeReceiptPdfCellHtml, openStoredFeePdf) and js/fee-phase1.js
// (storeDueInvoicePdf, loadFeeDueInvoicesList) with stubbed fetch/DOM.
// Run from the repo root:  node test/fee-phase5-frontend.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHASE5_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase5.js'), 'utf8');
const FEES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const PHASE1_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase1.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
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

// ---- Load the real FeePhase5 module -------------------------------------------
const windowObj = {};
const sandbox = { window: windowObj, console, setTimeout, clearTimeout, btoa, atob, Blob, URL };
sandbox.globalThis = sandbox;
vm.runInNewContext(PHASE5_SRC, sandbox);
const F = windowObj.FeePhase5;

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x68, 0x69]);
const NOT_PDF = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
const REC = { receiptNo: 'AH-REC-20261117-ABCDEF', familyId: 'FAM-021', month: 'November', year: 2026, amountPaid: 7500, totalPayable: 7500, remainingBalance: 0, status: 'Paid in Full', currency: 'PKR', date: '2026-11-05', parentName: 'Hajra Waqas', studentsNames: 'Ayesha', recordKind: 'payment' };

// ---- exports -------------------------------------------------------------------
{
  const EXPECTED = ['WORKER_ORIGIN', 'FEE_DOC_PREFIX', 'FEE_PDF_MAX_BYTES', 'esc', 'feePdfKeyFor', 'feePdfKindOfKey', 'isFeePdfKey', 'isPdfBytes', 'bytesToBase64', 'base64ToBytes', 'feePdfApiBase', 'storedFeePdfUrl', 'feePdfStatus', 'receiptPdfStatus', 'withPdfKey', 'withPdfPending', 'uploadFeePdf', 'deleteFeePdf', 'openStoredFeePdf'];
  check('FeePhase5 exports every function the glue calls', F && EXPECTED.every((n) => typeof F[n] === 'function' || typeof F[n] === 'string' || typeof F[n] === 'number'), EXPECTED.filter((n) => !(typeof F[n] === 'function' || typeof F[n] === 'string' || typeof F[n] === 'number')).join(','));
  check('FeePhase5 constants are the Worker contract', F.FEE_DOC_PREFIX === 'fee-documents/' && F.FEE_PDF_MAX_BYTES === 5 * 1024 * 1024);
}

// ---- key building ----------------------------------------------------------------
check('receipt key is deterministic', F.feePdfKeyFor('receipt', 'AH-REC-20261117-ABCDEF') === 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf');
check('due-invoice key is deterministic', F.feePdfKeyFor('due-invoice', 'DUE-202611-FAM-001') === 'fee-documents/due-invoices/DUE-202611-FAM-001.pdf');
check('bad kind -> null', F.feePdfKeyFor('photo', 'AH-REC-1') === null);
check('ref with slash -> null', F.feePdfKeyFor('receipt', '../evil') === null);
check('ref with path traversal -> null', F.feePdfKeyFor('receipt', 'a/b/c') === null);
check('ref with space -> null', F.feePdfKeyFor('receipt', 'AH REC 1') === null);
check('empty ref -> null', F.feePdfKeyFor('receipt', '') === null);
check('kind of receipt key', F.feePdfKindOfKey('fee-documents/receipts/AH-REC-1.pdf') === 'receipt');
check('kind of due-invoice key', F.feePdfKindOfKey('fee-documents/due-invoices/DUE-1.pdf') === 'due-invoice');
check('kind of foreign key is null', F.feePdfKindOfKey('course_material/x.pdf') === null);
check('kind of non-pdf key is null', F.feePdfKindOfKey('fee-documents/receipts/AH-REC-1.png') === null);
check('isFeePdfKey accepts fee keys only', F.isFeePdfKey('fee-documents/receipts/A.pdf') === true && F.isFeePdfKey('scoped-teacher-T-1/x.webp') === false);

// ---- bytes ------------------------------------------------------------------------
check('PDF magic recognised', F.isPdfBytes(PDF_BYTES) === true);
check('non-PDF bytes rejected', F.isPdfBytes(NOT_PDF) === false);
check('short bytes rejected', F.isPdfBytes(new Uint8Array([0x25, 0x50])) === false);
{
  const round = F.base64ToBytes(F.bytesToBase64(PDF_BYTES));
  check('base64 round-trip preserves bytes', round.length === PDF_BYTES.length && round.every((b, i) => b === PDF_BYTES[i]));
  const big = new Uint8Array(200000);
  for (let i = 0; i < big.length; i++) big[i] = i % 251;
  big[0] = 0x25; big[1] = 0x50; big[2] = 0x44; big[3] = 0x46;
  const bigRound = F.base64ToBytes(F.bytesToBase64(big));
  check('base64 round-trip works past the 32 KB chunk boundary', bigRound.length === big.length && bigRound[199999] === big[199999]);
  check('data-URL prefix is stripped on decode', F.base64ToBytes('data:application/pdf;base64,' + F.bytesToBase64(PDF_BYTES)).length === PDF_BYTES.length);
}
check('stored URL is the existing storage read path', F.storedFeePdfUrl('https://worker.test', 'fee-documents/receipts/AH-REC-1.pdf') === 'https://worker.test/api/storage?key=fee-documents%2Freceipts%2FAH-REC-1.pdf');

// ---- record status ------------------------------------------------------------------
check('status stored when pdfKey exists', F.receiptPdfStatus({ ...REC, pdfKey: 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf' }) === 'stored');
check('status pending when pdfPending', F.receiptPdfStatus({ ...REC, pdfPending: true }) === 'pending');
check('status none otherwise', F.receiptPdfStatus(REC) === 'none');
check('status none for a foreign pdfKey', F.receiptPdfStatus({ ...REC, pdfKey: 'course_material/x.pdf' }) === 'none');
{
  const withKey = F.withPdfKey({ ...REC, pdfPending: true }, 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf');
  check('withPdfKey sets the key and clears pending', withKey.pdfKey === 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf' && !withKey.pdfPending);
  check('withPdfKey does not mutate the input', REC.pdfKey === undefined && REC.pdfPending === undefined);
  const withPending = F.withPdfPending({ ...REC, pdfKey: 'fee-documents/receipts/OLD.pdf' });
  check('withPdfPending clears the key and sets pending', withPending.pdfPending === true && withPending.pdfKey === undefined);
}

// ---- uploadFeePdf (stubbed fetch) -----------------------------------------------------
function stubFetchFactory(behavior) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return behavior(url, opts);
  };
  fn.calls = calls;
  return fn;
}
function jsonOk(body, status) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
{
  const fetchStub = stubFetchFactory(async () => jsonOk({ ok: true, key: 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf', url: '/api/storage?key=x' }, 200));
  const res = await F.uploadFeePdf(fetchStub, 'https://worker.test', { Authorization: 'Bearer t' }, 'receipt', 'AH-REC-20261117-ABCDEF', PDF_BYTES);
  check('upload posts to /api/fee-documents with kind/ref/base64', res.ok === true && res.key === 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf' && fetchStub.calls.length === 1 && fetchStub.calls[0].url === 'https://worker.test/api/fee-documents' && fetchStub.calls[0].opts.method === 'POST', JSON.stringify(fetchStub.calls.map((c) => c.url)));
  const sent = JSON.parse(fetchStub.calls[0].opts.body);
  check('upload body base64 decodes to the PDF bytes', sent.kind === 'receipt' && sent.ref === 'AH-REC-20261117-ABCDEF' && F.base64ToBytes(sent.base64).every((b, i) => b === PDF_BYTES[i]));
  check('upload carries the session token', fetchStub.calls[0].opts.headers.Authorization === 'Bearer t');
}
{
  // Pre-deploy: the endpoint 404s. The helper must report it, never throw.
  const fetch404 = stubFetchFactory(async () => jsonOk({ ok: false, error: 'Not Found' }, 404));
  const res = await F.uploadFeePdf(fetch404, 'https://worker.test', {}, 'receipt', 'AH-REC-20261117-ABCDEF', PDF_BYTES);
  check('upload 404 (Worker not yet deployed) -> { ok:false } without throwing', res.ok === false && res.status === 404);
  const fetchThrow = stubFetchFactory(async () => { throw new Error('boom'); });
  const res2 = await F.uploadFeePdf(fetchThrow, 'https://worker.test', {}, 'receipt', 'AH-REC-20261117-ABCDEF', PDF_BYTES);
  check('upload network failure -> { ok:false } without throwing', res2.ok === false && res2.error === 'network_error');
  const fetchSpy = stubFetchFactory(async () => jsonOk({ ok: true, key: 'k' }, 200));
  const res3 = await F.uploadFeePdf(fetchSpy, 'https://worker.test', {}, 'receipt', 'AH-REC-20261117-ABCDEF', NOT_PDF);
  check('non-PDF bytes never reach the network', res3.ok === false && res3.error === 'not_a_pdf' && fetchSpy.calls.length === 0);
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  big[0] = 0x25; big[1] = 0x50; big[2] = 0x44; big[3] = 0x46;
  const res4 = await F.uploadFeePdf(fetchSpy, 'https://worker.test', {}, 'receipt', 'AH-REC-20261117-ABCDEF', big);
  check('oversized bytes never reach the network', res4.ok === false && res4.error === 'file_too_large' && fetchSpy.calls.length === 0);
  const res5 = await F.uploadFeePdf(fetchSpy, 'https://worker.test', {}, 'receipt', '../evil', PDF_BYTES);
  check('bad ref never reaches the network', res5.ok === false && res5.error === 'bad_ref' && fetchSpy.calls.length === 0);
}

// ---- deleteFeePdf ---------------------------------------------------------------------
{
  const fetchStub = stubFetchFactory(async () => jsonOk({ ok: true, key: 'fee-documents/receipts/A.pdf', deleted: true }, 200));
  const res = await F.deleteFeePdf(fetchStub, 'https://worker.test', { Authorization: 'Bearer t' }, 'fee-documents/receipts/A.pdf');
  check('delete calls DELETE on /api/fee-documents?key=', res.ok === true && fetchStub.calls.length === 1 && fetchStub.calls[0].opts.method === 'DELETE' && fetchStub.calls[0].url.indexOf('/api/fee-documents?key=fee-documents%2Freceipts%2FA.pdf') !== -1, fetchStub.calls.map((c) => c.url).join(','));
  const spy = stubFetchFactory(async () => jsonOk({ ok: true }, 200));
  const res2 = await F.deleteFeePdf(spy, 'https://worker.test', {}, 'course_material/x.pdf');
  check('delete outside fee-documents/ never reaches the network', res2.ok === false && spy.calls.length === 0);
}

// ---- openStoredFeePdf (stubbed fetch + window) -----------------------------------------
{
  const blobBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const fetchStub = stubFetchFactory(async () => ({ ok: true, status: 200, blob: async () => new Blob([blobBytes], { type: 'application/pdf' }) }));
  let openedUrl = null;
  const winStub = { open: (u) => { openedUrl = u; return {}; } };
  const docStub = { createElement: () => ({ click: () => {} }), body: { appendChild: () => {}, removeChild: () => {} } };
  const res = await F.openStoredFeePdf(fetchStub, 'https://worker.test', { Authorization: 'Bearer t' }, 'fee-documents/receipts/A.pdf', { window: winStub, document: docStub, URL });
  check('open fetches the stored PDF with the token and opens a blob URL', res.ok === true && fetchStub.calls.length === 1 && fetchStub.calls[0].url === 'https://worker.test/api/storage?key=fee-documents%2Freceipts%2FA.pdf' && typeof openedUrl === 'string' && openedUrl.indexOf('blob:') === 0, openedUrl);
  const fetch404 = stubFetchFactory(async () => ({ ok: false, status: 404, blob: async () => new Blob([]) }));
  const res2 = await F.openStoredFeePdf(fetch404, 'https://worker.test', {}, 'fee-documents/receipts/A.pdf', { window: winStub, document: docStub, URL });
  check('open of a missing stored PDF -> { ok:false } without throwing', res2.ok === false);
  // Popup blocked: window.open returns null -> falls back to an anchor download click.
  let anchorClicked = false;
  const winBlocked = { open: () => null };
  const docStub2 = { createElement: () => ({ click: () => { anchorClicked = true; } }), body: { appendChild: () => {}, removeChild: () => {} } };
  const res3 = await F.openStoredFeePdf(fetchStub, 'https://worker.test', {}, 'fee-documents/receipts/A.pdf', { window: winBlocked, document: docStub2, URL });
  check('blocked popup falls back to a download click', res3.ok === true && anchorClicked === true);
}

// ---- fees.js glue: storeFeePdfForReceipt / feeReceiptPdfCellHtml / openStoredFeePdf ----
function makeFeesHarness(opts) {
  const o = opts || {};
  const state = {
    records: (o.records || [JSON.parse(JSON.stringify(REC))]),
    syncCalls: [],
    feeTablesCalls: [],
    notifies: [],
    syncResult: o.syncResult !== undefined ? o.syncResult : { ok: true },
  };
  const fetchStub = stubFetchFactory(o.fetchBehavior || (async () => jsonOk({ ok: true, key: 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf', url: '/api/storage?key=x' }, 200)));
  const windowStub = {
    FeePhase5: F,
    FeeTables: {
      updatePaymentPdfKey: async (...args) => { state.feeTablesCalls.push(args); return { ok: true }; },
    },
    getLmsAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
    lmsNotify: (msg) => { state.notifies.push(msg); },
  };
  const factory = new Function('window', 'document', 'fetch', 'lmsNotify', 'URL', 'Blob', 'state', `
    const getStoredFeeRecords = () => state.records;
    const saveStoredFeeRecords = (r) => { state.records = r; };
    const syncPaymentRecordsBatchToCloud = async (famId, batch) => { state.syncCalls.push({ famId, batch }); return state.syncResult; };
    ${extractFunction(FEES_SRC, 'feePdfAuthHeaders')}
    ${extractFunction(FEES_SRC, 'storeFeePdfForReceipt')}
    ${extractFunction(FEES_SRC, 'deleteStoredFeePdf')}
    ${extractFunction(FEES_SRC, 'openStoredFeePdf')}
    ${extractFunction(FEES_SRC, 'feeReceiptPdfCellHtml')}
    return { storeFeePdfForReceipt, deleteStoredFeePdf, openStoredFeePdf, feeReceiptPdfCellHtml, state };
  `);
  const api = factory(windowStub, {}, fetchStub, (m) => state.notifies.push(m), URL, Blob, state);
  api._fetchStub = fetchStub;
  return api;
}
{
  const h = makeFeesHarness({});
  const res = await h.storeFeePdfForReceipt({ ...REC }, PDF_BYTES);
  check('storeFeePdfForReceipt: upload ok -> pdfKey on the record', res.ok === true && res.key === 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf' && h.state.records[0].pdfKey === 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf' && !h.state.records[0].pdfPending, JSON.stringify(h.state.records[0]));
  check('storeFeePdfForReceipt: cloud sync runs with the keyed record', h.state.syncCalls.length === 1 && h.state.syncCalls[0].batch[0].pdfKey === 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf');
  check('storeFeePdfForReceipt: no separate payments-table call — the sync batch upsert carries the key', h.state.feeTablesCalls.length === 0, 'updatePaymentPdfKey is for direct calls, not this path');
}
{
  // Pre-deploy 404: the local download already happened; the record is
  // marked pdfPending and the call still resolves (never throws).
  const h = makeFeesHarness({ fetchBehavior: async () => jsonOk({ ok: false, error: 'Not Found' }, 404) });
  const res = await h.storeFeePdfForReceipt({ ...REC }, PDF_BYTES);
  check('storeFeePdfForReceipt: upload 404 -> pdfPending, no crash', res.ok === false && h.state.records[0].pdfPending === true && !h.state.records[0].pdfKey, JSON.stringify(h.state.records[0]));
  check('storeFeePdfForReceipt: failed upload does NOT sync a keyless record as stored', h.state.syncCalls.length === 0);
}
{
  const h = makeFeesHarness({ syncResult: { ok: false, error: 'family update failed' } });
  const res = await h.storeFeePdfForReceipt({ ...REC }, PDF_BYTES);
  check('storeFeePdfForReceipt: cloud sync failure keeps the local key + cloudSyncPending', res.ok === true && h.state.records[0].pdfKey === 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf' && h.state.records[0].cloudSyncPending === true);
}
{
  const h = makeFeesHarness({});
  const res = await h.storeFeePdfForReceipt({ ...REC, status: 'Cancelled' }, PDF_BYTES);
  check('storeFeePdfForReceipt: cancelled records are never uploaded', res.ok === false && res.error === 'cancelled' && h._fetchStub.calls.length === 0);
}
{
  const h = makeFeesHarness({});
  check('receipt cell: stored -> Open PDF button with the key', h.feeReceiptPdfCellHtml({ ...REC, pdfKey: 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf' }).indexOf('Open PDF') !== -1 && h.feeReceiptPdfCellHtml({ ...REC, pdfKey: 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf' }).indexOf('fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf') !== -1);
  check('receipt cell: pending -> honest retry note, no dead button', h.feeReceiptPdfCellHtml({ ...REC, pdfPending: true }).indexOf('Cloud save pending') !== -1 && h.feeReceiptPdfCellHtml({ ...REC, pdfPending: true }).indexOf('Open PDF') === -1);
  check('receipt cell: no stored copy -> empty (Voucher still regenerates)', h.feeReceiptPdfCellHtml(REC) === '');
  check('receipt cell: cancelled -> never an Open PDF button', h.feeReceiptPdfCellHtml({ ...REC, status: 'Cancelled', pdfKey: 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf' }) === '');
}
{
  const h = makeFeesHarness({});
  const del = await h.deleteStoredFeePdf('fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf');
  check('deleteStoredFeePdf: DELETEs the stored key', del.ok === true && h._fetchStub.calls.length === 1 && h._fetchStub.calls[0].opts.method === 'DELETE');
  const del2 = await h.deleteStoredFeePdf('course_material/x.pdf');
  check('deleteStoredFeePdf: foreign key refused without a call', del2.ok === false);
}

// ---- fee-phase1.js glue: storeDueInvoicePdf ---------------------------------------
function makePhase1Harness(opts) {
  const o = opts || {};
  const state = { dueTablesCalls: [], listReloads: 0, notifies: [] };
  const fetchStub = stubFetchFactory(o.fetchBehavior || (async () => jsonOk({ ok: true, key: 'fee-documents/due-invoices/DUE-202611-FAM-001.pdf', url: '/api/storage?key=x' }, 200)));
  const windowStub = {
    FeePhase5: F,
    FeeTables: {
      updateDueInvoicePdfKey: async (...args) => { state.dueTablesCalls.push(args); return { ok: true }; },
    },
    getLmsAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
  };
  const factory = new Function('window', 'document', 'fetch', 'state', `
    const loadFeeDueInvoicesList = () => { state.listReloads++; };
    const notify = (m) => { state.notifies.push(m); };
    ${extractFunction(PHASE1_SRC, 'feePdfAuthHeaders')}
    ${extractFunction(PHASE1_SRC, 'storeDueInvoicePdf')}
    ${extractFunction(PHASE1_SRC, 'openStoredDueInvoicePdf')}
    return { storeDueInvoicePdf, openStoredDueInvoicePdf, state };
  `);
  const api = factory(windowStub, {}, fetchStub, state);
  api._fetchStub = fetchStub;
  return api;
}
{
  const h = makePhase1Harness({});
  const data = { invoiceRef: 'DUE-202611-FAM-001', familyId: 'FAM-001', status: 'Issued' };
  const res = await h.storeDueInvoicePdf(data, PDF_BYTES);
  check('storeDueInvoicePdf: upload ok -> pdfKey on the invoice + table update', res.ok === true && data.pdfKey === 'fee-documents/due-invoices/DUE-202611-FAM-001.pdf' && h.state.dueTablesCalls.length === 1 && h.state.dueTablesCalls[0][0] === 'DUE-202611-FAM-001' && h.state.dueTablesCalls[0][1] === 'fee-documents/due-invoices/DUE-202611-FAM-001.pdf');
  check('storeDueInvoicePdf: list reloads after a stored upload', h.state.listReloads === 1);
}
{
  const h = makePhase1Harness({ fetchBehavior: async () => jsonOk({ ok: false, error: 'Not Found' }, 404) });
  const data = { invoiceRef: 'DUE-202611-FAM-001', familyId: 'FAM-001', status: 'Issued' };
  const res = await h.storeDueInvoicePdf(data, PDF_BYTES);
  check('storeDueInvoicePdf: upload 404 -> pdfPending on the invoice + table flag', res.ok === false && data.pdfPending === true && h.state.dueTablesCalls.length === 1 && h.state.dueTablesCalls[0][2] === true);
}
{
  const h = makePhase1Harness({});
  const data = { invoiceRef: 'DUE-202611-FAM-001', familyId: 'FAM-001', status: 'Cancelled' };
  const res = await h.storeDueInvoicePdf(data, PDF_BYTES);
  check('storeDueInvoicePdf: cancelled invoices are never uploaded', res.ok === false && h._fetchStub.calls.length === 0);
}

// ---- fee-tables.js: pdfKey in the payments-table dual-write -------------------
// Same mock-db harness as test/batch6b-fee-tables.test.mjs (compact copy).
const TABLES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-tables.js'), 'utf8');
import { webcrypto } from 'node:crypto';
function makeMockDb({ flagValue = 'on' } = {}) {
  const tables = {
    system_settings: [{ key: 'fee_tables_v1', value: flagValue }],
    payments: [], salary_slips: [], salary_adjustments: [],
  };
  let seq = 0;
  const prefixes = { payments: 'PAY-', salary_slips: 'SAL-', salary_adjustments: 'ADJ-', system_settings: 'SYS-' };
  function from(table) {
    const state = { op: 'select', filters: [], payload: null, limitN: null };
    const b = {
      select() { state.op = 'select'; return b; },
      insert(rowsArr) { state.op = 'insert'; state.payload = rowsArr; return b; },
      update(patch) { state.op = 'update'; state.payload = patch; return b; },
      eq(col, val) { state.filters.push([col, val]); return b; },
      limit(n) { state.limitN = n; return b; },
      then(resolve, reject) {
        try { resolve(execute()); } catch (e) { reject(e); }
      },
    };
    function execute() {
      const store = tables[table];
      const match = (row) => state.filters.every(([c, v]) => String(row[c]) === String(v));
      if (state.op === 'select') {
        let out = store.filter(match);
        if (state.limitN) out = out.slice(0, state.limitN);
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      if (state.op === 'insert') {
        const inserted = state.payload.map((p) => {
          const row = { ...p };
          if (!row.id) row.id = prefixes[table] + (++seq);
          store.push(row);
          return { ...row };
        });
        return { data: inserted, error: null };
      }
      if (state.op === 'update') {
        const targets = store.filter(match);
        for (const t of targets) Object.assign(t, state.payload);
        return { data: targets.map((r) => ({ ...r })), error: null };
      }
      return { data: null, error: { message: 'unknown op' } };
    }
    return b;
  }
  return { from, _tables: tables };
}
function loadFeeTables(mockDb) {
  const windowObj = {
    db: mockDb,
    lmsNotify: () => {},
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null },
    getAuthenticatedOwnerSession: () => ({ id: 'OWN-001', username: 'owner' }),
    crypto: webcrypto,
  };
  const sandbox = { window: windowObj, console, crypto: webcrypto, CURRENT_ROLE: 'owner', setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(TABLES_SRC, sandbox);
  return windowObj.FeeTables;
}
{
  const FT = loadFeeTables(makeMockDb());
  const keyed = FT.paymentRowFromLegacy({ ...REC, pdfKey: 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf' }, 'fee_form');
  check('paymentRowFromLegacy: pdfKey -> receipt_url is the storage read URL', keyed.receipt_url === '/api/storage?key=fee-documents%2Freceipts%2FAH-REC-20261117-ABCDEF.pdf', String(keyed.receipt_url));
  check('paymentRowFromLegacy: pdfKey rides in legacy_json', JSON.parse(keyed.legacy_json).pdfKey === 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf');
  const plain = FT.paymentRowFromLegacy(REC, 'fee_form');
  check('paymentRowFromLegacy: no pdfKey -> receipt_url null', plain.receipt_url === null);
}
{
  const mockDb = makeMockDb();
  const FT = loadFeeTables(mockDb);
  await FT.dualWritePayment({ ...REC }, 'fee_form');
  check('setup: payment row dual-written', mockDb._tables.payments.length === 1);
  const upd = await FT.updatePaymentPdfKey('AH-REC-20261117-ABCDEF', 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf');
  const row = mockDb._tables.payments[0];
  check('updatePaymentPdfKey: receipt_url + legacy_json carry the key', upd.ok === true && row.receipt_url === '/api/storage?key=fee-documents%2Freceipts%2FAH-REC-20261117-ABCDEF.pdf' && JSON.parse(row.legacy_json).pdfKey === 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf', JSON.stringify(row));
  const miss = await FT.updatePaymentPdfKey('AH-REC-20261117-NOSUCH', 'fee-documents/receipts/AH-REC-20261117-NOSUCH.pdf');
  check('updatePaymentPdfKey: missing row -> { ok:false } without throwing', miss.ok === false && miss.error === 'not_found');
  const FT_OFF = loadFeeTables(makeMockDb({ flagValue: 'off' }));
  const off = await FT_OFF.updatePaymentPdfKey('AH-REC-20261117-ABCDEF', 'fee-documents/receipts/AH-REC-20261117-ABCDEF.pdf');
  check('updatePaymentPdfKey: flag OFF -> skipped, no write', off.skipped === true);
}
{
  const mockDb = makeMockDb();
  const FT = loadFeeTables(mockDb);
  const dueData = { invoiceRef: 'DUE-202611-FAM-001', familyId: 'FAM-001', parentName: 'Parent One', studentsNames: 'Kid One', month: 'November', year: 2026, currency: 'PKR', monthlyFee: 7500, previousArrears: 0, discount: 0, amountPaid: 0, totalPayable: 7500, outstanding: 7500, issueDate: '2026-11-01', dueDate: '2026-11-05', timingMessage: 'Fee plan: Advance.' };
  await FT.insertDueInvoiceRow(dueData);
  const upd = await FT.updateDueInvoicePdfKey('DUE-202611-FAM-001', 'fee-documents/due-invoices/DUE-202611-FAM-001.pdf', false);
  const rows = await FT.loadDueInvoicesForFamily('FAM-001');
  check('updateDueInvoicePdfKey: list reader returns the pdfKey', upd.ok === true && rows && rows.length === 1 && rows[0].pdfKey === 'fee-documents/due-invoices/DUE-202611-FAM-001.pdf', JSON.stringify(rows && rows[0]));
  check('updateDueInvoicePdfKey: receipt_url set on the row', mockDb._tables.payments[0].receipt_url === '/api/storage?key=fee-documents%2Fdue-invoices%2FDUE-202611-FAM-001.pdf');
  const upd2 = await FT.updateDueInvoicePdfKey('DUE-202611-FAM-001', null, true);
  const rows2 = await FT.loadDueInvoicesForFamily('FAM-001');
  check('updateDueInvoicePdfKey: null key + pending flag -> pdfPending on the list row', upd2.ok === true && rows2[0].pdfPending === true && !rows2[0].pdfKey);
}

const failed = results.filter((r) => !r.pass).length;
console.log('\nfee-phase5-frontend: ' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
