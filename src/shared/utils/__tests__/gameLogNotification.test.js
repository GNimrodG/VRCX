import { describe, expect, it } from 'vitest';

import { parseLogNotification, parseLogNotificationDetails } from '../gameLogNotification';

describe('parseLogNotification', () => {
    it('parses a requestInvite with empty details (real log line)', () => {
        const data =
            'Notification from username:JustZen, sender user id:usr_aaaa to usr_bbbb of type: requestInvite, id: not_49b47bc8-0f61-4db3-a2a2-97868d571dee, created at: 11/05/2026 22:48:49 UTC, details: {{}}, type:requestInvite, m seen:False, message: "">';
        expect(parseLogNotification(data)).toEqual({
            id: 'not_49b47bc8-0f61-4db3-a2a2-97868d571dee',
            type: 'requestInvite',
            senderUserId: 'usr_aaaa',
            senderUsername: 'JustZen',
            receiverUserId: 'usr_bbbb',
            message: '',
            seen: false,
            created_at: '2026-11-05T22:48:49.000Z',
            details: {}
        });
    });

    it('parses an invite whose world name contains commas and unicode', () => {
        const data =
            'Notification from username:Jexxon, sender user id:usr_aaaa to usr_bbbb of type: invite, id: not_1, created at: 11/05/2026 23:42:47 UTC, details: {{worldId=wrld_x:1~private(usr_aaaa)~region(use), worldName=FISH ǃ ［HALLOWEEN］, with, commas}}, type:invite, m seen:False, message: "hi">';
        const parsed = parseLogNotification(data);
        expect(parsed.details).toEqual({
            worldId: 'wrld_x:1~private(usr_aaaa)~region(use)',
            worldName: 'FISH ǃ ［HALLOWEEN］, with, commas'
        });
        expect(parsed.message).toBe('hi');
    });

    it('accepts the old format (leading space, no receiver id, received-at suffix)', () => {
        const data =
            ' Notification from username:pypy, sender user id:usr_4f76 to of type: friendRequest, id: not_3a8f, created at: 01/14/2021 15:38:40 UTC, details: {{}}, type:friendRequest, m seen:False, message: ""> received at 01/02/2021 16:48:58 UTC';
        const parsed = parseLogNotification(data.replace(/> received at .*$/, '>'));
        expect(parsed).toMatchObject({ id: 'not_3a8f', receiverUserId: '', created_at: '2021-01-14T15:38:40.000Z' });
    });

    it('returns null for anything else', () => {
        expect(parseLogNotification('')).toBeNull();
        expect(parseLogNotification('Notification from username:x')).toBeNull();
        expect(parseLogNotification(undefined)).toBeNull();
    });
});

describe('parseLogNotificationDetails', () => {
    it('ignores unknown keys inside values', () => {
        expect(parseLogNotificationDetails('worldName=a=b, c')).toEqual({ worldName: 'a=b, c' });
    });
});
