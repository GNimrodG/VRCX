<template>
    <Dialog v-model:open="open">
        <!-- The dialog itself never scrolls: while the form is showing it gets a
             bounded height and the frame fills the rest, so the framed page is
             the only scroller (no double scrollbars on short screens). -->
        <DialogContent
            class="overflow-hidden sm:max-w-2xl"
            :class="state === 'ready' ? 'h-[min(85vh,52rem)] grid-rows-[auto_minmax(0,1fr)]' : ''">
            <DialogHeader>
                <DialogTitle>{{ t('status_bar.headless_api_keys') }}</DialogTitle>
                <DialogDescription>{{ t('status_bar.headless_api_keys_description') }}</DialogDescription>
            </DialogHeader>

            <p v-if="state === 'loading'" class="m-0 text-sm text-muted-foreground">
                {{ t('status_bar.headless_api_keys_loading') }}
            </p>
            <p v-else-if="state === 'disabled'" class="m-0 text-sm text-muted-foreground">
                {{ t('status_bar.headless_api_keys_disabled') }}
            </p>
            <p v-else-if="state === 'error'" class="m-0 text-sm text-destructive" role="alert">{{ loadError }}</p>
            <!-- The form is the server's own page, not reimplemented here, so
                 it always matches the server it manages. -->
            <iframe
                v-else
                ref="frame"
                :src="frameUrl"
                :title="t('status_bar.headless_api_keys')"
                class="h-full min-h-0 w-full border-0 bg-transparent" />
        </DialogContent>
    </Dialog>
</template>

<script setup>
    import { onBeforeUnmount, ref, watch } from 'vue';
    import { useI18n } from 'vue-i18n';

    import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

    const { t } = useI18n();

    const open = defineModel('open', { type: Boolean, default: false });

    // Present only on the Electron build (src-electron/preload.js). There the
    // page is `file://` and holds no session cookie, so the framed page asks
    // this component to forward its calls over the desktop's authenticated
    // channel (the server's `apikeys` RPC target). On the web client the
    // frame is same-origin and the page just uses the session cookie.
    const agent = window.vrcxDesktopAgent;

    const BRIDGE_METHODS = new Set(['list', 'create', 'revoke']);

    const state = ref('loading');
    const loadError = ref('');
    const frame = ref(null);
    const frameUrl = ref('');
    let serverOrigin = '';

    watch(open, (isOpen) => {
        if (isOpen) {
            start();
        } else {
            stop();
        }
    });

    onBeforeUnmount(stop);

    /**
     * @returns {'dark' | 'light'}
     */
    function currentTheme() {
        return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }

    async function start() {
        state.value = 'loading';
        loadError.value = '';
        frameUrl.value = '';
        try {
            if (agent) {
                const { url } = await agent.getServerStatus();
                if (!url) {
                    throw new Error(t('status_bar.headless_api_keys_load_failed'));
                }
                // The frame loads only if the API is enabled; the same call
                // answers "is it?" (a disabled server has no `apikeys` target).
                const probe = await agent.rpc('apikeys', 'list', []);
                if (!probe.ok) {
                    if (/not available/i.test(probe.error ?? '')) {
                        state.value = 'disabled';
                        return;
                    }
                    throw new Error(probe.error ?? t('status_bar.headless_api_keys_load_failed'));
                }
                serverOrigin = new URL(url).origin;
                frameUrl.value = `${serverOrigin}/admin/api-keys?bridge=1&theme=${currentTheme()}`;
                window.addEventListener('message', onFrameMessage);
            } else {
                // Without it a disabled server would answer /admin/api-keys
                // with the web client itself, framing the app inside itself.
                const response = await fetch('/api/v1/openapi.json');
                if (response.status === 404) {
                    state.value = 'disabled';
                    return;
                }
                if (!response.ok) {
                    throw new Error(t('status_bar.headless_api_keys_load_failed'));
                }
                frameUrl.value = `/admin/api-keys?theme=${currentTheme()}`;
            }
            state.value = 'ready';
        } catch (err) {
            state.value = 'error';
            loadError.value = err?.message ?? t('status_bar.headless_api_keys_load_failed');
        }
    }

    function stop() {
        window.removeEventListener('message', onFrameMessage);
        // Unmount the frame so a revealed key doesn't linger in a hidden page.
        frameUrl.value = '';
        state.value = 'loading';
    }

    /**
     * Forwards the framed page's key operations to the server over the
     * desktop's RPC channel. Only our own iframe, from the server's own
     * origin, and only the three key methods are served.
     *
     * @param {MessageEvent} event
     */
    async function onFrameMessage(event) {
        const frameWindow = frame.value?.contentWindow;
        const data = event.data;
        if (
            !frameWindow ||
            event.source !== frameWindow ||
            event.origin !== serverOrigin ||
            data?.type !== 'vrcx-apikeys-rpc' ||
            !BRIDGE_METHODS.has(data.method)
        ) {
            return;
        }
        let result;
        try {
            result = await agent.rpc('apikeys', data.method, Array.isArray(data.args) ? data.args : []);
        } catch (err) {
            result = { ok: false, error: err?.message ?? String(err) };
        }
        frameWindow.postMessage({ type: 'vrcx-apikeys-rpc-result', id: data.id, result }, serverOrigin);
    }
</script>
