/* MIT. ES5: shared addon protocol and playback helpers, no WASM dependency. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.StremioLite = factory();
}(this, function () {
    'use strict';
    function manifestURL(value) {
        var s = String(value || '').replace(/^\s+|\s+$/g, '').replace(/^stremio:\/\//i, 'https://');
        if (!/^https?:\/\/[^\s/]+/i.test(s)) throw new Error('Enter an HTTP or HTTPS addon manifest URL.');
        if (/[?#]/.test(s)) throw new Error('Use the manifest URL with configuration in its path, without a query or fragment.');
        return /\/manifest\.json$/i.test(s) ? s : s.replace(/\/$/, '') + '/manifest.json';
    }
    function resourceURL(addon, resource, type, id, extras) {
        var base = manifestURL(addon.transportUrl).replace(/\/manifest\.json$/i, '');
        var out = base + '/' + encodeURIComponent(resource) + '/' + encodeURIComponent(type) + '/' + encodeURIComponent(id);
        var values = [], key;
        for (key in (extras || {})) if (Object.prototype.hasOwnProperty.call(extras, key)) {
            values.push(encodeURIComponent(key) + '=' + encodeURIComponent(extras[key]));
        }
        return out + (values.length ? '/' + values.join('&') : '') + '.json';
    }
    function supports(addon, resource, type, id) {
        var manifest = addon.manifest || {}, resources = manifest.resources || [], i, entry, types, prefixes;
        for (i = 0; i < resources.length; i++) {
            entry = resources[i];
            if ((typeof entry === 'string' ? entry : entry.name) !== resource) continue;
            types = typeof entry === 'object' && entry.types ? entry.types : manifest.types;
            prefixes = typeof entry === 'object' && entry.idPrefixes ? entry.idPrefixes : manifest.idPrefixes;
            if (types && types.indexOf(type) < 0) continue;
            if (prefixes && !prefixes.some(function (prefix) { return String(id).indexOf(prefix) === 0; })) continue;
            return true;
        }
        return false;
    }
    function catalogExtra(catalog, name) {
        return (catalog.extra || []).some(function (item) { return item.name === name; });
    }
    function catalogs(addons, searching) {
        var list = [];
        addons.forEach(function (addon) {
            (addon.manifest.catalogs || []).forEach(function (c) {
                if (searching && !catalogExtra(c, 'search')) return;
                if ((c.extra || []).some(function (x) { return x.isRequired && !(searching && x.name === 'search'); })) return;
                list.push({addon: addon, catalog: c});
            });
        });
        return list;
    }
    function uniqueMetas(items) {
        var seen = {};
        return items.filter(function (x) {
            if (!x || !x.id || !x.type || !x.name) return false;
            var key = x.type + ':' + x.id;
            if (seen[key]) return false;
            seen[key] = true; return true;
        });
    }
    function playable(stream) {
        if (stream && /^https?:\/\//i.test(stream.url || '')) {
            var headers = stream.behaviorHints && stream.behaviorHints.proxyHeaders;
            if (headers && Object.keys(headers.request || {}).length) return {ok: false, reason: 'This source requires HTTP headers. Choose another source; header proxying is not implemented.'};
            return {ok: true, url: stream.url};
        }
        if (stream && (stream.infoHash || /^magnet:/i.test(stream.url || ''))) return {ok: false, reason: 'Torrent source: this client needs a direct HTTP stream from your addon or streaming server.'};
        if (stream && stream.ytId) return {ok: false, reason: 'YouTube source: open this video in your YouTube app.'};
        return {ok: false, reason: 'This source does not provide a directly playable HTTP video URL.'};
    }
    function sortVideos(videos) {
        return (videos || []).slice().sort(function (a, b) {
            return (Number(a.season) || 0) - (Number(b.season) || 0) || (Number(a.episode) || 0) - (Number(b.episode) || 0);
        });
    }
    function subtitleCues(text) {
        var blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/), cues = [];
        function seconds(s) { var parts = s.replace(',', '.').split(':'); return parts.reduce(function (a, p) { return a * 60 + Number(p); }, 0); }
        blocks.forEach(function (block) {
            var lines = block.split('\n'), i, match;
            for (i = 0; i < lines.length; i++) {
                match = lines[i].match(/(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)/);
                if (match) { cues.push({start: seconds(match[1]), end: seconds(match[2]), text: lines.slice(i + 1).join('\n').replace(/<[^>]*>/g, '')}); break; }
            }
        });
        return cues;
    }
    return {manifestURL: manifestURL, resourceURL: resourceURL, supports: supports, catalogs: catalogs,
        catalogExtra: catalogExtra, uniqueMetas: uniqueMetas, playable: playable, sortVideos: sortVideos, subtitleCues: subtitleCues};
}));
