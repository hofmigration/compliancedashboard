function updateClock() {
  var el = document.getElementById('hdr-clock');
  if (!el) return;
  var now = new Date();
  var d = now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  var t = now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  el.textContent = d + '  ' + t;
}
updateClock();
setInterval(updateClock, 1000);


hofFetch();
setTimeout(function(){ loadCM('daily'); }, 500);

// ── CM Sub-tab switching ─────────────────────────────────────────────────────
function switchCMTab(tab) {
  document.querySelectorAll('.cm-subtab').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('.cm-subpanel').forEach(function(p){ p.classList.remove('active'); });
  var btn = document.getElementById('cmtab-'+tab);
  var pan = document.getElementById('cmpanel-'+tab);
  if (btn) btn.classList.add('active');
  if (pan) pan.classList.add('active');
  // Auto-load performance data on first switch
  if (tab === 'performance') { setTimeout(perfAutoLoad, 100); }
}

// ── Performance Sheet Connection ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
// PERFORMANCE COMPLIANCE — Full Engine
// Google Sheet: 1Kt6IzxOTlHWhg7WorkbqqZvGIxKMAcLF37LCLXQKuqQ
// ══════════════════════════════════════════════════════════════════════
var perfSheetData = null;
var perfRawRows   = [];        // all data rows
var perfCMMap     = {};        // { cmName: { total, stages:{}, untouched:[], active:[], clients:[] } }
var perfAllStages = [];
var perfCMDonutChart    = null;
var perfActiveDonut     = null;
var perfStageBarChart   = null;
var perfCMStageChart    = null;

// ── Cutoff: "untouched" = last activity before Feb 2025 ───────────────
var PERF_UNTOUCHED_CUTOFF = new Date('2025-02-01');
var PERF_ACTIVE_CUTOFF    = 30; // days

// ── Colours ────────────────────────────────────────────────────────────
var PERF_COLS = ['#6366f1','#10b981','#f59e0b','#ef4444','#06b6d4','#a855f7','#ec4899','#3b82f6','#14b8a6','#f97316','#84cc16','#e11d48'];

// Auto-load on tab switch
function perfAutoLoad() {
  if (perfRawRows.length) return; // already loaded
  perfLoadData();
}

// ── Main data loader ───────────────────────────────────────────────────
function perfLoadData() {
  document.getElementById('perf-status-line').textContent = 'Loading data…';
  document.getElementById('perf-error-bar').style.display = 'none';

  fetch(APIS.perf)
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .then(function(json){
      if(!json.ok) throw new Error(json.error || 'Apps Script returned an error');
      perfProcessJSON(json);
    })
    .catch(function(e){
      perfShowError('Cannot load data from Apps Script. Check the deployment is set to "Anyone" access. Error: ' + e.message);
    });
}

function perfShowError(msg) {
  var eb = document.getElementById('perf-error-bar');
  document.getElementById('perf-error-msg').textContent = msg;
  eb.style.display = 'flex';
  document.getElementById('perf-status-line').textContent = 'Error loading data';
}

// ── Process JSON from Apps Script (replaces CSV path) ──────────────────
function perfProcessJSON(json) {
  // json shape: { ok, totalCases, totalActive, totalUntouched, totalCMs,
  //               ieltsCount, petitionCount, stageMap, cms[], meta }
  // cms[] shape: { name, total, stages:{}, untouched:[], active:[], allClients:[] }

  // Feed into perfCMMap so all existing render functions work unchanged
  perfCMMap = {};
  perfAllStages = [];
  var stagesSet = {};

  (json.cms || []).forEach(function(c) {
    perfCMMap[c.name] = {
      name:             c.name,
      total:            c.total            || 0,
      stages:           c.stages           || {},
      untouched:        c.untouched        || [],
      active:           c.active           || [],
      allClients:       c.allClients       || [],
      pausedNonPayment: c.pausedNonPayment || []
    };
    Object.keys(c.stages || {}).forEach(function(s){ stagesSet[s] = 1; });
  });

  perfAllStages = Object.keys(stagesSet).sort();

  // Synthetic perfRawRows length for any legacy references
  perfRawRows = new Array(json.totalCases || 0);
  perfSheetData = { nameCol:0, stageCol:1, dateCol:2, clientCol:3, hdrs:[] };

  var total  = json.totalCases     || 0;
  var cmList = Object.values(perfCMMap).sort(function(a,b){ return b.total - a.total; });

  // ── KPIs ──────────────────────────────────────────────────────────────
  document.getElementById('perf-total-cases').textContent = total;

  // ── Active Clients: count from col H Client Status = "Active" ──────────────
  // If GAS sends totalActive (computed from col H), use it directly.
  // Fallback: count from json.rows where clientStatus === "active"
  var _activeCount = json.totalActive || 0;
  if (!_activeCount && (json.rows||[]).length) {
    _activeCount = (json.rows).filter(function(r){
      return (r.clientStatus||r.isActiveStatus||'').toString().toLowerCase().trim() === 'active';
    }).length;
  }
  document.getElementById('perf-active').textContent      = _activeCount;

  document.getElementById('perf-untouched').textContent   = json.totalUntouched  || 0;
  document.getElementById('perf-cm-count').textContent    = json.totalCMs        || cmList.length;

  // ── Stage KPIs ──────────────────────────────────────────────────────────────
  var _sm  = json.stageMap     || {};
  var _dsm = json.dealStageMap || {};
  var _ielts = Object.entries(_sm).filter(function(e){return e[0].toLowerCase().includes('ielt');}).reduce(function(s,e){return s+e[1];},0);
  var _eca   = Object.entries(_sm).filter(function(e){return e[0].toLowerCase().includes('eca');}).reduce(function(s,e){return s+e[1];},0);
  var _submitted = Object.entries(_sm).filter(function(e){return e[0].toLowerCase().includes('submitted');}).reduce(function(s,e){return s+e[1];},0);

  // ── Petition: use petitionClients[] sent by GAS (hasPetition checks col E+G) ──
  var _petitionClients = json.petitionClients || [];
  var _petitionPrep = 0, _petitionFiled = 0;
  _petitionClients.forEach(function(r){
    var ps = (r.processStage||'').toLowerCase().trim();
    var ds = (r.dealStage||'').toLowerCase().trim();
    if (ps.indexOf('petition fil') !== -1 || ds.indexOf('petition fil') !== -1) _petitionFiled++;
    else _petitionPrep++;
  });
  var _petition = _petitionClients.length || json.petitionCount || 0;
  if (!_petition) {
    // Fallback: scan json.rows[] (one entry per client) to avoid double-counting stageMap+dealStageMap
    var _fbRows = json.rows || [];
    if (_fbRows.length) {
      _fbRows.forEach(function(r){
        var ps = (r.processStage||'').toLowerCase();
        var ds = (r.dealStage||'').toLowerCase();
        var hasPet = ps.indexOf('petition') !== -1 || ds.indexOf('petition') !== -1;
        if (!hasPet) return;
        var isFiled = ps.indexOf('petition fil') !== -1 || ds.indexOf('petition fil') !== -1;
        if (isFiled) _petitionFiled++;
        else _petitionPrep++;
      });
    } else {
      // Last resort: stageMap only (col E), no dealStageMap to avoid double-count
      Object.entries(_sm).forEach(function(e){ var k=e[0].toLowerCase(); if(k.indexOf('petition fil')!==-1) _petitionFiled+=e[1]; else if(k.indexOf('petition')!==-1) _petitionPrep+=e[1]; });
    }
    _petition = _petitionPrep + _petitionFiled;
  }

  document.getElementById('perf-ielts').textContent       = _ielts     || '—';
  document.getElementById('perf-petition').textContent    = _petition  || '—';
  if(document.getElementById('perf-petition-prep'))  document.getElementById('perf-petition-prep').textContent  = String(_petitionPrep);
  if(document.getElementById('perf-petition-filed')) document.getElementById('perf-petition-filed').textContent = String(_petitionFiled);
  document.getElementById('perf-eca').textContent         = _eca       || '—';
  document.getElementById('perf-submitted').textContent   = _submitted || '—';
  // Store globally for modal access
  window._perfStageMap        = _sm;
  window._perfDealStageMap    = _dsm;
  window._perfRows            = json.rows || [];
  window._perfPetitionClients = _petitionClients;
  document.getElementById('perf-untouched-badge').textContent = (json.totalUntouched || 0) + ' cases';

  // ── Populate dropdowns ────────────────────────────────────────────────
  var opts = '<option value="all">👥 All Case Managers</option>'
    + cmList.map(function(c){ return '<option value="'+c.name+'">'+c.name+'</option>'; }).join('');
  document.getElementById('perf-consultant-sel').innerHTML = opts;
  document.getElementById('perf-cm-filter').innerHTML =
    '<option value="all">All Case Managers</option>'
    + cmList.map(function(c){ return '<option value="'+c.name+'">'+c.name+'</option>'; }).join('');
  buildCMDropdown(cmList);

  // ── Render all visuals ────────────────────────────────────────────────
  perfRenderCMDonut(cmList, total);
  perfRenderStageBarChart(json.stageMap || {}, null);
  perfRenderActiveDonut(json.totalActive || 0, json.totalUntouched || 0, total);
  perfRenderMatrix(cmList);
  perfRenderCMStageChart('all');
  perfRenderStatusGroups(cmList);
  perfRenderProcessGroups(cmList);
  perfRenderUntouched(cmList);
  perfRenderPaused(cmList);
  perfRenderTable(cmList, total);

  var meta = json.meta || {};
  document.getElementById('perf-status-line').textContent =
    total + ' cases loaded · ' + (cmList.length) + ' CMs · refreshed ' + new Date().toLocaleTimeString()
    + (meta.sheetTab ? ' · tab: ' + meta.sheetTab : '');

  showToast('✅ Performance data loaded — ' + total + ' cases across ' + cmList.length + ' CMs');
}
function perfParseCSVLine(line) {
  var result=[], cur='', inQ=false;
  for(var i=0;i<line.length;i++){
    var c=line[i];
    if(c==='"'){inQ=!inQ;}
    else if(c===','&&!inQ){result.push(cur.trim());cur='';}
    else cur+=c;
  }
  result.push(cur.trim());
  return result;
}

function perfProcessCSV(csv) {
  var lines = csv.trim().split(/\r?\n/);
  if(lines.length < 2){ perfShowError('Sheet appears empty or has no data rows.'); return; }

  var hdrs = perfParseCSVLine(lines[0]).map(function(h){ return h.replace(/^"|"$/g,'').trim().toLowerCase(); });

  // Detect columns (flexible)
  var nameCol=-1, stageCol=-1, dealStageCol=-1, dateCol=-1, clientCol=-1, clientStatusCol=-1;
  var nameKws       = ['case manager','cm','assigned to','owner','consultant name','consultant','agent','name'];
  var processStgKws = ['process stage','process_stage','processstage','case stage','pipeline stage','current stage'];
  var dealStgKws    = ['deal stage','deal_stage','dealstage'];
  var stageKws      = ['stage','status'];
  var dateKws       = ['last activity date','last activity','activity date','last contact','last update','updated','date'];
  var clientKws     = ['client name','client','contact name','contact','lead name','case name','customer'];
  var clientStKws   = ['client status','clientstatus','is active','isactive','active status'];

  hdrs.forEach(function(h,i){
    if(nameCol<0         && nameKws.some(function(k){return h.includes(k);}))       nameCol=i;
    if(stageCol<0        && processStgKws.some(function(k){return h.includes(k);})) stageCol=i;
    if(dealStageCol<0    && dealStgKws.some(function(k){return h.includes(k);}))    dealStageCol=i;
    if(dateCol<0         && dateKws.some(function(k){return h.includes(k);}))       dateCol=i;
    if(clientCol<0       && clientKws.some(function(k){return h.includes(k);}))     clientCol=i;
    if(clientStatusCol<0 && clientStKws.some(function(k){return h.includes(k);}))  clientStatusCol=i;
  });
  // Second pass: if no specific process stage found, fall back to any remaining stage/status header
  if(stageCol<0) hdrs.forEach(function(h,i){
    if(stageCol<0 && i!==dealStageCol && stageKws.some(function(k){return h.includes(k);})) stageCol=i;
  });

  // Fallback: use col 0 = name, col 1 = stage, col 2 = date
  if(nameCol<0)  nameCol=0;
  if(stageCol<0) stageCol=Math.min(1, hdrs.length-1);
  if(dateCol<0 && hdrs.length>2) dateCol=2;

  perfRawRows = [];
  for(var i=1;i<lines.length;i++){
    var parts = perfParseCSVLine(lines[i]);
    if(!parts.some(function(p){return p.replace(/^"|"$/g,'').trim();})) continue; // skip blank rows
    var clean = parts.map(function(p){return p.replace(/^"|"$/g,'').trim();});
    perfRawRows.push(clean);
  }

  if(!perfRawRows.length){ perfShowError('Sheet has headers but no data rows.'); return; }

  perfSheetData = { hdrs:hdrs, nameCol:nameCol, stageCol:stageCol, dealStageCol:dealStageCol, dateCol:dateCol, clientCol:clientCol, clientStatusCol:clientStatusCol };
  perfBuildAll();
  document.getElementById('perf-status-line').textContent = perfRawRows.length + ' cases loaded · Last refreshed ' + new Date().toLocaleTimeString();
}

// ── Build all computed data ─────────────────────────────────────────────
function perfBuildAll() {
  var nc  = perfSheetData.nameCol,      sc  = perfSheetData.stageCol,
      dsc = perfSheetData.dealStageCol, dc  = perfSheetData.dateCol,
      cc  = perfSheetData.clientCol,    csc = perfSheetData.clientStatusCol;

  perfCMMap = {};
  var stagesSet = {};
  var totalUntouched=0, totalActive=0;
  var perfRowObjects = []; // object form for showStageModal

  perfRawRows.forEach(function(r){
    var cm        = nc>=0  ? (r[nc]||'Unknown').trim()  : 'Unknown';
    var stage     = sc>=0  ? (r[sc]||'').trim()         : '';
    var dealStage = dsc>=0 ? (r[dsc]||'').trim()        : (r[6]||'').trim();
    var dateStr   = dc>=0  ? (r[dc]||'').trim()         : '';
    var client    = cc>=0  ? (r[cc]||'').trim()         : '';

    if(!cm || cm==='0' || cm.toLowerCase()==='case manager') return;

    if(!perfCMMap[cm]) perfCMMap[cm] = {name:cm, total:0, stages:{}, untouched:[], active:[], allClients:[]};

    var effectiveStage = stage || dealStage || 'Unknown';
    perfCMMap[cm].total++;
    if(effectiveStage && effectiveStage!=='Unknown'){
      perfCMMap[cm].stages[effectiveStage]=(perfCMMap[cm].stages[effectiveStage]||0)+1;
      stagesSet[effectiveStage]=1;
    }
    if(client) perfCMMap[cm].allClients.push({name:client, stage:effectiveStage, date:dateStr});

    // Build object rows for showStageModal petition lookup
    perfRowObjects.push({
      cm: cm, name: client, processStage: stage, dealStage: dealStage,
      lastContacted: dateStr, lastActivityDateDisplay: dateStr
    });

    var dateObj=null;
    if(dateStr){
      if(/^\d{4,5}$/.test(dateStr)){
        var ser=parseInt(dateStr); dateObj=new Date(Date.UTC(1899,11,30)+ser*86400000);
      } else { var d=new Date(dateStr); if(!isNaN(d.getTime())) dateObj=d; }
    }

    var isUntouched = !dateObj || dateObj < PERF_UNTOUCHED_CUTOFF;
    // Active = clientStatusCol if detected, else fallback to col index 7
    var clientStatusVal = csc>=0 ? (r[csc]||'').toString().toLowerCase().trim()
                                 : (r[7]||'').toString().toLowerCase().trim();
    var isActive = clientStatusVal === 'active';

    if(isUntouched){
      totalUntouched++;
      perfCMMap[cm].untouched.push({name:client||'—', stage:effectiveStage, date:dateStr});
    }
    if(isActive){
      totalActive++;
      perfCMMap[cm].active.push({name:client||'—', stage:effectiveStage, date:dateStr});
    }
  });

  perfAllStages = Object.keys(stagesSet).sort();
  var total = perfRawRows.length;
  var cmList = Object.values(perfCMMap).sort(function(a,b){return b.total-a.total;});
  window._perfTotalCases  = total;
  window._perfTotalActive = totalActive;
  // Expose object rows so showStageModal can find petition clients by processStage+dealStage
  window._perfRows = perfRowObjects;

  // KPIs
  document.getElementById('perf-total-cases').textContent = total;
  document.getElementById('perf-active').textContent      = totalActive;
  document.getElementById('perf-untouched').textContent   = totalUntouched;
  document.getElementById('perf-cm-count').textContent    = cmList.length;
  document.getElementById('perf-untouched-badge').textContent = totalUntouched + ' cases';

  // Stage KPIs — petition checks BOTH processStage AND dealStage
  var allStageMap = {}, allDealMap = {};
  var _pbPrep = 0, _pbFiled = 0;
  perfRawRows.forEach(function(r, idx){
    var s  = perfSheetData.stageCol>=0    ? (r[perfSheetData.stageCol]||'').trim()    : '';
    var ds = perfSheetData.dealStageCol>=0 ? (r[perfSheetData.dealStageCol]||'').trim() : (r[6]||'').trim();
    if(s)  allStageMap[s]=(allStageMap[s]||0)+1;
    if(ds) allDealMap[ds]=(allDealMap[ds]||0)+1;
    // ── PETITION FIX: check BOTH col E (processStage) AND col G (dealStage) ──
    var sl = s.toLowerCase();
    var dl = ds.toLowerCase();
    var hasPet = sl.indexOf('petition') !== -1 || dl.indexOf('petition') !== -1;
    if (hasPet) {
      var isFiled = sl.indexOf('petition fil') !== -1 || dl.indexOf('petition fil') !== -1;
      if (isFiled) _pbFiled++;
      else _pbPrep++;
    }
  });
  var ielts     = Object.entries(allStageMap).filter(function(e){return e[0].toLowerCase().includes('ielt');}).reduce(function(s,e){return s+e[1];},0);
  var petition  = _pbPrep + _pbFiled;
  var eca       = Object.entries(allStageMap).filter(function(e){return e[0].toLowerCase().includes('eca');}).reduce(function(s,e){return s+e[1];},0);
  var submitted = Object.entries(allStageMap).filter(function(e){return e[0].toLowerCase().includes('submitted');}).reduce(function(s,e){return s+e[1];},0);
  document.getElementById('perf-ielts').textContent     = ielts    ||'—';
  document.getElementById('perf-petition').textContent  = petition ||'—';
  if(document.getElementById('perf-petition-prep'))  document.getElementById('perf-petition-prep').textContent  = _pbPrep  || '—';
  if(document.getElementById('perf-petition-filed')) document.getElementById('perf-petition-filed').textContent = _pbFiled || '—';
  if(document.getElementById('perf-eca'))       document.getElementById('perf-eca').textContent      = eca      ||'—';
  if(document.getElementById('perf-submitted')) document.getElementById('perf-submitted').textContent = submitted||'—';

  // Populate dropdowns
  var selA = document.getElementById('perf-consultant-sel');
  var selB = document.getElementById('perf-cm-filter');
  var opts = '<option value="all">👥 All Case Managers</option>'
    + cmList.map(function(c){return '<option value="'+c.name+'">'+c.name+'</option>';}).join('');
  selA.innerHTML = opts;
  selB.innerHTML = '<option value="all">All Case Managers</option>'
    + cmList.map(function(c){return '<option value="'+c.name+'">'+c.name+'</option>';}).join('');
  buildCMDropdown(cmList);

  // Render charts + sections
  perfRenderCMDonut(cmList, total);
  perfRenderStageBarChart(allStageMap);
  perfRenderActiveDonut(totalActive, totalUntouched, total);
  perfRenderMatrix(cmList);
  perfRenderCMStageChart('all');
  perfRenderStatusGroups(cmList);
  perfRenderProcessGroups(cmList);
  perfRenderUntouched(cmList);
  perfRenderPaused(cmList);
  perfRenderTable(cmList, total);

  showToast('✅ Performance data loaded — ' + total + ' cases across ' + cmList.length + ' CMs');
}

// ── Donut: Cases per CM ─────────────────────────────────────────────────
function perfRenderCMDonut(cmList, total) {
  var ctx = document.getElementById('perf-cm-donut');
  if(!ctx) return;
  if(perfCMDonutChart) { perfCMDonutChart.destroy(); perfCMDonutChart=null; }
  var labels = cmList.map(function(c){return c.name;});
  var data   = cmList.map(function(c){return c.total;});
  var cols   = cmList.map(function(_,i){return PERF_COLS[i%PERF_COLS.length];});
  perfCMDonutChart = new Chart(ctx, {
    type:'doughnut',
    data:{labels:labels,datasets:[{data:data,backgroundColor:cols,borderWidth:2,borderColor:'var(--w)'}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return ' '+c.label+': '+c.parsed+' cases ('+Math.round(c.parsed/total*100)+'%)';}}}}},
  });
  // Legend
  var leg = document.getElementById('perf-cm-legend');
  if(leg) leg.innerHTML = cmList.slice(0,8).map(function(c,i){
    return '<div style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer" onclick="perfOnCMFilterChange(\''+c.name+'\')">'
      +'<span style="width:10px;height:10px;border-radius:50%;background:'+PERF_COLS[i%PERF_COLS.length]+';flex-shrink:0"></span>'
      +'<span style="color:var(--tx);font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.name+'</span>'
      +'<span style="color:var(--mu);font-family:DM Mono,monospace;font-size:10px">'+c.total+'</span>'
    +'</div>';
  }).join('');
}

// ── Stage distribution bar chart ────────────────────────────────────────
function perfRenderStageBarChart(stageMap, cmName) {
  var ctx = document.getElementById('perf-stage-bar-chart');
  if(!ctx) return;
  if(perfStageBarChart) { perfStageBarChart.destroy(); perfStageBarChart=null; }
  var sub = document.getElementById('perf-stage-chart-sub');
  if(sub) sub.textContent = cmName ? cmName + ' · stage breakdown' : 'All CMs · click consultant dropdown to filter';

  var sorted = Object.entries(stageMap).sort(function(a,b){return b[1]-a[1];}).slice(0,12);
  var labels = sorted.map(function(e){return e[0];});
  var data   = sorted.map(function(e){return e[1];});
  var cols   = labels.map(function(l,i){
    var ll=l.toLowerCase();
    if(ll.includes('ielt')) return '#06b6d4';
    if(ll.includes('petition')) return '#a855f7';
    if(ll.includes('active')||ll.includes('progress')) return '#10b981';
    if(ll.includes('inactive')||ll.includes('closed')||ll.includes('dead')) return '#ef4444';
    return PERF_COLS[i%PERF_COLS.length];
  });
  perfStageBarChart = new Chart(ctx, {
    type:'bar',
    data:{labels:labels,datasets:[{data:data,backgroundColor:cols,borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{grid:{display:false},ticks:{font:{size:11},maxRotation:35}},y:{grid:{color:'rgba(0,0,0,.05)'},ticks:{font:{size:11}}}}}
  });
}

// ── Active vs Untouched donut ────────────────────────────────────────────
function perfRenderActiveDonut(active, untouched, total, periodLabel) {
  var ctx = document.getElementById('perf-active-donut');
  if(!ctx) return;
  if(perfActiveDonut) { perfActiveDonut.destroy(); perfActiveDonut=null; }
  var other = Math.max(0, total - active - untouched);
  var untouchedLabel = periodLabel ? 'Untouched (' + periodLabel + ')' : 'Untouched';
  perfActiveDonut = new Chart(ctx, {
    type:'doughnut',
    data:{labels:['Active (≤30 days)', untouchedLabel,'Other'],
      datasets:[{data:[active,untouched,other],backgroundColor:['#10b981','#ef4444','#94a3b8'],borderWidth:2,borderColor:'var(--w)'}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{display:false}}}
  });
  var leg = document.getElementById('perf-active-legend');
  if(leg) leg.innerHTML = [
    {label:'Active (≤30 days)', val:active, col:'#10b981'},
    {label:untouchedLabel, val:untouched, col:'#ef4444'},
    {label:'Other', val:other, col:'#94a3b8'}
  ].map(function(it){
    return '<div style="display:flex;align-items:center;gap:8px;font-size:11px">'
      +'<span style="width:10px;height:10px;border-radius:50%;background:'+it.col+';flex-shrink:0"></span>'
      +'<span style="flex:1;color:var(--tx)">'+it.label+'</span>'
      +'<span style="font-family:DM Mono,monospace;font-weight:700;color:'+it.col+'">'+it.val+'</span>'
    +'</div>';
  }).join('');
}

// ── Stage × CM Matrix ────────────────────────────────────────────────────
function perfRenderMatrix(cmList) {
  var wrap = document.getElementById('perf-matrix-wrap');
  if(!wrap || !cmList.length || !perfAllStages.length) return;
  var stages = perfAllStages; // ── show ALL stages, not just 10
  var maxVal = 1;
  cmList.forEach(function(c){ stages.forEach(function(s){ if((c.stages[s]||0)>maxVal) maxVal=c.stages[s]; }); });

  wrap.innerHTML = '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px;width:100%;min-width:600px">'
    +'<thead><tr><th style="padding:8px 12px;text-align:left;color:var(--mu);font-family:DM Mono,monospace;font-size:9px;letter-spacing:.5px;background:var(--s2);position:sticky;left:0;white-space:nowrap;z-index:2">CASE MANAGER</th>'
    + stages.map(function(s){
        var ll=s.toLowerCase();
        var col=ll.includes('ielt')?'#06b6d4':ll.includes('petition')?'#a855f7':ll.includes('active')||ll.includes('progress')?'#10b981':ll.includes('inactive')||ll.includes('closed')||ll.includes('reject')?'#ef4444':'#6366f1';
        // full name — no truncation
        return '<th style="padding:8px 10px;text-align:center;color:'+col+';font-family:DM Mono,monospace;font-size:9px;letter-spacing:.3px;background:var(--s2);white-space:nowrap" title="'+s+'">'+s+'</th>';
      }).join('')
    +'<th style="padding:8px 10px;text-align:center;color:var(--mu);font-family:DM Mono,monospace;font-size:9px;background:var(--s2);white-space:nowrap">TOTAL</th>'
    +'</tr></thead><tbody>'
    + cmList.map(function(c){
        return '<tr style="border-bottom:1px solid var(--b)">'
          +'<td style="padding:7px 12px;font-weight:700;font-size:12px;color:var(--tx);background:var(--s2);position:sticky;left:0;cursor:pointer;white-space:nowrap;z-index:1" onclick="perfOnCMFilterChange(\''+c.name+'\')" title="Filter by '+c.name+'">'+c.name+'</td>'
          + stages.map(function(s){
              var v=c.stages[s]||0;
              var intensity=v>0?Math.max(0.12, Math.min(0.9, v/maxVal)):0;
              var ll=s.toLowerCase();
              var col=ll.includes('ielt')?'rgba(6,182,212,'+intensity+')':ll.includes('petition')?'rgba(168,85,247,'+intensity+')':ll.includes('active')||ll.includes('progress')?'rgba(16,185,129,'+intensity+')':ll.includes('inactive')||ll.includes('closed')||ll.includes('reject')?'rgba(239,68,68,'+intensity+')':'rgba(99,102,241,'+intensity+')';
              var safeName = c.name.replace(/'/g,"\\'");
              var safeStage = s.replace(/'/g,"\\'");
              // clickable cell — shows clients for this CM+stage
              return '<td style="padding:7px 10px;text-align:center;background:'+col+';font-family:DM Mono,monospace;font-weight:'+(v>0?'700':'400')+';font-size:12px;color:'+(v>0?'var(--tx)':'var(--mu)')+(v>0?';cursor:pointer':'')+'" '
                +(v>0?'onclick="perfShowMatrixClients(\''+safeName+'\',\''+safeStage+'\')" title="'+c.name+' · '+s+' · '+v+' clients — click to view"':'')
                +'>'+( v>0?v:'—')+'</td>';
            }).join('')
          +'<td style="padding:7px 10px;text-align:center;font-family:DM Mono,monospace;font-weight:800;font-size:13px;color:#6366f1">'+c.total+'</td>'
        +'</tr>';
      }).join('')
    +'</tbody></table></div>';
}

// ── CM Stage Bar Chart (filterable) ─────────────────────────────────────
function perfRenderCMStageChart(cmName) {
  var ctx = document.getElementById('perf-cm-stage-chart');
  if(!ctx) return;
  if(perfCMStageChart) { perfCMStageChart.destroy(); perfCMStageChart=null; }

  var titleEl = document.getElementById('perf-cm-stage-title');
  var subEl   = document.getElementById('perf-cm-stage-sub');

  if(cmName==='all') {
    // Show all CMs as groups
    var cmList = Object.values(perfCMMap).sort(function(a,b){return b.total-a.total;});
    var stages = perfAllStages.slice(0,6);
    if(titleEl) titleEl.textContent = '📈 Stage Breakdown — All Case Managers';
    if(subEl) subEl.textContent = 'Top 6 stages · each bar group = one CM';

    var datasets = stages.map(function(s,si){
      var ll=s.toLowerCase();
      var col=ll.includes('ielt')?'#06b6d4':ll.includes('petition')?'#a855f7':ll.includes('active')?'#10b981':ll.includes('inactive')||ll.includes('closed')?'#ef4444':PERF_COLS[si%PERF_COLS.length];
      return { label:s, data:cmList.map(function(c){return c.stages[s]||0;}), backgroundColor:col, borderRadius:4, borderSkipped:false };
    });
    perfCMStageChart = new Chart(ctx, {
      type:'bar',
      data:{labels:cmList.map(function(c){return c.name;}), datasets:datasets},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}}},
        scales:{x:{grid:{display:false},ticks:{font:{size:10},maxRotation:30}},y:{grid:{color:'rgba(0,0,0,.05)'},stacked:false}}}
    });
  } else {
    // Single CM
    var cm = perfCMMap[cmName];
    if(!cm) return;
    if(titleEl) titleEl.textContent = '📈 ' + cmName + ' — Stage Breakdown';
    if(subEl) subEl.textContent = cm.total+' total cases · '+cm.untouched.length+' untouched · '+(cm.active.length)+' active';
    var sorted = Object.entries(cm.stages).sort(function(a,b){return b[1]-a[1];});
    var cols = sorted.map(function(e,i){
      var ll=e[0].toLowerCase();
      return ll.includes('ielt')?'#06b6d4':ll.includes('petition')?'#a855f7':ll.includes('active')?'#10b981':ll.includes('inactive')||ll.includes('closed')?'#ef4444':PERF_COLS[i%PERF_COLS.length];
    });
    perfCMStageChart = new Chart(ctx, {
      type:'bar',
      data:{labels:sorted.map(function(e){return e[0];}),datasets:[{data:sorted.map(function(e){return e[1];}),backgroundColor:cols,borderRadius:6,borderSkipped:false}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
        scales:{x:{grid:{display:false},ticks:{font:{size:11},maxRotation:35}},y:{grid:{color:'rgba(0,0,0,.05)'},ticks:{font:{size:11},stepSize:1}}}}
    });
  }
}

// ── Matrix cell click — show clients for this CM + stage ────────────────────
function perfShowMatrixClients(cmName, stageName) {
  var cm = perfCMMap[cmName];
  if (!cm) return;
  var clients = (cm.allClients || []).filter(function(cl){
    return (cl.processStage || '') === stageName;
  });
  document.getElementById('perf-modal-title').textContent = cmName + ' · ' + stageName;
  document.getElementById('perf-modal-sub').textContent   = clients.length + ' clients in this stage';
  var body = document.getElementById('perf-modal-body');
  body.innerHTML = clients.length
    ? clients.map(function(cl, i){
        return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--b)">'
          +'<span style="font-family:DM Mono,monospace;font-size:10px;color:var(--mu);width:22px;text-align:right">'+(i+1)+'.</span>'
          +'<div style="flex:1;min-width:0">'
            +'<div style="font-size:13px;font-weight:700;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(cl.name||'—')+'</div>'
            +'<div style="font-size:11px;color:var(--mu);margin-top:2px;display:flex;flex-wrap:wrap;gap:6px">'
              +(cl.appStatus&&cl.appStatus!=='—'?'<span style="background:var(--s2);border:1px solid var(--b);padding:1px 6px;border-radius:4px">'+cl.appStatus+'</span>':'')
              +(cl.lastContacted?'<span>Last contact: '+cl.lastContacted+'</span>':'<span style="color:#ef4444">No contact date</span>')
            +'</div>'
          +'</div>'
        +'</div>';
      }).join('')
    : '<div style="text-align:center;color:var(--mu);padding:30px">No clients found</div>';
  document.getElementById('perf-modal').style.display = 'flex';
  document.getElementById('perf-modal-overlay').style.display = 'block';
}

// ── Grouping helpers ─────────────────────────────────────────────────────────
var RISK_KEYWORDS   = ['paused/on-hold','non-payment','bad debt'];
var CLOSED_KEYWORDS = ['completely closed','withdrawn','rejected','refund','approved'];

function getStatusGroup(client) {
  var status = (client.appStatus || '').toLowerCase();
  for (var r = 0; r < RISK_KEYWORDS.length; r++) {
    if (status.indexOf(RISK_KEYWORDS[r]) !== -1) return 'risk';
  }
  for (var c = 0; c < CLOSED_KEYWORDS.length; c++) {
    if (status.indexOf(CLOSED_KEYWORDS[c]) !== -1) return 'closed';
  }
  var stage = (client.processStage || '').toLowerCase();
  for (var c = 0; c < CLOSED_KEYWORDS.length; c++) {
    if (stage.indexOf(CLOSED_KEYWORDS[c]) !== -1) return 'closed';
  }
  return 'active';
}

function getProcessGroup(processStage) {
  var s = (processStage || '').toLowerCase();
  if (s.includes('eca') || s.includes('iee') || (s.includes('document') && !s.includes('iee in')) ||
      s.includes('waiting for ielts') || s.includes('waiting for tef') || s.includes('skill assessment') ||
      s.includes('phase 2') || s.includes('ielts stage') || s.includes('waiting for ielts')) return 'Pre-Process';
  if (s.includes('express entry') || s.includes('pnp') || s.includes('sinp') ||
      s.includes('brainstorming') || s.includes('in progress') || s.includes('in process') ||
      s.includes('registered') || s.includes('passport') || s.includes('nominated') ||
      s.includes('submitted')) return 'Active Process';
  if (s.includes('ita') || s.includes('petition') || s.includes('forms filing') ||
      s.includes('merging') || s.includes('iee in process') || s.includes('iee stage') ||
      s.includes('copr')) return 'High Intent';
  if (s.includes('visa granted') || s.includes('visa stamping') || s.includes('approved') ||
      s.includes('completely closed')) return 'Closed';
  if (s.includes('cancelled') || s.includes('withdrawn') || s.includes('rejected')) return 'Drop';
  if (s.includes('awaiting dispatch') || s.includes('merging in process')) return 'Internal';
  return 'Active Process'; // default
}

// ── Hover Popup helpers ───────────────────────────────────────────────────────
var _hoverPopupTimer  = null;
var _activePopupId    = null;

function showHoverPopup(event, popupId) {
  clearHoverPopupTimer();
  // Hide any other open popup
  if (_activePopupId && _activePopupId !== popupId) {
    var prev = document.getElementById(_activePopupId);
    if (prev) prev.style.display = 'none';
  }
  var popup = document.getElementById(popupId);
  if (!popup) return;
  _activePopupId = popupId;

  var trigger    = event.currentTarget.getBoundingClientRect();
  var popupW     = 360;
  var viewportW  = window.innerWidth;
  var viewportH  = window.innerHeight;

  // Prefer right side; fall back to left; centre as last resort
  var left = trigger.right + 12;
  if (left + popupW > viewportW - 10) left = trigger.left - popupW - 12;
  if (left < 10) left = Math.max(10, (viewportW - popupW) / 2);

  var top = trigger.top;
  var maxH = Math.min(460, viewportH - top - 20);
  if (top + maxH > viewportH - 10) top = Math.max(10, viewportH - maxH - 10);

  popup.style.left    = left + 'px';
  popup.style.top     = top  + 'px';
  popup.style.maxHeight = maxH + 'px';
  popup.style.display = 'block';
}

function scheduleHideHoverPopup() {
  _hoverPopupTimer = setTimeout(function() {
    if (_activePopupId) {
      var popup = document.getElementById(_activePopupId);
      if (popup) popup.style.display = 'none';
      _activePopupId = null;
    }
  }, 220);
}

function clearHoverPopupTimer() {
  if (_hoverPopupTimer) { clearTimeout(_hoverPopupTimer); _hoverPopupTimer = null; }
}

// ── Shared: build hover-popup cards for any group structure ──────────────────
// groups = [{label, color, icon, clients:[{name,processStage,appStatus,lastContacted,cm}]}]
// ── Group modal state ──────────────────────────────────────────────────────────
var _grpModalAllClients = [];
var _grpModalActiveStage = 'ALL';

function openGrpModal(label, color, icon, clients) {
  _grpModalAllClients = clients;
  _grpModalActiveStage = 'ALL';

  var header = document.getElementById('grp-modal-header');
  if (header) header.style.background = 'linear-gradient(135deg,'+color+','+color+'bb)';
  document.getElementById('grp-modal-eyebrow').textContent = 'GROUP · ' + clients.length + ' CLIENTS';
  document.getElementById('grp-modal-title').textContent   = icon + ' ' + label;
  document.getElementById('grp-modal-sub').textContent     = clients.length + ' total clients across all stages';
  document.getElementById('grp-modal-search').value        = '';

  // Build stage tabs
  var stageCount = {};
  clients.forEach(function(cl){ var s = cl.processStage||'Unknown'; stageCount[s]=(stageCount[s]||0)+1; });
  var stagePairs = Object.entries(stageCount).sort(function(a,b){return b[1]-a[1];});
  var tabsEl = document.getElementById('grp-modal-stage-tabs');
  tabsEl.innerHTML = '<button onclick="setGrpStage(\'ALL\',\''+color+'\')" id="grp-stab-ALL" '
    + 'style="padding:4px 12px;border-radius:16px;border:1.5px solid '+color+';background:'+color+';color:#fff;font-size:11px;font-weight:700;cursor:pointer;font-family:Nunito,sans-serif">All ('+clients.length+')</button>'
    + stagePairs.slice(0,12).map(function(p){
        return '<button onclick="setGrpStage(\''+p[0].replace(/'/g,"\\'")+'\',\''+color+'\')" id="grp-stab-'+p[0].replace(/[^a-z0-9]/gi,'_')+'" '
          + 'style="padding:4px 12px;border-radius:16px;border:1.5px solid '+color+'55;background:transparent;color:'+color+';font-size:11px;font-weight:700;cursor:pointer;font-family:Nunito,sans-serif">'+p[0]+' ('+p[1]+')</button>';
      }).join('');

  _renderGrpModalBody(clients, color);

  document.getElementById('grp-modal').style.display   = 'flex';
  document.getElementById('grp-modal-overlay').style.display = 'block';
}

function setGrpStage(stage, color) {
  _grpModalActiveStage = stage;
  var clients = stage === 'ALL' ? _grpModalAllClients
    : _grpModalAllClients.filter(function(cl){ return (cl.processStage||'Unknown') === stage; });
  // Update tab styles
  document.querySelectorAll('#grp-modal-stage-tabs button').forEach(function(btn){
    if (btn.id === 'grp-stab-' + (stage === 'ALL' ? 'ALL' : stage.replace(/[^a-z0-9]/gi,'_'))) {
      btn.style.background = color; btn.style.color = '#fff';
    } else {
      btn.style.background = 'transparent'; btn.style.color = color;
    }
  });
  _renderGrpModalBody(clients, color);
}

function filterGrpModal() {
  var q = (document.getElementById('grp-modal-search').value || '').toLowerCase();
  var base = _grpModalActiveStage === 'ALL' ? _grpModalAllClients
    : _grpModalAllClients.filter(function(cl){ return (cl.processStage||'Unknown') === _grpModalActiveStage; });
  var filtered = q ? base.filter(function(cl){ return (cl.name||'').toLowerCase().includes(q) || (cl.cm||'').toLowerCase().includes(q); }) : base;
  var header = document.getElementById('grp-modal-header');
  var color = header ? header.style.background.match(/#[0-9a-f]{6}/i)?.[0] || '#6366f1' : '#6366f1';
  _renderGrpModalBody(filtered, color);
}

function _renderGrpModalBody(clients, color) {
  var body = document.getElementById('grp-modal-body');
  var countEl = document.getElementById('grp-modal-count');
  if (countEl) countEl.textContent = clients.length + ' clients shown';
  if (!clients.length) {
    body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--mu);font-size:13px">No clients found.</div>';
    return;
  }
  // Group by CM
  var byCM = {};
  clients.forEach(function(cl){ var cm=cl.cm||'Unassigned'; if(!byCM[cm]) byCM[cm]=[]; byCM[cm].push(cl); });
  var sorted = Object.entries(byCM).sort(function(a,b){return b[1].length-a[1].length;});

  body.innerHTML = sorted.map(function(entry){
    var cm = entry[0], cls = entry[1];
    return '<div style="margin-bottom:14px">'
      + '<div style="font-size:10px;font-weight:700;letter-spacing:1px;color:'+color+';font-family:DM Mono,monospace;padding:4px 8px;background:'+color+'12;border-radius:6px;margin-bottom:6px">'
        + cm.toUpperCase() + ' · ' + cls.length + ' clients'
      + '</div>'
      + cls.map(function(cl){
          var hub = cl.hubspot && cl.hubspot!=='—' ? '<a href="'+cl.hubspot+'" target="_blank" style="color:'+color+';font-size:10px;text-decoration:none;font-weight:700;flex-shrink:0">↗</a>' : '';
          return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;border:1px solid var(--b);margin-bottom:4px;background:var(--s2)">'
            + '<div style="flex:1;min-width:0">'
              + '<div style="font-size:13px;font-weight:700;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(cl.name||'—')+'</div>'
              + '<div style="display:flex;gap:6px;margin-top:2px;flex-wrap:wrap">'
                + (cl.processStage&&cl.processStage!=='—'?'<span style="font-size:10px;color:var(--mu);background:var(--b);padding:1px 6px;border-radius:4px">'+cl.processStage+'</span>':'')
                + (cl.appStatus&&cl.appStatus!=='—'?'<span style="font-size:10px;color:'+color+';background:'+color+'12;padding:1px 6px;border-radius:4px">'+cl.appStatus+'</span>':'')
              + '</div>'
            + '</div>'
            + (cl.lastContacted&&cl.lastContacted!=='—'?'<span style="font-size:10px;color:var(--mu);font-family:DM Mono,monospace;white-space:nowrap;flex-shrink:0">'+cl.lastContacted+'</span>':'')
            + hub
          + '</div>';
        }).join('')
    + '</div>';
  }).join('');
}

function closeGrpModal() {
  document.getElementById('grp-modal').style.display         = 'none';
  document.getElementById('grp-modal-overlay').style.display = 'none';
}

// ── Shared: build compact click-cards for group rows ─────────────────────────
function buildGroupCards(groups, idPrefix) {
  return '<div style="display:flex;flex-direction:column;gap:8px">'
    + groups.map(function(grp) {
        var stageCount = {};
        grp.clients.forEach(function(cl){ var s=cl.processStage||'Unknown'; stageCount[s]=(stageCount[s]||0)+1; });
        var stagesN = Object.keys(stageCount).length;
        var escapedLabel = grp.label.replace(/'/g,"\\'");
        var escapedIcon  = grp.icon.replace(/'/g,"\\'");
        var escapedColor = grp.color;

        return '<div onclick="openGrpModal(\''+escapedLabel+'\',\''+escapedColor+'\',\''+escapedIcon+'\',_grpData[\''+idPrefix+'-'+escapedLabel+'\']||[])" '
          + 'style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;'
          + 'background:'+grp.color+'0d;border:1.5px solid '+grp.color+'30;'
          + 'cursor:pointer;transition:all .18s" '
          + 'onmouseenter="this.style.background=\''+grp.color+'1a\';this.style.borderColor=\''+grp.color+'66\';this.style.transform=\'translateX(3px)\'" '
          + 'onmouseleave="this.style.background=\''+grp.color+'0d\';this.style.borderColor=\''+grp.color+'30\';this.style.transform=\'\'">'

          // Icon circle
          + '<div style="width:38px;height:38px;border-radius:50%;background:'+grp.color+'22;border:2px solid '+grp.color+'44;'
            + 'display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">'+grp.icon+'</div>'

          // Label + stage count
          + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:14px;font-weight:800;color:'+grp.color+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+grp.label+'</div>'
            + '<div style="font-size:10px;color:var(--mu);font-family:DM Mono,monospace;margin-top:1px">'
              + stagesN + ' stage' + (stagesN!==1?'s':'') + ' · <span style="color:'+grp.color+'66">click to view clients</span>'
            + '</div>'
          + '</div>'

          // Count badge
          + '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'
            + '<span style="background:'+grp.color+'20;color:'+grp.color+';border:1.5px solid '+grp.color+'50;'
              + 'padding:5px 14px;border-radius:20px;font-size:14px;font-weight:900;font-family:DM Mono,monospace">'+grp.clients.length+'</span>'
            + '<span style="font-size:16px;color:'+grp.color+'80">›</span>'
          + '</div>'

        + '</div>';
      }).join('')
    + '</div>';
}

// Global store for group data (keyed by prefix-label)
var _grpData = {};

// ── Render Active / Risk / Closed ─────────────────────────────────────────────
function perfRenderStatusGroups(cmList) {
  var body   = document.getElementById('perf-sg-body');
  var badges = document.getElementById('perf-sg-badges');
  if (!body) return;

  var allClients = [];
  cmList.forEach(function(c){ (c.allClients||[]).forEach(function(cl){ allClients.push(cl); }); });

  var activeClients = [], riskClients = [], closedClients = [];
  allClients.forEach(function(cl){
    var g = getStatusGroup(cl);
    if (g==='risk') riskClients.push(cl);
    else if (g==='closed') closedClients.push(cl);
    else activeClients.push(cl);
  });

  _grpData['sg-Active']  = activeClients;
  _grpData['sg-Risk']    = riskClients;
  _grpData['sg-Closed']  = closedClients;

  if (badges) badges.innerHTML =
    (activeClients.length?'<span style="background:#dcfce7;color:#059669;border:1px solid #a7f3d0;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">🟢 '+activeClients.length+'</span>':'')
   +(riskClients.length?'<span style="background:#fef3c7;color:#d97706;border:1px solid #fde68a;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">🟡 '+riskClients.length+'</span>':'')
   +(closedClients.length?'<span style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">🔴 '+closedClients.length+'</span>':'');

  var groups = [
    { label:'Active',  icon:'🟢', color:'#059669', clients:activeClients },
    { label:'Risk',    icon:'🟡', color:'#d97706', clients:riskClients   },
    { label:'Closed',  icon:'🔴', color:'#dc2626', clients:closedClients },
  ].filter(function(g){ return g.clients.length > 0; });

  body.innerHTML = buildGroupCards(groups, 'sg');
}

// ── Render Process Stage Groups ───────────────────────────────────────────────
function perfRenderProcessGroups(cmList) {
  var body   = document.getElementById('perf-pg-body');
  var badges = document.getElementById('perf-pg-badges');
  if (!body) return;

  var allClients = [];
  cmList.forEach(function(c){ (c.allClients||[]).forEach(function(cl){ allClients.push(cl); }); });

  var buckets = {
    'Pre-Process':    { icon:'📋', color:'#06b6d4', clients:[] },
    'Active Process': { icon:'⚙️',  color:'#6366f1', clients:[] },
    'High Intent':    { icon:'🎯', color:'#a855f7', clients:[] },
    'Closed':         { icon:'✅', color:'#059669', clients:[] },
    'Drop':           { icon:'❌', color:'#ef4444', clients:[] },
    'Internal':       { icon:'🔧', color:'#64748b', clients:[] },
  };

  allClients.forEach(function(cl){
    var g = getProcessGroup(cl.processStage||'');
    if (buckets[g]) buckets[g].clients.push(cl);
    else buckets['Active Process'].clients.push(cl);
  });

  Object.entries(buckets).forEach(function(e){ _grpData['pg-'+e[0]] = e[1].clients; });

  if (badges) badges.innerHTML = Object.entries(buckets)
    .filter(function(e){ return e[1].clients.length>0; })
    .map(function(e){
      return '<span style="background:'+e[1].color+'18;color:'+e[1].color+';border:1px solid '+e[1].color+'40;'
        + 'padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">'+e[0]+': '+e[1].clients.length+'</span>';
    }).join('');

  var groups = Object.entries(buckets)
    .filter(function(e){ return e[1].clients.length>0; })
    .map(function(e){ return { label:e[0], icon:e[1].icon, color:e[1].color, clients:e[1].clients }; });

  body.innerHTML = buildGroupCards(groups, 'pg');
}

// ── Untouched bucket system — dynamic months ──────────────────────────────
var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Gradients for each CM slot (cycles)
var UB_CM_GRADIENTS = [
  'linear-gradient(90deg,#6366f1,#8b5cf6)',
  'linear-gradient(90deg,#ec4899,#f43f5e)',
  'linear-gradient(90deg,#f97316,#fb923c)',
  'linear-gradient(90deg,#eab308,#facc15)',
  'linear-gradient(90deg,#10b981,#34d399)',
  'linear-gradient(90deg,#06b6d4,#22d3ee)',
  'linear-gradient(90deg,#3b82f6,#60a5fa)',
  'linear-gradient(90deg,#a855f7,#c084fc)',
  'linear-gradient(90deg,#ef4444,#f87171)',
  'linear-gradient(90deg,#84cc16,#a3e635)',
  'linear-gradient(90deg,#14b8a6,#2dd4bf)',
  'linear-gradient(90deg,#f59e0b,#fbbf24)'
];
var UB_CM_COLORS = ['#818cf8','#f472b6','#fb923c','#facc15','#34d399','#22d3ee','#60a5fa','#c084fc','#f87171','#a3e635','#2dd4bf','#fbbf24'];

function buildDynamicUntouchedBuckets() {
  var buckets = {};
  var start   = new Date(2025, 0, 1);
  var now     = new Date();
  var end     = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  var d       = new Date(start);
  while (d < end) {
    var key = d.getFullYear() + '-' + String(d.getMonth()).padStart(2,'0');
    buckets[key] = {
      cutoff: new Date(d),
      label:  'Before ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear(),
      short:  MONTH_NAMES[d.getMonth()].slice(0,3) + ' ' + d.getFullYear()
    };
    d.setMonth(d.getMonth() + 1);
  }
  return buckets;
}

var UNTOUCHED_BUCKETS = buildDynamicUntouchedBuckets();
var _currentUBucket   = null;

function buildUntouchedBuckets() {
  UNTOUCHED_BUCKETS = buildDynamicUntouchedBuckets();
  var sel = document.getElementById('ub-dropdown');
  if (sel) {
    sel.innerHTML = Object.keys(UNTOUCHED_BUCKETS).map(function(key){
      return '<option value="'+key+'">'+UNTOUCHED_BUCKETS[key].label+'</option>';
    }).join('');
    // Default to most recent
    var keys = Object.keys(UNTOUCHED_BUCKETS);
    if (keys.length) {
      sel.value = keys[keys.length - 1];
      selectUntouchedBucket(keys[keys.length - 1]);
    }
  }
}

function openUntouchedBucketModal() { perfScrollTo('perf-untouched-section'); }

function selectUntouchedBucket(key) {
  _currentUBucket = key;
  var bucket = UNTOUCHED_BUCKETS[key];
  if (!bucket) return;

  // Sync dropdown
  var sel = document.getElementById('ub-dropdown');
  if (sel && sel.value !== key) sel.value = key;

  // Update label
  var labelWrap = document.getElementById('perf-ub-label');
  var labelText = document.getElementById('perf-ub-label-text');
  if (labelWrap) labelWrap.style.display = 'block';
  if (labelText) labelText.textContent = bucket.label;

  var bucketCMs = computeUntouchedForBucket(bucket.cutoff);
  var total = bucketCMs.reduce(function(s,c){ return s + c.untouched.length; }, 0);

  // Update badges
  var badge    = document.getElementById('perf-untouched-badge');
  var kpi      = document.getElementById('perf-untouched');
  var pill     = document.getElementById('ub-total-pill');
  var pillColor = total > 0 ? '#dc2626' : '#059669';
  var pillBg    = total > 0 ? '#fef2f2' : '#f0fdf4';
  var pillBdr   = total > 0 ? '#fca5a5' : '#86efac';
  if (badge) { badge.textContent = total + ' cases'; badge.style.color = pillColor; }
  if (kpi)   { kpi.textContent = total; }
  if (pill)  {
    pill.style.display = 'block';
    pill.textContent = total + ' cases';
    pill.style.color = pillColor;
    pill.style.background = pillBg;
    pill.style.borderColor = pillBdr;
  }

  _renderUntouchedGrid(bucketCMs, bucket.label);

  // ── Sync the Active vs Untouched donut to the selected period ──
  var bucketUntouched = bucketCMs.reduce(function(s,c){ return s + c.untouched.length; }, 0);
  var donutTotal  = window._perfTotalCases  || 0;
  var donutActive = window._perfTotalActive || 0;
  perfRenderActiveDonut(donutActive, bucketUntouched, donutTotal, bucket.label);
}

function computeUntouchedForBucket(cutoff) {
  var rows = window._perfRows || [];

  // ── Keywords checked across appStatus, dealStage, and processStage ──
  var excludeKws = [
    'paused/on-hold','on-hold','bad debt','non-payment',
    'withdrawn','rejected','completely closed','refund',
    'non-responsive','unresponsive','no response',
    'cancelled','cancel','closed','dead','lost',
    'approved','visa granted','visa stamping'
  ];

  var map = {};

  rows.forEach(function(r){
    var cm = (r.cm || r.caseManager || 'Unassigned').trim();
    if (!map[cm]) map[cm] = { name: cm, untouched: [] };

    var appStatus    = (r.appStatus    || r.status       || '').toLowerCase();
    var dealStage    = (r.dealStage    || ''                  ).toLowerCase();
    var processStage = (r.processStage || r.stage        || '').toLowerCase();
    var clientStatus = (r.clientStatus || r.isActiveStatus|| '').toString().toLowerCase().trim();

    // Exclude if clientStatus is not "active" (catches Inactive, On-Hold, etc.)
    if (clientStatus && clientStatus !== 'active') return;

    // Exclude if any keyword found in appStatus, dealStage, or processStage
    var combinedText = appStatus + ' ' + dealStage + ' ' + processStage;
    var isExcluded = excludeKws.some(function(k){ return combinedText.indexOf(k) !== -1; });

    var isWelcome  = processStage.indexOf('welcome call') !== -1;
    if (isExcluded || isWelcome) return;

    // Prefer lastActivityDate (column L from updated GAS), fall back to lastContacted (col D)
    var dateStr = r.lastActivityDate || r.lastContacted || r.date || '';
    var displayDate = r.lastActivityDateDisplay || r.lastContacted || dateStr || '';
    var dateObj = null;

    if (dateStr && dateStr !== '—') {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) {
        // Handle MM/DD/YYYY HH:MM format
        var parts = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
        if (parts) {
          d = new Date(parseInt(parts[3]), parseInt(parts[1])-1, parseInt(parts[2]),
                       parts[4]?parseInt(parts[4]):0, parts[5]?parseInt(parts[5]):0);
        }
      }
      if (!isNaN(d.getTime())) dateObj = d;
    }

    // Skip cases with no date at all
    if (!dateObj) return;

    if (dateObj < cutoff) {
      map[cm].untouched.push({
        name:        r.name || r.clientName || '—',
        stage:       r.processStage || r.stage || '—',
        appStatus:   r.appStatus || '—',
        date:        displayDate || dateStr || '—',
        dateObj:     dateObj,
        hubspot:     r.hubspot || ''
      });
    }
  });

  return Object.values(map)
    .filter(function(c){ return c.untouched.length > 0; })
    .sort(function(a,b){ return b.untouched.length - a.untouched.length; });
}

// ── Dark grid render — 3 rows × 4 columns matching the reference design ───────
function _renderUntouchedGrid(bucketCMs, label) {
  var barsEl = document.getElementById('perf-untouched-bars');
  if (!barsEl) return;

  if (bucketCMs.length === 0) {
    barsEl.innerHTML = '<div style="text-align:center;color:#10b981;font-weight:800;padding:40px;font-size:14px;letter-spacing:.5px">✅ No untouched cases for this period!</div>';
    _renderUntouchedClients([], '');
    return;
  }

  var maxU  = Math.max.apply(null, bucketCMs.map(function(c){ return c.untouched.length; })) || 1;
  var total = bucketCMs.reduce(function(s,c){ return s + c.untouched.length; }, 0);

  // ── Header ──
  var html = '<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;'
    + 'color:var(--mu);font-family:DM Mono,monospace;margin-bottom:14px;display:flex;align-items:center;gap:10px">'
    + '<span>'+label+'</span>'
    + '<span style="background:rgba(239,68,68,.12);color:#ef4444;padding:2px 10px;border-radius:10px;font-size:10px;font-weight:800">'+total+' TOTAL UNTOUCHED</span>'
    + '</div>';

  // ── Dark container ──
  html += '<div style="background:#111827;border-radius:16px;padding:20px;display:grid;'
    + 'grid-template-columns:repeat(4,1fr);gap:14px">';

  // Fill to 12 slots (3 rows × 4 cols)
  var allSlots = bucketCMs.slice();
  // Sort by count desc already done; pad to 12 with empties for grid alignment but only show real CMs

  bucketCMs.forEach(function(c, i) {
    var grad    = UB_CM_GRADIENTS[i % UB_CM_GRADIENTS.length];
    var accent  = UB_CM_COLORS[i % UB_CM_COLORS.length];
    var barPct  = Math.round((c.untouched.length / maxU) * 100);
    var safeName = c.name.replace(/'/g, "\\'");

    html += '<div onclick="perfShowUntouchedModal(\''+safeName+'\')" style="cursor:pointer;border-radius:12px;padding:12px 14px;'
      + 'background:#1f2937;border:1px solid #374151;transition:transform .15s,box-shadow .2s;position:relative;overflow:hidden" '
      + 'onmouseenter="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 8px 24px rgba(0,0,0,.4)\';this.style.borderColor=\''+accent+'\'" '
      + 'onmouseleave="this.style.transform=\'\';this.style.boxShadow=\'\';this.style.borderColor=\'#374151\'">'

      // Name
      + '<div style="font-size:11px;font-weight:700;color:#e2e8f0;margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:Nunito,sans-serif">'+c.name+'</div>'

      // Bar track
      + '<div style="position:relative;height:10px;background:#374151;border-radius:6px;overflow:hidden;margin-bottom:8px">'
        + '<div class="ub-bar-fill" data-pct="'+barPct+'" style="height:100%;width:0%;background:'+grad+';border-radius:6px;transition:width 1s cubic-bezier(.4,0,.2,1)"></div>'
      + '</div>'

      // Count
      + '<div style="font-size:13px;font-weight:900;color:'+accent+';font-family:DM Mono,monospace;letter-spacing:-.3px">'+c.untouched.length+' cases</div>'

    + '</div>';
  });

  html += '</div>';
  barsEl.innerHTML = html;

  // Animate bars
  setTimeout(function(){
    barsEl.querySelectorAll('.ub-bar-fill').forEach(function(el){
      el.style.width = el.getAttribute('data-pct') + '%';
    });
  }, 80);

  _renderUntouchedClients(bucketCMs, '');
}

// Legacy wrapper kept for compatibility
function _renderUntouchedBars(bucketCMs, color, label) {
  _renderUntouchedGrid(bucketCMs, label);
}

function _renderUntouchedClients(bucketCMs, color) {
  var clientsEl = document.getElementById('perf-untouched-clients');
  var labelEl   = document.getElementById('perf-ub-clients-label');
  if (labelEl) labelEl.style.display = 'none'; // hidden — grid already shows CMs
  if (!clientsEl) return;
  clientsEl.innerHTML = ''; // client detail shown via modal only
}

// ── perfRenderUntouched: called after data load — builds dynamic buckets
function perfRenderUntouched(cmList) { buildUntouchedBuckets(); }

// ── Untouched Modal — shows ALL clients for chosen CM in current bucket ──
var _untouchedModalList = [];    // full list for current CM
var _untouchedModalStage = 'all'; // active filter

function perfShowUntouchedModal(cmName) {
  var bucketKey = _currentUBucket || Object.keys(UNTOUCHED_BUCKETS).slice(-1)[0];
  var bucket    = UNTOUCHED_BUCKETS[bucketKey] || {};
  var bucketCMs = computeUntouchedForBucket(bucket.cutoff || new Date());
  var cmData    = bucketCMs.find(function(c){ return c.name === cmName; });
  _untouchedModalList  = cmData ? cmData.untouched : [];
  _untouchedModalStage = 'all';

  document.getElementById('perf-modal-title').textContent = cmName + ' — Untouched Cases';
  document.getElementById('perf-modal-sub').textContent   = _untouchedModalList.length + ' clients · ' + (bucket.label || '');

  _renderUntouchedModalBody();
  document.getElementById('perf-modal').style.display = 'flex';
  document.getElementById('perf-modal-overlay').style.display = 'block';
}

function _untouchedStageColor(s) {
  var sl = (s||'').toLowerCase();
  if (sl.indexOf('paused') !== -1 || sl.indexOf('on-hold') !== -1) return {bg:'#fffbeb',border:'#fde68a',text:'#d97706',dot:'#f59e0b'};
  if (sl.indexOf('non-payment') !== -1 || sl.indexOf('bad debt') !== -1) return {bg:'#fef2f2',border:'#fca5a5',text:'#dc2626',dot:'#ef4444'};
  if (sl.indexOf('withdrawn') !== -1 || sl.indexOf('rejected') !== -1 || sl.indexOf('closed') !== -1) return {bg:'#f1f5f9',border:'#e2e8f0',text:'#475569',dot:'#94a3b8'};
  if (sl.indexOf('active') !== -1) return {bg:'#f0fdf4',border:'#86efac',text:'#15803d',dot:'#10b981'};
  if (sl.indexOf('ielts') !== -1 || sl.indexOf('tef') !== -1) return {bg:'#ecfeff',border:'#a5f3fc',text:'#0e7490',dot:'#06b6d4'};
  if (sl.indexOf('petition') !== -1) return {bg:'#faf5ff',border:'#d8b4fe',text:'#7c3aed',dot:'#a855f7'};
  if (sl.indexOf('eca') !== -1) return {bg:'#fff7ed',border:'#fed7aa',text:'#c2410c',dot:'#f97316'};
  if (sl.indexOf('express') !== -1 || sl.indexOf('pnp') !== -1) return {bg:'#eff6ff',border:'#bfdbfe',text:'#1d4ed8',dot:'#3b82f6'};
  return {bg:'var(--s2)',border:'var(--b)',text:'var(--mu)',dot:'#94a3b8'};
}

var _untouchedDropOpen = false;

function _renderUntouchedModalBody() {
  var accentColor = '#ef4444';
  var allList = _untouchedModalList;
  var body    = document.getElementById('perf-modal-body');

  if (!allList.length) {
    body.innerHTML = '<div style="text-align:center;color:#10b981;padding:30px;font-weight:700">✅ No untouched cases</div>';
    return;
  }

  // ── Build stage counts ──
  var stageCounts = {};
  allList.forEach(function(cl){
    var s = (cl.appStatus && cl.appStatus !== '—') ? cl.appStatus : (cl.stage && cl.stage !== '—' ? cl.stage : 'No Status');
    stageCounts[s] = (stageCounts[s] || 0) + 1;
  });
  var stageEntries = Object.entries(stageCounts).sort(function(a,b){ return b[1]-a[1]; });

  // ── Active label for trigger button ──
  var activeName = _untouchedModalStage === 'all'
    ? 'All Stages (' + allList.length + ' clients)'
    : _untouchedModalStage + ' (' + (stageCounts[_untouchedModalStage]||0) + ' clients)';

  // ── Dropdown trigger button ──
  var filterHtml = ''
    + '<div style="position:relative;margin-bottom:12px" id="unt-drop-wrap">'

    // Trigger
    + '<button onclick="_toggleUntouchedDrop()" id="unt-drop-btn" style="'
      + 'width:100%;display:flex;align-items:center;justify-content:space-between;'
      + 'padding:9px 14px;border-radius:10px;border:1.5px solid #ef4444;'
      + 'background:#fef2f2;color:#dc2626;font-size:12px;font-weight:700;'
      + 'cursor:pointer;font-family:Nunito,sans-serif;gap:10px">'
      + '<span style="display:flex;align-items:center;gap:8px">'
        + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/></svg>'
        + '<span id="unt-drop-label">'+activeName+'</span>'
      + '</span>'
      + '<svg id="unt-drop-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;transition:transform .2s"><polyline points="6,9 12,15 18,9"/></svg>'
    + '</button>'

    // Dropdown panel — full width, 3-col grid
    + '<div id="unt-drop-panel" style="'
      + 'display:none;position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:50;'
      + 'background:var(--w);border:1.5px solid var(--b);border-radius:12px;'
      + 'box-shadow:0 8px 32px rgba(0,0,0,.18);padding:10px;'
      + 'max-height:280px;overflow-y:auto">'

      // "All" option
      + '<div onclick="_untouchedFilterBy(\'all\')" style="'
        + 'grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;'
        + 'padding:8px 12px;border-radius:8px;cursor:pointer;margin-bottom:8px;'
        + 'background:'+(_untouchedModalStage==='all'?'#fef2f2':'var(--s2)')+';'
        + 'border:1.5px solid '+(_untouchedModalStage==='all'?'#ef4444':'var(--b)')+';'
        + 'color:'+(_untouchedModalStage==='all'?'#dc2626':'var(--tx)')+'">'
        + '<span style="font-weight:800;font-size:12px;font-family:Nunito,sans-serif">🗂 All Stages</span>'
        + '<span style="font-size:11px;font-weight:700;font-family:DM Mono,monospace;'
          + 'background:'+(_untouchedModalStage==='all'?'#fca5a5':'var(--b)')+';'
          + 'padding:2px 8px;border-radius:10px">'+allList.length+'</span>'
      + '</div>'

      // 3-col grid of stage options
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">';

  stageEntries.forEach(function(entry){
    var s = entry[0], cnt = entry[1];
    var pc = _untouchedStageColor(s);
    var isActive = _untouchedModalStage === s;
    var safeSt   = s.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    filterHtml += '<div onclick="_untouchedFilterBy(\''+safeSt+'\')" style="'
      + 'display:flex;align-items:center;justify-content:space-between;gap:6px;'
      + 'padding:7px 10px;border-radius:8px;cursor:pointer;'
      + 'background:'+(isActive?pc.bg:'var(--s2)')+';'
      + 'border:1.5px solid '+(isActive?pc.border:'var(--b)')+';'
      + 'transition:background .12s,border .12s">'
      + '<span style="display:flex;align-items:center;gap:5px;min-width:0">'
        + '<span style="width:7px;height:7px;border-radius:50%;background:'+pc.dot+';flex-shrink:0"></span>'
        + '<span style="font-size:11px;font-weight:700;color:'+(isActive?pc.text:'var(--tx)')+';font-family:Nunito,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+s+'</span>'
      + '</span>'
      + '<span style="font-size:10px;font-weight:800;font-family:DM Mono,monospace;flex-shrink:0;'
        + 'background:'+(isActive?pc.border:'var(--b)')+';color:'+(isActive?pc.text:'var(--mu)')+';'
        + 'padding:1px 7px;border-radius:8px">'+cnt+'</span>'
    + '</div>';
  });

  filterHtml += '</div></div></div>'; // close grid, panel, wrap

  // ── Filtered client list ──
  var filtered = _untouchedModalStage === 'all' ? allList : allList.filter(function(cl){
    var s = (cl.appStatus && cl.appStatus !== '—') ? cl.appStatus : (cl.stage && cl.stage !== '—' ? cl.stage : 'No Status');
    return s === _untouchedModalStage;
  });

  var listHtml = filtered.length ? filtered.map(function(cl,i){
    var hub = cl.hubspot ? '<a href="'+cl.hubspot+'" target="_blank" style="color:'+accentColor+';font-size:11px;text-decoration:none;font-family:DM Mono,monospace;font-weight:700">HubSpot ↗</a>' : '';
    var pc  = _untouchedStageColor((cl.appStatus && cl.appStatus !== '—') ? cl.appStatus : 'No Status');
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--b)">'
      +'<span style="font-family:DM Mono,monospace;font-size:10px;color:var(--mu);width:22px;text-align:right">'+(i+1)+'.</span>'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:13px;font-weight:700;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(cl.name||'—')+'</div>'
        +'<div style="font-size:11px;margin-top:3px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
          +(cl.appStatus&&cl.appStatus!=='—'?'<span style="background:'+pc.bg+';border:1px solid '+pc.border+';color:'+pc.text+';padding:1px 7px;border-radius:4px;font-weight:700;font-size:10px">'+cl.appStatus+'</span>':'')
          +(cl.stage&&cl.stage!=='—'&&cl.stage!==cl.appStatus?'<span style="background:var(--s2);padding:1px 7px;border-radius:4px;font-weight:600;font-size:10px;color:var(--mu)">'+cl.stage+'</span>':'')
          +(cl.date&&cl.date!=='—'?'<span style="font-family:DM Mono,monospace;font-size:10px;color:var(--mu)">Last activity: '+cl.date+'</span>':'<span style="color:#ef4444;font-size:10px">No activity date</span>')
        +'</div>'
      +'</div>'
      +hub
      +'<span style="color:'+accentColor+';font-size:16px" title="Untouched">⚠</span>'
    +'</div>';
  }).join('')
  : '<div style="text-align:center;color:var(--mu);padding:24px;font-family:DM Mono,monospace;font-size:12px">No clients in this category.</div>';

  body.innerHTML = filterHtml + listHtml;

  // Close dropdown when clicking outside
  setTimeout(function(){
    document.addEventListener('click', _untouchedDropOutside);
  }, 0);
}

function _toggleUntouchedDrop() {
  var panel   = document.getElementById('unt-drop-panel');
  var chevron = document.getElementById('unt-drop-chevron');
  if (!panel) return;
  var open = panel.style.display !== 'none';
  panel.style.display   = open ? 'none' : 'block';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
}

function _untouchedDropOutside(e) {
  var wrap = document.getElementById('unt-drop-wrap');
  if (wrap && !wrap.contains(e.target)) {
    var panel   = document.getElementById('unt-drop-panel');
    var chevron = document.getElementById('unt-drop-chevron');
    if (panel)   panel.style.display = 'none';
    if (chevron) chevron.style.transform = '';
    document.removeEventListener('click', _untouchedDropOutside);
  }
}

function _untouchedFilterBy(stage) {
  // Close the dropdown
  var panel   = document.getElementById('unt-drop-panel');
  var chevron = document.getElementById('unt-drop-chevron');
  if (panel)   panel.style.display = 'none';
  if (chevron) chevron.style.transform = '';
  document.removeEventListener('click', _untouchedDropOutside);

  _untouchedModalStage = stage;
  _renderUntouchedModalBody();
}

function closePerfModal() {
  document.getElementById('perf-modal').style.display = 'none';
  document.getElementById('perf-modal-overlay').style.display = 'none';
}

// ── Toggle Paused/Non-Payment collapsible section ───────────────────────────
function togglePausedSection() {
  var body    = document.getElementById('perf-paused-body');
  var chevron = document.getElementById('perf-paused-chevron');
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display    = open ? 'none' : 'block';
  chevron.style.transform = open ? '' : 'rotate(180deg)';
}

// ── Render Paused/Non-Payment section ───────────────────────────────────────
function perfRenderPaused(cmList) {
  var barsEl    = document.getElementById('perf-paused-bars');
  var clientsEl = document.getElementById('perf-paused-clients');
  var badge     = document.getElementById('perf-paused-badge');
  if (!barsEl || !clientsEl) return;

  // Use pausedNonPayment array on each CM (populated by the updated script)
  var filtered = cmList.filter(function(c) { return (c.pausedNonPayment||[]).length > 0; })
    .sort(function(a,b){ return (b.pausedNonPayment||[]).length - (a.pausedNonPayment||[]).length; });

  var total = filtered.reduce(function(s,c){ return s + (c.pausedNonPayment||[]).length; }, 0);
  if (badge) badge.textContent = total + ' cases';

  var maxU = Math.max.apply(null, filtered.map(function(c){ return (c.pausedNonPayment||[]).length; })) || 1;

  barsEl.innerHTML = '<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--mu);font-family:DM Mono,monospace;margin-bottom:12px">PAUSED / NON-PAYMENT CASES PER CASE MANAGER (click to view clients)</div>'
    + (filtered.length ? filtered.map(function(c){
        var cnt = (c.pausedNonPayment||[]).length;
        var pct = Math.round((cnt/maxU)*100);
        return '<div style="margin-bottom:10px;cursor:pointer" onclick="perfShowPausedModal(\''+c.name+'\')" title="Click to see client names">'
          +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
            +'<span style="font-size:12px;font-weight:700;color:var(--tx)">'+c.name+'</span>'
            +'<span style="font-size:12px;font-weight:800;color:#d97706;font-family:DM Mono,monospace">'+cnt+' cases 👆 click</span>'
          +'</div>'
          +'<div style="height:10px;background:var(--b);border-radius:5px;overflow:hidden">'
            +'<div style="width:'+pct+'%;height:100%;background:linear-gradient(90deg,#d97706,#fbbf24);border-radius:5px;transition:width .8s ease"></div>'
          +'</div>'
        +'</div>';
      }).join('') : '<div style="text-align:center;color:#10b981;font-weight:700;padding:20px">✅ No paused/non-payment cases found.</div>');

  clientsEl.innerHTML = filtered.map(function(c){
    var cnt = (c.pausedNonPayment||[]).length;
    return '<div style="background:var(--s2);border:1px solid #fde68a;border-radius:12px;padding:14px;border-top:3px solid #d97706">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'
        +'<span style="font-size:13px;font-weight:700;color:var(--tx)">'+c.name+'</span>'
        +'<span style="background:#fffbeb;border:1px solid #fde68a;color:#d97706;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700">'+cnt+' cases</span>'
      +'</div>'
      +'<div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto">'
        + (c.pausedNonPayment||[]).slice(0,10).map(function(cl){
          var statusLabel = (cl.appStatus && cl.appStatus !== '—') ? cl.appStatus : '';
          return '<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:4px 6px;background:var(--w);border-radius:6px;border:1px solid var(--b)">'
            +'<span style="color:#d97706;flex-shrink:0">⏸</span>'
            +'<span style="color:var(--tx);font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(cl.name||'—')+'</span>'
            +(statusLabel?'<span style="color:var(--mu);font-size:9px;background:var(--s2);padding:1px 5px;border-radius:4px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis">'+statusLabel.split(';')[0].trim()+'</span>':'')
          +'</div>';
        }).join('')
        +(cnt>10?'<div style="text-align:center;font-size:11px;color:var(--mu);padding:4px;cursor:pointer" onclick="perfShowPausedModal(\''+c.name+'\')">+' +(cnt-10)+' more — click to view all</div>':'')
      +'</div>'
    +'</div>';
  }).join('') || '<div style="text-align:center;color:#10b981;font-weight:700;padding:30px;grid-column:1/-1">✅ No paused cases found!</div>';
}

// ── Paused Modal ─────────────────────────────────────────────────────────────
function perfShowPausedModal(cmName) {
  var cm = perfCMMap[cmName];
  if(!cm) return;
  var list = cm.pausedNonPayment || [];
  document.getElementById('perf-modal-title').textContent = cmName + ' — Paused / Non-Payment Cases';
  document.getElementById('perf-modal-sub').textContent   = list.length + ' cases excluded from untouched count';
  var body = document.getElementById('perf-modal-body');
  body.innerHTML = list.length ? list.map(function(cl, i){
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--b)">'
      +'<span style="font-family:DM Mono,monospace;font-size:10px;color:var(--mu);width:22px;text-align:right">'+(i+1)+'.</span>'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:13px;font-weight:700;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(cl.name||'—')+'</div>'
        +'<div style="font-size:11px;color:var(--mu);margin-top:1px;display:flex;gap:8px;flex-wrap:wrap">'
          +(cl.appStatus&&cl.appStatus!=='—'?'<span style="background:#fffbeb;border:1px solid #fde68a;color:#d97706;padding:1px 6px;border-radius:4px;font-size:10px">'+cl.appStatus+'</span>':'')
          +(cl.lastContacted?'<span>Last: '+cl.lastContacted+'</span>':'')
        +'</div>'
      +'</div>'
      +'<span style="color:#d97706;font-size:18px" title="Paused/Non-Payment">⏸</span>'
    +'</div>';
  }).join('') : '<div style="text-align:center;color:#10b981;padding:30px;font-weight:700">✅ No paused cases for '+cmName+'</div>';
  var modal = document.getElementById('perf-modal');
  modal.style.display = 'flex';
  document.getElementById('perf-modal-overlay').style.display = 'block';
}

// ── Full breakdown table ────────────────────────────────────────────────
function perfRenderTable(cmList, total) {
  var wrap = document.getElementById('perf-cm-table-wrap');
  if(!wrap || !cmList.length) return;
  var allStages = perfAllStages.slice(0,6);
  wrap.innerHTML = '<table class="cmp-table"><thead><tr>'
    +'<th style="text-align:left">Case Manager</th>'
    +'<th style="text-align:center">Total</th>'
    +'<th style="text-align:center;color:#10b981">Active</th>'
    +'<th style="text-align:center;color:#ef4444">Untouched</th>'
    + allStages.map(function(s){
        var ll=s.toLowerCase();
        var col=ll.includes('ielt')?'#06b6d4':ll.includes('petition')?'#a855f7':ll.includes('active')?'#10b981':ll.includes('inactive')?'#ef4444':'#6366f1';
        return '<th style="text-align:center;color:'+col+'">'+s+'</th>';
      }).join('')
    +'</tr></thead><tbody>'
    + cmList.map(function(c){
        var pct = total>0 ? Math.round((c.total/total)*100) : 0;
        return '<tr><td style="font-weight:700;cursor:pointer" onclick="perfOnCMFilterChange(\''+c.name+'\')">'+c.name+'</td>'
          +'<td class="mono" style="text-align:center"><span style="color:#6366f1;font-weight:700">'+c.total+'</span> <span style="color:var(--mu);font-size:10px">('+pct+'%)</span></td>'
          +'<td class="mono" style="text-align:center;color:#10b981;font-weight:700">'+c.active.length+'</td>'
          +'<td class="mono" style="text-align:center;cursor:pointer;color:#ef4444;font-weight:700;text-decoration:underline" onclick="perfShowUntouchedModal(\''+c.name+'\')">'+c.untouched.length+'</td>'
          + allStages.map(function(s){return '<td class="mono" style="text-align:center">'+(c.stages[s]||'—')+'</td>';}).join('')
        +'</tr>';
      }).join('')
    +'</tbody></table>';
}

// ── Consultant dropdown handler (syncs both dropdowns) ─────────────────
// ── Custom CM dropdown (dark background hover) ──────────────────────────
function buildCMDropdown(cmList) {
  var sel  = document.getElementById('perf-consultant-sel');
  var opts = document.getElementById('perf-cm-dropdown-options');
  if(!opts) return;

  // Rebuild hidden native select for backward compat
  if(sel){
    sel.innerHTML = '<option value="all">👥 All Case Managers</option>'
      + cmList.map(function(c){ return '<option value="'+c.name+'">'+c.name+'</option>'; }).join('');
  }

  // Build custom list
  var items = [{val:'all', label:'👥 All Case Managers'}]
    .concat(cmList.map(function(c){ return {val:c.name, label:'👤 '+c.name}; }));

  opts.innerHTML = items.map(function(it){
    return '<div class="cm-drop-opt'+(it.val==='all'?' active':'')+'" data-val="'+it.val+'" onclick="selectCMDropdownItem(\''+it.val.replace(/'/g,"\\'")+'\')">'+it.label+'</div>';
  }).join('');
}

function toggleCMDropdown() {
  var list = document.getElementById('perf-cm-dropdown-list');
  if(!list) return;
  list.style.display = list.style.display==='none'?'block':'none';
}

function selectCMDropdownItem(val) {
  // Update button label
  var label = document.getElementById('perf-cm-dropdown-label');
  var opts  = document.querySelectorAll('#perf-cm-dropdown-options .cm-drop-opt');
  opts.forEach(function(el){
    el.classList.toggle('active', el.getAttribute('data-val')===val);
    if(el.getAttribute('data-val')===val && label) label.textContent = el.textContent;
  });
  // Close list
  var list = document.getElementById('perf-cm-dropdown-list');
  if(list) list.style.display='none';
  // Sync hidden select & apply filter
  var sel = document.getElementById('perf-consultant-sel');
  if(sel){ sel.value=val; }
  document.getElementById('perf-cm-filter') && (document.getElementById('perf-cm-filter').value=val);
  perfApplyConsultantFilter(val);
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e){
  var dd = document.getElementById('perf-cm-dropdown');
  if(dd && !dd.contains(e.target)){
    var list = document.getElementById('perf-cm-dropdown-list');
    if(list) list.style.display='none';
  }
});

function perfOnConsultantChange() {
  var val = document.getElementById('perf-consultant-sel').value;
  document.getElementById('perf-cm-filter').value = val;
  perfApplyConsultantFilter(val);
}

function perfOnCMFilterChange(val) {
  document.getElementById('perf-cm-filter').value = val;
  document.getElementById('perf-consultant-sel').value = val;
  perfApplyConsultantFilter(val);
}

function perfApplyConsultantFilter(cmName) {
  var label = document.getElementById('perf-filter-label');
  if(label) label.textContent = cmName==='all' ? 'Showing: All Data' : 'Showing: ' + cmName;

  // Re-render stage chart
  perfRenderCMStageChart(cmName);

  // Re-render stage bar chart
  if(cmName==='all'){
    var allStageMap={};
    perfRawRows.forEach(function(r){
      var s=perfSheetData.stageCol>=0?(r[perfSheetData.stageCol]||'').trim():'';
      if(s) allStageMap[s]=(allStageMap[s]||0)+1;
    });
    perfRenderStageBarChart(allStageMap, null);
  } else {
    var cm = perfCMMap[cmName];
    if(cm) perfRenderStageBarChart(cm.stages, cmName);
  }

  // Update KPIs for selected CM
  if(cmName!=='all'){
    var cm = perfCMMap[cmName];
    if(cm){
      document.getElementById('perf-total-cases').textContent = cm.total;
      // Count active by clientStatus = "Active" within this CM's clients
      var _cmActive = (cm.allClients||[]).filter(function(c){ return (c.clientStatus||c.isActiveStatus||'').toString().toLowerCase().trim() === 'active'; }).length || cm.active.length;
      document.getElementById('perf-active').textContent      = _cmActive;
      document.getElementById('perf-untouched').textContent   = cm.untouched.length;
      document.getElementById('perf-untouched-badge').textContent = cm.untouched.length + ' cases';
      var ielts=0,petitionPrep=0,petitionFiled=0,eca=0,submitted=0;
      Object.entries(cm.stages).forEach(function(e){
        if(e[0].toLowerCase().includes('ielt'))      ielts+=e[1];
        if(e[0].toLowerCase().includes('eca'))       eca+=e[1];
        if(e[0].toLowerCase().includes('submitted')) submitted+=e[1];
      });
      // ── PETITION FIX: check BOTH processStage (cm.stages col E) AND dealStage (allClients[].dealStage col G) ──
      // Using allClients so each client is counted once regardless of which column holds the petition stage
      (cm.allClients||[]).forEach(function(client){
        var ps = (client.processStage||'').toLowerCase();
        var ds = (client.dealStage||'').toLowerCase();
        var hasPet = ps.indexOf('petition') !== -1 || ds.indexOf('petition') !== -1;
        if (!hasPet) return;
        var isFiled = ps.indexOf('petition fil') !== -1 || ds.indexOf('petition fil') !== -1;
        if (isFiled) petitionFiled++;
        else petitionPrep++;
      });
      var petition = petitionPrep + petitionFiled;
      document.getElementById('perf-ielts').textContent    = ielts    ||'—';
      document.getElementById('perf-petition').textContent  = petition ||'—';
      if(document.getElementById('perf-petition-prep'))  document.getElementById('perf-petition-prep').textContent  = petitionPrep  || '—';
      if(document.getElementById('perf-petition-filed')) document.getElementById('perf-petition-filed').textContent = petitionFiled || '—';
      if(document.getElementById('perf-eca'))       document.getElementById('perf-eca').textContent       = eca      ||'—';
      if(document.getElementById('perf-submitted')) document.getElementById('perf-submitted').textContent  = submitted||'—';
    }
  } else {
    perfBuildAll(); // full reset
    return;
  }
}

function perfScrollTo(id) {
  var el = document.getElementById(id);
  if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
}

// ── Stage card modal ──────────────────────────────────────────────────────────
function showStageModal(keyword, title, color) {
  var stageMap = window._perfStageMap || {};

  if (keyword === 'petition') {
    // ── PETITION: use petitionClients[] from GAS (checks col E+G via hasPetition) ──
    var petRows = (window._perfPetitionClients || []).slice();

    // Fallback: filter from _perfRows if petitionClients[] not populated
    if (!petRows.length && (window._perfRows||[]).length) {
      petRows = (window._perfRows).filter(function(r){
        var ps = (r.processStage||'').toLowerCase();
        var ds = (r.dealStage||'').toLowerCase();
        return ps.indexOf('petition') !== -1 || ds.indexOf('petition') !== -1;
      });
    }

    // Split into two groups: Filed vs Preparation
    var filedRows = petRows.filter(function(r){
      var ps = (r.processStage||'').toLowerCase();
      var ds = (r.dealStage||'').toLowerCase();
      return ps.indexOf('petition fil') !== -1 || ds.indexOf('petition fil') !== -1;
    });
    var prepRows = petRows.filter(function(r){
      var ps = (r.processStage||'').toLowerCase();
      var ds = (r.dealStage||'').toLowerCase();
      return ps.indexOf('petition fil') === -1 && ds.indexOf('petition fil') === -1;
    });

    var body = '';
    if (!petRows.length) {
      body = '<div style="text-align:center;padding:32px;color:var(--mu);font-family:\'DM Mono\',monospace;font-size:12px">No clients found in this stage.</div>';
    } else {
      function buildPetitionGroup(groupRows, groupLabel, groupColor) {
        if (!groupRows.length) return '';
        var byCM = {};
        groupRows.forEach(function(r){ var cm=r.cm||'Unassigned'; if(!byCM[cm])byCM[cm]=[]; byCM[cm].push(r); });
        var inner = Object.entries(byCM).map(function(entry){
          var cm=entry[0], clients=entry[1];
          var rowsHtml = clients.map(function(r){
            var hub = r.hubspot&&r.hubspot!=='—'?'<a href="'+r.hubspot+'" target="_blank" style="color:'+groupColor+';font-size:10px;text-decoration:none;font-family:\'DM Mono\',monospace">HubSpot ↗</a>':'';
            var stageLabel = (r.processStage&&r.processStage!=='—') ? r.processStage : (r.dealStage||'—');
            return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--b)">'
              +'<div><div style="font-weight:700;font-size:13px;color:var(--tx)">'+(r.name||'—')+'</div>'
              +'<div style="font-size:10px;color:var(--mu);font-family:\'DM Mono\',monospace;margin-top:2px">'+stageLabel+'</div></div>'
              +'<div style="display:flex;align-items:center;gap:10px">'
              +'<div style="font-size:10px;color:var(--mu);font-family:\'DM Mono\',monospace">Last: '+(r.lastContacted||r.lastActivityDateDisplay||'—')+'</div>'
              +hub+'</div></div>';
          }).join('');
          return '<div style="margin-bottom:14px">'
            +'<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:'+groupColor+';font-family:\'DM Mono\',monospace;margin-bottom:6px;padding:4px 8px;background:rgba(0,0,0,.04);border-radius:6px">'+cm.toUpperCase()+' · '+clients.length+' clients</div>'
            +rowsHtml+'</div>';
        }).join('');
        return '<div style="margin-bottom:20px">'
          +'<div style="font-size:11px;font-weight:800;letter-spacing:1px;color:'+groupColor+';font-family:\'DM Mono\',monospace;padding:6px 10px;background:'+groupColor+'18;border-radius:8px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">'
          +'<span>'+groupLabel+'</span><span style="background:'+groupColor+'30;padding:2px 8px;border-radius:10px">'+groupRows.length+' clients</span></div>'
          +inner+'</div>';
      }
      body = buildPetitionGroup(prepRows,'📋 PETITION PREPARATION','#a855f7')
           + buildPetitionGroup(filedRows,'✅ PETITION FILED','#7c3aed');
    }
    renderStageModal(title, color, petRows.length, body);
    return;
  }

  // ── OTHER STAGES ──────────────────────────────────────────────────────────
  var rows = window._perfRows || [];
  if (!rows.length) {
    var fallbackCount = Object.entries(stageMap).filter(function(e){return e[0].toLowerCase().includes(keyword);}).reduce(function(s,e){return s+e[1];},0);
    var fallbackBody = '<div style="text-align:center;padding:32px;color:var(--mu);font-family:\'DM Mono\',monospace;font-size:12px">'+fallbackCount+' clients found in this stage.<br>Full client list requires data to be loaded via the performance tab.</div>';
    renderStageModal(title, color, fallbackCount, fallbackBody);
    return;
  }
  var matching = rows.filter(function(r){ return (r.processStage||'').toLowerCase().includes(keyword); });
  matching.sort(function(a,b){ return (a.cm||'').localeCompare(b.cm||''); });
  var body2 = '';
  if (!matching.length) {
    body2 = '<div style="text-align:center;padding:32px;color:var(--mu);font-family:\'DM Mono\',monospace;font-size:12px">No clients found in this stage.</div>';
  } else {
    var byCM2 = {};
    matching.forEach(function(r){ var cm=r.cm||'Unassigned'; if(!byCM2[cm])byCM2[cm]=[]; byCM2[cm].push(r); });
    body2 = Object.entries(byCM2).map(function(entry){
      var cm=entry[0], clients=entry[1];
      var rowsH = clients.map(function(r){
        var hub = r.hubspot&&r.hubspot!=='—'?'<a href="'+r.hubspot+'" target="_blank" style="color:'+color+';font-size:10px;text-decoration:none;font-family:\'DM Mono\',monospace">HubSpot ↗</a>':'';
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--b)">'
          +'<div><div style="font-weight:700;font-size:13px;color:var(--tx)">'+(r.name||'—')+'</div>'
          +'<div style="font-size:10px;color:var(--mu);font-family:\'DM Mono\',monospace;margin-top:2px">'+(r.processStage||'—')+'</div></div>'
          +'<div style="display:flex;align-items:center;gap:10px">'
          +'<div style="font-size:10px;color:var(--mu);font-family:\'DM Mono\',monospace">Last: '+(r.lastContacted||'—')+'</div>'
          +hub+'</div></div>';
      }).join('');
      return '<div style="margin-bottom:18px">'
        +'<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:'+color+';font-family:\'DM Mono\',monospace;margin-bottom:6px;padding:4px 8px;background:rgba(0,0,0,.04);border-radius:6px">'+cm.toUpperCase()+' · '+clients.length+' clients</div>'
        +rowsH+'</div>';
    }).join('');
  }
  renderStageModal(title, color, matching.length, body2);
}

function renderStageModal(title, color, count, bodyHtml) {
  var header = document.getElementById('stage-modal-header');
  if(header) header.style.background = 'linear-gradient(135deg,'+color+','+color+'cc)';
  document.getElementById('stage-modal-title').textContent = title;
  document.getElementById('stage-modal-sub').textContent = count + ' clients in this stage';
  document.getElementById('stage-modal-body').innerHTML = bodyHtml;
  var overlay = document.getElementById('stage-modal-overlay');
  var modal   = document.getElementById('stage-modal');
  overlay.style.display = 'block';
  modal.style.display   = 'flex';
}

function closeStageModal() {
  document.getElementById('stage-modal-overlay').style.display = 'none';
  document.getElementById('stage-modal').style.display         = 'none';
}

// ── Legacy stubs (kept for backward compat) ────────────────────────────
function perfConnectSheet() { perfLoadData(); }
function perfFilterByCM(name) { perfOnCMFilterChange(name); }
function perfBuildCMMap(rows) { return perfCMMap; }
function perfRenderCMTable(cmArr, stageMap, total) { perfRenderTable(Object.values(perfCMMap), perfRawRows.length); }
var perfStages = ['IELTS','Petition Writing','Active','Inactive','Initial Contact','Assessment','Submission','Approved','Rejected'];

// ── Auto-refresh every 5 minutes ─────────────────────────────────────────────
var AUTO_REFRESH_MS = 30 * 1000; // 30 seconds — silent
var autoRefreshTimer = null;
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(function() {
    // Silent background refresh — no loader, no skeleton, no toast
    loadedTabs.hof = false;
    hofFetch(true);
  }, AUTO_REFRESH_MS);
}
startAutoRefresh();
(function(){
  var yest = new Date(); yest.setDate(yest.getDate()-1);
  var btn = document.getElementById('cmYesterdayBtn');
  if (btn) btn.textContent = yest.toLocaleDateString('en-GB',{month:'short',day:'numeric'});
})();
