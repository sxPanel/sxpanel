const modulename = 'Deployer';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import open from 'open';
import getOsDistro from '@lib/host/getOsDistro.js';
import recipeEngine from './recipeEngine';
import { outputFile } from '@lib/fs';
import consoleFactory from '@lib/console';
import recipeParser from './recipeParser';
import { getTimeHms } from '@lib/misc';
import { ensureSteamAuthEnforced, makeTemplateRecipe } from './utils';
import { RECIPE_DEPLOYER_VERSION } from './consts';
import type { DeployerStep, DeployerContext, ParsedRecipe, RecipeEngineMap } from './recipeTypes';
const console = consoleFactory(modulename);

const typedEngine = recipeEngine as RecipeEngineMap;

//Constants
export { RECIPE_DEPLOYER_VERSION };

type DeployerMetaData = {
    serverName?: string;
    author?: string;
    fxsVersion?: number;
    txaVersion?: string;
};

/**
 * The deployer class is responsible for running the recipe and handling status and errors
 */
export class Deployer {
    step: DeployerStep;
    deployFailed: boolean;
    deployPath: string;
    isTrustedSource: boolean;
    originalRecipe: string | false;
    recipe: ParsedRecipe;
    deploymentID: string;
    progress: number;
    serverName: string;
    fxsVersion: number | undefined;
    txaVersion: string;
    logLines: string[];

    constructor(
        originalRecipe: string | false,
        deploymentID: string,
        deployPath: string,
        isTrustedSource: boolean,
        customMetaData: DeployerMetaData = {},
    ) {
        console.log('Deployer instance ready.');

        this.step = 'review';
        this.deployFailed = false;
        this.deployPath = deployPath;
        this.isTrustedSource = isTrustedSource;
        this.originalRecipe = originalRecipe;
        this.deploymentID = deploymentID;
        this.progress = 0;
        this.serverName =
            customMetaData.serverName || (typeof txConfig !== 'undefined' ? txConfig.general.serverName : '') || '';
        this.fxsVersion = customMetaData.fxsVersion;
        this.txaVersion = customMetaData.txaVersion ?? 'unknown';
        this.logLines = [];

        //Load recipe
        const impRecipe =
            originalRecipe !== false
                ? originalRecipe
                : makeTemplateRecipe(customMetaData.serverName ?? '', customMetaData.author ?? '');
        try {
            this.recipe = recipeParser(impRecipe, this.fxsVersion);
        } catch (error) {
            console.verbose.dir(error);
            throw new Error(`Recipe Error: ${emsg(error)}`);
        }
    }

    //Logging helpers
    customLog(str: string) {
        this.logLines.push(`[${getTimeHms()}] ${str}`);
        console.log(str);
    }

    customLogError(str: string) {
        this.logLines.push(`[${getTimeHms()}] ${str}`);
        console.error(str);
    }

    getDeployerLog() {
        return this.logLines.join('\n');
    }

    /**
     * Confirms the recipe and goes to the input stage
     */
    async confirmRecipe(userRecipe: string) {
        if (this.step !== 'review') throw new Error('expected review step');

        try {
            this.recipe = recipeParser(userRecipe, this.fxsVersion);
        } catch (error) {
            throw new Error(`Cannot start() deployer due to a Recipe Error: ${emsg(error)}`);
        }

        try {
            await fsp.mkdir(this.deployPath, { recursive: true });
        } catch (error) {
            console.verbose.dir(error);
            throw new Error(`Failed to create ${this.deployPath} with error: ${emsg(error)}`);
        }

        this.step = 'input';
    }

    /**
     * Returns the recipe variables for the deployer run step
     */
    getRecipeVars() {
        if (this.step !== 'input') throw new Error('expected input step');
        return { ...this.recipe.variables };
    }

    /**
     * Goes back one step in the deployer process
     */
    goBack() {
        if (this.step === 'input') {
            this.step = 'review';
        } else if (this.step === 'run' && this.deployFailed) {
            this.deployFailed = false;
            this.progress = 0;
            this.logLines = [];
            this.step = 'input';
        } else if (this.step === 'configure') {
            this.step = 'input';
        } else {
            throw new Error('Cannot go back from this step.');
        }
    }

    /**
     * Starts the deployment process
     */
    start(userInputs: Record<string, string>) {
        if (this.step !== 'input') throw new Error('expected input step');
        Object.assign(this.recipe.variables, userInputs);
        this.logLines = [];
        this.customLog(`Starting deployment of ${this.recipe.name}.`);
        this.deployFailed = false;
        this.progress = 0;
        this.step = 'run';
        this.runTasks();
    }

    /**
     * Marks the deploy as failed
     */
    async markFailedDeploy() {
        this.deployFailed = true;
        try {
            const filePath = path.join(this.deployPath, '_DEPLOY_FAILED_DO_NOT_USE');
            await outputFile(filePath, 'This deploy has failed, please do not use these files.');
        } catch (error) {
            /* deploy is already marked failed */
        }
    }

    async runTasks() {
        if (this.step !== 'run') throw new Error('expected run step');
        const ctx: DeployerContext = {
            ...this.recipe.variables,
            $step: '',
            deploymentID: this.deploymentID,
            serverName: this.serverName,
            recipeName: this.recipe.name,
            recipeAuthor: this.recipe.author,
            recipeDescription: this.recipe.description,
        };

        //Set GitHub token from user input or env var
        const githubToken = this.recipe.variables.githubToken || process.env.TXADMIN_GITHUB_TOKEN || undefined;
        if (githubToken) {
            ctx.$githubToken = githubToken;
            delete ctx.githubToken; //don't expose as a template var
        }

        //Run all the tasks
        for (const [index, task] of this.recipe.tasks.entries()) {
            this.progress = Math.round((index / this.recipe.tasks.length) * 100);
            const taskID = `[task${index + 1}:${task.action}]`;
            this.customLog(`Running ${taskID}...`);
            const taskTimeoutSeconds = task.timeoutSeconds ?? typedEngine[task.action].timeoutSeconds;

            try {
                ctx.$step = `loading task ${task.action}`;
                let timer: ReturnType<typeof setTimeout>;
                const t0 = Date.now();
                await Promise.race([
                    typedEngine[task.action].run(task, this.deployPath, ctx),
                    new Promise<never>((_resolve, reject) => {
                        timer = setTimeout(() => {
                            reject(new Error(`timed out after ${taskTimeoutSeconds}s.`));
                        }, taskTimeoutSeconds * 1000);
                    }),
                ]).finally(() => clearTimeout(timer!));
                this.logLines[this.logLines.length - 1] += ` ✔️ (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
            } catch (error) {
                this.logLines[this.logLines.length - 1] += ' ❌';
                let msg = `Task Failed: ${emsg(error)}\n` + 'Options: \n' + JSON.stringify(task, null, 2);
                if (ctx.$step) {
                    msg += '\nDebug/Status: ' + JSON.stringify([this.txaVersion, await getOsDistro(), ctx.$step]);
                }
                this.customLogError(msg);
                return await this.markFailedDeploy();
            }
        }

        //Set progress
        this.progress = 100;
        this.customLog('All tasks completed.');

        //Check deploy folder validity (resources + server.cfg)
        try {
            if (!fs.existsSync(path.join(this.deployPath, 'resources'))) {
                throw new Error("this recipe didn't create a 'resources' folder.");
            } else if (!fs.existsSync(path.join(this.deployPath, 'server.cfg'))) {
                throw new Error("this recipe didn't create a 'server.cfg' file.");
            }
        } catch (error) {
            this.customLogError(`Deploy validation error: ${emsg(error)}`);
            return await this.markFailedDeploy();
        }

        //Replace all vars in the server.cfg
        try {
            const task = {
                action: 'replace_string',
                mode: 'all_vars',
                file: './server.cfg',
            };
            await typedEngine['replace_string'].run(task, this.deployPath, ctx);
            this.customLog('Replacing all vars in server.cfg... ✔️');
        } catch (error) {
            this.customLogError(`Failed to replace all vars in server.cfg: ${emsg(error)}`);
            return await this.markFailedDeploy();
        }

        //Recipes that require Steam identifiers must enforce the linked Steam account
        if (this.recipe.steamRequired) {
            try {
                const cfgPath = path.join(this.deployPath, 'server.cfg');
                const original = await fsp.readFile(cfgPath, 'utf8');
                const changed = ensureSteamAuthEnforced(original);
                if (changed !== original) {
                    await fsp.writeFile(cfgPath, changed);
                    this.customLog('Setting sv_enforceSteamAuth in server.cfg... ✔️');
                }
            } catch (error) {
                this.customLogError(`Failed to set sv_enforceSteamAuth in server.cfg: ${emsg(error)}`);
                return await this.markFailedDeploy();
            }
        }

        //Success
        this.customLog('Deploy finished and folder validated. All done!');
        this.step = 'configure';
        if (os.platform() === 'win32') {
            try {
                await open(path.normalize(this.deployPath), { app: 'explorer' });
            } catch (error) {
                /* optional: open folder in explorer */
            }
        }
    }
}
