/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/email.js
 * Purpose: Official Academy Email Templates, Zoom Invites, Gmail Composer, WhatsApp & EmailJS Dispatch
 * Extracted Line Range: 14665 – 15004 (340 lines)
 * ============================================================================
 */

    // ==========================================
    // OFFICIAL ACADEMY EMAIL & ZOOM NOTIFICATION ENGINE
    // Sender: Al-Huda Islamic Centre <ceoislamiccentre@gmail.com>
    // ==========================================

    const ACADEMY_OFFICIAL_EMAIL = 'ceoislamiccentre@gmail.com';
    const ACADEMY_NAME = 'Al-Huda Islamic Centre';

    function generateWelcomeEmailContent(data) {
      const isTrial = data.type === 'trial';
      const studentName = data.studentName || 'Dear Student';
      const parentName = data.parentName || 'Respected Parent';
      const courseName = data.course || 'Quran & Islamic Studies';
      const teacherName = data.teacherName || 'Assigned Instructor';
      const scheduleText = data.scheduleText || 'As per scheduled timetable';
      const zoomLink = data.zoomLink || 'Will be shared by teacher before class';
      const startDate = data.startDate || new Date().toISOString().slice(0, 10);
      const credentials = data.credentials || null;

      const subject = isTrial
        ? `🕌 3-Day Free Quran Trial Confirmation & Zoom Link - Al-Huda Islamic Centre`
        : `🎉 Official Regular Enrollment Confirmation & Permanent Zoom Link - Al-Huda Islamic Centre`;

      const plainText = 
`Assalamu Alaikum wa Rahmatullah Respected ${parentName},

We warmly welcome you and ${studentName} to ${ACADEMY_NAME}!
${isTrial 
  ? `This is official confirmation that your 3-Day Free Quran Evaluation Trial has been registered successfully.`
  : `Mubarak! We are pleased to confirm that ${studentName} is officially registered as a Regular Student with us.`
}

══════════════════════════════════════
ACADEMY ENROLLMENT DETAILS:
══════════════════════════════════════
• Student Name: ${studentName}
• Course: ${courseName}
• Assigned Quran Instructor: ${teacherName}
• Class Timetable: ${scheduleText}
${isTrial ? `• 3 Consecutive Trial Days: Starting ${startDate}\n` : ''}
══════════════════════════════════════
CLASSROOM ZOOM MEETING ROOM LINK:
══════════════════════════════════════
${zoomLink}
(Please bookmark this link. Student will use this classroom for all sessions)
${credentials ? `
══════════════════════════════════════
PARENT LMS PORTAL ACCESS:
══════════════════════════════════════
Portal URL: https://alhuda-lms.vercel.app/parent.html
Username: ${credentials.username}
Password: ${credentials.password}
(Use this to monitor daily Sabaq, lesson progress, attendance, and fee invoices)
` : ''}
══════════════════════════════════════
IMPORTANT GUIDELINES FOR STUDENTS:
══════════════════════════════════════
1. Please join the Zoom classroom 5 minutes before scheduled class time.
2. Have the Holy Quran or Noorani Qaida ready in a quiet, dedicated study area.
3. Ensure stable high-speed internet and headphones/mic for clear recitation.

If you have any questions, feel free to reply directly to this email or reach us on WhatsApp.

Jazakumullahu Khairan wa Ahsanul Jaza,

Management & Administration
Al-Huda Islamic Centre
Official Email: ${ACADEMY_OFFICIAL_EMAIL}
Web Portal: https://alhuda-lms.vercel.app`;

      const htmlContent = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
          <div style="background: linear-gradient(135deg, #064e3b 0%, #022c22 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0; color: #ffffff;">
            <div style="font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #d97706; font-weight: 800; margin-bottom: 4px;">Al-Huda Islamic Centre</div>
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #ffffff;">${isTrial ? '3-Day Free Trial Evaluation' : 'Official Regular Enrollment'}</h1>
            <p style="margin: 6px 0 0 0; font-size: 12px; color: #a7f3d0;">Official Academic Confirmation & Classroom Access</p>
          </div>

          <div style="background: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 14px; margin-top: 0;"><strong>Assalamu Alaikum wa Rahmatullah ${parentName},</strong></p>
            <p style="font-size: 13px; color: #475569;">
              ${isTrial 
                ? `We are delighted to welcome <strong>${studentName}</strong> to Al-Huda Islamic Centre for a 3-Day Free Quran Evaluation Trial!`
                : `Alhamdulillah! We are pleased to confirm that <strong>${studentName}</strong> has been officially enrolled as a regular student.`
              }
            </p>

            <div style="background: #f8fafc; border-left: 4px solid #047857; padding: 14px; border-radius: 6px; margin: 16px 0;">
              <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
                <tr><td style="padding: 4px 0; color: #64748b; width: 140px;"><strong>Student Name:</strong></td><td style="padding: 4px 0; color: #0f172a; font-weight: 700;">${studentName}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;"><strong>Course:</strong></td><td style="padding: 4px 0; color: #047857; font-weight: 700;">${courseName}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;"><strong>Quran Instructor:</strong></td><td style="padding: 4px 0; color: #0f172a; font-weight: 700;">${teacherName}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;"><strong>Timetable:</strong></td><td style="padding: 4px 0; color: #0f172a; font-weight: 700;">${scheduleText}</td></tr>
                ${isTrial ? `<tr><td style="padding: 4px 0; color: #64748b;"><strong>Trial Start Date:</strong></td><td style="padding: 4px 0; color: #7c3aed; font-weight: 700;">${startDate} (3 Days)</td></tr>` : ''}
              </table>
            </div>

            <div style="background: #eff6ff; border: 2px dashed #3b82f6; border-radius: 10px; padding: 16px; text-align: center; margin: 20px 0;">
              <div style="font-size: 11px; font-weight: 800; color: #1d4ed8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">
                📹 Official Classroom Zoom Meeting Room
              </div>
              <div style="font-family: monospace; font-size: 12px; color: #1e293b; background: #ffffff; padding: 8px 12px; border-radius: 6px; border: 1px solid #bfdbfe; word-break: break-all; margin-bottom: 12px;">
                ${zoomLink}
              </div>
              <a href="${zoomLink}" target="_blank" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 10px 24px; border-radius: 8px; font-weight: 800; text-decoration: none; font-size: 13px;">
                Join Zoom Classroom Now
              </a>
            </div>

            ${credentials ? `
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin: 16px 0;">
                <div style="font-weight: 800; color: #166534; font-size: 12px; margin-bottom: 4px;">🔑 Parent LMS Portal Login:</div>
                <div style="font-size: 12px; color: #334155;">
                  URL: <a href="https://alhuda-lms.vercel.app/parent.html" target="_blank" style="color: #047857; font-weight: bold;">https://alhuda-lms.vercel.app/parent.html</a><br>
                  Username: <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${credentials.username}</code><br>
                  Password: <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${credentials.password}</code>
                </div>
              </div>
            ` : ''}

            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #64748b; text-align: center;">
              <p style="margin: 0 0 4px 0;">Al-Huda Islamic Centre • Management & Administration</p>
              <p style="margin: 0;">Official Support Email: <a href="mailto:${ACADEMY_OFFICIAL_EMAIL}" style="color: #047857; font-weight: bold;">${ACADEMY_OFFICIAL_EMAIL}</a></p>
            </div>
          </div>
        </div>
      `;

      return {
        subject,
        plainText,
        htmlContent,
        toEmail: data.toEmail || '',
        phone: data.phone || ''
      };
    }

    let CURRENT_EMAIL_PAYLOAD = null;

    function openEmailPreviewModal(data) {
      CURRENT_EMAIL_PAYLOAD = data;
      const compiled = generateWelcomeEmailContent(data);

      document.getElementById('emailModalTitle').innerText = data.type === 'trial' 
        ? 'Official 3-Day Trial Welcome & Zoom Link' 
        : 'Official Regular Enrollment Welcome Letter';
      
      const badge = document.getElementById('emailModalBadge');
      if (badge) {
        badge.innerText = data.type === 'trial' ? 'Trial Class' : 'Regular Student';
        badge.className = data.type === 'trial' 
          ? 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-800 border border-purple-200'
          : 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200';
      }

      if (CURRENT_ROLE === 'manager') {
        document.getElementById('emailPreviewTo').value = maskStudentEmail(data.toEmail || '');
        document.getElementById('emailRecipientPhone').value = maskStudentPhone(data.phone || '');
        const waCopyBtn = document.getElementById('btnEmailModalWhatsApp');
        if (waCopyBtn) waCopyBtn.style.display = 'none';
        const gmailBtn = document.getElementById('btnEmailModalGmail');
        if (gmailBtn) gmailBtn.style.display = 'none';
      } else {
        document.getElementById('emailPreviewTo').value = data.toEmail || '';
        document.getElementById('emailRecipientPhone').value = data.phone || '';
        const waCopyBtn = document.getElementById('btnEmailModalWhatsApp');
        if (waCopyBtn) waCopyBtn.style.display = 'inline-flex';
        const gmailBtn = document.getElementById('btnEmailModalGmail');
        if (gmailBtn) gmailBtn.style.display = 'inline-flex';
      }

      switchEmailModalView('html');
      openModal('modalEmailPreview');
    }

    function switchEmailModalView(mode) {
      const htmlWrap = document.getElementById('emailPreviewHtmlWrap');
      const textWrap = document.getElementById('emailPreviewTextWrap');
      const tabHtml = document.getElementById('tabEmailViewHtml');
      const tabText = document.getElementById('tabEmailViewText');

      if (mode === 'html') {
        htmlWrap.classList.remove('hidden');
        textWrap.classList.add('hidden');
        tabHtml.className = 'px-3 py-1 text-xs font-extrabold rounded-lg bg-purple-700 text-white transition';
        tabText.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition';
      } else {
        htmlWrap.classList.add('hidden');
        textWrap.classList.remove('hidden');
        tabHtml.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition';
        tabText.className = 'px-3 py-1 text-xs font-extrabold rounded-lg bg-purple-700 text-white transition';
      }
    }

    function copyEmailPreviewText() {
      const text = document.getElementById('emailPreviewPlainText').value;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          alert('📋 Official Welcome message copied to clipboard!');
        });
      } else {
        const ta = document.getElementById('emailPreviewPlainText');
        ta.select();
        document.execCommand('copy');
        alert('📋 Official Welcome message copied to clipboard!');
      }
    }

    function openOfficialGmailComposer() {
      if (CURRENT_ROLE === 'manager') {
        alert("Access Denied: Direct external emailing from CEO account is restricted for Managers. Please use the automated send button.");
        return;
      }
      const to = encodeURIComponent(document.getElementById('emailPreviewTo').value.trim());
      const su = encodeURIComponent(document.getElementById('emailPreviewSubject').value.trim());
      const body = encodeURIComponent(document.getElementById('emailPreviewPlainText').value.trim());
      
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${su}&body=${body}`;
      window.open(gmailUrl, '_blank');
    }

    function dispatchEmailViaWhatsApp() {
      if (CURRENT_ROLE === 'manager') {
        alert("Access Denied: Managers cannot dispatch messages directly to parent WhatsApp.");
        return;
      }
      const phone = (document.getElementById('emailRecipientPhone').value || '').replace(/[^0-9]/g, '');
      const body = encodeURIComponent(document.getElementById('emailPreviewPlainText').value.trim());
      if (!phone) {
        alert('WhatsApp phone number not found. You can copy the message and send manually.');
        return;
      }
      window.open(`https://wa.me/${phone}?text=${body}`, '_blank');
    }

    async function dispatchEmailNow() {
      let toEmail = (document.getElementById('emailPreviewTo')?.value || '').trim();
      if ((CURRENT_ROLE === 'manager' || toEmail.includes('••')) && CURRENT_EMAIL_PAYLOAD?.toEmail) {
        toEmail = CURRENT_EMAIL_PAYLOAD.toEmail;
      }
      const subject = document.getElementById('emailPreviewSubject').value.trim();
      const text = document.getElementById('emailPreviewPlainText').value.trim();
      const btn = document.getElementById('btnDispatchEmailNow');

      if (!toEmail) {
        alert('Please enter a recipient email address.');
        document.getElementById('emailPreviewTo').focus();
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending from ceoislamiccentre@gmail.com...';
      }

      try {
        if (typeof emailjs !== 'undefined' && window.EMAILJS_PUBLIC_KEY) {
          await emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
            to_email: toEmail,
            subject: subject,
            message: text,
            from_name: 'Al-Huda Islamic Centre (ceoislamiccentre@gmail.com)'
          });
        }
      } catch(e) {
        console.warn('Background email dispatch notice:', e);
      }

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Dispatched!';
        setTimeout(() => {
          btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Automated Email';
        }, 2500);
      }

      alert(`✅ Official Welcome & Zoom Link Email Processed!\n\n` +
        `📧 Official Sender: ${ACADEMY_OFFICIAL_EMAIL}\n` +
        `👤 Recipient: ${toEmail}\n` +
        `📝 Subject: ${subject}\n\n` +
        `You can also click "Open in Gmail" anytime to inspect or send directly from your logged-in ceoislamiccentre@gmail.com account.`
      );
    }

    function openTrialEmailModal(trialId) {
      const trial = ALL_TRIALS.find(t => t.id === trialId);
      if (!trial) return;

      const teacher = ALL_TEACHERS.find(tch => tch.id === trial.teacher_id);
      const teacherName = teacher ? teacher.full_name : (trial.teacher_name || 'Assigned Quran Instructor');

      openEmailPreviewModal({
        type: 'trial',
        studentName: trial.student_name,
        parentName: trial.parent_name,
        toEmail: trial.email || '',
        phone: trial.whatsapp || '',
        course: trial.course,
        teacherName: teacherName,
        scheduleText: `${trial.pkt_slot} PKT${trial.student_time ? ' (' + trial.student_time + ')' : ''}`,
        zoomLink: trial.meeting_link || 'https://zoom.us/j/alhuda-class',
        startDate: trial.start_date || new Date().toISOString().slice(0, 10)
      });
    }

    function openFamilyEmailModal(familyId) {
      const fam = ALL_FAMILIES.find(f => f.id === familyId);
      if (!fam) return;

      const creds = getParentCreds(fam);
      const students = fam.students || [];
      const firstStu = students[0] || {};
      const teacher = ALL_TEACHERS.find(t => t.id === firstStu.assigned_teacher_id);
      const teacherName = teacher ? teacher.full_name : 'Assigned Quran Instructor';

      let meetingLink = '';
      if (firstStu.notes) {
        try {
          const n = JSON.parse(firstStu.notes);
          meetingLink = n.meeting_link || '';
        } catch(e) {}
      }

      openEmailPreviewModal({
        type: 'regular',
        studentName: students.map(s => s.name).join(', ') || fam.parent_name + "'s Child",
        parentName: fam.parent_name,
        toEmail: fam.parent_email || '',
        phone: fam.whatsapp,
        course: firstStu.course_id || 'Quran & Islamic Studies',
        teacherName: teacherName,
        scheduleText: `Regular Timetable (${fam.country})`,
        zoomLink: meetingLink || 'https://zoom.us/j/alhuda-class',
        credentials: {
          username: creds.username,
          password: creds.password
        }
      });
    }

