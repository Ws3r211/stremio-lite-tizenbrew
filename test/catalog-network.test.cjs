/* Synthetic provider/configuration; never uses an account or configured user URL. */
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');
const createServer = require('../service.js');
(async () => {
    let serviceFails = false, directFails = false, accountCalls = 0;
    const server = createServer({staticDir:path.join(__dirname,'../app'), upstream:(url,method,body,cb) => {
        if (method === 'POST') { accountCalls++; return cb(new Error('Network or certificate request failed (CERT_HAS_EXPIRED).')); }
        if (serviceFails) return cb(new Error('Network or certificate request failed (CERT_HAS_EXPIRED).'));
        cb(null,JSON.stringify({metas:[{id:'tmdb:123',type:'movie',name:'Service catalog'}]}));
    }});
    await new Promise(r => server.listen(17780,'127.0.0.1',r));
    const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
    const context = await browser.newContext(), page = await context.newPage(), directCalls = [], errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(() => {
        localStorage.setItem('sl.auth',JSON.stringify('synthetic-test-token'));
        localStorage.setItem('sl.addons',JSON.stringify([{transportUrl:'https://provider.example/stremio/fixture/config/manifest.json',manifest:{id:'fixture',name:'AIOMetadata fixture',types:['movie'],resources:['catalog','meta'],catalogs:[{id:'tmdb.popular',type:'movie',name:'Popular'}]}}]));
    });
    await page.route('https://provider.example/**', async route => {
        directCalls.push(route.request().url());
        await route.fulfill({status:directFails?503:200,headers:{'access-control-allow-origin':'*'},json:directFails?{error:'Unavailable'}:{metas:[{id:'tmdb:123',type:'movie',name:'Browser catalog'}]}});
    });
    let directAccountCalls = 0;
    await page.route('https://api.strem.io/**',async route=>{directAccountCalls++;await route.abort();});
    try {
        await page.goto('http://127.0.0.1:17780/');
        await page.getByRole('button',{name:'Service catalog'}).waitFor();
        assert.equal(directCalls.length,0);
        serviceFails = true;
        await page.getByRole('button',{name:'Discover',exact:true}).click();
        await page.getByRole('button',{name:'Browser catalog'}).waitFor();
        assert.equal(directCalls[0],'https://provider.example/stremio/fixture/config/catalog/movie/tmdb.popular.json');
        directFails = true;
        await page.getByRole('button',{name:'Discover',exact:true}).click();
        await page.getByRole('button',{name:'Retry catalog'}).waitFor();
        assert.match(await page.locator('#status').textContent(),/AIOMetadata fixture: HTTP 502:.*CERT_HAS_EXPIRED.*Browser fallback: HTTP 503/);
        directFails = false;
        await page.getByRole('button',{name:'Retry catalog'}).click();
        await page.getByRole('button',{name:'Browser catalog'}).waitFor();
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.getByRole('button',{name:'Refresh account addons'}).click();
        await page.waitForFunction(()=>document.getElementById('status').textContent.indexOf('CERT_HAS_EXPIRED')>=0);
        assert.equal(accountCalls,1); assert.equal(directAccountCalls,0);
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.auth'))),'synthetic-test-token');
        assert.deepEqual(errors,[]);
        console.log('PASS: service catalogs, configured AIOMetadata-style paths, browser fallback, useful errors, retry, account POST isolation and stored account preservation');
    } finally {await context.close();await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
