/* Deterministic update discovery/migration tests. No account or real network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const create=require('../auto/updater.js'),source=fs.readFileSync(path.join(__dirname,'../auto/updater.js'),'utf8');
const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../runtime.json'),'utf8'));
function release(v){const bundle=JSON.parse(JSON.stringify(base));bundle.version=v;const text=JSON.stringify(bundle);return {descriptor:{schema:1,bootstrap:1,version:v,ref:'v'+v,sha256:crypto.createHash('sha256').update(text,'utf8').digest('hex')},text};}
const old=release('3.1.5'),next=release('3.1.7'),future=release('3.1.8');
async function fixture(run,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stremio-discovery-'));
 try{if(options.state)fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(options.state));await run(dir);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function state(current,previous=null,unconfirmed=false){return {current,previous,pending:null,unconfirmed,blocked:''};}
function fake(route,requests){return (u,l,cb)=>{requests.push(u);setImmediate(()=>{try{const response=route(u);if(response instanceof Error)return cb(response);cb(null,response);}catch(e){cb(e);}});};}
function check(ctrl){return new Promise(resolve=>ctrl.check(()=>resolve(ctrl.info())));}
function pointer(u){return u.includes('update.json');}
function encode(record){return JSON.stringify(record.descriptor);}
test('fresh raw GitHub pointer and exact tag bundle bypass a stale branch CDN',()=>fixture(async dir=>{
 const requests=[],ctrl=create({bundled:old,cacheDir:dir,download:fake(u=>pointer(u)?encode(next):next.text,requests)});
 const info=await check(ctrl);assert.equal(info.available,'3.1.7');assert.equal(info.installed,'3.1.5');assert.equal(info.updaterVersion,2);
 assert.match(requests[0],/raw\.githubusercontent\.com.*\/main\/update\.json\?check=\d+$/);assert.match(requests[1],/raw\.githubusercontent\.com.*\/v3\.1\.7\/runtime\.json$/);
 assert(requests.every(u=>!u.includes('cdn.jsdelivr.net')));
}));
test('independent GitHub API and immutable CDN bundle recover from raw-host failure',()=>fixture(async dir=>{
 const requests=[],ctrl=create({bundled:old,cacheDir:dir,download:fake(u=>u.includes('raw.githubusercontent.com')?new Error('certificate failure'):pointer(u)?encode(next):next.text,requests)});
 assert.equal((await check(ctrl)).available,'3.1.7');assert.equal(requests.length,4);
 assert.match(requests[1],/api\.github\.com\/repos\/Ws3r211\/stremio-lite-tizenbrew\/contents\/update\.json\?ref=main&check=\d+/);
 assert.match(requests[3],/cdn\.jsdelivr\.net.*@v3\.1\.7\/runtime\.json$/);assert(requests.every(u=>!u.includes('@main')&&!u.includes('cdn.jsdelivr.net/gh/Ws3r211/stremio-lite-tizenbrew/update.json')));
}));
test('invalid first pointer falls back to GitHub API',()=>fixture(async dir=>{
 const requests=[],ctrl=create({bundled:old,cacheDir:dir,download:fake(u=>pointer(u)?u.includes('api.github.com')?encode(next):'{invalid':next.text,requests)});
 assert.equal((await check(ctrl)).available,'3.1.7');assert.equal(requests.length,3);
}));
test('both discovery hosts failing preserves installed runtime and reports failure',()=>fixture(async dir=>{
 const requests=[],ctrl=create({bundled:old,cacheDir:dir,download:fake(()=>new Error('offline'),requests)});
 const info=await check(ctrl);assert.equal(info.installed,'3.1.5');assert.equal(info.available,null);assert.match(info.notice,/failed/);assert.equal(requests.length,2);assert(requests.every(u=>!u.includes('cdn.jsdelivr.net')));
}));
test('corrupt bundles from either host never stage an update',()=>fixture(async dir=>{
 const requests=[],ctrl=create({bundled:old,cacheDir:dir,download:fake(u=>pointer(u)?encode(next):next.text.slice(0,-9),requests)});
 const info=await check(ctrl);assert.equal(info.installed,'3.1.5');assert.equal(info.available,null);assert.match(info.notice,/failed/);assert.equal(requests.length,3);
}));
test('one-time newer launcher immediately uses bundled fixes despite an older saved runtime',()=>fixture(async dir=>{
 const requests=[],ctrl=create({bundled:next,cacheDir:dir,download:fake(()=>new Error('offline'),requests)});
 assert.equal(ctrl.info().installed,'3.1.7');await check(ctrl);assert.equal(ctrl.info().installed,'3.1.7');
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'state.json'))).previous.descriptor.version,'3.1.5');
},{state:state(old)}));
test('a newer saved app is retained when the launcher bundles an older release',()=>fixture(async dir=>{
 const ctrl=create({bundled:next,cacheDir:dir,download:fake(()=>new Error('offline'),[])});assert.equal(ctrl.info().installed,'3.1.8');
},{state:state(future)}));
test('an unconfirmed failed startup still rolls back and blocks the bundled failed digest',()=>fixture(async dir=>{
 const ctrl=create({bundled:next,cacheDir:dir,download:fake(()=>encode(next),[])});assert.equal(ctrl.info().installed,'3.1.5');assert.match(ctrl.info().notice,/Restored/);
 await check(ctrl);assert.equal(ctrl.info().available,null);assert.match(ctrl.info().notice,/skipped/);
},{state:state(next,old,true)}));
test('transport verifies TLS, scopes ISRG X1 to raw GitHub and requests raw API content',()=>fixture(async dir=>{
 const options=[],sandbox={module:{exports:{}},Buffer,console,setTimeout,clearTimeout,setInterval,clearInterval};
 sandbox.require=name=>name==='https'?{get(settings){options.push(settings);const req=new EventEmitter();req.abort=()=>{};process.nextTick(()=>req.emit('error',new Error('fixture unavailable')));return req;}}:require(name);
 vm.runInNewContext(source,sandbox);
 const ctrl=sandbox.module.exports({bundled:old,cacheDir:dir});await check(ctrl);assert.equal(options.length,2);
 for(const o of options){assert.equal(o.rejectUnauthorized,true);assert.equal(o.headers['Cache-Control'],'no-cache');}
 const raw=options[0],api=options[1];assert.equal(raw.hostname,'raw.githubusercontent.com');assert.equal(api.hostname,'api.github.com');assert.equal(api.ca,undefined);
 const cert=new crypto.X509Certificate(raw.ca);assert.equal(cert.fingerprint256,'96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6');assert(cert.subject.includes('ISRG Root X1'));
 assert.equal(api.headers.Accept,'application/vnd.github.raw+json');
}));
