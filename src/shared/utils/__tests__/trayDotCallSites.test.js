import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TRAY_DOT_TYPES } from '../../constants/trayDot';

const srcDir = resolve(process.cwd(), 'src');

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (name === '__tests__' || name === 'node_modules') continue;
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(js|vue)$/.test(name)) out.push(full);
    }
    return out;
}

/**
 * The tray dot color is decided per type, so a `notifyMenu(...)` call without
 * one silently becomes "everything else". Guard every call site (and any new
 * one an upstream sync brings in).
 */
describe('notifyMenu call sites', () => {
    const calls = [];
    for (const file of walk(srcDir)) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/\.notifyMenu\(([^)]*)\)/g)) {
            calls.push({ file: file.replace(srcDir, 'src'), args: m[1].trim() });
        }
    }

    it('finds the known call sites', () => {
        expect(calls.length).toBeGreaterThanOrEqual(8);
    });

    it('passes a type to every call', () => {
        const missing = calls.filter((c) => !c.args.includes(','));
        expect(missing).toEqual([]);
    });

    it('literal types passed are registered', () => {
        for (const { args } of calls) {
            const literal = args.match(/,\s*'([^']+)'/)?.[1];
            if (literal) {
                expect(TRAY_DOT_TYPES, literal).toHaveProperty(literal);
            }
        }
    });
});
