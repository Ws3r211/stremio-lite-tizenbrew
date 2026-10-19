/* Official Node 4 runtime check; uses only built-in modules and local temporary data. */
'use strict';
var fs=require('fs'),path=require('path'),os=require('os'),http=require('http'),assert=require('assert'),crypto=require('crypto');
var createUpdater=require('../auto/updater.js'),root=path.join(__dirname,'..');
var dir=path.join(os.tmpdir(),'stremio-auto-node4-'+Date.now());fs.mkdirSync(dir);
var record={descriptor:JSON.parse(fs.readFileSync(path.join(root,'update.json'),'utf8')),text:fs.readFileSync(path.join(root,'runtime.json'),'utf8')};
var live=process.argv.indexOf('--live')>=0;
var upgrade=process.argv.indexOf('--upgrade-from-baseline')>=0, expected=record.descriptor.version;
process.argv.forEach(function(arg){if(arg.indexOf('--expected=')===0)expected=arg.slice(11);});
if(upgrade){
 var baseline=JSON.parse(record.text), original=baseline.version; baseline.version='3.1.0';
 Object.keys(baseline.files).forEach(function(name){baseline.files[name]=baseline.files[name].split(original).join('3.1.0');});
 var baselineText=JSON.stringify(baseline);record={descriptor:{schema:1,bootstrap:1,version:'3.1.0',ref:'v3.1.0',sha256:crypto.createHash('sha256').update(baselineText,'utf8').digest('hex')},text:baselineText};
}
var opts={bundled:record,cacheDir:dir};
if(!live)opts.download=function(u,l,cb){process.nextTick(function(){cb(new Error('offline fixture'));});};
var ctrl=createUpdater(opts);
ctrl.server.listen(0,'127.0.0.1',function(){
 http.get('http://127.0.0.1:'+ctrl.server.address().port+'/health',function(res){var text='';res.on('data',function(c){text+=c;});res.on('end',function(){assert.equal(res.statusCode,200);assert.equal(JSON.parse(text).version,record.descriptor.version);ctrl.check(function(){assert.equal(ctrl.info().installed,record.descriptor.version);assert.equal(ctrl.info().updaterVersion,2);if(live)assert.equal(ctrl.info().notice,'');if(upgrade)assert.equal(ctrl.info().available,expected);ctrl.server.close(function(){fs.readdirSync(dir).forEach(function(name){fs.unlinkSync(path.join(dir,name));});fs.rmdirSync(dir);console.log(process.version+' PASS automatic launcher, runtime VM, cache and '+(upgrade?'verified public upgrade to '+expected:live?'public update check':'offline fallback'));});});});});
});
