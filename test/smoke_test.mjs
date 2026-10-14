// Smoke tests for the Phase 2 worker scoping + hashing logic.
// Run: node test/smoke_test.mjs  (from the repo root, or anywhere — path is absolute)
// Covers: role access matrix, credential stripping, hash round-trip,
// default-password rejection, server-side filter injection, storage prefix.
import '/home/hatch/workspace/security-staging/phase2/test/worker_testable.mjs';
const t = globalThis.__t;
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };
const allow = (r, tb, a) => t.checkTableAccess(r, tb, a) === 'allow';

// 1. Role matrix
ok('owner full', allow('owner','families','select'));
ok('teacher denied families', !allow('teacher','families','select'));
ok('parent denied system_settings', !allow('parent','system_settings','select'));
ok('parent can read own students', allow('parent','students','select'));
ok('parent cannot delete students', !allow('parent','students','delete'));
ok('teacher can update students', allow('teacher','students','update'));
ok('manager denied system_settings write', !allow('manager','system_settings','update'));
ok('manager can read students', allow('manager','students','select'));

// 2. Credential stripping (mutates in place)
const row = { id: '1', full_name: 'X', notes: JSON.stringify({portal_credentials:{username:'u',password:'p'}, other: 1}) };
t.stripCredentialFieldsFromRow('families', row);
const parsed = JSON.parse(row.notes);
ok('password removed from portal_credentials', !parsed.portal_credentials.password);
ok('username (not a secret) may remain', parsed.portal_credentials.username === 'u');
ok('other fields preserved', parsed.other === 1);

// 3. Password hashing round-trip + default rejection
const h = await t.hashPassword('MyStrongPass123');
ok('hash format', t.isHashedPassword(h));
ok('hash verifies', await t.verifyPassword('MyStrongPass123', h));
ok('wrong password fails', !(await t.verifyPassword('WrongPass', h)));
ok('default 12345678 never verifies (plaintext)', !(await t.verifyPassword('12345678', '12345678')));
ok('empty never verifies', !(await t.verifyPassword('', '')));
ok('legacy plaintext still verifies', await t.verifyPassword('oldpass', 'oldpass'));

// 4. Filter injection — parent query gets scoped
const scoped = t.applyDbScope({ table: 'students', action: 'select', filters: [] }, 'parent', 'FAM-1', { studentIds: ['S1','S2'], familyIds: ['FAM-1'] });
ok('parent filter injected', JSON.stringify(scoped.filters).includes('FAM-1'));

// 5. Storage prefix (no trailing slash; caller adds it)
ok('parent storage scoped', t.scopedStorageFolder('parent','FAM-1') === 'scoped-parent-FAM-1');
ok('storage folder sanitizes', t.scopedStorageFolder('parent','FAM-1/../../x') === 'scoped-parent-FAM-1x');

console.log(`SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
