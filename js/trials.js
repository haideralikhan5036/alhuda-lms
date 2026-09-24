/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/trials.js
 * Purpose: 3-Day Trial Classes Pipeline, Teacher Conversion Scorecard & Regular Admission Conversion
 * Extracted Line Range: 13568 – 14664 (1097 lines)
 * ============================================================================
 */

    // ==========================================
    // TRIAL CLASSES MANAGEMENT & 3-DAY EVALUATION
    // ==========================================

    function getStoredTrials() {
      try {
        return JSON.parse(localStorage.getItem('alhuda_trial_classes') || '[]');
      } catch (e) {
        return [];
      }
    }

    function saveStoredTrials(trials) {
      try {
        localStorage.setItem('alhuda_trial_classes', JSON.stringify(trials));
      } catch (e) {
        console.error("Error saving trials to localStorage:", e);
      }
    }

    async function loadTrialClassesData() {
      try {
        let storedTrials = getStoredTrials();

        // 1. Fetch trials from Supabase students table (both 'Trial' and 'Converted')
        try {
          const { data: supaTrials, error } = await db.from('students')
            .select('*, families(*), teachers(*)')
            .in('status', ['Trial', 'Converted']);

          if (!error && supaTrials && supaTrials.length > 0) {
            supaTrials.forEach(st => {
              const exists = storedTrials.find(t => t.student_id === st.id || t.id === st.id || t.id === 'TRL-' + String(st.id).replace(/[^0-9]/g, ''));
              let parsedNotes = {};
              try {
                parsedNotes = JSON.parse(st.notes || '{}');
              } catch(e){}

              const isSupabaseConverted = st.status === 'Converted' || parsedNotes.converted_to_student_id;
              const effectiveStatus = isSupabaseConverted ? 'Converted' : (parsedNotes.trial_status || 'Active');

              if (!exists) {
                storedTrials.unshift({
                  id: 'TRL-' + String(st.id).replace(/[^0-9]/g, ''),
                  student_id: st.id,
                  family_id: st.family_id,
                  student_name: st.name,
                  student_age: st.age,
                  student_gender: st.gender,
                  parent_name: st.families?.parent_name || 'Guardian',
                  whatsapp: st.families?.whatsapp || '',
                  country: st.families?.country || 'International',
                  timezone: st.families?.timezone || 'UTC',
                  course: parsedNotes.trial_course || 'Noorani Qaida & Basic Arabic',
                  teacher_id: st.assigned_teacher_id,
                  teacher_name: st.teachers?.full_name || 'Assigned Teacher',
                  start_date: st.joining_date || new Date().toISOString().slice(0, 10),
                  pkt_slot: parsedNotes.pkt_slot || '16:00 - 16:30',
                  student_time: parsedNotes.student_time || '',
                  meeting_link: parsedNotes.meeting_link || '',
                  conducted_sessions: isSupabaseConverted ? 3 : 0,
                  status: effectiveStatus,
                  converted_student_id: parsedNotes.converted_to_student_id || null,
                  created_at: st.created_at || new Date().toISOString()
                });
              } else {
                if (isSupabaseConverted) {
                  exists.status = 'Converted';
                  if (parsedNotes.converted_to_student_id) exists.converted_student_id = parsedNotes.converted_to_student_id;
                }
              }
            });
          }
        } catch(err) {
          console.warn("Could not query Supabase trial students:", err);
        }

        // 2. Fetch attendance logs to sync conducted sessions
        try {
          const { data: attLogs } = await db.from('attendance_logs').select('student_id, status, lesson_notes');
          if (attLogs && attLogs.length > 0) {
            storedTrials.forEach(trial => {
              const stuLogs = attLogs.filter(l => l.student_id === trial.student_id && (l.status === 'Present' || l.status === 'Completed'));
              if (stuLogs.length > (trial.conducted_sessions || 0)) {
                trial.conducted_sessions = Math.min(3, stuLogs.length);
                if (trial.conducted_sessions >= 3 && trial.status === 'Active') {
                  trial.status = 'Completed';
                }
              }
            });
          }
        } catch(err) {
          console.warn("Could not query trial attendance logs:", err);
        }

        ALL_TRIALS = storedTrials;
        saveStoredTrials(ALL_TRIALS);

        // 3. Populate Teacher Filter Dropdown
        populateTrialTeacherDropdown();

        // 4. Update KPI summary cards
        updateTrialKpis();

        // 5. Render Scorecard & Trial Cards
        renderTeacherPerformanceBanner(CURRENT_TRIAL_TEACHER_FILTER);
        renderTrialCards(CURRENT_TRIAL_FILTER);

      } catch(e) {
        console.error("Error loading trial classes data:", e);
      }
    }

    function populateTrialTeacherDropdown() {
      const select = document.getElementById('trialTeacherFilter');
      if (!select) return;

      const currentVal = CURRENT_TRIAL_TEACHER_FILTER || 'all';

      // Count trials per teacher
      const counts = {};
      (ALL_TRIALS || []).forEach(tr => {
        if (tr.teacher_id) {
          counts[tr.teacher_id] = (counts[tr.teacher_id] || 0) + 1;
        }
      });

      let html = `<option value="all">👨‍🏫 All Quran Instructors (${ALL_TRIALS.length})</option>`;
      (ALL_TEACHERS || []).forEach(t => {
        const count = counts[t.id] || 0;
        const isSelected = t.id === currentVal ? 'selected' : '';
        html += `<option value="${t.id}" ${isSelected}>${t.full_name} (${count} Trials)</option>`;
      });

      select.innerHTML = html;
    }

    function filterTrialsByTeacher(teacherId) {
      CURRENT_TRIAL_TEACHER_FILTER = teacherId || 'all';
      updateTrialKpis();
      renderTeacherPerformanceBanner(CURRENT_TRIAL_TEACHER_FILTER);
      renderTrialCards(CURRENT_TRIAL_FILTER);
    }

    function viewTeacherTrialsHistory(teacherId) {
      switchTab('tab-trials');
      CURRENT_TRIAL_TEACHER_FILTER = teacherId;
      const select = document.getElementById('trialTeacherFilter');
      if (select) select.value = teacherId;
      updateTrialKpis();
      renderTeacherPerformanceBanner(teacherId);
      renderTrialCards(CURRENT_TRIAL_FILTER);
      const banner = document.getElementById('trialTeacherPerformanceBanner');
      if (banner) banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderTeacherPerformanceBanner(teacherId) {
      const banner = document.getElementById('trialTeacherPerformanceBanner');
      if (!banner) return;

      if (!teacherId || teacherId === 'all') {
        banner.classList.add('hidden');
        banner.innerHTML = '';
        return;
      }

      const teacher = ALL_TEACHERS.find(t => t.id === teacherId);
      const teacherName = teacher ? teacher.full_name : 'Selected Instructor';
      const teacherShift = teacher?.working_shift || 'Standard Shift';

      const teacherTrials = (ALL_TRIALS || []).filter(t => t.teacher_id === teacherId);
      const totalTr = teacherTrials.length;
      const convTr = teacherTrials.filter(t => t.status === 'Converted').length;
      const discTr = teacherTrials.filter(t => t.status === 'Discontinued').length;
      const activeTr = teacherTrials.filter(t => t.status !== 'Converted' && t.status !== 'Discontinued').length;
      const decidedTr = convTr + discTr;
      const convRate = decidedTr > 0 ? Math.round((convTr / decidedTr) * 100) : (totalTr > 0 ? 0 : 0);

      let ratingBadge = '';
      let barColor = 'bg-emerald-500';
      if (convRate >= 70) {
        ratingBadge = `<span class="px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5 shadow-xs"><i class="fa-solid fa-crown text-amber-500"></i> Top Performer (${convRate}%)</span>`;
        barColor = 'bg-emerald-500';
      } else if (convRate >= 50) {
        ratingBadge = `<span class="px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1.5 shadow-xs"><i class="fa-solid fa-thumbs-up text-amber-600"></i> Standard Performer (${convRate}%)</span>`;
        barColor = 'bg-amber-500';
      } else {
        ratingBadge = `<span class="px-3 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1.5 shadow-xs"><i class="fa-solid fa-triangle-exclamation text-rose-600"></i> Under Review (${convRate}%)</span>`;
        barColor = 'bg-rose-500';
      }

      banner.classList.remove('hidden');
      banner.innerHTML = `
        <div class="bg-gradient-to-r from-purple-950 via-indigo-950 to-slate-900 rounded-2xl p-5 text-white shadow-md border border-purple-800/60 space-y-4">
          <div class="flex flex-wrap justify-between items-start gap-3">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-purple-700/60 border border-purple-400/40 flex items-center justify-center font-black text-lg text-white shadow-inner">
                ${teacherName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="font-black text-lg text-white">${teacherName}</h3>
                  <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-800/80 text-purple-200 border border-purple-600/40">${teacherShift}</span>
                </div>
                <p class="text-xs text-purple-200/80">Evaluation Performance, Conversion Success & Dead Leads Track</p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              ${ratingBadge}
              <button onclick="filterTrialsByTeacher('all'); document.getElementById('trialTeacherFilter').value = 'all';" class="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition flex items-center gap-1">
                <i class="fa-solid fa-xmark"></i> Show All Teachers
              </button>
            </div>
          </div>

          <!-- 4 Metric Cards -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div class="bg-white/10 backdrop-blur-xs p-3 rounded-xl border border-white/10">
              <span class="text-[10px] font-bold text-purple-300 uppercase tracking-wider block">Assigned Trials</span>
              <div class="text-2xl font-black text-white mt-0.5">${totalTr}</div>
              <span class="text-[10px] text-purple-200/70">Total Leads Given</span>
            </div>
            <div class="bg-emerald-950/50 backdrop-blur-xs p-3 rounded-xl border border-emerald-500/30">
              <span class="text-[10px] font-bold text-emerald-300 uppercase tracking-wider block">Converted Regular</span>
              <div class="text-2xl font-black text-emerald-400 mt-0.5">${convTr}</div>
              <span class="text-[10px] text-emerald-200/70">Successful Admissions</span>
            </div>
            <div class="bg-rose-950/50 backdrop-blur-xs p-3 rounded-xl border border-rose-500/30">
              <span class="text-[10px] font-bold text-rose-300 uppercase tracking-wider block">Dead / Dropped</span>
              <div class="text-2xl font-black text-rose-400 mt-0.5">${discTr}</div>
              <span class="text-[10px] text-rose-200/70">Lost Opportunities</span>
            </div>
            <div class="bg-purple-950/50 backdrop-blur-xs p-3 rounded-xl border border-purple-500/30">
              <span class="text-[10px] font-bold text-purple-300 uppercase tracking-wider block">Active In-Progress</span>
              <div class="text-2xl font-black text-purple-300 mt-0.5">${activeTr}</div>
              <span class="text-[10px] text-purple-200/70">Day 1-3 Sessions</span>
            </div>
          </div>

          <!-- Conversion Ratio Bar -->
          <div class="space-y-1">
            <div class="flex justify-between items-center text-xs font-bold">
              <span class="text-purple-200 text-[11px]">Trial-to-Regular Conversion Success Ratio</span>
              <span class="text-white font-extrabold text-sm">${convRate}% Conversion (${convTr} of ${decidedTr || totalTr} decided)</span>
            </div>
            <div class="w-full bg-white/20 rounded-full h-3 overflow-hidden p-0.5">
              <div class="${barColor} h-full rounded-full transition-all duration-700" style="width: ${Math.max(5, convRate)}%"></div>
            </div>
          </div>
        </div>
      `;
    }

    function updateTrialKpis() {
      let pool = ALL_TRIALS;
      if (CURRENT_TRIAL_TEACHER_FILTER && CURRENT_TRIAL_TEACHER_FILTER !== 'all') {
        pool = ALL_TRIALS.filter(t => t.teacher_id === CURRENT_TRIAL_TEACHER_FILTER);
      }

      const activeCount = pool.filter(t => t.status === 'Active' || (t.status !== 'Converted' && t.status !== 'Discontinued' && (t.conducted_sessions || 0) < 3)).length;
      const completedCount = pool.filter(t => t.status === 'Completed' || (t.status !== 'Converted' && t.status !== 'Discontinued' && (t.conducted_sessions || 0) >= 3)).length;
      const convertedCount = pool.filter(t => t.status === 'Converted').length;
      const totalCount = pool.length;

      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      setEl('trialsKpiActive', activeCount);
      setEl('trialsKpiCompleted', completedCount);
      setEl('trialsKpiConverted', convertedCount);
      setEl('trialsKpiTotal', totalCount);

      const teacher = ALL_TEACHERS.find(t => t.id === CURRENT_TRIAL_TEACHER_FILTER);
      const label = teacher ? `${teacher.full_name}: ${totalCount} Trials` : `${totalCount} Enquiries`;
      setEl('trialTotalHeaderBadge', label);
    }

    function filterTrialCards(filter) {
      CURRENT_TRIAL_FILTER = filter;
      document.querySelectorAll('.trial-filter-pill').forEach(btn => {
        btn.classList.remove('bg-purple-700', 'text-white', 'shadow-xs');
        btn.classList.add('text-slate-600');
      });
      const activeBtn = document.getElementById(`trialTab-${filter}`);
      if (activeBtn) {
        activeBtn.classList.add('bg-purple-700', 'text-white', 'shadow-xs');
        activeBtn.classList.remove('text-slate-600');
      }
      renderTrialCards(filter);
    }

    function handleTrialSearch(query) {
      renderTrialCards(CURRENT_TRIAL_FILTER, query);
    }

    function renderTrialCards(filter = 'all', searchQuery = '') {
      const container = document.getElementById('trialsListContainer');
      const emptyState = document.getElementById('trialsEmptyState');
      if (!container) return;

      const query = (searchQuery || document.getElementById('trialSearchInput')?.value || '').trim().toLowerCase();

      let filtered = ALL_TRIALS.filter(t => {
        if (filter === 'active') {
          return (t.status === 'Active' || !t.status) && (t.conducted_sessions || 0) < 3;
        }
        if (filter === 'completed') {
          return t.status === 'Completed' || (t.status !== 'Converted' && t.status !== 'Discontinued' && (t.conducted_sessions || 0) >= 3);
        }
        if (filter === 'converted') {
          return t.status === 'Converted';
        }
        if (filter === 'discontinued') {
          return t.status === 'Discontinued';
        }
        return true;
      });

      // Filter by Teacher
      if (CURRENT_TRIAL_TEACHER_FILTER && CURRENT_TRIAL_TEACHER_FILTER !== 'all') {
        filtered = filtered.filter(t => t.teacher_id === CURRENT_TRIAL_TEACHER_FILTER);
      }

      if (query) {
        filtered = filtered.filter(t => 
          (t.student_name || '').toLowerCase().includes(query) ||
          (t.parent_name || '').toLowerCase().includes(query) ||
          (t.whatsapp || '').includes(query) ||
          (t.course || '').toLowerCase().includes(query) ||
          (t.country || '').toLowerCase().includes(query) ||
          (t.teacher_name || '').toLowerCase().includes(query)
        );
      }

      if (filtered.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
      }

      if (emptyState) emptyState.classList.add('hidden');

      container.innerHTML = filtered.map(t => {
        const teacher = ALL_TEACHERS.find(tch => tch.id === t.teacher_id);
        const teacherName = teacher ? teacher.full_name : (t.teacher_name || 'Assigned Instructor');
        const cleanPhone = (t.whatsapp || '').replace(/[^0-9]/g, '');

        const conducted = t.conducted_sessions || 0;
        const isReadyToConvert = conducted >= 3 && t.status !== 'Converted';
        const isConverted = t.status === 'Converted';
        const isDiscontinued = t.status === 'Discontinued';

        let statusBadge = '';
        if (isConverted) {
          statusBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
            <i class="fa-solid fa-circle-check"></i> Regular (${t.converted_student_id || 'Active'})
          </span>`;
        } else if (isDiscontinued) {
          statusBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
            <i class="fa-solid fa-circle-xmark"></i> Discontinued
          </span>`;
        } else if (isReadyToConvert) {
          statusBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1 animate-pulse">
            <i class="fa-solid fa-star text-amber-500"></i> Ready to Convert (3/3)
          </span>`;
        } else {
          statusBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-purple-100 text-purple-800 border border-purple-300 flex items-center gap-1">
            <i class="fa-solid fa-clock"></i> Day ${conducted + 1} of 3
          </span>`;
        }

        const dayPills = [1, 2, 3].map(d => {
          const isDone = conducted >= d;
          const isCurrent = conducted === d - 1 && !isDone && !isConverted && !isDiscontinued;
          if (isDone) {
            return `<button onclick="toggleTrialSession('${t.id}', ${d})" title="Day ${d} Completed (Click to toggle)" class="flex-1 py-1 px-1.5 rounded-lg bg-emerald-600 text-white font-black text-[10px] flex items-center justify-center gap-1 shadow-xs hover:bg-emerald-700 transition">
              <i class="fa-solid fa-check text-[9px]"></i> Day ${d}
            </button>`;
          } else if (isCurrent) {
            return `<button onclick="toggleTrialSession('${t.id}', ${d})" title="Click to Mark Day ${d} Completed" class="flex-1 py-1 px-1.5 rounded-lg bg-purple-100 text-purple-800 border-2 border-purple-600 font-black text-[10px] flex items-center justify-center gap-1 hover:bg-purple-200 transition">
              <i class="fa-regular fa-circle text-[9px]"></i> Day ${d}
            </button>`;
          } else {
            return `<button onclick="toggleTrialSession('${t.id}', ${d})" title="Click to Mark Day ${d} Completed" class="flex-1 py-1 px-1.5 rounded-lg bg-slate-100 text-slate-400 font-bold text-[10px] flex items-center justify-center gap-1 hover:bg-slate-200 transition">
              Day ${d}
            </button>`;
          }
        }).join('');

        const waText = encodeURIComponent(
          `Assalam-o-Alaikum Respected ${t.parent_name},\n` +
          `This is a message from *Al-Huda Islamic Centre* regarding the 3-Day Free Trial Class for *${t.student_name}*.\n\n` +
          `📖 *Course:* ${t.course}\n` +
          `👨‍🏫 *Quran Instructor:* ${teacherName}\n` +
          `⏰ *Class Time:* ${t.pkt_slot} PKT${t.student_time ? ' (' + t.student_time + ')' : ''}\n` +
          (t.meeting_link ? `🔗 *Class Link:* ${t.meeting_link}\n\n` : '\n') +
          `JazakAllahu Khairan!`
        );
        const waLink = cleanPhone ? `https://wa.me/${cleanPhone}?text=${waText}` : '#';

        return `
          <div class="bg-white rounded-2xl border ${isReadyToConvert ? 'border-amber-400 ring-2 ring-amber-200' : isConverted ? 'border-emerald-200' : 'border-purple-200'} p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4">
            
            <div>
              <div class="flex justify-between items-start gap-2 mb-2">
                <div>
                  <span class="text-[10px] font-mono font-bold text-purple-700 uppercase tracking-wide block">
                    ID: ${t.student_id || t.id}
                  </span>
                  <h3 class="font-extrabold text-base text-slate-900 leading-tight">
                    ${t.student_name}
                  </h3>
                  <span class="text-xs text-slate-500 font-medium">
                    ${t.student_age} yrs • ${t.student_gender || 'Child'}
                  </span>
                </div>
                ${statusBadge}
              </div>

              <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 text-purple-900 font-bold text-xs border border-purple-200 mb-3">
                <i class="fa-solid fa-book-quran text-purple-600"></i>
                <span>${t.course}</span>
              </div>

              <div class="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 mb-3">
                <div class="flex items-center justify-between">
                  <span class="text-slate-400 font-medium text-[11px]"><i class="fa-solid fa-user text-slate-400"></i> Parent:</span>
                  <span class="font-bold text-slate-800">${t.parent_name}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-slate-400 font-medium text-[11px]"><i class="fa-brands fa-whatsapp text-emerald-600"></i> WhatsApp:</span>
                  ${CURRENT_ROLE === 'manager' ? `
                    <span class="font-mono font-bold text-slate-600 flex items-center gap-1" title="Protected Student Contact">
                      <i class="fa-solid fa-lock text-amber-500 text-[10px]"></i> ${maskStudentPhone(t.whatsapp)}
                    </span>
                  ` : `
                    <a href="${waLink}" target="_blank" class="font-mono font-bold text-emerald-700 hover:underline flex items-center gap-1">
                      ${t.whatsapp} <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                    </a>
                  `}
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-slate-400 font-medium text-[11px]"><i class="fa-solid fa-earth-americas text-blue-500"></i> Location:</span>
                  <span class="font-bold text-slate-700">${t.country} (${t.timezone ? (t.timezone.split('/')[1] || t.timezone) : 'UTC'})</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-slate-400 font-medium text-[11px]"><i class="fa-solid fa-chalkboard-user text-purple-600"></i> Teacher:</span>
                  <span class="font-bold text-brandDark">${teacherName}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-slate-400 font-medium text-[11px]"><i class="fa-solid fa-clock text-amber-500"></i> Timetable:</span>
                  <span class="font-mono font-bold text-purple-900">${t.pkt_slot} PKT</span>
                </div>
                ${t.student_time ? `
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="text-slate-400">Student Local:</span>
                    <span class="font-bold text-slate-700">${t.student_time}</span>
                  </div>
                ` : ''}
              </div>

              <div>
                <div class="flex justify-between items-center text-[10px] font-extrabold uppercase tracking-wide text-slate-500 mb-1.5">
                  <span>3-Day Free Evaluation Progress</span>
                  <span class="${conducted >= 3 ? 'text-amber-700 font-black' : 'text-purple-700'}">
                    ${conducted}/3 Sessions Logged
                  </span>
                </div>
                <div class="flex gap-1.5">
                  ${dayPills}
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-slate-100 flex flex-col gap-2">
              ${!isConverted ? `
                <button onclick="openConvertTrialModal('${t.id}')" class="w-full py-2.5 px-3 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-xl text-xs font-black shadow-sm flex items-center justify-center gap-1.5 transition">
                  <i class="fa-solid fa-user-check"></i> Convert to Regular Student
                </button>
              ` : `
                <div class="w-full py-2 px-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-black text-center border border-emerald-200">
                  <i class="fa-solid fa-circle-check"></i> Enrolled: ${t.converted_student_id || 'Active'} (${t.agreed_fee || 'Regular'})
                </div>
              `}

              <div class="flex items-center justify-between gap-1.5">
                ${CURRENT_ROLE !== 'manager' ? `
                  <a href="${waLink}" target="_blank" class="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 rounded-lg text-[11px] font-bold text-center transition flex items-center justify-center gap-1">
                    <i class="fa-brands fa-whatsapp text-emerald-600"></i> WhatsApp
                  </a>
                ` : `
                  <span class="flex-1 py-1.5 px-2 bg-amber-50 text-amber-800 rounded-lg text-[10px] font-bold text-center border border-amber-200 flex items-center justify-center gap-1" title="Protected Contact for Manager">
                    <i class="fa-solid fa-shield-halved text-amber-600"></i> Protected
                  </span>
                `}

                <button onclick="openTrialEmailModal('${t.id}')" title="Send Official Welcome & Zoom Link Email from ceoislamiccentre@gmail.com" class="flex-1 py-1.5 px-2 bg-purple-50 hover:bg-purple-100 hover:text-purple-800 text-purple-700 rounded-lg text-[11px] font-bold text-center transition flex items-center justify-center gap-1 border border-purple-200">
                  <i class="fa-solid fa-envelope text-purple-600"></i> Send Email
                </button>

                ${t.meeting_link ? `
                  <a href="${t.meeting_link}" target="_blank" class="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 rounded-lg text-[11px] font-bold text-center transition flex items-center justify-center gap-1">
                    <i class="fa-solid fa-video text-blue-600"></i> Class Link
                  </a>
                ` : ''}

                ${CURRENT_ROLE !== 'manager' ? `
                  <button onclick="deleteTrial('${t.id}')" title="Discontinue / Remove Trial" class="py-1.5 px-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition">
                    <i class="fa-regular fa-trash-can"></i>
                  </button>
                ` : ''}
              </div>
            </div>

          </div>
        `;
      }).join('');
    }

    function prepareAddTrialModal() {
      document.getElementById('trialParentName').value = '';
      document.getElementById('trialParentPhone').value = '';
      const tEmail = document.getElementById('trialEmail');
      if (tEmail) tEmail.value = '';
      const tSendEmail = document.getElementById('trialSendWelcomeEmail');
      if (tSendEmail) tSendEmail.checked = true;
      document.getElementById('trialStudentName').value = '';
      document.getElementById('trialStudentAge').value = '8';
      document.getElementById('trialStudentTime').value = '';
      document.getElementById('trialMeetingLink').value = '';

      const today = new Date().toISOString().slice(0, 10);
      document.getElementById('trialStartDate').value = today;

      // Populate teacher dropdown
      const tSelect = document.getElementById('trialTeacherSelect');
      if (tSelect) {
        if (ALL_TEACHERS && ALL_TEACHERS.length > 0) {
          tSelect.innerHTML = ALL_TEACHERS.map(t => 
            `<option value="${t.id}">${t.full_name} (${t.gender || 'Teacher'})</option>`
          ).join('');
        } else {
          tSelect.innerHTML = '<option value="">No Teachers Registered Yet</option>';
        }
      }

      // Populate 48 half-hour slots
      const slotSelect = document.getElementById('trialPktSlot');
      if (slotSelect) {
        const slots = [];
        for (let h = 0; h < 24; h++) {
          const hStr = String(h).padStart(2, '0');
          const nextHStr = String((h + 1) % 24).padStart(2, '0');
          slots.push(`${hStr}:00 - ${hStr}:30`);
          slots.push(`${hStr}:30 - ${nextHStr}:00`);
        }
        slotSelect.innerHTML = slots.map(s => {
          const isDefault = s === '16:00 - 16:30';
          return `<option value="${s}" ${isDefault ? 'selected' : ''}>${s} PKT</option>`;
        }).join('');
      }

      openModal('modalAddTrialClass');
    }

    async function handleSaveTrialClass(e) {
      e.preventDefault();
      const btn = document.getElementById('btnSaveTrial');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Booking 3-Day Free Trial...';
      }

      const parent_name = (document.getElementById('trialParentName').value || '').trim();
      const whatsapp = (document.getElementById('trialParentPhone').value || '').trim();
      const parent_email = (document.getElementById('trialEmail')?.value || '').trim();
      const auto_send_email = document.getElementById('trialSendWelcomeEmail')?.checked;
      const country = document.getElementById('trialCountry').value;
      const timezone = document.getElementById('trialTimezone').value;
      const student_name = (document.getElementById('trialStudentName').value || '').trim();
      const student_age = parseInt(document.getElementById('trialStudentAge').value) || 8;
      const student_gender = document.getElementById('trialStudentGender').value;
      const course = document.getElementById('trialCourse').value;
      const teacher_id = document.getElementById('trialTeacherSelect').value;
      const start_date = document.getElementById('trialStartDate').value;
      const pkt_slot = document.getElementById('trialPktSlot').value;
      const student_time = (document.getElementById('trialStudentTime').value || '').trim();
      const meeting_link = (document.getElementById('trialMeetingLink').value || '').trim();

      if (!parent_name || !whatsapp || !student_name || !teacher_id || !start_date || !pkt_slot) {
        alert("Please fill in all required fields.");
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Book 3-Day Free Trial';
        }
        return;
      }

      const randomSuffix = Date.now().toString().slice(-4);
      const trialFamId = `TRL-FAM-${randomSuffix}`;
      const trialStuId = `TRL-STU-${randomSuffix}`;

      // 1. Insert Family in Supabase
      try {
        await db.from('families').insert([{
          id: trialFamId,
          parent_name,
          whatsapp,
          country,
          timezone,
          monthly_fee: 0,
          currency: 'USD',
          status: 'Trial',
          notes: JSON.stringify({ is_trial: true, student_time })
        }]);
      } catch (err) {
        console.warn("Supabase family insert notice:", err);
      }

      // 2. Insert Student in Supabase
      try {
        await db.from('students').insert([{
          id: trialStuId,
          family_id: trialFamId,
          name: student_name,
          age: student_age,
          gender: student_gender,
          course_id: null,
          assigned_teacher_id: teacher_id,
          joining_date: start_date,
          status: 'Trial',
          notes: JSON.stringify({ trial_course: course, student_time, meeting_link, pkt_slot })
        }]);
      } catch (err) {
        console.warn("Supabase student insert notice:", err);
      }

      // 3. Auto-Book 3 Consecutive Days in Teacher Timetable
      const [startTimeRaw, endTimeRaw] = pkt_slot.split(' - ');
      const startTime = startTimeRaw.trim() + ':00';
      const endTime = endTimeRaw.trim() + ':00';
      const startD = new Date(start_date);
      const scheduleRows = [];
      const scheduledDates = [];

      for (let i = 0; i < 3; i++) {
        const d = new Date(startD);
        d.setDate(startD.getDate() + i);
        const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
        const isoDate = d.toISOString().slice(0, 10);
        scheduledDates.push(isoDate);

        scheduleRows.push({
          student_id: trialStuId,
          teacher_id,
          day_of_week: dayOfWeek,
          start_time: startTime,
          end_time: endTime,
          timezone: 'Asia/Karachi',
          meeting_link,
          status: 'Trial'
        });
      }

      try {
        await db.from('class_schedules').insert(scheduleRows);
      } catch (err) {
        console.warn("Supabase schedule insert notice:", err);
      }

      // 4. Save Trial locally
      const teacher = ALL_TEACHERS.find(t => t.id === teacher_id);
      const teacherName = teacher ? teacher.full_name : 'Teacher';

      const newTrial = {
        id: 'TRL-' + Date.now(),
        family_id: trialFamId,
        student_id: trialStuId,
        student_name,
        student_age,
        student_gender,
        parent_name,
        whatsapp,
        email: parent_email,
        country,
        timezone,
        course,
        teacher_id,
        teacher_name: teacherName,
        start_date,
        scheduled_dates: scheduledDates,
        pkt_slot,
        student_time,
        meeting_link,
        conducted_sessions: 0,
        status: 'Active',
        created_at: new Date().toISOString()
      };

      ALL_TRIALS.unshift(newTrial);
      saveStoredTrials(ALL_TRIALS);

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Book 3-Day Free Trial';
      }

      closeModal('modalAddTrialClass');
      updateTrialKpis();
      renderTrialCards(CURRENT_TRIAL_FILTER);

      loadDashboardData();
      loadFamiliesAndStudents();

      alert(`🎉 3-Day Free Trial Booked Successfully!\n\n` +
        `👤 Student: ${student_name} (${student_age} yrs)\n` +
        `👨‍🏫 Assigned Quran Instructor: ${teacherName}\n` +
        `⏰ Timetable Slot: ${pkt_slot} PKT\n` +
        `📅 3 Consecutive Trial Days: ${scheduledDates.join(', ')}\n\n` +
        `The 3 trial days have been automatically inserted into the teacher's schedule and will appear with a purple Trial badge.`
      );

      // Auto-trigger Official Welcome & Zoom Link Email
      if (auto_send_email && parent_email) {
        setTimeout(() => {
          openTrialEmailModal(newTrial.id);
        }, 300);
      }
    }

    async function toggleTrialSession(trialId, sessionNum) {
      const trial = ALL_TRIALS.find(t => t.id === trialId);
      if (!trial) return;

      const current = trial.conducted_sessions || 0;
      if (current >= sessionNum) {
        trial.conducted_sessions = sessionNum - 1;
      } else {
        trial.conducted_sessions = sessionNum;
      }

      if (trial.conducted_sessions >= 3) {
        if (trial.status === 'Active' || !trial.status) {
          trial.status = 'Completed';
        }
      } else if (trial.status === 'Completed') {
        trial.status = 'Active';
      }

      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        await db.from('attendance_logs').insert([{
          student_id: trial.student_id,
          teacher_id: trial.teacher_id,
          date: todayIso,
          status: 'Present',
          lesson_notes: `3-Day Trial Session ${trial.conducted_sessions}/3 Logged`
        }]);
      } catch(e) {}

      saveStoredTrials(ALL_TRIALS);
      updateTrialKpis();
      renderTrialCards(CURRENT_TRIAL_FILTER);
    }

    function openConvertTrialModal(trialId) {
      const trial = ALL_TRIALS.find(t => t.id === trialId);
      if (!trial) return;

      const teacher = ALL_TEACHERS.find(t => t.id === trial.teacher_id);
      const teacherName = teacher ? teacher.full_name : (trial.teacher_name || 'Assigned Instructor');

      // Pre-fill summary card (Zero Re-typing!)
      document.getElementById('convTrialId').value = trial.id;
      document.getElementById('convSummaryStudent').innerText = `${trial.student_name} (${trial.student_age} yrs, ${trial.student_gender || 'Child'})`;
      document.getElementById('convSummaryParent').innerText = trial.parent_name;
      document.getElementById('convSummaryPhone').innerText = (CURRENT_ROLE === 'manager') ? maskStudentPhone(trial.whatsapp || '') : (trial.whatsapp || '--');
      document.getElementById('convSummaryLocation').innerText = `${trial.country} • ${trial.timezone || 'UTC'}`;
      document.getElementById('convSummaryCourse').innerText = trial.course;
      document.getElementById('convSummaryTeacher').innerText = teacherName;

      // Smart default currency based on student country
      const country = (trial.country || '').toLowerCase();
      let defaultCurr = 'USD';
      let defaultFee = '60';
      if (country.includes('pakistan')) {
        defaultCurr = 'PKR';
        defaultFee = '10000';
      } else if (country.includes('united kingdom') || country.includes('uk') || country.includes('britain')) {
        defaultCurr = 'GBP';
        defaultFee = '50';
      } else if (country.includes('canada')) {
        defaultCurr = 'CAD';
        defaultFee = '70';
      } else if (country.includes('australia')) {
        defaultCurr = 'AUD';
        defaultFee = '80';
      } else if (country.includes('emirates') || country.includes('dubai') || country.includes('uae')) {
        defaultCurr = 'AED';
        defaultFee = '250';
      } else if (country.includes('saudi')) {
        defaultCurr = 'SAR';
        defaultFee = '250';
      } else if (country.includes('germany') || country.includes('france') || country.includes('europe')) {
        defaultCurr = 'EUR';
        defaultFee = '60';
      }

      const currSelect = document.getElementById('convCurrency');
      if (currSelect) currSelect.value = defaultCurr;

      const feeInput = document.getElementById('convMonthlyFee');
      if (feeInput) {
        feeInput.value = defaultFee;
        feeInput.focus();
      }

      const joiningInput = document.getElementById('convJoiningDate');
      if (joiningInput) joiningInput.value = new Date().toISOString().slice(0, 10);

      const emailInput = document.getElementById('convStudentEmail');
      if (emailInput) emailInput.value = (CURRENT_ROLE === 'manager') ? maskStudentEmail(trial.email || '') : (trial.email || '');

      const zoomInput = document.getElementById('convMeetingLink');
      if (zoomInput) zoomInput.value = trial.meeting_link || '';

      const sendEmailCheckbox = document.getElementById('convSendWelcomeEmail');
      if (sendEmailCheckbox) sendEmailCheckbox.checked = true;

      openModal('modalConvertTrialToRegular');
    }

    async function handleConvertTrialSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById('btnConfirmConvert');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enrolling Regular Student...';
      }

      const trialId = document.getElementById('convTrialId').value;
      const trial = ALL_TRIALS.find(t => t.id === trialId);
      if (!trial) {
        alert("Trial record not found.");
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-circle-check text-brandGold"></i> Confirm & Enroll as Regular Student';
        }
        return;
      }

      const monthly_fee = parseFloat(document.getElementById('convMonthlyFee').value) || 0;
      const currency = document.getElementById('convCurrency').value;
      const billing_day = parseInt(document.getElementById('convBillingDay').value) || 1;
      const days_per_week = document.getElementById('convDaysPerWeek').value;
      const joining_date = document.getElementById('convJoiningDate').value || new Date().toISOString().slice(0, 10);
      let student_email = (document.getElementById('convStudentEmail')?.value || '').trim();
      if ((student_email.includes('••') || !student_email) && trial.email) {
        student_email = trial.email;
      }
      const permanent_zoom_link = (document.getElementById('convMeetingLink')?.value || trial.meeting_link || '').trim();
      const send_welcome_email = document.getElementById('convSendWelcomeEmail')?.checked;

      if (monthly_fee <= 0) {
        alert("Please enter the agreed monthly fee.");
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-circle-check text-brandGold"></i> Confirm & Enroll as Regular Student';
        }
        return;
      }

      // 1. Generate Formal Sequence IDs
      const newFamId = getNextFamilyId();
      const newStuId = getNextStudentId();

      // 2. Parent Account credentials
      const rawParent = (trial.parent_name || 'parent').toLowerCase().replace(/[^a-z0-9]/g, '');
      const username = rawParent.length > 2 ? rawParent : `parent_${newFamId.toLowerCase()}`;
      const password = 'alhuda_' + Math.floor(1000 + Math.random() * 9000);

      // 3. Save Regular Family in Supabase
      try {
        await db.from('families').insert([{
          id: newFamId,
          parent_name: trial.parent_name,
          whatsapp: trial.whatsapp,
          country: trial.country,
          timezone: trial.timezone || 'UTC',
          monthly_fee,
          currency,
          billing_day,
          status: 'Active',
          notes: `Converted from Trial ${trial.id}`
        }]);

        saveParentAccount(newFamId, {
          username,
          password,
          parent_name: trial.parent_name,
          whatsapp: trial.whatsapp,
          country: trial.country,
          monthly_fee,
          currency
        });
      } catch(err) {
        console.warn("Supabase family regular insert notice:", err);
      }

      // 4. Save Regular Student in Supabase
      try {
        await db.from('students').insert([{
          id: newStuId,
          family_id: newFamId,
          name: trial.student_name,
          age: parseInt(trial.student_age) || 8,
          gender: trial.student_gender,
          course_id: null,
          assigned_teacher_id: trial.teacher_id,
          joining_date,
          status: 'Active',
          notes: JSON.stringify({
            course: trial.course,
            days_per_week,
            converted_from_trial: trial.id,
            parent_user: username
          })
        }]);
      } catch(err) {
        console.warn("Supabase student regular insert notice:", err);
      }

      // 5. Expand & Promote Class Schedules from Trial to Active Regular across requested days
      try {
        // Map requested days per week to day of week numbers (1 = Mon, 7 = Sun)
        let daysToSchedule = [1, 2, 3, 4, 5]; // default: 5 Days (Mon - Fri)
        const dStr = (days_per_week || '').toLowerCase();
        if (dStr.includes('3 day') || dStr.includes('mon / wed / fri') || dStr.includes('mon, wed, fri')) {
          daysToSchedule = [1, 3, 5]; // Mon, Wed, Fri
        } else if (dStr.includes('2 day') || dStr.includes('weekend') || dStr.includes('sat - sun') || dStr.includes('sat, sun')) {
          daysToSchedule = [6, 7]; // Sat, Sun
        } else if (dStr.includes('6 day')) {
          daysToSchedule = [1, 2, 3, 4, 5, 6]; // Mon - Sat
        } else if (dStr.includes('7 day') || dStr.includes('everyday')) {
          daysToSchedule = [1, 2, 3, 4, 5, 6, 7];
        } else if (dStr.includes('5 day')) {
          daysToSchedule = [1, 2, 3, 4, 5]; // Mon - Fri
        }

        // Determine Start & End times
        let startTime = '16:00:00';
        let endTime = '16:30:00';
        if (trial.pkt_slot && trial.pkt_slot.includes('-')) {
          const parts = trial.pkt_slot.split('-');
          const sT = parts[0].trim();
          const eT = parts[1].trim();
          startTime = sT.length === 5 ? `${sT}:00` : sT;
          endTime = eT.length === 5 ? `${eT}:00` : eT;
        }

        // Safely delete old temporary 3-day trial slots for this trial student
        if (trial.student_id) {
          await db.from('class_schedules').delete().eq('student_id', trial.student_id);
        }

        // Insert fresh regular schedule rows for the converted regular student across ALL requested days
        const scheduleRows = daysToSchedule.map(dayNum => ({
          student_id: newStuId,
          teacher_id: trial.teacher_id,
          day_of_week: dayNum,
          start_time: startTime,
          end_time: endTime,
          timezone: 'Asia/Karachi',
          meeting_link: permanent_zoom_link || trial.meeting_link || '',
          status: 'Active'
        }));

        await db.from('class_schedules').insert(scheduleRows);
      } catch(err) {
        console.warn("Supabase schedule expansion insert notice:", err);
      }

      // 6. Update Old Trial Student & Family in Supabase to permanently persist conversion history
      try {
        if (trial.student_id) {
          await db.from('students').update({
            status: 'Converted',
            notes: JSON.stringify({
              trial_course: trial.course,
              student_time: trial.student_time,
              meeting_link: trial.meeting_link,
              pkt_slot: trial.pkt_slot,
              converted_to_student_id: newStuId,
              converted_family_id: newFamId,
              converted_at: new Date().toISOString(),
              agreed_fee: `${currency} ${monthly_fee}`
            })
          }).eq('id', trial.student_id);
        }
        if (trial.family_id) {
          await db.from('families').update({
            status: 'Converted'
          }).eq('id', trial.family_id);
        }
      } catch(err) {
        console.warn("Supabase trial student status update notice:", err);
      }

      // 7. Mark Trial Record in Memory as Converted
      trial.status = 'Converted';
      trial.converted_student_id = newStuId;
      trial.converted_family_id = newFamId;
      trial.agreed_fee = `${currency} ${monthly_fee}`;
      trial.converted_at = new Date().toISOString();

      saveStoredTrials(ALL_TRIALS);

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-circle-check text-brandGold"></i> Confirm & Enroll as Regular Student';
      }

      closeModal('modalConvertTrialToRegular');
      updateTrialKpis();
      
      // Switch filter to 'all' so converted student stays visibly tracked with green badge
      filterTrialCards('all');

      // Refresh systems
      await loadFamiliesAndStudents();
      loadFeeBillingLedger();
      loadDashboardData();

      // If Teacher Schedule Matrix is currently open, refresh timetable immediately
      if (CURRENT_MATRIX_TEACHER && CURRENT_MATRIX_TEACHER.id === trial.teacher_id) {
        await fetchTeacherSchedules();
        render2DMatrixTable();
      }

      alert(`🎉 Conversion Completed Successfully!\n\n` +
        `👨‍👩‍👧 New Family ID: ${newFamId}\n` +
        `🎓 New Student ID: ${newStuId}\n` +
        `👤 Student: ${trial.student_name}\n` +
        `💰 Agreed Monthly Fee: ${currency} ${monthly_fee}\n` +
        `📅 Billing Due Day: ${billing_day}th of every month\n\n` +
        `🔑 Parent Portal Credentials Generated:\n` +
        `Username: ${username}\n` +
        `Password: ${password}\n\n` +
        `The trial timetable has been permanently activated as regular classes in the teacher's schedule!`
      );

      // Auto-trigger Official Welcome & Permanent Zoom Link Email
      if (send_welcome_email && (student_email || trial.email)) {
        const teacher = ALL_TEACHERS.find(t => t.id === trial.teacher_id);
        const teacherName = teacher ? teacher.full_name : (trial.teacher_name || 'Assigned Quran Instructor');
        setTimeout(() => {
          openEmailPreviewModal({
            type: 'regular',
            studentName: trial.student_name,
            parentName: trial.parent_name,
            toEmail: student_email || trial.email,
            phone: trial.whatsapp,
            course: trial.course,
            teacherName: teacherName,
            scheduleText: `${days_per_week} (${trial.pkt_slot || 'Regular Timetable'} PKT)`,
            zoomLink: permanent_zoom_link || trial.meeting_link || 'https://zoom.us/j/alhuda-class',
            credentials: {
              username,
              password
            }
          });
        }, 300);
      }
    }

    async function deleteTrial(trialId) {
      if (CURRENT_ROLE === 'manager') {
        alert("Access Denied: Managers are not authorized to permanently delete trial records. Only the System Owner can perform permanent deletions.");
        return;
      }
      const trial = ALL_TRIALS.find(t => t.id === trialId);
      if (!trial) return;

      if (confirm(`Are you sure you want to discontinue / remove the trial for "${trial.student_name}"?\n\nThis will release the assigned timetable slots for the teacher.`)) {
        try {
          if (trial.student_id) {
            await db.from('class_schedules').delete().eq('student_id', trial.student_id);
          }
        } catch(e) {}

        trial.status = 'Discontinued';
        saveStoredTrials(ALL_TRIALS);
        updateTrialKpis();
        renderTrialCards(CURRENT_TRIAL_FILTER);
        loadDashboardData();
      }
    }

