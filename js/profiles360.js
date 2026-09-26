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
  return meta;
}

/**
 * Save updated student record to Supabase students + in-memory ALL_STUDENTS & ALL_FAMILIES
 */
async function _saveStudentRecordBackend(studentId, updateFields) {
  const { error } = await db.from('students').update(updateFields).eq('id', studentId);
  if (error) {
    console.error('[Student Update] Supabase error:', error);
    throw error;
  }

  // Update ALL_STUDENTS
  const sIdx = (window.ALL_STUDENTS || []).findIndex(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (sIdx >= 0) {
    window.ALL_STUDENTS[sIdx] = { ...window.ALL_STUDENTS[sIdx], ...updateFields };
  }

  // Update nested student inside ALL_FAMILIES
  (window.ALL_FAMILIES || []).forEach(fam => {
    if (Array.isArray(fam.students)) {
      const fStuIdx = fam.students.findIndex(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
      if (fStuIdx >= 0) {
        fam.students[fStuIdx] = { ...fam.students[fStuIdx], ...updateFields };
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
    activeSidebarBtn.classList.add('active', 'bg-brandDark', 'text-white', 'shadow');
    activeSidebarBtn.classList.remove('text-slate-700');
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

async function _ensure360CoreDataReady(forceRefresh = false) {
  try {
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
  await _ensure360CoreDataReady(true);
  if (_CURRENT_360_STATE.type === 'family' && _CURRENT_360_STATE.id) {
    await openFamily360Profile(_CURRENT_360_STATE.id, _CURRENT_360_STATE.activeTab, true, {
      selectedStudentId: _CURRENT_360_STATE.selectedStudentId,
      studentSubView: _CURRENT_360_STATE.studentSubView
    });
  } else if (_CURRENT_360_STATE.type === 'teacher' && _CURRENT_360_STATE.id) {
    await openTeacher360Profile(_CURRENT_360_STATE.id, _CURRENT_360_STATE.activeTab, true);
  }
}

function _buildTopWorkspaceNavHtml() {
  const originLabel = _TAB_NAMES_MAP[_ORIGIN_LMS_TAB] || 'Main Dashboard';
  const crumbsHtml = _PROFILE_360_STACK.map((item, idx) => {
    const isLast = idx === _PROFILE_360_STACK.length - 1;
    const typeBadge = item.type === 'family' ? 'Family Workspace' : 'Teacher Workspace';
    return `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${isLast ? 'bg-slate-900 text-white shadow-2xs' : 'bg-slate-100 text-slate-700'}">
        <span class="opacity-70 font-medium">${typeBadge}:</span>
        <span class="font-extrabold">${_esc360(item.label)}</span>
      </span>
      ${!isLast ? '<i class="fa-solid fa-chevron-right text-[10px] text-slate-400 mx-0.5"></i>' : ''}
    `;
  }).join('');

  return `
    <div class="bg-white rounded-2xl border border-slate-200/90 px-4 py-2.5 shadow-2xs flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap">
        <button onclick="exitFullScreen360Profile()" class="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold flex items-center gap-2 transition shadow-2xs">
          <i class="fa-solid fa-arrow-left text-amber-400"></i> Back to ${_esc360(originLabel)}
        </button>
        ${_PROFILE_360_STACK.length > 1 ? `
          <button onclick="navigateBack360Profile()" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold flex items-center gap-1.5 transition">
            <i class="fa-solid fa-rotate-left text-slate-600"></i> Previous
          </button>
        ` : ''}
        <div class="h-4 w-[1px] bg-slate-200 mx-1 hidden sm:block"></div>
        <div class="flex items-center gap-1 flex-wrap">
          ${crumbsHtml}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="refreshCurrent360Profile()" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 text-xs font-extrabold flex items-center gap-1.5 transition">
          <i class="fa-solid fa-arrows-rotate text-indigo-600"></i> Refresh Live Data
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
  await _ensure360CoreDataReady();

  let student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) {
    const { data } = await db.from('students').select('*').eq('id', studentId).maybeSingle();
    student = data;
    if (student && Array.isArray(window.ALL_STUDENTS)) window.ALL_STUDENTS.push(student);
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

  workspace.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-14 text-center text-slate-500 shadow-2xs">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-600 mb-3 block"></i>
      <span class="text-sm font-extrabold text-slate-700">Loading Family Profile Workspace...</span>
    </div>
  `;

  await _ensure360CoreDataReady();

  let family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) {
    const { data } = await db.from('families').select('*, students(*)').eq('id', familyId).maybeSingle();
    family = data;
    if (family && Array.isArray(window.ALL_FAMILIES)) window.ALL_FAMILIES.push(family);
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

  // Strictly enforce ONLY the 5 required tabs:
  // 1. students | 2. payments | 3. manager_notes | 4. teacher_notes | 5. biodata
  const validTabs = ['students', 'payments', 'manager_notes', 'teacher_notes', 'biodata'];
  const activeTab = validTabs.includes(initialTab) ? initialTab : 'students';

  // Retrieve all connected Students for this Family
  const familyStudents = (window.ALL_STUDENTS || []).filter(s =>
    String(s.family_id || '').toUpperCase() === String(family.id).toUpperCase() &&
    String(s.status || '').toLowerCase() !== 'trial'
  );

  // Determine selected Student inside Family Profile
  // Only auto-open the bottom Student Detail Drawer if a specific student was explicitly requested (e.g. from Student Search)
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
  const [schedRes, logsRes] = await Promise.all([
    studentIds.length > 0 ? db.from('class_schedules').select('*, teachers(*)').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length > 0 ? db.from('attendance_logs').select('*').in('student_id', studentIds).order('date', { ascending: false }).limit(250) : Promise.resolve({ data: [] })
  ]);

  const famSchedules = schedRes.data || [];
  const famLogs = logsRes.data || [];

  // Cache schedules & logs on window for instant tab/student switching
  window._LAST_FAMILY_360_CACHE = {
    family,
    familyStudents,
    famSchedules,
    famLogs
  };

  _renderFamilyWorkspaceDOM();
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
    ? maskStudentEmail(family.parent_email || '')
    : (family.parent_email || 'Not Provided');

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
    <div class="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-center gap-3 flex-wrap">
      <button onclick="handleFamilyLevelDeactivate('${_esc360(family.id)}')"
              class="h-9 px-5 rounded-xl font-extrabold text-xs text-white shadow-xs transition inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${isFamInactive ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}">
        <i class="fa-solid ${isFamInactive ? 'fa-user-check' : 'fa-ban'}"></i>
        <span>${isFamInactive ? 'Activate Family' : 'Deactivate'}</span>
      </button>

      <button onclick="handleFamilyLevelLeave('${_esc360(family.id)}')"
              class="h-9 px-5 rounded-xl font-extrabold text-xs text-white bg-sky-600 hover:bg-sky-700 shadow-xs transition inline-flex items-center gap-2 whitespace-nowrap cursor-pointer">
        <i class="fa-solid fa-calendar-pause"></i>
        <span>${isFamOnLeave ? 'Return Family from Leave' : 'Make on Leave'}</span>
      </button>

      <button onclick="handleFamilyLevelSuspendClasses('${_esc360(family.id)}')"
              class="h-9 px-5 rounded-xl font-extrabold text-xs text-white ${isFamSuspended ? 'bg-teal-600 hover:bg-teal-700' : 'bg-rose-700 hover:bg-rose-800'} shadow-xs transition inline-flex items-center gap-2 whitespace-nowrap cursor-pointer">
        <i class="fa-solid ${isFamSuspended ? 'fa-play' : 'fa-pause-circle'}"></i>
        <span>${isFamSuspended ? 'Unsuspend Classes' : 'Suspend Classes'}</span>
      </button>

      <button onclick="openEditFamilyProfileModal('${_esc360(family.id)}')"
              class="h-9 px-5 rounded-xl font-extrabold text-xs text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition inline-flex items-center gap-2 whitespace-nowrap cursor-pointer">
        <i class="fa-solid fa-pen-to-square"></i>
        <span>Edit Profile</span>
      </button>
    </div>
  `;

  workspace.innerHTML = `
    ${_buildTopWorkspaceNavHtml()}

    <!-- WELL-SETTLED MODERN FULL-SCREEN FAMILY WORKSPACE CARD -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

      <!-- CENTERED, BALANCED & SYMMETRICAL FAMILY HEADER BANNER -->
      <div class="bg-gradient-to-b from-slate-900 via-slate-900 to-indigo-950 text-white px-6 pt-6 pb-0">
        <div class="max-w-4xl mx-auto flex flex-col items-center text-center space-y-3.5 pb-5">

          <!-- Row 1: Avatar + Family Name + Registration Date + Family ID -->
          <div class="flex flex-col items-center">
            <div class="w-14 h-14 rounded-2xl bg-white/10 border-2 border-white/20 flex items-center justify-center text-2xl font-black text-amber-400 shadow-md mb-2">
              ${_esc360((family.parent_name || 'F').charAt(0).toUpperCase())}
            </div>
            <div class="flex items-center justify-center gap-2.5 flex-wrap">
              <h1 class="text-xl sm:text-2xl font-black tracking-tight text-white capitalize">${_esc360(family.parent_name)}</h1>
              <span class="px-2.5 py-0.5 rounded-md bg-white/10 border border-white/20 font-mono text-xs font-extrabold text-slate-200 whitespace-nowrap">${_esc360(family.id)}</span>
            </div>
            <div class="text-xs font-mono text-slate-300 mt-0.5">${_esc360(regDate)}</div>
          </div>

          <!-- Row 2: Single-Line Status & Billing Summary Strip -->
          <div class="flex items-center justify-center gap-2 flex-wrap">
            <span class="px-3 py-1 rounded-md border text-[11px] font-black uppercase tracking-wider whitespace-nowrap ${statusBadgeStyle}">
              ${_esc360(displayStatusLabel)}
            </span>
            ${isFamSuspended ? `<span class="px-3 py-1 rounded-md bg-rose-600 text-white text-[11px] font-black uppercase whitespace-nowrap">CLASSES SUSPENDED</span>` : ''}
            <span class="px-3 py-1 rounded-md ${invoiceSentThisMonth ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300 border border-slate-700'} text-[11px] font-black uppercase tracking-wide whitespace-nowrap">
              MONTHLY INVOICE ${invoiceSentThisMonth ? '✓' : 'PENDING'}
            </span>
            <span class="px-3 py-1 rounded-md bg-sky-500/20 text-sky-200 border border-sky-400/30 text-[11px] font-extrabold uppercase whitespace-nowrap">
              MONTHLY PAYMENT &bull; ${_esc360(family.currency || 'USD')} ${_esc360(family.monthly_fee || 0)}
            </span>
            <span class="px-3 py-1 rounded-md bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 text-[11px] font-bold whitespace-nowrap">
              <i class="fa-regular fa-envelope mr-1"></i> ${_esc360(displayEmail)}
            </span>
          </div>

          <!-- Row 3: Single-Line 4 Required Family Action Buttons (Never Wraps Unevenly) -->
          <div class="flex items-center justify-center gap-2.5 flex-wrap pt-1">
            <button onclick="openFamilyAddStudentModal('${_esc360(family.id)}')"
                    class="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold transition shadow-xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-user-plus"></i>
              <span>Add Student</span>
            </button>

            <button onclick="openFamilySendInvoiceModal('${_esc360(family.id)}')"
                    class="h-9 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold transition shadow-xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-file-invoice-dollar"></i>
              <span>Send Invoice</span>
            </button>

            <button onclick="openFamilyCustomEmailModal('${_esc360(family.id)}')"
                    class="h-9 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-extrabold transition shadow-xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-paper-plane"></i>
              <span>Send Email</span>
            </button>

            <button onclick="openFamilyManualInvoiceModal('${_esc360(family.id)}')"
                    class="h-9 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-extrabold transition shadow-xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <i class="fa-solid fa-file-circle-plus"></i>
              <span>Add Manual Invoice</span>
            </button>
          </div>
        </div>

        <!-- Row 4: Centered 5-Tab Navigation Bar Docked to Bottom of Header -->
        <div class="flex items-center justify-center gap-1.5 pt-2 overflow-x-auto no-scrollbar border-t border-white/10">
          ${navTabs.map(t => {
            const isActive = activeTab === t.id;
            return `
              <button onclick="switchFamilyWorkspaceTab('${t.id}')"
                      class="px-5 py-2.5 rounded-t-xl text-xs font-extrabold transition inline-flex items-center gap-2 whitespace-nowrap cursor-pointer ${
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
    ? maskStudentEmail(family.parent_email || '')
    : (family.parent_email || '--');

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
// TOP FAMILY ACTION 1: ADD STUDENT TO CURRENT FAMILY (Section #4)
// ============================================================================
function openFamilyAddStudentModal(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const nextId = (typeof getNextStudentId === 'function') ? getNextStudentId() : `STU-${Math.floor(100 + Math.random() * 899)}`;
  const today = new Date().toISOString().slice(0, 10);
  const teacherOptions = (window.ALL_TEACHERS || []).map(t =>
    `<option value="${_esc360(t.id)}">${_esc360(t.full_name)} (${_esc360(t.working_shift || 'Regular Shift')})</option>`
  ).join('');

  _openWorkspaceModal(
    `Add New Student to ${family.parent_name}`,
    `Automatically connected to Family ID: ${family.id}`,
    `
      <form onsubmit="submitFamilyAddStudentForm(event, '${_esc360(family.id)}')" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Student ID</label>
            <input type="text" id="fwNewStuId" value="${_esc360(nextId)}" readonly class="w-full p-2.5 rounded-xl bg-slate-100 border border-slate-200 font-mono font-bold text-slate-700">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Joining Date</label>
            <input type="date" id="fwNewStuJoinDate" value="${today}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="sm:col-span-2">
            <label class="font-extrabold text-slate-700 block mb-1">Student Full Name *</label>
            <input type="text" id="fwNewStuName" placeholder="Enter student full name" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Age</label>
            <input type="number" id="fwNewStuAge" value="8" min="3" max="70" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Gender</label>
            <select id="fwNewStuGender" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Course / Program</label>
            <select id="fwNewStuCourse" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="Noorani Qaida">Noorani Qaida</option>
              <option value="Nazra Quran Reading">Nazra Quran Reading</option>
              <option value="Hifz-ul-Quran">Hifz-ul-Quran</option>
              <option value="Tajweed & Recitation">Tajweed &amp; Recitation</option>
              <option value="Tafseer & Islamic Studies">Tafseer &amp; Islamic Studies</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Assign Teacher</label>
            <select id="fwNewStuTeacher" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="">-- Select Teacher --</option>
              ${teacherOptions}
            </select>
          </div>
          <div>
            <label class="font-extrabold text-slate-700 block mb-1">Days Per Week</label>
            <select id="fwNewStuDays" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="5 Days (Mon-Fri)">5 Days (Mon-Fri)</option>
              <option value="3 Days (Mon-Wed-Fri)">3 Days (Mon-Wed-Fri)</option>
              <option value="2 Days (Weekend)">2 Days (Weekend)</option>
              <option value="6 Days (Mon-Sat)">6 Days (Mon-Sat)</option>
            </select>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
          <button type="submit" id="btnFwSaveNewStudent" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold">
            Enroll Student in Family
          </button>
        </div>
      </form>
    `
  );
}

async function submitFamilyAddStudentForm(e, familyId) {
  e.preventDefault();
  const btn = document.getElementById('btnFwSaveNewStudent');
  if (btn) { btn.disabled = true; btn.innerText = 'Saving to Database...'; }

  const id = document.getElementById('fwNewStuId').value.trim();
  const name = document.getElementById('fwNewStuName').value.trim();
  const age = parseInt(document.getElementById('fwNewStuAge').value, 10) || 8;
  const gender = document.getElementById('fwNewStuGender').value;
  const course_id = document.getElementById('fwNewStuCourse').value;
  const joining_date = document.getElementById('fwNewStuJoinDate').value;
  const assigned_teacher_id = document.getElementById('fwNewStuTeacher').value || null;
  const days_per_week = document.getElementById('fwNewStuDays').value;

  const notes = JSON.stringify({ days_per_week, language: 'English', certificates: [] });

  const newStuRecord = {
    id,
    family_id: familyId,
    name,
    age,
    gender,
    course_id,
    assigned_teacher_id,
    joining_date,
    notes,
    status: 'Active'
  };

  const { error } = await db.from('students').insert([newStuRecord]);
  if (error) {
    alert('Failed to enroll student: ' + error.message);
    if (btn) { btn.disabled = false; btn.innerText = 'Enroll Student in Family'; }
    return;
  }

  if (Array.isArray(window.ALL_STUDENTS)) window.ALL_STUDENTS.unshift(newStuRecord);
  const fam = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (fam) {
    if (!Array.isArray(fam.students)) fam.students = [];
    fam.students.push(newStuRecord);
  }

  _closeWorkspaceModal();
  _notify360(`Student ${name} (${id}) added to ${fam ? fam.parent_name : familyId} successfully!`);
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: id, studentSubView: 'info' });
}

// ============================================================================
// TOP FAMILY ACTION 2: SEND INVOICE (Section #4)
// Uses actual saved/current invoice and parent email, dispatches & logs to backend
// ============================================================================
function openFamilySendInvoiceModal(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const payData = _getFamilyPaymentsList(family);
  const currentInvoice = payData.rows[0] || {
    month: 'September',
    year: 2026,
    feeAmount: family.monthly_fee || 0,
    currency: family.currency || 'USD',
    status: 'UNPAID'
  };

  const parentEmail = family.parent_email || '';
  const studentsNames = ((window.ALL_STUDENTS || []).filter(s => String(s.family_id).toUpperCase() === String(family.id).toUpperCase()).map(s => s.name)).join(', ') || 'Enrolled Students';

  const subject = `Official Monthly Fee Invoice (${currentInvoice.month} ${currentInvoice.year}) — Al-Huda Islamic Centre`;
  const bodyText =
`Assalamu Alaikum Respected ${family.parent_name},

We pray you and your family are in the best of health and Iman.
Please find below your official monthly tuition invoice details for ${currentInvoice.month} ${currentInvoice.year}:

• Family ID: ${family.id}
• Enrolled Student(s): ${studentsNames}
• Billing Month: ${currentInvoice.month} ${currentInvoice.year}
• Agreed Monthly Fee: ${currentInvoice.currency} ${currentInvoice.feeAmount}
• Current Payment Status: ${currentInvoice.status}

Kindly remit the monthly fee via ${currentInvoice.paymentMethod || 'your usual payment method'} and share the confirmation receipt.

Jazakumullahu Khairan,
Accounts & Billing Department
Al-Huda Islamic Centre`;

  _openWorkspaceModal(
    `Send Current Month's Invoice`,
    `Family: ${family.parent_name} (${family.id})`,
    `
      <form onsubmit="executeSendFamilyInvoice(event, '${_esc360(family.id)}')" class="space-y-4 text-xs">
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Parent Recipient Email *</label>
          <input type="email" id="fwInvToEmail" value="${_esc360(parentEmail)}" required placeholder="parent@example.com" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Invoice Subject</label>
          <input type="text" id="fwInvSubject" value="${_esc360(subject)}" required class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
        </div>
        <div>
          <label class="font-extrabold text-slate-700 block mb-1">Invoice Details &amp; Message</label>
          <textarea id="fwInvBody" rows="8" required class="w-full p-3 rounded-xl border border-slate-300 font-mono text-xs text-slate-800">${_esc360(bodyText)}</textarea>
        </div>
        <div class="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 flex-wrap">
          <button type="button" onclick="openGmailDirectFromWorkspace('fwInvToEmail','fwInvSubject','fwInvBody')" class="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-extrabold">
            <i class="fa-brands fa-google mr-1"></i> Open in Gmail
          </button>
          <div class="flex items-center gap-2">
            <button type="button" onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Cancel</button>
            <button type="submit" id="btnFwSendInvoiceSubmit" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold">
              <i class="fa-solid fa-paper-plane mr-1"></i> Send Invoice Now
            </button>
          </div>
        </div>
      </form>
    `
  );
}

async function executeSendFamilyInvoice(e, familyId) {
  e.preventDefault();
  const toEmail = document.getElementById('fwInvToEmail').value.trim();
  const subject = document.getElementById('fwInvSubject').value.trim();
  const body = document.getElementById('fwInvBody').value.trim();
  const btn = document.getElementById('btnFwSendInvoiceSubmit');

  if (!toEmail) {
    alert('Parent email address is required to send the invoice.');
    return;
  }

  if (btn) { btn.disabled = true; btn.innerText = 'Dispatching Invoice...'; }

  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (family) {
    const fNotes = _parseFamilyStructuredNotes(family);
    fNotes.bio_meta.last_invoice_sent_month = 'September 2026';
    fNotes.bio_meta.last_invoice_sent_at = new Date().toISOString();
    fNotes.communication_logs.unshift({
      id: `INV-LOG-${Date.now()}`,
      type: 'invoice',
      to: toEmail,
      subject,
      sent_at: new Date().toISOString().slice(0, 16).replace('T', ' ')
    });

    await _saveFamilyStructuredNotes(family.id, fNotes, { parent_email: toEmail });
  }

  // Dispatch via EmailJS if configured
  try {
    if (typeof emailjs !== 'undefined' && window.EMAILJS_PUBLIC_KEY) {
      await emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
        to_email: toEmail,
        subject: subject,
        message: body,
        from_name: 'Al-Huda Islamic Centre Billing'
      });
    }
  } catch (err) {}

  _closeWorkspaceModal();
  _notify360(`Monthly Invoice dispatched to ${toEmail} and logged in Family records.`);
  _renderFamilyWorkspaceDOM();
}

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

  const toEmail = family.parent_email || '';
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
    if (typeof emailjs !== 'undefined' && window.EMAILJS_PUBLIC_KEY) {
      await emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
        to_email: toEmail,
        subject: subject,
        message: body,
        from_name: 'Al-Huda Islamic Centre'
      });
    }
  } catch (err) {}

  _closeWorkspaceModal();
  _notify360(`Email sent to ${toEmail} and saved in Family communication logs.`);
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
function openEditSingleStudentModal(familyId, studentId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!family || !student) return;

  const stuMeta = _parseStudentStructuredNotes(student);
  const teacherOptions = (window.ALL_TEACHERS || []).map(t =>
    `<option value="${_esc360(t.id)}" ${String(t.id) === String(student.assigned_teacher_id) ? 'selected' : ''}>${_esc360(t.full_name)}</option>`
  ).join('');

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
            <select id="fwEditStuTeacher" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-800">
              <option value="">-- No Teacher Assigned --</option>
              ${teacherOptions}
            </select>
          </div>
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

  const stuMeta = _parseStudentStructuredNotes(student);
  stuMeta.days_per_week = days_per_week;
  stuMeta.on_leave = (status.toLowerCase() === 'leave');

  await _saveStudentRecordBackend(student.id, {
    name,
    joining_date,
    age,
    gender,
    status,
    course_id,
    assigned_teacher_id,
    notes: JSON.stringify(stuMeta)
  });

  _closeWorkspaceModal();
  _notify360(`Student ${name}'s information updated in backend!`);
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: student.id, studentSubView: 'info' });
}

/**
 * STUDENT-ONLY DEACTIVATION (Section #13)
 * Deactivates ONLY the selected Student; Family and sibling Students remain Active!
 */
async function toggleSingleStudentDeactivate(familyId, studentId) {
  const student = (window.ALL_STUDENTS || []).find(s => String(s.id).toUpperCase() === String(studentId).toUpperCase());
  if (!student) return;

  const isCurrentlyInactive = String(student.status || '').toLowerCase() === 'inactive' || String(student.status || '').toLowerCase() === 'deactivated';
  const newStatus = isCurrentlyInactive ? 'Active' : 'Inactive';

  const msg = isCurrentlyInactive
    ? `Reactivate student "${student.name}" (${student.id})?`
    : `DEACTIVATE THIS STUDENT ONLY?\n\nStudent: ${student.name} (${student.id})\n\n• ${student.name} will be marked Deactivated.\n• The Family account and all other sibling students in this family will remain ACTIVE.`;

  if (!confirm(msg)) return;

  await _saveStudentRecordBackend(student.id, { status: newStatus });
  _notify360(`${student.name} is now ${newStatus === 'Inactive' ? 'Deactivated' : 'Active'} (Family & siblings unaffected).`);
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: student.id });
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

  if (!confirm(msg)) return;

  stuMeta.on_leave = !isCurrentlyOnLeave;
  await _saveStudentRecordBackend(student.id, {
    status: newStatus,
    notes: JSON.stringify(stuMeta)
  });

  _notify360(`${student.name} is now ${newStatus === 'Leave' ? 'On Leave' : 'Active'} (Student-only status updated).`);
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: student.id });
}

// ============================================================================
// FAMILY-LEVEL ACTIONS (Section #15)
// 1. Deactivate Family
// 2. Make Family on Leave
// 3. Suspend Family Classes
// 4. Edit Family Profile
// ============================================================================
async function handleFamilyLevelDeactivate(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const isInactive = String(family.status || '').toLowerCase() === 'inactive';
  const targetStatus = isInactive ? 'Active' : 'Inactive';

  if (!confirm(`${isInactive ? 'Activate' : 'Deactivate'} the ENTIRE Family account for "${family.parent_name}" (${family.id})?`)) return;

  const fNotes = _parseFamilyStructuredNotes(family);
  await _saveFamilyStructuredNotes(family.id, fNotes, { status: targetStatus });

  _notify360(`Family "${family.parent_name}" status updated to ${targetStatus}.`);
  _renderFamilyWorkspaceDOM();
}

async function handleFamilyLevelLeave(familyId) {
  const family = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
  if (!family) return;

  const isLeave = String(family.status || '').toLowerCase().includes('leave');
  const targetStatus = isLeave ? 'Active' : 'On Leave';

  if (!confirm(`${isLeave ? 'Return entire Family from Leave' : 'Place entire Family on Leave'} (${family.parent_name} • ${family.id})?`)) return;

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

  if (!confirm(`${isSuspended ? 'Unsuspend' : 'Suspend'} all classes for Family "${family.parent_name}" (${family.id})?`)) return;

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
            <input type="email" id="fwEditFamEmail" value="${_esc360(family.parent_email || '')}" class="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-slate-900">
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
    whatsapp: telephone || family.whatsapp,
    country,
    monthly_fee,
    currency
  });

  if (typeof saveParentAccount === 'function') {
    saveParentAccount(family.id, { username, password, parent_name, whatsapp: telephone, city, country, monthly_fee, currency });
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

  _openWorkspaceModal(
    `Official Invoice / Payment Record`,
    `Reference: ${row.recordId} • ${row.monthDisplay}`,
    `
      <div class="space-y-4 text-xs">
        <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <div class="flex justify-between"><span class="text-slate-500">Family / Parent:</span> <strong class="text-slate-900">${_esc360(family.parent_name)} (${_esc360(family.id)})</strong></div>
          <div class="flex justify-between"><span class="text-slate-500">Billing Month:</span> <strong class="text-slate-900">${_esc360(row.monthDisplay)}</strong></div>
          <div class="flex justify-between"><span class="text-slate-500">Payment Method:</span> <strong class="text-emerald-800">${_esc360(row.paymentMethod)}</strong></div>
          <div class="flex justify-between"><span class="text-slate-500">Paid Date:</span> <strong class="font-mono text-slate-800">${_esc360(row.paidDate)}</strong></div>
          <div class="flex justify-between"><span class="text-slate-500">Fee Amount:</span> <strong class="font-mono text-base text-slate-900">${_esc360(row.currency)} ${_esc360(row.feeAmount)}</strong></div>
          <div class="flex justify-between"><span class="text-slate-500">Status:</span> <strong class="${row.status === 'PAID' ? 'text-emerald-700' : 'text-rose-700'}">${_esc360(row.status)}</strong></div>
          <div class="flex justify-between"><span class="text-slate-500">Reason / Purpose:</span> <strong class="text-slate-800">${_esc360(row.reason || 'Monthly Tuition Fee')}</strong></div>
        </div>
        <div class="flex justify-end gap-2">
          <button onclick="_closeWorkspaceModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">Close</button>
          <button onclick="openEditFamilyPaymentModal('${_esc360(family.id)}', '${_esc360(row.recordId)}', '${_esc360(row.month)}', '${_esc360(row.year)}')" class="px-4 py-2 rounded-xl bg-amber-500 text-white font-extrabold">
            Edit Record
          </button>
        </div>
      </div>
    `
  );
}

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
  openFamilySendInvoiceModal(familyId);
}

async function deleteFamilyPaymentRecord(familyId, recordId, month, year) {
  if (window.CURRENT_ROLE === 'teacher' || window.CURRENT_ROLE === 'student') {
    alert('Access Denied: Only Admin/Management can delete payment entries.');
    return;
  }

  if (!confirm(`Are you sure you want to delete the payment/invoice entry for ${month} ${year}?\n\nThis will remove the record from the backend and recalculate financial totals.`)) return;

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
  if (!confirm('Delete this Manager Note permanently?')) return;
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
  if (!confirm('Delete this Teacher Note?')) return;
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
  _notify360(`Attendance (${status}) & Daily Lesson recorded for ${date}!`);
  await openFamily360Profile(familyId, 'students', true, { selectedStudentId: studentId, studentSubView: 'history' });
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
  if (!confirm('Delete this certificate record?')) return;
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
// TEACHER SCHEDULE & PROFILE FULL-SCREEN WORKSPACE
// ============================================================================
async function openTeacher360Profile(teacherId, initialTab = 'students', skipHistoryPush = false, options = {}) {
  if (!teacherId) return;

  _activateFullScreenProfilePage('teacher');
  const workspace = document.getElementById('unified360PageWorkspace');
  if (!workspace) return;

  workspace.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-14 text-center text-slate-500 shadow-2xs">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-600 mb-3 block"></i>
      <span class="text-sm font-extrabold">Loading Teacher Schedule &amp; Assigned Students...</span>
    </div>
  `;

  await _ensure360CoreDataReady();

  let teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
  if (!teacher) {
    const { data } = await db.from('teachers').select('*').eq('id', teacherId).maybeSingle();
    teacher = data;
    if (teacher && Array.isArray(window.ALL_TEACHERS)) window.ALL_TEACHERS.push(teacher);
  }
  if (!teacher) {
    workspace.innerHTML = `${_buildTopWorkspaceNavHtml()}<div class="p-12 bg-white rounded-2xl border text-center text-rose-600 font-bold">Teacher not found.</div>`;
    return;
  }

  _CURRENT_360_STATE.type = 'teacher';
  _CURRENT_360_STATE.id = teacher.id;
  _CURRENT_360_STATE.activeTab = initialTab;

  if (!skipHistoryPush) {
    _push360History('teacher', teacher.id, teacher.full_name, initialTab);
  }

  const assignedStudents = (window.ALL_STUDENTS || []).filter(s =>
    String(s.assigned_teacher_id) === String(teacher.id) &&
    String(s.status || '').toLowerCase() !== 'trial'
  );

  const { data: schedules } = await db.from('class_schedules').select('*, students(*)').eq('teacher_id', teacher.id);
  const tchSchedules = schedules || [];

  workspace.innerHTML = `
    ${_buildTopWorkspaceNavHtml()}

    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-2xl font-black text-amber-400">
            ${_esc360((teacher.full_name || 'T').charAt(0).toUpperCase())}
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-xl font-black text-white">${_esc360(teacher.full_name)}</h1>
              <span class="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-xs font-extrabold">${_esc360(teacher.working_shift || 'Active Shift')}</span>
            </div>
            <p class="text-xs text-slate-300 mt-1">
              Assigned Students: <strong>${assignedStudents.length}</strong> &bull; Booked Weekly Class Slots: <strong>${tchSchedules.length}</strong>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${typeof openTeacherScheduleModal === 'function' ? `
            <button onclick="openTeacherScheduleModal('${_esc360(teacher.id)}', '${_esc360(teacher.full_name)}')"
                    class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold transition cursor-pointer">
              <i class="fa-solid fa-calendar-days mr-1"></i> Open Interactive 2D Timetable Matrix
            </button>
          ` : ''}
        </div>
      </div>

      <div class="p-6 space-y-6">
        <div>
          <h3 class="text-sm font-black text-slate-900 mb-3">Teacher's Weekly Class Schedule &amp; Assigned Students</h3>
          ${assignedStudents.length === 0 ? `
            <div class="p-10 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-xs">
              No regular students currently assigned to ${_esc360(teacher.full_name)}.
            </div>
          ` : `
            <div class="overflow-x-auto border border-slate-200 rounded-xl">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
                  <tr>
                    <th class="p-3.5">#</th>
                    <th class="p-3.5">Student (Opens Family Workspace)</th>
                    <th class="p-3.5">Family / Parent</th>
                    <th class="p-3.5">Course</th>
                    <th class="p-3.5">Scheduled Slots</th>
                    <th class="p-3.5">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${assignedStudents.map((stu, i) => {
                    const fam = (window.ALL_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(stu.family_id).toUpperCase());
                    const stuSlots = tchSchedules.filter(sc => String(sc.student_id).toUpperCase() === String(stu.id).toUpperCase());
                    const slotText = stuSlots.length > 0
                      ? stuSlots.map(sc => `${_DAY_LABELS_360[sc.day_of_week] || sc.day_of_week} (${(sc.start_time || '').slice(0,5)})`).join(', ')
                      : 'Regular Weekly Slot';
                    const isHighlighted = options.highlightStudentId && String(stu.id).toUpperCase() === String(options.highlightStudentId).toUpperCase();

                    return `
                      <tr class="${isHighlighted ? 'bg-indigo-50/80 font-bold' : 'hover:bg-slate-50'}">
                        <td class="p-3.5 font-mono font-bold text-slate-500">${i + 1}</td>
                        <td class="p-3.5">
                          <button onclick="openStudent360Profile('${_esc360(stu.id)}')" class="font-extrabold text-indigo-700 hover:underline cursor-pointer">
                            ${_esc360(stu.name)} (${_esc360(stu.id)})
                          </button>
                        </td>
                        <td class="p-3.5">
                          ${fam ? `
                            <button onclick="openFamily360Profile('${_esc360(fam.id)}')" class="font-bold text-slate-800 hover:text-indigo-700 hover:underline cursor-pointer">
                              ${_esc360(fam.parent_name)} (${_esc360(fam.id)})
                            </button>
                          ` : _esc360(stu.family_id)}
                        </td>
                        <td class="p-3.5 text-slate-700">${_esc360(stu.course_id || 'Quran Studies')}</td>
                        <td class="p-3.5 font-mono text-emerald-800 font-bold">${_esc360(slotText)}</td>
                        <td class="p-3.5"><span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-black">${_esc360(stu.status || 'Active')}</span></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}
