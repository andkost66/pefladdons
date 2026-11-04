/* Shared, side-effect-free parsers. PEFL DOM is data, never executable code. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrabData = api;
})(typeof window === 'object' ? window : this, function() {
  'use strict';
  const text = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  const safeKey = key => !['__proto__', 'constructor', 'prototype'].includes(key);
  const money = value => { const m = value.match(/([\d,\s.]+)\s*\$/); return m ? Number(m[1].replace(/[^\d]/g, '')) : null; };
  function parsePlayer(doc) {
    const table = doc.querySelector('table#skills');
    if (!table) return null;
    const skills = {}, changed = [];
    for (const label of table.querySelectorAll('td[id]')) {
      if (label.querySelector('.shidden')) continue;
      const cell = label.nextElementSibling;
      const value = Number(text(cell && cell.querySelector('span.skills')));
      if (!cell || !cell.querySelector('span.skills') || !Number.isInteger(value) || value < 0 || value > 20) continue;
      const arrow = cell.querySelector('span.arrow img');
      const match = arrow && arrow.getAttribute('src').match(/\/([^/]+)\.(?:gif|png)$/);
      skills[label.id] = value + (match ? '.' + match[1] : '');
      if (text(cell.querySelector('span.arrow')).includes('*')) changed.push(label.id);
    }
    if (Object.keys(skills).length !== 18) return null;
    const field = name => Array.from(doc.querySelectorAll('#maininfo tr')).find(r => text(r.cells[0]) === name);
    const value = field('Номинал:'), contract = field('Контракт:');
    const terms = text(contract && contract.cells[1]);
    const years = terms.match(/^(\d+)\s*г/);
    const nominal = money(text(value && value.cells[1])), wage = money(terms);
    if (nominal === null || wage === null || !years) return null;
    const sumskills = Object.values(skills).reduce((sum, n) => sum + parseInt(n, 10), 0);
    return Object.assign(skills, {sumskills, sorting:sumskills, skchange:changed.join(','),
      value:nominal, wage, contract:Number(years[1]), valuech:0,
      natfull:text(doc.querySelector('#nation0')).replace(/U21$/, '').trim(),
      rent:/в аренде из клуба/.test(text(doc.querySelector('#team0')))});
  }
  function readUrl(href, base) {
    const url = new URL(href, base), origin = new URL(base).origin;
    if (url.origin !== origin || url.username || url.password || url.pathname !== '/plug.php') throw Error('Разрешены только страницы PEFL этого сайта');
    const p = url.searchParams.get('p'), t = url.searchParams.get('t');
    if (!(p === 'calendar' || (p === 'refl' && ['p','pp','if','last','s','ss'].includes(t)))) throw Error('Это не страница данных PEFL');
    return url;
  }
  function accessError(doc) {
    const main = doc.querySelector('td.back4') || doc.body;
    if (/Только для VIP пользователей/i.test(text(main))) return 'Эта страница доступна только с VIP. Откройте доступный протокол матча для сбора его минут.';
    if (/Вы не залогинились/.test(text(doc.body)) || doc.querySelector('input[type="password"]')) return 'Нужно войти в PEFL';
    return '';
  }
  function getPage(href, base, env) {
    return new Promise((resolve,reject) => {
      let url;
      try { url = readUrl(href, base); } catch(e) { reject(e); return; }
      const xhr = new env.XMLHttpRequest();
      xhr.open('GET', url.href, true);
      xhr.timeout = 20000;
      // responseText respects PEFL's windows-1251 HTTP charset, unlike fetch().text().
      xhr.onload = () => {
        try {
          if (xhr.status < 200 || xhr.status >= 300) throw Error('HTTP ' + xhr.status);
          if (xhr.responseURL) readUrl(xhr.responseURL, base);
          const doc = new env.DOMParser().parseFromString(xhr.responseText, 'text/html');
          const error = accessError(doc); if (error) throw Error(error);
          resolve(doc);
        } catch(e) { reject(e); }
      };
      xhr.onerror = () => reject(Error('Нет ответа PEFL. Проверьте соединение и доступ к странице; откройте протокол вручную.'));
      xhr.ontimeout = () => reject(Error('PEFL не ответил за 20 секунд'));
      xhr.onabort = () => reject(Error('Загрузка отменена'));
      xhr.send();
    });
  }
  function parseReport(doc, href, team) {
    const url = new URL(href);
    if (url.searchParams.get('p') !== 'refl' || url.searchParams.get('t') !== 'if' || !id(url.searchParams.get('j')) || !id(team.id)) return null;
    const head = doc.querySelector('#stat1 tr'), lineup = doc.querySelector('#pls'), report = doc.querySelector('#report');
    if (!head || !lineup || !report || !/Матч завершен|Финальный свисток/.test(text(report))) return null;
    const score = text(head.cells[1]).match(/^(\d+):(\d+)$/);
    const badges = Array.from(doc.querySelectorAll('#stat2 img[src*="club/"]'));
    const ids = badges.map(img => id((img.getAttribute('src').match(/club\/(\d+)\./)||[])[1]));
    if (!score || ids.length !== 2 || !ids[0] || !ids[1] || ids[0] === ids[1]) return null;
    const side = ids.indexOf(Number(team.id));
    if (side < 0) return null;
    const names = [text(head.cells[0]),text(head.cells[2])];
    const events = Array.from(report.querySelectorAll('p')).map(p => ({
      minute:Number((text(p.querySelector('b')).match(/^(\d+)\s*минут/)||[])[1]),
      code:text(p.querySelector('.hid'))
    })).filter(e => Number.isFinite(e.minute));
    if (!events.length) return null;
    const maxMinute = Math.max(...events.map(e=>e.minute));
    if (maxMinute < 90 || maxMinute > 135) return null;
    const duration = maxMinute; // PEFL's player history includes added time (e.g. 93 minutes).
    const slots = new Map();
    for (const cell of lineup.querySelectorAll('td[id^="pl"]')) {
      const n = id(cell.id.slice(2)), player = cell.querySelector('a[id^="p"]');
      if (!n || n <= side*20 || n > (side+1)*20 || !player) continue;
      const slot = n-side*20, pid = id(player.id.slice(1));
      const name = (team.roster && team.roster[pid]) || text(player);
      if (!pid || !name || !safeKey(name) || slots.has(slot)) return null;
      const mark = text(cell.nextElementSibling).match(/\((\d+)\)/);
      const rating = text(cell.nextElementSibling && cell.nextElementSibling.nextElementSibling).match(/^\d+(?:[.,]\d+)?$/);
      slots.set(slot,{pid,name,reportName:text(player),slot,start:slot<=11?0:null,end:duration,mark:mark?Number(mark[1]):null,
        rating:rating?rating[0].replace(',','.'):null,subsIn:0,subsOut:0,red:false});
    }
    if (Array.from({length:11},(_,i)=>i+1).some(n=>!slots.has(n))) return null;
    const uniqueEvents = new Set();
    for (const event of events) {
      for (const m of event.code.matchAll(/_S([12])_(\d+)_(\d+)_|_R([12])_(\d+)_/g)) {
        if (Number(m[1]||m[4]) !== side+1) continue;
        const key = event.minute+':'+m[0]; if (uniqueEvents.has(key)) continue; uniqueEvents.add(key);
        const minute = Math.min(event.minute,duration), out = slots.get(Number(m[2]||m[5]));
        if (!out || out.start === null || out.subsOut || out.red || minute<out.start) return null;
        out.end = minute;
        if (m[1]) {
          const incoming = slots.get(Number(m[3]));
          if (!incoming || incoming.start !== null) return null;
          incoming.start = minute; incoming.subsIn++; out.subsOut++;
        } else out.red = true;
      }
    }
    const players = [];
    for (const pl of slots.values()) {
      // A column alone cannot disambiguate a substitute later substituted again.
      // Refuse incomplete event markup instead of inventing participation intervals.
      if (pl.slot > 11 && pl.start === null && pl.rating !== null) return null;
      if (pl.slot <= 11 && !pl.subsOut && !pl.red && pl.mark !== null) return null;
      if (pl.start === null) continue;
      if (pl.rating === null || pl.end < pl.start) return null;
      const row = {id:id(url.searchParams.get('j')),pid:pl.pid,mr:pl.rating,su_minutes:pl.end-pl.start};
      if (pl.start>0 || pl.slot>11) row.in=1;
      if (pl.end-pl.start!==duration) row.m=pl.end-pl.start;
      if (pl.red) row.cr='r';
      players.push({name:pl.name,reportName:pl.reportName,row});
    }
    if (players.length<11 || new Set(players.map(p=>p.row.pid)).size!==players.length) return null;
    const match = {id:id(url.searchParams.get('j')),m:duration,res:score[0],hid:ids[0],aid:ids[1],su_team:id(team.id)};
    if (url.searchParams.get('z')) match.h=url.searchParams.get('z');
    if (id(url.searchParams.get('n'))) match.report_n=id(url.searchParams.get('n'));
    match[side===0?'anm':'hnm']=names[1-side];
    return {match,players};
  }
  function readStore(storage,key,fallback) {
    const value = storage.getItem(key);
    if (value === null) return fallback;
    let data; try { data = JSON.parse(value); } catch (_) { throw Error('Повреждены '+key+'. Сначала сохраните резервную копию; история не перезаписана.'); }
    if (!data || typeof data !== 'object') throw Error('Неверный формат '+key);
    return data;
  }
  function mergeReport(oldMatches, oldPlayers, report) {
    if (!Array.isArray(oldMatches) || Array.isArray(oldPlayers) || !oldPlayers || typeof oldPlayers!=='object') throw Error('Неверный формат истории');
    const byId = new Map();
    for(const m of oldMatches) if(m && id(m.id)) byId.set(id(m.id),Object.assign({},byId.get(id(m.id)),m));
    const previous = byId.get(report.match.id)||{};
    const match=Object.assign({},previous,report.match);
    // Remove only obsolete own-team names, keep manual flags/date/type.
    if(report.match.hnm===undefined) delete match.hnm;
    if(report.match.anm===undefined) delete match.anm;
    if(report.match.report_n===undefined) delete match.report_n;
    byId.set(match.id,match);
    const players = Object.create(null), aliases = new Map(), hidden = new Map();
    for (const [name,records] of Object.entries(oldPlayers)) {
      if(!safeKey(name) || !records || typeof records!=='object') throw Error('Неверная история игрока');
      players[name]=[];
      for (const [key,r] of Object.entries(records)) {
        if(!r || typeof r!=='object') continue;
        const row=Object.assign({},r,{id:id(r.id)||id(key)});
        if(!row.id) continue;
        if(id(row.pid)) aliases.set(id(row.pid),name);
        if(row.id===match.id) hidden.set(id(row.pid)||name,row);
        else players[name].push(row);
      }
    }
    for (const p of report.players) {
      let name = aliases.get(p.row.pid) || p.name;
      // Old versions keyed history by the report's abbreviated name, without player IDs.
      // Reuse that key only when this report gives an unambiguous match.
      if(!aliases.has(p.row.pid) && p.reportName && players[p.reportName] &&
        report.players.filter(other=>other.reportName===p.reportName).length===1 &&
        Object.values(oldPlayers[p.reportName]).every(r=>!r || !id(r.pid) || id(r.pid)===p.row.pid)) name=p.reportName;
      if(!safeKey(name)) throw Error('Неверное имя игрока');
      if(players[name] && players[name].some(r=>id(r.pid)&&id(r.pid)!==p.row.pid)) name+=' ['+p.row.pid+']';
      if(!players[name]) players[name]=[];
      const old = hidden.get(p.row.pid)||hidden.get(name)||{};
      const row=Object.assign({},p.row);
      if(Object.prototype.hasOwnProperty.call(old,'h')) row.h=old.h;
      players[name].push(row);
    }
    return {matches:Array.from(byId.values()),players};
  }
  function persist(storage, report) {
    const oldM=storage.getItem('matches2'),oldP=storage.getItem('matchespl2');
    const data=mergeReport(readStore(storage,'matches2',[]),readStore(storage,'matchespl2',{}),report);
    // A recoverable journal precedes both writes; quota errors cannot silently reset history.
    const journal=JSON.stringify({matches2:oldM,matchespl2:oldP});
    storage.setItem('crabSuRecovery',journal);
    try {
      storage.setItem('matches2',JSON.stringify(data.matches));
      storage.setItem('matchespl2',JSON.stringify(data.players));
    } catch(e) {
      try { for(const [k,v] of [['matches2',oldM],['matchespl2',oldP]]) v===null?storage.removeItem(k):storage.setItem(k,v); } catch(_) {}
      throw Error('Не удалось сохранить историю. Исходные данные находятся в crabSuRecovery.');
    }
    return data.matches.length;
  }
  return {parsePlayer,parseReport,getPage,readUrl,accessError,readStore,mergeReport,persist};
});
