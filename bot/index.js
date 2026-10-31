const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const bridge = require('./bridge');
const {
    createAddonRuntimeState,
    resetAddonRuntimeRegistries,
    registerAddonCommandModule,
    getAddonCommandMetadata,
    resolveAddonInteractionHandler,
    consumeAddonRateLimit,
    recordAddonRuntimeIssue,
} = require('./addonRuntime');

const commandsRoot = path.join(__dirname, 'commands');
const eventsRoot = path.join(__dirname, 'events');
const supportedScriptExtensions = new Set(['.js', '.cjs', '.mjs']);

let fatalExitScheduled = false;

const scheduleFatalExit = (message, error) => {
    if (error) {
        console.error(message, error);
    } else {
        console.error(message);
    }

    if (fatalExitScheduled) return;
    fatalExitScheduled = true;
    setTimeout(() => process.exit(1), 100);
};

const setupProcessHandlers = () => {
    process.stdin.on('error', () => {});
    process.stdout.on('error', () => {});
    process.stderr.on('error', () => {});
    Error.stackTraceLimit = 25;

    process.on('unhandledRejection', (error) => {
        scheduleFatalExit('[Bot] Unhandled promise rejection. Restarting bot process.', error);
    });
    process.on('uncaughtException', (error) => {
        scheduleFatalExit('[Bot] Uncaught exception. Restarting bot process.', error);
    });
};

setupProcessHandlers();

const getAllFiles = (dirPath) => {
    if (!fs.existsSync(dirPath)) return [];

    const files = [];
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...getAllFiles(fullPath));
            continue;
        }
        if (entry.isFile() && supportedScriptExtensions.has(path.extname(fullPath))) {
            files.push(fullPath);
        }
    }

    return files.sort();
};

const isCustomCommandFile = (filePath) => {
    return filePath.includes(`${path.sep}commands${path.sep}custom${path.sep}`);
};

const isAddonModuleFile = (filePath) => {
    return filePath.includes(`${path.sep}addons${path.sep}`);
};

const normalizeLoadedModule = (loadedModule) => {
    if (loadedModule && typeof loadedModule === 'object' && 'default' in loadedModule && loadedModule.default) {
        return loadedModule.default;
    }

    return loadedModule;
};

const loadModule = async (filePath, { bustCache = false } = {}) => {
    if (isAddonModuleFile(filePath)) {
        const moduleUrl = pathToFileURL(filePath).href;
        const loadedModule = await import(bustCache ? `${moduleUrl}?update=${Date.now()}` : moduleUrl);
        return normalizeLoadedModule(loadedModule);
    }

    if (bustCache) {
        delete require.cache[require.resolve(filePath)];
    }

    return normalizeLoadedModule(require(filePath));
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
});

client.on('error', (error) => {
    console.error('[Bot] Discord client error:', error);
});
client.on('warn', (message) => {
    console.warn(`[Bot] Discord client warning: ${message}`);
});
client.on('shardError', (error, shardId) => {
    console.error(`[Bot] Discord shard ${shardId} error:`, error);
});
client.on('shardDisconnect', (event, shardId) => {
    const closeCode = typeof event?.code === 'number' ? event.code : 'unknown';
    console.warn(`[Bot] Discord shard ${shardId} disconnected with code ${closeCode}.`);
});
client.on('shardReconnecting', (shardId) => {
    console.warn(`[Bot] Discord shard ${shardId} reconnecting.`);
});
client.on('shardResume', (shardId, replayedEvents) => {
    console.log(`[Bot] Discord shard ${shardId} resumed after replaying ${replayedEvents} events.`);
});
client.on('invalidated', () => {
    scheduleFatalExit('[Bot] Discord session invalidated. Restarting bot process.');
});

const collectAddonRoots = (key) => {
    const addons = client.sxpanel.latestConfigSnapshot?.discordBotAddons;
    if (!Array.isArray(addons)) return [];

    return [
        ...new Set(
            addons
                .map((addon) => (addon && typeof addon === 'object' ? addon[key] : null))
                .filter((entryPath) => typeof entryPath === 'string'),
        ),
    ];
};

const resolveAddonDescriptorForFile = (filePath) => {
    const addons = client.sxpanel.latestConfigSnapshot?.discordBotAddons;
    if (!Array.isArray(addons)) return null;

    for (const addon of addons) {
        if (!addon || typeof addon !== 'object') continue;

        for (const key of ['commandsPath', 'eventsPath']) {
            const rootPath = addon[key];
            if (typeof rootPath !== 'string' || !rootPath.length) continue;
            if (filePath === rootPath || filePath.startsWith(rootPath + path.sep)) {
                return addon;
            }
        }
    }

    return null;
};

const resolveAddonIdForFile = (filePath) => {
    return typeof resolveAddonDescriptorForFile(filePath)?.id === 'string'
        ? resolveAddonDescriptorForFile(filePath).id
        : null;
};

const pushRuntimeDiagnostics = () => {
    const failures = [...client.sxpanel.addonLoadFailures.command, ...client.sxpanel.addonLoadFailures.event];

    bridge.send({
        type: 'botDiagnostics',
        payload: {
            addonLoadFailures: failures,
            addonRuntimeIssues: client.sxpanel.addonRuntime.runtimeIssues,
            updatedAt: Date.now(),
        },
    });
};

const setAddonLoadFailures = (kind, failures) => {
    client.sxpanel.addonLoadFailures[kind] = failures;
    pushRuntimeDiagnostics();
};

const loadCommandFiles = async (
    filePaths,
    target,
    { shouldBustCache = () => false, tolerateErrors = false } = {},
) => {
    const failures = [];

    for (const filePath of filePaths) {
        try {
            const command = await loadModule(filePath, { bustCache: shouldBustCache(filePath) });
            if (!command?.data?.name || typeof command.execute !== 'function') continue;

            const addonDescriptor = isAddonModuleFile(filePath) ? resolveAddonDescriptorForFile(filePath) : null;

            if (target.has(command.data.name)) {
                console.warn(`[Bot] Skipping duplicate command /${command.data.name} from ${filePath}`);
                continue;
            }

            target.set(command.data.name, command);
            if (addonDescriptor?.id) {
                registerAddonCommandModule(client.sxpanel.addonRuntime, {
                    addonId: addonDescriptor.id,
                    addonRateLimit: addonDescriptor.rateLimit ?? null,
                    commandName: command.data.name,
                    filePath,
                    command,
                });
            }
        } catch (error) {
            if (!tolerateErrors) throw error;
            console.error(`[Bot] Failed to load addon command ${filePath}:`, error);
            failures.push({
                kind: 'command',
                filePath,
                message: error instanceof Error ? error.message : String(error),
                addonId: resolveAddonIdForFile(filePath),
                updatedAt: Date.now(),
            });
        }
    }

    if (tolerateErrors) {
        setAddonLoadFailures('command', failures);
    }
};

const createEventListener = (event) => {
    let fired = false;

    const listener = async (...args) => {
        if (event.once && fired) return;
        fired = true;

        try {
            await event.execute(...args, client, bridge);
        } catch (error) {
            console.error(`[Bot] Failed to execute ${event.name} event:`, error);
        } finally {
            if (event.once) {
                client.off(event.name, listener);
            }
        }
    };

    return listener;
};

const loadEventFiles = async (
    filePaths,
    { shouldBustCache = () => false, tolerateErrors = false, trackAddon = false } = {},
) => {
    const failures = [];

    for (const filePath of filePaths) {
        try {
            const event = await loadModule(filePath, { bustCache: shouldBustCache(filePath) });
            if (!event?.name || typeof event.execute !== 'function') continue;

            const listener = createEventListener(event);
            client.on(event.name, listener);
            if (trackAddon) {
                client.sxpanel.addonEventBindings.push({ name: event.name, listener });
            }

            if ((event.name === 'ready' || event.name === 'clientReady') && client.isReady()) {
                void listener();
            }
        } catch (error) {
            if (!tolerateErrors) throw error;
            console.error(`[Bot] Failed to load addon event ${filePath}:`, error);
            failures.push({
                kind: 'event',
                filePath,
                message: error instanceof Error ? error.message : String(error),
                addonId: resolveAddonIdForFile(filePath),
                updatedAt: Date.now(),
            });
        }
    }

    if (tolerateErrors) {
        setAddonLoadFailures('event', failures);
    }
};

const loadBaseEvents = async () => {
    await loadEventFiles(getAllFiles(eventsRoot));
};

client.commands = new Collection();
let commandLoadQueue = Promise.resolve();

const runLoadCommands = async ({ clearCustomCache = false, clearAddonCache = false } = {}) => {
    resetAddonRuntimeRegistries(client.sxpanel.addonRuntime);

    //Build into a fresh collection and swap, so commands never disappear mid-reload
    const nextCommands = new Collection();
    await loadCommandFiles(getAllFiles(commandsRoot), nextCommands, {
        shouldBustCache: (filePath) => clearCustomCache && isCustomCommandFile(filePath),
    });

    const addonCommandFiles = collectAddonRoots('commandsPath').flatMap((rootPath) => getAllFiles(rootPath));
    await loadCommandFiles(addonCommandFiles, nextCommands, {
        shouldBustCache: () => clearAddonCache,
        tolerateErrors: true,
    });

    client.commands = nextCommands;
    return client.commands;
};

client.sxpanel = {
    latestConfigSnapshot: null,
    addonEventBindings: [],
    addonRuntime: createAddonRuntimeState(),
    addonLoadFailures: {
        command: [],
        event: [],
    },
    getAddonCommandMetadata(commandName) {
        return getAddonCommandMetadata(client.sxpanel.addonRuntime, commandName);
    },
    resolveAddonInteraction(customId) {
        return resolveAddonInteractionHandler(client.sxpanel.addonRuntime, customId);
    },
    consumeAddonRateLimit(options) {
        return consumeAddonRateLimit(client.sxpanel.addonRuntime, options);
    },
    recordAddonRuntimeIssue(issue) {
        const recordedIssue = recordAddonRuntimeIssue(client.sxpanel.addonRuntime, issue);
        if (recordedIssue) {
            pushRuntimeDiagnostics();
        }
        return recordedIssue;
    },
    //Serialized: overlapping loads (ready event + panel reloadCommands) used to interleave at
    //each await and flag each other's commands as duplicates.
    loadCommands: (options = {}) => {
        const run = commandLoadQueue.then(() => runLoadCommands(options));
        commandLoadQueue = run.catch(() => {});
        return run;
    },
    reloadAddonEvents: async ({ clearAddonCache = false } = {}) => {
        for (const binding of client.sxpanel.addonEventBindings) {
            client.off(binding.name, binding.listener);
        }
        client.sxpanel.addonEventBindings = [];

        const addonEventFiles = collectAddonRoots('eventsPath').flatMap((rootPath) => getAllFiles(rootPath));
        await loadEventFiles(addonEventFiles, {
            shouldBustCache: () => clearAddonCache,
            tolerateErrors: true,
            trackAddon: true,
        });
    },
    reloadAddonModules: async ({ clearCustomCache = false, clearAddonCache = false } = {}) => {
        await client.sxpanel.loadCommands({ clearCustomCache, clearAddonCache });
        await client.sxpanel.reloadAddonEvents({ clearAddonCache });
        pushRuntimeDiagnostics();
    },
    registerCommands: async (guildId) => {
        if (!client.application) return;

        const reportsEnabled = client.sxpanel.latestConfigSnapshot?.gameFeatures?.reportsEnabled !== false;

        const commandPayload = [...client.commands.values()]
            .map((command) => {
                if (!command?.data) return null;
                const json = typeof command.data.toJSON === 'function' ? command.data.toJSON() : command.data;
                if (!reportsEnabled && json?.name === 'reports') return null;
                return json;
            })
            .filter(Boolean);

        if (guildId) {
            const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
            if (guild) {
                await guild.commands.set(commandPayload);
                return;
            }
        }

        await client.application.commands.set(commandPayload);
    },
};
client.fxpanel = client.sxpanel;

const start = async () => {
    await client.sxpanel.loadCommands();
    await loadBaseEvents();
    bridge.connect(client);
    await client.login(process.env.BOT_TOKEN);
};

start().catch((error) => {
    console.error('[Bot] Failed to login:', error);
    bridge.send({
        type: 'botStatus',
        status: 'error',
        code: error?.message === 'Used disallowed intents' ? 'DisallowedIntents' : error?.code,
        message: error instanceof Error ? error.message : String(error),
    });
    setTimeout(() => process.exit(1), 100);
});
