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
    let CURRENT_READER_PARA = 1;
    let CURRENT_READER_ZOOM = 1.0;
    let CUSTOM_BOOKS_CACHE = [];
    // Batch 2 (S13): the REAL reason the last catalog cloud save failed
    // (server error message), so the UI can show it instead of a generic
    // "check your connection" while silently pretending success.
    let _lastCatalogSyncError = '';

    function getCustomBooks() {
      try {
        return JSON.parse(localStorage.getItem('alhuda_custom_books') || '[]');
      } catch (e) {
        return [];
      }
    }

    async function saveCustomBooks(books) {
      let localOk = true;
      try {
        localStorage.setItem('alhuda_custom_books', JSON.stringify(books));
      } catch(e) {
        localOk = false;
        console.warn("Could not save custom books to storage:", e);
      }
      const cloudOk = await syncCustomBooksToD1Chunked(books);
      return localOk && cloudOk === true;
    }

    // Reports the real save outcome: success only when the book is persisted.
    // Never claims success if the save did not complete.
    async function saveCustomBooksWithReport(books, successMsg) {
      const ok = await saveCustomBooks(books);
      if (ok) {
        lmsNotify(successMsg);
      } else {
        // Batch 2 (S13): surface the REAL server error when there is one
        // (e.g. a permission denial), not just a generic connection hint.
        const realErr = _lastCatalogSyncError ? `\n\nServer said: ${_lastCatalogSyncError}` : '';
        console.warn('[LMS] operation failed:', realErr); lmsNotify('⚠️ The material was prepared but could NOT be saved reliably.\n\nYour pages were not lost from this screen, but they may not appear after refresh or on other devices.\nPlease check your internet connection and try saving again. Nothing was deleted. Please try again.', { type: 'error' });
      }
      return ok;
    }

    // The catalog merge shared by every catalog write: read the cloud
    // index, merge cloud + local (local wins on conflict), then drop
    // tombstoned ids. SAFETY (catalog-wipe protection): the cloud
    // catalog is never overwritten with an empty/stale local list;
    // explicit deletes are enforced via the tombstone list.
    async function _mergeEffectiveBooks(localBooks) {
      let cloudBooks = [];
      try {
        const { data: idxRows } = await db.from('system_settings').select('value').eq('key', 'alhuda_custom_books_index').limit(1);
        if (Array.isArray(idxRows) && idxRows.length > 0 && idxRows[0].value) {
          const parsed = JSON.parse(idxRows[0].value);
          if (Array.isArray(parsed)) cloudBooks = parsed;
        }
      } catch (e) { /* keep cloudBooks empty on read failure */ }
      const deletedIds = (typeof getDeletedBookIds === 'function') ? getDeletedBookIds() : [];
      const merged = (Array.isArray(localBooks) ? localBooks : []).slice();
      cloudBooks.forEach(function (cb) {
        if (cb && cb.id && !merged.some(function (lb) { return lb && lb.id === cb.id; })) merged.push(cb);
      });
      return merged.filter(function (b) { return b && !deletedIds.includes(b.id); });
    }

    // The catalog index payload for a merged book list: each book's
    // metadata with its pages stripped (pages live in BOOK_PAGE rows).
    function _catalogIndexOf(effectiveBooks) {
      return (effectiveBooks || []).map(function (b) {
        const pages = Array.isArray(b.pages) ? b.pages : [];
        return {
          ...b,
          pages: [],
          total_pages: pages.length || b.total_pages || 0
        };
      });
    }

    // Bounded-concurrency runner for independent operations (storage
    // deletes, row prunes). At most `limit` operations are in flight at
    // once. With stopOnError, no NEW operation starts after the first
    // failure (in-flight ones settle) — the caller still receives every
    // failure. onProgress(done, total) fires after each completion.
    async function _runBoundedPool(items, limit, worker, opts) {
      const list = Array.isArray(items) ? items : [];
      const maxInFlight = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
      const stopOnError = !!(opts && opts.stopOnError);
      const onProgress = (opts && typeof opts.onProgress === 'function') ? opts.onProgress : null;
      const failures = [];
      let next = 0;
      let done = 0;
      let stopped = false;
      async function lane() {
        while (!stopped && next < list.length) {
          const item = list[next];
          next++;
          try {
            await worker(item);
          } catch (e) {
            failures.push({ item: item, error: e });
            if (stopOnError) stopped = true;
          }
          done++;
          if (onProgress) { try { onProgress(done, list.length); } catch (e) {} }
        }
      }
      const lanes = [];
      for (let i = 0; i < maxInFlight; i++) lanes.push(lane());
      await Promise.all(lanes);
      return { failures: failures };
    }

    // Upsert BOOK_PAGE-style rows in array batches (the /api/db engine
    // accepts a values array in ONE request — the old per-row loop made
    // one HTTP round trip per page). 100 rows per request keeps each
    // payload modest (page values are short storage URLs). Throws on
    // the first server error, like the per-row check did.
    const _PAGE_UPSERT_CHUNK = 100;
    async function _upsertPageRowsBatched(rows, onProgress) {
      const list = Array.isArray(rows) ? rows : [];
      let done = 0;
      for (let i = 0; i < list.length; i += _PAGE_UPSERT_CHUNK) {
        const chunk = list.slice(i, i + _PAGE_UPSERT_CHUNK);
        const res = await db.from('system_settings').upsert(chunk);
        if (res && res.error) {
          throw new Error((res.error.message || res.error) + ' (while saving a book page)');
        }
        done += chunk.length;
        if (typeof onProgress === 'function') { try { onProgress(done); } catch (e) {} }
      }
      return done;
    }

    async function syncCustomBooksToD1Chunked(books, options) {
      const opts = options || {};
      _lastCatalogSyncError = '';
      try {
        if (typeof db === 'undefined' || !db || typeof db.from !== 'function') {
          _lastCatalogSyncError = 'Database connection unavailable.';
          return false;
        }
        const localBooks = Array.isArray(books) ? books : [];

        const effectiveBooks = await _mergeEffectiveBooks(localBooks);
        const catalogIndex = _catalogIndexOf(effectiveBooks);
        const rowsToUpsert = [];

        for (const b of effectiveBooks) {
          const pages = Array.isArray(b.pages) ? b.pages : [];
          for (let i = 0; i < pages.length; i++) {
            const pageKey = `BOOK_PAGE_${b.id}_${i}`;
            rowsToUpsert.push({
              id: `SYS-${b.id}-P${i}`,
              key: pageKey,
              value: pages[i],
              updated_at: new Date().toISOString()
            });
          }
        }

        // Batch 2 (S13): the db shim reports Worker denials as a returned
        // { error } (it only throws for the offline WRITE GUARD). Every
        // upsert result MUST be checked — an unchecked denial used to be
        // swallowed here and the UI reported a save that never happened.
        const _checkUpsert = function (res, what) {
          if (res && res.error) {
            throw new Error((res.error.message || res.error) + ` (while saving ${what})`);
          }
        };

        const _upsertCatalogIndex = async function () {
          _checkUpsert(await db.from('system_settings').upsert({
            id: 'SYS-CUSTOM-BOOKS-INDEX',
            key: 'alhuda_custom_books_index',
            value: JSON.stringify(catalogIndex),
            updated_at: new Date().toISOString()
          }), 'the catalog index');
        };
        const _upsertCatalogMirror = async function () {
          _checkUpsert(await db.from('system_settings').upsert({
            id: 'SYS-CUSTOM-BOOKS-ALL',
            key: 'alhuda_custom_books',
            value: JSON.stringify(catalogIndex),
            updated_at: new Date().toISOString()
          }), 'the catalog');
        };
        const _upsertAllPages = async function () {
          for (const row of rowsToUpsert) {
            _checkUpsert(await db.from('system_settings').upsert(row), 'a book page');
          }
        };

        if (opts.pagesFirst) {
          // Hardened order, used by the page editor's save path: write
          // the BOOK_PAGE rows FIRST and the catalog index LAST, so a
          // mid-save failure never leaves the index advertising pages
          // that were not written (the failure shape behind the live
          // MADANI QAIDA index/rows mismatch). When the edited book
          // shrank, its surplus tail rows are deleted in between —
          // filtered by `key`, the form the Worker manager guard
          // accepts for system_settings deletes, so manager saves keep
          // working with no Worker change.
          await _upsertAllPages();
          if (opts.pruneBookId) {
            const pruneFrom = Number(opts.pruneFromIndex) || 0;
            const pruneTo = Number(opts.pruneToIndex) || 0;
            for (let i = pruneFrom; i < pruneTo; i++) {
              const pageKey = `BOOK_PAGE_${opts.pruneBookId}_${i}`;
              const delRes = await db.from('system_settings').delete().eq('key', pageKey);
              if (delRes && delRes.error) {
                throw new Error((delRes.error.message || delRes.error) + ` (while removing surplus page ${i + 1})`);
              }
            }
          }
          await _upsertCatalogIndex();
          await _upsertCatalogMirror();
        } else {
          // Upsert catalog index first to immediately update library across all portals
          await _upsertCatalogIndex();
          await _upsertCatalogMirror();
          // Upsert individual book pages
          await _upsertAllPages();
        }
        return true;
      } catch (e) {
        _lastCatalogSyncError = (e && e.message) ? String(e.message) : String(e);
        console.warn('[Course Material D1 Sync] Notice:', e);
        return false;
      }
    }

    // Scoped page save for the Page Editor (performance fix, 2026-11-06).
    // The full sync above rewrites EVERY book's EVERY page row, one HTTP
    // request per row — over a thousand sequential requests at live
    // scale for an edit that changes a handful of pages. This path
    // writes ONLY the edited book's changed positions (array-batched),
    // prunes its tail, then writes the catalog index + mirror — the
    // same pages-first order and the same final D1 state as the sync's
    // pagesFirst branch. Other books' rows are never touched.
    // oldFlat is the book's page array as loaded when the editor opened
    // (D1 row i holds oldFlat[i]); pruneTo covers sparse records whose
    // advertised row count exceeds the loaded array (MADANI QAIDA).
    async function _saveBookPagesScoped(books, bookId, oldFlat, pruneTo, onProgress) {
      _lastCatalogSyncError = '';
      try {
        if (typeof db === 'undefined' || !db || typeof db.from !== 'function') {
          _lastCatalogSyncError = 'Database connection unavailable.';
          return false;
        }
        const localBooks = Array.isArray(books) ? books : [];
        const sourceBook = localBooks.find(function (b) { return b && b.id === bookId; }) || null;
        const effectiveBooks = await _mergeEffectiveBooks(localBooks);
        const inCatalog = effectiveBooks.some(function (b) { return b && b.id === bookId; });

        const oldPages = Array.isArray(oldFlat) ? oldFlat : [];
        const newPages = (sourceBook && Array.isArray(sourceBook.pages)) ? sourceBook.pages : [];
        const changedRows = [];
        if (inCatalog && sourceBook) {
          for (let i = 0; i < newPages.length; i++) {
            if (oldPages[i] !== newPages[i]) {
              changedRows.push({
                id: `SYS-${bookId}-P${i}`,
                key: `BOOK_PAGE_${bookId}_${i}`,
                value: newPages[i],
                updated_at: new Date().toISOString()
              });
            }
          }
        }
        const pruneKeys = [];
        if (inCatalog && sourceBook) {
          const from = newPages.length;
          const to = Math.max(oldPages.length, Number(pruneTo) || 0);
          for (let i = from; i < to; i++) pruneKeys.push(`BOOK_PAGE_${bookId}_${i}`);
        }
        const totalUnits = changedRows.length + pruneKeys.length + 2;
        let doneUnits = 0;
        const report = function () { if (typeof onProgress === 'function') { try { onProgress(doneUnits, totalUnits); } catch (e) {} } };

        // Pages first (upserts, then tail prunes), catalog last — the
        // hardened order: the index never advertises unwritten pages.
        await _upsertPageRowsBatched(changedRows, function (n) { doneUnits = n; report(); });
        doneUnits = changedRows.length;
        if (pruneKeys.length > 0) {
          // Prunes stay eq-on-key deletes: the Worker manager guard
          // accepts only that form for system_settings deletes, so
          // manager saves keep working. The pool parallelises them.
          const prune = await _runBoundedPool(pruneKeys, 6, async function (pageKey) {
            const delRes = await db.from('system_settings').delete().eq('key', pageKey);
            if (delRes && delRes.error) {
              throw new Error((delRes.error.message || delRes.error) + ' (while removing a surplus page)');
            }
          }, { onProgress: function () { doneUnits++; report(); } });
          if (prune.failures.length > 0) throw prune.failures[0].error;
          doneUnits = changedRows.length + pruneKeys.length;
        }
        const catalogIndex = _catalogIndexOf(effectiveBooks);
        const _check = function (res, what) {
          if (res && res.error) throw new Error((res.error.message || res.error) + ` (while saving ${what})`);
        };
        _check(await db.from('system_settings').upsert({
          id: 'SYS-CUSTOM-BOOKS-INDEX',
          key: 'alhuda_custom_books_index',
          value: JSON.stringify(catalogIndex),
          updated_at: new Date().toISOString()
        }), 'the catalog index');
        doneUnits++; report();
        _check(await db.from('system_settings').upsert({
          id: 'SYS-CUSTOM-BOOKS-ALL',
          key: 'alhuda_custom_books',
          value: JSON.stringify(catalogIndex),
          updated_at: new Date().toISOString()
        }), 'the catalog');
        doneUnits++; report();
        return true;
      } catch (e) {
        _lastCatalogSyncError = (e && e.message) ? String(e.message) : String(e);
        console.warn('[Course Material Scoped Save] Notice:', e);
        return false;
      }
    }

    // Catalog-only commit for book deletion: persist the local list and
    // rewrite ONLY the catalog index + mirror rows in D1 — no page
    // rows. The full sync's per-row rewrite of every OTHER book's pages
    // (hundreds of no-op round trips) was most of a deletion's cost;
    // the final catalog state is identical, because the index is built
    // from the same merged, tombstone-filtered list either way.
    async function _commitCatalogOnly(books) {
      let localOk = true;
      try {
        localStorage.setItem('alhuda_custom_books', JSON.stringify(books));
      } catch (e) {
        localOk = false;
        console.warn("Could not save custom books to storage:", e);
      }
      _lastCatalogSyncError = '';
      try {
        if (typeof db === 'undefined' || !db || typeof db.from !== 'function') {
          _lastCatalogSyncError = 'Database connection unavailable.';
          return false;
        }
        const effectiveBooks = await _mergeEffectiveBooks(books);
        const catalogIndex = _catalogIndexOf(effectiveBooks);
        const _check = function (res, what) {
          if (res && res.error) throw new Error((res.error.message || res.error) + ` (while saving ${what})`);
        };
        _check(await db.from('system_settings').upsert({
          id: 'SYS-CUSTOM-BOOKS-INDEX',
          key: 'alhuda_custom_books_index',
          value: JSON.stringify(catalogIndex),
          updated_at: new Date().toISOString()
        }), 'the catalog index');
        _check(await db.from('system_settings').upsert({
          id: 'SYS-CUSTOM-BOOKS-ALL',
          key: 'alhuda_custom_books',
          value: JSON.stringify(catalogIndex),
          updated_at: new Date().toISOString()
        }), 'the catalog');
        return localOk;
      } catch (e) {
        _lastCatalogSyncError = (e && e.message) ? String(e.message) : String(e);
        console.warn('[Course Material Catalog Commit] Notice:', e);
        return false;
      }
    }

    async function hydrateCustomBooksFromCloudflareD1() {
      try {
        if (typeof db === 'undefined' || !db || typeof db.from !== 'function') return;
        const { data: allSettings } = await db.from('system_settings').select('*');
        if (!Array.isArray(allSettings) || allSettings.length === 0) return;

        const settingsMap = new Map(allSettings.map(r => [String(r.key), r.value]));

        // 1. Sync deleted books tombstone list bidirectionally
        const remoteDeletedRaw = settingsMap.get('alhuda_deleted_books');
        let remoteDeleted = [];
        if (remoteDeletedRaw) {
          try {
            remoteDeleted = JSON.parse(remoteDeletedRaw);
          } catch(e) {
            remoteDeleted = [];
          }
        }
        if (!Array.isArray(remoteDeleted)) remoteDeleted = [];

       let localDeleted = getDeletedBookIds();
if (!Array.isArray(localDeleted)) localDeleted = [];

// RE-POISON GUARD (2026-10-19): a book that exists in the live catalog
// can never count as deleted. A stale browser tombstone must neither
// hide live books nor be pushed back into D1 (caught re-poisoning
// alhuda_deleted_books three times in one evening via the merge below).
let liveBookIds = new Set();
try {
  const rawLive = settingsMap.get('alhuda_custom_books_index') || settingsMap.get('alhuda_custom_books');
  const liveBooks = rawLive ? JSON.parse(rawLive) : [];
  if (Array.isArray(liveBooks)) {
    liveBookIds = new Set(liveBooks.map(function (b) { return b && b.id; }).filter(Boolean));
  }
} catch (e) {}

// URGENT FIX (Issue 2): the guard below protected only ids present in the
// live custom index, so a tombstoned ALLOWLISTED built-in could never
// heal — deleting the built-in e-Qaida from the admin grid hid it from
// Admin while the teacher portal (which could not read the tombstone)
// kept showing it. Allowlisted built-ins are protected the same way:
// adding them to liveBookIds strips them from the merged tombstone, and
// the existing push below heals the D1 list, so the book reappears in
// Admin. Other tombstoned built-ins stay tombstoned — only allowlisted
// ids are added here.
getBuiltinAllowlist().forEach(function (id) { if (id) liveBookIds.add(String(id)); });

const mergedDeleted = Array.from(new Set([...localDeleted, ...remoteDeleted]))
  .filter(function (id) { return !liveBookIds.has(String(id)); });
if (mergedDeleted.length > 0) {
  localStorage.setItem('alhuda_deleted_books', JSON.stringify(mergedDeleted));
  // Push when the sanitized list differs from the backend's: either the
  // browser genuinely deleted something new, or the guard just healed a
  // poisoned backend list by stripping live-book IDs out of it.
  if (mergedDeleted.length !== remoteDeleted.length) {

            await db.from('system_settings').upsert({
              id: 'SYS-DELETED-BOOKS',
              key: 'alhuda_deleted_books',
              value: JSON.stringify(mergedDeleted),
              updated_at: new Date().toISOString()
            });
          }
        }

        // 2. Sync custom books and purge any deleted books from local cache
        const rawIndex = settingsMap.get('alhuda_custom_books_index') || settingsMap.get('alhuda_custom_books');
        if (rawIndex !== undefined && rawIndex !== null) {
          let books = [];
          try {
            books = JSON.parse(rawIndex);
          } catch(e) {
            books = [];
          }

          if (Array.isArray(books)) {
            books.forEach(b => {
              const total = Number(b.total_pages) || 0;
              if ((!b.pages || b.pages.length === 0) && total > 0) {
                // Preserve page indices: a missing page record leaves a hole
                // (honest "not available") instead of shifting later pages up.
                const hydratedPages = new Array(total);
                let found = 0;
                for (let i = 0; i < total; i++) {
                  const pVal = settingsMap.get(`BOOK_PAGE_${b.id}_${i}`);
                  if (pVal) { hydratedPages[i] = pVal; found++; }
                }
                if (found > 0) {
                  b.pages = hydratedPages;
                }
              }
            });

            const cleanBooks = books.filter(b => b && !mergedDeleted.includes(b.id));
            localStorage.setItem('alhuda_custom_books', JSON.stringify(cleanBooks));
          }
        }

        if (typeof loadCurriculumLibrary === 'function') {
          loadCurriculumLibrary(CURRENT_CURRICULUM_CATEGORY || 'all');
        }
      } catch (e) {
        console.warn('[Curriculum] Hydration notice:', e);
      }
    }
    setTimeout(hydrateCustomBooksFromCloudflareD1, 600);

    function getDeletedBookIds() {
      try {
        return JSON.parse(localStorage.getItem('alhuda_deleted_books') || '[]');
      } catch(e) {
        return [];
      }
    }

    // Returns true when the tombstone list is safely stored (locally AND
    // on the server, when a db connection exists). Batch 2 (S13): a
    // server denial (returned { error } or a thrown WRITE GUARD error)
    // must surface to the caller instead of silently looking deleted.
    async function saveDeletedBookIds(ids) {
      try {
        localStorage.setItem('alhuda_deleted_books', JSON.stringify(ids));
      } catch(e) {}
      try {
        if (typeof db !== 'undefined' && db && typeof db.from === 'function') {
          const res = await db.from('system_settings').upsert({
            id: 'SYS-DELETED-BOOKS',
            key: 'alhuda_deleted_books',
            value: JSON.stringify(ids),
            updated_at: new Date().toISOString()
          });
          if (res && res.error) {
            _lastCatalogSyncError = (res.error.message || String(res.error)) + ' (while saving the deleted-books list)';
            console.warn('[Curriculum] Could not sync deleted books to cloud:', res.error);
            return false;
          }
        }
      } catch(e) {
        _lastCatalogSyncError = (e && e.message) ? String(e.message) : String(e);
        console.warn('[Curriculum] Could not sync deleted books to cloud:', e);
        return false;
      }
      return true;
    }

    // URGENT FIX (Issue 2): single source for the built-in allowlist
    // (curriculum_data.js sets window.ALHUDA_BUILTIN_ALLOWLIST; the
    // fallback matches the Batch 4 behaviour). Allowlisted built-ins have
    // no D1 record — they can be tombstoned but never truly deleted, so
    // the guard and the grid both consult this list.
    function getBuiltinAllowlist() {
      return (typeof window !== 'undefined' && Array.isArray(window.ALHUDA_BUILTIN_ALLOWLIST)) ? window.ALHUDA_BUILTIN_ALLOWLIST : ['interactive-madani-qaida'];
    }

    function getAllAvailableBooks() {
      const customBooks = getCustomBooks();
      const standardBooks = (typeof ALHUDA_CURRICULUM !== 'undefined' && Array.isArray(ALHUDA_CURRICULUM)) ? ALHUDA_CURRICULUM : [];
      const deletedIds = getDeletedBookIds();
      // Batch 4 (B13): built-in books are listed ONLY when allowlisted in
      // curriculum_data.js (window.ALHUDA_BUILTIN_ALLOWLIST). Every other
      // built-in has no real uploaded pages (its pages were generated
      // placeholders) and must never be listed in any portal, regardless of
      // what the deleted-books tombstone contains.
      const builtinAllowlist = getBuiltinAllowlist();

      const merged = Array.isArray(customBooks) ? [...customBooks] : [];
      standardBooks.forEach(b => {
        if (!builtinAllowlist.includes(b.id)) return;
        if (!merged.some(m => m.id === b.id) && !deletedIds.includes(b.id)) {
          merged.push(b);
        }
      });
      return merged.filter(b => b && !deletedIds.includes(b.id));
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
            <h4 class="font-black text-slate-800 text-lg tracking-tight">No course materials available.</h4>
            <p class="text-xs text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
              No course materials available yet. You can upload new lessons, PDF/image scans, or custom course syllabus using the button below.
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

      // Custom (uploaded) books carry D1 page rows and get the page
      // editor entry; built-ins have no stored pages to manage. The
      // getCustomBooks lookup is typeof-guarded so this renderer also
      // works in contexts where only it was loaded.
      let customIdSet = new Set();
      try {
        if (typeof getCustomBooks === 'function') {
          customIdSet = new Set(getCustomBooks().map(function (b) { return String(b && b.id); }));
        }
      } catch (e) { /* customIdSet stays empty; the id prefix below still applies */ }

      container.innerHTML = books.map((book) => {
        const catKey = book.category || 'qaida';
        const style = categoryStyles[catKey] || categoryStyles.qaida;
        const isCustomBook = customIdSet.has(String(book.id)) || String(book.id).indexOf('custom-') === 0;
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

              <!-- Page Editor: custom (uploaded) books only — built-ins
                   have no D1 page rows to add, remove or reorder -->
              ${isCustomBook ? `
                <button onclick="openPageEditor('${book.id}')" class="px-2.5 py-2.5 bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-2xs" title="Manage Pages (Add / Remove / Reorder)">
                  <i class="fa-solid fa-layer-group text-emerald-600"></i>
                  <span class="hidden sm:inline">Pages</span>
                </button>
              ` : ''}

              <!-- Secondary: Delete Book (not offered for allowlisted
                   built-ins: they have no D1 record to remove, so Delete
                   could only tombstone them — which is how e-Qaida was
                   hidden from Admin) -->
              ${(CURRENT_ROLE !== 'manager' && !getBuiltinAllowlist().includes(String(book.id))) ? `
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
    function openDigitalBookReader(bookId, startPage = 1, paraNum = null, language = null) {
      const allBooks = getAllAvailableBooks();
      const book = allBooks.find(b => b.id === bookId);
      if (!book) {
        lmsNotify("Course book not found.");
        return;
      }

      CURRENT_READER_BOOK = book;
      CURRENT_READER_PAGE = Number(startPage) || 1;
      CURRENT_READER_ZOOM = 1.0;

      const isParaBased = (book.category === 'quran' || book.category === 'tafseer' || !!book.paras_data || !!book.paras);
      if (isParaBased) {
        if (paraNum) {
          CURRENT_READER_PARA = Number(paraNum) || 1;
        } else if (book.paras && book.paras.length > 0) {
          const matchP = book.paras.find(pr => CURRENT_READER_PAGE >= pr.page_start && CURRENT_READER_PAGE <= pr.page_end);
          if (matchP) {
            CURRENT_READER_PARA = matchP.para;
            // Convert absolute page to para-relative page via book.paras.
            // (Fix: this conversion used to run only when the book also
            // carried paras_data, so a paras-only book — the real Quran
            // book — kept the GLOBAL number as its para-relative page
            // and the indicator/clamp disagreed with the para slice.)
            CURRENT_READER_PAGE = Math.max(1, CURRENT_READER_PAGE - matchP.page_start + 1);
          } else {
            CURRENT_READER_PARA = 1;
          }
        } else {
          CURRENT_READER_PARA = 1;
        }
      } else {
        CURRENT_READER_PARA = 1;
      }

      // Update Header Info
      const setT = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
      setT('readerBookTitle', book.title);
      setT('readerCategoryBadge', book.category_label || (book.category === 'tafseer' ? 'Tafseer' : 'Curriculum'));

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

      if (book.category === 'quran' || book.category === 'tafseer' || (book.paras && book.paras.length > 0)) {
        // Quran & Tafseer 30 Paras Registry
        const parasList = (typeof QURAN_PARAS_INFO !== 'undefined' && Array.isArray(QURAN_PARAS_INFO)) ? QURAN_PARAS_INFO : (book.paras || []);
        optionsHtml = parasList.map(p => {
          const pPages = (typeof getBookParaPages === 'function') ? getBookParaPages(book, p.para) : [];
          const countStr = pPages.length > 0 ? ` (${pPages.length} Pages)` : ` (${p.total_pages || 18} Pages)`;
          const pageTarget = p.page_start || 1;
          return `<option value="${pageTarget}" data-para="${p.para}">Para ${p.para}: ${p.name_en || ('Para ' + p.para)} (${p.name_ur || p.name_ar || ''})${countStr}</option>`;
        }).join('');

        jumpSelect.onchange = function() {
          const opt = this.options[this.selectedIndex];
          const pNum = opt ? opt.getAttribute('data-para') : null;
          if (pNum) {
            CURRENT_READER_PARA = Number(pNum);
            CURRENT_READER_PAGE = 1;
          } else {
            CURRENT_READER_PAGE = Number(this.value) || 1;
          }
          renderReaderCurrentPage();
        };
      } else if (book.chapters && book.chapters.length > 0) {
        optionsHtml = book.chapters.map((ch, idx) =>
          `<option value="${ch.page_start || (idx + 1)}">${(ch.title || '').slice(0, 28)} (Page ${ch.page_start || (idx + 1)})</option>`
        ).join('');

        jumpSelect.onchange = function() {
          changeReaderPage(Number(this.value));
        };
      } else if (maxP > 50) {
        const chunkSize = 10;
        const chunks = [];
        for (let i = 1; i <= maxP; i += chunkSize) {
          const end = Math.min(i + chunkSize - 1, maxP);
          chunks.push(`<option value="${i}">Pages ${i}–${end}</option>`);
        }
        optionsHtml = chunks.join('');

        jumpSelect.onchange = function() {
          changeReaderPage(Number(this.value));
        };
      } else {
        const pageOptions = [];
        for (let i = 1; i <= maxP; i++) pageOptions.push(`<option value="${i}">Page ${i}</option>`);
        optionsHtml = pageOptions.join('');

        jumpSelect.onchange = function() {
          changeReaderPage(Number(this.value));
        };
      }

      jumpSelect.innerHTML = optionsHtml;
    }

    function renderReaderCurrentPage() {
      if (!CURRENT_READER_BOOK) return;
      const book = CURRENT_READER_BOOK;
      const isParaBased = (book.category === 'quran' || book.category === 'tafseer' || !!book.paras_data || !!book.paras);
      const paraPages = isParaBased && typeof getBookParaPages === 'function' ? getBookParaPages(book, CURRENT_READER_PARA) : [];
      const maxPages = isParaBased && paraPages.length > 0
        ? paraPages.length
        : (book.total_pages || (book.paras ? 548 : 32));

      // Clamp current page
      CURRENT_READER_PAGE = Math.max(1, Math.min(maxPages, CURRENT_READER_PAGE));

      // Update Page Indicator & Slider. Para-based books show the
      // ORIGINAL (printed) page number via the shared OrigPages helper
      // (js/lesson-history.js); when the book carries no usable paras
      // anchors the para-relative label is kept exactly as before.
      const _origApi = (typeof window !== 'undefined' && window.LessonHistory) ? window.LessonHistory
        : (typeof LessonHistory !== 'undefined' ? LessonHistory : null);
      const _origNow = (isParaBased && _origApi) ? _origApi.origPageFor(book, CURRENT_READER_PARA, CURRENT_READER_PAGE) : null;
      const _origLast = (isParaBased && _origApi) ? _origApi.lastOrigPageFor(book) : null;
      const _showOrig = _origNow !== null && _origNow !== undefined && _origLast !== null && _origLast !== undefined;
      const ind = document.getElementById('readerPageIndicator');
      if (ind) {
        if (isParaBased) {
          ind.innerText = _showOrig
            ? `Para ${CURRENT_READER_PARA} • Page ${_origNow} of ${_origLast}`
            : `Para ${CURRENT_READER_PARA} • Page ${CURRENT_READER_PAGE} of ${maxPages}`;
        } else {
          ind.innerText = `Page ${CURRENT_READER_PAGE} of ${maxPages}`;
        }
      }
      const indTop = document.getElementById('readerPageIndicatorTop');
      if (indTop) {
        if (isParaBased) {
          indTop.innerText = _showOrig ? `Juz ${CURRENT_READER_PARA} • P${_origNow}` : `Juz ${CURRENT_READER_PARA} • P${CURRENT_READER_PAGE}`;
        } else {
          indTop.innerText = `${CURRENT_READER_PAGE} / ${maxPages}`;
        }
      }

      const slider = document.getElementById('readerPageSlider');
      if (slider) {
        slider.min = 1;
        slider.max = maxPages;
        slider.value = CURRENT_READER_PAGE;
      }

      const jumpSelect = document.getElementById('readerJumpSelect');
      if (jumpSelect) {
        if (isParaBased) {
          const opt = Array.from(jumpSelect.options).find(o => Number(o.getAttribute('data-para')) === CURRENT_READER_PARA);
          if (opt) jumpSelect.value = opt.value;
        } else {
          const options = Array.from(jumpSelect.options);
          let bestVal = options[0]?.value;
          options.forEach(opt => {
            if (Number(opt.value) <= CURRENT_READER_PAGE) bestVal = opt.value;
          });
          if (bestVal) jumpSelect.value = bestVal;
        }
      }

      // Update Chapter / Topic subtitle
      const descEl = document.getElementById('readerChapterDesc');
      if (descEl) {
        if (isParaBased) {
          const parasList = (typeof QURAN_PARAS_INFO !== 'undefined' && Array.isArray(QURAN_PARAS_INFO)) ? QURAN_PARAS_INFO : (book.paras || []);
          const matchPara = parasList.find(p => Number(p.para) === CURRENT_READER_PARA) || { name_en: 'Para ' + CURRENT_READER_PARA, name_ur: '' };
          const langBadge = book.language ? ` [${book.language === 'ur' ? 'Urdu' : 'English'}]` : '';
          descEl.innerText = `Para ${CURRENT_READER_PARA}: ${matchPara.name_en || ''} (${matchPara.name_ur || matchPara.name_ar || ''})${langBadge} — Page ${CURRENT_READER_PAGE}`;
        } else if (book.chapters) {
          const matchCh = book.chapters.find(c => CURRENT_READER_PAGE >= (c.page_start || 1) && CURRENT_READER_PAGE <= (c.page_end || maxPages));
          descEl.innerText = matchCh ? `${matchCh.title} — ${matchCh.desc || ''}` : `Page ${CURRENT_READER_PAGE}`;
        } else {
          descEl.innerText = `${book.edition || 'Lesson'} • Page ${CURRENT_READER_PAGE}`;
        }
      }

      // 0. Interactive Digital Lab (Interactive E-Qaida)
      if (book.is_interactive) {
        document.getElementById('readerImageStage')?.classList.add('hidden');
        document.getElementById('readerTextStage')?.classList.add('hidden');
        const interStage = document.getElementById('readerInteractiveStage');
        if (interStage) {
          interStage.classList.remove('hidden');
          if (typeof AlHudaInteractiveQaida !== 'undefined' && AlHudaInteractiveQaida.renderInteractivePage) {
            AlHudaInteractiveQaida.renderInteractivePage('readerInteractiveContent', CURRENT_READER_PAGE);
          }
        }
        document.getElementById('readerLoadingSpinner')?.classList.add('hidden');
        return;
      }

      document.getElementById('readerInteractiveStage')?.classList.add('hidden');

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
        // Clear any previous honest-error state before rendering the new page.
        if (typeof READER_ERROR_TIMER !== 'undefined' && READER_ERROR_TIMER) { clearTimeout(READER_ERROR_TIMER); READER_ERROR_TIMER = null; }
        const prevErr = document.getElementById('readerPageError');
        if (prevErr) prevErr.style.display = 'none';
        img.style.display = '';

        // Reset individual image transform - layout zoom sizes the img itself
        img.style.transform = 'none';
        applyReaderZoom();

        // New page: its zoom-1 base size is captured fresh once it loads,
        // so each page is layout-zoomed from its own rendered size.
        READER_BASE_W = 0;
        READER_BASE_H = 0;

        // Get URL with Content-Type awareness (Juz/Para + Language)
        // NOTE (Batch 4, B13): the honesty rule now applies to EVERY book,
        // not only custom ones. Built-in books without real uploaded pages
        // are no longer listed at all (see ALHUDA_BUILTIN_ALLOWLIST in
        // curriculum_data.js), and a generated placeholder SVG must never
        // be substituted for a missing page: if the real page cannot be
        // resolved, show an honest "not available" state instead. The one
        // exception is the Interactive Qaida, which is rendered by its own
        // interactive renderer above and never reaches this image path.
        let pageUrl = '';
        const isInteractiveBook = !!(book && book.is_interactive);
        if (typeof CURRICULUM_DATA !== 'undefined' && typeof CURRICULUM_DATA.getPageUrl === 'function') {
          pageUrl = CURRICULUM_DATA.getPageUrl(book.id, CURRENT_READER_PAGE, CURRENT_READER_PARA, book.language);
        } else if (typeof book.getPageUrl === 'function') {
          pageUrl = book.getPageUrl(CURRENT_READER_PAGE, CURRENT_READER_PARA, book.language);
        } else if (book.pages && book.pages[CURRENT_READER_PAGE - 1]) {
          pageUrl = book.pages[CURRENT_READER_PAGE - 1];
        }

        // A resolved data:image/svg URL is a generated placeholder, not a
        // real uploaded page — treat it as unavailable for every book.
        if (!isInteractiveBook && typeof pageUrl === 'string' && pageUrl.indexOf('data:image/svg') === 0) {
          pageUrl = '';
        }

        if (!pageUrl) {
          showReaderPageError(img, spinner, book, CURRENT_READER_PAGE, 'Page not available.');
          return;
        }

        img.onload = function() {
          if (READER_ERROR_TIMER) { clearTimeout(READER_ERROR_TIMER); READER_ERROR_TIMER = null; }
          const ebA = document.getElementById('readerPageError');
          if (ebA) ebA.style.display = 'none';
          img.style.display = '';
          if (spinner) spinner.classList.add('hidden');
          setTimeout(() => {
            initOrResizeAnnotationCanvas();
            applyReaderZoom();
          }, 60);
        };

        img.onerror = function() {
          img.onerror = null; // Prevent infinite error loops
          // Batch 4 (B13): never fabricate a replacement page for ANY book.
          // Only a real, book-provided fallback URL may be tried; a
          // generated placeholder SVG is never an acceptable substitute.
          // Anything else gets the honest error state.
          let fallback = '';
          if (typeof book.getFallbackPageUrl === 'function') {
            fallback = book.getFallbackPageUrl(CURRENT_READER_PAGE);
          }
          if (!fallback || (typeof fallback === 'string' && fallback.indexOf('data:image/svg') === 0)) {
            showReaderPageError(img, spinner, book, CURRENT_READER_PAGE, 'Could not load this page.');
            return;
          }
          img.src = fallback;
          if (spinner) spinner.classList.add('hidden');
          setTimeout(() => {
            initOrResizeAnnotationCanvas();
            applyReaderZoom();
          }, 60);
        };

        loadReaderPageImage(img, pageUrl, function (status) {
          if (status === 401) {
            // Session tokens live 8 hours: an expired login must not
            // look like a broken book page.
            showReaderPageError(img, spinner, book, CURRENT_READER_PAGE, 'Session expired. Please log in again.');
            return;
          }
          if (status) {
            // Name the HTTP status in the error itself so a screenshot
            // of the failure carries the diagnosis (no console needed).
            showReaderPageError(img, spinner, book, CURRENT_READER_PAGE, 'Could not load this page. (HTTP ' + status + ')');
            return;
          }
          // Authenticated fetch failed: run the same honest error/fallback decision.
          if (typeof img.onerror === 'function') {
            const handler = img.onerror;
            img.onerror = null;
            handler.call(img);
          }
        });
      }
    }

    // Loads a reader page image. Storage URLs (/api/storage) require the portal's
    // Bearer <redacted>, which a plain <img> tag cannot send, so those are fetched with
    // auth and displayed via a blob URL. Data-URI pages are set directly.
    // onFetchError is invoked when the authenticated fetch fails.
    let READER_BLOB_URL = null;
    // See the teacher reader note (2026-10-29): status-less fetch
    // failures retry twice; the error box names the technical detail.
    let READER_LAST_DETAIL = '';
    let READER_LOAD_SEQ = 0;
    function loadReaderPageImage(img, pageUrl, onFetchError, attempt, seq) {
      attempt = attempt || 0;
      if (attempt === 0) {
        seq = ++READER_LOAD_SEQ;
        if (READER_BLOB_URL) {
          try { URL.revokeObjectURL(READER_BLOB_URL); } catch (e) {}
          READER_BLOB_URL = null;
        }
        READER_LAST_DETAIL = '';
      }
      if (!pageUrl || pageUrl.indexOf('data:') === 0 || pageUrl.indexOf('blob:') === 0) {
        img.src = pageUrl || '';
        return;
      }
      const headers = (typeof window.getLmsAuthHeaders === 'function') ? window.getLmsAuthHeaders() : {};
      const authVal = (headers && headers.Authorization) || '';
      fetch(pageUrl, { headers: headers })
        .then(function (res) {
          if (!res.ok) { const err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
          return res.blob();
        })
        .then(function (blob) {
          if (seq !== READER_LOAD_SEQ) return;
          READER_LAST_DETAIL = 'File received OK (' + blob.size + ' bytes, ' + (blob.type || 'unknown type') + ') but the image did not display.';
          READER_BLOB_URL = URL.createObjectURL(blob);
          img.src = READER_BLOB_URL;
        })
        .catch(function (err) {
          if (seq !== READER_LOAD_SEQ) return;
          if (err && err.status === 401 && typeof window.clearWorkerTokens === 'function') { try { window.clearWorkerTokens(); } catch (e) {} }
          if (!err || !err.status) {
            if (attempt < 2) {
              setTimeout(function () { loadReaderPageImage(img, pageUrl, onFetchError, attempt + 1, seq); }, 700);
              return;
            }
            READER_LAST_DETAIL = 'Network error after 3 attempts: ' + ((err && err.name) || 'Error') + ': ' + ((err && err.message) || '') + ' - login token: ' + (authVal ? 'present (length ' + authVal.length + ')' : 'MISSING');
          }
          if (typeof onFetchError === 'function') onFetchError(err && err.status);
          else if (spinner) spinner.classList.add('hidden');
        });
    }

    // Honest empty state for any book page that cannot be displayed
    // (Batch 4, B13: applies to every book, not only custom ones).
    // Never generates placeholder content.
    let READER_ERROR_TIMER = null;
    // Grace period: a page load that recovers within ~1.2s (loader
    // retry or the next render) must never flash the error first;
    // only a failure that is still standing after the grace shows.
    function showReaderPageError(img, spinner, book, pageNum, reason) {
      if (READER_ERROR_TIMER) clearTimeout(READER_ERROR_TIMER);
      READER_ERROR_TIMER = setTimeout(function () {
        READER_ERROR_TIMER = null;
        showReaderPageErrorNow(img, spinner, book, pageNum, reason);
      }, 1200);
    }
    function showReaderPageErrorNow(img, spinner, book, pageNum, reason) {
      if (spinner) spinner.classList.add('hidden');
      if (READER_BLOB_URL) {
        try { URL.revokeObjectURL(READER_BLOB_URL); } catch (e) {}
        READER_BLOB_URL = null;
      }
      img.removeAttribute('src');
      img.alt = '';
      img.style.display = 'none';
      let errBox = document.getElementById('readerPageError');
      if (!errBox) {
        errBox = document.createElement('div');
        errBox.id = 'readerPageError';
        errBox.style.cssText = 'padding:3rem 1.5rem;text-align:center;color:#475569;';
        img.parentNode.insertBefore(errBox, img.nextSibling);
      }
      errBox.style.display = 'block';
      errBox.innerHTML = '<div style="font-size:2.2rem;margin-bottom:.75rem;">&#9888;&#65039;</div>'
        + '<div style="font-weight:700;color:#1e293b;margin-bottom:.35rem;">' + String(reason || 'Page not available.') + '</div>'
        + '<div style="font-size:.85rem;">' + String((book && book.title) || 'Course material')
        + ' &mdash; page ' + Number(pageNum || 1) + '. Your uploaded pages are safe; please try again or contact the administrator.</div>'
        + (READER_LAST_DETAIL ? '<div style="font-size:.72rem;color:#94a3b8;margin-top:.6rem;">Technical detail: ' + READER_LAST_DETAIL + '</div>' : '');
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
      if (typeof AlHudaInteractiveQaida !== 'undefined' && AlHudaInteractiveQaida.stopSequentialAudioTour) {
        AlHudaInteractiveQaida.stopSequentialAudioTour();
      }
      CURRENT_READER_PAGE += delta;
      renderReaderCurrentPage();
    }

    function jumpToReaderPage(pageVal) {
      if (!CURRENT_READER_BOOK) return;
      if (typeof AlHudaInteractiveQaida !== 'undefined' && AlHudaInteractiveQaida.stopSequentialAudioTour) {
        AlHudaInteractiveQaida.stopSequentialAudioTour();
      }
      CURRENT_READER_PAGE = Number(pageVal) || 1;
      renderReaderCurrentPage();
    }

    let READER_IS_PANNING = false;
    let READER_PAN_START_X = 0;
    let READER_PAN_START_Y = 0;
    let READER_SCROLL_START_X = 0;
    let READER_SCROLL_START_Y = 0;
    let READER_SPACE_DOWN = false;
    // Layout-zoom base: the page image's rendered size at zoom 1 for the
    // current page (captured lazily by applyReaderZoom, reset per page).
    let READER_BASE_W = 0;
    let READER_BASE_H = 0;

    function applyReaderZoom() {
      const wrapper = document.getElementById('readerCanvasWrapper');
      const img = document.getElementById('readerPageImg');
      // Layout zoom (owner report 2026-11-05): the page is sized with real
      // width/height, never a CSS transform. A transformed element overflows
      // its scroll container in the negative direction, so the top/left of a
      // zoomed page could never be scrolled into view; with layout size the
      // stage grows and every edge of the page is reachable by scrolling.
      if (wrapper) {
        wrapper.style.transform = '';
        wrapper.style.transformOrigin = '';
        wrapper.style.transition = '';
      }
      if (img) {
        img.style.transform = 'none'; // Never scale image independently!
        // Lazy base capture: the img's current layout size equals
        // base * CURRENT_READER_ZOOM (set by the previous zoom pass, or the
        // plain CSS size at zoom 1 on a freshly loaded page).
        if (!(READER_BASE_W > 0) && img.clientWidth > 0 && CURRENT_READER_ZOOM > 0) {
          READER_BASE_W = img.clientWidth / CURRENT_READER_ZOOM;
          READER_BASE_H = img.clientHeight / CURRENT_READER_ZOOM;
        }
        if (READER_BASE_W > 0) {
          if (CURRENT_READER_ZOOM !== 1) {
            img.style.width = Math.round(READER_BASE_W * CURRENT_READER_ZOOM) + 'px';
            img.style.height = Math.round(READER_BASE_H * CURRENT_READER_ZOOM) + 'px';
            // The Tailwind caps (80vh / 100%) would clip the layout size.
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            if (wrapper) {
              wrapper.style.maxWidth = 'none';
              wrapper.style.maxHeight = 'none';
            }
          } else {
            // Back at zoom 1 the original CSS sizing takes over again.
            img.style.width = '';
            img.style.height = '';
            img.style.maxWidth = '';
            img.style.maxHeight = '';
            if (wrapper) {
              wrapper.style.maxWidth = '';
              wrapper.style.maxHeight = '';
            }
          }
        }
      }
      const lbl = document.getElementById('readerZoomLevel');
      if (lbl) lbl.innerText = `${Math.round(CURRENT_READER_ZOOM * 100)}%`;
      // Keep the annotation canvas matched to the page's new layout size.
      if (typeof initOrResizeAnnotationCanvas === 'function') {
        initOrResizeAnnotationCanvas();
      }
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
        area.scrollLeft = 0;
        area.scrollTop = 0;
      }
    }

    function fitReaderWidth() {
      const area = document.getElementById('readerContentArea');
      const img = document.getElementById('readerPageImg');
      if (!area || !img) {
        CURRENT_READER_ZOOM = 1.0;
        applyReaderZoom();
        return;
      }
      const clientW = area.clientWidth;
      const naturalW = img.naturalWidth || img.clientWidth || 600;
      if (clientW > 0 && naturalW > 0) {
        const targetZoom = (clientW - 32) / naturalW;
        CURRENT_READER_ZOOM = Math.max(0.6, Math.min(3.0, Math.round(targetZoom * 100) / 100));
      } else {
        CURRENT_READER_ZOOM = 1.0;
      }
      applyReaderZoom();
    }

    function fitReaderPage() {
      const area = document.getElementById('readerContentArea');
      const img = document.getElementById('readerPageImg');
      if (!area || !img) {
        CURRENT_READER_ZOOM = 1.0;
        applyReaderZoom();
        return;
      }
      const clientW = area.clientWidth;
      const clientH = area.clientHeight;
      const naturalW = img.naturalWidth || img.clientWidth || 600;
      const naturalH = img.naturalHeight || img.clientHeight || 860;
      if (clientW > 0 && clientH > 0 && naturalW > 0 && naturalH > 0) {
        const scaleW = (clientW - 32) / naturalW;
        const scaleH = (clientH - 32) / naturalH;
        const targetZoom = Math.min(scaleW, scaleH);
        CURRENT_READER_ZOOM = Math.max(0.6, Math.min(3.0, Math.round(targetZoom * 100) / 100));
      } else {
        CURRENT_READER_ZOOM = 1.0;
      }
      applyReaderZoom();
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

      // 1. Mouse wheel zoom (Ctrl + Wheel, Meta + Wheel, Alt + Wheel, or Trackpad Pinch)
      area.addEventListener('wheel', function(e) {
        const readerModal = document.getElementById('modalDigitalBookReader');
        if (!readerModal || readerModal.classList.contains('hidden')) return;
        if (!CURRENT_READER_BOOK || CURRENT_READER_BOOK.is_text_viewer) return;

        if (e.ctrlKey || e.metaKey || e.altKey) {
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
      if (typeof AlHudaInteractiveQaida !== 'undefined') {
        if (AlHudaInteractiveQaida.stopSequentialAudioTour) AlHudaInteractiveQaida.stopSequentialAudioTour();
        if (AlHudaInteractiveQaida.closeLetterDetailModal) AlHudaInteractiveQaida.closeLetterDetailModal();
        if (AlHudaInteractiveQaida.closeMakharijTeethReferenceModal) AlHudaInteractiveQaida.closeMakharijTeethReferenceModal();
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

    async function clearCurrentPageAnnotations() {
      const pageKey = getCurrentPageKey();
      if (!TEACHING_PAGE_MARKS[pageKey] || TEACHING_PAGE_MARKS[pageKey].length === 0) return;
      if (await lmsConfirm("Clear all marks on this page?")) {
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

      // 5. Arrow keys: zoomed in they pan the page (owner request
      // 2026-11-05); at zoom 1 Left/Right flip pages, Up/Down scroll.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const area = document.getElementById('readerContentArea');
        if (CURRENT_READER_ZOOM > 1) {
          if (area) {
            if (e.key === 'ArrowLeft') area.scrollLeft -= 90;
            else if (e.key === 'ArrowRight') area.scrollLeft += 90;
            else if (e.key === 'ArrowUp') area.scrollTop -= 90;
            else if (e.key === 'ArrowDown') area.scrollTop += 90;
          }
        } else if (e.key === 'ArrowLeft') {
          changeReaderPage(-1);
        } else if (e.key === 'ArrowRight') {
          changeReaderPage(+1);
        } else if (area) {
          area.scrollTop += (e.key === 'ArrowUp' ? -90 : 90);
        }
        return;
      }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        const area = document.getElementById('readerContentArea');
        if (area) {
          const step = Math.round(area.clientHeight * 0.9);
          area.scrollTop += (e.key === 'PageUp' ? -step : step);
        }
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
      lmsNotify(`✅ Direct Link for "${bookTitle}" Copied to Clipboard!\n\n${url}\n\nStudents or teachers can open this link to view the book directly in LMS.`);
    }

    // Custom Book Upload & Structure Handling
    let SELECTED_CUSTOM_FILES = [];

    function populateAdminParaSelect(selectId, defaultPara = 1) {
      const select = document.getElementById(selectId);
      if (!select) return;
      const paras = (typeof QURAN_PARAS_INFO !== 'undefined' && Array.isArray(QURAN_PARAS_INFO))
        ? QURAN_PARAS_INFO
        : Array.from({ length: 30 }, (_, i) => ({ para: i + 1, name_en: `Para ${i + 1}`, name_ur: `پارہ ${i + 1}` }));

      select.innerHTML = paras.map(p => `
        <option value="${p.para}">Para ${p.para}: ${p.name_en || ('Para ' + p.para)} (${p.name_ur || p.name_ar || ''})</option>
      `).join('');
      select.value = defaultPara || 1;
    }

    function onAdminUploadCategoryChanged(category) {
      const row = document.getElementById('cbDynamicQuranTafseerRow');
      const langCont = document.getElementById('cbLanguageContainer');
      const paraCont = document.getElementById('cbParaContainer');
      const paraSelect = document.getElementById('cbParaSelect');

      if (!row) return;

      if (category === 'quran') {
        row.classList.remove('hidden');
        if (langCont) langCont.classList.add('hidden');
        if (paraCont) paraCont.classList.remove('hidden');
        populateAdminParaSelect('cbParaSelect', 1);
        updateUploadFileLabels();
      } else if (category === 'tafseer') {
        row.classList.remove('hidden');
        if (langCont) langCont.classList.remove('hidden');
        if (paraCont) paraCont.classList.remove('hidden');
        populateAdminParaSelect('cbParaSelect', 1);
        updateUploadFileLabels();
      } else {
        row.classList.add('hidden');
        if (langCont) langCont.classList.add('hidden');
        if (paraCont) paraCont.classList.add('hidden');
        updateUploadFileLabels();
      }
    }

    function onAdminUploadLanguageChanged(lang) {
      updateUploadFileLabels();
    }

    function onAdminUploadParaChanged(paraNum) {
      updateUploadFileLabels();
    }

    function updateUploadFileLabels() {
      const cat = document.getElementById('cbCategory')?.value || 'qaida';
      const fileLabel = document.getElementById('cbFileLabelText');
      const fileHint = document.getElementById('cbFileSubHint');
      const paraNum = document.getElementById('cbParaSelect')?.value || 1;
      const lang = document.getElementById('cbLanguage')?.value || 'ur';
      const langLabel = lang === 'ur' ? 'Urdu' : lang === 'ar' ? 'Arabic' : 'English';
      const paraInfo = (typeof QURAN_PARAS_INFO !== 'undefined' && Array.isArray(QURAN_PARAS_INFO))
        ? (QURAN_PARAS_INFO.find(p => Number(p.para) === Number(paraNum)) || { name_en: `Para ${paraNum}` })
        : { name_en: `Para ${paraNum}` };

      if (cat === 'quran') {
        if (fileLabel) fileLabel.innerHTML = `<i class="fa-solid fa-quran text-brandEmerald"></i> Select Quran Pages for Para ${paraNum} (${paraInfo.name_ur || paraInfo.name_en}) *`;
        if (fileHint) fileHint.innerText = `All selected page images will be stored exclusively for Para ${paraNum}. Exact page order is preserved.`;
      } else if (cat === 'tafseer') {
        if (fileLabel) fileLabel.innerHTML = `<i class="fa-solid fa-book-atlas text-brandEmerald"></i> Select ${langLabel} Tafseer Pages for Para ${paraNum} *`;
        if (fileHint) fileHint.innerText = `Uploaded commentary/translation pages will be stored under ${langLabel} Tafseer for Para ${paraNum}.`;
      } else if (cat === 'qaida') {
        if (fileLabel) fileLabel.innerHTML = '<i class="fa-solid fa-book-open text-brandEmerald"></i> Select Qaida Pages (Photos / Scans) *';
        if (fileHint) fileHint.innerText = 'Upload all Takhtis/pages in sequential order.';
      } else {
        if (fileLabel) fileLabel.innerHTML = '<i class="fa-solid fa-images text-brandEmerald"></i> Select Book Pages (Photos / Scans) *';
        if (fileHint) fileHint.innerText = 'Upload all pages in sequential order.';
      }
    }

    function openCustomBookUploadModal() {
      SELECTED_CUSTOM_FILES = [];
      const fInput = document.getElementById('cbFileInput');
      if (fInput) fInput.value = '';
      const fCount = document.getElementById('cbSelectedFilesCount');
      if (fCount) {
        fCount.innerText = 'No files chosen yet. Select all pages in order.';
        fCount.className = 'text-[10px] text-slate-500 font-medium';
      }
      const catSelect = document.getElementById('cbCategory');
      if (catSelect) {
        catSelect.value = 'qaida';
        onAdminUploadCategoryChanged('qaida');
      }
      openModal('modalUploadCustomBook');
    }

    function handleCustomBookFileSelection(input) {
      SELECTED_CUSTOM_FILES = Array.from(input.files || []);
      const fCount = document.getElementById('cbSelectedFilesCount');
      if (fCount) {
        fCount.innerText = `${SELECTED_CUSTOM_FILES.length} pages selected. Auto-compression to WebP enabled.`;
        fCount.className = 'text-[10px] text-emerald-700 font-bold';
      }
    }

    async function handleSaveCustomBook(e) {
      e.preventDefault();
      const title = document.getElementById('cbTitle')?.value.trim();
      const title_ar = document.getElementById('cbTitleAr')?.value.trim() || '';
      const category = document.getElementById('cbCategory')?.value || 'qaida';
      const author = document.getElementById('cbAuthor')?.value.trim() || 'Al-Huda Academic Board';
      const description = document.getElementById('cbDescription')?.value.trim() || 'Custom Academy Course Material';
      const paraNum = Number(document.getElementById('cbParaSelect')?.value || 1);
      const language = (category === 'tafseer') ? (document.getElementById('cbLanguage')?.value || 'ur') : null;

      if (!title || SELECTED_CUSTOM_FILES.length === 0) {
        lmsNotify("Please provide a book title and select at least one page image.");
        return;
      }

      const btn = document.getElementById('btnSaveCustomBook');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Compressing &amp; Saving...';

      try {
        // Compress images client-side into WebP and upload to Cloudflare R2 (10 GB Storage)
        const compressedPages = [];
        for (let i = 0; i < SELECTED_CUSTOM_FILES.length; i++) {
          const file = SELECTED_CUSTOM_FILES[i];
          const dataUrl = await compressImageToWebP(file);
          const safePrefix = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${category === 'quran' || category === 'tafseer' ? 'p' + paraNum + '_' : ''}page_${i + 1}`;
          const r2Url = (typeof window.uploadToCloudflareR2 === 'function')
            ? await window.uploadToCloudflareR2(dataUrl, 'course_material', `${safePrefix}.webp`)
            : dataUrl;
          compressedPages.push(r2Url);
        }

        let existingCustom = getCustomBooks();

        if (category === 'quran' || category === 'tafseer') {
          // Check if custom book with same title & category (and matching language if Tafseer) already exists
          let matchedBook = existingCustom.find(b =>
            b.category === category &&
            b.title.trim().toLowerCase() === title.toLowerCase() &&
            (category !== 'tafseer' || (b.language || 'ur') === (language || 'ur'))
          );

          if (matchedBook) {
            // Update the existing book with pages for this Para
            matchedBook.paras_data = matchedBook.paras_data || {};
            matchedBook.paras_data[String(paraNum)] = compressedPages;

            // Re-index metadata paras array
            matchedBook.paras = matchedBook.paras || [];
            const existingPIdx = matchedBook.paras.findIndex(p => Number(p.para) === paraNum);
            const paraMetaObj = {
              para: paraNum,
              name_en: QURAN_PARAS_INFO[paraNum - 1]?.name_en || `Para ${paraNum}`,
              name_ur: QURAN_PARAS_INFO[paraNum - 1]?.name_ur || `پارہ ${paraNum}`,
              total_pages: compressedPages.length,
              page_start: 1,
              page_end: compressedPages.length
            };
            if (existingPIdx >= 0) matchedBook.paras[existingPIdx] = paraMetaObj;
            else matchedBook.paras.push(paraMetaObj);
            matchedBook.paras.sort((a, b) => Number(a.para) - Number(b.para));

            // Recompute running page offsets & flattened pages array
            let runningStart = 1;
            const flattened = [];
            matchedBook.paras.forEach(p => {
              const pagesInP = matchedBook.paras_data[String(p.para)] || [];
              p.page_start = runningStart;
              p.page_end = runningStart + pagesInP.length - 1;
              p.total_pages = pagesInP.length;
              runningStart += pagesInP.length;
              flattened.push(...pagesInP);
            });
            matchedBook.pages = flattened;
            matchedBook.total_pages = flattened.length;
            matchedBook.updated_at = new Date().toISOString();

            saveCustomBooksWithReport(existingCustom,
              `✅ Material "${title}" Updated!\n\nAdded/Updated Para ${paraNum} (${compressedPages.length} pages).\nTotal Pages Across All Paras: ${flattened.length}`);
          } else {
            // Create New Quran / Tafseer Material
            const customBook = {
              id: 'custom-' + Date.now(),
              title,
              title_ar,
              category,
              content_type: category,
              language: (category === 'tafseer') ? (language || 'ur') : null,
              language_label: (category === 'tafseer') ? (language === 'ur' ? 'Urdu' : language === 'ar' ? 'Arabic' : 'English') : null,
              category_label: category === 'quran' ? 'The Holy Quran' : 'Tafseer & Translation',
              author,
              edition: category === 'tafseer' ? `${language === 'ur' ? 'Urdu' : 'English'} Commentary Edition` : 'Custom Academy Edition',
              description,
              total_paras: 30,
              paras_data: {
                [String(paraNum)]: compressedPages
              },
              paras: [
                {
                  para: paraNum,
                  name_en: QURAN_PARAS_INFO[paraNum - 1]?.name_en || `Para ${paraNum}`,
                  name_ur: QURAN_PARAS_INFO[paraNum - 1]?.name_ur || `پارہ ${paraNum}`,
                  total_pages: compressedPages.length,
                  page_start: 1,
                  page_end: compressedPages.length
                }
              ],
              pages: compressedPages,
              total_pages: compressedPages.length,
              cover_icon: category === 'quran' ? 'fa-solid fa-book-quran' : 'fa-solid fa-book-atlas',
              cover_bg: category === 'quran' ? 'from-amber-900 via-stone-900 to-slate-950' : 'from-indigo-950 via-slate-900 to-slate-950',
              created_at: new Date().toISOString()
            };

            existingCustom.unshift(customBook);
            saveCustomBooksWithReport(existingCustom,
              `✅ Custom ${category === 'quran' ? 'Quran' : 'Tafseer'} "${title}" Saved Successfully!\n\nPara ${paraNum}: ${compressedPages.length} pages uploaded.\nYou can add more Paras anytime by editing this material.`);
          }
        } else {
          // Standard Page-Based Material (Qaida, Islamic Studies, Tajweed, etc.)
          const customBook = {
            id: 'custom-' + Date.now(),
            title,
            title_ar,
            category,
            content_type: category,
            category_label: category === 'qaida' ? 'Qaida & Primers' : category === 'essentials' ? 'Islamic Essentials' : category === 'hadith' ? 'Hadith Collections' : 'Islamic Studies',
            author,
            edition: 'Custom Academy Edition',
            description,
            total_pages: compressedPages.length,
            pages: compressedPages,
            cover_icon: category === 'qaida' ? 'fa-solid fa-book-open' : 'fa-solid fa-book-bookmark',
            cover_bg: 'from-slate-800 to-indigo-950',
            created_at: new Date().toISOString()
          };

          existingCustom.unshift(customBook);
          saveCustomBooksWithReport(existingCustom,
            `✅ Custom Book "${title}" Saved Successfully!\n\nTotal Pages: ${compressedPages.length}\nAdded to Course Material Library.`);
        }

        closeModal('modalUploadCustomBook');
        loadCurriculumLibrary(category);
      } catch (err) {
        console.warn('[LMS] operation failed:', err.message); lmsNotify('Error saving custom book. Please try again.', { type: 'error' });
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save &amp; Add to Library';
      }
    }

    // ============================================================
    // EDIT & MANAGE COURSE MATERIAL (CUSTOM / SYLLABUS BOOKS)
    // ============================================================
    let EDIT_BOOK_APPEND_FILES = [];

    function onAdminEditCategoryChanged(category, book = null) {
      const row = document.getElementById('editBookQuranTafseerRow');
      const langCont = document.getElementById('editBookLanguageContainer');
      const paraCont = document.getElementById('editBookParaContainer');
      const modeCont = document.getElementById('editBookUploadModeContainer');
      const paraBadge = document.getElementById('editBookParaStatusBadge');
      const appendLabel = document.getElementById('editBookAppendLabel');

      if (!row) return;

      if (category === 'quran' || category === 'tafseer') {
        row.classList.remove('hidden');
        if (category === 'tafseer') {
          if (langCont) {
            langCont.classList.remove('hidden');
            if (book && book.language) document.getElementById('editBookLanguage').value = book.language;
          }
        } else {
          if (langCont) langCont.classList.add('hidden');
        }

        if (paraCont) paraCont.classList.remove('hidden');
        if (modeCont) modeCont.classList.remove('hidden');
        if (paraBadge) paraBadge.classList.remove('hidden');

        populateAdminParaSelect('editBookParaSelect', 1);
        onAdminEditBookParaChanged(1);
      } else {
        row.classList.add('hidden');
        if (langCont) langCont.classList.add('hidden');
        if (paraCont) paraCont.classList.add('hidden');
        if (modeCont) modeCont.classList.add('hidden');
        if (paraBadge) paraBadge.classList.add('hidden');
        if (appendLabel) appendLabel.innerText = 'Append More Page Scans (Optional):';
      }
    }

    function onAdminEditBookParaChanged(paraNum) {
      const bookId = document.getElementById('editBookId')?.value;
      const allBooks = getAllAvailableBooks();
      const book = allBooks.find(b => b.id === bookId);
      const paraBadge = document.getElementById('editBookParaStatusBadge');
      const appendLabel = document.getElementById('editBookAppendLabel');
      const appendMsg = document.getElementById('editBookAppendMsg');

      const pNum = Number(paraNum) || 1;
      let count = 0;
      if (book) {
        if (book.paras_data && book.paras_data[String(pNum)]) {
          count = book.paras_data[String(pNum)].length;
        } else if (typeof getBookParaPages === 'function') {
          count = getBookParaPages(book, pNum).length;
        }
      }

      if (paraBadge) {
        paraBadge.innerText = `Para ${pNum}: ${count} Pgs`;
        paraBadge.className = count > 0
          ? 'font-mono font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded text-[10px]'
          : 'font-mono font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded text-[10px]';
      }
      if (appendLabel) {
        appendLabel.innerText = `Upload / Manage Pages for Para ${pNum}:`;
      }
      if (appendMsg) {
        appendMsg.innerText = `Selected page scans will update Para ${pNum} according to the upload mode above.`;
      }
    }

    function openEditCustomBookModal(bookId) {
      const allBooks = getAllAvailableBooks();
      const book = allBooks.find(b => b.id === bookId);
      if (!book) {
        lmsNotify("Course book not found.");
        return;
      }

      EDIT_BOOK_APPEND_FILES = [];
      const appendInput = document.getElementById('editBookAppendFiles');
      if (appendInput) appendInput.value = '';
      const appendMsg = document.getElementById('editBookAppendMsg');
      if (appendMsg) {
        appendMsg.innerText = 'Select page scans to add or update.';
        appendMsg.className = 'text-[10px] text-slate-400 mt-1';
      }

      document.getElementById('editBookId').value = book.id;
      document.getElementById('editBookTitle').value = book.title || '';
      document.getElementById('editBookTitleAr').value = book.title_ar || '';
      document.getElementById('editBookCategory').value = book.category || 'qaida';
      document.getElementById('editBookAuthor').value = book.author || '';
      document.getElementById('editBookEdition').value = book.edition || '';
      document.getElementById('editBookDescription').value = book.description || '';

      const totalP = (book.pages && book.pages.length) || book.total_pages || (book.paras ? 548 : 0);
      document.getElementById('editBookCurrentPagesCount').innerText = `${totalP} Pages Total`;

      onAdminEditCategoryChanged(book.category || 'qaida', book);

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
        appendMsg.innerText = `${EDIT_BOOK_APPEND_FILES.length} page scans selected. They will be processed upon saving.`;
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
      const isParaBased = (category === 'quran' || category === 'tafseer');
      const paraNum = Number(document.getElementById('editBookParaSelect')?.value || 1);
      const uploadMode = document.getElementById('editBookUploadMode')?.value || 'replace';
      const lang = (category === 'tafseer') ? (document.getElementById('editBookLanguage')?.value || 'ur') : null;

      if (!title) {
        lmsNotify("Please enter a book title.");
        return;
      }

      const btn = document.getElementById('btnUpdateCustomBook');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving Changes...';

      try {
        let customBooks = getCustomBooks();
        let bookIndex = customBooks.findIndex(b => b.id === bookId);

        // Compress any new uploaded pages and upload to Cloudflare R2 (10 GB Storage)
        let processedNewPages = [];
        if (EDIT_BOOK_APPEND_FILES.length > 0) {
          for (let i = 0; i < EDIT_BOOK_APPEND_FILES.length; i++) {
            const dataUrl = await compressImageToWebP(EDIT_BOOK_APPEND_FILES[i]);
            const safePrefix = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${isParaBased ? 'p' + paraNum + '_' : ''}page_${i + 1}`;
            const r2Url = (typeof window.uploadToCloudflareR2 === 'function')
              ? await window.uploadToCloudflareR2(dataUrl, 'course_material', `${safePrefix}.webp`)
              : dataUrl;
            processedNewPages.push(r2Url);
          }
        }

        const catLabel = category === 'qaida' ? 'Qaida & Primers' :
                         category === 'quran' ? 'The Holy Quran' :
                         category === 'tafseer' ? 'Tafseer & Translation' :
                         category === 'hadith' ? 'Hadith Collections' : 'Islamic Essentials';

        let targetBook = null;

        if (bookIndex >= 0) {
          targetBook = customBooks[bookIndex];
        } else {
          // Editing a standard book converts it into a customized copy
          const allBooks = getAllAvailableBooks();
          const origBook = allBooks.find(b => b.id === bookId) || {};
          targetBook = {
            ...origBook,
            id: 'custom-' + Date.now(),
            created_at: new Date().toISOString()
          };
          customBooks.unshift(targetBook);
          bookIndex = 0;

          const deletedIds = getDeletedBookIds();
          if (!deletedIds.includes(bookId)) {
            deletedIds.push(bookId);
            saveDeletedBookIds(deletedIds);
          }
        }

        targetBook.title = title;
        targetBook.title_ar = title_ar;
        targetBook.category = category;
        targetBook.content_type = category;
        targetBook.category_label = catLabel;
        targetBook.author = author;
        targetBook.edition = edition;
        targetBook.description = description;

        if (category === 'tafseer') {
          targetBook.language = lang || 'ur';
          targetBook.language_label = (lang === 'ur' ? 'Urdu' : lang === 'ar' ? 'Arabic' : 'English');
        }

        if (isParaBased) {
          targetBook.paras_data = targetBook.paras_data || {};
          if (processedNewPages.length > 0) {
            if (uploadMode === 'append') {
              targetBook.paras_data[String(paraNum)] = [...(targetBook.paras_data[String(paraNum)] || []), ...processedNewPages];
            } else {
              targetBook.paras_data[String(paraNum)] = processedNewPages;
            }
          }

          // Re-index metadata paras array
          targetBook.paras = targetBook.paras || [];
          const pIdx = targetBook.paras.findIndex(p => Number(p.para) === paraNum);
          const currentPCount = (targetBook.paras_data[String(paraNum)] || []).length;
          const paraMetaObj = {
            para: paraNum,
            name_en: QURAN_PARAS_INFO[paraNum - 1]?.name_en || `Para ${paraNum}`,
            name_ur: QURAN_PARAS_INFO[paraNum - 1]?.name_ur || `پارہ ${paraNum}`,
            total_pages: currentPCount,
            page_start: 1,
            page_end: currentPCount
          };
          if (pIdx >= 0) targetBook.paras[pIdx] = paraMetaObj;
          else if (currentPCount > 0) targetBook.paras.push(paraMetaObj);
          targetBook.paras.sort((a, b) => Number(a.para) - Number(b.para));

          // Recompute running offsets and flattened pages
          let runningOffset = 1;
          const flatList = [];
          targetBook.paras.forEach(p => {
            const pCount = (targetBook.paras_data[String(p.para)] || []).length;
            p.page_start = runningOffset;
            p.page_end = runningOffset + pCount - 1;
            p.total_pages = pCount;
            runningOffset += pCount;
            flatList.push(...(targetBook.paras_data[String(p.para)] || []));
          });
          targetBook.pages = flatList;
          targetBook.total_pages = flatList.length;
        } else {
          // Page-based (Qaida, etc.)
          if (processedNewPages.length > 0) {
            targetBook.pages = [...(targetBook.pages || []), ...processedNewPages];
            targetBook.total_pages = targetBook.pages.length;
          }
        }

        targetBook.updated_at = new Date().toISOString();
        customBooks[bookIndex] = targetBook;

        saveCustomBooksWithReport(customBooks, `✅ Course Material "${title}" updated successfully!`);
        closeModal('modalEditCustomBook');
        loadCurriculumLibrary(category);
      } catch (err) {
        console.warn('[LMS] operation failed:', err.message); lmsNotify('Error updating book. Please try again.', { type: 'error' });
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Save Changes';
      }
    }

    // ============================================================
    // COURSE MATERIAL PAGE EDITOR (custom / uploaded books only)
    // ------------------------------------------------------------
    // Staged page management for ONE book (flat) or ONE para of a
    // para-based book: add pages (at the end, or inserted before a
    // chosen page), remove pages (single, or multi-select with a
    // review confirmation), reorder (move up / down). NOTHING reaches
    // localStorage or D1 until Save Changes. The save writes the full
    // desired page state through the chunked catalog sync in its
    // hardened order (BOOK_PAGE rows first, surplus tail rows deleted
    // by key, catalog index LAST), so a failed save keeps the staged
    // changes in the editor and a retry converges.
    //
    // Lesson records store only book_id + page NUMBER, so any staged
    // change that is not a pure append at the end (a removal, an
    // insert, a reorder) first asks for an explicit confirmation:
    // shifted page numbers change which page old lesson records open.
    // ============================================================
    let PAGE_EDITOR = null;

    function pageEditorEsc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function pageEditorParaList(book) {
      const seen = new Set();
      if (book && Array.isArray(book.paras)) {
        book.paras.forEach(function (p) { if (p && p.para != null && Number(p.para)) seen.add(Number(p.para)); });
      }
      if (book && book.paras_data && typeof book.paras_data === 'object') {
        Object.keys(book.paras_data).forEach(function (k) { if (Number(k)) seen.add(Number(k)); });
      }
      return Array.from(seen).sort(function (a, b) { return a - b; });
    }

    function pageEditorIsParaBook(book) {
      if (!book) return false;
      if (pageEditorParaList(book).length === 0) return false;
      return book.category === 'quran' || book.category === 'tafseer' || !!book.paras_data
        || (Array.isArray(book.paras) && book.paras.length > 0);
    }

    // The book's real page values, in order. Hydration preserves page
    // positions with holes (empty slots) for BOOK_PAGE rows missing in
    // D1; the editor works on the real rows only, so holes are
    // compacted out of the working list. (For the one live book whose
    // index advertises more pages than it has rows, a save therefore
    // also settles its advertised total to the real count.)
    function pageEditorRealPages(pages) {
      return (Array.isArray(pages) ? pages : []).filter(function (v) { return typeof v === 'string' && v.length > 0; });
    }

    function pageEditorParaPagesOf(book, paraNum) {
      if (typeof getBookParaPages === 'function') {
        return pageEditorRealPages(getBookParaPages(book, paraNum));
      }
      return [];
    }

    // The pending original-page anchor for one para, parsed from the
    // editor state (null when the field is empty or not a number).
    function pageEditorAnchorValue(paraNum) {
      if (!PAGE_EDITOR) return null;
      const raw = PAGE_EDITOR.origStarts[String(paraNum)];
      if (raw === null || raw === undefined || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }

    function pageEditorAnchorsDirty() {
      if (!PAGE_EDITOR || !PAGE_EDITOR.isPara) return false;
      return PAGE_EDITOR.paraList.some(function (p) {
        return pageEditorAnchorValue(p) !== PAGE_EDITOR.origAnchors[String(p)];
      });
    }

    // Anchor rules (the duplicate-prevention rule for original page
    // numbers inside one book): every para's anchor must be a positive
    // whole number, and anchors must STRICTLY INCREASE from para to
    // para — a later para may never start on or before an earlier
    // para's first original page. Returns an error string naming the
    // conflicting paras, or null when the anchors are valid.
    function pageEditorValidateAnchors() {
      if (!PAGE_EDITOR || !PAGE_EDITOR.isPara) return null;
      let prev = null;
      let prevPara = null;
      for (const p of PAGE_EDITOR.paraList) {
        const raw = PAGE_EDITOR.origStarts[String(p)];
        const n = (raw === '' || raw === null || raw === undefined) ? NaN : Number(raw);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          return 'Para ' + p + ': the original page number of its first page must be a positive whole number (it is currently "' + (raw === '' || raw === null || raw === undefined ? '(empty)' : raw) + '"). No changes were saved.';
        }
        if (prev !== null && n <= prev) {
          return 'Original page numbers must increase from Para to Para: Para ' + p + ' would start at original page ' + n + ', but Para ' + prevPara + ' already starts at ' + prev + '. Two Paras cannot share or overlap original page numbers — correct the starting page of Para ' + prevPara + ' or Para ' + p + '. No changes were saved.';
        }
        prev = n;
        prevPara = p;
      }
      return null;
    }

    function pageEditorOrigStartChanged(value) {
      if (!PAGE_EDITOR || !PAGE_EDITOR.isPara) return;
      PAGE_EDITOR.origStarts[String(PAGE_EDITOR.para)] = value;
      renderPageEditor();
    }

    function openPageEditor(bookId) {
      const customBooks = getCustomBooks();
      const book = customBooks.find(function (b) { return b && b.id === bookId; });
      if (!book) {
        lmsNotify('This material has no uploaded pages to manage. The page editor is available for uploaded (custom) course materials only.', { type: 'error' });
        return false;
      }
      const isPara = pageEditorIsParaBook(book);
      const paraList = isPara ? pageEditorParaList(book) : [];
      const origParaPages = {};
      paraList.forEach(function (p) { origParaPages[String(p)] = pageEditorParaPagesOf(book, p); });
      const origFlat = pageEditorRealPages(book.pages);
      if (!isPara && origFlat.length === 0) {
        lmsNotify("This book's pages are still loading from the server. Please wait a moment and try again.", { type: 'error' });
        return false;
      }
      // Original (printed) page anchors, per para: the effective anchor
      // at open is the stored orig_start, else the para's global
      // page_start, else its running global start. origStarts holds the
      // admin's pending edits (book-level state — they survive para
      // switches; only staged PAGE edits are per-para).
      const origAnchors = {};
      let _runStart = 1;
      paraList.forEach(function (p) {
        const entry = (Array.isArray(book.paras) ? book.paras.find(function (x) { return Number(x.para) === p; }) : null);
        let a = null;
        if (entry) {
          const o = Number(entry.orig_start);
          if (Number.isFinite(o) && o > 0) a = o;
          else {
            const s = Number(entry.page_start);
            if (Number.isFinite(s) && s > 0) a = s;
          }
        }
        if (a === null) a = _runStart;
        origAnchors[String(p)] = a;
        _runStart += (origParaPages[String(p)] || []).length;
      });
      const origStarts = {};
      Object.keys(origAnchors).forEach(function (k) { origStarts[k] = origAnchors[k]; });
      PAGE_EDITOR = {
        bookId: book.id,
        title: book.title || 'Course Material',
        isPara: isPara,
        paraList: paraList,
        para: paraList.length ? paraList[0] : null,
        origParaPages: origParaPages,
        origFlat: origFlat,
        origAnchors: origAnchors,
        origStarts: origStarts,
        oldRowCount: Math.max(origFlat.length, Number(book.total_pages) || 0),
        original: [],
        staged: [],
        selected: {},
        uploadErrors: [],
        saving: false
      };
      pageEditorLoadWorkingList(PAGE_EDITOR.para);

      const titleEl = document.getElementById('pageEditorBookTitle');
      if (titleEl) titleEl.innerText = PAGE_EDITOR.title;
      const paraRow = document.getElementById('pageEditorParaRow');
      if (paraRow) paraRow.classList.toggle('hidden', !isPara);
      const paraSel = document.getElementById('pageEditorParaSelect');
      if (paraSel && isPara) {
        paraSel.innerHTML = paraList.map(function (p) {
          const meta = (Array.isArray(book.paras) ? book.paras.find(function (x) { return Number(x.para) === p; }) : null);
          const count = (origParaPages[String(p)] || []).length;
          return '<option value="' + p + '">Para ' + p + (meta && meta.name_en ? ': ' + pageEditorEsc(meta.name_en) : '') + ' (' + count + ' pages)</option>';
        }).join('');
        paraSel.value = String(PAGE_EDITOR.para);
      }
      renderPageEditor();
      openModal('modalPageEditor');
      return true;
    }

    function pageEditorLoadWorkingList(para) {
      if (!PAGE_EDITOR) return;
      const src = PAGE_EDITOR.isPara ? (PAGE_EDITOR.origParaPages[String(para)] || []) : PAGE_EDITOR.origFlat;
      PAGE_EDITOR.original = src.slice();
      PAGE_EDITOR.staged = src.map(function (v) { return { value: v, isNew: false }; });
      PAGE_EDITOR.selected = {};
    }

    function renderPageEditor() {
      if (!PAGE_EDITOR) return;
      const st = PAGE_EDITOR;
      const countEl = document.getElementById('pageEditorCount');
      if (countEl) {
        countEl.innerText = st.staged.length + ' pages' + (st.isPara ? ' in Para ' + st.para : '') + ' (was ' + st.original.length + ')';
      }
      const pendingEl = document.getElementById('pageEditorPending');
      if (pendingEl) {
        const dirty = pageEditorIsDirty();
        pendingEl.innerText = dirty ? '● Unsaved changes' : '';
        pendingEl.className = dirty ? 'font-bold text-amber-600 text-[11px]' : 'font-bold text-slate-400 text-[11px]';
      }
      const anchorInput = document.getElementById('pageEditorOrigStart');
      if (anchorInput && st.isPara) {
        const av = st.origStarts[String(st.para)];
        anchorInput.value = (av === null || av === undefined) ? '' : String(av);
      }
      const errBox = document.getElementById('pageEditorUploadErrors');
      if (errBox) {
        if (st.uploadErrors.length > 0) {
          errBox.classList.remove('hidden');
          errBox.innerHTML = '<span>⚠️ These files failed to upload and were NOT added: <b>'
            + st.uploadErrors.map(pageEditorEsc).join(', ')
            + '</b>. Saving is blocked until you dismiss this notice.</span>'
            + ' <button type="button" onclick="pageEditorDismissUploadErrors()" class="underline font-black whitespace-nowrap">Dismiss</button>';
        } else {
          errBox.classList.add('hidden');
          errBox.innerHTML = '';
        }
      }
      const listEl = document.getElementById('pageEditorList');
      if (!listEl) return;
      if (st.staged.length === 0) {
        listEl.innerHTML = '<div class="col-span-full py-8 text-center text-xs text-slate-500">No pages in this list yet. Add page scans below.</div>';
        return;
      }
      listEl.innerHTML = st.staged.map(function (entry, i) {
        const checked = st.selected[i] ? 'checked' : '';
        const upDis = i === 0 ? 'disabled' : '';
        const downDis = i === st.staged.length - 1 ? 'disabled' : '';
        // Para books label cards by the ORIGINAL (printed) page number
        // — anchor + position — with the para-relative position kept as
        // small context. Flat books keep plain sequence numbers.
        let cardLabel = 'Page ' + (i + 1);
        let cardContext = '';
        if (st.isPara) {
          const anchor = pageEditorAnchorValue(st.para);
          const base = anchor !== null ? anchor : st.origAnchors[String(st.para)];
          if (base !== null && base !== undefined && Number.isFinite(Number(base))) cardLabel = 'Page ' + (Number(base) + i);
          cardContext = '<div class="text-[10px] leading-tight text-slate-400 font-semibold">Para ' + st.para + ' &bull; page ' + (i + 1) + ' of ' + st.staged.length + '</div>';
        }
        return '<div class="border border-slate-200 rounded-xl p-2 flex flex-col gap-1.5 bg-white shadow-2xs">'
          + '<div class="relative aspect-[3/4] bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center">'
          + '<img data-editor-thumb-idx="' + i + '" alt="' + cardLabel + '" class="object-contain w-full h-full">'
          + (entry.isNew ? '<span class="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-600 text-white">NEW</span>' : '')
          + '</div>'
          + '<label class="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 cursor-pointer">'
          + '<input type="checkbox" ' + checked + ' onchange="pageEditorToggleSelect(' + i + ', this.checked)"> ' + cardLabel
          + '</label>'
          + cardContext
          + '<div class="flex items-center gap-1">'
          + '<button type="button" ' + upDis + ' onclick="pageEditorMove(' + i + ', -1)" class="flex-1 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg text-[11px] font-black" title="Move page up">↑</button>'
          + '<button type="button" ' + downDis + ' onclick="pageEditorMove(' + i + ', 1)" class="flex-1 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg text-[11px] font-black" title="Move page down">↓</button>'
          + '<button type="button" onclick="pageEditorRemoveOne(' + i + ')" class="flex-1 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-black" title="Remove this page from the list">✕</button>'
          + '</div>'
          + '</div>';
      }).join('');
      const imgs = (typeof listEl.querySelectorAll === 'function') ? listEl.querySelectorAll('img[data-editor-thumb-idx]') : [];
      Array.prototype.forEach.call(imgs, function (img) {
        const idx = Number(img.getAttribute('data-editor-thumb-idx'));
        if (st.staged[idx]) loadPageEditorThumb(img, st.staged[idx].value);
      });
    }

    // Page thumbnails: storage URLs need the portal's Bearer token,
    // which a plain img tag cannot send — same auth-fetch pattern as
    // the reader's loadReaderPageImage, minus its retry machinery.
    function loadPageEditorThumb(img, pageUrl) {
      if (!img || !pageUrl) return;
      if (pageUrl.indexOf('data:') === 0 || pageUrl.indexOf('blob:') === 0) {
        img.src = pageUrl;
        return;
      }
      if (typeof fetch !== 'function') return;
      const headers = (typeof window !== 'undefined' && typeof window.getLmsAuthHeaders === 'function') ? window.getLmsAuthHeaders() : {};
      fetch(pageUrl, { headers: headers })
        .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.blob(); })
        .then(function (blob) { img.src = URL.createObjectURL(blob); })
        .catch(function () { img.alt = 'Preview unavailable'; });
    }

    async function pageEditorSelectPara(paraNum) {
      if (!PAGE_EDITOR || !PAGE_EDITOR.isPara) return;
      const p = Number(paraNum) || PAGE_EDITOR.para;
      if (p === PAGE_EDITOR.para) return;
      if (pageEditorIsDirty()) {
        const ok = await lmsConfirm('You have unsaved changes for Para ' + PAGE_EDITOR.para + '. Switching Para will discard them. Continue?');
        if (!ok) {
          const sel = document.getElementById('pageEditorParaSelect');
          if (sel) sel.value = String(PAGE_EDITOR.para);
          return;
        }
      }
      PAGE_EDITOR.para = p;
      PAGE_EDITOR.uploadErrors = [];
      pageEditorLoadWorkingList(p);
      renderPageEditor();
    }

    function pageEditorAddFiles(input) {
      if (!PAGE_EDITOR || !input || !input.files || input.files.length === 0) return undefined;
      const modeEl = document.getElementById('pageEditorInsertMode');
      const beforeEl = document.getElementById('pageEditorInsertBefore');
      let insertAt = PAGE_EDITOR.staged.length;
      if (modeEl && modeEl.value === 'before') {
        const n = Number(beforeEl && beforeEl.value) || (PAGE_EDITOR.staged.length + 1);
        insertAt = Math.max(0, Math.min(PAGE_EDITOR.staged.length, n - 1));
      }
      const files = Array.from(input.files);
      try { input.value = ''; } catch (e) {}
      return pageEditorStageFiles(files, insertAt);
    }

    // Uploads run through the SAME pipeline as book creation:
    // compressImageToWebP (client-side WebP, which also rejects files
    // the browser cannot decode as images) then
    // window.uploadToCloudflareR2 -> POST /api/storage (server-side
    // image type check + 10 MB cap). One difference, by design: the
    // upload helper silently falls back to returning the data URI when
    // storage fails — a data-URI page would bloat D1 and every portal
    // hydrate, so the editor treats a data: return as a FAILED upload,
    // names the file, and blocks saving until the notice is dismissed.
    async function pageEditorUploadPage(file, batchIndex) {
      const dataUrl = await compressImageToWebP(file);
      if (typeof window === 'undefined' || typeof window.uploadToCloudflareR2 !== 'function') {
        throw new Error('page upload is unavailable');
      }
      const st = PAGE_EDITOR;
      const safePrefix = `${(st.title || 'book').replace(/[^a-zA-Z0-9_-]/g, '_')}_${st.isPara ? 'p' + st.para + '_' : ''}page_${(batchIndex || 0) + 1}`;
      const url = await window.uploadToCloudflareR2(dataUrl, 'course_material', `${safePrefix}.webp`);
      if (!url || String(url).indexOf('data:') === 0) {
        throw new Error('page upload failed');
      }
      return String(url);
    }

    async function pageEditorStageFiles(files, insertAt) {
      if (!PAGE_EDITOR) return false;
      const st = PAGE_EDITOR;
      const at = Math.max(0, Math.min(st.staged.length, (insertAt == null ? st.staged.length : insertAt)));
      const added = [];
      const failedNames = [];
      for (let i = 0; i < (files || []).length; i++) {
        const file = files[i];
        try {
          const url = await pageEditorUploadPage(file, i);
          added.push({ value: url, isNew: true });
        } catch (e) {
          failedNames.push((file && file.name) || ('file ' + (i + 1)));
        }
      }
      if (added.length > 0) {
        st.staged.splice.apply(st.staged, [at, 0].concat(added));
      }
      if (failedNames.length > 0) {
        st.uploadErrors = st.uploadErrors.concat(failedNames);
        lmsNotify('⚠️ These files could NOT be uploaded and were not added:\n\n' + failedNames.join('\n') + '\n\nSaving is blocked until you dismiss this notice in the page editor.', { type: 'error' });
      }
      renderPageEditor();
      return failedNames.length === 0;
    }

    function pageEditorToggleSelect(idx, checked) {
      if (!PAGE_EDITOR) return;
      if (checked) PAGE_EDITOR.selected[idx] = true;
      else delete PAGE_EDITOR.selected[idx];
    }

    function pageEditorRemoveOne(idx) {
      if (!PAGE_EDITOR) return;
      if (idx < 0 || idx >= PAGE_EDITOR.staged.length) return;
      PAGE_EDITOR.staged.splice(idx, 1);
      PAGE_EDITOR.selected = {};
      renderPageEditor();
    }

    async function pageEditorRemoveSelected() {
      if (!PAGE_EDITOR) return false;
      const st = PAGE_EDITOR;
      const idxs = Object.keys(st.selected)
        .map(Number)
        .filter(function (i) { return st.selected[i] && i >= 0 && i < st.staged.length; })
        .sort(function (a, b) { return a - b; });
      if (idxs.length === 0) {
        lmsNotify('Select at least one page first (tick its checkbox), then press Remove Selected.');
        return false;
      }
      const numbers = idxs.map(function (i) { return i + 1; });
      const ok = await lmsConfirm('Remove ' + idxs.length + ' page(s) from the list?\n\nPages: ' + numbers.join(', ') + '\n\nThis is only staged — nothing is removed from the saved book until you press Save Changes.');
      if (!ok) return false;
      idxs.sort(function (a, b) { return b - a; }).forEach(function (i) { st.staged.splice(i, 1); });
      st.selected = {};
      renderPageEditor();
      return true;
    }

    function pageEditorMove(idx, delta) {
      if (!PAGE_EDITOR) return;
      const st = PAGE_EDITOR;
      const j = idx + delta;
      if (idx < 0 || idx >= st.staged.length || j < 0 || j >= st.staged.length) return;
      const tmp = st.staged[idx];
      st.staged[idx] = st.staged[j];
      st.staged[j] = tmp;
      st.selected = {};
      renderPageEditor();
    }

    function pageEditorDismissUploadErrors() {
      if (!PAGE_EDITOR) return;
      PAGE_EDITOR.uploadErrors = [];
      renderPageEditor();
    }

    function pageEditorStagedValues() {
      return PAGE_EDITOR ? PAGE_EDITOR.staged.map(function (e) { return e.value; }) : [];
    }

    function pageEditorIsDirty() {
      if (!PAGE_EDITOR) return false;
      if (pageEditorAnchorsDirty()) return true;
      const vals = pageEditorStagedValues();
      const orig = PAGE_EDITOR.original;
      if (vals.length !== orig.length) return true;
      for (let i = 0; i < orig.length; i++) {
        if (vals[i] !== orig[i]) return true;
      }
      return false;
    }

    // Structural = anything other than a pure append at the end: the
    // staged list no longer starts with the exact original sequence.
    // Only structural changes can shift what old lesson records open.
    function pageEditorIsStructural() {
      if (!PAGE_EDITOR || !pageEditorIsDirty()) return false;
      const vals = pageEditorStagedValues();
      const orig = PAGE_EDITOR.original;
      if (vals.length < orig.length) return true;
      for (let i = 0; i < orig.length; i++) {
        if (vals[i] !== orig[i]) return true;
      }
      return false;
    }

    function pageEditorBuildUpdatedBook() {
      const st = PAGE_EDITOR;
      if (!st) return null;
      const customBooks = getCustomBooks();
      const idx = customBooks.findIndex(function (b) { return b && b.id === st.bookId; });
      if (idx < 0) return null;
      const books = customBooks.slice();
      const book = JSON.parse(JSON.stringify(customBooks[idx]));
      const stagedValues = pageEditorStagedValues();
      let newFlatLen = 0;
      if (!st.isPara) {
        book.pages = stagedValues;
        book.total_pages = stagedValues.length;
        newFlatLen = stagedValues.length;
      } else {
        const slices = {};
        st.paraList.forEach(function (p) {
          slices[String(p)] = (Number(p) === Number(st.para)) ? stagedValues : (st.origParaPages[String(p)] || []);
        });
        if (book.paras_data && typeof book.paras_data === 'object') {
          const pd = {};
          Object.keys(book.paras_data).forEach(function (k) {
            pd[k] = Array.isArray(book.paras_data[k]) ? book.paras_data[k].slice() : book.paras_data[k];
          });
          pd[String(st.para)] = stagedValues.slice();
          book.paras_data = pd;
        }
        const oldParas = Array.isArray(book.paras) ? book.paras : [];
        let running = 1;
        const flat = [];
        book.paras = st.paraList.map(function (p) {
          const old = oldParas.find(function (x) { return Number(x.para) === Number(p); }) || {};
          const slice = slices[String(p)] || [];
          const registry = (typeof QURAN_PARAS_INFO !== 'undefined' && Array.isArray(QURAN_PARAS_INFO)) ? QURAN_PARAS_INFO[Number(p) - 1] : null;
          const meta = {
            para: Number(p),
            name_en: old.name_en || (registry && registry.name_en) || ('Para ' + p),
            name_ur: old.name_ur || (registry && registry.name_ur) || '',
            page_start: running,
            page_end: running + slice.length - 1,
            total_pages: slice.length
          };
          // Original-page anchor: the admin's pending value wins; the
          // anchors are keyed by para, NOT recomputed from the new
          // page_start — inserting/removing scans shifts global
          // positions, never the printed numbers of the physical book.
          const _anchor = pageEditorAnchorValue(p);
          if (_anchor !== null && Number.isInteger(_anchor) && _anchor > 0) meta.orig_start = _anchor;
          else if (old.orig_start !== undefined && old.orig_start !== null) meta.orig_start = old.orig_start;
          running += slice.length;
          flat.push.apply(flat, slice);
          return meta;
        });
        book.pages = flat;
        book.total_pages = flat.length;
        newFlatLen = flat.length;
      }
      book.updated_at = new Date().toISOString();
      books[idx] = book;
      return { books: books, book: book, newFlatLen: newFlatLen, oldFlatLen: st.origFlat.length };
    }

    async function savePageEditor() {
      if (!PAGE_EDITOR || PAGE_EDITOR.saving) return false;
      const st = PAGE_EDITOR;
      if (st.uploadErrors.length > 0) {
        lmsNotify('⚠️ Saving is blocked: these files failed to upload and were not added:\n\n' + st.uploadErrors.join('\n') + '\n\nDismiss the notice in the page editor to save the remaining pages.', { type: 'error' });
        return false;
      }
      if (!pageEditorIsDirty()) {
        lmsNotify('No changes to save.');
        return false;
      }
      if (pageEditorAnchorsDirty()) {
        const anchorError = pageEditorValidateAnchors();
        if (anchorError) {
          lmsNotify('⚠️ Original page numbers\n\n' + anchorError, { type: 'error' });
          return false;
        }
      }
      if (pageEditorIsStructural()) {
        const ok = await lmsConfirm('⚠️ Lesson history check\n\nPast lesson records open pages by their page NUMBER. Removing pages or changing their order changes which page those old records will open.\n\nContinue and save these page changes for "' + st.title + '"?');
        if (!ok) return false;
      }
      const built = pageEditorBuildUpdatedBook();
      if (!built) {
        lmsNotify('This book could not be found in the local library copy. Please refresh the page and try again.', { type: 'error' });
        return false;
      }
      st.saving = true;
      const btn = document.getElementById('btnSavePageEditor');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      }
      try {
        const cloudOk = await _saveBookPagesScoped(built.books, st.bookId, st.origFlat,
          Math.max(built.oldFlatLen, st.oldRowCount || 0),
          function (done, total) {
            const b = document.getElementById('btnSavePageEditor');
            if (b) b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving… ' + done + '/' + total;
          });
        if (!cloudOk) {
          lmsNotify('⚠️ The page changes could NOT be saved.\n\n'
            + (_lastCatalogSyncError ? 'Server said: ' + _lastCatalogSyncError + '\n\n' : '')
            + 'Your staged changes are still in the editor — nothing was lost. Please check your connection and press Save Changes again.', { type: 'error' });
          return false;
        }
        try {
          localStorage.setItem('alhuda_custom_books', JSON.stringify(built.books));
        } catch (e) {}
        const savedTitle = st.title;
        const savedCount = built.newFlatLen;
        PAGE_EDITOR = null;
        closeModal('modalPageEditor');
        loadCurriculumLibrary(CURRENT_CURRICULUM_CATEGORY || 'all');
        lmsNotify('✅ Pages saved for "' + savedTitle + '". The book now has ' + savedCount + ' pages.');
        return true;
      } finally {
        if (PAGE_EDITOR) PAGE_EDITOR.saving = false;
        const btn2 = document.getElementById('btnSavePageEditor');
        if (btn2) {
          btn2.disabled = false;
          btn2.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
        }
      }
    }

    async function requestClosePageEditor() {
      if (PAGE_EDITOR && pageEditorIsDirty()) {
        const ok = await lmsConfirm('You have unsaved page changes. Close the editor and discard them?');
        if (!ok) return;
      }
      PAGE_EDITOR = null;
      closeModal('modalPageEditor');
    }

    // ================================================================
    // Permanent course-book deletion (2026-11-06). A deleted CUSTOM book
    // is removed from D1 *and* R2: its stored page files (via the
    // owner-only storage DELETE route), its BOOK_PAGE rows and its
    // catalog entry. Built-in books have no D1 catalog entry and no R2
    // objects, so for them the tombstone remains the whole mechanism,
    // exactly as before. The catalog removal runs LAST and acts as the
    // commit point: success is only reported once every phase has
    // confirmed, and every phase is idempotent, so retrying after a
    // partial failure is safe.
    // ================================================================
    const _bookDeleteInFlight = new Set();

    // A page value names its R2 object only when it is a storage URL
    // whose `key` parameter sits under course_material/. Data-URI and
    // placeholder values name no object and are skipped.
    function _r2KeyFromPageValue(value) {
      if (!value || typeof value !== 'string') return '';
      if (value.indexOf('data:') === 0 || value.indexOf('blob:') === 0) return '';
      try {
        const parsed = new URL(value, 'https://lms.invalid');
        const key = parsed.searchParams.get('key') || '';
        return key.indexOf('course_material/') === 0 ? key : '';
      } catch (e) {
        return '';
      }
    }

    // Collect a custom book's deletion plan: the R2 object keys its
    // pages point at — gathered from the local record (pages plus the
    // per-para arrays) AND from its D1 BOOK_PAGE rows, so pages missing
    // from the local copy are still caught — and the keys of those D1
    // rows. Each R2 key keeps one sample page URL so the delete request
    // can be addressed to the same storage origin that served the page.
    async function _collectBookDeletionPlan(bookId, book) {
      const byKey = new Map();
      const addValue = function (v) {
        const key = _r2KeyFromPageValue(v);
        if (key && !byKey.has(key)) byKey.set(key, v);
      };
      if (book) {
        (Array.isArray(book.pages) ? book.pages : []).forEach(addValue);
        if (book.paras_data && typeof book.paras_data === 'object') {
          Object.keys(book.paras_data).forEach(function (p) {
            (Array.isArray(book.paras_data[p]) ? book.paras_data[p] : []).forEach(addValue);
          });
        }
      }
      const pageRowKeys = [];
      if (typeof db !== 'undefined' && db && typeof db.from === 'function') {
        const { data: rows } = await db.from('system_settings').select('id, key, value');
        if (Array.isArray(rows)) {
          const prefix = `BOOK_PAGE_${bookId}_`;
          rows.forEach(function (r) {
            if (r && r.key && r.key.indexOf(prefix) === 0) {
              pageRowKeys.push(r.key);
              addValue(r.value);
            }
          });
        }
      }
      return { byKey: byKey, pageRowKeys: pageRowKeys };
    }

    // Delete ONE stored page file through the owner-only storage DELETE
    // route (cloudflare/worker.js admits the owner role only;
    // functions/api/storage.js enforces the course_material/ prefix).
    // Throws on any failure so the caller stops and reports honestly.
    async function _deleteStorageObject(key, sampleUrl) {
      const headers = (typeof window !== 'undefined' && typeof window.getLmsAuthHeaders === 'function') ? window.getLmsAuthHeaders() : {};
      let url = '/api/storage?key=' + encodeURIComponent(key);
      try {
        if (sampleUrl && /^https?:\/\//i.test(sampleUrl)) {
          url = new URL(sampleUrl).origin + url;
        }
      } catch (e) {}
      const res = await fetch(url, { method: 'DELETE', headers: headers });
      if (!res || !res.ok) {
        throw new Error('the storage delete failed (HTTP ' + (res ? res.status : 'no response') + ')');
      }
      let body = null;
      try { body = await res.json(); } catch (e) {}
      if (body && body.ok === false) {
        throw new Error('the storage delete was refused by the server');
      }
    }

    async function handleDeleteCurriculumBook(bookId, bookTitle) {
      if (CURRENT_ROLE === 'manager') {
        lmsNotify("Access Denied: Managers are not authorized to delete course material books. Only the System Owner can delete books.");
        return;
      }
      // In-flight guard: a second invocation (grid or modal) while this
      // book's deletion is already running is ignored. The flag is set
      // BEFORE the confirmation await — two clicks in the same moment
      // would otherwise both pass the check above while the first call
      // is still parked on the dialog.
      if (_bookDeleteInFlight.has(bookId)) return;
      _bookDeleteInFlight.add(bookId);

      const customBooks = getCustomBooks();
      const targetBook = customBooks.find(b => b.id === bookId) || null;
      const isCustomBook = !!targetBook;

      const confirmMessage = isCustomBook
        ? `Are you sure you want to PERMANENTLY delete course material "${bookTitle || 'this book'}"?\n\nThe book, all of its page records and its stored page files will be removed from the library and from storage. This cannot be undone. Lessons that referenced this book will show its page as unavailable.`
        : `Are you sure you want to delete course material "${bookTitle || 'this book'}" from the library?`;
      if (!(await lmsConfirm(confirmMessage))) {
        _bookDeleteInFlight.delete(bookId);
        return;
      }

      const modalDelBtn = document.getElementById('btnDeleteCurriculumBookModal');
      if (modalDelBtn) {
        modalDelBtn.disabled = true;
        modalDelBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
      }

      // Honest partial-failure exit for the custom-book flow: earlier
      // phases may already have removed files or records, so never claim
      // nothing happened — report the deletion as INCOMPLETE (retrying
      // is safe: every phase is idempotent) and leave the book listed.
      const incomplete = function (detail) {
        lmsNotify('⚠️ The deletion of "' + (bookTitle || 'this book') + '" is INCOMPLETE.\n\n'
          + (detail ? detail + '\n\n' : '')
          + 'Some parts may already have been removed, but the book has NOT been fully deleted and is still shown in the library. Please try again — retrying is safe.', { type: 'error' });
      };

      try {
        const filteredCustom = customBooks.filter(b => b.id !== bookId);

        if (!isCustomBook) {
          // Built-in book: no D1 catalog entry and no stored page files,
          // so the tombstone-only flow is the whole mechanism — kept
          // exactly as it behaved before this change.
          // Batch 2 (S13): if the server refuses a save, STOP and show
          // the real error — never claim the book was deleted.
          const catalogSavedBuiltIn = await _commitCatalogOnly(filteredCustom);
          if (!catalogSavedBuiltIn) {
            lmsNotify('⚠️ Could NOT delete this course material on the server.\n\n'
              + (_lastCatalogSyncError ? `Server said: ${_lastCatalogSyncError}\n\n` : '')
              + 'The book has NOT been deleted. Please try again.');
            return;
          }
          const builtInDeletedIds = getDeletedBookIds();
          if (!builtInDeletedIds.includes(bookId)) {
            builtInDeletedIds.push(bookId);
          }
          const builtInTombstoneSaved = await saveDeletedBookIds(builtInDeletedIds);
          if (!builtInTombstoneSaved) {
            lmsNotify('⚠️ Could NOT record this deletion on the server.\n\n'
              + (_lastCatalogSyncError ? `Server said: ${_lastCatalogSyncError}\n\n` : '')
              + 'The book may reappear after refresh. Please try again.');
            return;
          }
          if (typeof db !== 'undefined' && db && typeof db.from === 'function') {
            try {
              const { data: pageRows } = await db.from('system_settings').select('id, key');
              if (Array.isArray(pageRows)) {
                const prefix = `BOOK_PAGE_${bookId}_`;
                const orphaned = pageRows.filter(r => r.key && r.key.startsWith(prefix));
                for (const row of orphaned) {
                  await db.from('system_settings').delete().eq('id', row.id);
                }
              }
            } catch(e) {
              console.warn('[Curriculum] Page cleanup notice:', e);
            }
          }
        } else {
          // Custom book — permanent deletion from D1 + R2.
          // Phase 1: the stored page files (R2) and the page records
          // (D1 BOOK_PAGE rows). Nothing in this phase changes what any
          // portal lists; a failure stops before the commit point.
          let plan = null;
          try {
            plan = await _collectBookDeletionPlan(bookId, targetBook);
          } catch (e) {
            incomplete('The book\'s page list could not be read from the server.');
            return;
          }
          // Performance (2026-11-06): the two phases below used to run
          // strictly one request at a time — 549 storage deletes plus
          // 549 row deletes in sequence. Storage deletes now run in a
          // bounded pool (max 6 in flight; no new delete starts after
          // the first failure), and the page rows are removed with
          // IN-list deletes (90 keys per request — book deletion is
          // owner-only, and the engine + shim both support the `in`
          // filter; the eq-only form the manager guard requires is not
          // needed here). Failure honesty is unchanged: any failure
          // stops the flow with the same INCOMPLETE report.
          const deleteTotal = plan.byKey.size + plan.pageRowKeys.length;
          let deleteDone = 0;
          const deleteProgress = function () {
            if (modalDelBtn) {
              modalDelBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting… ' + deleteDone + '/' + deleteTotal;
            }
          };
          const storageRun = await _runBoundedPool(Array.from(plan.byKey), 6, async function (entry) {
            await _deleteStorageObject(entry[0], entry[1]);
          }, { stopOnError: true, onProgress: function () { deleteDone++; deleteProgress(); } });
          if (storageRun.failures.length > 0) {
            incomplete('A stored page file could not be removed from storage.');
            return;
          }
          deleteDone = plan.byKey.size;
          if (typeof db !== 'undefined' && db && typeof db.from === 'function') {
            const ROW_DELETE_CHUNK = 90;
            for (let i = 0; i < plan.pageRowKeys.length; i += ROW_DELETE_CHUNK) {
              const chunk = plan.pageRowKeys.slice(i, i + ROW_DELETE_CHUNK);
              const res = await db.from('system_settings').delete().in('key', chunk);
              if (res && res.error) {
                incomplete('A page record could not be removed from the database.');
                return;
              }
              deleteDone += chunk.length;
              deleteProgress();
            }
          }

          // Phase 2 (commit): tombstone first, catalog save second. The
          // tombstone stops any stale device mirror from re-uploading
          // this book later, and it makes the catalog sync below EXCLUDE
          // the book: the sync merges the cloud index back into the
          // local list, but its tombstone filter drops this id, so the
          // D1 catalog index and the legacy mirror are rewritten WITHOUT
          // the book instead of re-upserting it. (The old flow wrote the
          // tombstone only AFTER this save, which is exactly why
          // deleted books used to come back on refresh.)
          const deletedIds = getDeletedBookIds();
          if (!deletedIds.includes(bookId)) {
            deletedIds.push(bookId);
          }
          const tombstoneSaved = await saveDeletedBookIds(deletedIds);
          if (!tombstoneSaved) {
            incomplete(_lastCatalogSyncError ? `Server said: ${_lastCatalogSyncError}` : 'The deletion record could not be saved on the server.');
            return;
          }
          const catalogSaved = await _commitCatalogOnly(filteredCustom);
          if (!catalogSaved) {
            incomplete(_lastCatalogSyncError ? `Server said: ${_lastCatalogSyncError}` : 'The catalog could not be updated on the server.');
            return;
          }
        }

        lmsNotify(`🗑️ "${bookTitle || 'Course material'}" has been deleted from library across all portals.`);
        loadCurriculumLibrary(CURRENT_CURRICULUM_CATEGORY);
      } catch (err) {
        console.error('Error deleting book:', err);
        console.warn('[LMS] operation failed:', err.message); lmsNotify('Could not completely delete course material. Please try again.', { type: 'error' });
      } finally {
        _bookDeleteInFlight.delete(bookId);
        if (modalDelBtn) {
          modalDelBtn.disabled = false;
          modalDelBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete Book';
        }
      }
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
    // Para + language pass through: a Quran/Tafseer deep link without its
    // para would make the reader guess the para from a para-relative page
    // (the dashboard para-drop defect) and open the wrong page.
    (function checkUrlBookParam() {
      const params = new URLSearchParams(window.location.search);
      const bookId = params.get('book');
      const pageNum = params.get('page') || 1;
      const paraNum = params.get('para');
      const lang = params.get('lang') || params.get('language');
      if (bookId) {
        setTimeout(() => {
          openDigitalBookReader(bookId, pageNum, paraNum ? Number(paraNum) : null, lang || null);
        }, 800);
      }
    })();

    // Lesson History page links (admin): resolve a SAVED lesson through
    // the canonical resolver, then open the reader with the resolved
    // values. The admin catalog (getAllAvailableBooks) is already
    // unfiltered — allowlist + tombstone only — because admin browsing
    // has no course filter. Before resolving, re-hydrate from D1 when
    // the book's pages are missing/empty; a failed re-hydration yields
    // the honest reason below, never a fallback book or page 1. The
    // reader modal stays open over the 360 view, so returning is just
    // closing the reader — the selected student context is untouched.
    // Returns the resolution result (tests/callers inspect .ok/.reason).
    async function openAdminSavedLessonPage(bookId, page, para, language) {
      if (!window.LessonHistory) { lmsNotify('Course book not found.'); return { ok: false, reason: 'BOOK_NOT_FOUND' }; }
      const entry = { bookId: bookId || null, page: (page === null || page === undefined || page === '') ? null : Number(page), para: (para === null || para === undefined || para === '') ? null : Number(para), language: language || null, isAdditionalCourse: bookId === 'additional-course' };
      const res = await window.LessonHistory.resolveLessonPageWithRefresh(
        entry,
        () => (typeof getAllAvailableBooks === 'function' ? getAllAvailableBooks() : []),
        (typeof hydrateCustomBooksFromCloudflareD1 === 'function') ? hydrateCustomBooksFromCloudflareD1 : null
      );
      if (res.ok) {
        openDigitalBookReader(res.book.id, res.displayPage, res.para, res.language);
      } else {
        lmsNotify(window.LessonHistory.lessonPageReasonMessage(res.reason));
      }
      return res;
    }

    // Export core curriculum functions to window for cross-portal access
    if (typeof window !== 'undefined') {
      window.onAdminUploadCategoryChanged = onAdminUploadCategoryChanged;
      window.onAdminUploadLanguageChanged = onAdminUploadLanguageChanged;
      window.onAdminUploadParaChanged = onAdminUploadParaChanged;
      window.onAdminEditCategoryChanged = onAdminEditCategoryChanged;
      window.onAdminEditBookParaChanged = onAdminEditBookParaChanged;
      window.openCustomBookUploadModal = openCustomBookUploadModal;
      window.handleCustomBookFileSelection = handleCustomBookFileSelection;
      window.handleSaveCustomBook = handleSaveCustomBook;
      window.openEditCustomBookModal = openEditCustomBookModal;
      window.handleEditBookAppendFiles = handleEditBookAppendFiles;
      window.handleUpdateCustomBook = handleUpdateCustomBook;
      window.openPageEditor = openPageEditor;
      window.pageEditorSelectPara = pageEditorSelectPara;
      window.pageEditorAddFiles = pageEditorAddFiles;
      window.pageEditorToggleSelect = pageEditorToggleSelect;
      window.pageEditorRemoveOne = pageEditorRemoveOne;
      window.pageEditorRemoveSelected = pageEditorRemoveSelected;
      window.pageEditorMove = pageEditorMove;
      window.pageEditorDismissUploadErrors = pageEditorDismissUploadErrors;
      window.pageEditorOrigStartChanged = pageEditorOrigStartChanged;
      window.savePageEditor = savePageEditor;
      window.requestClosePageEditor = requestClosePageEditor;
      window.openDigitalBookReader = openDigitalBookReader;
      window.openAdminSavedLessonPage = openAdminSavedLessonPage;
      window.hydrateCustomBooksFromCloudflareD1 = hydrateCustomBooksFromCloudflareD1;
      window.renderReaderCurrentPage = renderReaderCurrentPage;
      window.loadCurriculumLibrary = loadCurriculumLibrary;
      window.filterCurriculumCategory = filterCurriculumCategory;
    }

