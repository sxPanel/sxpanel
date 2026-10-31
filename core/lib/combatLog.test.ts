import { suite, it, expect } from 'vitest';
import { formatCombatStats, parseCombatDamageSummary, parseCombatSummary } from './combatLog';

suite('parseCombatSummary', () => {
    it('should normalize a summary sent by the game server', () => {
        expect(
            parseCombatSummary({
                hits: 4,
                damage: 87.4,
                headshots: 1,
                weapon: 'Pistol',
                weapons: ['Pistol', 'Knife'],
                distance: 23.4,
                maxDistance: 30.1,
                durationMs: 2500,
            }),
        ).toEqual({
            hits: 4,
            damage: 87,
            headshots: 1,
            weapon: 'Pistol',
            weapons: ['Pistol', 'Knife'],
            distance: 23.4,
            maxDistance: 30.1,
            durationMs: 2500,
        });
    });

    it('should tolerate missing or malformed values', () => {
        //Lua sends `false` for unknown distances and may encode an empty weapons table as {}
        expect(
            parseCombatSummary({ hits: -3, damage: 'abc', distance: false, weapons: {}, weapon: 'unknown' }),
        ).toEqual({
            hits: 0,
            damage: 0,
            headshots: 0,
            weapon: null,
            weapons: [],
            distance: null,
            maxDistance: null,
            durationMs: 0,
        });
        expect(parseCombatSummary(null)).toBeNull();
        expect(parseCombatSummary([1, 2])).toBeNull();
    });

    it('should require a valid victim for damage summaries', () => {
        expect(parseCombatDamageSummary({ hits: 1, damage: 10 })).toBeNull();
        expect(parseCombatDamageSummary({ hits: 1, damage: 10, victim: 0 })).toBeNull();
        expect(parseCombatDamageSummary({ hits: 1, damage: 10, victim: 7 })?.victim).toBe(7);
    });
});

suite('formatCombatStats', () => {
    it('should format hits, headshots, damage, and distance', () => {
        const summary = parseCombatSummary({ hits: 4, headshots: 1, damage: 87, distance: 23.44 })!;
        expect(formatCombatStats(summary)).toBe('4 hits, 1 headshot, 87 dmg, 23.4m');
    });

    it('should only show the distance when no hits were tracked', () => {
        const summary = parseCombatSummary({ hits: 0, damage: 0, distance: 5 })!;
        expect(formatCombatStats(summary)).toBe('5.0m');
        expect(formatCombatStats(parseCombatSummary({})!)).toBe('');
    });
});
