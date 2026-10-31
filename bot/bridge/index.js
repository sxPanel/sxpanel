const WebSocket = require('ws');
const handlers = require('./handlers');
const { pending } = require('./requests');

let ws;
let client;
let reconnectTimer;
let disconnectedSince;
// The panel spawns this process without a parent link, so if the panel dies uncleanly the bot is
// orphaned. An orphan keeps answering Discord interactions alongside the new bot and causes
// "interaction already acknowledged" errors, so give up if the bridge stays unreachable.
const ORPHAN_EXIT_AFTER_MS = 60_000;
const queuedMessages = [];

const parseMessage = (raw) => {
    try {
        return JSON.parse(raw.toString());
    } catch (error) {
        console.error('[BotBridge] Failed to parse message:', error);
        return null;
    }
};

const handleIncomingMessage = async (raw, discordClient = client) => {
    const msg = parseMessage(raw);
    if (!msg) {
        return { parsed: false };
    }

    if (msg.requestId && pending.has(msg.requestId)) {
        const resolve = pending.get(msg.requestId);
        pending.delete(msg.requestId);
        resolve(msg);
        return { parsed: true, routed: 'request', requestId: msg.requestId };
    }

    try {
        await handlers.handle(msg, discordClient);
    } catch (error) {
        console.error('[BotBridge] Failed to handle message:', error);
    }

    return { parsed: true, routed: 'event', type: msg.type };
};

const scheduleReconnect = () => {
    if (!client || reconnectTimer) return;

    disconnectedSince ??= Date.now();
    if (Date.now() - disconnectedSince >= ORPHAN_EXIT_AFTER_MS) {
        console.error('[BotBridge] Bridge unreachable for 60s, assuming the panel is gone. Exiting.');
        process.exit(0);
    }

    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect(client);
    }, 5000);
};

const flushQueuedMessages = () => {
    if (ws?.readyState !== WebSocket.OPEN) return;

    while (queuedMessages.length > 0) {
        ws.send(JSON.stringify(queuedMessages.shift()));
    }
};

const connect = (discordClient) => {
    client = discordClient;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
    }

    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    ws = new WebSocket(`ws://127.0.0.1:${process.env.BOT_BRIDGE_PORT}`);
    ws.on('open', () => {
        disconnectedSince = undefined;
        ws.send(JSON.stringify({ type: 'auth', secret: process.env.BOT_SECRET }));
        flushQueuedMessages();
    });
    ws.on('message', (raw) => {
        void handleIncomingMessage(raw, client);
    });
    ws.on('close', () => {
        ws = undefined;
        scheduleReconnect();
    });
    ws.on('error', (error) => {
        console.error('[BotBridge] WebSocket error:', error);
    });
};

const send = (msg) => {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        return;
    }

    queuedMessages.push(msg);
};

const request = (...args) => {
    return require('./requests').request(...args);
};

module.exports = {
    connect,
    handleIncomingMessage,
    send,
    request,
};
