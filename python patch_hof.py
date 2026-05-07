#!/usr/bin/env python3
"""
HOF Dashboard Auto-Patcher v1.0
================================
Run this script in the same folder as your HOF dashboard HTML file.
It applies all HOF Consultants tab changes automatically.

Usage:
    python patch_hof.py
    (or: python patch_hof.py my_dashboard.html)

Output: HOF_Dashboard_PATCHED.html
"""

import re
import sys
import os

# ── Find the HTML file ────────────────────────────────────────────────────────
def find_html_file():
    if len(sys.argv) > 1:
        return sys.argv[1]
    for f in os.listdir('.'):
        if f.endswith('.html') and 'hof' in f.lower():
            return f
    html_files = [f for f in os.listdir('.') if f.endswith('.html')]
    if len(html_files) == 1:
        return html_files[0]
    print("Multiple HTML files found:", html_files)
    return input("Enter filename: ").strip()

# ── Replacement functions ─────────────────────────────────────────────────────
# Each entry: (function_name, new_code)
# The patcher finds the existing function by name and replaces the whole block.

NEW_FUNCTIONS = {}

NEW_FUNCTIONS['hofFetch'] = r"""async function hofFetch(silent=false) {
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
}"""

NEW_FUNCTIONS['hofSort'] = r"""function hofSort(s) {
  if      (s==='errors-desc') HOF_filtered.sort((a,b)=>b.total-a.total);
  else if (s==='errors-asc')  HOF_filtered.sort((a,b)=>a.total-b.total);
  else if (s==='pct-asc')     HOF_filtered.sort((a,b)=>a.pct-b.pct);
  else if (s==='pct-desc')    HOF_filtered.sort((a,b)=>b.pct-a.pct);
  else if (s==='audits-desc') HOF_filtered.sort((a,b)=>b.audits-a.audits);
  else if (s==='name')        HOF_filtered.sort((a,b)=>a.name.localeCompare(b.name));
}"""

NEW_FUNCTIONS['hofUpdateKPIs'] = r"""function hofUpdateKPIs() {
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
}"""

NEW_FUNCTIONS['hofRenderTable'] = r"""function hofRenderTable(data) {
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
}"""

NEW_FUNCTIONS['renderWeightTable'] = r"""function renderWeightTable() {
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
}"""

NEW_FUNCTIONS['renderTrainingPanel'] = r"""function renderTrainingPanel() {
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
}"""

NEW_FUNCTIONS['trainingCardClick'] = r"""function trainingCardClick(name) {
  const sel=document.getElementById('trainingConsultantSel');
  if(sel) sel.value=name;
  highlightTrainingCard(name);
  showTrainingForConsultant(name);
  setTimeout(()=>{const d=document.getElementById('trainingDetail');if(d)d.scrollIntoView({behavior:'smooth',block:'nearest'});},100);
}"""

NEW_FUNCTIONS['highlightTrainingCard'] = r"""function highlightTrainingCard(name) {
  document.querySelectorAll('[id^="tc-card-"]').forEach(el=>{el.style.outline='';el.style.boxShadow='';});
  const el=document.getElementById('tc-card-'+name.replace(/\s+/g,'-'));
  if(el){el.style.outline='2px solid #6366f1';el.style.boxShadow='0 0 0 4px rgba(99,102,241,.15)';}
}"""

NEW_FUNCTIONS['closeTrainingDetail'] = r"""function closeTrainingDetail() {
  const d=document.getElementById('trainingDetail'); if(d) d.innerHTML='';
  const s=document.getElementById('trainingConsultantSel'); if(s) s.value='';
  document.querySelectorAll('[id^="tc-card-"]').forEach(el=>{el.style.outline='';el.style.boxShadow='';});
}"""

NEW_FUNCTIONS['showTrainingForConsultant'] = r"""function showTrainingForConsultant(name) {
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
}"""

# ── HTML snippet replacements ─────────────────────────────────────────────────

HTML_REPLACEMENTS = [

  # 1. Sort dropdown — remove qual options
  (
    r'<select id="sf"[^>]*>.*?</select>',
    '''<select id="sf" onchange="applyFilters()">
          <option value="errors-desc">Most Errors</option>
          <option value="errors-asc">Fewest Errors</option>
          <option value="pct-asc">Lowest Compliance</option>
          <option value="pct-desc">Highest Compliance</option>
          <option value="audits-desc">Most Audits</option>
          <option value="name">Name A–Z</option>
        </select>''',
    re.DOTALL
  ),

  # 2. KPI row — replace entire .kg div
  (
    r'<div class="kg"[^>]*>.*?</div>\s*<!-- hidden elements kept for JS compatibility -->.*?</div>',
    '''<div class="kg" style="grid-template-columns:repeat(8,1fr)">
    <div class="kc" style="border:2px solid #dc2626;border-radius:12px"><div class="ka" id="k-pct-a" style="background:#dc2626"></div><div class="kl" style="font-weight:700">Overall %</div><div class="kv" id="k-pct" style="color:#dc2626">—</div><div class="ks">Avg compliance score</div></div>
    <div class="kc" style="border:2px solid #dc2626;border-radius:12px"><div class="ka" style="background:#dc2626"></div><div class="kl">⛔ Critical</div><div class="kv" id="k-crit" style="color:#dc2626;font-size:18px">—</div><div class="ks">Critical violation rows</div></div>
    <div class="kc"><div class="ka" id="k-ws-a" style="background:#7c3aed"></div><div class="kl">Cat Errors</div><div class="kv" id="k-ws" style="color:#7c3aed;font-size:13px;font-weight:700;padding-top:4px">—</div><div class="ks" id="k-ws-sub">total this period</div></div>
    <div class="kc"><div class="ka" id="k-acc-a" style="background:#e8943a"></div><div class="kl">Err / Audit</div><div class="kv" id="k-acc" style="color:#e8943a">—</div><div class="ks" id="k-acc-sub">category errors per audit</div></div>
    <div class="kc"><div class="ka" id="k-rep-a" style="background:#dc2626"></div><div class="kl">At Risk</div><div class="kv" id="k-rep" style="color:#dc2626">—</div><div class="ks">Below 80%</div></div>
    <div class="kc"><div class="ka" style="background:#d97706"></div><div class="kl">Watch</div><div class="kv" id="k-coa" style="color:#d97706">—</div><div class="ks">80–90%</div></div>
    <div class="kc"><div class="ka" style="background:#059669"></div><div class="kl">Excellent</div><div class="kv" id="k-ok" style="color:#059669">—</div><div class="ks">Above 90%</div></div>
    <div class="kc"><div class="ka" style="background:#7c3aed"></div><div class="kl">Deal Errors</div><div class="kv" id="k-dl" style="color:#7c3aed">—</div><div class="ks">High impact</div></div>
  </div>
  <div style="display:none">
    <span id="k-aud">—</span><span id="k-err">—</span><span id="k-tw">—</span><span id="k-tw-a"></span>
    <span id="k-qual">—</span><span id="k-qual-a"></span><span id="k-qual-s"></span>
  </div>''',
    re.DOTALL
  ),

  # 3. Agent table thead — big replace
  (
    r'<thead>\s*<tr style="background:var\(--m2\)".*?</thead>',
    '''<thead>
            <tr>
              <th onclick="tsort(\'name\')">Agent</th>
              <th onclick="tsort(\'audits\')" style="text-align:center">Audits</th>
              <th onclick="tsort(\'catErr_call\')" style="text-align:center;color:#2563eb">📞 Call<br><span style="font-size:9px;font-weight:400;color:#94a3b8">Col C</span></th>
              <th onclick="tsort(\'catErr_whatsapp\')" style="text-align:center;color:#059669">💬 WhatsApp<br><span style="font-size:9px;font-weight:400;color:#94a3b8">Col D</span></th>
              <th onclick="tsort(\'catErr_email\')" style="text-align:center;color:#d97706">📧 Email<br><span style="font-size:9px;font-weight:400;color:#94a3b8">Col E</span></th>
              <th onclick="tsort(\'catErr_description\')" style="text-align:center;color:#64748b">📝 Description<br><span style="font-size:9px;font-weight:400;color:#94a3b8">Col F</span></th>
              <th onclick="tsort(\'catErr_leadStage\')" style="text-align:center;color:#7c3aed">🎯 Lead Stage<br><span style="font-size:9px;font-weight:400;color:#94a3b8">Col G</span></th>
              <th onclick="tsort(\'catErr_deal\')" style="text-align:center;color:#dc2626">💼 Deal<br><span style="font-size:9px;font-weight:400;color:#94a3b8">Col H</span></th>
              <th onclick="tsort(\'catErr_task\')" style="text-align:center;color:#6366f1">✅ Task<br><span style="font-size:9px;font-weight:400;color:#94a3b8">Col I</span></th>
              <th onclick="tsort(\'catErr_followUp\')" style="text-align:center;color:#0891b2">⏱️ Follow Up<br><span style="font-size:9px;font-weight:400;color:#94a3b8">Col J</span></th>
              <th onclick="tsort(\'total\')" style="text-align:center">Cat Errors ↕</th>
              <th onclick="tsort(\'pct\')">Score %</th>
              <th>Severity</th>
              <th>Status</th>
              <th style="text-align:center">PDF</th>
            </tr>
          </thead>''',
    re.DOTALL
  ),

  # 4. Weight table thead
  (
    r'<!-- ERROR WEIGHT TABLE -->.*?<thead>.*?</thead>',
    lambda m: re.sub(
      r'<thead>.*?</thead>',
      '''<thead>
          <tr>
            <th>Agent</th>
            <th style="text-align:center">Audits</th>
            <th style="text-align:center;color:#2563eb">📞 CALL</th>
            <th style="text-align:center;color:#059669">💬 WHATSAPP</th>
            <th style="text-align:center;color:#d97706">📧 EMAIL</th>
            <th style="text-align:center;color:#64748b">📝 DESCRIPTION</th>
            <th style="text-align:center;color:#7c3aed">🎯 LEAD STAGE</th>
            <th style="text-align:center;color:#dc2626">💼 DEAL</th>
            <th style="text-align:center;color:#6366f1">✅ TASK</th>
            <th style="text-align:center;color:#0891b2">⏱️ FOLLOW UP</th>
            <th style="text-align:center">Cat Errors</th>
            <th style="text-align:center">Score %</th>
          </tr>
        </thead>''',
      m.group(0), flags=re.DOTALL),
    re.DOTALL
  ),

  # 5. Training Focus card
  (
    r'<!-- TRAINING FOCUS PANEL.*?</div>\s*</div>\s*</div>(?=\s*<!-- COMPLIANCE DISTRIBUTION)',
    '''<!-- TRAINING FOCUS PANEL -->
  <div class="card" style="margin-bottom:16px;overflow:hidden">
    <div class="ch">
      <div style="flex:1">
        <div class="ct">🎓 Training Focus — Click a Consultant</div>
        <div class="cs">Click any card to see their exact error breakdown · date filters apply</div>
      </div>
      <select id="trainingConsultantSel" style="display:none">
        <option value="">— Select a Consultant —</option>
      </select>
    </div>
    <div id="trainingPanel" style="padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;min-height:60px">
      <div style="color:var(--mu);font-size:13px;padding:12px;grid-column:1/-1;text-align:center">Loading consultants…</div>
    </div>
    <div id="trainingDetail" style="padding:0 16px 16px"></div>
  </div>
  <!-- COMPLIANCE DISTRIBUTION''',
    re.DOTALL
  ),
]

# ── Core patcher ─────────────────────────────────────────────────────────────
def find_function_bounds(html, fname):
    """Find start and end positions of a JS function in HTML."""
    patterns = [
        rf'(?:async\s+)?function\s+{re.escape(fname)}\s*\([^)]*\)\s*\{{',
        rf'(?:async\s+)?function\s+{re.escape(fname)}\s*\([^)]*\=(?:false|true)\)\s*\{{'
    ]
    m = None
    for pat in patterns:
        m = re.search(pat, html)
        if m:
            break
    if not m:
        return None, None
    start = m.start()
    depth, i = 0, m.end() - 1
    while i < len(html):
        if html[i] == '{':
            depth += 1
        elif html[i] == '}':
            depth -= 1
            if depth == 0:
                return start, i + 1
        i += 1
    return None, None

def patch_html(html):
    results = []

    # ── Replace JS functions ────────────────────────────────────────────────
    for fname, new_code in NEW_FUNCTIONS.items():
        start, end = find_function_bounds(html, fname)
        if start is not None:
            html = html[:start] + new_code + html[end:]
            results.append(f'✅ Replaced function: {fname}')
        else:
            # Function doesn't exist — inject before </script> closest to end
            inject_marker = html.rfind('// ── BOOT ──')
            if inject_marker == -1:
                inject_marker = html.rfind('hofFetch();')
            if inject_marker == -1:
                inject_marker = len(html) - 500
            html = html[:inject_marker] + '\n\n' + new_code + '\n\n' + html[inject_marker:]
            results.append(f'➕ Injected new function: {fname}')

    # ── Replace HTML snippets ───────────────────────────────────────────────
    for i, item in enumerate(HTML_REPLACEMENTS):
        if len(item) == 3:
            pattern, replacement, flags = item
        else:
            pattern, replacement = item
            flags = 0

        if callable(replacement):
            new_html, count = re.subn(pattern, replacement, html, count=1, flags=flags)
        else:
            new_html, count = re.subn(pattern, replacement.replace('\\', '\\\\'), html, count=1, flags=flags)

        if count > 0:
            html = new_html
            results.append(f'✅ HTML replacement {i+1} applied')
        else:
            results.append(f'⚠️  HTML replacement {i+1} not matched (may need manual apply)')

    return html, results

# ── Main ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    src = find_html_file()
    if not os.path.exists(src):
        print(f'❌ File not found: {src}')
        sys.exit(1)

    print(f'📄 Reading: {src}')
    with open(src, 'r', encoding='utf-8') as f:
        html = f.read()
    print(f'   Size: {len(html):,} chars')

    print('\n🔧 Applying patches...')
    patched, results = patch_html(html)

    for r in results:
        print(' ', r)

    out = 'HOF_Dashboard_PATCHED.html'
    with open(out, 'w', encoding='utf-8') as f:
        f.write(patched)

    print(f'\n✅ Done! Output: {out}')
    print(f'   Original size: {len(html):,} chars')
    print(f'   Patched size:  {len(patched):,} chars')
    print('\n📋 Next steps:')
    print('   1. Open HOF_Dashboard_PATCHED.html in your browser')
    print('   2. Update APIS.hof with your new Apps Script v5.1 URL')
    print('   3. Test the HOF Consultants tab')
