// Settings sidebar group (2026-11-03, owner request): the sidebar gains
// a "Settings" group at the very end of the nav, and Course Payment
// Settings moves inside it as the first sub-option.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const nav = fs.readFileSync(path.join(REPO_ROOT, 'js/navigation.js'), 'utf8');

console.log('== settings group structure ==');
check('Settings toggle exists at the nav level', html.includes('onclick="toggleSettingsGroup()"'));
check('the toggle is labelled Settings', /onclick="toggleSettingsGroup\(\)"[\s\S]{0,400}?<span class="truncate">Settings<\/span>/.test(html));
check('group container exists and starts hidden', html.includes('id="sidebarSettingsGroup" class="hidden'));
check('exactly one Course Payment Settings nav button remains', (html.match(/data-tab="tab-settings"/g) || []).length === 1);
check('the settings button lives INSIDE the group',
  html.indexOf('id="sidebarSettingsGroup"') < html.indexOf('data-tab="tab-settings"')
  && html.indexOf('data-tab="tab-settings"') < html.indexOf('</nav>'));
check('the group sits at the END of the nav (after Daily Attendance)',
  html.indexOf('data-tab="tab-attendance"') < html.indexOf('onclick="toggleSettingsGroup()"')
  && html.indexOf('onclick="toggleSettingsGroup()"') < html.indexOf('</nav>'));
check('the old standalone position (before Leave) is gone',
  !(html.indexOf('data-tab="tab-settings"') < html.indexOf('data-tab="tab-leaves"')));
check('the tab-settings panel still exists exactly once', (html.match(/id="tab-settings"/g) || []).length === 1);

console.log('== navigation behaviour ==');
check('toggleSettingsGroup is defined and exported', nav.includes('function toggleSettingsGroup()') && nav.includes('window.toggleSettingsGroup = toggleSettingsGroup'));
check('switchTab auto-expands the group when the active button is inside it',
  nav.includes("settingsGroup.contains(activeBtn)") && nav.includes("settingsGroup.classList.remove('hidden')"));

console.log(`\nSETTINGS NAV SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
