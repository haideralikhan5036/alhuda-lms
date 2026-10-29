// Global Back button removal (owner directive 2026-10-29) — the
// header Back button (btnAppBack) showed on every screen; navigation
// handles returning now, so the button is removed. The navigation
// helper tolerates its absence (guarded), and the Alt+Left shortcut
// code path is untouched.
// Run from the repo root:  node test/global-back-removal.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const INDEX = read('index.html');
const NAV = read('js/navigation.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

check('header Back button element is gone', !INDEX.includes('id="btnAppBack"') && !INDEX.includes('id="lblBackTarget"'));
check('no other visible Back button in the header area',
  !INDEX.slice(INDEX.indexOf('RIGHT ACTIONS'), INDEX.indexOf('teacherSessionPill')).includes('title="Go Back"'));
check('navigation visibility helper is absence-safe (guarded early return)',
  NAV.includes("const btn = document.getElementById('btnAppBack');") && NAV.includes('if (!btn) return;'));
check('header layout intact (logo + session pill remain)',
  INDEX.includes('AL-HUDA ISLAMIC CENTRE') && INDEX.includes('id="teacherSessionPill"'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
