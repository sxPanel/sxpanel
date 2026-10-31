/**
 * Helpers for the combat log data sent by resource/sv_combatlog.lua.
 * Values come from the game server and are only used for display, but are still
 * normalized since part of the data originates from player clients.
 */

export type CombatSummary = {
    hits: number;
    damage: number;
    headshots: number;
    weapon: string | null;
    weapons: string[];
    distance: number | null;
    maxDistance: number | null;
    durationMs: number;
};

export type CombatDamageSummary = CombatSummary & {
    victim: number;
};

const MAX_WEAPONS = 8;
const MAX_WEAPON_NAME_LENGTH = 64;

const toFiniteNumber = (value: unknown, fallback: number, maxValue = Number.MAX_SAFE_INTEGER) => {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || num < 0) return fallback;
    return Math.min(num, maxValue);
};

const toNullableDistance = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return Math.min(value, 100_000);
};

const toWeaponName = (value: unknown) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().slice(0, MAX_WEAPON_NAME_LENGTH);
    return trimmed.length && trimmed !== 'unknown' ? trimmed : null;
};

/**
 * Normalizes the `combat` table attached to DeathNotice events, or the CombatDamage event data.
 * Returns null if the input is not a combat summary.
 */
export const parseCombatSummary = (input: unknown): CombatSummary | null => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const data = input as Record<string, unknown>;

    const weapons = Array.isArray(data.weapons)
        ? data.weapons
              .map(toWeaponName)
              .filter((name): name is string => name !== null)
              .slice(0, MAX_WEAPONS)
        : [];

    return {
        hits: Math.floor(toFiniteNumber(data.hits, 0, 100_000)),
        damage: Math.round(toFiniteNumber(data.damage, 0, 10_000_000)),
        headshots: Math.floor(toFiniteNumber(data.headshots, 0, 100_000)),
        weapon: toWeaponName(data.weapon) ?? weapons[0] ?? null,
        weapons,
        distance: toNullableDistance(data.distance),
        maxDistance: toNullableDistance(data.maxDistance),
        durationMs: Math.floor(toFiniteNumber(data.durationMs, 0, 3_600_000)),
    };
};

/**
 * Normalizes the CombatDamage event data, which also carries the victim server ID.
 */
export const parseCombatDamageSummary = (input: unknown): CombatDamageSummary | null => {
    const summary = parseCombatSummary(input);
    if (!summary) return null;
    const victim = (input as Record<string, unknown>).victim;
    if (typeof victim !== 'number' || !Number.isInteger(victim) || victim <= 0) return null;
    return { ...summary, victim };
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`) => {
    return `${count} ${count === 1 ? singular : pluralForm}`;
};

export const formatCombatDistance = (distance: number | null) => {
    return distance === null ? null : `${distance.toFixed(1)}m`;
};

/**
 * Returns a short stats string, eg: "4 hits, 1 headshot, 87 dmg, 23.4m"
 */
export const formatCombatStats = (summary: CombatSummary) => {
    const parts: string[] = [];
    if (summary.hits > 0) {
        parts.push(plural(summary.hits, 'hit'));
        if (summary.headshots > 0) parts.push(plural(summary.headshots, 'headshot'));
        parts.push(`${summary.damage} dmg`);
    }
    const distance = formatCombatDistance(summary.distance);
    if (distance) parts.push(distance);
    return parts.join(', ');
};
