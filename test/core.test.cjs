const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const C = require('../app/core.js');
const createServer = require('../service.js');

test('TV and service sources parse as ES5', () => {
    for (const file of ['app/core.js', 'app/app.js', 'service.js']) {
        acorn.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {ecmaVersion: 5});
    }
});
test('configured addon paths and episode IDs survive resource URL encoding', () => {
    assert.equal(C.manifestURL('stremio://example.com/token/manifest.json'), 'https://example.com/token/manifest.json');
    assert.equal(C.resourceURL({transportUrl:'https://example.com/token/manifest.json'}, 'stream', 'series', 'tt123:2:1', {filename:'A & B.mkv'}),
        'https://example.com/token/stream/series/tt123%3A2%3A1/filename=A%20%26%20B.mkv.json');
    assert.throws(() => C.manifestURL('javascript:alert(1)'));
    assert.throws(() => C.manifestURL('https://example.com/manifest.json?token=secret'));
});
test('resource descriptors obey per-resource types and ID prefixes', () => {
    const a={manifest:{types:['movie','series'],resources:[{name:'stream',types:['movie'],idPrefixes:['tt']} ]}};
    assert.equal(C.supports(a,'stream','movie','tt123'),true);
    assert.equal(C.supports(a,'stream','series','tt123'),false);
    assert.equal(C.supports(a,'stream','movie','abc'),false);
    assert.equal(C.supports(a,'meta','movie','tt123'),false);
});
test('search and required filters choose only callable catalog endpoints', () => {
    const addons=[{manifest:{catalogs:[{id:'search',extra:[{name:'search',isRequired:true}]},{id:'genre',extra:[{name:'genre',isRequired:true}]},{id:'plain'}]}}];
    assert.deepEqual(C.catalogs(addons,false).map(x=>x.catalog.id),['plain']);
    assert.deepEqual(C.catalogs(addons,true).map(x=>x.catalog.id),['search']);
});
test('streams needing another transport or headers have actionable errors', () => {
    assert.equal(C.playable({url:'https://example.com/video.mp4'}).ok,true);
    assert.match(C.playable({infoHash:'abc'}).reason,/Torrent/);
    assert.equal(C.playable({url:'javascript:alert(1)'}).ok,false);
    assert.equal(C.playable({url:'https://example.com',behaviorHints:{proxyHeaders:{request:{Authorization:'secret'}}}}).ok,false);
});
test('episode order, duplicate IDs, and subtitle timestamps use protocol values', () => {
    assert.deepEqual(C.sortVideos([{season:2,episode:1},{season:1,episode:2},{season:1,episode:1}]).map(x=>x.season+':'+x.episode),['1:1','1:2','2:1']);
    assert.equal(C.uniqueMetas([{id:'x',type:'movie',name:'a'},{id:'x',type:'movie',name:'a'},{id:'x',type:'series',name:'a'}]).length,2);
    assert.deepEqual(C.subtitleCues('1\r\n00:01:02,500 --> 00:01:05,000\r\n<b>Hello</b>\r\n'),[{start:62.5,end:65,text:'Hello\n'}]);
    assert.equal(C.subtitleCues('WEBVTT\n\n00:02.000 --> 00:04.500\nHello')[0].end,4.5);
});
test('service rejects foreign origins, missing session tokens, and malformed JSON', async () => {
    const server=createServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+server.address().port;
    try {
        assert.equal((await fetch(base+'/health',{headers:{Origin:'https://unrelated.example'}})).status,403);
        assert.equal((await fetch(base+'/request',{method:'POST',body:'{}'})).status,403);
        const token=(await (await fetch(base+'/health')).json()).token;
        assert.equal((await fetch(base+'/request',{method:'POST',headers:{'X-Stremio-Lite':token},body:'oops'})).status,400);
        const result=await fetch(base+'/request',{method:'POST',headers:{'X-Stremio-Lite':token},body:JSON.stringify({url:'http://localhost/api/login',method:'POST',body:{authKey:'test'}})});
        assert.match((await result.json()).error,/Unsupported request/);
    } finally { await new Promise(r=>server.close(r)); }
});
test('service preserves JSON and subtitles while surfacing invalid upstream responses', async () => {
    const server=createServer({upstream:(url,method,body,cb)=>cb(null,url==='text'?'subtitle text':url==='invalid'?'no json':'{"metas":[]}')});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
    try {
        const token=(await (await fetch(base+'/health')).json()).token;
        async function call(data){return fetch(base+'/request',{method:'POST',headers:{'X-Stremio-Lite':token},body:JSON.stringify(data)});}
        assert.deepEqual(await (await call({url:'json'})).json(),{data:{metas:[]}});
        assert.deepEqual(await (await call({url:'text',format:'text'})).json(),{text:'subtitle text'});
        assert.equal((await call({url:'invalid'})).status,502);
    } finally { await new Promise(r=>server.close(r)); }
});
test('service starts under the TizenBrew VM contract without __dirname or npm dependencies', () => {
    let listening=false;
    const mockHttp={createServer(){return {on(){},listen(port,host){assert.equal(port,17780);assert.equal(host,'127.0.0.1');listening=true;}};}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../service.js'),'utf8'),{module:{exports:{}},require:(name)=>name==='http'?mockHttp:require(name),Buffer,console});
    assert.equal(listening,true);
});
