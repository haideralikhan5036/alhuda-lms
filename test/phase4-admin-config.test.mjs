// Phase 4 Batch 4.2 — admin/tools/config cleanup (audit P3 items).
// t:     manager.html carries no Supabase endpoint/key literals.
// u:     Sign-out-everywhere + backfill Write ask for confirmation.
// v:     student shift checks per-slot results; failure aborts the shift.
// oo:    three index modals cap height + scroll internally.
// rr-d:  fees fallbacks use the CURRENT month/year, not September/2026.
// rr-e:  pending table says "not loaded" instead of "all cleared".
// ss:    prefers-reduced-motion rule in all four portals.
// tt:    vercel.json has no dangling /class or /auditor routes.
// PP:    vercel.json sends the Permissions-Policy header (Worker parity).
// qq:    orphaned root style.css deleted (zero file references remain).
// Run from the repo root:  node test/phase4-admin-config.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const MANAGER = read('manager.html');
const INDEX = read('index.html');
const TEACHER = read('teacher.html');
const PARENT = read('parent.html');
const FEES = read('js/fees.js');
const SCHEDULE = read('js/schedule.js');
const SETPW = read('set-teacher-passwords.html');
const BACKFILL = read('backfill-finance-tables.html');
const VERCEL = JSON.parse(read('vercel.json'));

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// t — no literals (match shapes, never values)
check('t: no supabase.co URL in manager.html', !/supabase\.co/.test(MANAGER));
check('t: no publishable-key-shaped literal in manager.html', !/sb_publishable_/.test(MANAGER));
check('t: createClient call retained (shim supplies the client)', MANAGER.includes('window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)'));

// u — confirmations
check('u: sign-out-everywhere is behind lmsConfirm',
  SETPW.includes("title: 'Sign out everywhere?'") && SETPW.includes('if (!okSoe) return;'));
check('u: backfill write is behind lmsConfirm',
  BACKFILL.includes("title: 'Write to the fee tables?'") && BACKFILL.includes('if (!okWrite)'));

// v — shift per-slot honesty
check('v: slot update errors are collected', SCHEDULE.includes('const { error: slotErr }') && SCHEDULE.includes('slotFailures.push'));
check('v: delete errors are collected too', SCHEDULE.includes('const { error: delErr }'));
check('v: any slot failure aborts before the student record moves',
  SCHEDULE.indexOf('if (slotFailures.length > 0)') > SCHEDULE.indexOf('const slotFailures = []') &&
  SCHEDULE.indexOf('if (slotFailures.length > 0)') < SCHEDULE.indexOf("stuMeta.teacher_shift_history.unshift"));

// oo — modal caps anchored at the right modals
for (const id of ['modalDashAttendance', 'modalChooseEmployeeType', 'modalTeacherLogin']) {
  const at = INDEX.indexOf(`id="${id}"`);
  const seg = INDEX.slice(at, at + 400);
  check(`oo: ${id} card caps height + scrolls`, seg.includes('max-h-[90vh] overflow-y-auto'));
}

// rr-d — current-period fallbacks
check('rr-d: no September element-missing fallback remains', !FEES.includes(": 'September'"));
check('rr-d: current-month fallback expression in place',
  (FEES.split("FEE_CONFIG.MONTHS[new Date().getMonth()] || 'September'").length - 1) >= 6);
check('rr-d: no bare 2026 year fallback remains', !/(?<!year): 2026\b/.test(FEES));

// rr-e — not-loaded honesty
check('rr-e: pending cache starts null (not loaded)', FEES.includes('let CACHED_PENDING_FEE_LIST = null;'));
check('rr-e: not-loaded row exists and precedes the cleared claim',
  FEES.includes('The pending list has not loaded yet.') &&
  FEES.indexOf('CACHED_PENDING_FEE_LIST === null') < FEES.indexOf('All family dues are cleared!'));

// ss — reduced motion everywhere
for (const [name, src] of [['index', INDEX], ['teacher', TEACHER], ['parent', PARENT], ['manager', MANAGER]]) {
  check(`ss: reduced-motion rule in ${name}.html`, src.includes('@media (prefers-reduced-motion: reduce)'));
}

// tt + PP — vercel.json
const dests = VERCEL.routes.map(r => r.dest || '').join(' ');
check('tt: /class route removed', !dests.includes('/class.html'));
check('tt: /auditor route removed', !dests.includes('/auditor.html'));
const headerRoute = VERCEL.routes.find(r => r.headers);
check('PP: Permissions-Policy matches the Worker string',
  headerRoute && headerRoute.headers['Permissions-Policy'] === 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

// qq — style.css gone
check('qq: root style.css deleted', !fs.existsSync(path.join(REPO_ROOT, 'style.css')));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
