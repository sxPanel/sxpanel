const modulename = 'Logger';
import type from 'rotating-file-stream';
import AdminLogger from './handlers/admin';
import FXServerLogger from './FXServerLogger';
import ServerLogger from './handlers/server';
import SystemLogger from './SystemLogger';
import { getLogSizes } from './loggerUtils.js';
import consoleFactory from '@lib/console';
import { txEnv } from '@core/globalData';
const console = consoleFactory(modulename);

/**
 * Logger module that holds the scope-specific loggers and provides some utility functions.
 */
export default class Logger {
    private readonly basePath = txEnv.profileSubPath('logs');
    public readonly admin: AdminLogger;
    public readonly fxserver: FXServerLogger;
    public readonly server: ServerLogger;
    public readonly system: SystemLogger;

    constructor() {
        this.admin = new AdminLogger(this.basePath, txConfig.logger.admin);
        this.fxserver = new FXServerLogger(this.basePath, txConfig.logger.fxserver);
        this.server = new ServerLogger(this.basePath, txConfig.logger.server);
        this.system = new SystemLogger(this.basePath);
    }

    /**
     * Returns the total size of the log files used.
     */
    getUsageStats() {
        //{loggerName: statsString}
        throw new Error('Not yet implemented.');
    }

    /**
     * Return the total size of the log files used.
     */
    async getStorageSize() {
        return await getLogSizes(
            this.basePath,
            /^(admin|fxserver|server|system)(_session)?(_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?)?\.(log|jsonl)$/,
        );
    }

    /**
     * Flush and close write streams on shutdown
     */
    public handleShutdown() {
        this.system.closeStream();
    }
}
