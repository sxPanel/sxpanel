import * as z from 'zod';

//Generic schemas
const zAuthor = z.string().min(1);
const zNetId = z.number().int().positive();

/**
 * txAdminCommandBridge FD3 mini-trace payloads (announcement / kick / ban / warn),
 * produced by the txResource command bridge exports.
 */
const CommandBridgeAnnouncementSchema = z.object({
    type: z.literal('txAdminCommandBridge'),
    command: z.literal('announcement'),
    author: zAuthor,
    message: z.string().min(1),
});

const CommandBridgePunishSchema = z.object({
    type: z.literal('txAdminCommandBridge'),
    command: z.enum(['kick', 'ban', 'warn']),
    author: zAuthor,
    targetNetId: zNetId,
    reason: z.string().optional(),
    duration: z.string().optional(), // only meaningful for bans
});

/**
 * Server control bridge payloads (restart / stop), produced from the in-game
 * admin menu's "Server Controls" section. Requires the `control.server` perm,
 * which is checked resource-side before this trace is ever printed.
 */
const CommandBridgeServerControlSchema = z.object({
    type: z.literal('txAdminCommandBridge'),
    command: z.enum(['restartServer', 'stopServer']),
    author: zAuthor,
    reason: z.string().optional(),
});

export const CommandBridgeSchema = z.discriminatedUnion('command', [
    CommandBridgeAnnouncementSchema,
    CommandBridgePunishSchema,
    CommandBridgeServerControlSchema,
]);
export type CommandBridgeType = z.infer<typeof CommandBridgeSchema>;

/**
 * txAdminPlayerTag FD3 mini-trace payloads, produced by the player tag change exports.
 * netId may arrive as a number or a numeric string (FiveM server ids are strings in some contexts).
 */
const zNetIdOrNumericString = z.union([
    z.number().int(),
    z.string().refine((v) => Number.isFinite(parseInt(v, 10)), 'not a numeric netId'),
]);

export const PlayerTagChangeSchema = z.object({
    type: z.literal('txAdminPlayerTag'),
    action: z.enum(['add', 'remove']),
    tagId: z.string().min(1),
    netId: zNetIdOrNumericString,
});
export type PlayerTagChangeType = z.infer<typeof PlayerTagChangeSchema>;
