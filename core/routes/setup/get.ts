const modulename = 'WebServer:SetupGet';
import { txHostConfig } from '@core/globalData';
import { RECIPE_DEPLOYER_VERSION } from '@core/deployer/consts';
import consoleFactory from '@lib/console';
import { TxConfigState } from '@shared/enums';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
const console = consoleFactory(modulename);

/**
 * Returns JSON data for the setup page
 */
export default async function SetupGet(ctx: AuthedCtx) {
    //Check permissions
    if (!ctx.admin.hasPermission('master')) {
        return ctx.send({ error: 'You need to be the admin master to use the setup page.' });
    }

    // Ensure correct state for the setup page
    if (txManager.configState === TxConfigState.Deployer) {
        return ctx.send({ redirect: '/server/deployer' });
    } else if (txManager.configState !== TxConfigState.Setup) {
        return ctx.send({ redirect: '/' });
    }

    //Output
    const storedConfig = txCore.configStore.getStoredConfig();
    return ctx.send({
        skipServerName: !!storedConfig.general?.serverName,
        serverName: storedConfig.general?.serverName ?? '',
        deployerEngineVersion: String(RECIPE_DEPLOYER_VERSION),
        forceGameName: txHostConfig.forceGameName ?? '',
        dataPath: txHostConfig.dataPath,
        hasCustomDataPath: txHostConfig.hasCustomDataPath,
        hostConfigSource: txHostConfig.sourceName,
    });
}
