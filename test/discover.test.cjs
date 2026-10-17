const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
const createServer=require('../service.js');
(async()=>{
    const server=createServer({staticDir:path.join(__dirname,'../app')});
    await new Promise(r=>server.listen(17780,'127.0.0.1',r));
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
    const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage();
    const errors=[],catalogCalls=[];let active=0,maxActive=0;
    page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(()=>{
        const catalogs=Array.from({length:10},(_,i)=>({id:'shelf'+i,name:'Shelf '+i,type:i%2?'series':'movie',extra:[{name:'skip'}]}));
        localStorage.setItem('sl.addons',JSON.stringify([{transportUrl:'https://fixture.example/config/manifest.json',manifest:{id:'custom',name:'AIOMetadata fixture',resources:['catalog','meta'],types:['movie','series'],catalogs}}]));
    });
    await page.route('**/request',async route=>{
        const {url}=route.request().postDataJSON();let data;
        if(url.includes('/catalog/')){
            catalogCalls.push(url);active++;maxActive=Math.max(maxActive,active);
            const type=url.includes('/series/')?'series':'movie';
            const id=url.match(/shelf\d+/)[0];
            await new Promise(r=>setTimeout(r,40));active--;
            data={metas:Array.from({length:20},(_,i)=>({id:id+'-'+i,type,name:id+' title '+i,description:'A catalog-provided description.'}))};
        }else data={meta:{id:'shelf0-0',type:'movie',name:'shelf0 title 0',description:'Details from the provider.'}};
        await route.fulfill({json:{data}});
    });
    try{
        await page.goto('http://127.0.0.1:17780/');
        await page.getByRole('button',{name:'shelf0 title 0'}).waitFor();
        assert.equal(await page.getByRole('combobox',{name:'Catalog'}).count(),0);
        assert.equal(await page.locator('.catalog-row').count(),10);
        await page.waitForTimeout(180);
        assert(maxActive<=2);assert(catalogCalls.length<10);
        for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');
        assert.match(await page.evaluate(()=>document.activeElement.textContent),/shelf0 title 8/);
        assert(await page.locator('.shelf-track').first().evaluate(el=>el.scrollLeft>0));
        await page.keyboard.press('ArrowDown');
        await page.getByRole('button',{name:'shelf1 title 8'}).waitFor();
        assert.match(await page.evaluate(()=>document.activeElement.textContent),/shelf1 title 8/);
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Enter');
        await page.getByRole('button',{name:'Find streams'}).waitFor();
        await page.getByRole('button',{name:'Back',exact:true}).click();
        await page.waitForFunction(()=>document.activeElement.textContent.includes('shelf0 title 8'));
        const before=catalogCalls.length;
        await page.getByRole('button',{name:'Movies',exact:true}).click();
        assert.equal(await page.locator('.catalog-row').count(),5);
        assert.equal(await page.locator('.catalog-kind').allTextContents().then(x=>x.every(t=>t==='Movies')),true);
        assert.equal(catalogCalls.length,before);
        await page.getByRole('button',{name:'All',exact:true}).click();
        await page.locator('.shelf-more').first().click();
        await page.getByRole('button',{name:'shelf0 title 19'}).waitFor();
        assert(catalogCalls.every(u=>!u.includes('skip=')),'cached titles should be revealed without a page request');
        assert.deepEqual(errors,[]);
        console.log('PASS: combined catalogs, bounded requests, lazy shelves, horizontal/vertical remote movement, return focus, cached filtering and cached load-more');
    }finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
