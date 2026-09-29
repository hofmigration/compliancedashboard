// ══════════════════════════════════════════════════════════════
//  RECORDINGS — Calls Quality, split by the Sales / Service toggle
//
//  The only manual step is matching an audio file to its meeting.
//  The summary and the transcript are written by Gemini, on a five
//  minute trigger in the Apps Script, and appear here on their own.
// ══════════════════════════════════════════════════════════════

var recAll = [], recFiles = [], recMeetings = [];
var recLoaded = false;
var recOpenRow = null;          // which card's notes are open
var recTranscripts = {};        // row -> full transcript, fetched when first opened
var recPollTimer = null, recPollSince = 0;
var recSelectedMeetLink = '';

// ── addresses and the passcode ──
function recBase() {
  var u = String((typeof APIS !== 'undefined' && APIS.meetings) || '');
  return u ? u.split('?')[0] : '';
}
function recGetCode() { try { return localStorage.getItem('hofRecCode') || ''; } catch (e) { return ''; } }
function recSetCode(c) { try { c ? localStorage.setItem('hofRecCode', c) : localStorage.removeItem('hofRecCode'); } catch (e) {} }
function recUrl(mode, extra) {
  var code = recGetCode();
  return recBase() + '?mode=' + mode + (extra || '') + (code ? '&code=' + encodeURIComponent(code) : '');
}

// ── Load ──
function loadRecordings(force, quiet) {
  if (recLoaded && !force) { recRender(); return; }
  if (!recBase()) {
    cmHTML('rec-list', '<div style="padding:18px;text-align:center;color:var(--mu);font-size:12.5px">No endpoint configured. Add <b>meetings</b> to the APIS block in <b>1-core.js</b>.</div>');
    return;
  }
  if (!quiet && typeof showLdr === 'function') showLdr('Loading recordings…');

  fetch(recUrl('recordings'), { redirect: 'follow' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (raw) {
      if (raw.trim().charAt(0) === '<') throw new Error('Got HTML not JSON — redeploy: Execute as Me, Anyone can access');
      var j = JSON.parse(raw);
      if (j.needCode) { recAskForCode(j.error); return; }
      if (!j.ok) throw new Error(j.error || 'Apps Script error');
      recAll = j.recordings || [];
      recLoaded = true;
      recRender();
      recSchedulePoll();
    })
    .catch(function (err) {
      cmHTML('rec-list', '<div style="padding:14px 16px;border-radius:12px;background:var(--gl);border:1px solid var(--red);color:var(--red);font-size:12.5px"><b>Could not load recordings.</b><br>' + recEsc(err.message) + '</div>');
    })
    .finally(function () { if (!quiet && typeof hideLdr === 'function') hideLdr(); });
}

// A private library asks for the passcode once and remembers it on this browser.
function recAskForCode(msg) {
  cmHTML('rec-list',
    '<div style="background:var(--s2);border:1px solid var(--b);border-radius:12px;padding:18px;max-width:420px;margin:0 auto;text-align:center">' +
      '<div style="font-size:13px;color:var(--tx);font-weight:700;margin-bottom:10px">' + recEsc(msg || 'Enter the recordings passcode.') + '</div>' +
      '<input id="recCodeIn" type="password" placeholder="Passcode" style="width:100%;background:var(--s2);border:1px solid var(--b);border-radius:8px;padding:8px 10px;color:var(--tx);font-size:13px;font-family:\'Nunito\',sans-serif;outline:none">' +
      '<button class="dla-btn" style="margin-top:10px" onclick="recSetCode(document.getElementById(\'recCodeIn\').value);loadRecordings(true)">Open the library</button>' +
    '</div>');
}

// While anything is still being transcribed, check back every minute so the card
// updates on its own. Gives up after half an hour, so a stuck job cannot poll forever.
function recSchedulePoll() {
  if (recPollTimer) { clearTimeout(recPollTimer); recPollTimer = null; }
  var busy = recAll.some(function (r) { return /Pending|Working|Retry/.test(r.status); });
  if (!busy) { recPollSince = 0; return; }
  if (!recPollSince) recPollSince = Date.now();
  if (Date.now() - recPollSince > 30 * 60 * 1000) return;
  recPollTimer = setTimeout(function () { loadRecordings(true, true); }, 60000);
}

// ── Which half of Calls Quality is on screen ──
// The panel already has a Sales / Service toggle, so the recordings follow it
// rather than adding a second control that could disagree with the first.
function recTeam() {
  var svc = document.getElementById('cq-seg-service');
  return (svc && svc.className.indexOf('on') !== -1) ? 'Service' : 'Sales';
}

function recHaystack(r) {
  var sd = r.summaryData || {};
  return [r.client, r.person, r.role, r.audioName, r.summary, r.transcriptPreview, sd.overview,
    (sd.keyPoints || []).join(' '), (sd.nextSteps || []).join(' '), (sd.feesMentioned || []).join(' '),
    (sd.commitments || []).join(' '), (sd.clientConcerns || []).join(' ')].join(' ').toLowerCase();
}

function recFiltered() {
  var team = recTeam();
  var rows = recAll.filter(function (r) { return (r.category || 'Sales') === team; });
  var p = (document.getElementById('recPersonFilter') || {}).value || 'all';
  if (p !== 'all') rows = rows.filter(function (r) { return r.person === p; });
  var q = ((document.getElementById('recSearch') || {}).value || '').trim().toLowerCase();
  if (q) rows = rows.filter(function (r) { return recHaystack(r).indexOf(q) !== -1; });
  return rows;
}

// ── Render ──
function recRender() {
  var team = recTeam();
  var inTeam = recAll.filter(function (r) { return (r.category || 'Sales') === team; });
  var rows = recFiltered();

  var people = {};
  inTeam.forEach(function (r) { if (r.person) people[r.person] = 1; });
  var sel = document.getElementById('recPersonFilter');
  if (sel) {
    var keep = sel.value;
    sel.innerHTML = '<option value="all">Everyone</option>' +
      Object.keys(people).sort().map(function (n) { return '<option value="' + recEsc(n) + '">' + recEsc(n) + '</option>'; }).join('');
    sel.value = people[keep] ? keep : 'all';
  }

  cmText('rec-team-label', team === 'Service' ? 'Service call recordings' : 'Sales call recordings');
  cmText('rec-kpi-total', inTeam.length);
  cmText('rec-kpi-pending', inTeam.filter(function (r) { return /Pending|Working|Retry/.test(r.status); }).length);
  cmText('rec-kpi-people', Object.keys(people).length);
  cmText('rec-kpi-summaries', inTeam.filter(function (r) { return r.summaryData || r.summary; }).length);

  if (!rows.length) {
    cmHTML('rec-list', '<div style="padding:26px;text-align:center;color:var(--mu);font-size:12.5px">' +
      (inTeam.length ? 'Nothing matches this search.'
        : (recAll.length ? 'No ' + team.toLowerCase() + ' recordings yet. There are ' + recAll.length + ' on the other tab.'
          : 'No recordings yet. Drop the audio into the Drive folder, then use <b>+ Add a recording</b>.')) + '</div>');
    return;
  }
  cmHTML('rec-list', rows.map(recCard).join(''));
}

function recStatusChip(r) {
  var chip = function (text, fg, bg) {
    return '<span style="font-size:9px;font-weight:700;letter-spacing:.5px;padding:3px 8px;border-radius:5px;font-family:\'DM Mono\',monospace;color:' + fg + ';background:' + bg + '">' + text + '</span>';
  };
  if (r.status === 'Pending' || r.status === 'Retry') return chip('QUEUED', 'var(--mu)', 'var(--gl)');
  if (r.status === 'Working') return chip('TRANSCRIBING…', 'var(--ac)', 'var(--al)');
  if (r.status === 'Failed') return chip('FAILED', 'var(--red)', 'var(--gl)');
  if (r.status === 'Summary only') return chip('NO TRANSCRIPT', 'var(--red)', 'var(--gl)');
  return '';
}

function recCard(r) {
  var open = recOpenRow === r.row;
  var sd = r.summaryData;
  var hasNotes = !!(sd || r.summary);
  var busy = /Pending|Working|Retry/.test(r.status);

  var flags = '';
  if (sd && sd.commitments && sd.commitments.length)
    flags += '<span class="chip" style="cursor:default;border-color:var(--ac);color:var(--ac)">' + sd.commitments.length + ' commitment' + (sd.commitments.length > 1 ? 's' : '') + ' to review</span>';
  if (sd && sd.feesMentioned && sd.feesMentioned.length)
    flags += '<span class="chip" style="cursor:default">' + sd.feesMentioned.length + ' fee' + (sd.feesMentioned.length > 1 ? 's' : '') + ' mentioned</span>';

  return '<div style="background:var(--s2);border:1px solid var(--b);border-radius:12px;padding:14px;margin-bottom:10px">' +
    '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:180px">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span style="font-size:14px;font-weight:800;color:var(--tx);font-family:\'Nunito\',sans-serif">' + recEsc(r.client || 'Unnamed client') + '</span>' +
          recStatusChip(r) +
        '</div>' +
        '<div style="font-size:11.5px;color:var(--mu);margin-top:3px;font-family:\'Nunito\',sans-serif">' +
          recEsc(r.person) + (r.role ? ' · ' + recEsc(r.role) : '') +
          (r.date ? ' <span class="mono">· ' + recEsc(r.date) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
        (hasNotes ? '<button class="chip" onclick="recToggle(' + r.row + ')">' + (open ? 'Hide notes' : 'Notes') + '</button>' : '') +
        (/Failed|Summary only/.test(r.status) ? '<button class="chip" onclick="recRetry(' + r.row + ')">↻ Retry</button>' : '') +
        (r.download ? '<a class="chip" href="' + recEsc(r.download) + '" target="_blank" rel="noopener" style="text-decoration:none">Drive</a>' : '') +
        (r.meetLink ? '<a class="chip" href="' + recEsc(r.meetLink) + '" target="_blank" rel="noopener" style="text-decoration:none">Meet</a>' : '') +
      '</div>' +
    '</div>' +

    (busy || /Failed|Summary only/.test(r.status)
      ? '<div style="font-size:11.5px;color:' + (/Failed|Summary only/.test(r.status) ? 'var(--red)' : 'var(--mu)') + ';margin-top:7px">' +
          recEsc(r.statusNote || (busy ? 'Waiting to be transcribed — usually within five minutes.' : '')) + '</div>'
      : '') +

    (flags ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">' + flags + '</div>' : '') +

    (r.player
      ? '<iframe src="' + recEsc(r.player) + '" style="width:100%;height:62px;border:0;margin-top:10px;border-radius:8px" allow="autoplay"></iframe>'
      : '') +

    (open ? recNotes(r) : '') +
  '</div>';
}

function recNotes(r) {
  var LB = "font-size:9.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--mu);font-family:'DM Mono',monospace;margin-bottom:5px";
  var list = function (arr) {
    if (!arr || !arr.length) return '<div style="font-size:12px;color:var(--mu)">Nothing noted.</div>';
    return '<ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.7;color:var(--tx)">' +
      arr.map(function (x) { return '<li>' + recEsc(x) + '</li>'; }).join('') + '</ul>';
  };
  var box = function (label, inner, accent) {
    return '<div style="background:var(--gl);border-radius:8px;padding:11px 13px;' + (accent ? 'border-left:3px solid var(--ac);' : '') + '">' +
      '<div style="' + LB + '">' + label + '</div>' + inner + '</div>';
  };

  var sd = r.summaryData;
  var html = '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--b)">';

  if (sd) {
    html += box('Overview', '<div style="font-size:12.5px;line-height:1.7;color:var(--tx)">' + recEsc(sd.overview) +
      (sd.language ? '<div style="font-size:11px;color:var(--mu);margin-top:5px">Language: ' + recEsc(sd.language) + '</div>' : '') + '</div>');
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">' +
      box('Key points', list(sd.keyPoints)) +
      box('Next steps', list(sd.nextSteps)) +
      box('Fees mentioned', list(sd.feesMentioned)) +
      box('Commitments made — check against policy', list(sd.commitments), true) +
      box('Client concerns', list(sd.clientConcerns)) +
    '</div>';
  } else if (r.summary) {
    html += box('Summary', '<div style="font-size:12.5px;line-height:1.7;color:var(--tx);white-space:pre-wrap">' + recEsc(r.summary) + '</div>');
  }

  // the full transcript is only fetched when someone asks for it
  if (r.hasTranscript) {
    var t = recTranscripts[r.row];
    html += '<div style="margin-top:10px">' +
      (t === undefined
        ? '<button class="chip" onclick="recLoadTranscript(' + r.row + ')">Show the full transcript</button>'
        : (t === null
            ? '<div style="font-size:12px;color:var(--mu)">Loading the transcript…</div>'
            : '<div style="' + LB + '">Transcript</div>' +
              '<div style="font-size:12.5px;line-height:1.75;color:var(--tx);white-space:pre-wrap;background:var(--gl);border-radius:8px;padding:11px 13px;max-height:420px;overflow:auto;font-family:\'Nunito\',sans-serif">' +
                recFormatTranscript(t) + '</div>')) +
    '</div>';
  }

  if (r.status === 'Done' && r.statusNote) html += '<div style="font-size:11.5px;color:var(--mu);margin-top:8px">' + recEsc(r.statusNote) + '</div>';

  html += '<div style="font-size:10.5px;color:var(--mu);margin-top:10px;font-style:italic">' +
    'Written automatically from the audio. It can mishear names and numbers — check the recording before acting on a figure or a commitment.</div>';
  return html + '</div>';
}

// "Name: what they said" — the speaker is picked out in bold
function recFormatTranscript(text) {
  return String(text || '').split('\n').map(function (line) {
    var safe = recEsc(line);
    return safe.replace(/^([^:]{1,40}):\s/, '<b>$1:</b> ');
  }).join('\n');
}

function recToggle(row) { recOpenRow = (recOpenRow === row ? null : row); recRender(); }

function recLoadTranscript(row) {
  recTranscripts[row] = null;
  recRender();
  fetch(recUrl('transcript', '&row=' + row), { redirect: 'follow' })
    .then(function (r) { return r.text(); })
    .then(function (raw) {
      var j = JSON.parse(raw);
      if (!j.ok) throw new Error(j.error || 'Could not load it');
      recTranscripts[row] = j.transcript || '(empty)';
      recRender();
    })
    .catch(function (err) { recTranscripts[row] = 'Could not load the transcript: ' + err.message; recRender(); });
}

// ── writes ──
function recPost(body, ok, fail) {
  fetch(recBase(), {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // avoids a CORS preflight
    body: JSON.stringify(body)
  })
    .then(function (r) { return r.text(); })
    .then(function (raw) {
      var j = JSON.parse(raw);
      if (!j.ok) { if (j.needCode) recSetCode(''); throw new Error(j.error || 'That did not work'); }
      ok(j);
    })
    .catch(function (err) { fail(err.message); });
}

function recRetry(row) {
  var code = recGetCode() || window.prompt('Recordings passcode');
  if (!code) return;
  recPost({ action: 'retryRecording', row: row, code: code },
    function () { recSetCode(code); loadRecordings(true); },
    function (msg) { alert(msg); });
}

// ── adding one ──
function recOpenAdd() {
  if (!recBase()) return;
  document.getElementById('rec-add').style.display = 'block';
  cmHTML('rec-add-body', '<div style="padding:14px;color:var(--mu);font-size:12.5px">Loading the Drive folder…</div>');
  fetch(recBase() + '?mode=recfiles', { redirect: 'follow' })
    .then(function (r) { return r.text(); })
    .then(function (raw) {
      var j = JSON.parse(raw);
      if (!j.ok) throw new Error(j.error);
      recFiles = j.files || [];
      recMeetings = j.meetings || [];
      recDrawAdd();
    })
    .catch(function (err) { cmHTML('rec-add-body', '<div style="padding:12px;color:var(--red);font-size:12.5px">' + recEsc(err.message) + '</div>'); });
}
function recCloseAdd() { document.getElementById('rec-add').style.display = 'none'; }

function recDrawAdd() {
  var unmatched = recFiles.filter(function (f) { return !f.matched; });
  var IN = "width:100%;background:var(--s2);border:1px solid var(--b);border-radius:8px;padding:8px 10px;color:var(--tx);font-size:12.5px;font-family:'Nunito',sans-serif;outline:none";
  var LB = "font-size:9.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--mu);font-family:'DM Mono',monospace;display:block;margin:12px 0 5px";
  var team = recTeam();

  cmHTML('rec-add-body',
    (unmatched.length
      ? '<div style="font-size:12px;color:var(--mu)">' + unmatched.length + ' file(s) in the folder waiting to be matched.</div>'
      : '<div style="padding:10px 12px;border-radius:8px;background:var(--gl);font-size:12px;color:var(--mu)">Every file in the folder is already matched. Drop more audio in and reopen this.</div>') +

    '<label style="' + LB + '">Audio file</label>' +
    '<select id="recFile" style="' + IN + '" onchange="recGuess()">' +
      '<option value="">Choose the file…</option>' +
      recFiles.map(function (f) {
        var off = f.matched || f.tooBig;
        return '<option value="' + recEsc(f.id) + '"' + (off ? ' disabled' : '') + '>' + recEsc(f.name) + ' · ' + f.size +
          (f.matched ? ' · already added' : (f.tooBig ? ' · too big, over 48 MB' : '')) + '</option>';
      }).join('') +
    '</select>' +

    '<label style="' + LB + '">Which meeting <span style="text-transform:none;letter-spacing:0;font-weight:400">— optional, it fills the rest in</span></label>' +
    '<select id="recMeeting" style="' + IN + '" onchange="recFill()">' +
      '<option value="">Not booked through the portal…</option>' +
      recMeetings.map(function (m, i) {
        return '<option value="' + i + '">' + recEsc(m.date) + ' · ' + recEsc(m.client) + ' · ' + recEsc(m.consultant) + (m.type === 'Brainstorm' ? ' · brainstorm' : '') + '</option>';
      }).join('') +
    '</select>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div><label style="' + LB + '">Client</label><input id="recClient" style="' + IN + '" placeholder="Client name"></div>' +
      '<div><label style="' + LB + '">Meeting date</label><input id="recDate" type="date" style="' + IN + '"></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div><label style="' + LB + '">Who took it</label><input id="recPerson" style="' + IN + '" placeholder="Consultant or case manager"></div>' +
      '<div><label style="' + LB + '">Role</label><select id="recRole" style="' + IN + '" onchange="recRoleChanged()">' +
        '<option>Consultant</option><option>Case manager</option><option>Petition writer</option><option>Other</option></select></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div><label style="' + LB + '">Which tab</label><select id="recCategory" style="' + IN + '">' +
        '<option value="Sales"' + (team === 'Sales' ? ' selected' : '') + '>Sales Calls QA</option>' +
        '<option value="Service"' + (team === 'Service' ? ' selected' : '') + '>Service Calls QA</option></select></div>' +
      '<div><label style="' + LB + '">Passcode</label><input id="recCode" type="password" style="' + IN + '" value="' + recEsc(recGetCode()) + '" placeholder="Recordings passcode"></div>' +
    '</div>' +

    '<div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:var(--gl);font-size:12px;color:var(--mu);line-height:1.6">' +
      'No need to write anything. The <b style="color:var(--tx)">summary</b> is written automatically, usually within five minutes, ' +
      'and the full <b style="color:var(--tx)">transcript</b> shortly after.</div>' +

    '<div id="rec-add-msg" style="margin-top:12px"></div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="dla-btn" onclick="recSubmit()">Add to the library</button>' +
      '<button class="dla-btn" onclick="recCloseAdd()">Cancel</button>' +
    '</div>');
}

// A consultant call is a sales call; a case manager call is a service call. The field
// stays editable, because that mapping is right most of the time rather than always.
function recRoleChanged() {
  var role = document.getElementById('recRole').value;
  var cat = document.getElementById('recCategory');
  if (cat) cat.value = /case manager|petition writer/i.test(role) ? 'Service' : 'Sales';
}

// picking a meeting fills in the client, date and person
function recFill() {
  var i = document.getElementById('recMeeting').value;
  recSelectedMeetLink = '';
  if (i === '') return;
  var m = recMeetings[+i];
  if (!m) return;
  document.getElementById('recClient').value = m.client || '';
  document.getElementById('recDate').value = m.date || '';
  document.getElementById('recPerson').value = m.caseManager || m.consultant || '';
  document.getElementById('recRole').value = m.caseManager ? 'Case manager' : 'Consultant';
  recRoleChanged();
  recSelectedMeetLink = m.meetLink || '';
}

// a file named with a date usually tells us the date without asking
function recGuess() {
  var sel = document.getElementById('recFile');
  var f = recFiles.filter(function (x) { return x.id === sel.value; })[0];
  if (!f) return;
  var d = String(f.name).match(/(20\d{2})[-_. ]?(\d{2})[-_. ]?(\d{2})/);
  var dateEl = document.getElementById('recDate');
  if (d && dateEl && !dateEl.value) dateEl.value = d[1] + '-' + d[2] + '-' + d[3];
}

function recSubmit() {
  var code = document.getElementById('recCode').value;
  var body = {
    action: 'addRecording', code: code,
    fileId: document.getElementById('recFile').value,
    client: document.getElementById('recClient').value,
    date: document.getElementById('recDate').value,
    person: document.getElementById('recPerson').value,
    role: document.getElementById('recRole').value,
    category: document.getElementById('recCategory').value,
    meetLink: recSelectedMeetLink,
    addedBy: 'Dashboard'
  };
  var msg = document.getElementById('rec-add-msg');
  if (!code) { msg.innerHTML = '<div style="font-size:12px;color:var(--red)">Enter the recordings passcode.</div>'; return; }
  msg.innerHTML = '<div style="font-size:12px;color:var(--mu)">Saving…</div>';

  recPost(body,
    function () {
      recSetCode(code);
      msg.innerHTML = '<div style="font-size:12px;color:var(--grn);font-weight:700">Added. The summary will appear here within about five minutes.</div>';
      setTimeout(function () { recCloseAdd(); loadRecordings(true); }, 1200);
    },
    function (m) { msg.innerHTML = '<div style="font-size:12px;color:var(--red)">' + recEsc(m) + '</div>'; });
}

// The Sales / Service buttons belong to the QA panel, so rather than editing that
// file, this listens to them and redraws.
(function () {
  function hook() {
    ['cq-seg-sales', 'cq-seg-service'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b && !b.dataset.recHooked) {
        b.dataset.recHooked = '1';
        b.addEventListener('click', function () { setTimeout(recRender, 0); });
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();

function recEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
