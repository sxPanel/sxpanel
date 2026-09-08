import * as z from 'zod';

//Generic schemas
const zNetId = z.number().int().positive();

/**
 * txAdminPlayerlistEvent FD3 mini-trace payloads, produced by the monitor resource.
 */
export const PlayerlistJoiningSchema = z.object({
    type: z.literal('txAdminPlayerlistEvent'),
    event: z.literal('playerJoining'),
    id: zNetId,
    player: z.object({
        name: z.string(),
        ids: z.array(z.string()),
        hwids: z.array(z.string()),
    }),
});
export type PlayerlistJoiningType = z.infer<typeof PlayerlistJoiningSchema>;

export const PlayerlistDroppedSchema = z.object({
    type: z.literal('txAdminPlayerlistEvent'),
    event: z.literal('playerDropped'),
    id: zNetId,
    reason: z.string().optional(),
    resource: z.string().optional(),
    category: z.number().int().optional(),
});
export type PlayerlistDroppedType = z.infer<typeof PlayerlistDroppedSchema>;

export const PlayerlistEventSchema = z.discriminatedUnion('event', [PlayerlistJoiningSchema, PlayerlistDroppedSchema]);
export type PlayerlistEventType = z.infer<typeof PlayerlistEventSchema>;
