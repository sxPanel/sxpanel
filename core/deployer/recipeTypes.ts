import { z } from 'zod';
import type { Connection } from 'mysql2/promise';

//=============================================================
//== Recipe YAML schemas
//=============================================================
const onesyncValues = ['off', 'legacy', 'on'] as const;

export const RecipeMetaSchema = z.object({
    $engine: z.number().int().optional(),
    $minFxVersion: z.number().int().optional(),
    $onesync: z.enum(onesyncValues).optional(),
    $steamRequired: z.literal(true).optional(),
    $requiresGithubToken: z.literal(true).optional(),
    name: z.string().optional(),
    author: z.string().optional(),
    description: z.string().optional(),
});

export const RecipeTaskSchema = z
    .object({
        action: z.string(),
        timeoutSeconds: z.number().int().positive().optional(),
    })
    .passthrough();
export type RecipeTask = z.infer<typeof RecipeTaskSchema>;

export const YamlRecipeSchema = RecipeMetaSchema.extend({
    variables: z.record(z.string(), z.any()).optional(),
    tasks: z.array(RecipeTaskSchema),
});
export type YamlRecipe = z.infer<typeof YamlRecipeSchema>;

//=============================================================
//== Parsed recipe
//=============================================================
export type ParsedRecipe = {
    raw: string;
    name: string;
    author: string;
    description: string;
    variables: Record<string, string>;
    tasks: RecipeTask[];
    onesync?: string;
    fxserverMinVersion?: number;
    recipeEngineVersion?: number;
    steamRequired?: boolean;
    requiresGithubToken?: boolean;
    requireDBConfig: boolean;
};

//=============================================================
//== Deployer step & context
//=============================================================
export const DeployerSteps = ['review', 'input', 'run', 'configure'] as const;
export type DeployerStep = (typeof DeployerSteps)[number];

export type DeployerContext = Record<string, string> & {
    /** Internal progress marker for debug/status reporting */
    $step: string;
    /** Active database connection, set by connect_database task */
    dbConnection?: Connection;
    /** GitHub personal access token for private repo downloads */
    $githubToken?: string;
};

//=============================================================
//== Recipe engine task definition
//=============================================================
export type TaskDefinition = {
    validate: (task: RecipeTask) => boolean;
    run: (task: RecipeTask, basePath: string, ctx: DeployerContext) => Promise<void>;
    timeoutSeconds: number;
};
export type RecipeEngineMap = Record<string, TaskDefinition>;
