/**
 * Al-Huda Islamic Centre LMS — Digital Curriculum & Course Material Registry
 * Comprehensive multi-lingual Islamic library with pre-indexed pages, chapters, and metadata.
 */

const ALHUDA_CURRICULUM = [
  // ============================================================
  // 1. QAIDA & PRIMERS (ابتدائی بنیادی کتب)
  // ============================================================
  {
    id: 'noorani-qaida-classic',
    title: 'Noorani Qaida (Classic)',
    title_ar: 'القاعدة النورانية (عربي و اردو)',
    category: 'qaida',
    category_label: 'Qaida & Primers',
    edition: 'Standard Qari Raheem Bakhsh / Furqania Edition',
    description: 'Foundational primer for Arabic phonetics, tajweed rules, and Quran reading with Urdu/Arabic instructions.',
    total_pages: 32,
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
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum)));
      return `https://raw.githubusercontent.com/haideralikhan5036/alhuda-assets/main/curriculum/noorani-qaida/page-${String(p).padStart(2, '0')}.webp`;
    },
    getFallbackPageUrl: function(pageNum) {
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum)));
      return `https://images.unsplash.com/photo-1609599006353-e629aaabfeae?auto=format&fit=crop&w=800&q=80#page=${p}`;
    }
  },
  {
    id: 'noorani-qaida-english',
    title: 'English Noorani Qaida',
    title_ar: 'القاعدة النورانية بالإنجليزية',
    category: 'qaida',
    category_label: 'Qaida & Primers',
    edition: 'International Diaspora Edition with English Rules & Phonics',
    description: 'Designed specifically for UK, US, and European students with English tajweed rules, phonetic guides, and transliterations.',
    total_pages: 32,
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
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum)));
      return `https://raw.githubusercontent.com/haideralikhan5036/alhuda-assets/main/curriculum/noorani-qaida-english/page-${String(p).padStart(2, '0')}.webp`;
    }
  },
  {
    id: 'kids-cartoon-qaida',
    title: 'Kids Illustrated Phonics Qaida',
    title_ar: 'قاعدة الأطفال المصورة بالألوان',
    category: 'qaida',
    category_label: 'Qaida & Primers',
    edition: 'Child-Friendly Illustrated Visual Edition (Ages 4–8)',
    description: 'Vibrant, cartoon-illustrated Arabic alphabet with colorful memory associations, fun characters, and visual phonics for early learners.',
    total_pages: 36,
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
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum)));
      return `https://raw.githubusercontent.com/haideralikhan5036/alhuda-assets/main/curriculum/kids-cartoon-qaida/page-${String(p).padStart(2, '0')}.webp`;
    }
  },

  // ============================================================
  // 2. THE HOLY QURAN (قرآن مجید)
  // ============================================================
  {
    id: 'quran-16-line',
    title: 'Quran Majeed (16-Line Tajweed Indo-Pak)',
    title_ar: 'القرآن الكريم (١٦ سطر برواية حفص - ملون التجويد)',
    category: 'quran',
    category_label: 'The Holy Quran',
    edition: 'Standard Subcontinent / UK Tajweed Academy Edition',
    description: 'Standard 16-line Mushaf widely used across Pakistan, India, UK & North America. Features color-coded Tajweed rules for Nazra and Hifz.',
    total_pages: 548,
    total_paras: 30,
    badge_color: 'bg-emerald-100 text-brandDark border-emerald-400',
    cover_icon: 'fa-solid fa-book-quran',
    cover_bg: 'from-[#022c22] via-[#064e3b] to-[#047857]',
    paras: [
      { para: 1, name_ar: 'الم (آلم)', name_ur: 'الم', page_start: 1, page_end: 19 },
      { para: 2, name_ar: 'سيقول (سيقول)', name_ur: 'سیقول', page_start: 20, page_end: 37 },
      { para: 3, name_ar: 'تلك الرسل (تلك الرسل)', name_ur: 'تلک الرسل', page_start: 38, page_end: 55 },
      { para: 4, name_ar: 'لن تنالوا (لن تنالوا)', name_ur: 'لن تنالوا', page_start: 56, page_end: 73 },
      { para: 5, name_ar: 'والمحصنات (والمحصنات)', name_ur: 'والمحصنات', page_start: 74, page_end: 91 },
      { para: 6, name_ar: 'لا يحب الله (لا یحب اللہ)', name_ur: 'لا یحب اللہ', page_start: 92, page_end: 109 },
      { para: 7, name_ar: 'وإذا سمعوا (واذا سمعوا)', name_ur: 'واذا سمعوا', page_start: 110, page_end: 127 },
      { para: 8, name_ar: 'ولو أننا (ولو اننا)', name_ur: 'ولو اننا', page_start: 128, page_end: 145 },
      { para: 9, name_ar: 'قال الملأ (قال الملاء)', name_ur: 'قال الملاء', page_start: 146, page_end: 163 },
      { para: 10, name_ar: 'واعلموا (واعلموا)', name_ur: 'واعلموا', page_start: 164, page_end: 181 },
      { para: 11, name_ar: 'يعتذرون (یعتذرون)', name_ur: 'یعتذرون', page_start: 182, page_end: 199 },
      { para: 12, name_ar: 'وما من دابة (وما من دابۃ)', name_ur: 'وما من دابۃ', page_start: 200, page_end: 217 },
      { para: 13, name_ar: 'وما أبرئ (وما ابرئ)', name_ur: 'وما ابرئ', page_start: 218, page_end: 235 },
      { para: 14, name_ar: 'ربما (ربما)', name_ur: 'ربما', page_start: 236, page_end: 253 },
      { para: 15, name_ar: 'سبحان الذي (سبحان الذی)', name_ur: 'سبحان الذی', page_start: 254, page_end: 271 },
      { para: 16, name_ar: 'قال ألم (قال الم)', name_ur: 'قال الم', page_start: 272, page_end: 289 },
      { para: 17, name_ar: 'اقترب (اقترب)', name_ur: 'اقترب', page_start: 290, page_end: 307 },
      { para: 18, name_ar: 'قد أفلح (قد افلح)', name_ur: 'قد افلح', page_start: 308, page_end: 325 },
      { para: 19, name_ar: 'وقال الذين (وقال الذین)', name_ur: 'وقال الذین', page_start: 326, page_end: 343 },
      { para: 20, name_ar: 'أمن خلق (امن خلق)', name_ur: 'امن خلق', page_start: 344, page_end: 361 },
      { para: 21, name_ar: 'اتل ما أوحي (اتل ما اوحی)', name_ur: 'اتل ما اوحی', page_start: 362, page_end: 379 },
      { para: 22, name_ar: 'ومن يقنت (ومن یقنت)', name_ur: 'ومن یقنت', page_start: 380, page_end: 397 },
      { para: 23, name_ar: 'وما لي (وما لی)', name_ur: 'وما لی', page_start: 398, page_end: 415 },
      { para: 24, name_ar: 'فمن أظلم (فمن اظلم)', name_ur: 'فمن اظلم', page_start: 416, page_end: 433 },
      { para: 25, name_ar: 'إليه يرد (الیہ یرد)', name_ur: 'الیہ یرد', page_start: 434, page_end: 451 },
      { para: 26, name_ar: 'حم (حم)', name_ur: 'حم', page_start: 452, page_end: 469 },
      { para: 27, name_ar: 'قال فما خطبكم (قال فما خطبکم)', name_ur: 'قال فما خطبکم', page_start: 470, page_end: 487 },
      { para: 28, name_ar: 'قد سمع الله (قد سمع اللہ)', name_ur: 'قد سمع اللہ', page_start: 488, page_end: 505 },
      { para: 29, name_ar: 'تبارك الذي (تبارک الذی)', name_ur: 'تبارک الذی', page_start: 506, page_end: 525 },
      { para: 30, name_ar: 'عم يتساءلون (عم یتساءلون)', name_ur: 'عم یتساءلون', page_start: 526, page_end: 548 }
    ],
    getPageUrl: function(pageNum) {
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum)));
      return `https://cdn.jsdelivr.net/gh/haideralikhan5036/alhuda-assets@main/curriculum/quran-16line/page-${String(p).padStart(3, '0')}.webp`;
    },
    getFallbackPageUrl: function(pageNum) {
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum)));
      return `https://raw.githubusercontent.com/the-humble-servant/quran-pages/main/16-line/${p}.png`;
    }
  },
  {
    id: 'quran-15-line',
    title: 'Quran Majeed (15-Line Madani / Hafizi)',
    title_ar: 'مصحف المدينة النبوية (١٥ سطر)',
    category: 'quran',
    category_label: 'The Holy Quran',
    edition: 'King Fahd Complex / Saudi Standard Madani Script',
    description: 'The standard 604-page Madani Mushaf with crisp Uthmani calligraphy favored by international students and Huffaz.',
    total_pages: 604,
    total_paras: 30,
    badge_color: 'bg-teal-100 text-teal-800 border-teal-300',
    cover_icon: 'fa-solid fa-quran',
    cover_bg: 'from-teal-800 to-cyan-950',
    getPageUrl: function(pageNum) {
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum)));
      return `https://images.quran.com/images/mushaf/page${String(p).padStart(3, '0')}.png`;
    }
  },

  // ============================================================
  // 3. TAFSEER & TRANSLATIONS (ترجمہ و تفسیر)
  // ============================================================
  {
    id: 'tafseer-taqi-usmani',
    title: 'The Meanings of the Noble Qur\'an (English)',
    title_ar: 'معاني القرآن الكريم لمفتي محمد تقي عثماني',
    author: 'Justice (R) Mufti Muhammad Taqi Usmani',
    category: 'tafseer',
    category_label: 'Tafseer & Translation',
    edition: 'Authentic Contemporary English Translation & Explanatory Footnotes',
    description: 'World-renowned, idiomatic and easy-to-understand English translation and commentary by the grand scholar Mufti Muhammad Taqi Usmani.',
    total_surahs: 114,
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
    author: 'Dr. Farhat Hashmi (Al-Huda International)',
    category: 'tafseer',
    category_label: 'Tafseer & Translation',
    edition: 'Official Al-Huda International Urdu Translation & Thematic Exegesis',
    description: 'Renowned worldwide for its clarity, practical everyday life applications, and heart-touching word-by-word explanation.',
    total_surahs: 114,
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
    author: 'Dr. Farhat Hashmi (Al-Huda International)',
    category: 'tafseer',
    category_label: 'Tafseer & Translation',
    edition: 'English Thematic Translation & Reflection for Youth & Adults',
    description: 'Direct, inspiring English translation designed to build an intimate relationship with the words of Allah for English-speaking students.',
    total_surahs: 114,
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
    author: 'Imam Khatib al-Tabrizi (Rahimahullah)',
    category: 'hadith',
    category_label: 'Hadith Collections',
    edition: 'Classical Dars-e-Nizami Master Hadith Syllabus with Urdu/English Headings',
    description: 'The monumental collection uniting Sahih al-Bukhari, Muslim, Sunan Abi Dawud, Tirmidhi, Nasa\'i, and Ibn Majah into 29 thematic chapters.',
    total_books: 29,
    badge_color: 'bg-cyan-100 text-cyan-900 border-cyan-300',
    cover_icon: 'fa-solid fa-landmark-dome',
    cover_bg: 'from-cyan-800 via-sky-900 to-slate-950',
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
    author: 'Imam Abu Zakariya Yahya ibn Sharaf al-Nawawi',
    category: 'hadith',
    category_label: 'Hadith Collections',
    edition: 'Complete 42 Authentic Hadiths with Arabic Text, Urdu & English Trans.',
    description: 'Fundamental collection encapsulating the essence of Islamic creed, ethics, worship, and social responsibility.',
    total_hadith: 42,
    badge_color: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    cover_icon: 'fa-solid fa-gem',
    cover_bg: 'from-emerald-800 to-slate-900'
  },

  // ============================================================
  // 5. ISLAMIC ESSENTIALS & DUAS (اسلامک سٹڈیز و مسنون دعائیں)
  // ============================================================
  {
    id: 'islamic-namaz-guide',
    title: 'Illustrated Namaz & Wudu Step-by-Step',
    title_ar: 'دليل الصلاة والوضوء المصور بالخطوات',
    category: 'essentials',
    category_label: 'Islamic Essentials',
    edition: 'Visual Step-by-Step Color Guide for Children, Beginners & Reverts',
    description: 'Clear photographic and illustrated guide covering purification, steps of Wudu, all posture movements of Salah, and essential recitations.',
    total_pages: 24,
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
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum)));
      return `https://raw.githubusercontent.com/haideralikhan5036/alhuda-assets/main/curriculum/namaz-guide/page-${String(p).padStart(2, '0')}.webp`;
    }
  },
  {
    id: 'islamic-hisn-ul-muslim',
    title: 'Hisn-ul-Muslim: Daily Masnoon Duas',
    title_ar: 'حصن المسلم من أذكار الكتاب والسنة',
    author: 'Dr. Sa\'id bin Ali bin Wahf al-Qahtani',
    category: 'essentials',
    category_label: 'Islamic Essentials',
    edition: 'Fortress of the Muslim: Authentic Duas with Arabic, Urdu & English',
    description: 'The golden pocketbook of Islamic supplications for everyday life — from morning azkar to protection from anxiety, sickness, and travel.',
    total_duas: 132,
    badge_color: 'bg-amber-100 text-amber-900 border-amber-300',
    cover_icon: 'fa-solid fa-hands-praying',
    cover_bg: 'from-amber-800 to-amber-950',
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
    category: 'essentials',
    category_label: 'Islamic Essentials',
    edition: 'High-Definition Anatomical Maps of Arabic Letter Articulation Points',
    description: 'Anatomical diagrams illustrating the five main articulation points (Throat, Tongue, Lips, Nasal Cavity, Oral Void) plus Noon/Meem Sakin charts.',
    total_pages: 16,
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
      const p = Math.max(1, Math.min(this.total_pages, Number(pageNum)));
      return `https://raw.githubusercontent.com/haideralikhan5036/alhuda-assets/main/curriculum/makharij-guide/page-${String(p).padStart(2, '0')}.webp`;
    }
  }
];

// Helper to look up a book by ID
function getCurriculumBook(bookId) {
  return ALHUDA_CURRICULUM.find(b => b.id === bookId) || null;
}

// Helper to get total count
function getCurriculumStats() {
  return {
    total_books: ALHUDA_CURRICULUM.length,
    qaida_count: ALHUDA_CURRICULUM.filter(b => b.category === 'qaida').length,
    quran_count: ALHUDA_CURRICULUM.filter(b => b.category === 'quran').length,
    tafseer_count: ALHUDA_CURRICULUM.filter(b => b.category === 'tafseer').length,
    hadith_count: ALHUDA_CURRICULUM.filter(b => b.category === 'hadith').length,
    essentials_count: ALHUDA_CURRICULUM.filter(b => b.category === 'essentials').length
  };
}

// Export for browser window
if (typeof window !== 'undefined') {
  window.ALHUDA_CURRICULUM = ALHUDA_CURRICULUM;
  window.getCurriculumBook = getCurriculumBook;
  window.getCurriculumStats = getCurriculumStats;
}
