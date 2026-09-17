export const SystemLogCategories = ['action', 'command', 'config', 'login', 'monitor', 'scheduler', 'system'] as const;
export type SystemLogCategory = (typeof SystemLogCategories)[number];

const configChangeLogFieldDefinitions = [
    ['appearance.customThemes', 'Custom Themes'],
    ['general.serverName', 'Server Name'],
    ['general.language', 'Language'],
    ['general.hideFxsUpdateNotification', 'Hide FxServer Update Notification'],
    ['general.allowSelfIdentifierEdit', 'Allow Self Identifier Edit'],
    ['general.enableTelemetry', 'Enable Anonymous Telemetry'],
    ['server.dataPath', 'Server Data Path'],
    ['server.cfgPath', 'CFG File Path'],
    ['server.startupArgs', 'Startup Arguments'],
    ['server.onesync', 'OneSync'],
    ['server.autoStart', 'Autostart'],
    ['server.quiet', 'Quiet Mode'],
    ['server.shutdownNoticeDelayMs', 'Shutdown Notice Delay'],
    ['server.restartSpawnDelayMs', 'Restart Spawn Delay'],
    ['restarter.schedule', 'Restart Schedule'],
    ['restarter.bootGracePeriod', 'Boot Grace Period'],
    ['restarter.resourceStartingTolerance', 'Resource Starting Tolerance'],
    ['restarter.intervalHours', 'Restart Interval (Hours)'],
    ['restarter.disableHealthCheck', 'Disable HTTP Health Check'],
    ['banlist.enabled', 'Ban Checking Enabled'],
    ['banlist.rejectionMessage', 'Ban Rejection Message'],
    ['banlist.requiredHwidMatches', 'Required Ban HWID Matches'],
    ['banlist.templates', 'Ban Templates'],
    ['whitelist.enabled', 'Whitelist Enabled'],
    ['whitelist.activeWorkflowId', 'Active Whitelist Workflow'],
    ['whitelist.workflows', 'Whitelist Workflows'],
    ['whitelist.deferralCard', 'Whitelist Deferral Card (legacy)'],
    ['whitelist.deferralCards', 'Connection Deferral Cards'],
    ['whitelist.schedule', 'Whitelist Schedule'],
    ['whitelist.webhooks', 'Whitelist Webhooks'],
    ['whitelist.appearInServerBrowser', 'Server Browser Allowlist Icon'],
    ['whitelist.serverBrowserInstructions', 'Server Browser Allowlist Instructions'],
    ['queue.enabled', 'Queue Enabled'],
    ['queue.rules', 'Queue Rules'],
    ['queue.pools', 'Queue Slot Pools'],
    ['queue.maxConcurrentDeferrals', 'Queue Max Users In Queue'],
    ['discordBot.enabled', 'Bot Enabled'],
    ['discordBot.token', 'Bot Token'],
    ['discordBot.guild', 'Server ID'],
    ['discordBot.warningsChannel', 'Warnings Channel ID'],
    ['discordBot.logGuildOverride', 'Discord Log Guild Override'],
    ['discordBot.bridgePort', 'Bridge Port'],
    ['discordBot.bridgeSecret', 'Bridge Secret'],
    ['discordBot.presence', 'Presence Config'],
    ['discordBot.rolePermissions', 'Role Permissions'],
    ['discordBot.customCommands', 'Custom Commands'],
    ['discordBot.logRoutes', 'Discord Log Routes'],
    ['discordBot.eventActions', 'Event Actions'],
    ['discordBot.appealsChannelId', 'Appeals Channel ID'],
    ['discordBot.ticketChannelId', 'Ticket Threads Channel ID'],
    ['discordBot.ticketThreadNotifyEnabled', 'Ticket Thread Notifications Enabled'],
    ['discordBot.embedJson', 'Status Embed JSON'],
    ['discordBot.embedConfigJson', 'Status Config JSON'],
    ['discordBot.playerListEmbedJson', 'Player List Embed JSON'],
    ['discordBot.playerListEmbedConfigJson', 'Player List Config JSON'],
    ['discordBot.embedRefreshIntervalSeconds', 'Status Embed Refresh Interval Seconds'],
    ['discordBot.oauthClientId', 'OAuth Client ID'],
    ['discordBot.oauthClientSecret', 'OAuth Client Secret'],
    ['gameFeatures.reportsEnabled', 'Reports Enabled'],
    ['gameFeatures.ticketCategories', 'Ticket Categories'],
    ['gameFeatures.ticketCategoryDescriptions', 'Ticket Category Descriptions'],
    ['gameFeatures.ticketPriorityEnabled', 'Ticket Priority Enabled'],
    ['gameFeatures.ticketFeedbackEnabled', 'Ticket Feedback Enabled'],
    ['gameFeatures.ticketRetentionDays', 'Ticket Retention Days'],
    ['gameFeatures.menuEnabled', 'Menu Enabled'],
    ['gameFeatures.menuAlignRight', 'Align Menu Right'],
    ['gameFeatures.menuPageKey', 'Menu Page Switch Key'],
    ['gameFeatures.menuPlayerIdDistance', 'Overhead Player ID Distance (meters)'],
    ['gameFeatures.overheadTwoRowLayout', 'Overhead Two-Row Layout'],
    ['gameFeatures.overheadSeatIcons', 'Overhead Vehicle Seat Icons'],
    ['gameFeatures.overheadNoclipIcon', 'Overhead Noclip Icon'],
    ['gameFeatures.playerModePtfx', 'Player Mode Change Effect'],
    ['gameFeatures.hideAdminInPunishments', 'Hide Admin Name In Punishments'],
    ['gameFeatures.hideAdminInMessages', 'Hide Admin Name In Messages'],
    ['gameFeatures.hideDefaultAnnouncement', 'Hide Announcement Notifications'],
    ['gameFeatures.hideDefaultDirectMessage', 'Hide Direct Message Notification'],
    ['gameFeatures.hideDefaultWarning', 'Hide Warning Notification'],
    ['gameFeatures.hideDefaultScheduledRestartWarning', 'Hide Scheduled Restart Warnings'],
    ['gameFeatures.newplayerThreshold', 'New Player Tag Threshold (minutes)'],
    ['gameFeatures.customTags', 'Custom Player Tags'],
    ['panelFeatures.whitelistPage', 'Whitelist Page Enabled'],
    ['panelFeatures.historyPage', 'History Page Enabled'],
    ['panelFeatures.insightsPage', 'Insights Page Enabled'],
    ['panelFeatures.playerDropsPage', 'Player Drops Page Enabled'],
    ['panelFeatures.reportAnalyticsPage', 'Report Analytics Page Enabled'],
    ['panelFeatures.resourcesPage', 'Resources Page Enabled'],
    ['panelFeatures.cfgEditorPage', 'CFG Editor Page Enabled'],
    ['panelFeatures.serverLogPage', 'Server Log Page Enabled'],
    ['panelFeatures.actionLogPage', 'Action Log Page Enabled'],
    ['panelFeatures.consoleLogPage', 'Console Log Page Enabled'],
    ['panelFeatures.addonsPage', 'Addons Page Enabled'],
    ['webServer.disableNuiSourceCheck', 'Disable NUI Source Check'],
    ['webServer.trustProxy', 'Trust Reverse Proxy (X-Forwarded-*)'],
    ['webServer.proxyTrustedHops', 'Proxy Trusted Hops (X-Forwarded-For Tail)'],
    ['webServer.limiterMinutes', 'Rate Limiter Minutes'],
    ['webServer.limiterAttempts', 'Rate Limiter Attempts'],
    ['webServer.useSecureCookies', 'Use Secure Cookies'],
    ['webServer.persistSessions', 'Persist Sessions to Disk'],
    ['logger.admin', 'Admin Logs'],
    ['logger.fxserver', 'FXServer Logs'],
    ['logger.server', 'Server Logs'],
    ['logger.serverLogRetention', 'Server Log Retention'],
    ['logger.serverLogExcludeTypes', 'Server Log Exclude Types'],
] as const;

type ConfigChangeLogKey = (typeof configChangeLogFieldDefinitions)[number][0];
export type ConfigChangeLogActionId = `config.${ConfigChangeLogKey}`;
export const legacyConfigSaveActionId = 'config.save' as const;

type ConfigChangeLogActionDefinition = {
    id: ConfigChangeLogActionId;
    category: 'config';
    label: string;
    description: string;
};

const createConfigChangeLogActionDefinition = <TKey extends ConfigChangeLogKey>(configKey: TKey, label: string) => {
    return {
        id: `config.${configKey}` as `config.${TKey}`,
        category: 'config' as const,
        label,
        description: `Save the ${label} configuration value.`,
    } satisfies ConfigChangeLogActionDefinition;
};

const configChangeLogActionEntries = configChangeLogFieldDefinitions.map(([configKey, label]) => {
    return [configKey, createConfigChangeLogActionDefinition(configKey, label)] as const;
});

export const configChangeLogActionDefinitions = configChangeLogActionEntries.map(([, definition]) => definition);

const configChangeLogActionDefinitionsByConfigKey = new Map(configChangeLogActionEntries);

export const getConfigChangeLogActionDefinition = (configKey: string) => {
    return configChangeLogActionDefinitionsByConfigKey.get(configKey as ConfigChangeLogKey);
};

export const getConfigChangeLogActionId = (configKey: string) => {
    return getConfigChangeLogActionDefinition(configKey)?.id;
};

export const systemLogActionDefinitions = [
    {
        id: 'advanced.profile_monitor',
        category: 'action',
        label: 'Profile sxPanel Instance',
        description: 'Capture a monitor runtime profile from the advanced tools page.',
    },
    {
        id: 'admin.presets.save',
        category: 'action',
        label: 'Save Permission Presets',
        description: 'Save custom permission presets for admin management.',
    },
    {
        id: 'admin.user.add',
        category: 'action',
        label: 'Add Admin User',
        description: 'Create a new admin account.',
    },
    {
        id: 'admin.user.delete',
        category: 'action',
        label: 'Delete Admin User',
        description: 'Delete an existing admin account.',
    },
    {
        id: 'admin.user.edit',
        category: 'action',
        label: 'Edit Admin User',
        description: 'Update an existing admin account.',
    },
    {
        id: 'admin.user.password_reset',
        category: 'action',
        label: 'Reset Admin Password',
        description: 'Reset an admin account password.',
    },
    {
        id: 'announcement.send',
        category: 'action',
        label: 'Send Announcement',
        description: 'Send a server-wide announcement.',
    },
    {
        id: 'auth.2fa.enable',
        category: 'action',
        label: 'Enable 2FA',
        description: 'Enable two-factor authentication for an admin account.',
    },
    {
        id: 'auth.admins_file.create',
        category: 'action',
        label: 'Create Admins File',
        description: 'Create the first admins file during setup.',
    },
    {
        id: 'auth.identifiers.change',
        category: 'action',
        label: 'Change Own Identifiers',
        description: 'Update the current admin account identifiers.',
    },
    {
        id: 'auth.password.change',
        category: 'action',
        label: 'Change Own Password',
        description: 'Update the current admin account password.',
    },
    {
        id: 'deployer.commit',
        category: 'action',
        label: 'Commit Server Deploy',
        description: 'Commit a deployer run and save the resulting server configuration.',
    },
    {
        id: 'deployer.recipe.run',
        category: 'action',
        label: 'Run Recipe',
        description: 'Start the deployer recipe with the chosen variables.',
    },
    {
        id: 'deployer.recipe.set',
        category: 'action',
        label: 'Set Recipe',
        description: 'Confirm or update the deployer recipe text.',
    },
    {
        id: 'discord.embed.player_list.clear',
        category: 'action',
        label: 'Clear Player List Embed Location',
        description: 'Remove the saved Discord player list embed location.',
    },
    {
        id: 'discord.embed.player_list.save',
        category: 'action',
        label: 'Save Player List Embed Location',
        description: 'Save the Discord player list embed location.',
    },
    {
        id: 'discord.embed.status.clear',
        category: 'action',
        label: 'Clear Status Embed Location',
        description: 'Remove the saved Discord status embed location.',
    },
    {
        id: 'discord.embed.status.save',
        category: 'action',
        label: 'Save Status Embed Location',
        description: 'Save the Discord status embed location.',
    },
    {
        id: 'history.ban_duration.change',
        category: 'action',
        label: 'Change Ban Duration',
        description: 'Change the duration of an existing ban.',
    },
    {
        id: 'history.ban_legacy',
        category: 'action',
        label: 'Ban Identifiers',
        description: 'Create a legacy ban from raw identifiers.',
    },
    {
        id: 'history.delete',
        category: 'action',
        label: 'Delete Action History Entry',
        description: 'Delete an existing action history entry.',
    },
    {
        id: 'history.revoke',
        category: 'action',
        label: 'Revoke Action',
        description: 'Revoke an existing warn or ban action.',
    },
    {
        id: 'player.ban',
        category: 'action',
        label: 'Ban Player',
        description: 'Ban a player from the panel or Discord moderation tools.',
    },
    {
        id: 'player.delete',
        category: 'action',
        label: 'Delete Player Record',
        description: 'Delete a stored player record from the database.',
    },
    {
        id: 'player.heal',
        category: 'action',
        label: 'Heal Player',
        description: 'Heal a player from the web panel.',
    },
    {
        id: 'player.hwids.wipe',
        category: 'action',
        label: 'Wipe Player HWIDs',
        description: 'Remove stored hardware identifiers for a player.',
    },
    {
        id: 'player.ids.wipe',
        category: 'action',
        label: 'Wipe Player IDs',
        description: 'Remove stored identifiers for a player.',
    },
    {
        id: 'player.kick',
        category: 'action',
        label: 'Kick Player',
        description: 'Kick a player from the panel or Discord moderation tools.',
    },
    {
        id: 'player.kick_all',
        category: 'action',
        label: 'Kick All Players',
        description: 'Kick every connected player from the server.',
    },
    {
        id: 'player.live_spectate.start',
        category: 'action',
        label: 'Start Live Spectate',
        description: 'Start a live spectate session for a player.',
    },
    {
        id: 'player.message.send',
        category: 'action',
        label: 'Send Player Message',
        description: 'Send a direct message to a player.',
    },
    {
        id: 'player.notes.save',
        category: 'action',
        label: 'Save Player Notes',
        description: 'Save panel notes for a player.',
    },
    {
        id: 'player.screenshot',
        category: 'action',
        label: 'Request Player Screenshot',
        description: 'Request a screenshot from a player client.',
    },
    {
        id: 'player.spectate',
        category: 'action',
        label: 'Spectate Player',
        description: 'Start spectating a player from the web panel.',
    },
    {
        id: 'player.tag.add',
        category: 'action',
        label: 'Add Player Tag',
        description: 'Add a custom tag to a player.',
    },
    {
        id: 'player.tag.remove',
        category: 'action',
        label: 'Remove Player Tag',
        description: 'Remove a custom tag from a player.',
    },
    {
        id: 'player.warn',
        category: 'action',
        label: 'Warn Player',
        description: 'Warn a player from the panel or Discord moderation tools.',
    },
    {
        id: 'player.whitelist.add',
        category: 'action',
        label: 'Add Player Whitelist',
        description: 'Add a player to the whitelist.',
    },
    {
        id: 'player.whitelist.remove',
        category: 'action',
        label: 'Remove Player Whitelist',
        description: 'Remove a player from the whitelist.',
    },
    {
        id: 'resource.ensure',
        category: 'action',
        label: 'Ensure Resource',
        description: 'Ensure a server resource.',
    },
    {
        id: 'resource.refresh',
        category: 'action',
        label: 'Refresh Resources',
        description: 'Refresh the server resource list.',
    },
    {
        id: 'resource.restart',
        category: 'action',
        label: 'Restart Resource',
        description: 'Restart a server resource.',
    },
    {
        id: 'resource.start',
        category: 'action',
        label: 'Start Resource',
        description: 'Start a server resource.',
    },
    {
        id: 'resource.stop',
        category: 'action',
        label: 'Stop Resource',
        description: 'Stop a server resource.',
    },
    {
        id: 'resource.download',
        category: 'action',
        label: 'Download Resource',
        description: 'Download a server resource as a zip archive.',
    },
    {
        id: 'scheduler.restart.enable',
        category: 'action',
        label: 'Re-enable Scheduled Restart',
        description: 'Re-enable the next scheduled restart.',
    },
    {
        id: 'scheduler.restart.schedule',
        category: 'action',
        label: 'Schedule Restart',
        description: 'Schedule the next temporary server restart.',
    },
    {
        id: 'scheduler.restart.skip',
        category: 'action',
        label: 'Skip Scheduled Restart',
        description: 'Skip the next scheduled server restart.',
    },
    {
        id: 'settings.server_data_path.reset',
        category: 'action',
        label: 'Reset Server Data Path',
        description: 'Reset the configured server data path.',
    },
    {
        id: 'setup.deployer.custom',
        category: 'action',
        label: 'Start Custom Deployer Setup',
        description: 'Start the custom deployer setup flow.',
    },
    {
        id: 'setup.deployer.import',
        category: 'action',
        label: 'Start Imported Deployer Setup',
        description: 'Start the deployer from an imported recipe.',
    },
    {
        id: 'setup.local.save',
        category: 'action',
        label: 'Save Local Setup',
        description: 'Save local server setup settings.',
    },
    {
        id: 'ticket.assign',
        category: 'action',
        label: 'Assign Ticket',
        description: 'Assign a ticket to a staff member.',
    },
    {
        id: 'ticket.claim',
        category: 'action',
        label: 'Claim Ticket',
        description: 'Claim a ticket for handling.',
    },
    {
        id: 'ticket.close',
        category: 'action',
        label: 'Close Ticket',
        description: 'Close a ticket.',
    },
    {
        id: 'ticket.create',
        category: 'action',
        label: 'Create Ticket',
        description: 'Create a new ticket from the game or panel workflow.',
    },
    {
        id: 'ticket.delete',
        category: 'action',
        label: 'Delete Ticket',
        description: 'Delete a ticket permanently.',
    },
    {
        id: 'ticket.in_review',
        category: 'action',
        label: 'Mark Ticket In Review',
        description: 'Move a ticket into the in-review state.',
    },
    {
        id: 'ticket.note.add',
        category: 'action',
        label: 'Add Ticket Note',
        description: 'Add a staff note to a ticket.',
    },
    {
        id: 'ticket.note.delete',
        category: 'action',
        label: 'Delete Ticket Note',
        description: 'Delete a staff note from a ticket.',
    },
    {
        id: 'ticket.reopen',
        category: 'action',
        label: 'Reopen Ticket',
        description: 'Reopen a resolved or closed ticket.',
    },
    {
        id: 'ticket.reply',
        category: 'action',
        label: 'Reply To Ticket',
        description: 'Send a staff reply on a ticket.',
    },
    {
        id: 'ticket.resolve',
        category: 'action',
        label: 'Resolve Ticket',
        description: 'Resolve a ticket.',
    },
    {
        id: 'ticket.retention.exclude',
        category: 'action',
        label: 'Exclude Ticket From Auto Deletion',
        description: 'Exclude a ticket from retention pruning.',
    },
    {
        id: 'ticket.retention.reenable',
        category: 'action',
        label: 'Re-enable Ticket Auto Deletion',
        description: 'Re-enable retention pruning for a ticket.',
    },
    {
        id: 'ticket.unclaim',
        category: 'action',
        label: 'Unclaim Ticket',
        description: 'Remove the current ticket claim.',
    },
    {
        id: 'whitelist.approval.add',
        category: 'action',
        label: 'Add Whitelist Approval',
        description: 'Add a whitelist approval entry.',
    },
    {
        id: 'whitelist.application.create',
        category: 'action',
        label: 'Create Whitelist Application',
        description: 'Create a whitelist application entry.',
    },
    {
        id: 'whitelist.approval.remove',
        category: 'action',
        label: 'Remove Whitelist Approval',
        description: 'Remove a whitelist approval entry.',
    },
    {
        id: 'whitelist.request.approve',
        category: 'action',
        label: 'Approve Whitelist Request',
        description: 'Approve a whitelist request.',
    },
    {
        id: 'whitelist.request.deny',
        category: 'action',
        label: 'Deny Whitelist Request',
        description: 'Deny a whitelist request.',
    },
    {
        id: 'whitelist.request.deny_all',
        category: 'action',
        label: 'Deny All Whitelist Requests',
        description: 'Deny all currently visible whitelist requests.',
    },
    {
        id: 'artifact.apply',
        category: 'command',
        label: 'Apply FXServer Update',
        description: 'Apply a downloaded FXServer artifact update.',
    },
    {
        id: 'artifact.download',
        category: 'command',
        label: 'Download FXServer Artifact',
        description: 'Download a new FXServer artifact build.',
    },
    {
        id: 'selfUpdate.apply',
        category: 'command',
        label: 'Apply sxPanel Update',
        description: 'Apply a downloaded sxPanel (monitor resource) update.',
    },
    {
        id: 'selfUpdate.download',
        category: 'command',
        label: 'Download sxPanel Update',
        description: 'Download a new sxPanel (monitor resource) release.',
    },
    {
        id: 'console.command',
        category: 'command',
        label: 'Live Console Command',
        description: 'Run a command from the live console.',
    },
    {
        id: 'server.restart',
        category: 'command',
        label: 'Restart Server',
        description: 'Restart the game server.',
    },
    {
        id: 'server.start',
        category: 'command',
        label: 'Start Server',
        description: 'Start the game server.',
    },
    {
        id: 'server.stop',
        category: 'command',
        label: 'Stop Server',
        description: 'Stop the game server.',
    },
    {
        id: 'auth.2fa.disable',
        category: 'config',
        label: 'Disable 2FA',
        description: 'Disable two-factor authentication for an admin account.',
    },
    ...configChangeLogActionDefinitions,
    {
        id: 'login.discord',
        category: 'login',
        label: 'Discord Login',
        description: 'Sign in through Discord OAuth.',
    },
    {
        id: 'login.cfxre',
        category: 'login',
        label: 'Cfx.re Login',
        description: 'Sign in through Cfx.re / FiveM account OAuth.',
    },
    {
        id: 'login.password',
        category: 'login',
        label: 'Password Login',
        description: 'Sign in with an admin password.',
    },
    {
        id: 'login.password_2fa',
        category: 'login',
        label: 'Password + 2FA Login',
        description: 'Complete a password login with two-factor authentication.',
    },
    {
        id: 'monitor.restart',
        category: 'monitor',
        label: 'Automatic Monitor Restart',
        description: 'Restart the server because monitor health checks failed.',
    },
    {
        id: 'scheduler.restart.execute',
        category: 'scheduler',
        label: 'Scheduled Restart Triggered',
        description: 'Trigger a scheduled server restart.',
    },
    {
        id: 'system.max_clients.corrected',
        category: 'system',
        label: 'Correct Max Clients',
        description: 'Correct sv_maxclients back to the forced host limit.',
    },
] as const;

export type SystemLogActionId = (typeof systemLogActionDefinitions)[number]['id'];
export type SystemLogActionDefinition = (typeof systemLogActionDefinitions)[number];

const systemLogActionIdSet = new Set<string>(systemLogActionDefinitions.map((definition) => definition.id));
const systemLogActionDefinitionsByCategory = new Map<SystemLogCategory, SystemLogActionDefinition[]>(
    SystemLogCategories.map((category) => [
        category,
        systemLogActionDefinitions.filter((definition) => definition.category === category),
    ]),
);

export const isSystemLogActionId = (value: unknown): value is SystemLogActionId => {
    return typeof value === 'string' && systemLogActionIdSet.has(value);
};

export const getSystemLogActionDefinitions = (category: SystemLogCategory) => {
    return systemLogActionDefinitionsByCategory.get(category) ?? [];
};

export type SystemLogEntry = {
    ts: number;
    author: string;
    category: SystemLogCategory;
    action: string;
    actionId?: SystemLogActionId;
    ip?: string;
};
