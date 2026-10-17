/* Real browser bootstrap with synthetic releases/account data. No public account is used. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const acorn=require('acorn'),{chromium}=require('playwright'),createUpdater=require('../auto/updater.js');
const root=path.join(__dirname,'..'),initialText=fs.readFileSync(path.join(root,'runtime.json'),'utf8'),initial={descriptor:JSON.parse(fs.readFileSync(path.join(root,'update.json'),'utf8')),text:initialText};
const loader=fs.readFileSync(path.join(root,'auto/loader.html'),'utf8');
const installedVersion=initial.descriptor.version,parts=installedVersion.split('.').map(Number);
const nextVersion=parts[0]+'.'+parts[1]+'.'+(parts[2]+1),failedVersion=parts[0]+'.'+parts[1]+'.'+(parts[2]+2);
function release(v){const data=JSON.parse(initialText);data.version=v;for(const key in data.files)data.files[key]=data.files[key].split(installedVersion).join(v);const text=JSON.stringify(data);return {descriptor:{schema:1,bootstrap:1,version:v,ref:'v'+v,sha256:crypto.createHash('sha256').update(text).digest('hex')},text};}
(async()=>{
 for(const file of ['auto/updater.js','auto/service.js'])acorn.parse(fs.readFileSync(path.join(root,file),'utf8'),{ecmaVersion:5});
 for(const script of loader.matchAll(/<script>([\s\S]*?)<\/script>/g))acorn.parse(script[1],{ecmaVersion:5});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stremio-auto-test-'));let latest=initial,broken=false,offline=false,requests=[];
 function download(url,limit,cb){requests.push(url);setTimeout(()=>{if(offline)return cb(new Error('offline'));if(url.includes('update.json'))return cb(null,JSON.stringify(latest.descriptor));cb(null,broken?latest.text.slice(0,-8):latest.text);},10);}
 let controller=createUpdater({bundled:initial,cacheDir:dir,download});await new Promise(r=>controller.server.listen(17780,'127.0.0.1',r));
 const parent=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(loader);});await new Promise(r=>parent.listen(8081,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{
  localStorage.setItem('sl.auth',JSON.stringify('synthetic-local-account'));
  localStorage.setItem('sl.progress',JSON.stringify({'fixture':{seconds:42,duration:120}}));
  localStorage.setItem('sl.hiddenCatalogs',JSON.stringify(['synthetic-hidden-preference']));
  window.avCalls=[];window.webapis={avplay:{open(){avCalls.push('open');},setDisplayRect(){},setListener(l){window.listener=l;},prepareAsync(ok){setTimeout(ok,5);},play(){avCalls.push('play');},getDuration(){return 120000;},stop(){avCalls.push('stop');},close(){},pause(){}}};
 });
 await page.route('**/request',route=>route.fulfill({json:{data:{metas:[]}}}));
 async function api(route,token){const res=await fetch('http://127.0.0.1:17780'+route,{method:token?'POST':'GET',headers:token?{'X-Stremio-Auto':token}:{}});return {status:res.status,data:await res.json()};}
 try{
  assert.equal((await fetch('http://127.0.0.1:17780/auto/status',{headers:{Origin:'https://foreign.example'}})).status,403);
  assert.equal((await fetch('http://127.0.0.1:17780/auto/launch',{method:'POST'})).status,403);
  await page.goto('http://127.0.0.1:8081/module/permanent/auto/loader.html');await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('heading',{name:'Automatic updates',exact:true}).waitFor();
  assert.equal(new URL(page.url()).origin,'http://127.0.0.1:8081');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.auth'))),'synthetic-local-account');
  assert.match(await page.locator('#status').textContent(),new RegExp(installedVersion.replace(/\./g,'\\.')));
  assert.equal(await page.locator('#pause use').getAttribute('xlink:href'),'#player-pause');
  await page.getByRole('button',{name:'Play test video'}).click();await page.waitForFunction(()=>avCalls.includes('play'));
  latest=release(nextVersion);await new Promise(r=>controller.check(r));
  assert.equal(controller.info().installed,installedVersion);assert.equal(controller.info().available,nextVersion);
  assert.equal(await page.locator('#player').isVisible(),true,'checking must not interrupt the player');
  assert.equal(await page.evaluate(()=>avCalls.includes('stop')),false);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.getByRole('button',{name:'Reopen app',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.locator('#status').filter({hasText:nextVersion}).waitFor();
  assert.equal((await api('/health')).data.version,nextVersion);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.progress')).fixture.seconds),42);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.hiddenCatalogs'))),['synthetic-hidden-preference']);
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();await page.getByText('Installed '+nextVersion+' · No update waiting',{exact:true}).waitFor();
  await page.screenshot({path:path.join(root,'artifacts/automatic-updates-settings.jpg')});
  latest=release(failedVersion);broken=true;await new Promise(r=>controller.check(r));assert.equal(controller.info().available,null);assert.equal(controller.info().installed,nextVersion);
  broken=false;const token=(await api('/auto/status')).data.token;
  const failedBoot=await api('/auto/launch',token);assert.equal(failedBoot.data.version,failedVersion);
  const rolledBack=await api('/auto/launch',token);assert.equal(rolledBack.data.version,nextVersion,'an unconfirmed app start must roll back on the next opening');
  assert.match(rolledBack.data.html,/window.StremioAuto=/);assert(!rolledBack.data.html.includes('player-icons.svg#'));
  assert.equal((await api('/auto/ready/not-current',token)).status,404);
  await context.close();await browser.close();await new Promise(r=>parent.close(r));await new Promise(r=>controller.server.close(r));
  offline=true;controller=createUpdater({bundled:initial,cacheDir:dir,download});await new Promise(r=>controller.server.listen(17780,'127.0.0.1',r));
  const cachedToken=(await api('/auto/status')).data.token;assert.equal((await api('/auto/launch',cachedToken)).data.version,nextVersion,'offline service restart uses the complete cached update');
  assert(requests.every(u=>/^https:\/\/(raw\.githubusercontent\.com\/Ws3r211\/stremio-lite-tizenbrew\/main\/update\.json|cdn\.jsdelivr\.net\/gh\/Ws3r211\/stremio-lite-tizenbrew@)/.test(u)));
  assert(requests.every(u=>!u.includes('synthetic-local-account')));assert.deepEqual(errors,[]);
  console.log('PASS: ES5 bootstrap, same-origin storage, coherent app/service update, no interruption while checking, invalid downloads, failed-start rollback, offline persistent cache, fixed repository and origin/token checks');
 }finally{
  await context.close().catch(()=>{});await browser.close().catch(()=>{});if(parent.listening)await new Promise(r=>parent.close(r));if(controller.server.listening)await new Promise(r=>controller.server.close(r));
  assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
