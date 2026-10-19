/* MIT. ES5 UI for Tizen 3 / Chromium 47. No bundled Stremio code or account password. */
(function () {
    'use strict';
    var C = window.StremioLite, view = document.getElementById('view');
    var SERVICE = 'http://127.0.0.1:17780', API = 'https://api.strem.io/api/';
    var LINK = 'https://link.stremio.com/api/v2/';
    var APP_VERSION = '3.2.0', REPOSITORY = 'Ws3r211/stremio-lite-tizenbrew';
    var RELEASES = 'https://api.github.com/repos/' + REPOSITORY + '/releases/latest';
    // The installed widget talks to addons directly; the local service only backs desktop tests.
    var PACKAGED = location.protocol === 'file:';
    var CINEMETA = {transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', manifest: {
        id: 'com.linvo.cinemeta', name: 'Cinemeta', types: ['movie', 'series'], resources: ['catalog', 'meta'],
        catalogs: [{id: 'top', type: 'movie', name: 'Movies', extra: [{name: 'search'}, {name: 'skip'}]}, {id: 'top', type: 'series', name: 'Series', extra: [{name: 'search'}, {name: 'skip'}]}]
    }};
    var session = null, epoch = 0, currentPage = null, previous = [], linkTimer = null, linkSerial = 0;
    var playback = null, playbackEpoch = 0, cues = [], barTimer = null, subtitleTimer = null;
    var catalogCache = {}, heroCache = {}, discoverState = {type: 'all', row: 0, card: 0}, discoverTick = null;
    var homeScroll = null, heroTimer = null;
    var menuSerial = 0, menuReturn = 'tracks', scrubCount = 0, scrubLast = 0;
    var searchState = {query: '', type: 'all'};
    function read(key, fallback) { try { return JSON.parse(localStorage.getItem('sl.' + key)) || fallback; } catch (e) { return fallback; } }
    function save(key, value) { try { localStorage.setItem('sl.' + key, JSON.stringify(value)); return true; } catch (e) { status('TV storage is full; settings could not be saved.'); return false; } }
    var authKey = read('auth', ''), addons = read('addons', [CINEMETA]), library = [], libraryItems = {}, progress = read('progress', {});
    var hiddenCatalogs = read('hiddenCatalogs', []), pendingUpdate = read('pendingUpdate', null);
    if (pendingUpdate && C.compareVersions(pendingUpdate.version, APP_VERSION) <= 0) pendingUpdate = null;
    if (!Array.isArray(hiddenCatalogs)) hiddenCatalogs = [];
    if (!Array.isArray(addons) || !addons.length) addons = [CINEMETA];
    var supportedAddons = addons.filter(function (addon) { return !C.isLocalFiles(addon); });
    if (supportedAddons.length !== addons.length) {
        addons = supportedAddons.length ? supportedAddons : [CINEMETA];
        save('addons', addons); pruneHiddenCatalogs();
    }
    if (read('playerPrefsVersion', 0) !== 3) {
        if (save('bufferMode', 'default')) save('playerPrefsVersion', 3);
    }
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
    function cancelLink() { linkSerial++; if (linkTimer) clearTimeout(linkTimer); linkTimer = null; }
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
        // A packaged widget has no history to return to; leave the app instead.
        else if (location.protocol === 'file:' && window.tizen) { try { tizen.application.getCurrentApplication().exit(); } catch (e) { home(); } }
        else { try { window.history.back(); } catch (e) { home(); } }
    }
    function nav(active) {
        var n = document.getElementById('nav'); n.textContent = '';
        [['Discover', home], ['Search', searchPage], ['Library', libraryPage], ['Settings', settings]].forEach(function (item) {
            var b = button(item[0], function () { previous = []; item[1](); }, n);
            if (item[0] === active) { b.className = 'active'; b.setAttribute('aria-current', 'page'); }
        });
    }
    function inLibrary(meta) {
        return library.some(function (item) { return item.type === meta.type && item.id === meta.id; });
    }
    function cardInfo(meta, b) {
        var info = node('span', null, 'card-info');
        info.appendChild(node('span', C.typeLabel(meta.type), 'media-kind'));
        var year = meta.releaseInfo || meta.year;
        if (year) info.appendChild(node('span', year, 'release-year'));
        b.appendChild(info);
        if (inLibrary(meta)) b.appendChild(node('span', 'In library', 'library-badge'));
        b.setAttribute('aria-label', meta.name + ' · ' + C.typeLabel(meta.type) + (year ? ' · ' + year : '') + (inLibrary(meta) ? ' · In library' : ''));
    }
    function cards(items, parent) {
        var grid = node('div', null, 'grid'); (parent || view).appendChild(grid);
        C.uniqueMetas(items).forEach(function (meta) {
            var b = button('', function () { details(meta); }, grid); b.className = 'card';
            var artwork = node('span', null, 'card-artwork'); b.appendChild(artwork);
            var fallback = node('span', null, 'poster-fallback');
            fallback.appendChild(node('span', C.typeLabel(meta.type), 'fallback-type'));
            fallback.appendChild(node('span', meta.name, 'fallback-title'));
            fallback.appendChild(node('span', 'Artwork unavailable', 'fallback-note')); artwork.appendChild(fallback);
            if (/^https?:\/\//i.test(meta.poster || '')) {
                var img = document.createElement('img'); img.style.visibility = 'hidden'; img.alt = ''; artwork.appendChild(img);
                img.onload = function () { this.style.visibility = 'visible'; };
                img.onerror = function () { this.style.display = 'none'; };
                img.src = meta.poster;
            }
            b.appendChild(node('span', meta.name, 'name'));
            cardInfo(meta, b);
            if (meta._slSources && meta._slSources.length) b.appendChild(node('span', meta._slSources.join(' · '), 'card-source'));
            if (meta.type === 'library') b.appendChild(node('span', 'Type not provided by addon', 'card-source'));
        });
        if (!grid.children.length) message('No titles returned.', false, parent);
    }
    function continueWatching() {
        var seen = {}, out = [];
        Object.keys(progress).map(function (videoId) { return {videoId: videoId, p: progress[videoId]}; }).filter(function (x) {
            return x.p && x.p.metaId && x.p.metaId !== 'blender-bbb' && x.p.name && (x.p.type === 'movie' || x.p.type === 'series') && x.p.seconds > 10 && (!x.p.duration || x.p.seconds < x.p.duration - 20);
        }).sort(function (a, b) { return b.p.date - a.p.date; }).forEach(function (x) {
            if (seen[x.p.metaId] || out.length >= 20) return; seen[x.p.metaId] = true;
            out.push({id: x.p.metaId, type: x.p.type, name: x.p.name, poster: x.p.poster});
        });
        return out;
    }
    function resumeFor(metaId) {
        var best = null;
        Object.keys(progress).forEach(function (videoId) {
            var p = progress[videoId];
            if (p && p.metaId === metaId && p.seconds > 10 && (!p.duration || p.seconds < p.duration - 20) && (!best || p.date > best.p.date)) best = {videoId: videoId, p: p};
        });
        return best;
    }
    function home(restore) {
        nav('Discover'); var mine = begin('Discover', function () { home(true); }), choices = C.catalogs(addons, false);
        var catalogCount = choices.length;
        choices = choices.filter(function (choice) { return hiddenCatalogs.indexOf(C.resourceURL(choice.addon, 'catalog', choice.catalog.type, choice.catalog.id)) < 0; });
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
            var heldFocus = row.track.contains(document.activeElement), heldCard = Number(row.track.getAttribute('data-focus-card')) || 0;
            if (!row.items.length) {
                row.section.className = 'catalog-row hidden';
                if (heldFocus) {
                    var nextRow = visibleHomeRows().filter(function (section) { return Number(section.querySelector('.shelf-track').getAttribute('data-row-index')) > row.index; })[0];
                    if (nextRow) focusHomeRow(nextRow, heldCard); else focusHomeHero();
                }
                // Filters must remain reachable even when the first catalog is empty.
                view.insertBefore(filters, shelves); filters.className = 'discover-filters empty-filters';
                if (homeScroll) clearTimeout(discoverTick); discoverTick = setTimeout(function () { if (homeScroll) homeScroll(); }, 0);
                return;
            }
            row.section.className = 'catalog-row';
            row.track.textContent = ''; var items = row.items.slice(0, row.visible);
            items.forEach(function (meta, index) {
                var b = button('', function () { details(meta); }, row.track); b.className = 'card shelf-card';
                b.setAttribute('data-card-index', String(index)); b.setAttribute('data-row-index', String(row.index));
                var image = document.createElement('img'); image.alt = ''; image.setAttribute('data-src', /^https?:\/\//i.test(meta.poster || '') ? meta.poster : ''); b.appendChild(image);
                image.onerror = function () { this.style.visibility = 'hidden'; };
                b.appendChild(node('span', meta.name, 'name')); cardInfo(meta, b);
                b.onfocus = function () {
                    discoverState.row = row.index; discoverState.card = index; row.track.setAttribute('data-focus-card', String(index));
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
            loadImages(row);
            if (!selected && items.length) selectHero(items[0], row.choice);
            if (heldFocus) {
                restored = true; firstFocused = true; focusHomeRow(row.section, heldCard);
            } else if (restore && !restored && row.index === discoverState.row && items.length) {
                restored = true; firstFocused = true;
                var target = row.track.querySelector('[data-card-index="' + Math.min(discoverState.card, items.length - 1) + '"]');
                target.focus(); ensureVisible(target);
            } else if (!firstFocused && items.length && (!restore || !rows[discoverState.row] || !rows[discoverState.row].items.length)) { firstFocused = true; if (document.activeElement === document.body) row.track.querySelector('.card').focus(); }
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
            if (!append) {
                var keepFocus = row.track.contains(document.activeElement);
                row.track.textContent = ''; message('Loading catalog…', false, row.track);
                if (keepFocus) { row.track.tabIndex = -1; row.track.focus(); }
            }
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
                        var retry = button('Retry catalog', function () { row.failed = false; loadRow(row, append); }, row.track);
                        if (document.activeElement === row.track) { retry.focus(); ensureVisible(retry); }
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
                    if (homeScroll) homeScroll();
                });
            });
            pump();
        }
        var watching = continueWatching().filter(function (meta) { return discoverState.type === 'all' || meta.type === discoverState.type; });
        if (watching.length) choices.unshift({addon: {manifest: {name: authKey ? 'Synced with your Stremio account' : 'Saved on this TV'}}, catalog: {id: 'continue', type: 'progress', name: 'Continue watching'}, items: watching});
        choices.forEach(function (choice, index) {
            var section = node('section', null, 'catalog-row'), head = node('div', null, 'shelf-heading');
            var title = choice.catalog.name || (choice.catalog.type === 'series' ? 'Popular series' : 'Trending movies');
            var heading = node('h2', title); heading.id = 'catalog-' + index; head.appendChild(heading);
            head.appendChild(node('span', choice.addon.manifest.name, 'catalog-provider'));
            head.appendChild(node('span', choice.items ? 'Movies & series' : choice.catalog.type === 'series' ? 'Series' : choice.catalog.type === 'movie' ? 'Movies' : choice.catalog.type, 'catalog-kind'));
            if (index === 0) head.appendChild(filters);
            section.setAttribute('aria-labelledby', heading.id); section.appendChild(head);
            var track = node('div', null, 'shelf-track'); track.setAttribute('data-row-index', String(index)); section.appendChild(track); shelves.appendChild(section);
            var key = choice.items ? 'continue-watching' : C.resourceURL(choice.addon, 'catalog', choice.catalog.type, choice.catalog.id);
            var row = {index: index, choice: choice, section: section, track: track, key: key, items: [], offset: 0, visible: restore && index === discoverState.row ? Math.max(12, discoverState.card + 1) : 12};
            rows.push(row); var cached = catalogCache[key];
            if (choice.items) { row.items = choice.items; row.loaded = true; rowCards(row); }
            else if (cached && Date.now() - cached.date < 300000) {
                row.items = cached.items; row.offset = cached.offset; row.hasMore = cached.hasMore; row.loaded = true; rowCards(row);
            } else button('Load catalog', function () { loadRow(row); }, track);
            track.onscroll = function () { loadImages(row); };
        });
        homeScroll = function () {
            if (epoch !== mine || playback) return;
            rows.forEach(function (row) {
                if (row.loaded && !row.items.length) return;
                var rect = row.section.getBoundingClientRect();
                if (rect.top < window.innerHeight + 360 && rect.bottom > 0) {
                    if (!row.loaded && !row.loading && !row.failed) loadRow(row);
                    else loadImages(row);
                }
            });
        };
        var scrollCatalogs = homeScroll;
        homeScroll = function () {
            scrollCatalogs();
            if (rows.length && rows.every(function (r) { return r.loaded && !r.items.length; }) && !shelves.querySelector('.empty-catalogs')) {
                var empty = node('div', null, 'empty-catalogs'); shelves.appendChild(empty);
                message('Your catalogs have no titles right now. Try another content type or check your addon configuration.', false, empty);
                button('Catalog settings', settings, empty); focusFirst(empty);
            }
        };
        if (!choices.length) {
            filters.className += ' empty-filters';
            message(catalogCount ? 'No Home catalogs are visible for this selection. Choose which catalogs to show in Settings.' : 'Your installed addons do not provide Home catalogs. Add a content addon in Settings.', false, shelves);
            button('Choose Home catalogs', function () { settings('catalogs'); }, shelves);
            focusFirst(shelves);
        }
        if (restore && rows[discoverState.row] && !rows[discoverState.row].loaded) { loadRow(rows[discoverState.row]); rows[discoverState.row].section.scrollIntoView(); }
        homeScroll(); status('Your catalogs, together.');
    }
    function searchPage() {
        nav('Search'); var mine = begin('Search', searchPage), form = node('form', null, 'toolbar');
        view.className = 'search-view';
        var input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Movie or series title'; input.setAttribute('aria-label', 'Search titles');
        input.value = searchState.query;
        form.appendChild(input); var submit = node('button', 'Search'); submit.type = 'submit'; form.appendChild(submit); view.appendChild(form);
        var results = node('div'); view.appendChild(results);
        form.onsubmit = function (event) {
            event.preventDefault(); var query = input.value.replace(/^\s+|\s+$/g, ''); if (!query) return;
            if (query !== searchState.query) searchState.type = 'all'; searchState.query = query;
            mine = ++epoch; var searchEpoch = mine; results.textContent = ''; var choices = C.catalogs(addons, true), pending = choices.length + (authKey ? 1 : 0), batches = [], failures = 0, libraryFailed = false;
            if (!choices.length) return message('Your addons do not provide a searchable catalog.', true, results);
            status('Searching…'); submit.disabled = true;
            function finish() {
                if (epoch !== searchEpoch || --pending) return;
                submit.disabled = false;
                var found = C.uniqueMetas([].concat.apply([], batches));
                function rank(meta) {
                    var name = String(meta.name).toLowerCase(), q = query.toLowerCase();
                    return (meta.type === 'library' ? 10 : 0) + (name === q ? 0 : name.indexOf(q) === 0 ? 1 : 2);
                }
                found = found.map(function (meta, index) { return {meta: meta, index: index}; }).sort(function (a, b) { return rank(a.meta) - rank(b.meta) || a.index - b.index; }).map(function (entry) { return entry.meta; });
                var filters = node('div', null, 'search-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Search content type'); results.appendChild(filters);
                var summary = node('p', '', 'search-summary'); results.appendChild(summary);
                if (libraryFailed) message('Library status unavailable. Results are still shown; library badges could not be refreshed.', false, results);
                var list = node('div'); results.appendChild(list);
                var types = [['all', 'All'], ['movie', 'Movies'], ['series', 'TV shows'], ['video', 'Videos'], ['tv', 'Live TV'], ['other', 'Other / library items']], switches = [];
                function matches(meta, type) { return type === 'all' || (type === 'other' ? ['movie', 'series', 'video', 'tv'].indexOf(meta.type) < 0 : meta.type === type); }
                if (!found.some(function (meta) { return matches(meta, searchState.type); })) searchState.type = 'all';
                function paint() {
                    list.textContent = ''; var shown = found.filter(function (meta) { return matches(meta, searchState.type); });
                    switches.forEach(function (entry) { var selected = searchState.type === entry.type; entry.button.className = selected ? 'selected' : ''; entry.button.setAttribute('aria-pressed', String(selected)); });
                    summary.textContent = shown.length + (shown.length === 1 ? ' result' : ' results') + ' for “' + query + '”' + (searchState.type !== 'all' ? ' · ' + types.filter(function (t) { return t[0] === searchState.type; })[0][1] : '');
                    cards(shown, list);
                    status(found.length + ' results' + (failures ? ' · ' + failures + ' catalog requests failed' : ''));
                }
                types.forEach(function (entry) {
                    var count = found.filter(function (meta) { return matches(meta, entry[0]); }).length;
                    if (!count && entry[0] !== 'all') return;
                    var b = button(entry[1] + ' (' + count + ')', function () { searchState.type = entry[0]; paint(); }, filters);
                    switches.push({type: entry[0], button: b});
                });
                paint(); focusFirst(list);
            }
            choices.forEach(function (choice, index) {
                request(C.resourceURL(choice.addon, 'catalog', choice.catalog.type, choice.catalog.id, {search: query}), null, function (err, data) {
                    if (epoch !== searchEpoch) return;
                    if (err) failures++; else batches[index] = (data && Array.isArray(data.metas) ? data.metas : []).map(function (meta) {
                        if (!meta || typeof meta !== 'object') return null;
                        var copy = {}, k; for (k in meta) if (Object.prototype.hasOwnProperty.call(meta, k) && k !== '__proto__') copy[k] = meta[k];
                        if (!copy.type) copy.type = choice.catalog.type;
                        copy._slSources = [String(choice.addon.manifest.name || 'Addon').slice(0, 80)]; return copy;
                    });
                    finish();
                });
            });
            if (authKey) loadLibrary(function (err) { if (epoch !== searchEpoch) return; libraryFailed = !!err; finish(); });
        };
        input.focus();
        if (searchState.query) form.onsubmit({preventDefault: function () {}});
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
                message([C.typeLabel(item.type), item.releaseInfo || item.year, item.runtime, item.imdbRating ? 'IMDb ' + item.imdbRating : '', (item.genres || []).join(', ')].filter(Boolean).join(' · '), false, text);
                if (item.released) message(C.releaseDetails(item.released).label, false, text);
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
                            var release = C.releaseDetails(v.released);
                            var episode = button('', function () { streams(item, v.id, v.title || v.name || item.name); }, list); episode.className = 'episode-row';
                            episode.appendChild(node('span', (v.episode !== undefined ? v.episode + '. ' : '') + (v.title || v.name || 'Episode'), 'episode-title'));
                            episode.appendChild(node('span', release.label, release.upcoming ? 'episode-release upcoming' : 'episode-release'));
                            if (v.overview) episode.appendChild(node('span', v.overview, 'episode-overview'));
                            if (release.upcoming) episode.appendChild(node('span', 'Scheduled date from addon; streams may not be available yet.', 'episode-note'));
                        });
                    }
                    var resume = resumeFor(item.id), resumeVideo = resume && videos.filter(function (v) { return v.id === resume.videoId; })[0];
                    if (resumeVideo) {
                        var resumeButton = button('Resume S' + (resumeVideo.season || 0) + 'E' + (resumeVideo.episode || 0) + ' · ' + formatTime(resume.p.seconds), function () {
                            streams(item, resumeVideo.id, resumeVideo.title || resumeVideo.name || item.name);
                        }, null);
                        resumeButton.className = 'primary'; actions.insertBefore(resumeButton, season);
                        season.value = String(resumeVideo.season || 0);
                    }
                    season.onchange = episodes; episodes();
                } else {
                    var moviePosition = progress[item.id] && progress[item.id].seconds > 10 ? progress[item.id] : null;
                    button(moviePosition ? 'Resume from ' + formatTime(moviePosition.seconds) : 'Find streams', function () { streams(item, item.id, item.name); }, actions);
                }
                focusFirst(actions); status('Select an episode or find streams.');
            }
            var providers = addons.filter(function (a) { return C.supports(a, 'meta', meta.type, meta.id); }), i = 0;
            function next() {
                if (epoch !== mine) return;
                if (i >= providers.length) return content(meta);
                request(C.resourceURL(providers[i++], 'meta', meta.type, meta.id), null, function (err, data) {
                    if (err || !data.meta) return next();
                    var full = {}, k; for (k in meta) if (Object.prototype.hasOwnProperty.call(meta, k) && k !== '__proto__') full[k] = meta[k];
                    for (k in data.meta) if (Object.prototype.hasOwnProperty.call(data.meta, k) && k !== '__proto__' && data.meta[k] !== null && data.meta[k] !== '') full[k] = data.meta[k];
                    content(full);
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
                        total++; var can = C.playable(stream), fit = C.compatibility(stream); stream._slAddon = addon.transportUrl;
                        var b = button((stream.name || addon.manifest.name) + '\n' + (stream.description || stream.title || 'Video stream'), function () {
                            if (!can.ok) return status(can.reason, true);
                            play(stream, meta, id, title);
                        }, null);
                        var info = C.streamInfo(stream);
                        if (info.tags.length) b.appendChild(node('span', info.tags.join(' · '), 'stream-tags'));
                        if (fit.rank === 1 || fit.rank === 2) b.appendChild(node('span', (fit.rank === 2 ? 'Not recommended · ' : '') + fit.label, 'stream-warning'));
                        info.warnings.forEach(function (warning) { if (!/Dolby Vision/.test(warning)) b.appendChild(node('span', warning, 'stream-warning')); });
                        b.appendChild(node('small', can.ok ? (fit.rank === 0 ? 'Plays on this TV · Select to play' : 'Direct video · Select to play') : can.reason));
                        // Best-fitting sources first; addon order is kept within each rank.
                        b.setAttribute('data-rank', String(fit.rank));
                        var after = null; Array.prototype.some.call(list.children, function (other) { if (Number(other.getAttribute('data-rank')) > fit.rank) { after = other; return true; } return false; });
                        list.insertBefore(b, after);
                    });
                    if (--pending) return;
                    status(total + ' sources · best for this TV first' + (failures ? ' · ' + failures + ' addons failed' : ''));
                    if (!total) message('No streams returned by your installed addons.', false, list);
                    focusFirst(list);
                });
            });
        }
        if (currentPage) previous.push(currentPage); render();
    }
    function loadLibrary(cb) {
        account('datastoreGet', {authKey: authKey, collection: 'libraryItem', all: true, ids: []}, function (err, items) {
            if (!err) {
                items = (Array.isArray(items) ? items : []).filter(function (x) { return x && x._id; });
                libraryItems = {}; items.forEach(function (x) { libraryItems[x._id] = x; });
                library = items.filter(function (x) { return !x.removed && !x.temp; }).map(function (x) { x.id = x._id; return x; });
                mergeAccountProgress(items);
            }
            cb(err);
        });
    }
    function mergeAccountProgress(items) {
        // The newest position wins, whether it came from this TV or another Stremio app.
        var changed = false;
        items.forEach(function (item) {
            var state = item.state || {}, videoId = state.video_id, local, when;
            if (!videoId || item.type === 'other') return;
            when = Date.parse(state.lastWatched || item._mtime) || 0; local = progress[videoId];
            if (local && local.date >= when) return;
            if (state.timeOffset > 0) {
                progress[videoId] = {seconds: state.timeOffset / 1000, duration: (state.duration || 0) / 1000, date: when, metaId: item._id, type: item.type, name: item.name, poster: item.poster || ''};
                changed = true;
            } else if (local) { delete progress[videoId]; changed = true; }
        });
        if (changed) save('progress', progress);
    }
    function pushProgress() {
        if (!authKey || !playback || !playback.meta || !playback.meta.id || playback.meta.id === 'blender-bbb' || !(playback.duration > 0)) return;
        var owner = playback, meta = owner.meta, now = new Date().toISOString(), old = libraryItems[meta.id], item = {}, k;
        if (old) { for (k in old) if (Object.prototype.hasOwnProperty.call(old, k)) item[k] = old[k]; }
        else item = {_id: meta.id, name: meta.name || owner.id, type: meta.type, poster: meta.poster || null, posterShape: 'poster', removed: true, temp: true, _ctime: now,
            behaviorHints: {defaultVideoId: meta.type === 'movie' ? meta.id : null, featuredVideoId: null, hasScheduledVideos: false}};
        var state = item.state || {}, played = Math.max(0, Math.min(120, owner.seconds - (owner.pushedSeconds === undefined ? owner.seconds : owner.pushedSeconds))) * 1000;
        var finished = owner.seconds >= owner.duration * 0.9, firstFinish = finished && !owner.countedFinish;
        if (firstFinish) owner.countedFinish = true;
        owner.pushedSeconds = owner.seconds; owner.pushedAt = Date.now();
        // Write every field Stremio apps expect; a partial state can break other clients.
        item.state = {lastWatched: now, timeWatched: (state.timeWatched || 0) + played, timeOffset: finished ? 0 : Math.round(owner.seconds * 1000),
            overallTimeWatched: (state.overallTimeWatched || 0) + played, timesWatched: (state.timesWatched || 0) + (firstFinish ? 1 : 0),
            flaggedWatched: finished && meta.type === 'movie' ? 1 : (state.flaggedWatched || 0), duration: Math.round(owner.duration * 1000),
            video_id: owner.id, watched: state.watched === undefined ? null : state.watched, noNotif: !!state.noNotif};
        item._mtime = now; libraryItems[meta.id] = item;
        account('datastorePut', {authKey: authKey, collection: 'libraryItem', changes: [item]}, function (err) {
            if (err && playback === owner) owner.syncFailed = true;
        });
    }
    function libraryPage() {
        nav('Library'); var mine = begin('Your Stremio library', libraryPage);
        if (!authKey) { message('Sign in from Settings to load your library.'); button('Open settings', settings, view); focusFirst(); return; }
        status('Loading library…');
        loadLibrary(function (err) {
            if (epoch !== mine) return;
            if (err) return status(err.message, true);
            cards(library); focusFirst(); status(library.length + ' library titles · watch progress synced with your account');
        });
    }
    function syncAddons(cb) {
        account('addonCollectionGet', {type: 'AddonCollectionGet', authKey: authKey, update: true}, function (err, data) {
            if (err) return cb(err);
            var list = data && data.addons;
            if (!Array.isArray(list)) return cb(new Error('The account did not return an addon collection.'));
            addons = list.filter(function (a) { return a.manifest && /^https?:\/\//i.test(a.transportUrl) && !C.isLocalFiles(a); });
            if (!addons.some(function (a) { return a.manifest.id === CINEMETA.manifest.id; })) addons.unshift(CINEMETA);
            pruneHiddenCatalogs(); save('addons', addons); cb(null);
        });
    }
    function pruneHiddenCatalogs() {
        var keys = C.catalogs(addons, false).map(function (choice) { return C.resourceURL(choice.addon, 'catalog', choice.catalog.type, choice.catalog.id); });
        hiddenCatalogs = hiddenCatalogs.filter(function (key) { return keys.indexOf(key) >= 0; });
        save('hiddenCatalogs', hiddenCatalogs);
        catalogCache = {}; heroCache = {}; discoverState.row = 0; discoverState.card = 0;
    }
    function homeCatalogSettings() {
        var box = node('section', null, 'panel home-catalog-settings'); box.id = 'home-catalogs'; view.appendChild(box);
        box.appendChild(node('h2', 'Home catalogs'));
        message('Choose which catalogs appear on Home. Hidden catalogs are not requested there. Your addons stay installed for search, details and streams.', false, box);
        var choices = C.catalogs(addons, false), switches = [], count = node('p', '', 'muted'); box.appendChild(count);
        if (!choices.length) { count.textContent = 'No Home catalogs are available from your installed addons.'; return; }
        var actions = node('div', null, 'catalog-actions'); box.appendChild(actions);
        function refresh() {
            var visible = 0;
            switches.forEach(function (entry) {
                var shown = hiddenCatalogs.indexOf(entry.key) < 0;
                entry.control.textContent = shown ? 'Shown' : 'Hidden';
                entry.control.className = 'catalog-toggle' + (shown ? ' enabled' : '');
                entry.control.setAttribute('aria-checked', String(shown));
                if (shown) visible++;
            });
            count.textContent = visible + ' of ' + choices.length + ' catalogs shown on Home';
        }
        function changed() {
            var saved = save('hiddenCatalogs', hiddenCatalogs); catalogCache = {}; heroCache = {};
            discoverState.row = 0; discoverState.card = 0; refresh();
            if (saved) status('Home catalog choices saved on this TV.');
        }
        button('Show all', function () { hiddenCatalogs = []; changed(); }, actions);
        button('Hide all', function () { hiddenCatalogs = choices.map(function (choice) { return C.resourceURL(choice.addon, 'catalog', choice.catalog.type, choice.catalog.id); }); changed(); }, actions);
        var groups = [];
        choices.forEach(function (choice) {
            var addon = choice.addon, c = choice.catalog, group = null;
            groups.forEach(function (entry) { if (entry.url === addon.transportUrl) group = entry.box; });
            if (!group) {
                group = node('div', null, 'catalog-group'); group.appendChild(node('h3', addon.manifest.name || 'Addon')); box.appendChild(group);
                groups.push({url: addon.transportUrl, box: group});
            }
            var row = node('div', null, 'catalog-setting-row'), label = node('div', null, 'catalog-setting-label'); row.appendChild(label);
            var name = c.name || c.id, type = c.type === 'movie' ? 'Movies' : c.type === 'series' ? 'Series' : c.type;
            label.appendChild(node('span', name)); label.appendChild(node('small', type)); group.appendChild(row);
            var key = C.resourceURL(addon, 'catalog', c.type, c.id);
            var toggle = button('', function () {
                var index = hiddenCatalogs.indexOf(key);
                if (index < 0) hiddenCatalogs.push(key); else hiddenCatalogs.splice(index, 1);
                changed();
            }, row);
            toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', 'Show ' + addon.manifest.name + ' · ' + name + ' · ' + type + ' on Home');
            switches.push({key: key, control: toggle});
        });
        refresh();
    }
    function linkAccount(parent, mine, control) {
        cancelLink(); var serial = linkSerial;
        var old = parent.querySelector('.account-sign-in'); if (old) parent.removeChild(old);
        var box = node('div', null, 'panel account-sign-in'); parent.appendChild(box); message('Requesting sign-in code…', false, box);
        function cancelButton() {
            var cancel = button('Cancel sign-in', function () { cancelLink(); parent.removeChild(box); control.disabled = false; control.focus(); ensureVisible(control); }, box);
            cancel.focus(); ensureVisible(cancel);
        }
        cancelButton();
        function alive() { return epoch === mine && serial === linkSerial; }
        function failed(text) {
            box.textContent = ''; message(text, true, box); control.disabled = false; control.focus(); ensureVisible(control);
        }
        request(LINK + 'create?type=Create', null, function (err, response) {
            if (!alive()) return;
            if (err || !response || response.error || !response.result || !response.result.code) return failed(err ? err.message : 'Could not create a sign-in link. Please try again.');
            var result = response.result, attempts = 0; box.textContent = '';
            message('Open this Stremio link on your phone or computer and approve this TV:', false, box);
            box.appendChild(node('p', result.link, 'account-link')); box.appendChild(node('div', result.code, 'code'));
            message('Waiting for approval. Your password is entered only on Stremio’s website.', false, box);
            cancelButton();
            function poll() {
                if (!alive()) return;
                request(LINK + 'read?type=Read&code=' + encodeURIComponent(result.code), null, function (err2, data) {
                    if (!alive()) return;
                    if (data && data.result && data.result.authKey) {
                        authKey = data.result.authKey; save('auth', authKey);
                        syncAddons(function (syncError) { if (epoch !== mine) return; settings(); status(syncError ? syncError.message : 'Signed in; addons imported.', !!syncError); });
                        return;
                    }
                    if (++attempts >= 120) { failed('Sign-in timed out. Request a new code.'); return; }
                    linkTimer = setTimeout(poll, 3000);
                });
            }
            linkTimer = setTimeout(poll, 2000);
        });
    }
    function settings(section) {
        if (typeof section !== 'string') section = 'account';
        nav('Settings'); var mine = begin('Settings', settings);
        view.className = 'settings-view';
        var menu = node('div', null, 'settings-sections'), content = node('div', null, 'settings-content');
        menu.setAttribute('role', 'navigation'); menu.setAttribute('aria-label', 'Settings sections');
        view.appendChild(menu); view.appendChild(content);
        message('Up / Down to move · Left for sections · Right / OK to open', false, menu);
        function addSection(box, id, title) {
            box.id = id === 'catalogs' ? 'home-catalogs' : 'settings-' + id; box.setAttribute('data-settings-section', id); content.appendChild(box);
            var jump = button(title, function () { focusFirst(box); window.scrollBy(0, box.getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom - 20); ensureVisible(document.activeElement); }, menu);
            jump.setAttribute('data-settings-target', id); jump.setAttribute('aria-controls', box.id);
        }
        var accountBox = node('div', null, 'panel');
        accountBox.appendChild(node('h2', 'Stremio account'));
        message(authKey ? 'Signed in. Imported addons and library are read from your account.' : 'Sign in on your phone to import your existing addons and library.', false, accountBox);
        if (authKey) {
            button('Refresh account addons', function () { status('Importing addons…'); syncAddons(function (err) { if (epoch !== mine) return; settings(); status(err ? err.message : 'Addons refreshed.', !!err); }); }, accountBox);
            button('Sign out and clear imported addons', function () { authKey = ''; addons = [CINEMETA]; library = []; hiddenCatalogs = []; save('auth', ''); save('addons', addons); pruneHiddenCatalogs(); settings(); }, accountBox);
        } else button('Sign in with Stremio', function () { this.disabled = true; linkAccount(accountBox, mine, this); }, accountBox);
        message('The account session and configured addon URLs are stored on this TV. Sign out removes them. Watch progress is synced with your Stremio account, so Continue watching matches your other Stremio apps.', false, accountBox);
        addSection(accountBox, 'account', 'Stremio account');
        var updates = node('section', null, 'panel'); updates.appendChild(node('h2', 'Updates')); addSection(updates, 'updates', 'Updates');
        var updateStatus = message('Installed version ' + APP_VERSION + '.', false, updates);
        var updateHelp = message('', false, updates);
        function showUpdate(err, info) {
            if (epoch !== mine) return;
            if (err) { updateStatus.textContent = 'Installed version ' + APP_VERSION + ' · Could not reach GitHub: ' + err.message; updateHelp.textContent = ''; return; }
            updateStatus.textContent = 'Installed version ' + APP_VERSION + (info.newer ? ' · Version ' + info.version + ' is available.' : ' · This is the latest version.');
            updateHelp.textContent = info.newer ? updateSteps(info) : '';
        }
        button('Check for updates', function () {
            var b = this; b.disabled = true; updateStatus.textContent = 'Checking GitHub for a new version…';
            checkForUpdate(true, function (err, info) { b.disabled = false; showUpdate(err, info); });
        }, updates);
        message('The TV cannot install updates by itself. A new version is installed from your computer with TizenBrew Installer → Install from GitHub → ' + REPOSITORY + '. Your account, addons and settings stay on the TV.', false, updates);
        if (pendingUpdate) showUpdate(null, pendingUpdate);
        homeCatalogSettings(); addSection(document.getElementById('home-catalogs'), 'catalogs', 'Home catalogs');
        var addonBox = node('div', null, 'panel'); addSection(addonBox, 'addons', 'Content addons'); addonBox.appendChild(node('h2', 'Content addons'));
        message('Local Files is excluded because its desktop Stremio service is unavailable in this TV client.', false, addonBox);
        addons.forEach(function (a, i) {
            var row = node('div', null, 'toolbar'); row.appendChild(node('span', a.manifest.name || 'Addon'));
            button('Remove', function () { addons.splice(i, 1); pruneHiddenCatalogs(); save('addons', addons); settings(); }, row); addonBox.appendChild(row);
        });
        var form = node('form'), label = node('label', 'Addon manifest URL'), field = document.createElement('input');
        field.type = 'text'; field.className = 'wide'; field.placeholder = 'https://your-addon/manifest.json'; field.id = 'addon-url'; label.htmlFor = field.id;
        form.appendChild(label); form.appendChild(field); var add = node('button', 'Add addon'); add.type = 'submit'; form.appendChild(add); addonBox.appendChild(form);
        form.onsubmit = function (e) {
            e.preventDefault(); var target;
            try { target = C.manifestURL(field.value); } catch (err) { return status(err.message, true); }
            if (C.isLocalFiles({transportUrl: target})) return status('Local Files requires the desktop Stremio service and cannot be added to this TV client.', true);
            status('Checking addon…'); add.disabled = true;
            request(target, null, function (err, manifest) {
                if (epoch !== mine) return; add.disabled = false;
                if (err) return status(err.message, true);
                if (!manifest || !manifest.id || !manifest.name || !Array.isArray(manifest.resources)) return status('This URL did not return a Stremio addon manifest.', true);
                if (C.isLocalFiles({transportUrl: target, manifest: manifest})) return status('Local Files requires the desktop Stremio service and cannot be added to this TV client.', true);
                var found = addons.some(function (a) { return a.transportUrl === target; });
                if (!found) addons.push({transportUrl: target, manifest: manifest}); save('addons', addons); settings(); status('Addon ready.');
            });
        };
        var languageBox = node('section', null, 'panel'); addSection(languageBox, 'languages', 'Languages'); languageBox.appendChild(node('h2', 'Languages'));
        message('Chosen automatically when a video starts. Remember last choice uses the language you last picked in the player.', false, languageBox);
        var languages = ['English', 'Dutch', 'German', 'French', 'Spanish', 'Italian', 'Portuguese', 'Turkish', 'Polish', 'Japanese', 'Korean'];
        [['audio', 'Audio language', [['last', 'Remember last choice'], ['default', 'File default']]], ['subtitles', 'Subtitle language', [['last', 'Remember last choice'], ['off', 'Off']]]].forEach(function (group) {
            var key = group[0] === 'audio' ? 'audioLanguage' : 'subtitleLanguage', choicesBox = node('div', null, 'buffer-choices language-choices'), entries = [];
            languageBox.appendChild(node('h3', group[1])); choicesBox.setAttribute('role', 'radiogroup'); choicesBox.setAttribute('aria-label', group[1]); languageBox.appendChild(choicesBox);
            group[2].concat(languages.map(function (name) { return [name, name]; })).forEach(function (entry) {
                var b = button(entry[1], function () { save(key, entry[0]); paint(); status(group[1] + ': ' + entry[1]); }, choicesBox);
                b.setAttribute('role', 'radio'); entries.push({value: entry[0], button: b});
            });
            function paint() { entries.forEach(function (entry) { entry.button.setAttribute('aria-checked', String(entry.value === read(key, 'last'))); }); }
            paint();
        });
        var testBox = node('div', null, 'panel'); addSection(testBox, 'playback', 'Playback check'); testBox.appendChild(node('h2', 'Playback check'));
        testBox.appendChild(node('h3', 'Streaming buffer'));
        var bufferChoices = node('div', null, 'buffer-choices'); bufferChoices.id = 'buffer-mode';
        bufferChoices.setAttribute('role', 'radiogroup'); bufferChoices.setAttribute('aria-label', 'Streaming buffer'); testBox.appendChild(bufferChoices);
        var bufferButtons = [];
        [['default', 'TV default'], ['balanced', 'Balanced · 10s start / 15s recovery'], ['steady', 'Extra buffering · 15s start / 20s recovery']].forEach(function (entry) {
            var b = button(entry[1], function () {
                save('bufferMode', entry[0]); refreshBuffers(); status('Buffer setting saved for the next video.');
            }, bufferChoices);
            b.setAttribute('role', 'radio'); bufferButtons.push({value: entry[0], button: b});
        });
        function refreshBuffers() {
            bufferButtons.forEach(function (entry) { entry.button.setAttribute('aria-checked', String(entry.value === read('bufferMode', 'default'))); });
        }
        refreshBuffers();
        message('TV default lets Samsung manage buffering and memory. Extra buffering is optional and may use more memory or delay startup. If a source still fails or buffers, try a lower bitrate without Dolby Vision. Buffer controls apply to Samsung AVPlay.', false, testBox);
        testBox.appendChild(node('h3', 'Autoplay next episode'));
        var autoplayBox = node('div', null, 'buffer-choices'); autoplayBox.setAttribute('role', 'radiogroup'); autoplayBox.setAttribute('aria-label', 'Autoplay next episode'); testBox.appendChild(autoplayBox);
        var autoplayButtons = [['on', 'On · 10 second countdown'], ['off', 'Off']].map(function (entry) {
            var b = button(entry[1], function () { save('autoplayNext', entry[0]); paintAutoplay(); status('Autoplay next episode: ' + entry[1]); }, autoplayBox);
            b.setAttribute('role', 'radio'); return {value: entry[0], button: b};
        });
        function paintAutoplay() { autoplayButtons.forEach(function (entry) { entry.button.setAttribute('aria-checked', String(entry.value === read('autoplayNext', 'on'))); }); }
        paintAutoplay();
        message('Near the end of an episode the next one is offered. It continues with a source from the same addon and release group when possible.', false, testBox);
        message('Test your player with Blender’s Big Buck Bunny MP4 before testing your own streams.', false, testBox);
        button('Play test video', function () {
            play({url: 'https://media.w3.org/2010/05/bunny/trailer.mp4'}, {type: 'movie', id: 'blender-bbb', name: 'Big Buck Bunny'}, 'blender-bbb', 'Big Buck Bunny · playback test');
        }, testBox);
        message('Player: ' + (nativePlayer() ? 'Samsung AVPlay' : 'browser player; Samsung AVPlay unavailable') + ' · Network: ' + (session ? 'local test service' : 'direct requests'), false, testBox);
        if (!nativePlayer()) message('Audio track switching needs Samsung AVPlay. Install Stremio Lite as an app on the TV instead of opening it in a browser or TizenBrew module.', true, testBox);
        var initial = content.querySelector('[data-settings-section="' + section + '"]') || accountBox;
        focusFirst(initial); ensureVisible(document.activeElement); status('Stremio Lite ' + APP_VERSION + ' · unofficial client for older TVs');
    }
    function updateSteps(info) {
        return 'To install ' + info.version + ': on your computer open TizenBrew Installer, connect to this TV, choose Install from GitHub and enter ' + REPOSITORY + '. Then reopen Stremio Lite.';
    }
    function checkForUpdate(force, cb) {
        // Background checks run at most once a day; GitHub limits anonymous API calls per IP.
        if (!force && Date.now() - Number(read('updateCheckedAt', 0)) < 86400000) return cb(null, pendingUpdate);
        request(RELEASES, null, function (err, release) {
            if (err) return cb(err);
            var version = String(release && release.tag_name || '').replace(/^v/, '');
            var hasWidget = (release.assets || []).some(function (asset) { return /\.wgt$/i.test(asset.name || ''); });
            if (!/^\d+\.\d+\.\d+$/.test(version)) return cb(new Error('The latest release has no version number.'));
            save('updateCheckedAt', Date.now());
            pendingUpdate = {version: version, newer: hasWidget && C.compareVersions(version, APP_VERSION) > 0};
            save('pendingUpdate', pendingUpdate.newer ? pendingUpdate : null);
            cb(null, pendingUpdate);
        });
    }
    function announceUpdate(err, info) {
        if (!err && info && info.newer && !playback) status('Stremio Lite ' + info.version + ' is available · Settings → Updates');
    }
    function nativePlayer() { return window.webapis && window.webapis.avplay; }
    function formatTime(seconds) {
        if (!isFinite(seconds)) return '--:--';
        seconds = Math.max(0, Math.floor(seconds || 0)); var h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function playbackStatus(text) {
        document.getElementById('playback-status').textContent = text;
        var busy = /^(Preparing|Buffering|Retrying|Resuming|Seeking)/.test(text), error = /^Playback failed/.test(text);
        document.getElementById('player-state').className = busy || error ? (error ? 'player-error' : '') : 'hidden';
        document.getElementById('player-state-label').textContent = text;
        document.getElementById('buffer-progress').className = busy ? '' : 'hidden';
        document.getElementById('player-error-back').className = error ? '' : 'hidden';
        if (playback) { playback.failed = error; playback.buffering = /^Buffering/.test(text); }
    }
    function paintPause() {
        if (!playback) return;
        document.querySelector('#pause .button-label').textContent = playback.paused ? 'Play' : 'Pause';
        document.querySelector('#pause use').setAttributeNS('http://www.w3.org/1999/xlink', 'href', 'player-icons.svg#' + 'player-' + (playback.paused ? 'play' : 'pause'));
        document.getElementById('pause').setAttribute('aria-pressed', String(playback.paused));
    }
    function paintTimeline() {
        if (!playback) return;
        var range = document.getElementById('timeline'), duration = playback.duration, known = isFinite(duration) && duration > 0;
        var seconds = playback.scrub === null ? playback.seconds : playback.scrub;
        var busy = playback.preparing || playback.seeking || playback.failed;
        range.disabled = !known || busy;
        ['audio', 'tracks', 'pause'].forEach(function (id) { document.getElementById(id).disabled = busy; });
        ['jump', 'rewind', 'forward'].forEach(function (id) { document.getElementById(id).disabled = busy || !known; });
        range.max = known ? Math.floor(duration) : 100; range.value = known ? Math.floor(seconds) : 0;
        range.setAttribute('aria-valuetext', formatTime(seconds) + ' of ' + formatTime(known ? duration : NaN));
        document.getElementById('played-progress').style.width = (known ? Math.max(0, Math.min(100, seconds / duration * 100)) : 0) + '%';
        document.getElementById('time').textContent = formatTime(seconds) + ' / ' + formatTime(known ? duration : NaN);
        var preview = document.getElementById('seek-preview');
        preview.className = playback.scrub === null ? 'hidden' : '';
        preview.textContent = formatTime(seconds) + ' · OK to seek';
        preview.style.left = Math.max(8, Math.min(92, known ? seconds / duration * 100 : 0)) + '%';
        if (!playback.native && known) {
            try {
                var buffered = document.getElementById('video').buffered, end = 0, i;
                for (i = 0; i < buffered.length; i++) if (buffered.start(i) <= playback.seconds + 1 && buffered.end(i) >= playback.seconds) end = buffered.end(i);
                document.getElementById('buffered-progress').style.width = Math.min(100, end / duration * 100) + '%';
            } catch (e) {}
        }
    }
    function updateTime(seconds, duration) {
        if (!playback) return;
        if (seconds > playback.seconds + 0.05) {
            playback.lastProgressAt = Date.now();
            if (playback.buffering && !playback.preparing && !playback.seeking && !playback.paused && !playback.failed) playbackStatus('Playing');
        }
        playback.seconds = seconds; playback.duration = duration;
        paintTimeline();
        if (seconds - playback.lastSaved > 10) { storeProgress(); playback.lastSaved = seconds; }
        if (duration > 60 && duration - seconds <= 30 && seconds > 0 && !playback.seeking && playback.scrub === null) offerNextEpisode();
        if (!cues.length && playback.nativeCue && seconds >= playback.nativeCue.end) { playback.nativeCue = null; document.getElementById('subtitle').textContent = ''; }
        if (cues.length) {
            var text = '', i;
            var shifted = seconds - (playback.subtitleOffset || 0);
            for (i = 0; i < cues.length; i++) if (shifted >= cues[i].start && shifted < cues[i].end) { text = cues[i].text; break; }
            document.getElementById('subtitle').textContent = text;
        }
    }
    function storeProgress(force) {
        if (!playback || (playback.preparing && !playback.seconds)) return;
        var meta = playback.meta || {};
        progress[playback.id] = {seconds: playback.seconds || 0, duration: playback.duration || 0, date: Date.now(), metaId: meta.id, type: meta.type, name: meta.name, poster: meta.poster || ''};
        if (force || !playback.pushedAt || Date.now() - playback.pushedAt > 60000) pushProgress();
        var keys = Object.keys(progress).sort(function (a, b) { return progress[b].date - progress[a].date; });
        keys.slice(100).forEach(function (key) { delete progress[key]; }); save('progress', progress);
    }
    function showBar() {
        document.getElementById('player-chrome').className = ''; if (barTimer) clearTimeout(barTimer);
        barTimer = setTimeout(function () {
            if (playback && !playback.paused && !playback.preparing && !playback.seeking && !playback.buffering && !playback.failed && playback.scrub === null && document.getElementById('track-menu').className === 'hidden') document.getElementById('player-chrome').className = 'hidden';
        }, 6000);
    }
    function play(stream, meta, id, title, startOver) {
        var can = C.playable(stream); if (!can.ok) return status(can.reason, true);
        if (playback) stopPlayback(); var generation = ++playbackEpoch, av = nativePlayer(), video = document.getElementById('video');
        playback = {id: id, meta: meta, stream: stream, seconds: 0, duration: 0, lastSaved: 0, native: !!av, paused: false, preparing: true, stalls: 0, bufferEvents: 0, lastUISecond: -1, scrub: null, subtitleOffset: Number(read('subtitleOffset', 0)) || 0, subtitleChoice: 'default', subtitleSources: [], seeking: false, returnFocus: document.activeElement, returnScroll: window.pageYOffset};
        playback.lastProgressAt = Date.now();
        document.documentElement.className = av ? 'native-playing' : '';
        window.scrollTo(0, 0);
        document.body.className = 'playing'; document.getElementById('player').className = '';
        document.getElementById('playing-title').textContent = title; document.getElementById('track-menu').className = 'hidden';
        document.getElementById('time').textContent = ''; document.getElementById('subtitle').textContent = ''; cues = []; document.getElementById('next-episode').className = 'hidden';
        document.getElementById('subtitle').style.fontSize = Number(read('subtitleSize', 36)) + 'px';
        document.getElementById('player-engine').textContent = (av ? 'Samsung AVPlay' : 'HTML5') + ' · ' + (C.streamInfo(stream).tags.slice(0, 3).join(' · ') || 'Direct play');
        document.getElementById('track-scrim').className = 'hidden'; ++menuSerial;
        document.getElementById('buffered-progress').style.width = '0%'; document.getElementById('buffer-progress').removeAttribute('value');
        paintPause(); paintTimeline();
        playbackStatus('Preparing video…'); showBar(); document.getElementById('pause').focus();
        var resume = progress[id], resumeAt = !startOver && resume && resume.seconds > 10 && resume.seconds < resume.duration - 20 ? resume.seconds : 0;
        document.getElementById('player-retry').onclick = function () { play(stream, meta, id, title, true); };
        document.getElementById('player-retry').className = 'hidden';
        function active() { return playback && generation === playbackEpoch && !playback.failed; }
        function failed(error) {
            if (!active()) return;
            if (playback.trackChange) playback.trackChange.cancel();
            var code = typeof error === 'string' ? error : error && (typeof error.code === 'string' ? error.code : error.name);
            code = /^[A-Za-z][A-Za-z0-9_]{2,70}$/.test(String(code || '')) ? ' (' + code + ')' : '';
            clearTimeout(playback.startTimer); clearTimeout(playback.seekTimer); clearInterval(playback.watchTimer);
            playback.preparing = false; playback.seeking = false;
            var timeout = /TIMEOUT/.test(code);
            showBar(); playbackStatus('Playback failed' + code + (timeout ? '. The source stopped responding. Retry from the beginning or choose another source.' : '. Try a lower-bitrate source without Dolby Vision. Return stops the player.'));
            paintTimeline(); document.getElementById('player-retry').className = '';
            if (playback.native) { try { av.stop(); } catch (failedStop) {} try { av.close(); } catch (failedClose) {} }
            else video.pause();
            document.getElementById('player-error-back').focus();
        }
        playback.watchTimer = setInterval(function () {
            if (!active() || playback.paused || playback.seeking) return;
            if (Date.now() - playback.lastProgressAt > (playback.preparing ? 90000 : 60000)) failed(playback.preparing ? 'STARTUP_TIMEOUT' : 'BUFFERING_TIMEOUT');
        }, 1000);
        function buffering(percent) {
            if (!active()) return;
            if (percent === undefined) { playback.bufferEvents++; if (!playback.preparing) playback.stalls++; }
            showBar();
            if (percent === undefined) document.getElementById('buffer-progress').removeAttribute('value'); else document.getElementById('buffer-progress').value = percent;
            playbackStatus('Buffering' + (percent === undefined ? '…' : ' ' + percent + '%') + (playback.stalls >= 2 ? ' · Repeated pauses: try a lower bitrate or enable Extra buffering in Settings.' : ''));
        }
        if (av) {
            video.className = 'hidden'; document.getElementById('av-player').className = '';
            var mode = read('bufferMode', 'default'), attempt = 0, retried = false, retriedResume = false;
            if (['balanced', 'steady', 'default'].indexOf(mode) < 0) mode = 'default';
            var openNative = function (useCustomBuffer) {
                if (!active()) return;
                var thisAttempt = ++attempt, started = false, handlingFailure = false;
                function current() { return active() && thisAttempt === attempt; }
                function nativeFailed(error) {
                    if (!current() || handlingFailure) return; handlingFailure = true;
                    clearTimeout(playback.startTimer);
                    if (!started && useCustomBuffer && !retried) {
                        retried = true; ++attempt;
                        playbackStatus('Retrying with TV default buffering…');
                        try { av.stop(); } catch (stopError) {}
                        try { av.close(); } catch (closeError) {}
                        return openNative(false);
                    }
                    failed(error);
                }
                function startNative() {
                    if (!current() || started || handlingFailure) return;
                    clearTimeout(playback.startTimer);
                    try {
                        av.play(); if (!current() || handlingFailure) return;
                        try { av.setSilentSubtitle(true); } catch (subtitleModeError) {}
                        started = true; playback.preparing = false;
                        setTimeout(applyLanguagePrefs, 800);
                        playback.lastProgressAt = Date.now();
                        playbackStatus(retried ? 'Playing · TV default buffering' : 'Playing');
                        try { updateTime(resumeAt || 0, av.getDuration() / 1000); } catch (timeError) {}
                        paintPause(); showBar();
                        if (!document.getElementById('player').contains(document.activeElement)) document.getElementById('pause').focus();
                    } catch (playError) { nativeFailed(playError); }
                }
                try {
                av.open(can.url); av.setDisplayRect(0, 0, 1920, 1080);
                if (useCustomBuffer && typeof av.setBufferingParam === 'function') {
                    // Samsung requires IDLE: configure after open, before prepareAsync.
                    try { av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', mode === 'steady' ? 15 : 10); } catch (bufferError) {}
                    try { av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', mode === 'steady' ? 20 : 15); } catch (resumeBufferError) {}
                    try { if (typeof av.setTimeoutForBuffering === 'function') av.setTimeoutForBuffering(mode === 'steady' ? 45 : 30); } catch (timeoutError) {}
                }
                av.setListener({onbufferingstart: function () { if (current()) buffering(); },
                    onbufferingprogress: function (p) { if (current()) buffering(p); },
                    onbufferingcomplete: function () { if (current() && !playback.seeking) playbackStatus(playback.preparing ? 'Preparing video…' : playback.paused ? 'Paused' : 'Playing'); },
                    oncurrentplaytime: function (ms) {
                        if (!current()) return;
                        // Avoid multiple layout/storage/subtitle scans per frame on older TVs.
                        var second = Math.floor(ms / 250); if (second === playback.lastUISecond) return;
                        playback.lastUISecond = second; updateTime(ms / 1000, av.getDuration() / 1000);
                    },
                    onstreamcompleted: function () { if (current()) finishPlayback(); }, onerror: nativeFailed,
                    onsubtitlechange: function (duration, text, type) {
                        if (!current() || playback.seeking || cues.length || playback.subtitleChoice === 'off') return;
                        if (String(type) === '1') { playbackStatus('This embedded subtitle uses images. Try addon SRT or WebVTT subtitles.'); return; }
                        var stripped = String(text || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '');
                        playback.nativeCue = {text: stripped, end: playback.seconds + Math.max(0, Number(duration) || 3000) / 1000};
                        document.getElementById('subtitle').textContent = stripped;
                    }});
                playback.startTimer = setTimeout(function () { nativeFailed('STARTUP_TIMEOUT'); }, 45000);
                av.prepareAsync(function () {
                    if (!current() || handlingFailure) return;
                    clearTimeout(playback.startTimer);
                    if (resumeAt) {
                        playbackStatus('Resuming video…');
                        playback.startTimer = setTimeout(function () {
                            if (!current() || handlingFailure || retriedResume) return;
                            retriedResume = true; handlingFailure = true; ++attempt; resumeAt = 0;
                            playbackStatus('Retrying from the beginning · resume did not respond…');
                            try { av.stop(); } catch (stopResumeError) {}
                            try { av.close(); } catch (closeResumeError) {}
                            openNative(false);
                        }, 15000);
                        function resumeFailed() { resumeAt = 0; startNative(); }
                        try { av.seekTo(resumeAt * 1000, startNative, resumeFailed); } catch (seekError) { resumeFailed(); }
                    } else startNative();
                }, nativeFailed);
                } catch (error) { nativeFailed(error); }
            };
            openNative(mode !== 'default');
        } else {
            video.className = ''; document.getElementById('av-player').className = 'hidden';
            video.onerror = function () {
                var codes = {1: 'MEDIA_ERR_ABORTED', 2: 'MEDIA_ERR_NETWORK', 3: 'MEDIA_ERR_DECODE', 4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'};
                failed(video.error ? codes[video.error.code] : 'HTML5_ERROR');
            }; video.onended = function () { if (active()) finishPlayback(); };
            video.preload = 'auto'; video.onwaiting = function () { buffering(); };
            video.ontimeupdate = function () { if (active()) updateTime(video.currentTime, video.duration); };
            video.onloadedmetadata = function () {
                if (!active()) return;
                if (resumeAt) { try { video.currentTime = resumeAt; } catch (e) {} }
                if (active()) updateTime(video.currentTime, video.duration);
            };
            video.onprogress = function () { if (active()) paintTimeline(); };
            video.onplaying = function () { if (active()) { clearTimeout(playback.startTimer); playback.preparing = false; applyLanguagePrefs(); if (video.paused || playback.seeking) return; playbackStatus('Playing'); paintTimeline(); paintPause(); showBar(); if (!document.getElementById('player').contains(document.activeElement)) document.getElementById('pause').focus(); } };
            video.src = can.url;
            var promise = video.play(); if (promise && promise.catch) promise.catch(failed);
        }
    }
    function nextEpisodeLabel(meta, video) {
        return 'S' + (video.season || 0) + 'E' + (video.episode || 0) + ' · ' + (video.title || video.name || meta.name);
    }
    function offerNextEpisode() {
        var owner = playback;
        if (!owner || owner.nextOffered || read('autoplayNext', 'on') !== 'on') return;
        owner.nextOffered = true;
        var next = C.nextVideo(owner.meta, owner.id); if (!next) return;
        owner.next = {video: next, streams: [], pending: 0};
        // Look for the next episode's sources while the credits run.
        var providers = addons.filter(function (a) { return C.supports(a, 'stream', owner.meta.type, next.id); });
        owner.next.pending = providers.length;
        providers.forEach(function (addon) {
            request(C.resourceURL(addon, 'stream', owner.meta.type, next.id), null, function (err, data) {
                if (playback !== owner) return; owner.next.pending--;
                if (!err) (data.streams || []).forEach(function (stream) { stream._slAddon = addon.transportUrl; if (C.playable(stream).ok) owner.next.streams.push(stream); });
            });
        });
        var box = document.getElementById('next-episode');
        box.textContent = ''; box.className = '';
        box.appendChild(node('span', 'Up next', 'player-eyebrow')); box.appendChild(node('strong', nextEpisodeLabel(owner.meta, next)));
        var countdown = node('p', '', 'muted'); box.appendChild(countdown);
        var actions = node('div', null, 'next-actions'); box.appendChild(actions);
        var now = button('Play now', function () { playNextEpisode(owner); }, actions); now.id = 'next-play';
        button('Cancel', function () { cancelNextEpisode(owner); }, actions).id = 'next-cancel';
        var left = 10;
        function tick() {
            if (playback !== owner || !owner.next || owner.next.cancelled) return;
            countdown.textContent = 'Starts in ' + left + ' s'; if (left-- <= 0) return playNextEpisode(owner);
            owner.next.timer = setTimeout(tick, 1000);
        }
        tick(); now.focus();
    }
    function cancelNextEpisode(owner) {
        if (!owner.next) return; owner.next.cancelled = true; clearTimeout(owner.next.timer);
        document.getElementById('next-episode').className = 'hidden';
        if (playback === owner) { showBar(); document.getElementById(owner.controlFocus || 'pause').focus(); }
    }
    function finishPlayback() {
        var owner = playback;
        if (owner && read('autoplayNext', 'on') === 'on' && !owner.nextOffered) offerNextEpisode();
        if (owner && owner.next && !owner.next.cancelled) return playNextEpisode(owner);
        stopPlayback();
    }
    function playNextEpisode(owner) {
        if (playback !== owner || !owner.next || owner.next.started) return;
        var pending = owner.next, video = pending.video, meta = owner.meta, previousStream = owner.stream;
        clearTimeout(pending.timer); pending.started = true;
        var title = video.title || video.name || meta.name;
        function choose() {
            if (playback !== owner) return;
            if (pending.pending > 0 && Date.now() - waitStarted < 15000) return setTimeout(choose, 250);
            document.getElementById('next-episode').className = 'hidden';
            var best = null, bestScore = -Infinity;
            pending.streams.forEach(function (stream) { var score = C.bingeScore(stream, previousStream); if (score > bestScore) { best = stream; bestScore = score; } });
            if (best && C.compatibility(best).rank < 2) return play(best, meta, video.id, title, false);
            // No safe match: let the viewer pick a source for the next episode.
            stopPlayback(); streams(meta, video.id, title);
        }
        var waitStarted = Date.now();
        playbackStatus('Preparing ' + nextEpisodeLabel(meta, video) + '…'); choose();
    }
    function stopPlayback() {
        if (!playback) return; if (playback.trackChange) playback.trackChange.cancel(); if (playback.next) clearTimeout(playback.next.timer); document.getElementById('next-episode').className = 'hidden'; storeProgress(true); clearTimeout(playback.startTimer); clearTimeout(playback.seekTimer); clearInterval(playback.watchTimer); var wasNative = playback.native, returnFocus = playback.returnFocus, returnScroll = playback.returnScroll; playback = null; ++playbackEpoch; ++menuSerial;
        if (barTimer) clearTimeout(barTimer); if (subtitleTimer) clearTimeout(subtitleTimer);
        if (wasNative) { try { nativePlayer().stop(); } catch (e) {} try { nativePlayer().close(); } catch (e) {} }
        var video = document.getElementById('video'); video.onended = video.onerror = video.onplaying = video.ontimeupdate = video.onloadedmetadata = video.onwaiting = video.onprogress = video.onseeked = null;
        video.pause(); video.removeAttribute('src'); video.load(); cues = [];
        document.getElementById('player').className = 'hidden'; document.getElementById('track-menu').className = 'hidden'; document.getElementById('track-scrim').className = 'hidden'; document.body.className = '';
        document.documentElement.className = '';
        document.getElementById('subtitle').textContent = '';
        window.scrollTo(0, returnScroll || 0);
        if (returnFocus && document.body.contains(returnFocus) && !returnFocus.disabled) returnFocus.focus(); else focusFirst();
    }
    function togglePause(force) {
        if (!playback || playback.preparing || playback.seeking || playback.failed) return;
        if (playback.trackChange) playback.trackChange.cancel();
        var paused = force === undefined ? !playback.paused : force;
        try { if (playback.native) nativePlayer()[paused ? 'pause' : 'play']();
            else if (paused) document.getElementById('video').pause(); else document.getElementById('video').play();
            playback.paused = paused; playback.lastProgressAt = Date.now(); playbackStatus(paused ? 'Paused' : 'Playing'); paintPause(); showBar();
            if (paused) storeProgress(true);
        } catch (e) { playbackStatus('Player is not ready.'); }
    }
    function seek(delta) {
        if (playback) seekToSeconds(playback.seconds + delta);
    }
    function seekToSeconds(target) {
        if (!playback || playback.preparing || playback.seeking || playback.failed || !isFinite(playback.duration) || playback.duration <= 0) return false;
        target = Math.max(0, Math.min(playback.duration - 1, target));
        if (playback.trackChange) playback.trackChange.cancel();
        if (playback.nativeCue) { playback.nativeCue = null; document.getElementById('subtitle').textContent = ''; }
        var mine = playbackEpoch, settled = false, seekFocus = document.activeElement; playback.seeking = true; playback.scrub = null; scrubCount = 0; paintTimeline();
        playbackStatus('Seeking to ' + formatTime(target) + '…'); showBar();
        function finish() {
            if (settled || !playback || playback.failed || mine !== playbackEpoch) return false;
            settled = true; clearTimeout(playback.seekTimer); playback.seekTimer = null; playback.seeking = false; paintTimeline();
            if (playback.menuFocus) { document.getElementById(playback.menuFocus).focus(); playback.menuFocus = null; }
            else if (document.activeElement === document.body && seekFocus && document.getElementById('player-chrome').contains(seekFocus) && !seekFocus.disabled) seekFocus.focus();
            return true;
        }
        function completed() {
            if (!finish()) return;
            updateTime(target, playback.duration);
            playbackStatus(playback.paused ? 'Paused' : 'Playing'); showBar();
            playback.lastProgressAt = Date.now();
        }
        function error() {
            if (!finish()) return;
            playbackStatus('Could not seek to this position. Try again or choose another source.'); showBar();
        }
        playback.seekTimer = setTimeout(error, 20000);
        try {
            if (playback.native) nativePlayer().seekTo(target * 1000, completed, error);
            else { var video = document.getElementById('video'); video.onseeked = completed; video.currentTime = target; }
        } catch (e) { error(); }
        return true;
    }
    function scrub(delta) {
        if (!playback || playback.preparing || playback.seeking || !isFinite(playback.duration) || playback.duration <= 0) return;
        if (Date.now() - scrubLast > 800) scrubCount = 0;
        scrubLast = Date.now(); scrubCount++;
        var step = scrubCount > 16 ? 60 : scrubCount > 8 ? 30 : 10;
        playback.scrub = Math.max(0, Math.min(playback.duration - 1, (playback.scrub === null ? playback.seconds : playback.scrub) + delta * step));
        showBar(); paintTimeline(); document.getElementById('timeline').focus();
    }
    function cancelScrub() { if (playback) { playback.scrub = null; scrubCount = 0; paintTimeline(); showBar(); } }
    function closeTrackMenu(refocus) {
        if (playback && playback.trackChange) playback.trackChange.cancel();
        ++menuSerial; document.getElementById('track-menu').className = 'hidden'; document.getElementById('track-scrim').className = 'hidden';
        if (playback) {
            if (refocus !== false) {
                if (document.getElementById(menuReturn).disabled) playback.menuFocus = menuReturn;
                else document.getElementById(menuReturn).focus();
            }
            showBar();
        }
    }
    function openPlayerMenu(title, returnTo) {
        if (!playback) return null;
        if (playback.trackChange) playback.trackChange.cancel();
        ++menuSerial; menuReturn = returnTo;
        var menu = document.getElementById('track-menu'); menu.textContent = ''; menu.className = ''; menu.setAttribute('aria-label', title);
        document.getElementById('track-scrim').className = '';
        var head = node('div', null, 'track-head'); head.appendChild(node('h2', title)); menu.appendChild(head);
        var close = button('Close', function () { closeTrackMenu(); }, head); close.className = 'menu-close';
        var body = node('div', null, 'track-body'); menu.appendChild(body); showBar(); return body;
    }
    function timeMenu() {
        var body = openPlayerMenu('Go to time', 'jump'); if (!body) return;
        var form = node('form'), label = node('label', 'Time (HH:MM:SS or MM:SS)'), field = document.createElement('input');
        field.id = 'seek-time'; label.htmlFor = field.id; field.type = 'text'; field.value = formatTime(playback.seconds); field.setAttribute('inputmode', 'numeric');
        form.appendChild(label); form.appendChild(field); var submit = node('button', 'Go to time'); submit.type = 'submit'; form.appendChild(submit); body.appendChild(form);
        var hint = message('Duration: ' + formatTime(playback.duration), false, body);
        form.onsubmit = function (event) {
            event.preventDefault(); var value = C.parseTime(field.value);
            if (value === null || !playback || !isFinite(playback.duration) || value >= playback.duration) { hint.textContent = 'Enter a valid time before the end of this video.'; hint.className = 'error'; return; }
            if (seekToSeconds(value)) closeTrackMenu();
        };
        field.focus();
    }
    function trackNotice(body, text) {
        var menu = body.parentNode, note = menu.querySelector('[data-track-notice]');
        if (!note) { note = node('p', '', 'muted'); note.setAttribute('data-track-notice', ''); note.setAttribute('role', 'status'); menu.insertBefore(note, body); }
        note.className = 'muted'; note.textContent = text; playerMenuVisible(document.activeElement); return note;
    }
    function nativeTrackIndex(type) {
        var tracks = nativePlayer().getCurrentStreamInfo(), selected = null;
        tracks.forEach(function (track) { if (track.type === type && isFinite(Number(track.index)) && Number(track.index) >= 0) selected = Number(track.index); });
        return selected;
    }
    function switchNativeTrack(type, trackIndex, body, done) {
        if (!playback || playback.trackChange) return;
        var owner = playback, av = nativePlayer(), generation = playbackEpoch, serial = menuSerial;
        var index = Number(trackIndex), started = Date.now(), selectedAt = 0, tries = 0, resumed = false;
        var wasPaused = owner.paused, note = trackNotice(body, 'Switching ' + (type === 'AUDIO' ? 'audio' : 'subtitles') + '… Waiting for the TV.');
        note.setAttribute('role', 'status'); body.setAttribute('aria-busy', 'true');
        var change = {timer: null, cancel: function () { finish(null, true); }}; owner.trackChange = change;
        function current() { return playback === owner && playbackEpoch === generation && menuSerial === serial && owner.trackChange === change && !owner.failed; }
        function state() { return typeof av.getState === 'function' ? av.getState() : resumed ? 'PLAYING' : owner.paused ? 'PAUSED' : 'PLAYING'; }
        function later(fn, delay) { clearTimeout(change.timer); change.timer = setTimeout(function () { if (current()) fn(); }, delay); }
        function restorePause() {
            if (!resumed || !wasPaused || playback !== owner || owner.failed) return;
            av.pause(); owner.paused = true; owner.lastProgressAt = Date.now(); paintPause();
        }
        function finish(error, cancelled) {
            if (owner.trackChange !== change) return;
            clearTimeout(change.timer); owner.trackChange = null; body.removeAttribute('aria-busy');
            try { restorePause(); } catch (pauseError) { error = 'The TV could not restore pause. Use Pause / play.'; }
            if (cancelled || playback !== owner || generation !== playbackEpoch || serial !== menuSerial) return;
            if (error) {
                // If a late or ignored request left the old track active, show its actual selection.
                try { var actual = nativeTrackIndex(type); Array.prototype.forEach.call(body.querySelectorAll('[data-native-track]'), function (b) {
                    var selected = actual !== null && Number(b.getAttribute('data-native-track')) === actual;
                    b.setAttribute('aria-checked', String(selected)); b.className = 'track-choice' + (selected ? ' selected' : '');
                    var badge = b.querySelector('.track-selected'); if (badge) b.removeChild(badge); if (selected) b.appendChild(node('span', 'Selected by TV', 'track-selected'));
                }); } catch (ignored) {}
                note.textContent = error; note.className = 'error'; playbackStatus('Track switch was not confirmed. See the open menu.'); return;
            }
            done();
        }
        function reportFailure(error) {
            var name = error && error.name; name = /^[A-Za-z][A-Za-z0-9_]{1,50}$/.test(String(name || '')) ? ' (' + name + ')' : '';
            finish('The TV did not apply this track' + name + '. Try another track or source.');
        }
        function verify() {
            if (!current()) return;
            var actual;
            try { actual = nativeTrackIndex(type); } catch (readError) { actual = null; }
            if (actual === index) {
                // Allow a short settling period before restoring the viewer's pause.
                if (resumed && wasPaused && Date.now() - selectedAt < 350) return later(verify, 100);
                return finish();
            }
            if (Date.now() - selectedAt >= 2200) return finish('The TV did not confirm this track. Requested ' + index + '; TV reports ' + (actual === null ? 'no readable track' : actual) + '. Try another source.');
            if (tries === 1 && Date.now() - selectedAt >= 650) {
                try { if (type !== 'AUDIO' || state() === 'PLAYING') { av.setSelectTrack(type, index); tries++; } } catch (retryError) { return reportFailure(retryError); }
            }
            later(verify, 100);
        }
        function select() {
            if (!current()) return;
            try {
                var available = av.getTotalTrackInfo().some(function (track) { return track.type === type && Number(track.index) === index; });
                if (!available || !isFinite(index) || index < 0 || Math.floor(index) !== index) return finish('This track is no longer available. Close and reopen the menu.');
                av.setSelectTrack(type, index); tries = 1; selectedAt = Date.now(); later(verify, 100);
            } catch (selectError) { reportFailure(selectError); }
        }
        function waitPlaying() {
            try { if (state() === 'PLAYING') return select(); } catch (stateError) { return reportFailure(stateError); }
            if (Date.now() - started >= 1500) return finish('The TV did not resume for the audio change. Press Play and try again.');
            later(waitPlaying, 100);
        }
        try {
            var nativeState = state(); wasPaused = owner.paused || nativeState === 'PAUSED';
            if (type === 'AUDIO' && nativeState !== 'PLAYING') { resumed = true; av.play(); later(waitPlaying, 100); }
            else select();
        } catch (startError) { reportFailure(startError); }
    }
    function rememberLanguage(kind, language) {
        if (language && language !== 'Unknown language') save(kind === 'audio' ? 'lastAudio' : 'lastSubtitle', language);
    }
    function preferredLanguage(kind) {
        var pref = read(kind === 'audio' ? 'audioLanguage' : 'subtitleLanguage', 'last');
        return pref === 'last' ? read(kind === 'audio' ? 'lastAudio' : 'lastSubtitle', '') : pref === 'default' ? '' : pref;
    }
    function applyLanguagePrefs() {
        if (!playback || playback.languagesApplied || playback.preparing || playback.failed) return;
        playback.languagesApplied = true;
        var owner = playback, audio = preferredLanguage('audio'), subtitle = preferredLanguage('subtitles'), notes = [];
        function note(text) { notes.push(text); if (playback === owner && !owner.paused && !owner.seeking) playbackStatus('Playing · ' + notes.join(' · ')); }
        if (owner.native && audio) autoNativeTrack(owner, 'AUDIO', audio, note);
        if (subtitle === 'off') { owner.subtitleChoice = 'off'; document.getElementById('subtitle').textContent = ''; }
        else if (subtitle) autoSubtitle(owner, subtitle, note);
    }
    function autoNativeTrack(owner, type, language, note, attempt) {
        var av = nativePlayer(), tracks, index, wanted;
        if (playback !== owner || owner.failed || owner.trackChange) return;
        try {
            tracks = av.getTotalTrackInfo().filter(function (t) { return t.type === type; });
            index = C.pickLanguage(tracks, language, C.trackLanguage);
            if (index < 0) { if (type === 'AUDIO' && tracks.length > 1) note(language + ' audio not in this file'); return; }
            wanted = Number(tracks[index].index);
            if (nativeTrackIndex(type) === wanted) { if (type === 'TEXT') owner.subtitleChoice = 'track:' + wanted; return; }
            // Samsung applies audio changes only while playing.
            if (type === 'AUDIO' && typeof av.getState === 'function' && av.getState() !== 'PLAYING') {
                if ((attempt || 0) < 10) setTimeout(function () { autoNativeTrack(owner, type, language, note, (attempt || 0) + 1); }, 500);
                return;
            }
            av.setSelectTrack(type, wanted);
            if (type === 'TEXT') { owner.subtitleChoice = 'track:' + wanted; note(language + ' subtitles'); return; }
            setTimeout(function () {
                if (playback !== owner) return;
                try {
                    if (nativeTrackIndex('AUDIO') === wanted) return note(language + ' audio');
                    if (!attempt) return autoNativeTrack(owner, type, language, note, 1);
                } catch (e) {}
                note(language + ' audio could not be selected');
            }, 900);
        } catch (e) {}
    }
    function autoSubtitle(owner, language, note) {
        if (owner.native) {
            try {
                var embedded = nativePlayer().getTotalTrackInfo().filter(function (t) { return t.type === 'TEXT'; });
                if (C.pickLanguage(embedded, language, C.trackLanguage) >= 0) return autoNativeTrack(owner, 'TEXT', language, note);
            } catch (e) {}
        }
        var candidates = (owner.stream.subtitles || []).map(function (sub) { return {sub: sub, provider: 'This source'}; }), providers;
        function pickAddonSubtitle() {
            var index = C.pickLanguage(candidates, language, function (entry) { return C.languageName(entry.sub.lang || entry.sub.language); });
            if (index < 0) return false;
            var sub = candidates[index].sub, requestId = owner.subtitleRequest = (owner.subtitleRequest || 0) + 1;
            request(sub.url, null, function (err, text) {
                if (playback !== owner || owner.subtitleRequest !== requestId || owner.subtitleChoice !== 'default' || err) return;
                var parsed = C.subtitleCues(text); if (!parsed.length) return;
                cues = parsed; owner.subtitleChoice = sub.url; owner.nativeCue = null; note(language + ' subtitles');
                updateTime(owner.seconds, owner.duration);
            }, true);
            return true;
        }
        if (pickAddonSubtitle()) return;
        providers = addons.filter(function (a) { return C.supports(a, 'subtitles', owner.meta.type, owner.id); });
        var pending = providers.length, hints = owner.stream.behaviorHints || {}, extra = {};
        ['videoHash', 'videoSize', 'filename'].forEach(function (key) { if (hints[key]) extra[key] = hints[key]; });
        providers.forEach(function (a) {
            request(C.resourceURL(a, 'subtitles', owner.meta.type, owner.id, extra), null, function (err, data) {
                if (playback !== owner) return;
                if (!err) (data.subtitles || []).slice(0, 40).forEach(function (sub) {
                    if (!/^https?:\/\//i.test(sub.url || '')) return;
                    owner.subtitleSources.push({sub: sub, provider: a.manifest.name}); candidates.push({sub: sub, provider: a.manifest.name});
                });
                // Wait for every addon so the menu does not refetch, then pick the first match in addon order.
                if (!--pending && !pickAddonSubtitle()) note('no ' + language + ' subtitles found');
            });
        });
        if (!pending) note('no ' + language + ' subtitles found');
    }
    function trackMenu(kind) {
        kind = kind === 'audio' ? 'audio' : 'subtitles';
        var body = openPlayerMenu(kind === 'audio' ? 'Audio' : 'Subtitles', kind === 'audio' ? 'audio' : 'tracks'); if (!body) return;
        var mine = playbackEpoch, menu = menuSerial, video = document.getElementById('video'), type = kind === 'audio' ? 'AUDIO' : 'TEXT';
        function current() { return playback && playbackEpoch === mine && menuSerial === menu; }
        if (playback.preparing || playback.seeking) { message('Tracks are available once the video is ready.', false, body); focusFirst(document.getElementById('track-menu')); return; }
        if (kind === 'audio' && !playback.native) { message('Audio tracks can only be switched in the installed Stremio Lite app, which uses Samsung AVPlay. This browser player plays the default track.', false, body); focusFirst(document.getElementById('track-menu')); return; }
        var list = node('div', null, 'track-options'); list.setAttribute('role', 'radiogroup'); list.setAttribute('aria-label', kind === 'audio' ? 'Audio tracks' : 'Subtitle tracks'); body.appendChild(list);
        function choice(title, detail, selected, action) {
            var b = button('', action, list); b.className = 'track-choice' + (selected ? ' selected' : ''); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(!!selected));
            b.appendChild(node('span', title, 'track-name')); b.appendChild(node('small', detail));
            if (selected) b.appendChild(node('span', 'Selected', 'track-selected'));
            return b;
        }
        function focusChoice() { var chosen = list.querySelector('[aria-checked="true"]'); if (chosen) chosen.focus(); else focusFirst(list.children.length ? list : document.getElementById('track-menu')); }
        function disableText() {
            cues = []; playback.nativeCue = null; document.getElementById('subtitle').textContent = ''; clearTimeout(subtitleTimer);
            if (playback.native) { try { nativePlayer().setSilentSubtitle(true); } catch (e) {} }
            else if (video.textTracks) for (var i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = 'disabled';
        }
        if (kind === 'subtitles') choice('Off', 'No subtitles', playback.subtitleChoice === 'off', function () {
            playback.subtitleRequest = (playback.subtitleRequest || 0) + 1; disableText(); playback.subtitleChoice = 'off'; rememberLanguage('subtitles', 'off'); closeTrackMenu(); playbackStatus('Subtitles off');
        });
        var tracks = [], selectedIndex = null;
        if (playback.native) {
            try { tracks = nativePlayer().getTotalTrackInfo().filter(function (t) { return t.type === type; }); } catch (e) {}
            try { nativePlayer().getCurrentStreamInfo().forEach(function (t) { if (t.type === type) selectedIndex = Number(t.index); }); } catch (e) {}
        } else {
            if (video.textTracks) for (var i = 0; i < video.textTracks.length; i++) {
                var t = video.textTracks[i]; if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
                tracks.push({index: i, language: t.language, label: t.label});
                if (t.mode === 'showing') selectedIndex = i;
            }
        }
        tracks.forEach(function (track, index) {
            var title = C.trackLabel(track).replace(/^Unknown language/, (kind === 'audio' ? 'Audio track ' : 'Subtitle track ') + (index + 1));
            var selected = kind === 'audio' ? selectedIndex === Number(track.index) : (playback.subtitleChoice === 'default' || /^track:/.test(playback.subtitleChoice)) && selectedIndex === Number(track.index);
            var control = choice(title, kind === 'audio' ? 'Embedded audio' : 'Embedded subtitles', selected, function () {
                if (!current() || playback.trackChange) return;
                if (kind === 'subtitles') playback.subtitleRequest = (playback.subtitleRequest || 0) + 1;
                function applied() {
                    if (!current()) return;
                    rememberLanguage(kind, C.trackLanguage(track));
                    if (kind === 'subtitles') { disableText(); playback.subtitleChoice = 'track:' + Number(track.index); }
                    closeTrackMenu(); playbackStatus((kind === 'audio' ? 'Audio selected by TV: ' : 'Subtitle track selected by TV: ') + title);
                }
                if (playback.native) return switchNativeTrack(type, track.index, body, applied);
                try {
                    var textTracks = video.textTracks;
                    if (!textTracks || !textTracks[track.index]) throw new Error('Track unavailable');
                    disableText(); textTracks[track.index].mode = 'showing';
                    if (textTracks[track.index].mode !== 'showing') throw new Error('Track unchanged');
                    playback.subtitleChoice = 'track:' + track.index; rememberLanguage('subtitles', C.languageName(track.language));
                    closeTrackMenu(); playbackStatus('Subtitles: ' + title);
                } catch (error) { message('The browser did not apply this track. Try another source.', true, body); }
            });
            control.setAttribute('data-native-track', String(track.index));
        });
        if (kind === 'audio') {
            if (!tracks.length) message('No switchable audio tracks are exposed by this stream and player. Choose a source with your preferred language.', false, body);
            focusChoice(); return;
        }
        var seen = {}, pending = 0, note = trackNotice(body, 'Loading addon subtitles…');
        function subtitleButton(sub, provider) {
            if (!/^https?:\/\//i.test(sub.url || '') || seen[sub.url]) return; seen[sub.url] = true;
            choice(C.languageName(sub.lang || sub.language), 'Addon subtitles · ' + (provider || 'Stream'), playback.subtitleChoice === sub.url, function () {
                if (!current() || playback.trackChange) return;
                var requestId = playback.subtitleRequest = (playback.subtitleRequest || 0) + 1; note.textContent = 'Loading selected subtitles…';
                request(sub.url, null, function (err, text) {
                    if (!current() || playback.subtitleRequest !== requestId) return;
                    if (err) { note.textContent = err.message; note.className = 'error'; return; }
                    var parsed = C.subtitleCues(text);
                    if (!parsed.length) { note.textContent = 'Use an SRT or WebVTT subtitle file.'; note.className = 'error'; return; }
                    disableText(); cues = parsed; playback.subtitleChoice = sub.url; rememberLanguage('subtitles', C.languageName(sub.lang || sub.language));
                    closeTrackMenu(); playbackStatus('External subtitles enabled.'); updateTime(playback.seconds, playback.duration);
                }, true);
            });
        }
        (playback.stream.subtitles || []).forEach(function (sub) { subtitleButton(sub, 'This source'); });
        if (playback.subtitleSources.length) playback.subtitleSources.forEach(function (entry) { subtitleButton(entry.sub, entry.provider); });
        else addons.filter(function (a) { return C.supports(a, 'subtitles', playback.meta.type, playback.id); }).forEach(function (a) {
            pending++;
            var hints = playback.stream.behaviorHints || {}, extra = {};
            ['videoHash', 'videoSize', 'filename'].forEach(function (key) { if (hints[key]) extra[key] = hints[key]; });
            request(C.resourceURL(a, 'subtitles', playback.meta.type, playback.id, extra), null, function (err, data) {
                if (!current()) return;
                if (!err) (data.subtitles || []).slice(0, 40).forEach(function (sub) {
                    playback.subtitleSources.push({sub: sub, provider: a.manifest.name}); subtitleButton(sub, a.manifest.name);
                });
                pending--; if (!pending) note.textContent = Object.keys(seen).length ? 'Select a language to apply it.' : 'No addon subtitles returned for this video.';
            });
        });
        if (!pending) note.textContent = Object.keys(seen).length ? 'Select a language to apply it.' : 'No addon subtitles returned for this video.';
        var adjustments = node('div', null, 'subtitle-adjustments'); body.appendChild(adjustments); adjustments.appendChild(node('h3', 'Appearance'));
        var sizeButtons = [];
        [['Small', 28], ['Medium', 36], ['Large', 44]].forEach(function (entry) {
            var b = button(entry[0], function () {
                save('subtitleSize', entry[1]); document.getElementById('subtitle').style.fontSize = entry[1] + 'px';
                sizeButtons.forEach(function (item) { item.button.setAttribute('aria-pressed', String(item.size === entry[1])); });
            }, adjustments);
            b.setAttribute('aria-label', entry[0] + ' subtitle text');
            b.setAttribute('aria-pressed', String(Number(read('subtitleSize', 36)) === entry[1])); sizeButtons.push({size: entry[1], button: b});
        });
        adjustments.appendChild(node('h3', 'Subtitle timing'));
        var offset = message('', false, adjustments);
        function shift(delta) {
            if (!current()) return;
            playback.subtitleOffset = Math.max(-30, Math.min(30, playback.subtitleOffset + delta)); save('subtitleOffset', playback.subtitleOffset);
            offset.textContent = 'Addon subtitles: ' + (playback.subtitleOffset > 0 ? '+' : '') + playback.subtitleOffset.toFixed(1) + 's'; updateTime(playback.seconds, playback.duration);
        }
        offset.textContent = 'Addon subtitles: ' + (playback.subtitleOffset > 0 ? '+' : '') + playback.subtitleOffset.toFixed(1) + 's';
        button('Earlier 0.5s', function () { shift(-0.5); }, adjustments); button('Later 0.5s', function () { shift(0.5); }, adjustments);
        button('Reset timing', function () { shift(-playback.subtitleOffset); }, adjustments);
        message('Timing adjusts addon subtitle files; embedded track timing is controlled by the TV.', false, adjustments);
        focusChoice(); showBar();
    }
    function visibleHomeRows() {
        return Array.prototype.slice.call(view.querySelectorAll('.catalog-row')).filter(function (section) { return section.offsetWidth && section.offsetHeight; });
    }
    function focusHomeHero() {
        var hero = view.querySelector('.feature-copy button:not([disabled])');
        var target = hero || view.querySelector('.discover-filters .selected') || view.querySelector('.discover-filters button');
        if (target) target.focus(); window.scrollTo(0, 0);
    }
    function focusHomeRow(section, card) {
        var track = section.querySelector('.shelf-track'), choices = Array.prototype.slice.call(track.querySelectorAll('[data-card-index]'));
        track.setAttribute('data-focus-card', String(card || 0));
        var target = choices[Math.min(card || 0, choices.length - 1)] || track.querySelector('button:not([disabled])');
        if (!target) { track.tabIndex = -1; target = track; }
        target.focus(); ensureVisible(target); if (homeScroll) homeScroll();
    }
    function homeFocus(code) {
        if (playback || view.className !== 'discover-view') return false;
        var active = document.activeElement, navBox = document.getElementById('nav'), hero = view.querySelector('.discover-hero'), filters = view.querySelector('.discover-filters');
        var rows = visibleHomeRows(), target, choices, index, track = active;
        function firstRow() {
            if (rows.length) focusHomeRow(rows[0], discoverState.card);
            else { target = view.querySelector('.catalog-shelves button:not([disabled])'); if (target) { target.focus(); ensureVisible(target); } }
        }
        if (navBox.contains(active)) {
            if (code === 40) focusHomeHero();
            else if (code === 37 || code === 39) {
                choices = Array.prototype.slice.call(navBox.querySelectorAll('button')); target = choices[choices.indexOf(active) + (code === 37 ? -1 : 1)]; if (target) target.focus();
            }
            return true;
        }
        if (hero.contains(active)) {
            if (code === 38) document.querySelector('#nav [aria-current="page"]').focus();
            else if (code === 40) firstRow();
            else if (code === 39) { (filters.querySelector('.selected') || filters.querySelector('button')).focus(); window.scrollTo(0, 0); }
            return true;
        }
        if (filters.contains(active)) {
            if (code === 38) focusHomeHero();
            else if (code === 40) firstRow();
            else {
                choices = Array.prototype.slice.call(filters.querySelectorAll('button')); target = choices[choices.indexOf(active) + (code === 37 ? -1 : 1)];
                if (target) target.focus(); else if (code === 37) focusHomeHero();
            }
            return true;
        }
        while (track && track !== view && track.className !== 'shelf-track') track = track.parentNode;
        if (!track || track === view) return false;
        choices = Array.prototype.slice.call(track.querySelectorAll('button:not([disabled])'));
        if (code === 37 || code === 39) {
            target = choices[choices.indexOf(active) + (code === 37 ? -1 : 1)];
            if (target) { target.focus(); ensureVisible(target); } return true;
        }
        index = rows.indexOf(track.parentNode); target = rows[index + (code === 38 ? -1 : 1)];
        if (target) focusHomeRow(target, Number(track.getAttribute('data-focus-card')) || 0);
        else if (code === 38) focusHomeHero();
        return true;
    }
    function playerMenuVisible(el) {
        var body = document.querySelector('#track-menu .track-body'); if (!body || !body.contains(el)) return;
        var rect = el.getBoundingClientRect(), area = body.getBoundingClientRect();
        if (rect.top < area.top + 8) body.scrollTop += rect.top - area.top - 8;
        else if (rect.bottom > area.bottom - 8) body.scrollTop += rect.bottom - area.bottom + 8;
    }
    function playerFocus(code, menuOpen) {
        var active = document.activeElement, target, index, choices;
        if (menuOpen) {
            var menu = document.getElementById('track-menu');
            choices = Array.prototype.slice.call(menu.querySelectorAll('button:not([disabled]),input:not([disabled])')).filter(function (el) { return el.offsetWidth && el.offsetHeight; });
            index = choices.indexOf(active);
            if (index < 0) target = choices[0];
            else if (code === 38 || code === 40) target = choices[index + (code === 38 ? -1 : 1)];
            else {
                var sibling = choices[index + (code === 37 ? -1 : 1)];
                if (sibling && sibling.parentNode === active.parentNode && Math.abs(sibling.getBoundingClientRect().top - active.getBoundingClientRect().top) < 10) target = sibling;
            }
            if (target) { target.focus(); playerMenuVisible(target); } return;
        }
        if (playback.failed) {
            choices = [document.getElementById('player-retry'), document.getElementById('player-error-back')].filter(function (el) { return el.offsetWidth && !el.disabled; });
            index = choices.indexOf(active); target = choices[index + (code === 37 || code === 38 ? -1 : 1)];
            if (index < 0) target = choices[0]; if (target) target.focus(); return;
        }
        var timeline = document.getElementById('timeline'), back = document.getElementById('player-back');
        choices = Array.prototype.slice.call(document.querySelectorAll('#player-controls button:not([disabled])'));
        index = choices.indexOf(active);
        var remembered = document.getElementById(playback.controlFocus || 'pause');
        if (!remembered || remembered.disabled) remembered = choices[0] || back;
        if (index >= 0) {
            playback.controlFocus = active.id;
            if (code === 37 || code === 39) target = choices[index + (code === 37 ? -1 : 1)];
            else if (code === 38) target = timeline.disabled ? back : timeline;
        } else if (active === timeline) {
            if (code === 38) target = back;
            else if (code === 40) { cancelScrub(); target = remembered; }
        } else if (active === back) { if (code === 40) target = timeline.disabled ? remembered : timeline; }
        else target = code === 38 ? back : remembered;
        if (target) { target.focus(); if (choices.indexOf(target) >= 0) playback.controlFocus = target.id; }
    }
    function settingsPanel(el) {
        while (el && el !== view) { if (el.getAttribute && el.getAttribute('data-settings-section')) return el; el = el.parentNode; }
        return null;
    }
    document.addEventListener('focusin', function (e) {
        if (playback) {
            if (document.getElementById('player-controls').contains(e.target)) playback.controlFocus = e.target.id;
            if (document.getElementById('track-menu').contains(e.target)) playerMenuVisible(e.target);
            return;
        }
        if (view.className !== 'settings-view') return;
        var panel = settingsPanel(e.target), id = panel ? panel.getAttribute('data-settings-section') : e.target.getAttribute('data-settings-target');
        if (!id) return;
        Array.prototype.forEach.call(view.querySelectorAll('[data-settings-target]'), function (b) {
            var selected = b.getAttribute('data-settings-target') === id;
            b.className = selected ? 'selected' : ''; b.setAttribute('aria-current', selected ? 'true' : 'false');
        });
    });
    function settingsFocus(code) {
        if (view.className !== 'settings-view' || playback) return false;
        var active = document.activeElement, menu = view.querySelector('.settings-sections'), panel = settingsPanel(active);
        var entries = Array.prototype.slice.call(menu.querySelectorAll('button')), index = entries.indexOf(active), target;
        if (index >= 0) {
            if (code === 38) target = entries[index - 1] || document.querySelector('#nav [aria-current="page"]');
            else if (code === 40) target = entries[index + 1];
            else if (code === 39) { active.click(); return true; }
            if (target) target.focus(); return true;
        }
        if (!panel) {
            if (code === 40 && document.getElementById('nav').contains(active)) { (menu.querySelector('.selected') || entries[0]).focus(); return true; }
            return false;
        }
        var controls = Array.prototype.slice.call(view.querySelectorAll('.settings-content button:not([disabled]),.settings-content input:not([disabled]),.settings-content select:not([disabled])')).filter(function (el) { return el.offsetWidth && el.offsetHeight; });
        index = controls.indexOf(active);
        if (code === 38 || code === 40) {
            target = controls[index + (code === 38 ? -1 : 1)];
            if (!target && code === 38) target = entries[0];
        } else {
            var rect = active.getBoundingClientRect(), step = code === 37 ? -1 : 1, candidate = controls[index + step];
            if (candidate && settingsPanel(candidate) === panel && Math.abs(candidate.getBoundingClientRect().top - rect.top) < 10) target = candidate;
            else if (code === 37) target = menu.querySelector('[data-settings-target="' + panel.getAttribute('data-settings-section') + '"]');
        }
        if (target) { target.focus(); if (!menu.contains(target)) ensureVisible(target); }
        return true;
    }
    function moveFocus(code, scope) {
        if (settingsFocus(code) || homeFocus(code)) return;
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
            best.focus(); if (!playback) ensureVisible(best);
        }
    }
    function ensureVisible(el) {
        if (!el || document.getElementById('nav').contains(el) || (el.parentNode && el.parentNode.className === 'settings-sections')) return;
        var r = el.getBoundingClientRect(), top = document.querySelector('header').getBoundingClientRect().bottom + 12;
        if (r.bottom > window.innerHeight - 50) window.scrollBy(0, r.bottom - window.innerHeight + 50);
        else if (r.top < top) window.scrollBy(0, r.top - top);
    }
    window.addEventListener('scroll', function () {
        if (!homeScroll || discoverTick) return;
        discoverTick = setTimeout(function () { discoverTick = null; if (homeScroll) homeScroll(); }, 100);
    });
    document.getElementById('pause').onclick = function () { togglePause(); };
    document.getElementById('stop').onclick = stopPlayback;
    document.getElementById('player-back').onclick = stopPlayback;
    document.getElementById('player-error-back').onclick = stopPlayback;
    document.getElementById('rewind').onclick = function () { seek(-10); };
    document.getElementById('forward').onclick = function () { seek(10); };
    document.getElementById('tracks').onclick = function () { trackMenu('subtitles'); };
    document.getElementById('audio').onclick = function () { trackMenu('audio'); };
    document.getElementById('jump').onclick = timeMenu;
    document.getElementById('track-scrim').onclick = function () { closeTrackMenu(); };
    document.getElementById('timeline').oninput = function () {
        if (!playback || playback.preparing || playback.seeking) return;
        playback.scrub = Number(this.value); paintTimeline(); showBar();
    };
    document.getElementById('timeline').onchange = function () { if (playback && playback.scrub !== null) seekToSeconds(playback.scrub); };
    document.getElementById('player').onmousemove = function () { if (playback && document.getElementById('player-chrome').className === 'hidden') showBar(); };
    document.addEventListener('keydown', function (e) {
        var code = e.keyCode, tag = document.activeElement && document.activeElement.tagName;
        if (code === 10009 || code === 27 || (code === 8 && tag !== 'INPUT')) {
            e.preventDefault(); if (playback && playback.next && document.getElementById('next-episode').className !== 'hidden') cancelNextEpisode(playback);
            else if (playback && document.getElementById('track-menu').className !== 'hidden') closeTrackMenu();
            else if (playback && playback.scrub !== null) cancelScrub();
            else if (!playback && view.className === 'settings-view' && settingsPanel(document.activeElement)) {
                var p = settingsPanel(document.activeElement); view.querySelector('[data-settings-target="' + p.getAttribute('data-settings-section') + '"]').focus();
            } else if (!playback && view.className === 'settings-view' && view.querySelector('.settings-sections').contains(document.activeElement)) document.querySelector('#nav [aria-current="page"]').focus();
            else goBack(); return;
        }
        if (playback && document.getElementById('next-episode').className !== 'hidden') {
            var nextBox = document.getElementById('next-episode');
            if (code === 13 && nextBox.contains(document.activeElement)) { e.preventDefault(); document.activeElement.click(); return; }
            if (code === 37 || code === 39) { e.preventDefault(); document.getElementById(document.activeElement && document.activeElement.id === 'next-play' ? 'next-cancel' : 'next-play').focus(); return; }
            if (code === 38 || code === 40) { e.preventDefault(); document.getElementById('next-play').focus(); return; }
        }
        if (playback) {
            var menuOpen = document.getElementById('track-menu').className !== 'hidden';
            var chromeHidden = document.getElementById('player-chrome').className === 'hidden';
            var timeline = document.getElementById('timeline'), onTimeline = document.activeElement === timeline;
            showBar();
            if (!menuOpen && !playback.failed) {
                if (chromeHidden && code === 13) { e.preventDefault(); document.getElementById(playback.controlFocus || 'pause').focus(); return; }
                if ((code === 37 || code === 39) && (onTimeline || chromeHidden)) { e.preventDefault(); scrub(code === 37 ? -1 : 1); return; }
                if (onTimeline && code === 13) { e.preventDefault(); if (playback.scrub !== null) seekToSeconds(playback.scrub); else togglePause(); return; }
                if (chromeHidden && code === 40) { e.preventDefault(); document.getElementById(playback.controlFocus || 'pause').focus(); return; }
            }
            if (code >= 37 && code <= 40 && !(tag === 'INPUT' && document.activeElement !== timeline && (code === 37 || code === 39))) {
                e.preventDefault(); playerFocus(code, menuOpen); return;
            }
            if ([10252, 415, 19, 413, 417, 412].indexOf(code) >= 0) {
                e.preventDefault();
                if (code === 413) stopPlayback(); else if (code === 417) seek(30); else if (code === 412) seek(-30); else togglePause(code === 415 ? false : code === 19 ? true : undefined);
                return;
            }
        }
        if (code >= 37 && code <= 40 && !(tag === 'INPUT' && (code === 37 || code === 39)) && !(tag === 'SELECT' && (code === 38 || code === 40))) {
            e.preventDefault(); var menu = document.getElementById('track-menu');
            moveFocus(code, playback ? (menu.className === 'hidden' ? document.getElementById('player-chrome') : menu) : document.getElementById('shell'));
        }
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden && playback) togglePause(true); });
    window.addEventListener('beforeunload', function () { if (playback) storeProgress(true); cancelLink(); });
    try { ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward'].forEach(function (key) { tizen.tvinputdevice.registerKey(key); }); } catch (e) {}
    function syncAccountProgress() {
        if (!authKey) return;
        var before = JSON.stringify(continueWatching());
        loadLibrary(function (err) {
            // Repaint Home only while the viewer is not browsing its rows.
            if (!err && !playback && view.className === 'discover-view' && JSON.stringify(continueWatching()) !== before && !view.querySelector('.shelf-track button:focus')) home(true);
        });
    }
    function start(attempt) {
        if (PACKAGED) { home(); syncAccountProgress(); return checkForUpdate(false, announceUpdate); }
        xhr('GET', SERVICE + '/health', null, function (err, data) {
            if (!err && data && data.token) session = data.token;
            else if (attempt < 3) return setTimeout(function () { start(attempt + 1); }, 600);
            home(); syncAccountProgress();
        });
    }
    start(0);
}());
