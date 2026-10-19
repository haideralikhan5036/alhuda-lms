// Email-relay worker endpoint test.
// Drives the REAL cloudflare/worker.js (via a temp ESM copy) against a mock
// Apps Script relay (local HTTPS, 302-redirect like the real script).
// Run from the repo root:  node test/email-relay-worker.test.mjs
// Requires: node >= 18, openssl (for the throwaway self-signed cert).
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Copy the worker tree to a temp dir with an ESM package.json so node can
// import the real module files (the repo itself has no package.json).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'email-relay-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
try { execSync('openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 2 -nodes -subj "/CN=127.0.0.1"', { cwd: TMP, stdio: 'ignore' }); }
catch (e) { console.error('openssl is required for this test'); process.exit(2); }
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);
// Email-relay worker endpoint test harness.
// Imports the REAL cloudflare/worker.js + cloudflare/auth.js and drives the
// fetch handler with stubbed env + a mock Apps Script relay (local HTTP).
// Run: node run.mjs   (expects package.json {"type":"module"} beside it)



const SECRET = 'test-relay-secret-value';
const WORKER_SECRET = 'test-worker-auth-secret';
const ORIGIN = 'https://alhuda-lms.vercel.app';
const BODY_MARKER = 'UNIQUEBODYMARKER123';

// ---- capture worker logs to prove no secret/URL/body leakage ----
const capturedLogs = [];
for (const m of ['log', 'warn', 'error']) {
  const orig = console[m].bind(console);
  console[m] = (...a) => { capturedLogs.push(a.map(String).join(' ')); orig(...a); };
}

// ---- mock Apps Script relay ----
const received = [];   // bodies received at /r2
let hitR1 = 0, hitR2 = 0, hitR500 = 0;
const server = https.createServer({ key: fs.readFileSync(path.join(TMP, 'key.pem')), cert: fs.readFileSync(path.join(TMP, 'cert.pem')) }, (req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    if (req.url === '/r1' && req.method === 'POST') { hitR1++; res.writeHead(302, { Location: '/r2' }); res.end(); return; }
    if (req.url === '/r2') { hitR2++; let parsed = null; try { parsed = JSON.parse(data); } catch (e) {} received.push({ method: req.method, body: parsed, rawLen: data.length }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
    if (req.url === '/r500' && req.method === 'POST') { hitR500++; res.writeHead(500); res.end('relay boom'); return; }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const baseEnv = {
  WORKER_AUTH_SECRET: WORKER_SECRET,
  RELAY_URL: `https://127.0.0.1:${PORT}/r1`,   // r1 302-redirects to r2
  RELAY_SECRET: SECRET,
  ALLOWED_ORIGINS: ORIGIN,
  DB: null,
};

async function mintToken(sub, role) {
  return createSessionToken({ sub, role }, WORKER_SECRET);
}
const TOK = {
  owner: await mintToken('owner1', 'owner'),
  manager: await mintToken('mgr1', 'manager'),
  teacher: await mintToken('tch1', 'teacher'),
  parent: await mintToken('par1', 'parent'),
  bulkOwner: await mintToken('bulk-owner', 'owner'),
  rlOwner: await mintToken('rl-owner', 'owner'),
};

async function callEmail({ token, body, method = 'POST', origin = ORIGIN, env = baseEnv, rawBody }) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers['Origin'] = origin;
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = rawBody !== undefined ? rawBody : (body === undefined ? undefined : JSON.stringify(body));
  }
  const req = new Request('https://worker.test/api/email/send', init);
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  const acao = res.headers.get('Access-Control-Allow-Origin');
  return { status: res.status, data, acao };
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}
const validBody = () => ({ to: 'parent@example.com', subject: 'Welcome', html: '<p>hi ' + BODY_MARKER + '</p>', text: 'hi' });

// T1: valid owner send, redirect followed, secret forwarded
{
  const r = await callEmail({ token: TOK.owner, body: validBody() });
  check('T1 owner valid -> 200 ok:true', r.status === 200 && r.data && r.data.ok === true, JSON.stringify(r.data));
  check('T1 redirect followed (r1 302 -> r2 200)', hitR1 === 1 && hitR2 === 1, `r1=${hitR1} r2=${hitR2}`);
  const hit = received[received.length - 1] || {};
  const b = hit.body || {};
  check('T1 redirect re-POSTed (method preserved, body intact)', hit.method === 'POST' && hit.rawLen > 100, `method=${hit.method} rawLen=${hit.rawLen}`);
  check('T1 forwarded body has to/subject/html/text', b.to === 'parent@example.com' && typeof b.subject === 'string' && typeof b.html === 'string' && typeof b.text === 'string', JSON.stringify(Object.keys(b)));
  check('T1 secret forwarded', b.secret === SECRET && b.relaySecret === SECRET, 'secret/relaySecret mismatch');
}

// T2/T3: auth failures
{
  const r = await callEmail({ body: validBody() });
  check('T2 no token -> 401', r.status === 401, 'got ' + r.status);
  const r2 = await callEmail({ token: 'garbage.token', body: validBody() });
  check('T3 bad token -> 401', r2.status === 401, 'got ' + r2.status);
}
// T4: wrong roles
for (const role of ['manager', 'teacher', 'parent']) {
  const r = await callEmail({ token: TOK[role], body: validBody() });
  check(`T4 role=${role} -> 403`, r.status === 403 && /owner/i.test(r.data?.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
}

// T5: invalid recipients
for (const [label, to] of [['empty', ''], ['no-at', 'not-an-email'], ['no-tld', 'a@b'], ['comma-list', 'a@b.com, c@d.com'], ['semicolon-list', 'a@b.com;c@d.com'], ['too-long', 'a'.repeat(250) + '@b.com']]) {
  const r = await callEmail({ token: TOK.owner, body: { to, subject: 's', text: 't' } });
  check(`T5 invalid to (${label}) -> 400`, r.status === 400 && /single valid recipient/i.test(r.data?.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
}

// T6: subject / body limits
{
  const r = await callEmail({ token: TOK.owner, body: { to: 'a@b.com', subject: '', text: 't' } });
  check('T6 empty subject -> 400', r.status === 400, 'got ' + r.status);
  const r2 = await callEmail({ token: TOK.owner, body: { to: 'a@b.com', subject: 'x'.repeat(501), text: 't' } });
  check('T6 501-char subject -> 400', r2.status === 400, 'got ' + r2.status);
  const r3 = await callEmail({ token: TOK.owner, body: { to: 'a@b.com', subject: 's' } });
  check('T6 empty body -> 400', r3.status === 400, 'got ' + r3.status);
  const r4 = await callEmail({ token: TOK.owner, body: { to: 'a@b.com', subject: 's', html: 'x'.repeat(200001) } });
  check('T6 oversized html -> 400', r4.status === 400, 'got ' + r4.status);
  const r5 = await callEmail({ token: TOK.owner, body: { to: 'a@b.com', subject: 's', text: 't', evil: 1 } });
  check('T6 unknown field -> 400', r5.status === 400 && /Unexpected field/i.test(r5.data?.error || ''), `got ${r5.status} ${JSON.stringify(r5.data)}`);
  const r6 = await callEmail({ token: TOK.owner, rawBody: 'not-json{' });
  check('T6 malformed JSON -> 400', r6.status === 400, 'got ' + r6.status);
}

// T7: methods + CORS
{
  const r = await callEmail({ token: TOK.owner, body: validBody(), method: 'GET' });
  check('T7 GET -> 405', r.status === 405, 'got ' + r.status);
  const req = new Request('https://worker.test/api/email/send', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
  const res = await worker.fetch(req, baseEnv, {});
  check('T7 OPTIONS preflight -> 204 + ACAO', res.status === 204 && res.headers.get('Access-Control-Allow-Origin') === ORIGIN, `got ${res.status} acao=${res.headers.get('Access-Control-Allow-Origin')}`);
  const r2 = await callEmail({ token: TOK.owner, body: validBody(), origin: 'https://evil.example' });
  check('T7 evil origin gets no ACAO', r2.acao === null, 'acao=' + r2.acao);
}

// T8: bulk simulation (85 sequential sends, one owner token) must NOT trip the limiter
{
  let okCount = 0;
  for (let i = 0; i < 85; i++) {
    const r = await callEmail({ token: TOK.bulkOwner, body: { to: `fam${i}@example.com`, subject: 'Fee reminder', text: 'please pay' } });
    if (r.status === 200 && r.data?.ok) okCount++;
  }
  check('T8 85 bulk sends all succeed (rate limit sized correctly)', okCount === 85, `ok=${okCount}/85`);
}

// T9: rate limit trips after 100
{
  let limitedAt = -1;
  for (let i = 1; i <= 105; i++) {
    const r = await callEmail({ token: TOK.rlOwner, body: { to: 'x@example.com', subject: 's', text: 't' } });
    if (r.status === 429 && limitedAt === -1) limitedAt = i;
  }
  check('T9 429 trips after 100 sends', limitedAt === 101, 'first 429 at #' + limitedAt);
}

// T10/T11/T12: relay failure truthfulness
{
  const r = await callEmail({ token: TOK.owner, body: validBody(), env: { ...baseEnv, RELAY_URL: `https://127.0.0.1:${PORT}/r500` } });
  check('T10 relay 500 -> 502 truthful error', r.status === 502 && /relay failed/i.test(r.data?.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
  const r2 = await callEmail({ token: TOK.owner, body: validBody(), env: { ...baseEnv, RELAY_URL: 'https://127.0.0.1:1/closed' } });
  check('T11 relay unreachable -> 502', r2.status === 502 && /unreachable/i.test(r2.data?.error || ''), `got ${r2.status} ${JSON.stringify(r2.data)}`);
  const { RELAY_URL, ...noRelay } = baseEnv;
  const r3 = await callEmail({ token: TOK.owner, body: validBody(), env: noRelay });
  check('T12 relay unconfigured -> 503', r3.status === 503 && /not configured/i.test(r3.data?.error || ''), `got ${r3.status} ${JSON.stringify(r3.data)}`);
}

// T13: open-relay transition (empty RELAY_SECRET still works)
{
  const r = await callEmail({ token: TOK.owner, body: validBody(), env: { ...baseEnv, RELAY_SECRET: '' } });
  const hit = received[received.length - 1] || {};
  const b = hit.body || {};
  check('T13 empty RELAY_SECRET still forwards (open-relay compat)', r.status === 200 && r.data?.ok === true && hit.method === 'POST' && b.secret === '' && b.relaySecret === '', `got ${r.status} method=${hit.method} secret=${JSON.stringify(b.secret)}`);
}

// T14: no secret/URL/body in worker logs
{
  const blob = capturedLogs.join('\n');
  check('T14 logs contain no relay secret', !blob.includes(SECRET), 'LEAKED');
  check('T14 logs contain no relay URL', !blob.includes('/r1') && !blob.includes('/r2') && !blob.includes(String(PORT)), 'LEAKED');
  check('T14 logs contain no email body', !blob.includes(BODY_MARKER), 'LEAKED');
}

server.close();
fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(' - ' + f.name + ' :: ' + f.detail)); process.exit(1); }
