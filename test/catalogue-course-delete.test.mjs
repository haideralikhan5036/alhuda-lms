// Restricted catalogue course deletion (owner commission 2026-11-05).
// Course Payment Settings previously offered NO way to remove a course —
// only deactivation. deleteCatalogueCourse (js/course-catalogue.js) now
// deletes a course ONLY when nothing references it: student records
// (notes course strings / course_id), the student_assignments ledger and
// saved salary-slip payloads are all checked first, and the check FAILS
// CLOSED — any read error means "not deleted". Referenced courses are
// refused with a pointer to the Active checkbox, so history is never
// cascade-deleted. Owner-only; in-flight guarded.
// Executes the REAL js/course-catalogue.js in a vm with a mocked DOM/db.
// Run from the repo root:  node test/catalogue-course-delete.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/course-catalogue.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const BASE_SETTINGS = {
  version: 1, weekend_rate: 3200, basic_salary_pkr: 20000, updated_at: null, updated_by: null,
  courses: [
    { id: 'crs-alpha', name: 'Alpha Course', monthly_rate: 1000, active: true, aliases: ['Alpha Old'] },
    { id: 'crs-beta', name: 'Beta Course', monthly_rate: 2000, active: true, aliases: [] },
    { id: 'crs-gamma', name: 'Gamma Course', monthly_rate: 3000, active: true, aliases: [] },
  ],
};

function makeSelect(id) {
  return {
    id, children: [], value: '',
    set innerHTML(v) { if (v === '') this.children = []; },
    get innerHTML() { return ''; },
    appendChild(opt) { this.children.push(opt); if (this.children.length === 1) this.value = opt.value; },
  };
}

// Boot a fresh catalogue module with fixture settings + db tables.
// tables: { students: {rows}|{error}, student_assignments: ..., salary_slips: ..., __upsertError }
function boot({ role = 'owner', settings = BASE_SETTINGS, tables = {}, confirmImpl = null } = {}) {
  const settingsJson = JSON.stringify(settings);
  const store = { alhuda_course_rates_v1: settingsJson };
  const calls = { upserts: [], selects: [], notifies: [], confirms: [] };

  const query = (result) => {
    const q = {
      eq() { return q; }, limit() { return q; }, order() { return q; },
      then(res, rej) { return Promise.resolve(result).then(res, rej); },
    };
    return q;
  };
  const db = {
    from(table) {
      return {
        select() {
          calls.selects.push(table);
          if (table === 'system_settings') return query({ data: [{ value: settingsJson }], error: null });
          const t = tables[table];
          if (t && t.error) return query({ data: null, error: t.error });
          return query({ data: (t && t.rows) || [], error: null });
        },
        upsert(values) {
          calls.upserts.push({ table, values });
          if (tables.__upsertError) return Promise.resolve({ data: null, error: tables.__upsertError });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };

  const els = {
    courseRatesTableBody: { innerHTML: '' },
    weekendRateInput: { value: String(settings.weekend_rate) },
    basicSalaryInput: { value: String(settings.basic_salary_pkr) },
    btnSaveCourseRates: { style: {} },
    courseRatesAddWrap: { style: {} },
    courseRatesRoleNote: { textContent: '' },
    courseRatesUpdatedInfo: { textContent: '' },
    courseRatesWarning: { classList: { add() {}, remove() {} }, textContent: '' },
    newCourseName: { value: '' },
    newCourseRate: { value: '' },
    stuCourseSelect: makeSelect('stuCourseSelect'),
    trialCourse: makeSelect('trialCourse'),
  };
  // The settings form's rows, as collectSettingsFromForm reads them.
  // Tests may edit formRows to simulate unsaved owner edits.
  const formRows = settings.courses.map((c) => ({ ...c }));
  const rowStub = (c) => {
    const fields = {
      '.cr-course-id': { value: c.id },
      '.cr-course-name': { value: c.name },
      '.cr-course-rate': { value: String(c.monthly_rate) },
      '.cr-course-active': { checked: !!c.active },
      '.cr-course-aliases': { value: (c.aliases || []).join('|') },
    };
    return { querySelector: (sel) => fields[sel] || null };
  };

  const sandbox = {
    console,
    CURRENT_ROLE: role,
    CURRENT_USER_NAME: 'Owner',
    db,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    document: {
      readyState: 'complete',
      getElementById: (id) => els[id] || null,
      createElement: () => ({ value: '', textContent: '' }),
      querySelectorAll: (sel) => (sel === '#courseRatesTableBody tr' ? formRows.map(rowStub) : []),
      addEventListener: () => {},
    },
    addEventListener: () => {},
    lmsNotify: (msg) => { calls.notifies.push(String(msg)); },
    lmsConfirm: (opts) => { calls.confirms.push(opts); return confirmImpl ? confirmImpl(opts) : Promise.resolve(true); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, calls, els, formRows, CC: sandbox.window.CourseCatalogue };
}

const EMPTY = { students: { rows: [] }, student_assignments: { rows: [] }, salary_slips: { rows: [] } };
const idsIn = (upsert) => JSON.parse(upsert.values.value).courses.map((c) => c.id);

// ---- 1. Clean delete succeeds; unsaved edits to other rows preserved ----
{
  const b = boot({ tables: EMPTY });
  b.formRows.find((r) => r.id === 'crs-alpha').monthly_rate = 1111; // unsaved edit
  await b.sandbox.window.deleteCatalogueCourse('crs-beta');
  check('clean delete: exactly one upsert', b.calls.upserts.length === 1, 'n=' + b.calls.upserts.length);
  const payload = JSON.parse(b.calls.upserts[0].values.value);
  check('clean delete: payload drops beta, keeps alpha+gamma', JSON.stringify(payload.courses.map((c) => c.id)) === JSON.stringify(['crs-alpha', 'crs-gamma']), JSON.stringify(payload.courses.map((c) => c.id)));
  check('clean delete: unsaved edit to another course preserved in payload', payload.courses.find((c) => c.id === 'crs-alpha').monthly_rate === 1111);
  check('clean delete: top-level stamp set like Save', !!payload.updated_at && payload.updated_by === 'Owner');
  check('clean delete: success notify', b.calls.notifies.some((m) => m.includes('Beta Course') && m.includes('deleted')), b.calls.notifies.join(' | '));
  check('clean delete: in-memory settings no longer list beta', !b.CC.getSettings().courses.some((c) => c.id === 'crs-beta'));
}

// ---- 2. Referenced by a current student (notes course_name) -> refused ----
{
  const b = boot({ tables: { ...EMPTY, students: { rows: [{ id: 'STU-1', status: 'Active', notes: JSON.stringify({ course_name: 'Beta Course' }), course_id: null }] } } });
  await b.sandbox.window.deleteCatalogueCourse('crs-beta');
  check('student ref: refused, no upsert', b.calls.upserts.length === 0);
  check('student ref: no confirm shown (check runs first)', b.calls.confirms.length === 0);
  check('student ref: message names the use and points to Active', b.calls.notifies.some((m) => m.includes('cannot be deleted') && m.includes('1 student record(s)') && m.includes('Active')), b.calls.notifies.join(' | '));
  check('student ref: course still in settings', b.CC.getSettings().courses.some((c) => c.id === 'crs-beta'));
}

// ---- 2b. Legacy combined string with an alias still counts ----
{
  const b = boot({ tables: { ...EMPTY, students: { rows: [{ id: 'STU-2', status: 'Inactive', notes: JSON.stringify({ course_name: 'Alpha Old / Beta Course' }), course_id: null }] } } });
  await b.sandbox.window.deleteCatalogueCourse('crs-beta');
  check('combined-string ref (any status): refused, no upsert', b.calls.upserts.length === 0 && b.calls.notifies.some((m) => m.includes('cannot be deleted')), b.calls.notifies.join(' | '));
}

// ---- 3. Referenced only by a closed ledger row -> refused ----
{
  const b = boot({ tables: { ...EMPTY, student_assignments: { rows: [{ id: 'ASG-1', course_name: 'Beta Course' }] } } });
  await b.sandbox.window.deleteCatalogueCourse('crs-beta');
  check('ledger ref: refused, no upsert', b.calls.upserts.length === 0);
  check('ledger ref: message counts assignments', b.calls.notifies.some((m) => m.includes('1 course assignment(s)')), b.calls.notifies.join(' | '));
}

// ---- 4. Referenced only inside a saved slip payload -> refused ----
{
  const snap = JSON.stringify([{ student_id: 'STU-9', course_id: 'crs-beta', final_rate: 2000 }]);
  const b = boot({ tables: { ...EMPTY, salary_slips: { rows: [{ id: 'SLP-1', student_items_snapshot: snap, legacy_json: '{}' }] } } });
  await b.sandbox.window.deleteCatalogueCourse('crs-beta');
  check('slip ref (course id in snapshot): refused, no upsert', b.calls.upserts.length === 0);
  check('slip ref: message counts slips', b.calls.notifies.some((m) => m.includes('1 saved salary slip(s)')), b.calls.notifies.join(' | '));
}
{
  const legacy = JSON.stringify({ month: 'October 2026', lines: [{ course_name: 'Beta Course' }] });
  const b = boot({ tables: { ...EMPTY, salary_slips: { rows: [{ id: 'SLP-2', student_items_snapshot: '[]', legacy_json: legacy }] } } });
  await b.sandbox.window.deleteCatalogueCourse('crs-beta');
  check('slip ref (exact name in legacy_json): refused, no upsert', b.calls.upserts.length === 0, b.calls.notifies.join(' | '));
}

// ---- 5. A verification read errors -> fail closed ----
{
  const b = boot({ tables: { ...EMPTY, students: { error: new Error('read failed') } } });
  await b.sandbox.window.deleteCatalogueCourse('crs-beta');
  check('verify failure: exact fail-closed message', b.calls.notifies.includes('Could not verify whether this course is in use, so it was not deleted.'), b.calls.notifies.join(' | '));
  check('verify failure: no upsert, no confirm', b.calls.upserts.length === 0 && b.calls.confirms.length === 0);
  check('verify failure: course still in settings', b.CC.getSettings().courses.some((c) => c.id === 'crs-beta'));
}

// ---- 6. Manager session -> nothing happens; no button rendered ----
{
  const b = boot({ role: 'manager', tables: EMPTY });
  await b.sandbox.window.deleteCatalogueCourse('crs-beta');
  check('manager: refused before any read or write', b.calls.upserts.length === 0 && !b.calls.selects.includes('students'), b.calls.notifies.join(' | '));
  b.sandbox.window.renderCoursePaymentSettings();
  check('manager: settings rows render NO delete button', !b.els.courseRatesTableBody.innerHTML.includes('deleteCatalogueCourse('));
}

// ---- 7. Upsert fails -> error notify, course stays ----
{
  const b = boot({ tables: { ...EMPTY, __upsertError: new Error('write failed') } });
  await b.sandbox.window.deleteCatalogueCourse('crs-beta');
  check('upsert error: one upsert attempted', b.calls.upserts.length === 1);
  check('upsert error: error notify, no success notify', b.calls.notifies.some((m) => m.includes('did not save')) && !b.calls.notifies.some((m) => m.includes('deleted.')), b.calls.notifies.join(' | '));
  check('upsert error: course still in settings', b.CC.getSettings().courses.some((c) => c.id === 'crs-beta'));
}

// ---- 8. Double invocation while in flight -> exactly one delete ----
{
  let releaseConfirm;
  const held = new Promise((res) => { releaseConfirm = res; });
  const b = boot({ tables: EMPTY, confirmImpl: () => held });
  const p1 = b.sandbox.window.deleteCatalogueCourse('crs-beta');
  const p2 = b.sandbox.window.deleteCatalogueCourse('crs-beta');
  releaseConfirm(true);
  await Promise.all([p1, p2]);
  check('double invoke: exactly one confirm and one upsert', b.calls.confirms.length === 1 && b.calls.upserts.length === 1, 'confirms=' + b.calls.confirms.length + ' upserts=' + b.calls.upserts.length);
}

// ---- 9. Confirm declined -> nothing written ----
{
  const b = boot({ tables: EMPTY, confirmImpl: () => Promise.resolve(false) });
  await b.sandbox.window.deleteCatalogueCourse('crs-beta');
  check('confirm declined: no upsert, course remains', b.calls.upserts.length === 0 && b.CC.getSettings().courses.some((c) => c.id === 'crs-beta'));
}

// ---- 10. Owner render: one delete button per row ----
{
  const b = boot({ tables: EMPTY });
  b.sandbox.window.renderCoursePaymentSettings();
  const html = b.els.courseRatesTableBody.innerHTML;
  check('owner render: a delete button per course row', (html.match(/deleteCatalogueCourse\(/g) || []).length === 3 && html.includes('fa-trash-can'), 'buttons=' + (html.match(/deleteCatalogueCourse\(/g) || []).length);
}

// ---- 11. Last remaining course cannot be deleted (defaults guard) ----
{
  const single = { ...BASE_SETTINGS, courses: [BASE_SETTINGS.courses[0]] };
  const b = boot({ settings: single, tables: EMPTY });
  await b.sandbox.window.deleteCatalogueCourse('crs-alpha');
  check('last course: refused, no upsert', b.calls.upserts.length === 0 && b.calls.notifies.some((m) => m.includes('At least one course')), b.calls.notifies.join(' | '));
}

// ---- 12. Structural: settings table gained the action header cell ----
{
  const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
  const thead = html.slice(html.indexOf('id="courseRatesWarning"'), html.indexOf('id="courseRatesTableBody"'));
  check('index.html: settings thead has 5 header cells', (thead.match(/<th[\s>]/g) || []).length === 5, 'n=' + (thead.match(/<th[\s>]/g) || []).length);
  check('course-catalogue.js exports deleteCatalogueCourse', SRC.includes('window.deleteCatalogueCourse = deleteCatalogueCourse'));
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(' ; ')); process.exit(1); }
