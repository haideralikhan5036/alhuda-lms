/**
 * Al-Huda Islamic Centre LMS — Digital Curriculum & Course Material Registry
 * Comprehensive multi-lingual Islamic library with pre-indexed pages, chapters, and metadata.
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
    { num: 5, title: "Takhti 5: Tanween (تنوين: دو زبر، دو زیر، دو پیش)", sub: "Double Vowels with Noon Sakin Sound", letters: ["اmodeً", "اٍ", "اٌ", "بً", "بٍ", "بٌ", "تً", "تٍ", "تٌ", "ثً", "ثٍ", "ثٌ", "جً", "جٍ", "جٌ", "دً", "دٍ", "دٌ"] },
    { num: 6, title: "Takhti 6: Mashq Harakat o Tanween (مشق حركات و تنوین)", sub: "Practice Words with Short & Double Vowels", letters: ["أَبَدًا", "أَحَدٌ", "أَخَذَ", "بَلَدٍ", "حَسَدَ", "خَلَقَ", "ذَكَرَ", "رَفَعَ", "سَفَرَةٍ", "صُحُفًا", "طَبَقًا", "عَدَسِهَا"] },
    { num: 7, title: "Takhti 7: Khari Zabar, Khari Zer, Ulta Pesh (کھڑی حرکات)", sub: "Standing Vowels (Equivalent to 1 Alif)", letters: ["بٰ", "بٖ", "بٗ", "تٰ", "تٖ", "تٗ", "ثٰ", "ثٖ", "ثٗ", "جٰ", "جٖ", "جٗ", "دٰ", "دٖ", "دٗ", "رٰ", "رٖ", "رٗ"] },
    { num: 8, title: "Takhti 8: Huroof-e-Maddah o Leen (حروفِ مدہ و لین)", sub: "Elongated & Soft Vowels", letters: ["بَا", "بُوْ", "بِيْ", "بَوْ", "بَيْ", "تَا", "تُوْ", "تِيْ", "تَوْ", "تَيْ", "ثَا", "ثُوْ", "ثِيْ", "جَا", "جُوْ", "جِيْ"] },
    { num: 9, title: "Takhti 9: Mashq Maddah o Leen (مشق مدہ و لین)", sub: "Word Practice with Madd & Leen Letters", letters: ["جَاءَ", "جِيءَ", "سُوْءَ", "خَوْفٌ", "بَيْتٌ", "قَوْمٌ", "صَيْفٌ", "يَوْمٌ", "فِيْهِ", "تُوْبُوْا", "قَالُوْا", "كِيْلَ"] },
    { num: 10, title: "Takhti 10: Sukoon / Jazm (سکون / جزم)", sub: "Silent Resting Mark Pronunciation", letters: ["أَبْ", "أَتْ", "أَثْ", "إِبْ", "إِتْ", "إِثْ", "أُبْ", "أُتْ", "أُثْ", "يَقْرَأُ", "تَعْلَمُوْنَ", "يَفْعَلُوْنَ", "نَعْبُدُ", "نَسْتَعِيْنُ"] },
    { num: 11, title: "Takhti 11: Tashdeed (تشدید / مشدد)", sub: "Doubled Emphasized Letters", letters: ["أَبَّ", "أَبِّ", "أَبُّ", "إِبَّ", "إِبِّ", "إِبُّ", "أُبَّ", "أُبِّ", "أُبُّ", "حَقَّ", "رَبِّ", "مَدَّ", "عَمَّ", "إِنَّ"] },
    { num: 12, title: "Takhti 12: Ahkam-e-Waqf o Rasm-ul-Khat (احکامِ وقف)", sub: "Stopping Symbols and Rules", letters: ["مـ (لازم)", "ط (مطلق)", "ج (جائز)", "ز (مجوز)", "ص (مرخص)", "قف (وقف)", "لا (عدم وقف)", "۝ (آیت مکمل)"] }
  ];

  let bodyContent = '';

  if (book.category === 'qaida') {
    const takhtiIdx = Math.min(QAIDA_TAKHTIS.length - 1, Math.floor(((p - 1) / totalP) * QAIDA_TAKHTIS.length));
    const currentTakhti = QAIDA_TAKHTIS[takhtiIdx];
    const letters = currentTakhti.letters;

    bodyContent = `
      <!-- Takhti Title Banner -->
      <g transform="translate(50, 150)">
        <rect width="600" height="64" rx="14" fill="#047857" opacity="0.95"/>
        <text x="300" y="32" font-family="'Amiri', 'Traditional Arabic', serif" font-size="20" font-weight="bold" fill="#fef08a" text-anchor="middle" direction="rtl">${currentTakhti.title}</text>
        <text x="300" y="52" font-family="sans-serif" font-size="11" font-weight="600" fill="#ffffff" text-anchor="middle">${currentTakhti.sub}</text>
      </g>

      <!-- Letters Grid -->
      <g transform="translate(50, 235)">
        ${letters.slice(0, 16).map((letter, i) => {
          const row = Math.floor(i / 4);
          const col = 3 - (i % 4); // Right to left display
          const x = col * 152;
          const y = row * 145;
          return `
            <g transform="translate(${x}, ${y})">
              <rect width="144" height="135" rx="16" fill="#ffffff" stroke="#c5a880" stroke-width="2" filter="drop-shadow(0 4px 6px rgba(0,0,0,0.06))"/>
              <rect x="4" y="4" width="136" height="127" rx="12" fill="none" stroke="#e2e8f0" stroke-width="1"/>
              <text x="72" y="86" font-family="'Amiri', 'Traditional Arabic', 'Scheherazade', serif" font-size="46" font-weight="bold" fill="#0f172a" text-anchor="middle">${letter}</text>
              <circle cx="72" cy="120" r="3" fill="#d97706"/>
            </g>
          `;
        }).join('')}
      </g>
    `;
  } else if (book.category === 'quran') {
    bodyContent = `
      <!-- Bismillah Header -->
      <g transform="translate(50, 145)">
        <rect width="600" height="60" rx="14" fill="#064e3b" stroke="#c5a880" stroke-width="2"/>
        <text x="300" y="38" font-family="'Amiri', serif" font-size="24" font-weight="bold" fill="#fef08a" text-anchor="middle" direction="rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</text>
      </g>

      <!-- Quran 15/16-Line Rules Stage -->
      <g transform="translate(50, 220)">
        <rect width="600" height="640" rx="16" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
        ${Array.from({ length: 15 }, (_, i) => {
          const y = (i + 1) * 40;
          return `
            <line x1="20" y1="${y}" x2="580" y2="${y}" stroke="#f1f5f9" stroke-width="1.5"/>
            <text x="560" y="${y - 12}" font-family="'Amiri', serif" font-size="21" fill="#0f172a" text-anchor="end" direction="rtl">
              ${i % 2 === 0 ? 'ذَٰلِكَ الْكِتَابُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ ۝' : 'الَّذِينَ يُؤْمِنُونَ بِالْغَيْبِ وَيُقِيمُونَ الصَّلَاةَ وَمِمَّا رَزَقْنَاهُمْ يُنفِقُونَ ۝'}
            </text>
          `;
        }).join('')}
      </g>
    `;
  } else {
    // General Islamic Studies / Guides
    bodyContent = `
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
          <text x="30" y="95" font-family="sans-serif" font-size="12" fill="#047857" font-weight="600">Al-Huda Islamic Centre &bull; Authorized Curriculum Edition</text>
        </g>

        <!-- Visual Icon Graphic -->
        <circle cx="300" cy="400" r="70" fill="#ecfdf5" stroke="#10b981" stroke-width="3"/>
        <text x="300" y="415" font-family="'Amiri', serif" font-size="44" font-weight="bold" fill="#047857" text-anchor="middle">📖</text>

        <!-- Teaching Tips -->
        <g transform="translate(40, 520)">
          <rect width="520" height="130" rx="12" fill="#fefce8" stroke="#fef08a" stroke-width="1.5"/>
          <text x="30" y="35" font-family="sans-serif" font-size="13" font-weight="bold" fill="#854d0e">Tajweed &amp; Pronunciation Instructions:</text>
          <text x="30" y="65" font-family="sans-serif" font-size="12" fill="#713f12">&bull; Focus on precise articulation from the throat and tongue.</text>
          <text x="30" y="90" font-family="sans-serif" font-size="12" fill="#713f12">&bull; Practice holding vowels for the correct count (Harakat = 1 count, Madd = 2-4 counts).</text>
          <text x="30" y="115" font-family="sans-serif" font-size="12" fill="#713f12">&bull; Review daily with your assigned Al-Huda instructor.</text>
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
        <text x="20" y="28" font-family="sans-serif" font-size="11" font-weight="bold" fill="#64748b">Verified Al-Huda Academy Curriculum</text>
        <rect x="255" y="10" width="90" height="28" rx="8" fill="#047857"/>
        <text x="300" y="28" font-family="'Amiri', serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">صفحہ ${p} / ${totalP}</text>
        <text x="580" y="28" font-family="sans-serif" font-size="11" font-weight="bold" fill="#d97706" text-anchor="end">&copy; Beacon Quran Institute</text>
      </g>
    </svg>
  `.trim();

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgXml);
}

const ALHUDA_CURRICULUM = [
  // ============================================================
  // 1. QAIDA & PRIMERS (ابتدائی بنیادی کتب)
  // ============================================================
  {
    id: 'noorani-qaida-classic',
    title: 'Noorani Qaida (Classic)',
    title_ar: 'القاعدة النورانية (عربي و اردو)',
    urduTitle: 'القاعدة النورانية (عربي و اردو)',
    category: 'qaida',
    category_label: 'Qaida & Primers',
    categoryLabel: 'Qaida & Primers',
    edition: 'Standard Qari Raheem Bakhsh / Furqania Edition',
    description: 'Foundational primer for Arabic phonetics, tajweed rules, and Quran reading with Urdu/Arabic instructions.',
    total_pages: 32,
    totalPages: 32,
    badge_color: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    cover_icon: 'fa-solid fa-book-open-reader',
    cover_bg: 'from-emerald-700 to-teal-900',
    chapters: [
      { page_start: 1, page_end: 3, title: 'Takhti 1: Huroof-e-Mufradat (حروفِ مفردات)', desc: 'Individual Arabic Alphabet from Alif to Yaa' },
      { page_start: 4, page_end: 6, title: 'Takhti 2: Huroof-e-Murakkabat (حروفِ مرکبات)', desc: 'Compound Arabic Letters & Joining Forms' },
      { page_start: 7, page_end: 8, title: 'Takhti 3: Huroof-e-Muqatta\'at (حروفِ مقطعات)', desc: 'Mysterious Quranic Opening Letters' },
      { page_start: 9, page_end: 11, title: 'Takhti 4: Harakat (حركات: زبر، زیر، پیش)', desc: 'Short Vowels (Fathah, Kasrah, Dammah)' },
      { page_start: 12, page_end: 14, title: 'Takhti 5: Tanween (تنوين: دو زبر، دو زیر، دو پیش)', desc: 'Double Vowels with Noon Sakin Sound' },
      { page_start: 15, page_end: 17, title: 'Takhti 6: Mashq Harakat o Tanween (مشق حركات و تنوین)', desc: 'Word Practice for Short & Double Vowels' },
      { page_start: 18, page_end: 20, title: 'Takhti 7: Khari Zabar, Khari Zer, Ulta Pesh (کھڑی حرکات)', desc: 'Standing / Vertical Vowels' },
      { page_start: 21, page_end: 23, title: 'Takhti 8: Huroof-e-Maddah o Leen (حروفِ مدہ و لین)', desc: 'Elongated Vowels (Alif, Waw, Yaa) & Soft Vowels' },
      { page_start: 24, page_end: 26, title: 'Takhti 9: Mashq Maddah o Leen (مشق مدہ و لین)', desc: 'Cumulative Word Mastery Exercise' },
      { page_start: 27, page_end: 28, title: 'Takhti 10: Sukoon / Jazm (سکون / جزم)', desc: 'Silent Letters & Connected Pronunciation' },
      { page_start: 29, page_end: 30, title: 'Takhti 11: Tashdeed (تشدید / مشدد)', desc: 'Doubled Letters & Emphasis Rules' },
      { page_start: 31, page_end: 32, title: 'Takhti 12: Ahkam-e-Waqf o Rasm-ul-Khat (احکامِ وقف)', desc: 'Stopping Rules and Quranic Orthography' }
    ],
    getPageUrl: function(pageNum) {
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum) || 1));
      return `https://archive.org/download/noorani-qaida_202401/page/n${p}.jpg`;
    },
    getFallbackPageUrl: function(pageNum) {
      return generateDynamicSvgDataUri(this, pageNum);
    }
  },
  {
    id: 'noorani-qaida-english',
    title: 'English Noorani Qaida',
    title_ar: 'القاعدة النورانية بالإنجليزية',
    urduTitle: 'القاعدة النورانية بالإنجليزية',
    category: 'qaida',
    category_label: 'Qaida & Primers',
    categoryLabel: 'Qaida & Primers',
    edition: 'International Diaspora Edition with English Rules & Phonics',
    description: 'Designed specifically for UK, US, and European students with English tajweed rules, phonetic guides, and transliterations.',
    total_pages: 32,
    totalPages: 32,
    badge_color: 'bg-blue-100 text-blue-800 border-blue-300',
    cover_icon: 'fa-solid fa-language',
    cover_bg: 'from-blue-700 to-indigo-900',
    chapters: [
      { page_start: 1, page_end: 3, title: 'Lesson 1: The Arabic Alphabet (Single Letters)', desc: 'Pronunciation Points (Makharij) in English' },
      { page_start: 4, page_end: 6, title: 'Lesson 2: Compound Letters (Murakkabat)', desc: 'Recognizing Initial, Medial & Final Shapes' },
      { page_start: 7, page_end: 8, title: 'Lesson 3: Disjointed Letters (Muqatta\'at)', desc: 'Prolonged Sounds in Quran Openings' },
      { page_start: 9, page_end: 11, title: 'Lesson 4: Short Vowels (Harakat)', desc: 'Fathah (a), Kasrah (i), and Dammah (u)' },
      { page_start: 12, page_end: 14, title: 'Lesson 5: Tanween (Double Vowels - an, in, un)', desc: 'Nunation & Nasalization Basics' },
      { page_start: 15, page_end: 17, title: 'Lesson 6: Combination Exercises', desc: 'Connecting Consonants with Vowels' },
      { page_start: 18, page_end: 20, title: 'Lesson 7: Standing Vowels (Vertical Strokes)', desc: 'Equivalent to Maddah 1 Alif duration' },
      { page_start: 21, page_end: 23, title: 'Lesson 8: Soft Vowels (Leen: Waw & Yaa)', desc: 'Gentle Glide Pronunciation' },
      { page_start: 24, page_end: 26, title: 'Lesson 9: Intermediate Word Drills', desc: 'Practical Exercises from Quranic Words' },
      { page_start: 27, page_end: 28, title: 'Lesson 10: Sukoon / Jazm (Resting Mark)', desc: 'Stopping on a Consonant' },
      { page_start: 29, page_end: 30, title: 'Lesson 11: Tashdeed (Shaddah / Doubling)', desc: 'Pressing Firmly on the Letter' },
      { page_start: 31, page_end: 32, title: 'Lesson 12: Waqf (Pausing Rules & Endings)', desc: 'How to Stop at the End of Ayahs' }
    ],
    getPageUrl: function(pageNum) {
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum) || 1));
      return `https://archive.org/download/NooraniQaidaEnglish/page/n${p}.jpg`;
    },
    getFallbackPageUrl: function(pageNum) {
      return generateDynamicSvgDataUri(this, pageNum);
    }
  },
  {
    id: 'kids-cartoon-qaida',
    title: 'Kids Illustrated Phonics Qaida',
    title_ar: 'قاعدة الأطفال المصورة بالألوان',
    urduTitle: 'قاعدة الأطفال المصورة بالألوان',
    category: 'qaida',
    category_label: 'Qaida & Primers',
    categoryLabel: 'Qaida & Primers',
    edition: 'Child-Friendly Illustrated Visual Edition (Ages 4–8)',
    description: 'Vibrant, cartoon-illustrated Arabic alphabet with colorful memory associations, fun characters, and visual phonics for early learners.',
    total_pages: 36,
    totalPages: 36,
    badge_color: 'bg-purple-100 text-purple-800 border-purple-300',
    cover_icon: 'fa-solid fa-shapes',
    cover_bg: 'from-purple-600 via-pink-600 to-rose-700',
    chapters: [
      { page_start: 1, page_end: 6, title: 'Fun Alphabet Jungle: Letters Alif to Khaa', desc: 'Illustrated with Friendly Animals & Objects' },
      { page_start: 7, page_end: 12, title: 'Fun Alphabet Jungle: Letters Daal to Saad', desc: 'Bright Colors & Memory Rhymes' },
      { page_start: 13, page_end: 18, title: 'Fun Alphabet Jungle: Letters Daad to Kaaf', desc: 'Pronunciation with Character Sounds' },
      { page_start: 19, page_end: 24, title: 'Fun Alphabet Jungle: Letters Laam to Yaa', desc: 'Final Alphabet Mastery Celebration' },
      { page_start: 25, page_end: 30, title: 'The Friendly Dots & Shapes Game', desc: 'Spotting 1 Dot, 2 Dots, and 3 Dots' },
      { page_start: 31, page_end: 36, title: 'First Steps: Joining Friendly Letters', desc: 'Baby Words & Easy Sound Blends' }
    ],
    getPageUrl: function(pageNum) {
      return generateDynamicSvgDataUri(this, pageNum);
    },
    getFallbackPageUrl: function(pageNum) {
      return generateDynamicSvgDataUri(this, pageNum);
    }
  },

  // ============================================================
  // 2. THE HOLY QURAN (قرآن مجید)
  // ============================================================
  {
    id: 'quran-16-line',
    title: 'Quran Majeed (16-Line Tajweed Indo-Pak)',
    title_ar: 'القرآن الكريم (١٦ سطر برواية حفص - ملون التجويد)',
    urduTitle: 'قرآن مجید ۱۶ سطر (تجوید کلر کوڈڈ)',
    category: 'quran',
    category_label: 'The Holy Quran',
    categoryLabel: 'The Holy Quran',
    edition: 'Standard Subcontinent / UK Tajweed Academy Edition',
    description: 'Standard 16-line Mushaf widely used across Pakistan, India, UK & North America. Features color-coded Tajweed rules for Nazra and Hifz.',
    total_pages: 604,
    totalPages: 604,
    total_paras: 30,
    badge_color: 'bg-emerald-100 text-brandDark border-emerald-400',
    cover_icon: 'fa-solid fa-book-quran',
    cover_bg: 'from-[#022c22] via-[#064e3b] to-[#047857]',
    paras: [
      { para: 1, name_ar: 'الم (آلم)', name_ur: 'الم', page_start: 1, page_end: 21 },
      { para: 2, name_ar: 'سيقول (سيقول)', name_ur: 'سیقول', page_start: 22, page_end: 41 },
      { para: 3, name_ar: 'تلك الرسل (تلك الرسل)', name_ur: 'تلک الرسل', page_start: 42, page_end: 61 },
      { para: 4, name_ar: 'لن تنالوا (لن تنالوا)', name_ur: 'لن تنالوا', page_start: 62, page_end: 81 },
      { para: 5, name_ar: 'والمحصنات (والمحصنات)', name_ur: 'والمحصنات', page_start: 82, page_end: 101 },
      { para: 6, name_ar: 'لا يحب الله (لا یحب اللہ)', name_ur: 'لا یحب اللہ', page_start: 102, page_end: 121 },
      { para: 7, name_ar: 'وإذا سمعوا (واذا سمعوا)', name_ur: 'واذا سمعوا', page_start: 122, page_end: 141 },
      { para: 8, name_ar: 'ولو أننا (ولو اننا)', name_ur: 'ولو اننا', page_start: 142, page_end: 161 },
      { para: 9, name_ar: 'قال الملأ (قال الملاء)', name_ur: 'قال الملاء', page_start: 162, page_end: 181 },
      { para: 10, name_ar: 'واعلموا (واعلموا)', name_ur: 'واعلموا', page_start: 182, page_end: 201 },
      { para: 11, name_ar: 'يعتذرون (یعتذرون)', name_ur: 'یعتذرون', page_start: 202, page_end: 221 },
      { para: 12, name_ar: 'وما من دابة (وما من دابۃ)', name_ur: 'وما من دابۃ', page_start: 222, page_end: 241 },
      { para: 13, name_ar: 'وما أبرئ (وما ابرئ)', name_ur: 'وما ابرئ', page_start: 242, page_end: 261 },
      { para: 14, name_ar: 'ربما (ربما)', name_ur: 'ربما', page_start: 262, page_end: 281 },
      { para: 15, name_ar: 'سبحان الذي (سبحان الذی)', name_ur: 'سبحان الذی', page_start: 282, page_end: 301 },
      { para: 16, name_ar: 'قال ألم (قال الم)', name_ur: 'قال الم', page_start: 302, page_end: 321 },
      { para: 17, name_ar: 'اقترب (اقترب)', name_ur: 'اقترب', page_start: 322, page_end: 341 },
      { para: 18, name_ar: 'قد أفلح (قد افلح)', name_ur: 'قد افلح', page_start: 342, page_end: 361 },
      { para: 19, name_ar: 'وقال الذين (وقال الذین)', name_ur: 'وقال الذین', page_start: 362, page_end: 381 },
      { para: 20, name_ar: 'أمن خلق (امن خلق)', name_ur: 'امن خلق', page_start: 382, page_end: 401 },
      { para: 21, name_ar: 'اتل ما أوحي (اتل ما اوحی)', name_ur: 'اتل ما اوحی', page_start: 402, page_end: 421 },
      { para: 22, name_ar: 'ومن يقنت (ومن یقنت)', name_ur: 'ومن یقنت', page_start: 422, page_end: 441 },
      { para: 23, name_ar: 'وما لي (وما لی)', name_ur: 'وما لی', page_start: 442, page_end: 461 },
      { para: 24, name_ar: 'فمن أظلم (فمن اظلم)', name_ur: 'فمن اظلم', page_start: 462, page_end: 481 },
      { para: 25, name_ar: 'إليه يرد (الیہ یرد)', name_ur: 'الیہ یرد', page_start: 482, page_end: 501 },
      { para: 26, name_ar: 'حم (حم)', name_ur: 'حم', page_start: 502, page_end: 521 },
      { para: 27, name_ar: 'قال فما خطبكم (قال فما خطبکم)', name_ur: 'قال فما خطبکم', page_start: 522, page_end: 541 },
      { para: 28, name_ar: 'قد سمع الله (قد سمع اللہ)', name_ur: 'قد سمع اللہ', page_start: 542, page_end: 561 },
      { para: 29, name_ar: 'تبارك الذي (تبارک الذی)', name_ur: 'تبارک الذی', page_start: 562, page_end: 581 },
      { para: 30, name_ar: 'عم يتساءلون (عم یتساءلون)', name_ur: 'عم یتساءلون', page_start: 582, page_end: 604 }
    ],
    getPageUrl: function(pageNum) {
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum) || 1));
      return `https://cdn.jsdelivr.net/gh/BetimShala/quran-images-api@master/quran-images/${p}.png`;
    },
    getFallbackPageUrl: function(pageNum) {
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum) || 1));
      return `https://raw.githubusercontent.com/BetimShala/quran-images-api/master/quran-images/${p}.png`;
    }
  },
  {
    id: 'quran-15-line',
    title: 'Quran Majeed (15-Line Madani / Hafizi)',
    title_ar: 'مصحف المدينة النبوية (١٥ سطر)',
    urduTitle: 'مصحف المدينة المنورة (حفظ قرآن)',
    category: 'quran',
    category_label: 'The Holy Quran',
    categoryLabel: 'The Holy Quran',
    edition: 'King Fahd Complex / Saudi Standard Madani Script',
    description: 'The standard 604-page Madani Mushaf with crisp Uthmani calligraphy favored by international students and Huffaz.',
    total_pages: 604,
    totalPages: 604,
    total_paras: 30,
    badge_color: 'bg-teal-100 text-teal-800 border-teal-300',
    cover_icon: 'fa-solid fa-quran',
    cover_bg: 'from-teal-800 to-cyan-950',
    getPageUrl: function(pageNum) {
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum) || 1));
      return `https://cdn.jsdelivr.net/gh/BetimShala/quran-images-api@master/quran-images/${p}.png`;
    },
    getFallbackPageUrl: function(pageNum) {
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum) || 1));
      return `https://raw.githubusercontent.com/BetimShala/quran-images-api/master/quran-images/${p}.png`;
    }
  },

  // ============================================================
  // 3. TAFSEER & TRANSLATIONS (ترجمہ و تفسیر)
  // ============================================================
  {
    id: 'tafseer-taqi-usmani',
    title: 'The Meanings of the Noble Qur\'an (English)',
    title_ar: 'معاني القرآن الكريم لمفتي محمد تقي عثماني',
    urduTitle: 'آسان ترجمہ قرآن مع حواشی و تفسیر (انگریزی)',
    author: 'Justice (R) Mufti Muhammad Taqi Usmani',
    category: 'tafseer',
    category_label: 'Tafseer & Translation',
    categoryLabel: 'Tafseer & Translation',
    edition: 'Authentic Contemporary English Translation & Explanatory Footnotes',
    description: 'World-renowned, idiomatic and easy-to-understand English translation and commentary by the grand scholar Mufti Muhammad Taqi Usmani.',
    total_surahs: 114,
    total_pages: 114,
    totalPages: 114,
    badge_color: 'bg-amber-100 text-amber-900 border-amber-300',
    cover_icon: 'fa-solid fa-scroll',
    cover_bg: 'from-amber-700 via-orange-800 to-amber-950',
    is_text_viewer: true,
    translation_key: 'en-taqi-usmani'
  },
  {
    id: 'tafseer-farhat-hashmi-urdu',
    title: 'Fehm-ul-Quran: Urdu Translation (Dr. Farhat Hashmi)',
    title_ar: 'فہم القرآن - ترجمہ و تفسیر ڈاکٹر فرحت ہاشمی (اردو)',
    urduTitle: 'فہم القرآن اردو ترجمہ و تفہیم',
    author: 'Dr. Farhat Hashmi (Al-Huda International)',
    category: 'tafseer',
    category_label: 'Tafseer & Translation',
    categoryLabel: 'Tafseer & Translation',
    edition: 'Official Al-Huda International Urdu Translation & Thematic Exegesis',
    description: 'Renowned worldwide for its clarity, practical everyday life applications, and heart-touching word-by-word explanation.',
    total_surahs: 114,
    total_pages: 114,
    totalPages: 114,
    badge_color: 'bg-rose-100 text-rose-900 border-rose-300',
    cover_icon: 'fa-solid fa-heart-pulse',
    cover_bg: 'from-rose-800 via-pink-900 to-purple-950',
    is_text_viewer: true,
    translation_key: 'ur-farhat-hashmi'
  },
  {
    id: 'tafseer-farhat-hashmi-english',
    title: 'Quran Comprehension in English (Dr. Farhat Hashmi)',
    title_ar: 'فہم القرآن باللغة الإنجليزية - د. فرحت ہاشمی',
    urduTitle: 'فہم القرآن انگریزی ترجمہ',
    author: 'Dr. Farhat Hashmi (Al-Huda International)',
    category: 'tafseer',
    category_label: 'Tafseer & Translation',
    categoryLabel: 'Tafseer & Translation',
    edition: 'English Thematic Translation & Reflection for Youth & Adults',
    description: 'Direct, inspiring English translation designed to build an intimate relationship with the words of Allah for English-speaking students.',
    total_surahs: 114,
    total_pages: 114,
    totalPages: 114,
    badge_color: 'bg-indigo-100 text-indigo-900 border-indigo-300',
    cover_icon: 'fa-solid fa-feather-pointed',
    cover_bg: 'from-indigo-800 to-slate-900',
    is_text_viewer: true,
    translation_key: 'en-farhat-hashmi'
  },

  // ============================================================
  // 4. HADITH COLLECTIONS (کتبِ حدیث)
  // ============================================================
  {
    id: 'hadith-mishkat',
    title: 'Mishkat al-Masabih (مشکوٰۃ المصابیح)',
    title_ar: 'مشكاة المصابيح للإمام الخطيب التبريزي',
    urduTitle: 'مشکوٰۃ المصابیح (درسِ نظامی حدیث کورس)',
    author: 'Imam Khatib al-Tabrizi (Rahimahullah)',
    category: 'hadith',
    category_label: 'Hadith Collections',
    categoryLabel: 'Hadith Collections',
    edition: 'Classical Dars-e-Nizami Master Hadith Syllabus with Urdu/English Headings',
    description: 'The monumental collection uniting Sahih al-Bukhari, Muslim, Sunan Abi Dawud, Tirmidhi, Nasa\'i, and Ibn Majah into 29 thematic chapters.',
    total_books: 29,
    total_pages: 29,
    totalPages: 29,
    badge_color: 'bg-cyan-100 text-cyan-900 border-cyan-300',
    cover_icon: 'fa-solid fa-landmark-dome',
    cover_bg: 'from-cyan-800 via-sky-900 to-slate-950',
    is_text_viewer: true,
    chapters: [
      { id: 1, title: 'Kitab-ul-Iman (کتاب الإيمان)', desc: 'Pillars of Faith, Destiny, Major Sins & Waswasah' },
      { id: 2, title: 'Kitab-ul-Ilm (کتاب العلم)', desc: 'Virtues of Knowledge, Teaching & Scholars' },
      { id: 3, title: 'Kitab-ut-Taharah (کتاب الطهارة)', desc: 'Purification, Wudu, Ghusl, Tayammum & Water' },
      { id: 4, title: 'Kitab-us-Salah (کتاب الصلاة)', desc: 'Times, Adhan, Sunnah, Congregational Prayer & Jum\'ah' },
      { id: 5, title: 'Kitab-ul-Janaiz (کتاب الجنائز)', desc: 'Funerals, Visiting the Sick, Grave & Shafa\'ah' },
      { id: 6, title: 'Kitab-uz-Zakah (کتاب الزكاة)', desc: 'Obligatory Charity, Sadaqah, Fitrah & Generosity' },
      { id: 7, title: 'Kitab-us-Sawm (کتاب الصيام)', desc: 'Ramadan, Suhur, Iftar, Itikaf & Voluntary Fasts' },
      { id: 8, title: 'Kitab-ul-Hajj (کتاب الحج)', desc: 'Ihram, Tawaf, Sa\'ee, Arafah & Umrah' },
      { id: 9, title: 'Kitab-ul-Buyu (کتاب البيوع)', desc: 'Lawful Trade, Transactions, Honesty & Usury (Riba)' },
      { id: 10, title: 'Kitab-un-Nikah (کتاب النكاح)', desc: 'Marriage, Mahr, Rights of Spouses & Family Life' },
      { id: 11, title: 'Kitab-ul-Adab (کتاب الآداب)', desc: 'Manners, Greetings, Mercy, Truthfulness & Friendship' },
      { id: 12, title: 'Kitab-ud-Da\'awat (کتاب الدعوات)', desc: 'Prayers, Istighfar, Remembrance & Protection' }
    ]
  },
  {
    id: 'hadith-nawawi-40',
    title: 'An-Nawawi\'s 40 Hadith (الاربعون النووية)',
    title_ar: 'الأربعون النووية للإمام يحيى بن شرف النووي',
    urduTitle: 'الاربعون النووية (چالیس احادیثِ نبویہ)',
    author: 'Imam Abu Zakariya Yahya ibn Sharaf al-Nawawi',
    category: 'hadith',
    category_label: 'Hadith Collections',
    categoryLabel: 'Hadith Collections',
    edition: 'Complete 42 Authentic Hadiths with Arabic Text, Urdu & English Trans.',
    description: 'Fundamental collection encapsulating the essence of Islamic creed, ethics, worship, and social responsibility.',
    total_hadith: 42,
    total_pages: 42,
    totalPages: 42,
    badge_color: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    cover_icon: 'fa-solid fa-gem',
    cover_bg: 'from-emerald-800 to-slate-900',
    is_text_viewer: true
  },

  // ============================================================
  // 5. ISLAMIC ESSENTIALS & DUAS (اسلامک سٹڈیز و مسنون دعائیں)
  // ============================================================
  {
    id: 'islamic-namaz-guide',
    title: 'Illustrated Namaz & Wudu Step-by-Step',
    title_ar: 'دليل الصلاة والوضوء المصور بالخطوات',
    urduTitle: 'تصویری نماز و وضو گائیڈ',
    category: 'essentials',
    category_label: 'Islamic Essentials',
    categoryLabel: 'Islamic Essentials',
    edition: 'Visual Step-by-Step Color Guide for Children, Beginners & Reverts',
    description: 'Clear photographic and illustrated guide covering purification, steps of Wudu, all posture movements of Salah, and essential recitations.',
    total_pages: 24,
    totalPages: 24,
    badge_color: 'bg-blue-100 text-blue-900 border-blue-300',
    cover_icon: 'fa-solid fa-person-praying',
    cover_bg: 'from-blue-800 via-teal-800 to-slate-950',
    chapters: [
      { page_start: 1, page_end: 4, title: 'Step 1: The Sunnah Wudu (Step-by-Step)', desc: 'Washing Hands, Mouth, Nose, Face, Arms, Masah & Feet' },
      { page_start: 5, page_end: 8, title: 'Step 2: Conditions of Salah & The Adhan', desc: 'Qiblah, Cleanliness, Covering Awrah & Times' },
      { page_start: 9, page_end: 14, title: 'Step 3: Standing in Prayer (Takbeer to Ruku)', desc: 'Takbeer-e-Tahreema, Thana, Surah Fatiha & Bowing' },
      { page_start: 15, page_end: 19, title: 'Step 4: Prostration to Sitting (Sajdah to Tashahhud)', desc: 'Prostration Posture, Jalsah, At-Tahiyyat & Durood' },
      { page_start: 20, page_end: 24, title: 'Step 5: Completion & Essential Daily Prayers', desc: 'Tasleem, Duas after Salah & Ayat-ul-Kursi' }
    ],
    getPageUrl: function(pageNum) {
      return generateDynamicSvgDataUri(this, pageNum);
    },
    getFallbackPageUrl: function(pageNum) {
      return generateDynamicSvgDataUri(this, pageNum);
    }
  },
  {
    id: 'islamic-hisn-ul-muslim',
    title: 'Hisn-ul-Muslim: Daily Masnoon Duas',
    title_ar: 'حصن المسلم من أذكار الكتاب والسنة',
    urduTitle: 'حصن المسلم (مستند مسنون دعائیں)',
    author: 'Dr. Sa\'id bin Ali bin Wahf al-Qahtani',
    category: 'essentials',
    category_label: 'Islamic Essentials',
    categoryLabel: 'Islamic Essentials',
    edition: 'Fortress of the Muslim: Authentic Duas with Arabic, Urdu & English',
    description: 'The golden pocketbook of Islamic supplications for everyday life — from morning azkar to protection from anxiety, sickness, and travel.',
    total_duas: 132,
    total_pages: 132,
    totalPages: 132,
    badge_color: 'bg-amber-100 text-amber-900 border-amber-300',
    cover_icon: 'fa-solid fa-hands-praying',
    cover_bg: 'from-amber-800 to-amber-950',
    is_text_viewer: true,
    chapters: [
      { id: 1, title: 'Morning & Evening Azkar (اذکار الصباح والمساء)', desc: 'Protection against all harm, morning praise' },
      { id: 2, title: 'Waking Up & Going to Sleep', desc: 'Duas before sleeping, turning in bed, waking up' },
      { id: 3, title: 'Entering & Leaving the House and Masjid', desc: 'Seeking barakah upon arrival and departure' },
      { id: 4, title: 'Food, Drink & Fasting Supplications', desc: 'Bismillah, after eating, guest prayers' },
      { id: 5, title: 'Travel & Journey Duas', desc: 'Riding a conveyance, entering a city or town' },
      { id: 6, title: 'Distress, Sickness & Anxiety Relief', desc: 'Duas for healing, curing sorrow and sadness' }
    ]
  },
  {
    id: 'tajweed-makharij-guide',
    title: 'Makharij & Tajweed Graphical Maps',
    title_ar: 'أطلس مخارج الحروف وقواعد التجويد المصور',
    urduTitle: 'مخارج الحروف تصویری نقشے',
    category: 'essentials',
    category_label: 'Islamic Essentials',
    categoryLabel: 'Islamic Essentials',
    edition: 'High-Definition Anatomical Maps of Arabic Letter Articulation Points',
    description: 'Anatomical diagrams illustrating the five main articulation points (Throat, Tongue, Lips, Nasal Cavity, Oral Void) plus Noon/Meem Sakin charts.',
    total_pages: 16,
    totalPages: 16,
    badge_color: 'bg-emerald-100 text-emerald-950 border-emerald-300',
    cover_icon: 'fa-solid fa-head-side-cough',
    cover_bg: 'from-emerald-900 via-teal-900 to-slate-900',
    chapters: [
      { page_start: 1, page_end: 4, title: 'Chart 1: Al-Jawf & Al-Halq (Throat Letters)', desc: 'Hamzah, Haa, Ayn, Haa, Ghayn, Khaa' },
      { page_start: 5, page_end: 9, title: 'Chart 2: Al-Lisan (Tongue Articulations - 18 Letters)', desc: 'Deep tongue, middle, edges and tip articulation' },
      { page_start: 10, page_end: 12, title: 'Chart 3: Ash-Shafatain & Al-Khaishoom (Lips & Nose)', desc: 'Baa, Meem, Waw, Faa & Ghunnah production' },
      { page_start: 13, page_end: 16, title: 'Chart 4: Summary Rules of Noon Sakin & Madd', desc: 'Izhar, Idgham, Iqlab, Ikhfa & Degrees of Madd' }
    ],
    getPageUrl: function(pageNum) {
      return generateDynamicSvgDataUri(this, pageNum);
    },
    getFallbackPageUrl: function(pageNum) {
      return generateDynamicSvgDataUri(this, pageNum);
    }
  }
];

// Helper to look up a book by ID
function getCurriculumBook(bookId) {
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
