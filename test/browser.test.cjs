/* Browser tests use synthetic account/addon responses and an AVPlay mock.
   They do not establish real-TV codec or API compatibility. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const createServer=require('../service.js');
async function run(browser, existingServer) {
    const server=existingServer||createServer({staticDir:path.join(__dirname,'../app')});
    if(!existingServer)await new Promise(r=>server.listen(17780,'127.0.0.1',r));
    const context=await browser.newContext({viewport:{width:1920,height:1080}});
    const page=await context.newPage(), errors=[], calls=[];
    page.on('pageerror',e=>errors.push(e.message));
    const movie={id:'ttTEST',type:'movie',name:'Fixture Movie',description:'A synthetic catalog item used for client tests.',year:'2026'};
    const series={id:'ttSERIES',type:'series',name:'Fixture Series',videos:[{id:'ttSERIES:1:2',season:1,episode:2,title:'Second'},{id:'ttSERIES:1:1',season:1,episode:1,title:'First'}]};
    const addon={transportUrl:'https://fixture.example/manifest.json',manifest:{id:'fixture',name:'Fixture Addon',types:['movie','series'],resources:['meta','stream','subtitles'],catalogs:[]}};
    await context.addInitScript(()=>{
        window.WebAssembly=undefined;
        localStorage.setItem('sl.bufferMode',JSON.stringify('balanced'));
        localStorage.setItem('sl.playerPrefsVersion',JSON.stringify(3));
        window.avCalls=[];
        window.webapis={avplay:{
            open(u){window.avCalls.push(['open',u]);},setDisplayRect(){},setListener(l){window.avListener=l;},
            setBufferingParam(option,unit,amount){window.avCalls.push(['buffer',option,unit,amount]);},setTimeoutForBuffering(seconds){window.avCalls.push(['timeout',seconds]);},prepareAsync(ok){window.avCalls.push(['prepare']);setTimeout(ok,80);},play(){window.avCalls.push(['play']);},pause(){window.avCalls.push(['pause']);},
            stop(){window.avCalls.push(['stop']);},close(){window.avCalls.push(['close']);},seekTo(ms){window.avCalls.push(['seek',ms]);},
            getDuration(){return 120000;},getTotalTrackInfo(){return [{type:'AUDIO',index:0},{type:'TEXT',index:1}];},
            setSilentSubtitle(){},setSelectTrack(type,index){window.avCalls.push(['track',type,index]);}
        }};
    });
    await page.route('**/request',async route=>{
        const request=route.request().postDataJSON(); calls.push(request);
        const u=request.url;let data;
        if(u.includes('/catalog/')) data={metas:[movie,series]};
        else if(u.includes('/meta/series/'))data={meta:series};
        else if(u.includes('/meta/'))data={meta:movie};
        else if(u.includes('/stream/'))data={streams:[{name:'HTTP fixture',url:'https://fixture.example/movie.mp4'},{name:'Torrent fixture',infoHash:'a'.repeat(40)}]};
        else if(u.includes('/subtitles/'))data={subtitles:[{id:'en',lang:'eng',url:'https://fixture.example/sub.srt'}]};
        else if(u.includes('/sub.srt'))return route.fulfill({json:{text:'1\n00:00:02,000 --> 00:00:05,000\nHello TV'}});
        else if(u.includes('/v2/create'))data={result:{code:'TEST-ONLY',link:'https://link.stremio.com/?code=TEST-ONLY'}};
        else if(u.includes('/v2/read'))data={result:{authKey:'synthetic-test-token'}};
        else if(u.endsWith('/addonCollectionGet'))data={result:{addons:[addon]}};
        else if(u.endsWith('/datastoreGet'))data={result:[{_id:movie.id,type:movie.type,name:movie.name,removed:false,temp:false}]};
        else if(u.endsWith('/manifest.json'))data=addon.manifest;
        else throw new Error('Uncovered fixture request '+u);
        await route.fulfill({json:{data}});
    });
    try{
        await page.goto('http://127.0.0.1:17780/');
        await page.getByRole('button',{name:'Fixture Movie'}).first().waitFor();
        assert.equal(await page.evaluate(()=>typeof WebAssembly),'undefined');
        await page.keyboard.press('ArrowRight');
        assert.match(await page.evaluate(()=>document.activeElement.textContent),/Fixture Series/);
        const previousFocusY=await page.evaluate(()=>document.activeElement.getBoundingClientRect().top);
        await page.keyboard.press('ArrowUp');
        assert((await page.evaluate(()=>document.activeElement.getBoundingClientRect().top))<previousFocusY);
        await page.getByRole('button',{name:'Search',exact:true}).first().click();
        await page.getByRole('searchbox').fill('A & B');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BUTTON');
        await page.getByRole('button',{name:'Search',exact:true}).last().click();
        await page.getByRole('button',{name:'Fixture Movie'}).first().waitFor();
        assert(calls.some(x=>x.url.includes('search=A%20%26%20B')));
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.getByRole('button',{name:'Sign in with Stremio'}).click();
        await page.getByText('TEST-ONLY',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Refresh account addons'}).waitFor({timeout:10000});
        assert(calls.some(x=>x.url.endsWith('/addonCollectionGet')&&x.body.authKey==='synthetic-test-token'));
        await page.getByRole('button',{name:'Library',exact:true}).click();
        await page.getByRole('button',{name:'Fixture Movie'}).first().click();
        await page.getByRole('button',{name:'Find streams'}).click();
        await page.getByRole('button',{name:/Torrent fixture/}).click();
        assert.match(await page.locator('#status').textContent(),/Torrent source/);
        await page.getByRole('button',{name:/HTTP fixture/}).click();
        await page.waitForFunction(()=>avCalls.some(x=>x[0]==='play'));
        assert.deepEqual(await page.evaluate(()=>avCalls.filter(x=>x[0]==='buffer').map(x=>x.slice(1))),[['PLAYER_BUFFER_FOR_PLAY','PLAYER_BUFFER_SIZE_IN_SECOND',10],['PLAYER_BUFFER_FOR_RESUME','PLAYER_BUFFER_SIZE_IN_SECOND',15]]);
        assert(await page.evaluate(()=>avCalls.findIndex(x=>x[0]==='buffer')<avCalls.findIndex(x=>x[0]==='prepare')));
        await page.evaluate(()=>{avListener.onbufferingstart();avListener.onbufferingstart();avListener.onbufferingprogress(40);});
        assert.match(await page.locator('#playback-status').textContent(),/Repeated pauses/);
        await page.getByRole('button',{name:'Pause / play'}).click();
        assert(await page.evaluate(()=>avCalls.some(x=>x[0]==='pause')));
        await page.getByRole('button',{name:'Subtitles',exact:true}).click();
        await page.getByRole('radio',{name:/English.*Addon subtitles/}).click();
        await page.waitForFunction(()=>document.getElementById('playback-status').textContent==='External subtitles enabled.');
        await page.evaluate(()=>window.avListener.oncurrentplaytime(3000));
        assert.equal(await page.locator('#subtitle').textContent(),'Hello TV');
        await page.keyboard.press('Escape');assert(await page.locator('#player').isHidden());
        await page.getByRole('button',{name:'Discover',exact:true}).click();
        await page.getByRole('button',{name:'Fixture Series'}).first().click();
        await page.getByRole('button',{name:/^1\. First/}).waitFor();
        await page.getByRole('button',{name:/^1\. First/}).click();
        await page.getByRole('button',{name:/HTTP fixture/}).waitFor();
        assert(calls.some(x=>x.url.includes('/stream/series/ttSERIES%3A1%3A1.json')));
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.screenshot({path:path.join(__dirname,'../artifacts/settings.png'),fullPage:true});
        await page.getByRole('button',{name:'Sign out and clear imported addons'}).click();
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.auth'))),'');
        assert.equal(await page.getByText('Fixture Addon',{exact:true}).count(),0);
        // Stop during an asynchronous prepare: its callback must not restart playback.
        await page.getByRole('button',{name:'Play test video'}).click();
        await page.getByRole('button',{name:'Stop',exact:true}).click();
        const plays=await page.evaluate(()=>avCalls.filter(x=>x[0]==='play').length);
        await page.waitForTimeout(200);
        assert.equal(await page.evaluate(()=>avCalls.filter(x=>x[0]==='play').length),plays);
        assert.deepEqual(errors,[]);
        return {passed:true,flows:['ES5 app with WASM disabled','D-pad navigation','catalog/search','device-code login fixture','account addons/library import','series episode IDs','torrent explanation','native playback mock','pause/stop','external SRT overlay','prepare cancellation','signout cleanup'],browserVersion:browser.version()};
    }finally{await context.close();if(!existingServer)await new Promise(r=>server.close(r));}
}
module.exports=run;
if(require.main===module){
    const {chromium}=require('playwright');
    (async()=>{const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});try{console.log(JSON.stringify(await run(b),null,2));}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
}
