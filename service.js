/* MIT. Standalone TizenBrew service, compatible with the TV's Node 4 runtime. */
(function () {
    'use strict';
    var http = require('http'), https = require('https'), url = require('url');
    var fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
    function createServer(options) {
        options = options || {};
        var token = crypto.randomBytes(24).toString('hex');
        var port = options.port || 17780, upstream = options.upstream;
        function json(res, code, value) {
            res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
            res.end(JSON.stringify(value));
        }
        function originAllowed(origin, host) {
            return !origin || origin === 'http://' + host || origin === 'http://127.0.0.1:8081';
        }
        function requestRemote(target, method, body, done, redirects) {
            var callback = done, completed = false;
            done = function (err, text) { if (!completed) { completed = true; callback(err, text); } };
            redirects = redirects || 0;
            var parsed;
            try { parsed = url.parse(target); } catch (e) { return done(new Error('Invalid URL')); }
            if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname || parsed.auth) return done(new Error('Only HTTP(S) URLs without embedded credentials are supported.'));
            if (method !== 'GET' && !(method === 'POST' && parsed.protocol === 'https:' && parsed.hostname === 'api.strem.io' && /^\/api\/(addonCollectionGet|datastoreGet)$/.test(parsed.pathname))) return done(new Error('Unsupported request method or API endpoint.'));
            var headers = {'Accept': 'application/json, text/plain', 'Accept-Encoding': 'gzip, deflate', 'User-Agent': 'StremioLiteTizen/3.1.1'};
            if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
            var request = (parsed.protocol === 'https:' ? https : http).request({hostname: parsed.hostname, port: parsed.port,
                path: parsed.path, method: method, headers: headers}, function (response) {
                if ([301, 302, 303, 307, 308].indexOf(response.statusCode) >= 0 && response.headers.location) {
                    response.resume();
                    if (redirects >= 4) return done(new Error('Too many redirects'));
                    if (method !== 'GET') return done(new Error('Account API redirects are rejected.'));
                    return requestRemote(url.resolve(target, response.headers.location), method, null, done, redirects + 1);
                }
                var source = response;
                if (response.headers['content-encoding'] === 'gzip') source = response.pipe(zlib.createGunzip());
                else if (response.headers['content-encoding'] === 'deflate') source = response.pipe(zlib.createInflate());
                var chunks = [], length = 0, finished = false;
                function fail(e) { if (!finished) { finished = true; done(e); } }
                source.on('data', function (chunk) {
                    length += chunk.length;
                    if (length > 8 * 1024 * 1024) { request.abort(); fail(new Error('Response exceeds 8 MB')); return; }
                    chunks.push(chunk);
                });
                source.on('error', function () { fail(new Error('Could not decode the addon response.')); });
                response.on('error', function () { fail(new Error('Upstream connection interrupted')); });
                // Node 4 can emit aborted with complete=true on a normal Connection: close.
                // Gunzip may still be draining then; only reject an incomplete HTTP message.
                response.on('aborted', function () { if (!response.complete) fail(new Error('Upstream connection interrupted')); });
                source.on('end', function () {
                    if (finished) return; finished = true;
                    if (response.statusCode < 200 || response.statusCode >= 300) return done(new Error('Upstream HTTP ' + response.statusCode));
                    done(null, Buffer.concat(chunks).toString('utf8'));
                });
            });
            request.setTimeout(25000, function () { done(new Error('Addon request timed out.')); request.abort(); });
            request.on('error', function (e) {
                var code = /^[A-Z][A-Z0-9_]{1,60}$/.test(e.code || '') ? ' (' + e.code + ')' : '';
                done(new Error('Network or certificate request failed' + code + '.'));
            });
            if (body) request.write(body);
            request.end();
        }
        return http.createServer(function (req, res) {
            var expectedHost = /^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '');
            if (!expectedHost || !originAllowed(req.headers.origin, req.headers.host)) return json(res, 403, {error: 'Origin not allowed'});
            if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Stremio-Lite');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
            if (req.url === '/health' && req.method === 'GET') return json(res, 200, {name: 'Stremio Lite', version: '3.1.1', token: token});
            if (req.url === '/request' && req.method === 'POST') {
                if (req.headers['x-stremio-lite'] !== token) return json(res, 403, {error: 'Session token required'});
                var chunks = [], length = 0, tooLarge = false;
                req.on('data', function (chunk) {
                    length += chunk.length;
                    if (length > 256 * 1024) { if (!tooLarge) json(res, 413, {error: 'Request too large'}); tooLarge = true; return; }
                    if (!tooLarge) chunks.push(chunk);
                });
                req.on('end', function () {
                    if (tooLarge) return;
                    var data;
                    try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch (e) { return json(res, 400, {error: 'Invalid JSON request'}); }
                    var method = data.method || 'GET', finished = false;
                    (upstream || requestRemote)(data.url, method, data.body ? JSON.stringify(data.body) : null, function (err, text) {
                        if (finished || res.finished) return; finished = true;
                        if (err) return json(res, 502, {error: err.message});
                        if (data.format === 'text') return json(res, 200, {text: text});
                        try { json(res, 200, {data: JSON.parse(text)}); } catch (e) { json(res, 502, {error: 'Addon returned an invalid JSON response.'}); }
                    });
                });
                return;
            }
            if (options.staticDir && req.method === 'GET') {
                var pathname;
                try { pathname = decodeURIComponent(url.parse(req.url).pathname); } catch (e) { return json(res, 400, {error: 'Invalid path'}); }
                var files = {'/': 'index.html', '/index.html': 'index.html', '/core.js': 'core.js', '/app.js': 'app.js', '/style.css': 'style.css', '/player-icons.svg': 'player-icons.svg'};
                if (!files[pathname]) return json(res, 404, {error: 'Not found'});
                fs.readFile(path.join(options.staticDir, files[pathname]), function (err, content) {
                    if (err) return json(res, 404, {error: 'Not found'});
                    var ext = path.extname(files[pathname]);
                    res.writeHead(200, {'Content-Type': ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.svg' ? 'image/svg+xml' : 'text/html', 'Cache-Control': 'no-store'});
                    res.end(content);
                });
                return;
            }
            json(res, 404, {error: 'Not found'});
        });
    }
    module.exports = createServer;
    if (typeof __dirname === 'undefined' || require.main === module) {
        var options = typeof __dirname === 'undefined' ? {} : {staticDir: path.join(__dirname, 'app')};
        var server = createServer(options);
        server.on('error', function (e) { console.error('Stremio Lite service: ' + e.code); });
        server.listen(17780, '127.0.0.1', function () { console.log('Stremio Lite ready at http://127.0.0.1:17780'); });
    }
}());
