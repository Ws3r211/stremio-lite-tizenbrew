/* Public Cinemeta and Blender sample through the permanent launcher; no account sign-in. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {chromium}=require('playwright'),createUpdater=require('../auto/updater.js');
(async()=>{
 const root=path.join(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'stremio-auto-live-'));
 const controller=createUpdater({bundled:{descriptor:JSON.parse(fs.readFileSync(path.join(root,'update.json'),'utf8')),text:fs.readFileSync(path.join(root,'runtime.json'),'utf8')},cacheDir:dir,download:(u,l,cb)=>cb(new Error('offline update fixture'))});
 await new Promise(r=>controller.server.listen(17780,'127.0.0.1',r));
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(fs.readFileSync(path.join(root,'auto/loader.html')));});await new Promise(r=>server.listen(8081,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),page=await browser.newPage();
 try{
  await page.goto('http://127.0.0.1:8081/module/permanent/auto/loader.html');await page.locator('.card').first().waitFor({timeout:40000});
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Automatic updates',exact:true}).waitFor();
  await page.getByRole('button',{name:'Play test video'}).click();await page.waitForFunction(()=>document.getElementById('video').currentTime>0.5,{},{timeout:40000});
  await page.getByRole('button',{name:'Pause / play'}).click();assert(await page.locator('#video').evaluate(v=>v.paused));
  await page.getByRole('button',{name:'Forward 10 seconds',exact:true}).click();await page.waitForFunction(()=>document.getElementById('video').currentTime>=10&&!document.getElementById('audio').disabled,{},{timeout:25000});
  await page.getByRole('button',{name:'Stop',exact:true}).click();assert(await page.locator('#player').isHidden());
  console.log('PASS: permanent launcher boots cached fallback, live Cinemeta loads, public MP4 plays/pauses/seeks/stops on desktop');
 }finally{await browser.close();await new Promise(r=>server.close(r));await new Promise(r=>controller.server.close(r));assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
