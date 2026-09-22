// ══════════════════════════════════════════════════════════════
//  MEETINGS — inside CM Activity Compliance
//  Follows the same shape as 3-casemanagers-activity.js: fetch from an
//  Apps Script /exec, flatten to rows, filter, render.
// ══════════════════════════════════════════════════════════════

// State
var meetAllRows   = [];     // every booking
var meetWriters   = [];     // writer names present in the data
var meetCMs       = [];     // case manager names present in the data
var meetLoaded    = false;
var meetColsMissing = [];
var meetLastUrl   = '';

// ── Load ──
function loadMeetings(force) {
  if (meetLoaded && !force) { meetRender(); return; }
  if (typeof APIS === 'undefined' || !APIS.meetings) {
    cmHTML('meet-body', '<div style="padding:18px;text-align:center;color:var(--mu);font-size:12.5px">No meetings endpoint configured. Add <b>meetings</b> to the APIS block in <b>1-core.js</b>.</div>');
    return;
  }

  /* The script answers two things at one address and tells them apart by ?mode=meetings.
     Without it the status check comes back instead of the bookings, so it is added here
     if it was left off. */
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
          when:        m.when || '',
          date:        m.date || '',
          time:        m.time || '',
          dateObj:     m.when ? new Date(m.when) : null,
          type:        m.type || 'General',
          isBrainstorm: /brainstorm/i.test(m.type || ''),
          caseManager: m.caseManager || '',
          writer:      m.writer || '',
          consultant:  m.consultant || '',
          client:      m.client || '',
          link:        m.link || '',
          record:      m.record || '',
          recording:   m.recording || '',
          notes:       m.notes || ''
        };
      });

      var wSet = {}, cSet = {};
      meetAllRows.forEach(function (r) {
        if (r.writer) wSet[r.writer] = 1;
        if (r.caseManager) cSet[r.caseManager] = 1;
      });
      meetWriters = Object.keys(wSet).sort();
      meetCMs     = Object.keys(cSet).sort();

      var wSel = document.getElementById('meetWriterFilter');
      if (wSel) wSel.innerHTML = '<option value="all">All writers</option>' +
        meetWriters.map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');

      var cSel = document.getElementById('meetCMFilter');
      if (cSel) cSel.innerHTML = '<option value="all">All case managers</option>' +
        meetCMs.map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');

      meetLoaded = true;
      meetRender();
    })
    .catch(function (err) {
      /* A bare "HTTP 404" is not actionable. Showing the address it actually asked for
         usually makes the cause obvious straight away: a stale deployment id in
         1-core.js, or the browser holding an old copy of that file. */
      cmHTML('meet-body',
        '<div style="padding:14px 16px;border-radius:12px;background:var(--gl);border:1px solid var(--red);font-size:12.5px">' +
          '<b style="color:var(--red)">Could not load meetings — ' + meetEsc(err.message) + '</b>' +
          '<div style="color:var(--mu);margin-top:9px">It asked for:</div>' +
          '<div style="margin-top:3px"><a href="' + meetEsc(meetLastUrl) + '" target="_blank" rel="noopener" style="color:var(--ac);word-break:break-all;font-family:\'DM Mono\',monospace;font-size:11px">' + meetEsc(meetLastUrl) + '</a></div>' +
          '<div style="color:var(--mu);margin-top:9px;line-height:1.7">' +
            'Open that link. If it returns the bookings, the address in <b>1-core.js</b> differs from the one that works &mdash; ' +
            'check for a stale deployment id, and hard-refresh with Ctrl+Shift+R so the browser drops its cached copy of that file.' +
          '</div>' +
        '</div>');
    })
    .finally(function () { if (typeof hideLdr === 'function') hideLdr(); });
}

// ── Filtering ──
function meetGetFiltered() {
  var rows = meetAllRows.slice();

  var type = (document.getElementById('meetTypeFilter') || {}).value || 'all';
  if (type === 'brainstorm') rows = rows.filter(function (r) { return r.isBrainstorm; });
  else if (type === 'general') rows = rows.filter(function (r) { return !r.isBrainstorm; });

  var w = (document.getElementById('meetWriterFilter') || {}).value || 'all';
  if (w !== 'all') rows = rows.filter(function (r) { return r.writer === w; });

  var c = (document.getElementById('meetCMFilter') || {}).value || 'all';
  if (c !== 'all') rows = rows.filter(function (r) { return r.caseManager === c; });

  var from = (document.getElementById('meetFrom') || {}).value || '';
  var to   = (document.getElementById('meetTo') || {}).value   || '';
  if (from) rows = rows.filter(function (r) { return r.date && r.date >= from; });
  if (to)   rows = rows.filter(function (r) { return r.date && r.date <= to; });

  var q = ((document.getElementById('meetSearch') || {}).value || '').trim().toLowerCase();
  if (q) rows = rows.filter(function (r) {
    return (r.client + ' ' + r.writer + ' ' + r.caseManager + ' ' + r.notes).toLowerCase().indexOf(q) !== -1;
  });

  return rows;
}

function meetSetRange(days) {
  var end = new Date(), start = new Date();
  if (days === 0) { start = end; }                                  // today
  else if (days === -1) { start = new Date(end.getFullYear(), end.getMonth(), 1); }  // this month
  else { start.setDate(end.getDate() - days); }
  var f = document.getElementById('meetFrom'), t = document.getElementById('meetTo');
  if (f) f.value = start.toISOString().slice(0, 10);
  if (t) t.value = end.toISOString().slice(0, 10);
  meetRender();
}
function meetClearFilters() {
  ['meetTypeFilter', 'meetWriterFilter', 'meetCMFilter'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = 'all';
  });
  ['meetFrom', 'meetTo', 'meetSearch'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  meetRender();
}

// ── Render ──
function meetRender() {
  var rows = meetGetFiltered();
  var brainstorms = rows.filter(function (r) { return r.isBrainstorm; }).length;

  cmText('meet-kpi-total', rows.length);
  cmText('meet-kpi-brainstorm', brainstorms);
  cmText('meet-kpi-general', rows.length - brainstorms);
  cmText('meet-kpi-writers', Object.keys(rows.reduce(function (a, r) { if (r.writer) a[r.writer] = 1; return a; }, {})).length);

  // Per-person counts — the point of the panel: who is actually taking meetings
  cmHTML('meet-by-writer', meetCountTable(rows.filter(function (r) { return r.writer; }), 'writer', 'Petition writer'));
  cmHTML('meet-by-cm',     meetCountTable(rows.filter(function (r) { return r.caseManager; }), 'caseManager', 'Case manager'));

  // The bookings themselves
  if (!rows.length) {
    cmHTML('meet-tb', '<tr><td colspan="6" style="padding:26px;text-align:center;color:var(--mu);font-size:12.5px">No meetings match these filters.</td></tr>');
  } else {
    var TD = 'padding:9px 10px;border-top:1px solid var(--b);color:var(--tx);vertical-align:top';
    cmHTML('meet-tb', rows.map(function (r) {
      return '<tr>' +
        '<td class="mono" style="' + TD + '">' + meetEsc(r.date) +
          '<span style="display:block;font-size:10.5px;color:var(--mu)">' + meetEsc(r.time) + '</span></td>' +
        '<td style="' + TD + '">' +
          (r.isBrainstorm
            ? '<span style="font-size:9px;font-weight:700;letter-spacing:.5px;background:var(--al);color:var(--ac);padding:2px 7px;border-radius:5px;font-family:\'DM Mono\',monospace">BRAINSTORM</span>'
            : '<span style="font-size:9px;font-weight:700;letter-spacing:.5px;background:var(--gl);color:var(--mu);padding:2px 7px;border-radius:5px;font-family:\'DM Mono\',monospace">GENERAL</span>') + '</td>' +
        '<td style="' + TD + '">' + (meetEsc(r.caseManager) || '<span style="color:var(--mu)">—</span>') + '</td>' +
        '<td style="' + TD + '">' + (meetEsc(r.writer) || '<span style="color:var(--mu)">—</span>') + '</td>' +
        '<td style="' + TD + '">' + (meetEsc(r.client) || '<span style="color:var(--mu)">—</span>') +
          (r.consultant ? '<span style="display:block;font-size:10.5px;color:var(--mu)">' + meetEsc(r.consultant) + '</span>' : '') + '</td>' +
        '<td style="' + TD + '">' +
          (r.link ? '<a href="' + meetEsc(r.link) + '" target="_blank" rel="noopener" style="color:var(--ac);text-decoration:none;font-weight:600">Meet</a>' : '<span style="color:var(--mu)">—</span>') +
          (r.record ? ' <a href="' + meetEsc(r.record) + '" target="_blank" rel="noopener" style="color:var(--mu);text-decoration:none">HubSpot</a>' : '') +
          (r.recording ? ' <a href="' + meetEsc(r.recording) + '" target="_blank" rel="noopener" style="color:var(--grn);text-decoration:none;font-weight:600">Recording</a>' : '') +
        '</td>' +
      '</tr>';
    }).join(''));
  }
  cmText('meet-count', rows.length + ' meeting' + (rows.length !== 1 ? 's' : ''));

  // A missing column must not look like nobody booked anything
  var warn = document.getElementById('meet-warn');
  if (warn) {
    var important = meetColsMissing.filter(function (c) { return c === 'caseManager' || c === 'writer' || c === 'when'; });
    warn.innerHTML = important.length
      ? '<div style="padding:11px 14px;border-radius:12px;background:var(--gl);border:1px solid var(--b);color:var(--tx);font-size:12px;margin-bottom:14px">' +
        '<b style="color:var(--red)">The sheet is missing: ' + important.join(', ') + '.</b> ' +
        'Those columns show as blank here, so filtering by that person finds nothing — it does not mean no meetings were booked.</div>'
      : '';
  }
}

function meetCountTable(rows, key, label) {
  if (!rows.length) return '<div style="padding:16px;text-align:center;color:var(--mu);font-size:12px">Nothing for these filters.</div>';
  var counts = {};
  rows.forEach(function (r) { counts[r[key]] = (counts[r[key]] || 0) + 1; });
  var list = Object.keys(counts).map(function (n) { return { name: n, n: counts[n] }; })
    .sort(function (a, b) { return b.n - a.n; });
  var max = list[0].n || 1;

  // the same pct-cell / pct-bar / pct-fill the compliance table uses, so the bars
  // look and behave like the rest of the dashboard
  return '<table style="width:100%;border-collapse:collapse;font-size:12.5px">' +
    list.map(function (x) {
      return '<tr>' +
        '<td style="padding:6px 0;border-top:1px solid var(--b);color:var(--tx)">' + meetEsc(x.name) + '</td>' +
        '<td class="mono" style="padding:6px 0;border-top:1px solid var(--b);text-align:right;width:44px;font-weight:700;color:var(--tx)">' + x.n + '</td>' +
        '<td style="padding:6px 0 6px 10px;border-top:1px solid var(--b);width:44%">' +
          '<div class="pct-bar"><div class="pct-fill" style="width:' + Math.round((x.n / max) * 100) + '%;background:var(--ac)"></div></div>' +
        '</td></tr>';
    }).join('') + '</table>';
}

function meetExportCSV() {
  var rows = meetGetFiltered();
  var head = ['Date', 'Time', 'Type', 'Case manager', 'Petition writer', 'Consultant', 'Client', 'Meet link', 'HubSpot', 'Recording'];
  var csv = [head.join(',')].concat(rows.map(function (r) {
    return [r.date, r.time, r.type, r.caseManager, r.writer, r.consultant, r.client, r.link, r.record, r.recording]
      .map(function (v) { return '"' + String(v || '').replace(/"/g, '""') + '"'; }).join(',');
  })).join('\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'meetings-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}

function meetEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
