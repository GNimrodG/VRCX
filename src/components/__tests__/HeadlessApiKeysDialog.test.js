import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) })
}));

// Render the dialog inline: the real one portals out of the wrapper.
vi.mock('@/components/ui/dialog', () => ({
    Dialog: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
    DialogContent: { template: '<div><slot /></div>' },
    DialogHeader: { template: '<div><slot /></div>' },
    DialogTitle: { template: '<h2><slot /></h2>' },
    DialogDescription: { template: '<p><slot /></p>' }
}));

const rpc = vi.fn();
const baseKeys = {
    keys: [
        {
            id: 'abcd1234',
            name: 'overlay',
            scopes: ['profile:read'],
            createdAt: '2026-11-01T00:00:00.000Z',
            expiresAt: null,
            lastUsedAt: null
        }
    ],
    scopes: { 'profile:read': 'Current user', 'users:read': 'Cached users' }
};

beforeEach(() => {
    rpc.mockReset();
    globalThis.window.vrcxDesktopAgent = { rpc };
});

async function mountOpen() {
    const { default: Dialog } = await import('../HeadlessApiKeysDialog.vue');
    const wrapper = mount(Dialog, { props: { open: false } });
    await wrapper.setProps({ open: true });
    await flushPromises();
    return wrapper;
}

describe('HeadlessApiKeysDialog.vue', () => {
    it('lists keys and scopes from the server RPC', async () => {
        rpc.mockResolvedValue({ ok: true, result: baseKeys });
        const wrapper = await mountOpen();
        expect(rpc).toHaveBeenCalledWith('apikeys', 'list', []);
        expect(wrapper.text()).toContain('overlay');
        expect(wrapper.text()).toContain('abcd1234');
        expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2);
    });

    it('says the API is disabled when the server has no apikeys target', async () => {
        rpc.mockResolvedValue({ ok: false, error: 'RPC target not available: apikeys' });
        const wrapper = await mountOpen();
        expect(wrapper.text()).toContain('status_bar.headless_api_keys_disabled');
        expect(wrapper.find('form').exists()).toBe(false);
    });

    it('creates a key, shows it once, and forgets it when closed', async () => {
        rpc.mockImplementation(async (_target, method) =>
            method === 'create'
                ? { ok: true, result: { key: 'vrcx_abcd1234_secret', record: {} } }
                : { ok: true, result: baseKeys }
        );
        const wrapper = await mountOpen();
        await wrapper.find('input:not([type="checkbox"])').setValue('my key');
        await wrapper.findAll('input[type="checkbox"]')[0].setValue(true);
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        const create = rpc.mock.calls.find((c) => c[1] === 'create');
        expect(create[2][0]).toMatchObject({ name: 'my key', scopes: ['profile:read'], expiresAt: null });
        expect(wrapper.text()).toContain('vrcx_abcd1234_secret');

        await wrapper.setProps({ open: false });
        await wrapper.setProps({ open: true });
        await flushPromises();
        expect(wrapper.text()).not.toContain('vrcx_abcd1234_secret');
    });

    it('revokes only on the second click', async () => {
        rpc.mockResolvedValue({ ok: true, result: baseKeys });
        const wrapper = await mountOpen();
        const revokeButton = () => wrapper.findAll('button').find((b) => b.text().includes('headless_api_keys_revoke'));
        await revokeButton().trigger('click');
        expect(rpc.mock.calls.some((c) => c[1] === 'revoke')).toBe(false);
        await revokeButton().trigger('click');
        await flushPromises();
        expect(rpc).toHaveBeenCalledWith('apikeys', 'revoke', ['abcd1234']);
    });
});
