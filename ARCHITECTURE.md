# 🏗️ Al-Huda Islamic Centre LMS — Modular Architecture Guide

This document provides a quick reference for developers and AI tools working on the **Al-Huda Islamic Centre LMS**.

---

## 📁 Directory & File Structure

```
Project LMS/
├── index.html              # Unified Owner & Manager Portal Shell (HTML + 26 Modals only, ~4,888 lines)
├── teacher.html            # Dedicated Teacher Portal (Schedule, Attendance, Time Change Requests)
├── manager.html            # Instant Redirect Shim to index.html?role=manager
├── parent.html             # Dedicated Parent & Student Portal
├── curriculum_data.js      # Digital Islamic Library & Course Book Registry
├── style.css               # Shared Stylesheet
└── js/                     # Modular JavaScript Engine (15 Feature Files)
    ├── config.js           # 1. Supabase init, global state variables, role privacy masking & boot sequence
    ├── utils.js            # 2. Shared modal helpers (openModal/closeModal), cache guard & realtime sync
    ├── navigation.js       # 3. SPA navigation history, hardware back button engine & sidebar controller
    ├── auth.js             # 4. Role-Based Access Control (Owner/Manager/Teacher) & login session management
    ├── curriculum.js       # 5. Digital book catalog, full-screen reader, interactive whiteboard & WebP upload
    ├── dashboard.js        # 6. Executive KPI dashboard, Chart.js analytics & live today's schedule monitor
    ├── families.js         # 7. Family & student CRUD, country/currency registry & directory views
    ├── teachers.js         # 8. Teacher & staff CRUD, dedicated Zoom classroom auto-cascade & credentials
    ├── schedule.js         # 9. 2D weekly schedule matrix, slot booking & daily attendance logging
    ├── payroll.js          # 10. Course-based auto payroll calculation, seniority increments & salary slips
    ├── fees.js             # 11. Native fee engine, cloud billing sync, smart arrears, PDF invoices & 12-month matrix
    ├── trials.js           # 12. 3-day trial classes pipeline, conversion scorecard & regular student promotion
    ├── email.js            # 13. Official academy email templates, Gmail composer, WhatsApp & EmailJS dispatch
    ├── leaves.js           # 14. Extended student leave engine, return alerts & teacher time-change approvals
    └── search.js           # 15. Multi-filter teacher schedule slot finder & custom floating dropdowns
```

---

## 🔎 Quick Lookup Guide (Where to Edit Any Feature)

| Feature / Task | Target File | Key Functions |
|---|---|---|
| **Supabase Connection / Global Variables** | `js/config.js` | `db`, `ALL_TEACHERS`, `ALL_STUDENTS`, `ALL_FAMILIES`, `window.onload` |
| **Student Contact Privacy Masking** | `js/config.js` | `maskStudentPhone()`, `maskStudentEmail()` |
| **Sidebar / Tab Switching / Back Button** | `js/navigation.js` | `switchTab()`, `navigateAppBack()`, `toggleSidebar()` |
| **Role Permissions (Owner vs Manager)** | `js/auth.js` | `switchUserRole()`, `initRoleFromUrl()`, `updateRoleHeaderBadge()` |
| **Digital Book Reader & Whiteboard** | `js/curriculum.js` | `openDigitalBookReader()`, `setTeachingTool()`, `handleSaveCustomBook()` |
| **Dashboard KPIs & Live Classes Table** | `js/dashboard.js` | `loadDashboardData()`, `renderDashboardClassesTable()`, `initDashboardCharts()` |
| **Add/Edit Family or Student** | `js/families.js` | `handleSaveFamily()`, `handleSaveStudent()`, `loadFamiliesAndStudents()` |
| **Add/Edit Teacher, Manager, or Zoom** | `js/teachers.js` | `loadTeachers()`, `handleSaveTeacher()`, `syncTeacherZoomToAllStudents()` |
| **Weekly 2D Timetable & Slot Booking** | `js/schedule.js` | `open2DMatrixForTeacher()`, `render2DMatrixTable()`, `handleConfirmSlotBooking()` |
| **Daily Attendance Marking** | `js/schedule.js` | `loadAttendanceList()`, `saveAttendance()`, `requestTimeChangeFromIndex()` |
| **Teacher Salaries & Slips** | `js/payroll.js` | `calculateMonthlySalaries()`, `openSalarySlipModal()`, `sendSalarySlipWhatsApp()` |
| **Tuition Fee Collection & Invoices** | `js/fees.js` | `loadFeeBillingLedger()`, `openFeeInvoiceModal()`, `loadMasterAnnualMatrix()` |
| **3-Day Trial Classes & Conversion** | `js/trials.js` | `loadTrialClassesData()`, `handleSaveTrialClass()`, `handleConvertTrialSubmit()` |
| **Welcome Emails & WhatsApp Dispatch** | `js/email.js` | `openEmailPreviewModal()`, `dispatchEmailNow()`, `openOfficialGmailComposer()` |
| **Student Leaves & Time Change Approvals** | `js/leaves.js` | `checkLeaveReturnAlertsAndRequests()`, `handleApproveTeacherRequest()` |
| **Find Free Teacher Slots** | `js/search.js` | `executeScheduleSearch()`, `quickAssignFromSearch()` |
| **Modal Popups (`openModal`/`closeModal`)** | `js/utils.js` | `openModal()`, `closeModal()` |
| **HTML Layout / Modal Markup** | `index.html` | Lines 1–4860 |
