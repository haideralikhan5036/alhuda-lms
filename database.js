// Beacon Quran Institute LMS - Permanent Database Engine with Real-Time Persistence
// Ensures all added Students, Families, Teachers, Invoices, Requests, Tasks, Announcements, and Sabaq History stay 100% permanently saved across refreshes.

const DEFAULT_PARENTS = [
    { 
        id: 1, 
        name: "Demo Parent Alpha", 
        email: "parent.alpha@example.com", 
        phone: "+44 7000 000001", 
        country: "United Kingdom 🇬🇧", 
        timezone: "BST (UTC+1)", 
        localTime: "07:30 PM", 
        fee: "60", 
        currency: "GBP", 
        status: "Active",
        notes: [
            { date: "2026-08-10", author: "Super Admin", note: "Family requested 15-min earlier slot for next month." }
        ],
        comments: [
            { date: "2026-08-12 04:30 PM", author: "Manager", text: "Spoke with father on WhatsApp. All classes running smoothly." }
        ],
        invoices: [
            { month: "August 2026", due: "05-Aug-2026", paid: "04-Aug-2026", fee: "60", adj: "0", total: "60", status: "Paid" },
            { month: "July 2026", due: "05-Jul-2026", paid: "05-Jul-2026", fee: "60", adj: "0", total: "60", status: "Paid" }
        ]
    },
    { 
        id: 2, 
        name: "Demo Parent Beta", 
        email: "parent.beta@example.com", 
        phone: "+1 555 0102", 
        country: "United States 🇺🇸", 
        timezone: "EST (UTC-5)", 
        localTime: "02:30 PM", 
        fee: "50", 
        currency: "USD", 
        status: "Active",
        notes: [],
        comments: [],
        invoices: [
            { month: "August 2026", due: "10-Aug-2026", paid: "-", fee: "50", adj: "0", total: "50", status: "Pending" }
        ]
    },
    { 
        id: 3, 
        name: "Demo Parent Gamma", 
        email: "parent.gamma@example.com", 
        phone: "+1 555 0103", 
        country: "Canada 🇨🇦", 
        timezone: "EST (UTC-5)", 
        localTime: "02:30 PM", 
        fee: "70", 
        currency: "CAD", 
        status: "Active",
        notes: [],
        comments: [],
        invoices: [
            { month: "August 2026", due: "01-Aug-2026", paid: "01-Aug-2026", fee: "70", adj: "0", total: "70", status: "Paid" }
        ]
    }
];

const DEFAULT_TEACHERS = [
    { id: 1, name: "Demo Teacher 1", gender: "Male", email: "teacher1@bqi.example", phone: "+92 300 0000001", specialization: "Tajweed & Qaida", language: "English, Urdu, Arabic", country: "Pakistan 🇵🇰", timezone: "PKT (UTC+5)", city: "Lahore", qualification: "Hafiz & Shahadat-ul-Almiya", username: "beacon_teacher", status: "Active" },
    { id: 2, name: "Demo Teacher 2", gender: "Female", email: "teacher2@bqi.example", phone: "+92 300 0000002", specialization: "Quran Hifz", language: "English, Urdu", country: "Pakistan 🇵🇰", timezone: "PKT (UTC+5)", city: "Karachi", qualification: "Hafiza & Tajweed Ijazah", username: "teacher_female", status: "Active" },
    { id: 3, name: "Demo Teacher 3", gender: "Male", email: "teacher3@bqi.example", phone: "+92 300 0000003", specialization: "Arabic Language & Recitation", language: "Arabic, English", country: "Pakistan 🇵🇰", timezone: "PKT (UTC+5)", city: "Islamabad", qualification: "Al-Azhar Certified Qari", username: "teacher_qari", status: "Active" }
];

const DEFAULT_STUDENTS = [
    {
        id: 101,
        name: "Demo Student Alpha",
        gender: "Male",
        age: 10,
        country: "United Kingdom 🇬🇧",
        language: "English",
        timezone: "BST (UTC+1)",
        course: "Qaida Nooraniya",
        familyId: 1,
        familyName: "Demo Parent Alpha",
        teacherId: 1,
        teacherName: "Demo Teacher 1",
        days: "Mon, Tue, Wed, Thu, Fri",
        timeSlot: "12:00 AM - 12:30 AM",
        studentLocalTime: "08:00 PM - 08:30 PM",
        teacherLocalTime: "12:00 AM - 12:30 AM",
        fee: "30",
        currency: "GBP",
        status: "Active",
        testStatus: "Passed Lesson 1 (Grade: A)",
        certificateUrl: "cert_101.pdf",
        roomId: 101,
        sabaqHistory: [
            { date: "2026-08-19", lesson: "Noorani Qaida - Lesson #3 (Harakat)", surahAyah: "Fatha / Kasra / Damma exercises", grade: "A+", remarks: "Excellent pronunciation of heavy letters (Kh, Swaad, Twaa)." },
            { date: "2026-08-18", lesson: "Noorani Qaida - Lesson #2 (Compound Letters)", surahAyah: "Page 4, Lines 1-6", grade: "A", remarks: "Good recognition of connected letters (Laam-Alif, Baa-Alif)." },
            { date: "2026-08-17", lesson: "Noorani Qaida - Lesson #1 (Individual Letters)", surahAyah: "Haroof-e-Mufredat Complete", grade: "A+", remarks: "Mastered all 29 individual letters." }
        ]
    },
    {
        id: 102,
        name: "Demo Student Beta",
        gender: "Female",
        age: 12,
        country: "United States 🇺🇸",
        language: "English",
        timezone: "EST (UTC-5)",
        course: "The Holy Quran (Nazra)",
        familyId: 2,
        familyName: "Demo Parent Beta",
        teacherId: 2,
        teacherName: "Demo Teacher 2",
        days: "Mon, Wed, Fri",
        timeSlot: "02:00 PM - 02:30 PM",
        studentLocalTime: "05:00 AM - 05:30 AM",
        teacherLocalTime: "02:00 PM - 02:30 PM",
        fee: "50",
        currency: "USD",
        status: "Trial",
        testStatus: "Evaluation Scheduled",
        certificateUrl: "",
        roomId: 102,
        sabaqHistory: [
            { date: "2026-08-19", lesson: "Surah Al-Fatiha Evaluation", surahAyah: "Verses 1-7", grade: "Evaluation", remarks: "Trial evaluation class. Needs Tajweed practice on Makharij of Haa and Ayn." }
        ]
    },
    {
        id: 103,
        name: "Demo Student Gamma",
        gender: "Male",
        age: 8,
        country: "Canada 🇨🇦",
        language: "English, French",
        timezone: "EST (UTC-5)",
        course: "Quran Memorization (Hifz)",
        familyId: 3,
        familyName: "Demo Parent Gamma",
        teacherId: 3,
        teacherName: "Demo Teacher 3",
        days: "Sat, Sun",
        timeSlot: "01:00 AM - 01:30 AM",
        studentLocalTime: "04:00 PM - 04:30 PM",
        teacherLocalTime: "01:00 AM - 01:30 AM",
        fee: "35",
        currency: "CAD",
        status: "Leave",
        testStatus: "Juz 30 Complete (Grade: A+)",
        certificateUrl: "cert_103.pdf",
        roomId: 103,
        sabaqHistory: [
            { date: "2026-08-15", lesson: "Surah An-Naba Memorization", surahAyah: "Ayah 1-20", grade: "A+", remarks: "Strong memorization with solid retention." }
        ]
    },
    {
        id: 104,
        name: "Demo Student Delta",
        gender: "Female",
        age: 14,
        country: "United Kingdom 🇬🇧",
        language: "English",
        timezone: "BST (UTC+1)",
        course: "Tajweed Rules",
        familyId: 1,
        familyName: "Demo Parent Alpha",
        teacherId: 1,
        teacherName: "Demo Teacher 1",
        days: "Mon, Tue, Wed, Thu",
        timeSlot: "12:30 AM - 01:00 AM",
        studentLocalTime: "08:30 PM - 09:00 PM",
        teacherLocalTime: "12:30 AM - 01:00 AM",
        fee: "30",
        currency: "GBP",
        status: "Active",
        testStatus: "Tajweed Intermediate (Passed)",
        certificateUrl: "cert_104.pdf",
        roomId: 104,
        sabaqHistory: [
            { date: "2026-08-19", lesson: "Rules of Noon Sakinah & Tanween", surahAyah: "Idghaam with Ghunnah examples", grade: "A", remarks: "Well understood. Practice applied in Surah Al-Mulk." }
        ]
    }
];

const DEFAULT_USERS = [
    { id: 1, username: "beacon_admin", name: "Haider (Owner)", role: "super_admin", password: "admin_bqi_123" },
    { id: 2, username: "beacon_manager", name: "Manager Operations", role: "manager", password: "manager_bqi_123" },
    { id: 3, username: "beacon_rec_manager", name: "Recording Auditor", role: "recording_manager", password: "rec_bqi_123" },
    { id: 4, username: "beacon_teacher", name: "Demo Teacher 1", role: "teacher", password: "teacher_bqi_123" },
    { id: 5, username: "beacon_student", name: "Demo Student 1", role: "parent", password: "student_bqi_123" }
];

const DEFAULT_CLASSES = [
    {
        id: 101,
        studentId: 101,
        studentName: "Demo Student Alpha",
        studentCountry: "United Kingdom 🇬🇧",
        teacherId: 1,
        teacherName: "Demo Teacher 1",
        type: "regular",
        status: "taken",
        date: "2026-08-20",
        time: "12:00 AM - 12:30 AM",
        adminTime: "12:00 AM",
        teacherTime: "12:00 AM PKT",
        studentTime: "08:00 PM BST",
        onlineTime: "30 Mins",
        recordingUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
        isFlagged: false,
        flagNotes: "",
        lessonNotes: "Completed Lesson #3 Noorani Qaida (Harakat)."
    },
    {
        id: 102,
        studentId: 102,
        studentName: "Demo Student Beta",
        studentCountry: "United States 🇺🇸",
        teacherId: 2,
        teacherName: "Demo Teacher 2",
        type: "trial",
        status: "trial",
        date: "2026-08-20",
        time: "02:00 PM - 02:30 PM",
        adminTime: "02:00 PM",
        teacherTime: "02:00 PM PKT",
        studentTime: "05:00 AM EST",
        onlineTime: "30 Mins",
        recordingUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
        isFlagged: true,
        flagNotes: "Auditor Note: Tajweed check required around minute 10.",
        lessonNotes: "First Trial Evaluation Class."
    },
    {
        id: 103,
        studentId: 103,
        studentName: "Demo Student Gamma",
        studentCountry: "Canada 🇨🇦",
        teacherId: 3,
        teacherName: "Demo Teacher 3",
        type: "regular",
        status: "leave",
        date: "2026-08-20",
        time: "01:00 AM - 01:30 AM",
        adminTime: "01:00 AM",
        teacherTime: "01:00 AM PKT",
        studentTime: "04:00 PM EST",
        onlineTime: "0 Mins",
        recordingUrl: "",
        isFlagged: false,
        flagNotes: "",
        lessonNotes: "On-Leave for Summer Vacation."
    },
    {
        id: 104,
        studentId: 104,
        studentName: "Demo Student Delta",
        studentCountry: "United Kingdom 🇬🇧",
        teacherId: 1,
        teacherName: "Demo Teacher 1",
        type: "regular",
        status: "pending",
        date: "2026-08-20",
        time: "12:30 AM - 01:00 AM",
        adminTime: "12:30 AM",
        teacherTime: "12:30 AM PKT",
        studentTime: "08:30 PM BST",
        onlineTime: "30 Mins",
        recordingUrl: "",
        isFlagged: false,
        flagNotes: "",
        lessonNotes: "Rules of Noon Sakinah & Tanween."
    }
];

const DEFAULT_REQUESTS = [
    {
        id: 1,
        name: "Ahmad Farooq (Father)",
        studentName: "Ibrahim Ahmad",
        email: "ahmad.farooq@example.com",
        phone: "+1 647 555 0188",
        country: "Canada 🇨🇦",
        timezone: "EST (UTC-5)",
        preferredSlot: "06:00 PM EST",
        courseRequested: "Qaida Nooraniya & Tajweed",
        notes: "Interested in 3 trial classes for 7-year-old son.",
        dateReceived: "2026-08-19",
        status: "Pending"
    },
    {
        id: 2,
        name: "Fatima Al-Mansoor",
        studentName: "Maryam & Zayd",
        email: "fatima.mansoor@example.com",
        phone: "+971 50 123 4567",
        country: "United Arab Emirates 🇦🇪",
        timezone: "GST (UTC+4)",
        preferredSlot: "04:30 PM GST",
        courseRequested: "Quran Memorization (Hifz)",
        notes: "Looking for female teacher for daughter and male teacher for son.",
        dateReceived: "2026-08-18",
        status: "Contacted"
    }
];

const DEFAULT_TASKS = [
    { id: 1, title: "Review Teacher Evaluation for Qari Bilal", assignee: "Manager Operations", priority: "High", dueDate: "2026-08-22", status: "Pending" },
    { id: 2, title: "Send August Monthly Invoices to UK Families", assignee: "Super Admin", priority: "Urgent", dueDate: "2026-08-21", status: "In-Progress" },
    { id: 3, title: "Auditor check for 3 Flagged Recordings", assignee: "Recording Auditor", priority: "Medium", dueDate: "2026-08-23", status: "Pending" }
];

const DEFAULT_ANNOUNCEMENTS = [
    { id: 1, title: "Special Tajweed Workshop for Teachers", date: "2026-08-25", target: "All Teachers", content: "Mandatory 1-hour workshop on advanced Makharij and recitation rules this Saturday at 03:00 PM PKT." },
    { id: 2, title: "Upcoming Islamic Holiday Schedule Notice", date: "2026-08-20", target: "All Staff & Families", content: "Please note holiday schedule adjustments for the upcoming public holiday. Makeup classes will be scheduled in advance." }
];

const DEFAULT_COURSES = [
    { id: 1, code: "QAI-101", title: "Qaida Nooraniya (Beginner)", duration: "3-6 Months", lessons: "17 Lessons", description: "Foundational Arabic alphabet, Makharij, compound letters, and Harakat pronunciation." },
    { id: 2, code: "NAZ-201", title: "The Holy Quran (Nazra Recitation)", duration: "6-12 Months", lessons: "30 Juz", description: "Fluent Quranic recitation with continuous application of fundamental Tajweed rules." },
    { id: 3, code: "HIF-301", title: "Quran Memorization (Hifz-ul-Quran)", duration: "2-3 Years", lessons: "30 Juz / Manzil", description: "Systematic memorization (Sabaq, Sabaqi, Manzil) with daily revision and retention tracking." },
    { id: 4, code: "TAJ-401", title: "Advanced Tajweed & Qira'at", duration: "6 Months", lessons: "24 Modules", description: "Detailed study of Sifat-ul-Huroof, Ahkam Noon & Meem Sakinah, Madd rules, and Waqf." },
    { id: 5, code: "ARB-501", title: "Quranic Arabic & Daily Duas", duration: "6 Months", lessons: "20 Lessons", description: "Understanding basic Quranic vocabulary, grammar essentials, and Sunnah Duas." }
];

function initDatabase() {
    if (!localStorage.getItem("bqi_users")) {
        localStorage.setItem("bqi_users", JSON.stringify(DEFAULT_USERS));
    }
    if (!localStorage.getItem("bqi_parents")) {
        localStorage.setItem("bqi_parents", JSON.stringify(DEFAULT_PARENTS));
    }
    if (!localStorage.getItem("bqi_teachers")) {
        localStorage.setItem("bqi_teachers", JSON.stringify(DEFAULT_TEACHERS));
    }
    if (!localStorage.getItem("bqi_students")) {
        localStorage.setItem("bqi_students", JSON.stringify(DEFAULT_STUDENTS));
    }
    if (!localStorage.getItem("bqi_classes")) {
        localStorage.setItem("bqi_classes", JSON.stringify(DEFAULT_CLASSES));
    }
    if (!localStorage.getItem("bqi_requests")) {
        localStorage.setItem("bqi_requests", JSON.stringify(DEFAULT_REQUESTS));
    }
    if (!localStorage.getItem("bqi_tasks")) {
        localStorage.setItem("bqi_tasks", JSON.stringify(DEFAULT_TASKS));
    }
    if (!localStorage.getItem("bqi_announcements")) {
        localStorage.setItem("bqi_announcements", JSON.stringify(DEFAULT_ANNOUNCEMENTS));
    }
    if (!localStorage.getItem("bqi_courses")) {
        localStorage.setItem("bqi_courses", JSON.stringify(DEFAULT_COURSES));
    }
}

const BQI_DB = {
    getUsers: () => JSON.parse(localStorage.getItem("bqi_users") || "[]"),
    getParents: () => JSON.parse(localStorage.getItem("bqi_parents") || "[]"),
    getTeachers: () => JSON.parse(localStorage.getItem("bqi_teachers") || "[]"),
    getStudents: () => JSON.parse(localStorage.getItem("bqi_students") || "[]"),
    getClasses: () => JSON.parse(localStorage.getItem("bqi_classes") || "[]"),
    getRequests: () => JSON.parse(localStorage.getItem("bqi_requests") || "[]"),
    getTasks: () => JSON.parse(localStorage.getItem("bqi_tasks") || "[]"),
    getAnnouncements: () => JSON.parse(localStorage.getItem("bqi_announcements") || "[]"),
    getCourses: () => JSON.parse(localStorage.getItem("bqi_courses") || "[]"),
    
    saveParents: (parents) => localStorage.setItem("bqi_parents", JSON.stringify(parents)),
    saveTeachers: (teachers) => localStorage.setItem("bqi_teachers", JSON.stringify(teachers)),
    saveStudents: (students) => localStorage.setItem("bqi_students", JSON.stringify(students)),
    saveClasses: (classes) => localStorage.setItem("bqi_classes", JSON.stringify(classes)),
    saveRequests: (reqs) => localStorage.setItem("bqi_requests", JSON.stringify(reqs)),
    saveTasks: (tasks) => localStorage.setItem("bqi_tasks", JSON.stringify(tasks)),
    saveAnnouncements: (anns) => localStorage.setItem("bqi_announcements", JSON.stringify(anns)),
    saveCourses: (courses) => localStorage.setItem("bqi_courses", JSON.stringify(courses)),

    // SABAQ / LESSON HISTORY
    getSabaqHistory: (studentId) => {
        const students = BQI_DB.getStudents();
        const student = students.find(s => s.id === parseInt(studentId));
        return (student && student.sabaqHistory) ? student.sabaqHistory : [];
    },

    addSabaqEntry: (studentId, entry) => {
        const students = BQI_DB.getStudents();
        const student = students.find(s => s.id === parseInt(studentId));
        if (student) {
            if (!student.sabaqHistory) student.sabaqHistory = [];
            student.sabaqHistory.unshift({
                date: entry.date || new Date().toISOString().split('T')[0],
                lesson: entry.lesson,
                surahAyah: entry.surahAyah || "",
                grade: entry.grade || "A",
                remarks: entry.remarks || "Completed successfully"
            });
            BQI_DB.saveStudents(students);

            // Also update lesson notes on current classes
            const classes = BQI_DB.getClasses();
            const cls = classes.find(c => c.studentId === parseInt(studentId));
            if (cls) {
                cls.lessonNotes = entry.lesson + (entry.surahAyah ? ` (${entry.surahAyah})` : '');
                cls.status = "taken";
                BQI_DB.saveClasses(classes);
            }
            return true;
        }
        return false;
    },

    // NEW REQUESTS QUEUE
    addRequest: (reqData) => {
        const reqs = BQI_DB.getRequests();
        const maxId = reqs.reduce((max, r) => r.id > max ? r.id : max, 0);
        const newReq = {
            id: maxId + 1,
            dateReceived: new Date().toISOString().split('T')[0],
            status: "Pending",
            ...reqData
        };
        reqs.unshift(newReq);
        BQI_DB.saveRequests(reqs);
        return newReq;
    },

    deleteRequest: (reqId) => {
        let reqs = BQI_DB.getRequests();
        reqs = reqs.filter(r => r.id !== parseInt(reqId));
        BQI_DB.saveRequests(reqs);
        return true;
    },

    convertRequestToFamily: (reqId) => {
        const reqs = BQI_DB.getRequests();
        const r = reqs.find(item => item.id === parseInt(reqId));
        if (!r) return null;

        // 1. Create Parent
        const newParent = BQI_DB.addParent({
            name: r.name,
            email: r.email,
            phone: r.phone,
            country: r.country,
            timezone: r.timezone,
            fee: "60",
            currency: "USD"
        });

        // 2. Create Student under Family
        const newStudent = BQI_DB.addStudent({
            name: r.studentName || r.name + " Child",
            gender: "Male",
            age: 10,
            country: r.country,
            timezone: r.timezone,
            course: r.courseRequested || "Qaida Nooraniya",
            familyId: newParent.id,
            familyName: newParent.name,
            teacherId: 1,
            teacherName: "Demo Teacher 1",
            days: "Mon, Wed, Fri",
            timeSlot: r.preferredSlot || "12:00 AM - 12:30 AM",
            status: "Trial"
        });

        // 3. Mark request converted
        r.status = "Converted";
        BQI_DB.saveRequests(reqs);
        return { parent: newParent, student: newStudent };
    },

    // TASKS
    addTask: (taskData) => {
        const tasks = BQI_DB.getTasks();
        const maxId = tasks.reduce((max, t) => t.id > max ? t.id : max, 0);
        const newTask = { id: maxId + 1, status: "Pending", ...taskData };
        tasks.unshift(newTask);
        BQI_DB.saveTasks(tasks);
        return newTask;
    },

    toggleTaskStatus: (taskId) => {
        const tasks = BQI_DB.getTasks();
        const task = tasks.find(t => t.id === parseInt(taskId));
        if (task) {
            task.status = task.status === "Completed" ? "Pending" : "Completed";
            BQI_DB.saveTasks(tasks);
            return true;
        }
        return false;
    },

    deleteTask: (taskId) => {
        let tasks = BQI_DB.getTasks();
        tasks = tasks.filter(t => t.id !== parseInt(taskId));
        BQI_DB.saveTasks(tasks);
        return true;
    },

    // ANNOUNCEMENTS
    addAnnouncement: (annData) => {
        const anns = BQI_DB.getAnnouncements();
        const maxId = anns.reduce((max, a) => a.id > max ? a.id : max, 0);
        const newAnn = {
            id: maxId + 1,
            date: new Date().toISOString().split('T')[0],
            ...annData
        };
        anns.unshift(newAnn);
        BQI_DB.saveAnnouncements(anns);
        return newAnn;
    },

    deleteAnnouncement: (annId) => {
        let anns = BQI_DB.getAnnouncements();
        anns = anns.filter(a => a.id !== parseInt(annId));
        BQI_DB.saveAnnouncements(anns);
        return true;
    },

    // KPI METRIC CALCULATOR (Calculates 1-to-1 match for all 11 badges)
    getDashboardKpis: (filterDate) => {
        const classes = BQI_DB.getClasses();
        const students = BQI_DB.getStudents();
        const requests = BQI_DB.getRequests();

        const total = classes.length;
        const taken = classes.filter(c => c.status === 'taken' || c.status === 'active').length;
        const remaining = classes.filter(c => c.status === 'pending').length;
        const running = classes.filter(c => c.status === 'running' || c.status === 'active').length;
        const absent = classes.filter(c => c.status === 'absent').length;
        const leave = students.filter(s => s.status === 'Leave').length;
        const declined = classes.filter(c => c.status === 'declined').length;
        const suspended = students.filter(s => s.status === 'Suspended').length;
        const trials = students.filter(s => s.status === 'Trial').length;
        const advance = classes.filter(c => c.status === 'advance').length;
        const rescheduled = classes.filter(c => c.status === 'rescheduled').length;
        const newReqs = requests.filter(r => r.status === 'Pending').length;

        return {
            total, taken, remaining, running, absent, leave, declined, suspended, trials, advance, rescheduled, newReqs
        };
    },

    addStudent: (sData) => {
        const students = BQI_DB.getStudents();
        const maxId = students.reduce((max, s) => s.id > max ? s.id : max, 100);
        const newId = maxId + 1;
        const newStudent = { 
            id: newId, 
            ...sData, 
            roomId: newId,
            testStatus: "New Registration",
            certificateUrl: "",
            sabaqHistory: []
        };
        students.push(newStudent);
        BQI_DB.saveStudents(students);

        // Auto-create class schedule entry
        const classes = BQI_DB.getClasses();
        classes.push({
            id: newId,
            studentId: newId,
            studentName: sData.name,
            studentCountry: sData.country,
            teacherId: sData.teacherId || 1,
            teacherName: sData.teacherName || "Demo Teacher 1",
            type: sData.status === "Trial" ? "trial" : "regular",
            status: sData.status === "Trial" ? "trial" : "pending",
            date: "2026-08-20",
            time: sData.timeSlot || "12:00 AM - 12:30 AM",
            adminTime: sData.timeSlot ? sData.timeSlot.split("-")[0].trim() : "12:00 AM",
            teacherTime: sData.timeSlot || "12:00 AM PKT",
            studentTime: sData.studentLocalTime || "08:00 PM BST",
            onlineTime: "30 Mins",
            recordingUrl: "",
            isFlagged: false,
            flagNotes: "",
            lessonNotes: "New student registration."
        });
        BQI_DB.saveClasses(classes);
        return newStudent;
    },

    deleteStudent: (studentId) => {
        let students = BQI_DB.getStudents();
        students = students.filter(s => s.id !== parseInt(studentId));
        BQI_DB.saveStudents(students);

        let classes = BQI_DB.getClasses();
        classes = classes.filter(c => c.studentId !== parseInt(studentId));
        BQI_DB.saveClasses(classes);
        return true;
    },

    addParent: (pData) => {
        const parents = BQI_DB.getParents();
        const maxId = parents.reduce((max, p) => p.id > max ? p.id : max, 0);
        const newId = maxId + 1;
        const newParent = { 
            id: newId, 
            status: "Active", 
            notes: [],
            comments: [],
            invoices: [
                { month: "August 2026", due: "05-Aug-2026", paid: "-", fee: pData.fee || "60", adj: "0", total: pData.fee || "60", status: "Pending" }
            ],
            ...pData 
        };
        parents.push(newParent);
        BQI_DB.saveParents(parents);
        return newParent;
    },

    deleteParent: (parentId) => {
        let parents = BQI_DB.getParents();
        parents = parents.filter(p => p.id !== parseInt(parentId));
        BQI_DB.saveParents(parents);

        let students = BQI_DB.getStudents();
        const studentIdsToDelete = students.filter(s => s.familyId === parseInt(parentId)).map(s => s.id);
        students = students.filter(s => s.familyId !== parseInt(parentId));
        BQI_DB.saveStudents(students);

        let classes = BQI_DB.getClasses();
        classes = classes.filter(c => !studentIdsToDelete.includes(c.studentId));
        BQI_DB.saveClasses(classes);
        return true;
    },

    addTeacher: (tData) => {
        const teachers = BQI_DB.getTeachers();
        const maxId = teachers.reduce((max, t) => t.id > max ? t.id : max, 0);
        const newId = maxId + 1;
        const newTeacher = { 
            id: newId, 
            status: "Active", 
            ...tData 
        };
        teachers.push(newTeacher);
        BQI_DB.saveTeachers(teachers);

        const users = BQI_DB.getUsers();
        users.push({
            id: users.length + 1,
            username: tData.username || `teacher_${newId}`,
            name: tData.name,
            role: "teacher",
            password: tData.password || "teacher_bqi_123"
        });
        localStorage.setItem("bqi_users", JSON.stringify(users));

        return newTeacher;
    },

    deleteTeacher: (teacherId) => {
        let teachers = BQI_DB.getTeachers();
        teachers = teachers.filter(t => t.id !== parseInt(teacherId));
        BQI_DB.saveTeachers(teachers);
        return true;
    },

    addParentNote: (parentId, noteText) => {
        const parents = BQI_DB.getParents();
        const p = parents.find(item => item.id === parseInt(parentId));
        if (p) {
            if (!p.notes) p.notes = [];
            p.notes.unshift({
                date: new Date().toISOString().split('T')[0],
                author: "Admin Note",
                note: noteText
            });
            BQI_DB.saveParents(parents);
            return true;
        }
        return false;
    },

    addParentComment: (parentId, commentText, authorName) => {
        const parents = BQI_DB.getParents();
        const p = parents.find(item => item.id === parseInt(parentId));
        if (p) {
            if (!p.comments) p.comments = [];
            const now = new Date();
            p.comments.unshift({
                date: now.toLocaleDateString() + " " + now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                author: authorName || "Admin Haider",
                text: commentText
            });
            BQI_DB.saveParents(parents);
            return true;
        }
        return false;
    },

    updateParentStatus: (parentId, newStatus, reason) => {
        const parents = BQI_DB.getParents();
        const p = parents.find(item => item.id === parseInt(parentId));
        if (p) {
            p.status = newStatus;
            if (reason) {
                if (!p.comments) p.comments = [];
                p.comments.unshift({
                    date: new Date().toLocaleDateString(),
                    author: `Status Changed to ${newStatus}`,
                    text: `Reason: ${reason}`
                });
            }
            BQI_DB.saveParents(parents);

            const students = BQI_DB.getStudents();
            students.forEach(s => {
                if (s.familyId === parseInt(parentId)) {
                    s.status = newStatus;
                }
            });
            BQI_DB.saveStudents(students);
            return true;
        }
        return false;
    },

    changeTeacherForFamily: (parentId, newTeacherId) => {
        const teachers = BQI_DB.getTeachers();
        const teacher = teachers.find(t => t.id === parseInt(newTeacherId));
        if (!teacher) return false;

        const students = BQI_DB.getStudents();
        students.forEach(s => {
            if (s.familyId === parseInt(parentId)) {
                s.teacherId = teacher.id;
                s.teacherName = teacher.name;
            }
        });
        BQI_DB.saveStudents(students);

        const classes = BQI_DB.getClasses();
        classes.forEach(c => {
            const st = students.find(s => s.id === c.studentId);
            if (st && st.familyId === parseInt(parentId)) {
                c.teacherId = teacher.id;
                c.teacherName = teacher.name;
            }
        });
        BQI_DB.saveClasses(classes);
        return true;
    },

    updateClassStatus: (classId, newStatus) => {
        const classes = BQI_DB.getClasses();
        const cls = classes.find(c => c.id === parseInt(classId));
        if (cls) {
            cls.status = newStatus.toLowerCase();
            BQI_DB.saveClasses(classes);
            return true;
        }
        return false;
    },

    login: (username, password) => {
        const users = BQI_DB.getUsers();
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
        if (user) {
            localStorage.setItem("bqi_current_user", JSON.stringify(user));
            return { success: true, role: user.role, name: user.name };
        }
        return { success: false, message: "Invalid username or password!" };
    },

    getCurrentUser: () => {
        const userJson = localStorage.getItem("bqi_current_user");
        return userJson ? JSON.parse(userJson) : null;
    },

    logout: () => {
        localStorage.removeItem("bqi_current_user");
        window.location.href = "login.html";
    },

    clearSession: () => {
        localStorage.removeItem("bqi_current_user");
    },

    resetDatabase: () => {
        localStorage.setItem("bqi_users", JSON.stringify(DEFAULT_USERS));
        localStorage.setItem("bqi_parents", JSON.stringify(DEFAULT_PARENTS));
        localStorage.setItem("bqi_teachers", JSON.stringify(DEFAULT_TEACHERS));
        localStorage.setItem("bqi_students", JSON.stringify(DEFAULT_STUDENTS));
        localStorage.setItem("bqi_classes", JSON.stringify(DEFAULT_CLASSES));
        localStorage.setItem("bqi_requests", JSON.stringify(DEFAULT_REQUESTS));
        localStorage.setItem("bqi_tasks", JSON.stringify(DEFAULT_TASKS));
        localStorage.setItem("bqi_announcements", JSON.stringify(DEFAULT_ANNOUNCEMENTS));
        localStorage.setItem("bqi_courses", JSON.stringify(DEFAULT_COURSES));
    },

    flagClass: (classId, notes) => {
        const classes = BQI_DB.getClasses();
        const index = classes.findIndex(c => c.id === parseInt(classId));
        if (index !== -1) {
            classes[index].isFlagged = true;
            classes[index].flagNotes = notes;
            BQI_DB.saveClasses(classes);
            return true;
        }
        return false;
    },

    resolveFlag: (classId) => {
        const classes = BQI_DB.getClasses();
        const index = classes.findIndex(c => c.id === parseInt(classId));
        if (index !== -1) {
            classes[index].isFlagged = false;
            classes[index].flagNotes = "";
            BQI_DB.saveClasses(classes);
            return true;
        }
        return false;
    },

    updateLessonNotes: (classId, notes) => {
        const classes = BQI_DB.getClasses();
        const index = classes.findIndex(c => c.id === parseInt(classId));
        if (index !== -1) {
            classes[index].lessonNotes = notes;
            classes[index].status = "taken";
            BQI_DB.saveClasses(classes);
            return true;
        }
        return false;
    }
};

initDatabase();
