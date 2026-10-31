import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordLogBatcher, MAX_COMPONENTS_PER_MESSAGE, countComponents } from './logBatcher';
import type { DiscordLogMessagePayload } from './logRouting';

const makeCard = (text: string, extraTextDisplays = 0) => ({
    type: 17,
    components: [
        { type: 10, content: text },
        ...Array.from({ length: extraTextDisplays }, () => ({ type: 10, content: 'x' })),
    ],
});

const makePayload = (channelId: string, text: string, extraTextDisplays = 0): DiscordLogMessagePayload => ({
    channelId,
    guildId: null,
    flags: 1 << 15,
    components: [makeCard(text, extraTextDisplays)],
    allowedMentions: { parse: [] },
});

suite('DiscordLogBatcher', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('should count nested components and accessories', () => {
        expect(
            countComponents({
                type: 17,
                components: [{ type: 9, components: [{ type: 10 }], accessory: { type: 11 } }, { type: 14 }],
            }),
        ).toBe(5);
    });

    it('should combine queued cards for the same channel into a single message', () => {
        const send = vi.fn();
        const batcher = new DiscordLogBatcher({ send, flushIntervalMs: 1000 });

        batcher.enqueue(makePayload('111111111111111111', 'one'));
        batcher.enqueue(makePayload('111111111111111111', 'two'));
        batcher.enqueue(makePayload('222222222222222222', 'three'));
        expect(send).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1000);

        expect(send).toHaveBeenCalledTimes(2);
        const firstChannel = send.mock.calls.find(([payload]) => payload.channelId === '111111111111111111')![0];
        expect(firstChannel.components).toHaveLength(2);
        expect(JSON.stringify(firstChannel.components)).toContain('one');
        expect(JSON.stringify(firstChannel.components)).toContain('two');
        expect(batcher.pendingCount).toBe(0);
    });

    it('should split batches at the Discord component limit and pace the remaining messages', () => {
        const send = vi.fn();
        const batcher = new DiscordLogBatcher({ send, flushIntervalMs: 1000, maxMessagesPerFlush: 1 });

        //Each card is 1 container + 10 text displays = 11 components, so 3 fit per message
        for (let i = 0; i < 7; i++) {
            batcher.enqueue(makePayload('111111111111111111', `card-${i}`, 9));
        }

        vi.advanceTimersByTime(1000);
        expect(send).toHaveBeenCalledTimes(1);
        const firstBatch = send.mock.calls[0]![0] as DiscordLogMessagePayload;
        expect(firstBatch.components).toHaveLength(3);
        expect(firstBatch.components.reduce((sum, c) => sum + countComponents(c), 0)).toBeLessThanOrEqual(
            MAX_COMPONENTS_PER_MESSAGE,
        );

        vi.advanceTimersByTime(1000);
        vi.advanceTimersByTime(1000);
        expect(send).toHaveBeenCalledTimes(3);
        expect(send.mock.calls.map(([payload]) => payload.components.length)).toEqual([3, 3, 1]);
        expect(batcher.pendingCount).toBe(0);
    });

    it('should not put more than 10 cards in a single message', () => {
        const send = vi.fn();
        const batcher = new DiscordLogBatcher({ send, flushIntervalMs: 1000, maxMessagesPerFlush: 5 });

        for (let i = 0; i < 12; i++) {
            batcher.enqueue(makePayload('111111111111111111', `card-${i}`));
        }
        vi.advanceTimersByTime(1000);

        expect(send.mock.calls.map(([payload]) => payload.components.length)).toEqual([10, 2]);
    });

    it('should drop the oldest cards on overflow and report how many were skipped', () => {
        const send = vi.fn();
        const batcher = new DiscordLogBatcher({ send, flushIntervalMs: 1000, maxQueuedPerChannel: 3 });

        for (let i = 0; i < 5; i++) {
            batcher.enqueue(makePayload('111111111111111111', `card-${i}`));
        }
        vi.advanceTimersByTime(1000);

        const sent = JSON.stringify(send.mock.calls.map(([payload]) => payload.components));
        expect(sent).toContain('2 log entries were skipped due to high volume.');
        expect(sent).not.toContain('card-0');
        expect(sent).not.toContain('card-1');
        expect(sent).toContain('card-4');
    });

    it('should drop everything on clear', () => {
        const send = vi.fn();
        const batcher = new DiscordLogBatcher({ send, flushIntervalMs: 1000 });

        batcher.enqueue(makePayload('111111111111111111', 'one'));
        batcher.clear();
        vi.advanceTimersByTime(5000);

        expect(send).not.toHaveBeenCalled();
        expect(batcher.pendingCount).toBe(0);
    });
});
