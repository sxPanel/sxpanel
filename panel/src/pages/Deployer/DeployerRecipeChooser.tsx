import { Loader2Icon } from 'lucide-react';
import useSWR from 'swr';
import { cn } from '@/lib/utils';
import {
    fetchTxAdminRecipeIndex,
    recipeAttributionLine,
    recipeTagColor,
    type TxAdminRecipeEntry,
} from './txAdminRecipeIndex';

type DeployerRecipeChooserProps = {
    onSelect: (recipe: TxAdminRecipeEntry) => void;
    selectedUrl?: string;
    engineVersion?: string;
    forceGameName?: string;
};

export function DeployerRecipeChooser({
    onSelect,
    selectedUrl,
    engineVersion,
    forceGameName,
}: DeployerRecipeChooserProps) {
    const recipesKey = `deployerRecipeIndex:${forceGameName || 'all'}`;
    const {
        data: recipes,
        error: recipesError,
        isLoading,
    } = useSWR(recipesKey, () => fetchTxAdminRecipeIndex(forceGameName));

    const fetchError = recipesError
        ? recipesError.message === 'Request timed out while loading recipes.'
            ? recipesError.message
            : `Failed to load recipes: ${recipesError.message}`
        : '';

    return (
        <div className="border-border/60 space-y-2 rounded-lg border p-3">
            <div>
                <p className="text-foreground text-xs font-semibold">Select a framework</p>
                <p className="text-muted-foreground text-[10px]">
                    From{' '}
                    <a
                        href="https://github.com/citizenfx/txAdmin-recipes"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                    >
                        citizenfx/txAdmin-recipes
                    </a>{' '}
                    plus official framework recipes
                </p>
            </div>

            {fetchError && <p className="text-destructive text-xs">{fetchError}</p>}

            {isLoading && !fetchError && (
                <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
                    <Loader2Icon className="size-5 animate-spin" />
                    Loading recipes…
                </div>
            )}

            {recipes && (
                <div className="grid max-h-[min(14rem,40vh)] grid-cols-1 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-2">
                    {recipes.map((r) => {
                        const incompatible = Boolean(engineVersion && r.engine !== engineVersion);
                        const isSelected = selectedUrl === r.url;
                        const attribution = recipeAttributionLine(r);
                        return (
                            <button
                                key={r.url}
                                type="button"
                                onClick={() => !incompatible && onSelect(r)}
                                disabled={incompatible}
                                className={cn(
                                    'border-border hover:border-primary hover:bg-accent flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                    isSelected && 'border-primary bg-primary/5 ring-primary ring-1',
                                )}
                            >
                                <span className="text-foreground text-sm font-semibold">{r.name}</span>
                                {attribution && (
                                    <span className="text-muted-foreground text-[10px]">{attribution}</span>
                                )}
                                <span className="text-muted-foreground line-clamp-2 text-[11px]">{r.description}</span>
                                <div className="mt-0.5 flex flex-wrap gap-1">
                                    {incompatible && (
                                        <span className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] text-white">
                                            INCOMPATIBLE
                                        </span>
                                    )}
                                    {r.tags.map((t) => (
                                        <span
                                            key={t}
                                            className={cn('rounded px-1.5 py-0.5 text-[10px]', recipeTagColor(t))}
                                        >
                                            {t}
                                        </span>
                                    ))}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
