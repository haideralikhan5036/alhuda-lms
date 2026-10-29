/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/config.js
 * Purpose: Core Globals, Supabase Client Initialization, Role Privacy Masking & Master Boot Sequence
 * Extracted Line Range: 4864 – 4997 (134 lines)
 * ============================================================================
 */

    // Cloudflare is the sole database backend (Supabase fully removed 2026-10-14).
    // window.supabase.createClient is overridden by js/cloudflare-db.js to return the Cloudflare D1/R2 client.
    const db = window.supabase.createClient();

    var ALL_TEACHERS = [];
    var ALL_STUDENTS = [];
    var ALL_FAMILIES = [];
    var RAW_ALL_FAMILIES = [];
    var ALL_CLASS_SCHEDULES = [];
    var CURRENT_ROLE = 'owner';
    var ACTIVE_MANAGER_ID = null;

    // STUDENT CONTACT PRIVACY GUARDS (MANDATORY FOR MANAGER ROLE)
    // Batch 2: the canonical mask is the exact string 'Hidden' — the same
    // value the Worker returns server-side for family/student contacts
    // when the caller is a manager. Partial masks (bullets, visible
    // prefixes) leaked information and could be written back over the
    // real value on edit, so they are gone.
    function maskStudentPhone(phone) {
      if (CURRENT_ROLE !== 'manager') return phone || '--';
      if (!phone || !String(phone).trim()) return '--';
      return 'Hidden';
    }

    function maskStudentEmail(email) {
      if (CURRENT_ROLE !== 'manager') return email || '--';
      if (!email || !String(email).trim()) return '--';
      return 'Hidden';
    }
    let CURRENT_MATRIX_TEACHER = null;
    let CURRENT_TEACHER_SCHEDULES = [];
    let CURRENT_MODAL_STUDENT_ID = null;
    let CURRENT_MODAL_TEACHER_ID = null;

    // TRIAL CLASSES MANAGEMENT STATE (Default to 'active' so Active Trials list shows current trials only)
    let ALL_TRIALS = [];
    let CURRENT_TRIAL_FILTER = 'active';
    let CURRENT_TRIAL_TEACHER_FILTER = 'all';

    // CANONICAL STATUS CLASSIFIERS (ONE SOURCE OF TRUTH FOR REGULAR VS TRIAL)
    function isRegularFamilyRecord(f) {
      if (!f) return false;
      const st = String(f.status || 'Active').trim().toLowerCase();
      if (st === 'trial' || st === 'converted' || st === 'discontinued' || st === 'deleted') return false;
      if (String(f.id || '').toUpperCase().startsWith('TRL-')) return false;
      if (f.notes) {
        try {
          const parsed = typeof f.notes === 'string' ? JSON.parse(f.notes) : f.notes;
          if (parsed && parsed.is_trial === true && !parsed.converted_to_regular && !parsed.converted_from_trial) {
            return false;
          }
        } catch (e) {}
      }
      return true;
    }

    function isRegularStudentRecord(s) {
      if (!s) return false;
      const st = String(s.status || 'Active').trim().toLowerCase();
      if (st === 'trial' || st === 'converted' || st === 'discontinued' || st === 'deleted') return false;
      if (String(s.id || '').toUpperCase().startsWith('TRL-')) return false;
      if (String(s.family_id || '').toUpperCase().startsWith('TRL-')) return false;
      if (s.notes) {
        try {
          const parsed = typeof s.notes === 'string' ? JSON.parse(s.notes) : s.notes;
          if (parsed && parsed.is_trial === true && !parsed.converted_to_regular && !parsed.converted_from_trial) {
            return false;
          }
        } catch (e) {}
      }
      return true;
    }

    function isStudentSelfDeactivated(s) {
      if (!s) return true;
      if (s.is_active === false) return true;
      const st = String(s.status || 'Active').trim().toLowerCase();
      return st === 'inactive' || st === 'deactivated' || st === 'deleted' || st === 'left';
    }

    function getFamilyRegularStudents(f) {
      if (!f) return [];
      const famIdUpper = String(f.id || '').trim().toUpperCase();
      let stuList = [];
      if (Array.isArray(window.ALL_STUDENTS) && window.ALL_STUDENTS.length > 0 && famIdUpper) {
        stuList = window.ALL_STUDENTS.filter(s =>
          String(s.family_id || '').trim().toUpperCase() === famIdUpper &&
          isRegularStudentRecord(s)
        );
      }
      if (stuList.length === 0 && Array.isArray(f.students) && f.students.length > 0) {
        stuList = f.students.filter(s => isRegularStudentRecord(s));
      }
      return stuList;
    }

    function isFamilyDeactivated(f) {
      if (!f) return true;
      // Batch 7 (F1.1): the family's OWN stored status is authoritative.
      // An explicitly deactivated family stays deactivated regardless of
      // student states; the student derivation below may only ADD
      // deactivation (all students deactivated), never remove a stored one.
      if (f.is_active === false) return true;
      const ownStatus = String(f.status || '').trim().toLowerCase();
      if (ownStatus === 'inactive' || ownStatus === 'deactivated') return true;
      const stuList = getFamilyRegularStudents(f);
      if (stuList.length > 0) {
        // IF ZERO STUDENTS IN A FAMILY ARE ACTIVE -> FAMILY IS DEACTIVATED (return true)
        const hasAnyActiveStudent = stuList.some(s => !isStudentSelfDeactivated(s));
        return !hasAnyActiveStudent;
      }
      return false;
    }

    function isActiveFamilyRecord(f) {
      return isRegularFamilyRecord(f) && !isFamilyDeactivated(f);
    }

    function isDeactivatedFamilyRecord(f) {
      return isRegularFamilyRecord(f) && isFamilyDeactivated(f);
    }

    function isStudentDeactivatedOrParentDeactivated(s, familyLookup = null) {
      if (!s) return true;
      if (isStudentSelfDeactivated(s)) return true;
      return false;
    }

    function isActiveStudentRecord(s, familyLookup = null) {
      return isRegularStudentRecord(s) && !isStudentDeactivatedOrParentDeactivated(s, familyLookup);
    }
    window.isStudentSelfDeactivated = isStudentSelfDeactivated;
    window.getFamilyRegularStudents = getFamilyRegularStudents;
    window.isFamilyDeactivated = isFamilyDeactivated;
    window.isActiveFamilyRecord = isActiveFamilyRecord;
    window.isDeactivatedFamilyRecord = isDeactivatedFamilyRecord;
    window.isStudentDeactivatedOrParentDeactivated = isStudentDeactivatedOrParentDeactivated;
    window.isActiveStudentRecord = isActiveStudentRecord;

    // =========================================================================
    // CENTRALIZED EMPLOYEE ROLE & TEACHER ELIGIBILITY ENGINE (MANAGER != TEACHER)
    // =========================================================================
    function getEmployeeRoleClassification(emp) {
      if (!emp || typeof emp !== 'object') return 'unknown';

      const tryParse = (str) => {
        if (typeof str === 'string' && str.trim().startsWith('{')) {
          try { return JSON.parse(str); } catch (e) {}
        } else if (str && typeof str === 'object') {
          return str;
        }
        return null;
      };

      const meta = tryParse(emp.address) || tryParse(emp.notes) || tryParse(emp.witness_name) || {};
      let acc = {};
      try {
        const accounts = typeof getTeacherAccounts === 'function'
          ? getTeacherAccounts()
          : JSON.parse(localStorage.getItem('alhuda_teacher_accounts') || '{}');
        if (emp.id && accounts[emp.id]) acc = accounts[emp.id];
      } catch (e) {}

      const empType = String(
        emp.employee_type || emp.employeeType || emp.role ||
        meta.employee_type || meta.employeeType || meta.role ||
        acc.employee_type || acc.employeeType || acc.role || ''
      ).trim().toLowerCase();

      const designation = String(
        emp.designation || meta.designation || acc.designation ||
        meta.role_title || acc.role_title || ''
      ).trim().toLowerCase();

      const shift = String(emp.working_shift || meta.working_shift || '').trim().toLowerCase();
      const codeIds = [
        String(emp.id || ''),
        String(emp.witness_name || ''),
        String(meta.emp_id || ''),
        String(meta.teacher_id || ''),
        String(acc.emp_id || ''),
        String(acc.teacher_id || '')
      ].map(s => s.trim().toUpperCase());

      if (
        empType === 'manager' ||
        designation === 'manager' ||
        shift === 'manager' ||
        codeIds.some(c => c.startsWith('MGR-'))
      ) {
        return 'manager';
      }

      if (
        empType === 'other_staff' ||
        empType === 'staff' ||
        designation === 'other staff' ||
        shift === 'other staff' ||
        codeIds.some(c => c.startsWith('STF-'))
      ) {
        return 'other_staff';
      }

      return 'teacher';
    }

    function isEligibleTeacherRecord(emp) {
      if (!emp || typeof emp !== 'object') return false;
      const st = String(emp.status || 'Active').trim().toLowerCase();
      if (st === 'inactive' || st === 'deactivated' || st === 'terminated' || st === 'deleted') return false;
      return getEmployeeRoleClassification(emp) === 'teacher';
    }

    function getEligibleTeachers(sourceList = null) {
      const list = Array.isArray(sourceList)
        ? sourceList
        : (Array.isArray(window.ALL_TEACHERS) ? window.ALL_TEACHERS : []);
      return list.filter(emp => isEligibleTeacherRecord(emp));
    }

    async function validateEligibleTeacherBackend(teacherId) {
      if (!teacherId) return { valid: true, teacher: null };
      const targetId = String(teacherId).trim();

      let emp = (window.ALL_TEACHERS || []).find(t => String(t.id) === targetId);
      if (!emp) {
        try {
          const { data } = await db.from('teachers').select('*').eq('id', targetId).maybeSingle();
          emp = data;
        } catch (e) {}
      }

      if (!emp) {
        return { valid: false, reason: 'Selected teacher record was not found in the database.' };
      }

      const roleClass = getEmployeeRoleClassification(emp);
      if (roleClass === 'manager') {
        return {
          valid: false,
          roleClass: 'manager',
          reason: `Role Validation Failed: "${emp.full_name}" is a Manager account. Managers cannot be assigned as teachers or receive teaching schedules.`
        };
      }
      if (roleClass !== 'teacher' || !isEligibleTeacherRecord(emp)) {
        return {
          valid: false,
          roleClass,
          reason: `Role Validation Failed: "${emp.full_name}" is not an active eligible teacher.`
        };
      }

      return { valid: true, teacher: emp };
    }

    window.getEmployeeRoleClassification = getEmployeeRoleClassification;

    // Staff categories (Employees redesign, 2026-10-29): the ONE canonical
    // category vocabulary for the Employees tabs, list and
    // category-specific views. Storage is unchanged — employee_type in
    // the record meta ('manager' | 'other_staff' | absent = teacher);
    // this layer only names the categories and classifies records via
    // getEmployeeRoleClassification above.
    const StaffCategories = {
      TEACHING: 'teaching',
      MANAGEMENT: 'management',
      NON_TEACHING: 'non-teaching',
      LABELS: { teaching: 'Teaching Staff', management: 'Management Staff', 'non-teaching': 'Non-Teaching Staff' },
      EMPLOYEE_TYPE: { teaching: 'teacher', management: 'manager', 'non-teaching': 'other_staff' },
      of(emp) {
        const cls = getEmployeeRoleClassification(emp);
        if (cls === 'manager') return 'management';
        if (cls === 'other_staff') return 'non-teaching';
        return 'teaching';
      },
      // Positive signals for MORE THAN ONE category (e.g. employee_type
      // 'manager' together with an STF- code): never guess — the UI
      // flags the record "Needs review" instead.
      hasConflict(emp) {
        if (!emp || typeof emp !== 'object') return false;
        const tryParse = (str) => {
          if (typeof str === 'string' && str.trim().startsWith('{')) { try { return JSON.parse(str); } catch (e) {} }
          else if (str && typeof str === 'object') return str;
          return null;
        };
        const meta = tryParse(emp.address) || tryParse(emp.notes) || tryParse(emp.witness_name) || {};
        let acc = {};
        try {
          const accounts = typeof getTeacherAccounts === 'function'
            ? getTeacherAccounts()
            : JSON.parse(localStorage.getItem('alhuda_teacher_accounts') || '{}');
          if (emp.id && accounts[emp.id]) acc = accounts[emp.id];
        } catch (e) {}
        const types = [emp.employee_type, meta.employee_type, acc.employee_type].map(v => String(v || '').trim().toLowerCase());
        const codes = [emp.id, emp.witness_name, meta.emp_id, meta.teacher_id, acc.emp_id, acc.teacher_id].map(v => String(v || '').trim().toUpperCase());
        const mgr = types.includes('manager') || codes.some(c => c.startsWith('MGR-'));
        const stf = types.includes('other_staff') || types.includes('staff') || codes.some(c => c.startsWith('STF-'));
        const tch = types.includes('teacher');
        return (mgr && stf) || (tch && (mgr || stf));
      }
    };
    window.StaffCategories = StaffCategories;
    window.isEligibleTeacherRecord = isEligibleTeacherRecord;
    window.getEligibleTeachers = getEligibleTeachers;
    window.validateEligibleTeacherBackend = validateEligibleTeacherBackend;

    // =========================================================================
    // Batch 8: ONE notification system lives in js/ui-notify.js (loaded in
    // <head> of every portal, before this file). These are thin aliases so
    // existing lmsNotify/lmsConfirm/lmsPrompt call sites keep working
    // against the single system. If ui-notify.js failed to load, the
    // aliases stay undefined rather than installing a second system.
    // =========================================================================
    if (typeof window.LmsNotify !== 'undefined' && window.LmsNotify) {
      window.lmsNotify = window.LmsNotify.toast;
      window.lmsConfirm = window.LmsNotify.confirm;
      window.lmsPrompt = window.LmsNotify.prompt;
    }

    function isValidUuidString(val) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val || '').trim());
    }

    function normalizeStudentCourseRecord(s) {
      if (!s || typeof s !== 'object') return s;
      let meta = {};
      if (s.notes) {
        try {
          meta = typeof s.notes === 'string' ? JSON.parse(s.notes) : { ...s.notes };
        } catch (e) {}
      }
      const savedCourseName = meta.course_name || meta.course || meta.trial_course || '';
      if (savedCourseName && (!s.course_id || isValidUuidString(s.course_id))) {
        s.course_id = savedCourseName;
      }
      return s;
    }

    function buildStudentDatabasePayload(rawRecord, existingStudent = null) {
      const dbPayload = { ...rawRecord };
      const memRecord = { ...rawRecord };

      let meta = {};
      if (existingStudent && existingStudent.notes) {
        try {
          const parsed = typeof existingStudent.notes === 'string' ? JSON.parse(existingStudent.notes) : existingStudent.notes;
          if (parsed && typeof parsed === 'object') meta = { ...parsed };
        } catch (e) {}
      }
      if (dbPayload.notes) {
        try {
          const parsed = typeof dbPayload.notes === 'string' ? JSON.parse(dbPayload.notes) : dbPayload.notes;
          if (parsed && typeof parsed === 'object') meta = { ...meta, ...parsed };
        } catch (e) {}
      }

      if ('course_id' in dbPayload) {
        const rawCourse = String(dbPayload.course_id || '').trim();
        if (rawCourse && !isValidUuidString(rawCourse)) {
          meta.course_name = rawCourse;
          meta.course = rawCourse;
          dbPayload.course_id = null;
          memRecord.course_id = rawCourse;
        } else if (!rawCourse) {
          dbPayload.course_id = null;
        }
      }

      const notesStr = JSON.stringify(meta);
      dbPayload.notes = notesStr;
      memRecord.notes = notesStr;
      return { dbPayload, memRecord };
    }

    window.isValidUuidString = isValidUuidString;
    window.normalizeStudentCourseRecord = normalizeStudentCourseRecord;
    window.buildStudentDatabasePayload = buildStudentDatabasePayload;

    // =========================================================================
    // AUTHORITATIVE FAMILY & STUDENT STATUS QUERY HELPERS + DEACTIVATION SYNC
    // =========================================================================
    function getAllFamilies(familiesArray = ALL_FAMILIES) {
      return (Array.isArray(familiesArray) ? familiesArray : []).filter(f => isRegularFamilyRecord(f));
    }

    function getActiveFamilies(familiesArray = ALL_FAMILIES) {
      return getAllFamilies(familiesArray).filter(f => isActiveFamilyRecord(f));
    }

    function getDeactivatedFamilies(familiesArray = ALL_FAMILIES) {
      return getAllFamilies(familiesArray).filter(f => isDeactivatedFamilyRecord(f));
    }

    function getAllStudents(studentsArray = ALL_STUDENTS, familiesArray = ALL_FAMILIES) {
      const fams = getAllFamilies(familiesArray);
      const validFamIds = new Set(fams.map(f => String(f.id || '').trim().toUpperCase()));
      return (Array.isArray(studentsArray) ? studentsArray : []).filter(s => {
        if (!isRegularStudentRecord(s)) return false;
        const fid = String(s.family_id || '').trim().toUpperCase();
        return !fid || validFamIds.size === 0 || validFamIds.has(fid);
      });
    }

    function getActiveStudents(studentsArray = ALL_STUDENTS, familiesArray = ALL_FAMILIES) {
      return getAllStudents(studentsArray, familiesArray).filter(s => isActiveStudentRecord(s, familiesArray));
    }

    function getDeactivatedStudents(studentsArray = ALL_STUDENTS, familiesArray = ALL_FAMILIES) {
      return getAllStudents(studentsArray, familiesArray).filter(s => !isActiveStudentRecord(s, familiesArray));
    }

    async function deactivateStudentScheduleAndTeacherBackend(studentId, existingMetaObj = null) {
      if (!studentId) return { previousTeacherId: null, previousTeacherName: null, archivedSchedules: [] };
      const stuObj = (ALL_STUDENTS || []).find(s => String(s.id) === String(studentId));
      const previousTeacherId = stuObj ? (stuObj.assigned_teacher_id || null) : null;
      const prevTch = previousTeacherId
        ? (ALL_TEACHERS || []).find(t => String(t.id) === String(previousTeacherId))
        : null;
      const previousTeacherName = prevTch ? prevTch.full_name : null;

      let archivedSchedules = [];
      try {
        const { data: activeRows } = await db
          .from('class_schedules')
          .select('*')
          .eq('student_id', studentId);
        if (Array.isArray(activeRows) && activeRows.length > 0) {
          archivedSchedules = activeRows.map(r => ({
            id: r.id,
            teacher_id: r.teacher_id,
            day_of_week: r.day_of_week,
            start_time: r.start_time,
            end_time: r.end_time,
            duration_mins: r.duration_mins,
            course_name: r.course_name,
            archived_at: new Date().toISOString()
          }));
        }
      } catch (e) {
        console.warn('[deactivateStudentScheduleAndTeacherBackend] Schedule query notice:', e);
      }

      // Remove all active schedule slots for the deactivated student from Supabase
      try {
        await db.from('class_schedules').delete().eq('student_id', studentId);
      } catch (e) {
        console.warn('[deactivateStudentScheduleAndTeacherBackend] Schedule delete notice:', e);
      }

      // Remove from in-memory ALL_CLASS_SCHEDULES
      if (Array.isArray(ALL_CLASS_SCHEDULES)) {
        ALL_CLASS_SCHEDULES = ALL_CLASS_SCHEDULES.filter(row => String(row.student_id) !== String(studentId));
      }

      // Enrich student metadata with archived teacher & schedule history for audit without keeping active links
      if (existingMetaObj && typeof existingMetaObj === 'object') {
        if (previousTeacherId) {
          existingMetaObj.previous_teacher_id_before_deactivation = previousTeacherId;
          existingMetaObj.previous_teacher_name_before_deactivation = previousTeacherName;
        }
        if (archivedSchedules.length > 0) {
          existingMetaObj.archived_schedules_before_deactivation = archivedSchedules;
        }
        existingMetaObj.schedule_cleared_on_deactivation_at = new Date().toISOString();
      }

      return {
        previousTeacherId,
        previousTeacherName,
        archivedSchedules
      };
    }

    window.getAllFamilies = getAllFamilies;
    window.getActiveFamilies = getActiveFamilies;
    window.getDeactivatedFamilies = getDeactivatedFamilies;
    window.getAllStudents = getAllStudents;
    window.getActiveStudents = getActiveStudents;
    window.getDeactivatedStudents = getDeactivatedStudents;
    window.deactivateStudentScheduleAndTeacherBackend = deactivateStudentScheduleAndTeacherBackend;

    let _CORE_DATA_INFLIGHT_PROMISE = null;
    let _LAST_CORE_DATA_LOAD_TS = 0;
    const CORE_DATA_TTL_MS = 60000;

    // SLOW-CLASSES FIX: PKT day/date/minutes for the admin portal (the
    // teacher PR #32 convention, copied here so admin and teacher
    // agree on "today"). Fallback is browser-local time, never UTC,
    // so a fallback cannot reintroduce the UTC-date join bug.
    function getAdminPktNowParts() {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
        const get = t => parts.find(p => p.type === t)?.value;
        const y = Number(get('year')), m = Number(get('month')), d = Number(get('day'));
        const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
        return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')), day: dow === 0 ? 7 : dow };
      } catch (e) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        return { date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, minutes: now.getHours() * 60 + now.getMinutes(), day: now.getDay() === 0 ? 7 : now.getDay() };
      }
    }
    // Exposed like ensureCoreLmsDataLoaded below: config.js runs inside
    // a wrapper scope, so dashboard.js can only see this via window.
    window.getAdminPktNowParts = getAdminPktNowParts;

    // Batch 7 (F3.4): settle one core-load branch independently with a
    // timeout, so a single stalled query can no longer block every
    // global (and every dashboard count) behind it.
    // SLOW-CLASSES FIX: the 15 s clock starts AFTER the D1 probe
    // settles (window.waitForD1ProbeSettled). The old race measured
    // from branch start, so a slow-but-live Worker lost its race to
    // the 12 s probe time inside the budget.
    const CORE_BRANCH_TIMEOUT_MS = 15000;
    function settleCoreBranch(queryPromise) {
      return (async () => {
        try { if (typeof window.waitForD1ProbeSettled === 'function') await window.waitForD1ProbeSettled(); } catch (e) {}
        let timer;
        const timeoutP = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, res: null }), CORE_BRANCH_TIMEOUT_MS); });
        try {
          const res = await Promise.race([
            Promise.resolve(queryPromise).then(
              (res) => ({ ok: true, res }),
              () => ({ ok: false, res: null })
            ),
            timeoutP
          ]);
          clearTimeout(timer);
          return res;
        } catch (e) {
          clearTimeout(timer);
          return { ok: false, res: null };
        }
      })();
    }

    function invalidateCoreLmsDataCache() {
      _LAST_CORE_DATA_LOAD_TS = 0;
    }
    window.invalidateCoreLmsDataCache = invalidateCoreLmsDataCache;

    async function ensureCoreLmsDataLoaded({ force = false } = {}) {
      const now = Date.now();
      const hasData = Array.isArray(ALL_FAMILIES) && ALL_FAMILIES.length > 0 &&
                      Array.isArray(ALL_STUDENTS) && ALL_STUDENTS.length > 0 &&
                      Array.isArray(ALL_TEACHERS) && ALL_TEACHERS.length > 0;
      if (!force && hasData && (now - _LAST_CORE_DATA_LOAD_TS < CORE_DATA_TTL_MS)) {
        return {
          rawFamilies: RAW_ALL_FAMILIES,
          families: ALL_FAMILIES,
          students: ALL_STUDENTS,
          teachers: ALL_TEACHERS,
          schedules: ALL_CLASS_SCHEDULES
        };
      }
      if (_CORE_DATA_INFLIGHT_PROMISE) {
        return _CORE_DATA_INFLIGHT_PROMISE;
      }

      _CORE_DATA_INFLIGHT_PROMISE = (async () => {
        try {
          // Batch 7 (F3.4): per-branch settlement + timeout. A failed or
          // stalled branch degrades to its previous/fallback data instead
          // of discarding the successful branches with it.
          const [famSettled, stdSettled, tchSettled, schSettled] = await Promise.all([
            settleCoreBranch(db.from('families').select('*, students(*)').order('created_at', { ascending: false })),
            settleCoreBranch(db.from('students').select('*').order('created_at', { ascending: false })),
            settleCoreBranch(db.from('teachers').select('*').order('created_at', { ascending: false })),
            settleCoreBranch(db.from('class_schedules').select('*, teachers(*), students(*)'))
          ]);
          const famRes = famSettled.ok ? famSettled.res : { data: (Array.isArray(RAW_ALL_FAMILIES) && RAW_ALL_FAMILIES.length > 0) ? RAW_ALL_FAMILIES : null };
          const stdRes = stdSettled.ok ? stdSettled.res : { data: (Array.isArray(ALL_STUDENTS) && ALL_STUDENTS.length > 0) ? ALL_STUDENTS : null };
          const tchRes = tchSettled.ok ? tchSettled.res : { data: null };
          const schRes = schSettled.ok ? schSettled.res : { data: null };

          const rawFamilies = (famRes.data || []).map(f => {
            const em = String(f.parent_email || f.email || '').trim();
            f.parent_email = em;
            f.email = em;
            if (Array.isArray(f.students)) {
              f.students = f.students.map(s => normalizeStudentCourseRecord(s));
            }
            return f;
          });
          RAW_ALL_FAMILIES = rawFamilies;

          if (stdRes.data && stdRes.data.length > 0) {
            ALL_STUDENTS = stdRes.data
              .map(s => normalizeStudentCourseRecord(s))
              .filter(s => isRegularStudentRecord(s));
          } else {
            const flatStu = [];
            rawFamilies.forEach(f => {
              if (f.students) {
                f.students.filter(s => isRegularStudentRecord(s)).forEach(s => flatStu.push(normalizeStudentCourseRecord(s)));
              }
            });
            ALL_STUDENTS = flatStu;
          }

          const normalizePhone = (p) => String(p || '').replace(/[^0-9]/g, '').slice(-10);
          const normalizeName = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
          const seenFamKeys = new Set();

          const regularFamilies = rawFamilies.filter(f => {
            if (!isRegularFamilyRecord(f)) return false;
            const key = normalizePhone(f.whatsapp) || normalizeName(f.parent_name) || f.id;
            if (seenFamKeys.has(key)) return false;
            seenFamKeys.add(key);
            return true;
          }).map(f => {
            const famIdUpper = String(f.id || '').trim().toUpperCase();
            const linkedStudents = ALL_STUDENTS.filter(s => String(s.family_id || '').trim().toUpperCase() === famIdUpper);
            const stuArr = linkedStudents.length > 0 ? linkedStudents : (f.students || []).filter(s => isRegularStudentRecord(s));

            let syncedStatus = f.status || 'Active';
            if (stuArr.length > 0) {
              const hasActive = stuArr.some(s => !isStudentSelfDeactivated(s));
              const isCurrDeact = ['inactive', 'deactivated'].includes(String(syncedStatus).trim().toLowerCase());
              if (!hasActive && !isCurrDeact) {
                syncedStatus = 'Inactive';
                db.from('families').update({ status: 'Inactive' }).eq('id', f.id).then(() => {});
              }
              // Batch 7 (F1.1): this reconciler may align a family TOWARDS
              // Inactive, but it must NEVER flip a stored Inactive family
              // back to Active. Only an explicit owner/manager reactivation
              // action may do that (see isFamilyDeactivated).
            }

            return {
              ...f,
              status: syncedStatus,
              students: stuArr
            };
          });

          ALL_FAMILIES = regularFamilies;

          if (tchRes.data) ALL_TEACHERS = tchRes.data;
          if (schRes.data) {
            ALL_CLASS_SCHEDULES = schRes.data.filter(slot => {
              const stuObj = (ALL_STUDENTS || []).find(s => String(s.id) === String(slot.student_id)) || slot.students;
              if (stuObj && isStudentSelfDeactivated(stuObj)) {
                // Auto-cleanup any stale schedule rows belonging to a deactivated student
                db.from('class_schedules').delete().eq('id', slot.id).then(() => {});
                return false;
              }
              return true;
            });
          }

          // Batch 7 (F3.4): only a COMPLETE load earns the TTL timestamp —
          // a partial load is retried by the next caller instead of being
          // cached as if it were whole.
          if (famSettled.ok && stdSettled.ok && tchSettled.ok && schSettled.ok) {
            _LAST_CORE_DATA_LOAD_TS = Date.now();
          }

          if (typeof ingestFeeDataFromFamilies === 'function') {
            try { await ingestFeeDataFromFamilies(rawFamilies); } catch (e) {}
          }
          if (typeof hydrateGlobalSharedStateFromCloud === 'function') {
            try { await hydrateGlobalSharedStateFromCloud(rawFamilies, ALL_TEACHERS); } catch (e) {}
          }
          if (typeof syncTopCircleNotificationDots === 'function') syncTopCircleNotificationDots();
          if (typeof renderPortalAnnouncementBanners === 'function') renderPortalAnnouncementBanners();

          return {
            rawFamilies: RAW_ALL_FAMILIES,
            families: ALL_FAMILIES,
            students: ALL_STUDENTS,
            teachers: ALL_TEACHERS,
            schedules: ALL_CLASS_SCHEDULES
          };
        } catch (err) {
          console.warn('[Core Data Cache] Notice:', err);
          return {
            rawFamilies: RAW_ALL_FAMILIES || [],
            families: ALL_FAMILIES || [],
            students: ALL_STUDENTS || [],
            teachers: ALL_TEACHERS || [],
            schedules: ALL_CLASS_SCHEDULES || []
          };
        } finally {
          _CORE_DATA_INFLIGHT_PROMISE = null;
        }
      })();

      return _CORE_DATA_INFLIGHT_PROMISE;
    }
    window.ensureCoreLmsDataLoaded = ensureCoreLmsDataLoaded;

    let _CONSOLIDATION_PROMISE = null;
    // ============================================================
    // Batch 3A (B15): shared duplicate-detection helpers (pure).
    // ============================================================
    function normalizePersonName(name) {
      return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
    }
    window.normalizePersonName = normalizePersonName;

    // A student with the same (normalised) name in the SAME family, or
    // null. The same name in a DIFFERENT family is normal and is never
    // reported. Students carry family_id (db shape) or familyId.
    function findDuplicateStudentName(students, familyId, name) {
      const fam = String(familyId || '').toUpperCase();
      const target = normalizePersonName(name);
      if (!fam || !target) return null;
      return (students || []).find(s => s &&
        String(s.family_id || s.familyId || '').toUpperCase() === fam &&
        normalizePersonName(s.name) === target) || null;
    }
    window.findDuplicateStudentName = findDuplicateStudentName;

    async function consolidateDuplicateTrialAndRegularRecords() {
      if (_CONSOLIDATION_PROMISE) return _CONSOLIDATION_PROMISE;
      _CONSOLIDATION_PROMISE = (async () => {
        try {
          const core = await ensureCoreLmsDataLoaded();
          const allFams = core.rawFamilies || [];
          const allStus = core.students || [];
          if (!allFams.length) return;

          const regularFams = allFams.filter(f => isRegularFamilyRecord(f));
          const legacyTrialFams = allFams.filter(f => !isRegularFamilyRecord(f));
          if (legacyTrialFams.length === 0) return;

          const normalizePhone = (p) => String(p || '').replace(/[^0-9]/g, '').slice(-10);
          const normalizeName = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

          let didConsolidateAny = false;
          for (const trFam of legacyTrialFams) {
            const trStatus = String(trFam.status || '').toLowerCase();
            const isLegacyTrlId = String(trFam.id || '').toUpperCase().startsWith('TRL-');
            const trPhone = normalizePhone(trFam.whatsapp);
            const trName = normalizeName(trFam.parent_name);

            let canonicalFam = regularFams.find(rf => {
              const rfPhone = normalizePhone(rf.whatsapp);
              const rfName = normalizeName(rf.parent_name);
              if (trPhone && rfPhone && trPhone === rfPhone) return true;
              if (trName && rfName && trName === rfName) return true;
              if (rf.notes && String(rf.notes).includes(trFam.id)) return true;
              return false;
            });

            if (canonicalFam && (isLegacyTrlId || trStatus === 'converted')) {
              didConsolidateAny = true;
              const trStudents = (trFam.students || []);
              const canonicalStudents = allStus.filter(s => String(s.family_id) === String(canonicalFam.id) && isRegularStudentRecord(s));
              const targetStu = canonicalStudents[0] || null;

              let famNotesObj = {};
              try {
                famNotesObj = typeof canonicalFam.notes === 'string' ? JSON.parse(canonicalFam.notes) : (canonicalFam.notes || {});
              } catch (e) {
                famNotesObj = { custom_notes: String(canonicalFam.notes || '') };
              }

              famNotesObj.converted_to_regular = true;
              famNotesObj.is_trial = false;
              famNotesObj.trial_history = {
                ...(famNotesObj.trial_history || {}),
                was_trial: true,
                previous_status: 'Trial',
                trial_status: 'Converted',
                legacy_trial_family_id: trFam.id,
                trial_start_date: (trFam.created_at || new Date().toISOString()).slice(0, 10),
                converted_at: famNotesObj.trial_history?.converted_at || (canonicalFam.created_at || new Date().toISOString()).slice(0, 10)
              };

              await db.from('families').update({
                status: canonicalFam.status === 'Trial' || canonicalFam.status === 'Converted' ? 'Active' : (canonicalFam.status || 'Active'),
                notes: JSON.stringify(famNotesObj)
              }).eq('id', canonicalFam.id);

              for (const trStu of trStudents) {
                if (targetStu && String(trStu.id) !== String(targetStu.id)) {
                  let trStuNotes = {};
                  try { trStuNotes = JSON.parse(trStu.notes || '{}'); } catch (e) {}

                  let targetStuNotes = {};
                  try { targetStuNotes = JSON.parse(targetStu.notes || '{}'); } catch (e) {}
                  targetStuNotes.converted_to_regular = true;
                  targetStuNotes.trial_history = {
                    was_trial: true,
                    previous_status: 'Trial',
                    trial_status: 'Converted',
                    trial_course: trStuNotes.trial_course || targetStu.course_id || 'Quran Studies',
                    pkt_slot: trStuNotes.pkt_slot || '',
                    trial_start_date: trStu.joining_date || (trStu.created_at || '').slice(0, 10),
                    converted_at: trStuNotes.converted_at || targetStu.joining_date
                  };

                  await db.from('students').update({
                    notes: JSON.stringify(targetStuNotes)
                  }).eq('id', targetStu.id);

                  await db.from('attendance_logs').update({ student_id: targetStu.id }).eq('student_id', trStu.id);
                  await db.from('class_schedules').delete().eq('student_id', trStu.id);
                  await db.from('students').delete().eq('id', trStu.id);
                } else if (!targetStu) {
                  // Batch 7 (F1.5): never activate a student INTO a
                  // deactivated canonical family — the moved student
                  // stays Inactive until the family itself is reactivated.
                  const canonicalDeact = ['inactive', 'deactivated'].includes(String(canonicalFam.status || '').trim().toLowerCase());
                  await db.from('students').update({
                    family_id: canonicalFam.id,
                    status: canonicalDeact ? 'Inactive' : 'Active'
                  }).eq('id', trStu.id);
                }
              }

              try {
                const storedTrials = JSON.parse(localStorage.getItem('alhuda_trial_classes') || '[]');
                let updatedLocal = false;
                storedTrials.forEach(t => {
                  if (t.family_id === trFam.id || normalizePhone(t.whatsapp) === trPhone) {
                    t.family_id = canonicalFam.id;
                    if (targetStu) t.student_id = targetStu.id;
                    t.status = 'Converted';
                    t.converted_family_id = canonicalFam.id;
                    if (targetStu) t.converted_student_id = targetStu.id;
                    updatedLocal = true;
                  }
                });
                if (updatedLocal) {
                  localStorage.setItem('alhuda_trial_classes', JSON.stringify(storedTrials));
                }
              } catch (e) {}

              await db.from('families').delete().eq('id', trFam.id);
            }
          }
          if (didConsolidateAny) {
            await ensureCoreLmsDataLoaded({ force: true });
          }
        } catch (err) {
          console.warn('Duplicate trial/regular consolidation notice:', err);
        } finally {
          _CONSOLIDATION_PROMISE = null;
        }
      })();
      return _CONSOLIDATION_PROMISE;
    }

    // TEACHER SALARIES & PAYROLL STATE
    let ALL_TEACHER_SALARIES = {};
    let CURRENT_SLIP_TEACHER_ID = null;
    let CURRENT_SLIP_DATA = null;

    // MAIN EXECUTIVE DASHBOARD STATE
    let DASHBOARD_CLASSES = [];
    let CURRENT_DASH_FILTER = null;
    let DASH_STUDENT_CHART = null;
    let DASH_REVENUE_CHART = null;

    // LEAVE MANAGEMENT & TEACHER REQUESTS STATE
    let ALL_LEAVE_RECORDS = [];
    let OVERDUE_LEAVE_STUDENTS = [];
    let PENDING_TEACHER_REQUESTS = [];
    let CURRENT_LEAVES_FILTER = 'active';

    const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // SLOW-CLASSES FIX: boot used to wait for window.onload — every
    // render-blocking CDN asset in <head> (Tailwind, fonts, chart.js,
    // …) with NO timeout — before any data load started. A slow or
    // hung CDN asset stalled the entire portal with no error. Boot
    // now starts on DOMContentLoaded: every portal script sits at the
    // end of <body>, so the DOM this boot touches is already parsed,
    // and slow CDN assets can delay widgets, never the data.
    async function runAdminBoot() {
      const isAuth = (typeof initRoleFromUrl === 'function') ? initRoleFromUrl() : true;

      setInterval(() => {
        const now = new Date();
        const el = document.getElementById('liveClock');
        if (el) el.innerText = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi' }) + ' PKT';
      }, 1000);

      if (!isAuth) {
        // Halt data loading until user is successfully authenticated
        return;
      }

      // SLOW-CLASSES FIX: same UTC-date bug as the dashboard (see
      // dashboard.js) — the attendance input defaulted to the UTC
      // date, so 00:00–05:00 PKT it pointed at yesterday.
      const today = getAdminPktNowParts().date;
      const attDateInput = document.getElementById('attendanceDateSelect');
      if (attDateInput) attDateInput.value = today;

      if (typeof updateBackBtnVisibility === 'function') updateBackBtnVisibility();

      // 1. Batch 7 (F3.3): load the core data FIRST, then run the
      // dashboard once — the same order the fresh-login path in auth.js
      // already uses. Starting the dashboard in parallel made it compute
      // from the pre-core empty state (the fee widget especially), with
      // no guaranteed repaint afterwards.
      const corePromise = ensureCoreLmsDataLoaded();
      corePromise.then(() => {
        try { loadDashboardData(); } catch (e) {}

        // 2. Hydrate background views from the shared in-memory cache
        setTimeout(() => {
          loadFamiliesAndStudents();
          loadTeachers();
          loadFeeBillingLedger();
          loadTrialClassesData();
          loadCourses();
          if (typeof loadCurriculumLibrary === 'function') loadCurriculumLibrary();
          consolidateDuplicateTrialAndRegularRecords();
        }, 120);
      });

      // Batch 7 (F3.5): the periodic dashboard refresh lives in ONE
      // place now — the 15-second timer in js/dashboard.js. (A second
      // 60 s timer here made overlapping dashboard passes overwrite each
      // other out of order.)
    }

    // DOMContentLoaded trigger for runAdminBoot (see the note above
    // it). If this script ever runs after parsing (defer/async), run
    // immediately instead of waiting for an event that already fired.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runAdminBoot);
    } else {
      runAdminBoot();
    }

    function toggleSidebar() {
      const sidebar = document.getElementById('mainAppSidebar');
      const content = document.getElementById('mainContentArea');
      const backdrop = document.getElementById('sidebarBackdrop');

      if (window.innerWidth < 1024) {
        // Mobile off-canvas drawer mode
        const isOpen = sidebar.classList.contains('sidebar-mobile-open');
        if (isOpen) {
          sidebar.classList.remove('sidebar-mobile-open');
          if (backdrop) backdrop.classList.add('hidden');
        } else {
          sidebar.classList.add('sidebar-mobile-open');
          if (backdrop) backdrop.classList.remove('hidden');
        }
      } else {
        // Desktop collapse mode
        const isCollapsed = sidebar.classList.contains('sidebar-collapsed');
        if (isCollapsed) {
          sidebar.classList.remove('sidebar-collapsed');
          content?.classList.remove('sidebar-collapsed');
          localStorage.setItem('alhuda_sidebar_collapsed', 'false');
        } else {
          sidebar.classList.add('sidebar-collapsed');
          content?.classList.add('sidebar-collapsed');
          localStorage.setItem('alhuda_sidebar_collapsed', 'true');
        }
      }
    }

    // Restore sidebar state from localStorage (desktop only)
    (function() {
      if (window.innerWidth >= 1024) {
        const saved = localStorage.getItem('alhuda_sidebar_collapsed');
        if (saved === 'true') {
          const sidebar = document.getElementById('mainAppSidebar');
          const content = document.getElementById('mainContentArea');
          if (sidebar) sidebar.classList.add('sidebar-collapsed');
          if (content) content.classList.add('sidebar-collapsed');
        }
      }
    })();

    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) {
        const sidebar = document.getElementById('mainAppSidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (sidebar) sidebar.classList.remove('sidebar-mobile-open');
        if (backdrop) backdrop.classList.add('hidden');
      }
    });

