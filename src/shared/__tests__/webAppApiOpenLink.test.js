import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn() } }));

const { appApiTarget } = await import('../../../client-web/shims/app-api.js');

describe('web client AppApi.OpenLink', () => {
    beforeEach(() => {
        vi.spyOn(window, 'open').mockImplementation(() => null);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('opens http(s) links in a new tab without handing over window.opener', async () => {
        await appApiTarget.OpenLink('https://vrchat.com/home');
        expect(window.open).toHaveBeenCalledWith('https://vrchat.com/home', '_blank', 'noopener,noreferrer');
    });

    it('opens the link before any await, so popup blockers allow it', () => {
        appApiTarget.OpenLink('http://example.com/');
        expect(window.open).toHaveBeenCalledTimes(1);
    });

    it.each(['javascript:alert(1)', 'file:///etc/passwd', 'vrchat://launch?id=x', 'not a url', '', null, undefined])(
        'ignores %s, like native',
        async (url) => {
            await appApiTarget.OpenLink(url);
            expect(window.open).not.toHaveBeenCalled();
        }
    );
});
