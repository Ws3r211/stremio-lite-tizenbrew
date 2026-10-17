# Stremio Lite for TizenBrew

An experimental, unofficial Stremio-compatible client for older Samsung TVs, targeting the UE49MU7070 with Tizen 3.0. It runs as a TizenBrew **application module** with a small local service. It is a new lightweight client, not a port of the official Stremio app. Physical-TV testing is still required.

## Version 0.2.0: Discover and playback

Discover now presents installed catalogs together in horizontal poster shelves, with custom catalogs first, a cinematic metadata backdrop, and All / Movies / Series filters. The layout follows the selected Editorial Discover visual direction. Real titles, descriptions, posters, and backdrops come from your addons; the concept's fictional artwork is not included. Catalogs load near the viewport with at most two catalog requests at once. Poster images load near the visible part of each shelf, and returning from a title restores the focused poster. A five-minute in-memory catalog cache avoids unnecessary requests when switching filters or returning.

Samsung AVPlay now uses a 10-second initial / 15-second recovery buffer by default. Settings offers Extra buffering (15 / 20 seconds) and TV default. Unsupported buffer APIs fall back without preventing playback. The controls are configured after open and before prepare, as required by Samsung. Startup/recovery may take longer. The HTML5 fallback uses browser-managed buffering. No video proxy, transcoding, or automatic source switching is included.

Stream labels now highlight resolution, codec, Dolby Vision, reported bitrate and size when supplied by the addon. These are label-based hints, not a probe of the actual media. A DV/HDR hybrid may include a playable HDR10 base layer, but Dolby Vision itself is unsupported on this Samsung. Repeated buffering suggests a lower bitrate or a different source; buffer settings cannot fix sustained bandwidth shortages or unsupported codecs. A large file is not automatically unsupported: bitrate, peaks, codec profile, delivery, and available bandwidth matter.

For an initial comparison on the UE49MU7070, try a 1080p H.264/AVC source without Dolby Vision. This is a troubleshooting starting point, not the TV's maximum capability. Samsung's [2017 video specifications](https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2017-tv-video-specifications.html) and [AVPlay buffer API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html#AVPlayManager::setBufferingParam) describe the platform constraints. Actual source playback still requires testing on the TV.

After updating, fully restart the TV so the old cached service is replaced. Settings should show app and local service **0.2.0**. Keep the existing Developer Mode IP. Do not sign out or clear browser data to update.

## Version 0.1.1 catalog fix

Fixes HTTP 502 on compressed catalogs with the TV's Node 4 runtime: that runtime can emit `aborted` for a complete HTTP response while gzip decoding is still finishing. The service now checks HTTP message completeness, still rejects genuinely truncated responses, and accepts gzip and deflate. Failed service GETs also try a direct browser request; account POSTs are not replayed. Catalog errors now show the provider and underlying failure, with a Retry button. Certificate validation remains enabled.

After updating, fully restart the TV to replace TizenBrew's cached service. Settings should show **Stremio Lite 0.1.1** and **local TizenBrew service 0.1.1 connected**. Your stored account and addons are retained. A fixed commit reference in Module Manager avoids stale `@main` CDN files.

The supplied firmware identifies Tizen 3.0. Samsung documents Chromium 47 for 2017 TVs. The current official Stremio web app uses a WebAssembly core, so opening that page in a wrapper does not address this browser generation. This client uses ES5 JavaScript, XMLHttpRequest, and compatible CSS without WebAssembly or a frontend framework.

## Features

- Combined catalog shelves, cinematic Discover artwork, content type filtering, and search across installed addons.
- Stremio device-code sign-in on your phone or computer. No account password is entered in this client.
- Import of account addons and library; manual addon manifest URLs also work.
- Series and episode selection using addon-provided video IDs.
- Direct HTTP(S) video playback through Samsung AVPlay when available, with an HTML5 fallback.
- Remote control navigation, play/pause, seek, stop, embedded native audio/subtitle selection, and SRT/WebVTT subtitle overlays.
- Local resume positions for up to 100 videos.
- A public Blender sample in Settings to test the player independently of your addons.

## Limits

This client does not run a torrent engine. An addon must supply a direct HTTP(S) video URL. Torrent hashes, magnets, external website links, YouTube IDs, archives, DRM setup, and sources requiring custom HTTP headers are not implemented. Unsupported sources display an explanation instead of pretending to play.

The TV must support the stream's codecs, container, resolution, TLS configuration, and delivery format. Desktop playback does not prove that a stream works on the TV. The client imports account data but does not upload library edits or watch progress. Genre filter selection, autoplay of the next episode, subtitle timing adjustment, and account-management actions are outside version 0.1.1.

Only addon catalogs whose required filters can be supplied are shown. Addon manifest URLs must keep configuration in their path; URLs containing query parameters or fragments are rejected in this version. Legacy JSON-RPC addons are not supported.

## Install as a TizenBrew module

TizenBrew's current loader retrieves module files from jsDelivr using a **public GitHub repository or npm package**. The source is published at [Ws3r211/stremio-lite-tizenbrew](https://github.com/Ws3r211/stremio-lite-tizenbrew).

1. Open TizenBrew on your TV.
2. Open Module Manager and choose **Add GitHub Module**.
3. Enter `Ws3r211/stremio-lite-tizenbrew@main`. To pin a specific version, replace `main` with that commit's full hash.
4. Launch **Stremio Lite**.
5. Check Settings. It should report that the local service is connected. Run **Play test video** and verify picture, sound, pause, seek, and Return.
6. Select **Sign in with Stremio**, open the displayed link on your phone, and approve the device. The client then imports your existing addons.

Keep the Developer Mode IP that already lets TizenBrew work. Adding this module does **not** need changing the IP to your computer. A direct SDB/debugging session, if necessary later, is a separate step.

The `private` package flag intentionally prevents accidental npm publication. It does not prevent TizenBrew loading this project from GitHub. No npm packages are required by the runtime service; it uses only built-in Node modules and is parsed as ES5 for the TV's older service runtime.

## Local preview

Install a current Node.js, open this directory in a terminal, and run:

```powershell
node service.js
```

Open [the local preview](http://127.0.0.1:17780/). The preview binds only to your own computer's loopback interface. A PC is not required after a module has been hosted and launched through TizenBrew; the service then runs on the TV.

## Storage and network behavior

The account session token, configured addon URLs, and resume positions are stored in the current browser/app's local storage. Sign out clears the account session and imported addons. The client reads account data from Stremio and sends addon requests to your configured addon services. No telemetry or request-body logging is included.

The local JSON/subtitle service binds to `127.0.0.1:17780`. It permits its own origin and TizenBrew's `http://127.0.0.1:8081` origin, rejects other browser origins, and requires a per-process token on requests. Account POSTs are restricted to the two implemented read/import endpoints at `api.strem.io`; addon content uses GET. Media URLs are played directly; the service does not relay video or transcode it. A URL containing a configured addon token should be treated like a credential when sharing screenshots or logs.

## Validation

```powershell
npm ci --ignore-scripts
node --test test/core.test.cjs
node test/catalog-network.test.cjs
```

The protocol/service tests cover ES5 syntax, encoded episode IDs and configuration paths, resource filters, required catalog extras, stream-label hints, unsupported streams, subtitles, local-service origin/session checks, and the TizenBrew VM launch contract.

Browser tests additionally need Playwright and an installed browser. `test/browser.test.cjs` uses synthetic account/addon data and a mocked AVPlay object. `test/live-smoke.cjs` explicitly accesses public Cinemeta metadata, requests an unauthenticated Stremio device code, and plays the public Blender sample on desktop. Neither test signs into a real account. Both can use `CHROME_PATH` to select an installed Chrome executable. Results in `artifacts/` distinguish desktop verification from physical-TV testing.

`test/node4-smoke.js` runs with Node 4.4.3 and no npm dependencies. It tests compressed responses with connection closure, redirects, and rejected truncation; `--live` additionally fetches the public Cinemeta catalog. `test/catalog-network.test.cjs` checks browser fallback, configured catalog paths, diagnostic errors, retry, and account POST isolation with synthetic providers. A user's configured AIOMetadata instance still needs an on-TV check.

`test/discover.test.cjs` checks the combined catalog layout, lazy shelves, request limits, horizontal/vertical remote navigation, focus restoration, cached filters, and cached pagination. Browser playback tests check native buffering call order and repeated-stall guidance using a mock; they cannot establish whether a particular TV stream stops stuttering.

## Source assessment and references

The linked [RameezFridie sample](https://github.com/RameezFridie/tizenbrew-stremio-addon/blob/main/stremio-tizen-addon/index.js) serves one sample movie and one sample stream. It has no Stremio user interface. Its package also lacks the `packageType` and `appPath` fields used by TizenBrew's current application loader. A **Stremio content addon** supplies catalogs or streams to a client; a **TizenBrew application module** supplies the TV client itself. This project implements the latter and consumes the former.

Protocol and integration references:

- [TizenBrew module format](https://github.com/reisxd/TizenBrew/blob/main/docs/MODULES.md), [module loader](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/service-nextgen/service/utils/moduleLoader.js), and [service launcher](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/service-nextgen/service/utils/serviceLauncher.js).
- [Official Stremio web client architecture](https://github.com/Stremio/stremio-web), [account and device-link request definitions](https://github.com/Stremio/stremio-core/blob/development/src/types/api/request.rs), and [response types](https://github.com/Stremio/stremio-core/blob/development/src/types/api/response.rs).
- [Stremio addon protocol](https://github.com/Stremio/stremio-addon-sdk/tree/master/docs), including [stream types](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md).
- [Samsung browser versions](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html) and [AVPlay API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html).

Stremio and TizenBrew are separate projects. This client is not affiliated with their maintainers. Its code is original and MIT-licensed; no official Stremio frontend code is bundled.
