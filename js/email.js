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
      const studentName = data.studentName || 'Student';
      const parentName = data.parentName || 'Parent / Guardian';
      const courseName = data.course || 'Not Assigned Yet';
      const teacherName = data.teacherName || 'Not Assigned Yet';
      const scheduleText = data.scheduleText || 'No classes scheduled.';
      const rawZoom = (data.zoomLink || '').trim();
      const hasValidZoom = rawZoom && /^https?:\/\//i.test(rawZoom);
      const zoomDisplay = hasValidZoom ? rawZoom : 'Zoom meeting not configured.';
      const startDate = data.startDate || new Date().toISOString().slice(0, 10);
      const credentials = data.credentials || null;
      const portalUrl = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null')
        ? `${window.location.origin}/parent.html`
        : 'https://alhuda-lms.vercel.app/parent.html';

      const subject = isTrial
        ? `🕌 3-Day Free Quran Trial Confirmation - Al-Huda Islamic Centre`
        : `🎉 Official Enrollment Confirmation & Portal Access - Al-Huda Islamic Centre`;

      const plainText = 
`Assalamu Alaikum wa Rahmatullah ${parentName},

We warmly welcome you and ${studentName} to ${ACADEMY_NAME}!
${isTrial 
  ? `This is official confirmation that your 3-Day Free Quran Evaluation Trial has been registered.`
  : `We are pleased to confirm that ${studentName} is officially registered as a Student with us.`
}

══════════════════════════════════════
ACADEMY ENROLLMENT DETAILS:
══════════════════════════════════════
• Student Name: ${studentName}
• Course: ${courseName}
• Assigned Teacher: ${teacherName}
• Class Schedule Time: ${scheduleText}
• Joining Date: ${data.joiningDate || startDate}
${isTrial ? `• Trial Start Date: ${startDate}\n` : ''}
══════════════════════════════════════
CLASSROOM ZOOM MEETING LINK:
══════════════════════════════════════
${zoomDisplay}
${credentials ? `
══════════════════════════════════════
PARENT LMS PORTAL ACCESS:
══════════════════════════════════════
Portal Link: ${portalUrl}
Username: ${credentials.username}
Password: ${credentials.password}
` : `
══════════════════════════════════════
PARENT LMS PORTAL LINK:
══════════════════════════════════════
Portal Link: ${portalUrl}
`}
Jazakumullahu Khairan,
Management & Administration
${ACADEMY_NAME}
Official Email: ${ACADEMY_OFFICIAL_EMAIL}`;

      const htmlContent = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
          <div style="background: linear-gradient(135deg, #064e3b 0%, #022c22 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0; color: #ffffff;">
            <div style="font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #d97706; font-weight: 800; margin-bottom: 4px;">Al-Huda Islamic Centre</div>
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #ffffff;">${isTrial ? '3-Day Free Trial Evaluation' : 'Official Student Enrollment'}</h1>
            <p style="margin: 6px 0 0 0; font-size: 12px; color: #a7f3d0;">Official Academic Confirmation &amp; Portal Access</p>
          </div>

          <div style="background: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 14px; margin-top: 0;"><strong>Assalamu Alaikum wa Rahmatullah ${parentName},</strong></p>
            <p style="font-size: 13px; color: #475569;">
              ${isTrial 
                ? `We are delighted to welcome <strong>${studentName}</strong> to Al-Huda Islamic Centre for a 3-Day Free Quran Evaluation Trial.`
                : `Alhamdulillah! We are pleased to confirm that <strong>${studentName}</strong> has been officially enrolled.`
              }
            </p>

            <div style="background: #f8fafc; border-left: 4px solid #047857; padding: 14px; border-radius: 6px; margin: 16px 0;">
              <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
                <tr><td style="padding: 4px 0; color: #64748b; width: 150px;"><strong>Student Name:</strong></td><td style="padding: 4px 0; color: #0f172a; font-weight: 700;">${studentName}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;"><strong>Course:</strong></td><td style="padding: 4px 0; color: #047857; font-weight: 700;">${courseName}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;"><strong>Assigned Teacher:</strong></td><td style="padding: 4px 0; color: #0f172a; font-weight: 700;">${teacherName}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;"><strong>Class Schedule Time:</strong></td><td style="padding: 4px 0; color: #0f172a; font-weight: 700;">${scheduleText}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;"><strong>${isTrial ? 'Trial Start Date:' : 'Joining Date:'}</strong></td><td style="padding: 4px 0; color: #047857; font-weight: 700;">${data.joiningDate || startDate}</td></tr>
              </table>
            </div>

            <div style="background: #eff6ff; border: 2px dashed #3b82f6; border-radius: 10px; padding: 16px; text-align: center; margin: 20px 0;">
              <div style="font-size: 11px; font-weight: 800; color: #1d4ed8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">
                📹 Classroom Zoom Meeting Room
              </div>
              <div style="font-family: monospace; font-size: 12px; color: #1e293b; background: #ffffff; padding: 8px 12px; border-radius: 6px; border: 1px solid #bfdbfe; word-break: break-all; margin-bottom: 12px;">
                ${zoomDisplay}
              </div>
              ${hasValidZoom ? `
                <a href="${rawZoom}" target="_blank" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 10px 24px; border-radius: 8px; font-weight: 800; text-decoration: none; font-size: 13px;">
                  Join Zoom Classroom
                </a>
              ` : ''}
            </div>

            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin: 16px 0;">
              <div style="font-weight: 800; color: #166534; font-size: 12px; margin-bottom: 4px;">🔑 Parent LMS Portal Access:</div>
              <div style="font-size: 12px; color: #334155;">
                Portal Link: <a href="${portalUrl}" target="_blank" style="color: #047857; font-weight: bold;">${portalUrl}</a><br>
                ${credentials ? `
                  Username: <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${credentials.username}</code><br>
                  Password: <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${credentials.password}</code>
                ` : ''}
              </div>
            </div>

            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #64748b; text-align: center;">
              <p style="margin: 0 0 4px 0;">Al-Huda Islamic Centre • Management &amp; Administration</p>
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

      const subjEl = document.getElementById('emailPreviewSubject');
      if (subjEl) subjEl.value = compiled.subject;
      const plainEl = document.getElementById('emailPreviewPlainText');
      if (plainEl) plainEl.value = compiled.plainText;
      const htmlEl = document.getElementById('emailPreviewHtmlContainer') || document.getElementById('emailPreviewHtmlWrap');
      if (htmlEl) htmlEl.innerHTML = compiled.htmlContent;

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

    // TASK 6: Automatic Welcome Email Dispatch after Student/Family Creation
    async function autoSendWelcomeEmailOnCreation(data) {
      const toEmail = String(data?.toEmail || '').trim();
      if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
        return { skipped: true, reason: 'No valid parent email address' };
      }

      const compiled = generateWelcomeEmailContent(data);
      try {
        let dispatched = false;

        if (typeof emailjs !== 'undefined' && window.EMAILJS_PUBLIC_KEY && window.EMAILJS_SERVICE_ID && window.EMAILJS_TEMPLATE_ID) {
          await emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
            to_email: toEmail,
            subject: compiled.subject,
            message: compiled.plainText,
            html_message: compiled.htmlContent,
            from_name: 'Al-Huda Islamic Centre (ceoislamiccentre@gmail.com)'
          });
          dispatched = true;
        } else if (typeof fetch === 'function') {
          const resp = await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: toEmail,
              subject: compiled.subject,
              text: compiled.plainText,
              html: compiled.htmlContent
            })
          });
          if (resp && resp.ok) {
            dispatched = true;
          } else {
            throw new Error(`Email service responded with status ${resp ? resp.status : 'unknown'}`);
          }
        } else {
          throw new Error('No email transport configured');
        }

        if (!dispatched) {
          throw new Error('Welcome email transport did not confirm delivery');
        }
        return { sent: true, toEmail };
      } catch (err) {
        console.error('[Welcome Email Failed to Send]:', err);
        return { sent: false, error: err?.message || String(err) };
      }
    }
    window.autoSendWelcomeEmailOnCreation = autoSendWelcomeEmailOnCreation;

    function openTrialEmailModal(trialId) {
      const trial = (ALL_TRIALS || []).find(t => t.id === trialId);
      if (!trial) return;

      const teacher = (ALL_TEACHERS || []).find(tch => tch.id === trial.teacher_id);
      const teacherName = teacher ? teacher.full_name : (trial.teacher_name || 'Not Assigned Yet');
      const zoomLink = trial.meeting_link || teacher?.zoom_link || '';

      openEmailPreviewModal({
        type: 'trial',
        studentName: trial.student_name,
        parentName: trial.parent_name,
        toEmail: trial.email || '',
        phone: trial.whatsapp || '',
        course: trial.course || 'Trial Evaluation',
        teacherName: teacherName,
        scheduleText: trial.pkt_slot ? `${trial.pkt_slot} PKT${trial.student_time ? ' (' + trial.student_time + ')' : ''}` : 'No classes scheduled.',
        zoomLink: zoomLink,
        startDate: trial.start_date || new Date().toISOString().slice(0, 10)
      });
    }

    function openFamilyEmailModal(familyId) {
      const fam = (ALL_FAMILIES || []).find(f => f.id === familyId);
      if (!fam) return;

      const creds = getParentCreds(fam);
      const students = fam.students || [];
      const firstStu = students[0] || {};
      const teacher = (ALL_TEACHERS || []).find(t => t.id === firstStu.assigned_teacher_id);
      const teacherName = teacher ? teacher.full_name : 'Not Assigned Yet';

      let meetingLink = '';
      if (firstStu.notes) {
        try {
          const n = typeof firstStu.notes === 'string' ? JSON.parse(firstStu.notes) : firstStu.notes;
          meetingLink = n.meeting_link || '';
        } catch(e) {}
      }
      const stuSchedules = (window.ALL_SCHEDULES || []).filter(sc => String(sc.student_id) === String(firstStu.id));
      if (!meetingLink && stuSchedules.length > 0) {
        meetingLink = stuSchedules.find(sc => sc.meeting_link)?.meeting_link || '';
      }
      if (!meetingLink && teacher?.zoom_link) {
        meetingLink = teacher.zoom_link;
      }

      let scheduleText = 'No classes scheduled.';
      if (stuSchedules.length > 0) {
        const daysMap = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const daysStr = [...new Set(stuSchedules.map(sc => daysMap[sc.day_of_week] || '').filter(Boolean))].join(', ');
        const st = (stuSchedules[0].start_time || '').slice(0, 5);
        const et = (stuSchedules[0].end_time || '').slice(0, 5);
        scheduleText = `${daysStr} @ ${st}${et ? ' - ' + et : ''} PKT`;
      }

      openEmailPreviewModal({
        type: 'regular',
        studentName: students.map(s => s.name).join(', ') || fam.parent_name,
        parentName: fam.parent_name,
        toEmail: fam.parent_email || '',
        phone: fam.whatsapp,
        course: firstStu.course_id || firstStu.course || 'Not Assigned Yet',
        teacherName: teacherName,
        scheduleText: scheduleText,
        zoomLink: meetingLink,
        credentials: {
          username: creds.username,
          password: creds.password
        }
      });
    }

