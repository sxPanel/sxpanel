/** Popular recipes index — https://github.com/citizenfx/txAdmin-recipes */
export const TXADMIN_RECIPES_INDEX_URL = window.txConsts.fxsIsGen9
    ? 'https://raw.githubusercontent.com/citizenfx/txAdmin-recipes/main/indexv5.json'
    : 'https://raw.githubusercontent.com/citizenfx/txAdmin-recipes/main/indexv4.json';

export type TxAdminRecipeEntry = {
    engine: string;
    name: string;
    author: string;
    version: string;
    description: string;
    url: string;
    tags: string[];
};

type RawTxAdminRecipeEntry = Omit<TxAdminRecipeEntry, 'engine' | 'author' | 'version'> & {
    engine: string | number;
    author?: string;
    version?: string;
};

/** Known GitHub org → display name (indexv4 no longer ships author). */
const KNOWN_RECIPE_AUTHORS: Record<string, string> = {
    citizenfx: 'CitizenFX',
    'esx-framework': 'ESX Framework',
    'Qbox-project': 'Qbox',
    'qbcore-framework': 'QBCore',
    'qbcore-fivem': 'QBCore',
    KoraFiveM: 'Kora',
    overextended: 'Overextended',
    'ND-Framework': 'ND Framework',
    'Rexshack-RedM': 'Rexshack Gaming',
    'TPZ-CORE': 'TPZ-CORE',
    'RedEM-RP': 'RedEM:RP',
    'RPX-RedM': 'RPX',
    'qbcore-redm': 'QBCore RedM',
    VORPCORE: 'VORP Core',
};

/**
 * Frameworks that publish an official txAdmin recipe in their own GitHub org but are not listed in
 * the citizenfx index. Shown after the upstream entries; an upstream entry with the same URL wins.
 * To add a framework, append its official recipe URL here — recipes can run SQL and download code,
 * so only list recipes maintained by the framework's own org.
 */
const EXTRA_RECIPES: RawTxAdminRecipeEntry[] = window.txConsts.fxsIsGen9
    ? []
    : [
          {
              engine: 3,
              name: 'QBCore Framework',
              description: 'An advanced FiveM RP framework including jobs, gangs, housing & more!',
              url: 'https://raw.githubusercontent.com/qbcore-fivem/txAdminRecipe/main/qbcore.yaml',
              tags: ['fivem', 'roleplay'],
          },
          {
              engine: 3,
              name: 'Kora Framework (Alpha)',
              description:
                  'The official Kora recipe, a QBCore-compatible RP framework. Early alpha, may not deploy cleanly.',
              url: 'https://raw.githubusercontent.com/KoraFiveM/txAdminRecipe/main/recipe.yaml',
              tags: ['fivem', 'roleplay'],
          },
          {
              engine: 3,
              name: 'ox_core',
              description: 'The official recipe for ox_core, the Overextended framework built around ox_lib.',
              url: 'https://raw.githubusercontent.com/overextended/txAdminRecipe/main/recipe.yaml',
              tags: ['fivem', 'roleplay'],
          },
          {
              engine: 3,
              name: 'ND Core',
              description: 'The official recipe for ND_Core, a lightweight framework with characters, jobs & more.',
              url: 'https://raw.githubusercontent.com/ND-Framework/txadmin-recipe/main/nd-main.yaml',
              tags: ['fivem', 'roleplay'],
          },
          {
              engine: 3,
              name: 'RSG Core',
              description: 'The Rexshack RedM RP framework build, a QBCore-style core for RedM.',
              url: 'https://raw.githubusercontent.com/Rexshack-RedM/txAdminRecipe/main/rsgcore.yaml',
              tags: ['redm', 'roleplay'],
          },
          {
              engine: 3,
              name: 'TPZ-CORE',
              description: 'The official TPZ-CORE recipe, a modular RedM RP framework. Requires Steam.',
              url: 'https://raw.githubusercontent.com/TPZ-CORE/TPZ_txAdmin/main/tpz_recipe.yaml',
              tags: ['redm', 'roleplay'],
          },
          {
              engine: 3,
              name: 'RedEM:RP',
              description: 'A lightweight but robust framework for RedM RP servers (2023 release).',
              url: 'https://raw.githubusercontent.com/RedEM-RP/txAdminRecipe/main/recipe.yaml',
              tags: ['redm', 'roleplay'],
          },
          {
              engine: 3,
              name: 'RPX Framework',
              description: 'A modular roleplay framework for RedM. Recipe last updated in 2024.',
              url: 'https://raw.githubusercontent.com/RPX-RedM/txAdminRecipe/main/recipe.yaml',
              tags: ['redm', 'roleplay'],
          },
          {
              engine: 3,
              name: 'QBR Core (QBCore RedM)',
              description: 'The QBCore port for RedM with jobs, gangs, housing & more. Recipe last updated in 2023.',
              url: 'https://raw.githubusercontent.com/qbcore-redm/txAdminRecipe/main/qbrcore.yaml',
              tags: ['redm', 'roleplay'],
          },
      ];

/** Appends the extra recipes that the upstream index does not already list. */
export function mergeExtraRecipes(
    upstream: RawTxAdminRecipeEntry[],
    extras: RawTxAdminRecipeEntry[] = EXTRA_RECIPES,
): RawTxAdminRecipeEntry[] {
    const known = new Set(upstream.map((recipe) => recipe.url));
    return [...upstream, ...extras.filter((recipe) => !known.has(recipe.url))];
}

/**
 * Derives maintainer label from raw.githubusercontent.com recipe URLs.
 */
export function deriveAuthorFromRecipeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== 'raw.githubusercontent.com') return '';
        const owner = parsed.pathname.split('/').filter(Boolean)[0];
        if (!owner) return '';
        if (KNOWN_RECIPE_AUTHORS[owner]) return KNOWN_RECIPE_AUTHORS[owner];
        return owner
            .split(/[-_]+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    } catch {
        return '';
    }
}

function normalizeRecipeEntry(raw: RawTxAdminRecipeEntry): TxAdminRecipeEntry {
    const author = raw.author?.trim() || deriveAuthorFromRecipeUrl(raw.url);
    return {
        engine: String(raw.engine),
        name: raw.name,
        author,
        version: raw.version?.trim() ?? '',
        description: raw.description,
        url: raw.url,
        tags: raw.tags,
    };
}

/** One-line attribution for recipe cards; omits empty segments. */
export function recipeAttributionLine(recipe: TxAdminRecipeEntry): string | null {
    const author = recipe.author.trim();
    const version = recipe.version.trim();
    if (author && version) return `by ${author} · v${version}`;
    if (author) return `by ${author}`;
    if (version) return `v${version}`;
    return null;
}

export function recipeTagColor(tag: string) {
    if (tag === 'fivem') return 'bg-orange-500 text-white';
    if (tag === 'redm') return 'bg-red-600 text-white';
    return 'bg-muted text-muted-foreground';
}

export async function fetchTxAdminRecipeIndex(forceGameName?: string): Promise<TxAdminRecipeEntry[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(TXADMIN_RECIPES_INDEX_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const upstream = (await response.json()) as RawTxAdminRecipeEntry[];
        const data = mergeExtraRecipes(upstream).map(normalizeRecipeEntry);
        if (!forceGameName) return data;
        return data.filter((recipe) => recipe.tags.includes(forceGameName));
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('Request timed out while loading recipes.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export async function fetchRecipeYaml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
    } finally {
        clearTimeout(timeout);
    }
}
