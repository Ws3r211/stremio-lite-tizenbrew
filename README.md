# Stremio Lite for TizenBrew

An experimental, unofficial Stremio-compatible client for older Samsung TVs, targeting the UE49MU7070 with Tizen 3.0. It runs as a TizenBrew **application module** with a small local service. It is a new lightweight client, not a port of the official Stremio app. Physical-TV testing is still required.

## Version 3.1.3: complete player remote paths and Home banner return

The player uses explicit remote focus paths. Left/Right moves through Pause, back/forward 10 seconds, Go to time, Audio, Subtitles and Stop without jumping onto the timeline. Up goes from a button to the timeline, then Back; Down returns to the last playback button. On the timeline, Left/Right previews a seek and OK commits it. Hidden controls reopen safely. Track menus scroll their own contents and keep arrow focus inside the dialog, including long audio lists. Playback error actions are reachable by remote too.

On Home, Up from the first visible catalog returns to the featured title and scrolls the banner fully into view; Up again reaches the top navigation. Down returns to catalogs. Right from the featured title reaches content filters. Catalog navigation skips empty rows and retains the chosen column as a loading row is filled. Settings buffer options are explicit remote-friendly choices so the playback test is reachable without a native dropdown trap.

Keep the existing `Ws3r211/stremio-lite-tizenbrew@v3.1.0` Auto entry and reopen it to install runtime 3.1.3. The regression starts at Home and uses arrows/OK to reach the playback test, every player tool, an 18-track audio list, subtitle controls, Go to time, timeline, hidden controls and error actions, then returns through Home shelves to the banner at 1920x1080 and 1280x720. Native AVPlay calls use a mock; physical-TV confirmation is still needed.

## Version 3.1.2: reachable account controls and predictable Settings navigation

Settings opens on Stremio account, before catalog lists. A fixed section menu jumps directly to account, updates, Home catalogs, addons and playback. Up/Down visits controls in order; Left returns to the section menu, Right/OK opens a section, and Return moves from controls to sections to the top navigation. Focus stays visible below the header and above the footer, including long catalog lists. Text fields retain Left/Right editing. Buffer options are remote-friendly choices in version 3.1.3.

Failed or expired sign-in requests re-enable the sign-in button, and an in-progress request can be cancelled. Late responses from a cancelled attempt are ignored. Signed-in TVs show refresh/sign-out controls in the first section.

Keep `Ws3r211/stremio-lite-tizenbrew@v3.1.0`. Reopen Stremio Lite Auto to update; Settings reports runtime 3.1.2. No new module or Developer Mode IP change is required. Regression checks cover signed-out and signed-in TVs, failed login retry, cancellation, 40-catalog remote navigation and focus visibility at 1920x1080 and 1280x720. These use synthetic account responses, not a physical TV.

## Version 3.1.1: restore controls on the 2017 TV browser

The player overlay and subtitle backdrop now use explicit top/right/bottom/left edges instead of the newer CSS inset shorthand. A browser that ignored inset collapsed the absolutely positioned overlay: the header shrank into the top-left corner and the bottom timeline/buttons fell outside the visible player. The fix retains the full-screen overlay on Chromium 47 and keeps paused controls visible.

Keep the original `Ws3r211/stremio-lite-tizenbrew@v3.1.0` automatic module. Reopen Stremio Lite Auto (or use Settings > Automatic updates > Check for updates, then Reopen app). Settings should show installed app/service 3.1.1. A new module entry is unnecessary.

The regression check removes unsupported inset declarations before loading the app, then verifies paused player geometry, every transport button, the timeline, remote scrubbing and the subtitle backdrop at 1920x1080 and 1280x720. The pre-fix CSS fails this check and reproduces the collapsed corner header. This is a targeted compatibility simulation; physical-TV confirmation is still required.

## Version 3.1.0: install once, update on launch

Add `Ws3r211/stremio-lite-tizenbrew@v3.1.0` once in TizenBrew and fully restart the TV to replace its cached service. Launch **Stremio Lite Auto** and keep this entry for future releases. The module version remains the permanent launcher's version; Settings shows the installed app/service version. Your Developer Mode IP stays unchanged. The TV fetches updates itself; no PC or scheduled task is needed.

The permanent ES5/Node 4 launcher checks this repository's public `update.json` on each opening and downloads the complete `runtime.json` from its fixed release tag. It verifies the SHA-256 digest, version, required files and script syntax before activation. The app and service switch together on launch; **Check for updates** in Settings only stages an update until you reopen. Nothing polls for or applies updates during video playback. Your account, addons, Home settings and progress remain in the original browser origin's storage. Update checks send no account or configured addon data.

The bundled app works if an update check fails. Complete verified updates are cached under `/home/owner/share/stremio-lite-auto` on the TV using an atomic state-file replacement; a previous version is retained. If the new app never confirms startup, the next opening restores the previous version and skips that failed release. Unavailable cache writes are shown in Settings; the bundled fallback remains available. This is app-level fallback, not an OS/firmware rollback. Transport certificate validation remains enabled. Updates are restricted to this project's repository, with no arbitrary download URL field.

For release maintainers: bump the package, runtime-service and app versions; run `python build-auto.py` then the checks and `python build-release.py`. Publish the matching version tag and verify its CDN bundle **before** promoting `update.json` on main. The launcher in the original v3.1.0 entry stays unchanged. Keep the seven runtime file names and `/auto/ready/<digest>` startup acknowledgement compatible with bootstrap protocol 1. A future bootstrap-protocol change may need a one-time new launcher, while ordinary app/service fixes do not.

Native TV validation of the automatic launcher is still required. Desktop tests cover the real launch document, preserved storage, coherent service/assets, update staging, invalid/interrupted downloads, offline fallback and unconfirmed-start rollback.

## Version 3.0.1: search clarity, episode dates and buffering recovery

Search has Movies / TV shows / Videos / Live TV / Other filters where matching results exist. Every card identifies the content type; verified account-library matches get a separate In library badge. An addon's custom `library` type is labeled Library item and is not treated as proof of account membership. Duplicate IDs of the same type merge richer metadata; different IDs are retained. Missing/broken posters show a readable fallback, and search query/filter choices survive opening a title. Search refreshes library membership using the existing read-only account endpoint.

Empty Home catalog rows are hidden after a successful empty response, including cached responses. This does not change Settings preferences or suppress network failures. A later visit rechecks once the five-minute cache expires; all-empty results leave content filters and Settings accessible.

Episode rows show Released / Upcoming with the supplied air date, an overview when supplied, or an explicit missing-date label. Future dates describe addon metadata and do not guarantee stream availability.

Native startup has a 45-second deadline. A resume seek with no callback retries once from the beginning after 15 seconds, invalidating callbacks from the abandoned attempt. Actual advancing playback clears a stale Buffering overlay. Sixty seconds without playback progress while playing produces BUFFERING_TIMEOUT and explicit Retry from beginning / Choose another source actions; pause and seeks do not trigger this watchdog. Native playback makes both the HTML and body layers transparent. These changes avoid indefinite UI waits; provider delivery and TV codec compatibility still need on-device verification.

Update with `Ws3r211/stremio-lite-tizenbrew@v3.0.1`, fully restart the TV, and check app/service 3.0.1 in Settings. Keep your existing Developer Mode IP.

## Version 3.0.0: player and catalog controls

- A video timeline with remote preview scrubbing: press Up to focus it, use Left/Right to preview a position (holding accelerates), press OK to seek, and Return to cancel. Mouse/range input also works. Unknown-duration streams show a disabled timeline rather than a fake duration.
- Go to time accepts HH:MM:SS, MM:SS, or seconds. Seek requests are serialized, clamped to the video duration and cancelled safely when leaving playback. Missing seek callbacks release the controls after a bounded timeout. Initial resume waits for Samsung's seek callback before playing.
- Separate Audio and Subtitles panels show language, codec and channel details where supplied by the player. Audio changes preserve active subtitles and the paused state. The 2017 Samsung API requires temporarily entering PLAYING to switch audio; the paused state is restored immediately afterward. Availability depends on the stream/protocol and the TV APIs. Browser audio/text tracks are offered when exposed; unavailable tracks are explained rather than fabricated.
- Subtitle choices include embedded tracks and installed addon SRT/WebVTT files, an Off option, persistent text sizes, and addon subtitle timing adjustment in half-second steps. Embedded timing remains controlled by the TV. Track dialogs restore focus and ignore responses from a closed dialog or previous video.
- TV default buffering is the default again. The first 3.0 launch resets older buffer preferences to TV default once; you can opt back into a custom mode in Settings. Larger buffers are opt-in; a tuned startup that fails retries once with TV defaults. Real safe player error identifiers are displayed. This does not transcode unsupported video or guarantee that a large DV/HDR hybrid stream works.
- The player uses bundled MIT-licensed Tabler icons, auto-hiding controls, 10-second skip buttons, buffering status, and returns focus to the source you selected.

### Choose Home catalogs

Open **Settings > Home catalogs** to show or hide individual catalog rows. Choices are grouped by addon and saved on this TV; **Show all** and **Hide all** are also available. Hiding a catalog removes its row and prevents Home from requesting it, including its posters and featured metadata. Its addon remains installed for search, metadata, subtitles and streams. Turning every catalog off shows an empty state with a route back to Settings.

Choices survive restarts and account-addon refreshes when the same configured catalog still exists. Each choice distinguishes the configured addon URL, catalog type and catalog ID, so two configurations or movie/series catalogs with the same ID can be controlled separately. Removing an addon prunes its choices; signing out clears them along with imported addon data.

The built-in Local Files addon is excluded from this TV client. Existing saved copies are removed before networking starts; account refreshes omit it, and manual additions are rejected. This does not uninstall it from your Stremio account. Its loopback URL points at the TV itself, where the desktop local-files service is unavailable. Running Stremio on a PC does not automatically make that loopback address reachable from the TV. Other configured network addons are retained.

For updates, use the immutable release reference `Ws3r211/stremio-lite-tizenbrew@v3.0.0` in TizenBrew to avoid stale branch/default CDN caches. Fully restart the TV after adding the new entry, and check Settings for app/service **3.0.0**. Keep your existing Developer Mode IP and account data.

## Version 0.2.0: Discover and playback

Discover now presents installed catalogs together in horizontal poster shelves, with custom catalogs first, a cinematic metadata backdrop, and All / Movies / Series filters. The layout follows the selected Editorial Discover visual direction. Real titles, descriptions, posters, and backdrops come from your addons; the concept's fictional artwork is not included. Catalogs load near the viewport with at most two catalog requests at once. Poster images load near the visible part of each shelf, and returning from a title restores the focused poster. A five-minute in-memory catalog cache avoids unnecessary requests when switching filters or returning.

In version 0.2.0, Samsung AVPlay used a 10-second initial / 15-second recovery buffer by default; version 3.0.0 restores TV default as the default. Settings offers Extra buffering (15 / 20 seconds) and TV default. Unsupported buffer APIs fall back without preventing playback. The controls are configured after open and before prepare, as required by Samsung. Startup/recovery may take longer. The HTML5 fallback uses browser-managed buffering. No video proxy, transcoding, or automatic source switching is included.

Stream labels now highlight resolution, codec, Dolby Vision, reported bitrate and size when supplied by the addon. These are label-based hints, not a probe of the actual media. A DV/HDR hybrid may include a playable HDR10 base layer, but Dolby Vision itself is unsupported on this Samsung. Repeated buffering suggests a lower bitrate or a different source; buffer settings cannot fix sustained bandwidth shortages or unsupported codecs. A large file is not automatically unsupported: bitrate, peaks, codec profile, delivery, and available bandwidth matter.

For an initial comparison on the UE49MU7070, try a 1080p H.264/AVC source without Dolby Vision. This is a troubleshooting starting point, not the TV's maximum capability. Samsung's [2017 video specifications](https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2017-tv-video-specifications.html) and [AVPlay buffer API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html#AVPlayManager::setBufferingParam) describe the platform constraints. Actual source playback still requires testing on the TV.

For the current release, follow the 3.0.0 update instructions above. Keep the existing Developer Mode IP and account data.

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

The TV must support the stream's codecs, container, resolution, TLS configuration, and delivery format. Desktop playback does not prove that a stream works on the TV. The client imports account data but does not upload library edits or watch progress. Genre filter selection, autoplay of the next episode, transcoding, and account-management actions are not implemented. Timing adjustment applies to addon subtitle files.

Only addon catalogs whose required filters can be supplied are shown. Addon manifest URLs must keep configuration in their path; URLs containing query parameters or fragments are rejected in this version. Legacy JSON-RPC addons are not supported.

## Install as a TizenBrew module

TizenBrew's current loader retrieves module files from jsDelivr using a **public GitHub repository or npm package**. The source is published at [Ws3r211/stremio-lite-tizenbrew](https://github.com/Ws3r211/stremio-lite-tizenbrew).

1. Open TizenBrew on your TV.
2. Open Module Manager and choose **Add GitHub Module**.
3. Enter `Ws3r211/stremio-lite-tizenbrew@v3.1.0`. This fixed release reference avoids stale `main` caches.
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

`test/home-catalogs.test.cjs` uses a synthetic unavailable catalog and the built-in Local Files descriptor and two addon configurations. It verifies remote toggles, visibility across reloads and addon refreshes, no Home requests to hidden catalogs, retained search, all-hidden recovery, bulk controls, sign-out cleanup, and Local Files exclusion during migration, import and manual addition.
