// ══════════════════════════════════════════════════════════════════
//  DEALS AUDIT TAB  —  GLOBAL_TAB + DXB_TAB (Apps Script JSON feed)
//  Endpoint defined below. Returns:
//   { ok, criteria:[{id,label}], segments:{ global:{rows}, dxb:{rows} } }
//   row = { consultant, caseLink, date:'yyyy-mm-dd', dealStage, pipeline,
//           comment, score, checks:[8 vals] }   1=pass 0=fail -1=autofail
// ══════════════════════════════════════════════════════════════════
const DLA_API = 'https://script.google.com/macros/s/AKfycbwL_ZmOSoqTSwlH4YMPf2miL5MzBMi5jMqtP5eRdUjWMSLs2-KnKEt1LjbfnnwNqqw6/exec';

var dlaData       = null;       // full JSON payload
var dlaCriteria   = [];         // [{id,label}]
var dlaSeg        = 'global';   // 'global' | 'dxb'
var dlaPreset     = 'today';    // today | last7 | last10 | month | custom
var _dlaLoaded    = false;
var dlaCharts     = {};         // Chart.js instances (destroyed before redraw)
var dlaLastRows   = [];         // last filtered rows (for theme re-render)

// ── Lazy-load when the Deals tab is first opened (preserve go() wrap) ──
var _dlaOrigGo = window.go;
window.go = function (tab) {
  if (_dlaOrigGo) _dlaOrigGo.call(this, tab);
  if (tab === 'deals' && !_dlaLoaded) { _dlaLoaded = true; dlaLoad(); }
};

// ── Fetch ─────────────────────────────────────────────────────────
function dlaLoad() {
  if (typeof showLdr === 'function') showLdr('Loading deals audits…');
  dlaShowSkeleton(true);
  var eb = document.getElementById('dla-error'); if (eb) eb.style.display = 'none';

  fetch(DLA_API, { redirect: 'follow' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (t) {
      if (!t || t.trim() === '') throw new Error('Empty response from Apps Script');
      if (t.trim().charAt(0) === '<') throw new Error('Got HTML not JSON — redeploy the script: Execute as Me, Anyone can access');
      var j = JSON.parse(t);
      if (!j.ok) throw new Error(j.error || 'Apps Script returned an error');
      dlaData     = j;
      dlaCriteria = j.criteria || [];
      dlaPopulateConsultants();
      dlaRender();
    })
    .catch(function (e) { dlaError(e.message); })
    .finally(function () {
      if (typeof hideLdr === 'function') hideLdr();
      dlaShowSkeleton(false);
    });
}
function dlaRefresh() { _dlaLoaded = true; dlaLoad(); }

function dlaError(msg) {
  var eb = document.getElementById('dla-error'), em = document.getElementById('dla-error-msg');
  if (em) em.textContent = msg;
  if (eb) eb.style.display = 'flex';
  var c = document.getElementById('dla-content'); if (c) c.style.display = 'none';
}
function dlaShowSkeleton(on) {
  var sk = document.getElementById('dla-skeleton'), c = document.getElementById('dla-content');
  if (sk) sk.style.display = on ? 'grid' : 'none';
  if (c && on) c.style.display = 'none';
}

// ── Controls ──────────────────────────────────────────────────────
function dlaSetSegment(seg) {
  dlaSeg = seg;
  ['global', 'dxb'].forEach(function (s) {
    var b = document.getElementById('dla-seg-' + s);
    if (b) b.classList.toggle('on', s === seg);
  });
  dlaPopulateConsultants();
  dlaRender();
}
function dlaSetPreset(p) {
  dlaPreset = p;
  document.querySelectorAll('#dla-presets .dla-chip').forEach(function (c) {
    c.classList.toggle('on', c.getAttribute('data-preset') === p);
  });
  var box = document.getElementById('dla-custom');
  if (box) box.style.display = (p === 'custom') ? 'flex' : 'none';
  if (p === 'custom') {
    var s = document.getElementById('dla-start'), e = document.getElementById('dla-end');
    var t = dlaYMD(new Date());
    if (s && !s.value) s.value = t;
    if (e && !e.value) e.value = t;
  }
  dlaRender();
}

// ── Date helpers ──────────────────────────────────────────────────
function dlaYMD(d) {
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}
function dlaRangeYMD() {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var s = new Date(today), e = new Date(today);
  if (dlaPreset === 'today') { /* s=e=today */ }
  else if (dlaPreset === 'last7')  { s.setDate(s.getDate() - 6); }
  else if (dlaPreset === 'last10') { s.setDate(s.getDate() - 9); }
  else if (dlaPreset === 'month')  { s = new Date(today.getFullYear(), today.getMonth(), 1); }
  else if (dlaPreset === 'custom') {
    var sv = (document.getElementById('dla-start') || {}).value;
    var ev = (document.getElementById('dla-end') || {}).value;
    return { s: sv || dlaYMD(today), e: ev || dlaYMD(today) };
  }
  return { s: dlaYMD(s), e: dlaYMD(e) };
}

// ── Pure compute (kept DOM-free so it can be tested) ──────────────
function dlaSegRows() {
  if (!dlaData || !dlaData.segments || !dlaData.segments[dlaSeg]) return [];
  return dlaData.segments[dlaSeg].rows || [];
}
function dlaFilter(rows, range, consultant) {
  return rows.filter(function (r) {
    if (!r.date || r.date < range.s || r.date > range.e) return false;
    if (consultant && consultant !== 'all' && r.consultant !== consultant) return false;
    return true;
  });
}
function dlaAvg(arr) {
  var v = arr.filter(function (n) { return typeof n === 'number' && !isNaN(n); });
  if (!v.length) return null;
  return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
}
function dlaIsAutofail(r) { return (r.checks || []).indexOf(-1) !== -1; }

function dlaByConsultant(rows) {
  var map = {};
  rows.forEach(function (r) {
    var k = r.consultant || '—';
    if (!map[k]) map[k] = { name: k, audits: 0, scores: [], autofails: 0 };
    map[k].audits++;
    if (typeof r.score === 'number') map[k].scores.push(r.score);
    if (dlaIsAutofail(r)) map[k].autofails++;
  });
  return Object.keys(map).map(function (k) {
    var m = map[k];
    return { name: m.name, audits: m.audits, autofails: m.autofails, comp: dlaAvg(m.scores) };
  });
}
function dlaMistakes(rows) {
  return dlaCriteria.map(function (c, i) {
    var fail = 0, af = 0;
    rows.forEach(function (r) {
      var v = (r.checks || [])[i];
      if (v === 0) fail++;
      else if (v === -1) { fail++; af++; }
    });
    return { id: c.id, label: c.label, fails: fail, autofails: af };
  }).filter(function (m) { return m.fails > 0; })
    .sort(function (a, b) { return b.fails - a.fails; });
}
function dlaByStage(rows) {
  var map = {};
  rows.forEach(function (r) {
    var k = r.dealStage || '—';
    if (!map[k]) map[k] = { stage: k, audits: 0, scores: [] };
    map[k].audits++;
    if (typeof r.score === 'number') map[k].scores.push(r.score);
  });
  return Object.keys(map).map(function (k) {
    return { stage: k, audits: map[k].audits, comp: dlaAvg(map[k].scores) };
  }).sort(function (a, b) { return b.audits - a.audits; });
}
function dlaPerDay(rows) {
  var map = {};
  rows.forEach(function (r) {
    if (!r.date) return;
    if (!map[r.date]) map[r.date] = [];
    if (typeof r.score === 'number') map[r.date].push(r.score);
  });
  return Object.keys(map).sort().map(function (d) {
    return { date: d, audits: map[d].length, comp: dlaAvg(map[d]) };
  });
}

// ── Render ────────────────────────────────────────────────────────
function dlaCompClr(p) {
  if (p === null || p === undefined) return 'var(--mu)';
  return p >= 80 ? 'var(--grn)' : p >= 60 ? 'var(--amb)' : 'var(--red)';
}
function dlaPct(p) { return (p === null || p === undefined) ? '—' : Math.round(p) + '%'; }
function dlaEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function dlaPopulateConsultants() {
  var sel = document.getElementById('dla-consultant'); if (!sel) return;
  var cur = sel.value;
  var names = {};
  dlaSegRows().forEach(function (r) { if (r.consultant) names[r.consultant] = 1; });
  var list = Object.keys(names).sort();
  sel.innerHTML = '<option value="all">All Consultants</option>' +
    list.map(function (n) { return '<option value="' + dlaEsc(n) + '">' + dlaEsc(n) + '</option>'; }).join('');
  if (cur && (cur === 'all' || names[cur])) sel.value = cur; else sel.value = 'all';
}

function dlaRender() {
  if (!dlaData) return;
  var content = document.getElementById('dla-content'); if (content) content.style.display = 'block';

  var range = dlaRangeYMD();
  var consultant = (document.getElementById('dla-consultant') || {}).value || 'all';
  var rows = dlaFilter(dlaSegRows(), range, consultant);
  dlaLastRows = rows;

  // updated line
  var upd = document.getElementById('dla-updated');
  if (upd) {
    var segName = dlaSeg === 'dxb' ? 'DXB' : 'Global';
    upd.textContent = segName + ' · ' + range.s + (range.s === range.e ? '' : ' → ' + range.e) +
      ' · ' + rows.length + ' audit' + (rows.length !== 1 ? 's' : '');
  }
  var nc = document.getElementById('nc-deals'); if (nc) nc.textContent = rows.length;

  // KPIs
  var comp = dlaAvg(rows.map(function (r) { return r.score; }));
  var consSet = {}; rows.forEach(function (r) { consSet[r.consultant] = 1; });
  var afRows = rows.filter(dlaIsAutofail).length;
  dlaSet('dla-k-audits', rows.length);
  var kc = document.getElementById('dla-k-comp');
  if (kc) { kc.textContent = dlaPct(comp); kc.style.color = dlaCompClr(comp); }
  dlaSet('dla-k-cons', Object.keys(consSet).length);
  dlaSet('dla-k-af', afRows);

  dlaRenderPerformers(rows);
  dlaRenderMistakes(rows);
  dlaRenderStages(rows);
  dlaRenderCharts(rows);
  dlaRenderTable(rows);
}
function dlaSet(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }

function dlaRenderPerformers(rows) {
  var byC = dlaByConsultant(rows).filter(function (c) { return c.comp !== null; });
  var top = document.getElementById('dla-top'), bot = document.getElementById('dla-bottom');
  if (!byC.length) {
    if (top) top.innerHTML = '<div class="dla-empty">No scored audits</div>';
    if (bot) bot.innerHTML = '<div class="dla-empty">No scored audits</div>';
    return;
  }
  var sorted = byC.slice().sort(function (a, b) { return b.comp - a.comp; });
  function card(c) {
    return '<div class="dla-perf-name">' + dlaEsc(c.name) + '</div>' +
      '<div class="dla-perf-pct" style="color:' + dlaCompClr(c.comp) + '">' + dlaPct(c.comp) + '</div>' +
      '<div class="dla-perf-sub">' + c.audits + ' audit' + (c.audits !== 1 ? 's' : '') +
      (c.autofails ? ' · ' + c.autofails + ' autofail' + (c.autofails !== 1 ? 's' : '') : '') + '</div>';
  }
  if (top) top.innerHTML = card(sorted[0]);
  if (bot) bot.innerHTML = card(sorted[sorted.length - 1]);
}

function dlaRenderMistakes(rows) {
  var box = document.getElementById('dla-mistakes'); if (!box) return;
  var m = dlaMistakes(rows);
  if (!m.length) { box.innerHTML = '<div class="dla-empty">No mistakes in this period 🎉</div>'; return; }
  var max = m[0].fails || 1;
  box.innerHTML = m.map(function (x) {
    var w = Math.round((x.fails / max) * 100);
    var pctAudits = rows.length ? Math.round((x.fails / rows.length) * 100) : 0;
    return '<div class="dla-mistake">' +
      '<div class="dla-mistake-top"><span>' + dlaEsc(x.label) + '</span>' +
      '<span class="dla-mistake-n">' + x.fails + ' <small>(' + pctAudits + '% of audits' +
      (x.autofails ? ', ' + x.autofails + ' autofail' : '') + ')</small></span></div>' +
      '<div class="dla-bar"><div class="dla-bar-fill" style="width:' + w + '%"></div></div></div>';
  }).join('');
}

function dlaRenderStages(rows) {
  var box = document.getElementById('dla-stages'); if (!box) return;
  var st = dlaByStage(rows);
  if (!st.length) { box.innerHTML = '<div class="dla-empty">No audits in this period</div>'; return; }
  box.innerHTML = st.map(function (s) {
    return '<button class="dla-stage" onclick="dlaOpenStage(' + JSON.stringify(s.stage).replace(/"/g, '&quot;') + ')">' +
      '<div class="dla-stage-name">' + dlaEsc(s.stage) + '</div>' +
      '<div class="dla-stage-n">' + s.audits + '</div>' +
      '<div class="dla-stage-comp" style="color:' + dlaCompClr(s.comp) + '">' + dlaPct(s.comp) + ' avg</div>' +
      '</button>';
  }).join('');
}

// ── Charts (theme-aware; vars resolved to computed values at render) ──
function dlaCV(name, fb) {
  try { var v = getComputedStyle(document.body).getPropertyValue(name).trim(); return v || fb; }
  catch (e) { return fb; }
}
function dlaHex(c, a) {
  c = (c || '').trim();
  var m = c.match(/^#?([0-9a-f]{6})$/i);
  if (m) { var n = parseInt(m[1], 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  return c;
}
function dlaByPipeline(rows) {
  var map = {};
  rows.forEach(function (r) { var k = r.pipeline || '—'; map[k] = (map[k] || 0) + 1; });
  return Object.keys(map).map(function (k) { return { pipeline: k, count: map[k] }; })
    .sort(function (a, b) { return b.count - a.count; });
}

function dlaRenderCharts(rows) {
  if (typeof Chart === 'undefined') return;
  var tx = dlaCV('--t2', '#64748b'), grid = dlaCV('--b', 'rgba(0,0,0,.08)'), ac = dlaCV('--ac', '#243a9e');
  var font = { family: "'Plus Jakarta Sans',sans-serif", size: 11 };

  // Per-day team average — line
  var pd = dlaPerDay(rows);
  var pdc = document.getElementById('dla-chart-perday');
  if (dlaCharts.perday) { dlaCharts.perday.destroy(); dlaCharts.perday = null; }
  if (pdc) {
    dlaCharts.perday = new Chart(pdc, {
      type: 'line',
      data: {
        labels: pd.map(function (d) { return d.date.slice(5); }),
        datasets: [{
          label: 'Team avg %',
          data: pd.map(function (d) { return d.comp === null ? null : Math.round(d.comp); }),
          borderColor: ac, backgroundColor: dlaHex(ac, 0.10), borderWidth: 2, fill: true,
          tension: 0.35, pointRadius: 3, pointBackgroundColor: ac, spanGaps: true
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: tx, font: font }, grid: { display: false } },
          y: { min: 0, max: 100, ticks: { color: tx, font: font, callback: function (v) { return v + '%'; } }, grid: { color: grid } }
        }
      }
    });
  }

  // Audits by pipeline — donut
  var pl = dlaByPipeline(rows);
  var plc = document.getElementById('dla-chart-pipe');
  if (dlaCharts.pipe) { dlaCharts.pipe.destroy(); dlaCharts.pipe = null; }
  if (plc) {
    var palette = [ac, dlaCV('--grn', '#10b981'), dlaCV('--amb', '#f59e0b'), dlaCV('--red', '#ef4444'), '#06b6d4', '#a855f7', '#ec4899'];
    dlaCharts.pipe = new Chart(plc, {
      type: 'doughnut',
      data: {
        labels: pl.map(function (p) { return p.pipeline; }),
        datasets: [{ data: pl.map(function (p) { return p.count; }), backgroundColor: pl.map(function (_, i) { return palette[i % palette.length]; }), borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'bottom', labels: { color: tx, font: font, boxWidth: 12, padding: 10 } } }
      }
    });
  }
}

// Re-render deals charts when the theme changes (setTheme calls hofUpdateCharts)
(function () {
  var orig = window.hofUpdateCharts;
  window.hofUpdateCharts = function () {
    if (orig) { try { orig.apply(this, arguments); } catch (e) {} }
    if (dlaData && typeof activeTab !== 'undefined' && activeTab === 'deals') {
      try { dlaRenderCharts(dlaLastRows || []); } catch (e) {}
    }
  };
})();

function dlaRenderTable(rows) {
  var tb = document.getElementById('dla-tbody'); if (!tb) return;
  var byC = dlaByConsultant(rows).sort(function (a, b) {
    var ac = a.comp === null ? -1 : a.comp, bc = b.comp === null ? -1 : b.comp;
    return bc - ac;
  });
  if (!byC.length) { tb.innerHTML = '<tr><td colspan="4" class="dla-empty">No audits in this period</td></tr>'; return; }
  tb.innerHTML = byC.map(function (c) {
    return '<tr>' +
      '<td>' + dlaEsc(c.name) + '</td>' +
      '<td style="text-align:center">' + c.audits + '</td>' +
      '<td style="text-align:center;color:' + (c.autofails ? 'var(--red)' : 'var(--mu)') + '">' + (c.autofails || '—') + '</td>' +
      '<td style="text-align:right;font-weight:700;color:' + dlaCompClr(c.comp) + '">' + dlaPct(c.comp) + '</td>' +
      '</tr>';
  }).join('');
}

// ── Deal-stage drilldown modal ────────────────────────────────────
function dlaOpenStage(stage) {
  var range = dlaRangeYMD();
  var consultant = (document.getElementById('dla-consultant') || {}).value || 'all';
  var rows = dlaFilter(dlaSegRows(), range, consultant).filter(function (r) { return (r.dealStage || '—') === stage; });
  var title = document.getElementById('dla-modal-title');
  var body  = document.getElementById('dla-modal-body');
  if (title) title.textContent = stage + ' — ' + rows.length + ' case' + (rows.length !== 1 ? 's' : '');
  if (body) {
    body.innerHTML = rows.length ? rows.map(function (r) {
      var link = r.caseLink
        ? '<a href="' + dlaEsc(r.caseLink) + '" target="_blank" rel="noopener">Open case ↗</a>'
        : '<span class="dla-mu">no link</span>';
      var afTag = dlaIsAutofail(r) ? '<span class="dla-af">AUTOFAIL</span>' : '';
      return '<div class="dla-case">' +
        '<div class="dla-case-l"><div class="dla-case-name">' + dlaEsc(r.consultant) + ' ' + afTag + '</div>' +
        '<div class="dla-case-meta">' + dlaEsc(r.date) + (r.pipeline ? ' · ' + dlaEsc(r.pipeline) : '') + '</div>' +
        (r.comment ? '<div class="dla-case-cmt">' + dlaEsc(r.comment) + '</div>' : '') + '</div>' +
        '<div class="dla-case-r"><div class="dla-case-score" style="color:' + dlaCompClr(r.score) + '">' + dlaPct(r.score) + '</div>' + link + '</div>' +
        '</div>';
    }).join('') : '<div class="dla-empty">No cases.</div>';
  }
  var m = document.getElementById('dla-modal'); if (m) m.classList.add('on');
}
function dlaCloseStage() { var m = document.getElementById('dla-modal'); if (m) m.classList.remove('on'); }

// ── Export current view to CSV ────────────────────────────────────
function dlaExportCSV() {
  if (!dlaData) return;
  var range = dlaRangeYMD();
  var consultant = (document.getElementById('dla-consultant') || {}).value || 'all';
  var rows = dlaFilter(dlaSegRows(), range, consultant);
  var head = ['Consultant', 'Date', 'Deal Stage', 'Pipeline', 'Score', 'Autofail']
    .concat(dlaCriteria.map(function (c) { return c.label; }))
    .concat(['Comment', 'Case Link']);
  function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  var lines = [head.map(q).join(',')];
  rows.forEach(function (r) {
    var line = [r.consultant, r.date, r.dealStage, r.pipeline, (r.score == null ? '' : r.score), dlaIsAutofail(r) ? 'YES' : '']
      .concat((r.checks || []).map(function (v) { return v === 1 ? 'YES' : v === 0 ? 'NO' : v === -1 ? 'AUTOFAIL' : ''; }))
      .concat([r.comment, r.caseLink]);
    lines.push(line.map(q).join(','));
  });
  var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'HOF-Deals-Audit-' + dlaSeg + '-' + range.s + '_' + range.e + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// Safety: never let a stuck loader hang the screen
window.addEventListener('error', function () { if (typeof hideLdr === 'function') hideLdr(); });
