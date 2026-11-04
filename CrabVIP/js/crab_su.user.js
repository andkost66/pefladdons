/* Local minutes tracker. Only same-origin GETs; no game settings are submitted. */
(function() {
  'use strict';
  const statusId = 'crabSuImportStatus';
  const ownId = () => Number(localStorage.getItem('myteamid')) || 0;
  function status(message) { const el=document.getElementById(statusId); if(el) el.textContent=message; }
  function team() {
    let roster={}; try { roster=JSON.parse(localStorage.getItem('crabSuRoster')||'{}'); } catch(_) {}
    return {id:ownId(),roster};
  }
  function backup() {
    if(localStorage.getItem('crabSuBackupV213')!==null) return;
    const keys=['matches2','matchespl2','plexl','myteamid','crabSuRoster'];
    localStorage.setItem('crabSuBackupV213',JSON.stringify(Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)]))));
  }
  function downloadBackup() {
    const data={format:'CrabVIP-localStorage-v1',origin:location.origin,created:new Date().toISOString(),data:{}};
    for(let i=0;i<localStorage.length;i++) { const k=localStorage.key(i); data.data[k]=localStorage.getItem(k); }
    const href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=href;link.download='CrabVIP-backup-'+new Date().toISOString().slice(0,10)+'.json';
    link.click();setTimeout(()=>URL.revokeObjectURL(href),30000);
  }
  function save(doc,href) {
    const parsed=CrabData.parseReport(doc,href,team());
    if(!parsed) return false;
    backup();CrabData.persist(localStorage,parsed);return true;
  }
  function linksFrom(doc,base) {
    const links=new Map();
    for(const a of doc.querySelectorAll('a[href]')) {
      try { const u=CrabData.readUrl(a.getAttribute('href'),base);
        if(u.searchParams.get('t')==='if' && /^\d+$/.test(u.searchParams.get('j')) && u.searchParams.get('z')) links.set(u.searchParams.get('j'),u.href);
      } catch(_) {}
    }
    return Array.from(links.values());
  }
  let busy=false;
  async function importLinks(hrefs) {
    if(busy) return;
    const unique=new Map();
    try {
      for(const href of hrefs) {
        const u=CrabData.readUrl(href,location.href);
        if(u.searchParams.get('t')!=='if' || !/^\d+$/.test(u.searchParams.get('j')) || !u.searchParams.get('z')) throw Error('Нужны полные ссылки на протоколы матчей');
        unique.set(u.searchParams.get('j'),u.href);
      }
      if(!unique.size) throw Error('Нет ссылок на протоколы. Откройте сыгранный матч: его минуты сохранятся автоматически.');
      if(unique.size>100) throw Error('За один импорт можно обработать до 100 протоколов');
      backup();busy=true;
      let ok=0,failed=0,lastError='';
      for(const href of unique.values()) {
        try { if(save(await CrabData.getPage(href,location.href,window),href)) ok++; else { failed++;lastError='Протокол не завершён, чужой клуб или неизвестная разметка'; } }
        catch(e) { failed++; lastError=e.message; }
        status('Обработано '+(ok+failed)+'/'+unique.size+'; сохранено: '+ok+'; пропущено: '+failed+(lastError?' — '+lastError:''));
        if(ok+failed<unique.size) await new Promise(r=>setTimeout(r,700));
      }
      if(typeof window.ShowSU==='function') window.ShowSU(true);
    } catch(e) {status(e.message);} finally {busy=false;}
  }
  function setupTeam() {
    const anchor=document.getElementById('teamsu');
    if(!anchor || !ownId() || typeof team_cur==='undefined' || Number(team_cur.tid)!==ownId()) return false;
    if(document.getElementById(statusId)) return true;
    const roster={};
    for(const p of Object.values(players)) if(p && p.id && p.name) roster[p.id]=p.name;
    try { backup();localStorage.setItem('crabSuRoster',JSON.stringify(roster)); } catch(e) {console.warn('CrabVIP backup:',e.message);}
    const block=document.createElement('div');block.style.cssText='font-size:11px;max-width:245px;white-space:normal;margin-top:6px';
    const info=document.createElement('div');info.id=statusId;
    const add=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);block.append(b);return b;};
    add('Скачать резервную копию',downloadBackup);
    add('Из расписания (VIP)',async()=>{
      if(busy) return;
      const link=document.querySelector('td.back4 a[href*="t=last"]');
      if(!link) {status('Не найдена ссылка на расписание');return;}
      try {status('Чтение расписания…');await importLinks(linksFrom(await CrabData.getPage(link.href,location.href,window),link.href));}
      catch(e) {status(e.message);}
    });
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Импорт по ссылкам на протоколы';details.append(summary);
    const input=document.createElement('textarea');input.rows=4;input.style.width='95%';input.setAttribute('aria-label','Ссылки на протоколы');input.placeholder='По одной ссылке на строку';details.append(input);
    const b=document.createElement('button');b.type='button';b.textContent='Загрузить протоколы';b.addEventListener('click',()=>importLinks(input.value.split(/\s+/).filter(Boolean)));details.append(b);
    block.append(details,info);anchor.after(block);
    try { const data=CrabData.readStore(localStorage,'matches2',[]);status('Матчей в базе: '+Object.values(data).filter(Boolean).length+'. Учёт минут по загруженным протоколам.'); } catch(e) {status(e.message);}
    return true;
  }
  function setupPlayer() {
    const panel=document.getElementById('m3');
    if(!panel || !ownId() || document.getElementById('crabSuPlayerImport')) return;
    const button=document.createElement('button');button.id='crabSuPlayerImport';button.type='button';
    button.textContent='Собрать минуты клуба из показанных матчей';
    button.addEventListener('click',()=>importLinks(linksFrom(panel,location.href)));
    const info=document.createElement('div');info.id=statusId;
    info.textContent='Откройте вкладку «Матчи», затем запустите сбор. Это список матчей игрока, а не полный сезон клуба.';
    panel.append(button,info);
  }
  function start() {
    const u=new URL(location.href);
    if(u.searchParams.get('p')!=='refl') return;
    if(u.searchParams.get('t')==='if') {
      const collect=()=>{
        if(document.getElementById('crabSuReportResult')) return;
        let message;
        try {if(!save(document,location.href))return;message='CrabVIP 2.1.3: минуты матча сохранены. Добавленное время учтено.';}
        catch(e){message='CrabVIP: '+e.message;}
        const note=document.createElement('p');note.id='crabSuReportResult';note.textContent=message;
        const target=document.getElementById('stat1');if(target)target.before(note);
      };
      collect();setTimeout(collect,1500);
    } else if(['p','pp'].includes(u.searchParams.get('t'))) {
      setupPlayer();
      const observer=new MutationObserver(setupPlayer);observer.observe(document.documentElement,{childList:true,subtree:true});
    } else if(u.searchParams.get('t')==='k') {
      if(!setupTeam()) {const observer=new MutationObserver(()=>{if(setupTeam())observer.disconnect();});observer.observe(document.documentElement,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),15000);}
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
