/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/dashboard.js
 * Purpose: Executive KPI Dashboard, Chart.js Analytics, Live Schedule Monitor & Quick Attendance
 * Extracted Line Range: 6846 – 7849 (1004 lines)
 * ============================================================================
 */

    // CHART.JS INITIALIZATION & EXECUTIVE ANALYTICS
    function initDashboardCharts() {
      if (typeof Chart === 'undefined') return;

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      // 1. Student Inflow vs Left Trend
      const ctxGrowth = document.getElementById('chartStudentGrowth')?.getContext('2d');
      if (ctxGrowth && !DASH_STUDENT_CHART) {
        DASH_STUDENT_CHART = new Chart(ctxGrowth, {
          type: 'bar',
          data: {
            labels: months,
            datasets: [
              {
                type: 'bar',
                label: 'New Enrolled',
                data: [4, 6, 8, 11, 14, 18, 22, 25, 29, 0, 0, 0],
                backgroundColor: 'rgba(5, 150, 105, 0.85)',
                borderColor: '#047857',
                borderWidth: 1.5,
                borderRadius: 6,
                order: 2
              },
              {
                type: 'bar',
                label: 'Left LMS',
                data: [0, 1, 0, 1, 2, 1, 1, 2, 1, 0, 0, 0],
                backgroundColor: 'rgba(225, 29, 72, 0.85)',
                borderColor: '#be123c',
                borderWidth: 1.5,
                borderRadius: 6,
                order: 2
              },
              {
                type: 'line',
                label: 'Net Active Students',
                data: [4, 9, 17, 27, 39, 56, 77, 100, 128, 0, 0, 0],
                borderColor: '#064e3b',
                backgroundColor: 'rgba(6, 78, 59, 0.1)',
                borderWidth: 2.5,
                tension: 0.35,
                pointRadius: 3.5,
                pointBackgroundColor: '#064e3b',
                fill: false,
                order: 1
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                position: 'top',
                labels: { boxWidth: 12, font: { size: 11, family: 'Plus Jakarta Sans', weight: 'bold' } }
              },
              tooltip: { padding: 10, titleFont: { size: 12, weight: 'bold' } }
            },
            scales: {
              x: { grid: { display: false } },
              y: { beginAtZero: true, grid: { color: '#f1f5f9' } }
            }
          }
        });
      }

      // 2. Monthly Fee Payments Received vs Target
      const ctxRevenue = document.getElementById('chartFeeRevenue')?.getContext('2d');
      if (ctxRevenue && !DASH_REVENUE_CHART) {
        DASH_REVENUE_CHART = new Chart(ctxRevenue, {
          type: 'line',
          data: {
            labels: months,
            datasets: [
              {
                label: 'Fee Received ($)',
                data: [400, 750, 1400, 2300, 3400, 4800, 6500, 8600, 11200, 0, 0, 0],
                borderColor: '#059669',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.35,
                pointRadius: 4,
                pointBackgroundColor: '#047857'
              },
              {
                label: 'Target Expected ($)',
                data: [500, 900, 1600, 2500, 3800, 5200, 7000, 9200, 12000, 0, 0, 0],
                borderColor: '#d97706',
                borderDash: [5, 5],
                borderWidth: 1.5,
                pointRadius: 0,
                fill: false
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                position: 'top',
                labels: { boxWidth: 12, font: { size: 11, family: 'Plus Jakarta Sans', weight: 'bold' } }
              },
              tooltip: {
                callbacks: {
                  label: function(c) { return `${c.dataset.label}: $${Number(c.parsed.y).toLocaleString()}`; }
                }
              }
            },
            scales: {
              x: { grid: { display: false } },
              y: {
                beginAtZero: true,
                grid: { color: '#f1f5f9' },
                ticks: { callback: function(v) { return '$' + v; } }
              }
            }
          }
        });
      }
    }

    async function updateDashboardAnalytics() {
      try {
        const { data: students } = await db.from('students').select('*');
        const { data: families } = await db.from('families').select('*');
        const { data: teachers } = await db.from('teachers').select('*');

        const totalStudents = (students || []).length;
        const activeStudents = (students || []).filter(s => s.status !== 'Left' && s.status !== 'Inactive').length;
        const leftStudents = (students || []).filter(s => s.status === 'Left').length;

        let totalAgreedFee = 0;
        (families || []).forEach(f => {
          totalAgreedFee += Number(f.monthly_fee) || 0;
        });

        const totalTeachers = (teachers || []).length;

        const elStudents = document.getElementById('dashExecutiveStudents');
        if (elStudents) elStudents.innerText = activeStudents;

        const elTeachers = document.getElementById('dashExecutiveTeachers');
        if (elTeachers) elTeachers.innerText = totalTeachers;

        const elKpiDashTeachers = document.getElementById('kpiDashTeachers');
        if (elKpiDashTeachers) elKpiDashTeachers.innerText = totalTeachers;

        const elRevenue = document.getElementById('dashExecutiveRevenue');
        if (elRevenue) elRevenue.innerText = '$' + totalAgreedFee.toLocaleString();

        const elRetention = document.getElementById('dashExecutiveRetention');
        const retention = totalStudents > 0 ? Math.round((activeStudents / totalStudents) * 100) : 100;
        if (elRetention) elRetention.innerText = retention + '%';

        const elGrowthBadge = document.getElementById('dashGrowthBadge');
        if (elGrowthBadge) elGrowthBadge.innerText = `+${retention}% Retained`;

        if (DASH_STUDENT_CHART) {
          const currentMonthIdx = new Date().getMonth();
          if (activeStudents > 0) {
            DASH_STUDENT_CHART.data.datasets[0].data[currentMonthIdx] = Math.max(activeStudents, DASH_STUDENT_CHART.data.datasets[0].data[currentMonthIdx]);
            DASH_STUDENT_CHART.data.datasets[1].data[currentMonthIdx] = leftStudents;
            DASH_STUDENT_CHART.data.datasets[2].data[currentMonthIdx] = Math.max(activeStudents, DASH_STUDENT_CHART.data.datasets[2].data[currentMonthIdx]);
            DASH_STUDENT_CHART.update();
          }
        }

        if (DASH_REVENUE_CHART && totalAgreedFee > 0) {
          const currentMonthIdx = new Date().getMonth();
          DASH_REVENUE_CHART.data.datasets[0].data[currentMonthIdx] = Math.max(totalAgreedFee, DASH_REVENUE_CHART.data.datasets[0].data[currentMonthIdx]);
          DASH_REVENUE_CHART.update();
        }
      } catch (err) {
        console.warn("Analytics update notice:", err);
      }
    }

    // Live Active Families & Active Students Real-time Metrics Engine
    async function updateLiveActiveMetrics() {
      try {
        const { data: fams } = await db.from('families').select('id, status');
        const { data: stus } = await db.from('students').select('id, status, notes');

        const activeFams = (fams || []).filter(f => {
          const s = (f.status || 'Active').toLowerCase();
          return s === 'active' || s === 'regular';
        });

        const activeStus = (stus || []).filter(s => {
          const st = (s.status || 'Active').toLowerCase();
          if (st === 'leave' || st === 'inactive' || st === 'deactivated' || st === 'deleted' || st === 'trial' || st === 'converted') {
            return false;
          }
          if (s.notes) {
            try {
              const p = JSON.parse(s.notes);
              if (p.is_trial && !p.converted_from_trial) return false;
            } catch(e) {}
          }
          return true;
        });

        const famCount = activeFams.length;
        const stuCount = activeStus.length;

        ['dashLiveActiveFamilies', 'famSummaryActiveFamilies', 'sidebarActiveFamilies'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerText = famCount;
        });
        ['dashLiveActiveStudents', 'famSummaryActiveStudents', 'sidebarActiveStudents'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerText = stuCount;
        });
      } catch(e) {
        console.warn("Could not calculate active registry metrics:", e);
      }
    }

    function updateExecutiveDashboardFeeWidget() {
      try {
        const now = new Date();
        const curMonthName = (typeof FEE_CONFIG !== 'undefined' && FEE_CONFIG.MONTHS) ? (FEE_CONFIG.MONTHS[now.getMonth()] || "September") : "September";
        const curYear = now.getFullYear();

        const badge = document.getElementById('dashFeeWidgetPeriodBadge');
        if (badge) badge.innerText = `${curMonthName} ${curYear}`;

        const records = typeof getStoredFeeRecords === 'function' ? getStoredFeeRecords() : [];
        const families = (typeof CACHED_FEE_FAMILIES !== 'undefined' && CACHED_FEE_FAMILIES) ? CACHED_FEE_FAMILIES : [];

        let paidCount = 0;
        let onLeaveCount = 0;

        const paidMap = {};
        records.forEach(r => {
          if (String(r.month).toLowerCase() === curMonthName.toLowerCase() && parseInt(r.year, 10) === curYear) {
            if (parseFloat(r.remainingBalance || 0) <= 0) {
              paidMap[String(r.familyId).toUpperCase()] = true;
            }
          }
        });
        paidCount = Object.keys(paidMap).length;

        families.forEach(fam => {
          if (typeof checkFamilyLeaveInMonth === 'function') {
            const lCheck = checkFamilyLeaveInMonth(fam.id, curMonthName, curYear);
            if (lCheck.isLeave) onLeaveCount++;
          }
        });

        const pendingCount = Math.max(0, families.length - paidCount - onLeaveCount);

        const elPaid = document.getElementById('dashFeeWidgetPaidCount');
        if (elPaid) elPaid.innerText = paidCount;
        const elPending = document.getElementById('dashFeeWidgetPendingCount');
        if (elPending) elPending.innerText = pendingCount;
        const elLeave = document.getElementById('dashFeeWidgetLeaveCount');
        if (elLeave) elLeave.innerText = onLeaveCount;
      } catch (e) {
        console.warn("Could not update dashboard fee widget:", e);
      }
    }

    async function loadDashboardData() {
      initDashboardCharts();
      updateDashboardAnalytics();
      updateLiveActiveMetrics();
      updateExecutiveDashboardFeeWidget();

      const now = new Date();
      const currentDay = now.getDay() === 0 ? 7 : now.getDay();
      const todayDate = now.toISOString().slice(0, 10);

      const dateLabel = document.getElementById('dashTodayDateLabel');
      if (dateLabel) {
        dateLabel.innerText = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      }

      // 1. Fetch schedules for today
      const { data: scheds } = await db.from('class_schedules')
        .select('*, students(*), teachers(*)')
        .eq('day_of_week', currentDay);

      // 2. Fetch today's attendance logs
      const { data: logs } = await db.from('attendance_logs').select('*').eq('date', todayDate);
      const logsMap = {};
      (logs || []).forEach(l => logsMap[l.schedule_id] = l);

      // Check for any advance classes pre-covering today
      let advCoverMap = {};
      try {
        const { data: allAdv } = await db.from('attendance_logs')
          .select('*')
          .eq('status', 'Advance Class');
        if (allAdv && allAdv.length > 0) {
          allAdv.forEach(al => {
            try {
              const meta = JSON.parse(al.lesson_notes);
              if (meta && meta.advance_target_date === todayDate) {
                advCoverMap[al.schedule_id] = { log: al, meta };
                if (al.student_id) advCoverMap['student_' + al.student_id] = { log: al, meta };
              }
            } catch(e){}
          });
        }
      } catch(e){}

      let currentMinutes = now.getHours() * 60 + now.getMinutes();

      let totalToday = 0;
      let liveCount = 0;
      let waitingCount = 0;
      let completedCount = 0;
      let remainingCount = 0;
      let absentCount = 0;
      let leaveCount = 0;
      let trialCount = 0;

      DASHBOARD_CLASSES = (scheds || []).map(s => {
        totalToday++;
        const log = logsMap[s.id];
        const [sH, sM] = s.start_time.split(':').map(Number);
        const [eH, eM] = s.end_time.split(':').map(Number);
        const startMin = sH * 60 + sM;
        const endMin = eH * 60 + eM;

        const isLive = currentMinutes >= startMin && currentMinutes < endMin;
        const isPast = currentMinutes >= endMin;
        const isUpcoming = currentMinutes < startMin;

        let isTrial = s.status === 'Trial' || s.is_trial === true || s.students?.status === 'Trial' || (s.students?.notes && s.students.notes.toLowerCase().includes('trial'));
        if (isTrial) trialCount++;

        let isLeaveStudent = s.students?.status === 'Leave';
        let leaveMeta = null;
        if (s.students?.notes) {
          try {
            const p = JSON.parse(s.students.notes);
            if (p && p.on_leave) {
              isLeaveStudent = true;
              leaveMeta = p;
            }
          } catch(e) {}
        }

        const isCurrentSlot = isLive && !isLeaveStudent;
        const isRunningMarked = isLive && Boolean(log && (log.status === 'Present' || log.status === 'Running'));

        let status = 'Upcoming';
        let badgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
        let filterCategory = 'remaining';

        if (log) {
          if (log.status === 'Waiting') {
            waitingCount++;
            status = '⏳ Teacher Waiting';
            filterCategory = 'waiting';
            badgeClass = 'bg-amber-100 text-amber-900 border-amber-400 font-extrabold animate-pulse';
          } else if (log.status === 'Present' || log.status === 'Running') {
            completedCount++;
            status = isLive ? '🟢 Running (Attendance Marked)' : 'Taken';
            filterCategory = 'completed';
            badgeClass = isLive
              ? 'bg-emerald-600 text-white border-emerald-700 font-extrabold animate-pulse'
              : 'bg-emerald-100 text-emerald-800 border-emerald-300';
          } else if (log.status === 'Advance Class') {
            completedCount++;
            let advTarget = '';
            try {
              const parsed = JSON.parse(log.lesson_notes);
              if (parsed?.advance_target_date) advTarget = ` (For: ${parsed.advance_target_date})`;
            } catch(e) {}
            status = `🌟 Advance Class${advTarget}`;
            filterCategory = 'completed';
            badgeClass = 'bg-purple-100 text-purple-900 border-purple-300 font-bold';
          } else if (log.status === 'Absent') {
            absentCount++;
            status = 'Absent';
            filterCategory = 'absent';
            badgeClass = 'bg-rose-100 text-rose-800 border-rose-300';
          } else if (log.status === 'Leave') {
            leaveCount++;
            status = 'Leave';
            filterCategory = 'leave';
            badgeClass = 'bg-blue-100 text-blue-800 border-blue-300';
          }
        } else if (advCoverMap[s.id] || advCoverMap['student_' + s.student_id]) {
          completedCount++;
          const cov = advCoverMap[s.id] || advCoverMap['student_' + s.student_id];
          status = `🌟 Pre-Covered (${cov.log.date})`;
          filterCategory = 'completed';
          badgeClass = 'bg-purple-100 text-purple-900 border-purple-300 font-bold';
        } else {
          if (isLeaveStudent) {
            leaveCount++;
            const returnInfo = leaveMeta?.return_date ? ` (Returns: ${leaveMeta.return_date.slice(5)})` : '';
            status = `🏖️ On Vacation / Leave${returnInfo}`;
            filterCategory = 'leave';
            badgeClass = 'bg-blue-100 text-blue-900 border-blue-400 font-bold';
          } else if (isLive) {
            liveCount++;
            status = 'CURRENT SLOT (Awaiting Attendance)';
            filterCategory = 'current';
            badgeClass = 'bg-emerald-600 text-white border-emerald-700 animate-pulse';
          } else if (isPast) {
            status = 'Pending Mark';
            filterCategory = 'remaining';
            badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
          } else {
            remainingCount++;
            status = 'Remaining';
            filterCategory = 'remaining';
            badgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
          }
        }

        return {
          ...s,
          log,
          startMin,
          endMin,
          isLive,
          isCurrentSlot,
          isRunningMarked,
          isPast,
          isUpcoming,
          isTrial,
          isLeaveStudent,
          status,
          badgeClass,
          filterCategory
        };
      });

      DASHBOARD_CLASSES.sort((a, b) => a.startMin - b.startMin);

      const currentSlotTotal = DASHBOARD_CLASSES.filter(c => c.isCurrentSlot).length;
      const runningMarkedTotal = DASHBOARD_CLASSES.filter(c => c.isRunningMarked).length;

      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      setEl('kpiDashTotal', totalToday);
      setEl('kpiDashCurrent', currentSlotTotal);
      setEl('kpiDashRunning', runningMarkedTotal);
      setEl('kpiDashLive', currentSlotTotal);
      const wBadge = document.getElementById('kpiDashWaitingBadge');
      if (wBadge) {
        if (waitingCount > 0) {
          wBadge.innerText = `${waitingCount} Waiting`;
          wBadge.classList.remove('hidden');
        } else {
          wBadge.classList.add('hidden');
        }
      }
      setEl('kpiDashCompleted', completedCount);
      setEl('kpiDashRemaining', remainingCount);
      setEl('kpiDashAbsent', absentCount);
      setEl('kpiDashLeave', leaveCount);
      setEl('kpiDashTrial', trialCount);

      // Also set legacy KPIs if element exists
      setEl('kpiTotalToday', totalToday);
      setEl('kpiLiveNow', currentSlotTotal);
      setEl('kpiCompleted', completedCount);
      setEl('kpiRemaining', remainingCount);
      setEl('kpiAbsent', absentCount);
      setEl('kpiOnLeave', leaveCount);

      if (CURRENT_DASH_FILTER) {
        renderDashboardClassesTable();
      }

      // Check scheduled leave returns and pending teacher requests
      await checkLeaveReturnAlertsAndRequests();
    }

    const loadLiveMonitorData = loadDashboardData;

    function filterDashboardClasses(filterType) {
      if (CURRENT_DASH_FILTER === filterType) {
        closeDashboardClassesView();
        return;
      }
      CURRENT_DASH_FILTER = filterType;

      document.querySelectorAll('.kpi-dash-card').forEach(box => {
        box.classList.remove('ring-2', 'ring-brandDark', 'ring-offset-2', 'scale-105', 'shadow-md', 'ring-4', 'ring-white', 'shadow-xl');
      });

      const selectedBox = document.getElementById(`kpiBox-${filterType}`);
      if (selectedBox) {
        selectedBox.classList.add('ring-2', 'ring-brandDark', 'ring-offset-2', 'scale-[1.02]', 'shadow-md');
      }

      const classesSection = document.getElementById('dashClassesSection');
      if (classesSection) {
        classesSection.classList.remove('hidden');
      }

      const titleMap = {
        'all': { text: 'All Scheduled Classes Today', subtitle: 'Full schedule roster across morning, afternoon & evening shifts', icon: 'fa-calendar-day' },
        'current': { text: 'Current Classes (Current Time Slot)', subtitle: 'All classes scheduled in the active 30-minute time slot right now', icon: 'fa-clock' },
        'running': { text: 'Running Classes (Attendance Marked)', subtitle: 'Ongoing classes in the current slot where the teacher has marked attendance', icon: 'fa-tower-broadcast' },
        'live': { text: 'Current Classes', subtitle: 'Classes scheduled in the current time slot', icon: 'fa-tower-broadcast' },
        'waiting': { text: 'Teacher Waiting Classes', subtitle: 'Teacher has launched Zoom and is actively waiting for student to join', icon: 'fa-hourglass-start' },
        'completed': { text: 'Taken Classes Today', subtitle: 'Sessions marked Present / Taken since 12:00 AM midnight', icon: 'fa-circle-check' },
        'remaining': { text: 'Remaining Classes Today', subtitle: 'Upcoming classes scheduled to take place before midnight', icon: 'fa-hourglass-half' },
        'absent': { text: 'Absent Sessions Today', subtitle: 'Students marked Absent for their scheduled sessions today', icon: 'fa-user-xmark' },
        'leave': { text: 'Student Leaves Today', subtitle: 'Students on approved leave for sessions today', icon: 'fa-calendar-xmark' },
        'trial': { text: 'Trial Classes Today', subtitle: 'Trial and evaluation lessons scheduled for today', icon: 'fa-graduation-cap' }
      };

      const meta = titleMap[filterType] || titleMap['all'];
      const titleEl = document.getElementById('dashFilterTitle');
      if (titleEl) titleEl.innerText = meta.text;
      const subEl = document.getElementById('dashFilterSubtitle');
      if (subEl) subEl.innerText = meta.subtitle;
      const iconContainer = document.getElementById('dashFilterIcon');
      if (iconContainer) iconContainer.innerHTML = `<i class="fa-solid ${meta.icon}"></i>`;

      renderDashboardClassesTable();

      setTimeout(() => {
        classesSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        DASH_STUDENT_CHART?.resize();
        DASH_REVENUE_CHART?.resize();
      }, 50);
    }

    function closeDashboardClassesView() {
      CURRENT_DASH_FILTER = null;
      document.querySelectorAll('.kpi-dash-card').forEach(box => {
        box.classList.remove('ring-2', 'ring-brandDark', 'ring-offset-2', 'scale-105', 'scale-[1.02]', 'scale-[1.01]', 'shadow-md', 'ring-4', 'ring-white', 'shadow-xl');
      });
      const classesSection = document.getElementById('dashClassesSection');
      if (classesSection) {
        classesSection.classList.add('hidden');
      }
      setTimeout(() => {
        DASH_STUDENT_CHART?.resize();
        DASH_REVENUE_CHART?.resize();
      }, 50);
    }

    function renderDashboardClassesTable(searchQuery = '') {
      const tbody = document.getElementById('dashClassesTableBody');
      const emptyState = document.getElementById('dashEmptyState');
      const countBadge = document.getElementById('dashFilterCountBadge');
      if (!tbody) return;

      const query = (searchQuery || (document.getElementById('dashClassSearch')?.value || '')).trim().toLowerCase();

      let filtered = DASHBOARD_CLASSES.filter(c => {
        if (CURRENT_DASH_FILTER === 'all') {
          // all
        } else if (CURRENT_DASH_FILTER === 'current' || CURRENT_DASH_FILTER === 'live') {
          if (!c.isCurrentSlot) return false;
        } else if (CURRENT_DASH_FILTER === 'running') {
          if (!c.isRunningMarked) return false;
        } else if (CURRENT_DASH_FILTER === 'waiting') {
          if (c.filterCategory !== 'waiting') return false;
        } else if (CURRENT_DASH_FILTER === 'completed') {
          if (c.filterCategory !== 'completed') return false;
        } else if (CURRENT_DASH_FILTER === 'remaining') {
          if (c.filterCategory !== 'remaining' && !c.isUpcoming) return false;
        } else if (CURRENT_DASH_FILTER === 'absent') {
          if (c.filterCategory !== 'absent') return false;
        } else if (CURRENT_DASH_FILTER === 'leave') {
          if (c.filterCategory !== 'leave') return false;
        } else if (CURRENT_DASH_FILTER === 'trial') {
          if (!c.isTrial) return false;
        }

        if (query) {
          const studentName = (c.students?.name || '').toLowerCase();
          const studentId = (c.students?.id || '').toLowerCase();
          const teacherName = (c.teachers?.full_name || '').toLowerCase();
          const courseName = (c.courses?.name || 'quran studies').toLowerCase();
          if (!studentName.includes(query) && !studentId.includes(query) && !teacherName.includes(query) && !courseName.includes(query)) {
            return false;
          }
        }

        return true;
      });

      if (countBadge) countBadge.innerText = `${filtered.length} Classes`;

      if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) {
          emptyState.classList.remove('hidden');
          const emptyTitle = document.getElementById('dashEmptyStateTitle');
          const emptyMsg = document.getElementById('dashEmptyStateMsg');
          
          const emptyMessages = {
            'all': { title: 'No Classes Scheduled Today', msg: 'No classes are scheduled for today in the timetable.' },
            'current': { title: 'No Classes Scheduled In Current Slot', msg: 'There are no classes scheduled in the current 30-minute time slot.' },
            'running': { title: 'No Running Classes Marked Yet', msg: 'No teachers have marked attendance for the current time slot yet.' },
            'live': { title: 'No Classes In This Slot', msg: 'No ongoing classes in the current time slot.' },
            'completed': { title: 'No Taken Classes Yet', msg: 'No taken classes recorded yet today since midnight.' },
            'remaining': { title: 'All Scheduled Classes Taken', msg: 'No remaining classes scheduled for the rest of today.' },
            'absent': { title: 'Zero Absent Sessions Today', msg: 'Zero absent students recorded today. All students are attending regularly!' },
            'leave': { title: 'No Student Leaves Marked Today', msg: 'No student leaves recorded for today.' },
            'trial': { title: 'No Trial Classes Scheduled Today', msg: 'No trial classes booked for today.' }
          };

          const msg = emptyMessages[CURRENT_DASH_FILTER] || emptyMessages['all'];
          if (emptyTitle) emptyTitle.innerText = msg.title;
          if (emptyMsg) emptyMsg.innerText = msg.msg;
        }
        return;
      }

      if (emptyState) emptyState.classList.add('hidden');

      const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

      tbody.innerHTML = filtered.map(c => {
        let timingNote = '';
        if (c.isLive) {
          const remainingMin = c.endMin - nowMinutes;
          timingNote = `<span class="text-[10px] text-emerald-700 font-extrabold block">● Live Now (${remainingMin}m left)</span>`;
        } else if (c.isUpcoming) {
          const startIn = c.startMin - nowMinutes;
          const hours = Math.floor(startIn / 60);
          const mins = startIn % 60;
          timingNote = `<span class="text-[10px] text-slate-500 block">Starts in ${hours > 0 ? hours + 'h ' : ''}${mins}m</span>`;
        } else {
          timingNote = `<span class="text-[10px] text-slate-400 block">Slot Ended</span>`;
        }

        const cleanPhone = (c.students?.whatsapp || '').replace(/[^0-9]/g, '');
        const waChat = (cleanPhone && CURRENT_ROLE !== 'manager') ? `<a href="https://wa.me/${cleanPhone}" target="_blank" class="text-emerald-600 hover:text-emerald-800 ml-1.5" title="WhatsApp Parent"><i class="fa-brands fa-whatsapp"></i></a>` : '';

        const typeBadge = c.isTrial 
          ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-800 border border-purple-200">Trial</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">Regular</span>';

        let sabaqText = `<span class="text-slate-400 italic">No notes logged yet</span>`;
        if (c.log?.lesson_notes) {
          try {
            const pMeta = JSON.parse(c.log.lesson_notes);
            if (pMeta.book_title || pMeta.page) {
              const passColor = pMeta.status === 'Pass' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-amber-100 text-amber-800 border-amber-300';
              sabaqText = `
                <div class="space-y-1">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-bold text-slate-800 text-xs flex items-center gap-1">
                      <i class="fa-solid fa-book-open text-brandEmerald"></i> ${pMeta.book_title || 'Course'}
                    </span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${passColor} border">
                      Pg ${pMeta.page || '1'} ${pMeta.line_range ? `(${pMeta.line_range})` : ''} - ${pMeta.status || 'Done'}
                    </span>
                  </div>
                  ${pMeta.remarks ? `<div class="text-[11px] text-slate-600 italic">"${pMeta.remarks}"</div>` : ''}
                  <button onclick="openDigitalBookReader('${pMeta.book_id || 'noorani-qaida-classic'}', ${pMeta.page || 1})" class="text-[10px] text-emerald-700 hover:text-emerald-900 font-bold underline flex items-center gap-1">
                    <i class="fa-solid fa-book-reader"></i> Read Page ${pMeta.page || 1}
                  </button>
                </div>
              `;
            } else {
              sabaqText = `<span class="text-slate-800 font-semibold">${c.log.lesson_notes}</span>`;
            }
          } catch(e) {
            sabaqText = `<span class="text-slate-800 font-semibold">${c.log.lesson_notes}</span>`;
          }
        }

        // KPI Color-Matched Row Styling
        let rowClass = 'border-l-4 border-slate-300 hover:bg-slate-50 transition';
        if (c.filterCategory === 'absent' || c.status === 'Absent') {
          rowClass = 'border-l-4 border-rose-500 bg-rose-50/80 hover:bg-rose-100/70 transition font-medium text-rose-950';
        } else if (c.filterCategory === 'waiting' || c.status === '⏳ Teacher Waiting') {
          rowClass = 'border-l-4 border-amber-500 bg-amber-50/80 hover:bg-amber-100/70 transition font-medium text-amber-950';
        } else if (c.isLive || c.filterCategory === 'live') {
          rowClass = 'border-l-4 border-emerald-500 bg-emerald-50/80 hover:bg-emerald-100/70 transition font-semibold text-emerald-950';
        } else if (c.status?.includes('Advance') || c.status?.includes('Pre-Covered')) {
          rowClass = 'border-l-4 border-purple-500 bg-purple-50/60 hover:bg-purple-100/70 transition font-medium text-purple-950';
        } else if (c.filterCategory === 'completed' || c.status === 'Completed') {
          rowClass = 'border-l-4 border-teal-500 bg-teal-50/50 hover:bg-teal-100/60 transition text-teal-950';
        } else if (c.filterCategory === 'leave' || c.status === 'Leave' || c.status?.includes('Leave')) {
          rowClass = 'border-l-4 border-blue-500 bg-blue-50/70 hover:bg-blue-100/60 transition font-medium text-blue-950';
        } else if (c.isTrial) {
          rowClass = 'border-l-4 border-purple-500 bg-purple-50/50 hover:bg-purple-100/60 transition text-purple-950';
        }

        return `
          <tr class="${rowClass}">
            <td class="p-3">
              <div class="font-mono font-black text-xs">
                ${c.start_time.slice(0,5)} - ${c.end_time.slice(0,5)}
              </div>
              ${timingNote}
            </td>

            <td class="p-3">
              <div class="flex items-center">
                <button onclick="openStudentDetailModal('${c.student_id || c.students?.id || ''}')" class="font-bold text-slate-900 hover:text-brandEmerald hover:underline text-left flex items-center gap-1 group" title="Click to view Student Profile & Family">
                  <span>${c.students?.name || 'Student'}</span>
                  <i class="fa-solid fa-circle-info text-[10px] text-slate-400 group-hover:text-brandEmerald"></i>
                </button>
                ${waChat}
              </div>
              <div class="flex items-center gap-1 mt-0.5 text-[10px] text-slate-500 font-mono">
                <span>${c.students?.id || 'STU-ID'}</span>
                ${c.students?.family_id ? `&bull; <span>${c.students.family_id}</span>` : ''}
              </div>
            </td>

            <td class="p-3">
              <span class="px-2 py-0.5 rounded bg-emerald-50 text-brandEmerald font-bold text-[11px] border border-emerald-200">
                ${c.courses?.name || 'Quran Studies & Tajweed'}
              </span>
            </td>

            <td class="p-3">
              <div>
                <button onclick="openTeacherOptionsModal('${c.teacher_id || c.teachers?.id || ''}')" class="font-bold text-brandDark hover:text-brandEmerald hover:underline text-left flex items-center gap-1 group" title="Click for Teacher Profile & 2D Weekly Schedule">
                  <span>${c.teachers?.full_name || 'Assigned Teacher'}</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-400 group-hover:text-brandEmerald"></i>
                </button>
              </div>
              <div class="text-[10px] text-slate-400 font-mono">${c.teachers?.phone || c.teachers?.email || 'Teacher ID'}</div>
            </td>

            <td class="p-3">
              ${typeBadge}
            </td>

            <td class="p-3 max-w-xs truncate">
              ${sabaqText}
              <div class="mt-0.5">
                <span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${c.badgeClass}">
                  ${c.status}
                </span>
              </div>
            </td>

            <td class="p-3 text-right">
              <div class="flex items-center justify-end gap-1.5 flex-wrap">
                <button onclick="openDashAttendanceModal('${c.id}', '${c.students?.name || ''}', '${c.start_time.slice(0,5)} - ${c.end_time.slice(0,5)}', '${c.teachers?.full_name || ''}', '${c.student_id}', '${c.teacher_id}', '${c.log?.status || ''}', '${c.log?.lesson_notes || ''}')" class="px-2.5 py-1 bg-brandDark text-white rounded-md text-[11px] font-bold hover:bg-brandDarkest shadow-sm flex items-center gap-1">
                  <i class="fa-solid fa-clipboard-check"></i> Attendance
                </button>

                ${c.meeting_link ? `
                  <a href="${c.meeting_link}" target="_blank" class="px-2.5 py-1 bg-emerald-600 text-white rounded-md text-[11px] font-bold hover:bg-emerald-700 shadow-sm flex items-center gap-1">
                    <i class="fa-solid fa-video"></i> Join
                  </a>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    function handleDashClassSearch(query) {
      renderDashboardClassesTable(query);
    }

    function openDashAttendanceModal(scheduleId, studentName, timeSlot, teacherName, studentId, teacherId, currentStatus, currentNotes) {
      document.getElementById('dashAttScheduleId').value = scheduleId;
      document.getElementById('dashAttStudentId').value = studentId;
      document.getElementById('dashAttTeacherId').value = teacherId;
      document.getElementById('dashAttStudentName').innerText = studentName || 'Student';
      document.getElementById('dashAttTime').innerText = timeSlot || '--';
      document.getElementById('dashAttTeacherName').innerText = teacherName || 'Teacher';
      document.getElementById('dashAttNotes').value = currentNotes || '';

      selectDashAttStatus(currentStatus || 'Present');
      openModal('modalDashAttendance');
    }

    function selectDashAttStatus(status) {
      document.getElementById('dashAttSelectedStatus').value = status;
      const btnP = document.getElementById('btnAttPresent');
      const btnAdv = document.getElementById('btnAttAdvance');
      const btnA = document.getElementById('btnAttAbsent');
      const btnL = document.getElementById('btnAttLeave');

      if (btnP) btnP.className = 'py-2.5 rounded-xl border font-bold flex flex-col items-center gap-1 ' + 
        (status === 'Present' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700 hover:bg-emerald-50');
      
      if (btnAdv) btnAdv.className = 'py-2.5 rounded-xl border font-bold flex flex-col items-center gap-1 ' + 
        (status === 'Advance Class' ? 'border-purple-500 bg-purple-50 text-purple-800' : 'border-slate-300 text-slate-700 hover:bg-purple-50');

      if (btnA) btnA.className = 'py-2.5 rounded-xl border font-bold flex flex-col items-center gap-1 ' + 
        (status === 'Absent' ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-300 text-slate-700 hover:bg-rose-50');

      if (btnL) btnL.className = 'py-2.5 rounded-xl border font-bold flex flex-col items-center gap-1 ' + 
        (status === 'Leave' ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-300 text-slate-700 hover:bg-blue-50');
    }

    async function handleSaveDashAttendance(e) {
      e.preventDefault();
      const btn = document.getElementById('btnSaveDashAtt');
      btn.disabled = true;
      btn.innerText = 'Saving...';

      const schedule_id = document.getElementById('dashAttScheduleId').value;
      const student_id = document.getElementById('dashAttStudentId').value;
      const teacher_id = document.getElementById('dashAttTeacherId').value;
      const status = document.getElementById('dashAttSelectedStatus').value;
      const lesson_notes = document.getElementById('dashAttNotes').value.trim();
      const date = new Date().toISOString().slice(0, 10);

      await db.from('attendance_logs').upsert([{
        schedule_id,
        student_id,
        teacher_id,
        date,
        status,
        lesson_notes
      }], { onConflict: 'schedule_id,date' });

      closeModal('modalDashAttendance');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Attendance';

      await loadDashboardData();
    }

    // INTERACTIVE STUDENT DETAIL MODAL
    async function openStudentDetailModal(studentId) {
      if (!studentId) return;
      CURRENT_MODAL_STUDENT_ID = studentId;

      let student = (ALL_STUDENTS || []).find(s => s.id === studentId);
      if (!student) {
        const foundInDash = (DASHBOARD_CLASSES || []).find(c => c.student_id === studentId || c.students?.id === studentId);
        if (foundInDash && foundInDash.students) {
          student = foundInDash.students;
        }
      }

      if (!student) {
        const { data } = await db.from('students').select('*').eq('id', studentId).maybeSingle();
        student = data;
      }

      if (!student) {
        alert("Student profile details could not be found.");
        return;
      }

      // Find family
      let family = (ALL_FAMILIES || []).find(f => f.id === student.family_id);
      if (!family && student.family_id) {
        const { data } = await db.from('families').select('*').eq('id', student.family_id).maybeSingle();
        family = data;
      }

      let lang = 'English';
      let days = '5 Days / Week (Mon - Fri)';
      if (student.notes) {
        try {
          const meta = JSON.parse(student.notes);
          if (meta.language) lang = meta.language;
          if (meta.days_per_week) days = meta.days_per_week;
        } catch (e) {}
      }
      if (student.language) lang = student.language;

      let teacherName = 'Not Assigned';
      const teacherId = student.assigned_teacher_id;
      if (teacherId) {
        const t = (ALL_TEACHERS || []).find(tc => tc.id === teacherId);
        if (t) teacherName = t.full_name;
      } else {
        const dashMatch = (DASHBOARD_CLASSES || []).find(c => c.student_id === studentId);
        if (dashMatch && dashMatch.teachers) teacherName = dashMatch.teachers.full_name;
      }

      // Populate Modal Fields
      document.getElementById('stuDetailName').innerText = student.name || 'Student Details';
      document.getElementById('stuDetailIdBadge').innerText = student.id || '--';
      document.getElementById('stuDetailAgeGender').innerText = `${student.age || 'N/A'} yrs • ${student.gender || 'N/A'}`;
      document.getElementById('stuDetailLanguage').innerText = lang;
      document.getElementById('stuDetailCourse').innerText = student.course_id || 'Quran Studies & Tajweed';
      document.getElementById('stuDetailDays').innerText = days;
      document.getElementById('stuDetailJoining').innerText = student.joining_date || 'N/A';
      document.getElementById('stuDetailTeacher').innerText = teacherName;
      const rawPhone = student.whatsapp || family?.whatsapp || '';
      const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
      const displayedPhone = (CURRENT_ROLE === 'manager') ? maskStudentPhone(rawPhone) : rawPhone;
      document.getElementById('stuDetailLocation').innerText = family ? `${family.country || 'Global'} • ${displayedPhone || ''}` : 'Location N/A';

      // WhatsApp direct contact (Protected from Manager)
      const waBtn = document.getElementById('stuDetailWhatsAppBtn');
      if (waBtn) {
        if (cleanPhone && CURRENT_ROLE !== 'manager') {
          const waMsg = `Assalam-o-Alaikum,\nRegarding student *${student.name}* (ID: ${student.id}) from *Al-Huda Islamic Centre LMS*.`;
          waBtn.href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;
          waBtn.style.display = 'inline-flex';
        } else {
          waBtn.style.display = 'none';
        }
      }

      openModal('modalStudentDetail');
    }

    function viewStudentInFamilyDirectory() {
      closeModal('modalStudentDetail');
      switchTab('tab-families');
    }

    // INTERACTIVE TEACHER OPTIONS & MATRIX MODAL
    async function openTeacherOptionsModal(teacherId) {
      if (!teacherId) return;
      CURRENT_MODAL_TEACHER_ID = teacherId;

      let teacher = (ALL_TEACHERS || []).find(t => t.id === teacherId);
      if (!teacher) {
        const foundInDash = (DASHBOARD_CLASSES || []).find(c => c.teacher_id === teacherId || c.teachers?.id === teacherId);
        if (foundInDash && foundInDash.teachers) {
          teacher = foundInDash.teachers;
        }
      }

      if (!teacher) {
        const { data } = await db.from('teachers').select('*').eq('id', teacherId).maybeSingle();
        teacher = data;
      }

      if (!teacher) {
        alert("Teacher profile details could not be found.");
        return;
      }

      document.getElementById('tOptionName').innerText = teacher.full_name || 'Teacher Profile';
      document.getElementById('tOptionIdBadge').innerText = teacher.id || '--';
      document.getElementById('tOptionQual').innerText = teacher.qualification || 'Quran & Tajweed Instructor';
      document.getElementById('tOptionRate').innerText = `${teacher.rate_per_slot || 200} PKR / slot`;
      document.getElementById('tOptionShift').innerText = teacher.working_shift || '10 Hours Shift (Morning / Evening)';

      // WhatsApp Button
      const cleanPhone = (teacher.phone || '').replace(/[^0-9]/g, '');
      const waBtn = document.getElementById('tOptionWhatsAppBtn');
      if (waBtn) {
        if (cleanPhone) {
          const waMsg = `Assalam-o-Alaikum Teacher *${teacher.full_name}*,\nContact from Al-Huda Islamic Centre Administration.`;
          waBtn.href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;
          waBtn.classList.remove('hidden');
          waBtn.classList.add('flex');
        } else {
          waBtn.classList.add('hidden');
          waBtn.classList.remove('flex');
        }
      }

      // Fetch & populate assigned students for this teacher
      const countBadge = document.getElementById('tOptionStudentCount');
      const listContainer = document.getElementById('tOptionStudentsList');
      if (countBadge) countBadge.innerText = 'Loading...';
      if (listContainer) listContainer.innerHTML = '<div class="text-slate-400 py-1">Loading assigned students...</div>';

      try {
        const { data: scheds } = await db.from('class_schedules')
          .select('student_id, students(name, course_id, family_id)')
          .eq('teacher_id', teacherId);

        const uniqueStudentsMap = {};
        (scheds || []).forEach(s => {
          if (s.students && s.student_id) {
            uniqueStudentsMap[s.student_id] = s.students;
          }
        });

        (ALL_STUDENTS || []).forEach(st => {
          if (st.assigned_teacher_id === teacherId) {
            uniqueStudentsMap[st.id] = st;
          }
        });

        const studentsArr = Object.entries(uniqueStudentsMap);
        if (countBadge) countBadge.innerText = `${studentsArr.length} Students`;

        if (studentsArr.length === 0) {
          if (listContainer) listContainer.innerHTML = '<div class="text-slate-400 italic py-1">No students currently assigned to this teacher.</div>';
        } else {
          if (listContainer) {
            listContainer.innerHTML = studentsArr.map(([sId, sObj]) => `
              <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
                <div>
                  <div class="font-bold text-slate-800">${sObj.name || 'Student'}</div>
                  <div class="text-[10px] text-slate-500 font-mono">${sId} &bull; ${sObj.course_id || 'Quran'}</div>
                </div>
                <button onclick="closeModal('modalTeacherOptions'); openStudentDetailModal('${sId}')" class="px-2 py-1 bg-brandDark text-white text-[10px] font-bold rounded hover:bg-brandDarkest shadow-xs">
                  View Student
                </button>
              </div>
            `).join('');
          }
        }
      } catch (err) {
        console.error("Error loading teacher students:", err);
        if (countBadge) countBadge.innerText = '0 Students';
        if (listContainer) listContainer.innerHTML = '<div class="text-slate-400 py-1">Could not fetch students list.</div>';
      }

      openModal('modalTeacherOptions');
    }

    function triggerTeacherMatrixFromOptions() {
      if (!CURRENT_MODAL_TEACHER_ID) return;
      const tId = CURRENT_MODAL_TEACHER_ID;
      closeModal('modalTeacherOptions');
      switchTab('tab-teachers');
      open2DMatrixForTeacher(tId);
    }

    function viewTeacherInDirectory() {
      closeModal('modalTeacherOptions');
      switchTab('tab-teachers');
    }

    // =========================================================================
    // MAIN DASHBOARD GLOBAL SEARCH BAR (STUDENTS, FAMILIES & TEACHERS)
    // Searches by Name, Student/Family/Teacher ID, or Phone/WhatsApp Number
    // =========================================================================
    let _dashSearchDataPromise = null;

    async function ensureDashboardSearchDataLoaded() {
      if ((ALL_FAMILIES && ALL_FAMILIES.length > 0) && (ALL_STUDENTS && ALL_STUDENTS.length > 0) && (ALL_TEACHERS && ALL_TEACHERS.length > 0)) {
        return;
      }
      if (_dashSearchDataPromise) return _dashSearchDataPromise;

      _dashSearchDataPromise = (async () => {
        try {
          const [famRes, stuRes, tchRes] = await Promise.all([
            (!ALL_FAMILIES || ALL_FAMILIES.length === 0) ? db.from('families').select('*, students(*)').order('created_at', { ascending: false }) : Promise.resolve({ data: ALL_FAMILIES }),
            (!ALL_STUDENTS || ALL_STUDENTS.length === 0) ? db.from('students').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: ALL_STUDENTS }),
            (!ALL_TEACHERS || ALL_TEACHERS.length === 0) ? db.from('teachers').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: ALL_TEACHERS })
          ]);
          if (famRes.data && (!ALL_FAMILIES || ALL_FAMILIES.length === 0)) ALL_FAMILIES = famRes.data;
          if (stuRes.data && (!ALL_STUDENTS || ALL_STUDENTS.length === 0)) ALL_STUDENTS = stuRes.data;
          if (tchRes.data && (!ALL_TEACHERS || ALL_TEACHERS.length === 0)) ALL_TEACHERS = tchRes.data;
        } catch (err) {
          console.error('Dashboard search cache load error:', err);
        } finally {
          _dashSearchDataPromise = null;
        }
      })();

      return _dashSearchDataPromise;
    }

    async function handleDashboardGlobalSearch(rawQuery) {
      const panel = document.getElementById('dashGlobalSearchResultsPanel');
      const clearBtn = document.getElementById('btnClearDashGlobalSearch');
      const q = (rawQuery || '').trim().toLowerCase();

      if (clearBtn) {
        if (q.length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
      }

      if (!panel) return;

      if (!q) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
      }

      await ensureDashboardSearchDataLoaded();

      const familyMap = {};
      (ALL_FAMILIES || []).forEach(f => { familyMap[f.id] = f; });

      const teacherMap = {};
      (ALL_TEACHERS || []).forEach(t => { teacherMap[t.id] = t; });

      // 1. Match Students (by Name, Student ID, Family ID, or Parent Phone)
      const matchedStudents = (ALL_STUDENTS || []).filter(s => {
        const sName = String(s.name || '').toLowerCase();
        const sId = String(s.id || '').toLowerCase();
        const fId = String(s.family_id || '').toLowerCase();
        const fam = familyMap[s.family_id];
        const fName = fam ? String(fam.parent_name || '').toLowerCase() : '';
        const fPhone = fam ? String(fam.whatsapp || '').toLowerCase() : '';
        return sName.includes(q) || sId.includes(q) || fId.includes(q) || fName.includes(q) || fPhone.includes(q);
      }).slice(0, 6);

      // 2. Match Families (by Parent Name, Family ID, or Phone/WhatsApp)
      const matchedFamilies = (ALL_FAMILIES || []).filter(f => {
        const fName = String(f.parent_name || '').toLowerCase();
        const fId = String(f.id || '').toLowerCase();
        const fPhone = String(f.whatsapp || '').toLowerCase();
        return fName.includes(q) || fId.includes(q) || fPhone.includes(q);
      }).slice(0, 5);

      // 3. Match Teachers (by Full Name, Teacher ID/Portal ID, or Phone)
      const matchedTeachers = (ALL_TEACHERS || []).filter(t => {
        const tName = String(t.full_name || '').toLowerCase();
        const tId = String(t.id || '').toLowerCase();
        const tPhone = String(t.phone || '').toLowerCase();
        let credsId = '';
        if (typeof getTeacherCreds === 'function') {
          try { credsId = String(getTeacherCreds(t)?.teacher_id || '').toLowerCase(); } catch (e) {}
        }
        return tName.includes(q) || tId.includes(q) || credsId.includes(q) || tPhone.includes(q);
      }).slice(0, 5);

      const totalCount = matchedStudents.length + matchedFamilies.length + matchedTeachers.length;

      if (totalCount === 0) {
        panel.innerHTML = `
          <div class="p-4 text-center text-xs text-slate-400 font-semibold">
            <i class="fa-solid fa-magnifying-glass-minus text-slate-300 text-base mb-1 block"></i>
            No matching Student, Family, or Teacher found for "<span class="text-slate-700 font-bold">${rawQuery}</span>"
          </div>
        `;
        panel.classList.remove('hidden');
        return;
      }

      let html = '';

      // Render Students Section
      if (matchedStudents.length > 0) {
        html += `
          <div class="p-2">
            <div class="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-teal-800 bg-teal-50/80 rounded-lg mb-1 flex items-center justify-between">
              <span><i class="fa-solid fa-user-graduate mr-1"></i> Students (${matchedStudents.length})</span>
              <span class="text-[9px] text-teal-600 font-bold">Click to View Profile</span>
            </div>
            <div class="space-y-1">
              ${matchedStudents.map(s => {
                const fam = familyMap[s.family_id];
                const parentName = fam ? fam.parent_name : (s.family_id || '--');
                const rawPhone = fam ? (fam.whatsapp || '') : '';
                const displayPhone = (typeof maskStudentPhone === 'function') ? maskStudentPhone(rawPhone) : (rawPhone || '--');
                return `
                  <div onclick="clearDashboardGlobalSearch(); openStudentDetailModal('${s.id}')" class="px-2.5 py-1.5 rounded-xl hover:bg-teal-50/70 cursor-pointer transition flex items-center justify-between gap-2 border border-transparent hover:border-teal-200">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="text-xs font-extrabold text-slate-900 truncate">${s.name}</span>
                        <span class="px-1.5 py-0.2 rounded bg-slate-100 border border-slate-200 font-mono text-[9px] font-bold text-brandDark shrink-0">${s.id}</span>
                      </div>
                      <div class="text-[10px] text-slate-500 truncate">
                        Parent: <strong class="text-slate-700">${parentName}</strong> &bull; <span class="font-mono">${displayPhone}</span>
                      </div>
                    </div>
                    <span class="px-2 py-0.5 rounded-lg bg-brandDark text-white text-[10px] font-bold shrink-0">Profile</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      // Render Families Section
      if (matchedFamilies.length > 0) {
        html += `
          <div class="p-2">
            <div class="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-50/80 rounded-lg mb-1 flex items-center justify-between">
              <span><i class="fa-solid fa-house-user mr-1"></i> Families (${matchedFamilies.length})</span>
              <span class="text-[9px] text-emerald-600 font-bold">Click to Open Family</span>
            </div>
            <div class="space-y-1">
              ${matchedFamilies.map(f => {
                const displayPhone = (typeof maskStudentPhone === 'function') ? maskStudentPhone(f.whatsapp) : (f.whatsapp || '--');
                const childCount = (f.students || []).length;
                return `
                  <div onclick="openFamilyFromDashboardSearch('${f.id}')" class="px-2.5 py-1.5 rounded-xl hover:bg-emerald-50/70 cursor-pointer transition flex items-center justify-between gap-2 border border-transparent hover:border-emerald-200">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="text-xs font-extrabold text-slate-900 truncate">${f.parent_name}</span>
                        <span class="px-1.5 py-0.2 rounded bg-emerald-100 border border-emerald-200 font-mono text-[9px] font-bold text-emerald-900 shrink-0">${f.id}</span>
                      </div>
                      <div class="text-[10px] text-slate-500 truncate">
                        Phone: <span class="font-mono font-semibold text-slate-700">${displayPhone}</span> &bull; ${childCount} Child(ren)
                      </div>
                    </div>
                    <span class="px-2 py-0.5 rounded-lg bg-emerald-700 text-white text-[10px] font-bold shrink-0">Open</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      // Render Teachers Section
      if (matchedTeachers.length > 0) {
        html += `
          <div class="p-2">
            <div class="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-indigo-800 bg-indigo-50/80 rounded-lg mb-1 flex items-center justify-between">
              <span><i class="fa-solid fa-chalkboard-user mr-1"></i> Teachers &amp; Staff (${matchedTeachers.length})</span>
              <span class="text-[9px] text-indigo-600 font-bold">Click to Inspect</span>
            </div>
            <div class="space-y-1">
              ${matchedTeachers.map(t => {
                let credsId = t.id || 'TCH';
                if (typeof getTeacherCreds === 'function') {
                  try { credsId = getTeacherCreds(t)?.teacher_id || credsId; } catch (e) {}
                }
                return `
                  <div onclick="clearDashboardGlobalSearch(); openTeacherDetailModal('${t.id}')" class="px-2.5 py-1.5 rounded-xl hover:bg-indigo-50/70 cursor-pointer transition flex items-center justify-between gap-2 border border-transparent hover:border-indigo-200">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="text-xs font-extrabold text-slate-900 truncate">${t.full_name}</span>
                        <span class="px-1.5 py-0.2 rounded bg-indigo-100 border border-indigo-200 font-mono text-[9px] font-bold text-indigo-900 shrink-0">${credsId}</span>
                      </div>
                      <div class="text-[10px] text-slate-500 truncate">
                        Phone: <span class="font-mono font-semibold text-slate-700">${t.phone || '--'}</span>
                      </div>
                    </div>
                    <span class="px-2 py-0.5 rounded-lg bg-indigo-700 text-white text-[10px] font-bold shrink-0">Details</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      panel.innerHTML = html;
      panel.classList.remove('hidden');
    }

    function clearDashboardGlobalSearch() {
      const input = document.getElementById('dashGlobalSearchInput');
      const panel = document.getElementById('dashGlobalSearchResultsPanel');
      const clearBtn = document.getElementById('btnClearDashGlobalSearch');
      if (input) input.value = '';
      if (panel) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
      }
      if (clearBtn) clearBtn.classList.add('hidden');
    }

    async function openFamilyFromDashboardSearch(familyId) {
      clearDashboardGlobalSearch();
      switchTab('tab-families');
      await loadFamiliesAndStudents();
      const searchInput = document.getElementById('familyDirectorySearchInput');
      if (searchInput) {
        searchInput.value = familyId;
        if (typeof handleFamilyDirectorySearch === 'function') {
          handleFamilyDirectorySearch(familyId);
        }
      }
    }

    // Close dashboard search dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const container = document.getElementById('dashGlobalSearchContainer');
      const panel = document.getElementById('dashGlobalSearchResultsPanel');
      if (container && panel && !container.contains(e.target)) {
        panel.classList.add('hidden');
      }
    });


