// ══════════════════════════════════════════════════════════════════
//  CONSULTANT ACTIVITY (HubSpot)  —  left-rail drawer
//  Fetches HubSpotReport.gs JSON and renders 9 "by consultant" charts.
// ══════════════════════════════════════════════════════════════════
const HS_API = 'https://script.google.com/macros/s/AKfycbxG5ghx0PspA8mZtpXZvTE8hURwlpS5l16h5vPMYGfvBwPprrlw-1PTSs2zTcX-6ezb0w/exec';

var hsOpen   = false;
var hsDays   = 7;
var hsLoaded = false;

// Widget order + titles (keys match the JSON `widgets` object)
var HS_WIDGETS = [
  { key: 'calls',          title: 'Calls',           win: true },
  { key: 'emails',         title: 'Emails sent',     win: true },
  { key: 'dealsCreated',   title: 'Deals created',   win: true },
  { key: 'tasksCreated',   title: 'Tasks created',   win: true },
  { key: 'tasksCompleted', title: 'Tasks completed', win: true },
  { key: 'overdueTasks',   title: 'Overdue tasks',   win: false },
  { key: 'totalContacts',  title: 'Total contacts',  win: false },
  { key: 'dealsWon',       title: 'Payment made / deal won', win: true },
  { key: 'leadStage',      title: 'Lead stage distribution', win: false, label: 'stage' }
];

function toggleHSReport() {
  hsOpen = !hsOpen;
  var d = document.getElementById('hsDrawer'), o = document.getElementById('hsOverlay');
  if (d) d.style.right = hsOpen ? '0' : '-1040px';
  if (o) o.style.display = hsOpen ? 'block' : 'none';
  if (hsOpen && !hsLoaded) { hsLoaded = true; hsLoad(); }
}

function hsSetDays(d) {
  hsDays = d;
  document.querySelectorAll('#hs-win .hs-chip').forEach(function (c) {
    c.classList.toggle('on', parseInt(c.getAttribute('data-d'), 10) === d);
  });
  hsLoad();
}
function hsRefresh() { hsLoad(true); }

function hsLoad(force) {
  var body = document.getElementById('hs-body');
  var sub  = document.getElementById('hs-sub');
  if (sub) sub.textContent = 'Loading from HubSpot…';
  if (body) body.innerHTML =
    '<div class="hs-loading"><div class="hs-spin"></div>' +
    '<div>Counting activity across consultants…<br><span class="hs-mu">First load can take ~30–45s, then it\'s cached.</span></div></div>';

  var url = HS_API + '?days=' + hsDays + (force ? '&refresh=1' : '');
  fetch(url, { redirect: 'follow' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (t) {
      if (!t || t.trim() === '') throw new Error('Empty response');
      if (t.trim().charAt(0) === '<') throw new Error('Got HTML not JSON — redeploy the script (Execute as Me, Anyone)');
      var j = JSON.parse(t);
      if (!j.ok) throw new Error(j.error || 'Script error');
      hsRender(j);
    })
    .catch(function (e) {
      if (body) body.innerHTML = '<div class="hs-err">⚠️ ' + hsEsc(e.message) + '</div>';
      if (sub) sub.textContent = 'Error';
    });
}

function hsRender(j) {
  var sub = document.getElementById('hs-sub');
  if (sub) {
    var when = '';
    try { when = new Date(j.generatedAt).toLocaleString(); } catch (e) {}
    sub.textContent = (j.owners ? j.owners.length : 0) + ' consultants · last ' + j.windowDays + ' days · updated ' + when;
  }
  var body = document.getElementById('hs-body'); if (!body) return;

  body.innerHTML = HS_WIDGETS.map(function (w) {
    var rows = (j.widgets && j.widgets[w.key]) || [];
    var labelKey = w.label || 'name';
    var winTag = w.win ? '<span class="hs-card-win">last ' + j.windowDays + 'd</span>' : '<span class="hs-card-win">all time</span>';
    return '<div class="hs-card">' +
      '<div class="hs-card-h">' + hsEsc(w.title) + winTag + '</div>' +
      '<div class="hs-bars">' + hsBars(rows, labelKey) + '</div>' +
      '</div>';
  }).join('');
}

function hsBars(rows, labelKey) {
  rows = rows || [];
  if (!rows.length) return '<div class="hs-empty">No data in this period</div>';
  var max = rows.reduce(function (m, r) { return Math.max(m, r.count || 0); }, 0) || 1;
  return rows.map(function (r) {
    var v = r.count || 0;
    var w = Math.max(2, Math.round((v / max) * 100));
    return '<div class="hs-row">' +
      '<div class="hs-label" title="' + hsEsc(r[labelKey]) + '">' + hsEsc(r[labelKey]) + '</div>' +
      '<div class="hs-track"><div class="hs-fill" style="width:' + w + '%"></div></div>' +
      '<div class="hs-val">' + v + '</div></div>';
  }).join('');
}

function hsEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
