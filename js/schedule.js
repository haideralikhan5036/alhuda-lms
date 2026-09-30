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

      // Populate Assigned Student List & Active Trials Bar
      const studentsListEl = document.getElementById('matrixTeacherStudentsList');
      if (studentsListEl) {
        const assignedStudents = (ALL_STUDENTS || []).filter(s => {
          if (String(s.assigned_teacher_id || '') !== String(teacherId || '')) return false;
          if (s.status === 'Trial' || s.status === 'Converted') return false;
          if (typeof isActiveStudentRecord === 'function' && !isActiveStudentRecord(s)) return false;
          const stLow = String(s.status || '').trim().toLowerCase();
          if (stLow === 'leave') return false;
          try {
            const meta = typeof s.notes === 'string' ? JSON.parse(s.notes || '{}') : (s.notes || {});
            if (meta && meta.on_leave === true) return false;
          } catch (e) {}
          return true;
        });
        const assignedTrials = (ALL_TRIALS || []).filter(t => t.teacher_id === teacherId && t.status !== 'Discontinued');

        if (assignedStudents.length === 0 && assignedTrials.length === 0) {
          studentsListEl.innerHTML = `<span class="text-slate-400 italic text-[11px]">No active students in this teacher's Student List yet.</span>`;
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

      // Populate Professional Teacher Switcher Dropdown in Matrix Header
      const switcherSel = document.getElementById('matrixTeacherSwitcherSelect');
      if (switcherSel) {
        const teachingStaff = (typeof getEligibleTeachers === 'function')
          ? getEligibleTeachers(ALL_TEACHERS || [])
          : (ALL_TEACHERS || []).filter(t => t.status !== 'Inactive' && t.status !== 'Terminated');
        switcherSel.innerHTML = teachingStaff.map(t =>
          `<option value="${t.id}" ${String(t.id) === String(teacherId) ? 'selected' : ''}>👨‍🏫 ${t.full_name} (${t.working_shift || 'Shift'})</option>`
        ).join('');
        switcherSel.value = teacherId;
        if (typeof initCustomSelect === 'function') {
          initCustomSelect('matrixTeacherSwitcherSelect');
        }
      }

      openModal('modalScheduleMatrix');
      await fetchTeacherSchedules();
      render2DMatrixTable();
    }

    async function onMatrixTeacherSwitcherChange(newTeacherId) {
      if (!newTeacherId) return;
      const t = (ALL_TEACHERS || []).find(x => String(x.id) === String(newTeacherId));
      if (!t) return;
      await openTeacherScheduleMatrix(t.id, t.full_name, t.rate_per_slot || 0, t.working_shift || 'Shift');
    }

    async function fetchTeacherSchedules() {
      if (!CURRENT_MATRIX_TEACHER || !CURRENT_MATRIX_TEACHER.id) return;
      const { data: scheds } = await db.from('class_schedules')
        .select('*, students(id, name, status, notes, family_id, assigned_teacher_id)')
        .eq('teacher_id', CURRENT_MATRIX_TEACHER.id);
      CURRENT_TEACHER_SCHEDULES = (scheds || []).filter(slot => {
        const stuObj = (ALL_STUDENTS || []).find(s => String(s.id) === String(slot.student_id)) || slot.students;
        if (stuObj && typeof isStudentSelfDeactivated === 'function' && isStudentSelfDeactivated(stuObj)) {
          db.from('class_schedules').delete().eq('id', slot.id).then(() => {});
          return false;
        }
        const assignedTch = stuObj?.assigned_teacher_id || slot.students?.assigned_teacher_id;
        if (assignedTch && String(assignedTch) !== String(CURRENT_MATRIX_TEACHER.id)) {
          db.from('class_schedules').delete().eq('id', slot.id).then(() => {});
          return false;
        }
        return true;
      });
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

    function parseScheduleTimeToMinutes(timeStr, isEnd = false, startMinRef = 0) {
      if (!timeStr) return 0;
      const parts = String(timeStr).trim().slice(0, 5).split(':').map(Number);
      if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return 0;
      const total = parts[0] * 60 + parts[1];
      if (isEnd && total === 0 && startMinRef > 0) return 1440; // 24:00 midnight end
      return total;
    }

    function formatMinutesToTime24(totalMin) {
      const clamped = ((totalMin % 1440) + 1440) % 1440;
      const h = Math.floor(clamped / 60);
      const m = clamped % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    function formatTime24To12hLabel(timeStr) {
      if (!timeStr) return '--:--';
      const [h, m] = String(timeStr).trim().slice(0, 5).split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return timeStr;
      const period = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
    }

    function getScheduleDurationMinutes(startTime, endTime) {
      const sMin = parseScheduleTimeToMinutes(startTime, false);
      const eMin = parseScheduleTimeToMinutes(endTime, true, sMin);
      return eMin - sMin;
    }

    function formatScheduleDurationBadge(durationMin) {
      if (durationMin <= 0) return 'Invalid';
      if (durationMin === 60) return '60m (1h)';
      if (durationMin > 60 && durationMin % 60 === 0) return `${durationMin}m (${durationMin / 60}h)`;
      return `${durationMin}m`;
    }

    function findTeacherScheduleConflicts(schedulesList, dayOfWeek, newStartStr, newEndStr, ignoreIdsSet = new Set()) {
      const newStartMin = parseScheduleTimeToMinutes(newStartStr, false);
      const newEndMin = parseScheduleTimeToMinutes(newEndStr, true, newStartMin);
      const conflicts = [];
      if (newEndMin <= newStartMin) return conflicts;

      (schedulesList || []).forEach(sc => {
        if (ignoreIdsSet && ignoreIdsSet.has(String(sc.id))) return;
        if (Number(sc.day_of_week) !== Number(dayOfWeek)) return;
        const stuObj = (ALL_STUDENTS || []).find(st => String(st.id) === String(sc.student_id)) || sc.students;
        if (stuObj && typeof isStudentSelfDeactivated === 'function' && isStudentSelfDeactivated(stuObj)) return;

        const exStartStr = String(sc.start_time || '').slice(0, 5);
        const exEndStr = String(sc.end_time || '').slice(0, 5);
        const exStartMin = parseScheduleTimeToMinutes(exStartStr, false);
        let exEndMin = parseScheduleTimeToMinutes(exEndStr, true, exStartMin);
        if (exEndMin <= exStartMin) exEndMin = exStartMin + 30;

        if (newStartMin < exEndMin && newEndMin > exStartMin) {
          conflicts.push({
            schedule: sc,
            studentName: stuObj?.name || sc.students?.name || sc.student_id || 'Booked Student',
            startTime: exStartStr,
            endTime: exEndStr
          });
        }
      });
      return conflicts;
    }

    function render2DMatrixTable() {
      const tbody = document.getElementById('matrix2DTableBody');
      if (!tbody) return;
      tbody.innerHTML = '';

      const activeSchedules = (CURRENT_TEACHER_SCHEDULES || []).filter(s => {
        const stuObj = (ALL_STUDENTS || []).find(st => String(st.id) === String(s.student_id)) || s.students;
        if (stuObj && typeof isStudentSelfDeactivated === 'function' && isStudentSelfDeactivated(stuObj)) {
          return false;
        }
        return true;
      });

      const shiftStr = CURRENT_MATRIX_TEACHER ? (CURRENT_MATRIX_TEACHER.working_shift || '') : '';

      for (let hour = 0; hour < 24; hour++) {
        for (let min of [0, 30]) {
          const hStr = String(hour).padStart(2, '0');
          const mStr = String(min).padStart(2, '0');
          const startTime = `${hStr}:${mStr}`;
          const rowStartMin = hour * 60 + min;
          const rowEndMin = rowStartMin + 30;

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
            const overlappingSlots = activeSchedules.filter(s => {
              if (Number(s.day_of_week) !== day) return false;
              const sStartMin = parseScheduleTimeToMinutes(s.start_time, false);
              let sEndMin = parseScheduleTimeToMinutes(s.end_time, true, sStartMin);
              if (sEndMin <= sStartMin) sEndMin = sStartMin + 30;
              return sStartMin < rowEndMin && sEndMin > rowStartMin;
            });

            const slot = overlappingSlots[0] || null;

            if (slot) {
              const stuStatus = slot.students?.status;
              const isTrialSlot = slot.status === 'Trial' || stuStatus === 'Trial';
              const stuName = slot.students?.name || (ALL_STUDENTS || []).find(st => String(st.id) === String(slot.student_id))?.name || 'Student';
              const actualStart = String(slot.start_time || '').slice(0, 5);
              const actualEnd = String(slot.end_time || '').slice(0, 5);
              const durMins = getScheduleDurationMinutes(actualStart, actualEnd);
              const durLabel = durMins > 0 ? `${durMins}m` : '30m';
              const timeRangeBadge = `<span class="px-1.5 py-0.2 rounded bg-slate-100 text-slate-800 border border-slate-300 font-mono font-bold text-[9px]" title="Actual Scheduled Time: ${actualStart} - ${actualEnd} (${durLabel})">${actualStart}-${actualEnd} (${durLabel})</span>`;

              if (isTrialSlot) {
                daysCells += `
                  <td class="p-1 text-center bg-purple-50/90 border border-purple-200">
                    <div onclick="openMatrixSlotActionModal('${slot.id}')" class="flex flex-col justify-between p-1.5 rounded-lg bg-white shadow-2xs border border-purple-300 gap-1 cursor-pointer hover:border-purple-500 transition" title="Click to manage scheduled class (${actualStart} - ${actualEnd}, ${durLabel})">
                      <div class="flex items-center justify-between gap-1">
                        <span class="font-extrabold text-[11px] text-purple-950 truncate" title="${stuName}">
                          <i class="fa-solid fa-star text-amber-500"></i> ${stuName}
                        </span>
                        <span class="px-1 py-0.2 rounded text-[8px] font-black bg-purple-200 text-purple-900 border border-purple-300">TRIAL</span>
                      </div>
                      <div class="flex items-center justify-between gap-1">
                        ${timeRangeBadge}
                      </div>
                      <div class="flex items-center justify-between gap-1 mt-0.5">
                        <button onclick="event.stopPropagation(); convertTrialFromSchedule('${slot.student_id}')" class="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black rounded shadow-2xs flex items-center gap-0.5 transition" title="Regularize Student">
                          <i class="fa-solid fa-circle-check text-[8px]"></i> Regularize
                        </button>
                        <div class="flex items-center gap-1 ml-auto">
                          <button onclick="event.stopPropagation(); openShiftStudentModal('${slot.id}')" class="px-1.5 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[9px] font-extrabold flex items-center gap-0.5 transition" title="Shift Student to Another Teacher">
                            <i class="fa-solid fa-right-left text-[8px]"></i> Shift
                          </button>
                          ${CURRENT_ROLE !== 'manager' ? `
                            <button onclick="event.stopPropagation(); openMatrixSlotActionModal('${slot.id}')" class="px-1.5 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-[9px] font-extrabold flex items-center gap-0.5 transition" title="Manage / Delete Scheduled Class">
                              <i class="fa-solid fa-trash-can text-[8px]"></i> Delete
                            </button>
                          ` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                `;
              } else {
                daysCells += `
                  <td class="p-1 text-center bg-emerald-50/50 border border-emerald-200">
                    <div onclick="openMatrixSlotActionModal('${slot.id}')" class="flex flex-col justify-between p-1.5 rounded-lg bg-white shadow-2xs border border-emerald-300 gap-1 cursor-pointer hover:border-emerald-500 transition" title="Click to manage scheduled class (${actualStart} - ${actualEnd}, ${durLabel})">
                      <div class="flex items-center justify-between gap-1">
                        <span class="font-extrabold text-[11px] text-slate-900 truncate" title="${stuName}">
                          <i class="fa-solid fa-graduation-cap text-emerald-600"></i> ${stuName}
                        </span>
                        <span class="px-1 py-0.2 rounded text-[8px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">REGULAR</span>
                      </div>
                      <div class="flex items-center justify-between gap-1">
                        ${timeRangeBadge}
                        <span class="text-[9px] text-slate-400 font-mono truncate max-w-[48px]">${slot.student_id || ''}</span>
                      </div>
                      <div class="flex items-center justify-between gap-1 mt-0.5">
                        <div class="flex items-center gap-1 ml-auto">
                          <button onclick="event.stopPropagation(); openShiftStudentModal('${slot.id}')" class="px-1.5 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[9px] font-extrabold flex items-center gap-0.5 transition" title="Shift Student to Another Teacher">
                            <i class="fa-solid fa-right-left text-[8px]"></i> Shift
                          </button>
                          ${CURRENT_ROLE !== 'manager' ? `
                            <button onclick="event.stopPropagation(); openMatrixSlotActionModal('${slot.id}')" class="px-1.5 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-[9px] font-extrabold flex items-center gap-0.5 transition" title="Manage / Delete Scheduled Class">
                              <i class="fa-solid fa-trash-can text-[8px]"></i> Delete
                            </button>
                          ` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                `;
              }
            } else {
              daysCells += `
                <td onclick="openSlotBookingModal(${day}, '${startTime}', '${endTime}')" class="p-1.5 text-center ${isShiftSlot ? 'slot-vacant bg-emerald-50/60' : 'slot-vacant'} transition" title="Click to Book Student (${startTime} - ${endTime} or custom duration)">
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

    function setBookSlotQuickDuration(durationMinutes) {
      const startInput = document.getElementById('bookSlotStartTime');
      const endInput = document.getElementById('bookSlotEndTime');
      const startStr = (startInput && startInput.value) ? startInput.value.slice(0, 5) : (ACTIVE_START_TIME || '14:00');
      if (startInput) startInput.value = startStr;

      const startMin = parseScheduleTimeToMinutes(startStr, false);
      const targetEndMin = startMin + Number(durationMinutes || 30);
      const endStr = targetEndMin >= 1440 ? '23:59' : formatMinutesToTime24(targetEndMin);
      if (endInput) endInput.value = endStr;

      ACTIVE_START_TIME = startStr;
      ACTIVE_END_TIME = endStr;
      syncBookSlotTimingAndConflictUI();
    }

    function onBookSlotTimeChanged(changedField) {
      const startInput = document.getElementById('bookSlotStartTime');
      const endInput = document.getElementById('bookSlotEndTime');
      if (!startInput || !endInput) return;

      const startStr = (startInput.value || '').slice(0, 5);
      let endStr = (endInput.value || '').slice(0, 5);

      if (changedField === 'start' && startStr) {
        const curDur = getScheduleDurationMinutes(ACTIVE_START_TIME || '14:00', ACTIVE_END_TIME || '14:30');
        const safeDur = (curDur >= 15 && curDur <= 240) ? curDur : 30;
        const newEndMin = parseScheduleTimeToMinutes(startStr, false) + safeDur;
        endStr = newEndMin >= 1440 ? '23:59' : formatMinutesToTime24(newEndMin);
        endInput.value = endStr;
      }

      if (startStr) ACTIVE_START_TIME = startStr;
      if (endStr) ACTIVE_END_TIME = endStr;
      syncBookSlotTimingAndConflictUI();
    }

    function syncBookSlotTimingAndConflictUI() {
      const startInput = document.getElementById('bookSlotStartTime');
      const endInput = document.getElementById('bookSlotEndTime');
      const durBadge = document.getElementById('bookSlotDurationBadge');
      const displayEl = document.getElementById('bookSlotDisplay');
      const hintEl = document.getElementById('bookSlotOccupiedHint');
      const submitBtn = document.getElementById('btnConfirmSlotBookingSubmit');

      const startStr = (startInput && startInput.value) ? startInput.value.slice(0, 5) : ACTIVE_START_TIME;
      const endStr = (endInput && endInput.value) ? endInput.value.slice(0, 5) : ACTIVE_END_TIME;
      const durMins = getScheduleDurationMinutes(startStr, endStr);

      document.querySelectorAll('[data-book-dur]').forEach(btn => {
        const btnDur = Number(btn.getAttribute('data-book-dur'));
        if (btnDur === durMins) {
          btn.className = 'px-2 py-1 rounded-lg border border-emerald-600 bg-emerald-600 text-white font-extrabold text-[10px] shadow-2xs transition';
        } else {
          btn.className = 'px-2 py-1 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-600 hover:text-white text-emerald-900 font-extrabold text-[10px] transition';
        }
      });

      const selectedDays = Array.from(document.querySelectorAll('input[name="bookSlotWeekday"]:checked'))
        .map(cb => Number(cb.value))
        .filter(d => d >= 1 && d <= 7);
      const daySummary = selectedDays.length > 0
        ? selectedDays.map(d => DAY_NAMES[d]?.slice(0, 3)).join(', ')
        : (DAY_NAMES[ACTIVE_DAY] || 'Selected Day');

      if (durMins <= 0) {
        if (durBadge) {
          durBadge.textContent = 'Invalid: End <= Start';
          durBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold bg-rose-100 text-rose-800 border border-rose-300';
        }
        if (displayEl) {
          displayEl.value = `Invalid Time Range: End time (${endStr || '--:--'}) must be after Start time (${startStr || '--:--'})`;
        }
        if (submitBtn) submitBtn.disabled = true;
        return;
      }

      if (submitBtn) submitBtn.disabled = false;
      const durText = durMins === 60 ? '60 Mins (1 Hr)' : `${durMins} Mins`;
      if (durBadge) {
        durBadge.textContent = durText;
        durBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-300';
      }
      if (displayEl) {
        displayEl.value = `${daySummary} • ${formatTime24To12hLabel(startStr)} to ${formatTime24To12hLabel(endStr)} (${startStr}–${endStr} • ${durText})`;
      }

      if (hintEl) {
        const conflictMessages = [];
        for (let d = 1; d <= 7; d++) {
          const dayConflicts = findTeacherScheduleConflicts(CURRENT_TEACHER_SCHEDULES, d, startStr, endStr);
          if (dayConflicts.length > 0) {
            const first = dayConflicts[0];
            const isSelectedDay = selectedDays.includes(d);
            conflictMessages.push(`${isSelectedDay ? '⚠️ ' : ''}${DAY_NAMES[d]} (${first.studentName}: ${first.startTime}-${first.endTime})`);
          }
        }
        if (conflictMessages.length > 0) {
          hintEl.textContent = `Schedule overlap on: ${conflictMessages.join(', ')}.`;
          hintEl.className = 'text-[10px] text-amber-800 font-bold mt-1';
          hintEl.classList.remove('hidden');
        } else {
          hintEl.textContent = '';
          hintEl.classList.add('hidden');
        }
      }
    }

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
      syncBookSlotTimingAndConflictUI();
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

      // Filter strictly to active students belonging to this teacher's Student List (exclude deactivated & Leave)
      const teacherAssigned = rosterCandidates.filter(s => {
        if (String(s.assigned_teacher_id || '') !== String(teacherId)) return false;
        const isAct = typeof isActiveStudentRecord === 'function'
          ? isActiveStudentRecord(s)
          : (String(s.status || '').toLowerCase() !== 'inactive' && String(s.status || '').toLowerCase() !== 'deactivated');
        if (!isAct) return false;
        const stLow = String(s.status || '').trim().toLowerCase();
        if (stLow === 'leave') return false;
        try {
          const meta = typeof s.notes === 'string' ? JSON.parse(s.notes || '{}') : (s.notes || {});
          if (meta && meta.on_leave === true) return false;
        } catch (e) {}
        return true;
      });

      let html = '';
      if (teacherAssigned.length > 0) {
        html += `<optgroup label="Active Students in ${CURRENT_MATRIX_TEACHER.full_name}'s Student List">`;
        teacherAssigned.forEach(s => {
          const prof = cachedProfiles[s.id] || {};
          const days = prof.days_per_week || s.days_per_week || 'Assigned Student';
          html += `<option value="${s.id}">${s.name} (${s.id}) • ${days}</option>`;
        });
        html += `</optgroup>`;
      } else {
        html = `<option value="">No active students in ${CURRENT_MATRIX_TEACHER.full_name}'s Student List.</option>`;
      }

      select.innerHTML = html;
      if (typeof initCustomSelect === 'function') {
        initCustomSelect('bookStudentSelect');
      }
    }

    async function openSlotBookingModal(day, startTime, endTime) {
      ACTIVE_DAY = Number(day) || 1;
      ACTIVE_START_TIME = (startTime || '14:00').slice(0, 5);
      ACTIVE_END_TIME = (endTime || '14:30').slice(0, 5);

      await loadStudentsForBooking();

      const startInput = document.getElementById('bookSlotStartTime');
      const endInput = document.getElementById('bookSlotEndTime');
      if (startInput) startInput.value = ACTIVE_START_TIME;
      if (endInput) endInput.value = ACTIVE_END_TIME;

      const zoomInput = document.getElementById('bookMeetingLink');
      if (zoomInput && !zoomInput.value.trim() && CURRENT_MATRIX_TEACHER?.zoom_link) {
        zoomInput.value = CURRENT_MATRIX_TEACHER.zoom_link;
      }

      const checkboxes = Array.from(document.querySelectorAll('input[name="bookSlotWeekday"]'));
      checkboxes.forEach(cb => {
        const dNum = Number(cb.value);
        cb.checked = (dNum === ACTIVE_DAY);
      });
      updateBookingWeekdaySelectionUI();
      openModal('modalBookSlot');
    }

    async function handleConfirmSlotBooking(e) {
      e.preventDefault();
      const student_id = document.getElementById('bookStudentSelect').value;
      const meeting_link = (document.getElementById('bookMeetingLink').value || '').trim() || (CURRENT_MATRIX_TEACHER?.zoom_link || '').trim();
      const startTimeInput = (document.getElementById('bookSlotStartTime')?.value || ACTIVE_START_TIME || '').trim().slice(0, 5);
      const endTimeInput = (document.getElementById('bookSlotEndTime')?.value || ACTIVE_END_TIME || '').trim().slice(0, 5);

      if (!student_id) {
        alert('Please select an active student from this teacher\'s Student List.');
        return;
      }

      if (!startTimeInput || !endTimeInput) {
        alert('Please specify both a valid Start Time and End Time.');
        return;
      }

      const durationMins = getScheduleDurationMinutes(startTimeInput, endTimeInput);
      if (durationMins <= 0) {
        alert('Invalid Class Time Range: End Time must be after Start Time.');
        return;
      }

      ACTIVE_START_TIME = startTimeInput;
      ACTIVE_END_TIME = endTimeInput;

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

      // Backend validation: ensure selected student belongs to this teacher's Student List and is active
      const { data: stuRecord, error: stuErr } = await db.from('students')
        .select('id, name, status, notes, assigned_teacher_id, family_id, families(id, status)')
        .eq('id', student_id)
        .single();

      if (stuErr || !stuRecord) {
        alert('Backend Validation Failed: Student record could not be verified.');
        return;
      }

      if (String(stuRecord.assigned_teacher_id || '') !== String(CURRENT_MATRIX_TEACHER.id || '')) {
        alert('Backend Validation Failed: This student does not belong to this teacher\'s Student List. Only students assigned to this teacher can be scheduled.');
        return;
      }

      let isStuOnLeave = String(stuRecord.status || '').trim().toLowerCase() === 'leave';
      if (!isStuOnLeave) {
        try {
          const meta = typeof stuRecord.notes === 'string' ? JSON.parse(stuRecord.notes || '{}') : (stuRecord.notes || {});
          if (meta && meta.on_leave === true) isStuOnLeave = true;
        } catch (err) {}
      }

      const isStuActive = !isStuOnLeave && (typeof isActiveStudentRecord === 'function'
        ? isActiveStudentRecord(stuRecord)
        : (String(stuRecord.status || '').toLowerCase() !== 'inactive' && String(stuRecord.status || '').toLowerCase() !== 'deactivated'));

      if (!isStuActive) {
        alert('Backend Validation Failed: Students on Leave, deactivated students, or students belonging to a deactivated family cannot be scheduled.');
        return;
      }

      // Authoritative Conflict Check: check interval overlap across all selected days
      await fetchTeacherSchedules();
      const conflictingDetails = [];
      const daysToInsert = [];

      targetDays.forEach(d => {
        const conflicts = findTeacherScheduleConflicts(CURRENT_TEACHER_SCHEDULES, d, ACTIVE_START_TIME, ACTIVE_END_TIME);
        if (conflicts.length > 0) {
          const first = conflicts[0];
          conflictingDetails.push(`${DAY_NAMES[d]} (${first.studentName}: ${first.startTime} - ${first.endTime})`);
        } else {
          daysToInsert.push(d);
        }
      });

      if (conflictingDetails.length > 0) {
        alert(`Schedule Conflict Detected!\n\nThe requested class (${ACTIVE_START_TIME} - ${ACTIVE_END_TIME}, ${durationMins} mins) overlaps with an existing class for ${CURRENT_MATRIX_TEACHER.full_name}:\n• ${conflictingDetails.join('\n• ')}\n\nPlease choose a non-overlapping start/end time or deselect the conflicting day(s).`);
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

    function setSlotActionEditDuration(durationMinutes) {
      const sInput = document.getElementById('slotActionEditStartTime');
      const eInput = document.getElementById('slotActionEditEndTime');
      if (!sInput || !eInput) return;
      const startStr = (sInput.value || '14:00').slice(0, 5);
      const startMin = parseScheduleTimeToMinutes(startStr, false);
      const endMin = startMin + Number(durationMinutes || 30);
      eInput.value = endMin >= 1440 ? '23:59' : formatMinutesToTime24(endMin);
      onSlotActionEditTimeChange();
    }

    function onSlotActionEditTimeChange() {
      const sInput = document.getElementById('slotActionEditStartTime');
      const eInput = document.getElementById('slotActionEditEndTime');
      const badge = document.getElementById('slotActionEditDurationBadge');
      if (!sInput || !eInput || !badge) return;
      const dur = getScheduleDurationMinutes(sInput.value, eInput.value);
      if (dur <= 0) {
        badge.textContent = 'Invalid (End <= Start)';
        badge.className = 'px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-mono font-extrabold text-[10px]';
      } else {
        badge.textContent = `${dur} Mins`;
        badge.className = 'px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-mono font-extrabold text-[10px]';
      }
    }

    async function executeUpdateSlotTimeAndZoom() {
      if (!ACTIVE_SLOT_ACTION_CONTEXT || !ACTIVE_SLOT_ACTION_CONTEXT.scheduleId) return;
      const newStart = (document.getElementById('slotActionEditStartTime')?.value || '').trim().slice(0, 5);
      const newEnd = (document.getElementById('slotActionEditEndTime')?.value || '').trim().slice(0, 5);
      const newZoom = (document.getElementById('slotActionEditZoomLink')?.value || '').trim();
      const applyAll = Boolean(document.getElementById('slotActionEditApplyAllDays')?.checked);

      const dur = getScheduleDurationMinutes(newStart, newEnd);
      if (!newStart || !newEnd || dur <= 0) {
        alert('Invalid Time Range: End Time must be after Start Time.');
        return;
      }

      await fetchTeacherSchedules();
      const { scheduleId, studentId, teacherId, dayOfWeek } = ACTIVE_SLOT_ACTION_CONTEXT;

      const slotsToUpdate = applyAll
        ? (CURRENT_TEACHER_SCHEDULES || []).filter(s => String(s.student_id) === String(studentId) && String(s.teacher_id) === String(teacherId))
        : (CURRENT_TEACHER_SCHEDULES || []).filter(s => String(s.id) === String(scheduleId));

      const ignoreIds = new Set(slotsToUpdate.map(s => String(s.id)));
      const conflicts = [];
      slotsToUpdate.forEach(s => {
        const dayConflicts = findTeacherScheduleConflicts(CURRENT_TEACHER_SCHEDULES, s.day_of_week, newStart, newEnd, ignoreIds);
        if (dayConflicts.length > 0) {
          const first = dayConflicts[0];
          conflicts.push(`${DAY_NAMES[Number(s.day_of_week)]} (${first.studentName}: ${first.startTime} - ${first.endTime})`);
        }
      });

      if (conflicts.length > 0) {
        alert(`Schedule Conflict Detected!\n\nCannot update to ${newStart} - ${newEnd} (${dur} mins) because it overlaps with:\n• ${conflicts.join('\n• ')}`);
        return;
      }

      for (const s of slotsToUpdate) {
        const payload = { start_time: newStart, end_time: newEnd };
        if (newZoom) payload.meeting_link = newZoom;
        await db.from('class_schedules').update(payload).eq('id', s.id);
      }

      closeModal('modalMatrixSlotActions');
      await refreshMatrixAndSchedulesAfterDelete();
      if (typeof lmsNotify === 'function') {
        lmsNotify(`Updated class schedule to ${newStart} - ${newEnd} (${dur} Mins).`, { type: 'success', title: 'Schedule Updated' });
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
      const durMins = getScheduleDurationMinutes(startTime, endTime);
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
      const editStartEl = document.getElementById('slotActionEditStartTime');
      const editEndEl = document.getElementById('slotActionEditEndTime');
      const editZoomEl = document.getElementById('slotActionEditZoomLink');

      if (nameEl) nameEl.textContent = stuName;
      if (idEl) idEl.textContent = slot.student_id || '';
      if (timeEl) timeEl.textContent = `${dayLabel} • ${startTime}${endTime ? ' - ' + endTime : ''} (${durMins > 0 ? durMins + ' Mins' : '30 Mins'})`;
      if (teacherEl) teacherEl.textContent = teacherName;
      if (singleDayLabelEl) singleDayLabelEl.textContent = `${dayLabel} (${startTime} - ${endTime})`;
      if (confirmMsgEl) confirmMsgEl.textContent = `Delete all scheduled classes for ${stuName} with this teacher?`;
      if (editStartEl) editStartEl.value = startTime;
      if (editEndEl) editEndEl.value = endTime;
      if (editZoomEl) editZoomEl.value = slot.meeting_link || CURRENT_MATRIX_TEACHER?.zoom_link || '';
      onSlotActionEditTimeChange();

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

    // =========================================================================
    // WORKFLOW #1 — SHIFT STUDENT FROM ONE TEACHER TO ANOTHER TEACHER
    // =========================================================================
    let _SHIFT_MODAL_ACTIVE_STUDENT_SLOTS = [];

    function openShiftStudentFromSlotAction() {
      if (!ACTIVE_SLOT_ACTION_CONTEXT) return;
      const { scheduleId, studentId, teacherId } = ACTIVE_SLOT_ACTION_CONTEXT;
      closeModal('modalMatrixSlotActions');
      openShiftStudentModal(scheduleId || studentId, teacherId);
    }

    async function openShiftStudentModal(scheduleIdOrStudentId, explicitFromTeacherId = null) {
      const slot = (CURRENT_TEACHER_SCHEDULES || []).find(s => String(s.id) === String(scheduleIdOrStudentId));
      const studentId = slot ? slot.student_id : String(scheduleIdOrStudentId || '').trim();
      const fromTeacherId = explicitFromTeacherId || (slot ? slot.teacher_id : (CURRENT_MATRIX_TEACHER ? CURRENT_MATRIX_TEACHER.id : null));

      if (!studentId || !fromTeacherId) {
        if (typeof lmsNotify === 'function') {
          lmsNotify('Could not determine student or current teacher for shifting.', { type: 'error' });
        }
        return;
      }

      const stuObj = (ALL_STUDENTS || []).find(s => String(s.id) === String(studentId));
      const stuName = stuObj?.name || slot?.students?.name || studentId;
      const fromTchObj = (ALL_TEACHERS || []).find(t => String(t.id) === String(fromTeacherId)) || CURRENT_MATRIX_TEACHER;
      const fromTeacherName = fromTchObj?.full_name || fromTeacherId;

      // Fetch all active schedule slots for this student with Teacher A
      let studentSlots = [];
      try {
        const { data: dbSlots, error } = await db
          .from('class_schedules')
          .select('*')
          .eq('student_id', studentId)
          .eq('teacher_id', fromTeacherId);
        if (!error && Array.isArray(dbSlots)) {
          studentSlots = dbSlots;
        } else {
          studentSlots = (CURRENT_TEACHER_SCHEDULES || []).filter(
            s => String(s.student_id) === String(studentId) && String(s.teacher_id) === String(fromTeacherId)
          );
        }
      } catch (e) {
        studentSlots = (CURRENT_TEACHER_SCHEDULES || []).filter(
          s => String(s.student_id) === String(studentId) && String(s.teacher_id) === String(fromTeacherId)
        );
      }

      studentSlots.sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week) || String(a.start_time).localeCompare(String(b.start_time)));
      _SHIFT_MODAL_ACTIVE_STUDENT_SLOTS = studentSlots;

      // Populate modal UI fields
      const stuIdInput = document.getElementById('shiftModalStudentId');
      const fromTchInput = document.getElementById('shiftModalFromTeacherId');
      const currTchEl = document.getElementById('shiftModalCurrentTeacherName');
      const stuNameEl = document.getElementById('shiftModalStudentName');
      const stuCodeEl = document.getElementById('shiftModalStudentCode');
      const slotsSummaryEl = document.getElementById('shiftModalSlotsSummary');
      const selectEl = document.getElementById('shiftModalTargetTeacherSelect');
      const conflictBox = document.getElementById('shiftModalConflictBox');

      if (stuIdInput) stuIdInput.value = studentId;
      if (fromTchInput) fromTchInput.value = fromTeacherId;
      if (currTchEl) currTchEl.textContent = `${fromTeacherName} (${fromTeacherId})`;
      if (stuNameEl) stuNameEl.textContent = stuName;
      if (stuCodeEl) stuCodeEl.textContent = studentId;
      if (conflictBox) conflictBox.classList.add('hidden');

      if (slotsSummaryEl) {
        if (studentSlots.length === 0) {
          slotsSummaryEl.innerHTML = `<span class="text-slate-400 italic">Roster assignment only (no weekly slots currently booked)</span>`;
        } else {
          slotsSummaryEl.innerHTML = studentSlots.map(s => {
            const dName = DAY_NAMES[Number(s.day_of_week)] || `Day ${s.day_of_week}`;
            const st = String(s.start_time || '').slice(0, 5);
            const et = String(s.end_time || '').slice(0, 5);
            return `<span class="inline-block px-2 py-0.5 mr-1 mb-1 rounded bg-indigo-50 text-indigo-900 border border-indigo-200 font-mono text-[10px] font-bold">${dName} • ${st}${et ? '-' + et : ''}</span>`;
          }).join('');
        }
      }

      // Populate Shift To dropdown with ONLY eligible active teachers, excluding Teacher A and Managers
      const eligibleTeachers = (typeof getEligibleTeachers === 'function'
        ? getEligibleTeachers(ALL_TEACHERS)
        : (ALL_TEACHERS || []).filter(t => String(t.status || 'Active').toLowerCase() === 'active')
      ).filter(t => String(t.id) !== String(fromTeacherId));

      if (selectEl) {
        if (eligibleTeachers.length === 0) {
          selectEl.innerHTML = `<option value="">-- No other active eligible teachers available --</option>`;
        } else {
          selectEl.innerHTML = `<option value="">-- Select Target Teacher --</option>` +
            eligibleTeachers.map(t => `<option value="${t.id}">${t.full_name} (${t.id})${t.working_shift ? ' • ' + t.working_shift.split('(')[0].trim() : ''}</option>`).join('');
        }
      }

      openModal('modalShiftStudentTeacher');
    }

    async function handleShiftTargetTeacherChange(targetTeacherId) {
      const conflictBox = document.getElementById('shiftModalConflictBox');
      const conflictMsgEl = document.getElementById('shiftModalConflictMessage');
      const conflictSubEl = document.getElementById('shiftModalConflictSubnote');
      const btnConfirm = document.getElementById('btnConfirmShiftStudent');
      const btnPartial = document.getElementById('btnShiftNonConflictingAndReschedule');

      if (conflictBox) conflictBox.classList.add('hidden');
      if (btnConfirm) btnConfirm.disabled = false;

      if (!targetTeacherId) return;

      const studentId = document.getElementById('shiftModalStudentId')?.value;
      const targetTchObj = (ALL_TEACHERS || []).find(t => String(t.id) === String(targetTeacherId));
      const targetTeacherName = targetTchObj?.full_name || targetTeacherId;

      if (_SHIFT_MODAL_ACTIVE_STUDENT_SLOTS.length === 0) return;

      try {
        const { data: targetSlots } = await db
          .from('class_schedules')
          .select('*, students(id, name, status)')
          .eq('teacher_id', targetTeacherId);

        const activeTargetSlots = (targetSlots || []).filter(ts => {
          if (String(ts.student_id) === String(studentId)) return false;
          const stObj = (ALL_STUDENTS || []).find(s => String(s.id) === String(ts.student_id)) || ts.students;
          if (stObj && typeof isStudentSelfDeactivated === 'function' && isStudentSelfDeactivated(stObj)) return false;
          return true;
        });

        const targetOccupiedMap = new Map();
        activeTargetSlots.forEach(ts => {
          const key = `${Number(ts.day_of_week)}_${String(ts.start_time || '').slice(0, 5)}`;
          targetOccupiedMap.set(key, ts);
        });

        const conflicts = [];
        _SHIFT_MODAL_ACTIVE_STUDENT_SLOTS.forEach(s => {
          const st = String(s.start_time || '').slice(0, 5);
          const key = `${Number(s.day_of_week)}_${st}`;
          if (targetOccupiedMap.has(key)) {
            const occupiedBy = targetOccupiedMap.get(key);
            conflicts.push({
              dayOfWeek: Number(s.day_of_week),
              dayLabel: DAY_NAMES[Number(s.day_of_week)] || `Day ${s.day_of_week}`,
              startTime: st,
              occupiedStudentName: occupiedBy.students?.name || occupiedBy.student_id || 'another student'
            });
          }
        });

        if (conflicts.length > 0 && conflictBox && conflictMsgEl) {
          const first = conflicts[0];
          conflictMsgEl.textContent = `Student cannot be shifted because ${targetTeacherName} has a schedule conflict for ${first.dayLabel} at ${first.startTime}.`;
          const nonConflictingCount = _SHIFT_MODAL_ACTIVE_STUDENT_SLOTS.length - conflicts.length;
          if (conflictSubEl) {
            const allConflictLabels = conflicts.map(c => `${c.dayLabel} at ${c.startTime} (booked with ${c.occupiedStudentName})`).join('; ');
            conflictSubEl.textContent = `Conflicting slot(s): ${allConflictLabels}. Existing classes on ${targetTeacherName}'s schedule will NOT be overwritten. You can choose another teacher, or transfer the student & ${nonConflictingCount} available slot(s) now and reschedule the conflicting day(s) on ${targetTeacherName}'s Schedule Matrix.`;
          }
          if (btnPartial) {
            btnPartial.textContent = nonConflictingCount > 0
              ? `Shift ${nonConflictingCount} Free Slot(s) & Reschedule Conflict`
              : `Move Student to ${targetTeacherName} & Open Matrix to Reschedule`;
          }
          conflictBox.classList.remove('hidden');
        }
      } catch (err) {
        console.warn('[handleShiftTargetTeacherChange] Conflict check notice:', err);
      }
    }

    async function executeConfirmShiftStudent(allowPartialOnConflict = false) {
      const studentId = document.getElementById('shiftModalStudentId')?.value;
      const fromTeacherId = document.getElementById('shiftModalFromTeacherId')?.value;
      const toTeacherId = document.getElementById('shiftModalTargetTeacherSelect')?.value;

      if (!studentId || !fromTeacherId) return;
      if (!toTeacherId) {
        if (typeof lmsNotify === 'function') {
          lmsNotify('Please select an eligible target teacher to shift this student to.', { type: 'warning', title: 'Select Target Teacher' });
        }
        return;
      }

      if (String(fromTeacherId) === String(toTeacherId)) {
        if (typeof lmsNotify === 'function') {
          lmsNotify('Target teacher must be different from the current teacher.', { type: 'warning' });
        }
        return;
      }

      if (typeof validateEligibleTeacherBackend === 'function') {
        const validation = await validateEligibleTeacherBackend(toTeacherId);
        if (!validation.valid) {
          if (typeof lmsNotify === 'function') {
            lmsNotify(validation.error || 'Selected person is not an eligible active teacher.', { type: 'error', title: 'Invalid Target Teacher' });
          }
          return;
        }
      }

      const stuObj = (ALL_STUDENTS || []).find(s => String(s.id) === String(studentId));
      const studentName = stuObj?.name || document.getElementById('shiftModalStudentName')?.textContent || studentId;
      const fromTchObj = (ALL_TEACHERS || []).find(t => String(t.id) === String(fromTeacherId)) || CURRENT_MATRIX_TEACHER;
      const toTchObj = (ALL_TEACHERS || []).find(t => String(t.id) === String(toTeacherId));
      const fromTeacherName = fromTchObj?.full_name || fromTeacherId;
      const toTeacherName = toTchObj?.full_name || toTeacherId;
      const toTeacherZoom = toTchObj?.zoom_link || '';

      // Fetch authoritative schedule rows for student (with Teacher A) and for Teacher B
      const [stuSchedRes, targetSchedRes] = await Promise.all([
        db.from('class_schedules').select('*').eq('student_id', studentId).eq('teacher_id', fromTeacherId),
        db.from('class_schedules').select('*, students(id, name, status)').eq('teacher_id', toTeacherId)
      ]);

      const studentSlots = Array.isArray(stuSchedRes.data) ? stuSchedRes.data : _SHIFT_MODAL_ACTIVE_STUDENT_SLOTS;
      const targetSlots = (targetSchedRes.data || []).filter(ts => {
        if (String(ts.student_id) === String(studentId)) return false;
        const stObj = (ALL_STUDENTS || []).find(s => String(s.id) === String(ts.student_id)) || ts.students;
        if (stObj && typeof isStudentSelfDeactivated === 'function' && isStudentSelfDeactivated(stObj)) return false;
        return true;
      });

      const targetOccupiedMap = new Map();
      targetSlots.forEach(ts => {
        const key = `${Number(ts.day_of_week)}_${String(ts.start_time || '').slice(0, 5)}`;
        targetOccupiedMap.set(key, ts);
      });

      const nonConflictingSlots = [];
      const conflictingSlots = [];

      studentSlots.forEach(s => {
        const st = String(s.start_time || '').slice(0, 5);
        const key = `${Number(s.day_of_week)}_${st}`;
        if (targetOccupiedMap.has(key)) {
          conflictingSlots.push({
            slot: s,
            dayLabel: DAY_NAMES[Number(s.day_of_week)] || `Day ${s.day_of_week}`,
            startTime: st
          });
        } else {
          nonConflictingSlots.push(s);
        }
      });

      if (conflictingSlots.length > 0 && !allowPartialOnConflict) {
        const first = conflictingSlots[0];
        await handleShiftTargetTeacherChange(toTeacherId);
        if (typeof lmsNotify === 'function') {
          lmsNotify(
            `Student cannot be shifted because ${toTeacherName} has a schedule conflict for ${first.dayLabel} at ${first.startTime}.`,
            { type: 'warning', title: 'Schedule Conflict Detected' }
          );
        }
        return;
      }

      const btnConfirm = document.getElementById('btnConfirmShiftStudent');
      const origBtnHtml = btnConfirm ? btnConfirm.innerHTML : '';
      if (btnConfirm) {
        btnConfirm.disabled = true;
        btnConfirm.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Shifting...`;
      }

      try {
        // 1. Update non-conflicting schedule slots in Supabase from Teacher A to Teacher B
        for (const s of nonConflictingSlots) {
          const updateFields = { teacher_id: toTeacherId };
          if (toTeacherZoom) updateFields.meeting_link = toTeacherZoom;
          await db.from('class_schedules').update(updateFields).eq('id', s.id);
        }

        // 2. If partial shift on conflict was chosen, remove conflicting slots from Teacher A so Teacher A never retains duplicate/stale schedule slots
        if (conflictingSlots.length > 0 && allowPartialOnConflict) {
          for (const c of conflictingSlots) {
            await db.from('class_schedules').delete().eq('id', c.slot.id);
          }
        }

        // 3. Update student's assigned_teacher_id and preserve shift audit trail in student.notes
        let stuMeta = {};
        if (stuObj && stuObj.notes) {
          try {
            stuMeta = typeof stuObj.notes === 'string' ? JSON.parse(stuObj.notes) : { ...stuObj.notes };
          } catch (e) {
            stuMeta = {};
          }
        }
        const shiftEntry = {
          from_teacher_id: fromTeacherId,
          from_teacher_name: fromTeacherName,
          to_teacher_id: toTeacherId,
          to_teacher_name: toTeacherName,
          shifted_at: new Date().toISOString(),
          shifted_slots_count: nonConflictingSlots.length,
          conflicting_slots_reschedule_needed: conflictingSlots.map(c => `${c.dayLabel} ${c.startTime}`)
        };
        if (!Array.isArray(stuMeta.teacher_shift_history)) {
          stuMeta.teacher_shift_history = [];
        }
        stuMeta.teacher_shift_history.unshift(shiftEntry);
        stuMeta.previous_teacher_id = fromTeacherId;
        stuMeta.previous_teacher_name = fromTeacherName;
        stuMeta.last_shifted_at = shiftEntry.shifted_at;

        const notesStr = JSON.stringify(stuMeta);
        const { error: stuUpdateErr } = await db
          .from('students')
          .update({ assigned_teacher_id: toTeacherId, notes: notesStr })
          .eq('id', studentId);

        if (stuUpdateErr) {
          throw stuUpdateErr;
        }

        // 4. Synchronize in-memory ALL_STUDENTS & ALL_FAMILIES & ALL_CLASS_SCHEDULES
        if (stuObj) {
          stuObj.assigned_teacher_id = toTeacherId;
          stuObj.notes = notesStr;
        }
        (ALL_FAMILIES || []).forEach(f => {
          (f.students || []).forEach(st => {
            if (String(st.id) === String(studentId)) {
              st.assigned_teacher_id = toTeacherId;
              st.notes = notesStr;
            }
          });
        });

        if (Array.isArray(ALL_CLASS_SCHEDULES)) {
          const shiftedIds = new Set(nonConflictingSlots.map(s => String(s.id)));
          const deletedIds = new Set(conflictingSlots.map(c => String(c.slot.id)));
          ALL_CLASS_SCHEDULES = ALL_CLASS_SCHEDULES.filter(row => !deletedIds.has(String(row.id))).map(row => {
            if (shiftedIds.has(String(row.id))) {
              return {
                ...row,
                teacher_id: toTeacherId,
                meeting_link: toTeacherZoom || row.meeting_link,
                teachers: toTchObj || row.teachers
              };
            }
            return row;
          });
        }

        // 5. Log transfer in Teacher A and Teacher B 360° notes for full historical audit trail
        const logTeacherShiftNote = async (tchRecord, noteText) => {
          if (!tchRecord) return;
          let tMeta = {};
          try {
            tMeta = typeof tchRecord.notes === 'string' ? JSON.parse(tchRecord.notes || '{}') : (tchRecord.notes || {});
          } catch (e) { tMeta = {}; }
          if (!Array.isArray(tMeta.teacher_360_notes)) tMeta.teacher_360_notes = [];
          tMeta.teacher_360_notes.unshift({
            id: 'SHIFT-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            category: 'Student Transfer',
            text: noteText,
            author: 'LMS Schedule Sync',
            created_at: new Date().toISOString()
          });
          const tNotesStr = JSON.stringify(tMeta);
          tchRecord.notes = tNotesStr;
          try {
            await db.from('teachers').update({ notes: tNotesStr }).eq('id', tchRecord.id);
          } catch (e) {}
        };

        await Promise.all([
          logTeacherShiftNote(fromTchObj, `Student ${studentName} (${studentId}) was shifted from ${fromTeacherName} to ${toTeacherName}.`),
          logTeacherShiftNote(toTchObj, `Student ${studentName} (${studentId}) was shifted to ${toTeacherName} from ${fromTeacherName}.`)
        ]);

        // 6. Invalidate caches & refresh Schedule Matrix, Teachers, Families, Salaries, and 360 views
        if (typeof invalidateCoreLmsDataCache === 'function') invalidateCoreLmsDataCache();
        if (typeof _TEACHER_360_MEM_CACHE === 'object') {
          delete _TEACHER_360_MEM_CACHE[String(fromTeacherId).toUpperCase()];
          delete _TEACHER_360_MEM_CACHE[String(toTeacherId).toUpperCase()];
        }

        closeModal('modalShiftStudentTeacher');
        closeModal('modalMatrixSlotActions');

        await fetchTeacherSchedules();
        render2DMatrixTable();
        if (typeof loadTeachers === 'function') loadTeachers();
        if (typeof loadFamiliesAndStudents === 'function') loadFamiliesAndStudents();
        if (typeof calculateMonthlySalaries === 'function') calculateMonthlySalaries();
        refreshOpen360ViewsAfterTeacherShift(studentId, fromTeacherId, toTeacherId);

        if (typeof lmsNotify === 'function') {
          lmsNotify(
            `${studentName} has been successfully shifted from ${fromTeacherName} to ${toTeacherName}.`,
            { type: 'success', title: 'Student Shifted Successfully' }
          );
        }

        // If there were conflicting slots that need to be booked on Teacher B's matrix, open Teacher B's matrix automatically
        if (allowPartialOnConflict && conflictingSlots.length > 0) {
          await open2DMatrixForTeacher(toTeacherId);
          if (typeof lmsNotify === 'function') {
            lmsNotify(
              `Switched to ${toTeacherName}'s Schedule Matrix. Please book a free slot for ${studentName}'s remaining day(s): ${conflictingSlots.map(c => c.dayLabel).join(', ')}.`,
              { type: 'info', title: 'Select New Slot for Conflicting Day' }
            );
          }
        }
      } catch (err) {
        console.error('[executeConfirmShiftStudent] Error:', err);
        if (typeof lmsNotify === 'function') {
          lmsNotify('Failed to shift student: ' + (err.message || err), { type: 'error' });
        }
      } finally {
        if (btnConfirm) {
          btnConfirm.disabled = false;
          btnConfirm.innerHTML = origBtnHtml || `<i class="fa-solid fa-right-left"></i> Confirm Shift`;
        }
      }
    }

    function refreshOpen360ViewsAfterTeacherShift(studentId, fromTeacherId, toTeacherId) {
      try {
        const stuObj = (ALL_STUDENTS || []).find(s => String(s.id) === String(studentId));
        const famSec = document.getElementById('tab-family-360');
        if (famSec && !famSec.classList.contains('hidden') && stuObj?.family_id && typeof openFamily360Profile === 'function') {
          openFamily360Profile(stuObj.family_id);
        }
        const stuSec = document.getElementById('tab-student-360');
        if (stuSec && !stuSec.classList.contains('hidden') && typeof CURRENT_360_STUDENT_ID !== 'undefined' && String(CURRENT_360_STUDENT_ID) === String(studentId) && typeof openStudent360Profile === 'function') {
          openStudent360Profile(studentId);
        }
        const tchSec = document.getElementById('tab-teacher-360');
        if (tchSec && !tchSec.classList.contains('hidden') && typeof CURRENT_360_TEACHER_ID !== 'undefined' && typeof openTeacher360Profile === 'function') {
          if (String(CURRENT_360_TEACHER_ID) === String(fromTeacherId) || String(CURRENT_360_TEACHER_ID) === String(toTeacherId)) {
            openTeacher360Profile(CURRENT_360_TEACHER_ID, { forceSync: true });
          }
        }
      } catch (e) {}
    }

    window.openShiftStudentFromSlotAction = openShiftStudentFromSlotAction;
    window.openShiftStudentModal = openShiftStudentModal;
    window.handleShiftTargetTeacherChange = handleShiftTargetTeacherChange;
    window.executeConfirmShiftStudent = executeConfirmShiftStudent;

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
