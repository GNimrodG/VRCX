<template>
    <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>{{ t('dialog.temp_auto_accept.header') }}</DialogTitle>
                <DialogDescription>{{ t('dialog.temp_auto_accept.description') }}</DialogDescription>
            </DialogHeader>

            <FieldGroup class="gap-4">
                <SimpleSwitch
                    :label="t('dialog.temp_auto_accept.enable')"
                    :value="tempAutoAcceptEnabled"
                    @change="setTempAutoAcceptEnabled" />

                <Field>
                    <FieldLabel>{{ t('dialog.temp_auto_accept.friends') }}</FieldLabel>
                    <FieldContent>
                        <VirtualCombobox
                            :model-value="tempAutoAcceptUserIds"
                            :groups="friendGroups"
                            multiple
                            :placeholder="t('dialog.temp_auto_accept.friends_placeholder')"
                            :search-placeholder="t('dialog.temp_auto_accept.friends_placeholder')"
                            :clearable="true"
                            @update:modelValue="setTempAutoAcceptUserIds">
                            <template #item="{ item, selected }">
                                <div class="flex w-full items-center p-1.5 text-[13px]">
                                    <div
                                        v-if="item.user"
                                        class="relative inline-block flex-none size-9 mr-2.5"
                                        :class="userStatusClass(item.user)">
                                        <img
                                            class="size-full rounded-full object-cover"
                                            :src="userImage(item.user)"
                                            loading="lazy" />
                                    </div>
                                    <span class="flex-1 truncate font-medium">{{ item.label }}</span>
                                    <CheckIcon :class="['ml-auto size-4', selected ? 'opacity-100' : 'opacity-0']" />
                                </div>
                            </template>
                        </VirtualCombobox>
                    </FieldContent>
                </Field>

                <p class="text-xs text-muted-foreground">{{ t('dialog.temp_auto_accept.reset_hint') }}</p>
            </FieldGroup>
        </DialogContent>
    </Dialog>
</template>

<script setup>
    import { computed } from 'vue';
    import { Check as CheckIcon } from 'lucide-vue-next';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
    import { Field, FieldContent, FieldGroup, FieldLabel } from '@/components/ui/field';
    import {
        setTempAutoAcceptEnabled,
        setTempAutoAcceptUserIds,
        tempAutoAcceptEnabled,
        tempAutoAcceptUserIds
    } from '@/shared/utils/tempAutoAccept';
    import { VirtualCombobox } from '@/components/ui/virtual-combobox';
    import { useFriendStore } from '@/stores';
    import { useUserDisplay } from '@/composables/useUserDisplay';

    import SimpleSwitch from '../../views/Settings/components/SimpleSwitch.vue';

    defineProps({
        open: {
            type: Boolean,
            default: false
        }
    });
    const emit = defineEmits(['update:open']);

    const { t } = useI18n();
    const { userImage, userStatusClass } = useUserDisplay();
    const { friends } = storeToRefs(useFriendStore());

    // Every friend, A-Z: the person being picked may well be offline right now.
    const friendGroups = computed(() => {
        const items = [];
        for (const friend of friends.value.values()) {
            const name = friend?.ref?.displayName ?? friend?.name ?? String(friend.id);
            items.push({ value: String(friend.id), label: name, search: name, user: friend?.ref ?? null });
        }
        items.sort((a, b) => a.label.localeCompare(b.label));
        return items.length ? [{ key: 'friends', label: t('dialog.temp_auto_accept.friends'), items }] : [];
    });
</script>
