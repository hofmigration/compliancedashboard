// ══════════════════════════════════════════════════════════════════
//  CONSULTANTS ACTIVITY (HubSpot) — left-rail drawer
//  Two sub-tabs (like the Case Manager tab):
//    1) Performance Compliance   2) Activity Compliance
//  Graph-driven (Chart.js), theme-aware, with a day/custom/all filter.
// ══════════════════════════════════════════════════════════════════
const HS_API = 'https://script.google.com/macros/s/AKfycbzn_ngRUlGOV9S9iDkY67QWBcB2DuNSdKD2qjoTJShpyU3GtL_CQ9JYd2Mr4SPJ4-N_BA/exec';

var hsOpen   = false;
var hsLoaded = false;
var hsData   = null;
var hsRange  = { days: '7' };
var hsTab    = 'perf';            // 'perf' | 'activity'
var hsCharts = {};

function toggleHSReport() {
  hsOpen = !hsOpen;
  var d = document.getElementById('hsDrawer'), o = document.getElementById('hsOverlay');
  if (d) d.style.left = hsOpen ? '0' : '-1040px';
  if (o) o.style.display = hsOpen ? 'block' : 'none';
  if (hsOpen && !hsLoaded) { hsLoaded = true; hsLoad(); }
}

// ── Sub-tabs ──────────────────────────────────────────────────────
function hsSetTab(tab) {
  hsTab = tab;
  var p = document.getElementById('hs-st-perf'), a = document.getElementById('hs-st-act');
  if (p) p.classList.toggle('on', tab === 'perf');
  if (a) a.classList.toggle('on', tab === 'activity');
  hsRenderTab();
}

// ── Date filter ───────────────────────────────────────────────────
function hsSetRange(kind) {
  if (kind === 'custom') {
    var box = document.getElementById('hs-custom');
    if (box) box.style.display = (box.style.display === 'flex') ? 'none' : 'flex';
    return;
  }
  hsRange = { days: kind };
  hsMarkChip(kind);
  var box2 = document.getElementById('hs-custom'); if (box2) box2.style.display = 'none';
  hsLoad();
}
function hsApplyCustom() {
  var s = (document.getElementById('hs-cstart') || {}).value;
  var e = (document.getElementById('hs-cend') || {}).value;
  if (!s || !e) return;
  hsRange = { custom: { start: s, end: e } };
  hsMarkChip('custom');
  hsLoad();
}
function hsMarkChip(kind) {
  document.querySelectorAll('#hs-win .hs-chip').forEach(function (c) {
    c.classList.toggle('on', c.getAttribute('data-r') === kind);
  });
}
function hsRefresh() { hsLoad(true); }

// ── Fetch ─────────────────────────────────────────────────────────
function hsLoad(force) {
  var body = document.getElementById('hs-body');
  var sub  = document.getElementById('hs-sub');
  if (sub) sub.textContent = 'Loading from HubSpot…';
  hsDestroy();
  if (body) body.innerHTML =
    '<div class="hs-loading"><div class="hs-spin"></div>' +
    '<div>Counting activity across consultants…<br><span class="hs-mu">First load can take ~30–45s, then it\'s cached.</span></div></div>';

  var q = hsRange.custom
    ? 'cstart=' + encodeURIComponent(hsRange.custom.start) + '&cend=' + encodeURIComponent(hsRange.custom.end)
    : 'days=' + hsRange.days;
  var url = HS_API + '?' + q + (force ? '&refresh=1' : '');

  fetch(url, { redirect: 'follow' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (t) {
      if (!t || t.trim() === '') throw new Error('Empty response');
      if (t.trim().charAt(0) === '<') throw new Error('Got HTML not JSON — redeploy the script (Execute as Me, Anyone)');
      var j = JSON.parse(t);
      if (!j.ok) throw new Error(j.error || 'Script error');
      hsData = j;
      var sb = document.getElementById('hs-sub');
      if (sb) {
        var when = ''; try { when = new Date(j.generatedAt).toLocaleString(); } catch (e) {}
        sb.textContent = (j.owners ? j.owners.length : 0) + ' consultants · ' + (j.rangeLabel || '') + ' · updated ' + when;
      }
      hsRenderTab();
    })
    .catch(function (e) {
      hsDestroy();
      if (body) body.innerHTML = '<div class="hs-err">⚠️ ' + hsEsc(e.message) + '</div>';
      if (sub) sub.textContent = 'Error';
    });
}

// ── Data helpers ──────────────────────────────────────────────────
function hsLookup(key) { var m = {}; ((hsData.widgets || {})[key] || []).forEach(function (r) { m[r.id] = r.count; }); return m; }
function hsSum(key) { return ((hsData.widgets || {})[key] || []).reduce(function (s, r) { return s + (r.count || 0); }, 0); }
function hsSingle(key) { return (((hsData.widgets || {})[key]) || []).slice().sort(function (a, b) { return b.count - a.count; }); }
function hsMerge(keyA, keyB) {
  var a = hsLookup(keyA), b = hsLookup(keyB);
  return (hsData.owners || []).map(function (o) { return { name: o.name, a: a[o.id] || 0, b: b[o.id] || 0 }; })
    .sort(function (x, y) { return (y.a + y.b) - (x.a + x.b); });
}

// theme colors at render time
function hsCV(n, fb) { try { var v = getComputedStyle(document.body).getPropertyValue(n).trim(); return v || fb; } catch (e) { return fb; } }
function hsHex(c, al) { c = (c || '').trim(); var m = c.match(/^#?([0-9a-f]{6})$/i); if (m) { var n = parseInt(m[1], 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + al + ')'; } return c; }
function hsAxis() {
  return { tx: hsCV('--t2', '#64748b'), grid: hsCV('--b', 'rgba(0,0,0,.08)'),
           font: { family: "'Plus Jakarta Sans',sans-serif", size: 11 } };
}
function hsDestroy() { Object.keys(hsCharts).forEach(function (k) { if (hsCharts[k]) { hsCharts[k].destroy(); hsCharts[k] = null; } }); hsCharts = {}; }
function hsBoxH(n, per, base) { return Math.max(200, n * (per || 24) + (base || 50)); }

// ── Render the active tab ─────────────────────────────────────────
function hsRenderTab() {
  if (!hsData) return;
  hsDestroy();
  if (hsTab === 'perf') hsRenderPerf(); else hsRenderActivity();
}

function hsKpi(v, l, color) {
  return '<div class="hs-kpi"><div class="hs-kpi-v"' + (color ? ' style="color:' + color + '"' : '') + '>' + v + '</div><div class="hs-kpi-l">' + l + '</div></div>';
}

// PERFORMANCE COMPLIANCE
function hsRenderPerf() {
  var body = document.getElementById('hs-body'); if (!body) return;
  var won = hsSingle('dealsWon'), tasks = hsMerge('tasksCompleted', 'overdueTasks');
  var ac = hsCV('--ac', '#243a9e'), grn = hsCV('--grn', '#10b981'), red = hsCV('--red', '#ef4444');

  body.innerHTML =
    '<div class="hs-kpis">' +
      hsKpi(hsSum('dealsWon'), 'Deals won', grn) +
      hsKpi(hsSum('totalContacts'), 'Total contacts') +
      hsKpi(hsSum('tasksCompleted'), 'Tasks completed') +
      hsKpi(hsSum('overdueTasks'), 'Overdue tasks', red) +
    '</div>' +
    chartCard('Deals won by consultant', 'hsc-won', hsBoxH(won.filter(function (x) { return x.count; }).length || won.length)) +
    chartCard('Tasks — done vs overdue by consultant', 'hsc-tasks', hsBoxH(tasks.length, 30, 60)) +
    '<div class="hs-grid2">' +
      chartCard('Lead-stage mix (all consultants)', 'hsc-lead', 320, true) +
      chartCard('Contacts by consultant', 'hsc-contacts', 320, true) +
    '</div>' +
    '<div class="hs-sec-h">Lead stage by consultant</div>' +
    '<div class="hs-tablewrap">' + hsLeadTable() + '</div>';

  var ax = hsAxis();
  // Deals won
  hsBar('hsc-won', won.map(function (x) { return x.name; }), won.map(function (x) { return x.count; }), grn, ax);
  // Tasks done vs overdue (grouped)
  hsGrouped('hsc-tasks', tasks.map(function (x) { return x.name; }),
    [{ label: 'Done', data: tasks.map(function (x) { return x.a; }), color: grn },
     { label: 'Overdue', data: tasks.map(function (x) { return x.b; }), color: red }], ax);
  // Lead-stage donut
  var st = (hsData.leadStageMatrix && hsData.leadStageMatrix.stageTotals) || {};
  var keys = Object.keys(st).sort(function (a, b) { return st[b] - st[a]; });
  hsDonut('hsc-lead', keys, keys.map(function (k) { return st[k]; }), ac, ax);
  // Contacts bar
  var contacts = hsSingle('totalContacts');
  hsBar('hsc-contacts', contacts.map(function (x) { return x.name; }), contacts.map(function (x) { return x.count; }), ac, ax);
}

// ACTIVITY COMPLIANCE
function hsRenderActivity() {
  var body = document.getElementById('hs-body'); if (!body) return;
  var outreach = hsMerge('calls', 'emails'), created = hsMerge('dealsCreated', 'tasksCreated');
  var ac = hsCV('--ac', '#243a9e'), amb = hsCV('--amb', '#f59e0b'), grn = hsCV('--grn', '#10b981');

  body.innerHTML =
    '<div class="hs-kpis">' +
      hsKpi(hsSum('calls'), 'Calls') +
      hsKpi(hsSum('emails'), 'Emails sent') +
      hsKpi(hsSum('dealsCreated'), 'Deals created') +
      hsKpi(hsSum('tasksCreated'), 'Tasks created') +
    '</div>' +
    chartCard('Outreach by consultant — Calls vs Emails', 'hsc-outreach', hsBoxH(outreach.length, 30, 60)) +
    chartCard('Created by consultant — Deals vs Tasks', 'hsc-created', hsBoxH(created.length, 30, 60));

  var ax = hsAxis();
  hsGrouped('hsc-outreach', outreach.map(function (x) { return x.name; }),
    [{ label: 'Calls', data: outreach.map(function (x) { return x.a; }), color: ac },
     { label: 'Emails', data: outreach.map(function (x) { return x.b; }), color: amb }], ax);
  hsGrouped('hsc-created', created.map(function (x) { return x.name; }),
    [{ label: 'Deals created', data: created.map(function (x) { return x.a; }), color: grn },
     { label: 'Tasks created', data: created.map(function (x) { return x.b; }), color: ac }], ax);
}

function chartCard(title, canvasId, h, inGrid) {
  return '<div class="hs-chart-card' + (inGrid ? ' hs-incol' : '') + '">' +
    '<div class="hs-chart-h">' + hsEsc(title) + '</div>' +
    '<div class="hs-cbox" style="height:' + h + 'px"><canvas id="' + canvasId + '"></canvas></div></div>';
}

// ── Chart builders ────────────────────────────────────────────────
function hsBar(id, labels, data, color, ax) {
  var c = document.getElementById(id); if (!c || typeof Chart === 'undefined') return;
  hsCharts[id] = new Chart(c, {
    type: 'bar',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: color, borderRadius: 5, barThickness: 13, maxBarThickness: 16 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { color: ax.tx, font: ax.font, precision: 0 }, grid: { color: ax.grid } },
        y: { ticks: { color: ax.tx, font: ax.font }, grid: { display: false } }
      }
    }
  });
}
function hsGrouped(id, labels, series, ax) {
  var c = document.getElementById(id); if (!c || typeof Chart === 'undefined') return;
  hsCharts[id] = new Chart(c, {
    type: 'bar',
    data: { labels: labels, datasets: series.map(function (s) { return { label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 4, barThickness: 9, maxBarThickness: 11 }; }) },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { color: ax.tx, font: ax.font, boxWidth: 12, padding: 12 } } },
      scales: {
        x: { beginAtZero: true, ticks: { color: ax.tx, font: ax.font, precision: 0 }, grid: { color: ax.grid } },
        y: { ticks: { color: ax.tx, font: ax.font }, grid: { display: false } }
      }
    }
  });
}
function hsDonut(id, labels, data, ac, ax) {
  var c = document.getElementById(id); if (!c || typeof Chart === 'undefined') return;
  var palette = [ac, hsCV('--grn', '#10b981'), hsCV('--amb', '#f59e0b'), hsCV('--red', '#ef4444'),
    '#06b6d4', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#e11d48'];
  hsCharts[id] = new Chart(c, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: labels.map(function (_, i) { return palette[i % palette.length]; }), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: { legend: { position: 'right', labels: { color: ax.tx, font: ax.font, boxWidth: 11, padding: 8 } } } }
  });
}

// ── Lead-stage matrix table (Performance tab) ─────────────────────
function hsLeadTable() {
  var m = (hsData && hsData.leadStageMatrix) || { stages: [], rows: [] };
  if (!m.stages.length) return '<div class="hs-empty">No lead-stage data in this period</div>';
  var colMax = {};
  m.stages.forEach(function (st) { colMax[st] = m.rows.reduce(function (mx, r) { return Math.max(mx, r.counts[st] || 0); }, 0) || 1; });
  var head = '<th class="hs-name-col">Consultant</th><th class="hs-th-num">Total</th>' +
    m.stages.map(function (st) { return '<th class="hs-th-num">' + hsEsc(st) + '</th>'; }).join('');
  var rows = m.rows.map(function (r) {
    return '<tr><td class="hs-name-col">' + hsEsc(r.name) + '</td>' +
      '<td class="hs-num"><span class="hs-cellv hs-total">' + r.total + '</span></td>' +
      m.stages.map(function (st) {
        var v = r.counts[st] || 0, w = Math.round((v / colMax[st]) * 100);
        return '<td class="hs-num">' + (v ? '<span class="hs-cellbar" style="width:' + w + '%"></span><span class="hs-cellv">' + v + '</span>' : '<span class="hs-cellv hs-zero">·</span>') + '</td>';
      }).join('') + '</tr>';
  }).join('');
  return '<table class="hs-table hs-lead"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function hsEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

// Re-render the active tab's charts when the theme changes.
(function () {
  var orig = window.hofUpdateCharts;
  window.hofUpdateCharts = function () {
    if (orig) { try { orig.apply(this, arguments); } catch (e) {} }
    if (hsOpen && hsData) { try { hsRenderTab(); } catch (e) {} }
  };
})();
