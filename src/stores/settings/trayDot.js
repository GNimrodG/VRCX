import { ref } from 'vue';
import { defineStore } from 'pinia';

import { normalizeTrayDotRules } from '../../shared/utils/trayDot';

import configRepository from '../../services/config';

/**
 * Fork-owned (CLAUDE.md §5): which unseen notification / friend-log types light
 * the tray icon (and the browser favicon) in which color. Stored through
 * `configRepository`, which lives on the server, so every client on the same
 * server/account shares it. Shape and semantics: `shared/utils/trayDot.js`.
 */
export const useTrayDotSettingsStore = defineStore('TrayDotSettings', () => {
    const rules = ref(normalizeTrayDotRules(null));
    const loaded = ref(false);

    async function initTrayDotSettings() {
        rules.value = normalizeTrayDotRules(await configRepository.getString('VRCX_trayDotRules', null));
        loaded.value = true;
    }

    /** @param {unknown} next */
    async function setTrayDotRules(next) {
        rules.value = normalizeTrayDotRules(next);
        await configRepository.setString('VRCX_trayDotRules', JSON.stringify(rules.value));
    }

    initTrayDotSettings();

    return { rules, loaded, initTrayDotSettings, setTrayDotRules };
});
