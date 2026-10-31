import { z } from 'zod';
import { typeDefinedConfig } from './utils';
import { SYM_FIXER_DEFAULT, SYM_FIXER_FATAL } from '@lib/symbols';
import { CustomCommand, CustomCommandsArraySchema } from '@shared/customCommands';

const AUTO_TAG_IDS = new Set(['staff', 'problematic', 'newplayer']);

const customTagSchema = z.object({
    id: z
        .string()
        .min(1)
        .max(32)
        .regex(/^[a-z0-9_]+$/),
    label: z.string().min(1).max(24),
    prefix: z.string().max(16).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    priority: z.number().int().min(1).max(999),
    enabled: z.boolean().default(true),
    discordRoleIds: z.array(z.string()).optional(),
});
export type CustomTagConfig = z.infer<typeof customTagSchema>;

const reportsEnabled = typeDefinedConfig({
    name: 'Reports Enabled',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const ticketCategories = typeDefinedConfig({
    name: 'Ticket Categories',
    default: ['Player Report', 'Bug Report', 'Question', 'Other'] as string[],
    validator: z.array(z.string().min(1).max(64)).min(1).max(20),
    fixer: SYM_FIXER_DEFAULT,
});

const ticketCategoryDescriptions = typeDefinedConfig({
    name: 'Ticket Category Descriptions',
    default: {
        'Player Report': 'Report a player for rule violations.',
        'Bug Report': 'Report a bug or server issue.',
        Question: 'Ask a question to staff.',
        Other: 'Anything else.',
    } as Record<string, string>,
    validator: z.record(z.string().min(1).max(128)),
    fixer: SYM_FIXER_DEFAULT,
});

const ticketPriorityEnabled = typeDefinedConfig({
    name: 'Ticket Priority Enabled',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const ticketFeedbackEnabled = typeDefinedConfig({
    name: 'Ticket Feedback Enabled',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const ticketRetentionDays = typeDefinedConfig({
    name: 'Ticket Retention Days',
    default: 30,
    validator: z.number().int().min(1).max(365),
    fixer: SYM_FIXER_DEFAULT,
});

const menuEnabled = typeDefinedConfig({
    name: 'Menu Enabled',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const menuAlignRight = typeDefinedConfig({
    name: 'Align Menu Right',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const menuPageKey = typeDefinedConfig({
    name: 'Menu Page Switch Key',
    default: 'Tab',
    validator: z.string().min(1),
    fixer: SYM_FIXER_DEFAULT,
});

const menuPlayerIdDistance = typeDefinedConfig({
    name: 'Overhead Player ID Distance (meters)',
    default: 150,
    validator: z.number().int().min(1).max(1000),
    fixer: SYM_FIXER_DEFAULT,
});

const overheadTwoRowLayout = typeDefinedConfig({
    name: 'Overhead Two-Row Layout',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const overheadSeatIcons = typeDefinedConfig({
    name: 'Overhead Vehicle Seat Icons',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const overheadNoclipIcon = typeDefinedConfig({
    name: 'Overhead Noclip Icon',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const playerModePtfx = typeDefinedConfig({
    name: 'Player Mode Change Effect',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const hideAdminInPunishments = typeDefinedConfig({
    name: 'Hide Admin Name In Punishments',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const hideAdminInMessages = typeDefinedConfig({
    name: 'Hide Admin Name In Messages',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const hideDefaultAnnouncement = typeDefinedConfig({
    name: 'Hide Announcement Notifications',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const hideDefaultDirectMessage = typeDefinedConfig({
    name: 'Hide Direct Message Notification',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const hideDefaultWarning = typeDefinedConfig({
    name: 'Hide Warning Notification',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const hideDefaultScheduledRestartWarning = typeDefinedConfig({
    name: 'Hide Scheduled Restart Warnings',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const combatLogEnabled = typeDefinedConfig({
    name: 'Combat Log Enabled',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const combatLogDamageSummaries = typeDefinedConfig({
    name: 'Combat Log Damage Summaries',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const combatLogEngagementWindow = typeDefinedConfig({
    name: 'Combat Log Engagement Window (seconds)',
    default: 10,
    validator: z.number().int().min(3).max(60),
    fixer: SYM_FIXER_DEFAULT,
});

const newplayerThreshold = typeDefinedConfig({
    name: 'New Player Tag Threshold (minutes)',
    default: 240,
    validator: z.number().int().min(0),
    fixer: SYM_FIXER_DEFAULT,
});

const customTags = typeDefinedConfig({
    name: 'Custom Player Tags',
    default: [] as CustomTagConfig[],
    validator: z
        .array(customTagSchema)
        .max(23)
        .superRefine((tags, ctx) => {
            const customCount = tags.filter((tag) => !AUTO_TAG_IDS.has(tag.id)).length;
            if (customCount > 20) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'At most 20 custom (non built-in) tags are allowed.',
                });
            }
            const seenIds = new Set<string>();
            for (const tag of tags) {
                if (seenIds.has(tag.id)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Duplicate tag id: ${tag.id}`,
                    });
                    break;
                }
                seenIds.add(tag.id);
            }
        }),
    fixer: SYM_FIXER_DEFAULT,
});

const customCommands = typeDefinedConfig({
    name: 'Custom Chat Commands',
    default: [] as CustomCommand[],
    validator: CustomCommandsArraySchema,
    //NOTE: if the config file got manually broken, we don't want to wipe out the commands
    fixer: SYM_FIXER_FATAL,
});

export default {
    reportsEnabled,
    ticketCategories,
    ticketCategoryDescriptions,
    ticketPriorityEnabled,
    ticketFeedbackEnabled,
    ticketRetentionDays,
    menuEnabled,
    menuAlignRight,
    menuPageKey,
    menuPlayerIdDistance,
    overheadTwoRowLayout,
    overheadSeatIcons,
    overheadNoclipIcon,
    playerModePtfx,
    hideAdminInPunishments,
    hideAdminInMessages,
    hideDefaultAnnouncement,
    hideDefaultDirectMessage,
    hideDefaultWarning,
    hideDefaultScheduledRestartWarning,
    combatLogEnabled,
    combatLogDamageSummaries,
    combatLogEngagementWindow,
    newplayerThreshold,
    customTags,
    customCommands,
} as const;
