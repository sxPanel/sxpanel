import xssInstancer from '@lib/xss';
import type { DeferralScenarioId } from '@shared/deferralCardTypes';
import {
    DEFAULT_DEFERRAL_CARDS_CONFIG,
    normalizeDeferralCardsConfig,
    resolveDeferralDiscordInvite,
    resolveDeferralScenarioShowLogo,
} from '@shared/deferralCardTypes';
import type { DeferralCardTemplate, DeferralCardsConfig } from '@shared/deferralCardTypes';
import { isAddonDeferralScenarioId } from '@shared/deferralAddonTypes';
import type { DeferralResolveTokensPlayerContext } from '@shared/deferralAddonTypes';
import { buildConnectionQueueAdaptiveCard } from '@shared/deferralCardAdaptive';
import {
    applyCustomPlaceholders,
    applyDeferralMarkupTags,
    buildDeferralCardFromLayout,
    buildDeferralCardHtml,
    resolveDeferralAssetBaseUrl,
    resolveDeferralLogoUrl,
    type DeferralCardTokens,
    type RenderDeferralCardInput,
} from '@shared/deferralCardRender';
import { syncLegacyFieldsFromLayout, templateHasVisualLayout } from '@shared/deferralCardLayout';
import { getDeferralWatermarkDataUri } from '@lib/deferralWatermark';
import { txHostConfig } from '@core/globalData';

export type { DeferralCardTokens, RenderDeferralCardInput };

const xss = xssInstancer();

export function prepCustomMessage(msg: string) {
    if (!msg) return '';
    return '<br>' + msg.trim().replaceAll(/\n/g, '<br>');
}

export function applyDeferralTokens(
    template: string,
    tokens: DeferralCardTokens,
    customPlaceholders: import('@shared/deferralCardLayout').DeferralCustomPlaceholder[] = [],
    dynamicValues: Record<string, string> = {},
) {
    let content = template;
    content = content.replaceAll('{requestId}', tokens.requestId ?? '');
    content = content.replaceAll('{tierName}', xss(tokens.tierName ?? ''));
    content = content.replaceAll('{customMessage}', prepCustomMessage(tokens.customMessage ?? ''));
    content = content.replaceAll('{guildName}', xss(tokens.guildName ?? ''));
    content = content.replaceAll('{discordInvite}', xss(tokens.discordInvite ?? ''));
    content = content.replaceAll('{serverName}', xss(tokens.serverName ?? ''));
    content = content.replaceAll('{playerName}', xss(tokens.playerName ?? ''));
    content = content.replaceAll('{queuePosition}', xss(tokens.queuePosition ?? ''));
    content = content.replaceAll('{queueSize}', xss(tokens.queueSize ?? ''));
    content = content.replaceAll('{queueEta}', xss(tokens.queueEta ?? ''));
    content = content.replaceAll('{banReason}', xss(tokens.banReason ?? ''));
    content = content.replaceAll('{banExpires}', xss(tokens.banExpires ?? ''));
    content = content.replaceAll('{banId}', xss(tokens.banId ?? ''));
    content = content.replaceAll('{banDate}', xss(tokens.banDate ?? ''));
    content = content.replaceAll('{banAuthor}', xss(tokens.banAuthor ?? ''));
    for (const [key, val] of Object.entries(dynamicValues)) {
        content = content.replaceAll(`{${key}}`, xss(val));
    }
    content = applyCustomPlaceholders(content, customPlaceholders, (v) => xss(v));
    return applyDeferralMarkupTags(content);
}

function templateTextBlob(template: DeferralCardTemplate): string {
    const parts = [template.title, template.bodyTemplate, JSON.stringify(template.layout ?? {})];
    return parts.join('\n');
}

function collectDynamicTokenKeys(scenarioId: string, template: DeferralCardTemplate): string[] {
    const mgr = txCore.addonManager;
    if (!mgr || !isAddonDeferralScenarioId(scenarioId)) return [];
    const blob = templateTextBlob(template);
    const meta = mgr.getDeferralAddonMeta();
    const keys: string[] = [];
    for (const row of meta.tokens) {
        if (blob.includes(`{${row.key}}`)) keys.push(row.key);
    }
    return keys;
}

async function resolveDynamicTokenValues(
    scenarioId: string,
    template: DeferralCardTemplate,
    player: DeferralResolveTokensPlayerContext,
): Promise<Record<string, string>> {
    const keys = collectDynamicTokenKeys(scenarioId, template);
    if (!keys.length) return {};
    return (await txCore.addonManager?.resolveDeferralDynamicTokens(scenarioId, keys, player)) ?? {};
}

export function getDeferralCardsConfig(): DeferralCardsConfig {
    const wl = txConfig.whitelist;
    const legacy = wl.deferralCard as DeferralCardTemplate | undefined;
    if (wl.deferralCards) {
        return normalizeDeferralCardsConfig(wl.deferralCards, legacy);
    }
    return normalizeDeferralCardsConfig(DEFAULT_DEFERRAL_CARDS_CONFIG, legacy);
}

export function getDeferralScenarioTemplate(scenario: string): DeferralCardTemplate {
    const config = getDeferralCardsConfig();
    if (isAddonDeferralScenarioId(scenario)) {
        const saved = config.addonScenarios?.[scenario];
        if (saved) return syncLegacyFieldsFromLayout(saved);
        const def = txCore.addonManager?.getAddonDeferralDefaultTemplate(scenario);
        if (def) return syncLegacyFieldsFromLayout(def);
        return syncLegacyFieldsFromLayout({
            title: 'Access Denied',
            bodyTemplate: '{customMessage}',
            showRequestId: false,
            showTierName: false,
        });
    }
    const coreId = scenario as DeferralScenarioId;
    return config.scenarios[coreId] ?? DEFAULT_DEFERRAL_CARDS_CONFIG.scenarios[coreId];
}

export { buildDeferralCardHtml };
export const buildDeferralCard = buildDeferralCardHtml;

export async function renderDeferralCard(input: RenderDeferralCardInput): Promise<string> {
    const config = getDeferralCardsConfig();
    const template = syncLegacyFieldsFromLayout(getDeferralScenarioTemplate(input.scenario));
    const guildName = input.guildName ?? txCore.discordBot.guildName ?? '';
    const serverName = input.serverName ?? txConfig.general?.serverName ?? '';
    const showLogo = resolveDeferralScenarioShowLogo(template, config.skin);

    const assetBaseUrl =
        input.assetBaseUrl ??
        resolveDeferralAssetBaseUrl({
            txaUrl: txHostConfig.txaUrl,
            txaPort: txHostConfig.txaPort,
            netInterface: txHostConfig.netInterface,
        });

    // No reachable panel endpoint in-game (no TXHOST_TXA_URL / interface): inline the
    // watermark as a data URI, matching the custom-image fallback — the HTTP route
    // would resolve to loopback and 404 on the connecting client.
    const logoSrc =
        (assetBaseUrl === null ? getDeferralWatermarkDataUri() : null) ??
        resolveDeferralLogoUrl({
            txaUrl: txHostConfig.txaUrl,
            txaPort: txHostConfig.txaPort,
            netInterface: txHostConfig.netInterface,
        });

    let body = input.body ?? '';
    if (template.showRequestId && input.requestId && !templateHasVisualLayout(template)) {
        body += `<br><strong>Request ID:</strong> <codeid>${input.requestId}</codeid>`;
    }
    if (template.showTierName && input.tierName && !templateHasVisualLayout(template)) {
        body += `<br><strong>Tier:</strong> ${xss(input.tierName)}`;
    }

    const playerCtx: DeferralResolveTokensPlayerContext = {
        license: input.license,
        playerName: input.playerName,
        discordId: input.discordId,
        identifiers: input.identifiers,
    };

    const dynamicValues = await resolveDynamicTokenValues(input.scenario, template, playerCtx);

    const tokenPayload: DeferralCardTokens = {
        requestId: input.requestId,
        tierName: input.tierName,
        customMessage: body,
        guildName,
        discordInvite: input.discordInvite ?? resolveDeferralDiscordInvite(config),
        serverName,
        playerName: input.playerName,
        queuePosition:
            input.queuePosition === null || typeof input.queuePosition === 'undefined'
                ? undefined
                : String(input.queuePosition),
        queueSize:
            input.queueSize === null || typeof input.queueSize === 'undefined' ? undefined : String(input.queueSize),
        queueEta: input.queueEta,
        title: input.title,
        body,
        banReason: input.banReason,
        banExpires: input.banExpires,
        banId: input.banId,
        banDate: input.banDate,
        banAuthor: input.banAuthor,
    };

    const applyWithDynamic = (tpl: string, tok: DeferralCardTokens, custom: typeof template.customPlaceholders) =>
        applyDeferralTokens(tpl, tok, custom, dynamicValues);

    if (templateHasVisualLayout(template)) {
        return buildDeferralCardFromLayout(template, tokenPayload, showLogo, logoSrc, {
            applyTokens: applyWithDynamic,
            renderCtx: { scenarioId: input.scenario, assetBaseUrl },
        });
    }

    const resolvedTitle = applyWithDynamic(
        template.title || input.title || 'Access Denied',
        tokenPayload,
        template.customPlaceholders,
    );

    const bodyTemplate = template.bodyTemplate?.trim() ? template.bodyTemplate : '{customMessage}';
    let content = applyWithDynamic(bodyTemplate, tokenPayload, template.customPlaceholders);
    if (body.trim() && !bodyTemplate.includes('{customMessage}')) {
        content += prepCustomMessage(body);
    }

    return buildDeferralCardHtml(resolvedTitle, content, showLogo, logoSrc);
}

/** Queue deferrals must use Adaptive Cards — FiveM does not render HTML in deferrals.update(). */
export async function renderDeferralQueueAdaptiveCard(input: RenderDeferralCardInput): Promise<string> {
    const config = getDeferralCardsConfig();
    const template = syncLegacyFieldsFromLayout(getDeferralScenarioTemplate('connection_queue'));
    const serverName = input.serverName ?? txConfig.general?.serverName ?? '';

    const dynamicValues = await resolveDynamicTokenValues('connection_queue', template, {
        license: input.license,
        playerName: input.playerName,
        discordId: input.discordId,
        identifiers: input.identifiers,
    });

    const applyWithDynamic = (tpl: string, tok: DeferralCardTokens, custom: typeof template.customPlaceholders) =>
        applyDeferralTokens(tpl, tok, custom, dynamicValues);

    const tokenPayload: DeferralCardTokens = {
        requestId: input.requestId,
        tierName: input.tierName,
        customMessage: input.body ?? '',
        guildName: input.guildName ?? txCore.discordBot.guildName ?? '',
        discordInvite: input.discordInvite ?? resolveDeferralDiscordInvite(config),
        serverName,
        playerName: input.playerName,
        queuePosition:
            input.queuePosition === null || typeof input.queuePosition === 'undefined'
                ? undefined
                : String(input.queuePosition),
        queueSize:
            input.queueSize === null || typeof input.queueSize === 'undefined' ? undefined : String(input.queueSize),
        queueEta: input.queueEta,
        title: input.title,
        body: input.body ?? '',
        banReason: input.banReason,
        banExpires: input.banExpires,
        banId: input.banId,
        banDate: input.banDate,
        banAuthor: input.banAuthor,
    };

    return buildConnectionQueueAdaptiveCard(template, tokenPayload, applyWithDynamic);
}
