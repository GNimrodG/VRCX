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

- **Read-only.** `GET` is accepted on `/api/v1/*`; `POST` only on routes that
  declare it (batch lookups whose id list is too long for a URL), and never
  mutates anything. Keys never reach
  `/api/rpc`, the `/api/stream` or `/api/agent` WebSockets, or key management.
- **Local cache first.** Routes read `VRCX.sqlite3` and the already-logged-in
  user in memory. The one exception is `GET /api/v1/users/{userId}`, which may
  fetch a single unknown user from VRChat and cache it (see below); bulk routes
  never call VRChat, and lookups are deduplicated and failures remembered, so a
  consumer can't burn the account's rate limit.
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
| `playtime:read` | `GET /api/v1/time-together`, `POST /api/v1/time-together`, `GET /api/v1/time-together/{userId}` |
| `users:read` | `GET /api/v1/users?ids=`, `POST /api/v1/users`, `GET /api/v1/users/{userId}` |
| `friends:read` | `GET /api/v1/friends` |
| `notes:read` | Adds `note` to user and friend entries; unlocks no route on its own |

New endpoint = add its scope to `SCOPES` in `server/src/api-keys.js` if it needs a new one, add a route entry in `public-api-routes.js`, then `pnpm run openapi`.

## Endpoints

All responses are JSON with `ok`. Errors: `401` missing/invalid/expired key,
`403` key lacks the scope, `405` method not allowed on that path, `404` unknown route (or API disabled).
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
- `POST /api/v1/time-together` is the same for up to 50 users at once, with a JSON body
  `{ "ids": ["usr_…", …], "days"?, "maxOthers"?, "limit"?, "offset"? }` (1-50 distinct
  `usr_` ids; the options mean what the query parameters above do). The response groups by
  user and always includes every requested id, with `total: 0` for someone you haven't met:
  `{ "ok": true, "since": "…", "users": { "<id>": { "total": 3, "results": [ … ] } } }`.
  `limit`/`offset` apply to each user's list separately. The body is capped at 64 KiB.

How it is derived: your stays are `gamelog_location` rows (join time + ms
stayed); another player's presence is an `OnPlayerLeft` row in
`gamelog_join_leave` (leave time, and `time` ms before it for the join). The
interval is their intersection within one instance. Consequences: stays still
in progress (no duration yet) are omitted; only stays that **start** inside the
window are considered; it only covers data recorded by a desktop agent's
game-log forwarding. Instance ids are deliberately not exposed.

### `GET /api/v1/users/{userId}`, `GET /api/v1/users?ids=a,b,c` and `POST /api/v1/users` (`users:read`)

`id`, `displayName`, `profilePictureUrl`, `avatarThumbnailUrl`. The list form and `POST` read only the
server's in-memory user cache; VRChat is never queried. The list form takes up
to 50 ids and returns `{ users: { <id>: {…} }, missing: [ids not cached] }`; the
single form resolves a user in this order: in-memory cache, then the persistent `public_user_cache` table (server-owned,
like `discord_ids`; only the public fields are stored; rows under 24 h old are used as is), then a live VRChat
`users/{id}` fetch which is stored in that table (needs a logged-in server; concurrent requests share one fetch and a
failure is not retried for 5 minutes). A stale row is served if VRChat fails. `404` if none has the user.

`POST /api/v1/users` is the same lookup with the ids in a JSON body, for lists
that would overflow a URL: `{ "ids": ["usr_…", …] }` (1-50 `usr_` ids, duplicates
collapsed), same response. A malformed body or bad id is a `400`; the body is
capped at 64 KiB. The cache fills as the
server sees users (friends, instance members), so someone you only met once
long ago may be missing.

### `GET /api/v1/friends` (`friends:read`)

Your friend list from the server's in-memory friend store; VRChat is never queried. Sorted by name
(case-insensitive), paginated:

```json
{ "ok": true, "total": 212, "results": [
    { "id": "usr_…", "displayName": "Carol", "state": "online", "status": "join me",
      "profilePictureUrl": "https://…", "avatarThumbnailUrl": "https://…" } ] }
```

- `state` is `online`, `active` or `offline`; filter with `?state=online,active` (anything else is a `400`).
- `limit` (default 100, max 500) and `offset` paginate; `total` is the match count before pagination.
- **Deliberately limited:** no location or instance, no status text, no favourites or notes. A friend whose
  profile isn't in the user cache still appears (name from the friend store, empty picture fields).
- `503` while the server isn't logged in to VRChat.

### Discord ids

`/me`, `/users` and `/friends` entries carry `discordId`: the user's Discord user id, or `null`. VRChat only
returns it for users who linked Discord and allow it to be shown, so many users stay `null`. The server records
every id it sees in any VRChat response (`server/src/discord-ids.js`) into a server-owned `discord_ids` table
(`user_id`, `discord_id`, `first_seen`, `last_seen`; global, additive, ignored by the desktop app), so the id
survives restarts and is returned even for users no longer in the cache. A user who later unlinks Discord keeps
their last known id. Nothing extra is fetched from VRChat.

### Notes

A key with `notes:read` (plus `users:read` and/or `friends:read`) gets `note` on user and friend entries: your
private VRChat note on that user, or `null` if there is none. Without the scope the field is absent, so existing
keys don't start exposing notes. Notes come from the server's in-memory note map (synced from VRChat and the
`<user>_notes` table); VRChat is never queried. Notes are private text, so grant the scope sparingly.

### Which picture you get

`profilePictureUrl` is the first non-empty of: `profilePicOverride` (VRChat+ profile picture),
`currentAvatarImageUrl`, `userIcon`, then the fallbacks `imageUrl`, `iconUrl`, `thumbnailUrl`,
`profilePicOverrideThumbnail` and `currentAvatarThumbnailImageUrl`; `avatarThumbnailUrl` prefers the avatar
thumbnail. Which fields VRChat fills varies by user and endpoint, so a user is only reported without a picture
when the cache holds none of them (and an id missing from the cache has no data at all: see `missing`).

## Managing keys

### One form, embedded everywhere

There is exactly one implementation of the key form: the self-contained page the
server serves at **`/admin/api-keys`** (`server/src/api-keys-page.js`). The apps
embed it in an iframe instead of reimplementing it, so it always matches the
server version it manages and there is no second copy to keep in sync.

- **Standalone:** open `/admin/api-keys` on the main (private) server URL while
  signed in to the web client.
- **Web client:** status bar > **Headless** > **Manage API keys**, the same
  indicator and popover as the desktop app (see below). The dialog frames the
  page same-origin, so it uses the session cookie.
- **Desktop app:** status bar > **Headless** > **Manage API keys**. The app's
  page is `file://` and holds no cookie (the login is a token in the main
  process), so the framed page runs in **bridge mode** (`?bridge=1`): it sends
  its three operations (`list`/`create`/`revoke`) to its parent with
  `postMessage`, and the app forwards them over its existing authenticated RPC
  channel (the `apikeys` target in `server/src/rpc.js`). The dialog
  (`src/components/HeadlessApiKeysDialog.vue`) only serves messages from its
  own iframe, from the server's origin, for those three methods, and replies to
  that origin only. The page never sees the session token.
- **Theme and layout:** hosts pass `?theme=dark|light`. When framed, the page
  hides its own heading, drops its padding and has a transparent background so
  it sits flush in the host's dialog. The host dialog never scrolls on its own:
  it gets a bounded height and the frame fills it, so the framed page is the
  only scroller (no double scrollbars on short screens).
- Before framing, the dialog checks the API is enabled (the web client fetches
  `/api/v1/openapi.json`, the desktop calls `apikeys.list`). Otherwise a
  disabled server would answer `/admin/api-keys` with the web client itself.

**Framing rules.** The server only lets its own origin frame the page
(`frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN`), which is all the
web client needs. The desktop app's `file://` page is a different origin, so
`src-electron/apiKeysFrame.js` (wired in `main.js`) strips those headers for
exactly one request shape: that URL, as a sub-frame, on the server the app is
connected to. The server never allows `file://` or carries an allowed-origins
list. The directive is *removed*, not set to `*`, because CSP's `*` never
matches `file:` (found live in Electron). A hostile page framing it gets
nothing: standalone auth is `SameSite=Strict`, so there is no cookie in that
context, and the page only talks to its parent.

- **Session-gated.** The page itself holds no data; it only calls the
  session-authenticated key routes. Signed out it says so and links to the client.
  An API key can never be used here.
- **Hardened.** The CSP pins the inline script by hash (no `unsafe-inline` for
  scripts) and blocks external loads; all dynamic text is set via `textContent`.
  It is not served on the public-only listener.
- With the API disabled the path falls through like any unknown URL.

### The Headless status-bar entry (web and desktop)

`src/components/HeadlessServerStatus.vue` is one component on both clients: a
status dot and the server's host in the status bar, and a popover with the
server list and the API keys section. Only the backend differs:

| | Desktop (Electron) | Web client |
|---|---|---|
| Active server | the paired server, via the main process | the page's own origin |
| Other servers | paired and stored by the main process, with TOTP pairing, a default (★) and a custom CA cert | links remembered in this browser only (`localStorage` key `vrcx_headless_servers`), added by URL |
| Choosing one | confirm, then the app restarts against it | confirm, then a **full-page navigation** to that server; its own web client does its own sign-in |
| Reachability | pushed by the main process | a check on load and when the popover opens, plus the browser's `online`/`offline` events (no polling) |
| API keys | **Manage API keys** (in-app dialog) and **Open in browser** | **Manage API keys** |

The status bar's right-click menu has the same "Headless" visibility toggle on
both. The remembered links are per browser and never sent to any server.

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
