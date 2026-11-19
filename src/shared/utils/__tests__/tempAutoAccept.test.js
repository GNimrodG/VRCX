import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    isTempAutoAcceptSender,
    restoreTempAutoAccept,
    setTempAutoAcceptEnabled,
    setTempAutoAcceptUserIds
} from '../tempAutoAccept';

describe('tempAutoAccept', () => {
    beforeEach(() => {
        setTempAutoAcceptEnabled(false);
        setTempAutoAcceptUserIds([]);
    });

    it('starts off, so nothing is accepted until it is turned on by hand', () => {
        expect(isTempAutoAcceptSender('usr_a')).toBe(false);
    });

    it('accepts only listed senders while enabled', () => {
        setTempAutoAcceptUserIds(['usr_a', 'usr_b']);
        expect(isTempAutoAcceptSender('usr_a')).toBe(false);
        setTempAutoAcceptEnabled(true);
        expect(isTempAutoAcceptSender('usr_a')).toBe(true);
        expect(isTempAutoAcceptSender('usr_c')).toBe(false);
        setTempAutoAcceptEnabled(false);
        expect(isTempAutoAcceptSender('usr_a')).toBe(false);
    });

    it('drops junk and duplicate ids', () => {
        setTempAutoAcceptEnabled(true);
        setTempAutoAcceptUserIds(['usr_a', 'usr_a', '', null, 5]);
        expect(isTempAutoAcceptSender('usr_a')).toBe(true);
        expect(isTempAutoAcceptSender(undefined)).toBe(false);
        setTempAutoAcceptUserIds('nope');
        expect(isTempAutoAcceptSender('usr_a')).toBe(false);
    });
});

describe('tempAutoAccept persistence (web client, sessionStorage)', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        setTempAutoAcceptEnabled(false);
        setTempAutoAcceptUserIds([]);
    });

    it('restores what was saved before a reload', async () => {
        window.sessionStorage.setItem('VRCX_tempAutoAccept', JSON.stringify({ enabled: true, userIds: ['usr_a'] }));
        await restoreTempAutoAccept();
        expect(isTempAutoAcceptSender('usr_a')).toBe(true);
    });

    it('stays off when nothing was saved', async () => {
        await restoreTempAutoAccept();
        expect(isTempAutoAcceptSender('usr_a')).toBe(false);
    });

    it('saves every change', async () => {
        setTempAutoAcceptUserIds(['usr_b']);
        setTempAutoAcceptEnabled(true);
        await vi.waitFor(() => {
            expect(JSON.parse(window.sessionStorage.getItem('VRCX_tempAutoAccept'))).toEqual({
                enabled: true,
                userIds: ['usr_b']
            });
        });
    });

    it('ignores corrupt saved data instead of crashing', async () => {
        setTempAutoAcceptUserIds(['usr_b']);
        setTempAutoAcceptEnabled(true);
        window.sessionStorage.setItem('VRCX_tempAutoAccept', '{nope');
        await restoreTempAutoAccept();
        expect(isTempAutoAcceptSender('usr_b')).toBe(true);
    });
});

describe('tempAutoAccept persistence (desktop client, main process)', () => {
    it('restores from and saves to the main process', async () => {
        const setTempAutoAccept = vi.fn(() => Promise.resolve());
        window.electron = {
            getTempAutoAccept: vi.fn(() => Promise.resolve({ enabled: true, userIds: ['usr_d'] })),
            setTempAutoAccept
        };
        try {
            await restoreTempAutoAccept();
            expect(isTempAutoAcceptSender('usr_d')).toBe(true);
            setTempAutoAcceptUserIds(['usr_e']);
            await vi.waitFor(() => {
                expect(setTempAutoAccept).toHaveBeenLastCalledWith({ enabled: true, userIds: ['usr_e'] });
            });
        } finally {
            delete window.electron;
        }
    });
});
