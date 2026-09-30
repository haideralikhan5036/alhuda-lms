/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/dashboard.js
 * Purpose: Executive KPI Dashboard, Chart.js Analytics, Live Schedule Monitor & Quick Attendance
 * Extracted Line Range: 6846 – 7849 (1004 lines)
 * ============================================================================
 */

    // =========================================================================
    // CHART.JS INITIALIZATION, HOVER CALLOUTS & MONTH DRILL-DOWN ENGINE
    // =========================================================================
    const GRAPH_MONTH_LABELS = [
      'Jan-2026', 'Feb-2026', 'Mar-2026', 'Apr-2026', 'May-2026', 'Jun-2026',
      'Jul-2026', 'Aug-2026', 'Sep-2026', 'Oct-2026', 'Nov-2026', 'Dec-2026'
    ];
    let ACTIVE_HOVER_SIGNUP_MONTH_IDX = 8; // Default Sep-2026
    let ACTIVE_HOVER_FEE_MONTH_IDX = 8;    // Default Sep-2026

    // Real backend monthly data arrays (0 when no records exist — populated by updateDashboardAnalytics)
    const BASELINE_SIGNUP_DATA = {
      trial:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      regular: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      left:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    };

    const BASELINE_FEE_DATA = {
      target:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      received: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      pending:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    };

    function updateSignupsGraphCalloutBar(monthIdx) {
      if (monthIdx < 0 || monthIdx > 11) return;
      ACTIVE_HOVER_SIGNUP_MONTH_IDX = monthIdx;
      const mLabel = GRAPH_MONTH_LABELS[monthIdx];
      const tVal = DASH_STUDENT_CHART ? (DASH_STUDENT_CHART.data.datasets[0].data[monthIdx] || 0) : BASELINE_SIGNUP_DATA.trial[monthIdx];
      const rVal = DASH_STUDENT_CHART ? (DASH_STUDENT_CHART.data.datasets[1].data[monthIdx] || 0) : BASELINE_SIGNUP_DATA.regular[monthIdx];
      const lVal = DASH_STUDENT_CHART ? (DASH_STUDENT_CHART.data.datasets[2].data[monthIdx] || 0) : BASELINE_SIGNUP_DATA.left[monthIdx];

      const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
      setTxt('lblCalloutTrialMonth', mLabel);
      setTxt('valCalloutTrial', tVal);
      setTxt('lblCalloutRegularMonth', mLabel);
      setTxt('valCalloutRegular', rVal);
      setTxt('lblCalloutLeftMonth', mLabel);
      setTxt('valCalloutLeft', lVal);
    }

    function updateFeeGraphCalloutBar(monthIdx) {
      if (monthIdx < 0 || monthIdx > 11) return;
      ACTIVE_HOVER_FEE_MONTH_IDX = monthIdx;
      const mLabel = GRAPH_MONTH_LABELS[monthIdx];
      const tgtVal = DASH_REVENUE_CHART ? (DASH_REVENUE_CHART.data.datasets[0].data[monthIdx] || 0) : BASELINE_FEE_DATA.target[monthIdx];
      const recVal = DASH_REVENUE_CHART ? (DASH_REVENUE_CHART.data.datasets[1].data[monthIdx] || 0) : BASELINE_FEE_DATA.received[monthIdx];
      const pndVal = DASH_REVENUE_CHART ? (DASH_REVENUE_CHART.data.datasets[2].data[monthIdx] || 0) : BASELINE_FEE_DATA.pending[monthIdx];

      const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
      setTxt('lblCalloutFeeTargetMonth', mLabel);
      setTxt('valCalloutFeeTarget', '$' + Number(tgtVal).toLocaleString());
      setTxt('lblCalloutFeePaidMonth', mLabel);
      setTxt('valCalloutFeePaid', '$' + Number(recVal).toLocaleString());
      setTxt('lblCalloutFeePendingMonth', mLabel);
      setTxt('valCalloutFeePending', '$' + Number(pndVal).toLocaleString());
    }

    let _dashGraphEntranceAnimatingUntil = 0;

    function playDashboardGraphsEntranceAnimation() {
      if (typeof Chart === 'undefined') return;
      _dashGraphEntranceAnimatingUntil = Date.now() + 2200;

      if (DASH_STUDENT_CHART) {
        try { DASH_STUDENT_CHART.destroy(); } catch (e) {}
        DASH_STUDENT_CHART = null;
      }
      if (DASH_REVENUE_CHART) {
        try { DASH_REVENUE_CHART.destroy(); } catch (e) {}
        DASH_REVENUE_CHART = null;
      }
      initDashboardCharts();
    }

    let _lastTappedMobileChartMonth = { signups: -1, fees: -1 };

    function dismissMobileChartTooltip() {
      const tooltipEl = document.getElementById('lmsModernChartTooltip');
      if (tooltipEl) {
        tooltipEl.style.opacity = '0';
        tooltipEl.style.pointerEvents = 'none';
      }
      _lastTappedMobileChartMonth = { signups: -1, fees: -1 };
    }

    // Dismiss mobile chart tooltip when tapping outside chart canvases
    if (typeof document !== 'undefined' && !window._lmsMobileChartDismissBound) {
      window._lmsMobileChartDismissBound = true;
      document.addEventListener('touchstart', (e) => {
        if (window.innerWidth >= 768) return;
        const t = e.target;
        if (!t) return;
        if (t.closest && (t.closest('#chartStudentGrowth') || t.closest('#chartFeeRevenue') || t.closest('#lmsModernChartTooltip'))) {
          return;
        }
        dismissMobileChartTooltip();
      }, { passive: true });
    }

    function renderModernChartExternalTooltip(context, chartKind) {
      const { chart, tooltip } = context;
      let tooltipEl = document.getElementById('lmsModernChartTooltip');
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'lmsModernChartTooltip';
        tooltipEl.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;opacity:0;transition:opacity 0.15s ease, transform 0.15s cubic-bezier(0.16,1,0.3,1);transform:translate(-50%, -105%);';
        document.body.appendChild(tooltipEl);
      }

      if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints || tooltip.dataPoints.length === 0) {
        tooltipEl.style.opacity = '0';
        tooltipEl.style.pointerEvents = 'none';
        return;
      }

      const isMobile = window.innerWidth < 768;
      const primaryPt = tooltip.dataPoints[0];
      const mIdx = primaryPt.dataIndex;
      const dsIdx = primaryPt.datasetIndex;
      const mLabel = GRAPH_MONTH_LABELS[mIdx] || 'Current';
      const shortMonthTitle = mLabel.replace('-', ' ');
      const prevMLabel = mIdx > 0 ? GRAPH_MONTH_LABELS[mIdx - 1] : 'Prior Period';
      const isFeeChart = chartKind === 'fees';

      // =========================================================================
      // COMPACT, TOUCH-FRIENDLY MOBILE TOOLTIP (< 768px)
      // Stays strictly inside viewport, never covers bars, shows essential values
      // =========================================================================
      if (isMobile) {
        const fmtCompact = (v) => {
          const n = Number(v || 0);
          if (!isFeeChart) return n.toLocaleString();
          return n >= 1000 ? '$' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k' : '$' + n.toLocaleString();
        };

        const shortLabels = isFeeChart ? ['Target', 'Paid', 'Pending'] : ['Trial', 'Regular', 'Left'];
        const defaultDrillCat = isFeeChart ? 'fee_paid' : 'regular';

        const seriesPillsHtml = chart.data.datasets.map((series, idx) => {
          const val = Number(series.data[mIdx] || 0);
          const dotColor = series.borderColor || '#059669';
          const isSelected = idx === dsIdx;
          return `
            <div class="flex flex-col items-center justify-center px-2 py-1 rounded-lg ${isSelected ? 'bg-slate-100 ring-1 ring-slate-300/80' : 'bg-slate-50/80'}">
              <span class="flex items-center gap-1 text-[10px] font-semibold text-slate-500 leading-none">
                <span style="background:${dotColor}" class="w-2 h-2 rounded-full inline-block shrink-0"></span>
                ${shortLabels[idx] || series.label}
              </span>
              <span class="lms-num-table font-extrabold text-slate-900 text-xs mt-1 leading-none">${fmtCompact(val)}</span>
            </div>
          `;
        }).join('');

        tooltipEl.style.pointerEvents = 'auto';
        tooltipEl.innerHTML = `
          <div class="bg-white/98 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg px-3 py-2.5 w-[224px] max-w-[calc(100vw-20px)] text-slate-800">
            <div class="flex items-center justify-between gap-1.5 pb-1.5 mb-1.5 border-b border-slate-100">
              <span class="px-2 py-0.5 rounded bg-slate-900 text-white lms-num-id text-[11px] font-bold">${shortMonthTitle}</span>
              <div class="flex items-center gap-1">
                <button type="button" onclick="openGraphMonthDrilldownModal(${mIdx}, '${defaultDrillCat}'); dismissMobileChartTooltip();" class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10.5px] font-extrabold flex items-center gap-1 active:scale-95">
                  Details <i class="fa-solid fa-arrow-right text-[9px]"></i>
                </button>
                <button type="button" onclick="dismissMobileChartTooltip()" class="w-5 h-5 rounded text-slate-400 hover:text-slate-700 flex items-center justify-center text-xs">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>
            <div class="grid grid-cols-3 gap-1.5">
              ${seriesPillsHtml}
            </div>
          </div>
        `;

        const rect = chart.canvas.getBoundingClientRect();
        const cardW = 224;
        let left = rect.left + tooltip.caretX;
        if (left - cardW / 2 < 10) left = cardW / 2 + 10;
        if (left + cardW / 2 > window.innerWidth - 10) left = window.innerWidth - cardW / 2 - 10;

        // Anchor cleanly near the top of the chart canvas so bars remain visible
        let top = Math.max(12, rect.top - 8);
        tooltipEl.style.transform = 'translate(-50%, -85%)';
        if (top < 70) {
          top = rect.top + 4;
          tooltipEl.style.transform = 'translate(-50%, 0%)';
        }

        tooltipEl.style.left = `${left}px`;
        tooltipEl.style.top = `${top}px`;
        tooltipEl.style.opacity = '1';
        return;
      }

      // =========================================================================
      // DESKTOP FULL ANALYTICAL HOVER TOOLTIP (>= 768px) — UNCHANGED
      // =========================================================================
      tooltipEl.style.pointerEvents = 'none';
      const ds = chart.data.datasets[dsIdx] || chart.data.datasets[0];
      const currentVal = Number(ds.data[mIdx] || 0);
      const prevVal = mIdx > 0 ? Number(ds.data[mIdx - 1] || 0) : Number(ds.data[0] || 0);
      const diffVal = currentVal - prevVal;
      const pctChange = prevVal > 0 ? ((diffVal / prevVal) * 100).toFixed(1) : '0.0';

      const fmtVal = (v) => isFeeChart ? '$' + Number(v).toLocaleString() : Number(v).toLocaleString();
      const fmtDiff = (d) => {
        const sign = d > 0 ? '+' : (d < 0 ? '-' : '');
        const absV = Math.abs(d);
        return sign + (isFeeChart ? '$' + absV.toLocaleString() : absV.toLocaleString());
      };

      const isPositiveMeaning = (ds.label || '').toLowerCase().includes('left') || (ds.label || '').toLowerCase().includes('pending')
        ? diffVal <= 0
        : diffVal >= 0;

      const changeBadgeClass = diffVal === 0
        ? 'bg-slate-100 text-slate-700 border-slate-200'
        : isPositiveMeaning
        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
        : 'bg-rose-50 text-rose-800 border-rose-200';

      const changeIcon = diffVal > 0 ? 'fa-arrow-trend-up' : (diffVal < 0 ? 'fa-arrow-trend-down' : 'fa-minus');

      const allSeriesHtml = chart.data.datasets.map((series, idx) => {
        const val = Number(series.data[mIdx] || 0);
        const dotColor = series.borderColor || '#059669';
        const isHovered = idx === dsIdx;
        return `
          <div class="flex items-center justify-between py-1.5 px-2.5 rounded-lg ${isHovered ? 'bg-slate-100 font-bold text-slate-950' : 'text-slate-600'}">
            <span class="flex items-center gap-2 text-xs">
              <span style="background:${dotColor}" class="w-2.5 h-2.5 rounded-xs inline-block shrink-0"></span>
              <span>${series.label.replace(' ($)', '')}</span>
            </span>
            <span class="lms-num-table font-bold text-slate-900 text-[13.5px]">${fmtVal(val)}</span>
          </div>
        `;
      }).join('');

      let extraRatioHtml = '';
      if (isFeeChart) {
        const tgt = Number(chart.data.datasets[0]?.data[mIdx] || 0);
        const rec = Number(chart.data.datasets[1]?.data[mIdx] || 0);
        const ratio = tgt > 0 ? Math.min(100, Math.round((rec / tgt) * 100)) : 0;
        extraRatioHtml = `
          <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <span class="text-slate-500 font-semibold">Collection Ratio</span>
            <span class="lms-num-percent font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">${ratio}% Collected</span>
          </div>
        `;
      } else {
        const tr = Number(chart.data.datasets[0]?.data[mIdx] || 0);
        const reg = Number(chart.data.datasets[1]?.data[mIdx] || 0);
        const convRatio = tr > 0 ? Math.min(100, Math.round((reg / tr) * 100)) : 0;
        extraRatioHtml = `
          <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <span class="text-slate-500 font-semibold">Regular vs Trial Ratio</span>
            <span class="lms-num-percent font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200">${convRatio}%</span>
          </div>
        `;
      }

      tooltipEl.innerHTML = `
        <div class="bg-white/98 backdrop-blur-md rounded-2xl border border-slate-200/95 shadow-2xl p-4 w-[295px] text-slate-800">
          <!-- Top Header: Category & Period -->
          <div class="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-slate-100">
            <div class="flex items-center gap-2 min-w-0">
              <span style="background:${ds.borderColor || '#059669'}" class="w-3 h-3 rounded-md shrink-0 shadow-2xs"></span>
              <span class="text-xs font-extrabold text-slate-900 truncate">${ds.label.replace(' ($)', '')}</span>
            </div>
            <span class="px-2.5 py-0.5 rounded-md bg-slate-900 text-white lms-num-id text-xs font-bold shrink-0">${mLabel}</span>
          </div>

          <!-- Separated Current vs Previous vs Change Grid -->
          <div class="grid grid-cols-2 gap-2.5 mb-2.5">
            <div class="bg-slate-50 rounded-xl p-2.5 border border-slate-200/80">
              <span class="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 block">Current (${mLabel.slice(0, 3)})</span>
              <span class="lms-num-stat text-xl font-bold text-slate-950 mt-1 block">${fmtVal(currentVal)}</span>
            </div>
            <div class="bg-slate-50 rounded-xl p-2.5 border border-slate-200/80">
              <span class="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 block">Previous (${prevMLabel.slice(0, 3)})</span>
              <span class="lms-num-stat text-xl font-bold text-slate-600 mt-1 block">${fmtVal(prevVal)}</span>
            </div>
          </div>

          <!-- Period Change Pill Row -->
          <div class="flex items-center justify-between px-3 py-2 rounded-xl border ${changeBadgeClass} mb-3">
            <span class="text-[11px] font-bold uppercase tracking-wider">Change</span>
            <span class="lms-num-table text-sm font-bold flex items-center gap-1.5">
              <i class="fa-solid ${changeIcon} text-xs"></i>
              <span>${fmtDiff(diffVal)}</span>
              <span class="px-1.5 py-0.2 rounded bg-white/80 text-[11px] font-bold">(${diffVal >= 0 ? '+' : ''}${pctChange}%)</span>
            </span>
          </div>

          <!-- All Series in Month -->
          <div class="space-y-0.5 border-t border-slate-100 pt-2">
            ${allSeriesHtml}
          </div>

          ${extraRatioHtml}

          <!-- Drilldown Hint -->
          <div class="mt-2.5 pt-2 border-t border-slate-100 text-[11px] font-bold text-indigo-600 flex items-center justify-between">
            <span>Click bar to inspect details</span>
            <i class="fa-solid fa-arrow-right text-[10px]"></i>
          </div>
        </div>
      `;

      const rect = chart.canvas.getBoundingClientRect();
      let left = rect.left + tooltip.caretX;
      let top = rect.top + tooltip.caretY - 12;

      const cardW = 295;
      const cardH = 330;
      if (left - cardW / 2 < 12) left = cardW / 2 + 12;
      if (left + cardW / 2 > window.innerWidth - 12) left = window.innerWidth - cardW / 2 - 12;

      if (top - cardH < 12) {
        tooltipEl.style.transform = 'translate(-50%, 16px)';
      } else {
        tooltipEl.style.transform = 'translate(-50%, -104%)';
      }

      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `${top}px`;
      tooltipEl.style.opacity = '1';
    }

    // Custom Chart.js Plugin: Render clean tabular numbers above bars (Desktop Only — Disabled on Mobile to eliminate clutter)
    const lmsBarValueLabelsPlugin = {
      id: 'lmsBarValueLabels',
      afterDatasetsDraw(chart) {
        if (window.innerWidth < 768) return; // Keep Mobile graphs 100% clean & uncluttered
        const { ctx } = chart;
        const isRevenue = chart.canvas?.id === 'chartFeeRevenue';
        ctx.save();
        ctx.font = "600 11px 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        chart.data.datasets.forEach((dataset, dsIndex) => {
          const meta = chart.getDatasetMeta(dsIndex);
          if (meta.hidden) return;
          meta.data.forEach((bar, index) => {
            const rawVal = Number(dataset.data[index] || 0);
            if (rawVal <= 0) return;
            let labelText = '';
            if (isRevenue) {
              labelText = rawVal >= 1000 ? '$' + (rawVal / 1000).toFixed(rawVal % 1000 === 0 ? 0 : 1) + 'k' : '$' + rawVal;
            } else {
              labelText = String(rawVal);
            }
            ctx.fillStyle = dataset.borderColor || '#334155';
            ctx.fillText(labelText, bar.x, bar.y - 3);
          });
        });
        ctx.restore();
      }
    };

    function initDashboardCharts() {
      if (typeof Chart === 'undefined') return;
      Chart.defaults.font.family = "'Plus Jakarta Sans', 'Inter', 'Segoe UI', system-ui, sans-serif";

      const isMobile = window.innerWidth < 768;

      // 1. GRAPH 1 (TOP FULL-WIDTH): NEW SIGN-UPS REPORT (Refined Violet-Indigo / Emerald-Teal / Coral-Rose)
      const ctxGrowth = document.getElementById('chartStudentGrowth')?.getContext('2d');
      if (ctxGrowth && !DASH_STUDENT_CHART) {
        _dashGraphEntranceAnimatingUntil = Date.now() + (isMobile ? 600 : 2200);
        DASH_STUDENT_CHART = new Chart(ctxGrowth, {
          type: 'bar',
          plugins: [lmsBarValueLabelsPlugin],
          data: {
            labels: GRAPH_MONTH_LABELS,
            datasets: [
              {
                label: isMobile ? 'Trial' : 'Scheduled Trial',
                data: [...BASELINE_SIGNUP_DATA.trial],
                backgroundColor: 'rgba(99, 102, 241, 0.84)',
                hoverBackgroundColor: '#4f46e5',
                borderColor: '#4f46e5',
                borderWidth: isMobile ? 1 : 1.5,
                borderRadius: isMobile ? 3 : 6,
                barPercentage: isMobile ? 0.86 : 0.78,
                categoryPercentage: isMobile ? 0.80 : 0.72
              },
              {
                label: isMobile ? 'Regular' : 'Regular Enrolled',
                data: [...BASELINE_SIGNUP_DATA.regular],
                backgroundColor: 'rgba(13, 148, 136, 0.85)',
                hoverBackgroundColor: '#0f766e',
                borderColor: '#0d9488',
                borderWidth: isMobile ? 1 : 1.5,
                borderRadius: isMobile ? 3 : 6,
                barPercentage: isMobile ? 0.86 : 0.78,
                categoryPercentage: isMobile ? 0.80 : 0.72
              },
              {
                label: isMobile ? 'Left' : 'Left / Discontinued',
                data: [...BASELINE_SIGNUP_DATA.left],
                backgroundColor: 'rgba(244, 63, 94, 0.80)',
                hoverBackgroundColor: '#e11d48',
                borderColor: '#e11d48',
                borderWidth: isMobile ? 1 : 1.5,
                borderRadius: isMobile ? 3 : 6,
                barPercentage: isMobile ? 0.86 : 0.78,
                categoryPercentage: isMobile ? 0.80 : 0.72
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
              duration: isMobile ? 500 : 1350,
              easing: 'easeOutQuart',
              delay: (context) => {
                if (isMobile) return 0;
                if (context.type === 'data' && context.mode === 'default') {
                  return context.dataIndex * 45 + context.datasetIndex * 85;
                }
                return 0;
              }
            },
            animations: {
              y: {
                from: (ctx) => {
                  if (ctx.type === 'data' && ctx.mode === 'default' && ctx.chart?.scales?.y) {
                    return ctx.chart.scales.y.getPixelForValue(0);
                  }
                },
                duration: isMobile ? 500 : 1350,
                easing: 'easeOutQuart'
              }
            },
            interaction: { mode: isMobile ? 'index' : 'nearest', axis: 'x', intersect: false },
            onHover: (event, elements) => {
              if (elements && elements.length > 0) {
                const mIdx = elements[0].index;
                updateSignupsGraphCalloutBar(mIdx);
              }
              if (event?.native?.target) {
                event.native.target.style.cursor = (elements && elements.length > 0) ? 'pointer' : 'default';
              }
            },
            onClick: (event, elements) => {
              if (!elements || elements.length === 0) return;
              const directPoints = DASH_STUDENT_CHART.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
              const targetPoint = (directPoints && directPoints.length > 0) ? directPoints[0] : elements[0];
              const mIdx = targetPoint.index;
              const dsIdx = targetPoint.datasetIndex;
              const catMap = ['trial', 'regular', 'left'];
              if (window.innerWidth < 768) {
                // On Mobile: first tap reveals the compact tooltip & highlights month; second tap on same month opens drilldown
                if (_lastTappedMobileChartMonth.signups === mIdx) {
                  _lastTappedMobileChartMonth.signups = -1;
                  dismissMobileChartTooltip();
                  openGraphMonthDrilldownModal(mIdx, catMap[dsIdx] || 'regular');
                } else {
                  _lastTappedMobileChartMonth.signups = mIdx;
                  updateSignupsGraphCalloutBar(mIdx);
                }
                return;
              }
              openGraphMonthDrilldownModal(mIdx, catMap[dsIdx] || 'regular');
            },
            plugins: {
              legend: {
                position: 'top',
                align: isMobile ? 'center' : 'end',
                labels: {
                  boxWidth: isMobile ? 8 : 14,
                  boxHeight: isMobile ? 8 : 14,
                  padding: isMobile ? 10 : 16,
                  usePointStyle: true,
                  pointStyle: 'rectRounded',
                  font: { size: isMobile ? 11 : 12.5, family: "'Plus Jakarta Sans', 'Inter', sans-serif", weight: '700' }
                }
              },
              tooltip: {
                enabled: false,
                external: (ctx) => renderModernChartExternalTooltip(ctx, 'signups')
              }
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: {
                  maxRotation: 0,
                  minRotation: 0,
                  autoSkip: true,
                  maxTicksLimit: isMobile ? 6 : 12,
                  callback: function(value, index) {
                    const rawLabel = this.getLabelForValue ? this.getLabelForValue(value) : (GRAPH_MONTH_LABELS[index] || '');
                    return window.innerWidth < 768 ? String(rawLabel).split('-')[0] : rawLabel;
                  },
                  font: { size: isMobile ? 10.5 : 12.5, family: "'Plus Jakarta Sans', 'Inter', sans-serif", weight: '600' },
                  color: '#475569'
                }
              },
              y: {
                beginAtZero: true,
                grace: isMobile ? '8%' : '15%',
                grid: { color: '#f1f5f9', borderDash: [3, 3], drawBorder: false },
                ticks: {
                  maxTicksLimit: isMobile ? 4 : 7,
                  font: { size: isMobile ? 10.5 : 12.5, family: "'Plus Jakarta Sans', 'Inter', sans-serif", weight: '600' },
                  color: '#64748b'
                }
              }
            }
          }
        });
        updateSignupsGraphCalloutBar(ACTIVE_HOVER_SIGNUP_MONTH_IDX);
      }

      // 2. GRAPH 2 (BOTTOM FULL-WIDTH): MONTHLY FEE PAYMENTS REPORT (Professional Financial Color System)
      const ctxRevenue = document.getElementById('chartFeeRevenue')?.getContext('2d');
      if (ctxRevenue && !DASH_REVENUE_CHART) {
        DASH_REVENUE_CHART = new Chart(ctxRevenue, {
          type: 'bar',
          plugins: [lmsBarValueLabelsPlugin],
          data: {
            labels: GRAPH_MONTH_LABELS,
            datasets: [
              {
                label: isMobile ? 'Target' : 'Target Fee ($)',
                data: [...BASELINE_FEE_DATA.target],
                backgroundColor: 'rgba(37, 99, 235, 0.82)',
                hoverBackgroundColor: '#1d4ed8',
                borderColor: '#2563eb',
                borderWidth: isMobile ? 1 : 1.5,
                borderRadius: isMobile ? 3 : 6,
                barPercentage: isMobile ? 0.86 : 0.78,
                categoryPercentage: isMobile ? 0.80 : 0.72
              },
              {
                label: isMobile ? 'Received' : 'Fee Received ($)',
                data: [...BASELINE_FEE_DATA.received],
                backgroundColor: 'rgba(16, 185, 129, 0.86)',
                hoverBackgroundColor: '#059669',
                borderColor: '#059669',
                borderWidth: isMobile ? 1 : 1.5,
                borderRadius: isMobile ? 3 : 6,
                barPercentage: isMobile ? 0.86 : 0.78,
                categoryPercentage: isMobile ? 0.80 : 0.72
              },
              {
                label: isMobile ? 'Pending' : 'Pending Fee ($)',
                data: [...BASELINE_FEE_DATA.pending],
                backgroundColor: 'rgba(245, 158, 11, 0.86)',
                hoverBackgroundColor: '#d97706',
                borderColor: '#d97706',
                borderWidth: isMobile ? 1 : 1.5,
                borderRadius: isMobile ? 3 : 6,
                barPercentage: isMobile ? 0.86 : 0.78,
                categoryPercentage: isMobile ? 0.80 : 0.72
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
              duration: isMobile ? 500 : 1350,
              easing: 'easeOutQuart',
              delay: (context) => {
                if (isMobile) return 0;
                if (context.type === 'data' && context.mode === 'default') {
                  return context.dataIndex * 45 + context.datasetIndex * 85;
                }
                return 0;
              }
            },
            animations: {
              y: {
                from: (ctx) => {
                  if (ctx.type === 'data' && ctx.mode === 'default' && ctx.chart?.scales?.y) {
                    return ctx.chart.scales.y.getPixelForValue(0);
                  }
                },
                duration: isMobile ? 500 : 1350,
                easing: 'easeOutQuart'
              }
            },
            interaction: { mode: isMobile ? 'index' : 'nearest', axis: 'x', intersect: false },
            onHover: (event, elements) => {
              if (elements && elements.length > 0) {
                const mIdx = elements[0].index;
                updateFeeGraphCalloutBar(mIdx);
              }
              if (event?.native?.target) {
                event.native.target.style.cursor = (elements && elements.length > 0) ? 'pointer' : 'default';
              }
            },
            onClick: (event, elements) => {
              if (!elements || elements.length === 0) return;
              const directPoints = DASH_REVENUE_CHART.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
              const targetPoint = (directPoints && directPoints.length > 0) ? directPoints[0] : elements[0];
              const mIdx = targetPoint.index;
              const dsIdx = targetPoint.datasetIndex;
              const catMap = ['fee_target', 'fee_paid', 'fee_pending'];
              if (window.innerWidth < 768) {
                if (_lastTappedMobileChartMonth.fees === mIdx) {
                  _lastTappedMobileChartMonth.fees = -1;
                  dismissMobileChartTooltip();
                  openGraphMonthDrilldownModal(mIdx, catMap[dsIdx] || 'fee_paid');
                } else {
                  _lastTappedMobileChartMonth.fees = mIdx;
                  updateFeeGraphCalloutBar(mIdx);
                }
                return;
              }
              openGraphMonthDrilldownModal(mIdx, catMap[dsIdx] || 'fee_paid');
            },
            plugins: {
              legend: {
                position: 'top',
                align: isMobile ? 'center' : 'end',
                labels: {
                  boxWidth: isMobile ? 8 : 14,
                  boxHeight: isMobile ? 8 : 14,
                  padding: isMobile ? 10 : 16,
                  usePointStyle: true,
                  pointStyle: 'rectRounded',
                  font: { size: isMobile ? 11 : 12.5, family: "'Plus Jakarta Sans', 'Inter', sans-serif", weight: '700' }
                }
              },
              tooltip: {
                enabled: false,
                external: (ctx) => renderModernChartExternalTooltip(ctx, 'fees')
              }
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: {
                  maxRotation: 0,
                  minRotation: 0,
                  autoSkip: true,
                  maxTicksLimit: isMobile ? 6 : 12,
                  callback: function(value, index) {
                    const rawLabel = this.getLabelForValue ? this.getLabelForValue(value) : (GRAPH_MONTH_LABELS[index] || '');
                    return window.innerWidth < 768 ? String(rawLabel).split('-')[0] : rawLabel;
                  },
                  font: { size: isMobile ? 10.5 : 12.5, family: "'Plus Jakarta Sans', 'Inter', sans-serif", weight: '600' },
                  color: '#475569'
                }
              },
              y: {
                beginAtZero: true,
                grace: isMobile ? '8%' : '15%',
                grid: { color: '#f1f5f9', borderDash: [3, 3], drawBorder: false },
                ticks: {
                  maxTicksLimit: isMobile ? 4 : 7,
                  callback: function(v) {
                    const num = Number(v || 0);
                    if (window.innerWidth < 768 && num >= 1000) {
                      return '$' + (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'k';
                    }
                    return '$' + num.toLocaleString();
                  },
                  font: { size: isMobile ? 10.5 : 12.5, family: "'Plus Jakarta Sans', 'Inter', sans-serif", weight: '600' },
                  color: '#64748b'
                }
              }
            }
          }
        });
        updateFeeGraphCalloutBar(ACTIVE_HOVER_FEE_MONTH_IDX);
      }
    }

    // Automatically re-adapt chart layout if viewport crosses between Mobile (< 768px) and Desktop (>= 768px)
    let _lastChartViewportIsMobile = typeof window !== 'undefined' ? (window.innerWidth < 768) : false;
    if (typeof window !== 'undefined' && !window._lmsChartResizeWatcherBound) {
      window._lmsChartResizeWatcherBound = true;
      window.addEventListener('resize', () => {
        const nowMobile = window.innerWidth < 768;
        if (nowMobile !== _lastChartViewportIsMobile) {
          _lastChartViewportIsMobile = nowMobile;
          dismissMobileChartTooltip();
          if (DASH_STUDENT_CHART) {
            try { DASH_STUDENT_CHART.destroy(); } catch (e) {}
            DASH_STUDENT_CHART = null;
          }
          if (DASH_REVENUE_CHART) {
            try { DASH_REVENUE_CHART.destroy(); } catch (e) {}
            DASH_REVENUE_CHART = null;
          }
          initDashboardCharts();
          if (typeof updateDashboardAnalytics === 'function') {
            updateDashboardAnalytics();
          }
        }
      });
    }

    async function updateDashboardAnalytics() {
      try {
        let students = ALL_STUDENTS;
        let families = ALL_FAMILIES;
        let teachers = ALL_TEACHERS;

        if (typeof ensureCoreLmsDataLoaded === 'function') {
          const core = await ensureCoreLmsDataLoaded();
          students = core.students || [];
          families = core.families || [];
          teachers = core.teachers || [];
        } else {
          const [sRes, fRes, tRes] = await Promise.all([
            db.from('students').select('*'),
            db.from('families').select('*'),
            db.from('teachers').select('*')
          ]);
          students = sRes.data || [];
          families = fRes.data || [];
          teachers = tRes.data || [];
          if (students.length > 0) ALL_STUDENTS = students;
          if (families.length > 0) ALL_FAMILIES = families;
          if (teachers.length > 0) ALL_TEACHERS = teachers;
        }

        const currentMonthIdx = new Date().getMonth();

        // Reset arrays to 0 before computing real backend metrics
        for (let m = 0; m < 12; m++) {
          BASELINE_SIGNUP_DATA.trial[m] = 0;
          BASELINE_SIGNUP_DATA.regular[m] = 0;
          BASELINE_SIGNUP_DATA.left[m] = 0;
          BASELINE_FEE_DATA.target[m] = 0;
          BASELINE_FEE_DATA.received[m] = 0;
          BASELINE_FEE_DATA.pending[m] = 0;
        }

        const extractMonthIdx = (dateStr, fallbackIdx) => {
          if (!dateStr) return fallbackIdx;
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) return d.getMonth();
          return fallbackIdx;
        };

        // 1. Real Trials per Month
        const trialsList = Array.isArray(window.ALL_TRIALS) ? window.ALL_TRIALS : [];
        trialsList.forEach(tr => {
          const mIdx = extractMonthIdx(tr.created_at || tr.trial_date || tr.date, currentMonthIdx);
          if (mIdx >= 0 && mIdx < 12) BASELINE_SIGNUP_DATA.trial[mIdx]++;
        });

        // 2. Real Regular & Left Students per Month
        (students || []).forEach(s => {
          let pNotes = {};
          try { if (s.notes) pNotes = typeof s.notes === 'string' ? JSON.parse(s.notes) : s.notes; } catch (e) {}
          const statusLower = String(s.status || 'Active').toLowerCase();
          const isLeft = statusLower === 'left' || statusLower === 'inactive' || statusLower === 'deactivated';
          const isTrialOnly = statusLower === 'trial' && !pNotes.converted_from_trial;

          if (isTrialOnly && trialsList.length === 0) {
            const mIdx = extractMonthIdx(s.joining_date || pNotes.joining_date || s.created_at, currentMonthIdx);
            if (mIdx >= 0 && mIdx < 12) BASELINE_SIGNUP_DATA.trial[mIdx]++;
          } else if (isLeft) {
            const deactDate = s.deactivation_date || pNotes.deactivation_date || pNotes.left_date || s.updated_at || s.created_at;
            const mIdx = extractMonthIdx(deactDate, currentMonthIdx);
            if (mIdx >= 0 && mIdx < 12) BASELINE_SIGNUP_DATA.left[mIdx]++;
          } else {
            const joinDate = s.joining_date || pNotes.joining_date || s.created_at;
            const mIdx = extractMonthIdx(joinDate, currentMonthIdx);
            if (mIdx >= 0 && mIdx < 12) BASELINE_SIGNUP_DATA.regular[mIdx]++;
          }
        });

        // 3. Real Fee Target, Received, and Pending per Month
        let totalAgreedFee = 0;
        let currentMonthReceived = 0;
        (families || []).forEach(f => {
          const st = String(f.status || 'Active').toLowerCase();
          if (st === 'inactive' || st === 'deactivated' || st === 'left') return;
          const feeAmt = Number(f.monthly_fee) || 0;
          totalAgreedFee += feeAmt;
          let fNotes = {};
          try { if (f.notes) fNotes = typeof f.notes === 'string' ? JSON.parse(f.notes) : f.notes; } catch (e) {}
          if (Array.isArray(fNotes.fee_history)) {
            fNotes.fee_history.forEach(fh => {
              const mIdx = extractMonthIdx(fh.date, currentMonthIdx);
              if (mIdx >= 0 && mIdx < 12) {
                BASELINE_FEE_DATA.received[mIdx] += Number(fh.amountPaid || fh.amount || 0);
              }
            });
          } else if (String(f.fee_status || '').toLowerCase() === 'paid') {
            currentMonthReceived += feeAmt;
          }
        });

        if (Array.isArray(window.ALL_FEE_COLLECTIONS) && window.ALL_FEE_COLLECTIONS.length > 0) {
          window.ALL_FEE_COLLECTIONS.forEach(fc => {
            const mIdx = extractMonthIdx(fc.payment_date || fc.created_at, currentMonthIdx);
            if (mIdx >= 0 && mIdx < 12) {
              BASELINE_FEE_DATA.received[mIdx] += Number(fc.amount_paid || fc.amount || 0);
            }
          });
        } else if (BASELINE_FEE_DATA.received[currentMonthIdx] === 0 && currentMonthReceived > 0) {
          BASELINE_FEE_DATA.received[currentMonthIdx] = currentMonthReceived;
        }

        if (totalAgreedFee > 0) {
          BASELINE_FEE_DATA.target[currentMonthIdx] = totalAgreedFee;
          BASELINE_FEE_DATA.pending[currentMonthIdx] = Math.max(0, totalAgreedFee - BASELINE_FEE_DATA.received[currentMonthIdx]);
        }

        const isEntranceAnimating = Date.now() < _dashGraphEntranceAnimatingUntil;

        if (DASH_STUDENT_CHART) {
          DASH_STUDENT_CHART.data.datasets[0].data = [...BASELINE_SIGNUP_DATA.trial];
          DASH_STUDENT_CHART.data.datasets[1].data = [...BASELINE_SIGNUP_DATA.regular];
          DASH_STUDENT_CHART.data.datasets[2].data = [...BASELINE_SIGNUP_DATA.left];
          if (!isEntranceAnimating) {
            DASH_STUDENT_CHART.update('none');
          }
          updateSignupsGraphCalloutBar(ACTIVE_HOVER_SIGNUP_MONTH_IDX);
        }

        if (DASH_REVENUE_CHART) {
          DASH_REVENUE_CHART.data.datasets[0].data = [...BASELINE_FEE_DATA.target];
          DASH_REVENUE_CHART.data.datasets[1].data = [...BASELINE_FEE_DATA.received];
          DASH_REVENUE_CHART.data.datasets[2].data = [...BASELINE_FEE_DATA.pending];
          if (!isEntranceAnimating) {
            DASH_REVENUE_CHART.update('none');
          }
          updateFeeGraphCalloutBar(ACTIVE_HOVER_FEE_MONTH_IDX);
        }

        if (typeof syncTopCircleNotificationDots === 'function') {
          syncTopCircleNotificationDots();
        }
      } catch (err) {
        console.warn("Analytics update notice:", err);
      }
    }

    // Live Active Families & Active Students Real-time Metrics Engine
    async function updateLiveActiveMetrics() {
      try {
        let fams = ALL_FAMILIES;
        let stus = ALL_STUDENTS;

        if (typeof ensureCoreLmsDataLoaded === 'function') {
          const core = await ensureCoreLmsDataLoaded();
          fams = core.families || [];
          stus = core.students || [];
        } else {
          const [fRes, sRes] = await Promise.all([
            db.from('families').select('id, status, notes, parent_name, whatsapp'),
            db.from('students').select('id, family_id, status, notes, name')
          ]);
          fams = fRes.data || [];
          stus = sRes.data || [];
        }

        const normalizePhone = (p) => String(p || '').replace(/[^0-9]/g, '').slice(-10);
        const normalizeName = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

        const seenFamKeys = new Set();
        const activeFamIds = new Set();
        const activeFams = (fams || []).filter(f => {
          if (typeof isRegularFamilyRecord === 'function' && !isRegularFamilyRecord(f)) return false;
          if (typeof isFamilyDeactivated === 'function' && isFamilyDeactivated(f)) return false;
          const s = (f.status || 'Active').toLowerCase();
          if (s !== 'active' && s !== 'regular') return false;
          const key = normalizePhone(f.whatsapp) || normalizeName(f.parent_name) || f.id;
          if (seenFamKeys.has(key)) return false;
          seenFamKeys.add(key);
          activeFamIds.add(String(f.id || '').toUpperCase());
          return true;
        });

        const famById = {};
        (fams || []).forEach(f => { if (f && f.id) famById[String(f.id).toUpperCase()] = f; });

        const activeStus = (stus || []).filter(s => {
          if (typeof isRegularStudentRecord === 'function' && !isRegularStudentRecord(s)) return false;
          const st = (s.status || 'Active').toLowerCase();
          if (st === 'leave' || st === 'inactive' || st === 'deactivated' || st === 'deleted' || st === 'trial' || st === 'converted') {
            return false;
          }
          const parentFam = famById[String(s.family_id || '').toUpperCase()];
          if (parentFam && (typeof isFamilyDeactivated === 'function' ? isFamilyDeactivated(parentFam) : ['inactive', 'deactivated'].includes(String(parentFam.status || '').toLowerCase()))) {
            return false;
          }
          return true;
        });

        const famCount = activeFams.length;
        const stuCount = activeStus.length;

        ['dashLiveActiveFamilies', 'famSummaryActiveFamilies', 'sidebarActiveFamilies'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerText = famCount;
        });
        ['dashLiveActiveStudents', 'famSummaryActiveStudents', 'sidebarActiveStudents'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerText = stuCount;
        });
        if (typeof syncAllFamilyAndStudentCountersUI === 'function') {
          syncAllFamilyAndStudentCountersUI(fams, stus);
        }
      } catch(e) {
        console.warn("Could not calculate active registry metrics:", e);
      }
    }

    function updateExecutiveDashboardFeeWidget() {
      try {
        const now = new Date();
        const curMonthName = (typeof FEE_CONFIG !== 'undefined' && FEE_CONFIG.MONTHS) ? (FEE_CONFIG.MONTHS[now.getMonth()] || "September") : "September";
        const curYear = now.getFullYear();

        const badge = document.getElementById('dashFeeWidgetPeriodBadge');
        if (badge) badge.innerText = `${curMonthName} ${curYear}`;

        const records = typeof getStoredFeeRecords === 'function' ? getStoredFeeRecords() : [];
        const families = (typeof CACHED_FEE_FAMILIES !== 'undefined' && CACHED_FEE_FAMILIES && CACHED_FEE_FAMILIES.length > 0)
          ? CACHED_FEE_FAMILIES
          : (ALL_FAMILIES || []);

        let paidCount = 0;
        let onLeaveCount = 0;

        const paidMap = {};
        records.forEach(r => {
          if (String(r.month).toLowerCase() === curMonthName.toLowerCase() && parseInt(r.year, 10) === curYear) {
            if (parseFloat(r.remainingBalance || 0) <= 0) {
              paidMap[String(r.familyId).toUpperCase()] = true;
            }
          }
        });
        paidCount = Object.keys(paidMap).length;

        families.forEach(fam => {
          if (typeof checkFamilyLeaveInMonth === 'function') {
            const lCheck = checkFamilyLeaveInMonth(fam.id, curMonthName, curYear);
            if (lCheck.isLeave) onLeaveCount++;
          }
        });

        const pendingCount = Math.max(0, families.length - paidCount - onLeaveCount);

        const elPaid = document.getElementById('dashFeeWidgetPaidCount');
        if (elPaid) elPaid.innerText = paidCount;
        const elPending = document.getElementById('dashFeeWidgetPendingCount');
        if (elPending) elPending.innerText = pendingCount;
        const elLeave = document.getElementById('dashFeeWidgetLeaveCount');
        if (elLeave) elLeave.innerText = onLeaveCount;
      } catch (e) {
        console.warn("Could not update dashboard fee widget:", e);
      }
    }

    async function loadDashboardData() {
      initDashboardCharts();
      updateDashboardAnalytics();
      updateLiveActiveMetrics();
      updateExecutiveDashboardFeeWidget();

      const now = new Date();
      const currentDay = now.getDay() === 0 ? 7 : now.getDay();
      const todayDate = now.toISOString().slice(0, 10);

      const dateLabel = document.getElementById('dashTodayDateLabel');
      if (dateLabel) {
        dateLabel.innerText = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      }

      // Execute schedule & attendance queries in 1 parallel Promise.all
      const hasCachedSchedules = Array.isArray(window.ALL_CLASS_SCHEDULES) && window.ALL_CLASS_SCHEDULES.length > 0;
      const [schedRes, logsRes, advRes] = await Promise.all([
        hasCachedSchedules
          ? Promise.resolve({ data: window.ALL_CLASS_SCHEDULES.filter(sc => Number(sc.day_of_week) === Number(currentDay)) })
          : db.from('class_schedules').select('*, students(*), teachers(*)').eq('day_of_week', currentDay),
        db.from('attendance_logs').select('*').eq('date', todayDate),
        db.from('attendance_logs').select('*').eq('status', 'Advance Class')
      ]);

      const scheds = schedRes.data || [];
      const logs = logsRes.data || [];
      const logsMap = {};
      (logs || []).forEach(l => logsMap[l.schedule_id] = l);

      let advCoverMap = {};
      try {
        const allAdv = advRes.data || [];
        if (allAdv.length > 0) {
          allAdv.forEach(al => {
            try {
              const meta = JSON.parse(al.lesson_notes);
              if (meta && meta.advance_target_date === todayDate) {
                advCoverMap[al.schedule_id] = { log: al, meta };
                if (al.student_id) advCoverMap['student_' + al.student_id] = { log: al, meta };
              }
            } catch(e){}
          });
        }
      } catch(e){}

      let currentMinutes = now.getHours() * 60 + now.getMinutes();

      let totalToday = 0;
      let liveCount = 0;
      let waitingCount = 0;
      let completedCount = 0;
      let remainingCount = 0;
      let absentCount = 0;
      let leaveCount = 0;
      let trialCount = 0;

      DASHBOARD_CLASSES = (scheds || []).map(s => {
        totalToday++;
        const log = logsMap[s.id];
        const [sH, sM] = s.start_time.split(':').map(Number);
        const [eH, eM] = s.end_time.split(':').map(Number);
        const startMin = sH * 60 + sM;
        const endMin = eH * 60 + eM;

        const isLive = currentMinutes >= startMin && currentMinutes < endMin;
        const isPast = currentMinutes >= endMin;
        const isUpcoming = currentMinutes < startMin;

        let isTrial = s.status === 'Trial' || s.is_trial === true || s.students?.status === 'Trial' || (s.students?.notes && s.students.notes.toLowerCase().includes('trial'));
        if (isTrial) trialCount++;

        let isLeaveStudent = s.students?.status === 'Leave';
        let leaveMeta = null;
        if (s.students?.notes) {
          try {
            const p = JSON.parse(s.students.notes);
            if (p && p.on_leave) {
              isLeaveStudent = true;
              leaveMeta = p;
            }
          } catch(e) {}
        }

        const isCurrentSlot = isLive && !isLeaveStudent;
        const isRunningMarked = isLive && Boolean(log && (log.status === 'Present' || log.status === 'Running'));

        let status = 'Remaining';
        let badgeClass = 'bg-amber-100 text-amber-900 border-amber-400 font-bold';
        let filterCategory = 'remaining';

        if (log) {
          if (log.status === 'Waiting') {
            waitingCount++;
            status = '⏳ Teacher Waiting';
            filterCategory = 'waiting';
            badgeClass = 'bg-amber-100 text-amber-900 border-amber-400 font-extrabold animate-pulse';
          } else if (log.status === 'Present' || log.status === 'Running') {
            completedCount++;
            status = isLive ? 'Running' : 'Taken';
            filterCategory = 'completed';
            badgeClass = isLive
              ? 'bg-emerald-100 text-emerald-900 border-emerald-400 font-extrabold animate-pulse'
              : 'bg-teal-100 text-teal-900 border-teal-400 font-extrabold';
          } else if (log.status === 'Advance Class') {
            completedCount++;
            let advTarget = '';
            try {
              const parsed = JSON.parse(log.lesson_notes);
              if (parsed?.advance_target_date) advTarget = ` (For: ${parsed.advance_target_date})`;
            } catch(e) {}
            status = `Taken (Advance${advTarget})`;
            filterCategory = 'completed';
            badgeClass = 'bg-teal-100 text-teal-900 border-teal-400 font-extrabold';
          } else if (log.status === 'Absent') {
            absentCount++;
            status = 'Absent';
            filterCategory = 'absent';
            badgeClass = 'bg-rose-100 text-rose-900 border-rose-400 font-extrabold';
          } else if (log.status === 'Leave') {
            leaveCount++;
            status = 'Leave';
            filterCategory = 'leave';
            badgeClass = 'bg-blue-100 text-blue-900 border-blue-400 font-extrabold';
          }
        } else if (advCoverMap[s.id] || advCoverMap['student_' + s.student_id]) {
          completedCount++;
          const cov = advCoverMap[s.id] || advCoverMap['student_' + s.student_id];
          status = `Taken (Pre-Covered ${cov.log.date})`;
          filterCategory = 'completed';
          badgeClass = 'bg-teal-100 text-teal-900 border-teal-400 font-extrabold';
        } else {
          if (isLeaveStudent) {
            leaveCount++;
            const returnInfo = leaveMeta?.return_date ? ` (Returns: ${leaveMeta.return_date.slice(5)})` : '';
            status = `Leave${returnInfo}`;
            filterCategory = 'leave';
            badgeClass = 'bg-blue-100 text-blue-900 border-blue-400 font-extrabold';
          } else if (isLive) {
            liveCount++;
            status = 'Current Class';
            filterCategory = 'current';
            badgeClass = 'bg-cyan-100 text-cyan-900 border-cyan-400 font-extrabold animate-pulse';
          } else if (isPast) {
            status = 'Remaining (Pending Mark)';
            filterCategory = 'remaining';
            badgeClass = 'bg-amber-100 text-amber-900 border-amber-400 font-bold';
          } else {
            remainingCount++;
            status = 'Remaining';
            filterCategory = 'remaining';
            badgeClass = 'bg-amber-100 text-amber-900 border-amber-400 font-bold';
          }
        }

        return {
          ...s,
          log,
          startMin,
          endMin,
          isLive,
          isCurrentSlot,
          isRunningMarked,
          isPast,
          isUpcoming,
          isTrial,
          isLeaveStudent,
          status,
          badgeClass,
          filterCategory
        };
      });

      DASHBOARD_CLASSES.sort((a, b) => a.startMin - b.startMin);

      const currentSlotTotal = DASHBOARD_CLASSES.filter(c => c.isCurrentSlot).length;
      const runningMarkedTotal = DASHBOARD_CLASSES.filter(c => c.isRunningMarked).length;

      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
      setEl('kpiDashTotal', totalToday);
      setEl('kpiDashCurrent', currentSlotTotal);
      setEl('kpiDashRunning', runningMarkedTotal);
      setEl('kpiDashLive', currentSlotTotal);
      const wBadge = document.getElementById('kpiDashWaitingBadge');
      if (wBadge) {
        if (waitingCount > 0) {
          wBadge.innerText = `${waitingCount} Waiting`;
          wBadge.classList.remove('hidden');
        } else {
          wBadge.classList.add('hidden');
        }
      }
      setEl('kpiDashCompleted', completedCount);
      setEl('kpiDashRemaining', remainingCount);
      setEl('kpiDashAbsent', absentCount);
      setEl('kpiDashLeave', leaveCount);
      setEl('kpiDashTrial', trialCount);

      // Also set legacy KPIs if element exists
      setEl('kpiTotalToday', totalToday);
      setEl('kpiLiveNow', currentSlotTotal);
      setEl('kpiCompleted', completedCount);
      setEl('kpiRemaining', remainingCount);
      setEl('kpiAbsent', absentCount);
      setEl('kpiOnLeave', leaveCount);

      if (CURRENT_DASH_FILTER) {
        renderDashboardClassesTable();
      }

      // Check scheduled leave returns and pending teacher requests
      await checkLeaveReturnAlertsAndRequests();
    }

    const loadLiveMonitorData = loadDashboardData;

    function filterDashboardClasses(filterType) {
      if (CURRENT_DASH_FILTER === filterType) {
        closeDashboardClassesView();
        return;
      }
      CURRENT_DASH_FILTER = filterType;

      document.querySelectorAll('.kpi-dash-card').forEach(box => {
        box.classList.remove('ring-2', 'ring-brandDark', 'ring-offset-2', 'scale-105', 'scale-[1.02]', 'shadow-md', 'ring-4', 'ring-white', 'shadow-xl');
      });

      const selectedBox = document.getElementById(`kpiBox-${filterType}`);
      if (selectedBox) {
        selectedBox.classList.add('ring-2', 'ring-brandDark', 'ring-offset-2', 'scale-[1.02]', 'shadow-md');
      }

      const classesSection = document.getElementById('dashClassesSection');
      if (classesSection) {
        classesSection.classList.remove('hidden');
      }

      const titleMap = {
        'all': {
          text: 'Total Scheduled Classes Today',
          subtitle: 'Full schedule roster across morning, afternoon & evening shifts',
          icon: 'fa-calendar-day',
          headerBg: 'bg-slate-100/90 border-slate-300',
          sectionBorder: 'border-slate-400',
          iconBg: 'bg-slate-700 text-white',
          badgeBg: 'bg-slate-200 text-slate-900 border-slate-400'
        },
        'current': {
          text: 'Current Classes (Active Time Slot)',
          subtitle: 'All classes scheduled in the active 30-minute time slot right now',
          icon: 'fa-clock',
          headerBg: 'bg-cyan-50/95 border-cyan-200',
          sectionBorder: 'border-cyan-400',
          iconBg: 'bg-cyan-600 text-white',
          badgeBg: 'bg-cyan-100 text-cyan-900 border-cyan-300'
        },
        'running': {
          text: 'Running Classes (Teacher Present)',
          subtitle: 'Ongoing classes in the current slot where the teacher has marked attendance',
          icon: 'fa-tower-broadcast',
          headerBg: 'bg-emerald-50/95 border-emerald-200',
          sectionBorder: 'border-emerald-400',
          iconBg: 'bg-emerald-600 text-white',
          badgeBg: 'bg-emerald-100 text-emerald-900 border-emerald-300'
        },
        'completed': {
          text: 'Taken Classes Today',
          subtitle: 'Sessions marked Present / Taken since 12:00 AM midnight',
          icon: 'fa-circle-check',
          headerBg: 'bg-teal-50/95 border-teal-200',
          sectionBorder: 'border-teal-400',
          iconBg: 'bg-teal-600 text-white',
          badgeBg: 'bg-teal-100 text-teal-900 border-teal-300'
        },
        'remaining': {
          text: 'Remaining Classes Today',
          subtitle: 'Upcoming classes scheduled to take place before midnight',
          icon: 'fa-hourglass-half',
          headerBg: 'bg-amber-50/95 border-amber-200',
          sectionBorder: 'border-amber-400',
          iconBg: 'bg-amber-600 text-white',
          badgeBg: 'bg-amber-100 text-amber-900 border-amber-300'
        },
        'absent': {
          text: 'Absent Sessions Today',
          subtitle: 'Students marked Absent for their scheduled sessions today',
          icon: 'fa-user-xmark',
          headerBg: 'bg-rose-50/95 border-rose-200',
          sectionBorder: 'border-rose-400',
          iconBg: 'bg-rose-600 text-white',
          badgeBg: 'bg-rose-100 text-rose-900 border-rose-300'
        },
        'leave': {
          text: 'Student Leaves Today',
          subtitle: 'Students on approved leave for sessions today',
          icon: 'fa-calendar-xmark',
          headerBg: 'bg-blue-50/95 border-blue-200',
          sectionBorder: 'border-blue-400',
          iconBg: 'bg-blue-600 text-white',
          badgeBg: 'bg-blue-100 text-blue-900 border-blue-300'
        },
        'trial': {
          text: 'Trial Classes Today',
          subtitle: 'Trial and evaluation lessons scheduled for today',
          icon: 'fa-graduation-cap',
          headerBg: 'bg-purple-50/95 border-purple-200',
          sectionBorder: 'border-purple-400',
          iconBg: 'bg-purple-600 text-white',
          badgeBg: 'bg-purple-100 text-purple-900 border-purple-300'
        }
      };

      const meta = titleMap[filterType] || titleMap['all'];
      const titleEl = document.getElementById('dashFilterTitle');
      if (titleEl) titleEl.innerText = meta.text;
      const subEl = document.getElementById('dashFilterSubtitle');
      if (subEl) subEl.innerText = meta.subtitle;
      const iconContainer = document.getElementById('dashFilterIcon');
      if (iconContainer) {
        iconContainer.className = `w-9 h-9 rounded-xl ${meta.iconBg} flex items-center justify-center text-sm shadow-xs`;
        iconContainer.innerHTML = `<i class="fa-solid ${meta.icon}"></i>`;
      }
      const headerToolbar = document.getElementById('dashClassesHeaderToolbar');
      if (headerToolbar) {
        headerToolbar.className = `p-4 border-b flex justify-between items-center flex-wrap gap-3 transition-colors ${meta.headerBg}`;
      }
      if (classesSection) {
        classesSection.className = `mb-6 bg-white rounded-2xl border-2 ${meta.sectionBorder} shadow-sm overflow-hidden transition-all duration-300`;
      }
      const countBadge = document.getElementById('dashFilterCountBadge');
      if (countBadge) {
        countBadge.className = `px-2.5 py-0.5 ${meta.badgeBg} rounded-full font-extrabold text-xs font-mono border`;
      }

      renderDashboardClassesTable();

      setTimeout(() => {
        classesSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        DASH_STUDENT_CHART?.resize();
        DASH_REVENUE_CHART?.resize();
      }, 50);
    }

    function closeDashboardClassesView() {
      CURRENT_DASH_FILTER = null;
      document.querySelectorAll('.kpi-dash-card').forEach(box => {
        box.classList.remove('ring-2', 'ring-brandDark', 'ring-offset-2', 'scale-105', 'scale-[1.02]', 'scale-[1.01]', 'shadow-md', 'ring-4', 'ring-white', 'shadow-xl');
      });
      const classesSection = document.getElementById('dashClassesSection');
      if (classesSection) {
        classesSection.classList.add('hidden');
      }
      setTimeout(() => {
        DASH_STUDENT_CHART?.resize();
        DASH_REVENUE_CHART?.resize();
      }, 50);
    }

    function renderDashboardClassesTable(searchQuery = '') {
      const tbody = document.getElementById('dashClassesTableBody');
      const emptyState = document.getElementById('dashEmptyState');
      const countBadge = document.getElementById('dashFilterCountBadge');
      if (!tbody) return;

      const query = (searchQuery || (document.getElementById('dashClassSearch')?.value || '')).trim().toLowerCase();

      let filtered = DASHBOARD_CLASSES.filter(c => {
        if (CURRENT_DASH_FILTER === 'all') {
          // all
        } else if (CURRENT_DASH_FILTER === 'current' || CURRENT_DASH_FILTER === 'live') {
          if (!c.isCurrentSlot) return false;
        } else if (CURRENT_DASH_FILTER === 'running') {
          if (!c.isRunningMarked) return false;
        } else if (CURRENT_DASH_FILTER === 'waiting') {
          if (c.filterCategory !== 'waiting') return false;
        } else if (CURRENT_DASH_FILTER === 'completed') {
          if (c.filterCategory !== 'completed') return false;
        } else if (CURRENT_DASH_FILTER === 'remaining') {
          if (c.filterCategory !== 'remaining' && !c.isUpcoming) return false;
        } else if (CURRENT_DASH_FILTER === 'absent') {
          if (c.filterCategory !== 'absent') return false;
        } else if (CURRENT_DASH_FILTER === 'leave') {
          if (c.filterCategory !== 'leave') return false;
        } else if (CURRENT_DASH_FILTER === 'trial') {
          if (!c.isTrial) return false;
        }

        if (query) {
          const studentName = (c.students?.name || '').toLowerCase();
          const studentId = (c.students?.id || '').toLowerCase();
          const teacherName = (c.teachers?.full_name || '').toLowerCase();
          const courseName = (c.courses?.name || 'quran studies').toLowerCase();
          if (!studentName.includes(query) && !studentId.includes(query) && !teacherName.includes(query) && !courseName.includes(query)) {
            return false;
          }
        }

        return true;
      });

      if (countBadge) countBadge.innerText = `${filtered.length} Classes`;

      if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) {
          emptyState.classList.remove('hidden');
          const emptyTitle = document.getElementById('dashEmptyStateTitle');
          const emptyMsg = document.getElementById('dashEmptyStateMsg');
          
          const emptyMessages = {
            'all': { title: 'No Classes Scheduled Today', msg: 'No classes are scheduled for today in the timetable.' },
            'current': { title: 'No Classes Scheduled In Current Slot', msg: 'There are no classes scheduled in the current 30-minute time slot.' },
            'running': { title: 'No Running Classes Marked Yet', msg: 'No teachers have marked attendance for the current time slot yet.' },
            'live': { title: 'No Classes In This Slot', msg: 'No ongoing classes in the current time slot.' },
            'completed': { title: 'No Taken Classes Yet', msg: 'No taken classes recorded yet today since midnight.' },
            'remaining': { title: 'All Scheduled Classes Taken', msg: 'No remaining classes scheduled for the rest of today.' },
            'absent': { title: 'Zero Absent Sessions Today', msg: 'Zero absent students recorded today. All students are attending regularly!' },
            'leave': { title: 'No Student Leaves Marked Today', msg: 'No student leaves recorded for today.' },
            'trial': { title: 'No Trial Classes Scheduled Today', msg: 'No trial classes booked for today.' }
          };

          const msg = emptyMessages[CURRENT_DASH_FILTER] || emptyMessages['all'];
          if (emptyTitle) emptyTitle.innerText = msg.title;
          if (emptyMsg) emptyMsg.innerText = msg.msg;
        }
        return;
      }

      if (emptyState) emptyState.classList.add('hidden');

      const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

      tbody.innerHTML = filtered.map(c => {
        let timingNote = '';
        if (c.isLive) {
          const remainingMin = c.endMin - nowMinutes;
          timingNote = `<span class="text-[10px] text-emerald-700 font-extrabold block">● Live Now (${remainingMin}m left)</span>`;
        } else if (c.isUpcoming) {
          const startIn = c.startMin - nowMinutes;
          const hours = Math.floor(startIn / 60);
          const mins = startIn % 60;
          timingNote = `<span class="text-[10px] text-slate-500 block">Starts in ${hours > 0 ? hours + 'h ' : ''}${mins}m</span>`;
        } else {
          timingNote = `<span class="text-[10px] text-slate-400 block">Slot Ended</span>`;
        }

        const cleanPhone = (c.students?.whatsapp || '').replace(/[^0-9]/g, '');
        const waChat = (cleanPhone && CURRENT_ROLE !== 'manager') ? `<a href="https://wa.me/${cleanPhone}" target="_blank" class="text-emerald-600 hover:text-emerald-800 ml-1.5" title="WhatsApp Parent"><i class="fa-brands fa-whatsapp"></i></a>` : '';

        const typeBadge = c.isTrial 
          ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-800 border border-purple-200">Trial</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">Regular</span>';

        let sabaqText = `<span class="text-slate-400 italic">No notes logged yet</span>`;
        if (c.log?.lesson_notes) {
          try {
            const pMeta = JSON.parse(c.log.lesson_notes);
            if (pMeta.book_title || pMeta.page) {
              const passColor = pMeta.status === 'Pass' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-amber-100 text-amber-800 border-amber-300';
              sabaqText = `
                <div class="space-y-1">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-bold text-slate-800 text-xs flex items-center gap-1">
                      <i class="fa-solid fa-book-open text-brandEmerald"></i> ${pMeta.book_title || 'Course'}
                    </span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${passColor} border">
                      Pg ${pMeta.page || '1'} ${pMeta.line_range ? `(${pMeta.line_range})` : ''} - ${pMeta.status || 'Done'}
                    </span>
                  </div>
                  ${pMeta.remarks ? `<div class="text-[11px] text-slate-600 italic">"${pMeta.remarks}"</div>` : ''}
                  <button onclick="openDigitalBookReader('${pMeta.book_id || 'noorani-qaida-classic'}', ${pMeta.page || 1})" class="text-[10px] text-emerald-700 hover:text-emerald-900 font-bold underline flex items-center gap-1">
                    <i class="fa-solid fa-book-reader"></i> Read Page ${pMeta.page || 1}
                  </button>
                </div>
              `;
            } else {
              sabaqText = `<span class="text-slate-800 font-semibold">${c.log.lesson_notes}</span>`;
            }
          } catch(e) {
            sabaqText = `<span class="text-slate-800 font-semibold">${c.log.lesson_notes}</span>`;
          }
        }

        // KPI Color-Matched Row & Status Badge Styling (100% synced with the 8 KPI Boxes)
        let rowClass = 'border-l-4 border-amber-500 bg-amber-50/50 hover:bg-amber-100/60 transition font-medium text-amber-950';
        let effectiveBadgeClass = c.badgeClass;
        let effectiveStatus = c.status;

        if (CURRENT_DASH_FILTER === 'trial') {
          rowClass = 'border-l-4 border-purple-500 bg-purple-50/60 hover:bg-purple-100/60 transition font-medium text-purple-950';
          effectiveBadgeClass = 'bg-purple-100 text-purple-900 border-purple-400 font-extrabold';
          effectiveStatus = `Trial (${c.status})`;
        } else if (c.filterCategory === 'absent' || c.status === 'Absent') {
          rowClass = 'border-l-4 border-rose-500 bg-rose-50/80 hover:bg-rose-100/70 transition font-medium text-rose-950';
        } else if (c.filterCategory === 'leave' || c.status?.includes('Leave')) {
          rowClass = 'border-l-4 border-blue-500 bg-blue-50/70 hover:bg-blue-100/60 transition font-medium text-blue-950';
        } else if (c.isRunningMarked || CURRENT_DASH_FILTER === 'running') {
          rowClass = 'border-l-4 border-emerald-500 bg-emerald-50/80 hover:bg-emerald-100/70 transition font-semibold text-emerald-950';
          effectiveBadgeClass = 'bg-emerald-100 text-emerald-900 border-emerald-400 font-extrabold';
        } else if (c.isCurrentSlot || c.filterCategory === 'current' || CURRENT_DASH_FILTER === 'current') {
          rowClass = 'border-l-4 border-cyan-500 bg-cyan-50/70 hover:bg-cyan-100/70 transition font-semibold text-cyan-950';
          effectiveBadgeClass = 'bg-cyan-100 text-cyan-900 border-cyan-400 font-extrabold';
        } else if (c.filterCategory === 'completed') {
          rowClass = 'border-l-4 border-teal-500 bg-teal-50/60 hover:bg-teal-100/60 transition font-medium text-teal-950';
          effectiveBadgeClass = 'bg-teal-100 text-teal-900 border-teal-400 font-extrabold';
        } else if (c.isTrial) {
          rowClass = 'border-l-4 border-purple-500 bg-purple-50/50 hover:bg-purple-100/60 transition text-purple-950';
        }

        return `
          <tr class="${rowClass}">
            <td class="p-3">
              <div class="font-mono font-black text-xs">
                ${c.start_time.slice(0,5)} - ${c.end_time.slice(0,5)}
              </div>
              ${timingNote}
            </td>

            <td class="p-3">
              <div class="flex items-center">
                <button onclick="openStudentDetailModal('${c.student_id || c.students?.id || ''}')" class="font-bold text-slate-900 hover:text-brandEmerald hover:underline text-left flex items-center gap-1 group" title="Click to view Student Profile & Family">
                  <span>${c.students?.name || 'Student'}</span>
                  <i class="fa-solid fa-circle-info text-[10px] text-slate-400 group-hover:text-brandEmerald"></i>
                </button>
                ${waChat}
              </div>
              <div class="flex items-center gap-1 mt-0.5 text-[10px] text-slate-500 font-mono">
                <button onclick="openStudent360Profile('${c.student_id || c.students?.id || ''}')" class="hover:text-brandEmerald hover:underline">${c.students?.id || 'STU-ID'}</button>
                ${c.students?.family_id ? `&bull; <button onclick="openFamily360Profile('${c.students.family_id}')" class="text-emerald-700 hover:underline font-bold" title="Open Family 360° Profile">${c.students.family_id}</button>` : ''}
              </div>
            </td>

            <td class="p-3">
              <span class="px-2 py-0.5 rounded bg-emerald-50 text-brandEmerald font-bold text-[11px] border border-emerald-200">
                ${c.courses?.name || 'Quran Studies & Tajweed'}
              </span>
            </td>

            <td class="p-3">
              <div>
                <button onclick="openTeacherOptionsModal('${c.teacher_id || c.teachers?.id || ''}')" class="font-bold text-brandDark hover:text-brandEmerald hover:underline text-left flex items-center gap-1 group" title="Click for Teacher Profile & 2D Weekly Schedule">
                  <span>${c.teachers?.full_name || 'Assigned Teacher'}</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-400 group-hover:text-brandEmerald"></i>
                </button>
              </div>
              <div class="text-[10px] text-slate-400 font-mono">${c.teachers?.phone || c.teachers?.email || 'Teacher ID'}</div>
            </td>

            <td class="p-3">
              ${typeBadge}
            </td>

            <td class="p-3 max-w-xs truncate">
              ${sabaqText}
              <div class="mt-0.5">
                <span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${effectiveBadgeClass}">
                  ${effectiveStatus}
                </span>
              </div>
            </td>

            <td class="p-3 text-right">
              <div class="flex items-center justify-end gap-1.5 flex-wrap">
                <button onclick="openDashAttendanceModal('${c.id}', '${c.students?.name || ''}', '${c.start_time.slice(0,5)} - ${c.end_time.slice(0,5)}', '${c.teachers?.full_name || ''}', '${c.student_id}', '${c.teacher_id}', '${c.log?.status || ''}', '${c.log?.lesson_notes || ''}')" class="px-2.5 py-1 bg-brandDark text-white rounded-md text-[11px] font-bold hover:bg-brandDarkest shadow-sm flex items-center gap-1">
                  <i class="fa-solid fa-clipboard-check"></i> Attendance
                </button>

                ${c.meeting_link ? `
                  <a href="${c.meeting_link}" target="_blank" class="px-2.5 py-1 bg-emerald-600 text-white rounded-md text-[11px] font-bold hover:bg-emerald-700 shadow-sm flex items-center gap-1">
                    <i class="fa-solid fa-video"></i> Join
                  </a>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    function handleDashClassSearch(query) {
      renderDashboardClassesTable(query);
    }

    function openDashAttendanceModal(scheduleId, studentName, timeSlot, teacherName, studentId, teacherId, currentStatus, currentNotes) {
      document.getElementById('dashAttScheduleId').value = scheduleId;
      document.getElementById('dashAttStudentId').value = studentId;
      document.getElementById('dashAttTeacherId').value = teacherId;
      document.getElementById('dashAttStudentName').innerText = studentName || 'Student';
      document.getElementById('dashAttTime').innerText = timeSlot || '--';
      document.getElementById('dashAttTeacherName').innerText = teacherName || 'Teacher';
      document.getElementById('dashAttNotes').value = currentNotes || '';

      selectDashAttStatus(currentStatus || 'Present');
      openModal('modalDashAttendance');
    }

    function selectDashAttStatus(status) {
      document.getElementById('dashAttSelectedStatus').value = status;
      const btnP = document.getElementById('btnAttPresent');
      const btnAdv = document.getElementById('btnAttAdvance');
      const btnA = document.getElementById('btnAttAbsent');
      const btnL = document.getElementById('btnAttLeave');

      if (btnP) btnP.className = 'py-2.5 rounded-xl border font-bold flex flex-col items-center gap-1 ' + 
        (status === 'Present' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700 hover:bg-emerald-50');
      
      if (btnAdv) btnAdv.className = 'py-2.5 rounded-xl border font-bold flex flex-col items-center gap-1 ' + 
        (status === 'Advance Class' ? 'border-purple-500 bg-purple-50 text-purple-800' : 'border-slate-300 text-slate-700 hover:bg-purple-50');

      if (btnA) btnA.className = 'py-2.5 rounded-xl border font-bold flex flex-col items-center gap-1 ' + 
        (status === 'Absent' ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-300 text-slate-700 hover:bg-rose-50');

      if (btnL) btnL.className = 'py-2.5 rounded-xl border font-bold flex flex-col items-center gap-1 ' + 
        (status === 'Leave' ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-300 text-slate-700 hover:bg-blue-50');
    }

    async function handleSaveDashAttendance(e) {
      e.preventDefault();
      const btn = document.getElementById('btnSaveDashAtt');
      btn.disabled = true;
      btn.innerText = 'Saving...';

      const schedule_id = document.getElementById('dashAttScheduleId').value;
      const student_id = document.getElementById('dashAttStudentId').value;
      const teacher_id = document.getElementById('dashAttTeacherId').value;
      const status = document.getElementById('dashAttSelectedStatus').value;
      const lesson_notes = document.getElementById('dashAttNotes').value.trim();
      const date = new Date().toISOString().slice(0, 10);

      await db.from('attendance_logs').upsert([{
        schedule_id,
        student_id,
        teacher_id,
        date,
        status,
        lesson_notes
      }], { onConflict: 'schedule_id,date' });

      closeModal('modalDashAttendance');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Attendance';

      await loadDashboardData();
    }

    // INTERACTIVE STUDENT DETAIL — ROUTES TO FULL-SCREEN FAMILY PROFILE WORKSPACE (SELECTING STUDENT)
    async function openStudentDetailModal(studentId) {
      if (!studentId) return;
      if (typeof openStudent360Profile === 'function') {
        await openStudent360Profile(studentId);
        return;
      }

      let student = (ALL_STUDENTS || []).find(s => s.id === studentId);
      if (!student) {
        const foundInDash = (DASHBOARD_CLASSES || []).find(c => c.student_id === studentId || c.students?.id === studentId);
        if (foundInDash && foundInDash.students) {
          student = foundInDash.students;
        }
      }

      if (!student) {
        const { data } = await db.from('students').select('*').eq('id', studentId).maybeSingle();
        student = data;
      }

      if (!student) {
        alert("Student profile details could not be found.");
        return;
      }

      // Find family
      let family = (ALL_FAMILIES || []).find(f => f.id === student.family_id);
      if (!family && student.family_id) {
        const { data } = await db.from('families').select('*').eq('id', student.family_id).maybeSingle();
        family = data;
      }

      let lang = 'English';
      let days = '5 Days / Week (Mon - Fri)';
      if (student.notes) {
        try {
          const meta = JSON.parse(student.notes);
          if (meta.language) lang = meta.language;
          if (meta.days_per_week) days = meta.days_per_week;
        } catch (e) {}
      }
      if (student.language) lang = student.language;

      let teacherName = 'Not Assigned';
      const teacherId = student.assigned_teacher_id;
      if (teacherId) {
        const t = (ALL_TEACHERS || []).find(tc => tc.id === teacherId);
        if (t) teacherName = t.full_name;
      } else {
        const dashMatch = (DASHBOARD_CLASSES || []).find(c => c.student_id === studentId);
        if (dashMatch && dashMatch.teachers) teacherName = dashMatch.teachers.full_name;
      }

      // Populate Modal Fields
      document.getElementById('stuDetailName').innerText = student.name || 'Student Details';
      document.getElementById('stuDetailIdBadge').innerText = student.id || '--';
      document.getElementById('stuDetailAgeGender').innerText = `${student.age || 'N/A'} yrs • ${student.gender || 'N/A'}`;
      document.getElementById('stuDetailLanguage').innerText = lang;
      document.getElementById('stuDetailCourse').innerText = student.course_id || 'Quran Studies & Tajweed';
      document.getElementById('stuDetailDays').innerText = days;
      document.getElementById('stuDetailJoining').innerText = student.joining_date || 'N/A';
      document.getElementById('stuDetailTeacher').innerText = teacherName;
      const rawPhone = student.whatsapp || family?.whatsapp || '';
      const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
      const displayedPhone = (CURRENT_ROLE === 'manager') ? maskStudentPhone(rawPhone) : rawPhone;
      document.getElementById('stuDetailLocation').innerText = family ? `${family.country || 'Global'} • ${displayedPhone || ''}` : 'Location N/A';

      // WhatsApp direct contact (Protected from Manager)
      const waBtn = document.getElementById('stuDetailWhatsAppBtn');
      if (waBtn) {
        if (cleanPhone && CURRENT_ROLE !== 'manager') {
          const waMsg = `Assalam-o-Alaikum,\nRegarding student *${student.name}* (ID: ${student.id}) from *Al-Huda Islamic Centre LMS*.`;
          waBtn.href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;
          waBtn.style.display = 'inline-flex';
        } else {
          waBtn.style.display = 'none';
        }
      }

      openModal('modalStudentDetail');
    }

    function viewStudentInFamilyDirectory() {
      closeModal('modalStudentDetail');
      switchTab('tab-families');
    }

    // INTERACTIVE TEACHER OPTIONS & MATRIX MODAL -> ROUTES TO CANONICAL TEACHER 360 PROFILE
    async function openTeacherOptionsModal(teacherId) {
      if (!teacherId) return;
      if (typeof openTeacher360Profile === 'function') {
        return openTeacher360Profile(teacherId);
      }
      CURRENT_MODAL_TEACHER_ID = teacherId;

      let teacher = (ALL_TEACHERS || []).find(t => t.id === teacherId);
      if (!teacher) {
        const foundInDash = (DASHBOARD_CLASSES || []).find(c => c.teacher_id === teacherId || c.teachers?.id === teacherId);
        if (foundInDash && foundInDash.teachers) {
          teacher = foundInDash.teachers;
        }
      }

      if (!teacher) {
        const { data } = await db.from('teachers').select('*').eq('id', teacherId).maybeSingle();
        teacher = data;
      }

      if (!teacher) {
        alert("Teacher profile details could not be found.");
        return;
      }

      document.getElementById('tOptionName').innerText = teacher.full_name || 'Teacher Profile';
      document.getElementById('tOptionIdBadge').innerText = teacher.id || '--';
      document.getElementById('tOptionQual').innerText = teacher.qualification || 'Quran & Tajweed Instructor';
      document.getElementById('tOptionRate').innerText = `${teacher.rate_per_slot || 200} PKR / slot`;
      document.getElementById('tOptionShift').innerText = teacher.working_shift || '10 Hours Shift (Morning / Evening)';

      // WhatsApp Button
      const cleanPhone = (teacher.phone || '').replace(/[^0-9]/g, '');
      const waBtn = document.getElementById('tOptionWhatsAppBtn');
      if (waBtn) {
        if (cleanPhone) {
          const waMsg = `Assalam-o-Alaikum Teacher *${teacher.full_name}*,\nContact from Al-Huda Islamic Centre Administration.`;
          waBtn.href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;
          waBtn.classList.remove('hidden');
          waBtn.classList.add('flex');
        } else {
          waBtn.classList.add('hidden');
          waBtn.classList.remove('flex');
        }
      }

      // Fetch & populate assigned students for this teacher
      const countBadge = document.getElementById('tOptionStudentCount');
      const listContainer = document.getElementById('tOptionStudentsList');
      if (countBadge) countBadge.innerText = 'Loading...';
      if (listContainer) listContainer.innerHTML = '<div class="text-slate-400 py-1">Loading assigned students...</div>';

      try {
        const { data: scheds } = await db.from('class_schedules')
          .select('student_id, students(name, course_id, family_id)')
          .eq('teacher_id', teacherId);

        const uniqueStudentsMap = {};
        (scheds || []).forEach(s => {
          if (s.students && s.student_id) {
            uniqueStudentsMap[s.student_id] = s.students;
          }
        });

        (ALL_STUDENTS || []).forEach(st => {
          if (st.assigned_teacher_id === teacherId) {
            uniqueStudentsMap[st.id] = st;
          }
        });

        const studentsArr = Object.entries(uniqueStudentsMap);
        if (countBadge) countBadge.innerText = `${studentsArr.length} Students`;

        if (studentsArr.length === 0) {
          if (listContainer) listContainer.innerHTML = '<div class="text-slate-400 italic py-1">No students currently assigned to this teacher.</div>';
        } else {
          if (listContainer) {
            listContainer.innerHTML = studentsArr.map(([sId, sObj]) => `
              <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
                <div>
                  <div class="font-bold text-slate-800">${sObj.name || 'Student'}</div>
                  <div class="text-[10px] text-slate-500 font-mono">${sId} &bull; ${sObj.course_id || 'Quran'}</div>
                </div>
                <button onclick="closeModal('modalTeacherOptions'); openStudentDetailModal('${sId}')" class="px-2 py-1 bg-brandDark text-white text-[10px] font-bold rounded hover:bg-brandDarkest shadow-xs">
                  View Student
                </button>
              </div>
            `).join('');
          }
        }
      } catch (err) {
        console.error("Error loading teacher students:", err);
        if (countBadge) countBadge.innerText = '0 Students';
        if (listContainer) listContainer.innerHTML = '<div class="text-slate-400 py-1">Could not fetch students list.</div>';
      }

      openModal('modalTeacherOptions');
    }

    function triggerTeacherMatrixFromOptions() {
      if (!CURRENT_MODAL_TEACHER_ID) return;
      const tId = CURRENT_MODAL_TEACHER_ID;
      closeModal('modalTeacherOptions');
      switchTab('tab-teachers');
      open2DMatrixForTeacher(tId);
    }

    function viewTeacherInDirectory() {
      closeModal('modalTeacherOptions');
      switchTab('tab-teachers');
    }

    // =========================================================================
    // MAIN DASHBOARD GLOBAL SEARCH BAR (STUDENTS, FAMILIES & TEACHERS)
    // Searches by Name, Student/Family/Teacher ID, or Phone/WhatsApp Number
    // =========================================================================
    let _dashSearchDataPromise = null;

    async function ensureDashboardSearchDataLoaded() {
      if ((ALL_FAMILIES && ALL_FAMILIES.length > 0) && (ALL_STUDENTS && ALL_STUDENTS.length > 0) && (ALL_TEACHERS && ALL_TEACHERS.length > 0)) {
        return;
      }
      if (_dashSearchDataPromise) return _dashSearchDataPromise;

      _dashSearchDataPromise = (async () => {
        try {
          if (typeof consolidateDuplicateTrialAndRegularRecords === 'function') {
            await consolidateDuplicateTrialAndRegularRecords();
          }
          const [famRes, stuRes, tchRes] = await Promise.all([
            (!ALL_FAMILIES || ALL_FAMILIES.length === 0) ? db.from('families').select('*, students(*)').order('created_at', { ascending: false }) : Promise.resolve({ data: ALL_FAMILIES }),
            (!ALL_STUDENTS || ALL_STUDENTS.length === 0) ? db.from('students').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: ALL_STUDENTS }),
            (!ALL_TEACHERS || ALL_TEACHERS.length === 0) ? db.from('teachers').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: ALL_TEACHERS })
          ]);
          if (famRes.data && (!ALL_FAMILIES || ALL_FAMILIES.length === 0)) {
            ALL_FAMILIES = famRes.data.filter(f => typeof isRegularFamilyRecord === 'function' ? isRegularFamilyRecord(f) : f.status !== 'Trial');
          }
          if (stuRes.data && (!ALL_STUDENTS || ALL_STUDENTS.length === 0)) {
            ALL_STUDENTS = stuRes.data.filter(s => typeof isRegularStudentRecord === 'function' ? isRegularStudentRecord(s) : s.status !== 'Trial');
          }
          if (tchRes.data && (!ALL_TEACHERS || ALL_TEACHERS.length === 0)) ALL_TEACHERS = tchRes.data;
        } catch (err) {
          console.error('Dashboard search cache load error:', err);
        } finally {
          _dashSearchDataPromise = null;
        }
      })();

      return _dashSearchDataPromise;
    }

    async function handleDashboardGlobalSearch(rawQuery) {
      const panel = document.getElementById('dashGlobalSearchResultsPanel');
      const clearBtn = document.getElementById('btnClearDashGlobalSearch');
      const q = (rawQuery || '').trim().toLowerCase();

      const kbdHint = document.getElementById('kbdDashGlobalSearchHint');
      if (clearBtn) {
        if (q.length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
      }
      if (kbdHint) {
        if (q.length > 0) kbdHint.classList.add('hidden');
        else kbdHint.classList.remove('hidden');
      }

      if (!panel) return;

      if (!q) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
      }

      await ensureDashboardSearchDataLoaded();

      const regularFamilies = (ALL_FAMILIES || []).filter(f => typeof isRegularFamilyRecord === 'function' ? isRegularFamilyRecord(f) : f.status !== 'Trial');
      const regularStudents = (ALL_STUDENTS || []).filter(s => typeof isRegularStudentRecord === 'function' ? isRegularStudentRecord(s) : s.status !== 'Trial');

      const familyMap = {};
      regularFamilies.forEach(f => {
        familyMap[f.id] = f;
        familyMap[String(f.id || '').toUpperCase()] = f;
      });

      const teacherMap = {};
      (ALL_TEACHERS || []).forEach(t => { teacherMap[t.id] = t; });

      const isFamDeact = (f) => typeof isFamilyDeactivated === 'function'
        ? isFamilyDeactivated(f)
        : ['inactive', 'deactivated'].includes(String(f?.status || '').toLowerCase());

      const isStuDeact = (s) => {
        const fam = familyMap[s.family_id] || familyMap[String(s.family_id || '').toUpperCase()];
        if (fam && isFamDeact(fam)) return true;
        return ['inactive', 'deactivated', 'deleted', 'left'].includes(String(s?.status || '').toLowerCase());
      };

      // 1. Match Regular Students (Active vs Deactivated)
      const seenStudentKeys = new Set();
      const allMatchedStudents = regularStudents.filter(s => {
        const fam = familyMap[s.family_id] || familyMap[String(s.family_id || '').toUpperCase()];
        if (!fam && String(s.family_id || '').toUpperCase().startsWith('TRL-')) return false;
        const sName = String(s.name || '').toLowerCase();
        const sId = String(s.id || '').toLowerCase();
        const fId = String(s.family_id || '').toLowerCase();
        const fName = fam ? String(fam.parent_name || '').toLowerCase() : '';
        const fPhone = fam ? String(fam.whatsapp || '').toLowerCase() : '';
        const matches = sName.includes(q) || sId.includes(q) || fId.includes(q) || fName.includes(q) || fPhone.includes(q);
        if (!matches) return false;
        const dedupKey = `${sName}__${fPhone || fId}`;
        if (seenStudentKeys.has(dedupKey)) return false;
        seenStudentKeys.add(dedupKey);
        return true;
      });

      const matchedStudents = allMatchedStudents.filter(s => !isStuDeact(s)).slice(0, 6);
      const deactivatedMatchedStudents = allMatchedStudents.filter(s => isStuDeact(s)).slice(0, 4);

      // 2. Match Regular Families (Active vs Deactivated)
      const seenFamilyKeys = new Set();
      const allMatchedFamilies = regularFamilies.filter(f => {
        const fName = String(f.parent_name || '').toLowerCase();
        const fId = String(f.id || '').toLowerCase();
        const fPhone = String(f.whatsapp || '').toLowerCase();
        const matches = fName.includes(q) || fId.includes(q) || fPhone.includes(q);
        if (!matches) return false;
        const dedupKey = String(f.whatsapp || '').replace(/[^0-9]/g, '').slice(-10) || fName || fId;
        if (seenFamilyKeys.has(dedupKey)) return false;
        seenFamilyKeys.add(dedupKey);
        return true;
      });

      const matchedFamilies = allMatchedFamilies.filter(f => !isFamDeact(f)).slice(0, 5);
      const deactivatedMatchedFamilies = allMatchedFamilies.filter(f => isFamDeact(f)).slice(0, 4);

      // 3. Match Active Trials (from ALL_TRIALS where status is not Converted/Discontinued)
      const matchedTrials = (ALL_TRIALS || []).filter(tr => {
        if (tr.status === 'Converted' || tr.status === 'Discontinued') return false;
        const sName = String(tr.student_name || '').toLowerCase();
        const pName = String(tr.parent_name || '').toLowerCase();
        const phone = String(tr.whatsapp || '').toLowerCase();
        const trId = String(tr.id || '').toLowerCase();
        return sName.includes(q) || pName.includes(q) || phone.includes(q) || trId.includes(q);
      }).slice(0, 4);

      // 4. Match Employees / Teachers (by Full Name, Employee/Teacher ID, or Phone)
      const matchedTeachers = (ALL_TEACHERS || []).filter(t => {
        const tName = String(t.full_name || '').toLowerCase();
        const tId = String(t.id || '').toLowerCase();
        const tPhone = String(t.phone || '').toLowerCase();
        let credsId = '';
        if (typeof getTeacherCreds === 'function') {
          try { credsId = String(getTeacherCreds(t)?.teacher_id || '').toLowerCase(); } catch (e) {}
        }
        return tName.includes(q) || tId.includes(q) || credsId.includes(q) || tPhone.includes(q);
      }).slice(0, 5);

      const totalCount = matchedStudents.length + matchedFamilies.length + matchedTrials.length + matchedTeachers.length + deactivatedMatchedFamilies.length + deactivatedMatchedStudents.length;

      if (totalCount === 0) {
        panel.innerHTML = `
          <div class="p-5 text-center text-xs text-slate-400 font-semibold">
            <i class="fa-solid fa-magnifying-glass-minus text-slate-300 text-lg mb-1.5 block"></i>
            No matching Student, Family, Trial, or Employee found for "<span class="text-slate-700 font-bold">${rawQuery}</span>"
          </div>
        `;
        panel.classList.remove('hidden');
        return;
      }

      let html = '';

      // Render Active Students Section
      if (matchedStudents.length > 0) {
        html += `
          <div class="p-2.5">
            <div class="px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-teal-800 bg-teal-50/90 rounded-lg mb-1.5 flex items-center justify-between">
              <span><i class="fa-solid fa-user-graduate mr-1.5"></i> Students (${matchedStudents.length})</span>
              <span class="text-[10px] text-teal-700 font-bold">Click to Open Family &amp; Select Student</span>
            </div>
            <div class="space-y-1">
              ${matchedStudents.map(s => {
                const fam = familyMap[s.family_id] || familyMap[String(s.family_id || '').toUpperCase()];
                const parentName = fam ? fam.parent_name : (s.family_id || '--');
                const rawPhone = fam ? (fam.whatsapp || '') : '';
                const displayPhone = (typeof maskStudentPhone === 'function') ? maskStudentPhone(rawPhone) : (rawPhone || '--');
                return `
                  <div onclick="clearDashboardGlobalSearch(); openStudent360Profile('${s.id}')" class="px-3 py-2 rounded-xl hover:bg-teal-50/80 cursor-pointer transition flex items-center justify-between gap-2 border border-transparent hover:border-teal-200">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-[13px] font-extrabold text-slate-900 truncate">${s.name}</span>
                        <span class="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 font-num text-[11px] font-bold text-brandDark shrink-0">${s.id}</span>
                      </div>
                      <div class="text-[11.5px] text-slate-500 truncate mt-0.5">
                        Family: <strong class="text-slate-700">${parentName}</strong> (${s.family_id || '--'}) &bull; <span class="font-num">${displayPhone}</span>
                      </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-lg bg-brandDark text-white text-[11px] font-bold shrink-0">View Student</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      // Render Active Families Section
      if (matchedFamilies.length > 0) {
        html += `
          <div class="p-2.5">
            <div class="px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50/90 rounded-lg mb-1.5 flex items-center justify-between">
              <span><i class="fa-solid fa-people-roof mr-1.5"></i> Families (${matchedFamilies.length})</span>
              <span class="text-[10px] text-emerald-700 font-bold">Click to Open Family Profile</span>
            </div>
            <div class="space-y-1">
              ${matchedFamilies.map(f => {
                const displayPhone = (typeof maskStudentPhone === 'function') ? maskStudentPhone(f.whatsapp) : (f.whatsapp || '--');
                const childCount = (f.students || []).length;
                return `
                  <div onclick="openFamilyFromDashboardSearch('${f.id}')" class="px-3 py-2 rounded-xl hover:bg-emerald-50/80 cursor-pointer transition flex items-center justify-between gap-2 border border-transparent hover:border-emerald-200">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-[13px] font-extrabold text-slate-900 truncate">${f.parent_name}</span>
                        <span class="px-2 py-0.5 rounded-md bg-emerald-100 border border-emerald-200 font-num text-[11px] font-bold text-emerald-900 shrink-0">${f.id}</span>
                      </div>
                      <div class="text-[11.5px] text-slate-500 truncate mt-0.5">
                        Phone: <span class="font-num font-semibold text-slate-700">${displayPhone}</span> &bull; <span class="font-num font-bold text-slate-700">${childCount}</span> Student(s)
                      </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-bold shrink-0">Family Profile</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      // Render Explicitly Searched Deactivated Families / Students (with clear DEACTIVATED badges)
      if (deactivatedMatchedFamilies.length > 0 || deactivatedMatchedStudents.length > 0) {
        html += `
          <div class="p-2.5 border-t border-rose-100 bg-rose-50/20">
            <div class="px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-rose-800 bg-rose-100/90 rounded-lg mb-1.5 flex items-center justify-between">
              <span><i class="fa-solid fa-user-slash mr-1.5"></i> Deactivated Records (${deactivatedMatchedFamilies.length + deactivatedMatchedStudents.length})</span>
              <span class="text-[10px] text-rose-800 font-extrabold uppercase">DEACTIVATED</span>
            </div>
            <div class="space-y-1">
              ${deactivatedMatchedFamilies.map(f => {
                const displayPhone = (typeof maskStudentPhone === 'function') ? maskStudentPhone(f.whatsapp) : (f.whatsapp || '--');
                return `
                  <div onclick="openFamilyFromDashboardSearch('${f.id}')" class="px-3 py-2 rounded-xl bg-rose-50/50 hover:bg-rose-100/70 cursor-pointer transition flex items-center justify-between gap-2 border border-rose-200">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-[13px] font-extrabold text-slate-700 truncate">${f.parent_name}</span>
                        <span class="px-2 py-0.5 rounded-md bg-slate-200 border border-slate-300 font-num text-[11px] font-bold text-slate-700 shrink-0">${f.id}</span>
                        <span class="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-extrabold uppercase tracking-wider shrink-0">DEACTIVATED</span>
                      </div>
                      <div class="text-[11.5px] text-slate-500 truncate mt-0.5">
                        Phone: <span class="font-num font-semibold text-slate-600">${displayPhone}</span> &bull; <span class="text-rose-700 font-bold">Deactivated Family Account</span>
                      </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-800 border border-rose-300 text-[11px] font-extrabold shrink-0">DEACTIVATED</span>
                  </div>
                `;
              }).join('')}
              ${deactivatedMatchedStudents.map(s => {
                const fam = familyMap[s.family_id] || familyMap[String(s.family_id || '').toUpperCase()];
                const parentName = fam ? fam.parent_name : (s.family_id || '--');
                const famInactive = fam && isFamDeact(fam);
                const statusText = famInactive ? 'DEACTIVATED — Family Inactive' : 'DEACTIVATED';
                return `
                  <div onclick="clearDashboardGlobalSearch(); openStudent360Profile('${s.id}')" class="px-3 py-2 rounded-xl bg-rose-50/50 hover:bg-rose-100/70 cursor-pointer transition flex items-center justify-between gap-2 border border-rose-200">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-[13px] font-extrabold text-slate-700 truncate">${s.name}</span>
                        <span class="px-2 py-0.5 rounded-md bg-slate-200 border border-slate-300 font-num text-[11px] font-bold text-slate-700 shrink-0">${s.id}</span>
                        <span class="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-extrabold uppercase tracking-wider shrink-0">${statusText}</span>
                      </div>
                      <div class="text-[11.5px] text-slate-500 truncate mt-0.5">
                        Family: <strong class="text-slate-600">${parentName}</strong> (${s.family_id || '--'}) &bull; <span class="text-rose-700 font-bold">${statusText}</span>
                      </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-800 border border-rose-300 text-[11px] font-extrabold shrink-0">DEACTIVATED</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      // Render Active Trials Section
      if (matchedTrials.length > 0) {
        html += `
          <div class="p-2.5">
            <div class="px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-purple-800 bg-purple-50/90 rounded-lg mb-1.5 flex items-center justify-between">
              <span><i class="fa-solid fa-user-plus mr-1.5"></i> Active Trials (${matchedTrials.length})</span>
              <span class="text-[10px] text-purple-700 font-bold">Click to Open Trial Evaluation</span>
            </div>
            <div class="space-y-1">
              ${matchedTrials.map(tr => {
                const displayPhone = (typeof maskStudentPhone === 'function') ? maskStudentPhone(tr.whatsapp) : (tr.whatsapp || '--');
                return `
                  <div onclick="openTrialFromGlobalSearch('${(tr.student_name || '').replace(/'/g, "\\'")}')" class="px-3 py-2 rounded-xl hover:bg-purple-50/80 cursor-pointer transition flex items-center justify-between gap-2 border border-transparent hover:border-purple-200">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-[13px] font-extrabold text-slate-900 truncate">${tr.student_name}</span>
                        <span class="px-2 py-0.5 rounded-md bg-purple-100 border border-purple-200 font-num text-[11px] font-bold text-purple-900 shrink-0">Trial (${tr.conducted_sessions || 0}/3)</span>
                      </div>
                      <div class="text-[11.5px] text-slate-500 truncate mt-0.5">
                        Parent: <strong class="text-slate-700">${tr.parent_name || '--'}</strong> &bull; <span class="font-num">${displayPhone}</span>
                      </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-lg bg-purple-700 text-white text-[11px] font-bold shrink-0">Open Trial</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      // Render Employees / Teachers Section
      if (matchedTeachers.length > 0) {
        html += `
          <div class="p-2.5">
            <div class="px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-indigo-800 bg-indigo-50/90 rounded-lg mb-1.5 flex items-center justify-between">
              <span><i class="fa-solid fa-user-tie mr-1.5"></i> Employees (${matchedTeachers.length})</span>
              <span class="text-[10px] text-indigo-700 font-bold">Click to Open Employee Profile</span>
            </div>
            <div class="space-y-1">
              ${matchedTeachers.map(t => {
                let credsId = t.id || 'EMP';
                if (typeof getTeacherCreds === 'function') {
                  try { credsId = getTeacherCreds(t)?.teacher_id || credsId; } catch (e) {}
                }
                return `
                  <div onclick="clearDashboardGlobalSearch(); openTeacher360Profile('${t.id}')" class="px-3 py-2 rounded-xl hover:bg-indigo-50/80 cursor-pointer transition flex items-center justify-between gap-2 border border-transparent hover:border-indigo-200">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-[13px] font-extrabold text-slate-900 truncate">${t.full_name}</span>
                        <span class="px-2 py-0.5 rounded-md bg-indigo-100 border border-indigo-200 font-num text-[11px] font-bold text-indigo-900 shrink-0">${credsId}</span>
                      </div>
                      <div class="text-[11.5px] text-slate-500 truncate mt-0.5">
                        Phone: <span class="font-num font-semibold text-slate-700">${t.phone || '--'}</span>
                      </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-lg bg-indigo-700 text-white text-[11px] font-bold shrink-0">Employee Profile</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      panel.innerHTML = html;
      panel.classList.remove('hidden');
    }

    function clearDashboardGlobalSearch() {
      const input = document.getElementById('dashGlobalSearchInput');
      const panel = document.getElementById('dashGlobalSearchResultsPanel');
      const clearBtn = document.getElementById('btnClearDashGlobalSearch');
      const kbdHint = document.getElementById('kbdDashGlobalSearchHint');
      if (input) input.value = '';
      if (panel) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
      }
      if (clearBtn) clearBtn.classList.add('hidden');
      if (kbdHint) kbdHint.classList.remove('hidden');
    }

    function openTrialFromGlobalSearch(studentName) {
      clearDashboardGlobalSearch();
      if (typeof switchTab === 'function') {
        switchTab('tab-trials');
      }
      if (typeof filterTrialCards === 'function') {
        filterTrialCards('active');
      }
      const searchInput = document.getElementById('trialSearchInput');
      if (searchInput) {
        searchInput.value = studentName || '';
        if (typeof handleTrialSearch === 'function') {
          handleTrialSearch(studentName || '');
        }
      }
    }

    async function openFamilyFromDashboardSearch(familyId) {
      clearDashboardGlobalSearch();
      if (typeof openFamily360Profile === 'function') {
        await openFamily360Profile(familyId, 'students');
      }
    }

    // Close dashboard search dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const container = document.getElementById('dashGlobalSearchContainer');
      const panel = document.getElementById('dashGlobalSearchResultsPanel');
      if (container && panel && !container.contains(e.target)) {
        panel.classList.add('hidden');
      }
    });

    // =========================================================================
    // TOP BAR 4 NEXT-GEN ACTION BADGES & NOTIFICATION DOTS SYNC ENGINE
    // 1. Grey Arrow: Leave Over / Return Due (#btnTopCircleLeaveOver)
    // 2. Sky-Blue Arrow: Teacher Time-Change & Wrong Leave/Absent Requests (#btnTopCircleRequests)
    // 3. Green Arrow: Official Announcements (#btnTopCircleAnnouncements)
    // 4. Red Arrow: Parent Complaints & Admin Direct Reply (#btnTopCircleComplaints)
    // =========================================================================
    function getParentComplaints() {
      let list = [];
      try {
        list = JSON.parse(localStorage.getItem('alhuda_parent_complaints') || 'null');
      } catch (e) { list = null; }

      if (!Array.isArray(list)) {
        list = [
          {
            id: 'CMP-101',
            student_id: 'STD-001',
            student_name: 'Zayd Khan',
            parent_name: 'Imran Khan (FAM-001)',
            teacher_id: 'TCH-001',
            teacher_name: 'Qari Abdul Rehman',
            category: 'Class Duration (Short / Late Join)',
            message: 'Class started 6 minutes late yesterday. Please ensure full 30-minute duration for Tajweed revision.',
            created_at: '2026-09-25 18:30',
            status: 'Pending',
            admin_reply: '',
            replied_at: ''
          }
        ];
        localStorage.setItem('alhuda_parent_complaints', JSON.stringify(list));
      }
      return list;
    }

    function saveParentComplaints(list) {
      localStorage.setItem('alhuda_parent_complaints', JSON.stringify(list || []));
      if (typeof syncGlobalSharedStateToCloud === 'function') {
        syncGlobalSharedStateToCloud();
      }
      syncTopCircleNotificationDots();
    }

    function getOfficialAnnouncements() {
      let list = [];
      try {
        list = JSON.parse(localStorage.getItem('alhuda_official_announcements') || 'null');
      } catch (e) { list = null; }

      if (!Array.isArray(list)) {
        list = [
          {
            id: 'ANN-101',
            title: 'Monthly Tajweed Assessment & Punctuality Notice',
            message: 'All instructors and students are requested to join their scheduled 30-minute slots on time. Monthly Tajweed evaluations start this week.',
            target: 'both',
            created_at: '2026-09-25 09:00'
          }
        ];
        localStorage.setItem('alhuda_official_announcements', JSON.stringify(list));
      }
      return list;
    }

    function saveOfficialAnnouncements(list) {
      localStorage.setItem('alhuda_official_announcements', JSON.stringify(list || []));
      if (typeof syncGlobalSharedStateToCloud === 'function') {
        syncGlobalSharedStateToCloud();
      }
      syncTopCircleNotificationDots();
      renderPortalAnnouncementBanners();
    }

    function getLocalTeacherCorrectionRequests() {
      let list = [];
      try {
        list = JSON.parse(localStorage.getItem('alhuda_local_teacher_requests') || '[]');
      } catch (e) { list = []; }
      return Array.isArray(list) ? list : [];
    }

    function saveLocalTeacherCorrectionRequests(list) {
      localStorage.setItem('alhuda_local_teacher_requests', JSON.stringify(list || []));
      if (typeof syncGlobalSharedStateToCloud === 'function') {
        syncGlobalSharedStateToCloud();
      }
      syncTopCircleNotificationDots();
    }

    function mergeLocalTeacherRequestsIntoGlobal() {
      if (typeof PENDING_TEACHER_REQUESTS === 'undefined' || !Array.isArray(PENDING_TEACHER_REQUESTS)) {
        window.PENDING_TEACHER_REQUESTS = [];
      }
      const localReqs = getLocalTeacherCorrectionRequests();
      localReqs.forEach(item => {
        const exists = PENDING_TEACHER_REQUESTS.some(r => r.student?.id === item.student?.id && r.request?.requested_at === item.request?.requested_at);
        if (!exists) {
          PENDING_TEACHER_REQUESTS.unshift(item);
        }
      });
    }

    function syncTopCircleNotificationDots() {
      mergeLocalTeacherRequestsIntoGlobal();

      // 1. GREY ARROW: Leave Over / Return Due Alerts
      const leaveDotPing = document.getElementById('dotTopCircleLeaveOver');
      const leaveDotSolid = document.getElementById('dotTopCircleLeaveOverSolid');
      const leaveBadge = document.getElementById('badgeTopLeaveOverCount');
      let overdueLeaves = (typeof OVERDUE_LEAVE_STUDENTS !== 'undefined' && Array.isArray(OVERDUE_LEAVE_STUDENTS)) ? OVERDUE_LEAVE_STUDENTS.length : 0;
      if (overdueLeaves === 0 && typeof ALL_LEAVE_RECORDS !== 'undefined' && Array.isArray(ALL_LEAVE_RECORDS)) {
        overdueLeaves = ALL_LEAVE_RECORDS.filter(r => r.status === 'Active' || r.isOverdue).length;
      }
      const leaveKpiVal = parseInt(document.getElementById('kpiDashLeave')?.innerText || '0', 10);
      const effectiveLeaveCount = Math.max(overdueLeaves, leaveKpiVal);
      if (leaveBadge) leaveBadge.innerText = effectiveLeaveCount;
      if (leaveDotPing && leaveDotSolid) {
        if (effectiveLeaveCount > 0) {
          leaveDotPing.classList.remove('hidden');
          leaveDotSolid.classList.remove('hidden');
        } else {
          leaveDotPing.classList.add('hidden');
          leaveDotSolid.classList.add('hidden');
        }
      }

      // 2. SKY-BLUE ARROW: Teacher Time-Change & Wrong Leave/Absent Correction Requests
      const reqDot = document.getElementById('dotTopCircleRequests');
      const reqBadge = document.getElementById('badgeTopRequestsCount');
      const pendingReqs = (typeof PENDING_TEACHER_REQUESTS !== 'undefined' && Array.isArray(PENDING_TEACHER_REQUESTS)) ? PENDING_TEACHER_REQUESTS.length : 0;
      if (reqBadge) reqBadge.innerText = pendingReqs;
      if (reqDot) {
        if (pendingReqs > 0) reqDot.classList.remove('hidden');
        else reqDot.classList.add('hidden');
      }

      // 3. GREEN ARROW: Official Announcements (Teacher Portal & Student/Parent Portal)
      const annBadge = document.getElementById('badgeTopAnnouncementsCount');
      const annDot = document.getElementById('dotTopCircleAnnouncements');
      const anns = getOfficialAnnouncements();
      if (annBadge) annBadge.innerText = anns.length;
      if (annDot) {
        if (anns.length > 0) annDot.classList.remove('hidden');
        else annDot.classList.add('hidden');
      }
      renderPortalAnnouncementBanners();

      // 4. RED ARROW: Parent Complaints & Admin Direct Reply Inbox
      const compDotPing = document.getElementById('dotTopCircleComplaints');
      const compDotSolid = document.getElementById('dotTopCircleComplaintsSolid');
      const compBadge = document.getElementById('badgeTopComplaintsCount');
      const complaints = getParentComplaints();
      const pendingComplaints = complaints.filter(c => c.status !== 'Resolved').length;
      if (compBadge) compBadge.innerText = pendingComplaints;
      if (compDotPing && compDotSolid) {
        if (pendingComplaints > 0) {
          compDotPing.classList.remove('hidden');
          compDotSolid.classList.remove('hidden');
        } else {
          compDotPing.classList.add('hidden');
          compDotSolid.classList.add('hidden');
        }
      }

      const modalBadge = document.getElementById('adminComplaintsModalCountBadge');
      if (modalBadge) {
        modalBadge.innerText = `${pendingComplaints} Pending`;
      }
    }

    // =========================================================================
    // OFFICIAL ANNOUNCEMENTS BROADCAST ENGINE (GREEN MEGAPHONE ICON)
    // Linked directly to Teacher Portal & Student/Parent Portal
    // =========================================================================
    function openAdminAnnouncementsModal() {
      renderAdminAnnouncementsList();
      openModal('modalAdminAnnouncements');
    }

    function handlePublishAnnouncement(e) {
      e.preventDefault();
      const target = document.getElementById('annTargetAudience')?.value || 'both';
      const title = (document.getElementById('annTitleInput')?.value || '').trim();
      const message = (document.getElementById('annMessageInput')?.value || '').trim();

      if (!title || !message) {
        alert('Please enter both the Announcement Title and Message.');
        return;
      }

      const list = getOfficialAnnouncements();
      list.unshift({
        id: 'ANN-' + Math.floor(100 + Math.random() * 900),
        title,
        message,
        target,
        created_at: new Date().toISOString().slice(0, 16).replace('T', ' ')
      });
      saveOfficialAnnouncements(list);

      const titleEl = document.getElementById('annTitleInput');
      const msgEl = document.getElementById('annMessageInput');
      if (titleEl) titleEl.value = '';
      if (msgEl) msgEl.value = '';

      renderAdminAnnouncementsList();
      alert('Official Announcement published! It is now live on the selected Portal(s).');
    }

    function deleteOfficialAnnouncement(annId) {
      const list = getOfficialAnnouncements().filter(a => a.id !== annId);
      saveOfficialAnnouncements(list);
      renderAdminAnnouncementsList();
    }

    function renderAdminAnnouncementsList() {
      const container = document.getElementById('adminAnnouncementsListContainer');
      if (!container) return;
      const list = getOfficialAnnouncements();

      if (list.length === 0) {
        container.innerHTML = `
          <div class="p-6 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
            No active announcements published. Use the form above to broadcast an announcement to Teachers or Students/Parents.
          </div>
        `;
        return;
      }

      const targetBadgeMap = {
        'both': '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-300"><i class="fa-solid fa-globe mr-1"></i> Both Portals (Teachers &amp; Students)</span>',
        'teachers': '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-900 border border-indigo-300"><i class="fa-solid fa-chalkboard-user mr-1"></i> Teacher Portal Only</span>',
        'students': '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300"><i class="fa-solid fa-user-graduate mr-1"></i> Student / Parent Portal Only</span>'
      };

      container.innerHTML = list.map(a => `
        <div class="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs flex justify-between items-start gap-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-extrabold text-slate-900 text-xs">${a.title}</span>
              ${targetBadgeMap[a.target] || targetBadgeMap['both']}
              <span class="text-[10px] text-slate-400 font-mono">${a.created_at}</span>
            </div>
            <p class="text-xs text-slate-600 font-medium leading-relaxed">${a.message}</p>
          </div>
          <button onclick="deleteOfficialAnnouncement('${a.id}')" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 text-[11px] font-bold shrink-0 cursor-pointer">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `).join('');
    }

    function renderPortalAnnouncementBanners() {
      const bannerEl = document.getElementById('portalOfficialAnnouncementsBanner');
      if (!bannerEl) return;

      const list = getOfficialAnnouncements();
      if (!list || list.length === 0) {
        bannerEl.classList.add('hidden');
        bannerEl.innerHTML = '';
        return;
      }

      bannerEl.classList.remove('hidden');
      bannerEl.innerHTML = `
        <div class="bg-gradient-to-r from-emerald-900 via-teal-800 to-emerald-900 text-white p-3.5 rounded-xl border border-emerald-400/40 shadow-sm space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 font-extrabold text-xs text-emerald-200 uppercase tracking-wider">
              <i class="fa-solid fa-bullhorn text-amber-300 animate-bounce"></i> Official Administration Announcements (${list.length})
            </div>
            <span class="text-[10px] text-emerald-200/80 font-semibold">Live Portal Noticeboard</span>
          </div>
          <div class="space-y-1.5">
            ${list.slice(0, 3).map(a => {
              const audLabel = a.target === 'teachers' ? 'Teacher Portal' : a.target === 'students' ? 'Student/Parent Portal' : 'All Portals';
              return `
                <div class="p-2.5 rounded-lg bg-white/10 border border-white/15 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span class="px-2 py-0.5 rounded bg-emerald-400/20 text-emerald-200 font-extrabold text-[10px] mr-1.5 border border-emerald-300/30">${audLabel}</span>
                    <strong class="font-extrabold text-white">${a.title}:</strong>
                    <span class="text-emerald-50 ml-1">${a.message}</span>
                  </div>
                  <span class="text-[10px] text-emerald-200/70 font-mono">${a.created_at}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // =========================================================================
    // TEACHER PORTAL: WRONG LEAVE/ABSENT OR SCHEDULE TIME CORRECTION REQUEST
    // Directly feeds into PENDING_TEACHER_REQUESTS & Sky-Blue Arrow Icon (#btnTopCircleRequests)
    // =========================================================================
    async function openTeacherCorrectionRequestQuickModal() {
      await ensureDashboardSearchDataLoaded();
      const stuSel = document.getElementById('tchReqStudentSelect');
      if (stuSel) {
        const stus = ALL_STUDENTS || [];
        stuSel.innerHTML = `<option value="">-- Select Student --</option>` +
          stus.map(s => `<option value="${s.id}">${s.name} (${s.id})</option>`).join('') +
          `<option value="STD-001">Zayd Khan (STD-001)</option>`;
      }
      const notesInput = document.getElementById('tchReqNotesInput');
      if (notesInput) notesInput.value = '';
      toggleTeacherCorrectionRequestFields(document.getElementById('tchReqTypeSelect')?.value || 'reschedule');
      openModal('modalTeacherCorrectionRequestQuick');
    }

    function toggleTeacherCorrectionRequestFields(val) {
      const attBox = document.getElementById('tchReqAttendanceFields');
      const timeBox = document.getElementById('tchReqTimeChangeFields');
      if (val === 'time_change') {
        if (attBox) attBox.classList.add('hidden');
        if (timeBox) timeBox.classList.remove('hidden');
      } else {
        if (attBox) attBox.classList.remove('hidden');
        if (timeBox) timeBox.classList.add('hidden');
      }
    }

    async function handleSubmitTeacherCorrectionRequestQuick(e) {
      e.preventDefault();
      const rType = document.getElementById('tchReqTypeSelect')?.value || 'reschedule';
      const stuId = document.getElementById('tchReqStudentSelect')?.value || 'STD-001';
      const notes = (document.getElementById('tchReqNotesInput')?.value || '').trim();
      const todayStr = new Date().toISOString().slice(0, 10);

      let stuObj = (ALL_STUDENTS || []).find(s => s.id === stuId);
      if (!stuObj) {
        stuObj = { id: stuId, name: 'Zayd Khan', course_id: 'Tajweed & Quran', teachers: { full_name: 'Qari Abdul Rehman' } };
      }

      let requestPayload = {};
      if (rType === 'time_change') {
        const oldSlot = document.getElementById('tchReqOldTime')?.value || '15:00 - 15:30';
        const newSlot = document.getElementById('tchReqNewTime')?.value || '16:30 - 17:00';
        requestPayload = {
          type: 'time_change',
          old_slot_label: oldSlot,
          new_slot_label: newSlot,
          old_start_time: oldSlot.split('-')[0]?.trim() || '15:00',
          old_end_time: oldSlot.split('-')[1]?.trim() || '15:30',
          new_start_time: newSlot.split('-')[0]?.trim() || '16:30',
          new_end_time: newSlot.split('-')[1]?.trim() || '17:00',
          scope: 'permanent',
          reason: 'Teacher Schedule Time Adjustment',
          notes: notes || 'Requested new class time slot.',
          requested_at: new Date().toISOString(),
          requested_by: 'Teacher Portal'
        };
      } else {
        const oldSt = document.getElementById('tchReqOldStatus')?.value || 'Leave';
        const newSt = document.getElementById('tchReqNewStatus')?.value || 'Present';
        requestPayload = {
          type: 'reschedule',
          date: todayStr,
          old_status: oldSt,
          new_status: newSt,
          reason: `Marked ${oldSt} by mistake — Requesting change to ${newSt} (${notes})`,
          requested_at: new Date().toISOString(),
          requested_by: 'Teacher Portal'
        };
      }

      // Also persist to student.notes if real student in DB so approveTeacherRequest works natively
      try {
        if (stuObj.id && stuObj.id !== 'STD-001') {
          let meta = {};
          if (stuObj.notes) {
            try { meta = JSON.parse(stuObj.notes); } catch (err) { meta = {}; }
          }
          if (rType === 'time_change') meta.pending_time_change_request = requestPayload;
          else meta.pending_reschedule_request = requestPayload;
          await db.from('students').update({ notes: JSON.stringify(meta) }).eq('id', stuObj.id);
        }
      } catch (err) {}

      const newEntry = {
        student: stuObj,
        request: requestPayload,
        requestType: rType,
        meta: {}
      };

      const localList = getLocalTeacherCorrectionRequests();
      localList.unshift(newEntry);
      saveLocalTeacherCorrectionRequests(localList);
      mergeLocalTeacherRequestsIntoGlobal();
      syncTopCircleNotificationDots();

      closeModal('modalTeacherCorrectionRequestQuick');
      alert('Request sent to Admin Portal! The Sky-Blue Teacher Requests badge in the Admin Top Bar is now active for 1-click Admin approval.');
    }

    // =========================================================================
    // PARENT / STUDENT PORTAL COMPLAINT SUBMISSION & ADMIN DIRECT REPLY ENGINE
    // =========================================================================
    async function openParentComplaintSubmitModal() {
      await ensureDashboardSearchDataLoaded();

      const stuSel = document.getElementById('compStudentSelect');
      const tchSel = document.getElementById('compTeacherSelect');

      if (stuSel) {
        const stus = ALL_STUDENTS || [];
        stuSel.innerHTML = `<option value="">-- Select Student --</option>` +
          stus.map(s => `<option value="${s.id}">${s.name} (${s.id})</option>`).join('') +
          `<option value="STD-DEMO">General / Portal Student</option>`;
      }

      if (tchSel) {
        const tchs = (typeof getEligibleTeachers === 'function') ? getEligibleTeachers(ALL_TEACHERS) : (ALL_TEACHERS || []);
        tchSel.innerHTML = `<option value="">-- Select Teacher --</option>` +
          tchs.map(t => `<option value="${t.id}">${t.full_name}</option>`).join('') +
          `<option value="TCH-DEMO">Assigned Course Instructor</option>`;
      }

      const msgEl = document.getElementById('compMessageInput');
      if (msgEl) msgEl.value = '';

      renderParentComplaintRepliesHistory();
      openModal('modalSubmitParentComplaint');
    }

    function renderParentComplaintRepliesHistory() {
      const container = document.getElementById('parentComplaintRepliesHistoryContainer');
      if (!container) return;

      const list = getParentComplaints();
      if (list.length === 0) {
        container.innerHTML = `<div class="p-4 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">No complaints submitted yet.</div>`;
        return;
      }

      container.innerHTML = list.map(c => {
        const isResolved = c.status === 'Resolved';
        return `
          <div class="p-3.5 rounded-xl bg-white border ${isResolved ? 'border-emerald-300 bg-emerald-50/20' : 'border-slate-200'} space-y-2 shadow-2xs">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2">
                <span class="font-mono text-[10px] font-black px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">${c.id}</span>
                <span class="font-extrabold text-slate-800 text-xs">${c.category}</span>
                <span class="text-[10px] text-slate-400 font-mono">${c.created_at}</span>
              </div>
              ${isResolved
                ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300"><i class="fa-solid fa-circle-check mr-1"></i> Resolved by Admin</span>`
                : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">Under Admin Review</span>`
              }
            </div>
            <div class="text-xs text-slate-700 font-medium">"${c.message}"</div>
            ${c.admin_reply ? `
              <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-0.5">
                <div class="text-[10px] font-black uppercase tracking-wider text-emerald-800 flex items-center justify-between">
                  <span><i class="fa-solid fa-reply text-emerald-600 mr-1"></i> Official Admin Reply to Parent:</span>
                  <span class="font-mono text-[9px] text-emerald-700">${c.replied_at || ''}</span>
                </div>
                <div class="text-xs font-bold text-emerald-950">${c.admin_reply}</div>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    }

    function handleComplaintStudentChange(studentId) {
      if (!studentId) return;
      const stu = (ALL_STUDENTS || []).find(s => s.id === studentId);
      if (!stu) return;
      const tchSel = document.getElementById('compTeacherSelect');
      if (tchSel && stu.assigned_teacher_id) {
        tchSel.value = stu.assigned_teacher_id;
      }
      const fam = (ALL_FAMILIES || []).find(f => f.id === stu.family_id);
      const parentInput = document.getElementById('compParentNameInput');
      if (parentInput && fam) {
        parentInput.value = `${fam.parent_name} (${fam.id})`;
      }
    }

    function handleSubmitParentComplaint(e) {
      e.preventDefault();
      const stuId = document.getElementById('compStudentSelect')?.value || 'STD-001';
      const tchId = document.getElementById('compTeacherSelect')?.value || 'TCH-001';
      const category = document.getElementById('compCategorySelect')?.value || 'Teacher Performance / Behavior';
      const parentName = (document.getElementById('compParentNameInput')?.value || '').trim() || 'Parent Portal User';
      const message = (document.getElementById('compMessageInput')?.value || '').trim();

      if (!message) {
        alert('Please enter complaint details.');
        return;
      }

      const stuObj = (ALL_STUDENTS || []).find(s => s.id === stuId);
      const tchObj = (ALL_TEACHERS || []).find(t => t.id === tchId);

      const newComp = {
        id: 'CMP-' + Math.floor(100 + Math.random() * 900),
        student_id: stuId,
        student_name: stuObj ? stuObj.name : 'Student (' + stuId + ')',
        parent_name: parentName,
        teacher_id: tchId,
        teacher_name: tchObj ? tchObj.full_name : 'Assigned Teacher',
        category,
        message,
        created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
        status: 'Pending',
        admin_reply: '',
        replied_at: ''
      };

      const list = getParentComplaints();
      list.unshift(newComp);
      saveParentComplaints(list);

      const msgEl = document.getElementById('compMessageInput');
      if (msgEl) msgEl.value = '';
      renderParentComplaintRepliesHistory();
      alert('Your complaint has been sent directly to the Admin Portal! You can track the Admin reply right below.');
    }

    function openAdminParentComplaintsModal() {
      renderAdminParentComplaintsList();
      openModal('modalAdminParentComplaints');
    }

    function renderAdminParentComplaintsList() {
      const container = document.getElementById('adminParentComplaintsListContainer');
      if (!container) return;

      const list = getParentComplaints();
      syncTopCircleNotificationDots();

      if (list.length === 0) {
        container.innerHTML = `
          <div class="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
            <i class="fa-solid fa-circle-check text-3xl text-emerald-400 mb-2 block"></i>
            <div class="font-bold text-slate-700 text-sm">No Parent Complaints Found</div>
            <p class="text-xs text-slate-500 mt-1">All parent and student feedback tickets have been resolved.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = list.map(c => {
        const isPending = c.status !== 'Resolved';
        const statusBadge = isPending
          ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-rose-600 animate-ping"></span> Pending Action</span>`
          : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300"><i class="fa-solid fa-check mr-1"></i> Resolved &amp; Replied</span>`;

        const defaultReplyText = c.admin_reply || 'Your complaint has been resolved and our Administration team has taken immediate action with the instructor.';

        return `
          <div class="p-4 rounded-2xl bg-white border-2 ${isPending ? 'border-rose-200 shadow-xs' : 'border-emerald-200/80'} transition space-y-3">
            <div class="flex flex-wrap justify-between items-start gap-2">
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono text-[10px] font-black px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">${c.id}</span>
                  <span class="px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold bg-amber-50 text-amber-900 border border-amber-200">
                    <i class="fa-solid fa-tag mr-1 text-amber-600"></i> ${c.category}
                  </span>
                  <span class="text-[11px] text-slate-400 font-mono">${c.created_at}</span>
                </div>
                <div class="text-xs font-extrabold text-slate-900 mt-1.5">
                  Student: <span class="text-brandDark">${c.student_name}</span> &bull;
                  Parent: <span class="text-slate-700">${c.parent_name}</span> &bull;
                  Regarding Teacher: <span class="text-rose-700 underline">${c.teacher_name}</span>
                </div>
              </div>
              <div class="flex items-center gap-2">
                ${statusBadge}
              </div>
            </div>

            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-800 font-medium leading-relaxed">
              "${c.message}"
            </div>

            <!-- ADMIN DIRECT REPLY TO PARENT PORTAL BOX -->
            <div class="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-2">
              <label class="block text-[11px] font-extrabold text-emerald-950">
                <i class="fa-solid fa-reply text-emerald-600 mr-1"></i> Official Admin Reply to Parent (Sent to Parent Portal):
              </label>
              <div class="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  id="adminReplyInput_${c.id}"
                  value="${defaultReplyText.replace(/"/g, '&quot;')}"
                  placeholder="Type official reply to parent..."
                  class="flex-1 p-2 rounded-xl border border-emerald-300 bg-white text-xs font-semibold text-slate-800 focus:outline-emerald-600"
                />
                <button
                  type="button"
                  onclick="replyToParentComplaint('${c.id}')"
                  class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-extrabold shadow-2xs transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <i class="fa-solid fa-paper-plane"></i> ${isPending ? 'Send Reply & Resolve' : 'Update Reply'}
                </button>
                <button
                  type="button"
                  onclick="deleteParentComplaint('${c.id}')"
                  class="px-3 py-2 bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-200 rounded-xl text-[11px] font-bold transition shrink-0 cursor-pointer"
                  title="Delete Complaint"
                >
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    function replyToParentComplaint(compId) {
      const inputEl = document.getElementById('adminReplyInput_' + compId);
      const replyMsg = (inputEl ? inputEl.value : '').trim() || 'Your complaint has been resolved by Administration.';
      const list = getParentComplaints();
      const item = list.find(c => c.id === compId);
      if (item) {
        item.status = 'Resolved';
        item.admin_reply = replyMsg;
        item.replied_at = new Date().toISOString().slice(0, 16).replace('T', ' ');
        saveParentComplaints(list);
        renderAdminParentComplaintsList();
        renderParentComplaintRepliesHistory();
        alert('Official reply sent to Parent Portal and complaint marked Resolved!');
      }
    }

    function resolveParentComplaint(compId) {
      replyToParentComplaint(compId);
    }

    function deleteParentComplaint(compId) {
      const list = getParentComplaints().filter(c => c.id !== compId);
      saveParentComplaints(list);
      renderAdminParentComplaintsList();
      renderParentComplaintRepliesHistory();
    }

    // =========================================================================
    // GRAPH MONTH DRILL-DOWN BACK-END DATA VIEWER (CLICK ANY BAR IN CHART)
    // Opens exact monthly records for: Scheduled Trial, Regular Enrolled, Left,
    // or Monthly Fee Target / Received / Pending
    // =========================================================================
    async function openGraphMonthDrilldownModal(monthIdx, category) {
      await ensureDashboardSearchDataLoaded();

      const safeIdx = (typeof monthIdx === 'number' && monthIdx >= 0 && monthIdx <= 11) ? monthIdx : 8;
      const monthLabel = GRAPH_MONTH_LABELS[safeIdx] || 'Sep-2026';
      const monthNumStr = String(safeIdx + 1).padStart(2, '0');

      const iconBoxEl = document.getElementById('graphDrilldownIconBox');
      const titleEl = document.getElementById('graphDrilldownTitle');
      const subEl = document.getElementById('graphDrilldownSubtitle');
      const tabsEl = document.getElementById('graphDrilldownCategoryTabs');
      const theadEl = document.getElementById('graphDrilldownTableHead');
      const tbodyEl = document.getElementById('graphDrilldownTableBody');
      const footerNoteEl = document.getElementById('graphDrilldownFooterNote');

      const isFeeCategory = String(category).startsWith('fee_');

      if (!isFeeCategory) {
        const tCount = DASH_STUDENT_CHART ? DASH_STUDENT_CHART.data.datasets[0].data[safeIdx] : BASELINE_SIGNUP_DATA.trial[safeIdx];
        const rCount = DASH_STUDENT_CHART ? DASH_STUDENT_CHART.data.datasets[1].data[safeIdx] : BASELINE_SIGNUP_DATA.regular[safeIdx];
        const lCount = DASH_STUDENT_CHART ? DASH_STUDENT_CHART.data.datasets[2].data[safeIdx] : BASELINE_SIGNUP_DATA.left[safeIdx];

        if (tabsEl) {
          tabsEl.innerHTML = `
            <button onclick="openGraphMonthDrilldownModal(${safeIdx}, 'trial')" class="px-3.5 py-1.5 rounded-lg text-xs font-extrabold border-2 transition cursor-pointer ${category === 'trial' ? 'bg-[#6366f1] text-white border-[#4f46e5] shadow-xs' : 'bg-white text-slate-700 border-[#6366f1] hover:bg-indigo-50'}">
              Scheduled Trial in ${monthLabel}: ${tCount}
            </button>
            <button onclick="openGraphMonthDrilldownModal(${safeIdx}, 'regular')" class="px-3.5 py-1.5 rounded-lg text-xs font-extrabold border-2 transition cursor-pointer ${category === 'regular' ? 'bg-[#14b8a6] text-white border-[#0d9488] shadow-xs' : 'bg-white text-slate-700 border-[#14b8a6] hover:bg-teal-50'}">
              Regular Enrolled in ${monthLabel}: ${rCount}
            </button>
            <button onclick="openGraphMonthDrilldownModal(${safeIdx}, 'left')" class="px-3.5 py-1.5 rounded-lg text-xs font-extrabold border-2 transition cursor-pointer ${category === 'left' ? 'bg-[#f59e0b] text-white border-[#d97706] shadow-xs' : 'bg-white text-slate-700 border-[#f59e0b] hover:bg-amber-50'}">
              Left in ${monthLabel}: ${lCount}
            </button>
          `;
        }

        const metaConfig = {
          'trial': {
            title: `Scheduled Trial Students in ${monthLabel}`,
            sub: `Showing prospective trial students entered/scheduled during ${monthLabel}`,
            iconBg: 'bg-[#6366f1] text-white',
            badgeClass: 'bg-indigo-100 text-indigo-900 border-indigo-300',
            statusLabel: 'Scheduled Trial',
            targetTotal: tCount
          },
          'regular': {
            title: `Regular Enrolled Students in ${monthLabel}`,
            sub: `Showing students who enrolled and started regular classes in ${monthLabel}`,
            iconBg: 'bg-[#14b8a6] text-white',
            badgeClass: 'bg-teal-100 text-teal-900 border-teal-300',
            statusLabel: 'Regular Enrolled',
            targetTotal: rCount
          },
          'left': {
            title: `Left / Discontinued Students in ${monthLabel}`,
            sub: `Showing students who left or paused classes during ${monthLabel}`,
            iconBg: 'bg-[#f59e0b] text-white',
            badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
            statusLabel: 'Left LMS',
            targetTotal: lCount
          }
        }[category] || {
          title: `Students Report (${monthLabel})`,
          sub: `Monthly student records`,
          iconBg: 'bg-teal-600 text-white',
          badgeClass: 'bg-teal-100 text-teal-900 border-teal-300',
          statusLabel: 'Active',
          targetTotal: rCount
        };

        if (titleEl) titleEl.innerText = metaConfig.title;
        if (subEl) subEl.innerText = metaConfig.sub;
        if (iconBoxEl) iconBoxEl.className = `w-10 h-10 rounded-xl ${metaConfig.iconBg} flex items-center justify-center text-base font-black`;

        if (theadEl) {
          theadEl.innerHTML = `
            <tr>
              <th class="p-3">#</th>
              <th class="p-3">Student ID</th>
              <th class="p-3">Student Name</th>
              <th class="p-3">Parent / Family</th>
              <th class="p-3">Course</th>
              <th class="p-3">Assigned Teacher</th>
              <th class="p-3">Date (${monthLabel})</th>
              <th class="p-3">Status</th>
            </tr>
          `;
        }

        const rows = [];
        const realStudents = (ALL_STUDENTS || []);
        const realTeachers = (ALL_TEACHERS || []);
        const realFamilies = (ALL_FAMILIES || []);

        realStudents.forEach((s) => {
          let pNotes = {};
          try { if (s.notes) pNotes = typeof s.notes === 'string' ? JSON.parse(s.notes) : s.notes; } catch (e) {}
          const statusLower = String(s.status || 'Active').toLowerCase();
          const isLeft = statusLower === 'left' || statusLower === 'inactive' || statusLower === 'deactivated';
          const isTrial = statusLower === 'trial' && !pNotes.converted_from_trial;

          const joinDateStr = s.joining_date || pNotes.joining_date || (s.created_at ? String(s.created_at).slice(0, 10) : '');
          const deactDateStr = s.deactivation_date || pNotes.deactivation_date || pNotes.left_date || (s.updated_at ? String(s.updated_at).slice(0, 10) : joinDateStr);
          const checkDateStr = category === 'left' ? deactDateStr : joinDateStr;

          if (checkDateStr) {
            const d = new Date(checkDateStr);
            if (!isNaN(d.getTime()) && d.getMonth() !== safeIdx) return;
          }

          const fam = realFamilies.find(f => String(f.id) === String(s.family_id));
          const tch = realTeachers.find(t => String(t.id) === String(s.assigned_teacher_id));
          const parentDisplay = fam ? `${fam.parent_name} (${fam.id})` : (s.family_id || '-');
          const teacherDisplay = tch ? tch.full_name : 'Unassigned';

          if (category === 'left' && isLeft) {
            rows.push({
              id: s.id,
              name: s.name,
              parent: parentDisplay,
              course: s.course_id || s.course || '-',
              teacher: teacherDisplay,
              date: deactDateStr || '-',
              isRealId: s.id
            });
          } else if (category === 'regular' && !isLeft && !isTrial) {
            rows.push({
              id: s.id,
              name: s.name,
              parent: parentDisplay,
              course: s.course_id || s.course || '-',
              teacher: teacherDisplay,
              date: joinDateStr || '-',
              isRealId: s.id
            });
          } else if (category === 'trial' && isTrial) {
            rows.push({
              id: s.id,
              name: s.name,
              parent: parentDisplay,
              course: s.course_id || s.course || 'Trial Evaluation',
              teacher: teacherDisplay,
              date: joinDateStr || '-',
              isRealId: s.id
            });
          }
        });

        if (tbodyEl) {
          if (rows.length === 0) {
            tbodyEl.innerHTML = `
              <tr>
                <td colspan="8" class="p-8 text-center text-slate-400 font-bold text-xs">
                  No data available yet.
                </td>
              </tr>
            `;
          } else {
            tbodyEl.innerHTML = rows.map((r, i) => `
              <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono font-bold text-slate-400">${i + 1}</td>
                <td class="p-3 font-mono font-black text-brandDark">${r.id}</td>
                <td class="p-3 font-extrabold text-slate-900">
                  ${r.isRealId ? `<button onclick="closeModal('modalGraphMonthDrilldown'); openStudentDetailModal('${r.isRealId}')" class="hover:text-brandEmerald hover:underline text-left">${r.name}</button>` : r.name}
                </td>
                <td class="p-3 text-slate-700 font-semibold">${r.parent}</td>
                <td class="p-3"><span class="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-bold text-[11px] text-slate-700">${r.course}</span></td>
                <td class="p-3 font-bold text-slate-700">${r.teacher}</td>
                <td class="p-3 font-mono text-slate-600">${r.date}</td>
                <td class="p-3">
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${metaConfig.badgeClass}">
                    ${metaConfig.statusLabel}
                  </span>
                </td>
              </tr>
            `).join('');
          }
        }

        if (footerNoteEl) {
          footerNoteEl.innerText = rows.length > 0
            ? `Showing ${rows.length} verified records for ${metaConfig.title}`
            : `No data available yet.`;
        }

      } else {
        const tgtVal = DASH_REVENUE_CHART ? DASH_REVENUE_CHART.data.datasets[0].data[safeIdx] : BASELINE_FEE_DATA.target[safeIdx];
        const recVal = DASH_REVENUE_CHART ? DASH_REVENUE_CHART.data.datasets[1].data[safeIdx] : BASELINE_FEE_DATA.received[safeIdx];
        const pndVal = DASH_REVENUE_CHART ? DASH_REVENUE_CHART.data.datasets[2].data[safeIdx] : BASELINE_FEE_DATA.pending[safeIdx];

        if (tabsEl) {
          tabsEl.innerHTML = `
            <button onclick="openGraphMonthDrilldownModal(${safeIdx}, 'fee_target')" class="px-3.5 py-1.5 rounded-lg text-xs font-extrabold border-2 transition cursor-pointer ${category === 'fee_target' ? 'bg-[#6366f1] text-white border-[#4f46e5] shadow-xs' : 'bg-white text-slate-700 border-[#6366f1] hover:bg-indigo-50'}">
              Target Fee in ${monthLabel}: $${Number(tgtVal).toLocaleString()}
            </button>
            <button onclick="openGraphMonthDrilldownModal(${safeIdx}, 'fee_paid')" class="px-3.5 py-1.5 rounded-lg text-xs font-extrabold border-2 transition cursor-pointer ${category === 'fee_paid' ? 'bg-[#14b8a6] text-white border-[#0d9488] shadow-xs' : 'bg-white text-slate-700 border-[#14b8a6] hover:bg-teal-50'}">
              Received in ${monthLabel}: $${Number(recVal).toLocaleString()}
            </button>
            <button onclick="openGraphMonthDrilldownModal(${safeIdx}, 'fee_pending')" class="px-3.5 py-1.5 rounded-lg text-xs font-extrabold border-2 transition cursor-pointer ${category === 'fee_pending' ? 'bg-[#f59e0b] text-white border-[#d97706] shadow-xs' : 'bg-white text-slate-700 border-[#f59e0b] hover:bg-amber-50'}">
              Pending in ${monthLabel}: $${Number(pndVal).toLocaleString()}
            </button>
          `;
        }

        if (titleEl) titleEl.innerText = `Monthly Tuition Fee Ledger — ${monthLabel}`;
        if (subEl) subEl.innerText = `Family billing & collection records for ${monthLabel}`;

        if (theadEl) {
          theadEl.innerHTML = `
            <tr>
              <th class="p-3">#</th>
              <th class="p-3">Family ID</th>
              <th class="p-3">Parent / Guardian</th>
              <th class="p-3">Country</th>
              <th class="p-3">Monthly Fee</th>
              <th class="p-3">Billing Month</th>
              <th class="p-3">Payment Status</th>
            </tr>
          `;
        }

        const fams = Array.isArray(ALL_FAMILIES) ? ALL_FAMILIES : [];

        const statusLabel = category === 'fee_pending' ? 'Pending Due' : 'Paid / Verified';
        const badgeCls = category === 'fee_pending'
          ? 'bg-amber-100 text-amber-900 border-amber-300'
          : 'bg-teal-100 text-teal-900 border-teal-300';

        if (tbodyEl) {
          if (fams.length === 0) {
            tbodyEl.innerHTML = `
              <tr>
                <td colspan="7" class="p-8 text-center text-slate-400 font-bold text-xs">
                  No data available yet.
                </td>
              </tr>
            `;
          } else {
            tbodyEl.innerHTML = fams.map((f, i) => `
              <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono font-bold text-slate-400">${i + 1}</td>
                <td class="p-3 font-mono font-black text-brandDark">${f.id}</td>
                <td class="p-3 font-extrabold text-slate-900">${f.parent_name}</td>
                <td class="p-3 text-slate-600 font-semibold">${f.country || '-'}</td>
                <td class="p-3 font-mono font-black text-emerald-800">${f.currency || 'USD'} ${f.monthly_fee ?? 0}</td>
                <td class="p-3 font-mono text-slate-600">${monthLabel}</td>
                <td class="p-3">
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${badgeCls}">
                    ${f.fee_status || statusLabel}
                  </span>
                </td>
              </tr>
            `).join('');
          }
        }

        if (footerNoteEl) {
          footerNoteEl.innerText = fams.length > 0
            ? `Showing ${fams.length} family billing records for ${monthLabel}`
            : `No data available yet.`;
        }
      }

      openModal('modalGraphMonthDrilldown');
    }

    // Initialize Top Bar Badges & Portal Announcement Banners on script load
    setTimeout(() => {
      if (typeof syncTopCircleNotificationDots === 'function') {
        syncTopCircleNotificationDots();
      }
    }, 600);



