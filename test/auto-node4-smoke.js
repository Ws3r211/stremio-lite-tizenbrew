/* Official Node 4 runtime check; uses only built-in modules and local temporary data. */
'use strict';
var fs=require('fs'),path=require('path'),os=require('os'),http=require('http'),assert=require('assert');
var createUpdater=require('../auto/updater.js'),root=path.join(__dirname,'..');
var dir=path.join(os.tmpdir(),'stremio-auto-node4-'+Date.now());fs.mkdirSync(dir);
var record={descriptor:JSON.parse(fs.readFileSync(path.join(root,'update.json'),'utf8')),text:fs.readFileSync(path.join(root,'runtime.json'),'utf8')};
var live=process.argv.indexOf('--live')>=0;
var opts={bundled:record,cacheDir:dir};
if(!live)opts.download=function(u,l,cb){process.nextTick(function(){cb(new Error('offline fixture'));});};
var ctrl=createUpdater(opts);
ctrl.server.listen(0,'127.0.0.1',function(){
 http.get('http://127.0.0.1:'+ctrl.server.address().port+'/health',function(res){var text='';res.on('data',function(c){text+=c;});res.on('end',function(){assert.equal(res.statusCode,200);assert.equal(JSON.parse(text).version,'3.1.0');ctrl.check(function(){assert.equal(ctrl.info().installed,'3.1.0');if(live)assert.equal(ctrl.info().notice,'');ctrl.server.close(function(){fs.readdirSync(dir).forEach(function(name){fs.unlinkSync(path.join(dir,name));});fs.rmdirSync(dir);console.log(process.version+' PASS automatic launcher, runtime VM, cache and '+(live?'public update check':'offline fallback'));});});});});
});
