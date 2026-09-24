/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/curriculum.js
 * Purpose: Islamic Curriculum Catalog, Digital Book Reader, Interactive Whiteboard & Custom Book Upload
 * Extracted Line Range: 5315 – 6845 (1531 lines)
 * ============================================================================
 */

    // ============================================================
    // COURSE MATERIAL & DIGITAL ISLAMIC LIBRARY ENGINE
    // ============================================================
    let CURRENT_CURRICULUM_CATEGORY = 'all';
    let CURRENT_READER_BOOK = null;
    let CURRENT_READER_PAGE = 1;
    let CURRENT_READER_ZOOM = 1.0;
    let CUSTOM_BOOKS_CACHE = [];

    function getCustomBooks() {
      try {
        return JSON.parse(localStorage.getItem('alhuda_custom_books') || '[]');
      } catch (e) {
        return [];
      }
    }

    function saveCustomBooks(books) {
      try {
        localStorage.setItem('alhuda_custom_books', JSON.stringify(books));
      } catch(e) {
        console.warn("Could not save custom books to storage:", e);
      }
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
    }

    function getAllAvailableBooks() {
      const customBooks = getCustomBooks();
      const deletedIds = getDeletedBookIds();
      return customBooks.filter(b => !deletedIds.includes(b.id));
    }

    function loadCurriculumLibrary(category = 'all') {
      CURRENT_CURRICULUM_CATEGORY = category;
      const allBooks = getAllAvailableBooks();

      // Update Toolbar Counts
      const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
      setTxt('catCountAll', allBooks.length);
      setTxt('catCountQaida', allBooks.filter(b => b.category === 'qaida').length);
      setTxt('catCountQuran', allBooks.filter(b => b.category === 'quran').length);
      setTxt('catCountTafseer', allBooks.filter(b => b.category === 'tafseer').length);
      setTxt('catCountHadith', allBooks.filter(b => b.category === 'hadith').length);
      setTxt('catCountEssentials', allBooks.filter(b => b.category === 'essentials').length);
      setTxt('badgeCurriculumTotalCount', `${allBooks.length} Materials`);

      // Filter by category
      let filtered = allBooks;
      if (category !== 'all') {
        filtered = allBooks.filter(b => b.category === category);
      }

      // Filter by active search query if any
      const searchVal = (document.getElementById('curriculumSearchInput')?.value || '').trim().toLowerCase();
      if (searchVal) {
        filtered = filtered.filter(b => {
          return (b.title && b.title.toLowerCase().includes(searchVal)) ||
                 (b.title_ar && b.title_ar.includes(searchVal)) ||
                 (b.edition && b.edition.toLowerCase().includes(searchVal)) ||
                 (b.description && b.description.toLowerCase().includes(searchVal)) ||
                 (b.author && b.author.toLowerCase().includes(searchVal));
        });
      }

      renderCurriculumGrid(filtered);
    }

    function filterCurriculumCategory(category, btnEl) {
      document.querySelectorAll('.curriculum-filter-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-brandDark', 'text-white', 'shadow-xs');
        btn.classList.add('bg-slate-100', 'text-slate-700');
      });

      if (btnEl) {
        btnEl.classList.add('active', 'bg-brandDark', 'text-white', 'shadow-xs');
        btnEl.classList.remove('bg-slate-100', 'text-slate-700');
      }

      loadCurriculumLibrary(category);
    }

    function searchCurriculumLibrary(query) {
      loadCurriculumLibrary(CURRENT_CURRICULUM_CATEGORY);
    }

    function renderCurriculumGrid(books) {
      const container = document.getElementById('curriculumGrid');
      if (!container) return;

      if (!books || books.length === 0) {
        container.innerHTML = `
          <div class="col-span-full py-16 px-6 text-center bg-white rounded-3xl border border-dashed border-slate-300 shadow-xs">
            <div class="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center text-2xl mx-auto mb-4 shadow-xs">
              <i class="fa-solid fa-book-open"></i>
            </div>
            <h4 class="font-black text-slate-800 text-lg tracking-tight">No Course Materials Found</h4>
            <p class="text-xs text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
              No materials match your current category or search filter. You can add new lessons, PDF/image scans, or custom course syllabus using the button below.
            </p>
            <div class="mt-6 flex items-center justify-center gap-3 flex-wrap">
              <button onclick="openCustomBookUploadModal()" class="px-5 py-2.5 bg-gradient-to-r from-brandDark to-emerald-950 hover:from-emerald-900 hover:to-brandDark text-white rounded-xl text-xs font-black transition inline-flex items-center gap-2 shadow-md hover:shadow-lg">
                <i class="fa-solid fa-plus text-brandGold"></i> + Add Course Material
              </button>
              <button onclick="loadCurriculumLibrary('all')" class="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5">
                <i class="fa-solid fa-layer-group text-slate-500"></i> View All Materials
              </button>
            </div>
          </div>
        `;
        return;
      }

      const categoryStyles = {
        qaida: { badge: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: 'fa-solid fa-book-open', iconColor: 'text-emerald-600', grad: 'from-emerald-800 via-teal-900 to-slate-900' },
        quran: { badge: 'bg-amber-50 text-amber-800 border-amber-200', icon: 'fa-solid fa-book-quran', iconColor: 'text-amber-600', grad: 'from-amber-900 via-stone-900 to-slate-950' },
        tafseer: { badge: 'bg-blue-50 text-blue-800 border-blue-200', icon: 'fa-solid fa-scroll', iconColor: 'text-blue-600', grad: 'from-blue-900 via-slate-900 to-slate-950' },
        hadith: { badge: 'bg-purple-50 text-purple-800 border-purple-200', icon: 'fa-solid fa-kaaba', iconColor: 'text-purple-600', grad: 'from-purple-950 via-slate-900 to-stone-950' },
        essentials: { badge: 'bg-teal-50 text-teal-800 border-teal-200', icon: 'fa-solid fa-hands-praying', iconColor: 'text-teal-600', grad: 'from-teal-900 via-emerald-950 to-slate-900' }
      };

      container.innerHTML = books.map((book) => {
        const catKey = book.category || 'qaida';
        const style = categoryStyles[catKey] || categoryStyles.qaida;
        const totalPages = book.total_pages || (book.pages ? book.pages.length : (book.paras ? 548 : 32));
        const totalIndicator = book.total_paras ? `${book.total_paras} Paras` :
                               book.total_surahs ? `${book.total_surahs} Surahs` :
                               book.total_hadith ? `${book.total_hadith} Hadiths` :
                               `${totalPages} Pages`;

        const outlineSummary = book.chapters ? `${book.chapters.length} Takhtis / Units` : (book.paras ? '30 Paras (Complete)' : null);

        return `
          <div class="bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-xl hover:border-emerald-300/80 transition-all duration-300 flex flex-col justify-between overflow-hidden group">
            <div>
              <!-- CARD HERO HEADER -->
              <div class="p-5 bg-gradient-to-br ${book.cover_bg || style.grad} text-white relative overflow-hidden">
                <!-- Subtle Watermark Icon in Corner -->
                <div class="absolute -right-3 -bottom-4 opacity-15 text-7xl select-none pointer-events-none group-hover:scale-110 transition-transform duration-300">
                  <i class="${book.cover_icon || style.icon}"></i>
                </div>

                <!-- Top Badges Row -->
                <div class="flex items-center justify-between gap-2 relative z-10">
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/20 text-white backdrop-blur-xs border border-white/20">
                    <i class="${style.icon} mr-1 text-[9px]"></i> ${book.category_label || 'Course Material'}
                  </span>
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-black/40 text-amber-300 border border-amber-400/30 flex items-center gap-1 shadow-2xs">
                    <i class="fa-regular fa-file-lines text-[9px]"></i> ${totalIndicator}
                  </span>
                </div>

                <!-- Title & Arabic Title -->
                <div class="relative z-10 mt-3">
                  <h3 class="font-black text-base sm:text-lg text-white leading-snug tracking-tight drop-shadow-xs group-hover:text-emerald-200 transition-colors">
                    ${book.title}
                  </h3>
                  ${book.title_ar ? `<div class="text-xs text-emerald-300 font-bold font-cinzel mt-1 tracking-wide" dir="rtl">${book.title_ar}</div>` : ''}
                  ${book.author ? `
                    <div class="text-[11px] text-amber-200/90 font-medium mt-1.5 flex items-center gap-1">
                      <i class="fa-solid fa-feather-pointed text-[10px] text-amber-300"></i> ${book.author}
                    </div>` : ''}
                </div>
              </div>

              <!-- CARD BODY -->
              <div class="p-4 space-y-3">
                <!-- Meta tags row: Edition / Whiteboard Ready -->
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[11px] font-bold text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100 flex items-center gap-1.5 shadow-2xs">
                    <i class="fa-solid fa-award text-amber-500 text-xs"></i>
                    <span class="truncate max-w-[170px]">${book.edition || 'Academy Syllabus'}</span>
                  </span>
                  <span class="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200/70 flex items-center gap-1">
                    <i class="fa-solid fa-chalkboard-user text-emerald-600"></i> Live Whiteboard
                  </span>
                </div>

                <!-- Book Description -->
                <p class="text-xs text-slate-600 leading-relaxed line-clamp-2">
                  ${book.description || 'Interactive academy syllabus material for Quranic instruction.'}
                </p>

                <!-- Outline or Pages snippet -->
                ${outlineSummary ? `
                  <div class="p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 text-[11px] text-slate-700 flex items-center justify-between">
                    <span class="font-bold text-slate-700 flex items-center gap-1.5">
                      <i class="fa-solid fa-list-check text-brandEmerald"></i> Syllabus Outline:
                    </span>
                    <span class="font-mono font-bold text-emerald-700 text-[11px] bg-white px-2 py-0.5 rounded-md border border-slate-200">${outlineSummary}</span>
                  </div>
                ` : ''}
              </div>
            </div>

            <!-- CARD FOOTER ACTIONS -->
            <div class="p-3.5 pt-2 border-t border-slate-100 bg-slate-50/50 flex items-center gap-2 flex-wrap">
              <!-- Primary: Open Reader -->
              <button onclick="openDigitalBookReader('${book.id}', 1)" class="flex-1 min-w-[125px] py-2.5 px-3 bg-gradient-to-r from-emerald-800 to-teal-900 hover:from-emerald-700 hover:to-teal-800 text-white rounded-xl font-black text-xs shadow-sm hover:shadow-md transition flex items-center justify-center gap-1.5">
                <i class="fa-solid fa-book-open-reader text-brandGold"></i> Open Reader
              </button>
              
              <!-- Secondary: Edit Book -->
              <button onclick="openEditCustomBookModal('${book.id}')" class="px-2.5 py-2.5 bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-2xs" title="Edit Course Material Details & Pages">
                <i class="fa-solid fa-pen-to-square text-emerald-600"></i>
                <span class="hidden sm:inline">Edit</span>
              </button>

              <!-- Secondary: Delete Book -->
              ${CURRENT_ROLE !== 'manager' ? `
                <button onclick="handleDeleteCurriculumBook('${book.id}', '${(book.title || '').replace(/'/g, "\\'")}')" class="px-2.5 py-2.5 bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-2xs" title="Delete Course Material">
                  <i class="fa-solid fa-trash-can text-rose-500"></i>
                  <span class="hidden sm:inline">Delete</span>
                </button>
              ` : ''}

              <!-- Share Deep Link -->
              <button onclick="copyBookDeepLink('${book.id}', '${(book.title || '').replace(/'/g, "\\'")}')" class="p-2.5 bg-white hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl text-xs transition shadow-2xs" title="Copy Direct Portal Link">
                <i class="fa-solid fa-share-nodes"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    // ============================================================
    // IN-LMS INTERACTIVE DIGITAL BOOK READER CONTROLLER
    // ============================================================
    function openDigitalBookReader(bookId, startPage = 1) {
      const allBooks = getAllAvailableBooks();
      const book = allBooks.find(b => b.id === bookId);
      if (!book) {
        alert("Course book not found.");
        return;
      }

      CURRENT_READER_BOOK = book;
      CURRENT_READER_PAGE = Number(startPage) || 1;
      CURRENT_READER_ZOOM = 1.0;

      // Update Header Info
      const setT = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
      setT('readerBookTitle', book.title);
      setT('readerCategoryBadge', book.category_label || 'Curriculum');

      const iconEl = document.getElementById('readerBookIcon');
      if (iconEl && book.cover_icon) {
        iconEl.innerHTML = `<i class="${book.cover_icon}"></i>`;
      }

      // Populate Jump Select
      populateReaderJumpSelect(book);

      // Setup Slider
      const slider = document.getElementById('readerPageSlider');
      if (slider) {
        slider.min = 1;
        slider.max = book.total_pages || (book.paras ? book.total_pages || 548 : 32);
        slider.value = CURRENT_READER_PAGE;
      }

      setupReaderPanningAndWheel();
      openModal('modalDigitalBookReader');
      renderReaderCurrentPage();
    }

    function populateReaderJumpSelect(book) {
      const jumpSelect = document.getElementById('readerJumpSelect');
      if (!jumpSelect) return;

      let optionsHtml = '';
      const maxP = book.total_pages || book.totalPages || 32;

      if (book.paras && book.paras.length > 0) {
        // Quran by 30 Paras
        optionsHtml = book.paras.map(p =>
          `<option value="${p.page_start}">Para ${p.para} (Page ${p.page_start})</option>`
        ).join('');
      } else if (book.chapters && book.chapters.length > 0) {
        optionsHtml = book.chapters.map((ch, idx) =>
          `<option value="${ch.page_start || (idx + 1)}">${(ch.title || '').slice(0, 28)} (Page ${ch.page_start || (idx + 1)})</option>`
        ).join('');
      } else if (maxP > 50) {
        const chunkSize = 10;
        const chunks = [];
        for (let i = 1; i <= maxP; i += chunkSize) {
          const end = Math.min(i + chunkSize - 1, maxP);
          chunks.push(`<option value="${i}">Pages ${i}–${end}</option>`);
        }
        optionsHtml = chunks.join('');
      } else {
        const pageOptions = [];
        for (let i = 1; i <= maxP; i++) pageOptions.push(`<option value="${i}">Page ${i}</option>`);
        optionsHtml = pageOptions.join('');
      }

      jumpSelect.innerHTML = optionsHtml;
    }

    function renderReaderCurrentPage() {
      if (!CURRENT_READER_BOOK) return;
      const book = CURRENT_READER_BOOK;
      const maxPages = book.total_pages || (book.paras ? 548 : 32);

      // Clamp current page
      CURRENT_READER_PAGE = Math.max(1, Math.min(maxPages, CURRENT_READER_PAGE));

      // Update Page Indicator & Slider
      const ind = document.getElementById('readerPageIndicator');
      if (ind) ind.innerText = `Page ${CURRENT_READER_PAGE} of ${maxPages}`;

      const slider = document.getElementById('readerPageSlider');
      if (slider) slider.value = CURRENT_READER_PAGE;

      const jumpSelect = document.getElementById('readerJumpSelect');
      if (jumpSelect) {
        // Find closest matching option
        const options = Array.from(jumpSelect.options);
        let bestVal = options[0]?.value;
        options.forEach(opt => {
          if (Number(opt.value) <= CURRENT_READER_PAGE) bestVal = opt.value;
        });
        if (bestVal) jumpSelect.value = bestVal;
      }

      // Update Chapter / Topic subtitle
      const descEl = document.getElementById('readerChapterDesc');
      if (descEl) {
        if (book.chapters) {
          const matchCh = book.chapters.find(c => CURRENT_READER_PAGE >= (c.page_start || 1) && CURRENT_READER_PAGE <= (c.page_end || maxPages));
          descEl.innerText = matchCh ? `${matchCh.title} — ${matchCh.desc || ''}` : `Page ${CURRENT_READER_PAGE}`;
        } else if (book.paras) {
          const matchPara = book.paras.find(p => CURRENT_READER_PAGE >= p.page_start && CURRENT_READER_PAGE <= p.page_end);
          descEl.innerText = matchPara ? `Para ${matchPara.para}: ${matchPara.name_ar} (${matchPara.name_ur}) — Pages ${matchPara.page_start} to ${matchPara.page_end}` : `Page ${CURRENT_READER_PAGE}`;
        } else {
          descEl.innerText = `${book.edition || 'Lesson'} • Page ${CURRENT_READER_PAGE}`;
        }
      }

      // 1. Text-based viewer (Tafseer / Hadith)
      if (book.is_text_viewer) {
        document.getElementById('readerImageStage')?.classList.add('hidden');
        const textStage = document.getElementById('readerTextStage');
        if (textStage) {
          textStage.classList.remove('hidden');
          renderTafseerTextContent(book, CURRENT_READER_PAGE);
        }
        return;
      }

      // 2. Image-based viewer (Qaida, Quran, Illustrated guides)
      document.getElementById('readerTextStage')?.classList.add('hidden');
      const imgStage = document.getElementById('readerImageStage');
      if (imgStage) imgStage.classList.remove('hidden');

      const img = document.getElementById('readerPageImg');
      const spinner = document.getElementById('readerLoadingSpinner');

      if (img) {
        if (spinner) spinner.classList.remove('hidden');

        // Reset individual image transform - wrapper handles uniform scaling
        img.style.transform = 'none';
        applyReaderZoom();

        // Get URL
        let pageUrl = '';
        if (typeof book.getPageUrl === 'function') {
          pageUrl = book.getPageUrl(CURRENT_READER_PAGE);
        } else if (book.pages && book.pages[CURRENT_READER_PAGE - 1]) {
          pageUrl = book.pages[CURRENT_READER_PAGE - 1];
        } else if (typeof generateDynamicSvgDataUri === 'function') {
          pageUrl = generateDynamicSvgDataUri(book, CURRENT_READER_PAGE);
        } else {
          pageUrl = generateDynamicSvgPage(book, CURRENT_READER_PAGE);
        }

        img.onload = function() {
          if (spinner) spinner.classList.add('hidden');
          setTimeout(() => {
            initOrResizeAnnotationCanvas();
            applyReaderZoom();
          }, 60);
        };

        img.onerror = function() {
          img.onerror = null; // Prevent infinite error loops
          let fallback = '';
          if (typeof book.getFallbackPageUrl === 'function') {
            fallback = book.getFallbackPageUrl(CURRENT_READER_PAGE);
          } else if (typeof generateDynamicSvgDataUri === 'function') {
            fallback = generateDynamicSvgDataUri(book, CURRENT_READER_PAGE);
          } else {
            fallback = generateDynamicSvgPage(book, CURRENT_READER_PAGE);
          }
          img.src = fallback;
          if (spinner) spinner.classList.add('hidden');
          setTimeout(() => {
            initOrResizeAnnotationCanvas();
            applyReaderZoom();
          }, 60);
        };

        img.src = pageUrl;
      }
    }

    function renderTafseerTextContent(book, surahOrPage) {
      const container = document.getElementById('readerTextContent');
      if (!container) return;

      const surahNames = [
        "Al-Fatiha (The Opening)", "Al-Baqarah (The Cow)", "Ali 'Imran (Family of Imran)",
        "An-Nisa (The Women)", "Al-Ma'idah (The Table Spread)", "Al-An'am (The Cattle)",
        "Al-A'raf (The Heights)", "Al-Anfal (The Spoils of War)", "At-Tawbah (The Repentance)",
        "Yunus (Jonah)", "Hud", "Yusuf (Joseph)", "Ar-Ra'd (The Thunder)", "Ibrahim (Abraham)",
        "Al-Hijr (The Rocky Tract)", "An-Nahl (The Bee)", "Al-Isra (The Night Journey)",
        "Al-Kahf (The Cave)", "Maryam (Mary)", "Ta-Ha", "Al-Anbiya (The Prophets)", "Al-Hajj (The Pilgrimage)",
        "Al-Mu'minun (The Believers)", "An-Nur (The Light)", "Al-Furqan (The Criterion)",
        "Ash-Shu'ara (The Poets)", "An-Naml (The Ant)", "Al-Qasas (The Stories)", "Al-Ankabut (The Spider)",
        "Ar-Rum (The Romans)", "Luqman", "As-Sajdah (The Prostration)", "Al-Ahzab (The Combined Forces)",
        "Saba (Sheba)", "Fatir (The Originator)", "Ya-Sin", "As-Saffat (Those Ranged in Ranks)", "Sad",
        "Az-Zumar (The Groups)", "Ghafir (The Forgiver)", "Fussilat (Explained in Detail)", "Ash-Shura (The Consultation)",
        "Az-Zukhruf (The Gold Adornments)", "Ad-Dukhan (The Smoke)", "Al-Jathiyah (The Crouching)", "Al-Ahqaf (The Dunes)",
        "Muhammad", "Al-Fath (The Victory)", "Al-Hujurat (The Rooms)", "Qaf", "Adh-Dhariyat (The Winnowing Winds)",
        "At-Tur (The Mount)", "An-Najm (The Star)", "Al-Qamar (The Moon)", "Ar-Rahman (The Beneficent)",
        "Al-Waqi'ah (The Inevitable)", "Al-Hadid (The Iron)", "Al-Mujadila (The Pleading Woman)", "Al-Hashr (The Exile)",
        "Al-Mumtahanah (The Examined One)", "As-Saff (The Ranks)", "Al-Jumu'ah (The Congregation)", "Al-Munafiqun (The Hypocrites)",
        "At-Taghabun (The Mutual Loss)", "At-Talaq (The Divorce)", "At-Tahrim (The Prohibition)", "Al-Mulk (The Sovereignty)",
        "Al-Qalam (The Pen)", "Al-Haqqah (The Reality)", "Al-Ma'arij (The Ascending Stairways)", "Nuh (Noah)",
        "Al-Jinn", "Al-Muzzammil (The Enshrouded One)", "Al-Muddaththir (The Cloaked One)", "Al-Qiyamah (The Resurrection)",
        "Al-Insan (Man)", "Al-Mursalat (The Emissaries)", "An-Naba (The Tidings)", "An-Nazi'at (Those Who Drag Forth)",
        "'Abasa (He Frowned)", "At-Takwir (The Overthrowing)", "Al-Infitar (The Cleaving)", "Al-Mutaffifin (Defrauding)",
        "Al-Inshiqaq (The Splitting Open)", "Al-Buruj (The Constellations)", "At-Tariq (The Nightcomer)", "Al-A'la (The Most High)",
        "Al-Ghashiyah (The Overwhelming)", "Al-Fajr (The Dawn)", "Al-Balad (The City)", "Ash-Shams (The Sun)",
        "Al-Layl (The Night)", "Ad-Duha (The Morning Hours)", "Ash-Sharh (The Relief)", "At-Tin (The Fig)",
        "Al-'Alaq (The Clot)", "Al-Qadr (The Power)", "Al-Bayyinah (The Clear Proof)", "Az-Zalzalah (The Earthquake)",
        "Al-'Adiyat (The Courser)", "Al-Qari'ah (The Calamity)", "At-Takathur (Rivalry in World Increase)", "Al-'Asr (The Declining Day)",
        "Al-Humazah (The Traducer)", "Al-Fil (The Elephant)", "Quraysh", "Al-Ma'un (Small Kindnesses)",
        "Al-Kawthar (Abundance)", "Al-Kafirun (The Disbelievers)", "An-Nasr (The Divine Support)", "Al-Masad (The Palm Fiber)",
        "Al-Ikhlas (Sincerity)", "Al-Falaq (The Daybreak)", "An-Nas (Mankind)"
      ];

      const sIndex = Math.min(114, Math.max(1, surahOrPage));
      const sName = surahNames[sIndex - 1] || `Surah #${sIndex}`;

      container.innerHTML = `
        <div class="text-center pb-4 border-b border-slate-700">
          <span class="px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">Surah ${sIndex} of 114</span>
          <h2 class="text-xl font-extrabold text-white mt-2">${sName}</h2>
          <p class="text-xs text-slate-400 mt-0.5">${book.title} &bull; ${book.author || ''}</p>
        </div>

        <div class="py-4 space-y-6 text-sm">
          <div class="p-4 bg-slate-800/80 rounded-xl border border-slate-700 space-y-2">
            <div class="text-right font-serif text-xl sm:text-2xl text-amber-200 leading-loose" dir="rtl">
              بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
            </div>
            <div class="text-slate-300 text-xs sm:text-sm font-medium pt-2 border-t border-slate-700/60">
              ${book.id === 'tafseer-farhat-hashmi-urdu' ? 'اللہ کے نام سے جو سب پر مہربان، بہت رحم کرنے والا ہے۔' : 'In the name of Allah, the Entirely Merciful, the Especially Merciful.'}
            </div>
          </div>

          <div class="p-4 bg-slate-800/60 rounded-xl border border-slate-700 space-y-3">
            <div class="flex items-center justify-between text-xs text-amber-400 font-mono font-bold">
              <span>Ayah 1</span>
              <span>${book.edition || 'Translation'}</span>
            </div>
            <div class="text-right font-serif text-xl text-white leading-loose" dir="rtl">
              الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
            </div>
            <div class="text-emerald-200 text-xs sm:text-sm font-medium pt-1">
              ${book.id === 'tafseer-farhat-hashmi-urdu' ? 'سب تعریفیں اللہ ہی کے لیے ہیں جو تمام جہانوں کا پالنے والا ہے۔' : 'All praise is for Allah, the Lord of all the worlds.'}
            </div>
            <div class="p-2.5 bg-slate-950/60 rounded-lg text-slate-400 text-xs border border-slate-800">
              <strong class="text-amber-300">Explanatory Note:</strong> This opening verse establishes that gratitude, glorification, and submission belong exclusively to Allah, the Creator and Sustainer of every atom in existence.
            </div>
          </div>
        </div>
      `;
    }

    // High-definition dynamic SVG page generator fallback
    function generateDynamicSvgPage(book, pageNum) {
      const bTitle = (book.title || 'Course Material').replace(/&/g, '&amp;');
      const arTitle = (book.title_ar || 'الْقُرْآنُ الْكَرِيم').replace(/&/g, '&amp;');
      const maxPages = book.total_pages || 32;

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 860" width="600" height="860">
        <rect width="600" height="860" fill="#fdfbf7" />
        <rect x="20" y="20" width="560" height="820" rx="12" fill="none" stroke="#047857" stroke-width="4" stroke-opacity="0.6"/>
        <rect x="28" y="28" width="544" height="804" rx="8" fill="none" stroke="#d97706" stroke-width="1.5" stroke-dasharray="6,4"/>
        <text x="300" y="75" font-family="'Cinzel', serif" font-size="20" font-weight="bold" fill="#064e3b" text-anchor="middle">AL-HUDA ISLAMIC CENTRE</text>
        <text x="300" y="105" font-family="sans-serif" font-size="14" font-weight="bold" fill="#d97706" text-anchor="middle">${bTitle}</text>
        <text x="300" y="140" font-family="'Amiri', serif" font-size="24" font-weight="bold" fill="#047857" text-anchor="middle">${arTitle}</text>
        <line x1="80" y1="160" x2="520" y2="160" stroke="#047857" stroke-width="1.5" stroke-opacity="0.4"/>
        <circle cx="300" cy="430" r="140" fill="#ecfdf5" fill-opacity="0.4" stroke="#047857" stroke-width="1" stroke-dasharray="4,4"/>
        <text x="300" y="420" font-family="sans-serif" font-size="28" font-weight="900" fill="#064e3b" text-anchor="middle">PAGE ${pageNum}</text>
        <text x="300" y="460" font-family="sans-serif" font-size="14" fill="#64748b" text-anchor="middle">Lesson Content &bull; ${bTitle}</text>
        <rect x="100" y="580" width="400" height="120" rx="8" fill="#f8fafc" stroke="#cbd5e1"/>
        <text x="300" y="615" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a" text-anchor="middle">Interactive Digital Curriculum View</text>
        <text x="300" y="645" font-family="sans-serif" font-size="11" fill="#64748b" text-anchor="middle">Verified Authentic Edition &bull; Al-Huda Academy Registry</text>
        <text x="300" y="675" font-family="sans-serif" font-size="11" font-weight="bold" fill="#047857" text-anchor="middle">Use &larr; Prev and Next &rarr; buttons to flip pages</text>
        <line x1="80" y1="780" x2="520" y2="780" stroke="#047857" stroke-width="1.5" stroke-opacity="0.4"/>
        <text x="300" y="810" font-family="monospace" font-size="12" font-weight="bold" fill="#475569" text-anchor="middle">Page ${pageNum} of ${maxPages}</text>
      </svg>`;

      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    function changeReaderPage(delta) {
      if (!CURRENT_READER_BOOK) return;
      CURRENT_READER_PAGE += delta;
      renderReaderCurrentPage();
    }

    function jumpToReaderPage(pageVal) {
      if (!CURRENT_READER_BOOK) return;
      CURRENT_READER_PAGE = Number(pageVal) || 1;
      renderReaderCurrentPage();
    }

    let READER_IS_PANNING = false;
    let READER_PAN_START_X = 0;
    let READER_PAN_START_Y = 0;
    let READER_SCROLL_START_X = 0;
    let READER_SCROLL_START_Y = 0;
    let READER_SPACE_DOWN = false;

    function applyReaderZoom() {
      const wrapper = document.getElementById('readerCanvasWrapper');
      const img = document.getElementById('readerPageImg');
      if (img) img.style.transform = 'none'; // Never scale image independently!
      if (wrapper) {
        wrapper.style.transform = `scale(${CURRENT_READER_ZOOM})`;
        wrapper.style.transformOrigin = 'center center';
        wrapper.style.transition = 'transform 0.15s cubic-bezier(0.2, 0, 0, 1)';
      }
      const lbl = document.getElementById('readerZoomLevel');
      if (lbl) lbl.innerText = `${Math.round(CURRENT_READER_ZOOM * 100)}%`;
      updateReaderPanningState();
    }

    function changeReaderZoom(scaleDelta) {
      CURRENT_READER_ZOOM = Math.max(0.6, Math.min(3.0, Math.round((CURRENT_READER_ZOOM + scaleDelta) * 100) / 100));
      applyReaderZoom();
    }

    function resetReaderZoom() {
      CURRENT_READER_ZOOM = 1.0;
      applyReaderZoom();
      const area = document.getElementById('readerContentArea');
      if (area) {
        area.scrollLeft = (area.scrollWidth - area.clientWidth) / 2;
        area.scrollTop = (area.scrollHeight - area.clientHeight) / 2;
      }
    }

    function updateReaderPanningState() {
      const area = document.getElementById('readerContentArea');
      const canvas = document.getElementById('readerAnnotationCanvas');
      if (!area) return;

      const canPan = CURRENT_READER_ZOOM > 1.0 || READER_SPACE_DOWN;
      if (READER_SPACE_DOWN || (canPan && TEACHING_TOOL === 'pointer')) {
        area.style.cursor = 'grab';
        if (canvas) canvas.style.pointerEvents = 'none';
      } else {
        area.style.cursor = 'default';
        if (canvas && TEACHING_TOOL !== 'pointer') {
          canvas.style.pointerEvents = 'auto';
        }
      }
    }

    function setupReaderPanningAndWheel() {
      const area = document.getElementById('readerContentArea');
      if (!area || area._panWheelAttached) return;
      area._panWheelAttached = true;

      // 1. Mouse wheel zoom (Ctrl + Wheel, Alt + Wheel, or Trackpad Pinch)
      area.addEventListener('wheel', function(e) {
        const readerModal = document.getElementById('modalDigitalBookReader');
        if (!readerModal || readerModal.classList.contains('hidden')) return;
        if (!CURRENT_READER_BOOK || CURRENT_READER_BOOK.is_text_viewer) return;

        if (e.ctrlKey || e.altKey) {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.15 : -0.15;
          changeReaderZoom(delta);
        }
      }, { passive: false });

      // 2. Mouse Drag Panning when zoomed in or when holding Spacebar
      area.addEventListener('mousedown', function(e) {
        const canPan = READER_SPACE_DOWN || (CURRENT_READER_ZOOM > 1.0 && TEACHING_TOOL === 'pointer');
        if (!canPan) return;
        if (e.button !== 0 && e.button !== 1) return; // Left or middle mouse click

        READER_IS_PANNING = true;
        READER_PAN_START_X = e.clientX;
        READER_PAN_START_Y = e.clientY;
        READER_SCROLL_START_X = area.scrollLeft;
        READER_SCROLL_START_Y = area.scrollTop;
        area.style.cursor = 'grabbing';
        e.preventDefault();
      });

      window.addEventListener('mousemove', function(e) {
        if (!READER_IS_PANNING) return;
        const dx = e.clientX - READER_PAN_START_X;
        const dy = e.clientY - READER_PAN_START_Y;
        area.scrollLeft = READER_SCROLL_START_X - dx;
        area.scrollTop = READER_SCROLL_START_Y - dy;
      });

      window.addEventListener('mouseup', function() {
        if (READER_IS_PANNING) {
          READER_IS_PANNING = false;
          updateReaderPanningState();
        }
      });
    }

    function toggleReaderFullscreen() {
      const container = document.getElementById('readerModalContainer');
      if (!container) return;
      if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => {
          console.warn("Fullscreen request error:", err);
        });
      } else {
        document.exitFullscreen();
      }
      setTimeout(initOrResizeAnnotationCanvas, 200);
    }

    function closeDigitalBookReader() {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
      resetReaderZoom();
      closeModal('modalDigitalBookReader');
      CURRENT_READER_BOOK = null;
      // USER CORE REQUIREMENT: Reset all session annotations so the next student gets a completely fresh page!
      resetAllTeachingAnnotations();
    }

    // ============================================================
    // IN-LMS INTERACTIVE TEACHING WHITEBOARD & ANNOTATION STUDIO
    // ============================================================
    let TEACHING_TOOL = 'pointer'; // 'pointer', 'laser', 'pen', 'highlighter', 'circle', 'box', 'arrow', 'star', 'tick', 'cross', 'eraser'
    let TEACHING_COLOR = '#ef4444';
    let TEACHING_WIDTH = 4;
    let TEACHING_IS_DRAWING = false;
    let TEACHING_START_PT = null;
    let TEACHING_CURRENT_STROKE = null;
    let TEACHING_PAGE_MARKS = {}; // Session-only in-memory storage: { [pageKey]: [strokes...] }
    let TEACHING_CANVAS_INITIALIZED = false;

    function setTeachingTool(tool) {
      TEACHING_TOOL = tool;
      document.querySelectorAll('.teaching-tool-btn').forEach(btn => btn.classList.remove('active', 'bg-brandDark', 'bg-emerald-700', 'text-white'));
      const activeBtn = document.getElementById('toolBtn_' + tool);
      if (activeBtn) activeBtn.classList.add('active');

      const canvas = document.getElementById('readerAnnotationCanvas');
      const halo = document.getElementById('readerLaserHalo');
      if (canvas) {
        if (tool === 'pointer') {
          canvas.style.cursor = 'default';
          canvas.style.pointerEvents = 'none';
        } else if (tool === 'laser') {
          canvas.style.cursor = 'none';
          canvas.style.pointerEvents = 'auto';
        } else if (tool === 'eraser') {
          canvas.style.cursor = 'cell';
          canvas.style.pointerEvents = 'auto';
        } else {
          canvas.style.cursor = 'crosshair';
          canvas.style.pointerEvents = 'auto';
        }
      }
      if (halo && tool !== 'laser') {
        halo.classList.add('hidden');
      }
      updateReaderPanningState();
    }

    function setTeachingColor(color) {
      TEACHING_COLOR = color;
      document.querySelectorAll('.teaching-color-btn').forEach(btn => btn.classList.remove('active'));
      const colMap = {
        '#ef4444': 'colorBtn_red',
        '#10b981': 'colorBtn_green',
        '#f59e0b': 'colorBtn_gold',
        '#0ea5e9': 'colorBtn_blue',
        '#a855f7': 'colorBtn_purple'
      };
      if (colMap[color]) {
        document.getElementById(colMap[color])?.classList.add('active');
      }
      const halo = document.getElementById('readerLaserHalo');
      if (halo) halo.style.borderColor = color;
    }

    function setTeachingWidth(w) {
      TEACHING_WIDTH = Number(w) || 4;
      [2, 4, 8].forEach(sz => {
        const btn = document.getElementById('widthBtn_' + sz);
        if (btn) {
          if (sz === TEACHING_WIDTH) {
            btn.classList.add('text-white');
            btn.classList.remove('text-slate-400');
          } else {
            btn.classList.remove('text-white');
            btn.classList.add('text-slate-400');
          }
        }
      });
    }

    function initOrResizeAnnotationCanvas() {
      const img = document.getElementById('readerPageImg');
      const canvas = document.getElementById('readerAnnotationCanvas');
      if (!img || !canvas) return;

      const w = img.clientWidth;
      const h = img.clientHeight;
      if (w === 0 || h === 0) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';

      if (!TEACHING_CANVAS_INITIALIZED) {
        bindAnnotationPointerEvents();
        TEACHING_CANVAS_INITIALIZED = true;
      }

      redrawCurrentPageAnnotations();
    }

    function bindAnnotationPointerEvents() {
      const canvas = document.getElementById('readerAnnotationCanvas');
      if (!canvas) return;

      const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0]?.clientX);
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0]?.clientY);
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const xRatio = Math.max(0, Math.min(1, x / rect.width));
        const yRatio = Math.max(0, Math.min(1, y / rect.height));
        return { xRatio, yRatio, px: x, py: y };
      };

      canvas.addEventListener('pointerdown', (e) => {
        if (TEACHING_TOOL === 'pointer') return;
        try { canvas.setPointerCapture(e.pointerId); } catch(err) {}
        const pos = getPos(e);
        TEACHING_IS_DRAWING = true;
        TEACHING_START_PT = pos;

        if (TEACHING_TOOL === 'eraser') {
          eraseStrokeAt(pos);
          return;
        }

        if (TEACHING_TOOL === 'pen' || TEACHING_TOOL === 'highlighter') {
          TEACHING_CURRENT_STROKE = {
            type: TEACHING_TOOL,
            color: TEACHING_COLOR,
            width: TEACHING_TOOL === 'highlighter' ? 18 : TEACHING_WIDTH,
            points: [{ xRatio: pos.xRatio, yRatio: pos.yRatio }]
          };
        } else if (['circle', 'box', 'arrow', 'star', 'tick', 'cross'].includes(TEACHING_TOOL)) {
          TEACHING_CURRENT_STROKE = {
            type: TEACHING_TOOL,
            color: TEACHING_COLOR,
            width: TEACHING_WIDTH,
            start: { xRatio: pos.xRatio, yRatio: pos.yRatio },
            end: { xRatio: pos.xRatio, yRatio: pos.yRatio }
          };
        }
      });

      canvas.addEventListener('pointermove', (e) => {
        const pos = getPos(e);

        // Laser spotlight cursor logic (percentage-based for perfect zoom alignment)
        if (TEACHING_TOOL === 'laser') {
          const halo = document.getElementById('readerLaserHalo');
          if (halo) {
            halo.classList.remove('hidden');
            halo.style.left = (pos.xRatio * 100) + '%';
            halo.style.top = (pos.yRatio * 100) + '%';
          }
          return;
        }

        if (!TEACHING_IS_DRAWING || !TEACHING_CURRENT_STROKE) return;

        if (TEACHING_TOOL === 'eraser') {
          eraseStrokeAt(pos);
          return;
        }

        if (TEACHING_TOOL === 'pen' || TEACHING_TOOL === 'highlighter') {
          TEACHING_CURRENT_STROKE.points.push({ xRatio: pos.xRatio, yRatio: pos.yRatio });
          redrawCurrentPageAnnotations(TEACHING_CURRENT_STROKE);
        } else if (['circle', 'box', 'arrow', 'star', 'tick', 'cross'].includes(TEACHING_TOOL)) {
          TEACHING_CURRENT_STROKE.end = { xRatio: pos.xRatio, yRatio: pos.yRatio };
          redrawCurrentPageAnnotations(TEACHING_CURRENT_STROKE);
        }
      });

      const finishDrawing = (e) => {
        if (!TEACHING_IS_DRAWING) return;
        TEACHING_IS_DRAWING = false;

        if (TEACHING_CURRENT_STROKE) {
          const pageKey = getCurrentPageKey();
          if (!TEACHING_PAGE_MARKS[pageKey]) TEACHING_PAGE_MARKS[pageKey] = [];
          TEACHING_PAGE_MARKS[pageKey].push(TEACHING_CURRENT_STROKE);
          TEACHING_CURRENT_STROKE = null;
          redrawCurrentPageAnnotations();
        }
        TEACHING_START_PT = null;
      };

      canvas.addEventListener('pointerup', finishDrawing);
      canvas.addEventListener('pointercancel', finishDrawing);

      canvas.addEventListener('pointerleave', () => {
        if (TEACHING_TOOL === 'laser') {
          document.getElementById('readerLaserHalo')?.classList.add('hidden');
        }
      });
    }

    function getCurrentPageKey() {
      const bId = CURRENT_READER_BOOK ? CURRENT_READER_BOOK.id : 'default';
      return `${bId}_p${CURRENT_READER_PAGE}`;
    }

    function redrawCurrentPageAnnotations(inProgressStroke = null) {
      const canvas = document.getElementById('readerAnnotationCanvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const dpr = window.devicePixelRatio || 1;
      const pageKey = getCurrentPageKey();
      const strokes = TEACHING_PAGE_MARKS[pageKey] || [];

      // Render committed strokes
      strokes.forEach(s => renderSingleStroke(ctx, s, canvas.width, canvas.height, dpr));

      // Render active drawing stroke (live preview)
      if (inProgressStroke) {
        renderSingleStroke(ctx, inProgressStroke, canvas.width, canvas.height, dpr);
      }
    }

    function renderSingleStroke(ctx, s, cw, ch, dpr) {
      ctx.save();
      const strokeW = (s.width || 3) * dpr;

      if (s.type === 'pen') {
        if (s.points.length < 2) {
          const pt = s.points[0];
          ctx.beginPath();
          ctx.arc(pt.xRatio * cw, pt.yRatio * ch, strokeW / 2, 0, Math.PI * 2);
          ctx.fillStyle = s.color;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.strokeStyle = s.color;
          ctx.lineWidth = strokeW;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.moveTo(s.points[0].xRatio * cw, s.points[0].yRatio * ch);
          for (let i = 1; i < s.points.length; i++) {
            ctx.lineTo(s.points[i].xRatio * cw, s.points[i].yRatio * ch);
          }
          ctx.stroke();
        }
      } else if (s.type === 'highlighter') {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.strokeStyle = s.color || '#fef08a';
        ctx.lineWidth = (s.width || 18) * dpr;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (s.points.length > 0) {
          ctx.moveTo(s.points[0].xRatio * cw, s.points[0].yRatio * ch);
          for (let i = 1; i < s.points.length; i++) {
            ctx.lineTo(s.points[i].xRatio * cw, s.points[i].yRatio * ch);
          }
          ctx.stroke();
        }
      } else if (s.type === 'circle') {
        const x1 = s.start.xRatio * cw;
        const y1 = s.start.yRatio * ch;
        const x2 = s.end.xRatio * cw;
        const y2 = s.end.yRatio * ch;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;
        if (rx > 0 && ry > 0) {
          ctx.beginPath();
          ctx.strokeStyle = s.color;
          ctx.lineWidth = strokeW;
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (s.type === 'box') {
        const x1 = s.start.xRatio * cw;
        const y1 = s.start.yRatio * ch;
        const x2 = s.end.xRatio * cw;
        const y2 = s.end.yRatio * ch;
        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = strokeW;
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      } else if (s.type === 'arrow') {
        const fromX = s.start.xRatio * cw;
        const fromY = s.start.yRatio * ch;
        const toX = s.end.xRatio * cw;
        const toY = s.end.yRatio * ch;
        const headLen = Math.max(14 * dpr, strokeW * 3);
        const angle = Math.atan2(toY - fromY, toX - fromX);

        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = strokeW;
        ctx.lineCap = 'round';
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      } else if (s.type === 'star') {
        const cx = s.start.xRatio * cw;
        const cy = s.start.yRatio * ch;
        const dx = (s.end.xRatio - s.start.xRatio) * cw;
        const dy = (s.end.yRatio - s.start.yRatio) * ch;
        const r = Math.max(18 * dpr, Math.hypot(dx, dy));
        drawStarPath(ctx, cx, cy, 5, r, r * 0.45);
        ctx.fillStyle = s.color || '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      } else if (s.type === 'tick') {
        const cx = s.start.xRatio * cw;
        const cy = s.start.yRatio * ch;
        const dx = (s.end.xRatio - s.start.xRatio) * cw;
        const sz = Math.max(16 * dpr, Math.abs(dx));
        ctx.beginPath();
        ctx.strokeStyle = s.color || '#10b981';
        ctx.lineWidth = strokeW * 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(cx - sz * 0.6, cy);
        ctx.lineTo(cx - sz * 0.1, cy + sz * 0.5);
        ctx.lineTo(cx + sz * 0.8, cy - sz * 0.6);
        ctx.stroke();
      } else if (s.type === 'cross') {
        const cx = s.start.xRatio * cw;
        const cy = s.start.yRatio * ch;
        const dx = (s.end.xRatio - s.start.xRatio) * cw;
        const sz = Math.max(14 * dpr, Math.abs(dx));
        ctx.beginPath();
        ctx.strokeStyle = s.color || '#ef4444';
        ctx.lineWidth = strokeW * 1.5;
        ctx.lineCap = 'round';
        ctx.moveTo(cx - sz * 0.6, cy - sz * 0.6);
        ctx.lineTo(cx + sz * 0.6, cy + sz * 0.6);
        ctx.moveTo(cx + sz * 0.6, cy - sz * 0.6);
        ctx.lineTo(cx - sz * 0.6, cy + sz * 0.6);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawStarPath(ctx, cx, cy, spikes, outerRadius, innerRadius) {
      let rot = (Math.PI / 2) * 3;
      let x = cx;
      let y = cy;
      const step = Math.PI / spikes;

      ctx.beginPath();
      ctx.moveTo(cx, cy - outerRadius);
      for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
      }
      ctx.lineTo(cx, cy - outerRadius);
      ctx.closePath();
    }

    function eraseStrokeAt(pos) {
      const pageKey = getCurrentPageKey();
      const strokes = TEACHING_PAGE_MARKS[pageKey] || [];
      if (strokes.length === 0) return;

      const threshold = 0.05;
      const filtered = strokes.filter(s => {
        if (s.points) {
          return !s.points.some(pt => Math.hypot(pt.xRatio - pos.xRatio, pt.yRatio - pos.yRatio) < threshold);
        }
        if (s.start) {
          const dStart = Math.hypot(s.start.xRatio - pos.xRatio, s.start.yRatio - pos.yRatio);
          const dEnd = s.end ? Math.hypot(s.end.xRatio - pos.xRatio, s.end.yRatio - pos.yRatio) : 1;
          return dStart >= threshold && dEnd >= threshold;
        }
        return true;
      });

      if (filtered.length !== strokes.length) {
        TEACHING_PAGE_MARKS[pageKey] = filtered;
        redrawCurrentPageAnnotations();
      }
    }

    function undoTeachingAnnotation() {
      const pageKey = getCurrentPageKey();
      if (TEACHING_PAGE_MARKS[pageKey] && TEACHING_PAGE_MARKS[pageKey].length > 0) {
        TEACHING_PAGE_MARKS[pageKey].pop();
        redrawCurrentPageAnnotations();
      }
    }

    function clearCurrentPageAnnotations() {
      const pageKey = getCurrentPageKey();
      if (!TEACHING_PAGE_MARKS[pageKey] || TEACHING_PAGE_MARKS[pageKey].length === 0) return;
      if (confirm("Clear all marks on this page?")) {
        TEACHING_PAGE_MARKS[pageKey] = [];
        redrawCurrentPageAnnotations();
      }
    }

    // USER REQUIREMENT: Completely wipe session marks so next student gets a fresh, clean lesson!
    function resetAllTeachingAnnotations() {
      TEACHING_PAGE_MARKS = {};
      TEACHING_CURRENT_STROKE = null;
      TEACHING_IS_DRAWING = false;
      const canvas = document.getElementById('readerAnnotationCanvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      document.getElementById('readerLaserHalo')?.classList.add('hidden');
      setTeachingTool('pointer');
    }

    function downloadAnnotatedLessonSnapshot() {
      const img = document.getElementById('readerPageImg');
      const canvas = document.getElementById('readerAnnotationCanvas');
      if (!img || !canvas) return;

      const offCanvas = document.createElement('canvas');
      const w = img.naturalWidth || img.clientWidth || 800;
      const h = img.naturalHeight || img.clientHeight || 1100;
      offCanvas.width = w;
      offCanvas.height = h;
      const ctx = offCanvas.getContext('2d');

      // 1. Draw base lesson image
      ctx.drawImage(img, 0, 0, w, h);

      // 2. Draw annotations on top
      const pageKey = getCurrentPageKey();
      const strokes = TEACHING_PAGE_MARKS[pageKey] || [];
      strokes.forEach(s => renderSingleStroke(ctx, s, w, h, 1));

      // 3. Add official footer watermark
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(0, h - 44, w, 44);
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('AL-HUDA ISLAMIC CENTRE LMS • Online Quran Class Assessment', 24, h - 18);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(new Date().toLocaleDateString('en-GB') + ` • Page ${CURRENT_READER_PAGE}`, w - 24, h - 18);

      // 4. Download as PNG
      const link = document.createElement('a');
      link.download = `AlHuda_Lesson_Page_${CURRENT_READER_PAGE}_${Date.now()}.png`;
      link.href = offCanvas.toDataURL('image/png');
      link.click();
    }

    window.addEventListener('resize', function() {
      if (CURRENT_READER_BOOK) {
        setTimeout(initOrResizeAnnotationCanvas, 100);
      }
    });

    window.addEventListener('keydown', function(e) {
      const readerModal = document.getElementById('modalDigitalBookReader');
      if (!readerModal || readerModal.classList.contains('hidden')) return;

      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      // 1. Spacebar for click-drag Panning
      if (e.code === 'Space' && !READER_SPACE_DOWN) {
        READER_SPACE_DOWN = true;
        updateReaderPanningState();
        e.preventDefault();
        return;
      }

      // 2. Keyboard Zoom In: + or = or NumpadAdd
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        e.preventDefault();
        changeReaderZoom(+0.15);
        return;
      }

      // 3. Keyboard Zoom Out: - or _ or NumpadSubtract
      if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        changeReaderZoom(-0.15);
        return;
      }

      // 4. Keyboard Reset Zoom: 0 or Numpad0
      if ((e.key === '0' || e.code === 'Numpad0') && !e.ctrlKey) {
        e.preventDefault();
        resetReaderZoom();
        return;
      }

      // 5. Page Navigation: Arrow keys
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        changeReaderPage(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        changeReaderPage(+1);
        return;
      }

      // 6. Close Reader on Escape
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDigitalBookReader();
        return;
      }

      // 7. Whiteboard Teaching Studio Shortcuts
      const k = e.key.toUpperCase();
      if (e.ctrlKey && k === 'Z') {
        e.preventDefault();
        undoTeachingAnnotation();
      } else if (k === 'P') {
        setTeachingTool('pen');
      } else if (k === 'H') {
        setTeachingTool('highlighter');
      } else if (k === 'L') {
        setTeachingTool('laser');
      } else if (k === 'V') {
        setTeachingTool('pointer');
      } else if (k === 'C') {
        setTeachingTool('circle');
      } else if (k === 'B') {
        setTeachingTool('box');
      } else if (k === 'A') {
        setTeachingTool('arrow');
      } else if (k === 'S') {
        setTeachingTool('star');
      } else if (k === 'E') {
        setTeachingTool('eraser');
      }
    });

    window.addEventListener('keyup', function(e) {
      if (e.code === 'Space' && READER_SPACE_DOWN) {
        READER_SPACE_DOWN = false;
        updateReaderPanningState();
      }
    });

    function copyBookDeepLink(bookId, bookTitle) {
      const url = `${window.location.origin}/index.html?book=${bookId}`;
      navigator.clipboard.writeText(url);
      alert(`✅ Direct Link for "${bookTitle}" Copied to Clipboard!\n\n${url}\n\nStudents or teachers can open this link to view the book directly in LMS.`);
    }

    // Custom Book Upload Handling
    let SELECTED_CUSTOM_FILES = [];

    function openCustomBookUploadModal() {
      SELECTED_CUSTOM_FILES = [];
      const fInput = document.getElementById('cbFileInput');
      if (fInput) fInput.value = '';
      const fCount = document.getElementById('cbSelectedFilesCount');
      if (fCount) fCount.innerText = 'No files chosen yet. Select all pages in order.';
      openModal('modalUploadCustomBook');
    }

    function handleCustomBookFileSelection(input) {
      SELECTED_CUSTOM_FILES = Array.from(input.files || []);
      const fCount = document.getElementById('cbSelectedFilesCount');
      if (fCount) {
        fCount.innerText = `${SELECTED_CUSTOM_FILES.length} pages selected. Auto-compression to WebP enabled.`;
        fCount.classList.add('text-emerald-700', 'font-bold');
      }
    }

    async function handleSaveCustomBook(e) {
      e.preventDefault();
      const title = document.getElementById('cbTitle')?.value.trim();
      const title_ar = document.getElementById('cbTitleAr')?.value.trim() || '';
      const category = document.getElementById('cbCategory')?.value || 'qaida';
      const author = document.getElementById('cbAuthor')?.value.trim() || 'Al-Huda Academic Board';
      const description = document.getElementById('cbDescription')?.value.trim() || 'Custom Academy Course Material';

      if (!title || SELECTED_CUSTOM_FILES.length === 0) {
        alert("Please provide a book title and select at least one page image.");
        return;
      }

      const btn = document.getElementById('btnSaveCustomBook');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Compressing &amp; Saving...';

      try {
        // Compress images client-side into lightweight WebP data URLs
        const compressedPages = [];
        for (let i = 0; i < SELECTED_CUSTOM_FILES.length; i++) {
          const file = SELECTED_CUSTOM_FILES[i];
          const dataUrl = await compressImageToWebP(file);
          compressedPages.push(dataUrl);
        }

        const customBook = {
          id: 'custom-' + Date.now(),
          title,
          title_ar,
          category,
          category_label: category === 'qaida' ? 'Qaida & Primers' : category === 'quran' ? 'The Holy Quran' : category === 'tafseer' ? 'Tafseer & Translation' : 'Islamic Studies',
          author,
          edition: 'Custom Academy Edition',
          description,
          total_pages: compressedPages.length,
          pages: compressedPages,
          cover_icon: 'fa-solid fa-book-bookmark',
          cover_bg: 'from-slate-800 to-indigo-950',
          created_at: new Date().toISOString()
        };

        const existingCustom = getCustomBooks();
        existingCustom.unshift(customBook);
        saveCustomBooks(existingCustom);

        alert(`✅ Custom Book "${title}" Saved Successfully!\n\nTotal Pages: ${compressedPages.length}\nAdded to Course Material Library.`);
        closeModal('modalUploadCustomBook');
        loadCurriculumLibrary(category);
      } catch (err) {
        alert("Error saving custom book: " + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save &amp; Add to Library';
      }
    }

    // ============================================================
    // EDIT & MANAGE COURSE MATERIAL (CUSTOM / SYLLABUS BOOKS)
    // ============================================================
    let EDIT_BOOK_APPEND_FILES = [];

    function openEditCustomBookModal(bookId) {
      const allBooks = getAllAvailableBooks();
      const book = allBooks.find(b => b.id === bookId);
      if (!book) {
        alert("Course book not found.");
        return;
      }

      EDIT_BOOK_APPEND_FILES = [];
      const appendInput = document.getElementById('editBookAppendFiles');
      if (appendInput) appendInput.value = '';
      const appendMsg = document.getElementById('editBookAppendMsg');
      if (appendMsg) {
        appendMsg.innerText = 'Select additional page scans to add at the end of this book.';
        appendMsg.className = 'text-[10px] text-slate-400 mt-1';
      }

      document.getElementById('editBookId').value = book.id;
      document.getElementById('editBookTitle').value = book.title || '';
      document.getElementById('editBookTitleAr').value = book.title_ar || '';
      document.getElementById('editBookCategory').value = book.category || 'qaida';
      document.getElementById('editBookAuthor').value = book.author || '';
      document.getElementById('editBookEdition').value = book.edition || '';
      document.getElementById('editBookDescription').value = book.description || '';

      const pageCount = (book.pages && book.pages.length) || book.total_pages || (book.paras ? 548 : 0);
      document.getElementById('editBookCurrentPagesCount').innerText = `${pageCount} Pages`;

      const delBtn = document.getElementById('btnDeleteCurriculumBookModal');
      if (delBtn) {
        delBtn.style.display = CURRENT_ROLE === 'manager' ? 'none' : 'inline-flex';
      }

      openModal('modalEditCustomBook');
    }

    function handleEditBookAppendFiles(input) {
      EDIT_BOOK_APPEND_FILES = Array.from(input.files || []);
      const appendMsg = document.getElementById('editBookAppendMsg');
      if (appendMsg) {
        appendMsg.innerText = `${EDIT_BOOK_APPEND_FILES.length} additional pages selected. They will be appended when you save.`;
        appendMsg.className = 'text-[10px] text-emerald-700 font-bold mt-1';
      }
    }

    async function handleUpdateCustomBook(e) {
      e.preventDefault();
      const bookId = document.getElementById('editBookId')?.value;
      const title = document.getElementById('editBookTitle')?.value.trim();
      const title_ar = document.getElementById('editBookTitleAr')?.value.trim() || '';
      const category = document.getElementById('editBookCategory')?.value || 'qaida';
      const author = document.getElementById('editBookAuthor')?.value.trim() || '';
      const edition = document.getElementById('editBookEdition')?.value.trim() || '';
      const description = document.getElementById('editBookDescription')?.value.trim() || '';

      if (!title) {
        alert("Please enter a book title.");
        return;
      }

      const btn = document.getElementById('btnUpdateCustomBook');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving Changes...';

      try {
        let customBooks = getCustomBooks();
        let bookIndex = customBooks.findIndex(b => b.id === bookId);

        // Compress any new appended pages
        let appendedPages = [];
        if (EDIT_BOOK_APPEND_FILES.length > 0) {
          for (let i = 0; i < EDIT_BOOK_APPEND_FILES.length; i++) {
            const dataUrl = await compressImageToWebP(EDIT_BOOK_APPEND_FILES[i]);
            appendedPages.push(dataUrl);
          }
        }

        const catLabel = category === 'qaida' ? 'Qaida & Primers' :
                         category === 'quran' ? 'The Holy Quran' :
                         category === 'tafseer' ? 'Tafseer & Translation' :
                         category === 'hadith' ? 'Hadith Collections' : 'Islamic Essentials';

        if (bookIndex >= 0) {
          // Existing custom book in localStorage
          const targetBook = customBooks[bookIndex];
          targetBook.title = title;
          targetBook.title_ar = title_ar;
          targetBook.category = category;
          targetBook.category_label = catLabel;
          targetBook.author = author;
          targetBook.edition = edition;
          targetBook.description = description;

          if (appendedPages.length > 0) {
            targetBook.pages = [...(targetBook.pages || []), ...appendedPages];
            targetBook.total_pages = targetBook.pages.length;
          }
          targetBook.updated_at = new Date().toISOString();
          customBooks[bookIndex] = targetBook;
        } else {
          // Editing a standard book converts it into a customized copy in customBooks
          const allBooks = getAllAvailableBooks();
          const origBook = allBooks.find(b => b.id === bookId) || {};
          const newCustomBook = {
            ...origBook,
            id: 'custom-' + Date.now(),
            title,
            title_ar,
            category,
            category_label: catLabel,
            author,
            edition,
            description,
            pages: [...(origBook.pages || []), ...appendedPages],
            total_pages: ((origBook.pages && origBook.pages.length) || origBook.total_pages || 0) + appendedPages.length,
            updated_at: new Date().toISOString()
          };
          customBooks.unshift(newCustomBook);

          // Mark standard book id as replaced/deleted
          const deletedIds = getDeletedBookIds();
          if (!deletedIds.includes(bookId)) {
            deletedIds.push(bookId);
            saveDeletedBookIds(deletedIds);
          }
        }

        saveCustomBooks(customBooks);
        alert(`✅ Course Material "${title}" updated successfully!`);
        closeModal('modalEditCustomBook');
        loadCurriculumLibrary(category);
      } catch (err) {
        alert("Error updating book: " + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Save Changes';
      }
    }

    function handleDeleteCurriculumBook(bookId, bookTitle) {
      if (CURRENT_ROLE === 'manager') {
        alert("Access Denied: Managers are not authorized to delete course material books. Only the System Owner can delete books.");
        return;
      }
      if (!confirm(`Are you sure you want to delete course material "${bookTitle || 'this book'}" from the library?`)) {
        return;
      }

      // 1. Remove from custom books if present
      let customBooks = getCustomBooks();
      const filteredCustom = customBooks.filter(b => b.id !== bookId);
      saveCustomBooks(filteredCustom);

      // 2. Mark ID as deleted so even default books stay removed
      const deletedIds = getDeletedBookIds();
      if (!deletedIds.includes(bookId)) {
        deletedIds.push(bookId);
        saveDeletedBookIds(deletedIds);
      }

      alert(`🗑️ "${bookTitle || 'Course material'}" has been deleted from library.`);
      loadCurriculumLibrary(CURRENT_CURRICULUM_CATEGORY);
    }

    function handleDeleteCurriculumBookFromModal() {
      const bookId = document.getElementById('editBookId')?.value;
      const bookTitle = document.getElementById('editBookTitle')?.value;
      if (!bookId) return;

      closeModal('modalEditCustomBook');
      handleDeleteCurriculumBook(bookId, bookTitle);
    }

    // Helper: Client-side image compression to 1200px WebP (<50KB)
    function compressImageToWebP(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
          const img = new Image();
          img.src = e.target.result;
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxDim = 1200;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > maxDim) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              }
            } else {
              if (height > maxDim) {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/webp', 0.82));
          };
          img.onerror = reject;
        };
        reader.onerror = reject;
      });
    }


    // Check URL parameters for direct book links (e.g. ?book=quran-16-line&page=15)
    (function checkUrlBookParam() {
      const params = new URLSearchParams(window.location.search);
      const bookId = params.get('book');
      const pageNum = params.get('page') || 1;
      if (bookId) {
        setTimeout(() => {
          openDigitalBookReader(bookId, pageNum);
        }, 800);
      }
    })();

