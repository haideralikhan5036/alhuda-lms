/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — UNIFIED 360° PROFILES ENGINE
 * File: js/profiles360.js
 * Purpose: Complete, Interconnected 360° Profiles for Students, Families/Parents,
 *          and Teachers with Real-Time Data Reflection & Cross-Navigation.
 * ============================================================================
 */

// Navigation History Stack for moving seamlessly between Student <-> Family <-> Teacher
let _PROFILE_360_STACK = [];
let _CURRENT_360_STATE = {
  type: null,      // 'student' | 'family' | 'teacher'
  id: null,
  activeTab: 'overview',
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

/**
 * Ensure base collections (ALL_FAMILIES, ALL_STUDENTS, ALL_TEACHERS) are synced
 * and return fresh data for the requested 360° view without creating duplicate sources.
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
 * Helper: Push to 360° Breadcrumb Stack
 */
function _push360History(type, id, label, tab = 'overview') {
  if (!type || !id) return;
  const last = _PROFILE_360_STACK[_PROFILE_360_STACK.length - 1];
  if (last && last.type === type && String(last.id) === String(id)) {
    last.label = label || last.label;
    last.tab = tab || last.tab;
    return;
  }
  // If already in stack earlier, slice back to it
  const existingIdx = _PROFILE_360_STACK.findIndex(item => item.type === type && String(item.id) === String(id));
  if (existingIdx !== -1 && existingIdx === _PROFILE_360_STACK.length - 2) {
    _PROFILE_360_STACK.pop();
    return;
  }
  _PROFILE_360_STACK.push({ type, id, label: label || String(id), tab });
  if (_PROFILE_360_STACK.length > 10) {
    _PROFILE_360_STACK.shift();
  }
}

/**
 * Navigate back to the previous entity in the 360° stack
 */
function navigateBack360Profile() {
  if (_PROFILE_360_STACK.length <= 1) return;
  _PROFILE_360_STACK.pop(); // remove current
  const prev = _PROFILE_360_STACK.pop(); // pop target so open* pushes it cleanly
  if (!prev) return;
  if (prev.type === 'student') openStudent360Profile(prev.id, prev.tab || 'overview');
  else if (prev.type === 'family') openFamily360Profile(prev.id, prev.tab || 'overview');
  else if (prev.type === 'teacher') openTeacher360Profile(prev.id, prev.tab || 'overview');
}

/**
 * Jump to a specific item in the breadcrumb stack
 */
function jumpTo360Breadcrumb(index) {
  const item = _PROFILE_360_STACK[index];
  if (!item) return;
  _PROFILE_360_STACK = _PROFILE_360_STACK.slice(0, index);
  if (item.type === 'student') openStudent360Profile(item.id, item.tab || 'overview');
  else if (item.type === 'family') openFamily360Profile(item.id, item.tab || 'overview');
  else if (item.type === 'teacher') openTeacher360Profile(item.id, item.tab || 'overview');
}

/**
 * Refresh the currently open 360° profile with live data from Supabase & LMS stores
 */
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
 * Render the top Breadcrumb & Back Navigation Bar inside #modalUnified360Profile
 */
function _render360BreadcrumbBar() {
  const bar = document.getElementById('unified360BreadcrumbBar');
  if (!bar) return;

  const hasBack = _PROFILE_360_STACK.length > 1;
  const crumbsHtml = _PROFILE_360_STACK.map((item, idx) => {
    const isLast = idx === _PROFILE_360_STACK.length - 1;
    const icon = item.type === 'student' ? 'fa-user-graduate text-teal-600'
               : item.type === 'family'  ? 'fa-house-user text-emerald-600'
               :                           'fa-chalkboard-user text-indigo-600';
    const typeLabel = item.type === 'student' ? 'Student'
                    : item.type === 'family'  ? 'Family'
                    :                           'Teacher';
    return `
      <button onclick="${isLast ? '' : `jumpTo360Breadcrumb(${idx})`}"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${isLast ? 'bg-slate-900 text-white shadow-2xs cursor-default' : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 cursor-pointer'}">
        <i class="fa-solid ${icon} ${isLast ? 'text-brandGold' : ''}"></i>
        <span class="opacity-75 font-semibold">${typeLabel}:</span>
        <span class="font-extrabold truncate max-w-[150px]">${item.label}</span>
      </button>
      ${!isLast ? '<i class="fa-solid fa-chevron-right text-[9px] text-slate-400 mx-0.5"></i>' : ''}
    `;
  }).join('');

  bar.innerHTML = `
    <div class="flex items-center justify-between gap-2 flex-wrap w-full">
      <div class="flex items-center gap-1.5 flex-wrap">
        ${hasBack ? `
          <button onclick="navigateBack360Profile()" class="px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 text-[11px] font-black flex items-center gap-1 transition shadow-2xs mr-1">
            <i class="fa-solid fa-arrow-left"></i> Back
          </button>
        ` : ''}
        <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1 hidden sm:inline">
          <i class="fa-solid fa-diagram-project text-brandEmerald mr-0.5"></i> 360° Path:
        </span>
        ${crumbsHtml}
      </div>
      <div class="flex items-center gap-1.5">
        <button onclick="refreshCurrent360Profile()" class="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 text-[11px] font-bold flex items-center gap-1 transition shadow-2xs" title="Sync Latest Live Data">
          <i class="fa-solid fa-rotate text-emerald-600"></i> Sync Live Data
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

  // Sort receipts latest first
  receipts.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const totalPaid = receipts.reduce((sum, r) => sum + (parseFloat(r.amountPaid || 0) || 0), 0);

  let advanceCredit = 0;
  if (typeof getFamilyAvailableAdvanceCredit === 'function') {
    try { advanceCredit = parseFloat(getFamilyAvailableAdvanceCredit(family.id) || 0); } catch (e) {}
  }

  // Build 12-month status using existing CACHED_ANNUAL_FEE_MATRIX or deriving directly from receipts
  const monthsNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const currentMonthIdx = 8; // September 2026
  let matrixRow = null;
  if (Array.isArray(window.CACHED_ANNUAL_FEE_MATRIX)) {
    matrixRow = window.CACHED_ANNUAL_FEE_MATRIX.find(r => String(r.familyId || '').toUpperCase() === famId);
  }

  // Determine earliest enrollment month among family students
  let earliestJoinDate = family.created_at ? family.created_at.slice(0, 10) : '2026-01-01';
  const famStudents = (window.ALL_STUDENTS || []).filter(s => String(s.family_id || '').toUpperCase() === famId);
  famStudents.forEach(s => {
    if (s.joining_date && s.joining_date < earliestJoinDate) earliestJoinDate = s.joining_date;
  });
  const joinYear = parseInt(earliestJoinDate.slice(0, 4), 10) || 2026;
  const joinMonthIdx = (parseInt(earliestJoinDate.slice(5, 7), 10) || 1) - 1;

  let totalPending = 0;
  const monthsStatus = monthsNames.map((mName, mIdx) => {
    if (matrixRow && Array.isArray(matrixRow.months) && matrixRow.months[mIdx]) {
      const mObj = matrixRow.months[mIdx];
      if (!mObj.isPaid && !mObj.isLeave && !mObj.isNotEnrolled && !mObj.isFuture) {
        const rem = mObj.isPartial ? Math.max(0, agreedMonthlyFee - (parseFloat(mObj.amountPaid || 0))) : agreedMonthlyFee;
        totalPending += rem;
      }
      return mObj;
    }

    const monthReceipts = receipts.filter(r => String(r.month || '').toLowerCase() === mName.toLowerCase() && Number(r.year || 2026) === 2026);
    const paidInMonth = monthReceipts.reduce((acc, r) => acc + (parseFloat(r.amountPaid || 0) || 0), 0);
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
      amountPaid: paidInMonth
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

// ============================================================================
// 1. STUDENT 360° UNIFIED PROFILE
// ============================================================================
async function openStudent360Profile(studentId, initialTab = 'overview', skipHistoryPush = false) {
  if (!studentId) return;
  window.CURRENT_MODAL_STUDENT_ID = studentId;

  const modal = document.getElementById('modalUnified360Profile');
  const contentBox = document.getElementById('unified360BodyContainer');
  if (!modal || !contentBox) return;

  openModal('modalUnified360Profile');
  contentBox.innerHTML = `
    <div class="p-12 text-center text-slate-500">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-brandEmerald mb-2 block"></i>
      <span class="text-xs font-extrabold">Loading Complete Student 360° Profile...</span>
    </div>
  `;

  await _ensure360CoreDataReady();

  // 1. Retrieve Student from existing sources
  let student = (window.ALL_STUDENTS || []).find(s => String(s.id) === String(studentId));
  if (!student) {
    const { data } = await db.from('students').select('*').eq('id', studentId).maybeSingle();
    student = data;
    if (student && Array.isArray(window.ALL_STUDENTS)) window.ALL_STUDENTS.push(student);
  }
  if (!student) {
    contentBox.innerHTML = `<div class="p-8 text-center text-rose-600 font-bold text-sm">Student record (${studentId}) could not be found.</div>`;
    return;
  }

  _CURRENT_360_STATE.type = 'student';
  _CURRENT_360_STATE.id = student.id;
  _CURRENT_360_STATE.activeTab = initialTab || 'overview';

  if (!skipHistoryPush) {
    _push360History('student', student.id, `${student.name} (${student.id})`, _CURRENT_360_STATE.activeTab);
  }
  _render360BreadcrumbBar();

  // 2. Retrieve Family & Sibling Students
  let family = (window.ALL_FAMILIES || []).find(f => String(f.id) === String(student.family_id));
  if (!family && student.family_id) {
    const { data } = await db.from('families').select('*, students(*)').eq('id', student.family_id).maybeSingle();
    family = data;
  }
  const familyStudents = (window.ALL_STUDENTS || []).filter(s =>
    student.family_id && String(s.family_id) === String(student.family_id) && String(s.status || '').toLowerCase() !== 'trial'
  );

  // 3. Retrieve Scheduled Classes & Attendance / Lesson History in parallel
  const [schedRes, logsRes] = await Promise.all([
    db.from('class_schedules').select('*, teachers(*)').eq('student_id', student.id),
    db.from('attendance_logs').select('*').eq('student_id', student.id).order('date', { ascending: false })
  ]);

  const schedules = schedRes.data || [];
  const attendanceLogs = logsRes.data || [];

  // Also include any advance classes recorded in localStorage for this student
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

  // 4. Resolve Assigned Teacher
  let assignedTeacherId = student.assigned_teacher_id || (schedules[0] ? schedules[0].teacher_id : null);
  let assignedTeacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(assignedTeacherId));
  if (!assignedTeacher && schedules[0]?.teachers) {
    assignedTeacher = schedules[0].teachers;
  }
  const teacherCreds = (assignedTeacher && typeof getTeacherCreds === 'function') ? getTeacherCreds(assignedTeacher) : { teacher_id: assignedTeacher?.id || 'Unassigned' };

  // Parse Student metadata (language, days_per_week, etc.)
  let stuMeta = {};
  if (student.notes) {
    try { stuMeta = JSON.parse(student.notes); } catch (e) {}
  }
  const stuLanguage = stuMeta.language || student.language || 'English / Urdu';
  const stuDaysPerWeek = stuMeta.days_per_week || (schedules.length > 0 ? `${schedules.length} Scheduled Slots / Week` : '5 Days / Week');
  const stuCourse = student.course_id || stuMeta.course || 'Noorani Qaida & Nazra Quran';
  const stuStatus = student.status || 'Active';

  // Role-based contact protection
  const rawPhone = student.whatsapp || family?.whatsapp || '';
  const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  const displayPhone = (window.CURRENT_ROLE === 'manager' && typeof maskStudentPhone === 'function')
    ? maskStudentPhone(rawPhone)
    : (rawPhone || 'Not Provided');
  const displayEmail = (window.CURRENT_ROLE === 'manager' && typeof maskStudentEmail === 'function')
    ? maskStudentEmail(family?.parent_email || '')
    : (family?.parent_email || 'Not Provided');

  // Compute Attendance Analytics (Filtered by _CURRENT_360_STATE.attMonthFilter)
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

  // Compute Lesson & Progress Metrics from existing attendance_logs
  const parsedLessons = attendanceLogs
    .map(l => ({ rawLog: l, parsed: _parseLessonLogEntry(l) }))
    .filter(item => item.parsed.bookTitle || item.parsed.page || item.parsed.remarks);

  const passedLessonsCount = parsedLessons.filter(x => String(x.parsed.assessment || '').toLowerCase() === 'pass').length;
  const repeatLessonsCount = parsedLessons.filter(x => String(x.parsed.assessment || '').toLowerCase() === 'repeat').length;
  const latestLesson = parsedLessons[0] || null;
  const highestPage = parsedLessons.reduce((max, x) => Math.max(max, Number(x.parsed.page || 0)), 0);
  const ratingsArr = parsedLessons.map(x => Number(x.parsed.rating || 0)).filter(r => r > 0);
  const avgRating = ratingsArr.length > 0 ? (ratingsArr.reduce((a, b) => a + b, 0) / ratingsArr.length).toFixed(1) : '5.0';

  // Family Financial Snapshot
  const fin = _getFamilyFinancialSnapshot(family);

  // Status Badge HTML
  const statusBadgeClass = stuStatus.toLowerCase() === 'active'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : stuStatus.toLowerCase() === 'leave'
    ? 'bg-blue-100 text-blue-800 border-blue-300'
    : 'bg-slate-100 text-slate-700 border-slate-300';

  // Render Header + Sub-Tabs + Active Tab Content
  const tabsConfig = [
    { id: 'overview',   label: 'Overview & Family',     icon: 'fa-id-card',          badge: null },
    { id: 'classes',    label: 'Classes & Schedule',    icon: 'fa-calendar-days',    badge: schedules.length },
    { id: 'lessons',    label: 'Daily Lessons',         icon: 'fa-book-quran',       badge: parsedLessons.length },
    { id: 'attendance', label: 'Attendance History',    icon: 'fa-clipboard-user',   badge: `${attendancePct}%` },
    { id: 'progress',   label: 'Progress Report',       icon: 'fa-chart-line',       badge: highestPage ? `Pg ${highestPage}` : null },
    { id: 'fees',       label: 'Fees & Family Ledger',  icon: 'fa-file-invoice-dollar', badge: `${fin.currency} ${fin.agreedMonthlyFee}` }
  ];

  let tabBodyHtml = '';

  // =========================================================================
  // TAB 1: OVERVIEW & FAMILY / TEACHER INTERCONNECTIONS
  // =========================================================================
  if (_CURRENT_360_STATE.activeTab === 'overview') {
    tabBodyHtml = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Column 1: Student Basic Information -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <i class="fa-solid fa-user-graduate text-teal-600"></i> Student Basic Information
            </h4>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${statusBadgeClass}">${stuStatus}</span>
          </div>
          <div class="grid grid-cols-2 gap-2.5 text-xs">
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Student Full Name</span>
              <strong class="text-slate-900 font-extrabold text-sm">${student.name}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Student ID</span>
              <strong class="text-brandDark font-mono font-black text-sm">${student.id}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Enrollment / Joining Date</span>
              <strong class="text-slate-800 font-mono">${student.joining_date || (student.created_at ? student.created_at.slice(0, 10) : 'N/A')}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Age &amp; Gender</span>
              <strong class="text-slate-800">${student.age || '--'} Years &bull; ${student.gender || 'N/A'}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100 col-span-2">
              <span class="text-[10px] text-slate-400 font-bold block">Enrolled Course / Syllabus</span>
              <strong class="text-emerald-800 font-extrabold">${stuCourse}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Language Medium</span>
              <strong class="text-slate-800">${stuLanguage}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Weekly Plan</span>
              <strong class="text-slate-800">${stuDaysPerWeek}</strong>
            </div>
          </div>
        </div>

        <!-- Column 2: Assigned Teacher & Class Connection -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between space-y-3">
          <div class="space-y-3">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <i class="fa-solid fa-chalkboard-user text-indigo-600"></i> Assigned Teacher
              </h4>
              ${assignedTeacher ? `
                <button onclick="openTeacher360Profile('${assignedTeacher.id}')" class="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-extrabold transition shadow-2xs flex items-center gap-1">
                  Open Teacher 360° <i class="fa-solid fa-arrow-right text-[9px]"></i>
                </button>
              ` : ''}
            </div>

            ${assignedTeacher ? `
              <div onclick="openTeacher360Profile('${assignedTeacher.id}')" class="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-50/80 to-slate-50 border border-indigo-200 hover:border-indigo-400 cursor-pointer transition group">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-3">
                    <div class="w-11 h-11 rounded-xl bg-indigo-600 text-white font-black text-sm flex items-center justify-center shadow-xs">
                      ${(assignedTeacher.full_name || 'T').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div class="font-extrabold text-sm text-slate-900 group-hover:text-indigo-700 transition flex items-center gap-1.5">
                        ${assignedTeacher.full_name}
                        <span class="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-900 font-mono text-[9px] font-bold">${teacherCreds.teacher_id}</span>
                      </div>
                      <div class="text-[11px] text-slate-500">${assignedTeacher.working_shift || '10 Hours Shift'}</div>
                    </div>
                  </div>
                  <i class="fa-solid fa-up-right-from-square text-indigo-500 group-hover:translate-x-0.5 transition"></i>
                </div>
                <div class="grid grid-cols-2 gap-2 mt-3 pt-2.5 border-t border-indigo-100 text-[11px]">
                  <div>
                    <span class="text-slate-400 block text-[10px]">Contact:</span>
                    <strong class="font-mono text-slate-800">${assignedTeacher.phone || '--'}</strong>
                  </div>
                  <div>
                    <span class="text-slate-400 block text-[10px]">Weekly Classes:</span>
                    <strong class="text-emerald-700">${schedules.length} Booked Slot(s)</strong>
                  </div>
                </div>
              </div>
            ` : `
              <div class="p-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                No teacher currently assigned to this student.
              </div>
            `}

            <!-- Latest Daily Lesson Snapshot -->
            <div class="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1.5">
              <div class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-emerald-900">
                <span><i class="fa-solid fa-book-open mr-1 text-emerald-600"></i> Latest Recorded Lesson</span>
                <button onclick="openStudent360Profile('${student.id}', 'lessons', true)" class="text-emerald-700 hover:underline font-extrabold">All Lessons &rarr;</button>
              </div>
              ${latestLesson ? `
                <div class="text-xs font-extrabold text-slate-900">
                  ${latestLesson.parsed.bookTitle || stuCourse}
                  ${latestLesson.parsed.page ? `<span class="px-1.5 py-0.5 rounded bg-white border border-emerald-300 text-emerald-800 font-mono text-[10px] ml-1">Page ${latestLesson.parsed.page}</span>` : ''}
                  ${latestLesson.parsed.assessment ? `<span class="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px] ml-1">${latestLesson.parsed.assessment}</span>` : ''}
                </div>
                <div class="text-[11px] text-slate-600 italic">${latestLesson.parsed.remarks || 'Completed daily Sabaq revision'}</div>
                <div class="text-[10px] text-slate-400 font-mono">Date: ${latestLesson.rawLog.date || '--'}</div>
              ` : `
                <div class="text-xs text-slate-500 italic">No daily lesson logged yet. When the teacher logs today's Sabaq in the Teacher Portal, it appears here automatically.</div>
              `}
            </div>
          </div>

          <div class="flex gap-2 pt-2 border-t border-slate-100">
            ${assignedTeacher ? `
              <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-teachers'); open2DMatrixForTeacher('${assignedTeacher.id}')" class="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-[11px] font-extrabold transition flex items-center justify-center gap-1.5">
                <i class="fa-solid fa-table-cells text-brandEmerald"></i> Teacher 2D Timetable
              </button>
            ` : ''}
            <button onclick="openStudent360Profile('${student.id}', 'attendance', true)" class="flex-1 py-2 bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 rounded-xl text-[11px] font-extrabold transition flex items-center justify-center gap-1.5">
              <i class="fa-solid fa-clipboard-check text-teal-600"></i> ${attendancePct}% Attendance
            </button>
          </div>
        </div>

        <!-- Column 3: Family / Parent & Sibling Students (Interconnected) -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between space-y-3">
          <div class="space-y-3">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <i class="fa-solid fa-house-user text-emerald-600"></i> Family &amp; Siblings (${familyStudents.length})
              </h4>
              ${family ? `
                <button onclick="openFamily360Profile('${family.id}')" class="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-extrabold transition shadow-2xs flex items-center gap-1">
                  Open Family 360° <i class="fa-solid fa-arrow-right text-[9px]"></i>
                </button>
              ` : ''}
            </div>

            ${family ? `
              <div onclick="openFamily360Profile('${family.id}')" class="p-3 rounded-xl bg-gradient-to-r from-emerald-50/90 to-teal-50/60 border border-emerald-200 hover:border-emerald-400 cursor-pointer transition group">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="text-xs font-black text-slate-900 group-hover:text-emerald-800 flex items-center gap-1.5">
                      ${family.parent_name}
                      <span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[9px] font-bold">${family.id}</span>
                    </div>
                    <div class="text-[11px] text-slate-600 mt-0.5">
                      <i class="fa-solid fa-earth-americas text-emerald-600 mr-1"></i>${family.country || 'Global'} &bull; <span class="font-mono">${displayPhone}</span>
                    </div>
                  </div>
                  <div class="text-right">
                    <span class="text-xs font-black text-brandDark block">${fin.currency} ${fin.agreedMonthlyFee}</span>
                    <span class="text-[9px] text-slate-500 font-bold">Family Fee</span>
                  </div>
                </div>
              </div>
            ` : ''}

            <!-- All Students Belonging to this Family -->
            <div class="space-y-1.5">
              <div class="text-[10px] font-black uppercase tracking-wider text-slate-400">
                All Students in this Family (${familyStudents.length}):
              </div>
              <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                ${familyStudents.map(sib => {
                  const isCurrent = String(sib.id) === String(student.id);
                  const sibTeacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(sib.assigned_teacher_id));
                  return `
                    <div class="p-2.5 rounded-xl border ${isCurrent ? 'bg-teal-50/80 border-teal-300' : 'bg-slate-50 hover:bg-white border-slate-200'} transition flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                          <button onclick="openStudent360Profile('${sib.id}')" class="font-extrabold text-xs ${isCurrent ? 'text-teal-950' : 'text-slate-900 hover:text-brandEmerald hover:underline'} truncate text-left">
                            ${sib.name}
                          </button>
                          <span class="px-1.5 py-0.2 rounded bg-white border border-slate-200 font-mono text-[9px] font-bold text-slate-700">${sib.id}</span>
                          ${isCurrent ? '<span class="px-1.5 py-0.2 rounded bg-teal-600 text-white text-[8px] font-black uppercase">Viewing</span>' : ''}
                        </div>
                        <div class="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>Teacher: ${sibTeacher ? `<button onclick="openTeacher360Profile('${sibTeacher.id}')" class="font-bold text-indigo-700 hover:underline">${sibTeacher.full_name}</button>` : 'Unassigned'}</span>
                          &bull;
                          <span>Joined: ${sib.joining_date || '--'}</span>
                        </div>
                      </div>
                      ${!isCurrent ? `
                        <button onclick="openStudent360Profile('${sib.id}')" class="px-2 py-1 rounded-lg bg-brandDark hover:bg-brandDarkest text-white text-[10px] font-bold shrink-0">
                          Switch
                        </button>
                      ` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
            <button onclick="openStudent360Profile('${student.id}', 'fees', true)" class="w-full py-2 bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-200 rounded-xl text-[11px] font-extrabold transition flex items-center justify-center gap-1.5">
              <i class="fa-solid fa-coins text-amber-600"></i> Paid: ${fin.currency} ${fin.totalPaid.toFixed(0)} &bull; Pending: ${fin.currency} ${fin.totalPending.toFixed(0)}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // TAB 2: CLASSES & WEEKLY SCHEDULE
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'classes') {
    const sortedScheds = [...schedules].sort((a, b) => Number(a.day_of_week || 0) - Number(b.day_of_week || 0));
    tabBodyHtml = `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div class="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h4 class="font-black text-sm text-slate-900 flex items-center gap-2">
              <i class="fa-solid fa-calendar-days text-brandEmerald"></i> Weekly Scheduled Classes for ${student.name}
            </h4>
            <p class="text-[11px] text-slate-500">Live class timetable synced with the Academy 2D Schedule Matrix</p>
          </div>
          ${assignedTeacher ? `
            <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-teachers'); open2DMatrixForTeacher('${assignedTeacher.id}')" class="px-3 py-1.5 bg-brandDark hover:bg-brandDarkest text-white rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 shadow-xs">
              <i class="fa-solid fa-table-cells text-brandGold"></i> Manage in 2D Schedule Matrix
            </button>
          ` : ''}
        </div>
        ${sortedScheds.length === 0 ? `
          <div class="p-10 text-center text-slate-400 text-xs">
            No weekly timetable slots booked for this student yet.
          </div>
        ` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th class="p-3">Day of Week</th>
                  <th class="p-3">Class Timing (PKT)</th>
                  <th class="p-3">Course / Subject</th>
                  <th class="p-3">Assigned Teacher</th>
                  <th class="p-3">Classroom Link</th>
                  <th class="p-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${sortedScheds.map(sc => {
                  const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(sc.teacher_id)) || sc.teachers;
                  return `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="p-3 font-extrabold text-slate-900">${_DAY_LABELS_360[Number(sc.day_of_week)] || `Day ${sc.day_of_week}`}</td>
                      <td class="p-3 font-mono font-bold text-brandDark">${(sc.start_time || '').slice(0, 5)} - ${(sc.end_time || '').slice(0, 5)} PKT</td>
                      <td class="p-3"><span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[11px]">${stuCourse}</span></td>
                      <td class="p-3">
                        ${tObj ? `
                          <button onclick="openTeacher360Profile('${tObj.id}')" class="font-extrabold text-indigo-700 hover:underline flex items-center gap-1">
                            <i class="fa-solid fa-chalkboard-user text-xs"></i> ${tObj.full_name}
                          </button>
                        ` : '<span class="text-slate-400">Unassigned</span>'}
                      </td>
                      <td class="p-3">
                        ${sc.meeting_link ? `
                          <a href="${sc.meeting_link}" target="_blank" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold text-[11px] inline-flex items-center gap-1">
                            <i class="fa-solid fa-video text-blue-600"></i> Join Zoom
                          </a>
                        ` : '<span class="text-slate-400 text-[11px]">Standard Classroom</span>'}
                      </td>
                      <td class="p-3 text-right">
                        <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-[10px]">Active Slot</span>
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

  // =========================================================================
  // TAB 3: DAILY LESSONS / CHRONOLOGICAL SABAQ HISTORY
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'lessons') {
    tabBodyHtml = `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div class="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h4 class="font-black text-sm text-slate-900 flex items-center gap-2">
              <i class="fa-solid fa-book-quran text-brandEmerald"></i> Daily Lessons &amp; Sabaq History (${parsedLessons.length} Entries)
            </h4>
            <p class="text-[11px] text-slate-500">Automatically synced from Teacher Portal daily Sabaq logs &amp; Admin attendance records</p>
          </div>
        </div>
        ${parsedLessons.length === 0 ? `
          <div class="p-10 text-center text-slate-400 text-xs">
            <i class="fa-solid fa-book-open text-2xl text-slate-300 mb-2 block"></i>
            No lesson history recorded yet for <strong>${student.name}</strong>. Whenever the assigned teacher enters today's Sabaq in the Teacher Portal, it will automatically appear here.
          </div>
        ` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th class="p-3">Date</th>
                  <th class="p-3">Lesson / Book Studied</th>
                  <th class="p-3">Page / Range</th>
                  <th class="p-3">Assessment</th>
                  <th class="p-3">Teacher Remarks / Notes</th>
                  <th class="p-3">Teacher</th>
                  <th class="p-3 text-right">Digital Reader</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${parsedLessons.map(({ rawLog, parsed }) => {
                  const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(rawLog.teacher_id)) || assignedTeacher;
                  const isPass = String(parsed.assessment || '').toLowerCase() === 'pass';
                  return `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="p-3 font-mono font-bold text-slate-800 whitespace-nowrap">${rawLog.date || '--'}</td>
                      <td class="p-3 font-extrabold text-slate-900">
                        <i class="fa-solid fa-book-open text-brandEmerald mr-1"></i>${parsed.bookTitle || stuCourse}
                      </td>
                      <td class="p-3 font-mono">
                        ${parsed.page ? `<span class="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-bold text-slate-800">Page ${parsed.page}${parsed.lineRange ? ` (${parsed.lineRange})` : ''}</span>` : '<span class="text-slate-400">--</span>'}
                      </td>
                      <td class="p-3">
                        ${parsed.assessment ? `
                          <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${isPass ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-amber-100 text-amber-800 border-amber-300'}">
                            ${parsed.assessment} ${parsed.rating ? `(${'★'.repeat(Number(parsed.rating))})` : ''}
                          </span>
                        ` : '<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">Logged</span>'}
                      </td>
                      <td class="p-3 text-slate-600 max-w-xs">${parsed.remarks || '--'}</td>
                      <td class="p-3">
                        ${tObj ? `<button onclick="openTeacher360Profile('${tObj.id}')" class="font-bold text-indigo-700 hover:underline">${tObj.full_name}</button>` : '--'}
                      </td>
                      <td class="p-3 text-right">
                        ${parsed.page && typeof openDigitalBookReader === 'function' ? `
                          <button onclick="openDigitalBookReader('${parsed.bookId}', ${parsed.page})" class="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-[11px]">
                            <i class="fa-solid fa-book-open-reader mr-1"></i>Open Pg ${parsed.page}
                          </button>
                        ` : '<span class="text-slate-300 text-[10px]">N/A</span>'}
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

  // =========================================================================
  // TAB 4: ATTENDANCE HISTORY & MONTHLY ANALYTICS
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'attendance') {
    tabBodyHtml = `
      <div class="space-y-4">
        <!-- Month Filter + 5 Attendance KPI Boxes -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h4 class="font-black text-sm text-slate-900 flex items-center gap-2">
                <i class="fa-solid fa-clipboard-user text-teal-600"></i> Student Attendance Analytics
              </h4>
              <p class="text-[11px] text-slate-500">Filter by month to inspect days attended, absences, leaves, and attendance rate</p>
            </div>
            <div class="flex items-center gap-2">
              <label class="text-xs font-bold text-slate-600">Select Period:</label>
              <select onchange="_CURRENT_360_STATE.attMonthFilter = this.value; openStudent360Profile('${student.id}', 'attendance', true)"
                      class="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-extrabold text-slate-800">
                <option value="all" ${activeMonthFilter === 'all' ? 'selected' : ''}>All Recorded Months</option>
                ${availableMonths.map(m => `<option value="${m}" ${activeMonthFilter === m ? 'selected' : ''}>Month: ${m}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span class="text-[10px] font-bold uppercase text-slate-400 block">Total Logged</span>
              <strong class="text-lg font-black text-slate-900">${totalMarkedClasses}</strong>
              <span class="text-[10px] text-slate-500 block">Classes</span>
            </div>
            <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <span class="text-[10px] font-bold uppercase text-emerald-700 block">Days Attended</span>
              <strong class="text-lg font-black text-emerald-800">${daysPresent}</strong>
              <span class="text-[10px] text-emerald-600 block">Present / Completed</span>
            </div>
            <div class="p-3 rounded-xl bg-rose-50 border border-rose-200">
              <span class="text-[10px] font-bold uppercase text-rose-700 block">Days Missed</span>
              <strong class="text-lg font-black text-rose-800">${daysAbsent}</strong>
              <span class="text-[10px] text-rose-600 block">Absent</span>
            </div>
            <div class="p-3 rounded-xl bg-blue-50 border border-blue-200">
              <span class="text-[10px] font-bold uppercase text-blue-700 block">Approved Leaves</span>
              <strong class="text-lg font-black text-blue-800">${daysLeave}</strong>
              <span class="text-[10px] text-blue-600 block">On Leave</span>
            </div>
            <div class="p-3 rounded-xl bg-teal-50 border border-teal-200 col-span-2 sm:col-span-1">
              <span class="text-[10px] font-bold uppercase text-teal-700 block">Attendance Rate</span>
              <strong class="text-lg font-black text-teal-900">${attendancePct}%</strong>
              <div class="w-full h-1.5 bg-teal-200 rounded-full mt-1 overflow-hidden">
                <div class="h-full bg-teal-600 rounded-full" style="width:${attendancePct}%"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Chronological Attendance Table -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          ${filteredAttLogs.length === 0 ? `
            <div class="p-8 text-center text-slate-400 text-xs">No attendance logs found for the selected period (${activeMonthFilter}).</div>
          ` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th class="p-3">Date</th>
                    <th class="p-3">Attendance Status</th>
                    <th class="p-3">Teacher</th>
                    <th class="p-3">Lesson / Attendance Notes</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${filteredAttLogs.map(log => {
                    const st = String(log.status || 'Present');
                    const badge = st === 'Present' ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : st === 'Absent'  ? 'bg-rose-100 text-rose-800 border-rose-300'
                                : st === 'Leave'   ? 'bg-blue-100 text-blue-800 border-blue-300'
                                :                    'bg-amber-100 text-amber-800 border-amber-300';
                    const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(log.teacher_id)) || assignedTeacher;
                    const parsed = _parseLessonLogEntry(log);
                    const noteSummary = parsed.bookTitle
                      ? `<strong>${parsed.bookTitle}</strong> ${parsed.page ? `(Page ${parsed.page})` : ''} — ${parsed.assessment || 'Done'} ${parsed.remarks ? `• "${parsed.remarks}"` : ''}`
                      : (parsed.remarks || '--');
                    return `
                      <tr class="hover:bg-slate-50 transition">
                        <td class="p-3 font-mono font-bold text-slate-800">${log.date || '--'}</td>
                        <td class="p-3"><span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${badge}">${st}</span></td>
                        <td class="p-3">${tObj ? `<button onclick="openTeacher360Profile('${tObj.id}')" class="font-bold text-indigo-700 hover:underline">${tObj.full_name}</button>` : '--'}</td>
                        <td class="p-3 text-slate-600">${noteSummary}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // TAB 5: PROGRESS REPORT (CONSOLIDATED FROM EXISTING LESSON/COURSE DATA)
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'progress') {
    const targetTotalPages = stuCourse.toLowerCase().includes('quran') ? 548 : 32;
    const progressPct = highestPage > 0 ? Math.min(100, Math.round((highestPage / targetTotalPages) * 100)) : (passedLessonsCount > 0 ? Math.min(100, passedLessonsCount * 5) : 10);

    tabBodyHtml = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
          <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5 border-b pb-2.5">
            <i class="fa-solid fa-chart-line text-brandEmerald"></i> Syllabus Completion Summary
          </h4>
          <div class="p-4 rounded-2xl bg-gradient-to-br from-emerald-900 to-teal-950 text-white space-y-2">
            <span class="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">Current Enrolled Course</span>
            <div class="text-base font-black">${stuCourse}</div>
            <div class="flex items-center justify-between text-xs pt-1">
              <span>Current Milestone: <strong>${highestPage > 0 ? `Page ${highestPage}` : 'Initial Assessment'}</strong></span>
              <span class="font-mono font-black text-brandGold">${progressPct}%</span>
            </div>
            <div class="w-full h-2 bg-white/20 rounded-full overflow-hidden">
              <div class="h-full bg-brandGold rounded-full" style="width:${progressPct}%"></div>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 text-center text-xs">
            <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
              <strong class="text-base font-black text-emerald-800 block">${passedLessonsCount}</strong>
              <span class="text-[10px] text-emerald-700 font-bold">Passed Sabaq</span>
            </div>
            <div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
              <strong class="text-base font-black text-amber-800 block">${repeatLessonsCount}</strong>
              <span class="text-[10px] text-amber-700 font-bold">Revisions</span>
            </div>
            <div class="p-2.5 rounded-xl bg-indigo-50 border border-indigo-200">
              <strong class="text-base font-black text-indigo-800 block">${avgRating} ★</strong>
              <span class="text-[10px] text-indigo-700 font-bold">Avg Rating</span>
            </div>
          </div>
        </div>

        <div class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
          <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5 border-b pb-2.5">
            <i class="fa-solid fa-award text-amber-500"></i> Recent Progress Evaluations &amp; Teacher Checkpoints
          </h4>
          ${parsedLessons.length === 0 ? `
            <div class="p-8 text-center text-slate-400 text-xs">No progress checkpoints logged yet.</div>
          ` : `
            <div class="space-y-2 max-h-80 overflow-y-auto pr-1">
              ${parsedLessons.slice(0, 15).map(({ rawLog, parsed }) => `
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                  <div>
                    <div class="font-extrabold text-xs text-slate-900">
                      ${parsed.bookTitle || stuCourse} ${parsed.page ? `&bull; Page ${parsed.page}` : ''}
                    </div>
                    <div class="text-[11px] text-slate-600 mt-0.5">${parsed.remarks || 'Completed daily lesson satisfactorily.'}</div>
                  </div>
                  <div class="text-right shrink-0">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold ${String(parsed.assessment || '').toLowerCase() === 'pass' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                      ${parsed.assessment || 'Completed'}
                    </span>
                    <div class="text-[10px] font-mono text-slate-400 mt-0.5">${rawLog.date || '--'}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // TAB 6: FEES & FINANCIAL INFORMATION (SYNCHRONIZED WITH FAMILY LEDGER)
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'fees') {
    tabBodyHtml = `
      <div class="space-y-4">
        <!-- Clear Family-Level Fee Relationship Notice -->
        <div class="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-50 to-amber-50/70 border border-emerald-200 flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-emerald-700 text-white flex items-center justify-center font-black">
              <i class="fa-solid fa-file-invoice-dollar"></i>
            </div>
            <div>
              <div class="text-xs font-black text-slate-900">
                Family-Level Fee Account: <button onclick="openFamily360Profile('${family?.id || ''}')" class="text-emerald-800 underline hover:text-emerald-950">${family?.parent_name || 'Parent'} (${family?.id || 'N/A'})</button>
              </div>
              <p class="text-[11px] text-slate-600">
                Tuition fees in Al-Huda LMS are maintained at the <strong>Family/Parent level</strong> (${familyStudents.length} enrolled child${familyStudents.length === 1 ? '' : 'ren'}). All payments and receipts below are synchronized live with the Family Fee Ledger.
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            ${family ? `
              <button onclick="openFamily360Profile('${family.id}', 'financials')" class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-extrabold transition shadow-xs">
                Open Family Financial 360°
              </button>
              <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-invoices'); if (typeof openFamilyAnnualLedgerModal === 'function') openFamilyAnnualLedgerModal('${family.id}');" class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-extrabold transition shadow-xs">
                Open Fee Billing Ledger
              </button>
            ` : ''}
          </div>
        </div>

        <!-- 4 Financial KPI Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-slate-400 block">Agreed Family Fee</span>
            <strong class="text-base font-black text-slate-900">${fin.currency} ${fin.agreedMonthlyFee.toFixed(2)}</strong>
            <span class="text-[10px] text-slate-500 block">Per Month (${familyStudents.length} Student${familyStudents.length === 1 ? '' : 's'})</span>
          </div>
          <div class="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-emerald-700 block">Total Paid</span>
            <strong class="text-base font-black text-emerald-800">${fin.currency} ${fin.totalPaid.toFixed(2)}</strong>
            <span class="text-[10px] text-emerald-600 block">${fin.receipts.length} Verified Receipt(s)</span>
          </div>
          <div class="p-3.5 bg-rose-50 rounded-2xl border border-rose-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-rose-700 block">Pending / Unpaid</span>
            <strong class="text-base font-black text-rose-800">${fin.currency} ${fin.totalPending.toFixed(2)}</strong>
            <span class="text-[10px] text-rose-600 block">Current Outstanding</span>
          </div>
          <div class="p-3.5 bg-cyan-50 rounded-2xl border border-cyan-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-cyan-700 block">Advance Credit</span>
            <strong class="text-base font-black text-cyan-900">${fin.currency} ${fin.advanceCredit.toFixed(2)}</strong>
            <span class="text-[10px] text-cyan-700 block">Available Wallet</span>
          </div>
        </div>

        <!-- 12-Month Status Pills -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
          <div class="text-xs font-black uppercase tracking-wider text-slate-700 mb-2.5">2026 Monthly Tuition Status (${family?.id || ''})</div>
          <div class="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
            ${fin.monthsStatus.map(m => {
              let cls = 'bg-rose-50 border-rose-200 text-rose-800';
              let lbl = 'Due';
              if (m.isPaid) { cls = 'bg-emerald-50 border-emerald-300 text-emerald-800'; lbl = 'Paid'; }
              else if (m.isPartial) { cls = 'bg-amber-50 border-amber-300 text-amber-800'; lbl = 'Partial'; }
              else if (m.isLeave) { cls = 'bg-blue-50 border-blue-200 text-blue-800'; lbl = 'Leave'; }
              else if (m.isNotEnrolled) { cls = 'bg-slate-50 border-slate-200 text-slate-400'; lbl = 'N/A'; }
              else if (m.isFuture) { cls = 'bg-slate-50 border-slate-100 text-slate-300'; lbl = 'Upcoming'; }
              return `
                <div class="p-2 rounded-xl border ${cls} text-center">
                  <div class="text-[10px] font-black">${m.month.slice(0, 3)}</div>
                  <div class="text-[9px] font-bold mt-0.5">${lbl}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Payment Receipts History Table -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div class="p-3.5 bg-slate-50 border-b border-slate-200 font-black text-xs text-slate-800">
            Payment Receipts &amp; Transaction Ledger (${fin.receipts.length})
          </div>
          ${fin.receipts.length === 0 ? `
            <div class="p-6 text-center text-slate-400 text-xs">No fee payment receipts recorded yet for this family.</div>
          ` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th class="p-3">Receipt #</th>
                    <th class="p-3">Payment Date</th>
                    <th class="p-3">Billing Month</th>
                    <th class="p-3">Amount Paid</th>
                    <th class="p-3">Balance</th>
                    <th class="p-3">Method</th>
                    <th class="p-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${fin.receipts.map(r => `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="p-3 font-mono font-bold text-slate-800">${r.receiptNo || '--'}</td>
                      <td class="p-3 font-mono text-slate-600">${r.date || '--'}</td>
                      <td class="p-3 font-bold text-slate-900">${r.month || ''} ${r.year || ''}</td>
                      <td class="p-3 font-mono font-extrabold text-emerald-700">${r.currency || fin.currency} ${parseFloat(r.amountPaid || 0).toFixed(2)}</td>
                      <td class="p-3 font-mono text-rose-700">${r.currency || fin.currency} ${parseFloat(r.remainingBalance || 0).toFixed(2)}</td>
                      <td class="p-3 text-slate-600">${r.paymentMethod || 'Online'}</td>
                      <td class="p-3 text-right"><span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">${r.status || 'Paid'}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  }

  // Assemble Complete Student 360° View
  contentBox.innerHTML = `
    <!-- HERO HEADER -->
    <div class="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white rounded-2xl shadow-md mb-4">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex items-start sm:items-center gap-3.5">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-600 text-slate-950 font-black text-xl flex items-center justify-center shadow-md shrink-0">
            ${(student.name || 'S').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2 py-0.5 rounded bg-teal-500/20 border border-teal-400/40 text-teal-200 font-mono text-[10px] font-black">${student.id}</span>
              <h2 class="text-lg sm:text-xl font-black tracking-tight text-white">${student.name}</h2>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">${stuStatus}</span>
            </div>
            <div class="flex items-center gap-3 flex-wrap text-xs text-slate-300 mt-1.5">
              ${family ? `
                <button onclick="openFamily360Profile('${family.id}')" class="hover:text-amber-300 transition flex items-center gap-1 font-bold">
                  <i class="fa-solid fa-house-user text-amber-400"></i> Family: <span class="underline">${family.parent_name} (${family.id})</span>
                </button>
              ` : ''}
              <span>&bull;</span>
              ${assignedTeacher ? `
                <button onclick="openTeacher360Profile('${assignedTeacher.id}')" class="hover:text-amber-300 transition flex items-center gap-1 font-bold">
                  <i class="fa-solid fa-chalkboard-user text-indigo-300"></i> Teacher: <span class="underline">${assignedTeacher.full_name}</span>
                </button>
              ` : '<span>Teacher: Unassigned</span>'}
              <span>&bull;</span>
              <span><i class="fa-solid fa-calendar-check text-emerald-400 mr-1"></i>Joined: ${student.joining_date || 'N/A'}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          ${cleanPhone && window.CURRENT_ROLE !== 'manager' ? `
            <a href="https://wa.me/${cleanPhone}" target="_blank" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-xs transition">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp Parent
            </a>
          ` : ''}
          ${family ? `
            <button onclick="openFamily360Profile('${family.id}')" class="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/15 font-extrabold text-xs flex items-center gap-1.5 transition">
              <i class="fa-solid fa-people-roof text-amber-300"></i> Family 360°
            </button>
          ` : ''}
          ${assignedTeacher ? `
            <button onclick="openTeacher360Profile('${assignedTeacher.id}')" class="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/15 font-extrabold text-xs flex items-center gap-1.5 transition">
              <i class="fa-solid fa-chalkboard-user text-indigo-300"></i> Teacher 360°
            </button>
          ` : ''}
        </div>
      </div>
    </div>

    <!-- SUB-NAVIGATION TABS -->
    <div class="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 border-b border-slate-200">
      ${tabsConfig.map(t => {
        const isActive = _CURRENT_360_STATE.activeTab === t.id;
        return `
          <button onclick="openStudent360Profile('${student.id}', '${t.id}', true)"
                  class="px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap flex items-center gap-1.5 transition ${isActive ? 'bg-brandDark text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
            <i class="fa-solid ${t.icon} ${isActive ? 'text-brandGold' : 'text-slate-500'}"></i>
            <span>${t.label}</span>
            ${t.badge !== null ? `<span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono ${isActive ? 'bg-white/20 text-white' : 'bg-white text-slate-700'}">${t.badge}</span>` : ''}
          </button>
        `;
      }).join('')}
    </div>

    <!-- ACTIVE TAB CONTENT -->
    <div>${tabBodyHtml}</div>
  `;
}

// ============================================================================
// 2. FAMILY / PARENT 360° UNIFIED PROFILE
// ============================================================================
async function openFamily360Profile(familyId, initialTab = 'overview', skipHistoryPush = false) {
  if (!familyId) return;

  const modal = document.getElementById('modalUnified360Profile');
  const contentBox = document.getElementById('unified360BodyContainer');
  if (!modal || !contentBox) return;

  openModal('modalUnified360Profile');
  contentBox.innerHTML = `
    <div class="p-12 text-center text-slate-500">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-brandEmerald mb-2 block"></i>
      <span class="text-xs font-extrabold">Loading Complete Family / Parent 360° Profile...</span>
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
    contentBox.innerHTML = `<div class="p-8 text-center text-rose-600 font-bold text-sm">Family record (${familyId}) could not be found.</div>`;
    return;
  }

  _CURRENT_360_STATE.type = 'family';
  _CURRENT_360_STATE.id = family.id;
  _CURRENT_360_STATE.activeTab = initialTab || 'overview';

  if (!skipHistoryPush) {
    _push360History('family', family.id, `${family.parent_name} (${family.id})`, _CURRENT_360_STATE.activeTab);
  }
  _render360BreadcrumbBar();

  // Retrieve all students belonging to this family
  const familyStudents = (window.ALL_STUDENTS || []).filter(s =>
    String(s.family_id || '').toUpperCase() === String(family.id).toUpperCase() &&
    String(s.status || '').toLowerCase() !== 'trial'
  );
  const studentIds = familyStudents.map(s => s.id);

  // Fetch schedules & attendance logs for all family students in parallel
  const [schedRes, logsRes] = await Promise.all([
    studentIds.length > 0 ? db.from('class_schedules').select('*, teachers(*)').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length > 0 ? db.from('attendance_logs').select('*').in('student_id', studentIds).order('date', { ascending: false }).limit(80) : Promise.resolve({ data: [] })
  ]);

  const famSchedules = schedRes.data || [];
  const famLogs = logsRes.data || [];

  // Financial Snapshot from existing Fee Engine
  const fin = _getFamilyFinancialSnapshot(family);

  // Parent Portal Credentials
  const creds = (typeof getParentCreds === 'function') ? getParentCreds(family) : { username: 'parent_' + family.id, password: '***' };

  const rawPhone = family.whatsapp || '';
  const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  const displayPhone = (window.CURRENT_ROLE === 'manager' && typeof maskStudentPhone === 'function')
    ? maskStudentPhone(rawPhone)
    : (rawPhone || 'Not Provided');
  const displayEmail = (window.CURRENT_ROLE === 'manager' && typeof maskStudentEmail === 'function')
    ? maskStudentEmail(family.parent_email || '')
    : (family.parent_email || 'Not Provided');

  // Family Attendance Rate
  const totalFamLogs = famLogs.length;
  const famPresentLogs = famLogs.filter(l => ['present', 'late', 'completed'].includes(String(l.status || '').toLowerCase())).length;
  const famAttendanceRate = totalFamLogs > 0 ? Math.round((famPresentLogs / totalFamLogs) * 100) : 100;

  const tabsConfig = [
    { id: 'overview',   label: 'Family Overview & Info',       icon: 'fa-house-user',          badge: null },
    { id: 'students',   label: 'Family Students & Teachers',   icon: 'fa-children',            badge: familyStudents.length },
    { id: 'financials', label: 'Financial Overview & Ledger',  icon: 'fa-file-invoice-dollar', badge: `${fin.currency} ${fin.agreedMonthlyFee}` },
    { id: 'academics',  label: 'Consolidated Classes & Logs',  icon: 'fa-book-open-reader',    badge: famSchedules.length }
  ];

  let tabBodyHtml = '';

  // =========================================================================
  // TAB 1: FAMILY BASIC INFORMATION & CONSOLIDATED OVERVIEW
  // =========================================================================
  if (_CURRENT_360_STATE.activeTab === 'overview') {
    tabBodyHtml = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Family Basic Information -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <i class="fa-solid fa-address-card text-emerald-600"></i> Family Basic Information
            </h4>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200">${family.status || 'Active'}</span>
          </div>
          <div class="grid grid-cols-2 gap-2.5 text-xs">
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100 col-span-2">
              <span class="text-[10px] text-slate-400 font-bold block">Parent / Guardian Name</span>
              <strong class="text-slate-900 font-extrabold text-sm">${family.parent_name}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Family ID</span>
              <strong class="text-brandDark font-mono font-black">${family.id}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Registration Date</span>
              <strong class="text-slate-800 font-mono">${family.created_at ? family.created_at.slice(0, 10) : '2026-01-01'}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">WhatsApp / Phone</span>
              <strong class="text-slate-800 font-mono">${displayPhone}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Country / Address</span>
              <strong class="text-slate-800">${family.country || 'Global'} ${family.notes ? `(${family.notes})` : ''}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100 col-span-2">
              <span class="text-[10px] text-slate-400 font-bold block">Parent Email</span>
              <strong class="text-slate-800 font-mono">${displayEmail}</strong>
            </div>
          </div>

          <!-- Parent Portal Credentials -->
          <div class="p-3 rounded-xl bg-gradient-to-r from-emerald-50 to-amber-50 border border-emerald-200 space-y-1.5">
            <div class="flex items-center justify-between text-[10px] font-black uppercase text-emerald-900">
              <span><i class="fa-solid fa-key text-amber-500 mr-1"></i>Parent Portal Access</span>
              <button onclick="copyParentCredentials('${creds.username}', '${creds.password}')" class="text-emerald-700 hover:underline">Copy</button>
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs font-mono">
              <div class="bg-white px-2 py-1 rounded border border-slate-200 truncate"><span class="text-[9px] text-slate-400 block">User:</span><strong>${creds.username}</strong></div>
              <div class="bg-white px-2 py-1 rounded border border-slate-200 truncate"><span class="text-[9px] text-slate-400 block">Pass:</span><strong>${creds.password}</strong></div>
            </div>
          </div>
        </div>

        <!-- Family Students Quick Cards -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between space-y-3">
          <div class="space-y-3">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <i class="fa-solid fa-children text-teal-600"></i> Enrolled Students (${familyStudents.length})
              </h4>
              <button onclick="closeModal('modalUnified360Profile'); prepareAddStudentModal('${family.id}')" class="text-emerald-700 hover:text-emerald-900 font-extrabold text-[11px]">
                + Add Child
              </button>
            </div>
            ${familyStudents.length === 0 ? `
              <div class="p-6 text-center text-slate-400 text-xs">No students enrolled under this family yet.</div>
            ` : `
              <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
                ${familyStudents.map(stu => {
                  const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(stu.assigned_teacher_id));
                  const stuSchedCount = famSchedules.filter(sc => String(sc.student_id) === String(stu.id)).length;
                  return `
                    <div class="p-3 rounded-xl bg-slate-50 hover:bg-teal-50/50 border border-slate-200 hover:border-teal-300 transition space-y-1.5">
                      <div class="flex items-center justify-between">
                        <button onclick="openStudent360Profile('${stu.id}')" class="font-extrabold text-xs text-slate-900 hover:text-teal-800 hover:underline flex items-center gap-1.5">
                          <i class="fa-solid fa-user-graduate text-teal-600"></i> ${stu.name}
                          <span class="px-1.5 py-0.2 rounded bg-white border border-slate-200 font-mono text-[9px] text-slate-700">${stu.id}</span>
                        </button>
                        <button onclick="openStudent360Profile('${stu.id}')" class="px-2 py-0.5 rounded-lg bg-brandDark text-white text-[10px] font-bold">
                          Student 360° &rarr;
                        </button>
                      </div>
                      <div class="flex items-center justify-between text-[10px] text-slate-500">
                        <span>Course: <strong class="text-slate-700">${stu.course_id || 'Quran Studies'}</strong></span>
                        <span>Joined: <strong class="font-mono">${stu.joining_date || '--'}</strong></span>
                      </div>
                      <div class="flex items-center justify-between text-[10px] text-slate-600 pt-1 border-t border-slate-200/70">
                        <span>
                          Teacher:
                          ${tObj ? `<button onclick="openTeacher360Profile('${tObj.id}')" class="font-bold text-indigo-700 hover:underline">${tObj.full_name}</button>` : '<span class="text-slate-400">Unassigned</span>'}
                        </span>
                        <span class="font-bold text-emerald-700">${stuSchedCount} Slot(s)/wk</span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
          <button onclick="openFamily360Profile('${family.id}', 'students', true)" class="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-[11px] font-extrabold transition">
            Inspect Full Student Roster &amp; Teachers &rarr;
          </button>
        </div>

        <!-- Family Financial & Academic Snapshot -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between space-y-3">
          <div class="space-y-3">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <i class="fa-solid fa-coins text-amber-500"></i> Financial &amp; Academic Pulse
              </h4>
              <button onclick="openFamily360Profile('${family.id}', 'financials', true)" class="text-emerald-700 hover:underline font-extrabold text-[11px]">
                Full Ledger &rarr;
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2.5 text-xs">
              <div class="p-3 rounded-xl bg-slate-900 text-white">
                <span class="text-[10px] text-slate-300 block">Agreed Monthly Fee</span>
                <strong class="text-base font-black text-amber-300">${fin.currency} ${fin.agreedMonthlyFee.toFixed(2)}</strong>
              </div>
              <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <span class="text-[10px] text-emerald-700 font-bold block">Total Paid</span>
                <strong class="text-base font-black text-emerald-900">${fin.currency} ${fin.totalPaid.toFixed(2)}</strong>
              </div>
              <div class="p-3 rounded-xl bg-rose-50 border border-rose-200">
                <span class="text-[10px] text-rose-700 font-bold block">Total Pending</span>
                <strong class="text-base font-black text-rose-900">${fin.currency} ${fin.totalPending.toFixed(2)}</strong>
              </div>
              <div class="p-3 rounded-xl bg-teal-50 border border-teal-200">
                <span class="text-[10px] text-teal-700 font-bold block">Family Attendance</span>
                <strong class="text-base font-black text-teal-900">${famAttendanceRate}%</strong>
              </div>
            </div>

            <!-- Mini 12-Month Grid -->
            <div>
              <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">2026 Monthly Fee Tracker</span>
              <div class="grid grid-cols-4 gap-1.5">
                ${fin.monthsStatus.map(m => {
                  const badge = m.isPaid ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : m.isPartial ? 'bg-amber-100 text-amber-800 border-amber-300'
                              : m.isNotEnrolled || m.isFuture ? 'bg-slate-50 text-slate-400 border-slate-200'
                              : 'bg-rose-50 text-rose-800 border-rose-200';
                  return `
                    <div class="px-2 py-1 rounded-lg border ${badge} text-[10px] font-bold flex items-center justify-between">
                      <span>${m.month.slice(0, 3)}</span>
                      <i class="fa-solid ${m.isPaid ? 'fa-check text-emerald-600' : (m.isNotEnrolled || m.isFuture ? 'fa-minus text-slate-300' : 'fa-clock text-rose-500')} text-[9px]"></i>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>

          <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-invoices'); if (typeof openFamilyAnnualLedgerModal === 'function') openFamilyAnnualLedgerModal('${family.id}');"
                  class="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-extrabold transition shadow-xs">
            <i class="fa-solid fa-receipt mr-1"></i> Collect Fee / Open Billing Ledger
          </button>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // TAB 2: FAMILY STUDENTS & ASSIGNED TEACHERS TABLE
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'students') {
    tabBodyHtml = `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div class="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h4 class="font-black text-sm text-slate-900 flex items-center gap-2">
              <i class="fa-solid fa-children text-teal-600"></i> All Students Belonging to ${family.parent_name} (${family.id})
            </h4>
            <p class="text-[11px] text-slate-500">Click any student to open their Student 360° Profile, or click their teacher to open the Teacher 360° Profile</p>
          </div>
          <button onclick="closeModal('modalUnified360Profile'); prepareAddStudentModal('${family.id}')" class="px-3 py-1.5 bg-brandEmerald hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold transition shadow-xs">
            + Enroll Another Child
          </button>
        </div>
        ${familyStudents.length === 0 ? `
          <div class="p-8 text-center text-slate-400 text-xs">No students registered in this family.</div>
        ` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th class="p-3">Student ID</th>
                  <th class="p-3">Student Name</th>
                  <th class="p-3">Enrolled Course</th>
                  <th class="p-3">Assigned Teacher</th>
                  <th class="p-3">Weekly Classes</th>
                  <th class="p-3">Joining Date</th>
                  <th class="p-3">Status</th>
                  <th class="p-3 text-right">360° Navigation</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${familyStudents.map(s => {
                  const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(s.assigned_teacher_id));
                  const sScheds = famSchedules.filter(sc => String(sc.student_id) === String(s.id));
                  const schedSummary = sScheds.length > 0
                    ? `${sScheds.length} Slot(s) (${(sScheds[0].start_time || '').slice(0,5)} PKT)`
                    : 'No slots booked';
                  return `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="p-3 font-mono font-black text-brandDark">${s.id}</td>
                      <td class="p-3">
                        <button onclick="openStudent360Profile('${s.id}')" class="font-extrabold text-slate-900 hover:text-brandEmerald hover:underline text-left">
                          ${s.name}
                        </button>
                      </td>
                      <td class="p-3"><span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[11px]">${s.course_id || 'Quran Studies'}</span></td>
                      <td class="p-3">
                        ${tObj ? `
                          <button onclick="openTeacher360Profile('${tObj.id}')" class="font-bold text-indigo-700 hover:underline flex items-center gap-1">
                            <i class="fa-solid fa-chalkboard-user text-xs"></i> ${tObj.full_name}
                          </button>
                        ` : '<span class="text-slate-400 italic">Not Assigned</span>'}
                      </td>
                      <td class="p-3 font-mono text-[11px] text-slate-700">${schedSummary}</td>
                      <td class="p-3 font-mono text-[11px] text-slate-600">${s.joining_date || '--'}</td>
                      <td class="p-3"><span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">${s.status || 'Active'}</span></td>
                      <td class="p-3 text-right">
                        <div class="inline-flex items-center gap-1.5">
                          <button onclick="openStudent360Profile('${s.id}')" class="px-2.5 py-1 bg-brandDark hover:bg-brandDarkest text-white rounded-lg font-bold text-[11px]">
                            Student 360°
                          </button>
                          ${tObj ? `
                            <button onclick="openTeacher360Profile('${tObj.id}')" class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-lg font-bold text-[11px]">
                              Teacher 360°
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

  // =========================================================================
  // TAB 3: FAMILY FINANCIAL OVERVIEW & COMPLETE FEE LEDGER
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'financials') {
    tabBodyHtml = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-slate-400 block">Total Agreed Monthly Fee</span>
            <strong class="text-lg font-black text-slate-900">${fin.currency} ${fin.agreedMonthlyFee.toFixed(2)}</strong>
          </div>
          <div class="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-emerald-700 block">Total Amount Paid</span>
            <strong class="text-lg font-black text-emerald-800">${fin.currency} ${fin.totalPaid.toFixed(2)}</strong>
          </div>
          <div class="p-3.5 bg-rose-50 rounded-2xl border border-rose-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-rose-700 block">Total Amount Pending</span>
            <strong class="text-lg font-black text-rose-800">${fin.currency} ${fin.totalPending.toFixed(2)}</strong>
          </div>
          <div class="p-3.5 bg-cyan-50 rounded-2xl border border-cyan-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-cyan-700 block">Advance Credit Balance</span>
            <strong class="text-lg font-black text-cyan-900">${fin.currency} ${fin.advanceCredit.toFixed(2)}</strong>
          </div>
        </div>

        <!-- 12-Month Payment History Grid -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
          <div class="flex items-center justify-between mb-3">
            <h4 class="font-black text-xs uppercase tracking-wider text-slate-800">12-Month Payment Status (2026)</h4>
            <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-invoices'); if (typeof selectFeeFamily === 'function') selectFeeFamily('${family.id}');"
                    class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-extrabold transition">
              + Record Fee Payment
            </button>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
            ${fin.monthsStatus.map(m => {
              let cardStyle = 'bg-rose-50/70 border-rose-200';
              let badgeHtml = '<span class="text-rose-700 font-extrabold text-[10px]">Due</span>';
              if (m.isPaid) { cardStyle = 'bg-emerald-50/80 border-emerald-300'; badgeHtml = '<span class="text-emerald-700 font-extrabold text-[10px]">✓ Paid</span>'; }
              else if (m.isPartial) { cardStyle = 'bg-amber-50 border-amber-300'; badgeHtml = '<span class="text-amber-800 font-extrabold text-[10px]">Partial</span>'; }
              else if (m.isNotEnrolled) { cardStyle = 'bg-slate-50 border-slate-200'; badgeHtml = '<span class="text-slate-400 font-bold text-[10px]">N/A</span>'; }
              else if (m.isFuture) { cardStyle = 'bg-slate-50/50 border-slate-100'; badgeHtml = '<span class="text-slate-300 text-[10px]">Upcoming</span>'; }
              return `
                <div class="p-3 rounded-xl border ${cardStyle}">
                  <div class="flex items-center justify-between border-b border-black/5 pb-1">
                    <span class="font-black text-xs text-slate-800">${m.month}</span>
                    ${badgeHtml}
                  </div>
                  <div class="text-[10px] text-slate-600 mt-1 font-mono">
                    ${m.isPaid || m.isPartial ? `Paid: ${fin.currency} ${parseFloat(m.amountPaid || 0).toFixed(0)}` : (m.isNotEnrolled ? 'Not Enrolled' : (m.isFuture ? 'Future Month' : `Due: ${fin.currency} ${fin.agreedMonthlyFee}`))}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Complete Family Fee Ledger Table -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div class="p-3.5 bg-slate-50 border-b border-slate-200 font-black text-xs text-slate-800">
            Complete Family Fee Ledger &amp; Payment Receipts (${fin.receipts.length})
          </div>
          ${fin.receipts.length === 0 ? `
            <div class="p-8 text-center text-slate-400 text-xs">No fee receipts recorded yet for ${family.parent_name}.</div>
          ` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th class="p-3">Receipt No</th>
                    <th class="p-3">Payment Date</th>
                    <th class="p-3">Billing Period</th>
                    <th class="p-3">Amount Paid</th>
                    <th class="p-3">Remaining Balance</th>
                    <th class="p-3">Payment Method</th>
                    <th class="p-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${fin.receipts.map(r => `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="p-3 font-mono font-bold text-slate-800">${r.receiptNo || '--'}</td>
                      <td class="p-3 font-mono text-slate-600">${r.date || '--'}</td>
                      <td class="p-3 font-bold text-slate-900">${r.month || ''} ${r.year || ''}</td>
                      <td class="p-3 font-mono font-extrabold text-emerald-700">${r.currency || fin.currency} ${parseFloat(r.amountPaid || 0).toFixed(2)}</td>
                      <td class="p-3 font-mono text-rose-700">${r.currency || fin.currency} ${parseFloat(r.remainingBalance || 0).toFixed(2)}</td>
                      <td class="p-3 text-slate-600">${r.paymentMethod || 'Online'}</td>
                      <td class="p-3 text-right"><span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">${r.status || 'Paid'}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // TAB 4: CONSOLIDATED FAMILY CLASSES, LESSONS & ATTENDANCE
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'academics') {
    tabBodyHtml = `
      <div class="space-y-4">
        <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div class="p-3.5 bg-slate-50 border-b border-slate-200 font-black text-xs text-slate-800">
            Recent Lessons &amp; Attendance Across All Children (${famLogs.length})
          </div>
          ${famLogs.length === 0 ? `
            <div class="p-8 text-center text-slate-400 text-xs">No attendance or lesson records logged for this family's children yet.</div>
          ` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th class="p-3">Date</th>
                    <th class="p-3">Child / Student</th>
                    <th class="p-3">Attendance</th>
                    <th class="p-3">Lesson / Sabaq Studied</th>
                    <th class="p-3">Teacher</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${famLogs.slice(0, 30).map(log => {
                    const stuObj = familyStudents.find(s => String(s.id) === String(log.student_id));
                    const tObj = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(log.teacher_id));
                    const parsed = _parseLessonLogEntry(log);
                    return `
                      <tr class="hover:bg-slate-50 transition">
                        <td class="p-3 font-mono font-bold text-slate-800">${log.date || '--'}</td>
                        <td class="p-3">
                          ${stuObj ? `<button onclick="openStudent360Profile('${stuObj.id}')" class="font-extrabold text-teal-800 hover:underline">${stuObj.name}</button>` : log.student_id}
                        </td>
                        <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">${log.status || 'Present'}</span></td>
                        <td class="p-3 text-slate-700">${parsed.bookTitle ? `<strong>${parsed.bookTitle}</strong> ${parsed.page ? `(Pg ${parsed.page})` : ''} ${parsed.remarks ? `— ${parsed.remarks}` : ''}` : (parsed.remarks || '--')}</td>
                        <td class="p-3">${tObj ? `<button onclick="openTeacher360Profile('${tObj.id}')" class="font-bold text-indigo-700 hover:underline">${tObj.full_name}</button>` : '--'}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  }

  contentBox.innerHTML = `
    <!-- FAMILY HERO HEADER -->
    <div class="p-4 sm:p-5 bg-gradient-to-r from-emerald-950 via-teal-900 to-slate-900 text-white rounded-2xl shadow-md mb-4">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex items-start sm:items-center gap-3.5">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-300 to-emerald-500 text-slate-950 font-black text-xl flex items-center justify-center shadow-md shrink-0">
            <i class="fa-solid fa-house-user"></i>
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2 py-0.5 rounded bg-amber-400/20 border border-amber-300/40 text-amber-200 font-mono text-[10px] font-black">${family.id}</span>
              <h2 class="text-lg sm:text-xl font-black tracking-tight text-white">${family.parent_name}</h2>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">${family.status || 'Active'}</span>
            </div>
            <div class="flex items-center gap-3 flex-wrap text-xs text-slate-200 mt-1.5">
              <span><i class="fa-solid fa-earth-americas text-amber-300 mr-1"></i>${family.country || 'International'}</span>
              <span>&bull;</span>
              <span class="font-mono"><i class="fa-brands fa-whatsapp text-emerald-400 mr-1"></i>${displayPhone}</span>
              <span>&bull;</span>
              <span><i class="fa-solid fa-children text-teal-300 mr-1"></i><strong>${familyStudents.length}</strong> Enrolled Student(s)</span>
              <span>&bull;</span>
              <span><i class="fa-solid fa-coins text-amber-300 mr-1"></i>Agreed Fee: <strong>${fin.currency} ${fin.agreedMonthlyFee}</strong>/mo</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          ${cleanPhone && window.CURRENT_ROLE !== 'manager' ? `
            <a href="https://wa.me/${cleanPhone}" target="_blank" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-xs transition">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp Family
            </a>
          ` : ''}
          <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-invoices'); if (typeof openFamilyAnnualLedgerModal === 'function') openFamilyAnnualLedgerModal('${family.id}');"
                  class="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-xs transition">
            <i class="fa-solid fa-file-invoice-dollar"></i> Open Fee Ledger
          </button>
        </div>
      </div>
    </div>

    <!-- SUB-NAVIGATION TABS -->
    <div class="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 border-b border-slate-200">
      ${tabsConfig.map(t => {
        const isActive = _CURRENT_360_STATE.activeTab === t.id;
        return `
          <button onclick="openFamily360Profile('${family.id}', '${t.id}', true)"
                  class="px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap flex items-center gap-1.5 transition ${isActive ? 'bg-brandDark text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
            <i class="fa-solid ${t.icon} ${isActive ? 'text-brandGold' : 'text-slate-500'}"></i>
            <span>${t.label}</span>
            ${t.badge !== null ? `<span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono ${isActive ? 'bg-white/20 text-white' : 'bg-white text-slate-700'}">${t.badge}</span>` : ''}
          </button>
        `;
      }).join('')}
    </div>

    <div>${tabBodyHtml}</div>
  `;
}

// ============================================================================
// 3. TEACHER 360° UNIFIED PROFILE
// ============================================================================
async function openTeacher360Profile(teacherId, initialTab = 'overview', skipHistoryPush = false) {
  if (!teacherId) return;
  window.CURRENT_MODAL_TEACHER_ID = teacherId;

  const modal = document.getElementById('modalUnified360Profile');
  const contentBox = document.getElementById('unified360BodyContainer');
  if (!modal || !contentBox) return;

  openModal('modalUnified360Profile');
  contentBox.innerHTML = `
    <div class="p-12 text-center text-slate-500">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-600 mb-2 block"></i>
      <span class="text-xs font-extrabold">Loading Complete Teacher 360° Profile...</span>
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
    contentBox.innerHTML = `<div class="p-8 text-center text-rose-600 font-bold text-sm">Teacher record (${teacherId}) could not be found.</div>`;
    return;
  }

  _CURRENT_360_STATE.type = 'teacher';
  _CURRENT_360_STATE.id = teacher.id;
  _CURRENT_360_STATE.activeTab = initialTab || 'overview';

  const accounts = (typeof getTeacherAccounts === 'function') ? getTeacherAccounts() : {};
  const acc = accounts[teacher.id] || {};
  const creds = (typeof getTeacherCreds === 'function') ? getTeacherCreds(teacher) : { teacher_id: teacher.id, username: 'teacher', password: '***' };

  if (!skipHistoryPush) {
    _push360History('teacher', teacher.id, `${teacher.full_name} (${creds.teacher_id})`, _CURRENT_360_STATE.activeTab);
  }
  _render360BreadcrumbBar();

  // Fetch Teacher's Class Schedules & Recent Attendance/Lesson Logs
  const [schedRes, logsRes] = await Promise.all([
    db.from('class_schedules').select('*, students(*)').eq('teacher_id', teacher.id),
    db.from('attendance_logs').select('*').eq('teacher_id', teacher.id).order('date', { ascending: false }).limit(80)
  ]);

  const teacherSchedules = schedRes.data || [];
  const teacherLogs = logsRes.data || [];

  // Build deduplicated Assigned Students list (from both students.assigned_teacher_id and class_schedules)
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

  // Calculate Salary & Payroll Ledger using existing payroll.js functions
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
      : { baseRate: teacher.rate_per_slot || 2200, increment: teacherIncrement, finalRate: (teacher.rate_per_slot || 2200) + teacherIncrement, courseLabel: stu.course_id || 'Quran Course', scheduleText: `${stuScheds.length} Slots/wk` };

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

  // Build Historical & Current Monthly Salary Ledger Rows
  const payrollMonths = ['September 2026', 'August 2026', 'July 2026', 'June 2026', 'May 2026', 'April 2026'];
  // Also include any custom saved slips for this teacher
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
      paymentDate,
      remarks: slip?.remarks || ''
    };
  });

  const joiningDate = acc.joining_date || (teacher.created_at ? teacher.created_at.slice(0, 10) : '2025-01-01');
  const cleanPhone = (teacher.phone || '').replace(/[^0-9]/g, '');

  const tabsConfig = [
    { id: 'overview', label: 'Teacher Basic Info & Overview', icon: 'fa-chalkboard-user',     badge: creds.teacher_id },
    { id: 'students', label: 'Assigned Students & Families',  icon: 'fa-users-rectangle',     badge: assignedStudents.length },
    { id: 'teaching', label: 'Classes & Daily Lesson Logs',   icon: 'fa-calendar-check',      badge: teacherSchedules.length },
    { id: 'salary',   label: 'Salary & Payroll Ledger',       icon: 'fa-money-check-dollar',  badge: `${currNetPayable.toLocaleString()} PKR` }
  ];

  let tabBodyHtml = '';

  // =========================================================================
  // TAB 1: TEACHER BASIC INFORMATION & OVERVIEW
  // =========================================================================
  if (_CURRENT_360_STATE.activeTab === 'overview') {
    tabBodyHtml = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Teacher Basic Information -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <i class="fa-solid fa-id-badge text-indigo-600"></i> Teacher Basic Information
            </h4>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">${teacher.status || 'Active'}</span>
          </div>
          <div class="grid grid-cols-2 gap-2.5 text-xs">
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100 col-span-2">
              <span class="text-[10px] text-slate-400 font-bold block">Teacher Full Name</span>
              <strong class="text-slate-900 font-extrabold text-sm">${teacher.full_name}</strong>
              ${teacher.father_name ? `<span class="text-[11px] text-slate-500 block">S/O: ${teacher.father_name}</span>` : ''}
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Teacher ID</span>
              <strong class="text-indigo-900 font-mono font-black">${creds.teacher_id}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Joining Date</span>
              <strong class="text-slate-800 font-mono">${joiningDate}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">Primary Phone / WhatsApp</span>
              <strong class="text-slate-800 font-mono">${teacher.phone || '--'}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="text-[10px] text-slate-400 font-bold block">CNIC / National ID</span>
              <strong class="text-slate-800 font-mono">${acc.cnic || '--'}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100 col-span-2">
              <span class="text-[10px] text-slate-400 font-bold block">Qualification &amp; Working Shift</span>
              <strong class="text-slate-800">${acc.qualification || 'Quran & Tajweed Instructor'} &bull; ${teacher.working_shift || '10 Hours Shift'}</strong>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100 col-span-2">
              <span class="text-[10px] text-slate-400 font-bold block">Residential Address &amp; Witness</span>
              <strong class="text-slate-700">${teacher.address || 'Not Recorded'} ${teacher.witness_name ? `• Witness: ${teacher.witness_name} (${teacher.witness_phone || ''})` : ''}</strong>
            </div>
          </div>
        </div>

        <!-- Assigned Students & Families Quick Card -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between space-y-3">
          <div class="space-y-3">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <i class="fa-solid fa-user-graduate text-teal-600"></i> Assigned Students (${assignedStudents.length})
              </h4>
              <button onclick="openTeacher360Profile('${teacher.id}', 'students', true)" class="text-indigo-700 hover:underline font-extrabold text-[11px]">
                View All &rarr;
              </button>
            </div>

            ${assignedStudents.length === 0 ? `
              <div class="p-6 text-center text-slate-400 text-xs">No active students currently assigned to this teacher.</div>
            ` : `
              <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
                ${studentSalaryItems.map(item => `
                  <div class="p-2.5 rounded-xl bg-slate-50 hover:bg-indigo-50/50 border border-slate-200 transition flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <button onclick="openStudent360Profile('${item.student.id}')" class="font-extrabold text-xs text-slate-900 hover:text-brandEmerald hover:underline truncate">
                          ${item.student.name}
                        </button>
                        <span class="px-1.5 py-0.2 rounded bg-white border border-slate-200 font-mono text-[9px] font-bold">${item.student.id}</span>
                      </div>
                      <div class="text-[10px] text-slate-500 mt-0.5 truncate">
                        Family:
                        ${item.family ? `<button onclick="openFamily360Profile('${item.family.id}')" class="font-bold text-emerald-700 hover:underline">${item.family.parent_name} (${item.family.id})</button>` : (item.student.family_id || '--')}
                      </div>
                    </div>
                    <div class="text-right shrink-0">
                      <span class="font-mono font-extrabold text-[11px] text-indigo-900 block">${item.finalRate} PKR</span>
                      <button onclick="openStudent360Profile('${item.student.id}')" class="text-[10px] text-brandEmerald font-bold hover:underline">Student 360°</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-teachers'); open2DMatrixForTeacher('${teacher.id}')"
                  class="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold transition shadow-xs">
            <i class="fa-solid fa-table-cells mr-1"></i> Open Teacher 2D Weekly Timetable
          </button>
        </div>

        <!-- Salary & Teaching Summary Card -->
        <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between space-y-3">
          <div class="space-y-3">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <i class="fa-solid fa-money-check-dollar text-emerald-600"></i> Salary &amp; Payroll Snapshot
              </h4>
              <button onclick="openTeacher360Profile('${teacher.id}', 'salary', true)" class="text-emerald-700 hover:underline font-extrabold text-[11px]">
                Salary Ledger &rarr;
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2.5 text-xs">
              <div class="p-3 rounded-xl bg-slate-900 text-white col-span-2">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] text-slate-300 font-bold uppercase">${currentMonthLabel} Net Payable</span>
                  <span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${currStatus === 'Paid' ? 'bg-emerald-500 text-white' : 'bg-amber-400 text-slate-950'}">${currStatus}</span>
                </div>
                <strong class="text-xl font-black text-amber-300 block mt-1">${currNetPayable.toLocaleString()} PKR</strong>
                <span class="text-[10px] text-slate-300">Base: ${currentBaseSubtotal.toLocaleString()} PKR &bull; Seniority: +${teacherIncrement} PKR/stu</span>
              </div>
              <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                <span class="text-[10px] text-emerald-700 font-bold block">Total Salary Paid</span>
                <strong class="text-sm font-black text-emerald-900">${totalSalaryPaid.toLocaleString()} PKR</strong>
              </div>
              <div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                <span class="text-[10px] text-amber-800 font-bold block">Pending Salary</span>
                <strong class="text-sm font-black text-amber-900">${totalSalaryPending.toLocaleString()} PKR</strong>
              </div>
            </div>

            <!-- Teacher Portal Login Box -->
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="flex items-center justify-between text-[10px] font-black uppercase text-slate-600">
                <span><i class="fa-solid fa-key text-brandGold mr-1"></i>Teacher Portal Login</span>
                <button onclick="copyTeacherCredentials('${creds.username}', '${creds.password}', '${teacher.full_name}')" class="text-brandEmerald hover:underline">Copy</button>
              </div>
              <div class="grid grid-cols-2 gap-2 text-xs font-mono">
                <div class="bg-white px-2 py-1 rounded border border-slate-200"><span class="text-[9px] text-slate-400 block">User:</span><strong>${creds.username}</strong></div>
                <div class="bg-white px-2 py-1 rounded border border-slate-200"><span class="text-[9px] text-slate-400 block">Pass:</span><strong>${creds.password}</strong></div>
              </div>
            </div>
          </div>

          <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-salaries'); if (typeof calculateMonthlySalaries === 'function') calculateMonthlySalaries();"
                  class="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-extrabold transition shadow-xs">
            <i class="fa-solid fa-coins mr-1"></i> Open Payroll &amp; Salary Slips
          </button>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // TAB 2: ASSIGNED STUDENTS & INTERCONNECTED FAMILIES
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'students') {
    tabBodyHtml = `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div class="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h4 class="font-black text-sm text-slate-900 flex items-center gap-2">
              <i class="fa-solid fa-users-rectangle text-indigo-600"></i> All Students Assigned to ${teacher.full_name} (${assignedStudents.length})
            </h4>
            <p class="text-[11px] text-slate-500">Click any Student to open Student 360° Profile, or click any Family/Parent to open Family 360° Profile</p>
          </div>
        </div>
        ${studentSalaryItems.length === 0 ? `
          <div class="p-8 text-center text-slate-400 text-xs">No active students assigned to this teacher.</div>
        ` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th class="p-3">#</th>
                  <th class="p-3">Student Name &amp; ID</th>
                  <th class="p-3">Family / Parent (Clickable)</th>
                  <th class="p-3">Course &amp; Schedule</th>
                  <th class="p-3">Monthly Salary Rate</th>
                  <th class="p-3">Status</th>
                  <th class="p-3 text-right">360° Profiles</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${studentSalaryItems.map(item => `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="p-3 font-mono font-bold text-slate-400">${item.index}</td>
                    <td class="p-3">
                      <button onclick="openStudent360Profile('${item.student.id}')" class="font-extrabold text-slate-900 hover:text-brandEmerald hover:underline text-left block">
                        ${item.student.name}
                      </button>
                      <span class="font-mono text-[10px] text-slate-500">${item.student.id}</span>
                    </td>
                    <td class="p-3">
                      ${item.family ? `
                        <button onclick="openFamily360Profile('${item.family.id}')" class="font-extrabold text-emerald-800 hover:underline text-left block">
                          <i class="fa-solid fa-house-user text-emerald-600 mr-1"></i>${item.family.parent_name}
                        </button>
                        <span class="font-mono text-[10px] text-slate-500">${item.family.id} &bull; ${item.family.country || ''}</span>
                      ` : `<span class="text-slate-400">${item.student.family_id || '--'}</span>`}
                    </td>
                    <td class="p-3">
                      <span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-900 font-bold text-[11px] border border-indigo-200">${item.courseLabel}</span>
                      <div class="text-[10px] text-slate-500 mt-0.5">${item.scheduleText}</div>
                    </td>
                    <td class="p-3 font-mono font-extrabold text-emerald-700">
                      ${item.finalRate.toLocaleString()} PKR
                      <span class="block text-[9px] text-slate-400 font-normal">Base ${item.baseRate} + Inc ${item.increment}</span>
                    </td>
                    <td class="p-3">
                      <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">${item.student.status || 'Active'}</span>
                    </td>
                    <td class="p-3 text-right">
                      <div class="inline-flex items-center gap-1.5">
                        <button onclick="openStudent360Profile('${item.student.id}')" class="px-2.5 py-1 bg-brandDark hover:bg-brandDarkest text-white rounded-lg font-bold text-[11px]">
                          Student 360°
                        </button>
                        ${item.family ? `
                          <button onclick="openFamily360Profile('${item.family.id}')" class="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg font-bold text-[11px]">
                            Family 360°
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

  // =========================================================================
  // TAB 3: TEACHING, WEEKLY CLASSES & DAILY LESSON LOGS
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'teaching') {
    const sortedScheds = [...teacherSchedules].sort((a, b) => Number(a.day_of_week || 0) - Number(b.day_of_week || 0));
    tabBodyHtml = `
      <div class="space-y-4">
        <!-- Weekly Classes Table -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div class="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span class="font-black text-xs text-slate-800">Weekly Booked Class Schedule (${sortedScheds.length} Slots)</span>
            <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-teachers'); open2DMatrixForTeacher('${teacher.id}')" class="px-3 py-1 bg-indigo-600 text-white rounded-lg text-[11px] font-bold">
              Open 2D Matrix
            </button>
          </div>
          ${sortedScheds.length === 0 ? `
            <div class="p-6 text-center text-slate-400 text-xs">No weekly schedule slots booked yet.</div>
          ` : `
            <div class="overflow-x-auto max-h-64">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th class="p-2.5">Day</th>
                    <th class="p-2.5">Time (PKT)</th>
                    <th class="p-2.5">Student</th>
                    <th class="p-2.5">Family</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${sortedScheds.map(sc => {
                    const stObj = studentMap[sc.student_id] || sc.students;
                    const famObj = stObj ? (window.ALL_FAMILIES || []).find(f => String(f.id) === String(stObj.family_id)) : null;
                    return `
                      <tr class="hover:bg-slate-50">
                        <td class="p-2.5 font-bold text-slate-800">${_DAY_LABELS_360[Number(sc.day_of_week)] || `Day ${sc.day_of_week}`}</td>
                        <td class="p-2.5 font-mono font-bold text-indigo-900">${(sc.start_time || '').slice(0,5)} - ${(sc.end_time || '').slice(0,5)}</td>
                        <td class="p-2.5">${stObj ? `<button onclick="openStudent360Profile('${stObj.id}')" class="font-extrabold text-teal-800 hover:underline">${stObj.name}</button>` : sc.student_id}</td>
                        <td class="p-2.5">${famObj ? `<button onclick="openFamily360Profile('${famObj.id}')" class="font-bold text-emerald-700 hover:underline">${famObj.parent_name} (${famObj.id})</button>` : '--'}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <!-- Recent Daily Lesson & Attendance Logs Recorded by this Teacher -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div class="p-3.5 bg-slate-50 border-b border-slate-200 font-black text-xs text-slate-800">
            Recent Daily Lessons &amp; Attendance Logged by ${teacher.full_name} (${teacherLogs.length})
          </div>
          ${teacherLogs.length === 0 ? `
            <div class="p-6 text-center text-slate-400 text-xs">No daily lessons or attendance logs recorded by this teacher yet.</div>
          ` : `
            <div class="overflow-x-auto max-h-72">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th class="p-2.5">Date</th>
                    <th class="p-2.5">Student</th>
                    <th class="p-2.5">Attendance</th>
                    <th class="p-2.5">Lesson / Sabaq Recorded</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${teacherLogs.slice(0, 30).map(l => {
                    const stObj = (window.ALL_STUDENTS || []).find(s => String(s.id) === String(l.student_id));
                    const parsed = _parseLessonLogEntry(l);
                    return `
                      <tr class="hover:bg-slate-50">
                        <td class="p-2.5 font-mono font-bold text-slate-800">${l.date || '--'}</td>
                        <td class="p-2.5">${stObj ? `<button onclick="openStudent360Profile('${stObj.id}')" class="font-extrabold text-teal-800 hover:underline">${stObj.name}</button>` : l.student_id}</td>
                        <td class="p-2.5"><span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">${l.status || 'Present'}</span></td>
                        <td class="p-2.5 text-slate-600">${parsed.bookTitle ? `<strong>${parsed.bookTitle}</strong> ${parsed.page ? `(Pg ${parsed.page})` : ''} — ${parsed.remarks || parsed.assessment || ''}` : (parsed.remarks || '--')}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // TAB 4: SALARY INFORMATION & COMPLETE SALARY LEDGER
  // =========================================================================
  else if (_CURRENT_360_STATE.activeTab === 'salary') {
    tabBodyHtml = `
      <div class="space-y-4">
        <!-- 4 Salary Summary KPIs -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-slate-400 block">Agreed Rate &amp; Increment</span>
            <strong class="text-base font-black text-slate-900">${teacher.rate_per_slot || 2200} PKR/stu</strong>
            <span class="text-[10px] text-amber-700 font-bold block">Seniority: +${teacherIncrement} PKR/stu</span>
          </div>
          <div class="p-3.5 bg-indigo-50 rounded-2xl border border-indigo-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-indigo-700 block">${currentMonthLabel} Salary</span>
            <strong class="text-base font-black text-indigo-950">${currNetPayable.toLocaleString()} PKR</strong>
            <span class="text-[10px] text-indigo-600 block">${assignedStudents.length} Active Student(s)</span>
          </div>
          <div class="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-emerald-700 block">Total Amount Paid</span>
            <strong class="text-base font-black text-emerald-800">${totalSalaryPaid.toLocaleString()} PKR</strong>
            <span class="text-[10px] text-emerald-600 block">Disbursed Payroll</span>
          </div>
          <div class="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 shadow-2xs">
            <span class="text-[10px] font-bold uppercase text-amber-800 block">Amount Pending</span>
            <strong class="text-base font-black text-amber-900">${totalSalaryPending.toLocaleString()} PKR</strong>
            <span class="text-[10px] text-amber-700 block">Current Status: ${currStatus}</span>
          </div>
        </div>

        <!-- Complete Monthly Salary Ledger Table -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div class="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
            <span class="font-black text-xs text-slate-800">Complete Monthly Salary History &amp; Payroll Ledger</span>
            <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-salaries'); if (typeof calculateMonthlySalaries === 'function') calculateMonthlySalaries();"
                    class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-extrabold transition">
              Manage / Pay in Payroll Engine
            </button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-100 text-slate-600 font-black uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th class="p-3">Salary Month</th>
                  <th class="p-3">Assigned Students</th>
                  <th class="p-3">Base Subtotal</th>
                  <th class="p-3">Bonus / Deduction</th>
                  <th class="p-3">Net Payable Salary</th>
                  <th class="p-3">Payment Date</th>
                  <th class="p-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${salaryLedgerRows.map(row => `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="p-3 font-extrabold text-slate-900">${row.month}</td>
                    <td class="p-3 font-bold text-slate-700">${row.studentsCount} Student(s)</td>
                    <td class="p-3 font-mono text-slate-800">${row.baseSubtotal.toLocaleString()} PKR</td>
                    <td class="p-3 font-mono text-[11px]">
                      <span class="text-emerald-700">+${row.bonus}</span> / <span class="text-rose-600">-${row.deduction}</span>
                    </td>
                    <td class="p-3 font-mono font-black text-indigo-950">${row.netPayable.toLocaleString()} PKR</td>
                    <td class="p-3 font-mono text-slate-600">${row.paymentDate}</td>
                    <td class="p-3 text-right">
                      <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${row.status === 'Paid' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'}">
                        ${row.status}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  contentBox.innerHTML = `
    <!-- TEACHER HERO HEADER -->
    <div class="p-4 sm:p-5 bg-gradient-to-r from-indigo-950 via-slate-900 to-emerald-950 text-white rounded-2xl shadow-md mb-4">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex items-start sm:items-center gap-3.5">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-400 to-teal-400 text-slate-950 font-black text-xl flex items-center justify-center shadow-md shrink-0">
            ${(teacher.full_name || 'T').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2 py-0.5 rounded bg-indigo-400/20 border border-indigo-300/40 text-indigo-200 font-mono text-[10px] font-black">${creds.teacher_id}</span>
              <h2 class="text-lg sm:text-xl font-black tracking-tight text-white">${teacher.full_name}</h2>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">${teacher.status || 'Active'}</span>
            </div>
            <div class="flex items-center gap-3 flex-wrap text-xs text-slate-200 mt-1.5">
              <span class="font-mono"><i class="fa-brands fa-whatsapp text-emerald-400 mr-1"></i>${teacher.phone || '--'}</span>
              <span>&bull;</span>
              <span><i class="fa-solid fa-user-graduate text-teal-300 mr-1"></i><strong>${assignedStudents.length}</strong> Assigned Student(s)</span>
              <span>&bull;</span>
              <span><i class="fa-solid fa-clock text-amber-300 mr-1"></i>${teacher.working_shift || '10 Hours Shift'}</span>
              <span>&bull;</span>
              <span><i class="fa-solid fa-money-bill-wave text-emerald-300 mr-1"></i>Net Salary: <strong>${currNetPayable.toLocaleString()} PKR</strong></span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          ${cleanPhone ? `
            <a href="https://wa.me/${cleanPhone}" target="_blank" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-xs transition">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp
            </a>
          ` : ''}
          <button onclick="closeModal('modalUnified360Profile'); openEditTeacherModal('${teacher.id}')" class="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/15 font-extrabold text-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-pen-to-square text-amber-300"></i> Edit Profile
          </button>
          <button onclick="closeModal('modalUnified360Profile'); switchTab('tab-teachers'); open2DMatrixForTeacher('${teacher.id}')" class="px-3 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs flex items-center gap-1.5 shadow-xs transition">
            <i class="fa-solid fa-table-cells"></i> 2D Timetable
          </button>
        </div>
      </div>
    </div>

    <!-- SUB-NAVIGATION TABS -->
    <div class="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 border-b border-slate-200">
      ${tabsConfig.map(t => {
        const isActive = _CURRENT_360_STATE.activeTab === t.id;
        return `
          <button onclick="openTeacher360Profile('${teacher.id}', '${t.id}', true)"
                  class="px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap flex items-center gap-1.5 transition ${isActive ? 'bg-brandDark text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
            <i class="fa-solid ${t.icon} ${isActive ? 'text-brandGold' : 'text-slate-500'}"></i>
            <span>${t.label}</span>
            ${t.badge !== null ? `<span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono ${isActive ? 'bg-white/20 text-white' : 'bg-white text-slate-700'}">${t.badge}</span>` : ''}
          </button>
        `;
      }).join('')}
    </div>

    <div>${tabBodyHtml}</div>
  `;
}

// ============================================================================
// SEAMLESS ALIAS BRIDGES TO EXISTING LMS ENTRY POINTS
// ============================================================================
// So clicking ANY Student, Family, or Teacher anywhere in the LMS opens their
// complete interconnected 360° Profile automatically!
window.openStudent360Profile = openStudent360Profile;
window.openFamily360Profile = openFamily360Profile;
window.openTeacher360Profile = openTeacher360Profile;

// Override legacy quick modals to open the Unified 360° Profiles
window.openStudentDetailModal = function(studentId) {
  return openStudent360Profile(studentId, 'overview');
};

window.openTeacherOptionsModal = function(teacherId) {
  return openTeacher360Profile(teacherId, 'overview');
};

window.openTeacherDetailModal = function(teacherId) {
  return openTeacher360Profile(teacherId, 'overview');
};

window.openFamilyFromDashboardSearch = function(familyId) {
  if (typeof clearDashboardGlobalSearch === 'function') clearDashboardGlobalSearch();
  return openFamily360Profile(familyId, 'overview');
};
