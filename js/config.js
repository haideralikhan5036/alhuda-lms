/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/config.js
 * Purpose: Core Globals, Supabase Client Initialization, Role Privacy Masking & Master Boot Sequence
 * Extracted Line Range: 4864 – 4997 (134 lines)
 * ============================================================================
 */

    const SUPABASE_URL = "https://ldgzuyroejzrvktksugy.supabase.co";
    const SUPABASE_KEY = "sb_publishable_rP38XXgYoYBTPJlCxtwMUg_RPupFrKg";
    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    var ALL_TEACHERS = [];
    var ALL_STUDENTS = [];
    var ALL_FAMILIES = [];
    var RAW_ALL_FAMILIES = [];
    var ALL_CLASS_SCHEDULES = [];
    var CURRENT_ROLE = 'owner';
    var ACTIVE_MANAGER_ID = null;

    // STUDENT CONTACT PRIVACY GUARDS (MANDATORY FOR MANAGER ROLE)
    function maskStudentPhone(phone) {
      if (CURRENT_ROLE !== 'manager') return phone || '--';
      if (!phone) return '--';
      const clean = String(phone).trim();
      if (clean.length <= 5) return '••••••';
      return clean.slice(0, 4) + ' ••• ••••';
    }

    function maskStudentEmail(email) {
      if (CURRENT_ROLE !== 'manager') return email || '--';
      if (!email) return '--';
      const parts = String(email).trim().split('@');
      if (parts.length < 2) return '••••••';
      const name = parts[0];
      const domain = parts[1];
      const prefix = name.length > 2 ? name.slice(0, 2) : name.slice(0, 1);
      return `${prefix}•••••@${domain}`;
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
      const stuList = getFamilyRegularStudents(f);
      if (stuList.length > 0) {
        // CORE BUSINESS RULE:
        // IF AT LEAST ONE STUDENT IN A FAMILY IS ACTIVE -> FAMILY MUST BE ACTIVE (return false)
        // IF ZERO STUDENTS IN A FAMILY ARE ACTIVE -> FAMILY MUST BE DEACTIVATED (return true)
        const hasAnyActiveStudent = stuList.some(s => !isStudentSelfDeactivated(s));
        return !hasAnyActiveStudent;
      }
      if (f.is_active === false) return true;
      const st = String(f.status || 'Active').trim().toLowerCase();
      return st === 'inactive' || st === 'deactivated';
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
    window.isEligibleTeacherRecord = isEligibleTeacherRecord;
    window.getEligibleTeachers = getEligibleTeachers;
    window.validateEligibleTeacherBackend = validateEligibleTeacherBackend;

    // =========================================================================
    // ONE GLOBAL LMS-NATIVE NOTIFICATION & CONFIRMATION SYSTEM
    // Replaces browser-native alert(), confirm(), and prompt() across the LMS
    // =========================================================================
    function _escLmsDialog(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function _inferLmsNotificationType(msg, explicitType) {
      if (explicitType && ['success', 'error', 'warning', 'info'].includes(explicitType)) return explicitType;
      const lower = String(msg || '').toLowerCase();
      if (
        lower.includes('error') ||
        lower.includes('failed') ||
        lower.includes('access denied') ||
        lower.includes('unable to') ||
        lower.includes('invalid') ||
        lower.includes('not found') ||
        lower.includes('❌')
      ) {
        return 'error';
      }
      if (
        lower.includes('please ') ||
        lower.includes('warning') ||
        lower.includes('already occupied') ||
        lower.includes('⚠️')
      ) {
        return 'warning';
      }
      if (
        lower.includes('✅') ||
        lower.includes('🎉') ||
        lower.includes('🎓') ||
        lower.includes('successfully') ||
        lower.includes('copied') ||
        lower.includes('completed') ||
        lower.includes('reactivated') ||
        lower.includes('enrolled') ||
        lower.includes('updated') ||
        lower.includes('saved') ||
        lower.includes('dispatched') ||
        lower.includes('sent')
      ) {
        return 'success';
      }
      return 'info';
    }

    function lmsNotify(message, options = {}) {
      if (message === undefined || message === null) return;
      const rawText = String(message).trim();
      if (!rawText) return;

      const opts = typeof options === 'string' ? { type: options } : (options || {});
      const variant = _inferLmsNotificationType(rawText, opts.type);

      let stack = document.getElementById('lmsGlobalToastStack');
      if (!stack) {
        stack = document.createElement('div');
        stack.id = 'lmsGlobalToastStack';
        stack.setAttribute('role', 'region');
        stack.setAttribute('aria-label', 'LMS Notifications');
        stack.className = 'fixed top-4 right-4 z-[10050] flex flex-col gap-2.5 w-[calc(100vw-2rem)] max-w-md pointer-events-none';
        document.body.appendChild(stack);
      }

      const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const rawHeading = opts.title || lines[0] || 'Notification';
      const cleanHeading = rawHeading.replace(/^[✅🎉🎓❌⚠️📅🕒]+\s*/, '').trim() || rawHeading;
      const bodyLines = opts.title ? lines : lines.slice(1);
      const hasMultiLineDetails = bodyLines.length > 0;

      const themeMap = {
        success: {
          border: 'border-emerald-500/90',
          bg: 'bg-white',
          iconWrap: 'bg-emerald-100 text-emerald-700 border-emerald-300',
          icon: 'fa-solid fa-circle-check',
          badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          bar: 'bg-emerald-500'
        },
        error: {
          border: 'border-rose-500/90',
          bg: 'bg-white',
          iconWrap: 'bg-rose-100 text-rose-700 border-rose-300',
          icon: 'fa-solid fa-circle-exclamation',
          badge: 'bg-rose-50 text-rose-800 border-rose-200',
          bar: 'bg-rose-500'
        },
        warning: {
          border: 'border-amber-500/90',
          bg: 'bg-white',
          iconWrap: 'bg-amber-100 text-amber-700 border-amber-300',
          icon: 'fa-solid fa-triangle-exclamation',
          badge: 'bg-amber-50 text-amber-800 border-amber-200',
          bar: 'bg-amber-500'
        },
        info: {
          border: 'border-teal-600/90',
          bg: 'bg-white',
          iconWrap: 'bg-teal-100 text-teal-800 border-teal-300',
          icon: 'fa-solid fa-bell',
          badge: 'bg-teal-50 text-teal-800 border-teal-200',
          bar: 'bg-teal-600'
        }
      };
      const th = themeMap[variant] || themeMap.info;
      const durationMs = opts.duration || (hasMultiLineDetails ? 6500 : 4200);

      const card = document.createElement('div');
      card.setAttribute('role', variant === 'error' ? 'alert' : 'status');
      card.className = `pointer-events-auto relative overflow-hidden rounded-2xl ${th.bg} border-l-4 ${th.border} border border-slate-200 shadow-2xl p-3.5 transition-all duration-200 opacity-0 translate-y-[-8px]`;

      const detailsHtml = hasMultiLineDetails
        ? `<div class="mt-1.5 pt-1.5 border-t border-slate-100 text-[11px] text-slate-600 space-y-0.5 leading-relaxed max-h-48 overflow-y-auto">${bodyLines.map(l => `<div>${_escLmsDialog(l)}</div>`).join('')}</div>`
        : '';

      card.innerHTML = `
        <div class="flex items-start gap-3">
          <div class="w-8 h-8 rounded-xl border ${th.iconWrap} flex items-center justify-center shrink-0 mt-0.5">
            <i class="${th.icon} text-sm"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-extrabold text-xs text-slate-900 leading-snug break-words">${_escLmsDialog(cleanHeading)}</div>
            ${detailsHtml}
          </div>
          <button type="button" aria-label="Dismiss notification" class="w-6 h-6 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center text-sm font-bold shrink-0 cursor-pointer">&times;</button>
        </div>
      `;

      const closeBtn = card.querySelector('button');
      const dismiss = () => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(-8px)';
        setTimeout(() => { if (card.parentNode) card.parentNode.removeChild(card); }, 180);
      };
      if (closeBtn) closeBtn.onclick = dismiss;

      stack.appendChild(card);
      requestAnimationFrame(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      });

      setTimeout(dismiss, durationMs);
    }

    function _parseConfirmInput(optionsOrMessage) {
      if (optionsOrMessage && typeof optionsOrMessage === 'object') {
        return {
          title: optionsOrMessage.title || 'Confirm Action',
          message: optionsOrMessage.message || '',
          details: Array.isArray(optionsOrMessage.details) ? optionsOrMessage.details : [],
          confirmText: optionsOrMessage.confirmText || 'Confirm',
          cancelText: optionsOrMessage.cancelText || 'Cancel',
          variant: optionsOrMessage.variant || 'danger'
        };
      }

      const raw = String(optionsOrMessage || 'Are you sure you want to proceed?').trim();
      const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const firstLine = lines[0] || 'Confirm Action';
      const restLines = lines.slice(1);
      const lower = raw.toLowerCase();

      let variant = 'info';
      let confirmText = 'Confirm';

      if (lower.includes('deactivate the entire family') || lower.includes('deactivate family')) {
        variant = 'danger';
        confirmText = 'Deactivate Family';
      } else if (lower.includes('reactivate the entire family') || lower.includes('reactivate family')) {
        variant = 'success';
        confirmText = 'Reactivate Family';
      } else if (lower.includes('reactivate')) {
        variant = 'success';
        confirmText = 'Reactivate';
      } else if (lower.includes('deactivate')) {
        variant = 'danger';
        confirmText = 'Deactivate';
      } else if (lower.includes('delete') || lower.includes('remove') || lower.includes('discontinue')) {
        variant = 'danger';
        confirmText = lower.includes('discontinue') ? 'Discontinue Trial' : 'Delete';
      } else if (lower.includes('unassign')) {
        variant = 'danger';
        confirmText = 'Unassign';
      } else if (lower.includes('unsuspend')) {
        variant = 'success';
        confirmText = 'Unsuspend Classes';
      } else if (lower.includes('suspend')) {
        variant = 'warning';
        confirmText = 'Suspend Classes';
      } else if (lower.includes('leave')) {
        variant = lower.includes('return') ? 'success' : 'warning';
        confirmText = lower.includes('return') ? 'Return to Active' : 'Confirm Leave';
      } else if (lower.includes('remind all')) {
        variant = 'info';
        confirmText = 'Send Reminders';
      } else if (lower.includes('sync') || lower.includes('cascade')) {
        variant = 'info';
        confirmText = 'Sync Now';
      }

      return {
        title: firstLine,
        message: restLines.join('\n'),
        details: [],
        confirmText,
        cancelText: 'Cancel',
        variant
      };
    }

    function lmsConfirm(optionsOrMessage) {
      return new Promise((resolve) => {
        const cfg = _parseConfirmInput(optionsOrMessage);
        const prevActiveEl = document.activeElement;

        const existing = document.getElementById('lmsGlobalDialogBackdrop');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        const variantStyles = {
          danger: {
            iconWrap: 'bg-rose-100 text-rose-600 border-rose-200',
            icon: 'fa-solid fa-triangle-exclamation',
            btn: 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-500 text-white',
            headerBorder: 'border-rose-100'
          },
          warning: {
            iconWrap: 'bg-amber-100 text-amber-700 border-amber-200',
            icon: 'fa-solid fa-circle-exclamation',
            btn: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500 text-white',
            headerBorder: 'border-amber-100'
          },
          success: {
            iconWrap: 'bg-emerald-100 text-emerald-700 border-emerald-200',
            icon: 'fa-solid fa-circle-check',
            btn: 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500 text-white',
            headerBorder: 'border-emerald-100'
          },
          info: {
            iconWrap: 'bg-teal-100 text-teal-800 border-teal-200',
            icon: 'fa-solid fa-circle-question',
            btn: 'bg-brandDark hover:bg-emerald-950 focus:ring-emerald-600 text-white',
            headerBorder: 'border-slate-100'
          }
        };
        const st = variantStyles[cfg.variant] || variantStyles.info;

        const backdrop = document.createElement('div');
        backdrop.id = 'lmsGlobalDialogBackdrop';
        backdrop.setAttribute('role', 'dialog');
        backdrop.setAttribute('aria-modal', 'true');
        backdrop.setAttribute('aria-labelledby', 'lmsGlobalDialogTitle');
        backdrop.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[10040] flex items-center justify-center p-4';

        const bodyParagraphs = (cfg.message || '')
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean)
          .map(line => `<p class="text-xs text-slate-600 leading-relaxed">${_escLmsDialog(line)}</p>`)
          .join('');

        backdrop.innerHTML = `
          <div class="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 transform transition-all">
            <div class="flex items-start gap-3.5 pb-3.5 border-b ${st.headerBorder}">
              <div class="w-10 h-10 rounded-xl border ${st.iconWrap} flex items-center justify-center shrink-0">
                <i class="${st.icon} text-base"></i>
              </div>
              <div class="flex-1 min-w-0">
                <h3 id="lmsGlobalDialogTitle" class="font-extrabold text-sm text-slate-900 leading-snug break-words">
                  ${_escLmsDialog(cfg.title)}
                </h3>
                ${bodyParagraphs ? `<div class="mt-2 space-y-1.5">${bodyParagraphs}</div>` : ''}
              </div>
            </div>
            <div class="flex items-center justify-end gap-2.5 pt-4">
              <button type="button" id="btnLmsDialogCancel" class="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-400">
                ${_escLmsDialog(cfg.cancelText)}
              </button>
              <button type="button" id="btnLmsDialogConfirm" class="px-5 py-2 rounded-xl ${st.btn} font-extrabold text-xs shadow-sm transition cursor-pointer focus:outline-none focus:ring-2">
                ${_escLmsDialog(cfg.confirmText)}
              </button>
            </div>
          </div>
        `;

        const cleanup = (result) => {
          document.removeEventListener('keydown', onKey);
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
          if (prevActiveEl && typeof prevActiveEl.focus === 'function') {
            try { prevActiveEl.focus(); } catch (e) {}
          }
          resolve(result);
        };

        const onKey = (ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            cleanup(false);
          }
        };
        document.addEventListener('keydown', onKey);

        backdrop.addEventListener('click', (ev) => {
          if (ev.target === backdrop) cleanup(false);
        });

        document.body.appendChild(backdrop);

        const btnCancel = document.getElementById('btnLmsDialogCancel');
        const btnConfirm = document.getElementById('btnLmsDialogConfirm');
        if (btnCancel) btnCancel.onclick = () => cleanup(false);
        if (btnConfirm) {
          btnConfirm.onclick = () => cleanup(true);
          setTimeout(() => btnConfirm.focus(), 20);
        }
      });
    }

    function lmsPrompt(message, defaultValue = '', options = {}) {
      return new Promise((resolve) => {
        const prevActiveEl = document.activeElement;
        const existing = document.getElementById('lmsGlobalDialogBackdrop');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        const raw = String(message || 'Enter value:').trim();
        const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const title = options.title || lines[0] || 'Input Required';
        const desc = lines.slice(1).join('\n');

        const backdrop = document.createElement('div');
        backdrop.id = 'lmsGlobalDialogBackdrop';
        backdrop.setAttribute('role', 'dialog');
        backdrop.setAttribute('aria-modal', 'true');
        backdrop.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[10040] flex items-center justify-center p-4';

        backdrop.innerHTML = `
          <form id="formLmsPromptDialog" class="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div class="flex items-start gap-3 border-b border-slate-100 pb-3">
              <div class="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0">
                <i class="fa-solid fa-pen-to-square text-sm"></i>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-extrabold text-sm text-slate-900 leading-snug">${_escLmsDialog(title)}</h3>
                ${desc ? `<p class="text-xs text-slate-600 mt-1 whitespace-pre-line">${_escLmsDialog(desc)}</p>` : ''}
              </div>
            </div>
            <div>
              <input type="text" id="inputLmsPromptValue" value="${_escLmsDialog(defaultValue)}" class="w-full p-2.5 rounded-xl border border-slate-300 font-semibold text-xs text-slate-900 focus:outline-none focus:border-emerald-600">
            </div>
            <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" id="btnLmsPromptCancel" class="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs cursor-pointer">
                Cancel
              </button>
              <button type="submit" class="px-5 py-2 rounded-xl bg-brandEmerald hover:bg-emerald-700 text-white font-extrabold text-xs shadow-sm cursor-pointer">
                Confirm
              </button>
            </div>
          </form>
        `;

        const cleanup = (val) => {
          document.removeEventListener('keydown', onKey);
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
          if (prevActiveEl && typeof prevActiveEl.focus === 'function') {
            try { prevActiveEl.focus(); } catch (e) {}
          }
          resolve(val);
        };

        const onKey = (ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            cleanup(null);
          }
        };
        document.addEventListener('keydown', onKey);

        backdrop.addEventListener('click', (ev) => {
          if (ev.target === backdrop) cleanup(null);
        });

        document.body.appendChild(backdrop);

        const inputEl = document.getElementById('inputLmsPromptValue');
        const btnCancel = document.getElementById('btnLmsPromptCancel');
        const formEl = document.getElementById('formLmsPromptDialog');

        if (btnCancel) btnCancel.onclick = () => cleanup(null);
        if (formEl) {
          formEl.onsubmit = (e) => {
            e.preventDefault();
            cleanup(inputEl ? inputEl.value : '');
          };
        }
        if (inputEl) {
          setTimeout(() => { inputEl.focus(); inputEl.select(); }, 20);
        }
      });
    }

    window.lmsNotify = lmsNotify;
    window.lmsConfirm = lmsConfirm;
    window.lmsPrompt = lmsPrompt;
    // Override browser-native window.alert so no Chrome "website says..." alert popup ever appears
    window.alert = function(msg) {
      lmsNotify(msg);
    };

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
          const [famRes, stdRes, tchRes, schRes] = await Promise.all([
            db.from('families').select('*, students(*)').order('created_at', { ascending: false }),
            db.from('students').select('*').order('created_at', { ascending: false }),
            db.from('teachers').select('*').order('created_at', { ascending: false }),
            db.from('class_schedules').select('*, teachers(*), students(*)')
          ]);

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
              if (hasActive && isCurrDeact) {
                syncedStatus = 'Active';
                db.from('families').update({ status: 'Active' }).eq('id', f.id).then(() => {});
              } else if (!hasActive && !isCurrDeact) {
                syncedStatus = 'Inactive';
                db.from('families').update({ status: 'Inactive' }).eq('id', f.id).then(() => {});
              }
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

          _LAST_CORE_DATA_LOAD_TS = Date.now();

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
                  await db.from('students').update({
                    family_id: canonicalFam.id,
                    status: 'Active'
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

    window.onload = async function() {
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

      const today = new Date().toISOString().slice(0, 10);
      const attDateInput = document.getElementById('attendanceDateSelect');
      if (attDateInput) attDateInput.value = today;

      if (typeof updateBackBtnVisibility === 'function') updateBackBtnVisibility();

      // 1. Kick off core deduplicated data load & visible Dashboard in parallel (non-blocking!)
      const corePromise = ensureCoreLmsDataLoaded();
      loadDashboardData();

      // 2. Hydrate background views from the shared in-memory cache once core data arrives
      corePromise.then(() => {
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

      setInterval(() => {
        if (typeof getAuthenticatedOwnerSession === 'function' && getAuthenticatedOwnerSession()) {
          loadDashboardData();
        } else if (typeof getAuthenticatedManagerSession === 'function' && getAuthenticatedManagerSession()) {
          loadDashboardData();
        }
      }, 60000);
    };

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

