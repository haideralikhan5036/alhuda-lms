// Academy Profile settings (2026-11-03, owner idea #4): the academy
// name / official email / phone / address live in ONE settings row
// (academy_profile_v1) edited under Settings > Academy Profile, and
// every admin-generated document/message (salary slips, fee receipts,
// reminders, welcome emails, credential messages) reads the identity
// from it instead of a hardcoded string. Execution tests run the real
// js/academy-profile.js in a vm with mocked db/localStorage/document.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra || ''); }
}
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

function makeSandbox({ storedRow = null, role = 'owner' } = {}) {
  const store = new Map();
  const upserts = [];
  const selects = [];
  const identityCalls = [];
  const inputs = {};
  let domReady = null;
  const sandbox = {
    console,
    CURRENT_ROLE: role,
    CURRENT_USER: 'Faheem',
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      addEventListener: (ev, cb) => { if (ev === 'DOMContentLoaded') domReady = cb; },
      getElementById: (id) => {
        if (!inputs[id]) inputs[id] = { value: '', disabled: false, style: {}, textContent: '' };
        return inputs[id];
      },
    },
    __setAcademyIdentity: (n, e, p) => identityCalls.push([n, e, p]),
    lmsNotify: () => {},
    db: {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: () => {
              selects.push(1);
              return Promise.resolve({ data: storedRow ? [{ value: storedRow }] : [], error: null });
            },
          }),
        }),
        upsert: (row) => { upserts.push(row); return Promise.resolve({ data: [row], error: null }); },
      }),
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('js/academy-profile.js'), sandbox, { filename: 'academy-profile.js' });
  return { sandbox, upserts, selects, identityCalls, inputs, fireReady: () => domReady && domReady() };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

console.log('== module behaviour (real js/academy-profile.js) ==');
{
  const { sandbox } = makeSandbox();
  check('defaults: name is the current academy name', sandbox.academyName() === 'Al-Huda Islamic Centre');
  check('defaults: email is the current official email', sandbox.academyEmail() === 'ceoislamiccentre@gmail.com');
  check('defaults: phone empty', sandbox.academyPhone() === '');
}
{
  const custom = JSON.stringify({ name: 'Noor Academy', email: 'office@noor.example', phone: '+92 300 1112233', address: 'Lahore' });
  const { sandbox, identityCalls, fireReady } = makeSandbox({ storedRow: custom });
  fireReady();
  await tick();
  check('stored profile loads: name', sandbox.academyName() === 'Noor Academy');
  check('stored profile loads: email', sandbox.academyEmail() === 'office@noor.example');
  check('stored profile loads: phone', sandbox.academyPhone() === '+92 300 1112233');
  check('identity hook pushed the profile into email.js constants',
    identityCalls.some((c) => c[0] === 'Noor Academy' && c[1] === 'office@noor.example'));
}
{
  const { upserts, fireReady } = makeSandbox({ storedRow: null });
  fireReady();
  await tick();
  check('owner seeds the defaults row once (SYS-ACADEMY-PROFILE / academy_profile_v1)',
    upserts.length === 1 && upserts[0].id === 'SYS-ACADEMY-PROFILE' && upserts[0].key === 'academy_profile_v1');
}
{
  const { sandbox, upserts, inputs, fireReady } = makeSandbox({ storedRow: null });
  fireReady();
  await tick();
  ['academyNameInput', 'academyEmailInput', 'academyPhoneInput', 'academyAddressInput', 'academyProfileRoleNote', 'academyProfileMeta', 'btnSaveAcademyProfile']
    .forEach((id) => sandbox.document.getElementById(id));
  inputs.academyNameInput.value = '  City Quran Academy ';
  inputs.academyEmailInput.value = 'admin@city.example';
  inputs.academyPhoneInput.value = '+92 321 9998877';
  inputs.academyAddressInput.value = 'Karachi';
  const ok = await sandbox.AcademyProfile.save();
  const saved = upserts.length ? JSON.parse(upserts[upserts.length - 1].value) : {};
  check('save upserts the edited profile (trimmed)', ok === true && saved.name === 'City Quran Academy' && saved.email === 'admin@city.example' && saved.phone === '+92 321 9998877');
  check('after save, helpers serve the new identity', sandbox.academyName() === 'City Quran Academy' && sandbox.academyEmail() === 'admin@city.example');
}

console.log('== structure ==');
{
  const html = read('index.html');
  const worker = read('cloudflare/worker.js');
  const email = read('js/email.js');
  check('sidebar: Academy Profile sub-button inside the Settings group, after Course Payment Settings',
    html.indexOf('id="sidebarSettingsGroup"') < html.indexOf('data-tab="tab-settings-academy"')
    && html.indexOf('data-tab="tab-settings"') < html.indexOf('data-tab="tab-settings-academy"'));
  check('panel: tab-settings-academy section with the four fields + save button',
    html.includes('id="tab-settings-academy"') && html.includes('id="academyNameInput"')
    && html.includes('id="academyEmailInput"') && html.includes('id="academyPhoneInput"')
    && html.includes('id="academyAddressInput"') && html.includes('id="btnSaveAcademyProfile"'));
  check('script tag loads academy-profile.js', html.includes('<script src="js/academy-profile.js"></script>'));
  check('email.js identity is dynamic (let + __setAcademyIdentity hook)',
    email.includes('let ACADEMY_NAME') && email.includes('window.__setAcademyIdentity'));
  check('worker: managers may READ academy_profile_v1; release bumped',
    worker.includes("k === 'academy_profile_v1'") && worker.includes("const WORKER_RELEASE = '2026-11-03-academy-profile'"));
}

console.log('== consumers read the profile ==');
{
  const counts = {
    'js/payroll.js': 7, 'js/fees.js': 16, 'js/teachers.js': 4,
    'js/profiles360.js': 4, 'js/dashboard.js': 2, 'js/trials.js': 1, 'js/families.js': 1,
  };
  for (const [f, min] of Object.entries(counts)) {
    const n = (read(f).match(/academyName\(\)/g) || []).length;
    check(`${f} builds messages with academyName() (${n} >= ${min})`, n >= min);
  }
  check('fees official email consults the profile first',
    read('js/fees.js').includes('AcademyProfile.get().email'));
  check('no hardcoded academy name remains in consumer templates',
    ['js/payroll.js', 'js/fees.js', 'js/teachers.js', 'js/profiles360.js', 'js/dashboard.js', 'js/trials.js', 'js/families.js']
      .every((f) => !read(f).includes('Al-Huda Islamic Centre')));
}

console.log(`\nACADEMY PROFILE SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
