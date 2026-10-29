// Dashboard sleek cleanup (owner redesign 2026-10-29) — the eight KPI
// boxes move from two side groups with a wide empty center gap into
// ONE unified panel/grid; the dashboard content column is centered
// with a max width so nothing stretches edge to edge; the grid is
// mobile-safe (2 columns on phones, 4 on desktop). All card ids,
// click filters and counters are unchanged.
// Run from the repo root:  node test/dashboard-sleek.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const INDEX = read('index.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const dashStart = INDEX.indexOf('id="tab-dashboard"');
const dashEnd = INDEX.indexOf('id="tab-families"');
const DASH = INDEX.slice(dashStart, dashEnd);

check('dashboard content column is centered with a max width (breathing room at the edges)',
  INDEX.includes('<section id="tab-dashboard" class="tab-content block max-w-[1200px] mx-auto w-full">'));
check('the wide center gap and the two side groups are gone',
  !INDEX.includes('INTENTIONAL WIDE OPEN BREATHING SPACE') && !INDEX.includes('xl:w-[420px]') &&
  !INDEX.includes('items-center justify-between gap-4 mb-5'));
check('one unified KPI grid: 2 columns on mobile, 4 on desktop',
  DASH.includes('grid grid-cols-2 md:grid-cols-4 gap-2.5'));
check('all 8 KPI cards survive with ids, filters and counters intact',
  ['all', 'current', 'running', 'completed', 'remaining', 'absent', 'leave', 'trial'].every(k =>
    DASH.includes(`id="kpiBox-${k}"`) && DASH.includes(`filterDashboardClasses('${k === 'all' ? 'all' : k}')`)) &&
  ['kpiDashTotal', 'kpiDashCurrent', 'kpiDashRunning', 'kpiDashCompleted', 'kpiDashRemaining', 'kpiDashAbsent'].every(id => DASH.includes(`id="${id}"`)));
check('dashboard section div balance is intact',
  (DASH.match(/<div/g) || []).length === (DASH.match(/<\/div>/g) || []).length);

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
