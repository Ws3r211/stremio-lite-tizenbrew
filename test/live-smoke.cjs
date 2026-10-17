// Explicit live smoke test: public Cinemeta metadata, unauthenticated device code,
// and the public Blender playback sample. Never signs into a real account.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
const createServer=require('../service.js');
(async()=>{
    const server=createServer({staticDir:path.join(__dirname,'../app')});
    await new Promise(r=>server.listen(17780,'127.0.0.1',r));
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
    const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage();
    const report={date:new Date().toISOString(),browserVersion:browser.version(),platform:'Windows desktop; not a Tizen emulator or physical TV'};
    const mediaFailures=[];
    page.on('requestfailed',r=>{if(r.url().includes('/bunny/trailer.mp4'))mediaFailures.push(r.failure().errorText);});
    try{
        await page.goto('http://127.0.0.1:17780/');
        await page.locator('.card').first().waitFor({timeout:40000});
        report.liveCatalogCards=await page.locator('.card').count();
        await page.screenshot({path:path.join(__dirname,'../artifacts/discover-live.png')});
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.getByRole('button',{name:'Sign in with Stremio'}).click();
        await page.locator('.code').waitFor({timeout:40000});
        report.deviceCodeResponseRendered=true;
        // Cancel polling without consuming or displaying the temporary code.
        await page.getByRole('button',{name:'Discover',exact:true}).click();
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.getByRole('button',{name:'Play test video'}).click();
        await page.waitForFunction(()=>document.getElementById('video').currentTime>0.5,{},{timeout:40000});
        report.html5PlaybackAdvanced=await page.locator('#video').evaluate(v=>({seconds:v.currentTime,duration:v.duration}));
        await page.getByRole('button',{name:'Pause / play'}).click();
        assert(await page.locator('#video').evaluate(v=>v.paused));report.pauseWorks=true;
        await page.getByRole('button',{name:'Forward 10 seconds',exact:true}).click();
        await page.waitForFunction(()=>document.getElementById('video').currentTime>=10 && !document.getElementById('audio').disabled,{},{timeout:25000});report.seekWorks=true;
        await page.getByRole('button',{name:'Stop',exact:true}).click();report.stopWorks=await page.locator('#player').isHidden();
        report.passed=true;
    }catch(e){report.passed=false;report.error=e.message;report.mediaFailures=mediaFailures;
        report.player=await page.locator('#video').evaluate(v=>({readyState:v.readyState,networkState:v.networkState,error:v.error&&{code:v.error.code,message:v.error.message},status:document.getElementById('playback-status').textContent}));process.exitCode=1;}
    finally{
        await fs.mkdir(path.join(__dirname,'../artifacts'),{recursive:true});
        await fs.writeFile(path.join(__dirname,'../artifacts/live-smoke.json'),JSON.stringify(report,null,2));
        console.log(JSON.stringify(report,null,2));await context.close();await browser.close();await new Promise(r=>server.close(r));
    }
})().catch(e=>{console.error(e);process.exitCode=1;});
