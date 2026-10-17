/* MIT. Permanent Node 4 launcher. Updates come only from this project's public repository. */
(function () {
    'use strict';
    var http = require('http'), https = require('https'), url = require('url'), fs = require('fs');
    var path = require('path'), crypto = require('crypto'), vm = require('vm');
    var REPO = 'Ws3r211/stremio-lite-tizenbrew';
    var FILES = ['service.js', 'app/index.html', 'app/core.js', 'app/app.js', 'app/style.css', 'app/player-icons.svg', 'app/THIRD_PARTY.txt'];
    function hash(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
    function version(v) { return /^\d+\.\d+\.\d+$/.test(v || '') ? v.split('.').map(Number) : null; }
    function newer(a, b) {
        var x = version(a), y = version(b), i; if (!x || !y) return false;
        for (i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return false;
    }
    function validate(record) {
        var d = record && record.descriptor, bundle, keys;
        if (!d || d.schema !== 1 || d.bootstrap !== 1 || !version(d.version) || d.ref !== 'v' + d.version || !/^[a-f0-9]{64}$/.test(d.sha256 || '')) throw new Error('Invalid update descriptor');
        if (typeof record.text !== 'string' || Buffer.byteLength(record.text) > 2 * 1024 * 1024 || hash(record.text) !== d.sha256) throw new Error('Update integrity check failed');
        bundle = JSON.parse(record.text); keys = Object.keys(bundle.files || {});
        if (bundle.schema !== 1 || bundle.version !== d.version || keys.length !== FILES.length) throw new Error('Incomplete update');
        FILES.forEach(function (name) {
            if (typeof bundle.files[name] !== 'string' || !bundle.files[name].length) throw new Error('Missing update file');
        });
        ['service.js', 'app/core.js', 'app/app.js'].forEach(function (name) { new vm.Script(bundle.files[name], {filename: name}); });
        return bundle;
    }
    function download(target, limit, cb) {
        var done = false, chunks = [], size = 0, parsed = url.parse(target), timer;
        function finish(err, text) { if (done) return; done = true; clearTimeout(timer); cb(err, text); }
        var req = https.get({hostname: parsed.hostname, path: parsed.path, headers: {'Accept': 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'StremioLiteAuto/1'}}, function (res) {
            if (res.statusCode !== 200) { res.resume(); return finish(new Error('Update server unavailable')); }
            res.on('data', function (chunk) { size += chunk.length; if (size > limit) { finish(new Error('Update too large')); req.abort(); } else chunks.push(chunk); });
            res.on('end', function () { if (res.complete === false) return finish(new Error('Incomplete download')); finish(null, Buffer.concat(chunks).toString('utf8')); });
            res.on('aborted', function () { if (!res.complete) finish(new Error('Interrupted download')); });
            res.on('error', function () { finish(new Error('Download failed')); });
        });
        req.on('error', function () { finish(new Error('Update network or certificate error')); });
        timer = setTimeout(function () { finish(new Error('Update check timed out')); req.abort(); }, limit < 100000 ? 8000 : 20000);
    }
    function createUpdater(options) {
        options = options || {};
        var fetch = options.download || download, cacheDir = options.cacheDir || '/home/owner/share/stremio-lite-auto';
        var token = crypto.randomBytes(24).toString('hex'), state = {current: options.bundled, previous: null, pending: null, unconfirmed: false, blocked: ''};
        var active, runtime, checking = null, checkedAt = null, notice = '', persistent = true;
        validate(state.current);
        function persist() {
            try {
                if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);
                fs.writeFileSync(path.join(cacheDir, 'state.tmp'), JSON.stringify(state), 'utf8');
                fs.renameSync(path.join(cacheDir, 'state.tmp'), path.join(cacheDir, 'state.json')); persistent = true;
            } catch (e) { persistent = false; }
        }
        try {
            var savedPath = path.join(cacheDir, 'state.json');
            if (fs.existsSync(savedPath) && fs.statSync(savedPath).size < 7 * 1024 * 1024) {
                var saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
                validate(saved.current); if (saved.previous) validate(saved.previous); if (saved.pending) validate(saved.pending);
                state = saved;
            }
        } catch (cacheError) { notice = 'Saved update was invalid; using the bundled version.'; }
        function makeRuntime(record) {
            var bundle = validate(record), sandbox = {module: {exports: {}}, __dirname: cacheDir, Buffer: Buffer, console: console,
                setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval};
            sandbox.require = function (name) {
                if (['http', 'https', 'url', 'fs', 'path', 'crypto', 'zlib'].indexOf(name) < 0) throw new Error('Unsupported runtime dependency');
                return require(name);
            };
            vm.runInNewContext(bundle.files['service.js'], sandbox, {filename: 'Stremio Lite runtime', timeout: 3000});
            if (typeof sandbox.module.exports !== 'function') throw new Error('Invalid runtime service');
            var handler = sandbox.module.exports({});
            if (!handler || typeof handler.emit !== 'function') throw new Error('Invalid runtime handler');
            return {bundle: bundle, server: handler};
        }
        function activate(record, unconfirmed) {
            var next = makeRuntime(record);
            if (state.current.descriptor.sha256 !== record.descriptor.sha256) state.previous = state.current;
            state.current = record; state.pending = null; state.unconfirmed = !!unconfirmed; active = next.bundle; runtime = next.server; persist();
        }
        if (state.unconfirmed && state.previous) {
            state.blocked = state.current.descriptor.sha256; state.current = state.previous; state.previous = null; state.pending = null; state.unconfirmed = false;
            notice = 'The last update did not finish starting. Restored the previous version.';
        }
        try { activate(state.current, false); } catch (runtimeError) { state.blocked = state.current.descriptor.sha256; activate(options.bundled, false); notice = 'Update could not start; using the bundled version.'; }
        function info() {
            return {automatic: true, installed: active.version, available: state.pending ? state.pending.descriptor.version : null,
                checkedAt: checkedAt, checking: !!checking, persistent: persistent, notice: notice, previous: state.previous ? state.previous.descriptor.version : null};
        }
        function check(cb) {
            if (checking) { checking.push(cb); return; } checking = [cb]; notice = '';
            function finish(err) {
                checkedAt = new Date().toISOString(); if (err) notice = 'Update check failed; keeping the installed version.';
                var waiters = checking; checking = null; waiters.forEach(function (fn) { fn(null, info()); });
            }
            function pointerReceived(err, text, fallback) {
                if (err && !fallback) return fetch('https://cdn.jsdelivr.net/gh/' + REPO + '@main/update.json?check=' + Date.now(), 32768, function (e, t) { pointerReceived(e, t, true); });
                if (err) return finish(err);
                var descriptor;
                try {
                    descriptor = JSON.parse(text);
                    if (descriptor.schema !== 1 || descriptor.bootstrap !== 1 || !version(descriptor.version) || descriptor.ref !== 'v' + descriptor.version || !/^[a-f0-9]{64}$/.test(descriptor.sha256 || '')) throw new Error('Invalid pointer');
                } catch (e) { return finish(e); }
                if (descriptor.sha256 === state.blocked) { notice = 'An update that failed to start was skipped.'; return finish(); }
                if (!newer(descriptor.version, active.version)) return finish();
                if (state.pending && state.pending.descriptor.sha256 === descriptor.sha256) return finish();
                fetch('https://cdn.jsdelivr.net/gh/' + REPO + '@' + descriptor.ref + '/runtime.json', 2 * 1024 * 1024, function (bundleError, bundleText) {
                    if (bundleError) return finish(bundleError);
                    var record = {descriptor: descriptor, text: bundleText};
                    try { makeRuntime(record); } catch (e) { return finish(e); }
                    state.pending = record; persist(); finish();
                });
            }
            fetch('https://raw.githubusercontent.com/' + REPO + '/main/update.json?check=' + Date.now(), 32768, pointerReceived);
        }
        function json(res, code, data) { res.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(data)); }
        var server = http.createServer(function (req, res) {
            if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '') || (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host && req.headers.origin !== 'http://127.0.0.1:8081')) return json(res, 403, {error: 'Origin not allowed'});
            if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
            res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Stremio-Auto'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            if (req.method === 'OPTIONS' && req.url.indexOf('/auto/') === 0) { res.writeHead(204); return res.end(); }
            if (req.url === '/auto/status' && req.method === 'GET') { var status = info(); status.token = token; return json(res, 200, status); }
            if (req.url.indexOf('/auto/') === 0 && req.method === 'POST') {
                if (req.headers['x-stremio-auto'] !== token) return json(res, 403, {error: 'Session token required'});
                req.resume();
                if (req.url === '/auto/ready/' + state.current.descriptor.sha256) { state.unconfirmed = false; persist(); return json(res, 200, info()); }
                if (req.url === '/auto/check') return check(function (err, data) { json(res, 200, data); });
                if (req.url === '/auto/launch') {
                    if (state.unconfirmed && state.previous) {
                        var bad = state.current.descriptor.sha256, previous = state.previous;
                        activate(previous, false); state.blocked = bad; state.pending = null; persist();
                    }
                    return check(function () {
                    if (state.pending) { try { activate(state.pending, true); } catch (e) { state.pending = null; notice = 'Update could not start; keeping the installed version.'; } }
                    var html = active.files['app/index.html'];
                    var base = '<base href="http://127.0.0.1:' + server.address().port + '/runtime/' + state.current.descriptor.sha256 + '/app/">';
                    var init = '<script>window.StremioAuto=' + JSON.stringify({token: token, version: active.version, digest: state.current.descriptor.sha256, notice: notice}) + ';<\/script>';
                    html = html.replace(/<head>/i, '<head>' + base + init);
                    // External SVG <use> cannot cross origins; keep the bundled sprite in this document.
                    html = html.replace(/player-icons\.svg#/g, '#').replace(/<body>/i, '<body>' + active.files['app/player-icons.svg'].replace('<svg ', '<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden" '));
                    return json(res, 200, {version: active.version, html: html});
                    });
                }
                return json(res, 404, {error: 'Not found'});
            }
            var match = /^\/runtime\/([a-f0-9]{64})\/app\/(index\.html|core\.js|app\.js|style\.css|player-icons\.svg|THIRD_PARTY\.txt)$/.exec(url.parse(req.url).pathname);
            if (match && req.method === 'GET') {
                var record = [state.current, state.previous].filter(function (r) { return r && r.descriptor.sha256 === match[1]; })[0];
                if (!record) return json(res, 404, {error: 'Version unavailable'});
                var file = 'app/' + match[2], data = JSON.parse(record.text).files[file], ext = path.extname(file);
                res.writeHead(200, {'Content-Type': ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.svg' ? 'image/svg+xml' : ext === '.txt' ? 'text/plain' : 'text/html', 'Cache-Control': 'no-store'}); return res.end(data);
            }
            // Preview the permanent launcher at the same loopback origin.
            if (req.method === 'GET' && req.url === '/' && options.loaderHTML) { res.writeHead(200, {'Content-Type': 'text/html', 'Cache-Control': 'no-store'}); return res.end(options.loaderHTML); }
            try { runtime.emit('request', req, res); } catch (e) { if (!res.headersSent) json(res, 500, {error: 'Runtime service failed'}); else res.end(); }
        });
        return {server: server, info: info, check: check};
    }
    module.exports = createUpdater;
}());
