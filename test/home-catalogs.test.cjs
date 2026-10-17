/* Synthetic local/provider responses: no real account, file service or configured URL. */
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
const createServer=require('../service.js');
(async()=>{
    const server=createServer({staticDir:path.join(__dirname,'../app')});
    await new Promise(r=>server.listen(17780,'127.0.0.1',r));
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
    const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage();
    const builtin={transportUrl:'http://127.0.0.1:11470/local-addon/manifest.json',manifest:{id:'org.stremio.local',name:'Local Files',resources:['catalog','stream','meta'],types:['movie','other'],catalogs:[{id:'local',type:'other',name:'Local Files'}]}};
    const addons=[
        {transportUrl:'https://unavailable.example/manifest.json',manifest:{id:'unavailable',name:'Unavailable catalog',resources:['catalog'],types:['other'],catalogs:[{id:'unavailable',type:'other',name:'Unavailable'}]}},
        {transportUrl:'https://fixture.example/config-a/manifest.json',manifest:{id:'aio',name:'AIOMetaData',resources:['catalog','meta'],types:['movie','series'],catalogs:[{id:'top',type:'movie',name:'Trending A',extra:[{name:'search'}]},{id:'top',type:'series',name:'Series A'}]}},
        {transportUrl:'https://fixture.example/config-b/manifest.json',manifest:{id:'aio',name:'AIOMetaData',resources:['catalog','meta'],types:['movie'],catalogs:[{id:'top',type:'movie',name:'Trending B'}]}}
    ];
    let localCalls=0;const calls=[],errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(data=>{
        if(!localStorage.getItem('sl.addons'))localStorage.setItem('sl.addons',JSON.stringify(data));
        if(!localStorage.getItem('sl.auth'))localStorage.setItem('sl.auth',JSON.stringify('synthetic-token'));
    },[builtin].concat(addons));
    await page.route('https://unavailable.example/**',async route=>{
        localCalls++;await route.fulfill({status:502,headers:{'access-control-allow-origin':'*'},json:{error:'Synthetic local service unavailable'}});
    });
    await page.route('**/request',async route=>{
        const req=route.request().postDataJSON(),u=req.url;calls.push(req);
        if(u.includes('unavailable.example')){localCalls++;return route.fulfill({status:502,json:{error:'Network request failed (ECONNREFUSED).'}});}
        let data;
        if(u.endsWith('/addonCollectionGet'))data={result:{addons:[builtin].concat(addons)}};
        else if(u.includes('/catalog/'))data={metas:[{id:'tt-fixture',type:u.includes('/series/')?'series':'movie',name:'Healthy fixture',description:'A working catalog'}]};
        else data={meta:{id:'tt-fixture',type:'movie',name:'Healthy fixture'}};
        await route.fulfill({json:{data}});
    });
    try{
        await page.goto('http://127.0.0.1:17780/');
        await page.getByRole('button',{name:'Retry catalog',exact:true}).waitFor();
        assert(calls.every(x=>!x.url.includes(':11470/')),'stored built-in Local Files must be excluded before any request');
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.addons')).some(a=>a.manifest.id==='org.stremio.local')),false);
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        assert.equal(await page.getByRole('switch',{name:/Show Local Files/}).count(),0);
        const localSwitch=page.getByRole('switch',{name:'Show Unavailable catalog · Unavailable · other on Home',exact:true});
        await localSwitch.click();
        assert.equal(await localSwitch.getAttribute('aria-checked'),'false');
        // Enter on the focused TV control toggles in place, keeping remote focus.
        await page.keyboard.press('Enter');assert.equal(await localSwitch.getAttribute('aria-checked'),'true');
        await page.keyboard.press('Enter');assert.equal(await localSwitch.getAttribute('aria-checked'),'false');
        await page.getByRole('switch',{name:'Show AIOMetaData · Trending A · Movies on Home',exact:true}).click();
        assert.equal(await page.getByRole('switch',{name:'Show AIOMetaData · Trending B · Movies on Home',exact:true}).getAttribute('aria-checked'),'true');
        const localBefore=localCalls;
        await page.getByRole('button',{name:'Discover',exact:true}).click();
        await page.locator('.card').first().waitFor();
        assert.deepEqual(await page.locator('.shelf-heading h2').allTextContents(),['Series A','Trending B']);
        assert.equal(await page.getByRole('button',{name:'Retry catalog'}).count(),0);
        await page.reload();await page.locator('.card').first().waitFor();
        assert.equal(localCalls,localBefore,'disabled local catalog must make no requests after reload');
        assert.equal(await page.locator('.catalog-row').count(),2);
        // Home visibility does not remove the addon or suppress its search resource.
        await page.getByRole('button',{name:'Search',exact:true}).first().click();
        await page.getByRole('searchbox').fill('sample');await page.getByRole('button',{name:'Search',exact:true}).last().click();
        await page.locator('.card').first().waitFor();
        assert(calls.some(x=>x.url.includes('/config-a/catalog/movie/top/search=sample')));
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.getByRole('button',{name:'Refresh account addons'}).click();
        await page.waitForFunction(()=>document.getElementById('status').textContent==='Addons refreshed.');
        assert.equal(await localSwitch.getAttribute('aria-checked'),'false');
        assert.equal(await page.getByRole('switch',{name:/Show Local Files/}).count(),0);
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.addons')).some(a=>a.manifest.id==='org.stremio.local')),false);
        assert(calls.every(x=>!x.url.includes(':11470/')));
        const countBeforeManual=calls.length;
        await page.getByRole('textbox',{name:'Addon manifest URL',exact:true}).fill(builtin.transportUrl);
        await page.getByRole('button',{name:'Add addon',exact:true}).click();
        await page.waitForFunction(()=>document.getElementById('status').textContent.includes('cannot be added'));
        assert.equal(calls.length,countBeforeManual,'manual loopback Local Files must be rejected before networking');
        assert.equal(await page.getByRole('switch',{name:'Show AIOMetaData · Trending A · Movies on Home',exact:true}).getAttribute('aria-checked'),'false');
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.auth'))),'synthetic-token');
        await page.getByRole('button',{name:'Hide all',exact:true}).click();
        const beforeEmpty=calls.length;
        await page.getByRole('button',{name:'Discover',exact:true}).click();
        await page.getByRole('button',{name:'Choose Home catalogs',exact:true}).waitFor();
        assert.equal(await page.locator('.catalog-row').count(),0);
        assert.equal(calls.length,beforeEmpty,'all-hidden Home must make no provider requests');
        await page.getByRole('button',{name:'Choose Home catalogs',exact:true}).click();
        await page.getByRole('button',{name:'Show all',exact:true}).click();
        assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.hiddenCatalogs')))).length,0);
        await localSwitch.click();
        await page.getByRole('button',{name:'Sign out and clear imported addons'}).click();
        assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.hiddenCatalogs')))).length,0);
        assert.deepEqual(errors,[]);
        console.log('PASS: Local Files migration/import exclusion/manual rejection, remote catalog switches, distinct addon configurations, saved visibility, no hidden requests/502, search retained, refresh retained, empty state, show/hide all, signout cleanup');
    }finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
