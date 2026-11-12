import { TRAY_DOT_COLORS, TRAY_DOT_OFF, TRAY_DOT_TYPES } from '../constants/trayDot';
import { normalizeTrayDotRules } from './trayDot';

/**
 * Pure edit operations behind the tray-dot settings UI. Each takes rules and
 * returns new, normalized rules (never mutates). Invariants the UI relies on:
 * one entry per color (`off` included), a type in at most one entry, entry
 * order == priority.
 */

/** @typedef {import('./trayDot').TrayDotRules} TrayDotRules */

// `normalize` already builds fresh plain objects. Do NOT `structuredClone` here:
// the settings UI passes the store's reactive proxy, which structuredClone rejects.
const clone = (rules) => normalizeTrayDotRules(rules);

/** Colors (incl. 'off') not yet used by an entry, in display order. */
export function unusedColors(rules) {
    const used = new Set(rules.colors.map((e) => e.color));
    return [...TRAY_DOT_COLORS, TRAY_DOT_OFF].filter((c) => !used.has(c));
}

/** Add an empty entry at the lowest priority. No-op for a used/invalid color. */
export function addColorEntry(rules, color) {
    const next = clone(rules);
    if (![...TRAY_DOT_COLORS, TRAY_DOT_OFF].includes(color) || next.colors.some((e) => e.color === color)) {
        return next;
    }
    next.colors.push({ color, types: [] });
    return next;
}

export function removeColorEntry(rules, index) {
    const next = clone(rules);
    if (index >= 0 && index < next.colors.length) {
        next.colors.splice(index, 1);
    }
    return next;
}

/** Move an entry up (delta -1 = higher priority) or down. Clamped; no wraparound. */
export function moveColorEntry(rules, index, delta) {
    const next = clone(rules);
    const to = index + delta;
    if (index < 0 || index >= next.colors.length || to < 0 || to >= next.colors.length || to === index) {
        return next;
    }
    const [entry] = next.colors.splice(index, 1);
    next.colors.splice(to, 0, entry);
    return next;
}

/** Recolor an entry in place (keeps its types and priority). Refused if another entry has that color. */
export function setEntryColor(rules, index, color) {
    const next = clone(rules);
    const entry = next.colors[index];
    if (
        !entry ||
        ![...TRAY_DOT_COLORS, TRAY_DOT_OFF].includes(color) ||
        next.colors.some((e, i) => i !== index && e.color === color)
    ) {
        return next;
    }
    entry.color = color;
    return next;
}

/**
 * Put `type` in entry `index`, taking it out of whichever entry had it.
 * Unknown types are ignored.
 */
export function assignType(rules, index, type) {
    const next = clone(rules);
    if (!Object.hasOwn(TRAY_DOT_TYPES, type) || !next.colors[index]) {
        return next;
    }
    for (const entry of next.colors) {
        entry.types = entry.types.filter((t) => t !== type);
    }
    next.colors[index].types.push(type);
    return next;
}

/** Back to "everything else". */
export function unassignType(rules, type) {
    const next = clone(rules);
    for (const entry of next.colors) {
        entry.types = entry.types.filter((t) => t !== type);
    }
    return next;
}

export function setFallback(rules, color) {
    const next = clone(rules);
    if ([...TRAY_DOT_COLORS, TRAY_DOT_OFF].includes(color)) {
        next.fallback = color;
    }
    return next;
}

/** Index of the entry holding `type`, or -1 (= follows "everything else"). */
export function entryIndexOfType(rules, type) {
    return rules.colors.findIndex((e) => e.types.includes(type));
}
