const modulename = 'WebServer:SettingsPage';
import consoleFactory from '@lib/console';
import fsp from 'node:fs/promises';
import { txEnv } from '@core/globalData';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { ApiToastResp } from '@shared/genericApiTypes';
import type { PartialTxConfigs, PartialTxConfigsToSave } from '@modules/ConfigStore/schema';
import type { ConfigChangelogEntry } from '@shared/otherTypes';
import { z } from 'zod';
import { fromError } from 'zod-validation-error';
import Translator, { localeFileSchema } from '@modules/Translator';
import ConfigStore from '@modules/ConfigStore';
import { resolveCFGFilePath, findLikelyCFGPath } from '@lib/fxserver/fxsConfigHelper';
import { findPotentialServerDataPaths, isValidServerDataPath } from '@lib/fxserver/serverData';
import { getFsErrorMdMessage } from '@lib/fs';
import { generatePlayerListMessage, generateStatusMessage } from '@modules/DiscordBot/statusMessage';
import { getSchemaChainError } from '@modules/ConfigStore/schema/utils';
import { confx } from '@modules/ConfigStore/utils';
import { SYM_RESET_CONFIG } from '@lib/symbols';
import cleanFullPath from '@shared/cleanFullPath';
import jsonForgivingParse from '@shared/jsonForgivingParse';
const console = consoleFactory(modulename);

//Types
export type SaveConfigsReq = {
    resetKeys: string[];
    changes: PartialTxConfigs;
};
export type SaveConfigsResp = ApiToastResp & {
    stored?: PartialTxConfigs;
    changelog?: ConfigChangelogEntry[];
};

type SendTypedResp = (data: SaveConfigsResp) => void;
type CardHandlerSuccessResp = {
    processedConfig: PartialTxConfigsToSave;
    successToast?: ApiToastResp;
};
type CardHandler = (
    inputConfig: PartialTxConfigsToSave,
    sendTypedResp: SendTypedResp,
) => Promise<CardHandlerSuccessResp | void>;

//Known cards
const cardNamesMap = {
    general: 'General',
    fxserver: 'FXServer',
    bans: 'Bans',
    'deferral-cards': 'Deferral Cards',
    whitelist: 'Whitelist',
    queue: 'Queue',
    discord: 'Discord',
    game: 'Game',
    'discord-bot': 'Discord Bot',
    'discord-oauth': 'Discord OAuth',
    'game-menu': 'Game Menu',
    'game-notifications': 'Game Notifications',
    'game-reports': 'Game Reports',
    'player-tags': 'Player Tags',
    'panel-features': 'Panel Features',
} as const;
const validCardIds = Object.keys(cardNamesMap) as [keyof typeof cardNamesMap];

//Req validation
const paramsSchema = z.object({ card: z.enum(validCardIds) });
const bodySchema = z.object({
    resetKeys: z.array(z.string()),
    changes: z.object({}).passthrough(),
});

//Helper to clean paths
const cleanPath = (x: string) => {
    const res = cleanFullPath(x, txEnv.isWindows);
    return 'path' in res ? res.path : x;
};

/**
 * Processes a settings save request
 * NOTE: the UI trims all strings
 */
export default async function SaveSettingsConfigs(ctx: AuthedCtx) {
    const sendTypedResp = (data: SaveConfigsResp) => ctx.send(data);

    //Check permissions
    if (!ctx.admin.testPermission('settings.write', modulename)) {
        return sendTypedResp({
            type: 'error',
            msg: "You don't have permission to execute this action.",
        });
    }

    //Validating input
    const paramsSchemaRes = paramsSchema.safeParse(ctx.params);
    const bodySchemaRes = bodySchema.safeParse(ctx.request.body);
    if (!paramsSchemaRes.success || !bodySchemaRes.success) {
        return sendTypedResp({
            type: 'error',
            md: true,
            title: 'Invalid Request',
            msg: fromError(paramsSchemaRes.error ?? bodySchemaRes.error, { prefix: null }).message,
        });
    }
    const cardId = paramsSchemaRes.data.card;
    const { resetKeys, changes: inputConfig } = bodySchemaRes.data;
    const cardName = cardNamesMap[ctx.params.card as keyof typeof cardNamesMap] ?? 'UNKNOWN';

    //Delegate to the specific card handlers - if required
    let handlerResp: CardHandlerSuccessResp | void = { processedConfig: inputConfig };
    try {
        if (cardId === 'general') {
            //Only master admin can change allowSelfIdentifierEdit
            if ((inputConfig as any).general?.allowSelfIdentifierEdit !== undefined && !ctx.admin.isMaster) {
                return sendTypedResp({
                    type: 'error',
                    msg: 'Only the master admin can change the "Allow Self Identifier Edit" setting.',
                });
            }
            if ((inputConfig as any).general?.requireAdminTwoFactor !== undefined && !ctx.admin.isMaster) {
                return sendTypedResp({
                    type: 'error',
                    msg: 'Only the master admin can change the "Require Two-Factor Authentication" setting.',
                });
            }
            if ((inputConfig as any).general?.requireAdminTwoFactor === true && !ctx.admin.totpEnabled) {
                return sendTypedResp({
                    type: 'error',
                    msg: 'Enable two-factor authentication on your account before requiring it for all admins.',
                });
            }
            if ((inputConfig as any).general?.enableTelemetry !== undefined && !ctx.admin.isMaster) {
                return sendTypedResp({
                    type: 'error',
                    msg: 'Only the master admin can change anonymous telemetry collection.',
                });
            }
            handlerResp = await handleGeneralCard(inputConfig, sendTypedResp);
        } else if (cardId === 'fxserver') {
            handlerResp = await handleFxserverCard(inputConfig, sendTypedResp);
        } else if (cardId === 'discord-bot' || cardId === 'discord') {
            handlerResp = await handleDiscordCard(inputConfig, sendTypedResp);
        }
    } catch (error) {
        return sendTypedResp({
            type: 'error',
            md: true,
            title: `Error processing the ${cardName} changes.`,
            msg: emsg(error),
        });
    }
    if (!handlerResp) return; //resp already sent

    //Apply reset keys
    const configChanges = handlerResp.processedConfig;
    try {
        for (const config of resetKeys) {
            if (typeof config !== 'string' || !config.includes('.')) {
                throw new Error(`Invalid reset key: \`${String(config)}\``);
            }
            const [scope, key] = config.split('.');
            if (!scope || !key) throw new Error(`Invalid reset key: \`${config}\``);
            confx(configChanges).set(scope, key, SYM_RESET_CONFIG);
        }
    } catch (error) {
        return sendTypedResp({
            type: 'error',
            md: true,
            title: `Error processing the ${cardName} changes.`,
            msg: emsg(error),
        });
    }

    //Save the changes
    try {
        const changes = txCore.configStore.saveConfigs(configChanges, ctx.admin.name);
        if (changes.hasMatch(['server.dataPath', 'server.cfgPath'])) {
            txCore.webServer.webSocket.pushRefresh('status');
        }
        return sendTypedResp({
            type: 'success',
            msg: `${cardName} Settings saved!`,
            ...(handlerResp?.successToast ?? {}),
            stored: txCore.configStore.getStoredConfig(),
            changelog: txCore.configStore.getChangelog(),
        });
    } catch (error) {
        const cardName = cardNamesMap[ctx.params.card as keyof typeof cardNamesMap] ?? 'UNKNOWN';
        return sendTypedResp({
            type: 'error',
            md: true,
            title: `Error saving the ${cardName} changes.`,
            msg: emsg(error),
        });
    }
}

/**
 * General card handler
 */
const handleGeneralCard: CardHandler = async (inputConfig, sendTypedResp) => {
    const general = inputConfig.general;
    if (!general || typeof general !== 'object') {
        throw new Error(`Unexpected data for the 'general' card.`);
    }

    const touchedKeys = Object.keys(general).filter((key) => (general as Record<string, unknown>)[key] !== undefined);
    const isTelemetryOnly = touchedKeys.length === 1 && touchedKeys[0] === 'enableTelemetry';

    //Validates custom language file (full general card saves only)
    if (!isTelemetryOnly && general.language === undefined) {
        throw new Error(`Unexpected data for the 'general' card.`);
    }
    if (!isTelemetryOnly && general.language === 'custom') {
        try {
            const raw = await fsp.readFile(txCore.translator.customLocalePath, 'utf8');
            if (!raw.length) throw new Error('The \`locale.json\` file is empty.');
            const parsed = jsonForgivingParse(raw);
            const locale = localeFileSchema.parse(parsed);
            if (!Translator.humanizerLanguages.includes(locale.$meta.humanizer_language)) {
                throw new Error(`Invalid humanizer language: \`${locale.$meta.humanizer_language}\`.`);
            }
        } catch (error) {
            let msg = emsg(error);
            if (error instanceof Error) {
                if (error.message.includes('ENOENT')) {
                    msg = `Could not find the custom language file:\n\`${txCore.translator.customLocalePath}\``;
                } else if (error.message.includes('JSON')) {
                    msg =
                        'The custom language file contains invalid JSON.\nNote: trailing commas and comments are allowed.';
                } else if (error instanceof z.ZodError) {
                    msg = fromError(error, { prefix: 'Invalid Locale Metadata' }).message;
                }
            }
            return sendTypedResp({
                type: 'error',
                title: 'Custom Language Error',
                md: true,
                msg,
            });
        }
    }

    return { processedConfig: inputConfig };
};

/**
 * FXServer card handler
 */
const handleFxserverCard: CardHandler = async (inputConfig, sendTypedResp) => {
    if (typeof inputConfig.server?.dataPath !== 'string' || !inputConfig.server?.dataPath.length) {
        throw new Error(`Unexpected data for the 'fxserver' card.`);
    }

    //Validate and normalize server data path
    const dataPathResult = cleanFullPath(inputConfig.server.dataPath, txEnv.isWindows);
    if ('error' in dataPathResult) {
        return sendTypedResp({
            type: 'error',
            title: 'Server Data Folder Error',
            md: true,
            msg: `Invalid path: ${dataPathResult.error}`,
        });
    }
    inputConfig.server.dataPath = dataPathResult.path;

    //Validating Server Data Path
    const dataPath = inputConfig.server.dataPath;
    try {
        const isValid = await isValidServerDataPath(dataPath);
        if (!isValid) throw new Error(`unexpected isValidServerDataPath response`);
    } catch (error) {
        try {
            const potentialFix = await findPotentialServerDataPaths(dataPath);
            if (potentialFix) {
                return sendTypedResp({
                    type: 'error',
                    title: 'Server Data Folder Error',
                    md: true,
                    msg: `The path provided is not valid.\n\nDid you mean this path?\n\`${cleanPath(potentialFix)}\``,
                });
            }
        } catch (error2) {
            /* couldn't resolve alternative path suggestion */
        }
        return sendTypedResp({
            type: 'error',
            title: 'Server Data Folder Error',
            md: true,
            msg: emsg(error2),
        });
    }

    //Validating CFG Path
    let cfgPath = txConfig.server.cfgPath;
    if (inputConfig.server?.cfgPath !== undefined) {
        const res = ConfigStore.Schema.server.cfgPath.validator.safeParse(inputConfig.server.cfgPath);
        if (!res.success) {
            return sendTypedResp({
                type: 'error',
                title: 'Invalid CFG Path',
                md: true,
                msg: fromError(res.error, { prefix: null }).message,
            });
        }
        cfgPath = res.data;
    }

    try {
        cfgPath = resolveCFGFilePath(cfgPath, dataPath);
        const cfgFileStat = await fsp.stat(cfgPath);
        if (!cfgFileStat.isFile()) {
            throw new Error('The path provided is not a file');
        }
    } catch (error) {
        const likelyCfg = findLikelyCFGPath(dataPath);
        const suggestion = likelyCfg ? `\nA likely config file was found: \`${likelyCfg}\`` : '';
        return sendTypedResp({
            type: 'error',
            title: 'CFG Path Error',
            md: true,
            msg: getFsErrorMdMessage(error, cleanPath(cfgPath)) + suggestion,
        });
    }

    //Final cleanup for cfgPath (relative path, not suitable for cleanFullPath)
    if (typeof inputConfig.server?.cfgPath === 'string') {
        inputConfig.server.cfgPath = cleanPath(inputConfig.server.cfgPath);
    }

    return {
        processedConfig: inputConfig,
        successToast: {
            type: 'success',
            title: 'FXServer Settings Saved!',
            msg: 'You need to restart the server for the changes to take effect.',
        },
    };
};

/**
 * Discord card handler
 */
const handleDiscordCard: CardHandler = async (inputConfig, sendTypedResp) => {
    if (!inputConfig.discordBot) throw new Error(`Unexpected data for the 'discord' card.`);

    //Validating embed JSONs
    //NOTE: need this before checking if enabled, or while disabled one could save invalid JSON
    const shouldValidateStatusEmbed =
        typeof inputConfig.discordBot.embedJson === 'string' ||
        typeof inputConfig.discordBot.embedConfigJson === 'string';
    const shouldValidatePlayerListEmbed =
        typeof inputConfig.discordBot.playerListEmbedJson === 'string' ||
        typeof inputConfig.discordBot.playerListEmbedConfigJson === 'string';

    if (shouldValidateStatusEmbed) {
        try {
            generateStatusMessage(
                (inputConfig.discordBot.embedJson as string | undefined) ?? txConfig.discordBot.embedJson,
                (inputConfig.discordBot.embedConfigJson as string | undefined) ?? txConfig.discordBot.embedConfigJson,
            );
        } catch (error) {
            return sendTypedResp({
                type: 'error',
                title: 'Embed validation failed:',
                md: true,
                msg: emsg(error),
            });
        }
    }

    if (shouldValidatePlayerListEmbed) {
        try {
            generatePlayerListMessage(
                (inputConfig.discordBot.playerListEmbedJson as string | undefined) ??
                    txConfig.discordBot.playerListEmbedJson,
                (inputConfig.discordBot.playerListEmbedConfigJson as string | undefined) ??
                    txConfig.discordBot.playerListEmbedConfigJson,
            );
        } catch (error) {
            return sendTypedResp({
                type: 'error',
                title: 'Player list embed validation failed:',
                md: true,
                msg: emsg(error),
            });
        }
    }

    const nextEnabled =
        inputConfig.discordBot.enabled === undefined ? txConfig.discordBot.enabled : inputConfig.discordBot.enabled;
    const nextToken =
        inputConfig.discordBot.token === undefined ? txConfig.discordBot.token : inputConfig.discordBot.token;
    const nextGuild =
        inputConfig.discordBot.guild === undefined ? txConfig.discordBot.guild : inputConfig.discordBot.guild;
    const nextWarningsChannel =
        inputConfig.discordBot.warningsChannel === undefined
            ? txConfig.discordBot.warningsChannel
            : inputConfig.discordBot.warningsChannel;
    const nextLogGuildOverride =
        inputConfig.discordBot.logGuildOverride === undefined
            ? txConfig.discordBot.logGuildOverride
            : inputConfig.discordBot.logGuildOverride;

    //If bot will be disabled after this save, kill it and don't validate anything else.
    if (!nextEnabled) {
        await txCore.discordBot.attemptBotReset(false);
        return { processedConfig: inputConfig };
    }

    //Validating fields manually before trying to start the bot
    const baseError = {
        type: 'error',
        title: 'Discord Bot Error',
        md: true,
    } as const;
    const schemas = ConfigStore.Schema.discordBot;
    const validationError = getSchemaChainError([
        [schemas.enabled, nextEnabled],
        [schemas.token, nextToken],
        [schemas.guild, nextGuild],
        [schemas.warningsChannel, nextWarningsChannel],
        [schemas.logGuildOverride, nextLogGuildOverride],
    ]);
    if (validationError) {
        return sendTypedResp({
            ...baseError,
            msg: validationError,
        });
    }

    //Checking if required fields are present (frontend should have done this already)
    if (!nextToken || !nextGuild) {
        return sendTypedResp({
            ...baseError,
            msg: 'Missing required fields to enable the bot.',
        });
    }

    //Restarting discord bot
    let successMsg;
    try {
        successMsg = await txCore.discordBot.attemptBotReset({
            enabled: true,
            //They have been validated, so this is fine
            token: nextToken as any,
            guild: nextGuild as any,
            warningsChannel: nextWarningsChannel as any,
        });
    } catch (error) {
        const errorCode = (error as any).code;
        let extraContext = '';
        if (errorCode === 'DisallowedIntents' || errorCode === 4014) {
            extraContext = `**The bot requires the \`GUILD_MEMBERS\` intent.**
            - Go to the [Discord Dev Portal](https://discord.com/developers/applications)
            - Navigate to \`Bot > Privileged Gateway Intents\`.
            - Enable the \`GUILD_MEMBERS\` intent.
            - Press save on the developer portal.
            - Go to the \`sxPanel > Settings > Discord Bot\` and press save.`;
        } else if (errorCode === 'CustomNoGuild') {
            const inviteUrl =
                'clientId' in (error as any)
                    ? `https://discord.com/oauth2/authorize?client_id=${(error as any).clientId}&scope=bot&permissions=0`
                    : `https://discordapi.com/permissions.html#0`;
            extraContext = `**This usually mean one of the issues below:**
            - **Wrong server ID:** read the description of the server ID setting for more information.
            - **Bot is not in the server:** you need to [INVITE THE BOT](${inviteUrl}) to join the server.
            - **Wrong bot:** you may be using the token of another discord bot.`;
        }
        return sendTypedResp({
            ...baseError,
            title: 'Error starting the bot:',
            msg: `${emsg(error)}\n${extraContext}`.trim(),
        });
    }

    return {
        processedConfig: inputConfig,
        successToast: {
            type: 'success',
            md: true,
            title: 'FXServer Settings Saved!',
            msg: `${successMsg}\nIf _(and only if)_ the status embed is not being updated, check the \`System > Console Log\` page to look for embed errors.`,
        },
    };
};
