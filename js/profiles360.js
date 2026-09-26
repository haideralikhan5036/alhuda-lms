/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — FULL-SCREEN DEDICATED 360° PROFILES ENGINE
 * File: js/profiles360.js
 * Purpose: Standalone Full-Screen Dedicated Profile Workspaces for Students,
 *          Families/Parents, and Teachers (Zero Popup / Zero Modal).
 *          Combines structured tabular & Bio-Data organization with modern LMS UI.
 * ============================================================================
 */

let _PROFILE_360_STACK = [];
let _ORIGIN_LMS_TAB = 'tab-dashboard';
let _CURRENT_360_STATE = {
  type: null,      // 'student' | 'family' | 'teacher'
  id: null,
  activeTab: null,
  attMonthFilter: 'all'
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
  'tab-invoices': 'Fee Billing & Ledger',
  'tab-salaries': 'Salaries & Payroll',
  'tab-attendance': 'Daily Attendance',
  'tab-trials': 'Trial Classes',
  'tab-leaves': 'Leave Management',
  'tab-schedule-search': 'Schedule Search',
  'tab-curriculum': 'Course Curriculum'
};

/**
 * Dismiss any open modal overlays/popups and transition the main LMS viewport
 * to the Full-Screen Dedicated Profile Page (#tab-profile-360).
 */
function _activateFullScreenProfilePage(entityType) {
  // Remember which non-profile LMS tab the user was on before entering 360° workspace
  const visibleSection = Array.from(document.querySelectorAll('.tab-content')).find(
    el => !el.classList.contains('hidden') && el.id !== 'tab-profile-360'
  );
  if (visibleSection && visibleSection.id) {
    _ORIGIN_LMS_TAB = visibleSection.id;
  }

  // Close any open modal overlays or search dropdowns so nothing floats over the full-screen page
  document.querySelectorAll('.fixed.inset-0').forEach(modalEl => {
    if (!modalEl.classList.contains('hidden')) {
      modalEl.classList.add('hidden');
      modalEl.classList.remove('flex');
    }
  });
  if (typeof clearDashboardGlobalSearch === 'function') {
    try { clearDashboardGlobalSearch(); } catch (e) {}
  }

  // Switch main content area to the full-screen #tab-profile-360 workspace
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

  // Highlight the logical parent sidebar button (Families for Student/Family, Teachers for Teacher)
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

/**
 * Exit the Full-Screen 360° Profile Page back to the originating LMS module
 */
function exitFullScreen360Profile() {
  _PROFILE_360_STACK = [];
  const targetTab = _ORIGIN_LMS_TAB && _ORIGIN_LMS_TAB !== 'tab-profile-360' ? _ORIGIN_LMS_TAB : 'tab-dashboard';
  if (typeof switchTab === 'function') {
    switchTab(targetTab);
  }
}

/**
 * Ensure base collections (ALL_FAMILIES, ALL_STUDENTS, ALL_TEACHERS) are synced
 */
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
    console.warn('360° core data sync notice:', err);
  }
}

/**
 * Push to 360° Breadcrumb Stack
 */
function _push360History(type, id, label, tab) {
  if (!type || !id) return;
  const last = _PROFILE_360_STACK[_PROFILE_360_STACK.length - 1];
  if (last && last.type === type && String(last.id) === String(id)) {
    last.label = label || last.label;
    last.tab = tab || last.tab;
    return;
  }
  const existingIdx = _PROFILE_360_STACK.findIndex(item => item.type === type && String(item.id) === String(id));
  if (existingIdx !== -1 && existingIdx === _PROFILE_360_STACK.length - 2) {
    _PROFILE_360_STACK.pop();
    return;
  }
  _PROFILE_360_STACK.push({ type, id, label: label || String(id), tab });
  if (_PROFILE_360_STACK.length > 8) {
    _PROFILE_360_STACK.shift();
  }
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
  if (prev.type === 'student') openStudent360Profile(prev.id, prev.tab);
  else if (prev.type === 'family') openFamily360Profile(prev.id, prev.tab);
  else if (prev.type === 'teacher') openTeacher360Profile(prev.id, prev.tab);
}

function jumpTo360Breadcrumb(index) {
  const item = _PROFILE_360_STACK[index];
  if (!item) return;
  _PROFILE_360_STACK = _PROFILE_360_STACK.slice(0, index);
  if (item.type === 'student') openStudent360Profile(item.id, item.tab);
  else if (item.type === 'family') openFamily360Profile(item.id, item.tab);
  else if (item.type === 'teacher') openTeacher360Profile(item.id, item.tab);
}

async function refreshCurrent360Profile() {
  await _ensure360CoreDataReady(true);
  if (_CURRENT_360_STATE.type === 'student' && _CURRENT_360_STATE.id) {
    await openStudent360Profile(_CURRENT_360_STATE.id, _CURRENT_360_STATE.activeTab, true);
  } else if (_CURRENT_360_STATE.type === 'family' && _CURRENT_360_STATE.id) {
    await openFamily360Profile(_CURRENT_360_STATE.id, _CURRENT_360_STATE.activeTab, true);
  } else if (_CURRENT_360_STATE.type === 'teacher' && _CURRENT_360_STATE.id) {
    await openTeacher360Profile(_CURRENT_360_STATE.id, _CURRENT_360_STATE.activeTab, true);
  }
}

/**
 * Render the Top Workspace Navigation Bar (Back to LMS Page + Interconnected Breadcrumbs + Sync Button)
 */
function _buildTopWorkspaceNavHtml() {
  const originLabel = _TAB_NAMES_MAP[_ORIGIN_LMS_TAB] || 'Main Dashboard';
  const crumbsHtml = _PROFILE_360_STACK.map((item, idx) => {
    const isLast = idx === _PROFILE_360_STACK.length - 1;
    const typeBadge = item.type === 'student' ? 'Student'
                    : item.type === 'family'  ? 'Family'
                    :                           'Teacher';
    return `
      <button onclick="${isLast ? '' : `jumpTo360Breadcrumb(${idx})`}"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition ${isLast ? 'bg-emerald-900 text-white shadow-2xs cursor-default' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer'}">
        <span class="opacity-75 font-normal">${typeBadge}:</span>
        <span class="font-extrabold">${item.label}</span>
      </button>
      ${!isLast ? '<i class="fa-solid fa-chevron-right text-[10px] text-slate-400 mx-0.5"></i>' : ''}
    `;
  }).join('');

  return `
    <div class="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-2xs flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap">
        <button onclick="exitFullScreen360Profile()" class="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold flex items-center gap-2 transition shadow-2xs">
          <i class="fa-solid fa-arrow-left text-amber-400"></i> Back to ${originLabel}
        </button>
        ${_PROFILE_360_STACK.length > 1 ? `
          <button onclick="navigateBack360Profile()" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold flex items-center gap-1.5 transition">
            <i class="fa-solid fa-rotate-left text-slate-600"></i> Previous Profile
          </button>
        ` : ''}
        <div class="h-4 w-[1px] bg-slate-200 mx-1 hidden sm:block"></div>
        <div class="flex items-center gap-1 flex-wrap">
          ${crumbsHtml}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="refreshCurrent360Profile()" class="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-extrabold flex items-center gap-1.5 transition">
          <i class="fa-solid fa-arrows-rotate text-emerald-600"></i> Refresh Live Data
        </button>
      </div>
    </div>
  `;
}

/**
 * Helper: Parse lesson_notes from attendance_logs into structured lesson details
 */
function _parseLessonLogEntry(log) {
  const raw = log?.lesson_notes || '';
  let bookId = 'noorani-qaida-classic';
  let bookTitle = '';
  let page = null;
  let lineRange = '';
  let assessment = '';
  let rating = null;
  let remarks = '';
  let isStructured = false;

  if (raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object') {
        isStructured = Boolean(parsed.book_title || parsed.page || parsed.sabaq || parsed.status);
        bookId = parsed.book_id || 'noorani-qaida-classic';
        bookTitle = parsed.book_title || parsed.sabaq || '';
        page = parsed.page || null;
        lineRange = parsed.line_range || '';
        assessment = parsed.status || parsed.result || '';
        rating = parsed.rating || null;
        remarks = parsed.remarks || parsed.notes || '';
      }
    } catch (e) {
      remarks = String(raw);
    }
  }

  return {
    isStructured,
    bookId,
    bookTitle: bookTitle || (isStructured ? 'Course Syllabus' : ''),
    page,
    lineRange,
    assessment,
    rating,
    remarks: remarks || (!isStructured ? String(raw) : '')
  };
}

/**
 * Helper: Compute Family Financial Summary from existing fees.js sources
 */
function _getFamilyFinancialSnapshot(family) {
  if (!family) {
    return {
      currency: 'USD',
      agreedMonthlyFee: 0,
      totalPaid: 0,
      totalPending: 0,
      advanceCredit: 0,
      monthsStatus: [],
      receipts: []
    };
  }

  const famId = String(family.id || '').toUpperCase();
  const currency = family.currency || 'USD';
  const agreedMonthlyFee = parseFloat(family.monthly_fee || 0) || 0;

  let receipts = [];
  if (typeof getStoredFeeRecords === 'function') {
    receipts = (getStoredFeeRecords() || []).filter(r => String(r.familyId || '').toUpperCase() === famId);
  } else {
    try {
      const raw = JSON.parse(localStorage.getItem('alhuda_fee_records_v1') || '[]');
      receipts = raw.filter(r => String(r.familyId || '').toUpperCase() === famId);
    } catch (e) {}
  }

  receipts.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const totalPaid = receipts.reduce((sum, r) => sum + (parseFloat(r.amountPaid || 0) || 0), 0);

  let advanceCredit = 0;
  if (typeof getFamilyAvailableAdvanceCredit === 'function') {
    try { advanceCredit = parseFloat(getFamilyAvailableAdvanceCredit(family.id) || 0); } catch (e) {}
  }

  const monthsNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const currentMonthIdx = 8; // September 2026
  let matrixRow = null;
  if (Array.isArray(window.CACHED_ANNUAL_FEE_MATRIX)) {
    matrixRow = window.CACHED_ANNUAL_FEE_MATRIX.find(r => String(r.familyId || '').toUpperCase() === famId);
  }

  let earliestJoinDate = family.created_at ? family.created_at.slice(0, 10) : '2026-01-01';
  const famStudents = (window.ALL_STUDENTS || []).filter(s => String(s.family_id || '').toUpperCase() === famId);
  famStudents.forEach(s => {
    if (s.joining_date && s.joining_date < earliestJoinDate) earliestJoinDate = s.joining_date;
  });
  const joinYear = parseInt(earliestJoinDate.slice(0, 4), 10) || 2026;
  const joinMonthIdx = (parseInt(earliestJoinDate.slice(5, 7), 10) || 1) - 1;

  let totalPending = 0;
  const monthsStatus = monthsNames.map((mName, mIdx) => {
    const mNumStr = String(mIdx + 1).padStart(2, '0');
    const dueDateStr = `2026-${mNumStr}-10`;

    const monthReceipts = receipts.filter(r => String(r.month || '').toLowerCase() === mName.toLowerCase() && Number(r.year || 2026) === 2026);
    const paidInMonth = monthReceipts.reduce((acc, r) => acc + (parseFloat(r.amountPaid || 0) || 0), 0);
    const paidDateStr = monthReceipts[0]?.date || (paidInMonth >= agreedMonthlyFee && agreedMonthlyFee > 0 ? `2026-${mNumStr}-05` : '--');
    const paymentMethod = monthReceipts[0]?.paymentMethod || (currency === 'GBP' ? 'UK Bank Transfer' : 'Online Transfer');

    if (matrixRow && Array.isArray(matrixRow.months) && matrixRow.months[mIdx]) {
      const mObj = matrixRow.months[mIdx];
      if (!mObj.isPaid && !mObj.isLeave && !mObj.isNotEnrolled && !mObj.isFuture) {
        const rem = mObj.isPartial ? Math.max(0, agreedMonthlyFee - (parseFloat(mObj.amountPaid || 0))) : agreedMonthlyFee;
        totalPending += rem;
      }
      return {
        ...mObj,
        dueDate: dueDateStr,
        paidDate: mObj.isPaid ? paidDateStr : '--',
        paymentMethod
      };
    }

    const isNotEnrolled = (joinYear === 2026 && mIdx < joinMonthIdx);
    const isFuture = mIdx > currentMonthIdx && paidInMonth === 0;
    const isPaid = paidInMonth >= agreedMonthlyFee && agreedMonthlyFee > 0;
    const isPartial = paidInMonth > 0 && paidInMonth < agreedMonthlyFee;

    if (!isPaid && !isNotEnrolled && !isFuture) {
      totalPending += Math.max(0, agreedMonthlyFee - paidInMonth);
    }

    return {
      month: mName,
      isPaid,
      isPartial,
      isLeave: false,
      isNotEnrolled,
      isFuture,
      amountPaid: paidInMonth,
      dueDate: dueDateStr,
      paidDate: isPaid || isPartial ? paidDateStr : '--',
      paymentMethod
    };
  });

  return {
    currency,
    agreedMonthlyFee,
    totalPaid,
    totalPending,
    advanceCredit,
    monthsStatus,
    receipts
  };
}

/**
 * Helper: Build a clean 3-column Bio Data specification table (modeled on Reference Screenshot 1)
 */
function _buildThreeColSpecTableHtml(rowsData) {
  // rowsData is an array of { label, value } items; we group them into rows of 3 columns
  const chunks = [];
  for (let i = 0; i < rowsData.length; i += 3) {
    chunks.push(rowsData.slice(i, i + 3));
  }
  return `
    <div class="overflow-x-auto">
      <table class="w-full text-left text-xs border-collapse">
        <tbody class="divide-y divide-slate-200">
          ${chunks.map(row => `
            <tr class="hover:bg-slate-50/70 transition">
              ${[0, 1, 2].map(colIdx => {
                const item = row[colIdx];
                if (!item) return `<td class="p-4 w-1/3"></td>`;
                return `
                  <td class="p-4 w-1/3 align-middle border-r last:border-r-0 border-slate-100">
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-slate-500 font-semibold">${item.label}:</span>
                      <span class="font-bold text-teal-800 text-right">${item.value ?? '--'}</span>
                    </div>
                  </td>
                `;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// 1. FAMILY / PARENT FULL-SCREEN DEDICATED PROFILE PAGE
// ============================================================================
async function openFamily360Profile(familyId, initialTab = 'students', skipHistoryPush = false) {
  if (!familyId) return;

  _activateFullScreenProfilePage('family');
  const workspace = document.getElementById('unified360PageWorkspace');
  if (!workspace) return;

  workspace.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-16 text-center text-slate-500 shadow-xs">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-emerald-600 mb-3 block"></i>
      <span class="text-sm font-extrabold">Loading Full-Screen Family Profile Workspace...</span>
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
      <div class="bg-white rounded-2xl border border-slate-200 p-12 text-center text-rose-600 font-bold">
        Family record (${familyId}) could not be found.
      </div>
    `;
    return;
  }

  const validTabs = ['students', 'payments', 'lessons', 'biodata'];
  const activeTab = validTabs.includes(initialTab) ? initialTab : 'students';

  _CURRENT_360_STATE.type = 'family';
  _CURRENT_360_STATE.id = family.id;
  _CURRENT_360_STATE.activeTab = activeTab;

  if (!skipHistoryPush) {
    _push360History('family', family.id, `${family.parent_name} (${family.id})`, activeTab);
  }

  // Retrieve Family Students
  const familyStudents = (window.ALL_STUDENTS || []).filter(s =>
    String(s.family_id || '').toUpperCase() === String(family.id).toUpperCase() &&
    String(s.status || '').toLowerCase() !== 'trial'
  );
  const studentIds = familyStudents.map(s => s.id);

  // Retrieve Schedules & Lesson/Attendance Logs for Family Students
  const [schedRes, logsRes] = await Promise.all([
    studentIds.length > 0 ? db.from('class_schedules').select('*, teachers(*)').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length > 0 ? db.from('attendance_logs').select('*').in('student_id', studentIds).order('date', { ascending: false }).limit(100) : Promise.resolve({ data: [] })
  ]);

  const famSchedules = schedRes.data || [];
  const famLogs = logsRes.data || [];

  const fin = _getFamilyFinancialSnapshot(family);
  const creds = (typeof getParentCreds === 'function') ? getParentCreds(family) : { username: 'parent_' + family.id, password: '123456' };

  const rawPhone = family.whatsapp || '';
  const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  const displayPhone = (window.CURRENT_ROLE === 'manager' && typeof maskStudentPhone === 'function')
    ? maskStudentPhone(rawPhone)
    : (rawPhone || 'Not Provided');
  const displayEmail = (window.CURRENT_ROLE === 'manager' && typeof maskStudentEmail === 'function')
    ? maskStudentEmail(family.parent_email || '')
    : (family.parent_email || 'Not Provided');

  const regDate = family.created_at ? family.created_at.slice(0, 10) : '2026-01-01';
  const famStatus = (family.status || 'Regular').toUpperCase();

  const tabsConfig = [
    { id: 'students', label: `Students (${familyStudents.length})` },
    { id: 'payments', label: 'Payments & Fee Ledger' },
    { id: 'lessons',  label: 'Lessons & Attendance' },
    { id: 'biodata',  label: 'Bio Data' }
  ];

  // Build Active Tab Content (Strictly Separated — One Category per Tab)
  let tabContentHtml = '';

  // -------------------------------------------------------------------------
  // FAMILY TAB 1: STUDENTS (Modeled on Reference Screenshot 3)
  // -------------------------------------------------------------------------
  if (activeTab === 'students') {
    tabContentHtml = `
      <div>
        ${familyStudents.length === 0 ? `
          <div class="p-12 text-center text-slate-400 text-sm">
            No students enrolled under this family yet.
            <div class="mt-3">
              <button onclick="prepareAddStudentModal('${family.id}')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold">
                + Add First Student
              </button>
            </div>
          </div>
        ` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
                <tr>
                  <th class="p-4 w-14">#</th>
                  <th class="p-4">Name</th>
                  <th class="p-4">Course &amp; Weekly Schedule</th>
                  <th class="p-4">History / Lessons</th>
                  <th class="p-4">Reports / Attendance</th>
                  <th class="p-4">Teacher</th>
                  <th class="p-4">Joining Date</th>
                  <th class="p-4 text-right">Quick Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${familyStudents.map((s, idx) => {
                  const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(s.assigned_teacher_id));
                  const sScheds = famSchedules.filter(sc => String(sc.student_id) === String(s.id));
                  const schedText = sScheds.length > 0
                    ? `${sScheds.length} Days/Wk (${(sScheds[0].start_time || '').slice(0,5)} PKT)`
                    : 'Schedule Not Booked';
                  return `
                    <tr class="hover:bg-slate-50/80 transition">
                      <td class="p-4">
                        <span class="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-400 text-slate-950 font-black text-xs shadow-2xs">${idx + 1}</span>
                      </td>
                      <td class="p-4">
                        <button onclick="openStudent360Profile('${s.id}', 'overview')" class="font-extrabold text-sm text-blue-700 hover:text-emerald-700 hover:underline flex items-center gap-1.5 text-left">
                          <i class="fa-solid fa-check text-slate-800 text-xs"></i>
                          <span>${s.name}</span>
                        </button>
                        <span class="text-[10px] font-mono text-slate-400 block ml-4">${s.id}</span>
                      </td>
                      <td class="p-4">
                        <span class="font-bold text-slate-800 block">${s.course_id || 'Noorani Qaida & Quran'}</span>
                        <span class="text-[11px] text-slate-500 font-mono">${schedText}</span>
                      </td>
                      <td class="p-4">
                        <button onclick="openStudent360Profile('${s.id}', 'lessons')" class="text-blue-600 hover:text-blue-800 hover:underline font-bold">
                          Daily Lessons
                        </button>
                      </td>
                      <td class="p-4">
                        <div class="flex items-center gap-3">
                          <button onclick="openStudent360Profile('${s.id}', 'progress')" class="text-blue-600 hover:text-blue-800 hover:underline font-bold">
                            Progress
                          </button>
                          <span class="text-slate-300">|</span>
                          <button onclick="openStudent360Profile('${s.id}', 'attendance')" class="text-teal-700 hover:text-teal-900 hover:underline font-bold">
                            Attendance
                          </button>
                        </div>
                      </td>
                      <td class="p-4">
                        ${tObj ? `
                          <button onclick="openTeacher360Profile('${tObj.id}', 'overview')" class="text-blue-600 hover:text-indigo-800 hover:underline font-bold text-left">
                            ${tObj.full_name}
                          </button>
                        ` : '<span class="text-slate-400 italic">Not Assigned</span>'}
                      </td>
                      <td class="p-4 font-mono text-slate-600">${s.joining_date || '--'}</td>
                      <td class="p-4 text-right">
                        <div class="inline-flex items-center gap-1.5">
                          <button onclick="openStudent360Profile('${s.id}', 'overview')" class="px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs transition" title="Open Full-Screen Student Profile">
                            <i class="fa-regular fa-id-card mr-1"></i>Profile
                          </button>
                          <button onclick="openStudent360Profile('${s.id}', 'classes')" class="p-1.5 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 transition" title="Student Classes & Schedule">
                            <i class="fa-regular fa-clock"></i>
                          </button>
                          ${tObj ? `
                            <button onclick="open2DMatrixForTeacher('${tObj.id}')" class="p-1.5 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 transition" title="Open Teacher 2D Timetable">
                              <i class="fa-solid fa-table-cells"></i>
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
        `}
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // FAMILY TAB 2: PAYMENTS & FEE LEDGER (Modeled on Reference Screenshot 2)
  // -------------------------------------------------------------------------
  else if (activeTab === 'payments') {
    const activeMonthsList = [...fin.monthsStatus].reverse().filter(m => !m.isNotEnrolled);
    tabContentHtml = `
      <div class="space-y-4 p-4 sm:p-5">
        <!-- Refined Financial Summary Strip -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-[11px] font-bold text-slate-500 block">Agreed Monthly Fee</span>
            <strong class="text-lg font-black text-slate-900">${fin.currency} ${fin.agreedMonthlyFee.toFixed(0)}/-</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
            <span class="text-[11px] font-bold text-emerald-700 block">Total Paid Amount</span>
            <strong class="text-lg font-black text-emerald-900">${fin.currency} ${fin.totalPaid.toFixed(0)}/-</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-rose-50 border border-rose-200">
            <span class="text-[11px] font-bold text-rose-700 block">Total Pending / Due</span>
            <strong class="text-lg font-black text-rose-900">${fin.currency} ${fin.totalPending.toFixed(0)}/-</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-sky-50 border border-sky-200">
            <span class="text-[11px] font-bold text-sky-700 block">Advance Credit Balance</span>
            <strong class="text-lg font-black text-sky-900">${fin.currency} ${fin.advanceCredit.toFixed(0)}/-</strong>
          </div>
        </div>

        <!-- Monthly Payment & Invoice Table (Matches Screenshot 2 Columns) -->
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-800 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">${fin.currency} / Method</th>
                <th class="p-3.5">Month</th>
                <th class="p-3.5">Due Date</th>
                <th class="p-3.5">Paid Date</th>
                <th class="p-3.5">Fee</th>
                <th class="p-3.5">ADJ</th>
                <th class="p-3.5">AMT</th>
                <th class="p-3.5 text-center">Status</th>
                <th class="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${activeMonthsList.map(m => {
                const isPaid = m.isPaid;
                const isPartial = m.isPartial;
                const isFuture = m.isFuture;
                const amtDisplay = isPaid ? fin.agreedMonthlyFee : (isPartial ? parseFloat(m.amountPaid || 0) : 0);
                let statusPill = `<span class="px-2.5 py-1 rounded bg-rose-600 text-white font-black text-[10px] uppercase">DUE</span>`;
                if (isPaid) statusPill = `<span class="px-2.5 py-1 rounded bg-emerald-600 text-white font-black text-[10px] uppercase">PAID</span>`;
                else if (isPartial) statusPill = `<span class="px-2.5 py-1 rounded bg-amber-500 text-white font-black text-[10px] uppercase">PARTIAL</span>`;
                else if (isFuture) statusPill = `<span class="px-2.5 py-1 rounded bg-slate-200 text-slate-600 font-bold text-[10px] uppercase">UPCOMING</span>`;

                return `
                  <tr class="hover:bg-slate-50/80 transition">
                    <td class="p-3.5 font-semibold text-emerald-700">${m.paymentMethod}</td>
                    <td class="p-3.5 font-bold text-emerald-800">${m.month.slice(0, 3)}</td>
                    <td class="p-3.5 font-mono text-emerald-700">${m.dueDate}</td>
                    <td class="p-3.5 font-mono text-emerald-700">${m.paidDate}</td>
                    <td class="p-3.5 font-mono font-bold text-emerald-800">${fin.currency}${fin.agreedMonthlyFee}</td>
                    <td class="p-3.5 font-mono text-blue-600">${fin.currency}0/-</td>
                    <td class="p-3.5 font-mono font-extrabold text-emerald-800">${fin.currency}${amtDisplay > 0 ? amtDisplay : fin.agreedMonthlyFee}/-</td>
                    <td class="p-3.5 text-center">${statusPill}</td>
                    <td class="p-3.5 text-right">
                      <div class="inline-flex items-center gap-1.5">
                        <button onclick="switchTab('tab-invoices'); if (typeof selectFeeFamily === 'function') selectFeeFamily('${family.id}');"
                                class="p-1.5 rounded border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-700 transition" title="Record / Edit Payment">
                          <i class="fa-solid fa-credit-card"></i>
                        </button>
                        <button onclick="if (typeof openFamilyAnnualLedgerModal === 'function') openFamilyAnnualLedgerModal('${family.id}');"
                                class="p-1.5 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 transition" title="Inspect Full Receipt Ledger">
                          <i class="fa-solid fa-file-invoice"></i>
                        </button>
                        <button onclick="openFamilyEmailModal('${family.id}')"
                                class="p-1.5 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition" title="Send Fee Invoice Email">
                          <i class="fa-regular fa-envelope"></i>
                        </button>
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

  // -------------------------------------------------------------------------
  // FAMILY TAB 3: LESSONS & ATTENDANCE (Consolidated Family Academic Log)
  // -------------------------------------------------------------------------
  else if (activeTab === 'lessons') {
    tabContentHtml = `
      <div class="p-4 sm:p-5">
        ${famLogs.length === 0 ? `
          <div class="p-10 text-center text-slate-400 text-xs">No daily lessons or attendance logs recorded for this family's students yet.</div>
        ` : `
          <div class="overflow-x-auto border border-slate-200 rounded-xl">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
                <tr>
                  <th class="p-3.5">Date</th>
                  <th class="p-3.5">Student</th>
                  <th class="p-3.5">Attendance Status</th>
                  <th class="p-3.5">Daily Lesson / Sabaq Studied</th>
                  <th class="p-3.5">Assigned Teacher</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${famLogs.slice(0, 40).map(l => {
                  const sObj = familyStudents.find(s => String(s.id) === String(l.student_id));
                  const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(l.teacher_id));
                  const parsed = _parseLessonLogEntry(l);
                  const st = l.status || 'Present';
                  const stClass = st === 'Present' ? 'bg-emerald-600 text-white' : st === 'Absent' ? 'bg-rose-600 text-white' : 'bg-blue-600 text-white';
                  return `
                    <tr class="hover:bg-slate-50/80 transition">
                      <td class="p-3.5 font-mono font-bold text-slate-800">${l.date || '--'}</td>
                      <td class="p-3.5">
                        ${sObj ? `<button onclick="openStudent360Profile('${sObj.id}', 'lessons')" class="font-extrabold text-blue-700 hover:underline">${sObj.name}</button>` : l.student_id}
                      </td>
                      <td class="p-3.5"><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase ${stClass}">${st}</span></td>
                      <td class="p-3.5 text-slate-700">
                        ${parsed.bookTitle ? `<strong>${parsed.bookTitle}</strong> ${parsed.page ? `(Page ${parsed.page})` : ''} ${parsed.assessment ? `• ${parsed.assessment}` : ''} ${parsed.remarks ? `— "${parsed.remarks}"` : ''}` : (parsed.remarks || 'Completed class')}
                      </td>
                      <td class="p-3.5">
                        ${tObj ? `<button onclick="openTeacher360Profile('${tObj.id}', 'overview')" class="font-bold text-blue-600 hover:underline">${tObj.full_name}</button>` : '--'}
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

  // -------------------------------------------------------------------------
  // FAMILY TAB 4: BIO DATA (Modeled on Reference Screenshot 1)
  // -------------------------------------------------------------------------
  else if (activeTab === 'biodata') {
    const bioRows = [
      { label: 'Parent / Guardian', value: family.parent_name },
      { label: 'Family ID',         value: family.id },
      { label: 'Email',             value: displayEmail },
      { label: 'Telephone / WhatsApp', value: displayPhone },
      { label: 'Classroom Mode',    value: 'Zoom Classroom' },
      { label: 'Agreed Monthly Fee', value: `${fin.currency} ${fin.agreedMonthlyFee}` },
      { label: 'Country',           value: family.country || 'United Kingdom / Global' },
      { label: 'City / Notes',      value: family.notes || 'Standard Registration' },
      { label: 'Registration Date', value: regDate },
      { label: 'Portal Username',   value: creds.username },
      { label: 'Portal Password',   value: creds.password },
      { label: 'Account Status',    value: family.status || 'Active' }
    ];
    tabContentHtml = _buildThreeColSpecTableHtml(bioRows);
  }

  // Assemble Full-Screen Family Profile Page
  workspace.innerHTML = `
    ${_buildTopWorkspaceNavHtml()}

    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <!-- FULL-WIDTH EMERALD PROFILE BANNER (Structured like Reference Screenshots) -->
      <div class="bg-gradient-to-b from-[#10b981] via-[#059669] to-[#047857] text-white pt-6 px-4 sm:px-8 flex flex-col items-center text-center">
        <!-- Avatar Box -->
        <div class="w-16 h-16 rounded-xl bg-white/20 border-2 border-white shadow-md flex items-center justify-center text-2xl font-black text-white mb-2">
          <i class="fa-solid fa-user-tie"></i>
        </div>

        <!-- Name & Registration Date -->
        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-white">${family.parent_name}</h1>
        <div class="text-sm font-mono font-semibold text-white/95 mt-0.5">${regDate}</div>

        <!-- Status & Invoice Pills Row -->
        <div class="flex items-center justify-center gap-2 flex-wrap mt-2.5">
          <span class="px-2.5 py-0.5 rounded bg-white/20 text-white font-black text-[11px] uppercase tracking-wider">${famStatus}</span>
          <span class="px-2.5 py-0.5 rounded bg-slate-900/40 text-amber-300 font-mono font-bold text-[11px]">${family.id}</span>
          <span class="px-2.5 py-0.5 rounded bg-amber-400 text-slate-950 font-black text-[10px] uppercase">MONTHLY INVOICE ✔</span>
          <span class="px-2.5 py-0.5 rounded bg-sky-500 text-white font-black text-[10px] uppercase">MONTHLY FEE: ${fin.currency} ${fin.agreedMonthlyFee}</span>
          <span class="px-2.5 py-0.5 rounded bg-blue-600 text-white font-black text-[10px] uppercase">${family.country || 'GLOBAL'}</span>
        </div>

        <!-- Primary Action Buttons Row -->
        <div class="flex items-center justify-center gap-2 flex-wrap mt-4">
          <button onclick="prepareAddStudentModal('${family.id}')" class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-user-plus"></i> Add Student
          </button>
          <button onclick="switchTab('tab-invoices'); if (typeof selectFeeFamily === 'function') selectFeeFamily('${family.id}');" class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-file-invoice-dollar"></i> Record Payment / Invoice
          </button>
          <button onclick="openFamilyEmailModal('${family.id}')" class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-paper-plane"></i> Send Email
          </button>
          ${cleanPhone && window.CURRENT_ROLE !== 'manager' ? `
            <a href="https://wa.me/${cleanPhone}" target="_blank" class="px-3.5 py-1.5 rounded-lg bg-slate-900/70 hover:bg-slate-900 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
              <i class="fa-brands fa-whatsapp text-emerald-300"></i> WhatsApp Parent
            </a>
          ` : ''}
          <button onclick="if (typeof openFamilyAnnualLedgerModal === 'function') openFamilyAnnualLedgerModal('${family.id}');" class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-table-list"></i> Annual Fee Ledger
          </button>
        </div>

        <!-- DOCKED DARK TABS BAR AT BOTTOM OF BANNER -->
        <div class="flex items-center justify-center gap-1.5 flex-wrap mt-6 pb-3">
          ${tabsConfig.map(t => {
            const isAct = activeTab === t.id;
            return `
              <button onclick="openFamily360Profile('${family.id}', '${t.id}', true)"
                      class="px-4 py-2 rounded-md text-xs font-extrabold transition ${isAct ? 'bg-slate-950 text-white shadow-md ring-2 ring-white/40' : 'bg-slate-800/80 hover:bg-slate-900 text-white/90'}">
                ${t.label}
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <!-- FULL-WIDTH SINGLE-CATEGORY WORKSPACE BELOW BANNER -->
      <div class="bg-white">
        ${tabContentHtml}
      </div>

      <!-- CLEAN BOTTOM MANAGEMENT ACTION BAR -->
      <div class="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-center gap-2.5 flex-wrap">
        <button onclick="prepareAddStudentModal('${family.id}')" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition shadow-2xs">
          + Enroll Child
        </button>
        <button onclick="switchTab('tab-leaves')" class="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs transition shadow-2xs">
          Manage Leave Status
        </button>
        <button onclick="copyParentCredentials('${creds.username}', '${creds.password}')" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition shadow-2xs">
          Copy Portal Credentials
        </button>
      </div>
    </div>
  `;
}

// ============================================================================
// 2. STUDENT FULL-SCREEN DEDICATED PROFILE PAGE
// ============================================================================
async function openStudent360Profile(studentId, initialTab = 'overview', skipHistoryPush = false) {
  if (!studentId) return;
  window.CURRENT_MODAL_STUDENT_ID = studentId;

  _activateFullScreenProfilePage('student');
  const workspace = document.getElementById('unified360PageWorkspace');
  if (!workspace) return;

  workspace.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-16 text-center text-slate-500 shadow-xs">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-emerald-600 mb-3 block"></i>
      <span class="text-sm font-extrabold">Loading Full-Screen Student Profile Workspace...</span>
    </div>
  `;

  await _ensure360CoreDataReady();

  let student = (window.ALL_STUDENTS || []).find(s => String(s.id) === String(studentId));
  if (!student) {
    const { data } = await db.from('students').select('*').eq('id', studentId).maybeSingle();
    student = data;
    if (student && Array.isArray(window.ALL_STUDENTS)) window.ALL_STUDENTS.push(student);
  }
  if (!student) {
    workspace.innerHTML = `
      ${_buildTopWorkspaceNavHtml()}
      <div class="bg-white rounded-2xl border border-slate-200 p-12 text-center text-rose-600 font-bold">
        Student record (${studentId}) could not be found.
      </div>
    `;
    return;
  }

  const validTabs = ['overview', 'family', 'classes', 'attendance', 'lessons', 'progress', 'fees'];
  const activeTab = validTabs.includes(initialTab) ? initialTab : 'overview';

  _CURRENT_360_STATE.type = 'student';
  _CURRENT_360_STATE.id = student.id;
  _CURRENT_360_STATE.activeTab = activeTab;

  if (!skipHistoryPush) {
    _push360History('student', student.id, `${student.name} (${student.id})`, activeTab);
  }

  // Retrieve Family & Sibling Students
  let family = (window.ALL_FAMILIES || []).find(f => String(f.id) === String(student.family_id));
  if (!family && student.family_id) {
    const { data } = await db.from('families').select('*, students(*)').eq('id', student.family_id).maybeSingle();
    family = data;
  }
  const familyStudents = (window.ALL_STUDENTS || []).filter(s =>
    student.family_id && String(s.family_id) === String(student.family_id) && String(s.status || '').toLowerCase() !== 'trial'
  );

  // Retrieve Scheduled Classes & Attendance / Lesson History
  const [schedRes, logsRes] = await Promise.all([
    db.from('class_schedules').select('*, teachers(*)').eq('student_id', student.id),
    db.from('attendance_logs').select('*').eq('student_id', student.id).order('date', { ascending: false })
  ]);

  const schedules = schedRes.data || [];
  const attendanceLogs = logsRes.data || [];

  // Include any local advance classes
  try {
    const localAdv = JSON.parse(localStorage.getItem('alhuda_advance_classes_v1') || '[]');
    localAdv.filter(a => String(a.student_id) === String(student.id)).forEach(adv => {
      if (!attendanceLogs.some(l => l.date === adv.date && l.schedule_id === adv.schedule_id)) {
        attendanceLogs.push({
          id: adv.id,
          student_id: adv.student_id,
          teacher_id: adv.teacher_id,
          date: adv.date,
          status: 'Present',
          lesson_notes: JSON.stringify(adv.payload || {})
        });
      }
    });
    attendanceLogs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  } catch (e) {}

  // Assigned Teacher
  let assignedTeacherId = student.assigned_teacher_id || (schedules[0] ? schedules[0].teacher_id : null);
  let assignedTeacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(assignedTeacherId)) || schedules[0]?.teachers;
  const teacherCreds = (assignedTeacher && typeof getTeacherCreds === 'function') ? getTeacherCreds(assignedTeacher) : { teacher_id: assignedTeacher?.id || 'Unassigned' };

  let stuMeta = {};
  if (student.notes) {
    try { stuMeta = JSON.parse(student.notes); } catch (e) {}
  }
  const stuLanguage = stuMeta.language || student.language || 'English / Urdu';
  const stuDaysPerWeek = stuMeta.days_per_week || (schedules.length > 0 ? `${schedules.length} Days / Week` : '5 Days / Week');
  const stuCourse = student.course_id || stuMeta.course || 'Noorani Qaida & Nazra Quran';
  const stuStatus = student.status || 'Active';
  const joinDate = student.joining_date || (student.created_at ? student.created_at.slice(0, 10) : '2026-01-01');

  const rawPhone = student.whatsapp || family?.whatsapp || '';
  const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  const displayPhone = (window.CURRENT_ROLE === 'manager' && typeof maskStudentPhone === 'function')
    ? maskStudentPhone(rawPhone)
    : (rawPhone || 'Not Provided');

  // Attendance Stats
  const availableMonths = Array.from(new Set([
    '2026-09',
    ...attendanceLogs.map(l => String(l.date || '').slice(0, 7)).filter(Boolean)
  ])).sort().reverse();

  const activeMonthFilter = _CURRENT_360_STATE.attMonthFilter || 'all';
  const filteredAttLogs = activeMonthFilter === 'all'
    ? attendanceLogs
    : attendanceLogs.filter(l => String(l.date || '').startsWith(activeMonthFilter));

  const totalMarkedClasses = filteredAttLogs.length;
  const daysPresent = filteredAttLogs.filter(l => ['present', 'late', 'completed'].includes(String(l.status || '').toLowerCase())).length;
  const daysAbsent = filteredAttLogs.filter(l => String(l.status || '').toLowerCase() === 'absent').length;
  const daysLeave = filteredAttLogs.filter(l => String(l.status || '').toLowerCase() === 'leave').length;
  const attendancePct = totalMarkedClasses > 0 ? Math.round((daysPresent / totalMarkedClasses) * 100) : 100;

  // Lesson & Progress Stats
  const parsedLessons = attendanceLogs
    .map(l => ({ rawLog: l, parsed: _parseLessonLogEntry(l) }))
    .filter(item => item.parsed.bookTitle || item.parsed.page || item.parsed.remarks);

  const passedLessonsCount = parsedLessons.filter(x => String(x.parsed.assessment || '').toLowerCase() === 'pass').length;
  const repeatLessonsCount = parsedLessons.filter(x => String(x.parsed.assessment || '').toLowerCase() === 'repeat').length;
  const highestPage = parsedLessons.reduce((max, x) => Math.max(max, Number(x.parsed.page || 0)), 0);
  const fin = _getFamilyFinancialSnapshot(family);

  const tabsConfig = [
    { id: 'overview',   label: 'Overview & Bio Data' },
    { id: 'family',     label: `Family & Siblings (${familyStudents.length})` },
    { id: 'classes',    label: `Teacher & Classes (${schedules.length})` },
    { id: 'attendance', label: `Attendance (${attendancePct}%)` },
    { id: 'lessons',    label: `Daily Lessons (${parsedLessons.length})` },
    { id: 'progress',   label: 'Progress Report' },
    { id: 'fees',       label: 'Fees & Payments' }
  ];

  let tabContentHtml = '';

  // -------------------------------------------------------------------------
  // STUDENT TAB 1: OVERVIEW & BIO DATA (Modeled on Reference Screenshot 1)
  // -------------------------------------------------------------------------
  if (activeTab === 'overview') {
    const overviewSpecRows = [
      { label: 'Student Name',     value: student.name },
      { label: 'Student ID',       value: student.id },
      { label: 'Current Status',   value: stuStatus },
      { label: 'Joining Date',     value: joinDate },
      { label: 'Enrolled Course',  value: stuCourse },
      { label: 'Age & Gender',     value: `${student.age || '--'} Yrs • ${student.gender || 'N/A'}` },
      { label: 'Parent / Family',  value: family ? `<button onclick="openFamily360Profile('${family.id}', 'students')" class="text-blue-700 hover:underline font-extrabold">${family.parent_name} (${family.id})</button>` : 'Not Linked' },
      { label: 'Assigned Teacher', value: assignedTeacher ? `<button onclick="openTeacher360Profile('${assignedTeacher.id}', 'overview')" class="text-blue-700 hover:underline font-extrabold">${assignedTeacher.full_name} (${teacherCreds.teacher_id})</button>` : 'Not Assigned' },
      { label: 'Parent WhatsApp',  value: displayPhone },
      { label: 'Language Medium',  value: stuLanguage },
      { label: 'Weekly Schedule',  value: stuDaysPerWeek },
      { label: 'Country',          value: family?.country || 'International' }
    ];
    tabContentHtml = _buildThreeColSpecTableHtml(overviewSpecRows);
  }

  // -------------------------------------------------------------------------
  // STUDENT TAB 2: FAMILY & SIBLINGS (Modeled on Reference Screenshot 3)
  // -------------------------------------------------------------------------
  else if (activeTab === 'family') {
    tabContentHtml = `
      <div class="p-4 sm:p-5 space-y-4">
        <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between flex-wrap gap-3">
          <div>
            <span class="text-[10px] font-bold uppercase text-slate-400 block">Connected Family Account</span>
            <button onclick="openFamily360Profile('${family?.id || ''}', 'students')" class="text-base font-black text-blue-700 hover:underline">
              ${family?.parent_name || 'Parent'} (${family?.id || 'N/A'})
            </button>
            <span class="text-xs text-slate-500 block mt-0.5">Country: ${family?.country || 'Global'} &bull; Contact: ${displayPhone} &bull; Family Fee: ${fin.currency} ${fin.agreedMonthlyFee}/mo</span>
          </div>
          ${family ? `
            <button onclick="openFamily360Profile('${family.id}', 'students')" class="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-extrabold transition">
              Open Full-Screen Family Profile &rarr;
            </button>
          ` : ''}
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5 w-14">#</th>
                <th class="p-3.5">Sibling Student Name</th>
                <th class="p-3.5">Student ID</th>
                <th class="p-3.5">Course</th>
                <th class="p-3.5">Assigned Teacher</th>
                <th class="p-3.5">Joining Date</th>
                <th class="p-3.5">Status</th>
                <th class="p-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${familyStudents.map((sib, idx) => {
                const isCurr = String(sib.id) === String(student.id);
                const sibTeacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(sib.assigned_teacher_id));
                return `
                  <tr class="${isCurr ? 'bg-emerald-50/60' : 'hover:bg-slate-50'} transition">
                    <td class="p-3.5"><span class="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-400 text-slate-950 font-black">${idx + 1}</span></td>
                    <td class="p-3.5">
                      <button onclick="openStudent360Profile('${sib.id}', 'overview')" class="font-extrabold text-blue-700 hover:underline">
                        ✔ ${sib.name} ${isCurr ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-emerald-700 text-white text-[9px] uppercase">Current</span>' : ''}
                      </button>
                    </td>
                    <td class="p-3.5 font-mono font-bold text-slate-700">${sib.id}</td>
                    <td class="p-3.5 font-semibold text-slate-800">${sib.course_id || 'Quran Studies'}</td>
                    <td class="p-3.5">
                      ${sibTeacher ? `<button onclick="openTeacher360Profile('${sibTeacher.id}', 'overview')" class="font-bold text-blue-600 hover:underline">${sibTeacher.full_name}</button>` : 'Unassigned'}
                    </td>
                    <td class="p-3.5 font-mono text-slate-600">${sib.joining_date || '--'}</td>
                    <td class="p-3.5"><span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">${sib.status || 'Active'}</span></td>
                    <td class="p-3.5 text-right">
                      <button onclick="openStudent360Profile('${sib.id}', 'overview')" class="px-3 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px]">
                        Open Profile
                      </button>
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

  // -------------------------------------------------------------------------
  // STUDENT TAB 3: ASSIGNED TEACHER & WEEKLY CLASSES
  // -------------------------------------------------------------------------
  else if (activeTab === 'classes') {
    const sortedScheds = [...schedules].sort((a, b) => Number(a.day_of_week || 0) - Number(b.day_of_week || 0));
    tabContentHtml = `
      <div class="p-4 sm:p-5 space-y-4">
        ${assignedTeacher ? `
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between flex-wrap gap-3">
            <div>
              <span class="text-[10px] font-bold uppercase text-slate-400 block">Currently Assigned Teacher</span>
              <button onclick="openTeacher360Profile('${assignedTeacher.id}', 'overview')" class="text-base font-black text-blue-700 hover:underline">
                ${assignedTeacher.full_name} (${teacherCreds.teacher_id})
              </button>
              <span class="text-xs text-slate-500 block mt-0.5">Shift: ${assignedTeacher.working_shift || '10 Hours Shift'} &bull; Contact: ${assignedTeacher.phone || '--'}</span>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="openTeacher360Profile('${assignedTeacher.id}', 'overview')" class="px-4 py-2 bg-indigo-700 hover:bg-indigo-800 text-white rounded-xl text-xs font-extrabold transition">
                Open Full-Screen Teacher Profile &rarr;
              </button>
              <button onclick="open2DMatrixForTeacher('${assignedTeacher.id}')" class="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-extrabold transition">
                2D Weekly Matrix
              </button>
            </div>
          </div>
        ` : ''}

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">Day of Week</th>
                <th class="p-3.5">Class Timing (PKT)</th>
                <th class="p-3.5">Course</th>
                <th class="p-3.5">Teacher</th>
                <th class="p-3.5">Classroom Link</th>
                <th class="p-3.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${sortedScheds.length === 0 ? `
                <tr><td colspan="6" class="p-8 text-center text-slate-400">No weekly class slots scheduled yet.</td></tr>
              ` : sortedScheds.map(sc => {
                const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(sc.teacher_id)) || sc.teachers || assignedTeacher;
                return `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="p-3.5 font-extrabold text-slate-900">${_DAY_LABELS_360[Number(sc.day_of_week)] || `Day ${sc.day_of_week}`}</td>
                    <td class="p-3.5 font-mono font-bold text-emerald-800">${(sc.start_time || '').slice(0,5)} - ${(sc.end_time || '').slice(0,5)} PKT</td>
                    <td class="p-3.5 font-semibold text-slate-800">${stuCourse}</td>
                    <td class="p-3.5">${tObj ? `<button onclick="openTeacher360Profile('${tObj.id}', 'overview')" class="font-bold text-blue-600 hover:underline">${tObj.full_name}</button>` : '--'}</td>
                    <td class="p-3.5">${sc.meeting_link ? `<a href="${sc.meeting_link}" target="_blank" class="text-blue-600 hover:underline font-bold">Join Zoom</a>` : 'Standard Room'}</td>
                    <td class="p-3.5 text-right"><span class="px-2.5 py-0.5 rounded bg-emerald-600 text-white font-black text-[10px] uppercase">ACTIVE</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // STUDENT TAB 4: ATTENDANCE HISTORY
  // -------------------------------------------------------------------------
  else if (activeTab === 'attendance') {
    tabContentHtml = `
      <div class="p-4 sm:p-5 space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 flex-1">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span class="text-[10px] font-bold uppercase text-slate-400 block">Total Classes</span>
              <strong class="text-base font-black text-slate-900">${totalMarkedClasses}</strong>
            </div>
            <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <span class="text-[10px] font-bold uppercase text-emerald-700 block">Days Attended</span>
              <strong class="text-base font-black text-emerald-800">${daysPresent}</strong>
            </div>
            <div class="p-3 rounded-xl bg-rose-50 border border-rose-200">
              <span class="text-[10px] font-bold uppercase text-rose-700 block">Days Missed</span>
              <strong class="text-base font-black text-rose-800">${daysAbsent}</strong>
            </div>
            <div class="p-3 rounded-xl bg-blue-50 border border-blue-200">
              <span class="text-[10px] font-bold uppercase text-blue-700 block">On Leave</span>
              <strong class="text-base font-black text-blue-800">${daysLeave}</strong>
            </div>
            <div class="p-3 rounded-xl bg-teal-50 border border-teal-200">
              <span class="text-[10px] font-bold uppercase text-teal-700 block">Attendance %</span>
              <strong class="text-base font-black text-teal-900">${attendancePct}%</strong>
            </div>
          </div>

          <div>
            <select onchange="_CURRENT_360_STATE.attMonthFilter = this.value; openStudent360Profile('${student.id}', 'attendance', true)"
                    class="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-extrabold text-slate-800">
              <option value="all" ${activeMonthFilter === 'all' ? 'selected' : ''}>All Months</option>
              ${availableMonths.map(m => `<option value="${m}" ${activeMonthFilter === m ? 'selected' : ''}>Month: ${m}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">Date</th>
                <th class="p-3.5">Status</th>
                <th class="p-3.5">Teacher</th>
                <th class="p-3.5">Attendance / Lesson Notes</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${filteredAttLogs.length === 0 ? `
                <tr><td colspan="4" class="p-8 text-center text-slate-400">No attendance records found for this period.</td></tr>
              ` : filteredAttLogs.map(log => {
                const st = String(log.status || 'Present');
                const pill = st === 'Present' ? 'bg-emerald-600 text-white' : st === 'Absent' ? 'bg-rose-600 text-white' : 'bg-blue-600 text-white';
                const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(log.teacher_id)) || assignedTeacher;
                const parsed = _parseLessonLogEntry(log);
                return `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="p-3.5 font-mono font-bold text-slate-800">${log.date || '--'}</td>
                    <td class="p-3.5"><span class="px-2.5 py-0.5 rounded font-black text-[10px] uppercase ${pill}">${st}</span></td>
                    <td class="p-3.5">${tObj ? `<button onclick="openTeacher360Profile('${tObj.id}', 'overview')" class="font-bold text-blue-600 hover:underline">${tObj.full_name}</button>` : '--'}</td>
                    <td class="p-3.5 text-slate-700">${parsed.bookTitle ? `<strong>${parsed.bookTitle}</strong> ${parsed.page ? `(Page ${parsed.page})` : ''} — ${parsed.remarks || parsed.assessment || ''}` : (parsed.remarks || '--')}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // STUDENT TAB 5: DAILY LESSONS (Sabaq History Auto-Synced from Teacher Portal)
  // -------------------------------------------------------------------------
  else if (activeTab === 'lessons') {
    tabContentHtml = `
      <div class="p-4 sm:p-5">
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">Date</th>
                <th class="p-3.5">Lesson / Book Studied</th>
                <th class="p-3.5">Page &amp; Line Range</th>
                <th class="p-3.5">Assessment</th>
                <th class="p-3.5">Teacher Remarks</th>
                <th class="p-3.5">Teacher</th>
                <th class="p-3.5 text-right">Digital Reader</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${parsedLessons.length === 0 ? `
                <tr><td colspan="7" class="p-8 text-center text-slate-400">No daily lessons logged yet. Lessons entered by the teacher in the Teacher Portal automatically appear here.</td></tr>
              ` : parsedLessons.map(({ rawLog, parsed }) => {
                const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(rawLog.teacher_id)) || assignedTeacher;
                const isPass = String(parsed.assessment || '').toLowerCase() === 'pass';
                return `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="p-3.5 font-mono font-bold text-slate-800">${rawLog.date || '--'}</td>
                    <td class="p-3.5 font-extrabold text-slate-900">${parsed.bookTitle || stuCourse}</td>
                    <td class="p-3.5 font-mono">${parsed.page ? `Page ${parsed.page}${parsed.lineRange ? ` (${parsed.lineRange})` : ''}` : '--'}</td>
                    <td class="p-3.5">
                      <span class="px-2.5 py-0.5 rounded font-black text-[10px] uppercase ${isPass ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}">
                        ${parsed.assessment || 'COMPLETED'}
                      </span>
                    </td>
                    <td class="p-3.5 text-slate-700">${parsed.remarks || '--'}</td>
                    <td class="p-3.5">${tObj ? `<button onclick="openTeacher360Profile('${tObj.id}', 'overview')" class="font-bold text-blue-600 hover:underline">${tObj.full_name}</button>` : '--'}</td>
                    <td class="p-3.5 text-right">
                      ${parsed.page && typeof openDigitalBookReader === 'function' ? `
                        <button onclick="openDigitalBookReader('${parsed.bookId}', ${parsed.page})" class="px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-[11px]">
                          Read Pg ${parsed.page}
                        </button>
                      ` : '--'}
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

  // -------------------------------------------------------------------------
  // STUDENT TAB 6: PROGRESS REPORT
  // -------------------------------------------------------------------------
  else if (activeTab === 'progress') {
    const targetPages = stuCourse.toLowerCase().includes('quran') ? 548 : 32;
    const pct = highestPage > 0 ? Math.min(100, Math.round((highestPage / targetPages) * 100)) : (passedLessonsCount > 0 ? Math.min(100, passedLessonsCount * 5) : 10);
    tabContentHtml = `
      <div class="p-4 sm:p-5 space-y-4">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-[11px] font-bold text-slate-500 block">Active Syllabus</span>
            <strong class="text-sm font-black text-slate-900">${stuCourse}</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
            <span class="text-[11px] font-bold text-emerald-700 block">Current Milestone</span>
            <strong class="text-sm font-black text-emerald-900">${highestPage > 0 ? `Page ${highestPage} (${pct}%)` : 'Initial Stage'}</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-teal-50 border border-teal-200">
            <span class="text-[11px] font-bold text-teal-700 block">Lessons Passed</span>
            <strong class="text-sm font-black text-teal-900">${passedLessonsCount} Passed</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200">
            <span class="text-[11px] font-bold text-amber-800 block">Revisions / Repeat</span>
            <strong class="text-sm font-black text-amber-900">${repeatLessonsCount} Revisions</strong>
          </div>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">Date</th>
                <th class="p-3.5">Syllabus / Book</th>
                <th class="p-3.5">Milestone Reached</th>
                <th class="p-3.5">Evaluation Result</th>
                <th class="p-3.5">Teacher Feedback</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${parsedLessons.length === 0 ? `
                <tr><td colspan="5" class="p-8 text-center text-slate-400">No progress evaluations recorded yet.</td></tr>
              ` : parsedLessons.slice(0, 25).map(({ rawLog, parsed }) => `
                <tr class="hover:bg-slate-50 transition">
                  <td class="p-3.5 font-mono font-bold text-slate-800">${rawLog.date || '--'}</td>
                  <td class="p-3.5 font-extrabold text-slate-900">${parsed.bookTitle || stuCourse}</td>
                  <td class="p-3.5 font-mono font-bold text-emerald-800">${parsed.page ? `Page ${parsed.page}` : 'Lesson Checkpoint'}</td>
                  <td class="p-3.5"><span class="px-2 py-0.5 rounded bg-emerald-600 text-white font-black text-[10px] uppercase">${parsed.assessment || 'PASS'}</span></td>
                  <td class="p-3.5 text-slate-600">${parsed.remarks || 'Satisfactory recitation and Tajweed.'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // STUDENT TAB 7: FEES & PAYMENTS (Synchronized with Family Ledger)
  // -------------------------------------------------------------------------
  else if (activeTab === 'fees') {
    const activeMonthsList = [...fin.monthsStatus].reverse().filter(m => !m.isNotEnrolled);
    tabContentHtml = `
      <div class="p-4 sm:p-5 space-y-4">
        <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between flex-wrap gap-3">
          <div class="text-xs text-slate-700">
            <strong>Family Billing Relationship:</strong> Tuition fees are maintained at the Family level under
            <button onclick="openFamily360Profile('${family?.id || ''}', 'payments')" class="text-blue-700 hover:underline font-extrabold">${family?.parent_name || 'Parent'} (${family?.id || 'N/A'})</button>.
          </div>
          ${family ? `
            <button onclick="openFamily360Profile('${family.id}', 'payments')" class="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-extrabold">
              Open Family Payments Page &rarr;
            </button>
          ` : ''}
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-[11px] font-bold text-slate-500 block">Agreed Family Fee</span>
            <strong class="text-base font-black text-slate-900">${fin.currency} ${fin.agreedMonthlyFee}/-</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
            <span class="text-[11px] font-bold text-emerald-700 block">Total Paid</span>
            <strong class="text-base font-black text-emerald-900">${fin.currency} ${fin.totalPaid.toFixed(0)}/-</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-rose-50 border border-rose-200">
            <span class="text-[11px] font-bold text-rose-700 block">Pending Balance</span>
            <strong class="text-base font-black text-rose-900">${fin.currency} ${fin.totalPending.toFixed(0)}/-</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-sky-50 border border-sky-200">
            <span class="text-[11px] font-bold text-sky-700 block">Advance Credit</span>
            <strong class="text-base font-black text-sky-900">${fin.currency} ${fin.advanceCredit.toFixed(0)}/-</strong>
          </div>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-800 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">${fin.currency} / Method</th>
                <th class="p-3.5">Month</th>
                <th class="p-3.5">Due Date</th>
                <th class="p-3.5">Paid Date</th>
                <th class="p-3.5">Fee</th>
                <th class="p-3.5">AMT</th>
                <th class="p-3.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${activeMonthsList.map(m => `
                <tr class="hover:bg-slate-50 transition">
                  <td class="p-3.5 font-semibold text-emerald-700">${m.paymentMethod}</td>
                  <td class="p-3.5 font-bold text-emerald-800">${m.month.slice(0, 3)}</td>
                  <td class="p-3.5 font-mono text-emerald-700">${m.dueDate}</td>
                  <td class="p-3.5 font-mono text-emerald-700">${m.paidDate}</td>
                  <td class="p-3.5 font-mono font-bold text-emerald-800">${fin.currency}${fin.agreedMonthlyFee}</td>
                  <td class="p-3.5 font-mono font-extrabold text-emerald-800">${fin.currency}${m.isPaid ? fin.agreedMonthlyFee : (m.amountPaid || fin.agreedMonthlyFee)}/-</td>
                  <td class="p-3.5 text-right">
                    <span class="px-2.5 py-1 rounded font-black text-[10px] uppercase ${m.isPaid ? 'bg-emerald-600 text-white' : (m.isFuture ? 'bg-slate-200 text-slate-600' : 'bg-rose-600 text-white')}">
                      ${m.isPaid ? 'PAID' : (m.isFuture ? 'UPCOMING' : 'DUE')}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Assemble Full-Screen Student Profile Page
  workspace.innerHTML = `
    ${_buildTopWorkspaceNavHtml()}

    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <!-- FULL-WIDTH EMERALD PROFILE BANNER -->
      <div class="bg-gradient-to-b from-[#10b981] via-[#059669] to-[#047857] text-white pt-6 px-4 sm:px-8 flex flex-col items-center text-center">
        <div class="w-16 h-16 rounded-xl bg-white/20 border-2 border-white shadow-md flex items-center justify-center text-2xl font-black text-white mb-2">
          <i class="fa-solid fa-user-graduate"></i>
        </div>

        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-white">${student.name}</h1>
        <div class="text-sm font-mono font-semibold text-white/95 mt-0.5">${joinDate}</div>

        <!-- Status & Relationship Pills -->
        <div class="flex items-center justify-center gap-2 flex-wrap mt-2.5">
          <span class="px-2.5 py-0.5 rounded bg-white/20 text-white font-black text-[11px] uppercase">${stuStatus}</span>
          <span class="px-2.5 py-0.5 rounded bg-slate-900/40 text-amber-300 font-mono font-bold text-[11px]">${student.id}</span>
          ${family ? `
            <button onclick="openFamily360Profile('${family.id}', 'students')" class="px-2.5 py-0.5 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-[10px] uppercase transition">
              FAMILY: ${family.parent_name} (${family.id}) ✔
            </button>
          ` : ''}
          ${assignedTeacher ? `
            <button onclick="openTeacher360Profile('${assignedTeacher.id}', 'overview')" class="px-2.5 py-0.5 rounded bg-sky-500 hover:bg-sky-400 text-white font-black text-[10px] uppercase transition">
              TEACHER: ${assignedTeacher.full_name}
            </button>
          ` : ''}
          <span class="px-2.5 py-0.5 rounded bg-blue-600 text-white font-black text-[10px] uppercase">${stuCourse}</span>
        </div>

        <!-- Primary Action Buttons Row -->
        <div class="flex items-center justify-center gap-2 flex-wrap mt-4">
          ${family ? `
            <button onclick="openFamily360Profile('${family.id}', 'students')" class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
              <i class="fa-solid fa-house-user"></i> Open Family Profile
            </button>
          ` : ''}
          ${assignedTeacher ? `
            <button onclick="openTeacher360Profile('${assignedTeacher.id}', 'overview')" class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
              <i class="fa-solid fa-chalkboard-user"></i> Open Teacher Profile
            </button>
          ` : ''}
          ${cleanPhone && window.CURRENT_ROLE !== 'manager' ? `
            <a href="https://wa.me/${cleanPhone}" target="_blank" class="px-3.5 py-1.5 rounded-lg bg-slate-900/70 hover:bg-slate-900 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
              <i class="fa-brands fa-whatsapp text-emerald-300"></i> WhatsApp Parent
            </a>
          ` : ''}
        </div>

        <!-- DOCKED DARK TABS BAR AT BOTTOM OF BANNER -->
        <div class="flex items-center justify-center gap-1.5 flex-wrap mt-6 pb-3">
          ${tabsConfig.map(t => {
            const isAct = activeTab === t.id;
            return `
              <button onclick="openStudent360Profile('${student.id}', '${t.id}', true)"
                      class="px-4 py-2 rounded-md text-xs font-extrabold transition ${isAct ? 'bg-slate-950 text-white shadow-md ring-2 ring-white/40' : 'bg-slate-800/80 hover:bg-slate-900 text-white/90'}">
                ${t.label}
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <!-- FULL-WIDTH SINGLE-CATEGORY WORKSPACE BELOW BANNER -->
      <div class="bg-white">
        ${tabContentHtml}
      </div>
    </div>
  `;
}

// ============================================================================
// 3. TEACHER FULL-SCREEN DEDICATED PROFILE PAGE
// ============================================================================
async function openTeacher360Profile(teacherId, initialTab = 'students', skipHistoryPush = false) {
  if (!teacherId) return;
  window.CURRENT_MODAL_TEACHER_ID = teacherId;

  _activateFullScreenProfilePage('teacher');
  const workspace = document.getElementById('unified360PageWorkspace');
  if (!workspace) return;

  workspace.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-16 text-center text-slate-500 shadow-xs">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-emerald-600 mb-3 block"></i>
      <span class="text-sm font-extrabold">Loading Full-Screen Teacher Profile Workspace...</span>
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
    workspace.innerHTML = `
      ${_buildTopWorkspaceNavHtml()}
      <div class="bg-white rounded-2xl border border-slate-200 p-12 text-center text-rose-600 font-bold">
        Teacher record (${teacherId}) could not be found.
      </div>
    `;
    return;
  }

  const validTabs = ['students', 'salary', 'classes', 'lessons', 'overview'];
  const activeTab = validTabs.includes(initialTab) ? initialTab : 'students';

  _CURRENT_360_STATE.type = 'teacher';
  _CURRENT_360_STATE.id = teacher.id;
  _CURRENT_360_STATE.activeTab = activeTab;

  const accounts = (typeof getTeacherAccounts === 'function') ? getTeacherAccounts() : {};
  const acc = accounts[teacher.id] || {};
  const creds = (typeof getTeacherCreds === 'function') ? getTeacherCreds(teacher) : { teacher_id: teacher.id, username: 'teacher', password: '12345678' };

  if (!skipHistoryPush) {
    _push360History('teacher', teacher.id, `${teacher.full_name} (${creds.teacher_id})`, activeTab);
  }

  const [schedRes, logsRes] = await Promise.all([
    db.from('class_schedules').select('*, students(*)').eq('teacher_id', teacher.id),
    db.from('attendance_logs').select('*').eq('teacher_id', teacher.id).order('date', { ascending: false }).limit(80)
  ]);

  const teacherSchedules = schedRes.data || [];
  const teacherLogs = logsRes.data || [];

  // Deduplicated Assigned Students
  const studentMap = {};
  (window.ALL_STUDENTS || []).forEach(s => {
    if (String(s.assigned_teacher_id) === String(teacher.id) && String(s.status || '').toLowerCase() !== 'trial') {
      studentMap[s.id] = s;
    }
  });
  teacherSchedules.forEach(sc => {
    if (sc.student_id && sc.students && String(sc.students.status || '').toLowerCase() !== 'trial') {
      studentMap[sc.student_id] = sc.students;
    }
  });
  const assignedStudents = Object.values(studentMap);

  const teacherIncrement = (typeof getTeacherSeniorityIncrement === 'function')
    ? getTeacherSeniorityIncrement(teacher, acc)
    : 0;

  let savedSalaries = {};
  try { savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}'); } catch (e) {}

  const currentMonthLabel = document.getElementById('salaryMonthSelect')?.value || 'September 2026';
  const currentSlipKey = `${teacher.id}_${currentMonthLabel.replace(/\s+/g, '_')}`;
  const currentSavedSlip = savedSalaries[currentSlipKey] || null;

  let currentBaseSubtotal = 0;
  const studentSalaryItems = assignedStudents.map((stu, idx) => {
    const stuScheds = teacherSchedules.filter(sc => String(sc.student_id) === String(stu.id));
    const rateInfo = (typeof getStudentCourseSalaryRate === 'function')
      ? getStudentCourseSalaryRate(stu, stuScheds, teacherIncrement)
      : { baseRate: teacher.rate_per_slot || 2200, increment: teacherIncrement, finalRate: (teacher.rate_per_slot || 2200) + teacherIncrement, courseLabel: stu.course_id || 'Quran Studies', scheduleText: `${stuScheds.length} Slots/wk` };

    let finalRate = rateInfo.finalRate;
    if (currentSavedSlip?.students && currentSavedSlip.students[stu.id] !== undefined) {
      finalRate = parseFloat(currentSavedSlip.students[stu.id]) || rateInfo.finalRate;
    }
    currentBaseSubtotal += finalRate;
    const famObj = (window.ALL_FAMILIES || []).find(f => String(f.id) === String(stu.family_id));

    return {
      index: idx + 1,
      student: stu,
      family: famObj,
      schedules: stuScheds,
      courseLabel: rateInfo.courseLabel,
      scheduleText: rateInfo.scheduleText,
      baseRate: rateInfo.baseRate,
      increment: teacherIncrement,
      finalRate
    };
  });

  const currBonus = currentSavedSlip ? (parseFloat(currentSavedSlip.bonus) || 0) : 0;
  const currDeduction = currentSavedSlip ? (parseFloat(currentSavedSlip.deduction) || 0) : 0;
  const currNetPayable = Math.max(0, currentBaseSubtotal + currBonus - currDeduction);
  const currStatus = currentSavedSlip ? (currentSavedSlip.status || 'Pending') : 'Pending';

  const payrollMonths = ['September 2026', 'August 2026', 'July 2026', 'June 2026', 'May 2026', 'April 2026'];
  Object.keys(savedSalaries).forEach(k => {
    if (k.startsWith(teacher.id + '_')) {
      const mLabel = k.slice((teacher.id + '_').length).replace(/_/g, ' ');
      if (!payrollMonths.includes(mLabel)) payrollMonths.push(mLabel);
    }
  });

  let totalSalaryPaid = 0;
  let totalSalaryPending = 0;

  const salaryLedgerRows = payrollMonths.map(mLabel => {
    const sKey = `${teacher.id}_${mLabel.replace(/\s+/g, '_')}`;
    const slip = savedSalaries[sKey] || null;
    const bonus = slip ? (parseFloat(slip.bonus) || 0) : 0;
    const deduction = slip ? (parseFloat(slip.deduction) || 0) : 0;
    const sub = slip?.base_subtotal !== undefined ? parseFloat(slip.base_subtotal) : currentBaseSubtotal;
    const net = Math.max(0, sub + bonus - deduction);
    const status = slip ? (slip.status || 'Pending') : (mLabel === currentMonthLabel ? currStatus : 'Pending');
    const paymentDate = slip?.paid_at || slip?.payment_date || (status === 'Paid' ? mLabel : '--');

    if (status === 'Paid') totalSalaryPaid += net;
    else if (mLabel === currentMonthLabel || slip) totalSalaryPending += net;

    return {
      month: mLabel,
      studentsCount: assignedStudents.length,
      baseSubtotal: sub,
      bonus,
      deduction,
      netPayable: net,
      status,
      paymentDate
    };
  });

  const joiningDate = acc.joining_date || (teacher.created_at ? teacher.created_at.slice(0, 10) : '2025-01-01');
  const cleanPhone = (teacher.phone || '').replace(/[^0-9]/g, '');

  const tabsConfig = [
    { id: 'students', label: `Assigned Students (${assignedStudents.length})` },
    { id: 'salary',   label: 'Salary & Payroll Ledger' },
    { id: 'classes',  label: `Weekly Schedule (${teacherSchedules.length})` },
    { id: 'lessons',  label: 'Daily Lessons Logged' },
    { id: 'overview', label: 'Bio Data' }
  ];

  let tabContentHtml = '';

  // -------------------------------------------------------------------------
  // TEACHER TAB 1: ASSIGNED STUDENTS (Modeled on Reference Screenshot 3)
  // -------------------------------------------------------------------------
  if (activeTab === 'students') {
    tabContentHtml = `
      <div>
        ${studentSalaryItems.length === 0 ? `
          <div class="p-12 text-center text-slate-400 text-sm">No active students currently assigned to this teacher.</div>
        ` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
                <tr>
                  <th class="p-4 w-14">#</th>
                  <th class="p-4">Student Name</th>
                  <th class="p-4">Family / Parent</th>
                  <th class="p-4">Course &amp; Schedule</th>
                  <th class="p-4">Progress / Attendance</th>
                  <th class="p-4">Monthly Salary Rate</th>
                  <th class="p-4">Status</th>
                  <th class="p-4 text-right">Quick Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${studentSalaryItems.map(item => `
                  <tr class="hover:bg-slate-50/80 transition">
                    <td class="p-4"><span class="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-400 text-slate-950 font-black">${item.index}</span></td>
                    <td class="p-4">
                      <button onclick="openStudent360Profile('${item.student.id}', 'overview')" class="font-extrabold text-sm text-blue-700 hover:text-emerald-700 hover:underline flex items-center gap-1.5 text-left">
                        <i class="fa-solid fa-check text-slate-800 text-xs"></i>
                        <span>${item.student.name}</span>
                      </button>
                      <span class="text-[10px] font-mono text-slate-400 block ml-4">${item.student.id}</span>
                    </td>
                    <td class="p-4">
                      ${item.family ? `
                        <button onclick="openFamily360Profile('${item.family.id}', 'students')" class="font-bold text-blue-600 hover:underline text-left block">
                          ${item.family.parent_name}
                        </button>
                        <span class="text-[10px] font-mono text-slate-400">${item.family.id}</span>
                      ` : `<span class="text-slate-400">${item.student.family_id || '--'}</span>`}
                    </td>
                    <td class="p-4">
                      <span class="font-bold text-slate-800 block">${item.courseLabel}</span>
                      <span class="text-[11px] text-slate-500">${item.scheduleText}</span>
                    </td>
                    <td class="p-4">
                      <div class="flex items-center gap-3">
                        <button onclick="openStudent360Profile('${item.student.id}', 'progress')" class="text-blue-600 hover:underline font-bold">Progress</button>
                        <span class="text-slate-300">|</span>
                        <button onclick="openStudent360Profile('${item.student.id}', 'attendance')" class="text-teal-700 hover:underline font-bold">Attendance</button>
                      </div>
                    </td>
                    <td class="p-4 font-mono font-extrabold text-emerald-700">${item.finalRate.toLocaleString()} PKR</td>
                    <td class="p-4"><span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">${item.student.status || 'Active'}</span></td>
                    <td class="p-4 text-right">
                      <div class="inline-flex items-center gap-1.5">
                        <button onclick="openStudent360Profile('${item.student.id}', 'overview')" class="px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs">
                          Student Profile
                        </button>
                        ${item.family ? `
                          <button onclick="openFamily360Profile('${item.family.id}', 'students')" class="px-2.5 py-1 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs">
                            Family
                          </button>
                        ` : ''}
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

  // -------------------------------------------------------------------------
  // TEACHER TAB 2: SALARY & PAYROLL LEDGER (Modeled on Reference Screenshot 2)
  // -------------------------------------------------------------------------
  else if (activeTab === 'salary') {
    tabContentHtml = `
      <div class="p-4 sm:p-5 space-y-4">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-[11px] font-bold text-slate-500 block">Agreed Base &amp; Seniority</span>
            <strong class="text-base font-black text-slate-900">${teacher.rate_per_slot || 2200} PKR + ${teacherIncrement} PKR/stu</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200">
            <span class="text-[11px] font-bold text-indigo-700 block">${currentMonthLabel} Net Salary</span>
            <strong class="text-base font-black text-indigo-950">PKR ${currNetPayable.toLocaleString()}/-</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
            <span class="text-[11px] font-bold text-emerald-700 block">Total Paid Salary</span>
            <strong class="text-base font-black text-emerald-900">PKR ${totalSalaryPaid.toLocaleString()}/-</strong>
          </div>
          <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200">
            <span class="text-[11px] font-bold text-amber-800 block">Pending Salary</span>
            <strong class="text-base font-black text-amber-900">PKR ${totalSalaryPending.toLocaleString()}/-</strong>
          </div>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-800 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">PKR / Method</th>
                <th class="p-3.5">Salary Month</th>
                <th class="p-3.5">Students</th>
                <th class="p-3.5">Base Pay</th>
                <th class="p-3.5">ADJ (Bonus/Ded)</th>
                <th class="p-3.5">Net Payable AMT</th>
                <th class="p-3.5">Paid Date</th>
                <th class="p-3.5 text-center">Status</th>
                <th class="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${salaryLedgerRows.map(row => {
                const isPaid = row.status === 'Paid';
                return `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="p-3.5 font-semibold text-emerald-700">Bank / Payroll Transfer</td>
                    <td class="p-3.5 font-bold text-emerald-800">${row.month}</td>
                    <td class="p-3.5 font-bold text-slate-700">${row.studentsCount} Students</td>
                    <td class="p-3.5 font-mono text-emerald-800">PKR ${row.baseSubtotal.toLocaleString()}</td>
                    <td class="p-3.5 font-mono text-blue-600">+${row.bonus} / -${row.deduction}</td>
                    <td class="p-3.5 font-mono font-extrabold text-emerald-900">PKR ${row.netPayable.toLocaleString()}/-</td>
                    <td class="p-3.5 font-mono text-slate-600">${row.paymentDate}</td>
                    <td class="p-3.5 text-center">
                      <span class="px-2.5 py-1 rounded font-black text-[10px] uppercase ${isPaid ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}">
                        ${isPaid ? 'PAID' : 'PENDING'}
                      </span>
                    </td>
                    <td class="p-3.5 text-right">
                      <button onclick="switchTab('tab-salaries'); if (typeof calculateMonthlySalaries === 'function') calculateMonthlySalaries();"
                              class="px-3 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                        Open Payroll Slip
                      </button>
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

  // -------------------------------------------------------------------------
  // TEACHER TAB 3: WEEKLY SCHEDULE
  // -------------------------------------------------------------------------
  else if (activeTab === 'classes') {
    const sortedScheds = [...teacherSchedules].sort((a, b) => Number(a.day_of_week || 0) - Number(b.day_of_week || 0));
    tabContentHtml = `
      <div class="p-4 sm:p-5">
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">Day of Week</th>
                <th class="p-3.5">Class Time (PKT)</th>
                <th class="p-3.5">Student</th>
                <th class="p-3.5">Family / Parent</th>
                <th class="p-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${sortedScheds.length === 0 ? `
                <tr><td colspan="5" class="p-8 text-center text-slate-400">No weekly class slots booked yet.</td></tr>
              ` : sortedScheds.map(sc => {
                const stObj = studentMap[sc.student_id] || sc.students;
                const famObj = stObj ? (window.ALL_FAMILIES || []).find(f => String(f.id) === String(stObj.family_id)) : null;
                return `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="p-3.5 font-extrabold text-slate-900">${_DAY_LABELS_360[Number(sc.day_of_week)] || `Day ${sc.day_of_week}`}</td>
                    <td class="p-3.5 font-mono font-bold text-emerald-800">${(sc.start_time || '').slice(0,5)} - ${(sc.end_time || '').slice(0,5)} PKT</td>
                    <td class="p-3.5">${stObj ? `<button onclick="openStudent360Profile('${stObj.id}', 'overview')" class="font-extrabold text-blue-700 hover:underline">${stObj.name}</button>` : sc.student_id}</td>
                    <td class="p-3.5">${famObj ? `<button onclick="openFamily360Profile('${famObj.id}', 'students')" class="font-bold text-blue-600 hover:underline">${famObj.parent_name} (${famObj.id})</button>` : '--'}</td>
                    <td class="p-3.5 text-right">
                      <button onclick="open2DMatrixForTeacher('${teacher.id}')" class="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[11px]">
                        2D Matrix
                      </button>
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

  // -------------------------------------------------------------------------
  // TEACHER TAB 4: DAILY LESSONS LOGGED
  // -------------------------------------------------------------------------
  else if (activeTab === 'lessons') {
    tabContentHtml = `
      <div class="p-4 sm:p-5">
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-50 text-slate-700 font-extrabold border-b border-slate-200">
              <tr>
                <th class="p-3.5">Date</th>
                <th class="p-3.5">Student</th>
                <th class="p-3.5">Attendance</th>
                <th class="p-3.5">Daily Lesson / Sabaq Logged</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              ${teacherLogs.length === 0 ? `
                <tr><td colspan="4" class="p-8 text-center text-slate-400">No daily lessons logged by this teacher yet.</td></tr>
              ` : teacherLogs.slice(0, 40).map(l => {
                const stObj = (window.ALL_STUDENTS || []).find(s => String(s.id) === String(l.student_id));
                const parsed = _parseLessonLogEntry(l);
                return `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="p-3.5 font-mono font-bold text-slate-800">${l.date || '--'}</td>
                    <td class="p-3.5">${stObj ? `<button onclick="openStudent360Profile('${stObj.id}', 'lessons')" class="font-extrabold text-blue-700 hover:underline">${stObj.name}</button>` : l.student_id}</td>
                    <td class="p-3.5"><span class="px-2 py-0.5 rounded bg-emerald-600 text-white font-black text-[10px] uppercase">${l.status || 'Present'}</span></td>
                    <td class="p-3.5 text-slate-700">${parsed.bookTitle ? `<strong>${parsed.bookTitle}</strong> ${parsed.page ? `(Page ${parsed.page})` : ''} — ${parsed.remarks || parsed.assessment || ''}` : (parsed.remarks || '--')}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // TEACHER TAB 5: BIO DATA (Modeled on Reference Screenshot 1)
  // -------------------------------------------------------------------------
  else if (activeTab === 'overview') {
    const teacherBioRows = [
      { label: 'Teacher Full Name', value: teacher.full_name },
      { label: 'Father Name',       value: teacher.father_name || '--' },
      { label: 'Teacher ID',        value: creds.teacher_id },
      { label: 'Telephone / WhatsApp', value: teacher.phone || '--' },
      { label: 'Alternative Phone', value: teacher.alt_phone || '--' },
      { label: 'CNIC / National ID', value: acc.cnic || '--' },
      { label: 'Qualification',     value: acc.qualification || 'Quran & Tajweed Instructor' },
      { label: 'Joining Date',      value: joiningDate },
      { label: 'Working Shift',     value: teacher.working_shift || '10 Hours Shift' },
      { label: 'Base Slot Rate',    value: `${teacher.rate_per_slot || 2200} PKR / student` },
      { label: 'Seniority Increment', value: `+${teacherIncrement} PKR / student` },
      { label: 'Residential Address', value: teacher.address || '--' },
      { label: 'Portal Username',   value: creds.username },
      { label: 'Portal Password',   value: creds.password },
      { label: 'Account Status',    value: teacher.status || 'Active' }
    ];
    tabContentHtml = _buildThreeColSpecTableHtml(teacherBioRows);
  }

  // Assemble Full-Screen Teacher Profile Page
  workspace.innerHTML = `
    ${_buildTopWorkspaceNavHtml()}

    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <!-- FULL-WIDTH EMERALD PROFILE BANNER -->
      <div class="bg-gradient-to-b from-[#10b981] via-[#059669] to-[#047857] text-white pt-6 px-4 sm:px-8 flex flex-col items-center text-center">
        <div class="w-16 h-16 rounded-xl bg-white/20 border-2 border-white shadow-md flex items-center justify-center text-2xl font-black text-white mb-2">
          <i class="fa-solid fa-chalkboard-user"></i>
        </div>

        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-white">${teacher.full_name}</h1>
        <div class="text-sm font-mono font-semibold text-white/95 mt-0.5">${joiningDate}</div>

        <div class="flex items-center justify-center gap-2 flex-wrap mt-2.5">
          <span class="px-2.5 py-0.5 rounded bg-white/20 text-white font-black text-[11px] uppercase">${teacher.status || 'ACTIVE'}</span>
          <span class="px-2.5 py-0.5 rounded bg-slate-900/40 text-amber-300 font-mono font-bold text-[11px]">${creds.teacher_id}</span>
          <span class="px-2.5 py-0.5 rounded bg-amber-400 text-slate-950 font-black text-[10px] uppercase">${assignedStudents.length} ASSIGNED STUDENTS ✔</span>
          <span class="px-2.5 py-0.5 rounded bg-sky-500 text-white font-black text-[10px] uppercase">NET SALARY: PKR ${currNetPayable.toLocaleString()}</span>
        </div>

        <div class="flex items-center justify-center gap-2 flex-wrap mt-4">
          <button onclick="open2DMatrixForTeacher('${teacher.id}')" class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-table-cells"></i> Open 2D Timetable
          </button>
          <button onclick="openEditTeacherModal('${teacher.id}')" class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-pen-to-square"></i> Edit Teacher Profile
          </button>
          <button onclick="openQuickZoomModal('${teacher.id}')" class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-video"></i> Zoom Classroom
          </button>
          ${cleanPhone ? `
            <a href="https://wa.me/${cleanPhone}" target="_blank" class="px-3.5 py-1.5 rounded-lg bg-slate-900/70 hover:bg-slate-900 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition">
              <i class="fa-brands fa-whatsapp text-emerald-300"></i> WhatsApp Teacher
            </a>
          ` : ''}
        </div>

        <!-- DOCKED DARK TABS BAR AT BOTTOM OF BANNER -->
        <div class="flex items-center justify-center gap-1.5 flex-wrap mt-6 pb-3">
          ${tabsConfig.map(t => {
            const isAct = activeTab === t.id;
            return `
              <button onclick="openTeacher360Profile('${teacher.id}', '${t.id}', true)"
                      class="px-4 py-2 rounded-md text-xs font-extrabold transition ${isAct ? 'bg-slate-950 text-white shadow-md ring-2 ring-white/40' : 'bg-slate-800/80 hover:bg-slate-900 text-white/90'}">
                ${t.label}
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <!-- FULL-WIDTH SINGLE-CATEGORY WORKSPACE BELOW BANNER -->
      <div class="bg-white">
        ${tabContentHtml}
      </div>

      <!-- BOTTOM MANAGEMENT BAR -->
      <div class="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-center gap-2.5 flex-wrap">
        <button onclick="openEditTeacherModal('${teacher.id}')" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition shadow-2xs">
          Edit Profile
        </button>
        <button onclick="open2DMatrixForTeacher('${teacher.id}')" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition shadow-2xs">
          Manage 2D Schedule
        </button>
        <a href="teacher.html?t=${creds.username}" target="_blank" class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs transition shadow-2xs">
          Launch Teacher Portal
        </a>
      </div>
    </div>
  `;
}

// ============================================================================
// SEAMLESS ALIAS BRIDGES TO EXISTING LMS ENTRY POINTS
// ============================================================================
window.openStudent360Profile = openStudent360Profile;
window.openFamily360Profile = openFamily360Profile;
window.openTeacher360Profile = openTeacher360Profile;
window.exitFullScreen360Profile = exitFullScreen360Profile;

window.openStudentDetailModal = function(studentId) {
  return openStudent360Profile(studentId, 'overview');
};

window.openTeacherOptionsModal = function(teacherId) {
  return openTeacher360Profile(teacherId, 'students');
};

window.openTeacherDetailModal = function(teacherId) {
  return openTeacher360Profile(teacherId, 'students');
};

window.openFamilyFromDashboardSearch = function(familyId) {
  if (typeof clearDashboardGlobalSearch === 'function') clearDashboardGlobalSearch();
  return openFamily360Profile(familyId, 'students');
};
