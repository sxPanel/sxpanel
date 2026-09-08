const modulename = 'WebServer:GetSettingsConfigs';
import localeMap from '@shared/localeMap';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { GenericApiErrorResp } from '@shared/genericApiTypes';
import ConfigStore from '@modules/ConfigStore';
import { PartialTxConfigs, TxConfigs } from '@modules/ConfigStore/schema';
import { ConfigChangelogEntry } from '@modules/ConfigStore/changelog';
import { redactStartupSecrets } from '@lib/misc';
import { txHostConfig } from '@core/globalData';
import { getAllPermissionPresets } from '@modules/AdminStore/permissionPresets';
import type { PermissionPreset } from '@shared/permissions';
const console = consoleFactory(modulename);

export type GetConfigsResp = {
    locales: { code: string; label: string }[];
    permissionPresets: PermissionPreset[];
    dataPath: string;
    hasCustomDataPath: boolean;
    changelog: ConfigChangelogEntry[];
    storedConfigs: PartialTxConfigs;
    defaultConfigs: TxConfigs;
    forceQuietMode: boolean;
};

/**
 * Returns the output page containing the live console
 */
export default async function GetSettingsConfigs(ctx: AuthedCtx) {
    const sendTypedResp = (data: GetConfigsResp | GenericApiErrorResp) => ctx.send(data);

    //Check permissions
    if (!ctx.admin.testPermission('settings.view', modulename)) {
        return sendTypedResp({
            errorCode: 'settings.no_permission_view',
            error: 'You do not have permission to view the settings.',
        });
    }

    //Prepare data
    const locales = Object.keys(localeMap).map((code) => ({
        code,
        label: localeMap[code].$meta.label,
    }));
    locales.sort((a, b) => a.label.localeCompare(b.label));

    const outData: GetConfigsResp = {
        locales,
        permissionPresets: getAllPermissionPresets(),
        dataPath: txHostConfig.dataPath,
        hasCustomDataPath: txHostConfig.hasCustomDataPath,
        changelog: txCore.configStore.getChangelog(),
        storedConfigs: txCore.configStore.getStoredConfig(),
        defaultConfigs: ConfigStore.SchemaDefaults,
        forceQuietMode: txHostConfig.forceQuietMode,
    };

    //Redact sensitive data if the user doesn't have the write permission
    if (!ctx.admin.hasPermission('settings.write')) {
        const toRedact = outData.storedConfigs as any; //dont want to type this
        if (outData.storedConfigs.server?.startupArgs) {
            toRedact.server.startupArgs = redactStartupSecrets(outData.storedConfigs.server.startupArgs);
        }
        if (outData.storedConfigs.discordBot?.token) {
            toRedact.discordBot.token = '[redacted by sxPanel]';
        }
        if (outData.storedConfigs.discordBot?.oauthClientSecret) {
            toRedact.discordBot.oauthClientSecret = '[redacted by sxPanel]';
        }
    }

    return sendTypedResp(outData);
}
