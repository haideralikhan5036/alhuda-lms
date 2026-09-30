/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/families.js
 * Purpose: Family & Student Directory, Country/Currency Config, Parent Credentials & Master Tables
 * Extracted Line Range: 7850 – 8593 (744 lines)
 * ============================================================================
 */

    // DYNAMIC COUNTRIES & PERSISTENCE
    const DEFAULT_COUNTRIES = [
      "United States", "United Kingdom", "Canada", "Australia", 
      "Saudi Arabia", "United Arab Emirates", "Qatar", "Germany", 
      "France", "Italy", "Norway", "Sweden", "Pakistan", "Oman", 
      "Kuwait", "Bahrain", "New Zealand", "Ireland"
    ];

    function getSavedCountries() {
      const custom = JSON.parse(localStorage.getItem('alhuda_custom_countries') || '[]');
      return Array.from(new Set([...DEFAULT_COUNTRIES, ...custom]));
    }

    function populateCountryDropdown(selectedCountry = 'United States') {
      const select = document.getElementById('famCountrySelect');
      if (!select) return;
      const list = getSavedCountries();
      let html = list.map(c => `<option value="${c}" ${c === selectedCountry ? 'selected' : ''}>${c}</option>`).join('');
      html += `<option value="__NEW_COUNTRY__" class="font-bold text-emerald-700">+ Add New Country...</option>`;
      select.innerHTML = html;
    }

    function handleCountrySelectionChange(val) {
      const box = document.getElementById('customCountryBox');
      if (val === '__NEW_COUNTRY__') {
        box.classList.remove('hidden');
        document.getElementById('famCustomCountryInput').focus();
      } else {
        box.classList.add('hidden');
      }
    }

    function saveNewCustomCountry() {
      const input = document.getElementById('famCustomCountryInput');
      const name = (input.value || '').trim();
      if (!name) return;
      const custom = JSON.parse(localStorage.getItem('alhuda_custom_countries') || '[]');
      if (!custom.includes(name)) {
        custom.push(name);
        localStorage.setItem('alhuda_custom_countries', JSON.stringify(custom));
      }
      input.value = '';
      document.getElementById('customCountryBox').classList.add('hidden');
      populateCountryDropdown(name);
    }

    // DYNAMIC CURRENCIES & PERSISTENCE
    const DEFAULT_CURRENCIES = [
      "USD ($)", "GBP (£)", "CAD ($)", "AUD ($)", 
      "EUR (€)", "AED (AED)", "SAR (SAR)", "QAR (QAR)", "PKR (Rs)"
    ];

    function getSavedCurrencies() {
      const custom = JSON.parse(localStorage.getItem('alhuda_custom_currencies') || '[]');
      return Array.from(new Set([...DEFAULT_CURRENCIES, ...custom]));
    }

    function populateCurrencyDropdown(selectedCurr = 'USD ($)') {
      const select = document.getElementById('famCurrencySelect');
      if (!select) return;
      const list = getSavedCurrencies();
      let html = list.map(c => `<option value="${c}" ${c === selectedCurr ? 'selected' : ''}>${c}</option>`).join('');
      html += `<option value="__NEW_CURR__" class="font-bold text-emerald-700">+ Add New Currency...</option>`;
      select.innerHTML = html;
    }

    function handleCurrencySelectionChange(val) {
      const box = document.getElementById('customCurrencyBox');
      if (val === '__NEW_CURR__') {
        box.classList.remove('hidden');
        document.getElementById('famCustomCurrencyInput').focus();
      } else {
        box.classList.add('hidden');
      }
    }

    function saveNewCustomCurrency() {
      const input = document.getElementById('famCustomCurrencyInput');
      const code = (input.value || '').trim().toUpperCase();
      if (!code) return;
      const formatted = `${code} (${code})`;
      const custom = JSON.parse(localStorage.getItem('alhuda_custom_currencies') || '[]');
      if (!custom.includes(formatted)) {
        custom.push(formatted);
        localStorage.setItem('alhuda_custom_currencies', JSON.stringify(custom));
      }
      input.value = '';
      document.getElementById('customCurrencyBox').classList.add('hidden');
      populateCurrencyDropdown(formatted);
    }

    // PARENT PORTAL ACCOUNTS & CREDENTIALS
    function getParentAccounts() {
      const stored = localStorage.getItem('alhuda_parent_accounts');
      return JSON.parse(stored || '{}');
    }

    function saveParentAccount(famId, creds) {
      const accounts = getParentAccounts();
      accounts[famId] = { ...(accounts[famId] || {}), ...creds };
      localStorage.setItem('alhuda_parent_accounts', JSON.stringify(accounts));
      if (typeof syncGlobalSharedStateToCloud === 'function') {
        syncGlobalSharedStateToCloud();
      }
    }

    function getParentCreds(family) {
      if (!family) return { username: 'parent_user', password: 'alhuda_786' };
      const accounts = getParentAccounts();
      if (accounts[family.id] && accounts[family.id].username) return accounts[family.id];
      if (family.notes) {
        try {
          const nObj = typeof family.notes === 'object' ? family.notes : JSON.parse(family.notes);
          if (nObj && nObj.portal_credentials && nObj.portal_credentials.username) {
            accounts[family.id] = nObj.portal_credentials;
            localStorage.setItem('alhuda_parent_accounts', JSON.stringify(accounts));
            return nObj.portal_credentials;
          }
        } catch (e) {}
      }
      const baseUser = (family.parent_name || 'parent').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 15) || 'parent';
      const stableDigits = String(family.whatsapp || family.id || '786').replace(/[^0-9]/g, '').slice(-3).padStart(3, '7');
      const defaultCred = {
        username: 'parent_' + baseUser,
        password: 'alhuda_' + stableDigits,
        parent_name: family.parent_name,
        whatsapp: family.whatsapp
      };
      saveParentAccount(family.id, defaultCred);
      return defaultCred;
    }

    function autoSuggestParentUsername(fullName) {
      const clean = (fullName || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const uInput = document.getElementById('famUsername');
      if (uInput) {
        uInput.value = clean ? 'parent_' + clean : 'parent_user';
      }
    }

    function generateRandomParentPass() {
      const rand = Math.floor(100 + Math.random() * 900);
      const pInput = document.getElementById('famPassword');
      if (pInput) pInput.value = 'alhuda_' + rand;
    }

    function getNextFamilyId() {
      const existingNums = [];
      (ALL_FAMILIES || []).forEach(f => {
        if (f.id) {
          const m = String(f.id).match(/FAM-(\d+)/i);
          if (m) existingNums.push(parseInt(m[1], 10));
        }
      });
      let nextNum = 1;
      if (existingNums.length > 0) {
        nextNum = Math.max(...existingNums) + 1;
      }
      return `FAM-${String(nextNum).padStart(3, '0')}`;
    }

    function getNextStudentId() {
      const existingNums = [];
      (ALL_STUDENTS || []).forEach(s => {
        if (s.id) {
          const m = String(s.id).match(/STU-(\d+)/i);
          if (m) {
            const val = parseInt(m[1], 10);
            if (val < 900) existingNums.push(val);
          }
        }
      });
      let nextNum = 1;
      if (existingNums.length > 0) {
        nextNum = Math.max(...existingNums) + 1;
      } else if (ALL_STUDENTS && ALL_STUDENTS.length > 0) {
        nextNum = ALL_STUDENTS.length + 1;
      }
      return `STU-${String(nextNum).padStart(3, '0')}`;
    }

    function prepareAddFamilyModal() {
      document.getElementById('famParentName').value = '';
      document.getElementById('famWhatsApp').value = '';
      document.getElementById('famEmail').value = '';
      document.getElementById('famCity').value = '';
      document.getElementById('famMonthlyFee').value = '100';
      document.getElementById('famUsername').value = '';

      const nextId = getNextFamilyId();
      const badge = document.getElementById('famGeneratedIdBadge');
      if (badge) badge.innerText = nextId;
      const valInput = document.getElementById('famGeneratedIdVal');
      if (valInput) valInput.value = nextId;

      populateCountryDropdown('United States');
      populateCurrencyDropdown('USD ($)');
      generateRandomParentPass();

      openModal('modalAddFamily');
    }

    function prepareAddStudentModal(preselectedFamilyId = null) {
      document.getElementById('stuName').value = '';
      document.getElementById('stuAge').value = '8';

      const nextId = getNextStudentId();
      const badge = document.getElementById('stuGeneratedIdBadge');
      if (badge) badge.innerText = nextId;
      const valInput = document.getElementById('stuGeneratedIdVal');
      if (valInput) valInput.value = nextId;

      const famSelect = document.getElementById('stuFamilyId');
      if (famSelect) {
        const activeFamsOnly = (ALL_FAMILIES || []).filter(f => typeof isFamilyDeactivated === 'function' ? !isFamilyDeactivated(f) : !['inactive', 'deactivated'].includes(String(f.status || '').toLowerCase()));
        famSelect.innerHTML = activeFamsOnly.map(f => `
          <option value="${f.id}" ${f.id === preselectedFamilyId ? 'selected' : ''}>
            ${f.parent_name} (${f.id} &bull; ${f.country})
          </option>
        `).join('');
      }

      const today = new Date().toISOString().split('T')[0];
      const jDateInput = document.getElementById('stuJoiningDate');
      if (jDateInput) jDateInput.value = today;

      const teacherSelect = document.getElementById('stuTeacherId');
      if (teacherSelect) {
        const eligibleTeachers = typeof getEligibleTeachers === 'function'
          ? getEligibleTeachers(ALL_TEACHERS)
          : (ALL_TEACHERS || []);
        teacherSelect.innerHTML = eligibleTeachers.map(t => {
          const creds = getTeacherCreds(t);
          return `<option value="${t.id}">${t.full_name} (${creds.teacher_id} &bull; ${t.working_shift || '10 Hours'})</option>`;
        }).join('');
      }

      openModal('modalAddStudent');
    }

    async function handleSaveFamily(e) {
      e.preventDefault();
      const btn = document.getElementById('btnSaveFamily');
      btn.disabled = true;
      btn.innerText = 'Saving Family Account...';

      const parent_name = (document.getElementById('famParentName').value || '').trim();
      const whatsapp = (document.getElementById('famWhatsApp').value || '').trim();
      const email = (document.getElementById('famEmail').value || '').trim();
      const city = (document.getElementById('famCity').value || '').trim();
      const countrySelectVal = document.getElementById('famCountrySelect').value;
      const country = (countrySelectVal === '__NEW_COUNTRY__') 
        ? ((document.getElementById('famCustomCountryInput').value || '').trim() || 'United States') 
        : countrySelectVal;

      const monthly_fee = parseFloat(document.getElementById('famMonthlyFee').value) || 0;
      const currencySelectVal = document.getElementById('famCurrencySelect').value;
      const currency = (currencySelectVal === '__NEW_CURR__') 
        ? ((document.getElementById('famCustomCurrencyInput').value || '').trim().toUpperCase() || 'USD') 
        : currencySelectVal.split(' ')[0];

      const id = document.getElementById('famGeneratedIdVal').value || getNextFamilyId();
      const username = (document.getElementById('famUsername').value || '').trim();
      const password = (document.getElementById('famPassword').value || '').trim();

      if (!parent_name) {
        lmsNotify("Please enter Parent / Guardian Name.", { type: 'warning' });
        btn.disabled = false;
        btn.innerText = 'Save Family & Generate LMS Account';
        return;
      }
      if (!whatsapp) {
        lmsNotify("Please enter WhatsApp Contact Number.", { type: 'warning' });
        btn.disabled = false;
        btn.innerText = 'Save Family & Generate LMS Account';
        return;
      }
      if (!username || !password) {
        lmsNotify("Parent Portal Username and Password are required.", { type: 'warning' });
        btn.disabled = false;
        btn.innerText = 'Save Family & Generate LMS Account';
        return;
      }

      const notes = city ? `City: ${city}` : '';

      await db.from('families').insert([{
        id, parent_name, whatsapp, country, monthly_fee, currency, notes, parent_email: email, status: 'Active'
      }]);

      saveParentAccount(id, {
        username,
        password,
        parent_name,
        whatsapp,
        city,
        country,
        monthly_fee,
        currency
      });

      btn.disabled = false;
      btn.innerText = 'Save Family & Generate LMS Account';
      closeModal('modalAddFamily');
      if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
      await loadFamiliesAndStudents(true);
      loadFeeBillingLedger();

      // TASK 6: Automatically send welcome email if parent email exists
      let familyEmailNotice = '';
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && typeof autoSendWelcomeEmailOnCreation === 'function') {
        const emailResult = await autoSendWelcomeEmailOnCreation({
          type: 'regular',
          studentName: parent_name,
          parentName: parent_name,
          toEmail: email,
          phone: whatsapp,
          course: 'Not Assigned Yet',
          teacherName: 'Not Assigned Yet',
          scheduleText: 'No classes scheduled.',
          zoomLink: '',
          credentials: { username, password }
        });
        if (emailResult && emailResult.sent === false) {
          familyEmailNotice = '\n\n⚠️ Student created, but welcome email failed to send.';
          if (typeof lmsNotify === 'function') {
            lmsNotify('Student created, but welcome email failed to send.', { type: 'warning' });
          }
        } else if (emailResult && emailResult.sent) {
          familyEmailNotice = `\n\n📧 Welcome email automatically sent to ${email}.`;
        }
      }

      lmsNotify(`✅ Family Registered Successfully!\n\n👨‍👩‍👧 Family ID: ${id}\n👤 Parent Name: ${parent_name}\n🌍 Location: ${city ? city + ', ' : ''}${country}\n💰 Agreed Fee: ${currency} ${monthly_fee}\n\n🔑 Parent Portal Login Credentials:\nUsername: ${username}\nPassword: ${password}\n\nParent can now log in to track children classes.${familyEmailNotice}`, { type: 'success' });
    }

    async function handleSaveStudent(e) {
      e.preventDefault();
      const btn = document.getElementById('btnSaveStudent');
      btn.disabled = true;
      btn.innerText = 'Enrolling Student...';

      const family_id = document.getElementById('stuFamilyId').value;
      const name = (document.getElementById('stuName').value || '').trim();
      const age = parseInt(document.getElementById('stuAge').value) || 7;
      const gender = document.getElementById('stuGender').value;
      const language = document.getElementById('stuLanguage').value;
      const joining_date = document.getElementById('stuJoiningDate').value || new Date().toISOString().split('T')[0];
      const course_id = document.getElementById('stuCourseSelect').value;
      const days_per_week = document.getElementById('stuDaysPerWeek').value;
      const assigned_teacher_id = document.getElementById('stuTeacherId').value || null;
      const id = document.getElementById('stuGeneratedIdVal').value || getNextStudentId();

      if (!name) {
        lmsNotify("Please enter Student Full Name.", { type: 'warning' });
        btn.disabled = false;
        btn.innerText = 'Enroll Student';
        return;
      }

      if (!family_id) {
        lmsNotify("Please select Family / Parent.", { type: 'warning' });
        btn.disabled = false;
        btn.innerText = 'Enroll Student';
        return;
      }

      if (assigned_teacher_id && typeof validateEligibleTeacherBackend === 'function') {
        const tchCheck = await validateEligibleTeacherBackend(assigned_teacher_id);
        if (!tchCheck.valid) {
          lmsNotify(tchCheck.reason, { type: 'error' });
          btn.disabled = false;
          btn.innerText = 'Enroll Student';
          return;
        }
      }

      const notesMeta = JSON.stringify({ language, days_per_week, course_name: course_id, course: course_id });
      const rawStudentRecord = {
        id, family_id, name, age, gender, course_id, assigned_teacher_id, joining_date, notes: notesMeta, status: 'Active'
      };
      const { dbPayload } = (typeof buildStudentDatabasePayload === 'function')
        ? buildStudentDatabasePayload(rawStudentRecord)
        : { dbPayload: { ...rawStudentRecord, course_id: null } };

      const { error: stuInsertErr } = await db.from('students').insert([dbPayload]);
      if (stuInsertErr) {
        lmsNotify('Failed to enroll student: ' + stuInsertErr.message, { type: 'error' });
        btn.disabled = false;
        btn.innerText = 'Enroll Student';
        return;
      }

      // Cache student profile in localStorage
      const profiles = JSON.parse(localStorage.getItem('alhuda_student_profiles') || '{}');
      profiles[id] = { id, family_id, name, age, gender, language, joining_date, course_id, days_per_week, assigned_teacher_id };
      localStorage.setItem('alhuda_student_profiles', JSON.stringify(profiles));

      btn.disabled = false;
      btn.innerText = 'Enroll Student';
      closeModal('modalAddStudent');
      if (typeof syncFamilyStatusFromStudentsBackend === 'function') {
        await syncFamilyStatusFromStudentsBackend(family_id);
      }
      if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
      await loadFamiliesAndStudents(true);

      const assignedTeacher = (ALL_TEACHERS || []).find(t => String(t.id) === String(assigned_teacher_id));
      const tName = assignedTeacher ? assignedTeacher.full_name : 'Not Assigned Yet';
      const parentFam = (ALL_FAMILIES || []).find(f => String(f.id) === String(family_id));
      const parentEmail = String(parentFam?.parent_email || '').trim();
      const creds = parentFam ? getParentCreds(parentFam) : null;

      // Resolve real class schedule & Zoom link from DB
      const stuSchedules = (window.ALL_SCHEDULES || []).filter(sc => String(sc.student_id) === String(id));
      let scheduleText = days_per_week ? `${days_per_week} (Timetable slot pending)` : 'No classes scheduled.';
      let zoomLink = assignedTeacher?.zoom_link || '';
      if (stuSchedules.length > 0) {
        const daysMap = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const daysStr = [...new Set(stuSchedules.map(sc => daysMap[sc.day_of_week] || '').filter(Boolean))].join(', ');
        const st = (stuSchedules[0].start_time || '').slice(0, 5);
        const et = (stuSchedules[0].end_time || '').slice(0, 5);
        scheduleText = `${daysStr} @ ${st}${et ? ' - ' + et : ''} PKT`;
        const schedZoom = stuSchedules.find(sc => sc.meeting_link)?.meeting_link;
        if (schedZoom) zoomLink = schedZoom;
      }

      // TASK 6: Automatically send welcome email when parent email exists
      let emailStatusSuffix = '';
      if (parentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail) && typeof autoSendWelcomeEmailOnCreation === 'function') {
        const emailRes = await autoSendWelcomeEmailOnCreation({
          type: 'regular',
          studentName: name,
          parentName: parentFam?.parent_name || 'Parent / Guardian',
          toEmail: parentEmail,
          phone: parentFam?.whatsapp || '',
          course: course_id || 'Not Assigned Yet',
          teacherName: tName,
          scheduleText: scheduleText,
          zoomLink: zoomLink,
          credentials: creds ? { username: creds.username, password: creds.password } : null
        });
        if (emailRes && emailRes.sent === false) {
          emailStatusSuffix = '\n\n⚠️ Student created, but welcome email failed to send.';
          if (typeof lmsNotify === 'function') {
            lmsNotify('Student created, but welcome email failed to send.', { type: 'warning' });
          }
        } else if (emailRes && emailRes.sent) {
          emailStatusSuffix = `\n\n📧 Welcome email sent to ${parentEmail}.`;
        }
      }

      alert(`✅ Student Enrolled Successfully!\n\n🎓 Student: ${name} (${id})\n👨‍👩‍👧 Linked Family: ${family_id}\n📚 Course: ${course_id}\n📅 Days Preference: ${days_per_week}\n🗓️ Joining Date: ${joining_date}\n👨‍🏫 Assigned Teacher: ${tName}\n\nStudent is now in Teacher's Student List. You can open Teacher's 2D Schedule to book timetable slots.${emailStatusSuffix}`);
    }

    function copyParentCredentials(user, pass) {
      const txt = `Al-Huda LMS Parent Portal\nUsername: ${user}\nPassword: ${pass}`;
      navigator.clipboard.writeText(txt);
      alert(`Copied to clipboard!\n\n${txt}`);
    }

    let CURRENT_FAMILIES_VIEW = 'famTable';
    let FAM_SEARCH_QUERY = '';
    let CURRENT_FAMILIES_STATUS_FILTER = 'ACTIVE'; // 'ALL' | 'ACTIVE' | 'DEACTIVATED'
    let CURRENT_STUDENTS_STATUS_FILTER = 'ACTIVE'; // 'ALL' | 'ACTIVE' | 'DEACTIVATED'

    function updateStatusFilterPillsUI() {
      const btnFamAll = document.getElementById('btnFilterFamAll');
      const btnFamAct = document.getElementById('btnFilterFamActive');
      const btnFamDeact = document.getElementById('btnFilterFamDeactivated');

      const badgeFamAll = document.getElementById('badgeFilterFamAllCount');
      const badgeFamAct = document.getElementById('badgeFilterFamActiveCount');
      const badgeFamDeact = document.getElementById('badgeFilterFamDeactivatedCount');

      if (btnFamAll) {
        btnFamAll.className = CURRENT_FAMILIES_STATUS_FILTER === 'ALL'
          ? 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-slate-800 bg-slate-900 text-white shadow-2xs transition'
          : 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition';
      }
      if (badgeFamAll) {
        badgeFamAll.className = CURRENT_FAMILIES_STATUS_FILTER === 'ALL'
          ? 'ml-1 px-1.5 py-0.2 rounded-full bg-white/25 text-white font-mono text-[10px]'
          : 'ml-1 px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-800 font-mono text-[10px]';
      }

      if (btnFamAct) {
        btnFamAct.className = CURRENT_FAMILIES_STATUS_FILTER === 'ACTIVE'
          ? 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-emerald-600 bg-emerald-600 text-white shadow-2xs transition'
          : 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 transition';
      }
      if (badgeFamAct) {
        badgeFamAct.className = CURRENT_FAMILIES_STATUS_FILTER === 'ACTIVE'
          ? 'ml-1 px-1.5 py-0.2 rounded-full bg-white/25 text-white font-mono text-[10px]'
          : 'ml-1 px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-mono text-[10px]';
      }

      if (btnFamDeact) {
        btnFamDeact.className = CURRENT_FAMILIES_STATUS_FILTER === 'DEACTIVATED'
          ? 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-rose-600 bg-rose-600 text-white shadow-2xs transition'
          : 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 transition';
      }
      if (badgeFamDeact) {
        badgeFamDeact.className = CURRENT_FAMILIES_STATUS_FILTER === 'DEACTIVATED'
          ? 'ml-1 px-1.5 py-0.2 rounded-full bg-white/25 text-white font-mono text-[10px]'
          : 'ml-1 px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-800 font-mono text-[10px]';
      }

      const btnStuAll = document.getElementById('btnFilterStuAll');
      const btnStuAct = document.getElementById('btnFilterStuActive');
      const btnStuDeact = document.getElementById('btnFilterStuDeactivated');

      const badgeStuAll = document.getElementById('badgeFilterStuAllCount');
      const badgeStuAct = document.getElementById('badgeFilterStuActiveCount');
      const badgeStuDeact = document.getElementById('badgeFilterStuDeactivatedCount');

      if (btnStuAll) {
        btnStuAll.className = CURRENT_STUDENTS_STATUS_FILTER === 'ALL'
          ? 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-slate-800 bg-slate-900 text-white shadow-2xs transition'
          : 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition';
      }
      if (badgeStuAll) {
        badgeStuAll.className = CURRENT_STUDENTS_STATUS_FILTER === 'ALL'
          ? 'ml-1 px-1.5 py-0.2 rounded-full bg-white/25 text-white font-mono text-[10px]'
          : 'ml-1 px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-800 font-mono text-[10px]';
      }

      if (btnStuAct) {
        btnStuAct.className = CURRENT_STUDENTS_STATUS_FILTER === 'ACTIVE'
          ? 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-teal-600 bg-teal-600 text-white shadow-2xs transition'
          : 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-teal-200 bg-white text-teal-700 hover:bg-teal-50 transition';
      }
      if (badgeStuAct) {
        badgeStuAct.className = CURRENT_STUDENTS_STATUS_FILTER === 'ACTIVE'
          ? 'ml-1 px-1.5 py-0.2 rounded-full bg-white/25 text-white font-mono text-[10px]'
          : 'ml-1 px-1.5 py-0.2 rounded-full bg-teal-100 text-teal-800 font-mono text-[10px]';
      }

      if (btnStuDeact) {
        btnStuDeact.className = CURRENT_STUDENTS_STATUS_FILTER === 'DEACTIVATED'
          ? 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-rose-600 bg-rose-600 text-white shadow-2xs transition'
          : 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 transition';
      }
      if (badgeStuDeact) {
        badgeStuDeact.className = CURRENT_STUDENTS_STATUS_FILTER === 'DEACTIVATED'
          ? 'ml-1 px-1.5 py-0.2 rounded-full bg-white/25 text-white font-mono text-[10px]'
          : 'ml-1 px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-800 font-mono text-[10px]';
      }
    }

    function syncAllFamilyAndStudentCountersUI(familiesInput = null, studentsInput = null) {
      const rawFamilies = Array.isArray(familiesInput) ? familiesInput : (ALL_FAMILIES || []);
      const rawStudents = Array.isArray(studentsInput) ? studentsInput : (ALL_STUDENTS || []);

      const regularFamilies = typeof getAllFamilies === 'function'
        ? getAllFamilies(rawFamilies)
        : rawFamilies.filter(f => typeof isRegularFamilyRecord === 'function' ? isRegularFamilyRecord(f) : true);

      const activeFamiliesList = typeof getActiveFamilies === 'function'
        ? getActiveFamilies(regularFamilies)
        : regularFamilies.filter(f => typeof isFamilyDeactivated === 'function' ? !isFamilyDeactivated(f) : !['inactive', 'deactivated'].includes(String(f.status || '').toLowerCase()));

      const deactivatedFamiliesList = typeof getDeactivatedFamilies === 'function'
        ? getDeactivatedFamilies(regularFamilies)
        : regularFamilies.filter(f => typeof isFamilyDeactivated === 'function' ? isFamilyDeactivated(f) : ['inactive', 'deactivated'].includes(String(f.status || '').toLowerCase()));

      const allStu = typeof getAllStudents === 'function'
        ? getAllStudents(rawStudents, regularFamilies)
        : rawStudents.filter(s => typeof isRegularStudentRecord === 'function' ? isRegularStudentRecord(s) : true);

      const famMap = {};
      regularFamilies.forEach(f => { famMap[String(f.id).toUpperCase()] = f; });

      const activeStudentsOnly = typeof getActiveStudents === 'function'
        ? getActiveStudents(allStu, regularFamilies)
        : allStu.filter(s => typeof isActiveStudentRecord === 'function' ? isActiveStudentRecord(s, famMap) : !['inactive', 'deactivated'].includes(String(s.status || '').toLowerCase()));

      const deactivatedStudentsOnly = typeof getDeactivatedStudents === 'function'
        ? getDeactivatedStudents(allStu, regularFamilies)
        : allStu.filter(s => !(typeof isActiveStudentRecord === 'function' ? isActiveStudentRecord(s, famMap) : !['inactive', 'deactivated'].includes(String(s.status || '').toLowerCase())));

      const activeStus = activeStudentsOnly.filter(s => {
        const st = (s.status || 'Active').toLowerCase();
        return st === 'active' || st === 'regular' || st === 'leave';
      }).length;

      const setFVal = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      setFVal('famSummaryTotalFamilies', regularFamilies.length);
      setFVal('famSummaryActiveFamilies', activeFamiliesList.length);
      setFVal('famSummaryTotalStudents', allStu.length);
      setFVal('famSummaryActiveStudents', activeStus);
      setFVal('badgeDeactivatedFamCount', deactivatedFamiliesList.length);
      setFVal('badgeDeactivatedFamiliesHeaderCount', `${deactivatedFamiliesList.length} Deactivated ${deactivatedFamiliesList.length === 1 ? 'Family' : 'Families'}`);
      setFVal('sidebarActiveFamilies', activeFamiliesList.length);
      setFVal('sidebarActiveStudents', activeStus);

      // Update Filter Pill Counters
      setFVal('badgeFilterFamAllCount', regularFamilies.length);
      setFVal('badgeFilterFamActiveCount', activeFamiliesList.length);
      setFVal('badgeFilterFamDeactivatedCount', deactivatedFamiliesList.length);
      setFVal('badgeFilterStuAllCount', allStu.length);
      setFVal('badgeFilterStuActiveCount', activeStudentsOnly.length);
      setFVal('badgeFilterStuDeactivatedCount', deactivatedStudentsOnly.length);

      updateStatusFilterPillsUI();
    }
    window.syncAllFamilyAndStudentCountersUI = syncAllFamilyAndStudentCountersUI;

    function setFamiliesStatusFilter(filterMode) {
      CURRENT_FAMILIES_STATUS_FILTER = ['ALL', 'ACTIVE', 'DEACTIVATED'].includes(filterMode) ? filterMode : 'ACTIVE';
      updateStatusFilterPillsUI();
      if (CURRENT_FAMILIES_VIEW === 'studentsList' || CURRENT_FAMILIES_VIEW === 'deactivatedFams') {
        switchFamiliesViewMode('famTable');
      } else {
        renderFamiliesCards();
        renderFamiliesMasterTable();
      }
    }

    function setStudentsStatusFilter(filterMode) {
      CURRENT_STUDENTS_STATUS_FILTER = ['ALL', 'ACTIVE', 'DEACTIVATED'].includes(filterMode) ? filterMode : 'ACTIVE';
      updateStatusFilterPillsUI();
      if (CURRENT_FAMILIES_VIEW !== 'studentsList') {
        switchFamiliesViewMode('studentsList');
      } else {
        renderAllStudentsListTable();
      }
    }

    window.setFamiliesStatusFilter = setFamiliesStatusFilter;
    window.setStudentsStatusFilter = setStudentsStatusFilter;

    function getFilteredFamiliesByCurrentStatus() {
      const allFams = typeof getAllFamilies === 'function' ? getAllFamilies(ALL_FAMILIES) : (ALL_FAMILIES || []);
      if (CURRENT_FAMILIES_STATUS_FILTER === 'ALL') {
        return allFams;
      }
      if (CURRENT_FAMILIES_STATUS_FILTER === 'DEACTIVATED') {
        return typeof getDeactivatedFamilies === 'function'
          ? getDeactivatedFamilies(allFams)
          : allFams.filter(f => typeof isFamilyDeactivated === 'function' ? isFamilyDeactivated(f) : ['inactive', 'deactivated'].includes(String(f.status || '').toLowerCase()));
      }
      return typeof getActiveFamilies === 'function'
        ? getActiveFamilies(allFams)
        : allFams.filter(f => typeof isFamilyDeactivated === 'function' ? !isFamilyDeactivated(f) : !['inactive', 'deactivated'].includes(String(f.status || '').toLowerCase()));
    }

    function getFilteredStudentsByCurrentStatus() {
      const allStus = typeof getAllStudents === 'function' ? getAllStudents(ALL_STUDENTS, ALL_FAMILIES) : (ALL_STUDENTS || []);
      if (CURRENT_STUDENTS_STATUS_FILTER === 'ALL') {
        return allStus;
      }
      if (CURRENT_STUDENTS_STATUS_FILTER === 'DEACTIVATED') {
        return typeof getDeactivatedStudents === 'function'
          ? getDeactivatedStudents(allStus, ALL_FAMILIES)
          : allStus.filter(s => !(typeof isActiveStudentRecord === 'function' ? isActiveStudentRecord(s, ALL_FAMILIES) : !['inactive', 'deactivated'].includes(String(s.status || '').toLowerCase())));
      }
      return typeof getActiveStudents === 'function'
        ? getActiveStudents(allStus, ALL_FAMILIES)
        : allStus.filter(s => typeof isActiveStudentRecord === 'function' ? isActiveStudentRecord(s, ALL_FAMILIES) : !['inactive', 'deactivated'].includes(String(s.status || '').toLowerCase()));
    }

    function switchFamiliesViewMode(mode) {
      CURRENT_FAMILIES_VIEW = mode;
      if (typeof syncAllFamilyAndStudentCountersUI === 'function') {
        syncAllFamilyAndStudentCountersUI();
      }
      const btnCards = document.getElementById('btnViewFamCards');
      const btnTable = document.getElementById('btnViewFamTable');
      const btnStudents = document.getElementById('btnViewStudentsList');
      const btnDeact = document.getElementById('btnViewDeactivatedFams');

      const secCards = document.getElementById('familiesCardsContainer');
      const secTable = document.getElementById('familiesTableContainer');
      const secStudents = document.getElementById('studentsListContainer');
      const secDeact = document.getElementById('deactivatedFamiliesContainer');

      [btnCards, btnTable, btnStudents, btnDeact].forEach(b => {
        if (b) b.className = 'px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition font-bold whitespace-nowrap';
      });

      if (mode === 'cards') {
        if (btnCards) btnCards.className = 'px-3 py-1.5 rounded-lg bg-white text-slate-900 shadow-2xs flex items-center gap-1.5 transition font-extrabold whitespace-nowrap';
        if (secCards) secCards.classList.remove('hidden');
        if (secTable) secTable.classList.add('hidden');
        if (secStudents) secStudents.classList.add('hidden');
        if (secDeact) secDeact.classList.add('hidden');
        updateStatusFilterPillsUI();
        renderFamiliesCards();
      } else if (mode === 'famTable') {
        if (btnTable) btnTable.className = 'px-3 py-1.5 rounded-lg bg-white text-slate-900 shadow-2xs flex items-center gap-1.5 transition font-extrabold whitespace-nowrap';
        if (secCards) secCards.classList.add('hidden');
        if (secTable) secTable.classList.remove('hidden');
        if (secStudents) secStudents.classList.add('hidden');
        if (secDeact) secDeact.classList.add('hidden');
        updateStatusFilterPillsUI();
        renderFamiliesMasterTable();
      } else if (mode === 'studentsList') {
        if (btnStudents) btnStudents.className = 'px-3 py-1.5 rounded-lg bg-white text-slate-900 shadow-2xs flex items-center gap-1.5 transition font-extrabold whitespace-nowrap';
        if (secCards) secCards.classList.add('hidden');
        if (secTable) secTable.classList.add('hidden');
        if (secStudents) secStudents.classList.remove('hidden');
        if (secDeact) secDeact.classList.add('hidden');
        updateStatusFilterPillsUI();
        renderAllStudentsListTable();
      } else if (mode === 'deactivatedFams') {
        CURRENT_FAMILIES_STATUS_FILTER = 'DEACTIVATED';
        updateStatusFilterPillsUI();
        if (btnDeact) btnDeact.className = 'px-3 py-1.5 rounded-lg bg-white text-rose-800 shadow-2xs flex items-center gap-1.5 transition font-extrabold whitespace-nowrap';
        if (secCards) secCards.classList.add('hidden');
        if (secTable) secTable.classList.add('hidden');
        if (secStudents) secStudents.classList.add('hidden');
        if (secDeact) secDeact.classList.remove('hidden');
        renderDeactivatedFamiliesView();
      }
    }

    function handleFamUnifiedSearch(query) {
      FAM_SEARCH_QUERY = (query || '').trim().toLowerCase();
      renderFamiliesCards();
      renderFamiliesMasterTable();
      renderAllStudentsListTable();
      renderDeactivatedFamiliesView();
    }

    async function loadFamiliesAndStudents(forceRefresh = false) {
      let families = [];
      let regularFamilies = [];
      let allStu = [];

      if (typeof ensureCoreLmsDataLoaded === 'function') {
        const core = await ensureCoreLmsDataLoaded({ force: Boolean(forceRefresh) });
        families = core.rawFamilies || [];
        regularFamilies = core.families || [];
        allStu = core.students || [];
      } else {
        const { data: fams } = await db.from('families').select('*, students(*)').order('created_at', { ascending: false });
        families = fams || [];
        const normalizePhone = (p) => String(p || '').replace(/[^0-9]/g, '').slice(-10);
        const normalizeName = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const seenFamKeys = new Set();

        regularFamilies = families.filter(f => {
          if (typeof isRegularFamilyRecord === 'function' ? !isRegularFamilyRecord(f) : ((f.status || '').toLowerCase() === 'trial' || (f.status || '').toLowerCase() === 'converted' || (f.id || '').toUpperCase().startsWith('TRL-'))) {
            return false;
          }
          const key = normalizePhone(f.whatsapp) || normalizeName(f.parent_name) || f.id;
          if (seenFamKeys.has(key)) return false;
          seenFamKeys.add(key);
          return true;
        }).map(f => ({
          ...f,
          students: (f.students || []).filter(s => {
            return typeof isRegularStudentRecord === 'function'
              ? isRegularStudentRecord(s)
              : ((s.status || '').toLowerCase() !== 'trial' && !(s.id || '').toUpperCase().startsWith('TRL-'));
          })
        }));

        ALL_FAMILIES = regularFamilies;
        regularFamilies.forEach(f => {
          if (f.students) allStu.push(...f.students);
        });
        ALL_STUDENTS = allStu;
      }

      // Count ONLY currently active Trial families (for info badge in tab)
      const trialFamCount = (families || []).filter(f =>
        (f.status || '').toLowerCase() === 'trial'
      ).length;
      const trialInfoEl = document.getElementById('trialFamiliesInfoNote');
      if (trialInfoEl) {
        if (trialFamCount > 0) {
          trialInfoEl.innerHTML = `<i class="fa-solid fa-circle-info text-purple-500"></i> <span class="text-purple-800 font-bold">${trialFamCount} Active Trial Entr${trialFamCount === 1 ? 'y' : 'ies'} in Evaluation</span> — <button onclick="switchTab('tab-trials')" class="underline text-purple-700 font-extrabold hover:text-purple-900">View in Trial Classes tab →</button>`;
          trialInfoEl.classList.remove('hidden');
        } else {
          trialInfoEl.innerHTML = '';
          trialInfoEl.classList.add('hidden');
        }
      }

      const famMap = {};
      regularFamilies.forEach(f => { famMap[String(f.id).toUpperCase()] = f; });

      const activeFamiliesList = typeof getActiveFamilies === 'function'
        ? getActiveFamilies(regularFamilies)
        : regularFamilies.filter(f => typeof isFamilyDeactivated === 'function' ? !isFamilyDeactivated(f) : !['inactive', 'deactivated'].includes(String(f.status || '').toLowerCase()));
      const deactivatedFamiliesList = typeof getDeactivatedFamilies === 'function'
        ? getDeactivatedFamilies(regularFamilies)
        : regularFamilies.filter(f => typeof isFamilyDeactivated === 'function' ? isFamilyDeactivated(f) : ['inactive', 'deactivated'].includes(String(f.status || '').toLowerCase()));

      const famSelect = document.getElementById('stuFamilyId');
      if (famSelect) {
        famSelect.innerHTML = activeFamiliesList.map(f => `<option value="${f.id}">${f.parent_name} (${f.id} &bull; ${f.country})</option>`).join('');
      }

      // Update Summary Badges & Filter Counts
      const activeFams = activeFamiliesList.length;

      const activeStudentsOnly = typeof getActiveStudents === 'function'
        ? getActiveStudents(allStu, regularFamilies)
        : allStu.filter(s => typeof isActiveStudentRecord === 'function' ? isActiveStudentRecord(s, famMap) : !['inactive', 'deactivated'].includes(String(s.status || '').toLowerCase()));
      const deactivatedStudentsOnly = typeof getDeactivatedStudents === 'function'
        ? getDeactivatedStudents(allStu, regularFamilies)
        : allStu.filter(s => !(typeof isActiveStudentRecord === 'function' ? isActiveStudentRecord(s, famMap) : !['inactive', 'deactivated'].includes(String(s.status || '').toLowerCase())));

      const activeStus = activeStudentsOnly.filter(s => {
        const st = (s.status || 'Active').toLowerCase();
        return st === 'active' || st === 'regular' || st === 'leave';
      }).length;

      const setFVal = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      setFVal('famSummaryTotalFamilies', regularFamilies.length);
      setFVal('famSummaryActiveFamilies', activeFams);
      setFVal('famSummaryTotalStudents', allStu.length);
      setFVal('famSummaryActiveStudents', activeStus);
      setFVal('badgeDeactivatedFamCount', deactivatedFamiliesList.length);
      setFVal('badgeDeactivatedFamiliesHeaderCount', `${deactivatedFamiliesList.length} Deactivated ${deactivatedFamiliesList.length === 1 ? 'Family' : 'Families'}`);
      setFVal('sidebarActiveFamilies', activeFams);
      setFVal('sidebarActiveStudents', activeStus);

      // Update Filter Pill Counters
      setFVal('badgeFilterFamAllCount', regularFamilies.length);
      setFVal('badgeFilterFamActiveCount', activeFamiliesList.length);
      setFVal('badgeFilterFamDeactivatedCount', deactivatedFamiliesList.length);
      setFVal('badgeFilterStuAllCount', allStu.length);
      setFVal('badgeFilterStuActiveCount', activeStudentsOnly.length);
      setFVal('badgeFilterStuDeactivatedCount', deactivatedStudentsOnly.length);

      updateStatusFilterPillsUI();

      if (!forceRefresh) {
        switchFamiliesViewMode('famTable');
      } else {
        switchFamiliesViewMode(CURRENT_FAMILIES_VIEW || 'famTable');
      }
      renderFamiliesCards();
      renderFamiliesMasterTable();
      renderAllStudentsListTable();
      renderDeactivatedFamiliesView();
    }

    function renderFamiliesCards() {
      const container = document.getElementById('familiesCardsContainer');
      if (!container) return;

      const q = FAM_SEARCH_QUERY;
      const baseFamilies = getFilteredFamiliesByCurrentStatus();
      const filtered = baseFamilies.filter(f => {
        if (!q) return true;
        const name = (f.parent_name || '').toLowerCase();
        const id = (f.id || '').toLowerCase();
        const phone = (f.whatsapp || '').toLowerCase();
        const country = (f.country || '').toLowerCase();
        const childMatch = (f.students || []).some(s => (s.name || '').toLowerCase().includes(q) || (s.id || '').toLowerCase().includes(q));
        return name.includes(q) || id.includes(q) || phone.includes(q) || country.includes(q) || childMatch;
      });

      const statusLabel = CURRENT_FAMILIES_STATUS_FILTER === 'ALL' ? 'families' : CURRENT_FAMILIES_STATUS_FILTER === 'DEACTIVATED' ? 'deactivated families' : 'active families';
      if (filtered.length === 0) {
        container.innerHTML = `<div class="col-span-full p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-400">No ${statusLabel} match the current filter/search criteria.</div>`;
        return;
      }

      const cachedProfiles = JSON.parse(localStorage.getItem('alhuda_student_profiles') || '{}');

      container.innerHTML = filtered.map((f, fIdx) => {
        const creds = getParentCreds(f);
        const cleanPhone = (f.whatsapp || '').replace(/[^0-9]/g, '');
        const currentUrl = window.location.origin + window.location.pathname;
        const waMsg = `Assalam-o-Alaikum Respected ${f.parent_name},\nWelcome to *Al-Huda Islamic Centre LMS*.\nHere are your Parent / Student Portal Login Credentials:\n\n🌐 *Portal Link:* ${currentUrl}\n👨‍👩‍👧 *Family ID:* ${f.id}\n👤 *Username:* ${creds.username}\n🔑 *Password:* ${creds.password}\n💰 *Agreed Monthly Fee:* ${f.currency} ${f.monthly_fee}\n\nPlease sign in to monitor your children's daily Quran lessons and attendance.\nJazakAllahu Khairan!`;
        const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;
        const studentsList = f.students || [];
        const isFamDeact = typeof isFamilyDeactivated === 'function' ? isFamilyDeactivated(f) : ['inactive', 'deactivated'].includes(String(f.status || '').toLowerCase());
        const famStatusBadge = isFamDeact
          ? `<span class="text-[10px] px-2 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded font-extrabold">DEACTIVATED</span>`
          : `<span class="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded font-extrabold">ACTIVE</span>`;

        return `
          <div class="bg-white rounded-2xl border ${isFamDeact ? 'border-rose-200 bg-rose-50/10' : 'border-slate-200'} shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between">
            <div>
              <!-- Family Header with Sequential Number and ID -->
              <div class="flex justify-between items-start border-b pb-3 mb-3">
                <div class="flex items-center gap-3">
                  <div class="w-12 h-12 rounded-xl ${isFamDeact ? 'bg-rose-100 border-rose-300 text-rose-800' : 'bg-gradient-to-br from-emerald-100 to-amber-100 border-emerald-300 text-brandDark'} border flex items-center justify-center font-black text-base shadow-xs">
                    <i class="fa-solid ${isFamDeact ? 'fa-user-slash text-rose-600' : 'fa-house-user text-brandEmerald'}"></i>
                  </div>
                  <div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-[10px] font-mono px-2 py-0.5 bg-slate-900 text-white rounded font-black">#${fIdx + 1}</span>
                      <button onclick="openFamily360Profile('${f.id}')" class="text-[10px] font-mono px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded font-extrabold transition" title="Open Family 360° Profile">${f.id}</button>
                      ${famStatusBadge}
                      <span class="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-bold">${f.country}</span>
                    </div>
                    <button onclick="openFamily360Profile('${f.id}')" class="font-extrabold text-base text-slate-900 hover:text-brandEmerald hover:underline mt-0.5 text-left block transition" title="Click to open complete Family 360° Profile">${f.parent_name}</button>
                    <p class="text-[11px] text-slate-500 flex items-center gap-1">
                      ${CURRENT_ROLE === 'manager' ? `
                        <i class="fa-solid fa-lock text-amber-500"></i>
                        <span class="font-mono text-slate-600 font-bold" title="Protected Contact Number">${maskStudentPhone(f.whatsapp)}</span>
                        ${f.parent_email ? `&bull; <span class="truncate max-w-[130px] font-mono text-slate-500" title="Protected Email">${maskStudentEmail(f.parent_email)}</span>` : ''}
                      ` : `
                        <i class="fa-brands fa-whatsapp text-emerald-600"></i>
                        <a href="https://wa.me/${cleanPhone}" target="_blank" class="hover:underline font-mono">${f.whatsapp}</a>
                        ${f.parent_email ? `&bull; <span class="truncate max-w-[130px]">${f.parent_email}</span>` : ''}
                      `}
                    </p>
                  </div>
                </div>
                <div class="bg-emerald-50/80 border border-emerald-200/90 px-3 py-1.5 rounded-xl text-right shrink-0">
                  <span class="text-[10px] uppercase tracking-wider text-emerald-800 font-bold block leading-tight">Monthly Fee</span>
                  <div class="text-lg font-bold text-brandDark leading-tight mt-0.5">
                    ${typeof formatLmsCurrencyHtml === 'function' ? formatLmsCurrencyHtml(f.monthly_fee, f.currency, 'text-lg text-brandDark') : `<span class="lms-num-financial">${f.currency} ${Number(f.monthly_fee || 0).toLocaleString()}</span>`}
                  </div>
                </div>
              </div>

              <!-- Parent LMS Portal Login Box -->
              <div class="bg-gradient-to-r from-emerald-50/80 to-amber-50/50 p-2.5 rounded-xl border border-brandEmerald/30 mb-3 space-y-1.5">
                <div class="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                  <span class="text-brandDark flex items-center gap-1"><i class="fa-solid fa-key text-brandGold"></i> Parent Portal Login</span>
                  <button onclick="copyParentCredentials('${creds.username}', '${creds.password}')" class="text-brandEmerald hover:text-brandDark font-bold" title="Copy Login Details">
                    <i class="fa-regular fa-copy"></i> Copy
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div class="bg-white px-2 py-1 rounded border border-slate-200 truncate">
                    <span class="text-[9px] text-slate-400 block">User:</span>
                    <strong class="text-slate-800">${creds.username}</strong>
                  </div>
                  <div class="bg-white px-2 py-1 rounded border border-slate-200 truncate">
                    <span class="text-[9px] text-slate-400 block">Pass:</span>
                    <strong class="text-brandDark">${creds.password}</strong>
                  </div>
                </div>
                ${CURRENT_ROLE !== 'manager' ? `
                  <a href="${waUrl}" target="_blank" class="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] flex items-center justify-center gap-1.5 shadow-xs transition mt-1">
                    <i class="fa-brands fa-whatsapp"></i> Send Portal Login to Parent WhatsApp
                  </a>
                  <button onclick="openFamilyEmailModal('${f.id}')" class="w-full py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1.5 shadow-xs transition mt-1">
                    <i class="fa-solid fa-envelope text-purple-600"></i> Send Welcome & Zoom Email
                  </button>
                ` : `
                  <div class="p-2 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] rounded-lg font-semibold text-center mt-1 flex items-center justify-center gap-1.5">
                    <i class="fa-solid fa-shield-halved text-amber-600"></i> Parent WhatsApp &amp; Email Protected (Manager Role)
                  </div>
                `}
              </div>

              <!-- Enrolled Sibling Students -->
              <div class="space-y-2">
                <div class="flex justify-between items-center text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                  <span>Enrolled Children (${studentsList.length}):</span>
                  <button onclick="prepareAddStudentModal('${f.id}')" class="text-emerald-700 hover:text-emerald-900 font-extrabold capitalize text-xs">
                    + Add Child
                  </button>
                </div>

                ${studentsList.length === 0 ? `
                  <div class="p-3 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                    No sibling students linked yet.<br>
                    <button onclick="prepareAddStudentModal('${f.id}')" class="text-brandEmerald font-bold hover:underline mt-1">+ Enroll First Child</button>
                  </div>
                ` : `
                  <div class="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                    ${studentsList.map(s => {
                      let meta = cachedProfiles[s.id] || {};
                      if (!meta.language && s.notes) {
                        try { meta = JSON.parse(s.notes); } catch (e) {}
                      }
                      const assignedTeacher = ALL_TEACHERS.find(t => t.id === s.assigned_teacher_id);
                      const tName = assignedTeacher ? assignedTeacher.full_name : 'No Teacher Assigned';
                      const joinStr = s.joining_date ? `Joined: ${s.joining_date}` : '';
                      const isStuDeact = typeof isStudentSelfDeactivated === 'function'
                        ? isStudentSelfDeactivated(s)
                        : ['inactive', 'deactivated'].includes(String(s.status || '').toLowerCase());

                      return `
                        <div class="p-2.5 rounded-xl border ${isStuDeact ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-slate-50/70'} hover:bg-white text-xs transition space-y-1">
                          <div class="flex justify-between items-start">
                            <div class="flex items-center gap-1.5 flex-wrap">
                              <button onclick="openStudent360Profile('${s.id}')" class="font-bold ${isStuDeact ? 'text-slate-500' : 'text-slate-900'} hover:text-brandEmerald hover:underline text-left">${s.name}</button>
                              <span class="text-[9px] font-mono px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded font-bold">${s.id}</span>
                              ${isStuDeact ? `<span class="px-1.5 py-0.2 rounded text-[8px] font-black bg-rose-100 text-rose-800 border border-rose-300">DEACTIVATED</span>` : `<span class="px-1.5 py-0.2 rounded text-[8px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">ACTIVE</span>`}
                            </div>
                            <button onclick="openStudent360Profile('${s.id}')" class="text-brandEmerald hover:text-brandDark font-bold text-[10px] flex items-center gap-1">
                              Family Profile <i class="fa-solid fa-chevron-right text-[8px]"></i>
                            </button>
                          </div>
                          <div class="flex justify-between text-[10px] text-slate-500">
                            <span>${s.course_id || 'Quran Reading'}</span>
                            <span>${joinStr}</span>
                          </div>
                          <div class="text-[10px] text-slate-600 flex items-center gap-1">
                            <i class="fa-solid fa-chalkboard-user text-brandEmerald"></i>
                            <strong>Teacher:</strong>
                            ${assignedTeacher ? `<button onclick="openTeacher360Profile('${assignedTeacher.id}')" class="text-indigo-700 hover:underline font-extrabold">${tName}</button>` : `<span class="text-slate-400">${tName}</span>`}
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                `}
              </div>
            </div>

            <!-- Card Bottom Action -->
            <div class="pt-3 border-t mt-3 grid grid-cols-2 gap-2">
              <button onclick="openFamily360Profile('${f.id}')" class="py-2 bg-brandDark hover:bg-brandDarkest text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-2xs">
                <i class="fa-solid fa-circle-nodes text-brandGold"></i> Family 360°
              </button>
              <button onclick="prepareAddStudentModal('${f.id}')" class="py-2 bg-emerald-50 hover:bg-emerald-100 text-brandEmerald font-bold rounded-xl text-xs border border-emerald-200 flex items-center justify-center gap-1.5 transition">
                <i class="fa-solid fa-plus"></i> + Add Sibling
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    function renderFamiliesMasterTable() {
      const tbody = document.getElementById('familiesTableBody');
      if (!tbody) return;

      const q = FAM_SEARCH_QUERY;
      const baseFamilies = getFilteredFamiliesByCurrentStatus();
      const filtered = baseFamilies.filter(f => {
        if (!q) return true;
        const name = (f.parent_name || '').toLowerCase();
        const id = (f.id || '').toLowerCase();
        const phone = (f.whatsapp || '').toLowerCase();
        const country = (f.country || '').toLowerCase();
        const childMatch = (f.students || []).some(s => (s.name || '').toLowerCase().includes(q) || (s.id || '').toLowerCase().includes(q));
        return name.includes(q) || id.includes(q) || phone.includes(q) || country.includes(q) || childMatch;
      });

      const badgeCountEl = document.getElementById('badgeFamTableCount');
      const filterTitlePrefix = CURRENT_FAMILIES_STATUS_FILTER === 'ALL' ? 'All Families' : CURRENT_FAMILIES_STATUS_FILTER === 'DEACTIVATED' ? 'Deactivated Families' : 'Active Families';
      if (badgeCountEl) {
        badgeCountEl.textContent = `${filtered.length} ${filterTitlePrefix}`;
        badgeCountEl.className = CURRENT_FAMILIES_STATUS_FILTER === 'DEACTIVATED'
          ? 'px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-rose-100 text-rose-800 border border-rose-200'
          : CURRENT_FAMILIES_STATUS_FILTER === 'ALL'
          ? 'px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-slate-800 text-white border border-slate-700'
          : 'px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200';
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-slate-400">No ${filterTitlePrefix.toLowerCase()} found matching search.</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map((f, idx) => {
        const creds = getParentCreds(f);
        const cleanPhone = (f.whatsapp || '').replace(/[^0-9]/g, '');
        const allSibs = f.students || [];
        const activeSibCount = allSibs.filter(s => !(typeof isStudentSelfDeactivated === 'function' ? isStudentSelfDeactivated(s) : ['inactive', 'deactivated'].includes(String(s.status || '').toLowerCase()))).length;
        const deactSibCount = allSibs.length - activeSibCount;
        const isFamDeact = typeof isFamilyDeactivated === 'function' ? isFamilyDeactivated(f) : ['inactive', 'deactivated'].includes(String(f.status || '').toLowerCase());
        const statusBadgeHtml = isFamDeact
          ? `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300">DEACTIVATED</span>`
          : `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">ACTIVE</span>`;

        return `
          <tr onclick="openFamily360Profile('${f.id}')" class="hover:bg-slate-50 transition text-xs cursor-pointer ${isFamDeact ? 'bg-rose-50/20' : ''}" title="Click to open Family 360° Profile">
            <td class="p-3 text-center lms-num-table font-bold text-slate-600">${idx + 1}</td>
            <td class="p-3 lms-num-id font-bold text-brandDark">
              <button onclick="event.stopPropagation(); openFamily360Profile('${f.id}')" class="px-2 py-0.5 rounded-md ${isFamDeact ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-brandDark'} border hover:opacity-90 transition">${f.id}</button>
            </td>
            <td class="p-3 font-bold text-slate-900">
              <button onclick="event.stopPropagation(); openFamily360Profile('${f.id}')" class="hover:text-brandEmerald hover:underline text-left font-extrabold">${f.parent_name}</button>
            </td>
            <td class="p-3">${statusBadgeHtml}</td>
            <td class="p-3 text-slate-600">${f.country || '--'}</td>
            <td class="p-3 lms-num-table">
              ${CURRENT_ROLE === 'manager' ? `
                <span class="text-slate-600 flex items-center gap-1 font-bold" title="Protected Contact for Manager">
                  <i class="fa-solid fa-lock text-amber-500 text-[10px]"></i> ${maskStudentPhone(f.whatsapp)}
                </span>
              ` : `
                <a onclick="event.stopPropagation()" href="https://wa.me/${cleanPhone}" target="_blank" class="text-emerald-700 hover:underline flex items-center gap-1">
                  <i class="fa-brands fa-whatsapp text-emerald-600"></i> ${f.whatsapp || '--'}
                </a>
              `}
            </td>
            <td class="p-3">
              ${typeof formatLmsCurrencyHtml === 'function' ? formatLmsCurrencyHtml(f.monthly_fee, f.currency, 'text-[15px] text-emerald-800') : `<span class="lms-num-financial text-[15px] text-emerald-800">${f.currency} ${Number(f.monthly_fee || 0).toLocaleString()}</span>`}
            </td>
            <td class="p-3 font-bold text-slate-700">
              <div class="inline-flex items-center gap-1.5 flex-wrap">
                <button onclick="event.stopPropagation(); openFamily360Profile('${f.id}', 'students')" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-emerald-100 border border-slate-200 text-xs font-bold lms-num-table transition">${activeSibCount} Active</button>
                ${deactSibCount > 0 ? `<span class="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-extrabold">${deactSibCount} Deactivated</span>` : ''}
              </div>
            </td>
            <td class="p-3 font-mono text-[11px]">
              <span class="text-slate-500">U:</span> <strong>${creds.username}</strong>
            </td>
            <td class="p-3 text-right">
              <div class="flex items-center justify-end gap-1.5">
                ${isFamDeact ? `
                  <button onclick="event.stopPropagation(); handleFamilyLevelDeactivate('${f.id}')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] transition">
                    <i class="fa-solid fa-rotate-left"></i> Reactivate
                  </button>
                ` : `
                  <button onclick="event.stopPropagation(); prepareAddStudentModal('${f.id}')" class="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-brandEmerald rounded-lg font-bold text-[11px] border border-emerald-200 transition">
                    + Add Child
                  </button>
                `}
                <button onclick="event.stopPropagation(); openFamily360Profile('${f.id}')" class="px-2.5 py-1 bg-brandDark hover:bg-brandDarkest text-white rounded-lg font-bold text-[11px] transition">
                  Family 360°
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    function renderAllStudentsListTable() {
      const tbody = document.getElementById('studentsListTableBody');
      if (!tbody) return;

      const famMap = {};
      (ALL_FAMILIES || []).forEach(f => { famMap[String(f.id).toUpperCase()] = f; });

      const q = FAM_SEARCH_QUERY;
      const baseStudents = getFilteredStudentsByCurrentStatus();

      const filtered = baseStudents.filter(s => {
        if (!q) return true;
        const name = (s.name || '').toLowerCase();
        const id = (s.id || '').toLowerCase();
        const famId = (s.family_id || '').toLowerCase();
        const parentFam = famMap[String(s.family_id || '').toUpperCase()];
        const parentName = (parentFam?.parent_name || '').toLowerCase();
        const course = (s.course_id || '').toLowerCase();
        return name.includes(q) || id.includes(q) || famId.includes(q) || parentName.includes(q) || course.includes(q);
      });

      const badgeCountEl = document.getElementById('badgeStudentsListCount');
      const stuFilterLabel = CURRENT_STUDENTS_STATUS_FILTER === 'ALL' ? 'All Students' : CURRENT_STUDENTS_STATUS_FILTER === 'DEACTIVATED' ? 'Deactivated Students' : 'Active Students';
      if (badgeCountEl) {
        badgeCountEl.textContent = `${filtered.length} ${stuFilterLabel}`;
        badgeCountEl.className = CURRENT_STUDENTS_STATUS_FILTER === 'DEACTIVATED'
          ? 'px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-rose-100 text-rose-800 border border-rose-200'
          : CURRENT_STUDENTS_STATUS_FILTER === 'ALL'
          ? 'px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-slate-800 text-white border border-slate-700'
          : 'px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-teal-100 text-teal-800 border border-teal-200';
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-400">No ${stuFilterLabel.toLowerCase()} found matching search.</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map((s, idx) => {
        const parentFam = famMap[String(s.family_id || '').toUpperCase()];
        const parentName = parentFam ? parentFam.parent_name : (s.family_id || '--');
        const isStuActive = typeof isActiveStudentRecord === 'function'
          ? isActiveStudentRecord(s, famMap)
          : !['inactive', 'deactivated', 'deleted', 'left'].includes(String(s.status || 'Active').toLowerCase());
        const assignedTeacher = isStuActive ? (ALL_TEACHERS || []).find(t => t.id === s.assigned_teacher_id) : null;
        const tName = assignedTeacher
          ? `<button onclick="openTeacher360Profile('${assignedTeacher.id}')" class="font-bold text-indigo-700 hover:underline text-left">${assignedTeacher.full_name}</button>`
          : `<span class="text-slate-400 italic">${isStuActive ? 'Not Assigned' : 'Unassigned (Deactivated)'}</span>`;
        const status = s.status || 'Active';

        let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200">ACTIVE</span>';
        if (!isStuActive) {
          statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300">DEACTIVATED</span>';
        } else if (status.toLowerCase() === 'leave') {
          statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-200">ON LEAVE</span>';
        }

        return `
          <tr class="hover:bg-slate-50 transition text-xs ${!isStuActive ? 'bg-rose-50/20' : ''}">
            <td class="p-3 text-center font-mono font-bold text-slate-500">${idx + 1}</td>
            <td class="p-3 font-mono font-black text-brandDark">
              <button onclick="openStudent360Profile('${s.id}')" class="hover:underline">${s.id}</button>
            </td>
            <td class="p-3 font-extrabold text-slate-900">
              <button onclick="openStudent360Profile('${s.id}')" class="hover:text-brandEmerald hover:underline text-left font-extrabold">${s.name}</button>
            </td>
            <td class="p-3">
              <button onclick="openFamily360Profile('${s.family_id}')" class="font-bold text-emerald-800 hover:underline text-left block">${parentName}</button>
              <div class="text-[10px] text-slate-400 font-mono">${s.family_id}</div>
            </td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded bg-emerald-50 text-brandEmerald border border-emerald-200 font-bold text-[11px]">
                ${s.course_id || 'Quran Studies'}
              </span>
            </td>
            <td class="p-3 font-bold text-slate-700">${tName}</td>
            <td class="p-3">${statusBadge}</td>
            <td class="p-3 font-mono text-[11px] text-slate-600">${s.joining_date || '--'}</td>
            <td class="p-3 text-right">
              <div class="flex items-center justify-end gap-1.5">
                ${!isStuActive && typeof toggleSingleStudentDeactivate === 'function' ? `
                  <button onclick="toggleSingleStudentDeactivate('${s.family_id}', '${s.id}')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] transition flex items-center gap-1" title="Reactivate Student">
                    <i class="fa-solid fa-rotate-left text-[10px]"></i> Reactivate
                  </button>
                ` : ''}
                <button onclick="openStudent360Profile('${s.id}')" class="px-2.5 py-1 bg-brandDark text-white rounded-lg font-bold text-[11px] hover:bg-brandDarkest transition">
                  Open Profile
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    function renderDeactivatedFamiliesView() {
      if (typeof syncAllFamilyAndStudentCountersUI === 'function') {
        syncAllFamilyAndStudentCountersUI();
      }
      const tbody = document.getElementById('deactivatedFamiliesTableBody');
      if (!tbody) return;

      const q = FAM_SEARCH_QUERY;
      const deactivatedFamilies = (ALL_FAMILIES || []).filter(f =>
        (typeof isRegularFamilyRecord === 'function' ? isRegularFamilyRecord(f) : true) &&
        (typeof isFamilyDeactivated === 'function' ? isFamilyDeactivated(f) : ['inactive', 'deactivated'].includes(String(f.status || '').toLowerCase()))
      );

      const badgeDeactTab = document.getElementById('badgeDeactivatedFamCount');
      if (badgeDeactTab) badgeDeactTab.innerText = deactivatedFamilies.length;
      const badgeDeactHeader = document.getElementById('badgeDeactivatedFamiliesHeaderCount');
      if (badgeDeactHeader) badgeDeactHeader.innerText = `${deactivatedFamilies.length} Deactivated ${deactivatedFamilies.length === 1 ? 'Family' : 'Families'}`;
      const badgeFilterDeact = document.getElementById('badgeFilterFamDeactivatedCount');
      if (badgeFilterDeact) badgeFilterDeact.innerText = deactivatedFamilies.length;

      const filtered = deactivatedFamilies.filter(f => {
        if (!q) return true;
        const name = (f.parent_name || '').toLowerCase();
        const id = (f.id || '').toLowerCase();
        const phone = (f.whatsapp || '').toLowerCase();
        const country = (f.country || '').toLowerCase();
        const childMatch = (f.students || []).some(s => (s.name || '').toLowerCase().includes(q) || (s.id || '').toLowerCase().includes(q));
        return name.includes(q) || id.includes(q) || phone.includes(q) || country.includes(q) || childMatch;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-400">${q ? 'No deactivated families match your search.' : 'No deactivated families.'}</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map((f, idx) => {
        const cleanPhone = (f.whatsapp || '').replace(/[^0-9]/g, '');
        const famStudents = f.students || [];
        const studentsBadgesHtml = famStudents.length > 0
          ? famStudents.map(s => `
              <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-rose-900 text-[11px] font-bold mr-1 mb-1">
                <span>${s.name} (${s.id})</span>
                <span class="px-1.5 py-0.2 rounded bg-rose-200/80 text-rose-950 text-[9px] font-extrabold uppercase">DEACTIVATED — Family Inactive</span>
              </div>
            `).join('')
          : '<span class="text-slate-400 italic">No students linked</span>';

        return `
          <tr class="hover:bg-rose-50/30 transition text-xs bg-slate-50/40">
            <td class="p-3 text-center lms-num-table font-bold text-slate-500">${idx + 1}</td>
            <td class="p-3 lms-num-id font-bold text-slate-700">
              <button onclick="openFamily360Profile('${f.id}')" class="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-300 hover:bg-slate-200 text-slate-800 transition">${f.id}</button>
            </td>
            <td class="p-3 font-bold text-slate-900">
              <button onclick="openFamily360Profile('${f.id}')" class="hover:text-brandEmerald hover:underline text-left font-extrabold">${f.parent_name}</button>
            </td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-extrabold uppercase tracking-wider">DEACTIVATED</span>
            </td>
            <td class="p-3 text-slate-600">${f.country || '--'}</td>
            <td class="p-3 lms-num-table">
              ${CURRENT_ROLE === 'manager' ? `
                <span class="text-slate-600 flex items-center gap-1 font-bold">
                  <i class="fa-solid fa-lock text-amber-500 text-[10px]"></i> ${maskStudentPhone(f.whatsapp)}
                </span>
              ` : `
                <a href="https://wa.me/${cleanPhone}" target="_blank" class="text-slate-600 hover:underline flex items-center gap-1">
                  <i class="fa-brands fa-whatsapp text-slate-500"></i> ${f.whatsapp || '--'}
                </a>
              `}
            </td>
            <td class="p-3">
              ${typeof formatLmsCurrencyHtml === 'function' ? formatLmsCurrencyHtml(f.monthly_fee, f.currency, 'text-[14px] text-slate-600') : `<span class="lms-num-financial text-[14px] text-slate-600">${f.currency} ${Number(f.monthly_fee || 0).toLocaleString()}</span>`}
            </td>
            <td class="p-3">${studentsBadgesHtml}</td>
            <td class="p-3 text-right">
              <div class="flex items-center justify-end gap-1.5">
                <button onclick="openFamily360Profile('${f.id}')" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-950 text-white rounded-lg font-bold text-[11px] transition" title="View complete intact historical records">
                  Family 360°
                </button>
                <button onclick="handleFamilyLevelDeactivate('${f.id}')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] transition flex items-center gap-1" title="Reactivate Family Account">
                  <i class="fa-solid fa-rotate-left text-[10px]"></i> Reactivate
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }


