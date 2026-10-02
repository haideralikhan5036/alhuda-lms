/**
 * Al-Huda Islamic Centre LMS — Interactive E-Qaida & Digital Lab Engine
 * Native, multimedia Arabic curriculum with authentic pronunciation,
 * interactive Makharij articulation points, and Sabaq progress tracking.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlHudaInteractiveQaida = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // =========================================================================
  // 1. DATASET: 29 ARABIC ALPHABETS (HUROOF-E-MUFRADAT)
  // =========================================================================
  const ALPHABETS_29 = [
    {
      id: "alif",
      letter: "ا",
      name: "Alif",
      name_ar: "أَلِف",
      transliteration: "Alif",
      category: "jawf",
      category_label: "Oral Cavity (الجوف)",
      makhraj_summary: "Empty space of mouth & throat (Al-Jawf)",
      makhraj_detail: "Originates from the emptiness of the mouth and throat (Al-Jawf). It is prolonged smoothly without jerking or nasal resonance.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "None (Airflow through open mouth)"
    },
    {
      id: "baa",
      letter: "ب",
      name: "Baa",
      name_ar: "بَاء",
      transliteration: "Baa",
      category: "lips",
      category_label: "Lips (الشفتان)",
      makhraj_summary: "Moist inner part of both lips meeting",
      makhraj_detail: "Produced by firmly closing the wet, inner parts of both lips together. When accompanied by Sukoon (Jazm), it produces a clear Qalqalah (echo/bounce).",
      is_heavy: false,
      qalqalah: true,
      throat: false,
      whistle: false,
      teeth_involved: "Upper & lower lips meeting"
    },
    {
      id: "taa",
      letter: "ت",
      name: "Taa",
      name_ar: "تَاء",
      transliteration: "Taa",
      category: "tongue",
      category_label: "Tongue & Teeth (اللسان)",
      makhraj_summary: "Tip of tongue & roots of upper front teeth",
      makhraj_detail: "The tip of the tongue touches the gumline (roots) of the upper two central incisors. Pronounced lightly with a soft release of breath (Hams).",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Roots of upper central incisors (الثنايا العليا)"
    },
    {
      id: "thaa",
      letter: "ث",
      name: "Thaa",
      name_ar: "ثَاء",
      transliteration: "Thaa (Soft)",
      category: "tongue",
      category_label: "Tongue & Teeth (اللسان)",
      makhraj_summary: "Tip of tongue & edge of upper front teeth",
      makhraj_detail: "The tip of the tongue gently touches the sharp edges of the upper two central incisors. Soft and whispered (like 'th' in 'think'). Do not make a whistling sound.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Edges of upper central incisors"
    },
    {
      id: "jeem",
      letter: "ج",
      name: "Jeem",
      name_ar: "جِيم",
      transliteration: "Jeem",
      category: "tongue",
      category_label: "Tongue & Palate (اللسان)",
      makhraj_summary: "Middle of tongue & hard roof of palate",
      makhraj_detail: "The center of the tongue rises firmly against the opposite hard palate (roof of the mouth). When Sakin, it has a prominent Qalqalah echo.",
      is_heavy: false,
      qalqalah: true,
      throat: false,
      whistle: false,
      teeth_involved: "Hard palate (roof of mouth)"
    },
    {
      id: "ha",
      letter: "ح",
      name: "Ḥaa",
      name_ar: "حَاء",
      transliteration: "Ḥaa (Throat)",
      category: "throat",
      category_label: "Throat (الحلق)",
      makhraj_summary: "Middle of the throat (Wasat al-Halq)",
      makhraj_detail: "Originates from the middle of the throat (pharynx) by gently constricting the throat muscles. Has a smooth, airy, breathy quality. Distinct from chest 'Haa' (هـ).",
      is_heavy: false,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "None (Middle throat muscles)"
    },
    {
      id: "kha",
      letter: "خ",
      name: "Khaa",
      name_ar: "خَاء",
      transliteration: "Khaa (Heavy)",
      category: "throat",
      category_label: "Throat (الحلق)",
      makhraj_summary: "Top of the throat near uvula (Adna al-Halq)",
      makhraj_detail: "Originates from the uppermost part of the throat closest to the mouth cavity. Always pronounced heavy/bold (Musta'liyah / Tafkheem) with a rasping airflow.",
      is_heavy: true,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "None (Uppermost throat near uvula)"
    },
    {
      id: "dal",
      letter: "د",
      name: "Daal",
      name_ar: "دَال",
      transliteration: "Daal",
      category: "tongue",
      category_label: "Tongue & Teeth (اللسان)",
      makhraj_summary: "Tip of tongue & roots of upper front teeth",
      makhraj_detail: "The tip of the tongue touches the roots of the upper two central incisors. Qalqalah letter with clear echo bounce when Sakin.",
      is_heavy: false,
      qalqalah: true,
      throat: false,
      whistle: false,
      teeth_involved: "Roots of upper central incisors"
    },
    {
      id: "thaal",
      letter: "ذ",
      name: "Dhaal / Thaal",
      name_ar: "ذَال",
      transliteration: "Dhaal",
      category: "tongue",
      category_label: "Tongue & Teeth (اللسان)",
      makhraj_summary: "Tip of tongue & edge of upper front teeth",
      makhraj_detail: "The tip of the tongue touches the edges of the upper two central incisors. Soft voiced sound, similar to 'th' in 'feather'.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Edges of upper central incisors"
    },
    {
      id: "raa",
      letter: "ر",
      name: "Raa",
      name_ar: "رَاء",
      transliteration: "Raa",
      category: "tongue",
      category_label: "Tongue & Gums (اللسان)",
      makhraj_summary: "Tip & top edge of tongue & upper gums",
      makhraj_detail: "The tip of the tongue and a small portion of its top surface strike the gums of the upper front teeth. Pronounced bold with Fatha/Damma and light with Kasra.",
      is_heavy: true,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Gums of upper central & lateral incisors"
    },
    {
      id: "zaa",
      letter: "ز",
      name: "Zaa",
      name_ar: "زَاي",
      transliteration: "Zaa",
      category: "tongue",
      category_label: "Whistling Letter (الصفير)",
      makhraj_summary: "Tip of tongue & lower front teeth",
      makhraj_detail: "The tip of the tongue approaches the lower front teeth while air rushes through with a buzzing, whistling sound (Safeer). Voiced sister of Seen.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: true,
      teeth_involved: "Edges of lower central incisors"
    },
    {
      id: "seen",
      letter: "س",
      name: "Seen",
      name_ar: "سِين",
      transliteration: "Seen",
      category: "tongue",
      category_label: "Whistling Letter (الصفير)",
      makhraj_summary: "Tip of tongue & lower front incisors",
      makhraj_detail: "The tip of the tongue is placed just behind the lower front incisors with a fine gap, producing a crisp, continuous whistling hiss (Safeer & Hams).",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: true,
      teeth_involved: "Edges of lower central incisors"
    },
    {
      id: "sheen",
      letter: "ش",
      name: "Sheen",
      name_ar: "شِين",
      transliteration: "Sheen",
      category: "tongue",
      category_label: "Tongue & Palate (اللسان)",
      makhraj_summary: "Center of tongue & opposite palate",
      makhraj_detail: "The middle of the tongue rises towards the roof of the mouth. The sound and air spread out widely throughout the mouth cavity (Tafash-shi).",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Hard palate (roof of mouth)"
    },
    {
      id: "saad",
      letter: "ص",
      name: "Ṣaad",
      name_ar: "صَاد",
      transliteration: "Ṣaad (Bold)",
      category: "tongue",
      category_label: "Whistling & Bold (الصفير والاستعلاء)",
      makhraj_summary: "Tip of tongue & lower teeth with high back",
      makhraj_detail: "Tip of the tongue touches the lower teeth while the back of the tongue is elevated high towards the palate (Isti'la & Itbaq). Full, heavy, whistling letter.",
      is_heavy: true,
      qalqalah: false,
      throat: false,
      whistle: true,
      teeth_involved: "Lower central incisors with raised tongue back"
    },
    {
      id: "dhaad",
      letter: "ض",
      name: "Ḍaad",
      name_ar: "ضَاد",
      transliteration: "Ḍaad (Unique)",
      category: "tongue",
      category_label: "Tongue Edge & Molars (حافة اللسان)",
      makhraj_summary: "Side edge of tongue & upper molars",
      makhraj_detail: "The side edge of the tongue (left, right, or both) presses firmly against the inner surface of the upper molars with continuous acoustic extension (Istitalah). Hallmark of Arabic.",
      is_heavy: true,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Upper molars, premolars & wisdom teeth (الأضراس)"
    },
    {
      id: "twaa",
      letter: "ط",
      name: "Ṭaa",
      name_ar: "طَاء",
      transliteration: "Ṭaa (Strongest)",
      category: "tongue",
      category_label: "Tongue & Teeth (أقوى الحروف)",
      makhraj_summary: "Tip of tongue & roots of upper front teeth",
      makhraj_detail: "The tip of the tongue presses the roots of the upper central incisors while the entire tongue cups the palate. Strongest and boldest letter in the entire Arabic language. Qalqalah when Sakin.",
      is_heavy: true,
      qalqalah: true,
      throat: false,
      whistle: false,
      teeth_involved: "Roots of upper central incisors"
    },
    {
      id: "zaad",
      letter: "ظ",
      name: "Ẓaa",
      name_ar: "ظَاء",
      transliteration: "Ẓaa (Heavy)",
      category: "tongue",
      category_label: "Tongue & Teeth (الاستعلاء والإطباق)",
      makhraj_summary: "Tip of tongue & edges of upper front teeth",
      makhraj_detail: "The tip of the tongue touches the sharp edge of the upper central incisors with the back of the tongue raised high. Heavy sister of Thaal.",
      is_heavy: true,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Edges of upper central incisors"
    },
    {
      id: "ain",
      letter: "ع",
      name: "‘Ayn",
      name_ar: "عَيْن",
      transliteration: "‘Ayn (Throat)",
      category: "throat",
      category_label: "Throat (الحلق)",
      makhraj_summary: "Middle of the throat (Wasat al-Halq)",
      makhraj_detail: "Articulated from the center of the throat by tightening the epiglottis slightly backwards. A deep, resonant vowel sound unique to Arabic. Smooth intermediate sound.",
      is_heavy: false,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "None (Center of throat)"
    },
    {
      id: "ghain",
      letter: "غ",
      name: "Ghayn",
      name_ar: "غَيْن",
      transliteration: "Ghayn (Heavy)",
      category: "throat",
      category_label: "Throat (الحلق)",
      makhraj_summary: "Top of the throat near uvula (Adna al-Halq)",
      makhraj_detail: "Uppermost part of the throat nearest to the mouth. Heavy, bold letter with smooth gargle-like resonance without stopping the airflow (Rikhwah).",
      is_heavy: true,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "None (Uppermost throat near uvula)"
    },
    {
      id: "faa",
      letter: "ف",
      name: "Faa",
      name_ar: "فَاء",
      transliteration: "Faa",
      category: "lips",
      category_label: "Lip & Teeth (الشفتان)",
      makhraj_summary: "Edge of upper front teeth & wet lower lip",
      makhraj_detail: "The bottom edges of the upper two central incisors touch the moist inner surface of the bottom lip as air flows out smoothly.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Edges of upper central incisors & lower lip"
    },
    {
      id: "qaaf",
      letter: "ق",
      name: "Qaaf",
      name_ar: "قَاف",
      transliteration: "Qaaf (Deep Heavy)",
      category: "tongue",
      category_label: "Tongue & Uvula (أقصى اللسان)",
      makhraj_summary: "Extreme back of tongue & soft palate",
      makhraj_detail: "The deepest back of the tongue strikes the soft palate near the uvula. Extremely heavy, deep letter with an explosive Qalqalah bounce when Sakin.",
      is_heavy: true,
      qalqalah: true,
      throat: false,
      whistle: false,
      teeth_involved: "Soft palate & uvula"
    },
    {
      id: "kaaf",
      letter: "ك",
      name: "Kaaf",
      name_ar: "كَاف",
      transliteration: "Kaaf (Light)",
      category: "tongue",
      category_label: "Tongue & Hard Palate (أقصى اللسان)",
      makhraj_summary: "Back of tongue & hard palate (Forward of Qaaf)",
      makhraj_detail: "The back of the tongue touches the hard palate slightly in front of Qaaf. Light letter with a gentle puff of air released upon separation (Hams).",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Hard palate"
    },
    {
      id: "laam",
      letter: "ل",
      name: "Laam",
      name_ar: "لَام",
      transliteration: "Laam",
      category: "tongue",
      category_label: "Tongue Edge & Gums (حافة اللسان)",
      makhraj_summary: "Front edges of tongue & upper gums",
      makhraj_detail: "The front edges of the tongue from premolar to premolar touch the gums of the upper front teeth. Light letter, except in the name of Allah preceded by Fatha/Damma.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Gums of premolars, canines, lateral & central incisors"
    },
    {
      id: "meem",
      letter: "م",
      name: "Meem",
      name_ar: "مِيم",
      transliteration: "Meem",
      category: "lips",
      category_label: "Lips & Nose (الشفتان والخيشوم)",
      makhraj_summary: "Dry outer surface of both lips meeting",
      makhraj_detail: "Produced by gently closing the dry outer surfaces of upper and lower lips together. Inherently carries natural nasal resonance (Ghunnah).",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Both lips together + Nasal cavity"
    },
    {
      id: "noon",
      letter: "ن",
      name: "Noon",
      name_ar: "نُون",
      transliteration: "Noon",
      category: "tongue",
      category_label: "Tongue & Nose (اللسان والخيشوم)",
      makhraj_summary: "Tip of tongue & upper gums + nasal cavity",
      makhraj_detail: "The tip of the tongue touches the gums of the upper front teeth below the position of Laam. Accompanied by nasal acoustic resonance (Ghunnah).",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Gums of upper front teeth + Nasal cavity"
    },
    {
      id: "waaw",
      letter: "و",
      name: "Waaw",
      name_ar: "وَاو",
      transliteration: "Waaw",
      category: "lips",
      category_label: "Rounded Lips (الشفتان)",
      makhraj_summary: "Circular rounding of both lips",
      makhraj_detail: "Formed by rounding both lips with a small central opening without the lips touching each other.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Rounded lips"
    },
    {
      id: "haa",
      letter: "هـ",
      name: "Haa",
      name_ar: "هَاء",
      transliteration: "Haa (Chest/Deep)",
      category: "throat",
      category_label: "Throat (الحلق)",
      makhraj_summary: "Deepest bottom of throat near chest (Aqsa al-Halq)",
      makhraj_detail: "Originates from the base of the throat at the vocal cords near the chest. Light, gentle, deep breath sound. Very soft.",
      is_heavy: false,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "None (Deep throat vocal cords)"
    },
    {
      id: "hamza",
      letter: "ء",
      name: "Hamza",
      name_ar: "هَمْزَة",
      transliteration: "Hamzah",
      category: "throat",
      category_label: "Throat (الحلق)",
      makhraj_summary: "Deepest bottom of throat (Glottal Stop)",
      makhraj_detail: "Articulated from the vocal cords at the base of the throat by closing and suddenly snapping them open. A distinct, crisp glottal catch.",
      is_heavy: false,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "None (Deep vocal cords)"
    },
    {
      id: "yaa",
      letter: "ي",
      name: "Yaa",
      name_ar: "يَاء",
      transliteration: "Yaa",
      category: "tongue",
      category_label: "Tongue & Palate (اللسان)",
      makhraj_summary: "Middle of tongue & hard palate roof",
      makhraj_detail: "Middle of the tongue rises towards the hard roof of the mouth without making direct contact, allowing smooth flowing vowel resonance.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Hard palate"
    }
  ];

  // =========================================================================
  // 2. DATASET: 7 COMPREHENSIVE CURRICULUM LESSONS
  // =========================================================================
  const LESSONS_REGISTRY = [
    {
      number: 1,
      id: "lesson-1",
      title: "Pronunciation of Arabic Alphabets",
      title_ar: "حروفِ مفردات (المفردات)",
      subtitle: "29 Single Letters & Foundational Phonetics",
      rules: [
        "There are 29 letters in the Arabic Alphabet.",
        "Arabic is read strictly from Right to Left (RTL).",
        "Pronounce each letter purely from its authentic articulation point (Makhraj).",
        "Distinguish between light letters (Tarkeeq) and bold/heavy letters (Tafkheem / المستعلية: خ، ص، ض، ط، ظ، غ، ق)."
      ],
      type: "mufradat"
    },
    {
      number: 2,
      id: "lesson-2",
      title: "Makharij (Points of Pronunciation) of Alphabets",
      title_ar: "مخارج الحروف وقواعد النطق",
      subtitle: "The 5 Major Regions & 17 Articulation Points with Teeth Guide",
      definition: "Makharij is the plural of Makhraj (مخرج), which means the precise anatomical articulation point from where a letter's sound originates.",
      rules: [
        "Makhraj is verified by placing a Hamza with Fatha or Kasra before the Sakin letter (e.g. أَبْ - Ab, أَتْ - At). The point where airflow halts is its true Makhraj.",
        "There are 6 Throat Letters (حروفِ حلقية: ء، هـ، ع، ح، غ، خ) divided into 3 throat levels.",
        "There are 5 Qalqalah (bouncing) letters (قطب جد: ق، ط، ب، ج، د) which produce an echo bounce when marked with Sukoon.",
        "There are 7 Heavy/Bold letters (خص ضغط قظ: خ، ص، ض، غ، ط، ق، ظ) which must be recited with a full, thick mouth."
      ],
      type: "makharij"
    },
    {
      number: 3,
      id: "lesson-3",
      title: "Different Forms & Compound Letters",
      title_ar: "حروفِ مرکبات واشكال الحروف",
      subtitle: "Initial, Medial, Final Shapes & Joint Combinations",
      rules: [
        "In Arabic script, letters connect to form words and change shape depending on whether they are Initial, Medial, or Final.",
        "Identify letters by their unique distinctive dots and base skeleton shapes.",
        "Six non-connecting letters never connect to the letter following them: (ء، ا، د، ذ، ر، ز، و).",
        "Read each letter in compound words distinctly and separately."
      ],
      compounds: [
        { text: "لا", breakdown: "Laam + Alif (ل + ا)", label: "Laam-Alif" },
        { text: "با", breakdown: "Baa + Alif (ب + ا)", label: "Baa-Alif" },
        { text: "بلب", breakdown: "Baa + Laam + Baa (ب + ل + ب)", label: "Baa-Laam-Baa" },
        { text: "كعب", breakdown: "Kaaf + ‘Ayn + Baa (ك + ع + ب)", label: "Kaaf-‘Ayn-Baa" },
        { text: "نحم", breakdown: "Noon + Ḥaa + Meem (ن + ح + م)", label: "Noon-Ḥaa-Meem" },
        { text: "يست", breakdown: "Yaa + Seen + Taa (ي + س + ت)", label: "Yaa-Seen-Taa" },
        { text: "بنت", breakdown: "Baa + Noon + Taa (ب + ن + ت)", label: "Baa-Noon-Taa" },
        { text: "ثبت", breakdown: "Thaa + Baa + Taa (ث + ب + ت)", label: "Thaa-Baa-Taa" },
        { text: "يس", breakdown: "Yaa + Seen (ي + س)", label: "Yaa-Seen" },
        { text: "طع", breakdown: "Ṭaa + ‘Ayn (ط + ع)", label: "Ṭaa-‘Ayn" },
        { text: "عج", breakdown: "‘Ayn + Jeem (ع + ج)", label: "‘Ayn-Jeem" },
        { text: "فج", breakdown: "Faa + Jeem (ف + ج)", label: "Faa-Jeem" },
        { text: "قن", breakdown: "Qaaf + Noon (ق + ن)", label: "Qaaf-Noon" },
        { text: "كم", breakdown: "Kaaf + Meem (ك + م)", label: "Kaaf-Meem" },
        { text: "لم", breakdown: "Laam + Meem (ل + م)", label: "Laam-Meem" },
        { text: "نم", breakdown: "Noon + Meem (ن + م)", label: "Noon-Meem" }
      ],
      type: "compounds"
    },
    {
      number: 4,
      id: "lesson-4",
      title: "Harakat — Short Vowels",
      title_ar: "الحركات: الفتحة والكسرة والضمة",
      subtitle: "Fatha (Zabar), Kasra (Zer), Damma (Pesh)",
      rules: [
        "Fatha (ـَ - Zabar): A diagonal stroke above the letter. Short 'a' sound (approx. 1 second).",
        "Kasra (ـِ - Zer): A diagonal stroke below the letter. Crisp 'i' sound.",
        "Damma (ـُ - Pesh): A small comma-like loop above the letter. Rounded 'u' sound.",
        "Golden Rule: Never prolong or jerk Harakat. Read promptly with gentle cadence.",
        "An Alif carrying any Harakat or Sukoon is pronounced as a Hamzah (ء)."
      ],
      type: "harakat"
    },
    {
      number: 5,
      id: "lesson-5",
      title: "Tanween — Double Vowels",
      title_ar: "التنوين: فتحتان، كسرتان، ضمتان",
      subtitle: "Two Zabar, Two Zer, Two Pesh with Hidden Noon Sound",
      rules: [
        "Tanween consists of Double Fatha (ً), Double Kasra (ٍ), or Double Damma (ٌ).",
        "Tanween inherently produces a Noon Sakin sound (ـْن) at the end of the vowel.",
        "Examples: أً = An, إٍ = In, أٌ = Un; بً = Ban, بٍ = Bin, بٌ = Bun.",
        "Do not prolong the Tanween vowel; articulate the Noon resonance clearly."
      ],
      type: "tanween"
    },
    {
      number: 6,
      id: "lesson-6",
      title: "Sukoon & Jazm — Resting Sign & Qalqalah",
      title_ar: "السكون والجزم وحروف القلقلة",
      subtitle: "Resting Mark & Bouncing Letters (Qutb Jadd)",
      rules: [
        "Sukoon (Jazm: ـْ) indicates a quiescent / silent resting letter connected to the preceding vowel.",
        "The 5 Qalqalah letters: (ق، ط، ب، ج، د) grouped as (قُطْبُ جَدٍّ).",
        "When any Qalqalah letter has Sukoon, it echoes and bounces with vibrant resonance.",
        "Hamzah Sakinah (أْ) must be pronounced with a firm, abrupt glottal stop without bouncing."
      ],
      type: "sukoon"
    },
    {
      number: 7,
      id: "lesson-7",
      title: "Tashdeed — Shaddah (Doubled Letters)",
      title_ar: "التشديد (المشدد) وأحكام الغنة",
      subtitle: "Emphasized Doubled Pronunciation & Ghunnah Rules",
      rules: [
        "Tashdeed (ـّ) indicates that the letter is recited twice: first with Sukoon, then with its own Harakah.",
        "Example: أَبَّ = أَبْ + بَ (Ab-ba).",
        "Whenever Noon or Meem carry Tashdeed (نّ، مّ), Ghunnah (nasal sound) is obligatory for 2 Harakat duration (e.g. إِنَّ، عَمَّ)."
      ],
      type: "tashdeed"
    }
  ];

  // =========================================================================
  // 3. AUDIO SYNTHESIS & PLAYBACK CONTROLLER
  // =========================================================================
  let audioContext = null;
  let currentActiveLetterId = null;
  let playbackRate = 1.0;
  let isSequentialPlaying = false;
  let sequentialTimer = null;

  function getAudioContext() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioContext = new AudioCtx();
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  }

  /**
   * High-Fidelity Arabic Speech Synthesis with Fallback
   */
  function playArabicPronunciation(text, letterObj, onEnd) {
    if (!text && letterObj) text = letterObj.letter || letterObj.name;
    if (!text) return;

    // Visual pulse indicator on the active card
    if (letterObj && letterObj.id) {
      highlightActiveCard(letterObj.id);
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Stop any pending speech

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ar-SA'; // Authentic Saudi Arabic phonetics
      utterance.rate = playbackRate || 1.0;
      utterance.pitch = 1.0;

      // Select high quality Arabic voice if available
      const voices = window.speechSynthesis.getVoices();
      const arVoice = voices.find(v => v.lang && (v.lang.startsWith('ar') || v.lang.includes('AR')));
      if (arVoice) utterance.voice = arVoice;

      utterance.onend = () => {
        clearActiveCardHighlight();
        if (typeof onEnd === 'function') onEnd();
      };
      utterance.onerror = () => {
        clearActiveCardHighlight();
        playFallbackHarmonicChime(letterObj);
        if (typeof onEnd === 'function') onEnd();
      };

      window.speechSynthesis.speak(utterance);
    } else {
      playFallbackHarmonicChime(letterObj);
      setTimeout(() => {
        clearActiveCardHighlight();
        if (typeof onEnd === 'function') onEnd();
      }, 700);
    }
  }

  /**
   * Resonant Web Audio API Formant Fallback (100% Offline)
   */
  function playFallbackHarmonicChime(letterObj) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const baseFreq = letterObj && letterObj.is_heavy ? 196.00 : 261.63; // G3 for heavy, C4 for light
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      // Audio fallback silent fail
    }
  }

  function highlightActiveCard(id) {
    clearActiveCardHighlight();
    currentActiveLetterId = id;
    const el = document.getElementById(`qaida-card-${id}`);
    if (el) {
      el.classList.add('ring-4', 'ring-amber-400', 'bg-emerald-900/90', 'scale-105');
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function clearActiveCardHighlight() {
    if (currentActiveLetterId) {
      const el = document.getElementById(`qaida-card-${currentActiveLetterId}`);
      if (el) {
        el.classList.remove('ring-4', 'ring-amber-400', 'bg-emerald-900/90', 'scale-105');
      }
      currentActiveLetterId = null;
    }
  }

  // =========================================================================
  // 4. SEQUENTIAL PLAY / AUTO-TOUR MODE FOR ZOOM SCREEN SHARE
  // =========================================================================
  function startSequentialAudioTour(letters, index = 0) {
    if (!letters || letters.length === 0) return;
    if (index >= letters.length) {
      stopSequentialAudioTour();
      return;
    }

    isSequentialPlaying = true;
    updateTourButtonState(true);

    const item = letters[index];
    playArabicPronunciation(item.letter, item, () => {
      if (!isSequentialPlaying) return;
      sequentialTimer = setTimeout(() => {
        startSequentialAudioTour(letters, index + 1);
      }, Math.round(1400 / playbackRate));
    });
  }

  function stopSequentialAudioTour() {
    isSequentialPlaying = false;
    if (sequentialTimer) {
      clearTimeout(sequentialTimer);
      sequentialTimer = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    clearActiveCardHighlight();
    updateTourButtonState(false);
  }

  function toggleSequentialAudioTour(letters) {
    if (isSequentialPlaying) {
      stopSequentialAudioTour();
    } else {
      startSequentialAudioTour(letters, 0);
    }
  }

  function updateTourButtonState(isPlaying) {
    const btn = document.getElementById('qaidaBtnAutoTour');
    if (!btn) return;
    if (isPlaying) {
      btn.innerHTML = `<i class="fa-solid fa-circle-pause text-amber-400 text-sm"></i> Pause Auto Tour`;
      btn.className = 'px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/50 text-xs font-bold transition flex items-center gap-1.5 shadow-sm';
    } else {
      btn.innerHTML = `<i class="fa-solid fa-circle-play text-emerald-400 text-sm"></i> Auto Play All`;
      btn.className = 'px-3 py-1.5 rounded-xl bg-emerald-800/80 hover:bg-emerald-700 text-emerald-100 border border-emerald-600/50 text-xs font-bold transition flex items-center gap-1.5 shadow-sm';
    }
  }

  // =========================================================================
  // 5. INTERACTIVE MODAL / FOCUS CARD DETAILS POPUP
  // =========================================================================
  function openLetterDetailModal(letterId) {
    const item = ALPHABETS_29.find(l => l.id === letterId);
    if (!item) return;

    // Trigger instant speech
    playArabicPronunciation(item.letter, item);

    let modal = document.getElementById('modalQaidaLetterDetail');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalQaidaLetterDetail';
      modal.className = 'fixed inset-0 bg-black/85 backdrop-blur-md z-[105] hidden items-center justify-center p-3 sm:p-5 transition-all';
      modal.onclick = (e) => {
        if (e.target === modal) closeLetterDetailModal();
      };
      document.body.appendChild(modal);
    }

    const heavyBadge = item.is_heavy 
      ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase tracking-wide">Bold / Tafkheem (مستعلية)</span>`
      : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase tracking-wide">Light / Tarkeeq (مرققة)</span>`;

    const qalqalahBadge = item.qalqalah 
      ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 uppercase tracking-wide">Qalqalah Echo (قلقلة)</span>`
      : '';

    const whistleBadge = item.whistle 
      ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 uppercase tracking-wide">Whistle / Safeer (صفير)</span>`
      : '';

    modal.innerHTML = `
      <div class="bg-gradient-to-b from-slate-900 via-zinc-900 to-slate-950 border border-emerald-600/40 rounded-3xl max-w-lg w-full p-5 sm:p-7 shadow-[0_25px_50px_rgba(0,0,0,0.8),0_0_30px_rgba(5,150,105,0.2)] text-white relative animate-scaleIn space-y-5">
        
        <!-- Close Button -->
        <button onclick="AlHudaInteractiveQaida.closeLetterDetailModal()" class="absolute top-4 right-4 w-9 h-9 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition border border-zinc-700/60" title="Close (Esc)">
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>

        <!-- Big Illuminated Letter Banner -->
        <div class="flex flex-col items-center text-center pt-2">
          <div class="relative w-36 h-36 sm:w-40 sm:h-40 rounded-3xl bg-gradient-to-tr from-emerald-950/80 via-teal-900/50 to-slate-900 border-2 border-emerald-500/50 flex items-center justify-center shadow-[inset_0_0_25px_rgba(5,150,105,0.3)] mb-3 group">
            <span class="text-7xl sm:text-8xl font-black font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500 select-none drop-shadow-[0_4px_12px_rgba(245,158,11,0.4)]">
              ${item.letter}
            </span>
            <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${item.letter}', AlHudaInteractiveQaida.getLetterById('${item.id}'))" class="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-lg transition transform hover:scale-110 active:scale-95 border border-emerald-400" title="Replay Pronunciation">
              <i class="fa-solid fa-volume-high text-sm"></i>
            </button>
          </div>

          <h3 class="text-2xl font-black tracking-tight text-zinc-100 flex items-center gap-2">
            ${item.name} <span class="font-['Amiri',serif] text-amber-400 text-2xl">(${item.name_ar})</span>
          </h3>
          <p class="text-xs text-zinc-400 font-medium mt-0.5">Phonetic Transliteration: <span class="text-emerald-400 font-bold font-mono">${item.transliteration}</span></p>

          <div class="flex flex-wrap items-center justify-center gap-1.5 mt-3">
            ${heavyBadge}
            ${qalqalahBadge}
            ${whistleBadge}
          </div>
        </div>

        <!-- Detailed Articulation (Makhraj) Box -->
        <div class="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
          <div class="flex items-center justify-between text-xs border-b border-zinc-800 pb-2">
            <span class="text-zinc-400 uppercase tracking-wider font-extrabold text-[10px] flex items-center gap-1.5">
              <i class="fa-solid fa-bullseye text-emerald-400"></i> Anatomical Origin (المخرج)
            </span>
            <span class="text-emerald-400 font-bold text-[11px]">${item.category_label}</span>
          </div>
          <p class="text-xs text-zinc-200 leading-relaxed font-medium">
            ${item.makhraj_detail}
          </p>
          <div class="flex items-center gap-2 text-[11px] text-amber-300/90 pt-1">
            <i class="fa-solid fa-tooth text-xs shrink-0"></i>
            <span><strong>Teeth &amp; Palate Contact:</strong> ${item.teeth_involved}</span>
          </div>
        </div>

        <!-- Audio Interactive Controls -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${item.letter}', AlHudaInteractiveQaida.getLetterById('${item.id}'))" class="py-2.5 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold transition flex items-center justify-center gap-1.5 shadow-sm">
            <i class="fa-solid fa-play text-[11px]"></i> Normal (1.0x)
          </button>
          <button onclick="AlHudaInteractiveQaida.playLetterSlow('${item.id}')" class="py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-bold transition flex items-center justify-center gap-1.5 border border-zinc-700">
            <i class="fa-solid fa-gauge-simple-high text-[11px]"></i> Slow (0.8x)
          </button>
          <button onclick="AlHudaInteractiveQaida.playLetterRepeat('${item.id}', 3)" class="col-span-2 sm:col-span-1 py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-purple-300 font-bold transition flex items-center justify-center gap-1.5 border border-zinc-700">
            <i class="fa-solid fa-repeat text-[11px]"></i> Repeat 3x
          </button>
        </div>

      </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeLetterDetailModal() {
    const modal = document.getElementById('modalQaidaLetterDetail');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  function playLetterSlow(letterId) {
    const item = ALPHABETS_29.find(l => l.id === letterId);
    if (!item) return;
    const oldRate = playbackRate;
    playbackRate = 0.75;
    playArabicPronunciation(item.letter, item, () => {
      playbackRate = oldRate;
    });
  }

  function playLetterRepeat(letterId, count = 3) {
    const item = ALPHABETS_29.find(l => l.id === letterId);
    if (!item) return;
    let played = 0;
    function next() {
      if (played < count) {
        played++;
        playArabicPronunciation(item.letter, item, () => {
          setTimeout(next, 500);
        });
      }
    }
    next();
  }

  // =========================================================================
  // 6. MAIN VIEW RENDERER (PAGES 1 TO 7)
  // =========================================================================

  /**
   * Master renderer invoked by openDigitalBookReader whenever CURRENT_READER_BOOK.id === 'interactive-madani-qaida'
   */
  function renderInteractivePage(containerId, pageNum) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const page = Math.max(1, Math.min(LESSONS_REGISTRY.length, Number(pageNum) || 1));
    const lesson = LESSONS_REGISTRY[page - 1];

    let contentHtml = '';

    switch (lesson.type) {
      case 'mufradat':
        contentHtml = renderLesson1Mufradat(lesson);
        break;
      case 'makharij':
        contentHtml = renderLesson2Makharij(lesson);
        break;
      case 'compounds':
        contentHtml = renderLesson3Compounds(lesson);
        break;
      case 'harakat':
        contentHtml = renderLesson4Harakat(lesson);
        break;
      case 'tanween':
        contentHtml = renderLesson5Tanween(lesson);
        break;
      case 'sukoon':
        contentHtml = renderLesson6Sukoon(lesson);
        break;
      case 'tashdeed':
        contentHtml = renderLesson7Tashdeed(lesson);
        break;
      default:
        contentHtml = renderLesson1Mufradat(lesson);
    }

    container.innerHTML = `
      <div class="interactive-qaida-root space-y-6 max-w-5xl mx-auto pb-8">
        
        <!-- Header Ribbon Banner -->
        <div class="bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 p-4 sm:p-6 rounded-2xl border border-emerald-600/40 shadow-xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-4">
          <div class="space-y-1 text-center md:text-left z-10">
            <div class="flex items-center justify-center md:justify-start gap-2">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 uppercase tracking-widest">
                Lesson ${lesson.number} of ${LESSONS_REGISTRY.length}
              </span>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Page ${page}
              </span>
            </div>
            <h2 class="text-xl sm:text-2xl font-black text-white tracking-tight">
              ${lesson.title}
            </h2>
            <p class="text-xs sm:text-sm font-semibold text-emerald-400 font-['Amiri',serif]">
              ${lesson.title_ar} &bull; ${lesson.subtitle}
            </p>
          </div>

          <!-- Quick Audio Tour & Controls -->
          <div class="flex items-center gap-2 shrink-0 z-10">
            <button id="qaidaBtnAutoTour" onclick="AlHudaInteractiveQaida.toggleSequentialAudioTour(AlHudaInteractiveQaida.ALPHABETS_29)" class="px-3 py-1.5 rounded-xl bg-emerald-800/80 hover:bg-emerald-700 text-emerald-100 border border-emerald-600/50 text-xs font-bold transition flex items-center gap-1.5 shadow-sm" title="Play letters sequentially for class recitation">
              <i class="fa-solid fa-circle-play text-emerald-400 text-sm"></i> Auto Play All
            </button>
            <button onclick="AlHudaInteractiveQaida.openMakharijTeethReferenceModal()" class="px-3 py-1.5 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-amber-300 border border-zinc-700 text-xs font-bold transition flex items-center gap-1.5 shadow-sm" title="View Teeth & Articulation Chart">
              <i class="fa-solid fa-tooth text-xs"></i> Teeth Diagram
            </button>
          </div>

          <!-- Decorative Islamic Arabesque Background Glow -->
          <div class="absolute -right-10 -bottom-10 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
          <div class="absolute -left-10 -top-10 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl pointer-events-none"></div>
        </div>

        <!-- Tajweed Rules / Instructions Accordion -->
        <div class="bg-slate-900/80 border border-zinc-800/80 rounded-2xl p-4 text-xs text-zinc-300 space-y-2">
          <div class="flex items-center gap-2 text-amber-300 font-extrabold text-[11px] uppercase tracking-wider">
            <i class="fa-solid fa-lightbulb text-amber-400"></i> Essential Lesson Rules &amp; Teaching Focus
          </div>
          <ul class="list-disc list-inside space-y-1 pl-1 text-zinc-300 text-[11.5px] leading-relaxed">
            ${(lesson.rules || []).map(r => `<li>${r}</li>`).join('')}
          </ul>
        </div>

        <!-- Dynamic Lesson Content -->
        ${contentHtml}

      </div>
    `;
  }

  // =========================================================================
  // 7. LESSON 1 RENDERER: 29 ALPHABETS INTERACTIVE GRID
  // =========================================================================
  function renderLesson1Mufradat(lesson) {
    const cardsHtml = ALPHABETS_29.map(item => {
      const heavyBadge = item.is_heavy 
        ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/30">BOLD</span>` 
        : '';
      const qalqalahBadge = item.qalqalah 
        ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-purple-500/20 text-purple-300 border border-purple-500/30">QALQALAH</span>` 
        : '';

      return `
        <div id="qaida-card-${item.id}" onclick="AlHudaInteractiveQaida.openLetterDetailModal('${item.id}')" 
          class="group relative bg-gradient-to-b from-slate-900 via-zinc-900 to-slate-950 hover:from-emerald-950 hover:to-zinc-900 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-between text-center cursor-pointer transition-all duration-200 transform hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(5,150,105,0.25)] select-none">
          
          <!-- Top Badges -->
          <div class="w-full flex items-center justify-between gap-1 mb-1 min-h-[18px]">
            <span class="text-[10px] font-mono text-zinc-500 group-hover:text-emerald-400 transition">${item.name}</span>
            <div class="flex items-center gap-1">${heavyBadge}${qalqalahBadge}</div>
          </div>

          <!-- Large Calligraphic Letter -->
          <div class="my-2 py-1">
            <span class="text-6xl sm:text-7xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500 group-hover:from-white group-hover:to-amber-300 transition-all drop-shadow-sm">
              ${item.letter}
            </span>
          </div>

          <!-- Transliteration & Category -->
          <div class="w-full pt-1 border-t border-zinc-800/80 group-hover:border-emerald-800/60 flex items-center justify-between text-xs">
            <span class="text-zinc-400 font-semibold group-hover:text-zinc-200 transition text-[11px]">${item.transliteration}</span>
            <button onclick="event.stopPropagation(); AlHudaInteractiveQaida.playArabicPronunciation('${item.letter}', AlHudaInteractiveQaida.getLetterById('${item.id}'))" class="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-emerald-600 text-zinc-400 hover:text-white flex items-center justify-center transition shadow-xs" title="Hear Pronunciation">
              <i class="fa-solid fa-volume-high text-[11px]"></i>
            </button>
          </div>

        </div>
      `;
    }).join('');

    return `
      <!-- Category Filter Pills -->
      <div class="flex items-center justify-center flex-wrap gap-1.5 text-xs">
        <button onclick="AlHudaInteractiveQaida.filterLetters('all')" class="qaida-filter-btn px-3 py-1 rounded-full font-bold bg-emerald-800 text-white border border-emerald-600 shadow-xs" data-filter="all">All 29 Letters</button>
        <button onclick="AlHudaInteractiveQaida.filterLetters('throat')" class="qaida-filter-btn px-3 py-1 rounded-full font-bold bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition" data-filter="throat">6 Throat Letters (حلق)</button>
        <button onclick="AlHudaInteractiveQaida.filterLetters('heavy')" class="qaida-filter-btn px-3 py-1 rounded-full font-bold bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition" data-filter="heavy">7 Bold Letters (مستعلية)</button>
        <button onclick="AlHudaInteractiveQaida.filterLetters('qalqalah')" class="qaida-filter-btn px-3 py-1 rounded-full font-bold bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition" data-filter="qalqalah">5 Qalqalah Letters (قلقلة)</button>
        <button onclick="AlHudaInteractiveQaida.filterLetters('lips')" class="qaida-filter-btn px-3 py-1 rounded-full font-bold bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition" data-filter="lips">4 Lip Letters (شفتان)</button>
      </div>

      <!-- Right-to-Left Arabic Cards Grid -->
      <div id="qaidaCardsGrid" dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 pt-2">
        ${cardsHtml}
      </div>
    `;
  }

  // =========================================================================
  // 8. LESSON 2 RENDERER: MAKHARIJ OF ALPHABETS
  // =========================================================================
  function renderLesson2Makharij(lesson) {
    return `
      <div class="space-y-6">
        
        <!-- Definition Box (Typos fixed!) -->
        <div class="bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-800/60 rounded-2xl p-5 space-y-3">
          <div class="flex items-center gap-2 text-amber-400 font-extrabold text-sm uppercase">
            <i class="fa-solid fa-book-open-reader"></i> Authentic Definition &amp; Principles
          </div>
          <p class="text-xs sm:text-sm text-zinc-200 leading-relaxed font-medium">
            <strong>Makharij (مخارج)</strong> is the plural of <em>Makhraj (مخرج)</em>, which signifies the exact anatomical articulation point from where a letter's acoustic resonance is produced. In Quranic recitation, mastering Makharij is obligatory so that similar letters are never confused (e.g. distinguishing between <span class="font-bold text-amber-300">ت and ط</span>, <span class="font-bold text-amber-300">س and ص</span>, <span class="font-bold text-amber-300">ذ and ظ</span>, <span class="font-bold text-amber-300">ح and هـ</span>).
          </p>
        </div>

        <!-- 5 Major Articulation Regions Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          <!-- 1. Al-Halq (Throat) -->
          <div class="bg-slate-900/90 border border-emerald-900/60 rounded-2xl p-4 space-y-3">
            <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h4 class="font-extrabold text-sm text-emerald-400 flex items-center gap-2">
                <i class="fa-solid fa-microphone-lines"></i> 1. The Throat (الحلق - Al-Halq)
              </h4>
              <span class="text-[10px] bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded font-mono font-bold">6 Letters</span>
            </div>
            <p class="text-xs text-zinc-300 leading-relaxed">
              Divided into 3 distinct anatomical regions from bottom to top:
            </p>
            <div class="space-y-2 text-xs">
              <div class="p-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-between cursor-pointer hover:border-emerald-500 transition" onclick="AlHudaInteractiveQaida.openLetterDetailModal('hamza')">
                <div>
                  <span class="font-bold text-zinc-100">Bottom of Throat (Aqsa al-Halq):</span>
                  <p class="text-[11px] text-zinc-400">Deep vocal cords near chest</p>
                </div>
                <span class="font-['Amiri',serif] text-2xl font-bold text-amber-300">ء ، هـ</span>
              </div>
              <div class="p-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-between cursor-pointer hover:border-emerald-500 transition" onclick="AlHudaInteractiveQaida.openLetterDetailModal('ain')">
                <div>
                  <span class="font-bold text-zinc-100">Middle of Throat (Wasat al-Halq):</span>
                  <p class="text-[11px] text-zinc-400">Center throat constriction</p>
                </div>
                <span class="font-['Amiri',serif] text-2xl font-bold text-amber-300">ع ، ح</span>
              </div>
              <div class="p-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-between cursor-pointer hover:border-emerald-500 transition" onclick="AlHudaInteractiveQaida.openLetterDetailModal('ghain')">
                <div>
                  <span class="font-bold text-zinc-100">Top of Throat (Adna al-Halq):</span>
                  <p class="text-[11px] text-zinc-400">Uppermost throat near uvula (Heavy)</p>
                </div>
                <span class="font-['Amiri',serif] text-2xl font-bold text-amber-300">غ ، خ</span>
              </div>
            </div>
          </div>

          <!-- 2. Ash-Shafataan (Lips) -->
          <div class="bg-slate-900/90 border border-emerald-900/60 rounded-2xl p-4 space-y-3">
            <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h4 class="font-extrabold text-sm text-emerald-400 flex items-center gap-2">
                <i class="fa-solid fa-lips"></i> 2. The Lips (الشفتان - Ash-Shafataan)
              </h4>
              <span class="text-[10px] bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded font-mono font-bold">4 Letters</span>
            </div>
            <p class="text-xs text-zinc-300 leading-relaxed">
              Produced by lip movements and contact with teeth:
            </p>
            <div class="space-y-2 text-xs">
              <div class="p-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-between cursor-pointer hover:border-emerald-500 transition" onclick="AlHudaInteractiveQaida.openLetterDetailModal('faa')">
                <div>
                  <span class="font-bold text-zinc-100">Faa (ف):</span>
                  <p class="text-[11px] text-zinc-400">Upper front teeth touching inner wet bottom lip</p>
                </div>
                <span class="font-['Amiri',serif] text-2xl font-bold text-amber-300">ف</span>
              </div>
              <div class="p-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-between cursor-pointer hover:border-emerald-500 transition" onclick="AlHudaInteractiveQaida.openLetterDetailModal('baa')">
                <div>
                  <span class="font-bold text-zinc-100">Baa &amp; Meem (ب، م):</span>
                  <p class="text-[11px] text-zinc-400">Baa from wet inner lips; Meem from dry outer lips</p>
                </div>
                <span class="font-['Amiri',serif] text-2xl font-bold text-amber-300">ب ، م</span>
              </div>
              <div class="p-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-between cursor-pointer hover:border-emerald-500 transition" onclick="AlHudaInteractiveQaida.openLetterDetailModal('waaw')">
                <div>
                  <span class="font-bold text-zinc-100">Waaw (و):</span>
                  <p class="text-[11px] text-zinc-400">Formed by rounding lips without touching</p>
                </div>
                <span class="font-['Amiri',serif] text-2xl font-bold text-amber-300">و</span>
              </div>
            </div>
          </div>

          <!-- 3. Al-Lisan (Tongue - 18 Letters) -->
          <div class="col-span-1 md:col-span-2 bg-slate-900/90 border border-emerald-900/60 rounded-2xl p-4 sm:p-5 space-y-4">
            <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
              <h4 class="font-extrabold text-sm text-emerald-400 flex items-center gap-2">
                <i class="fa-solid fa-language"></i> 3. The Tongue (اللسان - Al-Lisan) — 10 Makharij &amp; 18 Letters
              </h4>
              <span class="text-[10px] bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded font-mono font-bold">18 Letters</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <div class="p-3 rounded-xl bg-zinc-800/70 border border-zinc-700/60 space-y-1">
                <span class="font-bold text-amber-300">Extreme Back of Tongue</span>
                <p class="text-zinc-300 text-[11px]">ق (Soft palate &amp; uvula) &bull; ك (Hard palate forward)</p>
                <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ق ، ك</div>
              </div>

              <div class="p-3 rounded-xl bg-zinc-800/70 border border-zinc-700/60 space-y-1">
                <span class="font-bold text-amber-300">Center of Tongue</span>
                <p class="text-zinc-300 text-[11px]">Rises towards opposite hard palate</p>
                <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ج ، ش ، ي</div>
              </div>

              <div class="p-3 rounded-xl bg-zinc-800/70 border border-zinc-700/60 space-y-1">
                <span class="font-bold text-amber-300">Edge of Tongue &amp; Molars</span>
                <p class="text-zinc-300 text-[11px]">Left/right side edge hits upper molars</p>
                <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ض</div>
              </div>

              <div class="p-3 rounded-xl bg-zinc-800/70 border border-zinc-700/60 space-y-1">
                <span class="font-bold text-amber-300">Front Edges &amp; Gums</span>
                <p class="text-zinc-300 text-[11px]">Premolar to premolar gum contact</p>
                <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ل ، ن ، ر</div>
              </div>

              <div class="p-3 rounded-xl bg-zinc-800/70 border border-zinc-700/60 space-y-1">
                <span class="font-bold text-amber-300">Tip &amp; Roots of Upper Teeth</span>
                <p class="text-zinc-300 text-[11px]">Nit'iyyah letters touching gumline</p>
                <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ط ، د ، ت</div>
              </div>

              <div class="p-3 rounded-xl bg-zinc-800/70 border border-zinc-700/60 space-y-1">
                <span class="font-bold text-amber-300">Tip &amp; Edge of Upper Teeth</span>
                <p class="text-zinc-300 text-[11px]">Lithaweeyah soft letters</p>
                <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ظ ، ذ ، ث</div>
              </div>
            </div>

            <!-- Whistling Letters Box -->
            <div class="p-3 rounded-xl bg-emerald-950/40 border border-emerald-600/40 flex items-center justify-between">
              <div>
                <span class="font-bold text-emerald-300 text-xs">Whistling Letters (حروف الصفير - Safeer):</span>
                <p class="text-[11px] text-zinc-400">Tip of tongue touches lower incisors with rushing whistling sound</p>
              </div>
              <span class="font-['Amiri',serif] text-2xl text-amber-300 font-bold">ص ، ز ، س</span>
            </div>
          </div>

          <!-- 4 & 5. Cavities -->
          <div class="bg-slate-900/90 border border-emerald-900/60 rounded-2xl p-4 space-y-2">
            <h4 class="font-extrabold text-sm text-emerald-400">
              4. Oral &amp; Throat Cavity (الجوف - Al-Jawf)
            </h4>
            <p class="text-xs text-zinc-300 leading-relaxed">
              The open space of the mouth and throat. Produces the 3 Maddah elongation letters:
            </p>
            <div class="font-['Amiri',serif] text-2xl text-amber-300 font-bold">ا (Alif) ، و (Waaw Maddah) ، ي (Yaa Maddah)</div>
          </div>

          <div class="bg-slate-900/90 border border-emerald-900/60 rounded-2xl p-4 space-y-2">
            <h4 class="font-extrabold text-sm text-emerald-400">
              5. The Nasal Cavity (الخيشوم - Al-Khayshum)
            </h4>
            <p class="text-xs text-zinc-300 leading-relaxed">
              The opening behind the nose. Produces the resonance of <strong>Ghunnah (غنة)</strong> in Noon, Meem, Ikhfa, and Idgham.
            </p>
            <div class="font-['Amiri',serif] text-2xl text-amber-300 font-bold">نّ ، مّ (غنة بمقدار حركتين)</div>
          </div>

        </div>

      </div>
    `;
  }

  // =========================================================================
  // 9. LESSON 3 RENDERER: COMPOUND LETTERS (MURAKKABAT)
  // =========================================================================
  function renderLesson3Compounds(lesson) {
    const compounds = lesson.compounds || [];
    const gridHtml = compounds.map(c => `
      <div onclick="AlHudaInteractiveQaida.playArabicPronunciation('${c.text}', { id: '${c.label}', name: '${c.label}' })" 
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 hover:to-zinc-900 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-md group">
        
        <span class="text-[10px] font-mono text-zinc-500 group-hover:text-emerald-400">${c.label}</span>
        
        <div class="my-3">
          <span class="text-5xl sm:text-6xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500 group-hover:from-white group-hover:to-amber-300">
            ${c.text}
          </span>
        </div>

        <div class="w-full pt-1.5 border-t border-zinc-800 text-[10.5px] text-zinc-400 font-mono">
          ${c.breakdown}
        </div>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <div class="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300 flex items-center justify-between">
          <span>Click any compound letter to hear its combined pronunciation and view letter breakdown.</span>
          <span class="text-emerald-400 font-bold font-mono text-[11px]">${compounds.length} Combinations</span>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
          ${gridHtml}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 10. LESSON 4 RENDERER: HARAKAT (SHORT VOWELS)
  // =========================================================================
  let currentHarakatMode = 'fatha'; // 'fatha', 'kasra', 'damma'

  function renderLesson4Harakat(lesson) {
    const harakatMap = {
      fatha: { sign: "ـَ", name: "Fatha (Zabar)", vowel: "a", symbol: "َ" },
      kasra: { sign: "ـِ", name: "Kasra (Zer)", vowel: "i", symbol: "ِ" },
      damma: { sign: "ـُ", name: "Damma (Pesh)", vowel: "u", symbol: "ُ" }
    };

    const cur = harakatMap[currentHarakatMode] || harakatMap.fatha;

    const cardsHtml = ALPHABETS_29.map(item => {
      let combined = item.letter + cur.symbol;
      if (item.letter === 'ا') combined = 'أ' + cur.symbol; // Alif with vowel becomes Hamzah
      const phonetic = item.transliteration + ' + ' + cur.vowel;

      return `
        <div onclick="AlHudaInteractiveQaida.playArabicPronunciation('${combined}', { id: '${item.id}_${currentHarakatMode}', name: '${item.name}' })" 
          class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 hover:to-zinc-900 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-md group">
          <span class="text-[10px] font-mono text-zinc-500 group-hover:text-emerald-400">${item.name}</span>
          <div class="my-2">
            <span class="text-6xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
              ${combined}
            </span>
          </div>
          <span class="text-[11px] text-zinc-400 font-mono">${phonetic}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="space-y-4">
        <!-- Vowel Switcher Bar -->
        <div class="flex items-center justify-center gap-2">
          <button onclick="AlHudaInteractiveQaida.switchHarakatMode('fatha')" class="px-4 py-2 rounded-xl font-bold text-xs transition ${currentHarakatMode === 'fatha' ? 'bg-emerald-700 text-white shadow-md border border-emerald-500' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}">
            Fatha (زبر: ـَ)
          </button>
          <button onclick="AlHudaInteractiveQaida.switchHarakatMode('kasra')" class="px-4 py-2 rounded-xl font-bold text-xs transition ${currentHarakatMode === 'kasra' ? 'bg-emerald-700 text-white shadow-md border border-emerald-500' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}">
            Kasra (زیر: ـِ)
          </button>
          <button onclick="AlHudaInteractiveQaida.switchHarakatMode('damma')" class="px-4 py-2 rounded-xl font-bold text-xs transition ${currentHarakatMode === 'damma' ? 'bg-emerald-700 text-white shadow-md border border-emerald-500' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}">
            Damma (پیش: ـُ)
          </button>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  function switchHarakatMode(mode) {
    currentHarakatMode = mode;
    renderInteractivePage('readerInteractiveContent', 4);
  }

  // =========================================================================
  // 11. LESSON 5 RENDERER: TANWEEN (DOUBLE VOWELS)
  // =========================================================================
  let currentTanweenMode = 'fathatan'; // 'fathatan', 'kasratan', 'dammatan'

  function renderLesson5Tanween(lesson) {
    const tanweenMap = {
      fathatan: { symbol: "اً", label: "Two Zabar (Fathatayn)", suffix: "an" },
      kasratan: { symbol: "ٍ", label: "Two Zer (Kasratayn)", suffix: "in" },
      dammatan: { symbol: "ٌ", label: "Two Pesh (Dammatayn)", suffix: "un" }
    };

    const cur = tanweenMap[currentTanweenMode] || tanweenMap.fathatan;

    const cardsHtml = ALPHABETS_29.map(item => {
      let combined = item.letter;
      if (currentTanweenMode === 'fathatan') {
        combined = item.letter === 'ا' ? 'أً' : item.letter + 'اً';
      } else if (currentTanweenMode === 'kasratan') {
        combined = item.letter === 'ا' ? 'إٍ' : item.letter + 'ٍ';
      } else {
        combined = item.letter === 'ا' ? 'أٌ' : item.letter + 'ٌ';
      }

      return `
        <div onclick="AlHudaInteractiveQaida.playArabicPronunciation('${combined}', { id: '${item.id}_${currentTanweenMode}', name: '${item.name}' })" 
          class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-md group">
          <span class="text-[10px] font-mono text-zinc-500 group-hover:text-emerald-400">${item.name}</span>
          <div class="my-2">
            <span class="text-6xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
              ${combined}
            </span>
          </div>
          <span class="text-[11px] text-zinc-400 font-mono">${item.name} + ${cur.suffix}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="space-y-4">
        <div class="flex items-center justify-center gap-2">
          <button onclick="AlHudaInteractiveQaida.switchTanweenMode('fathatan')" class="px-4 py-2 rounded-xl font-bold text-xs transition ${currentTanweenMode === 'fathatan' ? 'bg-emerald-700 text-white shadow-md border border-emerald-500' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}">
            Two Zabar (دو زبر: ـً)
          </button>
          <button onclick="AlHudaInteractiveQaida.switchTanweenMode('kasratan')" class="px-4 py-2 rounded-xl font-bold text-xs transition ${currentTanweenMode === 'kasratan' ? 'bg-emerald-700 text-white shadow-md border border-emerald-500' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}">
            Two Zer (دو زیر: ـٍ)
          </button>
          <button onclick="AlHudaInteractiveQaida.switchTanweenMode('dammatan')" class="px-4 py-2 rounded-xl font-bold text-xs transition ${currentTanweenMode === 'dammatan' ? 'bg-emerald-700 text-white shadow-md border border-emerald-500' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}">
            Two Pesh (دو پیش: ـٌ)
          </button>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  function switchTanweenMode(mode) {
    currentTanweenMode = mode;
    renderInteractivePage('readerInteractiveContent', 5);
  }

  // =========================================================================
  // 12. LESSON 6 RENDERER: SUKOON / JAZM & QALQALAH
  // =========================================================================
  function renderLesson6Sukoon(lesson) {
    const sukoonExamples = [
      { text: "أَبْ", name: "Ab", qalqalah: true },
      { text: "أَتْ", name: "At", qalqalah: false },
      { text: "أَثْ", name: "Ath", qalqalah: false },
      { text: "أَجْ", name: "Aj", qalqalah: true },
      { text: "أَحْ", name: "Aḥ", qalqalah: false },
      { text: "أَخْ", name: "Akh", qalqalah: false },
      { text: "أَدْ", name: "Ad", qalqalah: true },
      { text: "أَذْ", name: "Adh", qalqalah: false },
      { text: "أَرْ", name: "Ar", qalqalah: false },
      { text: "أَزْ", name: "Az", qalqalah: false },
      { text: "أَسْ", name: "As", qalqalah: false },
      { text: "أَشْ", name: "Ash", qalqalah: false },
      { text: "أَصْ", name: "Aṣ", qalqalah: false },
      { text: "أَضْ", name: "Aḍ", qalqalah: false },
      { text: "أَطْ", name: "Aṭ", qalqalah: true },
      { text: "أَظْ", name: "Aẓ", qalqalah: false },
      { text: "أَعْ", name: "A‘", qalqalah: false },
      { text: "أَغْ", name: "Agh", qalqalah: false },
      { text: "أَفْ", name: "Af", qalqalah: false },
      { text: "أَقْ", name: "Aq", qalqalah: true },
      { text: "أَكْ", name: "Ak", qalqalah: false },
      { text: "أَلْ", name: "Al", qalqalah: false },
      { text: "أَمْ", name: "Am", qalqalah: false },
      { text: "أَنْ", name: "An", qalqalah: false }
    ];

    const cardsHtml = sukoonExamples.map(item => `
      <div onclick="AlHudaInteractiveQaida.playArabicPronunciation('${item.text}', { id: 'suk_${item.name}', name: '${item.name}' })" 
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border ${item.qalqalah ? 'border-purple-600/60 shadow-[0_0_12px_rgba(168,85,247,0.2)]' : 'border-emerald-900/40'} rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 group">
        <div class="w-full flex items-center justify-between text-[10px]">
          <span class="font-mono text-zinc-500">${item.name}</span>
          ${item.qalqalah ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300">ECHO</span>' : ''}
        </div>
        <div class="my-2">
          <span class="text-5xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
            ${item.text}
          </span>
        </div>
        <span class="text-[11px] text-zinc-400 font-mono">${item.qalqalah ? 'Qalqalah Bounce' : 'Resting'}</span>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <!-- Qalqalah Banner -->
        <div class="p-4 rounded-2xl bg-purple-950/40 border border-purple-600/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div class="space-y-1 text-center sm:text-left">
            <span class="font-black text-purple-300 text-sm flex items-center gap-1.5 justify-center sm:justify-start">
              <i class="fa-solid fa-wave-square"></i> The 5 Bouncing Letters of Qalqalah (قُطْبُ جَدٍّ)
            </span>
            <p class="text-zinc-300 text-[11px]">When these 5 letters carry Sukoon, their sound echoes with vibrant rebound.</p>
          </div>
          <span class="font-['Amiri',serif] text-3xl font-black text-amber-300 tracking-wider">ق ، ط ، ب ، ج ، د</span>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 13. LESSON 7 RENDERER: TASHDEED / SHADDAH
  // =========================================================================
  function renderLesson7Tashdeed(lesson) {
    const tashdeedExamples = [
      { text: "أَبَّ", name: "Abba", ghunnah: false },
      { text: "أَبِّ", name: "Abbi", ghunnah: false },
      { text: "أَبُّ", name: "Abbu", ghunnah: false },
      { text: "إِنَّ", name: "Inna", ghunnah: true },
      { text: "عَمَّ", name: "‘Amma", ghunnah: true },
      { text: "حَقَّ", name: "Ḥaqqa", ghunnah: false },
      { text: "رَبِّ", name: "Rabbi", ghunnah: false },
      { text: "مَدَّ", name: "Madda", ghunnah: false },
      { text: "ثُمَّ", name: "Thumma", ghunnah: true },
      { text: "قُلْ هُوَ اللّٰهُ", name: "Allahu", ghunnah: false }
    ];

    const cardsHtml = tashdeedExamples.map(item => `
      <div onclick="AlHudaInteractiveQaida.playArabicPronunciation('${item.text}', { id: 'tash_${item.name}', name: '${item.name}' })" 
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border ${item.ghunnah ? 'border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.2)]' : 'border-emerald-900/40'} rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 group">
        <div class="w-full flex items-center justify-between text-[10px]">
          <span class="font-mono text-zinc-500">${item.name}</span>
          ${item.ghunnah ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300">GHUNNAH</span>' : ''}
        </div>
        <div class="my-2">
          <span class="text-5xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
            ${item.text}
          </span>
        </div>
        <span class="text-[11px] text-zinc-400 font-mono">${item.ghunnah ? '2 Harakat Nasal' : 'Doubled'}</span>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <!-- Ghunnah Banner -->
        <div class="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div class="space-y-1 text-center sm:text-left">
            <span class="font-black text-amber-300 text-sm flex items-center gap-1.5 justify-center sm:justify-start">
              <i class="fa-solid fa-bell"></i> Mandatory Ghunnah on Noon &amp; Meem Mushaddad
            </span>
            <p class="text-zinc-300 text-[11px]">Whenever نّ or مّ carry Tashdeed, hold the nasal resonance for exactly 2 Harakat.</p>
          </div>
          <span class="font-['Amiri',serif] text-3xl font-black text-amber-400">إِنَّ &bull; عَمَّ &bull; ثُمَّ</span>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 14. TEETH & ANATOMY REFERENCE MODAL
  // =========================================================================
  function openMakharijTeethReferenceModal() {
    let modal = document.getElementById('modalQaidaTeethChart');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalQaidaTeethChart';
      modal.className = 'fixed inset-0 bg-black/85 backdrop-blur-md z-[105] hidden items-center justify-center p-3 sm:p-5';
      modal.onclick = (e) => {
        if (e.target === modal) closeMakharijTeethReferenceModal();
      };
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="bg-gradient-to-b from-slate-900 via-zinc-900 to-slate-950 border border-emerald-600/40 rounded-3xl max-w-2xl w-full p-5 sm:p-7 shadow-2xl text-white relative animate-scaleIn space-y-4 max-h-[92vh] overflow-y-auto">
        <button onclick="AlHudaInteractiveQaida.closeMakharijTeethReferenceModal()" class="absolute top-4 right-4 w-9 h-9 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition border border-zinc-700">
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>

        <div class="border-b border-zinc-800 pb-3">
          <h3 class="font-black text-lg text-emerald-400 flex items-center gap-2">
            <i class="fa-solid fa-tooth"></i> Names &amp; Categories of Teeth in Tajweed (أسماء الأسنان)
          </h3>
          <p class="text-xs text-zinc-400 mt-0.5">32 Adult Human Teeth &amp; Their Critical Articulation Roles</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          
          <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
            <div class="flex items-center justify-between font-bold text-emerald-300">
              <span>1. Thanaaya (الثنايا - Central Incisors)</span>
              <span class="text-[10px] bg-emerald-900/60 px-2 py-0.5 rounded font-mono">4 Teeth</span>
            </div>
            <p class="text-[11px] text-zinc-300">2 upper &amp; 2 lower front teeth. Makhraj for <strong>ت، د، ط، ث، ذ، ظ، س، ز، ص</strong>.</p>
          </div>

          <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
            <div class="flex items-center justify-between font-bold text-emerald-300">
              <span>2. Ruba'iyaat (الرباعيات - Lateral Incisors)</span>
              <span class="text-[10px] bg-emerald-900/60 px-2 py-0.5 rounded font-mono">4 Teeth</span>
            </div>
            <p class="text-[11px] text-zinc-300">Teeth immediately adjacent to central incisors (2 upper, 2 lower).</p>
          </div>

          <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
            <div class="flex items-center justify-between font-bold text-emerald-300">
              <span>3. Anyab (الأنياب - Canines / Eyeteeth)</span>
              <span class="text-[10px] bg-emerald-900/60 px-2 py-0.5 rounded font-mono">4 Teeth</span>
            </div>
            <p class="text-[11px] text-zinc-300">Sharp pointed teeth next to laterals. Gums involved with <strong>ل (Laam)</strong>.</p>
          </div>

          <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
            <div class="flex items-center justify-between font-bold text-emerald-300">
              <span>4. Dawahik (الضواحك - Premolars)</span>
              <span class="text-[10px] bg-emerald-900/60 px-2 py-0.5 rounded font-mono">4 Teeth</span>
            </div>
            <p class="text-[11px] text-zinc-300">'Laughter teeth' visible when smiling. Boundary for <strong>ل and ض</strong>.</p>
          </div>

          <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
            <div class="flex items-center justify-between font-bold text-emerald-300">
              <span>5. Tawahin (الطواحن - Molars / Grinders)</span>
              <span class="text-[10px] bg-emerald-900/60 px-2 py-0.5 rounded font-mono">12 Teeth</span>
            </div>
            <p class="text-[11px] text-zinc-300">6 upper, 6 lower large grinding teeth. Primary Makhraj contact for <strong>ض (Ḍaad)</strong>.</p>
          </div>

          <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
            <div class="flex items-center justify-between font-bold text-emerald-300">
              <span>6. Nawajiz (النواجذ - Wisdom Teeth)</span>
              <span class="text-[10px] bg-emerald-900/60 px-2 py-0.5 rounded font-mono">4 Teeth</span>
            </div>
            <p class="text-[11px] text-zinc-300">The 4 rearmost molars. Also involved in <strong>ض</strong> articulation.</p>
          </div>

        </div>

        <div class="p-3 bg-emerald-950/40 border border-emerald-600/40 rounded-xl text-xs text-zinc-300">
          <strong class="text-amber-300">Teacher Note for Screen Share:</strong> Point out to students that <span class="font-['Amiri',serif] font-bold text-emerald-400">ض (Ḍaad)</span> uses all the upper molars (Dawahik, Tawahin, Nawajiz) on either the left, right, or both sides!
        </div>

      </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeMakharijTeethReferenceModal() {
    const modal = document.getElementById('modalQaidaTeethChart');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  // =========================================================================
  // 15. LETTER FILTERING
  // =========================================================================
  function filterLetters(category) {
    // Update active button state
    const btns = document.querySelectorAll('.qaida-filter-btn');
    btns.forEach(b => {
      if (b.dataset.filter === category) {
        b.className = 'qaida-filter-btn px-3 py-1 rounded-full font-bold bg-emerald-800 text-white border border-emerald-600 shadow-xs';
      } else {
        b.className = 'qaida-filter-btn px-3 py-1 rounded-full font-bold bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition';
      }
    });

    ALPHABETS_29.forEach(item => {
      const card = document.getElementById(`qaida-card-${item.id}`);
      if (!card) return;

      let show = false;
      if (category === 'all') show = true;
      else if (category === 'throat') show = item.throat === true;
      else if (category === 'heavy') show = item.is_heavy === true;
      else if (category === 'qalqalah') show = item.qalqalah === true;
      else if (category === 'lips') show = item.category === 'lips';

      card.style.display = show ? 'flex' : 'none';
    });
  }

  // Helper
  function getLetterById(id) {
    return ALPHABETS_29.find(l => l.id === id);
  }

  // Export public interface
  return {
    ALPHABETS_29,
    LESSONS_REGISTRY,
    renderInteractivePage,
    playArabicPronunciation,
    playLetterSlow,
    playLetterRepeat,
    openLetterDetailModal,
    closeLetterDetailModal,
    openMakharijTeethReferenceModal,
    closeMakharijTeethReferenceModal,
    startSequentialAudioTour,
    stopSequentialAudioTour,
    toggleSequentialAudioTour,
    filterLetters,
    switchHarakatMode,
    switchTanweenMode,
    getLetterById
  };
});
