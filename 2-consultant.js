async function hofFetch(silent=false) {
  document.getElementById('eb').classList.remove('on');
  if (!silent) { showLdr('Fetching live data…'); showSkeleton(); }

  const {s,e} = getBounds(activeRange);
  let url = APIS.hof;
  const p = [];
  if (s) p.push('start='+fmtDate(s));
  if (e) p.push('end='+fmtDate(e));
  if (p.length) url += '?' + p.join('&');

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {redirect:'follow', signal: controller.signal});
    clearTimeout(tid);
    if (!res.ok) throw new Error('HTTP '+res.status);
    const raw = await res.text();
    if (!raw || raw.trim()==='') throw new Error('Empty response');
    let json;
    try { json = JSON.parse(raw); }
    catch(pe) {
      if (raw.includes('<html') || raw.includes('<!DOCTYPE'))
        throw new Error('Apps Script returned HTML — re-deploy: Execute as Me, Anyone');
      throw new Error('JSON parse failed: '+pe.message);
    }
    if (json.ok===false) throw new Error('Apps Script error: '+(json.error||'unknown'));
    if (!Array.isArray(json.data)||json.data.length===0)
      throw new Error('No data found. Try "All Time" to confirm data exists.');

    HOF_ALL = json.data.map(d => ({
      name:               String(d.name||''),
      source:             String(d.source||'global'),
      audits:             +d.audits||0,
      pct:                +d.pct||0,
      total:              +d.total||0,
      catErr_call:        +d.catErr_call||0,
      catErr_whatsapp:    +d.catErr_whatsapp||0,
      catErr_email:       +d.catErr_email||0,
      catErr_description: +d.catErr_description||0,
      catErr_leadStage:   +d.catErr_leadStage||0,
      catErr_deal:        +d.catErr_deal||0,
      catErr_task:        +d.catErr_task||0,
      catErr_followUp:    +d.catErr_followUp||0,
      severityCritical:   +d.severityCritical||0,
      severityWarning:    +d.severityWarning||0,
      severityGood:       +d.severityGood||0,
      errorLinks: (d.errorLinks && typeof d.errorLinks==='object') ? d.errorLinks : {},
      trend: Array.isArray(d.trend) ? d.trend : [],
      // Legacy compat fields
      deal:               +d.catErr_deal||0,
      qualPct:            null, naPct: null,
      caseQualified:0, caseNoAnswer:0, caseCannotDial:0,
      mismatchQualNoDeal:0, mismatchDealWrongStage:0, mismatchQualWrongStage:0,
      firstContact:0,firstCall:0,callLogged:0,outcome:0,callDesc:0,
      leadStage:0,correctStage:0,qualifiedMark:0,pipeline:0,
      timeline:0,properties:0,emailSent:0,emailHub:0,profTone:0,
      signature:0,waUsed:0,waLogged:0,waNote:0,
      taskCreated:0,taskDone:0,taskType:0,timelyContact:0,
      catErr_outcome:0, catErr_pipeline:0,
      wOutcome:0,wCall:0,wLeadStage:0,wDeal:0,wEmail:0,wWhatsApp:0,wTask:0,
      wpOutcome:0,wpCall:0,wpLeadStage:0,wpDeal:0,wpEmail:0,wpWhatsApp:0,wpTask:0,
    }));

    HOF_totalAudits = json.totalAudits || HOF_ALL.reduce((s,d)=>s+d.audits,0);
    HOF_dateRange   = json.dateRange   || {min:'',audits:''};
    loadedTabs.hof  = true;

    setUpd();
    if (!silent) {
      hofPopulateCF();
      hofRestoreUrl();
      applyFilters();
      hideSkeleton();
      showToast('Data loaded — '+HOF_ALL.length+' agents ('+(json.sheets||[]).join(', ')+')');
      try { renderWeightTable(); } catch(e2) { console.error('renderWeightTable:',e2.message); }
    } else {
      try { applyFilters(); renderWeightTable(); setUpd(); } catch(e2) {}
    }
  } catch(err) {
    clearTimeout(tid);
    if (!silent) {
      document.getElementById('emsg').textContent = err.message;
      document.getElementById('edet').textContent =
        '1. Apps Script → Deploy → Manage\n2. Execute as: Me\n3. Who has access: Anyone\n4. New change? Create NEW deployment → paste new URL';
      document.getElementById('eb').classList.add('on');
      if (!HOF_ALL.length) document.getElementById('tb').innerHTML =
        '<tr><td colspan="15" style="text-align:center;padding:28px;color:var(--mu)">No data. Check error above.</td></tr>';
    }
  } finally {
    if (!silent) hideLdr();
  }
}

function hofPopulateCF() {
  const sel = document.getElementById('cf'), cur = sel.value;
  sel.innerHTML = '<option value="all">All Consultants</option>';
  [...new Set(HOF_ALL.map(d=>d.name))].sort().forEach(n => {
    const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o);
  });
  if (cur) sel.value = cur;
  document.getElementById('nc-hof').textContent = HOF_ALL.length;
}

function setRange(el, range) {
  document.querySelectorAll('.chip[data-range]').forEach(b => b.classList.remove('active'));
  el.classList.add('active'); activeRange = range;
  document.getElementById('cbox').classList.toggle('hidden', range !== 'custom');
  hofFetch();
}

function applyFilters() {
  const c = document.getElementById('cf').value;
  const s = document.getElementById('sf').value;
  HOF_filtered = HOF_ALL.filter(d => c === 'all' || d.name === c);
  hofSort(s);

  // Switch between personal and team view
  if (c !== 'all' && HOF_filtered.length === 1) {
    togglePersonalView(HOF_filtered[0]);
  } else {
    togglePersonalView(null);
    hofUpdateKPIs();
    hofRenderTable(HOF_filtered);
    hofUpdateCharts();
    hofRenderSparks();
    renderWeightTable();
    try { renderTrainingPanel(); } catch(e) { console.error("renderTrainingPanel:", e.message); }
    try { renderDistribution(); } catch(e) { console.error("renderDistribution:", e.message); }
    try { renderLeaderboards(); } catch(e) { console.error("renderLeaderboards:", e.message); }
    try { renderPeriodComparison(); } catch(e) { console.error("renderPeriodComparison:", e.message); }
    resetAgentRadar();
  }
  document.getElementById('rcount').textContent = HOF_filtered.length + ' agent' + (HOF_filtered.length !== 1 ? 's' : '') + ' shown';

  const ctx = document.getElementById('ctx');
  if (HOF_dateRange.min) {
    let label = activeRange==='all'   ? 'All time (' + HOF_dateRange.min + ' → ' + HOF_dateRange.audits + ')' :
                activeRange==='today'     ? 'Today' :
                activeRange==='thismonth' ? 'This Month' :
                activeRange==='lastmonth' ? 'Last Month' :
                activeRange==='last7'     ? 'Last 7 Days' :
                activeRange==='last3'     ? 'Last 3 Days' :
                (fmtDate(getBounds(activeRange).s)||'?') + ' → ' + (fmtDate(getBounds(activeRange).e)||'?');
    ctx.innerHTML = '<div class="ctx-dot"></div> Showing: <strong>' + label + '</strong> &nbsp;|&nbsp; Sheet data range: ' + HOF_dateRange.min + ' → ' + HOF_dateRange.audits;
  }
}

function hofSort(s) {
  if      (s==='errors-desc') HOF_filtered.sort((a,b)=>b.total-a.total);
  else if (s==='errors-asc')  HOF_filtered.sort((a,b)=>a.total-b.total);
  else if (s==='pct-asc')     HOF_filtered.sort((a,b)=>a.pct-b.pct);
  else if (s==='pct-desc')    HOF_filtered.sort((a,b)=>b.pct-a.pct);
  else if (s==='audits-desc') HOF_filtered.sort((a,b)=>b.audits-a.audits);
  else if (s==='name')        HOF_filtered.sort((a,b)=>a.name.localeCompare(b.name));
}

function hofUpdateKPIs() {
  const tot    = HOF_filtered.reduce((s,d)=>s+d.total,0);
  const avg    = HOF_filtered.length ? HOF_filtered.reduce((s,d)=>s+d.pct,0)/HOF_filtered.length : 0;
  const aud    = HOF_filtered.reduce((s,d)=>s+d.audits,0) || HOF_totalAudits;
  const atRisk = HOF_filtered.filter(d=>d.pct<80).length;
  const onTrack= HOF_filtered.filter(d=>d.pct>=90).length;
  const dl     = HOF_filtered.reduce((s,d)=>s+d.catErr_deal,0);
  const crit   = HOF_filtered.reduce((s,d)=>s+d.severityCritical,0);
  const errPerAudit = aud>0 ? (tot/aud) : 0;
  const pc = avg>=90?'#059669':avg>=80?'#d97706':'#dc2626';

  const catTotals = {
    'Call':        HOF_filtered.reduce((s,d)=>s+(d.catErr_call||0),0),
    'WhatsApp':    HOF_filtered.reduce((s,d)=>s+(d.catErr_whatsapp||0),0),
    'Email':       HOF_filtered.reduce((s,d)=>s+(d.catErr_email||0),0),
    'Description': HOF_filtered.reduce((s,d)=>s+(d.catErr_description||0),0),
    'Lead Stage':  HOF_filtered.reduce((s,d)=>s+(d.catErr_leadStage||0),0),
    'Deal':        HOF_filtered.reduce((s,d)=>s+(d.catErr_deal||0),0),
    'Task':        HOF_filtered.reduce((s,d)=>s+(d.catErr_task||0),0),
    'Follow Up':   HOF_filtered.reduce((s,d)=>s+(d.catErr_followUp||0),0),
  };
  const topCat = Object.entries(catTotals).sort((a,b)=>b[1]-a[1])[0];

  let headline, sub;
  if (avg>=90 && atRisk===0) {
    headline='Team is performing well';
    sub=onTrack+' of '+HOF_filtered.length+' agents above 90%.';
  } else if (avg>=80 && atRisk<=3) {
    headline='Team needs targeted coaching';
    sub=errPerAudit.toFixed(1)+' errors per audit. '+atRisk+' agent(s) below 80%.';
  } else {
    headline='Team performance requires urgent attention';
    sub=atRisk+' agents below 80%. Error rate: '+errPerAudit.toFixed(1)+'/audit.';
  }

  const he = document.getElementById('execHeadline'); if(he) he.textContent=headline;
  const se = document.getElementById('execSub');
  if(se) se.textContent=sub+(topCat?' Biggest gap: '+topCat[0]+' ('+topCat[1]+' fails).':'');
  const be = document.getElementById('execBadges');
  if(be) be.innerHTML=[
    `<span style="background:${pc}20;color:${pc};border:1px solid ${pc}40;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700">${avg.toFixed(1)}% compliance</span>`,
    crit>0?`<span style="background:#dc262620;color:#dc2626;border:1px solid #dc262640;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700">⛔ ${crit} critical</span>`:'',
    atRisk>0?`<span style="background:#dc262620;color:#dc2626;border:1px solid #dc262640;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700">${atRisk} below 80%</span>`
            :'<span style="background:#05966920;color:#059669;border:1px solid #05966940;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700">✅ All above 80%</span>',
    onTrack>0?`<span style="background:#05966920;color:#059669;border:1px solid #05966940;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700">${onTrack} excellent</span>`:'',
  ].filter(Boolean).join('');

  // Executive grid
  const setText = (id,v,col) => { const e=document.getElementById(id); if(e){e.textContent=String(v);if(col)e.style.color=col;} };
  setText('es-aud', aud);
  setText('es-pct', avg.toFixed(1)+'%', pc);
  setText('es-pct-sub', avg>=90?'✅ Strong':avg>=80?'Needs work':'🔴 Critical');
  setText('es-err', errPerAudit.toFixed(2), errPerAudit<=0.5?'#059669':errPerAudit<=1?'#d97706':'#dc2626');
  setText('es-pts', tot, tot===0?'#059669':'#dc2626');
  setText('es-pts-sub', 'Total category errors');

  // KPI cards
  setText('k-pct', avg.toFixed(1)+'%', pc);
  const kpctA=document.getElementById('k-pct-a'); if(kpctA) kpctA.style.background=pc;
  setText('k-crit', crit, crit>0?'#dc2626':'#059669');
  setText('k-ws', tot, '#7c3aed');
  setText('k-acc', errPerAudit.toFixed(2), errPerAudit<=0.5?'#059669':errPerAudit<=1?'#d97706':'#dc2626');
  setText('k-rep', atRisk);
  setText('k-coa', HOF_filtered.filter(d=>d.pct>=80&&d.pct<90).length);
  setText('k-ok', onTrack);
  setText('k-dl', dl);
  setText('k-aud', aud); setText('k-err', tot);
  document.getElementById('dpct').textContent=avg.toFixed(0)+'%';
  setGBadge(avg);

  const CATS8=[
    {l:'Call',       v:HOF_filtered.reduce((s,d)=>s+(d.catErr_call||0),0)},
    {l:'WhatsApp',   v:HOF_filtered.reduce((s,d)=>s+(d.catErr_whatsapp||0),0)},
    {l:'Email',      v:HOF_filtered.reduce((s,d)=>s+(d.catErr_email||0),0)},
    {l:'Description',v:HOF_filtered.reduce((s,d)=>s+(d.catErr_description||0),0)},
    {l:'Lead Stage', v:HOF_filtered.reduce((s,d)=>s+(d.catErr_leadStage||0),0)},
    {l:'Deal',       v:HOF_filtered.reduce((s,d)=>s+(d.catErr_deal||0),0)},
    {l:'Task',       v:HOF_filtered.reduce((s,d)=>s+(d.catErr_task||0),0)},
    {l:'Follow Up',  v:HOF_filtered.reduce((s,d)=>s+(d.catErr_followUp||0),0)},
  ];
  const mx=Math.max(...CATS8.map(c=>c.v),1);
  const bd=document.getElementById('bd');
  if(bd) bd.innerHTML=CATS8.map(c=>`<div class="bdr"><div class="bdl">${c.l}</div><div class="bdb"><div class="bdf" style="width:${(c.v/mx*100).toFixed(0)}%"></div></div><div class="bdc">${c.v}</div></div>`).join('');
}

function hofRenderTable(data) {
  const tb = document.getElementById('tb');
  if (!data.length) {
    tb.innerHTML='<tr><td colspan="15" style="text-align:center;padding:24px;color:var(--mu)">No data for current filters.</td></tr>';
    return;
  }
  const ec = (n, catKey, d) => {
    if (n===0) return '<span style="color:#94a3b8">—</span>';
    const col = n>=3?'#dc2626':n>=1?'#d97706':'inherit';
    const links = (d.errorLinks && d.errorLinks[catKey] && d.errorLinks[catKey].length>0) ? d.errorLinks[catKey] : null;
    const safeLinks = links ? JSON.stringify(links).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;') : '[]';
    const safeName  = d.name.replace(/'/g,"\\'");
    return `<span style="color:${col};font-weight:700;cursor:pointer;border-bottom:2px dashed ${col};padding-bottom:1px"
      onclick="event.stopPropagation();showCatCaseLinkModal('${catKey}','${safeName}',${n},${safeLinks},${!!links})"
      title="${n} error(s)">${n}${links?' <span style="font-size:9px">🔗</span>':' <span style="font-size:9px;opacity:.5">↗</span>'}</span>`;
  };
  const srcBadge = s => s==='dxb'
    ? '<span style="font-size:9px;background:rgba(6,182,212,.15);color:#06b6d4;border:1px solid rgba(6,182,212,.3);padding:1px 5px;border-radius:6px;margin-left:4px">DXB</span>'
    : '<span style="font-size:9px;background:rgba(99,102,241,.12);color:#818cf8;border:1px solid rgba(99,102,241,.25);padding:1px 5px;border-radius:6px;margin-left:4px">GLB</span>';
  const sevBadge = d => {
    let b='';
    if(d.severityCritical>0) b+=`<span style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:700;display:inline-block;margin:1px">⛔${d.severityCritical}</span>`;
    if(d.severityWarning>0)  b+=`<span style="background:#fffbeb;color:#d97706;border:1px solid #fde68a;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:700;display:inline-block;margin:1px">⚠️${d.severityWarning}</span>`;
    return b||'<span style="color:#94a3b8;font-size:11px">—</span>';
  };
  tb.innerHTML = data.map(d => {
    const pc=d.pct>=90?'#059669':d.pct>=80?'#d97706':'#dc2626';
    const sl=d.pct<80?'sp-critical':d.pct<90?'sp-warning':'sp-good';
    const st=d.pct<80?'AT RISK':d.pct<90?'WATCH':'GOOD';
    const sn=d.name.replace(/'/g,"\\'");
    return `<tr onclick="trainingCardClick('${sn}')" style="cursor:pointer" title="Click for ${d.name} training detail">
      <td style="font-weight:600;color:var(--ac);white-space:nowrap">${d.name}${srcBadge(d.source)}</td>
      <td class="tm">${d.audits}</td>
      <td class="tm" style="border-left:2px solid rgba(37,99,235,.15)">${ec(d.catErr_call,'call',d)}</td>
      <td class="tm">${ec(d.catErr_whatsapp,'whatsapp',d)}</td>
      <td class="tm" style="border-left:2px solid rgba(217,119,6,.15)">${ec(d.catErr_email,'email',d)}</td>
      <td class="tm">${ec(d.catErr_description,'description',d)}</td>
      <td class="tm" style="border-left:2px solid rgba(124,58,237,.15)">${ec(d.catErr_leadStage,'leadStage',d)}</td>
      <td class="tm" style="border-left:2px solid rgba(220,38,38,.15)">${ec(d.catErr_deal,'deal',d)}</td>
      <td class="tm" style="border-left:2px solid rgba(99,102,241,.15)">${ec(d.catErr_task,'task',d)}</td>
      <td class="tm" style="border-left:2px solid rgba(8,145,178,.15)">${ec(d.catErr_followUp,'followUp',d)}</td>
      <td class="tm" style="color:${d.total>0?'#dc2626':'#059669'};font-weight:700;font-size:14px">${d.total}</td>
      <td><div class="pc"><span style="color:${pc};font-weight:700;font-family:'DM Mono',monospace;font-size:13px">${d.pct.toFixed(1)}%</span><div class="pb2"><div class="pbf" style="width:${Math.min(d.pct,100)}%;background:${pc}"></div></div></div></td>
      <td>${sevBadge(d)}</td>
      <td><span class="status-pill ${sl}">${st}</span></td>
      <td class="tm"><button onclick="event.stopPropagation();quickDownloadPDF('${sn}')" style="background:var(--s2);border:1px solid var(--b);border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px;color:var(--ac);font-weight:600">📄</button></td>
    </tr>`;
  }).join('');
}

function filterTable(q) {
  document.querySelectorAll('#tb tr').forEach(r => {
    r.style.display = (r.cells[0]?.textContent.toLowerCase()||'').includes(q.toLowerCase()) ? '' : 'none';
  });
}

function tsort(k) {
  document.querySelectorAll('thead th').forEach(th => { th.classList.remove('sort-asc','sort-desc'); });
  const th = event.currentTarget;
  if (hofTSK===k) { hofTSD*=-1; } else { hofTSK=k; hofTSD=-1; }
  th.classList.add(hofTSD===-1?'sort-desc':'sort-asc');
  HOF_filtered.sort((a,b) => k==='name' ? hofTSD*a.name.localeCompare(b.name) : hofTSD*(a[k]-b[k]));
  hofRenderTable(HOF_filtered);
}

function hofRenderSparks() {
  const el  = document.getElementById('spark-list');
  const top = HOF_filtered.slice(0,12);
  if (!top.length) { el.innerHTML='<div style="color:var(--mu);font-size:12px;padding:8px">No data</div>'; return; }
  el.innerHTML = top.map(d => {
    const months = d.trend || [];
    if (!months.length) return `<div class="spark-row"><div class="spark-name">${d.name.split(' ')[0]}</div><div style="font-size:11px;color:var(--mu);font-family:'DM Mono',monospace">No trend data</div><div class="spark-pct" style="color:${d.pct>=90?'#059669':d.pct>=80?'#d97706':'#dc2626'}">${d.pct.toFixed(0)}%</div></div>`;
    const vals = months.map(m => m.avgPct);
    const bars = vals.map(v => {
      const h = Math.max(4, Math.round((v/100)*28));
      const c = v>=90?'#059669':v>=80?'#d97706':'#dc2626';
      return `<div class="spark-bar" title="${v.toFixed(1)}%" style="height:${h}px;background:${c}"></div>`;
    }).join('');
    const last = vals[vals.length-1] || d.pct;
    const prev = vals.length >= 2 ? vals[vals.length-2] : null;
    const trend = prev !== null ? (last - prev) : 0;
    const trendStr = prev !== null
      ? (trend > 0 ? `<span style="color:#059669;font-size:10px">▲${trend.toFixed(0)}</span>`
       : trend < 0 ? `<span style="color:#dc2626;font-size:10px">▼${Math.abs(trend).toFixed(0)}</span>`
       : `<span style="color:#94a3b8;font-size:10px">→</span>`) : '';
    const pc   = last>=90?'#059669':last>=80?'#d97706':'#dc2626';
    return `<div class="spark-row">
      <div class="spark-name" title="${d.name}">${d.name.split(' ').slice(0,2).join(' ')}</div>
      <div class="spark-bars">${bars}</div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px">
        <div class="spark-pct" style="color:${pc}">${last.toFixed(0)}%</div>
        ${trendStr}
      </div>
    </div>`;
  }).join('');
}

function hofUpdateCharts() {
  const names = HOF_filtered.map(d => d.name.split(' ').slice(0,2).join(' '));
  const tots  = HOF_filtered.map(d => d.total);
  const pcts  = HOF_filtered.map(d => d.pct);
  const cbg   = HOF_filtered.map(d => d.total>15?'rgba(220,38,38,.75)':d.total>5?'rgba(217,119,6,.75)':'rgba(5,150,105,.75)');
  const cbd   = HOF_filtered.map(d => d.total>15?'#dc2626':d.total>5?'#d97706':'#059669');

  if (hofBarC)   hofBarC.destroy();
  hofBarC = new Chart(document.getElementById('bc'), {type:'bar', data:{labels:names, datasets:[
    {label:'Total Errors', data:tots, backgroundColor:cbg, borderColor:cbd, borderWidth:1, borderRadius:4, yAxisID:'y'},
    {label:'Compliance %', data:pcts, type:'line', borderColor:'#7c3aed', backgroundColor:'rgba(124,58,237,.07)', borderWidth:2, fill:true, tension:.4, pointRadius:3, pointBackgroundColor:'#7c3aed', yAxisID:'y2'}
  ]}, options:{responsive:true, maintainAspectRatio:false,
    plugins:{legend:{labels:{color:'#475569',font:{family:'DM Mono',size:11}}}},
    scales:{
      x:{ticks:{color:'#64748b',font:{family:'DM Mono',size:10},auditsRotation:40},grid:{color:'rgba(0,0,0,.04)'}},
      y:{ticks:{color:'#64748b',font:{family:'DM Mono',size:10}},grid:{color:'rgba(0,0,0,.04)'},title:{display:true,text:'Errors',color:'#94a3b8',font:{family:'DM Mono',size:10}}},
      y2:{position:'right',min:0,audits:100,ticks:{color:'#7c3aed',font:{family:'DM Mono',size:10},callback:v=>v+'%'},grid:{display:false},title:{display:true,text:'Compliance %',color:'#7c3aed',font:{family:'DM Mono',size:10}}}
    }
  }});

  const avg = HOF_filtered.length ? HOF_filtered.reduce((s,d)=>s+d.pct,0)/HOF_filtered.length : 0;
  const dc  = avg>=90?'#059669':avg>=80?'#d97706':'#dc2626';
  if (hofDonutC) hofDonutC.destroy();
  hofDonutC = new Chart(document.getElementById('dc'), {type:'doughnut', data:{datasets:[{data:[avg,100-avg], backgroundColor:[dc,'#f1f5f9'], borderWidth:0, hoverOffset:0}]},
    options:{responsive:false, cutout:'72%', plugins:{legend:{display:false}, tooltip:{enabled:false}}}});

  // ── Category Skill Gap Radar ─────────────────────────────────────────────
  // Each category: [errorFieldKeys, auditsPtsPerAudit]
  // Points earned = audits - (errors * penalty). % = earned/audits * 100
  const CAT_DEF = [
    { label:'Outcome',    fields:['outcome'],                                                     auditsPts:10,
      detail:['Outcome Recorded'] },
    { label:'Call',       fields:['firstContact','firstCall','callLogged','callDesc'],             auditsPts:15,
      detail:['1st Contact','1st Call','Call Logged','Call Desc'] },
    { label:'Lead Stage', fields:['leadStage','correctStage','qualifiedMark'],                   auditsPts:15,
      detail:['Lead Stage Upd','Correct Stage','Qualified Mark'] },
    { label:'Deal',       fields:['deal','pipeline','timeline','properties'],                    auditsPts:30,
      detail:['Deal Created','Pipeline','Timeline','Properties'] },
    { label:'Email',      fields:['emailSent','emailHub','profTone','signature'],                auditsPts:12,
      detail:['Email Sent','Email via Hub','Prof Tone','Signature'] },
    { label:'WhatsApp',   fields:['waUsed','waLogged','waNote'],                                 auditsPts:12,
      detail:['WA Used','WA Logged','WA Note'] },
    { label:'Task',       fields:['taskCreated','taskDone','taskType'],                          auditsPts:6,
      detail:['Task Created','Task Done','Task Type'] },
  ];

  const totalAudits = HOF_filtered.reduce((s,d)=>s+d.audits,0) || 1;
  const wFields = ['catErr_outcome','catErr_call','catErr_leadStage','catErr_deal','catErr_email','catErr_whatsapp','catErr_task'];

  const radarVals = CAT_DEF.map((cat,i) => {
    const catErrField = wFields[i];
    const totalErrors = HOF_filtered.reduce((s,d)=>s+(d[catErrField]||0),0);
    const totalAud    = HOF_filtered.reduce((s,d)=>s+d.audits,0) || 1;
    // % of audits that PASSED this category
    const passRate = Math.round(((totalAud - totalErrors) / totalAud) * 100);
    return Math.max(0, Math.min(100, passRate));
  });

  if (hofRadarC) hofRadarC.destroy();
  hofRadarC = new Chart(document.getElementById('rc2'), {
    type:'radar',
    data:{ labels: CAT_DEF.map(c=>c.label),
      datasets:[{ data:radarVals, backgroundColor:'rgba(37,99,235,.12)', borderColor:'#2563eb',
        borderWidth:2, pointBackgroundColor:'#2563eb', pointRadius:4,
        pointHoverBackgroundColor:'#fff', pointHoverBorderColor:'#2563eb' }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label: ctx => ctx.parsed.r+'% earned' }}},
      scales:{ r:{ min:0, audits:100,
        ticks:{stepSize:25, color:'#94a3b8', font:{family:'DM Mono',size:9}, backdropColor:'transparent'},
        grid:{color:'rgba(0,0,0,.06)'},
        pointLabels:{color:'#475569', font:{family:'DM Mono',size:10}},
        angleLines:{color:'rgba(0,0,0,.06)'}}}}});

  // ── Category Horizontal Bar Chart (Team Training Targets) ─────────────────
  const catLabels   = CAT_DEF.map(c=>c.label);
  const totalAuds   = HOF_filtered.reduce((s,d)=>s+d.audits,0) || 1;
  const catMaxPts   = CAT_DEF.map(() => totalAuds); // max = total audits (each audit can fail once)
  const catPtsLost  = [
    HOF_filtered.reduce((s,d)=>s+(d.catErr_outcome||0),0),
    HOF_filtered.reduce((s,d)=>s+(d.catErr_call||0),0),
    HOF_filtered.reduce((s,d)=>s+(d.catErr_leadStage||0),0),
    HOF_filtered.reduce((s,d)=>s+(d.catErr_deal||0),0),
    HOF_filtered.reduce((s,d)=>s+(d.catErr_email||0),0),
    HOF_filtered.reduce((s,d)=>s+(d.catErr_whatsapp||0),0),
    HOF_filtered.reduce((s,d)=>s+(d.catErr_task||0),0),
  ];
  const catPctLost = catPtsLost.map((v,i) => {
    return totalAuds > 0 ? Math.round((v/totalAuds)*100) : 0;
  });
  const catColors = catPctLost.map(v => v>=50?'rgba(220,38,38,.85)':v>=25?'rgba(217,119,6,.85)':'rgba(5,150,105,.85)');

  if (window.hofCatBarC) window.hofCatBarC.destroy();
  const catBarEl = document.getElementById('catBar');
  if (catBarEl) {
    window.hofCatBarC = new Chart(catBarEl, {
      type:'bar',
      data:{ labels:catLabels,
        datasets:[
          { label:'% of Points Lost', data:catPctLost, backgroundColor:catColors, borderRadius:4, barThickness:32 },
          { label:'Points Lost', data:catPtsLost, backgroundColor:'rgba(0,0,0,0)', borderWidth:0, barThickness:0 }
        ]},
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false},
          tooltip:{ callbacks:{ label: (ctx) => {
            if(ctx.datasetIndex===0) return ctx.parsed.x+'% errors per audit ('+catPtsLost[ctx.dataIndex]+' pts)';
            return '';
          }}}},
        scales:{
          x:{ min:0, audits:100, ticks:{color:'#64748b',font:{family:'DM Mono',size:10},callback:v=>v+'%'},
            grid:{color:'rgba(0,0,0,.04)'},
            title:{display:true,text:'% of Max Points Lost per Category',color:'#94a3b8',font:{family:'DM Mono',size:10}}},
          y:{ ticks:{color:'#475569',font:{family:'DM Mono',size:12,weight:'600'}}, grid:{display:false}}
        }}});
  }
}

// ── Agent Deep Dive Radar ────────────────────────────────────────────────────
var agentRadarInst = null;

function showAgentRadar(name) {
  const d = HOF_ALL.find(x => x.name === name);
  if (!d) return;

  const CAT_DEF = [
    { label:'Outcome',    fields:['outcome'],                                                     auditsPts:10,
      detail:['Outcome Recorded'],                                                color:'#e11d48' },
    { label:'Call',       fields:['firstContact','firstCall','callLogged','callDesc'],             auditsPts:15,
      detail:['1st Contact','1st Call','Call Logged','Call Desc'],        color:'#2563eb' },
    { label:'Lead Stage', fields:['leadStage','correctStage','qualifiedMark'],                   auditsPts:15,
      detail:['Lead Stage Upd','Correct Stage','Qualified Mark'],                   color:'#7c3aed' },
    { label:'Deal',       fields:['deal','pipeline','timeline','properties'],                    auditsPts:30,
      detail:['Deal Created','Pipeline','Timeline','Properties'],                   color:'#dc2626' },
    { label:'Email',      fields:['emailSent','emailHub','profTone','signature'],                auditsPts:12,
      detail:['Email Sent','Email via Hub','Prof Tone','Signature'],                color:'#d97706' },
    { label:'WhatsApp',   fields:['waUsed','waLogged','waNote'],                                 auditsPts:12,
      detail:['WA Used','WA Logged','WA Note'],                                    color:'#059669' },
    { label:'Task',       fields:['taskCreated','taskDone','taskType'],                          auditsPts:6,
      detail:['Task Created','Task Done','Task Type'],                              color:'#6366f1' },
  ];

  const audits = d.audits || 1;
  const vals   = CAT_DEF.map(cat => {
    const errors  = cat.fields.reduce((s,f)=>s+(d[f]||0),0);
    const auditsTotal = cat.auditsPts * audits;
    const lostPts  = errors * (cat.auditsPts / cat.fields.length) * 0.9;
    const earned   = auditsTotal;
    return Math.min(100, Math.round((earned/auditsTotal)*100));
  });

  document.getElementById('agentRadarTitle').textContent = name + ' — Skill Gap Analysis';
  document.getElementById('agentRadarCard').style.display = 'block';
  document.getElementById('agentRadarCard').scrollIntoView({behavior:'smooth', block:'nearest'});

  // Category table
  const tableEl = document.getElementById('agentCatTable');
  tableEl.innerHTML = CAT_DEF.map((cat,i) => {
    const pct    = vals[i];
    const col    = pct>=80?'#059669':pct>=60?'#d97706':'#dc2626';
    const totErr = cat.fields.reduce((s,f)=>s+(d[f]||0),0);
    // Sub-breakdown of each attribute
    const subs = cat.fields.map((f,fi) => {
      const cnt = d[f]||0;
      return cnt>0 ? `<span style="font-size:10px;color:#dc2626;font-family:'DM Mono',monospace">${cat.detail[fi]}:${cnt}</span>` : '';
    }).filter(Boolean).join(' &nbsp;');
    return `<div style="margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:82px;font-size:12px;font-weight:700;color:${cat.color}">${cat.label}</div>
        <div style="flex:1;height:7px;background:#f1f5f9;border-radius:4px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${col};border-radius:4px"></div>
        </div>
        <div style="width:36px;text-align:right;font-size:12px;font-weight:700;color:${col};font-family:'DM Mono',monospace">${pct}%</div>
        <div style="width:44px;font-size:11px;color:var(--mu);text-align:right">${totErr} err</div>
      </div>
      ${subs ? `<div style="padding-left:90px;margin-top:2px;display:flex;flex-wrap:wrap;gap:4px">${subs}</div>` : ''}
    </div>`;
  }).join('');

  if (agentRadarInst) agentRadarInst.destroy();
  agentRadarInst = new Chart(document.getElementById('agentRadar'), {
    type:'radar',
    data:{ labels: CAT_DEF.map(c=>c.label),
      datasets:[
        { label:name, data:vals,
          backgroundColor:'rgba(37,99,235,.12)', borderColor:'#2563eb',
          borderWidth:2, pointBackgroundColor:'#2563eb', pointRadius:5 },
        { label:'Target (80%)', data:[80,80,80,80,80,80],
          backgroundColor:'rgba(5,150,105,.05)', borderColor:'rgba(5,150,105,.4)',
          borderWidth:1, borderDash:[4,4], pointRadius:0 }
      ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:true, position:'bottom',
          labels:{font:{family:'DM Mono',size:10}, color:'#64748b'}},
        tooltip:{ callbacks:{ label: ctx => ctx.dataset.label+': '+ctx.parsed.r+'%' }}},
      scales:{ r:{ min:0, audits:100,
        ticks:{stepSize:20,color:'#94a3b8',font:{family:'DM Mono',size:9},backdropColor:'transparent'},
        grid:{color:'rgba(0,0,0,.06)'},
        pointLabels:{color:'#475569',font:{family:'DM Mono',size:11,weight:'600'}},
        angleLines:{color:'rgba(0,0,0,.06)'}}}
    }
  });
}

function closeAgentRadar() {
  document.getElementById('agentRadarCard').style.display = 'none';
  if (agentRadarInst) { agentRadarInst.destroy(); agentRadarInst = null; }
}

// Auto-close radar when filters change
function resetAgentRadar() {
  closeAgentRadar();
}

// ── Training Focus Panel (now dropdown-driven) ──────────────────────────────
function showTrainingForConsultant(name) {
  const detail=document.getElementById('trainingDetail');
  if (!detail) return;
  if (!name) { detail.innerHTML=''; return; }
  const d=HOF_filtered.find(x=>x.name===name)||HOF_ALL.find(x=>x.name===name);
  if (!d) { detail.innerHTML=`<div style="color:var(--mu);padding:14px">No data for ${name}</div>`; return; }
  const CATS=[
    {key:'catErr_call',        label:'📞 Call',        col:'#2563eb',link:'call'},
    {key:'catErr_whatsapp',    label:'💬 WhatsApp',    col:'#059669',link:'whatsapp'},
    {key:'catErr_email',       label:'📧 Email',       col:'#d97706',link:'email'},
    {key:'catErr_description', label:'📝 Description', col:'#64748b',link:'description'},
    {key:'catErr_leadStage',   label:'🎯 Lead Stage',  col:'#7c3aed',link:'leadStage'},
    {key:'catErr_deal',        label:'💼 Deal',        col:'#dc2626',link:'deal'},
    {key:'catErr_task',        label:'✅ Task',        col:'#6366f1',link:'task'},
    {key:'catErr_followUp',    label:'⏱️ Follow Up',   col:'#0891b2',link:'followUp'},
  ];
  const pct=d.pct||0;
  const pc=pct>=90?'#059669':pct>=80?'#d97706':'#dc2626';
  const er=d.audits>0?(d.total/d.audits).toFixed(2):'0';
  let html=`<div style="background:${pc}10;border:1.5px solid ${pc}30;border-radius:14px;padding:16px 20px;margin-bottom:12px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <div style="text-align:center;min-width:80px">
      <div style="font-size:9px;color:var(--mu);font-family:'DM Mono',monospace;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Compliance</div>
      <div style="font-size:36px;font-weight:900;color:${pc};font-family:'Nunito',sans-serif;line-height:1">${pct.toFixed(1)}%</div>
    </div>
    <div style="width:1px;height:50px;background:${pc}30;flex-shrink:0"></div>
    <div style="flex:1;min-width:180px">
      <div style="font-size:15px;font-weight:800;color:var(--tx)">${d.name}</div>
      <div style="font-size:11px;color:var(--mu);margin-top:3px">${d.audits} audits · ${d.total} errors · ${er}/audit</div>
      <div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap">
        ${d.severityCritical>0?`<span style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700">⛔ ${d.severityCritical} Critical</span>`:''}
        ${d.severityWarning>0?`<span style="background:#fffbeb;color:#d97706;border:1px solid #fde68a;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700">⚠️ ${d.severityWarning} Warning</span>`:''}
        ${d.source==='dxb'?'<span style="background:rgba(6,182,212,.1);color:#06b6d4;border:1px solid rgba(6,182,212,.3);padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700">DXB</span>':'<span style="background:rgba(99,102,241,.1);color:#818cf8;border:1px solid rgba(99,102,241,.25);padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700">Global</span>'}
      </div>
    </div>
    <button onclick="closeTrainingDetail()" style="background:var(--b);border:1px solid var(--b2);color:var(--mu);border-radius:8px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:700;flex-shrink:0">✕ Close</button>
  </div>`;
  const hasErrors=CATS.some(c=>(d[c.key]||0)>0);
  if (!hasErrors) {
    html+=`<div style="background:#f0fdf4;border:1.5px solid #a7f3d0;border-radius:14px;padding:20px;text-align:center;margin-bottom:12px">
      <div style="font-size:22px;margin-bottom:6px">🎉</div>
      <div style="font-size:14px;font-weight:800;color:#059669">Zero errors this period!</div>
    </div>`;
  } else {
    const sc=CATS.slice().sort((a,b)=>(d[b.key]||0)-(d[a.key]||0));
    html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:12px">';
    sc.forEach(cat=>{
      const count=d[cat.key]||0;
      const pr=d.audits>0?Math.round(((d.audits-count)/d.audits)*100):100;
      const links=(d.errorLinks&&d.errorLinks[cat.link])?d.errorLinks[cat.link]:[];
      const ue=[...new Set(links.map(l=>l.errorText).filter(Boolean))];
      if (count===0) {
        html+=`<div style="background:rgba(5,150,105,.06);border:1.5px solid rgba(5,150,105,.2);border-radius:12px;padding:12px;display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">${cat.label.split(' ')[0]}</span>
          <div><div style="font-size:12px;font-weight:700;color:#059669">${cat.label.substring(cat.label.indexOf(' ')+1)}</div>
          <div style="font-size:10px;color:#059669">✅ 100% pass</div></div></div>`;
      } else {
        const sn=d.name.replace(/'/g,"\\'");
        const sl=JSON.stringify(links).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const cl=cat.link.charAt(0).toUpperCase()+cat.link.slice(1);
        html+=`<div style="background:var(--w);border:1.5px solid ${cat.col}30;border-left:4px solid ${cat.col};border-radius:12px;padding:13px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:7px">
            <div style="font-size:12px;font-weight:800;color:var(--tx)">${cat.label}</div>
            <div style="display:flex;align-items:center;gap:5px">
              ${links.length>0?`<button onclick="event.stopPropagation();showCatCaseLinkModal('${cl}','${sn}',${count},${sl},true)" style="background:${cat.col};color:#fff;border:none;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:10px;font-weight:700">🔗 ${links.length}</button>`:''}
              <span style="font-family:'DM Mono',monospace;font-size:16px;font-weight:900;color:${cat.col}">${count}×</span>
            </div>
          </div>
          <div style="height:5px;background:var(--b);border-radius:3px;overflow:hidden;margin-bottom:7px"><div style="width:${pr}%;height:100%;background:${cat.col};border-radius:3px"></div></div>
          <div style="font-size:10px;color:var(--mu);margin-bottom:6px">${pr}% pass · ${count}/${d.audits} failed</div>
          ${ue.length>0?`<div style="display:flex;flex-direction:column;gap:3px">${ue.slice(0,4).map(e=>`<div style="font-size:11px;color:var(--t2);display:flex;gap:5px"><span style="color:${cat.col};flex-shrink:0">→</span><span>${e}</span></div>`).join('')}${ue.length>4?`<div style="font-size:10px;color:var(--mu)">+${ue.length-4} more…</div>`:''}</div>`:''}
        </div>`;
      }
    });
    html+='</div>';
  }
  const months=d.trend||[];
  if (months.length>1) {
    const last=months[months.length-1],prev=months[months.length-2];
    const delta=(last.avgPct-prev.avgPct).toFixed(1);
    const arrow=parseFloat(delta)>0?'▲':parseFloat(delta)<0?'▼':'→';
    const ac=parseFloat(delta)>0?'#059669':parseFloat(delta)<0?'#dc2626':'#64748b';
    html+=`<div style="background:var(--s2);border:1px solid var(--b);border-radius:12px;padding:13px 16px">
      <div style="font-size:10px;font-weight:700;color:var(--mu);font-family:'DM Mono',monospace;letter-spacing:1px;margin-bottom:8px">📈 MONTHLY TREND</div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">
        ${months.map(m=>{const mc=m.avgPct>=90?'#059669':m.avgPct>=80?'#d97706':'#dc2626';return `<div style="text-align:center;min-width:44px"><div style="height:36px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:3px"><div style="width:24px;border-radius:3px 3px 0 0;background:${mc};height:${Math.max(4,Math.round(m.avgPct*.36))}px;opacity:.8"></div></div><div style="font-size:9px;font-weight:700;color:${mc}">${m.avgPct.toFixed(0)}%</div><div style="font-size:8px;color:var(--mu);font-family:'DM Mono',monospace">${m.month}</div></div>`;}).join('')}
      </div>
      <div style="font-size:11px;color:${ac};font-weight:700;margin-top:6px;font-family:'DM Mono',monospace">${arrow} ${Math.abs(delta)}% vs ${prev.month}</div>
    </div>`;
  }
  detail.innerHTML=html;
}

// ── Training Focus Panel (legacy — now shows prompt to use dropdown) ──────────
function renderTrainingPanel() {
  const panel=document.getElementById('trainingPanel');
  const sel=document.getElementById('trainingConsultantSel');
  if (!panel||!HOF_filtered.length) return;
  if (sel) sel.innerHTML='<option value="">— Select a Consultant —</option>'+HOF_filtered.map(d=>`<option value="${d.name}">${d.name}</option>`).join('');
  const CATS=['catErr_call','catErr_whatsapp','catErr_email','catErr_description','catErr_leadStage','catErr_deal','catErr_task','catErr_followUp'];
  const ICONS=['📞','💬','📧','📝','🎯','💼','✅','⏱️'];
  const COLS=['#2563eb','#059669','#d97706','#64748b','#7c3aed','#dc2626','#6366f1','#0891b2'];
  const sorted=HOF_filtered.slice().sort((a,b)=>b.total-a.total);
  panel.innerHTML=sorted.map(d=>{
    const pc=d.pct>=90?'#059669':d.pct>=80?'#d97706':'#dc2626';
    const pl=d.pct>=90?'rgba(5,150,105,.08)':d.pct>=80?'rgba(217,119,6,.08)':'rgba(220,38,38,.06)';
    const pb=d.pct>=90?'rgba(5,150,105,.25)':d.pct>=80?'rgba(217,119,6,.25)':'rgba(220,38,38,.2)';
    const sn=d.name.replace(/'/g,"\\'");
    const er=d.audits>0?(d.total/d.audits).toFixed(1):'0';
    let wk='',wv=0; CATS.forEach((k,i)=>{if((d[k]||0)>wv){wv=d[k];wk=ICONS[i];}});
    const sb=d.source==='dxb'
      ?'<span style="font-size:9px;background:rgba(6,182,212,.15);color:#06b6d4;border:1px solid rgba(6,182,212,.3);padding:1px 5px;border-radius:6px">DXB</span>'
      :'<span style="font-size:9px;background:rgba(99,102,241,.12);color:#818cf8;border:1px solid rgba(99,102,241,.25);padding:1px 5px;border-radius:6px">GLB</span>';
    return `<div id="tc-card-${d.name.replace(/\s+/g,'-')}" onclick="trainingCardClick('${sn}')"
      style="background:${pl};border:1.5px solid ${pb};border-radius:14px;padding:14px;cursor:pointer;transition:all .18s"
      onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 20px rgba(0,0,0,.1)'"
      onmouseleave="this.style.transform='';this.style.boxShadow=''">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:8px">
        <div style="font-size:13px;font-weight:800;color:var(--tx);line-height:1.2">${d.name}</div>${sb}
      </div>
      <div style="font-size:26px;font-weight:900;color:${pc};font-family:'DM Mono',monospace;line-height:1;margin-bottom:5px">${d.pct.toFixed(1)}%</div>
      <div style="font-size:10px;color:var(--mu);font-family:'DM Mono',monospace;margin-bottom:8px">${d.audits} audits · ${er} err/audit${wk?' · worst: '+wk:''}</div>
      <div style="display:flex;gap:2px;height:4px;border-radius:2px;overflow:hidden">
        ${CATS.map((k,i)=>{const v=d[k]||0;const w=d.audits>0?Math.min(Math.round((v/d.audits)*100),100):0;return `<div style="flex:1;background:${w>0?COLS[i]:'var(--b)'};opacity:${w>0?'1':'.3'}" title="${k}:${v}"></div>`;}).join('')}
      </div>
      <div style="font-size:10px;color:var(--mu);margin-top:6px;font-family:'DM Mono',monospace">🔍 click to drill down</div>
    </div>`;
  }).join('')||'<div style="color:var(--mu);font-size:13px;grid-column:1/-1;text-align:center;padding:20px">No data</div>';
  const s2=document.getElementById('trainingConsultantSel');
  if(s2&&s2.value) highlightTrainingCard(s2.value);
}



// ══════════════════════════════════════════════════════════════════════════════
// PERSONAL SCORECARD — shown when single consultant selected
// ══════════════════════════════════════════════════════════════════════════════
var pcTrendChart = null;

function togglePersonalView(singleAgent) {
  const card    = document.getElementById('personalCard');
  const exec    = document.getElementById('execSummary');
  const kpiRow  = document.querySelector('.kg');
  if (!card) return;

  if (singleAgent) {
    card.style.display = 'block';
    if (exec) exec.style.display = 'none';
    if (kpiRow) kpiRow.style.display = 'none';
    renderPersonalCard(singleAgent);
  } else {
    card.style.display = 'none';
    if (exec) exec.style.display = 'block';
    if (kpiRow) kpiRow.style.display = '';
  }
}

function renderPersonalCard(d) {
  if (!d) return;

  const pc = d.pct>=90?'#059669':d.pct>=80?'#d97706':'#dc2626';
  const errRate = d.audits>0?(d.total/d.audits).toFixed(2):0;

  // Header
  document.getElementById('pc-name').textContent  = d.name;
  document.getElementById('pc-pct').textContent   = d.pct.toFixed(1)+'%';
  document.getElementById('pc-aud').textContent   = d.audits;
  document.getElementById('pc-err').textContent   = d.total;
  document.getElementById('pc-err-rate').textContent = errRate+' errors/audit';

  // Rank in team
  const allSorted = HOF_ALL.slice().sort((a,b)=>b.pct-a.pct);
  const rank = allSorted.findIndex(x=>x.name===d.name)+1;
  document.getElementById('pc-rank').textContent = '#'+rank;
  document.getElementById('pc-rank-sub').textContent = 'of '+HOF_ALL.length+' agents';

  // Trend vs last month
  const months = d.trend||[];
  if (months.length>=2) {
    const last  = months[months.length-1].avgPct;
    const prev  = months[months.length-2].avgPct;
    const delta = last-prev;
    const arr   = delta>0?'▲':delta<0?'▼':'→';
    const col   = delta>0?'#6ee7b7':delta<0?'#fca5a5':'#94a3b8';
    document.getElementById('pc-pct-trend').innerHTML =
      `<span style="color:${col}">${arr} ${Math.abs(delta).toFixed(1)}% vs last month</span>`;
  } else {
    document.getElementById('pc-pct-trend').textContent = 'First month of data';
  }

  // Sub status
  const status = d.pct>=90?'Excellent — keep it up!'
    :d.pct>=80?'Good but room to improve'
    :'🔴 Needs immediate attention';
  document.getElementById('pc-sub').textContent = status+' · '+d.audits+' audits this period';

  // Category scores
  const CATS = [
    {name:'📋 Outcome',   catErr:d.catErr_outcome||0,   col:'#e11d48', errors:[d.outcome],                                      attrs:['Outcome Recorded']},
    {name:'📞 Call',      catErr:d.catErr_call||0,      col:'#2563eb', errors:[d.firstContact,d.firstCall,d.callLogged,d.callDesc], attrs:['1st Contact','1st Call','Call Logged','Call Desc']},
    {name:'🎯 Lead Stage',catErr:d.catErr_leadStage||0, col:'#7c3aed', errors:[d.leadStage,d.correctStage,d.qualifiedMark],          attrs:['Lead Stage','Correct Stage','Qualified Mark']},
    {name:'💼 Deal',      catErr:d.catErr_deal||0,      col:'#dc2626', errors:[d.deal,d.pipeline,d.timeline,d.properties],           attrs:['Deal Created','Pipeline','Timeline','Properties']},
    {name:'📧 Email',     catErr:d.catErr_email||0,     col:'#d97706', errors:[d.emailSent,d.emailHub,d.profTone,d.signature],       attrs:['Email Sent','Email via Hub','Prof Tone','Signature']},
    {name:'💬 WhatsApp',  catErr:d.catErr_whatsapp||0,  col:'#059669', errors:[d.waUsed,d.waLogged,d.waNote],                        attrs:['WA Used','WA Logged','WA Note']},
    {name:'✅ Task',      catErr:d.catErr_task||0,       col:'#6366f1', errors:[d.taskCreated,d.taskDone,d.taskType],                 attrs:['Task Created','Task Done','Task Type']},
  ];

  const catScores = CATS.map(c => ({
    ...c,
    score: d.audits>0 ? Math.max(0,Math.round(((d.audits-c.catErr)/d.audits)*100)) : 100
  }));

  // Category-to-field mapping for personal scorecard click links
  const CAT_FIELD_MAP = {
    '📋 Outcome':   'outcome',
    '📞 Call':      'call',
    '🎯 Lead Stage':'leadStage',
    '💼 Deal':      'deal',
    '📧 Email':     'email',
    '💬 WhatsApp':  'whatsapp',
    '✅ Task':      'task',
  };

  const cats = document.getElementById('pc-cats');
  if (cats) {
    cats.innerHTML = catScores.map(c => {
      const cc = c.score>=90?'#059669':c.score>=70?'#d97706':'#dc2626';
      const errList = c.errors.map((n,i)=>n>0?`<span style="font-size:10px;color:#dc2626">${c.attrs[i]}: ${n}x</span>`:'').filter(Boolean).join(' · ');
      // Build clickable case link button for this category
      const catKey = CAT_FIELD_MAP[c.name] || '';
      const subFields = CAT_SUBFIELDS[catKey] || [];
      const catLinks = [];
      if (d.errorLinks && subFields.length) {
        subFields.forEach(function(f) {
          if (d.errorLinks[f] && d.errorLinks[f].length) {
            d.errorLinks[f].forEach(function(lnk) {
              catLinks.push(Object.assign({}, typeof lnk==='string'?{url:lnk}:lnk, {_attr:HOF_FIELD_NAMES[f]||f}));
            });
          }
        });
      }
      const hasLinks = catLinks.length > 0;
      const safeLinks = hasLinks ? JSON.stringify(catLinks).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;') : '[]';
      const safeName  = d.name.replace(/'/g,"\\'");
      const catLabel  = c.name.replace(/[^\w\s]/gu,'').trim();
      const clickable = c.catErr > 0;
      return `<div style="background:var(--s2);border-radius:12px;padding:14px;border-left:4px solid ${c.col}${clickable?';cursor:pointer':''}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:12px;font-weight:700;color:var(--tx)">${c.name}</span>
          <div style="display:flex;align-items:center;gap:8px">
            ${clickable ? `<button onclick="event.stopPropagation();showCatCaseLinkModal('${catLabel}','${safeName}',${c.catErr},${safeLinks},${hasLinks})"
              style="background:${hasLinks?'linear-gradient(135deg,#2563eb,#1d4ed8)':'var(--b)'};color:${hasLinks?'#fff':'var(--mu)'};border:none;border-radius:6px;padding:4px 9px;cursor:pointer;font-size:10px;font-weight:700;display:flex;align-items:center;gap:3px;box-shadow:${hasLinks?'0 1px 5px rgba(37,99,235,.3)':'none'}"
              title="${hasLinks?'View '+catLinks.length+' case link(s)':'Case links — refresh to load'}">
              ${hasLinks?'🔗':'↗'} ${c.catErr}x
            </button>` : ''}
            <span style="font-family:'DM Mono',monospace;font-size:16px;font-weight:800;color:${cc}">${c.score}%</span>
          </div>
        </div>
        <div style="height:6px;background:var(--b);border-radius:3px;overflow:hidden;margin-bottom:6px">
          <div style="width:${c.score}%;height:100%;background:${cc};border-radius:3px;transition:width .5s"></div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${errList||'<span style="font-size:10px;color:#059669">✅ No errors</span>'}</div>
      </div>`;
    }).join('');
  }

  // Top 3 coaching items — highest impact errors
  const ATTRS = [
    {name:'1st Contact',    field:'firstContact', pts:4,  cat:'Call'},
    {name:'1st Call Made',  field:'firstCall',    pts:4,  cat:'Call'},
    {name:'Call Logged',    field:'callLogged',   pts:4,  cat:'Call'},
    {name:'Outcome',        field:'outcome',      pts:4,  cat:'Call'},
    {name:'Call Desc',      field:'callDesc',     pts:4,  cat:'Call'},
    {name:'Lead Stage Upd', field:'leadStage',    pts:5,  cat:'Lead Stage'},
    {name:'Correct Stage',  field:'correctStage', pts:5,  cat:'Lead Stage'},
    {name:'Qualified Mark', field:'qualifiedMark',pts:5,  cat:'Lead Stage'},
    {name:'Deal Created',   field:'deal',         pts:8,  cat:'Deal'},
    {name:'Pipeline',       field:'pipeline',     pts:8,  cat:'Deal'},
    {name:'Timeline',       field:'timeline',     pts:8,  cat:'Deal'},
    {name:'Properties',     field:'properties',   pts:8,  cat:'Deal'},
    {name:'Email Sent',     field:'emailSent',    pts:3,  cat:'Email'},
    {name:'Email via Hub',  field:'emailHub',     pts:3,  cat:'Email'},
    {name:'Prof Tone',      field:'profTone',     pts:3,  cat:'Email'},
    {name:'Signature',      field:'signature',    pts:3,  cat:'Email'},
    {name:'WA Used',        field:'waUsed',       pts:4,  cat:'WhatsApp'},
    {name:'WA Logged',      field:'waLogged',     pts:4,  cat:'WhatsApp'},
    {name:'WA Note',        field:'waNote',       pts:4,  cat:'WhatsApp'},
    {name:'Task Created',   field:'taskCreated',  pts:3,  cat:'Task'},
    {name:'Task Done',      field:'taskDone',     pts:3,  cat:'Task'},
    {name:'Task Type',      field:'taskType',     pts:3,  cat:'Task'},
  ];

  const ranked = ATTRS
    .map(a=>({...a, count:d[a.field]||0, impact:(d[a.field]||0)*a.pts}))
    .filter(a=>a.count>0)
    .sort((a,b)=>b.impact-a.impact);

  const good = ATTRS.filter(a=>(d[a.field]||0)===0).slice(0,5);
  const bad  = ranked.slice(0,5);
  const top3 = ranked.slice(0,3);

  // Coaching card — Top 3 Things to Fix (clickable with case links)
  const cEl = document.getElementById('pc-coaching');
  if (cEl) {
    if (!top3.length) {
      cEl.innerHTML = '<div style="color:#059669;font-weight:700;font-size:14px">🎉 No errors this period! Keep it up!</div>';
    } else {
      cEl.innerHTML = top3.map((a,i)=>{
        const tips = {
          'Deal Created':'Always create a deal when lead is qualified',
          'Task Created':'Create a follow-up task after every call',
          'Outcome':'Always log the call outcome in HubSpot',
          'Call Logged':'Every call must be logged in HubSpot',
          'Lead Stage Upd':'Update lead stage after every interaction',
          'Email Sent':'Send required emails within 24h',
          'WA Used':'Log WhatsApp interactions in HubSpot',
          'Prof Tone':'Keep emails professional, no casual language',
          'Pipeline':'Assign correct pipeline when creating deals',
          'Properties':'Fill all required properties before moving stage',
        };
        const tip = tips[a.name]||'Review SOP for '+a.cat+' category';
        // Build case link button if links are available
        const links = (d.errorLinks && d.errorLinks[a.field] && d.errorLinks[a.field].length > 0)
          ? d.errorLinks[a.field] : null;
        const hasLinks = !!links;
        const safeLinks = links ? JSON.stringify(links).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;') : '[]';
        const safeName  = d.name.replace(/'/g,"\\'");
        const safeField = a.field;
        const borderCol = i===0?'#dc2626':i===1?'#d97706':'#f59e0b';
        return `<div style="background:var(--s2);border-radius:10px;padding:12px;border-left:3px solid ${borderCol}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700;color:var(--tx)">${i+1}. ${a.name} <span style="color:var(--mu);font-weight:400">(${a.cat})</span></div>
              <div style="font-size:11px;color:var(--mu);margin-top:3px">💡 ${tip}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">
              <div style="text-align:right">
                <div style="font-family:'DM Mono',monospace;font-size:13px;font-weight:700;color:#dc2626">${a.count}x</div>
                <div style="font-size:10px;color:var(--mu)">-${a.impact}pts</div>
              </div>
              <button onclick="event.stopPropagation();showCaseLinkModal('${safeField}','${safeName}',${a.count},${safeLinks},${hasLinks})"
                style="background:${hasLinks?'linear-gradient(135deg,#2563eb,#1d4ed8)':'var(--b)'};color:${hasLinks?'#fff':'var(--mu)'};border:none;border-radius:7px;padding:5px 10px;cursor:pointer;font-size:10px;font-weight:700;display:flex;align-items:center;gap:4px;white-space:nowrap;box-shadow:${hasLinks?'0 2px 6px rgba(37,99,235,.3)':'none'}"
                title="${hasLinks?'View '+a.count+' case link(s)':'Case links not loaded yet'}">
                ${hasLinks?'<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Cases':'↗ Cases'}
              </button>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Good / Bad lists — bad list now clickable
  const gEl = document.getElementById('pc-good');
  const bEl = document.getElementById('pc-bad');
  if (gEl) gEl.innerHTML = good.slice(0,5).map(a=>`<div style="font-size:12px;color:#059669;display:flex;align-items:center;gap:6px"><span>✅</span><span>${a.name} <span style="color:var(--mu)">(${a.cat})</span></span></div>`).join('');
  if (bEl) bEl.innerHTML = bad.map(a=>{
    const links = (d.errorLinks && d.errorLinks[a.field] && d.errorLinks[a.field].length > 0)
      ? d.errorLinks[a.field] : null;
    const hasLinks = !!links;
    const safeLinks = links ? JSON.stringify(links).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;') : '[]';
    const safeName  = d.name.replace(/'/g,"\\'");
    return `<div style="font-size:12px;color:#dc2626;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0">
      <span>❌ ${a.name} <span style="color:var(--mu);font-size:11px">(${a.cat})</span></span>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <span style="font-family:'DM Mono',monospace;font-weight:700">${a.count}x = -${a.impact}pts</span>
        <button onclick="event.stopPropagation();showCaseLinkModal('${a.field}','${safeName}',${a.count},${safeLinks},${hasLinks})"
          style="background:${hasLinks?'#2563eb20':'var(--b)'};color:${hasLinks?'#2563eb':'var(--mu)'};border:1px solid ${hasLinks?'#2563eb40':'var(--b)'};border-radius:6px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:700;white-space:nowrap">
          ${hasLinks?'🔗':'↗'}
        </button>
      </div>
    </div>`;
  }).join('');

  // Mini trend chart
  if (months.length>0) {
    const el = document.getElementById('pc-trend-chart');
    if (el) {
      if (pcTrendChart) pcTrendChart.destroy();
      pcTrendChart = new Chart(el, {
        type:'line',
        data:{ labels:months.map(m=>m.month),
          datasets:[{
            data:months.map(m=>m.avgPct),
            borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,.1)',
            borderWidth:2, fill:true, tension:.4, pointRadius:4,
            pointBackgroundColor:months.map(m=>m.avgPct>=90?'#059669':m.avgPct>=80?'#d97706':'#dc2626')
          }]},
        options:{ responsive:true, maintainAspectRatio:false,
          plugins:{legend:{display:false},
            tooltip:{callbacks:{label:ctx=>ctx.parsed.y.toFixed(1)+'%'}}},
          scales:{
            x:{ticks:{color:'#64748b',font:{family:'DM Mono',size:9}},grid:{display:false}},
            y:{min:0,audits:100,ticks:{color:'#64748b',font:{family:'DM Mono',size:9},callback:v=>v+'%'},
              grid:{color:'rgba(0,0,0,.04)'},
              annotations:{line80:{type:'line',yMin:80,yMax:80,borderColor:'#d97706',borderWidth:1,borderDash:[4,4]}}}
          }}
      });
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Compliance Distribution Histogram
// ══════════════════════════════════════════════════════════════════════════════
var distChartInst = null;

function renderDistribution() {
  const bands = [
    { label:'🔴 Critical',   min:0,  audits:70,  col:'rgba(220,38,38,.8)',   bg:'#fef2f2', tc:'#dc2626' },
    { label:'🟡 At Risk',    min:70, audits:80,  col:'rgba(217,119,6,.8)',   bg:'#fffbeb', tc:'#d97706' },
    { label:'🟢 Good',       min:80, audits:90,  col:'rgba(5,150,105,.8)',   bg:'#f0fdf4', tc:'#059669' },
    { label:'Excellent',  min:90, audits:101, col:'rgba(37,99,235,.8)',   bg:'#eff6ff', tc:'#2563eb' },
  ];

  const counts = bands.map(b => HOF_filtered.filter(d => d.pct >= b.min && d.pct < b.audits).length);
  const total  = HOF_filtered.length || 1;

  // Chart
  const el = document.getElementById('distChart');
  if (!el) return;
  if (distChartInst) distChartInst.destroy();
  distChartInst = new Chart(el, {
    type:'bar',
    data:{ labels: bands.map(b=>b.label),
      datasets:[{ data:counts, backgroundColor:bands.map(b=>b.col), borderRadius:8, barThickness:45 }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label: ctx => ctx.parsed.y+' agents ('+((ctx.parsed.y/total)*100).toFixed(0)+'%)' }}},
      scales:{
        x:{ ticks:{color:'var(--tx)',font:{family:'DM Mono',size:10}}, grid:{display:false} },
        y:{ ticks:{color:'#64748b',font:{family:'DM Mono',size:10},stepSize:1}, grid:{color:'rgba(0,0,0,.04)'},
          title:{display:true,text:'No. of Agents',color:'#94a3b8',font:{family:'DM Mono',size:10}} }
      }}
  });

  // Detail panel
  const det = document.getElementById('distDetail');
  if (det) {
    det.innerHTML = bands.map((b,i) => {
      const pct = ((counts[i]/total)*100).toFixed(0);
      const agents = HOF_filtered.filter(d=>d.pct>=b.min&&d.pct<b.audits).map(d=>d.name.split(' ')[0]).join(', ');
      return `<div style="background:${b.bg};border:1px solid ${b.col.replace('.8','1')};border-radius:10px;padding:10px 14px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;font-weight:700;color:${b.tc}">${b.label}</span>
          <span style="font-family:'DM Mono',monospace;font-size:18px;font-weight:800;color:${b.tc}">${counts[i]}</span>
        </div>
        <div style="font-size:10px;color:var(--mu);margin-top:2px">${pct}% of team${agents?` · ${agents}`:''}</div>
        <div style="font-size:10px;color:var(--mu)">${b.min}% – ${b.audits===101?'100':b.audits}% range</div>
      </div>`;
    }).join('');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Top 5 / Bottom 5 / Most Improved
// ══════════════════════════════════════════════════════════════════════════════
function renderLeaderboards() {
  if (!HOF_filtered.length) return;

  const MIN_AUDITS = 5; // Need meaningful sample size

  const eligible = HOF_filtered.filter(d => d.audits >= MIN_AUDITS);

  // TRUE PERFORMANCE SCORE:
  // Compliance % is the base — but penalise for high error rate
  // Every error/audit above 1.0 deducts 5 points from the score
  // This means someone making 2 errors per audit loses 5 pts vs someone making 1 error/audit
  // Rationale: high error rate = consistently non-compliant, not just a few misses
  const trueScore = d => {
    const errRate = d.audits > 0 ? d.total/d.audits : 0;
    const penalty = Math.max(0, (errRate - 1.0) * 5);
    return Math.max(0, d.pct - penalty);
  };

  const sorted = eligible.slice().sort((a,b) => trueScore(b) - trueScore(a));
  const top5   = sorted.slice(0,5);
  const bot5   = sorted.slice(-5).reverse();

  const agentCard = (d, rank, isTop) => {
    const pc      = d.pct>=90?'#059669':d.pct>=80?'#d97706':'#dc2626';
    const ico     = isTop ? (rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'🏅') : '';
    const errRate = d.audits>0?(d.total/d.audits).toFixed(1):0;

    // Show qualified score as secondary metric if available (3+ qual audits)
    const qualInfo = (d.qualPct!=null && (d.caseQualified||0)>=3)
      ? `<span style="color:#059669;font-weight:700">💰${d.qualPct.toFixed(0)}% qual</span> · `
      : (d.qualPct!=null && (d.caseQualified||0)>0)
      ? `<span style="color:#94a3b8">💰${d.qualPct.toFixed(0)}%(${d.caseQualified})</span> · `
      : '';

    // Find worst category
    const cats = {Outcome:d.catErr_outcome||0,Call:d.catErr_call||0,Lead:d.catErr_leadStage||0,Deal:d.catErr_deal||0,Email:d.catErr_email||0,WA:d.catErr_whatsapp||0,Task:d.catErr_task||0};
    const worst = Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];

    // Flag if overall looks good but qualified is weak (hidden risk)
    const hiddenRiskFlag = (!isTop && d.qualPct!=null && (d.caseQualified||0)>=3 && d.qualPct<80 && d.pct>=80)
      ? `<span style="font-size:9px;background:#fef2f2;color:#dc2626;padding:1px 5px;border-radius:4px;font-weight:700">Qual risk</span>`
      : '';

    return `<div style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;background:var(--s2);margin-bottom:6px">
      <span style="font-size:18px;width:24px;text-align:center">${ico}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.name} ${hiddenRiskFlag}</div>
        <div style="font-size:10px;color:var(--mu)">${qualInfo}${d.audits} audits · ${errRate} err/audit · ↓${worst[0]}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:'DM Mono',monospace;font-size:14px;font-weight:800;color:${pc}">${d.pct.toFixed(1)}%</div>
        <div style="font-size:10px;color:var(--mu)">${(d.audits>0?(d.total/d.audits).toFixed(1):0)}/audit</div>
      </div>
    </div>`;
  };

  const t5 = document.getElementById('top5List');
  const b5 = document.getElementById('bot5List');

  // Update card subtitles
  const t5card = document.querySelector('#top5List')?.closest('.card')?.querySelector('.cs');
  const b5card = document.querySelector('#bot5List')?.closest('.card')?.querySelector('.cs');
  if (t5card) t5card.textContent = 'Best performers · penalised for high error rate · min '+MIN_AUDITS+' audits';
  if (b5card) b5card.textContent = 'Needs most coaching · adjusted for error rate · min '+MIN_AUDITS+' audits';

  if (t5) t5.innerHTML = top5.length
    ? top5.map((d,i)=>agentCard(d,i+1,true)).join('')
    : '<div style="color:var(--mu);font-size:12px;padding:12px">Not enough audits yet</div>';
  if (b5) b5.innerHTML = bot5.length
    ? bot5.map((d,i)=>agentCard(d,i+1,false)).join('')
    : '<div style="color:var(--mu);font-size:12px;padding:12px">Not enough audits yet</div>';

  // Most improved — compare last 2 months in trend data
  const improved = HOF_filtered
    .map(d => {
      const months = d.trend||[];
      if (months.length < 2) return null;
      const last    = months[months.length-1].avgPct;
      const prev    = months[months.length-2].avgPct;
      const delta   = last - prev;
      return { name:d.name, pct:d.pct, delta, last, prev, audits:d.audits };
    })
    .filter(Boolean)
    .sort((a,b)=>b.delta-a.delta)
    .slice(0,5);

  const imp = document.getElementById('improvedList');
  if (imp) {
    if (!improved.length) {
      imp.innerHTML = '<div style="text-align:center;color:var(--mu);padding:20px;font-size:12px">Need 2+ months of data</div>';
    } else {
      imp.innerHTML = improved.map((d,i) => {
        const col = d.delta>0?'#059669':d.delta<0?'#dc2626':'#64748b';
        const arr = d.delta>0?'▲':d.delta<0?'▼':'→';
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;background:var(--s2);margin-bottom:6px">
          <span style="font-size:16px">${i===0?'🚀':i===1?'⬆️':'📈'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:var(--tx)">${d.name}</div>
            <div style="font-size:10px;color:var(--mu)">${d.prev.toFixed(1)}% → ${d.last.toFixed(1)}%</div>
          </div>
          <div style="font-family:'DM Mono',monospace;font-size:14px;font-weight:800;color:${col}">${arr}${Math.abs(d.delta).toFixed(1)}%</div>
        </div>`;
      }).join('');
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Period-over-Period Comparison
// ══════════════════════════════════════════════════════════════════════════════
function renderPeriodComparison() {
  const grid = document.getElementById('popGrid');
  if (!grid || !HOF_filtered.length) return;

  // Use monthly trend to compare last 2 months
  // Aggregate all agents' monthly data
  const monthMap = {};
  HOF_filtered.forEach(d => {
    (d.trend||[]).forEach(m => {
      if (!monthMap[m.month]) monthMap[m.month] = {pctSum:0,pctCount:0,audits:0};
      monthMap[m.month].pctSum   += m.avgPct * m.audits;
      monthMap[m.month].pctCount += m.audits;
      monthMap[m.month].audits   += m.audits;
    });
  });

  const months = Object.entries(monthMap)
    .map(([m,v])=>({ month:m, avg: v.pctCount>0?v.pctSum/v.pctCount:0, audits:v.audits }))
    .sort((a,b)=>new Date('01 '+a.month)-new Date('01 '+b.month));

  const cur  = months[months.length-1];
  const prev = months[months.length-2];

  const metrics = [
    { label:'Period', cur: cur?cur.month:'—', prev: prev?prev.month:'—', unit:'', noArrow:true },
    { label:'Avg Compliance', cur: cur?cur.avg:0, prev: prev?prev.avg:0, unit:'%', decimals:1 },
    { label:'Total Audits', cur: cur?cur.audits:0, prev: prev?prev.audits:0, unit:'', decimals:0 },
    { label:'Critical Agents', cur: HOF_filtered.filter(d=>d.pct<70).length, prev: null, unit:'', decimals:0, noArrow:true },
    { label:'Deal Errors', cur: HOF_filtered.reduce((s,d)=>s+d.deal,0), prev: null, unit:'', decimals:0, noArrow:true },
  ];

  grid.innerHTML = metrics.map(m => {
    const curVal  = typeof m.cur==='number' ? (m.decimals===1?m.cur.toFixed(1):Math.round(m.cur)) : m.cur;
    const prevVal = m.prev!==null && typeof m.prev==='number' ? (m.decimals===1?m.prev.toFixed(1):Math.round(m.prev)) : null;
    const delta   = m.prev!==null && typeof m.cur==='number' && typeof m.prev==='number' ? m.cur-m.prev : null;
    const col     = delta===null?'var(--tx)':delta>0?'#059669':delta<0?'#dc2626':'#64748b';
    const arr     = delta===null?'':delta>0?'▲ ':delta<0?'▼ ':'→ ';
    const deltaStr = delta===null?'':`${arr}${Math.abs(m.decimals===1?parseFloat(delta).toFixed(1):Math.round(delta))}${m.unit}`;
    return `<div style="background:var(--w);padding:16px;text-align:center">
      <div style="font-size:10px;color:var(--mu);font-family:'DM Mono',monospace;margin-bottom:6px">${m.label.toUpperCase()}</div>
      <div style="font-size:16px;font-weight:800;color:var(--tx);font-family:'Nunito',sans-serif">${curVal}${m.unit&&typeof m.cur==='number'?m.unit:''}</div>
      ${prevVal!==null?`<div style="font-size:10px;color:var(--mu);margin-top:2px">prev: ${prevVal}${m.unit}</div>`:''}
      ${deltaStr?`<div style="font-size:11px;font-weight:700;color:${col};margin-top:3px">${deltaStr}</div>`:''}
    </div>`;
  }).join('');
}


// ══════════════════════════════════════════════════════════════════════════════
// SOP VIOLATIONS — Lead Stage Mismatch Panel
// ══════════════════════════════════════════════════════════════════════════════
function renderSOPViolations() {
  const panel = document.getElementById('sopViolationsPanel');
  const badge = document.getElementById('sop-total-badge');
  if (!panel) return;

  const agents = HOF_filtered.map(d => ({
    name: d.name,
    qualNoDeal:     d.mismatchQualNoDeal     || 0,
    dealWrongStage: d.mismatchDealWrongStage  || 0,
    qualWrongStage: d.mismatchQualWrongStage  || 0,
    audits: d.audits,
    pct: d.pct,
    caseQualified: d.caseQualified || 0,
    caseNoAnswer:  d.caseNoAnswer  || 0,
  })).filter(d => d.qualNoDeal + d.dealWrongStage + d.qualWrongStage > 0)
    .sort((a,b) => (b.qualNoDeal+b.dealWrongStage+b.qualWrongStage) - (a.qualNoDeal+a.dealWrongStage+a.qualWrongStage));

  const totalViolations = agents.reduce((s,d)=>s+d.qualNoDeal+d.dealWrongStage+d.qualWrongStage,0);

  if (badge) {
    badge.textContent = totalViolations + ' violations found';
    badge.style.display = totalViolations > 0 ? 'block' : 'none';
  }

  if (!agents.length) {
    panel.innerHTML = '<div style="text-align:center;padding:24px;color:#059669;font-weight:700">✅ No SOP violations found for this period!</div>';
    return;
  }

  panel.innerHTML = `
    <!-- Violation type legend -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 14px;font-size:12px">
        <span style="font-weight:700;color:#dc2626">🔴 Type 1:</span>
        <span style="color:#64748b"> Stage = Qualified but <strong>no deal created</strong> — SOP §9 violation</span>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 14px;font-size:12px">
        <span style="font-weight:700;color:#d97706">🟡 Type 2:</span>
        <span style="color:#64748b"> Deal created but <strong>stage not updated</strong> to Qualified</span>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 14px;font-size:12px">
        <span style="font-weight:700;color:#2563eb">🔵 Type 3:</span>
        <span style="color:#64748b"> Qualified marked but <strong>stage still No Answer/Callback</strong></span>
      </div>
    </div>

    <!-- Agent violations table -->
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:var(--s2);text-align:left">
            <th style="padding:10px 12px;font-weight:700;color:var(--mu)">CONSULTANT</th>
            <th style="padding:10px 12px;font-weight:700;color:var(--mu);text-align:center">AUDITS</th>
            <th style="padding:10px 12px;font-weight:700;color:#dc2626;text-align:center">🔴 Qualified<br>No Deal</th>
            <th style="padding:10px 12px;font-weight:700;color:#d97706;text-align:center">🟡 Deal<br>Wrong Stage</th>
            <th style="padding:10px 12px;font-weight:700;color:#2563eb;text-align:center">🔵 Qual Mark<br>Wrong Stage</th>
            <th style="padding:10px 12px;font-weight:700;color:var(--mu);text-align:center">TOTAL</th>
            <th style="padding:10px 12px;font-weight:700;color:var(--mu);text-align:center">% OF AUDITS</th>
            <th style="padding:10px 12px;font-weight:700;color:var(--mu)">WHAT TO DO</th>
          </tr>
        </thead>
        <tbody>
          ${agents.map(d => {
            const total = d.qualNoDeal + d.dealWrongStage + d.qualWrongStage;
            const pctAudits = d.audits > 0 ? ((total/d.audits)*100).toFixed(0) : 0;
            const severity = total >= 10 ? '#dc2626' : total >= 5 ? '#d97706' : '#d97706';
            const actions = [];
            if (d.qualNoDeal > 0)     actions.push(`Create ${d.qualNoDeal} missing deal(s) in HubSpot`);
            if (d.dealWrongStage > 0) actions.push(`Update lead stage to Qualified for ${d.dealWrongStage} case(s)`);
            if (d.qualWrongStage > 0) actions.push(`Fix stage — mark as Qualified not No Answer for ${d.qualWrongStage} case(s)`);
            return `<tr style="border-bottom:1px solid var(--b)">
              <td style="padding:10px 12px;font-weight:700;color:var(--tx)">${d.name}</td>
              <td style="padding:10px 12px;text-align:center;color:var(--mu)">${d.audits}</td>
              <td style="padding:10px 12px;text-align:center;font-weight:700;color:${d.qualNoDeal>0?'#dc2626':'#94a3b8'}">${d.qualNoDeal||'—'}</td>
              <td style="padding:10px 12px;text-align:center;font-weight:700;color:${d.dealWrongStage>0?'#d97706':'#94a3b8'}">${d.dealWrongStage||'—'}</td>
              <td style="padding:10px 12px;text-align:center;font-weight:700;color:${d.qualWrongStage>0?'#2563eb':'#94a3b8'}">${d.qualWrongStage||'—'}</td>
              <td style="padding:10px 12px;text-align:center;font-family:'DM Mono',monospace;font-weight:800;font-size:14px;color:${severity}">${total}</td>
              <td style="padding:10px 12px;text-align:center;font-weight:700;color:${pctAudits>=20?'#dc2626':pctAudits>=10?'#d97706':'#64748b'}">${pctAudits}%</td>
              <td style="padding:10px 12px;font-size:11px;color:#475569">${actions.join('<br>')}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:var(--s2);font-weight:700;border-top:2px solid var(--b)">
            <td style="padding:10px 12px">📊 TEAM TOTAL</td>
            <td style="padding:10px 12px;text-align:center">${HOF_filtered.reduce((s,d)=>s+d.audits,0)}</td>
            <td style="padding:10px 12px;text-align:center;color:#dc2626">${agents.reduce((s,d)=>s+d.qualNoDeal,0)}</td>
            <td style="padding:10px 12px;text-align:center;color:#d97706">${agents.reduce((s,d)=>s+d.dealWrongStage,0)}</td>
            <td style="padding:10px 12px;text-align:center;color:#2563eb">${agents.reduce((s,d)=>s+d.qualWrongStage,0)}</td>
            <td style="padding:10px 12px;text-align:center;font-family:'DM Mono',monospace;font-size:14px;color:#dc2626">${totalViolations}</td>
            <td colspan="2" style="padding:10px 12px;font-size:11px;color:#dc2626;font-weight:700">
              ${totalViolations} total SOP violations require correction in HubSpot
            </td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

// ── Error Weight Table ───────────────────────────────────────────────────────
// Global helper — shows error count + pass rate for a category (non-clickable fallback)
function catPct(catErr, audits) {
  if (!audits) return '<span style="color:#94a3b8">—</span>';
  if (catErr === 0) return '<span style="color:#059669;font-weight:700">✓</span>';
  var passRate = Math.round(((audits - catErr) / audits) * 100);
  var col = passRate >= 80 ? '#d97706' : '#dc2626';
  return '<span style="color:'+col+';font-weight:700">'+catErr+'</span>'
       + '<br><span style="color:var(--mu);font-size:10px">'+passRate+'%</span>';
}

// Category → sub-field mapping for collecting case links
var CAT_SUBFIELDS = {
  // Exact audit form field names (Apps Script v4 output)
  'call':        ['callLogged','callMade'],
  'whatsapp':    ['waUsed','waLogged','waNote'],
  'email':       ['emailSent','profTone','signature'],
  'description': ['callDesc','allProperties'],
  'leadStage':   ['leadStage','correctStage','qualifiedMark','stageUpdated','qualifiedMarked','correctStage'],
  'outcome':     ['outcome','outcomeRecorded'],
  'deal':        ['deal','dealCreated'],
  'pipeline':    ['timeline','pipeline','timelineActivity','correctPipeline'],
  'task':        ['taskCreated','taskDone','taskType'],
  'followUp':    ['timelyContact'],
};

var CAT_FRIENDLY = {
  'call':'Call','whatsapp':'WhatsApp','email':'Email',
  'description':'Description','leadStage':'Lead Stage',
  'outcome':'Outcome','deal':'Deal','pipeline':'Pipeline',
  'task':'Task','followUp':'Timely Contact'
};

// Clickable category error cell — collects links from all sub-fields, opens modal on click
function catPctClickable(catErr, audits, catKey, agentData) {
  if (!audits) return '<span style="color:#94a3b8">—</span>';
  if (catErr === 0) return '<span style="color:#059669;font-weight:700">✓</span>';

  var passRate = Math.round(((audits - catErr) / audits) * 100);
  var col = passRate >= 80 ? '#d97706' : '#dc2626';

  // Collect all case links across the sub-fields of this category
  var subFields = CAT_SUBFIELDS[catKey] || [];
  var allLinks = [];
  if (agentData.errorLinks) {
    subFields.forEach(function(f) {
      if (agentData.errorLinks[f] && agentData.errorLinks[f].length) {
        agentData.errorLinks[f].forEach(function(lnk) {
          // Tag link with the attribute name for display clarity
          allLinks.push(Object.assign({}, typeof lnk === 'string' ? {url:lnk} : lnk, {_attr: HOF_FIELD_NAMES[f]||f}));
        });
      }
    });
  }

  var hasLinks = allLinks.length > 0;
  var safeLinks = JSON.stringify(allLinks).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
  var safeName  = agentData.name.replace(/'/g,"\\'");
  var catLabel  = CAT_FRIENDLY[catKey] || catKey;

  return `<span style="color:${col};font-weight:700;cursor:pointer;border-bottom:2px dashed ${col};padding-bottom:1px;white-space:nowrap;transition:.15s"
    onmouseenter="this.style.opacity='.7'" onmouseleave="this.style.opacity='1'"
    onclick="event.stopPropagation();showCatCaseLinkModal('${catLabel}','${safeName}',${catErr},${safeLinks},${hasLinks})"
    title="${catErr} error${catErr>1?'s':''} in ${catLabel} — click for case links">${catErr}${hasLinks ? ' <span style="font-size:9px">🔗</span>' : ' <span style="font-size:9px;opacity:.5">↗</span>'}</span>
    <br><span style="color:var(--mu);font-size:10px">${passRate}%</span>`;
}

// ── Category Case Link Modal (for Category Error Summary table) ────────────────
function showCatCaseLinkModal(catLabel, agentName, count, links, hasLinks) {
  var modal   = document.getElementById('caseLinkModal');
  var overlay = document.getElementById('caseLinkOverlay');
  var titleEl = document.getElementById('caseLinkTitle');
  var subEl   = document.getElementById('caseLinkSub');
  var bodyEl  = document.getElementById('caseLinkBody');
  var noteEl  = document.getElementById('caseLinkNote');

  titleEl.textContent = catLabel + ' Category — Error Cases';
  subEl.textContent   = agentName + ' · ' + count + ' error' + (count>1?'s':'') + ' in ' + catLabel + ' this period';

  var items = Array.isArray(links) ? links : [];

  if (!hasLinks && !items.length) {
    bodyEl.innerHTML =
      '<div style="padding:4px 0 16px">' +
        '<div style="background:linear-gradient(135deg,#fef3c7,#fffbeb);border:1px solid #fde68a;border-radius:12px;padding:14px 16px;margin-bottom:14px">' +
          '<div style="font-size:13px;font-weight:800;color:#92400e;margin-bottom:5px">⚡ Case links not loaded yet</div>' +
          '<div style="font-size:11px;color:#78350f;line-height:1.6">The dashboard reads case links from your audit sheet automatically. Make the sheet public (view-only) and refresh.</div>' +
        '</div>' +
        '<div style="background:var(--s2);border:1px solid var(--b);border-radius:12px;padding:14px 16px;border-left:4px solid #2563eb">' +
          '<div style="font-size:12px;font-weight:800;color:#2563eb;margin-bottom:7px">✅ Make sheet public (easiest fix)</div>' +
          '<div style="font-size:11px;color:var(--t2);line-height:1.8">' +
            '1. Open Google Sheet → Share → Change to anyone with the link → Viewer<br>' +
            '2. Save, then Refresh this dashboard' +
          '</div>' +
          '<a href="https://docs.google.com/spreadsheets/d/' + RAW_SHEET_ID + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:#2563eb;color:#fff;border-radius:8px;padding:8px 16px;font-size:11px;font-weight:700;text-decoration:none">' +
            '📊 Open Sheet &nbsp;<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
          '</a>' +
        '</div>' +
      '</div>';
  } else if (!items.length) {
    bodyEl.innerHTML =
      '<div style="text-align:center;padding:28px;color:var(--mu)">' +
        '<div style="font-size:32px;margin-bottom:10px">🔍</div>' +
        '<div style="font-size:14px;font-weight:700;color:var(--tx);margin-bottom:6px">No matching cases found</div>' +
        '<div style="font-size:12px;line-height:1.6">Sheet was read but no rows matched <strong>' + agentName + '</strong> with a <strong>' + catLabel + '</strong> error.<br><span style="color:var(--mu)">Check that the consultant name in the sheet exactly matches the dashboard name.</span></div>' +
      '</div>';
  } else {
    bodyEl.innerHTML =
      '<div style="margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<span style="font-size:11px;color:var(--mu);font-family:\'DM Mono\',monospace">' + items.length + ' case' + (items.length>1?'s':'') + ' flagged:</span>' +
        '<span style="background:#dc262615;color:#dc2626;border:1px solid #dc262630;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">' + catLabel + '</span>' +
        '<span style="background:var(--s2);color:var(--mu);border:1px solid var(--b);padding:3px 10px;border-radius:20px;font-size:10px;font-family:\'DM Mono\',monospace">' + agentName + '</span>' +
      '</div>' +
      items.map(function(item, i) {
        var url   = typeof item === 'string' ? item : (item.url || item.link || item.href || '');
        var name  = typeof item === 'string' ? ('Case '+(i+1)) : (item.name || item.caseName || item.case || item.title || ('Case '+(i+1)));
        var date  = typeof item === 'object' ? (item.date || item.auditDate || '') : '';
        var attr  = typeof item === 'object' ? (item._attr || '') : '';
        var isHub = url.includes('hubspot') || url.includes('app.hubspot');
        return '<div style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:var(--s2);border-radius:12px;margin-bottom:8px;border:1px solid var(--b)">' +
          '<div style="width:38px;height:38px;background:' + (isHub?'rgba(255,90,50,.1)':'rgba(37,99,235,.08)') + ';border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px">' + (isHub?'🟠':'📋') + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;font-weight:700;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + name + '</div>' +
            (attr ? '<div style="font-size:10px;color:#7c3aed;font-family:\'DM Mono\',monospace;margin-top:2px;font-weight:600">⚑ ' + attr + '</div>' : '') +
            (date ? '<div style="font-size:10px;color:#2563eb;font-family:\'DM Mono\',monospace;margin-top:2px;font-weight:600">📅 ' + date + '</div>' : '') +
            (url ? '<div style="font-size:10px;color:var(--mu);font-family:\'DM Mono\',monospace;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + url + '</div>'
                 : '<div style="font-size:10px;color:#d97706;margin-top:2px">⚠️ No URL — add a Case Link column to your sheet</div>') +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">' +
            (url ?
              '<a href="' + url + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border-radius:9px;padding:8px 14px;font-size:11px;font-weight:700;text-decoration:none;display:flex;align-items:center;gap:5px;box-shadow:0 2px 8px rgba(37,99,235,.25)">Open &nbsp;<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>'
            : '') +
            (url ?
              '<button onclick="event.stopPropagation();navigator.clipboard.writeText(\'' + url.replace(/'/g,"\\'") + '\').then(function(){showToast(\'✅ Link copied!\');})" style="background:var(--b);color:var(--t2);border:1px solid var(--b2);border-radius:9px;padding:6px 10px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;gap:4px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>'
            : '<span style="font-size:11px;color:var(--mu);padding:8px 10px">No URL</span>') +
          '</div>' +
        '</div>';
      }).join('');
  }

  noteEl.textContent = catLabel + ' category · ' + count + ' error' + (count>1?'s':'') + ' · ' + agentName;
  modal.style.display   = 'flex';
  overlay.style.display = 'block';
}

function renderWeightTable() {
  const wtb = document.getElementById('wtb');
  if (!wtb) return;
  if (!HOF_filtered.length) { wtb.innerHTML='<tr><td colspan="12" style="text-align:center;padding:16px;color:var(--mu)">No data</td></tr>'; return; }
  const sorted = HOF_filtered.slice().sort((a,b)=>
    (b.catErr_call+b.catErr_whatsapp+b.catErr_email+b.catErr_description+
     b.catErr_leadStage+b.catErr_deal+b.catErr_task+b.catErr_followUp) -
    (a.catErr_call+a.catErr_whatsapp+a.catErr_email+a.catErr_description+
     a.catErr_leadStage+a.catErr_deal+a.catErr_task+a.catErr_followUp));
  const cell = (catErr, aud, catKey, d) => {
    if (!aud) return '<span style="color:#94a3b8">—</span>';
    if (catErr===0) return '<span style="color:#059669;font-weight:700">✓</span>';
    const pr=Math.round(((aud-catErr)/aud)*100);
    const col=pr>=80?'#d97706':'#dc2626';
    const links=(d.errorLinks&&d.errorLinks[catKey]&&d.errorLinks[catKey].length>0)?d.errorLinks[catKey]:null;
    const sl=links?JSON.stringify(links).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;'):'[]';
    const sn=d.name.replace(/'/g,"\\'");
    const cl=catKey.charAt(0).toUpperCase()+catKey.slice(1);
    return `<span style="color:${col};font-weight:700;cursor:pointer;border-bottom:1px dashed ${col}"
      onclick="event.stopPropagation();showCatCaseLinkModal('${cl}','${sn}',${catErr},${sl},${!!links})">${catErr}</span><br><span style="font-size:10px;color:var(--mu)">${pr}%</span>`;
  };
  wtb.innerHTML = sorted.map(d => {
    const total=d.catErr_call+d.catErr_whatsapp+d.catErr_email+d.catErr_description+d.catErr_leadStage+d.catErr_deal+d.catErr_task+d.catErr_followUp;
    const pc=d.pct>=90?'#059669':d.pct>=80?'#d97706':'#dc2626';
    return `<tr>
      <td style="font-weight:600">${d.name}</td><td class="tm">${d.audits}</td>
      <td class="tm">${cell(d.catErr_call,d.audits,'call',d)}</td>
      <td class="tm">${cell(d.catErr_whatsapp,d.audits,'whatsapp',d)}</td>
      <td class="tm">${cell(d.catErr_email,d.audits,'email',d)}</td>
      <td class="tm">${cell(d.catErr_description,d.audits,'description',d)}</td>
      <td class="tm">${cell(d.catErr_leadStage,d.audits,'leadStage',d)}</td>
      <td class="tm">${cell(d.catErr_deal,d.audits,'deal',d)}</td>
      <td class="tm">${cell(d.catErr_task,d.audits,'task',d)}</td>
      <td class="tm">${cell(d.catErr_followUp,d.audits,'followUp',d)}</td>
      <td class="tm" style="font-weight:700;color:${total===0?'#059669':total>5?'#dc2626':'#d97706'}">${total}</td>
      <td class="tm"><span style="color:${pc};font-weight:800;font-family:'DM Mono',monospace;font-size:13px">${d.pct.toFixed(1)}%</span></td>
    </tr>`;
  }).join('');
  const tAud=HOF_filtered.reduce((s,d)=>s+d.audits,0)||1;
  const tavg=HOF_filtered.length?HOF_filtered.reduce((s,d)=>s+d.pct,0)/HOF_filtered.length:0;
  const tpc=tavg>=90?'#059669':tavg>=80?'#d97706':'#dc2626';
  wtb.innerHTML+=`<tr style="background:var(--s2);font-weight:700;border-top:2px solid var(--b)">
    <td>📊 TEAM TOTAL</td><td class="tm">${tAud}</td>
    <td class="tm" style="color:#2563eb">${HOF_filtered.reduce((s,d)=>s+(d.catErr_call||0),0)}</td>
    <td class="tm" style="color:#059669">${HOF_filtered.reduce((s,d)=>s+(d.catErr_whatsapp||0),0)}</td>
    <td class="tm" style="color:#d97706">${HOF_filtered.reduce((s,d)=>s+(d.catErr_email||0),0)}</td>
    <td class="tm" style="color:#64748b">${HOF_filtered.reduce((s,d)=>s+(d.catErr_description||0),0)}</td>
    <td class="tm" style="color:#7c3aed">${HOF_filtered.reduce((s,d)=>s+(d.catErr_leadStage||0),0)}</td>
    <td class="tm" style="color:#dc2626">${HOF_filtered.reduce((s,d)=>s+(d.catErr_deal||0),0)}</td>
    <td class="tm" style="color:#6366f1">${HOF_filtered.reduce((s,d)=>s+(d.catErr_task||0),0)}</td>
    <td class="tm" style="color:#0891b2">${HOF_filtered.reduce((s,d)=>s+(d.catErr_followUp||0),0)}</td>
    <td class="tm">${HOF_filtered.reduce((s,d)=>s+d.total,0)}</td>
    <td class="tm"><span style="color:${tpc};font-family:'DM Mono',monospace;font-weight:800">${tavg.toFixed(1)}%</span></td>
  </tr>`;
}

// DOWNLOAD / EXPORT FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

// ── Team CSV Export ───────────────────────────────────────────────────────────
function exportTeamCSV() {
  if (!HOF_filtered.length) { showToast('No data to export'); return; }

  const headers = ['Consultant','Audits','Compliance %','Error Rate','Total Errors',
    'Call Pts Lost','Lead Stage Pts Lost','Deal Pts Lost','Email Pts Lost','WA Pts Lost','Task Pts Lost',
    'Total Pts Lost','% of Max Lost',
    'SOP: Qualified No Deal','SOP: Deal Wrong Stage','SOP: Qual Wrong Stage',
    'Case: Qualified','Case: No Answer','Case: Callback','Case: Cannot Dial',
    '1st Contact Errors','1st Call Errors','Call Logged Errors','Outcome Errors','Call Desc Errors',
    'Lead Stage Errors','Correct Stage Errors','Qualified Mark Errors',
    'Deal Created Errors','Pipeline Errors','Timeline Errors','Properties Errors',
    'Email Sent Errors','Email Hub Errors','Prof Tone Errors','Signature Errors',
    'WA Used Errors','WA Logged Errors','WA Note Errors',
    'Task Created Errors','Task Done Errors','Task Type Errors'];

  const rows = HOF_filtered.map(d => {
    const totalCatErrs = (d.catErr_outcome||0)+(d.catErr_call||0)+(d.catErr_leadStage||0)+(d.catErr_deal||0)+(d.catErr_email||0)+(d.catErr_whatsapp||0)+(d.catErr_task||0);
    return [
      d.name, d.audits, d.pct.toFixed(1)+'%',
      (d.audits>0?(d.total/d.audits).toFixed(2):0),
      d.total,
      d.catErr_outcome||0, d.catErr_call||0, d.catErr_leadStage||0, d.catErr_deal||0, d.catErr_email||0, d.catErr_whatsapp||0, d.catErr_task||0,
      totalCatErrs, d.audits>0?((totalCatErrs/d.audits)*100).toFixed(1)+'%':'0%',
      d.mismatchQualNoDeal||0, d.mismatchDealWrongStage||0, d.mismatchQualWrongStage||0,
      d.caseQualified||0, d.caseNoAnswer||0, d.caseCallback||0, d.caseCannotDial||0,
      d.firstContact||0, d.firstCall||0, d.callLogged||0, d.outcome||0, d.callDesc||0,
      d.leadStage||0, d.correctStage||0, d.qualifiedMark||0,
      d.deal||0, d.pipeline||0, d.timeline||0, d.properties||0,
      d.emailSent||0, d.emailHub||0, d.profTone||0, d.signature||0,
      d.waUsed||0, d.waLogged||0, d.waNote||0,
      d.taskCreated||0, d.taskDone||0, d.taskType||0
    ];
  });

  const csvContent = [headers, ...rows]
    .map(r => r.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(','))
    .join('\n');

  const blob = new Blob([csvContent], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0,10);
  a.href     = url;
  a.download = 'HOF_Team_Compliance_'+date+'.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ Team CSV downloaded!');
}

// ── Individual Consultant PDF ─────────────────────────────────────────────────
function generateConsultantPDF(d) {
  if (!d) { showToast('No consultant selected'); return; }
  if (typeof window.jspdf === 'undefined') { showToast('PDF library loading, try again in a second'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const W = 210, margin = 15, contentW = W - margin*2;
  let y = 15;

  // ── Header banner ──────────────────────────────────────────────────────────
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, W, 40, 'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(20); doc.setFont('helvetica','bold');
  doc.text('HOF Migration — Compliance Report', margin, 16);
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text(d.name, margin, 25);
  const dateStr = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  doc.text('Generated: '+dateStr, margin, 32);

  // Status badge
  const pc = d.pct>=90?[5,150,105]:d.pct>=80?[217,119,6]:[220,38,38];
  doc.setFillColor(...pc);
  doc.roundedRect(W-60, 10, 45, 20, 3, 3, 'F');
  doc.setFontSize(16); doc.setFont('helvetica','bold');
  doc.setTextColor(255,255,255);
  doc.text(d.pct.toFixed(1)+'%', W-50, 21, {align:'center'});
  doc.setFontSize(8);
  doc.text('COMPLIANCE', W-50, 27, {align:'center'});

  y = 50;
  doc.setTextColor(15,23,42);

  // ── Key Metrics row ────────────────────────────────────────────────────────
  const metrics = [
    ['Audits', d.audits],
    ['Total Errors', d.total],
    ['Error Rate', (d.audits>0?(d.total/d.audits).toFixed(2):0)+'/audit'],
    ['Team Rank', '#'+(HOF_ALL.slice().sort((a,b)=>b.pct-a.pct).findIndex(x=>x.name===d.name)+1)+' of '+HOF_ALL.length],
  ];
  const boxW = contentW/4;
  metrics.forEach((m,i) => {
    const x = margin + i*boxW;
    doc.setFillColor(240,243,248);
    doc.roundedRect(x, y, boxW-3, 20, 2, 2, 'F');
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139);
    doc.text(m[0].toUpperCase(), x+boxW/2-1.5, y+7, {align:'center'});
    doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(15,23,42);
    doc.text(String(m[1]), x+boxW/2-1.5, y+16, {align:'center'});
  });
  y += 28;

  // ── Top 3 Things to Fix ───────────────────────────────────────────────────
  doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(15,23,42);
  doc.text('🎯 Top 3 Things to Fix', margin, y); y += 7;

  const ATTRS = [
    {name:'1st Contact',field:'firstContact',pts:4,cat:'Call'},
    {name:'1st Call Made',field:'firstCall',pts:4,cat:'Call'},
    {name:'Call Logged',field:'callLogged',pts:4,cat:'Call'},
    {name:'Outcome',field:'outcome',pts:4,cat:'Call'},
    {name:'Call Desc',field:'callDesc',pts:4,cat:'Call'},
    {name:'Lead Stage Upd',field:'leadStage',pts:5,cat:'Lead Stage'},
    {name:'Correct Stage',field:'correctStage',pts:5,cat:'Lead Stage'},
    {name:'Qualified Mark',field:'qualifiedMark',pts:5,cat:'Lead Stage'},
    {name:'Deal Created',field:'deal',pts:8,cat:'Deal'},
    {name:'Pipeline',field:'pipeline',pts:8,cat:'Deal'},
    {name:'Timeline',field:'timeline',pts:8,cat:'Deal'},
    {name:'Properties',field:'properties',pts:8,cat:'Deal'},
    {name:'Email Sent',field:'emailSent',pts:3,cat:'Email'},
    {name:'Email via Hub',field:'emailHub',pts:3,cat:'Email'},
    {name:'Prof Tone',field:'profTone',pts:3,cat:'Email'},
    {name:'Signature',field:'signature',pts:3,cat:'Email'},
    {name:'WA Used',field:'waUsed',pts:4,cat:'WhatsApp'},
    {name:'WA Logged',field:'waLogged',pts:4,cat:'WhatsApp'},
    {name:'WA Note',field:'waNote',pts:4,cat:'WhatsApp'},
    {name:'Task Created',field:'taskCreated',pts:3,cat:'Task'},
    {name:'Task Done',field:'taskDone',pts:3,cat:'Task'},
    {name:'Task Type',field:'taskType',pts:3,cat:'Task'},
  ];
  const top3 = ATTRS.map(a=>({...a,count:d[a.field]||0,impact:(d[a.field]||0)*a.pts}))
    .filter(a=>a.count>0).sort((a,b)=>b.impact-a.impact).slice(0,3);

  if (!top3.length) {
    doc.setFillColor(240,253,244); doc.roundedRect(margin, y, contentW, 12, 2, 2, 'F');
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(5,150,105);
    doc.text('✅ No errors this period — excellent work!', margin+5, y+8); y+=18;
  } else {
    top3.forEach((a,i) => {
      const bg = i===0?[254,242,242]:i===1?[255,251,235]:[255,247,237];
      doc.setFillColor(...bg);
      doc.roundedRect(margin, y, contentW, 16, 2, 2, 'F');
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(15,23,42);
      doc.text((i+1)+'. '+a.name+' ('+a.cat+')', margin+4, y+7);
      doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139);
      doc.setFontSize(9);
      doc.text(a.count+'x errors = -'+a.impact+' pts', margin+4, y+13);
      doc.setTextColor(220,38,38); doc.setFont('helvetica','bold');
      doc.text('-'+a.impact+' pts', W-margin-20, y+10, {align:'right'});
      y += 20;
    });
  }
  y += 4;

  // ── Category Breakdown table ───────────────────────────────────────────────
  doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(15,23,42);
  doc.text('📊 Performance by Category', margin, y); y += 5;

  const cats = [
    {name:'Outcome',   lost:d.catErr_outcome||0,  poss:d.audits, errs:d.outcome||0},
    {name:'Call',      lost:d.catErr_call||0,     poss:d.audits, errs:(d.firstContact||0)+(d.firstCall||0)+(d.callLogged||0)+(d.callDesc||0)},
    {name:'Lead Stage',lost:d.catErr_leadStage||0, poss:d.audits, errs:(d.leadStage||0)+(d.correctStage||0)+(d.qualifiedMark||0)},
    {name:'Deal',      lost:d.catErr_deal||0,     poss:d.audits, errs:(d.deal||0)+(d.pipeline||0)+(d.timeline||0)+(d.properties||0)},
    {name:'Email',     lost:d.catErr_email||0,    poss:d.audits,    errs:(d.emailSent||0)+(d.emailHub||0)+(d.profTone||0)+(d.signature||0)},
    {name:'WhatsApp',  lost:d.catErr_whatsapp||0, poss:d.audits, errs:(d.waUsed||0)+(d.waLogged||0)+(d.waNote||0)},
    {name:'Task',      lost:d.catErr_task||0,     poss:d.audits,     errs:(d.taskCreated||0)+(d.taskDone||0)+(d.taskType||0)},
  ];

  doc.autoTable({
    startY: y, margin:{left:margin,right:margin},
    head:[['Category','Score','Pts Lost','Errors','Status']],
    body: cats.map(c => {
      const score = d.audits>0?Math.max(0,Math.round(((d.audits-(c.catErr||0))/d.audits)*100)):100;
      const status = score>=90?'Excellent':score>=80?'Good':score>=70?'Needs Work':'Critical';
      return [c.name, score+'%', (c.catErr||0)+' cat errors', c.errors.reduce((s,e)=>s+e,0), status];
    }),
    styles:{fontSize:9, cellPadding:3},
    headStyles:{fillColor:[37,99,235], textColor:255, fontStyle:'bold'},
    alternateRowStyles:{fillColor:[248,250,252]},
    columnStyles:{1:{halign:'center'},2:{halign:'center'},3:{halign:'center'},4:{halign:'center'}},
    didParseCell: function(data) {
      if (data.column.index===4 && data.section==='body') {
        const v = data.cell.text[0];
        data.cell.styles.textColor = v==='Excellent'?[5,150,105]:v==='Good'?[5,150,105]:v==='Needs Work'?[217,119,6]:[220,38,38];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });
  y = doc.lastAutoTable.finalY + 8;

  // ── SOP Violations ────────────────────────────────────────────────────────
  const totalViolations = (d.mismatchQualNoDeal||0)+(d.mismatchDealWrongStage||0)+(d.mismatchQualWrongStage||0);
  if (totalViolations > 0) {
    doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(220,38,38);
    doc.text('🚨 SOP Violations ('+totalViolations+')', margin, y); y += 5;
    doc.autoTable({
      startY:y, margin:{left:margin,right:margin},
      head:[['Violation Type','Count','Action Required']],
      body:[
        ['Qualified stage but no deal created', d.mismatchQualNoDeal||0, 'Create missing deal(s) in HubSpot immediately'],
        ['Deal created but stage not updated',  d.mismatchDealWrongStage||0, 'Update lead stage to Qualified'],
        ['Qualified mark but wrong stage',       d.mismatchQualWrongStage||0, 'Fix lead stage — mark as Qualified'],
      ].filter(r=>r[1]>0),
      styles:{fontSize:9, cellPadding:3},
      headStyles:{fillColor:[220,38,38], textColor:255, fontStyle:'bold'},
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── Monthly Trend ─────────────────────────────────────────────────────────
  if ((d.trend||[]).length > 0) {
    doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(15,23,42);
    doc.text('📈 Monthly Trend', margin, y); y += 5;
    doc.autoTable({
      startY:y, margin:{left:margin,right:margin},
      head:[['Month','Compliance %','Audits']],
      body: d.trend.map(t=>[t.month, t.avgPct.toFixed(1)+'%', t.audits]),
      styles:{fontSize:9, cellPadding:3},
      headStyles:{fillColor:[37,99,235], textColor:255, fontStyle:'bold'},
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const pageH = doc.internal.pageSize.height;
  doc.setFillColor(240,243,248);
  doc.rect(0, pageH-15, W, 15, 'F');
  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139);
  doc.text('HOF Migration — Compliance Dashboard | Confidential | '+dateStr, W/2, pageH-6, {align:'center'});

  const filename = 'HOF_'+d.name.replace(/\s+/g,'_')+'_Compliance_'+new Date().toISOString().slice(0,10)+'.pdf';
  doc.save(filename);
  showToast('✅ PDF downloaded for '+d.name+'!');
}

function downloadConsultantPDF() {
  const d = HOF_filtered.length===1 ? HOF_filtered[0] : null;
  generateConsultantPDF(d);
}

function downloadConsultantCSV() {
  const d = HOF_filtered.length===1 ? HOF_filtered[0] : null;
  if (!d) { showToast('Select a consultant first'); return; }
  // Reuse team CSV but for single consultant
  const old = HOF_filtered.slice();
  exportTeamCSV();
}

function quickDownloadPDF(name) {
  const d = HOF_ALL.find(x=>x.name===name);
  generateConsultantPDF(d);
}

// Share modal
function openShare() {
  const p = new URLSearchParams();
  p.set('range', activeRange);
  p.set('consultant', document.getElementById('cf').value);
  p.set('sort', document.getElementById('sf').value);
  if (activeRange === 'custom') {
    const sv=document.getElementById('ds').value, ev=document.getElementById('de').value;
    if (sv) p.set('start',sv); if (ev) p.set('end',ev);
  }
  document.getElementById('surl').textContent = location.href.split('?')[0] + '?' + p.toString();
  document.getElementById('smod').classList.remove('hidden');
}
function closeSh()  { document.getElementById('smod').classList.add('hidden'); }
function copyUrl()  { navigator.clipboard.writeText(document.getElementById('surl').textContent).then(()=>{closeSh();showToast('✅ Link copied!');}).catch(()=>showToast('Copy the URL manually.')); }
function showToast(m) { const t=document.getElementById('toast'); t.textContent=m; t.classList.add('on'); setTimeout(()=>t.classList.remove('on'),3000); }

function hofRestoreUrl() {
  const p = new URLSearchParams(location.search);
  if (p.has('range')) {
    activeRange = p.get('range');
    const b = document.querySelector(`.chip[data-range="${activeRange}"]`);
    if (b) { document.querySelectorAll('.chip[data-range]').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }
    document.getElementById('cbox').classList.toggle('hidden', activeRange !== 'custom');
  }
  if (p.has('start'))      document.getElementById('ds').value = p.get('start');
  if (p.has('end'))        document.getElementById('de').value = p.get('end');
  if (p.has('consultant')) document.getElementById('cf').value = p.get('consultant');
  if (p.has('sort'))       document.getElementById('sf').value = p.get('sort');
}
