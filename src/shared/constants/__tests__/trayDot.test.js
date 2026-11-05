import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FRIEND_TYPES, GROUP_EXACT_TYPES } from '../../utils/notificationCategory';
import { TRAY_DOT_COLORS, TRAY_DOT_TYPES, TRAY_DOT_TYPE_IDS } from '../trayDot';

// vitest (jsdom) runs from the repo root, where vitest.config.js lives.
const abs = (p) => resolve(process.cwd(), p);
const read = (p) => readFileSync(abs(p), 'utf8');

/**
 * The guard behind "a new type can't be left unhandled": these tests diff the
 * registry against the places upstream defines types. When one fails after an
 * upstream sync, add the type to `TRAY_DOT_TYPES` (and its group).
 */
describe('tray dot type registry', () => {
    it('covers every type in the Notifications page filter list', () => {
        const vue = read('src/views/Notifications/Notification.vue');
        const block = vue.match(/v-for="type in \[([\s\S]*?)\]"/)[1];
        const upstream = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
        expect(upstream.length).toBeGreaterThan(10);
        expect(TRAY_DOT_TYPE_IDS).toEqual(expect.arrayContaining(upstream));
    });

    it('registers no notification type the Notifications page does not know', () => {
        const vue = read('src/views/Notifications/Notification.vue');
        const block = vue.match(/v-for="type in \[([\s\S]*?)\]"/)[1];
        const upstream = new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));
        const extra = TRAY_DOT_TYPE_IDS.filter((t) => TRAY_DOT_TYPES[t].source === 'notification' && !upstream.has(t));
        expect(extra).toEqual([]);
    });

    it('covers the friend and group category sets', () => {
        for (const type of [...FRIEND_TYPES, ...GROUP_EXACT_TYPES]) {
            expect(TRAY_DOT_TYPE_IDS).toContain(type);
        }
    });

    it('covers every friend-log type that raises the dot', () => {
        const src = read('src/coordinators/friendRelationshipCoordinator.js');
        const written = new Set([...src.matchAll(/type: '([A-Za-z]+)'/g)].map((m) => m[1]));
        expect([...written].sort()).toEqual(
            TRAY_DOT_TYPE_IDS.filter((t) => TRAY_DOT_TYPES[t].source === 'friendLog').sort()
        );
    });

    it('has a label in en.json for every type', () => {
        const en = JSON.parse(read('src/localization/en.json'));
        for (const [type, { labelKey }] of Object.entries(TRAY_DOT_TYPES)) {
            const value = labelKey.split('.').reduce((o, k) => o?.[k], en);
            // Nested filter keys (e.g. group.event.created) are objects in en.json.
            const resolved = typeof value === 'string' ? value : null;
            const nested = type.split('.').reduce((o, k) => o?.[k], en?.view?.notification?.filters);
            expect(resolved ?? (typeof nested === 'string' ? nested : null), type).toBeTruthy();
        }
    });

    it('has an icon for every color', () => {
        for (const color of TRAY_DOT_COLORS) {
            const base = color === 'red' ? 'VRCX_notify' : `VRCX_notify_${color}`;
            expect(existsSync(abs(`images/${base}.png`)), `${base}.png`).toBe(true);
            expect(existsSync(abs(`images/${base}.ico`)), `${base}.ico`).toBe(true);
        }
    });
});
