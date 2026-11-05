/**
 * Settings sync (`server/src/config-sync.js`): a config write is relayed on
 * `/api/stream` to every other client, never back to the one that wrote it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { CONFIG_CHANGED_TYPE, configChangeFrame, normalizeClientId } from '../src/config-sync.js';
import { openDatabase } from '../src/db.js';
import { setServerTotp } from '../src/http-auth.js';
import { createHttpServer } from '../src/http-server.js';
import { generateTotpCode, generateTotpSecret } from '../src/totp.js';

describe('configChangeFrame', () => {
    it('describes config writes only', () => {
        expect(JSON.parse(configChangeFrame({ target: 'config', method: 'setBool', args: ['k', true] }))).toEqual({
            type: CONFIG_CHANGED_TYPE,
            key: 'k',
            method: 'setBool',
            value: true
        });
        expect(JSON.parse(configChangeFrame({ target: 'config', method: 'remove', args: ['k'] }))).toEqual({
            type: CONFIG_CHANGED_TYPE,
            key: 'k',
            method: 'remove'
        });
        expect(configChangeFrame({ target: 'config', method: 'getString', args: ['k'] })).toBeNull();
        expect(configChangeFrame({ target: 'db', method: 'setString', args: ['k', 'v'] })).toBeNull();
        expect(configChangeFrame({ target: 'config', method: 'setString', args: [42, 'v'] })).toBeNull();
    });
    it('leaves out a value too large to inline', () => {
        const frame = JSON.parse(
            configChangeFrame({ target: 'config', method: 'setString', args: ['k', 'x'.repeat(70_000)] })
        );
        expect(frame.key).toBe('k');
        expect('value' in frame).toBe(false);
    });
});

describe('normalizeClientId', () => {
    it('accepts ids that are safe to compare and rejects the rest', () => {
        expect(normalizeClientId('3f2b8c1e-aaaa-bbbb-cccc-123456789012')).not.toBeNull();
        expect(normalizeClientId('short')).toBeNull();
        expect(normalizeClientId('has spaces in it!')).toBeNull();
        expect(normalizeClientId(undefined)).toBeNull();
    });
});

describe('relay over /api/stream', () => {
    let dir;
    let handle;
    let server;
    let origin;
    let token;
    const sockets = [];

    const open = (clientId) =>
        new Promise((resolve, reject) => {
            const messages = [];
            const ws = new WebSocket(`${origin.replace('http', 'ws')}/api/stream?client=${clientId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
            ws.on('open', () => resolve({ ws, messages }));
            ws.on('error', reject);
            sockets.push(ws);
        });

    const write = (clientId, method, args) =>
        fetch(`${origin}/api/rpc`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(clientId ? { 'X-Vrcx-Client': clientId } : {})
            },
            body: JSON.stringify({ target: 'config', method, args })
        }).then((r) => r.json());

    const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

    beforeAll(async () => {
        dir = mkdtempSync(path.join(tmpdir(), 'vrcx-headless-config-sync-'));
        handle = await openDatabase({ databasePath: path.join(dir, 'VRCX.sqlite3'), create: true });
        await handle.configRepository.init();
        const secret = generateTotpSecret();
        await setServerTotp(handle, secret);
        ({ server } = await createHttpServer(handle));
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        origin = `http://127.0.0.1:${server.address().port}`;
        const login = await fetch(`${origin}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: generateTotpCode(secret) })
        }).then((r) => r.json());
        token = login.token;
    });

    afterAll(async () => {
        sockets.forEach((ws) => ws.terminate());
        await new Promise((resolve) => server.close(resolve));
        handle.close();
        rmSync(dir, { recursive: true, force: true });
    });

    it('tells the other clients, and not the writer', async () => {
        const writer = await open('writer-aaaa-0001');
        const other = await open('other-bbbb-0002');
        const result = await write('writer-aaaa-0001', 'setBool', ['VRCX_sync_test', true]);
        expect(result.ok).toBe(true);
        await settle();
        expect(other.messages).toEqual([
            { type: CONFIG_CHANGED_TYPE, key: 'VRCX_sync_test', method: 'setBool', value: true }
        ]);
        expect(writer.messages).toEqual([]);
    });

    it('sends everyone a write that names no client', async () => {
        const a = await open('client-cccc-0003');
        const b = await open('client-dddd-0004');
        await write(null, 'setString', ['VRCX_sync_anon', 'x']);
        await settle();
        expect(a.messages.some((m) => m.key === 'VRCX_sync_anon')).toBe(true);
        expect(b.messages.some((m) => m.key === 'VRCX_sync_anon')).toBe(true);
    });

    it('stays quiet for reads and failed calls', async () => {
        const watcher = await open('watch-eeee-0005');
        await write('someone-ffff-0006', 'getString', ['VRCX_sync_test', '']);
        await write('someone-ffff-0006', 'noSuchMethod', ['k']);
        await settle();
        expect(watcher.messages).toEqual([]);
    });
});
