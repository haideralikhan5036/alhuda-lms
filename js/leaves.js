/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/leaves.js
 * Purpose: Extended Student Leave Engine, Return Alerts & Teacher Reschedule / Time Change Approvals
 * Extracted Line Range: 15005 – 15906 (902 lines)
 * ============================================================================
 */

    // ==========================================
    // EXTENDED LEAVE & RETURN MANAGEMENT ENGINE
    // ==========================================

    async function checkLeaveReturnAlertsAndRequests(autoPopup = true) {
      try {
        const { data: students, error } = await db.from('students').select('*, teachers(*), families(*)');
        if (error || !students) return;

        const todayStr = new Date().toISOString().slice(0, 10);
        OVERDUE_LEAVE_STUDENTS = [];
        PENDING_TEACHER_REQUESTS = [];
        let totalActiveLeaves = 0;

        students.forEach(st => {
          let meta = null;
          if (st.notes) {
            try { meta = JSON.parse(st.notes); } catch(e) {}
          }

          // Check if student is on leave
          const isOnLeave = st.status === 'Leave' || (meta && meta.on_leave);
          if (isOnLeave) {
            totalActiveLeaves++;
            const returnDate = meta?.return_date;
            if (returnDate && returnDate <= todayStr) {
              OVERDUE_LEAVE_STUDENTS.push({
                ...st,
                leaveMeta: meta,
                isOverdue: returnDate < todayStr,
                isDueToday: returnDate === todayStr
              });
            }
          }

          // Check pending teacher requests (leave requests, reschedule requests, AND schedule time change requests)
          if (meta && meta.leave_request && meta.leave_request.status === 'pending') {
            PENDING_TEACHER_REQUESTS.push({
              student: st,
              request: meta.leave_request,
              requestType: 'leave'
            });
          }
          if (meta && meta.reschedule_request && meta.reschedule_request.status === 'pending') {
            PENDING_TEACHER_REQUESTS.push({
              student: st,
              request: meta.reschedule_request,
              requestType: 'reschedule'
            });
          }
          if (meta && meta.time_change_request && meta.time_change_request.status === 'pending') {
            PENDING_TEACHER_REQUESTS.push({
              student: st,
              request: meta.time_change_request,
              requestType: 'time_change'
            });
          }
        });

        // Update nav badge
        const navLeaveBadge = document.getElementById('navLeaveCountBadge');
        if (navLeaveBadge) navLeaveBadge.innerText = totalActiveLeaves;

        // Update Return Alerts button
        const btnReturnAlerts = document.getElementById('btnReturnAlertsBell');
        const badgeReturnAlerts = document.getElementById('badgeReturnAlertsCount');
        if (btnReturnAlerts && badgeReturnAlerts) {
          if (OVERDUE_LEAVE_STUDENTS.length > 0) {
            badgeReturnAlerts.innerText = OVERDUE_LEAVE_STUDENTS.length;
            btnReturnAlerts.classList.remove('hidden');
            btnReturnAlerts.classList.add('flex');
          } else {
            btnReturnAlerts.classList.add('hidden');
            btnReturnAlerts.classList.remove('flex');
          }
        }

        // Update Teacher Requests button
        const badgeReqs = document.getElementById('badgePendingTeacherRequests');
        if (badgeReqs) {
          if (PENDING_TEACHER_REQUESTS.length > 0) {
            badgeReqs.innerText = PENDING_TEACHER_REQUESTS.length;
            badgeReqs.classList.remove('hidden');
          } else {
            badgeReqs.classList.add('hidden');
          }
        }

        if (typeof syncTopCircleNotificationDots === 'function') {
          syncTopCircleNotificationDots();
        }

        // Render Live 1-Click Approval Banners on Dashboard & Teachers Tab
        renderPendingTimeChangeBanners();

        // Persistent Dashboard Alert Modal
        if (autoPopup && OVERDUE_LEAVE_STUDENTS.length > 0) {
          const dismissedSession = sessionStorage.getItem('alhuda_leave_alerts_dismissed');
          if (!dismissedSession) {
            openReturnAlertsModal();
          }
        }
      } catch (err) {
        console.error('Error checking leave returns/requests:', err);
      }
    }

    function renderPendingTimeChangeBanners() {
      const dashBanner = document.getElementById('dashboardPendingTimeChangesBanner');
      const tchBanner = document.getElementById('teachersTabPendingTimeChangesBanner');

      const timeReqs = (PENDING_TEACHER_REQUESTS || []).filter(item => item.requestType === 'time_change');
      if (timeReqs.length === 0 || CURRENT_ROLE === 'teacher' || CURRENT_ROLE === 'student') {
        if (dashBanner) dashBanner.classList.add('hidden');
        if (tchBanner) tchBanner.classList.add('hidden');
        return;
      }

      const cardsHtml = timeReqs.map(item => {
        const st = item.student;
        const req = item.request || {};
        const teacherName = req.teacher_name || st.teachers?.full_name || 'Teacher';
        const oldSlot = req.old_slot_label || (req.old_start_time ? `${req.old_start_time.slice(0,5)} - ${req.old_end_time.slice(0,5)}` : 'Current Slot');
        const newSlot = req.new_slot_label || (req.new_start_time ? `${req.new_start_time.slice(0,5)} - ${req.new_end_time.slice(0,5)}` : 'New Slot');
        const scopeLabel = req.scope === 'single_day' ? '📌 Single Day Only' : '📅 All Weekly Days (Permanent)';

        return `
          <div class="p-3.5 bg-white/10 hover:bg-white/15 backdrop-blur-xs rounded-xl border border-indigo-400/40 flex items-center justify-between gap-3 flex-wrap transition">
            <div class="space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-indigo-500 text-white uppercase tracking-wider">🕒 Schedule Time Change</span>
                <span class="font-black text-white text-sm">${st.name}</span>
                <span class="text-xs font-mono text-indigo-200">(ID: ${st.id})</span>
                <span class="text-xs text-slate-300">• Requested by <strong class="text-emerald-300">${teacherName}</strong></span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/20 text-amber-200 border border-amber-400/40">${scopeLabel}</span>
              </div>
              <div class="flex items-center gap-2 flex-wrap text-xs pt-0.5">
                <span class="px-2.5 py-1 rounded-lg bg-rose-500/25 text-rose-200 border border-rose-400/40 font-mono font-bold">
                  Old: ${oldSlot}
                </span>
                <i class="fa-solid fa-arrow-right text-amber-300 text-xs"></i>
                <span class="px-2.5 py-1 rounded-lg bg-emerald-500/25 text-emerald-200 border border-emerald-400/40 font-mono font-extrabold">
                  New: ${newSlot}
                </span>
                ${req.reason ? `<span class="text-indigo-200 text-[11px] italic ml-1">Reason: &ldquo;${req.reason}${req.notes ? ' — ' + req.notes : ''}&rdquo;</span>` : ''}
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <button onclick="handleDeclineTeacherRequest('${st.id}', 'time_change')" class="px-3 py-2 bg-rose-500/20 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-400/40 rounded-xl text-xs font-bold transition flex items-center gap-1">
                <i class="fa-solid fa-xmark"></i> Decline
              </button>
              <button onclick="handleApproveTeacherRequest('${st.id}', 'time_change')" class="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black rounded-xl text-xs transition flex items-center gap-1.5 shadow-md">
                <i class="fa-solid fa-circle-check"></i> Approve &amp; Auto-Change Time
              </button>
            </div>
          </div>
        `;
      }).join('');

      const bannerInner = `
        <div class="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div class="flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-sm animate-bounce shadow-xs">
              <i class="fa-solid fa-clock-rotate-left"></i>
            </span>
            <div>
              <h3 class="font-black text-sm text-white flex items-center gap-2">
                Pending Teacher Schedule Time Change Requests
                <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-amber-400 text-slate-950">${timeReqs.length} Pending</span>
              </h3>
              <p class="text-[11px] text-indigo-200">Click <strong>"Approve &amp; Auto-Change Time"</strong> below to automatically update the student's timing in the teacher's schedule without manual searching.</p>
            </div>
          </div>
          <button onclick="openAdminTeacherRequestsModal()" class="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold border border-white/20 transition">
            View All Requests (${PENDING_TEACHER_REQUESTS.length})
          </button>
        </div>
        <div class="space-y-2.5">
          ${cardsHtml}
        </div>
      `;

      if (dashBanner) {
        dashBanner.innerHTML = bannerInner;
        dashBanner.classList.remove('hidden');
      }
      if (tchBanner) {
        tchBanner.innerHTML = bannerInner;
        tchBanner.classList.remove('hidden');
      }
    }

    function openReturnAlertsModal() {
      const modal = document.getElementById('modalReturnAlerts');
      const container = document.getElementById('returnAlertsListContainer');
      const badge = document.getElementById('modalReturnAlertsBadge');
      if (!modal || !container) return;

      if (badge) badge.innerText = `${OVERDUE_LEAVE_STUDENTS.length} Due`;

      if (OVERDUE_LEAVE_STUDENTS.length === 0) {
        container.innerHTML = `
          <div class="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200">
            <i class="fa-solid fa-circle-check text-emerald-500 text-3xl mb-2"></i>
            <h4 class="font-black text-slate-800 text-sm">All Students Resumed on Time!</h4>
            <p class="text-xs text-slate-500 mt-1">There are no overdue leave returns right now.</p>
          </div>
        `;
      } else {
        const todayStr = new Date().toISOString().slice(0, 10);
        container.innerHTML = OVERDUE_LEAVE_STUDENTS.map(st => {
          const ret = st.leaveMeta?.return_date || '';
          let timingBadge = '';
          if (ret === todayStr) {
            timingBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-900 border border-amber-300 animate-pulse flex items-center gap-1"><i class="fa-solid fa-bell"></i> Returns Today</span>';
          } else {
            const diffDays = Math.ceil((new Date(todayStr) - new Date(ret)) / (1000 * 60 * 60 * 24));
            timingBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800 border border-rose-300 animate-pulse flex items-center gap-1"><i class="fa-solid fa-triangle-exclamation"></i> Overdue by ${diffDays} day(s)</span>`;
          }

          const teacherName = st.teachers?.full_name || 'Assigned Teacher';
          const reason = st.leaveMeta?.leave_reason || 'Vacation';
          const leaveStart = st.leaveMeta?.leave_start_date || 'N/A';

          return `
            <div class="p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-2xl border border-slate-200 flex items-center justify-between gap-3 flex-wrap transition">
              <div class="space-y-1">
                <div class="flex items-center gap-2">
                  <span class="font-extrabold text-slate-900 text-sm">${st.name}</span>
                  <span class="text-xs font-mono text-slate-400">ID: ${st.id}</span>
                  ${timingBadge}
                </div>
                <div class="text-xs text-slate-600 flex items-center gap-2 flex-wrap">
                  <span><i class="fa-solid fa-chalkboard-user text-emerald-600"></i> ${teacherName}</span>
                  <span>•</span>
                  <span><i class="fa-solid fa-plane text-blue-500"></i> ${reason}</span>
                  <span>•</span>
                  <span>Scheduled Return: <strong class="text-slate-900 font-mono">${ret}</strong> (From: ${leaveStart})</span>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <button onclick="reactivateStudentFromLeave('${st.id}')" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition">
                  <i class="fa-solid fa-user-check"></i> Reactivate Student
                </button>
                <button onclick="extendStudentLeave('${st.id}')" class="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-1 transition">
                  <i class="fa-solid fa-calendar-plus text-blue-600"></i> Extend
                </button>
              </div>
            </div>
          `;
        }).join('');
      }

      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function openAdminTeacherRequestsModal() {
      const modal = document.getElementById('modalAdminTeacherRequests');
      const container = document.getElementById('adminTeacherRequestsListContainer');
      const countBadge = document.getElementById('modalTeacherRequestsCountBadge');
      if (!modal || !container) return;

      if (countBadge) countBadge.innerText = `${PENDING_TEACHER_REQUESTS.length} Pending`;

      if (PENDING_TEACHER_REQUESTS.length === 0) {
        container.innerHTML = `
          <div class="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200">
            <i class="fa-solid fa-clipboard-check text-emerald-500 text-3xl mb-2"></i>
            <h4 class="font-black text-slate-800 text-sm">No Pending Teacher Requests</h4>
            <p class="text-xs text-slate-500 mt-1">All schedule time change requests, leave submissions, and adjustments have been reviewed.</p>
          </div>
        `;
      } else {
        container.innerHTML = PENDING_TEACHER_REQUESTS.map(item => {
          const st = item.student;
          const req = item.request;
          const rType = item.requestType || 'leave';
          const requestedAt = req.requested_at ? new Date(req.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';

          const typeTag = rType === 'time_change'
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-100 text-indigo-900 font-extrabold border border-indigo-300">🕒 Schedule Time Change Request</span>'
            : rType === 'reschedule'
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-orange-100 text-orange-800 font-bold border border-orange-300">🔄 Attendance Status Change</span>'
            : '<span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-100 text-amber-800 font-bold border border-amber-300">📅 Leave Request</span>';

          let detailsHtml = '';
          if (rType === 'time_change') {
            const oldSlot = req.old_slot_label || (req.old_start_time ? `${req.old_start_time.slice(0,5)} - ${req.old_end_time.slice(0,5)}` : 'Current Slot');
            const newSlot = req.new_slot_label || (req.new_start_time ? `${req.new_start_time.slice(0,5)} - ${req.new_end_time.slice(0,5)}` : 'New Slot');
            const scopeLbl = req.scope === 'single_day' ? 'Single Day Session Only' : 'Permanent (All Weekly Scheduled Days)';

            detailsHtml = `
              <div class="p-3.5 bg-indigo-50/80 rounded-xl border border-indigo-200 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <span class="text-slate-500 font-bold block text-[11px]">Current Scheduled Time:</span>
                  <span class="font-mono font-black text-rose-700 text-sm">${oldSlot}</span>
                </div>
                <div>
                  <span class="text-slate-500 font-bold block text-[11px]">Requested New Time Slot:</span>
                  <span class="font-mono font-black text-emerald-700 text-sm">${newSlot}</span>
                </div>
                <div>
                  <span class="text-slate-500 font-bold block text-[11px]">Change Scope:</span>
                  <span class="font-extrabold text-indigo-950">${scopeLbl}</span>
                </div>
                <div>
                  <span class="text-slate-500 font-bold block text-[11px]">Reason:</span>
                  <span class="font-bold text-slate-800">${req.reason || 'Schedule adjustment'}</span>
                </div>
                ${req.notes ? `
                  <div class="sm:col-span-2 text-slate-700 italic bg-white p-2 rounded-lg border border-indigo-200/70">
                    &ldquo;${req.notes}&rdquo;
                  </div>
                ` : ''}
              </div>
            `;
          } else if (rType === 'reschedule') {
            detailsHtml = `
              <div class="p-3 bg-orange-50/70 rounded-xl border border-orange-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span class="text-slate-500 font-bold block text-[11px]">Current Status (Locked):</span>
                  <span class="font-mono font-black text-rose-700">${req.current_status || 'Unknown'}</span>
                </div>
                <div>
                  <span class="text-slate-500 font-bold block text-[11px]">Requested Change To:</span>
                  <span class="font-mono font-black text-emerald-700">${req.requested_status || 'N/A'}</span>
                </div>
                <div>
                  <span class="text-slate-500 font-bold block text-[11px]">Reason:</span>
                  <span class="font-bold text-orange-950">${req.reason || 'Not specified'}</span>
                </div>
                ${req.notes ? `
                  <div class="sm:col-span-2 text-slate-600 italic bg-white p-2 rounded-lg border border-orange-200/60">
                    &ldquo;${req.notes}&rdquo;
                  </div>
                ` : ''}
              </div>
            `;
          } else {
            detailsHtml = `
              <div class="p-3 bg-amber-50/70 rounded-xl border border-amber-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span class="text-slate-500 font-bold block text-[11px]">Proposed Leave Period:</span>
                  <span class="font-mono font-black text-slate-800">${req.start_date || 'N/A'} &rarr; ${req.return_date || 'N/A'}</span>
                </div>
                <div>
                  <span class="text-slate-500 font-bold block text-[11px]">Reason / Stated Need:</span>
                  <span class="font-bold text-amber-950">${req.reason || 'Not specified'}</span>
                </div>
                ${req.notes ? `
                  <div class="sm:col-span-2 text-slate-600 italic bg-white p-2 rounded-lg border border-amber-200/60">
                    &ldquo;${req.notes}&rdquo;
                  </div>
                ` : ''}
              </div>
            `;
          }

          const approveLabel = rType === 'time_change'
            ? '<i class="fa-solid fa-check"></i> Approve &amp; Auto-Change Schedule'
            : rType === 'reschedule'
            ? '<i class="fa-solid fa-check"></i> Approve &amp; Update Status'
            : '<i class="fa-solid fa-check"></i> Approve &amp; Mark Leave';

          const borderColor = rType === 'time_change' ? 'border-indigo-300' : rType === 'reschedule' ? 'border-orange-200' : 'border-amber-200';

          return `
            <div class="p-4 bg-white rounded-2xl border ${borderColor} shadow-xs space-y-3">
              <div class="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-black text-slate-900 text-sm">${st.name}</span>
                    ${typeTag}
                  </div>
                  <div class="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                    <span>Student ID: <strong class="font-mono text-slate-700">${st.id}</strong></span>
                    <span>•</span>
                    <span>Teacher: <strong class="text-emerald-700 font-semibold">${req.teacher_name || 'Teacher'}</strong> (${req.teacher_id || 'TCH'})</span>
                  </div>
                </div>
                <div class="text-[11px] text-slate-400 font-mono">
                  Submitted: ${requestedAt}
                </div>
              </div>

              ${detailsHtml}

              <div class="flex items-center justify-end gap-2 border-t pt-2.5">
                <button onclick="handleDeclineTeacherRequest('${st.id}', '${rType}')" class="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-xl text-xs font-bold transition flex items-center gap-1">
                  <i class="fa-solid fa-xmark"></i> Decline
                </button>
                <button onclick="handleApproveTeacherRequest('${st.id}', '${rType}')" class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-xs">
                  ${approveLabel}
                </button>
              </div>
            </div>
          `;
        }).join('');
      }

      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    async function handleApproveTeacherRequest(studentId, requestType) {
      const rType = requestType || 'leave';
      try {
        const { data: st, error } = await db.from('students').select('*').eq('id', studentId).single();
        if (error || !st) {
          alert("Could not load student record.");
          return;
        }

        let meta = {};
        try { meta = JSON.parse(st.notes || '{}'); } catch(e) { meta = { text: st.notes || '' }; }

        if (rType === 'time_change') {
          // SCHEDULE TIME CHANGE APPROVAL: Automatically update student's slots in class_schedules!
          const req = meta.time_change_request || {};
          const oldStart = (req.old_start_time || '').slice(0, 5);
          const newStart = req.new_start_time || '17:00:00';
          const newEnd = req.new_end_time || '17:30:00';
          const scope = req.scope || 'all_days';

          const { data: stuScheds, error: sErr } = await db.from('class_schedules').select('*').eq('student_id', studentId);
          if (sErr) throw sErr;

          let targetRows = [];
          if (scope === 'single_day' && req.schedule_id) {
            targetRows = (stuScheds || []).filter(r => String(r.id) === String(req.schedule_id));
          } else {
            targetRows = (stuScheds || []).filter(r => (r.start_time || '').slice(0, 5) === oldStart);
            if (targetRows.length === 0 && stuScheds && stuScheds.length > 0) {
              targetRows = stuScheds;
            }
          }

          const targetIds = targetRows.map(r => r.id);
          if (targetIds.length > 0) {
            const { error: upSchedErr } = await db.from('class_schedules')
              .update({
                start_time: newStart,
                end_time: newEnd
              })
              .in('id', targetIds);
            if (upSchedErr) throw upSchedErr;
          }

          // Sync student metadata & mark request approved
          meta.pkt_slot = req.new_slot_label || `${newStart.slice(0,5)} - ${newEnd.slice(0,5)}`;
          meta.start_time = newStart.slice(0,5);
          meta.end_time = newEnd.slice(0,5);
          if (meta.time_change_request) {
            meta.time_change_request.status = 'approved';
            meta.time_change_request.approved_at = new Date().toISOString();
            meta.time_change_request.approved_by = CURRENT_ROLE;
          }

          await db.from('students').update({ notes: JSON.stringify(meta) }).eq('id', studentId);

          if (CURRENT_MATRIX_TEACHER && CURRENT_MATRIX_TEACHER.id) {
            await fetchTeacherSchedules();
            render2DMatrixTable();
          }
          try { loadTeachers(); } catch (e) {}

          alert(`✅ Approved & Schedule Updated Automatically!\n\nStudent: ${st.name} (${st.id})\nTeacher: ${req.teacher_name || 'Assigned Teacher'}\nOld Time: ${req.old_slot_label || oldStart}\nNew Time: ${req.new_slot_label || newStart.slice(0,5)}\nUpdated Timetable Slots: ${targetIds.length} weekly session(s)`);
        } else if (rType === 'reschedule') {
          // RESCHEDULE APPROVAL: update the attendance_log status to the requested status
          const req = meta.reschedule_request || {};
          const scheduleId = req.schedule_id;
          const newStatus  = req.requested_status || 'Present';
          const todayDate  = new Date().toISOString().slice(0, 10);

          if (scheduleId) {
            const { error: logErr } = await db.from('attendance_logs').update({
              status: newStatus,
              lesson_notes: `[Admin Override] Status changed from ${req.current_status} to ${newStatus}. Reason: ${req.reason || 'Teacher request'}. Approved by ${CURRENT_ROLE} on ${todayDate}.`
            }).eq('schedule_id', scheduleId).eq('date', todayDate);

            if (logErr) console.warn("Could not update attendance log:", logErr.message);
          }

          // Mark request as approved in meta
          if (meta.reschedule_request) {
            meta.reschedule_request.status = 'approved';
            meta.reschedule_request.approved_at = new Date().toISOString();
            meta.reschedule_request.approved_by = CURRENT_ROLE;
          }

          await db.from('students').update({ notes: JSON.stringify(meta) }).eq('id', studentId);

          alert(`✅ Reschedule approved for ${st.name}!\nAttendance log updated to: ${newStatus}`);
        } else {
          // LEAVE APPROVAL: mark student on leave
          const req = meta.leave_request || {};
          const startDate  = req.start_date  || new Date().toISOString().slice(0, 10);
          const returnDate = req.return_date  || startDate;
          const reason     = req.reason       || 'Approved Teacher Leave Request';

          meta.on_leave = true;
          meta.leave_start_date = startDate;
          meta.return_date = returnDate;
          meta.leave_reason = reason;
          meta.leave_marked_at = new Date().toISOString();
          meta.leave_marked_by = CURRENT_ROLE;
          if (meta.leave_request) {
            meta.leave_request.status = 'approved';
            meta.leave_request.approved_at = new Date().toISOString();
            meta.leave_request.approved_by = CURRENT_ROLE;
          }

          const { error: upErr } = await db.from('students').update({
            status: 'Leave',
            notes: JSON.stringify(meta)
          }).eq('id', studentId);

          if (upErr) throw upErr;
          alert(`✅ Leave request approved for ${st.name}!\nReturn Date scheduled: ${returnDate}.\nTimetable slots are suspended until reactivation.`);
        }

        closeModal('modalAdminTeacherRequests');
        await loadDashboardData();
        await checkLeaveReturnAlertsAndRequests(false);
        if (document.getElementById('tab-leaves') && !document.getElementById('tab-leaves').classList.contains('hidden')) {
          await loadLeaveManagementData();
        }
      } catch (err) {
        alert("Error approving request: " + err.message);
      }
    }

    async function handleDeclineTeacherRequest(studentId, requestType) {
      const rType = requestType || 'leave';
      const reason = prompt("Enter reason for declining this request (will be saved in audit notes):", "Request cannot be approved at this time");
      if (reason === null) return;

      try {
        const { data: st } = await db.from('students').select('*').eq('id', studentId).single();
        if (!st) return;

        let meta = {};
        try { meta = JSON.parse(st.notes || '{}'); } catch(e) { meta = { text: st.notes || '' }; }

        if (rType === 'time_change' && meta.time_change_request) {
          meta.time_change_request.status = 'declined';
          meta.time_change_request.decline_reason = reason;
          meta.time_change_request.declined_at = new Date().toISOString();
          meta.time_change_request.declined_by = CURRENT_ROLE;
        } else if (rType === 'reschedule' && meta.reschedule_request) {
          meta.reschedule_request.status = 'declined';
          meta.reschedule_request.decline_reason = reason;
          meta.reschedule_request.declined_at = new Date().toISOString();
          meta.reschedule_request.declined_by = CURRENT_ROLE;
        } else if (meta.leave_request) {
          meta.leave_request.status = 'declined';
          meta.leave_request.decline_reason = reason;
          meta.leave_request.declined_at = new Date().toISOString();
          meta.leave_request.declined_by = CURRENT_ROLE;
        }

        await db.from('students').update({
          notes: JSON.stringify(meta)
        }).eq('id', studentId);

        alert(`❌ Request declined for ${st.name}.`);
        closeModal('modalAdminTeacherRequests');
        await checkLeaveReturnAlertsAndRequests(false);
      } catch (err) {
        alert("Error declining request: " + err.message);
      }
    }

    async function reactivateStudentFromLeave(studentId) {
      if (!confirm("Reactivate this student now? This will restore their active weekly class schedule slots.")) return;

      try {
        const { data: st } = await db.from('students').select('*').eq('id', studentId).single();
        if (!st) return;

        let meta = {};
        try { meta = JSON.parse(st.notes || '{}'); } catch(e) { meta = { text: st.notes || '' }; }

        meta.on_leave = false;
        meta.reactivated_at = new Date().toISOString();
        meta.reactivated_by = CURRENT_ROLE;

        const { error: upErr } = await db.from('students').update({
          status: 'Active',
          notes: JSON.stringify(meta)
        }).eq('id', studentId);

        if (upErr) throw upErr;

        alert(`🎓 ${st.name} has been reactivated!\nWeekly class schedule slots are fully active.`);
        await loadDashboardData();
        await checkLeaveReturnAlertsAndRequests(false);
        if (document.getElementById('tab-leaves') && !document.getElementById('tab-leaves').classList.contains('hidden')) {
          await loadLeaveManagementData();
        }
        const modalReturn = document.getElementById('modalReturnAlerts');
        if (modalReturn && !modalReturn.classList.contains('hidden')) {
          openReturnAlertsModal();
        }
      } catch (err) {
        alert("Error reactivating student: " + err.message);
      }
    }

    async function extendStudentLeave(studentId) {
      try {
        const { data: st } = await db.from('students').select('*').eq('id', studentId).single();
        if (!st) return;

        let meta = {};
        try { meta = JSON.parse(st.notes || '{}'); } catch(e) { meta = { text: st.notes || '' }; }

        const currentReturn = meta.return_date || new Date().toISOString().slice(0, 10);
        const newReturnDate = prompt(`Enter new Return Date (YYYY-MM-DD) for ${st.name}:`, currentReturn);
        if (!newReturnDate || newReturnDate === currentReturn) return;

        meta.return_date = newReturnDate;
        meta.extended_at = new Date().toISOString();
        meta.extended_by = CURRENT_ROLE;

        await db.from('students').update({
          notes: JSON.stringify(meta)
        }).eq('id', studentId);

        alert(`📅 Leave extended until ${newReturnDate} for ${st.name}!`);
        await loadDashboardData();
        await checkLeaveReturnAlertsAndRequests(false);
        if (document.getElementById('tab-leaves') && !document.getElementById('tab-leaves').classList.contains('hidden')) {
          await loadLeaveManagementData();
        }
        const modalReturn = document.getElementById('modalReturnAlerts');
        if (modalReturn && !modalReturn.classList.contains('hidden')) {
          openReturnAlertsModal();
        }
      } catch (err) {
        alert("Error extending leave: " + err.message);
      }
    }

    async function loadLeaveManagementData() {
      const tbody = document.getElementById('leavesTableBody');
      if (!tbody) return;

      tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading leave records...</td></tr>';

      try {
        const { data: students, error } = await db.from('students').select('*, teachers(*), families(*)');
        if (error) throw error;

        ALL_LEAVE_RECORDS = [];
        let activeOnLeaveCount = 0;
        let returningSoonCount = 0;
        let overdueCount = 0;
        let totalRecordsCount = 0;

        const today = new Date().toISOString().slice(0, 10);
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        (students || []).forEach(st => {
          let meta = null;
          if (st.notes) {
            try { meta = JSON.parse(st.notes); } catch(e) {}
          }

          const hasLeaveHistory = st.status === 'Leave' || (meta && (meta.on_leave || meta.leave_start_date || meta.reactivated_at));
          if (hasLeaveHistory) {
            totalRecordsCount++;
            const isOnLeave = st.status === 'Leave' || (meta && meta.on_leave);
            const returnDate = meta?.return_date || '';
            const startDate = meta?.leave_start_date || '';
            const reason = meta?.leave_reason || 'Personal / Vacation';

            let isOverdue = false;
            let isReturningSoon = false;

            if (isOnLeave) {
              activeOnLeaveCount++;
              if (returnDate && returnDate < today) {
                isOverdue = true;
                overdueCount++;
              } else if (returnDate && returnDate >= today && returnDate <= nextWeek) {
                isReturningSoon = true;
                returningSoonCount++;
              }
            }

            ALL_LEAVE_RECORDS.push({
              student: st,
              meta,
              isOnLeave,
              startDate,
              returnDate,
              reason,
              isOverdue,
              isReturningSoon
            });
          }
        });

        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        setEl('kpiLeavesActive', activeOnLeaveCount);
        setEl('kpiLeavesReturningSoon', returningSoonCount);
        setEl('kpiLeavesOverdue', overdueCount);
        setEl('kpiLeavesTotal', totalRecordsCount);

        filterLeavesTable();
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-rose-500 font-bold">Error loading leaves: ${err.message}</td></tr>`;
      }
    }

    function filterLeavesTable() {
      const tbody = document.getElementById('leavesTableBody');
      if (!tbody) return;

      const search = (document.getElementById('searchLeavesInput')?.value || '').toLowerCase();
      const statusFilter = document.getElementById('filterLeavesStatus')?.value || 'all';
      const today = new Date().toISOString().slice(0, 10);

      const filtered = ALL_LEAVE_RECORDS.filter(item => {
        const name = (item.student.name || '').toLowerCase();
        const familyId = (item.student.family_id || '').toLowerCase();
        const teacherName = (item.student.teachers?.full_name || '').toLowerCase();

        const matchesSearch = !search || name.includes(search) || familyId.includes(search) || teacherName.includes(search);
        if (!matchesSearch) return false;

        if (statusFilter === 'active') return item.isOnLeave;
        if (statusFilter === 'overdue') return item.isOnLeave && item.isOverdue;
        if (statusFilter === 'returning_soon') return item.isOnLeave && item.isReturningSoon;
        if (statusFilter === 'reactivated') return !item.isOnLeave;
        return true;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400">No matching student leave records found.</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map(item => {
        const st = item.student;
        const teacherName = st.teachers?.full_name || '<span class="text-slate-400 italic">Unassigned</span>';
        const familyName = st.families?.father_name || st.family_id || 'FAM';

        let countdownBadge = '';
        if (item.isOnLeave) {
          if (!item.returnDate) {
            countdownBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">No Return Set</span>';
          } else if (item.returnDate < today) {
            const diffDays = Math.ceil((new Date(today) - new Date(item.returnDate)) / (1000 * 60 * 60 * 24));
            countdownBadge = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">⚠️ Overdue (${diffDays}d)</span>`;
          } else if (item.returnDate === today) {
            countdownBadge = '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">🔔 Returns Today!</span>';
          } else {
            const diffDays = Math.ceil((new Date(item.returnDate) - new Date(today)) / (1000 * 60 * 60 * 24));
            countdownBadge = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">⏳ Returns in ${diffDays}d</span>`;
          }
        } else {
          countdownBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">✅ Active / Resumed</span>';
        }

        return `
          <tr class="hover:bg-slate-50 transition ${item.isOnLeave ? 'bg-blue-50/30' : ''}">
            <td class="p-3.5">
              <div class="font-bold text-slate-900 text-xs">${st.name}</div>
              <div class="text-[10px] text-slate-400 font-mono">ID: ${st.id} • Family: ${familyName}</div>
            </td>
            <td class="p-3.5 text-xs font-semibold text-slate-700">
              ${teacherName}
            </td>
            <td class="p-3.5 font-mono text-xs text-slate-600">
              ${item.startDate || '<span class="text-slate-400 italic">N/A</span>'}
            </td>
            <td class="p-3.5 font-mono text-xs font-black text-slate-900">
              ${item.returnDate || '<span class="text-slate-400 italic">Not set</span>'}
            </td>
            <td class="p-3.5">
              ${countdownBadge}
            </td>
            <td class="p-3.5 text-xs text-slate-700 max-w-xs truncate" title="${item.reason}">
              ${item.reason}
            </td>
            <td class="p-3.5 text-right">
              <div class="flex items-center justify-end gap-1.5 flex-wrap">
                ${item.isOnLeave ? `
                  <button onclick="reactivateStudentFromLeave('${st.id}')" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-xs">
                    <i class="fa-solid fa-user-check"></i> Reactivate
                  </button>
                  <button onclick="extendStudentLeave('${st.id}')" class="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-bold transition flex items-center gap-1">
                    <i class="fa-solid fa-calendar-plus text-blue-600"></i> Extend
                  </button>
                ` : `
                  <button onclick="openMarkLeaveModal('${st.id}')" class="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-lg text-xs font-bold transition flex items-center gap-1">
                    <i class="fa-solid fa-plane text-blue-600"></i> Mark Leave
                  </button>
                `}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    function openMarkLeaveModal(preselectedStudentId = null) {
      const select = document.getElementById('leaveStudentSelect');
      const startInput = document.getElementById('leaveStartDate');
      const returnInput = document.getElementById('leaveReturnDate');
      const customReasonInput = document.getElementById('leaveCustomReason');
      const reasonSelect = document.getElementById('leaveReasonSelect');

      if (!select) return;

      const todayStr = new Date().toISOString().slice(0, 10);
      const defaultReturn = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      if (startInput) startInput.value = todayStr;
      if (returnInput) returnInput.value = defaultReturn;
      if (reasonSelect) reasonSelect.value = 'UK/Europe Summer Holidays';
      if (customReasonInput) {
        customReasonInput.value = '';
        customReasonInput.classList.add('hidden');
      }

      select.innerHTML = '<option value="">-- Choose Student --</option>' + (ALL_STUDENTS || []).map(s => {
        const isSelected = preselectedStudentId && s.id === preselectedStudentId;
        return `<option value="${s.id}" ${isSelected ? 'selected' : ''}>${s.name} (${s.id}) - ${s.status}</option>`;
      }).join('');

      document.getElementById('modalMarkLeaveTitle').innerText = preselectedStudentId ? 'Schedule Leave for Student' : 'Mark Student on Leave';
      openModal('modalMarkLeave');
    }

    function checkCustomLeaveReason(val) {
      const input = document.getElementById('leaveCustomReason');
      if (!input) return;
      if (val === 'Custom') {
        input.classList.remove('hidden');
        input.focus();
      } else {
        input.classList.add('hidden');
      }
    }

    async function handleSaveStudentLeave(e) {
      e.preventDefault();
      const studentId = document.getElementById('leaveStudentSelect')?.value;
      const startDate = document.getElementById('leaveStartDate')?.value;
      const returnDate = document.getElementById('leaveReturnDate')?.value;
      let reason = document.getElementById('leaveReasonSelect')?.value;
      if (reason === 'Custom') {
        reason = (document.getElementById('leaveCustomReason')?.value || '').trim() || 'Custom Leave';
      }

      if (!studentId || !startDate || !returnDate) {
        alert("Please fill in all required fields.");
        return;
      }

      const btn = document.getElementById('btnSubmitStudentLeave');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

      try {
        const { data: st, error: fetchErr } = await db.from('students').select('*').eq('id', studentId).single();
        if (fetchErr || !st) throw new Error("Student not found.");

        let meta = {};
        try { meta = JSON.parse(st.notes || '{}'); } catch(e) { meta = { text: st.notes || '' }; }

        meta.on_leave = true;
        meta.leave_start_date = startDate;
        meta.return_date = returnDate;
        meta.leave_reason = reason;
        meta.leave_marked_at = new Date().toISOString();
        meta.leave_marked_by = CURRENT_ROLE;

        const { error: upErr } = await db.from('students').update({
          status: 'Leave',
          notes: JSON.stringify(meta)
        }).eq('id', studentId);

        if (upErr) throw upErr;

        alert(`🏖️ ${st.name} is now marked on leave until ${returnDate}.\nSchedule slots are paused and return alert is set!`);
        closeModal('modalMarkLeave');
        await loadDashboardData();
        await checkLeaveReturnAlertsAndRequests(false);
        if (document.getElementById('tab-leaves') && !document.getElementById('tab-leaves').classList.contains('hidden')) {
          await loadLeaveManagementData();
        }
      } catch (err) {
        alert("Error marking leave: " + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm Leave & Set Return';
      }
    }

