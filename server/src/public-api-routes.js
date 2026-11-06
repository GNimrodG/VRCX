/**
 * The `/api/v1/*` route table: the single source of truth for the external
 * API. `./public-api.js` dispatches from it and `buildOpenApiSpec()` generates
 * the OpenAPI document from it (served at `/api/v1/openapi.json`, committed as
 * `docs/openapi.json`, kept honest by `test/openapi.test.js`). Add a route by
 * adding an entry here; nothing else describes the API.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Same preference order as `userImageFull` in `src/shared/utils/user.js`.
 *
 * @param {any} user
 * @returns {string}
 */
function profilePictureUrl(user) {
    return user.profilePicOverride || user.currentAvatarImageUrl || user.userIcon || '';
}

/**
 * @param {string | null} raw
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
function intParam(raw, fallback, max) {
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return Math.min(parsed, max);
}

const MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {import('./db.js').DatabaseHandle} handle
 * @param {() => any} getCurrentUser
 * @returns {Promise<string>} The local user's id, '' if unknown
 */
async function resolveSelfId(handle, getCurrentUser) {
    return getCurrentUser()?.id || (await handle.configRepository.getString('lastUserLoggedIn', ''));
}

/**
 * Intervals during which the local user and another player were in the same
 * instance, derived from the game log:
 *
 * - The local user's stays are `gamelog_location` rows (`created_at` = join, `time` = ms stayed, written on leaving);
 * - Another player's presence ends at an `OnPlayerLeft` row's `created_at` and began `time` ms earlier. The
 *   together-interval is the intersection of the two within one location. `otherPlayerCount` is the number of _other_
 *   distinct players (neither the local user nor the subject) present at any point during that interval, so 0 means a
 *   1-on-1. Stays still in progress have no duration yet and are omitted. Only stays starting inside the window are
 *   considered.
 *
 * @param {import('./db.js').DatabaseHandle} handle
 * @param {string} selfId
 * @param {{ userId?: string; days: number; maxOthers: number | null }} query
 * @returns {{ userId: string; start: string; end: string; durationMs: number; otherPlayerCount: number }[]} Newest
 *   first
 */
function computeTogether(handle, selfId, { userId, days, maxOthers }) {
    const since = new Date(Date.now() - days * DAY_MS).toISOString();
    const stays = handle.sqlite.Execute(
        `SELECT created_at, location, time FROM gamelog_location
         WHERE created_at >= @since AND time > 0 AND location != ''`,
        { '@since': since }
    );
    const leaves = handle.sqlite.Execute(
        `SELECT user_id, location, created_at, time FROM gamelog_join_leave
         WHERE type = 'OnPlayerLeft' AND user_id != '' AND time > 0
           AND created_at >= @since`,
        { '@since': since }
    );
    /** @type {Map<string, { userId: string; start: number; end: number }[]>} */
    const byLocation = new Map();
    for (const [uid, location, createdAt, time] of leaves) {
        if (uid === selfId) {
            continue;
        }
        const end = Date.parse(createdAt);
        if (Number.isNaN(end)) {
            continue;
        }
        const list = byLocation.get(location) ?? [];
        list.push({ userId: uid, start: end - time, end });
        byLocation.set(location, list);
    }
    const results = [];
    for (const [createdAt, location, time] of stays) {
        const stayStart = Date.parse(createdAt);
        const stayEnd = stayStart + time;
        const present = byLocation.get(location);
        if (!present || Number.isNaN(stayStart)) {
            continue;
        }
        for (const subject of present) {
            if (userId && subject.userId !== userId) {
                continue;
            }
            const start = Math.max(stayStart, subject.start);
            const end = Math.min(stayEnd, subject.end);
            if (end <= start) {
                continue;
            }
            const others = new Set();
            for (const other of present) {
                if (other.userId !== subject.userId && other.start < end && other.end > start) {
                    others.add(other.userId);
                }
            }
            if (maxOthers !== null && others.size > maxOthers) {
                continue;
            }
            results.push({
                userId: subject.userId,
                start: new Date(start).toISOString(),
                end: new Date(end).toISOString(),
                durationMs: end - start,
                otherPlayerCount: others.size
            });
        }
    }
    return results.sort((x, y) => y.start.localeCompare(x.start));
}

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

/** @type {Record<string, object>} */
export const schemas = {
    Error: {
        type: 'object',
        required: ['ok', 'error'],
        properties: {
            ok: { type: 'boolean', enum: [false] },
            error: { type: 'string' }
        }
    },
    CurrentUser: {
        type: 'object',
        required: ['id', 'displayName', 'profilePictureUrl', 'avatarThumbnailUrl'],
        properties: {
            id: { type: 'string', example: 'usr_00000000-0000-0000-0000-000000000000' },
            displayName: { type: 'string' },
            profilePictureUrl: {
                type: 'string',
                description: 'Profile picture override, else current avatar image, else user icon. Empty if none.'
            },
            avatarThumbnailUrl: { type: 'string' }
        }
    },
    TogetherInterval: {
        type: 'object',
        required: ['userId', 'start', 'end', 'durationMs', 'otherPlayerCount'],
        properties: {
            userId: {
                type: 'string',
                description: 'The other player. Look up details with /api/v1/users.'
            },
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
            durationMs: { type: 'integer', minimum: 1 },
            otherPlayerCount: {
                type: 'integer',
                minimum: 0,
                description:
                    'Distinct other players (not you, not userId) present at any point during the interval. 0 = 1-on-1.'
            }
        }
    },
    CachedUser: {
        type: 'object',
        required: ['id', 'displayName', 'profilePictureUrl', 'avatarThumbnailUrl'],
        properties: {
            id: { type: 'string' },
            displayName: { type: 'string' },
            profilePictureUrl: { type: 'string' },
            avatarThumbnailUrl: { type: 'string' }
        }
    }
};

const errorResponses = (...codes) =>
    Object.fromEntries(
        codes.map((code) => [
            String(code),
            {
                description: {
                    401: 'Missing, invalid or expired API key',
                    403: 'Key lacks the required scope',
                    404: 'Not found (or user not in the cache)',
                    503: 'The server is not logged in to VRChat right now'
                }[code],
                content: { 'application/json': { schema: ref('Error') } }
            }
        ])
    );

const okEnvelope = (key, schema) => ({
    type: 'object',
    required: ['ok', key],
    properties: { ok: { type: 'boolean', enum: [true] }, [key]: schema }
});

/**
 * @typedef {object} RouteContext
 * @property {import('./db.js').DatabaseHandle} handle
 * @property {() => any} getCurrentUser
 * @property {(id: string) => any} getCachedUser
 * @property {URL} url
 * @property {Record<string, string>} params
 * @property {any} [body] Parsed JSON body (`POST` routes only)
 *
 * @typedef {object} Route
 * @property {'GET' | 'POST'} [method] Defaults to `GET`. `POST` exists only to carry data too long for a query string
 *   (a batch of ids); it never mutates anything.
 * @property {string} path OpenAPI-style template, e.g. `/api/v1/x/{id}`
 * @property {object} [requestBody] OpenAPI request body object
 * @property {string} scope
 * @property {string} operationId
 * @property {string} summary
 * @property {string} [description]
 * @property {object[]} [parameters] OpenAPI parameter objects
 * @property {Record<string, object>} responses
 * @property {(ctx: RouteContext) => { status: number; body: any } | Promise<{ status: number; body: any }>} handler
 */

const MAX_IDS = 50;

/** @param {any} user */
function publicUser(user) {
    return {
        id: user.id,
        displayName: user.displayName,
        profilePictureUrl: profilePictureUrl(user),
        avatarThumbnailUrl: user.currentAvatarThumbnailImageUrl || ''
    };
}

/**
 * @param {string[]} rawIds
 * @param {(id: string) => any} getCachedUser
 * @returns {{ status: number; body: any }}
 */
function lookupUsers(rawIds, getCachedUser) {
    const ids = [...new Set(rawIds)];
    if (ids.length === 0 || ids.length > MAX_IDS) {
        return { status: 400, body: { ok: false, error: `ids must list 1-${MAX_IDS} user ids` } };
    }
    const users = {};
    const missing = [];
    for (const id of ids) {
        const user = getCachedUser(id);
        if (user) {
            users[id] = publicUser(user);
        } else {
            missing.push(id);
        }
    }
    return { status: 200, body: { ok: true, users, missing } };
}

const usersResponses = {
    200: {
        description: 'Cached users keyed by id',
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['ok', 'users', 'missing'],
                    properties: {
                        ok: { type: 'boolean', enum: [true] },
                        users: { type: 'object', additionalProperties: ref('CachedUser') },
                        missing: { type: 'array', items: { type: 'string' } }
                    }
                }
            }
        }
    },
    400: { description: 'Missing ids or too many', content: { 'application/json': { schema: ref('Error') } } },
    ...errorResponses(401, 403)
};

const togetherResponses = {
    200: {
        description: 'Intervals, newest first',
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['ok', 'since', 'total', 'results'],
                    properties: {
                        ok: { type: 'boolean', enum: [true] },
                        since: { type: 'string', format: 'date-time', description: 'Start of the window used' },
                        total: { type: 'integer', description: 'Matching intervals before pagination' },
                        results: { type: 'array', items: ref('TogetherInterval') }
                    }
                }
            }
        }
    },
    ...errorResponses(401, 403)
};

/** @param {boolean} fromPath Whether userId comes from the path */
function togetherHandler(fromPath) {
    return async ({ handle, getCurrentUser, url, params }) => {
        const days = Math.max(1, intParam(url.searchParams.get('days'), MAX_DAYS, MAX_DAYS));
        const maxRaw = url.searchParams.get('maxOthers');
        const all = computeTogether(handle, await resolveSelfId(handle, getCurrentUser), {
            userId: fromPath ? params.userId : undefined,
            days,
            maxOthers: maxRaw === null ? null : intParam(maxRaw, 0, 1e6)
        });
        const limit = Math.max(1, intParam(url.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT));
        const offset = intParam(url.searchParams.get('offset'), 0, 1e9);
        return {
            status: 200,
            body: {
                ok: true,
                since: new Date(Date.now() - days * DAY_MS).toISOString(),
                total: all.length,
                results: all.slice(offset, offset + limit)
            }
        };
    };
}

/** @type {Route[]} */
export const routes = [
    {
        path: '/api/v1/me',
        scope: 'profile:read',
        operationId: 'getMe',
        summary: 'Current user',
        description: 'The VRChat account the server is logged in as: name and profile picture.',
        responses: {
            200: {
                description: 'The current user',
                content: {
                    'application/json': { schema: okEnvelope('user', ref('CurrentUser')) }
                }
            },
            ...errorResponses(401, 403, 503)
        },
        handler({ getCurrentUser }) {
            const user = getCurrentUser();
            if (!user?.id) {
                return {
                    status: 503,
                    body: {
                        ok: false,
                        error: 'The server is not logged in to VRChat right now'
                    }
                };
            }
            return {
                status: 200,
                body: {
                    ok: true,
                    user: {
                        id: user.id,
                        displayName: user.displayName,
                        profilePictureUrl: profilePictureUrl(user),
                        avatarThumbnailUrl: user.currentAvatarThumbnailImageUrl || ''
                    }
                }
            };
        }
    },
    {
        path: '/api/v1/time-together',
        scope: 'playtime:read',
        operationId: 'listTimeTogether',
        summary: 'When you were in the same instance as other players',
        description:
            'One entry per shared-instance interval (start, end, duration, number of other players present), newest first, for calendar mapping. Entries carry only user ids; resolve names with /api/v1/users. Limited to the last 90 days and paginated.',
        parameters: [
            {
                name: 'days',
                in: 'query',
                description: `Look-back window in days; stays starting earlier are excluded. Capped at ${MAX_DAYS}.`,
                schema: { type: 'integer', minimum: 1, maximum: MAX_DAYS, default: MAX_DAYS }
            },
            {
                name: 'maxOthers',
                in: 'query',
                description: 'Only intervals with at most this many other players. 0 = 1-on-1 only.',
                schema: { type: 'integer', minimum: 0 }
            },
            {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT }
            },
            {
                name: 'offset',
                in: 'query',
                schema: { type: 'integer', minimum: 0, default: 0 }
            }
        ],
        responses: togetherResponses,
        handler: togetherHandler(false)
    },
    {
        path: '/api/v1/time-together/{userId}',
        scope: 'playtime:read',
        operationId: 'getTimeTogether',
        summary: 'When you were in the same instance as one user',
        description: 'Same as the list, for a single user. Empty `results` if you have not met.',
        parameters: [
            {
                name: 'userId',
                in: 'path',
                required: true,
                schema: { type: 'string', pattern: '^usr_[0-9a-f-]+$' }
            },
            {
                name: 'days',
                in: 'query',
                description: `Look-back window in days; stays starting earlier are excluded. Capped at ${MAX_DAYS}.`,
                schema: { type: 'integer', minimum: 1, maximum: MAX_DAYS, default: MAX_DAYS }
            },
            {
                name: 'maxOthers',
                in: 'query',
                description: 'Only intervals with at most this many other players. 0 = 1-on-1 only.',
                schema: { type: 'integer', minimum: 0 }
            },
            {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT }
            },
            {
                name: 'offset',
                in: 'query',
                schema: { type: 'integer', minimum: 0, default: 0 }
            }
        ],
        responses: togetherResponses,
        handler: togetherHandler(true)
    },
    {
        path: '/api/v1/users',
        scope: 'users:read',
        operationId: 'getUsers',
        summary: 'Cached details for several users',
        description: `Name and picture for up to ${MAX_IDS} user ids, from the server's cache only (VRChat is never queried). Ids not cached are listed in \`missing\`.`,
        parameters: [
            {
                name: 'ids',
                in: 'query',
                required: true,
                description: 'Comma-separated user ids',
                schema: { type: 'string' }
            }
        ],
        responses: usersResponses,
        handler({ getCachedUser, url }) {
            return lookupUsers((url.searchParams.get('ids') ?? '').split(',').filter(Boolean), getCachedUser);
        }
    },
    {
        method: 'POST',
        path: '/api/v1/users',
        scope: 'users:read',
        operationId: 'postUsers',
        summary: 'Cached details for several users (ids in the body)',
        description: `Same as GET /api/v1/users, with the ids in a JSON body instead of the query string, so long lists don't hit URL length limits. Up to ${MAX_IDS} ids; VRChat is never queried. Ids not cached are listed in \`missing\`. Read-only: nothing is created or changed.`,
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['ids'],
                        properties: {
                            ids: {
                                type: 'array',
                                minItems: 1,
                                maxItems: MAX_IDS,
                                items: { type: 'string', pattern: '^usr_[0-9a-f-]+$' }
                            }
                        }
                    }
                }
            }
        },
        responses: usersResponses,
        handler({ getCachedUser, body }) {
            const ids = body?.ids;
            if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && /^usr_[0-9a-f-]+$/.test(id))) {
                return { status: 400, body: { ok: false, error: 'body must be { "ids": ["usr_…", …] }' } };
            }
            return lookupUsers(ids, getCachedUser);
        }
    },
    {
        path: '/api/v1/users/{userId}',
        scope: 'users:read',
        operationId: 'getUser',
        summary: 'Cached details for one user',
        parameters: [
            {
                name: 'userId',
                in: 'path',
                required: true,
                schema: { type: 'string', pattern: '^usr_[0-9a-f-]+$' }
            }
        ],
        responses: {
            200: {
                description: 'The cached user',
                content: { 'application/json': { schema: okEnvelope('user', ref('CachedUser')) } }
            },
            ...errorResponses(401, 403, 404)
        },
        handler({ getCachedUser, params }) {
            const user = getCachedUser(params.userId);
            if (!user) {
                return { status: 404, body: { ok: false, error: 'User is not in the cache' } };
            }
            return { status: 200, body: { ok: true, user: publicUser(user) } };
        }
    }
];

/**
 * @param {Route} route
 * @returns {RegExp} Matcher with one named group per `{param}`
 */
function pathMatcher(route) {
    const source = route.path
        .split('/')
        .map((segment) => {
            const param = /^\{(\w+)\}$/.exec(segment);
            const declared = param ? route.parameters?.find((p) => p.in === 'path' && p.name === param[1]) : null;
            return param
                ? `(?<${param[1]}>${(declared?.schema?.pattern ?? '^[^/]+$').replace(/^\^|\$$/g, '')})`
                : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
    return new RegExp(`^${source}$`);
}

const matchers = new Map(routes.map((route) => [route, pathMatcher(route)]));

/**
 * @param {string} pathname
 * @param {string} [method] Matches only routes with this method; omit to match any
 * @returns {{ route: Route; params: Record<string, string> } | null}
 */
export function matchRoute(pathname, method) {
    for (const route of routes) {
        if (method && (route.method ?? 'GET') !== method) {
            continue;
        }
        const match = matchers.get(route).exec(pathname);
        if (match) {
            return { route, params: { ...match.groups } };
        }
    }
    return null;
}

/**
 * @param {string} pathname
 * @returns {string[]} Methods some route accepts at this path (empty = no such path)
 */
export function allowedMethods(pathname) {
    return routes.filter((route) => matchers.get(route).test(pathname)).map((route) => route.method ?? 'GET');
}

/**
 * @param {Record<string, string>} scopes The registry from `./api-keys.js`
 * @returns {object} An OpenAPI 3.1 document
 */
export function buildOpenApiSpec(scopes) {
    const paths = {};
    for (const route of routes) {
        paths[route.path] ??= {};
        paths[route.path][(route.method ?? 'GET').toLowerCase()] = {
            operationId: route.operationId,
            summary: route.summary,
            ...(route.description ? { description: route.description } : {}),
            tags: [route.scope.split(':')[0]],
            security: [{ apiKey: [] }],
            'x-required-scope': route.scope,
            ...(route.parameters ? { parameters: route.parameters } : {}),
            ...(route.requestBody ? { requestBody: route.requestBody } : {}),
            responses: route.responses
        };
    }
    return {
        openapi: '3.1.0',
        info: {
            title: 'VRCX-Headless external API',
            version: '1',
            description:
                "Read-only, API-key-authenticated access to the headless server's local cache (POST is used only to send long id lists in a body). Opt-in via VRCX_API_ENABLED. Scopes: " +
                Object.entries(scopes)
                    .map(([name, what]) => `\`${name}\` (${what})`)
                    .join('; ') +
                '.'
        },
        paths,
        components: {
            securitySchemes: {
                apiKey: {
                    type: 'http',
                    scheme: 'bearer',
                    description: 'A key from POST /api/keys: `Authorization: Bearer vrcx_<id>_<secret>`'
                }
            },
            schemas
        }
    };
}
