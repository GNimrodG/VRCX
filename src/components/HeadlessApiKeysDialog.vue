<template>
    <Dialog v-model:open="open">
        <DialogContent class="sm:max-w-2xl">
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
            <p v-else-if="state === 'error'" class="m-0 text-sm text-destructive">{{ loadError }}</p>

            <div v-else class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
                <div v-if="newKey" class="flex flex-col gap-2 rounded-md border border-border bg-muted/50 p-3">
                    <span class="text-sm font-semibold">{{ t('status_bar.headless_api_keys_copy_now') }}</span>
                    <code class="select-all break-all rounded bg-background p-2 text-xs">{{ newKey }}</code>
                    <div class="flex gap-2">
                        <Button size="sm" variant="outline" @click="copyKey">
                            {{
                                copied
                                    ? t('status_bar.headless_api_keys_copied')
                                    : t('status_bar.headless_api_keys_copy')
                            }}
                        </Button>
                        <Button size="sm" variant="ghost" @click="dismissKey">
                            {{ t('status_bar.headless_api_keys_saved') }}
                        </Button>
                    </div>
                </div>

                <form class="flex flex-col gap-3 rounded-md border border-border p-3" @submit.prevent="createKey">
                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">{{ t('status_bar.headless_api_keys_name') }}</span>
                        <Input
                            v-model="name"
                            maxlength="100"
                            required
                            :placeholder="t('status_bar.headless_api_keys_name_placeholder')" />
                    </label>
                    <fieldset class="m-0 flex flex-col gap-1 border-0 p-0">
                        <legend class="mb-1 p-0 text-sm font-medium">
                            {{ t('status_bar.headless_api_keys_scopes') }}
                        </legend>
                        <label
                            v-for="(description, scope) in scopes"
                            :key="scope"
                            class="flex items-start gap-2 text-sm">
                            <input
                                v-model="selectedScopes"
                                type="checkbox"
                                :value="scope"
                                class="mt-1 accent-primary" />
                            <span
                                ><code class="text-xs">{{ scope }}</code> {{ description }}</span
                            >
                        </label>
                    </fieldset>
                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">{{ t('status_bar.headless_api_keys_expires') }}</span>
                        <select
                            v-model.number="expiryDays"
                            class="h-9 rounded-md border border-input bg-background px-2 text-sm">
                            <option :value="0">{{ t('status_bar.headless_api_keys_expires_never') }}</option>
                            <option :value="30">{{ t('status_bar.headless_api_keys_expires_days', { n: 30 }) }}</option>
                            <option :value="90">{{ t('status_bar.headless_api_keys_expires_days', { n: 90 }) }}</option>
                            <option :value="365">
                                {{ t('status_bar.headless_api_keys_expires_days', { n: 365 }) }}
                            </option>
                        </select>
                    </label>
                    <p v-if="formError" class="m-0 text-sm text-destructive" role="alert">{{ formError }}</p>
                    <div>
                        <Button type="submit" size="sm" :disabled="busy || selectedScopes.length === 0">
                            {{ t('status_bar.headless_api_keys_create') }}
                        </Button>
                    </div>
                </form>

                <p v-if="actionError" class="m-0 text-sm text-destructive" role="alert">{{ actionError }}</p>

                <div class="flex flex-col gap-2">
                    <p v-if="keys.length === 0" class="m-0 text-sm text-muted-foreground">
                        {{ t('status_bar.headless_api_keys_empty') }}
                    </p>
                    <div
                        v-for="key in keys"
                        :key="key.id"
                        class="flex items-start justify-between gap-3 rounded-md border border-border p-2.5">
                        <div class="flex min-w-0 flex-col gap-0.5 text-sm">
                            <span class="font-medium">{{ key.name }}</span>
                            <span class="text-xs text-muted-foreground">
                                <code>{{ key.id }}</code> · {{ key.scopes.join(', ') }}
                            </span>
                            <span class="text-xs text-muted-foreground">
                                {{ t('status_bar.headless_api_keys_created') }}: {{ formatDate(key.createdAt) }} ·
                                {{ t('status_bar.headless_api_keys_expires') }}:
                                {{
                                    key.expiresAt
                                        ? formatDate(key.expiresAt)
                                        : t('status_bar.headless_api_keys_expires_never')
                                }}
                                · {{ t('status_bar.headless_api_keys_last_used') }}:
                                {{
                                    key.lastUsedAt
                                        ? formatDate(key.lastUsedAt)
                                        : t('status_bar.headless_api_keys_never_used')
                                }}
                            </span>
                        </div>
                        <Button
                            size="sm"
                            variant="destructive"
                            class="shrink-0"
                            :disabled="busy"
                            @click="revoke(key.id)">
                            {{
                                pendingRevokeId === key.id
                                    ? t('status_bar.headless_api_keys_revoke_confirm')
                                    : t('status_bar.headless_api_keys_revoke')
                            }}
                        </Button>
                    </div>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script setup>
    import { ref, watch } from 'vue';
    import { useI18n } from 'vue-i18n';

    import { Button } from '@/components/ui/button';
    import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
    import { Input } from '@/components/ui/input';

    const { t } = useI18n();

    const open = defineModel('open', { type: Boolean, default: false });

    // Only mounted on the Electron desktop build, via HeadlessServerStatus.vue
    // (src-electron/preload.js installs `vrcxDesktopAgent`). Calls go over the
    // desktop's existing authenticated RPC channel to the server's `apikeys`
    // target (server/src/rpc.js), which only exists while the API is enabled.
    const agent = window.vrcxDesktopAgent;

    const state = ref('loading');
    const loadError = ref('');
    const keys = ref([]);
    const scopes = ref({});

    const name = ref('');
    const selectedScopes = ref([]);
    const expiryDays = ref(0);
    const formError = ref('');
    const actionError = ref('');
    const busy = ref(false);

    const newKey = ref('');
    const copied = ref(false);
    const pendingRevokeId = ref(null);
    let pendingRevokeTimer = null;

    watch(open, (isOpen) => {
        if (isOpen) {
            state.value = 'loading';
            actionError.value = '';
            formError.value = '';
            load();
        } else {
            // Don't keep a plaintext key in memory once the dialog is gone.
            dismissKey();
            pendingRevokeId.value = null;
        }
    });

    /**
     * @param {string} iso
     * @returns {string}
     */
    function formatDate(iso) {
        return new Date(iso).toLocaleString();
    }

    /**
     * Every server call goes through here so a rejected call (e.g. IPC
     * failing to serialise arguments, the app losing its connection) becomes
     * a normal `{ ok: false, error }` the UI can show, instead of an
     * unhandled rejection that leaves the dialog silently doing nothing.
     *
     * @param {string} method
     * @param {unknown[]} args
     * @returns {Promise<{ ok: boolean; result?: any; error?: string }>}
     */
    async function call(method, args) {
        try {
            return await agent.rpc('apikeys', method, args);
        } catch (err) {
            return { ok: false, error: err?.message ?? String(err) };
        }
    }

    async function load() {
        const result = await call('list', []);
        if (!result.ok) {
            if (/not available/i.test(result.error ?? '')) {
                state.value = 'disabled';
            } else if (state.value === 'ready') {
                // Already showing keys (e.g. refreshing after a create):
                // keep them, and the one-time new key, on screen.
                actionError.value = result.error ?? t('status_bar.headless_api_keys_load_failed');
            } else {
                state.value = 'error';
                loadError.value = result.error ?? t('status_bar.headless_api_keys_load_failed');
            }
            return;
        }
        actionError.value = '';
        keys.value = result.result.keys;
        scopes.value = result.result.scopes;
        state.value = 'ready';
    }

    async function createKey() {
        busy.value = true;
        formError.value = '';
        try {
            const result = await call('create', [
                {
                    name: name.value,
                    // Plain copy: the ref's array is a reactive Proxy, which Electron's
                    // IPC structured clone rejects (DataCloneError).
                    scopes: [...selectedScopes.value],
                    expiresAt: expiryDays.value ? new Date(Date.now() + expiryDays.value * 864e5).toISOString() : null
                }
            ]);
            if (!result.ok) {
                formError.value = result.error ?? t('status_bar.headless_api_keys_create_failed');
                return;
            }
            newKey.value = result.result.key;
            name.value = '';
            selectedScopes.value = [];
            await load();
        } finally {
            busy.value = false;
        }
    }

    async function copyKey() {
        try {
            await navigator.clipboard.writeText(newKey.value);
            copied.value = true;
        } catch {
            // Clipboard can be unavailable; the key text is selectable as a fallback.
        }
    }

    function dismissKey() {
        newKey.value = '';
        copied.value = false;
    }

    /**
     * Two clicks, like the server's own page: the first arms, the second
     * (within 5s) revokes.
     *
     * @param {string} id
     */
    async function revoke(id) {
        if (pendingRevokeId.value !== id) {
            pendingRevokeId.value = id;
            clearTimeout(pendingRevokeTimer);
            pendingRevokeTimer = setTimeout(() => (pendingRevokeId.value = null), 5000);
            return;
        }
        clearTimeout(pendingRevokeTimer);
        pendingRevokeId.value = null;
        busy.value = true;
        actionError.value = '';
        try {
            const result = await call('revoke', [id]);
            if (!result.ok) {
                actionError.value = result.error ?? t('status_bar.headless_api_keys_revoke_failed');
                return;
            }
            await load();
        } finally {
            busy.value = false;
        }
    }
</script>
