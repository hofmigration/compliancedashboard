// ══════════════════════════════════════════════════════════════════
//  CONSULTANT ACTIVITY (HubSpot) — left-rail drawer
//  Comparison tables (not 9 separate graphs): activity-by-consultant
//  and lead-stage-by-consultant, with a day / custom / all-time filter.
// ══════════════════════════════════════════════════════════════════
const HS_API = 'https://script.google.com/macros/s/AKfycbzn_ngRUlGOV9S9iDkY67QWBcB2DuNSdKD2qjoTJShpyU3GtL_CQ9JYd2Mr4SPJ4-N_BA/exec';

var hsOpen   = false;
var hsLoaded = false;
var hsData   = null;
var hsRange  = { days: '7' };          // {days:'7'|'14'|'30'|'all'} or {custom:{start,end}}
var hsSort   = { col: 0 };             // activity table sort column (-1 = name)

var HS_METRICS = [
  { key: 'calls',          label: 'Calls' },
  { key: 'emails',         label: 'Emails sent' },
  { key: 'dealsCreated',   label: 'Deals created' },
  { key: 'tasksCreated',   label: 'Tasks created' },
  { key: 'tasksCompleted', label: 'Tasks done' },
  { key: 'overdueTasks',   label: 'Overdue' },
  { key: 'totalContacts',  label: 'Contacts' },
  { key: 'dealsWon',       label: 'Won' }
];

function toggleHSReport() {
  hsOpen = !hsOpen;
  var d = document.getElementById('hsDrawer'), o = document.getElementById('hsOverlay');
  if (d) d.style.left = hsOpen ? '0' : '-1040px';     // slides in from the LEFT
  if (o) o.style.display = hsOpen ? 'block' : 'none';
  if (hsOpen && !hsLoaded) { hsLoaded = true; hsLoad(); }
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
      if (body) body.innerHTML = '<div class="hs-err">⚠️ ' + hsEsc(e.message) + '</div>';
      if (sub) sub.textContent = 'Error';
    });
}

// ── Render ────────────────────────────────────────────────────────
function hsRenderAll() {
  var j = hsData; if (!j) return;
  var sub = document.getElementById('hs-sub');
  if (sub) {
    var when = ''; try { when = new Date(j.generatedAt).toLocaleString(); } catch (e) {}
    sub.textContent = (j.owners ? j.owners.length : 0) + ' consultants · ' + (j.rangeLabel || '') + ' · updated ' + when;
  }
  var body = document.getElementById('hs-body'); if (!body) return;
  body.innerHTML =
    '<div class="hs-sec-h">Activity comparison <span class="hs-mu">— tap a column to sort</span></div>' +
    '<div class="hs-tablewrap">' + hsActivityTable(j) + '</div>' +
    '<div class="hs-sec-h">Lead stage by consultant</div>' +
    '<div class="hs-tablewrap">' + hsLeadTable(j) + '</div>';
}

function hsActivityTable(j) {
  var lookup = {};
  HS_METRICS.forEach(function (m) { lookup[m.key] = {}; (j.widgets[m.key] || []).forEach(function (r) { lookup[m.key][r.id] = r.count; }); });
  var rows = (j.owners || []).map(function (o) {
    return { id: o.id, name: o.name, vals: HS_METRICS.map(function (m) { return lookup[m.key][o.id] || 0; }) };
  });
  if (hsSort.col === -1) rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
  else rows.sort(function (a, b) { return (b.vals[hsSort.col] || 0) - (a.vals[hsSort.col] || 0); });

  var colMax = HS_METRICS.map(function (m, i) { return rows.reduce(function (mx, r) { return Math.max(mx, r.vals[i]); }, 0) || 1; });

  var head = '<th class="hs-name-col" onclick="hsSortAct(-1)">Consultant' + (hsSort.col === -1 ? ' ▾' : '') + '</th>' +
    HS_METRICS.map(function (m, i) { return '<th class="hs-th-num" onclick="hsSortAct(' + i + ')">' + hsEsc(m.label) + (hsSort.col === i ? ' ▾' : '') + '</th>'; }).join('');

  var bodyRows = rows.map(function (r) {
    return '<tr><td class="hs-name-col">' + hsEsc(r.name) + '</td>' +
      r.vals.map(function (v, i) {
        var w = Math.round((v / colMax[i]) * 100);
        return '<td class="hs-num"><span class="hs-cellbar" style="width:' + w + '%"></span><span class="hs-cellv">' + v + '</span></td>';
      }).join('') + '</tr>';
  }).join('');

  return '<table class="hs-table"><thead><tr>' + head + '</tr></thead><tbody>' + bodyRows + '</tbody></table>';
}
function hsSortAct(col) { hsSort.col = col; hsRenderAll(); }

function hsLeadTable(j) {
  var m = j.leadStageMatrix || { stages: [], rows: [] };
  if (!m.stages.length) return '<div class="hs-empty">No lead-stage data in this period</div>';
  var colMax = {};
  m.stages.forEach(function (st) { colMax[st] = m.rows.reduce(function (mx, r) { return Math.max(mx, r.counts[st] || 0); }, 0) || 1; });

  var head = '<th class="hs-name-col">Consultant</th><th class="hs-th-num">Total</th>' +
    m.stages.map(function (st) { return '<th class="hs-th-num">' + hsEsc(st) + '</th>'; }).join('');

  var bodyRows = m.rows.map(function (r) {
    return '<tr><td class="hs-name-col">' + hsEsc(r.name) + '</td>' +
      '<td class="hs-num"><span class="hs-cellv hs-total">' + r.total + '</span></td>' +
      m.stages.map(function (st) {
        var v = r.counts[st] || 0;
        var w = Math.round((v / colMax[st]) * 100);
        return '<td class="hs-num">' + (v ? '<span class="hs-cellbar" style="width:' + w + '%"></span><span class="hs-cellv">' + v + '</span>' : '<span class="hs-cellv hs-zero">·</span>') + '</td>';
      }).join('') + '</tr>';
  }).join('');

  return '<table class="hs-table hs-lead"><thead><tr>' + head + '</tr></thead><tbody>' + bodyRows + '</tbody></table>';
}

function hsEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
