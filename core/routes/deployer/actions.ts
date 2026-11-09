const modulename = 'WebServer:DeployerActions';
import path from 'node:path';
import slash from 'slash';
import mysql from 'mysql2/promise';
import consts from '@shared/consts';
import { txEnv, txHostConfig } from '@core/globalData';
import { validateModifyServerConfig } from '@lib/fxserver/fxsConfigHelper';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import consoleFactory from '@lib/console';
import { SYM_RESET_CONFIG } from '@lib/symbols';
const console = consoleFactory(modulename);

//Helper functions
const isUndefined = (x: unknown): x is undefined => x === undefined;

/**
 * Handle all the server control actions
 */
export default async function DeployerActions(ctx: AuthedCtx) {
    //Sanity check
    if (isUndefined(ctx.params.action)) {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const action = ctx.params.action as string;

    //Check permissions
    if (!ctx.admin.testPermission('master', modulename)) {
        return ctx.send({ success: false, refresh: true });
    }

    //Check if this is the correct state for the deployer
    if (txManager.deployer == null) {
        return ctx.send({ success: false, refresh: true });
    }

    //Delegate to the specific action functions
    if (action == 'confirmRecipe') {
        return await handleConfirmRecipe(ctx);
    } else if (action == 'setVariables') {
        return await handleSetVariables(ctx);
    } else if (action == 'commit') {
        return await handleSaveConfig(ctx);
    } else if (action == 'cancel') {
        return await handleCancel(ctx);
    } else if (action == 'goBack') {
        return await handleGoBack(ctx);
    } else {
        return ctx.send({
            type: 'danger',
            message: 'Unknown setup action.',
        });
    }
}

//================================================================
/**
 * Handle submition of user-edited recipe (record to deployer, starts the process)
 */
async function handleConfirmRecipe(ctx: AuthedCtx) {
    //Sanity check
    if (isUndefined(ctx.request.body.recipe)) {
        return ctx.utils.error(400, 'Invalid Request - missing parameters');
    }
    const userEditedRecipe = ctx.request.body.recipe as string;

    try {
        ctx.admin.logAction('Setting recipe.', 'deployer.recipe.set');
        await txManager.deployer!.confirmRecipe(userEditedRecipe);
    } catch (error) {
        return ctx.send({ type: 'danger', message: emsg(error) });
    }

    return ctx.send({ success: true });
}

//================================================================
/**
 * Handle submition of the input variables/parameters
 */
async function handleSetVariables(ctx: AuthedCtx) {
    //Sanity check
    if (isUndefined(ctx.request.body.svLicense)) {
        return ctx.utils.error(400, 'Invalid Request - missing parameters');
    }
    const userVars: Record<string, any> = structuredClone(ctx.request.body);

    //Validating sv_licenseKey
    if (!consts.regexSvLicenseNew.test(userVars.svLicense) && !consts.regexSvLicenseOld.test(userVars.svLicense)) {
        return ctx.send({ type: 'danger', message: 'The Server License does not appear to be valid.' });
    }

    //NOTE: recipes with $steamRequired used to demand a valid steam_webApiKey here, but FXServer ignores
    // that convar since 2026-11-04. The deployer now sets sv_enforceSteamAuth in the server.cfg instead.

    //DB Stuff
    if (typeof userVars.dbDelete !== 'undefined') {
        //Testing the db config
        try {
            userVars.dbPort = parseInt(userVars.dbPort);
            if (isNaN(userVars.dbPort)) {
                return ctx.send({
                    type: 'danger',
                    message: 'The database port is invalid (non-integer). The default is 3306.',
                });
            }

            const mysqlOptions = {
                host: userVars.dbHost,
                port: userVars.dbPort,
                user: userVars.dbUsername,
                password: userVars.dbPassword,
                connectTimeout: 5000,
            };
            const conn = await mysql.createConnection(mysqlOptions);
            await conn.end();
        } catch (error: any) {
            let outMessage = error?.message ?? 'Unknown error occurred.';
            if (error?.code === 'ECONNREFUSED') {
                let specificError = txEnv.isWindows
                    ? 'If you do not have a database installed, you can download and run XAMPP.'
                    : 'If you do not have a database installed, you must download and run MySQL or MariaDB.';
                if (userVars.dbPort !== 3306) {
                    specificError +=
                        '<br>\n<b>You are not using the default DB port 3306, make sure it is correct!</b>';
                }
                outMessage = `${error?.message}<br>\n${specificError}`;
            } else if (error.message?.includes('auth_gssapi_client')) {
                outMessage = `Your database does not accept the required authentication method. Please update your MySQL/MariaDB server and try again.`;
            }

            return ctx.send({ type: 'danger', message: `<b>Database connection failed:</b> ${outMessage}` });
        }

        //Setting connection string
        userVars.dbDelete = userVars.dbDelete === 'true';
        const dbFullHost = userVars.dbPort === 3306 ? userVars.dbHost : `${userVars.dbHost}:${userVars.dbPort}`;
        userVars.dbConnectionString = userVars.dbPassword.length
            ? `mysql://${userVars.dbUsername}:${userVars.dbPassword}@${dbFullHost}/${userVars.dbName}?charset=utf8mb4`
            : `mysql://${userVars.dbUsername}@${dbFullHost}/${userVars.dbName}?charset=utf8mb4`;
    }

    //Max Clients & Server Endpoints
    userVars.maxClients = txHostConfig.forceMaxClients ? txHostConfig.forceMaxClients : 48;
    if (txHostConfig.netInterface || txHostConfig.fxsPort) {
        const comment = `# ${txHostConfig.sourceName}: do not modify!`;
        const endpointIface = txHostConfig.netInterface ?? '0.0.0.0';
        const endpointPort = txHostConfig.fxsPort ?? 30120;
        userVars.serverEndpoints = [
            `endpoint_add_tcp "${endpointIface}:${endpointPort}" ${comment}`,
            `endpoint_add_udp "${endpointIface}:${endpointPort}" ${comment}`,
        ].join('\n');
    } else {
        userVars.serverEndpoints = ['endpoint_add_tcp "0.0.0.0:30120"', 'endpoint_add_udp "0.0.0.0:30120"'].join('\n');
    }

    //Setting identifiers array
    const admin = txCore.adminStore.getAdminByName(ctx.admin.name);
    if (!admin) return ctx.send({ type: 'danger', message: 'Admin not found.' });
    const addPrincipalLines: string[] = [];
    if (admin.providers.citizenfx?.identifier) {
        addPrincipalLines.push(
            `add_principal identifier.${admin.providers.citizenfx.identifier} group.admin #${ctx.admin.name}`,
        );
    }
    if (admin.providers.discord?.identifier) {
        addPrincipalLines.push(
            `add_principal identifier.${admin.providers.discord.identifier} group.admin #${ctx.admin.name}`,
        );
    }
    userVars.addPrincipalsMaster = addPrincipalLines.length
        ? addPrincipalLines.join('\n')
        : '# Deployer Note: this admin master has no identifiers to be automatically added.\n# add_principal identifier.discord:111111111111111111 group.admin #example';

    //Start deployer
    try {
        ctx.admin.logAction('Running recipe.', 'deployer.recipe.run');
        txManager.deployer!.start(userVars);
    } catch (error) {
        return ctx.send({ type: 'danger', message: emsg(error) });
    }

    return ctx.send({ success: true });
}

//================================================================
/**
 * Handle the commit of a Recipe by receiving the user edited server.cfg
 */
async function handleSaveConfig(ctx: AuthedCtx) {
    //Sanity check
    if (isUndefined(ctx.request.body.serverCFG)) {
        return ctx.utils.error(400, 'Invalid Request - missing parameters');
    }
    const serverCFG = ctx.request.body.serverCFG as string;
    const cfgFilePath = path.join(txManager.deployer!.deployPath, 'server.cfg');
    txCore.cacheStore.set('deployer:recipe', txManager.deployer?.recipe?.name ?? 'unknown');

    //Validating config contents + saving file and backup
    try {
        const result = await validateModifyServerConfig(serverCFG, cfgFilePath, txManager.deployer!.deployPath);
        if (result.errors) {
            return ctx.send({
                type: 'error',
                success: false,
                markdown: true,
                message: `**Cannot save \`server.cfg\` due to error(s) in your config file(s):**\n${result.errors}`,
            });
        }
    } catch (error) {
        return ctx.send({
            type: 'error',
            success: false,
            markdown: true,
            message: `**Failed to save \`server.cfg\` with error:**\n${emsg(error)}`,
        });
    }

    //Preparing & saving config
    type OnesyncValue = 'on' | 'legacy' | 'off' | typeof SYM_RESET_CONFIG;
    const recipeOnesync = txManager.deployer?.recipe?.onesync;
    const onesync: OnesyncValue =
        typeof recipeOnesync === 'string' && recipeOnesync.length
            ? (recipeOnesync as 'on' | 'legacy' | 'off')
            : SYM_RESET_CONFIG;
    try {
        txCore.configStore.saveConfigs(
            {
                server: {
                    dataPath: slash(path.normalize(txManager.deployer!.deployPath)),
                    cfgPath: 'server.cfg',
                    onesync,
                },
            },
            ctx.admin.name,
        );
    } catch (error) {
        console.warn(`[${ctx.admin.name}] Error changing fxserver settings via deployer.`);
        console.verbose.dir(error);
        return ctx.send({
            type: 'danger',
            markdown: true,
            message: `**Error saving the configuration file:** ${emsg(error)}`,
        });
    }

    ctx.admin.logAction('Completed and committed server deploy.', 'deployer.commit');

    //If running (for some reason), kill it first
    if (!txCore.fxRunner.isIdle) {
        ctx.admin.logCommand('STOP SERVER', 'server.stop');
        await txCore.fxRunner.killServer('new server deployed', ctx.admin.name, true);
    }

    //Starting server
    const spawnResult = await txCore.fxRunner.spawnServer(false);
    if (!spawnResult.success) {
        return ctx.send({
            type: 'danger',
            markdown: true,
            message: `Config file saved, but failed to start server with error:\n${spawnResult.error}`,
        });
    } else {
        txManager.deployer = null;
        txCore.webServer.webSocket.pushRefresh('status');
        return ctx.send({ success: true });
    }
}

//================================================================
/**
 * Handle going back one step in the deployer
 */
async function handleGoBack(ctx: AuthedCtx) {
    try {
        txManager.deployer!.goBack();
    } catch (error) {
        return ctx.send({ type: 'danger', message: emsg(error) });
    }
    return ctx.send({ success: true });
}

//================================================================
/**
 * Handle the cancellation of the deployer progress
 */
async function handleCancel(ctx: AuthedCtx) {
    txManager.deployer = null;
    txCore.webServer.webSocket.pushRefresh('status');
    return ctx.send({ success: true });
}
