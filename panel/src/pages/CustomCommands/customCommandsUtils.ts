import { customAlphabet } from 'nanoid';
import { alphanumeric } from 'nanoid-dictionary';
import {
    CUSTOM_COMMAND_ID_LENGTH,
    CustomCommand,
    CustomCommandActionType,
    CustomCommandMenuActionDef,
    RESERVED_COMMAND_NAMES,
} from '@shared/customCommands';

export const genCustomCommandId = customAlphabet(alphanumeric, CUSTOM_COMMAND_ID_LENGTH);

/** Radix Select doesn't accept empty string values */
export const EVERYONE_PERM = '__everyone__';

export const actionTypeLabels: Record<CustomCommandActionType, { label: string; hint: string }> = {
    menuAction: { label: '/tx Menu Action', hint: 'run an in-game menu action' },
    chatMessage: { label: 'Chat Message', hint: 'reply with a text message' },
    consoleCommand: { label: 'Console Command', hint: 'run a server console command' },
    serverEvent: { label: 'Server Event', hint: 'trigger a server event' },
    clientEvent: { label: 'Client Event', hint: "trigger an event on the player's client" },
};

/**
 * Finds a free command name based on the suggestion (eg. "heal", "heal2", ...)
 */
export const findFreeCommandName = (suggestion: string, commands: CustomCommand[]) => {
    const taken = new Set(commands.flatMap((cmd) => [cmd.name, ...cmd.aliases]));
    const isFree = (name: string) => !taken.has(name) && !RESERVED_COMMAND_NAMES.has(name);
    if (isFree(suggestion)) return suggestion;
    for (let i = 2; i < 100; i++) {
        const candidate = `${suggestion}${i}`;
        if (isFree(candidate)) return candidate;
    }
    return '';
};

export const draftFromMenuAction = (def: CustomCommandMenuActionDef, commands: CustomCommand[]): CustomCommand => ({
    id: genCustomCommandId(),
    name: findFreeCommandName(def.suggestedName, commands),
    aliases: [],
    description: def.description,
    enabled: true,
    permission: def.permission,
    cooldownSeconds: 0,
    action: { type: 'menuAction', actionId: def.id } as CustomCommand['action'],
});

export const blankDraft = (): CustomCommand => ({
    id: genCustomCommandId(),
    name: '',
    aliases: [],
    description: '',
    enabled: true,
    permission: '',
    cooldownSeconds: 0,
    action: { type: 'chatMessage', message: '', broadcast: false },
});
