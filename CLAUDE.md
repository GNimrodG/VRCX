# VRCX-Headless — fork architecture and upstream migration guide

This fork splits [VRCX](https://github.com/vrcx-team/VRCX) into two pieces:

- a **headless server** that owns the VRChat API connection and is the *sole writer* of `VRCX.sqlite3`
- a **client** — the existing Vue app — that runs either in a browser or inside the Electron desktop shell, and stays in sync across devices off a server event stream

Upstream is a fast-moving, UI-heavy project, and `.github/CONTRIBUTING.md` says UI PRs are declined there, so **everything we diverge on is permanently ours to maintain**. This document exists to make each upstream merge mechanical rather than archaeological.

**If you are an agent or contributor about to change something: read "Invariants" first. They are the whole reason this fork is maintainable.**

**Status:** fully implemented — server, web client, desktop client, TOTP auth, cross-platform desktop releases (§10). §9 lists what's a deliberate scope cut, not unfinished work. §2–§6 are the merge mechanics; §8 is a one-line-per-phase summary, not a build history.

---

## 1. Architecture

```
                    ┌──────────────────────────────────────────┐
                    │  server/   (Node, headless)               │
                    │  ── sole owner of VRCX.sqlite3 ──         │
                    │  • runs src/services/database/** verbatim │
                    │  • VRChat REST  (undici + tough-cookie)   │
                    │  • VRChat pipeline WebSocket              │
                    │  • updateLoop daemon + bg coordinators    │
                    │  • HTTP RPC + WS fan-out, TOTP auth        │
                    └──────────────────────────────────────────┘
                        ▲  client channel        ▲  agent channel
                        │  (RPC + state stream)  │  (logs up, commands down)
        ┌───────────────┴──────────┐   ┌─────────┴───────────────────────┐
        │ Browser client           │   │ Desktop client (Electron)       │
        │ PLATFORM=web             │   │ PLATFORM=windows|linux          │
        │ no native, no SQL        │   │ + .NET sidecar: LogWatcher,     │
        │                          │   │   VR overlay, Discord, registry │
        └──────────────────────────┘   └─────────────────────────────────┘
```

### Desktop client OS support

The `PLATFORM` build flag names are historical, not descriptive: `PLATFORM=windows` builds the **CefSharp** client (upstream's original native-Windows shell, `Dotnet/AppApi/Cef/**`) — it does not run on Linux. `PLATFORM=linux` builds the **Electron** client (`Dotnet/AppApi/Electron/**`, `Dotnet/VRCX-Electron.csproj`) — despite the flag name, the Electron *shell* itself and its headless-server connection code (phase 5) are plain cross-platform Node/Chromium and run fine on Windows too, unlike CefSharp which only runs on Windows.

What's actually OS-tested inside `Dotnet/AppApi/Electron/**`, verified live (2026-08-17, Windows, against a self-hosted server with a step-ca-issued cert):

| Capability | Linux | Windows |
|---|---|---|
| Server connection, RPC, agent channel, TLS/CA trust | tested (AppImage, phase 5) | tested |
| `StartGame`/`StartGameFromPath` (VRChat autodetect + launch) | tested (Steam-on-Linux paths) | tested (Steam/VRChat registry keys, `GameHandler.cs`'s `StartGameWindows`/`StartGameFromPathWindows`) |
| Everything else in `Folders.cs` (screenshot/app-data/crash paths, `OpenFolderAndSelectItem`'s `xdg-open`/`nautilus`/etc, `which`-based command detection) | tested | **untested, almost certainly broken** — written entirely around Linux paths and Linux-only shell commands, no Windows branch added |
| `TryOpenInstanceInVrc` (attach a deeplink to an already-running client) | tested (`nsenter`+`wine`) | **untested, almost certainly broken** — same reason; the JS caller already has a self-invite fallback for exactly this failure mode, so it degrades gracefully rather than erroring |
| VR overlay, Discord RPC, LogWatcher, registry, screenshots | Linux-tested only | untested |

So: **Windows is a supported OS for the Electron client's server-connection and game-launch path specifically**, not a general Windows/Electron parity claim — the rest of the native surface should be assumed Linux-only until someone does the same OS-branching `GameHandler.cs` just got.

### Gotcha: build flags are not OS flags

The `LINUX`/`WINDOWS` compile-time globals (`src/vite.config.js`'s `define`) name the **shell**, not the host OS. `LINUX === true` in *every* Electron build, including the Windows `.exe` and macOS `.dmg` that `desktop-release.yaml` produces (all built with `pnpm run prod-linux`). `WINDOWS === true` only in the CefSharp build, which this fork doesn't ship. The naming is upstream's: upstream only shipped Electron for Linux, so for upstream "Electron" and "Linux" meant the same thing.

Most of upstream's `LINUX` checks really do mean "the Electron shell" (use `window.electron`/`InteropApi` rather than CefSharp, the Electron-only AppApi variants, and so on), and those are correct as they are. Don't rename them, because every upstream sync would then conflict on them. The bug class to watch for is a `LINUX`/`!isLinux` check that actually means **"is the host OS Linux/Windows"**: a registry, autostart or Windows-path feature, or a Windows-only third-party app such as XSOverlay or OVR Toolkit. On the Windows Electron build, those checks silently hide working features or show broken ones.

For host-OS checks use `src/shared/utils/hostOs.js` (`isHostWindows()`/`isHostLinux()`/`isHostMacOS()`, which read `navigator.platform` at call time). The pattern for "Windows-only feature" is `!LINUX || isHostWindows()`: CefSharp is always Windows, and Electron needs a runtime check. It also keeps upstream's tests, which toggle `globalThis.LINUX`, valid. Fixed so far: the startup toggles (`SystemTab.vue`), the launch-path override (`launch.js`/`LaunchOptionsDialog.vue`) and the XSOverlay/OVR Toolkit toggles (`VrTab.vue`). All are in §5.

### Who owns what

| Concern | Owner | Notes |
|---|---|---|
| `VRCX.sqlite3` (read + write) | **server** | The .NET side stops opening it entirely |
| VRChat REST API + cookie jar | **server** | Credentials never reach a client |
| VRChat pipeline WebSocket | **server** | Frames re-broadcast to clients verbatim |
| Polling daemon (`updateLoop`) | **server** | Runs once, not once per client |
| Settings (`configRepository`) | **server** | Shared across devices; small device-local allowlist |
| Rendering, dialogs, search, dashboards | **client** | |
| Game log tailing, VR overlay, Discord RPC, registry, screenshots, game launch | **desktop client** | Machine-local capabilities, provided to the server over the agent channel |
| `VRCXStorage` (`VRCX.json`) | **desktop client** | Genuinely machine-local (window geometry etc.) |

### Repository layout

| Path | Origin | Rule |
|---|---|---|
| `src/**` | upstream | **Mirrors upstream.** Changes here are a last resort and must be logged in §5. |
| `Dotnet/**`, `src-electron/**` | upstream | Same rule. |
| `server/**` | ours | The headless server. Setup docs: `server/README.md`. |
| `client-web/**` | ours | Browser-client shims. |
| `client-desktop/**` | ours | Desktop-agent shims + server-connection gate. Build docs: `client-desktop/README.md`. |
| `.github/workflows/server-docker.yaml`, `.dockerignore` | ours | Container build. New files, so no merge surface. |
| `CLAUDE.md` | ours | This file. |

---

## 2. Invariants

These six rules are what keep upstream merges cheap. Breaking one does not fail a test — it fails the *next* merge, expensively.

1. **Never edit a call site to accomplish the split.** Do not touch the 206 `database.*`, ~540 `configRepository.*`, or 115 `AppApi.*` call sites. Replace what sits *behind* them.
2. **Prefer aliasing over editing.** Server-side substitutions go in `server/aliases.js`; client-side ones in the Vite alias map under `PLATFORM=web`. An alias survives an upstream refactor of the module that imports it; an edit does not.
3. **Alias the smallest module that pulls in the unwanted dependency**, not the biggest one you can get away with. A stub that grows features is a fork in disguise.
4. **Keep public signatures byte-identical.** `configRepository.getString(key, default)`, the `database` method names, the `window.SQLite` contract — if these drift, every upstream PR touching settings or the DB conflicts.
5. **Additive, not subtractive.** Add a `PLATFORM=web` branch beside the existing `WINDOWS`/`LINUX` branches; do not restructure them.
6. **Every unavoidable `src/` edit gets an entry in §5**, with enough anchor context to re-find it after upstream reformats the file.

---

## 3. How the server runs upstream code unmodified

**Moved to [`docs/server-internals.md`](docs/server-internals.md)** — module resolution hook, compile-time globals, SQLite/WebApi shims, cookies, missing Node globals, schema version. Section numbers (§3, §4, …) are unchanged and cited throughout.

---


## 4. Seam table

**Moved to [`docs/seams.md`](docs/seams.md)** — seam table, current alias map, the store-graph problem. Section numbers (§3, §4, …) are unchanged and cited throughout.

---


## 5. Patch inventory

Every modification to an upstream-owned file, logged per invariant 6. Prefer aliasing when a clean seam exists (invariant 2-3), but patch as much as is actually necessary — this table has no size cap.

The table is split by topic (rows keep their original wording; search all of `docs/patches-*.md` to find a file's entry):

- [`docs/patches-build-ci-tests.md`](docs/patches-build-ci-tests.md) — build, CI, tooling, tests (22 entries)
- [`docs/patches-electron-main.md`](docs/patches-electron-main.md) — Electron main process (3 entries)
- [`docs/patches-updater.md`](docs/patches-updater.md) — fork updater (3 entries)
- [`docs/patches-native-startup-host-os.md`](docs/patches-native-startup-host-os.md) — native layer, startup, SteamVR, host-OS checks, notifications (13 entries)
- [`docs/patches-ui-branding.md`](docs/patches-ui-branding.md) — UI branding and status bar (7 entries)
- [`docs/patches-core-split.md`](docs/patches-core-split.md) — core split seams and misc fixes (6 entries)

`src/App.vue` needed **no edit**; see the end of `docs/patches-core-split.md` for which `Dotnet/**` files are modified.

---


## 6. Upstream sync procedure

**Moved to [`docs/upstream-sync.md`](docs/upstream-sync.md)** — merge procedure, expected conflicts, change-detection checklist, verification. Section numbers (§3, §4, …) are unchanged and cited throughout.

---


## 7. Server usage (current state)

Full setup and Docker instructions: **`server/README.md`**. Quick reference:

```bash
pnpm run server -- info                      # where the DB is, version, who is logged in
pnpm run server -- migrate [--user=usr_...]  # run the JS migration layer
pnpm run server -- tables                    # row counts per table
pnpm run server -- query "SELECT ..."        # read-only, positional rows
pnpm run server -- reset-activity-cache      # clear cached Activity/Overlap tables (rebuild from source data)
pnpm run server -- login                     # VRChat login, prompts for 2FA
pnpm run server -- whoami                    # check the stored session
pnpm run server -- pipeline                  # stream VRChat events
pnpm run server -- serve                     # HTTP/WS server for clients + agent
pnpm run server -- setup-totp                # (re)issue the serve auth secret
pnpm run server -- check-update              # is upstream ahead of this fork's last sync?
pnpm run test:server
```

`login` → `whoami` → `pipeline` → `serve` are all verified end-to-end against a real VRChat account, outside CI (`api.vrchat.cloud` isn't reachable from there).

Environment: `VRCX_DATABASE`, `VRCX_DATA_DIR`, `VRCX_LOG_LEVEL` (`debug|info|warn|error`), `VRCHAT_PASSWORD`/`VRCHAT_2FA_CODE` for non-interactive login, `VRCX_SERVER_TOTP_SECRET` to set `serve`'s auth secret non-interactively.

`--user` is only needed to create per-user tables for an account the database has never seen; `login` does it automatically, and migrations for existing accounts discover their tables through `sqlite_schema` queries.

**Credentials are stored the way upstream stores them.** With no primary password set, `savedCredentials` holds the password in plaintext — that is upstream VRCX behaviour (`src/stores/auth.js:919-930`), not something this fork introduced. Do not silently "fix" it here; it would desync the desktop app. Treat `VRCX.sqlite3` as a secret.

---

## 8. Roadmap

| Phase | Scope | State |
|---|---|---|
| 0 | Fork hygiene: upstream remote, unshallow, identity, CI on PRs | done |
| 1 | Server skeleton: SQLite shim, alias/loader layer, migrations, CLI, tests | done |
| 2a | Server owns the VRChat connection: WebApi shim, cookie jar, login/2FA CLI, pipeline connection, multi-arch container | done |
| 2b | Pinia-in-Node: the background stores and the `updateLoop` daemon | done |
| 3 | Transport: TOTP auth → session/bearer token, generic `/api/rpc` dispatcher, `/api/stream` WebSocket fan-out | done |
| 4 | Web client: `PLATFORM=web`, `client-web/shims/**`, `capabilities` gating | done |
| 5 | Desktop client as native agent: log forwarding up, overlay/Discord/notification commands down; .NET stops touching SQLite | done |
| 6 | Hardening: single-writer lock, awaited client writes, packaging | done |

All six phases plus TOTP auth, the desktop multi-server switcher, the Groups-sidebar relay, and the cross-platform desktop release pipeline (§10) are implemented and in use. The detailed build history (bugs found, live-verification notes, the 2026-08-17 upstream sync, the npm→pnpm migration) lives in git log/commit messages, not here — this file tracks current state and how to keep it that way, not how it got here. §9 lists what's a deliberate scope cut rather than unfinished work.

---

## 9. Known limitations

**Moved to [`docs/known-limitations.md`](docs/known-limitations.md)** — scope cuts and the full fork-updater write-up. Section numbers (§3, §4, …) are unchanged and cited throughout.

---


## 10. The container

**Moved to [`docs/container-and-releases.md`](docs/container-and-releases.md)** — Docker image, versioning, cutting a release, desktop release artifacts. Section numbers (§3, §4, …) are unchanged and cited throughout.
