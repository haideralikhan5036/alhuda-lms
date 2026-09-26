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

    // ============================================================================
    // GLOBAL LMS NUMBER TYPOGRAPHY & CURRENCY PRESENTATION ENGINE
    // Presentation-only helpers (preserves 100% of underlying numerical data)
    // ============================================================================
    const LMS_CURRENCY_SYMBOLS = {
      USD: '$',
      GBP: '£',
      EUR: '€',
      CAD: 'CA$',
      AUD: 'A$',
      NZD: 'NZ$',
      PKR: 'PKR ',
      AED: 'AED ',
      SAR: 'SAR ',
      QAR: 'QAR ',
      KWD: 'KWD '
    };

    function formatLmsNumber(val, decimals = 0) {
      const num = parseFloat(val);
      if (isNaN(num)) return String(val ?? '0');
      return num.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
    }

    function formatLmsCurrencyHtml(amount, currencyCode = 'USD', sizeClass = '') {
      const num = parseFloat(amount);
      const cleanCur = String(currencyCode || 'USD').trim().toUpperCase();
      const sym = LMS_CURRENCY_SYMBOLS[cleanCur] || (cleanCur + ' ');
      const formattedNum = isNaN(num)
        ? String(amount ?? '0')
        : num.toLocaleString('en-US', {
            minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
            maximumFractionDigits: 2
          });
      const isPrefixSymbol = ['$', '£', '€', 'CA$', 'A$', 'NZ$'].includes(sym);
      if (isPrefixSymbol) {
        return `<span class="lms-num-financial ${sizeClass}"><span class="lms-curr-sym">${sym}</span>${formattedNum}</span>`;
      }
      return `<span class="lms-num-financial ${sizeClass}"><span class="lms-curr-code">${cleanCur}</span> ${formattedNum}</span>`;
    }

    function enforceGlobalNumberTypographySystem() {
      let styleEl = document.getElementById('lms-global-number-design-system');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'lms-global-number-design-system';
      }
      styleEl.textContent = `
        :root {
          --font-ui: 'Inter', 'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif;
          --font-num: 'Plus Jakarta Sans', 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        /* Eliminate Courier/Monospace fallback across all elements and native OS dropdowns */
        .font-mono,
        .font-num,
        td.font-mono,
        span.font-mono,
        div.font-mono,
        button.font-mono,
        input.font-mono,
        select.font-mono {
          font-family: var(--font-num) !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'cv01' 1, 'cv02' 1, 'zero' 0 !important;
        }

        select, option, optgroup, input, textarea {
          font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
        }

        /* Tier 1: Dashboard KPI Hero Numbers */
        .lms-num-kpi,
        [id^="kpiDash"]:not([id*="Badge"]):not([id*="Box"]),
        #statFamilies, #statStudents, #statRevenue, #statSalaries, #statTrials,
        #trialsKpiActive, #trialsKpiCompleted, #trialsKpiConverted, #trialsKpiTotal,
        #payrollKpiTotal, #payrollKpiTeachers, #payrollKpiStudents, #payrollKpiDisbursed,
        #kpiLeavesActive, #kpiLeavesReturningSoon, #kpiLeavesOverdue, #kpiLeavesTotal,
        #kpiFeeTotalFamilies, #kpiFeePaidCount, #kpiFeePendingCount, #kpiFeeLeaveCount,
        #statAssignedStudents, #statTodayClasses, #statCompleted, #statRemaining {
          font-family: var(--font-num) !important;
          font-size: clamp(1.65rem, 2vw, 2.05rem) !important;
          font-weight: 700 !important;
          line-height: 1.1 !important;
          letter-spacing: -0.025em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }

        /* Tier 2: Card & Summary Bar Statistics */
        .lms-num-stat,
        #famSummaryTotalFamilies, #famSummaryActiveFamilies,
        #famSummaryTotalStudents, #famSummaryActiveStudents {
          font-family: var(--font-num) !important;
          font-size: 1.35rem !important;
          font-weight: 700 !important;
          line-height: 1.15 !important;
          letter-spacing: -0.02em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }

        /* Tier 3: Financial & Currency Numbers */
        .lms-num-financial {
          font-family: var(--font-num) !important;
          font-weight: 700 !important;
          letter-spacing: -0.015em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
          display: inline-flex;
          align-items: baseline;
          gap: 0.12em;
        }
        .lms-num-financial .lms-curr-sym {
          font-weight: 600 !important;
          opacity: 0.9;
          margin-right: 0.06em;
        }
        .lms-num-financial .lms-curr-code {
          font-size: 0.82em !important;
          font-weight: 700 !important;
          opacity: 0.85;
          margin-right: 0.18em;
          letter-spacing: 0.02em;
        }

        /* Tier 4: Percentages */
        .lms-num-percent,
        #kpiFeePaidPercent, #kpiFeePendingPercent, #kpiFeeProgressPercent {
          font-family: var(--font-num) !important;
          font-weight: 700 !important;
          letter-spacing: -0.015em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }

        /* Tier 5: Table Numbers, Time Slots & Dates */
        .lms-num-table,
        .lms-num-time,
        .lms-num-date {
          font-family: var(--font-num) !important;
          font-size: 0.875rem !important;
          font-weight: 600 !important;
          line-height: 1.35 !important;
          letter-spacing: -0.01em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }

        /* Tier 6: Readable IDs & Reference Chips */
        .lms-num-id {
          font-family: var(--font-num) !important;
          font-size: 0.78rem !important;
          font-weight: 600 !important;
          letter-spacing: 0.01em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }
      `;
      document.head.appendChild(styleEl);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        enforceGlobalNumberTypographySystem();
        setTimeout(enforceGlobalNumberTypographySystem, 400);
      });
    } else {
      enforceGlobalNumberTypographySystem();
      setTimeout(enforceGlobalNumberTypographySystem, 400);
    }

