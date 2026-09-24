/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/search.js
 * Purpose: Teacher Schedule Slot Finder, Multi-Filter Availability Search & Custom Floating Dropdowns
 * Extracted Line Range: 15907 – 16423 (517 lines)
 * ============================================================================
 */

    // ============================================================
    // TEACHER SCHEDULE SEARCH & SLOT AVAILABILITY CONTROLLER
    // ============================================================
    let SCHED_SEARCH_INITIALIZED = false;

    function populateScheduleSearchTimeDropdowns() {
      const fromSel = document.getElementById('schedSearchTimeFrom');
      const toSel = document.getElementById('schedSearchTimeTo');
      if (!fromSel || !toSel) return;

      const timeSlots = [];
      for (let h = 0; h < 24; h++) {
        for (let m of [0, 30]) {
          const hStr = String(h).padStart(2, '0');
          const mStr = String(m).padStart(2, '0');
          const time24 = `${hStr}:${mStr}`;
          
          const period = h >= 12 ? 'PM' : 'AM';
          const h12 = h % 12 === 0 ? 12 : h % 12;
          const label = `${String(h12).padStart(2, '0')}:${mStr} ${period}`;
          timeSlots.push({ time24, label });
        }
      }

      fromSel.innerHTML = timeSlots.map(t => `<option value="${t.time24}">${t.label} (${t.time24})</option>`).join('');
      toSel.innerHTML = timeSlots.map(t => `<option value="${t.time24}">${t.label} (${t.time24})</option>`).join('')
        + `<option value="24:00">12:00 AM Midnight (24:00)</option>`;

      // Default: 12:00 (12:00 PM) to 18:00 (06:00 PM)
      fromSel.value = '12:00';
      toSel.value = '18:00';
    }

    // ============================================================
    // AESTHETIC CUSTOM FLOATING DROPDOWN COMPONENT ENGINE
    // Replaces Windows/Chrome native square select popups with sleek floating menus!
    // ============================================================
    function initCustomSelect(selectId) {
      const selectEl = document.getElementById(selectId);
      if (!selectEl) return;

      const parent = selectEl.parentElement;
      if (!parent) return;

      // Clean any previously generated custom wrapper
      const existing = parent.querySelector(`.custom-select-wrapper[data-select="${selectId}"]`);
      if (existing) existing.remove();

      selectEl.classList.add('hidden'); // hide native clunky select

      const wrapper = document.createElement('div');
      wrapper.className = 'custom-select-wrapper relative w-full';
      wrapper.setAttribute('data-select', selectId);

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'custom-select-trigger w-full p-2.5 bg-white border border-slate-300 hover:border-emerald-600 rounded-xl font-bold text-xs text-slate-800 shadow-2xs transition flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-emerald-500/20';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'custom-select-label truncate text-left flex-1';

      const chevron = document.createElement('i');
      chevron.className = 'fa-solid fa-chevron-down text-emerald-600 text-[11px] transition-transform duration-200 ml-2 shrink-0';

      trigger.appendChild(labelSpan);
      trigger.appendChild(chevron);

      const menu = document.createElement('div');
      menu.className = 'custom-select-menu hidden absolute left-0 right-0 top-full mt-1.5 bg-white/98 backdrop-blur-md rounded-2xl border border-emerald-100 shadow-2xl z-50 p-1.5 space-y-0.5 max-h-64 overflow-y-auto custom-scrollbar';

      function renderItems() {
        menu.innerHTML = '';
        const curVal = selectEl.value;
        const activeOpt = selectEl.options[selectEl.selectedIndex] || selectEl.options[0];
        labelSpan.innerText = activeOpt ? activeOpt.text : 'Select...';

        Array.from(selectEl.options).forEach(opt => {
          const item = document.createElement('div');
          const isSelected = opt.value === curVal;
          item.className = `custom-select-item px-3 py-2 rounded-xl text-xs transition cursor-pointer flex items-center justify-between ${
            isSelected 
              ? 'bg-emerald-100/90 text-emerald-950 font-bold border border-emerald-300/70 shadow-2xs' 
              : 'font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-950'
          }`;
          item.innerHTML = `
            <span class="truncate">${opt.text}</span>
            ${isSelected ? '<i class="fa-solid fa-check text-emerald-600 text-xs shrink-0 ml-2"></i>' : ''}
          `;
          item.onclick = (e) => {
            e.stopPropagation();
            selectEl.value = opt.value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            renderItems();
            closeAllCustomSelects();
          };
          menu.appendChild(item);
        });
      }

      renderItems();

      trigger.onclick = (e) => {
        e.stopPropagation();
        const isOpen = !menu.classList.contains('hidden');
        closeAllCustomSelects();
        if (!isOpen) {
          renderItems();
          menu.classList.remove('hidden');
          chevron.classList.add('rotate-180');
          trigger.classList.add('border-emerald-600', 'ring-2', 'ring-emerald-500/20');
        }
      };

      wrapper.appendChild(trigger);
      wrapper.appendChild(menu);
      parent.appendChild(wrapper);

      selectEl.addEventListener('change', () => {
        const activeOpt = selectEl.options[selectEl.selectedIndex];
        if (activeOpt) labelSpan.innerText = activeOpt.text;
      });
    }

    function refreshScheduleSearchCustomSelects() {
      ['schedSearchDay', 'schedSearchTimeFrom', 'schedSearchTimeTo', 'schedSearchGender', 'schedSearchStatus'].forEach(id => {
        initCustomSelect(id);
      });
    }

    function closeAllCustomSelects() {
      document.querySelectorAll('.custom-select-menu').forEach(m => m.classList.add('hidden'));
      document.querySelectorAll('.custom-select-trigger').forEach(b => {
        b.classList.remove('border-emerald-600', 'ring-2', 'ring-emerald-500/20');
        const icon = b.querySelector('.fa-chevron-down');
        if (icon) icon.classList.remove('rotate-180');
      });
    }

    // Global outside click listener to close custom dropdowns
    document.addEventListener('click', () => closeAllCustomSelects());

    function initScheduleSearch() {
      if (!SCHED_SEARCH_INITIALIZED) {
        populateScheduleSearchTimeDropdowns();

        // Auto-select today's day of week
        const todayDayNum = new Date().getDay(); // 0 = Sun, 1 = Mon ...
        const dayMap = [7, 1, 2, 3, 4, 5, 6];
        const currentDay = dayMap[todayDayNum];
        const daySelect = document.getElementById('schedSearchDay');
        if (daySelect) {
          daySelect.value = String(currentDay);
        }

        SCHED_SEARCH_INITIALIZED = true;
      }
      refreshScheduleSearchCustomSelects();
      executeScheduleSearch();
    }

    function setScheduleSearchPreset(preset) {
      const fromSel = document.getElementById('schedSearchTimeFrom');
      const toSel = document.getElementById('schedSearchTimeTo');
      if (!fromSel || !toSel) return;

      if (preset === 'afternoon') {
        fromSel.value = '12:00';
        toSel.value = '18:00';
      } else if (preset === 'night') {
        fromSel.value = '18:00';
        toSel.value = '24:00';
      } else if (preset === 'morning') {
        fromSel.value = '08:00';
        toSel.value = '14:00';
      } else if (preset === 'full_day') {
        fromSel.value = '00:00';
        toSel.value = '24:00';
      }
      refreshScheduleSearchCustomSelects();
      executeScheduleSearch();
    }

    function resetScheduleSearchFilters() {
      const dayMap = [7, 1, 2, 3, 4, 5, 6];
      const currentDay = dayMap[new Date().getDay()];
      const dSel = document.getElementById('schedSearchDay');
      if (dSel) dSel.value = String(currentDay);
      const fSel = document.getElementById('schedSearchTimeFrom');
      if (fSel) fSel.value = '12:00';
      const tSel = document.getElementById('schedSearchTimeTo');
      if (tSel) tSel.value = '18:00';
      const gSel = document.getElementById('schedSearchGender');
      if (gSel) gSel.value = 'all';
      const sSel = document.getElementById('schedSearchStatus');
      if (sSel) sSel.value = 'free_only';
      const qInp = document.getElementById('schedSearchTeacherQuery');
      if (qInp) qInp.value = '';
      refreshScheduleSearchCustomSelects();
      executeScheduleSearch();
    }

    async function executeScheduleSearch() {
      const container = document.getElementById('schedSearchResultsContainer');
      if (!container) return;

      container.innerHTML = `
        <div class="bg-white p-12 rounded-2xl border border-slate-200 text-center shadow-xs">
          <i class="fa-solid fa-spinner fa-spin text-3xl text-emerald-600 mb-3"></i>
          <h4 class="font-extrabold text-slate-700 text-sm">Analyzing Teacher Schedules...</h4>
          <p class="text-xs text-slate-400 mt-1">Cross-referencing shifts, booked classes, and free slots</p>
        </div>
      `;

      // 1. Get filter inputs
      let dayVal = document.getElementById('schedSearchDay')?.value || 'today';
      if (dayVal === 'today') {
        const dayMap = [7, 1, 2, 3, 4, 5, 6];
        dayVal = String(dayMap[new Date().getDay()]);
      }
      const daysToEvaluate = (dayVal === 'all') ? [1, 2, 3, 4, 5] : [Number(dayVal)];

      const timeFrom = document.getElementById('schedSearchTimeFrom')?.value || '12:00';
      const timeTo = document.getElementById('schedSearchTimeTo')?.value || '18:00';
      const genderFilter = document.getElementById('schedSearchGender')?.value || 'all';
      const statusFilter = document.getElementById('schedSearchStatus')?.value || 'free_only';
      const teacherQuery = (document.getElementById('schedSearchTeacherQuery')?.value || '').trim().toLowerCase();

      // Convert times to minutes from midnight
      const [fromH, fromM] = timeFrom.split(':').map(Number);
      const fromMin = fromH * 60 + fromM;

      let [toH, toM] = timeTo.split(':').map(Number);
      const toMin = toH * 60 + (toM || 0);

      if (toMin <= fromMin) {
        container.innerHTML = `
          <div class="p-8 bg-amber-50 rounded-2xl border border-amber-200 text-center text-amber-800">
            <i class="fa-solid fa-triangle-exclamation text-3xl text-amber-500 mb-2"></i>
            <h4 class="font-bold text-sm">Invalid Time Range</h4>
            <p class="text-xs mt-1">"To Time" (${timeTo}) must be later than "From Time" (${timeFrom}).</p>
          </div>
        `;
        return;
      }

      // 2. Fetch fresh teachers if needed
      if (!ALL_TEACHERS || ALL_TEACHERS.length === 0) {
        const { data: tData } = await db.from('teachers').select('*').order('created_at', { ascending: false });
        ALL_TEACHERS = tData || [];
      }

      // Filter only Teaching Staff (exclude Managers and other non-teaching staff)
      const teachingStaff = (ALL_TEACHERS || []).filter(t => {
        let m = {};
        try { m = JSON.parse(t.notes || '{}'); } catch(e){}
        const isExcluded = m.employee_type === 'manager' || m.employee_type === 'other_staff' || String(t.id).startsWith('MGR-') || String(t.id).startsWith('STF-');
        return !isExcluded && t.status !== 'Inactive' && t.status !== 'Terminated';
      });

      // Filter by Teacher Gender and Query
      const matchedTeachers = teachingStaff.filter(t => {
        let tGender = t.gender;
        if (!tGender) {
          const accs = getTeacherAccounts();
          tGender = accs[t.id]?.gender || 'Male';
        }
        if (genderFilter !== 'all' && tGender !== genderFilter) return false;
        if (teacherQuery && !(t.full_name || '').toLowerCase().includes(teacherQuery)) return false;
        return true;
      });

      // 3. Fetch schedules for the target days
      let schedulesQuery = db.from('class_schedules').select('*, students(name, course_id, status)');
      if (daysToEvaluate.length === 1) {
        schedulesQuery = schedulesQuery.eq('day_of_week', daysToEvaluate[0]);
      } else {
        schedulesQuery = schedulesQuery.in('day_of_week', daysToEvaluate);
      }
      const { data: scheds } = await schedulesQuery;
      const allSchedules = scheds || [];

      // 4. Generate 30-min evaluation slots in requested window
      const evalSlots = [];
      for (let m = fromMin; m < toMin; m += 30) {
        const slotStartH = Math.floor(m / 60);
        const slotStartM = m % 60;
        const slotEndH = Math.floor((m + 30) / 60);
        const slotEndM = (m + 30) % 60;

        const startStr = `${String(slotStartH).padStart(2, '0')}:${String(slotStartM).padStart(2, '0')}`;
        const endStr = `${String(slotEndH).padStart(2, '0')}:${String(slotEndM).padStart(2, '0')}`;
        
        const p1 = slotStartH >= 12 ? 'PM' : 'AM';
        const h12_1 = slotStartH % 12 === 0 ? 12 : slotStartH % 12;
        const label = `${h12_1}:${String(slotStartM).padStart(2, '0')} ${p1}`;

        evalSlots.push({ startStr, endStr, label, startMin: m, endMin: m + 30 });
      }

      // 5. Evaluate each teacher's availability
      const teacherReports = [];
      let totalFreeSlotsAll = 0;
      let totalBookedClassesAll = 0;

      matchedTeachers.forEach(teacher => {
        let tGender = teacher.gender;
        if (!tGender) {
          const accs = getTeacherAccounts();
          tGender = accs[teacher.id]?.gender || 'Male';
        }

        const teacherScheds = allSchedules.filter(s => String(s.teacher_id) === String(teacher.id));
        const shiftStr = teacher.working_shift || '';

        // Check each slot in window
        const slotResults = evalSlots.map(slot => {
          const bookedSchedule = teacherScheds.find(s => {
            const sStart = (s.start_time || '').slice(0, 5);
            return sStart === slot.startStr;
          });

          const inShift = isSlotInTeacherShift(slot.startStr, shiftStr);

          if (bookedSchedule) {
            return {
              ...slot,
              status: 'booked',
              schedule: bookedSchedule,
              studentName: bookedSchedule.students?.name || 'Enrolled Student',
              course: bookedSchedule.students?.course_id || 'Class',
              inShift
            };
          } else {
            return {
              ...slot,
              status: 'free',
              inShift
            };
          }
        });

        const freeSlots = slotResults.filter(s => s.status === 'free');
        const bookedSlots = slotResults.filter(s => s.status === 'booked');

        totalFreeSlotsAll += freeSlots.length;
        totalBookedClassesAll += bookedSlots.length;

        teacherReports.push({
          teacher,
          gender: tGender,
          shiftStr,
          slotResults,
          freeSlotsCount: freeSlots.length,
          bookedSlotsCount: bookedSlots.length,
          totalSlots: evalSlots.length
        });
      });

      // 6. Apply statusFilter
      let filteredReports = teacherReports;
      if (statusFilter === 'free_only') {
        filteredReports = teacherReports.filter(r => r.freeSlotsCount > 0);
      } else if (statusFilter === 'fully_free') {
        filteredReports = teacherReports.filter(r => r.bookedSlotsCount === 0);
      } else if (statusFilter === 'busy_only') {
        filteredReports = teacherReports.filter(r => r.bookedSlotsCount > 0);
      }

      // Sort: Teachers with most free slots first
      filteredReports.sort((a, b) => b.freeSlotsCount - a.freeSlotsCount);

      // 7. Update KPIs
      const kpiAvail = document.getElementById('kpiSchedAvailableTeachers');
      const kpiFree = document.getElementById('kpiSchedTotalFreeSlots');
      const kpiBooked = document.getElementById('kpiSchedTotalBookedClasses');
      const kpiRate = document.getElementById('kpiSchedAvailabilityRate');

      if (kpiAvail) kpiAvail.innerText = filteredReports.filter(r => r.freeSlotsCount > 0).length;
      if (kpiFree) kpiFree.innerText = totalFreeSlotsAll;
      if (kpiBooked) kpiBooked.innerText = totalBookedClassesAll;
      
      const totalAllSlots = totalFreeSlotsAll + totalBookedClassesAll;
      const freeRate = totalAllSlots > 0 ? Math.round((totalFreeSlotsAll / totalAllSlots) * 100) : 100;
      if (kpiRate) kpiRate.innerHTML = `${freeRate}<span class="text-sm font-semibold opacity-70 ml-0.5">%</span>`;

      const shiftBadge = document.getElementById('badgeSchedSearchActiveShift');
      if (shiftBadge) {
        shiftBadge.innerText = `${evalSlots.length} Slots (${timeFrom} - ${timeTo})`;
      }

      // 8. Render Results View
      if (filteredReports.length === 0) {
        container.innerHTML = `
          <div class="p-12 bg-white rounded-2xl border border-slate-200 text-center shadow-xs">
            <div class="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center text-2xl mx-auto mb-3">
              <i class="fa-solid fa-user-slash"></i>
            </div>
            <h4 class="font-black text-slate-800 text-base">No Matching Teachers Found</h4>
            <p class="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              No teachers matched your current filter criteria (${genderFilter !== 'all' ? genderFilter : 'All Genders'}, ${timeFrom} to ${timeTo}). Try adjusting the time window or availability filter.
            </p>
            <button onclick="resetScheduleSearchFilters()" class="mt-4 px-4 py-2 bg-emerald-700 text-white rounded-xl text-xs font-bold hover:bg-emerald-800 transition">
              <i class="fa-solid fa-rotate-left mr-1"></i> Reset All Filters
            </button>
          </div>
        `;
        return;
      }

      const activeDayName = daysToEvaluate.length === 1 ? DAY_NAMES[daysToEvaluate[0]] : 'Monday–Friday';
      const targetDayId = daysToEvaluate[0];

      container.innerHTML = filteredReports.map(report => {
        const t = report.teacher;
        const isMale = report.gender === 'Male';
        const genderBadge = isMale 
          ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200"><i class="fa-solid fa-mars mr-1"></i>Male Teacher</span>`
          : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200"><i class="fa-solid fa-venus mr-1"></i>Female Teacher</span>`;

        const availBadge = report.freeSlotsCount === report.totalSlots
          ? `<span class="px-2.5 py-1 rounded-xl text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1"><i class="fa-solid fa-circle-check text-emerald-600"></i> 100% Free (${report.freeSlotsCount}/${report.totalSlots} Slots)</span>`
          : (report.freeSlotsCount > 0
              ? `<span class="px-2.5 py-1 rounded-xl text-xs font-black bg-teal-50 text-teal-800 border border-teal-300 flex items-center gap-1"><i class="fa-solid fa-clock text-teal-600"></i> ${report.freeSlotsCount} Free / ${report.bookedSlotsCount} Booked</span>`
              : `<span class="px-2.5 py-1 rounded-xl text-xs font-black bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-1"><i class="fa-solid fa-ban text-rose-600"></i> Fully Booked (${report.bookedSlotsCount} Classes)</span>`);

        return `
          <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition">
            <!-- TEACHER CARD HEADER -->
            <div class="flex items-start justify-between flex-wrap gap-3 pb-4 border-b border-slate-100">
              <div class="flex items-center gap-3.5">
                <div class="w-12 h-12 rounded-2xl ${isMale ? 'bg-gradient-to-tr from-blue-700 to-indigo-900' : 'bg-gradient-to-tr from-rose-600 to-pink-800'} text-white flex items-center justify-center font-black text-lg shadow-sm flex-shrink-0">
                  ${(t.full_name || 'T').charAt(0)}
                </div>
                <div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <h3 class="font-extrabold text-base text-slate-900 tracking-tight">${t.full_name}</h3>
                    ${genderBadge}
                    <span class="text-xs text-slate-400 font-mono font-bold">(${t.id})</span>
                  </div>
                  <div class="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                    <span><i class="fa-solid fa-briefcase text-slate-400 mr-1"></i>Shift: <strong>${t.working_shift || 'Flexible Shift'}</strong></span>
                    <span><i class="fa-solid fa-phone text-emerald-600 mr-1"></i>${t.phone || '--'}</span>
                    <span><i class="fa-solid fa-money-bill-wave text-amber-600 mr-1"></i>Rate: <strong>${t.rate_per_slot || 2200} PKR</strong>/slot</span>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2">
                ${availBadge}
                <button onclick="openScheduleMatrix('${t.id}')" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition flex items-center gap-1" title="View Full 2D Weekly Matrix">
                  <i class="fa-solid fa-table-cells text-slate-500"></i> Full Matrix
                </button>
              </div>
            </div>

            <!-- SLOTS VISUAL BREAKDOWN IN REQUESTED WINDOW -->
            <div class="pt-4">
              <div class="flex items-center justify-between mb-2 text-xs">
                <span class="font-bold text-slate-600 flex items-center gap-1.5">
                  <i class="fa-solid fa-calendar-day text-brandEmerald"></i>
                  ${activeDayName} Availability (${timeFrom} to ${timeTo}):
                </span>
                <span class="text-[11px] text-slate-400">
                  Click any <strong class="text-emerald-700">Free Slot</strong> to assign a student
                </span>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                ${report.slotResults.map(slot => {
                  if (slot.status === 'free') {
                    return `
                      <button onclick="quickAssignFromSearch('${t.id}', ${targetDayId}, '${slot.startStr}', '${slot.endStr}')"
                        class="p-2.5 rounded-xl border border-emerald-300 bg-emerald-50/80 hover:bg-emerald-100 hover:border-emerald-500 text-left transition group shadow-2xs flex flex-col justify-between"
                        title="Click to Assign Student to ${slot.startStr} - ${slot.endStr}">
                        <div class="flex items-center justify-between">
                          <span class="font-mono font-black text-xs text-emerald-950">${slot.label}</span>
                          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        </div>
                        <div class="mt-1 flex items-center justify-between text-[11px] font-extrabold text-emerald-700">
                          <span>Free Slot</span>
                          <i class="fa-solid fa-plus text-[10px] opacity-70 group-hover:scale-125 transition"></i>
                        </div>
                      </button>
                    `;
                  } else {
                    return `
                      <div class="p-2.5 rounded-xl border border-amber-200 bg-amber-50/70 text-left shadow-2xs flex flex-col justify-between"
                        title="Booked: ${slot.studentName} (${slot.course})">
                        <div class="flex items-center justify-between">
                          <span class="font-mono font-bold text-xs text-slate-700">${slot.label}</span>
                          <span class="px-1.5 py-0.2 rounded text-[8px] font-bold bg-amber-200 text-amber-900">BOOKED</span>
                        </div>
                        <div class="mt-1">
                          <p class="text-[11px] font-bold text-slate-900 truncate" title="${slot.studentName}">${slot.studentName}</p>
                          <p class="text-[9px] text-slate-500 truncate">${slot.course}</p>
                        </div>
                      </div>
                    `;
                  }
                }).join('')}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    async function quickAssignFromSearch(teacherId, day, startTime, endTime) {
      const teacher = (ALL_TEACHERS || []).find(t => String(t.id) === String(teacherId));
      if (!teacher) {
        alert("Teacher profile could not be found.");
        return;
      }
      CURRENT_MATRIX_TEACHER = teacher;
      await openSlotBookingModal(day, startTime, endTime);
    }

