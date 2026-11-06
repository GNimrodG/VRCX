/**
 * Parses the payload of a `notification` game-log entry — the text VRChat
 * writes to its output log when the game receives a notification:
 *
 * Notification from username:JustZen, sender user id:usr_…, to usr_… of type: requestInvite, id: not_…,
 * created at: 11/05/2026 22:48:49 UTC, details: {{}}, type:requestInvite, m seen:False, message: ""
 *
 * `details` is a Java-style `{{key=value, key=value}}` map, not JSON. Older
 * clients omitted the receiver id (`to of type`), which this tolerates.
 *
 * Fork-only file (see CLAUDE.md §5): the game log is a second, independent
 * source for notifications, so one the server's pipeline connection never
 * delivered can still be recovered.
 */

const LOG_NOTIFICATION_PATTERN =
    /Notification from username:(.*?), sender user id:(usr_[\w-]+)\s+to\s*(usr_[\w-]+)?\s*of type:\s*([\w.]+), id:\s*(not_[\w-]+), created at:\s*(\d\d)\/(\d\d)\/(\d{4}) (\d\d:\d\d:\d\d) UTC, details:\s*\{\{(.*?)\}\}, type:\s*([\w.]+), m seen:\s*(True|False), message:\s*"(.*)"\s*>?\s*$/s;

const DETAIL_KEYS = ['worldId', 'worldName', 'imageUrl', 'inviteMessage', 'requestMessage', 'responseMessage'];

/**
 * Splits `worldId=wrld_x:1~friends(usr_y), worldName=A, B` on the known keys
 * only, since values (world names, messages) can contain `, ` themselves.
 *
 * @param {string} raw The text between `{{` and `}}`
 * @returns {Record<string, string>}
 */
export function parseLogNotificationDetails(raw) {
    const keyPattern = new RegExp(`(?:^|, )(${DETAIL_KEYS.join('|')})=`, 'g');
    const marks = [...raw.matchAll(keyPattern)];
    /** @type {Record<string, string>} */
    const details = {};
    marks.forEach((mark, i) => {
        const start = mark.index + mark[0].length;
        const end = i + 1 < marks.length ? marks[i + 1].index : raw.length;
        details[mark[1]] = raw.slice(start, end);
    });
    return details;
}

/**
 * @param {string} data The `notification` log entry's payload
 * @returns {{
 *     id: string;
 *     type: string;
 *     senderUserId: string;
 *     senderUsername: string;
 *     receiverUserId: string;
 *     message: string;
 *     seen: boolean;
 *     created_at: string;
 *     details: Record<string, string>;
 * } | null}
 *   The notification in the shape the pipeline delivers, `null` if it doesn't parse
 */
export function parseLogNotification(data) {
    const match = LOG_NOTIFICATION_PATTERN.exec(data ?? '');
    if (!match) {
        return null;
    }
    const [, senderUsername, senderUserId, receiverUserId, type, id, month, day, year, time, details, , seen, message] =
        match;
    return {
        id,
        type,
        senderUserId,
        senderUsername,
        receiverUserId: receiverUserId ?? '',
        message,
        seen: seen === 'True',
        created_at: `${year}-${month}-${day}T${time}.000Z`,
        details: parseLogNotificationDetails(details)
    };
}
