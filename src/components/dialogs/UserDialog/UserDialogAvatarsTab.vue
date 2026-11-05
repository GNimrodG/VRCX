<template>
    <div class="flex h-full min-h-0 flex-col overflow-hidden p-2 rounded-xl bg-(--profile-card)">
        <div style="display: flex; align-items: center; justify-content: space-between">
            <div style="display: flex; align-items: center">
                <Button
                    v-if="userDialog.ref.id === currentUser.id"
                    class="rounded-full"
                    variant="ghost"
                    size="icon-sm"
                    :disabled="userDialog.isAvatarsLoading"
                    @click="refreshUserDialogAvatars()">
                    <Spinner v-if="userDialog.isAvatarsLoading" />
                    <RefreshCw v-else />
                </Button>
                <Button
                    v-else
                    class="rounded-full"
                    variant="ghost"
                    size="icon-sm"
                    :disabled="userDialog.isAvatarsLoading"
                    @click="setUserDialogAvatarsRemote(userDialog.id)">
                    <Spinner v-if="userDialog.isAvatarsLoading" />
                    <RefreshCw v-else />
                </Button>
                <span class="ml-1.5 text-sm">{{
                    t('dialog.user.avatars.total_count', { count: liveAvatarCount })
                }}</span>
            </div>
            <div class="flex items-center">
                <Input
                    v-model="avatarSearchQuery"
                    class="h-8 w-40 mr-2"
                    :placeholder="t('dialog.user.avatars.search_placeholder')"
                    @click.stop />
                <template v-if="userDialog.ref.id === currentUser.id">
                    <span class="mr-1">{{ t('dialog.user.avatars.sort_by') }}</span>
                    <Select
                        :model-value="userDialog.avatarSorting"
                        :disabled="userDialog.isWorldsLoading"
                        @update:modelValue="changeUserDialogAvatarSorting">
                        <SelectTrigger size="sm" @click.stop>
                            <SelectValue :placeholder="t(`dialog.user.avatars.sort_by_${userDialog.avatarSorting}`)" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="name">{{ t('dialog.user.avatars.sort_by_name') }}</SelectItem>
                            <SelectItem value="update">{{ t('dialog.user.avatars.sort_by_update') }}</SelectItem>
                            <SelectItem value="createdAt">{{ t('dialog.user.avatars.sort_by_uploaded') }}</SelectItem>
                        </SelectContent>
                    </Select>
                    <span class="ml-2 mr-1">{{ t('dialog.user.avatars.group_by') }}</span>
                    <Select
                        :model-value="userDialog.avatarReleaseStatus"
                        :disabled="userDialog.isWorldsLoading"
                        @update:modelValue="(value) => (userDialog.avatarReleaseStatus = value)">
                        <SelectTrigger size="sm" @click.stop>
                            <SelectValue :placeholder="t(`dialog.user.avatars.${userDialog.avatarReleaseStatus}`)" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{{ t('dialog.user.avatars.all') }}</SelectItem>
                            <SelectItem value="public">{{ t('dialog.user.avatars.public') }}</SelectItem>
                            <SelectItem value="private">{{ t('dialog.user.avatars.private') }}</SelectItem>
                            <SelectItem value="licensed">{{ t('dialog.user.avatars.purchased') }}</SelectItem>
                        </SelectContent>
                    </Select>
                </template>
            </div>
        </div>
        <div class="flex flex-wrap items-start" style="margin-top: 8px; min-height: 60px; overflow: auto">
            <template v-if="filteredUserDialogAvatars.length">
                <div
                    v-for="avatar in filteredUserDialogAvatars"
                    :key="avatar.id || avatar.$seenFileId"
                    class="box-border flex items-center p-1.5 text-[13px] w-[167px]"
                    :class="
                        avatar.$gone ? 'opacity-40 cursor-default' : 'cursor-pointer hover:rounded-[25px_5px_5px_25px]'
                    "
                    :title="
                        avatar.$gone ? 'No longer in your avatar list (deleted, or replaced by a newer upload)' : ''
                    "
                    @click="openAvatar(avatar)">
                    <div class="relative inline-block flex-none size-9 mr-2.5">
                        <Avatar class="size-9">
                            <AvatarImage
                                v-if="avatar.thumbnailImageUrl"
                                :src="avatar.thumbnailImageUrl"
                                class="object-cover" />
                            <AvatarFallback>
                                <Image class="size-4 text-muted-foreground" />
                            </AvatarFallback>
                        </Avatar>
                    </div>
                    <div class="flex-1 overflow-hidden">
                        <span class="block truncate font-medium leading-[18px]" v-text="avatar.name"></span>
                        <span
                            v-if="avatar.releaseStatus === 'public'"
                            class="block truncate text-xs"
                            v-text="avatar.releaseStatus">
                        </span>
                        <span
                            v-else-if="avatar.releaseStatus === 'private'"
                            class="block truncate text-xs"
                            v-text="avatar.releaseStatus">
                        </span>
                        <span v-else class="block truncate text-xs" v-text="avatar.releaseStatus"></span>
                    </div>
                </div>
            </template>
            <div
                v-else-if="!userDialog.isAvatarsLoading"
                style="display: flex; justify-content: center; align-items: center; min-height: 120px; width: 100%">
                <DataTableEmpty type="nodata" />
            </div>
        </div>
    </div>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { useI18n } from 'vue-i18n';
    import { storeToRefs } from 'pinia';

    import { Image, RefreshCw } from 'lucide-vue-next';
    import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
    import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
    import { Button } from '@/components/ui/button';
    import { DataTableEmpty } from '@/components/ui/data-table';
    import { Input } from '@/components/ui/input';
    import { Spinner } from '@/components/ui/spinner';

    import { refreshUserDialogAvatars } from '@/coordinators/userCoordinator';

    import { useAdvancedSettingsStore, useAvatarStore, useUserStore } from '../../../stores';

    const { t } = useI18n();

    const userStore = useUserStore();
    const { userDialog, currentUser } = storeToRefs(userStore);
    const { sortUserDialogAvatars, sortUserDialogLicensedAvatars } = userStore;

    import { showAvatarDialog, showAvatarAuthorDialog, lookupAvatars } from '../../../coordinators/avatarCoordinator';
    import { database } from '../../../services/database';
    import { extractFileId } from '../../../shared/utils';
    const { cachedAvatars } = useAvatarStore();

    const { avatarRemoteDatabase } = storeToRefs(useAdvancedSettingsStore());

    const userDialogAvatars = computed(() => {
        const { avatars, licensedAvatars, avatarReleaseStatus } = userDialog.value;
        const isCurrentUser = userDialog.value.ref.id === currentUser.value.id;
        const releaseStatus = isCurrentUser ? avatarReleaseStatus : 'all';
        if (releaseStatus === 'licensed') {
            return licensedAvatars;
        }
        if (releaseStatus === 'public' || releaseStatus === 'private') {
            return avatars.filter((avatar) => avatar.releaseStatus === avatarReleaseStatus);
        }
        return avatars;
    });
    // Avatars this author was seen being worn in the feed, from the server's
    // `seen_avatars` index. The feed has no avatar ids, so these are keyed by image
    // file id and only resolved to an avatar (cache, then the external database)
    // when clicked. For your own avatars the API list is authoritative, so entries
    // missing from it are shown faded (`$gone`) once it has loaded; no extra
    // requests are made to decide that. Fork addition, see docs/patch-inventory.md.
    const seenAvatars = ref([]);
    const allUserDialogAvatars = computed(() => {
        if (!seenAvatars.value.length) {
            return userDialogAvatars.value;
        }
        const isOwn = userDialog.value.ref.id === currentUser.value.id;
        if (isOwn && (userDialog.value.isAvatarsLoading || userDialog.value.avatarReleaseStatus !== 'all')) {
            return userDialogAvatars.value;
        }
        const knownFiles = new Set(userDialogAvatars.value.map((avatar) => extractFileId(avatar.imageUrl)));
        // A re-upload gets a new image file, so also match by name to avoid listing
        // old versions of avatars you still have as deleted.
        const knownNames = new Set(userDialogAvatars.value.map((avatar) => (avatar.name || '').toLowerCase()));
        return [
            ...userDialogAvatars.value,
            ...seenAvatars.value.filter(
                (avatar) =>
                    !knownFiles.has(avatar.$seenFileId) && !(isOwn && knownNames.has((avatar.name || '').toLowerCase()))
            )
        ];
    });
    const liveAvatarCount = computed(() => allUserDialogAvatars.value.filter((avatar) => !avatar.$gone).length);
    const avatarSearchQuery = ref('');
    const filteredUserDialogAvatars = computed(() => {
        const avatars = allUserDialogAvatars.value;
        const query = avatarSearchQuery.value.trim().toLowerCase();
        if (!query) {
            return avatars;
        }
        return avatars.filter((avatar) => (avatar.name || '').toLowerCase().includes(query));
    });

    watch(
        () => userDialog.value.id,
        () => {
            avatarSearchQuery.value = '';
            seenAvatars.value = [];
        }
    );

    /**
     * @param userId
     */
    async function loadSeenAvatars(userId) {
        const isOwn = userId === currentUser.value.id;
        try {
            const rows = await database.getSeenAvatarsByOwner(userId);
            if (userDialog.value.id !== userId) {
                return;
            }
            seenAvatars.value = rows.map((row) => ({
                id: '',
                $seenFileId: row.fileId,
                $gone: isOwn,
                authorId: row.ownerId,
                name: row.name,
                imageUrl: row.imageUrl,
                thumbnailImageUrl: row.thumbnailImageUrl,
                releaseStatus: ''
            }));
        } catch (err) {
            // e.g. a server older than this feature: the tab just shows what it had.
            console.warn('Failed to load seen avatars', err);
        }
    }

    /**
     * @param avatar
     */
    function openAvatar(avatar) {
        if (avatar.$gone) {
            return;
        }
        if (avatar.id) {
            showAvatarDialog(avatar.id);
        } else {
            showAvatarAuthorDialog(avatar.authorId, avatar.authorId, avatar.imageUrl);
        }
    }

    /**
     * @param userId
     */
    function setUserDialogAvatars(userId) {
        loadSeenAvatars(userId);
        const avatars = new Set();
        userDialogAvatars.value.forEach((avatar) => {
            avatars.add(avatar.id);
        });
        for (const ref of cachedAvatars.values()) {
            if (ref.authorId === userId && !avatars.has(ref.id)) {
                userDialog.value.avatars.push(ref);
            }
        }
        sortUserDialogAvatars(userDialog.value.avatars);
    }

    /**
     * @param userId
     */
    async function setUserDialogAvatarsRemote(userId) {
        if (avatarRemoteDatabase.value && userId !== currentUser.value.id) {
            userDialog.value.isAvatarsLoading = true;
            const data = await lookupAvatars('authorId', userId);
            const avatars = new Set();
            userDialogAvatars.value.forEach((avatar) => {
                avatars.add(avatar.id);
            });
            if (data && typeof data === 'object') {
                data.forEach((avatar) => {
                    if (avatar.id && !avatars.has(avatar.id)) {
                        if (avatar.authorId === userId) {
                            userDialog.value.avatars.push(avatar);
                        } else {
                            console.error(`Avatar authorId mismatch for ${avatar.id} - ${avatar.name}`);
                        }
                    }
                });
            }
            userDialog.value.isAvatarsLoading = false;
        }
        sortUserDialogAvatars(userDialog.value.avatars);
    }

    /**
     * @param sortOption
     */
    function changeUserDialogAvatarSorting(sortOption) {
        const D = userDialog.value;
        D.avatarSorting = sortOption;
        sortUserDialogAvatars(D.avatars);
        sortUserDialogLicensedAvatars(D.licensedAvatars);
    }

    defineExpose({ setUserDialogAvatars, setUserDialogAvatarsRemote });
</script>
