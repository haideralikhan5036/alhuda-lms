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

    // ======================================================================
    // Phase 2 (2026-11-03): assignment-based engine helpers.
    // Course rates now come from the central Course Payment Settings
    // (js/course-catalogue.js, D1 key course_rates_v1) — the old hardcoded
    // ACADEMY_COURSE_RATES table and the substring rate rules are gone
    // from the compile path. The legacy substring rate function was
    // removed in Phase 3 once the Teacher 360 display converged onto
    // this same engine (no callers remain).
    // ======================================================================
    function payrollSettings() {
      try {
        if (window.CourseCatalogue) return CourseCatalogue.getSettings();
      } catch (e) {}
      return { basic_salary_pkr: 0, weekend_rate: 0, courses: [] };
    }

    // ======================================================================
    // Salary Commission #2 Phase 1 (2026-11-05): SLOT-BASED PRICING +
    // DAILY ACCRUAL — owner decisions D1-D8 (audit §8, as edited by the
    // owner; report SALARY-SLOT-ACCRUAL-AUDIT-2026-11-05):
    //  D1 slots = session minutes / 30 from the schedule CLOCK times;
    //     duplicate rows (same day + start) count once; how many days a
    //     week the student attends is irrelevant; differing day lengths
    //     -> the most common length (tie -> the longer); no schedule
    //     rows -> 1 slot; fractional slots allowed (45 min = 1.5).
    //  D2 the seniority increment is PER SLOT on course lines:
    //     full rate = (course rate + increment) x slots.
    //  D3 the weekend rate stays FLAT per student (weekend rate +
    //     increment, NEVER x slots) and the weekend day set expands to
    //     {Mon, Fri, Sat, Sun} = day_of_week {1, 5, 6, 7}.
    //  D8 lines for English Translation & Tafseer
    //     (catalogue id crs-tafseer-english, aliases included) are
    //     EXEMPT from the seniority increment.
    //  D5 CUTOVER GATE: salary months >= 2026-11 price with the new
    //     rules ('v2'); months <= 2026-10 reproduce the legacy formula
    //     EXACTLY ('v1': weekend = days within {6,7} only, full rate =
    //     base + increment per line, no exemption, slots factor 1).
    // Both the Admin compile and the Teacher 360 mirror compile price
    // through these helpers and this one gate, so they cannot disagree.
    // ======================================================================
    const PAYROLL_SLOTS_CUTOVER = '2026-11';
    function payrollPricingVersion(monthStr) {
      const bounds = parsePayrollMonthBounds(monthStr);
      const ym = `${bounds.year}-${String(bounds.monthIndex + 1).padStart(2, '0')}`;
      return ym >= PAYROLL_SLOTS_CUTOVER ? 'v2' : 'v1';
    }

    // Session length in minutes from the CLOCK times (the stored
    // duration_mins field contradicts the clock on live rows, so it is
    // only a fallback for rows missing a time). An end at or before the
    // start is an overnight session: +24h, like the codebase's other
    // time helpers treat a midnight end.
    function payrollSessionMinutes(row) {
      const toMin = (v) => {
        const parts = String(v || '').trim().slice(0, 5).split(':').map(Number);
        return (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) ? null : parts[0] * 60 + parts[1];
      };
      const s = toMin(row && row.start_time);
      const e = toMin(row && row.end_time);
      if (s == null || e == null) {
        const dm = parseFloat(row && row.duration_mins);
        return isNaN(dm) ? 0 : dm;
      }
      let d = e - s;
      if (d <= 0) d += 1440;
      return d;
    }

    // D1: the slot count for one student's sessions with one teacher.
    function payrollComputeSlots(stuScheds) {
      const rows = Array.isArray(stuScheds) ? stuScheds : [];
      if (!rows.length) return 1;
      const seen = new Set();
      const lengths = [];
      rows.forEach(r => {
        if (!r) return;
        const key = `${Number(r.day_of_week)}|${String(r.start_time || '').trim().slice(0, 5)}`;
        if (seen.has(key)) return; // duplicate row: the session counts once
        seen.add(key);
        const mins = payrollSessionMinutes(r);
        if (mins > 0) lengths.push(mins);
      });
      if (!lengths.length) return 1;
      const counts = new Map();
      lengths.forEach(m => counts.set(m, (counts.get(m) || 0) + 1));
      let best = lengths[0], bestCount = 0;
      counts.forEach((c, m) => {
        if (c > bestCount || (c === bestCount && m > best)) { best = m; bestCount = c; }
      });
      return best / 30;
    }
    window.PayrollSlots = { compute: payrollComputeSlots, sessionMinutes: payrollSessionMinutes };

    function payrollFormatSlots(n) {
      return String(Math.round((Number(n) || 0) * 100) / 100);
    }

    // The slot count a compiled line prices with: a real ledger row's
    // stored `slots` wins — it is that segment's recorded history, so a
    // later schedule edit cannot rewrite an earlier segment. Derived
    // periods and rows written before the slots column existed compute
    // live from the student's current schedules.
    function payrollSegmentSlots(assignment, stuScheds) {
      const stored = assignment ? parseFloat(assignment.slots) : NaN;
      if (!isNaN(stored) && stored > 0) return stored;
      return payrollComputeSlots(stuScheds);
    }

    // Weekend test (D3): v1 = every class day within {Sat, Sun}; v2 =
    // every class day within {Mon, Fri, Sat, Sun} (owner update
    // 2026-11-05). A Tue/Wed/Thu class anywhere disqualifies, and a
    // student with no rows is never a weekend student.
    function payrollIsWeekendStudent(stuScheds, version) {
      const dayNums = (stuScheds || []).map(s => Number(s && s.day_of_week));
      if (!dayNums.length) return false;
      const allowed = version === 'v2' ? [1, 5, 6, 7] : [6, 7];
      return dayNums.every(d => allowed.includes(d));
    }

    function payrollTodayStr() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function payrollDateMax(a, b) { return !a ? (b || null) : (!b ? a : (a > b ? a : b)); }
    function payrollDateMin(a, b) { return !a ? (b || null) : (!b ? a : (a < b ? a : b)); }
    function payrollDaysInclusive(startStr, endStr) {
      if (!startStr || !endStr) return 0;
      const s = Date.parse(String(startStr).slice(0, 10) + 'T00:00:00Z');
      const e = Date.parse(String(endStr).slice(0, 10) + 'T00:00:00Z');
      if (isNaN(s) || isNaN(e) || e < s) return 0;
      return Math.round((e - s) / 86400000) + 1;
    }

    // Resolve the payable rate for one assignment period from the
    // catalogue. Returns { ok:false, reason } when the course cannot be
    // priced — the caller surfaces it in the pre-flight warning list and
    // excludes the line; there is NO silent default rate anymore.
    // `version` is the D5 pricing gate ('v1' legacy / 'v2' slot-based)
    // chosen by the caller from the salary month; omitted = 'v1', the
    // function's historical behaviour.
    function resolveAssignmentRate(assignment, student, stuScheds, settings, version) {
      const name = (assignment && assignment.course_name) || (window.Assignments ? Assignments.studentCourseName(student) : '') || '';
      const entry = window.CourseCatalogue ? CourseCatalogue.resolveByName(name) : null;
      const isWeekend = payrollIsWeekendStudent(stuScheds, version);
      if (!entry) {
        return { ok: false, isWeekend, courseName: name, courseId: null, reason: name ? `Course "${name}" is not in the Course Payment Settings list` : 'No course is set for this student' };
      }
      if (!entry.active) {
        return { ok: false, isWeekend, courseName: name, courseId: entry.id, reason: `Course "${entry.name}" is switched off in Course Payment Settings` };
      }
      if (!(entry.monthly_rate > 0)) {
        return { ok: false, isWeekend, courseName: name, courseId: entry.id, reason: `Course "${entry.name}" has no rate in Course Payment Settings` };
      }
      if (isWeekend && entry.weekend_eligible !== false && (parseInt(settings && settings.weekend_rate, 10) || 0) > 0) {
        return { ok: true, baseRate: parseInt(settings.weekend_rate, 10) || 0, courseLabel: version === 'v2' ? 'Weekend Quran (Fri - Mon)' : 'Weekend Quran (Saturday & Sunday)', isWeekend: true, weekendFlat: true, courseName: name, courseId: entry.id };
      }
      return { ok: true, baseRate: entry.monthly_rate, courseLabel: entry.name, isWeekend, courseName: name, courseId: entry.id };
    }

    // Proration for ONE assignment segment: the overlap of the assignment
    // period with the month, additionally bounded by the student's own
    // joining / deactivation dates (the same bounds the legacy whole-
    // student proration applied). Mirrors the return shape of
    // calculateStudentMonthlySalaryProration.
    // `asOfStr` (optional, Commission #2 Phase 1): additionally clamp
    // the payable window at that date — the daily-accrual variant of
    // the same segment. Without it the whole month is priced, exactly
    // as before.
    function assignmentSegmentProration(student, assignment, monthlyRate, monthStr, asOfStr) {
      const bounds = parsePayrollMonthBounds(monthStr);
      const { daysInMonth, firstDayStr, lastDayStr } = bounds;
      const fullRate = Number(monthlyRate) || 0;
      const { joiningDate, deactivationDate, assignmentEndDate } = extractStudentPayrollDates(student);
      const statusLower = String(student?.status || '').toLowerCase();
      const inactiveNoDate = (statusLower === 'inactive' || statusLower === 'left' || statusLower === 'deactivated') && !deactivationDate;

      let start = firstDayStr;
      start = payrollDateMax(start, joiningDate);
      start = payrollDateMax(start, assignment && assignment.start_date ? String(assignment.start_date).slice(0, 10) : null);
      let end = lastDayStr;
      end = payrollDateMin(end, deactivationDate);
      // Commission #2 Phase 3: the assignment-end stamp on the student
      // record bounds the segment exactly like a ledger end_date — the
      // tighter bound wins, so a derived segment (teacher portal) and
      // the real ledger segment (Admin) price the same last day.
      end = payrollDateMin(end, assignmentEndDate);
      end = payrollDateMin(end, assignment && assignment.end_date ? String(assignment.end_date).slice(0, 10) : null);
      end = payrollDateMin(end, asOfStr ? String(asOfStr).slice(0, 10) : null);

      const activeDays = inactiveNoDate ? 0 : payrollDaysInclusive(start, end);
      const proratedRate = activeDays >= daysInMonth ? fullRate : Math.round(fullRate * activeDays / daysInMonth);
      const reasons = [];
      if (activeDays > 0 && start > firstDayStr) reasons.push('From ' + start);
      if (activeDays > 0 && end < lastDayStr) reasons.push('Until ' + end);
      return {
        daysInMonth,
        activeDays,
        joiningDate,
        deactivationDate,
        assignmentEndDate,
        dailyRate: fullRate / daysInMonth,
        fullRate,
        proratedRate,
        isProrated: activeDays < daysInMonth,
        prorationLabel: `${activeDays} / ${daysInMonth} Days${reasons.length ? ' • ' + reasons.join(', ') : (activeDays >= daysInMonth ? ' (Full Month)' : '')}`,
        segStart: start,
        segEnd: end
      };
    }

    // Basic Salary Protection (owner policy, 2026-11-03): the guaranteed
    // monthly minimum from Course Payment Settings, PRORATED by the
    // teacher's own eligible days in the month (owner's decision: the
    // floor is prorated, not paid in full for partial months). Eligible
    // window = from the teacher's joining date; for a teacher who has
    // left (status Deactivated — no leaving date is recorded for
    // teachers), the last payable assignment day of the month stands in
    // as the employment end.
    // `asOfStr` (optional, Commission #2 Phase 1): clamp the teacher's
    // eligible window at that date — the accrued floor for daily
    // accrual, with the same rounding as the full-month floor.
    function teacherFloorAmount(teacher, acc, settings, bounds, lastPayableDayStr, asOfStr) {
      const base = parseInt(settings && settings.basic_salary_pkr, 10) || 0;
      if (base <= 0 || !teacher) return { floorAmount: 0, eligibleDays: 0 };
      const joining = (acc && acc.joining_date) || (teacher.created_at ? String(teacher.created_at).slice(0, 10) : null);
      let start = bounds.firstDayStr;
      if (joining && joining > start) start = joining;
      let end = bounds.lastDayStr;
      if (asOfStr && String(asOfStr).slice(0, 10) < end) end = String(asOfStr).slice(0, 10);
      if (String(teacher.status || '').toLowerCase() === 'deactivated') {
        if (!lastPayableDayStr) return { floorAmount: 0, eligibleDays: 0 };
        if (lastPayableDayStr < end) end = lastPayableDayStr;
      }
      const days = payrollDaysInclusive(start, end);
      if (days <= 0) return { floorAmount: 0, eligibleDays: 0 };
      return {
        floorAmount: days >= bounds.daysInMonth ? base : Math.round(base * days / bounds.daysInMonth),
        eligibleDays: days
      };
    }

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
     *
     * Commission #2 Phase 3 (2026-11-05): also returns assignmentEndDate —
     * the cross-portal consistency stamp written onto the student record
     * by the Phase 2 stop-accrual action in js/assignments.js (that
     * action lives in the ledger, which teachers cannot read, so the
     * teacher portal's derived compile needs the same bound on the
     * student record itself). Read from the student column of that name when present,
     * else the notes/profile `assignment_end_date`. Unlike the legacy
     * deactivation notes value it is NOT gated on the student's status:
     * an ended student stays Active (their classes continue), and the
     * stamp is exactly what bounds their pay.
     */
    function extractStudentPayrollDates(student) {
      if (!student) return { joiningDate: null, deactivationDate: null, assignmentEndDate: null, previousTeacherId: null };
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

      const rawAssignmentEnd = student.assignment_end_date || notesObj.assignment_end_date || cachedProfile.assignment_end_date || null;
      const assignmentEndDate = (rawAssignmentEnd && /^\d{4}-\d{2}-\d{2}/.test(String(rawAssignmentEnd))) ? String(rawAssignmentEnd).slice(0, 10) : null;

      const previousTeacherId = student.previous_teacher_id_before_deactivation || notesObj.previous_teacher_id_before_deactivation || cachedProfile.previous_teacher_id_before_deactivation || null;

      return { joiningDate, deactivationDate, assignmentEndDate, previousTeacherId };
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

    // Batch 2 (B7): manager-record detection for payroll visibility.
    // Mirrors the staff-grid detection (js/teachers.js): employee_type
    // 'manager' in record meta or the account map, the 'Manager' shift,
    // or any MGR- code id. A signed-in MANAGER must never see a Manager
    // account's payroll — not in the table, not in totals, not in a slip.
    function _payrollIsManagerRecord(t, accountsMap) {
      if (!t) return false;
      let meta = {};
      try {
        if (t.address && String(t.address).startsWith('{')) meta = JSON.parse(t.address);
        else if (t.witness_name && String(t.witness_name).startsWith('{')) meta = JSON.parse(t.witness_name);
        else if (t.notes && String(t.notes).startsWith('{')) meta = JSON.parse(t.notes);
      } catch (e) {}
      const acc = (accountsMap && accountsMap[t.id]) || {};
      return meta.employee_type === 'manager' || acc.employee_type === 'manager' ||
        t.working_shift === 'Manager' ||
        String(t.id || '').startsWith('MGR-') ||
        String(meta.emp_id || '').startsWith('MGR-') ||
        String(acc.teacher_id || '').startsWith('MGR-') ||
        String(t.witness_name || '').startsWith('MGR-');
    }

    function _payrollBlockManagerRecord(teacherId) {
      if (typeof CURRENT_ROLE === 'undefined' || CURRENT_ROLE !== 'manager') return false;
      const rec = (ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
      if (!rec) return false;
      let accounts = {};
      try { accounts = getTeacherAccounts(); } catch (e) {}
      if (_payrollIsManagerRecord(rec, accounts)) {
        lmsNotify('Manager accounts are managed by the owner only. Their payroll is not visible to managers.');
        return true;
      }
      return false;
    }

    // Manager Profile Redesign, Stage 2 Phase 1 (2026-11-05): the meta a
    // record's FIXED salary is read from — the record meta JSON (the
    // teachers-row `address`, falling back to `notes`, then
    // `witness_name`: the same precedence getEmployeeRoleClassification
    // uses) merged OVER the account-map entry, so the record meta wins
    // where both homes carry a value and the account map (which the
    // employee form also writes monthly_salary into) stays the fallback.
    function _payrollFixedSalaryMeta(t, acc) {
      const tryParse = (v) => {
        if (typeof v === 'string' && v.trim().startsWith('{')) {
          try { const o = JSON.parse(v); if (o && typeof o === 'object') return o; } catch (e) {}
        } else if (v && typeof v === 'object') return v;
        return null;
      };
      const recMeta = tryParse(t && t.address) || tryParse(t && t.notes) || tryParse(t && t.witness_name) || {};
      return { ...(acc || {}), ...recMeta };
    }

    // Accrual block for a FROZEN slip (Commission #2 Phase 1): the
    // frozen maths is never touched — the saved totals simply stand as
    // the month-end position (asOf = month end, nothing remaining).
    function frozenSlipAccrual(savedSlip, studentRateItems, baseSubtotal, basicProtection, monthBounds) {
      const earnedStudents = studentRateItems.reduce((s, it) => s + (parseFloat(it.final_rate) || 0), 0);
      return {
        asOf: monthBounds.lastDayStr,
        earnedStudents,
        floorAccrued: savedSlip && savedSlip.floor_amount != null ? (parseFloat(savedSlip.floor_amount) || 0) : baseSubtotal,
        protectionAccrued: parseFloat(basicProtection) || 0,
        grossEarned: baseSubtotal,
        remaining: 0,
        totalSlots: studentRateItems.reduce((s, it) => s + (parseFloat(it.slots) || 1), 0),
        daysElapsed: monthBounds.daysInMonth,
        daysInMonth: monthBounds.daysInMonth,
        dailyAccrual: Math.round((baseSubtotal / monthBounds.daysInMonth) * 100) / 100
      };
    }

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

      // Batch 2 (B7): in a manager session, Manager accounts are
      // excluded from the payroll table AND from every total/KPI, so
      // their salaries never leak — not even as an aggregate figure.
      if (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') {
        teachers = (teachers || []).filter(t => !_payrollIsManagerRecord(t, accounts));
        if (teachers.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400">No teachers found in the academy database.</td></tr>';
          const setEl0 = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
          setEl0('payrollKpiTotal', '0 PKR');
          setEl0('payrollKpiTeachers', '0 Active');
          setEl0('payrollKpiStudents', '0 Enrolled');
          setEl0('payrollKpiDisbursed', '0 / 0 Paid');
          const kpiEarned0 = document.getElementById('payrollKpiEarned');
          if (kpiEarned0) { kpiEarned0.innerText = ''; kpiEarned0.classList.add('hidden'); }
          return;
        }
      }

      // Phase 2 (2026-11-03): the assignment ledger drives the compile.
      // Real ledger rows are loaded once; students without rows get a
      // derived period (Assignments.deriveFor), so no live record needed
      // a backfill write for the new engine to cover everyone.
      const payrollCfg = payrollSettings();
      const monthBounds = parsePayrollMonthBounds(selectedMonth);
      let assignmentRows = [];
      if (window.Assignments) {
        try { assignmentRows = await Assignments.loadAll(); } catch (e) { assignmentRows = []; }
        try { assignmentRows = assignmentRows.concat(Assignments.deriveFor(students, assignmentRows, scheds)); } catch (e) {}
      }
      const payrollWarnings = [];

      // Commission #2 Phase 1: the D5 pricing gate for this month and
      // the daily-accrual as-of date (today, never past the month end;
      // for a past month this is the month end, so accrual == potential).
      const pricingVersion = payrollPricingVersion(selectedMonth);
      const accrualAsOf = payrollDateMin(payrollTodayStr(), monthBounds.lastDayStr);

      // Commission #2 Phase 3: earned-to-date displays are shown ONLY
      // for the current calendar month — for a past month the accrual
      // equals the potential (noise) and for a future month it is 0.
      const _payrollNow = new Date();
      const isCurrentMonth = monthBounds.year === _payrollNow.getFullYear() && monthBounds.monthIndex === _payrollNow.getMonth();
      let totalEarnedToDate = 0;

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
        const forceRecalc = !!(window.__PAYROLL_RECALC_KEYS && window.__PAYROLL_RECALC_KEYS.has(slipKey));
        if (forceRecalc) window.__PAYROLL_RECALC_KEYS.delete(slipKey);

        // Historical Month Protection (Phase 2: freeze on FIRST save):
        // any saved slip with a finalized student snapshot — Pending or
        // Paid — is preserved exactly as saved, so later course changes,
        // rate edits or deactivations never alter it. The slip modal's
        // Recalculate button is the only way back to a live compile.
        if (!forceRecalc && savedSlip && Array.isArray(savedSlip.student_items_snapshot) && savedSlip.student_items_snapshot.length > 0) {
          const studentRateItems = savedSlip.student_items_snapshot;
          const baseSubtotal = savedSlip.base_subtotal !== undefined
            ? (parseFloat(savedSlip.base_subtotal) || 0)
            : studentRateItems.reduce((accSum, item) => accSum + (parseFloat(item.final_rate) || 0), 0);
          const bonus = parseFloat(savedSlip.bonus) || 0;
          const deduction = parseFloat(savedSlip.deduction) || 0;
          const remarks = savedSlip.remarks || '';
          // Canonical net (Batch B): subtract approved advances too.
          // Legacy slips carry no advance_deducted, so this is identical
          // to the old formula for them.
          const advanceDeducted = parseFloat(savedSlip.advance_deducted) || 0;
          const netPayable = Math.max(0, baseSubtotal + bonus - deduction - advanceDeducted);
          const frozenStatus = savedSlip.status || 'Pending';
          const frozenProtection = parseFloat(savedSlip.basic_protection) || 0;

          if (studentRateItems.length > 0) activeTeachersCount++;
          totalAssignedStudentsCount += studentRateItems.length;
          if (frozenStatus === 'Paid') paidCount++;
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
            students_subtotal: savedSlip.students_subtotal != null ? (parseFloat(savedSlip.students_subtotal) || 0) : (baseSubtotal - frozenProtection),
            basic_protection: frozenProtection,
            floor_amount: parseFloat(savedSlip.floor_amount) || 0,
            frozen: true,
            bonus,
            deduction,
            remarks,
            net_payable: netPayable,
            status: frozenStatus,
            advance_deducted: advanceDeducted,
            slip_key: slipKey,
            pricing_version: pricingVersion,
            accrual: frozenSlipAccrual(savedSlip, studentRateItems, baseSubtotal, frozenProtection, monthBounds)
          };
          ALL_TEACHER_SALARIES[t.id] = compiledSlip;
        } else {
          // Phase 2: this teacher's lines come from their assignment
          // periods overlapping the month (real ledger rows + derived
          // periods). A mid-month transfer or course change naturally
          // produces two lines, each paid for its own eligible days —
          // the old schedule-union + previous-teacher union (and its
          // double-claim leak) is replaced by the ledger.
          const teacherScheds = (scheds || []).filter(s => s.teacher_id === t.id);
          const teacherAssignments = assignmentRows.filter(a => String(a.teacher_id) === String(t.id));

          // Teaching-category determination (Phase 2, owner policy
          // 2026-11-03) — hoisted above the line compile because the
          // fixed-salary branch below is decided here; the Basic Salary
          // Protection block further down uses this same value.
          const isTeachingCategory = !_payrollIsManagerRecord(t, accounts) &&
            (typeof StaffCategories === 'undefined' || StaffCategories.of(t) === 'teaching');
          // Manager Profile Redesign, Stage 2 Phase 1 (2026-11-05): a
          // NON-teaching record with NO assignment lines is paid its
          // FIXED salary — the student/slot compile below produces no
          // lines for it and its base comes from FixedSalary instead.
          // A non-teaching record that still carries assignment lines
          // keeps the legacy student compile, so student-based pay is
          // never silently zeroed. (In production, managers and other
          // non-teaching staff cannot be assigned students at all, so
          // their line set is empty by construction.)
          const isFixedBasis = !isTeachingCategory && teacherAssignments.length === 0;
          const fixedMonthKey = `${monthBounds.year}-${String(monthBounds.monthIndex + 1).padStart(2, '0')}`;
          const fixedBase = (isFixedBasis && typeof FixedSalary !== 'undefined' && FixedSalary)
            ? FixedSalary.amountForMonth(_payrollFixedSalaryMeta(t, acc), fixedMonthKey)
            : 0;

          let studentsSubtotal = 0;
          const studentRateItems = [];
          const linesByStudent = {};

          teacherAssignments.forEach((asg) => {
            const stu = (students || []).find(s => String(s.id) === String(asg.student_id));
            if (!stu || !stu.name || stu.status === 'Trial') return;
            const stuScheds = teacherScheds.filter(s => s.student_id === stu.id);
            const rateInfo = resolveAssignmentRate(asg, stu, stuScheds, payrollCfg, pricingVersion);
            if (!rateInfo.ok) {
              // Pre-flight: never a silent fallback rate. The student is
              // excluded and named in the warning strip above the table.
              payrollWarnings.push({ teacher_name: t.full_name, student_name: stu.name, reason: rateInfo.reason });
              return;
            }
            // Commission #2 Phase 1 pricing (owner decisions D1/D2/D3/
            // D8 behind the D5 gate). v1 reproduces the legacy line
            // exactly: full rate = base + increment, slots factor 1.
            // v2 prices course lines PER SLOT — (course rate +
            // increment) x slots — except weekend lines, which stay
            // FLAT per student (weekend rate + increment, never x
            // slots), and English Tafseer lines, whose increment is 0
            // (D8 exemption).
            const lineSlots = pricingVersion === 'v2' ? payrollSegmentSlots(asg, stuScheds) : 1;
            const lineIncrement = (pricingVersion === 'v2' && rateInfo.courseId === 'crs-tafseer-english') ? 0 : teacherIncrement;
            const fullRate = rateInfo.weekendFlat
              ? rateInfo.baseRate + lineIncrement
              : (rateInfo.baseRate + lineIncrement) * lineSlots;
            const proration = assignmentSegmentProration(stu, asg, fullRate, selectedMonth);
            if (proration.activeDays === 0) return;
            // Daily accrual (D4): the SAME segment priced with its
            // payable window clamped at accrualAsOf, same rounding.
            const accrualProration = assignmentSegmentProration(stu, asg, fullRate, selectedMonth, accrualAsOf);
            const schedKind = rateInfo.isWeekend
              ? (pricingVersion === 'v2' ? 'Weekend (Fri - Mon)' : 'Weekend (Sat - Sun)')
              : (stuScheds.length ? stuScheds.length + ' Days / Week' : 'Regular Days');
            const item = {
              index: 0,
              assignment_id: asg.id || null,
              student_id: stu.id,
              student_name: stu.name,
              course_label: rateInfo.courseLabel,
              schedule_text: `${pricingVersion === 'v2' ? payrollFormatSlots(lineSlots) + ' Slot' + (lineSlots === 1 ? '' : 's') + ' • ' : ''}${schedKind} (${proration.prorationLabel})`,
              slots: lineSlots,
              accrued_rate: accrualProration.proratedRate,
              accrued_days: accrualProration.activeDays,
              proration_label: proration.prorationLabel,
              active_days: proration.activeDays,
              days_in_month: proration.daysInMonth,
              joining_date: proration.segStart,
              deactivation_date: proration.segEnd < monthBounds.lastDayStr ? proration.segEnd : proration.deactivationDate,
              seg_end: proration.segEnd,
              is_prorated: proration.isProrated,
              base_rate: rateInfo.baseRate,
              increment: lineIncrement,
              full_monthly_rate: fullRate,
              calculated_rate: proration.proratedRate,
              final_rate: proration.proratedRate
            };
            studentRateItems.push(item);
            (linesByStudent[stu.id] = linesByStudent[stu.id] || []).push(item);
          });

          // Saved per-student manual amounts on older records (saved
          // before freeze-on-save existed) still win: the student's
          // lines are scaled so their total equals the saved amount.
          // (Never for a fixed-basis record: its base is the fixed
          // salary, not per-student amounts.)
          if (savedSlip && savedSlip.students && !isFixedBasis) {
            Object.keys(linesByStudent).forEach((sid) => {
              if (savedSlip.students[sid] === undefined) return;
              const target = parseFloat(savedSlip.students[sid]);
              if (isNaN(target)) return;
              const lines = linesByStudent[sid];
              const sum = lines.reduce((accSum, it) => accSum + it.final_rate, 0);
              if (sum > 0 && target !== sum) {
                let acc = 0;
                lines.forEach((it, i) => {
                  const oldFinal = it.final_rate;
                  if (i === lines.length - 1) it.final_rate = target - acc;
                  else { it.final_rate = Math.round(it.final_rate * target / sum); acc += it.final_rate; }
                  // Commission #2 Phase 1: the line's accrued amount
                  // scales by the same ratio, so earned-so-far stays in
                  // proportion to the manually agreed potential.
                  if (oldFinal > 0) it.accrued_rate = Math.round((parseFloat(it.accrued_rate) || 0) * it.final_rate / oldFinal);
                });
              } else if (sum === 0 && target > 0 && lines.length) {
                lines[0].final_rate = target;
                lines[0].accrued_rate = target;
              }
            });
            // A saved amount for a student whose period no longer
            // overlaps this month re-adds a single manual line (the old
            // engine's override behaviour).
            Object.keys(savedSlip.students).forEach((sid) => {
              if (linesByStudent[sid]) return;
              const target = parseFloat(savedSlip.students[sid]);
              if (isNaN(target) || target <= 0) return;
              const stu = (students || []).find(s => String(s.id) === String(sid));
              if (!stu) return;
              studentRateItems.push({
                index: 0, assignment_id: null, student_id: stu.id, student_name: stu.name,
                course_label: 'Manual Amount', schedule_text: 'Manual override', proration_label: '',
                active_days: 0, days_in_month: monthBounds.daysInMonth, joining_date: null,
                deactivation_date: null, seg_end: monthBounds.lastDayStr, is_prorated: false,
                base_rate: 0, increment: teacherIncrement, full_monthly_rate: target,
                calculated_rate: target, final_rate: target,
                // Manual amounts are admin-agreed, not time-priced:
                // they count in full toward both potential and earned.
                slots: 1, accrued_rate: target, accrued_days: 0
              });
            });
          }

          studentRateItems.forEach((it, i) => { it.index = i + 1; });
          studentsSubtotal = studentRateItems.reduce((accSum, it) => accSum + (parseFloat(it.final_rate) || 0), 0);

          if (studentRateItems.length > 0) activeTeachersCount++;
          totalAssignedStudentsCount += studentRateItems.length;

          // Bonuses and Deductions
          const bonus = savedSlip ? (parseFloat(savedSlip.bonus) || 0) : 0;
          const deduction = savedSlip ? (parseFloat(savedSlip.deduction) || 0) : 0;
          const remarks = savedSlip ? (savedSlip.remarks || '') : '';
          // Canonical net (Batch B): approved advances are NOT lumped
          // into `deduction` (that would double-count on dual-write),
          // they live in advance_deducted and are subtracted here.
          const advanceDeducted = savedSlip ? (parseFloat(savedSlip.advance_deducted) || 0) : 0;

          // Basic Salary Protection (Phase 2, owner policy 2026-11-03):
          // Teaching-category teachers are guaranteed the configured
          // monthly minimum, prorated by their own eligible days. The
          // protection is the shortfall only — never added on top of a
          // higher student-based total, never multiplied per student.
          let floorAmount = 0;
          let basicProtection = 0;
          // (isTeachingCategory is determined above the line compile.)
          let lastPayableDay = null;
          studentRateItems.forEach(it => {
            if (it.seg_end && (!lastPayableDay || it.seg_end > lastPayableDay)) lastPayableDay = it.seg_end;
          });
          if (isTeachingCategory) {
            const floorRes = teacherFloorAmount(t, acc, payrollCfg, monthBounds, lastPayableDay);
            floorAmount = floorRes.floorAmount;
            basicProtection = Math.max(0, floorAmount - studentsSubtotal);
          }
          // Stage 2 Phase 1: a fixed-basis record's base IS its fixed
          // salary for the month — no student subtotal, no protection.
          const baseSubtotal = isFixedBasis ? fixedBase : (studentsSubtotal + basicProtection);

          // Daily accrual (Commission #2 Phase 1, decision D4): what
          // this teacher has EARNED up to accrualAsOf — per-line accrued
          // amounts summed, the floor accrued over the teacher's
          // eligible window clamped at the same date, and the accrued
          // protection compared ONCE against the accrued aggregate
          // (never per line, never added on top). The headline figure
          // is GROSS earned: bonus / deductions / advances stay
          // month-end slip items and are not baked in. At the month
          // end every accrued figure equals its potential counterpart.
          const daysElapsed = payrollDaysInclusive(monthBounds.firstDayStr, accrualAsOf);
          // Stage 2 Phase 1: a fixed salary accrues LINEARLY across the
          // month, with the same rounding as a segment proration (full
          // amount at the month end; Math.round(base x elapsed / days)
          // before it). No floor, no protection, no slots.
          const fixedEarned = daysElapsed >= monthBounds.daysInMonth
            ? fixedBase
            : Math.round(fixedBase * daysElapsed / monthBounds.daysInMonth);
          const earnedStudents = isFixedBasis
            ? fixedEarned
            : studentRateItems.reduce((s, it) => s + (parseFloat(it.accrued_rate) || 0), 0);
          const floorAccrued = isTeachingCategory
            ? teacherFloorAmount(t, acc, payrollCfg, monthBounds, lastPayableDay, accrualAsOf).floorAmount
            : 0;
          const protectionAccrued = isFixedBasis ? 0 : Math.max(0, floorAccrued - earnedStudents);
          const grossEarned = isFixedBasis ? fixedEarned : (earnedStudents + protectionAccrued);
          const accrual = {
            asOf: accrualAsOf,
            earnedStudents,
            floorAccrued,
            protectionAccrued,
            grossEarned,
            remaining: baseSubtotal - grossEarned,
            totalSlots: studentRateItems.reduce((s, it) => s + (parseFloat(it.slots) || 1), 0),
            daysElapsed,
            daysInMonth: monthBounds.daysInMonth,
            dailyAccrual: Math.round((baseSubtotal / monthBounds.daysInMonth) * 100) / 100
          };
          const netPayable = Math.max(0, baseSubtotal + bonus - deduction - advanceDeducted);
          const status = savedSlip ? (savedSlip.status || 'Pending') : 'Pending';

          if (status === 'Paid') paidCount++;
          totalGrossPayroll += netPayable;

          const compiledSlip = {
            teacher_id: t.id,
            teacher_name: t.full_name,
            phone: t.phone,
            month: selectedMonth,
            joining_date: acc.joining_date || (t.created_at ? t.created_at.slice(0, 10) : '2025-01-01'),
            seniority_increment: isFixedBasis ? 0 : teacherIncrement,
            assigned_students: studentRateItems,
            base_subtotal: baseSubtotal,
            students_subtotal: studentsSubtotal,
            basic_protection: basicProtection,
            floor_amount: floorAmount,
            frozen: false,
            bonus,
            deduction,
            remarks,
            net_payable: netPayable,
            status,
            advance_deducted: advanceDeducted,
            slip_key: slipKey,
            pricing_version: pricingVersion,
            accrual,
            ...(isFixedBasis ? { pay_basis: 'fixed' } : {})
          };

          ALL_TEACHER_SALARIES[t.id] = compiledSlip;
        }

        const compiledSlip = ALL_TEACHER_SALARIES[t.id];
        const studentRateItems = compiledSlip.assigned_students || [];
        const baseSubtotal = compiledSlip.base_subtotal;
        const studentsSubtotal = compiledSlip.students_subtotal != null ? compiledSlip.students_subtotal : baseSubtotal;
        const basicProtection = compiledSlip.basic_protection || 0;
        const bonus = compiledSlip.bonus;
        const deduction = compiledSlip.deduction;
        const advanceDeducted = compiledSlip.advance_deducted || 0;
        const netPayable = compiledSlip.net_payable;
        const status = compiledSlip.status;

        // Commission #2 Phase 3: accrual display figures for this row.
        // A frozen slip's accrual mirrors the month end, so its
        // earned sub-line is suppressed (and it stays out of the KPI
        // earned-to-date sum) — the live rows carry the live figures.
        const accrualInfo = compiledSlip.accrual || null;
        const showEarnedLines = isCurrentMonth && !compiledSlip.frozen && !!accrualInfo;
        if (showEarnedLines) totalEarnedToDate += accrualInfo.grossEarned || 0;
        const accrualAsOfLabel = accrualInfo && accrualInfo.asOf
          ? new Date(String(accrualInfo.asOf).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
          : '';

        // Seniority text (read from the compiled slip: a fixed-basis
        // record's slip carries seniority_increment 0, so it can never
        // show a per-student increment badge)
        const yrs = Math.floor((new Date() - new Date(compiledSlip.joining_date)) / (365.25 * 24 * 3600 * 1000));
        let seniorityBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">Base</span>`;
        if ((compiledSlip.seniority_increment || 0) > 0) {
          seniorityBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">+${compiledSlip.seniority_increment} PKR/stu (Yr ${yrs || 1})</span>`;
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
        if (bonus > 0 || deduction > 0 || advanceDeducted > 0 || basicProtection > 0) {
          adjSummary = `
            <div class="text-[11px] font-mono">
              ${basicProtection > 0 ? `<span class="text-sky-700 font-bold block">+${basicProtection.toLocaleString()} PKR (Basic Salary Protection)</span>` : ''}
              ${bonus > 0 ? `<span class="text-emerald-700 font-bold block">+${bonus.toLocaleString()} PKR (Bonus)</span>` : ''}
              ${deduction > 0 ? `<span class="text-rose-700 font-bold block">-${deduction.toLocaleString()} PKR (Deduction)</span>` : ''}
              ${advanceDeducted > 0 ? `<span class="text-amber-700 font-bold block">-${advanceDeducted.toLocaleString()} PKR (Approved Advances)</span>` : ''}
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
              ${accrualInfo ? `<div class="text-[10px] text-slate-500 font-semibold mt-1">${compiledSlip.pay_basis === 'fixed' ? 'Fixed Salary' : `Slots: ${payrollFormatSlots(accrualInfo.totalSlots)}`} · Daily ≈ PKR ${(accrualInfo.dailyAccrual || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>` : ''}
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
              <div class="lms-num-financial font-bold text-slate-900 text-[15px]">PKR ${(compiledSlip.pay_basis === 'fixed' ? baseSubtotal : studentsSubtotal).toLocaleString()}</div>
              <span class="text-[11px] text-slate-500 block mt-0.5">${compiledSlip.pay_basis === 'fixed' ? 'Fixed Salary' : 'From Course Rates'}</span>
              ${showEarnedLines ? `
              <div class="text-[11px] text-emerald-700 font-bold mt-1">Earned till ${accrualAsOfLabel}: PKR ${(accrualInfo.grossEarned || 0).toLocaleString()}</div>
              <div class="text-[11px] text-slate-500">Remaining: PKR ${(accrualInfo.remaining || 0).toLocaleString()}</div>` : ''}
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

      // Pre-flight warnings (Phase 2): students whose course could not
      // be priced from the Course Payment Settings were excluded above —
      // name them visibly instead of paying a silent fallback rate.
      const warnEl = document.getElementById('payrollWarnings');
      if (warnEl) {
        if (payrollWarnings.length) {
          warnEl.classList.remove('hidden');
          warnEl.innerHTML = '<div class="font-extrabold mb-1">⚠ Some students were NOT included in this salary calculation:</div>' +
            payrollWarnings.map(w => `<div>• ${w.teacher_name} — ${w.student_name}: ${w.reason}. Fix the course in Course Payment Settings or on the student record, then refresh.</div>`).join('');
        } else {
          warnEl.classList.add('hidden');
          warnEl.innerHTML = '';
        }
      }

      // Update KPI Cards
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      setEl('payrollKpiTotal', `${totalGrossPayroll.toLocaleString()} PKR`);
      setEl('payrollKpiTeachers', `${activeTeachersCount} Active`);
      setEl('payrollKpiStudents', `${totalAssignedStudentsCount} Enrolled`);
      setEl('payrollKpiDisbursed', `${paidCount} / ${teachers.length} Paid`);
      // Commission #2 Phase 3: earned-to-date sub-line on the Total
      // card — current month only, live (non-frozen) slips only, the
      // same figure the per-teacher rows show.
      const kpiEarnedEl = document.getElementById('payrollKpiEarned');
      if (kpiEarnedEl) {
        if (isCurrentMonth) {
          kpiEarnedEl.innerText = `Earned to date: ${totalEarnedToDate.toLocaleString()} PKR`;
          kpiEarnedEl.classList.remove('hidden');
        } else {
          kpiEarnedEl.innerText = '';
          kpiEarnedEl.classList.add('hidden');
        }
      }
    }

    // OPEN ITEMIZED & EDITABLE SALARY SLIP MODAL
    function openSalarySlipModal(teacherId) {
      // Batch 2 (B7): a manager can never open a Manager account's slip.
      if (_payrollBlockManagerRecord(teacherId)) return;
      const slipData = ALL_TEACHER_SALARIES[teacherId];
      if (!slipData) {
        lmsNotify("Salary data not available for this instructor.");
        return;
      }

      CURRENT_SLIP_TEACHER_ID = teacherId;
      CURRENT_SLIP_DATA = slipData;

      document.getElementById('slipTeacherId').value = teacherId;
      document.getElementById('slipMonthSubtitle').innerText = `Official Teacher Compensation & Course Payroll Statement for ${slipData.month}`;
      document.getElementById('slipTeacherName').innerText = slipData.teacher_name;
      document.getElementById('slipTeacherCode').innerText = teacherId.slice(0, 8).toUpperCase();
      document.getElementById('slipJoiningDate').innerText = slipData.joining_date;

      // Employees redesign E2 (2026-10-29): Management / Non-Teaching
      // slips have NO student breakdown. The students section and the
      // per-student increment are omitted entirely for those categories
      // (never a 'No students assigned' message); their salary amounts,
      // advances and history below are untouched.
      const slipTeacherRec = (window.ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
      const slipIsTeaching = !slipTeacherRec || typeof StaffCategories === 'undefined' || StaffCategories.of(slipTeacherRec) === 'teaching';
      const studentsSection = document.getElementById('slipStudentsSection');
      if (studentsSection) studentsSection.classList.toggle('hidden', !slipIsTeaching);
      const incCell = document.getElementById('slipIncrementCell');
      if (incCell) incCell.classList.toggle('hidden', !slipIsTeaching);

      const incBadge = document.getElementById('slipIncrementTierBadge');
      if (incBadge) {
        incBadge.innerText = slipData.seniority_increment > 0 
          ? `+${slipData.seniority_increment} PKR / Student` 
          : 'Base Level (0 PKR)';
      }

      // Render editable students table (teaching staff only)
      const tbody = document.getElementById('slipStudentsTableBody');
      if (tbody && slipIsTeaching) {
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
                      data-student-id="${s.student_id}" data-line-key="${s.assignment_id || s.student_id}"
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

      // Recalculate is offered only for frozen (previously saved) slips.
      const recalcBtn = document.getElementById('btnSlipRecalculate');
      if (recalcBtn) recalcBtn.classList.toggle('hidden', !slipData.frozen);

      openModal('modalSalarySlip');
    }

    // Phase 2: the ONLY way back from a frozen slip to a live compile.
    // Marks this teacher+month for a one-shot live recompile, then
    // reopens the modal on the fresh numbers; nothing is written until
    // the admin saves the slip again.
    async function recalculateCurrentSlipFromData() {
      if (!CURRENT_SLIP_DATA || !CURRENT_SLIP_TEACHER_ID) return;
      if (_payrollBlockManagerRecord(CURRENT_SLIP_TEACHER_ID)) return;
      const ok = await lmsConfirm({
        title: 'Recalculate this salary?',
        message: 'The amounts saved for this month will be replaced by a fresh calculation from the current students, assignments and course rates when you save the slip.',
        confirmText: 'Recalculate',
        cancelText: 'Cancel',
        variant: 'info'
      });
      if (!ok) return;
      (window.__PAYROLL_RECALC_KEYS = window.__PAYROLL_RECALC_KEYS || new Set()).add(CURRENT_SLIP_DATA.slip_key);
      const tid = CURRENT_SLIP_TEACHER_ID;
      closeModal('modalSalarySlip');
      await calculateMonthlySalaries(true);
      openSalarySlipModal(tid);
    }

    function recalculateSlipNetTotal() {
      const rateInputs = document.querySelectorAll('.slip-student-rate');
      let studentsSubtotal = 0;
      rateInputs.forEach(inp => {
        studentsSubtotal += parseFloat(inp.value) || 0;
      });

      // Stage 2 Phase 1: a fixed-basis slip has no per-student rate
      // inputs — its base is the compiled fixed salary carried on the
      // slip data, so editing bonus/deduction (and saving from this
      // editor) can never collapse the base to zero.
      const isFixedSlip = (typeof CURRENT_SLIP_DATA !== 'undefined' && CURRENT_SLIP_DATA)
        ? CURRENT_SLIP_DATA.pay_basis === 'fixed'
        : false;
      if (isFixedSlip) studentsSubtotal = parseFloat(CURRENT_SLIP_DATA.base_subtotal) || 0;

      const bonus = parseFloat(document.getElementById('slipBonus')?.value) || 0;
      const deduction = parseFloat(document.getElementById('slipDeduction')?.value) || 0;
      // Canonical net (Batch B): approved advances on the slip being
      // edited are subtracted here too — otherwise opening the editor
      // and re-saving would silently erase the advance from the net.
      // The advance itself is never editable from this editor; it is
      // managed through the Requests approval workflow only.
      const advanceDeducted = (typeof CURRENT_SLIP_DATA !== 'undefined' && CURRENT_SLIP_DATA)
        ? (parseFloat(CURRENT_SLIP_DATA.advance_deducted) || 0)
        : 0;
      // Basic Salary Protection (Phase 2): the slip carries its prorated
      // floor from the compile; editing student amounts re-derives the
      // protection from the floor, exactly like the compile does.
      const floorAmount = (typeof CURRENT_SLIP_DATA !== 'undefined' && CURRENT_SLIP_DATA)
        ? (parseFloat(CURRENT_SLIP_DATA.floor_amount) || 0)
        : 0;
      const basicProtection = Math.max(0, floorAmount - studentsSubtotal);
      const baseSubtotal = studentsSubtotal + basicProtection;
      const netPayable = Math.max(0, baseSubtotal + bonus - deduction - advanceDeducted);

      const baseInp = document.getElementById('slipBaseSubtotal');
      if (baseInp) baseInp.value = studentsSubtotal;

      const protRow = document.getElementById('slipBasicProtectionRow');
      if (protRow) protRow.classList.toggle('hidden', basicProtection <= 0);
      const protVal = document.getElementById('slipBasicProtectionVal');
      if (protVal) protVal.innerText = `+${basicProtection.toLocaleString()} PKR`;

      const netEl = document.getElementById('slipNetPayable');
      if (netEl) netEl.innerText = `${netPayable.toLocaleString()} PKR`;

      const countEl = document.getElementById('slipTotalStudentsCount');
      if (countEl) countEl.innerText = `${isFixedSlip ? 'Fixed Salary' : `For ${rateInputs.length} Assigned Students`} (${studentsSubtotal.toLocaleString()} Base ${basicProtection > 0 ? '+ ' + basicProtection.toLocaleString() + ' Basic Protection' : ''} ${bonus > 0 ? '+ ' + bonus + ' Bonus' : ''} ${deduction > 0 ? '- ' + deduction + ' Deduction' : ''} ${advanceDeducted > 0 ? '- ' + advanceDeducted + ' Approved Advances' : ''})`;
      return { baseSubtotal, studentsSubtotal, basicProtection, floorAmount, bonus, deduction, advanceDeducted, netPayable };
    }

    function saveSalarySlipRecord() {
      if (!CURRENT_SLIP_DATA || !CURRENT_SLIP_TEACHER_ID) return;
      // Batch 2 (B7): defense in depth — never save a Manager slip in a manager session.
      if (_payrollBlockManagerRecord(CURRENT_SLIP_TEACHER_ID)) return;

      const { baseSubtotal, studentsSubtotal, basicProtection, floorAmount, bonus, deduction, advanceDeducted, netPayable } = recalculateSlipNetTotal();
      const remarks = (document.getElementById('slipRemarks')?.value || '').trim();

      // Collect edited rates PER LINE (Phase 2: one student can have two
      // assignment lines in a month — a per-student map would merge them).
      const editedLineRates = {};
      document.querySelectorAll('.slip-student-rate').forEach(inp => {
        const lineKey = inp.getAttribute('data-line-key') || inp.getAttribute('data-student-id');
        editedLineRates[lineKey] = parseFloat(inp.value) || 0;
      });

      const studentItemsSnapshot = (CURRENT_SLIP_DATA.assigned_students || []).map(item => {
        const lineKey = item.assignment_id || item.student_id;
        return {
          ...item,
          final_rate: editedLineRates[lineKey] !== undefined ? editedLineRates[lineKey] : item.final_rate
        };
      });

      // The legacy per-student map is kept as per-student SUMS of the
      // line amounts, for the older readers that still use it.
      const editedStudentRates = {};
      studentItemsSnapshot.forEach(item => {
        editedStudentRates[item.student_id] = (editedStudentRates[item.student_id] || 0) + (parseFloat(item.final_rate) || 0);
      });

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
        students_subtotal: studentsSubtotal,
        basic_protection: basicProtection,
        floor_amount: floorAmount,
        bonus,
        deduction,
        // Batch B: an admin re-save must NEVER wipe approved advances
        // (the old object literal had no advance_deducted key, so the
        // next dual-write would have zeroed the table column too).
        advance_deducted: advanceDeducted || 0,
        remarks,
        net_payable: netPayable,
        status: CURRENT_SLIP_DATA.status || 'Pending',
        saved_at: new Date().toISOString()
      };

      localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(savedSalaries));
      if (typeof syncGlobalSharedStateToCloud === 'function') {
        syncGlobalSharedStateToCloud({ teacherId: CURRENT_SLIP_TEACHER_ID });
      }

      // Batch 6B dual-write (fee_tables_v1 flag; no-op when off): the slip
      // is also written to the salary_slips table. The table mints the
      // slip_no on first write; it is written back into the stored legacy
      // record (same localStorage map this save already uses) so every
      // legacy copy carries the number.
      try {
        if (window.FeeTables && typeof window.FeeTables.dualWriteSlip === 'function') {
          const dwRecord = { ...savedSalaries[slipKey], slip_key: slipKey };
          if (typeof CURRENT_SLIP_DATA.paid_at !== 'undefined') dwRecord.paid_at = CURRENT_SLIP_DATA.paid_at;
          window.FeeTables.dualWriteSlip(CURRENT_SLIP_TEACHER_ID, dwRecord).then(function (res) {
            try {
              if (res && res.slipNo && !savedSalaries[slipKey].slip_no) {
                savedSalaries[slipKey].slip_no = res.slipNo;
                localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(savedSalaries));
              }
            } catch (e) { /* slip_no write-back is best-effort */ }
          }).catch(function () {});
        }
      } catch (e) { /* dual-write must never affect the legacy save */ }

      calculateMonthlySalaries();
      lmsNotify(`✅ Salary Slip Saved Successfully!\n\n👨‍🏫 Teacher: ${CURRENT_SLIP_DATA.teacher_name}\n💵 Base Teaching: ${studentsSubtotal.toLocaleString()} PKR${basicProtection > 0 ? `\n🛡 Basic Salary Protection: +${basicProtection.toLocaleString()} PKR` : ''}\n💰 Net Payable: ${netPayable.toLocaleString()} PKR\n📌 Status: ${savedSalaries[slipKey].status}`);
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
      // Batch 2 (B7): defense in depth — never flip a Manager slip's status in a manager session.
      if (_payrollBlockManagerRecord(CURRENT_SLIP_TEACHER_ID)) return;

      const nextStatus = (CURRENT_SLIP_DATA.status === 'Paid') ? 'Pending' : 'Paid';
      CURRENT_SLIP_DATA.status = nextStatus;
      // Batch 6B: remembered so the dual-write below (and the one inside
      // saveSalarySlipRecord) can stamp paid_at on the salary_slips row.
      // Table-only: the legacy stored record does not gain this field.
      CURRENT_SLIP_DATA.paid_at = nextStatus === 'Paid' ? new Date().toISOString() : null;

      updateSlipPaidButtonUI(nextStatus === 'Paid');
      saveSalarySlipRecord();

      // Batch 6B dual-write (fee_tables_v1 flag; no-op when off).
      try {
        if (window.FeeTables && typeof window.FeeTables.dualWriteSlip === 'function') {
          let dwSlip = null;
          try {
            const allSaved = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
            if (allSaved[CURRENT_SLIP_DATA.slip_key]) {
              dwSlip = { ...allSaved[CURRENT_SLIP_DATA.slip_key], slip_key: CURRENT_SLIP_DATA.slip_key, status: nextStatus, paid_at: CURRENT_SLIP_DATA.paid_at };
            }
          } catch (e) { /* fall through without a slip */ }
          if (dwSlip) window.FeeTables.dualWriteSlip(CURRENT_SLIP_TEACHER_ID, dwSlip);
        }
      } catch (e) { /* dual-write must never affect the legacy toggle */ }

      if (nextStatus === 'Paid') {
        setTimeout(async () => {
          if (await lmsConfirm({ title: 'Send salary statement email?', message: `Do you want to dispatch the finalized salary statement email to ${CURRENT_SLIP_DATA.teacher_name}?`, confirmText: 'Send Email', cancelText: 'Cancel', variant: 'info' })) {
            await sendSalarySlipEmailModal(CURRENT_SLIP_DATA, false);
          }
        }, 400);
      }
    }

    function quickToggleSalaryPaid(teacherId) {
      // Batch 2 (B7): a manager can never change a Manager slip's status.
      if (_payrollBlockManagerRecord(teacherId)) return;
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
      // Batch 6B dual-write (fee_tables_v1 flag; no-op when off): paid_at is
      // stamped on the salary_slips row only; the legacy record is unchanged.
      try {
        if (window.FeeTables && typeof window.FeeTables.dualWriteSlip === 'function') {
          const dwSlip = { ...savedSalaries[slipKey], slip_key: slipKey, paid_at: newStatus === 'Paid' ? new Date().toISOString() : null };
          window.FeeTables.dualWriteSlip(teacherId, dwSlip);
        }
      } catch (e) { /* dual-write must never affect the legacy toggle */ }
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
        lmsNotify("Teacher WhatsApp number is not registered.");
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
${academyName()} - Official Monthly Salary Statement for *${slipData.month}*

Teacher Name: ${slipData.teacher_name}
Joining Date: ${slipData.joining_date}
Seniority Increment: ${slipData.seniority_increment > 0 ? '+' + slipData.seniority_increment + ' PKR / student' : 'Standard Base Rate'}

Assigned Students & Course Breakdown:
${studentLines}

──────────────────
Base Teaching Amount: ${(slipData.students_subtotal != null ? slipData.students_subtotal : slipData.base_subtotal).toLocaleString()} PKR
${(slipData.basic_protection || 0) > 0 ? `Basic Salary Protection: +${slipData.basic_protection.toLocaleString()} PKR\n` : ''}${slipData.bonus > 0 ? `Bonus / Allowances: +${slipData.bonus.toLocaleString()} PKR\n` : ''}${slipData.deduction > 0 ? `Deductions / Advances: -${slipData.deduction.toLocaleString()} PKR\n` : ''}${slipData.remarks ? `Remarks: ${slipData.remarks}\n` : ''}Total Net Payable Salary: ${slipData.net_payable.toLocaleString()} PKR
Payment Status: ${slipData.status === 'Paid' ? 'Paid (Disbursed)' : 'Processing (Pending)'}
──────────────────

Jazakum Allahu Khairan!
${academyName()} Management`;

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
        lmsNotify("No salary slip data available to generate PDF.");
        return;
      }

      const sourceCard = document.getElementById('salarySlipReceiptCard') || document.querySelector('#modalSalarySlip > div') || document.getElementById('modalSalarySlip');
      if (!sourceCard) {
        lmsNotify("Salary slip modal is not active.");
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
            else lmsNotify('✅ Official Salary Slip PDF downloaded successfully!');
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
          else lmsNotify('✅ Official Salary Slip PDF downloaded!');
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
        lmsNotify("No active salary slip record available to send.");
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
          lmsNotify(`No valid email address found for ${slipData.teacher_name}. Please specify teacher email.`);
        }
        return;
      }

      const subject = `Official Salary Statement [${slipData.month}] — ${slipData.teacher_name} — ${academyName()}`;

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
Please find below your official monthly salary compensation statement for ${slipData.month} from ${academyName()}.

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
• Base Teaching Subtotal: PKR ${Number(slipData.students_subtotal != null ? slipData.students_subtotal : (slipData.base_subtotal || 0)).toLocaleString()}
${(slipData.basic_protection || 0) > 0 ? `• Basic Salary Protection: + PKR ${Number(slipData.basic_protection).toLocaleString()}\n` : ''}${slipData.bonus > 0 ? `• Bonus / Allowances: + PKR ${Number(slipData.bonus).toLocaleString()}\n` : ''}${slipData.deduction > 0 ? `• Deductions / Advances: - PKR ${Number(slipData.deduction).toLocaleString()}\n` : ''}${slipData.remarks ? `• Remarks: ${slipData.remarks}\n` : ''}• TOTAL NET PAYABLE: PKR ${Number(slipData.net_payable || 0).toLocaleString()}
• Disbursed Status: ${slipData.status === 'Paid' ? 'PAID / DISBURSED' : 'PENDING APPROVAL'}

Jazakumullahu Khairan!
${academyName()} Management
Official Accounts Email: ${academyEmail()}`;

      const btn = document.getElementById('btnSlipSendEmail');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Sending...';
      }

      // Batch 5 (B10): report the send truthfully. Only a confirmed
      // relay success (or the EmailJS fallback resolving) counts as
      // sent. On failure, say so — and only then open the Gmail compose
      // window, as a manual fallback for the user to send it by hand.
      let slipEmailSent = false;
      let slipEmailError = '';
      try {
        if (typeof sendViaOfficialEmailRelay === 'function' || window.sendViaOfficialEmailRelay) {
          const fn = window.sendViaOfficialEmailRelay || sendViaOfficialEmailRelay;
          const relayRes = await fn({
            to: targetEmail,
            subject: subject,
            text: plainText,
            html: plainText.replace(/\n/g, '<br/>'),
            senderName: `${academyName()} Payroll (${academyEmail()})`
          });
          slipEmailSent = !!(relayRes && relayRes.success === true);
          if (!slipEmailSent) slipEmailError = (relayRes && relayRes.error) || 'Unknown error';
        } else if (typeof emailjs !== 'undefined' && window.EMAILJS_PUBLIC_KEY) {
          await emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
            to_email: targetEmail,
            subject: subject,
            message: plainText,
            from_name: `${academyName()} Payroll (${academyEmail()})`
          });
          slipEmailSent = true;
        } else {
          slipEmailError = 'No email service is available.';
        }
      } catch (eJsErr) {
        console.warn('Salary slip email dispatch notice:', eJsErr);
        slipEmailSent = false;
        slipEmailError = (eJsErr && eJsErr.message) || 'Unknown error';
      }

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }

      if (slipEmailSent) {
        if (typeof lmsNotify === 'function') lmsNotify(`Official Salary Slip email dispatched to ${targetEmail}`, { type: 'success' });
        else if (!isSilent) lmsNotify(`Official Salary Slip email dispatched to ${targetEmail}`);
      } else if (!isSilent) {
        if (typeof lmsNotify === 'function') lmsNotify(`Official Salary Slip email was NOT sent (${slipEmailError || 'Unknown error'}). Opening Gmail so you can send it manually.`, { type: 'error' });
        else lmsNotify(`Official Salary Slip email was NOT sent (${slipEmailError || 'Unknown error'}). Opening Gmail so you can send it manually.`);
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(targetEmail)}&cc=${academyEmail()}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;
        window.open(gmailUrl, '_blank');
      } else {
        if (typeof lmsNotify === 'function') lmsNotify(`Official Salary Slip email was NOT sent to ${targetEmail} (${slipEmailError || 'Unknown error'}).`, { type: 'error' });
      }
    }
    window.sendSalarySlipEmailModal = sendSalarySlipEmailModal;
