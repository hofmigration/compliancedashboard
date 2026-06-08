// ══════════════════════════════════════════════════════════════════
//  DEALS OVERVIEW TAB — Google Sheet Integration
//  Sheet: https://docs.google.com/spreadsheets/d/1K07taCArn1qEIjTyWwXJUYnvIc9f72kWHSRUTPTlCqM
//  GID:   1453544142
// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
//  DEALS — Apps Script endpoint (deployed, no public sheet needed)
// ══════════════════════════════════════════════════════════════════
const DEALS_APPS_SCRIPT_URL = 'https://script.googleusercontent.com/a/macros/hofmigration.com/echo?user_content_key=AWDtjMVsHqmx8rk_fNTZsKAOc4DkqhV62LhuyH5GbVp4MA0_66gvBukhbI7NglvGCBn61ZkI1pQ1MLBIbFiQOxiqYhA5cnHgqWSW3toL3-EHfQvLd5_VcOq9EztZHitBI7wOiWqAL283bXTnCj8dOsX5mXycBB4APF9NdHQgnyIG2UDq2TZpC49yP-My8a1VhEv_-ROG9dw2GhJccuOaQjstOKP7TLbUbrY-rF5ApCCN037cshyoXnfqIMXol4md1yb-hg5wsnkyXJm7uHbZTWnpLMSGqTKykYANTUz1IqE-3O7clEy_aJ858Eh9m_ZMfQ&lib=MM24DuhvXS4QO0ry8prKPWHpNs2xkhEAc';

// Fallback: direct CSV if Apps Script fails
const DEALS_SHEET_ID = '1K07taCArn1qEIjTyWwXJUYnvIc9f72kWHSRUTPTlCqM';
const DEALS_GID      = '1453544142';

var dealsRawData   = [];
var dealsFiltered  = [];
var dealsRange     = 'all';
var dealsCharts    = {};
var dealsSortField = 'name';
var dealsSortDir   = 1;
var _dealsDataSource = '';  // 'appsscript' | 'csv' — for display

// ── Main loader — tries Apps Script first, CSV fallback ────────────
async function loadDealsData() {
  showDealsState('loading');
  var rows = null;
  var errorMessages = [];

  // ── ATTEMPT 1: Apps Script endpoint ──────────────────────────────
  try {
    rows = await fetchFromAppsScript();
    _dealsDataSource = 'Apps Script';
  } catch(e1) {
    console.warn('[Deals] Apps Script failed:', e1.message);
    errorMessages.push('Apps Script: ' + e1.message);

    // ── ATTEMPT 2: Direct Google Sheets CSV ────────────────────────
    try {
      rows = await fetchFromCSV();
      _dealsDataSource = 'Google Sheets CSV';
    } catch(e2) {
      console.warn('[Deals] CSV fallback failed:', e2.message);
      errorMessages.push('CSV fallback: ' + e2.message);
      rows = null;
    }
  }

  if (!rows || rows.length === 0) {
    showDealsState('error');
    var msg = rows !== null
      ? 'Sheet connected but returned 0 rows — check that the sheet has data and the correct column headers.'
      : errorMessages.join(' | ');
    var el = document.getElementById('deals-error-msg');
    if (el) el.innerHTML = dealsDiagnosticMessage(msg);
    document.getElementById('deals-source-label').textContent = 'Connection failed';
    return;
  }

  dealsRawData = rows;
  populateDealFilters();
  renderDealsTab();
  showDealsState('ready');
  var now = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  document.getElementById('deals-last-updated').textContent = 'Updated ' + now;
  document.getElementById('deals-source-label').textContent =
    'Live · ' + _dealsDataSource + ' · ' + dealsRawData.length + ' rows';
  document.getElementById('nc-deals').textContent = dealsRawData.length;
  // Debug info
  var dbg = document.getElementById('deals-debug-box');
  if (dbg && dealsRawData.length) {
    dbg.style.display = 'block';
    document.getElementById('deals-debug-source').textContent = '· Source: ' + _dealsDataSource;
    document.getElementById('deals-debug-rows').textContent = '· ' + dealsRawData.length + ' rows';
    var cols = Object.keys(dealsRawData[0]).slice(0,20).join(', ');
    document.getElementById('deals-debug-cols').textContent = cols;
    setTimeout(function(){ if(dbg) dbg.style.display='none'; }, 15000);
  }
}

// ── Fetch from Apps Script ─────────────────────────────────────────
// Apps Script can return several formats depending on the doGet() implementation:
//   1. { ok:true, data: [{...},{...}] }          ← HOF standard
//   2. { ok:true, rows: [{...},{...}] }           ← alternate key
//   3. [ {...}, {...} ]                           ← bare array
//   4. { values: [[header,...],[val,...]] }        ← Sheets API style
//   5. "col1,col2\nval1,val2\n..."               ← plain CSV text/plain
//   6. HTML error page                           ← deployment issue
async function fetchFromAppsScript() {
  var controller = new AbortController();
  var timeout = setTimeout(function(){ controller.abort(); }, 12000);
  var res;
  try {
    res = await fetch(DEALS_APPS_SCRIPT_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json, text/plain, */*' }
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error('HTTP ' + res.status);

  var contentType = (res.headers.get('content-type') || '').toLowerCase();
  var text = await res.text();

  if (!text || text.trim() === '') throw new Error('Empty response');

  // Detect HTML error page (deployment misconfigured)
  if (text.trim().startsWith('<!') || text.trim().startsWith('<html')) {
    throw new Error('Got HTML — check: Deploy → Execute as "Me" → Access: "Anyone"');
  }

  // Try JSON first
  var json = null;
  try { json = JSON.parse(text); } catch(e) { /* not JSON */ }

  if (json !== null) {
    return extractRowsFromJSON(json);
  }

  // Plain CSV/TSV text
  if (text.includes(',') || text.includes('\t')) {
    var rows = parseDealsCSV(text);
    if (rows.length) return rows;
  }

  throw new Error('Could not parse response. First 100 chars: ' + text.slice(0,100));
}

// ── Extract rows from any JSON shape ──────────────────────────────
function extractRowsFromJSON(json) {
  // Bare array of objects
  if (Array.isArray(json)) {
    if (!json.length) return [];
    // Array of objects already
    if (typeof json[0] === 'object' && !Array.isArray(json[0])) return json;
    // Array of arrays (values format)
    if (Array.isArray(json[0])) return arraysToObjects(json);
    return json;
  }

  // { ok, data/rows/deals/records/items/results/entries }
  var dataKey = ['data','rows','deals','records','items','results','entries','sheet','sheets','list']
    .find(function(k){ return json[k] && (Array.isArray(json[k]) || typeof json[k] === 'object'); });

  if (dataKey) {
    var payload = json[dataKey];
    if (Array.isArray(payload)) {
      if (!payload.length) return [];
      if (typeof payload[0] === 'object' && !Array.isArray(payload[0])) return payload;
      if (Array.isArray(payload[0])) return arraysToObjects(payload);
    }
  }

  // { values: [[header...],[row...]] } — Sheets API style
  if (json.values && Array.isArray(json.values)) return arraysToObjects(json.values);

  // Single object with status message
  if (json.ok === false) throw new Error(json.error || json.message || 'Apps Script returned ok:false');

  // Last resort — if the root object looks like a single row
  if (Object.keys(json).length > 2) return [json];

  throw new Error('JSON received but could not find data array. Keys: ' + Object.keys(json).join(', '));
}

// Convert [[header,header],[val,val]] → [{header:val}]
function arraysToObjects(arrays) {
  if (arrays.length < 2) return [];
  var headers = arrays[0].map(function(h){ return String(h).trim().toLowerCase(); });
  return arrays.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h,i){ obj[h] = String(row[i] !== undefined ? row[i] : '').trim(); });
    return obj;
  });
}

// ── CSV fallback ───────────────────────────────────────────────────
async function fetchFromCSV() {
  var url = 'https://docs.google.com/spreadsheets/d/' + DEALS_SHEET_ID +
            '/export?format=csv&gid=' + DEALS_GID;
  var res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' — make the sheet public or use Apps Script');
  var csv = await res.text();
  return parseDealsCSV(csv);
}

// ── CSV Parser (robust) ────────────────────────────────────────────
function parseDealsCSV(csvText) {
  var lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  var headers = parseCSVLine(lines[0]).map(function(h){ return h.trim().toLowerCase(); });
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var vals = parseCSVLine(line);
    var obj = {};
    headers.forEach(function(h, idx){ obj[h] = (vals[idx] || '').trim(); });
    rows.push(obj);
  }
  return rows;
}

function parseCSVLine(line) {
  var result = [], cur = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += c;
  }
  result.push(cur);
  return result;
}

// ── Diagnostic error message ────────────────────────────────────────
function dealsDiagnosticMessage(raw) {
  var tips = '';
  if (raw.includes('HTML') || raw.includes('sign-in')) {
    tips = '<br><br><strong>Fix:</strong> In Apps Script → Deploy → Manage deployments → Edit → <br>' +
           '• Execute as: <strong>Me</strong><br>• Who has access: <strong>Anyone</strong> (not "Anyone with Google account")';
  } else if (raw.includes('401') || raw.includes('403') || raw.includes('PERMISSION')) {
    tips = '<br><br><strong>Fix:</strong> Re-deploy the Apps Script as "Anyone" access, or make the sheet publicly viewable.';
  } else if (raw.includes('0 rows') || raw.includes('no data')) {
    tips = '<br><br><strong>Fix:</strong> Check that the sheet tab has data and headers in row 1 ' +
           '(Consultant, Stage, Date, Pipeline Correct, Contact, Source).';
  } else if (raw.includes('fetch') || raw.includes('network') || raw.includes('abort')) {
    tips = '<br><br><strong>Fix:</strong> Check your internet connection, or the Apps Script URL may have expired — re-deploy.';
  }
  return raw + tips;
}

function showDealsState(state) {
  var skeleton  = document.getElementById('deals-skeleton');
  var content   = document.getElementById('deals-content');
  var errBanner = document.getElementById('deals-error');
  if (skeleton)  skeleton.style.display  = state === 'loading' ? 'block' : 'none';
  if (content)   content.style.display   = state === 'ready'   ? 'block' : 'none';
  if (errBanner) errBanner.style.display = state === 'error'   ? 'flex'  : 'none';
}

// ── Find column value by multiple possible header names ────────────
function dealsGet(row, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var k = candidates[i].toLowerCase();
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  return '';
}

// ── Normalise a row into a clean deal object ───────────────────────
// Accepts any column naming convention — maps generously
function normaliseDealsRow(row) {
  // Lower-case all keys for safe lookup
  var lrow = {};
  Object.keys(row).forEach(function(k){ lrow[k.toLowerCase().trim()] = String(row[k]||'').trim(); });

  var name     = dealsGet(lrow, ['consultant name','consultant','agent name','agent','owner name','owner','assigned to','name','rep']);
  var stage    = dealsGet(lrow, ['deal stage','dealstage','stage','pipeline stage','status','deal status','lifecycle stage','lifecyclestage']);
  var dateRaw  = dealsGet(lrow, ['close date','closedate','date','create date','createdate','created date','deal date','audit date','deal close date','close_date']);
  var contact  = dealsGet(lrow, ['contact name','contactname','client name','lead name','contact','client','company','deal name','dealname']);
  var source   = dealsGet(lrow, ['lead source','leadsource','source','deal source','channel','marketing channel']);
  var value    = dealsGet(lrow, ['amount','deal value','value','deal amount','revenue','price','aed','usd']);
  var pipeCorr = dealsGet(lrow, [
    'pipeline','pipeline correct','correct pipeline','pipeline stage correct',
    'correct stage','is pipeline correct','pipeline_correct','pipelinecorrect',
    'correct','stage correct','stage_correct'
  ]);

  // Pipeline correctness — generous detection
  var isPipelineCorrect = false;
  var pc = pipeCorr.toLowerCase();
  if (pc === 'yes' || pc === '1' || pc === 'true' || pc === 'correct' || pc === 'y' ||
      pc === 'ok' || pc === '✓' || pc === 'pass' || pc === 'passed') {
    isPipelineCorrect = true;
  }

  // Parse date — handle MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, and serial numbers
  var dateObj = null;
  if (dateRaw) {
    // Google Sheets serial date (e.g. 45678)
    if (/^\d{4,5}$/.test(dateRaw)) {
      var serial = parseInt(dateRaw);
      dateObj = new Date(Date.UTC(1899,11,30) + serial * 86400000);
    } else {
      var d = new Date(dateRaw);
      if (!isNaN(d.getTime())) dateObj = d;
    }
  }

  // Numeric value
  var dealValue = 0;
  if (value) {
    dealValue = parseFloat(String(value).replace(/[^0-9.\-]/g,'')) || 0;
  }

  // Stage classification
  var stageLower = (stage || '').toLowerCase();
  var isWon  = stageLower.includes('won') || stageLower.includes('closed won') ||
               stageLower === 'win' || stageLower === 'won' || stageLower === 'closed - won';
  var isLost = stageLower.includes('lost') || stageLower.includes('closed lost') ||
               stageLower === 'lose' || stageLower === 'lost' || stageLower === 'closed - lost' ||
               stageLower === 'disqualified' || stageLower === 'dead';

  return { name, stage, dateObj, contact, source, dealValue, isPipelineCorrect, isWon, isLost, raw: lrow };
}

// ── Date filter helper ──────────────────────────────────────────────
function dealsDateInRange(dateObj) {
  if (dealsRange === 'all') return true;
  if (!dateObj) return true; // include rows without dates in "all"
  var today = new Date(); today.setHours(23,59,59,999);
  var from, to = today;
  if (dealsRange === 'thismonth') {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
  } else if (dealsRange === 'lastmonth') {
    from = new Date(today.getFullYear(), today.getMonth()-1, 1);
    to   = new Date(today.getFullYear(), today.getMonth(), 0, 23,59,59);
  } else if (dealsRange === 'last7') {
    from = new Date(today); from.setDate(from.getDate()-6); from.setHours(0,0,0,0);
  } else if (dealsRange === 'last28') {
    from = new Date(today); from.setDate(from.getDate()-27); from.setHours(0,0,0,0);
  } else if (dealsRange === 'custom') {
    var ds = document.getElementById('deals-ds').value;
    var de = document.getElementById('deals-de').value;
    if (!ds || !de) return true;
    from = new Date(ds); to = new Date(de); to.setHours(23,59,59,999);
  }
  return from ? (dateObj >= from && dateObj <= to) : true;
}

// ── Populate filter dropdowns ───────────────────────────────────────
function populateDealFilters() {
  var deals = dealsRawData.map(normaliseDealsRow);
  var names  = [...new Set(deals.map(d=>d.name).filter(Boolean))].sort();
  var stages = [...new Set(deals.map(d=>d.stage).filter(Boolean))].sort();
  var cSel = document.getElementById('deals-consultant-filter');
  var sSel = document.getElementById('deals-stage-filter');
  cSel.innerHTML = '<option value="all">All Consultants</option>' + names.map(n=>'<option value="'+n+'">'+n+'</option>').join('');
  sSel.innerHTML = '<option value="all">All Stages</option>' + stages.map(s=>'<option value="'+s+'">'+s+'</option>').join('');
}

// ── Main render ────────────────────────────────────────────────────
function renderDealsTab() {
  var cfVal  = (document.getElementById('deals-consultant-filter')||{}).value || 'all';
  var sfVal  = (document.getElementById('deals-stage-filter')||{}).value || 'all';
  var deals = dealsRawData.map(normaliseDealsRow).filter(function(d) {
    if (cfVal !== 'all' && d.name !== cfVal) return false;
    if (sfVal !== 'all' && d.stage !== sfVal) return false;
    if (!dealsDateInRange(d.dateObj)) return false;
    return true;
  });
  dealsFiltered = deals;
  renderDealsKPIs(deals);
  renderPipelineHealth(deals);
  renderDealsCharts(deals);
  renderDealsLeaderboard(deals);
  renderDealsPipelinePerConsultant(deals);
  renderDealsTable(deals);
  document.getElementById('deals-table-count').textContent = deals.length + ' deal' + (deals.length!==1?'s':'') + ' matching filters';
}

// ── KPIs ───────────────────────────────────────────────────────────
function renderDealsKPIs(deals) {
  var total = deals.length;
  var won = deals.filter(d=>d.isWon).length;
  var lost = deals.filter(d=>d.isLost).length;
  var active = deals.filter(d=>!d.isWon&&!d.isLost).length;
  var closed = won + lost;
  var winRate = closed > 0 ? Math.round(won/closed*100) : 0;
  var names = new Set(deals.map(d=>d.name).filter(Boolean));
  document.getElementById('dk-total').textContent   = total;
  document.getElementById('dk-active').textContent  = active;
  document.getElementById('dk-won').textContent     = won;
  document.getElementById('dk-lost').textContent    = lost;
  document.getElementById('dk-winrate').textContent = winRate + '%';
  document.getElementById('dk-consultants').textContent = names.size;
}

// ── Pipeline Health Banner ─────────────────────────────────────────
function renderPipelineHealth(deals) {
  var total   = deals.length;
  var correct = deals.filter(d=>d.isPipelineCorrect).length;
  var wrong   = total - correct;
  var pct     = total > 0 ? Math.round(correct/total*100) : 0;
  var TARGET  = 70;
  var isGood  = pct >= TARGET;
  var color   = isGood ? '#059669' : (pct >= 50 ? '#d97706' : '#dc2626');
  document.getElementById('pipeline-correct-pct').textContent = pct + '%';
  document.getElementById('pipeline-correct-pct').style.color = color;
  document.getElementById('pipeline-wrong-count').textContent = wrong;
  document.getElementById('pipeline-bar-correct').style.width = pct + '%';
  document.getElementById('pipeline-bar-wrong').style.width = (100-pct) + '%';
  document.getElementById('pipeline-bar-correct-pct').textContent = pct + '%';
  document.getElementById('pipeline-bar-wrong-pct').textContent = (100-pct) + '%';
  var badge = document.getElementById('pipeline-status-badge');
  if (isGood) {
    badge.style.background = 'rgba(5,150,105,.12)'; badge.style.color = '#059669';
    badge.style.border = '1px solid rgba(5,150,105,.3)';
    badge.textContent = '✓ TARGET MET';
  } else {
    badge.style.background = 'rgba(220,38,38,.1)'; badge.style.color = '#dc2626';
    badge.style.border = '1px solid rgba(220,38,38,.3)';
    badge.textContent = '⚑ BELOW TARGET';
  }
}

// ── Charts ─────────────────────────────────────────────────────────
var DEAL_COLORS = window.CHART_PALETTE || ['#3b6fe0','#16a35a','#c07d12','#7c5cfc','#0ea5e9','#e2585f','#0891b2','#f59e0b','#10b981','#6366f1'];

function destroyDealChart(id) {
  if (dealsCharts[id]) { dealsCharts[id].destroy(); delete dealsCharts[id]; }
}

function renderDealsCharts(deals) {
  // 1. Pipeline by Stage (horizontal bar)
  var stageCounts = {};
  deals.forEach(function(d){ if(d.stage) stageCounts[d.stage] = (stageCounts[d.stage]||0)+1; });
  var stageLabels = Object.keys(stageCounts).sort(function(a,b){ return stageCounts[b]-stageCounts[a]; });
  destroyDealChart('deals-stage-chart');
  var ctx1 = document.getElementById('deals-stage-chart');
  if (ctx1) {
    dealsCharts['deals-stage-chart'] = new Chart(ctx1.getContext('2d'), {
      type: 'bar',
      data: {
        labels: stageLabels,
        datasets: [{ data: stageLabels.map(function(s){ return stageCounts[s]; }),
          backgroundColor: stageLabels.map(function(_,i){ return DEAL_COLORS[i%DEAL_COLORS.length]+'cc'; }),
          borderWidth: 0, borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid:{color:CV('--b')}, border:{display:false}, ticks:{color:CV('--mu')} },
          y: { grid:{display:false}, border:{display:false}, ticks:{color:CV('--tx'),font:{weight:700}} }
        }
      }
    });
  }

  // 2. Deals by Consultant (doughnut)
  var consultantCounts = {};
  deals.forEach(function(d){ if(d.name) consultantCounts[d.name] = (consultantCounts[d.name]||0)+1; });
  var cNames = Object.keys(consultantCounts).sort(function(a,b){ return consultantCounts[b]-consultantCounts[a]; }).slice(0,8);
  destroyDealChart('deals-consultant-chart');
  var ctx2 = document.getElementById('deals-consultant-chart');
  if (ctx2) {
    dealsCharts['deals-consultant-chart'] = new Chart(ctx2.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: cNames,
        datasets: [{ data: cNames.map(function(n){ return consultantCounts[n]; }),
          backgroundColor: cNames.map(function(_,i){ return DEAL_COLORS[i%DEAL_COLORS.length]; }),
          borderWidth: 3, borderColor: CV('--w'), hoverOffset: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: { legend: { display: false } }
      }
    });
    // Custom legend
    var legEl = document.getElementById('deals-consultant-legend');
    if (legEl) legEl.innerHTML = cNames.map(function(n,i){
      return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--mu)">' +
             '<span style="width:9px;height:9px;border-radius:2px;background:'+DEAL_COLORS[i%DEAL_COLORS.length]+';flex-shrink:0"></span>' +
             n.split(' ')[0] + ' ('+consultantCounts[n]+')' + '</span>';
    }).join('');
  }

  // 3. Won vs Lost per consultant (grouped bar)
  var wonMap = {}, lostMap = {};
  deals.forEach(function(d){
    if (!d.name) return;
    if (d.isWon)  wonMap[d.name]  = (wonMap[d.name]||0)+1;
    if (d.isLost) lostMap[d.name] = (lostMap[d.name]||0)+1;
  });
  var wlNames = [...new Set(deals.filter(function(d){ return d.isWon||d.isLost; }).map(function(d){ return d.name; }))];
  if (wlNames.length === 0) wlNames = cNames;
  destroyDealChart('deals-wonlost-chart');
  var ctx3 = document.getElementById('deals-wonlost-chart');
  if (ctx3) {
    dealsCharts['deals-wonlost-chart'] = new Chart(ctx3.getContext('2d'), {
      type: 'bar',
      data: {
        labels: wlNames,
        datasets: [
          { label: 'Won',  data: wlNames.map(function(n){ return wonMap[n]||0; }),  backgroundColor: CV('--grn'), borderRadius: 4, maxBarThickness: 26 },
          { label: 'Lost', data: wlNames.map(function(n){ return lostMap[n]||0; }), backgroundColor: CV('--red'), borderRadius: 4, maxBarThickness: 26 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: CV('--tx') } } },
        scales: {
          x: { grid:{display:false}, border:{display:false}, ticks:{color:CV('--tx'),maxRotation:30} },
          y: { grid:{color:CV('--b')}, border:{display:false}, ticks:{color:CV('--mu')} }
        }
      }
    });
  }
}

// ── Leaderboard ────────────────────────────────────────────────────
function renderDealsLeaderboard(deals) {
  var el = document.getElementById('deals-leaderboard');
  if (!el) return;
  var counts = {};
  deals.forEach(function(d){ if(d.name) counts[d.name] = (counts[d.name]||0)+1; });
  var sorted = Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; });
  var maxVal = sorted.length ? counts[sorted[0]] : 1;
  if (!sorted.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--mu);font-family:\'DM Mono\',monospace;font-size:12px">No data for selected filters</div>'; return; }
  el.innerHTML = sorted.map(function(name, i) {
    var pct = Math.round(counts[name]/maxVal*100);
    var col = DEAL_COLORS[i%DEAL_COLORS.length];
    var medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
      '<div style="width:20px;text-align:center;font-size:13px">'+(medal||'<span style="font-family:\'DM Mono\',monospace;color:var(--mu);font-size:11px">'+(i+1)+'</span>')+'</div>' +
      '<div style="flex:1">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">' +
          '<span style="font-size:13px;font-weight:600;color:var(--tx)">' + name + '</span>' +
          '<span style="font-size:12px;font-weight:700;color:'+col+';font-family:\'DM Mono\',monospace">' + counts[name] + ' deals</span>' +
        '</div>' +
        '<div style="height:5px;background:var(--b);border-radius:3px;overflow:hidden">' +
          '<div style="height:100%;background:'+col+';border-radius:3px;width:'+pct+'%;transition:width .5s ease"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Pipeline per consultant ─────────────────────────────────────────
function renderDealsPipelinePerConsultant(deals) {
  var el = document.getElementById('deals-pipeline-per-consultant');
  if (!el) return;
  var totalMap = {}, corrMap = {};
  deals.forEach(function(d){
    if (!d.name) return;
    totalMap[d.name] = (totalMap[d.name]||0)+1;
    if (d.isPipelineCorrect) corrMap[d.name] = (corrMap[d.name]||0)+1;
  });
  var names = Object.keys(totalMap).sort(function(a,b){ return totalMap[b]-totalMap[a]; });
  if (!names.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--mu);font-family:\'DM Mono\',monospace;font-size:12px">No data for selected filters</div>'; return; }
  var TARGET = 70;
  el.innerHTML = names.map(function(name) {
    var total = totalMap[name], corr = corrMap[name]||0;
    var pct = Math.round(corr/total*100);
    var col = pct >= TARGET ? '#059669' : (pct >= 50 ? '#d97706' : '#dc2626');
    var status = pct >= TARGET ? '✓' : '⚑';
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
      '<div style="width:16px;font-size:12px;text-align:center">'+status+'</div>' +
      '<div style="flex:1">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">' +
          '<span style="font-size:12px;font-weight:600;color:var(--tx)">'+name+'</span>' +
          '<span style="font-size:12px;font-weight:700;color:'+col+';font-family:\'DM Mono\',monospace">'+pct+'%</span>' +
        '</div>' +
        '<div style="height:5px;background:var(--b);border-radius:3px;overflow:hidden">' +
          '<div style="height:100%;background:'+col+';width:'+pct+'%;border-radius:3px;transition:width .5s ease"></div>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--mu);margin-top:2px;font-family:\'DM Mono\',monospace">'+corr+' / '+total+' correct · Target: '+TARGET+'%</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Deals Table ─────────────────────────────────────────────────────
var dealsTableSearch = '';
function filterDealsTable(q) { dealsTableSearch = q.toLowerCase(); buildDealsTable(); }
function sortDealsTable(field) {
  if (dealsSortField === field) dealsSortDir *= -1; else { dealsSortField = field; dealsSortDir = 1; }
  buildDealsTable();
}
function renderDealsTable(deals) { dealsFiltered = deals; buildDealsTable(); }

function buildDealsTable() {
  var tbody = document.getElementById('deals-tbody');
  if (!tbody) return;
  var rows = dealsFiltered.filter(function(d){
    if (!dealsTableSearch) return true;
    return (d.name+d.stage+d.contact+d.source).toLowerCase().includes(dealsTableSearch);
  }).sort(function(a,b){
    var va, vb;
    if (dealsSortField === 'name')            { va = a.name||''; vb = b.name||''; }
    else if (dealsSortField === 'stage')      { va = a.stage||''; vb = b.stage||''; }
    else if (dealsSortField === 'date')       { va = a.dateObj?a.dateObj.getTime():0; vb = b.dateObj?b.dateObj.getTime():0; }
    else if (dealsSortField === 'pipeline_correct') { va = a.isPipelineCorrect?1:0; vb = b.isPipelineCorrect?1:0; }
    else if (dealsSortField === 'value') { va = a.dealValue||0; vb = b.dealValue||0; }
    else { va = a.name||''; vb = b.name||''; }
    if (typeof va === 'string') return va.localeCompare(vb)*dealsSortDir;
    return (va-vb)*dealsSortDir;
  });

  var stageColors = { won:'#05966920', lost:'#dc262620' };
  tbody.innerHTML = rows.map(function(d){
    var stageLow = (d.stage||'').toLowerCase();
    var rowBg = d.isWon ? 'background:rgba(5,150,105,.04)' : d.isLost ? 'background:rgba(220,38,38,.04)' : '';
    var stagePill = '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;font-family:\'DM Mono\',monospace;' +
      (d.isWon?'background:#05966920;color:#059669':d.isLost?'background:#dc262618;color:#dc2626':'background:var(--al);color:var(--ac)') + '">' + (d.stage||'—') + '</span>';
    var pipelinePill = d.isPipelineCorrect ?
      '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:#05966918;color:#059669;font-family:\'DM Mono\',monospace">✓ Yes</span>' :
      '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:#dc262614;color:#dc2626;font-family:\'DM Mono\',monospace">⚑ No</span>';
    var dateStr = d.dateObj ? d.dateObj.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
    return '<tr style="'+rowBg+'">' +
      '<td style="font-weight:600;color:var(--tx)">'+(d.name||'—')+'</td>' +
      '<td>'+stagePill+'</td>' +
      '<td style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--mu)">'+dateStr+'</td>' +
      '<td style="text-align:center">'+pipelinePill+'</td>' +
      '<td style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--mu)">'+(d.dealValue?'AED '+d.dealValue.toLocaleString():'—')+'</td>' +
      '<td style="color:var(--t2)">'+(d.contact||'—')+'</td>' +
      '<td style="color:var(--mu);font-family:\'DM Mono\',monospace;font-size:11px">'+(d.source||'—')+'</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--mu);font-family:\'DM Mono\',monospace;font-size:12px">No deals match the current filters</td></tr>';
}

// ── Range selector ─────────────────────────────────────────────────
function setDealsRange(btn, range) {
  dealsRange = range;
  document.querySelectorAll('[data-deals-range]').forEach(function(b){ b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  var customBox = document.getElementById('deals-custom-box');
  if (customBox) customBox.classList.toggle('hidden', range !== 'custom');
  if (range !== 'custom') renderDealsTab();
}

// ── CSV Export ─────────────────────────────────────────────────────
function exportDealsCSV() {
  var rows = [['Consultant','Stage','Date','Pipeline Correct','Contact','Source']];
  dealsFiltered.forEach(function(d){
    rows.push([
      '"'+(d.name||'')+'\"',
      '"'+(d.stage||'')+'\"',
      d.dateObj ? d.dateObj.toLocaleDateString('en-GB') : '',
      d.isPipelineCorrect ? 'Yes' : 'No',
      '"'+(d.contact||'')+'\"',
      '"'+(d.source||'')+'\"'
    ]);
  });
  var blob = new Blob([rows.map(function(r){ return r.join(','); }).join('\n')], {type:'text/csv'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href = url;
  a.download = 'HOF-Deals-Export.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── Auto-load when tab is opened ───────────────────────────────────
// Hooked into the existing go() function via the tab navigation
var _dealsLoaded = false;
var _origGo = window.go;
window.go = function(tab) {
  if (_origGo) _origGo.call(this, tab);
  if (tab === 'deals' && !_dealsLoaded) { _dealsLoaded = true; loadDealsData(); }
};

window.onerror = function(msg,src,line){ hideLdr(); console.error('JS error: '+msg+' line '+line); };
// Hard fallback: force-dismiss loader after 8 seconds no matter what
setTimeout(function(){ ldrCount=0; hideLdr(); }, 8000);
// Click-to-dismiss: if user taps/clicks loader, dismiss immediately
document.getElementById('ldr').addEventListener('click', function(){
  ldrCount=0; hideLdr();
  showToast('Loader dismissed — data may still be loading in background');
});

// Check URL for range before first fetch
(()=>{ const p=new URLSearchParams(location.search); if(p.has('range')) activeRange=p.get('range'); })();
// ── Header clock ──
