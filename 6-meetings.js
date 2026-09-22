// ══════════════════════════════════════════════════════════════
//  MEETINGS — brainstorm sessions, as a month calendar
//  Inside CM Activity Compliance. Same fetch and render shape as
//  3-casemanagers-activity.js, and the dashboard's own tokens throughout.
//
//  Only BRAINSTORMS are listed. General meetings carry no writer or case
//  manager — the generator does not ask for them — so they cannot be
//  attributed to anyone and would only pad the calendar. They are still
//  counted, so the totals stay honest about what was booked.
// ══════════════════════════════════════════════════════════════

var meetAllRows     = [];   // every booking that came back
var meetWriters     = [];
var meetCMs         = [];
var meetLoaded      = false;
var meetColsMissing = [];
var meetLastUrl     = '';
var meetMonth       = null; // first day of the month on screen

// ── Load ──
function loadMeetings(force) {
  if (meetLoaded && !force) { meetRender(); return; }
  if (typeof APIS === 'undefined' || !APIS.meetings) {
    cmHTML('meet-body', '<div style="padding:18px;text-align:center;color:var(--mu);font-size:12.5px">No meetings endpoint configured. Add <b>meetings</b> to the APIS block in <b>1-core.js</b>.</div>');
    return;
  }

  var url = String(APIS.meetings);
  if (url.indexOf('mode=meetings') === -1) url += (url.indexOf('?') === -1 ? '?' : '&') + 'mode=meetings';
  meetLastUrl = url;

  if (typeof showLdr === 'function') showLdr('Loading meetings…');

  fetch(url, { redirect: 'follow' })
    .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
    .then(function (raw) {
      if (!raw || raw.trim() === '') throw new Error('Empty response from Apps Script');
      if (raw.trim().charAt(0) === '<') throw new Error('Got HTML not JSON — redeploy: Execute as Me, Anyone can access');
      return JSON.parse(raw);
    })
    .then(function (json) {
      if (!json.ok) throw new Error(json.error || 'Apps Script error');
      meetColsMissing = json.columnsMissing || [];

      meetAllRows = (json.meetings || []).map(function (m) {
        return {
          date:         m.date || '',
          time:         m.time || '',
          type:         m.type || 'General',
          isBrainstorm: /brainstorm/i.test(m.type || ''),
          caseManager:  m.caseManager || '',
          writer:       m.writer || '',
          consultant:   m.consultant || '',
          client:       m.client || '',
          link:         m.link || '',
          record:       m.record || '',
          recording:    m.recording || ''
        };
      });

      var bs = meetAllRows.filter(function (r) { return r.isBrainstorm; });
      meetWriters = meetUnique(bs, 'writer');
      meetCMs     = meetUnique(bs, 'caseManager');

      meetFillSelect('meetWriterFilter', meetWriters, 'All writers');
      meetFillSelect('meetCMFilter', meetCMs, 'All case managers');

      // open on the month of the most recent brainstorm, or this month
      if (!meetMonth) {
        var newest = bs.length ? bs[0].date : '';
        var d = newest ? new Date(newest + 'T00:00:00') : new Date();
        meetMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      }

      meetLoaded = true;
      meetRender();
    })
    .catch(function (err) {
      cmHTML('meet-body',
        '<div style="padding:14px 16px;border-radius:12px;background:var(--gl);border:1px solid var(--red);font-size:12.5px">' +
          '<b style="color:var(--red)">Could not load meetings — ' + meetEsc(err.message) + '</b>' +
          '<div style="color:var(--mu);margin-top:9px">It asked for:</div>' +
          '<div style="margin-top:3px"><a href="' + meetEsc(meetLastUrl) + '" target="_blank" rel="noopener" style="color:var(--ac);word-break:break-all;font-family:\'DM Mono\',monospace;font-size:11px">' + meetEsc(meetLastUrl) + '</a></div>' +
          '<div style="color:var(--mu);margin-top:9px;line-height:1.7">If that link works in a tab but not here, the deployment is not set to <b>Anyone</b>. A browser tab is signed in; this fetch is not, and Apps Script answers an unauthorised request with a 404.</div>' +
        '</div>');
    })
    .finally(function () { if (typeof hideLdr === 'function') hideLdr(); });
}

function meetUnique(rows, key) {
  var seen = {};
  rows.forEach(function (r) { if (r[key]) seen[r[key]] = 1; });
  return Object.keys(seen).sort();
}
function meetFillSelect(id, names, allLabel) {
  var sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = '<option value="all">' + allLabel + '</option>' +
    names.map(function (n) { return '<option value="' + meetEsc(n) + '">' + meetEsc(n) + '</option>'; }).join('');
}

// ── Filtering — brainstorms only ──
function meetGetFiltered() {
  var rows = meetAllRows.filter(function (r) { return r.isBrainstorm; });

  var w = (document.getElementById('meetWriterFilter') || {}).value || 'all';
  if (w !== 'all') rows = rows.filter(function (r) { return r.writer === w; });

  var c = (document.getElementById('meetCMFilter') || {}).value || 'all';
  if (c !== 'all') rows = rows.filter(function (r) { return r.caseManager === c; });

  var q = ((document.getElementById('meetSearch') || {}).value || '').trim().toLowerCase();
  if (q) rows = rows.filter(function (r) {
    return (r.client + ' ' + r.writer + ' ' + r.caseManager + ' ' + r.consultant).toLowerCase().indexOf(q) !== -1;
  });
  return rows;
}

function meetShiftMonth(n) {
  if (!meetMonth) meetMonth = new Date();
  meetMonth = new Date(meetMonth.getFullYear(), meetMonth.getMonth() + n, 1);
  meetRender();
}
function meetToday() {
  var t = new Date();
  meetMonth = new Date(t.getFullYear(), t.getMonth(), 1);
  meetRender();
}
function meetClearFilters() {
  ['meetWriterFilter', 'meetCMFilter'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = 'all';
  });
  var s = document.getElementById('meetSearch'); if (s) s.value = '';
  meetRender();
}

// ── Render ──
var MEET_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function meetRender() {
  var rows = meetGetFiltered();
  var allBookings = meetAllRows.length;
  var thisMonth = rows.filter(function (r) { return meetInMonth(r.date); });

  cmText('meet-kpi-total', rows.length);
  cmText('meet-kpi-month', thisMonth.length);
  cmText('meet-kpi-writers', meetUnique(rows, 'writer').length);
  cmText('meet-kpi-cms', meetUnique(rows, 'caseManager').length);

  cmText('meet-month-label', meetMonth ? MEET_MONTHS[meetMonth.getMonth()] + ' ' + meetMonth.getFullYear() : '');
  cmText('meet-count', rows.length + ' brainstorm' + (rows.length !== 1 ? 's' : '') +
    ' · ' + allBookings + ' meetings booked in total');

  cmHTML('meet-by-writer', meetCountTable(rows, 'writer'));
  cmHTML('meet-by-cm', meetCountTable(rows, 'caseManager'));
  cmHTML('meet-cal', meetCalendar(rows));

  var warn = document.getElementById('meet-warn');
  if (warn) {
    var important = meetColsMissing.filter(function (c) { return c === 'caseManager' || c === 'writer' || c === 'when'; });
    warn.innerHTML = important.length
      ? '<div style="padding:11px 14px;border-radius:12px;background:var(--gl);border:1px solid var(--b);color:var(--tx);font-size:12px;margin-bottom:14px">' +
        '<b style="color:var(--red)">The sheet is missing: ' + important.join(', ') + '.</b> ' +
        'Those columns come back blank, so filtering by that person finds nothing — it does not mean no meetings were booked.</div>'
      : '';
  }
}

function meetInMonth(dateStr) {
  if (!meetMonth || !dateStr) return false;
  var d = new Date(dateStr + 'T00:00:00');
  return d.getFullYear() === meetMonth.getFullYear() && d.getMonth() === meetMonth.getMonth();
}

// ── The calendar ──
function meetCalendar(rows) {
  if (!meetMonth) return '';

  var byDay = {};
  rows.forEach(function (r) { if (r.date) (byDay[r.date] = byDay[r.date] || []).push(r); });
  Object.keys(byDay).forEach(function (k) {
    byDay[k].sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
  });

  var y = meetMonth.getFullYear(), m = meetMonth.getMonth();
  var first = new Date(y, m, 1);
  var start = new Date(y, m, 1 - first.getDay());          // back to the Sunday
  var todayKey = meetKey(new Date());

  var DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--b);border:1px solid var(--b);border-radius:12px;overflow:hidden">';

  html += DOW.map(function (d) {
    return '<div style="background:var(--s2);padding:8px 10px;font-size:9.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--mu);font-family:\'DM Mono\',monospace;text-align:center">' + d + '</div>';
  }).join('');

  for (var i = 0; i < 42; i++) {
    var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    var key = meetKey(day);
    var inMonth = day.getMonth() === m;
    var isToday = key === todayKey;
    var items = byDay[key] || [];

    // stop after the last full week that still contains this month
    if (i >= 35 && day.getMonth() !== m) break;

    html += '<div style="background:var(--s1,var(--bg,transparent));min-height:96px;padding:6px 7px;' +
      (inMonth ? '' : 'opacity:.38;') + '">' +
      '<div style="font-size:11px;font-weight:' + (isToday ? '800' : '600') + ';font-family:\'DM Mono\',monospace;' +
        'color:' + (isToday ? 'var(--ac)' : 'var(--mu)') + ';margin-bottom:5px;text-align:right">' +
        (isToday ? '<span style="background:var(--al);padding:1px 6px;border-radius:20px">' + day.getDate() + '</span>' : day.getDate()) +
      '</div>' +
      items.map(meetChip).join('') +
    '</div>';
  }
  html += '</div>';

  if (!rows.length) {
    html += '<div style="padding:16px;text-align:center;color:var(--mu);font-size:12px">' +
      'No brainstorm sessions match these filters. General meetings are counted above but not shown here — the generator does not record who is on them.</div>';
  }
  return html;
}

function meetChip(r) {
  var who = (r.writer || '').split(' ')[0];
  var title = r.time + ' · ' + r.writer + ' with ' + r.caseManager + (r.client ? ' · ' + r.client : '');
  var inner =
    '<div style="font-size:9.5px;font-family:\'DM Mono\',monospace;opacity:.8;line-height:1.3">' + meetEsc(r.time) + '</div>' +
    '<div style="font-size:10.5px;font-weight:700;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + meetEsc(who) + '</div>' +
    '<div style="font-size:9.5px;opacity:.75;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + meetEsc(r.client) + '</div>';
  var style = 'display:block;background:var(--al);color:var(--ac);border-left:2px solid var(--ac);' +
    'border-radius:4px;padding:3px 6px;margin-bottom:3px;text-decoration:none;font-family:\'Nunito\',sans-serif';
  return r.link
    ? '<a href="' + meetEsc(r.link) + '" target="_blank" rel="noopener" title="' + meetEsc(title) + '" style="' + style + '">' + inner + '</a>'
    : '<div title="' + meetEsc(title) + '" style="' + style + '">' + inner + '</div>';
}

function meetKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ── Per-person counts, using the dashboard's own bar ──
function meetCountTable(rows, key) {
  var list = [];
  var counts = {};
  rows.forEach(function (r) { if (r[key]) counts[r[key]] = (counts[r[key]] || 0) + 1; });
  list = Object.keys(counts).map(function (n) { return { name: n, n: counts[n] }; })
    .sort(function (a, b) { return b.n - a.n; });
  if (!list.length) return '<div style="padding:14px;text-align:center;color:var(--mu);font-size:12px">Nothing for these filters.</div>';

  var max = list[0].n || 1;
  return '<table style="width:100%;border-collapse:collapse;font-size:12.5px;font-family:\'Nunito\',sans-serif">' +
    list.map(function (x) {
      return '<tr>' +
        '<td style="padding:6px 0;border-top:1px solid var(--b);color:var(--tx)">' + meetEsc(x.name) + '</td>' +
        '<td class="mono" style="padding:6px 0;border-top:1px solid var(--b);text-align:right;width:42px;font-weight:700;color:var(--tx)">' + x.n + '</td>' +
        '<td style="padding:6px 0 6px 10px;border-top:1px solid var(--b);width:44%">' +
          '<div class="pct-bar"><div class="pct-fill" style="width:' + Math.round((x.n / max) * 100) + '%;background:var(--ac)"></div></div>' +
        '</td></tr>';
    }).join('') + '</table>';
}

function meetExportCSV() {
  var rows = meetGetFiltered();
  var head = ['Date', 'Time', 'Case manager', 'Petition writer', 'Consultant', 'Client', 'Meet link', 'HubSpot', 'Recording'];
  var csv = [head.join(',')].concat(rows.map(function (r) {
    return [r.date, r.time, r.caseManager, r.writer, r.consultant, r.client, r.link, r.record, r.recording]
      .map(function (v) { return '"' + String(v || '').replace(/"/g, '""') + '"'; }).join(',');
  })).join('\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'brainstorms-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}

function meetEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
