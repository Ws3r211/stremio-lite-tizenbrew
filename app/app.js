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
    var session = null, serviceVersion = '', epoch = 0, currentPage = null, previous = [], linkTimer = null;
    var playback = null, playbackEpoch = 0, cues = [], barTimer = null, subtitleTimer = null;
    var catalogCache = {}, heroCache = {}, discoverState = {type: 'all', row: 0, card: 0}, discoverTick = null;
    var homeScroll = null, heroTimer = null;
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
            if (x.status < 200 || x.status >= 300) {
                var detail = '', err;
                if (target === SERVICE + '/request') {
                    try { detail = JSON.parse(x.responseText).error || ''; } catch (ignored) {}
                }
                err = new Error('HTTP ' + x.status + (typeof detail === 'string' && detail ? ': ' + detail : '. The provider could not complete this request.'));
                err.status = x.status; return cb(err);
            }
            if (text) return cb(null, x.responseText);
            try { var data = JSON.parse(x.responseText); } catch (e) { return cb(new Error('The server returned invalid JSON.')); }
            cb(null, data);
        };
        x.onerror = x.ontimeout = function () { var err = new Error('Network request failed. Check connectivity, certificate compatibility, or addon availability.'); err.status = 0; cb(err); };
        x.send(body === null || body === undefined ? null : JSON.stringify(body));
    }
    function request(target, body, cb, text) {
        var method = body === null ? 'GET' : 'POST';
        if (!session) return xhr(method, target, body, cb, text);
        xhr('POST', SERVICE + '/request', {url: target, method: method, body: body, format: text ? 'text' : 'json'}, function (err, response) {
            if (err) {
                // Addon GETs can use the browser's network stack when the old service fails.
                // Account POSTs are never replayed through this fallback.
                if (method === 'GET' && (err.status === 502 || err.status === 0)) {
                    return xhr('GET', target, null, function (directError, data) {
                        if (directError) return cb(new Error(err.message + ' Browser fallback: ' + directError.message));
                        cb(null, data);
                    }, text);
                }
                return cb(err);
            }
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
        homeScroll = null; clearTimeout(discoverTick); clearTimeout(heroTimer);
        if (remember && currentPage) previous.push(currentPage);
        currentPage = page; epoch++; view.textContent = ''; view.appendChild(node('h1', title));
        view.className = ''; document.body.className = ''; document.getElementById('status').className = '';
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
            if (item[0] === active) { b.className = 'active'; b.setAttribute('aria-current', 'page'); }
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
    function home(restore) {
        nav('Discover'); var mine = begin('Discover', function () { home(true); }), choices = C.catalogs(addons, false);
        view.textContent = ''; view.className = 'discover-view'; document.body.className = 'discover';
        // Keep account order within each group, while making custom catalogs immediately visible.
        choices = choices.filter(function (x) { return x.addon.manifest.id !== CINEMETA.manifest.id; }).concat(
            choices.filter(function (x) { return x.addon.manifest.id === CINEMETA.manifest.id; }));
        if (discoverState.type !== 'all') choices = choices.filter(function (x) { return x.catalog.type === discoverState.type; });
        var backdrop = document.createElement('img'); backdrop.className = 'discover-backdrop'; backdrop.alt = ''; view.appendChild(backdrop);
        backdrop.onerror = function () { backdrop.removeAttribute('src'); };
        var hero = node('section', null, 'discover-hero'); hero.setAttribute('aria-label', 'Featured title'); view.appendChild(hero);
        hero.appendChild(node('p', 'Discover', 'eyebrow'));
        hero.appendChild(node('h1', 'Find your next great story.', 'discover-heading'));
        hero.appendChild(node('p', 'All your catalogs. One place.', 'discover-tagline'));
        var feature = node('div', null, 'feature-copy'), featureTitle = node('h2', 'Your next story awaits', 'feature-title'); hero.appendChild(feature);
        feature.appendChild(featureTitle); var featureMeta = node('p', '', 'feature-meta'); feature.appendChild(featureMeta);
        var featureDescription = node('p', 'Browse your installed catalogs below.', 'feature-description'); feature.appendChild(featureDescription);
        var selected = null, selectedKey = '', heroSerial = 0;
        var detailButton = button('View details', function () { if (selected) details(selected); }, feature); detailButton.className = 'primary'; detailButton.disabled = true;
        var filters = node('div', null, 'discover-filters'); filters.setAttribute('aria-label', 'Content type');
        [['all', 'All'], ['movie', 'Movies'], ['series', 'Series']].forEach(function (entry) {
            var b = button(entry[1], function () { discoverState.type = entry[0]; discoverState.row = 0; discoverState.card = 0; home(); }, filters);
            b.className = discoverState.type === entry[0] ? 'selected' : ''; b.setAttribute('aria-pressed', String(discoverState.type === entry[0]));
        });
        view.appendChild(filters);
        var shelves = node('div', null, 'catalog-shelves'); view.appendChild(shelves);
        var rows = [], running = 0, queue = [], restored = false, firstFocused = false;
        function paintHero(meta, serial) {
            if (epoch !== mine || serial !== heroSerial) return;
            selected = meta; featureTitle.textContent = meta.name; featureTitle.className = 'feature-title' + (meta.name.length > 20 ? ' long-title' : '');
            featureMeta.textContent = [meta.releaseInfo || meta.year, meta.type === 'series' ? 'Series' : 'Movie', (meta.genres || []).slice(0, 2).join(' / ')].filter(Boolean).join(' · ');
            featureDescription.textContent = meta.description || 'Explore this title and find sources from your installed addons.';
            detailButton.disabled = false;
            var image = meta.background || '';
            if (/^https?:\/\//i.test(image)) { if (backdrop.getAttribute('src') !== image) backdrop.src = image; }
            else backdrop.removeAttribute('src');
        }
        function selectHero(meta, choice) {
            var key = choice.addon.transportUrl + '|' + meta.type + ':' + meta.id;
            if (selectedKey === key) return; selectedKey = key; var serial = ++heroSerial;
            paintHero(heroCache[key] || meta, serial); clearTimeout(heroTimer);
            if (heroCache[key] || (meta.background && meta.description)) return;
            heroTimer = setTimeout(function () {
                if (epoch !== mine || serial !== heroSerial || playback) return;
                var providers = [choice.addon].concat(addons.filter(function (a) { return a !== choice.addon; }));
                providers = providers.filter(function (a) { return C.supports(a, 'meta', meta.type, meta.id); }).slice(0, 2);
                function next() {
                    if (!providers.length || epoch !== mine || serial !== heroSerial || playback) return;
                    request(C.resourceURL(providers.shift(), 'meta', meta.type, meta.id), null, function (err, data) {
                        if (epoch !== mine || serial !== heroSerial) return;
                        if (err || !data || !data.meta) return next();
                        var full = {}, k; for (k in meta) full[k] = meta[k]; for (k in data.meta) full[k] = data.meta[k];
                        if (Object.keys(heroCache).length >= 30) heroCache = {};
                        heroCache[key] = full; paintHero(full, serial);
                    });
                }
                next();
            }, 350);
        }
        function pump() {
            if (epoch !== mine || playback) return;
            while (running < 2 && queue.length) queue.shift()();
        }
        function rowCards(row) {
            row.track.textContent = ''; var items = row.items.slice(0, row.visible);
            items.forEach(function (meta, index) {
                var b = button('', function () { details(meta); }, row.track); b.className = 'card shelf-card';
                b.setAttribute('data-card-index', String(index)); b.setAttribute('data-row-index', String(row.index));
                var image = document.createElement('img'); image.alt = ''; image.setAttribute('data-src', /^https?:\/\//i.test(meta.poster || '') ? meta.poster : ''); b.appendChild(image);
                image.onerror = function () { this.style.visibility = 'hidden'; };
                b.appendChild(node('span', meta.name, 'name')); b.appendChild(node('span', meta.releaseInfo || meta.year || meta.type, 'year'));
                b.onfocus = function () {
                    discoverState.row = row.index; discoverState.card = index;
                    var left = b.offsetLeft, right = left + b.offsetWidth;
                    if (left < row.track.scrollLeft + 8) row.track.scrollLeft = Math.max(0, left - 8);
                    else if (right > row.track.scrollLeft + row.track.clientWidth - 8) row.track.scrollLeft = right - row.track.clientWidth + 8;
                    loadImages(row); selectHero(meta, row.choice);
                };
            });
            if (row.items.length > row.visible || row.hasMore) {
                var more = button('Load more', function () {
                    if (row.items.length > row.visible) {
                        row.visible = Math.min(row.items.length, row.visible + 12);
                        rowCards(row); row.track.querySelector('[data-card-index="' + items.length + '"]').focus();
                    } else { row.visible += 12; loadRow(row, true); }
                }, row.track); more.className = 'shelf-more';
            }
            if (!items.length) message('No titles in this catalog yet.', false, row.track);
            loadImages(row);
            if (!selected && items.length) selectHero(items[0], row.choice);
            if (restore && !restored && row.index === discoverState.row && items.length) {
                restored = true; firstFocused = true;
                var target = row.track.querySelector('[data-card-index="' + Math.min(discoverState.card, items.length - 1) + '"]');
                target.focus(); ensureVisible(target);
            } else if (!restore && !firstFocused && row.index === 0 && items.length) { firstFocused = true; row.track.querySelector('.card').focus(); }
        }
        function loadImages(row) {
            var r = row.section.getBoundingClientRect(); if (r.top > window.innerHeight + 200 || r.bottom < 0) return;
            Array.prototype.forEach.call(row.track.querySelectorAll('img[data-src]'), function (image) {
                var b = image.parentNode, x = b.offsetLeft - row.track.scrollLeft;
                if (x < row.track.clientWidth + 260 && x + b.offsetWidth > -260) {
                    var src = image.getAttribute('data-src'); if (src) image.src = src; image.removeAttribute('data-src');
                }
            });
        }
        function loadRow(row, append) {
            if (row.loading) return; row.loading = true;
            if (!append) { row.track.textContent = ''; message('Loading catalog…', false, row.track); }
            else { var more = row.track.querySelector('.shelf-more'); if (more) { more.disabled = true; more.textContent = 'Loading…'; } }
            queue.push(function () {
                running++;
                var c = row.choice.catalog, extras = append ? {skip: row.offset} : {};
                request(C.resourceURL(row.choice.addon, 'catalog', c.type, c.id, extras), null, function (err, data) {
                    running--; if (epoch !== mine) return;
                    row.loading = false; row.loaded = true;
                    if (err || !data || !Array.isArray(data.metas)) {
                        row.loaded = false; row.failed = true; row.track.textContent = '';
                        var text = row.choice.addon.manifest.name + ': ' + (err ? err.message : 'Invalid catalog response.');
                        message(text, true, row.track); status(text, true);
                        button('Retry catalog', function () { row.failed = false; loadRow(row, append); }, row.track);
                    } else {
                        row.failed = false; row.offset = (append ? row.offset : 0) + data.metas.length;
                        var oldLength = row.items.length;
                        row.items = C.uniqueMetas((append ? row.items : []).concat(data.metas)).slice(0, 120);
                        row.hasMore = !!data.metas.length && C.catalogExtra(c, 'skip') && row.items.length < 120 && (!append || row.items.length > oldLength);
                        if (Object.keys(catalogCache).length >= 40) catalogCache = {};
                        catalogCache[row.key] = {items: row.items, offset: row.offset, hasMore: row.hasMore, date: Date.now()};
                        rowCards(row); status('Your catalogs, together.');
                    }
                    pump();
                });
            });
            pump();
        }
        choices.forEach(function (choice, index) {
            var section = node('section', null, 'catalog-row'), head = node('div', null, 'shelf-heading');
            var title = choice.catalog.name || (choice.catalog.type === 'series' ? 'Popular series' : 'Trending movies');
            var heading = node('h2', title); heading.id = 'catalog-' + index; head.appendChild(heading);
            head.appendChild(node('span', choice.addon.manifest.name, 'catalog-provider'));
            head.appendChild(node('span', choice.catalog.type === 'series' ? 'Series' : choice.catalog.type === 'movie' ? 'Movies' : choice.catalog.type, 'catalog-kind'));
            if (index === 0) head.appendChild(filters);
            section.setAttribute('aria-labelledby', heading.id); section.appendChild(head);
            var track = node('div', null, 'shelf-track'); track.setAttribute('data-row-index', String(index)); section.appendChild(track); shelves.appendChild(section);
            var key = C.resourceURL(choice.addon, 'catalog', choice.catalog.type, choice.catalog.id);
            var row = {index: index, choice: choice, section: section, track: track, key: key, items: [], offset: 0, visible: restore && index === discoverState.row ? Math.max(12, discoverState.card + 1) : 12};
            rows.push(row); var cached = catalogCache[key];
            if (cached && Date.now() - cached.date < 300000) {
                row.items = cached.items; row.offset = cached.offset; row.hasMore = cached.hasMore; row.loaded = true; rowCards(row);
            } else button('Load catalog', function () { loadRow(row); }, track);
            track.onscroll = function () { loadImages(row); };
        });
        homeScroll = function () {
            if (epoch !== mine || playback) return;
            rows.forEach(function (row) {
                var rect = row.section.getBoundingClientRect();
                if (rect.top < window.innerHeight + 360 && rect.bottom > 0) {
                    if (!row.loaded && !row.loading && !row.failed) loadRow(row);
                    else loadImages(row);
                }
            });
        };
        if (!choices.length) { message('No catalogs for this selection. Add a content addon in Settings.', false, shelves); focusFirst(filters); }
        if (restore && rows[discoverState.row] && !rows[discoverState.row].loaded) { loadRow(rows[discoverState.row]); rows[discoverState.row].section.scrollIntoView(); }
        homeScroll(); status('Your catalogs, together.');
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
                        var info = C.streamInfo(stream);
                        if (info.tags.length) b.appendChild(node('span', info.tags.join(' · '), 'stream-tags'));
                        info.warnings.forEach(function (warning) { b.appendChild(node('span', warning, 'stream-warning')); });
                        b.appendChild(node('small', can.ok ? 'Direct video · Select to play' : can.reason));
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
        var bufferLabel = node('label', 'Streaming buffer'), bufferSelect = document.createElement('select');
        bufferSelect.id = 'buffer-mode'; bufferLabel.htmlFor = bufferSelect.id; testBox.appendChild(bufferLabel); testBox.appendChild(bufferSelect);
        [['balanced', 'Balanced · 10s start / 15s recovery'], ['steady', 'Extra buffering · 15s start / 20s recovery'], ['default', 'TV default']].forEach(function (entry) {
            var option = node('option', entry[1]); option.value = entry[0]; bufferSelect.appendChild(option);
        });
        bufferSelect.value = read('bufferMode', 'balanced');
        bufferSelect.onchange = function () { save('bufferMode', bufferSelect.value); status('Buffer setting saved for the next video.'); };
        message('Extra buffering can reduce pauses on an uneven connection, with a longer wait before playback. If a source still buffers, try 1080p H.264 or a lower bitrate. Dolby Vision is unsupported; choose HDR10 or SDR. Buffer controls apply to Samsung AVPlay.', false, testBox);
        message('Test your player with Blender’s Big Buck Bunny MP4 before testing your own streams.', false, testBox);
        button('Play test video', function () {
            play({url: 'https://media.w3.org/2010/05/bunny/trailer.mp4'}, {type: 'movie', id: 'blender-bbb', name: 'Big Buck Bunny'}, 'blender-bbb', 'Big Buck Bunny · playback test');
        }, testBox);
        message('Player: ' + (nativePlayer() ? 'Samsung AVPlay available' : 'HTML5 fallback; Samsung AVPlay unavailable') + ' · Network: ' + (session ? 'local TizenBrew service ' + serviceVersion + ' connected' : 'direct requests; local service unavailable'), false, testBox);
        if (session && serviceVersion !== '0.2.0') message('The service is an older version. Fully restart the TV to load the updated service.', true, testBox);
        focusFirst(); status('Stremio Lite 0.2.0 · unofficial client for older TVs');
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
        playback = {id: id, meta: meta, stream: stream, seconds: 0, duration: 0, lastSaved: 0, native: !!av, paused: false, preparing: true, stalls: 0, bufferEvents: 0, lastUISecond: -1};
        document.body.className = 'playing'; document.getElementById('player').className = '';
        document.getElementById('playing-title').textContent = title; document.getElementById('track-menu').className = 'hidden';
        document.getElementById('time').textContent = ''; document.getElementById('subtitle').textContent = ''; cues = [];
        playbackStatus('Preparing video…'); showBar(); document.getElementById('pause').focus();
        var resume = progress[id], resumeAt = resume && resume.seconds > 10 && resume.seconds < resume.duration - 20 ? resume.seconds : 0;
        function active() { return playback && generation === playbackEpoch; }
        function failed() { if (!active()) return; showBar(); playbackStatus('Playback failed. Try 1080p H.264, HDR10 or SDR, or another source. Return stops the player.'); }
        function buffering(percent) {
            if (!active()) return;
            if (percent === undefined) { playback.bufferEvents++; if (!playback.preparing) playback.stalls++; }
            showBar();
            playbackStatus('Buffering' + (percent === undefined ? '…' : ' ' + percent + '%') + (playback.stalls >= 2 ? ' · Repeated pauses: try a lower bitrate or enable Extra buffering in Settings.' : ''));
        }
        if (av) {
            video.className = 'hidden'; document.getElementById('av-player').className = '';
            try {
                av.open(can.url); av.setDisplayRect(0, 0, 1920, 1080);
                var mode = read('bufferMode', 'balanced');
                if (mode !== 'default' && typeof av.setBufferingParam === 'function') {
                    // Samsung requires IDLE: configure after open, before prepareAsync.
                    try { av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', mode === 'steady' ? 15 : 10); } catch (bufferError) {}
                    try { av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', mode === 'steady' ? 20 : 15); } catch (resumeBufferError) {}
                    try { if (typeof av.setTimeoutForBuffering === 'function') av.setTimeoutForBuffering(mode === 'steady' ? 45 : 30); } catch (timeoutError) {}
                }
                av.setListener({onbufferingstart: function () { buffering(); },
                    onbufferingprogress: function (p) { buffering(p); },
                    onbufferingcomplete: function () { if (active()) playbackStatus('Playing'); },
                    oncurrentplaytime: function (ms) {
                        if (!active()) return;
                        // Avoid multiple layout/storage/subtitle scans per frame on older TVs.
                        var second = Math.floor(ms / 250); if (second === playback.lastUISecond) return;
                        playback.lastUISecond = second; updateTime(ms / 1000, av.getDuration() / 1000);
                    },
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
            video.preload = 'auto'; video.onwaiting = function () { buffering(); };
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
        var video = document.getElementById('video'); video.onended = video.onerror = video.onplaying = video.ontimeupdate = video.onloadedmetadata = video.onwaiting = null;
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
        var track = active.parentNode, siblings, index, targetRow, target;
        if (!playback && track && track.className === 'shelf-track') {
            if (code === 37 || code === 39) {
                siblings = Array.prototype.slice.call(track.querySelectorAll('button:not([disabled])'));
                index = siblings.indexOf(active) + (code === 37 ? -1 : 1);
                if (siblings[index]) { siblings[index].focus(); ensureVisible(siblings[index]); }
                return;
            }
            index = Number(track.getAttribute('data-row-index'));
            targetRow = view.querySelectorAll('.catalog-row')[index + (code === 38 ? -1 : 1)];
            if (targetRow) {
                target = targetRow.querySelector('[data-card-index="' + (active.getAttribute('data-card-index') || '0') + '"]') || targetRow.querySelector('button:not([disabled])');
                if (target) { target.focus(); ensureVisible(target); if (homeScroll) homeScroll(); return; }
            } else if (code === 38) { focusFirst(view.querySelector('.discover-filters')); ensureVisible(document.activeElement); return; }
            else return;
        }
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
            best.focus(); if (!playback) ensureVisible(best);
        }
    }
    function ensureVisible(el) {
        var r = el.getBoundingClientRect(), top = 115;
        if (r.bottom > window.innerHeight - 50) window.scrollBy(0, r.bottom - window.innerHeight + 50);
        else if (r.top < top) window.scrollBy(0, r.top - top);
    }
    window.addEventListener('scroll', function () {
        if (!homeScroll || discoverTick) return;
        discoverTick = setTimeout(function () { discoverTick = null; if (homeScroll) homeScroll(); }, 100);
    });
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
            if (!err && data && data.token) { session = data.token; serviceVersion = data.version || 'unknown'; }
            else if (attempt < 3) return setTimeout(function () { start(attempt + 1); }, 600);
            home();
        });
    }
    start(0);
}());
