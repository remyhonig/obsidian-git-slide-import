/**
 * Detect programming language from file extension for code block syntax highlighting
 */

const EXTENSION_MAP: Record<string, string> = {
	// JavaScript/TypeScript
	'js': 'javascript',
	'jsx': 'jsx',
	'ts': 'typescript',
	'tsx': 'tsx',
	'mjs': 'javascript',
	'cjs': 'javascript',

	// Web
	'html': 'html',
	'htm': 'html',
	'css': 'css',
	'scss': 'scss',
	'sass': 'sass',
	'less': 'less',
	'vue': 'vue',
	'svelte': 'svelte',

	// Data formats
	'json': 'json',
	'yaml': 'yaml',
	'yml': 'yaml',
	'xml': 'xml',
	'toml': 'toml',
	'csv': 'csv',

	// Backend
	'py': 'python',
	'rb': 'ruby',
	'php': 'php',
	'java': 'java',
	'kt': 'kotlin',
	'kts': 'kotlin',
	'scala': 'scala',
	'go': 'go',
	'rs': 'rust',
	'c': 'c',
	'cpp': 'cpp',
	'cc': 'cpp',
	'cxx': 'cpp',
	'h': 'c',
	'hpp': 'cpp',
	'hxx': 'cpp',
	'cs': 'csharp',
	'swift': 'swift',
	'dart': 'dart',
	'ex': 'elixir',
	'exs': 'elixir',
	'erl': 'erlang',
	'clj': 'clojure',
	'cljs': 'clojure',
	'lua': 'lua',
	'r': 'r',
	'jl': 'julia',
	'zig': 'zig',
	'nim': 'nim',
	'v': 'v',
	'cr': 'crystal',
	'f90': 'fortran',
	'f95': 'fortran',

	// Shell/Config
	'sh': 'bash',
	'bash': 'bash',
	'zsh': 'bash',
	'fish': 'fish',
	'ps1': 'powershell',
	'bat': 'batch',
	'cmd': 'batch',

	// Markup/Docs
	'md': 'markdown',
	'mdx': 'mdx',
	'tex': 'latex',
	'rst': 'rst',
	'adoc': 'asciidoc',
	'org': 'org',

	// Other
	'sql': 'sql',
	'graphql': 'graphql',
	'gql': 'graphql',
	'proto': 'protobuf',
	'tf': 'hcl',
	'hcl': 'hcl',
	'nix': 'nix',
	'dhall': 'dhall',
	'diff': 'diff',
	'patch': 'diff'
};

const SPECIAL_FILENAMES: Record<string, string> = {
	'dockerfile': 'dockerfile',
	'makefile': 'makefile',
	'gnumakefile': 'makefile',
	'cmakelists.txt': 'cmake',
	'rakefile': 'ruby',
	'gemfile': 'ruby',
	'vagrantfile': 'ruby',
	'podfile': 'ruby',
	'brewfile': 'ruby',
	'justfile': 'just',
	'jenkinsfile': 'groovy',
	'.gitignore': 'gitignore',
	'.gitattributes': 'gitattributes',
	'.editorconfig': 'editorconfig',
	'.prettierrc': 'json',
	'.eslintrc': 'json',
	'.babelrc': 'json',
	'tsconfig.json': 'jsonc',
	'jsconfig.json': 'jsonc',
	'package.json': 'json',
	'composer.json': 'json',
	'cargo.toml': 'toml',
	'go.mod': 'go',
	'go.sum': 'text'
};

/**
 * Detect the programming language from a file path
 * Returns a language identifier suitable for markdown code blocks
 */
export function detectLanguage(filePath: string): string {
	const filename = filePath.split('/').pop()?.toLowerCase() ?? '';

	// Check special filenames first
	const specialMatch = SPECIAL_FILENAMES[filename];
	if (specialMatch) {
		return specialMatch;
	}

	// Handle dotfiles that start with .
	if (filename.startsWith('.') && filename.endsWith('.local')) {
		return 'ini';
	}

	if (filename.startsWith('.env')) {
		return 'ini';
	}

	// Get extension
	const ext = filename.split('.').pop()?.toLowerCase() ?? '';

	return EXTENSION_MAP[ext] ?? 'text';
}
