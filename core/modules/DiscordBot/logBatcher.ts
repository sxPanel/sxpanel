import type { DiscordLogMessagePayload } from './logRouting';
import { discordComponentTypes, discordMessageFlagIsComponentsV2 } from './componentsV2';

/*
    Batches routed log cards per channel, so bursts (combat, chat, joins) become a few
    messages instead of one message per event, which would quickly hit Discord's
    per-channel rate limit (~5 messages / 5s) and lag every other log behind it.

    Each queued card is a top-level Components V2 container. On flush, cards are packed
    into messages while respecting Discord's limits for a single V2 message.
*/

//Discord limits for a single Components V2 message
export const MAX_COMPONENTS_PER_MESSAGE = 40;
export const MAX_TEXT_CHARS_PER_MESSAGE = 4000;
export const MAX_CARDS_PER_MESSAGE = 10;

type LogCard = {
    container: Record<string, unknown>;
    componentCount: number;
    textLength: number;
};

type ChannelQueue = {
    channelId: string;
    guildId: string | null;
    allowedMentions?: Record<string, unknown>;
    cards: LogCard[];
    dropped: number;
};

export type DiscordLogBatcherOptions = {
    send: (payload: DiscordLogMessagePayload) => unknown;
    flushIntervalMs?: number;
    maxMessagesPerFlush?: number;
    maxQueuedPerChannel?: number;
};

/**
 * Counts every component in a tree, as Discord does for the 40 components limit.
 */
export const countComponents = (component: unknown): number => {
    if (!component || typeof component !== 'object') return 0;
    const obj = component as Record<string, unknown>;
    let count = typeof obj.type === 'number' ? 1 : 0;
    if (Array.isArray(obj.components)) {
        for (const child of obj.components) count += countComponents(child);
    }
    if (obj.accessory) count += countComponents(obj.accessory);
    return count;
};

/**
 * Sums the length of all text display contents in a tree.
 */
export const countTextLength = (component: unknown): number => {
    if (!component || typeof component !== 'object') return 0;
    const obj = component as Record<string, unknown>;
    let length = typeof obj.content === 'string' ? obj.content.length : 0;
    if (Array.isArray(obj.components)) {
        for (const child of obj.components) length += countTextLength(child);
    }
    if (obj.accessory) length += countTextLength(obj.accessory);
    return length;
};

const buildDroppedNotice = (dropped: number): LogCard => {
    const content = `-# ${dropped} log ${dropped === 1 ? 'entry was' : 'entries were'} skipped due to high volume.`;
    return {
        container: { type: discordComponentTypes.textDisplay, content },
        componentCount: 1,
        textLength: content.length,
    };
};

export class DiscordLogBatcher {
    readonly #send: DiscordLogBatcherOptions['send'];
    readonly #flushIntervalMs: number;
    readonly #maxMessagesPerFlush: number;
    readonly #maxQueuedPerChannel: number;
    readonly #queues = new Map<string, ChannelQueue>();
    #flushTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(options: DiscordLogBatcherOptions) {
        this.#send = options.send;
        this.#flushIntervalMs = options.flushIntervalMs ?? 2_000;
        this.#maxMessagesPerFlush = options.maxMessagesPerFlush ?? 2;
        this.#maxQueuedPerChannel = options.maxQueuedPerChannel ?? 150;
    }

    get pendingCount() {
        let count = 0;
        for (const queue of this.#queues.values()) count += queue.cards.length;
        return count;
    }

    /**
     * Queues the cards of a routed log payload for its channel.
     */
    enqueue(payload: DiscordLogMessagePayload) {
        const key = `${payload.guildId ?? ''}:${payload.channelId}`;
        let queue = this.#queues.get(key);
        if (!queue) {
            queue = {
                channelId: payload.channelId,
                guildId: payload.guildId,
                allowedMentions: payload.allowedMentions,
                cards: [],
                dropped: 0,
            };
            this.#queues.set(key, queue);
        }

        for (const container of payload.components) {
            queue.cards.push({
                container,
                componentCount: countComponents(container),
                textLength: countTextLength(container),
            });
        }

        //Drop the oldest cards if the channel can't keep up
        const overflow = queue.cards.length - this.#maxQueuedPerChannel;
        if (overflow > 0) {
            queue.cards.splice(0, overflow);
            queue.dropped += overflow;
        }

        this.#scheduleFlush();
    }

    /**
     * Sends up to maxMessagesPerFlush messages per channel, leaving the rest queued.
     */
    flush() {
        this.#flushTimer = undefined;
        for (const [key, queue] of this.#queues) {
            if (queue.dropped > 0) {
                queue.cards.unshift(buildDroppedNotice(queue.dropped));
                queue.dropped = 0;
            }

            for (let i = 0; i < this.#maxMessagesPerFlush && queue.cards.length; i++) {
                const batch = this.#takeBatch(queue);
                this.#send({
                    channelId: queue.channelId,
                    guildId: queue.guildId,
                    flags: discordMessageFlagIsComponentsV2,
                    components: batch.map((card) => card.container),
                    allowedMentions: queue.allowedMentions ?? { parse: [] },
                });
            }

            if (!queue.cards.length) this.#queues.delete(key);
        }

        if (this.#queues.size) this.#scheduleFlush();
    }

    /**
     * Drops everything queued (eg. bot disabled or restarted).
     */
    clear() {
        if (this.#flushTimer) clearTimeout(this.#flushTimer);
        this.#flushTimer = undefined;
        this.#queues.clear();
    }

    #takeBatch(queue: ChannelQueue) {
        const batch: LogCard[] = [];
        let components = 0;
        let textLength = 0;
        while (queue.cards.length) {
            const next = queue.cards[0]!;
            const fits =
                batch.length < MAX_CARDS_PER_MESSAGE &&
                components + next.componentCount <= MAX_COMPONENTS_PER_MESSAGE &&
                textLength + next.textLength <= MAX_TEXT_CHARS_PER_MESSAGE;
            //Always take at least one card, even if oversized, so the queue can't get stuck
            if (!fits && batch.length) break;
            batch.push(queue.cards.shift()!);
            components += next.componentCount;
            textLength += next.textLength;
        }
        return batch;
    }

    #scheduleFlush() {
        if (this.#flushTimer) return;
        this.#flushTimer = setTimeout(() => this.flush(), this.#flushIntervalMs);
        this.#flushTimer.unref?.();
    }
}
