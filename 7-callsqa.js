// ══════════════════════════════════════════════════════════════════
//  CALLS QUALITY TAB  —  Sales Calls QA + Service Calls QA
//  Two Apps Script JSON feeds. Each returns:
//    { ok, team, criteria:[{id,label,weight}], rows:[ {...} ] }
//    row = { date:'yyyy-mm-dd', consultant, auditor, ziwo, link, duration,
//            comment, critical, score, checks:[] }
//    check values: 1 = full marks, 0 = points lost, -1 = N/A
// ══════════════════════════════════════════════════════════════════
const CQ_API = {
  sales:   'https://script.google.com/macros/s/AKfycbx3x_NPlRgy2QTcRz7_K4yX9Y8G39sBcKT-wtXSwZhjg-d2lrS-8C9NbP2IAe4qyyCrYg/exec',
  service: 'https://script.google.com/macros/s/AKfycbxJsDV0MVNC7rJGqrlkcYS12mEvryIHuLzrwrKbkQsF5mAkXTWsJnhtleC5TIo5t2IP/exec'
};

var cqData   = { sales: null, service: null };   // cached feed per team
var cqTeam   = 'sales';                          // 'sales' | 'service'
var cqView   = 'people';                         // people | daily | monthly | audits
var _cqLoaded = false;

// go() in 1-core.js sends unknown tabs to loadCM(); marking this tab as
// already-loaded keeps it out of that path. Our own loader runs from the wrap below.
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
  if (cqData[team]) { cqRender(); return; }

  cqSetUpdated('Loading ' + (team === 'sales' ? 'sales' : 'service') + ' audits…');
  cqHideError();

  fetch(CQ_API[team], { redirect: 'follow' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (t) {
      if (!t || t.trim() === '') throw new Error('Empty response from Apps Script');
      if (t.trim().charAt(0) === '<') throw new Error('Got HTML not JSON — redeploy the script as a new version (Execute as Me, Anyone can access)');
      var j = JSON.parse(t);
      if (!j.ok) throw new Error(j.error || 'Apps Script returned an error');
      cqData[team] = j;
      cqRender();
    })
    .catch(function (e) { cqError(e.message); });
}

function cqRefresh() { cqData[cqTeam] = null; cqLoad(); }

function cqSetTeam(team) {
  cqTeam = team;
  ['sales', 'service'].forEach(function (t) {
    var b = document.getElementById('cq-seg-' + t);
    if (b) b.classList.toggle('on', t === team);
  });
  cqLoad();
}

function cqSetView(v) {
  cqView = v;
  ['people', 'daily', 'monthly', 'audits'].forEach(function (x) {
    var b = document.getElementById('cq-view-' + x);
    if (b) b.classList.toggle('on', x === v);
  });
  cqRender();
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

/* ── HELPERS ────────────────────────────────────────────────── */
function cqRows()  { var d = cqData[cqTeam]; return (d && d.rows) || []; }
function cqCrit()  { var d = cqData[cqTeam]; return (d && d.criteria) || []; }
function cqRound(v){ return Math.round(v * 10) / 10; }
function cqLabel() { return cqTeam === 'sales' ? 'Consultant' : 'Case Manager'; }
function cqEsc(s)  {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
  });
}
// Same colour thresholds the rest of the dashboard uses.
function cqClr(p) { return p >= 90 ? 'var(--grn)' : p >= 80 ? 'var(--amb)' : 'var(--red)'; }
function cqPct(p) { return '<b style="color:' + cqClr(p) + '">' + cqRound(p) + '%</b>'; }
function cqMonthLabel(key) {
  var p = key.split('-');
  var names = ['January','February','March','April','May','June',
               'July','August','September','October','November','December'];
  return (names[parseInt(p[1], 10) - 1] || p[1]) + ' ' + p[0];
}
function cqEmpty(cols) {
  return '<tr><td colspan="' + cols + '" style="text-align:center;padding:28px;color:var(--mu);font-size:12px">No audits yet</td></tr>';
}

/* ── RENDER ─────────────────────────────────────────────────── */
function cqRender() {
  cqHideError();
  var rows = cqRows();

  // KPIs
  var total = rows.length;
  var sum = 0, crit = 0, people = {};
  rows.forEach(function (r) {
    sum += Number(r.score) || 0;
    if (r.critical) crit++;
    if (r.consultant) people[r.consultant] = 1;
  });
  var avg = total ? cqRound(sum / total) : 0;

  document.getElementById('cq-k-audits').textContent   = total;
  document.getElementById('cq-k-people').textContent   = Object.keys(people).length;
  document.getElementById('cq-k-critical').textContent = crit;
  var kAvg = document.getElementById('cq-k-avg');
  kAvg.textContent = total ? avg + '%' : '—';
  kAvg.style.color = total ? cqClr(avg) : '';

  cqSetUpdated((cqTeam === 'sales' ? 'Sales Calls QA' : 'Service Calls QA') +
               ' · ' + total + ' audit' + (total === 1 ? '' : 's') +
               ' · updated ' + new Date().toLocaleTimeString());

  if (cqView === 'people')       cqRenderPeople(rows);
  else if (cqView === 'daily')   cqRenderDaily(rows);
  else if (cqView === 'monthly') cqRenderMonthly(rows);
  else                           cqRenderAudits(rows);

  cqRenderAttributes(rows);
  cqUpdateNavCount(total);
}

function cqUpdateNavCount(n) {
  var el = document.getElementById('nc-calls');
  if (el) el.textContent = n;
}

// ── By person: audits, collective score, best/worst day
function cqRenderPeople(rows) {
  document.getElementById('cq-table-h').textContent = 'Score by ' + cqLabel().toLowerCase();
  document.getElementById('cq-thead').innerHTML =
    '<tr><th>' + cqLabel() + '</th><th style="text-align:center">Audits</th>' +
    '<th style="text-align:center">Critical</th><th style="text-align:center">Lowest</th>' +
    '<th style="text-align:center">Highest</th><th style="text-align:right">Collective %</th></tr>';

  var by = {};
  rows.forEach(function (r) {
    var k = r.consultant || '—';
    if (!by[k]) by[k] = { n: 0, sum: 0, crit: 0, min: 999, max: -1 };
    by[k].n++; by[k].sum += Number(r.score) || 0;
    if (r.critical) by[k].crit++;
    by[k].min = Math.min(by[k].min, Number(r.score) || 0);
    by[k].max = Math.max(by[k].max, Number(r.score) || 0);
  });

  var list = Object.keys(by).map(function (k) {
    var x = by[k]; return { name: k, n: x.n, avg: x.sum / x.n, crit: x.crit, min: x.min, max: x.max };
  }).sort(function (a, b) { return b.avg - a.avg; });

  document.getElementById('cq-tbody').innerHTML = list.length ? list.map(function (p) {
    return '<tr><td><b>' + cqEsc(p.name) + '</b></td>' +
      '<td style="text-align:center">' + p.n + '</td>' +
      '<td style="text-align:center">' + (p.crit ? '<b style="color:var(--red)">' + p.crit + '</b>' : '0') + '</td>' +
      '<td style="text-align:center">' + cqRound(p.min) + '%</td>' +
      '<td style="text-align:center">' + cqRound(p.max) + '%</td>' +
      '<td style="text-align:right">' + cqPct(p.avg) + '</td></tr>';
  }).join('') : cqEmpty(6);
}

// ── Daily: per person per day, with the running collective average
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
  }).join('') : cqEmpty(6);
}

// ── Monthly: per person per month
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
  }).join('') : cqEmpty(5);
}

// ── All audits: newest first
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
      '<td><b>' + name + '</b>' + (r.critical ? ' <span style="color:var(--red);font-weight:700">⛔</span>' : '') + '</td>' +
      '<td>' + cqEsc(r.auditor) + '</td>' +
      '<td>' + cqEsc(r.ziwo) + '</td>' +
      '<td style="text-align:center">' + cqEsc(r.duration) + '</td>' +
      '<td style="text-align:right">' + cqPct(Number(r.score) || 0) + '</td></tr>';
  }).join('') : cqEmpty(6);
}

// ── Attribute pass rates (which criteria fail most)
function cqRenderAttributes(rows) {
  var crit = cqCrit();
  document.getElementById('cq-attr-h').textContent =
    'Attribute performance — ' + (cqTeam === 'sales' ? 'Sales' : 'Service');

  if (!crit.length || !rows.length) {
    document.getElementById('cq-attr-tbody').innerHTML = cqEmpty(5);
    return;
  }

  var pass = crit.map(function () { return 0; });
  var fail = crit.map(function () { return 0; });
  rows.forEach(function (r) {
    (r.checks || []).forEach(function (v, i) {
      if (i >= crit.length) return;
      if (v === 1) pass[i]++;
      else if (v === 0) fail[i]++;
    });
  });

  var list = crit.map(function (c, i) {
    var tot = pass[i] + fail[i];
    return { label: c.label, weight: c.weight, pass: pass[i], fail: fail[i],
             rate: tot ? (pass[i] / tot) * 100 : 100 };
  }).sort(function (a, b) { return a.rate - b.rate; });

  document.getElementById('cq-attr-tbody').innerHTML = list.map(function (a) {
    return '<tr><td>' + cqEsc(a.label) + '</td>' +
      '<td style="text-align:center">' + (a.weight ? a.weight + '%' : '—') + '</td>' +
      '<td style="text-align:center">' + a.pass + '</td>' +
      '<td style="text-align:center">' + (a.fail ? '<b style="color:var(--red)">' + a.fail + '</b>' : '0') + '</td>' +
      '<td style="text-align:right">' + cqPct(a.rate) + '</td></tr>';
  }).join('');
}

/* ── EXPORT ─────────────────────────────────────────────────── */
function cqExportCSV() {
  var rows = cqRows();
  if (!rows.length) { alert('Nothing to export yet.'); return; }
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
