# External read-only API

Persistent, scope-limited API keys let external tools (a stream overlay, a bot,
a personal site) read from the headless server's local cache. Code:
`server/src/api-keys.js` (keys), `server/src/public-api-routes.js` (route table + OpenAPI generation), `server/src/public-api.js` (dispatch and the
public-only listener), tests in `server/test/api-keys.test.js`.

This feature is **off by default** and lives entirely under `server/`, so it
adds no upstream-merge surface.

## Enabling

| Variable | Effect |
|---|---|
| `VRCX_API_ENABLED=1` | Turns the feature on (`1`/`true`/`yes`/`on`). Without it, `/api/v1/*` and `/api/keys` return 404 like any unknown path, and the public listener never starts. |
| `VRCX_PUBLIC_API_PORT` | Opens a second listener serving **only** `/api/v1/*` (needs `VRCX_API_ENABLED`; if set without it, a warning is logged and the API stays off). |
| `VRCX_PUBLIC_API_HOST` | Bind address for that listener, default `0.0.0.0`. |

The public listener reuses the main listener's TLS cert/key when configured;
otherwise terminate TLS in a reverse proxy.

## Design

- **Read-only.** Only `GET` is accepted on `/api/v1/*`. Keys never reach
  `/api/rpc`, the `/api/stream` or `/api/agent` WebSockets, or key management.
- **Local cache only.** Routes read `VRCX.sqlite3` and the already-logged-in
  user in memory. They never call VRChat, so a consumer can't burn the
  account's rate limit.
- **Hand-written allowlist.** Each route names one scope and shapes its own
  response; internal DB/config details never become a public contract.
- **Key format** `vrcx_<id>_<secret>`: `id` is 8 hex characters (a public
  lookup handle), `secret` is 32 random bytes, base64url. Only
  `sha256(secret)` is stored, in the `VRCX_ServerApiKeys` config entry (a JSON
  array; no schema change, so the DB stays readable by the desktop app). The
  plaintext is returned once, at creation.
- **Sent as** `Authorization: Bearer <key>` only, never a cookie or query
  string, so keys stay out of browser state and access logs.
- **Revocation** is immediate (the list is read per request). `lastUsedAt` is
  persisted at most every 5 minutes per key.
- **Separate listener** (`VRCX_PUBLIC_API_PORT`): login, `/api/rpc`,
  `/api/keys`, WebSockets and the web client do not exist on it. Prefer this to
  path-filtering in a proxy.
- **No rate limiting** on failed attempts: a 256-bit secret can't realistically
  be guessed. Put a proxy in front if you want one anyway.

## OpenAPI spec

The routes are a single table in `server/src/public-api-routes.js` (path,
scope, parameters, response schema, handler); the server dispatches from it and
the spec is generated from it, so they cannot describe different things.

- Live: `GET /api/v1/openapi.json` (no key needed; it describes the API but
  exposes no data, and exists only when the API is enabled).
- Committed: [`docs/openapi.json`](openapi.json). Regenerate with
  `pnpm run openapi` after changing a route; `server/test/openapi.test.js`
  fails if the committed file is stale, and also checks scopes, `$ref`s and
  that every path is routable.

## Scopes

| Scope | Unlocks |
|---|---|
| `profile:read` | `GET /api/v1/me` |
| `playtime:read` | `GET /api/v1/time-together`, `GET /api/v1/time-together/{userId}` |
| `users:read` | `GET /api/v1/users?ids=`, `GET /api/v1/users/{userId}` |

New endpoint = add its scope to `SCOPES` in `server/src/api-keys.js` if it needs a new one, add a route entry in `public-api-routes.js`, then `pnpm run openapi`.

## Endpoints

All responses are JSON with `ok`. Errors: `401` missing/invalid/expired key,
`403` key lacks the scope, `405` non-GET, `404` unknown route (or API disabled).
Full schemas: [`openapi.json`](openapi.json).

### `GET /api/v1/me` (`profile:read`)

Current user: `id`, `displayName`, `profilePictureUrl` (profile picture override,
else current avatar image, else user icon), `avatarThumbnailUrl`. `503` while the
server isn't logged in to VRChat.

### `GET /api/v1/time-together` (`playtime:read`)

*When* you were in the same instance as another player, for mapping onto a
calendar. One entry per shared stay, newest first:

```json
{ "ok": true, "since": "2026-08-07T11:41:25Z", "total": 3, "results": [
    { "userId": "usr_…", "start": "2026-11-03T11:40:51Z", "end": "2026-11-03T12:30:51Z",
      "durationMs": 3000000, "otherPlayerCount": 1 } ] }
```

- **Keyed by user id only.** No names; resolve them with `/api/v1/users`.
- `otherPlayerCount` is the number of *other* distinct players (not you, not
  `userId`) present at any point during the interval, so `0` is a 1-on-1 and
  larger values are group hangouts.
- Query: `days` (default and **maximum 90**), `maxOthers` (e.g. `0` for 1-on-1
  only), `limit` (default 100, max 500), `offset`. `total` is the match count
  before pagination.
- `GET /api/v1/time-together/{userId}` is the same, for one user.

How it is derived: your stays are `gamelog_location` rows (join time + ms
stayed); another player's presence is an `OnPlayerLeft` row in
`gamelog_join_leave` (leave time, and `time` ms before it for the join). The
interval is their intersection within one instance. Consequences: stays still
in progress (no duration yet) are omitted; only stays that **start** inside the
window are considered; it only covers data recorded by a desktop agent's
game-log forwarding. Instance ids are deliberately not exposed.

### `GET /api/v1/users/{userId}` and `GET /api/v1/users?ids=a,b,c` (`users:read`)

Cached `id`, `displayName`, `profilePictureUrl`, `avatarThumbnailUrl`, from the
server's in-memory user cache; VRChat is never queried. The list form takes up
to 50 ids and returns `{ users: { <id>: {…} }, missing: [ids not cached] }`; the
single form returns `404` if the user isn't cached. The cache fills as the
server sees users (friends, instance members), so someone you only met once
long ago may be missing.

## Managing keys

### In the desktop app

Click the **Headless** indicator in the status bar, then **Manage API keys**: a
dialog (`src/components/HeadlessApiKeysDialog.vue`, fork-only, mounted from
`HeadlessServerStatus.vue`) opens over the app, like the changelog. It talks to
the server over the desktop's existing authenticated RPC channel (the
`apikeys` target in `server/src/rpc.js`, a twin of `/api/keys` that only exists
while the API is enabled), so there is no browser sign-in. If the API is off it
says so. The new key is held in memory only until the dialog closes. **Open in
browser** next to it opens the standalone page below. The status-bar indicator
is only mounted on the Electron build, so the plain web client uses the
standalone page.

### Standalone web page

With the API enabled, open **`/admin/api-keys`** on the main (private) server
URL while signed in to the web client. Create a key (name, scopes, expiry),
copy it from the one-time reveal box, see each key's scopes, expiry and last
use, and revoke with a two-click confirm.

- **Fork-only, zero merge surface.** A single self-contained page served by the
  server (`server/src/api-keys-page.js`), not part of the upstream Vue client:
  no client build, no edits under `src/**`, and it works on an API-only
  container. The web client has no link to it; bookmark the URL.
- **Session-gated.** The page holds no data. It calls `/api/keys` with the
  browser's `HttpOnly` session cookie, so it only works from a logged-in web
  client session; signed out, it says so and links to the client. An API key
  can never be used here.
- **Hardened.** The CSP pins the inline script by hash (no `unsafe-inline` for
  scripts) and blocks framing and external loads; all dynamic text is set via
  `textContent`. It is not served on the public-only listener.
- With the API disabled the path falls through like any unknown URL.

### HTTP

The UI uses the same routes you can call directly with a bearer session
(`/api/login`) instead of the cookie. Management is over HTTP rather than a CLI
because `serve` holds the database write lock, so a second process can't write
while it runs. A key can never manage keys.

```bash
TOKEN=$(curl -s localhost:9000/api/login -H 'Content-Type: application/json' \
  -d '{"code":"123456"}' | jq -r .token)
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

# create (key shown once; expiresAt optional, null = never)
curl -s localhost:9000/api/keys "${H[@]}" \
  -d '{"name":"stream overlay","scopes":["profile:read","playtime:read"]}'
# list (no secrets) plus the valid scopes
curl -s localhost:9000/api/keys "${H[@]}"
# revoke
curl -s -X DELETE localhost:9000/api/keys/<id> "${H[@]}"

# use
curl -s https://api.example.com/api/v1/me -H 'Authorization: Bearer vrcx_<id>_<secret>'
```
