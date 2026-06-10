// ══════════════════════════════════════════════════════════════════
//  CONSULTANTS ACTIVITY (HubSpot)
//  Lives as the "Consultants Activity" sub-tab inside the HOF
//  Consultants tab (alongside "Performance Compliance").
//  Graph-driven (Chart.js), theme-aware, day/custom/all date filter.
// ══════════════════════════════════════════════════════════════════
const HS_API = 'https://script.google.com/macros/s/AKfycbzn_ngRUlGOV9S9iDkY67QWBcB2DuNSdKD2qjoTJShpyU3GtL_CQ9JYd2Mr4SPJ4-N_BA/exec';

var hsLoaded = false;
var hsData   = null;
var hsRange  = (function () { var d = new Date(), mo = d.getMonth() + 1, da = d.getDate(); var ymd = d.getFullYear() + '-' + (mo < 10 ? '0' + mo : mo) + '-' + (da < 10 ? '0' + da : da); return { custom: { start: ymd, end: ymd } }; })();
var hsConsultant = 'all';
var hsCharts = {};

// ── HOF Consultants sub-tab toggle ───────────────────────────────
function hofShowSub(which) {
  var isAct = (which === 'activity');
  var perf = document.getElementById('hofPerfPane'), act = document.getElementById('hofActPane');
  if (perf) perf.style.display = isAct ? 'none' : 'block';
  if (act)  act.style.display  = isAct ? 'block' : 'none';
  var bp = document.getElementById('hofsub-perf'), ba = document.getElementById('hofsub-act');
  if (bp) bp.classList.toggle('on', !isAct);
  if (ba) ba.classList.toggle('on', isAct);
  if (isAct) {
    if (!hsLoaded) { hsLoaded = true; hsLoad(); }
    else if (hsData) { hsRenderAll(); }
  } else {
    hsDestroy();
  }
}
function hsActiveVisible() {
  var act = document.getElementById('hofActPane');
  return act && act.style.display !== 'none';
}

// ── Date filter ───────────────────────────────────────────────────
function hsSetRange(kind) {
  if (kind === 'custom') {
    var box = document.getElementById('hs-custom');
    if (box) box.style.display = (box.style.display === 'flex') ? 'none' : 'flex';
    return;
  }
  if (kind === 'today') {
    var d = new Date(), mo = d.getMonth() + 1, da = d.getDate();
    var ymd = d.getFullYear() + '-' + (mo < 10 ? '0' + mo : mo) + '-' + (da < 10 ? '0' + da : da);
    hsRange = { custom: { start: ymd, end: ymd } };
    hsMarkChip('today');
    var cb = document.getElementById('hs-custom'); if (cb) cb.style.display = 'none';
    hsLoad();
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
      hsRenderAll();
    })
    .catch(function (e) {
      hsDestroy();
      if (body) body.innerHTML = '<div class="hs-err">⚠️ ' + hsEsc(e.message) + '</div>';
      if (sub) sub.textContent = 'Error';
    });
}

// ── Data helpers ──────────────────────────────────────────────────
function hsActiveIds() {
  if (hsConsultant && hsConsultant !== 'all') { var o = {}; o[hsConsultant] = 1; return o; }
  var m = {}; (hsData.owners || []).forEach(function (x) { m[x.id] = 1; }); return m;
}
function hsSelectConsultant(v) { hsConsultant = v; hsRenderAll(); }
function hsPopulateConsultants() {
  var sel = document.getElementById('hs-consultant'); if (!sel) return;
  if (sel.options.length > 1) { sel.value = hsConsultant; return; } // already populated
  var names = (hsData.owners || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  sel.innerHTML = '<option value="all">All Consultants</option>' +
    names.map(function (o) { return '<option value="' + o.id + '">' + hsEsc(o.name) + '</option>'; }).join('');
  sel.value = hsConsultant;
}
function hsLookup(key) { var m = {}; ((hsData.widgets || {})[key] || []).forEach(function (r) { m[r.id] = r.count; }); return m; }
function hsSum(key) { var act = hsActiveIds(); return ((hsData.widgets || {})[key] || []).reduce(function (s, r) { return s + (act[r.id] ? (r.count || 0) : 0); }, 0); }
function hsSingle(key) { var act = hsActiveIds(); return (((hsData.widgets || {})[key]) || []).filter(function (r) { return act[r.id]; }).slice().sort(function (a, b) { return b.count - a.count; }); }
function hsMerge(keyA, keyB) {
  var a = hsLookup(keyA), b = hsLookup(keyB), act = hsActiveIds();
  return (hsData.owners || []).filter(function (o) { return act[o.id]; })
    .map(function (o) { return { name: o.name, a: a[o.id] || 0, b: b[o.id] || 0 }; })
    .sort(function (x, y) { return (y.a + y.b) - (x.a + x.b); });
}
function hsCV(n, fb) { try { var v = getComputedStyle(document.body).getPropertyValue(n).trim(); return v || fb; } catch (e) { return fb; } }
function hsAxis() { return { tx: hsCV('--t2', '#64748b'), grid: hsCV('--b', 'rgba(0,0,0,.08)'), font: { family: "'Plus Jakarta Sans',sans-serif", size: 11 } }; }
function hsDestroy() { Object.keys(hsCharts).forEach(function (k) { if (hsCharts[k]) { hsCharts[k].destroy(); hsCharts[k] = null; } }); hsCharts = {}; }
function hsBoxH(n, per, base) { return Math.max(200, n * (per || 24) + (base || 50)); }
function hsKpi(v, l, color) { return '<div class="hs-kpi"><div class="hs-kpi-v"' + (color ? ' style="color:' + color + '"' : '') + '>' + v + '</div><div class="hs-kpi-l">' + l + '</div></div>'; }
function chartCard(title, id, h) { return '<div class="hs-chart-card"><div class="hs-chart-h">' + hsEsc(title) + '</div><div class="hs-cbox" style="height:' + h + 'px"><canvas id="' + id + '"></canvas></div></div>'; }

// ── Render everything into the Activity pane ──────────────────────
function hsRenderAll() {
  if (!hsData) return;
  hsDestroy();
  hsPopulateConsultants();
  var body = document.getElementById('hs-body'); if (!body) return;
  var sub = document.getElementById('hs-sub');
  if (sub) { var when = ''; try { when = new Date(hsData.generatedAt).toLocaleString(); } catch (e) {}
    sub.textContent = (hsData.owners ? hsData.owners.length : 0) + ' consultants · ' + (hsData.rangeLabel || '') + ' · updated ' + when; }

  var ac = hsCV('--ac', '#243a9e'), grn = hsCV('--grn', '#10b981'), red = hsCV('--red', '#ef4444'), amb = hsCV('--amb', '#f59e0b');
  var n = Object.keys(hsActiveIds()).length;
  var outreach = hsMerge('calls', 'emails'), created = hsMerge('dealsCreated', 'tasksCreated');
  var won = hsSingle('dealsWon'), tasks = hsMerge('tasksCompleted', 'overdueTasks'), contacts = hsSingle('totalContacts');

  body.innerHTML =
    '<div class="hs-kpis">' +
      hsKpi(hsSum('calls'), 'Calls') + hsKpi(hsSum('emails'), 'Emails sent') +
      hsKpi(hsSum('dealsCreated'), 'Deals created') + hsKpi(hsSum('tasksCreated'), 'Tasks created') +
      hsKpi(hsSum('dealsWon'), 'Deals won', grn) + hsKpi(hsSum('overdueTasks'), 'Overdue', red) +
    '</div>' +
    '<div class="hs-sec-h">Activity</div>' +
    chartCard('Outreach by consultant — Calls vs Emails', 'hsc-outreach', hsBoxH(n, 30, 60)) +
    chartCard('Created by consultant — Deals vs Tasks', 'hsc-created', hsBoxH(n, 30, 60)) +
    '<div class="hs-sec-h">Outcomes</div>' +
    chartCard('Deals won by consultant', 'hsc-won', hsBoxH(n)) +
    chartCard('Tasks — done vs overdue by consultant', 'hsc-tasks', hsBoxH(n, 30, 60)) +
    '<div class="hs-grid2">' +
      chartCard('Lead-stage mix (all consultants)', 'hsc-lead', 320) +
      chartCard('Contacts by consultant', 'hsc-contacts', 320) +
    '</div>' +
    '<div class="hs-sec-h">Lead stage by consultant</div>' +
    '<div class="hs-tablewrap">' + hsLeadTable() + '</div>';

  var ax = hsAxis();
  hsGrouped('hsc-outreach', outreach.map(nm), [{ label: 'Calls', data: outreach.map(va), color: ac }, { label: 'Emails', data: outreach.map(vb), color: amb }], ax);
  hsGrouped('hsc-created', created.map(nm), [{ label: 'Deals created', data: created.map(va), color: grn }, { label: 'Tasks created', data: created.map(vb), color: ac }], ax);
  hsBar('hsc-won', won.map(function (x) { return x.name; }), won.map(function (x) { return x.count; }), grn, ax);
  hsGrouped('hsc-tasks', tasks.map(nm), [{ label: 'Done', data: tasks.map(va), color: grn }, { label: 'Overdue', data: tasks.map(vb), color: red }], ax);
  var st;
  if (hsConsultant !== 'all') {
    var lr = ((hsData.leadStageMatrix && hsData.leadStageMatrix.rows) || []).filter(function (r) { return r.id === hsConsultant; })[0];
    st = (lr && lr.counts) || {};
  } else {
    st = (hsData.leadStageMatrix && hsData.leadStageMatrix.stageTotals) || {};
  }
  var keys = Object.keys(st).sort(function (a, b) { return st[b] - st[a]; });
  hsDonut('hsc-lead', keys, keys.map(function (k) { return st[k]; }), ac, ax);
  hsBar('hsc-contacts', contacts.map(function (x) { return x.name; }), contacts.map(function (x) { return x.count; }), ac, ax);
}
function nm(x) { return x.name; } function va(x) { return x.a; } function vb(x) { return x.b; }

// ── Chart builders ────────────────────────────────────────────────
function hsBar(id, labels, data, color, ax) {
  var c = document.getElementById(id); if (!c || typeof Chart === 'undefined') return;
  hsCharts[id] = new Chart(c, { type: 'bar',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: color, borderRadius: 5, barThickness: 13, maxBarThickness: 16 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { color: ax.tx, font: ax.font, precision: 0 }, grid: { color: ax.grid } }, y: { ticks: { color: ax.tx, font: ax.font }, grid: { display: false } } } } });
}
function hsGrouped(id, labels, series, ax) {
  var c = document.getElementById(id); if (!c || typeof Chart === 'undefined') return;
  hsCharts[id] = new Chart(c, { type: 'bar',
    data: { labels: labels, datasets: series.map(function (s) { return { label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 4, barThickness: 9, maxBarThickness: 11 }; }) },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { color: ax.tx, font: ax.font, boxWidth: 12, padding: 12 } } },
      scales: { x: { beginAtZero: true, ticks: { color: ax.tx, font: ax.font, precision: 0 }, grid: { color: ax.grid } }, y: { ticks: { color: ax.tx, font: ax.font }, grid: { display: false } } } } });
}
function hsDonut(id, labels, data, ac, ax) {
  var c = document.getElementById(id); if (!c || typeof Chart === 'undefined') return;
  var palette = [ac, hsCV('--grn', '#10b981'), hsCV('--amb', '#f59e0b'), hsCV('--red', '#ef4444'), '#06b6d4', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#e11d48'];
  hsCharts[id] = new Chart(c, { type: 'doughnut',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: labels.map(function (_, i) { return palette[i % palette.length]; }), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { color: ax.tx, font: ax.font, boxWidth: 11, padding: 8 } } } } });
}

// ── Lead-stage matrix table ───────────────────────────────────────
function hsLeadTable() {
  var m = (hsData && hsData.leadStageMatrix) || { stages: [], rows: [] };
  if (!m.stages.length) return '<div class="hs-empty">No lead-stage data in this period</div>';
  var colMax = {};
  m.stages.forEach(function (st) { colMax[st] = m.rows.reduce(function (mx, r) { return Math.max(mx, r.counts[st] || 0); }, 0) || 1; });
  var viewRows = (hsConsultant !== 'all') ? m.rows.filter(function (r) { return r.id === hsConsultant; }) : m.rows;
  if (!viewRows.length) return '<div class="hs-empty">No lead-stage data for this consultant</div>';
  var head = '<th class="hs-name-col">Consultant</th><th class="hs-th-num">Total</th>' +
    m.stages.map(function (st) { return '<th class="hs-th-num">' + hsEsc(st) + '</th>'; }).join('');
  var rows = viewRows.map(function (r) {
    return '<tr><td class="hs-name-col">' + hsEsc(r.name) + '</td>' +
      '<td class="hs-num"><span class="hs-cellv hs-total">' + r.total + '</span></td>' +
      m.stages.map(function (st) {
        var v = r.counts[st] || 0, w = Math.round((v / colMax[st]) * 100);
        return '<td class="hs-num">' + (v ? '<span class="hs-cellbar" style="width:' + w + '%"></span><span class="hs-cellv">' + v + '</span>' : '<span class="hs-cellv hs-zero">·</span>') + '</td>';
      }).join('') + '</tr>';
  }).join('');
  return '<table class="hs-table hs-lead"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function hsEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

// Re-render charts on theme change when the Activity pane is visible.
(function () {
  var orig = window.hofUpdateCharts;
  window.hofUpdateCharts = function () {
    if (orig) { try { orig.apply(this, arguments); } catch (e) {} }
    if (hsData && hsActiveVisible()) { try { hsRenderAll(); } catch (e) {} }
  };
})();
