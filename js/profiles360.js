/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODERN FAMILY PROFILE WORKSPACE ENGINE
 * File: js/profiles360.js
 * Purpose: Full-Screen Dedicated Family Profile Workspace (Central Hub for
 *          Family + All Connected Students, Attendance, Daily Lessons, Progress,
 *          Certificates, Payments, Manager Notes, Teacher Notes & Bio Data)
 *          plus Teacher Schedule/Profile Workspace.
 *          100% Connected to Supabase & Main LMS Modules (One Source of Truth).
 * ============================================================================
 */

let _PROFILE_360_STACK = [];
let _ORIGIN_LMS_TAB = 'tab-dashboard';
let _CURRENT_360_STATE = {
  type: null,                 // 'family' | 'teacher'
  id: null,                   // familyId or teacherId
  activeTab: 'students',      // 'students' | 'payments' | 'manager_notes' | 'teacher_notes' | 'biodata'
  selectedStudentId: null,    // Currently selected Student ID inside the Family Profile
  studentSubView: 'history',  // 'history' | 'lessons' | 'report' | 'certificates' | 'info'
  selectedLessonDate: null,   // Highlighted date in Daily Lessons
  attFilterStatus: 'all',     // 'all' | 'Present' | 'Absent' | 'Leave'
  showPassword: false
};

const _DAY_LABELS_360 = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday'
};

const _TAB_NAMES_MAP = {
  'tab-dashboard': 'Main Dashboard',
  'tab-families': 'Families & Students Directory',
  'tab-teachers': 'Teachers & Staff Directory',
  'tab-invoices': 'Fee Management & Ledger',
  'tab-salaries': 'Salaries & Payroll',
  'tab-attendance': 'Daily Attendance',
  'tab-trials': 'Trial Classes',
  'tab-leaves': 'Leave Management',
  'tab-schedule-search': 'Schedule Search',
  'tab-curriculum': 'Course Curriculum'
};

// ============================================================================
// UTILITY & BACKEND SYNC HELPERS
// ============================================================================

function _esc360(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _notify360(message, type = 'success') {
  if (typeof window.lmsNotify === 'function') {
    window.lmsNotify(message, { type });
    return;
  }
  if (typeof showToastNotification === 'function') {
    try {
      showToastNotification(message);
      return;
    } catch (e) {}
  }
  let toast = document.getElementById('family360ToastBanner');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'family360ToastBanner';
    toast.className = 'fixed bottom-5 right-5 z-[9999] px-4 py-3 rounded-xl shadow-xl text-xs font-extrabold flex items-center gap-2.5 transition-all duration-300';
    document.body.appendChild(toast);
  }
  const colors = type === 'error'
    ? 'bg-rose-900 text-white border border-rose-700'
    : type === 'warning'
    ? 'bg-amber-900 text-white border border-amber-700'
    : 'bg-slate-900 text-white border border-slate-700';
  toast.className = `fixed bottom-5 right-5 z-[9999] px-4 py-3 rounded-xl shadow-xl text-xs font-extrabold flex items-center gap-2.5 transition-all duration-300 ${colors}`;
  toast.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation text-rose-400' : 'fa-circle-check text-emerald-400'} text-sm"></i> <span>${_esc360(message)}</span>`;
  toast.style.opacity = '1';
  clearTimeout(window._toast360Timer);
  window._toast360Timer = setTimeout(() => {
    if (toast) toast.style.opacity = '0';
  }, 3600);
}

/**
 * Parse and preserve structured JSON inside family.notes without losing fee_history or matrix_overrides
 */
function _parseFamilyStructuredNotes(family) {
  let base = {};
  if (typeof parseFamilyNotesData === 'function') {
    base = parseFamilyNotesData(family?.notes);
  } else if (family?.notes) {
    if (typeof family.notes === 'object') base = { ...family.notes };
    else {
      try {
        const parsed = JSON.parse(family.notes);
        if (parsed && typeof parsed === 'object') base = parsed;
        else base = { custom_notes: String(family.notes) };
      } catch (e) {
        base = { custom_notes: String(family.notes) };
      }
    }
  }
  if (!Array.isArray(base.fee_history)) base.fee_history = [];
  if (!base.matrix_overrides || typeof base.matrix_overrides !== 'object') base.matrix_overrides = {};
  if (!Array.isArray(base.manager_notes)) base.manager_notes = [];
  if (!Array.isArray(base.teacher_notes)) base.teacher_notes = [];
  if (!Array.isArray(base.communication_logs)) base.communication_logs = [];
  if (!base.bio_meta || typeof base.bio_meta !== 'object') base.bio_meta = {};
  return base;
}

/**
 * Save updated structured notes back to Supabase families.notes + in-memory ALL_FAMILIES
 */
async function _saveFamilyStructuredNotes(familyId, updatedNotesObj, extraColumns = {}) {
  const serialized = JSON.stringify(updatedNotesObj);
  const payload = { notes: serialized, ...extraColumns };

  const { error } = await db.from('families').update(payload).eq('id', familyId);
  if (error) {
    console.error('[Family Workspace] Supabase update error:', error);
    throw error;
  }

  // Update in-memory ALL_FAMILIES
  const famIdx = (window.ALL_FAMILIES || []).findIndex(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (famIdx >= 0) {
    window.ALL_FAMILIES[famIdx] = {
      ...window.ALL_FAMILIES[famIdx],
      ...extraColumns,
      notes: serialized
    };
  }
  return true;
}

/**
 * Parse and preserve structured JSON inside student.notes
 */
function _parseStudentStructuredNotes(student) {
  let meta = {};
  if (student?.notes) {
    if (typeof student.notes === 'object') meta = { ...student.notes };
    else {
      try {
        const parsed = JSON.parse(student.notes);
        if (parsed && typeof parsed === 'object') meta = parsed;
        else meta = { remarks: String(student.notes) };
      } catch (e) {
        meta = { remarks: String(student.notes) };
      }
    }
  }
  if (!Array.isArray(meta.certificates)) meta.certificates = [];
  if (!Array.isArray(meta.progress_reports)) meta.progress_reports = [];
  if (!Array.isArray(meta.teacher_notes)) meta.teacher_notes = [];
  if (student && (!student.course_id || (typeof isValidUuidString === 'function' && isValidUuidString(student.course_id)))) {
    const savedCourse = meta.course_name || meta.course || meta.trial_course || '';
    if (savedCourse) student.course_id = savedCourse;
  }
  return meta;
}

/**
 * Save updated student record to Supabase students + in-memory ALL_STUDENTS & ALL_FAMILIES
 */
async function _saveStudentRecordBackend(studentId, updateFields) {
  const existingStu = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  const { dbPayload, memRecord } = (typeof buildStudentDatabasePayload === 'function')
    ? buildStudentDatabasePayload(updateFields, existingStu)
    : { dbPayload: updateFields, memRecord: updateFields };

  const { error } = await db.from('students').update(dbPayload).eq('id', studentId);
  if (error) {
    console.error('[Student Update] Supabase error:', error);
    throw error;
  }

  // Update ALL_STUDENTS
  const sIdx = (window.ALL_STUDENTS || []).findIndex(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (sIdx >= 0) {
    window.ALL_STUDENTS[sIdx] = { ...window.ALL_STUDENTS[sIdx], ...memRecord };
  }

  // Update nested student inside ALL_FAMILIES
  (window.ALL_FAMILIES || []).forEach(fam => {
    if (Array.isArray(fam.students)) {
      const fStuIdx = fam.students.findIndex(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
      if (fStuIdx >= 0) {
        fam.students[fStuIdx] = { ...fam.students[fStuIdx], ...memRecord };
      }
    }
  });

  // Refresh global views in background
  if (typeof renderFamiliesCards === 'function') {
    try { renderFamiliesCards(); renderFamiliesMasterTable(); renderAllStudentsListTable(); } catch (e) {}
  }
}

/**
 * Activate Full-Screen Dedicated Workspace (#tab-profile-360)
 */
function _activateFullScreenProfilePage(entityType) {
  const visibleSection = Array.from(document.querySelectorAll('.tab-content')).find(
    el => !el.classList.contains('hidden') && el.id !== 'tab-profile-360'
  );
  if (visibleSection && visibleSection.id) {
    _ORIGIN_LMS_TAB = visibleSection.id;
  }

  // Dismiss any open modal overlays so nothing covers the full-screen workspace
  document.querySelectorAll('.fixed.inset-0').forEach(modalEl => {
    if (!modalEl.classList.contains('hidden') && modalEl.id !== 'familyWorkspaceActionModal') {
      modalEl.classList.add('hidden');
      modalEl.classList.remove('flex');
    }
  });
  if (typeof clearDashboardGlobalSearch === 'function') {
    try { clearDashboardGlobalSearch(); } catch (e) {}
  }

  if (typeof switchTab === 'function') {
    switchTab('tab-profile-360');
  } else {
    document.querySelectorAll('.tab-content').forEach(el => {
      el.classList.add('hidden');
      el.classList.remove('block');
    });
    const target = document.getElementById('tab-profile-360');
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('block');
    }
  }

  const highlightSidebarTab = entityType === 'teacher' ? 'tab-teachers' : 'tab-families';
  const activeSidebarBtn = document.querySelector(`.sidebar-nav-btn[data-tab="${highlightSidebarTab}"]`);
  if (activeSidebarBtn) {
    activeSidebarBtn.classList.add('active');
  }

  try {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    window.scrollTo(0, 0);
  }
}

function exitFullScreen360Profile() {
  _PROFILE_360_STACK = [];
  const targetTab = _ORIGIN_LMS_TAB && _ORIGIN_LMS_TAB !== 'tab-profile-360' ? _ORIGIN_LMS_TAB : 'tab-dashboard';
  if (typeof switchTab === 'function') {
    switchTab(targetTab);
  }
}

const _FAMILY_360_MEM_CACHE = {};
const _TEACHER_360_MEM_CACHE = {};

function invalidate360ProfileCache(familyOrTeacherId = null) {
  if (!familyOrTeacherId) {
    Object.keys(_FAMILY_360_MEM_CACHE).forEach(k => delete _FAMILY_360_MEM_CACHE[k]);
    Object.keys(_TEACHER_360_MEM_CACHE).forEach(k => delete _TEACHER_360_MEM_CACHE[k]);
    return;
  }
  const key = String(familyOrTeacherId).toUpperCase();
  delete _FAMILY_360_MEM_CACHE[key];
  delete _TEACHER_360_MEM_CACHE[key];
}
window.invalidate360ProfileCache = invalidate360ProfileCache;

async function _ensure360CoreDataReady(forceRefresh = false) {
  try {
    if (forceRefresh) {
      invalidate360ProfileCache();
    }
    if (typeof ensureCoreLmsDataLoaded === 'function') {
      await ensureCoreLmsDataLoaded({ force: forceRefresh });
      return;
    }

    const needFamilies = forceRefresh || !Array.isArray(window.ALL_FAMILIES) || window.ALL_FAMILIES.length === 0;
    const needStudents = forceRefresh || !Array.isArray(window.ALL_STUDENTS) || window.ALL_STUDENTS.length === 0;
    const needTeachers = forceRefresh || !Array.isArray(window.ALL_TEACHERS) || window.ALL_TEACHERS.length === 0;

    const tasks = [];
    if (needFamilies) {
      tasks.push(
        db.from('families').select('*, students(*)').order('created_at', { ascending: false }).then(res => {
          if (res.data) {
            window.ALL_FAMILIES = res.data.filter(f => {
              const st = String(f.status || '').toLowerCase();
              return st !== 'trial' && st !== 'converted' && !String(f.id || '').toUpperCase().startsWith('TRL-');
            });
            if (typeof ingestFeeDataFromFamilies === 'function') {
              ingestFeeDataFromFamilies(window.ALL_FAMILIES);
            }
          }
        })
      );
    }
    if (needStudents) {
      tasks.push(
        db.from('students').select('*').order('created_at', { ascending: false }).then(res => {
          if (res.data) window.ALL_STUDENTS = res.data;
        })
      );
    }
    if (needTeachers) {
      tasks.push(
        db.from('teachers').select('*').order('created_at', { ascending: false }).then(res => {
          if (res.data) window.ALL_TEACHERS = res.data;
        })
      );
    }
    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  } catch (err) {
    console.warn('Workspace core data sync notice:', err);
  }
}

function _push360History(type, id, label, tab) {
  if (!type || !id) return;
  const last = _PROFILE_360_STACK[_PROFILE_360_STACK.length - 1];
  if (last && last.type === type && String(last.id) === String(id)) {
    last.label = label || last.label;
    last.tab = tab || last.tab;
    return;
  }
  _PROFILE_360_STACK.push({ type, id, label: label || String(id), tab });
  if (_PROFILE_360_STACK.length > 8) _PROFILE_360_STACK.shift();
}

function navigateBack360Profile() {
  if (_PROFILE_360_STACK.length <= 1) {
    exitFullScreen360Profile();
    return;
  }
  _PROFILE_360_STACK.pop();
  const prev = _PROFILE_360_STACK.pop();
  if (!prev) {
    exitFullScreen360Profile();
    return;
  }
  if (prev.type === 'family') openFamily360Profile(prev.id, prev.tab);
  else if (prev.type === 'teacher') openTeacher360Profile(prev.id, prev.tab);
}

async function refreshCurrent360Profile() {
  invalidate360ProfileCache();
  await _ensure360CoreDataReady(true);
  if (_CURRENT_360_STATE.type === 'family' && _CURRENT_360_STATE.id) {
    await openFamily360Profile(_CURRENT_360_STATE.id, _CURRENT_360_STATE.activeTab, true, {
      selectedStudentId: _CURRENT_360_STATE.selectedStudentId,
      studentSubView: _CURRENT_360_STATE.studentSubView,
      forceRefresh: true
    });
  } else if (_CURRENT_360_STATE.type === 'teacher' && _CURRENT_360_STATE.id) {
    await openTeacher360Profile(_CURRENT_360_STATE.id, _CURRENT_360_STATE.activeTab, true, {
      forceRefresh: true
    });
  }
}

function _buildTopWorkspaceNavHtml() {
  const originLabel = _TAB_NAMES_MAP[_ORIGIN_LMS_TAB] || 'Dashboard';
  const crumbsHtml = _PROFILE_360_STACK.map((item, idx) => {
    const isLast = idx === _PROFILE_360_STACK.length - 1;
    const typeBadge = item.type === 'family' ? 'Family' : 'Teacher';
    return `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${isLast ? 'bg-slate-900 text-white shadow-2xs' : 'bg-slate-100 text-slate-700'} max-w-[220px] truncate">
        <span class="opacity-70 font-medium">${typeBadge}:</span>
        <span class="font-extrabold truncate">${_esc360(item.label)}</span>
      </span>
      ${!isLast ? '<i class="fa-solid fa-chevron-right text-[10px] text-slate-400 mx-0.5"></i>' : ''}
    `;
  }).join('');

  return `
    <div class="bg-white rounded-2xl border border-slate-200/90 px-3 sm:px-4 py-2.5 shadow-2xs flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap min-w-0">
        <button onclick="exitFullScreen360Profile()" class="px-3 sm:px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold flex items-center gap-1.5 sm:gap-2 transition shadow-2xs cursor-pointer shrink-0">
          <i class="fa-solid fa-arrow-left text-amber-400"></i>
          <span>Back to ${_esc360(originLabel)}</span>
        </button>
        ${_PROFILE_360_STACK.length > 1 ? `
          <button onclick="navigateBack360Profile()" class="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer shrink-0">
            <i class="fa-solid fa-rotate-left text-slate-600"></i>
            <span>Previous</span>
          </button>
        ` : ''}
        <div class="h-4 w-[1px] bg-slate-200 mx-1 hidden lg:block"></div>
        <div class="hidden lg:flex items-center gap-1 flex-wrap min-w-0">
          ${crumbsHtml}
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button onclick="refreshCurrent360Profile()" class="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer">
          <i class="fa-solid fa-arrows-rotate text-indigo-600"></i>
          <span class="hidden sm:inline">Refresh Live Data</span>
          <span class="sm:hidden">Refresh</span>
        </button>
      </div>
    </div>
  `;
}

// ============================================================================
// REQUIREMENT #1 & #26: NO SEPARATE STUDENT PROFILE PAGE
// Clicking a Student anywhere in the LMS resolves their Family ID, opens the
// Family Profile Workspace, and automatically selects & highlights that Student!
// ============================================================================
async function openStudent360Profile(studentId, initialSubView = 'history') {
  if (!studentId) return;

  const targetStuIdUpper = String(studentId).toUpperCase();
  let student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === targetStuIdUpper);

  if (!student && Array.isArray(window.ALL_FAMILIES)) {
    for (const f of window.ALL_FAMILIES) {
      const match = (f.students || []).find(s => String(s.id).toUpperCase() === targetStuIdUpper);
      if (match) {
        student = match;
        break;
      }
    }
  }

  if (!student) {
    await _ensure360CoreDataReady();
    student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === targetStuIdUpper);
    if (!student) {
      const { data } = await db.from('students').select('*').eq('id', studentId).maybeSingle();
      student = data;
      if (student && Array.isArray(window.ALL_STUDENTS)) window.ALL_STUDENTS.push(student);
    }
  }

  if (!student) {
    _notify360(`Student record (${studentId}) not found.`, 'error');
    return;
  }

  const familyId = student.family_id;
  if (!familyId) {
    _notify360(`No Family ID is associated with Student ${student.name}.`, 'error');
    return;
  }

  const mappedSubView = (initialSubView === 'progress' || initialSubView === 'report')
    ? 'report'
    : (initialSubView === 'biodata' || initialSubView === 'info')
    ? 'info'
    : (initialSubView === 'certificates')
    ? 'certificates'
    : 'history';

  // Open the Family Profile with this Student automatically selected & highlighted
  await openFamily360Profile(familyId, 'students', false, {
    selectedStudentId: student.id,
    studentSubView: mappedSubView
  });
}

// ============================================================================
// PAYMENT & FEE LEDGER ENGINE (ONE SOURCE OF TRUTH WITH fees.js)
// ============================================================================
function _getFamilyPaymentsList(family) {
  if (!family) return { currency: 'USD', monthlyFee: 0, rows: [], currentMonthPaid: false };

  const famId = String(family.id || '').toUpperCase();
  const currency = family.currency || 'USD';
  const agreedFee = parseFloat(family.monthly_fee || 0) || 0;
  const fNotes = _parseFamilyStructuredNotes(family);

  let storedReceipts = [];
  if (typeof getStoredFeeRecords === 'function') {
    storedReceipts = (getStoredFeeRecords() || []).filter(r => String(r.familyId || '').toUpperCase() === famId);
  }
  // Merge with any records inside family.notes.fee_history
  const mergedMap = new Map();
  (fNotes.fee_history || []).forEach(r => {
    if (r && r.receiptNo) mergedMap.set(r.receiptNo, r);
  });
  storedReceipts.forEach(r => {
    if (r && r.receiptNo) mergedMap.set(r.receiptNo, r);
  });

  const allReceipts = Array.from(mergedMap.values());
  const defaultMethod = fNotes.bio_meta?.payment_method || (currency === 'GBP' ? 'UK Bank Transfer' : 'Bank Transfer');

  // Build unified payment rows from actual receipts + monthly billing schedule
  const rows = [];
  const coveredMonths = new Set();

  // 1. Add all explicit receipts/invoices first (including manual invoices & paid records)
  allReceipts.forEach(r => {
    const mName = r.month || 'September';
    const yr = r.year || 2026;
    const isManual = Boolean(r.isManualInvoice);
    if (!isManual) coveredMonths.add(`${mName.toLowerCase()}_${yr}`);

    const status = String(r.status || (parseFloat(r.amountPaid || 0) > 0 ? 'PAID' : 'UNPAID')).toUpperCase();
    const feeAmt = parseFloat(r.amountPaid ?? r.amount ?? agreedFee) || agreedFee;

    rows.push({
      recordId: r.receiptNo || `REC-${Math.random().toString(36).slice(2, 8)}`,
      paymentMethod: r.paymentMethod || defaultMethod,
      month: mName,
      year: yr,
      monthDisplay: `${mName.slice(0, 3)} ${yr}`,
      paidDate: status === 'PAID' ? (r.date || new Date().toISOString().slice(0, 10)) : '--',
      feeAmount: feeAmt,
      currency: r.currency || currency,
      status: status === 'PAID' ? 'PAID' : 'UNPAID',
      reason: r.reason || r.remarks || (isManual ? 'Manual Invoice' : 'Monthly Tuition Fee'),
      description: r.description || r.remarks || '',
      isManualInvoice: isManual,
      rawRecord: r
    });
  });

  // 2. Also ensure enrolled months in 2026 up to current month (September) appear if not deleted
  const monthsNames = ['January','February','March','April','May','June','July','August','September'];
  const deletedMonths = Array.isArray(fNotes.deleted_payment_months) ? fNotes.deleted_payment_months : [];

  let joinDateStr = family.created_at ? family.created_at.slice(0, 10) : '2026-06-01';
  const startMonthIdx = Math.max(0, Math.min(8, (parseInt(joinDateStr.slice(5, 7), 10) || 6) - 1));

  for (let mIdx = 8; mIdx >= startMonthIdx; mIdx--) {
    const mName = monthsNames[mIdx];
    const key = `${mName.toLowerCase()}_2026`;
    if (coveredMonths.has(key) || deletedMonths.includes(key)) continue;

    // Check matrix override if any
    const overrides = (typeof getStoredMatrixOverrides === 'function') ? getStoredMatrixOverrides() : (fNotes.matrix_overrides || {});
    const ovKey = `${famId}_${mName}_2026`;
    const ovVal = overrides[ovKey];
    const isPaidOv = ovVal && (ovVal.status === 'paid' || ovVal === 'paid');

    rows.push({
      recordId: `AUTO-${famId}-${mName}-2026`,
      paymentMethod: defaultMethod,
      month: mName,
      year: 2026,
      monthDisplay: `${mName.slice(0, 3)} 2026`,
      paidDate: isPaidOv ? (ovVal.date || `2026-${String(mIdx + 1).padStart(2, '0')}-05`) : '--',
      feeAmount: agreedFee,
      currency: currency,
      status: isPaidOv ? 'PAID' : 'UNPAID',
      reason: 'Monthly Tuition Fee',
      description: '',
      isManualInvoice: false,
      rawRecord: null
    });
  }

  // Sort rows chronologically descending
  const mOrder = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
  rows.sort((a, b) => {
    const yDiff = (Number(b.year) || 2026) - (Number(a.year) || 2026);
    if (yDiff !== 0) return yDiff;
    const mA = mOrder[String(a.month || '').toLowerCase()] || 0;
    const mB = mOrder[String(b.month || '').toLowerCase()] || 0;
    if (mB !== mA) return mB - mA;
    return String(b.paidDate || '').localeCompare(String(a.paidDate || ''));
  });

  const currentMonthPaid = rows.some(r => String(r.month).toLowerCase() === 'september' && r.status === 'PAID');

  return {
    currency,
    monthlyFee: agreedFee,
    rows,
    currentMonthPaid
  };
}

// ============================================================================
// MAIN ENTRYPOINT: FULL-SCREEN MODERN FAMILY PROFILE WORKSPACE
// ============================================================================
async function openFamily360Profile(familyId, initialTab = 'students', skipHistoryPush = false, options = {}) {
  if (!familyId) return;

  _activateFullScreenProfilePage('family');
  const workspace = document.getElementById('unified360PageWorkspace');
  if (!workspace) return;

  const famKey = String(familyId).toUpperCase();
  const validTabs = ['students', 'payments', 'manager_notes', 'teacher_notes', 'biodata'];
  const activeTab = validTabs.includes(initialTab) ? initialTab : 'students';

  // 1. Try resolving Family & Students synchronously from memory first (0ms latency!)
  let family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey) ||
               (window.RAW_ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey);

  if (!family) {
    workspace.innerHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-14 text-center text-slate-500 shadow-2xs">
        <i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-600 mb-3 block"></i>
        <span class="text-sm font-extrabold text-slate-700">Loading Family Profile Workspace...</span>
      </div>
    `;
    const [singleRes] = await Promise.all([
      db.from('families').select('*, students(*)').eq('id', familyId).maybeSingle(),
      _ensure360CoreDataReady()
    ]);
    family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey) || singleRes?.data;
    if (family && Array.isArray(window.ALL_FAMILIES) && !window.ALL_FAMILIES.some(f => String(f.id).toUpperCase() === famKey)) {
      window.ALL_FAMILIES.push(family);
    }
  }

  if (!family) {
    workspace.innerHTML = `
      ${_buildTopWorkspaceNavHtml()}
      <div class="bg-white rounded-2xl border border-rose-200 p-12 text-center text-rose-600 font-bold">
        Family record (${_esc360(familyId)}) could not be found in the database.
      </div>
    `;
    return;
  }

  // Retrieve all connected Students for this Family (from ALL_STUDENTS or nested family.students)
  let familyStudents = (window.ALL_STUDENTS || []).filter(s =>
    String(s.family_id || '').toUpperCase() === famKey &&
    String(s.status || '').toLowerCase() !== 'trial'
  );
  if (familyStudents.length === 0 && Array.isArray(family.students) && family.students.length > 0) {
    familyStudents = family.students.filter(s => String(s.status || '').toLowerCase() !== 'trial');
  }

  const hasExplicitStudent = Boolean(options.selectedStudentId);
  let selectedStudentId = options.selectedStudentId || _CURRENT_360_STATE.selectedStudentId;
  if (!selectedStudentId || !familyStudents.some(s => String(s.id).toUpperCase() === String(selectedStudentId).toUpperCase())) {
    selectedStudentId = familyStudents[0]?.id || null;
  }
  const studentSubView = options.studentSubView || _CURRENT_360_STATE.studentSubView || 'history';

  _CURRENT_360_STATE.type = 'family';
  _CURRENT_360_STATE.id = family.id;
  _CURRENT_360_STATE.activeTab = activeTab;
  _CURRENT_360_STATE.selectedStudentId = selectedStudentId;
  _CURRENT_360_STATE.studentSubView = studentSubView;
  _CURRENT_360_STATE.studentDrawerOpen = hasExplicitStudent;

  if (!skipHistoryPush) {
    _push360History('family', family.id, `${family.parent_name} (${family.id})`, activeTab);
  }

  const studentIds = familyStudents.map(s => s.id);
  const studentIdSet = new Set(studentIds.map(id => String(id).toUpperCase()));

  // 2. Resolve Schedules & Logs immediately from cache or global ALL_CLASS_SCHEDULES
  const cachedEntry = _FAMILY_360_MEM_CACHE[famKey];
  const initialSchedules = cachedEntry?.famSchedules ||
    (Array.isArray(window.ALL_CLASS_SCHEDULES) && window.ALL_CLASS_SCHEDULES.length > 0
      ? window.ALL_CLASS_SCHEDULES.filter(sc => studentIdSet.has(String(sc.student_id || '').toUpperCase()))
      : []);
  const initialLogs = cachedEntry?.famLogs || [];

  window._LAST_FAMILY_360_CACHE = {
    family,
    familyStudents,
    famSchedules: initialSchedules,
    famLogs: initialLogs
  };

  // Render Family Workspace DOM immediately (< 5ms, zero loading spinner!)
  _renderFamilyWorkspaceDOM();

  // 3. Background refresh of attendance logs & schedules if cache is older than 30s or forceRefresh is requested
  const isCacheFresh = cachedEntry && !options.forceRefresh && (Date.now() - cachedEntry.ts < 30000);
  if (isCacheFresh || studentIds.length === 0) {
    return;
  }

  try {
    const needScheduleFetch = options.forceRefresh || !Array.isArray(window.ALL_CLASS_SCHEDULES) || window.ALL_CLASS_SCHEDULES.length === 0;
    const [schedRes, logsRes] = await Promise.all([
      needScheduleFetch
        ? db.from('class_schedules').select('*, teachers(*)').in('student_id', studentIds)
        : Promise.resolve({ data: initialSchedules }),
      db.from('attendance_logs').select('*').in('student_id', studentIds).order('date', { ascending: false }).limit(120)
    ]);

    const famSchedules = schedRes.data || initialSchedules;
    const famLogs = logsRes.data || [];

    _FAMILY_360_MEM_CACHE[famKey] = {
      famSchedules,
      famLogs,
      ts: Date.now()
    };

    if (_CURRENT_360_STATE.type === 'family' && String(_CURRENT_360_STATE.id).toUpperCase() === famKey) {
      window._LAST_FAMILY_360_CACHE = {
        family,
        familyStudents,
        famSchedules,
        famLogs
      };
      _renderFamilyWorkspaceDOM();
    }
  } catch (err) {
    console.warn('[Family Workspace] Background sync notice:', err);
  }
}

/**
 * Switch between the 5 required Family Tabs without reloading from network
 */
function switchFamilyWorkspaceTab(tabId) {
  const validTabs = ['students', 'payments', 'manager_notes', 'teacher_notes', 'biodata'];
  if (!validTabs.includes(tabId)) return;
  _CURRENT_360_STATE.activeTab = tabId;
  _renderFamilyWorkspaceDOM();
}

/**
 * Select a Student inside the Family Profile (NO separate Student Profile page!)
 * Clicking the same active subView again collapses the inline detail drawer for a clean table view.
 */
function selectStudentInFamilyProfile(familyId, studentId, subView = 'history') {
  if (
    _CURRENT_360_STATE.selectedStudentId === studentId &&
    _CURRENT_360_STATE.studentSubView === subView &&
    _CURRENT_360_STATE.studentDrawerOpen === true
  ) {
    _CURRENT_360_STATE.studentDrawerOpen = false;
    _renderFamilyWorkspaceDOM();
    return;
  }
  _CURRENT_360_STATE.selectedStudentId = studentId;
  _CURRENT_360_STATE.studentSubView = subView || 'history';
  _CURRENT_360_STATE.studentDrawerOpen = true;
  _CURRENT_360_STATE.activeTab = 'students';
  _renderFamilyWorkspaceDOM();

  setTimeout(() => {
    const detailPanel = document.getElementById('familySelectedStudentWorkspace');
    if (detailPanel) {
      detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 60);
}

function closeSelectedStudentDrawer() {
  _CURRENT_360_STATE.studentDrawerOpen = false;
  _renderFamilyWorkspaceDOM();
}

/**
 * Render the Complete Modern Full-Screen Family Workspace DOM (Well-Settled & Symmetrical)
 */
function _renderFamilyWorkspaceDOM() {
  const workspace = document.getElementById('unified360PageWorkspace');
  const cache = window._LAST_FAMILY_360_CACHE;
  if (!workspace || !cache || !cache.family) return;

  const { family, familyStudents, famSchedules, famLogs } = cache;
  const activeTab = _CURRENT_360_STATE.activeTab || 'students';
  const selectedStudentId = _CURRENT_360_STATE.selectedStudentId;
  const studentSubView = _CURRENT_360_STATE.studentSubView || 'history';

  const fNotes = _parseFamilyStructuredNotes(family);
  const bioMeta = fNotes.bio_meta || {};
  const creds = (typeof getParentCreds === 'function') ? getParentCreds(family) : { username: 'parent_' + family.id, password: '123456' };
  const payData = _getFamilyPaymentsList(family);

  const regDate = bioMeta.joining_date || (family.created_at ? family.created_at.slice(0, 10) : '2026-02-05');
  const famStatus = String(family.status || 'Active').toUpperCase();
  const displayStatusLabel = (famStatus === 'ACTIVE' || famStatus === 'REGULAR') ? 'REGULAR' : famStatus;

  const statusBadgeStyle = (displayStatusLabel === 'REGULAR')
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
    : (displayStatusLabel === 'ON LEAVE' || displayStatusLabel === 'LEAVE')
    ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
    : 'bg-rose-500/20 text-rose-300 border-rose-400/40';

  const invoiceSentThisMonth = Boolean(bioMeta.last_invoice_sent_month === 'September 2026' || payData.currentMonthPaid);
  const displayEmail = (window.CURRENT_ROLE === 'manager' && typeof maskStudentEmail === 'function')
    ? maskStudentEmail(family.parent_email || family.email || '')
    : (family.parent_email || family.email || 'Not Provided');

  const managerNotesCount = (fNotes.manager_notes || []).length;
  const teacherNotesList = _collectAllFamilyTeacherNotes(family, familyStudents, famLogs);
  const teacherNotesCount = teacherNotesList.length;

  const navTabs = [
    { id: 'students',      label: 'Students',        icon: 'fa-user-graduate',   count: familyStudents.length },
    { id: 'payments',      label: 'Payments',        icon: 'fa-credit-card',     count: payData.rows.length },
    { id: 'manager_notes', label: "Manager's Notes", icon: 'fa-clipboard-list',  count: managerNotesCount },
    { id: 'teacher_notes', label: "Teacher's Notes", icon: 'fa-chalkboard-user', count: teacherNotesCount },
    { id: 'biodata',       label: 'Bio Data',        icon: 'fa-id-card',         count: null }
  ];

  let activeSectionHtml = '';
  if (activeTab === 'students') {
    activeSectionHtml = _buildFamilyStudentsTabHtml(family, familyStudents, famSchedules, famLogs, selectedStudentId, studentSubView);
  } else if (activeTab === 'payments') {
    activeSectionHtml = _buildFamilyPaymentsTabHtml(family, payData);
  } else if (activeTab === 'manager_notes') {
    activeSectionHtml = _buildFamilyManagerNotesTabHtml(family, fNotes);
  } else if (activeTab === 'teacher_notes') {
    activeSectionHtml = _buildFamilyTeacherNotesTabHtml(family, familyStudents, teacherNotesList);
  } else if (activeTab === 'biodata') {
    activeSectionHtml = _buildFamilyBioDataTabHtml(family, fNotes, creds);
  }

  // Bottom Family-Level Actions Bar (Section #15)
  const isFamInactive = famStatus === 'INACTIVE' || famStatus === 'DEACTIVATED';
  const isFamOnLeave = famStatus === 'ON LEAVE' || famStatus === 'LEAVE';
  const isFamSuspended = famStatus === 'SUSPENDED' || Boolean(bioMeta.classes_suspended);

  const bottomFamilyActionsHtml = `
    <div class="bg-slate-50 border-t border-slate-200 px-4 sm:px-6 py-4 grid grid-cols-2 sm:flex sm:items-center sm:justify-center gap-2.5 sm:gap-3 sm:flex-wrap">
      <button onclick="handleFamilyLevelDeactivate('${_esc360(family.id)}')"
              class="h-9 px-3 sm:px-5 rounded-xl font-extrabold text-xs text-white shadow-xs transition inline-flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap cursor-pointer ${isFamInactive ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}">
        <i class="fa-solid ${isFamInactive ? 'fa-user-check' : 'fa-ban'}"></i>
        <span class="truncate">${isFamInactive ? 'Activate Family' : 'Deactivate'}</span>
      </button>

      <button onclick="handleFamilyLevelLeave('${_esc360(family.id)}')"
              class="h-9 px-3 sm:px-5 rounded-xl font-extrabold text-xs text-white bg-sky-600 hover:bg-sky-700 shadow-xs transition inline-flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap cursor-pointer">
        <i class="fa-solid fa-calendar-pause"></i>
        <span class="truncate">${isFamOnLeave ? 'Return from Leave' : 'Make on Leave'}</span>
      </button>

      <button onclick="handleFamilyLevelSuspendClasses('${_esc360(family.id)}')"
              class="h-9 px-3 sm:px-5 rounded-xl font-extrabold text-xs text-white ${isFamSuspended ? 'bg-teal-600 hover:bg-teal-700' : 'bg-rose-700 hover:bg-rose-800'} shadow-xs transition inline-flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap cursor-pointer">
        <i class="fa-solid ${isFamSuspended ? 'fa-play' : 'fa-pause-circle'}"></i>
        <span class="truncate">${isFamSuspended ? 'Unsuspend Classes' : 'Suspend Classes'}</span>
      </button>

      <button onclick="openEditFamilyProfileModal('${_esc360(family.id)}')"
              class="h-9 px-3 sm:px-5 rounded-xl font-extrabold text-xs text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition inline-flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap cursor-pointer">
        <i class="fa-solid fa-pen-to-square"></i>
        <span class="truncate">Edit Profile</span>
      </button>
    </div>
  `;

  workspace.innerHTML = `
    ${_buildTopWorkspaceNavHtml()}

    <!-- WELL-SETTLED MODERN FULL-SCREEN FAMILY WORKSPACE CARD -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

      <!-- CENTERED, BALANCED & SYMMETRICAL FAMILY HEADER BANNER -->
      <div class="bg-gradient-to-b from-slate-900 via-slate-900 to-indigo-950 text-white px-4 sm:px-6 pt-5 sm:pt-6 pb-0">
        <div class="max-w-4xl mx-auto flex flex-col items-center text-center space-y-3.5 pb-5">

          <!-- Row 1: Avatar + Family Name + Registration Date + Family ID -->
          <div class="flex flex-col items-center max-w-full">
            <div class="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-white/10 border-2 border-white/20 flex items-center justify-center text-2xl font-black text-amber-400 shadow-md mb-2 shrink-0">
              ${_esc360((family.parent_name || 'F').charAt(0).toUpperCase())}
            </div>
            <div class="flex items-center justify-center gap-2 sm:gap-2.5 flex-wrap max-w-full px-2">
              <h1 class="text-lg sm:text-2xl font-black tracking-tight text-white capitalize break-words">${_esc360(family.parent_name)}</h1>
              <span class="px-2.5 py-0.5 rounded-md bg-white/10 border border-white/20 font-mono text-xs font-extrabold text-slate-200 whitespace-nowrap">${_esc360(family.id)}</span>
            </div>
            <div class="text-xs font-mono text-slate-300 mt-0.5">${_esc360(regDate)}</div>
          </div>

          <!-- Row 2: Single-Line Status & Billing Summary Strip (No redundant 'Not Provided' email badge) -->
          <div class="flex items-center justify-center gap-1.5 sm:gap-2 flex-wrap max-w-full">
            <span class="px-2.5 sm:px-3 py-1 rounded-md border text-[11px] font-black uppercase tracking-wider whitespace-nowrap ${statusBadgeStyle}">
              ${_esc360(displayStatusLabel)}
            </span>
            ${(Boolean(fNotes.converted_to_regular) || Boolean(fNotes.trial_history?.was_trial) || String(family.notes || '').includes('Converted from Trial')) ? `<span class="px-2.5 sm:px-3 py-1 rounded-md bg-purple-500/20 text-purple-200 border border-purple-400/30 text-[11px] font-extrabold uppercase whitespace-nowrap" title="Originally enrolled via 3-Day Trial and converted to Regular Family"><i class="fa-solid fa-graduation-cap mr-1"></i>CONVERTED FROM TRIAL</span>` : ''}
            ${isFamSuspended ? `<span class="px-2.5 sm:px-3 py-1 rounded-md bg-rose-600 text-white text-[11px] font-black uppercase whitespace-nowrap">CLASSES SUSPENDED</span>` : ''}
            <span class="px-2.5 sm:px-3 py-1 rounded-md ${invoiceSentThisMonth ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300 border border-slate-700'} text-[11px] font-black uppercase tracking-wide whitespace-nowrap">
              INVOICE ${invoiceSentThisMonth ? '✓' : 'PENDING'}
            </span>
            <span class="px-2.5 sm:px-3 py-1 rounded-md bg-sky-500/20 text-sky-200 border border-sky-400/30 text-[11px] font-extrabold uppercase whitespace-nowrap">
              FEE &bull; ${_esc360(family.currency || 'USD')} ${_esc360(family.monthly_fee || 0)}
            </span>
            ${(displayEmail && displayEmail !== 'Not Provided') ? `
              <span class="px-2.5 sm:px-3 py-1 rounded-md bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 text-[11px] font-bold whitespace-nowrap max-w-[230px] sm:max-w-[300px] truncate" title="${_esc360(displayEmail)}">
                <i class="fa-regular fa-envelope mr-1"></i> ${_esc360(displayEmail)}
              </span>
            ` : ''}
          </div>

          <!-- Row 3: Symmetrical 2x2 Grid on Mobile / Single Row on Desktop for 4 Family Action Buttons -->
          <div class="grid grid-cols-2 sm:flex sm:items-center sm:justify-center gap-2 sm:gap-2.5 w-full sm:w-auto pt-1">
            <button onclick="openFamilyAddStudentModal('${_esc360(family.id)}')"
                    class="h-9 px-3 sm:px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold transition shadow-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-user-plus"></i>
              <span>Add Student</span>
            </button>

            <button onclick="openFamilySendInvoiceModal('${_esc360(family.id)}')"
                    class="h-9 px-3 sm:px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold transition shadow-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-file-invoice-dollar"></i>
              <span>Send Invoice</span>
            </button>

            <button onclick="openFamilyCustomEmailModal('${_esc360(family.id)}')"
                    class="h-9 px-3 sm:px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-extrabold transition shadow-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-paper-plane"></i>
              <span>Send Email</span>
            </button>

            <button onclick="openFamilyManualInvoiceModal('${_esc360(family.id)}')"
                    class="h-9 px-3 sm:px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-extrabold transition shadow-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-file-circle-plus"></i>
              <span>Manual Invoice</span>
            </button>
          </div>
        </div>

        <!-- Row 4: 5-Tab Navigation Bar (justify-start on mobile so 'Students' tab is never clipped off left edge!) -->
        <div class="flex items-center justify-start sm:justify-center gap-1.5 pt-2 overflow-x-auto no-scrollbar border-t border-white/10 px-1">
          ${navTabs.map(t => {
            const isActive = activeTab === t.id;
            return `
              <button onclick="switchFamilyWorkspaceTab('${t.id}')"
                      class="px-3.5 sm:px-5 py-2.5 rounded-t-xl text-xs font-extrabold transition inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap cursor-pointer shrink-0 ${
                        isActive
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white'
                      }">
                <i class="fa-solid ${t.icon} ${isActive ? 'text-indigo-600' : 'text-slate-400'}"></i>
                <span>${_esc360(t.label)}</span>
                ${t.count !== null ? `
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] font-black ${isActive ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-700 text-slate-300'}">
                    ${t.count}
                  </span>
                ` : ''}
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <!-- ACTIVE TAB WORKSPACE CONTENT AREA -->
      <div class="bg-white">
        ${activeSectionHtml}
      </div>

      <!-- BOTTOM FAMILY-LEVEL ACTIONS BAR (Section #15) -->
      ${bottomFamilyActionsHtml}
    </div>

    <!-- DEDICATED ACTION MODAL CONTAINER FOR FAMILY WORKSPACE OPERATIONS -->
    <div id="familyWorkspaceActionModal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[9990] hidden items-center justify-center p-4"></div>
  `;
}

// ============================================================================
// TAB 1: STUDENTS TAB + CLEAN, SETTLED INLINE STUDENT WORKSPACE
// ============================================================================
function _buildFamilyStudentsTabHtml(family, familyStudents, famSchedules, famLogs, selectedStudentId, studentSubView) {
  if (!familyStudents || familyStudents.length === 0) {
    return `
      <div class="p-14 text-center">
        <div class="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center text-xl mx-auto mb-3">
          <i class="fa-solid fa-user-graduate"></i>
        </div>
        <h3 class="text-base font-extrabold text-slate-800">No Students Enrolled in This Family Yet</h3>
        <p class="text-xs text-slate-500 mt-1 max-w-md mx-auto">Click "Add Student" to enroll the first child under ${_esc360(family.parent_name)}'s family profile.</p>
        <button onclick="openFamilyAddStudentModal('${_esc360(family.id)}')"
                class="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold transition inline-flex items-center gap-2">
          <i class="fa-solid fa-user-plus"></i> Add Student to Family
        </button>
      </div>
    `;
  }

  const selectedStudent = familyStudents.find(s => String(s.id).toUpperCase() === String(selectedStudentId).toUpperCase()) || familyStudents[0];
  const isDrawerOpen = _CURRENT_360_STATE.studentDrawerOpen !== false;

  const rowsHtml = familyStudents.map((stu, idx) => {
    const isSelected = isDrawerOpen && selectedStudent && String(stu.id).toUpperCase() === String(selectedStudent.id).toUpperCase();
    const stuMeta = _parseStudentStructuredNotes(stu);
    const certCount = (stuMeta.certificates || []).length;

    const assignedTeacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(stu.assigned_teacher_id));
    const teacherName = assignedTeacher ? assignedTeacher.full_name : 'Assign Teacher';

    const rawStatus = String(stu.status || 'Active');
    const stLower = rawStatus.toLowerCase();
    const isDeactivated = stLower === 'inactive' || stLower === 'deactivated';
    const isOnLeave = stLower === 'leave' || stLower === 'on leave' || Boolean(stuMeta.on_leave);

    const statusDot = isDeactivated
      ? `<span class="inline-block w-2 h-2 rounded-full bg-rose-500" title="Deactivated"></span>`
      : isOnLeave
      ? `<span class="inline-block w-2 h-2 rounded-full bg-amber-500" title="On Leave"></span>`
      : `<i class="fa-solid fa-check text-emerald-600 text-xs"></i>`;

    const statusBadge = isDeactivated
      ? `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">Deactivated</span>`
      : isOnLeave
      ? `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">On Leave</span>`
      : `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap">Active</span>`;

    return `
      <tr class="border-b border-slate-200/80 transition ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50/80'}">
        <!-- # -->
        <td class="px-4 py-3.5 w-14 align-middle">
          <span class="inline-flex items-center justify-center w-6 h-6 rounded-md font-mono text-xs font-black ${isSelected ? 'bg-indigo-600 text-white' : 'bg-amber-400 text-slate-900'}">
            ${idx + 1}
          </span>
        </td>

        <!-- Student Name (Clickable — selects Student inside Family Profile) -->
        <td class="px-4 py-3.5 align-middle">
          <div class="flex items-center gap-2 flex-nowrap">
            <button onclick="selectStudentInFamilyProfile('${_esc360(family.id)}', '${_esc360(stu.id)}', 'info')"
                    class="font-extrabold text-xs sm:text-sm ${isSelected ? 'text-indigo-900 underline' : 'text-slate-900 hover:text-indigo-700 hover:underline'} inline-flex items-center gap-1.5 text-left whitespace-nowrap cursor-pointer">
              ${statusDot}
              <span>${_esc360(stu.name)}</span>
            </button>
            ${statusBadge}
            <span class="text-[11px] font-mono text-slate-400 whitespace-nowrap">(${_esc360(stu.id)})</span>
          </div>
        </td>

        <!-- History -->
        <td class="px-4 py-3.5 align-middle">
          <button onclick="selectStudentInFamilyProfile('${_esc360(family.id)}', '${_esc360(stu.id)}', 'history')"
                  class="px-3 py-1 rounded-lg font-extrabold text-xs transition whitespace-nowrap cursor-pointer ${isSelected && studentSubView === 'history' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-indigo-700 hover:bg-indigo-50 hover:underline'}">
            Progress
          </button>
        </td>

        <!-- Reports -->
        <td class="px-4 py-3.5 align-middle">
          <button onclick="selectStudentInFamilyProfile('${_esc360(family.id)}', '${_esc360(stu.id)}', 'report')"
                  class="px-3 py-1 rounded-lg font-extrabold text-xs transition whitespace-nowrap cursor-pointer ${isSelected && studentSubView === 'report' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-indigo-700 hover:bg-indigo-50 hover:underline'}">
            Report
          </button>
        </td>

        <!-- Teacher -->
        <td class="px-4 py-3.5 align-middle">
          ${assignedTeacher ? `
            <button onclick="openTeacherScheduleFromFamily('${_esc360(assignedTeacher.id)}', '${_esc360(stu.id)}')"
                    class="font-extrabold text-xs text-indigo-700 hover:text-indigo-950 hover:underline inline-flex items-center gap-1.5 text-left whitespace-nowrap cursor-pointer"
                    title="Click to open Teacher Schedule">
              <span>${_esc360(teacherName)}</span>
            </button>
          ` : `
            <button onclick="openEditSingleStudentModal('${_esc360(family.id)}', '${_esc360(stu.id)}')"
                    class="text-xs font-bold text-amber-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-user-plus"></i> Assign Teacher
            </button>
          `}
        </td>

        <!-- Certificate -->
        <td class="px-4 py-3.5 align-middle">
          <div class="inline-flex items-center gap-1.5 flex-nowrap">
            <button onclick="openIssueStudentCertificateModal('${_esc360(family.id)}', '${_esc360(stu.id)}')"
                    class="w-7 h-7 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 inline-flex items-center justify-center text-xs font-black transition cursor-pointer"
                    title="Issue New Certificate for ${_esc360(stu.name)}">
              <i class="fa-solid fa-plus"></i>
            </button>
            <button onclick="selectStudentInFamilyProfile('${_esc360(family.id)}', '${_esc360(stu.id)}', 'certificates')"
                    class="px-2.5 h-7 rounded-lg border ${isSelected && studentSubView === 'certificates' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'} inline-flex items-center gap-1 text-xs font-extrabold transition whitespace-nowrap cursor-pointer"
                    title="View Certificates (${certCount})">
              <span>${certCount > 0 ? `${certCount} Cert` : '•••'}</span>
            </button>
          </div>
        </td>

        <!-- Student-Only Actions -->
        <td class="px-4 py-3.5 text-right align-middle">
          <div class="inline-flex items-center justify-end gap-1.5 flex-nowrap">
            <!-- 1. Yellow Edit Student Information -->
            <button onclick="openEditSingleStudentModal('${_esc360(family.id)}', '${_esc360(stu.id)}')"
                    class="w-8 h-8 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 inline-flex items-center justify-center transition cursor-pointer"
                    title="Edit ONLY ${_esc360(stu.name)}'s Student Information">
              <i class="fa-regular fa-pen-to-square"></i>
            </button>

            <!-- 2. Student-Only Leave Toggle -->
            <button onclick="toggleSingleStudentLeave('${_esc360(family.id)}', '${_esc360(stu.id)}')"
                    class="w-8 h-8 rounded-lg border ${isOnLeave ? 'border-amber-500 bg-amber-500 text-white' : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700'} inline-flex items-center justify-center transition cursor-pointer"
                    title="${isOnLeave ? `Resume ${_esc360(stu.name)} from Leave` : `Put ONLY ${_esc360(stu.name)} On Leave`}">
              <i class="fa-regular fa-clock"></i>
            </button>

            <!-- 3. Student Timetable & Teacher Slot -->
            <button onclick="${assignedTeacher ? `openTeacherScheduleFromFamily('${_esc360(assignedTeacher.id)}', '${_esc360(stu.id)}')` : `openEditSingleStudentModal('${_esc360(family.id)}', '${_esc360(stu.id)}')`}"
                    class="w-8 h-8 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 inline-flex items-center justify-center transition cursor-pointer"
                    title="View / Manage ${_esc360(stu.name)}'s Class Timetable">
              <i class="fa-regular fa-calendar-check"></i>
            </button>

            <!-- 4. Red Deactivate This Student Only -->
            <button onclick="toggleSingleStudentDeactivate('${_esc360(family.id)}', '${_esc360(stu.id)}')"
                    class="w-8 h-8 rounded-lg border ${isDeactivated ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700'} inline-flex items-center justify-center transition cursor-pointer"
                    title="${isDeactivated ? `Reactivate ${_esc360(stu.name)} Only` : `Deactivate ONLY ${_esc360(stu.name)}`}">
              <i class="fa-solid ${isDeactivated ? 'fa-user-check' : 'fa-user-xmark'}"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const selectedDetailHtml = (selectedStudent && isDrawerOpen)
    ? _buildSelectedStudentWorkspaceHtml(family, selectedStudent, famSchedules, famLogs, studentSubView)
    : '';

  return `
    <div>
      <!-- CLEAN SETTLED STUDENTS TABLE -->
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200 text-[11px] uppercase tracking-wider">
            <tr>
              <th class="px-4 py-3.5 w-14">#</th>
              <th class="px-4 py-3.5">Name</th>
              <th class="px-4 py-3.5">History</th>
              <th class="px-4 py-3.5">Reports</th>
              <th class="px-4 py-3.5">Teacher</th>
              <th class="px-4 py-3.5">Certificate</th>
              <th class="px-4 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <!-- UNIFIED SINGLE-CARD SELECTED STUDENT DRAWER (Well-Settled, Zero Wrapping Clutter) -->
      ${selectedDetailHtml ? `
        <div id="familySelectedStudentWorkspace" class="px-6 py-5 bg-slate-50/70 border-t border-slate-200">
          ${selectedDetailHtml}
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Build the Selected Student's Detailed Sub-Workspace inside ONE Single Settled Card
 */
function _buildSelectedStudentWorkspaceHtml(family, student, famSchedules, famLogs, subView) {
  const stuId = student.id;
  const stuLogs = (famLogs || []).filter(l => String(l.student_id).toUpperCase() === String(stuId).toUpperCase());
  const stuSchedules = (famSchedules || []).filter(sc => String(sc.student_id).toUpperCase() === String(stuId).toUpperCase());
  const assignedTeacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(student.assigned_teacher_id));
  const stuMeta = _parseStudentStructuredNotes(student);

  const totalLogs = stuLogs.length;
  const presentLogs = stuLogs.filter(l => String(l.status || '').toLowerCase() === 'present');
  const absentLogs = stuLogs.filter(l => String(l.status || '').toLowerCase() === 'absent');
  const leaveLogs = stuLogs.filter(l => String(l.status || '').toLowerCase() === 'leave');

  const attendedCount = presentLogs.length;
  const missedCount = absentLogs.length;
  const leaveCount = leaveLogs.length;
  const attendancePct = totalLogs > 0 ? Math.round((attendedCount / totalLogs) * 100) : 100;

  // Compact single-line sub-tabs so they NEVER wrap onto 2 rows
  const subNavItems = [
    { id: 'history',      label: 'Attendance & Daily Lessons', icon: 'fa-calendar-check' },
    { id: 'report',       label: 'Progress Report',            icon: 'fa-chart-line' },
    { id: 'certificates', label: `Certificates (${(stuMeta.certificates || []).length})`, icon: 'fa-award' },
    { id: 'info',         label: 'Student Info',               icon: 'fa-user-gear' }
  ];

  let bodyHtml = '';

  // SUB-VIEW 1: STUDENT HISTORY / ATTENDANCE & DAILY LESSONS
  if (subView === 'history') {
    const filterStatus = _CURRENT_360_STATE.attFilterStatus || 'all';
    const filteredLogs = stuLogs.filter(l => {
      if (filterStatus === 'all') return true;
      return String(l.status || '').toLowerCase() === filterStatus.toLowerCase();
    });

    const selectedDate = _CURRENT_360_STATE.selectedLessonDate || (stuLogs[0]?.date || null);
    const activeLessonLog = stuLogs.find(l => l.date === selectedDate) || stuLogs[0] || null;

    bodyHtml = `
      <div class="p-5 space-y-4">
        <!-- Compact 4-Box Attendance Strip -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500">Attended</span>
            <strong class="text-base font-black text-emerald-700">${attendedCount}</strong>
          </div>
          <div class="bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500">Missed</span>
            <strong class="text-base font-black text-rose-600">${missedCount}</strong>
          </div>
          <div class="bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500">On Leave</span>
            <strong class="text-base font-black text-amber-600">${leaveCount}</strong>
          </div>
          <div class="bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500">Attendance Rate</span>
            <strong class="text-base font-black text-indigo-700">${attendancePct}%</strong>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <!-- Attendance & Daily Lessons Table -->
          <div class="lg:col-span-2 rounded-xl border border-slate-200 overflow-hidden">
            <div class="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-1.5">
                ${['all', 'Present', 'Absent', 'Leave'].map(st => `
                  <button onclick="filterStudentAttendanceInFamily('${st}')"
                          class="px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition cursor-pointer ${filterStatus === st ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}">
                    ${st === 'all' ? 'All Dates' : st}
                  </button>
                `).join('')}
              </div>
              <button onclick="openRecordDailyLessonModal('${_esc360(family.id)}', '${_esc360(student.id)}')"
                      class="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold transition cursor-pointer inline-flex items-center gap-1 whitespace-nowrap">
                <i class="fa-solid fa-plus"></i> Record Attendance / Lesson
              </button>
            </div>

            ${filteredLogs.length === 0 ? `
              <div class="p-8 text-center text-slate-400 text-xs">
                No attendance records found for this student yet.
              </div>
            ` : `
              <div class="overflow-x-auto max-h-72 overflow-y-auto">
                <table class="w-full text-left text-xs border-collapse">
                  <thead class="bg-slate-50 text-slate-600 font-extrabold border-b border-slate-200 sticky top-0">
                    <tr>
                      <th class="px-3.5 py-2.5">Date</th>
                      <th class="px-3.5 py-2.5">Status</th>
                      <th class="px-3.5 py-2.5">Teacher's Recorded Lesson</th>
                      <th class="px-3.5 py-2.5 text-right">View</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    ${filteredLogs.map(log => {
                      const parsedLesson = _parseLessonDetails360(log);
                      const isActiveDate = activeLessonLog && activeLessonLog.date === log.date;
                      const st = String(log.status || 'Present');
                      const badgeCls = st.toLowerCase() === 'present'
                        ? 'bg-emerald-100 text-emerald-800'
                        : st.toLowerCase() === 'absent'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800';

                      return `
                        <tr onclick="selectStudentLessonDateInFamily('${_esc360(log.date)}')"
                            class="cursor-pointer transition ${isActiveDate ? 'bg-indigo-50/70 font-bold' : 'hover:bg-slate-50'}">
                          <td class="px-3.5 py-2.5 font-mono font-bold text-slate-800 whitespace-nowrap">${_esc360(log.date)}</td>
                          <td class="px-3.5 py-2.5 whitespace-nowrap">
                            <span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${badgeCls}">${_esc360(st)}</span>
                          </td>
                          <td class="px-3.5 py-2.5 text-slate-700 truncate max-w-xs">
                            ${parsedLesson.hasLesson ? _esc360(parsedLesson.summaryTitle) : '<span class="text-slate-400 italic">No lesson recorded</span>'}
                          </td>
                          <td class="px-3.5 py-2.5 text-right whitespace-nowrap">
                            <span class="text-indigo-600 font-extrabold text-[11px] hover:underline">Open</span>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>

          <!-- Selected Date Lesson Inspector -->
          <div class="rounded-xl border border-slate-200 bg-slate-50/60 p-4 flex flex-col justify-between">
            ${activeLessonLog ? (() => {
              const p = _parseLessonDetails360(activeLessonLog);
              return `
                <div class="space-y-2.5 text-xs">
                  <div class="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span class="font-mono font-black text-slate-900">${_esc360(activeLessonLog.date)}</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${String(activeLessonLog.status).toLowerCase() === 'present' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
                      ${_esc360(activeLessonLog.status || 'Present')}
                    </span>
                  </div>
                  ${p.hasLesson ? `
                    <div>
                      <span class="text-[10px] font-bold text-slate-400 uppercase block">Book / Surah / Sabaq</span>
                      <strong class="text-slate-900 block">${_esc360(p.bookTitle || p.summaryTitle)}</strong>
                    </div>
                    <div>
                      <span class="text-[10px] font-bold text-slate-400 uppercase block">Teacher Remarks</span>
                      <p class="text-slate-700 mt-0.5">${_esc360(p.remarks || p.summaryTitle)}</p>
                    </div>
                  ` : `
                    <div class="py-6 text-center text-slate-400">No lesson recorded for ${_esc360(activeLessonLog.date)}.</div>
                  `}
                </div>
                <button onclick="openRecordDailyLessonModal('${_esc360(family.id)}', '${_esc360(student.id)}', '${_esc360(activeLessonLog.date)}')"
                        class="mt-3 w-full py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition cursor-pointer">
                  Update Lesson (${_esc360(activeLessonLog.date)})
                </button>
              `;
            })() : `
              <div class="py-8 text-center text-slate-400 text-xs">
                Click "Record Attendance / Lesson" to log the first session.
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  // SUB-VIEW 2: ACADEMIC PROGRESS REPORT
  else if (subView === 'report') {
    const currentLevel = stuMeta.current_level || student.course_id || 'Noorani Qaida / Nazra Quran';
    const currentSabaq = stuMeta.current_sabaq || (stuLogs[0] ? _parseLessonDetails360(stuLogs[0]).summaryTitle : 'In Progress');
    const teacherEval = stuMeta.overall_evaluation || (attendancePct >= 85 ? 'Excellent Consistency' : 'Needs Regular Attendance');

    bodyHtml = `
      <div class="p-5 space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="text-xs text-slate-600">
            Instructor: <strong class="text-slate-900">${_esc360(assignedTeacher ? assignedTeacher.full_name : 'Not Assigned')}</strong> &bull;
            Course: <strong class="text-emerald-700">${_esc360(student.course_id || 'Quran Studies')}</strong>
          </div>
          <button onclick="openUpdateStudentProgressModal('${_esc360(family.id)}', '${_esc360(student.id)}')"
                  class="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition cursor-pointer">
            <i class="fa-solid fa-pen-to-square mr-1"></i> Update Progress Milestone
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-[10px] font-bold text-slate-400 uppercase block">Current Syllabus / Level</span>
            <strong class="text-sm text-slate-900 block mt-0.5">${_esc360(currentLevel)}</strong>
            <span class="text-slate-500 block mt-0.5">Latest Sabaq: ${_esc360(currentSabaq)}</span>
          </div>
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-[10px] font-bold text-slate-400 uppercase block">Attendance Accuracy</span>
            <strong class="text-sm text-emerald-700 block mt-0.5">${attendancePct}% (${attendedCount} Present / ${missedCount} Missed)</strong>
            <span class="text-slate-500 block mt-0.5">Joined: ${_esc360(student.joining_date || '2026-01-01')}</span>
          </div>
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-[10px] font-bold text-slate-400 uppercase block">Instructor Evaluation</span>
            <strong class="text-sm text-indigo-700 block mt-0.5">${_esc360(teacherEval)}</strong>
            <span class="text-slate-500 block mt-0.5">Certificates Earned: ${(stuMeta.certificates || []).length}</span>
          </div>
        </div>
      </div>
    `;
  }

  // SUB-VIEW 3: STUDENT CERTIFICATES
  else if (subView === 'certificates') {
    const certs = stuMeta.certificates || [];
    bodyHtml = `
      <div class="p-5 space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <span class="text-xs text-slate-600 font-semibold">Official course completion and milestone certificates issued to <strong>${_esc360(student.name)}</strong>.</span>
          <button onclick="openIssueStudentCertificateModal('${_esc360(family.id)}', '${_esc360(student.id)}')"
                  class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap">
            <i class="fa-solid fa-plus"></i> Issue New Certificate
          </button>
        </div>

        ${certs.length === 0 ? `
          <div class="py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
            No certificates have been issued for ${_esc360(student.name)} yet.
          </div>
        ` : `
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            ${certs.map(c => `
              <div class="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40 flex items-center justify-between gap-3">
                <div>
                  <span class="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-black uppercase">${_esc360(c.code || 'CERT')}</span>
                  <h5 class="text-xs font-black text-slate-900 mt-1">${_esc360(c.title)}</h5>
                  <p class="text-[11px] text-slate-600">Date: <strong>${_esc360(c.date)}</strong> &bull; Grade: <strong>${_esc360(c.grade || 'A+')}</strong></p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button onclick="printStudentCertificate360('${_esc360(family.id)}', '${_esc360(student.id)}', '${_esc360(c.id)}')"
                          class="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-extrabold cursor-pointer">
                    Print
                  </button>
                  <button onclick="deleteStudentCertificate360('${_esc360(family.id)}', '${_esc360(student.id)}', '${_esc360(c.id)}')"
                          class="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 inline-flex items-center justify-center cursor-pointer">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  }

  // SUB-VIEW 4: STUDENT INFORMATION & SCHEDULE
  else {
    const scheduleStr = stuSchedules.length > 0
      ? stuSchedules.map(sc => `${_DAY_LABELS_360[sc.day_of_week] || sc.day_of_week} (${(sc.start_time || '').slice(0,5)} - ${(sc.end_time || '').slice(0,5)})`).join(', ')
      : (stuMeta.days_per_week || '5 Days (Mon-Fri)');

    bodyHtml = `
      <div class="p-5 space-y-3">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <span class="text-xs text-slate-600 font-semibold">Individual student details and class schedule for <strong>${_esc360(student.name)}</strong>.</span>
          <button onclick="openEditSingleStudentModal('${_esc360(family.id)}', '${_esc360(student.id)}')"
                  class="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold transition cursor-pointer inline-flex items-center gap-1.5">
            <i class="fa-solid fa-pen-to-square"></i> Edit Student Info
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div class="flex justify-between"><span class="text-slate-500">Student Name:</span> <strong class="text-slate-900">${_esc360(student.name)}</strong></div>
            <div class="flex justify-between"><span class="text-slate-500">Student ID:</span> <strong class="font-mono text-slate-900">${_esc360(student.id)}</strong></div>
            <div class="flex justify-between"><span class="text-slate-500">Age / Gender:</span> <strong class="text-slate-900">${_esc360(student.age || '--')} yrs &bull; ${_esc360(student.gender || '--')}</strong></div>
          </div>
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div class="flex justify-between"><span class="text-slate-500">Course:</span> <strong class="text-emerald-700">${_esc360(student.course_id || 'Quran Studies')}</strong></div>
            <div class="flex justify-between"><span class="text-slate-500">Joining Date:</span> <strong class="font-mono text-slate-900">${_esc360(student.joining_date || '--')}</strong></div>
            <div class="flex justify-between"><span class="text-slate-500">Status:</span> <strong class="text-slate-900">${_esc360(student.status || 'Active')}</strong></div>
          </div>
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div class="flex justify-between">
              <span class="text-slate-500">Teacher:</span>
              ${assignedTeacher
                ? `<button onclick="openTeacherScheduleFromFamily('${_esc360(assignedTeacher.id)}', '${_esc360(student.id)}')" class="text-indigo-700 font-extrabold hover:underline cursor-pointer">${_esc360(assignedTeacher.full_name)}</button>`
                : `<span class="text-slate-400">Not Assigned</span>`
              }
            </div>
            <div class="flex justify-between"><span class="text-slate-500">Schedule:</span> <strong class="text-slate-800 text-right">${_esc360(scheduleStr)}</strong></div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
      <!-- Single Unified Header Bar (Never wraps STU-ID or Sub-Tabs onto messy lines) -->
      <div class="px-4 py-3 bg-slate-900 text-white flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div class="flex items-center gap-2.5 whitespace-nowrap">
          <span class="w-7 h-7 rounded-lg bg-indigo-600 text-white font-black text-xs inline-flex items-center justify-center shrink-0">
            ${_esc360((student.name || 'S').charAt(0).toUpperCase())}
          </span>
          <span class="font-black text-sm text-white">${_esc360(student.name)}</span>
          <span class="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] font-bold text-slate-200 whitespace-nowrap">${_esc360(student.id)}</span>
          <span class="text-xs text-slate-400 hidden sm:inline">&bull; ${_esc360(student.course_id || 'Quran Studies')}</span>
        </div>

        <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          ${subNavItems.map(item => `
            <button onclick="selectStudentInFamilyProfile('${_esc360(family.id)}', '${_esc360(student.id)}', '${item.id}')"
                    class="px-3 py-1.5 rounded-lg text-xs font-extrabold transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                      subView === item.id
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'bg-white/10 hover:bg-white/20 text-slate-200'
                    }">
              <i class="fa-solid ${item.icon}"></i>
              <span>${_esc360(item.label)}</span>
            </button>
          `).join('')}
          <button onclick="closeSelectedStudentDrawer()"
                  class="ml-1 w-7 h-7 rounded-lg bg-white/10 hover:bg-rose-600 text-slate-300 hover:text-white inline-flex items-center justify-center transition shrink-0 cursor-pointer"
                  title="Collapse Student Detail Panel">
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>
      </div>

      ${bodyHtml}
    </div>
  `;
}

function _parseLessonDetails360(log) {
  const raw = log?.lesson_notes || '';
  if (!raw) return { hasLesson: false, summaryTitle: '', remarks: '' };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      const bookTitle = parsed.book_title || parsed.sabaq || parsed.course || 'Daily Quran Lesson';
      const pageStr = parsed.page ? ` • Page ${parsed.page}` : '';
      return {
        hasLesson: true,
        bookTitle,
        page: parsed.page || '',
        lineRange: parsed.line_range || '',
        assessment: parsed.status || parsed.result || 'Completed',
        remarks: parsed.remarks || parsed.notes || '',
        summaryTitle: `${bookTitle}${pageStr}`
      };
    }
  } catch (e) {}
  return {
    hasLesson: true,
    bookTitle: 'Daily Quran Lesson',
    page: '',
    lineRange: '',
    assessment: 'Completed',
    remarks: String(raw),
    summaryTitle: String(raw)
  };
}

function filterStudentAttendanceInFamily(status) {
  _CURRENT_360_STATE.attFilterStatus = status;
  _renderFamilyWorkspaceDOM();
}

function selectStudentLessonDateInFamily(dateStr) {
  _CURRENT_360_STATE.selectedLessonDate = dateStr;
  _renderFamilyWorkspaceDOM();
}

// ============================================================================
// TAB 2: PAYMENTS TAB (Sections #17, #18, #19, #20)
// Clean Modern Payment History — ONLY Payment Method, Month, Paid Date, Fee, Status, Actions
// (Strictly NO "Due", NO "ADJ", NO "AMT" legacy columns!)
// ============================================================================
function _buildFamilyPaymentsTabHtml(family, payData) {
  const rows = payData.rows || [];

  return `
    <div>
      <div class="px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 class="text-sm font-black text-slate-900">Family Payment &amp; Invoice Ledger</h3>
          <p class="text-xs text-slate-500">Connected in real time to the main Fee Management system (Single Source of Truth).</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="openFamilyManualInvoiceModal('${_esc360(family.id)}')"
                  class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition flex items-center gap-1.5 cursor-pointer">
            <i class="fa-solid fa-plus"></i> Add Manual Invoice / Payment
          </button>
        </div>
      </div>

      ${rows.length === 0 ? `
        <div class="p-14 text-center text-slate-400 text-sm">
          No payment records found for this family.
        </div>
      ` : `
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200 uppercase tracking-wider text-[11px]">
              <tr>
                <th class="p-4">Payment Method</th>
                <th class="p-4">Month</th>
                <th class="p-4">Paid Date</th>
                <th class="p-4">Fee</th>
                <th class="p-4">Status</th>
                <th class="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${rows.map(r => {
                const isPaid = r.status === 'PAID';
                return `
                  <tr class="hover:bg-slate-50/80 transition">
                    <!-- 1. Payment Method -->
                    <td class="p-4 font-bold text-emerald-800">
                      <div class="flex items-center gap-2">
                        <i class="fa-solid fa-building-columns text-slate-400"></i>
                        <span>${_esc360(r.paymentMethod)}</span>
                      </div>
                      ${r.reason && r.reason !== 'Monthly Tuition Fee' ? `<span class="text-[10px] text-indigo-600 font-bold block mt-0.5">${_esc360(r.reason)}</span>` : ''}
                    </td>

                    <!-- 2. Month -->
                    <td class="p-4 font-extrabold text-slate-900">
                      ${_esc360(r.monthDisplay)}
                    </td>

                    <!-- 3. Paid Date (NO Due Column!) -->
                    <td class="p-4 font-mono font-bold ${isPaid ? 'text-emerald-700' : 'text-slate-400'}">
                      ${_esc360(r.paidDate)}
                    </td>

                    <!-- 4. Fee -->
                    <td class="p-4 font-mono font-black text-slate-900">
                      ${_esc360(r.currency)} ${_esc360(r.feeAmount)}
                    </td>

                    <!-- 5. Status (PAID / UNPAID) -->
                    <td class="p-4">
                      <span class="px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${
                        isPaid
                          ? 'bg-emerald-600 text-white'
                          : 'bg-rose-100 text-rose-800 border border-rose-200'
                      }">
                        ${isPaid ? 'PAID' : 'UNPAID'}
                      </span>
                    </td>

                    <!-- 6. Required Payment Actions: Invoice Record, Edit, Email, Delete -->
                    <td class="p-4 text-right">
                      <div class="inline-flex items-center justify-end gap-1.5">
                        <!-- View Invoice / Payment Record -->
                        <button onclick="viewFamilyPaymentInvoiceModal('${_esc360(family.id)}', '${_esc360(r.recordId)}', '${_esc360(r.month)}', '${_esc360(r.year)}')"
                                class="w-8 h-8 rounded-lg border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-700 flex items-center justify-center transition cursor-pointer"
                                title="View Invoice / Payment Record">
                          <i class="fa-solid fa-file-invoice"></i>
                        </button>

                        <!-- Edit Payment / Invoice -->
                        <button onclick="openEditFamilyPaymentModal('${_esc360(family.id)}', '${_esc360(r.recordId)}', '${_esc360(r.month)}', '${_esc360(r.year)}')"
                                class="w-8 h-8 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 flex items-center justify-center transition cursor-pointer"
                                title="Edit Payment Record">
                          <i class="fa-regular fa-pen-to-square"></i>
                        </button>

                        <!-- Email Invoice / Payment Receipt -->
                        <button onclick="emailSpecificFamilyInvoice('${_esc360(family.id)}', '${_esc360(r.recordId)}', '${_esc360(r.month)}', '${_esc360(r.year)}')"
                                class="w-8 h-8 rounded-lg border border-amber-400 bg-amber-50/70 hover:bg-amber-100 text-amber-800 flex items-center justify-center transition cursor-pointer"
                                title="Email This Month's Invoice / Receipt to Family">
                          <i class="fa-regular fa-envelope"></i>
                        </button>

                        <!-- Delete Payment Entry -->
                        <button onclick="deleteFamilyPaymentRecord('${_esc360(family.id)}', '${_esc360(r.recordId)}', '${_esc360(r.month)}', '${_esc360(r.year)}')"
                                class="w-8 h-8 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 flex items-center justify-center transition cursor-pointer"
                                title="Delete This Payment Entry">
                          <i class="fa-regular fa-trash-can"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// TAB 3: MANAGER'S NOTES TAB (Section #22)
// View, Add, Edit, Delete Manager Notes persisted in Supabase
// ============================================================================
function _buildFamilyManagerNotesTabHtml(family, fNotes) {
  const notes = Array.isArray(fNotes.manager_notes) ? fNotes.manager_notes : [];

  return `
    <div class="p-6 space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h3 class="text-sm font-black text-slate-900">Manager's Notes &amp; Administrative Follow-Ups</h3>
          <p class="text-xs text-slate-500">Internal administrative notes persisted directly to the family backend record.</p>
        </div>
        <button onclick="openAddOrEditManagerNoteModal('${_esc360(family.id)}')"
                class="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition flex items-center gap-2 cursor-pointer">
          <i class="fa-solid fa-plus text-amber-400"></i> Add Manager Note
        </button>
      </div>

      ${notes.length === 0 ? `
        <div class="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs">
          <i class="fa-regular fa-clipboard text-2xl mb-2 block text-slate-300"></i>
          No Manager Notes recorded for ${_esc360(family.parent_name)} yet.
        </div>
      ` : `
        <div class="space-y-3">
          ${notes.map(n => `
            <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-start justify-between gap-4">
              <div class="space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-black uppercase">${_esc360(n.category || 'Management')}</span>
                  <span class="text-xs font-extrabold text-slate-800">${_esc360(n.author || 'Admin / Manager')}</span>
                  <span class="text-[11px] font-mono text-slate-400">${_esc360(n.created_at || '')}</span>
                </div>
                <p class="text-xs text-slate-700 leading-relaxed whitespace-pre-line pt-1">${_esc360(n.content)}</p>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button onclick="openAddOrEditManagerNoteModal('${_esc360(family.id)}', '${_esc360(n.id)}')"
                        class="w-8 h-8 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 flex items-center justify-center transition cursor-pointer"
                        title="Edit Note">
                  <i class="fa-regular fa-pen-to-square text-xs"></i>
                </button>
                <button onclick="deleteFamilyManagerNote('${_esc360(family.id)}', '${_esc360(n.id)}')"
                        class="w-8 h-8 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 flex items-center justify-center transition cursor-pointer"
                        title="Delete Note">
                  <i class="fa-regular fa-trash-can text-xs"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// TAB 4: TEACHER'S NOTES TAB (Section #23)
// Connected to Teacher Portal Lesson Notes + Direct Teacher Notes
// ============================================================================
function _collectAllFamilyTeacherNotes(family, familyStudents, famLogs) {
  const fNotes = _parseFamilyStructuredNotes(family);
  const combined = [];

  // 1. Direct Teacher Notes stored in family.notes.teacher_notes
  (fNotes.teacher_notes || []).forEach(tn => {
    combined.push({
      id: tn.id,
      studentId: tn.studentId || '',
      studentName: tn.studentName || 'All Family Students',
      teacherName: tn.teacherName || 'Assigned Instructor',
      date: tn.date || (tn.created_at ? tn.created_at.slice(0, 10) : ''),
      content: tn.content || '',
      source: 'direct'
    });
  });

  // 2. Teacher Notes recorded via Teacher Portal / Daily Attendance Logs
  (famLogs || []).forEach(log => {
    const p = _parseLessonDetails360(log);
    if (p.hasLesson && (p.remarks || p.summaryTitle)) {
      const stu = (familyStudents || []).find(s => String(s.id).toUpperCase() === String(log.student_id).toUpperCase());
      const tch = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(stu?.assigned_teacher_id));
      combined.push({
        id: `LOG-${log.id || log.date}`,
        studentId: log.student_id,
        studentName: stu ? stu.name : log.student_id,
        teacherName: tch ? tch.full_name : 'Class Instructor',
        date: log.date,
        content: `${p.summaryTitle}${p.remarks && p.remarks !== p.summaryTitle ? ' — ' + p.remarks : ''}`,
        source: 'lesson_log'
      });
    }
  });

  combined.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return combined;
}

function _buildFamilyTeacherNotesTabHtml(family, familyStudents, teacherNotesList) {
  return `
    <div class="p-6 space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h3 class="text-sm font-black text-slate-900">Teacher's Notes &amp; Classroom Observations</h3>
          <p class="text-xs text-slate-500">Live teacher notes and daily class feedback recorded by instructors for this family's students.</p>
        </div>
        <button onclick="openAddTeacherNoteModal('${_esc360(family.id)}')"
                class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition flex items-center gap-2 cursor-pointer">
          <i class="fa-solid fa-plus"></i> Add Teacher Note
        </button>
      </div>

      ${teacherNotesList.length === 0 ? `
        <div class="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs">
          <i class="fa-solid fa-chalkboard-user text-2xl mb-2 block text-slate-300"></i>
          No Teacher Notes have been recorded for this family's students yet.
        </div>
      ` : `
        <div class="space-y-3">
          ${teacherNotesList.map(n => `
            <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-start justify-between gap-4">
              <div class="space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-black">
                    Student: ${_esc360(n.studentName)}
                  </span>
                  <span class="text-xs font-extrabold text-indigo-700">
                    <i class="fa-solid fa-chalkboard-user mr-1"></i>${_esc360(n.teacherName)}
                  </span>
                  <span class="text-[11px] font-mono text-slate-400">${_esc360(n.date)}</span>
                  <span class="px-2 py-0.2 rounded text-[9px] font-bold ${n.source === 'lesson_log' ? 'bg-slate-100 text-slate-600' : 'bg-indigo-50 text-indigo-700'}">
                    ${n.source === 'lesson_log' ? 'Teacher Portal Lesson Log' : 'Instructor Note'}
                  </span>
                </div>
                <p class="text-xs text-slate-700 leading-relaxed pt-1">${_esc360(n.content)}</p>
              </div>
              ${n.source === 'direct' ? `
                <button onclick="deleteFamilyTeacherNote('${_esc360(family.id)}', '${_esc360(n.id)}')"
                        class="w-8 h-8 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 flex items-center justify-center shrink-0 transition cursor-pointer"
                        title="Delete Teacher Note">
                  <i class="fa-regular fa-trash-can text-xs"></i>
                </button>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// TAB 5: BIO DATA TAB (Section #21)
// Strictly NO WhatsApp ID anywhere in Bio Data or Family Profile!
// ============================================================================
function _buildFamilyBioDataTabHtml(family, fNotes, creds) {
  const bio = fNotes.bio_meta || {};

  const emailVal = (window.CURRENT_ROLE === 'manager' && typeof maskStudentEmail === 'function')
    ? maskStudentEmail(family.parent_email || family.email || '')
    : (family.parent_email || family.email || '--');

  const telephoneVal = (window.CURRENT_ROLE === 'manager' && typeof maskStudentPhone === 'function')
    ? maskStudentPhone(bio.telephone || family.whatsapp || '')
    : (bio.telephone || family.whatsapp || '--');

  const mobileVal = (window.CURRENT_ROLE === 'manager' && typeof maskStudentPhone === 'function')
    ? maskStudentPhone(bio.mobile || '')
    : (bio.mobile || '--');

  const meetingPlatform = bio.meeting_platform || 'Zoom';
  const feeVal = `${family.currency || 'GBP'} ${family.monthly_fee || 0}`;
  const countryVal = family.country || 'United Kingdom';
  const cityVal = bio.city || _extractCityFromLegacyNotes(family.notes) || '--';
  const timezoneVal = bio.timezone || _inferTimezoneFromCountry(countryVal);
  const usernameVal = creds.username || family.parent_email || '--';
  const passwordVal = _CURRENT_360_STATE.showPassword ? (creds.password || '123456') : '••••••••';

  // 3-Column Structured Grid matching Screenshot 1 (WITHOUT WhatsApp ID!)
  const rows = [
    [
      { label: 'Email',     value: emailVal },
      { label: 'Telephone', value: telephoneVal },
      { label: 'Mobile',    value: mobileVal }
    ],
    [
      { label: 'Meeting Platform', value: meetingPlatform },
      { label: 'Fee',              value: feeVal },
      { label: 'Country',          value: countryVal }
    ],
    [
      { label: 'City',      value: cityVal },
      { label: 'Timezone',  value: timezoneVal },
      { label: 'Billing Cycle', value: bio.billing_cycle || 'Monthly Regular' }
    ],
    [
      { label: 'Portal Username', value: usernameVal },
      {
        label: 'Portal Password',
        isHtml: true,
        value: `
          <span class="inline-flex items-center gap-2">
            <span class="font-mono font-bold text-teal-800">${_esc360(passwordVal)}</span>
            <button onclick="toggleBioDataPasswordVisibility()" class="text-xs text-indigo-600 hover:underline font-extrabold cursor-pointer">
              ${_CURRENT_360_STATE.showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        `
      },
      { label: 'Account Status', value: (family.status || 'Regular').toUpperCase() }
    ]
  ];

  const tHist = fNotes.trial_history || {};
  const wasTrialFamily = Boolean(fNotes.converted_to_regular) || Boolean(tHist.was_trial) || Boolean(fNotes.converted_from_trial) || String(family.notes || '').includes('Converted from Trial');
  if (wasTrialFamily) {
    rows.push([
      { label: 'Origin / Previous Stage', value: 'Trial Evaluation' },
      { label: 'Trial Started Date', value: tHist.trial_start_date || (family.created_at || '').slice(0, 10) || '--' },
      { label: 'Converted to Regular', value: tHist.converted_at || (family.created_at || '').slice(0, 10) || 'Converted ✓' }
    ]);
  }

  return `
    <div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse">
          <tbody class="divide-y divide-slate-200">
            ${rows.map(r => `
              <tr class="hover:bg-slate-50/70 transition">
                ${r.map(cell => `
                  <td class="p-4 w-1/3 border-r last:border-r-0 border-slate-100">
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-slate-500 font-semibold">${_esc360(cell.label)}:</span>
                      <span class="font-extrabold text-teal-800 text-right">${cell.isHtml ? cell.value : _esc360(cell.value)}</span>
                    </div>
                  </td>
                `).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function toggleBioDataPasswordVisibility() {
  _CURRENT_360_STATE.showPassword = !_CURRENT_360_STATE.showPassword;
  _renderFamilyWorkspaceDOM();
}

function _extractCityFromLegacyNotes(notes) {
  if (!notes || typeof notes !== 'string') return '';
  if (notes.startsWith('City:')) return notes.replace('City:', '').trim();
  return '';
}

function _inferTimezoneFromCountry(country) {
  const c = String(country || '').toLowerCase();
  if (c.includes('kingdom') || c === 'uk') return 'United Kingdom Time (GMT/BST)';
  if (c.includes('united states') || c === 'usa') return 'US Eastern / Central Time';
  if (c.includes('canada')) return 'Canada Eastern Time';
  if (c.includes('australia')) return 'Australia Eastern Time (AEST)';
  if (c.includes('saudi') || c.includes('qatar') || c.includes('kuwait')) return 'Arabia Standard Time (UTC+3)';
  if (c.includes('emirates') || c.includes('uae') || c.includes('oman')) return 'Gulf Standard Time (UTC+4)';
  if (c.includes('pakistan')) return 'Pakistan Standard Time (PKT)';
  return `${country || 'Standard'} Local Time`;
}

// ============================================================================
// MODAL HELPER FOR FAMILY WORKSPACE ACTIONS
// ============================================================================
function _openWorkspaceModal(title, subtitle, bodyHtml) {
  const modal = document.getElementById('familyWorkspaceActionModal');
  if (!modal) return;
  modal.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl overflow-hidden animate-fadeIn">
      <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
        <div>
          <h3 class="text-base font-black">${_esc360(title)}</h3>
          ${subtitle ? `<p class="text-xs text-slate-300 mt-0.5">${_esc360(subtitle)}</p>` : ''}
        </div>
        <button onclick="_closeWorkspaceModal()" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="p-6 max-h-[80vh] overflow-y-auto">
        ${bodyHtml}
      </div>
    </div>
  `;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function _closeWorkspaceModal() {
  const modal = document.getElementById('familyWorkspaceActionModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  modal.innerHTML = '';
}

// ============================================================================
// TOP FAMILY ACTION 1: ADD STUDENT TO CURRENT FAMILY (CANONICAL WORKFLOW)
// Uses the single source of truth modalAddStudent and handleSaveStudent workflow
// ============================================================================
function openFamilyAddStudentModal(familyId) {
  if (typeof _closeWorkspaceModal === 'function') {
    _closeWorkspaceModal();
  }
  if (typeof window.prepareAddStudentModal === 'function') {
    window.prepareAddStudentModal(familyId);
  } else if (typeof prepareAddStudentModal === 'function') {
    prepareAddStudentModal(familyId);
  } else {
    console.error('prepareAddStudentModal canonical workflow not found.');
  }
}
window.openFamilyAddStudentModal = openFamilyAddStudentModal;

// ============================================================================
// TOP FAMILY ACTION 2: SEND INVOICE (CANONICAL WORKFLOW)
// Routes directly to the official tuition fee invoice modal & PDF/Email dispatcher
// ============================================================================
function openFamilySendInvoiceModal(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const payData = _getFamilyPaymentsList(family);
  const row = payData.rows[0];
  if (!row) {
    alert("No fee invoice or payment records found for this family.");
    return;
  }
  viewFamilyPaymentInvoiceModal(family.id, row.recordId, row.month, row.year);
}
window.openFamilySendInvoiceModal = openFamilySendInvoiceModal;

function openGmailDirectFromWorkspace(toId, subId, bodyId) {
  const to = encodeURIComponent(document.getElementById(toId)?.value || '');
  const su = encodeURIComponent(document.getElementById(subId)?.value || '');
  const body = encodeURIComponent(document.getElementById(bodyId)?.value || '');
  window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${su}&body=${body}`, '_blank');
}

// ============================================================================
// TOP FAMILY ACTION 3: SEND EMAIL (Section #4)
// Manual/custom email workflow using existing family email + backend logging
// ============================================================================
function openFamilyCustomEmailModal(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const toEmail = family.parent_email || family.email || '';
  const defaultSubject = `Academic Update for ${family.parent_name} (${family.id}) — Al-Huda Islamic Centre`;
  const defaultBody =
`Assalamu Alaikum Respected ${family.parent_name},

We hope you and your children are doing well.

[Write your message here]

Warm regards,
Administration & Management
Al-Huda Islamic Centre`;

  _openWorkspaceModal(
    `Send Email to Family / Parent`,
    `Recipient: ${family.parent_name} (${toEmail || 'Enter email below'})`,
    `
      <form onsubmit="executeSendFamilyCustomEmail(event, '${_esc360(family.id)}')" class="space-y-4 text-xs">
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">To (Parent Email) *</label>
          <input type="email" id="fwCustomEmailTo" value="${_esc360(toEmail)}" required placeholder="parent@example.com" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Subject *</label>
          <input type="text" id="fwCustomEmailSub" value="${_esc360(defaultSubject)}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Email Message *</label>
          <textarea id="fwCustomEmailBody" rows="7" required class="w-full p-3 rounded-xl border border-slate-300 text-xs text-slate-800">${_esc360(defaultBody)}</textarea>
        </div>
        <div class="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 flex-wrap">
          <button type="button" onclick="openGmailDirectFromWorkspace('fwCustomEmailTo','fwCustomEmailSub','fwCustomEmailBody')" class="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-extrabold">
            <i class="fa-brands fa-google mr-1"></i> Compose in Gmail
          </button>
          <div class="flex items-center gap-2">
            <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
            <button type="submit" id="btnFwSendCustomEmail" class="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-extrabold">
              <i class="fa-solid fa-paper-plane mr-1"></i> Send Email
            </button>
          </div>
        </div>
      </form>
    `
  );
}

async function executeSendFamilyCustomEmail(e, familyId) {
  e.preventDefault();
  const toEmail = document.getElementById('fwCustomEmailTo').value.trim();
  const subject = document.getElementById('fwCustomEmailSub').value.trim();
  const body = document.getElementById('fwCustomEmailBody').value.trim();

  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (family) {
    const fNotes = _parseFamilyStructuredNotes(family);
    fNotes.communication_logs.unshift({
      id: `EMAIL-LOG-${Date.now()}`,
      type: 'email',
      to: toEmail,
      subject,
      sent_at: new Date().toISOString().slice(0, 16).replace('T', ' ')
    });
    await _saveFamilyStructuredNotes(family.id, fNotes, { parent_email: toEmail });
  }

  try {
    if (typeof sendViaOfficialEmailRelay === 'function' || window.sendViaOfficialEmailRelay) {
      const fn = window.sendViaOfficialEmailRelay || sendViaOfficialEmailRelay;
      await fn({
        to: toEmail,
        subject: subject,
        text: body,
        html: body.replace(/\n/g, '<br/>'),
        senderName: 'Al-Huda Islamic Centre (ceoislamiccentre@gmail.com)'
      });
    } else if (typeof emailjs !== 'undefined' && window.EMAILJS_PUBLIC_KEY) {
      await emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
        to_email: toEmail,
        subject: subject,
        message: body,
        from_name: 'Al-Huda Islamic Centre (ceoislamiccentre@gmail.com)'
      });
    }
  } catch (err) {
    console.warn('[360 Custom Email Notice]:', err);
  }

  _closeWorkspaceModal();
  _notify360(`Official email dispatched to ${toEmail} and saved in communication logs.`);
  _renderFamilyWorkspaceDOM();
}

// ============================================================================
// TOP FAMILY ACTION 4: ADD MANUAL INVOICE (Section #4 & #20)
// Saves directly to the real backend financial system (fees.js + Supabase)
// ============================================================================
function openFamilyManualInvoiceModal(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const today = new Date().toISOString().slice(0, 10);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  _openWorkspaceModal(
    `Add Manual Invoice / Financial Entry`,
    `Family: ${family.parent_name} (${family.id}) — Connected to Main Fee System`,
    `
      <form onsubmit="submitFamilyManualInvoiceForm(event, '${_esc360(family.id)}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Amount (${_esc360(family.currency || 'USD')}) *</label>
            <input type="number" step="0.01" id="fwManInvAmount" value="${_esc360(family.monthly_fee || 75)}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Payment Status *</label>
            <select id="fwManInvStatus" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="PAID">PAID (Payment Received)</option>
              <option value="UNPAID">UNPAID (Pending Invoice Charge)</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Billing Month *</label>
            <select id="fwManInvMonth" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              ${months.map(m => `<option value="${m}" ${m === 'September' ? 'selected' : ''}>${m} 2026</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Paid / Entry Date *</label>
            <input type="date" id="fwManInvDate" value="${today}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Payment Method *</label>
            <select id="fwManInvMethod" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="UK Bank Transfer">UK Bank Transfer</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Online Payment">Online Payment</option>
              <option value="Cash">Cash</option>
              <option value="PayPal / Stripe">PayPal / Stripe</option>
              <option value="Zelle / Remittance">Zelle / Remittance</option>
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Reason / Purpose *</label>
            <input type="text" id="fwManInvReason" placeholder="e.g. Monthly Tuition / Extra Sibling / Adjustment" value="Monthly Tuition Fee" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
        </div>

        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Description / Financial Note</label>
          <textarea id="fwManInvDesc" rows="2" placeholder="Provide details about this manual payment or invoice entry..." class="w-full p-2.5 rounded-xl border border-slate-300 text-xs text-slate-800"></textarea>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold">
            Save Manual Invoice to Ledger
          </button>
        </div>
      </form>
    `
  );
}

async function submitFamilyManualInvoiceForm(e, familyId) {
  e.preventDefault();
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const amount = parseFloat(document.getElementById('fwManInvAmount').value) || 0;
  const status = document.getElementById('fwManInvStatus').value;
  const month = document.getElementById('fwManInvMonth').value;
  const date = document.getElementById('fwManInvDate').value;
  const paymentMethod = document.getElementById('fwManInvMethod').value;
  const reason = document.getElementById('fwManInvReason').value.trim();
  const description = document.getElementById('fwManInvDesc').value.trim();

  const receiptNo = `AH-MAN-${Date.now().toString().slice(-6)}`;
  const recordObj = {
    receiptNo,
    familyId: family.id,
    parentName: family.parent_name,
    month,
    year: 2026,
    date: status === 'PAID' ? date : '--',
    amountPaid: status === 'PAID' ? amount : 0,
    amount: amount,
    currency: family.currency || 'USD',
    paymentMethod,
    status,
    reason,
    description,
    remarks: `${reason}${description ? ' — ' + description : ''}`,
    isManualInvoice: true,
    created_at: new Date().toISOString()
  };

  // Save to main Fee System cache + localStorage
  if (typeof getStoredFeeRecords === 'function' && typeof saveStoredFeeRecords === 'function') {
    const allRecs = getStoredFeeRecords() || [];
    allRecs.unshift(recordObj);
    saveStoredFeeRecords(allRecs);
  }

  // Also sync to Supabase family.notes.fee_history & matrix_overrides
  const fNotes = _parseFamilyStructuredNotes(family);
  fNotes.fee_history.unshift(recordObj);
  if (status === 'PAID') {
    const ovKey = `${String(family.id).toUpperCase()}_${month}_2026`;
    fNotes.matrix_overrides[ovKey] = { status: 'paid', amountPaid: amount, date };
    if (typeof getStoredMatrixOverrides === 'function' && typeof saveStoredMatrixOverrides === 'function') {
      const ovs = getStoredMatrixOverrides();
      ovs[ovKey] = fNotes.matrix_overrides[ovKey];
      saveStoredMatrixOverrides(ovs);
    }
  }

  await _saveFamilyStructuredNotes(family.id, fNotes);
  if (typeof loadFeeDashboardStats === 'function') {
    try { loadFeeDashboardStats(); } catch (err) {}
  }

  _closeWorkspaceModal();
  _notify360(`Manual Invoice (${family.currency} ${amount} • ${status}) saved to Payments & Main Fee Ledger!`);
  _CURRENT_360_STATE.activeTab = 'payments';
  _renderFamilyWorkspaceDOM();
}

// ============================================================================
// STUDENT-ONLY ACTIONS (Sections #12, #13, #14)
// 1. Edit ONLY Selected Student
// 2. Put ONLY Selected Student On Leave
// 3. Deactivate ONLY Selected Student
// ============================================================================
function _updateEditStudentZoomLive(teacherId) {
  const zoomInp = document.getElementById('fwEditStuZoom');
  const badge = document.getElementById('fwEditStuZoomBadge');
  if (!zoomInp) return;
  const zoom = (typeof getCanonicalTeacherZoomLink === 'function') ? getCanonicalTeacherZoomLink(teacherId) : '';
  zoomInp.value = zoom || '';
  if (badge) {
    if (zoom && /^https?:\/\//i.test(zoom)) {
      badge.className = "text-[10px] px-2 py-0.5 rounded-full font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300";
      badge.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-600 mr-1"></i> Active Room Linked';
    } else {
      badge.className = "text-[10px] px-2 py-0.5 rounded-full font-extrabold bg-rose-100 text-rose-800 border border-rose-300";
      badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-rose-600 mr-1"></i> Missing Zoom Link';
    }
  }
}
window._updateEditStudentZoomLive = _updateEditStudentZoomLive;

function openEditSingleStudentModal(familyId, studentId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!family || !student) return;

  const stuMeta = _parseStudentStructuredNotes(student);
  const eligibleTeachers = (typeof getEligibleTeachers === 'function')
    ? getEligibleTeachers(window.ALL_TEACHERS)
    : (window.ALL_TEACHERS || []);
  const teacherOptions = eligibleTeachers.map(t =>
    `<option value="${_esc360(t.id)}" ${String(t.id) === String(student.assigned_teacher_id) ? 'selected' : ''}>${_esc360(t.full_name)}</option>`
  ).join('');

  const currentTeacherId = student.assigned_teacher_id;
  const initialZoom = (typeof getCanonicalTeacherZoomLink === 'function' ? getCanonicalTeacherZoomLink(currentTeacherId) : '') || stuMeta.zoom_link || stuMeta.meeting_link || '';

  _openWorkspaceModal(
    `Edit Student Information Only`,
    `Editing Student: ${student.name} (${student.id}) — Does NOT alter Family profile`,
    `
      <form onsubmit="submitEditSingleStudentForm(event, '${_esc360(family.id)}', '${_esc360(student.id)}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Student Full Name *</label>
            <input type="text" id="fwEditStuName" value="${_esc360(student.name)}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Joining Date</label>
            <input type="date" id="fwEditStuJoinDate" value="${_esc360(student.joining_date || '2026-01-01')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Age</label>
            <input type="number" id="fwEditStuAge" value="${_esc360(student.age || 8)}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Gender</label>
            <select id="fwEditStuGender" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="Male" ${student.gender === 'Male' ? 'selected' : ''}>Male</option>
              <option value="Female" ${student.gender === 'Female' ? 'selected' : ''}>Female</option>
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Student Status</label>
            <select id="fwEditStuStatus" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="Active" ${String(student.status || 'Active').toLowerCase() === 'active' ? 'selected' : ''}>Active</option>
              <option value="Leave" ${String(student.status || '').toLowerCase().includes('leave') ? 'selected' : ''}>On Leave</option>
              <option value="Inactive" ${String(student.status || '').toLowerCase() === 'inactive' ? 'selected' : ''}>Deactivated</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Course / Subject</label>
            <input type="text" id="fwEditStuCourse" value="${_esc360(student.course_id || 'Quran Studies')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Assigned Teacher</label>
            <select id="fwEditStuTeacher" onchange="_updateEditStudentZoomLive(this.value)" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="">-- No Teacher Assigned --</option>
              ${teacherOptions}
            </select>
          </div>
        </div>

        <!-- Teacher Zoom Classroom Auto-Sync Section -->
        <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
          <div class="flex items-center justify-between mb-1">
            <label class="font-bold text-slate-700 text-xs flex items-center gap-1.5">
              <i class="fa-solid fa-video text-emerald-600"></i> Teacher Zoom Classroom:
            </label>
            <span id="fwEditStuZoomBadge" class="text-[10px] px-2 py-0.5 rounded-full font-extrabold ${initialZoom ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-rose-100 text-rose-800 border border-rose-300'}">
              ${initialZoom ? '<i class="fa-solid fa-circle-check text-emerald-600 mr-1"></i> Active Room Linked' : '<i class="fa-solid fa-triangle-exclamation text-rose-600 mr-1"></i> Missing Zoom Link'}
            </span>
          </div>
          <input type="text" id="fwEditStuZoom" readonly class="w-full p-2 border rounded-lg font-mono text-xs bg-white text-slate-800" value="${_esc360(initialZoom)}" placeholder="Teacher Zoom Classroom link auto-synced...">
        </div>

        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Days / Schedule Preference</label>
          <input type="text" id="fwEditStuDays" value="${_esc360(stuMeta.days_per_week || '5 Days (Mon-Fri)')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold">
            Save Student Changes
          </button>
        </div>
      </form>
    `
  );
}

async function submitEditSingleStudentForm(e, familyId, studentId) {
  e.preventDefault();
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;

  const name = document.getElementById('fwEditStuName').value.trim();
  const joining_date = document.getElementById('fwEditStuJoinDate').value;
  const age = parseInt(document.getElementById('fwEditStuAge').value, 10) || 8;
  const gender = document.getElementById('fwEditStuGender').value;
  const status = document.getElementById('fwEditStuStatus').value;
  const course_id = document.getElementById('fwEditStuCourse').value.trim();
  const assigned_teacher_id = document.getElementById('fwEditStuTeacher').value || null;
  const days_per_week = document.getElementById('fwEditStuDays').value.trim();

  if (assigned_teacher_id && typeof validateEligibleTeacherBackend === 'function') {
    const check = await validateEligibleTeacherBackend(assigned_teacher_id);
    if (!check.valid) {
      _notify360(check.error, 'error');
      return;
    }
  }

  const stuMeta = _parseStudentStructuredNotes(student);
  stuMeta.days_per_week = days_per_week;
  stuMeta.on_leave = (status.toLowerCase() === 'leave');

  const prevWasInactive = String(student.status || '').toLowerCase() === 'inactive' || String(student.status || '').toLowerCase() === 'deactivated';
  const nextWantsInactive = String(status || '').toLowerCase() === 'inactive' || String(status || '').toLowerCase() === 'deactivated';

  // If transitioning an active student to Deactivated from Edit form, save profile fields first and trigger the mandatory Fee Confirmation dialog
  if (!prevWasInactive && nextWantsInactive) {
    await _saveStudentRecordBackend(student.id, {
      name,
      joining_date,
      age,
      gender,
      course_id,
      assigned_teacher_id,
      notes: JSON.stringify(stuMeta)
    });
    _closeWorkspaceModal();
    openStudentDeactivationFeeModal(familyId, student.id);
    return;
  }

  const oldTeacherId = student.assigned_teacher_id || null;

  if (prevWasInactive && !nextWantsInactive) {
    delete stuMeta.family_deactivated;
    delete stuMeta.deactivated_individually;
    stuMeta.reactivated_at = new Date().toISOString();
  }

  let effectiveTeacherId = assigned_teacher_id;
  if (prevWasInactive && !nextWantsInactive && !effectiveTeacherId && stuMeta.previous_teacher_id_before_deactivation) {
    const prevTchObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(stuMeta.previous_teacher_id_before_deactivation));
    const isPrevEligible = prevTchObj && (typeof isEligibleTeacherRecord === 'function' ? isEligibleTeacherRecord(prevTchObj) : true);
    if (isPrevEligible) {
      effectiveTeacherId = prevTchObj.id;
    }
  }

  if (oldTeacherId && String(oldTeacherId) !== String(effectiveTeacherId || '')) {
    try {
      await db.from('class_schedules').delete().eq('student_id', student.id).eq('teacher_id', oldTeacherId);
      if (Array.isArray(window.ALL_CLASS_SCHEDULES)) {
        window.ALL_CLASS_SCHEDULES = window.ALL_CLASS_SCHEDULES.filter(
          sc => !(String(sc.student_id) === String(student.id) && String(sc.teacher_id) === String(oldTeacherId))
        );
      }
      if (typeof _TEACHER_360_MEM_CACHE === 'object') {
        delete _TEACHER_360_MEM_CACHE[String(oldTeacherId).toUpperCase()];
      }
    } catch (err) {
      console.warn('[Student 360] Old teacher schedule cleanup notice:', err);
    }
  }

  const inputZoom = (document.getElementById('fwEditStuZoom')?.value || '').trim();
  const canonicalZoom = (typeof getCanonicalTeacherZoomLink === 'function') ? getCanonicalTeacherZoomLink(effectiveTeacherId) : '';
  const finalZoomLink = inputZoom || canonicalZoom || stuMeta.zoom_link || stuMeta.meeting_link || '';
  stuMeta.zoom_link = finalZoomLink;
  stuMeta.meeting_link = finalZoomLink;

  await _saveStudentRecordBackend(student.id, {
    name,
    joining_date,
    age,
    gender,
    status,
    course_id,
    assigned_teacher_id: effectiveTeacherId,
    notes: JSON.stringify(stuMeta)
  });

  try {
    const profiles = JSON.parse(localStorage.getItem('alhuda_student_profiles') || '{}');
    if (profiles[student.id]) {
      profiles[student.id].meeting_link = finalZoomLink;
      profiles[student.id].assigned_teacher_id = effectiveTeacherId;
      profiles[student.id].course_id = course_id;
      localStorage.setItem('alhuda_student_profiles', JSON.stringify(profiles));
    }
  } catch (err) {}

  if (effectiveTeacherId && typeof _TEACHER_360_MEM_CACHE === 'object') {
    delete _TEACHER_360_MEM_CACHE[String(effectiveTeacherId).toUpperCase()];
  }
  if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
  if (typeof loadTeachers === 'function') loadTeachers();

  await syncFamilyStatusFromStudentsBackend(familyId);

  _closeWorkspaceModal();
  _notify360(`Student ${name}'s information updated and teacher Student List synchronized!`);
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: student.id, studentSubView: 'info' });
}

/**
 * CORE BACKEND LIFECYCLE SYNCHRONIZER:
 * IF AT LEAST ONE STUDENT IN A FAMILY IS ACTIVE -> FAMILY MUST BE ACTIVE.
 * IF ZERO STUDENTS IN A FAMILY ARE ACTIVE -> FAMILY MUST BE DEACTIVATED.
 */
async function syncFamilyStatusFromStudentsBackend(familyId, extraFamilyColumns = {}, feeDecisionMeta = null) {
  const famKey = String(familyId || '').trim().toUpperCase();
  if (!famKey) return null;

  let family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey)
            || (window.RAW_ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey);

  if (!family) {
    const { data: dbFam } = await db.from('families').select('*, students(*)').eq('id', familyId).maybeSingle();
    family = dbFam;
  }
  if (!family) return null;

  // Query authoritative student rows for this family from Supabase
  let famStudents = [];
  try {
    const { data: dbStus, error: stuErr } = await db.from('students').select('*').eq('family_id', family.id);
    if (!stuErr && Array.isArray(dbStus) && dbStus.length > 0) {
      famStudents = dbStus
        .map(s => (typeof normalizeStudentCourseRecord === 'function' ? normalizeStudentCourseRecord(s) : s))
        .filter(s => typeof isRegularStudentRecord === 'function' ? isRegularStudentRecord(s) : String(s.status || '').toLowerCase() !== 'trial');
    }
  } catch (e) {}

  if (famStudents.length === 0) {
    famStudents = (window.ALL_STUDENTS || []).filter(s =>
      String(s.family_id || '').toUpperCase() === famKey &&
      (typeof isRegularStudentRecord === 'function' ? isRegularStudentRecord(s) : String(s.status || '').toLowerCase() !== 'trial')
    );
  }

  // Sync in-memory ALL_STUDENTS & family.students with fresh student statuses
  famStudents.forEach(freshStu => {
    const gIdx = (window.ALL_STUDENTS || []).findIndex(s => String(s.id).toUpperCase() === String(freshStu.id).toUpperCase());
    if (gIdx >= 0) window.ALL_STUDENTS[gIdx] = { ...window.ALL_STUDENTS[gIdx], ...freshStu };
  });
  family.students = famStudents;

  const isStuDeact = (s) => {
    if (typeof isStudentSelfDeactivated === 'function') return isStudentSelfDeactivated(s);
    const st = String(s?.status || 'Active').trim().toLowerCase();
    return s?.is_active === false || st === 'inactive' || st === 'deactivated' || st === 'deleted' || st === 'left';
  };

  const activeStudents = famStudents.filter(s => !isStuDeact(s));
  const activeStudentCount = activeStudents.length;

  let computedFamilyStatus = family.status || 'Active';
  if (famStudents.length > 0) {
    if (activeStudentCount >= 1) {
      const currLower = String(computedFamilyStatus || '').trim().toLowerCase();
      computedFamilyStatus = (currLower === 'inactive' || currLower === 'deactivated') ? 'Active' : (computedFamilyStatus || 'Active');
    } else {
      computedFamilyStatus = 'Inactive';
    }
  } else if (extraFamilyColumns.status) {
    computedFamilyStatus = extraFamilyColumns.status;
  }

  const fNotes = _parseFamilyStructuredNotes(family);
  fNotes.bio_meta = fNotes.bio_meta || {};
  fNotes.bio_meta.lifecycle_status = computedFamilyStatus === 'Inactive' ? 'DEACTIVATED' : 'ACTIVE';
  fNotes.bio_meta.lifecycle_updated_at = new Date().toISOString();
  fNotes.bio_meta.active_students_count = activeStudentCount;

  const updateCols = { ...extraFamilyColumns, status: computedFamilyStatus };

  // Apply explicit fee decision if provided
  if (feeDecisionMeta && typeof feeDecisionMeta === 'object') {
    fNotes.bio_meta.last_fee_decision = feeDecisionMeta;
    if (feeDecisionMeta.decision === 'change_fee' && typeof feeDecisionMeta.newMonthlyFee === 'number') {
      const newFeeVal = feeDecisionMeta.newMonthlyFee;
      updateCols.monthly_fee = newFeeVal;
      fNotes.fee_meta = fNotes.fee_meta || {};
      fNotes.fee_meta.agreed_monthly_fee = newFeeVal;

      // Also update any current-month unpaid invoice in fee_history & localStorage fee records so billing stays 100% consistent
      if (Array.isArray(fNotes.fee_history)) {
        fNotes.fee_history.forEach(rec => {
          if (rec && String(rec.status || '').toUpperCase() === 'UNPAID') {
            rec.feeAmount = newFeeVal;
            rec.amount = newFeeVal;
          }
        });
      }
      if (typeof getStoredFeeRecords === 'function' && typeof saveStoredFeeRecords === 'function') {
        try {
          const allFeeRecs = getStoredFeeRecords() || [];
          let feeChanged = false;
          allFeeRecs.forEach(rec => {
            if (rec && String(rec.familyId || '').toUpperCase() === famKey && String(rec.status || '').toUpperCase() === 'UNPAID') {
              rec.feeAmount = newFeeVal;
              rec.amount = newFeeVal;
              feeChanged = true;
            }
          });
          if (feeChanged) saveStoredFeeRecords(allFeeRecs);
        } catch (e) {}
      }
    }
  }

  await _saveFamilyStructuredNotes(family.id, fNotes, updateCols);

  // Also synchronize RAW_ALL_FAMILIES
  const rawIdx = (window.RAW_ALL_FAMILIES || []).findIndex(f => String(f.id).toUpperCase() === famKey);
  if (rawIdx >= 0) {
    window.RAW_ALL_FAMILIES[rawIdx] = {
      ...window.RAW_ALL_FAMILIES[rawIdx],
      ...updateCols,
      students: famStudents,
      notes: JSON.stringify(fNotes)
    };
  }

  const allIdx = (window.ALL_FAMILIES || []).findIndex(f => String(f.id).toUpperCase() === famKey);
  if (allIdx >= 0) {
    window.ALL_FAMILIES[allIdx].students = famStudents;
  }

  if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
  if (typeof loadFamiliesAndStudents === 'function') await loadFamiliesAndStudents(true);
  if (typeof updateLiveActiveMetrics === 'function') updateLiveActiveMetrics();

  return {
    familyStatus: computedFamilyStatus,
    activeStudentCount,
    totalStudentCount: famStudents.length,
    monthlyFee: updateCols.monthly_fee !== undefined ? updateCols.monthly_fee : family.monthly_fee
  };
}
window.syncFamilyStatusFromStudentsBackend = syncFamilyStatusFromStudentsBackend;

/**
 * INDIVIDUAL STUDENT DEACTIVATION / REACTIVATION (ISSUE #2)
 * - Deactivating an individual student opens the mandatory Fee Confirmation modal first.
 * - Reactivating an individual student immediately sets student = Active and recalculates Family status
 *   (so if Family was DEACTIVATED, Family automatically becomes ACTIVE).
 */
async function toggleSingleStudentDeactivate(familyId, studentId) {
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;

  const isCurrentlyInactive = String(student.status || '').toLowerCase() === 'inactive' || String(student.status || '').toLowerCase() === 'deactivated';

  if (!isCurrentlyInactive) {
    // Open the mandatory Fee Confirmation & Lifecycle Impact dialog BEFORE completing deactivation
    openStudentDeactivationFeeModal(familyId, studentId);
    return;
  }

  // REACTIVATION FLOW (Student DEACTIVATED -> ACTIVE)
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase())
              || (window.RAW_ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  const famWasDeactivated = family ? (typeof isFamilyDeactivated === 'function' ? isFamilyDeactivated(family) : ['inactive', 'deactivated'].includes(String(family.status || '').toLowerCase())) : false;

  const confirmMsg = famWasDeactivated
    ? `Reactivate student "${student.name}" (${student.id})?\n\n• ${student.name} will become ACTIVE.\n• Because this family currently has 0 active students, Family "${family?.parent_name || familyId}" will automatically become ACTIVE.\n• Previous teacher and schedule slots will NOT be auto-restored (you can assign a teacher and schedule slots fresh).`
    : `Reactivate student "${student.name}" (${student.id})?\n\n• ${student.name} will become ACTIVE.\n• Family "${family?.parent_name || familyId}" will remain ACTIVE.\n• Previous teacher and schedule slots will NOT be auto-restored (you can assign a teacher and schedule slots fresh).`;

  if (!(await lmsConfirm(confirmMsg))) return;

  const stuMeta = _parseStudentStructuredNotes(student);
  delete stuMeta.family_deactivated;
  delete stuMeta.deactivated_individually;
  delete stuMeta.on_leave;
  stuMeta.reactivated_at = new Date().toISOString();

  const candidateTchId = student.assigned_teacher_id || stuMeta.previous_teacher_id_before_deactivation || null;
  let restoredTeacherId = null;
  if (candidateTchId) {
    const tchObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(candidateTchId));
    const isEligible = tchObj && (typeof isEligibleTeacherRecord === 'function' ? isEligibleTeacherRecord(tchObj) : true);
    if (isEligible) {
      restoredTeacherId = tchObj.id;
    }
  }

  await _saveStudentRecordBackend(student.id, {
    status: 'Active',
    assigned_teacher_id: restoredTeacherId,
    notes: JSON.stringify(stuMeta)
  });

  if (restoredTeacherId && typeof _TEACHER_360_MEM_CACHE === 'object') {
    delete _TEACHER_360_MEM_CACHE[String(restoredTeacherId).toUpperCase()];
  }
  if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
  if (typeof loadTeachers === 'function') loadTeachers();

  const syncResult = await syncFamilyStatusFromStudentsBackend(familyId);
  const famNowActive = syncResult && syncResult.familyStatus !== 'Inactive';

  _notify360(
    famWasDeactivated && famNowActive
      ? `${student.name} reactivated — Family "${family?.parent_name || familyId}" is now automatically ACTIVE${restoredTeacherId ? ' and student restored to Teacher Student List' : ''}.`
      : `${student.name} is now ACTIVE${restoredTeacherId ? ' and restored to Teacher Student List' : ''}.`
  );
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: student.id });
}

function openStudentDeactivationFeeModal(familyId, studentId) {
  const famKey = String(familyId || '').toUpperCase();
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey)
              || (window.RAW_ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey);
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!family || !student) return;

  const currency = family.currency || 'GBP';
  const currentFee = parseFloat(family.monthly_fee || 0) || 0;

  const famStudents = (window.ALL_STUDENTS || []).filter(s =>
    String(s.family_id || '').toUpperCase() === famKey &&
    (typeof isRegularStudentRecord === 'function' ? isRegularStudentRecord(s) : String(s.status || '').toLowerCase() !== 'trial')
  );
  const otherActiveStudents = famStudents.filter(s =>
    String(s.id).toUpperCase() !== String(student.id).toUpperCase() &&
    !(typeof isStudentSelfDeactivated === 'function'
      ? isStudentSelfDeactivated(s)
      : ['inactive', 'deactivated', 'deleted', 'left'].includes(String(s.status || '').toLowerCase()))
  );
  const remainingActiveCount = otherActiveStudents.length;
  const isLastActiveStudent = (remainingActiveCount === 0);

  const familyStatusImpactHtml = isLastActiveStudent
    ? `
      <div class="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-start gap-2.5">
        <i class="fa-solid fa-triangle-exclamation text-rose-600 text-sm mt-0.5 shrink-0"></i>
        <div>
          <div class="font-extrabold">Last Active Student in Family</div>
          <div class="text-[11px] text-rose-800 mt-0.5 leading-relaxed">
            <strong>${_esc360(student.name)}</strong> is the only remaining active student in <strong>${_esc360(family.parent_name)}</strong>.
            After confirming this deactivation, <strong>0 active students</strong> will remain, so Family <strong>${_esc360(family.parent_name)} (${_esc360(family.id)})</strong> will automatically become <strong>DEACTIVATED</strong>.
          </div>
        </div>
      </div>
    `
    : `
      <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5">
        <i class="fa-solid fa-circle-check text-emerald-600 text-sm mt-0.5 shrink-0"></i>
        <div>
          <div class="font-extrabold">Family Remains ACTIVE (${remainingActiveCount} Other Active Student${remainingActiveCount === 1 ? '' : 's'})</div>
          <div class="text-[11px] text-emerald-800 mt-0.5 leading-relaxed">
            Only <strong>${_esc360(student.name)}</strong> will be marked <strong>DEACTIVATED</strong>.
            Because ${remainingActiveCount} other student${remainingActiveCount === 1 ? ' is' : 's are'} still active (${otherActiveStudents.map(s => _esc360(s.name)).join(', ')}), Family <strong>${_esc360(family.parent_name)}</strong> will remain <strong>ACTIVE</strong>.
          </div>
        </div>
      </div>
    `;

  const defaultDeactDate = new Date().toISOString().slice(0, 10);

  _openWorkspaceModal(
    `Deactivate Student — Deactivation Date, Salary & Fee Confirmation`,
    `Student: ${student.name} (${student.id}) • Family: ${family.parent_name} (${family.id})`,
    `
      <form onsubmit="executeConfirmSingleStudentDeactivation(event, '${_esc360(family.id)}', '${_esc360(student.id)}')" class="space-y-4 text-xs">
        ${familyStatusImpactHtml}

        <!-- TASK 8: STUDENT DEACTIVATION DATE (DEFAULT TODAY, EDITABLE) -->
        <div class="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <label for="stuDeactivationDateInput" class="font-extrabold text-amber-950 text-xs flex items-center gap-1.5">
              <i class="fa-solid fa-calendar-xmark text-rose-600"></i>
              Student Deactivation Date <span class="text-rose-600">*</span>
            </label>
            <span class="px-2 py-0.5 rounded-md bg-white border border-amber-300 text-[10px] font-bold text-amber-900">
              Ends Teacher Salary Eligibility on This Date
            </span>
          </div>
          <input type="date" id="stuDeactivationDateInput" value="${defaultDeactDate}" required
                 class="w-full p-2.5 rounded-xl border border-amber-300 bg-white font-mono font-extrabold text-xs text-slate-900 focus:outline-none focus:border-amber-600">
          <p class="text-[11px] text-amber-800 leading-relaxed">
            Teacher auto-salary for <strong>${_esc360(student.name)}</strong> will be prorated up to and including this Deactivation Date. Past finalized salary months remain protected.
          </p>
        </div>

        <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div class="flex items-center justify-between border-b border-slate-200 pb-2">
            <span class="font-extrabold text-slate-800 text-xs">Will the family's fee remain the same or change?</span>
            <span class="px-2.5 py-0.5 rounded-lg bg-white border border-slate-200 font-mono font-extrabold text-emerald-800 text-xs">
              Current Fee: ${_esc360(currency)} ${currentFee.toLocaleString()}
            </span>
          </div>

          <div class="space-y-2">
            <!-- OPTION 1: FEE REMAINS THE SAME -->
            <label id="lblStuDeactFeeSame" class="flex items-start gap-2.5 p-3 rounded-xl border-2 border-emerald-500 bg-emerald-50/60 cursor-pointer transition">
              <input type="radio" name="stuDeactFeeDecision" value="same" checked onchange="handleStuDeactFeeOptionChange('same')" class="mt-0.5 accent-emerald-600">
              <div>
                <div class="font-extrabold text-slate-900 text-xs">1. Fee Remains the Same (${_esc360(currency)} ${currentFee.toLocaleString()})</div>
                <div class="text-[11px] text-slate-600 mt-0.5">Deactivate only ${_esc360(student.name)} and keep the family's current monthly fee unchanged.</div>
              </div>
            </label>

            <!-- OPTION 2: FAMILY FEE WILL CHANGE -->
            <label id="lblStuDeactFeeChange" class="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer transition">
              <input type="radio" name="stuDeactFeeDecision" value="change" onchange="handleStuDeactFeeOptionChange('change')" class="mt-0.5 accent-amber-600">
              <div class="w-full">
                <div class="font-extrabold text-slate-900 text-xs">2. Family Fee Will Change</div>
                <div class="text-[11px] text-slate-600 mt-0.5">Enter the updated monthly fee for Family ${_esc360(family.parent_name)} before confirming.</div>

                <div id="stuDeactNewFeeBox" class="hidden mt-3 pt-2.5 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div class="p-2 rounded-lg bg-slate-100 border border-slate-200">
                    <span class="text-[10px] font-bold uppercase text-slate-500 block">Current Family Fee</span>
                    <span class="font-mono font-extrabold text-sm text-slate-800">${_esc360(currency)} ${currentFee.toLocaleString()}</span>
                  </div>
                  <div>
                    <label class="text-[10px] font-extrabold uppercase text-amber-900 block mb-1">New Family Fee (${_esc360(currency)}) *</label>
                    <input type="number" step="0.01" min="0" id="stuDeactNewFamilyFeeInput" value="${currentFee}"
                           class="w-full p-2 rounded-lg border-2 border-amber-400 bg-white font-mono font-extrabold text-sm text-slate-900 focus:outline-none focus:border-amber-600">
                  </div>
                </div>
              </div>
            </label>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">
            Cancel
          </button>
          <button type="submit" id="btnConfirmSingleStuDeact" class="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold shadow-sm">
            Confirm Student Deactivation
          </button>
        </div>
      </form>
    `
  );
}

function handleStuDeactFeeOptionChange(mode) {
  const box = document.getElementById('stuDeactNewFeeBox');
  const lblSame = document.getElementById('lblStuDeactFeeSame');
  const lblChange = document.getElementById('lblStuDeactFeeChange');
  const input = document.getElementById('stuDeactNewFamilyFeeInput');

  if (mode === 'change') {
    if (box) box.classList.remove('hidden');
    if (lblChange) lblChange.className = 'flex items-start gap-2.5 p-3 rounded-xl border-2 border-amber-500 bg-amber-50/50 cursor-pointer transition';
    if (lblSame) lblSame.className = 'flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer transition';
    if (input) {
      input.required = true;
      setTimeout(() => { input.focus(); input.select(); }, 30);
    }
  } else {
    if (box) box.classList.add('hidden');
    if (lblSame) lblSame.className = 'flex items-start gap-2.5 p-3 rounded-xl border-2 border-emerald-500 bg-emerald-50/60 cursor-pointer transition';
    if (lblChange) lblChange.className = 'flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer transition';
    if (input) input.required = false;
  }
}

async function executeConfirmSingleStudentDeactivation(e, familyId, studentId) {
  e.preventDefault();
  const famKey = String(familyId || '').toUpperCase();
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey)
              || (window.RAW_ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey);
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!family || !student) return;

  const deactivationDate = (document.getElementById('stuDeactivationDateInput')?.value || '').trim() || new Date().toISOString().slice(0, 10);
  const selectedOption = document.querySelector('input[name="stuDeactFeeDecision"]:checked')?.value || 'same';
  const currentFee = parseFloat(family.monthly_fee || 0) || 0;
  let newFee = currentFee;

  if (selectedOption === 'change') {
    const rawVal = document.getElementById('stuDeactNewFamilyFeeInput')?.value;
    const parsedFee = parseFloat(rawVal);
    if (rawVal === '' || isNaN(parsedFee) || parsedFee < 0) {
      alert('Please enter a valid non-negative New Family Fee amount before confirming.');
      return;
    }
    newFee = parsedFee;
  }

  const btn = document.getElementById('btnConfirmSingleStuDeact');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Saving Changes...';
  }

  try {
    // 1. Update Student Status to Inactive (DEACTIVATED) in backend DB & memory, record deactivation_date, and preserve previous teacher ID for salary proration
    const stuMeta = _parseStudentStructuredNotes(student);
    const prevTeacherId = student.assigned_teacher_id || stuMeta.previous_teacher_id_before_deactivation || null;
    stuMeta.deactivated_individually = true;
    stuMeta.deactivation_date = deactivationDate;
    stuMeta.deactivated_at = new Date().toISOString();
    if (prevTeacherId) {
      stuMeta.previous_teacher_id_before_deactivation = prevTeacherId;
    }

    student.deactivation_date = deactivationDate;

    try {
      const profiles = JSON.parse(localStorage.getItem('alhuda_student_profiles') || '{}');
      profiles[student.id] = {
        ...(profiles[student.id] || {}),
        deactivation_date: deactivationDate,
        previous_teacher_id_before_deactivation: prevTeacherId
      };
      localStorage.setItem('alhuda_student_profiles', JSON.stringify(profiles));
    } catch (e) {}

    const deactSyncInfo = (typeof deactivateStudentScheduleAndTeacherBackend === 'function')
      ? await deactivateStudentScheduleAndTeacherBackend(student.id, stuMeta)
      : { previousTeacherId: prevTeacherId };

    await _saveStudentRecordBackend(student.id, {
      status: 'Inactive',
      assigned_teacher_id: null,
      notes: JSON.stringify(stuMeta)
    });

    if (deactSyncInfo.previousTeacherId && typeof _TEACHER_360_MEM_CACHE === 'object') {
      delete _TEACHER_360_MEM_CACHE[String(deactSyncInfo.previousTeacherId).toUpperCase()];
    }

    // 2. Apply explicit fee decision & recalculate Family status based on remaining active students
    const feeDecisionMeta = {
      decision: selectedOption === 'change' ? 'change_fee' : 'same_fee',
      previousMonthlyFee: currentFee,
      newMonthlyFee: newFee,
      studentId: student.id,
      studentName: student.name,
      deactivationDate: deactivationDate,
      updatedAt: new Date().toISOString()
    };

    const extraCols = selectedOption === 'change' ? { monthly_fee: newFee } : {};
    const syncResult = await syncFamilyStatusFromStudentsBackend(family.id, extraCols, feeDecisionMeta);

    if (selectedOption === 'change' && typeof loadFeeBillingLedger === 'function') {
      try { loadFeeBillingLedger(); } catch (err) {}
    }
    if (typeof loadTeachers === 'function') {
      try { loadTeachers(); } catch (err) {}
    }
    if (typeof calculateMonthlySalaries === 'function') {
      try { calculateMonthlySalaries(); } catch (err) {}
    }
    if (typeof CURRENT_MATRIX_TEACHER !== 'undefined' && CURRENT_MATRIX_TEACHER && String(CURRENT_MATRIX_TEACHER.id) === String(deactSyncInfo.previousTeacherId)) {
      if (typeof fetchTeacherSchedules === 'function' && typeof render2DMatrixTable === 'function') {
        try { await fetchTeacherSchedules(); render2DMatrixTable(); } catch (err) {}
      }
    }

    _closeWorkspaceModal();

    const currency = family.currency || 'GBP';
    const feeMsg = selectedOption === 'change'
      ? `Family fee updated from ${currency} ${currentFee} to ${currency} ${newFee}.`
      : `Family fee unchanged (${currency} ${currentFee}).`;
    const famStatusMsg = (syncResult && syncResult.familyStatus === 'Inactive')
      ? `Zero active students remain — Family "${family.parent_name}" is now automatically DEACTIVATED.`
      : `Family "${family.parent_name}" remains ACTIVE (${syncResult ? syncResult.activeStudentCount : 1} active student(s)).`;

    _notify360(`${student.name} DEACTIVATED (Deactivation Date: ${deactivationDate}). Teacher salary prorated through ${deactivationDate}. ${famStatusMsg} ${feeMsg}`);
    await openFamily360Profile(family.id, 'students', true, { selectedStudentId: student.id });
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Confirm Student Deactivation';
    }
    alert('Error saving student deactivation: ' + (err?.message || err));
  }
}

/**
 * STUDENT-ONLY LEAVE (Section #14)
 * Places ONLY the selected Student On Leave; Family and sibling Students remain Active!
 */
async function toggleSingleStudentLeave(familyId, studentId) {
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;

  const stuMeta = _parseStudentStructuredNotes(student);
  const isCurrentlyOnLeave = String(student.status || '').toLowerCase().includes('leave') || Boolean(stuMeta.on_leave);
  const newStatus = isCurrentlyOnLeave ? 'Active' : 'Leave';

  const msg = isCurrentlyOnLeave
    ? `Return student "${student.name}" from leave to Active status?`
    : `Place ONLY "${student.name}" (${student.id}) on Leave?\n\nThe Family and other sibling students will remain Active.`;

  if (!(await lmsConfirm(msg))) return;

  stuMeta.on_leave = !isCurrentlyOnLeave;
  await _saveStudentRecordBackend(student.id, {
    status: newStatus,
    notes: JSON.stringify(stuMeta)
  });

  await syncFamilyStatusFromStudentsBackend(familyId);

  _notify360(`${student.name} is now ${newStatus === 'Leave' ? 'On Leave' : 'Active'} (Student-only status updated).`);
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: student.id });
}

// ============================================================================
// FAMILY-LEVEL ACTIONS (Section #15)
// 1. Deactivate Family (Deactivates ALL students in the family & sets Family = DEACTIVATED)
// 2. Make Family on Leave
// 3. Suspend Family Classes
// 4. Edit Family Profile
// ============================================================================
async function handleFamilyLevelDeactivate(familyId) {
  const famKey = String(familyId || '').toUpperCase();
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey)
              || (window.RAW_ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === famKey);
  if (!family) return;

  const isInactive = typeof isFamilyDeactivated === 'function'
    ? isFamilyDeactivated(family)
    : (['inactive', 'deactivated'].includes(String(family.status || '').trim().toLowerCase()) || family.is_active === false);
  const targetStatus = isInactive ? 'Active' : 'Inactive';

  let familyDeactDate = new Date().toISOString().slice(0, 10);
  if (!isInactive) {
    const userDate = window.prompt(
      `Enter Deactivation Date (YYYY-MM-DD) for "${family.parent_name}" (${family.id}) and all active students in this family:\n(Teacher salary eligibility ends on this date)`,
      familyDeactDate
    );
    if (userDate === null) return; // Cancelled
    if (/^\d{4}-\d{2}-\d{2}$/.test(userDate.trim())) {
      familyDeactDate = userDate.trim();
    }
  } else {
    if (!(await lmsConfirm(`Reactivate the ENTIRE Family account for "${family.parent_name}" (${family.id})?\n\nThis family and its students will return to the Active Families list and active counts. Previous teachers and schedule slots will NOT be auto-restored.`))) return;
  }

  // Fetch all students belonging to this family from DB/memory so none are missed
  let famStudents = [];
  try {
    const { data: dbStus } = await db.from('students').select('*').eq('family_id', family.id);
    if (Array.isArray(dbStus) && dbStus.length > 0) famStudents = dbStus;
  } catch (e) {}
  if (famStudents.length === 0) {
    famStudents = (window.ALL_STUDENTS || []).filter(s => String(s.family_id || '').toUpperCase() === famKey);
  }

  for (const stu of famStudents) {
    if (String(stu.status || '').toLowerCase() === 'trial') continue;
    const stuMeta = _parseStudentStructuredNotes(stu);
    let nextStuStatus = targetStatus;
    if (!isInactive) {
      // Deactivating entire family -> ALL students must become DEACTIVATED ('Inactive'), record deactivation_date, and preserve previous teacher ID
      const prevTch = stu.assigned_teacher_id || stuMeta.previous_teacher_id_before_deactivation || null;
      stuMeta.prev_status_before_family_deactivation = stu.status || 'Active';
      stuMeta.family_deactivated = true;
      stuMeta.deactivation_date = familyDeactDate;
      stuMeta.deactivated_at = new Date().toISOString();
      if (prevTch) stuMeta.previous_teacher_id_before_deactivation = prevTch;
      stu.deactivation_date = familyDeactDate;
      nextStuStatus = 'Inactive';
      if (typeof deactivateStudentScheduleAndTeacherBackend === 'function') {
        const info = await deactivateStudentScheduleAndTeacherBackend(stu.id, stuMeta);
        if (info.previousTeacherId && typeof _TEACHER_360_MEM_CACHE === 'object') {
          delete _TEACHER_360_MEM_CACHE[String(info.previousTeacherId).toUpperCase()];
        }
      }
    } else {
      // Reactivating entire family -> restore students to Active WITHOUT auto-restoring old teacher or schedule
      const prev = stuMeta.prev_status_before_family_deactivation;
      nextStuStatus = (prev && !['inactive', 'deactivated'].includes(String(prev).toLowerCase())) ? prev : 'Active';
      delete stuMeta.family_deactivated;
      delete stuMeta.deactivated_individually;
      stuMeta.reactivated_at = new Date().toISOString();
    }
    await _saveStudentRecordBackend(stu.id, {
      status: nextStuStatus,
      assigned_teacher_id: null,
      notes: JSON.stringify(stuMeta)
    });
  }

  await syncFamilyStatusFromStudentsBackend(family.id, { status: targetStatus });
  if (typeof loadTeachers === 'function') {
    try { loadTeachers(); } catch (err) {}
  }
  if (typeof calculateMonthlySalaries === 'function') {
    try { calculateMonthlySalaries(); } catch (err) {}
  }

  _notify360(`Family "${family.parent_name}" and all linked students are now ${targetStatus === 'Inactive' ? 'DEACTIVATED' : 'ACTIVE'}.`);
  const profTab = document.getElementById('tab-profile-360');
  if (profTab && !profTab.classList.contains('hidden')) {
    _renderFamilyWorkspaceDOM();
  }
}

async function handleFamilyLevelLeave(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const isLeave = String(family.status || '').toLowerCase().includes('leave');
  const targetStatus = isLeave ? 'Active' : 'On Leave';

  if (!(await lmsConfirm(`${isLeave ? 'Return entire Family from Leave' : 'Place entire Family on Leave'} (${family.parent_name} • ${family.id})?`))) return;

  const fNotes = _parseFamilyStructuredNotes(family);
  await _saveFamilyStructuredNotes(family.id, fNotes, { status: targetStatus });

  _notify360(`Family "${family.parent_name}" is now marked ${targetStatus}.`);
  _renderFamilyWorkspaceDOM();
}

async function handleFamilyLevelSuspendClasses(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const fNotes = _parseFamilyStructuredNotes(family);
  const isSuspended = String(family.status || '').toLowerCase() === 'suspended' || Boolean(fNotes.bio_meta.classes_suspended);

  if (!(await lmsConfirm(`${isSuspended ? 'Unsuspend' : 'Suspend'} all classes for Family "${family.parent_name}" (${family.id})?`))) return;

  fNotes.bio_meta.classes_suspended = !isSuspended;
  const newStatus = !isSuspended ? 'Suspended' : 'Active';

  await _saveFamilyStructuredNotes(family.id, fNotes, { status: newStatus });
  _notify360(`Classes for Family "${family.parent_name}" have been ${!isSuspended ? 'Suspended' : 'Unsuspended'}.`);
  _renderFamilyWorkspaceDOM();
}

function openEditFamilyProfileModal(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const fNotes = _parseFamilyStructuredNotes(family);
  const bio = fNotes.bio_meta || {};
  const creds = (typeof getParentCreds === 'function') ? getParentCreds(family) : { username: 'parent_' + family.id, password: '123456' };

  _openWorkspaceModal(
    `Edit Family Profile Information`,
    `Family ID: ${family.id} — Updates Family Header & Bio Data`,
    `
      <form onsubmit="submitEditFamilyProfileForm(event, '${_esc360(family.id)}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Parent / Family Name *</label>
            <input type="text" id="fwEditFamName" value="${_esc360(family.parent_name)}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Email Address</label>
            <input type="text" inputmode="email" id="fwEditFamEmail" value="${_esc360(family.parent_email || family.email || '')}" oninput="this.value = this.value.replace(/\s+/g, '')" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900 font-mono text-xs">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Telephone</label>
            <input type="text" id="fwEditFamTel" value="${_esc360(bio.telephone || family.whatsapp || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Mobile</label>
            <input type="text" id="fwEditFamMobile" value="${_esc360(bio.mobile || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Country</label>
            <input type="text" id="fwEditFamCountry" value="${_esc360(family.country || 'United Kingdom')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">City</label>
            <input type="text" id="fwEditFamCity" value="${_esc360(bio.city || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Timezone</label>
            <input type="text" id="fwEditFamTz" value="${_esc360(bio.timezone || _inferTimezoneFromCountry(family.country))}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Monthly Fee</label>
            <input type="number" step="0.01" id="fwEditFamFee" value="${_esc360(family.monthly_fee || 0)}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Currency</label>
            <input type="text" id="fwEditFamCurr" value="${_esc360(family.currency || 'GBP')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Meeting Platform</label>
            <select id="fwEditFamPlatform" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="Zoom" ${(bio.meeting_platform || 'Zoom') === 'Zoom' ? 'selected' : ''}>Zoom</option>
              <option value="Skype" ${bio.meeting_platform === 'Skype' ? 'selected' : ''}>Skype</option>
              <option value="Google Meet" ${bio.meeting_platform === 'Google Meet' ? 'selected' : ''}>Google Meet</option>
              <option value="Microsoft Teams" ${bio.meeting_platform === 'Microsoft Teams' ? 'selected' : ''}>Microsoft Teams</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Portal Username</label>
            <input type="text" id="fwEditFamUser" value="${_esc360(creds.username)}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Portal Password</label>
            <input type="text" id="fwEditFamPass" value="${_esc360(creds.password)}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold">
            Save Family Profile
          </button>
        </div>
      </form>
    `
  );
}

async function submitEditFamilyProfileForm(e, familyId) {
  e.preventDefault();
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const parent_name = document.getElementById('fwEditFamName').value.trim();
  const parent_email = document.getElementById('fwEditFamEmail').value.trim();
  const telephone = document.getElementById('fwEditFamTel').value.trim();
  const mobile = document.getElementById('fwEditFamMobile').value.trim();
  const country = document.getElementById('fwEditFamCountry').value.trim();
  const city = document.getElementById('fwEditFamCity').value.trim();
  const timezone = document.getElementById('fwEditFamTz').value.trim();
  const monthly_fee = parseFloat(document.getElementById('fwEditFamFee').value) || 0;
  const currency = document.getElementById('fwEditFamCurr').value.trim() || 'USD';
  const meeting_platform = document.getElementById('fwEditFamPlatform').value;
  const username = document.getElementById('fwEditFamUser').value.trim();
  const password = document.getElementById('fwEditFamPass').value.trim();

  const fNotes = _parseFamilyStructuredNotes(family);
  fNotes.bio_meta = {
    ...fNotes.bio_meta,
    telephone,
    mobile,
    city,
    timezone,
    meeting_platform
  };

  await _saveFamilyStructuredNotes(family.id, fNotes, {
    parent_name,
    parent_email,
    email: parent_email,
    whatsapp: telephone || family.whatsapp,
    country,
    monthly_fee,
    currency
  });

  if (typeof saveParentAccount === 'function') {
    saveParentAccount(family.id, { username, password, parent_name, whatsapp: telephone, email: parent_email, city, country, monthly_fee, currency });
  }

  _closeWorkspaceModal();
  _notify360(`Family Profile for "${parent_name}" updated across the LMS!`);
  _renderFamilyWorkspaceDOM();
}

// ============================================================================
// PAYMENT ACTIONS: VIEW, EDIT, EMAIL, DELETE (Section #19 & #20)
// ============================================================================
function viewFamilyPaymentInvoiceModal(familyId, recordId, month, year) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;
  const payData = _getFamilyPaymentsList(family);
  const row = payData.rows.find(r => r.recordId === recordId || (r.month === month && String(r.year) === String(year))) || payData.rows[0];
  if (!row) return;

  const studentsNames = ((window.ALL_STUDENTS || []).filter(s => String(s.family_id).toUpperCase() === String(family.id).toUpperCase()).map(s => s.name)).join(', ') || 'Enrolled Students';

  const raw = row.rawRecord || {};
  const isPaid = (row.status === 'PAID');
  const agreedFee = parseFloat(family.monthly_fee || 0) || 0;
  const canonicalReceipt = {
    receiptNo: raw.receiptNo || (String(row.recordId || '').startsWith('AUTO-') ? `AH-REC-${family.id}-${row.month}-${row.year}` : (row.recordId || `AH-REC-${family.id}`)),
    parentName: raw.parentName || family.parent_name,
    familyId: family.id,
    studentsNames: raw.studentsNames || studentsNames,
    date: raw.date && raw.date !== '--' ? raw.date : (row.paidDate !== '--' ? row.paidDate : new Date().toISOString().slice(0, 10)),
    month: raw.month || row.month,
    year: raw.year || row.year,
    email: raw.email || raw.parentEmail || family.parent_email || '',
    parentEmail: raw.parentEmail || raw.email || family.parent_email || '',
    whatsapp: raw.whatsapp || family.whatsapp || '',
    currency: raw.currency || row.currency || family.currency || 'USD',
    monthlyFee: raw.monthlyFee ?? row.feeAmount ?? agreedFee,
    totalPayable: raw.totalPayable ?? row.feeAmount ?? agreedFee,
    amountPaid: raw.amountPaid ?? (isPaid ? (row.feeAmount || agreedFee) : 0),
    paymentMethod: raw.paymentMethod || row.paymentMethod || 'Online',
    discount: raw.discount || 0,
    previousBalance: raw.previousBalance || 0,
    creditDeducted: raw.creditDeducted || 0,
    remainingBalance: raw.remainingBalance ?? (isPaid ? 0 : (row.feeAmount || agreedFee)),
    excessPaid: raw.excessPaid || 0,
    status: isPaid ? 'Paid' : 'Unpaid',
    isAdvancePayment: Boolean(raw.isAdvancePayment),
    advanceMonthsCount: raw.advanceMonthsCount || 0,
    isProrated: Boolean(raw.isProrated),
    activeDays: raw.activeDays || 0
  };

  if (typeof openFeeInvoiceModal === 'function') {
    openFeeInvoiceModal(canonicalReceipt);
  } else {
    console.error('Canonical openFeeInvoiceModal not found.');
  }
}
window.viewFamilyPaymentInvoiceModal = viewFamilyPaymentInvoiceModal;

function openEditFamilyPaymentModal(familyId, recordId, month, year) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;
  const payData = _getFamilyPaymentsList(family);
  const row = payData.rows.find(r => r.recordId === recordId || (r.month === month && String(r.year) === String(year)));
  if (!row) return;

  const today = new Date().toISOString().slice(0, 10);
  const dateVal = row.paidDate && row.paidDate !== '--' ? row.paidDate : today;

  _openWorkspaceModal(
    `Edit Payment / Invoice Record`,
    `${family.parent_name} • ${row.monthDisplay}`,
    `
      <form onsubmit="submitEditFamilyPaymentForm(event, '${_esc360(family.id)}', '${_esc360(row.recordId)}', '${_esc360(row.month)}', '${_esc360(row.year)}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Payment Method *</label>
            <input type="text" id="fwEditPayMethod" value="${_esc360(row.paymentMethod)}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Status *</label>
            <select id="fwEditPayStatus" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
              <option value="PAID" ${row.status === 'PAID' ? 'selected' : ''}>PAID</option>
              <option value="UNPAID" ${row.status !== 'PAID' ? 'selected' : ''}>UNPAID</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Paid Date</label>
            <input type="date" id="fwEditPayDate" value="${_esc360(dateVal)}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Fee Amount (${_esc360(row.currency)}) *</label>
            <input type="number" step="0.01" id="fwEditPayFee" value="${_esc360(row.feeAmount)}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Reason / Notes</label>
          <input type="text" id="fwEditPayReason" value="${_esc360(row.reason || 'Monthly Tuition Fee')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold">Save Changes</button>
        </div>
      </form>
    `
  );
}

async function submitEditFamilyPaymentForm(e, familyId, recordId, month, year) {
  e.preventDefault();
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const paymentMethod = document.getElementById('fwEditPayMethod').value.trim();
  const status = document.getElementById('fwEditPayStatus').value;
  const paidDate = status === 'PAID' ? document.getElementById('fwEditPayDate').value : '--';
  const feeAmount = parseFloat(document.getElementById('fwEditPayFee').value) || 0;
  const reason = document.getElementById('fwEditPayReason').value.trim();

  const fNotes = _parseFamilyStructuredNotes(family);
  const receiptKey = recordId.startsWith('AUTO-') ? `AH-REC-${family.id}-${month}-${year}` : recordId;

  const updatedEntry = {
    receiptNo: receiptKey,
    familyId: family.id,
    parentName: family.parent_name,
    month,
    year: Number(year) || 2026,
    date: paidDate,
    amountPaid: status === 'PAID' ? feeAmount : 0,
    amount: feeAmount,
    currency: family.currency || 'USD',
    paymentMethod,
    status,
    reason,
    remarks: reason,
    updated_at: new Date().toISOString()
  };

  const idx = fNotes.fee_history.findIndex(r => r.receiptNo === recordId || r.receiptNo === receiptKey || (r.month === month && String(r.year) === String(year)));
  if (idx >= 0) fNotes.fee_history[idx] = { ...fNotes.fee_history[idx], ...updatedEntry };
  else fNotes.fee_history.unshift(updatedEntry);

  const ovKey = `${String(family.id).toUpperCase()}_${month}_${year}`;
  if (status === 'PAID') {
    fNotes.matrix_overrides[ovKey] = { status: 'paid', amountPaid: feeAmount, date: paidDate };
  } else {
    delete fNotes.matrix_overrides[ovKey];
  }

  // Sync with main Fee System cache
  if (typeof getStoredFeeRecords === 'function' && typeof saveStoredFeeRecords === 'function') {
    const all = getStoredFeeRecords() || [];
    const gIdx = all.findIndex(r => r.receiptNo === recordId || r.receiptNo === receiptKey);
    if (gIdx >= 0) all[gIdx] = { ...all[gIdx], ...updatedEntry };
    else all.unshift(updatedEntry);
    saveStoredFeeRecords(all);
  }

  await _saveFamilyStructuredNotes(family.id, fNotes);
  if (typeof loadFeeDashboardStats === 'function') {
    try { loadFeeDashboardStats(); } catch (err) {}
  }

  _closeWorkspaceModal();
  _notify360(`Payment record for ${month} ${year} updated to ${status}!`);
  _renderFamilyWorkspaceDOM();
}

function emailSpecificFamilyInvoice(familyId, recordId, month, year) {
  viewFamilyPaymentInvoiceModal(familyId, recordId, month, year);
}

async function deleteFamilyPaymentRecord(familyId, recordId, month, year) {
  if (window.CURRENT_ROLE === 'teacher' || window.CURRENT_ROLE === 'student') {
    alert('Access Denied: Only Admin/Management can delete payment entries.');
    return;
  }

  if (!(await lmsConfirm(`Are you sure you want to delete the payment/invoice entry for ${month} ${year}?\n\nThis will remove the record from the backend and recalculate financial totals.`))) return;

  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const fNotes = _parseFamilyStructuredNotes(family);
  fNotes.fee_history = (fNotes.fee_history || []).filter(r => r.receiptNo !== recordId && !(String(r.month).toLowerCase() === String(month).toLowerCase() && String(r.year) === String(year)));

  const ovKey = `${String(family.id).toUpperCase()}_${month}_${year}`;
  if (fNotes.matrix_overrides && ovKey in fNotes.matrix_overrides) {
    delete fNotes.matrix_overrides[ovKey];
  }

  if (!Array.isArray(fNotes.deleted_payment_months)) fNotes.deleted_payment_months = [];
  const delKey = `${String(month).toLowerCase()}_${year}`;
  if (!fNotes.deleted_payment_months.includes(delKey)) {
    fNotes.deleted_payment_months.push(delKey);
  }

  if (typeof getStoredFeeRecords === 'function' && typeof saveStoredFeeRecords === 'function') {
    const filteredGlobal = (getStoredFeeRecords() || []).filter(r => r.receiptNo !== recordId);
    saveStoredFeeRecords(filteredGlobal);
  }

  await _saveFamilyStructuredNotes(family.id, fNotes);
  if (typeof loadFeeDashboardStats === 'function') {
    try { loadFeeDashboardStats(); } catch (err) {}
  }

  _notify360(`Payment entry for ${month} ${year} deleted and financial totals updated.`);
  _renderFamilyWorkspaceDOM();
}

// ============================================================================
// MANAGER NOTES & TEACHER NOTES CRUD (Sections #22 & #23)
// ============================================================================
function openAddOrEditManagerNoteModal(familyId, noteId = null) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;
  const fNotes = _parseFamilyStructuredNotes(family);
  const existing = noteId ? (fNotes.manager_notes || []).find(n => n.id === noteId) : null;

  _openWorkspaceModal(
    existing ? `Edit Manager Note` : `Add New Manager Note`,
    `Family: ${family.parent_name} (${family.id})`,
    `
      <form onsubmit="submitManagerNoteForm(event, '${_esc360(family.id)}', '${_esc360(noteId || '')}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Category</label>
            <select id="fwMgrNoteCat" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="Management Follow-Up" ${existing?.category === 'Management Follow-Up' ? 'selected' : ''}>Management Follow-Up</option>
              <option value="Fee & Billing" ${existing?.category === 'Fee & Billing' ? 'selected' : ''}>Fee &amp; Billing</option>
              <option value="Schedule & Attendance" ${existing?.category === 'Schedule & Attendance' ? 'selected' : ''}>Schedule &amp; Attendance</option>
              <option value="Parent Communication" ${existing?.category === 'Parent Communication' ? 'selected' : ''}>Parent Communication</option>
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Author</label>
            <input type="text" id="fwMgrNoteAuthor" value="${_esc360(existing?.author || (window.CURRENT_ROLE === 'manager' ? 'Operations Manager' : 'Executive Admin'))}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Note Content *</label>
          <textarea id="fwMgrNoteContent" rows="5" required placeholder="Enter detailed administrative note..." class="w-full p-3 rounded-xl border border-slate-300 text-xs text-slate-900">${_esc360(existing?.content || '')}</textarea>
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold">Save Manager Note</button>
        </div>
      </form>
    `
  );
}

async function submitManagerNoteForm(e, familyId, noteId) {
  e.preventDefault();
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const category = document.getElementById('fwMgrNoteCat').value;
  const author = document.getElementById('fwMgrNoteAuthor').value.trim();
  const content = document.getElementById('fwMgrNoteContent').value.trim();

  const fNotes = _parseFamilyStructuredNotes(family);
  if (noteId) {
    const idx = fNotes.manager_notes.findIndex(n => n.id === noteId);
    if (idx >= 0) {
      fNotes.manager_notes[idx] = { ...fNotes.manager_notes[idx], category, author, content };
    }
  } else {
    fNotes.manager_notes.unshift({
      id: `MGR-NOTE-${Date.now()}`,
      category,
      author,
      content,
      created_at: new Date().toISOString().slice(0, 16).replace('T', ' ')
    });
  }

  await _saveFamilyStructuredNotes(family.id, fNotes);
  _closeWorkspaceModal();
  _notify360(`Manager's Note saved to database!`);
  _renderFamilyWorkspaceDOM();
}

async function deleteFamilyManagerNote(familyId, noteId) {
  if (!(await lmsConfirm('Delete this Manager Note permanently?'))) return;
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const fNotes = _parseFamilyStructuredNotes(family);
  fNotes.manager_notes = (fNotes.manager_notes || []).filter(n => n.id !== noteId);
  await _saveFamilyStructuredNotes(family.id, fNotes);
  _notify360(`Manager Note deleted.`);
  _renderFamilyWorkspaceDOM();
}

function openAddTeacherNoteModal(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;
  const famStudents = (window.ALL_STUDENTS || []).filter(s => String(s.family_id).toUpperCase() === String(family.id).toUpperCase());

  _openWorkspaceModal(
    `Add Teacher Note for Student`,
    `Family: ${family.parent_name} (${family.id})`,
    `
      <form onsubmit="submitTeacherNoteForm(event, '${_esc360(family.id)}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Select Student *</label>
            <select id="fwTchNoteStudent" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              ${famStudents.map(s => `<option value="${_esc360(s.id)}">${_esc360(s.name)} (${_esc360(s.id)})</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Instructor Name</label>
            <input type="text" id="fwTchNoteAuthor" value="${_esc360((window.ALL_TEACHERS.find(t => String(t.id) === String(famStudents[0]?.assigned_teacher_id))?.full_name) || 'Assigned Quran Instructor')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Teacher Observation / Note *</label>
          <textarea id="fwTchNoteContent" rows="4" required placeholder="Enter student Tajweed, memorization, or homework feedback..." class="w-full p-3 rounded-xl border border-slate-300 text-xs text-slate-900"></textarea>
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold">Save Teacher Note</button>
        </div>
      </form>
    `
  );
}

async function submitTeacherNoteForm(e, familyId) {
  e.preventDefault();
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const studentId = document.getElementById('fwTchNoteStudent').value;
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  const teacherName = document.getElementById('fwTchNoteAuthor').value.trim();
  const content = document.getElementById('fwTchNoteContent').value.trim();

  const fNotes = _parseFamilyStructuredNotes(family);
  fNotes.teacher_notes.unshift({
    id: `TCH-NOTE-${Date.now()}`,
    studentId,
    studentName: student ? student.name : studentId,
    teacherName,
    content,
    date: new Date().toISOString().slice(0, 10),
    created_at: new Date().toISOString()
  });

  await _saveFamilyStructuredNotes(family.id, fNotes);
  _closeWorkspaceModal();
  _notify360(`Teacher Note saved and linked to ${student ? student.name : 'Family'}!`);
  _renderFamilyWorkspaceDOM();
}

async function deleteFamilyTeacherNote(familyId, noteId) {
  if (!(await lmsConfirm('Delete this Teacher Note?'))) return;
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const fNotes = _parseFamilyStructuredNotes(family);
  fNotes.teacher_notes = (fNotes.teacher_notes || []).filter(n => n.id !== noteId);
  await _saveFamilyStructuredNotes(family.id, fNotes);
  _notify360(`Teacher Note removed.`);
  _renderFamilyWorkspaceDOM();
}

// ============================================================================
// DAILY LESSON & ATTENDANCE RECORDING + CERTIFICATES + PROGRESS (Sections #8, #9, #11)
// ============================================================================
function openRecordDailyLessonModal(familyId, studentId, presetDate = '') {
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;
  const dateVal = presetDate || new Date().toISOString().slice(0, 10);

  _openWorkspaceModal(
    `Record Attendance & Daily Lesson`,
    `Student: ${student.name} (${student.id})`,
    `
      <form onsubmit="submitRecordDailyLessonForm(event, '${_esc360(familyId)}', '${_esc360(student.id)}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Class Date *</label>
            <input type="date" id="fwLessonDate" value="${_esc360(dateVal)}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Attendance Status *</label>
            <select id="fwLessonStatus" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="Present">Present</option>
              <option value="Absent">Absent</option>
              <option value="Leave">Leave</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Book / Surah / Sabaq *</label>
            <input type="text" id="fwLessonBook" value="${_esc360(student.course_id || 'Surah Al-Baqarah / Noorani Qaida')}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Page / Ayah Range</label>
            <input type="text" id="fwLessonPage" placeholder="e.g. Page 14, Lines 1-8" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Teacher's Lesson Notes &amp; Evaluation *</label>
          <textarea id="fwLessonRemarks" rows="3" required placeholder="Enter detailed daily lesson recited by the student..." class="w-full p-2.5 rounded-xl border border-slate-300 text-xs text-slate-900"></textarea>
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold">Save Attendance &amp; Lesson</button>
        </div>
      </form>
    `
  );
}

async function submitRecordDailyLessonForm(e, familyId, studentId) {
  e.preventDefault();
  const date = document.getElementById('fwLessonDate').value;
  const status = document.getElementById('fwLessonStatus').value;
  const book_title = document.getElementById('fwLessonBook').value.trim();
  const page = document.getElementById('fwLessonPage').value.trim();
  const remarks = document.getElementById('fwLessonRemarks').value.trim();

  const lesson_notes = JSON.stringify({
    book_title,
    page,
    status: 'Completed',
    remarks
  });

  await db.from('attendance_logs').upsert([{
    student_id: studentId,
    date,
    status,
    lesson_notes
  }], { onConflict: 'student_id,date' });

  _closeWorkspaceModal();
  _CURRENT_360_STATE.selectedLessonDate = date;
  invalidate360ProfileCache(familyId);
  _notify360(`Attendance (${status}) & Daily Lesson recorded for ${date}!`);
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: studentId, studentSubView: 'history', forceRefresh: true });
}

function openIssueStudentCertificateModal(familyId, studentId) {
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;
  const today = new Date().toISOString().slice(0, 10);

  _openWorkspaceModal(
    `Issue Official Student Certificate`,
    `Student: ${student.name} (${student.id})`,
    `
      <form onsubmit="submitIssueStudentCertificateForm(event, '${_esc360(familyId)}', '${_esc360(student.id)}')" class="space-y-4 text-xs">
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Certificate Title / Milestone *</label>
          <input type="text" id="fwCertTitle" value="${_esc360(student.course_id || 'Noorani Qaida')} Completion Certificate" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Award Date *</label>
            <input type="date" id="fwCertDate" value="${today}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Grade / Distinction</label>
            <select id="fwCertGrade" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="A+ (Mumtaz / Distinction)">A+ (Mumtaz / Distinction)</option>
              <option value="A (Jayyid Jiddan / Excellent)">A (Jayyid Jiddan / Excellent)</option>
              <option value="B+ (Good)">B+ (Good)</option>
            </select>
          </div>
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Citation / Remarks</label>
          <input type="text" id="fwCertRemarks" placeholder="Completed with Tajweed excellence" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold">Issue Certificate</button>
        </div>
      </form>
    `
  );
}

async function submitIssueStudentCertificateForm(e, familyId, studentId) {
  e.preventDefault();
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;

  const title = document.getElementById('fwCertTitle').value.trim();
  const date = document.getElementById('fwCertDate').value;
  const grade = document.getElementById('fwCertGrade').value;
  const remarks = document.getElementById('fwCertRemarks').value.trim();

  const stuMeta = _parseStudentStructuredNotes(student);
  stuMeta.certificates.unshift({
    id: `CERT-${Date.now()}`,
    code: `AH-CERT-${Math.floor(1000 + Math.random() * 9000)}`,
    title,
    date,
    grade,
    remarks
  });

  await _saveStudentRecordBackend(student.id, { notes: JSON.stringify(stuMeta) });
  _closeWorkspaceModal();
  _notify360(`Certificate issued for ${student.name}!`);
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: student.id, studentSubView: 'certificates' });
}

async function deleteStudentCertificate360(familyId, studentId, certId) {
  if (!(await lmsConfirm('Delete this certificate record?'))) return;
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;

  const stuMeta = _parseStudentStructuredNotes(student);
  stuMeta.certificates = (stuMeta.certificates || []).filter(c => c.id !== certId);
  await _saveStudentRecordBackend(student.id, { notes: JSON.stringify(stuMeta) });
  _notify360('Certificate deleted.');
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: student.id, studentSubView: 'certificates' });
}

function printStudentCertificate360(familyId, studentId, certId) {
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;
  const stuMeta = _parseStudentStructuredNotes(student);
  const cert = (stuMeta.certificates || []).find(c => c.id === certId);
  if (!cert) return;

  const w = window.open('', '_blank', 'width=850,height=650');
  if (!w) return;
  w.document.write(`
    <html>
      <head>
        <title>${_esc360(cert.title)} - ${_esc360(student.name)}</title>
        <style>
          body { font-family: Georgia, serif; background: #f8fafc; padding: 30px; text-align: center; }
          .cert-box { border: 8px double #0f172a; background: #fff; padding: 50px; border-radius: 16px; max-width: 720px; margin: 0 auto; }
          h1 { color: #0f172a; font-size: 28px; margin-bottom: 5px; }
          h2 { color: #047857; font-size: 22px; margin: 16px 0; }
          .stu { font-size: 30px; font-weight: bold; color: #1e293b; border-bottom: 2px solid #cbd5e1; display: inline-block; padding: 4px 24px; margin: 12px 0; }
        </style>
      </head>
      <body>
        <div class="cert-box">
          <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#64748b;">Al-Huda Islamic Centre • Official Academic Board</div>
          <h1>CERTIFICATE OF ACHIEVEMENT</h1>
          <p>This is proudly presented to</p>
          <div class="stu">${_esc360(student.name)}</div>
          <h2>${_esc360(cert.title)}</h2>
          <p>Grade / Distinction: <strong>${_esc360(cert.grade)}</strong></p>
          <p>${_esc360(cert.remarks || '')}</p>
          <p style="margin-top:30px;font-size:13px;color:#475569;">Certificate No: <strong>${_esc360(cert.code)}</strong> &bull; Date Awarded: <strong>${_esc360(cert.date)}</strong></p>
        </div>
        <script>window.onload = () => window.print();</script>
      </body>
    </html>
  `);
  w.document.close();
}

function openUpdateStudentProgressModal(familyId, studentId) {
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;
  const stuMeta = _parseStudentStructuredNotes(student);

  _openWorkspaceModal(
    `Update Student Progress Milestone`,
    `Student: ${student.name} (${student.id})`,
    `
      <form onsubmit="submitUpdateStudentProgressForm(event, '${_esc360(familyId)}', '${_esc360(student.id)}')" class="space-y-4 text-xs">
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Current Level / Book *</label>
          <input type="text" id="fwProgLevel" value="${_esc360(stuMeta.current_level || student.course_id || 'Nazra Quran')}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Current Sabaq (Para / Surah / Takhti) *</label>
          <input type="text" id="fwProgSabaq" value="${_esc360(stuMeta.current_sabaq || 'Para 1 - Surah Al-Baqarah')}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Instructor Evaluation Summary</label>
          <input type="text" id="fwProgEval" value="${_esc360(stuMeta.overall_evaluation || 'Excellent Tajweed & Regular Progress')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold">Save Progress</button>
        </div>
      </form>
    `
  );
}

async function submitUpdateStudentProgressForm(e, familyId, studentId) {
  e.preventDefault();
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;

  const stuMeta = _parseStudentStructuredNotes(student);
  stuMeta.current_level = document.getElementById('fwProgLevel').value.trim();
  stuMeta.current_sabaq = document.getElementById('fwProgSabaq').value.trim();
  stuMeta.overall_evaluation = document.getElementById('fwProgEval').value.trim();

  await _saveStudentRecordBackend(student.id, { notes: JSON.stringify(stuMeta) });
  _closeWorkspaceModal();
  _notify360(`Academic progress updated for ${student.name}!`);
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: student.id, studentSubView: 'report' });
}

// ============================================================================
// REQUIREMENT #10: CLICKING TEACHER FROM A STUDENT OPENS TEACHER SCHEDULE/INFO
// ============================================================================
async function openTeacherScheduleFromFamily(teacherId, studentId = null) {
  if (!teacherId) return;
  await openTeacher360Profile(teacherId, 'students', false, { highlightStudentId: studentId });
}

// ============================================================================
// TEACHER 360° PROFILE COMMAND CENTER — SINGLE SOURCE OF TRUTH & LIVE SYNC
// ============================================================================

function _resolveTeacherCustomMeta(teacher) {
  if (!teacher) return {};
  const accounts = (typeof getTeacherAccounts === 'function') ? getTeacherAccounts() : {};
  const acc = accounts[teacher.id] || {};
  let parsedAddr = {};
  let parsedNotes = {};
  try {
    if (typeof teacher.address === 'string' && teacher.address.trim().startsWith('{')) {
      parsedAddr = JSON.parse(teacher.address);
    }
  } catch (e) {}
  try {
    if (typeof teacher.notes === 'string' && teacher.notes.trim().startsWith('{')) {
      parsedNotes = JSON.parse(teacher.notes);
    }
  } catch (e) {}

  const creds = (typeof getTeacherCreds === 'function') ? getTeacherCreds(teacher) : {};
  return {
    ...parsedAddr,
    ...parsedNotes,
    ...creds,
    ...acc
  };
}

async function _persistTeacher360Updates(teacherId, dbFields = {}, customMetaPatch = {}) {
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return false;

  const existingMeta = _resolveTeacherCustomMeta(teacher);
  const updatedMeta = {
    ...existingMeta,
    ...customMetaPatch,
    updated_at: new Date().toISOString()
  };

  if (typeof saveTeacherAccount === 'function') {
    saveTeacherAccount(teacher.id, updatedMeta);
  }

  let existingAddrObj = {};
  try {
    if (typeof teacher.address === 'string' && teacher.address.trim().startsWith('{')) {
      existingAddrObj = JSON.parse(teacher.address);
    }
  } catch (e) {}

  const mergedAddrJson = JSON.stringify({
    ...existingAddrObj,
    ...updatedMeta,
    residential_address: updatedMeta.residential_address ?? existingAddrObj.residential_address ?? (typeof teacher.address === 'string' && !teacher.address.trim().startsWith('{') ? teacher.address : '')
  });

  const dbPayload = {
    ...dbFields,
    address: mergedAddrJson
  };

  Object.assign(teacher, dbPayload);
  try {
    await db.from('teachers').update(dbPayload).eq('id', teacher.id);
  } catch (err) {
    console.warn('[Teacher 360] Supabase update notice:', err);
  }

  if (typeof invalidateCoreLmsDataCache === 'function') {
    invalidateCoreLmsDataCache();
  }
  delete _TEACHER_360_MEM_CACHE[String(teacher.id).toUpperCase()];
  return true;
}

function _compileTeacher360AggregatedState(teacher, tchSchedules = [], attLogs = []) {
  const meta = _resolveTeacherCustomMeta(teacher);
  const empCode = meta.teacher_id || meta.emp_id || (String(teacher.witness_name || '').startsWith('MGR-') || String(teacher.witness_name || '').startsWith('STF-') ? teacher.witness_name : null) || `TCH-001`;
  const isManager = meta.employee_type === 'manager' || teacher.working_shift === 'Manager' || String(empCode).startsWith('MGR-');
  const isOtherStaff = meta.employee_type === 'other_staff' || String(empCode).startsWith('STF-');
  const roleDesignation = isManager
    ? (meta.role_title || 'Operations Manager')
    : isOtherStaff
    ? (meta.role_title || 'Support & Administrative Staff')
    : (meta.role_title || 'Teacher');

  // 1. Authoritative Student-Teacher Relationship (via assigned_teacher_id, strictly excluding deactivated & reassigned students)
  tchSchedules = (tchSchedules || []).filter(sc => {
    const stObj = (window.ALL_STUDENTS || []).find(s => String(s.id || '').toUpperCase() === String(sc.student_id || '').toUpperCase()) || sc.students;
    if (stObj && typeof isStudentSelfDeactivated === 'function' && isStudentSelfDeactivated(stObj)) return false;
    if (stObj && stObj.assigned_teacher_id && String(stObj.assigned_teacher_id) !== String(teacher.id)) return false;
    return true;
  });
  const allMatchedStudents = (window.ALL_STUDENTS || []).filter(s => {
    if (typeof isStudentSelfDeactivated === 'function' && isStudentSelfDeactivated(s)) return false;
    const st = String(s.status || 'Active').toLowerCase();
    if (st === 'inactive' || st === 'deactivated' || st === 'left' || st === 'deleted' || st === 'trial' || st === 'converted') return false;
    return String(s.assigned_teacher_id || '') === String(teacher.id);
  });

  const activeStudents = allMatchedStudents.filter(s => {
    const st = String(s.status || 'Active').trim().toLowerCase();
    if (st === 'inactive' || st === 'deactivated' || st === 'left' || st === 'deleted' || st === 'leave') return false;
    try {
      const sNotes = typeof s.notes === 'string' ? JSON.parse(s.notes || '{}') : (s.notes || {});
      if (sNotes && sNotes.on_leave === true) return false;
    } catch (e) {}
    return true;
  });

  // 2. Authoritative Salary & Payroll Engine (Connected directly to alhuda_teacher_salaries & payroll.js)
  let savedSalaries = {};
  try {
    savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
  } catch (e) {
    savedSalaries = {};
  }

  const seniorityInc = (typeof getTeacherSeniorityIncrement === 'function')
    ? getTeacherSeniorityIncrement(teacher, meta)
    : 0;

  // Calculate current month base salary from assigned active students (or fixed staff salary)
  let currentBaseSubtotal = 0;
  const studentRateBreakdown = activeStudents.filter(s => String(s.status || '').toLowerCase() !== 'trial').map((stu, idx) => {
    const stuScheds = (tchSchedules || []).filter(sc => String(sc.student_id).toUpperCase() === String(stu.id).toUpperCase());
    const rateInfo = (typeof getStudentCourseSalaryRate === 'function')
      ? getStudentCourseSalaryRate(stu, stuScheds, seniorityInc)
      : { baseRate: Number(teacher.rate_per_slot || 2200), increment: seniorityInc, finalRate: Number(teacher.rate_per_slot || 2200) + seniorityInc, courseLabel: stu.course_id || 'Quran Studies', scheduleText: 'Regular Slot' };
    currentBaseSubtotal += rateInfo.finalRate;
    return {
      index: idx + 1,
      student: stu,
      ...rateInfo
    };
  });

  if (currentBaseSubtotal === 0 && (Number(meta.salary) > 0 || Number(teacher.rate_per_slot) > 0)) {
    currentBaseSubtotal = Number(meta.salary || teacher.rate_per_slot || 2500);
  }

  // Current Month Deductions & Leaves from authoritative records
  const currentMonthLabel = document.getElementById('salaryMonthSelect')?.value || 'September 2026';
  const currentSlipKey = `${teacher.id}_${currentMonthLabel.replace(/\s+/g, '_')}`;
  const currentSavedSlip = savedSalaries[currentSlipKey] || null;

  const customDeductionsList = Array.isArray(meta.deduction_records) ? meta.deduction_records : [];
  const currentMonthDeductionItems = customDeductionsList.filter(d => !d.month || d.month === currentMonthLabel);
  const itemizedDeductionsSum = currentMonthDeductionItems.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
  const slipDeductionVal = currentSavedSlip ? (parseFloat(currentSavedSlip.deduction) || 0) : 0;
  const effectiveCurrentDeductions = Math.max(itemizedDeductionsSum, slipDeductionVal);

  // If slip has a deduction not yet in itemized list, surface it cleanly as an official payroll deduction row
  const displayDeductionRows = [...currentMonthDeductionItems];
  if (slipDeductionVal > itemizedDeductionsSum) {
    displayDeductionRows.unshift({
      id: `SLIP-DED-${currentSlipKey}`,
      type: 'Payroll Slip Deduction',
      category: 'Salary Adjustment',
      amount: slipDeductionVal - itemizedDeductionsSum,
      date: (currentSavedSlip?.saved_at || new Date().toISOString()).slice(0, 10),
      month: currentMonthLabel,
      reason: currentSavedSlip?.remarks || 'Recorded via Monthly Payroll Slip',
      status: 'Applied'
    });
  }

  const currentBonusVal = currentSavedSlip ? (parseFloat(currentSavedSlip.bonus) || 0) : (parseFloat(meta.current_bonus) || 0);
  const currentNetSalary = Math.max(0, currentBaseSubtotal + currentBonusVal - effectiveCurrentDeductions);

  // Build Historical & Current Salary Records List (Strictly without Fixed / Makeup / Fine crossed-out columns!)
  const salaryHistoryMap = new Map();
  const knownMonths = ['October 2025', 'November 2025', 'January 2026', 'March 2026', 'July 2026', 'August 2026', 'September 2026'];

  // First load any explicit saved slips for this teacher
  Object.entries(savedSalaries).forEach(([key, slip]) => {
    if (slip && String(slip.teacher_id) === String(teacher.id)) {
      const mLabel = slip.month || key.replace(`${teacher.id}_`, '').replace(/_/g, ' ');
      salaryHistoryMap.set(mLabel, {
        slipKey: key,
        monthYear: mLabel.replace(/\s+/g, '-'),
        monthRaw: mLabel,
        studentsCount: slip.students ? Object.keys(slip.students).length : activeStudents.length,
        baseAmount: parseFloat(slip.base_subtotal ?? currentBaseSubtotal) || currentBaseSubtotal,
        bonusAmount: parseFloat(slip.bonus || 0) || 0,
        deductionsAmount: parseFloat(slip.deduction || 0) || 0,
        paidAmount: parseFloat(slip.net_payable ?? currentNetSalary) || currentNetSalary,
        status: slip.status || 'Paid',
        paidDate: (slip.saved_at || '2026-09-25').slice(0, 10),
        remarks: slip.remarks || 'Course-Based Monthly Payroll'
      });
    }
  });

  // Ensure current month & historical enrolled months since joining date are represented
  const deletedSalaryMonths = new Set(Array.isArray(meta.deleted_salary_months) ? meta.deleted_salary_months : []);
  const joinDateStr = meta.joining_date || (teacher.created_at ? teacher.created_at.slice(0, 10) : '2025-10-01');
  const joinTimestamp = new Date(joinDateStr).getTime() || new Date('2025-10-01').getTime();

  knownMonths.forEach(mLabel => {
    const mHyphen = mLabel.replace(/\s+/g, '-');
    if (deletedSalaryMonths.has(mLabel) || deletedSalaryMonths.has(mHyphen)) return;
    if (!salaryHistoryMap.has(mLabel)) {
      const mDate = new Date(`1 ${mLabel}`).getTime();
      if (!isNaN(mDate) && mDate < joinTimestamp - (31 * 86400000) && mLabel !== currentMonthLabel) return;
      const isCurrent = mLabel === currentMonthLabel;
      salaryHistoryMap.set(mLabel, {
        slipKey: `${teacher.id}_${mLabel.replace(/\s+/g, '_')}`,
        monthYear: mHyphen,
        monthRaw: mLabel,
        studentsCount: activeStudents.length,
        baseAmount: currentBaseSubtotal,
        bonusAmount: isCurrent ? currentBonusVal : 0,
        deductionsAmount: isCurrent ? effectiveCurrentDeductions : 0,
        paidAmount: isCurrent ? currentNetSalary : currentBaseSubtotal,
        status: isCurrent ? (currentSavedSlip?.status || 'Pending') : 'Paid',
        paidDate: isCurrent ? (currentSavedSlip?.saved_at ? currentSavedSlip.saved_at.slice(0, 10) : 'Current Cycle') : mLabel,
        remarks: isCurrent ? (currentSavedSlip?.remarks || 'Active Payroll Cycle') : 'Disbursed Payroll Record'
      });
    }
  });

  const salaryRows = Array.from(salaryHistoryMap.values());

  // 3. Authoritative Teacher Leaves (from teacher meta.leave_records + PENDING_TEACHER_REQUESTS + attendance logs)
  const customLeaves = Array.isArray(meta.leave_records) ? meta.leave_records : [];
  const globalReqsForTeacher = (window.PENDING_TEACHER_REQUESTS || []).filter(item =>
    String(item.student?.assigned_teacher_id) === String(teacher.id) ||
    String(item.request?.teacher_id) === String(teacher.id) ||
    String(item.request?.teacher_name || '').toLowerCase() === String(teacher.full_name || '').toLowerCase()
  );

  const leaveRows = [...customLeaves];
  globalReqsForTeacher.forEach((reqItem, idx) => {
    if (reqItem.requestType === 'leave' || reqItem.requestType === 'reschedule') {
      leaveRows.push({
        id: `REQ-LV-${idx}`,
        startDate: reqItem.request?.date || new Date().toISOString().slice(0, 10),
        endDate: reqItem.request?.return_date || reqItem.request?.date || new Date().toISOString().slice(0, 10),
        leaveType: reqItem.requestType === 'leave' ? 'Class Leave Request' : 'Attendance / Reschedule Request',
        duration: '1 Day',
        reason: reqItem.request?.reason || `Student: ${reqItem.student?.name || ''}`,
        status: (reqItem.request?.status || 'Pending').toUpperCase()
      });
    }
  });

  // 4. Attendance Rate Calculation from real attendance_logs
  let attendanceRatePercent = 96;
  if (Array.isArray(attLogs) && attLogs.length > 0) {
    const presentCount = attLogs.filter(l => {
      const st = String(l.status || '').toLowerCase();
      return st === 'present' || st === 'completed' || st === 'late';
    }).length;
    attendanceRatePercent = Math.round((presentCount / attLogs.length) * 100);
  } else if (activeStudents.length === 0) {
    attendanceRatePercent = 100;
  }

  // 5. Teacher Documents & Notes
  const documentsList = Array.isArray(meta.documents) ? meta.documents : [];
  const notesList = Array.isArray(meta.teacher_360_notes) ? meta.teacher_360_notes : [];
  if (meta.extra_notes && !notesList.some(n => n.text === meta.extra_notes)) {
    notesList.push({
      id: 'INIT-NOTE',
      category: 'Administrative Note',
      author: 'System Admin',
      date: joinDateStr,
      text: meta.extra_notes
    });
  }

  return {
    teacher,
    meta,
    empCode,
    isManager,
    isOtherStaff,
    roleDesignation,
    joinDateStr,
    seniorityInc,
    allMatchedStudents,
    activeStudents,
    tchSchedules,
    studentRateBreakdown,
    currentMonthLabel,
    currentBaseSubtotal,
    currentBonusVal,
    effectiveCurrentDeductions,
    currentNetSalary,
    salaryRows,
    displayDeductionRows,
    leaveRows,
    attendanceRatePercent,
    documentsList,
    notesList
  };
}

function switchTeacher360Tab(tabId) {
  if (!_CURRENT_360_STATE.id) return;
  _CURRENT_360_STATE.activeTab = tabId;
  const tchKey = String(_CURRENT_360_STATE.id).toUpperCase();
  const cached = _TEACHER_360_MEM_CACHE[tchKey];
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(_CURRENT_360_STATE.id));
  if (teacher) {
    _renderTeacher360WorkspaceDOM(
      teacher,
      cached?.tchSchedules || (window.ALL_CLASS_SCHEDULES || []).filter(sc => String(sc.teacher_id) === String(teacher.id)),
      cached?.attLogs || [],
      tabId,
      _CURRENT_360_STATE.options || {}
    );
  }
}

async function openTeacher360Profile(teacherId, initialTab = 'students', skipHistoryPush = false, options = {}) {
  if (!teacherId) return;

  // If caller explicitly requested 'schedule', open Teacher 360 AND launch the dedicated 24h/7d Schedule Matrix
  const shouldOpenDedicatedSchedule = (initialTab === 'schedule');

  // Map tab aliases to the clean Teacher 360 Information Architecture
  const normalizedTab = (initialTab === 'students' || initialTab === 'list_of_students')
    ? 'students'
    : (initialTab === 'deductions_leaves' || initialTab === 'deductions' || initialTab === 'current_month_deductions' || initialTab === 'leaves' || initialTab === 'current_month_leaves')
    ? 'deductions_leaves'
    : (initialTab === 'biodata' || initialTab === 'bio_data' || initialTab === 'overview')
    ? 'biodata'
    : (initialTab === 'documents')
    ? 'documents'
    : (initialTab === 'salary' || initialTab === 'salary_details')
    ? 'salary'
    : 'students';

  _activateFullScreenProfilePage('teacher');
  const workspace = document.getElementById('unified360PageWorkspace');
  if (!workspace) return;

  const searchKey = String(teacherId).trim();
  const searchKeyUpper = searchKey.toUpperCase();

  const findTeacherInMemory = () => {
    const list = window.ALL_TEACHERS || [];
    return list.find(t => {
      if (String(t.id) === searchKey || String(t.id).toUpperCase() === searchKeyUpper) return true;
      const m = _resolveTeacherCustomMeta(t);
      if (String(m.teacher_id || '').toUpperCase() === searchKeyUpper) return true;
      if (String(m.emp_id || '').toUpperCase() === searchKeyUpper) return true;
      if (String(m.username || '').toUpperCase() === searchKeyUpper) return true;
      return false;
    });
  };

  let teacher = findTeacherInMemory();

  if (!teacher) {
    workspace.innerHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 shadow-2xs">
        <i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-600 mb-3 block"></i>
        <span class="text-sm font-extrabold">Opening Teacher 360° Profile...</span>
      </div>
    `;
    await _ensure360CoreDataReady();
    teacher = findTeacherInMemory();
    if (!teacher) {
      const { data } = await db.from('teachers').select('*').eq('id', teacherId).maybeSingle();
      teacher = data;
      if (teacher && Array.isArray(window.ALL_TEACHERS) && !window.ALL_TEACHERS.some(t => String(t.id) === String(teacher.id))) {
        window.ALL_TEACHERS.push(teacher);
      }
    }
  }

  if (!teacher) {
    workspace.innerHTML = `
      ${_buildTopWorkspaceNavHtml()}
      <div class="p-12 bg-white rounded-2xl border border-slate-200 text-center space-y-3">
        <i class="fa-solid fa-user-slash text-3xl text-rose-500 block"></i>
        <h3 class="text-base font-black text-slate-900">Teacher Profile Not Found</h3>
        <p class="text-xs text-slate-500">No instructor or staff member matches ID: ${_esc360(teacherId)}.</p>
      </div>
    `;
    return;
  }

  const tchKey = String(teacher.id).toUpperCase();
  _CURRENT_360_STATE.type = 'teacher';
  _CURRENT_360_STATE.id = teacher.id;
  _CURRENT_360_STATE.activeTab = normalizedTab;
  _CURRENT_360_STATE.options = options || {};

  if (!skipHistoryPush) {
    _push360History('teacher', teacher.id, teacher.full_name, normalizedTab);
  }
  if (typeof updateBackBtnVisibility === 'function') {
    updateBackBtnVisibility();
  }

  const cachedTch = _TEACHER_360_MEM_CACHE[tchKey];
  const initialTchSchedules = cachedTch?.tchSchedules ||
    (Array.isArray(window.ALL_CLASS_SCHEDULES)
      ? window.ALL_CLASS_SCHEDULES.filter(sc => String(sc.teacher_id) === String(teacher.id))
      : []);
  const initialAttLogs = cachedTch?.attLogs || [];

  // PHASE 1 & 2: Instant Synchronous Render (< 5ms, zero blocking spinner!)
  _renderTeacher360WorkspaceDOM(teacher, initialTchSchedules, initialAttLogs, normalizedTab, options);

  if (shouldOpenDedicatedSchedule) {
    openTeacherDedicatedScheduleFrom360(teacher.id);
  }

  // PHASE 3: Non-Blocking Background Refresh & Hydration
  const isCacheFresh = cachedTch && !options.forceRefresh && (Date.now() - cachedTch.ts < 30000);
  if (isCacheFresh) return;

  try {
    const stuIds = (window.ALL_STUDENTS || [])
      .filter(s => String(s.assigned_teacher_id) === String(teacher.id))
      .map(s => s.id);

    const [schedRes, attRes] = await Promise.all([
      db.from('class_schedules').select('*, students(*)').eq('teacher_id', teacher.id),
      stuIds.length > 0
        ? db.from('attendance_logs').select('student_id, date, status, lesson_notes').in('student_id', stuIds).limit(200)
        : Promise.resolve({ data: [] })
    ]);

    const freshScheds = schedRes?.data || initialTchSchedules;
    const freshAtt = attRes?.data || initialAttLogs;

    _TEACHER_360_MEM_CACHE[tchKey] = {
      tchSchedules: freshScheds,
      attLogs: freshAtt,
      ts: Date.now()
    };

    if (_CURRENT_360_STATE.type === 'teacher' && String(_CURRENT_360_STATE.id).toUpperCase() === tchKey) {
      _renderTeacher360WorkspaceDOM(teacher, freshScheds, freshAtt, _CURRENT_360_STATE.activeTab || normalizedTab, options);
    }
  } catch (err) {
    console.warn('[Teacher 360] Background hydration notice:', err);
  }
}

function _renderTeacher360WorkspaceDOM(teacher, tchSchedules, attLogs, activeTab, options = {}) {
  const workspace = document.getElementById('unified360PageWorkspace');
  if (!workspace) return;

  // Normalize any legacy tab keys
  const resolvedTab = (activeTab === 'deductions' || activeTab === 'leaves' || activeTab === 'deductions_leaves')
    ? 'deductions_leaves'
    : (activeTab === 'overview' || activeTab === 'biodata')
    ? 'biodata'
    : (activeTab === 'documents')
    ? 'documents'
    : (activeTab === 'salary')
    ? 'salary'
    : 'students';

  const state = _compileTeacher360AggregatedState(teacher, tchSchedules, attLogs);
  const {
    meta,
    empCode,
    roleDesignation,
    joinDateStr,
    allMatchedStudents,
    displayDeductionRows,
    leaveRows,
    documentsList
  } = state;

  const isAccountActive = String(teacher.status || 'Active').toLowerCase() === 'active';
  const statusBadgeStyle = isAccountActive
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
    : 'bg-rose-500/25 text-rose-200 border-rose-400/50';

  const avatarHtml = meta.avatar_url
    ? `<img src="${_esc360(meta.avatar_url)}" alt="${_esc360(teacher.full_name)}" class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-amber-400/80 shadow-lg bg-slate-800">`
    : `<div class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-emerald-500/30 to-teal-700/40 border-2 border-amber-400/70 flex items-center justify-center text-2xl sm:text-3xl font-black text-amber-300 shadow-lg">
         ${_esc360((teacher.full_name || 'T').charAt(0).toUpperCase())}
       </div>`;

  // TARGET STRUCTURE: ONLY 4 MEANINGFUL SECTIONS IN LOWER TEACHER 360 NAVIGATION
  const navTabs = [
    { id: 'students', label: 'List of Students', icon: 'fa-user-graduate', count: allMatchedStudents.length },
    { id: 'deductions_leaves', label: 'Current Month Deductions & Leaves', icon: 'fa-scale-unbalanced', count: displayDeductionRows.length + leaveRows.length },
    { id: 'biodata', label: 'Bio Data', icon: 'fa-address-card', count: null },
    { id: 'documents', label: 'Documents', icon: 'fa-folder-open', count: documentsList.length }
  ];

  let activeTabContentHtml = '';
  if (resolvedTab === 'students') {
    activeTabContentHtml = _buildTeacherStudentsListTabHtml(state, options);
  } else if (resolvedTab === 'deductions_leaves') {
    activeTabContentHtml = _buildTeacherDeductionsAndLeavesTabHtml(state);
  } else if (resolvedTab === 'biodata') {
    activeTabContentHtml = _buildTeacherBioDataTabHtml(state);
  } else if (resolvedTab === 'documents') {
    activeTabContentHtml = _buildTeacherDocumentsTabHtml(state);
  } else if (resolvedTab === 'salary') {
    activeTabContentHtml = _buildTeacherSalaryDetailsTabHtml(state);
  } else {
    activeTabContentHtml = _buildTeacherStudentsListTabHtml(state, options);
  }

  const isSalaryActive = (resolvedTab === 'salary');

  workspace.innerHTML = `
    ${_buildTopWorkspaceNavHtml()}

    <!-- TEACHER 360° COMMAND CENTER MAIN CONTAINER -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

      <!-- CLEAN EXECUTIVE TEACHER IDENTITY HEADER (NO REDUNDANT KPI CARDS) -->
      <div class="bg-gradient-to-b from-slate-900 via-slate-900 to-indigo-950 text-white px-4 sm:px-6 pt-5 pb-0">
        <div class="max-w-5xl mx-auto flex flex-col items-center text-center space-y-3.5 pb-4">

          <!-- 1. TEACHER IDENTITY BLOCK -->
          <div class="flex flex-col items-center max-w-full">
            <div class="relative group cursor-pointer mb-2" onclick="openTeacherEditPictureModal('${_esc360(teacher.id)}')" title="Click to Edit Profile Picture">
              ${avatarHtml}
              <span class="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 border border-white/25 text-amber-300 flex items-center justify-center text-[10px] shadow-md transition">
                <i class="fa-solid fa-camera"></i>
              </span>
            </div>

            <div class="flex items-center justify-center gap-2 sm:gap-2.5 flex-wrap px-2">
              <h1 class="text-xl sm:text-2xl font-black tracking-tight text-white capitalize">${_esc360(teacher.full_name)}</h1>
              <span class="px-2.5 py-0.5 rounded-md bg-white/10 border border-white/20 font-mono text-xs font-extrabold text-amber-300 whitespace-nowrap">${_esc360(empCode)}</span>
              <span class="px-2.5 py-0.5 rounded-md border text-[11px] font-black uppercase tracking-wider whitespace-nowrap ${statusBadgeStyle}">
                ${isAccountActive ? 'ACTIVE' : 'DEACTIVATED'}
              </span>
            </div>

            <div class="flex items-center justify-center gap-2 flex-wrap text-xs text-slate-300 mt-1">
              <span class="font-bold text-emerald-300">${_esc360(roleDesignation)}</span>
              <span>&bull;</span>
              <span>Shift: <strong class="text-white">${_esc360(teacher.working_shift || 'Regular Shift')}</strong></span>
              <span>&bull;</span>
              <span>Joined: <strong class="font-mono text-slate-200">${_esc360(joinDateStr)}</strong></span>
            </div>
          </div>

          <!-- 2. MAIN ACTIONS ROW (CONSISTENT BUTTON HIERARCHY, ZERO DUPLICATION) -->
          <div class="grid grid-cols-2 sm:grid-cols-4 lg:flex lg:items-center lg:justify-center lg:flex-wrap gap-2 w-full pt-1">
            <button onclick="openTeacherEditPictureModal('${_esc360(teacher.id)}')"
                    class="h-9 px-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 text-xs font-bold transition inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-image text-slate-300"></i>
              <span>Edit Picture</span>
            </button>

            <button onclick="openTeacher360EditProfileModal('${_esc360(teacher.id)}')"
                    class="h-9 px-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 text-xs font-bold transition inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-user-pen text-indigo-300"></i>
              <span>Edit Profile</span>
            </button>

            <button onclick="openTeacherUploadDocsModal('${_esc360(teacher.id)}')"
                    class="h-9 px-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 text-xs font-bold transition inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-file-arrow-up text-sky-300"></i>
              <span>Upload Docs</span>
            </button>

            <button onclick="openTeacherStudentRelationshipModal('${_esc360(teacher.id)}')"
                    class="h-9 px-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 text-xs font-bold transition inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                    title="Assign or Transfer Students & Manage Course Rates">
              <i class="fa-solid fa-users-gear text-emerald-300"></i>
              <span>Student Details</span>
            </button>

            <button onclick="switchTeacher360Tab('salary')"
                    class="h-9 px-3.5 rounded-xl ${isSalaryActive ? 'bg-amber-400 text-slate-950 border border-amber-300 font-black shadow-xs' : 'bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 font-bold'} text-xs transition inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                    title="Open Teacher Salary Ledger & Monthly Payroll Slips">
              <i class="fa-solid fa-file-invoice-dollar ${isSalaryActive ? 'text-slate-950' : 'text-amber-300'}"></i>
              <span>Salary Record</span>
            </button>

            <button onclick="openTeacherDedicatedScheduleFrom360('${_esc360(teacher.id)}')"
                    class="h-9 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/50 text-white text-xs font-extrabold transition inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs"
                    title="Open Dedicated 24-Hour / 7-Day Weekly Schedule Matrix">
              <i class="fa-solid fa-calendar-days"></i>
              <span>Schedule</span>
            </button>

            <button onclick="openTeacherSalaryAdjustmentModal('${_esc360(teacher.id)}')"
                    class="h-9 px-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 text-xs font-bold transition inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-sliders text-purple-300"></i>
              <span>Salary Adjustment</span>
            </button>

            <button onclick="handleTeacher360ToggleAccountStatus('${_esc360(teacher.id)}')"
                    class="h-9 px-3.5 rounded-xl ${isAccountActive ? 'bg-rose-500/20 hover:bg-rose-600 border border-rose-400/50 text-rose-200 hover:text-white' : 'bg-emerald-500/20 hover:bg-emerald-600 border border-emerald-400/50 text-emerald-200 hover:text-white'} text-xs font-extrabold transition inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid ${isAccountActive ? 'fa-user-lock' : 'fa-user-check'}"></i>
              <span>${isAccountActive ? 'Deactivate Account' : 'Activate Account'}</span>
            </button>
          </div>
        </div>

        <!-- 3. TEACHER 360 NAVIGATION (4 PURPOSE-SPECIFIC SECTIONS) -->
        <div class="flex items-center justify-start lg:justify-center gap-1.5 pt-2 overflow-x-auto no-scrollbar border-t border-white/10 px-1">
          ${navTabs.map(t => {
            const isActive = resolvedTab === t.id;
            return `
              <button onclick="switchTeacher360Tab('${t.id}')"
                      class="px-4 py-2.5 rounded-t-xl text-xs font-extrabold transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 ${
                        isActive
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white'
                      }">
                <i class="fa-solid ${t.icon} ${isActive ? 'text-indigo-600' : 'text-slate-400'}"></i>
                <span>${_esc360(t.label)}</span>
                ${t.count !== null ? `
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] font-black ${isActive ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-700 text-slate-300'}">
                    ${t.count}
                  </span>
                ` : ''}
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <!-- 4. SELECTED SECTION CONTENT AREA -->
      <div class="bg-white p-4 sm:p-6">
        ${activeTabContentHtml}
      </div>
    </div>

    <!-- DEDICATED ACTION MODAL CONTAINER FOR TEACHER & FAMILY 360 OPERATIONS -->
    <div id="familyWorkspaceActionModal" class="hidden fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-[110] items-center justify-center p-4"></div>
  `;
}

// ============================================================================
// SALARY RECORD VIEW (OPENED VIA MAIN ACTION 'SALARY RECORD')
// ============================================================================
function _buildTeacherSalaryDetailsTabHtml(state) {
  const { teacher, salaryRows, currentMonthLabel, currentBaseSubtotal, currentBonusVal, effectiveCurrentDeductions, currentNetSalary } = state;

  return `
    <div class="space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3.5">
        <div>
          <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
            <i class="fa-solid fa-file-invoice-dollar text-amber-600"></i>
            <span>Teacher Salary Record &amp; Disbursed Ledger</span>
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">Synchronized with the LMS Auto Payroll Engine (${_esc360(currentMonthLabel)} Net Payable: <strong>PKR ${currentNetSalary.toLocaleString()}</strong>)</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button onclick="switchTeacher360Tab('students')"
                  class="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer">
            <i class="fa-solid fa-arrow-left"></i> Back to Students List
          </button>
          <button onclick="openTeacherSalaryAdjustmentModal('${_esc360(teacher.id)}')"
                  class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs">
            <i class="fa-solid fa-sliders text-purple-300"></i> Add Bonus / Deduction
          </button>
          <button onclick="openTeacher360SalarySlipAction('${_esc360(teacher.id)}')"
                  class="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs">
            <i class="fa-solid fa-receipt"></i> Open Official Payroll Slip
          </button>
        </div>
      </div>

      <!-- Summary Strip -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
          <div>
            <span class="text-[11px] font-bold text-slate-500 uppercase block">Course Base Teaching</span>
            <span class="text-xs text-slate-400">From ${state.activeStudents.length} Active Students</span>
          </div>
          <div class="lms-num-financial text-lg font-black text-slate-900">PKR ${currentBaseSubtotal.toLocaleString()}</div>
        </div>

        <div class="p-3.5 rounded-xl bg-rose-50/60 border border-rose-200 flex items-center justify-between">
          <div>
            <span class="text-[11px] font-bold text-rose-800 uppercase block">Current Month Deductions</span>
            <span class="text-xs text-rose-600">${state.displayDeductionRows.length} Active Deduction(s)</span>
          </div>
          <div class="lms-num-financial text-lg font-black text-rose-700">- PKR ${effectiveCurrentDeductions.toLocaleString()}</div>
        </div>

        <div class="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between">
          <div>
            <span class="text-[11px] font-bold text-emerald-900 uppercase block">Net Payable (${_esc360(currentMonthLabel)})</span>
            <span class="text-xs text-emerald-700">${currentBonusVal > 0 ? `Includes +PKR ${currentBonusVal.toLocaleString()} Bonus` : 'Verified Net Total'}</span>
          </div>
          <div class="lms-num-financial text-xl font-black text-emerald-800">Rs. ${currentNetSalary.toLocaleString()}.00</div>
        </div>
      </div>

      <!-- Clean Modern Salary Table (Fixed, Makeup, and Fine columns intentionally removed) -->
      <div class="overflow-x-auto border border-slate-200 rounded-2xl shadow-2xs">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
            <tr>
              <th class="p-3.5">Month-Year</th>
              <th class="p-3.5">Deductions &darr;</th>
              <th class="p-3.5">Paid</th>
              <th class="p-3.5">Status</th>
              <th class="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${salaryRows.map(row => {
              const isPaid = String(row.status).toLowerCase() === 'paid';
              return `
                <tr class="hover:bg-slate-50/80 transition">
                  <td class="p-3.5 font-mono font-extrabold text-slate-800">${_esc360(row.monthYear)}</td>
                  <td class="p-3.5 font-mono font-bold ${row.deductionsAmount > 0 ? 'text-rose-700' : 'text-slate-600'}">
                    ${Number(row.deductionsAmount || 0).toFixed(2)}
                  </td>
                  <td class="p-3.5">
                    <span class="lms-num-financial font-black text-slate-900 text-sm">Rs. ${Number(row.paidAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </td>
                  <td class="p-3.5">
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-black border ${isPaid ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-amber-100 text-amber-900 border-amber-300'}">
                      ${_esc360(row.status)}
                    </span>
                  </td>
                  <td class="p-3.5 text-right">
                    <div class="inline-flex items-center justify-end gap-2">
                      <button onclick="openTeacherSalaryRowDetailsModal('${_esc360(teacher.id)}', '${_esc360(row.monthRaw)}')"
                              class="px-3 py-1.5 rounded-lg border border-emerald-500 text-emerald-700 hover:bg-emerald-50 font-extrabold text-xs transition cursor-pointer">
                        See Details
                      </button>
                      ${(typeof CURRENT_ROLE === 'undefined' || CURRENT_ROLE !== 'manager') ? `
                        <button onclick="deleteTeacherSalaryMonthRecord360('${_esc360(teacher.id)}', '${_esc360(row.monthRaw)}', '${_esc360(row.slipKey)}')"
                                class="px-3 py-1.5 rounded-lg border border-rose-400 text-rose-600 hover:bg-rose-50 font-extrabold text-xs transition cursor-pointer">
                          Delete
                        </button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================================================
// SECTION 1: LIST OF STUDENTS (SEPARATE FROM SCHEDULE — NO SCHEDULE SLOTS)
// ============================================================================
function _buildTeacherStudentsListTabHtml(state, options = {}) {
  const { teacher, allMatchedStudents } = state;

  return `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
            <i class="fa-solid fa-user-graduate text-indigo-600"></i>
            <span>List of Students (${allMatchedStudents.length})</span>
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">Students assigned to ${_esc360(teacher.full_name)}. Click any Student or Parent to open their 360° Profile.</p>
        </div>
        <button onclick="openTeacherStudentRelationshipModal('${_esc360(teacher.id)}')"
                class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs">
          <i class="fa-solid fa-user-plus text-emerald-400"></i> Assign / Manage Students
        </button>
      </div>

      ${allMatchedStudents.length === 0 ? `
        <div class="p-10 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 text-xs">
          No students are currently assigned to ${_esc360(teacher.full_name)}.
        </div>
      ` : `
        <div class="overflow-x-auto border border-slate-200 rounded-2xl shadow-2xs">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-800 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">#</th>
                <th class="p-3.5">Student Name</th>
                <th class="p-3.5">Family / Parent</th>
                <th class="p-3.5">Country</th>
                <th class="p-3.5">Language</th>
                <th class="p-3.5">Gender</th>
                <th class="p-3.5">Course</th>
                <th class="p-3.5">Student Status</th>
                <th class="p-3.5 text-right">History / Daily Progress</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${allMatchedStudents.map((stu, idx) => {
                const fam = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(stu.family_id).toUpperCase());
                let stuNotes = {};
                try { if (stu.notes) stuNotes = JSON.parse(stu.notes); } catch (e) {}
                const country = fam?.country || stuNotes.country || 'International';
                const language = stuNotes.language || fam?.language || 'English';
                const gender = stu.gender || stuNotes.gender || 'Male';
                const course = stu.course_id || stuNotes.course || 'Qaida Nooraniya';
                const isHighlighted = options.highlightStudentId && String(stu.id).toUpperCase() === String(options.highlightStudentId).toUpperCase();
                const isStuActive = String(stu.status || 'Active').toLowerCase() === 'active';

                return `
                  <tr class="${isHighlighted ? 'bg-indigo-50/90 font-bold' : 'hover:bg-slate-50/80'} transition">
                    <td class="p-3.5 font-mono font-bold text-slate-500">${idx + 1}</td>
                    <td class="p-3.5">
                      <button onclick="openStudent360Profile('${_esc360(stu.id)}', 'history')"
                              class="font-extrabold text-indigo-600 hover:text-indigo-800 hover:underline text-left cursor-pointer">
                        ${_esc360(stu.name)} (${_esc360(stu.id)})
                      </button>
                    </td>
                    <td class="p-3.5">
                      ${fam ? `
                        <button onclick="openFamily360Profile('${_esc360(fam.id)}')"
                                class="font-bold text-indigo-600 hover:text-indigo-800 hover:underline text-left cursor-pointer">
                          ${_esc360(fam.parent_name)}
                        </button>
                      ` : `<span class="text-slate-600">${_esc360(stu.family_id || '--')}</span>`}
                    </td>
                    <td class="p-3.5 text-slate-700 font-medium">${_esc360(country)}</td>
                    <td class="p-3.5 text-slate-700 font-medium">${_esc360(language)}</td>
                    <td class="p-3.5 text-slate-700 font-medium">${_esc360(gender)}</td>
                    <td class="p-3.5 font-bold text-slate-800">${_esc360(course)}</td>
                    <td class="p-3.5">
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold ${isStuActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                        ${_esc360(stu.status || 'Active')}
                      </span>
                    </td>
                    <td class="p-3.5 text-right">
                      <button onclick="openStudent360Profile('${_esc360(stu.id)}', 'history')"
                              class="text-indigo-600 hover:text-indigo-800 hover:underline font-extrabold text-xs cursor-pointer whitespace-nowrap">
                        Daily Progress
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// SECTION 2: COMBINED CURRENT MONTH DEDUCTIONS & LEAVES (TWO SEPARATE SUBSECTIONS)
// ============================================================================
function _buildTeacherDeductionsAndLeavesTabHtml(state) {
  return `
    <div class="space-y-8">
      <!-- SUBSECTION A: CURRENT MONTH DEDUCTIONS -->
      <div class="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs">
        <div class="mb-2">
          <span class="px-2.5 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-black uppercase tracking-wider">Section A &bull; Deductions Dataset</span>
        </div>
        ${_buildTeacherDeductionsTabHtml(state)}
      </div>

      <!-- SUBSECTION B: CURRENT MONTH LEAVES -->
      <div class="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs">
        <div class="mb-2">
          <span class="px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-black uppercase tracking-wider">Section B &bull; Leaves Dataset</span>
        </div>
        ${_buildTeacherLeavesTabHtml(state)}
      </div>
    </div>
  `;
}

function _buildTeacherDeductionsTabHtml(state) {
  const { teacher, displayDeductionRows, effectiveCurrentDeductions, currentMonthLabel } = state;

  return `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
            <i class="fa-solid fa-arrow-trend-down text-rose-600"></i>
            <span>Current Month Deductions (${_esc360(currentMonthLabel)})</span>
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">Total Active Deductions for ${_esc360(currentMonthLabel)}: <strong class="text-rose-700">PKR ${effectiveCurrentDeductions.toLocaleString()}</strong></p>
        </div>
        <button onclick="openTeacherSalaryAdjustmentModal('${_esc360(teacher.id)}', 'deduction')"
                class="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs">
          <i class="fa-solid fa-plus"></i> Record Deduction
        </button>
      </div>

      ${displayDeductionRows.length === 0 ? `
        <div class="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 text-xs">
          <i class="fa-solid fa-circle-check text-2xl text-emerald-500 mb-2 block"></i>
          No salary deductions recorded for ${_esc360(teacher.full_name)} in ${_esc360(currentMonthLabel)}.
        </div>
      ` : `
        <div class="overflow-x-auto border border-slate-200 rounded-2xl shadow-2xs">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-800 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">#</th>
                <th class="p-3.5">Deduction Type / Category</th>
                <th class="p-3.5">Month</th>
                <th class="p-3.5">Date</th>
                <th class="p-3.5">Reason / Category</th>
                <th class="p-3.5">Amount</th>
                <th class="p-3.5">Status</th>
                <th class="p-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${displayDeductionRows.map((d, i) => `
                <tr class="hover:bg-slate-50 transition">
                  <td class="p-3.5 font-mono font-bold text-slate-400">${i + 1}</td>
                  <td class="p-3.5 font-extrabold text-slate-900">${_esc360(d.type || d.category || 'Salary Deduction')}</td>
                  <td class="p-3.5 font-mono text-slate-700">${_esc360(d.month || currentMonthLabel)}</td>
                  <td class="p-3.5 font-mono text-slate-600">${_esc360(d.date || '--')}</td>
                  <td class="p-3.5 text-slate-700">${_esc360(d.reason || '--')}</td>
                  <td class="p-3.5 lms-num-financial font-black text-rose-700">PKR ${Number(d.amount || 0).toLocaleString()}</td>
                  <td class="p-3.5">
                    <span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-extrabold">${_esc360(d.status || 'Applied')}</span>
                  </td>
                  <td class="p-3.5 text-right">
                    ${String(d.id || '').startsWith('SLIP-DED-') ? `
                      <button onclick="openTeacher360SalarySlipAction('${_esc360(teacher.id)}')" class="text-indigo-600 hover:underline font-bold text-xs cursor-pointer">Edit Slip</button>
                    ` : `
                      <button onclick="deleteTeacherDeductionRecord360('${_esc360(teacher.id)}', '${_esc360(d.id)}')" class="text-rose-600 hover:underline font-bold text-xs cursor-pointer">Remove</button>
                    `}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

function _buildTeacherLeavesTabHtml(state) {
  const { teacher, leaveRows, currentMonthLabel } = state;

  return `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
            <i class="fa-solid fa-calendar-xmark text-amber-600"></i>
            <span>Current Month Leaves (${_esc360(currentMonthLabel)})</span>
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">Synchronized with Teacher Leave &amp; Schedule Request records (${leaveRows.length} Leave Record(s)).</p>
        </div>
        <button onclick="openTeacherRecordLeaveModal('${_esc360(teacher.id)}')"
                class="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs">
          <i class="fa-solid fa-calendar-plus"></i> Record Teacher Leave
        </button>
      </div>

      ${leaveRows.length === 0 ? `
        <div class="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 text-xs">
          <i class="fa-solid fa-calendar-check text-2xl text-emerald-500 mb-2 block"></i>
          No leave records found for ${_esc360(teacher.full_name)} in ${_esc360(currentMonthLabel)}.
        </div>
      ` : `
        <div class="overflow-x-auto border border-slate-200 rounded-2xl shadow-2xs">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-800 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">#</th>
                <th class="p-3.5">Leave Date / Range</th>
                <th class="p-3.5">Duration</th>
                <th class="p-3.5">Leave Type</th>
                <th class="p-3.5">Reason</th>
                <th class="p-3.5">Status</th>
                <th class="p-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${leaveRows.map((lv, i) => `
                <tr class="hover:bg-slate-50 transition">
                  <td class="p-3.5 font-mono font-bold text-slate-400">${i + 1}</td>
                  <td class="p-3.5 font-mono font-bold text-slate-800">
                    ${_esc360(lv.startDate || '--')}${lv.endDate && lv.endDate !== lv.startDate ? ` &rarr; ${_esc360(lv.endDate)}` : ''}
                  </td>
                  <td class="p-3.5 font-mono text-slate-700">${_esc360(lv.duration || '1 Day')}</td>
                  <td class="p-3.5 font-extrabold text-slate-900">${_esc360(lv.leaveType || 'Casual Leave')}</td>
                  <td class="p-3.5 text-slate-700">${_esc360(lv.reason || '--')}</td>
                  <td class="p-3.5">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">${_esc360(lv.status || 'Approved')}</span>
                  </td>
                  <td class="p-3.5 text-right">
                    ${!String(lv.id || '').startsWith('REQ-LV-') ? `
                      <button onclick="deleteTeacherLeaveRecord360('${_esc360(teacher.id)}', '${_esc360(lv.id)}')" class="text-rose-600 hover:underline font-bold text-xs cursor-pointer">Delete</button>
                    ` : `<span class="text-slate-400 text-[11px]">Portal Request</span>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// TAB 5: BIO DATA (MATCHES SCREENSHOT 3 & EXCLUDES GREEN-SCRIBBLED ITEMS)
// ============================================================================
function _buildTeacherBioDataTabHtml(state) {
  const { teacher, meta, joinDateStr, currentBaseSubtotal } = state;
  const isAuthorizedForBank = (typeof CURRENT_ROLE === 'undefined' || CURRENT_ROLE === 'owner' || CURRENT_ROLE === 'manager');

  const bioFields = [
    { label: 'Father Name:', value: teacher.father_name || meta.father_name || meta.emergency_name || '--' },
    { label: 'CNIC:', value: meta.cnic || teacher.witness_phone || '--' },
    { label: 'Email:', value: meta.email || `${(meta.username || 'teacher')}@alhudaislamic.com` },

    { label: 'Nationality:', value: meta.nationality || 'Pakistan' },
    { label: 'Phone:', value: teacher.alt_phone || meta.emergency_phone || '--' },
    { label: 'Mobile:', value: teacher.phone || '--' },

    { label: 'Gender:', value: teacher.gender || meta.gender || 'Male' },
    { label: 'Qualification 01:', value: meta.qualification || 'Alimiyah / Tajweed & Qiraat' },
    { label: 'Qualification 02:', value: meta.qualification_02 || '--' },

    { label: 'Qualification 03:', value: meta.qualification_03 || '--' },
    { label: 'Experience:', value: meta.experience || 'Certified Quran Instructor' },
    { label: 'Working Shift:', value: teacher.working_shift || 'Regular Shift' },

    { label: 'Zoom:', value: meta.zoom_meeting_id || (teacher.phone ? teacher.phone.replace(/[^0-9]/g, '') : '--') },
    { label: 'Zoom-Pass:', value: meta.zoom_passcode || '123456' },
    { label: 'Zoom-Link:', value: meta.zoom_link || 'https://zoom.us/j/', isLink: true },

    { label: 'Username:', value: meta.username || 'teacher' },
    { label: 'Password:', value: '•••••••• (Protected)' },
    { label: 'Account Status:', value: teacher.status || 'Active' },

    { label: 'Timezone:', value: meta.timezone || 'Asia/Karachi' },
    { label: 'Difference:', value: meta.time_difference ?? '0' },
    { label: 'DoJ:', value: joinDateStr },

    { label: 'Account Title:', value: isAuthorizedForBank ? (meta.account_title || teacher.full_name) : 'Restricted' },
    { label: 'Monthly Salary:', value: isAuthorizedForBank ? `${meta.salary || currentBaseSubtotal || teacher.rate_per_slot || 2500}` : 'Restricted' },
    { label: 'Hour Rate:', value: isAuthorizedForBank ? `${meta.hour_rate || 0}` : 'Restricted' },

    { label: 'Bank:', value: isAuthorizedForBank ? (meta.bank_name || '--') : 'Restricted' },
    { label: 'A/C No.:', value: isAuthorizedForBank ? (meta.account_number || '--') : 'Restricted' },
    { label: 'Residential Address:', value: meta.residential_address || (typeof teacher.address === 'string' && !teacher.address.trim().startsWith('{') ? teacher.address : '--') }
  ];

  return `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
            <i class="fa-solid fa-address-card text-teal-600"></i>
            <span>Complete Teacher Bio Data &amp; Custom Record</span>
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">Directly mapped from the authoritative Teacher &amp; Custom Fields record. All obsolete/excluded fields are omitted.</p>
        </div>
        <button onclick="openTeacher360EditProfileModal('${_esc360(teacher.id)}')"
                class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs">
          <i class="fa-solid fa-pen-to-square"></i> Edit Bio Data
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 border border-slate-200 rounded-2xl overflow-hidden divide-y md:divide-y-0 bg-white shadow-2xs">
        ${bioFields.map((f, idx) => `
          <div class="p-3.5 border-b border-r border-slate-200/80 flex items-center justify-between gap-3 hover:bg-slate-50/70 transition">
            <span class="text-xs font-bold text-slate-600 shrink-0">${_esc360(f.label)}</span>
            ${f.isLink && f.value ? `
              <a href="${_esc360(f.value)}" target="_blank" class="text-xs font-extrabold text-teal-700 hover:underline truncate max-w-[200px]" title="${_esc360(f.value)}">
                ${_esc360(f.value)}
              </a>
            ` : `
              <span class="text-xs font-extrabold text-teal-700 text-right truncate max-w-[210px]" title="${_esc360(String(f.value))}">
                ${_esc360(String(f.value))}
              </span>
            `}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ============================================================================
// DEDICATED SCHEDULE PAGE BRIDGE (OPENS EXISTING 24-HOUR / 7-DAY MATRIX)
// ============================================================================
async function openTeacherDedicatedScheduleFrom360(teacherId) {
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;

  if (typeof open2DMatrixForTeacher === 'function') {
    await open2DMatrixForTeacher(teacher.id);
    const meta = _resolveTeacherCustomMeta(teacher);
    const empCode = meta.teacher_id || meta.emp_id || 'TCH-001';
    const titleEl = document.getElementById('matrixTeacherName');
    const subEl = document.getElementById('matrixTeacherSubtitle');
    if (titleEl) {
      titleEl.innerHTML = `Teacher: <span class="text-indigo-700">${_esc360(teacher.full_name)}</span> <span class="font-mono text-xs text-slate-500">(${_esc360(empCode)})</span>`;
    }
    if (subEl) {
      subEl.innerHTML = `<span class="text-emerald-700 font-bold"><i class="fa-solid fa-circle-nodes"></i> Opened from Teacher 360° Profile</span> &bull; Full 24-Hour / 7-Day Weekly Schedule Matrix &bull; Shift: <strong>${_esc360(teacher.working_shift || 'Regular Shift')}</strong>`;
    }
  } else if (typeof switchTab === 'function') {
    switchTab('tab-schedule-search');
  }
}

// ============================================================================
// STUDENT DETAILS ACTION WORKFLOW (ASSIGN / MANAGE TEACHER-STUDENT LINKS)
// ============================================================================
function openTeacherStudentRelationshipModal(teacherId) {
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const cached = _TEACHER_360_MEM_CACHE[String(teacher.id).toUpperCase()];
  const state = _compileTeacher360AggregatedState(teacher, cached?.tchSchedules || [], cached?.attLogs || []);
  const assignedIds = new Set(state.allMatchedStudents.map(s => String(s.id).toUpperCase()));
  const unassignedOrOtherStudents = (window.ALL_STUDENTS || []).filter(s => {
    const sIdUp = String(s.id || '').toUpperCase();
    const st = String(s.status || 'Active').toLowerCase();
    return !assignedIds.has(sIdUp) && st !== 'trial' && st !== 'deleted';
  });

  _openWorkspaceModal(
    `Teacher–Student Relationship & Assignment Manager`,
    `Teacher: ${teacher.full_name} (${state.empCode}) • ${state.allMatchedStudents.length} Assigned Student(s)`,
    `
      <div class="space-y-4 text-xs">
        <!-- Assign Existing Student to This Teacher -->
        <form onsubmit="submitTeacherAssignStudent360(event, '${_esc360(teacher.id)}')" class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
          <label class="font-extrabold text-slate-800 block">Link / Assign Student to ${_esc360(teacher.full_name)}</label>
          <div class="flex flex-col sm:flex-row gap-2">
            <select id="t360AssignStudentSelect" required class="flex-1 p-2.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-800">
              <option value="">-- Select Student to Assign --</option>
              ${unassignedOrOtherStudents.map(s => `
                <option value="${_esc360(s.id)}">${_esc360(s.name)} (${_esc360(s.id)}) — ${_esc360(s.course_id || 'Quran Studies')}</option>
              `).join('')}
            </select>
            <button type="submit" class="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-link mr-1"></i> Assign to Teacher
            </button>
          </div>
        </form>

        <!-- Currently Linked Students & Course Rate Summary -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-extrabold text-slate-800">Assigned Students &amp; Course Remuneration (${state.allMatchedStudents.length})</h4>
            <button type="button" onclick="_closeWorkspaceModal(); openTeacherDedicatedScheduleFrom360('${_esc360(teacher.id)}');" class="text-indigo-600 hover:underline font-extrabold text-[11px] cursor-pointer">
              <i class="fa-solid fa-calendar-days"></i> Open 24h/7d Schedule Matrix &rarr;
            </button>
          </div>
          ${state.allMatchedStudents.length === 0 ? `
            <div class="p-6 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-400">
              No students currently assigned to ${_esc360(teacher.full_name)}.
            </div>
          ` : `
            <div class="max-h-64 overflow-y-auto border border-slate-200 rounded-xl">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-slate-50 border-b border-slate-200 font-extrabold text-slate-700">
                  <tr>
                    <th class="p-2.5">Student</th>
                    <th class="p-2.5">Course</th>
                    <th class="p-2.5">Status</th>
                    <th class="p-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${state.allMatchedStudents.map(stu => `
                    <tr class="hover:bg-slate-50">
                      <td class="p-2.5 font-extrabold text-slate-900">${_esc360(stu.name)} <span class="font-mono text-[10px] text-slate-400">(${_esc360(stu.id)})</span></td>
                      <td class="p-2.5 text-slate-700">${_esc360(stu.course_id || 'Qaida / Quran')}</td>
                      <td class="p-2.5"><span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">${_esc360(stu.status || 'Active')}</span></td>
                      <td class="p-2.5 text-right">
                        <div class="inline-flex items-center gap-2">
                          <button type="button" onclick="_closeWorkspaceModal(); openStudent360Profile('${_esc360(stu.id)}', 'history');" class="text-indigo-600 hover:underline font-extrabold cursor-pointer">360° Profile</button>
                          <button type="button" onclick="unassignStudentFromTeacher360('${_esc360(teacher.id)}', '${_esc360(stu.id)}')" class="text-rose-600 hover:underline font-bold cursor-pointer">Unassign</button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <div class="flex justify-end pt-2 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer">Close</button>
        </div>
      </div>
    `
  );
}

async function submitTeacherAssignStudent360(e, teacherId) {
  e.preventDefault();
  const stuId = document.getElementById('t360AssignStudentSelect')?.value;
  if (!stuId) return;

  if (typeof validateEligibleTeacherBackend === 'function') {
    const check = await validateEligibleTeacherBackend(teacherId);
    if (!check.valid) {
      _notify360(check.error, 'error');
      return;
    }
  }

  const stuObj = (window.ALL_STUDENTS || []).find(s => String(s.id) === String(stuId));
  const prevTeacherId = stuObj?.assigned_teacher_id || null;

  try {
    await db.from('students').update({ assigned_teacher_id: teacherId }).eq('id', stuId);
    if (prevTeacherId && String(prevTeacherId) !== String(teacherId)) {
      await db.from('class_schedules').delete().eq('student_id', stuId).eq('teacher_id', prevTeacherId);
      if (Array.isArray(window.ALL_CLASS_SCHEDULES)) {
        window.ALL_CLASS_SCHEDULES = window.ALL_CLASS_SCHEDULES.filter(
          sc => !(String(sc.student_id) === String(stuId) && String(sc.teacher_id) === String(prevTeacherId))
        );
      }
      delete _TEACHER_360_MEM_CACHE[String(prevTeacherId).toUpperCase()];
    }
  } catch (err) {
    console.warn('[Teacher 360] Student assign update notice:', err);
  }
  _syncStudentRecordInMemory(stuId, { assigned_teacher_id: teacherId });
  delete _TEACHER_360_MEM_CACHE[String(teacherId).toUpperCase()];
  if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
  if (typeof loadTeachers === 'function') loadTeachers();

  _closeWorkspaceModal();
  _notify360('Student added to teacher Student List and synchronized across LMS!');
  await openTeacher360Profile(teacherId, 'students', true, { forceRefresh: true });
}

async function unassignStudentFromTeacher360(teacherId, stuId) {
  if (!(await lmsConfirm('Remove this student from this teacher\'s Student List? (Active schedule slots with this teacher will be removed, while student record and attendance history remain preserved)'))) return;
  try {
    await db.from('students').update({ assigned_teacher_id: null }).eq('id', stuId);
    await db.from('class_schedules').delete().eq('student_id', stuId).eq('teacher_id', teacherId);
    if (Array.isArray(window.ALL_CLASS_SCHEDULES)) {
      window.ALL_CLASS_SCHEDULES = window.ALL_CLASS_SCHEDULES.filter(
        sc => !(String(sc.student_id) === String(stuId) && String(sc.teacher_id) === String(teacherId))
      );
    }
  } catch (err) {
    console.warn('[Teacher 360] Student unassign notice:', err);
  }
  _syncStudentRecordInMemory(stuId, { assigned_teacher_id: null });
  delete _TEACHER_360_MEM_CACHE[String(teacherId).toUpperCase()];
  if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
  if (typeof loadTeachers === 'function') loadTeachers();

  _closeWorkspaceModal();
  _notify360('Student removed from teacher Student List.');
  await openTeacher360Profile(teacherId, 'students', true, { forceRefresh: true });
}

// ============================================================================
// TAB 8: DOCUMENTS TAB
// ============================================================================
function _buildTeacherDocumentsTabHtml(state) {
  const { teacher, documentsList } = state;

  return `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
            <i class="fa-solid fa-folder-open text-amber-500"></i>
            <span>Teacher Official Documents &amp; Verification Files (${documentsList.length})</span>
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">Store and verify CNIC, Academic Degrees, Tajweed/Qiraat Sanad, and Employment Contracts.</p>
        </div>
        <button onclick="openTeacherUploadDocsModal('${_esc360(teacher.id)}')"
                class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs">
          <i class="fa-solid fa-file-arrow-up"></i> Upload Document
        </button>
      </div>

      ${documentsList.length === 0 ? `
        <div class="p-10 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 text-xs">
          <i class="fa-solid fa-file-circle-plus text-2xl text-slate-400 mb-2 block"></i>
          No documents uploaded yet for ${_esc360(teacher.full_name)}. Click "Upload Document" to attach verification records.
        </div>
      ` : `
        <div class="overflow-x-auto border border-slate-200 rounded-2xl shadow-2xs">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-800 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">#</th>
                <th class="p-3.5">Document Title</th>
                <th class="p-3.5">Document Type</th>
                <th class="p-3.5">Upload Date</th>
                <th class="p-3.5">Remarks</th>
                <th class="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${documentsList.map((doc, i) => `
                <tr class="hover:bg-slate-50 transition">
                  <td class="p-3.5 font-mono font-bold text-slate-400">${i + 1}</td>
                  <td class="p-3.5 font-extrabold text-slate-900">${_esc360(doc.title || 'Teacher Document')}</td>
                  <td class="p-3.5"><span class="px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 font-bold text-[11px]">${_esc360(doc.type || 'Official Record')}</span></td>
                  <td class="p-3.5 font-mono text-slate-600">${_esc360(doc.date || '--')}</td>
                  <td class="p-3.5 text-slate-600">${_esc360(doc.remarks || '--')}</td>
                  <td class="p-3.5 text-right">
                    <div class="inline-flex items-center gap-2">
                      ${doc.fileUrl ? `
                        <a href="${_esc360(doc.fileUrl)}" download="${_esc360(doc.title || 'document')}" target="_blank" class="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold text-xs hover:bg-emerald-100">
                          View / Download
                        </a>
                      ` : ''}
                      <button onclick="deleteTeacherDocument360('${_esc360(teacher.id)}', '${_esc360(doc.id)}')" class="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 font-extrabold text-xs hover:bg-rose-100 cursor-pointer">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// TAB 9: NOTES & ACTIVITY HISTORY TAB
// ============================================================================
function _buildTeacherNotesActivityTabHtml(state) {
  const { teacher, notesList } = state;

  return `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
            <i class="fa-solid fa-clipboard-list text-indigo-600"></i>
            <span>Manager Notes, Administrative Remarks &amp; Activity Log</span>
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">Internal performance evaluations, administrative notes, and audit trail for ${_esc360(teacher.full_name)}.</p>
        </div>
        <button onclick="openTeacherAddNoteModal('${_esc360(teacher.id)}')"
                class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer shadow-2xs">
          <i class="fa-solid fa-plus"></i> Add Official Note
        </button>
      </div>

      ${notesList.length === 0 ? `
        <div class="p-10 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 text-xs">
          No internal notes recorded yet for ${_esc360(teacher.full_name)}.
        </div>
      ` : `
        <div class="space-y-2.5">
          ${notesList.map(n => `
            <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-3">
              <div class="space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="px-2.5 py-0.5 rounded-md bg-indigo-100 text-indigo-900 text-[10px] font-black uppercase">${_esc360(n.category || 'Manager Note')}</span>
                  <span class="text-xs font-extrabold text-slate-800">${_esc360(n.author || 'Admin')}</span>
                  <span class="text-[11px] font-mono text-slate-400">${_esc360(n.date || '')}</span>
                </div>
                <p class="text-xs text-slate-700 font-medium leading-relaxed">${_esc360(n.text)}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// TEACHER 360° REAL BACKEND ACTION HANDLERS & MODALS (ZERO DUMMY BUTTONS)
// ============================================================================

async function openTeacher360SalarySlipAction(teacherId) {
  if (typeof calculateMonthlySalaries === 'function' && (!window.ALL_TEACHER_SALARIES || !window.ALL_TEACHER_SALARIES[teacherId])) {
    await calculateMonthlySalaries();
  }
  if (typeof openSalarySlipModal === 'function' && window.ALL_TEACHER_SALARIES && window.ALL_TEACHER_SALARIES[teacherId]) {
    openSalarySlipModal(teacherId);
  } else {
    openTeacherSalaryRowDetailsModal(teacherId, document.getElementById('salaryMonthSelect')?.value || 'September 2026');
  }
}

function openTeacherSalaryRowDetailsModal(teacherId, monthRaw) {
  if (typeof openSalarySlipModal === 'function') {
    openSalarySlipModal(teacherId);
  } else {
    openTeacher360SalarySlipAction(teacherId);
  }
}

async function deleteTeacherSalaryMonthRecord360(teacherId, monthRaw, slipKey) {
  if (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') {
    alert('Access Denied: Only the System Owner can delete salary records.');
    return;
  }
  if (!(await lmsConfirm(`Are you sure you want to delete the salary record for ${monthRaw}?`))) return;

  try {
    const savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
    if (savedSalaries[slipKey]) {
      delete savedSalaries[slipKey];
      localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(savedSalaries));
    }
  } catch (e) {}

  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (teacher) {
    const meta = _resolveTeacherCustomMeta(teacher);
    const deletedList = Array.isArray(meta.deleted_salary_months) ? meta.deleted_salary_months : [];
    if (!deletedList.includes(monthRaw)) deletedList.push(monthRaw);
    await _persistTeacher360Updates(teacher.id, {}, { deleted_salary_months: deletedList });
  }
  _notify360(`Salary record for ${monthRaw} removed.`);
  await openTeacher360Profile(teacherId, 'salary', true, { forceRefresh: true });
}

function openTeacherEditPictureModal(teacherId) {
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const meta = _resolveTeacherCustomMeta(teacher);

  _openWorkspaceModal(
    `Update Teacher Profile Picture`,
    `${teacher.full_name}`,
    `
      <form onsubmit="submitTeacherEditPicture360(event, '${_esc360(teacher.id)}')" class="space-y-4 text-xs">
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Upload Photo File (PNG / JPG)</label>
          <input type="file" id="tch360PhotoFileInput" accept="image/*" class="w-full p-2 rounded-xl border border-slate-300 bg-slate-50 font-semibold text-slate-700">
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Or Paste Direct Image URL</label>
          <input type="url" id="tch360PhotoUrlInput" value="${_esc360(meta.avatar_url || '')}" placeholder="https://..." class="w-full p-2.5 rounded-xl border border-slate-300 font-mono text-slate-800">
        </div>
        <div class="flex justify-between items-center pt-3 border-t border-slate-100">
          <button type="button" onclick="clearTeacherPicture360('${_esc360(teacher.id)}')" class="px-3.5 py-2 rounded-xl bg-rose-50 text-rose-600 font-bold cursor-pointer">Remove Photo</button>
          <div class="flex gap-2">
            <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer">Cancel</button>
            <button type="submit" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold cursor-pointer">Save Picture</button>
          </div>
        </div>
      </form>
    `
  );
}

async function submitTeacherEditPicture360(e, teacherId) {
  e.preventDefault();
  const fileInp = document.getElementById('tch360PhotoFileInput');
  const urlInp = document.getElementById('tch360PhotoUrlInput');

  let finalAvatarUrl = (urlInp?.value || '').trim();
  if (fileInp && fileInp.files && fileInp.files[0]) {
    const file = fileInp.files[0];
    finalAvatarUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }

  await _persistTeacher360Updates(teacherId, {}, { avatar_url: finalAvatarUrl });
  _closeWorkspaceModal();
  _notify360('Profile picture updated!');
  await openTeacher360Profile(teacherId, _CURRENT_360_STATE.activeTab || 'salary', true, { forceRefresh: true });
}

async function clearTeacherPicture360(teacherId) {
  await _persistTeacher360Updates(teacherId, {}, { avatar_url: '' });
  _closeWorkspaceModal();
  _notify360('Profile picture cleared.');
  await openTeacher360Profile(teacherId, _CURRENT_360_STATE.activeTab || 'salary', true, { forceRefresh: true });
}

function openTeacher360EditProfileModal(teacherId) {
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const meta = _resolveTeacherCustomMeta(teacher);
  const joinDateStr = meta.joining_date || (teacher.created_at ? teacher.created_at.slice(0, 10) : '2026-01-01');

  _openWorkspaceModal(
    `Edit Teacher 360° Profile & Bio Data`,
    `Authoritative Record for ${teacher.full_name} (${meta.teacher_id || meta.emp_id || 'TCH'})`,
    `
      <form onsubmit="submitTeacher360EditProfileForm(event, '${_esc360(teacher.id)}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Full Name *</label>
            <input type="text" id="t360FullName" value="${_esc360(teacher.full_name || '')}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Father Name</label>
            <input type="text" id="t360FatherName" value="${_esc360(teacher.father_name || meta.father_name || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">CNIC</label>
            <input type="text" id="t360Cnic" value="${_esc360(meta.cnic || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Mobile / WhatsApp *</label>
            <input type="text" id="t360Phone" value="${_esc360(teacher.phone || '')}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Secondary Phone</label>
            <input type="text" id="t360AltPhone" value="${_esc360(teacher.alt_phone || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Email Address</label>
            <input type="email" id="t360Email" value="${_esc360(meta.email || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Gender</label>
            <select id="t360Gender" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="Male" ${(teacher.gender || meta.gender) === 'Male' ? 'selected' : ''}>Male</option>
              <option value="Female" ${(teacher.gender || meta.gender) === 'Female' ? 'selected' : ''}>Female</option>
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Nationality</label>
            <input type="text" id="t360Nationality" value="${_esc360(meta.nationality || 'Pakistan')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Date of Joining (DoJ)</label>
            <input type="date" id="t360JoinDate" value="${_esc360(joinDateStr)}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Qualification 01</label>
            <input type="text" id="t360Qual1" value="${_esc360(meta.qualification || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Qualification 02</label>
            <input type="text" id="t360Qual2" value="${_esc360(meta.qualification_02 || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Experience</label>
            <input type="text" id="t360Experience" value="${_esc360(meta.experience || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Working Shift</label>
            <input type="text" id="t360Shift" value="${_esc360(teacher.working_shift || '10 Hours Shift')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Base Slot / Monthly Salary (PKR)</label>
            <input type="number" id="t360RateSlot" value="${_esc360(teacher.rate_per_slot || meta.salary || 2500)}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Hour Rate</label>
            <input type="number" id="t360HourRate" value="${_esc360(meta.hour_rate || 0)}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Bank Name</label>
            <input type="text" id="t360BankName" value="${_esc360(meta.bank_name || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Account Title</label>
            <input type="text" id="t360AccountTitle" value="${_esc360(meta.account_title || teacher.full_name || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">A/C No. (IBAN)</label>
            <input type="text" id="t360AccountNo" value="${_esc360(meta.account_number || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Zoom Meeting ID</label>
            <input type="text" id="t360ZoomId" value="${_esc360(meta.zoom_meeting_id || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Zoom Passcode</label>
            <input type="text" id="t360ZoomPass" value="${_esc360(meta.zoom_passcode || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Zoom Classroom Link</label>
            <input type="text" id="t360ZoomLink" value="${_esc360(meta.zoom_link || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer">Save &amp; Sync Teacher Profile</button>
        </div>
      </form>
    `
  );
}

async function submitTeacher360EditProfileForm(e, teacherId) {
  e.preventDefault();
  const full_name = document.getElementById('t360FullName').value.trim();
  const father_name = document.getElementById('t360FatherName').value.trim();
  const cnic = document.getElementById('t360Cnic').value.trim();
  const phone = document.getElementById('t360Phone').value.trim();
  const alt_phone = document.getElementById('t360AltPhone').value.trim();
  const email = document.getElementById('t360Email').value.trim();
  const gender = document.getElementById('t360Gender').value;
  const nationality = document.getElementById('t360Nationality').value.trim();
  const joining_date = document.getElementById('t360JoinDate').value;
  const qualification = document.getElementById('t360Qual1').value.trim();
  const qualification_02 = document.getElementById('t360Qual2').value.trim();
  const experience = document.getElementById('t360Experience').value.trim();
  const working_shift = document.getElementById('t360Shift').value.trim();
  const rate_per_slot = Number(document.getElementById('t360RateSlot').value || 2500);
  const hour_rate = Number(document.getElementById('t360HourRate').value || 0);
  const bank_name = document.getElementById('t360BankName').value.trim();
  const account_title = document.getElementById('t360AccountTitle').value.trim();
  const account_number = document.getElementById('t360AccountNo').value.trim();
  const zoom_meeting_id = document.getElementById('t360ZoomId').value.trim();
  const zoom_passcode = document.getElementById('t360ZoomPass').value.trim();
  const zoom_link = document.getElementById('t360ZoomLink').value.trim();

  await _persistTeacher360Updates(
    teacherId,
    {
      full_name,
      father_name,
      phone,
      alt_phone,
      working_shift,
      rate_per_slot
    },
    {
      full_name,
      father_name,
      cnic,
      phone,
      email,
      gender,
      nationality,
      joining_date,
      qualification,
      qualification_02,
      experience,
      working_shift,
      salary: rate_per_slot,
      hour_rate,
      bank_name,
      account_title,
      account_number,
      zoom_meeting_id,
      zoom_passcode,
      zoom_link
    }
  );

  if (zoom_link && typeof syncTeacherZoomToAllStudents === 'function') {
    await syncTeacherZoomToAllStudents(teacherId, zoom_link);
  }
  if (typeof loadTeachers === 'function') {
    loadTeachers(true);
  }

  _closeWorkspaceModal();
  _notify360(`Teacher profile for ${full_name} updated and synchronized across LMS!`);
  await openTeacher360Profile(teacherId, _CURRENT_360_STATE.activeTab || 'biodata', true, { forceRefresh: true });
}

function openTeacherSalaryAdjustmentModal(teacherId, defaultMode = 'deduction') {
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const currentMonthLabel = document.getElementById('salaryMonthSelect')?.value || 'September 2026';
  const today = new Date().toISOString().slice(0, 10);

  _openWorkspaceModal(
    `Record Salary Adjustment / Deduction`,
    `Teacher: ${teacher.full_name} • Cycle: ${currentMonthLabel}`,
    `
      <form onsubmit="submitTeacherSalaryAdjustment360(event, '${_esc360(teacher.id)}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Adjustment Type *</label>
            <select id="t360AdjType" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
              <option value="deduction" ${defaultMode === 'deduction' ? 'selected' : ''}>Salary Deduction (-)</option>
              <option value="bonus" ${defaultMode === 'bonus' ? 'selected' : ''}>Bonus / Performance Allowance (+)</option>
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Payroll Month *</label>
            <input type="text" id="t360AdjMonth" value="${_esc360(currentMonthLabel)}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Category / Deduction Reason *</label>
            <input type="text" id="t360AdjCategory" placeholder="e.g. Uninformed Absence / Advance / Bonus" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Amount (PKR) *</label>
            <input type="number" id="t360AdjAmount" min="1" required placeholder="e.g. 500" class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-900">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Effective Date</label>
            <input type="date" id="t360AdjDate" value="${today}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Notes / Remarks</label>
            <input type="text" id="t360AdjRemarks" placeholder="Enter details..." class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold cursor-pointer">Save &amp; Sync Payroll</button>
        </div>
      </form>
    `
  );
}

async function submitTeacherSalaryAdjustment360(e, teacherId) {
  e.preventDefault();
  const adjType = document.getElementById('t360AdjType').value;
  const month = document.getElementById('t360AdjMonth').value.trim();
  const category = document.getElementById('t360AdjCategory').value.trim();
  const amount = parseFloat(document.getElementById('t360AdjAmount').value) || 0;
  const date = document.getElementById('t360AdjDate').value;
  const remarks = document.getElementById('t360AdjRemarks').value.trim();

  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const meta = _resolveTeacherCustomMeta(teacher);

  let savedSalaries = {};
  try {
    savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
  } catch (err) {}

  const slipKey = `${teacher.id}_${month.replace(/\s+/g, '_')}`;
  const existingSlip = savedSalaries[slipKey] || {
    teacher_id: teacher.id,
    month,
    base_subtotal: Number(teacher.rate_per_slot || meta.salary || 2500),
    bonus: 0,
    deduction: 0,
    status: 'Pending'
  };

  if (adjType === 'deduction') {
    const deductions = Array.isArray(meta.deduction_records) ? meta.deduction_records : [];
    deductions.unshift({
      id: `DED-${Date.now()}`,
      type: category,
      category,
      amount,
      date,
      month,
      reason: remarks || category,
      status: 'Applied'
    });
    existingSlip.deduction = (parseFloat(existingSlip.deduction) || 0) + amount;
    existingSlip.net_payable = Math.max(0, (parseFloat(existingSlip.base_subtotal) || 2500) + (parseFloat(existingSlip.bonus) || 0) - existingSlip.deduction);
    existingSlip.remarks = remarks || category;
    savedSalaries[slipKey] = existingSlip;
    localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(savedSalaries));
    await _persistTeacher360Updates(teacher.id, {}, { deduction_records: deductions });
  } else {
    existingSlip.bonus = (parseFloat(existingSlip.bonus) || 0) + amount;
    existingSlip.net_payable = Math.max(0, (parseFloat(existingSlip.base_subtotal) || 2500) + existingSlip.bonus - (parseFloat(existingSlip.deduction) || 0));
    existingSlip.remarks = remarks || category;
    savedSalaries[slipKey] = existingSlip;
    localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(savedSalaries));
    await _persistTeacher360Updates(teacher.id, {}, { current_bonus: existingSlip.bonus });
  }

  if (typeof calculateMonthlySalaries === 'function') {
    calculateMonthlySalaries();
  }

  _closeWorkspaceModal();
  _notify360(`Salary ${adjType} of PKR ${amount.toLocaleString()} synced with Payroll!`);
  await openTeacher360Profile(teacherId, adjType === 'deduction' ? 'deductions' : 'salary', true, { forceRefresh: true });
}

async function deleteTeacherDeductionRecord360(teacherId, deductionId) {
  if (!(await lmsConfirm('Remove this deduction record and recalculate monthly salary?'))) return;
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const meta = _resolveTeacherCustomMeta(teacher);
  const list = Array.isArray(meta.deduction_records) ? meta.deduction_records : [];
  const target = list.find(d => d.id === deductionId);
  const updated = list.filter(d => d.id !== deductionId);

  if (target) {
    try {
      const savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
      const slipKey = `${teacher.id}_${(target.month || 'September 2026').replace(/\s+/g, '_')}`;
      if (savedSalaries[slipKey]) {
        savedSalaries[slipKey].deduction = Math.max(0, (parseFloat(savedSalaries[slipKey].deduction) || 0) - (parseFloat(target.amount) || 0));
        savedSalaries[slipKey].net_payable = Math.max(0, (parseFloat(savedSalaries[slipKey].base_subtotal) || 2500) + (parseFloat(savedSalaries[slipKey].bonus) || 0) - savedSalaries[slipKey].deduction);
        localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(savedSalaries));
      }
    } catch (e) {}
  }

  await _persistTeacher360Updates(teacher.id, {}, { deduction_records: updated });
  _notify360('Deduction removed and salary updated.');
  await openTeacher360Profile(teacherId, 'deductions', true, { forceRefresh: true });
}

function openTeacherRecordLeaveModal(teacherId) {
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const today = new Date().toISOString().slice(0, 10);

  _openWorkspaceModal(
    `Record Teacher Leave`,
    `${teacher.full_name}`,
    `
      <form onsubmit="submitTeacherRecordLeave360(event, '${_esc360(teacher.id)}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Start Date *</label>
            <input type="date" id="t360LvStart" value="${today}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">End Date *</label>
            <input type="date" id="t360LvEnd" value="${today}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Leave Type</label>
            <select id="t360LvType" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="Casual Leave">Casual Leave</option>
              <option value="Medical / Sick Leave">Medical / Sick Leave</option>
              <option value="Emergency Leave">Emergency Leave</option>
              <option value="Approved Half-Day">Approved Half-Day</option>
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Duration Label</label>
            <input type="text" id="t360LvDuration" value="1 Day" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Reason / Remarks *</label>
          <input type="text" id="t360LvReason" placeholder="Enter leave reason..." required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black cursor-pointer">Save Leave Record</button>
        </div>
      </form>
    `
  );
}

async function submitTeacherRecordLeave360(e, teacherId) {
  e.preventDefault();
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const meta = _resolveTeacherCustomMeta(teacher);
  const leaves = Array.isArray(meta.leave_records) ? meta.leave_records : [];

  leaves.unshift({
    id: `LV-${Date.now()}`,
    startDate: document.getElementById('t360LvStart').value,
    endDate: document.getElementById('t360LvEnd').value,
    leaveType: document.getElementById('t360LvType').value,
    duration: document.getElementById('t360LvDuration').value.trim(),
    reason: document.getElementById('t360LvReason').value.trim(),
    status: 'APPROVED'
  });

  await _persistTeacher360Updates(teacher.id, {}, { leave_records: leaves });
  _closeWorkspaceModal();
  _notify360('Teacher leave recorded.');
  await openTeacher360Profile(teacherId, 'leaves', true, { forceRefresh: true });
}

async function deleteTeacherLeaveRecord360(teacherId, leaveId) {
  if (!(await lmsConfirm('Delete this leave record?'))) return;
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const meta = _resolveTeacherCustomMeta(teacher);
  const updated = (meta.leave_records || []).filter(l => l.id !== leaveId);
  await _persistTeacher360Updates(teacher.id, {}, { leave_records: updated });
  _notify360('Leave record deleted.');
  await openTeacher360Profile(teacherId, 'leaves', true, { forceRefresh: true });
}

function openTeacherUploadDocsModal(teacherId) {
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const today = new Date().toISOString().slice(0, 10);

  _openWorkspaceModal(
    `Upload Official Teacher Document`,
    `Instructor: ${teacher.full_name}`,
    `
      <form onsubmit="submitTeacherUploadDoc360(event, '${_esc360(teacher.id)}')" class="space-y-4 text-xs">
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Document Title *</label>
          <input type="text" id="t360DocTitle" placeholder="e.g. CNIC Front & Back / Shahadat-ul-Alimiyah Degree" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Document Category</label>
            <select id="t360DocType" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="Identity / CNIC">Identity / CNIC</option>
              <option value="Academic Degree / Sanad">Academic Degree / Sanad</option>
              <option value="Tajweed / Qiraat Ijazah">Tajweed / Qiraat Ijazah</option>
              <option value="CV / Resume">CV / Resume</option>
              <option value="Employment Agreement">Employment Agreement</option>
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Upload Date</label>
            <input type="date" id="t360DocDate" value="${today}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-800">
          </div>
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Select Document / Scan File</label>
          <input type="file" id="t360DocFile" class="w-full p-2 rounded-xl border border-slate-300 bg-slate-50 font-semibold text-slate-700">
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Verification Remarks</label>
          <input type="text" id="t360DocRemarks" placeholder="Verified by Administration" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer">Upload &amp; Save</button>
        </div>
      </form>
    `
  );
}

async function submitTeacherUploadDoc360(e, teacherId) {
  e.preventDefault();
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const meta = _resolveTeacherCustomMeta(teacher);
  const docs = Array.isArray(meta.documents) ? meta.documents : [];

  const fileInp = document.getElementById('t360DocFile');
  let fileUrl = '';
  if (fileInp && fileInp.files && fileInp.files[0]) {
    const f = fileInp.files[0];
    if (f.size <= 2 * 1024 * 1024) {
      fileUrl = await new Promise(resolve => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => resolve('');
        r.readAsDataURL(f);
      });
    }
  }

  docs.unshift({
    id: `DOC-${Date.now()}`,
    title: document.getElementById('t360DocTitle').value.trim(),
    type: document.getElementById('t360DocType').value,
    date: document.getElementById('t360DocDate').value,
    remarks: document.getElementById('t360DocRemarks').value.trim() || 'Verified',
    fileUrl
  });

  await _persistTeacher360Updates(teacher.id, {}, { documents: docs });
  _closeWorkspaceModal();
  _notify360('Document uploaded to Teacher 360 Profile!');
  await openTeacher360Profile(teacherId, 'documents', true, { forceRefresh: true });
}

async function deleteTeacherDocument360(teacherId, docId) {
  if (!(await lmsConfirm('Delete this document from Teacher 360 Profile?'))) return;
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const meta = _resolveTeacherCustomMeta(teacher);
  const updated = (meta.documents || []).filter(d => d.id !== docId);
  await _persistTeacher360Updates(teacher.id, {}, { documents: updated });
  _notify360('Document removed.');
  await openTeacher360Profile(teacherId, 'documents', true, { forceRefresh: true });
}

function openTeacherAddNoteModal(teacherId) {
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;

  _openWorkspaceModal(
    `Add Official Teacher Note`,
    `${teacher.full_name}`,
    `
      <form onsubmit="submitTeacherAddNote360(event, '${_esc360(teacher.id)}')" class="space-y-4 text-xs">
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Note Category</label>
          <select id="t360NoteCat" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
            <option value="Manager Note">Manager Note</option>
            <option value="Administrative Note">Administrative Note</option>
            <option value="Tajweed / Quality Audit">Tajweed / Quality Audit</option>
          </select>
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Note Details *</label>
          <textarea id="t360NoteText" rows="3" required placeholder="Enter official note..." class="w-full p-2.5 rounded-xl border border-slate-300 font-semibold text-slate-900"></textarea>
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer">Save Note</button>
        </div>
      </form>
    `
  );
}

async function submitTeacherAddNote360(e, teacherId) {
  e.preventDefault();
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const meta = _resolveTeacherCustomMeta(teacher);
  const notes = Array.isArray(meta.teacher_360_notes) ? meta.teacher_360_notes : [];

  notes.unshift({
    id: `NOTE-${Date.now()}`,
    category: document.getElementById('t360NoteCat').value,
    author: (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') ? 'Operations Manager' : 'System Owner',
    date: new Date().toISOString().slice(0, 10),
    text: document.getElementById('t360NoteText').value.trim()
  });

  await _persistTeacher360Updates(teacher.id, {}, { teacher_360_notes: notes });
  _closeWorkspaceModal();
  _notify360('Official note saved.');
  await openTeacher360Profile(teacherId, 'notes', true, { forceRefresh: true });
}

async function handleTeacher360ToggleAccountStatus(teacherId) {
  const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) return;
  const isCurrentlyActive = String(teacher.status || 'Active').toLowerCase() === 'active';
  const nextStatus = isCurrentlyActive ? 'Inactive' : 'Active';

  if (!(await lmsConfirm(`Are you sure you want to ${isCurrentlyActive ? 'DEACTIVATE' : 'ACTIVATE'} the account for "${teacher.full_name}"?\n\nAll historical salary, attendance, schedule, and student records will be safely preserved.`))) {
    return;
  }

  await _persistTeacher360Updates(teacher.id, { status: nextStatus }, { status: nextStatus });
  if (typeof loadTeachers === 'function') {
    loadTeachers(true);
  }
  _notify360(`Teacher account status changed to ${nextStatus}.`);
  await openTeacher360Profile(teacherId, _CURRENT_360_STATE.activeTab || 'salary', true, { forceRefresh: true });
}

