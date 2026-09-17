const modulename = 'Logger:FXServer';
import bytes from 'bytes';
import type { Options as RfsOptions } from 'rotating-file-stream';
import { getLogDivider } from '../loggerUtils.js';
import consoleFactory, { processStdioWriteRaw } from '@lib/console.js';
import { LoggerBase } from '../LoggerBase.js';
import ConsoleTransformer from './ConsoleTransformer.js';
import ConsoleLineEnum from './ConsoleLineEnum.js';
import { shouldSkipSystemCommandLog } from './systemCommandFilter.js';
import { txHostConfig } from '@core/globalData.js';
import type { ConsoleBlock } from '@shared/consoleBlock';
const console = consoleFactory(modulename);

//This regex was done in the first place to prevent fxserver output to be interpreted as txAdmin output by the host terminal
//IIRC the issue was that one user with a TM on their nick was making txAdmin's console to close or freeze. I couldn't reproduce the issue.
// \x00-\x08 Control characters in the ASCII table.
// allow \r and \t
// \x0B-\x1A Vertical tab and control characters from shift out to substitute.
// allow \x1B (escape for colors n stuff)
// \x1C-\x1F Control characters (file separator, group separator, record separator, unit separator).
// allow all printable
// \x7F Delete character.
const regexControls = /[\x00-\x08\x0B-\x1A\x1C-\x1F\x7F]|(?:\x1B\[|\x9B)[\d;]+[@-K]/g;
const regexColors = /\x1B[^m]*?m/g;

//Block-based buffer constants
const BLOCK_MAX_SIZE = 32 * 1024; //32KB per block
const MAX_BLOCKS = 8;

export default class FXServerLogger extends LoggerBase {
    private readonly transformer = new ConsoleTransformer();
    private fileBuffer = '';
    private recentBlocks: ConsoleBlock[] = [];
    private blockSeqCounter = 0;

    constructor(basePath: string, lrProfileConfig: RfsOptions | false) {
        const lrDefaultOptions = {
            path: basePath,
            intervalBoundary: true,
            initialRotation: true,
            history: 'fxserver.history',
            // compress: 'gzip',
            interval: '1d',
            maxFiles: 7,
            maxSize: '5G',
        };
        super(basePath, 'fxserver', lrDefaultOptions, lrProfileConfig);

        setInterval(() => {
            this.flushFileBuffer();
        }, 5000);
    }

    /**
     * Returns a string with short usage stats
     */
    getUsageStats() {
        const totalSize = this.recentBlocks.reduce((acc, b) => acc + b.data.length, 0);
        return `Blocks: ${this.recentBlocks.length}, Buffer: ${bytes(totalSize)}, lrErrors: ${this.lrErrors}`;
    }

    /**
     * Returns the recent console blocks.
     * Each block has: { seq, ts, data, isSpawn }
     */
    getRecentBlocks(): ConsoleBlock[] {
        return this.recentBlocks;
    }

    /**
     * Returns blocks newer than a given sequence number (for persistent cls).
     */
    getBlocksSinceSeq(seq: number): ConsoleBlock[] {
        return this.recentBlocks.filter((b) => b.seq > seq);
    }

    /**
     * Returns the current block sequence counter (for persistent cls tracking).
     */
    getCurrentSeq() {
        return this.blockSeqCounter;
    }

    /**
     * Returns the full recent buffer as a single string (for log download).
     */
    getRecentBufferString() {
        return this.recentBlocks.map((b) => b.data).join('');
    }

    /**
     * Strips color of the file buffer and flushes it.
     * FIXME: this will still allow colors to be written to the file if the buffer cuts
     * in the middle of a color sequence, but less often since we are buffering more data.
     */
    flushFileBuffer() {
        if (!this.fileBuffer.length) return;
        this.lrStream.write(this.fileBuffer.replace(regexColors, ''));
        this.fileBuffer = '';
    }

    /**
     * Receives the assembled console blocks, stringifies, marks, colors them and dispatches it to
     * lrStream, websocket, and process stdout.
     */
    private ingest(type: ConsoleLineEnum, data: string, context?: string) {
        //Process the data
        const { webBuffer, stdoutBuffer, fileBuffer } = this.transformer.process(type, data, context);

        //To file
        this.fileBuffer += fileBuffer;

        //For the terminal
        if (!txConfig.server.quiet && !txHostConfig.forceQuietMode) {
            processStdioWriteRaw(stdoutBuffer);
        }

        //For the live console — skip WS buffer when nobody is viewing the page
        if (txCore.webServer?.webSocket?.hasRoomListeners('liveconsole')) {
            txCore.webServer.webSocket.buffer('liveconsole', webBuffer);
        }
        this.appendRecent(webBuffer);
    }

    /**
     * Writes to the log an informational message
     */
    public logInformational(msg: string) {
        this.ingest(ConsoleLineEnum.MarkerInfo, msg + '\n');
    }

    /**
     * Writes to the log that the server is booting
     */
    public logFxserverSpawn(pid: string) {
        //force line skip to create separation
        const currBlockData = this.recentBlocks.length ? this.recentBlocks[this.recentBlocks.length - 1].data : '';
        if (currBlockData.length) {
            const lineBreak = this.transformer.lastEol ? '\n' : '\n\n';
            this.ingest(ConsoleLineEnum.MarkerInfo, lineBreak);
        }
        //Force a new block for the spawn divider
        this.startNewBlock(true);
        const multiline = getLogDivider(`[${pid}] FXServer Starting`);
        for (const line of multiline.split('\n')) {
            if (!line.length) break;
            this.ingest(ConsoleLineEnum.MarkerInfo, line + '\n');
        }
    }

    /**
     * Writes to the log an admin command
     */
    public logAdminCommand(author: string, cmd: string) {
        this.ingest(ConsoleLineEnum.MarkerAdminCmd, cmd + '\n', author);
    }

    /**
     * Writes to the log a system command.
     */
    public logSystemCommand(cmd: string) {
        if (shouldSkipSystemCommandLog(cmd)) return;
        // if (/^txaEvent \w+ /.test(cmd)) {
        //     const [event, payload] = cmd.substring(9).split(' ', 2);
        //     cmd = chalk.italic(`<broadcasting txAdmin:events:${event}>`);
        // }
        this.ingest(ConsoleLineEnum.MarkerSystemCmd, cmd + '\n');
    }

    /**
     * Handles all stdio data.
     */
    public writeFxsOutput(source: ConsoleLineEnum.StdOut | ConsoleLineEnum.StdErr, data: string | Buffer) {
        if (typeof data !== 'string') {
            data = data.toString();
        }
        txCore.fxResources?.handleConsoleOutput(data);
        this.ingest(source, data.replace(regexControls, ''));
    }

    /**
     * Starts a new block in the recent buffer
     */
    private startNewBlock(isSpawn = false) {
        this.blockSeqCounter++;
        this.recentBlocks.push({
            seq: this.blockSeqCounter,
            ts: Math.floor(Date.now() / 1000),
            data: '',
            isSpawn,
        });
        //Drop oldest blocks when over limit
        while (this.recentBlocks.length > MAX_BLOCKS) {
            this.recentBlocks.shift();
        }
    }

    /**
     * Appends data to the recent block buffer, creating new blocks when size is exceeded
     */
    private appendRecent(data: string) {
        if (!this.recentBlocks.length) {
            this.startNewBlock();
        }
        const lastBlock = this.recentBlocks[this.recentBlocks.length - 1];
        lastBlock.data += data;

        //If block exceeds max size, start a new one
        if (lastBlock.data.length > BLOCK_MAX_SIZE) {
            this.startNewBlock();
        }
    }
}
