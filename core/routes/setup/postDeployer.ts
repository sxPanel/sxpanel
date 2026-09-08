const modulename = 'WebServer:SetupPost:Deployer';
import path from 'node:path';
import slash from 'slash';
import consoleFactory from '@lib/console';
import got from '@lib/got';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { assertSafeRemoteRecipeUrl } from '@lib/remoteRecipeDownloadUrl';
const console = consoleFactory(modulename);

/**
 * Handle Save settings for remote recipe importing (popular & remote types)
 * Actions: download recipe, starts deployer
 */
export async function handleSaveDeployerImport(ctx: AuthedCtx) {
    if (
        typeof ctx.request.body.name !== 'string' ||
        (typeof ctx.request.body.isTrustedSource !== 'string' &&
            typeof ctx.request.body.isTrustedSource !== 'boolean') ||
        typeof ctx.request.body.recipeURL !== 'string' ||
        typeof ctx.request.body.targetPath !== 'string' ||
        typeof ctx.request.body.deploymentID !== 'string'
    ) {
        return ctx.utils.error(400, 'Invalid Request - missing parameters');
    }
    const isTrustedSource = ctx.request.body.isTrustedSource === true || ctx.request.body.isTrustedSource === 'true';
    const serverName = ctx.request.body.name.trim();
    const recipeURL = ctx.request.body.recipeURL.trim();
    const targetPath = slash(path.normalize(ctx.request.body.targetPath + '/'));
    const deploymentID = ctx.request.body.deploymentID;

    //Get recipe
    let recipeText;
    try {
        const safeUrl = assertSafeRemoteRecipeUrl(recipeURL);
        recipeText = await got
            .get(safeUrl, {
                timeout: { request: 4500 },
            })
            .text();
        if (typeof recipeText !== 'string') throw new Error('This URL did not return a string.');
    } catch (error) {
        return ctx.send({ success: false, message: `Recipe download error: ${(error as Error).message}` });
    }

    //Preparing & saving config
    try {
        txCore.configStore.saveConfigs(
            {
                general: { serverName },
            },
            ctx.admin.name,
        );
    } catch (error) {
        console.warn(`[${ctx.admin.name}] Error changing global settings via setup stepper.`);
        console.verbose.dir(error);
        return ctx.send({
            type: 'danger',
            markdown: true,
            message: `**Error saving the configuration file:** ${(error as Error).message}`,
        });
    }
    ctx.admin.logAction('Changing global settings via setup stepper and started Deployer.', 'setup.deployer.import');

    //Start deployer (constructor will validate the recipe)
    try {
        txManager.startDeployer(recipeText, deploymentID, targetPath, isTrustedSource, { serverName });
        txCore.webServer.webSocket.pushRefresh('status');
    } catch (error) {
        return ctx.send({ success: false, message: (error as Error).message });
    }
    return ctx.send({ success: true });
}

/**
 * Handle Save settings for custom recipe
 * Actions: starts deployer with a blank recipe template
 */
export async function handleSaveDeployerCustom(ctx: AuthedCtx) {
    if (
        typeof ctx.request.body.name !== 'string' ||
        typeof ctx.request.body.targetPath !== 'string' ||
        typeof ctx.request.body.deploymentID !== 'string'
    ) {
        return ctx.utils.error(400, 'Invalid Request - missing parameters');
    }
    const serverName = ctx.request.body.name.trim();
    const targetPath = slash(path.normalize(ctx.request.body.targetPath + '/'));
    const deploymentID = ctx.request.body.deploymentID;

    //Preparing & saving config
    try {
        txCore.configStore.saveConfigs(
            {
                general: { serverName },
            },
            ctx.admin.name,
        );
    } catch (error) {
        console.warn(`[${ctx.admin.name}] Error changing global settings via setup stepper.`);
        console.verbose.dir(error);
        return ctx.send({
            type: 'danger',
            markdown: true,
            message: `**Error saving the configuration file:** ${(error as Error).message}`,
        });
    }
    ctx.admin.logAction('Changing global settings via setup stepper and started Deployer.', 'setup.deployer.custom');

    //Start deployer (constructor will create the recipe template)
    const customMetaData = {
        author: ctx.admin.name,
        serverName,
    };
    try {
        txManager.startDeployer(false, deploymentID, targetPath, false, customMetaData);
        txCore.webServer.webSocket.pushRefresh('status');
    } catch (error) {
        return ctx.send({ success: false, message: (error as Error).message });
    }
    return ctx.send({ success: true });
}
