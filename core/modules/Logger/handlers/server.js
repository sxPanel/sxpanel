const modulename = 'Logger:Server';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { bisector } from 'd3-array';
import { QuantileArray, estimateArrayJsonSize } from '@modules/Metrics/statsUtils';
import { LoggerBase } from '../LoggerBase';
import { getBootDivider } from '../loggerUtils';
import consoleFactory from '@lib/console';
import bytes from 'bytes';
import { summarizeIdsArray } from '@lib/player/idUtils';
import { getTimeFilename } from '@lib/misc';
import { formatCombatStats, parseCombatDamageSummary, parseCombatSummary } from '@lib/combatLog';
const console = consoleFactory(modulename);

/**
 * Event type → message formatter map.
 * Each handler receives (eventData, srcObject, loggerInstance) and returns the event message string.
 */
const eventFormatters = {
    playerJoining(eventData) {
        const idsString = summarizeIdsArray(eventData?.data?.ids);
        return `joined with identifiers ${idsString}`;
    },
    playerDropped(eventData) {
        const reason = eventData.data.reason || 'UNKNOWN REASON';
        return `disconnected (${reason})`;
    },
    playerJoinDenied(eventData) {
        const reason = eventData.data.reason ?? 'UNKNOWN REASON';
        return `player join denied due to ${reason}`;
    },
    ChatMessage(eventData, srcObject) {
        const text =
            typeof eventData.data.text === 'string' ? eventData.data.text.replace(/\^([0-9])/g, '') : 'unknown message';
        return typeof eventData.data.author === 'string' && eventData.data.author !== srcObject.name
            ? `(${eventData.data.author}): said "${text}"`
            : `said "${text}"`;
    },
    DeathNotice(eventData) {
        const cause = eventData.data.cause || 'unknown';
        if (typeof eventData.data.killer === 'number' && eventData.data.killer > 0) {
            const killer = txCore.fxPlayerlist.getPlayerById(eventData.data.killer);
            const base = killer
                ? `died from ${cause} by ${killer.displayName}`
                : `died from ${cause} by unknown killer`;
            const combat = parseCombatSummary(eventData.data.combat);
            const stats = combat ? formatCombatStats(combat) : '';
            return stats ? `${base} (${stats})` : base;
        }
        return `died from ${cause}`;
    },
    CombatDamage(eventData) {
        const summary = parseCombatDamageSummary(eventData.data);
        if (!summary) return 'dealt damage (invalid combat data)';
        const victim = txCore.fxPlayerlist.getPlayerById(summary.victim);
        const victimName = victim ? victim.displayName : `unknown player #${summary.victim}`;
        const weapon = summary.weapon ? ` with ${summary.weapon}` : '';
        const stats = formatCombatStats(summary);
        return `damaged ${victimName}${weapon}${stats ? ` (${stats})` : ''}`;
    },
    explosionEvent(eventData) {
        const expType = eventData.data.explosionType || 'UNKNOWN';
        return `caused an explosion (${expType})`;
    },
    CommandExecuted(eventData) {
        const command = eventData.data || 'unknown';
        return `executed: /${command}`;
    },
    LoggerStarted(eventData, _srcObject, logger) {
        logger._rotateSessionFile();
        txCore.metrics.playerDrop.handleServerBootData(eventData.data);
        if (typeof eventData.data?.gameName === 'string' && eventData.data.gameName.length) {
            if (eventData.data.gameName === 'gta5') {
                txCore.cacheStore.set('fxsRuntime:gameName', 'fivem');
            } else if (eventData.data.gameName === 'rdr3') {
                txCore.cacheStore.set('fxsRuntime:gameName', 'redm');
            } else {
                txCore.cacheStore.delete('fxsRuntime:gameName');
            }
        }
        return 'Logger started';
    },
    DebugMessage(eventData) {
        return typeof eventData.data === 'string' ? `Debug Message: ${eventData.data}` : 'Debug Message: unknown';
    },
    MenuEvent(eventData) {
        txManager.txRuntime.menuCommands.count(eventData.data?.action ?? 'unknown');
        return typeof eventData.data.message === 'string' ? `${eventData.data.message}` : 'did unknown action';
    },
};

//Event types that can be routed to Discord (see DiscordBot/logRouting.ts)
const discordRoutedEventTypes = new Set([
    'MenuEvent',
    'DeathNotice',
    'CombatDamage',
    'playerJoining',
    'playerDropped',
    'playerJoinDenied',
    'ChatMessage',
]);

/*
NOTE: Expected time cap based on log size cap to prevent memory leak
Big server: 300 events/min (freeroam/dm with 100+ players)
Medium servers: 30 events/min (rp with up to 64 players)

64k cap: 3.5h big, 35.5h medium, 24mb, 620ms/1000 seek time
32k cap: 1.7h big, 17.7h medium, 12mb, 307ms/1000 seek time
16k cap: 0.9h big, 9h medium, 6mb, 150ms/1000 seek time

> Seek time based on getting 500 items older than cap - 1000 (so near the end of the array) run 1k times
> Memory calculated with process.memoryUsage().heapTotal considering every event about 300 bytes

NOTE: Although we could comfortably do 64k cap, even if showing 500 lines per page, nobody would
navigate through 128 pages, so let's do 16k cap since there is not even a way for the admin to skip
pages since it's all relative (older/newer) just like github's tags/releases page.

NOTE: Final code after 2.5h at 2400 events/min with websocket client the memory usage was 135mb
*/

//DEBUG testing stuff
// let cnt = 0;
// setInterval(() => {
//     cnt++;
//     if (cnt > 84) cnt = 1;
//     const mtx = txCore.fxRunner.child?.mutex ?? 'UNKNW';
//     const payload = [
//         {
//             src: 'tx',
//             ts: Date.now(),
//             type: 'DebugMessage',
//             data: cnt + '='.repeat(cnt),
//         },
//     ];
//     txCore.logger.server.write(mtx, payload);
// }, 750);

export default class ServerLogger extends LoggerBase {
    constructor(basePath, lrProfileConfig) {
        const lrDefaultOptions = {
            path: basePath,
            intervalBoundary: true,
            initialRotation: true,
            history: 'server.history',
            // compress: 'gzip',
            interval: '1d',
            maxFiles: 7,
            maxSize: '10G',
        };
        super(basePath, 'server', lrDefaultOptions, lrProfileConfig);
        this.lrStream.write(getBootDivider());

        this.recentBuffer = [];
        this.recentBufferMaxSize = 32e3;

        // JSONL session file for structured historical data
        this.sessionBasePath = basePath;
        this.sessionFileRegex = /^server_session_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jsonl$/;
        this.activeSessionPath = path.join(basePath, 'server_session.jsonl');
        this._rotateSessionFileOnBoot();
        this.sessionStream = fs.createWriteStream(this.activeSessionPath, { flags: 'a' });

        //stats stuff
        this.eventsPerMinute = new QuantileArray(24 * 60, 6 * 60); //max 1d, min 6h
        this.eventsThisMinute = 0;
        setInterval(() => {
            this.eventsPerMinute.count(this.eventsThisMinute);
            this.eventsThisMinute = 0;
        }, 60_000);

        //Per-server log filtering for high-volume servers
        const excludeTypes = txConfig.logger.serverLogExcludeTypes;
        this.excludeTypesSet = new Set(Array.isArray(excludeTypes) ? excludeTypes : []);
    }

    /**
     * Returns a string with short usage stats
     */
    getUsageStats() {
        // Get events/min
        const eventsPerMinRes = this.eventsPerMinute.resultSummary();
        const eventsPerMinStr = eventsPerMinRes.enoughData ? eventsPerMinRes.summary : 'LowCount';

        //Buffer JSON size (8k min buffer, 1k samples)
        const bufferJsonSizeRes = estimateArrayJsonSize(this.recentBuffer, 4e3);
        const bufferJsonSizeStr = bufferJsonSizeRes.enoughData
            ? `${bytes(bufferJsonSizeRes.bytesPerElement)}/e`
            : 'LowCount';

        return `Buffer: ${this.recentBuffer.length},  lrErrors: ${this.lrErrors}, mem: ${bufferJsonSizeStr}, rate: ${eventsPerMinStr}`;
    }

    /***
     * Returns the recent fxserver buffer containing HTML markers, and not XSS escaped.
     * The size of this buffer is usually above 64kb, never above 128kb.
     * @param {Number} lastN
     * @returns the recent buffer, optionally only the last N elements
     */
    getRecentBuffer(lastN) {
        return lastN ? this.recentBuffer.slice(-lastN) : this.recentBuffer;
    }

    /**
     * Processes the FD3 log array
     * @param {Object[]} data
     * @param {string} [mutex]
     */
    write(data, mutex) {
        if (!Array.isArray(data)) {
            console.verbose.warn(`write() expected array, got ${typeof data}`);
            return false;
        }
        mutex ??= txCore.fxRunner.child.mutex ?? 'UNKNW';

        //Processing events
        for (let i = 0; i < data.length; i++) {
            try {
                //Skip excluded event types (configurable for high-volume servers)
                if (this.excludeTypesSet.size && this.excludeTypesSet.has(data[i].type)) {
                    continue;
                }

                const { eventObject, eventString } = this.processEvent(data[i], mutex);
                if (!eventObject || !eventString) {
                    console.verbose.warn('Failed to parse event:');
                    console.verbose.dir(data[i]);
                    continue;
                }

                //Add to recent buffer
                this.eventsThisMinute++;
                this.recentBuffer.push(eventObject);
                if (this.recentBuffer.length > this.recentBufferMaxSize) this.recentBuffer.shift();

                //Send to websocket
                txCore.webServer.webSocket.buffer('serverlog', eventObject);

                //Write to text log file
                this.lrStream.write(`${eventString}\n`);

                //Write to JSONL session file
                this.sessionStream.write(JSON.stringify(eventObject) + '\n');

                if (
                    discordRoutedEventTypes.has(eventObject.type) &&
                    typeof txCore.discordBot?.handleServerLogEvent === 'function'
                ) {
                    txCore.discordBot.handleServerLogEvent(data[i], eventObject).catch(() => {});
                }
            } catch (error) {
                console.verbose.error('Error processing FD3 txAdminLogData:');
                console.verbose.dir(error);
            }
        }
    }

    /**
     * Processes an event and returns both the string for log file, and object for the web ui
     * @param {Object} eventData
     * @param {String} mutex
     */
    processEvent(eventData, mutex) {
        //Get source
        let srcObject; //to be sent to the UI
        let srcString; //to ve saved to the log file
        if (eventData.src === 'tx') {
            srcObject = { id: false, name: 'sxPanel' };
            srcString = 'sxPanel';
        } else if (typeof eventData.src === 'number' && eventData.src > 0) {
            const player = txCore.fxPlayerlist.getPlayerById(eventData.src);
            if (player) {
                const logName = player.displayName;
                srcObject = { id: player.psid, name: logName };
                srcString = `[${player.psid}] ${logName}`;
            } else {
                srcObject = { id: false, name: 'UNKNOWN PLAYER' };
                srcString = 'UNKNOWN PLAYER';
                console.verbose.warn('Unknown numeric event source from object:');
                console.verbose.dir(eventData);
            }
        } else {
            srcObject = { id: false, name: 'UNKNOWN' };
            srcString = 'UNKNOWN';
        }

        //Process event types
        const handler = eventFormatters[eventData.type];
        let eventMessage;
        if (handler) {
            eventMessage = handler(eventData, srcObject, this);
        } else {
            console.verbose.warn(`Unrecognized event: ${eventData.type}`);
            console.verbose.dir(eventData);
            eventMessage = eventData.type;
        }

        //Prepare output
        const localeTime = new Date(eventData.ts).toLocaleTimeString();
        eventMessage = eventMessage.replace(/\n/g, '\t'); //Just to make sure no event is injecting line breaks
        return {
            eventObject: {
                ts: eventData.ts,
                type: eventData.type,
                src: srcObject,
                msg: eventMessage,
            },
            eventString: `[${localeTime}] ${srcString}: ${eventMessage}`,
        };
    }

    /**
     * Returns a slice of the recent buffer OLDER than a reference timestamp.
     * @param {Number} timestamp
     * @param {Number} sliceLength
     */
    readPartialNewer(timestamp, sliceLength) {
        const bisect = bisector((d) => d.ts).left;
        const limitIndex = bisect(this.recentBuffer, timestamp + 1);
        return this.recentBuffer.slice(limitIndex, limitIndex + sliceLength);
    }

    /**
     * Returns a slice of the recent buffer NEWER than a reference timestamp.
     * @param {Number} timestamp
     * @param {Number} sliceLength
     */
    readPartialOlder(timestamp, sliceLength) {
        const bisect = bisector((d) => d.ts).left;
        const limitIndex = bisect(this.recentBuffer, timestamp);

        if (limitIndex >= this.recentBuffer.length) {
            //everything is older, return last few
            return this.recentBuffer.slice(-sliceLength);
        } else {
            //not everything is older
            return this.recentBuffer.slice(Math.max(0, limitIndex - sliceLength), limitIndex);
        }
    }

    /**
     * TODO: filter function, so we can search for all log from a specific player
     */
    readFiltered() {
        throw new Error('Not yet implemented.');
    }

    /**
     * On boot, rotate any leftover active session file (e.g. from a crash)
     */
    _rotateSessionFileOnBoot() {
        try {
            if (fs.existsSync(this.activeSessionPath)) {
                const stat = fs.statSync(this.activeSessionPath);
                if (stat.size > 0) {
                    const ts = getTimeFilename(stat.mtime);
                    const dest = path.join(this.sessionBasePath, `server_session_${ts}.jsonl`);
                    fs.renameSync(this.activeSessionPath, dest);
                    console.verbose.log(`Rotated orphan session file to ${path.basename(dest)}`);
                }
            }
        } catch (error) {
            console.verbose.warn('Failed to rotate orphan session file:', error.message);
        }
        this._cleanupSessionFiles();
    }

    /**
     * Rotate the active session file (called on LoggerStarted = server restart)
     */
    _rotateSessionFile() {
        try {
            // Close current stream
            if (this.sessionStream) {
                this.sessionStream.end();
            }
            // Rename active file if it has content
            if (fs.existsSync(this.activeSessionPath)) {
                const stat = fs.statSync(this.activeSessionPath);
                if (stat.size > 0) {
                    const ts = getTimeFilename();
                    const dest = path.join(this.sessionBasePath, `server_session_${ts}.jsonl`);
                    fs.renameSync(this.activeSessionPath, dest);
                    console.verbose.log(`Rotated session file to ${path.basename(dest)}`);
                }
            }
            // Open new stream
            this.sessionStream = fs.createWriteStream(this.activeSessionPath, { flags: 'a' });
            this._cleanupSessionFiles();
        } catch (error) {
            console.verbose.warn('Failed to rotate session file:', error.message);
        }
    }

    /**
     * Remove session files older than retention days
     */
    _cleanupSessionFiles() {
        try {
            const retentionDays = txConfig?.logger?.serverLogRetention ?? 14;
            const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
            const files = fs.readdirSync(this.sessionBasePath).filter((f) => this.sessionFileRegex.test(f));
            for (const file of files) {
                const filePath = path.join(this.sessionBasePath, file);
                const stat = fs.statSync(filePath);
                if (stat.mtime.getTime() < cutoffMs) {
                    fs.unlinkSync(filePath);
                    console.verbose.log(`Deleted old session file: ${file}`);
                }
            }
        } catch (error) {
            console.verbose.warn('Failed to clean up session files:', error.message);
        }
    }

    /**
     * Returns list of available session files with metadata
     */
    async listSessionFiles() {
        const files = [];
        try {
            const dirEntries = await fsp.readdir(this.sessionBasePath, { withFileTypes: true });
            for (const entry of dirEntries) {
                if (!entry.isFile()) continue;
                if (!this.sessionFileRegex.test(entry.name)) continue;
                const filePath = path.join(this.sessionBasePath, entry.name);
                const stat = await fsp.stat(filePath);
                // Parse timestamp from filename: server_session_YYYY-MM-DD_HH-MM-SS.jsonl
                const match = entry.name.match(/server_session_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.jsonl/);
                files.push({
                    name: entry.name,
                    size: bytes(stat.size),
                    ts: match
                        ? match[1].replace(/_/g, ' ').replace(/-/g, (m, offset) => (offset > 10 ? ':' : '-'))
                        : entry.name,
                    mtime: stat.mtime.getTime(),
                });
            }
            files.sort((a, b) => b.mtime - a.mtime); // newest first
        } catch (error) {
            console.verbose.warn('Failed to list session files:', error.message);
        }
        return files;
    }

    /**
     * Reads events from a session file
     * @param {string} fileName
     * @returns {object[]} array of event objects
     */
    async readSessionFile(fileName) {
        if (!this.sessionFileRegex.test(fileName)) {
            throw new Error('Invalid session file name');
        }
        const filePath = path.join(this.sessionBasePath, fileName);
        const content = await fsp.readFile(filePath, 'utf-8');
        const events = [];
        for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
                events.push(JSON.parse(line));
            } catch (_) {
                // skip malformed lines
            }
        }
        return events;
    }
}
