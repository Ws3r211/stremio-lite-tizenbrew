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
test('identify the built-in Local Files addon without removing other network addons', () => {
    assert.equal(C.isLocalFiles({manifest:{id:'org.stremio.local'},transportUrl:'http://192.0.2.1/manifest.json'}),true);
    for(const host of ['127.0.0.1','localhost','[::1]'])assert.equal(C.isLocalFiles({transportUrl:'http://'+host+':11470/local-addon/manifest.json'}),true);
    assert.equal(C.isLocalFiles({manifest:{id:'custom',name:'Local Files'},transportUrl:'https://provider.example/manifest.json'}),false);
    assert.equal(C.isLocalFiles({transportUrl:'http://127.0.0.1:17780/manifest.json'}),false);
});
test('streams needing another transport or headers have actionable errors', () => {
    assert.equal(C.playable({url:'https://example.com/video.mp4'}).ok,true);
    assert.match(C.playable({infoHash:'abc'}).reason,/Torrent/);
    assert.equal(C.playable({url:'javascript:alert(1)'}).ok,false);
    assert.equal(C.playable({url:'https://example.com',behaviorHints:{proxyHeaders:{request:{Authorization:'secret'}}}}).ok,false);
});
test('content labels, metadata merging and release dates preserve identity and uncertainty',()=>{
    assert.equal(C.typeLabel('series'),'TV show');assert.equal(C.typeLabel('tv'),'Live TV');assert.equal(C.typeLabel('library'),'Library item');
    const partial={id:'x',type:'series',name:'Show'},full={id:'x',type:'series',name:'Show',poster:'https://example.com/poster.jpg',year:'2024'};
    const merged=C.uniqueMetas([partial,full,{id:'y',type:'series',name:'Show'},{id:'x',type:'movie',name:'Show'}]);
    assert.equal(merged.length,3);assert.equal(merged[0].poster,full.poster);assert.equal(partial.poster,undefined);
    assert.equal(C.releaseDetails('2026-10-16T22:00:00Z',Date.UTC(2026,9,17)).label,'Released · 16 Oct 2026');
    assert.equal(C.releaseDetails('2026-10-18',Date.UTC(2026,9,17)).upcoming,true);
    for(const value of [undefined,'not a date','2026-02-30'])assert.equal(C.releaseDetails(value).label,'Release date not provided');
});
test('episode order, duplicate IDs, and subtitle timestamps use protocol values', () => {
    assert.deepEqual(C.sortVideos([{season:2,episode:1},{season:1,episode:2},{season:1,episode:1}]).map(x=>x.season+':'+x.episode),['1:1','1:2','2:1']);
    assert.equal(C.uniqueMetas([{id:'x',type:'movie',name:'a'},{id:'x',type:'movie',name:'a'},{id:'x',type:'series',name:'a'}]).length,2);
    assert.deepEqual(C.subtitleCues('1\r\n00:01:02,500 --> 00:01:05,000\r\n<b>Hello</b>\r\n'),[{start:62.5,end:65,text:'Hello\n'}]);
    assert.equal(C.subtitleCues('WEBVTT\n\n00:02.000 --> 00:04.500\nHello')[0].end,4.5);
});
test('player track names and jump times handle real metadata and invalid input', () => {
    assert.equal(C.trackLabel({extra_info:'{"language":"nld","channels":"6","fourCC":"AACL"}'}),'Dutch · AAC · 5.1 surround');
    assert.equal(C.trackLabel({extra_info:'null'}),'Unknown language');
    assert.equal(C.trackLabel({extra_info:'{"track_lang":"en-US"}'}),'English');
    assert.equal(C.parseTime('01:02:03'),3723);assert.equal(C.parseTime('12:30'),750);assert.equal(C.parseTime('90'),90);
    for(const value of ['1:60','-1','a:12','1:2:3:4',''])assert.equal(C.parseTime(value),null);
});
test('stream labels distinguish codec compatibility from bitrate and file size', () => {
    const info=C.streamInfo({name:'4K HEVC-DV-HDR10+',description:'24GB 25.3 Mbps'});
    assert.deepEqual(info.tags,['4K','HEVC','Dolby Vision','HDR10+','25.3 Mbps','24 GB']);
    assert.equal(info.warnings.length,2);
    assert.match(info.warnings[0],/hybrid.*HDR10 base/);
    assert.equal(C.streamInfo({name:'1080p H.264',behaviorHints:{videoSize:4000000000}}).warnings.length,0);
    assert.equal(C.streamInfo({description:'24GB'}).mbps,0);
    assert.equal(C.streamInfo({description:'Adventure DVDRip'}).warnings.length,0);
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
test('preview serves the bundled player icons as SVG while keeping service source private', async () => {
    const server=createServer({staticDir:path.join(__dirname,'../app')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+server.address().port;
    try{
        const icons=await fetch(base+'/player-icons.svg');assert.equal(icons.status,200);assert.match(icons.headers.get('content-type'),/^image\/svg\+xml/);
        assert.match(await icons.text(),/id="player-play"/);
        assert.equal((await fetch(base+'/service.js')).status,404);
    }finally{await new Promise(r=>server.close(r));}
});
