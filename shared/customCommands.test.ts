import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    CustomCommand,
    CustomCommandSchema,
    CustomCommandsArraySchema,
    customCommandMenuActions,
    findCustomCommandConflicts,
    isPrivilegedCustomCommand,
} from './customCommands';
import { registeredPermissions } from './permissions';

const makeCmd = (overrides: Partial<CustomCommand> = {}): CustomCommand => ({
    id: 'abcdefghijklmnop',
    name: 'heal',
    aliases: [],
    description: '',
    enabled: true,
    permission: 'players.heal',
    cooldownSeconds: 0,
    action: { type: 'menuAction', actionId: 'healSelf' },
    ...overrides,
});

describe('CustomCommandSchema', () => {
    it('accepts a valid menu action command', () => {
        expect(CustomCommandSchema.safeParse(makeCmd()).success).toBe(true);
    });

    it('normalizes the name to lowercase', () => {
        const result = CustomCommandSchema.parse(makeCmd({ name: ' HealMe ' }));
        expect(result.name).toBe('healme');
    });

    it('rejects reserved and invalid names', () => {
        expect(CustomCommandSchema.safeParse(makeCmd({ name: 'tx' })).success).toBe(false);
        expect(CustomCommandSchema.safeParse(makeCmd({ name: 'ban' })).success).toBe(false);
        expect(CustomCommandSchema.safeParse(makeCmd({ name: 'has space' })).success).toBe(false);
        expect(CustomCommandSchema.safeParse(makeCmd({ name: 'semi;colon' })).success).toBe(false);
        expect(CustomCommandSchema.safeParse(makeCmd({ aliases: ['kick'] })).success).toBe(false);
    });

    it('rejects unknown menu actions', () => {
        const cmd = makeCmd({ action: { type: 'menuAction', actionId: 'nope' } as any });
        expect(CustomCommandSchema.safeParse(cmd).success).toBe(false);
    });

    it('rejects invalid event names', () => {
        const cmd = makeCmd({ action: { type: 'serverEvent', eventName: 'bad event;name' } });
        expect(CustomCommandSchema.safeParse(cmd).success).toBe(false);
    });
});

describe('findCustomCommandConflicts', () => {
    it('detects name/alias collisions across commands', () => {
        const a = makeCmd({ id: 'aaaaaaaaaaaaaaaa', name: 'heal', aliases: ['h'] });
        const b = makeCmd({ id: 'bbbbbbbbbbbbbbbb', name: 'h' });
        expect(findCustomCommandConflicts([a, b])).toHaveLength(1);
        expect(CustomCommandsArraySchema.safeParse([a, b]).success).toBe(false);
    });

    it('detects duplicate aliases within a command', () => {
        const a = makeCmd({ name: 'heal', aliases: ['heal'] });
        expect(findCustomCommandConflicts([a])).toHaveLength(1);
    });

    it('detects duplicate ids', () => {
        const a = makeCmd({ name: 'one' });
        const b = makeCmd({ name: 'two' });
        expect(findCustomCommandConflicts([a, b])).toEqual(['Duplicate command id: abcdefghijklmnop']);
    });

    it('accepts distinct commands', () => {
        const a = makeCmd({ id: 'aaaaaaaaaaaaaaaa', name: 'heal', aliases: ['h'] });
        const b = makeCmd({ id: 'bbbbbbbbbbbbbbbb', name: 'car' });
        expect(findCustomCommandConflicts([a, b])).toEqual([]);
    });
});

describe('menu action catalog', () => {
    it('only references existing permissions', () => {
        const permIds = new Set(registeredPermissions.map((p) => p.id));
        for (const action of customCommandMenuActions) {
            if (action.permission) expect(permIds.has(action.permission), action.id).toBe(true);
        }
    });

    it('has a client runner for every action', () => {
        const luaSource = fs.readFileSync(new URL('../resource/cl_custom_commands.lua', import.meta.url), 'utf8');
        for (const action of customCommandMenuActions) {
            expect(luaSource, action.id).toMatch(new RegExp(`^\\s+${action.id} = function`, 'm'));
        }
    });

    it('has unique ids and valid suggested names', () => {
        const ids = customCommandMenuActions.map((a) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const action of customCommandMenuActions) {
            const cmd = makeCmd({ name: action.suggestedName, action: { type: 'menuAction', actionId: action.id } });
            expect(CustomCommandSchema.safeParse(cmd).success, action.id).toBe(true);
        }
    });
});

describe('isPrivilegedCustomCommand', () => {
    it('flags console commands and server events only', () => {
        expect(isPrivilegedCustomCommand(makeCmd({ action: { type: 'consoleCommand', command: 'x' } }))).toBe(true);
        expect(isPrivilegedCustomCommand(makeCmd({ action: { type: 'serverEvent', eventName: 'x' } }))).toBe(true);
        expect(isPrivilegedCustomCommand(makeCmd({ action: { type: 'clientEvent', eventName: 'x' } }))).toBe(false);
        expect(isPrivilegedCustomCommand(makeCmd())).toBe(false);
    });
});
