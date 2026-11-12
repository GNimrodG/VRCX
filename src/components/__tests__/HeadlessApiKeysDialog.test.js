import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import HeadlessApiKeysDialog from '../HeadlessApiKeysDialog.vue';

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key) => key })
}));

// Render the dialog inline: the real one portals out of the wrapper.
vi.mock('@/components/ui/dialog', () => ({
    Dialog: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
    DialogContent: { template: '<div><slot /></div>' },
    DialogHeader: { template: '<div><slot /></div>' },
    DialogTitle: { template: '<h2><slot /></h2>' },
    DialogDescription: { template: '<p><slot /></p>' }
}));

const SERVER = 'https://pi.example:9010';
const rpc = vi.fn();
let wrapper;

async function mountOpen() {
    wrapper = mount(HeadlessApiKeysDialog, { props: { open: false }, attachTo: document.body });
    await wrapper.setProps({ open: true });
    await flushPromises();
    return wrapper;
}

/**
 * @param {object} init MessageEvent fields
 */
function sendMessage(init) {
    window.dispatchEvent(new MessageEvent('message', init));
    return flushPromises();
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    delete window.vrcxDesktopAgent;
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark');
});

describe('HeadlessApiKeysDialog.vue (desktop)', () => {
    beforeEach(() => {
        rpc.mockReset();
        rpc.mockResolvedValue({ ok: true, result: { keys: [], scopes: {} } });
        window.vrcxDesktopAgent = { getServerStatus: async () => ({ url: `${SERVER}/` }), rpc };
    });

    it("frames the connected server's own page, passing the theme", async () => {
        document.documentElement.classList.add('dark');
        await mountOpen();
        expect(wrapper.find('iframe').attributes('src')).toMatch(
            new RegExp(`^${SERVER}/admin/api-keys\\?bridge=1&theme=dark(&|$)`)
        );
    });

    it('does not frame anything when the server has the API disabled', async () => {
        rpc.mockResolvedValue({ ok: false, error: 'RPC target not available: apikeys' });
        await mountOpen();
        expect(wrapper.find('iframe').exists()).toBe(false);
        expect(wrapper.text()).toContain('status_bar.headless_api_keys_disabled');
    });

    it('shows an error instead of an empty frame when the probe fails', async () => {
        rpc.mockResolvedValue({ ok: false, error: 'Not authenticated with the VRCX server' });
        await mountOpen();
        expect(wrapper.find('iframe').exists()).toBe(false);
        expect(wrapper.find('[role="alert"]').text()).toContain('Not authenticated');
    });

    it('forwards the three key methods from its own frame and answers it', async () => {
        await mountOpen();
        const contentWindow = wrapper.find('iframe').element.contentWindow;
        const post = vi.spyOn(contentWindow, 'postMessage');
        rpc.mockClear();
        rpc.mockResolvedValueOnce({ ok: true, result: { key: 'vrcx_x_y', record: {} } });

        await sendMessage({
            data: {
                type: 'vrcx-apikeys-rpc',
                id: 7,
                method: 'create',
                args: [{ name: 'n', scopes: ['profile:read'] }]
            },
            origin: SERVER,
            source: contentWindow
        });

        expect(rpc).toHaveBeenCalledWith('apikeys', 'create', [{ name: 'n', scopes: ['profile:read'] }]);
        // Answered to the server's origin only, never '*'.
        expect(post).toHaveBeenCalledWith(
            { type: 'vrcx-apikeys-rpc-result', id: 7, result: { ok: true, result: { key: 'vrcx_x_y', record: {} } } },
            SERVER
        );
    });

    it('turns a rejected call into an error reply instead of leaving the frame hanging', async () => {
        await mountOpen();
        const contentWindow = wrapper.find('iframe').element.contentWindow;
        const post = vi.spyOn(contentWindow, 'postMessage');
        rpc.mockRejectedValueOnce(new Error('Connection lost'));
        await sendMessage({
            data: { type: 'vrcx-apikeys-rpc', id: 1, method: 'list', args: [] },
            origin: SERVER,
            source: contentWindow
        });
        expect(post.mock.calls[0][0].result).toEqual({ ok: false, error: 'Connection lost' });
    });

    it('ignores messages from other windows, other origins, other methods or other shapes', async () => {
        await mountOpen();
        const contentWindow = wrapper.find('iframe').element.contentWindow;
        rpc.mockClear();
        const ok = { type: 'vrcx-apikeys-rpc', id: 1, method: 'list', args: [] };

        await sendMessage({ data: ok, origin: SERVER, source: window }); // not our frame
        await sendMessage({ data: ok, origin: 'https://evil.example', source: contentWindow }); // wrong origin
        await sendMessage({ data: { ...ok, method: 'getString' }, origin: SERVER, source: contentWindow }); // not a key method
        await sendMessage({ data: { ...ok, method: 'constructor' }, origin: SERVER, source: contentWindow });
        await sendMessage({ data: { ...ok, type: 'other' }, origin: SERVER, source: contentWindow });
        await sendMessage({ data: null, origin: SERVER, source: contentWindow });

        expect(rpc).not.toHaveBeenCalled();
    });

    it('stops serving the frame, and drops it, once closed', async () => {
        await mountOpen();
        const contentWindow = wrapper.find('iframe').element.contentWindow;
        await wrapper.setProps({ open: false });
        await flushPromises();
        rpc.mockClear();
        await sendMessage({
            data: { type: 'vrcx-apikeys-rpc', id: 1, method: 'list', args: [] },
            origin: SERVER,
            source: contentWindow
        });
        expect(rpc).not.toHaveBeenCalled();
        expect(wrapper.find('iframe').exists()).toBe(false);
    });
});

describe('HeadlessApiKeysDialog.vue (web client)', () => {
    it('frames the same-origin page when the API is enabled', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true }));
        await mountOpen();
        expect(fetch).toHaveBeenCalledWith('/api/v1/openapi.json');
        expect(wrapper.find('iframe').attributes('src')).toMatch(/^\/admin\/api-keys\?theme=light(&|$)/);
    });

    it('does not frame the page when the API is disabled (it would frame the web client itself)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }));
        await mountOpen();
        expect(wrapper.find('iframe').exists()).toBe(false);
        expect(wrapper.text()).toContain('status_bar.headless_api_keys_disabled');
    });

    it('shows an error when the server cannot be reached', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
        await mountOpen();
        expect(wrapper.find('[role="alert"]').text()).toContain('Failed to fetch');
    });
});
