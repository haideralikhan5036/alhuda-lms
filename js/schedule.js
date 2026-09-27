/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/schedule.js
 * Purpose: 2D Weekly Schedule Matrix, Slot Booking, Conflict Detection & Live Class Attendance
 * Extracted Line Range: 10042 – 10521 (480 lines)
 * ============================================================================
 */

    // 2D MATRIX SCHEDULE
    async function open2DMatrixForTeacher(teacherId) {
      CURRENT_MATRIX_TEACHER = ALL_TEACHERS.find(t => t.id === teacherId);
      if (!CURRENT_MATRIX_TEACHER) return;

      if (typeof isEligibleTeacherRecord === 'function' && !isEligibleTeacherRecord(CURRENT_MATRIX_TEACHER)) {
        const roleInfo = (typeof getEmployeeRoleClassification === 'function') ? getEmployeeRoleClassification(CURRENT_MATRIX_TEACHER) : { roleLabel: 'Manager' };
        if (typeof lmsNotify === 'function') {
          lmsNotify(`${CURRENT_MATRIX_TEACHER.full_name} is registered as ${roleInfo.roleLabel} (Non-Teaching Management). Managers do not have a weekly teaching timetable.`, {
            type: 'error',
            title: 'Teaching Schedule Restricted'
          });
        }
        CURRENT_MATRIX_TEACHER = null;
        return;
      }

      const creds = getTeacherCreds(CURRENT_MATRIX_TEACHER);
      document.getElementById('matrixTeacherName').innerText = `${CURRENT_MATRIX_TEACHER.full_name}'s Weekly Timetable (${creds.teacher_id})`;
      document.getElementById('matrixTeacherSubtitle').innerText = `Rate: ${CURRENT_MATRIX_TEACHER.rate_per_slot || 200} PKR / slot • Configured Shift: ${CURRENT_MATRIX_TEACHER.working_shift || '10 Hours Shift (02:00 PM - 12:00 AM PKT)'}`;

      // Populate Assigned Students & Active Trials Bar
      const studentsListEl = document.getElementById('matrixTeacherStudentsList');
      if (studentsListEl) {
        const assignedStudents = (ALL_STUDENTS || []).filter(s =>
          String(s.assigned_teacher_id || '') === String(teacherId || '') &&
          s.status !== 'Trial' &&
          s.status !== 'Converted' &&
          (typeof isActiveStudentRecord === 'function' ? isActiveStudentRecord(s) : true)
        );
        const assignedTrials = (ALL_TRIALS || []).filter(t => t.teacher_id === teacherId && t.status !== 'Discontinued');

        if (assignedStudents.length === 0 && assignedTrials.length === 0) {
          studentsListEl.innerHTML = `<span class="text-slate-400 italic text-[11px]">No students or trials assigned to this teacher yet.</span>`;
        } else {
          let rosterHtml = '';
          // Regular students
          assignedStudents.forEach(s => {
            rosterHtml += `
              <span class="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                <i class="fa-solid fa-graduation-cap text-emerald-700"></i>
                <strong>${s.name}</strong>
                <span class="text-[9px] font-mono text-emerald-800">(${s.id})</span>
              </span>
            `;
          });
          // Trial students
          assignedTrials.forEach(t => {
            const isConverted = t.status === 'Converted';
            rosterHtml += `
              <span class="px-2 py-0.5 rounded-lg ${isConverted ? 'bg-teal-100 text-teal-900 border-teal-300' : 'bg-purple-100 text-purple-900 border-purple-300'} font-bold text-[11px] flex items-center gap-1.5 shadow-2xs">
                <i class="fa-solid fa-star ${isConverted ? 'text-teal-600' : 'text-amber-500'}"></i>
                <strong>${t.student_name}</strong>
                <span class="text-[9px] font-extrabold px-1 rounded ${isConverted ? 'bg-teal-200 text-teal-900' : 'bg-purple-200 text-purple-900'}">${isConverted ? 'CONVERTED' : 'TRIAL'}</span>
                ${!isConverted ? `<button onclick="openConvertTrialModal('${t.id}')" class="px-1.5 py-0.2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[9px] font-black shadow-2xs transition">Regularize</button>` : ''}
              </span>
            `;
          });
          studentsListEl.innerHTML = rosterHtml;
        }
      }

      openModal('modalScheduleMatrix');
      await fetchTeacherSchedules();
      render2DMatrixTable();
    }

    async function fetchTeacherSchedules() {
      if (!CURRENT_MATRIX_TEACHER || !CURRENT_MATRIX_TEACHER.id) return;
      const { data: scheds } = await db.from('class_schedules')
        .select('*, students(name, status, notes)')
        .eq('teacher_id', CURRENT_MATRIX_TEACHER.id);
      CURRENT_TEACHER_SCHEDULES = scheds || [];
    }

    function convertTrialFromSchedule(studentId) {
      const trial = (ALL_TRIALS || []).find(t => t.student_id === studentId || t.id === studentId || t.id === 'TRL-' + String(studentId).replace(/[^0-9]/g, ''));
      if (trial) {
        openConvertTrialModal(trial.id);
      } else {
        const student = (ALL_STUDENTS || []).find(s => s.id === studentId);
        if (student) {
          const tempTrial = {
            id: 'TRL-' + student.id.replace(/[^0-9]/g, ''),
            student_id: student.id,
            family_id: student.family_id,
            student_name: student.name,
            student_age: student.age || 8,
            student_gender: student.gender || 'Child',
            parent_name: 'Guardian',
            whatsapp: '',
            country: 'International',
            course: student.course_id || 'Quran Studies',
            teacher_id: student.assigned_teacher_id,
            status: 'Active'
          };
          ALL_TRIALS.unshift(tempTrial);
          openConvertTrialModal(tempTrial.id);
        } else {
          alert("Trial record details not found for student ID: " + studentId);
        }
      }
    }

    function isSlotInTeacherShift(startTime, shiftStr) {
      if (!shiftStr || shiftStr.includes('24 Hours')) return true;
      const [h, m] = startTime.split(':').map(Number);
      const totalMin = h * 60 + m;

      if (shiftStr.includes('10 Hours')) {
        // 02:00 PM (14:00) to 12:00 AM (24:00)
        return totalMin >= 14 * 60 && totalMin < 24 * 60;
      }
      if (shiftStr.includes('8 Hours')) {
        // 04:00 PM (16:00) to 12:00 AM (24:00)
        return totalMin >= 16 * 60 && totalMin < 24 * 60;
      }
      if (shiftStr.includes('6 Hours')) {
        // 06:00 PM (18:00) to 12:00 AM (24:00)
        return totalMin >= 18 * 60 && totalMin < 24 * 60;
      }
      if (shiftStr.includes('12 Hours')) {
        // 12:00 PM (12:00) to 12:00 AM (24:00)
        return totalMin >= 12 * 60 && totalMin < 24 * 60;
      }
      if (shiftStr.includes('Morning')) {
        // 08:00 AM to 02:00 PM
        return totalMin >= 8 * 60 && totalMin < 14 * 60;
      }
      return true;
    }

    function render2DMatrixTable() {
      const tbody = document.getElementById('matrix2DTableBody');
      if (!tbody) return;
      tbody.innerHTML = '';

      const bookingsMap = {};
      CURRENT_TEACHER_SCHEDULES.forEach(s => {
        const key = `${s.day_of_week}_${s.start_time.slice(0, 5)}`;
        bookingsMap[key] = s;
      });

      const shiftStr = CURRENT_MATRIX_TEACHER ? (CURRENT_MATRIX_TEACHER.working_shift || '') : '';

      for (let hour = 0; hour < 24; hour++) {
        for (let min of [0, 30]) {
          const hStr = String(hour).padStart(2, '0');
          const mStr = String(min).padStart(2, '0');
          const startTime = `${hStr}:${mStr}`;
          
          const endMin = (min + 30) % 60;
          const endHour = (hour + Math.floor((min + 30) / 60)) % 24;
          const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

          const isShiftSlot = isSlotInTeacherShift(startTime, shiftStr);

          const tr = document.createElement('tr');
          if (isShiftSlot) {
            tr.className = 'bg-emerald-50/25 border-l-4 border-l-brandEmerald';
          }

          let timeCell = `
            <td class="p-2 text-center font-mono font-bold text-[11px] ${isShiftSlot ? 'bg-emerald-100/60 text-emerald-900 font-extrabold' : 'bg-slate-50 text-slate-700'} whitespace-nowrap">
              ${startTime} - ${endTime}
              ${isShiftSlot ? '<span class="px-1 py-0.2 rounded bg-emerald-600 text-white text-[8px] font-bold block mt-0.5">DUTY SHIFT</span>' : ''}
            </td>
          `;
          let daysCells = '';

          for (let day = 1; day <= 7; day++) {
            const key = `${day}_${startTime}`;
            const slot = bookingsMap[key];

            if (slot) {
              const stuStatus = slot.students?.status;
              const isTrialSlot = slot.status === 'Trial' || stuStatus === 'Trial';
              const stuName = slot.students?.name || 'Student';

              if (isTrialSlot) {
                daysCells += `
                  <td class="p-1 text-center bg-purple-50/90 border border-purple-200">
                    <div onclick="openMatrixSlotActionModal('${slot.id}')" class="flex flex-col justify-between p-1.5 rounded-lg bg-white shadow-2xs border border-purple-300 gap-1 cursor-pointer hover:border-purple-500 transition" title="Click to manage scheduled class">
                      <div class="flex items-center justify-between gap-1">
                        <span class="font-extrabold text-[11px] text-purple-950 truncate" title="${stuName}">
                          <i class="fa-solid fa-star text-amber-500"></i> ${stuName}
                        </span>
                        <span class="px-1 py-0.2 rounded text-[8px] font-black bg-purple-200 text-purple-900 border border-purple-300">TRIAL</span>
                      </div>
                      <div class="flex items-center justify-between gap-1 mt-0.5">
                        <button onclick="event.stopPropagation(); convertTrialFromSchedule('${slot.student_id}')" class="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black rounded shadow-2xs flex items-center gap-0.5 transition" title="Regularize Student">
                          <i class="fa-solid fa-circle-check text-[8px]"></i> Regularize
                        </button>
                        ${CURRENT_ROLE !== 'manager' ? `
                          <button onclick="event.stopPropagation(); openMatrixSlotActionModal('${slot.id}')" class="text-rose-500 hover:text-rose-700 text-[10px] font-bold" title="Manage / Delete Scheduled Class">
                            <i class="fa-solid fa-trash-can"></i>
                          </button>
                        ` : ''}
                      </div>
                    </div>
                  </td>
                `;
              } else {
                daysCells += `
                  <td class="p-1 text-center bg-emerald-50/50 border border-emerald-200">
                    <div onclick="openMatrixSlotActionModal('${slot.id}')" class="flex flex-col justify-between p-1.5 rounded-lg bg-white shadow-2xs border border-emerald-300 gap-1 cursor-pointer hover:border-emerald-500 transition" title="Click to manage scheduled class">
                      <div class="flex items-center justify-between gap-1">
                        <span class="font-extrabold text-[11px] text-slate-900 truncate" title="${stuName}">
                          <i class="fa-solid fa-graduation-cap text-emerald-600"></i> ${stuName}
                        </span>
                        <span class="px-1 py-0.2 rounded text-[8px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">REGULAR</span>
                      </div>
                      <div class="flex items-center justify-between gap-1 mt-0.5">
                        <span class="text-[9px] text-slate-400 font-mono truncate max-w-[65px]">${slot.student_id || ''}</span>
                        ${CURRENT_ROLE !== 'manager' ? `
                          <button onclick="event.stopPropagation(); openMatrixSlotActionModal('${slot.id}')" class="text-rose-500 hover:text-rose-700 text-[10px] font-bold ml-auto" title="Manage / Delete Scheduled Class">
                            <i class="fa-solid fa-trash-can"></i>
                          </button>
                        ` : ''}
                      </div>
                    </div>
                  </td>
                `;
              }
            } else {
              daysCells += `
                <td onclick="openSlotBookingModal(${day}, '${startTime}', '${endTime}')" class="p-1.5 text-center ${isShiftSlot ? 'slot-vacant bg-emerald-50/60' : 'slot-vacant'} transition" title="Click to Book Student">
                  <div class="text-[10px] font-bold text-emerald-700">
                    + Free
                  </div>
                </td>
              `;
            }
          }

          tr.innerHTML = timeCell + daysCells;
          tbody.appendChild(tr);
        }
      }
    }

    let ACTIVE_DAY = 1;
    let ACTIVE_START_TIME = '';
    let ACTIVE_END_TIME = '';
    let ACTIVE_SLOT_ACTION_CONTEXT = null;

    function updateBookingWeekdaySelectionUI() {
      const checkboxes = Array.from(document.querySelectorAll('input[name="bookSlotWeekday"]'));
      let selectedCount = 0;

      checkboxes.forEach(cb => {
        const card = document.querySelector(`[data-weekday-card="${cb.value}"]`);
        if (cb.checked) {
          selectedCount++;
          if (card) {
            card.className = 'flex items-center gap-1.5 p-2 rounded-lg border border-emerald-500 bg-emerald-50 ring-1 ring-emerald-400 cursor-pointer transition select-none shadow-2xs';
          }
        } else {
          if (card) {
            card.className = 'flex items-center gap-1.5 p-2 rounded-lg border border-slate-200 bg-white cursor-pointer transition select-none hover:border-emerald-400';
          }
        }
      });

      const counterEl = document.getElementById('bookSelectedDaysCounter');
      if (counterEl) {
        counterEl.textContent = `${selectedCount} ${selectedCount === 1 ? 'Day' : 'Days'} Selected`;
        counterEl.className = selectedCount > 0
          ? 'text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200'
          : 'text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200';
      }
    }

    async function loadStudentsForBooking() {
      const select = document.getElementById('bookStudentSelect');
      if (!select) return;

      const teacherId = CURRENT_MATRIX_TEACHER?.id;
      if (!teacherId) {
        select.innerHTML = '<option value="">No teacher selected.</option>';
        return;
      }

      const cachedProfiles = JSON.parse(localStorage.getItem('alhuda_student_profiles') || '{}');

      // Authoritative query: fetch ONLY students assigned to this teacher's roster
      let rosterCandidates = [];
      try {
        const { data: dbRoster, error } = await db.from('students')
          .select('*, families(id, parent_name, status)')
          .eq('assigned_teacher_id', teacherId);
        if (!error && Array.isArray(dbRoster)) {
          rosterCandidates = dbRoster;
        } else {
          rosterCandidates = (ALL_STUDENTS || []).filter(s => String(s.assigned_teacher_id || '') === String(teacherId));
        }
      } catch (err) {
        rosterCandidates = (ALL_STUDENTS || []).filter(s => String(s.assigned_teacher_id || '') === String(teacherId));
      }

      // Filter strictly to active students belonging to active families
      const teacherAssigned = rosterCandidates.filter(s =>
        String(s.assigned_teacher_id || '') === String(teacherId) &&
        (typeof isActiveStudentRecord === 'function' ? isActiveStudentRecord(s) : (String(s.status || '').toLowerCase() !== 'inactive' && String(s.status || '').toLowerCase() !== 'deactivated'))
      );

      let html = '';
      if (teacherAssigned.length > 0) {
        html += `<optgroup label="🎯 Roster Students Assigned to ${CURRENT_MATRIX_TEACHER.full_name}">`;
        teacherAssigned.forEach(s => {
          const prof = cachedProfiles[s.id] || {};
          const days = prof.days_per_week || s.days_per_week || 'Roster Student';
          html += `<option value="${s.id}">${s.name} (${s.id}) &bull; ${days}</option>`;
        });
        html += `</optgroup>`;
      } else {
        html = `<option value="">No active students on ${CURRENT_MATRIX_TEACHER.full_name}'s roster.</option>`;
      }

      select.innerHTML = html;
    }

    async function openSlotBookingModal(day, startTime, endTime) {
      ACTIVE_DAY = Number(day) || 1;
      ACTIVE_START_TIME = startTime;
      ACTIVE_END_TIME = endTime;

      await loadStudentsForBooking();

      const occupiedDays = new Set(
        (CURRENT_TEACHER_SCHEDULES || [])
          .filter(s => String(s.start_time || '').slice(0, 5) === startTime)
          .map(s => Number(s.day_of_week))
      );

      const checkboxes = Array.from(document.querySelectorAll('input[name="bookSlotWeekday"]'));
      checkboxes.forEach(cb => {
        const dNum = Number(cb.value);
        cb.checked = (dNum === ACTIVE_DAY);
      });
      updateBookingWeekdaySelectionUI();

      const hintEl = document.getElementById('bookSlotOccupiedHint');
      if (hintEl) {
        if (occupiedDays.size > 0) {
          const occupiedLabels = Array.from(occupiedDays).sort((a, b) => a - b).map(d => DAY_NAMES[d]).join(', ');
          hintEl.textContent = `Note: ${startTime} is already booked on: ${occupiedLabels}.`;
          hintEl.classList.remove('hidden');
        } else {
          hintEl.textContent = '';
          hintEl.classList.add('hidden');
        }
      }

      const displayEl = document.getElementById('bookSlotDisplay');
      if (displayEl) {
        displayEl.value = `${DAY_NAMES[ACTIVE_DAY]} • ${startTime} to ${endTime} (30 Mins)`;
      }
      openModal('modalBookSlot');
    }

    async function handleConfirmSlotBooking(e) {
      e.preventDefault();
      const student_id = document.getElementById('bookStudentSelect').value;
      const meeting_link = document.getElementById('bookMeetingLink').value.trim();

      if (!student_id) {
        alert('Please select an active student from this teacher\'s roster.');
        return;
      }

      const targetDays = Array.from(document.querySelectorAll('input[name="bookSlotWeekday"]:checked'))
        .map(cb => Number(cb.value))
        .filter(d => d >= 1 && d <= 7);

      if (targetDays.length === 0) {
        alert('Please select at least one weekday (Monday through Sunday) for this class.');
        return;
      }

      if (!CURRENT_MATRIX_TEACHER || !CURRENT_MATRIX_TEACHER.id) {
        alert('No teacher selected for scheduling.');
        return;
      }

      if (typeof validateEligibleTeacherBackend === 'function') {
        const check = await validateEligibleTeacherBackend(CURRENT_MATRIX_TEACHER.id);
        if (!check.valid) {
          alert(check.error);
          return;
        }
      }

      // Backend validation: ensure selected student belongs to this teacher's roster and is active
      const { data: stuRecord, error: stuErr } = await db.from('students')
        .select('id, name, status, assigned_teacher_id, family_id, families(id, status)')
        .eq('id', student_id)
        .single();

      if (stuErr || !stuRecord) {
        alert('Backend Validation Failed: Student record could not be verified.');
        return;
      }

      if (String(stuRecord.assigned_teacher_id || '') !== String(CURRENT_MATRIX_TEACHER.id || '')) {
        alert('Backend Validation Failed: This student does not belong to this teacher\'s roster. Only students assigned to this teacher can be scheduled.');
        return;
      }

      const isStuActive = typeof isActiveStudentRecord === 'function'
        ? isActiveStudentRecord(stuRecord)
        : (String(stuRecord.status || '').toLowerCase() !== 'inactive' && String(stuRecord.status || '').toLowerCase() !== 'deactivated');

      if (!isStuActive) {
        alert('Backend Validation Failed: Deactivated students or students belonging to a deactivated family cannot be scheduled.');
        return;
      }

      // Filter out any selected day where this exact teacher + day + start_time is already occupied
      const existingOccupiedDays = new Set(
        (CURRENT_TEACHER_SCHEDULES || [])
          .filter(s => String(s.start_time || '').slice(0, 5) === ACTIVE_START_TIME)
          .map(s => Number(s.day_of_week))
      );

      const daysToInsert = targetDays.filter(d => !existingOccupiedDays.has(d));
      if (daysToInsert.length === 0) {
        alert(`The ${ACTIVE_START_TIME} slot is already occupied on the selected day(s).`);
        return;
      }

      const rows = daysToInsert.map(d => ({
        student_id,
        teacher_id: CURRENT_MATRIX_TEACHER.id,
        day_of_week: d,
        start_time: ACTIVE_START_TIME,
        end_time: ACTIVE_END_TIME,
        meeting_link,
        status: 'Active'
      }));

      const { error } = await db.from('class_schedules').insert(rows);

      if (error) {
        alert('Error booking slot: ' + error.message);
      } else {
        closeModal('modalBookSlot');
        await fetchTeacherSchedules();
        render2DMatrixTable();
        if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
        if (typeof _TEACHER_360_MEM_CACHE === 'object' && CURRENT_MATRIX_TEACHER?.id) {
          delete _TEACHER_360_MEM_CACHE[String(CURRENT_MATRIX_TEACHER.id).toUpperCase()];
        }
        loadTeachers();
        if (document.getElementById('tab-schedule-search') && !document.getElementById('tab-schedule-search').classList.contains('hidden')) {
          executeScheduleSearch();
        }
      }
    }

    function openMatrixSlotActionModal(scheduleId) {
      if (CURRENT_ROLE === 'manager') {
        alert("Access Denied: Managers are not authorized to permanently delete class schedule allocations. Only the System Owner can perform permanent deletions.");
        return;
      }

      const slot = (CURRENT_TEACHER_SCHEDULES || []).find(s => String(s.id) === String(scheduleId));
      if (!slot) return;

      const stuName = slot.students?.name || (ALL_STUDENTS || []).find(st => String(st.id) === String(slot.student_id))?.name || 'Student';
      const dayLabel = DAY_NAMES[Number(slot.day_of_week)] || `Day ${slot.day_of_week}`;
      const startTime = String(slot.start_time || '').slice(0, 5);
      const endTime = String(slot.end_time || '').slice(0, 5);
      const teacherName = CURRENT_MATRIX_TEACHER?.full_name || 'Assigned Teacher';

      ACTIVE_SLOT_ACTION_CONTEXT = {
        scheduleId: slot.id,
        studentId: slot.student_id,
        studentName: stuName,
        teacherId: slot.teacher_id || CURRENT_MATRIX_TEACHER?.id,
        dayOfWeek: slot.day_of_week,
        dayLabel,
        startTime,
        endTime
      };

      const nameEl = document.getElementById('slotActionStudentName');
      const idEl = document.getElementById('slotActionStudentId');
      const timeEl = document.getElementById('slotActionDayAndTime');
      const teacherEl = document.getElementById('slotActionTeacherName');
      const singleDayLabelEl = document.getElementById('slotActionSingleDayLabel');
      const confirmMsgEl = document.getElementById('slotActionConfirmMessage');

      if (nameEl) nameEl.textContent = stuName;
      if (idEl) idEl.textContent = slot.student_id || '';
      if (timeEl) timeEl.textContent = `${dayLabel} • ${startTime}${endTime ? ' - ' + endTime : ''}`;
      if (teacherEl) teacherEl.textContent = teacherName;
      if (singleDayLabelEl) singleDayLabelEl.textContent = `${dayLabel} (${startTime})`;
      if (confirmMsgEl) confirmMsgEl.textContent = `Delete all scheduled classes for ${stuName} with this teacher?`;

      cancelDeleteAllClassesConfirm();
      openModal('modalMatrixSlotActions');
    }

    function promptDeleteAllClassesConfirm() {
      const primaryEl = document.getElementById('slotActionPrimaryOptions');
      const confirmEl = document.getElementById('slotActionConfirmDeleteAll');
      if (primaryEl) primaryEl.classList.add('hidden');
      if (confirmEl) confirmEl.classList.remove('hidden');
    }

    function cancelDeleteAllClassesConfirm() {
      const primaryEl = document.getElementById('slotActionPrimaryOptions');
      const confirmEl = document.getElementById('slotActionConfirmDeleteAll');
      if (primaryEl) primaryEl.classList.remove('hidden');
      if (confirmEl) confirmEl.classList.add('hidden');
    }

    async function refreshMatrixAndSchedulesAfterDelete() {
      await fetchTeacherSchedules();
      render2DMatrixTable();
      if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
      if (typeof _TEACHER_360_MEM_CACHE === 'object' && CURRENT_MATRIX_TEACHER?.id) {
        delete _TEACHER_360_MEM_CACHE[String(CURRENT_MATRIX_TEACHER.id).toUpperCase()];
      }
      loadTeachers();
      if (document.getElementById('tab-schedule-search') && !document.getElementById('tab-schedule-search').classList.contains('hidden')) {
        executeScheduleSearch();
      }
    }

    async function executeDeleteSingleDayClass() {
      if (!ACTIVE_SLOT_ACTION_CONTEXT || !ACTIVE_SLOT_ACTION_CONTEXT.scheduleId) return;
      const { scheduleId } = ACTIVE_SLOT_ACTION_CONTEXT;

      const { error } = await db.from('class_schedules').delete().eq('id', scheduleId);
      if (error) {
        alert('Error deleting this day\'s class: ' + error.message);
        return;
      }

      closeModal('modalMatrixSlotActions');
      ACTIVE_SLOT_ACTION_CONTEXT = null;
      await refreshMatrixAndSchedulesAfterDelete();
    }

    async function executeDeleteAllClassesForStudent() {
      if (!ACTIVE_SLOT_ACTION_CONTEXT || !ACTIVE_SLOT_ACTION_CONTEXT.studentId || !ACTIVE_SLOT_ACTION_CONTEXT.teacherId) return;
      const { studentId, teacherId } = ACTIVE_SLOT_ACTION_CONTEXT;

      const { error } = await db.from('class_schedules')
        .delete()
        .eq('teacher_id', teacherId)
        .eq('student_id', studentId);

      if (error) {
        alert('Error deleting all scheduled classes for student: ' + error.message);
        return;
      }

      closeModal('modalMatrixSlotActions');
      ACTIVE_SLOT_ACTION_CONTEXT = null;
      await refreshMatrixAndSchedulesAfterDelete();
    }

    async function handleDeleteSlot(scheduleId) {
      openMatrixSlotActionModal(scheduleId);
    }

    async function loadAttendanceList() {
      const tbody = document.getElementById('attendanceTableBody');
      if (!tbody) return;
      const dateInput = document.getElementById('attendanceDateSelect');
      const date = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);
      const dObj = new Date(date);
      const day = dObj.getDay() === 0 ? 7 : dObj.getDay();

      const { data: scheds } = await db.from('class_schedules')
        .select('*, students(name), teachers(full_name)')
        .eq('day_of_week', day);

      const { data: logs } = await db.from('attendance_logs').select('*').eq('date', date);
      const logsMap = {};
      (logs || []).forEach(l => logsMap[l.schedule_id] = l);

      if (!scheds || scheds.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">No classes scheduled on this day.</td></tr>';
        return;
      }

      tbody.innerHTML = scheds.map(s => {
        const log = logsMap[s.id];
        const status = log?.status || 'Pending';
        const notes = log?.lesson_notes || '';
        const sNameSafe = (s.students?.name || 'Student').replace(/'/g, "\\'");
        const tNameSafe = (s.teachers?.full_name || 'Teacher').replace(/'/g, "\\'");

        return `
          <tr class="hover:bg-slate-50">
            <td class="p-3 font-mono font-bold">${s.start_time.slice(0,5)} - ${s.end_time.slice(0,5)}</td>
            <td class="p-3 font-bold text-slate-900">${s.students?.name || 'Student'}</td>
            <td class="p-3 text-brandDark">${s.teachers?.full_name || 'Teacher'}</td>
            <td class="p-3">
              <div class="flex gap-1 flex-wrap">
                <button onclick="saveAttendance('${s.id}', '${s.student_id}', '${s.teacher_id}', 'Present')" class="px-2.5 py-1 rounded text-xs font-bold ${status === 'Present' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-emerald-100'}">Present</button>
                <button onclick="saveAttendance('${s.id}', '${s.student_id}', '${s.teacher_id}', 'Advance Class')" class="px-2.5 py-1 rounded text-xs font-bold ${status === 'Advance Class' ? 'bg-purple-600 text-white shadow-xs' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'}">Advance</button>
                <button onclick="saveAttendance('${s.id}', '${s.student_id}', '${s.teacher_id}', 'Absent')" class="px-2.5 py-1 rounded text-xs font-bold ${status === 'Absent' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-red-100'}">Absent</button>
                <button onclick="saveAttendance('${s.id}', '${s.student_id}', '${s.teacher_id}', 'Leave')" class="px-2.5 py-1 rounded text-xs font-bold ${status === 'Leave' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-blue-100'}">Leave</button>
              </div>
            </td>
            <td class="p-3">
              <input type="text" id="note_${s.id}" value="${notes}" placeholder="e.g. Surah Baqarah v1-5 recited" class="w-full text-xs p-1.5 border rounded">
            </td>
            <td class="p-3 text-right">
              <div class="flex items-center justify-end gap-1.5">
                <button onclick="requestTimeChangeFromIndex('${s.id}', '${s.student_id}', '${s.teacher_id}', '${s.start_time.slice(0,5)}', '${s.end_time.slice(0,5)}', '${sNameSafe}', '${tNameSafe}')" class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-300 rounded text-xs font-bold flex items-center gap-1 transition" title="Request Manager/Owner to change this student's schedule time">
                  <i class="fa-solid fa-clock-rotate-left text-indigo-600"></i> Change Time
                </button>
                <button onclick="saveAttendance('${s.id}', '${s.student_id}', '${s.teacher_id}', '${status}')" class="px-3 py-1 bg-slate-800 text-white rounded text-xs font-bold hover:bg-black" title="Save"><i class="fa-solid fa-floppy-disk"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    async function requestTimeChangeFromIndex(scheduleId, studentId, teacherId, oldStart, oldEnd, studentName, teacherName) {
      const newStartInput = await lmsPrompt(
        `Request Schedule Time Change for ${studentName}\n\nCurrent Scheduled Time: ${oldStart} - ${oldEnd} PKT\nEnter New Start Time (24-hour format HH:MM, e.g. 18:30 for 6:30 PM PKT):`,
        "18:00",
        { title: 'Request Schedule Time Change', subtitle: `${studentName} • Current: ${oldStart} - ${oldEnd} PKT`, confirmText: 'Next' }
      );
      if (!newStartInput) return;

      const m = newStartInput.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) {
        alert("Invalid time format. Please enter HH:MM (e.g., 18:30 or 16:00).");
        return;
      }
      const sH = parseInt(m[1], 10);
      const sM = parseInt(m[2], 10);
      if (sH < 0 || sH > 23 || (sM !== 0 && sM !== 30)) {
        alert("Please enter a valid 30-minute slot time ending in :00 or :30 (e.g. 17:00, 17:30, 18:00).");
        return;
      }

      const endTotal = sH * 60 + sM + 30;
      const eH = Math.floor(endTotal / 60) % 24;
      const eM = endTotal % 60;
      const newStart24 = `${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}`;
      const newEnd24 = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`;

      const reason = (await lmsPrompt("Enter reason for requesting this schedule time change:", "Parent / Student requested new class timing", { title: 'Schedule Change Reason', confirmText: 'Submit Request' })) || "Schedule adjustment";

      try {
        const { data: st, error } = await db.from('students').select('*').eq('id', studentId).single();
        if (error || !st) throw new Error("Student record not found.");

        let meta = {};
        try { meta = JSON.parse(st.notes || '{}'); } catch (e) { meta = { text: st.notes || '' }; }

        meta.time_change_request = {
          id: 'TIMEREQ-' + Date.now(),
          type: 'time_change_request',
          student_id: studentId,
          student_name: studentName,
          schedule_id: scheduleId,
          teacher_id: teacherId,
          teacher_name: teacherName,
          old_start_time: oldStart + ':00',
          old_end_time: oldEnd + ':00',
          old_slot_label: `${oldStart} - ${oldEnd} PKT`,
          new_start_time: newStart24 + ':00',
          new_end_time: newEnd24 + ':00',
          new_slot_label: `${newStart24} - ${newEnd24} PKT`,
          scope: 'all_days',
          reason: reason,
          notes: '',
          status: 'pending',
          requested_at: new Date().toISOString()
        };

        const { error: upErr } = await db.from('students').update({
          notes: JSON.stringify(meta)
        }).eq('id', studentId);
        if (upErr) throw upErr;

        alert(`✅ Time Change Request Sent to Manager / Owner Portal!\n\nStudent: ${studentName}\nOld Time: ${oldStart} - ${oldEnd} PKT\nRequested New Time: ${newStart24} - ${newEnd24} PKT\n\nOnce approved by the Manager or Owner, the schedule will automatically update!`);
        await checkLeaveReturnAlertsAndRequests(false);
      } catch (err) {
        alert("Error submitting time change request: " + err.message);
      }
    }

    async function saveAttendance(schedule_id, student_id, teacher_id, status) {
      const date = document.getElementById('attendanceDateSelect').value;
      const noteInput = document.getElementById('note_' + schedule_id);
      const lesson_notes = noteInput ? noteInput.value.trim() : '';

      await db.from('attendance_logs').upsert([{
        schedule_id,
        student_id,
        teacher_id,
        date,
        status: status === 'Pending' ? 'Present' : status,
        lesson_notes
      }], { onConflict: 'schedule_id,date' });

      loadAttendanceList();
      loadLiveMonitorData();
    }
