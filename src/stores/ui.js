import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { toast } from 'vue-sonner';
import { useMagicKeys } from '@vueuse/core';
import { useRouter } from 'vue-router';

import { AppDebug } from '../services/appConfig';
import { refreshCustomCss } from '../shared/utils/base/ui';
import { updateLocalizedStrings } from '../plugins/i18n';
import { TRAY_DOT_SWATCHES } from '../shared/constants/trayDot';
import { createTrayDotController, resolveTrayDotColor } from '../shared/utils/trayDot';
import { useAppearanceSettingsStore } from './settings/appearance';
import { useAvatarStore } from './avatar';
import { useGroupStore } from './group';
import {
    clearGroupMemberModerationDialog,
    showGroupDialog,
    showGroupMemberModerationDialog,
    showGroupRolesDialog
} from '../coordinators/groupCoordinator';
import { showWorldDialog } from '../coordinators/worldCoordinator';
import { showAvatarDialog } from '../coordinators/avatarCoordinator';
import { showUserDialog } from '../coordinators/userCoordinator';
import { useInstanceStore } from './instance';
import { useNotificationStore } from './notification';
import { useSearchStore } from './search';
import { useTrayDotSettingsStore } from './settings/trayDot';
import { useUserStore } from './user';
import { useWorldStore } from './world';

export const useUiStore = defineStore('Ui', () => {
    const notificationStore = useNotificationStore();
    const instanceStore = useInstanceStore();
    const router = useRouter();
    const keys = useMagicKeys();
    const { directAccessPaste } = useSearchStore();
    const appearanceSettings = useAppearanceSettingsStore();
    const trayDotSettings = useTrayDotSettingsStore();
    const trayDot = createTrayDotController({
        getRules: () => trayDotSettings.rules,
        isEnabled: () => appearanceSettings.notificationIconDot,
        apply: (color) => {
            trayIconNotify.value = color;
            if (LINUX) {
                window.electron.setTrayIconNotification(color);
                return;
            }
            AppApi.SetTrayIconNotification(color);
        }
    });

    const ctrlR = keys['Ctrl+R'];
    const ctrlD = keys['Ctrl+D'];
    const metaD = keys['Meta+D'];
    const shift = keys['Shift'];
    const ctrlShiftI = keys['Ctrl+Shift+I'];
    const altShiftR = keys['Alt+Shift+R'];

    const notifiedMenus = ref([]);
    /** Bumped whenever the (non-reactive) pending tray types change. */
    const pendingVersion = ref(0);
    const shiftHeld = ref(false);
    /** Current tray/favicon dot color, or null for no dot. */
    const trayIconNotify = ref(null);
    const dialogCrumbs = ref([]);

    watch(ctrlR, (isPressed) => {
        if (isPressed) {
            location.reload();
        }
    });

    watch(ctrlD, (isPressed) => {
        if (isPressed) {
            directAccessPaste();
        }
    });

    watch(metaD, (isPressed) => {
        if (isPressed) {
            directAccessPaste();
        }
    });

    watch(shift, (isHeld) => {
        shiftHeld.value = isHeld;
    });

    watch(ctrlShiftI, (isPressed) => {
        if (isPressed) {
            showConsole();
        }
    });

    watch(altShiftR, (isPressed) => {
        if (isPressed) {
            refreshCustomCss();
            updateLocalizedStrings();
            toast.success('Custom CSS and localization strings refreshed');
        }
    });

    function pushDialogCrumb(data) {
        const { type, id, label } = data;
        if (!type || !id) {
            return;
        }
        const items = dialogCrumbs.value;
        const last = items[items.length - 1];
        if (last && last.type === type && last.id === id) {
            if (label && last.label !== label) {
                last.label = label;
            }
            return;
        }
        const existingIndex = items.findIndex((item) => item.type === type && item.id === id);
        if (existingIndex !== -1) {
            items.splice(existingIndex + 1);
            if (label) {
                items[existingIndex].label = label;
            }
            return;
        }
        if (!data.label) {
            data.label = data.id;
        }
        items.push(data);
    }

    function setDialogCrumbLabel(type, id, label) {
        if (!type || !id || !label) {
            return;
        }
        const item = dialogCrumbs.value.find((entry) => entry.type === type && entry.id === id);
        if (item) {
            item.label = label;
        }
    }

    function jumpDialogCrumb(index) {
        if (index < 0 || index >= dialogCrumbs.value.length) {
            return;
        }
        dialogCrumbs.value.splice(index + 1);
    }

    function jumpBackDialogCrumb() {
        if (dialogCrumbs.value.length > 0) {
            dialogCrumbs.value.pop();
        }
        if (dialogCrumbs.value.length === 0) {
            closeMainDialog();
            return;
        }
        handleBreadcrumbClick(dialogCrumbs.value.length - 1);
    }

    function handleBreadcrumbClick(index) {
        const item = dialogCrumbs.value[index];
        if (!item) {
            return;
        }
        jumpDialogCrumb(index);
        if (item.type === 'user') {
            showUserDialog(item.id);
            return;
        }
        if (item.type === 'world') {
            showWorldDialog(item.tag, item.shortName);
            return;
        }
        if (item.type === 'avatar') {
            showAvatarDialog(item.id);
            return;
        }
        if (item.type === 'group') {
            showGroupDialog(item.id);
            return;
        }
        if (item.type === 'previous-instances-user') {
            instanceStore.showPreviousInstancesListDialog('user', item.id);
            return;
        }
        if (item.type === 'previous-instances-world') {
            instanceStore.showPreviousInstancesListDialog('world', item.id);
            return;
        }
        if (item.type === 'previous-instances-group') {
            instanceStore.showPreviousInstancesListDialog('group', item.id);
            return;
        }
        if (item.type === 'previous-instances-info') {
            instanceStore.showPreviousInstancesInfoDialog(item.id);
            return;
        }
        if (item.type === 'group-member-moderation') {
            showGroupMemberModerationDialog(item.id);
            return;
        }
        if (item.type === 'group-roles') {
            showGroupRolesDialog(item.id);
            return;
        }
        console.error(`Unknown dialog crumb type: ${item.type}, closing dialog`);
        closeMainDialog();
    }

    function clearDialogCrumbs() {
        dialogCrumbs.value = [];
    }

    function closeMainDialog() {
        const userStore = useUserStore();
        const worldStore = useWorldStore();
        const avatarStore = useAvatarStore();
        const groupStore = useGroupStore();
        const instanceStore = useInstanceStore();

        userStore.setUserDialogVisible(false);
        worldStore.setWorldDialogVisible(false);
        avatarStore.setAvatarDialogVisible(false);
        groupStore.setGroupDialogVisible(false);
        groupStore.setGroupMemberModerationVisible(false);
        clearGroupMemberModerationDialog();
        groupStore.setGroupRolesDialogVisible(false);
        instanceStore.hidePreviousInstancesDialogs();
        clearDialogCrumbs();
    }

    /**
     * @param {object} data
     * @param {string} data.type
     * @param {string} data.id
     * @param {string} [data.tag]
     * @param {string} [data.shortName]
     * @param {string} [data.label]
     * @returns {boolean}
     */
    function openDialog(data) {
        const { type } = data;
        const userStore = useUserStore();
        const worldStore = useWorldStore();
        const avatarStore = useAvatarStore();
        const groupStore = useGroupStore();
        const instanceStore = useInstanceStore();
        const isPrevInfo = type === 'previous-instances-info';
        const isPrevList = type && type.startsWith('previous-instances-') && type !== 'previous-instances-info';
        const hadActiveDialog =
            dialogCrumbs.value.length > 0 ||
            userStore.userDialog.visible ||
            worldStore.worldDialog.visible ||
            avatarStore.avatarDialog.visible ||
            groupStore.groupDialog.visible ||
            groupStore.groupMemberModeration.visible ||
            groupStore.groupRolesDialog.visible ||
            (instanceStore.previousInstancesInfoDialog.visible && !isPrevInfo) ||
            (instanceStore.previousInstancesListDialog.visible && !isPrevList);

        if (type !== 'user') {
            userStore.setUserDialogVisible(false);
        }
        if (type !== 'world') {
            worldStore.setWorldDialogVisible(false);
        }
        if (type !== 'avatar') {
            avatarStore.setAvatarDialogVisible(false);
        }
        if (type !== 'group') {
            groupStore.setGroupDialogVisible(false);
        }
        if (type !== 'group-member-moderation') {
            groupStore.setGroupMemberModerationVisible(false);
        }
        if (type !== 'group-roles') {
            groupStore.setGroupRolesDialogVisible(false);
        }
        if (!isPrevInfo) {
            instanceStore.setPreviousInstancesInfoDialogVisible(false);
        }
        if (!isPrevList) {
            instanceStore.setPreviousInstancesListDialogVisible(false);
        }
        if (!hadActiveDialog) {
            clearDialogCrumbs();
        }
        pushDialogCrumb(data);
        return hadActiveDialog;
    }

    // Make sure file drops outside of the screenshot manager don't navigate to the file path dropped.
    // This issue persists on prompts created with prompt(), unfortunately. Not sure how to fix that.
    document.body.addEventListener('drop', function (e) {
        e.preventDefault();
    });

    function showConsole() {
        AppApi.ShowDevTools();
        if (AppDebug.debug || AppDebug.debugWebRequests || AppDebug.debugWebSocket || AppDebug.debugUserDiff) {
            return;
        }
        console.log(
            '%cCareful! This might not do what you think.',
            'background-color: red; color: yellow; font-size: 32px; font-weight: bold'
        );
        console.log(
            '%cIf someone told you to copy-paste something here, it can give them access to your account.',
            'font-size: 20px;'
        );
    }

    watch(
        () => router.currentRoute.value.name,
        (routeName) => {
            if (routeName) {
                const name = String(routeName);
                removeNotify(name);
                if (name === 'notification') {
                    notificationStore.clearUnseenNotifications();
                }
            }
        }
    );

    /**
     * @param {string} index Menu name ('notification' | 'friend-log')
     * @param {string} [type] Notification / friend-log type, for tray dot color rules
     */
    function notifyMenu(index, type) {
        const currentRouteName = router.currentRoute.value?.name;
        if (index !== currentRouteName) {
            if (!notifiedMenus.value.includes(index)) {
                notifiedMenus.value.push(index);
            }
            trayDot.notify(index, type);
            pendingVersion.value++;
        }
    }

    function removeNotify(index) {
        notifiedMenus.value = notifiedMenus.value.filter((i) => i !== index);
        trayDot.clear(index);
        pendingVersion.value++;
    }

    function clearAllNotifications() {
        notifiedMenus.value = [];
        trayDot.clearAll();
        pendingVersion.value++;
    }

    /**
     * Color of the in-app red-dot replacement for the given menus, by the user's
     * tray dot rules. `null` = show no dot. Reactive: reads the pending version
     * and the rules, so call it from templates/computeds.
     *
     * @param {Iterable<string>} menus
     * @returns {string | null} CSS color
     */
    function getMenuDotColor(menus) {
        pendingVersion.value;
        return toSwatch(trayDot.colorForMenus(menus));
    }

    /**
     * Same, for a set of notification / friend-log types (e.g. the bell's unseen
     * notifications) rather than menus.
     *
     * @param {Iterable<string | undefined>} types
     * @returns {string | null} CSS color
     */
    function getTypesDotColor(types) {
        return toSwatch(resolveTrayDotColor(trayDotSettings.rules, types));
    }

    const toSwatch = (color) => (color ? (TRAY_DOT_SWATCHES[color] ?? TRAY_DOT_SWATCHES.red) : null);

    function updateTrayIconNotify(force = false) {
        trayDot.update(force);
    }
    // Rules load asynchronously and can change from the settings page.
    watch(
        () => trayDotSettings.rules,
        () => updateTrayIconNotify(),
        { deep: true }
    );
    updateTrayIconNotify(true);

    return {
        notifiedMenus,
        shiftHeld,
        dialogCrumbs,

        notifyMenu,
        getMenuDotColor,
        getTypesDotColor,
        removeNotify,
        clearAllNotifications,
        showConsole,
        updateTrayIconNotify,
        pushDialogCrumb,
        setDialogCrumbLabel,
        jumpDialogCrumb,
        clearDialogCrumbs,
        closeMainDialog,
        openDialog,
        jumpBackDialogCrumb,
        handleBreadcrumbClick
    };
});
