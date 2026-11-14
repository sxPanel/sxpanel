import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
    {
        ignores: ['**/*.ignore.*', 'dist/**', 'node_modules/**'],
    },
    {
        files: ['**/*.{js,cjs,mjs,ts}'],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'module',
            parser: tsparser,
            globals: {
                GlobalData: 'writable',
                ExecuteCommand: 'readonly',
                GetConvar: 'readonly',
                GetCurrentResourceName: 'readonly',
                GetResourceMetadata: 'readonly',
                GetResourcePath: 'readonly',
                IsDuplicityVersion: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            'no-control-regex': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-prototype-builtins': 'off',
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    varsIgnorePattern: '^_\\w*',
                    vars: 'all',
                    args: 'none',
                    ignoreRestSiblings: true,
                },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/ban-ts-comment': 'warn',
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-wrapper-object-types': 'off',
            '@typescript-eslint/no-unsafe-function-type': 'off',
            '@typescript-eslint/no-unused-expressions': 'off',
        },
    },
    eslintConfigPrettier,
];
