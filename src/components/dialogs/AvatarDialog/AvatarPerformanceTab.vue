<template>
    <div class="flex flex-col gap-2 text-xs">
        <div v-if="platforms.length === 0" class="rounded-xl bg-(--profile-card) p-3 text-muted-foreground">
            {{ t('dialog.avatar.performance.no_data') }}
        </div>
        <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-2">
                <ToggleGroup
                    type="single"
                    required
                    variant="outline"
                    size="sm"
                    :model-value="selectedPlatform"
                    @update:model-value="(value) => value && (selectedPlatform = value)">
                    <ToggleGroupItem v-for="platform in platforms" :key="platform" :value="platform">
                        {{ platformLabel(platform) }}
                    </ToggleGroupItem>
                </ToggleGroup>
                <div class="flex items-center gap-2">
                    <Switch id="avatar-performance-only-issues" v-model="onlyIssues" />
                    <label for="avatar-performance-only-issues" class="cursor-pointer select-none">
                        {{ t('dialog.avatar.performance.only_issues') }}
                    </label>
                </div>
            </div>

            <div class="rounded-xl bg-(--profile-card) p-3 flex flex-col gap-1.5">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                        {{ t('dialog.avatar.performance.vrchat_rating') }}
                        <span class="font-bold" :class="rankClass(vrchatRank)">{{ rankLabel(vrchatRank) }}</span>
                    </span>
                    <span>
                        {{ t('dialog.avatar.performance.computed_rating') }}
                        <span class="font-bold" :class="rankClass(analysis.rank)">{{ rankLabel(analysis.rank) }}</span>
                    </span>
                </div>
                <div v-if="limitingLabels.length">
                    {{ t('dialog.avatar.performance.limited_by') }}
                    <span class="font-semibold" :class="rankClass(analysis.rank)">{{ limitingLabels.join(', ') }}</span>
                </div>
                <div v-else-if="analysis.rank === 'Excellent'" class="text-muted-foreground">
                    {{ t('dialog.avatar.performance.all_excellent') }}
                </div>
                <div v-if="ratingMismatch" class="text-muted-foreground">
                    {{ t('dialog.avatar.performance.mismatch') }}
                </div>
            </div>

            <div class="rounded-xl bg-(--profile-card) p-1">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{{ t('dialog.avatar.performance.column_stat') }}</TableHead>
                            <TableHead class="text-right">{{ t('dialog.avatar.performance.column_value') }}</TableHead>
                            <TableHead>{{ t('dialog.avatar.performance.column_rank') }}</TableHead>
                            <TableHead class="text-right">{{
                                t('dialog.avatar.performance.column_next_limit')
                            }}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow
                            v-for="stat in visibleStats"
                            :key="stat.key"
                            :class="analysis.limitingKeys.includes(stat.key) ? 'bg-muted/50 font-semibold' : ''">
                            <TableCell>{{ t(`dialog.avatar.performance.stats.${stat.key}`) }}</TableCell>
                            <TableCell class="text-right font-mono">{{ formatValue(stat.kind, stat.value) }}</TableCell>
                            <TableCell :class="rankClass(stat.rank)">{{ rankLabel(stat.rank) }}</TableCell>
                            <TableCell class="text-right font-mono text-muted-foreground">
                                <template v-if="stat.nextLimit">
                                    {{ rankLabel(stat.nextLimit.rank) }}:
                                    {{ formatLimit(stat.kind, stat.nextLimit.limit) }}
                                </template>
                                <template v-else>-</template>
                            </TableCell>
                        </TableRow>
                        <TableRow v-if="visibleStats.length === 0">
                            <TableCell colspan="4" class="text-center text-muted-foreground">
                                {{
                                    onlyIssues && analysis.stats.length
                                        ? t('dialog.avatar.performance.all_excellent')
                                        : t('dialog.avatar.performance.no_data')
                                }}
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>

            <div v-if="infoStats.length" class="rounded-xl bg-(--profile-card) p-3 flex flex-wrap gap-x-4 gap-y-1">
                <span v-for="info in infoStats" :key="info.key">
                    {{ t(`dialog.avatar.performance.stats.${info.key}`) }}:
                    <span class="font-mono">{{ formatValue(info.kind, info.value) }}</span>
                </span>
            </div>

            <div class="text-[10px] text-muted-foreground px-1">
                {{ t(`dialog.avatar.performance.footnote_${limitSet}`) }}
            </div>
        </template>
    </div>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { useI18n } from 'vue-i18n';

    import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
    import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
    import { Switch } from '@/components/ui/switch';

    import {
        INFO_STATS,
        PERFORMANCE_RANKS,
        analyzeAvatarPerformance,
        formatPerformanceValue,
        getPerformanceLimitSet,
        normalizePerformanceRank
    } from '../../../shared/utils/avatarPerformance';

    const props = defineProps({
        /** AvatarDialog.fileAnalysis: { [platform]: FileAnalysis } */
        fileAnalysis: { type: Object, default: () => ({}) },
        /** AvatarDialog.platformInfo: { pc, android, ios } unityPackages */
        platformInfo: { type: Object, default: () => ({}) }
    });

    const { t } = useI18n();

    const PLATFORM_ORDER = ['standalonewindows', 'android', 'ios'];
    const PLATFORM_INFO_KEY = { standalonewindows: 'pc', android: 'android', ios: 'ios' };
    const RANK_CLASSES = {
        Excellent: 'text-emerald-500',
        Good: 'text-lime-500',
        Medium: 'text-amber-500',
        Poor: 'text-orange-500',
        VeryPoor: 'text-red-500'
    };

    const selectedPlatform = ref('');
    const onlyIssues = ref(false);

    const platforms = computed(() =>
        Object.keys(props.fileAnalysis || {})
            .filter((platform) => props.fileAnalysis[platform]?.avatarStats)
            .sort((a, b) => {
                const ia = PLATFORM_ORDER.indexOf(a);
                const ib = PLATFORM_ORDER.indexOf(b);
                return (ia === -1 ? PLATFORM_ORDER.length : ia) - (ib === -1 ? PLATFORM_ORDER.length : ib);
            })
    );

    watch(
        platforms,
        (list) => {
            if (!list.includes(selectedPlatform.value)) {
                selectedPlatform.value = list[0] || '';
            }
        },
        { immediate: true }
    );

    const limitSet = computed(() => getPerformanceLimitSet(selectedPlatform.value));
    const avatarStats = computed(() => props.fileAnalysis?.[selectedPlatform.value]?.avatarStats);
    const analysis = computed(() => analyzeAvatarPerformance(avatarStats.value, selectedPlatform.value));

    const vrchatRank = computed(() => {
        const fromPackage = props.platformInfo?.[PLATFORM_INFO_KEY[selectedPlatform.value]]?.performanceRating;
        const fromAnalysis = props.fileAnalysis?.[selectedPlatform.value]?.performanceRating;
        return normalizePerformanceRank(fromPackage || fromAnalysis) || null;
    });

    // VRChat can rate worse than the stats show (Mesh Read/Write disabled, face
    // tracking operations, forwarded parameters aren't in avatarStats).
    const ratingMismatch = computed(
        () =>
            vrchatRank.value &&
            analysis.value.rank &&
            PERFORMANCE_RANKS.indexOf(vrchatRank.value) > PERFORMANCE_RANKS.indexOf(analysis.value.rank)
    );

    const limitingLabels = computed(() =>
        analysis.value.limitingKeys.map((key) => t(`dialog.avatar.performance.stats.${key}`))
    );

    const visibleStats = computed(() =>
        onlyIssues.value
            ? analysis.value.stats.filter((stat) => stat.rank && stat.rank !== 'Excellent')
            : analysis.value.stats
    );

    const infoStats = computed(() => {
        const stats = avatarStats.value;
        if (!stats) {
            return [];
        }
        return INFO_STATS.filter((info) => info.field in stats).map((info) => ({
            key: info.key,
            kind: typeof stats[info.field] === 'boolean' ? 'boolean' : 'number',
            value: stats[info.field]
        }));
    });

    /**
     * @param {string} platform
     * @returns {string}
     */
    function platformLabel(platform) {
        if (platform === 'standalonewindows') return 'PC';
        if (platform === 'android') return 'Android';
        if (platform === 'ios') return 'iOS';
        return platform;
    }

    /**
     * @param {string | null} rank
     * @returns {string}
     */
    function rankLabel(rank) {
        return rank ? t(`dialog.avatar.tags.performanceRating.${rank}`) : t('dialog.avatar.performance.unrated');
    }

    /**
     * @param {string | null} rank
     * @returns {string}
     */
    function rankClass(rank) {
        return (rank && RANK_CLASSES[rank]) || 'text-muted-foreground';
    }

    /**
     * @param {string} kind
     * @param {unknown} value
     * @returns {string}
     */
    function formatValue(kind, value) {
        return formatPerformanceValue(kind, value, {
            yes: t('dialog.avatar.performance.yes'),
            no: t('dialog.avatar.performance.no')
        });
    }

    /**
     * @param {string} kind
     * @param {unknown} limit
     * @returns {string}
     */
    function formatLimit(kind, limit) {
        return formatPerformanceValue(kind, limit, {
            isLimit: true,
            yes: t('dialog.avatar.performance.allowed'),
            no: t('dialog.avatar.performance.not_allowed')
        });
    }
</script>
