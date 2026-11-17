// Fee Upgrade Phase 5 — PDF storage in R2 (#71).
// Drives the REAL cloudflare/worker.js against a fake D1 (node:sqlite)
// and a fake R2 bucket, mirroring test/annotated-pages-worker.test.mjs.
// Run from the repo root:  node test/fee-phase5-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fee-phase5-worker-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
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
  close() { try { this._db.close(); } catch (e) {} }
}
// Fake R2 that keeps the real bytes + content type, and supports delete.
class FakeR2 {
  constructor() { this._map = new Map(); }
  async get(key) {
    const v = this._map.get(key);
    if (!v) return null;
    return { body: v.body, httpMetadata: { contentType: v.contentType }, httpEtag: '"fake-etag"' };
  }
  async put(key, body, opts) {
    const ct = (opts && opts.httpMetadata && opts.httpMetadata.contentType) || 'application/octet-stream';
    const buf = body instanceof ArrayBuffer ? body : (body && body.buffer ? body.buffer : body);
    this._map.set(key, { body: buf, contentType: ct });
    return { key };
  }
  async delete(key) { this._map.delete(key); }
}

const fakeDb = new FakeD1();
const fakeR2 = new FakeR2();
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: fakeDb, STORAGE: fakeR2 };

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function feeDocPost(token, body, extraHeaders) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  Object.assign(headers, extraHeaders || {});
  const req = new Request('https://worker.test/api/fee-documents', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
async function feeDocDelete(token, key) {
  const headers = { 'Origin': ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request('https://worker.test/api/fee-documents?key=' + encodeURIComponent(key), {
    method: 'DELETE', headers,
  });
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
async function storageGet(token, key) {
  const headers = { 'Origin': ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request('https://worker.test/api/storage?key=' + encodeURIComponent(key), { headers });
  const res = await worker.fetch(req, env, {});
  let bytes = null;
  try { bytes = new Uint8Array(await res.arrayBuffer()); } catch (e) {}
  return { status: res.status, contentType: res.headers.get('Content-Type'), bytes };
}
async function feeDocOptions() {
  const req = new Request('https://worker.test/api/fee-documents', {
    method: 'OPTIONS', headers: { 'Origin': ORIGIN, 'Access-Control-Request-Method': 'POST' },
  });
  const res = await worker.fetch(req, env, {});
  return { status: res.status };
}
async function dbPost(token, body) {
  const req = new Request('https://worker.test/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
async function health() {
  const req = new Request('https://worker.test/api/health', { headers: { 'Origin': ORIGIN } });
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

const TOK = {
  owner: await createSessionToken({ sub: 'Faheem', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'T-1', role: 'teacher' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};

function pdfBase64(text) {
  return Buffer.from('%PDF-1.4\n' + text + '\n%%EOF').toString('base64');
}
function isPdf(bytes) {
  return !!bytes && bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

// ---- Setup ------------------------------------------------------------------
{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', boot.status === 200, 'got ' + boot.status);
  const h = await health();
  check('health reports the fee-pdf-r2 release', h.status === 200 && h.data && h.data.version === '2026-11-17-fee-pdf-r2', 'got ' + (h.data && h.data.version));
}
fakeDb.seed("INSERT INTO teachers (id, full_name) VALUES ('TCH-MGR-1', 'Manager One')");
fakeDb.seed("INSERT INTO teachers (id, full_name) VALUES ('T-1', 'Teacher One')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");

// ---- Upload: happy path -------------------------------------------------------
const REC_REF = 'AH-REC-20261117-ABCDEF';
const DUE_REF = 'DUE-202611-FAM-001';
{
  const up = await feeDocPost(TOK.owner, { kind: 'receipt', ref: REC_REF, base64: pdfBase64('receipt-one') });
  check('owner uploads a receipt PDF -> 200 + deterministic key', up.status === 200 && up.data && up.data.ok === true && up.data.key === 'fee-documents/receipts/' + REC_REF + '.pdf', 'got ' + up.status + ' ' + JSON.stringify(up.data));
  check('upload response carries the storage read URL', up.data && typeof up.data.url === 'string' && up.data.url.indexOf('/api/storage?key=fee-documents%2Freceipts%2F') === 0, 'got ' + (up.data && up.data.url));

  const get = await storageGet(TOK.owner, 'fee-documents/receipts/' + REC_REF + '.pdf');
  check('owner downloads the stored receipt via /api/storage -> 200 + PDF bytes', get.status === 200 && isPdf(get.bytes), 'got ' + get.status);
  check('stored receipt served as application/pdf', get.contentType === 'application/pdf', 'got ' + get.contentType);

  const upDue = await feeDocPost(TOK.manager, { kind: 'due-invoice', ref: DUE_REF, base64: pdfBase64('due-one') });
  check('manager uploads a due-invoice PDF -> 200 + due-invoices key', upDue.status === 200 && upDue.data && upDue.data.key === 'fee-documents/due-invoices/' + DUE_REF + '.pdf', 'got ' + upDue.status + ' ' + JSON.stringify(upDue.data));
  const getDue = await storageGet(TOK.manager, 'fee-documents/due-invoices/' + DUE_REF + '.pdf');
  check('manager downloads the stored due invoice -> 200 + PDF bytes', getDue.status === 200 && isPdf(getDue.bytes), 'got ' + getDue.status);
}

// ---- Upload: idempotent re-upload ---------------------------------------------
{
  const again = await feeDocPost(TOK.owner, { kind: 'receipt', ref: REC_REF, base64: pdfBase64('receipt-TWO') });
  check('re-upload of the same receipt overwrites the same key', again.status === 200 && again.data && again.data.key === 'fee-documents/receipts/' + REC_REF + '.pdf', 'got ' + again.status);
  const get = await storageGet(TOK.owner, 'fee-documents/receipts/' + REC_REF + '.pdf');
  const text = get.bytes ? Buffer.from(get.bytes).toString('utf8') : '';
  check('re-uploaded bytes are what the download returns', get.status === 200 && text.indexOf('receipt-TWO') !== -1, 'got ' + text.slice(0, 40));
}

// ---- Upload: auth ---------------------------------------------------------------
{
  check('teacher upload -> 403', (await feeDocPost(TOK.teacher, { kind: 'receipt', ref: 'AH-REC-20261117-TEACHER', base64: pdfBase64('x') })).status === 403);
  check('parent upload -> 403', (await feeDocPost(TOK.parent, { kind: 'receipt', ref: 'AH-REC-20261117-PARENT', base64: pdfBase64('x') })).status === 403);
  check('anonymous upload -> 401', (await feeDocPost('', { kind: 'receipt', ref: 'AH-REC-20261117-ANON', base64: pdfBase64('x') })).status === 401);
  check('garbage bearer token -> 401', (await feeDocPost('not-a-token', { kind: 'receipt', ref: 'AH-REC-20261117-BAD', base64: pdfBase64('x') })).status === 401);
  check('OPTIONS preflight -> 204', (await feeDocOptions()).status === 204);
}

// ---- Upload: validation ---------------------------------------------------------
{
  check('bad kind -> 400', (await feeDocPost(TOK.owner, { kind: 'photo', ref: REC_REF, base64: pdfBase64('x') })).status === 400);
  check('missing kind -> 400', (await feeDocPost(TOK.owner, { ref: REC_REF, base64: pdfBase64('x') })).status === 400);
  check('ref with slash -> 400 (cannot escape the prefix)', (await feeDocPost(TOK.owner, { kind: 'receipt', ref: '../evil', base64: pdfBase64('x') })).status === 400);
  check('ref with path traversal -> 400', (await feeDocPost(TOK.owner, { kind: 'receipt', ref: 'a/b/c', base64: pdfBase64('x') })).status === 400);
  check('ref with space -> 400', (await feeDocPost(TOK.owner, { kind: 'receipt', ref: 'AH REC 1', base64: pdfBase64('x') })).status === 400);
  check('empty ref -> 400', (await feeDocPost(TOK.owner, { kind: 'receipt', ref: '', base64: pdfBase64('x') })).status === 400);
  check('non-PDF bytes -> 400', (await feeDocPost(TOK.owner, { kind: 'receipt', ref: 'AH-REC-20261117-NOTPDF', base64: Buffer.from('hello, not a pdf').toString('base64') })).status === 400);
  check('empty file -> 400', (await feeDocPost(TOK.owner, { kind: 'receipt', ref: 'AH-REC-20261117-EMPTY', base64: '' })).status === 400);
  check('bad base64 -> 400', (await feeDocPost(TOK.owner, { kind: 'receipt', ref: 'AH-REC-20261117-BAD64', base64: '!!!not-base64!!!' })).status === 400);
  const big = Buffer.alloc(5 * 1024 * 1024 + 1);
  big.write('%PDF-1.4\n', 0);
  check('over 5 MB -> 400 file_too_large', (await feeDocPost(TOK.owner, { kind: 'receipt', ref: 'AH-REC-20261117-BIG', base64: big.toString('base64') })).status === 400);
  const getBig = await storageGet(TOK.owner, 'fee-documents/receipts/AH-REC-20261117-BIG.pdf');
  check('oversized upload stored nothing', getBig.status === 404, 'got ' + getBig.status);
}

// ---- Download: role scoping (existing /api/storage read path) -------------------
{
  check('teacher cannot download a stored fee PDF -> 403', (await storageGet(TOK.teacher, 'fee-documents/receipts/' + REC_REF + '.pdf')).status === 403);
  check('parent cannot download a stored fee PDF -> 403', (await storageGet(TOK.parent, 'fee-documents/receipts/' + REC_REF + '.pdf')).status === 403);
  check('anonymous cannot download a stored fee PDF -> 401', (await storageGet('', 'fee-documents/receipts/' + REC_REF + '.pdf')).status === 401);
  check('unknown stored key -> 404 for owner', (await storageGet(TOK.owner, 'fee-documents/receipts/AH-REC-20261117-NOSUCH.pdf')).status === 404);
}

// ---- Delete ----------------------------------------------------------------------
{
  check('teacher delete -> 403', (await feeDocDelete(TOK.teacher, 'fee-documents/receipts/' + REC_REF + '.pdf')).status === 403);
  check('parent delete -> 403', (await feeDocDelete(TOK.parent, 'fee-documents/receipts/' + REC_REF + '.pdf')).status === 403);
  check('delete outside fee-documents/ -> 403', (await feeDocDelete(TOK.owner, 'course_material/evil.pdf')).status === 403);
  check('delete without a key -> 400', (await feeDocDelete(TOK.owner, '')).status === 400);
  const del = await feeDocDelete(TOK.owner, 'fee-documents/receipts/' + REC_REF + '.pdf');
  check('owner delete of a stored receipt -> 200', del.status === 200 && del.data && del.data.ok === true, 'got ' + del.status + ' ' + JSON.stringify(del.data));
  check('download after delete -> 404', (await storageGet(TOK.owner, 'fee-documents/receipts/' + REC_REF + '.pdf')).status === 404);
  check('delete of a missing key is idempotent -> 200', (await feeDocDelete(TOK.owner, 'fee-documents/receipts/' + REC_REF + '.pdf')).status === 200);
  check('due invoice survives the receipt delete', (await storageGet(TOK.manager, 'fee-documents/due-invoices/' + DUE_REF + '.pdf')).status === 200);
  const delDue = await feeDocDelete(TOK.manager, 'fee-documents/due-invoices/' + DUE_REF + '.pdf');
  check('manager deletes a stored due invoice -> 200', delDue.status === 200, 'got ' + delDue.status);
}

const failed = results.filter((r) => !r.pass).length;
console.log('\nfee-phase5-worker: ' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
