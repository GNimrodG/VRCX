import { describe, expect, it } from 'vitest';
import { reactive, ref } from 'vue';

import { DEFAULT_TRAY_DOT_RULES, TRAY_DOT_COLORS, TRAY_DOT_TYPE_IDS } from '../../constants/trayDot';
import { normalizeTrayDotRules, resolveTrayDotColor } from '../trayDot';
import {
    addColorEntry,
    assignType,
    entryIndexOfType,
    moveColorEntry,
    removeColorEntry,
    setEntryColor,
    setFallback,
    unassignType,
    unusedColors
} from '../trayDotEdit';

const base = () => structuredClone(DEFAULT_TRAY_DOT_RULES);
const build = () => {
    let r = base();
    r = addColorEntry(r, 'red');
    r = addColorEntry(r, 'green');
    r = addColorEntry(r, 'blue');
    r = assignType(r, 0, 'Unfriend');
    r = assignType(r, 1, 'invite');
    r = assignType(r, 1, 'boop');
    return r;
};
const invariantsHold = (r) => {
    const colors = r.colors.map((e) => e.color);
    expect(new Set(colors).size).toBe(colors.length);
    const types = r.colors.flatMap((e) => e.types);
    expect(new Set(types).size).toBe(types.length);
    expect(normalizeTrayDotRules(r)).toEqual(r);
};

describe('trayDotEdit with Vue reactive input (what the settings UI passes)', () => {
    it('every operation accepts a reactive proxy and returns plain data', () => {
        const rules = ref(build()).value; // a reactive proxy, like storeToRefs().rules
        const r2 = reactive(build());
        for (const r of [rules, r2]) {
            expect(addColorEntry(r, 'cyan').colors).toHaveLength(4);
            expect(removeColorEntry(r, 0).colors).toHaveLength(2);
            expect(moveColorEntry(r, 0, 1).colors[0].color).toBe('green');
            expect(setEntryColor(r, 0, 'purple').colors[0].color).toBe('purple');
            expect(assignType(r, 2, 'invite').colors[2].types).toEqual(['invite']);
            expect(unassignType(r, 'invite').colors[1].types).toEqual(['boop']);
            expect(setFallback(r, 'cyan').fallback).toBe('cyan');
            expect(() => JSON.stringify(addColorEntry(r, 'cyan'))).not.toThrow();
            expect(() => structuredClone(addColorEntry(r, 'cyan'))).not.toThrow();
        }
    });
});

describe('trayDotEdit', () => {
    it('never mutates its input', () => {
        const r = build();
        const frozen = JSON.stringify(r);
        addColorEntry(r, 'cyan');
        removeColorEntry(r, 0);
        moveColorEntry(r, 0, 1);
        setEntryColor(r, 0, 'cyan');
        assignType(r, 2, 'invite');
        unassignType(r, 'invite');
        setFallback(r, 'off');
        expect(JSON.stringify(r)).toBe(frozen);
    });

    it('addColorEntry appends at lowest priority; rejects duplicates and junk', () => {
        const r = addColorEntry(build(), 'cyan');
        expect(r.colors.map((e) => e.color)).toEqual(['red', 'green', 'blue', 'cyan']);
        expect(addColorEntry(r, 'cyan')).toEqual(r);
        expect(addColorEntry(r, 'magenta')).toEqual(r);
        expect(addColorEntry(r, undefined)).toEqual(r);
        expect(addColorEntry(r, 'off').colors.at(-1)).toEqual({ color: 'off', types: [] });
    });

    it('unusedColors lists what is left, including off', () => {
        expect(unusedColors(base())).toEqual([...TRAY_DOT_COLORS, 'off']);
        expect(unusedColors(build())).toEqual(['orange', 'yellow', 'cyan', 'purple', 'off']);
        let full = base();
        for (const c of [...TRAY_DOT_COLORS, 'off']) full = addColorEntry(full, c);
        expect(unusedColors(full)).toEqual([]);
    });

    it('removeColorEntry returns its types to "everything else"', () => {
        const r = removeColorEntry(build(), 1);
        expect(r.colors.map((e) => e.color)).toEqual(['red', 'blue']);
        expect(entryIndexOfType(r, 'invite')).toBe(-1);
        expect(resolveTrayDotColor(r, ['invite'])).toBe('red'); // default fallback
        expect(removeColorEntry(r, 99)).toEqual(r);
        expect(removeColorEntry(r, -1)).toEqual(r);
    });

    it('moveColorEntry changes priority and clamps at the ends', () => {
        const r = build();
        const down = moveColorEntry(r, 0, 1);
        expect(down.colors.map((e) => e.color)).toEqual(['green', 'red', 'blue']);
        expect(resolveTrayDotColor(down, ['Unfriend', 'invite'])).toBe('green');
        expect(moveColorEntry(r, 0, -1)).toEqual(r);
        expect(moveColorEntry(r, 2, 1)).toEqual(r);
        expect(moveColorEntry(r, 5, -1)).toEqual(r);
        expect(moveColorEntry(r, 1, 0)).toEqual(r);
        expect(moveColorEntry(r, 2, -2).colors.map((e) => e.color)).toEqual(['blue', 'red', 'green']);
    });

    it('setEntryColor keeps types and position, refuses a color already in use', () => {
        const r = setEntryColor(build(), 1, 'purple');
        expect(r.colors[1]).toEqual({ color: 'purple', types: ['invite', 'boop'] });
        expect(setEntryColor(r, 1, 'red')).toEqual(r);
        expect(setEntryColor(r, 1, 'purple')).toEqual(r);
        expect(setEntryColor(r, 9, 'cyan')).toEqual(r);
        expect(setEntryColor(r, 1, 'nope')).toEqual(r);
    });

    it('assignType moves a type between entries (one entry per type)', () => {
        const r = assignType(build(), 2, 'invite');
        expect(entryIndexOfType(r, 'invite')).toBe(2);
        expect(r.colors[1].types).toEqual(['boop']);
        invariantsHold(r);
    });

    it('assignType ignores unknown types, bad indexes and prototype names', () => {
        const r = build();
        expect(assignType(r, 0, 'nope')).toEqual(r);
        expect(assignType(r, 0, '__proto__')).toEqual(r);
        expect(assignType(r, 0, 'constructor')).toEqual(r);
        expect(assignType(r, 7, 'boop')).toEqual(r);
        expect(assignType(r, -1, 'boop')).toEqual(r);
    });

    it('assigning the same type twice is idempotent', () => {
        const once = assignType(build(), 2, 'invite');
        expect(assignType(once, 2, 'invite')).toEqual(once);
    });

    it('unassignType returns a type to "everything else"', () => {
        const r = unassignType(build(), 'Unfriend');
        expect(entryIndexOfType(r, 'Unfriend')).toBe(-1);
        expect(unassignType(r, 'Unfriend')).toEqual(r);
        expect(unassignType(r, 'nope')).toEqual(r);
    });

    it('setFallback accepts colors and off only', () => {
        expect(setFallback(base(), 'blue').fallback).toBe('blue');
        expect(setFallback(base(), 'off').fallback).toBe('off');
        expect(setFallback(base(), 'nope').fallback).toBe('red');
    });

    it('the catch-all can be changed without touching any type assignment', () => {
        const r = setFallback(build(), 'cyan');
        expect(r.colors).toEqual(build().colors);
        expect(resolveTrayDotColor(r, ['group.announcement'])).toBe('cyan');
    });

    it('survives a long random edit sequence with invariants intact', () => {
        let seed = 7;
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 2 ** 32;
        };
        const pick = (a) => a[Math.floor(rand() * a.length)];
        let r = base();
        const colors = [...TRAY_DOT_COLORS, 'off'];
        for (let i = 0; i < 3000; i++) {
            switch (Math.floor(rand() * 7)) {
                case 0:
                    r = addColorEntry(r, pick(colors));
                    break;
                case 1:
                    r = removeColorEntry(r, Math.floor(rand() * 9) - 1);
                    break;
                case 2:
                    r = moveColorEntry(r, Math.floor(rand() * 9) - 1, pick([-2, -1, 0, 1, 2]));
                    break;
                case 3:
                    r = setEntryColor(r, Math.floor(rand() * 9) - 1, pick([...colors, 'zzz']));
                    break;
                case 4:
                    r = assignType(r, Math.floor(rand() * 9) - 1, pick([...TRAY_DOT_TYPE_IDS, 'zzz']));
                    break;
                case 5:
                    r = unassignType(r, pick(TRAY_DOT_TYPE_IDS));
                    break;
                default:
                    r = setFallback(r, pick([...colors, 'zzz']));
            }
            invariantsHold(r);
            expect(r.colors.length).toBeLessThanOrEqual(colors.length);
        }
    });
});
