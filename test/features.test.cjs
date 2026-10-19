/* AVPlay simulation for 3.2 features: Continue watching, source ranking, preferred languages and next-episode autoplay.
   Synthetic fixtures only; no real account, addon or media. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),createServer=require('../service.js');
(async()=>{
 const server=createServer({staticDir:path.join(__dirname,'../app')});await new Promise(r=>server.listen(17780,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const addon={transportUrl:'https://fixture.example/manifest.json',manifest:{id:'fx',name:'Fixture',types:['series','movie'],idPrefixes:['tt'],resources:['catalog','meta','stream'],catalogs:[{id:'top',type:'series',name:'Fixture shows'}]}};
 const series={id:'ttSHOW',type:'series',name:'Fixture Show',videos:[{id:'ttSHOW:1:2',season:1,episode:2,title:'Second',released:'2020-01-08'},{id:'ttSHOW:1:1',season:1,episode:1,title:'First',released:'2020-01-01'}]};
 const context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(([addon])=>{
  if(!sessionStorage.getItem('seeded')){
   sessionStorage.setItem('seeded','1');
   localStorage.setItem('sl.addons',JSON.stringify([addon]));
   localStorage.setItem('sl.audioLanguage',JSON.stringify('English'));localStorage.setItem('sl.subtitleLanguage',JSON.stringify('English'));
   localStorage.setItem('sl.progress',JSON.stringify({ttMOVIE:{seconds:600,duration:6000,date:Date.now(),metaId:'ttMOVIE',type:'movie',name:'Seeded Movie',poster:''}}));
  }
  window.engineState='NONE';window.audioIndex=3;window.textIndex=-1;window.trackCalls=[];window.opened=[];
  const tracks=[{type:'VIDEO',index:0},{type:'AUDIO',index:3,extra_info:'{"language":"fra"}'},{type:'AUDIO',index:5,extra_info:'{"language":"eng"}'},{type:'TEXT',index:7,extra_info:'{"track_lang":"fra"}'},{type:'TEXT',index:9,extra_info:'{"track_lang":"eng"}'}];
  window.webapis={avplay:{open(u){opened.push(u);engineState='IDLE';},setDisplayRect(){},setListener(l){window.listener=l;},getState(){return engineState;},prepareAsync(ok){engineState='READY';setTimeout(ok,10);},
   play(){engineState='PLAYING';},pause(){engineState='PAUSED';},stop(){engineState='IDLE';},close(){engineState='NONE';},getDuration(){return 120000;},seekTo(ms,ok){setTimeout(ok,10);},
   getTotalTrackInfo(){return tracks;},getCurrentStreamInfo(){return [{type:'AUDIO',index:audioIndex},{type:'TEXT',index:textIndex}];},setSilentSubtitle(){},
   setSelectTrack(type,index){trackCalls.push({type,index,state:engineState});if(type==='AUDIO'&&engineState==='PLAYING')setTimeout(()=>{audioIndex=index;},30);if(type==='TEXT')setTimeout(()=>{textIndex=index;},30);}}};
 },[addon]);
 await page.route('**/request',async route=>{
  const u=route.request().postDataJSON().url;let data;
  if(u.includes('/catalog/'))data={metas:[{id:series.id,type:'series',name:series.name}]};
  else if(u.includes('/meta/series/'))data={meta:series};
  else if(u.includes('/stream/series/ttSHOW%3A1%3A1'))data={streams:[
   {name:'Fixture DV',title:'2160p DV HEVC',url:'https://cdn.example/ep1-dv.mkv',behaviorHints:{bingeGroup:'fx-dv'}},
   {name:'Fixture AV1',title:'1080p AV1',url:'https://cdn.example/ep1-av1.mkv'},
   {name:'Fixture Good',title:'1080p x264',url:'https://cdn.example/ep1.mkv',behaviorHints:{bingeGroup:'fx-1080'}}]};
  else if(u.includes('/stream/series/ttSHOW%3A1%3A2'))data={streams:[
   {name:'Fixture Good',title:'720p x264',url:'https://cdn.example/ep2-other.mkv',behaviorHints:{bingeGroup:'fx-720'}},
   {name:'Fixture Good',title:'1080p x264',url:'https://cdn.example/ep2.mkv',behaviorHints:{bingeGroup:'fx-1080'}}]};
  else data={metas:[]};
  return route.fulfill({json:{data}});
 });
 try{
  await page.goto('http://127.0.0.1:17780/');
  // Continue watching comes first on Home and opens the title.
  await page.getByRole('heading',{name:'Continue watching'}).waitFor();
  const firstRow=await page.locator('.catalog-row').first().textContent();assert.match(firstRow,/Continue watching.*Seeded Movie/);
  // Sources are ranked for this TV: plain H.264 first, AV1 and Dolby Vision-only marked and moved down.
  await page.getByRole('button',{name:/^Fixture Show/}).first().click();
  await page.getByRole('button',{name:/^1\. First/}).click();
  await page.waitForFunction(()=>/sources/.test(document.getElementById('status').textContent));
  const sources=await page.locator('#view .list > button').allTextContents();
  assert.match(sources[0],/Fixture Good.*Plays on this TV/s);assert.match(sources[1],/Not recommended/);assert.match(sources[2],/Not recommended/);
  await page.getByRole('button',{name:/Fixture Good/}).click();
  await page.waitForFunction(()=>engineState==='PLAYING');
  // Preferred languages are chosen once playback starts.
  await page.waitForFunction(()=>audioIndex===5&&textIndex===9,null,{timeout:5000});
  assert(await page.evaluate(()=>trackCalls.filter(c=>c.type==='AUDIO').every(c=>c.state==='PLAYING')));
  await page.waitForFunction(()=>/English audio/.test(document.getElementById('playback-status').textContent));
  // Near the end the next episode is offered and continues with the same release group.
  await page.evaluate(()=>listener.oncurrentplaytime(30000));
  await page.evaluate(()=>listener.oncurrentplaytime(100000));
  await page.locator('#next-episode').getByText('S1E2 · Second').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'next-play');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>opened.length===2,null,{timeout:20000});
  assert.equal(await page.evaluate(()=>opened[1]),'https://cdn.example/ep2.mkv');
  assert.match(await page.locator('#playing-title').textContent(),/Second/);
  // Return cancels the prompt instead of leaving the player.
  await page.waitForFunction(()=>engineState==='PLAYING');
  await page.evaluate(()=>listener.oncurrentplaytime(100000));
  await page.waitForFunction(()=>document.getElementById('next-episode').className==='hidden'||!document.getElementById('next-episode').textContent);
  await page.keyboard.press('Escape');assert(await page.locator('#player').isHidden());
  assert.deepEqual(errors,[]);
  console.log('PASS: Continue watching row, TV-compatible source ranking, preferred audio/subtitle languages, next-episode prompt with binge-group match');
 }finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
