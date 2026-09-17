import { useState } from 'react';
import type { DeferralCardTemplate } from '@shared/deferralCardTypes';
import {
    applyDeferralTokensPreview,
    applyDeferralMarkupTags,
    deferralSupplementalMessageEmpty,
    resolveDeferralIdDisplay,
    type DeferralCardTokens,
} from '@shared/deferralCardRender';
import { resolveDeferralElementContent } from '@shared/deferralCardBan';
import type { DeferralCanvasElement } from '@shared/deferralCardCanvas';
import {
    DEFERRAL_CANVAS_SNAP_GRID,
    DEFERRAL_CARD_MARGIN_TOP,
    DEFERRAL_CARD_PADDING,
    estimateCanvasElementSize,
    getCanvasContentWidth,
    resolveTextLineContent,
    applyCanvasCenterSnap,
    snapDeferralCoord,
    splitCustomMessageParts,
    resolveDeferralLogoPlacement,
} from '@shared/deferralCardCanvas';
import { cn } from '@/lib/utils';
import { useLocale } from '@/hooks/locale';
import type { LocaleT } from './deferralStudioLocale';
import type { DeferralBlockType } from '@shared/deferralCardLayout';
import { deferralBlockLabel } from './deferralStudioLocale';
import { DeferralStudioAnimatedImage } from './DeferralStudioAnimatedImage';
import {
    buildDeferralButtonAnchorStyle,
    parseDeferralButtonContent,
    sanitizeDeferralButtonUrl,
} from '@shared/deferralCardButton';
import { DEFERRAL_TXADMIN_WATERMARK_OPACITY } from '@shared/deferralCardWatermark';
import { DEFERRAL_CARD_WATERMARK_PATH } from '@shared/deferralCardLogo';

type CenterGuideState = { vertical: boolean; horizontal: boolean };

type DeferralStudioCardProps = {
    cardWidth: number;
    cardHeight: number;
    elements: DeferralCanvasElement[];
    selectedId: string | null;
    showLogo: boolean;
    showGrid: boolean;
    snapToGrid: boolean;
    template: DeferralCardTemplate;
    tokens: DeferralCardTokens;
    onSelect: (id: string | null) => void;
    onMoveElement: (id: string, x: number, y: number) => void;
};

export function DeferralStudioCard({
    cardWidth,
    cardHeight,
    elements,
    selectedId,
    showLogo,
    showGrid,
    snapToGrid,
    template,
    tokens,
    onSelect,
    onMoveElement,
}: DeferralStudioCardProps) {
    const { t } = useLocale();
    const [centerGuides, setCenterGuides] = useState<CenterGuideState | null>(null);
    const contentWidth = getCanvasContentWidth(cardWidth);
    const innerHeight = cardHeight - DEFERRAL_CARD_PADDING * 2;
    return (
        <div
            className="relative shrink-0"
            style={{ width: cardWidth, marginTop: DEFERRAL_CARD_MARGIN_TOP }}
            onClick={() => onSelect(null)}
            onKeyDown={(e) => e.key === 'Escape' && onSelect(null)}
            role="presentation"
        >
            <div
                className="relative overflow-hidden"
                style={{
                    width: cardWidth,
                    height: cardHeight,
                    backgroundColor: 'rgba(30, 30, 30, 0.5)',
                    padding: DEFERRAL_CARD_PADDING,
                    border: 'solid 1.5px #80282B',
                    borderRadius: 8,
                    boxSizing: 'border-box',
                }}
            >
                <div className="relative" style={{ width: contentWidth, height: innerHeight, margin: '0 auto' }}>
                    {showGrid ? (
                        <div
                            className="pointer-events-none absolute inset-0 z-0"
                            style={{
                                backgroundImage: `
                                    linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px),
                                    linear-gradient(to bottom, rgba(255,255,255,0.07) 1px, transparent 1px)
                                `,
                                backgroundSize: `${DEFERRAL_CANVAS_SNAP_GRID}px ${DEFERRAL_CANVAS_SNAP_GRID}px`,
                            }}
                            aria-hidden
                        />
                    ) : null}
                    {centerGuides ? (
                        <div className="pointer-events-none absolute inset-0 z-[2]" aria-hidden>
                            {centerGuides.vertical ? (
                                <div
                                    className="absolute top-0 bottom-0"
                                    style={{
                                        left: '50%',
                                        width: 0,
                                        borderLeft: '1px solid rgba(96,165,250,0.85)',
                                        transform: 'translateX(-50%)',
                                    }}
                                />
                            ) : null}
                            {centerGuides.horizontal ? (
                                <div
                                    className="absolute right-0 left-0"
                                    style={{
                                        top: '50%',
                                        height: 0,
                                        borderTop: '1px solid rgba(96,165,250,0.85)',
                                        transform: 'translateY(-50%)',
                                    }}
                                />
                            ) : null}
                        </div>
                    ) : null}
                    {elements.map((el) => {
                        if (el.enabled === false) return null;
                        if (el.type === 'logo') {
                            if (!showLogo) return null;
                            return (
                                <StudioWatermarkLogo
                                    key={el.id}
                                    element={el}
                                    contentWidth={contentWidth}
                                    innerHeight={innerHeight}
                                    isSelected={selectedId === el.id}
                                    onSelect={() => onSelect(el.id)}
                                    onMove={(x, y) => onMoveElement(el.id, x, y)}
                                    t={t}
                                />
                            );
                        }
                        return (
                            <StudioElement
                                key={el.id}
                                element={el}
                                template={template}
                                tokens={tokens}
                                showLogo={showLogo}
                                snapToGrid={snapToGrid}
                                contentWidth={contentWidth}
                                innerHeight={innerHeight}
                                elements={elements}
                                isSelected={selectedId === el.id}
                                onSelect={() => onSelect(el.id)}
                                onMove={(x, y) => onMoveElement(el.id, x, y)}
                                onCenterGuidesChange={setCenterGuides}
                                t={t}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

type StudioElementProps = {
    element: DeferralCanvasElement;
    template: DeferralCardTemplate;
    tokens: DeferralCardTokens;
    showLogo: boolean;
    snapToGrid: boolean;
    contentWidth: number;
    innerHeight: number;
    elements: DeferralCanvasElement[];
    isSelected: boolean;
    onSelect: () => void;
    onMove: (x: number, y: number) => void;
    onCenterGuidesChange: (guides: CenterGuideState | null) => void;
    t: LocaleT;
};

function StudioElement({
    element,
    template,
    tokens,
    showLogo,
    snapToGrid,
    contentWidth,
    innerHeight,
    elements,
    isSelected,
    onSelect,
    onMove,
    onCenterGuidesChange,
    t,
}: StudioElementProps) {
    /** Local position while dragging — avoids parent re-renders (and PageHeader jotai churn) per frame. */
    const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

    if (element.type === 'logo' && !showLogo) return null;

    const size = estimateCanvasElementSize(element, contentWidth);
    const width = size.width;
    const height = size.height;

    const messageParts = splitCustomMessageParts(tokens.customMessage ?? '');
    const textElements = elements
        .filter((e) => (e.type === 'text' || e.type === 'paragraph') && e.enabled !== false)
        .sort((a, b) => a.y - b.y || a.x - b.x);
    const textLineIndex =
        element.type === 'text' || element.type === 'paragraph'
            ? textElements.findIndex((t) => t.id === element.id)
            : 0;

    const applyTokens = (text: string) => applyDeferralTokensPreview(text, tokens, template.customPlaceholders ?? []);

    const posX = dragPos?.x ?? element.x;
    const posY = dragPos?.y ?? element.y;

    const handlePointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        onSelect();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = element.x;
        const origY = element.y;
        let curX = origX;
        let curY = origY;
        const maxX = Math.max(0, contentWidth - width);
        const maxY = Math.max(0, innerHeight - height);

        const onPointerMove = (ev: PointerEvent) => {
            let nx = Math.max(0, Math.min(maxX, origX + (ev.clientX - startX)));
            let ny = Math.max(0, Math.min(maxY, origY + (ev.clientY - startY)));
            if (snapToGrid) {
                nx = snapDeferralCoord(nx);
                ny = snapDeferralCoord(ny);
            }
            const centered = applyCanvasCenterSnap(nx, ny, width, height, contentWidth, innerHeight);
            nx = centered.x;
            ny = centered.y;
            if (centered.showVerticalGuide || centered.showHorizontalGuide) {
                onCenterGuidesChange({
                    vertical: centered.showVerticalGuide,
                    horizontal: centered.showHorizontalGuide,
                });
            } else {
                onCenterGuidesChange(null);
            }
            curX = nx;
            curY = ny;
            setDragPos({ x: curX, y: curY });
        };

        const endDrag = (commit: boolean) => {
            target.releasePointerCapture(e.pointerId);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
            setDragPos(null);
            onCenterGuidesChange(null);
            if (commit) {
                onMove(curX, curY);
            }
        };

        const onPointerUp = () => endDrag(true);
        const onPointerCancel = () => endDrag(false);

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
    };

    const inner = renderElementContent(element, template, tokens, applyTokens, textLineIndex, messageParts, t);

    const isTextLike =
        element.type === 'heading' ||
        element.type === 'text' ||
        element.type === 'paragraph' ||
        element.type === 'custom_text' ||
        element.type === 'request_id' ||
        element.type === 'ban_id' ||
        element.type === 'ban_expires' ||
        element.type === 'tier_name';

    const hitWidth = isTextLike ? Math.min(width, contentWidth) : width;

    return (
        <div
            className={cn('pointer-events-none absolute', isTextLike ? 'block' : 'inline-flex')}
            style={
                isTextLike
                    ? { left: posX, top: posY, width: hitWidth, minHeight: height, height: 'auto' }
                    : { left: posX, top: posY, width, height }
            }
        >
            <div
                role="button"
                tabIndex={0}
                aria-label={t('panel.deferral_studio.card.drag_aria', {
                    type: deferralBlockLabel(t, element.type as DeferralBlockType),
                })}
                className={cn(
                    'pointer-events-auto cursor-grab touch-none select-none active:cursor-grabbing',
                    isTextLike ? 'inline-block max-w-full' : 'h-full w-full',
                    isSelected
                        ? 'ring-primary ring-offset-background ring-2 ring-offset-2'
                        : 'hover:ring-primary/40 hover:ring-1',
                )}
                style={
                    isTextLike
                        ? { width: 'max-content', maxWidth: hitWidth, minHeight: height }
                        : { width: '100%', height: '100%' }
                }
                onPointerDown={handlePointerDown}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelect();
                }}
            >
                <div className={cn(isTextLike ? '' : 'h-full w-full overflow-hidden')}>{inner}</div>
            </div>
        </div>
    );
}

function StudioWatermarkLogo({
    element,
    contentWidth,
    innerHeight,
    isSelected,
    onSelect,
    onMove,
    t,
}: {
    element: DeferralCanvasElement;
    contentWidth: number;
    innerHeight: number;
    isSelected: boolean;
    onSelect: () => void;
    onMove: (x: number, y: number) => void;
    t: LocaleT;
}) {
    const placed = resolveDeferralLogoPlacement(element, contentWidth, innerHeight);
    const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
    const posX = dragPos?.x ?? placed.x;
    const posY = dragPos?.y ?? placed.y;

    const handlePointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        onSelect();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = placed.x;
        const origY = placed.y;
        let curX = origX;
        let curY = origY;
        const maxX = Math.max(0, contentWidth - placed.width);
        const maxY = Math.max(0, innerHeight - placed.height);

        const onPointerMove = (ev: PointerEvent) => {
            curX = Math.max(0, Math.min(maxX, origX + (ev.clientX - startX)));
            curY = Math.max(0, Math.min(maxY, origY + (ev.clientY - startY)));
            setDragPos({ x: curX, y: curY });
        };

        const endDrag = (commit: boolean) => {
            target.releasePointerCapture(e.pointerId);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
            setDragPos(null);
            if (commit) onMove(curX, curY);
        };

        const onPointerUp = () => endDrag(true);
        const onPointerCancel = () => endDrag(false);

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
    };

    return (
        <div
            role="button"
            tabIndex={0}
            aria-label={t('panel.deferral_studio.card.watermark_aria')}
            className={cn(
                'absolute cursor-grab touch-none select-none active:cursor-grabbing',
                isSelected
                    ? 'ring-primary ring-offset-background ring-2 ring-offset-2'
                    : 'hover:ring-primary/40 hover:ring-1',
            )}
            style={{
                left: posX,
                top: posY,
                width: placed.width,
                height: placed.height,
                lineHeight: 0,
            }}
            onPointerDown={handlePointerDown}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect();
            }}
        >
            <img
                src={DEFERRAL_CARD_WATERMARK_PATH}
                alt=""
                className="pointer-events-none h-full w-full object-contain"
                style={{ opacity: DEFERRAL_TXADMIN_WATERMARK_OPACITY }}
            />
        </div>
    );
}

function renderElementContent(
    el: DeferralCanvasElement,
    template: DeferralCardTemplate,
    tokens: DeferralCardTokens,
    applyTokens: (text: string) => string,
    textLineIndex: number,
    messageParts: string[],
    t: LocaleT,
) {
    const fontSize = el.style?.fontSize ?? (el.type === 'heading' ? 22 : 18);

    switch (el.type) {
        case 'heading': {
            const text = resolveDeferralElementContent(
                el.content?.trim() || template.title || t('panel.deferral_studio.card.default_heading'),
                tokens,
            );
            return (
                <h2
                    className="m-0 leading-tight text-[#eee]"
                    style={{ fontSize }}
                    dangerouslySetInnerHTML={{ __html: applyTokens(text) }}
                />
            );
        }
        case 'text':
        case 'paragraph':
        case 'custom_text': {
            if (el.type === 'custom_text') {
                const raw = el.content?.trim() ?? '';
                const html = applyTokens(resolveDeferralElementContent(raw, tokens));
                if (raw.includes('{customMessage}') && deferralSupplementalMessageEmpty(html)) {
                    return null;
                }
                return (
                    <p
                        className="m-0 leading-snug whitespace-pre-wrap text-[#eee]"
                        style={{ fontSize }}
                        dangerouslySetInnerHTML={{ __html: html }}
                    />
                );
            }
            const html = resolveTextLineContent(el, tokens, template, textLineIndex, messageParts, (text) =>
                applyDeferralMarkupTags(applyTokens(resolveDeferralElementContent(text, tokens))),
            );
            return (
                <p
                    className="m-0 leading-snug text-[#eee]"
                    style={{ fontSize }}
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            );
        }
        case 'rejection_message': {
            const html = applyDeferralMarkupTags(
                applyTokens(resolveDeferralElementContent(tokens.customMessage ?? '', tokens)),
            );
            if (deferralSupplementalMessageEmpty(html)) return null;
            return (
                <p
                    className="m-0 leading-snug whitespace-pre-wrap text-[#eee]"
                    style={{ fontSize }}
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            );
        }
        case 'request_id': {
            const display = resolveDeferralIdDisplay(tokens);
            if (!display) return null;
            return (
                <p className="m-0 leading-snug whitespace-nowrap text-[#eee]" style={{ fontSize }}>
                    <strong>{display.label}:</strong>{' '}
                    <code
                        style={{
                            letterSpacing: '2px',
                            backgroundColor: '#ff7f5059',
                            padding: '2px 4px',
                            borderRadius: '6px',
                            fontSize: 'inherit',
                        }}
                    >
                        {display.id}
                    </code>
                </p>
            );
        }
        case 'ban_id':
            return (
                <p className="m-0 leading-snug whitespace-nowrap text-[#eee]" style={{ fontSize }}>
                    <strong>{t('panel.deferral_studio.card.ban_id_label')}</strong>{' '}
                    <code
                        style={{
                            letterSpacing: '2px',
                            backgroundColor: '#ff7f5059',
                            padding: '2px 4px',
                            borderRadius: '6px',
                            fontSize: 'inherit',
                        }}
                    >
                        {tokens.banId ?? 'A12345'}
                    </code>
                </p>
            );
        case 'ban_reason':
            return (
                <p className="m-0 leading-snug break-words text-[#eee]" style={{ fontSize }}>
                    <strong>{t('panel.deferral_studio.card.ban_reason_label')}</strong>{' '}
                    {tokens.banReason ?? 'Example ban'}
                </p>
            );
        case 'ban_expires':
            return (
                <p className="m-0 leading-snug whitespace-nowrap text-[#eee]" style={{ fontSize }}>
                    <strong>{t('panel.deferral_studio.card.ban_expires_label')}</strong>{' '}
                    {tokens.banExpires ?? 'in 2 days'}
                </p>
            );
        case 'tier_name':
            if (!template.showTierName) return null;
            return (
                <p className="m-0 leading-snug whitespace-nowrap text-[#eee]" style={{ fontSize }}>
                    <strong>{t('panel.deferral_studio.card.tier_label')}</strong> {tokens.tierName ?? 'Default'}
                </p>
            );
        case 'spacer':
            return <div className="h-full min-h-[8px]" />;
        case 'divider':
            return <div className="m-0 h-0 w-full border-t border-[#555]" />;
        case 'logo':
            return null;
        case 'button': {
            const btn = parseDeferralButtonContent(el.content);
            const label = applyDeferralTokensPreview(btn.label, tokens, template.customPlaceholders ?? []);
            const href = sanitizeDeferralButtonUrl(
                applyDeferralTokensPreview(btn.url, tokens, template.customPlaceholders ?? []),
            );
            if (!href) {
                return (
                    <span className="text-muted-foreground text-xs" style={{ fontSize }}>
                        {t('panel.deferral_studio.card.button_url_invalid')}
                    </span>
                );
            }
            return (
                <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pointer-events-auto"
                    style={{ ...parseContainerStyle(buildDeferralButtonAnchorStyle(btn)), fontSize }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                >
                    {label}
                </a>
            );
        }
        case 'custom_image': {
            const src = el.content?.trim();
            if (
                !src?.startsWith('data:image/png') &&
                !src?.startsWith('data:image/gif') &&
                !src?.startsWith('data:image/svg+xml')
            ) {
                return null;
            }
            return (
                <DeferralStudioAnimatedImage
                    src={src}
                    alt=""
                    className="pointer-events-none h-full w-full object-contain"
                />
            );
        }
        default:
            return null;
    }
}

function parseContainerStyle(style: string | undefined): React.CSSProperties {
    const out: Record<string, string> = {};
    if (!style) return out as React.CSSProperties;
    for (const part of style.split(';')) {
        const [key, val] = part.split(':').map((s) => s.trim());
        if (!key || !val) continue;
        const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        out[camel] = val;
    }
    return out as React.CSSProperties;
}
