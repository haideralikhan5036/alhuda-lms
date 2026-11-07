// Login redesign (2026-11-07) — the owner-approved split-card login applied
// to teacher.html, parent.html and manager.html (index.html's #ownerLoginView
// follows separately). These pins lock the deal:
//   * every PRE-EXISTING login id, handler and label survives exactly once —
//     the redesign is a re-skin, never a rewrite of login logic;
//   * the new layout landmarks (split card, emerald panel + seam, form side,
//     badge, pill CTA, real logo) are present per surface;
//   * per-portal rules hold: teacher keeps body zoom 0.85, parent gains NO
//     zoom, manager keeps the PR #128 fixed-body rule.
// Executed submit/error/success proofs for these surfaces live in the
// Chromium harness run recorded with the build (stubbed /api/auth —
// failed login renders the real error element inside the new layout, the
// submit payload is byte-identical, success proceeds past the login view).

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const count = (src, needle) => src.split(needle).length - 1;

const SURFACES = [
  {
    file: 'teacher.html',
    ids: ['loginView', 'loginUsername', 'loginPassword', 'passToggleIcon',
      'loginErrorMsg', 'loginErrorText', 'roleMismatchBanner', 'roleMismatchTitle',
      'roleMismatchDesc', 'btnSubmitLogin'],
    handlers: ['onsubmit="handleTeacherSignIn(event)"', 'onclick="togglePassVisibility()"'],
    wording: ['Teacher Portal Login', 'Teacher Operations Portal', 'Login to Teacher Portal',
      'Email / Username / Teacher ID', 'Enter your username or Teacher ID', 'Authorized personnel only.'],
  },
  {
    file: 'parent.html',
    ids: ['parentLoginView', 'parentLoginUsername', 'parentLoginPassword', 'parentPassToggleIcon',
      'parentLoginErrorMsg', 'parentLoginErrorText', 'parentRoleMismatchBanner',
      'parentRoleMismatchTitle', 'parentRoleMismatchDesc', 'btnSubmitParentLogin'],
    handlers: ['onsubmit="handleParentSignIn(event)"', 'onclick="toggleParentPassVisibility()"'],
    wording: ['Parent &amp; Student Login', 'Parent &amp; Student Portal', 'Login to Parent Portal',
      'Username / Family ID / Email', 'Enter Parent Username or Family ID', 'Authorized access only.'],
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
  // New layout landmarks.
  for (const lm of ['class="lgn-card"', 'lgn-panel', 'lgn-seam', 'lgn-formside', 'lgn-badge',
    'lgn-cta', 'src="alhuda_logo.jpg"', 'AL-HUDA ISLAMIC CENTRE', 'LIVE']) {
    ok(src.includes(lm), `${s.file}: layout landmark present: ${lm}`);
  }
  // The role-mismatch banner and the error element live INSIDE the new card
  // (after the card opens, before it closes is implied by document order:
  // banner/error appear after the lgn-badge of the form side).
  ok(src.indexOf('lgn-card') > -1 && src.indexOf(s.ids[6]) > src.indexOf('lgn-card'),
    `${s.file}: role-mismatch banner sits inside the split card`);
  // Inline scripts still parse.
  const dir = mkdtempSync(path.join(tmpdir(), 'lgn-syntax-'));
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
ok(/body\s*\{[^}]*zoom:\s*0\.85/.test(teacher), 'teacher: body zoom 0.85 untouched');
ok(teacher.includes('tui-login-bg'), 'teacher: tui-login-bg backdrop class retained on the login view');

const parent = read('parent.html');
ok(!/body\s*\{[^}]*zoom/.test(parent), 'parent: NO body zoom added (parent portal stays 100%)');

const manager = read('manager.html');
ok(manager.includes('body { zoom: 0.85; position: fixed; inset: 0; overflow-y: auto; }'),
  'manager: PR #128 body rule intact (zoom .85, fixed, full-bleed)');
ok(manager.includes('for="mgrLoginUsername"') && manager.includes('for="mgrLoginPassword"'),
  'manager: username/password labels carry for= (added by the redesign; they had none)');

if (failures === 0) console.log('login-redesign: all assertions passed');
process.exit(failures ? 1 : 0);
