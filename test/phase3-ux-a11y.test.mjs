// Phase 3.6 test — UX/a11y (P2-28–P2-38) + 3.4 banner-gating follow-up.
// Structural guards: portal rendering needs a browser, so these checks pin
// the exact code paths that make each fix real — a regression that drops
// a label, a focus trap, a pager, or re-opens the banner on the login
// screen fails here.
// Run from the repo root:  node test/phase3-ux-a11y.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const INDEX = read('index.html');
const TEACHER = read('teacher.html');
const PARENT = read('parent.html');
const UTILS = read('js/utils.js');
const MODAL_A11Y = read('js/modal-a11y.js');
const CDB = read('js/cloudflare-db.js');
const AUTH = read('js/auth.js');
const FAMILIES = read('js/families.js');
const FEES = read('js/fees.js');
const WORKER = read('cloudflare/worker.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}
const count = (src, re) => (src.match(re) || []).length;

// ==== 3.4 follow-up: stale-banner gating ====
check('GATE banner gate helpers exist in cloudflare-db.js',
  CDB.includes('function mirrorResultHasRows') && CDB.includes('function isLoginScreenShowing'));
check('GATE banner shows only with rows AND no login screen showing',
  CDB.includes('if (mirrorResultHasRows(mirrorRes) && !isLoginScreenShowing())'));
check('GATE login-screen check covers all three portals',
  CDB.includes("'ownerLoginView'") && CDB.includes("'loginView'") && CDB.includes("'parentLoginView'"));
check('GATE fallback hides the banner when the gate fails',
  CDB.includes('} else {\n      setMirrorStaleBanner(false);\n    }'));
check('GATE no unconditional setMirrorStaleBanner(true) left on the fallback path',
  !CDB.includes('// Batch 3.4 (audit P2-9): every mirror read shows the stale banner'));

// ==== P2-28 / P2-29: shared modal helper ====
check('MODAL helper file exposes open/close/closeTop/watchAllModals',
  MODAL_A11Y.includes('window.ModalA11y') &&
  MODAL_A11Y.includes('open: open') && MODAL_A11Y.includes('close: close') &&
  MODAL_A11Y.includes('closeTop: closeTop') && MODAL_A11Y.includes('watchAllModals: watchAllModals'));
check('MODAL helper traps Tab (Shift+Tab cycles) and skips Batch 8 dialogs',
  MODAL_A11Y.includes("e.key !== 'Tab'") && MODAL_A11Y.includes('e.shiftKey') &&
  MODAL_A11Y.includes("closest('.lms-dialog')"));
check('MODAL helper moves focus in, returns it on close, closes on backdrop click',
  MODAL_A11Y.includes('list[0].focus()') && MODAL_A11Y.includes('s.prev.focus()') &&
  MODAL_A11Y.includes('e.target !== this') && MODAL_A11Y.includes("setAttribute('role', 'dialog')") &&
  MODAL_A11Y.includes("setAttribute('aria-modal', 'true')"));
check('MODAL helper does NOT handle Escape (existing handlers own it)',
  !MODAL_A11Y.includes("'Escape'"));
check('MODAL helper loaded by index, teacher, parent',
  INDEX.includes('js/modal-a11y.js') && TEACHER.includes('js/modal-a11y.js') && PARENT.includes('js/modal-a11y.js'));
check('MODAL index openModal/closeModal wired through the helper',
  UTILS.includes('ModalA11y.open(m') && UTILS.includes('ModalA11y.close(m)'));
check('MODAL parent openModal/closeModal wired through the helper',
  PARENT.includes('ModalA11y.open(el') && PARENT.includes('ModalA11y.close(el'));
check('MODAL parent has an Escape listener closing the topmost registered modal',
  PARENT.includes("e.key !== 'Escape'") && PARENT.includes('ModalA11y.closeTop()'));
const teacherClosers = ['modalTeacherAttendance', 'modalClassLeaveAbsent', 'modalTeacherAdvanceClass',
  'modalTeacherLeaveRequest', 'modalRescheduleRequest', 'modalTimeChangeRequest', 'modalWeeklyMatrix',
  'modalTeacherAddScheduleSlot', 'modalDigitalBookReader', 'modalCourseMaterialPreview',
  'modalTeacherLibraryPicker', 'modalTeacherSalarySlip'];
check('MODAL teacher watchAllModals maps all 12 modals to their close functions',
  TEACHER.includes('watchAllModals') &&
  teacherClosers.every((id) => TEACHER.includes(id + ': function')));

// ==== P2-30: aria-label on icon-only controls ====
function unlabeledTimesButtons(src) {
  const found = src.match(/<button[^>]*>(?:&times;|\s*<i class="fa-solid fa-xmark"><\/i>\s*)<\/button>/g) || [];
  return found.filter((b) => !b.includes('aria-label')).length;
}
check('LABEL index has no unlabeled static close button left',
  unlabeledTimesButtons(INDEX) === 0, String(unlabeledTimesButtons(INDEX)));
check('LABEL teacher has no unlabeled static close button left',
  unlabeledTimesButtons(TEACHER) === 0, String(unlabeledTimesButtons(TEACHER)));
check('LABEL parent has no unlabeled static close button left',
  unlabeledTimesButtons(PARENT) === 0, String(unlabeledTimesButtons(PARENT)));
check('LABEL close-button aria-label counts (index 32, teacher 11, parent 2)',
  count(INDEX, /aria-label="Close"/g) === 32 &&
  count(TEACHER, /aria-label="Close"/g) === 11 &&
  count(PARENT, /aria-label="Close"/g) === 2,
  `${count(INDEX, /aria-label="Close"/g)}/${count(TEACHER, /aria-label="Close"/g)}/${count(PARENT, /aria-label="Close"/g)}`);
check('LABEL sidebar toggles labelled in teacher + index',
  TEACHER.includes('btnToggleTeacherSidebar" onclick="toggleTeacherSidebar()" aria-label="Toggle navigation sidebar"') &&
  INDEX.includes('aria-label="Toggle navigation sidebar"'));

// ==== P2-31: label-for ====
const loginFors = ['for="ownerLoginUsername"', 'for="ownerLoginPassword"',
  'for="loginUsername"', 'for="loginPassword"',
  'for="parentLoginUsername"', 'for="parentLoginPassword"'];
check('LABEL login forms have for= on username + password in all three portals',
  loginFors.every((f) => (INDEX + TEACHER + PARENT).includes(f)));
check('LABEL Add Family + fee form fields have for=',
  INDEX.includes('for="famParentName"') && INDEX.includes('for="famWhatsApp"') &&
  INDEX.includes('for="famMonthlyFee"') && INDEX.includes('for="feeFormFamilyId"') &&
  INDEX.includes('for="feeFormMonth"') && INDEX.includes('for="feeFormPreviousBalance"'));
check('LABEL index carries 26+ label-for associations',
  count(INDEX, /<label for=/g) >= 26, String(count(INDEX, /<label for=/g)));

// ==== P2-32: teacher sidebar follows modal openers ====
check('SIDEBAR sync maps the 4 opener modals to their buttons',
  TEACHER.includes('modalWeeklyMatrix: \'sbNavWeekSchedule\'') &&
  TEACHER.includes('modalTeacherLibraryPicker: \'sbNavCourseMaterials\'') &&
  TEACHER.includes('modalTeacherAdvanceClass: \'sbNavAdvanceClass\'') &&
  TEACHER.includes('modalTeacherAddScheduleSlot: \'sbNavAddSchedule\''));
check('SIDEBAR + Schedule Student button has an id for the map',
  TEACHER.includes('id="sbNavAddSchedule"'));
check('SIDEBAR observer re-syncs on opener-modal visibility changes',
  TEACHER.includes('teacherSidebarObserver') && TEACHER.includes('syncTeacherSidebarActiveState(CURRENT_TEACHER_TAB)'));

// ==== P2-33: manager retitling ====
check('ROLE dashboard heading has an id and retitles per role',
  INDEX.includes('id="dashboardHeading"') &&
  AUTH.includes("heading.textContent = (role === 'manager') ? 'Manager Dashboard' : 'Admin Dashboard'"));
check('ROLE badge static markup is no longer desktop-only',
  INDEX.includes('id="headerRoleSecurityBadge" class="shrink-0"') &&
  !INDEX.includes('id="headerRoleSecurityBadge" class="hidden xl:block'));

// ==== P2-34: 44px touch targets ====
check('TOUCH parent sub-nav buttons are 44px tall',
  count(PARENT, /portal-nav-btn[^"]*min-h-\[44px\]/g) >= 5,
  String(count(PARENT, /portal-nav-btn[^"]*min-h-\[44px\]/g)));
check('TOUCH teacher hamburger + zoom + floating buttons are 44px',
  TEACHER.includes('min-h-[44px] min-w-[44px]') &&
  TEACHER.includes('changePreviewZoom(-0.1)" aria-label="Zoom out" class="w-11 h-11') &&
  TEACHER.includes('btnReaderPrevFloating" aria-label="Previous page" class="z-20 w-11 h-11') &&
  TEACHER.includes('btnReaderNextFloating" aria-label="Next page" class="z-20 w-11 h-11'));
check('TOUCH index reader toolbar + sidebar toggle are 44px',
  INDEX.includes('changeReaderPage(-1)" aria-label="Previous page" class="w-11 h-11') &&
  INDEX.includes('changeReaderZoom(0.15)" aria-label="Zoom in" class="w-11 h-11') &&
  INDEX.includes('toggleReaderFullscreen()" aria-label="Toggle fullscreen" class="w-11 h-11') &&
  INDEX.includes('toggleSidebar()" aria-label="Toggle navigation sidebar" class="w-11 h-11'));

// ==== P2-35: parent focus visibility ====
check('FOCUS parent has a select:focus ring rule',
  PARENT.includes('select:focus') && PARENT.includes('box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.18)'));
check('FOCUS no focus:outline-none left in parent.html',
  !PARENT.includes('focus:outline-none'));
check('FOCUS dark-pill student selector keeps a readable focus background',
  PARENT.includes('#portalStudentSelect:focus') && PARENT.includes('background-color: transparent !important'));

// ==== P2-36: pagination ====
check('PAGE shared pager builder + clamp helper exist in utils.js',
  UTILS.includes('function buildTablePagerHtml') && UTILS.includes('function paginateList'));
check('PAGE directory renders page + pager containers exist in index',
  FAMILIES.includes('paginateList(filtered, FAM_TABLE_PAGE') &&
  FAMILIES.includes('paginateList(filtered, STU_TABLE_PAGE') &&
  INDEX.includes('id="familiesTablePager"') && INDEX.includes('id="studentsTablePager"'));
check('PAGE directory setters + page reset on search/filter',
  FAMILIES.includes('function setFamTablePage') && FAMILIES.includes('function setStuTablePageSize') &&
  FAMILIES.includes('FAM_TABLE_PAGE = 1;\n      STU_TABLE_PAGE = 1;'));
check('PAGE fee renders page + pager containers exist in index',
  FEES.includes('paginateList(list, FEE_PENDING_PAGE') &&
  FEES.includes('paginateList(list, FEE_DEFAULTERS_PAGE') &&
  FEES.includes('paginateList(rows, FEE_MATRIX_PAGE') &&
  INDEX.includes('id="feePendingTablePager"') && INDEX.includes('id="feeDefaultersTablePager"') &&
  INDEX.includes('id="feeMatrixTablePager"'));
check('PAGE fee pager setters preserve live search (filter fns, not raw caches)',
  FEES.includes('filterPendingDefaultersSearchLive();') &&
  FEES.includes('filterThreePlusDefaultersLive();') &&
  FEES.includes('filterAnnualFeeMatrixLive();'));
check('PAGE row numbers offset by page in directory renders',
  FAMILIES.includes('${famPageStart + idx + 1}') && FAMILIES.includes('${stuPageStart + idx + 1}'));

// ==== P2-37 / P2-38 ====
check('HINT owner login placeholder is neutral (no dead usernames)',
  INDEX.includes('placeholder="Enter username"') && !INDEX.includes('alhuda_admin or admin'));
check('HERO parent hero + live-class card show loading state, not fake identity',
  PARENT.includes('id="heroWelcomeName" class="text-amber-300">Loading…</span>') &&
  PARENT.includes('id="liveClassSubject">Loading…</h2>') &&
  PARENT.includes('id="liveClassTeacher">Loading…</strong>') &&
  PARENT.includes('id="liveClassTime">Loading…</strong>'));
check('HERO no dead Join link left in parent template',
  !PARENT.includes('href="#"') && PARENT.includes('Loading class link…'));

// ==== Guards: no release bump, no native popups in the new helper ====
check('GUARD WORKER_RELEASE is the commission release',
  WORKER.includes("2026-10-29-announcements"));
check('GUARD new modal helper uses no native alert/confirm/prompt',
  !MODAL_A11Y.includes('alert(') && !MODAL_A11Y.includes('confirm(') && !MODAL_A11Y.includes('prompt('));

const failed = results.filter((r) => !r.pass);
console.log('---');
console.log(`phase3-ux-a11y: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('FAILURES: ' + failed.map((r) => r.name).join(' | '));
  process.exit(1);
}
