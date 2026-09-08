import { Button } from '@/components/ui/button';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import CardContentOverlay from '@/components/CardContentOverlay';
import { cn } from '@/lib/utils';
import type { SettingsCardShellProps } from '@/pages/Settings/settingsShellTypes';
import { useRegisterSettingsSave } from './useRegisterSettingsSave';

export default function SettingsCardShellV3({
    cardCtx,
    pageCtx,
    advancedVisible,
    advancedSetter,
    onClickSave,
    children,
}: SettingsCardShellProps) {
    useRegisterSettingsSave({ cardCtx, pageCtx, onClickSave });
    const isCardPendingSave = pageCtx.cardPendingSave?.cardId === cardCtx.cardId;
    const isMultiCardTab = cardCtx.tabName !== cardCtx.cardName;

    return (
        <article
            id={`tab-${cardCtx.cardId}`}
            data-show-advanced={advancedVisible}
            className="group/card border-border/60 bg-background relative rounded-2xl border"
        >
            {isMultiCardTab ? (
                <header className="border-border/40 flex flex-wrap items-center justify-between gap-3 border-b px-8 py-4 lg:px-10 lg:py-5">
                    <div className="min-w-0">
                        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                            {cardCtx.tabName}
                        </p>
                        <h2 className="text-foreground mt-0.5 text-lg font-semibold tracking-tight">
                            {cardCtx.cardName}
                        </h2>
                    </div>
                    {isCardPendingSave ? (
                        <span className="border-warning/35 bg-warning/10 text-warning-inline shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold">
                            Unsaved
                        </span>
                    ) : null}
                </header>
            ) : null}

            <div
                className={cn('relative overflow-x-clip px-8 pb-6 lg:px-10 lg:pb-7', !isMultiCardTab && 'pt-6 lg:pt-7')}
            >
                <div className="space-y-6">{children}</div>
                <CardContentOverlay loading={pageCtx.isLoading} error={pageCtx.swrError} />
            </div>

            {advancedVisible !== undefined && advancedSetter ? (
                <footer className="border-border/40 flex justify-end border-t px-8 py-4 lg:px-10 lg:py-5">
                    <Button size="sm" variant="ghost" onClick={() => advancedSetter(!advancedVisible)}>
                        {advancedVisible ? 'Hide' : 'Show'} advanced
                        {advancedVisible ? (
                            <ChevronUpIcon className="ml-1 size-4" />
                        ) : (
                            <ChevronDownIcon className="ml-1 size-4" />
                        )}
                    </Button>
                </footer>
            ) : null}
        </article>
    );
}
