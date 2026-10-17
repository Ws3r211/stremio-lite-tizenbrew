/* Native state-machine fixtures; no real stream/account or claim of TV codec compatibility. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),createServer=require('../service.js');
(async()=>{
    const server=createServer({staticDir:path.join(__dirname,'../app')});await new Promise(r=>server.listen(17780,'127.0.0.1',r));
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
    async function scenario(mode,failCount,resume,stopDuringSeek=false){
        const context=await browser.newContext(),page=await context.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await context.addInitScript(({mode,failCount,resume})=>{
            if(mode){localStorage.setItem('sl.bufferMode',JSON.stringify(mode));localStorage.setItem('sl.playerPrefsVersion',JSON.stringify(3));}
            if(resume)localStorage.setItem('sl.progress',JSON.stringify({'blender-bbb':{seconds:30,duration:120,date:Date.now()}}));
            window.events=[];window.attempts=0;window.custom=[];
            window.webapis={avplay:{
                open(){attempts++;events.push('open');custom.push(false);},setDisplayRect(){},
                setBufferingParam(){custom[attempts-1]=true;events.push('buffer');},setTimeoutForBuffering(){},
                setListener(l){window.listener=l;},
                prepareAsync(ok,fail){let n=attempts;events.push('prepare');setTimeout(()=>{if(n<=failCount){fail('PLAYER_ERROR_OUT_OF_MEMORY');setTimeout(ok,80);}else ok();},20);},
                seekTo(ms,ok){events.push('seek-start');setTimeout(()=>{events.push('seek-done');ok();},120);},
                play(){events.push('play');},stop(){events.push('stop');},close(){events.push('close');},getDuration(){return 120000;}
            }};
        },{mode,failCount,resume});
        await page.route('**/request',async route=>route.fulfill({json:{data:{metas:[]}}}));
        try{
            await page.goto('http://127.0.0.1:17780/');await page.getByRole('button',{name:'Settings',exact:true}).click();
            await page.getByRole('button',{name:'Play test video'}).click();
            if(stopDuringSeek){
                await page.waitForFunction(()=>events.includes('seek-start'));
                await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(180);
                assert.equal(await page.evaluate(()=>events.includes('play')),false);
                assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.progress'))['blender-bbb'].seconds),30);
            }else if(failCount>=2 || (failCount && !mode)){
                await page.waitForFunction(()=>document.getElementById('playback-status').textContent.includes('PLAYER_ERROR_OUT_OF_MEMORY'));
                await page.waitForTimeout(150);
                assert.equal(await page.evaluate(()=>events.includes('play')),false,'stale successful prepare must not start playback after failure');
                assert.equal(await page.evaluate(()=>attempts),mode?2:1);
            }else{
                await page.waitForFunction(()=>events.includes('play'));await page.waitForTimeout(160);
                assert.equal(await page.evaluate(()=>events.filter(e=>e==='play').length),1,'only the current attempt may play');
                assert.deepEqual(await page.evaluate(()=>custom),mode?[true,false]:[false]);
                if(resume)assert(await page.evaluate(()=>events.indexOf('seek-done')<events.indexOf('play')));
            }
            assert.deepEqual(errors,[]);
        }finally{await context.close();}
    }
    try{
        await scenario(null,0,true); // Default: no custom buffering; await resume seek.
        await scenario('steady',1,true); // Failed tuned prepare retries once with defaults.
        await scenario('steady',2,false); // Both fail: show real code, ignore stale callbacks.
        await scenario(null,1,false); // No looping retries when already on TV defaults.
        await scenario(null,0,true,true); // Stop while seeking cannot restart playback.
        console.log('PASS: TV-default buffering, one capped startup retry, safe native error code, resume seek ordering, stale callbacks and stop cancellation');
    }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
