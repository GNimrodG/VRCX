import { DEFAULT_TRAY_DOT_RULES, TRAY_DOT_COLORS, TRAY_DOT_OFF, TRAY_DOT_TYPES } from '../constants/trayDot';

/**
 * Rules shape (stored as JSON in `VRCX_trayDotRules`, shared across clients):
 * { fallback: <color | 'off'>,
 * colors: [{ color: <color | 'off'>, types: [<type id>, ...] }, ...] }
 * `colors` order is priority, highest first. A type belongs to at most one entry.
 * `color: 'off'` entries are "never light the dot for these".
 *
 * @typedef {{ fallback: string; colors: { color: string; types: string[] }[] }} TrayDotRules
 */

const validColor = (c) => c === TRAY_DOT_OFF || TRAY_DOT_COLORS.includes(c);

/**
 * Coerce whatever is stored (missing, hand-edited, written by a newer/older
 * client) into valid rules: unknown colors/types dropped, duplicate types
 * keep their first (highest-priority) entry.
 *
 * @param {unknown} raw
 * @returns {TrayDotRules}
 */
export function normalizeTrayDotRules(raw) {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            value = null;
        }
    }
    if (!value || typeof value !== 'object') {
        return structuredClone(DEFAULT_TRAY_DOT_RULES);
    }
    const fallback = validColor(value.fallback) ? value.fallback : DEFAULT_TRAY_DOT_RULES.fallback;
    const seen = new Set();
    const colors = [];
    for (const entry of Array.isArray(value.colors) ? value.colors : []) {
        if (!entry || !validColor(entry.color)) {
            continue;
        }
        const types = [];
        for (const type of Array.isArray(entry.types) ? entry.types : []) {
            if (typeof type === 'string' && Object.hasOwn(TRAY_DOT_TYPES, type) && !seen.has(type)) {
                seen.add(type);
                types.push(type);
            }
        }
        colors.push({ color: entry.color, types });
    }
    return { fallback, colors };
}

/**
 * Which color a single type maps to (`'off'` = no dot).
 *
 * @param {TrayDotRules} rules
 * @param {string | undefined} type
 * @returns {{ color: string; rank: number }} Lower rank = higher priority; the
 * fallback ranks last.
 */
export function resolveTypeColor(rules, type) {
    if (type) {
        const index = rules.colors.findIndex((entry) => entry.types.includes(type));
        if (index !== -1) {
            return { color: rules.colors[index].color, rank: index };
        }
    }
    return { color: rules.fallback, rank: rules.colors.length };
}

/**
 * The dot color for everything currently unseen, or `null` for no dot.
 * Highest-priority entry wins; `'off'` types are ignored entirely (an unseen
 * "off" type must not mask a lower-priority colored one).
 *
 * @param {TrayDotRules} rules
 * @param {Iterable<string | undefined>} pendingTypes
 * @returns {string | null}
 */
export function resolveTrayDotColor(rules, pendingTypes) {
    let best = null;
    for (const type of pendingTypes) {
        const { color, rank } = resolveTypeColor(rules, type);
        if (color === TRAY_DOT_OFF) {
            continue;
        }
        if (!best || rank < best.rank) {
            best = { color, rank };
        }
    }
    return best ? best.color : null;
}

/**
 * Icon file for a color (basename, no extension): `VRCX_notify` for red since
 * that's the original asset.
 *
 * @param {string | null} color
 */
export function trayDotIconName(color) {
    if (!color) {
        return 'VRCX';
    }
    return color === 'red' ? 'VRCX_notify' : `VRCX_notify_${color}`;
}

/**
 * Tracks which types are unseen, per menu ('notification' / 'friend-log'), so
 * opening a menu clears only what that menu showed. Pure state, no Vue: the
 * store wraps it in a version counter for reactivity.
 */
export function createPendingTrayTypes() {
    /** @type {Map<string, Map<string | undefined, number>>} */
    const byMenu = new Map();
    return {
        /** @param {string} menu @param {string | undefined} type */
        add(menu, type) {
            let counts = byMenu.get(menu);
            if (!counts) {
                counts = new Map();
                byMenu.set(menu, counts);
            }
            counts.set(type, (counts.get(type) ?? 0) + 1);
        },
        /** @param {string} menu */
        clear(menu) {
            byMenu.delete(menu);
        },
        clearAll() {
            byMenu.clear();
        },
        /**
         * Distinct pending types across all menus, or only across `menus`.
         *
         * @param {Iterable<string>} [menus]
         */
        types(menus) {
            const out = new Set();
            const sources = menus ? [...menus].map((menu) => byMenu.get(menu)) : byMenu.values();
            for (const counts of sources) {
                if (!counts) {
                    continue;
                }
                for (const type of counts.keys()) {
                    out.add(type);
                }
            }
            return out;
        },
        get size() {
            return byMenu.size;
        }
    };
}

/**
 * The whole dot state machine, free of Vue/Electron so it can be tested
 * exhaustively: pending types per menu in, "apply this color" calls out.
 * `src/stores/ui.js` wires `getRules`/`isEnabled` to the stores and `apply` to
 * the tray (Electron IPC) or favicon (web).
 *
 * `apply` fires only when the color actually changes (or on `update(true)`),
 * so a burst of same-color notifications doesn't spam IPC.
 *
 * @param {{
 *     getRules: () => TrayDotRules;
 *     isEnabled: () => boolean;
 *     apply: (color: string | null) => void;
 * }} deps
 */
export function createTrayDotController({ getRules, isEnabled, apply }) {
    const pending = createPendingTrayTypes();
    /** @type {string | null} */
    let current = null;

    function update(force = false) {
        const next = isEnabled() ? resolveTrayDotColor(getRules(), pending.types()) : null;
        if (next !== current || force) {
            current = next;
            apply(next);
        }
        return next;
    }

    return {
        /** An unseen item of `type` arrived for `menu`. */
        notify(menu, type) {
            pending.add(menu, type);
            return update();
        },
        /** `menu` was opened: forget what it had pending. */
        clear(menu) {
            pending.clear(menu);
            return update();
        },
        clearAll() {
            pending.clearAll();
            return update();
        },
        update,
        /**
         * Dot color for just `menus` (in-app nav dots), by the same rules as the
         * tray. Ignores `isEnabled`: that gates the tray/favicon only.
         *
         * @param {Iterable<string>} menus
         * @returns {string | null}
         */
        colorForMenus(menus) {
            return resolveTrayDotColor(getRules(), pending.types(menus));
        },
        get color() {
            return current;
        }
    };
}
