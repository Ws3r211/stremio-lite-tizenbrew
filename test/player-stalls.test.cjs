/* Native callback stalls use a simulated clock, never a real provider or TV. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),createServer=require('../service.js');
(async()=>{
 const server=createServer({staticDir:path.join(__dirname,'../app')});await new Promise(r=>server.listen(17780,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 async function scenario(mode){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(mode=>{
   const now=Date.now,timeout=window.setTimeout,interval=window.setInterval;window.clockOffset=0;Date.now=()=>now()+clockOffset;
   window.setTimeout=(fn,ms)=>timeout(fn,(ms===15000||ms===45000)?100:ms);
   window.setInterval=(fn,ms)=>interval(fn,ms===1000?20:ms);
   if(mode==='resume')localStorage.setItem('sl.progress',JSON.stringify({'blender-bbb':{seconds:30,duration:120,date:now()}}));
   window.calls=[];window.attempts=0;window.listeners=[];
   window.webapis={avplay:{open(){attempts++;calls.push('open');},setDisplayRect(){},setListener(l){window.listener=l;listeners.push(l);},
    prepareAsync(ok){window.latePrepare=ok;if(mode!=='prepare')timeout(ok,5);},
    seekTo(ms,ok){calls.push('seek');window.lateResume=ok;},getDuration(){return 120000;},
    play(){calls.push('play');},pause(){calls.push('pause');},stop(){calls.push('stop');},close(){calls.push('close');}
   }};
  },mode);
  await page.route('**/request',route=>route.fulfill({json:{data:{metas:[]}}}));
  try{
   await page.goto('http://127.0.0.1:17780/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Play test video'}).click();
   if(mode==='prepare'){
    await page.locator('#playback-status').filter({hasText:'STARTUP_TIMEOUT'}).waitFor();
    await page.evaluate(()=>latePrepare());assert.equal(await page.evaluate(()=>calls.includes('play')),false);
    assert(await page.getByRole('button',{name:'Retry from beginning',exact:true}).isVisible());
   }else{
    await page.waitForFunction(()=>calls.includes('play'));
    if(mode==='resume'){
     assert.equal(await page.evaluate(()=>attempts),2);assert.equal(await page.evaluate(()=>calls.filter(x=>x==='seek').length),1);
     await page.evaluate(()=>{lateResume();listeners[0].onerror('STALE_ERROR');});
     assert.equal(await page.evaluate(()=>calls.filter(x=>x==='play').length),1);assert.match(await page.locator('#playback-status').textContent(),/^Playing/);
    }else if(mode==='seek-error'){
     await page.getByRole('button',{name:'Forward 10 seconds',exact:true}).click();
     await page.evaluate(()=>{listener.onerror('PLAYER_ERROR_CONNECTION_FAILED');lateResume();});
     assert.match(await page.locator('#playback-status').textContent(),/Playback failed.*PLAYER_ERROR_CONNECTION_FAILED/,'late manual seek callback cannot clear a native failure');
    }else{
     await page.evaluate(()=>{listener.onbufferingstart();listener.oncurrentplaytime(1000);});
     assert.equal(await page.locator('#playback-status').textContent(),'Playing','advancing media clears stale buffer overlay');
     assert(await page.locator('#player-state').isHidden());
     await page.getByRole('button',{name:'Pause / play'}).click();await page.evaluate(()=>clockOffset=61000);await page.waitForTimeout(60);
     assert.equal(await page.locator('#playback-status').textContent(),'Paused','pausing must not trip watchdog');
     await page.getByRole('button',{name:'Pause / play'}).click();await page.evaluate(()=>{listener.onbufferingstart();clockOffset+=61000;});
     await page.locator('#playback-status').filter({hasText:'BUFFERING_TIMEOUT'}).waitFor();
     const playsBeforeRetry=await page.evaluate(()=>calls.filter(x=>x==='play').length);
     await page.getByRole('button',{name:'Retry from beginning',exact:true}).click();await page.waitForFunction(previous=>calls.filter(x=>x==='play').length===previous+1&&/^Playing/.test(document.getElementById('playback-status').textContent),playsBeforeRetry);
     assert.equal(await page.evaluate(()=>attempts),2);assert.match(await page.locator('#playback-status').textContent(),/^Playing/);
    }
   }
   await page.getByRole('button',{name:'Stop',exact:true}).click();assert.equal(await page.locator('html').getAttribute('class'),'');
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }
 try{await scenario('resume');await scenario('prepare');await scenario('buffer');await scenario('seek-error');console.log('PASS: stalled resume restarts once without seeking, stale callbacks ignored, bounded startup, stale buffer overlay cleared, pause exemption, buffering timeout and explicit restart');}
 finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
