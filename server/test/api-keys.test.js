/**
 * API keys (`src/api-keys.js`) and the `/api/v1/*` read-only surface
 * (`src/public-api.js`), end to end over a real listening server.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDatabase } from '../src/db.js';
import { createSession, setServerTotp } from '../src/http-auth.js';
import { createHttpServer } from '../src/http-server.js';
import { generateTotpSecret } from '../src/totp.js';

describe('API keys', () => {
    let dir, handle, server, origin, session;
    const user = {
        id: 'usr_me',
        displayName: 'Me',
        currentAvatarImageUrl: 'https://img/full.png',
        currentAvatarThumbnailImageUrl: 'https://img/thumb.png'
    };

    const call = (p, { key, method = 'GET', body } = {}) =>
        fetch(`${origin}${p}`, {
            method,
            headers: {
                ...(key ? { Authorization: `Bearer ${key}` } : {}),
                'Content-Type': 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const mint = (scopes, extra = {}) =>
        call('/api/keys', {
            key: session,
            method: 'POST',
            body: { name: 'test', scopes, ...extra }
        });

    beforeAll(async () => {
        dir = mkdtempSync(path.join(tmpdir(), 'vrcx-headless-apikeys-'));
        handle = await openDatabase({
            databasePath: path.join(dir, 'VRCX.sqlite3'),
            create: true
        });
        await handle.configRepository.init();
        await setServerTotp(handle, generateTotpSecret());
        await handle.database.initTables();
        session = await createSession(handle);
        // Relative to now so the 90-day window is exercised deterministically.
        const now = Date.now(); // pinned: per-row Date.now() skews durations by 1ms
        const t = (daysAgo, minutes = 0) => new Date(now - daysAgo * 864e5 + minutes * 6e4).toISOString();
        const ms = (m) => m * 6e4;
        const leave = (user, name, loc, end, minutes) =>
            `('${end}','OnPlayerLeft','${name}','${loc}','${user}',${ms(minutes)})`;
        handle.sqlite.ExecuteNonQuery(
            `INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name) VALUES
             ('${t(2)}','wrld_a:1','wrld_a','A',${ms(60)},''),
             ('${t(1)}','wrld_a:2','wrld_a','A',${ms(30)},''),
             ('${t(3)}','wrld_a:4','wrld_a','A',${ms(20)},''),
             ('${t(200)}','wrld_a:3','wrld_a','A',${ms(30)},'')`
        );
        // wrld_a:1 — Alice 1-on-1 for 20min, then Bob joins; both stay.
        // wrld_a:2 — Alice and Bob together the whole 30min.
        // wrld_a:3 — 200 days ago, outside the window.
        handle.sqlite.ExecuteNonQuery(
            `INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time) VALUES
             ${[
                 leave('usr_00000000-0000-0000-0000-00000000000a', 'Alice', 'wrld_a:1', t(2, 50), 50),
                 leave('usr_00000000-0000-0000-0000-00000000000b', 'Bob', 'wrld_a:1', t(2, 40), 20),
                 leave('usr_00000000-0000-0000-0000-00000000000a', 'Alice', 'wrld_a:2', t(1, 30), 30),
                 leave('usr_00000000-0000-0000-0000-00000000000b', 'Bob', 'wrld_a:2', t(1, 30), 30),
                 leave('usr_00000000-0000-0000-0000-00000000000a', 'Alice', 'wrld_a:4', t(3, 20), 20),
                 leave('usr_00000000-0000-0000-0000-00000000000a', 'Alice', 'wrld_a:3', t(200, 30), 30),
                 leave('usr_me', 'Me', 'wrld_a:1', t(2, 60), 60)
             ].join(',')}`
        );
        ({ server } = await createHttpServer(handle, {
            apiEnabled: true,
            getCurrentUser: () => user,
            getCachedUser: (id) =>
                id === 'usr_00000000-0000-0000-0000-00000000000a'
                    ? {
                          id,
                          displayName: 'Alice',
                          currentAvatarImageUrl: 'https://img/a.png',
                          currentAvatarThumbnailImageUrl: 'https://img/at.png'
                      }
                    : null
        }));
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        origin = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
        await new Promise((r) => server.close(r));
        handle.close();
        rmSync(dir, { recursive: true, force: true });
    });

    it('requires a session to manage keys, and a key never counts as one', async () => {
        expect((await call('/api/keys')).status).toBe(401);
        const { body } = await mint(['profile:read']);
        expect((await call('/api/keys', { key: body.key })).status).toBe(401);
    });

    it('rejects unknown scopes and empty scope lists', async () => {
        expect((await mint(['nope'])).status).toBe(400);
        expect((await mint([])).status).toBe(400);
    });

    it('serves the profile with profile:read and only stores a hash', async () => {
        const { body } = await mint(['profile:read']);
        const me = await call('/api/v1/me', { key: body.key });
        expect(me.status).toBe(200);
        expect(me.body.user).toMatchObject({
            id: 'usr_me',
            displayName: 'Me',
            profilePictureUrl: 'https://img/full.png'
        });
        const stored = await handle.configRepository.getString('VRCX_ServerApiKeys', '');
        expect(stored).not.toContain(body.key.split('_').slice(2).join('_'));
        const listed = await call('/api/keys', { key: session });
        expect(JSON.stringify(listed.body)).not.toContain('hash');
    });

    it('enforces scopes and rejects bad credentials', async () => {
        const { body } = await mint(['profile:read']);
        expect((await call('/api/v1/time-together', { key: body.key })).status).toBe(403);
        expect((await call('/api/v1/me')).status).toBe(401);
        expect((await call('/api/v1/me', { key: body.key.slice(0, -1) + 'x' })).status).toBe(401);
        expect((await call('/api/v1/me', { key: body.key, method: 'POST' })).status).toBe(405);
    });

    it('reports co-presence intervals with other-player counts, windowed to 90 days', async () => {
        const { body } = await mint(['playtime:read']);
        const A = 'usr_00000000-0000-0000-0000-00000000000a';
        const list = await call('/api/v1/time-together', { key: body.key });
        expect(list.status).toBe(200);
        // the 200-day-old stay and the local user are absent
        const rows = list.body.results.map((r) => `${r.userId.slice(-1)}:${r.durationMs / 6e4}:${r.otherPlayerCount}`);
        expect([...rows].sort()).toEqual(['a:20:0', 'a:30:1', 'a:50:1', 'b:20:1', 'b:30:1']);
        // newest first, with real timestamps
        const starts = list.body.results.map((r) => r.start);
        expect(starts).toEqual([...starts].sort().reverse());
        expect(list.body.results[0].end > list.body.results[0].start).toBe(true);
        expect(list.body.total).toBe(5);
        expect(list.body.results[0]).toHaveProperty('start');
        expect(list.body.results[0]).toHaveProperty('end');
        expect(JSON.stringify(list.body)).not.toContain('Alice');

        const onlyA = await call(`/api/v1/time-together/${A}`, { key: body.key });
        expect(onlyA.body.results.every((r) => r.userId === A)).toBe(true);
        expect(onlyA.body.results).toHaveLength(3);

        const oneOnOne = await call('/api/v1/time-together?maxOthers=0', { key: body.key });
        expect(oneOnOne.body.results.map((r) => r.durationMs / 6e4)).toEqual([20]);

        const page = await call('/api/v1/time-together?limit=1&offset=1', { key: body.key });
        expect(page.body.results).toHaveLength(1);
        expect(page.body.total).toBe(5);

        const wide = await call('/api/v1/time-together?days=9999', { key: body.key });
        expect(wide.body.total).toBe(5); // days is capped at 90
    });

    it('looks up cached users by id, sharing nothing else', async () => {
        const { body } = await mint(['users:read']);
        const one = await call('/api/v1/users/usr_00000000-0000-0000-0000-00000000000a', { key: body.key });
        expect(one.body.user).toMatchObject({ displayName: 'Alice', profilePictureUrl: 'https://img/a.png' });
        expect(Object.keys(one.body.user).sort()).toEqual([
            'avatarThumbnailUrl',
            'displayName',
            'id',
            'profilePictureUrl'
        ]);
        expect((await call('/api/v1/users/usr_00000000-0000-0000-0000-0000000000ff', { key: body.key })).status).toBe(
            404
        );
        const many = await call('/api/v1/users?ids=usr_00000000-0000-0000-0000-00000000000a,usr_x', { key: body.key });
        expect(Object.keys(many.body.users)).toEqual(['usr_00000000-0000-0000-0000-00000000000a']);
        expect(many.body.missing).toEqual(['usr_x']);
        expect((await call('/api/v1/users', { key: body.key })).status).toBe(400);
        expect(
            (
                await call('/api/v1/users/usr_00000000-0000-0000-0000-00000000000a', {
                    key: (await mint(['playtime:read'])).body.key
                })
            ).status
        ).toBe(403);
    });

    it('looks up several cached users from a POST body, like the GET list', async () => {
        const { body } = await mint(['users:read']);
        const A = 'usr_00000000-0000-0000-0000-00000000000a';
        const post = (b, key = body.key) => call('/api/v1/users', { key, method: 'POST', body: b });

        const many = await post({ ids: [A, 'usr_00000000-0000-0000-0000-0000000000ff', A] });
        expect(many.status).toBe(200);
        expect(Object.keys(many.body.users)).toEqual([A]);
        expect(many.body.users[A]).toMatchObject({ displayName: 'Alice' });
        expect(many.body.missing).toEqual(['usr_00000000-0000-0000-0000-0000000000ff']);

        expect((await post({})).status).toBe(400);
        expect((await post({ ids: [] })).status).toBe(400);
        expect((await post({ ids: A })).status).toBe(400);
        expect((await post({ ids: [A, 5] })).status).toBe(400);
        expect((await post({ ids: [A, 'not-a-user'] })).status).toBe(400);
        const tooMany = Array.from({ length: 51 }, (_, i) => `usr_00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
        expect((await post({ ids: tooMany })).status).toBe(400);

        expect((await post({ ids: [A] }, (await mint(['playtime:read'])).body.key)).status).toBe(403);
        expect((await post({ ids: [A] }, null)).status).toBe(401);
        // POST exists only where declared; the single-user route stays GET-only
        expect((await call(`/api/v1/users/${A}`, { key: body.key, method: 'POST', body: {} })).status).toBe(405);
        expect((await call('/api/v1/users', { key: body.key, method: 'DELETE' })).status).toBe(405);
    });

    it('serves the key-management page with a CSP pinned to its exact script', async () => {
        const response = await fetch(`${origin}/admin/api-keys`);
        expect(response.status).toBe(200);
        const html = await response.text();
        const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
        const hash = (await import('node:crypto')).createHash('sha256').update(script).digest('base64');
        const csp = response.headers.get('content-security-policy');
        expect(csp).toContain(`script-src 'sha256-${hash}'`);
        expect(csp).not.toMatch(/script-src[^;]*unsafe/);
        expect(csp).toContain("frame-ancestors 'self'");
        expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
        // data-bearing calls are session-gated, not the page itself
        expect((await call('/api/keys')).status).toBe(401);
    });

    it('serves the generated OpenAPI spec without a key', async () => {
        const spec = await call('/api/v1/openapi.json');
        expect(spec.status).toBe(200);
        expect(spec.body.openapi).toBe('3.1.0');
        expect(Object.keys(spec.body.paths)).toContain('/api/v1/me');
    });

    it('revokes immediately and honours expiry', async () => {
        const { body } = await mint(['profile:read']);
        expect((await call('/api/v1/me', { key: body.key })).status).toBe(200);
        expect((await call(`/api/keys/${body.record.id}`, { key: session, method: 'DELETE' })).status).toBe(200);
        expect((await call('/api/v1/me', { key: body.key })).status).toBe(401);
        expect((await mint(['profile:read'], { expiresAt: '2001-01-01' })).status).toBe(400);
    });
});

describe('public-only listener', () => {
    it('serves /api/v1 and nothing else', async () => {
        const { createPublicApiServer } = await import('../src/public-api.js');
        const { createApiKey } = await import('../src/api-keys.js');
        const dir = mkdtempSync(path.join(tmpdir(), 'vrcx-headless-pubapi-'));
        const handle = await openDatabase({
            databasePath: path.join(dir, 'VRCX.sqlite3'),
            create: true
        });
        await handle.configRepository.init();
        const { key } = await createApiKey(handle, { name: 'k', scopes: ['profile:read'] });
        const server = createPublicApiServer(handle, {
            apiEnabled: true,
            getCurrentUser: () => ({ id: 'usr_x', displayName: 'X' })
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const o = `http://127.0.0.1:${server.address().port}`;
        try {
            expect((await fetch(`${o}/api/v1/me`, { headers: { Authorization: `Bearer ${key}` } })).status).toBe(200);
            expect((await fetch(`${o}/api/keys`)).status).toBe(404);
            expect((await fetch(`${o}/admin/api-keys`)).status).toBe(404);
            expect((await fetch(`${o}/api/rpc`, { method: 'POST' })).status).toBe(404);
            expect((await fetch(`${o}/`)).status).toBe(404);
        } finally {
            await new Promise((r) => server.close(r));
            handle.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('opt-in', () => {
    it('is off and 404s everywhere unless apiEnabled is set', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'vrcx-headless-apioff-'));
        const handle = await openDatabase({ databasePath: path.join(dir, 'VRCX.sqlite3'), create: true });
        await handle.configRepository.init();
        await setServerTotp(handle, generateTotpSecret());
        const { server } = await createHttpServer(handle, { getCurrentUser: () => ({ id: 'usr_x' }) });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const o = `http://127.0.0.1:${server.address().port}`;
        const session = await createSession(handle);
        try {
            expect((await fetch(`${o}/api/v1/me`)).status).toBe(404);
            expect((await fetch(`${o}/api/keys`, { headers: { Authorization: `Bearer ${session}` } })).status).toBe(
                404
            );
            // Falls through like any unknown path (the SPA shell if a web
            // client is built, else 404); never the key-management page.
            const page = await fetch(`${o}/admin/api-keys`);
            expect(page.headers.get('content-security-policy')).toBeNull();
            expect(await page.text()).not.toContain('id="create"');
        } finally {
            await new Promise((r) => server.close(r));
            handle.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('apikeys RPC target', () => {
    it('manages keys over a session RPC only when the API is enabled', async () => {
        const { dispatchRpc } = await import('../src/rpc.js');
        const dir = mkdtempSync(path.join(tmpdir(), 'vrcx-headless-apirpc-'));
        const handle = await openDatabase({ databasePath: path.join(dir, 'VRCX.sqlite3'), create: true });
        await handle.configRepository.init();
        try {
            const off = await dispatchRpc(handle, { target: 'apikeys', method: 'list', args: [] });
            expect(off.ok).toBe(false);
            const on = { apiEnabled: true };
            const created = await dispatchRpc(
                handle,
                { target: 'apikeys', method: 'create', args: [{ name: 'n', scopes: ['profile:read'] }] },
                on
            );
            expect(created.result.key).toMatch(/^vrcx_/);
            const listed = await dispatchRpc(handle, { target: 'apikeys', method: 'list', args: [] }, on);
            expect(listed.result.keys).toHaveLength(1);
            expect(Object.keys(listed.result.scopes)).toContain('users:read');
            expect(
                (
                    await dispatchRpc(
                        handle,
                        { target: 'apikeys', method: 'create', args: [{ name: 'n', scopes: ['x'] }] },
                        on
                    )
                ).ok
            ).toBe(false);
            expect(
                (
                    await dispatchRpc(
                        handle,
                        { target: 'apikeys', method: 'revoke', args: [created.result.record.id] },
                        on
                    )
                ).result
            ).toBe(true);
        } finally {
            handle.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
