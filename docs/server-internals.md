# Server internals (§3)

[← CLAUDE.md](../CLAUDE.md) — how the headless server runs upstream code unmodified.

## 3. How the server runs upstream code unmodified

The server imports VRCX's *real* data layer. Nothing is copied or vendored.

### 3.1 Module resolution (`server/hooks.mjs`)

A Node ESM `resolve` hook (registered by `server/register-hooks.mjs`) emulates Vite's resolver — `src/**` uses extensionless and directory imports plain Node rejects, so the hook tries the exact path, then `.js`/`.mjs`/`.json`/`.ts`, then `index.js`/`index.mjs`/`index.ts` — and applies two alias maps from `server/aliases.js`: `aliases` (keyed by *resolved absolute path*, robust to however a module spells its import) and `packageAliases` (keyed by bare npm specifier, for packages that can't run under Node at all, matched before path resolution). It also forces `format: 'module'` for `src/**`, since the root `package.json` has no `"type": "module"`. Upstream has been migrating `src/api/**` from `.js` to `.ts` (2026-10-10 onward), so `.ts` targets get `format: 'module-typescript'` instead, letting Node 24's built-in type stripping erase the annotations; that only handles *erasable* syntax, so an `enum`/`namespace` in an upstream `.ts` file would be a new merge task (§6.2).

Vitest has its own module pipeline and never sees this hook, so `server/vite-alias-plugin.js` re-implements the same logic as a Vite plugin, reading the same `server/aliases.js` — the two paths cannot drift.

### 3.2 Compile-time globals (`server/src/globals.js`)

Vite's `define` block (`src/vite.config.js`) replaces `LINUX`, `WINDOWS`, `VERSION`, `NIGHTLY` at build time; under Node they're installed as real globals, both platform flags **false** (the server is neither the CEF/Windows nor the Electron/Linux build), plus `window` (see §3.7) so `window.X = Y` assignments work. Also installs a `CloseEvent` polyfill — `src/services/websocket.js:118` constructs one in its `onerror` handler to schedule reconnects, and Node has `WebSocket` but not `CloseEvent`.

### 3.3 The SQLite shim (`server/src/shims/sqlite.js`)

A behavioural port of `Dotnet/SQLite.cs` onto `node:sqlite`, covered by `server/test/sqlite-shim.test.js`:

| Requirement | Why | Mechanism |
|---|---|---|
| Rows are **positional arrays** | Every caller indexes `row[0]`, `row[1]`; object rows would collapse duplicate join column names | `statement.setReturnArrays(true)` |
| **Unknown named parameters are ignored** | System.Data.SQLite accepts params a statement never references; `node:sqlite` throws | `statement.setAllowUnknownNamedParameters(true)` |
| **Error text is SQLite's own** | `handleSQLiteError` in `src/services/sqlite.js` string-matches driver error text | no wrapping of driver errors |

Plus parameter coercion (`coerceParameter()`): `undefined`→null, `boolean`→0/1, `Date`→`toJSON()`, throws on anything else. Connection PRAGMAs mirror `Dotnet/SQLite.cs:37`: `locking_mode=NORMAL`, `busy_timeout=5000`, `journal_mode=WAL`.

### 3.4 Database location (`server/src/paths.js`)

Same resolution order as the desktop app: `VRCX_DATABASE` env var → `VRCX_DatabaseLocation` in `VRCX.json` → `<appdata>/VRCX/VRCX.sqlite3` (`%APPDATA%`/`$XDG_CONFIG_HOME`/`~/.config`, matching .NET's `SpecialFolder.ApplicationData`).

### 3.5 The WebApi shim (`server/src/shims/webapi.js`)

A behavioural port of `Dotnet/WebApi.cs` onto Node's global `fetch`, covered by `server/test/webapi-shim.test.js`. `src/services/webapi.js` is the only consumer, unmodified.

| Requirement | Why |
|---|---|
| `Execute` returns `{Item1, Item2}` and **never throws** | `webapi.js:37` reads the tuple; failures are `Item1 === -1` with the message in `Item2` |
| On failure the thrown value must be a **string** | `webapi.js:39` does `throw item.Item2`; `$throw` (`request.js:346`) `JSON.stringify`s anything that isn't already a string — an `Error` collapses to `{}` |
| Binary responses return `` `data:image/png;base64,…` `` | `WebApi.cs:468` hardcodes that prefix regardless of real content type |
| `Content-Type` on the body, `Referer` is a real referrer, User-Agent is `VRCX <version>`/`VRCX Nightly <version>` | `WebApi.cs`/`Program.cs`; VRChat rate-limits generic agents |
| Redirects are followed **by hand** | so the cookie jar applies on every hop, as `CookieContainer` does natively |

Uploads (`uploadImage*`, `uploadFilePUT`) return a clear "not supported" error — no server-side call site reaches them yet. Proxy support is `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY`.

### 3.6 Cookies (`server/src/cookies.js`)

`tough-cookie` for the jar, persisted in **`Dotnet/WebApi.cs`'s exact format** so the same `VRCX.sqlite3` stays readable by the desktop app: base64 JSON array of `System.Net.Cookie`-shaped (PascalCase) objects, one row in `cookies` keyed `'default'`. Two easy-to-drop details: the `cookies` table is created by the shim too (the C# side creates it, not the JS migration layer), and every cookie expiry is forced to `DateTime.MaxValue` so sessions survive a restart, matching `WebApi.cs:204`.

### 3.7 Node's missing — or browser-different — globals

Missing entirely, all polyfilled in `server/src/globals.js` unless noted:

| Missing | Where it bites | Handling |
|---|---|---|
| `CloseEvent` | `websocket.js:118` reconnect | see §3.2 |
| `Worker` | `worker-timers` builds its timer from a blob-URL Worker — fails on first call, not import | `packageAliases` → `server/src/shims/worker-timers.js` |
| `navigator.onLine` | `authAutoLoginCoordinator.js:14` → falsy → permanent "you're offline" | inject `() => true` |
| `speechSynthesis` | `settings/notifications.js` TTS | stub (`getVoices`/`cancel`/`speak`) — stays a stub permanently, see §9 |
| `AppApi` | ~81 methods, bare global across `src/**` | `Proxy` (`installAppApiPolyfill`) — logged no-op for anything unlisted; `GetVersion()` returns the real `VERSION` |
| `VRCXStorage` | Explicitly desktop-owned (§1), but referenced as a bare global from several stores anyway | in-memory, process-lifetime `Map`-backed stub |
| `document` | `documentElement.classList`/`getElementById`/`querySelector(All)`/`createElement` from a bounded set of stores | polyfilled; `createElement` exists only because `@vue/runtime-dom` feature-checks it at module scope |
| `history` | Not `src/**` — vue-router's own `finalizeNavigation` reads `history.state`, guarded by an `isBrowser` check that the `document` polyfill above accidentally makes true | polyfilled (`installHistoryPolyfill`) — `mountHeadlessApp()` uses `createMemoryHistory()`, so only `.state` is a real read |

Present, but behaving differently:

| Present but different | Where it bites | Handling |
|---|---|---|
| `WebSocket` sends no default `User-Agent` | Cloudflare in front of `pipeline.vrchat.cloud` silently drops the handshake without one — immediate `onerror` + 1006 close, endless reconnect loop | global `WebSocket` wrap (`installWebSocketUserAgentPolyfill`) patching the zero-options call shape only |
| `window` is `globalThis` | Would defeat `@tanstack/query-core`/`@vueuse/core`'s SSR guards (`typeof window !== 'undefined'`) if aliased directly | `Proxy`: narrow real reads (`matchMedia`, `crypto`), but every `window.X = Y` write mirrors onto `globalThis[X]` too, since several `src/**` files read those as bare identifiers elsewhere |

### 3.8 Schema version

`server/src/db.js` **reads the target version out of `src/stores/vrcx.js`** with a regex rather than duplicating the constant. If the regex stops matching, it logs a warning and falls back to 16 — treat that warning as a merge task.
