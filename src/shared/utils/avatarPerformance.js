/**
 * Avatar performance breakdown (fork-added).
 *
 * VRChat's API only reports an avatar's overall `performanceRating`, but its
 * file analysis (`/analysis/{fileId}/{version}/{variant}`, already loaded into
 * `avatarDialog.fileAnalysis` by `getBundleDateSize`) carries the raw
 * `avatarStats`. This rates each stat against VRChat's published limits so the
 * UI can show which stats push the avatar into its rank.
 *
 * Limits: https://creators.vrchat.com/avatars/avatar-performance-ranking-system/
 * (page last updated 2026-10-21). Each limit array is the maximum allowed value
 * for [Excellent, Good, Medium, Poor]; anything above Poor is Very Poor.
 *
 * Not covered, because `avatarStats` doesn't carry them: Face Tracking
 * Operations, Forwarded Parameters and Mesh Read/Write being disabled. Any of
 * those can make VRChat's own rating worse than the one computed here.
 */

export const PERFORMANCE_RANKS = Object.freeze(['Excellent', 'Good', 'Medium', 'Poor', 'VeryPoor']);

const BYTES_PER_MB = 1024 * 1024;

/**
 * @typedef {object} PerformanceStatDef
 * @property {string} key I18n key suffix and stable id
 * @property {string} field `avatarStats` property
 * @property {'number' | 'bytes' | 'boolean' | 'bounds'} kind
 * @property {{ pc?: (number | boolean | number[])[]; mobile?: (number | boolean | number[])[] }} limits Omitted for a platform = the stat isn't ranked there (on mobile:
 *   the component is removed by VRChat)
 */

const BOUNDS_EXCELLENT = [2.5, 2.5, 2.5];
const BOUNDS_GOOD = [4, 4, 4];
const BOUNDS_MEDIUM = [5, 6, 5];
const BOUNDS_LIMITS = [BOUNDS_EXCELLENT, BOUNDS_GOOD, BOUNDS_MEDIUM, BOUNDS_MEDIUM];

/** @type {ReadonlyArray<PerformanceStatDef>} in the order VRChat's docs list them */
export const PERFORMANCE_STATS = Object.freeze([
    {
        key: 'triangles',
        field: 'totalPolygons',
        kind: 'number',
        limits: { pc: [32000, 70000, 70000, 70000], mobile: [7500, 10000, 15000, 20000] }
    },
    { key: 'bounds', field: 'bounds', kind: 'bounds', limits: { pc: BOUNDS_LIMITS, mobile: BOUNDS_LIMITS } },
    {
        key: 'texture_memory',
        field: 'totalTextureUsage',
        kind: 'bytes',
        limits: { pc: [40, 75, 110, 150], mobile: [10, 18, 25, 40] }
    },
    {
        key: 'skinned_meshes',
        field: 'skinnedMeshCount',
        kind: 'number',
        limits: { pc: [1, 2, 8, 16], mobile: [1, 1, 2, 2] }
    },
    { key: 'basic_meshes', field: 'meshCount', kind: 'number', limits: { pc: [4, 8, 16, 24], mobile: [1, 1, 2, 2] } },
    {
        key: 'material_slots',
        field: 'materialSlotsUsed',
        kind: 'number',
        limits: { pc: [4, 8, 16, 32], mobile: [1, 1, 2, 4] }
    },
    {
        key: 'physbone_components',
        field: 'physBoneComponentCount',
        kind: 'number',
        limits: { pc: [4, 8, 16, 32], mobile: [0, 4, 6, 8] }
    },
    {
        key: 'physbone_transforms',
        field: 'physBoneTransformCount',
        kind: 'number',
        limits: { pc: [16, 64, 128, 256], mobile: [0, 16, 32, 64] }
    },
    {
        key: 'physbone_colliders',
        field: 'physBoneColliderCount',
        kind: 'number',
        limits: { pc: [4, 8, 16, 32], mobile: [0, 4, 8, 16] }
    },
    {
        key: 'physbone_collision_checks',
        field: 'physBoneCollisionCheckCount',
        kind: 'number',
        limits: { pc: [32, 128, 256, 512], mobile: [0, 16, 32, 64] }
    },
    { key: 'contacts', field: 'contactCount', kind: 'number', limits: { pc: [8, 16, 24, 32], mobile: [2, 4, 8, 16] } },
    {
        key: 'constraints',
        field: 'constraintCount',
        kind: 'number',
        limits: { pc: [100, 250, 300, 350], mobile: [30, 60, 120, 150] }
    },
    {
        key: 'constraint_depth',
        field: 'constraintDepth',
        kind: 'number',
        limits: { pc: [20, 50, 80, 100], mobile: [5, 15, 35, 50] }
    },
    { key: 'animators', field: 'animatorCount', kind: 'number', limits: { pc: [1, 4, 16, 32], mobile: [1, 1, 1, 2] } },
    {
        key: 'bones',
        field: 'boneCount',
        kind: 'number',
        limits: { pc: [75, 150, 256, 400], mobile: [75, 90, 150, 150] }
    },
    { key: 'lights', field: 'lightCount', kind: 'number', limits: { pc: [0, 0, 0, 1] } },
    {
        key: 'particle_systems',
        field: 'particleSystemCount',
        kind: 'number',
        limits: { pc: [0, 4, 8, 16], mobile: [0, 0, 0, 2] }
    },
    {
        key: 'total_particles',
        field: 'totalMaxParticles',
        kind: 'number',
        limits: { pc: [0, 300, 1000, 2500], mobile: [0, 0, 0, 200] }
    },
    {
        key: 'mesh_particle_polys',
        field: 'meshParticleMaxPolygons',
        kind: 'number',
        limits: { pc: [0, 1000, 2000, 5000], mobile: [0, 0, 0, 400] }
    },
    {
        key: 'particle_trails',
        field: 'particleTrailsEnabled',
        kind: 'boolean',
        limits: { pc: [false, false, true, true], mobile: [false, false, false, true] }
    },
    {
        key: 'particle_collision',
        field: 'particleCollisionEnabled',
        kind: 'boolean',
        limits: { pc: [false, false, true, true], mobile: [false, false, false, true] }
    },
    {
        key: 'trail_renderers',
        field: 'trailRendererCount',
        kind: 'number',
        limits: { pc: [1, 2, 4, 8], mobile: [0, 0, 0, 1] }
    },
    {
        key: 'line_renderers',
        field: 'lineRendererCount',
        kind: 'number',
        limits: { pc: [1, 2, 4, 8], mobile: [0, 0, 0, 1] }
    },
    { key: 'raycasts', field: 'raycastCount', kind: 'number', limits: { pc: [1, 4, 8, 15], mobile: [1, 2, 4, 8] } },
    { key: 'cloths', field: 'clothCount', kind: 'number', limits: { pc: [0, 1, 1, 1] } },
    { key: 'cloth_vertices', field: 'totalClothVertices', kind: 'number', limits: { pc: [0, 50, 100, 200] } },
    { key: 'physics_colliders', field: 'physicsColliders', kind: 'number', limits: { pc: [0, 1, 8, 8] } },
    { key: 'physics_rigidbodies', field: 'physicsRigidbodies', kind: 'number', limits: { pc: [0, 1, 8, 8] } },
    { key: 'audio_sources', field: 'audioSourceCount', kind: 'number', limits: { pc: [1, 4, 8, 8] } }
]);

/** Unranked stats worth showing for context. */
export const INFO_STATS = Object.freeze([
    { key: 'vertices', field: 'totalVertices' },
    { key: 'materials', field: 'materialCount' },
    { key: 'blend_shapes', field: 'blendShapeCount' },
    { key: 'cameras', field: 'cameraCount' },
    { key: 'write_defaults', field: 'writeDefaultsUsed' }
]);

/**
 * @param {string} platform UnityPackage platform (`standalonewindows`, `android`, `ios`)
 * @returns {'pc' | 'mobile'}
 */
export function getPerformanceLimitSet(platform) {
    return platform === 'android' || platform === 'ios' ? 'mobile' : 'pc';
}

/**
 * @param {number[]} value
 * @param {number[]} limit
 */
function boundsWithin(value, limit) {
    return value.every((v, i) => Math.abs(v) <= limit[i]);
}

/**
 * @param {PerformanceStatDef['kind']} kind
 * @param {unknown} value Raw `avatarStats` value
 * @returns {unknown} Comparable value, or undefined when it can't be rated
 */
function normalizeValue(kind, value) {
    if (kind === 'bounds') {
        // Only a plain [x, y, z] size can be rated; any other shape is shown raw.
        return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? value : undefined;
    }
    if (kind === 'boolean') {
        return typeof value === 'boolean' ? value : undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return kind === 'bytes' ? value / BYTES_PER_MB : value;
}

/**
 * @param {PerformanceStatDef['kind']} kind
 * @param {unknown} value Normalized value
 * @param {(number | boolean | number[])[]} limits
 * @returns {number} Index into PERFORMANCE_RANKS
 */
function rankIndexFor(kind, value, limits) {
    for (let i = 0; i < limits.length; i++) {
        const limit = limits[i];
        if (kind === 'bounds') {
            if (boundsWithin(/** @type {number[]} */ (value), /** @type {number[]} */ (limit))) return i;
        } else if (kind === 'boolean') {
            if (!value || limit === true) return i;
        } else if (/** @type {number} */ (value) <= /** @type {number} */ (limit)) {
            return i;
        }
    }
    return PERFORMANCE_RANKS.length - 1;
}

/**
 * @typedef {object} RatedStat
 * @property {string} key
 * @property {string} field
 * @property {PerformanceStatDef['kind']} kind
 * @property {unknown} value Raw value from avatarStats
 * @property {string | null} rank One of PERFORMANCE_RANKS, null if unrated
 * @property {(number | boolean | number[])[]} limits
 * @property {{ rank: string; limit: number | boolean | number[] } | null} nextLimit The limit to meet for the
 *   next-better rank, null at Excellent or unrated
 */

/**
 * @param {Record<string, unknown> | null | undefined} avatarStats
 * @param {string} platform
 * @returns {{ stats: RatedStat[]; rank: string | null; limitingKeys: string[] }} `rank` is the worst rated stat;
 *   `limitingKeys` are the stats at that rank
 */
export function analyzeAvatarPerformance(avatarStats, platform) {
    const set = getPerformanceLimitSet(platform);
    /** @type {RatedStat[]} */
    const stats = [];
    let worst = -1;
    for (const def of PERFORMANCE_STATS) {
        const limits = def.limits[set];
        if (!limits || !avatarStats || !(def.field in avatarStats)) {
            continue;
        }
        const raw = avatarStats[def.field];
        const value = normalizeValue(def.kind, raw);
        let rank = null;
        let nextLimit = null;
        if (value !== undefined) {
            const index = rankIndexFor(def.kind, value, limits);
            rank = PERFORMANCE_RANKS[index];
            worst = Math.max(worst, index);
            if (index > 0) {
                nextLimit = { rank: PERFORMANCE_RANKS[index - 1], limit: limits[index - 1] };
            }
        }
        stats.push({ key: def.key, field: def.field, kind: def.kind, value: raw, rank, limits, nextLimit });
    }
    const rank = worst >= 0 ? PERFORMANCE_RANKS[worst] : null;
    const limitingKeys = rank && worst > 0 ? stats.filter((s) => s.rank === rank).map((s) => s.key) : [];
    return { stats, rank, limitingKeys };
}

/**
 * VRChat's rating strings come as "Very Poor"; i18n keys and PERFORMANCE_RANKS
 * use "VeryPoor".
 *
 * @param {string | undefined | null} rating
 * @returns {string}
 */
export function normalizePerformanceRank(rating) {
    return typeof rating === 'string' ? rating.replaceAll(' ', '') : '';
}

/**
 * Display text for a stat value or limit.
 *
 * @param {PerformanceStatDef['kind']} kind
 * @param {unknown} value
 * @param {{ isLimit?: boolean; yes?: string; no?: string }} [options] Limits for `bytes` are already in MB; values are
 *   bytes
 * @returns {string}
 */
export function formatPerformanceValue(kind, value, options = {}) {
    if (value === undefined || value === null) {
        return '-';
    }
    if (kind === 'boolean') {
        return value ? (options.yes ?? 'Yes') : (options.no ?? 'No');
    }
    if (kind === 'bounds') {
        return Array.isArray(value)
            ? value.map((v) => (typeof v === 'number' ? `${Number(v.toFixed(2))}` : toText(v))).join(' × ') +
                  (value.length === 3 ? ' m' : '')
            : toText(value);
    }
    if (kind === 'bytes' && typeof value === 'number') {
        const mb = options.isLimit ? value : value / BYTES_PER_MB;
        return `${Number(mb.toFixed(options.isLimit ? 0 : 2)).toLocaleString()} MB`;
    }
    return typeof value === 'number' ? value.toLocaleString() : toText(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toText(value) {
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}
