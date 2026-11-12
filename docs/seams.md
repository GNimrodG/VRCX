# Seam table and alias map (§4)

[← CLAUDE.md](../CLAUDE.md) — where the server/client split happens.

## 4. Seam table

The modules where the split happens. On an upstream merge, these are what to inspect.

| Seam | Upstream file | Width | Server side | Web client | Desktop client |
|---|---|---|---|---|---|
| SQL transport | `src/services/sqlite.js` | 2 methods; the **only** `window.SQLite` caller | real `node:sqlite` via `server/src/shims/sqlite.js` | unused once DB/config are aliased away (verified: no `SQLite.Execute`/`handleSQLiteError` in the built client) | same, verified in `pnpm run prod-linux` output |
| DB repository | `src/services/database/index.js` | flat ~190-method facade, 206 call sites | imported unmodified, but `server/src/feed-dedup.js` wraps the 5 `feed.js` write methods (`addGPSToDatabase`/`addStatusToDatabase`/`addAvatarToDatabase`/`addBioToDatabase`/`addOnlineOfflineToDatabase`) with a near-duplicate check — see that file's own doc comment for why | `Proxy` → `rpc('db', name, args)`, `client-web/shims/database.js` — except a small `pipelineOnlyWrites` allowlist (currently just `addOnlineOfflineToDatabase`) that no-ops instead of proxying, since the server's own pipeline processing already performs that exact write; see that file's own doc comment | same shape over IPC instead of `fetch`, `client-desktop/shims/database.js`, same `pipelineOnlyWrites` allowlist |
| Config KV | `src/services/config.js` | 13 methods, ~540 call sites | imported unmodified | RPC + write-through cache, `client-web/shims/config.js` | same, `client-desktop/shims/config.js` |
| VRChat HTTP | `src/services/webapi.js` | 4 methods; the **only** `window.WebApi` caller | `fetch` + tough-cookie via `server/src/shims/webapi.js` | proxied via server (`rpc.js`'s `webapi` target), `client-web/shims/webapi-target.js` | same target, `client-desktop/shims/webapi-target.js` |
| Pipeline WS | `src/services/websocket.js` | `handlePipeline` switch | runs unmodified | subscribes to server's `/api/stream` via an `AppDebug.websocketDomain` override (`client-web/bootstrap.js`), calls the same `handlePipeline` unmodified | same relay, different transport: `client-desktop/shims/pipeline-relay.js` overrides `AppDebug.websocketDomain` to a sentinel and swaps `window.WebSocket` for a relayed object, since the renderer has no session cookie for the server's origin and a raw `new WebSocket()` can't carry the `Authorization` header `/api/stream` needs — the real connection is opened in `src-electron/main.js` (`vrcx-stream-connect`, alongside the existing agent-channel socket) and every frame forwarded over IPC. Originally left as a direct renderer→VRChat connection (below); found live (2026-08-17) that this raced the server's own pipeline connection for the same account's `/auth` token, intermittently invalidating one or the other with a real "authToken doesn't correspond with an active session" pipeline error — routing through the server's single connection removes the second, competing one entirely |
| Daemon | `src/stores/updateLoop.js` | counter loop, ticks every 1000ms | runs the VRChat-API-polling half here, and only here | no-op store, `client-web/shims/update-loop.js` — a browser tab has no local-machine capability to poll either | mostly a no-op like web (VRChat-API polling stays server-only), but `client-desktop/shims/update-loop.js` runs its own real 1000ms loop for the four *local-machine* checks the real file gates on `if (LINUX && ...)` — `AppApi.IsGameRunning`/`IsSteamVRRunning`, `LogWatcher.GetLogLines`, `vrStore.vrInit()` — since those can't run server-side either (the server's own `LINUX` is `false`) and this client already has direct native access to them |
| Native globals | `src/plugins/interopApi.js` | 42 lines; the **only** injection point | n/a | third `WEB` branch, installs `client-web/shims/{webapi-target,app-api,vrcx-storage,log-watcher}.js` | existing Electron branch: `WebApi` swapped for the RPC target, `SQLite` no longer installed, `AppApi`/`LogWatcher`/`Discord`/`AssetBundleManager` stay the real `InteropApi.*` objects |
| Native capabilities → server | `Dotnet/AppApi/**`, `LogWatcher.cs`, `Discord.cs`, `AssetBundleManager.cs` | ~93 methods across 4 globals, all desktop-only | agent-aware `Proxy` polyfills (`server/src/globals.js`) — forward to a connected agent, else no-op | n/a — the browser has none of these capabilities | `server/src/agent.js` ↔ `/api/agent` WS ↔ the same `interopApi.callMethod` the renderer's own native calls already use |

### Current alias map (`server/aliases.js`)

`src/stores/index.js` (the barrel) is **not** aliased — it's imported for real. Everything below is the specific pieces of its closure that can't run under Node; `server/aliases.js`'s own comments are the source of truth if this table and the code disagree.

| Aliased upstream module | Replaced by | Why |
|---|---|---|
| `src/plugins/i18n.js` | `server/src/shims/i18n.js` | Eagerly imports every locale bundle. The shim is a single English-only `createI18n` instance (loaded from `en.json`) that `server/src/app.js` also installs on the headless app, so `useI18n()` and direct `i18n.global.t` callers (`request.js` error text) both translate; it used to echo raw keys, which leaked into API error toasts and logs |
| `src/plugins/index.js` | `server/src/shims/plugins-index.js` | Re-exports `./components` (raw `.vue`, unparseable under Node) and `./router` |
| `src/plugins/router.js` | `server/src/shims/router.js` | Imports every view directly to build its route table |
| `src/stores/ui.js` | `server/src/shims/ui.js` | Dialog bookkeeping only — a headless process has no dialogs |
| `src/stores/modal.js` | `server/src/shims/modal.js` | `confirm`/`alert`/`prompt` resolve as if declined; `otpPrompt` is the one real implementation, reading a 2FA code from stdin |
| `src/workers/activityWorkerRunner.js` | `server/src/shims/activity-worker-runner.js` | Vite-only `?worker&inline` import; every message type is a pure function from `activityEngine.js`, run in-process instead |
| `src/stores/quickSearchWorker.js` | `server/src/shims/quick-search-worker.js` | Same Vite-only problem, but stateful with zero imports — loads the real file's source via a `data:` URL |
| `src/localization/index.js` | `server/src/shims/localization.js` | `import.meta.glob(...)`; `languageCodes` re-exported for real from the Vite-free `./locales.js` |
| `src/shared/utils/appActions.js` | `server/src/shims/app-actions.js` | UI actions (confirm dialog, clipboard, `<a download>`); the other ~31 files in that barrel are real, unaliased business logic |
| `src/shared/utils/base/ui.js` | `server/src/shims/base-ui.js` | Theme/font/CSS DOM mutation; `HueToHex`/`HSVtoRGB`/`getThemeMode` reimplemented for real |
| `worker-timers` *(package)* | `server/src/shims/worker-timers.js` | Schedules through a blob-URL Worker, which doesn't exist in Node; plain timers are correct here |
| `vue-sonner` *(package)* | `server/src/shims/toast.js` | Toast calls throughout `request.js`/`websocket.js`/13 coordinators → structured log lines |
| `noty` *(package)* | `server/src/shims/noty.js` | Login/logout greeting; runs `document.addEventListener` at module load, so it must be a package alias, not a deferred-call shim |
| `src/shared/utils/clock.js` *(new file, fork-added)* | `server/src/shims/clock.js` | `src/stores/activity.js`'s "now" for a still-open self activity session. Live clients correctly bound it just by existing (the computation only runs while they're open); bounded to desktop-agent connectivity server-side instead — see the shim's own doc comment and this row's sibling entry in the patch inventory (§5) for the "100% overlap with a 24/7 server" bug this fixes |

All aliases are permanent (Vite-only syntax, or a genuinely headless-incompatible concern), except `modal.js`'s `otpPrompt`, which is a real implementation, not a stub.

### The store-graph problem (measured, not estimated)

Importing *any* background store pulls a **629-file closure including ~300 `src/components/**` and ~144 `src/views/**`**, through exactly two edges: `src/stores/settings/appearance.js:29` → `src/plugins/index.js`, and `src/stores/avatarProvider.js:4` → `src/plugins/router.js`. Aliasing those two (above) drops it to **148 files and 11 npm packages** — the entire reason the server can run the real store graph at all.

One benign-looking edge to leave alone: `src/stores/gameLog/index.js:5` imports `src/views/GameLog/sessions/buildGameLogSessions.js`, a pure function that merely lives under `views/`. Don't add a path-prefix rule that rejects it — `.dockerignore` keeps `src/**` whole for this reason.
