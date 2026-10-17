/* Run with Node 4.4.3: node test/node4-smoke.js [--live]. No npm dependencies. */
'use strict';
var assert = require('assert'), http = require('http'), zlib = require('zlib');
var createServer = require('../service.js');
var payload = JSON.stringify({metas: [{id: 'ttFIXTURE', type: 'movie', name: 'Compressed catalog'}]});
var upstream = http.createServer(function (req, res) {
    if (req.url === '/redirect') { res.writeHead(307, {Location: '/gzip'}); return res.end(); }
    if (req.url === '/truncated') {
        res.writeHead(200, {'Content-Length': 1000, 'Connection': 'close'});
        res.write('{'); return setTimeout(function () { res.socket.destroy(); }, 10);
    }
    var encoding = req.url === '/deflate' ? 'deflate' : 'gzip';
    (encoding === 'gzip' ? zlib.gzip : zlib.deflate)(payload, function (err, data) {
        if (err) throw err;
        res.writeHead(200, {'Content-Encoding': encoding, 'Connection': 'close'});
        res.end(data);
    });
});
var service = createServer(), base, token;
function post(target, done) {
    var req = http.request({hostname: '127.0.0.1', port: service.address().port, path: '/request', method: 'POST', headers: {'X-Stremio-Lite': token}}, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { done(res.statusCode, JSON.parse(Buffer.concat(chunks).toString())); });
    });
    req.on('error', function (err) { throw err; });
    req.end(JSON.stringify({url: target}));
}
upstream.listen(0, '127.0.0.1', function () {
    base = 'http://127.0.0.1:' + upstream.address().port;
    service.listen(0, '127.0.0.1', function () {
        http.get({hostname: '127.0.0.1', port: service.address().port, path: '/health'}, function (res) {
            var text = ''; res.on('data', function (c) { text += c; });
            res.on('end', function () {
                token = JSON.parse(text).token;
                var targets = ['/gzip', '/deflate', '/redirect', '/truncated'];
                if (process.argv.indexOf('--live') >= 0) targets.push('https://v3-cinemeta.strem.io/catalog/movie/top.json');
                function next() {
                    if (!targets.length) { service.close(); upstream.close(); return; }
                    var target = targets.shift();
                    post(target.indexOf('https:') === 0 ? target : base + target, function (code, data) {
                        if (target === '/truncated') { assert.equal(code, 502); assert.ok(/interrupted/.test(data.error)); }
                        else { assert.equal(code, 200, JSON.stringify(data)); assert.ok(data.data.metas.length > 0); }
                        console.log(process.version + ' PASS ' + target + ' (' + code + ')'); next();
                    });
                }
                next();
            });
        });
    });
});
