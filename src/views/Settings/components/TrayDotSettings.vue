<template>
    <SettingsGroup :title="t('view.settings.appearance.appearance.tray_dot.header')">
        <template #description>
            {{ t('view.settings.appearance.appearance.tray_dot.description') }}
            <span v-if="!notificationIconDot" class="mt-1 block text-amber-600 dark:text-amber-400">
                {{ t('view.settings.appearance.appearance.tray_dot.disabled_hint') }}
            </span>
        </template>

        <SettingsItem
            :label="t('view.settings.appearance.appearance.tray_dot.fallback')"
            :description="t('view.settings.appearance.appearance.tray_dot.fallback_description')">
            <ColorSelect
                :model-value="rules.fallback"
                :colors="allColors"
                size="sm"
                @update:model-value="update(setFallback(rules, $event))" />
        </SettingsItem>

        <div class="mt-2 flex items-center justify-between gap-2 px-0.5 pt-2">
            <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {{ t('view.settings.appearance.appearance.tray_dot.priority') }}
            </span>
            <div class="flex items-center gap-1">
                <DropdownMenu v-if="addableColors.length">
                    <DropdownMenuTrigger as-child>
                        <Button variant="outline" size="sm">
                            <Plus class="size-4" />
                            {{ t('view.settings.appearance.appearance.tray_dot.add_color') }}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            v-for="color in addableColors"
                            :key="color"
                            @select="update(addColorEntry(rules, color))">
                            <Swatch :color="color" />
                            {{ colorLabel(color) }}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="sm" @click="update(normalizeTrayDotRules(null))">
                    <RotateCcw class="size-4" />
                    {{ t('view.settings.appearance.appearance.tray_dot.reset') }}
                </Button>
            </div>
        </div>

        <ol class="mt-2 flex flex-col gap-2">
            <li
                v-for="(entry, index) in rules.colors"
                :key="entry.color"
                class="flex flex-col gap-2 rounded-md border bg-card p-3"
                :data-testid="`tray-dot-entry-${entry.color}`">
                <div class="flex items-center gap-2">
                    <span class="w-5 text-center text-xs tabular-nums text-muted-foreground">{{ index + 1 }}</span>
                    <ColorSelect
                        :model-value="entry.color"
                        :colors="[entry.color, ...addableColors]"
                        size="sm"
                        @update:model-value="update(setEntryColor(rules, index, $event))" />
                    <div class="ml-auto flex items-center gap-0.5">
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            :disabled="index === 0"
                            :aria-label="t('view.settings.appearance.appearance.tray_dot.move_up')"
                            @click="update(moveColorEntry(rules, index, -1))">
                            <ArrowUp class="size-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            :disabled="index === rules.colors.length - 1"
                            :aria-label="t('view.settings.appearance.appearance.tray_dot.move_down')"
                            @click="update(moveColorEntry(rules, index, 1))">
                            <ArrowDown class="size-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            :aria-label="t('view.settings.appearance.appearance.tray_dot.remove_color')"
                            @click="update(removeColorEntry(rules, index))">
                            <Trash2 class="size-4" />
                        </Button>
                    </div>
                </div>

                <div class="flex flex-wrap items-center gap-1.5 pl-7">
                    <Badge v-for="type in entry.types" :key="type" variant="secondary" class="gap-1 pr-1">
                        {{ typeLabel(type) }}
                        <button
                            type="button"
                            class="rounded-sm p-0.5 hover:bg-background/60"
                            :aria-label="`${t('view.settings.appearance.appearance.tray_dot.remove_type')}: ${typeLabel(type)}`"
                            :title="t('view.settings.appearance.appearance.tray_dot.remove_type')"
                            @click="update(unassignType(rules, type))">
                            <X class="size-3" />
                        </button>
                    </Badge>
                    <span v-if="!entry.types.length" class="text-xs text-muted-foreground">
                        {{ t('view.settings.appearance.appearance.tray_dot.no_types') }}
                    </span>

                    <DropdownMenu>
                        <DropdownMenuTrigger as-child>
                            <Button variant="outline" size="sm" class="h-6 px-2 text-xs">
                                <Plus class="size-3" />
                                {{ t('view.settings.appearance.appearance.tray_dot.add_type') }}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" class="max-h-80 overflow-y-auto">
                            <template v-for="(group, gi) in typeGroups" :key="group.id">
                                <DropdownMenuSeparator v-if="gi > 0" />
                                <DropdownMenuLabel
                                    class="sticky top-0 z-10 bg-muted px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    {{ group.label }}
                                </DropdownMenuLabel>
                                <DropdownMenuItem
                                    v-for="type in group.types"
                                    :key="type"
                                    class="pl-5"
                                    :disabled="entryIndexOfType(rules, type) === index"
                                    @select="update(assignType(rules, index, type))">
                                    <span class="flex-1">{{ typeLabel(type) }}</span>
                                    <Swatch
                                        v-if="entryIndexOfType(rules, type) !== -1"
                                        :color="rules.colors[entryIndexOfType(rules, type)].color"
                                        :title="t('view.settings.appearance.appearance.tray_dot.assigned_elsewhere')" />
                                </DropdownMenuItem>
                            </template>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </li>
        </ol>
    </SettingsGroup>
</template>

<script setup>
    import { computed, defineComponent, h } from 'vue';
    import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2, X } from 'lucide-vue-next';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import { Badge } from '@/components/ui/badge';
    import { Button } from '@/components/ui/button';
    import {
        DropdownMenu,
        DropdownMenuContent,
        DropdownMenuItem,
        DropdownMenuLabel,
        DropdownMenuSeparator,
        DropdownMenuTrigger
    } from '@/components/ui/dropdown-menu';
    import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
    import {
        TRAY_DOT_COLORS,
        TRAY_DOT_GROUPS,
        TRAY_DOT_OFF,
        TRAY_DOT_SWATCHES,
        TRAY_DOT_TYPES
    } from '@/shared/constants/trayDot';
    import {
        addColorEntry,
        assignType,
        entryIndexOfType,
        moveColorEntry,
        removeColorEntry,
        setEntryColor,
        setFallback,
        unassignType,
        unusedColors
    } from '@/shared/utils/trayDotEdit';
    import { normalizeTrayDotRules } from '@/shared/utils/trayDot';
    import { useAppearanceSettingsStore } from '@/stores/settings/appearance';
    import { useTrayDotSettingsStore } from '@/stores/settings/trayDot';

    import SettingsGroup from './SettingsGroup.vue';
    import SettingsItem from './SettingsItem.vue';

    const { t } = useI18n();

    const { notificationIconDot } = storeToRefs(useAppearanceSettingsStore());
    const trayDotStore = useTrayDotSettingsStore();
    const { rules } = storeToRefs(trayDotStore);

    const allColors = [...TRAY_DOT_COLORS, TRAY_DOT_OFF];
    const addableColors = computed(() => unusedColors(rules.value));

    const typeGroups = TRAY_DOT_GROUPS.map((id) => ({
        id,
        label: t(`view.settings.appearance.appearance.tray_dot.groups.${id}`),
        types: Object.keys(TRAY_DOT_TYPES).filter((type) => TRAY_DOT_TYPES[type].group === id)
    })).filter((g) => g.types.length);

    function colorLabel(color) {
        return color === TRAY_DOT_OFF
            ? t('view.settings.appearance.appearance.tray_dot.off')
            : t(`view.settings.appearance.appearance.tray_dot.colors.${color}`);
    }

    function typeLabel(type) {
        return t(TRAY_DOT_TYPES[type].labelKey);
    }

    function update(next) {
        trayDotStore.setTrayDotRules(next);
    }

    const Swatch = defineComponent({
        props: { color: { type: String, required: true } },
        setup(props) {
            return () =>
                h('span', {
                    class: 'inline-block size-3 shrink-0 rounded-full border border-foreground/30',
                    style:
                        props.color === TRAY_DOT_OFF
                            ? 'background: repeating-linear-gradient(45deg, transparent 0 2px, currentColor 2px 3px)'
                            : `background: ${TRAY_DOT_SWATCHES[props.color]}`
                });
        }
    });

    const ColorSelect = defineComponent({
        props: {
            modelValue: { type: String, required: true },
            colors: { type: Array, required: true },
            size: { type: String, default: 'default' }
        },
        emits: ['update:modelValue'],
        setup(props, { emit }) {
            return () =>
                h(
                    Select,
                    { modelValue: props.modelValue, 'onUpdate:modelValue': (v) => emit('update:modelValue', v) },
                    () => [
                        h(SelectTrigger, { size: props.size, class: 'min-w-36' }, () =>
                            h('span', { class: 'flex items-center gap-2' }, [
                                h(Swatch, { color: props.modelValue }),
                                colorLabel(props.modelValue)
                            ])
                        ),
                        h(SelectContent, null, () =>
                            props.colors.map((color) =>
                                h(SelectItem, { key: color, value: color }, () =>
                                    h('span', { class: 'flex items-center gap-2' }, [
                                        h(Swatch, { color }),
                                        colorLabel(color)
                                    ])
                                )
                            )
                        )
                    ]
                );
        }
    });
</script>
