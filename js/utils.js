/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/utils.js
 * Purpose: Shared Modal Helpers (openModal/closeModal), Zero-Cache Enforcement & Supabase Realtime Sync
 * Extracted Line Range: 16424 – 16485 (62 lines)
 * ============================================================================
 */

    function openModal(id) {
      const m = document.getElementById(id);
      if (m) {
        m.classList.remove('hidden');
        m.classList.add('flex');
        try {
          window.history.pushState({ type: 'modal', modalId: id }, '', window.location.pathname);
        } catch (e) {}
        if (typeof updateBackBtnVisibility === 'function') updateBackBtnVisibility();
      }
    }
    function closeModal(id) {
      const m = document.getElementById(id);
      if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
        if (window.history.state && window.history.state.type === 'modal' && window.history.state.modalId === id) {
          isProgrammaticModalBack = true;
          window.history.back();
        }
        if (typeof updateBackBtnVisibility === 'function') updateBackBtnVisibility();
      }
    }

    // ============================================================
    // ZERO-CACHE ENFORCEMENT: Unregister any service workers and clear all caches
    // ============================================================
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let reg of registrations) {
          reg.unregister().then(() => {
            console.log('[PWA] Unregistered service worker:', reg.scope);
          });
        }
      });
    }
    if ('caches' in window) {
      caches.keys().then(keys => {
        for (let k of keys) {
          caches.delete(k);
          console.log('[PWA] Cleared cache:', k);
        }
      });
    }

    // Real-time Supabase Subscription for Cross-Device Updates
    try {
      if (typeof db !== 'undefined' && db && db.channel) {
        db.channel('cloud-fee-live-sync')
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'families' }, async (payload) => {
            if (payload && payload.new && payload.new.notes) {
              console.log('[Realtime Sync] Family update received from cloud:', payload.new.id);
              if (!document.activeElement || (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT')) {
                await loadFeeBillingLedger();
              }
            }
          })
          .subscribe();
      }
    } catch(e) {
      console.warn("[Realtime Sync] Subscription notice:", e);
    }
