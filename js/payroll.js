/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/payroll.js
 * Purpose: Course-Based Auto Payroll Engine, Seniority Increments & Printable/WhatsApp Salary Slips
 * Extracted Line Range: 10522 – 11087 (566 lines)
 * ============================================================================
 */

    // ==========================================
    // COURSE-BASED AUTO PAYROLL & EDITABLE SLIPS
    // ==========================================

    const ACADEMY_COURSE_RATES = {
      'noorani_qaida': 2200,
      'nazra_quran': 2200,
      'weekend_basic': 3200,
      'islamic_studies': 3500,
      'urdu_tafseer': 3500,
      'english_tafseer': 4500
    };

    function getTeacherSeniorityIncrement(teacher, acc) {
      if (!teacher) return 0;
      const account = acc || (getTeacherAccounts()[teacher.id] || {});
      
      if (account.increment_tier && account.increment_tier !== 'auto') {
        return parseInt(account.increment_tier, 10) || 0;
      }

      const joiningDate = account.joining_date || (teacher.created_at ? teacher.created_at.slice(0, 10) : null);
      if (joiningDate) {
        const joinYear = new Date(joiningDate);
        const now = new Date();
        const yearsDiff = Math.floor((now - joinYear) / (365.25 * 24 * 3600 * 1000));
        if (yearsDiff >= 1) {
          return yearsDiff * 200;
        }
      }
      return 0;
    }

    function getStudentCourseSalaryRate(student, scheds, teacherIncrement) {
      // 1. Detect if Weekend Schedule
      let isWeekend = false;
      const dayNums = (scheds || []).map(s => Number(s.day_of_week));
      if (dayNums.length > 0 && dayNums.every(d => d === 6 || d === 7)) {
        isWeekend = true;
      }

      // 2. Parse course details
      let cName = '';
      if (student.course_id && typeof student.course_id === 'string' && student.course_id.length > 10) {
        // Find course name by UUID if matched
        const matchedCourse = (window.ALL_COURSES_CACHE || []).find(c => c.id === student.course_id);
        if (matchedCourse) cName = matchedCourse.name;
      }
      if (!cName && student.notes) {
        try {
          const nObj = JSON.parse(student.notes);
          cName = nObj.course || nObj.trial_course || '';
          if (!isWeekend && (nObj.days_per_week || '').toLowerCase().includes('weekend')) {
            isWeekend = true;
          }
        } catch(e) {
          cName = student.notes;
        }
      }
      cName = (cName || 'Noorani Qaida & Basic Quran').toLowerCase();

      let baseRate = 2200;
      let courseLabel = 'Noorani Qaida & Basic Quran';

      if (cName.includes('english') && (cName.includes('tafseer') || cName.includes('translation'))) {
        baseRate = 4500;
        courseLabel = 'English Translation & Tafseer';
      } else if (cName.includes('urdu') && (cName.includes('tafseer') || cName.includes('translation'))) {
        baseRate = 3500;
        courseLabel = 'Urdu Translation & Tafseer';
      } else if (cName.includes('tafseer') || cName.includes('translation')) {
        baseRate = 4500;
        courseLabel = 'Tafseer & Translation';
      } else if (cName.includes('islamic') || cName.includes('dua')) {
        baseRate = 3500;
        courseLabel = 'Islamic Studies & Duas';
      } else if (isWeekend) {
        baseRate = 3200;
        courseLabel = 'Weekend Quran (Saturday & Sunday)';
      } else {
        baseRate = 2200;
        courseLabel = 'Noorani Qaida / Nazra Quran';
      }

      const finalRate = baseRate + teacherIncrement;

      let scheduleText = 'Regular Days';
      if (isWeekend) {
        scheduleText = 'Weekend (Sat - Sun)';
      } else if (dayNums.length > 0) {
        scheduleText = `${dayNums.length} Days / Week`;
      }

      return {
        baseRate,
        increment: teacherIncrement,
        finalRate,
        courseLabel,
        scheduleText,
        isWeekend
      };
    }

    /**
     * Parse month string (e.g. "September 2026" or "2026-09") into exact calendar bounds.
     * Uses real calendar days in that month (28, 29, 30, or 31) — never hardcodes 30.
     */
    function parsePayrollMonthBounds(monthStr) {
      const raw = String(monthStr || '').trim();
      let year = new Date().getFullYear();
      let monthIndex = new Date().getMonth(); // 0-indexed

      const isoMatch = raw.match(/^(\d{4})-(\d{1,2})/);
      if (isoMatch) {
        year = parseInt(isoMatch[1], 10);
        monthIndex = Math.max(0, Math.min(11, parseInt(isoMatch[2], 10) - 1));
      } else {
        const monthNames = [
          'january', 'february', 'march', 'april', 'may', 'june',
          'july', 'august', 'september', 'october', 'november', 'december'
        ];
        const lower = raw.toLowerCase();
        for (let i = 0; i < monthNames.length; i++) {
          if (lower.includes(monthNames[i]) || lower.includes(monthNames[i].slice(0, 3))) {
            monthIndex = i;
            break;
          }
        }
        const yrMatch = raw.match(/\b(20\d{2})\b/);
        if (yrMatch) {
          year = parseInt(yrMatch[1], 10);
        }
      }

      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      const mm = String(monthIndex + 1).padStart(2, '0');
      const firstDayStr = `${year}-${mm}-01`;
      const lastDayStr = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

      return {
        year,
        monthIndex,
        daysInMonth,
        firstDayStr,
        lastDayStr
      };
    }

    /**
     * Extract student metadata (joining_date, deactivation_date, previous_teacher_id_before_deactivation)
     * from student record, JSON notes, and localStorage profile cache.
     * IMPORTANT: Never uses class schedule creation date as joining date.
     */
    function extractStudentPayrollDates(student) {
      if (!student) return { joiningDate: null, deactivationDate: null, previousTeacherId: null };
      let notesObj = {};
      if (student.notes && typeof student.notes === 'string') {
        try { notesObj = JSON.parse(student.notes) || {}; } catch (e) { notesObj = {}; }
      } else if (student.notes && typeof student.notes === 'object') {
        notesObj = student.notes;
      }

      let cachedProfile = {};
      try {
        const profiles = JSON.parse(localStorage.getItem('alhuda_student_profiles') || '{}');
        if (student.id && profiles[student.id]) {
          cachedProfile = profiles[student.id];
        }
      } catch (e) {}

      const rawJoining = student.joining_date || notesObj.joining_date || cachedProfile.joining_date || (student.created_at ? String(student.created_at).slice(0, 10) : null);
      const joiningDate = (rawJoining && /^\d{4}-\d{2}-\d{2}/.test(String(rawJoining))) ? String(rawJoining).slice(0, 10) : null;

      const isCurrentlyActive = String(student.status || '').toLowerCase() === 'active' && !student.deactivation_date;
      const rawDeactivation = student.deactivation_date || (!isCurrentlyActive ? (notesObj.deactivation_date || cachedProfile.deactivation_date) : null);
      const deactivationDate = (rawDeactivation && /^\d{4}-\d{2}-\d{2}/.test(String(rawDeactivation))) ? String(rawDeactivation).slice(0, 10) : null;

      const previousTeacherId = student.previous_teacher_id_before_deactivation || notesObj.previous_teacher_id_before_deactivation || cachedProfile.previous_teacher_id_before_deactivation || null;

      return { joiningDate, deactivationDate, previousTeacherId };
    }

    /**
     * Calculate exact monthly salary proration for a student in a given calendar month.
     * Formula:
     *   Daily Rate = Monthly Rate / Days in Month
     *   Calculated Salary = Daily Rate * Active Days
     *
     * Supports all 5 Master LMS Cases:
     *   Case A: Active full month -> Full monthlyRate
     *   Case B: Joined mid-month (e.g. 15th in 30-day month) -> 16 days paid
     *   Case C: Deactivated mid-month (e.g. 10th in 30-day month) -> 10 days paid
     *   Case D: Joined 12th, deactivated 20th in 30-day month -> 9 days paid
     *   Case E: Inactive entire month -> 0 days paid (0 PKR)
     */
    function calculateStudentMonthlySalaryProration(student, monthlyRate, monthStr) {
      const bounds = parsePayrollMonthBounds(monthStr);
      const { daysInMonth, firstDayStr, lastDayStr } = bounds;
      const fullRate = Number(monthlyRate) || 0;
      const { joiningDate, deactivationDate } = extractStudentPayrollDates(student);

      const statusLower = String(student?.status || '').toLowerCase();

      // Case E checks:
      // 1. Joined after the end of this calendar month
      if (joiningDate && joiningDate > lastDayStr) {
        return {
          daysInMonth,
          activeDays: 0,
          startDay: null,
          endDay: null,
          joiningDate,
          deactivationDate,
          dailyRate: fullRate / daysInMonth,
          fullRate,
          proratedRate: 0,
          isProrated: true,
          prorationLabel: `0 / ${daysInMonth} Days (Joined ${joiningDate})`
        };
      }

      // 2. Deactivated before the 1st of this calendar month
      if (deactivationDate && deactivationDate < firstDayStr) {
        return {
          daysInMonth,
          activeDays: 0,
          startDay: null,
          endDay: null,
          joiningDate,
          deactivationDate,
          dailyRate: fullRate / daysInMonth,
          fullRate,
          proratedRate: 0,
          isProrated: true,
          prorationLabel: `0 / ${daysInMonth} Days (Deactivated ${deactivationDate})`
        };
      }

      // 3. Marked Inactive/Left without any deactivation date in or after this month
      if ((statusLower === 'inactive' || statusLower === 'left' || statusLower === 'deactivated') && !deactivationDate) {
        return {
          daysInMonth,
          activeDays: 0,
          startDay: null,
          endDay: null,
          joiningDate,
          deactivationDate: null,
          dailyRate: fullRate / daysInMonth,
          fullRate,
          proratedRate: 0,
          isProrated: true,
          prorationLabel: `0 / ${daysInMonth} Days (Inactive)`
        };
      }

      // Effective start day within [1, daysInMonth]
      let startDay = 1;
      if (joiningDate && joiningDate >= firstDayStr && joiningDate <= lastDayStr) {
        startDay = parseInt(joiningDate.slice(8, 10), 10) || 1;
      }

      // Effective end day within [1, daysInMonth]
      let endDay = daysInMonth;
      if (deactivationDate && deactivationDate >= firstDayStr && deactivationDate <= lastDayStr) {
        endDay = parseInt(deactivationDate.slice(8, 10), 10) || daysInMonth;
      }

      if (endDay < startDay) {
        return {
          daysInMonth,
          activeDays: 0,
          startDay,
          endDay,
          joiningDate,
          deactivationDate,
          dailyRate: fullRate / daysInMonth,
          fullRate,
          proratedRate: 0,
          isProrated: true,
          prorationLabel: `0 / ${daysInMonth} Days`
        };
      }

      const activeDays = endDay - startDay + 1;
      const dailyRate = fullRate / daysInMonth;
      const isFullMonth = activeDays >= daysInMonth;
      const proratedRate = isFullMonth ? fullRate : Math.round(dailyRate * activeDays);

      let prorationLabel = `${activeDays} / ${daysInMonth} Days (Full Month)`;
      if (!isFullMonth) {
        const reasons = [];
        if (startDay > 1 && joiningDate) reasons.push(`Joined ${joiningDate}`);
        if (endDay < daysInMonth && deactivationDate) reasons.push(`Deactivated ${deactivationDate}`);
        prorationLabel = `${activeDays} / ${daysInMonth} Days${reasons.length ? ' • ' + reasons.join(', ') : ''}`;
      }

      return {
        daysInMonth,
        activeDays,
        startDay,
        endDay,
        joiningDate,
        deactivationDate,
        dailyRate,
        fullRate,
        proratedRate,
        isProrated: !isFullMonth,
        prorationLabel
      };
    }

    window.parsePayrollMonthBounds = parsePayrollMonthBounds;
    window.calculateStudentMonthlySalaryProration = calculateStudentMonthlySalaryProration;

    async function calculateMonthlySalaries(forceRefresh = false) {
      const tbody = document.getElementById('salariesTableBody');
      if (!tbody) return;
      if (!Array.isArray(ALL_TEACHERS) || ALL_TEACHERS.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-xl text-brandGold mb-2 block"></i> Compiling automated course-based teacher payroll...</td></tr>';
      }

      const selectedMonth = document.getElementById('salaryMonthSelect')?.value || 'September 2026';

      let teachers = ALL_TEACHERS || [];
      let scheds = ALL_CLASS_SCHEDULES || [];
      let students = ALL_STUDENTS || [];

      if (typeof ensureCoreLmsDataLoaded === 'function') {
        const core = await ensureCoreLmsDataLoaded({ force: Boolean(forceRefresh) });
        teachers = core.teachers || [];
        scheds = core.schedules || [];
        students = core.students || [];
      } else {
        const [tRes, scRes, sRes] = await Promise.all([
          db.from('teachers').select('*').order('created_at', { ascending: false }),
          db.from('class_schedules').select('*, students(*)'),
          db.from('students').select('*')
        ]);
        teachers = tRes.data || [];
        scheds = scRes.data || [];
        students = sRes.data || [];
        ALL_TEACHERS = teachers;
        ALL_STUDENTS = students;
      }

      if (!window.ALL_COURSES_CACHE || window.ALL_COURSES_CACHE.length === 0) {
        try {
          const { data: courses } = await db.from('courses').select('*');
          window.ALL_COURSES_CACHE = courses || [];
        } catch(e){}
      }

      if (!teachers || teachers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400">No teachers found in the academy database.</td></tr>';
        return;
      }

      // Load saved salary slips from cloud-hydrated storage
      let savedSalaries = {};
      try {
        savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
      } catch(e) {
        savedSalaries = {};
      }

      const accounts = getTeacherAccounts();
      ALL_TEACHER_SALARIES = {};

      let totalGrossPayroll = 0;
      let totalAssignedStudentsCount = 0;
      let paidCount = 0;
      let activeTeachersCount = 0;

      const teacherCardsData = teachers.map(t => {
        const acc = accounts[t.id] || {};
        const teacherIncrement = getTeacherSeniorityIncrement(t, acc);

        const slipKey = `${t.id}_${selectedMonth.replace(/\s+/g, '_')}`;
        const savedSlip = savedSalaries[slipKey] || null;

        // Historical Month Protection:
        // If this month's slip was already marked 'Paid' and has a finalized student snapshot,
        // preserve the finalized historical record so later student deactivations never alter past paid months.
        if (savedSlip && savedSlip.status === 'Paid' && Array.isArray(savedSlip.student_items_snapshot) && savedSlip.student_items_snapshot.length > 0) {
          const studentRateItems = savedSlip.student_items_snapshot;
          const baseSubtotal = savedSlip.base_subtotal !== undefined
            ? (parseFloat(savedSlip.base_subtotal) || 0)
            : studentRateItems.reduce((accSum, item) => accSum + (parseFloat(item.final_rate) || 0), 0);
          const bonus = parseFloat(savedSlip.bonus) || 0;
          const deduction = parseFloat(savedSlip.deduction) || 0;
          const remarks = savedSlip.remarks || '';
          const netPayable = Math.max(0, baseSubtotal + bonus - deduction);

          if (studentRateItems.length > 0) activeTeachersCount++;
          totalAssignedStudentsCount += studentRateItems.length;
          paidCount++;
          totalGrossPayroll += netPayable;

          const compiledSlip = {
            teacher_id: t.id,
            teacher_name: t.full_name,
            phone: t.phone,
            month: selectedMonth,
            joining_date: acc.joining_date || (t.created_at ? t.created_at.slice(0, 10) : '2025-01-01'),
            seniority_increment: teacherIncrement,
            assigned_students: studentRateItems,
            base_subtotal: baseSubtotal,
            bonus,
            deduction,
            remarks,
            net_payable: netPayable,
            status: 'Paid',
            slip_key: slipKey
          };
          ALL_TEACHER_SALARIES[t.id] = compiledSlip;
        } else {
          // Find all students associated with this teacher (active or deactivated during/after this month)
          // Method A: from schedules
          const teacherScheds = (scheds || []).filter(s => s.teacher_id === t.id);
          const studentIdsFromScheds = [...new Set(teacherScheds.map(s => s.student_id))];

          // Method B: from students.assigned_teacher_id OR previous_teacher_id_before_deactivation
          const studentIdsFromStudents = (students || []).filter(s => {
            if (s.status === 'Trial') return false;
            if (s.assigned_teacher_id === t.id) return true;
            const { previousTeacherId } = extractStudentPayrollDates(s);
            return previousTeacherId === t.id;
          }).map(s => s.id);

          const allStudentIds = [...new Set([...studentIdsFromScheds, ...studentIdsFromStudents])];

          // Fetch student objects
          const candidateStudents = allStudentIds.map(sid => {
            const fromStu = (students || []).find(s => s.id === sid);
            const fromSched = teacherScheds.find(s => s.student_id === sid)?.students;
            return fromStu || fromSched || { id: sid, name: 'Student ' + sid };
          }).filter(s => s && s.name);

          let baseSubtotal = 0;
          const studentRateItems = [];

          candidateStudents.forEach((stu) => {
            const stuScheds = teacherScheds.filter(s => s.student_id === stu.id);
            const rateInfo = getStudentCourseSalaryRate(stu, stuScheds, teacherIncrement);
            const proration = calculateStudentMonthlySalaryProration(stu, rateInfo.finalRate, selectedMonth);

            // If student was deactivated before this month started or joined after this month ended (activeDays === 0),
            // skip from this month's active payroll unless currently assigned and admin manually set a custom override.
            const hasManualOverride = Boolean(savedSlip && savedSlip.students && savedSlip.students[stu.id] !== undefined);
            if (proration.activeDays === 0 && !hasManualOverride) {
              return;
            }

            let finalRate = proration.proratedRate;
            if (hasManualOverride) {
              finalRate = parseFloat(savedSlip.students[stu.id]);
              if (isNaN(finalRate)) finalRate = proration.proratedRate;
            }

            baseSubtotal += finalRate;

            studentRateItems.push({
              index: studentRateItems.length + 1,
              student_id: stu.id,
              student_name: stu.name,
              course_label: rateInfo.courseLabel,
              schedule_text: `${rateInfo.scheduleText} (${proration.prorationLabel})`,
              proration_label: proration.prorationLabel,
              active_days: proration.activeDays,
              days_in_month: proration.daysInMonth,
              joining_date: proration.joiningDate,
              deactivation_date: proration.deactivationDate,
              is_prorated: proration.isProrated,
              base_rate: rateInfo.baseRate,
              increment: teacherIncrement,
              full_monthly_rate: rateInfo.finalRate,
              calculated_rate: proration.proratedRate,
              final_rate: finalRate
            });
          });

          if (studentRateItems.length > 0) activeTeachersCount++;
          totalAssignedStudentsCount += studentRateItems.length;

          // Bonuses and Deductions
          const bonus = savedSlip ? (parseFloat(savedSlip.bonus) || 0) : 0;
          const deduction = savedSlip ? (parseFloat(savedSlip.deduction) || 0) : 0;
          const remarks = savedSlip ? (savedSlip.remarks || '') : '';
          const netPayable = Math.max(0, baseSubtotal + bonus - deduction);
          const status = savedSlip ? (savedSlip.status || 'Pending') : 'Pending';

          if (status === 'Paid') paidCount++;
          totalGrossPayroll += netPayable;

          const compiledSlip = {
            teacher_id: t.id,
            teacher_name: t.full_name,
            phone: t.phone,
            month: selectedMonth,
            joining_date: acc.joining_date || (t.created_at ? t.created_at.slice(0, 10) : '2025-01-01'),
            seniority_increment: teacherIncrement,
            assigned_students: studentRateItems,
            base_subtotal: baseSubtotal,
            bonus,
            deduction,
            remarks,
            net_payable: netPayable,
            status,
            slip_key: slipKey
          };

          ALL_TEACHER_SALARIES[t.id] = compiledSlip;
        }

        const compiledSlip = ALL_TEACHER_SALARIES[t.id];
        const studentRateItems = compiledSlip.assigned_students || [];
        const baseSubtotal = compiledSlip.base_subtotal;
        const bonus = compiledSlip.bonus;
        const deduction = compiledSlip.deduction;
        const netPayable = compiledSlip.net_payable;
        const status = compiledSlip.status;

        // Seniority text
        const yrs = Math.floor((new Date() - new Date(compiledSlip.joining_date)) / (365.25 * 24 * 3600 * 1000));
        let seniorityBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">Base</span>`;
        if (teacherIncrement > 0) {
          seniorityBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">+${teacherIncrement} PKR/stu (Yr ${yrs || 1})</span>`;
        }

        // Summary breakdown of courses
        const courseCounts = {};
        studentRateItems.forEach(s => {
          courseCounts[s.course_label] = (courseCounts[s.course_label] || 0) + 1;
        });
        const courseSummaryPills = Object.entries(courseCounts).map(([cName, count]) => {
          return `<span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700 border border-slate-200 mr-1 mb-1">${count}x ${cName}</span>`;
        }).join('') || '<span class="text-slate-400 italic text-[11px]">No active students assigned</span>';

        // Adjustments summary
        let adjSummary = '<span class="text-slate-400 text-[11px]">No adjustments</span>';
        if (bonus > 0 || deduction > 0) {
          adjSummary = `
            <div class="text-[11px] font-mono">
              ${bonus > 0 ? `<span class="text-emerald-700 font-bold block">+${bonus.toLocaleString()} PKR (Bonus)</span>` : ''}
              ${deduction > 0 ? `<span class="text-rose-700 font-bold block">-${deduction.toLocaleString()} PKR (Deduction)</span>` : ''}
            </div>
          `;
        }

        const isPaid = status === 'Paid';

        return `
          <tr class="hover:bg-slate-50/80 transition">
            <!-- 1. TEACHER & SENIORITY -->
            <td class="p-3.5">
              <button onclick="openTeacher360Profile('${t.id}', 'salary')" class="font-extrabold text-slate-900 hover:text-indigo-700 hover:underline text-xs text-left block transition">${t.full_name}</button>
              <div class="flex items-center gap-1.5 mt-1">
                ${seniorityBadge}
                <span class="text-[10px] text-slate-400 font-mono">${t.phone}</span>
              </div>
            </td>

            <!-- 2. ASSIGNED STUDENTS -->
            <td class="p-3.5 max-w-xs">
              <button onclick="openTeacher360Profile('${t.id}', 'students')" class="font-bold text-sm text-brandDark hover:text-brandEmerald hover:underline mb-1.5 flex items-center gap-1.5 text-left">
                <span class="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 lms-num-table font-bold">${studentRateItems.length}</span>
                <span>Enrolled Students</span>
              </button>
              <div class="flex flex-wrap">${courseSummaryPills}</div>
            </td>

            <!-- 3. BASE COURSE TOTAL -->
            <td class="p-3.5">
              <div class="lms-num-financial font-bold text-slate-900 text-[15px]">PKR ${baseSubtotal.toLocaleString()}</div>
              <span class="text-[11px] text-slate-500 block mt-0.5">From Course Rates</span>
            </td>

            <!-- 4. BONUS / ADJUSTMENTS -->
            <td class="p-3.5">
              ${adjSummary}
            </td>

            <!-- 5. NET PAYABLE SALARY -->
            <td class="p-3.5">
              <div class="lms-num-financial text-base font-bold text-brandDarkest bg-amber-50/90 px-3 py-1.5 rounded-xl border border-amber-300 inline-block shadow-2xs">
                PKR ${netPayable.toLocaleString()}
              </div>
            </td>

            <!-- 6. PAYMENT STATUS -->
            <td class="p-3.5">
              ${isPaid 
                ? '<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> Paid</span>' 
                : '<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300 inline-flex items-center gap-1"><i class="fa-solid fa-clock"></i> Pending</span>'
              }
            </td>

            <!-- 7. ACTIONS & SLIP -->
            <td class="p-3.5 text-right">
              <div class="flex items-center justify-end gap-1.5">
                <button onclick="openSalarySlipModal('${t.id}')" class="px-3 py-1.5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-700 text-brandDarkest font-black rounded-xl text-xs shadow-xs transition flex items-center gap-1.5">
                  <i class="fa-solid fa-receipt"></i> View & Edit Slip
                </button>
                <button onclick="quickToggleSalaryPaid('${t.id}')" title="${isPaid ? 'Mark as Pending' : 'Mark as Paid'}" class="p-2 border rounded-xl text-xs font-bold ${isPaid ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-slate-50 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'} transition">
                  <i class="fa-solid fa-check"></i>
                </button>
                <button onclick="quickSendWhatsAppSlip('${t.id}')" title="Send WhatsApp Salary Slip" class="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-xl text-xs font-bold transition">
                  <i class="fa-brands fa-whatsapp text-sm"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      tbody.innerHTML = teacherCardsData;

      // Update KPI Cards
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      setEl('payrollKpiTotal', `${totalGrossPayroll.toLocaleString()} PKR`);
      setEl('payrollKpiTeachers', `${activeTeachersCount} Active`);
      setEl('payrollKpiStudents', `${totalAssignedStudentsCount} Enrolled`);
      setEl('payrollKpiDisbursed', `${paidCount} / ${teachers.length} Paid`);
    }

    // OPEN ITEMIZED & EDITABLE SALARY SLIP MODAL
    function openSalarySlipModal(teacherId) {
      const slipData = ALL_TEACHER_SALARIES[teacherId];
      if (!slipData) {
        alert("Salary data not available for this instructor.");
        return;
      }

      CURRENT_SLIP_TEACHER_ID = teacherId;
      CURRENT_SLIP_DATA = slipData;

      document.getElementById('slipTeacherId').value = teacherId;
      document.getElementById('slipMonthSubtitle').innerText = `Official Teacher Compensation & Course Payroll Statement for ${slipData.month}`;
      document.getElementById('slipTeacherName').innerText = slipData.teacher_name;
      document.getElementById('slipTeacherCode').innerText = teacherId.slice(0, 8).toUpperCase();
      document.getElementById('slipJoiningDate').innerText = slipData.joining_date;

      const incBadge = document.getElementById('slipIncrementTierBadge');
      if (incBadge) {
        incBadge.innerText = slipData.seniority_increment > 0 
          ? `+${slipData.seniority_increment} PKR / Student` 
          : 'Base Level (0 PKR)';
      }

      // Render editable students table
      const tbody = document.getElementById('slipStudentsTableBody');
      if (tbody) {
        if (!slipData.assigned_students || slipData.assigned_students.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">No students assigned yet.</td></tr>';
        } else {
          tbody.innerHTML = slipData.assigned_students.map(s => {
            const prorationBadge = s.proration_label
              ? `<span class="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${s.is_prorated ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}">${s.proration_label}</span>`
              : '';
            const fullMonthlyRate = s.full_monthly_rate || (s.base_rate + (s.increment || 0));
            return `
              <tr class="hover:bg-slate-50">
                <td class="p-2.5 font-mono text-slate-400 font-bold">${s.index}</td>
                <td class="p-2.5 font-extrabold text-slate-900">
                  <div>${s.student_name}</div>
                  ${s.joining_date ? `<div class="text-[10px] font-normal text-slate-500">Joined: ${s.joining_date}${s.deactivation_date ? ' • Deactivated: ' + s.deactivation_date : ''}</div>` : ''}
                </td>
                <td class="p-2.5 font-bold text-brandDark">${s.course_label}</td>
                <td class="p-2.5 text-slate-600 text-xs">
                  <div>${s.schedule_text}</div>
                  ${prorationBadge}
                </td>
                <td class="p-2.5 font-mono text-slate-500 text-xs">
                  <div>${s.base_rate} ${s.increment > 0 ? '+ ' + s.increment : ''} PKR</div>
                  ${s.is_prorated ? `<div class="text-[10px] text-amber-700 font-bold">Prorated: ${s.calculated_rate} / ${fullMonthlyRate} PKR</div>` : ''}
                </td>
                <td class="p-2.5 text-right">
                  <div class="inline-flex items-center gap-1">
                    <input type="number" class="slip-student-rate w-24 p-1.5 text-right font-mono font-black border border-emerald-400 rounded-lg text-brandDarkest bg-emerald-50/40 focus:bg-white focus:outline-brandEmerald text-xs" 
                      data-student-id="${s.student_id}" 
                      value="${s.final_rate}" 
                      oninput="recalculateSlipNetTotal()">
                    <span class="text-[10px] text-slate-400 font-bold">PKR</span>
                  </div>
                </td>
              </tr>
            `;
          }).join('');
        }
      }

      document.getElementById('slipBonus').value = slipData.bonus || '';
      document.getElementById('slipDeduction').value = slipData.deduction || '';
      document.getElementById('slipRemarks').value = slipData.remarks || '';

      recalculateSlipNetTotal();

      // Update Paid Button
      updateSlipPaidButtonUI(slipData.status === 'Paid');

      openModal('modalSalarySlip');
    }

    function recalculateSlipNetTotal() {
      const rateInputs = document.querySelectorAll('.slip-student-rate');
      let baseSubtotal = 0;
      rateInputs.forEach(inp => {
        baseSubtotal += parseFloat(inp.value) || 0;
      });

      const bonus = parseFloat(document.getElementById('slipBonus')?.value) || 0;
      const deduction = parseFloat(document.getElementById('slipDeduction')?.value) || 0;
      const netPayable = Math.max(0, baseSubtotal + bonus - deduction);

      const baseInp = document.getElementById('slipBaseSubtotal');
      if (baseInp) baseInp.value = baseSubtotal;

      const netEl = document.getElementById('slipNetPayable');
      if (netEl) netEl.innerText = `${netPayable.toLocaleString()} PKR`;

      const countEl = document.getElementById('slipTotalStudentsCount');
      if (countEl) countEl.innerText = `For ${rateInputs.length} Assigned Students (${baseSubtotal.toLocaleString()} Base ${bonus > 0 ? '+ ' + bonus + ' Bonus' : ''} ${deduction > 0 ? '- ' + deduction + ' Deduction' : ''})`;

      return { baseSubtotal, bonus, deduction, netPayable };
    }

    function saveSalarySlipRecord() {
      if (!CURRENT_SLIP_DATA || !CURRENT_SLIP_TEACHER_ID) return;

      const { baseSubtotal, bonus, deduction, netPayable } = recalculateSlipNetTotal();
      const remarks = (document.getElementById('slipRemarks')?.value || '').trim();

      // Collect edited student rates
      const editedStudentRates = {};
      document.querySelectorAll('.slip-student-rate').forEach(inp => {
        const sId = inp.getAttribute('data-student-id');
        editedStudentRates[sId] = parseFloat(inp.value) || 0;
      });

      const studentItemsSnapshot = (CURRENT_SLIP_DATA.assigned_students || []).map(item => ({
        ...item,
        final_rate: editedStudentRates[item.student_id] !== undefined ? editedStudentRates[item.student_id] : item.final_rate
      }));

      let savedSalaries = {};
      try {
        savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
      } catch(e) { savedSalaries = {}; }

      const slipKey = CURRENT_SLIP_DATA.slip_key;
      savedSalaries[slipKey] = {
        teacher_id: CURRENT_SLIP_TEACHER_ID,
        month: CURRENT_SLIP_DATA.month,
        students: editedStudentRates,
        student_items_snapshot: studentItemsSnapshot,
        base_subtotal: baseSubtotal,
        bonus,
        deduction,
        remarks,
        net_payable: netPayable,
        status: CURRENT_SLIP_DATA.status || 'Pending',
        saved_at: new Date().toISOString()
      };

      localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(savedSalaries));
      if (typeof syncGlobalSharedStateToCloud === 'function') {
        syncGlobalSharedStateToCloud({ teacherId: CURRENT_SLIP_TEACHER_ID });
      }

      calculateMonthlySalaries();
      alert(`✅ Salary Slip Saved Successfully!\n\n👨‍🏫 Teacher: ${CURRENT_SLIP_DATA.teacher_name}\n💵 Base Teaching: ${baseSubtotal.toLocaleString()} PKR\n💰 Net Payable: ${netPayable.toLocaleString()} PKR\n📌 Status: ${savedSalaries[slipKey].status}`);
    }

    function updateSlipPaidButtonUI(isPaid) {
      const btn = document.getElementById('btnSlipMarkPaid');
      const text = document.getElementById('btnSlipMarkPaidText');
      if (!btn || !text) return;

      if (isPaid) {
        btn.className = "px-4 py-2 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 bg-emerald-600 text-white shadow-xs hover:bg-emerald-700";
        text.innerText = "Payment Completed (Paid)";
      } else {
        btn.className = "px-4 py-2 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-800";
        text.innerText = "Mark as Paid";
      }
    }

    function toggleSalaryPaidStatus() {
      if (!CURRENT_SLIP_DATA || !CURRENT_SLIP_TEACHER_ID) return;

      const nextStatus = (CURRENT_SLIP_DATA.status === 'Paid') ? 'Pending' : 'Paid';
      CURRENT_SLIP_DATA.status = nextStatus;

      updateSlipPaidButtonUI(nextStatus === 'Paid');
      saveSalarySlipRecord();

      if (nextStatus === 'Paid') {
        setTimeout(async () => {
          if (confirm(`Do you want to dispatch the finalized salary statement email to ${CURRENT_SLIP_DATA.teacher_name}?`)) {
            await sendSalarySlipEmailModal(CURRENT_SLIP_DATA, false);
          }
        }, 400);
      }
    }

    function quickToggleSalaryPaid(teacherId) {
      const slipData = ALL_TEACHER_SALARIES[teacherId];
      if (!slipData) return;

      let savedSalaries = {};
      try {
        savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
      } catch(e) { savedSalaries = {}; }

      const slipKey = slipData.slip_key;
      const current = savedSalaries[slipKey] || {};
      const newStatus = (current.status === 'Paid' || slipData.status === 'Paid') ? 'Pending' : 'Paid';

      savedSalaries[slipKey] = {
        ...slipData,
        ...current,
        student_items_snapshot: slipData.assigned_students || current.student_items_snapshot || [],
        status: newStatus,
        saved_at: new Date().toISOString()
      };

      localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(savedSalaries));
      if (typeof syncGlobalSharedStateToCloud === 'function') {
        syncGlobalSharedStateToCloud({ teacherId });
      }
      calculateMonthlySalaries();
    }

    function sendSalarySlipWhatsApp() {
      if (!CURRENT_SLIP_DATA) return;
      generateAndOpenWhatsAppSlip(CURRENT_SLIP_DATA);
    }

    function quickSendWhatsAppSlip(teacherId) {
      const slipData = ALL_TEACHER_SALARIES[teacherId];
      if (!slipData) return;
      generateAndOpenWhatsAppSlip(slipData);
    }

    function generateAndOpenWhatsAppSlip(slipData) {
      const cleanPhone = (slipData.phone || '').replace(/[^0-9]/g, '');
      if (!cleanPhone) {
        alert("Teacher WhatsApp number is not registered.");
        return;
      }

      // Collect itemized student lines
      const rateInputs = document.querySelectorAll('.slip-student-rate');
      let studentLines = '';

      if (slipData.assigned_students && slipData.assigned_students.length > 0) {
        studentLines = slipData.assigned_students.map((s, idx) => {
          return `${idx + 1}. *${s.student_name}* (${s.course_label}) - ${s.final_rate.toLocaleString()} PKR`;
        }).join('\n');
      } else {
        studentLines = 'No individual students registered this month.';
      }

      const msg = 
`Assalamu Alaikum Respected *${slipData.teacher_name}*,
Al-Huda Islamic Centre - Official Monthly Salary Statement for *${slipData.month}*

Teacher Name: ${slipData.teacher_name}
Joining Date: ${slipData.joining_date}
Seniority Increment: ${slipData.seniority_increment > 0 ? '+' + slipData.seniority_increment + ' PKR / student' : 'Standard Base Rate'}

Assigned Students & Course Breakdown:
${studentLines}

──────────────────
Base Teaching Amount: ${slipData.base_subtotal.toLocaleString()} PKR
${slipData.bonus > 0 ? `Bonus / Allowances: +${slipData.bonus.toLocaleString()} PKR\n` : ''}${slipData.deduction > 0 ? `Deductions / Advances: -${slipData.deduction.toLocaleString()} PKR\n` : ''}${slipData.remarks ? `Remarks: ${slipData.remarks}\n` : ''}Total Net Payable Salary: ${slipData.net_payable.toLocaleString()} PKR
Payment Status: ${slipData.status === 'Paid' ? 'Paid (Disbursed)' : 'Processing (Pending)'}
──────────────────

Jazakum Allahu Khairan!
Al-Huda Islamic Centre Management`;

      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
    }

    function printSalarySlip() {
      const modal = document.getElementById('modalSalarySlip');
      if (!modal) return;
      window.print();
    }

    // ============================================================
    // CANONICAL SALARY SLIP PDF GENERATION (html2canvas + jsPDF)
    // ============================================================
    async function downloadSalarySlipPDF(teacherIdOrData) {
      let slipData = null;
      if (typeof teacherIdOrData === 'object' && teacherIdOrData !== null) {
        slipData = teacherIdOrData;
      } else if (typeof teacherIdOrData === 'string') {
        slipData = (typeof ALL_TEACHER_SALARIES !== 'undefined') ? ALL_TEACHER_SALARIES[teacherIdOrData] : null;
      } else {
        slipData = CURRENT_SLIP_DATA;
      }

      if (!slipData) {
        alert("No salary slip data available to generate PDF.");
        return;
      }

      const sourceCard = document.getElementById('salarySlipReceiptCard') || document.querySelector('#modalSalarySlip > div') || document.getElementById('modalSalarySlip');
      if (!sourceCard) {
        alert("Salary slip modal is not active.");
        return;
      }

      const btn = document.getElementById('btnSlipDownloadPdf');
      const originalText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Generating PDF...';
      }

      let sandbox = null;
      try {
        const cleanName = (slipData.teacher_name || 'Teacher').replace(/[^a-zA-Z0-9_-]/g, '_');
        const cleanMonth = (slipData.month || 'Month').replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `AlHuda-SalarySlip-${cleanName}-${cleanMonth}.pdf`;

        const cardClone = sourceCard.cloneNode(true);
        const actionRow = cardClone.querySelector('.border-t:last-child') || cardClone.querySelector('.shrink-0:last-child');
        if (actionRow) actionRow.style.display = 'none';

        cardClone.style.maxWidth = '780px';
        cardClone.style.width = '780px';
        cardClone.style.margin = '0';
        cardClone.style.padding = '24px';
        cardClone.style.background = '#ffffff';
        cardClone.style.boxShadow = 'none';
        cardClone.style.borderRadius = '0';
        cardClone.style.border = '1px solid #cbd5e1';

        cardClone.querySelectorAll('.slip-student-rate').forEach(inp => {
          const span = document.createElement('span');
          span.style.fontFamily = 'monospace';
          span.style.fontWeight = 'bold';
          span.style.color = '#064e3b';
          span.innerText = Number(inp.value || 0).toLocaleString();
          inp.parentNode.replaceChild(span, inp);
        });

        cardClone.querySelectorAll('input').forEach(inp => {
          if (inp.type === 'hidden') return;
          const span = document.createElement('span');
          span.style.fontWeight = 'bold';
          span.innerText = inp.value || '0';
          inp.parentNode.replaceChild(span, inp);
        });

        const images = cardClone.querySelectorAll('img');
        await Promise.all(Array.from(images).map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        }));

        sandbox = document.createElement('div');
        sandbox.id = 'salarySlipPdfSandbox';
        sandbox.style.position = 'fixed';
        sandbox.style.left = '0';
        sandbox.style.top = '0';
        sandbox.style.width = '800px';
        sandbox.style.zIndex = '-9999';
        sandbox.style.opacity = '1';
        sandbox.style.pointerEvents = 'none';
        sandbox.appendChild(cardClone);
        document.body.appendChild(sandbox);

        let pdfGenerated = false;

        const hasHtml2Canvas = typeof html2canvas !== 'undefined';
        const hasJsPDF = typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF;

        if (hasHtml2Canvas && hasJsPDF) {
          try {
            const canvas = await html2canvas(cardClone, {
              scale: 2,
              useCORS: true,
              logging: false,
              backgroundColor: '#ffffff'
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({
              orientation: 'portrait',
              unit: 'mm',
              format: 'a4'
            });

            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 10;
            const printableWidth = pageWidth - (margin * 2);
            const imgHeight = (canvas.height * printableWidth) / canvas.width;

            if (imgHeight <= (pageHeight - (margin * 2))) {
              pdf.addImage(imgData, 'JPEG', margin, margin, printableWidth, imgHeight);
            } else {
              pdf.addImage(imgData, 'JPEG', margin, margin, printableWidth, pageHeight - (margin * 2));
            }

            pdf.save(filename);
            pdfGenerated = true;
            if (typeof lmsNotify === 'function') lmsNotify('✅ Official Salary Slip PDF downloaded successfully!', { type: 'success' });
            else alert('✅ Official Salary Slip PDF downloaded successfully!');
          } catch (canvasErr) {
            console.warn('[Salary Slip PDF] html2canvas error:', canvasErr);
          }
        }

        if (!pdfGenerated && typeof html2pdf !== 'undefined') {
          const opt = {
            margin: [8, 8, 8, 8],
            filename: filename,
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
          };
          await html2pdf().set(opt).from(cardClone).save();
          pdfGenerated = true;
          if (typeof lmsNotify === 'function') lmsNotify('✅ Official Salary Slip PDF downloaded!', { type: 'success' });
          else alert('✅ Official Salary Slip PDF downloaded!');
        }

        if (!pdfGenerated) {
          window.print();
        }

      } catch (err) {
        console.error('[Salary Slip PDF] Generation error:', err);
        window.print();
      } finally {
        if (sandbox && sandbox.parentNode) {
          sandbox.parentNode.removeChild(sandbox);
        }
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      }
    }
    window.downloadSalarySlipPDF = downloadSalarySlipPDF;

    // ============================================================
    // CANONICAL SALARY SLIP EMAIL DISPATCHER
    // ============================================================
    async function sendSalarySlipEmailModal(slipDataOrTeacherId, isSilent = false) {
      let slipData = null;
      if (typeof slipDataOrTeacherId === 'object' && slipDataOrTeacherId !== null) {
        slipData = slipDataOrTeacherId;
      } else if (typeof slipDataOrTeacherId === 'string') {
        slipData = (typeof ALL_TEACHER_SALARIES !== 'undefined') ? ALL_TEACHER_SALARIES[slipDataOrTeacherId] : null;
      } else {
        slipData = CURRENT_SLIP_DATA;
      }

      if (!slipData) {
        alert("No active salary slip record available to send.");
        return;
      }

      const teacher = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(slipData.teacher_id || CURRENT_SLIP_TEACHER_ID));
      const accounts = typeof getTeacherAccounts === 'function' ? getTeacherAccounts() : JSON.parse(localStorage.getItem('alhuda_teacher_accounts') || '{}');
      const teacherAcc = (teacher && accounts[teacher.id]) || {};

      let targetEmail = (teacher?.email || teacherAcc?.email || '').trim();

      if (!targetEmail && !isSilent) {
        const promptEmail = await lmsPrompt(`Please enter teacher email address for ${slipData.teacher_name}:`, "", {
          title: 'Teacher Email Required',
          subtitle: `${slipData.teacher_name} (${slipData.teacher_id || ''})`,
          confirmText: 'Send Salary Slip'
        });
        if (promptEmail && promptEmail.includes('@')) {
          targetEmail = promptEmail.trim();
        }
      }

      if (!targetEmail || !targetEmail.includes('@')) {
        if (!isSilent) {
          alert(`No valid email address found for ${slipData.teacher_name}. Please specify teacher email.`);
        }
        return;
      }

      const subject = `Official Salary Statement [${slipData.month}] — ${slipData.teacher_name} — Al-Huda Islamic Centre`;

      let studentLines = '';
      if (slipData.assigned_students && slipData.assigned_students.length > 0) {
        studentLines = slipData.assigned_students.map((s, idx) => {
          return `• ${idx + 1}. ${s.student_name} (${s.course_label}) — PKR ${Number(s.final_rate || s.calculated_rate || 0).toLocaleString()}`;
        }).join('\n');
      } else {
        studentLines = '• Base fixed monthly teaching';
      }

      const plainText =
`Assalamu Alaikum wa Rahmatullah Respected ${slipData.teacher_name},

We pray you are in the best of health and Iman.
Please find below your official monthly salary compensation statement for ${slipData.month} from Al-Huda Islamic Centre.

══════════════════════════════════════
TEACHER SALARY VOUCHER DETAILS:
══════════════════════════════════════
• Instructor Name: ${slipData.teacher_name}
• Teacher ID: ${slipData.teacher_id || 'N/A'}
• Joining Date: ${slipData.joining_date || 'N/A'}
• Billing Month: ${slipData.month}
• Seniority Increment: ${slipData.seniority_increment > 0 ? '+' + slipData.seniority_increment + ' PKR / student' : 'Standard'}

ASSIGNED STUDENTS & COURSE RATES:
${studentLines}

══════════════════════════════════════
FINANCIAL SETTLEMENT:
══════════════════════════════════════
• Base Teaching Subtotal: PKR ${Number(slipData.base_subtotal || 0).toLocaleString()}
${slipData.bonus > 0 ? `• Bonus / Allowances: + PKR ${Number(slipData.bonus).toLocaleString()}\n` : ''}${slipData.deduction > 0 ? `• Deductions / Advances: - PKR ${Number(slipData.deduction).toLocaleString()}\n` : ''}${slipData.remarks ? `• Remarks: ${slipData.remarks}\n` : ''}• TOTAL NET PAYABLE: PKR ${Number(slipData.net_payable || 0).toLocaleString()}
• Disbursed Status: ${slipData.status === 'Paid' ? 'PAID / DISBURSED' : 'PENDING APPROVAL'}

Jazakumullahu Khairan!
Al-Huda Islamic Centre Management
Official Accounts Email: ceoislamiccentre@gmail.com`;

      const btn = document.getElementById('btnSlipSendEmail');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Sending...';
      }

      try {
        if (typeof emailjs !== 'undefined' && window.EMAILJS_PUBLIC_KEY) {
          await emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
            to_email: targetEmail,
            subject: subject,
            message: plainText,
            from_name: 'Al-Huda Islamic Centre Payroll (ceoislamiccentre@gmail.com)'
          });
        }
      } catch (eJsErr) {
        console.warn('Salary slip emailjs dispatch notice:', eJsErr);
      }

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }

      if (!isSilent) {
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(targetEmail)}&cc=ceoislamiccentre@gmail.com&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;
        window.open(gmailUrl, '_blank');
        if (typeof lmsNotify === 'function') lmsNotify(`Official Salary Slip email prepared for ${targetEmail}`, { type: 'success' });
        else alert(`Official Salary Slip email prepared for ${targetEmail}`);
      } else {
        if (typeof lmsNotify === 'function') lmsNotify(`Official Salary Slip email dispatched to ${targetEmail}`, { type: 'success' });
      }
    }
    window.sendSalarySlipEmailModal = sendSalarySlipEmailModal;
