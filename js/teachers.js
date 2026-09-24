/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/teachers.js
 * Purpose: Teachers & Staff Management, Dedicated Zoom Classroom Auto-Cascade & Employee Registration
 * Extracted Line Range: 8594 – 9857 (1264 lines)
 * ============================================================================
 */

    // TEACHER ACCOUNTS & CREDENTIALS STORAGE ENGINE
    function getTeacherAccounts() {
      return JSON.parse(localStorage.getItem('alhuda_teacher_accounts') || localStorage.getItem('bqi_teacher_accounts') || '{}');
    }

    function saveTeacherAccount(tId, creds) {
      const accounts = getTeacherAccounts();
      accounts[tId] = { ...(accounts[tId] || {}), ...creds };
      localStorage.setItem('alhuda_teacher_accounts', JSON.stringify(accounts));
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
      const accounts = getTeacherAccounts();
      if (accounts[t.id] && accounts[t.id].teacher_id) return accounts[t.id];

      // Assign sequential ID based on position in ALL_TEACHERS list
      let seqNum = 1;
      if (ALL_TEACHERS && ALL_TEACHERS.length > 0) {
        const idx = ALL_TEACHERS.findIndex(item => item.id === t.id);
        seqNum = idx >= 0 ? (idx + 1) : 1;
      }
      const assignedId = `TCH-${String(seqNum).padStart(3, '0')}`;

      // Clean first name for username (e.g. "Gulfam" -> "gulfam")
      const firstWord = (t.full_name || 'teacher').trim().split(/\s+/)[0];
      const baseUser = firstWord.toLowerCase().replace(/[^a-z0-9]/g, '') || 'teacher';
      const cleanPhone = (t.phone || '').replace(/[^0-9]/g, '') || '9876543210';

      const defaultCred = {
        teacher_id: assignedId,
        username: baseUser,
        password: '12345678',
        working_shift: t.working_shift || '10 Hours Shift (02:00 PM - 12:00 AM PKT)',
        full_name: t.full_name,
        phone: t.phone,
        zoom_link: `https://zoom.us/j/${cleanPhone}?pwd=alhuda_${baseUser}`,
        zoom_meeting_id: cleanPhone,
        zoom_passcode: '123456'
      };
      saveTeacherAccount(t.id, defaultCred);
      return defaultCred;
    }

    // =========================================================================
    // DEDICATED TEACHER ZOOM CLASSROOM & CENTRAL AUTO-CASCADE SYNC ENGINE
    // =========================================================================

    async function syncTeacherZoomToAllStudents(teacherId, newZoomLink) {
      if (!teacherId || !newZoomLink) return { success: false, schedulesCount: 0, trialsCount: 0 };
      const cleanLink = newZoomLink.trim();
      let updatedSchedulesCount = 0;
      let updatedTrialsCount = 0;

      // 1. Cascade update to all weekly class_schedules in Supabase
      try {
        const { data, error } = await db.from('class_schedules')
          .update({ meeting_link: cleanLink })
          .eq('teacher_id', teacherId)
          .select('id');
        if (!error && data) {
          updatedSchedulesCount = data.length;
        }
      } catch (err) {
        console.warn("Supabase schedule zoom sync notice:", err);
      }

      // 2. Cascade update to all in-memory & stored trial classes
      try {
        let storedTrials = getStoredTrials();
        storedTrials.forEach(tr => {
          if (tr.teacher_id === teacherId) {
            tr.meeting_link = cleanLink;
            updatedTrialsCount++;
          }
        });
        saveStoredTrials(storedTrials);
        ALL_TRIALS = storedTrials;
      } catch (err) {
        console.warn("Trial zoom sync notice:", err);
      }

      // 3. Update Supabase students notes assigned to this teacher
      try {
        const { data: stuList } = await db.from('students')
          .select('id, notes')
          .eq('assigned_teacher_id', teacherId);
        
        if (stuList && stuList.length > 0) {
          for (const s of stuList) {
            try {
              let parsed = JSON.parse(s.notes || '{}');
              parsed.meeting_link = cleanLink;
              await db.from('students').update({ notes: JSON.stringify(parsed) }).eq('id', s.id);
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
        trialsCount: updatedTrialsCount
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

      const defaultMock = `https://zoom.us/j/${teacher.phone ? teacher.phone.replace(/[^0-9]/g, '') : '9876543210'}?pwd=alhuda_${(teacher.full_name||'').toLowerCase().replace(/[^a-z]/g, '')}`;
      document.getElementById('quickZoomLinkInput').value = acc.zoom_link || defaultMock;
      document.getElementById('quickZoomPmiInput').value = acc.zoom_meeting_id || (teacher.phone ? teacher.phone.replace(/[^0-9]/g, '') : '');
      document.getElementById('quickZoomPasscodeInput').value = acc.zoom_passcode || '123456';

      openModal('modalTeacherQuickZoom');
    }

    async function handleQuickZoomSave() {
      const btn = document.getElementById('btnSaveQuickZoom');
      const teacherId = document.getElementById('quickZoomTeacherRawId').value;
      const zoomLink = (document.getElementById('quickZoomLinkInput').value || '').trim();
      const zoomPmi = (document.getElementById('quickZoomPmiInput').value || '').trim();
      const zoomPasscode = (document.getElementById('quickZoomPasscodeInput').value || '').trim();

      if (!zoomLink) {
        alert("Please enter a Zoom Meeting Link.");
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

      alert(`🎉 Zoom Link Updated & Auto-Cascaded Successfully!\n\n` +
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
      const zoomLink = acc.zoom_link || `https://zoom.us/j/${teacher.phone ? teacher.phone.replace(/[^0-9]/g, '') : '9876543210'}?pwd=alhuda_${(teacher.full_name||'').toLowerCase().replace(/[^a-z]/g, '')}`;

      if (confirm(`Cascade & sync Zoom link for "${teacher.full_name}" to all assigned students and weekly schedules now?\n\nLink: ${zoomLink}`)) {
        const res = await syncTeacherZoomToAllStudents(teacherId, zoomLink);
        alert(`✅ Auto-Sync Completed!\n\nUpdated ${res.schedulesCount} schedule slots and ${res.trialsCount} trial classes for ${teacher.full_name}.`);
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
      const pInput = document.getElementById('tPassword');
      if (pInput && !pInput.value) {
        pInput.value = '12345678';
      }
    }

    function generateRandomTeacherPass() {
      const pInput = document.getElementById('tPassword');
      if (pInput) pInput.value = '12345678';
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

    // ================================================
    // EMPLOYEE REGISTRATION — TYPE CHOICE + NTS FORMS
    // ================================================

    function openEmployeeTypeChoice() {
      openModal('modalChooseEmployeeType');
    }

    function openNonTeachingStaffModal() {
      // Reset form
      ['ntsFullName','ntsRoleTitle','ntsPhone','ntsSalary','ntsNotes',
       'ntsCNIC','ntsEmail','ntsEmergencyName','ntsEmergencyPhone','ntsAddress'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const uInput = document.getElementById('ntsUsername');
      if (uInput) {
        uInput.value = '';
        delete uInput.dataset.manualEdited;
      }
      generateRandomManagerPass();
      document.getElementById('ntsGender').value = 'Male';
      const today = new Date().toISOString().slice(0,10);
      document.getElementById('ntsJoiningDate').value = today;
      selectNTSDesignation('Manager'); // default
      openModal('modalAddNonTeachingStaff');
    }

    function selectNTSDesignation(type) {
      document.getElementById('ntsDesignation').value = type;
      const btnM = document.getElementById('btnNTSManager');
      const btnO = document.getElementById('btnNTSOther');
      const mFields = document.getElementById('ntsManagerFields');
      const mCredsBox = document.getElementById('ntsManagerCredentialsBox');
      const note = document.getElementById('ntsDesignationNote');
      const rtWrap = document.getElementById('ntsRoleTitleWrap');

      if (type === 'Manager') {
        btnM.className = 'py-3 rounded-xl border-2 border-indigo-400 bg-indigo-600 text-white font-extrabold flex flex-col items-center gap-1 transition';
        btnO.className = 'py-3 rounded-xl border-2 border-slate-300 bg-white text-slate-700 font-extrabold flex flex-col items-center gap-1 transition hover:border-slate-400';
        if (mFields) mFields.classList.remove('hidden');
        if (mCredsBox) mCredsBox.classList.remove('hidden');
        note.textContent = 'Manager: Dedicated portal ID (MGR-XXX) & login credentials automatically provisioned.';
        // Role title label change
        const lbl = rtWrap?.querySelector('label');
        if (lbl) lbl.textContent = 'Role / Title (optional):';
        document.getElementById('ntsRoleTitle').placeholder = 'e.g. Operations Manager, Finance Manager';
      } else {
        btnO.className = 'py-3 rounded-xl border-2 border-slate-400 bg-slate-700 text-white font-extrabold flex flex-col items-center gap-1 transition';
        btnM.className = 'py-3 rounded-xl border-2 border-slate-300 bg-white text-slate-700 font-extrabold flex flex-col items-center gap-1 transition hover:border-slate-400';
        if (mFields) mFields.classList.add('hidden');
        if (mCredsBox) mCredsBox.classList.add('hidden');
        note.textContent = 'Other Staff: Basic registration with STF-XXX ID (e.g. Office Boy, Peon, Driver)';
        const lbl = rtWrap?.querySelector('label');
        if (lbl) lbl.textContent = 'Role / Title *:';
        document.getElementById('ntsRoleTitle').placeholder = 'e.g. Office Boy, Peon, Driver, Cleaner';
      }
      previewNTSId();
    }

    function getNextManagerId() {
      const existingNums = [];
      (ALL_TEACHERS || []).forEach(t => {
        let meta = {};
        try { meta = JSON.parse(t.notes || '{}'); } catch(e){}
        const idStr = String(t.id || '');
        const metaId = String(meta.emp_id || '');
        const m1 = idStr.match(/MGR-(\d+)/i);
        if (m1) existingNums.push(parseInt(m1[1], 10));
        const m2 = metaId.match(/MGR-(\d+)/i);
        if (m2) existingNums.push(parseInt(m2[1], 10));
      });
      let nextNum = 1;
      if (existingNums.length > 0) {
        nextNum = Math.max(...existingNums) + 1;
      }
      return `MGR-${String(nextNum).padStart(3, '0')}`;
    }

    function getNextStaffId() {
      const existingNums = [];
      (ALL_TEACHERS || []).forEach(t => {
        let meta = {};
        try { meta = JSON.parse(t.notes || '{}'); } catch(e){}
        const idStr = String(t.id || '');
        const metaId = String(meta.emp_id || '');
        const m1 = idStr.match(/STF-(\d+)/i);
        if (m1) existingNums.push(parseInt(m1[1], 10));
        const m2 = metaId.match(/STF-(\d+)/i);
        if (m2) existingNums.push(parseInt(m2[1], 10));
      });
      let nextNum = 1;
      if (existingNums.length > 0) {
        nextNum = Math.max(...existingNums) + 1;
      }
      return `STF-${String(nextNum).padStart(3, '0')}`;
    }

    function previewNTSId() {
      const designation = document.getElementById('ntsDesignation')?.value || 'Manager';
      const genId = designation === 'Manager' ? getNextManagerId() : getNextStaffId();

      const genInput = document.getElementById('ntsGeneratedId');
      if (genInput) genInput.value = genId;
      const preview = document.getElementById('ntsIdPreview');
      if (preview) preview.textContent = genId;
      const badge = document.getElementById('ntsGeneratedIdBadge');
      if (badge) badge.textContent = genId;
      const portalId = document.getElementById('ntsPortalId');
      if (portalId) portalId.value = genId;
      return genId;
    }

    function handleNTSNameInput(fullName) {
      previewNTSId();
      if (document.getElementById('ntsDesignation')?.value === 'Manager') {
        const firstWord = (fullName || '').trim().split(/\s+/)[0] || '';
        const clean = firstWord.toLowerCase().replace(/[^a-z0-9]/g, '');
        const uInput = document.getElementById('ntsUsername');
        if (uInput && (!uInput.dataset.manualEdited || !uInput.value)) {
          uInput.value = clean || 'manager';
        }
      }
    }

    function generateRandomManagerPass() {
      const pInput = document.getElementById('ntsPassword');
      if (pInput) pInput.value = '12345678';
    }

    async function submitNonTeachingStaff(e) {
      e.preventDefault();
      const designation = document.getElementById('ntsDesignation')?.value;
      const full_name   = document.getElementById('ntsFullName')?.value?.trim();
      const role_title  = document.getElementById('ntsRoleTitle')?.value?.trim();
      const phone       = document.getElementById('ntsPhone')?.value?.trim();
      const joining_date = document.getElementById('ntsJoiningDate')?.value;
      const salary      = Number(document.getElementById('ntsSalary')?.value || 0);
      const gender      = document.getElementById('ntsGender')?.value;
      const notes_text  = document.getElementById('ntsNotes')?.value?.trim();
      const cnic        = document.getElementById('ntsCNIC')?.value?.trim();
      const email       = document.getElementById('ntsEmail')?.value?.trim();
      const emgName     = document.getElementById('ntsEmergencyName')?.value?.trim();
      const emgPhone    = document.getElementById('ntsEmergencyPhone')?.value?.trim();
      const address     = document.getElementById('ntsAddress')?.value?.trim();

      if (!full_name || !phone || !joining_date) {
        alert('Please fill in all required fields (Name, Phone, Joining Date).');
        return;
      }

      // Read or generate sequential ID and credentials
      const emp_id = (designation === 'Manager' ? document.getElementById('ntsPortalId')?.value : '') || previewNTSId();
      const prefix = designation === 'Manager' ? 'MGR' : 'STF';

      let username = document.getElementById('ntsUsername')?.value?.trim();
      if (!username) {
        const firstWord = (full_name || '').trim().split(/\s+/)[0] || '';
        username = firstWord.toLowerCase().replace(/[^a-z0-9]/g, '') || `${prefix.toLowerCase()}.user`;
      }

      let password = document.getElementById('ntsPassword')?.value?.trim();
      if (!password) {
        password = '12345678';
      }

      // Build notes JSON
      const notesObj = {
        employee_type: designation === 'Manager' ? 'manager' : 'other_staff',
        designation: designation,
        role_title: role_title || designation,
        emp_id,
        joining_date,
        salary,
        username,
        password,
        cnic: cnic || null,
        email: email || null,
        emergency_name: emgName || null,
        emergency_phone: emgPhone || null,
        address: address || null,
        extra_notes: notes_text || null,
        registered_at: new Date().toISOString()
      };

      const btn = document.getElementById('btnSaveNTS');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering...';

      try {
        const { data, error } = await db.from('teachers').insert([{
          full_name: (full_name || '').slice(0, 150),
          father_name: (emgName || '').slice(0, 150) || null,
          phone: (phone || '').slice(0, 50),
          alt_phone: (emgPhone || '').slice(0, 50) || null,
          address: JSON.stringify(notesObj),
          witness_name: (emp_id || (designation === 'Manager' ? 'MGR-001' : 'STF-001')).slice(0, 100),
          witness_phone: (cnic || '').slice(0, 50) || null,
          rate_per_slot: salary,
          working_shift: (designation === 'Manager' ? 'Manager' : (role_title || 'Other Staff')).slice(0, 100),
          status: 'Active'
        }]).select();

        if (error) throw error;

        const insertedId = (data && data[0]) ? data[0].id : ('local_' + Date.now());

        saveTeacherAccount(insertedId, {
          employee_type: designation === 'Manager' ? 'manager' : 'other_staff',
          teacher_id: emp_id,
          emp_id: emp_id,
          username: username,
          password: password,
          role_title: role_title || designation,
          designation: designation,
          cnic: cnic || '',
          email: email || '',
          emergency_name: emgName || '',
          emergency_phone: emgPhone || '',
          joining_date: joining_date,
          salary: salary,
          gender: gender
        });

        closeModal('modalAddNonTeachingStaff');
        await loadTeachers();

        if (designation === 'Manager') {
          // Open official Manager Provisioning Success Modal
          const portalUrl = `${window.location.origin}/manager.html?m=${emp_id}`;
          const badgeEl = document.getElementById('succMgrIdBadge');
          if (badgeEl) badgeEl.innerText = emp_id;
          const nameEl = document.getElementById('succMgrName');
          if (nameEl) nameEl.innerText = full_name;
          const roleEl = document.getElementById('succMgrRole');
          if (roleEl) roleEl.innerText = role_title || 'Operations Manager';
          const userEl = document.getElementById('succMgrUser');
          if (userEl) userEl.innerText = username;
          const passEl = document.getElementById('succMgrPass');
          if (passEl) passEl.innerText = password;
          const urlEl = document.getElementById('succMgrPortalUrl');
          if (urlEl) urlEl.value = portalUrl;
          const launchBtn = document.getElementById('succMgrLaunchBtn');
          if (launchBtn) launchBtn.href = portalUrl;

          // WhatsApp dispatch link
          const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
          const waMsg = `Assalamu Alaikum Respected ${full_name},\nWelcome to Al-Huda Islamic Centre Management Operations.\n\n🌐 *Your Dedicated Manager Portal Link:*\n${portalUrl}\n\n🆔 *Manager ID:* ${emp_id}\n👤 *Login Username:* ${username}\n🔑 *Login Password:* ${password}\n💼 *Role / Title:* ${role_title || 'Operations Manager'}\n\nPlease click your portal link to access all management tools, rosters, timetables, and system follow-ups.\nJazakum Allahu Khairan!`;
          const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;
          const waBtn = document.getElementById('succMgrWhatsAppBtn');
          if (waBtn) waBtn.href = waUrl;

          openModal('modalManagerRegisteredSuccess');
        } else {
          alert(`✅ Staff Registered Successfully!\n\n👤 Name: ${full_name}\n🆔 Staff ID: ${emp_id}\n📋 Role: ${role_title || 'Other Staff'}`);
        }
      } catch (err) {
        alert('Error registering employee: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Register Employee';
      }
    }

    function copyManagerCredentialsFromModal() {
      const id = document.getElementById('succMgrIdBadge')?.innerText || '';
      const name = document.getElementById('succMgrName')?.innerText || '';
      const user = document.getElementById('succMgrUser')?.innerText || '';
      const pass = document.getElementById('succMgrPass')?.innerText || '';
      const url = document.getElementById('succMgrPortalUrl')?.value || '';
      const text = `Al-Huda Islamic Centre — Manager Portal Access Details\n\n👤 Manager: ${name}\n🆔 Manager ID: ${id}\n🌐 Portal Link: ${url}\n👤 Username: ${user}\n🔑 Password: ${pass}\n\nPlease keep your credentials confidential.`;
      navigator.clipboard.writeText(text).then(() => {
        alert('✅ Manager Portal Link & Credentials copied to clipboard!\n\n' + text);
      }).catch(() => {
        alert(text);
      });
    }

    function prepareAddTeacherModal() {
      const editIdInput = document.getElementById('editTeacherId');
      if (editIdInput) editIdInput.value = '';

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

      const newId = getNextTeacherId();
      const badge = document.getElementById('tGeneratedIdBadge');
      if (badge) badge.innerText = newId;
      const valInput = document.getElementById('tGeneratedIdVal');
      if (valInput) valInput.value = newId;
      const portalId = document.getElementById('tPortalId');
      if (portalId) portalId.value = newId;

      generateRandomTeacherPass();
      openModal('modalAddTeacher');
    }

    function openEditTeacherModal(teacherId) {
      const teacher = ALL_TEACHERS.find(t => t.id === teacherId);
      if (!teacher) {
        alert("Teacher record not found.");
        return;
      }

      const creds = getTeacherCreds(teacher);
      const accounts = getTeacherAccounts();
      const acc = accounts[teacherId] || {};

      document.getElementById('editTeacherId').value = teacher.id;
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
      document.getElementById('tAddress').value = teacher.address || '';
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
      document.getElementById('tIncrementTier').value = acc.increment_tier || 'auto';

      document.getElementById('tUsername').value = creds.username || '';
      document.getElementById('tPassword').value = creds.password || '12345678';

      // Populate Zoom classroom fields
      const defaultMockZoom = `https://zoom.us/j/${teacher.phone ? teacher.phone.replace(/[^0-9]/g, '') : '9876543210'}?pwd=alhuda_${(teacher.full_name||'').toLowerCase().replace(/[^a-z]/g, '')}`;
      document.getElementById('tZoomLink').value = acc.zoom_link || defaultMockZoom;
      document.getElementById('tZoomMeetingId').value = acc.zoom_meeting_id || (teacher.phone ? teacher.phone.replace(/[^0-9]/g, '') : '');
      document.getElementById('tZoomPasscode').value = acc.zoom_passcode || '123456';
      document.getElementById('tZoomHostKey').value = acc.zoom_host_key || '';
      const autoSyncCheck = document.getElementById('tZoomAutoSync');
      if (autoSyncCheck) autoSyncCheck.checked = true;

      openModal('modalAddTeacher');
    }

    async function deleteTeacher(teacherId) {
      if (CURRENT_ROLE === 'manager') {
        alert("Access Denied: Managers are not authorized to permanently delete employee records. Only the System Owner can perform permanent deletions.");
        return;
      }
      const teacher = ALL_TEACHERS.find(t => t.id === teacherId);
      const tName = teacher ? teacher.full_name : 'this employee';
      let meta = {};
      try { meta = JSON.parse(teacher?.notes || '{}'); } catch(e){}
      const roleLabel = meta.employee_type === 'manager' ? 'Manager' : (meta.employee_type === 'other_staff' ? 'Staff Member' : 'Teacher');

      if (!confirm(`Are you sure you want to delete ${roleLabel} "${tName}"?\n\nThis will remove their profile and records.`)) {
        return;
      }

      try {
        await db.from('class_schedules').delete().eq('teacher_id', teacherId);
        await db.from('teachers').delete().eq('id', teacherId);

        const accounts = getTeacherAccounts();
        delete accounts[teacherId];
        localStorage.setItem('alhuda_teacher_accounts', JSON.stringify(accounts));

        await loadTeachers();
        alert(`${roleLabel} "${tName}" has been deleted successfully.`);
      } catch (err) {
        alert('Error deleting employee: ' + err.message);
      }
    }

    async function loadTeachers() {
      const container = document.getElementById('teachersGrid');
      if (!container) return;
      const { data: teachers } = await db.from('teachers').select('*').order('created_at', { ascending: false });
      ALL_TEACHERS = teachers || [];

      const { data: scheds } = await db.from('class_schedules').select('teacher_id, student_id');
      const countMap = {};
      (scheds || []).forEach(s => countMap[s.teacher_id] = (countMap[s.teacher_id] || 0) + 1);

      const accounts = getTeacherAccounts();

      // In student enrollment modal, only list actual teaching staff (exclude managers/non-teaching staff)
      const sTeacherSelect = document.getElementById('stuTeacherId');
      if (sTeacherSelect) {
        const teachingOnly = (teachers || []).filter(t => {
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

      container.innerHTML = teachers.map(t => {
        let meta = {};
        try {
          if (t.address && t.address.startsWith('{')) meta = JSON.parse(t.address);
          else if (t.witness_name && t.witness_name.startsWith('{')) meta = JSON.parse(t.witness_name);
          else if (t.notes && t.notes.startsWith('{')) meta = JSON.parse(t.notes);
        } catch(e){}
        const acc = accounts[t.id] || {};
        if (!meta.employee_type && acc.employee_type) meta = { ...meta, ...acc };
        if (!meta.emp_id && (String(t.witness_name || '').startsWith('MGR-') || String(t.witness_name || '').startsWith('STF-'))) {
          meta.emp_id = t.witness_name;
        }

        const isManager = meta.employee_type === 'manager' || t.working_shift === 'Manager' || String(t.id).startsWith('MGR-') || String(meta.emp_id || '').startsWith('MGR-') || String(acc.teacher_id || '').startsWith('MGR-') || String(t.witness_name || '').startsWith('MGR-');
        const isOtherStaff = meta.employee_type === 'other_staff' || (t.working_shift && t.working_shift.toLowerCase().includes('staff')) || String(t.id).startsWith('STF-') || String(meta.emp_id || '').startsWith('STF-') || String(acc.teacher_id || '').startsWith('STF-') || String(t.witness_name || '').startsWith('STF-');

        // ==========================================
        // CARD: MANAGER (NON-TEACHING)
        // ==========================================
        if (isManager) {
          const displayId = meta.emp_id || (String(t.witness_name || '').startsWith('MGR-') ? t.witness_name : null) || acc.teacher_id || (String(t.id).startsWith('MGR-') ? t.id : 'MGR-001');
          const cleanPhone = (t.phone || '').replace(/[^0-9]/g, '');
          const mgrUsername = meta.username || acc.username || `mgr.${t.full_name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 8)}`;
          const mgrPassword = meta.password || acc.password || '12345678';
          const directPortalUrl = `${window.location.origin}/manager.html?m=${displayId}`;
          const waMsg = `Assalamu Alaikum Respected ${t.full_name},\nWelcome to Al-Huda Islamic Centre Management Operations.\n\n🌐 *Your Dedicated Manager Portal Link:*\n${directPortalUrl}\n\n🆔 *Manager ID:* ${displayId}\n👤 *Login Username:* ${mgrUsername}\n🔑 *Login Password:* ${mgrPassword}\n💼 *Role / Title:* ${meta.role_title || 'Operations Manager'}\n\nPlease click your portal link to access all management tools, rosters, timetables, and system follow-ups.\nJazakum Allahu Khairan!`;
          const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;

          return `
            <div class="bg-white rounded-2xl border-2 border-indigo-200 shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between">
              <div>
                <div class="flex justify-between items-start mb-3 border-b pb-3">
                  <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-xl bg-indigo-100 border border-indigo-300 text-indigo-800 flex items-center justify-center font-black text-base">
                      ${t.full_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <h4 class="font-extrabold text-base text-slate-900 leading-tight">${t.full_name}</h4>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">${displayId}</span>
                      </div>
                      <p class="text-[11px] text-indigo-700 font-semibold">${meta.role_title || 'Operations Manager'}</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-1">
                    <span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-indigo-100 text-indigo-800 border border-indigo-200">
                       Manager
                    </span>
                    ${CURRENT_ROLE !== 'manager' ? `
                      <button onclick="deleteTeacher('${t.id}')" title="Delete Manager" class="text-slate-300 hover:text-rose-600 transition p-1 text-xs">
                        <i class="fa-regular fa-trash-can"></i>
                      </button>
                    ` : ''}
                  </div>
                </div>

                <!-- MANAGER DETAILS -->
                <div class="grid grid-cols-2 gap-2 text-xs mb-3 bg-indigo-50/40 p-2.5 rounded-xl border border-indigo-100">
                  <div>
                    <span class="text-slate-400 text-[10px] block">Monthly Salary:</span>
                    <strong class="text-indigo-900 font-bold text-xs">${meta.salary ? meta.salary + ' PKR' : (t.rate_per_slot ? t.rate_per_slot + ' PKR' : 'As Agreed')}</strong>
                  </div>
                  <div>
                    <span class="text-slate-400 text-[10px] block">Joining Date:</span>
                    <strong class="text-slate-800 font-mono text-[11px]">${meta.joining_date || t.joining_date || (t.created_at ? t.created_at.slice(0,10) : '--')}</strong>
                  </div>
                  <div>
                    <span class="text-slate-400 text-[10px] block">Phone / WhatsApp:</span>
                    <strong class="text-slate-800 font-mono">${t.phone}</strong>
                  </div>
                  <div>
                    <span class="text-slate-400 text-[10px] block">CNIC / ID:</span>
                    <strong class="text-slate-700 font-mono text-[11px]">${meta.cnic || '--'}</strong>
                  </div>
                  ${meta.email ? `
                    <div class="col-span-2">
                      <span class="text-slate-400 text-[10px] block">Email Address:</span>
                      <strong class="text-slate-700 font-mono text-[11px]">${meta.email}</strong>
                    </div>
                  ` : ''}
                  ${meta.emergency_name ? `
                    <div class="col-span-2">
                      <span class="text-slate-400 text-[10px] block">Emergency Contact:</span>
                      <span class="text-slate-700 font-medium">${meta.emergency_name} (${meta.emergency_phone || '--'})</span>
                    </div>
                  ` : ''}
                  ${meta.address ? `
                    <div class="col-span-2">
                      <span class="text-slate-400 text-[10px] block">Residential Address:</span>
                      <span class="text-slate-600 text-[11px]">${meta.address}</span>
                    </div>
                  ` : ''}
                </div>

                <!-- PORTAL CREDENTIALS BOX -->
                <div class="bg-gradient-to-r from-indigo-50 to-blue-50 p-2.5 rounded-xl border border-indigo-200 mb-3 space-y-1.5">
                  <div class="flex justify-between items-center text-[10px] font-bold text-indigo-900 uppercase tracking-wide">
                    <span class="flex items-center gap-1"><i class="fa-solid fa-key text-indigo-600"></i> LMS Login Credentials</span>
                    <button onclick="copyManagerCredentials('${t.id}', '${mgrUsername}', '${mgrPassword}', '${t.full_name}', '${directPortalUrl}')" class="text-indigo-700 hover:text-indigo-900 font-bold" title="Copy Login Details">
                      <i class="fa-regular fa-copy"></i> Copy
                    </button>
                  </div>
                  <div class="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div class="bg-white px-2 py-1 rounded border border-indigo-100 truncate">
                      <span class="text-[9px] text-slate-400 block">Username:</span>
                      <strong class="text-indigo-950">${mgrUsername}</strong>
                    </div>
                    <div class="bg-white px-2 py-1 rounded border border-indigo-100 truncate">
                      <span class="text-[9px] text-slate-400 block">Password:</span>
                      <strong class="text-indigo-950">${mgrPassword}</strong>
                    </div>
                  </div>
                  <a href="${waUrl}" target="_blank" class="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] flex items-center justify-center gap-1.5 shadow-xs transition mt-1">
                    <i class="fa-brands fa-whatsapp"></i> Send Login Credentials to Manager WhatsApp
                  </a>
                </div>

                <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-500 flex items-center gap-1.5">
                  <i class="fa-solid fa-shield-halved text-indigo-500"></i>
                  <span>Security &amp; Manager permissions portal integration enabled.</span>
                </div>
              </div>

              <div class="pt-3 border-t mt-3 flex items-center justify-between gap-2 flex-wrap">
                <a href="${directPortalUrl}" target="_blank" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs shadow-xs transition flex items-center gap-1.5">
                  <i class="fa-solid fa-arrow-up-right-from-square"></i> Open Manager Portal
                </a>
                ${CURRENT_ROLE !== 'manager' ? `
                  <button onclick="deleteTeacher('${t.id}')" class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-bold text-xs transition flex items-center gap-1">
                    <i class="fa-regular fa-trash-can"></i> Remove
                  </button>
                ` : ''}
              </div>
            </div>
          `;
        }

        // ==========================================
        // CARD: OTHER STAFF (NON-TEACHING)
        // ==========================================
        if (isOtherStaff) {
          const displayId = meta.emp_id || (String(t.witness_name || '').startsWith('STF-') ? t.witness_name : null) || acc.teacher_id || (String(t.id).startsWith('STF-') ? t.id : 'STF-001');
          return `
            <div class="bg-white rounded-2xl border-2 border-slate-200 shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between">
              <div>
                <div class="flex justify-between items-start mb-3 border-b pb-3">
                  <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-xl bg-slate-100 border border-slate-300 text-slate-700 flex items-center justify-center font-black text-base">
                      ${t.full_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <h4 class="font-extrabold text-base text-slate-900 leading-tight">${t.full_name}</h4>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">${displayId}</span>
                      </div>
                      <p class="text-[11px] text-slate-500 font-semibold">${meta.role_title || 'Non-Teaching Staff'}</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-1">
                    <span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-slate-100 text-slate-700 border border-slate-200">
                      🪪 Other Staff
                    </span>
                    ${CURRENT_ROLE !== 'manager' ? `
                      <button onclick="deleteTeacher('${t.id}')" title="Delete Staff" class="text-slate-300 hover:text-rose-600 transition p-1 text-xs">
                        <i class="fa-regular fa-trash-can"></i>
                      </button>
                    ` : ''}
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-xs mb-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <div>
                    <span class="text-slate-400 text-[10px] block">Role / Designation:</span>
                    <strong class="text-slate-800 font-bold text-xs">${meta.role_title || 'Support Staff'}</strong>
                  </div>
                  <div>
                    <span class="text-slate-400 text-[10px] block">Monthly Salary:</span>
                    <strong class="text-emerald-700 font-bold text-xs">${meta.salary ? meta.salary + ' PKR' : (t.rate_per_slot ? t.rate_per_slot + ' PKR' : 'As Agreed')}</strong>
                  </div>
                  <div>
                    <span class="text-slate-400 text-[10px] block">Phone / WhatsApp:</span>
                    <strong class="text-slate-800 font-mono">${t.phone}</strong>
                  </div>
                  <div>
                    <span class="text-slate-400 text-[10px] block">Joining Date:</span>
                    <strong class="text-slate-800 font-mono text-[11px]">${meta.joining_date || t.joining_date || (t.created_at ? t.created_at.slice(0,10) : '--')}</strong>
                  </div>
                  ${meta.extra_notes ? `
                    <div class="col-span-2">
                      <span class="text-slate-400 text-[10px] block">Notes:</span>
                      <span class="text-slate-600 text-[11px]">${meta.extra_notes}</span>
                    </div>
                  ` : ''}
                </div>
              </div>

              <div class="pt-3 border-t mt-3 flex items-center justify-between">
                <span class="text-[11px] font-mono text-slate-400">Non-Teaching Staff</span>
                ${CURRENT_ROLE !== 'manager' ? `
                  <button onclick="deleteTeacher('${t.id}')" class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-bold text-xs transition flex items-center gap-1">
                    <i class="fa-regular fa-trash-can"></i> Remove
                  </button>
                ` : ''}
              </div>
            </div>
          `;
        }

        // ==========================================
        // CARD: TEACHING STAFF (DEFAULT)
        // ==========================================
        const bookedCount = countMap[t.id] || 0;
        const creds = getTeacherCreds(t);
        const cleanPhone = (t.phone || '').replace(/[^0-9]/g, '');
        const directPortalUrl = `${window.location.origin}/teacher.html?t=${creds.username}`;
        const waMsg = `Assalamu Alaikum Respected ${t.full_name},\nWelcome to the Al-Huda Islamic Centre Teacher Operations Portal.\n\n🌐 *Your Personal Portal Link:*\n${directPortalUrl}\n\n👤 *Username:* ${creds.username}\n🔑 *Password:* ${creds.password || '12345678'}\n🕒 *Assigned Shift:* ${t.working_shift || '10 Hours Shift'}\n💰 *Slot Rate:* ${t.rate_per_slot || 2200} PKR\n\nPlease tap the link above to view your timetable, student schedules, and attendance logs.\nJazakum Allahu Khairan!`;
        const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;

        // Seniority increment text
        const joiningDate = acc.joining_date || (t.created_at ? t.created_at.slice(0, 10) : '2025-01-01');
        let incrementText = '+0 PKR (Base)';
        if (acc.increment_tier && acc.increment_tier !== 'auto') {
          incrementText = `+${acc.increment_tier} PKR/stu`;
        } else {
          const yrs = Math.floor((new Date() - new Date(joiningDate)) / (365.25 * 24 * 3600 * 1000));
          if (yrs >= 1) incrementText = `+${yrs * 200} PKR/stu (Yr ${yrs})`;
        }

        // Trial performance metrics for this teacher
        const teacherTrials = (ALL_TRIALS || []).filter(tr => tr.teacher_id === t.id);
        const totalTr = teacherTrials.length;
        const convTr = teacherTrials.filter(tr => tr.status === 'Converted').length;
        const discTr = teacherTrials.filter(tr => tr.status === 'Discontinued').length;
        const activeTr = teacherTrials.filter(tr => tr.status !== 'Converted' && tr.status !== 'Discontinued').length;
        const convRate = (convTr + discTr) > 0 ? Math.round((convTr / (convTr + discTr)) * 100) : (totalTr > 0 ? 0 : null);

        return `
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between">
            <div>
              <div class="flex justify-between items-start mb-3 border-b pb-3">
                <div class="flex items-center gap-3">
                  <div class="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-brandDark flex items-center justify-center font-black text-base">
                    ${t.full_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div class="flex items-center gap-1.5">
                      <h4 class="font-extrabold text-base text-slate-900 leading-tight">${t.full_name}</h4>
                      <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-100 text-brandDark border border-slate-200">${creds.teacher_id}</span>
                    </div>
                    <p class="text-[11px] text-slate-500">${t.father_name ? 'S/O ' + t.father_name : 'Quran Instructor'}</p>
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  <span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${t.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                    ${t.status}
                  </span>
                  ${CURRENT_ROLE !== 'manager' ? `
                    <button onclick="deleteTeacher('${t.id}')" title="Delete Teacher" class="text-slate-300 hover:text-rose-600 transition p-1 text-xs">
                      <i class="fa-regular fa-trash-can"></i>
                    </button>
                  ` : ''}
                </div>
              </div>

              <!-- RATE, SHIFT, SENIORITY & SLOTS -->
              <div class="grid grid-cols-2 gap-2 text-xs mb-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div>
                  <span class="text-slate-400 text-[10px] block">Base Course Rate:</span>
                  <strong class="text-brandDark font-bold text-xs">${t.rate_per_slot || 2200} PKR / stu</strong>
                </div>
                <div>
                  <span class="text-slate-400 text-[10px] block">Seniority Increment:</span>
                  <span class="text-amber-800 font-extrabold text-[11px] bg-amber-100 px-1.5 py-0.5 rounded inline-block">${incrementText}</span>
                </div>
                <div>
                  <span class="text-slate-400 text-[10px] block">WhatsApp Contact:</span>
                  <strong class="text-slate-800 font-mono">${t.phone}</strong>
                </div>
                <div>
                  <span class="text-slate-400 text-[10px] block">Booked Weekly Slots:</span>
                  <strong class="text-emerald-700 font-bold">${bookedCount} Slots</strong>
                </div>
              </div>

              <!-- TRIAL EVALUATION PERFORMANCE BADGE -->
              <div class="mb-3 p-2.5 bg-gradient-to-r from-purple-50/80 to-indigo-50/60 border border-purple-200 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <span class="text-[10px] font-black uppercase tracking-wider text-purple-900 flex items-center gap-1">
                    <i class="fa-solid fa-chart-line text-purple-600"></i> Trial Conversion Track
                  </span>
                  <div class="font-extrabold text-slate-800 text-[11px] mt-0.5">
                    ${totalTr} Assigned • <strong class="text-emerald-700">${convTr} Regular</strong> • <strong class="text-rose-600">${discTr} Dead</strong>
                  </div>
                </div>
                <div class="text-right">
                  ${convRate !== null ? `
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${convRate >= 70 ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : convRate >= 50 ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-rose-100 text-rose-800 border border-rose-300'}">
                      🎯 ${convRate}% Rate
                    </span>
                  ` : `
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                      ${totalTr} Trials
                    </span>
                  `}
                  <button onclick="viewTeacherTrialsHistory('${t.id}')" class="block text-[10px] text-purple-700 font-extrabold hover:underline mt-0.5 text-right w-full">
                    View Trials &rarr;
                  </button>
                </div>
              </div>

              <!-- TEACHER PORTAL LOGIN CREDENTIALS BOX -->
              <div class="bg-gradient-to-r from-emerald-50/80 to-amber-50/50 p-2.5 rounded-xl border border-brandEmerald/30 mb-3 space-y-1.5">
                <div class="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                  <span class="text-brandDark flex items-center gap-1"><i class="fa-solid fa-key text-brandGold"></i> LMS Login Credentials</span>
                  <button onclick="copyTeacherCredentials('${creds.username}', '${creds.password}', '${t.full_name}')" class="text-brandEmerald hover:text-brandDark font-bold" title="Copy Login Details">
                    <i class="fa-regular fa-copy"></i> Copy
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div class="bg-white px-2 py-1 rounded border border-slate-200 truncate">
                    <span class="text-[9px] text-slate-400 block">Username:</span>
                    <strong class="text-slate-800">${creds.username}</strong>
                  </div>
                  <div class="bg-white px-2 py-1 rounded border border-slate-200 truncate">
                    <span class="text-[9px] text-slate-400 block">Password:</span>
                    <strong class="text-brandDark">${creds.password}</strong>
                  </div>
                </div>
                <a href="${waUrl}" target="_blank" class="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] flex items-center justify-center gap-1.5 shadow-xs transition mt-1">
                  <i class="fa-brands fa-whatsapp"></i> Send Login Credentials to Teacher WhatsApp
                </a>
              </div>

              <!-- DEDICATED ZOOM CLASSROOM STATUS & SYNC -->
              <div class="bg-gradient-to-r from-blue-50/90 to-indigo-50/70 p-2.5 rounded-xl border border-blue-200 mb-3 space-y-1.5 text-xs">
                <div class="flex justify-between items-center text-[10px] font-bold text-blue-900 uppercase tracking-wide">
                  <span class="flex items-center gap-1"><i class="fa-solid fa-video text-blue-600"></i> Dedicated Zoom Classroom</span>
                  <span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold ${acc.zoom_link ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}">
                    ${acc.zoom_link ? 'CONFIGURED' : 'DEMO ROOM'}
                  </span>
                </div>
                <div class="bg-white p-1.5 rounded border border-blue-100 flex items-center justify-between gap-1 text-[11px] font-mono">
                  <span class="truncate text-blue-950 font-bold max-w-[200px]" title="${acc.zoom_link || `https://zoom.us/j/${t.phone ? t.phone.replace(/[^0-9]/g, '') : '9876543210'}?pwd=alhuda_${(t.full_name||'').toLowerCase().replace(/[^a-z]/g, '')}`}">
                    ${acc.zoom_link || `https://zoom.us/j/${t.phone ? t.phone.replace(/[^0-9]/g, '') : '9876543210'}?pwd=alhuda_${(t.full_name||'').toLowerCase().replace(/[^a-z]/g, '')}`}
                  </span>
                  <button onclick="navigator.clipboard.writeText('${acc.zoom_link || `https://zoom.us/j/${t.phone ? t.phone.replace(/[^0-9]/g, '') : '9876543210'}?pwd=alhuda_${(t.full_name||'').toLowerCase().replace(/[^a-z]/g, '')}`}'); alert('Zoom link copied to clipboard!');" class="text-blue-600 hover:text-blue-800 font-bold text-[10px]" title="Copy Zoom Link">
                    <i class="fa-regular fa-copy"></i>
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button onclick="openQuickZoomModal('${t.id}')" class="py-1.5 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[10px] flex items-center justify-center gap-1 shadow-2xs transition">
                    <i class="fa-solid fa-pen"></i> Edit Zoom
                  </button>
                  <button onclick="triggerTeacherZoomSync('${t.id}')" class="py-1.5 px-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1 shadow-2xs transition" title="Cascade & Sync Link to All Students">
                    <i class="fa-solid fa-bolt text-amber-500"></i> Sync Students
                  </button>
                </div>
              </div>

              ${t.witness_name ? `
                <div class="text-[11px] text-slate-500 mb-3">
                  <i class="fa-solid fa-shield-halved text-brandEmerald"></i> <strong>Witness:</strong> ${t.witness_name} (${t.witness_phone || '--'})
                </div>
              ` : ''}
            </div>

            <div class="pt-2 border-t flex flex-col gap-2">
              <button onclick="openEditTeacherModal('${t.id}')" class="w-full py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 font-extrabold text-xs rounded-xl border border-amber-300 transition flex items-center justify-center gap-1.5 shadow-xs">
                <i class="fa-solid fa-pen-to-square text-amber-600"></i> Edit Teacher Profile & Credentials
              </button>
              <button onclick="open2DMatrixForTeacher('${t.id}')" class="w-full py-2.5 bg-gradient-to-r from-brandDark to-brandEmerald text-white font-extrabold text-xs rounded-xl hover:shadow-lg transition flex items-center justify-center gap-2 shadow-xs">
                <i class="fa-solid fa-table-cells"></i> Open 2D Full-Week Timetable
              </button>
              <a href="teacher.html?t=${creds.username}" target="_blank" class="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg transition flex items-center justify-center gap-1.5">
                <i class="fa-solid fa-arrow-up-right-from-square text-emerald-600"></i> Open Dedicated Teacher Portal
              </a>
            </div>
          </div>
        `;
      }).join('');
    }

    function copyTeacherCredentials(user, pass, teacherName) {
      const url = `${window.location.origin}/teacher.html?t=${user}`;
      const txt = `Al-Huda Islamic Centre LMS - Teacher Portal\nTeacher: ${teacherName}\nDirect Link: ${url}\nUsername: ${user}\nPassword: ${pass}`;
      navigator.clipboard.writeText(txt);
      alert(`Copied to clipboard!\n\n${txt}`);
    }

    function copyManagerCredentials(id, user, pass, managerName, portalUrl) {
      const url = portalUrl || `${window.location.origin}/manager.html?m=${id}`;
      const txt = `Al-Huda Islamic Centre LMS — Manager Portal\nManager: ${managerName}\nManager ID: ${id}\nDirect Link: ${url}\nUsername: ${user}\nPassword: ${pass}`;
      navigator.clipboard.writeText(txt);
      alert(`Copied to clipboard!\n\n${txt}`);
    }

    async function handleSaveTeacher(e) {
      e.preventDefault();

      const editTeacherId = (document.getElementById('editTeacherId')?.value || '').trim();

      const full_name = (document.getElementById('tFullName').value || '').trim();
      const phone = (document.getElementById('tPhone').value || '').trim();
      const username = (document.getElementById('tUsername').value || '').trim();
      const password = (document.getElementById('tPassword').value || '').trim();
      const working_shift_val = document.getElementById('tShift').value;

      // Mandatory Validations
      if (!full_name) {
        alert("Please enter the Teacher's Full Name.");
        document.getElementById('tFullName').focus();
        return;
      }

      if (!phone) {
        alert("Please enter Teacher's Primary WhatsApp Number.");
        document.getElementById('tPhone').focus();
        return;
      }

      if (!username) {
        alert("Please enter Teacher Portal Username.");
        document.getElementById('tUsername').focus();
        return;
      }

      if (!password) {
        alert("Please enter Teacher Portal Password.");
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

      const zoom_link = (document.getElementById('tZoomLink')?.value || '').trim();
      const zoom_meeting_id = (document.getElementById('tZoomMeetingId')?.value || '').trim();
      const zoom_passcode = (document.getElementById('tZoomPasscode')?.value || '').trim();
      const zoom_host_key = (document.getElementById('tZoomHostKey')?.value || '').trim();
      const auto_sync_zoom = document.getElementById('tZoomAutoSync')?.checked;

      if (editTeacherId) {
        // UPDATE MODE
        const { error } = await db.from('teachers').update({
          full_name, father_name, phone, alt_phone, address, witness_name, witness_phone, rate_per_slot, working_shift
        }).eq('id', editTeacherId);

        if (error) {
          console.warn("Supabase update error:", error);
        }

        saveTeacherAccount(editTeacherId, {
          teacher_id: teacher_id_code,
          username,
          password,
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
          zoom_host_key
        });

        if (auto_sync_zoom && zoom_link) {
          await syncTeacherZoomToAllStudents(editTeacherId, zoom_link);
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> <span id="btnSaveTeacherText">Update Teacher Profile</span>';
        closeModal('modalAddTeacher');
        await loadTeachers();

        alert(`✅ Teacher Profile Updated Successfully!\n\n👨‍🏫 Teacher: ${full_name}\n🆔 Teacher ID: ${teacher_id_code}\n👤 Portal Username: ${username}\n🔑 Portal Password: ${password}\n🕒 Shift: ${working_shift}\n📹 Zoom: ${zoom_link || 'Default Room'}`);
      } else {
        // INSERT MODE
        const { data, error } = await db.from('teachers').insert([{
          full_name, father_name, phone, alt_phone, address, witness_name, witness_phone, rate_per_slot, working_shift, status: 'Active'
        }]).select();

        const insertedId = (data && data[0]) ? data[0].id : ('local_' + Date.now());

        saveTeacherAccount(insertedId, {
          teacher_id: teacher_id_code,
          username,
          password,
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
          zoom_host_key
        });

        if (auto_sync_zoom && zoom_link) {
          await syncTeacherZoomToAllStudents(insertedId, zoom_link);
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> <span id="btnSaveTeacherText">Save Teacher & Generate LMS Account</span>';
        closeModal('modalAddTeacher');
        await loadTeachers();

        alert(`✅ Teacher Registered Successfully!\n\n👨‍🏫 Teacher: ${full_name}\n🆔 Teacher ID: ${teacher_id_code}\n👤 Portal Username: ${username}\n🔑 Portal Password: ${password}\n🕒 Shift: ${working_shift}\n🎓 Qualification: ${qualification || 'As Assigned'}\n\nTeacher can now log into Al-Huda Teacher Portal.`);
      }
    }

