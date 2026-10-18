/* Real remote key sequences. Synthetic catalogs and AVPlay tracks; no user account. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),createServer=require('../service.js');
(async()=>{
 const root=path.join(__dirname,'..'),server=createServer({staticDir:path.join(root,'app')});await new Promise(r=>server.listen(17780,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 try{
  for(const viewport of [{width:1920,height:1080},{width:1280,height:720}]){
   const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],calls=[];let leadingEmpty=false,row3Requests=0;page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript(()=>{
    localStorage.setItem('sl.addons',JSON.stringify([{transportUrl:'https://fixture.example/manifest.json',manifest:{id:'remote',name:'Remote fixture',types:['movie'],resources:['catalog','meta'],catalogs:Array.from({length:6},(_,i)=>({id:'row'+i,type:'movie',name:'Row '+i}))}}]));
    window.navLog=[];document.addEventListener('keydown',e=>navLog.push({key:e.keyCode,active:document.activeElement.id||document.activeElement.getAttribute('data-row-index'),card:document.activeElement.getAttribute('data-card-index')}),true);document.addEventListener('focusin',e=>navLog.push({focus:e.target.id||e.target.getAttribute('data-row-index'),card:e.target.getAttribute('data-card-index')}));
    const original=window.setTimeout;window.setTimeout=(fn,ms)=>original(fn,ms===6000?150:ms);
    window.avCalls=[];window.audioIndex=0;window.webapis={avplay:{open(){},setDisplayRect(){},setListener(l){window.avListener=l;},prepareAsync(ok){original(ok,10);},play(){avCalls.push('play');},pause(){avCalls.push('pause');},stop(){},close(){},getDuration(){return 7200000;},seekTo(ms,ok){avCalls.push(['seek',ms]);original(ok,10);},getTotalTrackInfo(){return Array.from({length:18},(_,i)=>({type:'AUDIO',index:i,extra_info:JSON.stringify({language:i===17?'nld':'eng',channels:'2'})})).concat([{type:'TEXT',index:20,extra_info:'{"language":"eng"}'}]);},getCurrentStreamInfo(){return [{type:'AUDIO',index:audioIndex}];},setSelectTrack(t,i){avCalls.push([t,i]);if(t==='AUDIO')audioIndex=i;},setSilentSubtitle(){}}};
   });
   await page.route('**/request',async route=>{
    const u=route.request().postDataJSON().url;calls.push(u);
    if(u.includes('/catalog/')){const row=Number(u.match(/row(\d)/)[1]);if(row===2||row===4)await new Promise(r=>setTimeout(r,400));if(row===3&&++row3Requests===1)return route.fulfill({json:{data:{invalid:'synthetic response'}}});return route.fulfill({json:{data:{metas:(row===1||(leadingEmpty&&row===0))?[]:Array.from({length:12},(_,i)=>({id:'row'+row+'-'+i,type:'movie',name:'Row '+row+' title '+i,description:'A remote navigation fixture.'}))}}});}
    return route.fulfill({json:{data:{metas:[]}}});
   });
   async function active(){return page.evaluate(()=>document.activeElement.id||document.activeElement.textContent);}
   async function key(k){if(k==='MediaPlayPause')await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:10252,bubbles:true})));else await page.keyboard.press(k);}
   async function focusIs(value){assert.equal(await active(),value);}
   async function inView(selector){const b=await page.locator(selector).boundingBox();assert(b&&b.y>=-1&&b.y+b.height<=viewport.height+1,selector+' must stay visible: '+JSON.stringify(b));}
   try{
    await page.goto('http://127.0.0.1:17780/');await page.getByRole('button',{name:/^Row 0 title 0/}).waitFor();
    // From Home to Settings and the playback check, using the same remote as the TV.
    await key('ArrowUp');await focusIs('View details');await key('ArrowUp');await focusIs('Discover');
    for(let i=0;i<3;i++)await key('ArrowRight');await focusIs('Settings');await key('Enter');await focusIs('Sign in with Stremio');
    await key('ArrowLeft');for(let i=0;i<3;i++)await key('ArrowDown');await focusIs('Playback check');await key('ArrowRight');await focusIs('TV default');
    await key('ArrowDown');assert.match(await active(),/^Balanced/);await key('ArrowDown');assert.match(await active(),/^Extra buffering/);await key('ArrowDown');await focusIs('Play test video');await key('Enter');await page.waitForFunction(()=>avCalls.includes('play'));
    await page.evaluate(()=>avListener.oncurrentplaytime(20000));await key('MediaPlayPause');await focusIs('pause');
    const order=['rewind','forward','jump','audio','tracks','stop'];for(const id of order){await key('ArrowRight');await focusIs(id);await inView('#'+id);}
    await key('ArrowRight');await focusIs('stop');for(const id of ['tracks','audio','jump','forward','rewind','pause']){await key('ArrowLeft');await focusIs(id);}
    await key('ArrowLeft');await focusIs('pause');
    for(let i=0;i<4;i++)await key('ArrowRight');await focusIs('audio');await key('Enter');
    await page.getByRole('dialog',{name:'Audio',exact:true}).waitFor();
    for(let i=0;i<17;i++){await key('ArrowDown');await inView('#track-menu :focus');}
    assert.match(await active(),/Dutch/);await page.screenshot({path:path.join(root,'artifacts/remote-audio-'+viewport.width+'.jpg')});await key('Enter');await focusIs('audio');assert.equal(await page.evaluate(()=>audioIndex),17);
    await key('ArrowUp');await focusIs('timeline');await key('ArrowUp');await focusIs('player-back');await key('ArrowDown');await focusIs('timeline');await key('ArrowDown');await focusIs('audio');
    await key('ArrowRight');await focusIs('tracks');await key('Enter');await page.getByRole('dialog',{name:'Subtitles',exact:true}).waitFor();
    // The subtitle appearance/timing controls must be reachable and stay inside the dialog.
    for(let i=0;i<12;i++)await key('ArrowDown');assert.match(await active(),/Reset timing/);await inView('#track-menu :focus');await key('ArrowRight');assert.match(await active(),/Reset timing/);
    await key('Escape');await focusIs('tracks');
    await key('ArrowLeft');await key('ArrowLeft');await focusIs('jump');await key('Enter');await focusIs('seek-time');await page.locator('#seek-time').fill('01:02');await key('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.type),'submit');await key('Enter');await page.waitForFunction(()=>document.activeElement.id==='jump');
    // A hidden toolbar must reopen at a usable button; hidden Stop cannot activate accidentally.
    await key('MediaPlayPause');await page.waitForFunction(()=>document.getElementById('player-chrome').className==='hidden');
    await key('ArrowDown');await focusIs('jump');assert(await page.locator('#player').isVisible());await key('MediaPlayPause');
    for(let i=0;i<3;i++)await key('ArrowRight');await focusIs('stop');await key('MediaPlayPause');await page.waitForFunction(()=>document.getElementById('player-chrome').className==='hidden');await key('Enter');await focusIs('stop');assert(await page.locator('#player').isVisible(),'OK reveals controls instead of activating hidden Stop');await key('MediaPlayPause');
    // Error actions are outside player-chrome but still need a complete remote path.
    await page.evaluate(()=>avListener.onerror('PLAYER_ERROR_CONNECTION_FAILED'));await focusIs('player-error-back');await key('ArrowLeft');await focusIs('player-retry');await key('ArrowRight');await focusIs('player-error-back');await key('Enter');assert(await page.locator('#player').isHidden());
    row3Requests=0;await page.getByRole('button',{name:'Discover',exact:true}).click();await page.getByRole('button',{name:/^Row 0 title 0/}).waitFor();
    await key('ArrowUp');assert.equal(await active(),'View details');assert.equal(await page.evaluate(()=>window.scrollY),0);await inView('.feature-title');
    await key('ArrowUp');await focusIs('Discover');await key('ArrowDown');await focusIs('View details');await key('ArrowRight');await focusIs('All');await key('ArrowRight');await focusIs('Movies');await key('ArrowLeft');await focusIs('All');await key('ArrowDown');assert.match(await active(),/Row 0 title 0/);
    await page.waitForFunction(()=>document.querySelectorAll('.catalog-row')[1].classList.contains('hidden'));
    for(let i=0;i<8;i++)await key('ArrowRight');assert.match(await active(),/Row 0 title 8/);
    await key('ArrowDown');await page.waitForFunction(()=>document.activeElement.getAttribute('data-row-index')==='2'&&document.activeElement.getAttribute('data-card-index')==='8');await key('ArrowUp');assert.match(await active(),/Row 0 title 8/);
    await key('ArrowDown');await key('ArrowDown');await page.waitForFunction(()=>document.activeElement.textContent==='Retry catalog');await key('Enter');await page.waitForFunction(()=>document.activeElement.getAttribute('data-row-index')==='3'&&document.activeElement.getAttribute('data-card-index')==='8');
    await key('ArrowDown');await page.waitForFunction(()=>document.activeElement.getAttribute('data-row-index')==='4'&&document.activeElement.getAttribute('data-card-index')==='8');await key('ArrowUp');await key('ArrowUp');await key('ArrowUp');
    for(let i=0;i<4;i++)await key('ArrowDown');await page.waitForFunction(()=>document.activeElement.getAttribute('data-row-index')==='5'&&document.activeElement.getAttribute('data-card-index')==='8');await key('ArrowDown');assert.match(await active(),/Row 5 title 8/);
    for(let i=0;i<5;i++)await key('ArrowUp');await focusIs('View details');assert.equal(await page.evaluate(()=>window.scrollY),0);await inView('.discover-heading');await inView('.feature-title');
    await page.screenshot({path:path.join(root,'artifacts/remote-home-'+viewport.width+'.jpg')});
    leadingEmpty=true;await page.reload();await page.getByRole('button',{name:/^Row 2 title 0/}).waitFor();for(let i=0;i<7&&(await active())!=='View details';i++)await key('ArrowUp');await focusIs('View details');assert.equal(await page.evaluate(()=>window.scrollY),0);await inView('.feature-title');
    assert.deepEqual(errors,[]);console.log('PASS remote-only player controls/audio/long track menu/subtitles/timeline/dialogs/hidden chrome/errors; Home rows/empty skip/banner return '+viewport.width);
   }catch(e){console.error(await page.evaluate(()=>({active:document.activeElement.outerHTML,log:window.navLog.slice(-25),rows:Array.from(document.querySelectorAll('.catalog-row')).map(r=>({label:r.querySelector('h2').textContent,hidden:r.className,focus:r.querySelector('.shelf-track').getAttribute('data-focus-card'),text:r.querySelector('.shelf-track').textContent.slice(0,70)}))})));await page.screenshot({path:path.join(root,'artifacts/remote-failure-'+viewport.width+'.jpg')});throw e;}finally{await context.close();}
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
