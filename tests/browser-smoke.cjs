/* Offline Chromium integration tests of the real page scripts and loader.
 * PEFL is completely intercepted; no account, cookies or game requests are used.
 * This does not test Chrome's extension installation UI or signed-in PEFL transport. */
const {chromium}=require('playwright'),iconv=require('iconv-lite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),ext=path.join(root,'CrabVIP');
const fixture=n=>fs.readFileSync(path.join(__dirname,'fixtures',n),'utf8');
const url=t=>'https://pefl.ru/plug.php?p=refl&t='+t;
const card=fixture('player-modern.html'),fieldCard=fixture('player-outfield.html'),report=fixture('report-1544766.html');
const shell=body=>'<html><head><meta charset="utf-8"><script src="/js/jquery-1.3.2.min.js"></script></head><body data-size="1200">'+body+'</body></html>';
let count=0;function ok(label){count++;console.log('PASS '+label);}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CRAB_TEST_CHROMIUM || undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const context=await browser.newContext({acceptDownloads:true});
 const errors=[],requests=[];let failCard=false;
 await context.route('**/*',async route=>{
   const request=route.request(),u=new URL(request.url());requests.push({method:request.method(),url:u.href});
   if(u.origin!=='https://pefl.ru')return route.abort();
   if(u.pathname.startsWith('/__extension/')){
     const rel=u.pathname.slice('/__extension/'.length),file=path.resolve(ext,rel);
     if(!file.startsWith(ext+path.sep)||!fs.existsSync(file))return route.abort();
     return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'text/plain',body:fs.readFileSync(file)});
   }
   // Unchanged adaptation UI receives a deterministic stub, not live adaptation values.
   if(u.pathname==='/js/adaptation5.en.js')return route.fulfill({contentType:'text/javascript',body:'var s_adaptationMap=Array.from({length:250},()=>Array(100).fill(100));'});
   if(u.pathname==='/js/jquery-1.3.2.min.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'vendor/jquery-1.3.2.min.js'))});
   if(u.pathname==='/plug.php'){
     let body='';
     if(u.searchParams.get('t')==='k')body=fixture('team-modern.html');
     else if(u.searchParams.get('t')==='p') {
       if(failCard && u.searchParams.get('j')==='65826')return route.fulfill({status:500,body:'Test server failure'});
       body=request.isNavigationRequest()?shell('<table class="border"><tr>'+fixture('player-page.html')+'</tr></table>'):(u.searchParams.get('j')==='65826'||u.searchParams.get('j')==='130489'?card:fieldCard);
     }
     else if(u.searchParams.get('t')==='if')body=shell(report);
     else if(u.searchParams.get('t')==='last')body=shell('<td class="back4">Только для VIP пользователей.</td>');
     else return route.fulfill({status:404,body:'Unknown test page'});
     return route.fulfill({contentType:'text/html; charset=windows-1251',body:iconv.encode(body,'windows-1251')});
   }
   return route.fulfill({status:200,contentType:'text/plain',body:''});
 });
 await context.addInitScript(()=>{
   window.chrome=window.chrome||{};window.chrome.runtime={getURL:p=>location.origin+'/__extension/'+p};
   if(!localStorage.getItem('test-seeded')){localStorage.setItem('myteamid','409');localStorage.setItem('test-seeded','1');localStorage.setItem('matches','old-key-kept');localStorage.setItem('matchespl','old-key-kept');}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack));
 async function visit(href){await page.goto(href);await page.addScriptTag({content:'(function(){'+fs.readFileSync(path.join(ext,'crab.js'),'utf8')+'\n})();'});}
 try {
   await visit(url('k')+'&j=99999&z=fixture');
   await page.waitForFunction(()=>document.querySelector('#showvip')?.textContent==='(загружено)',{},{timeout:15000});
   assert.equal(await page.evaluate(()=>Object.values(players).filter(Boolean).length),24);
   assert.equal(await page.evaluate(()=>team_cur.twage),2*9150+22*6830);
   assert.equal(await page.evaluate(()=>Number(team_cur.tss)),103.33);
   assert.equal(await page.evaluate(()=>Number(team_cur.avTopSumSkills)),105);
   ok('24/24 cards in windows-1251; mixed GK/outfield totals and top-16 average');
   assert.ok(await page.locator('#crabSuImportStatus').count());
   assert.equal(await page.evaluate(()=>localStorage.getItem('matches')),'old-key-kept');ok('collector panel appears and old history keys survive');
   // Real match markup: all page modules loaded in their original order.
   await visit(url('if')+'&j=1544766&n=65826&z=fixture');
   await page.locator('#crabSuReportResult').waitFor();
   let stored=await page.evaluate(()=>JSON.parse(localStorage.matchespl2));
   assert.equal(Object.values(stored).flat().find(r=>r.pid===65826).su_minutes,93);ok('report page automatically saves 93 minutes for goalkeeper #90');
   await visit(url('if')+'&j=1544766&n=65826&z=fixture');await page.locator('#crabSuReportResult').waitFor();
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.matchespl2)),stored);ok('revisiting a report does not duplicate history');
   await visit(url('k')+'&j=99999&z=fixture');await page.waitForFunction(()=>document.querySelector('#showvip')?.textContent==='(загружено)');
   await page.locator('#teamsu').click();
   assert.ok((await page.locator('#tblSu').innerText()).includes('Учтено минут'));
   const row=page.locator('#tblSu tr').filter({hasText:'Яношевич'});assert.match(await row.innerText(),/93/);
   await row.getByRole('link',{name:/Яношевич/}).click();assert.ok((await page.locator('#tblSuM').innerText()).includes('93'));
   assert.ok((await page.locator('#tblSuM a[href*="t=if"]').first().getAttribute('href')).includes('n=65826'));ok('SU and per-player match UI agree and retain player-specific report links');
   await page.getByRole('button',{name:'Из расписания (VIP)'}).click();await page.waitForFunction(()=>document.querySelector('#crabSuImportStatus').textContent.includes('только с VIP'));ok('VIP schedule error is actionable');
   await page.getByText('Импорт по ссылкам на протоколы',{exact:true}).click();
   await page.getByRole('textbox',{name:'Ссылки на протоколы'}).fill(url('if')+'&j=1544766&n=65826&z=fixture\n'+url('if')+'&j=1544766&n=65826&z=fixture');
   await page.getByRole('button',{name:'Загрузить протоколы',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#crabSuImportStatus').textContent.includes('сохранено: 1'));
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.matches2).length),1);ok('manual import deduplicates URLs and refreshes SU');
   const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать резервную копию'}).click();const d=await downloaded;
   const data=JSON.parse(fs.readFileSync(await d.path(),'utf8'));assert.equal(data.format,'CrabVIP-localStorage-v1');assert.equal(data.data.matches,'old-key-kept');assert.ok(data.data.crabSuBackupV213);ok('downloaded backup contains old history and automatic pre-import snapshot');
   await visit(url('p')+'&j=65826&z=fixture');await page.locator('#crabSuPlayerImport').waitFor();await page.locator('#crabSuPlayerImport').click();await page.waitForFunction(()=>document.querySelector('#crabSuImportStatus').textContent.includes('сохранено: 1'));ok('non-VIP import from the player Matches panel');
   failCard=true;await visit(url('k')+'&j=99999&z=fixture');await page.waitForFunction(()=>document.querySelector('#showvip')?.textContent.includes('23/24'));assert.equal(await page.locator('#showvip').getAttribute('title'),'HTTP 500');
   failCard=false;await page.locator('#showvip').click();await page.waitForFunction(()=>document.querySelector('#showvip')?.textContent==='(загружено)');ok('one failed card shows partial status; retry recovers all totals');
   assert.equal(await page.evaluate(()=>Object.keys(players).every(k=>Number(k)===Number(players[k].id))),true);ok('sorting never changes player ID mapping');
   // Names are data, including quotes and HTML-like characters.
   await page.evaluate(()=>{const rows=JSON.parse(localStorage.matchespl2);rows["O'Name <tag>"]=[{id:1544766,pid:900001,mr:'6.0',su_minutes:17}];localStorage.matchespl2=JSON.stringify(rows);ShowSU(true);});
   await page.getByRole('link',{name:"O'Name <tag>",exact:true}).click();assert.ok((await page.locator('#tblSuM').innerText()).includes("O'Name <tag>"));assert.equal(await page.locator('#tblSu tag').count(),0);ok('quoted and HTML-like names stay text and open match history');
   await page.evaluate(()=>{const f=Array(26).fill('0');f[14]='1';localStorage.scripts=f.join(':');});
   await visit(url('if')+'&j=1544766&z=fixture');await page.waitForFunction(()=>typeof CrabData!=='undefined');assert.equal(await page.locator('#crabSuReportResult').count(),0);ok('disabled match module disables automatic collection');
   assert.ok(requests.every(r=>r.method==='GET'));assert.deepEqual(errors,[]);ok('no JavaScript errors or write requests during tested flows');
   console.log(count+' offline Chromium integration checks passed. Browser: '+await browser.version());
 } catch(e){console.error('Page errors:',errors);console.error('Current body:',(await page.locator('body').innerText()).slice(-3000));throw e;}
 finally {await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
