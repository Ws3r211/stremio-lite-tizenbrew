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
    function isLocalFiles(addon) {
        return !!addon && ((addon.manifest || {}).id === 'org.stremio.local' ||
            /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):11470\/local-addon\/manifest\.json\/?$/i.test(addon.transportUrl || ''));
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
    function streamInfo(stream) {
        var hints = stream.behaviorHints || {}, text = [stream.name, stream.title, stream.description, hints.filename].join(' ');
        var tags = [], warnings = [], match, mbps = 0;
        if (/(?:2160p|\b4k\b|\buhd\b)/i.test(text)) tags.push('4K');
        else if (/1080p/i.test(text)) tags.push('1080p');
        else if (/720p/i.test(text)) tags.push('720p');
        if (/(?:hevc|h[ .-]?265|x265)/i.test(text)) tags.push('HEVC');
        else if (/(?:avc|h[ .-]?264|x264)/i.test(text)) tags.push('H.264');
        if (/(?:\bdv\b|\bdovi\b|dolby[ .-]?vision)/i.test(text)) {
            tags.push('Dolby Vision'); warnings.push('Dolby Vision is unsupported on this TV. A hybrid file may have an HDR10 base layer; prefer HDR10 or SDR.');
        }
        if (/hdr10\+/i.test(text)) tags.push('HDR10+');
        else if (/hdr10|\bhdr\b/i.test(text)) tags.push('HDR');
        match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:mbps|mbit\/s|mb\/s)\b/i);
        if (match) { mbps = Number(match[1].replace(',', '.')); tags.push(mbps + ' Mbps'); }
        if (hints.videoSize > 0) tags.push((hints.videoSize / 1000000000).toFixed(1) + ' GB');
        else { match = text.match(/\b(\d+(?:[.,]\d+)?)\s*(gb|gib)\b/i); if (match) tags.push(match[1] + ' ' + match[2].toUpperCase()); }
        if (mbps >= 20) warnings.push('Higher bitrate: needs steady bandwidth with room for peaks. Try a lower-bitrate source if it buffers.');
        return {tags: tags, warnings: warnings, mbps: mbps};
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
    function languageName(value) {
        var code = String(value || '').toLowerCase().split(/[-_]/)[0];
        var names = {en:'English',eng:'English',nl:'Dutch',nld:'Dutch',dut:'Dutch',de:'German',deu:'German',ger:'German',fr:'French',fra:'French',fre:'French',es:'Spanish',spa:'Spanish',it:'Italian',ita:'Italian',pt:'Portuguese',por:'Portuguese',pl:'Polish',pol:'Polish',tr:'Turkish',tur:'Turkish',ar:'Arabic',ara:'Arabic',ja:'Japanese',jpn:'Japanese',ko:'Korean',kor:'Korean',zh:'Chinese',zho:'Chinese',chi:'Chinese',ru:'Russian',rus:'Russian',uk:'Ukrainian',ukr:'Ukrainian',sv:'Swedish',swe:'Swedish',no:'Norwegian',nor:'Norwegian',da:'Danish',dan:'Danish',fi:'Finnish',fin:'Finnish',hi:'Hindi',hin:'Hindi',und:'Unknown language'};
        return names[code] || (value ? String(value).slice(0, 60) : 'Unknown language');
    }
    function trackLabel(track) {
        var info = track.extra_info || {}, channels, parts;
        if (typeof info === 'string') { try { info = JSON.parse(info); } catch (e) { info = {}; } }
        if (!info || typeof info !== 'object') info = {};
        parts = [languageName(info.language || info.track_lang || track.language)];
        if (track.label) parts.push(String(track.label).slice(0, 100));
        if (info.fourCC) parts.push(({AACL:'AAC',AC3:'Dolby Digital',EAC3:'Dolby Digital Plus'})[info.fourCC] || String(info.fourCC));
        channels = Number(info.channels);
        if (channels === 2) parts.push('Stereo'); else if (channels === 6) parts.push('5.1 surround'); else if (channels === 8) parts.push('7.1 surround'); else if (channels > 0) parts.push(channels + ' channels');
        return parts.join(' · ');
    }
    function parseTime(text) {
        var parts = String(text || '').replace(/^\s+|\s+$/g, '').split(':'), total = 0, i, value;
        if (parts.length < 1 || parts.length > 3) return null;
        for (i = 0; i < parts.length; i++) {
            if (!/^\d+$/.test(parts[i])) return null;
            value = Number(parts[i]);
            if (i > 0 && value >= 60) return null;
            total = total * 60 + value;
        }
        return isFinite(total) ? total : null;
    }
    return {manifestURL: manifestURL, resourceURL: resourceURL, supports: supports, catalogs: catalogs, isLocalFiles: isLocalFiles,
        catalogExtra: catalogExtra, uniqueMetas: uniqueMetas, playable: playable, sortVideos: sortVideos, streamInfo: streamInfo, subtitleCues: subtitleCues,
        languageName: languageName, trackLabel: trackLabel, parseTime: parseTime};
}));
