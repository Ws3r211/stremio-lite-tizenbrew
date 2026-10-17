/* MIT. ES5 UI for Tizen 3 / Chromium 47. No bundled Stremio code or account password. */
(function () {
    'use strict';
    var C = window.StremioLite, view = document.getElementById('view');
    var SERVICE = 'http://127.0.0.1:17780', API = 'https://api.strem.io/api/';
    var LINK = 'https://link.stremio.com/api/v2/';
    var CINEMETA = {transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', manifest: {
        id: 'com.linvo.cinemeta', name: 'Cinemeta', types: ['movie', 'series'], resources: ['catalog', 'meta'],
        catalogs: [{id: 'top', type: 'movie', name: 'Movies', extra: [{name: 'search'}, {name: 'skip'}]}, {id: 'top', type: 'series', name: 'Series', extra: [{name: 'search'}, {name: 'skip'}]}]
    }};
    var session = null, epoch = 0, currentPage = null, previous = [], linkTimer = null;
    var playback = null, playbackEpoch = 0, cues = [], barTimer = null, subtitleTimer = null;
    function read(key, fallback) { try { return JSON.parse(localStorage.getItem('sl.' + key)) || fallback; } catch (e) { return fallback; } }
    function save(key, value) { try { localStorage.setItem('sl.' + key, JSON.stringify(value)); } catch (e) { status('TV storage is full; settings could not be saved.'); } }
    var authKey = read('auth', ''), addons = read('addons', [CINEMETA]), library = [], progress = read('progress', {});
    if (!Array.isArray(addons) || !addons.length) addons = [CINEMETA];
    function node(tag, text, className) {
        var n = document.createElement(tag);
        if (text !== null && text !== undefined) n.textContent = text;
        if (className) n.className = className;
        return n;
    }
    function button(text, action, parent) {
        var b = node('button', text); b.type = 'button'; b.onclick = action;
        if (parent) parent.appendChild(b); return b;
    }
    function status(text, error) {
        var s = document.getElementById('status'); s.textContent = text; s.className = error ? 'error' : '';
    }
    function message(text, error, parent) { var n = node('p', text, error ? 'error' : 'muted'); (parent || view).appendChild(n); return n; }
    function focusFirst(parent) { var n = (parent || view).querySelector('button:not([disabled]),input,select'); if (n) n.focus(); }
    function xhr(method, target, body, cb, text, headers) {
        var x = new XMLHttpRequest(); x.open(method, target, true); x.timeout = 30000;
        Object.keys(headers || {}).forEach(function (key) { x.setRequestHeader(key, headers[key]); });
        if (body !== null && body !== undefined) x.setRequestHeader('Content-Type', 'application/json');
        x.onload = function () {
            if (x.status < 200 || x.status >= 300) return cb(new Error('HTTP ' + x.status + '. Check the addon or network connection.'));
            if (text) return cb(null, x.responseText);
            try { var data = JSON.parse(x.responseText); } catch (e) { return cb(new Error('The server returned invalid JSON.')); }
            cb(null, data);
        };
        x.onerror = x.ontimeout = function () { cb(new Error('Network request failed. Check connectivity, certificate compatibility, or addon availability.')); };
        x.send(body === null || body === undefined ? null : JSON.stringify(body));
    }
    function request(target, body, cb, text) {
        var method = body === null ? 'GET' : 'POST';
        if (!session) return xhr(method, target, body, cb, text);
        xhr('POST', SERVICE + '/request', {url: target, method: method, body: body, format: text ? 'text' : 'json'}, function (err, response) {
            if (err) return cb(err);
            if (response.error) return cb(new Error(response.error));
            cb(null, text ? response.text : response.data);
        }, false, {'X-Stremio-Lite': session});
    }
    function account(endpoint, data, cb) {
        request(API + endpoint, data, function (err, response) {
            if (err) return cb(err);
            if (!response || response.error) return cb(new Error(response && response.error ? response.error.message : 'Unexpected account response.'));
            cb(null, response.result);
        });
    }
    function cancelLink() { if (linkTimer) clearTimeout(linkTimer); linkTimer = null; }
    function begin(title, page, remember) {
        cancelLink();
        if (remember && currentPage) previous.push(currentPage);
        currentPage = page; epoch++; view.textContent = ''; view.appendChild(node('h1', title));
        window.scrollTo(0, 0); return epoch;
    }
    function goBack() {
        if (playback) { stopPlayback(); return; }
        if (previous.length) previous.pop()();
        else { try { window.history.back(); } catch (e) { home(); } }
    }
    function nav(active) {
        var n = document.getElementById('nav'); n.textContent = '';
        [['Discover', home], ['Search', searchPage], ['Library', libraryPage], ['Settings', settings]].forEach(function (item) {
            var b = button(item[0], function () { previous = []; item[1](); }, n);
            if (item[0] === active) b.className = 'active';
        });
    }
    function cards(items, parent) {
        var grid = node('div', null, 'grid'); (parent || view).appendChild(grid);
        C.uniqueMetas(items).forEach(function (meta) {
            var b = button('', function () { details(meta); }, grid); b.className = 'card';
            if (/^https?:\/\//i.test(meta.poster || '')) {
                var img = document.createElement('img'); img.src = meta.poster; img.alt = ''; b.appendChild(img);
                img.onerror = function () { this.style.display = 'none'; };
            } else b.appendChild(node('div', meta.name.charAt(0), 'poster-fallback'));
            b.appendChild(node('span', meta.name, 'name'));
            b.appendChild(node('span', meta.releaseInfo || meta.year || meta.type, 'year'));
        });
        if (!grid.children.length) message('No titles returned.', false, parent);
    }
    function home() {
        nav('Discover'); var mine = begin('Discover', home), choices = C.catalogs(addons, false);
        var toolbar = node('div', null, 'toolbar'), select = document.createElement('select');
        select.setAttribute('aria-label', 'Catalog'); toolbar.appendChild(select); view.appendChild(toolbar);
        choices.forEach(function (choice, i) {
            var c = choice.catalog, o = node('option', choice.addon.manifest.name + ' · ' + (c.name || c.id) + ' · ' + c.type);
            o.value = String(i); select.appendChild(o);
        });
        var results = node('div'); view.appendChild(results);
        var skip = 0, fetched = [], more;
        function load(append) {
            if (!choices.length) return message('No browseable catalogs. Add an addon in Settings.', false, results);
            var choice = choices[Number(select.value) || 0], c = choice.catalog;
            if (!append) { skip = 0; fetched = []; results.textContent = ''; }
            if (more) more.disabled = true;
            status('Loading catalog…');
            request(C.resourceURL(choice.addon, 'catalog', c.type, c.id, skip ? {skip: skip} : {}), null, function (err, data) {
                if (epoch !== mine) return;
                if (err) { status(err.message, true); if (more) more.disabled = false; return; }
                var metas = data.metas || []; fetched = fetched.concat(metas); skip += metas.length;
                results.textContent = ''; cards(fetched, results);
                more = null;
                if (metas.length && C.catalogExtra(c, 'skip')) more = button('Load more', function () { load(true); }, results);
                status(fetched.length + ' titles · ' + (session ? 'TV service connected' : 'Direct network mode'));
                if (!append) focusFirst(results);
            });
        }
        select.onchange = function () { mine = ++epoch; load(false); };
        load(false);
    }
    function searchPage() {
        nav('Search'); var mine = begin('Search', searchPage), form = node('form', null, 'toolbar');
        var input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Movie or series title'; input.setAttribute('aria-label', 'Search titles');
        form.appendChild(input); var submit = node('button', 'Search'); submit.type = 'submit'; form.appendChild(submit); view.appendChild(form);
        var results = node('div'); view.appendChild(results);
        form.onsubmit = function (event) {
            event.preventDefault(); var query = input.value.replace(/^\s+|\s+$/g, ''); if (!query) return;
            mine = ++epoch; results.textContent = ''; var choices = C.catalogs(addons, true), pending = choices.length, found = [], failures = 0;
            if (!pending) return message('Your addons do not provide a searchable catalog.', true, results);
            status('Searching…'); submit.disabled = true;
            choices.forEach(function (choice) {
                request(C.resourceURL(choice.addon, 'catalog', choice.catalog.type, choice.catalog.id, {search: query}), null, function (err, data) {
                    if (epoch !== mine) return;
                    if (err) failures++; else found = found.concat(data.metas || []);
                    if (--pending) return;
                    submit.disabled = false; cards(found, results); focusFirst(results);
                    status(C.uniqueMetas(found).length + ' results' + (failures ? ' · ' + failures + ' catalog requests failed' : ''));
                });
            });
        };
        input.focus();
    }
    function details(meta) {
        function render() {
            var mine = begin(meta.name, render, false), box = node('div', null, 'detail');
            if (/^https?:\/\//i.test(meta.poster || '')) { var img = document.createElement('img'); img.src = meta.poster; img.alt = ''; box.appendChild(img); }
            var text = node('div'); box.appendChild(text); view.appendChild(box);
            message(meta.description || 'Loading details…', false, text);
            var actions = node('div', null, 'panel'); view.appendChild(actions);
            button('Back', goBack, actions);
            function content(item) {
                if (epoch !== mine) return; text.textContent = ''; message(item.description || 'No description provided.', false, text);
                message([item.releaseInfo, item.runtime, (item.genres || []).join(', ')].filter(Boolean).join(' · '), false, text);
                while (actions.children.length > 1) actions.removeChild(actions.lastChild);
                if (item.type === 'series' || item.type === 'tv') {
                    var videos = C.sortVideos(item.videos), seasons = [];
                    videos.forEach(function (v) { if (seasons.indexOf(v.season || 0) < 0) seasons.push(v.season || 0); });
                    if (!videos.length) message('This addon returned no episodes.', false, actions);
                    var season = document.createElement('select'); season.setAttribute('aria-label', 'Season');
                    seasons.forEach(function (s) { var o = node('option', 'Season ' + s); o.value = s; season.appendChild(o); });
                    actions.appendChild(season); var list = node('div', null, 'list'); actions.appendChild(list);
                    function episodes() {
                        list.textContent = '';
                        videos.filter(function (v) { return Number(v.season || 0) === Number(season.value); }).forEach(function (v) {
                            button((v.episode !== undefined ? v.episode + '. ' : '') + (v.title || v.name || v.id), function () { streams(item, v.id, v.title || v.name || item.name); }, list);
                        });
                    }
                    season.onchange = episodes; episodes();
                } else button('Find streams', function () { streams(item, item.id, item.name); }, actions);
                focusFirst(actions); status('Select an episode or find streams.');
            }
            var providers = addons.filter(function (a) { return C.supports(a, 'meta', meta.type, meta.id); }), i = 0;
            function next() {
                if (epoch !== mine) return;
                if (i >= providers.length) return content(meta);
                request(C.resourceURL(providers[i++], 'meta', meta.type, meta.id), null, function (err, data) {
                    if (err || !data.meta) return next(); content(data.meta);
                });
            }
            next();
        }
        if (currentPage) previous.push(currentPage); render();
    }
    function streams(meta, id, title) {
        function render() {
            var mine = begin(title + ' — streams', render), list = node('div', null, 'list');
            button('Back', goBack, view); view.appendChild(list);
            var providers = addons.filter(function (a) { return C.supports(a, 'stream', meta.type, id); }), pending = providers.length, total = 0, failures = 0;
            if (!pending) { status('No stream addons installed.'); return message('Sign in to import your Stremio addons, or add a manifest URL in Settings. Cinemeta supplies metadata, not video sources.'); }
            status('Finding streams…');
            providers.forEach(function (addon) {
                request(C.resourceURL(addon, 'stream', meta.type, id), null, function (err, data) {
                    if (epoch !== mine) return;
                    if (err) failures++;
                    else (data.streams || []).forEach(function (stream) {
                        total++; var can = C.playable(stream);
                        var b = button((stream.name || addon.manifest.name) + '\n' + (stream.description || stream.title || 'Video stream'), function () {
                            if (!can.ok) return status(can.reason, true);
                            play(stream, meta, id, title);
                        }, list);
                        b.appendChild(node('small', can.ok ? 'HTTP video · codec support depends on your TV' : can.reason));
                    });
                    if (--pending) return;
                    status(total + ' sources' + (failures ? ' · ' + failures + ' addons failed' : ''));
                    if (!total) message('No streams returned by your installed addons.', false, list);
                    focusFirst(list);
                });
            });
        }
        if (currentPage) previous.push(currentPage); render();
    }
    function loadLibrary(cb) {
        account('datastoreGet', {authKey: authKey, collection: 'libraryItem', all: true, ids: []}, function (err, items) {
            if (!err) library = (Array.isArray(items) ? items : []).filter(function (x) { return !x.removed && !x.temp; }).map(function (x) {
                x.id = x._id || x.id; return x;
            });
            cb(err);
        });
    }
    function libraryPage() {
        nav('Library'); var mine = begin('Your Stremio library', libraryPage);
        if (!authKey) { message('Sign in from Settings to load your library.'); button('Open settings', settings, view); focusFirst(); return; }
        status('Loading library…');
        loadLibrary(function (err) {
            if (epoch !== mine) return;
            if (err) return status(err.message, true);
            cards(library); focusFirst(); status(library.length + ' library titles · watch progress is saved locally on this TV');
        });
    }
    function syncAddons(cb) {
        account('addonCollectionGet', {type: 'AddonCollectionGet', authKey: authKey, update: true}, function (err, data) {
            if (err) return cb(err);
            var list = data && data.addons;
            if (!Array.isArray(list)) return cb(new Error('The account did not return an addon collection.'));
            addons = list.filter(function (a) { return a.manifest && /^https?:\/\//i.test(a.transportUrl); });
            if (!addons.some(function (a) { return a.manifest.id === CINEMETA.manifest.id; })) addons.unshift(CINEMETA);
            save('addons', addons); cb(null);
        });
    }
    function linkAccount(parent, mine) {
        var box = node('div', null, 'panel'); parent.appendChild(box); message('Requesting sign-in code…', false, box);
        request(LINK + 'create?type=Create', null, function (err, response) {
            if (epoch !== mine) return;
            if (err || !response || response.error || !response.result || !response.result.code) { box.textContent = ''; return message(err ? err.message : 'Could not create a sign-in link.', true, box); }
            var result = response.result, attempts = 0; box.textContent = '';
            message('Open this Stremio link on your phone or computer and approve this TV:', false, box);
            box.appendChild(node('p', result.link, 'account-link')); box.appendChild(node('div', result.code, 'code'));
            message('Waiting for approval. Your password is entered only on Stremio’s website.', false, box);
            function poll() {
                if (epoch !== mine) return;
                request(LINK + 'read?type=Read&code=' + encodeURIComponent(result.code), null, function (err2, data) {
                    if (epoch !== mine) return;
                    if (data && data.result && data.result.authKey) {
                        authKey = data.result.authKey; save('auth', authKey);
                        syncAddons(function (syncError) { if (epoch !== mine) return; settings(); status(syncError ? syncError.message : 'Signed in; addons imported.', !!syncError); });
                        return;
                    }
                    if (++attempts >= 120) { box.textContent = ''; message('Sign-in timed out. Request a new code.', true, box); return; }
                    linkTimer = setTimeout(poll, 3000);
                });
            }
            linkTimer = setTimeout(poll, 2000);
        });
    }
    function settings() {
        nav('Settings'); var mine = begin('Settings', settings), accountBox = node('div', null, 'panel'); view.appendChild(accountBox);
        accountBox.appendChild(node('h2', 'Stremio account'));
        message(authKey ? 'Signed in. Imported addons and library are read from your account.' : 'Sign in on your phone to import your existing addons and library.', false, accountBox);
        if (authKey) {
            button('Refresh account addons', function () { status('Importing addons…'); syncAddons(function (err) { if (epoch !== mine) return; settings(); status(err ? err.message : 'Addons refreshed.', !!err); }); }, accountBox);
            button('Sign out and clear imported addons', function () { authKey = ''; addons = [CINEMETA]; library = []; save('auth', ''); save('addons', addons); settings(); }, accountBox);
        } else button('Sign in with Stremio', function () { this.disabled = true; linkAccount(accountBox, mine); }, accountBox);
        message('The account session and configured addon URLs are stored on this TV. Sign out removes them. Watch progress stays local; this client does not write to your Stremio account.', false, accountBox);
        var addonBox = node('div', null, 'panel'); view.appendChild(addonBox); addonBox.appendChild(node('h2', 'Content addons'));
        addons.forEach(function (a, i) {
            var row = node('div', null, 'toolbar'); row.appendChild(node('span', a.manifest.name || 'Addon'));
            button('Remove', function () { addons.splice(i, 1); save('addons', addons); settings(); }, row); addonBox.appendChild(row);
        });
        var form = node('form'), label = node('label', 'Addon manifest URL'), field = document.createElement('input');
        field.type = 'text'; field.className = 'wide'; field.placeholder = 'https://your-addon/manifest.json'; field.id = 'addon-url'; label.htmlFor = field.id;
        form.appendChild(label); form.appendChild(field); var add = node('button', 'Add addon'); add.type = 'submit'; form.appendChild(add); addonBox.appendChild(form);
        form.onsubmit = function (e) {
            e.preventDefault(); var target;
            try { target = C.manifestURL(field.value); } catch (err) { return status(err.message, true); }
            status('Checking addon…'); add.disabled = true;
            request(target, null, function (err, manifest) {
                if (epoch !== mine) return; add.disabled = false;
                if (err) return status(err.message, true);
                if (!manifest || !manifest.id || !manifest.name || !Array.isArray(manifest.resources)) return status('This URL did not return a Stremio addon manifest.', true);
                var found = addons.some(function (a) { return a.transportUrl === target; });
                if (!found) addons.push({transportUrl: target, manifest: manifest}); save('addons', addons); settings(); status('Addon ready.');
            });
        };
        var testBox = node('div', null, 'panel'); view.appendChild(testBox); testBox.appendChild(node('h2', 'Playback check'));
        message('Test your player with Blender’s Big Buck Bunny MP4 before testing your own streams.', false, testBox);
        button('Play test video', function () {
            play({url: 'https://media.w3.org/2010/05/bunny/trailer.mp4'}, {type: 'movie', id: 'blender-bbb', name: 'Big Buck Bunny'}, 'blender-bbb', 'Big Buck Bunny · playback test');
        }, testBox);
        message('Player: ' + (nativePlayer() ? 'Samsung AVPlay available' : 'HTML5 fallback; Samsung AVPlay unavailable') + ' · Network: ' + (session ? 'local TizenBrew service connected' : 'direct requests; local service unavailable'), false, testBox);
        focusFirst(); status('Stremio Lite 0.1.0 · unofficial client for older TVs');
    }
    function nativePlayer() { return window.webapis && window.webapis.avplay; }
    function formatTime(seconds) {
        seconds = Math.max(0, Math.floor(seconds || 0)); var h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function playbackStatus(text) { document.getElementById('playback-status').textContent = text; }
    function updateTime(seconds, duration) {
        if (!playback) return;
        playback.seconds = seconds; playback.duration = duration;
        document.getElementById('time').textContent = formatTime(seconds) + ' / ' + formatTime(duration);
        if (seconds - playback.lastSaved > 10) { storeProgress(); playback.lastSaved = seconds; }
        if (cues.length) {
            var text = '', i;
            for (i = 0; i < cues.length; i++) if (seconds >= cues[i].start && seconds < cues[i].end) { text = cues[i].text; break; }
            document.getElementById('subtitle').textContent = text;
        }
    }
    function storeProgress() {
        if (!playback) return;
        progress[playback.id] = {seconds: playback.seconds || 0, duration: playback.duration || 0, date: Date.now()};
        var keys = Object.keys(progress).sort(function (a, b) { return progress[b].date - progress[a].date; });
        keys.slice(100).forEach(function (key) { delete progress[key]; }); save('progress', progress);
    }
    function showBar() {
        document.getElementById('player-bar').className = ''; if (barTimer) clearTimeout(barTimer);
        barTimer = setTimeout(function () { if (playback && !playback.paused) document.getElementById('player-bar').className = 'hidden'; }, 6000);
    }
    function play(stream, meta, id, title) {
        var can = C.playable(stream); if (!can.ok) return status(can.reason, true);
        if (playback) stopPlayback(); var generation = ++playbackEpoch, av = nativePlayer(), video = document.getElementById('video');
        playback = {id: id, meta: meta, stream: stream, seconds: 0, duration: 0, lastSaved: 0, native: !!av, paused: false, preparing: true};
        document.body.className = 'playing'; document.getElementById('player').className = '';
        document.getElementById('playing-title').textContent = title; document.getElementById('track-menu').className = 'hidden';
        document.getElementById('time').textContent = ''; document.getElementById('subtitle').textContent = ''; cues = [];
        playbackStatus('Preparing video…'); showBar(); document.getElementById('pause').focus();
        var resume = progress[id], resumeAt = resume && resume.seconds > 10 && resume.seconds < resume.duration - 20 ? resume.seconds : 0;
        function active() { return playback && generation === playbackEpoch; }
        function failed() { if (!active()) return; showBar(); playbackStatus('Playback failed. Try another source or codec. Return stops the player.'); }
        if (av) {
            video.className = 'hidden'; document.getElementById('av-player').className = '';
            try {
                av.open(can.url); av.setDisplayRect(0, 0, 1920, 1080);
                av.setListener({onbufferingstart: function () { if (active()) playbackStatus('Buffering…'); },
                    onbufferingprogress: function (p) { if (active()) playbackStatus('Buffering ' + p + '%'); },
                    onbufferingcomplete: function () { if (active()) playbackStatus('Playing'); },
                    oncurrentplaytime: function (ms) { if (active()) updateTime(ms / 1000, av.getDuration() / 1000); },
                    onstreamcompleted: function () { if (active()) stopPlayback(); }, onerror: failed,
                    onsubtitlechange: function (duration, text) {
                        if (!active() || cues.length) return;
                        var stripped = String(text || '').replace(/<[^>]*>/g, ''); document.getElementById('subtitle').textContent = stripped;
                        clearTimeout(subtitleTimer); subtitleTimer = setTimeout(function () { if (active()) document.getElementById('subtitle').textContent = ''; }, Number(duration) || 3000);
                    }});
                av.prepareAsync(function () {
                    if (!active()) return; playback.preparing = false;
                    if (resumeAt) { try { av.seekTo(resumeAt * 1000); } catch (e) {} }
                    av.play(); playbackStatus('Playing · Samsung AVPlay');
                }, failed);
            } catch (e) { failed(); }
        } else {
            video.className = ''; document.getElementById('av-player').className = 'hidden';
            video.onerror = failed; video.onended = function () { if (active()) stopPlayback(); };
            video.ontimeupdate = function () { if (active()) updateTime(video.currentTime, video.duration); };
            video.onloadedmetadata = function () { if (active() && resumeAt) { try { video.currentTime = resumeAt; } catch (e) {} } };
            video.onplaying = function () { if (active()) { playback.preparing = false; playbackStatus('Playing · HTML5'); } };
            video.src = can.url;
            var promise = video.play(); if (promise && promise.catch) promise.catch(failed);
        }
    }
    function stopPlayback() {
        if (!playback) return; storeProgress(); var wasNative = playback.native; playback = null; ++playbackEpoch;
        if (barTimer) clearTimeout(barTimer); if (subtitleTimer) clearTimeout(subtitleTimer);
        if (wasNative) { try { nativePlayer().stop(); } catch (e) {} try { nativePlayer().close(); } catch (e) {} }
        var video = document.getElementById('video'); video.onended = video.onerror = video.onplaying = video.ontimeupdate = video.onloadedmetadata = null;
        video.pause(); video.removeAttribute('src'); video.load(); cues = [];
        document.getElementById('player').className = 'hidden'; document.body.className = '';
        document.getElementById('subtitle').textContent = ''; focusFirst();
    }
    function togglePause(force) {
        if (!playback || playback.preparing) return; var paused = force === undefined ? !playback.paused : force;
        try { if (playback.native) nativePlayer()[paused ? 'pause' : 'play']();
            else if (paused) document.getElementById('video').pause(); else document.getElementById('video').play();
            playback.paused = paused; playbackStatus(paused ? 'Paused' : 'Playing'); showBar();
        } catch (e) { playbackStatus('Player is not ready.'); }
    }
    function seek(delta) {
        if (!playback || playback.preparing) return;
        var target = Math.max(0, Math.min((playback.duration || Infinity) - 1, playback.seconds + delta));
        try { if (playback.native) nativePlayer().seekTo(target * 1000); else document.getElementById('video').currentTime = target; showBar(); } catch (e) { playbackStatus('Seeking unavailable for this stream.'); }
    }
    function trackMenu() {
        if (!playback) return; var mine = playbackEpoch, menu = document.getElementById('track-menu'); menu.textContent = ''; menu.className = '';
        menu.appendChild(node('h2', 'Subtitles and audio'));
        button('Close', function () { menu.className = 'hidden'; document.getElementById('tracks').focus(); }, menu);
        button('Subtitles off', function () { cues = []; document.getElementById('subtitle').textContent = ''; if (playback.native) { try { nativePlayer().setSilentSubtitle(true); } catch (e) {} } menu.className = 'hidden'; }, menu);
        if (playback.native) {
            try { nativePlayer().getTotalTrackInfo().forEach(function (track) {
                if (track.type !== 'AUDIO' && track.type !== 'TEXT') return;
                button(track.type + ' ' + track.index, function () {
                    try { cues = []; nativePlayer().setSilentSubtitle(false); nativePlayer().setSelectTrack(track.type, track.index); menu.className = 'hidden'; }
                    catch (e) { playbackStatus('This track cannot be selected.'); }
                }, menu);
            }); } catch (e) { message('Embedded tracks unavailable while preparing.', false, menu); }
        }
        var pending = addons.filter(function (a) { return C.supports(a, 'subtitles', playback.meta.type, playback.id); });
        function subtitleButton(sub) {
            if (!/^https?:\/\//i.test(sub.url || '')) return;
            button('External subtitles · ' + (sub.lang || sub.id || 'unknown language'), function () {
                playbackStatus('Loading subtitles…');
                request(sub.url, null, function (err, text) {
                    if (!playback || playbackEpoch !== mine) return;
                    if (err) return playbackStatus(err.message);
                    var parsed = C.subtitleCues(text); if (!parsed.length) return playbackStatus('Subtitle format unsupported. Use SRT or WebVTT.');
                    cues = parsed; if (playback.native) { try { nativePlayer().setSilentSubtitle(true); } catch (e) {} }
                    menu.className = 'hidden'; playbackStatus('External subtitles enabled.');
                }, true);
            }, menu);
        }
        (playback.stream.subtitles || []).forEach(subtitleButton);
        pending.forEach(function (a) {
            var hints = playback.stream.behaviorHints || {}, extra = {};
            ['videoHash', 'videoSize', 'filename'].forEach(function (key) { if (hints[key]) extra[key] = hints[key]; });
            request(C.resourceURL(a, 'subtitles', playback.meta.type, playback.id, extra), null, function (err, data) {
                if (!playback || playbackEpoch !== mine || err) return;
                (data.subtitles || []).slice(0, 40).forEach(subtitleButton);
            });
        });
        focusFirst(menu); showBar();
    }
    function moveFocus(code, scope) {
        var all = Array.prototype.slice.call(scope.querySelectorAll('button:not([disabled]),input,select'));
        var active = document.activeElement, from = active && active.getBoundingClientRect(), best = null, score = Infinity;
        if (!from || !scope.contains(active)) return focusFirst(scope);
        var x = from.left + from.width / 2, y = from.top + from.height / 2;
        all.forEach(function (el) {
            if (el === active || !el.offsetWidth || !el.offsetHeight) return;
            var r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y;
            if ((code === 37 && dx >= -5) || (code === 39 && dx <= 5) || (code === 38 && dy >= -5) || (code === 40 && dy <= 5)) return;
            var primary = code === 37 || code === 39 ? Math.abs(dx) : Math.abs(dy);
            var secondary = code === 37 || code === 39 ? Math.abs(dy) : Math.abs(dx);
            var value = primary + secondary * 3;
            if (value < score) { score = value; best = el; }
        });
        if (!best && active.tagName === 'INPUT' && code === 40 && active.form) best = active.form.querySelector('button[type="submit"]');
        if (best) {
            best.focus();
            if (!playback) {
                var focusedRect = best.getBoundingClientRect();
                if (focusedRect.bottom > window.innerHeight - 90) window.scrollBy(0, focusedRect.bottom - window.innerHeight + 90);
                else if (focusedRect.top < 20) window.scrollBy(0, focusedRect.top - 20);
            }
        }
    }
    document.getElementById('pause').onclick = function () { togglePause(); };
    document.getElementById('stop').onclick = stopPlayback;
    document.getElementById('rewind').onclick = function () { seek(-30); };
    document.getElementById('forward').onclick = function () { seek(30); };
    document.getElementById('tracks').onclick = trackMenu;
    document.addEventListener('keydown', function (e) {
        var code = e.keyCode, tag = document.activeElement && document.activeElement.tagName;
        if (code === 10009 || code === 27 || (code === 8 && tag !== 'INPUT')) {
            e.preventDefault(); if (playback && document.getElementById('track-menu').className !== 'hidden') { document.getElementById('track-menu').className = 'hidden'; document.getElementById('tracks').focus(); }
            else goBack(); return;
        }
        if (playback) {
            showBar();
            if ([10252, 415, 19, 413, 417, 412].indexOf(code) >= 0) {
                e.preventDefault();
                if (code === 413) stopPlayback(); else if (code === 417) seek(30); else if (code === 412) seek(-30); else togglePause(code === 415 ? false : code === 19 ? true : undefined);
                return;
            }
        }
        if (code >= 37 && code <= 40 && !(tag === 'INPUT' && (code === 37 || code === 39)) && !(tag === 'SELECT' && (code === 38 || code === 40))) {
            e.preventDefault(); var menu = document.getElementById('track-menu');
            moveFocus(code, playback ? (menu.className === 'hidden' ? document.getElementById('player-controls') : menu) : document.getElementById('shell'));
        }
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden && playback) togglePause(true); });
    window.addEventListener('beforeunload', function () { if (playback) storeProgress(); cancelLink(); });
    try { ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward'].forEach(function (key) { tizen.tvinputdevice.registerKey(key); }); } catch (e) {}
    function start(attempt) {
        xhr('GET', SERVICE + '/health', null, function (err, data) {
            if (!err && data && data.token) session = data.token;
            else if (attempt < 3) return setTimeout(function () { start(attempt + 1); }, 600);
            home();
        });
    }
    start(0);
}());
