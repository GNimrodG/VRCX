# Upstream sync procedure (§6)

[← CLAUDE.md](../CLAUDE.md)

## 6. Upstream sync procedure

Upstream's default branch is **`master`**; ours is **`main`**. The `upstream` remote is `https://github.com/vrcx-team/VRCX.git`.

If a checkout is missing it, add it with `git remote add upstream https://github.com/vrcx-team/VRCX.git`, **then immediately run `gh repo set-default WentTheFox/VRCX-Headless`**. Once an `upstream` remote exists, `gh` resolves the default repo to `vrcx-team/VRCX`, so a bare `gh pr create` targets upstream. Found live (2026-09-26): it failed only by luck, because the sync branch didn't exist there.

Sync to either a tagged release or `master` HEAD, deliberately — a tag gives a discrete, reviewable step; `master` gets whatever's landed since the last sync, which is a moving target under an active, UI-heavy project, but is sometimes exactly what's wanted (e.g. testing how well this doc's own procedure holds up against real upstream drift).

```bash
git fetch upstream --tags master

# syncing to a tagged release
git checkout -b sync/<tag> main
git merge v2026.07.18   # the tag being synced to, not upstream/master

# syncing to master HEAD instead
git checkout -b sync/master-<date> main
git merge upstream/master
```

Pick a tag deliberately — `git tag -l 'v*' | sort -V | tail -5` (or the [releases page](https://github.com/vrcx-team/VRCX/releases)) — rather than always grabbing the newest, when that's the path taken.

### 6.1 Expected conflicts, ranked

1. `package.json` — dependency bumps land next to our identity/scripts changes. Keep both sides; take upstream's dependency block wholesale.
2. `.github/workflows/ci.yaml` — take upstream's job definitions, keep our `on:` block.
3. `src/plugins/interopApi.js`, `src/vite.config.js` — see §5.

Files under `src/services/database/**` and `src/services/config.js` should merge **cleanly** — we do not modify them. A conflict there means someone broke invariant 1.

### 6.2 Change-detection checklist

These break the split *without* producing a merge conflict. Check every one.

- [ ] **Schema version bumped?** `grep -n 'const databaseVersion' src/stores/vrcx.js`. The server reads this automatically, but new migrations must be re-run against the live DB.
- [ ] **New or renamed `database.*` methods?** `git diff main..upstream/master -- src/services/database/`. New methods work automatically (name-based Proxy); **renames break call sites**, and new DDL needs a migration run.
- [ ] **`initUserTables` prefixing changed?** Asserted in `server/test/db.test.js`.
- [ ] **`configRepository` signatures changed?** Any change breaks the client's cached shim (invariant 4).
- [ ] **`window.SQLite` contract changed?** `git diff main..upstream/master -- Dotnet/SQLite.cs src/services/sqlite.js`. Mirror new methods/row shapes in `server/src/shims/sqlite.js`.
- [ ] **Vite `define` block changed?** New compile-time globals need `server/src/globals.js` *and* `server/vitest.config.js`.
- [ ] **New browser-only imports in the data layer?** `grep -rn "^import" src/services/database/ src/services/config.js src/services/sqlite.js` — anything beyond `../sqlite.js`, `../database`, and the aliased modules needs a decision.
- [ ] **New `window.AppApi` methods used from stores/views?** Need a `client-web/shims/app-api.js` entry or the web client throws at runtime.
- [ ] **New `worker-timers`/`speechSynthesis`/`window.crypto` usage** in modules the server imports.
- [ ] **New `LINUX`/`isLinux` checks?** `git diff main..upstream/master -G'\bLINUX\b' -- src/`. For each, decide whether it means "Electron shell" (fine as is) or "host OS" (needs `hostOs.js` — see §1's "Build flags are not OS flags").
- [ ] **`handlePipeline` gained event types?** New cases must be forwarded on the client stream.
- [ ] **`Dotnet/WebApi.cs` changed?** `git diff main..upstream/master -- Dotnet/WebApi.cs src/services/webapi.js`. The cookie blob format, the `data:image/png;base64,` prefix, header rules, and the `-1` sentinel are all mirrored in `server/src/shims/webapi.js` and `server/src/cookies.js`.
- [ ] **Did an aliased module gain exports, or did upstream add non-erasable TypeScript?** The mocked unit tests can't see either; only a real boot can. After any sync, run `pnpm run server -- serve` against a scratch DB (`VRCX_DATABASE=<tmp> ... migrate --create` first) and wait for `Serving on` (it takes up to ~2 minutes, and the default port 9000 can be reserved on Windows: set `VRCX_SERVER_PORT`). Found live (2026-10-15): `appearance.js` started importing `setSystemIsDarkMode` from `base/ui.js`, which `server/src/shims/base-ui.js` didn't export, so the server died at import time while all 174 server tests passed. A new `enum`/`namespace`/parameter-property in a `.ts` file would fail the same way, since Node strips only erasable syntax.
- [ ] **New `src/plugins/index.js`/`router.js` importers** in stores/coordinators? Those two aliases are what keep the component/view tree out of the server closure.
- [ ] **New npm dependency in the server's closure?** Add to `server/package.json` *and* root, or the container fails at runtime while dev works. `node server/scripts/check-deps.js` catches version mismatches.
- [ ] **New browser global used at module or store-setup scope?** Fails at import time in Node, not call time. See §3.7.
- [ ] **A `database.*` method now returns a `Map`/`Set`?** `JSON.stringify` silently drops them (`{}`); `server/src/http-server.js`'s `sendJson` replacer already converts both to arrays generically, but confirm the new method is actually routed through `sendJson`.
- [ ] **Reset `server/VERSION` to `1.0` — but only if `Version` (the repo-root file) actually changed.** The reset exists because the synced-to tag changes the *major* component of the next server/Docker release version (§10's "Server/Docker versioning"), restarting the fork's own MINOR.PATCH counter against the new base. Syncing to `master` HEAD (§6, "syncing to master HEAD instead") without a new dated upstream tag leaves `Version` unchanged — found live (2026-08-25): resetting to `1.0` in that case would tag a `v<same-major>.1.0` that's *already been used* by a much earlier release under the same base, since the major component didn't actually move. When `Version` didn't change, keep bumping the existing MINOR/PATCH counter instead, per the ordinary "Cutting a release" rule below.

### 6.3 Verify before pushing the merge

```bash
pnpm install --frozen-lockfile
pnpm run test:server      # the split's own guarantees
pnpm test                 # upstream's suite must not regress
pnpm run lint && pnpm run format:check
node --import ./server/register-hooks.mjs server/src/cli.js info
```

Then, against a **copy** of a real database:

```bash
cp ~/.config/VRCX/VRCX.sqlite3 /tmp/parity.sqlite3
pnpm run server -- migrate --db=/tmp/parity.sqlite3
pnpm run server -- tables --db=/tmp/parity.sqlite3
```

Diff `sqlite_schema` against the same database migrated by the desktop build. They must be identical.
