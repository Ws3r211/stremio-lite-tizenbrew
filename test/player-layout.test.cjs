/* Geometry and remote interaction with unsupported inset declarations removed.
   This models the relevant CSS failure, not a complete Tizen emulator. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),createServer=require('../service.js');
(async()=>{
 const root=path.join(__dirname,'..'),server=createServer({staticDir:path.join(root,'app')});await new Promise(r=>server.listen(17780,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 try{
  for(const viewport of [{width:1920,height:1080},{width:1280,height:720}]){
   const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript(()=>{
    window.avCalls=[];window.webapis={avplay:{open(){},setDisplayRect(){},setListener(l){window.listener=l;},prepareAsync(ok){setTimeout(ok,5);},play(){avCalls.push('play');},pause(){avCalls.push('pause');},getDuration(){return 7200000;},seekTo(ms,ok){setTimeout(ok,5);},stop(){},close(){},getTotalTrackInfo(){return [];}}};
   });
   await page.route('**/style.css',route=>route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(root,'app/style.css'),'utf8').replace(/\binset\s*:[^;}]+;?/g,'')}));
   await page.route('**/request',route=>route.fulfill({json:{data:{metas:[]}}}));
   try{
    await page.goto('http://127.0.0.1:17780/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Play test video'}).click();await page.waitForFunction(()=>avCalls.includes('play'));
    await page.evaluate(()=>{listener.oncurrentplaytime(90000);document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:10252,bubbles:true}));});
    assert(await page.evaluate(()=>avCalls.includes('pause')));
    const chrome=await page.locator('#player-chrome').boundingBox();
    if(chrome.width<viewport.width-2||chrome.height<viewport.height-2)await page.screenshot({path:path.join(root,'artifacts/player-layout-collapsed.jpg')});
    assert(chrome.width>=viewport.width-2&&chrome.height>=viewport.height-2,'controls container must cover the viewport when inset is unsupported');
    for(const selector of ['#player-back','#timeline','#pause','#rewind','#forward','#jump','#audio','#tracks','#stop']){
     const box=await page.locator(selector).boundingBox();assert(box&&box.width>20&&box.height>20,selector+' must have a usable size');
     assert(box.x>=-1&&box.y>=-1&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,selector+' must stay on-screen');
    }
    assert.equal(await page.locator('#pause').getAttribute('aria-pressed'),'true');
    await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.id),'timeline');
    await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#timeline').inputValue(),'100');
    await page.keyboard.press('Escape');assert(await page.locator('#player').isVisible());
    await page.screenshot({path:path.join(root,'artifacts/player-layout-fixed-'+viewport.width+'.jpg')});
    await page.getByRole('button',{name:'Subtitles',exact:true}).click();
    const scrim=await page.locator('#track-scrim').boundingBox();assert.equal(scrim.width,viewport.width);assert.equal(scrim.height,viewport.height);
    await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement.id),'tracks');
    assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
  console.log('PASS: viewport-sized paused controls without inset, readable/clickable buttons, remote timeline, modal backdrop and focus at 1080p/720p');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
