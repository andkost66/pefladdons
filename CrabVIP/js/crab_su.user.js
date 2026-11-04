// CrabVIP: local collection of played minutes for the Сверхусталость screen.
// Only reads PEFL reports and the manager's schedule. No POST or external requests.
(function () {
  'use strict';
  const KEY_MATCHES = 'matches2', KEY_PLAYERS = 'matchespl2';
  const STATUS_ID = 'crabSuImportStatus';

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (err) { console.warn('CrabVIP SU: invalid storage', key, err); return fallback; }
  }
  function positiveId(v) {
    const n = Number(v);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  }
  function badgeId(img) {
    const src = img && img.getAttribute('src') || '';
    const m = src.match(/(?:^|\/)club\/(\d+)\.(?:gif|png|webp)/i);
    return m ? positiveId(m[1]) : 0;
  }
  function parseReport(doc, href) {
    const url = new URL(href, location.href);
    if (url.searchParams.get('p') !== 'refl' || url.searchParams.get('t') !== 'if') return null;
    const id = positiveId(url.searchParams.get('j'));
    const ownId = positiveId(localStorage.getItem('myteamid'));
    const jq = window.jQuery;
    if (!id || !ownId || !jq) return null;
    const $main = jq(doc).find('td.back4').first();
    if (!$main.length) return null;
    const $head = $main.find('table').eq(3).find('tr:first td');
    const homeName = $head.eq(0).text().trim(), awayName = $head.eq(2).text().trim();
    const score = $head.eq(1).text().match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    if (!score || !homeName || !awayName) return null;
    const $badges = $main.find('table').eq(4).find('img[src*="club/"]');
    const homeId = badgeId($badges.get(0)), awayId = badgeId($badges.get($badges.length-1));
    let side = -1;
    if (homeId && awayId && homeId !== awayId)
      side = homeId === ownId ? 0 : (awayId === ownId ? 1 : -1);
    if (side < 0) {
      const ownName = localStorage.getItem('crabSuTeamName') || '';
      if (ownName && ownName === homeName && ownName !== awayName) side = 0;
      else if (ownName && ownName === awayName && ownName !== homeName) side = 1;
    }
    if (side < 0) return null;

    let $cells = $main.find('table').eq(6).find('td[id^="p"]');
    if ($cells.length < 20) {
      const $tables = $main.find('table').filter(function () {
        return jq(this).find('td[id^="p"]').length >= 20;
      });
      if ($tables.length !== 1) return null;
      $cells = $tables.eq(0).find('td[id^="p"]');
    }
    // The known PEFL report layout interleaves home/away players.
    if ($cells.length < 20 || $cells.length % 2) return null;
    const lastKey = $main.find('p.key').last().text().trim();
    const lastMinute = parseInt(lastKey, 10);
    const duration = Number.isFinite(lastMinute) && lastMinute > 105 && lastMinute <= 125 ? 120 : 90;
    const players = [], seen = new Set();
    $cells.each(function(index) {
      if (index % 2 !== side) return;
      const $cell = jq(this);
      const number = parseInt($cell.prev('td').text(), 10);
      if (!Number.isInteger(number) || number < 1 || number > 18) return;
      const name = ($cell.find('a[href^="javascript"]').first().text() ||
        $cell.find('a').first().text()).trim().replace(/\s+/g, ' ');
      if (!name || seen.has(name)) return;
      const minuteText = $cell.next('td').text();
      const mark = minuteText.match(/\(\s*(\d{1,3})\s*(?:['’′]|мин\.?)?\s*\)/i);
      const starter = number <= 11;
      if (!starter && !mark) return; // Unused substitute.
      const minute = mark ? (starter ? +mark[1] : duration - +mark[1]) : duration;
      if (!Number.isFinite(minute) || minute <= 0 || minute > duration) return;
      const ratingText = $cell.next('td').next('td').text();
      const rating = ratingText.match(/\d{1,2}[.,]\d{1,2}/);
      const row = { id, mr: rating ? rating[0].replace(',', '.') : '?', su_minutes: minute };
      if (minute !== duration) row.m = minute;
      if (!starter) row['in'] = 1;
      players.push({ name, row });
      seen.add(name);
    });
    if (players.length < 10 || players.length > 18) return null;
    const match = {
      id, m:duration, res:score[1]+':'+score[2],
      h: url.searchParams.get('z') || undefined
    };
    if (homeId) match.hid = homeId;
    if (awayId) match.aid = awayId;
    if (side !== 0) match.hnm = homeName;
    if (side !== 1) match.anm = awayName;
    return { match, players };
  }

  function persist(report) {
    const oldMatches = read(KEY_MATCHES, []);
    const matches = Array.isArray(oldMatches) ? oldMatches.filter(x => x && positiveId(x.id)) : [];
    const previous = matches.find(x => +x.id === report.match.id);
    if (previous) Object.assign(previous, report.match); // Keep saved date/type/SU flag.
    else matches.push(report.match);
    const oldPlayers = read(KEY_PLAYERS, {});
    const players = oldPlayers && typeof oldPlayers === 'object' && !Array.isArray(oldPlayers)
      ? oldPlayers : {};
    for (const name of Object.keys(players)) {
      if (Array.isArray(players[name]))
        players[name] = players[name].filter(p => p && +p.id !== report.match.id);
    }
    for (const person of report.players) {
      if (!Array.isArray(players[person.name])) players[person.name] = [];
      players[person.name].push(person.row);
    }
    localStorage.setItem(KEY_MATCHES, JSON.stringify(matches));
    localStorage.setItem(KEY_PLAYERS, JSON.stringify(players));
    return matches.length;
  }

  async function getPage(href) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) throw Error('Другой сайт');
    const response = await fetch(url.href, { credentials: 'same-origin' });
    if (!response.ok) throw Error('HTTP ' + response.status);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }
  function status(message) {
    const el = document.getElementById(STATUS_ID);
    if (el) el.textContent = message;
  }
  function scheduleMatches(page) {
    const result = [], known = new Set();
    page.querySelectorAll('a[href]').forEach(a => {
      try {
        const url = new URL(a.getAttribute('href'), location.href);
        const id = positiveId(url.searchParams.get('j'));
        if (url.origin !== location.origin || url.searchParams.get('p') !== 'refl' ||
            url.searchParams.get('t') !== 'if' || !url.searchParams.get('z') ||
            !id || known.has(id)) return;
        known.add(id);
        result.push(url.href);
      } catch (_) {}
    });
    return result;
  }
  async function importSeason(button) {
    const link = document.querySelector('td.back4 a[href*="t=last"]');
    if (!link) { status('Не найдена ссылка на расписание'); return; }
    button.disabled = true;
    try {
      status('Чтение расписания...');
      const page = await getPage(link.href);
      const links = scheduleMatches(page).slice(0, 50);
      if (!links.length) { status('В расписании нет ссылок на сыгранные матчи'); return; }
      let ok=0, failed=0;
      for (const href of links) {
        try {
          const parsed = parseReport(await getPage(href), href);
          if (parsed) { persist(parsed); ok++; }
          else failed++;
        } catch (e) { failed++; console.warn('CrabVIP SU: report unavailable', e); }
        status('Обработано ' + (ok+failed) + '/' + links.length +
          '; сохранено: ' + ok + '; не распознано: ' + failed);
        await new Promise(resolve => setTimeout(resolve, 650));
      }
      status('Сохранено: ' + ok + ', не распознано: ' + failed +
        '. Обнови страницу, чтобы увидеть таблицу.');
    } catch (e) {
      status('Ошибка чтения расписания: ' + e.message);
    } finally { button.disabled = false; }
  }

  function setupTeam() {
    const anchor = document.getElementById('teamsu');
    if (!anchor) return false;
    if (document.getElementById(STATUS_ID)) return true;
    const jq = window.jQuery;
    const viewedId = jq ? parseInt(jq('td.back4 table:first table td:first').text(), 10) : 0;
    const ownId = positiveId(localStorage.getItem('myteamid'));
    if (!ownId || viewedId !== ownId) return true;
    const name = jq('td.back4 table table table:first td:last').first().text().split(' (')[0].trim();
    if (name) localStorage.setItem('crabSuTeamName', name);
    const block = document.createElement('div');
    block.style.cssText = 'font-size:11px;margin-top:4px;max-width:240px;white-space:normal';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Собрать СУ из расписания';
    button.title = 'Читает сохранённые протоколы, ничего не меняет в клубе';
    const info = document.createElement('div');
    info.id = STATUS_ID;
    info.style.marginTop = '4px';
    const stored = read(KEY_MATCHES, []);
    info.textContent = 'Матчей в базе: ' + (Array.isArray(stored) ? stored.length : 0) +
      '. Оценка по загруженным минутам, не официальная СУ.';
    block.append(button, info);
    anchor.parentNode.insertBefore(block, anchor.nextSibling);
    button.addEventListener('click', () => importSeason(button));
    return true;
  }

  function start() {
    const url = new URL(location.href);
    if (url.searchParams.get('p') !== 'refl') return;
    if (url.searchParams.get('t') === 'if') {
      const collect = () => {
        try { const report = parseReport(document, location.href); if (report) persist(report); }
        catch(e) { console.warn('CrabVIP SU: parse failed', e); }
      };
      collect();
      setTimeout(collect, 1500);
    } else if (url.searchParams.get('t') === 'k') {
      if (!setupTeam()) {
        const obs = new MutationObserver(() => { if (setupTeam()) obs.disconnect(); });
        obs.observe(document.documentElement, { subtree:true, childList:true });
        setTimeout(() => obs.disconnect(), 15000);
      }
    }
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
