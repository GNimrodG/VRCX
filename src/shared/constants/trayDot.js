/**
 * Everything that can light the tray/favicon notification dot, and the colors
 * it can take. Fork-owned (see CLAUDE.md §5).
 *
 * `TRAY_DOT_TYPES` is the single registry the settings UI renders from and the
 * resolver validates against. `src/shared/constants/__tests__/trayDot.test.js`
 * diffs it against the places upstream defines notification / friend-log types
 * (the notification filter list in `Notification.vue`, `notificationCategory.js`,
 * the friend-log writers), so a type upstream adds and we don't register fails
 * `pnpm test` instead of silently falling into the catch-all.
 */

/**
 * Order is display order only; priority is user-defined. Each color needs a
 * `images/VRCX_notify_<color>.{png,ico}` (`scripts/generate-tray-icons.sh`);
 * `red` is the original `VRCX_notify.*`.
 */
export const TRAY_DOT_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'];

/** Fallback choice meaning "no dot for anything not explicitly assigned". */
export const TRAY_DOT_OFF = 'off';

/** `view.settings…` group headings for the settings UI. */
export const TRAY_DOT_GROUPS = ['friends', 'friendLog', 'groups', 'moderation', 'system'];

const notification = (group) => ({
    source: 'notification',
    group,
    // Same strings the Notifications page filter already shows.
    labelKey: null
});
const friendLog = () => ({ source: 'friendLog', group: 'friendLog', labelKey: null });

/**
 * @type {Readonly<
 *     Record<string, { source: 'notification' | 'friendLog'; group: string; labelKey: string | null }>
 * >}
 */
const registry = {
    // Friend notifications
    requestInvite: notification('friends'),
    invite: notification('friends'),
    requestInviteResponse: notification('friends'),
    inviteResponse: notification('friends'),
    friendRequest: notification('friends'),
    ignoredFriendRequest: notification('friends'),
    message: notification('friends'),
    boop: notification('friends'),

    // Friend-log events (a friend-log entry also lights the dot)
    Friend: friendLog(),
    Unfriend: friendLog(),
    DisplayName: friendLog(),
    TrustLevel: friendLog(),

    // Group notifications
    'event.announcement': notification('groups'),
    groupChange: notification('groups'),
    'group.announcement': notification('groups'),
    'group.informative': notification('groups'),
    'group.invite': notification('groups'),
    'group.joinRequest': notification('groups'),
    'group.transfer': notification('groups'),
    'group.queueReady': notification('groups'),
    'group.event.created': notification('groups'),
    'group.event.starting': notification('groups'),

    // Moderation
    'moderation.warning.group': notification('moderation'),
    'moderation.report.closed': notification('moderation'),
    'moderation.contentrestriction': notification('moderation'),

    // System-ish
    'instance.closed': notification('system'),
    'economy.alert': notification('system'),
    'twitchdrop.fulfilled': notification('system')
};

// i18n keys: notification types reuse the Notifications-page filter labels,
// friend-log types reuse the Friend Log page's.
for (const [type, entry] of Object.entries(registry)) {
    entry.labelKey =
        entry.source === 'friendLog' ? `view.friend_log.filters.${type}` : `view.notification.filters.${type}`;
}

export const TRAY_DOT_TYPES = Object.freeze(registry);

/** @type {readonly string[]} */
export const TRAY_DOT_TYPE_IDS = Object.freeze(Object.keys(TRAY_DOT_TYPES));

/** `VRCX_trayDotRules` default: red for everything, nothing assigned. */
export const DEFAULT_TRAY_DOT_RULES = Object.freeze({ fallback: 'red', colors: [] });

/** The dot's actual pixel color per variant, for UI swatches (sampled from the generated icons). */
export const TRAY_DOT_SWATCHES = Object.freeze({
    red: '#f04747',
    orange: '#f09c47',
    yellow: '#f0e247',
    green: '#47f055',
    cyan: '#47f0f0',
    blue: '#478df0',
    purple: '#aa47f0'
});
