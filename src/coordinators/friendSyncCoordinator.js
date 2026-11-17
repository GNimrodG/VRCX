import { toast } from 'vue-sonner';

import { AppDebug } from '../services/appConfig';
import { migrateMemos } from './memoCoordinator';
import { syncFriendSearchIndex } from './searchIndexCoordinator';
import { reconnectWebSocket } from '../services/websocket';
import { useAuthStore } from '../stores/auth';
import { useFriendStore } from '../stores/friend';
import { useUpdateLoopStore } from '../stores/updateLoop';
import { useUserStore } from '../stores/user';
import { getCurrentUser } from './userCoordinator';
import { watchState } from '../services/watchState';

import configRepository from '../services/config';
import { database } from '../services/database';

/**
 * Fork: friend refs are rebuilt on every client load with `$online_for = now`,
 * so a freshly opened client shows everyone as online since it opened. The
 * server's feed already holds the real transition time; seed it from there.
 *
 * @param {ReturnType<typeof useFriendStore>} friendStore
 */
async function seedFriendOnlineSince(friendStore) {
    try {
        const online = [...friendStore.friends.values()].filter((ctx) => ctx.ref?.state === 'online');
        if (!online.length) {
            return;
        }
        const latest = await database.getLatestOnlineOfflineForUsers(online.map((ctx) => ctx.id));
        for (const ctx of online) {
            const row = latest.get(ctx.id);
            const since = row?.type === 'Online' ? Date.parse(row.created_at) : NaN;
            // ctx.ref may have transitioned while the query ran; only touch a still-online friend
            if (!Number.isNaN(since) && ctx.ref?.state === 'online' && since < ctx.ref.$online_for) {
                ctx.ref.$online_for = since;
            }
        }
    } catch (err) {
        console.error('Failed to seed friend online-since from feed', err);
    }
}

/**
 * Runs friend list refresh orchestration.
 */
export async function runRefreshFriendsListFlow() {
    const updateLoopStore = useUpdateLoopStore();
    const friendStore = useFriendStore();

    // If we just got user less then 2 min before code call, don't call it again
    if (updateLoopStore.nextCurrentUserRefresh < 300) {
        await getCurrentUser();
    }
    await friendStore.refreshFriends();
    reconnectWebSocket();
}

/**
 * Runs full friend list initialization orchestration.
 *
 * @param t
 */
export async function runInitFriendsListFlow(t) {
    const userStore = useUserStore();
    const friendStore = useFriendStore();
    const authStore = useAuthStore();

    const userId = userStore.currentUser.id;
    friendStore.setIsRefreshFriendsLoading(true);
    watchState.isFriendsLoaded = false;
    friendStore.resetFriendLog();

    try {
        const currentUser = userStore.currentUser;
        if (await configRepository.getBool(`friendLogInit_${userId}`)) {
            await friendStore.getFriendLog(currentUser);
        } else {
            await friendStore.initFriendLog(currentUser);
        }
    } catch (err) {
        if (!AppDebug.dontLogMeOut) {
            toast.error(t('message.friend.load_failed'));
            authStore.handleLogoutEvent();
            throw err;
        }
    }

    // bulk sync friends to search index after initial load
    for (const ctx of friendStore.friends.values()) {
        syncFriendSearchIndex(ctx);
    }

    friendStore.tryApplyFriendOrder(); // once again
    friendStore.getAllUserStats(); // joinCount, lastSeen, timeSpent
    seedFriendOnlineSince(friendStore); // fork: real "online for" from the feed

    // remove old data from json file and migrate to SQLite (July 2021)
    if (await VRCXStorage.Get(`${userId}_friendLogUpdatedAt`)) {
        VRCXStorage.Remove(`${userId}_feedTable`);
        migrateMemos();
        friendStore.migrateFriendLog(userId);
    }
}
