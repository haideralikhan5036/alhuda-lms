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
      const stored = localStorage.getItem('alhuda_parent_accounts') || localStorage.getItem('bqi_parent_accounts');
      return JSON.parse(stored || '{}');
    }

    function saveParentAccount(famId, creds) {
      const accounts = getParentAccounts();
      accounts[famId] = { ...(accounts[famId] || {}), ...creds };
      localStorage.setItem('alhuda_parent_accounts', JSON.stringify(accounts));
    }

    function getParentCreds(family) {
      const accounts = getParentAccounts();
      if (accounts[family.id]) return accounts[family.id];
      const baseUser = (family.parent_name || 'parent').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 15) || 'parent';
      const defaultCred = {
        username: 'parent_' + baseUser,
        password: 'alhuda_' + Math.floor(100 + Math.random() * 900),
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
        famSelect.innerHTML = (ALL_FAMILIES || []).map(f => `
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
        teacherSelect.innerHTML = (ALL_TEACHERS || []).map(t => {
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
        alert("Please enter Parent / Guardian Name.");
        btn.disabled = false;
        btn.innerText = 'Save Family & Generate LMS Account';
        return;
      }
      if (!whatsapp) {
        alert("Please enter WhatsApp Contact Number.");
        btn.disabled = false;
        btn.innerText = 'Save Family & Generate LMS Account';
        return;
      }
      if (!username || !password) {
        alert("Parent Portal Username and Password are required.");
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
      await loadFamiliesAndStudents();
      loadFeeBillingLedger();

      alert(`✅ Family Registered Successfully!\n\n👨‍👩‍👧 Family ID: ${id}\n👤 Parent Name: ${parent_name}\n🌍 Location: ${city ? city + ', ' : ''}${country}\n💰 Agreed Fee: ${currency} ${monthly_fee}\n\n🔑 Parent Portal Login Credentials:\nUsername: ${username}\nPassword: ${password}\n\nParent can now log in to track children classes.`);
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
        alert("Please enter Student Full Name.");
        btn.disabled = false;
        btn.innerText = 'Enroll Student';
        return;
      }

      if (!family_id) {
        alert("Please select Family / Parent.");
        btn.disabled = false;
        btn.innerText = 'Enroll Student';
        return;
      }

      const notesMeta = JSON.stringify({ language, days_per_week });

      await db.from('students').insert([{
        id, family_id, name, age, gender, course_id, assigned_teacher_id, joining_date, notes: notesMeta, status: 'Active'
      }]);

      // Cache student profile in localStorage
      const profiles = JSON.parse(localStorage.getItem('alhuda_student_profiles') || '{}');
      profiles[id] = { id, family_id, name, age, gender, language, joining_date, course_id, days_per_week, assigned_teacher_id };
      localStorage.setItem('alhuda_student_profiles', JSON.stringify(profiles));

      btn.disabled = false;
      btn.innerText = 'Enroll Student';
      closeModal('modalAddStudent');
      await loadFamiliesAndStudents();

      const assignedTeacher = ALL_TEACHERS.find(t => t.id === assigned_teacher_id);
      const tName = assignedTeacher ? assignedTeacher.full_name : 'Assigned Teacher';

      alert(`✅ Student Enrolled Successfully!\n\n🎓 Student: ${name} (${id})\n👨‍👩‍👧 Linked Family: ${family_id}\n📚 Course: ${course_id}\n📅 Days Preference: ${days_per_week}\n🗓️ Joining Date: ${joining_date}\n👨‍🏫 Assigned Teacher: ${tName}\n\nStudent is now in Teacher's Student List. You can open Teacher's 2D Schedule to book timetable slots.`);
    }

    function copyParentCredentials(user, pass) {
      const txt = `Al-Huda LMS Parent Portal\nUsername: ${user}\nPassword: ${pass}`;
      navigator.clipboard.writeText(txt);
      alert(`Copied to clipboard!\n\n${txt}`);
    }

    let CURRENT_FAMILIES_VIEW = 'cards';
    let FAM_SEARCH_QUERY = '';

    function switchFamiliesViewMode(mode) {
      CURRENT_FAMILIES_VIEW = mode;
      const btnCards = document.getElementById('btnViewFamCards');
      const btnTable = document.getElementById('btnViewFamTable');
      const btnStudents = document.getElementById('btnViewStudentsList');

      const secCards = document.getElementById('familiesCardsContainer');
      const secTable = document.getElementById('familiesTableContainer');
      const secStudents = document.getElementById('studentsListContainer');

      [btnCards, btnTable, btnStudents].forEach(b => {
        if (b) b.className = 'px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition font-bold';
      });

      if (mode === 'cards') {
        if (btnCards) btnCards.className = 'px-3 py-1.5 rounded-lg bg-white text-slate-900 shadow-2xs flex items-center gap-1.5 transition font-extrabold';
        if (secCards) secCards.classList.remove('hidden');
        if (secTable) secTable.classList.add('hidden');
        if (secStudents) secStudents.classList.add('hidden');
      } else if (mode === 'famTable') {
        if (btnTable) btnTable.className = 'px-3 py-1.5 rounded-lg bg-white text-slate-900 shadow-2xs flex items-center gap-1.5 transition font-extrabold';
        if (secCards) secCards.classList.add('hidden');
        if (secTable) secTable.classList.remove('hidden');
        if (secStudents) secStudents.classList.add('hidden');
        renderFamiliesMasterTable();
      } else if (mode === 'studentsList') {
        if (btnStudents) btnStudents.className = 'px-3 py-1.5 rounded-lg bg-white text-slate-900 shadow-2xs flex items-center gap-1.5 transition font-extrabold';
        if (secCards) secCards.classList.add('hidden');
        if (secTable) secTable.classList.add('hidden');
        if (secStudents) secStudents.classList.remove('hidden');
        renderAllStudentsListTable();
      }
    }

    function handleFamUnifiedSearch(query) {
      FAM_SEARCH_QUERY = (query || '').trim().toLowerCase();
      renderFamiliesCards();
      renderFamiliesMasterTable();
      renderAllStudentsListTable();
    }

    async function loadFamiliesAndStudents() {
      const { data: families } = await db.from('families').select('*, students(*)').order('created_at', { ascending: false });
      
      // Exclude Trial families: status='Trial' OR id starts with 'TRL-'
      const regularFamilies = (families || []).filter(f => {
        if ((f.status || '').toLowerCase() === 'trial') return false;
        if ((f.status || '').toLowerCase() === 'converted') return false;
        if ((f.id || '').toUpperCase().startsWith('TRL-')) return false;
        return true;
      });
      ALL_FAMILIES = regularFamilies;

      // Also strip any Trial students from within each regular family
      ALL_FAMILIES = ALL_FAMILIES.map(f => ({
        ...f,
        students: (f.students || []).filter(s => {
          if ((s.status || '').toLowerCase() === 'trial') return false;
          if ((s.id || '').toUpperCase().startsWith('TRL-')) return false;
          return true;
        })
      }));

      const allStu = [];
      ALL_FAMILIES.forEach(f => {
        if (f.students) allStu.push(...f.students);
      });
      ALL_STUDENTS = allStu;

      // Count trial families (for info badge in tab)
      const trialFamCount = (families || []).filter(f =>
        (f.status || '').toLowerCase() === 'trial' || (f.id || '').toUpperCase().startsWith('TRL-')
      ).length;
      const trialInfoEl = document.getElementById('trialFamiliesInfoNote');
      if (trialInfoEl) {
        if (trialFamCount > 0) {
          trialInfoEl.innerHTML = `<i class="fa-solid fa-circle-info text-purple-500"></i> <span class="text-purple-800 font-bold">${trialFamCount} Trial Entr${trialFamCount === 1 ? 'y' : 'ies'} not shown here</span> — <button onclick="switchTab('tab-trials')" class="underline text-purple-700 font-extrabold hover:text-purple-900">View in Trial Classes tab →</button>`;
          trialInfoEl.classList.remove('hidden');
        } else {
          trialInfoEl.innerHTML = '';
          trialInfoEl.classList.add('hidden');
        }
      }

      const famSelect = document.getElementById('stuFamilyId');
      if (famSelect) {
        famSelect.innerHTML = regularFamilies.map(f => `<option value="${f.id}">${f.parent_name} (${f.id} &bull; ${f.country})</option>`).join('');
      }

      // Update Summary Badges
      const totalFams = regularFamilies.length;
      const activeFams = regularFamilies.filter(f => (f.status || 'Active').toLowerCase() === 'active').length;
      const totalStus = allStu.length;
      const activeStus = allStu.filter(s => {
        const st = (s.status || 'Active').toLowerCase();
        return st === 'active' || st === 'regular';
      }).length;

      const setFVal = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      setFVal('famSummaryTotalFamilies', totalFams);
      setFVal('famSummaryActiveFamilies', activeFams);
      setFVal('famSummaryTotalStudents', totalStus);
      setFVal('famSummaryActiveStudents', activeStus);
      setFVal('badgeFamTableCount', `${totalFams} Families`);
      setFVal('badgeStudentsListCount', `${totalStus} Students`);

      renderFamiliesCards();
      renderFamiliesMasterTable();
      renderAllStudentsListTable();
    }

    function renderFamiliesCards() {
      const container = document.getElementById('familiesCardsContainer');
      if (!container) return;

      const q = FAM_SEARCH_QUERY;
      const filtered = (ALL_FAMILIES || []).filter(f => {
        if (!q) return true;
        const name = (f.parent_name || '').toLowerCase();
        const id = (f.id || '').toLowerCase();
        const phone = (f.whatsapp || '').toLowerCase();
        const country = (f.country || '').toLowerCase();
        const childMatch = (f.students || []).some(s => (s.name || '').toLowerCase().includes(q) || (s.id || '').toLowerCase().includes(q));
        return name.includes(q) || id.includes(q) || phone.includes(q) || country.includes(q) || childMatch;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div class="col-span-full p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-400">No families match the search criteria.</div>';
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

        return `
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between">
            <div>
              <!-- Family Header with Sequential Number and ID -->
              <div class="flex justify-between items-start border-b pb-3 mb-3">
                <div class="flex items-center gap-3">
                  <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-100 to-amber-100 border border-emerald-300 text-brandDark flex items-center justify-center font-black text-base shadow-xs">
                    <i class="fa-solid fa-house-user text-brandEmerald"></i>
                  </div>
                  <div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-[10px] font-mono px-2 py-0.5 bg-slate-900 text-white rounded font-black">#${fIdx + 1}</span>
                      <span class="text-[10px] font-mono px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-extrabold">${f.id}</span>
                      <span class="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-bold">${f.country}</span>
                    </div>
                    <h4 class="font-extrabold text-base text-slate-900 mt-0.5">${f.parent_name}</h4>
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
                <div class="text-right">
                  <span class="font-black text-base text-brandDark block leading-none">${f.currency} ${f.monthly_fee}</span>
                  <span class="text-[10px] text-slate-400 font-semibold">Monthly Agreed</span>
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

                      return `
                        <div class="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-white text-xs transition space-y-1">
                          <div class="flex justify-between items-start">
                            <div class="flex items-center gap-1.5">
                              <span class="font-bold text-slate-900">${s.name}</span>
                              <span class="text-[9px] font-mono px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded font-bold">${s.id}</span>
                            </div>
                            <button onclick="openStudentDetailModal('${s.id}')" class="text-brandEmerald hover:text-brandDark font-bold text-[10px] flex items-center gap-1">
                              View <i class="fa-solid fa-chevron-right text-[8px]"></i>
                            </button>
                          </div>
                          <div class="flex justify-between text-[10px] text-slate-500">
                            <span>${s.course_id || 'Quran Reading'}</span>
                            <span>${joinStr}</span>
                          </div>
                          <div class="text-[10px] text-slate-600 flex items-center gap-1">
                            <i class="fa-solid fa-chalkboard-user text-brandEmerald"></i>
                            <strong>Teacher:</strong> <span class="text-brandDark font-semibold">${tName}</span>
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                `}
              </div>
            </div>

            <!-- Card Bottom Action -->
            <div class="pt-3 border-t mt-3 flex justify-end">
              <button onclick="prepareAddStudentModal('${f.id}')" class="w-full py-2 bg-emerald-50 hover:bg-emerald-100 text-brandEmerald font-bold rounded-xl text-xs border border-emerald-200 flex items-center justify-center gap-1.5 transition">
                <i class="fa-solid fa-plus"></i> Enroll Another Sibling to this Family
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
      const filtered = (ALL_FAMILIES || []).filter(f => {
        if (!q) return true;
        const name = (f.parent_name || '').toLowerCase();
        const id = (f.id || '').toLowerCase();
        const phone = (f.whatsapp || '').toLowerCase();
        const country = (f.country || '').toLowerCase();
        return name.includes(q) || id.includes(q) || phone.includes(q) || country.includes(q);
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-slate-400">No families found matching search.</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map((f, idx) => {
        const creds = getParentCreds(f);
        const cleanPhone = (f.whatsapp || '').replace(/[^0-9]/g, '');
        const childrenCount = (f.students || []).length;

        return `
          <tr class="hover:bg-slate-50 transition text-xs">
            <td class="p-3 text-center font-mono font-bold text-slate-500">${idx + 1}</td>
            <td class="p-3 font-mono font-black text-brandDark">${f.id}</td>
            <td class="p-3 font-bold text-slate-900">${f.parent_name}</td>
            <td class="p-3 text-slate-600">${f.country || '--'}</td>
            <td class="p-3 font-mono">
              ${CURRENT_ROLE === 'manager' ? `
                <span class="text-slate-600 flex items-center gap-1 font-bold" title="Protected Contact for Manager">
                  <i class="fa-solid fa-lock text-amber-500 text-[10px]"></i> ${maskStudentPhone(f.whatsapp)}
                </span>
              ` : `
                <a href="https://wa.me/${cleanPhone}" target="_blank" class="text-emerald-700 hover:underline flex items-center gap-1">
                  <i class="fa-brands fa-whatsapp text-emerald-600"></i> ${f.whatsapp || '--'}
                </a>
              `}
            </td>
            <td class="p-3 font-mono font-extrabold text-brandEmerald">${f.currency} ${f.monthly_fee}</td>
            <td class="p-3 font-bold text-slate-700">
              <span class="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-xs">${childrenCount} Sibling(s)</span>
            </td>
            <td class="p-3 font-mono text-[11px]">
              <span class="text-slate-500">U:</span> <strong>${creds.username}</strong>
            </td>
            <td class="p-3 text-right">
              <div class="flex items-center justify-end gap-1.5">
                <button onclick="prepareAddStudentModal('${f.id}')" class="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-brandEmerald rounded-lg font-bold text-[11px] border border-emerald-200 transition">
                  + Add Child
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

      const q = FAM_SEARCH_QUERY;
      const filtered = (ALL_STUDENTS || []).filter(s => {
        if (!q) return true;
        const name = (s.name || '').toLowerCase();
        const id = (s.id || '').toLowerCase();
        const famId = (s.family_id || '').toLowerCase();
        const course = (s.course_id || '').toLowerCase();
        return name.includes(q) || id.includes(q) || famId.includes(q) || course.includes(q);
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-slate-400">No students found matching search.</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map((s, idx) => {
        const parentFam = (ALL_FAMILIES || []).find(f => f.id === s.family_id);
        const parentName = parentFam ? parentFam.parent_name : (s.family_id || '--');
        const assignedTeacher = (ALL_TEACHERS || []).find(t => t.id === s.assigned_teacher_id);
        const tName = assignedTeacher ? assignedTeacher.full_name : '<span class="text-slate-400 italic">Not Assigned</span>';
        const status = s.status || 'Active';

        let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200">Active</span>';
        if (status.toLowerCase() === 'leave') {
          statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-200">On Leave</span>';
        } else if (status.toLowerCase() === 'inactive' || status.toLowerCase() === 'deactivated') {
          statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200">Inactive</span>';
        }

        return `
          <tr class="hover:bg-slate-50 transition text-xs">
            <td class="p-3 text-center font-mono font-bold text-slate-500">${idx + 1}</td>
            <td class="p-3 font-mono font-black text-brandDark">${s.id}</td>
            <td class="p-3 font-extrabold text-slate-900">${s.name}</td>
            <td class="p-3">
              <span class="font-bold text-slate-800">${parentName}</span>
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
              <button onclick="openStudentDetailModal('${s.id}')" class="px-2.5 py-1 bg-brandDark text-white rounded-lg font-bold text-[11px] hover:bg-brandDarkest transition">
                View Profile
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

