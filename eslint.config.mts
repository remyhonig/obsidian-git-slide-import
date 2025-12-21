import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import { globalIgnores } from "eslint/config";
import globals from "globals";

export default tseslint.config(
	// Use recommendedWithLocalesEn for strictest settings (includes locale validation)
	// @ts-expect-error - obsidianmd types don't fully match tseslint types
	...obsidianmd.configs.recommendedWithLocalesEn,
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
						'vitest.config.ts'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	{
		// Strictest settings: upgrade all warn rules to error
		files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
		rules: {
			// Upgrade obsidianmd warn rules to error
			'obsidianmd/prefer-file-manager-trash-file': 'error',
			'obsidianmd/ui/sentence-case': ['error', { enforceCamelCaseLower: true }],
			// Upgrade typescript-eslint warn rules to error
			'@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
			// Enable strict async rule (disabled in recommended)
			'@typescript-eslint/require-await': 'error',
			// Stricter general rules
			'no-self-compare': 'error',
		},
	},
	{
		// Strictest settings for English locale files
		files: ['**/en.json', '**/en*.json', '**/en/*.json', '**/en/**/*.json'],
		rules: {
			'obsidianmd/ui/sentence-case-json': 'error',
		},
	},
	{
		// Strictest settings for English locale TS/JS modules
		files: ['**/en.ts', '**/en.js', '**/en*.ts', '**/en*.js', '**/en/*.ts', '**/en/*.js', '**/en/**/*.ts', '**/en/**/*.js'],
		rules: {
			'obsidianmd/ui/sentence-case-locale-module': 'error',
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
