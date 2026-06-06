// ══════════════════════════════════════════════════════════════
//  CM DASHBOARD — unified (replaces old daily/weekly/monthly)
// ══════════════════════════════════════════════════════════════
function cmText(id, val) { var el=document.getElementById(id); if(el) el.textContent=String(val); }
function cmHTML(id, html) { var el=document.getElementById(id); if(el) el.innerHTML=html; }

// State for the new CM dashboard
var cmDashPreset  = 'yesterday';
var cmDashCharts  = {};         // chart instances
var cmDashAllRows = [];         // all CM rows across all periods (flat)
var cmDashNames   = [];         // unique CM names found in data

// ── Load CM data (daily API only — single unified source) ──
function loadCM(tab) {
  // Only load daily — we merge everything into one dashboard
  if (tab !== 'daily') { return; }
  showLdr('Loading CM compliance data…');
  document.getElementById('daily-eb').classList.remove('on');

  fetch(APIS.daily, {redirect:'follow'})
    .then(function(res) { if (!res.ok) throw new Error('HTTP '+res.status); return res.text(); })
    .then(function(raw) {
      if (!raw||raw.trim()==='') throw new Error('Empty response from Apps Script');
      if (raw.trim().charAt(0)==='<') throw new Error('Got HTML not JSON — redeploy: Execute as Me, Anyone can access');
      return JSON.parse(raw);
    })
    .then(function(json) {
      if (!json.ok) throw new Error(json.error||'Apps Script error');
      if (!json.timeSeries||!json.timeSeries.length) throw new Error('No data found. Check Apps Script deployment.');
      cmStore.daily = json;
      loadedTabs.daily = true;

      // Build flat row list: each row = one CM for one period, with a parsed date
      cmDashAllRows = [];
      json.timeSeries.forEach(function(period) {
        // Try to parse a date from the label (e.g. "28-Mar", "28/03/2025", etc.)
        var parsedDate = cmDashParseDate(period.label, period.tab);
        (period.cms || []).forEach(function(cm) {
          cmDashAllRows.push({
            name:      cm.name,
            label:     period.label,
            tab:       period.tab,
            date:      parsedDate,
            deals:     cm.deals     || 0,
            calls:     cm.calls     || 0,
            connected: cm.connected || 0,
            emails:    cm.emails    || 0,
            tasks:     cm.tasks     || 0,
            followUp:  cm.followUp  || 0,
            nextTask:  cm.nextTask  || 0,
            stageUpd:  cm.stageUpd  || 0,
            onTime:    cm.onTime    || 0,
            blank:     cm.blank     || 0,
            pct:       cm.pct       || 0
          });
        });
      });

      // Collect unique CM names in alphabetical order
      var nameSet = {};
      cmDashAllRows.forEach(function(r){ nameSet[r.name]=1; });
      cmDashNames = Object.keys(nameSet).sort();

      // Populate name filter dropdown
      var sel = document.getElementById('cmDashNameFilter');
      if (sel) {
        sel.innerHTML = '<option value="all">All Case Managers</option>' +
          cmDashNames.map(function(n){ return '<option value="'+n+'">'+n+'</option>'; }).join('');
      }

      // Update nav badge count
      cmText('nc-daily', json.timeSeries.length);

      // Set today's date as default in date pickers
      var today = new Date().toISOString().slice(0,10);
      var startEl = document.getElementById('cmDashStart');
      var endEl   = document.getElementById('cmDashEnd');
      if (startEl) startEl.value = today;
      if (endEl)   endEl.value   = today;

      cmDashRender();
      setUpd();
    })
    .catch(function(err) {
      cmText('daily-em', err.message);
      document.getElementById('daily-eb').classList.add('on');
    })
    .finally(function() { hideLdr(); });
}

// ── Parse a date out of a period label/tab ──
// Handles: "28-Mar", "28-Mar-2025", "28 Mar 2025", "28/03/2025", "2025-03-28",
//          "Stats 28-Mar", "Stats28Mar", numeric tab names, etc.
function cmDashParseDate(label, tab) {
  var MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  var currentYear = new Date().getFullYear();

  function tryParse(s) {
    if (!s) return null;
    s = String(s).trim();

    // ISO or slash format: 2025-03-28 or 28/03/2025 or 03/28/2025
    var isoM = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoM) return new Date(parseInt(isoM[1]), parseInt(isoM[2])-1, parseInt(isoM[3]));

    var slashM = s.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{2,4})$/);
    if (slashM) {
      var yr = parseInt(slashM[3]); if (yr < 100) yr += 2000;
      return new Date(yr, parseInt(slashM[2])-1, parseInt(slashM[1]));
    }

    // DD-Mon-YYYY or DD-Mon or DD Mon YYYY or DD Mon
    var dmyM = s.match(/(\d{1,2})[\-\s\/]([A-Za-z]{3,9})[\-\s\/]?(\d{2,4})?/);
    if (dmyM) {
      var mo = MONTHS[dmyM[2].toLowerCase().slice(0,3)];
      if (mo !== undefined) {
        var yr = dmyM[3] ? parseInt(dmyM[3]) : currentYear;
        if (yr < 100) yr += 2000;
        return new Date(yr, mo, parseInt(dmyM[1]));
      }
    }

    // Mon DD or Mon-DD
    var mdM = s.match(/([A-Za-z]{3,9})[\-\s](\d{1,2})/);
    if (mdM) {
      var mo = MONTHS[mdM[1].toLowerCase().slice(0,3)];
      if (mo !== undefined) return new Date(currentYear, mo, parseInt(mdM[2]));
    }

    return null;
  }

  // Try label first, then tab name (strip common prefixes like "Stats")
  var d = tryParse(label);
  if (d && !isNaN(d)) return d;

  if (tab) {
    var cleanTab = String(tab).replace(/^Stats\s*/i, '').replace(/^Daily\s*/i, '').trim();
    d = tryParse(cleanTab);
    if (d && !isNaN(d)) return d;
  }

  return null;
}

// ── Normalize a date to midnight for reliable comparison ──
function cmDashMidnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// ── Compute date bounds for a preset ──
// Returns { start: Date (midnight), end: Date (end of day) } or null for "no filter"
function cmDashGetDateBounds(customStart, customEnd) {
  var now   = new Date();
  var today = cmDashMidnight(now);
  var todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  if (cmDashPreset === 'today') {
    return { start: today, end: todayEnd };
  }
  if (cmDashPreset === '3days') {
    var s = new Date(today); s.setDate(s.getDate() - 2); // today + 2 days back = 3 days
    return { start: s, end: todayEnd };
  }
  if (cmDashPreset === '7days') {
    var s = new Date(today); s.setDate(s.getDate() - 6); // today + 6 days back = 7 days
    return { start: s, end: todayEnd };
  }
  if (cmDashPreset === 'all') {
    return null; // no date filter — show everything
  }
  // 'custom' or any other — use the date picker values
  if (customStart && customEnd) {
    // Parse date inputs as LOCAL dates (avoid UTC timezone shift)
    var sp = customStart.split('-');
    var ep = customEnd.split('-');
    var s = new Date(parseInt(sp[0]), parseInt(sp[1])-1, parseInt(sp[2]));
    var e = new Date(parseInt(ep[0]), parseInt(ep[1])-1, parseInt(ep[2]), 23, 59, 59, 999);
    return { start: s, end: e };
  }
  return null;
}

// ── Get filtered rows based on current preset/dates/CM name ──
function cmDashGetFiltered() {
  var nameFilter = (document.getElementById('cmDashNameFilter')||{}).value || 'all';
  var searchText = ((document.getElementById('cmDashSearch')||{}).value || '').toLowerCase();
  var startVal   = (document.getElementById('cmDashStart')||{}).value;
  var endVal     = (document.getElementById('cmDashEnd')||{}).value;

  var rows = cmDashAllRows;
  var bounds = cmDashGetDateBounds(startVal, endVal);

  if (bounds) {
    rows = rows.filter(function(r) {
      if (!r.date) return false; // exclude rows with no parseable date when filtering
      var rd = cmDashMidnight(r.date);
      return rd >= bounds.start && rd <= bounds.end;
    });
  }

  // Fallback: if no rows matched (date parse failed or no data for range),
  // show most recent period with a notice
  if (rows.length === 0 && cmDashAllRows.length > 0) {
    var ts = cmStore.daily ? cmStore.daily.timeSeries : [];
    var lastLabel = ts.length ? ts[ts.length-1].label : '';
    rows = cmDashAllRows.filter(function(r){ return r.label === lastLabel; });
    var rangeDesc = cmDashPreset === 'today' ? 'today'
      : cmDashPreset === '3days' ? 'last 3 days'
      : cmDashPreset === '7days' ? 'last 7 days'
      : (startVal && endVal) ? startVal + ' → ' + endVal : 'selected range';
    cmText('cm-dash-sub', 'No data for ' + rangeDesc + ' — showing latest: ' + lastLabel);
    return rows.filter(function(r){
      if (nameFilter !== 'all' && r.name !== nameFilter) return false;
      if (searchText && !r.name.toLowerCase().includes(searchText)) return false;
      return true;
    });
  }

  // Apply CM name filter
  if (nameFilter !== 'all') {
    rows = rows.filter(function(r){ return r.name === nameFilter; });
  }

  // Apply search text
  if (searchText) {
    rows = rows.filter(function(r){ return r.name.toLowerCase().includes(searchText); });
  }

  return rows;
}

// ── Preset button handler ──
function cmDashSetPreset(preset, el) {
  document.querySelectorAll('#cmDashPresets .chip').forEach(function(b){ b.classList.remove('active'); });
  if (el) el.classList.add('active');
  cmDashPreset = preset;
  var now   = new Date();
  var today = now.toISOString().slice(0,10);
  var yest  = new Date(now); yest.setDate(yest.getDate()-1);
  var yestStr = yest.toISOString().slice(0,10);
  var startEl = document.getElementById('cmDashStart');
  var endEl   = document.getElementById('cmDashEnd');
  if (preset === 'yesterday') {
    if (startEl) startEl.value = yestStr;
    if (endEl)   endEl.value   = yestStr;
  } else if (preset === 'today') {
    if (startEl) startEl.value = today;
    if (endEl)   endEl.value   = today;
  } else if (preset === '3days') {
    var s = new Date(now); s.setDate(s.getDate()-2);
    if (startEl) startEl.value = s.toISOString().slice(0,10);
    if (endEl)   endEl.value   = today;
  } else if (preset === '7days') {
    var s = new Date(now); s.setDate(s.getDate()-6);
    if (startEl) startEl.value = s.toISOString().slice(0,10);
    if (endEl)   endEl.value   = today;
  } else if (preset === 'all') {
    if (startEl) startEl.value = '';
    if (endEl)   endEl.value   = '';
  }
  cmDashRender();
}

// ── Custom date input handler ──
function cmDashOnCustomDate() {
  document.querySelectorAll('#cmDashPresets .chip').forEach(function(b){ b.classList.remove('active'); });
  cmDashPreset = 'custom';
  cmDashRender();
}

// ── Refresh button ──
function cmDashRefresh() {
  cmStore.daily = null;
  loadedTabs.daily = false;
  loadCM('daily');
}

// ── Export CSV ──
function cmDashExportCSV() {
  var rows = cmDashGetFiltered();
  if (!rows.length) { showToast('No data to export'); return; }
  var headers = ['Name','Period','Deals','Calls','Connected','Emails','Tasks','Follow Up','Next Task','Stage Upd','On Time','Blank','Compliance %'];
  var csv = [headers].concat(rows.map(function(r){
    return [r.name, r.label, r.deals, r.calls, r.connected, r.emails, r.tasks, r.followUp, r.nextTask, r.stageUpd, r.onTime, r.blank, r.pct.toFixed(1)+'%'];
  })).map(function(row){ return row.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  var blob = new Blob([csv], {type:'text/csv'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'HOF_CM_Compliance_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ CSV downloaded!');
}

// ── Main render function ──
function cmDashRender() {
  var rows = cmDashGetFiltered();
  var nameFilter = (document.getElementById('cmDashNameFilter')||{}).value || 'all';

  // Aggregate KPIs across all filtered rows (grouped by CM, latest period per CM)
  var cmMap = {};
  rows.forEach(function(r) {
    if (!cmMap[r.name]) {
      cmMap[r.name] = { name:r.name, deals:0, calls:0, connected:0, emails:0, tasks:0, followUp:0, nextTask:0, stageUpd:0, onTime:0, blank:0, pctSum:0, count:0 };
    }
    var c = cmMap[r.name];
    c.deals     += r.deals;
    c.calls     += r.calls;
    c.connected += r.connected;
    c.emails    += r.emails;
    c.tasks     += r.tasks;
    c.followUp  += r.followUp;
    c.nextTask  += r.nextTask;
    c.stageUpd  += r.stageUpd;
    c.onTime    += r.onTime;
    c.blank     += r.blank;
    // Off days ("DAY OFF" rows = 0% compliance) must NOT count toward the
    // compliance average — neither per-CM nor team-wide. Only working days do.
    if (r.pct > 0) {
      c.pctSum  += r.pct;
      c.count   += 1;
    }
  });
  var cmList = Object.values(cmMap);

  // KPI totals
  var totalDeals   = cmList.reduce(function(s,c){ return s+c.deals; }, 0);
  var totalCalls   = cmList.reduce(function(s,c){ return s+c.calls; }, 0);
  var totalEmails  = cmList.reduce(function(s,c){ return s+c.emails; }, 0);
  var totalTasks   = cmList.reduce(function(s,c){ return s+c.tasks; }, 0);
  var totalBlank   = cmList.reduce(function(s,c){ return s+c.blank; }, 0);
  var activeCMsForAvg = cmList.filter(function(c){ return c.count > 0 && (c.pctSum/c.count) > 0; });
  var avgPct = activeCMsForAvg.length ? activeCMsForAvg.reduce(function(s,c){ return s+c.pctSum/c.count; }, 0)/activeCMsForAvg.length : 0;

  var pc = cmPctClr(avgPct);
  document.getElementById('cmd-deals').textContent  = cmNumFmt(totalDeals);
  document.getElementById('cmd-calls').textContent  = cmNumFmt(totalCalls);
  document.getElementById('cmd-emails').textContent = cmNumFmt(totalEmails);
  document.getElementById('cmd-tasks').textContent  = cmNumFmt(totalTasks);
  document.getElementById('cmd-blank').textContent  = cmNumFmt(totalBlank);
  document.getElementById('cmd-pct').textContent    = avgPct.toFixed(1)+'%';
  document.getElementById('cmd-pct').style.color    = pc;
  document.getElementById('cmd-pca').style.background = pc;
  document.getElementById('cmd-deals-d').textContent  = cmList.length+' CM'+(cmList.length!==1?'s':'');
  document.getElementById('cmd-calls-d').textContent  = rows.length+' period'+(rows.length!==1?'s':'');
  document.getElementById('cmd-emails-d').textContent = 'Total emails';
  document.getElementById('cmd-tasks-d').textContent  = 'Total tasks';
  document.getElementById('cmd-blank-d').textContent  = 'Blank calls';

  // Update subtitle
  var subLabel = nameFilter!=='all' ? nameFilter : (cmList.length+' case managers');
  var periodCount = [...new Set(rows.map(function(r){ return r.label; }))].length;
  document.getElementById('cm-dash-sub').textContent = subLabel+' · '+periodCount+' period'+(periodCount!==1?'s':'')+' · '+rows.length+' records';
  document.getElementById('cmd-table-title').textContent = 'Case Manager Compliance';
  document.getElementById('cmd-table-sub').textContent   = rows.length+' record'+(rows.length!==1?'s':'')+' · sorted by compliance';
  setGBadge(avgPct);

  // Build period-aggregated trend for charts
  var periodMap = {};
  rows.forEach(function(r) {
    if (!periodMap[r.label]) periodMap[r.label] = { label:r.label, date:r.date, pctSum:0, count:0, deals:0, emails:0, tasks:0 };
    var p = periodMap[r.label];
    if (r.pct > 0) { p.pctSum += r.pct; p.count += 1; }  // off days excluded from trend avg
    p.deals  += r.deals;
    p.emails += r.emails;
    p.tasks  += r.tasks;
  });
  var periods = Object.values(periodMap).sort(function(a,b){
    if (a.date && b.date) return a.date - b.date;
    return String(a.label).localeCompare(String(b.label));
  });

  var trendLabels = periods.map(function(p){ return p.label; });
  var pctVals     = periods.map(function(p){ return p.count>0 ? p.pctSum/p.count : 0; });

  // ── Neon-styled chart helpers ──
  var isDark = document.body.classList.contains('dark')||document.body.classList.contains('midnight')||document.body.classList.contains('aurora')||document.body.classList.contains('neon')||document.body.classList.contains('evening');
  var gridClr = isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)';
  var tickClr  = isDark ? '#6b7280' : '#94a3b8';
  var ttBase   = {backgroundColor:'rgba(15,23,42,.95)',borderColor:'rgba(99,102,241,.4)',borderWidth:1,titleColor:'#e2e8f0',bodyColor:'#94a3b8',padding:10,cornerRadius:8};

  // Trend chart — glowing area line
  if (cmDashCharts.trend) cmDashCharts.trend.destroy();
  cmDashCharts.trend = new Chart(document.getElementById('cmd-trend'), {
    type:'line',
    data:{labels:trendLabels, datasets:[{
      label:'Compliance %', data:pctVals,
      borderColor:'#6366f1',
      backgroundColor:function(ctx){
        var ch=ctx.chart; var area=ch.chartArea;
        if(!area) return 'rgba(99,102,241,.1)';
        var g=ch.ctx.createLinearGradient(0,area.top,0,area.bottom);
        g.addColorStop(0,'rgba(99,102,241,.4)');
        g.addColorStop(0.5,'rgba(99,102,241,.12)');
        g.addColorStop(1,'rgba(99,102,241,.01)');
        return g;
      },
      borderWidth:2.5, fill:true, tension:.45, pointRadius:5,
      pointBackgroundColor:pctVals.map(function(v){return v>=90?'#10b981':v>=80?'#f59e0b':'#f43f5e';}),
      pointBorderColor:'rgba(15,23,42,.8)', pointBorderWidth:2, pointHoverRadius:7
    }]},
    options:{responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{...ttBase,callbacks:{label:function(ctx){return ' '+ctx.parsed.y.toFixed(1)+'%';}}}},
      scales:{
        x:{ticks:{color:tickClr,font:{family:'DM Mono',size:9},maxRotation:45},grid:{color:gridClr},border:{display:false}},
        y:{min:0,max:100,ticks:{color:tickClr,font:{family:'DM Mono',size:9},callback:function(v){return v+'%';}},grid:{color:gridClr},border:{display:false}}
      }
    }
  });

  // Activity volumes — glowing grouped bars
  if (cmDashCharts.vol) cmDashCharts.vol.destroy();
  cmDashCharts.vol = new Chart(document.getElementById('cmd-vol'), {
    type:'bar',
    data:{labels:trendLabels, datasets:[
      {label:'Deals',  data:periods.map(function(p){return p.deals;}),  backgroundColor:'rgba(99,102,241,.8)', borderRadius:4,borderSkipped:false,hoverBackgroundColor:'#6366f1'},
      {label:'Emails', data:periods.map(function(p){return p.emails;}), backgroundColor:'rgba(192,38,211,.7)', borderRadius:4,borderSkipped:false,hoverBackgroundColor:'#c026d3'},
      {label:'Tasks',  data:periods.map(function(p){return p.tasks;}),  backgroundColor:'rgba(16,185,129,.7)', borderRadius:4,borderSkipped:false,hoverBackgroundColor:'#10b981'}
    ]},
    options:{responsive:true, maintainAspectRatio:false,
      plugins:{legend:{labels:{color:tickClr,font:{family:'DM Mono',size:10},boxWidth:10,padding:10}},tooltip:{...ttBase}},
      scales:{
        x:{ticks:{color:tickClr,font:{family:'DM Mono',size:9},maxRotation:45},grid:{color:gridClr},border:{display:false}},
        y:{ticks:{color:tickClr,font:{family:'DM Mono',size:9}},grid:{color:gridClr},border:{display:false}}
      }
    }
  });

  // ── CM Compliance horizontal bar chart (neon/cyber style) ──
  if (cmDashCharts.cmBar) cmDashCharts.cmBar.destroy();
  var cmBarCanvas = document.getElementById('cmd-cm-bar');
  if (cmBarCanvas && cmList.length) {
    var cmBarLabels = cmList.map(function(c){return c.name.split(' ')[0];});
    var cmBarData   = cmList.map(function(c){return c.count ? +(c.pctSum/c.count).toFixed(1) : 0;});
    var cmBarColors = cmBarData.map(function(v){return v>=90?'rgba(16,185,129,.85)':v>=80?'rgba(99,102,241,.85)':v>=70?'rgba(245,158,11,.85)':'rgba(244,63,94,.85)';});
    cmDashCharts.cmBar = new Chart(cmBarCanvas, {
      type:'bar',
      data:{labels:cmBarLabels,datasets:[{label:'Compliance %',data:cmBarData,backgroundColor:cmBarColors,
        hoverBackgroundColor:cmBarData.map(function(v){return v>=90?'#10b981':v>=80?'#6366f1':v>=70?'#f59e0b':'#f43f5e';}),
        borderRadius:6,borderSkipped:false,borderWidth:0}]},
      options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',
        plugins:{legend:{display:false},tooltip:{...ttBase,callbacks:{label:function(ctx){return ' '+ctx.parsed.x.toFixed(1)+'%';}}}},
        scales:{
          x:{min:0,max:100,ticks:{color:tickClr,font:{family:'DM Mono',size:9},callback:function(v){return v+'%';}},grid:{color:gridClr},border:{display:false}},
          y:{ticks:{color:tickClr,font:{family:'Nunito',size:11,weight:'600'}},grid:{display:false},border:{display:false}}
        }
      }
    });
  }

  // ── Radar chart — activity profile ──
  if (cmDashCharts.radar) cmDashCharts.radar.destroy();
  var radarCanvas = document.getElementById('cmd-radar');
  if (radarCanvas && cmList.length) {
    var n = cmList.length||1;
    var rAvg = function(f){return cmList.reduce(function(s,c){return s+(c.count?c[f]/c.count:0);},0)/n;};
    var radarMax = Math.max(rAvg('calls'),rAvg('emails'),rAvg('tasks'),rAvg('deals'),rAvg('connected'),1);
    var rNorm = function(v){return Math.round((v/radarMax)*100);};
    cmDashCharts.radar = new Chart(radarCanvas, {
      type:'radar',
      data:{labels:['Calls','Emails','Tasks','Deals','Connected'],
        datasets:[{label:'Team Avg',data:[rNorm(rAvg('calls')),rNorm(rAvg('emails')),rNorm(rAvg('tasks')),rNorm(rAvg('deals')),rNorm(rAvg('connected'))],
          backgroundColor:'rgba(99,102,241,.12)',borderColor:'#6366f1',borderWidth:2.5,
          pointBackgroundColor:'#6366f1',pointBorderColor:'rgba(15,23,42,.8)',pointRadius:5,pointHoverRadius:7}]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{...ttBase,callbacks:{label:function(ctx){return ' '+ctx.raw;}} }},
        scales:{r:{min:0,max:100,ticks:{color:tickClr,font:{size:9},backdropColor:'transparent',stepSize:25},
          grid:{color:gridClr},angleLines:{color:gridClr},
          pointLabels:{color:isDark?'#94a3b8':'#64748b',font:{size:10,family:'DM Mono'}}}}}
    });
  }

  // ── Donut — compliance bands ──
  if (cmDashCharts.polar) cmDashCharts.polar.destroy();
  var polarCanvas = document.getElementById('cmd-polar');
  if (polarCanvas) {
    var bands={ex:0,good:0,watch:0,crit:0};
    cmList.forEach(function(c){var p=c.count>0?c.pctSum/c.count:0;if(p===0)return;if(p>=90)bands.ex++;else if(p>=80)bands.good++;else if(p>=70)bands.watch++;else bands.crit++;});
    var bColors=['#10b981','#6366f1','#f59e0b','#f43f5e'];
    var bLabels=['Excellent 90+','Good 80–89','Watch 70–79','Critical <70'];
    var bData=[bands.ex,bands.good,bands.watch,bands.crit];
    cmDashCharts.polar = new Chart(polarCanvas, {
      type:'doughnut',
      data:{labels:bLabels,datasets:[{data:bData,
        backgroundColor:bColors.map(function(c){return c+'bb';}),hoverBackgroundColor:bColors,
        borderColor:isDark?'#0f172a':'#fff',borderWidth:3,hoverOffset:8}]},
      options:{responsive:true,maintainAspectRatio:true,cutout:'62%',
        plugins:{legend:{display:false},tooltip:{...ttBase,callbacks:{label:function(ctx){return ' '+ctx.label+': '+ctx.raw;}} }}}
    });
    var leg=document.getElementById('cmd-polar-legend');
    if(leg) leg.innerHTML=bLabels.map(function(l,i){return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><div style="width:9px;height:9px;border-radius:50%;background:'+bColors[i]+';flex-shrink:0"></div><span style="font-family:DM Mono,monospace;font-size:10px;color:var(--t2)">'+l+'</span><span style="font-weight:800;margin-left:auto;color:'+bColors[i]+';font-size:12px">'+bData[i]+'</span></div>';}).join('');
  }

  // ── Stacked bar — activity mix per CM ──
  if (cmDashCharts.stack) cmDashCharts.stack.destroy();
  var stackCanvas = document.getElementById('cmd-stack');
  if (stackCanvas && cmList.length) {
    cmDashCharts.stack = new Chart(stackCanvas, {
      type:'bar',
      data:{labels:cmList.map(function(c){return c.name.split(' ')[0];}),datasets:[
        {label:'Deals', data:cmList.map(function(c){return Math.round(c.deals/c.count);}),backgroundColor:'rgba(99,102,241,.85)',borderSkipped:false,borderRadius:{topLeft:4,topRight:4,bottomLeft:0,bottomRight:0}},
        {label:'Calls', data:cmList.map(function(c){return Math.round(c.calls/c.count);}), backgroundColor:'rgba(192,38,211,.75)',borderSkipped:false},
        {label:'Emails',data:cmList.map(function(c){return Math.round(c.emails/c.count);}),backgroundColor:'rgba(245,158,11,.75)',borderSkipped:false},
        {label:'Tasks', data:cmList.map(function(c){return Math.round(c.tasks/c.count);}), backgroundColor:'rgba(16,185,129,.80)',borderSkipped:false}
      ]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{labels:{color:tickClr,font:{family:'DM Mono',size:10},boxWidth:10,padding:10}},tooltip:{...ttBase}},
        scales:{
          x:{stacked:true,ticks:{color:tickClr,font:{family:'Nunito',size:10,weight:'600'}},grid:{display:false},border:{display:false}},
          y:{stacked:true,ticks:{color:tickClr,font:{family:'DM Mono',size:9}},grid:{color:gridClr},border:{display:false}}
        }
      }
    });
  }

  // Table — show individual rows or aggregated per CM
  var tableRows;
  var nameFilter2 = (document.getElementById('cmDashNameFilter')||{}).value || 'all';
  if (nameFilter2 !== 'all') {
    // Show one row per period for the selected CM
    tableRows = rows.slice().sort(function(a,b){
      if (a.date && b.date) return b.date - a.date;
      return String(b.label).localeCompare(String(a.label));
    });
  } else {
    // Show one aggregated row per CM
    tableRows = cmList.slice().sort(function(a,b){ return (b.pctSum/b.count) - (a.pctSum/a.count); })
      .map(function(c) {
        return {
          name: c.name, label: periodCount+' period'+(periodCount!==1?'s':''),
          deals: c.deals, calls: c.calls, connected: c.connected,
          emails: c.emails, tasks: c.tasks, followUp: c.followUp,
          nextTask: c.nextTask, stageUpd: c.stageUpd, onTime: c.onTime,
          blank: c.blank, pct: c.count>0 ? c.pctSum/c.count : 0
        };
      });
  }

  cmHTML('cmd-tb', tableRows.map(function(d) {
    var isDayOff = d.pct === 0;
    var pc2 = isDayOff ? '#94a3b8' : cmPctClr(d.pct);
    var sc  = isDayOff ? 'off' : (d.pct>=90?'g':d.pct>=80?'a':'r');
    var sl  = isDayOff ? 'DAY OFF' : (d.pct>=90?'EXCELLENT':d.pct>=80?'GOOD':'NEEDS WORK');
    return '<tr>'+
      '<td style="font-weight:700">'+d.name+'</td>'+
      (d.label ? '<td class="mono" style="font-size:11px;color:var(--mu)">'+d.label+'</td>' : '<td></td>')+
      '<td class="mono">'+d.deals+'</td>'+
      '<td class="mono">'+d.calls+'</td>'+
      '<td class="mono">'+d.connected+'</td>'+
      '<td class="mono">'+d.emails+'</td>'+
      '<td class="mono">'+d.tasks+'</td>'+
      '<td class="mono">'+d.followUp+'</td>'+
      '<td class="mono">'+d.nextTask+'</td>'+
      '<td class="mono">'+d.stageUpd+'</td>'+
      '<td class="mono">'+d.onTime+'</td>'+
      '<td class="mono"'+(d.blank>3?' style="color:var(--red);font-weight:700"':'')+'>'+d.blank+'</td>'+
      '<td>'+(isDayOff
        ? '<span style="color:#94a3b8;font-weight:700;font-family:\'DM Mono\',monospace;font-size:13px">—</span>'
        : '<div class="pct-cell"><span style="color:'+pc2+';font-weight:700;min-width:42px">'+d.pct.toFixed(1)+'%</span>'+
          '<div class="pct-bar"><div class="pct-fill" style="width:'+Math.min(d.pct,100)+'%;background:'+pc2+'"></div></div></div>')+'</td>'+
      '<td><span class="cm-pill p-'+sc+'"'+(isDayOff?' style="background:#f1f5f9;color:#64748b;border-color:#cbd5e1"':'')+'>'+sl+'</span></td>'+
    '</tr>';
  }).join('') || cmEmpty(14));

  // ── Render Total Team Compliance Banner ──────────────────────────────────
  cmRenderTeamComplianceBanner(cmList, avgPct);

  // ── Render leaderboard cards ─────────────────────────────────────────────
  cmRenderLeaderCards(cmList);

  // ── Render heat strip ────────────────────────────────────────────────────
  cmRenderHeatStrip(cmList);

  // ── Render CM error analysis section ─────────────────────────────────────
  cmRenderErrorAnalysis(cmList);
}

// ══════════════════════════════════════════════════════════════════════════════
// CM DASHBOARD — NEW ENHANCED RENDER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

var cmExtraCharts = {};

// ── Total Team Compliance Banner ──────────────────────────────────────────────
function cmRenderTeamComplianceBanner(cmList, avgPct) {
  var total = cmList.length;
  if (!total) return;

  var activeCMs = cmList.filter(function(c){ return c.count > 0 && (c.pctSum / c.count) > 0; });
  var sumPct = activeCMs.reduce(function(s,c){ return s + (c.pctSum/c.count); }, 0);
  var teamPct = activeCMs.length ? sumPct / activeCMs.length : 0;

  var col = teamPct >= 90 ? '#10b981' : teamPct >= 80 ? '#f59e0b' : '#ef4444';
  var colGlow = teamPct >= 90 ? 'rgba(16,185,129,.4)' : teamPct >= 80 ? 'rgba(245,158,11,.4)' : 'rgba(239,68,68,.4)';
  var statusText = teamPct >= 90 ? '✅ EXCELLENT' : teamPct >= 80 ? '⚠️ NEEDS WORK' : '🔴 CRITICAL';
  var statusBg = teamPct >= 90 ? 'rgba(16,185,129,.2)' : teamPct >= 80 ? 'rgba(245,158,11,.2)' : 'rgba(239,68,68,.2)';
  var aboveTarget = activeCMs.filter(function(c){ return (c.pctSum/c.count) >= 80; }).length;

  var bigEl = document.getElementById('cmTeamCompBig');
  var stEl  = document.getElementById('cmTeamCompStatus');
  var cntEl = document.getElementById('cmTeamCount');
  var abvEl = document.getElementById('cmTeamAbove');

  if (bigEl) { bigEl.textContent = teamPct.toFixed(1)+'%'; bigEl.style.color = col; bigEl.style.textShadow = '0 0 40px '+colGlow; }
  if (stEl)  { stEl.textContent = statusText; stEl.style.background = statusBg; stEl.style.color = col; }
  if (cntEl) cntEl.textContent = activeCMs.length;
  if (abvEl) { abvEl.textContent = aboveTarget+'/'+activeCMs.length; abvEl.style.color = aboveTarget===activeCMs.length ? '#10b981' : aboveTarget >= activeCMs.length/2 ? '#f59e0b' : '#ef4444'; }

  // Mini horizontal bars per CM
  var barsEl = document.getElementById('cmTeamBars');
  if (barsEl) {
    var sorted = cmList.slice().sort(function(a,b){ return (b.pctSum/b.count)-(a.pctSum/a.count); });
    barsEl.innerHTML = sorted.map(function(c) {
      var p = c.count>0 ? c.pctSum/c.count : 0;
      var bc = p>=90?'#10b981':p>=80?'#f59e0b':'#ef4444';
      return '<div style="display:flex;align-items:center;gap:8px">'+
        '<div style="width:80px;font-size:10px;font-weight:700;color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:\'DM Mono\',monospace">'+c.name.split(' ')[0]+'</div>'+
        '<div style="flex:1;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden">'+
          '<div style="width:'+Math.min(p,100).toFixed(0)+'%;height:100%;background:'+bc+';border-radius:3px;transition:width .6s ease"></div>'+
        '</div>'+
        '<div style="width:42px;text-align:right;font-size:10px;font-weight:700;color:'+bc+';font-family:\'DM Mono\',monospace">'+(p===0?'Off':p.toFixed(0)+'%')+'</div>'+
      '</div>';
    }).join('');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CM EXTRA RENDER FUNCTIONS (non-chart DOM renderers)
// Charts are now built inline in cmDashRender; these handle DOM-only panels
// ══════════════════════════════════════════════════════════════════════════════

var cmExtraCharts = {}; // kept for backward compat, unused

// ── Leaderboard Cards (Top / Bottom / Blank) ──────────────────────────────────
function cmRenderLeaderCards(cmList) {
  if (!cmList.length) return;
  var sorted = cmList.filter(function(c){ return c.count > 0 && (c.pctSum/c.count) > 0; }).slice().sort(function(a,b){ return (b.pctSum/b.count)-(a.pctSum/a.count); });
  var topEl = document.getElementById('cmd-top-cm');
  var botEl = document.getElementById('cmd-bot-cm');
  var blkEl = document.getElementById('cmd-blank-cm');

  function cmCard(c, icon) {
    var p = c.count>0 ? c.pctSum/c.count : 0;
    var col = p>=90?'#10b981':p>=80?'#f59e0b':'#ef4444';
    var total = c.deals+c.calls+c.emails+c.tasks;
    return '<div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--s2);border-radius:12px;margin-bottom:8px;animation:fadeUp .4s ease">'
      +'<div style="width:46px;height:46px;border-radius:12px;background:'+col+'18;border:2px solid '+col+'44;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">'+icon+'</div>'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:800;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+c.name+'</div>'
        +'<div style="font-size:10px;color:var(--mu);font-family:DM Mono,monospace;margin-top:2px">'+total+' acts · '+c.calls+' calls · '+c.deals+' deals</div>'
        +'<div style="height:5px;background:var(--b);border-radius:3px;margin-top:6px;overflow:hidden">'
          +'<div style="width:'+Math.min(p,100).toFixed(0)+'%;height:100%;background:'+col+';border-radius:3px;transition:width .8s ease;box-shadow:0 0 6px '+col+'60"></div>'
        +'</div>'
      +'</div>'
      +'<div style="text-align:right;flex-shrink:0"><div style="font-size:26px;font-weight:900;font-family:DM Mono,monospace;color:'+col+';text-shadow:0 0 12px '+col+'60">'+p.toFixed(0)+'%</div></div>'
    +'</div>';
  }

  if (topEl) topEl.innerHTML = sorted.length ? cmCard(sorted[0],'🏆') : '<div style="color:var(--mu);font-size:12px;padding:12px">No data yet</div>';
  if (botEl) botEl.innerHTML = sorted.length > 1 ? cmCard(sorted[sorted.length-1],'⚠️') : (sorted.length ? cmCard(sorted[0],'⚠️') : '<div style="color:var(--mu);font-size:12px;padding:12px">No data yet</div>');
  if (blkEl) {
    var bs = cmList.slice().sort(function(a,b){return b.blank-a.blank;}).filter(function(c){return c.blank>0;});
    if (!bs.length) { blkEl.innerHTML = '<div style="color:#10b981;font-weight:700;font-size:13px;padding:12px">✅ No blank calls!</div>'; return; }
    blkEl.innerHTML = bs.slice(0,5).map(function(c,i){
      var col = i===0?'#ef4444':i===1?'#f59e0b':'#64748b';
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">'
        +'<div style="width:28px;height:28px;border-radius:50%;background:'+col+'18;border:2px solid '+col+'44;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:'+col+';flex-shrink:0">'+(i+1)+'</div>'
        +'<span style="font-size:12px;font-weight:700;color:var(--tx);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+c.name.split(' ')[0]+'</span>'
        +'<div style="flex:2;height:6px;background:var(--b);border-radius:3px;overflow:hidden">'
          +'<div style="width:'+Math.min((c.blank/bs[0].blank)*100,100).toFixed(0)+'%;height:100%;background:'+col+';border-radius:3px;transition:width .8s ease"></div>'
        +'</div>'
        +'<span style="font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+col+';min-width:26px;text-align:right">'+c.blank+'</span>'
      +'</div>';
    }).join('');
  }
}

// ── Activity Heat Strip ───────────────────────────────────────────────────────
function cmRenderHeatStrip(cmList) {
  var el = document.getElementById('cmd-heat');
  if (!el || !cmList.length) return;
  el.innerHTML = ''; // FIX: clear before re-render to prevent duplicates
  var COLORS = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#14b8a6','#f97316','#a855f7'];
  var maxAct = Math.max(1, Math.max.apply(null, cmList.map(function(c){return c.deals+c.calls+c.emails+c.tasks;})));
  var html = '';
  cmList.forEach(function(c, i) {
    var total = c.deals + c.calls + c.emails + c.tasks;
    var intensity = total / maxAct;
    var col = COLORS[i % COLORS.length];
    var pct = c.count > 0 ? c.pctSum / c.count : 0;
    var pctCol = pct >= 90 ? '#10b981' : pct >= 80 ? '#f59e0b' : '#ef4444';
    var sz = 84 + Math.round(intensity * 56);
    var delay = (0.1 + i * 0.05).toFixed(2);
    var tile = document.createElement('div');
    tile.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;animation:fadeUp ' + delay + 's ease';
    // Inner bubble
    var bubble = document.createElement('div');
    bubble.style.cssText = 'width:' + sz + 'px;height:' + sz + 'px;border-radius:18px;background:' + col + '18;border:2px solid ' + col + '44;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:default;transition:all .25s';
    bubble.title = c.name + ' — ' + total + ' activities';
    bubble.addEventListener('mouseenter', function() {
      this.style.boxShadow = '0 0 18px ' + col + '60';
      this.style.borderColor = col;
    });
    bubble.addEventListener('mouseleave', function() {
      this.style.boxShadow = '';
      this.style.borderColor = col + '44';
    });
    bubble.innerHTML =
      '<div style="font-size:' + (10 + Math.round(intensity * 7)) + 'px;font-weight:900;color:' + col + ';font-family:Nunito,sans-serif;line-height:1">' + total + '</div>' +
      '<div style="font-size:9px;color:rgba(100,116,139,.6);font-family:DM Mono,monospace">acts</div>' +
      (pct === 0 ? '<div style="font-size:10px;font-weight:700;color:#94a3b8;font-family:DM Mono,monospace">Day Off</div>' : '<div style="font-size:11px;font-weight:700;color:' + pctCol + ';font-family:DM Mono,monospace">' + pct.toFixed(0) + '%</div>');
    tile.appendChild(bubble);
    // Name label
    var nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:10px;font-weight:700;color:var(--tx);text-align:center;white-space:nowrap;max-width:' + sz + 'px;overflow:hidden;text-overflow:ellipsis';
    nameEl.textContent = c.name.split(' ')[0];
    tile.appendChild(nameEl);
    // Stats row
    var stats = document.createElement('div');
    stats.style.cssText = 'display:flex;gap:3px';
    stats.innerHTML =
      '<span style="font-size:9px;background:rgba(37,99,235,.12);color:#2563eb;padding:1px 5px;border-radius:4px;font-family:DM Mono,monospace" title="Deals">D:' + c.deals + '</span>' +
      '<span style="font-size:9px;background:rgba(124,58,237,.12);color:#7c3aed;padding:1px 5px;border-radius:4px;font-family:DM Mono,monospace" title="Calls">C:' + c.calls + '</span>';
    tile.appendChild(stats);
    el.appendChild(tile);
  });
}

// ── CM Error Analysis — dropdown selector + error breakdown ───────────────────
// Stores last cmList for the dropdown
var _cmErrorList = [];

function cmRenderErrorAnalysis(cmList) {
  _cmErrorList = cmList;
  // Set up click delegation on the team errors grid (for card clicks)
  var teamEl = document.getElementById('cm-team-errors');
  if (teamEl && !teamEl._delegated) {
    teamEl._delegated = true;
    teamEl.addEventListener('click', function(e) {
      var card = e.target.closest('[data-cmname]');
      if (!card) return;
      var name = card.getAttribute('data-cmname');
      var sel = document.getElementById('cm-error-select');
      if (sel) sel.value = name;
      cmShowCMErrors(name);
      // Scroll to detail
      var det = document.getElementById('cm-error-detail');
      if (det) det.scrollIntoView({behavior:'smooth', block:'start'});
    });
  }
  // Populate CM selector dropdown
  var sel = document.getElementById('cm-error-select');
  if (!sel) return;
  var prev = sel.value;
  sel.innerHTML = '<option value="">— Select a Case Manager —</option>'
    + cmList.map(function(c){ return '<option value="'+c.name+'">'+c.name+'</option>'; }).join('');
  if (prev && cmList.find(function(c){return c.name===prev;})) sel.value = prev;

  // Render team-wide error summary
  cmRenderTeamErrors(cmList);

  // Render selected CM errors if one chosen
  if (sel.value) cmShowCMErrors(sel.value);
  else document.getElementById('cm-error-detail').innerHTML = '<div style="color:var(--mu);font-size:12px;padding:20px;text-align:center">Select a case manager above to see their error detail</div>';
}

function cmShowCMErrors(name) {
  var cmList = _cmErrorList;
  var c = cmList.find(function(x){return x.name===name;});
  var el = document.getElementById('cm-error-detail');
  if (!el) return;
  if (!c) { el.innerHTML = '<div style="color:var(--mu);padding:20px">No data for this CM</div>'; return; }

  var pct = c.count>0 ? c.pctSum/c.count : 0;
  var pctCol = pct>=90?'#10b981':pct>=80?'#f59e0b':'#ef4444';

  // Activity fields with counts
  var FIELDS = [
    {key:'deals',      label:'Deals',         icon:'💼', col:'#2563eb'},
    {key:'calls',      label:'Calls Made',    icon:'📞', col:'#7c3aed'},
    {key:'connected',  label:'Connected',     icon:'🔗', col:'#06b6d4'},
    {key:'emails',     label:'Emails',        icon:'📧', col:'#d97706'},
    {key:'tasks',      label:'Tasks',         icon:'✅', col:'#10b981'},
    {key:'followUp',   label:'Follow Up',     icon:'🔄', col:'#6366f1'},
    {key:'nextTask',   label:'Next Task Set', icon:'📋', col:'#8b5cf6'},
    {key:'stageUpd',   label:'Stage Updated', icon:'📊', col:'#0891b2'},
    {key:'onTime',     label:'On Time',       icon:'⏱️', col:'#059669'},
    {key:'blank',      label:'Blank Calls',   icon:'📵', col:'#ef4444'},
  ];

  // Team averages for comparison
  var teamAvgs = {};
  FIELDS.forEach(function(f){
    teamAvgs[f.key] = cmList.length ? cmList.reduce(function(s,x){return s+(x[f.key]||0);},0)/cmList.length : 0;
  });
  var maxVal = Math.max(1, Math.max.apply(null, FIELDS.map(function(f){return c[f.key]||0;})));

  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:linear-gradient(135deg,rgba(99,102,241,.08),transparent);border-radius:12px;margin-bottom:14px">'
      +'<div style="text-align:center;min-width:80px">'
        +'<div style="font-size:9px;color:var(--mu);font-family:DM Mono,monospace;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">Compliance</div>'
        +'<div style="font-size:36px;font-weight:900;color:'+pctCol+';font-family:Nunito,sans-serif;text-shadow:0 0 16px '+pctCol+'60;line-height:1">'+pct.toFixed(1)+'%</div>'
      +'</div>'
      +'<div style="flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'
        +['deals','calls','emails','tasks','blank','connected'].map(function(k){
          var f = FIELDS.find(function(x){return x.key===k;});
          return '<div style="background:var(--s2);border-radius:8px;padding:8px 10px">'
            +'<div style="font-size:9px;color:var(--mu);font-family:DM Mono,monospace">'+f.icon+' '+f.label+'</div>'
            +'<div style="font-size:18px;font-weight:800;color:'+f.col+';font-family:Nunito,sans-serif">'+( c[k]||0)+'</div>'
          +'</div>';
        }).join('')
      +'</div>'
    +'</div>'
    +'<div style="font-size:11px;font-weight:700;color:var(--mu);font-family:DM Mono,monospace;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">Activity Breakdown vs Team Average</div>'
    +FIELDS.map(function(f){
      var val = c[f.key]||0;
      var avg = teamAvgs[f.key];
      var barW = maxVal>0 ? Math.round((val/maxVal)*100) : 0;
      var avgW = maxVal>0 ? Math.round((avg/maxVal)*100) : 0;
      var diff = val - avg;
      var diffTxt = diff>0?'<span style="color:#10b981;font-size:10px">+'+diff.toFixed(0)+' vs avg</span>':diff<0?'<span style="color:#ef4444;font-size:10px">'+diff.toFixed(0)+' vs avg</span>':'<span style="color:#64748b;font-size:10px">= avg</span>';
      var isBlank = f.key==='blank';
      var barCol = isBlank ? (val>0?'#ef4444':'#10b981') : f.col;
      return '<div style="margin-bottom:10px">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'
          +'<span style="font-size:12px;font-weight:600;color:var(--tx)">'+f.icon+' '+f.label+'</span>'
          +'<div style="display:flex;align-items:center;gap:8px">'
            +diffTxt
            +'<span style="font-size:13px;font-weight:800;color:'+barCol+';font-family:DM Mono,monospace">'+val+'</span>'
          +'</div>'
        +'</div>'
        +'<div style="position:relative;height:8px;background:var(--b);border-radius:4px;overflow:hidden">'
          +'<div style="width:'+barW+'%;height:100%;background:'+barCol+';border-radius:4px;transition:width .6s ease;box-shadow:0 0 6px '+barCol+'50"></div>'
          +'<div style="position:absolute;top:0;height:100%;width:2px;background:rgba(0,0,0,.2);border-radius:2px;left:'+avgW+'%;transition:left .6s ease" title="Team avg: '+avg.toFixed(1)+'"></div>'
        +'</div>'
      +'</div>';
    }).join('');
}

// ── Team-wide error category breakdown ────────────────────────────────────────
function cmRenderTeamErrors(cmList) {
  var el = document.getElementById('cm-team-errors');
  if (!el || !cmList.length) return;

  var METRICS = [
    {key:'deals',     label:'Deals',       icon:'💼', col:'#2563eb'},
    {key:'calls',     label:'Calls',       icon:'📞', col:'#7c3aed'},
    {key:'emails',    label:'Emails',      icon:'📧', col:'#d97706'},
    {key:'tasks',     label:'Tasks',       icon:'✅', col:'#10b981'},
    {key:'blank',     label:'Blank',       icon:'📵', col:'#ef4444'},
    {key:'followUp',  label:'Follow Up',   icon:'🔄', col:'#6366f1'},
    {key:'stageUpd',  label:'Stage Upd',   icon:'📊', col:'#0891b2'},
    {key:'connected', label:'Connected',   icon:'🔗', col:'#06b6d4'},
  ];

  // Sort CMs by compliance for display
  var sorted = cmList.slice().sort(function(a,b){return (b.pctSum/b.count)-(a.pctSum/a.count);});

  // Build team totals
  var totals = {};
  METRICS.forEach(function(m){ totals[m.key] = cmList.reduce(function(s,c){return s+(c[m.key]||0);},0); });
  var maxTotal = Math.max(1, Math.max.apply(null, METRICS.map(function(m){return totals[m.key];})));

  // Best and worst metrics
  var bestMetric  = METRICS.slice().sort(function(a,b){return totals[a.key]-totals[b.key];})[0];
  var worstMetric = METRICS.slice().sort(function(a,b){return totals[b.key]-totals[a.key];})[0];

  el.innerHTML =
    // Team summary pills
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">'
      +'<div style="background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);border-radius:10px;padding:10px 14px;flex:1;min-width:180px">'
        +'<div style="font-size:9px;color:#10b981;font-family:DM Mono,monospace;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">✅ DOING WELL</div>'
        +'<div style="font-size:16px;font-weight:800;color:var(--tx)">'+bestMetric.icon+' '+bestMetric.label+'</div>'
        +'<div style="font-size:11px;color:var(--mu)">Lowest activity gap — '+totals[bestMetric.key]+' total across all CMs</div>'
      +'</div>'
      +'<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:10px 14px;flex:1;min-width:180px">'
        +'<div style="font-size:9px;color:#ef4444;font-family:DM Mono,monospace;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">⚠️ NEEDS COACHING</div>'
        +'<div style="font-size:16px;font-weight:800;color:var(--tx)">'+worstMetric.icon+' '+worstMetric.label+'</div>'
        +'<div style="font-size:11px;color:var(--mu)">Highest volume — '+totals[worstMetric.key]+' total across all CMs</div>'
      +'</div>'
    +'</div>'
    // Per-metric bars
    +'<div style="font-size:11px;font-weight:700;color:var(--mu);font-family:DM Mono,monospace;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Team Totals by Activity</div>'
    +METRICS.map(function(m){
      var pct = Math.round((totals[m.key]/maxTotal)*100);
      return '<div style="margin-bottom:8px">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">'
          +'<span style="font-size:12px;font-weight:600;color:var(--tx)">'+m.icon+' '+m.label+'</span>'
          +'<span style="font-size:12px;font-weight:800;color:'+m.col+';font-family:DM Mono,monospace">'+totals[m.key]+'</span>'
        +'</div>'
        +'<div style="height:7px;background:var(--b);border-radius:4px;overflow:hidden">'
          +'<div style="width:'+pct+'%;height:100%;background:linear-gradient(90deg,'+m.col+','+m.col+'bb);border-radius:4px;transition:width .8s ease;box-shadow:0 0 4px '+m.col+'40"></div>'
        +'</div>'
      +'</div>';
    }).join('')
    +'';
}

// ── switchPeriod + renderCM kept as no-ops for backward compat ──
// ── switchPeriod + renderCM kept as no-ops for backward compat ──
function switchPeriod(tab) {}
function cmSrch(tbId, val) {
  var q = val.toLowerCase();
  document.querySelectorAll('#'+tbId+' tr').forEach(function(tr){
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// CASE LINK MODAL — Click on error count → see case links
// ══════════════════════════════════════════════════════════════════════════════

// FIELD → friendly name map
var HOF_FIELD_NAMES = {
  firstContact:'1st Contact',firstCall:'1st Call Made',callLogged:'Call Logged',
  outcome:'Outcome',callDesc:'Call Description',leadStage:'Lead Stage Updated',
  correctStage:'Correct Stage',qualifiedMark:'Qualified Mark',deal:'Deal Created',
  pipeline:'Pipeline',timeline:'Timeline',properties:'Properties',
  emailSent:'Email Sent',emailHub:'Email via HubSpot',profTone:'Professional Tone',
  signature:'Signature',waUsed:'WhatsApp Used',waLogged:'WhatsApp Logged',
  waNote:'WhatsApp Note',taskCreated:'Task Created',taskDone:'Task Done',taskType:'Task Type'
};

function showCaseLinkModal(fieldName, agentName, count, links, hasLinks) {
  var modal   = document.getElementById('caseLinkModal');
  var overlay = document.getElementById('caseLinkOverlay');
  var titleEl = document.getElementById('caseLinkTitle');
  var subEl   = document.getElementById('caseLinkSub');
  var bodyEl  = document.getElementById('caseLinkBody');
  var noteEl  = document.getElementById('caseLinkNote');

  var friendlyName = HOF_FIELD_NAMES[fieldName] || fieldName;
  titleEl.textContent = friendlyName + ' — Error Cases';
  subEl.textContent   = agentName + ' · ' + count + ' error' + (count>1?'s':'') + ' this period';

  var items = Array.isArray(links) ? links : [];

  if (!hasLinks && !items.length) {
    // Sheet not yet public — show setup guide
    bodyEl.innerHTML =
      '<div style="padding:4px 0 16px">' +
        '<div style="background:linear-gradient(135deg,#fef3c7,#fffbeb);border:1px solid #fde68a;border-radius:12px;padding:14px 16px;margin-bottom:14px">' +
          '<div style="font-size:13px;font-weight:800;color:#92400e;margin-bottom:5px">⚡ Case links not loaded yet</div>' +
          '<div style="font-size:11px;color:#78350f;line-height:1.6">The dashboard auto-reads your sheet to find case links, but the sheet needs to be publicly shared (view-only). Choose how to fix this:</div>' +
        '</div>' +

        '<div style="display:flex;flex-direction:column;gap:10px">' +

        '<div style="background:var(--s2);border:1px solid var(--b);border-radius:12px;padding:14px 16px;border-left:4px solid #2563eb">' +
          '<div style="font-size:12px;font-weight:800;color:#2563eb;margin-bottom:7px">✅ Option 1 — Make sheet public (easiest)</div>' +
          '<div style="font-size:11px;color:var(--t2);line-height:1.8">' +
            '1. Open your Google Sheet below<br>' +
            '2. Click <strong>Share</strong> → <strong>Change to anyone with the link</strong> → <strong>Viewer</strong><br>' +
            '3. Click Save, then <strong>Refresh</strong> this dashboard<br>' +
            '<span style="font-size:10px;color:var(--mu)">Dashboard reads it silently — no login, view-only, completely safe</span>' +
          '</div>' +
          '<a href="https://docs.google.com/spreadsheets/d/' + RAW_SHEET_ID + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:#2563eb;color:#fff;border-radius:8px;padding:8px 16px;font-size:11px;font-weight:700;text-decoration:none;box-shadow:0 2px 8px rgba(37,99,235,.3)">' +
            '📊 Open Sheet &nbsp;<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
          '</a>' +
        '</div>' +

        '<div style="background:var(--s2);border:1px solid var(--b);border-radius:12px;padding:14px 16px;border-left:4px solid #7c3aed">' +
          '<div style="font-size:12px;font-weight:800;color:#7c3aed;margin-bottom:7px">⚙️ Option 2 — Update your Apps Script</div>' +
          '<div style="font-size:11px;color:var(--t2);line-height:1.8">' +
            'Add <code style="background:var(--b);padding:1px 5px;border-radius:3px">errorLinks</code> to your Apps Script response for the HOF tab.<br>' +
            'The dashboard is already wired to receive and display it automatically.<br>' +
            'Format per agent: <code style="background:var(--b);padding:1px 5px;border-radius:3px;font-size:10px">{ outcome:[{url,name,date}], call:[...] }</code>' +
          '</div>' +
          '<button onclick="closeCaseLinkModal();showAppsScriptModal()" style="margin-top:10px;background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:11px;font-weight:700">📋 Get complete Apps Script →</button>' +
        '</div>' +

        '</div>' +
      '</div>';

  } else if (!items.length) {
    bodyEl.innerHTML =
      '<div style="text-align:center;padding:28px;color:var(--mu)">' +
        '<div style="font-size:32px;margin-bottom:10px">🔍</div>' +
        '<div style="font-size:14px;font-weight:700;color:var(--tx);margin-bottom:6px">No matching cases found</div>' +
        '<div style="font-size:12px;line-height:1.6">Sheet was read successfully, but no rows matched<br><strong>' + agentName + '</strong> with a <strong>' + friendlyName + '</strong> error.<br><br>' +
        '<span style="color:var(--mu)">Check that the consultant\'s name in the sheet exactly matches the dashboard name, and that the error column is filled correctly (1 = error, 0 = pass).</span></div>' +
      '</div>';
  } else {
    bodyEl.innerHTML =
      '<div style="margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<span style="font-size:11px;color:var(--mu);font-family:\'DM Mono\',monospace">' + items.length + ' case' + (items.length>1?'s':'') + ' flagged:</span>' +
        '<span style="background:#dc262615;color:#dc2626;border:1px solid #dc262630;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">' + friendlyName + '</span>' +
        '<span style="background:var(--s2);color:var(--mu);border:1px solid var(--b);padding:3px 10px;border-radius:20px;font-size:10px;font-family:\'DM Mono\',monospace">' + agentName + '</span>' +
      '</div>' +
      items.map(function(item, i) {
        var url  = typeof item === 'string' ? item : (item.url || item.link || item.href || '');
        var name = typeof item === 'string' ? ('Case '+(i+1)) : (item.name || item.caseName || item.case || item.title || ('Case '+(i+1)));
        var date = typeof item === 'object' ? (item.date || item.auditDate || '') : '';
        var isHub = url.includes('hubspot') || url.includes('app.hubspot');
        return '<div style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:var(--s2);border-radius:12px;margin-bottom:8px;border:1px solid var(--b)">' +
          '<div style="width:38px;height:38px;background:' + (isHub?'rgba(255,90,50,.1)':'rgba(37,99,235,.08)') + ';border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px">' + (isHub?'🟠':'📋') + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;font-weight:700;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + name + '</div>' +
            (date ? '<div style="font-size:10px;color:#2563eb;font-family:\'DM Mono\',monospace;margin-top:2px;font-weight:600">📅 ' + date + '</div>' : '') +
            (url ? '<div style="font-size:10px;color:var(--mu);font-family:\'DM Mono\',monospace;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + url + '</div>'
                 : '<div style="font-size:10px;color:#d97706;margin-top:2px">⚠️ No URL — add a "Case Link" column to your sheet</div>') +
          '</div>' +
          (url ?
            '<a href="' + url + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border-radius:9px;padding:8px 16px;font-size:11px;font-weight:700;text-decoration:none;flex-shrink:0;display:flex;align-items:center;gap:5px;box-shadow:0 2px 8px rgba(37,99,235,.25)">Open &nbsp;<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>'
          : '<span style="font-size:11px;color:var(--mu);padding:8px 10px">No URL</span>') +
        '</div>';
      }).join('');
  }

  noteEl.textContent = friendlyName + ' · ' + count + ' error' + (count>1?'s':'') + ' · ' + agentName;
  modal.style.display   = 'flex';
  overlay.style.display = 'block';
}

function closeCaseLinkModal() {
  document.getElementById('caseLinkModal').style.display   = 'none';
  document.getElementById('caseLinkOverlay').style.display = 'none';
}

function showAppsScriptModal() {
  document.getElementById('asModal').style.display   = 'flex';
  document.getElementById('asOverlay').style.display = 'block';
}

function closeAppsScriptModal() {
  document.getElementById('asModal').style.display   = 'none';
  document.getElementById('asOverlay').style.display = 'none';
}

function copyASCode() {
  var el = document.getElementById('asCodeBlock');
  var text = el ? el.innerText : '';
  navigator.clipboard.writeText(text).then(function(){
    showToast('✅ Apps Script code copied to clipboard!');
  }).catch(function(){
    showToast('Select the code block and copy manually');
  });
}

window.addEventListener('keydown', function(e){
  if(e.key==='Escape') { closeCaseLinkModal(); closeAppsScriptModal(); }
});



function trainingCardClick(name) {
  const sel=document.getElementById('trainingConsultantSel');
  if(sel) sel.value=name;
  highlightTrainingCard(name);
  showTrainingForConsultant(name);
  setTimeout(()=>{const d=document.getElementById('trainingDetail');if(d)d.scrollIntoView({behavior:'smooth',block:'nearest'});},100);
}



function highlightTrainingCard(name) {
  document.querySelectorAll('[id^="tc-card-"]').forEach(el=>{el.style.outline='';el.style.boxShadow='';});
  const el=document.getElementById('tc-card-'+name.replace(/\s+/g,'-'));
  if(el){el.style.outline='2px solid #6366f1';el.style.boxShadow='0 0 0 4px rgba(99,102,241,.15)';}
}



function closeTrainingDetail() {
  const d=document.getElementById('trainingDetail'); if(d) d.innerHTML='';
  const s=document.getElementById('trainingConsultantSel'); if(s) s.value='';
  document.querySelectorAll('[id^="tc-card-"]').forEach(el=>{el.style.outline='';el.style.boxShadow='';});
}

// ── BOOT ──────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// AI ASSISTANT
// ══════════════════════════════════════════════════════════════════════════════
var aiOpen = false;
var aiHistory = [];
var aiFile = null;
var aiFileData = null;

function toggleAIChat() {
  aiOpen = !aiOpen;
  var drawer  = document.getElementById('aiDrawer');
  var overlay = document.getElementById('aiOverlay');
  drawer.style.right  = aiOpen ? '0' : '-480px';
  overlay.style.display = aiOpen ? 'block' : 'none';
  if (aiOpen) setTimeout(function(){ document.getElementById('aiInput').focus(); }, 300);
}

function handleAIFile(input) {
  var file = input.files[0];
  if (!file) return;
  aiFile = file;
  document.getElementById('aiFileName').textContent = file.name + ' (' + (file.size/1024).toFixed(0) + 'KB)';
  document.getElementById('aiFilePreview').style.display = 'block';
  // Read file
  var reader = new FileReader();
  reader.onload = function(e) { aiFileData = e.target.result.split(',')[1]; };
  reader.readAsDataURL(file);
}

function clearAIFile() {
  aiFile = null; aiFileData = null;
  document.getElementById('aiFilePreview').style.display = 'none';
  document.getElementById('aiFileInput').value = '';
}

function aiAsk(question) {
  document.getElementById('aiInput').value = question;
  sendAIMessage();
}

function buildDashboardContext(question) {
  if (!HOF_ALL || !HOF_ALL.length) return 'No dashboard data loaded yet.';

  var q = (question || '').toLowerCase();
  var catNames = {outcome:'Outcome',call:'Call',leadStage:'Lead Stage',deal:'Deal',email:'Email',whatsapp:'WhatsApp',task:'Task'};
  var topCat = ['outcome','call','leadStage','deal','email','whatsapp','task'];

  var dataset = HOF_filtered && HOF_filtered.length ? HOF_filtered : HOF_ALL;
  var totalAud = dataset.reduce(function(s,d){ return s+d.audits; },0);
  var avgPct   = (dataset.reduce(function(s,d){ return s+d.pct; },0)/dataset.length).toFixed(1);
  var atRisk   = dataset.filter(function(d){ return d.pct<80; }).length;
  var catErrs  = topCat.map(function(c){ return {name:catNames[c],errs:dataset.reduce(function(s,d){ return s+(d['catErr_'+c]||0);},0)}; });
  catErrs.sort(function(a,b){ return b.errs-a.errs; });
  var currentLabel = (document.getElementById('ltxt') ? document.getElementById('ltxt').textContent : 'Current Period') || 'Current Period';

  var header = 'HOF Dashboard | ' + currentLabel + ' | Agents:' + dataset.length + ' | Avg:' + avgPct + '% | AtRisk:' + atRisk + ' | Audits:' + totalAud;
  var catLine = 'TopErrors: ' + catErrs.slice(0,4).map(function(c){ return c.name+':'+c.errs; }).join(', ');

  var agentParts = dataset.slice().sort(function(a,b){ return a.pct-b.pct; }).map(function(d){
    var cats = topCat.filter(function(c){ return (d['catErr_'+c]||0)>0; })
                     .map(function(c){ return catNames[c]+':'+(d['catErr_'+c]); }).join(',');
    var sop = d.mismatchQualNoDeal > 0 ? ('|SOP:'+d.mismatchQualNoDeal) : '';
    var catPart = cats ? ('|'+cats) : '';
    return d.name+'|'+d.pct.toFixed(0)+'%|'+d.total+'err|'+d.audits+'aud'+catPart+sop;
  });

  var lines = [header, catLine, '', 'Consultants:'].concat(agentParts);

  var needsTrend = /improv|declin|trend|history|last month|previous|compar|progress|worst.*month|best.*month|month.over/i.test(q);
  if (needsTrend) {
    var hasTrend = HOF_ALL.some(function(d){ return d.trend && d.trend.length > 1; });
    if (hasTrend) {
      var improved = HOF_ALL.map(function(d){
        if (!d.trend || d.trend.length < 2) return null;
        var last = d.trend[d.trend.length-1];
        var prev = d.trend[d.trend.length-2];
        var delta = ((last.pct||0) - (prev.pct||0)).toFixed(1);
        var sign = parseFloat(delta) > 0 ? '+' : '';
        return d.name + ': ' + sign + delta + '% (' + (prev.month||'prev') + ' to ' + (last.month||'last') + ')';
      }).filter(Boolean);
      improved.sort(function(a,b){ return parseFloat(b.split(': ')[1]) - parseFloat(a.split(': ')[1]); });
      lines.push('');
      lines.push('Trend (latest vs prev month):');
      improved.forEach(function(x){ lines.push(x); });
    }
  }

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
// HOF AI - GROQ INTEGRATION (Production Ready - Free)
// Model: llama-3.3-70b-versatile (fastest, most capable open model)
// ══════════════════════════════════════════════════════════════════════════════


const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Send AI message via Groq API
 * Fast, free, reliable
 */
async function sendAIMessage() {
  var input = document.getElementById('aiInput');
  var msg   = input.value.trim();
  if (!msg && !aiFile) return;

  var displayMsg = msg || ('📎 ' + (aiFile ? aiFile.name : ''));
  addAIMessage(displayMsg, 'user');
  input.value = '';
  input.style.height = '42px';
  document.getElementById('aiSuggestions').style.display = 'none';

  var sendBtn = document.getElementById('aiSendBtn');
  sendBtn.disabled = true;

  var typingId = 'typing_' + Date.now();
  var typingDiv = document.createElement('div');
  typingDiv.id = typingId;
  typingDiv.className = 'ai-msg ai-assistant';
  typingDiv.innerHTML = '<div class="ai-typing"><span></span><span></span><span></span></div>';
  document.getElementById('aiMessages').appendChild(typingDiv);
  scrollAIToBottom();

  try {
    var ctx = buildDashboardContext(msg);
    var systemPrompt = 'You are HOF Compliance AI Assistant. Answer using the dashboard data provided. Be concise, professional, and helpful. Focus on UAE compliance, immigration, visa requirements, and team performance analysis.\n\nDASHBOARD DATA:\n' + ctx;

    // Keep last 3 messages for context
    var messages = aiHistory.slice(-3);

    // Add current user message
    messages.push({ 
      role: 'user', 
      content: msg 
    });

    // Call Groq API
    var reply = await callGroqAPI(messages, systemPrompt);

    // Store in history
    aiHistory.push({ role:'user', content: msg });
    aiHistory.push({ role:'assistant', content: reply });

    // Remove typing indicator and show response
    var typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();
    addAIMessage(reply, 'assistant');

  } catch(err) {
    console.error('HOF AI Error:', err);
    var typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();
    addAIMessage('Error: ' + err.message, 'assistant');
  }

  sendBtn.disabled = false;
}

/**
 * Call Groq API with full message history
 * Supports conversation context
 */
async function callGroqAPI(messages, systemPrompt) {
  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          ...messages
        ],
        temperature: 0.7,
        max_tokens: 1024,
        top_p: 1,
        stream: false
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    const data = await response.json();
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content;
    }

    throw new Error('No response from Groq API');

  } catch(error) {
    console.error('Groq API Error:', error);
    throw error;
  }
}

function addAIMessage(text, role) {
  var msgs = document.getElementById('aiMessages');
  var div  = document.createElement('div');
  div.className = 'ai-msg ai-' + role;
  div.innerHTML = '<div class="ai-bubble">' + text.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div>';
  msgs.appendChild(div);
  scrollAIToBottom();
}

function scrollAIToBottom() {
  var msgs = document.getElementById('aiMessages');
  setTimeout(function(){ msgs.scrollTop = msgs.scrollHeight; }, 50);
}
