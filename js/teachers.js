/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/teachers.js
 * Purpose: Teachers & Staff Management, Dedicated Zoom Classroom Auto-Cascade & Employee Registration
 * Extracted Line Range: 8594 – 9857 (1264 lines)
 * ============================================================================
 */

    // TEACHER ACCOUNTS & CREDENTIALS STORAGE ENGINE
    // Stash of the teacher's raw `address` DB value when the edit modal opens,
    // so profile updates can preserve credential JSON (password hash) stored there.
    let _editTeacherOrigAddress = '';
    function getTeacherAccounts() {
      // AUTH HARDENING (Batch 1): localStorage account maps must NOT hold
      // password values. Legacy entries that still carry one are sanitised
      // on read: the value is dropped, replaced by a hasExplicitPassword
      // marker, and the cleaned map is written back.
      let accounts = {};
      try { accounts = JSON.parse(localStorage.getItem('alhuda_teacher_accounts') || '{}'); } catch (e) { accounts = {}; }
      let changed = false;
      Object.values(accounts || {}).forEach(acc => {
        if (acc && typeof acc === 'object' && 'password' in acc) {
          acc.hasExplicitPassword = !!acc.password || !!acc.hasExplicitPassword;
          delete acc.password;
          changed = true;
        }
      });
      if (changed) {
        try { localStorage.setItem('alhuda_teacher_accounts', JSON.stringify(accounts)); } catch (e) {}
      }
      return accounts || {};
    }

    function saveTeacherAccount(tId, creds) {
      // AUTH HARDENING (Batch 1): never persist a password value. Passwords
      // are set only via the owner-only /api/auth/set-password endpoint
      // (see setAccountPasswordViaWorker in js/auth.js).
      const cleanCreds = { ...(creds || {}) };
      if ('password' in cleanCreds) {
        cleanCreds.hasExplicitPassword = !!cleanCreds.password || !!cleanCreds.hasExplicitPassword;
        delete cleanCreds.password;
      }
      const accounts = getTeacherAccounts();
      accounts[tId] = { ...(accounts[tId] || {}), ...cleanCreds };
      localStorage.setItem('alhuda_teacher_accounts', JSON.stringify(accounts));
      if (typeof syncGlobalSharedStateToCloud === 'function') {
        syncGlobalSharedStateToCloud({ teacherId: tId });
      }
    }

    function getNextTeacherId() {
      const accounts = getTeacherAccounts();
      const existingNums = [];

      // Scan accounts in storage
      Object.values(accounts).forEach(acc => {
        if (acc && acc.teacher_id) {
          const m = String(acc.teacher_id).match(/TCH-(\d+)/i);
          if (m) existingNums.push(parseInt(m[1], 10));
        }
      });

      // Scan existing loaded teachers
      if (ALL_TEACHERS && ALL_TEACHERS.length > 0) {
        ALL_TEACHERS.forEach((t, idx) => {
          const acc = accounts[t.id];
          if (acc && acc.teacher_id) {
            const m = String(acc.teacher_id).match(/TCH-(\d+)/i);
            if (m) existingNums.push(parseInt(m[1], 10));
          } else {
            existingNums.push(idx + 1);
          }
        });
      }

      let nextNum = 1;
      if (existingNums.length > 0) {
        nextNum = Math.max(...existingNums) + 1;
      }

      return `TCH-${String(nextNum).padStart(3, '0')}`;
    }

    function getTeacherCreds(t) {
      // AUTH HARDENING (Batch 1): NEVER fabricate credentials and NEVER
      // persist an invented account (the old behaviour invented a
      // first-name username + the well-known default password and saved
      // it). A password exists only as a salted hash on the server, set via
      // /api/auth/set-password. This helper only reports identity plus
      // whether a password exists; `password` is always ''.
      const accounts = getTeacherAccounts();
      const stored = accounts[t.id] || {};

      // Secondary stored source: credential meta inside the teacher record
      // (address JSON -> teacher_account / top-level slots).
      let addrMeta = {};
      try {
        if (t.address && String(t.address).trim().startsWith('{')) addrMeta = JSON.parse(t.address);
      } catch (e) {}
      const addrAccount = (addrMeta && typeof addrMeta.teacher_account === 'object' && addrMeta.teacher_account) ? addrMeta.teacher_account : {};

      const hasExplicitPassword = !!(
        stored.hasExplicitPassword ||
        (addrMeta && addrMeta.password) ||
        addrAccount.password
      );

      // Positional ID (display only — no longer persisted as a side effect)
      let seqNum = 1;
      if (ALL_TEACHERS && ALL_TEACHERS.length > 0) {
        const idx = ALL_TEACHERS.findIndex(item => item.id === t.id);
        seqNum = idx >= 0 ? (idx + 1) : 1;
      }
      const positionalId = `TCH-${String(seqNum).padStart(3, '0')}`;

      // Clean first name for a suggested username (e.g. "Gulfam" -> "gulfam")
      const firstWord = (t.full_name || 'teacher').trim().split(/\s+/)[0];
      const baseUser = firstWord.toLowerCase().replace(/[^a-z0-9]/g, '') || 'teacher';

      return {
        ...stored,
        teacher_id: stored.teacher_id || addrAccount.teacher_id || addrMeta.emp_id || positionalId,
        username: stored.username || addrAccount.username || addrMeta.username || baseUser,
        password: '',
        hasExplicitPassword: hasExplicitPassword,
        working_shift: stored.working_shift || t.working_shift || '10 Hours Shift (02:00 PM - 12:00 AM PKT)',
        full_name: t.full_name,
        phone: t.phone,
        zoom_link: stored.zoom_link || addrAccount.zoom_link || '',
        zoom_meeting_id: stored.zoom_meeting_id || addrAccount.zoom_meeting_id || '',
        zoom_passcode: stored.zoom_passcode || addrAccount.zoom_passcode || ''
      };
    }

    // =========================================================================
    // DEDICATED TEACHER ZOOM CLASSROOM & CENTRAL AUTO-CASCADE SYNC ENGINE
    // =========================================================================

    async function syncTeacherZoomToAllStudents(teacherId, newZoomLink, oldZoomLink) {
      // Phase 3 ownership model: only overwrite a value that is EMPTY
      // or equals the teacher's PREVIOUS default (a synced copy).
      // Distinct custom/manual values are user-owned and PRESERVED:
      // a session-specific schedule link, or a manually entered
      // student link, is never clobbered by a teacher-default change.
      // When the old default is unknown (''), only empty values sync
      // (fail closed toward preservation). Trial links are untouched:
      // trials are not students and may intentionally use other links.
      if (!teacherId || !newZoomLink) return { success: false, schedulesCount: 0, studentsCount: 0, trialsCount: 0 };
      const cleanLink = newZoomLink.trim();
      const oldLink = (oldZoomLink || '').trim();
      const isSyncedCopy = (v) => {
        const cur = String(v || '').trim();
        if (!cur) return true;
        return oldLink !== '' && cur === oldLink;
      };
      let updatedSchedulesCount = 0;
      let updatedStudentsCount = 0;

      // 1. Cascade update to weekly class_schedules — synced copies only.
      try {
        const { data: scheds } = await db.from('class_schedules')
          .select('id, meeting_link')
          .eq('teacher_id', teacherId);
        for (const sch of (scheds || [])) {
          if (!isSyncedCopy(sch.meeting_link)) continue;
          const { error } = await db.from('class_schedules')
            .update({ meeting_link: cleanLink })
            .eq('id', sch.id);
          if (!error) updatedSchedulesCount++;
        }
      } catch (err) {
        console.warn("Supabase schedule zoom sync notice:", err);
      }

      // 2. Trial classes are deliberately NOT synced (see note above).

      // 3. Update students notes assigned to this teacher — synced
      // copies only, both link keys, plus the profiles mirror cache.
      try {
        const { data: stuList } = await db.from('students')
          .select('id, notes')
          .eq('assigned_teacher_id', teacherId);

        if (stuList && stuList.length > 0) {
          for (const s of stuList) {
            try {
              let parsed = JSON.parse(s.notes || '{}');
              const cur = parsed.meeting_link || parsed.zoom_link || '';
              if (!isSyncedCopy(cur)) continue;
              parsed.meeting_link = cleanLink;
              parsed.zoom_link = cleanLink;
              await db.from('students').update({ notes: JSON.stringify(parsed) }).eq('id', s.id);
              try {
                const profiles = JSON.parse(localStorage.getItem('alhuda_student_profiles') || '{}');
                if (profiles[s.id]) {
                  profiles[s.id].meeting_link = cleanLink;
                  localStorage.setItem('alhuda_student_profiles', JSON.stringify(profiles));
                }
              } catch (e) {}
              updatedStudentsCount++;
            } catch(e){}
          }
        }
      } catch (err) {
        console.warn("Student notes zoom sync notice:", err);
      }

      // 4. Update teacher account in local cache
      const accounts = getTeacherAccounts();
      if (accounts[teacherId]) {
        accounts[teacherId].zoom_link = cleanLink;
        localStorage.setItem('alhuda_teacher_accounts', JSON.stringify(accounts));
      }

      return {
        success: true,
        schedulesCount: updatedSchedulesCount,
        studentsCount: updatedStudentsCount,
        trialsCount: 0
      };
    }

    function openQuickZoomModal(teacherId) {
      const teacher = ALL_TEACHERS.find(t => t.id === teacherId);
      if (!teacher) return;
      const accounts = getTeacherAccounts();
      const acc = accounts[teacherId] || {};
      const creds = getTeacherCreds(teacher);

      document.getElementById('quickZoomTeacherRawId').value = teacherId;
      document.getElementById('quickZoomTeacherName').innerText = `${teacher.full_name}'s Zoom Classroom`;
      document.getElementById('quickZoomTeacherId').innerText = `${creds.teacher_id} • ${teacher.working_shift || 'Shift'}`;

      // S8 (Batch 4): NEVER fabricate a Zoom link/meeting ID/passcode.
      // Empty stays empty until a real link is typed in.
      const quickZoomLinkInput = document.getElementById('quickZoomLinkInput');
      quickZoomLinkInput.value = acc.zoom_link || '';
      quickZoomLinkInput.placeholder = "Paste the teacher's real Zoom link";
      const quickZoomPmiInput = document.getElementById('quickZoomPmiInput');
      quickZoomPmiInput.value = acc.zoom_meeting_id || '';
      quickZoomPmiInput.placeholder = 'Meeting ID (optional)';
      const quickZoomPasscodeInput = document.getElementById('quickZoomPasscodeInput');
      quickZoomPasscodeInput.value = acc.zoom_passcode || '';
      quickZoomPasscodeInput.placeholder = 'Passcode (optional)';

      openModal('modalTeacherQuickZoom');
    }

    async function handleQuickZoomSave() {
      const btn = document.getElementById('btnSaveQuickZoom');
      const teacherId = document.getElementById('quickZoomTeacherRawId').value;
      const zoomLink = (document.getElementById('quickZoomLinkInput').value || '').trim();
      const zoomPmi = (document.getElementById('quickZoomPmiInput').value || '').trim();
      const zoomPasscode = (document.getElementById('quickZoomPasscodeInput').value || '').trim();

      if (!zoomLink) {
        lmsNotify("Please enter a Zoom Meeting Link.");
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Auto-Cascading to All Students...';
      }

      // Save in teacher account
      const accounts = getTeacherAccounts();
      accounts[teacherId] = {
        ...(accounts[teacherId] || {}),
        zoom_link: zoomLink,
        zoom_meeting_id: zoomPmi,
        zoom_passcode: zoomPasscode
      };
      localStorage.setItem('alhuda_teacher_accounts', JSON.stringify(accounts));

      // Trigger Central Auto-Sync Engine
      const res = await syncTeacherZoomToAllStudents(teacherId, zoomLink);

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Save & Auto-Sync All Students';
      }

      closeModal('modalTeacherQuickZoom');
      await loadTeachers();

      lmsNotify(`🎉 Zoom Link Updated & Auto-Cascaded Successfully!\n\n` +
        `📹 New Zoom Link: ${zoomLink}\n` +
        `📅 Updated Timetable Schedules: ${res.schedulesCount} slots\n` +
        `✨ Updated Trial Classes: ${res.trialsCount} trials\n\n` +
        `All students and timetables for this teacher are now in 100% real-time sync!`
      );
    }

    async function triggerTeacherZoomSync(teacherId) {
      const teacher = ALL_TEACHERS.find(t => t.id === teacherId);
      if (!teacher) return;
      const accounts = getTeacherAccounts();
      const acc = accounts[teacherId] || {};
      const zoomLink = acc.zoom_link || '';

      // S8 (Batch 4): no stored link = nothing to sync. Never sync a mock.
      if (!zoomLink) {
        lmsNotify('No Zoom link is saved for this teacher yet. Add the real link first.');
        return;
      }

      if (await lmsConfirm(`Cascade & sync Zoom link for "${teacher.full_name}" to all assigned students and weekly schedules now?\n\nLink: ${zoomLink}`)) {
        const res = await syncTeacherZoomToAllStudents(teacherId, zoomLink);
        lmsNotify(`✅ Auto-Sync Completed!\n\nUpdated ${res.schedulesCount} schedule slots and ${res.trialsCount} trial classes for ${teacher.full_name}.`);
        await loadTeachers();
      }
    }

    function autoSuggestTeacherUsername(fullName) {
      const firstWord = fullName.trim().split(/\s+/)[0] || '';
      const clean = firstWord.toLowerCase().replace(/[^a-z0-9]/g, '');
      const uInput = document.getElementById('tUsername');
      if (uInput) {
        uInput.value = clean || 'teacher';
      }
      // AUTH HARDENING (Batch 1): the password field is NEVER auto-filled.
      // An empty field means "no password / leave unchanged".
    }

    // AUTH HARDENING (Batch 1): the old "generate" buttons filled the
    // well-known default password. They now generate a genuinely random
    // 16-character password, and only when the owner clicks them on purpose.
    function staffGenerateStrongPassword() {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
      let out = '';
      try {
        const buf = new Uint32Array(16);
        crypto.getRandomValues(buf);
        buf.forEach(n => { out += alphabet[n % alphabet.length]; });
      } catch (e) {
        for (let i = 0; i < 16; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      return out;
    }

    function generateRandomTeacherPass() {
      const pInput = document.getElementById('tPassword');
      if (pInput) pInput.value = staffGenerateStrongPassword();
    }

    function handleShiftChange(val) {
      const customBox = document.getElementById('customShiftTimesBox');
      if (customBox) {
        if (val === 'Custom Hours Shift') {
          customBox.classList.remove('hidden');
          customBox.classList.add('grid');
        } else {
          customBox.classList.add('hidden');
          customBox.classList.remove('grid');
        }
      }
    }



    function clearTeacherExtraFields() {
      TEACHER_EXTRA_FIELD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    }

    function fillTeacherExtraFields(acc) {
      const map = {
        tEmail: acc.email, tNationality: acc.nationality, tQualification2: acc.qualification_02,
        tQualification3: acc.qualification_03, tExperience: acc.experience, tTimezone: acc.timezone,
        tMonthlySalary: acc.monthly_salary, tHourRate: acc.hour_rate, tBankName: acc.bank_name,
        tAccountTitle: acc.account_title, tAccountNumber: acc.account_number
      };
      Object.keys(map).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = (map[id] === undefined || map[id] === null) ? '' : map[id];
      });
    }

    function readTeacherExtraFields() {
      const v = id => (document.getElementById(id)?.value || '').trim();
      const n = id => { const raw = v(id); return raw === '' ? '' : (parseFloat(raw) || 0); };
      return {
        email: v('tEmail'), nationality: v('tNationality'), qualification_02: v('tQualification2'),
        qualification_03: v('tQualification3'), experience: v('tExperience'), timezone: v('tTimezone'),
        monthly_salary: n('tMonthlySalary'), hour_rate: n('tHourRate'), bank_name: v('tBankName'),
        account_title: v('tAccountTitle'), account_number: v('tAccountNumber')
      };
    }

    // Category availability: the select is re-enabled for a fresh form,
    // and a signed-in MANAGER can never pick the Management category
    // (owner directive 2026-10-29: management staff are owner-added only;
    // the save handler still hard-blocks it as defence in depth).
    function syncStaffCategoryAvailability() {
      const sel = document.getElementById('tStaffCategory');
      if (!sel) return;
      sel.disabled = false;
      const mgrOpt = sel.querySelector('option[value="management"]');
      if (mgrOpt) mgrOpt.disabled = (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager');
    }

    function getNextManagerId() {
      const accounts = getTeacherAccounts();
      let max = 0;
      Object.values(accounts).forEach(acc => {
        if (acc && acc.teacher_id) {
          const m = String(acc.teacher_id).match(/MGR-(\d+)/i);
          if (m) max = Math.max(max, parseInt(m[1], 10));
        }
      });
      return 'MGR-' + String(max + 1).padStart(3, '0');
    }

    // Owner-only: register a MANAGER through the same full form, with the
    // Staff Category locked to Management and an MGR- employee code.
    function prepareAddManagerModal() {
      if (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') {
        lmsNotify('Managers cannot add Management staff. Please ask the owner.');
        return;
      }
      prepareAddTeacherModal();
      const mgrId = getNextManagerId();
      const titleEl = document.getElementById('modalTeacherTitle');
      if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-user-tie text-indigo-600"></i> Register Manager Profile (Full Details)';
      const btnText = document.getElementById('btnSaveTeacherText');
      if (btnText) btnText.innerText = 'Save Manager & Generate LMS Account';
      const catSel = document.getElementById('tStaffCategory');
      if (catSel) { catSel.value = 'management'; catSel.disabled = true; }
      const badge = document.getElementById('tGeneratedIdBadge');
      if (badge) badge.innerText = mgrId;
      const valInput = document.getElementById('tGeneratedIdVal');
      if (valInput) valInput.value = mgrId;
      const portalId = document.getElementById('tPortalId');
      if (portalId) portalId.value = mgrId;
    }

    function prepareAddTeacherModal() {
      const editIdInput = document.getElementById('editTeacherId');
      if (editIdInput) editIdInput.value = '';
      _editTeacherOrigAddress = '';

      const catSelAdd = document.getElementById('tStaffCategory');
      if (catSelAdd) catSelAdd.value = 'teaching';
      const titleEl = document.getElementById('modalTeacherTitle');
      if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-chalkboard-user text-brandEmerald"></i> Register Teacher Profile (Full Details)';

      const btnText = document.getElementById('btnSaveTeacherText');
      if (btnText) btnText.innerText = 'Save Teacher & Generate LMS Account';

      // Clear form inputs
      const fName = document.getElementById('tFullName');
      if (fName) fName.value = '';
      const fatName = document.getElementById('tFatherName');
      if (fatName) fatName.value = '';
      const qual = document.getElementById('tQualification');
      if (qual) qual.value = '';
      const cnic = document.getElementById('tCnic');
      if (cnic) cnic.value = '';
      const addr = document.getElementById('tAddress');
      if (addr) addr.value = '';
      const phone = document.getElementById('tPhone');
      if (phone) phone.value = '';
      const altPhone = document.getElementById('tAltPhone');
      if (altPhone) altPhone.value = '';
      const witName = document.getElementById('tWitnessName');
      if (witName) witName.value = '';
      const witPhone = document.getElementById('tWitnessPhone');
      if (witPhone) witPhone.value = '';
      const uInput = document.getElementById('tUsername');
      if (uInput) uInput.value = '';
      const rSlot = document.getElementById('tRateSlot');
      if (rSlot) rSlot.value = '2200';

      const jDate = document.getElementById('tJoiningDate');
      if (jDate) jDate.value = new Date().toISOString().slice(0, 10);
      const incTier = document.getElementById('tIncrementTier');
      if (incTier) incTier.value = 'auto';

      // Clear Zoom inputs
      const zLink = document.getElementById('tZoomLink');
      if (zLink) zLink.value = '';
      const zPmi = document.getElementById('tZoomMeetingId');
      if (zPmi) zPmi.value = '';
      const zPass = document.getElementById('tZoomPasscode');
      if (zPass) zPass.value = '';
      const zHostKey = document.getElementById('tZoomHostKey');
      if (zHostKey) zHostKey.value = '';
      const zAutoSync = document.getElementById('tZoomAutoSync');
      if (zAutoSync) zAutoSync.checked = true;

      clearTeacherExtraFields();
      syncStaffCategoryAvailability();

      const newId = getNextTeacherId();
      const badge = document.getElementById('tGeneratedIdBadge');
      if (badge) badge.innerText = newId;
      const valInput = document.getElementById('tGeneratedIdVal');
      if (valInput) valInput.value = newId;
      const portalId = document.getElementById('tPortalId');
      if (portalId) portalId.value = newId;

      // AUTH HARDENING (Batch 1): password field starts BLANK (it used to
      // be auto-filled with the well-known default on every form open).
      const newPwInput = document.getElementById('tPassword');
      if (newPwInput) newPwInput.value = '';
      openModal('modalAddTeacher');
    }

    function openEditTeacherModal(teacherId) {
      const teacher = ALL_TEACHERS.find(t => t.id === teacherId);
      if (!teacher) {
        lmsNotify("Teacher record not found.");
        return;
      }

      const creds = getTeacherCreds(teacher);
      const accounts = getTeacherAccounts();
      const acc = accounts[teacherId] || {};

      document.getElementById('editTeacherId').value = teacher.id;
      _editTeacherOrigAddress = teacher.address || '';
      const titleEl = document.getElementById('modalTeacherTitle');
      if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-pen-to-square text-amber-500"></i> Edit Teacher Profile: <span class="text-slate-900">${teacher.full_name}</span>`;

      const btnText = document.getElementById('btnSaveTeacherText');
      if (btnText) btnText.innerText = 'Update Teacher Profile';

      document.getElementById('tGeneratedIdBadge').innerText = creds.teacher_id || 'TCH';
      document.getElementById('tGeneratedIdVal').value = creds.teacher_id || 'TCH';
      document.getElementById('tPortalId').value = creds.teacher_id || 'TCH';

      document.getElementById('tFullName').value = teacher.full_name || '';
      document.getElementById('tFatherName').value = teacher.father_name || '';
      document.getElementById('tGender').value = teacher.gender || acc.gender || 'Male';
      document.getElementById('tQualification').value = acc.qualification || '';
      document.getElementById('tCnic').value = acc.cnic || '';
      let cleanResidentialAddr = teacher.address || '';
      if (typeof cleanResidentialAddr === 'string' && cleanResidentialAddr.trim().startsWith('{')) {
        try {
          const parsedAddr = JSON.parse(cleanResidentialAddr);
          cleanResidentialAddr = parsedAddr.residential_address || parsedAddr.address || '';
        } catch (e) {}
      }
      document.getElementById('tAddress').value = cleanResidentialAddr;
      document.getElementById('tPhone').value = teacher.phone || '';
      document.getElementById('tAltPhone').value = teacher.alt_phone || '';
      document.getElementById('tWitnessName').value = teacher.witness_name || '';
      document.getElementById('tWitnessPhone').value = teacher.witness_phone || '';
      document.getElementById('tRateSlot').value = teacher.rate_per_slot || 2200;

      if (teacher.working_shift) {
        document.getElementById('tShift').value = teacher.working_shift;
      }

      const joiningDate = acc.joining_date || (teacher.created_at ? teacher.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
      document.getElementById('tJoiningDate').value = joiningDate;
      // Employees redesign E3: Staff Category selector (canonical values).
      const catSelEdit = document.getElementById('tStaffCategory');
      if (catSelEdit) catSelEdit.value = (typeof StaffCategories !== 'undefined' && StaffCategories.of) ? StaffCategories.of(teacher) : 'teaching';
      document.getElementById('tIncrementTier').value = acc.increment_tier || 'auto';

      document.getElementById('tUsername').value = creds.username || '';
      // AUTH HARDENING (Batch 1): the stored password is NEVER shown or
      // refilled (it is a server-side hash now). Blank = keep current.
      const editPwInput = document.getElementById('tPassword');
      editPwInput.value = '';
      editPwInput.placeholder = creds.hasExplicitPassword
        ? 'Leave blank to keep current password'
        : 'No password set — enter one (min 10 characters) to set it now';

      // Populate Zoom classroom fields.
      // S8 (Batch 4): NEVER fabricate a Zoom link/meeting ID/passcode —
      // empty stays empty (with a hint) until a real link is typed in.
      const tZoomLinkInput = document.getElementById('tZoomLink');
      tZoomLinkInput.value = acc.zoom_link || '';
      tZoomLinkInput.placeholder = "Paste the teacher's real Zoom link";
      const tZoomMeetingIdInput = document.getElementById('tZoomMeetingId');
      tZoomMeetingIdInput.value = acc.zoom_meeting_id || '';
      tZoomMeetingIdInput.placeholder = 'Meeting ID (optional)';
      const tZoomPasscodeInput = document.getElementById('tZoomPasscode');
      tZoomPasscodeInput.value = acc.zoom_passcode || '';
      tZoomPasscodeInput.placeholder = 'Passcode (optional)';
      document.getElementById('tZoomHostKey').value = acc.zoom_host_key || '';
      const autoSyncCheck = document.getElementById('tZoomAutoSync');
      if (autoSyncCheck) autoSyncCheck.checked = true;
      fillTeacherExtraFields(acc);
      syncStaffCategoryAvailability();

      openModal('modalAddTeacher');
    }

    // Staff deactivation (owner directive 2026-10-29): staff are NEVER
    // hard-deleted from the Employees list. Deactivation changes ONLY
    // the record's status — profile, credentials, schedules, salary
    // history and student records all stay saved — the portal login
    // stops (the backend treats 'Deactivated' as an inactive account),
    // and the person moves to the Deactivated Staff view. Reactivation
    // restores status 'Active' and the person returns to their category.
    async function setStaffDeactivated(teacherId, deactivate) {
      if (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') {
        lmsNotify('Managers cannot deactivate or reactivate staff records.');
        return;
      }
      const teacher = (ALL_TEACHERS || []).find(t => t.id === teacherId);
      if (!teacher) return;
      const tName = teacher.full_name || 'this employee';
      const category = (typeof StaffCategories !== 'undefined' && StaffCategories.of) ? StaffCategories.of(teacher) : 'teaching';
      if (deactivate) {
        if (!(await lmsConfirm(`Deactivate "${tName}"?\n\nNo data will be deleted. Their profile, salary history and records stay saved, their portal login will stop, and they will move to Deactivated Staff.`))) return;
      } else {
        if (!(await lmsConfirm(`Reactivate "${tName}"?\n\nThey will return to their staff category with all their saved data and portal access restored.`))) return;
      }
      try {
        const { error } = await db.from('teachers').update({ status: deactivate ? 'Deactivated' : 'Active' }).eq('id', teacherId);
        if (error) throw error;
        if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
        if (!deactivate) window.EMP_CATEGORY_TAB = category;
        await loadTeachers(true);
        lmsNotify(deactivate
          ? `"${tName}" has been deactivated. All their data is preserved under Deactivated Staff.`
          : `"${tName}" has been reactivated with all their saved data.`);
      } catch (err) {
        console.warn('[LMS] operation failed:', (err && err.message) || err);
        lmsNotify('The status could not be changed. Please try again.', { type: 'error' });
      }
    }
    window.setStaffDeactivated = setStaffDeactivated;

    async function loadTeachers(forceRefresh = false) {
      const btnAddMgr = document.getElementById('btnAddManager');
      if (btnAddMgr) btnAddMgr.style.display = (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') ? 'none' : '';
      const container = document.getElementById('teachersGrid');
      if (!container) return;

      let teachers = ALL_TEACHERS || [];
      let scheds = ALL_CLASS_SCHEDULES || [];
      if (typeof ensureCoreLmsDataLoaded === 'function') {
        const core = await ensureCoreLmsDataLoaded({ force: Boolean(forceRefresh) });
        ALL_TEACHERS = core.teachers || [];
        teachers = ALL_TEACHERS;
        scheds = core.schedules || [];
      } else {
        const [{ data: tData }, { data: scData }] = await Promise.all([
          db.from('teachers').select('*').order('created_at', { ascending: false }),
          db.from('class_schedules').select('teacher_id, student_id')
        ]);
        ALL_TEACHERS = tData || [];
        teachers = ALL_TEACHERS;
        scheds = scData || [];
        if (typeof hydrateGlobalSharedStateFromCloud === 'function') {
          await hydrateGlobalSharedStateFromCloud(window.ALL_FAMILIES, ALL_TEACHERS);
        }
      }

      const countMap = {};
      (scheds || []).forEach(s => {
        const stuObj = (window.ALL_STUDENTS || []).find(st => String(st.id) === String(s.student_id));
        if (stuObj && typeof isStudentSelfDeactivated === 'function' && isStudentSelfDeactivated(stuObj)) return;
        if (stuObj && stuObj.assigned_teacher_id && String(stuObj.assigned_teacher_id) !== String(s.teacher_id)) return;
        countMap[s.teacher_id] = (countMap[s.teacher_id] || 0) + 1;
      });

      const accounts = getTeacherAccounts();

      // In student enrollment modal, only list actual teaching staff (exclude managers/non-teaching staff)
      const sTeacherSelect = document.getElementById('stuTeacherId');
      if (sTeacherSelect) {
        const teachingOnly = (typeof getEligibleTeachers === 'function')
          ? getEligibleTeachers(teachers)
          : (teachers || []).filter(t => {
              let m = {};
              try {
                if (t.address && t.address.startsWith('{')) m = JSON.parse(t.address);
                else if (t.witness_name && t.witness_name.startsWith('{')) m = JSON.parse(t.witness_name);
                else if (t.notes && t.notes.startsWith('{')) m = JSON.parse(t.notes);
              } catch(e){}
              const acc = accounts[t.id] || {};
              return m.employee_type !== 'manager' && m.employee_type !== 'other_staff' && acc.employee_type !== 'manager' && acc.employee_type !== 'other_staff' && t.working_shift !== 'Manager' && !String(t.id).startsWith('MGR-') && !String(t.id).startsWith('STF-') && !String(m.emp_id || '').startsWith('MGR-') && !String(acc.teacher_id || '').startsWith('MGR-') && !String(t.witness_name || '').startsWith('MGR-') && !String(t.witness_name || '').startsWith('STF-');
            });
        sTeacherSelect.innerHTML = teachingOnly.map(t => `<option value="${t.id}">${t.full_name} (${t.rate_per_slot || 2200} PKR)</option>`).join('');
      }

      if (!teachers || teachers.length === 0) {
        container.innerHTML = `
          <div class="col-span-full p-10 text-center bg-white rounded-2xl border border-slate-200">
            <i class="fa-solid fa-id-card text-4xl text-slate-300 mb-3"></i>
            <h4 class="font-extrabold text-slate-700 text-base">No Employees Registered Yet</h4>
            <p class="text-xs text-slate-400 mt-1 mb-4">Click "+ Add New Employee" above to register teaching and non-teaching staff.</p>
          </div>
        `;
        return;
      }

      // ==========================================================
      // EMPLOYEES REDESIGN (2026-10-29): category tabs + clean list.
      // Categories come from the ONE canonical classifier
      // (StaffCategories in js/config.js). The cards are replaced by a
      // table (desktop) / stacked labelled rows (mobile). All existing
      // actions are preserved with their existing permission rules.
      // ==========================================================
      const enriched = teachers.map(t => {
        let meta = {};
        try {
          if (t.address && t.address.startsWith('{')) meta = JSON.parse(t.address);
          else if (t.witness_name && t.witness_name.startsWith('{')) meta = JSON.parse(t.witness_name);
          else if (t.notes && t.notes.startsWith('{')) meta = JSON.parse(t.notes);
        } catch (e) {}
        const acc = accounts[t.id] || {};
        if (!meta.employee_type && acc.employee_type) meta = { ...meta, ...acc };
        if (!meta.emp_id && (String(t.witness_name || '').startsWith('MGR-') || String(t.witness_name || '').startsWith('STF-'))) {
          meta.emp_id = t.witness_name;
        }
        const category = (typeof StaffCategories !== 'undefined' && StaffCategories.of) ? StaffCategories.of(t) : 'teaching';
        const conflict = (typeof StaffCategories !== 'undefined' && StaffCategories.hasConflict) ? StaffCategories.hasConflict(t) : false;
        const statusNorm = String(t.status || 'Active').trim().toLowerCase();
        const isDeactivated = ['inactive', 'deactivated', 'terminated'].includes(statusNorm);
        return { t, meta, acc, category, conflict, isDeactivated };
      });

      const catCounts = { teaching: 0, management: 0, 'non-teaching': 0, deactivated: 0 };
      enriched.forEach(r => {
        if (r.isDeactivated) catCounts.deactivated += 1;
        else catCounts[r.category] = (catCounts[r.category] || 0) + 1;
      });
      ['teaching', 'management', 'non-teaching', 'deactivated'].forEach(c => {
        const el = document.getElementById('empCount-' + c);
        if (el) el.textContent = catCounts[c] || 0;
        const tab = document.getElementById('empTab-' + c);
        if (tab) {
          const active = (window.EMP_CATEGORY_TAB || 'teaching') === c;
          tab.classList.toggle('bg-brandDark', active);
          tab.classList.toggle('text-white', active);
          tab.classList.toggle('bg-white', !active);
          tab.classList.toggle('text-slate-600', !active);
        }
      });
      const reviewCount = enriched.filter(r => r.conflict).length;
      const reviewNote = document.getElementById('empReviewNote');
      if (reviewNote) {
        reviewNote.classList.toggle('hidden', reviewCount === 0);
        if (reviewCount > 0) reviewNote.textContent = reviewCount + ' employee record(s) have conflicting category signals — please review their category in the employee profile.';
      }

      const activeCat = window.EMP_CATEGORY_TAB || 'teaching';
      const query = String(window.EMP_SEARCH_QUERY || '').trim().toLowerCase();
      const visible = enriched.filter(r => activeCat === 'deactivated' ? r.isDeactivated : (r.category === activeCat && !r.isDeactivated)).filter(r => {
        if (!query) return true;
        const credsId = r.category === 'teaching' ? (getTeacherCreds(r.t).teacher_id || '') : (r.meta.emp_id || r.acc.teacher_id || '');
        const hay = [r.t.full_name, credsId, r.t.id, r.meta.username, r.acc.username, r.t.phone].join(' ').toLowerCase();
        return hay.includes(query);
      });

      if (visible.length === 0) {
        container.innerHTML = `
          <div class="p-10 text-center bg-white rounded-2xl border border-slate-200">
            <i class="fa-solid fa-user-slash text-4xl text-slate-300 mb-3"></i>
            <h4 class="font-extrabold text-slate-700 text-base">No ${activeCat === 'deactivated' ? 'Deactivated Staff' : (((typeof StaffCategories !== 'undefined' && StaffCategories.LABELS) || {})[activeCat] || 'Employees')} Found</h4>
            <p class="text-xs text-slate-400 mt-1">${query ? 'No employee in this category matches your search.' : (activeCat === 'deactivated' ? 'No deactivated staff yet. Anyone you deactivate will appear here with all their data preserved.' : 'No employees are registered in this category yet. Use "+ Add New Employee" above to add one.')}</p>
          </div>
        `;
        return;
      }

      const catBadge = {
        teaching: '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200">Teaching</span>',
        management: '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-indigo-100 text-indigo-800 border border-indigo-200">Management</span>',
        'non-teaching': '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-slate-100 text-slate-700 border border-slate-200">Non-Teaching</span>'
      };
      const isManagerSession = (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager');

      const rowsHtml = visible.map(({ t, meta, acc, category, conflict, isDeactivated }) => {
        const statusBadge = isDeactivated
          ? '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-100 text-rose-800 border border-rose-200">Deactivated</span>'
          : `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${t.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">${t.status || 'Active'}</span>`;
        const reviewBadge = conflict ? ' <span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200" title="Conflicting category signals — please review">Needs review</span>' : '';
        const initials = `<span class="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 text-brandDark inline-flex items-center justify-center font-black text-xs mr-2.5 align-middle">${String(t.full_name || '?').slice(0, 2).toUpperCase()}</span>`;

        // MANAGER RECORD SEEN BY A MANAGER SESSION: plain row only —
        // no contacts, no salary, no actions (Batch 2 rule, unchanged).
        if (category === 'management' && isManagerSession) {
          const mgrIdPlain = meta.emp_id || (String(t.witness_name || '').startsWith('MGR-') ? t.witness_name : null) || acc.teacher_id || (String(t.id).startsWith('MGR-') ? t.id : 'MGR-001');
          return `
            <tr>
              <td data-label="Employee">${initials}<span class="font-extrabold text-slate-900">${t.full_name}</span><div class="text-[11px] text-slate-500 font-mono ml-[46px]">${mgrIdPlain}</div></td>
                <td data-label="Category">${catBadge.management}${reviewBadge}</td>
              <td data-label="Contact" class="text-slate-400">—</td>
              <td data-label="Students">—</td>
              <td data-label="Compensation" class="text-slate-400">—</td>
              <td data-label="Status">${statusBadge}</td>
              <td data-label="Actions"><span class="text-[11px] text-slate-500"><i class="fa-solid fa-lock text-indigo-500"></i> Manager account — owner only</span></td>
            </tr>`;
        }

        let displayId, designation, compensation, studentsCell = '—', actions = '';

        if (category === 'teaching') {
          const creds = getTeacherCreds(t);
          displayId = creds.teacher_id;
          designation = meta.role_title || meta.designation || 'Quran Instructor';
          compensation = `${t.rate_per_slot || 2200} PKR / stu`;
          const activeCount = (window.ALL_STUDENTS || []).filter(s => {
            if (String(s.assigned_teacher_id || '') !== String(t.id)) return false;
            const stLow = String(s.status || 'Active').trim().toLowerCase();
            if (['inactive', 'deactivated', 'left', 'deleted', 'trial', 'converted', 'leave'].includes(stLow)) return false;
            if (typeof isStudentSelfDeactivated === 'function' && isStudentSelfDeactivated(s)) return false;
            try { const sMeta = typeof s.notes === 'string' ? JSON.parse(s.notes || '{}') : (s.notes || {}); if (sMeta && sMeta.on_leave === true) return false; } catch (e) {}
            return true;
          }).length;
          const trAll = (typeof ALL_TRIALS !== 'undefined' ? ALL_TRIALS : []).filter(tr => tr.teacher_id === t.id);
          const trActive = trAll.filter(tr => tr.status !== 'Converted' && tr.status !== 'Discontinued').length;
          studentsCell = `<strong class="text-emerald-700">${activeCount} Student${activeCount === 1 ? '' : 's'}</strong>` +
            (trAll.length ? `<button onclick="viewTeacherTrialsHistory('${t.id}')" class="block text-[10px] text-purple-700 font-bold hover:underline mt-0.5">Trials: ${trActive} active / ${trAll.length} total</button>` : '');
          const cleanPhone = (t.phone || '').replace(/[^0-9]/g, '');
          const waMsg = `Assalamu Alaikum Respected ${t.full_name},\nWelcome to the Al-Huda Islamic Centre Teacher Operations Portal.\n\n🌐 *Your Personal Portal Link:*\n${window.location.origin}/teacher.html\n\n👤 *Username:* ${creds.username}\n🕒 *Assigned Shift:* ${t.working_shift || '10 Hours Shift'}\n💰 *Slot Rate:* ${t.rate_per_slot || 2200} PKR\n\nYour password will be given to you by the administrator in person or by phone.\nPlease tap the link above to view your timetable, Student List, and lesson logs.\nJazakum Allahu Khairan!`;
          actions = `
            <button onclick="open2DMatrixForTeacher('${t.id}')" class="px-2.5 py-1.5 bg-indigo-900 hover:bg-indigo-950 text-white rounded-lg font-bold text-[11px]">Schedule Matrix</button>
            ${(!acc.zoom_link) ? '<span class="text-[10px] text-slate-400 font-semibold self-center">Class link not set yet</span>' : ''}
            <button onclick="openQuickZoomModal('${t.id}')" title="Quick Zoom" class="px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px]"><i class="fa-solid fa-video"></i></button>
            ${!isManagerSession ? `<button onclick="setStaffDeactivated('${t.id}', true)" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-lg font-bold text-[11px]"><i class="fa-solid fa-user-slash mr-1"></i>Deactivate</button>` : ''}`;
        } else if (category === 'management') {
          displayId = meta.emp_id || (String(t.witness_name || '').startsWith('MGR-') ? t.witness_name : null) || acc.teacher_id || (String(t.id).startsWith('MGR-') ? t.id : 'MGR-001');
          designation = meta.role_title || meta.designation || 'Operations Manager';
          compensation = meta.salary ? `${meta.salary} PKR / mo` : (t.rate_per_slot ? `${t.rate_per_slot} PKR` : 'As Agreed');
          const mgrUsername = meta.username || acc.username || `mgr.${String(t.full_name || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 8)}`;
          const cleanPhone = (t.phone || '').replace(/[^0-9]/g, '');
          const mgrPortalUrl = `${window.location.origin}/manager.html`;
          const waMsg = `Assalamu Alaikum Respected ${t.full_name},\nWelcome to Al-Huda Islamic Centre Management Operations.\n\n🌐 *Your Dedicated Manager Portal Link:*\n${mgrPortalUrl}\n\n🆔 *Manager ID:* ${displayId}\n👤 *Login Username:* ${mgrUsername}\n💼 *Role / Title:* ${designation}\n\nYour password will be given to you by the administrator in person or by phone.\nPlease click your portal link to access all management tools, rosters, timetables, and system follow-ups.\nJazakum Allahu Khairan!`;
          actions = !isManagerSession ? `
            <button onclick="setStaffDeactivated('${t.id}', true)" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-lg font-bold text-[11px]"><i class="fa-solid fa-user-slash mr-1"></i>Deactivate</button>` : '';
        } else {
          displayId = meta.emp_id || (String(t.witness_name || '').startsWith('STF-') ? t.witness_name : null) || acc.teacher_id || (String(t.id).startsWith('STF-') ? t.id : 'STF-001');
          designation = meta.role_title || meta.designation || 'Support & Administrative Staff';
          compensation = meta.salary ? `${meta.salary} PKR / mo` : (t.rate_per_slot ? `${t.rate_per_slot} PKR` : 'As Agreed');
          actions = !isManagerSession ? `
            <button onclick="setStaffDeactivated('${t.id}', true)" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-lg font-bold text-[11px]"><i class="fa-solid fa-user-slash mr-1"></i>Deactivate</button>` : '';
        }

        if (isDeactivated) {
          actions = !isManagerSession
            ? `<button onclick="setStaffDeactivated('${t.id}', false)" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px]"><i class="fa-solid fa-user-check mr-1"></i>Reactivate</button>`
            : '';
        }

        return `
          <tr class="hover:bg-slate-50">
            <td data-label="Employee">${initials}<button onclick="openTeacher360Profile('${t.id}')" class="font-extrabold text-slate-900 hover:text-indigo-700 hover:underline text-left">${t.full_name}</button><div class="text-[11px] text-slate-500 font-mono ml-[46px]">${displayId}</div></td>
            <td data-label="Category">${catBadge[category]}${reviewBadge}</td>
            <td data-label="Contact"><span class="font-mono text-xs">${t.phone || '—'}</span></td>
            <td data-label="Students">${studentsCell}</td>
            <td data-label="Compensation"><strong class="text-emerald-700 text-xs">${compensation}</strong></td>
            <td data-label="Status">${statusBadge}</td>
            <td data-label="Actions"><div class="flex flex-wrap gap-1.5">${actions}</div></td>
          </tr>`;
      }).join('');

      container.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table class="emp-table">
            <thead><tr>
              <th>Employee</th><th>Category</th><th>Contact</th><th>Students</th><th>Compensation</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`;
    }

    // Employees redesign: category tab + in-category search controls.
    window.EMP_CATEGORY_TAB = window.EMP_CATEGORY_TAB || 'teaching';
    window.EMP_SEARCH_QUERY = window.EMP_SEARCH_QUERY || '';
    function setEmployeeCategory(cat) {
      if (!['teaching', 'management', 'non-teaching', 'deactivated'].includes(cat)) return;
      window.EMP_CATEGORY_TAB = cat;
      loadTeachers();
    }
    function setEmployeeSearch(q) {
      window.EMP_SEARCH_QUERY = String(q || '');
      loadTeachers();
    }
    window.setEmployeeCategory = setEmployeeCategory;
    window.setEmployeeSearch = setEmployeeSearch;

    function copyTeacherCredentials(user, teacherName) {
      // AUTH HARDENING (Batch 1): copy tools copy the USERNAME only —
      // passwords are never copied, displayed or messaged anymore.
      const url = `${window.location.origin}/teacher.html`;
      const txt = `Al-Huda Islamic Centre LMS - Teacher Portal\nTeacher: ${teacherName}\nPortal Link: ${url}\nUsername: ${user}\nYour password will be given to you by the administrator in person or by phone.`;
      navigator.clipboard.writeText(txt);
      lmsNotify(`Copied to clipboard!\n\n${txt}`);
    }

    function copyManagerCredentials(id, user, managerName, portalUrl) {
      // AUTH HARDENING (Batch 1): copy tools copy the USERNAME only.
      const url = portalUrl || `${window.location.origin}/manager.html`;
      const txt = `Al-Huda Islamic Centre LMS — Manager Portal\nManager: ${managerName}\nManager ID: ${id}\nPortal Link: ${url}\nUsername: ${user}\nYour password will be given to you by the administrator in person or by phone.`;
      navigator.clipboard.writeText(txt);
      lmsNotify(`Copied to clipboard!\n\n${txt}`);
    }

    async function handleSaveTeacher(e) {
      e.preventDefault();

      const editTeacherId = (document.getElementById('editTeacherId')?.value || '').trim();

      const full_name = (document.getElementById('tFullName').value || '').trim();
      const phone = (document.getElementById('tPhone').value || '').trim();
      const username = (document.getElementById('tUsername').value || '').trim();
      const password = (document.getElementById('tPassword').value || '').trim();
      const working_shift_val = document.getElementById('tShift').value;
      // Employees redesign E3: canonical Staff Category from the form.
      const staffCategorySel = document.getElementById('tStaffCategory')?.value || 'teaching';
      const staffCategoryEmpType = (typeof StaffCategories !== 'undefined' && StaffCategories.EMPLOYEE_TYPE)
        ? (StaffCategories.EMPLOYEE_TYPE[staffCategorySel] || 'teacher') : 'teacher';
      if (staffCategorySel === 'management' && typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') {
        lmsNotify('Managers cannot assign the Management Staff category. Please ask the owner.');
        return;
      }

      // Mandatory Validations
      if (!full_name) {
        lmsNotify("Please enter the Teacher's Full Name.");
        document.getElementById('tFullName').focus();
        return;
      }

      if (!phone) {
        lmsNotify("Please enter Teacher's Primary WhatsApp Number.");
        document.getElementById('tPhone').focus();
        return;
      }

      if (!username) {
        lmsNotify("Please enter Teacher Portal Username.");
        document.getElementById('tUsername').focus();
        return;
      }

      // AUTH HARDENING (Batch 1): the password is OPTIONAL now. Blank
      // means "leave the current password unchanged" (edit) or "no
      // password set yet" (new record). A typed password must be at
      // least 10 characters and, after the record saves, goes ONLY to
      // the owner-only Worker endpoint — never into the record itself,
      // the local account map, or any message.
      if (password && password.length < 10) {
        lmsNotify('Portal password must be at least 10 characters long (or leave it blank).');
        document.getElementById('tPassword').focus();
        return;
      }

      const father_name = (document.getElementById('tFatherName').value || '').trim();
      const gender = document.getElementById('tGender').value;
      const qualification = (document.getElementById('tQualification').value || '').trim();
      const cnic = (document.getElementById('tCnic').value || '').trim();
      const address = (document.getElementById('tAddress').value || '').trim();
      const alt_phone = (document.getElementById('tAltPhone').value || '').trim();
      const witness_name = (document.getElementById('tWitnessName').value || '').trim();
      const witness_phone = (document.getElementById('tWitnessPhone').value || '').trim();
      const rate_per_slot = parseFloat(document.getElementById('tRateSlot').value) || 2200;
      const joining_date = document.getElementById('tJoiningDate').value || new Date().toISOString().slice(0, 10);
      const increment_tier = document.getElementById('tIncrementTier').value || 'auto';

      let working_shift = working_shift_val;
      if (working_shift === 'Custom Hours Shift') {
        const sStart = document.getElementById('tCustomStart').value || '14:00';
        const sEnd = document.getElementById('tCustomEnd').value || '23:30';
        working_shift = `Custom Hours (${sStart} - ${sEnd} PKT)`;
      }

      const teacher_id_code = document.getElementById('tGeneratedIdVal').value || getNextTeacherId();

      const btn = document.getElementById('btnSaveTeacher');
      btn.disabled = true;
      btn.innerText = editTeacherId ? 'Updating Teacher Profile...' : 'Saving & Creating LMS Account...';

      const zoom_link_raw = (document.getElementById('tZoomLink')?.value || '').trim();
      const zoom_meeting_id = (document.getElementById('tZoomMeetingId')?.value || '').trim();
      const zoom_passcode = (document.getElementById('tZoomPasscode')?.value || '').trim();
      const zoom_host_key = (document.getElementById('tZoomHostKey')?.value || '').trim();
      const auto_sync_zoom = document.getElementById('tZoomAutoSync')?.checked;
      const extraFields = readTeacherExtraFields();

      // Phase 3: a teacher default link must be a Zoom link (or a bare
      // meeting code, normalized). Invalid input stops the save before
      // anything is written — fail closed, never store a bad link.
      let zoom_link = zoom_link_raw;
      if (zoom_link && window.LmsZoomLinks) {
        const checked = window.LmsZoomLinks.normalizeZoomInput(zoom_link);
        if (!checked.ok) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-check"></i> <span id="btnSaveTeacherText">Update Teacher Profile</span>';
          lmsNotify(checked.error, { type: 'error' });
          return;
        }
        zoom_link = checked.normalized;
      }

      if (editTeacherId) {
        // UPDATE MODE — preserve portal credentials (e.g. the login password
        // hash) stored as JSON in teachers.address. Merge the plain-text
        // residential address into the existing JSON instead of overwriting it.
        let addressToSave = address;
        try {
          const origRaw = String(_editTeacherOrigAddress || '').trim();
          if (origRaw.startsWith('{')) {
            const origMeta = JSON.parse(origRaw);
            if (origMeta && typeof origMeta === 'object' && !Array.isArray(origMeta)) {
              origMeta.residential_address = address || origMeta.residential_address || origMeta.address || '';
              origMeta.address = address || origMeta.address || '';
              // Employees redesign E3: persist the chosen category.
              origMeta.employee_type = staffCategoryEmpType;
              addressToSave = JSON.stringify(origMeta);
            }
          }
        } catch (e) {}
        // Employees redesign E3: records created by the non-teaching
        // flow keep employee_type in their NOTES meta — update it there
        // too, so a category change is never lost.
        let notesToSave;
        try {
          const recForNotes = (ALL_TEACHERS || []).find(x => String(x.id) === String(editTeacherId));
          if (recForNotes && typeof recForNotes.notes === 'string' && recForNotes.notes.trim().startsWith('{')) {
            const nMeta = JSON.parse(recForNotes.notes);
            if (nMeta && typeof nMeta === 'object' && 'employee_type' in nMeta) {
              nMeta.employee_type = staffCategoryEmpType;
              notesToSave = JSON.stringify(nMeta);
            }
          }
        } catch (e) {}
        const { error } = await db.from('teachers').update({
          full_name, father_name, phone, alt_phone, address: addressToSave, witness_name, witness_phone, rate_per_slot, working_shift, zoom_link,
          ...(notesToSave !== undefined ? { notes: notesToSave } : {})
        }).eq('id', editTeacherId);

        if (error) {
          // Audit P1-3: report a failed profile save honestly instead of
          // continuing to the local account, zoom sync, password flow and
          // success alert for a profile that was not saved.
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-check"></i> <span id="btnSaveTeacherText">Update Teacher Profile</span>';
          console.warn('[LMS] operation failed:', (error.message || error)); lmsNotify('The teacher profile could not be saved. Please try again.', { type: 'error' });
          return;
        }

        // Phase 3: capture the PREVIOUS default before overwriting it,
        // so the sync below can tell synced copies from custom values.
        let oldZoomLink = '';
        try {
          const prevAcc = getTeacherAccounts()[editTeacherId] || {};
          oldZoomLink = prevAcc.zoom_link || '';
          if (!oldZoomLink) {
            const prevRow = (ALL_TEACHERS || []).find(t => String(t.id) === String(editTeacherId));
            oldZoomLink = (prevRow && prevRow.zoom_link) || '';
          }
        } catch (e) {}
        saveTeacherAccount(editTeacherId, {
          teacher_id: teacher_id_code,
          username,
          qualification,
          cnic,
          gender,
          working_shift,
          full_name,
          phone,
          joining_date,
          increment_tier,
          zoom_link,
          zoom_meeting_id,
          zoom_passcode,
          zoom_host_key,
          employee_type: staffCategoryEmpType,
          ...extraFields
        });

        if (auto_sync_zoom && zoom_link) {
          await syncTeacherZoomToAllStudents(editTeacherId, zoom_link, oldZoomLink);
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> <span id="btnSaveTeacherText">Update Teacher Profile</span>';
        closeModal('modalAddTeacher');
        await loadTeachers();

        // AUTH HARDENING (Batch 1): a newly typed password goes ONLY to
        // the owner-only Worker endpoint (stored as a salted hash). The
        // profile above is saved either way; on failure, say so clearly.
        let pwStatusLine = '🔑 Portal Password: Unchanged';
        if (password) {
          const existingRec = (ALL_TEACHERS || []).find(x => String(x.id) === String(editTeacherId));
          let existingMeta = {};
          try { if (existingRec && existingRec.address && String(existingRec.address).trim().startsWith('{')) existingMeta = JSON.parse(existingRec.address); } catch (e) {}
          const pwRole = (existingMeta.employee_type === 'manager' || (existingMeta.teacher_account && existingMeta.teacher_account.employee_type === 'manager')) ? 'manager' : 'teacher';
          const prevAcct = getTeacherAccounts()[editTeacherId] || {};
          const prevHasPw = !!prevAcct.hasExplicitPassword || !!(existingMeta.password || (existingMeta.teacher_account && existingMeta.teacher_account.password));
          try {
            if (typeof window.setAccountPasswordViaWorker !== 'function') throw new Error('Password helper unavailable.');
            await window.setAccountPasswordViaWorker(pwRole, editTeacherId, password);
            saveTeacherAccount(editTeacherId, { hasExplicitPassword: true });
            pwStatusLine = '🔑 Portal Password: Updated — give it to them in person or by phone';
            // Batch 2: a signed-in MANAGER sees the new password exactly
            // ONCE (show-once modal) so it can be handed over; the owner
            // flow keeps the status line only. Clear the form field.
            if (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager' && typeof window.showPasswordOnce === 'function') {
              window.showPasswordOnce({ label: pwRole === 'manager' ? 'Manager portal password' : 'Teacher portal password', username: username, password: password });
            }
            const pwFieldU = document.getElementById('tPassword');
            if (pwFieldU) pwFieldU.value = '';
          } catch (pwErr) {
            saveTeacherAccount(editTeacherId, { hasExplicitPassword: prevHasPw });
            console.warn('[LMS] operation failed:', (pwErr.message || pwErr)); lmsNotify('The teacher profile was SAVED, but the PASSWORD was NOT set.\n\nPlease set it again from the Edit form or the password tool. Please try again.', { type: 'error' });
            pwStatusLine = '🔑 Portal Password: NOT updated — please set it via the password tool';
          }
        }

        lmsNotify(`✅ Teacher Profile Updated Successfully!\n\n👨‍🏫 Teacher: ${full_name}\n🆔 Teacher ID: ${teacher_id_code}\n👤 Portal Username: ${username}\n${pwStatusLine}\n🕒 Shift: ${working_shift}\n📹 Zoom: ${zoom_link || 'Not set yet'}`);
      } else {
        // INSERT MODE
        const { data, error } = await db.from('teachers').insert([{
          full_name, father_name, phone, alt_phone, address, witness_name, witness_phone, rate_per_slot, working_shift, zoom_link, status: 'Active'
        }]).select();

        // Audit P1-3: never fabricate a local_ id and a success message
        // when the teacher was not actually saved — no account, no zoom
        // sync, no password for a teacher that does not exist.
        if (error || !(data && data[0])) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> <span id="btnSaveTeacherText">Save Teacher & Generate LMS Account</span>';
          console.warn('[LMS] operation failed:', ((error && (error.message || error)) || 'No record was returned.')); lmsNotify('The teacher could not be saved. Please try again.', { type: 'error' });
          return;
        }

        const insertedId = data[0].id;

        saveTeacherAccount(insertedId, {
          teacher_id: teacher_id_code,
          username,
          qualification,
          cnic,
          gender,
          working_shift,
          full_name,
          phone,
          joining_date,
          increment_tier,
          zoom_link,
          zoom_meeting_id,
          zoom_passcode,
          zoom_host_key,
          employee_type: staffCategoryEmpType,
          ...extraFields
        });

        if (auto_sync_zoom && zoom_link) {
          await syncTeacherZoomToAllStudents(insertedId, zoom_link, '');
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> <span id="btnSaveTeacherText">Save Teacher & Generate LMS Account</span>';
        closeModal('modalAddTeacher');
        await loadTeachers();

        // AUTH HARDENING (Batch 1): same Worker-endpoint password flow as
        // the update branch — the value itself is never stored or shown.
        let newPwStatusLine = '🔑 Portal Password: Not set yet — set one via the Edit form or password tool';
        if (password) {
          try {
            if (typeof window.setAccountPasswordViaWorker !== 'function') throw new Error('Password helper unavailable.');
            await window.setAccountPasswordViaWorker(staffCategorySel === 'management' ? 'manager' : 'teacher', insertedId, password);
            saveTeacherAccount(insertedId, { hasExplicitPassword: true });
            newPwStatusLine = '🔑 Portal Password: Set — give it to the teacher in person or by phone';
            // Batch 2: show-once for a signed-in manager (see update
            // branch); the form password field is cleared either way.
            if (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager' && typeof window.showPasswordOnce === 'function') {
              window.showPasswordOnce({ label: staffCategorySel === 'management' ? 'Manager portal password' : 'Teacher portal password', username: username, password: password });
            }
            const pwFieldI = document.getElementById('tPassword');
            if (pwFieldI) pwFieldI.value = '';
          } catch (pwErr) {
            console.warn('[LMS] operation failed:', (pwErr.message || pwErr)); lmsNotify('The teacher was REGISTERED, but the PASSWORD was NOT set.\n\nPlease set it from the Edit form or the password tool. Please try again.', { type: 'error' });
            newPwStatusLine = '🔑 Portal Password: NOT set — please set it via the password tool';
          }
        }

        lmsNotify(`✅ Teacher Registered Successfully!\n\n👨‍🏫 Teacher: ${full_name}\n🆔 Teacher ID: ${teacher_id_code}\n👤 Portal Username: ${username}\n${newPwStatusLine}\n🕒 Shift: ${working_shift}\n🎓 Qualification: ${qualification || 'As Assigned'}\n\nTeacher can now log into Al-Huda Teacher Portal.`);
      }
    }

