// Batch 1B — trial conversion must never show a password that was never set.
//
// Static/extraction checks over the real sources. Batch 1 (2026-10-21)
// banned password fabrication outright because the generated value was
// never stored anywhere real. Trials Audit Batch 2 (owner decision
// 2026-11-17) supersedes that ban for ONE path: conversion auto-sets a
// real starter password via /api/auth/set-password
// (generateTrialParentPassword -> setConvertedParentPassword ->
// setAccountPasswordViaWorker). What stays banned: a password shown or
// stored without ever being set server-side, a password passed to
// saveParentAccount, and a password in the welcome email.
//  1. js/trials.js no longer generates an 'alhuda_' + random password,
//     does not pass one to saveParentAccount, does not hand one to the
//     welcome-email preview, and shows one in the success alert ONLY
//     from the set-password result.
//  2. The conversion alert still carries the Batch 1 not-set guidance
//     with the exact parent-facing message — now on the failure branch,
//     when the automatic set did not go through.
//  3. Repo-wide: no JS/HTML file fabricates or derives a password that
//     is never set (the Batch 2 name-derived scheme is allow-listed:
//     it is always set via the Worker helper — see the positive check
//     below). Zoom MEETING passcode fallbacks '123456' are allow-listed —
//     they are not portal credentials — and the set-passwords page's
//     explicit REJECTION of the '12345678' default is required to stay.
//  4. families.js saveParentAccount still strips any password key
//     (the Batch 1 storage guard is unchanged).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name); }
}

const trials = read('js/trials.js');

// --- 1. The fabrication is gone from the conversion flow -------------------
check("no 'alhuda_' + random password in trials.js", !trials.includes("'alhuda_' +") && !trials.includes('"alhuda_" +'));
check('success alert shows the password only from the set-password result', trials.includes('Password: ${parentPassword}') && trials.includes('parentPasswordSet'));
check('convert calls the password setter, never the generator directly', trials.includes('setConvertedParentPassword(username, trial.parent_name)'));
const saveCall = trials.slice(trials.indexOf('saveParentAccount(canonicalFamId'), trials.indexOf('saveParentAccount(canonicalFamId') + 400);
check('conversion saveParentAccount call exists', saveCall.length > 50);
check('conversion saveParentAccount call has NO password key', !/[{,]\s*password\s*[,}]/.test(saveCall) && !saveCall.includes('password:'));
const credBlock = trials.slice(trials.indexOf('credentials: {', trials.indexOf('openEmailPreviewModal')), trials.indexOf('credentials: {', trials.indexOf('openEmailPreviewModal')) + 120);
check('welcome-email credentials carry username only', credBlock.includes('username') && !credBlock.includes('password'));

// --- 2. Batch 1 not-set guidance survives — on the failure branch ---------
// (Batch 2: the success branch shows the password that WAS set; only a
// failed automatic set still says NOT set, and never shows the password.)
check('alert carries the exact Batch 1 message', trials.includes('No password set. Ask the administrator to set one.'));
check('alert says NOT set only when the automatic set failed', trials.includes('Password: NOT set — the automatic password could not be saved.'));

// --- 3. Repo-wide fabrication sweep ---------------------------------------
const fabricationPatterns = [
  /['"]alhuda_['"]\s*\+/,                 // 'alhuda_' + random
  /password\s*=\s*['"][^'"]*['"]\s*\+\s*Math\.random/,
  /password\s*=\s*[^;\n]*Math\.random/,   // password derived from Math.random
  /Pass@\s*['"]?\s*\+/,                   // 'alhuda_Pass@' + digits style derivation
  /password[^;\n]*slice\(-\d\)/,          // password derived from phone digits
];
const files = [
  ...readdirSync(join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f),
  ...readdirSync(root).filter(f => f.endsWith('.html')),
];
let fabricationHits = [];
for (const f of files) {
  const src = read(f);
  for (const pat of fabricationPatterns) {
    if (pat.test(src)) fabricationHits.push(f + ' :: ' + pat);
  }
}
check('no password fabrication/derivation anywhere in js/ or root HTML', fabricationHits.length === 0);
if (fabricationHits.length) console.log('       hits: ' + fabricationHits.join(' | '));
check('the generated password is always set via the Worker helper', trials.includes("await window.setAccountPasswordViaWorker('parent', username, password)"));

// Zoom passcode fallbacks are meeting passcodes, not portal passwords:
// every bare '123456' occurrence must be a zoom/passcode context.
let strayDefault = [];
for (const f of files) {
  read(f).split('\n').forEach((line, i) => {
    if (line.includes("'123456'") || line.includes('"123456"')) {
      if (!/zoom|passcode/i.test(line)) strayDefault.push(f + ':' + (i + 1));
    }
  });
}
check("every '123456' literal is a Zoom passcode context", strayDefault.length === 0);
if (strayDefault.length) console.log('       hits: ' + strayDefault.join(' | '));

// --- 4. Batch 1 storage guard unchanged ------------------------------------
const families = read('js/families.js');
const spa = families.slice(families.indexOf('function saveParentAccount'), families.indexOf('function saveParentAccount') + 700);
check('saveParentAccount still deletes the password key before storing', spa.includes('delete cleanCreds.password'));

console.log(`\n==== ${pass}/${pass + fail} passed ====`);
process.exit(fail ? 1 : 0);
