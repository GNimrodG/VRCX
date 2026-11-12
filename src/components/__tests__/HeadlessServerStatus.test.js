import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import HeadlessServerStatus from '../HeadlessServerStatus.vue';

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) })
}));

// Render popovers/tooltips inline: the real ones portal out of the wrapper.
vi.mock('@/components/ui/popover', () => ({
    Popover: { props: ['open'], template: '<div><slot /></div>' },
    PopoverTrigger: { template: '<div><slot /></div>' },
    PopoverContent: { template: '<div><slot /></div>' }
}));
vi.mock('@/components/ui/tooltip', () => ({
    TooltipWrapper: { props: ['content'], template: '<div :title="content"><slot /></div>' }
}));
// The API-key dialog has its own tests; keep it out of these.
vi.mock('@/components/HeadlessApiKeysDialog.vue', () => ({
    default: { template: '<div data-testid="api-keys-dialog" />' }
}));

const WEB_ORIGIN = 'http://web.example:9000';
const STORAGE_KEY = 'vrcx_headless_servers';
let wrapper;
let assign;

/**
 * @param {{ open?: boolean }} [options] `open` mimics the user opening the
 *   popover, which is what makes the real component load its server list.
 */
async function mountComponent({ open = false } = {}) {
    wrapper = mount(HeadlessServerStatus, { attachTo: document.body });
    await flushPromises();
    if (open) {
        wrapper.vm.open = true;
        await flushPromises();
    }
    return wrapper;
}

const text = () => wrapper.text();
const buttonByText = (needle) => wrapper.findAll('button').find((b) => b.text().includes(needle));

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    delete window.vrcxDesktopAgent;
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe('HeadlessServerStatus.vue (web client)', () => {
    beforeEach(() => {
        assign = vi.fn();
        vi.stubGlobal('location', { origin: WEB_ORIGIN, host: 'web.example:9000', assign });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    });

    it("shows this page's own server as the active, reachable one", async () => {
        await mountComponent();
        expect(text()).toContain('status_bar.headless');
        expect(text()).toContain('web.example:9000');
        expect(wrapper.find('[title="web.example:9000: status_bar.headless_reachable"]').exists()).toBe(true);
        expect(fetch).toHaveBeenCalledWith('/api/update-info', { cache: 'no-store' });
    });

    it('shows it as unreachable when the server cannot be reached', async () => {
        fetch.mockRejectedValue(new Error('Failed to fetch'));
        await mountComponent();
        expect(wrapper.find('[title="web.example:9000: status_bar.headless_unreachable"]').exists()).toBe(true);
    });

    it('greys out the active server in the list until it is connected', async () => {
        fetch.mockRejectedValue(new Error('Failed to fetch'));
        await mountComponent({ open: true });
        const row = wrapper.find('[data-connected]');
        expect(row.attributes('data-connected')).toBe('false');
        expect(row.classes()).toContain('opacity-50');
    });

    it('shows the active server at full strength once connected', async () => {
        await mountComponent({ open: true });
        const row = wrapper.find('[data-connected]');
        expect(row.attributes('data-connected')).toBe('true');
        expect(row.classes()).not.toContain('opacity-50');
    });

    it('reacts to the browser going offline without polling', async () => {
        await mountComponent();
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        await flushPromises();
        expect(wrapper.find('[title="web.example:9000: status_bar.headless_unreachable"]').exists()).toBe(true);
    });

    it('lists remembered servers and navigates to the chosen one with a full-page load', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(['http://pi.local:9010']));
        await mountComponent({ open: true });
        const row = wrapper.findAll('span').find((s) => s.text() === 'pi.local:9010');
        expect(row).toBeTruthy();
        await row.trigger('click');
        expect(text()).toContain('status_bar.headless_switch_confirm_web');
        expect(text()).not.toContain('status_bar.headless_switch_confirm:'); // desktop's "app will restart" text
        await buttonByText('status_bar.headless_switch').trigger('click');
        expect(assign).toHaveBeenCalledWith('http://pi.local:9010');
    });

    it('does not offer to switch to the server you are already on', async () => {
        await mountComponent({ open: true });
        const current = wrapper
            .findAll('span')
            .find((s) => s.text() === 'web.example:9000' && s.classes().includes('text-[11px]'));
        expect(current).toBeTruthy();
        // no ✕ (remove) for the active row, and clicking it asks nothing and goes nowhere
        expect(buttonByText('✕')).toBeUndefined();
        await current.trigger('click');
        expect(text()).not.toContain('status_bar.headless_switch_confirm');
        expect(assign).not.toHaveBeenCalled();
    });

    it('adds a server by URL, normalising it, with no pairing step', async () => {
        await mountComponent({ open: true });
        await buttonByText('status_bar.headless_add').trigger('click');
        const input = wrapper.find('input');
        await input.setValue('pi.local:9010/some/path');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(['http://pi.local:9010']);
        expect(text()).toContain('pi.local:9010');
        // no pairing/QR step on the web: it went straight back to the list
        expect(text()).not.toContain('status_bar.headless_scan');
    });

    it('rejects an invalid URL, and never stores the current server as an "other" one', async () => {
        await mountComponent({ open: true });
        await buttonByText('status_bar.headless_add').trigger('click');
        await wrapper.find('input').setValue('ftp://nope');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(text()).toContain('status_bar.headless_url_invalid');
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

        await wrapper.find('input').setValue(WEB_ORIGIN);
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([]);
    });

    it('removes a remembered server', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(['http://pi.local:9010', 'http://other:1']));
        await mountComponent({ open: true });
        await buttonByText('✕').trigger('click');
        await buttonByText('status_bar.headless_remove').trigger('click');
        await flushPromises();
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(['http://other:1']);
    });

    it('hides the desktop-only controls', async () => {
        await mountComponent({ open: true });
        expect(text()).not.toContain('status_bar.headless_ca_cert');
        expect(text()).not.toContain('status_bar.headless_set_default');
        expect(text()).not.toContain('status_bar.headless_api_keys_open_browser');
        // but the API-keys entry is there
        expect(text()).toContain('status_bar.headless_api_keys_open');
    });

    it('survives unusable storage', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        await mountComponent();
        expect(text()).toContain('web.example:9000');
    });
});

describe('HeadlessServerStatus.vue (desktop)', () => {
    it('still uses the desktop agent, not browser storage or navigation', async () => {
        assign = vi.fn();
        vi.stubGlobal('location', { origin: 'file://', host: '', assign });
        const agent = {
            getServerStatus: vi.fn().mockResolvedValue({ url: 'https://pi:9010', label: 'pi:9010', reachable: true }),
            listServers: vi
                .fn()
                .mockResolvedValue([{ url: 'https://pi:9010', label: 'pi:9010', active: true, isDefault: true }]),
            getCaCertStatus: vi.fn().mockResolvedValue({ imported: false }),
            onServerStatusChanged: vi.fn().mockReturnValue(() => {}),
            switchServer: vi.fn().mockResolvedValue({ ok: true })
        };
        window.vrcxDesktopAgent = agent;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(['http://should-not-show:1']));
        await mountComponent();
        expect(agent.getServerStatus).toHaveBeenCalled();
        expect(text()).toContain('pi:9010');
        expect(text()).not.toContain('should-not-show');
        expect(text()).toContain('status_bar.headless_ca_cert'); // desktop-only section present
        expect(assign).not.toHaveBeenCalled();
    });
});
