import { describe, expect, test } from 'vitest';

import {
    PERFORMANCE_STATS,
    analyzeAvatarPerformance,
    formatPerformanceValue,
    getPerformanceLimitSet,
    normalizePerformanceRank
} from '../avatarPerformance';

const MB = 1024 * 1024;

/** An avatar whose every PC-ranked stat is within Excellent. */
function excellentStats() {
    return {
        totalPolygons: 20000,
        bounds: [1, 2, 1],
        totalTextureUsage: 20 * MB,
        skinnedMeshCount: 1,
        meshCount: 0,
        materialSlotsUsed: 2,
        physBoneComponentCount: 2,
        physBoneTransformCount: 10,
        physBoneColliderCount: 0,
        physBoneCollisionCheckCount: 0,
        contactCount: 0,
        constraintCount: 0,
        constraintDepth: 0,
        animatorCount: 1,
        boneCount: 60,
        lightCount: 0,
        particleSystemCount: 0,
        totalMaxParticles: 0,
        meshParticleMaxPolygons: 0,
        particleTrailsEnabled: false,
        particleCollisionEnabled: false,
        trailRendererCount: 0,
        lineRendererCount: 0,
        raycastCount: 0,
        clothCount: 0,
        totalClothVertices: 0,
        physicsColliders: 0,
        physicsRigidbodies: 0,
        audioSourceCount: 0,
        totalVertices: 15000,
        materialCount: 2
    };
}

describe('getPerformanceLimitSet', () => {
    test('maps platforms to limit sets', () => {
        expect(getPerformanceLimitSet('standalonewindows')).toBe('pc');
        expect(getPerformanceLimitSet('android')).toBe('mobile');
        expect(getPerformanceLimitSet('ios')).toBe('mobile');
        expect(getPerformanceLimitSet('')).toBe('pc');
    });
});

describe('PERFORMANCE_STATS', () => {
    test('every limit list has 4 ranks and is non-decreasing', () => {
        for (const def of PERFORMANCE_STATS) {
            for (const limits of Object.values(def.limits)) {
                expect(limits).toHaveLength(4);
                if (def.kind === 'number' || def.kind === 'bytes') {
                    for (let i = 1; i < limits.length; i++) {
                        expect(limits[i]).toBeGreaterThanOrEqual(limits[i - 1]);
                    }
                }
            }
        }
    });
});

describe('analyzeAvatarPerformance', () => {
    test('all-excellent avatar has no limiting stats', () => {
        const result = analyzeAvatarPerformance(excellentStats(), 'standalonewindows');
        expect(result.rank).toBe('Excellent');
        expect(result.limitingKeys).toEqual([]);
        expect(result.stats.every((s) => s.rank === 'Excellent' && s.nextLimit === null)).toBe(true);
    });

    test('rank is the worst stat and lists the limiting ones', () => {
        const stats = {
            ...excellentStats(),
            totalPolygons: 69000, // Good
            skinnedMeshCount: 9, // Poor
            totalTextureUsage: 120 * MB // Poor
        };
        const result = analyzeAvatarPerformance(stats, 'standalonewindows');
        expect(result.rank).toBe('Poor');
        expect(result.limitingKeys).toEqual(['texture_memory', 'skinned_meshes']);
        const triangles = result.stats.find((s) => s.key === 'triangles');
        expect(triangles.rank).toBe('Good');
        expect(triangles.nextLimit).toEqual({ rank: 'Excellent', limit: 32000 });
        const skinned = result.stats.find((s) => s.key === 'skinned_meshes');
        expect(skinned.nextLimit).toEqual({ rank: 'Medium', limit: 8 });
    });

    test('limits are inclusive and anything above Poor is Very Poor', () => {
        const atLimit = analyzeAvatarPerformance({ ...excellentStats(), boneCount: 400 }, 'standalonewindows');
        expect(atLimit.stats.find((s) => s.key === 'bones').rank).toBe('Poor');
        const over = analyzeAvatarPerformance({ ...excellentStats(), boneCount: 401 }, 'standalonewindows');
        expect(over.stats.find((s) => s.key === 'bones').rank).toBe('VeryPoor');
        expect(over.rank).toBe('VeryPoor');
        expect(over.limitingKeys).toEqual(['bones']);
    });

    test('equal Good/Medium/Poor limits rank at the best matching rank', () => {
        const result = analyzeAvatarPerformance({ ...excellentStats(), totalPolygons: 70000 }, 'standalonewindows');
        expect(result.stats.find((s) => s.key === 'triangles').rank).toBe('Good');
    });

    test('uses mobile limits and skips PC-only stats on android/ios', () => {
        const result = analyzeAvatarPerformance({ ...excellentStats(), lightCount: 3 }, 'android');
        expect(result.stats.some((s) => s.key === 'lights')).toBe(false);
        // 20k triangles = mobile Poor limit; 2 material slots = mobile Medium
        expect(result.stats.find((s) => s.key === 'triangles').rank).toBe('Poor');
        expect(result.stats.find((s) => s.key === 'material_slots').rank).toBe('Medium');
        // PhysBones Excellent on mobile is 0
        expect(result.stats.find((s) => s.key === 'physbone_components').rank).toBe('Good');
        expect(result.rank).toBe('Poor');
    });

    test('booleans rank by the first rank that allows them', () => {
        const pc = analyzeAvatarPerformance({ ...excellentStats(), particleTrailsEnabled: true }, 'standalonewindows');
        expect(pc.stats.find((s) => s.key === 'particle_trails').rank).toBe('Medium');
        const mobile = analyzeAvatarPerformance({ ...excellentStats(), particleTrailsEnabled: true }, 'ios');
        expect(mobile.stats.find((s) => s.key === 'particle_trails').rank).toBe('Poor');
    });

    test('bounds compare per axis', () => {
        const rankOf = (bounds) =>
            analyzeAvatarPerformance({ ...excellentStats(), bounds }, 'standalonewindows').stats.find(
                (s) => s.key === 'bounds'
            ).rank;
        expect(rankOf([2.5, 2.5, 2.5])).toBe('Excellent');
        expect(rankOf([1, 3, 1])).toBe('Good');
        expect(rankOf([1, 5.5, 1])).toBe('Medium');
        expect(rankOf([5.1, 1, 1])).toBe('VeryPoor');
    });

    test('unknown bounds shape and missing fields stay unrated', () => {
        const stats = excellentStats();
        stats.bounds = [0, 0, 0, 1, 1, 1];
        delete stats.raycastCount;
        const result = analyzeAvatarPerformance(stats, 'standalonewindows');
        const bounds = result.stats.find((s) => s.key === 'bounds');
        expect(bounds.rank).toBeNull();
        expect(bounds.nextLimit).toBeNull();
        expect(result.stats.some((s) => s.key === 'raycasts')).toBe(false);
        expect(result.rank).toBe('Excellent');
    });

    test('no stats at all', () => {
        expect(analyzeAvatarPerformance(undefined, 'standalonewindows')).toEqual({
            stats: [],
            rank: null,
            limitingKeys: []
        });
    });
});

describe('normalizePerformanceRank', () => {
    test('strips spaces', () => {
        expect(normalizePerformanceRank('Very Poor')).toBe('VeryPoor');
        expect(normalizePerformanceRank('Good')).toBe('Good');
        expect(normalizePerformanceRank(undefined)).toBe('');
    });
});

describe('formatPerformanceValue', () => {
    test('formats each kind', () => {
        expect(formatPerformanceValue('number', 70000)).toBe((70000).toLocaleString());
        expect(formatPerformanceValue('bytes', 40 * MB)).toBe('40 MB');
        expect(formatPerformanceValue('bytes', 75, { isLimit: true })).toBe('75 MB');
        expect(formatPerformanceValue('boolean', true, { yes: 'on', no: 'off' })).toBe('on');
        expect(formatPerformanceValue('bounds', [1.234, 2, 0.5])).toBe('1.23 × 2 × 0.5 m');
        expect(formatPerformanceValue('bounds', [0, 0, 0, 1, 1, 1])).toBe('0 × 0 × 0 × 1 × 1 × 1');
        expect(formatPerformanceValue('number', undefined)).toBe('-');
    });
});
