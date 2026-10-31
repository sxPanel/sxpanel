const modulename = 'WebServer:CustomCommands';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { dequal } from 'dequal/lite';
import { z } from 'zod';
import { fromError } from 'zod-validation-error';
import {
    CustomCommand,
    CustomCommandsArraySchema,
    GetCustomCommandsResp,
    SaveCustomCommandsResp,
    isPrivilegedCustomCommand,
} from '@shared/customCommands';
const console = consoleFactory(modulename);

/**
 * Tells the game server to re-fetch the custom commands via intercom.
 * Returns false if the server is offline (it will fetch them on boot).
 */
export const notifyCustomCommandsChanged = () => {
    return !!txCore.fxRunner.sendEvent('customCommandsChanged', {});
};

/**
 * Returns the configured custom chat commands
 */
export async function getCustomCommands(ctx: AuthedCtx) {
    const sendTypedResp = (data: GetCustomCommandsResp | { error: string }) => ctx.send(data);
    if (!ctx.admin.testPermission('settings.view', modulename)) {
        return sendTypedResp({ error: 'You do not have permission to view the settings.' });
    }

    return sendTypedResp({
        commands: txConfig.gameFeatures.customCommands,
        menuEnabled: txConfig.gameFeatures.menuEnabled,
        serverOnline: !!txCore.fxRunner.child?.isAlive,
    });
}

/**
 * Lists the privileged commands (console/server event) that were added, changed or removed.
 */
const getChangedPrivilegedCommands = (prev: CustomCommand[], next: CustomCommand[]) => {
    const prevById = new Map(prev.map((cmd) => [cmd.id, cmd]));
    const nextById = new Map(next.map((cmd) => [cmd.id, cmd]));
    const changed: string[] = [];
    for (const cmd of next) {
        const old = prevById.get(cmd.id);
        const isPrivileged = isPrivilegedCustomCommand(cmd) || (old && isPrivilegedCustomCommand(old));
        if (isPrivileged && !dequal(old, cmd)) changed.push(cmd.name);
    }
    for (const old of prev) {
        if (isPrivilegedCustomCommand(old) && !nextById.has(old.id)) changed.push(old.name);
    }
    return changed;
};

/**
 * Saves the custom chat commands and live-reloads them in the game server
 */
export async function saveCustomCommands(ctx: AuthedCtx) {
    const sendTypedResp = (data: SaveCustomCommandsResp) => ctx.send(data);
    if (!ctx.admin.testPermission('settings.write', modulename)) {
        return sendTypedResp({ error: 'You do not have permission to change the settings.' });
    }

    //Validating input
    const bodyResult = z.object({ commands: CustomCommandsArraySchema }).safeParse(ctx.request.body);
    if (!bodyResult.success) {
        return sendTypedResp({ error: fromError(bodyResult.error, { prefix: null }).message });
    }
    const commands = bodyResult.data.commands;

    //Console commands and server events can do anything a console admin can, so they require that permission
    const privilegedChanges = getChangedPrivilegedCommands(txConfig.gameFeatures.customCommands, commands);
    if (privilegedChanges.length && !ctx.admin.hasPermission('console.write')) {
        const list = privilegedChanges.map((name) => `/${name}`).join(', ');
        return sendTypedResp({
            error: `You need the "Console: Write" permission to change console command or server event commands (${list}).`,
        });
    }

    //Saving
    try {
        txCore.configStore.saveConfigs({ gameFeatures: { customCommands: commands } }, ctx.admin.name);
    } catch (error) {
        console.warn(`[${ctx.admin.name}] Error changing custom commands.`);
        console.verbose.dir(error);
        return sendTypedResp({ error: `Error saving the configuration file: ${emsg(error)}` });
    }

    const liveReloaded = notifyCustomCommandsChanged();
    return sendTypedResp({ success: true, liveReloaded });
}
