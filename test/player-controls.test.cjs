const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),createServer=require('../service.js');
(async()=>{
    const server=createServer({staticDir:path.join(__dirname,'../app')});await new Promise(r=>server.listen(17780,'127.0.0.1',r));
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
    const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(()=>{
        localStorage.setItem('sl.bufferMode',JSON.stringify('steady')); // Legacy setting migrates to safe defaults once.
        localStorage.setItem('sl.addons',JSON.stringify([{transportUrl:'https://fixture.example/manifest.json',manifest:{id:'subs',name:'Subtitle fixture',types:['movie'],resources:['subtitles'],catalogs:[]}}]));
        window.avCalls=[];window.nativePaused=false;window.audioIndex=3;
        window.webapis={avplay:{
            open(){},setDisplayRect(){},setListener(l){window.avListener=l;},prepareAsync(ok){setTimeout(ok,20);},
            play(){nativePaused=false;avCalls.push(['play']);},pause(){nativePaused=true;avCalls.push(['pause']);},stop(){},close(){},
            getDuration(){return 7200000;},seekTo(ms,ok){avCalls.push(['seek',ms]);setTimeout(ok,25);},
            getTotalTrackInfo(){return [{type:'AUDIO',index:3,extra_info:'{"language":"eng","fourCC":"AACL","channels":"6"}'},{type:'AUDIO',index:5,extra_info:'{"language":"nld","fourCC":"AACL","channels":"2"}'},{type:'TEXT',index:7,extra_info:'{"track_lang":"deu"}'}];},
            getCurrentStreamInfo(){return [{type:'AUDIO',index:audioIndex}];},
            setSelectTrack(type,index){avCalls.push(['track',type,index]);if(type==='AUDIO')audioIndex=index;},
            setSilentSubtitle(value){avCalls.push(['silent',value]);}
        }};
    });
    await page.route('**/request',async route=>{
        const req=route.request().postDataJSON();
        if(req.url.endsWith('.srt'))return route.fulfill({json:{text:'1\n00:00:01,000 --> 00:00:06,000\nEnglish caption'}});
        await route.fulfill({json:{data:req.url.includes('/subtitles/')?{subtitles:[{id:'en',lang:'eng',url:'https://fixture.example/captions.srt'}]}:{metas:[]}}});
    });
    try{
        await page.goto('http://127.0.0.1:17780/');await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.getByRole('button',{name:'Play test video'}).click();await page.waitForFunction(()=>avCalls.some(x=>x[0]==='play'));
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.bufferMode'))),'default');
        await page.evaluate(()=>avListener.oncurrentplaytime(20000));
        await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.id),'timeline');
        for(let i=0;i<3;i++)await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(()=>avCalls.filter(x=>x[0]==='seek').length),0,'scrubbing must preview before issuing a seek');
        assert.equal(await page.locator('#timeline').inputValue(),'50');
        await page.keyboard.press('Enter');await page.waitForFunction(()=>document.getElementById('playback-status').textContent==='Playing');
        assert.deepEqual(await page.evaluate(()=>avCalls.filter(x=>x[0]==='seek').pop()),['seek',50000]);
        await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');
        assert.equal(await page.locator('#timeline').inputValue(),'50');assert(await page.locator('#player').isVisible());
        await page.getByRole('button',{name:'Go to time',exact:true}).click();
        const timeDialog=page.getByRole('dialog',{name:'Go to time',exact:true});
        await timeDialog.getByRole('textbox').fill('99:99');await timeDialog.getByRole('button',{name:'Go to time',exact:true}).click();
        await timeDialog.getByText('Enter a valid time before the end of this video.').waitFor();
        await timeDialog.getByRole('textbox').fill('01:02:03');await timeDialog.getByRole('button',{name:'Go to time',exact:true}).click();
        await page.waitForFunction(()=>document.getElementById('playback-status').textContent==='Playing');
        assert.deepEqual(await page.evaluate(()=>avCalls.filter(x=>x[0]==='seek').pop()),['seek',3723000]);
        await page.evaluate(()=>avListener.oncurrentplaytime(3000));
        await page.getByRole('button',{name:'Subtitles',exact:true}).click();
        await page.getByRole('radio',{name:/English.*Addon subtitles/}).click();
        await page.waitForFunction(()=>document.getElementById('subtitle').textContent==='English caption');
        await page.getByRole('button',{name:'Pause / play',exact:true}).click();
        await page.getByRole('button',{name:'Audio',exact:true}).click();
        await page.getByRole('radio',{name:/Dutch.*AAC.*Stereo/}).click();
        await page.waitForFunction(()=>document.getElementById('track-menu').className==='hidden');
        assert.equal(await page.evaluate(()=>nativePaused),true);
        assert.equal(await page.locator('#subtitle').textContent(),'English caption','audio switching must preserve external subtitles');
        assert.deepEqual(await page.evaluate(()=>avCalls.slice(-3)),[['play'],['track','AUDIO',5],['pause']]);
        await page.getByRole('button',{name:'Subtitles',exact:true}).click();
        await page.getByRole('button',{name:'Large subtitle text'}).click();
        assert.equal(await page.locator('#subtitle').evaluate(el=>el.style.fontSize),'44px');
        await page.getByRole('button',{name:'Later 0.5s',exact:true}).click();
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.subtitleOffset'))),0.5);
        await page.getByRole('radio',{name:/^Off/}).click();assert.equal(await page.locator('#subtitle').textContent(),'');
        await page.getByRole('button',{name:'Audio',exact:true}).click();await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(()=>document.activeElement.id),'audio');
        await page.evaluate(()=>{
            const original=window.setTimeout;
            window.setTimeout=function(fn,ms){return original(fn,ms===20000?40:ms);};
            webapis.avplay.seekTo=function(ms,ok){window.lateSeek=ok;};
        });
        await page.getByRole('button',{name:'Forward 10 seconds',exact:true}).click();
        await page.locator('#playback-status').filter({hasText:'Could not seek to this position.'}).waitFor();
        assert(await page.getByRole('button',{name:'Audio',exact:true}).isEnabled(),'a missing native seek callback must not lock controls');
        await page.evaluate(()=>lateSeek());
        assert.match(await page.locator('#playback-status').textContent(),/^Could not seek/,'ignore late seek success after timeout');
        await page.getByRole('button',{name:'Stop',exact:true}).click();
        assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Play test video');
        assert.deepEqual(errors,[]);
        console.log('PASS: timeline preview/commit/cancel, jump validation, language tracks, paused audio switching, subtitles preserved, subtitle controls, modal focus and source focus restoration');
    }finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
