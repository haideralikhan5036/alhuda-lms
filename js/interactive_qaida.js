/**
 * Al-Huda Islamic Centre LMS — Interactive E-Qaida & Digital Lab Engine
 * Complete 49-Lesson Native Multimedia Arabic Curriculum
 * High-fidelity Arabic typography, authentic audio speech synthesis,
 * anatomical Makharij articulation points, teeth chart, and comprehensive Tajweed rules.
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
      makhraj_detail: "Originates from the emptiness of the mouth and throat (Al-Jawf). Prolonged smoothly without jerking or nasal resonance.",
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
      makhraj_detail: "Produced by firmly closing the wet, inner parts of both lips together. When accompanied by Sukoon, it produces a vibrant Qalqalah echo.",
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
      makhraj_detail: "The tip of the tongue gently touches the sharp edges of the upper two central incisors. Soft and whispered (like 'th' in 'think').",
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
      makhraj_detail: "The center of the tongue rises firmly against the opposite hard palate. When Sakin, it has a prominent Qalqalah bounce.",
      is_heavy: false,
      qalqalah: true,
      throat: false,
      whistle: false,
      teeth_involved: "Hard palate (roof of mouth)"
    },
    {
      id: "hhaa",
      letter: "ح",
      name: "Ḥaa",
      name_ar: "حَاء",
      transliteration: "Ḥaa (Throat)",
      category: "throat",
      category_label: "Middle Throat (وسط الحلق)",
      makhraj_summary: "Middle of the throat (Wasat al-Halq)",
      makhraj_detail: "Produced from the center of the throat by contracting the throat muscles with a smooth, rasping breath. Light letter.",
      is_heavy: false,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "Middle throat (epiglottis)"
    },
    {
      id: "khaa",
      letter: "خ",
      name: "Khaa",
      name_ar: "خَاء",
      transliteration: "Khaa (Heavy)",
      category: "throat",
      category_label: "Upper Throat (أدنى الحلق)",
      makhraj_summary: "Top of the throat nearest mouth (Adna al-Halq)",
      makhraj_detail: "Originates from the uppermost part of the throat near the uvula. Extremely heavy and raspy letter (Tafkheem).",
      is_heavy: true,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "Top of throat & soft palate"
    },
    {
      id: "daal",
      letter: "د",
      name: "Daal",
      name_ar: "دَال",
      transliteration: "Daal",
      category: "tongue",
      category_label: "Tongue & Teeth (اللسان)",
      makhraj_summary: "Tip of tongue & roots of upper front teeth",
      makhraj_detail: "The tip of the tongue strikes the gumline of the upper two front incisors. Light letter with a sharp Qalqalah bounce when Sakin.",
      is_heavy: false,
      qalqalah: true,
      throat: false,
      whistle: false,
      teeth_involved: "Roots of upper central incisors"
    },
    {
      id: "dhaal",
      letter: "ذ",
      name: "Dhaal",
      name_ar: "ذَال",
      transliteration: "Dhaal (Soft)",
      category: "tongue",
      category_label: "Tongue & Teeth (اللسان)",
      makhraj_summary: "Tip of tongue & edge of upper front teeth",
      makhraj_detail: "The tip of the tongue touches the edges of the upper two central incisors. Pronounced softly with voice (like 'th' in 'this').",
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
      makhraj_summary: "Tip of tongue & upper gums (near Laam)",
      makhraj_detail: "The tip of the tongue touches the gums of the upper front teeth with slight trill. Heavy with Fatha/Damma, light with Kasra.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Gums of upper front incisors"
    },
    {
      id: "zay",
      letter: "ز",
      name: "Zay",
      name_ar: "زَاي",
      transliteration: "Zay (Whistle)",
      category: "tongue",
      category_label: "Tongue & Lower Teeth (حروف الصفير)",
      makhraj_summary: "Tip of tongue & edges of lower front teeth",
      makhraj_detail: "Tip of the tongue rests just above the inner edges of the lower central incisors. Has a sharp buzzing whistling sound (Safeer).",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: true,
      teeth_involved: "Inner edge of lower central incisors"
    },
    {
      id: "seen",
      letter: "س",
      name: "Seen",
      name_ar: "سِين",
      transliteration: "Seen (Whistle)",
      category: "tongue",
      category_label: "Tongue & Lower Teeth (حروف الصفير)",
      makhraj_summary: "Tip of tongue & edges of lower front teeth",
      makhraj_detail: "Tip of the tongue rests just above the lower central incisors. Light letter with a sharp hissing whistle (Safeer).",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: true,
      teeth_involved: "Inner edge of lower central incisors"
    },
    {
      id: "sheen",
      letter: "ش",
      name: "Sheen",
      name_ar: "شِين",
      transliteration: "Sheen",
      category: "tongue",
      category_label: "Middle Tongue & Palate (اللسان)",
      makhraj_summary: "Middle of tongue & hard palate",
      makhraj_detail: "The center of the tongue rises towards the roof of the mouth. Features spreading of breath across the mouth (Tafash-shi).",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Hard palate"
    },
    {
      id: "saad",
      letter: "ص",
      name: "Ṣaad",
      name_ar: "صَاد",
      transliteration: "Ṣaad (Heavy Whistle)",
      category: "tongue",
      category_label: "Tongue & Lower Teeth (مستعلية مطبقة)",
      makhraj_summary: "Tip of tongue & lower incisors with full mouth",
      makhraj_detail: "Tip of tongue at lower incisors with the back of the tongue raised high (Itbaaq & Isti'laa). Extremely heavy whistling letter.",
      is_heavy: true,
      qalqalah: false,
      throat: false,
      whistle: true,
      teeth_involved: "Lower central incisors + Elevated back palate"
    },
    {
      id: "daad",
      letter: "ض",
      name: "Ḍaad",
      name_ar: "ضَاد",
      transliteration: "Ḍaad (Heavy)",
      category: "tongue",
      category_label: "Side of Tongue & Upper Molars (حافة اللسان)",
      makhraj_summary: "Side of tongue & upper molars",
      makhraj_detail: "One or both edges of the tongue press against the upper molars. The most unique letter in Arabic, recited with prolongation (Istitaalah).",
      is_heavy: true,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Upper molars (Tawahin & Nawajiz)"
    },
    {
      id: "ttaa",
      letter: "ط",
      name: "Ṭaa",
      name_ar: "طَاء",
      transliteration: "Ṭaa (Heavy)",
      category: "tongue",
      category_label: "Tongue & Upper Incisors (مستعلية مطبقة)",
      makhraj_summary: "Tip of tongue & roots of upper front teeth (Heavy)",
      makhraj_detail: "Tip of the tongue strikes the roots of the upper front teeth while elevating the back of the tongue. Heaviest letter with strong Qalqalah.",
      is_heavy: true,
      qalqalah: true,
      throat: false,
      whistle: false,
      teeth_involved: "Roots of upper central incisors"
    },
    {
      id: "zaa",
      letter: "ظ",
      name: "Ẓaa",
      name_ar: "ظَاء",
      transliteration: "Ẓaa (Heavy Soft)",
      category: "tongue",
      category_label: "Tongue & Edge of Upper Teeth (مستعلية مطبقة)",
      makhraj_summary: "Tip of tongue & edge of upper front teeth (Heavy)",
      makhraj_detail: "Tip of the tongue touches the edges of the upper two front teeth while elevating the entire back of the tongue. Heavy, soft, voiced sound.",
      is_heavy: true,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Edges of upper central incisors"
    },
    {
      id: "ayn",
      letter: "ع",
      name: "‘Ayn",
      name_ar: "عَيْن",
      transliteration: "‘Ayn (Middle Throat)",
      category: "throat",
      category_label: "Middle Throat (وسط الحلق)",
      makhraj_summary: "Center of the throat (Wasat al-Halq)",
      makhraj_detail: "Formed by squeezing the middle of the throat at the epiglottis. A deep, resonant Arabic sound with natural vocalization.",
      is_heavy: false,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "Middle throat (epiglottis)"
    },
    {
      id: "ghayn",
      letter: "غ",
      name: "Ghayn",
      name_ar: "غَيْن",
      transliteration: "Ghayn (Heavy)",
      category: "throat",
      category_label: "Upper Throat (أدنى الحلق)",
      makhraj_summary: "Top of the throat nearest mouth (Adna al-Halq)",
      makhraj_detail: "Originates from the uppermost part of the throat near the soft palate. Heavy, bubbling, voiced sound without choking.",
      is_heavy: true,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "Top of throat & soft palate"
    },
    {
      id: "faa",
      letter: "ف",
      name: "Faa",
      name_ar: "فَاء",
      transliteration: "Faa",
      category: "lips",
      category_label: "Lower Lip & Upper Teeth (الشفتان)",
      makhraj_summary: "Edge of upper front teeth & wet inside of lower lip",
      makhraj_detail: "The sharp edges of the upper two central incisors touch the inner, wet part of the lower lip with a smooth whispered breath.",
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
      transliteration: "Qaaf (Heavy)",
      category: "tongue",
      category_label: "Back of Tongue & Soft Palate (أقصى اللسان)",
      makhraj_summary: "Deep back of tongue & soft palate near uvula",
      makhraj_detail: "The deepest back of the tongue strikes the soft palate near the uvula. Extremely heavy letter with explosive Qalqalah when Sakin.",
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
      makhraj_detail: "The back of the tongue touches the hard palate slightly in front of Qaaf. Light letter with a gentle breath puff upon release (Hams).",
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
      makhraj_detail: "The front edges of the tongue touch the gums of the upper front teeth. Light, except in the name of Allah preceded by Fatha/Damma.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Gums of premolars, canines & incisors"
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
      makhraj_detail: "Produced by gently closing the dry outer surfaces of upper and lower lips together. Carries natural nasal resonance (Ghunnah).",
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
      makhraj_detail: "Tip of tongue touches the gums of upper front teeth below Laam. Accompanied by nasal acoustic resonance (Ghunnah).",
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
      category_label: "Bottom Throat (أقصى الحلق)",
      makhraj_summary: "Deepest bottom of throat near chest (Aqsa al-Halq)",
      makhraj_detail: "Originates from the base of the throat at vocal cords near the chest. Light, gentle, deep breath sound.",
      is_heavy: false,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "Base of throat / vocal cords"
    },
    {
      id: "hamzah",
      letter: "ء",
      name: "Hamzah",
      name_ar: "هَمْزَة",
      transliteration: "Hamzah",
      category: "throat",
      category_label: "Bottom Throat (أقصى الحلق)",
      makhraj_summary: "Deepest bottom of throat (Glottal Stop)",
      makhraj_detail: "Produced by firm closure and abrupt release of vocal cords. Crisp glottal stop. When Sakin, halts abruptly without bounce.",
      is_heavy: false,
      qalqalah: false,
      throat: true,
      whistle: false,
      teeth_involved: "Vocal cords in deep throat"
    },
    {
      id: "yaa",
      letter: "ي",
      name: "Yaa",
      name_ar: "يَاء",
      transliteration: "Yaa",
      category: "tongue",
      category_label: "Middle Tongue & Palate (اللسان)",
      makhraj_summary: "Middle of tongue & hard roof of palate",
      makhraj_detail: "The center of the tongue rises towards the roof of the mouth without touching. Light, flowing sound.",
      is_heavy: false,
      qalqalah: false,
      throat: false,
      whistle: false,
      teeth_involved: "Hard palate"
    }
  ];

  // =========================================================================
  // 2. MASTER REGISTRY: ALL 49 LESSONS WITH SYLLABUS & ARABIC DATA
  // =========================================================================
  const LESSONS_REGISTRY = 
[{"number":1,"id":"lesson-1","title":"Pronunciation of Arabic Alphabets","title_ar":"حروفِ مفردات (المفردات)","subtitle":"29 Single Letters \u0026 Foundational Phonetics","rules":["There are 29 alphabets in Arabic."],"words":["ا","ب","ت","ث","ج","ح","خ","د","ذ","ر","ز","س","ش","ص","ض","ط","ظ","ع","غ","ف","ق","ك","ل","م","ن","و","ه","ء","ى"],"type":"mufradat","mode":null,"vowel":null},{"number":2,"id":"lesson-2","title":"Makharij (Points of Pronunciation)","title_ar":"مخارج الحروف وقواعد النطق","subtitle":"5 Major Organs, 17 Points \u0026 Teeth Guide","rules":["Hamza and Haa ء ه : Originate from the bottom of the throat.","Ain and Haa ع ح : Originate from the middle of the throat.","Ghain Kha غ خ : Originate from the top of the throat.","Qaaf ق : is pronounced when the very extreme back of the tongue touches the palate close to the uvula.","Kaaf ك : is pronounced when the back of the tongue touches the palate, a little closer to the front.","Jeem Sheen and Yaa ج ش ي : There are pronounced when the center/middle of the tongue touches the opposite palate.","Dhwaad ض : it is pronounced when the back upturned edges/side of the tongue ;the right, left or both sides, touches the roots of the molars and premolars and wisdom teeth but it is easy to pronounce from the left.","Laam ل : is pronounced when the edges/sides of the tongue touch the gums of upper premolars one side to the upper premolars on the other side.","Noon ن : is pronounced when the edges of the tongue touch the gums of upper canine one side to the upper canine on the other side","Raa ر : when the edges of the tongue , including the tip touch the gums of lateral and central incisors.","Twaa,Daal and Taa ط د ت : These are articulated when the tip of the tongue touches the roots of the upper central incisors.","Thwaa,Thaal and thaa ظ ذ ث : These are articulated when the tip of the tongue touches the edges of the upper central incisors.","Swaad,Zaa and Seen ص ز س : These are produced when the tip of the tongue touches the edges of the lower central incisors along with the upper central incisors.","Ba,Meem and Waw ب م و : Meem is pronounced from the dry portion of the lips and Ba is from the wet portion of the lips,while,Waw is pronounced with incomplete meeting and rolling the lips.","Faa ف : is pronounced when the inner center of the bottom lip touches the edge of the upper incisors.","Long vowels (Madda Letters) and short vowels(Fatha,Dhamma and Kasra): are articulated from the empty space of the mouth.","Nasal sound, Ikhfa and Idgham of Meem and Noon are articulated from the nasal cavity, means from the empty space in the nose."],"words":["ء","ه","ع","ح","غ","خ","ق","ك","ج","ش","ى","ض","ل","ن","ر","ط","د","ت","ظ","ذ","ث","ص","ز","س","ب","و","م","ف","ا"],"type":"makharij","mode":null,"vowel":null},{"number":3,"id":"lesson-3","title":"Different Forms / Shapes of Alphabets","title_ar":"حروفِ مرکبات واشكال الحروف","subtitle":"Isolated, Initial, Medial \u0026 Final Forms","rules":["In this Lesson our focus should be on identification of different forms/shapes of letters through dots,shapes and sounds while reading all the letters separately."],"words":["ب","ت","ث","ج","ح","خ","س","ش","ص","ض","ع","غ","ف","ق","ك","ل","م","ن","ه","ى"],"type":"shapes","mode":null,"vowel":null},{"number":4,"id":"lesson-4","title":"Compound Letters (Joint Combinations)","title_ar":"حروفِ مرکبات (المركبات)","subtitle":"51 Joint Letter Combinations \u0026 Breakdown","rules":["A letter could be changed when it comes together with another letter.","ء ا د ذ ر ز و ء These letters will never be connected in the beginning, even though Hamza cannot be enjoined in the ending."],"words":["ها","عا","حا","لا","كا","ثر","شد","جل","خو","يب","نى","بج","هى","يد","عم","رسل","هود","وقع","بعد","رجس","بلغ","قال","خلت","كان","فيه","كتب","ريب","نذر","قوم","نفس","بسبب","بهيج","تعبد","رانه","طرفك","عنده","اغنى","نموت","فتحت","كاشفة","ابراهيم","خلقتنى","يصلونها","نازعات","يدريك","سيعلمون","اوتادا","تبارك","تعجبون","فتنفعه","يتساءلون"],"type":"compounds","mode":null,"vowel":null},{"number":5,"id":"lesson-5","title":"Harakat — Fatha (Short \u0027a\u0027 Vowel)","title_ar":"الحركات: الفتحة (زبر)","subtitle":"29 Alphabets with Fatha Vowel Movement","rules":["Fatha (ـَ - زبر): A diagonal stroke placed above the letter representing a short \u0027a\u0027 sound.","Do not prolong the sound or jerk the letter. Read with a crisp, gentle flow.","An Alif with a Fatha is recited as Hamzah (أَ)."],"words":["اَ","بَ","تَ","ثَ","جَ","حَ","خَ","دَ","ذَ","رَ","زَ","سَ","شَ","صَ","ضَ","طَ","ظَ","عَ","غَ","فَ","قَ","كَ","لَ","مَ","نَ","وَ","هَ","ءَ","ىَ"],"type":"harakat_letters","mode":null,"vowel":"fatha"},{"number":6,"id":"lesson-6","title":"Fatha Practice Exercise","title_ar":"تمرين الفتحة (زبر)","subtitle":"27 Practice Words with Fatha Vowels","rules":["Exercise: Read all words containing Fatha vowels quickly and smoothly.","Do not stretch or pull any letter. Each Harakah has exactly 1 Harakah duration (approx 1 second).","Pay attention to distinguishing bold letters (like خ، ص، ض، غ، ط، ق، ظ) from light letters."],"words":["لَكَ","اَوَ","مَعَ","اَفَ","فَوَ","اَحَدَ","صَدَقَ","کَتَبَ","ثَبَتَ","سَقَطَ","طَلَبَ","ظَلَمَ","وَلَدَ","قَتَلَ","عَبَسَ","خَلَقَكَ","بَلَغَكَ","فَوَقَعَ","فَجَمَعَ","لَجَعَلَ","سَاَلَكَ","لَذَهَبَكَ","فَمَکَثَ","فَسَجَدَ","فَاَخَذَ","فَعَدَلَكَ","وَوَجَدَكَ"],"type":"words_grid","mode":null,"vowel":null},{"number":7,"id":"lesson-7","title":"Harakat — Kasra (Short \u0027i\u0027 Vowel)","title_ar":"الحركات: الكسرة (زير)","subtitle":"29 Alphabets with Kasra Vowel Movement","rules":["Kasra (ـِ - زير): A diagonal stroke placed below the letter representing a short \u0027i\u0027 sound.","Pronounce crisply from the lower jaw without tilting into Urdu \u0027ay\u0027 sound.","Keep pronunciation smooth and unprolonged."],"words":["اِ","بِ","تِ","ثِ","جِ","حِ","خِ","دِ","ذِ","رِ","زِ","سِ","شِ","صِ","ضِ","طِ","ظِ","عِ","غِ","فِ","قِ","كِ","لِ","مِ","نِ","وِ","هِ","ءِ","ىِ"],"type":"harakat_letters","mode":null,"vowel":"kasra"},{"number":8,"id":"lesson-8","title":"Kasra Practice Exercise","title_ar":"تمرين الكسرة (زير)","subtitle":"24 Practice Words with Kasra Vowels","rules":["Exercise: Read all words containing Kasra vowels with clear distinction.","Ensure proper pronunciation of Kasra beneath throat and light letters.","Do not add an extra Yaa sound; keep the vowel short and crisp."],"words":["اِبِلِ","حَسِبَ","عَلِمَ","خَشِىَ","اَذِنَ","بَخِلَ","عَمِلَ","فَهِىَ","يَئِسَ","عَهِدَ","فَلَبِثَ","لِاَهَبَ","نَفَعَتِ","فَصَعِقَ","لَنَفِدَ","قِبَلَكَ","فَفَزِعَ","بَلَغَتِ","فَنَسِیَ","بِيَدِكَ","وَغَبِيَ","اَفَحَسِبَ","بَلَغَنِىَ","لَفَسَدَتِ"],"type":"words_grid","mode":null,"vowel":null},{"number":9,"id":"lesson-9","title":"Harakat — Damma (Short \u0027u\u0027 Vowel)","title_ar":"الحركات: الضمة (پيش)","subtitle":"29 Alphabets with Damma Vowel Movement","rules":["Damma (ـُ - پيش): A small comma-like symbol placed above the letter representing a short \u0027u\u0027 sound.","Form the sound by cleanly rounding both lips without stretching or prolonging.","Avoid pronouncing it as a flat \u0027o\u0027 sound; produce an authentic Arabic \u0027u\u0027."],"words":["اُ","بُ","تُ","ثُ","جُ","حُ","خُ","دُ","ذُ","رُ","زُ","سُ","شُ","صُ","ضُ","طُ","ظُ","عُ","غُ","فُ","قُ","كُ","لُ","مُ","نُ","وُ","هُ","ءُ","ىُ"],"type":"harakat_letters","mode":null,"vowel":"damma"},{"number":10,"id":"lesson-10","title":"Damma Practice Exercise","title_ar":"تمرين الضمة (پيش)","subtitle":"29 Practice Words with Damma Vowels","rules":["Exercise: Practice words combining Fatha, Kasra, and Damma vowels.","Notice the transition between different mouth positions.","Read each word smoothly without hesitations or jerks."],"words":["قُدُسِ","سُدُسُ","ثُمُنُ","ثُلُثُ","سُئِلَ","قُتِلَ","صُحُفِ","وَهُوَ","كُتُبِ","مُنِعَ","حُبُكِ","خُلِقَ","خَبُثَ","دُعِىَ","ظُلِمَ","لَھُوَ","وُعِدَ","ذُبِحَ","نُصُبِ","بُغِیَ","سَبُعُ","فَھُوَ","کُتِبَ","نُفِخَ","فَقُتِلَ","وَوُضِعَ","وَنُفِخَ","فَبُھِتَ","جُمُعَةِ"],"type":"words_grid","mode":null,"vowel":null},{"number":11,"id":"lesson-11","title":"Jazm \u0026 Sukoon — Foundations","title_ar":"السكون والجزم وحروف القلقلة","subtitle":"60 Quiescent Letter Combinations \u0026 Bouncing Signs","rules":["Jazm is placed on the letter.","The letters having sign of Jazm ـْـ is called Sakin/Majzum","Jazm does not have its own sound.","The letter, having sign of Jazm, is always being recited with first letter.","In stopping condition we do not need to change the Jazm, when it appears on the last letter."],"words":["اَتْ","اِتْ","اُتْ","اَثْ","اِثْ","اُثْ","اَحْ","اِحْ","اُحْ","اَخْ","اِخْ","اُخْ","اَذْ","اِذْ","اُذْ","اَزْ","اِزْ","اُزْ","اَسْ","اِسْ","اُسْ","اَشْ","اِشْ","اُشْ","اَصْ","اِصْ","اُصْ","اَضْ","اِضْ","اُضْ","اَظْ","اِظْ","اُظْ","اَعْ","اِعْ","اُعْ","اَغْ","اِغْ","اُغْ","اَفْ","اِفْ","اُفْ","اَكْ","اِكْ","اُكْ","اَلْ","اِلْ","اُلْ","اَمْ","اِمْ","اُمْ","اَنْ","اِنْ","اُنْ","اَهْ","اِهْ","اُهْ","اَءْ","اِءْ","اُءْ"],"type":"letter_grid","mode":null,"vowel":null},{"number":12,"id":"lesson-12","title":"Jazm / Sukoon Practice Exercise","title_ar":"تمرين السكون والجزم","subtitle":"20 Practice Words with Sukoon","rules":["Exercise: Practice words containing Sukoon / Jazm (ـْ).","Connect the resting letter smoothly to the vowel on the preceding letter.","If the resting letter is from the 5 Qalqalah letters (ق، ط، ب، ج، د), make it echo and bounce!"],"words":["اَحْمَدُ","اَلْقَتْ","خُلِقَتْ","شِئْتُمْ","نُصِبَتْ","دَمْدَمَ","حَصْحَصَ","تَعْلَمُ","سُطِحَتْ","عَسْعَسَ","اَتْمَمْتُ","يَمْسَسْكَ","بِالْهَزْلِ","بَطَشْتُمْ","شَاْنِھِمْ","زُلْزِلَتْ","اَلْيَسَعَ","ذَاالْكِفْلِ","اَلْفِتْنَۃُ","اَلْکَعْبَةَ"],"type":"words_grid","mode":null,"vowel":null},{"number":13,"id":"lesson-13","title":"Tashdeed / Shaddah — Doubled Letters","title_ar":"التشديد (المشدد)","subtitle":"75 Doubled Letter Combinations","rules":["Stressing the letter is called Tashdeed.","This sign looks like sign of (W).","The letter having this symbol is called Mushaddad.","Such letter is pronounced twice.","Such letter has to be joined with the previous letter.","If we have this symbol on the Letter Noon and Meem then we have to make nasal sound and will stay for one Alif, such rule is called Ghunna.","All the stopping rules of the last letter will be implemented according to symbols (Movements) as we mentioned before in the end of each lesson while stopping on the last letter having Tashdeed."],"words":["اَبَّ","اَبِّ","اَبُّ","اَتَّ","اَتِّ","اَتُّ","اَثَّ","اَثِّ","اَثُّ","اَجَّ","اَجِّ","اَجُّ","اَحَّ","اَحِّ","اَحُّ","اَخَّ","اَخِّ","اَخُّ","اَدَّ","اَدِّ","اَدُّ","اَذَّ","اَذِّ","اَذُّ","اَرَّ","اَرِّ","اَرُّ","اَزَّ","اَزِّ","اَزُّ","اَسَّ","اَسِّ","اَسُّ","اَشَّ","اَشِّ","اَشُّ","اَصَّ","اَصِّ","اَصُّ","اَضَّ","اَضِّ","اَضُّ","اَطَّ","اَطِّ","اَطُّ","اَظَّ","اَظِّ","اَظُّ","اَ عَّ","اَ عِّ","اَ عُّ","اَ غَّ","اَ غِّ","اَ غُّ","اَفَّ","اَفِّ","اَفُّ","اَقَّ","اَقِّ","اَقُّ","اَكَ","اَكِّ","اَكُّ","اَلَّ","اَلِّ","اَلُّ","اَوَّ","اَوِّ","اَوُّ","اَءَّ","اَءِّ","اَءُّ","اَىَّ","اَىِّ","اَىُّ"],"type":"letter_grid","mode":null,"vowel":null},{"number":14,"id":"lesson-14","title":"Tashdeed Practice Exercise","title_ar":"تمرين التشديد","subtitle":"19 Practice Words with Tashdeed","rules":["Exercise: Practice words containing Tashdeed (ـّ).","Hold the doubled letter with firm pressure: first Sakin, then with its vowel.","If Tashdeed is on Noon (نّ) or Meem (مّ), hold the Ghunnah nasal resonance for 2 Harakat."],"words":["لَعَلَّ","حُصِّلَ","صَدَّقَ","عَدَّدَ","کَذَّبَ","عَلَّمَ","فَصَلِّ","یَمُدُّ","مَكَّةَ","حَیُّ","قَدَّمَتْ","كَذَّبَتْ","تَطَّلِعُ","تُحَدِّتُ","اُفَوِّضُ","بِبَكَّةَ","سَوَّلَتْ","فَسَبِّحِْ","وَتَقَبَّلْ"],"type":"words_grid","mode":null,"vowel":null},{"number":15,"id":"lesson-15","title":"Ghunnah — Rules of Noon \u0026 Meem Mushaddad","title_ar":"أحكام الغنة في النون والميم المشددتين","subtitle":"Obligatory 2-Harakah Nasal Sound","rules":["Stressing the letter is called Tashdeed.","This sign looks like sign of (W).","The letter having this symbol is called Mushaddad.","Such letter is pronounced twice.","Such letter has to be joined with the previous letter.","If we have this symbol on the Letter Noon and Meem then we have to make nasal sound and will stay for one Alif, such rule is called Ghunna.","All the stopping rules of the last letter will be implemented according to symbols (Movements) as we mentioned before in the end of each lesson while stopping on the last letter having Tashdeed."],"words":["إِنَّ","عَمَّ","ثُمَّ","لَمَّا","مِمَّا","إِنَّمَا","جَنَّاتٍ","أُمَّةٍ"],"type":"ghunnah_theory","mode":null,"vowel":null},{"number":16,"id":"lesson-16","title":"Ghunnah Practice Exercise","title_ar":"تمرين أحكام الغنة","subtitle":"25 Practice Words with Mandatory Ghunnah","rules":["Exercise: Practice reading words with Noon and Meem Mushaddad.","Always apply complete 2-Harakah Ghunnah in the nasal cavity.","Do not rush or skip the nasal resonance on words like إِنَّ and عَمَّ."],"words":["عَمَّ","مِمَّ","ھَمَّ","ھُنَّ","ثُمَّ","جَنَّ","مَنِّ","ھَلُمَّ","تَمَّتْ","فَتَمَّ","تُکِنُّ","مِمَّنْ","ھَمَّتْ","یَظُنُّ","فَمَنَّ","کَاَنَّ","اِنَّکَ","اَلْیَمِّ","اَنَّکُمْ","اَلنَّبِیُّ","جَھَنَّمَ","مُزَّمِّلُ","اَلْجَنَّةِ","لَا تَمُدَّنَّ","يَمُنَّونَ"],"type":"words_grid","mode":null,"vowel":null},{"number":17,"id":"lesson-17","title":"Qalqalah — Echoing \u0026 Bouncing Letters","title_ar":"حروف القلقلة (قُطْبُ جَدٍّ)","subtitle":"5 Letters with Rebounding Resonance","rules":["Qalqala means to pronounce the letter with echoing or bouncing sound.","This is extra sound which is being originated, while pronouncing it.","Qalqala is the characteristic of five letters ب، ج، د، ط، ق ."],"words":["اَبْ","اِبْ","اُبْ","اَجْ","اِجْ","اُجْ","اَدْ","اِدْ","اُدْ","اَطْ","اِطْ","اُطْ","اَقْ","اِقْ","اُقْ"],"type":"qalqalah_theory","mode":null,"vowel":null},{"number":18,"id":"lesson-18","title":"Qalqalah Practice Exercise","title_ar":"تمرين حروف القلقلة","subtitle":"20 Practice Words with Qalqalah Rebound","rules":["Exercise: Practice words containing Qalqalah letters (ق، ط، ب، ج، د).","Notice the difference between Qalqalah Sughra (minor bounce in middle) and Qalqalah Kubra (major bounce upon stopping).","Let the sound echo freely without adding a vowel sound at the end."],"words":["وَقَبَ","خَلَقَ","حَطَبِ","حَسَدَ","اَلْحَقُّ","وَتَبَّ","اَلْحَجُّ","يَجْعَلْ","اُقْسِمُ","اَقْبِلْ","قَبْلِكَ","اُقْتُلْ","نُطْفَۃٍ","لَمْ يَلِدْ","کَاَنَّ","اِنَّکَ","اَشْفَقْنَ","اَنَّکُمْ","یُمْدِدْکُمْ","اَلسَّبْتُ"],"type":"words_grid","mode":null,"vowel":null},{"number":19,"id":"lesson-19","title":"Huroof-e-Maddah — Long Vowels","title_ar":"حروف المد الثلاثة (الألف، الواو، الياء)","subtitle":"81 Elongation Combinations (2 Harakat Duration)","rules":["If Alif comes after Fatha (ـَـ) it is called Alif Maddah. For Example: بَا، تَا .","If Wavo sakina comes after Dhamma (ـُـ) , it is called Waao Maddah. For Example: بُو، تُو","If Yaa sakina comes after Kasra (ـِـ) , it is called Yaa-e-Maddah. For Example: إى، دِى","Long vowel will be stretched for one Alif.","If Maddah letter appears in the end of word then the duration of Madd will be equivalent to three or four Alif, while stopping on the last letter. For Example سَمِيْعٌ will be سَمِيْعْ and بَصِيْرٌ as بَصِيْرْ ."],"words":["بَا","بُوْ","بِىْ","تَا","تُوْ","تِىْ","ثَا","ثُوْ","ثِىْ","جَا","جُوْ","جِىْ","حَا","حُوْ","حِىْ","خَا","خُوْ","خِىْ","دَا","دُوْ","دِىْ","ذَا","ذُوْ","ذِىْ","رَا","رُوْ","رِىْ","زَا","زُوْ","زِىْ","سَا","سُوْ","سِىْ","شَا","شُوْ","شِىْ","صَا","صُوْ","صِىْ","ضَا","ضُوْ","ضِىْ","طَا","طُوْ","طِىْ","ظَا","ظُوْ","ظِىْ","عَا","عُوْ","عِىْ","غَا","غُوْ","غِىْ","فَا","فُوْ","فِىْ","قَا","قَوْ","قَىْ","كَا","كُوْ","كِىْ","لَا","لُوْ","لِىْ","مَا","مُوْ","مِىْ","نَا","نُوْ","نِىْ","وَا","وُوْ","وِىْ","ءَا","ءُوْ","ءِىْ","يَا","يُوْ","يِىْ"],"type":"letter_grid","mode":null,"vowel":null},{"number":20,"id":"lesson-20","title":"Huroof-e-Maddah Practice Exercise","title_ar":"تمرين حروف المد الثلاثة","subtitle":"33 Practice Words with Alif, Waaw \u0026 Yaa Maddah","rules":["Exercise: Practice words with Huroof-e-Maddah (Long Vowels: Alif, Waaw, Yaa).","Elongate each Maddah letter for exactly 2 Harakat (approx 2 seconds / 1 Alif).","Do not shorten or over-prolong beyond 2 Harakat in natural Madd Asli."],"words":["اَبِیْ","ھُوْدُ","قَالَ","يَخَافُ","صَالِحُ","یُوْسُفَ","یُوْنُسَ","اَیُّوْبَ","اِیَّاکَ","اَفَاضَ","اُوْتِىَ","صَدَقُوْ","سَمِعُوْ","يَكُوْنُ","اَكِيْدُ","بَنِيْهِ","مِیْکٰلَ","اَیُّھَا","یَعْقُوْبَ","اِلْيَاسَ","اُوْذِيْنَا","نُوْحِيْهَا","لَمْ یُوْلَدْ","اَیَّتُھَا","اَلْقَیُّوْمُ","اَلَّذِیْنَ","التَّوَّابُ","تَشْھَدُوْنَ","اَلصِّیَامُ","اَلْمَدِیْنَةِ","فَکُبْکِبُوْ","اِسْمَاعِیْلَ","لِلْمُصَلِّينَ"],"type":"words_grid","mode":null,"vowel":null},{"number":21,"id":"lesson-21","title":"Huroof-e-Leen — Soft Diphthongs","title_ar":"حروف اللين (الواو والياء اللينتان)","subtitle":"56 Soft Diphthong Combinations (Waaw \u0026 Yaa Leen)","rules":["If there is Fatha (ـَـ) before و sakin or ى sakin, it is called soft letter or Leen Letters. For Example: يَوْ، تَوْ and تي، ثي etc.","Leen Letters should be pronounced softly without stretching.","The difference between Maddah Letters and Leen Letters, must be identified carefully ,considering in sound.","If the Leen letter appear in the end of word, it could be prolonged up to 3 /4 Alif, while, stopping on the last letter."],"words":["بَوْ","بَىْ","تَوْ","تَىْ","ثَوْ","ثَىْ","جَوْ","جَىْ","حَوْ","حَىْ","خَوْ","خَىْ","دَوْ","دَىْ","ذَوْ","ذَىْ","رَوْ","رَىْ","زَوْ","زَىْ","سَوْ","سَىْ","شَوْ","شَىْ","صَوْ","صَىْ","ضَوْ","ضَىْ","طَوْ","طَىْ","ظَوْ","ظَىْ","عَوْ","عَىْ","غَوْ","غَىْ","فَوْ","فَىْ","قَوْ","قَىْ","كَوْ","كَىْ","لَوْ","لَىْ","مَوْ","مَىْ","نَوْ","نَىْ","وَوْ","وَىْ","هَوْ","هَىْ","ءَوْ","ءَىْ","يَوْ","يَىْ"],"type":"letter_grid","mode":null,"vowel":null},{"number":22,"id":"lesson-22","title":"Huroof-e-Leen Practice Exercise","title_ar":"تمرين حروف اللين","subtitle":"23 Practice Words with Soft Vowels","rules":["Exercise: Practice words containing Huroof-e-Leen (Waaw \u0026 Yaa preceded by Fatha).","Pronounce softly and smoothly without jerking or excessive stretching.","Examples: خَوْفٍ (Khawf) and صَيْفٍ (Sayf)."],"words":["يَوْمَ","بَیْنَ","کَیْفَ","لَیْسَ","حَوْلَ","زَوْجُ","قَوْمِ","حَیْثُ","سَوْفَ","اَيْنَ","سَيْلَ","شُعَیْبُ","اَتَیْنَ","قَوْلِىْ","یُدْعَوْنَ","زَیْتُھَا","عَفَوْنَا","فَوْقِهِمْ","شَفَتَيْنِ","عَيْنَيْنِ","اِثْنَیْنِ","سُلَیْمٰنَ","عَلَیْھِمْ"],"type":"words_grid","mode":null,"vowel":null},{"number":23,"id":"lesson-23","title":"Tanween — Fathatain (Two Zabar: ـً)","title_ar":"التنوين: فتحتان (دو زبر)","subtitle":"29 Letters with Double Fatha \u0026 Hidden Noon Sound","rules":["While pronouncing Tanween, the sound of the letter should not be prolonged such as بٌ should be read بن not بون","The rules of Tanween will be mentioned gradually in upcoming topics."],"words":["اً","بًا","تًا","ثًا","جًا","حًا","خًا","دًا","ذًا","رًا","زًا","سًا","شًا","صًا","ضًا","طًا","ظًا","عًا","غًا","فًا","قًا","كًا","لًا","مًا","نًا","وًا","هًا","ءًا","يًا"],"type":"tanween_letters","mode":"fathatan","vowel":null},{"number":24,"id":"lesson-24","title":"Fathatain Practice Exercise","title_ar":"تمرين فتحتين (دو زبر)","subtitle":"30 Practice Words with Double Fatha","rules":["Exercise: Practice words with Tanween Fathatain (ـً - Two Zabar).","Notice the hidden Noon Sakin sound at the end (e.g. عَلِيمًا -\u003e \u0027Aleeman\u0027).","When stopping (Waqf) on Fathatain, recite it as an Alif Maddah (عَلِيمَا)."],"words":["اَحَدًا","مَیْتًا","شَوْبًا","عَبَثًا","فَوْزًا","نَشَطًا","شِیْبًا","عَمَلًا","بَلَدًا","طَبَقًا","سَلَمًا","اَسَفًا","جُنُبًا","حَسَنًا","قَصَصًا","كَذِبًا","سَفَهًا","وَسَطًا","كُفُوًا","مَثَلًا","عَامًا","لُوْطًا","زَبُوْرًا","مُسْلِمًا","حِسَابًا","نَبَاتًا","شِدَادًا","عَذَابًا","وِفَاقًا","یَھُوْدِیًّا"],"type":"words_grid","mode":null,"vowel":null},{"number":25,"id":"lesson-25","title":"Tanween — Kasratain (Two Zer: ـٍ)","title_ar":"التنوين: كسرتان (دو زير)","subtitle":"29 Letters with Double Kasra \u0026 Hidden Noon Sound","rules":["After describing the lesson of Kasra ( ـِـ ) , the lesson on Kasratain ( ـٍـ ) is being mentioned, so that you may become able to understand the differences between the two.","If there is Double Kasrath/Zair on the last letter, it will be pronounced with Sakoon instead of Tanween while, stopping on the last letter."],"words":["اٍ","بٍ","تٍ","ثٍ","جٍ","حٍ","خٍ","دٍ","ذٍ","رٍ","زٍ","سٍ","شٍ","صٍ","ضٍ","طٍ","ظٍ","عٍ","غٍ","فٍ","قٍ","كٍ","لٍ","مٍ","نٍ","وٍ","هٍ","ءٍ","ىٍ"],"type":"tanween_letters","mode":"kasratan","vowel":null},{"number":26,"id":"lesson-26","title":"Kasratain Practice Exercise","title_ar":"تمرين كسرتين (دو زير)","subtitle":"30 Practice Words with Double Kasra","rules":["Exercise: Practice words with Tanween Kasratain (ـٍ - Two Zer).","Pronounce the hidden Noon Sakin sound crisply (e.g. يَوْمٍ -\u003e \u0027Yawmin\u0027).","When stopping on Kasratain, drop the Tanween and stop with Sukoon (يَوْمْ)."],"words":["بِدَمٍ","کَافٍ","ضَیْقٍ","جَازٍ","غَیْثٍ","وَاقٍ","كَذِبٍ","لَبَنٍ","نَاجٍ","عِنَبٍ","بِيَدٍ","زَانٍ","ثَمَنٍ","مَسَدٍ","سَخَطٍ","عَمَلٍ","غَضَبٍ","حَسَنٍ","نَفْسٍ","مَثَلٍ","لِغَدٍ","نُوْحٍ","اَجَلٍ","سَبَاٍ","هُمَزَةٍ","نَفَقَةٍ","لُمَزَةٍ","بِقَبَسٍ","قِیَامٍ","یَوْمَئِذٍ"],"type":"words_grid","mode":null,"vowel":null},{"number":27,"id":"lesson-27","title":"Tanween — Dammatain (Two Pesh: ـٌ)","title_ar":"التنوين: ضمتان (دو پيش)","subtitle":"29 Letters with Double Damma \u0026 Hidden Noon Sound","rules":["The double Dhamma always appeared on the letter.","If there is Double Dhamma on the last letter, it will be pronounced with Sakoon instead of Tanween while, stopping on the last letter.","If you still face problems in recognizing the movement then revise all the lessons mentioned before."],"words":["اٌ","بٌ","تٌ","ثٌ","جٌ","حٌ","خٌ","دٌ","ذٌ","رٌ","زٌ","سٌ","شٌ","صٌ","ضٌ","طٌ","ظٌ","عٌ","غٌ","فٌ","قٌ","كٌ","لٌ","مٌ","نٌ","وٌ","هٌ","ءٌ","ىٌ"],"type":"tanween_letters","mode":"dammatan","vowel":null},{"number":28,"id":"lesson-28","title":"Dammatain Practice Exercise","title_ar":"تمرين ضمتين (دو پيش)","subtitle":"26 Practice Words with Double Damma","rules":["Exercise: Practice words with Tanween Dammatain (ـٌ - Two Pesh).","Round both lips cleanly while producing the hidden Noon sound (e.g. غَفُورٌ -\u003e \u0027Ghafoorun\u0027).","When stopping on Dammatain, drop the Tanween and stop with Sukoon (غَفُورْ)."],"words":["اسُنَنٌ","دِیَۃٌ","جُدَدٌ","نَزْغٌ","عَدُوٌّ","حِطَّۃٌ","نَوْمٌ","سِنَۃٌ","ظُلَلٌ","قِطَعٌ","خُشُبٌ","زَبَدٌ","كُتُبٌ","قَدَمٌ","خُلُقٌ","اُمَمٌ","ظَمَاٌ","اُذُنٌ","قَسَمٌ","نَصَبٌ","فَطَلٌّ","زَیْدٌ","كَلِمَةٌ","حَسَنَةٌ","قَیِّمَۃٌ","مُحَمَّدٌ"],"type":"words_grid","mode":null,"vowel":null},{"number":29,"id":"lesson-29","title":"Standing Fatha (Khari Zabar: ـٰ)","title_ar":"الفتحة القائمة (کھڑی زبر)","subtitle":"29 Letters with Vertical Standing Fatha","rules":["Standing Fatha is placed on the letter.","Standing Fatha will be prolonged equal to one Alif such as Alif Madda.","If there is standing Fatha on the last letter, it will be pronounced as Alif , as it is, not to be changed while, stopping on the last letter."],"words":["اٰ","بٰ","تٰ","ثٰ","جٰ","حٰ","خٰ","دٰ","ذٰ","رٰ","زٰ","سٰ","شٰ","صٰ","ضٰ","طٰ","ظٰ","عٰ","غٰ","فٰ","قٰ","كٰ","لٰ","مٰ","نٰ","وٰ","هٰ","ءٰ","ىٰ"],"type":"standing_letters","mode":"standing_fatha","vowel":null},{"number":30,"id":"lesson-30","title":"Standing Fatha Practice Exercise","title_ar":"تمرين کھڑی زبر","subtitle":"29 Practice Words with Standing Fatha","rules":["Exercise: Practice words containing Standing Fatha (ـٰ - کھڑی زبر).","Standing Fatha is equivalent to an Alif Maddah and must be prolonged for 2 Harakat.","Examples: مٰلِكِ (Maaliki), هٰذَا (Haadhaa)."],"words":["سَجٰى","قَلٰى","عَلٰى","عَسٰى","طَغٰى","دَغٰى","اِلٰى","اَتٰى","دَنٰى","عَصٰى","اٰدَمَ","مُوْسٰى","عِيْسٰى","یَحْیٰی","اِسْحٰقَ","اٰيٰتٌ","اٰلٰفٍ","بِاٰيَةٍ","سَلٰمٌ","الصَّلٰوةَ","اَلزَّکوٰةَ","اٰمِنَةً","اَلْاَعْلیٰ","مُنٰفِقُونَ","اَلتّٰبِعِیْنَ","اَلْقِیٰمَةِ","نَفّٰثٰتِ","وَعَلَی اَلثَّلٰثَۃِ","اَلْمَسْجِدِ الْاَقْصٰی"],"type":"words_grid","mode":null,"vowel":null},{"number":31,"id":"lesson-31","title":"Standing Kasra (Khari Zer: ـٖ)","title_ar":"الكسرة القائمة (کھڑی زير)","subtitle":"29 Letters with Subscript Standing Kasra","rules":["Standing Fatha is placed on the letter.","Standing Fatha will be prolonged equal to one Alif such as Alif Madda.","If there is standing Fatha on the last letter, it will be pronounced as Alif , as it is, not to be changed while, stopping on the last letter."],"words":["اٰ","بٰ","تٰ","ثٰ","جٰ","حٰ","خٰ","دٰ","ذٰ","رٰ","زٰ","سٰ","شٰ","صٰ","ضٰ","طٰ","ظٰ","عٰ","غٰ","فٰ","قٰ","كٰ","لٰ","مٰ","نٰ","وٰ","هٰ","ءٰ","ىٰ"],"type":"standing_letters","mode":"standing_kasra","vowel":null},{"number":32,"id":"lesson-32","title":"Standing Kasra Practice Exercise","title_ar":"تمرين کھڑی زير","subtitle":"28 Practice Words with Standing Kasra","rules":["Exercise: Practice words containing Standing Kasra (ـٖ - کھڑی زير).","Standing Kasra is equivalent to a Yaa Maddah and must be prolonged for 2 Harakat.","Examples: بِهٖ (Bihee), عِبَادِهٖ (\u0027Ibaadihee)."],"words":["بِهٖ","حُبِّهٖ","اُمِّهٖ","کُلِّهٖ","فِيْهٖ","اُحْىٖ","هٰذِهٖ","بِيَدِهٖ","قَلْبِهٖ","خِلٰلِهٖ","عَمَلِهٖ","مُوْسٰى","بَعْدِهٖ","كُتُبِهٖ","تُقٰتِهٖ","قِيْلِهٖ","سُوْقِهٖ","نَفْسِهٖ","بِوَجْهِهٖ","اٖلٰفِهِمْ","طَعَامِهٖ","يَسْتَحْىٖ","بِعَبْدِهٖ","بِوَلَدِهٖ","سُلْطٰنِهٖ","صٰحِبَتِهٖ","بِیَمِیْنِهٖ","بِمُزَحْزِحِهٖ"],"type":"words_grid","mode":null,"vowel":null},{"number":33,"id":"lesson-33","title":"Inverted Damma (Ulta Pesh: ـٗ)","title_ar":"الضمة المقلوبة (الٹا پيش)","subtitle":"30 Letters with Inverted Damma","rules":["Dhmma also comes in its standing shape/Form.","It is placed on the letter.","Try to learn the difference between Dhmma and Standing Dhmma, considering in shape and sound.","It will be pronounced as Wavo Madda.","If there is standing Dhmma on the last letter, it will be pronounced with Sakoon and the Jazm will be considered to be on the last letter while, stopping."],"words":["اٗ","بٗ","تٗ","ثٗ","جٗ","حٗ","خٗ","دٗ","ذٗ","رٗ","زٗ","سٗ","شٗ","شٰ","صٗ","ضٗ","طٗ","ظٗ","عٗ","غٗ","فٗ","قٗ","کٗ","لٗ","مٗ","نٗ","وٗ","ھٗ","ءٗ","یٗ"],"type":"standing_letters","mode":"inverted_damma","vowel":null},{"number":34,"id":"lesson-34","title":"Inverted Damma Practice Exercise","title_ar":"تمرين الٹا پيش","subtitle":"29 Practice Words with Inverted Damma","rules":["Exercise: Practice words containing Inverted Damma (ـٗ - الٹا پيش).","Inverted Damma is equivalent to a Waaw Maddah and must be prolonged for 2 Harakat.","Examples: لَهٗ (Lahoo), دَاوٗدُ (Daawoodu)."],"words":["مَعَهٗ","خِتٰمُهٗ","عِنْدَہٗ","حَسْبُہٗ","بَعْضَہٗ","قَبْلَہٗ","کِتٰبَهٗ","قَلْبَہٗ","فِصٰلُهٗ","عَمَلُهٗ","يَلْوٗنَ","قَتَلَهٗ","دَاوٗدَ","مَالَہٗ","قِیَامَهٗ","يَسْتَوٗنَ","سُبْحٰنَهٗ","وَثَاقَهٗ","مَوْءٗدَةُ","اَطْعَمَهٗ","عِبَادُهٗ","قَبْضَتُهٗ","نَادِیَہٗ","بَیَانَہٗ","یُبْدِلَہٗ","وَوَلَدُہٗ","مَوٰزِیْنُہٗ","سَنَسِمُہٗ","لَایَاْکُلُہٗ"],"type":"words_grid","mode":null,"vowel":null},{"number":35,"id":"lesson-35","title":"Rules of Laam in Lafz-e-Jalalah (Allah)","title_ar":"أحكام لام لفظ الجلالة (الله)","subtitle":"Heavy (Tafkheem) vs Light (Tarkeeq) Pronunciation","rules":["The letter Laam except the Laam of the name of Allah will be always pronounced with empty mouth.","This rule will be implemented in the Laam of Allahumma ,because there is the word Allah."],"words":["اَللّٰـهُ","لِلّٰہِ","فَاللّٰـهُ","وَاللّٰـهُ","بِاللّٰـهِ","تَاللّٰہِ","فِی اللّٰہِ","عَلٰی اللّٰہِ","اِلٰی اللّٰہِ","فَضْلُ اللّٰـهِ","بِسْمِ اللّٰهِ","وَجْهُ اللّٰـهِ","دُوْنِ اللّٰہِ","خَتَمَ اللّٰہُ","بِاِذْنِ اللّٰہِ","سَبِیْلِ  اللّٰہِ","عَبْدُاللّٰہِ","اَللّٰھُمَّ","قُلِ اللّٰهُمَّ","قَالُوااللّٰهُمَّ"],"type":"rules_laam","mode":null,"vowel":null},{"number":36,"id":"lesson-36","title":"Rules of Raa — Tafkheem \u0026 Tarkeeq","title_ar":"أحكام الراء: التفخيم والترقيق","subtitle":"Rules of Heavy (Thick) \u0026 Light (Thin) Letter Raa","rules":["If there is Fatha or Dhamma on the letter Raa then the letter Raa will be pronounced with bold voice, with a full mouth, if there is Kasra then it will be recited slightly with empty mouth.Examples: رجال ربما ربك","If the letter before is also with sakoon then all the rules will be implemented with the same way while considering in Mutaharrek Letter.Examples: .ذي الذكر بكم العسر ليلة القدر If there is Yaa sakina before Raa sakina then Raa will be recited slightly forever.Examples: خير قدير","If we do stop on the letters Misra مصر, Ain-ul-Qitr عين القطر then it can be recited with bold and light voice but it is much better to pronounce it according to the haraka of Raa and it should be considered.","The Raa of the word Majre`haa مجرها will be recited with empty mouth (MuraQQaQ).","There is one way of stopping where we need to appear the harakath of last letter while stopping on it,if there is kasra or dhamma, such rule is called (Raw`m),in this regard,all the rules will be applied according to the haraka of last letter."],"words":["اَرْ","اِرْ","اُرْ"],"type":"rules_raa","mode":null,"vowel":null},{"number":37,"id":"lesson-37","title":"Rules of Raa Practice Exercise","title_ar":"تمرين أحكام الراء","subtitle":"36 Practice Words with Bold \u0026 Light Raa","rules":["Exercise: Practice reading words containing letter Raa (ر) under all Tajweed conditions.","Pronounce Raa with full heavy mouth (Tafkheem) when carrying Fatha or Damma.","Pronounce Raa with thin light mouth (Tarkeeq) when carrying Kasra or preceded by Yaa Sakinah."],"words":["سُرُرٌ","فَرَضَ","بَدْرٍ","تَجْرِىْ","اَلْعَصْرِ","اَلْفَجْرِ","اِقْرَاْ","بَقَرَۃً","عُزَیْرُ","قُرَیْشٍ","خَبِيْرٌ","کَافِرٌ","اَ لَمْ تَرَ","سَرَابًا","نَخِرَةً","فِرْعَوْنَ","رُسُلُنَا","بِقُرْاٰنٍ","يُدْرِيْكَ","اِبْرٰهٖمَ","اِدْرِیْسَ","جِبْرِیْلَ","زَکَرِیَّا","اَلرُّبُعُ","اَلتَّوْرٰۃَ","بِالصَّبْرِ","اَلْکَوْثَرَ","اَلْقَارِعَةُ","اَلْمُدَّثِّرُ","مَرْجِعُكُمْ","نَصْرُاللهِ","ذِی الْقَرْنَیْنِ","بِكُمُ الْعُسْرَ","وَاسْتَغْفِرْهُ","اَلْمَسْجِدِ الْحَرَامِ","اَلْهٰٮكُمُ التَّكَاثُرُ"],"type":"words_grid","mode":null,"vowel":null},{"number":38,"id":"lesson-38","title":"Noon Sakin \u0026 Tanween — Izhaar-e-Halqi","title_ar":"أحكام النون الساكنة والتنوين: الإظهار الحلقي","subtitle":"Clear Pronunciation for 6 Throat Letters (ء هـ ع ح غ خ)","rules":["If any of throttle letters, such as خ، غ، ح، ع، ه، ء appears after ن sakin and Tanween then it will be pronounced without nasal sound and it is called Izhar-e-Halqi.","Tanween is just like Noon Sakin but the written form/shape is different and all these rules will be implemented in both.","After pronouncing ن the next letter should be read immediately, whereas sometime nasal sound could be originated."],"words":["مِنْهُ","يَنْهَوْنَ","اَنْعَمْتَ","مِنْ حَىْ","مِنْ غِلٍّ","مِنْ عِلْمٍ","مِنْ خَیْرٍ","مَنْ اٰمَنَ","مِنْ حِکْمَةٍ","اَلْمُنْخَنِقَةُ","فَمَنْ اُوْتِیَ","عَذَابًااَلِیْمًا","نُوْحًاهَدَيْنَا","قُرْاٰنًاعَرَبِیًّا","بِغُلٰمٍ حَلِیْمٍ","فَسَیُنْغِضُوْنَ","رَبٌّ غَفُوْرٌ","عَلِیْمٌ خَبِیْرٌ"],"type":"noon_sakin_izhaar","mode":null,"vowel":null},{"number":39,"id":"lesson-39","title":"Noon Sakin \u0026 Tanween — Idghaam","title_ar":"أحكام النون الساكنة والتنوين: الإدغام","subtitle":"Merging with Yarmaloon (ي ر م ل و ن): With \u0026 Without Ghunnah","rules":["Idgham (Merging/Joining) is a rule wherein one letter is being merged into other ,if any of the (YARMALUN) Letters ى، ر، ل، م، و، ن appears after Noon Sakin then we will merge the sound of Noon sakin and Tanween with respective letters and we have two types of Idgham.","If letter ن، ى، م، و appears after ن Sakin or Tanween, then it will be pronounced with nasal sound ,is called Idgham with (Ghunnah).","If the letters ل، ر comes after ن Sakin or Tanween, then it will be pronounced without nasal sound and is called Idgham without (Ghunnah)."],"words":["مِنْ مَّنْ","مِنْ نُّوْرٍ","مِنْ مَّمْتَ","مِنْ وَّالٍ","مِنْ وَّلِىٍّ","مَنْ یَّقُوْلُ","مَنْ یَّکْفُرُ","عَیْنًایَّشْرَبُ","مِنْ نُّطْفَةٍ","خَیْرٌنُّزُلًا","لَيْلَةٍ مُّبٰرَكَةٍ","عَادًاوَّثَمُوْدَ","یَکُنْ  لَّهٗ","مَنْ رَّحِمَ","مِنْ رَّبِّھِمْ","مِنْ لَّدُنْهُ","قِیَامًالِّنَّاسِ","عِیْشَةٍرَّاضِیَةٍ"],"type":"noon_sakin_idghaam","mode":null,"vowel":null},{"number":40,"id":"lesson-40","title":"Noon Sakin \u0026 Tanween — Iqlaab","title_ar":"أحكام النون الساكنة والتنوين: الإقلاب","subtitle":"Conversion of Noon Sakin / Tanween into Meem before Baa (ب)","rules":["Iqlaab Means to chnage.","If ب comes after ن sakin and Tanween , then the sound of ن will be changed with Meem, such type of changing is called IQlaab, for instance: .","While applying the rule of Iqlaab, the sound of Ikhfa (Hiding) and Nasal sound (Ghunnah), will be originated equal to one Alif.","In order to describe the rule of Iqlaab, in Quran the small letter of Meem is placed on the letter Noon."],"words":["تُنْۢبِتُ","فَانْۢبِذْ","اَنْۢبَتَتْ","سُنْۢبُلَةٍ","مِنْۢ بَنِىْ","صُمٌّۢ بُكْمٌ","مِنْۢ بَقْلِهَا","خَبِيْرًۢابَصِيْرًا","لَـيًّۢابِاَلْسِنَتِهِمْ","وَيَسْتَنْۢبِئُوْنَكَ","جَنَّةٍۭ بِرَبْوَةٍ","لَامَرْحَبًۢابِهِمْ"],"type":"noon_sakin_iqlaab","mode":null,"vowel":null},{"number":41,"id":"lesson-41","title":"Noon Sakin \u0026 Tanween — Ikhfaa Haqeeqi","title_ar":"أحكام النون الساكنة والتنوين: الإخفاء الحقيقي","subtitle":"Light Nasal Concealment for 15 Specific Letters","rules":["If any of these letters ق، ك، ف، ط، ظ، ص، ض، س، ش، ذ، ز، د، ج، ث، ت comes after ن sakin and Tanween excluding 13 letters, 6 throttle, Baa and 6 Idgham Letters, then we will hide the sound of Noon Sakin and tanween while doing Ikhfaa,such rule is called Ikhfa HaQeeQi.","The sound of Ikhfa must not be merged with Ghunna, as we do in Idgham and not be appeared, as we do in Izhar.","The Ikhfa (Hiding) will be made equal to one Alif and the measure/duration of one Alif is being known by closing or opening a finger.","All the stopping rules will be same as mentioned before ,while following the rules of Noon Sakin and Tanween including Meem."],"words":["عِنْدِهٖ","فَانْصَبْ","اُنْظُرْ","اَنْ تَعْدِلُوْا","مَنْثُوْرًا","مِنْ عِلْمٍ","مِنْ خَیْرٍ","مَنْ اٰمَنَ","عَنْ ذِكْرِىْ","مَانَنْسَخْ","اَنْشَاْنَا","مَنْصُوْرًا","نَارًاذَاتَ","حُبًّاجَمًّا","بِدَمٍ كَذِبٍ","لَحْمًاطَرِيًّا","سَلَامًاسَلَامًا","سَبْعًاشِدَادًا","ظِلًّاظَلِيْلًا","قِسْمَةٌ ضِيْزٰى","بِرِيْحٍ صَرْصَرٍ"],"type":"noon_sakin_ikhfaa","mode":null,"vowel":null},{"number":42,"id":"lesson-42","title":"Rules of Meem Sakin (Idghaam, Ikhfaa, Izhaar)","title_ar":"أحكام الميم الساكنة (الإدغام، الإخفاء، الإظهار الشفوي)","subtitle":"Shafawi Rules of Quiescent Meem","rules":["There are three rules of Meem Sakin.","If Meem Sakin followed by another letter Meem then there will be merging sound and it is called Idgham Shafawi.","If Meem Sakin followed by letter Baa then there will be Ikhfa (Hiding) and it is called Ikhfa Shafawi.","If Meem Sakin followed by any letter other than Meem and Baa then there will be Izhar and it is called Izhar Shafawi."],"words":["لَكُمْ مَّا","لَمْ يَلِدْ","عَنْ اَمْرِىْ","رَبَّهُمْ بِهِمْ","لَكُمْ مِّيْعَادُ","لَكُمْ دِيْنُكُمْ","اَنَّهُنْ خَیْرٍ","اَنَّهُمْ  مَّانِعَتُهُمْ","اِلَيْكُمْ مُّرْسَلُوْنَ","عَلَيْكُمْ مَّوْثِقًا","فَهُمْ مُّقْمَحُوْنَ","وَمَاهُمْ بِمُؤْمِنِيْنَ","يَعْتَصِمْ بِاللّٰهِ","فَاحْكُمْ بَيْنَهُمْ","اُرْسِلْتُمْ بِهٖ","اَعِظُكُمْ بِوَاحِدَةٍ","فَلَهُمْ اَجْرُهُمْ","بَعْضُكُمْ لِبَعْضٍ","وَلَهُمْ عَذَابٌ"],"type":"meem_sakin","mode":null,"vowel":null},{"number":43,"id":"lesson-43","title":"Rules of Madd — Prolonging Classification","title_ar":"أحكام المد وأنواعه (المتصل، المنفصل، اللازم، العارض)","subtitle":"Madd Asli, Muttasil, Munfasil, Lazim \u0026 Aaridh","rules":["Madd means Stretching or prolonging, we have two types of Madd basically, Madd Asli and Far`ee.","Madd Asli is a type of Madd, When there will not be any Hamza or Sakoon after Madda Letter.","Muttasil","Munfasil","Aaridh","The other two types of Madd Lazim will be mentioned in the instructions of Muqatti`at Letters."],"words":["قَالَ","يَقُولُ","قِيلَ","جَآءَ","سُوٓءَ","جِيٓءَ","بِمَآ أُنْزِلَ","قُوٓا أَنْفُسَكُمْ","فِيٓ أَنْفُسِكُمْ","الضَّآلِّينَ","الْحَآقَّةُ","ءَآلْآنَ","الْعَالَمِينَ","الرَّحِيمِ","نَسْتَعِينُ"],"type":"madd_rules","mode":null,"vowel":null},{"number":44,"id":"lesson-44","title":"Rules of Madd Practice Exercise","title_ar":"تمرين أحكام المدود","subtitle":"24 Practice Words with Various Elongations","rules":["Exercise: Practice Quranic words containing various classifications of Madd.","Notice the difference in duration: Madd Asli (2 Harakat) vs Madd Muttasil/Munfasil (4-5 Harakat) vs Madd Lazim (6 Harakat).","Follow the wavy sign (ـٓ) for extended elongations."],"words":["قَالَ","يُرِيْدُ","آٰ لْـٰٔنَ","سُبَاتًا","سَرَابًا","اَنْعَامًا","قُرَيْشٍ","وَالصَّيْفِ","مِنْ خَوْفٍ","اٖلٰفِهِمْ","اِيْمَانَكُمْ","يَهْتَدُوْنَ","اٰمِنِيْنَ","خَطِيْٓــَٔتُهٗ","حُنَفَآءَ","حَدَآ ٮِٕقَ","وَاُوْذُوْا","فَالصَّالِحَاتُ","لَمْ يَلْبَثُوْۤا اِلَّا","اِنَّاۤ  اَنْزَلْنٰهُ","بِمَاۤ اَنْزَلَ اللّٰهُ","غَيْرَمُضَآرٍّ","اَتُحَآجُّوْٓنِّىْ","شَدِيْدُالْعِقَابِ"],"type":"words_grid","mode":null,"vowel":null},{"number":45,"id":"lesson-45","title":"Huroof-e-Muqatta\u0027at (Mystic Openings)","title_ar":"الحروف المقطعة في أوائل السور","subtitle":"14 Surah Openings Recited Letter-by-Letter with Madd Lazim","rules":["These letters usually come in the beginning of some Quranic surah and will have to read separately and has to be recited as they are written.","The Madd in the letter عين of كهيعص is called Madd Lazim Leen."],"words":["صٓ","قٓ","نٓ","طٰهٰ","يٰسٓ","حٰمٓ","طٰسٓ","الٓرٰ","الٓمّٓ","طٰسٓمّٓ","الٓـمّٓرٰ","الٓمّٓصٓ","حٰمٓ عٓسٓقٓ","كٓهٰيٰـعٓـصٓ"],"type":"muqattaat","mode":null,"vowel":null},{"number":46,"id":"lesson-46","title":"Rules of Noon-e-Qutni","title_ar":"أحكام نون الوقاية والقطني","subtitle":"Connecting Tanween with Hamzat-ul-Wasl (Ilteqa-us-Sakinayn)","rules":["Whenever two letters (Sakenain) come together then we will place the first sakin with Kasra according to Arabic rules as, it is difficult to pronounce it while starting with sakoon. Usually, in Non-Arab scripts of Quran, the small letter of Noon is used and This is called Noon-e-Qutni.","It is wrong to start from Noon-e-Qutni or to repeat it."],"words":["خَيْرًا ۨ الْوَصِيَّةُ","عَادًا ۨ الْأُولَىٰ","قُلْ هُوَ اللَّهُ أَحَدٌ ۞ اللَّهُ الصَّمَدُ","مَحْذُورًا ۨ انْظُرْ","مَثَلًا ۨ الْقَوْمُ","لُؤْلُؤًا ۨ انْشَقَّ","بِغُلَامٍ ۨ اسْمُهُ","جَزَاءً ۨ الْحُسْنَىٰ"],"type":"noon_qutni","mode":null,"vowel":null},{"number":47,"id":"lesson-47","title":"Silent Letters \u0026 Quranic Reading Exceptions","title_ar":"الحروف الزائدة ومستثنيات الرسم العثماني","subtitle":"Silent Alif, Waaw, Yaa and Quranic Reading Rules","rules":["Here is the list of letters where all the those words mentioned with its accurate pronunciation after omitting some letters.","All the following words should be learned considerately.","Here, the correct pronunciation of these words will make you able to understand it and you will not make a mistake while reciting the Qur’an."],"words":["اَنَا","اَنَ","لٰكِنَّ","اَلرَّسُوْلَا","اَلرَّسُوْلَ","قَوَارِيْرَ","لَا اِلَى الْجَحِيْمِ","لَاِلَى الْجَحِيْمِ","لَا اَذْبَحَنَّهٗ","لَاَذْبَحَنَّه","مِنْ نَّبَاِى","مِنْ نَّبَ اِ","وَمَلَائِهِمْ","وَمَلَئِهِمْ","وَاَنْ اَتْلُوَا","وَاَنْ اَتْلُوَ","لَنْ نّدْعُوَا","لَنْ نّدْعُوَ","مِائَتَيْنِ","مِئَتَيْنِ","بِئْسَالاِسْمُ","بِئْسَلِسْمُ"],"type":"silent_letters","mode":null,"vowel":null},{"number":48,"id":"lesson-48","title":"Waqf \u0026 Stopping Signs in the Holy Quran","title_ar":"رموز وعلامات الوقف في القرآن الكريم","subtitle":"Essential Punctuation Marks \u0026 Correct Stopping Rules","rules":["Waqf means to pause or stop at a word or phrase while reciting the Quran.","When making Waqf, you stop your voice and breath completely on the last letter of that phrase.","Waqf does not change the meaning of the word, but it affects how it is pronounced."],"words":["نَسْتَعِينُ","نَسْتَعِينْ","مِنْ قَبْلُ","مِنْ قَبْلْ","شَهْرٌ","شَهْرْ","شَيْءٌ","شَيْءْ","قِسْطٍ","قِسْطْ","يَشَآءُ","يَشَآءْ","قَدِيرٌ","قَدِيرْ","بَرْقٌ","بَرْقْ","لَهْوٌ","لَهْوْ","بِهٖ","بِهْ","عِبَادِهٖ","عِبَادِهْ","بِأَمْرِهٖ","بِأَمْرِهْ","رَبَّهٗ","رَبَّهْ","أَخْلَدَهٗ","أَخْلَدَهْ"],"type":"waqf","mode":null,"vowel":null},{"number":49,"id":"lesson-49","title":"Practical Wudhu \u0026 Daily Salah Guide","title_ar":"دليل الوضوء وصفة الصلاة العملية","subtitle":"Step-by-Step Ablution \u0026 Daily Prayer Recitations with Audio","rules":["Practical Ablution (Wudhu) Steps \u0026 Complete Daily Salah Sequence.","Ensure all required steps of Wudhu are performed in order with presence of heart.","Recite each prayer position clearly with correct Tajweed and humble devotion."],"words":[],"type":"wudhu_salah","mode":null,"vowel":null}];

  // =========================================================================
  // 3. AUDIO SYNTHESIS & PLAYBACK CONTROLLER
  // =========================================================================
  let audioContext = null;
  let currentActiveLetterId = null;
  let playbackRate = 1.0;
  let isSequentialPlaying = false;
  let sequentialTimer = null;
  let currentTourList = [];
  let currentTourIndex = 0;
  let CURRENT_ACTIVE_PAGE = 1;

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
  function playArabicPronunciation(text, itemObj, onEnd) {
    if (!text && itemObj) text = itemObj.speechText || itemObj.letter || itemObj.name || itemObj.text;
    if (!text) return;

    if (itemObj && itemObj.id) {
      highlightActiveCard(itemObj.id);
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ar-SA';
      utterance.rate = playbackRate || 1.0;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const arVoice = voices.find(v => v.lang && (v.lang.startsWith('ar') || v.lang.includes('AR')));
      if (arVoice) utterance.voice = arVoice;

      utterance.onend = () => {
        clearActiveCardHighlight();
        if (typeof onEnd === 'function') onEnd();
      };
      utterance.onerror = () => {
        clearActiveCardHighlight();
        playFallbackHarmonicChime(itemObj);
        if (typeof onEnd === 'function') onEnd();
      };

      window.speechSynthesis.speak(utterance);
    } else {
      playFallbackHarmonicChime(itemObj);
      setTimeout(() => {
        clearActiveCardHighlight();
        if (typeof onEnd === 'function') onEnd();
      }, 700);
    }
  }

  function playFallbackHarmonicChime(itemObj) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const baseFreq = itemObj && itemObj.is_heavy ? 196.00 : 261.63;
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
  function startSequentialAudioTour(items, index = 0) {
    if (!items || items.length === 0) {
      const lesson = LESSONS_REGISTRY[CURRENT_ACTIVE_PAGE - 1];
      if (lesson && lesson.words && lesson.words.length > 0) {
        items = lesson.words.map((w, idx) => ({
          id: `w_${CURRENT_ACTIVE_PAGE}_${idx}`,
          letter: (typeof w === 'object' ? (w.text || w.arabic) : w),
          name: (typeof w === 'object' ? (w.text || w.arabic) : w),
          speechText: (typeof w === 'object' && w.speech ? w.speech : (typeof w === 'object' ? (w.text || w.arabic) : w))
        }));
      } else {
        items = ALPHABETS_29;
      }
    }

    currentTourList = items;
    currentTourIndex = index;

    if (index >= currentTourList.length) {
      stopSequentialAudioTour();
      return;
    }

    isSequentialPlaying = true;
    updateTourButtonState(true);

    const item = currentTourList[index];
    playArabicPronunciation(item.speechText || item.letter || item.name, item, () => {
      if (!isSequentialPlaying) return;
      sequentialTimer = setTimeout(() => {
        startSequentialAudioTour(currentTourList, index + 1);
      }, Math.round(1300 / playbackRate));
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

  function toggleSequentialAudioTour(items) {
    if (isSequentialPlaying) {
      stopSequentialAudioTour();
    } else {
      startSequentialAudioTour(items, 0);
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
  // 5. INTERACTIVE MODAL / FOCUS CARD DETAILS POPUP
  // =========================================================================
  function openLetterDetailModal(letterId) {
    const item = ALPHABETS_29.find(l => l.id === letterId);
    if (!item) return;

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
        
        <button onclick="AlHudaInteractiveQaida.closeLetterDetailModal()" class="absolute top-4 right-4 w-9 h-9 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition border border-zinc-700/60" title="Close (Esc)">
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>

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

  function filterLetters(category) {
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

  // =========================================================================
  // 6. SPECIALIZED LESSON RENDERERS
  // =========================================================================

  // Page 1: Mufradat
  function renderLesson1Mufradat(lesson) {
    const cardsHtml = ALPHABETS_29.map(item => {
      const heavyBadge = item.is_heavy ? `<span class="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40">BOLD</span>` : '';
      const qalqalahBadge = item.qalqalah ? `<span class="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-purple-500/20 text-purple-300 border border-purple-500/40">ECHO</span>` : '';

      return `
        <div id="qaida-card-${item.id}" onclick="AlHudaInteractiveQaida.openLetterDetailModal('${item.id}')"
          class="relative bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 hover:to-zinc-900 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-md group">
          ${heavyBadge}
          ${qalqalahBadge}

          <div class="w-full flex items-center justify-between text-[11px] text-zinc-400 font-mono mt-1">
            <span class="text-zinc-500">${item.transliteration}</span>
            <span class="text-emerald-400">${item.name}</span>
          </div>

          <div class="my-3 sm:my-4">
            <span class="text-6xl sm:text-7xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500 group-hover:from-white group-hover:to-amber-300 select-none drop-shadow-[0_2px_8px_rgba(245,158,11,0.2)]">
              ${item.letter}
            </span>
          </div>

          <div class="w-full flex items-center justify-between pt-2 border-t border-zinc-800 text-[10px] text-zinc-400">
            <span class="truncate max-w-[120px] text-zinc-400">${item.category_label.split(' ')[0]}</span>
            <button onclick="event.stopPropagation(); AlHudaInteractiveQaida.playArabicPronunciation('${item.letter}', AlHudaInteractiveQaida.getLetterById('${item.id}'))" class="w-7 h-7 rounded-full bg-zinc-800 group-hover:bg-emerald-600 text-zinc-300 group-hover:text-white flex items-center justify-center transition shadow-xs">
              <i class="fa-solid fa-volume-high text-xs"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2 p-3 bg-zinc-900/90 border border-zinc-800 rounded-2xl text-xs">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-zinc-400 font-bold uppercase tracking-wider text-[10px] mr-1">Filter Letters:</span>
            <button data-filter="all" onclick="AlHudaInteractiveQaida.filterLetters('all')" class="qaida-filter-btn px-3 py-1 rounded-full font-bold bg-emerald-800 text-white border border-emerald-600 shadow-xs">All (29)</button>
            <button data-filter="throat" onclick="AlHudaInteractiveQaida.filterLetters('throat')" class="qaida-filter-btn px-3 py-1 rounded-full font-bold bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition">Throat (6)</button>
            <button data-filter="heavy" onclick="AlHudaInteractiveQaida.filterLetters('heavy')" class="qaida-filter-btn px-3 py-1 rounded-full font-bold bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition">Bold (7)</button>
            <button data-filter="qalqalah" onclick="AlHudaInteractiveQaida.filterLetters('qalqalah')" class="qaida-filter-btn px-3 py-1 rounded-full font-bold bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition">Qalqalah (5)</button>
            <button data-filter="lips" onclick="AlHudaInteractiveQaida.filterLetters('lips')" class="qaida-filter-btn px-3 py-1 rounded-full font-bold bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition">Lips (4)</button>
          </div>
          <span class="text-zinc-500 font-mono text-[11px] hidden sm:inline">Click any letter for Makhraj &amp; Audio</span>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // Page 2: Makharij
  function renderLesson2Makharij(lesson) {
    return `
      <div class="space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="p-4 rounded-2xl bg-zinc-900 border border-emerald-900/60 text-center space-y-1">
            <span class="text-2xl font-black text-emerald-400">5</span>
            <h4 class="font-extrabold text-sm text-zinc-100">Major Regions (الأعضاء الرئيسية)</h4>
            <p class="text-[11px] text-zinc-400">Throat, Tongue, Lips, Oral Cavity, Nose</p>
          </div>
          <div class="p-4 rounded-2xl bg-zinc-900 border border-emerald-900/60 text-center space-y-1">
            <span class="text-2xl font-black text-amber-400">17</span>
            <h4 class="font-extrabold text-sm text-zinc-100">Articulation Points (مخارج الحروف)</h4>
            <p class="text-[11px] text-zinc-400">Precise anatomical phonetic gates</p>
          </div>
          <div class="p-4 rounded-2xl bg-zinc-900 border border-emerald-900/60 text-center space-y-1">
            <span class="text-2xl font-black text-purple-400">32</span>
            <h4 class="font-extrabold text-sm text-zinc-100">Teeth Structure (الأسنان)</h4>
            <p class="text-[11px] text-zinc-400">Incisors, canines, premolars &amp; molars</p>
          </div>
        </div>

        <!-- 1. The Throat -->
        <div class="bg-slate-900/90 border border-emerald-900/60 rounded-2xl p-4 sm:p-5 space-y-4">
          <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h3 class="font-extrabold text-base text-emerald-400 flex items-center gap-2">
              <i class="fa-solid fa-lungs text-emerald-500"></i> 1. The Throat (الحلق - Al-Halq) — 3 Levels, 6 Letters
            </h3>
            <span class="text-xs bg-emerald-950 text-emerald-300 px-2.5 py-1 rounded-full font-mono font-bold">حروف حلقية</span>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="p-3.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-2">
              <span class="font-bold text-amber-300 text-xs">Top of Throat (أدنى الحلق)</span>
              <p class="text-zinc-300 text-[11px]">Nearest to mouth, near the uvula. Heavy sound.</p>
              <div class="flex items-center justify-center gap-4 pt-1 font-['Amiri',serif] text-3xl font-bold text-emerald-400">
                <span onclick="AlHudaInteractiveQaida.playArabicPronunciation('خ')" class="cursor-pointer hover:text-white transition">خ</span>
                <span onclick="AlHudaInteractiveQaida.playArabicPronunciation('غ')" class="cursor-pointer hover:text-white transition">غ</span>
              </div>
            </div>

            <div class="p-3.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-2">
              <span class="font-bold text-amber-300 text-xs">Middle of Throat (وسط الحلق)</span>
              <p class="text-zinc-300 text-[11px]">Center of throat at the epiglottis. Smooth, crisp.</p>
              <div class="flex items-center justify-center gap-4 pt-1 font-['Amiri',serif] text-3xl font-bold text-emerald-400">
                <span onclick="AlHudaInteractiveQaida.playArabicPronunciation('ح')" class="cursor-pointer hover:text-white transition">ح</span>
                <span onclick="AlHudaInteractiveQaida.playArabicPronunciation('ع')" class="cursor-pointer hover:text-white transition">ع</span>
              </div>
            </div>

            <div class="p-3.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-2">
              <span class="font-bold text-amber-300 text-xs">Bottom of Throat (أقصى الحلق)</span>
              <p class="text-zinc-300 text-[11px]">Deepest base near the chest and vocal cords.</p>
              <div class="flex items-center justify-center gap-4 pt-1 font-['Amiri',serif] text-3xl font-bold text-emerald-400">
                <span onclick="AlHudaInteractiveQaida.playArabicPronunciation('هـ')" class="cursor-pointer hover:text-white transition">هـ</span>
                <span onclick="AlHudaInteractiveQaida.playArabicPronunciation('ء')" class="cursor-pointer hover:text-white transition">ء</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. The Tongue -->
        <div class="bg-slate-900/90 border border-emerald-900/60 rounded-2xl p-4 sm:p-5 space-y-4">
          <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h3 class="font-extrabold text-base text-emerald-400 flex items-center gap-2">
              <i class="fa-solid fa-head-side-cough text-emerald-500"></i> 2. The Tongue (اللسان - Al-Lisaan) — 10 Points, 18 Letters
            </h3>
            <span class="text-xs bg-emerald-950 text-emerald-300 px-2.5 py-1 rounded-full font-mono font-bold">حروف اللسان</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
              <span class="font-bold text-amber-300">Deep Back of Tongue</span>
              <p class="text-zinc-300 text-[11px]">Strikes soft &amp; hard palate</p>
              <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ق (Soft) ، ك (Hard)</div>
            </div>

            <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
              <span class="font-bold text-amber-300">Center of Tongue</span>
              <p class="text-zinc-300 text-[11px]">Rises to hard roof of palate</p>
              <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ج ، ش ، ي</div>
            </div>

            <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
              <span class="font-bold text-amber-300">Side Edges of Tongue</span>
              <p class="text-zinc-300 text-[11px]">Upper molars (Tawahin)</p>
              <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ض (Molars) ، ل (Gums)</div>
            </div>

            <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
              <span class="font-bold text-amber-300">Tip &amp; Roots of Upper Teeth</span>
              <p class="text-zinc-300 text-[11px]">Strikes gums of central incisors</p>
              <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ط (Heavy) ، د ، ت</div>
            </div>

            <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
              <span class="font-bold text-amber-300">Tip &amp; Edge of Upper Teeth</span>
              <p class="text-zinc-300 text-[11px]">Soft Lithaweeyah letters</p>
              <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ظ (Heavy) ، ذ ، ث</div>
            </div>

            <div class="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
              <span class="font-bold text-amber-300">Whistling Letters (الصفير)</span>
              <p class="text-zinc-300 text-[11px]">Tip at lower central incisors</p>
              <div class="font-['Amiri',serif] text-2xl text-emerald-400 pt-1">ص (Heavy) ، ز ، س</div>
            </div>
          </div>
        </div>

        <!-- 3, 4, 5. Lips & Cavities -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="bg-slate-900/90 border border-emerald-900/60 rounded-2xl p-4 space-y-2">
            <h4 class="font-extrabold text-sm text-emerald-400">3. Lips (الشفتان)</h4>
            <p class="text-xs text-zinc-300">Faa, Baa, Meem, Waaw. Meeting of lips or rounding.</p>
            <div class="font-['Amiri',serif] text-2xl text-amber-300 font-bold">ف ، ب ، م ، و</div>
          </div>

          <div class="bg-slate-900/90 border border-emerald-900/60 rounded-2xl p-4 space-y-2">
            <h4 class="font-extrabold text-sm text-emerald-400">4. Oral Cavity (الجوف)</h4>
            <p class="text-xs text-zinc-300">Empty open mouth &amp; throat producing 3 Maddah letters.</p>
            <div class="font-['Amiri',serif] text-2xl text-amber-300 font-bold">ا (Alif) ، و (Waaw) ، ي (Yaa)</div>
          </div>

          <div class="bg-slate-900/90 border border-emerald-900/60 rounded-2xl p-4 space-y-2">
            <h4 class="font-extrabold text-sm text-emerald-400">5. Nasal Cavity (الخيشوم)</h4>
            <p class="text-xs text-zinc-300">Nasal passage producing the resonance of Ghunnah (2 Harakat).</p>
            <div class="font-['Amiri',serif] text-2xl text-amber-300 font-bold">نّ ، مّ (غنة)</div>
          </div>
        </div>
      </div>
    `;
  }

  // Page 3: Shapes of Alphabets (Murakkabat)
  function renderLesson3Shapes(lesson) {
    const lettersShapes = [
      { base: "ب", isolated: "ب", initial: "بـ", medial: "ـبـ", final: "ـب", name: "Baa" },
      { base: "ت", isolated: "ت", initial: "تـ", medial: "ـتـ", final: "ـت", name: "Taa" },
      { base: "ث", isolated: "ث", initial: "ثـ", medial: "ـثـ", final: "ـث", name: "Thaa" },
      { base: "ج", isolated: "ج", initial: "جـ", medial: "ـجـ", final: "ـج", name: "Jeem" },
      { base: "ح", isolated: "ح", initial: "حـ", medial: "ـحـ", final: "ـح", name: "Ḥaa" },
      { base: "خ", isolated: "خ", initial: "خـ", medial: "ـخـ", final: "ـخ", name: "Khaa" },
      { base: "س", isolated: "س", initial: "سـ", medial: "ـسـ", final: "ـس", name: "Seen" },
      { base: "ش", isolated: "ش", initial: "شـ", medial: "ـشـ", final: "ـش", name: "Sheen" },
      { base: "ص", isolated: "ص", initial: "صـ", medial: "ـصـ", final: "ـص", name: "Ṣaad" },
      { base: "ض", isolated: "ض", initial: "ضـ", medial: "ـضـ", final: "ـض", name: "Ḍaad" },
      { base: "ع", isolated: "ع", initial: "عـ", medial: "ـعـ", final: "ـع", name: "‘Ayn" },
      { base: "غ", isolated: "غ", initial: "غـ", medial: "ـغـ", final: "ـغ", name: "Ghayn" },
      { base: "ف", isolated: "ف", initial: "فـ", medial: "ـفـ", final: "ـف", name: "Faa" },
      { base: "ق", isolated: "ق", initial: "قـ", medial: "ـقـ", final: "ـق", name: "Qaaf" },
      { base: "ك", isolated: "ك", initial: "كـ", medial: "ـكـ", final: "ـك", name: "Kaaf" },
      { base: "ل", isolated: "ل", initial: "لـ", medial: "ـلـ", final: "ـل", name: "Laam" },
      { base: "م", isolated: "م", initial: "مـ", medial: "ـمـ", final: "ـم", name: "Meem" },
      { base: "ن", isolated: "ن", initial: "نـ", medial: "ـنـ", final: "ـن", name: "Noon" },
      { base: "هـ", isolated: "هـ", initial: "هـ", medial: "ـهـ", final: "ـه", name: "Haa" },
      { base: "ي", isolated: "ي", initial: "يـ", medial: "ـيـ", final: "ـي", name: "Yaa" }
    ];

    const rowsHtml = lettersShapes.map((s, i) => `
      <div class="p-3 bg-zinc-900/90 border border-zinc-800 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-center">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-emerald-950 text-emerald-400 font-mono text-xs flex items-center justify-center font-bold">${i + 1}</span>
          <span class="font-bold text-white text-xs">${s.name}</span>
        </div>
        <div dir="rtl" class="grid grid-cols-4 gap-2 w-full sm:w-auto font-['Amiri',serif] text-3xl font-bold">
          <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${s.base}')" class="p-2 rounded-xl bg-zinc-800/80 hover:bg-emerald-900 text-amber-300 transition" title="Isolated (منفرد)">${s.isolated}</button>
          <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${s.base}')" class="p-2 rounded-xl bg-zinc-800/80 hover:bg-emerald-900 text-amber-300 transition" title="Initial (أول)">${s.initial}</button>
          <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${s.base}')" class="p-2 rounded-xl bg-zinc-800/80 hover:bg-emerald-900 text-amber-300 transition" title="Medial (وسط)">${s.medial}</button>
          <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${s.base}')" class="p-2 rounded-xl bg-zinc-800/80 hover:bg-emerald-900 text-amber-300 transition" title="Final (آخر)">${s.final}</button>
        </div>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <div class="p-3 bg-amber-950/30 border border-amber-500/40 rounded-xl text-xs text-amber-200 flex items-center justify-between">
          <span>Notice how letters connect: <strong>Isolated &rarr; Initial &rarr; Medial &rarr; Final</strong>. Click any form to hear its sound!</span>
          <span class="font-bold font-mono text-[11px] text-amber-400">20 Primary Letters</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${rowsHtml}
        </div>
      </div>
    `;
  }

  // Page 4: Compound Letters (Joint Combinations)
  function renderLesson4Compounds(lesson) {
    const words = lesson.words || [];
    const gridHtml = words.map((w, idx) => `
      <div id="qaida-card-w_4_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}', { id: 'w_4_${idx}', name: '${w}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 hover:to-zinc-900 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-md group">
        <span class="text-[10px] font-mono text-zinc-500 group-hover:text-emerald-400">#${idx + 1}</span>
        <div class="my-3">
          <span class="text-4xl sm:text-5xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500 group-hover:from-white group-hover:to-amber-300 select-none">
            ${w}
          </span>
        </div>
        <div class="w-full pt-1.5 border-t border-zinc-800 text-[10.5px] text-zinc-400 font-mono flex items-center justify-center gap-1">
          <i class="fa-solid fa-volume-high text-xs text-emerald-400"></i> Tap to Hear
        </div>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <div class="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300 flex items-center justify-between">
          <span>Read each letter in compound words distinctly. Six non-connecting letters: (ء، ا، د، ذ، ر، ز، و).</span>
          <span class="text-emerald-400 font-bold font-mono text-[11px]">${words.length} Combinations</span>
        </div>
        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          ${gridHtml}
        </div>
      </div>
    `;
  }

  // Generic Word Grid Renderer for Exercise Pages
  function renderWordsGrid(lesson, pageNum) {
    const words = lesson.words || [];
    const gridHtml = words.map((w, idx) => `
      <div id="qaida-card-w_${pageNum}_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}', { id: 'w_${pageNum}_${idx}', name: '${w}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 hover:to-zinc-900 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-md group">
        <span class="text-[10px] font-mono text-zinc-500 group-hover:text-emerald-400">#${idx + 1}</span>
        <div class="my-3 sm:my-4">
          <span class="text-4xl sm:text-5xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500 group-hover:from-white group-hover:to-amber-300 select-none drop-shadow-[0_2px_8px_rgba(245,158,11,0.2)]">
            ${w}
          </span>
        </div>
        <div class="w-full flex items-center justify-between text-[11px] text-zinc-400 font-mono border-t border-zinc-800/80 pt-1.5">
          <span class="text-zinc-500 text-[10px]">Tap to hear</span>
          <i class="fa-solid fa-volume-high text-xs text-emerald-400 group-hover:scale-110 transition"></i>
        </div>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <div class="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300 flex items-center justify-between">
          <span>Click any word card to hear accurate Arabic pronunciation with full Tajweed cadence.</span>
          <span class="text-emerald-400 font-bold font-mono text-[11px]">${words.length} Practice Words</span>
        </div>
        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          ${gridHtml}
        </div>
      </div>
    `;
  }

  // Generic Letter Grid Renderer for Sukoon, Tashdeed, Maddah, Leen
  function renderLetterGrid(lesson, pageNum) {
    const words = lesson.words || [];
    const gridHtml = words.map((w, idx) => `
      <div id="qaida-card-w_${pageNum}_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}', { id: 'w_${pageNum}_${idx}', name: '${w}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 hover:to-zinc-900 border border-emerald-900/40 hover:border-emerald-500/60 rounded-xl p-3 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-sm group">
        <span class="text-[9px] font-mono text-zinc-500 group-hover:text-emerald-400">#${idx + 1}</span>
        <div class="my-2">
          <span class="text-3xl sm:text-4xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500 group-hover:from-white group-hover:to-amber-300 select-none">
            ${w}
          </span>
        </div>
        <div class="w-full pt-1 border-t border-zinc-800 text-[9.5px] text-zinc-500 font-mono">
          Tap to Hear
        </div>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <div class="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300 flex items-center justify-between">
          <span>Pronounce each combination firmly from its Makhraj. Click any box for audio.</span>
          <span class="text-emerald-400 font-bold font-mono text-[11px]">${words.length} Combinations</span>
        </div>
        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3">
          ${gridHtml}
        </div>
      </div>
    `;
  }

  // Page 5, 7, 9: Harakat Letters
  function renderHarakatLetters(lesson) {
    const vowelName = lesson.vowel || (lesson.number === 5 ? 'fatha' : (lesson.number === 7 ? 'kasra' : 'damma'));
    const vowelMap = {
      fatha: { name: "Fatha (Zabar)", symbol: "َ", vowel: "a", ar: "الفتحة (ـَ)" },
      kasra: { name: "Kasra (Zer)", symbol: "ِ", vowel: "i", ar: "الكسرة (ـِ)" },
      damma: { name: "Damma (Pesh)", symbol: "ُ", vowel: "u", ar: "الضمة (ـُ)" }
    };
    const cur = vowelMap[vowelName] || vowelMap.fatha;

    const cardsHtml = ALPHABETS_29.map(item => {
      let combined = item.letter + cur.symbol;
      if (item.letter === 'ا') combined = 'أ' + cur.symbol;
      const phonetic = item.transliteration + ' + ' + cur.vowel;

      return `
        <div id="qaida-card-h_${vowelName}_${item.id}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${combined}', { id: 'h_${vowelName}_${item.id}', name: '${item.name}' })"
          class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-md group">
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
        <div class="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300 flex items-center justify-between">
          <span>Short Vowel Movement: <strong>${cur.name}</strong>. Never stretch or jerk Harakat. Read smoothly!</span>
          <span class="text-emerald-400 font-bold font-mono text-[11px]">29 Letters</span>
        </div>
        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // Page 23, 25, 27: Tanween Letters
  function renderTanweenLetters(lesson) {
    const mode = lesson.mode || (lesson.number === 23 ? 'fathatan' : (lesson.number === 25 ? 'kasratan' : 'dammatan'));
    const tanweenMap = {
      fathatan: { symbol: "اً", label: "Two Zabar (Fathatayn: ـً)", suffix: "an" },
      kasratan: { symbol: "ٍ", label: "Two Zer (Kasratayn: ـٍ)", suffix: "in" },
      dammatan: { symbol: "ٌ", label: "Two Pesh (Dammatayn: ـٌ)", suffix: "un" }
    };
    const cur = tanweenMap[mode] || tanweenMap.fathatan;

    const cardsHtml = ALPHABETS_29.map(item => {
      let combined = item.letter;
      if (mode === 'fathatan') {
        combined = item.letter === 'ا' ? 'أً' : item.letter + 'اً';
      } else if (mode === 'kasratan') {
        combined = item.letter === 'ا' ? 'إٍ' : item.letter + 'ٍ';
      } else {
        combined = item.letter === 'ا' ? 'أٌ' : item.letter + 'ٌ';
      }

      return `
        <div id="qaida-card-t_${mode}_${item.id}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${combined}', { id: 't_${mode}_${item.id}', name: '${item.name}' })"
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
        <div class="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300 flex items-center justify-between">
          <span>Tanween inherently carries a Noon Sakin sound: <strong>${cur.label}</strong>.</span>
          <span class="text-emerald-400 font-bold font-mono text-[11px]">29 Letters</span>
        </div>
        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // Page 29, 31, 33: Standing Harakat Letters
  function renderStandingLetters(lesson) {
    const mode = lesson.mode || (lesson.number === 29 ? 'standing_fatha' : (lesson.number === 31 ? 'standing_kasra' : 'inverted_damma'));
    const standingMap = {
      standing_fatha: { name: "Standing Fatha (کھڑی زبر: ـٰ)", symbol: "ٰ", equiv: "Alif Maddah (2 Harakat)" },
      standing_kasra: { name: "Standing Kasra (کھڑی زير: ـٖ)", symbol: "ٖ", equiv: "Yaa Maddah (2 Harakat)" },
      inverted_damma: { name: "Inverted Damma (الٹا پيش: ـٗ)", symbol: "ٗ", equiv: "Waaw Maddah (2 Harakat)" }
    };
    const cur = standingMap[mode] || standingMap.standing_fatha;

    const cardsHtml = ALPHABETS_29.map(item => {
      const combined = item.letter + cur.symbol;

      return `
        <div id="qaida-card-s_${mode}_${item.id}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${combined}', { id: 's_${mode}_${item.id}', name: '${item.name}' })"
          class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-md group">
          <span class="text-[10px] font-mono text-zinc-500 group-hover:text-emerald-400">${item.name}</span>
          <div class="my-2">
            <span class="text-6xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
              ${combined}
            </span>
          </div>
          <span class="text-[11px] text-zinc-400 font-mono">Elongate 2 Harakat</span>
        </div>
      `;
    }).join('');

    return `
      <div class="space-y-4">
        <div class="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300 flex items-center justify-between">
          <span>${cur.name} is equivalent to: <strong>${cur.equiv}</strong>.</span>
          <span class="text-emerald-400 font-bold font-mono text-[11px]">29 Letters</span>
        </div>
        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // Page 15: Ghunnah Theory
  function renderGhunnahTheory(lesson) {
    const examples = lesson.words || ["إِنَّ", "عَمَّ", "ثُمَّ", "لَمَّا", "مِمَّا", "إِنَّمَا", "جَنَّاتٍ", "أُمَّةٍ"];
    const cardsHtml = examples.map((w, idx) => `
      <div id="qaida-card-gh_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}', { id: 'gh_${idx}', name: '${w}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.2)] rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 group">
        <span class="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 font-mono">GHUNNAH</span>
        <div class="my-3">
          <span class="text-5xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
            ${w}
          </span>
        </div>
        <span class="text-[11px] text-zinc-400 font-mono">2 Harakat Nasal</span>
      </div>
    `).join('');

    return `
      <div class="space-y-5">
        <div class="p-5 rounded-2xl bg-amber-950/30 border border-amber-500/40 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div class="space-y-1.5 text-center sm:text-left">
            <span class="font-black text-amber-300 text-sm flex items-center gap-1.5 justify-center sm:justify-start">
              <i class="fa-solid fa-bell"></i> Mandatory Ghunnah on Noon &amp; Meem Mushaddad (نّ ، مّ)
            </span>
            <p class="text-zinc-300 text-[11.5px] leading-relaxed">
              Whenever the letter Noon (ن) or Meem (م) carries Tashdeed (Shaddah), Ghunnah is obligatory. Sound resonates inside the nasal cavity for exactly 2 Harakat duration.
            </p>
          </div>
          <span class="font-['Amiri',serif] text-4xl font-black text-amber-400 shrink-0">إِنَّ &bull; عَمَّ &bull; ثُمَّ</span>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // Page 17: Qalqalah Theory
  function renderQalqalahTheory(lesson) {
    const letters = ["ق", "ط", "ب", "ج", "د"];
    const examples = lesson.words || ["اَبْ", "اَتْ", "اَثْ", "اَجْ", "اَدْ", "اَطْ", "اَقْ", "يَطْمَعُ", "يَجْعَلُ", "يَدْعُو", "اَلْفَلَقِ", "مُحِيطٌ"];

    const lettersHtml = letters.map(l => `
      <div onclick="AlHudaInteractiveQaida.playArabicPronunciation('${l}')" class="p-4 rounded-2xl bg-purple-950/40 border border-purple-500/50 flex flex-col items-center justify-center cursor-pointer hover:bg-purple-900/60 transition group">
        <span class="text-5xl font-black font-['Amiri',serif] text-amber-300 group-hover:scale-110 transition">${l}</span>
        <span class="text-[10px] font-mono text-purple-300 font-bold mt-1">Qalqalah</span>
      </div>
    `).join('');

    const examplesHtml = examples.map((w, idx) => `
      <div id="qaida-card-ql_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}', { id: 'ql_${idx}', name: '${w}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-purple-600/60 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-sm group">
        <span class="text-[9px] font-mono text-zinc-500">#${idx + 1}</span>
        <div class="my-2">
          <span class="text-4xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
            ${w}
          </span>
        </div>
        <span class="text-[10.5px] text-purple-300 font-mono">Echo Bounce</span>
      </div>
    `).join('');

    return `
      <div class="space-y-5">
        <div class="p-5 rounded-2xl bg-purple-950/40 border border-purple-600/50 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div class="space-y-1.5 text-center sm:text-left">
            <span class="font-black text-purple-300 text-sm flex items-center gap-1.5 justify-center sm:justify-start">
              <i class="fa-solid fa-wave-square"></i> The 5 Bouncing Letters of Qalqalah (قُطْبُ جَدٍّ)
            </span>
            <p class="text-zinc-300 text-[11.5px] leading-relaxed">
              When any of these 5 letters carry Sukoon (Jazm) or when stopping upon them at the end of an Ayah, their sound echoes with vibrant rebound.
            </p>
          </div>
          <span class="font-['Amiri',serif] text-4xl font-black text-amber-300 shrink-0">قُطْبُ جَدٍّ</span>
        </div>

        <div dir="rtl" class="grid grid-cols-5 gap-3">
          ${lettersHtml}
        </div>

        <div class="pt-2">
          <h4 class="text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">Interactive Demonstration Words:</h4>
          <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            ${examplesHtml}
          </div>
        </div>
      </div>
    `;
  }

  // Page 35: Rules of Laam
  function renderRulesLaam(lesson) {
    const boldWords = ["اَللّٰـهُ", "فَاللّٰـهُ", "وَاللّٰـهُ", "قَالَ اللّٰهُ", "نَصْرُ اللّٰهِ", "سُبْحَانَ اللّٰهِ"];
    const lightWords = ["لِلّٰہِ", "بِاللّٰـهِ", "بِسْمِ اللّٰهِ", "قُلِ اللّٰهُمَّ", "دِينِ اللّٰهِ"];

    const renderWordCards = (arr, badgeClass, badgeText) => arr.map((w, idx) => `
      <div onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}')"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-md group">
        <span class="px-2 py-0.5 rounded text-[9px] font-bold ${badgeClass}">${badgeText}</span>
        <div class="my-3">
          <span class="text-4xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
            ${w}
          </span>
        </div>
        <span class="text-[10.5px] text-zinc-400 font-mono">Tap to Hear</span>
      </div>
    `).join('');

    return `
      <div class="space-y-6">
        <div class="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/40 space-y-3">
          <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
            <h4 class="font-extrabold text-sm text-amber-300 flex items-center gap-2">
              <i class="fa-solid fa-volume-high"></i> 1. Heavy Laam / Tafkheem (مفخمة)
            </h4>
            <span class="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-bold">Preceded by Fatha / Damma</span>
          </div>
          <p class="text-xs text-zinc-300">When the letter before Lafz-e-Jalalah Allah has a Fatha or Damma, the Laam is recited with a full, thick, heavy mouth.</p>
          <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-1">
            ${renderWordCards(boldWords, 'bg-amber-500/20 text-amber-300 border border-amber-500/40', 'BOLD')}
          </div>
        </div>

        <div class="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/40 space-y-3">
          <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
            <h4 class="font-extrabold text-sm text-emerald-300 flex items-center gap-2">
              <i class="fa-solid fa-volume-low"></i> 2. Light Laam / Tarkeeq (مرققة)
            </h4>
            <span class="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-bold">Preceded by Kasra</span>
          </div>
          <p class="text-xs text-zinc-300">When the letter before Lafz-e-Jalalah Allah has a Kasra (Zer), the Laam is recited with a crisp, light, thin mouth.</p>
          <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pt-1">
            ${renderWordCards(lightWords, 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40', 'LIGHT')}
          </div>
        </div>
      </div>
    `;
  }

  // Page 36: Rules of Raa
  function renderRulesRaa(lesson) {
    const rulesBold = [
      "Raa carries a Fatha (رَ) or Damma (رُ).",
      "Raa Sakin (رْ) preceded by a Fatha or Damma (e.g. أَرْ، أُرْ).",
      "Raa Sakin preceded by an accidental/temporary Kasra.",
      "Raa Sakin followed by a heavy letter (حروف استعلاء) in the same word (e.g. قِرْطَاس)."
    ];
    const rulesLight = [
      "Raa carries a Kasra (رِ).",
      "Raa Sakin (رْ) preceded by an original Kasra (e.g. فِرْعَوْن).",
      "Raa Sakin preceded by a Yaa Sakinah (يْ) upon stopping (e.g. خَيْرْ، قَدِيرْ)."
    ];

    const words = lesson.words || ["اَرْ", "اِرْ", "اُرْ"];
    const wordsHtml = words.map(w => `
      <div onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}')" class="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 transition">
        <span class="text-4xl font-bold font-['Amiri',serif] text-amber-300">${w}</span>
      </div>
    `).join('');

    return `
      <div class="space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div class="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/40 space-y-2">
            <h4 class="font-extrabold text-sm text-amber-300">Heavy Raa / Tafkheem (مفخمة):</h4>
            <ul class="list-disc list-inside space-y-1 text-zinc-300 text-[11.5px]">
              ${rulesBold.map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
          <div class="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/40 space-y-2">
            <h4 class="font-extrabold text-sm text-emerald-300">Light Raa / Tarkeeq (مرققة):</h4>
            <ul class="list-disc list-inside space-y-1 text-zinc-300 text-[11.5px]">
              ${rulesLight.map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
        </div>

        <div dir="rtl" class="grid grid-cols-3 gap-3">
          ${wordsHtml}
        </div>
      </div>
    `;
  }

  // Page 38: Izhaar Halqi
  function renderNoonSakinIzhaar(lesson) {
    const letters = ["ء", "هـ", "ع", "ح", "غ", "خ"];
    const words = lesson.words || [];

    const lettersHtml = letters.map(l => `
      <div onclick="AlHudaInteractiveQaida.playArabicPronunciation('${l}')" class="p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/50 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-900/60 transition group">
        <span class="text-3xl font-black font-['Amiri',serif] text-amber-300 group-hover:scale-110 transition">${l}</span>
      </div>
    `).join('');

    const wordsHtml = words.map((w, idx) => `
      <div id="qaida-card-w_38_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}', { id: 'w_38_${idx}', name: '${w}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-emerald-900/40 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-sm group">
        <span class="text-[9px] font-mono text-zinc-500">#${idx + 1}</span>
        <div class="my-2.5">
          <span class="text-4xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
            ${w}
          </span>
        </div>
        <span class="text-[10.5px] text-emerald-400 font-mono">Clear (No Ghunnah)</span>
      </div>
    `).join('');

    return `
      <div class="space-y-5">
        <div class="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2 text-xs">
          <div class="flex items-center justify-between">
            <span class="font-extrabold text-emerald-400 text-sm">6 Throat Letters of Izhaar (حروف الحلق):</span>
            <span class="text-amber-300 font-bold font-mono">Clear Articulation</span>
          </div>
          <p class="text-zinc-300 text-[11.5px]">If any of these 6 letters appear after Noon Sakin (نْ) or Tanween (ـً ـٍ ـٌ), pronounce the Noon clearly without Ghunnah.</p>
          <div dir="rtl" class="grid grid-cols-6 gap-2 pt-1">
            ${lettersHtml}
          </div>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          ${wordsHtml}
        </div>
      </div>
    `;
  }

  // Page 39: Idghaam
  function renderNoonSakinIdghaam(lesson) {
    const words = lesson.words || [];
    const wordsHtml = words.map((w, idx) => `
      <div id="qaida-card-w_39_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}', { id: 'w_39_${idx}', name: '${w}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-emerald-900/40 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-sm group">
        <span class="text-[9px] font-mono text-zinc-500">#${idx + 1}</span>
        <div class="my-2.5">
          <span class="text-4xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
            ${w}
          </span>
        </div>
        <span class="text-[10.5px] text-amber-300 font-mono">Merging (Idghaam)</span>
      </div>
    `).join('');

    return `
      <div class="space-y-5">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div class="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/40 space-y-1">
            <span class="font-bold text-amber-300">1. Idghaam with Ghunnah (يَنْمُو):</span>
            <p class="text-[11px] text-zinc-300">4 Letters: Yaa, Noon, Meem, Waaw (ي، ن، م، و). Merged with 2 Harakat nasal sound.</p>
          </div>
          <div class="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/40 space-y-1">
            <span class="font-bold text-emerald-300">2. Idghaam without Ghunnah (ر ، ل):</span>
            <p class="text-[11px] text-zinc-300">2 Letters: Raa and Laam (ر، ل). Fully merged without nasal resonance.</p>
          </div>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          ${wordsHtml}
        </div>
      </div>
    `;
  }

  // Page 40: Iqlaab
  function renderNoonSakinIqlaab(lesson) {
    const words = lesson.words || [];
    const wordsHtml = words.map((w, idx) => `
      <div id="qaida-card-w_40_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}', { id: 'w_40_${idx}', name: '${w}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.15)] rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 group">
        <span class="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 font-mono">IQLAAB</span>
        <div class="my-2.5">
          <span class="text-4xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
            ${w}
          </span>
        </div>
        <span class="text-[10.5px] text-zinc-400 font-mono">Converts to Meem</span>
      </div>
    `).join('');

    return `
      <div class="space-y-5">
        <div class="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 flex items-center justify-between gap-4 text-xs">
          <div>
            <span class="font-bold text-amber-300 text-sm">Rule of Iqlaab (الإقلاب إلى ميم):</span>
            <p class="text-zinc-300 text-[11.5px] mt-0.5">When letter Baa (ب) follows Noon Sakin or Tanween, the sound converts into a Meem Sakinah with 2 Harakat Ghunnah.</p>
          </div>
          <span class="font-['Amiri',serif] text-4xl font-black text-amber-400">نْ + ب &rarr; مْ</span>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          ${wordsHtml}
        </div>
      </div>
    `;
  }

  // Page 41: Ikhfaa Haqeeqi
  function renderNoonSakinIkhfaa(lesson) {
    const letters = ["ت", "ث", "ج", "د", "ذ", "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ف", "ق", "ك"];
    const words = lesson.words || [];

    const wordsHtml = words.map((w, idx) => `
      <div id="qaida-card-w_41_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}', { id: 'w_41_${idx}', name: '${w}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-emerald-900/40 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-sm group">
        <span class="text-[9px] font-mono text-zinc-500">#${idx + 1}</span>
        <div class="my-2.5">
          <span class="text-4xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
            ${w}
          </span>
        </div>
        <span class="text-[10.5px] text-teal-300 font-mono">Concealment (Ikhfaa)</span>
      </div>
    `).join('');

    return `
      <div class="space-y-5">
        <div class="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2 text-xs">
          <div class="flex items-center justify-between">
            <span class="font-extrabold text-teal-400 text-sm">15 Letters of Ikhfaa Haqeeqi (الإخفاء الحقيقي):</span>
            <span class="text-zinc-400 font-mono">Nasal Concealment (2 Harakat)</span>
          </div>
          <div dir="rtl" class="flex flex-wrap items-center justify-center gap-2 font-['Amiri',serif] text-2xl font-bold text-amber-300 pt-1">
            ${letters.map(l => `<span onclick="AlHudaInteractiveQaida.playArabicPronunciation('${l}')" class="px-3 py-1 bg-zinc-800 rounded-lg hover:bg-emerald-900 cursor-pointer transition">${l}</span>`).join('')}
          </div>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          ${wordsHtml}
        </div>
      </div>
    `;
  }

  // Page 42: Meem Sakin
  function renderMeemSakin(lesson) {
    const words = lesson.words || [];
    const wordsHtml = words.map((w, idx) => `
      <div id="qaida-card-w_42_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w}', { id: 'w_42_${idx}', name: '${w}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-emerald-900/40 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-sm group">
        <span class="text-[9px] font-mono text-zinc-500">#${idx + 1}</span>
        <div class="my-2.5">
          <span class="text-4xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-400 group-hover:text-white">
            ${w}
          </span>
        </div>
        <span class="text-[10.5px] text-zinc-400 font-mono">Meem Sakin</span>
      </div>
    `).join('');

    return `
      <div class="space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div class="p-3.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
            <span class="font-bold text-amber-300">1. Idghaam Shafawi (مْ + م)</span>
            <p class="text-[11px] text-zinc-300">Meem meets Meem with Ghunnah: لَكُمْ مَا كَسَبْتُمْ</p>
          </div>
          <div class="p-3.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
            <span class="font-bold text-amber-300">2. Ikhfaa Shafawi (مْ + ب)</span>
            <p class="text-[11px] text-zinc-300">Meem meets Baa with Ghunnah: تَرْمِيهِمْ بِحِجَارَةٍ</p>
          </div>
          <div class="p-3.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 space-y-1">
            <span class="font-bold text-amber-300">3. Izhaar Shafawi (مْ + 26 Letters)</span>
            <p class="text-[11px] text-zinc-300">Clear pronunciation without Ghunnah: هُمْ فِيهَا</p>
          </div>
        </div>

        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          ${wordsHtml}
        </div>
      </div>
    `;
  }

  // Page 43: Madd Rules Classification
  function renderMaddRules(lesson) {
    const maddCategories = [
      { name: "Madd Asli / Tabee'i (المد الأصلي)", duration: "2 Harakat", desc: "Natural elongation without Hamzah or Sukoon after Madd letter.", example: "قَالَ ، يَقُولُ ، قِيلَ" },
      { name: "Madd Muttasil (المد المتصل)", duration: "4 to 5 Harakat", desc: "Hamzah comes after Madd letter in the SAME word.", example: "جَآءَ ، سُوٓءَ ، جِيٓءَ" },
      { name: "Madd Munfasil (المد المنفصل)", duration: "4 to 5 Harakat", desc: "Hamzah comes at the start of the NEXT word.", example: "بِمَآ أُنْزِلَ ، قُوٓا أَنْفُسَكُمْ" },
      { name: "Madd Lazim (المد اللازم)", duration: "6 Harakat", desc: "Permanent Sukoon or Tashdeed follows Madd letter.", example: "الضَّآلِّينَ ، الْحَآقَّةُ" },
      { name: "Madd Aaridh (المد العارض للسكون)", duration: "2, 4, or 6 Harakat", desc: "Accidental Sukoon caused by stopping (Waqf) at an Ayah end.", example: "الْعَالَمِينَ ، الرَّحِيمِ ، نَسْتَعِينُ" }
    ];

    const cardsHtml = maddCategories.map((c, i) => `
      <div class="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2 text-xs">
        <div class="flex items-center justify-between">
          <span class="font-extrabold text-amber-300 text-sm">${c.name}</span>
          <span class="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 font-bold font-mono text-[10px] border border-emerald-500/40">${c.duration}</span>
        </div>
        <p class="text-zinc-300 text-[11.5px]">${c.desc}</p>
        <div dir="rtl" class="pt-2 font-['Amiri',serif] text-2xl text-emerald-300 font-bold flex items-center gap-3">
          ${c.example.split('،').map(w => `<span onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w.trim()}')" class="cursor-pointer hover:text-white transition p-1 bg-zinc-800/80 rounded-lg">${w.trim()}</span>`).join('')}
        </div>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <div class="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300">
          Madd means stretching/prolonging. Follow the duration indicators (2, 4, 5, or 6 Harakat) below. Click any word to hear!
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // Page 45: Muqatta'at
  function renderMuqattaat(lesson) {
    const items = [
      { text: "صٓ", speech: "صَادْ", name: "Saad (6 Harakat)", surah: "Surah Saad" },
      { text: "قٓ", speech: "قَافْ", name: "Qaaf (6 Harakat)", surah: "Surah Qaaf" },
      { text: "نٓ", speech: "نُونْ", name: "Noon (6 Harakat)", surah: "Surah Al-Qalam" },
      { text: "طٰهٰ", speech: "طَا هَا", name: "Taa-Haa (2 Harakat each)", surah: "Surah Taha" },
      { text: "يٰسٓ", speech: "يَا سِينْ", name: "Yaa-Seen (2 + 6 Harakat)", surah: "Surah Yaseen" },
      { text: "حٰمٓ", speech: "حَا مِيمْ", name: "Haa-Meem (2 + 6 Harakat)", surah: "Surah Ghafir" },
      { text: "طٰسٓ", speech: "طَا سِينْ", name: "Taa-Seen (2 + 6 Harakat)", surah: "Surah An-Naml" },
      { text: "الٓرٰ", speech: "أَلِفْ لَامْ رَا", name: "Alif-Laam-Raa", surah: "Surah Yunus" },
      { text: "الٓمّٓ", speech: "أَلِفْ لَامْ مِيمْ", name: "Alif-Laam-Meem", surah: "Surah Al-Baqarah" },
      { text: "طٰسٓمّٓ", speech: "طَا سِينْ مِيمْ", name: "Taa-Seen-Meem", surah: "Surah Ash-Shu'ara" },
      { text: "الٓـمّٓرٰ", speech: "أَلِفْ لَامْ مِيمْ رَا", name: "Alif-Laam-Meem-Raa", surah: "Surah Ar-Ra'd" },
      { text: "الٓمّٓصٓ", speech: "أَلِفْ لَامْ مِيمْ صَادْ", name: "Alif-Laam-Meem-Saad", surah: "Surah Al-A'raf" },
      { text: "حٰمٓ عٓسٓقٓ", speech: "حَا مِيمْ عَيْنْ سِينْ قَافْ", name: "Haa-Meem Ayn-Seen-Qaaf", surah: "Surah Ash-Shura" },
      { text: "كٓهٰيٰـعٓـصٓ", speech: "كَافْ هَا يَا عَيْنْ صَادْ", name: "Kaaf-Haa-Yaa-Ayn-Saad", surah: "Surah Maryam" }
    ];

    const cardsHtml = items.map((it, idx) => `
      <div id="qaida-card-muq_${idx}" onclick="AlHudaInteractiveQaida.playArabicPronunciation('${it.speech}', { id: 'muq_${idx}', name: '${it.name}', speechText: '${it.speech}' })"
        class="bg-gradient-to-b from-slate-900 to-zinc-900 hover:from-emerald-950 border border-emerald-900/40 hover:border-emerald-500/60 rounded-2xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition transform hover:-translate-y-1 shadow-md group">
        <span class="text-[10px] font-mono text-emerald-400 font-bold">${it.surah}</span>
        <div class="my-3">
          <span class="text-4xl sm:text-5xl font-bold font-['Amiri',serif] text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500 group-hover:from-white group-hover:to-amber-300 select-none">
            ${it.text}
          </span>
        </div>
        <div class="w-full pt-1.5 border-t border-zinc-800 text-[10.5px] text-zinc-400 font-mono">
          ${it.name}
        </div>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <div class="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300 flex items-center justify-between">
          <span>Huroof-e-Muqatta'at are read letter-by-letter as written with full Madd Lazim (6 Harakat). Click any to recite!</span>
          <span class="text-amber-400 font-bold font-mono text-[11px]">14 Surah Openings</span>
        </div>
        <div dir="rtl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // Page 46: Noon-e-Qutni
  function renderNoonQutni(lesson) {
    const examples = [
      { written: "خَيْرًا ۨ الْوَصِيَّةُ", spoken: "خَيْرَنِ الْوَصِيَّةُ", note: "Tanween meets Hamzat-ul-Wasl" },
      { written: "عَادًا ۨ الْأُولَىٰ", spoken: "عَادَنِ الْأُولَىٰ", note: "Surah An-Najm" },
      { written: "قُلْ هُوَ اللَّهُ أَحَدٌ ۞ اللَّهُ الصَّمَدُ", spoken: "أَحَدُنِ اللَّهُ الصَّمَدُ", note: "Surah Al-Ikhlas in Wasl" },
      { written: "مَحْذُورًا ۨ انْظُرْ", spoken: "مَحْذُورَنِ انْظُرْ", note: "Surah Al-Isra" },
      { written: "مَثَلًا ۨ الْقَوْمُ", spoken: "مَثَلَنِ الْقَوْمُ", note: "Surah Al-A'raf" },
      { written: "لُؤْلُؤًا ۨ انْشَقَّ", spoken: "لُؤْلُؤَنِ انْشَقَّ", note: "Surah Al-Insan" }
    ];

    const cardsHtml = examples.map((ex, idx) => `
      <div class="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div class="text-center sm:text-left space-y-1">
          <span class="text-[10px] font-mono text-zinc-500 uppercase">Written in Mushaf:</span>
          <div dir="rtl" class="font-['Amiri',serif] text-2xl font-bold text-zinc-300">${ex.written}</div>
          <span class="text-[11px] text-zinc-400">${ex.note}</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="text-center sm:text-right space-y-1">
            <span class="text-[10px] font-mono text-emerald-400 uppercase font-bold">Pronounced Sound:</span>
            <div dir="rtl" class="font-['Amiri',serif] text-2xl font-bold text-amber-300">${ex.spoken}</div>
          </div>
          <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${ex.spoken}')" class="w-10 h-10 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white flex items-center justify-center transition shadow-sm ml-2">
            <i class="fa-solid fa-volume-high text-xs"></i>
          </button>
        </div>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <div class="p-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl text-xs text-zinc-300 space-y-1.5">
          <span class="font-extrabold text-emerald-400 text-sm">Ilteqa-us-Sakinayn (Meeting of Two Resting Letters):</span>
          <p class="text-[11.5px] leading-relaxed">
            When a word ending in Tanween is followed by Hamzat-ul-Wasl (الـ), Arabic phonetics forbids starting with a quiescent letter. Therefore, a small Noon with Kasra (<strong class="text-amber-300">نِ</strong>) is pronounced to connect the two words.
          </p>
        </div>
        <div class="space-y-3">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // Page 47: Silent Letters
  function renderSilentLetters(lesson) {
    const words = lesson.words || [];
    const pairs = [];
    for (let i = 0; i < words.length; i += 2) {
      if (i + 1 < words.length) {
        pairs.push({ written: words[i], spoken: words[i+1] });
      } else {
        pairs.push({ written: words[i], spoken: words[i] });
      }
    }

    const cardsHtml = pairs.map((p, idx) => `
      <div class="p-3.5 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-between text-xs">
        <div class="space-y-0.5">
          <span class="text-[10px] font-mono text-zinc-500">Written:</span>
          <div dir="rtl" class="font-['Amiri',serif] text-2xl font-bold text-zinc-300">${p.written}</div>
        </div>
        <div class="flex items-center gap-3">
          <div class="space-y-0.5 text-right">
            <span class="text-[10px] font-mono text-emerald-400 font-bold">Pronounced:</span>
            <div dir="rtl" class="font-['Amiri',serif] text-2xl font-bold text-amber-300">${p.spoken}</div>
          </div>
          <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${p.spoken}')" class="w-8 h-8 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white flex items-center justify-center transition">
            <i class="fa-solid fa-volume-high text-xs"></i>
          </button>
        </div>
      </div>
    `).join('');

    return `
      <div class="space-y-4">
        <div class="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-zinc-300 flex items-center justify-between">
          <span>In Uthmani Quranic script, certain letters (like Alif in أَنَا or Waaw in أُولٰئِكَ) are written but silent during recitation.</span>
          <span class="text-amber-400 font-bold font-mono text-[11px]">${pairs.length} Rules</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  // Page 48: Waqf
  function renderWaqf(lesson) {
    const signs = [
      { sym: "مـ", name: "Waqf Laazim", desc: "Mandatory stop. Continuing may alter the meaning." },
      { sym: "ط", name: "Waqf Mutlaq", desc: "Strongly recommended complete pause." },
      { sym: "ج", name: "Waqf Jaa'iz", desc: "Permissible to pause or continue equally." },
      { sym: "ز", name: "Waqf Mujawwaz", desc: "Permissible to pause, but better to continue." },
      { sym: "ص", name: "Waqf Murakh-khas", desc: "Permissible pause if out of breath." },
      { sym: "لا", name: "Laa Taqif", desc: "Do NOT stop. Connect smoothly to next word." },
      { sym: "قلى", name: "Al-Waqfu Awla", desc: "Pausing is preferred." },
      { sym: "صلى", name: "Al-Waslu Awla", desc: "Continuing is preferred." }
    ];

    const words = lesson.words || [];
    const pairs = [];
    for (let i = 0; i < words.length; i += 2) {
      if (i + 1 < words.length) {
        pairs.push({ cont: words[i], stop: words[i+1] });
      }
    }

    const signsHtml = signs.map(s => `
      <div class="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-center space-y-1">
        <span class="font-['Amiri',serif] text-3xl font-black text-amber-300">${s.sym}</span>
        <h5 class="font-bold text-xs text-emerald-400">${s.name}</h5>
        <p class="text-[10.5px] text-zinc-400">${s.desc}</p>
      </div>
    `).join('');

    const pairsHtml = pairs.map((p, idx) => `
      <div class="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-between text-xs">
        <div>
          <span class="text-[9.5px] font-mono text-zinc-500">In Continuity (وَصْل):</span>
          <div dir="rtl" class="font-['Amiri',serif] text-2xl font-bold text-zinc-300">${p.cont}</div>
        </div>
        <div class="flex items-center gap-2">
          <div class="text-right">
            <span class="text-[9.5px] font-mono text-amber-400 font-bold">At Stop (وَقْف):</span>
            <div dir="rtl" class="font-['Amiri',serif] text-2xl font-bold text-amber-300">${p.stop}</div>
          </div>
          <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${p.stop}')" class="w-8 h-8 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white flex items-center justify-center transition">
            <i class="fa-solid fa-volume-high text-xs"></i>
          </button>
        </div>
      </div>
    `).join('');

    return `
      <div class="space-y-5">
        <div>
          <h4 class="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Essential Quranic Waqf Punctuation Signs:</h4>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            ${signsHtml}
          </div>
        </div>

        <div>
          <h4 class="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">How Ending Sounds Transform Upon Waqf:</h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            ${pairsHtml}
          </div>
        </div>
      </div>
    `;
  }

  // Page 49: Practical Wudhu & Daily Salah Guide
  let currentWudhuTab = 'wudhu';

  function renderWudhuSalah(lesson) {
    const wudhuSteps = [
      { step: 1, title: "1. Niyyah & Bismillah", ar: "بِسْمِ اللَّهِ الرَّحْمٰنِ الرَّحِيمِ", desc: "Make intention in your heart and begin with Bismillah." },
      { step: 2, title: "2. Wash Hands (3x)", ar: "غَسْلُ الْيَدَيْنِ إِلَى الرُّسْغَيْنِ", desc: "Wash both hands thoroughly up to wrists 3 times, cleansing between fingers." },
      { step: 3, title: "3. Rinse Mouth (3x)", ar: "الْمَضْمَضَةُ ثَلَاثًا", desc: "Take water into mouth with right hand and swirl around 3 times." },
      { step: 4, title: "4. Sniff Water in Nose (3x)", ar: "الِاسْتِنْشَاقُ ثَلَاثًا", desc: "Sniff water gently into nostrils with right hand and expel with left hand 3 times." },
      { step: 5, title: "5. Wash Entire Face (3x)", ar: "غَسْلُ الْوَجْهِ ثَلَاثًا", desc: "Wash entire face from hairline to below chin, ear to ear, 3 times." },
      { step: 6, title: "6. Wash Arms to Elbows (3x)", ar: "غَسْلُ الْيَدَيْنِ إِلَى الْمِرْفَقَيْنِ", desc: "Wash right arm from fingertips to beyond elbow 3 times, then left arm 3 times." },
      { step: 7, title: "7. Masah of Head & Ears (1x)", ar: "مَسْحُ الرَّأْسِ وَالْأُذُنَيْنِ", desc: "Wipe wet hands over entire head from front to back and wipe inner/outer ears." },
      { step: 8, title: "8. Wash Feet to Ankles (3x)", ar: "غَسْلُ الرِّجْلَيْنِ إِلَى الْكَعْبَيْنِ", desc: "Wash right foot up to ankle 3 times including between toes, then left foot 3 times." },
      { step: 9, title: "9. Dua After Wudhu", ar: "أَشْهَدُ أَنْ لَا إِلٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ وَأَشْهَدُ أَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ", desc: "Face Qiblah and recite the Shahadah upon completion." }
    ];

    const salahSteps = [
      { action: "Takbeerat-ul-Ihram", ar: "اللهُ أَكْبَرُ", translit: "Allahu Akbar", desc: "Raise hands to earlobes and begin Salah." },
      { action: "Thanaa (Opening Dua)", ar: "سُبْحَانَكَ اللَّهُمَّ وَبِحَمْدِكَ وَتَبَارَكَ اسْمُكَ وَتَعَالَىٰ جَدُّكَ وَلَا إِلٰهَ غَيْرُكَ", translit: "Subhanaka Allahumma wa bihamdika...", desc: "Praise Allah in standing Qiyam." },
      { action: "Surah Al-Fatihah", ar: "بِسْمِ اللَّهِ الرَّحْمٰنِ الرَّحِيمِ ۞ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ۞ الرَّحْمٰنِ الرَّحِيمِ ۞ مَالِكِ يَوْمِ الدِّينِ ۞ إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ ۞ اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ ۞ صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ ۞ آمِينَ", translit: "Alhamdu lillahi Rabbil 'Aalameen...", desc: "The Mother of the Book, recited in every Rak'ah." },
      { action: "Ruku (Bowing Tasbeeh)", ar: "سُبْحَانَ رَبِّيَ الْعَظِيمِ", translit: "Subhana Rabbiyal 'Azeem (3x)", desc: "Bow with straight back, hands gripping knees." },
      { action: "Standing from Ruku", ar: "سَمِعَ اللَّهُ لِمَنْ حَمِدَهُ • رَبَّنَا وَلَكَ الْحَمْدُ", translit: "Sami' Allahu liman hamidah, Rabbana wa lakal hamd", desc: "Rise upright with hands at sides." },
      { action: "Sujood (Prostration Tasbeeh)", ar: "سُبْحَانَ رَبِّيَ الْأَعْلَىٰ", translit: "Subhana Rabbiyal A'laa (3x)", desc: "Prostrate with 7 limbs touching the ground." },
      { action: "Jalsah (Between Sujood)", ar: "رَبِّ اغْفِرْ لِي", translit: "Rabbighfir lee", desc: "Sit upright peacefully between the two Sujood." },
      { action: "At-Tashahhud", ar: "التَّحِيَّاتُ لِلَّهِ وَالصَّلَوَاتُ وَالطَّيِّبَاتُ السَّلَامُ عَلَيْكَ أَيُّهَا النَّبِيُّ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ السَّلَامُ عَلَيْنَا وَعَلَىٰ عِبَادِ اللَّهِ الصَّالِحِينَ أَشْهَدُ أَنْ لَا إِلٰهَ إِلَّا اللَّهُ وَأَشْهَدُ أَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ", translit: "At-Tahiyyatu lillahi was-salawatu...", desc: "Sitting in Tashahhud with finger raised." },
      { action: "Durood-e-Ibrahimi", ar: "اللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ كَمَا صَلَّيْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ", translit: "Allahumma salli 'ala Muhammad...", desc: "Blessings upon Prophet Muhammad (ﷺ)." },
      { action: "Tasleem (Concluding Salam)", ar: "السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ", translit: "As-Salamu 'alaykum wa Rahmatullah", desc: "Turn head right, then left to end prayer." }
    ];

    const wudhuHtml = wudhuSteps.map(w => `
      <div class="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2 text-xs">
        <div class="flex items-center justify-between">
          <span class="font-extrabold text-emerald-400 text-sm">${w.title}</span>
          <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${w.ar}')" class="px-2.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white font-bold text-[10px] flex items-center gap-1 transition">
            <i class="fa-solid fa-volume-high"></i> Play Dua
          </button>
        </div>
        <div dir="rtl" class="font-['Amiri',serif] text-xl font-bold text-amber-300 pt-1">${w.ar}</div>
        <p class="text-zinc-300 text-[11px]">${w.desc}</p>
      </div>
    `).join('');

    const salahHtml = salahSteps.map(s => `
      <div class="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2 text-xs">
        <div class="flex items-center justify-between">
          <span class="font-extrabold text-amber-300 text-sm">${s.action}</span>
          <button onclick="AlHudaInteractiveQaida.playArabicPronunciation('${s.ar}')" class="px-2.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white font-bold text-[10px] flex items-center gap-1 transition">
            <i class="fa-solid fa-volume-high"></i> Play Recitation
          </button>
        </div>
        <div dir="rtl" class="font-['Amiri',serif] text-xl font-bold text-white pt-1 leading-relaxed">${s.ar}</div>
        <p class="text-[11px] text-emerald-400 font-mono font-medium">${s.translit}</p>
        <p class="text-zinc-400 text-[10.5px]">${s.desc}</p>
      </div>
    `).join('');

    return `
      <div class="space-y-5">
        <div class="flex items-center justify-center gap-3">
          <button onclick="AlHudaInteractiveQaida.switchWudhuTab('wudhu')" class="px-5 py-2 rounded-xl font-bold text-xs transition flex items-center gap-2 ${currentWudhuTab === 'wudhu' ? 'bg-emerald-700 text-white shadow-md border border-emerald-500' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}">
            <i class="fa-solid fa-hands-bubbles"></i> Step-by-Step Wudhu (9 Steps)
          </button>
          <button onclick="AlHudaInteractiveQaida.switchWudhuTab('salah')" class="px-5 py-2 rounded-xl font-bold text-xs transition flex items-center gap-2 ${currentWudhuTab === 'salah' ? 'bg-emerald-700 text-white shadow-md border border-emerald-500' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}">
            <i class="fa-solid fa-person-praying"></i> Daily Salah Positions &amp; Duas (10 Actions)
          </button>
        </div>

        <div class="${currentWudhuTab === 'wudhu' ? 'block' : 'hidden'} space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            ${wudhuHtml}
          </div>
        </div>

        <div class="${currentWudhuTab === 'salah' ? 'block' : 'hidden'} space-y-3">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            ${salahHtml}
          </div>
        </div>
      </div>
    `;
  }

  function switchWudhuTab(tab) {
    currentWudhuTab = tab;
    renderInteractivePage('readerInteractiveContent', 49);
  }

  // =========================================================================
  // 7. MASTER VIEW RENDERER (PAGES 1 TO 49)
  // =========================================================================

  function renderInteractivePage(containerId, pageNum) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const page = Math.max(1, Math.min(LESSONS_REGISTRY.length, Number(pageNum) || 1));
    CURRENT_ACTIVE_PAGE = page;
    const lesson = LESSONS_REGISTRY[page - 1];

    let contentHtml = '';

    switch (lesson.type) {
      case 'mufradat':
        contentHtml = renderLesson1Mufradat(lesson);
        break;
      case 'makharij':
        contentHtml = renderLesson2Makharij(lesson);
        break;
      case 'shapes':
        contentHtml = renderLesson3Shapes(lesson);
        break;
      case 'compounds':
        contentHtml = renderLesson4Compounds(lesson);
        break;
      case 'harakat_letters':
        contentHtml = renderHarakatLetters(lesson);
        break;
      case 'words_grid':
        contentHtml = renderWordsGrid(lesson, page);
        break;
      case 'letter_grid':
        contentHtml = renderLetterGrid(lesson, page);
        break;
      case 'tanween_letters':
        contentHtml = renderTanweenLetters(lesson);
        break;
      case 'standing_letters':
        contentHtml = renderStandingLetters(lesson);
        break;
      case 'ghunnah_theory':
        contentHtml = renderGhunnahTheory(lesson);
        break;
      case 'qalqalah_theory':
        contentHtml = renderQalqalahTheory(lesson);
        break;
      case 'rules_laam':
        contentHtml = renderRulesLaam(lesson);
        break;
      case 'rules_raa':
        contentHtml = renderRulesRaa(lesson);
        break;
      case 'noon_sakin_izhaar':
        contentHtml = renderNoonSakinIzhaar(lesson);
        break;
      case 'noon_sakin_idghaam':
        contentHtml = renderNoonSakinIdghaam(lesson);
        break;
      case 'noon_sakin_iqlaab':
        contentHtml = renderNoonSakinIqlaab(lesson);
        break;
      case 'noon_sakin_ikhfaa':
        contentHtml = renderNoonSakinIkhfaa(lesson);
        break;
      case 'meem_sakin':
        contentHtml = renderMeemSakin(lesson);
        break;
      case 'madd_rules':
        contentHtml = renderMaddRules(lesson);
        break;
      case 'muqattaat':
        contentHtml = renderMuqattaat(lesson);
        break;
      case 'noon_qutni':
        contentHtml = renderNoonQutni(lesson);
        break;
      case 'silent_letters':
        contentHtml = renderSilentLetters(lesson);
        break;
      case 'waqf':
        contentHtml = renderWaqf(lesson);
        break;
      case 'wudhu_salah':
        contentHtml = renderWudhuSalah(lesson);
        break;
      default:
        if (lesson.words && lesson.words.length > 0) {
          contentHtml = renderWordsGrid(lesson, page);
        } else {
          contentHtml = renderLesson1Mufradat(lesson);
        }
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
            <button id="qaidaBtnAutoTour" onclick="AlHudaInteractiveQaida.toggleSequentialAudioTour()" class="px-3 py-1.5 rounded-xl bg-emerald-800/80 hover:bg-emerald-700 text-emerald-100 border border-emerald-600/50 text-xs font-bold transition flex items-center gap-1.5 shadow-sm" title="Recite all items on this page sequentially">
              <i class="fa-solid fa-circle-play text-emerald-400 text-sm"></i> Auto Play All
            </button>
            <button onclick="AlHudaInteractiveQaida.openMakharijTeethReferenceModal()" class="px-3 py-1.5 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-amber-300 border border-zinc-700 text-xs font-bold transition flex items-center gap-1.5 shadow-sm" title="View Teeth & Articulation Chart">
              <i class="fa-solid fa-tooth text-xs"></i> Teeth Diagram
            </button>
          </div>

          <div class="absolute -right-10 -bottom-10 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
          <div class="absolute -left-10 -top-10 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl pointer-events-none"></div>
        </div>

        <!-- Tajweed Rules / Instructions Accordion -->
        <div class="bg-slate-900/80 border border-zinc-800/80 rounded-2xl p-4 text-xs text-zinc-300 space-y-2">
          <div class="flex items-center gap-2 text-amber-300 font-extrabold text-[11px] uppercase tracking-wider">
            <i class="fa-solid fa-lightbulb text-amber-400"></i> Essential Lesson Rules &amp; Teaching Focus
          </div>
          <ul class="list-disc list-inside space-y-1 pl-1 text-zinc-300 text-[11.5px] leading-relaxed">
            ${(Array.isArray(lesson.rules) ? lesson.rules : (lesson.rules ? [lesson.rules] : [])).map(r => `<li>${r}</li>`).join('')}
          </ul>
        </div>

        <!-- Dynamic Lesson Workspace Content -->
        <div id="qaidaLessonWorkspace" class="pt-2">
          ${contentHtml}
        </div>

      </div>
    `;
  }

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
    switchWudhuTab,
    getLetterById
  };
});
