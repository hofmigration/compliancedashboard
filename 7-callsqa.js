// ══════════════════════════════════════════════════════════════════
//  CALLS QUALITY TAB  —  Sales Calls QA + Service Calls QA
//  Two Apps Script JSON feeds. Each returns:
//    { ok, team, criteria:[{id,label,weight}], rows:[ {...} ] }
//    row = { date:'yyyy-mm-dd', consultant, auditor, ziwo, link, duration,
//            comment, critical, score, checks:[] }
//    check values: 1 = full marks, 0 = points lost, -1 = N/A
//
//  Mirrors the Deals tab: date presets + custom range + person filter,
//  mistakes shown first, people table below.
// ══════════════════════════════════════════════════════════════════
const CQ_API = {
  sales:   'https://script.google.com/macros/s/AKfycbx3x_NPlRgy2QTcRz7_K4yX9Y8G39sBcKT-wtXSwZhjg-d2lrS-8C9NbP2IAe4qyyCrYg/exec',
  service: 'https://script.google.com/macros/s/AKfycbxJsDV0MVNC7rJGqrlkcYS12mEvryIHuLzrwrKbkQsF5mAkXTWsJnhtleC5TIo5t2IP/exec'
};

var cqData     = { sales: null, service: null };  // cached feed per team
var cqTeam     = 'sales';                         // 'sales' | 'service'
var cqView     = 'people';                        // people | daily | monthly | audits
var cqPreset   = 'month';                         // today | last7 | last10 | month | all | custom
var cqLastRows = [];                              // rows after filtering (used by export)
var _cqLoaded  = false;

// go() in 1-core.js routes unknown tabs to loadCM(); marking this tab loaded
// keeps it out of that path. Our own loader runs from the wrap below.
if (typeof loadedTabs === 'object' && loadedTabs) loadedTabs.calls = true;

var _cqOrigGo = window.go;
window.go = function (tab) {
  if (_cqOrigGo) _cqOrigGo.call(this, tab);
  if (tab === 'calls' && !_cqLoaded) { _cqLoaded = true; cqLoad(); }
};

// The left-rail Refresh button calls refreshActive(), which sends unknown tabs
// to loadCM(). Intercept it while the Calls tab is open.
var _cqOrigRefreshActive = window.refreshActive;
window.refreshActive = function () {
  if (typeof activeTab !== 'undefined' && activeTab === 'calls') { cqRefresh(); return; }
  if (_cqOrigRefreshActive) return _cqOrigRefreshActive.apply(this, arguments);
};

/* ── FETCH ──────────────────────────────────────────────────── */
function cqLoad() {
  var team = cqTeam;
  if (cqData[team]) { cqPopulatePeople(); cqRender(); return; }

  cqSetUpdated('Loading ' + (team === 'sales' ? 'sales' : 'service') + ' audits…');
  cqHideError();
  cqSkeleton(true);

  fetch(CQ_API[team], { redirect: 'follow' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (t) {
      if (!t || t.trim() === '') throw new Error('Empty response from Apps Script');
      if (t.trim().charAt(0) === '<') throw new Error('Got HTML not JSON — redeploy that script as a NEW VERSION (Execute as Me, Anyone can access)');
      var j = JSON.parse(t);
      if (!j.ok) throw new Error(j.error || 'Apps Script returned an error');
      cqData[team] = j;
      cqPopulatePeople();
      cqRender();
    })
    .catch(function (e) { cqError(e.message); })
    .finally(function () { cqSkeleton(false); });
}

function cqRefresh() { cqData[cqTeam] = null; cqLoad(); }

function cqSetTeam(team) {
  if (cqTeam === team) return;
  cqTeam = team;
  ['sales', 'service'].forEach(function (t) {
    var b = document.getElementById('cq-seg-' + t);
    if (b) b.classList.toggle('on', t === team);
  });
  var sel = document.getElementById('cq-person');
  if (sel) sel.value = 'all';       // the roster differs per team
  cqLoad();
}

function cqSetView(v) {
  cqView = v;
  ['people', 'daily', 'monthly', 'auditor', 'audits'].forEach(function (x) {
    var b = document.getElementById('cq-view-' + x);
    if (b) b.classList.toggle('on', x === v);
  });
  cqRender();
}

function cqSetPreset(p) {
  cqPreset = p;
  document.querySelectorAll('#cq-presets .dla-chip').forEach(function (c) {
    c.classList.toggle('on', c.getAttribute('data-preset') === p);
  });
  var box = document.getElementById('cq-custom');
  if (box) box.style.display = (p === 'custom') ? 'flex' : 'none';
  if (p === 'custom') {
    var s = document.getElementById('cq-start'), e = document.getElementById('cq-end');
    var t = cqYMD(new Date());
    if (s && !s.value) s.value = t;
    if (e && !e.value) e.value = t;
  }
  cqRender();
}

/* ── STATE HELPERS ──────────────────────────────────────────── */
function cqSkeleton(on) {
  var sk = document.getElementById('cq-skeleton'), c = document.getElementById('cq-content');
  if (sk) sk.style.display = on ? 'grid' : 'none';
  if (c) c.style.display = on ? 'none' : '';
}
function cqError(msg) {
  var eb = document.getElementById('cq-error'), em = document.getElementById('cq-error-msg');
  if (em) em.textContent = msg;
  if (eb) eb.style.display = 'flex';
  var c = document.getElementById('cq-content'); if (c) c.style.display = 'none';
  cqSetUpdated('Could not load');
}
function cqHideError() {
  var eb = document.getElementById('cq-error'); if (eb) eb.style.display = 'none';
  var c = document.getElementById('cq-content'); if (c) c.style.display = '';
}
function cqSetUpdated(txt) {
  var el = document.getElementById('cq-updated'); if (el) el.textContent = txt;
}

/* ── DATE RANGE ─────────────────────────────────────────────── */
function cqYMD(d) {
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}
function cqRange() {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var s = new Date(today), e = new Date(today);
  if (cqPreset === 'today') { /* s = e = today */ }
  else if (cqPreset === 'last7')  { s.setDate(s.getDate() - 6); }
  else if (cqPreset === 'last10') { s.setDate(s.getDate() - 9); }
  else if (cqPreset === 'month')  { s = new Date(today.getFullYear(), today.getMonth(), 1); }
  else if (cqPreset === 'all')    { return { s: '0000-01-01', e: '9999-12-31', all: true }; }
  else if (cqPreset === 'custom') {
    var sv = (document.getElementById('cq-start') || {}).value;
    var ev = (document.getElementById('cq-end') || {}).value;
    var a = sv || cqYMD(today), b = ev || cqYMD(today);
    if (a > b) { var tmp = a; a = b; b = tmp; }   // tolerate reversed dates
    return { s: a, e: b };
  }
  return { s: cqYMD(s), e: cqYMD(e) };
}

/* ── DATA HELPERS ───────────────────────────────────────────── */
function cqAllRows() { var d = cqData[cqTeam]; return (d && d.rows) || []; }
function cqCrit()    { var d = cqData[cqTeam]; return (d && d.criteria) || []; }
function cqRound(v)  { return Math.round(v * 10) / 10; }
function cqLabel()   { return cqTeam === 'sales' ? 'Consultant' : 'Case Manager'; }
function cqEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
  });
}
function cqClr(p) { return p >= 90 ? 'var(--grn)' : p >= 80 ? 'var(--amb)' : 'var(--red)'; }
function cqPct(p) { return '<b style="color:' + cqClr(p) + '">' + cqRound(p) + '%</b>'; }
function cqMonthLabel(key) {
  var p = key.split('-');
  var names = ['January','February','March','April','May','June',
               'July','August','September','October','November','December'];
  return (names[parseInt(p[1], 10) - 1] || p[1]) + ' ' + p[0];
}
function cqEmptyRow(cols, msg) {
  return '<tr><td colspan="' + cols + '" style="text-align:center;padding:26px;color:var(--mu);font-size:12.5px">' +
    (msg || 'No audits in this period') + '</td></tr>';
}

/* ── CALL DURATION ──────────────────────────────────────────── */
// The sheet's Call Duration is normally "mm:ss" from the picker, but older
// rows were typed by hand. Accept mm:ss, h:mm:ss, "5m 30s", or a bare number
// of minutes. Returns minutes as a float.
function cqMins(v) {
  if (v == null) return 0;
  var s = String(v).trim();
  if (!s) return 0;

  if (s.indexOf(':') !== -1) {
    var p = s.split(':').map(function (x) { return parseInt(x, 10) || 0; });
    if (p.length === 3) return p[0] * 60 + p[1] + p[2] / 60;   // h:mm:ss
    if (p.length === 2) return p[0] + p[1] / 60;               // mm:ss
  }
  var h  = s.match(/(\d+)\s*h/i),
      m  = s.match(/(\d+)\s*m/i),
      sc = s.match(/(\d+)\s*s/i);
  if (h || m || sc) {
    return (h ? parseInt(h[1], 10) * 60 : 0) +
           (m ? parseInt(m[1], 10) : 0) +
           (sc ? parseInt(sc[1], 10) / 60 : 0);
  }
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;   // bare number = minutes
}

// 349 -> "5h 49m"
function cqHM(mins) {
  var t = Math.round(mins || 0);
  if (t <= 0) return '0m';
  var h = Math.floor(t / 60), m = t % 60;
  return h ? (h + 'h ' + m + 'm') : (m + 'm');
}
// short form for an average call length
function cqMS(mins) {
  var total = Math.round((mins || 0) * 60);
  var m = Math.floor(total / 60), s = total % 60;
  return m + ':' + (s < 10 ? '0' + s : s);
}

function cqFiltered() {
  var range = cqRange();
  var person = (document.getElementById('cq-person') || {}).value || 'all';
  return cqAllRows().filter(function (r) {
    if (!range.all) { if (!r.date || r.date < range.s || r.date > range.e) return false; }
    if (person !== 'all' && r.consultant !== person) return false;
    return true;
  });
}

// The person dropdown reflects whichever team is loaded.
function cqPopulatePeople() {
  var sel = document.getElementById('cq-person'); if (!sel) return;
  var prev = sel.value;
  var names = {};
  cqAllRows().forEach(function (r) { if (r.consultant) names[r.consultant] = 1; });
  var list = Object.keys(names).sort();
  sel.innerHTML = '<option value="all">All ' + cqLabel() + 's</option>' +
    list.map(function (n) { return '<option value="' + cqEsc(n) + '">' + cqEsc(n) + '</option>'; }).join('');
  sel.value = (prev && list.indexOf(prev) !== -1) ? prev : 'all';
}

/* ── RENDER ─────────────────────────────────────────────────── */
function cqRender() {
  if (!cqData[cqTeam]) return;
  cqHideError();

  var rows = cqFiltered();
  cqLastRows = rows;

  var total = rows.length, sum = 0, crit = 0, people = {}, mins = 0;
  rows.forEach(function (r) {
    sum += Number(r.score) || 0;
    if (r.critical) crit++;
    if (r.consultant) people[r.consultant] = 1;
    mins += cqMins(r.duration);
  });
  var avg = total ? cqRound(sum / total) : 0;

  document.getElementById('cq-k-audits').textContent   = total;
  document.getElementById('cq-k-people').textContent   = Object.keys(people).length;
  document.getElementById('cq-k-critical').textContent = crit;
  var kTime = document.getElementById('cq-k-time');
  if (kTime) kTime.textContent = total ? cqHM(mins) : '—';
  var kAvg = document.getElementById('cq-k-avg');
  kAvg.textContent = total ? avg + '%' : '—';
  kAvg.style.color = total ? cqClr(avg) : '';

  var range = cqRange();
  var when = range.all ? 'All time' : (range.s === range.e ? range.s : range.s + ' → ' + range.e);
  cqSetUpdated((cqTeam === 'sales' ? 'Sales Calls QA' : 'Service Calls QA') +
               ' · ' + when + ' · ' + total + ' audit' + (total === 1 ? '' : 's'));

  var nc = document.getElementById('nc-calls'); if (nc) nc.textContent = total;

  cqRenderMistakes(rows);

  if (cqView === 'people')       cqRenderPeople(rows);
  else if (cqView === 'daily')   cqRenderDaily(rows);
  else if (cqView === 'monthly') cqRenderMonthly(rows);
  else if (cqView === 'auditor') cqRenderAuditorTime(rows);
  else                           cqRenderAudits(rows);
}

// ── Mistakes first: which criteria fail most, as bars
function cqRenderMistakes(rows) {
  var box = document.getElementById('cq-mistakes'); if (!box) return;
  var crit = cqCrit();
  var h = document.getElementById('cq-mistakes-h');
  if (h) h.textContent = 'Most common mistakes — ' + (cqTeam === 'sales' ? 'Sales' : 'Service');

  if (!rows.length || !crit.length) {
    box.innerHTML = '<div class="dla-empty">No audits in this period</div>';
    return;
  }

  var fails = crit.map(function () { return 0; });
  var seen  = crit.map(function () { return 0; });
  rows.forEach(function (r) {
    (r.checks || []).forEach(function (v, i) {
      if (i >= crit.length) return;
      if (v === 1) seen[i]++;
      else if (v === 0) { seen[i]++; fails[i]++; }
    });
  });

  var list = crit.map(function (c, i) {
    return { label: c.label, weight: c.weight, fails: fails[i], seen: seen[i] };
  }).filter(function (x) { return x.fails > 0; })
    .sort(function (a, b) { return b.fails - a.fails; });

  if (!list.length) {
    box.innerHTML = '<div class="dla-empty">No mistakes in this period 🎉</div>';
    return;
  }

  var max = list[0].fails || 1;
  box.innerHTML = list.map(function (x) {
    var w = Math.round((x.fails / max) * 100);
    var rate = x.seen ? Math.round((x.fails / x.seen) * 100) : 0;
    return '<div class="dla-mistake">' +
      '<div class="dla-mistake-top"><span>' + cqEsc(x.label) +
      (x.weight ? ' <small style="color:var(--mu);font-weight:500">' + x.weight + '%</small>' : '') + '</span>' +
      '<span class="dla-mistake-n">' + x.fails +
      ' <small>(' + rate + '% of audits)</small></span></div>' +
      '<div class="dla-bar"><div class="dla-bar-fill" style="width:' + w + '%"></div></div></div>';
  }).join('');
}

// ── By person
function cqRenderPeople(rows) {
  document.getElementById('cq-table-h').textContent = 'Score by ' + cqLabel().toLowerCase();
  document.getElementById('cq-thead').innerHTML =
    '<tr><th>' + cqLabel() + '</th><th style="text-align:center">Audits</th>' +
    '<th style="text-align:center">Critical</th><th style="text-align:center">Lowest</th>' +
    '<th style="text-align:center">Highest</th><th style="text-align:right">Collective %</th></tr>';

  var by = {};
  rows.forEach(function (r) {
    var k = r.consultant || '—';
    if (!by[k]) by[k] = { n: 0, sum: 0, crit: 0, min: 1e9, max: -1 };
    by[k].n++; by[k].sum += Number(r.score) || 0;
    if (r.critical) by[k].crit++;
    by[k].min = Math.min(by[k].min, Number(r.score) || 0);
    by[k].max = Math.max(by[k].max, Number(r.score) || 0);
  });

  var list = Object.keys(by).map(function (k) {
    var x = by[k];
    return { name: k, n: x.n, avg: x.sum / x.n, crit: x.crit, min: x.min, max: x.max };
  }).sort(function (a, b) { return b.avg - a.avg; });

  document.getElementById('cq-tbody').innerHTML = list.length ? list.map(function (p) {
    return '<tr><td><b>' + cqEsc(p.name) + '</b></td>' +
      '<td style="text-align:center">' + p.n + '</td>' +
      '<td style="text-align:center">' + (p.crit ? '<b style="color:var(--red)">' + p.crit + '</b>' : '0') + '</td>' +
      '<td style="text-align:center">' + cqRound(p.min) + '%</td>' +
      '<td style="text-align:center">' + cqRound(p.max) + '%</td>' +
      '<td style="text-align:right">' + cqPct(p.avg) + '</td></tr>';
  }).join('') : cqEmptyRow(6);
}

// ── Daily, with a running collective average per person
function cqRenderDaily(rows) {
  document.getElementById('cq-table-h').textContent = 'Daily audits per ' + cqLabel().toLowerCase();
  document.getElementById('cq-thead').innerHTML =
    '<tr><th>Date</th><th>' + cqLabel() + '</th><th style="text-align:center">Audits</th>' +
    '<th style="text-align:center">Day %</th><th style="text-align:center">To date</th>' +
    '<th style="text-align:right">Collective %</th></tr>';

  var g = {};
  rows.forEach(function (r) {
    if (!r.date || !r.consultant) return;
    var k = r.consultant + '||' + r.date;
    if (!g[k]) g[k] = { name: r.consultant, date: r.date, n: 0, sum: 0 };
    g[k].n++; g[k].sum += Number(r.score) || 0;
  });

  var list = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) {
    return a.name === b.name ? (a.date < b.date ? -1 : 1) : (a.name < b.name ? -1 : 1);
  });

  var run = {};
  document.getElementById('cq-tbody').innerHTML = list.length ? list.map(function (x) {
    if (!run[x.name]) run[x.name] = { n: 0, sum: 0 };
    run[x.name].n += x.n; run[x.name].sum += x.sum;
    return '<tr><td>' + cqEsc(x.date) + '</td>' +
      '<td><b>' + cqEsc(x.name) + '</b></td>' +
      '<td style="text-align:center">' + x.n + '</td>' +
      '<td style="text-align:center">' + cqPct(x.sum / x.n) + '</td>' +
      '<td style="text-align:center">' + run[x.name].n + '</td>' +
      '<td style="text-align:right">' + cqPct(run[x.name].sum / run[x.name].n) + '</td></tr>';
  }).join('') : cqEmptyRow(6);
}

// ── Monthly
function cqRenderMonthly(rows) {
  document.getElementById('cq-table-h').textContent = 'Monthly audits per ' + cqLabel().toLowerCase();
  document.getElementById('cq-thead').innerHTML =
    '<tr><th>Month</th><th>' + cqLabel() + '</th><th style="text-align:center">Audits</th>' +
    '<th style="text-align:center">Critical</th><th style="text-align:right">Monthly collective %</th></tr>';

  var g = {};
  rows.forEach(function (r) {
    if (!r.date || !r.consultant) return;
    var m = String(r.date).substring(0, 7);
    var k = r.consultant + '||' + m;
    if (!g[k]) g[k] = { name: r.consultant, month: m, n: 0, sum: 0, crit: 0 };
    g[k].n++; g[k].sum += Number(r.score) || 0;
    if (r.critical) g[k].crit++;
  });

  var list = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) {
    return a.month === b.month ? (a.name < b.name ? -1 : 1) : (a.month < b.month ? 1 : -1);
  });

  document.getElementById('cq-tbody').innerHTML = list.length ? list.map(function (x) {
    return '<tr><td>' + cqEsc(cqMonthLabel(x.month)) + '</td>' +
      '<td><b>' + cqEsc(x.name) + '</b></td>' +
      '<td style="text-align:center">' + x.n + '</td>' +
      '<td style="text-align:center">' + (x.crit ? '<b style="color:var(--red)">' + x.crit + '</b>' : '0') + '</td>' +
      '<td style="text-align:right">' + cqPct(x.sum / x.n) + '</td></tr>';
  }).join('') : cqEmptyRow(5);
}

// ── Auditor time: how long each auditor spent listening, per day
function cqRenderAuditorTime(rows) {
  document.getElementById('cq-table-h').textContent = 'Auditor time per day';
  document.getElementById('cq-thead').innerHTML =
    '<tr><th>Date</th><th>Auditor</th><th style="text-align:center">Audits</th>' +
    '<th style="text-align:center">Avg call</th><th style="text-align:right">Total time</th></tr>';

  var g = {};
  rows.forEach(function (r) {
    if (!r.date) return;
    var who = r.auditor || '—';
    var k = who + '||' + r.date;
    if (!g[k]) g[k] = { who: who, date: r.date, n: 0, mins: 0 };
    g[k].n++; g[k].mins += cqMins(r.duration);
  });

  var list = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) {
    return a.date === b.date ? (a.who < b.who ? -1 : 1) : (a.date < b.date ? 1 : -1);
  });

  if (!list.length) {
    document.getElementById('cq-tbody').innerHTML = cqEmptyRow(5);
    return;
  }

  var body = list.map(function (x) {
    return '<tr><td>' + cqEsc(x.date) + '</td>' +
      '<td><b>' + cqEsc(x.who) + '</b></td>' +
      '<td style="text-align:center">' + x.n + '</td>' +
      '<td style="text-align:center">' + cqMS(x.mins / x.n) + '</td>' +
      '<td style="text-align:right"><b>' + cqHM(x.mins) + '</b></td></tr>';
  }).join('');

  // Per-auditor totals across the whole filtered range
  var byWho = {};
  list.forEach(function (x) {
    if (!byWho[x.who]) byWho[x.who] = { n: 0, mins: 0 };
    byWho[x.who].n += x.n; byWho[x.who].mins += x.mins;
  });
  var totals = Object.keys(byWho).sort().map(function (w) {
    return '<tr style="background:var(--s2)"><td colspan="2"><b>' + cqEsc(w) + ' — range total</b></td>' +
      '<td style="text-align:center"><b>' + byWho[w].n + '</b></td>' +
      '<td style="text-align:center">' + cqMS(byWho[w].mins / byWho[w].n) + '</td>' +
      '<td style="text-align:right"><b>' + cqHM(byWho[w].mins) + '</b></td></tr>';
  }).join('');

  document.getElementById('cq-tbody').innerHTML = body + totals;
}

// ── All audits, newest first
function cqRenderAudits(rows) {
  document.getElementById('cq-table-h').textContent = 'All audits';
  document.getElementById('cq-thead').innerHTML =
    '<tr><th>Date</th><th>' + cqLabel() + '</th><th>Auditor</th><th>Ziwo ID(s)</th>' +
    '<th style="text-align:center">Duration</th><th style="text-align:right">Score</th></tr>';

  var list = rows.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });

  document.getElementById('cq-tbody').innerHTML = list.length ? list.map(function (r) {
    var name = cqEsc(r.consultant);
    if (r.link) name = '<a href="' + cqEsc(r.link) + '" target="_blank" rel="noopener" style="color:var(--ac);text-decoration:none">' + name + '</a>';
    return '<tr><td>' + cqEsc(r.date) + '</td>' +
      '<td><b>' + name + '</b>' + (r.critical ? ' <span style="color:var(--red);font-weight:700" title="Critical breach">⛔</span>' : '') + '</td>' +
      '<td>' + cqEsc(r.auditor) + '</td>' +
      '<td>' + cqEsc(r.ziwo) + '</td>' +
      '<td style="text-align:center">' + cqEsc(r.duration) + '</td>' +
      '<td style="text-align:right">' + cqPct(Number(r.score) || 0) + '</td></tr>';
  }).join('') : cqEmptyRow(6);
}

/* ── EXPORT (respects the current filters) ──────────────────── */
function cqExportCSV() {
  var rows = cqLastRows;
  if (!rows || !rows.length) { alert('Nothing to export for the current filters.'); return; }
  var crit = cqCrit();

  var head = ['Date', cqLabel(), 'Auditor', 'Ziwo ID(s)', 'Duration', 'Critical', 'Score %']
    .concat(crit.map(function (c) { return c.label; }));

  var lines = [head];
  rows.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (r) {
    var line = [r.date, r.consultant, r.auditor, r.ziwo, r.duration, r.critical ? 'YES' : '', r.score];
    crit.forEach(function (c, i) {
      var v = (r.checks || [])[i];
      line.push(v === 1 ? 'Pass' : v === 0 ? 'Fail' : 'N/A');
    });
    lines.push(line);
  });

  var csv = lines.map(function (row) {
    return row.map(function (cell) {
      var s = String(cell == null ? '' : cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\n');

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'calls-qa-' + cqTeam + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
