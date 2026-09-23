/**
 * Al-Huda Islamic Centre LMS — Digital Curriculum & Course Material Registry
 * Custom Academy Library (Pre-existing default books removed completely)
 */

// Vector SVG Data URI generator for instant, 100% offline, zero-network-failure rendering
function generateDynamicSvgDataUri(book, pageNum) {
  const p = Math.max(1, Math.min(book.total_pages || book.totalPages || 32, Number(pageNum) || 1));
  const bTitle = (book.title || 'Course Material').replace(/&/g, '&amp;');
  const arTitle = (book.title_ar || book.urduTitle || 'الْقُرْآنُ الْكَرِيم').replace(/&/g, '&amp;');
  const totalP = book.total_pages || book.totalPages || 32;

  // Authentic Takhti data for Noorani Qaida
  const QAIDA_TAKHTIS = [
    { num: 1, title: "Takhti 1: Huroof-e-Mufradat (حروفِ مفردات)", sub: "Single Arabic Letters - Read from Right to Left", letters: ["ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "و", "هـ", "ء", "ي"] },
    { num: 2, title: "Takhti 2: Huroof-e-Murakkabat (حروفِ مرکبات)", sub: "Compound Letters & Joint Shapes", letters: ["لا", "با", "بلب", "كعب", "نحم", "يست", "بنت", "ثبت", "يس", "طع", "عج", "فج", "قن", "كم", "لم", "نم"] },
    { num: 3, title: "Takhti 3: Huroof-e-Muqatta'at (حروفِ مقطعات)", sub: "Mysterious Opening Letters in Holy Quran", letters: ["الم", "الر", "المر", "المص", "طسم", "طه", "طس", "يس", "حم", "حم عسق", "كهيعص", "ص", "ق", "ن"] },
    { num: 4, title: "Takhti 4: Harakat (حركات: زبر، زیر، پیش)", sub: "Short Vowels: Fatha (a), Kasra (i), Damma (u)", letters: ["اَ", "اِ", "اُ", "بَ", "بِ", "بُ", "تَ", "تِ", "تُ", "ثَ", "ثِ", "ثُ", "جَ", "جِ", "جُ", "حَ", "حِ", "حُ"] },
    { num: 5, title: "Tanween (تنوين: دو زبر، دو زیر، دو پیش)", sub: "Double Vowels with Noon Sakin Sound", letters: ["اmodeً", "اٍ", "اٌ", "بً", "بٍ", "بٌ", "تً", "تٍ", "تٌ", "ثً", "ثٍ", "ثٌ", "جً", "جٍ", "جٌ", "دً", "دٍ", "دٌ"] },
    { num: 6, title: "Takhti 6: Mashq Harakat o Tanween (مشق حركات و تنوین)", sub: "Practice Words with Short & Double Vowels", letters: ["أَبَدًا", "أَحَدٌ", "أَخَذَ", "بَلَدٍ", "حَسَدَ", "خَلَقَ", "ذَكَرَ", "رَفَعَ", "سَفَرَةٍ", "صُحُفًا", "طَبَقًا", "عَدَسِهَا"] },
    { num: 7, title: "Takhti 7: Khari Zabar, Khari Zer, Ulta Pesh (کھڑی حرکات)", sub: "Standing Vowels (Equivalent to 1 Alif)", letters: ["بٰ", "بٖ", "بٗ", "تٰ", "تٖ", "تٗ", "ثٰ", "ثٖ", "ثٗ", "جٰ", "جٖ", "جٗ", "دٰ", "دٖ", "دٗ", "رٰ", "رٖ", "رٗ"] },
    { num: 8, title: "Takhti 8: Huroof-e-Maddah o Leen (حروفِ مدہ و لین)", sub: "Elongated & Soft Vowels", letters: ["بَا", "بُوْ", "بِيْ", "بَوْ", "بَيْ", "تَا", "تُوْ", "تِيْ", "تَوْ", "تَيْ", "ثَا", "ثُوْ", "ثِيْ", "جَا", "جُوْ", "جِيْ"] },
    { num: 9, title: "Takhti 9: Mashq Maddah o Leen (مشق مدہ و لین)", sub: "Word Practice with Madd & Leen Letters", letters: ["جَاءَ", "جِيءَ", "سُوْءَ", "خَوْفٌ", "بَيْتٌ", "قَوْمٌ", "صَيْفٌ", "يَوْمٌ", "فِيْهِ", "تُوْبُوْا", "قَالُوْا", "كِيْلَ"] },
    { num: 10, title: "Takhti 10: Sukoon / Jazm (سکون / جزم)", sub: "Silent Resting Mark Pronunciation", letters: ["أَبْ", "أَتْ", "أَثْ", "إِبْ", "إِتْ", "إِثْ", "أُبْ", "أُتْ", "أُثْ", "يَقْرَأُ", "تَعْلَمُوْنَ", "يَفْعَلُوْنَ", "نَعْبُدُ", "نَسْتَعِيْنُ"] },
    { num: 11, title: "Takhti 11: Tashdeed (تشدید / مشدد)", sub: "Doubled Emphasized Letters", letters: ["أَبَّ", "أَبِّ", "أَبُّ", "إِبَّ", "إِبِّ", "إِبُّ", "أُبَّ", "أُبِّ", "أُبُّ", "حَقَّ", "رَبِّ", "مَدَّ", "عَمَّ", "إِنَّ"] },
    { num: 12, title: "Takhti 12: Ahkam-e-Waqf o Rasm-ul-Khat (احکامِ وقف)", sub: "Stopping Rules and Quranic Orthography", letters: ["مـ (لازم)", "ط (مطلق)", "ج (جائز)", "ز (مجوز)", "ص (مرخص)", "قف (وقف)", "لا (عدم وقف)", "۝ (آیت مکمل)"] }
  ];

  let bodyContent = `
    <g transform="translate(50, 150)">
      <rect width="600" height="710" rx="16" fill="#ffffff" stroke="#c5a880" stroke-width="2"/>
      <rect x="15" y="15" width="570" height="680" rx="12" fill="none" stroke="#e2e8f0" stroke-width="1"/>
      
      <text x="300" y="70" font-family="'Amiri', serif" font-size="28" font-weight="bold" fill="#047857" text-anchor="middle" direction="rtl">${arTitle}</text>
      <text x="300" y="105" font-family="sans-serif" font-size="16" font-weight="bold" fill="#d97706" text-anchor="middle">${bTitle}</text>
      <line x1="60" y1="130" x2="540" y2="130" stroke="#c5a880" stroke-width="1.5" stroke-dasharray="6,4"/>

      <!-- Content Outline Card -->
      <g transform="translate(40, 160)">
        <rect width="520" height="120" rx="12" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>
        <text x="30" y="40" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0f172a">Lesson Overview &amp; Guidance</text>
        <text x="30" y="70" font-family="sans-serif" font-size="12" fill="#475569">Section: Page ${p} of ${totalP}</text>
        <text x="30" y="95" font-family="sans-serif" font-size="12" fill="#047857" font-weight="600">Al-Huda Islamic Centre &bull; Course Material</text>
      </g>

      <!-- Visual Icon Graphic -->
      <circle cx="300" cy="400" r="70" fill="#ecfdf5" stroke="#10b981" stroke-width="3"/>
      <text x="300" y="415" font-family="'Amiri', serif" font-size="44" font-weight="bold" fill="#047857" text-anchor="middle">📖</text>

      <!-- Teaching Tips -->
      <g transform="translate(40, 520)">
        <rect width="520" height="130" rx="12" fill="#fefce8" stroke="#fef08a" stroke-width="1.5"/>
        <text x="30" y="35" font-family="sans-serif" font-size="13" font-weight="bold" fill="#854d0e">Course Material Guidance:</text>
        <text x="30" y="65" font-family="sans-serif" font-size="12" fill="#713f12">&bull; Focus on precise recitation and teacher instructions.</text>
        <text x="30" y="90" font-family="sans-serif" font-size="12" fill="#713f12">&bull; Practice daily lesson exercises with your assigned instructor.</text>
        <text x="30" y="115" font-family="sans-serif" font-size="12" fill="#713f12">&bull; Review progress using the interactive LMS digital reader.</text>
      </g>
    </g>
  `;

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

// Master standard curriculum array is now completely emptied out.
// Only materials added by the user / academy will exist in the LMS.
const ALHUDA_CURRICULUM = [];

// Helper to look up a book by ID
function getCurriculumBook(bookId) {
  if (typeof getCustomBooks === 'function') {
    const custom = getCustomBooks();
    const found = custom.find(b => b.id === bookId);
    if (found) return found;
  }
  return ALHUDA_CURRICULUM.find(b => b.id === bookId) || null;
}

// Master curriculum wrapper object supporting all naming conventions
const CURRICULUM_DATA = {
  books: ALHUDA_CURRICULUM,
  getPageUrl: function(bookId, pageNum) {
    const b = getCurriculumBook(bookId);
    if (!b) return '';
    if (typeof b.getPageUrl === 'function') return b.getPageUrl(pageNum);
    return generateDynamicSvgDataUri(b, pageNum);
  },
  generateDynamicSvgPage: function(book, pageNum) {
    return generateDynamicSvgDataUri(book, pageNum);
  }
};

// Export to window for browser access
if (typeof window !== 'undefined') {
  window.ALHUDA_CURRICULUM = ALHUDA_CURRICULUM;
  window.CURRICULUM_DATA = CURRICULUM_DATA;
  window.getCurriculumBook = getCurriculumBook;
  window.generateDynamicSvgDataUri = generateDynamicSvgDataUri;
}
