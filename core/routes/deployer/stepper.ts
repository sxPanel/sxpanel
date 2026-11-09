const modulename = 'WebServer:DeployerStepper';
import fsp from 'node:fs/promises';
import { txHostConfig } from '@core/globalData';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import consoleFactory from '@lib/console';
import { TxConfigState } from '@shared/enums';
const console = consoleFactory(modulename);

/**
 * Returns JSON data for the deployer stepper page
 */
export default async function DeployerStepper(ctx: AuthedCtx) {
    //Check permissions
    if (!ctx.admin.hasPermission('master')) {
        return ctx.send({ error: 'You need to be the admin master to use the deployer.' });
    }

    //Ensure the correct state for the deployer
    if (txManager.configState === TxConfigState.Setup) {
        return ctx.send({ redirect: '/server/setup' });
    } else if (txManager.configState !== TxConfigState.Deployer) {
        return ctx.send({ redirect: '/' });
    } else if (!txManager.deployer?.step) {
        throw new Error(`txManager.configState is Deployer but txManager.deployer is not defined`);
    }

    //Prepare Output
    const data: Record<string, unknown> = {
        step: txManager.deployer.step,
        deploymentID: txManager.deployer.deploymentID,
        requireDBConfig: false,
        requiresGithubToken: false,
        defaultLicenseKey: '',
        recipe: undefined,
        defaults: {},
    };

    if (txManager.deployer.step === 'review') {
        data.recipe = {
            isTrustedSource: txManager.deployer.isTrustedSource,
            name: txManager.deployer.recipe.name,
            author: txManager.deployer.recipe.author,
            description: txManager.deployer.recipe.description,
            raw: txManager.deployer.recipe.raw,
        };
    } else if (txManager.deployer.step === 'input') {
        data.defaultLicenseKey = txHostConfig.defaults.cfxKey ?? '';
        data.requireDBConfig = txManager.deployer.recipe.requireDBConfig;
        data.requiresGithubToken = txManager.deployer.recipe.requiresGithubToken ?? false;
        data.defaults = {
            autofilled: Object.values(txHostConfig.defaults).some(Boolean),
            license: txHostConfig.defaults.cfxKey ?? '',
            mysqlHost: txHostConfig.defaults.dbHost ?? 'localhost',
            mysqlPort: txHostConfig.defaults.dbPort ?? '3306',
            mysqlUser: txHostConfig.defaults.dbUser ?? 'root',
            mysqlPassword: txHostConfig.defaults.dbPass ?? '',
            mysqlDatabase: txHostConfig.defaults.dbName ?? txManager.deployer.deploymentID,
        };

        const knownVarDescriptions: Record<string, string> = {
            steam_webApiKey:
                'No longer needed, you can leave this empty: FXServer ignores Steam Web API keys since November 2026.\nSteam identifiers now come from the Steam account players link to their Cfx.re account (sv_enforceSteamAuth).',
        };
        const recipeVars = txManager.deployer.getRecipeVars();
        data.inputVars = Object.keys(recipeVars).map((name) => {
            return {
                name: name,
                value: recipeVars[name],
                description: knownVarDescriptions[name] || '',
            };
        });
    } else if (txManager.deployer.step === 'run') {
        data.deployPath = txManager.deployer.deployPath;
    } else if (txManager.deployer.step === 'configure') {
        const errorMessage = `# server.cfg Not Found!
# This probably means you deleted it before pressing "Next".
# Press cancel and start the deployer again,
# or insert here the server.cfg contents.
# (╯°□°）╯︵ ┻━┻`;
        try {
            data.serverCFG = await fsp.readFile(`${txManager.deployer.deployPath}/server.cfg`, 'utf8');
            if (data.serverCFG == '#save_attempt_please_ignore' || !(data.serverCFG as string).length) {
                data.serverCFG = errorMessage;
            } else if ((data.serverCFG as string).length > 10240) {
                data.serverCFG = `# This recipe created a ./server.cfg above 10kb, meaning its probably the wrong data. 
Make sure everything is correct in the recipe and try again.`;
            }
        } catch (error) {
            console.verbose.dir(error);
            data.serverCFG = errorMessage;
        }
    } else {
        return ctx.send({ error: 'Unknown Deployer step, please report this bug and restart sxPanel.' });
    }

    return ctx.send(data);
}
