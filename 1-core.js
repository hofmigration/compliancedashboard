// ══════════════════════════════════════════════════════════════
//  API ENDPOINTS
// ══════════════════════════════════════════════════════════════
const APIS = {
  hof:     'https://script.google.com/macros/s/AKfycbwm6zloihA05aeZ4pzKsJLe-u9zCSzxsku_KPUm44vFoR225aEBSGEguM20ecOu7LC7XQ/exec',
  daily:   'https://script.google.com/macros/s/AKfycbyOPHjjzxoFE75kiyc5XcyLlrcaU0M-JKtPet4c17mKqKXHVh8TrDP6Cl-Vc0zVqdjP/exec',
  weekly:  'https://script.google.com/macros/s/AKfycbxLkga97bUdGu1NGq6T5AeXXcW0UuUJt5UUWYvlzq2tlDsanbq9qYFsmtpjSzCjMLuI7A/exec',
  monthly: 'https://script.google.com/macros/s/AKfycbz1AW3E4P4vxBdlGVp_P3OvFARO63Jn_XLoPIKg95bbFOzFdi-PgtpDX5ayTykeQDAG/exec',
  perf:    'https://script.google.com/macros/s/AKfycbz4fy0-aHaQL_mpyVWVaUbHmONEpdnbnJlFjv6MPp8cCLYKqkUlviOS_hC4kULRZMBkCA/exec'
};

// ══════════════════════════════════════════════════════════════
//  RAW AUDIT SHEET — direct CSV fetch for case links
//  Sheet: HOF Migration - Sales Agent Compliance
//  Tab:   RAW AUDIT NEW (gid needs to match — set below)
// ══════════════════════════════════════════════════════════════
const RAW_SHEET_ID  = '1VeCyEXP8uXIMCMhaJm2xoKsqSBeeXKQZY9PZN23s0P0';
// gid for each tab — update if Google reassigns them
const RAW_SHEET_GIDS = {
  rawAudit:    '856543255',   // "RAW AUDIT NEW" — try this first
  taggedCases: '1234567890',  // "Tagged cases"  — fallback
};

// ── Column name → internal field name mapping ──────────────────────────────
// These must match the ACTUAL column headers in your RAW AUDIT NEW sheet.
// Update these if your headers differ slightly.
const RAW_COL_MAP = {
  // Identity
  'consultant name':  '_name',
  'agent name':       '_name',
  'name':             '_name',
  'consultant':       '_name',
  // Case link
  'case link':        '_caseLink',
  'hubspot link':     '_caseLink',
  'link':             '_caseLink',
  'deal link':        '_caseLink',
  'contact link':     '_caseLink',
  'url':              '_caseLink',
  'case url':         '_caseLink',
  // Case / contact name
  'case name':        '_caseName',
  'contact name':     '_caseName',
  'lead name':        '_caseName',
  'client name':      '_caseName',
  // Date
  'date':             '_date',
  'audit date':       '_date',
  // Error attribute columns — value of "0" = pass, "1" or non-empty = fail
  '1st contact':      'firstContact',
  'first contact':    'firstContact',
  '1st call':         'firstCall',
  'first call':       'firstCall',
  'call logged':      'callLogged',
  'outcome':          'outcome',
  'call desc':        'callDesc',
  'call description': 'callDesc',
  'lead stage':       'leadStage',
  'lead stage updated':'leadStage',
  'correct stage':    'correctStage',
  'qualified mark':   'qualifiedMark',
  'qualified':        'qualifiedMark',
  'deal created':     'deal',
  'deal':             'deal',
  'pipeline':         'pipeline',
  'timeline':         'timeline',
  'properties':       'properties',
  'email sent':       'emailSent',
  'email via hub':    'emailHub',
  'email via hubspot':'emailHub',
  'prof tone':        'profTone',
  'professional tone':'profTone',
  'signature':        'signature',
  'wa used':          'waUsed',
  'whatsapp used':    'waUsed',
  'wa logged':        'waLogged',
  'whatsapp logged':  'waLogged',
  'wa note':          'waNote',
  'whatsapp note':    'waNote',
  'task created':     'taskCreated',
  'task done':        'taskDone',
  'task type':        'taskType',
};

// All attribute field names (used to detect which columns are error columns)
const ATTR_FIELDS = new Set([
  'firstContact','firstCall','callLogged','outcome','callDesc',
  'leadStage','correctStage','qualifiedMark',
  'deal','pipeline','timeline','properties',
  'emailSent','emailHub','profTone','signature',
  'waUsed','waLogged','waNote',
  'taskCreated','taskDone','taskType'
]);

// ── Parse CSV respecting quoted fields ────────────────────────────────────────
function parseCSV(text) {
  var rows = [];
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line.trim()) continue;
    var cols = [], cur = '', inQ = false;
    for (var j = 0; j < line.length; j++) {
      var ch = line[j];
      if (ch === '"') {
        if (inQ && line[j+1] === '"') { cur += '"'; j++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cols.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}

// ── Fetch raw audit CSV and build errorLinks map ───────────────────────────
// Returns: { 'Muizza Shahrukh': { outcome: [{url, name, date}, ...], ... }, ... }
async function fetchRawAuditLinks() {
  // First try: get case links from the Apps Script (most reliable — same origin)
  try {
    const asUrl = APIS.hof + (APIS.hof.includes('?') ? '&' : '?') + 'action=caseLinks';
    const res = await fetch(asUrl, {redirect:'follow'});
    if (res.ok) {
      const raw = await res.text();
      if (raw && !raw.trim().startsWith('<')) {
        const json = JSON.parse(raw);
        if (json.errorLinks && typeof json.errorLinks === 'object') {
          return json.errorLinks; // Already keyed by consultant name → field → [{url,name,date}]
        }
      }
    }
  } catch(e) { /* fall through to CSV fetch */ }

  // Second try: RAW AUDIT NEW CSV — try all known GIDs plus gid=0 (first sheet)
  const gids = [RAW_SHEET_GIDS.rawAudit, RAW_SHEET_GIDS.taggedCases, '0', '1', '2'];
  let parsed = null;

  for (const gid of gids) {
    const url = `https://docs.google.com/spreadsheets/d/${RAW_SHEET_ID}/export?format=csv&gid=${gid}`;
    try {
      const res = await fetch(url, { redirect: 'follow', cache: 'no-cache' });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.trim().startsWith('<!') || text.trim().startsWith('<html')) continue;
      const rows = parseCSV(text);
      // A valid audit sheet has at least a header + 1 data row, and should have 5+ columns
      if (rows.length > 2 && rows[0].length >= 5) {
        // Check if it looks like an audit sheet (has 'name', 'consultant', or error columns)
        const hdrs = rows[0].map(h=>(h||'').toLowerCase().trim());
        const hasName  = hdrs.some(h=>h.includes('name')||h.includes('consultant')||h.includes('agent'));
        const hasLink  = hdrs.some(h=>h.includes('link')||h.includes('url'));
        if (hasName || hasLink) { parsed = rows; break; }
        if (!parsed) parsed = rows; // keep as fallback even without name/link headers
      }
    } catch(e) { continue; }
  }

  if (!parsed || parsed.length < 2) return null;

  // Map headers
  const headers = parsed[0].map(h => (h||'').trim().toLowerCase());
  const colIdx = {};
  headers.forEach((h, i) => {
    const mapped = RAW_COL_MAP[h];
    if (mapped) colIdx[mapped] = i;
  });

  // Also do fuzzy matching for key columns if exact match failed
  if (colIdx['_name'] === undefined) {
    headers.forEach((h, i) => {
      if (h.includes('name') || h.includes('consultant') || h.includes('agent')) {
        if (colIdx['_name'] === undefined) colIdx['_name'] = i;
      }
    });
  }
  if (colIdx['_caseLink'] === undefined) {
    headers.forEach((h, i) => {
      if (h.includes('link') || h.includes('url') || h.includes('http') || h.includes('hubspot')) {
        if (colIdx['_caseLink'] === undefined) colIdx['_caseLink'] = i;
      }
    });
  }
  if (colIdx['_caseName'] === undefined) {
    headers.forEach((h, i) => {
      if ((h.includes('contact') || h.includes('client') || h.includes('lead') || h.includes('case')) && h.includes('name')) {
        if (colIdx['_caseName'] === undefined) colIdx['_caseName'] = i;
      }
    });
  }

  // Fuzzy-match error attribute columns
  headers.forEach((h, i) => {
    if (colIdx[h] !== undefined) return;
    const mapped = RAW_COL_MAP[h.replace(/[^a-z0-9 ]/g,'').trim()];
    if (mapped && ATTR_FIELDS.has(mapped) && colIdx[mapped] === undefined) colIdx[mapped] = i;
  });

  // Build the links map
  // Structure: errorLinksMap['Consultant Name']['fieldName'] = [{url, name, date}, ...]
  const errorLinksMap = {};

  for (let r = 1; r < parsed.length; r++) {
    const row = parsed[r];
    if (!row || !row.length) continue;

    const rawName = colIdx['_name'] !== undefined ? (row[colIdx['_name']]||'').trim() : '';
    if (!rawName) continue;

    const caseLink = colIdx['_caseLink'] !== undefined ? (row[colIdx['_caseLink']]||'').trim() : '';
    const caseName = colIdx['_caseName'] !== undefined ? (row[colIdx['_caseName']]||'').trim() : '';
    const caseDate = colIdx['_date']     !== undefined ? (row[colIdx['_date']]    ||'').trim() : '';

    if (!errorLinksMap[rawName]) errorLinksMap[rawName] = {};

    // For each attribute field, check if this row has an error (non-zero, non-empty, not "✓")
    ATTR_FIELDS.forEach(field => {
      const idx = colIdx[field];
      if (idx === undefined) return;
      const val = (row[idx]||'').trim();
      const isError = val !== '' && val !== '0' && val !== '✓' && val !== '/' && val !== 'n/a' && val !== 'na' && val.toLowerCase() !== 'no' && val.toLowerCase() !== 'false';
      if (isError) {
        if (!errorLinksMap[rawName][field]) errorLinksMap[rawName][field] = [];
        errorLinksMap[rawName][field].push({
          url:  caseLink || '',
          name: caseName || ('Row ' + (r+1)),
          date: caseDate
        });
      }
    });
  }

  return Object.keys(errorLinksMap).length > 0 ? errorLinksMap : null;
}

// ── Merge error links into HOF_ALL ─────────────────────────────────────────
function mergeErrorLinks(errorLinksMap) {
  if (!errorLinksMap || !HOF_ALL.length) return;
  HOF_ALL.forEach(agent => {
    // Try exact match first, then case-insensitive
    let links = errorLinksMap[agent.name];
    if (!links) {
      const lower = agent.name.toLowerCase();
      const key = Object.keys(errorLinksMap).find(k => k.toLowerCase() === lower);
      if (key) links = errorLinksMap[key];
    }
    if (links) {
      agent.errorLinks = links;
    }
  });
  // Re-render everything that shows error links
  hofRenderTable(HOF_filtered);
  try { renderWeightTable(); } catch(e) {}
  // Re-render personal scorecard if a single consultant is selected
  if (HOF_filtered.length === 1) {
    try { renderPersonalCard(HOF_filtered[0]); } catch(e) {}
  }
  showToast('🔗 Case links loaded — errors are now clickable!');
}

// ══════════════════════════════════════════════════════════════
//  SHARED NAV STATE
// ══════════════════════════════════════════════════════════════
var activeTab   = 'hof';
var loadedTabs  = {};
var cmCharts    = {};
var cmStore     = { daily: null, weekly: null, monthly: null };

// ── Theme System ─────────────────────────────────────────────────────────────
var THEMES = ['light','dark','evening','midnight','spring','ocean','rose','coffee','slate','aurora','neon','hof'];
var THEME_ICONS = {light:'☀️ Light',dark:'🌙 Dark',evening:'🌅 Evening',midnight:'🌌 Midnight',spring:'🌿 Spring',ocean:'🌊 Ocean',rose:'🌸 Rose',coffee:'☕ Coffee',slate:'🪨 Slate',aurora:'🌌 Aurora',neon:'⚡ Neon Cyber',hof:'🏢 HOF Brand'};

function setTheme(theme) {
  // Remove all theme classes
  THEMES.forEach(function(t){ if(t!=='light') document.body.classList.remove(t); });
  if (theme !== 'light') document.body.classList.add(theme);
  // Update active state
  THEMES.forEach(function(t){
    var el = document.getElementById('opt-'+t);
    if(el) el.classList.toggle('active', t===theme);
  });
  var btn = document.getElementById('themeBtn');
  if(btn) btn.textContent = (THEME_ICONS[theme]||theme) + ' ▾';
  localStorage.setItem('hof-theme', theme);
  if (typeof hofUpdateCharts === 'function') hofUpdateCharts();
}

function autoThemeByTime() {
  var saved = localStorage.getItem('hof-theme');
  if (saved) { setTheme(saved); return; }
  var h = new Date().getHours();
  if      (h >= 17 && h < 20) setTheme('evening');
  else if (h >= 20 && h < 23) setTheme('midnight');
  else if (h >= 23 || h < 6)  setTheme('dark');
  else                          setTheme('light');
}

// Apply on load
document.addEventListener('DOMContentLoaded', autoThemeByTime);

// Legacy toggleDark kept for any refs
function toggleDark() { setTheme('dark'); }
function toggleEvening() { setTheme('evening'); }

// ── Skeleton show/hide (HOF tab only) ────────────────────────────────────────
function showSkeleton() {
  var sk = document.getElementById('hof-skeleton');
  var kg = document.querySelector('.kg');
  if (sk) sk.classList.add('visible');
  if (kg) kg.style.display = 'none';
  // hide all content below skeleton
  ['trend-grid','hof-weight-section','hof-chart-section'].forEach(function(id){
    var el = document.getElementById(id); if(el) el.style.display='none';
  });
}
function hideSkeleton() {
  var sk = document.getElementById('hof-skeleton');
  var kg = document.querySelector('.kg');
  if (sk) sk.classList.remove('visible');
  if (kg) kg.style.display = '';
}

var ldrCount = 0;
function showLdr(msg) {
  ldrCount++;
  var el = document.getElementById('ldr');
  el.querySelector('#ltxt') && (document.getElementById('ltxt').textContent = msg||'Loading…');
  el.classList.remove('out'); el.style.display = 'flex';
  // Restart progress bar animation
  var bar = document.getElementById('ldr-bar');
  if (bar) {
    bar.style.animation = 'none';
    bar.offsetHeight; // force reflow
    bar.style.width = '0%';
    bar.style.animation = 'ldrFill 8s ease forwards';
  }
}
function hideLdr() {
  ldrCount = Math.max(0, ldrCount - 1);
  if (ldrCount > 0) return;
  var el = document.getElementById('ldr');
  el.classList.add('out');
  setTimeout(function() {
    if (ldrCount === 0) {
      el.style.display = 'none';
      // Reset progress bar for next load
      var bar = document.getElementById('ldr-bar');
      if (bar) { bar.style.animation = 'none'; bar.style.width = '0%'; }
    }
  }, 380);
}

function go(tab) {
  activeTab = tab;
  document.querySelectorAll('.ntab').forEach(function(b) { b.classList.remove('on'); });
  document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('on'); });
  document.getElementById('nt-' + tab).classList.add('on');
  document.getElementById('p-'  + tab).classList.add('on');
  if (!loadedTabs[tab]) {
    if (tab === 'hof') { hofFetch(); }
    else if (tab === 'deals') { loadedTabs.deals = true; /* placeholder */ }
    else { loadCM(tab); }
  }
}

function refreshActive() {
  loadedTabs[activeTab] = false;
  if (activeTab === 'hof') { hofFetch(); } else { loadCM(activeTab); }
}

function cmNumFmt(n) { return n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n); }
function cmPctClr(p) { return p >= 90 ? 'var(--grn)' : p >= 80 ? 'var(--amb)' : 'var(--red)'; }
function cmEmpty(c)  { return '<tr><td colspan="'+c+'" style="text-align:center;padding:28px;color:var(--mu);font-size:12px">No data for this period</td></tr>'; }
function setUpd() {
  document.getElementById('upd').textContent = new Date().toLocaleTimeString();
}
function setGBadge(avg) {
  var b = document.getElementById('gbadge');
  if (avg >= 90)      { b.className = 'hbadge hb-grn'; b.textContent = '🟢 PASS'; }
  else if (avg >= 80) { b.className = 'hbadge hb-amb'; b.textContent = '🟡 NEEDS IMPROVEMENT'; }
  else                { b.className = 'hbadge hb-red'; b.textContent = '🔴 CRITICAL'; }
}

// ══════════════════════════════════════════════════════════════
//  HOF TAB — exact logic from dashboard v5
// ══════════════════════════════════════════════════════════════
let HOF_ALL = [], HOF_filtered = [], HOF_totalAudits = 0, HOF_dateRange = {min:'',audits:''};
let hofTSK = 'total', hofTSD = -1, activeRange = 'thismonth';
let hofBarC, hofDonutC, hofRadarC;

function fmtDate(d) { return d ? d.toISOString().slice(0,10) : ''; }

function getBounds(range) {
  const now=new Date(), y=now.getFullYear(), m=now.getMonth(), d=now.getDate();
  let s=null, e=null;
  if (range==='today')      { s=new Date(y,m,d,0,0,0); e=new Date(y,m,d,23,59,59); }
  else if (range==='thismonth')  { s=new Date(y,m,1);      e=new Date(y,m+1,0,23,59,59); }
  else if (range==='lastmonth') { s=new Date(y,m-1,1); e=new Date(y,m,0,23,59,59); }
  else if (range==='last7')  { s=new Date(); s.setDate(now.getDate()-7);  s.setHours(0,0,0,0); }
  else if (range==='last28') { s=new Date(); s.setDate(now.getDate()-28); s.setHours(0,0,0,0); }
  else if (range==='custom') {
    const sv=document.getElementById('ds').value, ev=document.getElementById('de').value;
    if (sv) { s=new Date(sv); s.setHours(0,0,0,0); }
    if (ev) { e=new Date(ev); e.setHours(23,59,59,999); }
  }
  return {s, e};
}

