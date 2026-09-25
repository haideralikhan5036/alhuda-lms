/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/payroll.js
 * Purpose: Course-Based Auto Payroll Engine, Seniority Increments & Printable/WhatsApp Salary Slips
 * Extracted Line Range: 10522 – 11087 (566 lines)
 * ============================================================================
 */

    // ==========================================
    // COURSE-BASED AUTO PAYROLL & EDITABLE SLIPS
    // ==========================================

    const ACADEMY_COURSE_RATES = {
      'noorani_qaida': 2200,
      'nazra_quran': 2200,
      'weekend_basic': 3200,
      'islamic_studies': 3500,
      'urdu_tafseer': 3500,
      'english_tafseer': 4500
    };

    function getTeacherSeniorityIncrement(teacher, acc) {
      if (!teacher) return 0;
      const account = acc || (getTeacherAccounts()[teacher.id] || {});
      
      if (account.increment_tier && account.increment_tier !== 'auto') {
        return parseInt(account.increment_tier, 10) || 0;
      }

      const joiningDate = account.joining_date || (teacher.created_at ? teacher.created_at.slice(0, 10) : null);
      if (joiningDate) {
        const joinYear = new Date(joiningDate);
        const now = new Date();
        const yearsDiff = Math.floor((now - joinYear) / (365.25 * 24 * 3600 * 1000));
        if (yearsDiff >= 1) {
          return yearsDiff * 200;
        }
      }
      return 0;
    }

    function getStudentCourseSalaryRate(student, scheds, teacherIncrement) {
      // 1. Detect if Weekend Schedule
      let isWeekend = false;
      const dayNums = (scheds || []).map(s => Number(s.day_of_week));
      if (dayNums.length > 0 && dayNums.every(d => d === 6 || d === 7)) {
        isWeekend = true;
      }

      // 2. Parse course details
      let cName = '';
      if (student.course_id && typeof student.course_id === 'string' && student.course_id.length > 10) {
        // Find course name by UUID if matched
        const matchedCourse = (window.ALL_COURSES_CACHE || []).find(c => c.id === student.course_id);
        if (matchedCourse) cName = matchedCourse.name;
      }
      if (!cName && student.notes) {
        try {
          const nObj = JSON.parse(student.notes);
          cName = nObj.course || nObj.trial_course || '';
          if (!isWeekend && (nObj.days_per_week || '').toLowerCase().includes('weekend')) {
            isWeekend = true;
          }
        } catch(e) {
          cName = student.notes;
        }
      }
      cName = (cName || 'Noorani Qaida & Basic Quran').toLowerCase();

      let baseRate = 2200;
      let courseLabel = 'Noorani Qaida & Basic Quran';

      if (cName.includes('english') && (cName.includes('tafseer') || cName.includes('translation'))) {
        baseRate = 4500;
        courseLabel = 'English Translation & Tafseer';
      } else if (cName.includes('urdu') && (cName.includes('tafseer') || cName.includes('translation'))) {
        baseRate = 3500;
        courseLabel = 'Urdu Translation & Tafseer';
      } else if (cName.includes('tafseer') || cName.includes('translation')) {
        baseRate = 4500;
        courseLabel = 'Tafseer & Translation';
      } else if (cName.includes('islamic') || cName.includes('dua')) {
        baseRate = 3500;
        courseLabel = 'Islamic Studies & Duas';
      } else if (isWeekend) {
        baseRate = 3200;
        courseLabel = 'Weekend Quran (Saturday & Sunday)';
      } else {
        baseRate = 2200;
        courseLabel = 'Noorani Qaida / Nazra Quran';
      }

      const finalRate = baseRate + teacherIncrement;

      let scheduleText = 'Regular Days';
      if (isWeekend) {
        scheduleText = 'Weekend (Sat - Sun)';
      } else if (dayNums.length > 0) {
        scheduleText = `${dayNums.length} Days / Week`;
      }

      return {
        baseRate,
        increment: teacherIncrement,
        finalRate,
        courseLabel,
        scheduleText,
        isWeekend
      };
    }

    async function calculateMonthlySalaries() {
      const tbody = document.getElementById('salariesTableBody');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-xl text-brandGold mb-2 block"></i> Compiling automated course-based teacher payroll...</td></tr>';

      const selectedMonth = document.getElementById('salaryMonthSelect')?.value || 'September 2026';

      // 1. Fetch live teachers, schedules, and students
      const { data: teachers } = await db.from('teachers').select('*').order('created_at', { ascending: false });
      ALL_TEACHERS = teachers || [];

      const { data: scheds } = await db.from('class_schedules').select('*, students(*)');
      const { data: students } = await db.from('students').select('*');
      ALL_STUDENTS = students || [];

      // Fetch courses cache
      try {
        const { data: courses } = await db.from('courses').select('*');
        window.ALL_COURSES_CACHE = courses || [];
      } catch(e){}

      if (!teachers || teachers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400">No teachers found in the academy database.</td></tr>';
        return;
      }

      // Load saved salary slips from localStorage
      let savedSalaries = {};
      try {
        savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
      } catch(e) {
        savedSalaries = {};
      }

      const accounts = getTeacherAccounts();
      ALL_TEACHER_SALARIES = {};

      let totalGrossPayroll = 0;
      let totalAssignedStudentsCount = 0;
      let paidCount = 0;
      let activeTeachersCount = 0;

      const teacherCardsData = teachers.map(t => {
        const acc = accounts[t.id] || {};
        const teacherIncrement = getTeacherSeniorityIncrement(t, acc);

        // Find all active students for this teacher
        // Method A: from schedules
        const teacherScheds = (scheds || []).filter(s => s.teacher_id === t.id);
        const studentIdsFromScheds = [...new Set(teacherScheds.map(s => s.student_id))];

        // Method B: from students.assigned_teacher_id
        const studentIdsFromStudents = (students || []).filter(s => s.assigned_teacher_id === t.id && s.status !== 'Trial').map(s => s.id);

        const allStudentIds = [...new Set([...studentIdsFromScheds, ...studentIdsFromStudents])];

        // Fetch student objects
        const assignedStudents = allStudentIds.map(sid => {
          const fromSched = teacherScheds.find(s => s.student_id === sid)?.students;
          const fromStu = (students || []).find(s => s.id === sid);
          return fromSched || fromStu || { id: sid, name: 'Student ' + sid };
        }).filter(s => s && s.name);

        if (assignedStudents.length > 0) activeTeachersCount++;
        totalAssignedStudentsCount += assignedStudents.length;

        // Compile student rate items
        const slipKey = `${t.id}_${selectedMonth.replace(/\s+/g, '_')}`;
        const savedSlip = savedSalaries[slipKey] || null;

        let baseSubtotal = 0;
        const studentRateItems = assignedStudents.map((stu, idx) => {
          const stuScheds = teacherScheds.filter(s => s.student_id === stu.id);
          const rateInfo = getStudentCourseSalaryRate(stu, stuScheds, teacherIncrement);

          // Check if admin custom edited this student's rate previously
          let finalRate = rateInfo.finalRate;
          if (savedSlip && savedSlip.students && savedSlip.students[stu.id] !== undefined) {
            finalRate = parseFloat(savedSlip.students[stu.id]) || rateInfo.finalRate;
          }

          baseSubtotal += finalRate;

          return {
            index: idx + 1,
            student_id: stu.id,
            student_name: stu.name,
            course_label: rateInfo.courseLabel,
            schedule_text: rateInfo.scheduleText,
            base_rate: rateInfo.baseRate,
            increment: teacherIncrement,
            calculated_rate: rateInfo.finalRate,
            final_rate: finalRate
          };
        });

        // Bonuses and Deductions
        const bonus = savedSlip ? (parseFloat(savedSlip.bonus) || 0) : 0;
        const deduction = savedSlip ? (parseFloat(savedSlip.deduction) || 0) : 0;
        const remarks = savedSlip ? (savedSlip.remarks || '') : '';
        const netPayable = Math.max(0, baseSubtotal + bonus - deduction);
        const status = savedSlip ? (savedSlip.status || 'Pending') : 'Pending';

        if (status === 'Paid') paidCount++;
        totalGrossPayroll += netPayable;

        // Store in global state
        const compiledSlip = {
          teacher_id: t.id,
          teacher_name: t.full_name,
          phone: t.phone,
          month: selectedMonth,
          joining_date: acc.joining_date || (t.created_at ? t.created_at.slice(0, 10) : '2025-01-01'),
          seniority_increment: teacherIncrement,
          assigned_students: studentRateItems,
          base_subtotal: baseSubtotal,
          bonus,
          deduction,
          remarks,
          net_payable: netPayable,
          status,
          slip_key: slipKey
        };

        ALL_TEACHER_SALARIES[t.id] = compiledSlip;

        // Seniority text
        const yrs = Math.floor((new Date() - new Date(compiledSlip.joining_date)) / (365.25 * 24 * 3600 * 1000));
        let seniorityBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">Base</span>`;
        if (teacherIncrement > 0) {
          seniorityBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">+${teacherIncrement} PKR/stu (Yr ${yrs || 1})</span>`;
        }

        // Summary breakdown of courses
        const courseCounts = {};
        studentRateItems.forEach(s => {
          courseCounts[s.course_label] = (courseCounts[s.course_label] || 0) + 1;
        });
        const courseSummaryPills = Object.entries(courseCounts).map(([cName, count]) => {
          return `<span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700 border border-slate-200 mr-1 mb-1">${count}x ${cName}</span>`;
        }).join('') || '<span class="text-slate-400 italic text-[11px]">No active students assigned</span>';

        // Adjustments summary
        let adjSummary = '<span class="text-slate-400 text-[11px]">No adjustments</span>';
        if (bonus > 0 || deduction > 0) {
          adjSummary = `
            <div class="text-[11px] font-mono">
              ${bonus > 0 ? `<span class="text-emerald-700 font-bold block">+${bonus.toLocaleString()} PKR (Bonus)</span>` : ''}
              ${deduction > 0 ? `<span class="text-rose-700 font-bold block">-${deduction.toLocaleString()} PKR (Deduction)</span>` : ''}
            </div>
          `;
        }

        const isPaid = status === 'Paid';

        return `
          <tr class="hover:bg-slate-50/80 transition">
            <!-- 1. TEACHER & SENIORITY -->
            <td class="p-3.5">
              <button onclick="openTeacher360Profile('${t.id}', 'salary')" class="font-extrabold text-slate-900 hover:text-indigo-700 hover:underline text-xs text-left block transition">${t.full_name}</button>
              <div class="flex items-center gap-1.5 mt-1">
                ${seniorityBadge}
                <span class="text-[10px] text-slate-400 font-mono">${t.phone}</span>
              </div>
            </td>

            <!-- 2. ASSIGNED STUDENTS -->
            <td class="p-3.5 max-w-xs">
              <button onclick="openTeacher360Profile('${t.id}', 'students')" class="font-black text-xs text-brandDark hover:text-brandEmerald hover:underline mb-1 block text-left">
                <i class="fa-solid fa-user-graduate text-emerald-600"></i> ${studentRateItems.length} Enrolled Students
              </button>
              <div class="flex flex-wrap">${courseSummaryPills}</div>
            </td>

            <!-- 3. BASE COURSE TOTAL -->
            <td class="p-3.5 font-mono">
              <div class="font-bold text-slate-800 text-xs">${baseSubtotal.toLocaleString()} PKR</div>
              <span class="text-[10px] text-slate-400 block">From Course Rates</span>
            </td>

            <!-- 4. BONUS / ADJUSTMENTS -->
            <td class="p-3.5">
              ${adjSummary}
            </td>

            <!-- 5. NET PAYABLE SALARY -->
            <td class="p-3.5 font-mono">
              <div class="text-sm font-black text-brandDarkest bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 inline-block">
                ${netPayable.toLocaleString()} PKR
              </div>
            </td>

            <!-- 6. PAYMENT STATUS -->
            <td class="p-3.5">
              ${isPaid 
                ? '<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> Paid</span>' 
                : '<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300 inline-flex items-center gap-1"><i class="fa-solid fa-clock"></i> Pending</span>'
              }
            </td>

            <!-- 7. ACTIONS & SLIP -->
            <td class="p-3.5 text-right">
              <div class="flex items-center justify-end gap-1.5">
                <button onclick="openSalarySlipModal('${t.id}')" class="px-3 py-1.5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-700 text-brandDarkest font-black rounded-xl text-xs shadow-xs transition flex items-center gap-1.5">
                  <i class="fa-solid fa-receipt"></i> View & Edit Slip
                </button>
                <button onclick="quickToggleSalaryPaid('${t.id}')" title="${isPaid ? 'Mark as Pending' : 'Mark as Paid'}" class="p-2 border rounded-xl text-xs font-bold ${isPaid ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-slate-50 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'} transition">
                  <i class="fa-solid fa-check"></i>
                </button>
                <button onclick="quickSendWhatsAppSlip('${t.id}')" title="Send WhatsApp Salary Slip" class="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-xl text-xs font-bold transition">
                  <i class="fa-brands fa-whatsapp text-sm"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      tbody.innerHTML = teacherCardsData;

      // Update KPI Cards
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      setEl('payrollKpiTotal', `${totalGrossPayroll.toLocaleString()} PKR`);
      setEl('payrollKpiTeachers', `${activeTeachersCount} Active`);
      setEl('payrollKpiStudents', `${totalAssignedStudentsCount} Enrolled`);
      setEl('payrollKpiDisbursed', `${paidCount} / ${teachers.length} Paid`);
    }

    // OPEN ITEMIZED & EDITABLE SALARY SLIP MODAL
    function openSalarySlipModal(teacherId) {
      const slipData = ALL_TEACHER_SALARIES[teacherId];
      if (!slipData) {
        alert("Salary data not available for this instructor.");
        return;
      }

      CURRENT_SLIP_TEACHER_ID = teacherId;
      CURRENT_SLIP_DATA = slipData;

      document.getElementById('slipTeacherId').value = teacherId;
      document.getElementById('slipMonthSubtitle').innerText = `Official Teacher Compensation & Course Payroll Statement for ${slipData.month}`;
      document.getElementById('slipTeacherName').innerText = slipData.teacher_name;
      document.getElementById('slipTeacherCode').innerText = teacherId.slice(0, 8).toUpperCase();
      document.getElementById('slipJoiningDate').innerText = slipData.joining_date;

      const incBadge = document.getElementById('slipIncrementTierBadge');
      if (incBadge) {
        incBadge.innerText = slipData.seniority_increment > 0 
          ? `+${slipData.seniority_increment} PKR / Student` 
          : 'Base Level (0 PKR)';
      }

      // Render editable students table
      const tbody = document.getElementById('slipStudentsTableBody');
      if (tbody) {
        if (!slipData.assigned_students || slipData.assigned_students.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">No active students currently assigned to this teacher.</td></tr>';
        } else {
          tbody.innerHTML = slipData.assigned_students.map(s => {
            return `
              <tr class="hover:bg-slate-50">
                <td class="p-2.5 font-mono text-slate-400 font-bold">${s.index}</td>
                <td class="p-2.5 font-extrabold text-slate-900">${s.student_name}</td>
                <td class="p-2.5 font-bold text-brandDark">${s.course_label}</td>
                <td class="p-2.5 text-slate-600">${s.schedule_text}</td>
                <td class="p-2.5 font-mono text-slate-500">${s.base_rate} ${s.increment > 0 ? '+ ' + s.increment : ''} PKR</td>
                <td class="p-2.5 text-right">
                  <div class="inline-flex items-center gap-1">
                    <input type="number" class="slip-student-rate w-24 p-1.5 text-right font-mono font-black border border-emerald-400 rounded-lg text-brandDarkest bg-emerald-50/40 focus:bg-white focus:outline-brandEmerald text-xs" 
                      data-student-id="${s.student_id}" 
                      value="${s.final_rate}" 
                      oninput="recalculateSlipNetTotal()">
                    <span class="text-[10px] text-slate-400 font-bold">PKR</span>
                  </div>
                </td>
              </tr>
            `;
          }).join('');
        }
      }

      document.getElementById('slipBonus').value = slipData.bonus || '';
      document.getElementById('slipDeduction').value = slipData.deduction || '';
      document.getElementById('slipRemarks').value = slipData.remarks || '';

      recalculateSlipNetTotal();

      // Update Paid Button
      updateSlipPaidButtonUI(slipData.status === 'Paid');

      openModal('modalSalarySlip');
    }

    function recalculateSlipNetTotal() {
      const rateInputs = document.querySelectorAll('.slip-student-rate');
      let baseSubtotal = 0;
      rateInputs.forEach(inp => {
        baseSubtotal += parseFloat(inp.value) || 0;
      });

      const bonus = parseFloat(document.getElementById('slipBonus')?.value) || 0;
      const deduction = parseFloat(document.getElementById('slipDeduction')?.value) || 0;
      const netPayable = Math.max(0, baseSubtotal + bonus - deduction);

      const baseInp = document.getElementById('slipBaseSubtotal');
      if (baseInp) baseInp.value = baseSubtotal;

      const netEl = document.getElementById('slipNetPayable');
      if (netEl) netEl.innerText = `${netPayable.toLocaleString()} PKR`;

      const countEl = document.getElementById('slipTotalStudentsCount');
      if (countEl) countEl.innerText = `For ${rateInputs.length} Assigned Students (${baseSubtotal.toLocaleString()} Base ${bonus > 0 ? '+ ' + bonus + ' Bonus' : ''} ${deduction > 0 ? '- ' + deduction + ' Deduction' : ''})`;

      return { baseSubtotal, bonus, deduction, netPayable };
    }

    function saveSalarySlipRecord() {
      if (!CURRENT_SLIP_DATA || !CURRENT_SLIP_TEACHER_ID) return;

      const { baseSubtotal, bonus, deduction, netPayable } = recalculateSlipNetTotal();
      const remarks = (document.getElementById('slipRemarks')?.value || '').trim();

      // Collect edited student rates
      const editedStudentRates = {};
      document.querySelectorAll('.slip-student-rate').forEach(inp => {
        const sId = inp.getAttribute('data-student-id');
        editedStudentRates[sId] = parseFloat(inp.value) || 0;
      });

      let savedSalaries = {};
      try {
        savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
      } catch(e) { savedSalaries = {}; }

      const slipKey = CURRENT_SLIP_DATA.slip_key;
      savedSalaries[slipKey] = {
        teacher_id: CURRENT_SLIP_TEACHER_ID,
        month: CURRENT_SLIP_DATA.month,
        students: editedStudentRates,
        base_subtotal: baseSubtotal,
        bonus,
        deduction,
        remarks,
        net_payable: netPayable,
        status: CURRENT_SLIP_DATA.status || 'Pending',
        saved_at: new Date().toISOString()
      };

      localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(savedSalaries));

      calculateMonthlySalaries();
      alert(`✅ Salary Slip Saved Successfully!\n\n👨‍🏫 Teacher: ${CURRENT_SLIP_DATA.teacher_name}\n💵 Base Teaching: ${baseSubtotal.toLocaleString()} PKR\n💰 Net Payable: ${netPayable.toLocaleString()} PKR\n📌 Status: ${savedSalaries[slipKey].status}`);
    }

    function updateSlipPaidButtonUI(isPaid) {
      const btn = document.getElementById('btnSlipMarkPaid');
      const text = document.getElementById('btnSlipMarkPaidText');
      if (!btn || !text) return;

      if (isPaid) {
        btn.className = "px-4 py-2 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 bg-emerald-600 text-white shadow-xs hover:bg-emerald-700";
        text.innerText = "Payment Completed (Paid)";
      } else {
        btn.className = "px-4 py-2 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-800";
        text.innerText = "Mark as Paid";
      }
    }

    function toggleSalaryPaidStatus() {
      if (!CURRENT_SLIP_DATA || !CURRENT_SLIP_TEACHER_ID) return;

      const nextStatus = (CURRENT_SLIP_DATA.status === 'Paid') ? 'Pending' : 'Paid';
      CURRENT_SLIP_DATA.status = nextStatus;

      updateSlipPaidButtonUI(nextStatus === 'Paid');
      saveSalarySlipRecord();
    }

    function quickToggleSalaryPaid(teacherId) {
      const slipData = ALL_TEACHER_SALARIES[teacherId];
      if (!slipData) return;

      let savedSalaries = {};
      try {
        savedSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}');
      } catch(e) { savedSalaries = {}; }

      const slipKey = slipData.slip_key;
      const current = savedSalaries[slipKey] || {};
      const newStatus = (current.status === 'Paid' || slipData.status === 'Paid') ? 'Pending' : 'Paid';

      savedSalaries[slipKey] = {
        ...slipData,
        ...current,
        status: newStatus,
        saved_at: new Date().toISOString()
      };

      localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(savedSalaries));
      calculateMonthlySalaries();
    }

    function sendSalarySlipWhatsApp() {
      if (!CURRENT_SLIP_DATA) return;
      generateAndOpenWhatsAppSlip(CURRENT_SLIP_DATA);
    }

    function quickSendWhatsAppSlip(teacherId) {
      const slipData = ALL_TEACHER_SALARIES[teacherId];
      if (!slipData) return;
      generateAndOpenWhatsAppSlip(slipData);
    }

    function generateAndOpenWhatsAppSlip(slipData) {
      const cleanPhone = (slipData.phone || '').replace(/[^0-9]/g, '');
      if (!cleanPhone) {
        alert("Teacher WhatsApp number is not registered.");
        return;
      }

      // Collect itemized student lines
      const rateInputs = document.querySelectorAll('.slip-student-rate');
      let studentLines = '';

      if (slipData.assigned_students && slipData.assigned_students.length > 0) {
        studentLines = slipData.assigned_students.map((s, idx) => {
          return `${idx + 1}. *${s.student_name}* (${s.course_label}) - ${s.final_rate.toLocaleString()} PKR`;
        }).join('\n');
      } else {
        studentLines = 'No individual students registered this month.';
      }

      const msg = 
`Assalamu Alaikum Respected *${slipData.teacher_name}*,
Al-Huda Islamic Centre - Official Monthly Salary Statement for *${slipData.month}*

Teacher Name: ${slipData.teacher_name}
Joining Date: ${slipData.joining_date}
Seniority Increment: ${slipData.seniority_increment > 0 ? '+' + slipData.seniority_increment + ' PKR / student' : 'Standard Base Rate'}

Assigned Students & Course Breakdown:
${studentLines}

──────────────────
Base Teaching Amount: ${slipData.base_subtotal.toLocaleString()} PKR
${slipData.bonus > 0 ? `Bonus / Allowances: +${slipData.bonus.toLocaleString()} PKR\n` : ''}${slipData.deduction > 0 ? `Deductions / Advances: -${slipData.deduction.toLocaleString()} PKR\n` : ''}${slipData.remarks ? `Remarks: ${slipData.remarks}\n` : ''}Total Net Payable Salary: ${slipData.net_payable.toLocaleString()} PKR
Payment Status: ${slipData.status === 'Paid' ? 'Paid (Disbursed)' : 'Processing (Pending)'}
──────────────────

Jazakum Allahu Khairan!
Al-Huda Islamic Centre Management`;

      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
    }

    function printSalarySlip() {
      const modal = document.getElementById('modalSalarySlip');
      if (!modal) return;
      window.print();
    }

    // ============================================================
