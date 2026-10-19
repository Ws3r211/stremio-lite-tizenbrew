/* Real two-track AAC decoding in Chrome, plus a simulated legacy enabled-flag bug.
   Frequencies verify the decoded audio, not just AudioTrack.enabled. Not a TV test. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),createServer=require('../service.js');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stremio-audio-')),media=path.join(dir,'two-tones.mp4');
 execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=160x90:r=10:d=30','-f','lavfi','-i','sine=frequency=440:duration=30','-f','lavfi','-i','sine=frequency=880:duration=30','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-metadata:s:a:0','language=fra','-metadata:s:a:1','language=eng','-movflags','+faststart','-y',media]);
 const bytes=fs.readFileSync(media),app=createServer({staticDir:path.join(__dirname,'../app')});let loads=0;
 const server=http.createServer((req,res)=>{
  if(req.url!=='/fixture.mp4')return app.emit('request',req,res);
  loads++;const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
  res.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});res.end(bytes.subarray(start,end+1));
 });
 await new Promise(r=>server.listen(17780,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--enable-blink-features=AudioVideoTracks','--autoplay-policy=no-user-gesture-required']});
 try{for(const legacyFlags of [false,true]){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await context.addInitScript(()=>{
    localStorage.setItem('sl.addons',JSON.stringify([{transportUrl:'https://fixture.example/manifest.json',manifest:{id:'subs',name:'Fixture subtitles',types:['movie'],resources:['subtitles'],catalogs:[]}}]));
    const src=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
    Object.defineProperty(HTMLMediaElement.prototype,'src',{get:src.get,set(value){src.set.call(this,value.includes('media.w3.org')?location.origin+'/fixture.mp4':value);},configurable:true});
   });
   await page.route('**/request',route=>{
    const u=route.request().postDataJSON().url;
    if(u.endsWith('.srt'))return route.fulfill({json:{text:'1\n00:00:00,000 --> 00:00:29,000\nPreserved English captions'}});
    return route.fulfill({json:{data:u.includes('/subtitles/')?{subtitles:[{lang:'eng',url:'https://fixture.example/english.srt'}]}:{metas:[]}}});
   });
   await page.goto('http://127.0.0.1:17780/');await page.getByRole('button',{name:'Settings',exact:true}).click();
   await page.getByText(/Player: HTML5 fallback/).waitFor();await page.getByRole('button',{name:'Play test video'}).click();
   await page.waitForFunction(()=>document.getElementById('playback-status').textContent==='Playing');
   assert.match(await page.locator('#player-engine').textContent(),/^HTML5/);
   await page.evaluate(async()=>{
    const v=document.getElementById('video');window.audioContext=new AudioContext();window.analyser=audioContext.createAnalyser();analyser.fftSize=8192;
    audioContext.createMediaElementSource(v).connect(analyser);analyser.connect(audioContext.destination);await audioContext.resume();
    window.frequency=()=>{const bins=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(bins);let best=0;for(let i=1;i<bins.length;i++)if(bins[i]>bins[best])best=i;return Math.round(best*audioContext.sampleRate/analyser.fftSize);};
    v.currentTime=3;
   });
   await page.waitForFunction(()=>Math.abs(frequency()-440)<20);
   await page.waitForFunction(()=>Number(document.getElementById('timeline').value)>=3);
   await page.getByRole('button',{name:'Subtitles',exact:true}).click();await page.getByRole('radio',{name:/^English.*Addon subtitles/}).click();
   await page.waitForFunction(()=>document.getElementById('track-menu').className==='hidden');
   await page.waitForFunction(()=>document.getElementById('subtitle').textContent==='Preserved English captions');
   if(legacyFlags)await page.evaluate(()=>{
    // Old TV-style failure: setters/readback change, the active decoder does not.
    const tracks=document.getElementById('video').audioTracks;
    for(let i=0;i<tracks.length;i++){let enabled=tracks[i].enabled;Object.defineProperty(tracks[i],'enabled',{get(){return enabled;},set(value){enabled=value;},configurable:true});}
   });
   const previousLoads=loads;
   await page.getByRole('button',{name:'Audio',exact:true}).click();
   await page.getByRole('radio',{name:/^English.*Embedded audio/}).click();
   await page.waitForFunction(()=>document.getElementById('playback-status').textContent==='Playing · Audio source reloaded');
   await page.waitForFunction(()=>Math.abs(frequency()-880)<20);
   assert(loads>previousLoads,'audio change must rebuild the source decoder');
   assert((await page.evaluate(()=>document.getElementById('video').currentTime))>=3,'position preserved');
   assert.equal(await page.locator('#subtitle').textContent(),'Preserved English captions');
   await page.getByRole('button',{name:'Pause / play'}).click();
   const pausedAt=await page.evaluate(()=>document.getElementById('video').currentTime);
   await page.getByRole('button',{name:'Audio',exact:true}).click();await page.getByRole('radio',{name:/^French.*Embedded audio/}).click();
   await page.waitForFunction(()=>document.getElementById('playback-status').textContent==='Paused · Audio source reloaded');
   assert.equal(await page.evaluate(()=>document.getElementById('video').paused),true);
   assert(Math.abs((await page.evaluate(()=>document.getElementById('video').currentTime))-pausedAt)<0.3);
   assert.equal(await page.locator('#subtitle').textContent(),'Preserved English captions');
   await page.getByRole('button',{name:'Pause / play'}).click();await page.waitForFunction(()=>Math.abs(frequency()-440)<20);
   await page.route('**/fixture.mp4',async route=>{await new Promise(r=>setTimeout(r,350));try{await route.continue();}catch(e){}});
   await page.getByRole('button',{name:'Audio',exact:true}).click();await page.getByRole('radio',{name:/^English.*Embedded audio/}).click();
   await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(600);
   assert(await page.locator('#player').isHidden());assert.equal(await page.evaluate(()=>document.getElementById('video').getAttribute('src')),null);assert.deepEqual(errors,[]);
   console.log('PASS HTML5 decoded French → English → French, position/pause preserved'+(legacyFlags?' with simulated live-switch flag-only failure':''));
  }finally{await context.close();}
 }}finally{await browser.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
