/**
 * Al-Huda Islamic Centre LMS — Digital Curriculum & Course Material Registry
 * Real-time unified syllabus engine supporting Noorani Qaida, Holy Quran, and custom uploaded books.
 */

// Authentic Takhti data for Noorani Qaida
const QAIDA_TAKHTIS = [
  { num: 1, title: "Takhti 1: Huroof-e-Mufradat (حروفِ مفردات)", sub: "Single Arabic Letters - Read from Right to Left", letters: ["ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "و", "هـ", "ء", "ي"] },
  { num: 2, title: "Takhti 2: Huroof-e-Murakkabat (حروفِ مرکبات)", sub: "Compound Letters & Joint Shapes", letters: ["لا", "با", "بلب", "كعب", "نحم", "يست", "بنت", "ثبت", "يس", "طع", "عج", "فج", "قن", "كم", "لم", "نم"] },
  { num: 3, title: "Takhti 3: Huroof-e-Muqatta'at (حروفِ مقطعات)", sub: "Mysterious Opening Letters in Holy Quran", letters: ["الم", "الر", "المر", "المص", "طسم", "طه", "طس", "يس", "حم", "حم عسق", "كهيعص", "ص", "ق", "ن"] },
  { num: 4, title: "Takhti 4: Harakat (حركات: زبر، زیر، پیش)", sub: "Short Vowels: Fatha (a), Kasra (i), Damma (u)", letters: ["اَ", "اِ", "اُ", "بَ", "بِ", "بُ", "تَ", "تِ", "تُ", "ثَ", "ثِ", "ثُ", "جَ", "جِ", "جُ", "حَ", "حِ", "حُ"] },
  { num: 5, title: "Takhti 5: Tanween (تنوين: دو زبر، دو زیر، دو پیش)", sub: "Double Vowels with Noon Sakin Sound", letters: ["اً", "اٍ", "اٌ", "بً", "بٍ", "بٌ", "تً", "تٍ", "تٌ", "ثً", "ثٍ", "ثٌ", "جً", "جٍ", "جٌ", "دً", "دٍ", "دٌ"] },
  { num: 6, title: "Takhti 6: Mashq Harakat o Tanween (مشق حركات و تنوین)", sub: "Practice Words with Short & Double Vowels", letters: ["أَبَدًا", "أَحَدٌ", "أَخَذَ", "بَلَدٍ", "حَسَدَ", "خَلَقَ", "ذَكَرَ", "رَفَعَ", "سَفَرَةٍ", "صُحُفًا", "طَبَقًا", "عَدَسِهَا"] },
  { num: 7, title: "Takhti 7: Khari Zabar, Khari Zer, Ulta Pesh (کھڑی حرکات)", sub: "Standing Vowels (Equivalent to 1 Alif)", letters: ["بٰ", "بٖ", "بٗ", "تٰ", "تٖ", "تٗ", "ثٰ", "ثٖ", "ثٗ", "جٰ", "جٖ", "جٗ", "دٰ", "دٖ", "دٗ", "رٰ", "رٖ", "رٗ"] },
  { num: 8, title: "Takhti 8: Huroof-e-Maddah o Leen (حروفِ مدہ و لین)", sub: "Elongated & Soft Vowels", letters: ["بَا", "بُوْ", "بِيْ", "بَوْ", "بَيْ", "تَا", "تُوْ", "تِيْ", "تَوْ", "تَيْ", "ثَا", "ثُوْ", "ثِيْ", "جَا", "جُوْ", "جِيْ"] },
  { num: 9, title: "Takhti 9: Mashq Maddah o Leen (مشق مدہ و لین)", sub: "Word Practice with Madd & Leen Letters", letters: ["جَاءَ", "جِيءَ", "سُوْءَ", "خَوْفٌ", "بَيْتٌ", "قَوْمٌ", "صَيْفٌ", "يَوْمٌ", "فِيْهِ", "تُوْبُوْا", "قَالُوْا", "كِيْلَ"] },
  { num: 10, title: "Takhti 10: Sukoon / Jazm (سکون / جزم)", sub: "Silent Resting Mark Pronunciation", letters: ["أَبْ", "أَتْ", "أَثْ", "إِبْ", "إِتْ", "إِثْ", "أُبْ", "أُتْ", "أُثْ", "يَقْرَأُ", "تَعْلَمُوْنَ", "يَفْعَلُوْنَ", "نَعْبُدُ", "نَسْتَعِيْنُ"] },
  { num: 11, title: "Takhti 11: Tashdeed (تشدید / مشدد)", sub: "Doubled Emphasized Letters", letters: ["أَبَّ", "أَبِّ", "أَبُّ", "إِبَّ", "إِبِّ", "إِبُّ", "أُبَّ", "أُبِّ", "أُبُّ", "حَقَّ", "رَبِّ", "مَدَّ", "عَمَّ", "إِنَّ"] },
  { num: 12, title: "Takhti 12: Ahkam-e-Waqf o Rasm-ul-Khat (احکامِ وقف)", sub: "Stopping Rules and Quranic Orthography", letters: ["مـ (لازم)", "ط (مطلق)", "ج (جائز)", "ز (مجوز)", "ص (مرخص)", "قف (وقف)", "لا (عدم وقف)", "۝ (آیت مکمل)"] }
];

// Master 30 Paras (Juz) Registry for Holy Quran & Tafseer
const QURAN_PARAS_INFO = [
  { para: 1, name_en: "Alif Lam Meem", name_ur: "الم", name_ar: "الم", page_start: 1, page_end: 18, total_pages: 18 },
  { para: 2, name_en: "Sayaqool", name_ur: "سیقول", name_ar: "سيقول", page_start: 19, page_end: 36, total_pages: 18 },
  { para: 3, name_en: "Tilka-r-Rusul", name_ur: "تلک الرسل", name_ar: "تلك الرسل", page_start: 37, page_end: 54, total_pages: 18 },
  { para: 4, name_en: "Lan Tanaaloo", name_ur: "لن تنالوا", name_ar: "لن تنالوا", page_start: 55, page_end: 72, total_pages: 18 },
  { para: 5, name_en: "Wal Mohsanat", name_ur: "والمحصنت", name_ar: "والمحصنات", page_start: 73, page_end: 90, total_pages: 18 },
  { para: 6, name_en: "La Yuhibbullah", name_ur: "لا یحب اللہ", name_ar: "لا يحب الله", page_start: 91, page_end: 108, total_pages: 18 },
  { para: 7, name_en: "Wa Iza Samiu", name_ur: "واذا سمعوا", name_ar: "وإذا سمعوا", page_start: 109, page_end: 126, total_pages: 18 },
  { para: 8, name_en: "Wa Lau Annana", name_ur: "ولو اننا", name_ar: "ولو أننا", page_start: 127, page_end: 144, total_pages: 18 },
  { para: 9, name_en: "Qalal Malao", name_ur: "قال الملاء", name_ar: "قال الملأ", page_start: 145, page_end: 162, total_pages: 18 },
  { para: 10, name_en: "Wa A'lamoo", name_ur: "واعلموا", name_ar: "واعلموا", page_start: 163, page_end: 180, total_pages: 18 },
  { para: 11, name_en: "Ya'taziroon", name_ur: "یعتذرون", name_ar: "يعتذرون", page_start: 181, page_end: 198, total_pages: 18 },
  { para: 12, name_en: "Wa Mamin Da'abbat", name_ur: "ومامن دابة", name_ar: "وما من دابة", page_start: 199, page_end: 216, total_pages: 18 },
  { para: 13, name_en: "Wa Ma Ubrioo", name_ur: "وما ابری", name_ar: "وما أبرئ", page_start: 217, page_end: 234, total_pages: 18 },
  { para: 14, name_en: "Rubama", name_ur: "ربما", name_ar: "ربما", page_start: 235, page_end: 252, total_pages: 18 },
  { para: 15, name_en: "Subhanallazi", name_ur: "سبحن الذی", name_ar: "سبحان الذي", page_start: 253, page_end: 270, total_pages: 18 },
  { para: 16, name_en: "Qala Alam", name_ur: "قال الم", name_ar: "قال ألم", page_start: 271, page_end: 288, total_pages: 18 },
  { para: 17, name_en: "Iqtaraba Lin-Nasi", name_ur: "اقترب للناس", name_ar: "اقترب للناس", page_start: 289, page_end: 306, total_pages: 18 },
  { para: 18, name_en: "Qad Aflaha", name_ur: "قد افلح", name_ar: "قد أفلح", page_start: 307, page_end: 324, total_pages: 18 },
  { para: 19, name_en: "Wa Qalal Lazina", name_ur: "وقال الذین", name_ar: "وقال الذين", page_start: 325, page_end: 342, total_pages: 18 },
  { para: 20, name_en: "Am-man Khalaq", name_ur: "امن خلق", name_ar: "أمن خلق", page_start: 343, page_end: 360, total_pages: 18 },
  { para: 21, name_en: "Utlu Ma Oohiya", name_ur: "اتل ما اوحی", name_ar: "اتل ما أوحي", page_start: 361, page_end: 378, total_pages: 18 },
  { para: 22, name_en: "Wa Man Yaqnut", name_ur: "ومن یقنت", name_ar: "ومن يقنت", page_start: 379, page_end: 396, total_pages: 18 },
  { para: 23, name_en: "Wa Maliya", name_ur: "ومالی", name_ar: "وما لي", page_start: 397, page_end: 414, total_pages: 18 },
  { para: 24, name_en: "Fa-man Azlam", name_ur: "فمن اظلم", name_ar: "فمن أظلم", page_start: 415, page_end: 432, total_pages: 18 },
  { para: 25, name_en: "Ilaihi Yuraddu", name_ur: "الیہ یرد", name_ar: "إليه يرد", page_start: 433, page_end: 450, total_pages: 18 },
  { para: 26, name_en: "Ha-Meem", name_ur: "حم", name_ar: "حم", page_start: 451, page_end: 468, total_pages: 18 },
  { para: 27, name_en: "Qala Fama Khatbukum", name_ur: "قال فما خطبکم", name_ar: "قال فما خطبكم", page_start: 469, page_end: 486, total_pages: 18 },
  { para: 28, name_en: "Qad Sami Allah", name_ur: "قد سمع اللہ", name_ar: "قد سمع الله", page_start: 487, page_end: 504, total_pages: 18 },
  { para: 29, name_en: "Tabarakallazi", name_ur: "تبارک الذی", name_ar: "تبارك الذي", page_start: 505, page_end: 524, total_pages: 20 },
  { para: 30, name_en: "Amma Yatasa'aloon", name_ur: "عمّ یتساءلون", name_ar: "عم يتساءلون", page_start: 525, page_end: 548, total_pages: 24 }
];

// Helper to retrieve the actual page URLs array for a given Para of a book
function getBookParaPages(book, paraNum) {
  if (!book) return [];
  const p = Number(paraNum) || 1;
  // 1. If book has explicit paras_data dictionary:
  if (book.paras_data) {
    if (Array.isArray(book.paras_data[p])) return book.paras_data[p];
    if (Array.isArray(book.paras_data[String(p)])) return book.paras_data[String(p)];
  }
  // 2. If book has paras metadata array:
  const parasList = book.paras || QURAN_PARAS_INFO;
  const match = parasList.find(item => Number(item.para) === p);
  if (match) {
    if (Array.isArray(match.pages) && match.pages.length > 0) return match.pages;
    if (Array.isArray(book.pages) && book.pages.length > 0) {
      const start = (match.page_start || 1) - 1;
      const count = match.total_pages || (match.page_end ? match.page_end - match.page_start + 1 : 18);
      return book.pages.slice(start, start + count);
    }
  }
  return [];
}

// Vector SVG Data URI generator for instant, 100% offline, zero-network-failure rendering
function generateDynamicSvgDataUri(book, pageNum, paraNum = null, language = null) {
  const p = Math.max(1, Number(pageNum) || 1);
  const bTitle = (book.title || 'Course Material').replace(/&/g, '&amp;');
  const arTitle = (book.title_ar || book.urduTitle || 'الْقُرْآنُ الْكَرِيم').replace(/&/g, '&amp;');
  const totalP = book.total_pages || book.totalPages || 32;

  let bodyContent = '';
  const isQaida = (book.id === 'noorani-qaida' || book.category === 'qaida' || (book.title && book.title.toLowerCase().includes('qaida')));
  const isQuran = (book.id === 'holy-quran-16-line' || book.category === 'quran' || (book.title && book.title.toLowerCase().includes('quran')));
  const isTafseer = (book.category === 'tafseer' || (book.title && book.title.toLowerCase().includes('tafseer')));
  const takhti = isQaida ? QAIDA_TAKHTIS[Math.min(QAIDA_TAKHTIS.length - 1, p - 1)] : null;

  if (takhti && isQaida) {
    // Generate Takhti Header & Arabic letter boxes grid
    const letters = takhti.letters || [];
    const cols = letters.length <= 16 ? 4 : (letters.length <= 20 ? 4 : 5);
    const boxW = Math.floor(520 / cols);
    const boxH = letters.length <= 16 ? 85 : 68;
    const startX = 40;
    const startY = 135;

    let boxesSvg = '';
    // Arabic is read right-to-left, so we place rightmost in column 0
    letters.forEach((letter, i) => {
      const row = Math.floor(i / cols);
      const colInRow = i % cols;
      const x = startX + (cols - 1 - colInRow) * boxW;
      const y = startY + row * (boxH + 10);

      boxesSvg += `
        <g transform="translate(${x}, ${y})">
          <rect width="${boxW - 10}" height="${boxH}" rx="10" fill="#ffffff" stroke="#047857" stroke-width="1.8" stroke-opacity="0.8"/>
          <rect x="3" y="3" width="${boxW - 16}" height="${boxH - 6}" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="0.8"/>
          <text x="${(boxW - 10) / 2}" y="${boxH / 2 + 12}" font-family="'Amiri', 'Traditional Arabic', serif" font-size="${letters.length > 20 ? '30' : '36'}" font-weight="bold" fill="#064e3b" text-anchor="middle" direction="rtl">${letter}</text>
        </g>
      `;
    });

    bodyContent = `
      <g transform="translate(50, 130)">
        <rect width="600" height="760" rx="16" fill="#ffffff" stroke="#c5a880" stroke-width="2"/>
        <rect x="12" y="12" width="576" height="736" rx="12" fill="none" stroke="#e2e8f0" stroke-width="1"/>

        <!-- Takhti Title Banner -->
        <rect x="35" y="24" width="530" height="74" rx="12" fill="#ecfdf5" stroke="#10b981" stroke-width="1.5"/>
        <text x="300" y="55" font-family="'Amiri', 'Plus Jakarta Sans', serif" font-size="21" font-weight="bold" fill="#047857" text-anchor="middle" direction="rtl">${takhti.title}</text>
        <text x="300" y="82" font-family="sans-serif" font-size="11" font-weight="600" fill="#b45309" text-anchor="middle">${takhti.sub}</text>

        <!-- Dynamic Letter Boxes Grid -->
        ${boxesSvg}

        <!-- Teaching Note / Rule Footer inside frame -->
        <g transform="translate(35, 680)">
          <rect width="530" height="48" rx="10" fill="#fefce8" stroke="#fef08a" stroke-width="1.2"/>
          <text x="265" y="22" font-family="sans-serif" font-size="11" font-weight="bold" fill="#854d0e" text-anchor="middle">💡 Tajweed Rule &amp; Instruction:</text>
          <text x="265" y="38" font-family="sans-serif" font-size="10" fill="#713f12" text-anchor="middle">Pronounce each letter from its correct Makhraj (articulation point) with full Makhaarij accuracy.</text>
        </g>
      </g>
    `;
  } else if (isQuran) {
    // Determine target Para
    let activeParaNum = Number(paraNum) || 1;
    if (!paraNum && book.paras) {
      const matchP = book.paras.find(pr => p >= pr.page_start && p <= pr.page_end);
      if (matchP) activeParaNum = matchP.para;
    }
    const paraMeta = QURAN_PARAS_INFO.find(pr => pr.para === activeParaNum) || QURAN_PARAS_INFO[0];
    const paraUr = paraMeta.name_ur || 'الم';
    const paraEn = paraMeta.name_en || 'Alif Lam Meem';

    bodyContent = `
      <g transform="translate(50, 130)">
        <rect width="600" height="760" rx="16" fill="#ffffff" stroke="#c5a880" stroke-width="2"/>
        <rect x="12" y="12" width="576" height="736" rx="12" fill="none" stroke="#e2e8f0" stroke-width="1"/>

        <!-- Quran Header Banner -->
        <g transform="translate(35, 20)">
          <rect width="530" height="65" rx="12" fill="#fdfbf7" stroke="#c5a880" stroke-width="1.5"/>
          <text x="35" y="40" font-family="'Amiri', serif" font-size="18" font-weight="bold" fill="#047857">الجزء ${activeParaNum}: ${paraUr}</text>
          <text x="500" y="38" font-family="'Cinzel', 'Plus Jakarta Sans', serif" font-size="14" font-weight="bold" fill="#b45309" text-anchor="end">Para ${activeParaNum} &bull; ${paraEn}</text>
        </g>

        <!-- Bismillah Header -->
        <g transform="translate(35, 105)">
          <rect width="530" height="60" rx="10" fill="#ecfdf5" stroke="#10b981" stroke-width="1.2"/>
          <text x="265" y="42" font-family="'Amiri', 'Traditional Arabic', serif" font-size="28" font-weight="bold" fill="#064e3b" text-anchor="middle" direction="rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</text>
        </g>

        <!-- 16-Line Authentic Quran Text Simulation -->
        <g transform="translate(35, 185)">
          <rect width="530" height="470" rx="12" fill="#faf8f5" stroke="#e2e8f0" stroke-width="1.2"/>
          <text x="500" y="45" font-family="'Amiri', 'Traditional Arabic', serif" font-size="22" font-weight="bold" fill="#1e293b" text-anchor="end" direction="rtl">الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ۝ الرَّحْمَٰنِ الرَّحِيمِ ۝</text>
          <text x="500" y="95" font-family="'Amiri', 'Traditional Arabic', serif" font-size="22" font-weight="bold" fill="#1e293b" text-anchor="end" direction="rtl">مَالِكِ يَوْمِ الدِّينِ ۝ إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ ۝</text>
          <text x="500" y="145" font-family="'Amiri', 'Traditional Arabic', serif" font-size="22" font-weight="bold" fill="#1e293b" text-anchor="end" direction="rtl">اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ ۝ صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ ۝</text>
          <text x="500" y="195" font-family="'Amiri', 'Traditional Arabic', serif" font-size="22" font-weight="bold" fill="#1e293b" text-anchor="end" direction="rtl">غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ ۝</text>
          <line x1="40" y1="220" x2="490" y2="220" stroke="#c5a880" stroke-width="1" stroke-dasharray="4,4"/>
          <text x="500" y="260" font-family="'Amiri', 'Traditional Arabic', serif" font-size="22" font-weight="bold" fill="#1e293b" text-anchor="end" direction="rtl">الم ۝ ذَٰلِكَ الْكِتَابُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ ۝</text>
          <text x="500" y="310" font-family="'Amiri', 'Traditional Arabic', serif" font-size="22" font-weight="bold" fill="#1e293b" text-anchor="end" direction="rtl">الَّذِينَ يُؤْمِنُونَ بِالْغَيْبِ وَيُقِيمُونَ الصَّلَاةَ وَمِمَّا رَزَقْنَاهُمْ يُنفِقُونَ ۝</text>
          <text x="500" y="360" font-family="'Amiri', 'Traditional Arabic', serif" font-size="22" font-weight="bold" fill="#1e293b" text-anchor="end" direction="rtl">وَالَّذِينَ يُؤْمِنُونَ بِمَا أُنزِلَ إِلَيْكَ وَمَا أُنزِلَ مِن قَبْلِكَ ۝</text>
          <text x="500" y="410" font-family="'Amiri', 'Traditional Arabic', serif" font-size="22" font-weight="bold" fill="#1e293b" text-anchor="end" direction="rtl">وَبِالْآخِرَةِ هُمْ يُوقِنُونَ ۝ أُولَٰئِكَ عَلَىٰ هُدًى مِّن رَّبِّهِمْ ۝</text>
        </g>

        <!-- Tajweed Indicator Footer -->
        <g transform="translate(35, 680)">
          <rect width="530" height="48" rx="10" fill="#ecfdf5" stroke="#10b981" stroke-width="1.2"/>
          <text x="265" y="22" font-family="sans-serif" font-size="11" font-weight="bold" fill="#047857" text-anchor="middle">📖 Holy Quran &bull; Tajweed Recitation Mode</text>
          <text x="265" y="38" font-family="sans-serif" font-size="10" fill="#065f46" text-anchor="middle">Para ${activeParaNum}: ${paraEn} (${paraUr}) &bull; Page ${p}</text>
        </g>
      </g>
    `;
  } else if (isTafseer) {
    const lang = (book.language || language || 'en').toLowerCase();
    const isUrdu = lang === 'ur' || lang.includes('urdu');
    const activeParaNum = Number(paraNum) || 1;
    const paraMeta = QURAN_PARAS_INFO.find(pr => pr.para === activeParaNum) || QURAN_PARAS_INFO[0];

    bodyContent = `
      <g transform="translate(50, 130)">
        <rect width="600" height="760" rx="16" fill="#ffffff" stroke="#c5a880" stroke-width="2"/>
        <rect x="12" y="12" width="576" height="736" rx="12" fill="none" stroke="#e2e8f0" stroke-width="1"/>

        <!-- Tafseer Language & Para Banner -->
        <g transform="translate(35, 20)">
          <rect width="530" height="65" rx="12" fill="#eff6ff" stroke="#3b82f6" stroke-width="1.5"/>
          <text x="35" y="38" font-family="'Plus Jakarta Sans', sans-serif" font-size="13" font-weight="bold" fill="#1e40af">${isUrdu ? 'اردو تفسیر و ترجمہ' : 'English Tafseer & Exegesis'}</text>
          <text x="500" y="38" font-family="'Amiri', 'Plus Jakarta Sans', serif" font-size="14" font-weight="bold" fill="#1e3a8a" text-anchor="end">Para ${activeParaNum}: ${isUrdu ? paraMeta.name_ur : paraMeta.name_en}</text>
        </g>

        <!-- Quran Ayah Arabic Context -->
        <g transform="translate(35, 105)">
          <rect width="530" height="110" rx="10" fill="#fdfbf7" stroke="#c5a880" stroke-width="1.2"/>
          <text x="265" y="40" font-family="'Amiri', 'Traditional Arabic', serif" font-size="24" font-weight="bold" fill="#064e3b" text-anchor="middle" direction="rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</text>
          <text x="265" y="80" font-family="'Amiri', 'Traditional Arabic', serif" font-size="20" font-weight="bold" fill="#1e293b" text-anchor="middle" direction="rtl">الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ۝ الرَّحْمَٰنِ الرَّحِيمِ ۝</text>
        </g>

        <!-- Translation & Commentary Box -->
        <g transform="translate(35, 235)">
          <rect width="530" height="420" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.2"/>
          <text x="30" y="36" font-family="'Plus Jakarta Sans', sans-serif" font-size="13" font-weight="bold" fill="#0f172a">${isUrdu ? 'ترجمہ و تشریح:' : 'Verse Translation & Key Themes:'}</text>
          <text x="30" y="70" font-family="${isUrdu ? "'Jameel Noori Nastaleeq', 'Amiri', serif" : "'Plus Jakarta Sans', sans-serif"}" font-size="${isUrdu ? '15' : '11.5'}" fill="#334155" ${isUrdu ? "direction='rtl' text-anchor='start'" : ""}>
            ${isUrdu
              ? 'تمام تعریفیں اللہ ہی کے لیے ہیں جو تمام جہانوں کا رب ہے۔ وہ نہایت مہربان، ہمیشہ رحم فرمانے والا ہے۔'
              : 'All praise is due to Allah alone, the Cherisher and Sustainer of all the worlds. The Most Gracious, the Most Merciful.'}
          </text>
          <line x1="30" y1="110" x2="500" y2="110" stroke="#e2e8f0" stroke-width="1.2"/>
          <text x="30" y="145" font-family="'Plus Jakarta Sans', sans-serif" font-size="13" font-weight="bold" fill="#0f172a">${isUrdu ? 'تفسیری فوائد و اسباب نزول:' : 'Tafseer Commentary & Exegesis:'}</text>
          <text x="30" y="180" font-family="${isUrdu ? "'Amiri', serif" : "'Plus Jakarta Sans', sans-serif"}" font-size="${isUrdu ? '14' : '11'}" fill="#475569" ${isUrdu ? "direction='rtl'" : ""}>
            ${isUrdu
              ? 'یہ مبارک سورۃ تمام قرآن کا خلاصہ اور ام الکتاب ہے۔ بندہ اپنے رب کی حمد و ثنا بیان کر کے سیدھے راستے کی ہدایت مانگتا ہے۔'
              : 'This noble chapter (Umm al-Kitab) embodies the essence of the entire Holy Quran. It opens with unconditioned gratitude, affirms Allah’s exclusive Lordship, and supplicates for the Straight Path (Sirat al-Mustaqeem).'}
          </text>
          <text x="30" y="240" font-family="${isUrdu ? "'Amiri', serif" : "'Plus Jakarta Sans', sans-serif"}" font-size="${isUrdu ? '14' : '11'}" fill="#475569" ${isUrdu ? "direction='rtl'" : ""}>
            ${isUrdu
              ? 'روز قیامت کی جزا و سزا کا تذکرہ اس لیے فرمایا تاکہ انسان کو احتساب کا احساس رہے اور وہ نیکی کی طرف راغب ہو۔'
              : 'Emphasis is laid on the Day of Judgment (Yawm ad-Deen) so the servant remains vigilant of accountability, worshiping Allah with awe, love, and sincere devotion.'}
          </text>
        </g>

        <!-- Teaching Footer -->
        <g transform="translate(35, 680)">
          <rect width="530" height="48" rx="10" fill="#fefce8" stroke="#fef08a" stroke-width="1.2"/>
          <text x="265" y="22" font-family="sans-serif" font-size="11" font-weight="bold" fill="#854d0e" text-anchor="middle">💡 Tafseer Learning Note:</text>
          <text x="265" y="38" font-family="sans-serif" font-size="10" fill="#713f12" text-anchor="middle">${isUrdu ? 'پارہ ' + activeParaNum + ' &bull; باقاعدہ فہم قرآن اور عملی رہنمائی' : 'Para ' + activeParaNum + ' &bull; Contextual Arabic Lexicology & Authentic Exegesis'}</text>
        </g>
      </g>
    `;
  } else {
    // Default fallback layout for general books
    bodyContent = `
      <g transform="translate(50, 150)">
        <rect width="600" height="710" rx="16" fill="#ffffff" stroke="#c5a880" stroke-width="2"/>
        <rect x="15" y="15" width="570" height="680" rx="12" fill="none" stroke="#e2e8f0" stroke-width="1"/>
        
        <text x="300" y="70" font-family="'Amiri', serif" font-size="28" font-weight="bold" fill="#047857" text-anchor="middle" direction="rtl">${arTitle}</text>
        <text x="300" y="105" font-family="sans-serif" font-size="16" font-weight="bold" fill="#d97706" text-anchor="middle">${bTitle}</text>
        <line x1="60" y1="130" x2="540" y2="130" stroke="#c5a880" stroke-width="1.5" stroke-dasharray="6,4"/>

        <!-- Content Outline Card -->
        <g transform="translate(40, 160)">
          <rect width="520" height="110" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>
          <text x="30" y="38" font-family="'Plus Jakarta Sans', sans-serif" font-size="14" font-weight="bold" fill="#0f172a">Academic Curriculum Syllabus</text>
          <text x="30" y="65" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="600" fill="#475569">Section &bull; Page ${p} of ${totalP}</text>
          <text x="30" y="90" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" fill="#047857" font-weight="700">Al-Huda Islamic Centre &bull; Course Material</text>
        </g>

        <!-- Professional Arabic Calligraphy Embellishment -->
        <g transform="translate(40, 300)">
          <rect width="520" height="190" rx="14" fill="#fdfbf7" stroke="#e2e8f0" stroke-width="1.2"/>
          <text x="260" y="70" font-family="'Amiri', 'Traditional Arabic', serif" font-size="34" font-weight="bold" fill="#064e3b" text-anchor="middle" direction="rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</text>
          <line x1="80" y1="100" x2="440" y2="100" stroke="#c5a880" stroke-width="1.2" stroke-dasharray="4,4"/>
          <text x="260" y="140" font-family="'Amiri', serif" font-size="22" font-weight="bold" fill="#1e293b" text-anchor="middle" direction="rtl">رَبِّ زِدْنِي عِلْمًا</text>
          <text x="260" y="165" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="600" fill="#64748b" text-anchor="middle">"My Lord, increase me in knowledge." [Surah Taha: 114]</text>
        </g>

        <!-- Structured Learning Objectives Card -->
        <g transform="translate(40, 520)">
          <rect width="520" height="140" rx="12" fill="#f0fdf4" stroke="#86efac" stroke-width="1.2"/>
          <text x="30" y="32" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="bold" fill="#14532d">Core Learning Objectives &amp; Teaching Focus:</text>
          <text x="30" y="60" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="600" fill="#166534">&bull; Master phonetic articulation and Makhaarij rules for this lesson unit.</text>
          <text x="30" y="85" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="600" fill="#166534">&bull; Maintain rhythmic cadence and strict adherence to Tajweed guidelines.</text>
          <text x="30" y="110" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="600" fill="#166534">&bull; Complete assigned recitation exercises and review with your assigned instructor.</text>
        </g>
      </g>
    `;
  }

  const svgXml = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 1000" width="700" height="1000">
      <defs>
        <linearGradient id="pageBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fdfbf7"/>
          <stop offset="100%" stop-color="#f8f5ee"/>
        </linearGradient>
      </defs>

      <!-- Page Canvas Background -->
      <rect width="700" height="1000" fill="url(#pageBgGrad)"/>

      <!-- Outer Islamic Double Border with Corner Brackets -->
      <rect x="20" y="20" width="660" height="960" rx="18" fill="none" stroke="#047857" stroke-width="4" stroke-opacity="0.8"/>
      <rect x="28" y="28" width="644" height="944" rx="12" fill="none" stroke="#c5a880" stroke-width="1.5" stroke-dasharray="8,4"/>

      <!-- Corner Ornaments -->
      <path d="M 28 58 L 58 28 M 28 68 L 68 28 M 28 78 L 78 28" stroke="#c5a880" stroke-width="1.5"/>
      <path d="M 672 58 L 642 28 M 672 68 L 632 28 M 672 78 L 622 28" stroke="#c5a880" stroke-width="1.5"/>
      <path d="M 28 942 L 58 972 M 28 932 L 68 972 M 28 922 L 78 972" stroke="#c5a880" stroke-width="1.5"/>
      <path d="M 672 942 L 642 972 M 672 932 L 632 972 M 672 922 L 622 972" stroke="#c5a880" stroke-width="1.5"/>

      <!-- Header Top Bar -->
      <g transform="translate(50, 48)">
        <text x="300" y="22" font-family="'Cinzel', 'Plus Jakarta Sans', serif" font-size="14" font-weight="bold" fill="#064e3b" letter-spacing="2" text-anchor="middle">AL-HUDA ISLAMIC CENTRE LMS</text>
        <text x="300" y="44" font-family="sans-serif" font-size="11" font-weight="600" fill="#d97706" text-anchor="middle">${bTitle} &bull; Page ${p}</text>
        <line x1="120" y1="58" x2="480" y2="58" stroke="#c5a880" stroke-width="1.5"/>
      </g>

      <!-- Main Dynamic Body Content -->
      ${bodyContent}

      <!-- Bottom Footer Status -->
      <g transform="translate(50, 920)">
        <line x1="20" y1="0" x2="580" y2="0" stroke="#cbd5e1" stroke-width="1"/>
        <text x="20" y="28" font-family="sans-serif" font-size="11" font-weight="bold" fill="#64748b">Verified Al-Huda Academy Course Material</text>
        <rect x="255" y="10" width="90" height="28" rx="8" fill="#047857"/>
        <text x="300" y="28" font-family="'Amiri', serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">صفحہ ${p} / ${totalP}</text>
        <text x="580" y="28" font-family="sans-serif" font-size="11" font-weight="bold" fill="#d97706" text-anchor="end">&copy; Al-Huda LMS</text>
      </g>
    </svg>
  `.trim();

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgXml);
}

// Master standard curriculum array containing core academy syllabus
const ALHUDA_CURRICULUM = [
  {
    id: "interactive-madani-qaida",
    title: "Al-Huda Interactive E-Qaida",
    title_ar: "القاعدة المدنية التفاعلية",
    category: "qaida",
    category_label: "Interactive Digital Lab",
    author: "Al-Huda Quranic Academy Board",
    edition: "Multimedia Audio Edition (Complete 49 Lessons)",
    total_pages: 49,
    is_interactive: true,
    cover_bg: "from-emerald-700 via-teal-800 to-slate-900",
    cover_icon: "fa-solid fa-volume-high",
    description: "Complete 49-lesson interactive multimedia Arabic Qaida with clickable cards, authentic Arabic audio recitation, English transliteration, Makharij articulation points, teeth diagrams, and comprehensive Tajweed rules.",
    chapters: [
      { title: "L01: 29 Single Letters", desc: "29 Single Letters (Mufradat) & Phonetics", page_start: 1, page_end: 1 },
      { title: "L02: Makharij & Anatomy", desc: "5 Major Organs, 17 Points & Teeth Chart", page_start: 2, page_end: 2 },
      { title: "L03: Different Shapes", desc: "Initial, Medial, Final & Isolated Forms", page_start: 3, page_end: 3 },
      { title: "L04: Compound Letters", desc: "51 Joint Letter Combinations & Breakdown", page_start: 4, page_end: 4 },
      { title: "L05: Fatha (Zabar) Letters", desc: "Harakat: Fatha (Short 'a' Vowel)", page_start: 5, page_end: 5 },
      { title: "L05: Fatha Practice Words", desc: "27 Words with Fatha Vowels", page_start: 6, page_end: 6 },
      { title: "L05: Kasra (Zer) Letters", desc: "Harakat: Kasra (Short 'i' Vowel)", page_start: 7, page_end: 7 },
      { title: "L05: Kasra Practice Words", desc: "24 Words with Kasra Vowels", page_start: 8, page_end: 8 },
      { title: "L05: Damma (Pesh) Letters", desc: "Harakat: Damma (Short 'u' Vowel)", page_start: 9, page_end: 9 },
      { title: "L05: Damma Practice Words", desc: "29 Words with Damma Vowels", page_start: 10, page_end: 10 },
      { title: "L06: Jazm / Sukoon Letters", desc: "60 Quiescent Letter Combinations", page_start: 11, page_end: 11 },
      { title: "L06: Sukoon Practice Words", desc: "20 Practice Words with Sukoon", page_start: 12, page_end: 12 },
      { title: "L07: Tashdeed Letters", desc: "75 Doubled Shaddah Combinations", page_start: 13, page_end: 13 },
      { title: "L07: Tashdeed Words", desc: "19 Practice Words with Tashdeed", page_start: 14, page_end: 14 },
      { title: "L08: Ghunnah Rules", desc: "Noon & Meem Mushaddad (2 Harakat Nasal)", page_start: 15, page_end: 15 },
      { title: "L08: Ghunnah Practice Words", desc: "25 Practice Words with Ghunnah", page_start: 16, page_end: 16 },
      { title: "L08B: Qalqalah Letters", desc: "5 Bouncing Echo Letters (Qutb Jadd)", page_start: 17, page_end: 17 },
      { title: "L08B: Qalqalah Words", desc: "20 Practice Words with Qalqalah", page_start: 18, page_end: 18 },
      { title: "L09: Maddah Long Vowels", desc: "81 Long Vowel Combinations (Alif, Waaw, Yaa)", page_start: 19, page_end: 19 },
      { title: "L09: Maddah Practice Words", desc: "33 Practice Words with Maddah", page_start: 20, page_end: 20 },
      { title: "L10: Leen Soft Letters", desc: "56 Soft Diphthongs (Waaw & Yaa Leen)", page_start: 21, page_end: 21 },
      { title: "L10: Leen Practice Words", desc: "23 Practice Words with Leen", page_start: 22, page_end: 22 },
      { title: "L11: Fathatain (2 Zabar)", desc: "Tanween: Double Fatha Letters", page_start: 23, page_end: 23 },
      { title: "L11: Fathatain Words", desc: "30 Practice Words with Fathatain", page_start: 24, page_end: 24 },
      { title: "L11: Kasratain (2 Zer)", desc: "Tanween: Double Kasra Letters", page_start: 25, page_end: 25 },
      { title: "L11: Kasratain Words", desc: "30 Practice Words with Kasratain", page_start: 26, page_end: 26 },
      { title: "L11: Dammatain (2 Pesh)", desc: "Tanween: Double Damma Letters", page_start: 27, page_end: 27 },
      { title: "L11: Dammatain Words", desc: "26 Practice Words with Dammatain", page_start: 28, page_end: 28 },
      { title: "L12: Standing Fatha", desc: "Standing Fatha (Khari Zabar: ـٰ)", page_start: 29, page_end: 29 },
      { title: "L12: Standing Fatha Words", desc: "29 Practice Words with Standing Fatha", page_start: 30, page_end: 30 },
      { title: "L12: Standing Kasra", desc: "Standing Kasra (Khari Zer: ـٖ)", page_start: 31, page_end: 31 },
      { title: "L12: Standing Kasra Words", desc: "28 Practice Words with Standing Kasra", page_start: 32, page_end: 32 },
      { title: "L12: Inverted Damma", desc: "Inverted Damma (Ulta Pesh: ـٗ)", page_start: 33, page_end: 33 },
      { title: "L12: Inverted Damma Words", desc: "29 Practice Words with Inverted Damma", page_start: 34, page_end: 34 },
      { title: "L13: Rules of Laam (Allah)", desc: "Lafz-e-Jalalah Allah: Bold vs Light", page_start: 35, page_end: 35 },
      { title: "L14: Rules of Raa", desc: "Tafkheem (Thick) & Tarkeeq (Thin) Rules", page_start: 36, page_end: 36 },
      { title: "L14: Rules of Raa Words", desc: "36 Practice Words with Raa Rules", page_start: 37, page_end: 37 },
      { title: "L15: Izhaar Halqi", desc: "Clear Throat Letters (ء هـ ع ح غ خ)", page_start: 38, page_end: 38 },
      { title: "L15: Idghaam (Yarmaloon)", desc: "Merging: With Ghunnah & Without Ghunnah", page_start: 39, page_end: 39 },
      { title: "L15: Iqlaab into Meem", desc: "Noon Sakin/Tanween Converts into Meem before Baa", page_start: 40, page_end: 40 },
      { title: "L15: Ikhfaa Haqeeqi", desc: "15 Letters with Nasal Concealment", page_start: 41, page_end: 41 },
      { title: "L16: Rules of Meem Sakin", desc: "Idghaam, Ikhfaa & Izhaar Shafawi", page_start: 42, page_end: 42 },
      { title: "L17: Rules of Madd", desc: "Madd Asli, Muttasil, Munfasil, Lazim & Aaridh", page_start: 43, page_end: 43 },
      { title: "L17: Madd Practice Words", desc: "24 Practice Words with Elongation Marks", page_start: 44, page_end: 44 },
      { title: "L18: Muqatta'at Letters", desc: "14 Mystic Surah Openings with Madd Lazim", page_start: 45, page_end: 45 },
      { title: "L19: Rules of Noon-e-Qutni", desc: "Connecting Tanween with Hamzat-ul-Wasl", page_start: 46, page_end: 46 },
      { title: "L20: Silent Letters", desc: "Silent Letters & Quranic Reading Exceptions", page_start: 47, page_end: 47 },
      { title: "L21: Waqf & Stopping Signs", desc: "Quranic Punctuation Symbols & Stop Rules", page_start: 48, page_end: 48 },
      { title: "L22: Wudhu & Salah Guide", desc: "Practical Ablution Steps & Daily Prayer Recitations", page_start: 49, page_end: 49 }
    ]
  },
  {
    id: "noorani-qaida",
    title: "Noorani Qaida (Complete)",
    title_ar: "القاعدة النورانية",
    category: "qaida",
    category_label: "Qaida & Primers",
    author: "Sheikh Noor Muhammad Ludhianvi",
    edition: "Standard Academy Edition",
    total_pages: 32,
    cover_bg: "from-emerald-800 via-teal-900 to-slate-900",
    cover_icon: "fa-solid fa-book-open",
    description: "The fundamental primer for Quranic recitation. Covers all 12 core Takhtis from single letters (Mufradat) to compound letters, Harakat, Tanween, Maddah, Sukoon, and Tashdeed.",
    chapters: QAIDA_TAKHTIS.map(t => ({ title: t.title, desc: t.sub, page_start: t.num, page_end: t.num }))
  },
  {
    id: "holy-quran-16-line",
    title: "The Holy Quran (16-Line Tajweed)",
    title_ar: "الْقُرْآنُ الْكَرِيم",
    category: "quran",
    category_label: "The Holy Quran",
    author: "Mushaf Al-Madinah",
    edition: "Complete 30 Paras (Juz)",
    total_paras: 30,
    total_pages: 548,
    cover_bg: "from-amber-900 via-stone-900 to-slate-950",
    cover_icon: "fa-solid fa-book-quran",
    description: "Authentic 16-line South Asian & International Tajweed Mushaf layout covering all 30 Paras from Alif-Lam-Meem to Amma.",
    paras: Array.from({ length: 30 }, (_, i) => ({
      para: i + 1,
      page_start: i * 18 + 1,
      page_end: (i + 1) * 18,
      name_ar: `الجزء ${i + 1}`,
      name_ur: `پارہ ${i + 1}`
    }))
  },
  {
    id: "tafseer-ibn-kathir-english",
    title: "Tafseer Ibn Kathir (English)",
    title_ar: "تفسير ابن كثير",
    category: "tafseer",
    content_type: "tafseer",
    language: "en",
    language_label: "English",
    category_label: "Tafseer & Translation",
    author: "Hafiz Ibn Kathir",
    edition: "English Commentary Edition",
    total_paras: 30,
    total_pages: 548,
    cover_bg: "from-sky-900 via-indigo-950 to-slate-900",
    cover_icon: "fa-solid fa-book-atlas",
    description: "Authentic verse-by-verse Quranic commentary by Hafiz Ibn Kathir in the English language with contextual historical analysis.",
    paras: Array.from({ length: 30 }, (_, i) => ({
      para: i + 1,
      page_start: i * 18 + 1,
      page_end: (i + 1) * 18,
      name_en: QURAN_PARAS_INFO[i]?.name_en || `Para ${i + 1}`,
      name_ur: QURAN_PARAS_INFO[i]?.name_ur || `پارہ ${i + 1}`
    }))
  },
  {
    id: "tafseer-bayan-ul-quran-urdu",
    title: "Tafseer Bayan-ul-Quran (Urdu)",
    title_ar: "بيان القرآن - مولانا أشرف علي تھانوي",
    category: "tafseer",
    content_type: "tafseer",
    language: "ur",
    language_label: "Urdu",
    category_label: "Tafseer & Translation",
    author: "Maulana Ashraf Ali Thanwi",
    edition: "Standard Urdu Commentary",
    total_paras: 30,
    total_pages: 548,
    cover_bg: "from-emerald-900 via-teal-950 to-slate-900",
    cover_icon: "fa-solid fa-book-bookmark",
    description: "Renowned Urdu Tafseer explaining subtle linguistic nuances, Fiqh guidance, and spiritual wisdom across all 30 Paras.",
    paras: Array.from({ length: 30 }, (_, i) => ({
      para: i + 1,
      page_start: i * 18 + 1,
      page_end: (i + 1) * 18,
      name_en: QURAN_PARAS_INFO[i]?.name_en || `Para ${i + 1}`,
      name_ur: QURAN_PARAS_INFO[i]?.name_ur || `پارہ ${i + 1}`
    }))
  },
  {
    id: "namaz-wudu-guide",
    title: "Illustrated Namaz, Wudu & Duas",
    title_ar: "تعليم الصلاة والوضوء",
    category: "essentials",
    category_label: "Islamic Essentials",
    author: "Al-Huda Academic Board",
    edition: "Illustrated Student Edition",
    total_pages: 24,
    cover_bg: "from-teal-900 via-emerald-950 to-slate-900",
    cover_icon: "fa-solid fa-hands-praying",
    description: "Step-by-step practical guide for Wudu, 5 daily prayers (Salah), conditions, Sunnahs, and essential Masnoon Duas with transliteration.",
    chapters: [
      { title: "Method of Wudu & Purification", page_start: 1, page_end: 6 },
      { title: "Conditions of Salah (Shurut-us-Salah)", page_start: 7, page_end: 12 },
      { title: "Step-by-Step Practical Salah", page_start: 13, page_end: 18 },
      { title: "Essential Daily Masnoon Duas", page_start: 19, page_end: 24 }
    ]
  }
];

// Storage Helpers
function getCustomBooks() {
  try {
    return JSON.parse(localStorage.getItem('alhuda_custom_books') || '[]');
  } catch(e) {
    return [];
  }
}

function saveCustomBooks(books) {
  try {
    localStorage.setItem('alhuda_custom_books', JSON.stringify(books));
  } catch(e) {}
}

function getDeletedBookIds() {
  try {
    return JSON.parse(localStorage.getItem('alhuda_deleted_books') || '[]');
  } catch(e) {
    return [];
  }
}

function saveDeletedBookIds(ids) {
  try {
    localStorage.setItem('alhuda_deleted_books', JSON.stringify(ids));
  } catch(e) {}
  try {
    if (typeof db !== 'undefined' && db && typeof db.from === 'function') {
      db.from('system_settings').upsert({
        id: 'SYS-DELETED-BOOKS',
        key: 'alhuda_deleted_books',
        value: JSON.stringify(ids),
        updated_at: new Date().toISOString()
      }).catch(err => console.warn('[CurriculumData] Sync deleted books notice:', err));
    }
  } catch(e) {}
}

function getAllAvailableBooks() {
  const custom = getCustomBooks();
  const standard = Array.isArray(ALHUDA_CURRICULUM) ? ALHUDA_CURRICULUM : [];
  const deleted = getDeletedBookIds();
  const merged = [...custom];
  standard.forEach(b => {
    if (!merged.some(m => m.id === b.id) && !deleted.includes(b.id)) {
      merged.push(b);
    }
  });
  return merged.filter(b => !deleted.includes(b.id));
}

// Helper to look up a book by ID
function getCurriculumBook(bookId) {
  const all = getAllAvailableBooks();
  return all.find(b => b.id === bookId) || null;
}

// Master curriculum wrapper object supporting all naming conventions
const CURRICULUM_DATA = {
  get books() {
    return getAllAvailableBooks();
  },
  parasInfo: QURAN_PARAS_INFO,
  getBookParaPages: getBookParaPages,
  getPageUrl: function(bookId, pageNum, paraNum = null, language = null) {
    const b = getCurriculumBook(bookId);
    if (!b) return '';
    if (typeof b.getPageUrl === 'function') return b.getPageUrl(pageNum, paraNum, language);

    const isParaBased = (b.category === 'quran' || b.category === 'tafseer' || !!b.paras_data || !!b.paras);
    if (isParaBased && paraNum) {
      const paraPages = getBookParaPages(b, paraNum);
      const idx = (Number(pageNum) || 1) - 1;
      if (paraPages && paraPages[idx]) {
        return paraPages[idx];
      }
    }

    if (b.pages && b.pages[(Number(pageNum) || 1) - 1]) {
      return b.pages[(Number(pageNum) || 1) - 1];
    }

    return generateDynamicSvgDataUri(b, pageNum, paraNum, language);
  },
  generateDynamicSvgPage: function(book, pageNum, paraNum = null, language = null) {
    return generateDynamicSvgDataUri(book, pageNum, paraNum, language);
  }
};

// Export to window for browser access
if (typeof window !== 'undefined') {
  window.QAIDA_TAKHTIS = QAIDA_TAKHTIS;
  window.QURAN_PARAS_INFO = QURAN_PARAS_INFO;
  window.ALHUDA_CURRICULUM = ALHUDA_CURRICULUM;
  window.CURRICULUM_DATA = CURRICULUM_DATA;
  window.getCurriculumBook = getCurriculumBook;
  window.getBookParaPages = getBookParaPages;
  window.generateDynamicSvgDataUri = generateDynamicSvgDataUri;
  window.getCustomBooks = getCustomBooks;
  window.saveCustomBooks = saveCustomBooks;
  window.getDeletedBookIds = getDeletedBookIds;
  window.saveDeletedBookIds = saveDeletedBookIds;
  window.getAllAvailableBooks = getAllAvailableBooks;
}
