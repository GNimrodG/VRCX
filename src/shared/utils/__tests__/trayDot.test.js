import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_TRAY_DOT_RULES, TRAY_DOT_COLORS, TRAY_DOT_TYPE_IDS } from '../../constants/trayDot';
import {
    createPendingTrayTypes,
    createTrayDotController,
    normalizeTrayDotRules,
    resolveTrayDotColor,
    resolveTypeColor,
    trayDotIconName
} from '../trayDot';

const rules = (colors, fallback = 'blue') => ({ fallback, colors });

describe('resolveTypeColor', () => {
    const r = rules([
        { color: 'red', types: ['Unfriend'] },
        { color: 'green', types: ['invite', 'boop'] }
    ]);

    it('ranks entries by position, fallback last', () => {
        expect(resolveTypeColor(r, 'Unfriend')).toEqual({ color: 'red', rank: 0 });
        expect(resolveTypeColor(r, 'boop')).toEqual({ color: 'green', rank: 1 });
        expect(resolveTypeColor(r, 'group.invite')).toEqual({ color: 'blue', rank: 2 });
    });

    it('missing/empty/unknown type -> fallback', () => {
        for (const t of [undefined, null, '', 'nope', 'UNFRIEND', 'unfriend']) {
            expect(resolveTypeColor(r, t).color).toBe('blue');
        }
    });

    it('is case sensitive and exact (no prefix matching)', () => {
        const g = rules([{ color: 'red', types: ['group.invite'] }]);
        expect(resolveTypeColor(g, 'group.invite').color).toBe('red');
        expect(resolveTypeColor(g, 'group.invite.extra').color).toBe('blue');
        expect(resolveTypeColor(g, 'group').color).toBe('blue');
    });

    it('empty color entries never match', () => {
        const e = rules([{ color: 'red', types: [] }]);
        expect(resolveTypeColor(e, 'invite').color).toBe('blue');
    });
});

describe('resolveTrayDotColor', () => {
    it('defaults to red for everything', () => {
        expect(resolveTrayDotColor(normalizeTrayDotRules(null), ['group.announcement'])).toBe('red');
        for (const type of TRAY_DOT_TYPE_IDS) {
            expect(resolveTrayDotColor(DEFAULT_TRAY_DOT_RULES, [type]), type).toBe('red');
        }
    });

    it('returns null with nothing pending (any rules)', () => {
        expect(resolveTrayDotColor(rules([]), [])).toBeNull();
        expect(resolveTrayDotColor(rules([{ color: 'red', types: ['boop'] }], 'off'), new Set())).toBeNull();
    });

    it('highest-priority entry wins among pending types', () => {
        const r = rules([
            { color: 'red', types: ['Unfriend'] },
            { color: 'green', types: ['invite'] }
        ]);
        expect(resolveTrayDotColor(r, ['invite', 'group.announcement', 'Unfriend'])).toBe('red');
        expect(resolveTrayDotColor(r, ['invite', 'group.announcement'])).toBe('green');
        expect(resolveTrayDotColor(r, ['group.announcement'])).toBe('blue');
    });

    it('result does not depend on pending order', () => {
        const r = rules([
            { color: 'red', types: ['Unfriend'] },
            { color: 'green', types: ['invite'] }
        ]);
        const types = ['group.announcement', 'invite', 'Unfriend', 'boop'];
        for (let i = 0; i < types.length; i++) {
            const rotated = [...types.slice(i), ...types.slice(0, i)];
            expect(resolveTrayDotColor(r, rotated)).toBe('red');
            expect(resolveTrayDotColor(r, rotated.reverse())).toBe('red');
        }
    });

    it('priority is by list position, not by color name or type order', () => {
        const r = rules([
            { color: 'purple', types: ['boop'] },
            { color: 'red', types: ['Unfriend'] }
        ]);
        expect(resolveTrayDotColor(r, ['Unfriend', 'boop'])).toBe('purple');
        const swapped = rules([...r.colors].reverse());
        expect(resolveTrayDotColor(swapped, ['Unfriend', 'boop'])).toBe('red');
    });

    it('fallback ranks below every explicit entry', () => {
        const r = rules([{ color: 'purple', types: ['boop'] }], 'red');
        expect(resolveTrayDotColor(r, ['group.invite', 'boop'])).toBe('purple');
    });

    it('the "everything else" fallback needs no per-type setup', () => {
        const r = rules([], 'cyan');
        for (const type of TRAY_DOT_TYPE_IDS) {
            expect(resolveTrayDotColor(r, [type]), type).toBe('cyan');
        }
    });

    it('treats unknown/undefined types as the fallback', () => {
        expect(resolveTrayDotColor(rules([]), [undefined, 'brand.new'])).toBe('blue');
        expect(resolveTrayDotColor(rules([], 'off'), [undefined])).toBeNull();
    });

    it('off entries never light the dot nor mask lower ones', () => {
        const r = rules([
            { color: 'off', types: ['group.announcement'] },
            { color: 'green', types: ['invite'] }
        ]);
        expect(resolveTrayDotColor(r, ['group.announcement'])).toBeNull();
        expect(resolveTrayDotColor(r, ['group.announcement', 'invite'])).toBe('green');
    });

    it('an off entry ranked above others still does not mask them', () => {
        const r = rules([
            { color: 'off', types: ['group.announcement'] },
            { color: 'red', types: ['Unfriend'] }
        ]);
        expect(resolveTrayDotColor(r, ['group.announcement', 'Unfriend'])).toBe('red');
        // ...and unassigned types fall to the fallback, not to the off entry.
        expect(resolveTrayDotColor(r, ['group.announcement', 'boop'])).toBe('blue');
    });

    it('fallback off silences unassigned types only', () => {
        const r = rules([{ color: 'red', types: ['Unfriend'] }], 'off');
        expect(resolveTrayDotColor(r, ['boop'])).toBeNull();
        expect(resolveTrayDotColor(r, ['boop', 'Unfriend'])).toBe('red');
    });

    it('accepts any iterable (Set, generator) and does not consume rules', () => {
        const r = rules([{ color: 'red', types: ['boop'] }]);
        expect(resolveTrayDotColor(r, new Set(['boop']))).toBe('red');
        expect(
            resolveTrayDotColor(
                r,
                (function* () {
                    yield 'boop';
                })()
            )
        ).toBe('red');
        expect(r).toEqual(rules([{ color: 'red', types: ['boop'] }]));
    });

    it('matches an independent brute-force reference on random rules (seeded fuzz)', () => {
        let seed = 0xc0ffee;
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 2 ** 32;
        };
        const pick = (arr) => arr[Math.floor(rand() * arr.length)];
        const colorsPlusOff = [...TRAY_DOT_COLORS, 'off'];

        for (let iter = 0; iter < 2000; iter++) {
            const pool = [...TRAY_DOT_TYPE_IDS].sort(() => rand() - 0.5);
            const entries = [];
            const nEntries = Math.floor(rand() * 6);
            for (let e = 0; e < nEntries; e++) {
                const take = Math.floor(rand() * 5);
                entries.push({ color: pick(colorsPlusOff), types: pool.splice(0, take) });
            }
            const r = rules(entries, pick(colorsPlusOff));
            const pending = Array.from({ length: Math.floor(rand() * 8) }, () =>
                rand() < 0.1 ? 'unknown.type' : pick(TRAY_DOT_TYPE_IDS)
            );

            // Reference: walk priority order explicitly.
            let expected = null;
            outer: for (let rank = 0; rank <= entries.length; rank++) {
                for (const type of pending) {
                    const idx = entries.findIndex((en) => en.types.includes(type));
                    const typeRank = idx === -1 ? entries.length : idx;
                    const color = idx === -1 ? r.fallback : entries[idx].color;
                    if (typeRank === rank && color !== 'off') {
                        expected = color;
                        break outer;
                    }
                }
            }
            expect(resolveTrayDotColor(r, pending), JSON.stringify({ r, pending })).toBe(expected);
        }
    });
});

describe('normalizeTrayDotRules', () => {
    const DEFAULT = { fallback: 'red', colors: [] };

    it('falls back to defaults on garbage', () => {
        for (const bad of [undefined, null, 42, true, [], 'not json', '', '{', 'null', '[]', '"x"', '42']) {
            expect(normalizeTrayDotRules(bad), String(bad)).toEqual(DEFAULT);
        }
    });

    it('returns a fresh object so callers cannot mutate the shared default', () => {
        const a = normalizeTrayDotRules(null);
        a.colors.push({ color: 'red', types: ['boop'] });
        a.fallback = 'blue';
        expect(normalizeTrayDotRules(null)).toEqual(DEFAULT);
        expect(DEFAULT_TRAY_DOT_RULES).toEqual(DEFAULT);
    });

    it('accepts a JSON string and drops invalid colors/types/duplicates', () => {
        const raw = JSON.stringify({
            fallback: 'magenta',
            colors: [
                { color: 'green', types: ['invite', 'nope', 'invite'] },
                { color: 'chartreuse', types: ['boop'] },
                { color: 'blue', types: ['invite', 'boop'] }
            ]
        });
        expect(normalizeTrayDotRules(raw)).toEqual({
            fallback: 'red',
            colors: [
                { color: 'green', types: ['invite'] },
                { color: 'blue', types: ['boop'] }
            ]
        });
    });

    it('keeps valid input exactly, including empty entries and off', () => {
        const input = {
            fallback: 'off',
            colors: [
                { color: 'red', types: ['Unfriend'] },
                { color: 'cyan', types: [] },
                { color: 'off', types: ['group.announcement'] }
            ]
        };
        expect(normalizeTrayDotRules(input)).toEqual(input);
        expect(normalizeTrayDotRules(JSON.stringify(input))).toEqual(input);
    });

    it('is idempotent', () => {
        const messy = { fallback: 'x', colors: [{ color: 'red', types: ['boop', 'boop', 'zzz'] }, null, 7, {}] };
        const once = normalizeTrayDotRules(messy);
        expect(normalizeTrayDotRules(once)).toEqual(once);
    });

    it('survives hostile shapes without throwing', () => {
        const hostile = [
            { fallback: 'red', colors: 'nope' },
            {
                fallback: 'red',
                colors: [null, undefined, 1, 'a', [], { color: 'red' }, { color: 'red', types: 'boop' }]
            },
            { colors: [{ color: 'red', types: [null, 1, {}, 'boop'] }] },
            { fallback: { toString: () => 'red' } },
            { __proto__: { fallback: 'blue' } }
        ];
        for (const h of hostile) {
            expect(() => normalizeTrayDotRules(h)).not.toThrow();
        }
        expect(normalizeTrayDotRules(hostile[2])).toEqual({
            fallback: 'red',
            colors: [{ color: 'red', types: ['boop'] }]
        });
    });

    it('does not let prototype-ish type names through', () => {
        const out = normalizeTrayDotRules({
            fallback: 'red',
            colors: [{ color: 'red', types: ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'boop'] }]
        });
        expect(out.colors[0].types).toEqual(['boop']);
    });

    it('does not alias the input arrays', () => {
        const input = { fallback: 'red', colors: [{ color: 'red', types: ['boop'] }] };
        const out = normalizeTrayDotRules(input);
        out.colors[0].types.push('invite');
        expect(input.colors[0].types).toEqual(['boop']);
    });

    it('a type in two entries keeps the earlier (higher-priority) one', () => {
        const out = normalizeTrayDotRules({
            fallback: 'red',
            colors: [
                { color: 'blue', types: ['boop'] },
                { color: 'green', types: ['boop', 'invite'] }
            ]
        });
        expect(out.colors).toEqual([
            { color: 'blue', types: ['boop'] },
            { color: 'green', types: ['invite'] }
        ]);
    });
});

describe('trayDotIconName', () => {
    it('maps colors to asset names', () => {
        expect(trayDotIconName(null)).toBe('VRCX');
        expect(trayDotIconName(undefined)).toBe('VRCX');
        expect(trayDotIconName('red')).toBe('VRCX_notify');
        expect(trayDotIconName('cyan')).toBe('VRCX_notify_cyan');
    });

    it('every configurable color has a distinct asset name', () => {
        const names = TRAY_DOT_COLORS.map(trayDotIconName);
        expect(new Set(names).size).toBe(TRAY_DOT_COLORS.length);
    });
});

describe('createPendingTrayTypes', () => {
    it('tracks distinct types across menus', () => {
        const p = createPendingTrayTypes();
        p.add('notification', 'invite');
        p.add('notification', 'invite');
        p.add('friend-log', 'Unfriend');
        expect([...p.types()].sort()).toEqual(['Unfriend', 'invite']);
        expect(p.size).toBe(2);
    });

    it('clear removes only that menu', () => {
        const p = createPendingTrayTypes();
        p.add('notification', 'invite');
        p.add('friend-log', 'Unfriend');
        p.clear('notification');
        expect([...p.types()]).toEqual(['Unfriend']);
        p.clear('does-not-exist');
        expect(p.size).toBe(1);
    });

    it('the same type in two menus survives clearing one of them', () => {
        const p = createPendingTrayTypes();
        p.add('notification', 'invite');
        p.add('friend-log', 'invite');
        p.clear('notification');
        expect([...p.types()]).toEqual(['invite']);
    });

    it('clearAll empties everything; undefined type is kept as a pending item', () => {
        const p = createPendingTrayTypes();
        p.add('notification', undefined);
        expect(p.types().has(undefined)).toBe(true);
        p.clearAll();
        expect(p.types().size).toBe(0);
        expect(p.size).toBe(0);
    });
});

describe('createTrayDotController', () => {
    const make = (initialRules = DEFAULT_TRAY_DOT_RULES, enabled = true) => {
        const state = { rules: initialRules, enabled };
        const apply = vi.fn();
        const c = createTrayDotController({
            getRules: () => state.rules,
            isEnabled: () => state.enabled,
            apply
        });
        return { c, state, apply };
    };

    it('starts with no dot and applies nothing until something changes', () => {
        const { c, apply } = make();
        expect(c.color).toBeNull();
        expect(apply).not.toHaveBeenCalled();
    });

    it('update(true) pushes the initial state once', () => {
        const { c, apply } = make();
        c.update(true);
        expect(apply).toHaveBeenCalledExactlyOnceWith(null);
    });

    it('default rules: any notification lights red, opening the menu clears it', () => {
        const { c, apply } = make();
        c.notify('notification', 'group.announcement');
        expect(c.color).toBe('red');
        c.clear('notification');
        expect(c.color).toBeNull();
        expect(apply.mock.calls.map((x) => x[0])).toEqual(['red', null]);
    });

    it('does not re-apply while the color is unchanged', () => {
        const { c, apply } = make();
        c.notify('notification', 'invite');
        c.notify('notification', 'boop');
        c.notify('friend-log', 'Friend');
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('the headline scenario: unfriend red beats everything-else blue', () => {
        const { c, apply } = make({
            fallback: 'blue',
            colors: [{ color: 'red', types: ['Unfriend'] }]
        });
        c.notify('notification', 'group.announcement');
        expect(c.color).toBe('blue');
        c.notify('friend-log', 'Unfriend');
        expect(c.color).toBe('red');
        // Seeing only the friend log: the group announcement is still pending.
        c.clear('friend-log');
        expect(c.color).toBe('blue');
        c.clear('notification');
        expect(c.color).toBeNull();
        expect(apply.mock.calls.map((x) => x[0])).toEqual(['blue', 'red', 'blue', null]);
    });

    it('a lower-priority arrival never downgrades the dot', () => {
        const { c, apply } = make({ fallback: 'blue', colors: [{ color: 'red', types: ['Unfriend'] }] });
        c.notify('friend-log', 'Unfriend');
        c.notify('notification', 'group.announcement');
        expect(c.color).toBe('red');
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('turning the setting off hides the dot; on again restores it', () => {
        const { c, state, apply } = make();
        c.notify('notification', 'invite');
        state.enabled = false;
        c.update();
        expect(c.color).toBeNull();
        // Arrivals while disabled still count as pending...
        c.notify('notification', 'boop');
        expect(c.color).toBeNull();
        state.enabled = true;
        c.update();
        expect(c.color).toBe('red');
        expect(apply.mock.calls.map((x) => x[0])).toEqual(['red', null, 'red']);
    });

    it('rule edits re-resolve what is already pending', () => {
        const { c, state } = make();
        c.notify('notification', 'group.announcement');
        expect(c.color).toBe('red');
        state.rules = { fallback: 'cyan', colors: [] };
        c.update();
        expect(c.color).toBe('cyan');
        state.rules = { fallback: 'red', colors: [{ color: 'off', types: ['group.announcement'] }] };
        c.update();
        expect(c.color).toBeNull();
    });

    it('rules that load late (after notifications arrived) are honoured', () => {
        const { c, state } = make(DEFAULT_TRAY_DOT_RULES);
        c.notify('notification', 'boop');
        expect(c.color).toBe('red');
        state.rules = { fallback: 'off', colors: [{ color: 'green', types: ['boop'] }] };
        c.update();
        expect(c.color).toBe('green');
    });

    it('clearAll resets every menu', () => {
        const { c } = make();
        c.notify('notification', 'invite');
        c.notify('friend-log', 'Friend');
        c.clearAll();
        expect(c.color).toBeNull();
    });

    it('clearing an unrelated menu changes nothing', () => {
        const { c, apply } = make();
        c.notify('notification', 'invite');
        c.clear('friend-log');
        expect(c.color).toBe('red');
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('off-colored types arriving never apply anything', () => {
        const { c, apply } = make({ fallback: 'off', colors: [] });
        c.notify('notification', 'invite');
        c.notify('friend-log', 'Unfriend');
        expect(c.color).toBeNull();
        expect(apply).not.toHaveBeenCalled();
    });

    it('a type-less notify (a call site that forgot the type) uses the fallback', () => {
        const { c } = make({ fallback: 'orange', colors: [{ color: 'red', types: ['invite'] }] });
        c.notify('notification', undefined);
        expect(c.color).toBe('orange');
    });

    it('rapid random sequence stays consistent with a from-scratch resolve', () => {
        let seed = 42;
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 2 ** 32;
        };
        const r = {
            fallback: 'blue',
            colors: [
                { color: 'red', types: ['Unfriend'] },
                { color: 'off', types: ['group.announcement'] },
                { color: 'green', types: ['invite', 'boop'] }
            ]
        };
        const { c } = make(r);
        const shadow = { notification: [], 'friend-log': [] };
        for (let i = 0; i < 3000; i++) {
            const menu = rand() < 0.5 ? 'notification' : 'friend-log';
            const roll = rand();
            if (roll < 0.6) {
                const type = TRAY_DOT_TYPE_IDS[Math.floor(rand() * TRAY_DOT_TYPE_IDS.length)];
                shadow[menu].push(type);
                c.notify(menu, type);
            } else if (roll < 0.95) {
                shadow[menu] = [];
                c.clear(menu);
            } else {
                shadow.notification = [];
                shadow['friend-log'] = [];
                c.clearAll();
            }
            expect(c.color).toBe(resolveTrayDotColor(r, [...shadow.notification, ...shadow['friend-log']]));
        }
    });
});

describe('colorForMenus', () => {
    const rules = {
        fallback: 'red',
        colors: [
            { color: 'blue', types: ['Friend'] },
            { color: 'green', types: ['invite'] }
        ]
    };

    it('resolves each menu from only its own pending types', () => {
        const c = createTrayDotController({ getRules: () => rules, isEnabled: () => false, apply: () => {} });
        c.notify('friend-log', 'Friend');
        c.notify('notification', 'invite');
        expect(c.colorForMenus(['friend-log'])).toBe('blue');
        expect(c.colorForMenus(['notification'])).toBe('green');
        expect(c.colorForMenus(['friend-log', 'notification'])).toBe('blue');
        expect(c.colorForMenus(['feed'])).toBe(null);
    });
});
