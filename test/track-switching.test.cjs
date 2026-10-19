/* AVPlay simulation: delayed state/decoder changes, ignored calls and pause cancellation.
   Reported track state and audible language are deliberately separate. No real account/media. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),createServer=require('../service.js');
(async()=>{
 const root=path.join(__dirname,'..'),server=createServer({staticDir:path.join(root,'app')});await new Promise(r=>server.listen(17780,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 async function scenario(mode){
  const context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(mode=>{
   localStorage.setItem('sl.addons',JSON.stringify([{transportUrl:'https://fixture.example/manifest.json',manifest:{id:'sub',name:'Subtitle fixture',types:['movie'],resources:['subtitles'],catalogs:[]}}]));
   window.engineState='NONE';window.audioIndex=3;window.textIndex=7;window.audible='French';window.trackCalls=[];window.silentCalls=[];let stateTimer,reportTimer,decoderTimer,subtitleTimer;
   const tracks=[{type:'VIDEO',index:0},{type:'AUDIO',index:3,extra_info:'{"language":"fra"}'},{type:'AUDIO',index:'5',extra_info:'{"language":"eng"}'},{type:'TEXT',index:7,extra_info:'{"track_lang":"fra"}'},{type:'TEXT',index:9,extra_info:'{"track_lang":"eng"}'}];
   function clear(){clearTimeout(stateTimer);clearTimeout(reportTimer);clearTimeout(decoderTimer);clearTimeout(subtitleTimer);}
   window.webapis={avplay:{open(){engineState='IDLE';},setDisplayRect(){},setListener(l){window.listener=l;},getState(){return engineState;},prepareAsync(ok){engineState='READY';setTimeout(ok,10);},
    play(){if(engineState==='PAUSED'){stateTimer=setTimeout(()=>{engineState='PLAYING';},150);}else engineState='PLAYING';},
    pause(){clear();engineState='PAUSED';},stop(){clear();engineState='IDLE';},close(){clear();engineState='NONE';},getDuration(){return 120000;},seekTo(ms,ok){setTimeout(ok,10);},getTotalTrackInfo(){return tracks;},
    getCurrentStreamInfo(){return [{type:'AUDIO',index:audioIndex},{type:'TEXT',index:textIndex}];},setSilentSubtitle(value){silentCalls.push(value);},
    setSelectTrack(type,index){
     assertNumber(index);trackCalls.push({type,index,state:engineState});
     if(mode==='throw'&&type==='AUDIO'){const e=new Error('Fixture unsupported track');e.name='NotSupportedError';throw e;}
     if(mode==='ignored'||(mode==='retry'&&trackCalls.filter(c=>c.type===type).length===1))return;
     if(type==='AUDIO'){
      if(engineState!=='PLAYING')return;
      reportTimer=setTimeout(()=>{audioIndex=index;},30);
      decoderTimer=setTimeout(()=>{audible=index===5?'English':'French';},280);
     }else{subtitleTimer=setTimeout(()=>{textIndex=index;},120);}
    }}};
   function assertNumber(index){if(typeof index!=='number')throw new TypeError('Native API requires numeric index');}
  },mode);
  await page.route('**/request',async route=>{
   const req=route.request().postDataJSON(),u=req.url;
   if(u.endsWith('/slow.srt')){await new Promise(r=>setTimeout(r,450));return route.fulfill({json:{text:'1\n00:00:01,000 --> 00:00:20,000\nSlow French captions'}});}
   if(u.endsWith('/fast.srt'))return route.fulfill({json:{text:'1\n00:00:01,000 --> 00:00:20,000\nEnglish addon captions'}});
   return route.fulfill({json:{data:u.includes('/subtitles/')?{subtitles:[{lang:'fra',url:'https://fixture.example/slow.srt'},{lang:'eng',url:'https://fixture.example/fast.srt'}]}:{metas:[]}}});
  });
  const audio=()=>page.getByRole('button',{name:'Audio',exact:true}),english=()=>page.getByRole('radio',{name:/^English.*Embedded audio/});
  async function ready(){await page.waitForFunction(()=>document.getElementById('track-menu').className==='hidden');}
  try{
   await page.goto('http://127.0.0.1:17780/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Play test video',exact:true}).click();await page.waitForFunction(()=>engineState==='PLAYING');await page.evaluate(()=>listener.oncurrentplaytime(3000));
   if(mode==='paused'||mode==='cancel')await page.getByRole('button',{name:'Pause / play'}).click();
   if(mode==='subtitles'){
    await page.getByRole('button',{name:'Subtitles',exact:true}).click();await page.getByRole('radio',{name:/^English.*Embedded subtitles/}).click();await ready();assert.equal(await page.evaluate(()=>textIndex),9);assert.equal(await page.evaluate(()=>silentCalls.includes(false)),false,'app subtitle callbacks require silent native renderer');
    await page.evaluate(()=>listener.onsubtitlechange('3000','English<br>caption','0'));assert.equal(await page.locator('#subtitle').textContent(),'English\ncaption');
    await page.getByRole('button',{name:'Pause / play'}).click();await page.waitForTimeout(200);assert.equal(await page.locator('#subtitle').textContent(),'English\ncaption');await page.getByRole('button',{name:'Pause / play'}).click();await page.evaluate(()=>listener.oncurrentplaytime(7000));assert.equal(await page.locator('#subtitle').textContent(),'');
    await page.evaluate(()=>listener.onsubtitlechange('3000','Caption before seek','0'));await page.getByRole('button',{name:'Back 10 seconds',exact:true}).click();await page.waitForFunction(()=>document.getElementById('playback-status').textContent==='Playing');assert.equal(await page.locator('#subtitle').textContent(),'','seeking clears the embedded cue');await page.evaluate(()=>listener.oncurrentplaytime(3000));
    await page.getByRole('button',{name:'Subtitles',exact:true}).click();await page.getByRole('radio',{name:/^Off/}).click();await page.evaluate(()=>listener.onsubtitlechange('1000','Must stay off','0'));assert.equal(await page.locator('#subtitle').textContent(),'');
    await page.getByRole('button',{name:'Subtitles',exact:true}).click();await page.getByRole('radio',{name:/^French.*Addon subtitles/}).click();await page.getByRole('radio',{name:/^English.*Addon subtitles/}).click();await ready();assert.equal(await page.locator('#subtitle').textContent(),'English addon captions');await page.waitForTimeout(550);assert.equal(await page.locator('#subtitle').textContent(),'English addon captions','older subtitle download cannot win');
    await audio().click();await english().click();await ready();await page.waitForFunction(()=>audible==='English');assert.equal(await page.locator('#subtitle').textContent(),'English addon captions','audio switching preserves external subtitles');
   }else{
    await audio().click();assert.equal(await page.getByRole('radio',{name:/^French/}).getAttribute('aria-checked'),'true');await english().click();assert(await page.getByRole('dialog',{name:'Audio',exact:true}).isVisible(),'selection stays pending until TV confirms');
    if(mode==='cancel'){
     await page.getByRole('button',{name:'Close',exact:true}).click();await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>trackCalls.length),0);assert.equal(await page.evaluate(()=>engineState),'PAUSED');assert.equal(await page.evaluate(()=>audible),'French');
    }else if(mode==='stop'){
     await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.waitForTimeout(450);assert(await page.locator('#player').isHidden());assert.equal(await page.evaluate(()=>engineState),'NONE');
    }else if(mode==='ignored'||mode==='throw'){
     await page.locator('#track-menu .error').waitFor();assert(await page.getByRole('dialog',{name:'Audio',exact:true}).isVisible());assert.equal(await english().getAttribute('aria-checked'),'false');assert.equal(await page.getByRole('radio',{name:/^French/}).getAttribute('aria-checked'),'true');assert.equal(await page.evaluate(()=>audible),'French');assert.equal(await page.evaluate(()=>trackCalls.length),mode==='ignored'?2:1);
     await page.keyboard.press('Escape');await audio().click();assert.equal(await english().getAttribute('aria-checked'),'false','reopening uses actual TV track state');
    }else{
     await ready();await page.waitForFunction(()=>audible==='English');assert.equal(await page.evaluate(()=>audioIndex),5);assert.equal(await page.evaluate(()=>trackCalls.every(c=>c.state==='PLAYING')),true);
     if(mode==='paused')assert.equal(await page.evaluate(()=>engineState),'PAUSED','pause is restored after decoder has changed');
     if(mode==='retry')assert.equal(await page.evaluate(()=>trackCalls.length),2);
     // A subsequent native/external change must determine the selected badge, not a stale cached request.
     await page.evaluate(()=>{audioIndex=3;audible='French';});await audio().click();assert.equal(await english().getAttribute('aria-checked'),'false');assert.equal(await page.getByRole('radio',{name:/^French/}).getAttribute('aria-checked'),'true');
    }
   }
   assert.deepEqual(errors,[]);console.log('PASS track switch '+mode);
  }finally{await context.close();}
 }
 try{for(const mode of ['playing','paused','retry','ignored','throw','cancel','stop','subtitles'])await scenario(mode);}
 finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
