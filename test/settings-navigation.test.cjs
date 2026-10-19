/* Remote-only Settings checks with synthetic accounts, catalog lists and sign-in responses. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),createServer=require('../service.js');
(async()=>{
 const root=path.join(__dirname,'..'),server=createServer({staticDir:path.join(root,'app')});await new Promise(r=>server.listen(17780,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 try{
  for(const viewport of [{width:1920,height:1080},{width:1280,height:720}]){
   const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];let creates=0;
   page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript(()=>{
    window.StremioAuto={version:'fixture',token:'fixture'};
    localStorage.setItem('sl.addons',JSON.stringify([{transportUrl:'https://fixture.example/manifest.json',manifest:{id:'fixture',name:'Many catalogs',resources:['catalog'],catalogs:Array.from({length:40},(_,i)=>({id:'c'+i,type:'movie',name:'Catalog '+i}))}}]));
   });
   await page.route('**/auto/status',r=>r.fulfill({json:{installed:'fixture'}}));
   await page.route('**/request',async r=>{
    const u=r.request().postDataJSON().url;
    if(u.includes('/v2/create')){creates++;return r.fulfill({json:{data:creates===1?{error:'Synthetic failure'}:{result:{code:'TEST-CODE',link:'https://link.stremio.com/?code=TEST-CODE'}}}});}
    if(u.includes('/v2/read'))return r.fulfill({json:{data:{result:{}}}});
    return r.fulfill({json:{data:{metas:[]}}});
   });
   async function active(){return page.evaluate(()=>document.activeElement.textContent);}
   async function visibleFocus(){const b=await page.evaluate(()=>{const r=document.activeElement.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};});assert(b.top>=108&&b.bottom<=viewport.height-40&&b.left>=0&&b.right<=viewport.width,'remote focus must remain on screen: '+JSON.stringify(b));}
   try{
    await page.goto('http://127.0.0.1:17780/');await page.getByRole('button',{name:'Settings',exact:true}).click();
    assert.equal(await active(),'Sign in with Stremio');await visibleFocus();assert.equal(await page.evaluate(()=>window.scrollY),0);
    await page.keyboard.press('Enter');await page.getByText('Could not create a sign-in link. Please try again.',{exact:true}).waitFor();
    assert.equal(await active(),'Sign in with Stremio');assert(await page.getByRole('button',{name:'Sign in with Stremio'}).isEnabled());
    await page.keyboard.press('Enter');await page.getByText('TEST-CODE',{exact:true}).waitFor();assert.equal(await active(),'Cancel sign-in');await visibleFocus();
    await page.keyboard.press('Enter');assert.equal(await page.getByText('TEST-CODE',{exact:true}).count(),0);assert.equal(await active(),'Sign in with Stremio');
    await page.keyboard.press('ArrowLeft');assert.equal(await active(),'Stremio account');
    await page.keyboard.press('ArrowDown');assert.equal(await active(),'Updates');
    await page.keyboard.press('ArrowDown');assert.equal(await active(),'Home catalogs');
    await page.keyboard.press('ArrowRight');assert.equal(await active(),'Show all');await visibleFocus();
    // Both directional axes reach the action row; Down then visits every switch in order.
    await page.keyboard.press('ArrowRight');assert.equal(await active(),'Hide all');
    for(let i=0;i<40;i++){await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('role')),'switch');assert.match(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),new RegExp('Catalog '+i+' ·'));await visibleFocus();}
    await page.keyboard.press('ArrowLeft');assert.equal(await active(),'Home catalogs');await visibleFocus();
    await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowRight');assert.equal(await active(),'Sign in with Stremio');await visibleFocus();
    await page.keyboard.press('Escape');assert.equal(await active(),'Stremio account');await page.keyboard.press('Escape');assert.equal(await active(),'Settings');
    await page.keyboard.press('ArrowDown');assert.equal(await active(),'Stremio account');await page.keyboard.press('ArrowRight');
    await page.screenshot({path:path.join(root,'artifacts/settings-3.1.2-'+viewport.width+'.jpg')});
    // A separate signed-in TV shows account actions immediately, independently of catalog count.
    await page.evaluate(()=>localStorage.setItem('sl.auth',JSON.stringify('synthetic-token')));await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();
    assert.equal(await active(),'Refresh account addons');await visibleFocus();await page.keyboard.press('ArrowDown');assert.equal(await active(),'Sign out and clear imported addons');
    await page.keyboard.press('Enter');assert.equal(await active(),'Sign in with Stremio');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sl.auth'))),'');
    assert.deepEqual(errors,[]);console.log('PASS Settings '+viewport.width+': immediate account access, failed login retry, cancellation, 40 catalogs remote-only, visible focus, section return, signout');
   }finally{await context.close();}
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
