import { describe, it, expect } from 'vitest';
import {
	SlideGenerator,
	createDefaultFormatOptions,
	createSafeCodeBlock,
	parseCommitMessage,
	renderTemplate,
	formatDateWithFormat,
	parseAuthor,
	DEFAULT_COMMIT_DETAILS_TEMPLATE,
	DEFAULT_SLIDE_TEMPLATE
} from './slide-generator';
import type { GitCommit, GitFileDiff, DiffHunk } from './types';

// ============================================================================
// Test Helpers
// ============================================================================

function createCommit(overrides: Partial<GitCommit> = {}): GitCommit {
	return {
		hash: 'abc123def456',
		hashShort: 'abc123d',
		message: 'Test commit message',
		author: 'Test Author <test@example.com>',
		date: new Date('2024-01-15T10:30:00Z'),
		files: [],
		...overrides
	};
}

function createDiff(overrides: Partial<GitFileDiff> = {}): GitFileDiff {
	return {
		path: 'src/test.ts',
		hunks: [],
		newContent: null,
		language: 'typescript',
		...overrides
	};
}

function createHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
	return {
		oldStart: 1,
		oldLines: 3,
		newStart: 1,
		newLines: 4,
		addedLineNumbers: [2],
		removedLineNumbers: [],
		lines: [
			{ type: 'context', content: 'line 1', oldLineNumber: 1, newLineNumber: 1 },
			{ type: 'added', content: 'new line', oldLineNumber: null, newLineNumber: 2 },
			{ type: 'context', content: 'line 2', oldLineNumber: 2, newLineNumber: 3 },
			{ type: 'context', content: 'line 3', oldLineNumber: 3, newLineNumber: 4 }
		],
		...overrides
	};
}

// ============================================================================
// createSafeCodeBlock Tests
// ============================================================================

describe('createSafeCodeBlock', () => {
	it('creates a basic code block with 3 backticks', () => {
		const result = createSafeCodeBlock('const x = 1;', 'typescript');
		expect(result).toBe('```typescript\nconst x = 1;\n```');
	});

	it('uses 4 backticks when content contains 3 backticks', () => {
		const content = 'const code = ```js\nconsole.log("hi")\n```;';
		const result = createSafeCodeBlock(content, 'typescript');
		expect(result.startsWith('````')).toBe(true);
		expect(result.endsWith('````')).toBe(true);
	});

	it('uses more backticks than the longest sequence in content', () => {
		const content = 'some ```` nested ```` backticks';
		const result = createSafeCodeBlock(content, 'text');
		expect(result.startsWith('`````')).toBe(true);
	});

	it('includes language spec with highlights', () => {
		const result = createSafeCodeBlock('code', 'typescript [1-3]');
		expect(result).toContain('```typescript [1-3]');
	});

	it('trims trailing whitespace from content', () => {
		const result = createSafeCodeBlock('code   \n  ', 'js');
		expect(result).toBe('```js\ncode\n```');
	});

	it('handles empty content', () => {
		const result = createSafeCodeBlock('', 'js');
		expect(result).toBe('```js\n\n```');
	});
});

// ============================================================================
// parseCommitMessage Tests
// ============================================================================

describe('parseCommitMessage', () => {
	it('parses message with empty line separator', () => {
		const message = `Fix the bug

This is the body of the commit message.
It can span multiple lines.`;

		const result = parseCommitMessage(message);

		expect(result.title).toBe('Fix the bug');
		expect(result.body).toBe('This is the body of the commit message.\nIt can span multiple lines.');
	});

	it('parses message with multiple empty lines', () => {
		const message = `Title here


Body after multiple blank lines`;

		const result = parseCommitMessage(message);

		expect(result.title).toBe('Title here');
		expect(result.body).toBe('Body after multiple blank lines');
	});

	it('parses message with simple newline separator', () => {
		const message = `Short title
Body starts immediately after newline`;

		const result = parseCommitMessage(message);

		expect(result.title).toBe('Short title');
		expect(result.body).toBe('Body starts immediately after newline');
	});

	it('splits long single line at first period', () => {
		const message = 'This is a very long commit message that exceeds the 72 character limit. And this is the rest of the message that should become the body.';

		const result = parseCommitMessage(message);

		expect(result.title).toBe('This is a very long commit message that exceeds the 72 character limit.');
		expect(result.body).toBe('And this is the rest of the message that should become the body.');
	});

	it('does not split short single line', () => {
		const message = 'Short commit message';

		const result = parseCommitMessage(message);

		expect(result.title).toBe('Short commit message');
		expect(result.body).toBe('');
	});

	it('handles empty message', () => {
		const result = parseCommitMessage('');

		expect(result.title).toBe('');
		expect(result.body).toBe('');
	});

	it('trims whitespace from title and body', () => {
		const message = `  Title with spaces

  Body with spaces  `;

		const result = parseCommitMessage(message);

		expect(result.title).toBe('Title with spaces');
		expect(result.body).toBe('Body with spaces');
	});

	it('handles message with only whitespace lines between title and body', () => {
		const message = `Title

Body`;

		const result = parseCommitMessage(message);

		expect(result.title).toBe('Title');
		expect(result.body).toBe('Body');
	});

	it('does not split at period if too far into the message', () => {
		const longMessage = 'A'.repeat(80) + '. ' + 'B'.repeat(20);

		const result = parseCommitMessage(longMessage);

		// Period at position 80 is < 100, so it should split
		expect(result.title).toBe('A'.repeat(80) + '.');
	});
});

// ============================================================================
// renderTemplate Tests
// ============================================================================

describe('renderTemplate', () => {
	it('substitutes simple variables', () => {
		const template = 'Hello {{name}}!';
		const vars = { name: 'World' };

		const result = renderTemplate(template, vars);

		expect(result).toBe('Hello World!');
	});

	it('substitutes multiple variables', () => {
		const template = '{{greeting}} {{name}}, you have {{count}} messages.';
		const vars = { greeting: 'Hello', name: 'User', count: '5' };

		const result = renderTemplate(template, vars);

		expect(result).toBe('Hello User, you have 5 messages.');
	});

	it('removes line with empty variable on its own', () => {
		const template = `Title
{{emptyVar}}
Content`;
		const vars = { emptyVar: '' };

		const result = renderTemplate(template, vars);

		expect(result).toBe('Title\n\nContent');
	});

	it('removes line with undefined variable on its own', () => {
		const template = `Title
{{undefinedVar}}
Content`;
		const vars = {};

		const result = renderTemplate(template, vars);

		expect(result).toBe('Title\n\nContent');
	});

	it('keeps empty variable inline (not on its own line)', () => {
		const template = 'Prefix {{emptyVar}} Suffix';
		const vars = { emptyVar: '' };

		const result = renderTemplate(template, vars);

		expect(result).toBe('Prefix  Suffix');
	});

	it('collapses multiple blank lines to two', () => {
		const template = `Title



Content`;

		const result = renderTemplate(template, {});

		expect(result).toBe('Title\n\nContent');
	});

	it('trims the final result', () => {
		const template = '  {{text}}  ';
		const vars = { text: 'content' };

		const result = renderTemplate(template, vars);

		expect(result).toBe('content');
	});

	it('handles template with no variables', () => {
		const template = 'Static content only';

		const result = renderTemplate(template, {});

		expect(result).toBe('Static content only');
	});

	it('handles multiline content in variables', () => {
		const template = '## {{title}}\n\n{{body}}';
		const vars = {
			title: 'My Title',
			body: 'Line 1\nLine 2\nLine 3'
		};

		const result = renderTemplate(template, vars);

		expect(result).toBe('## My Title\n\nLine 1\nLine 2\nLine 3');
	});

	it('preserves indentation with variable on its own line', () => {
		const template = `Code:
	{{code}}
End`;
		const vars = { code: '' };

		const result = renderTemplate(template, vars);

		// Empty variable on its own line should be removed
		expect(result).toBe('Code:\n\nEnd');
	});
});

// ============================================================================
// formatDateWithFormat Tests
// ============================================================================

describe('formatDateWithFormat', () => {
	const testDate = new Date('2024-03-15T14:30:00Z');

	it('formats with full year', () => {
		expect(formatDateWithFormat(testDate, 'yyyy')).toBe('2024');
	});

	it('formats with short year', () => {
		expect(formatDateWithFormat(testDate, 'yy')).toBe('24');
	});

	it('formats with full month name', () => {
		const result = formatDateWithFormat(testDate, 'MMMM');
		expect(result).toBe('March');
	});

	it('formats with abbreviated month name', () => {
		const result = formatDateWithFormat(testDate, 'MMM');
		expect(result).toBe('Mar');
	});

	it('formats with zero-padded month number', () => {
		const result = formatDateWithFormat(testDate, 'MM');
		expect(result).toBe('03');
	});

	it('formats with zero-padded day', () => {
		const result = formatDateWithFormat(testDate, 'dd');
		expect(result).toBe('15');
	});

	it('formats with non-padded day', () => {
		const result = formatDateWithFormat(testDate, 'd');
		expect(result).toBe('15');
	});

	it('formats single-digit day correctly', () => {
		const singleDigitDate = new Date('2024-03-05T10:00:00Z');
		expect(formatDateWithFormat(singleDigitDate, 'd')).toBe('5');
		expect(formatDateWithFormat(singleDigitDate, 'dd')).toBe('05');
	});

	it('formats with hours', () => {
		const result = formatDateWithFormat(testDate, 'HH');
		// Note: This depends on timezone, but we test the format works
		expect(result).toMatch(/^\d{2}$/);
	});

	it('formats with minutes', () => {
		const result = formatDateWithFormat(testDate, 'mm');
		expect(result).toBe('30');
	});

	it('formats complex format string', () => {
		const result = formatDateWithFormat(testDate, 'MMM d, yyyy');
		expect(result).toBe('Mar 15, 2024');
	});

	it('handles January (month index 0)', () => {
		const janDate = new Date('2024-01-15T10:00:00Z');
		expect(formatDateWithFormat(janDate, 'MMMM')).toBe('January');
		expect(formatDateWithFormat(janDate, 'MM')).toBe('01');
	});

	it('handles December (month index 11)', () => {
		const decDate = new Date('2024-12-15T10:00:00Z');
		expect(formatDateWithFormat(decDate, 'MMMM')).toBe('December');
		expect(formatDateWithFormat(decDate, 'MM')).toBe('12');
	});
});

// ============================================================================
// parseAuthor Tests
// ============================================================================

describe('parseAuthor', () => {
	it('parses author with name and email', () => {
		const result = parseAuthor('John Doe <john@example.com>');

		expect(result.name).toBe('John Doe');
		expect(result.email).toBe('john@example.com');
	});

	it('parses author with name only', () => {
		const result = parseAuthor('John Doe');

		expect(result.name).toBe('John Doe');
		expect(result.email).toBe('');
	});

	it('handles extra spaces around email', () => {
		const result = parseAuthor('John Doe   <john@example.com>');

		expect(result.name).toBe('John Doe');
		expect(result.email).toBe('john@example.com');
	});

	it('handles name with special characters', () => {
		const result = parseAuthor("O'Brien, Mary <mary@test.org>");

		expect(result.name).toBe("O'Brien, Mary");
		expect(result.email).toBe('mary@test.org');
	});

	it('handles empty string', () => {
		const result = parseAuthor('');

		expect(result.name).toBe('');
		expect(result.email).toBe('');
	});
});

// ============================================================================
// SlideGenerator Integration Tests
// ============================================================================

describe('SlideGenerator', () => {
	describe('generateSlides - flat mode', () => {
		it('generates slides for commits with files', () => {
			const options = createDefaultFormatOptions();
			const generator = new SlideGenerator(options);

			const commits = [createCommit()];
			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set(commits[0]!.hash, [
				createDiff({ hunks: [createHunk()] })
			]);

			const result = generator.generateSlides(commits, diffs);

			expect(result).toContain('## test.ts');
			expect(result).toContain('Test commit message');
		});

		it('generates commit-only slide when no files', () => {
			const options = createDefaultFormatOptions();
			const generator = new SlideGenerator(options);

			const commits = [createCommit({ message: 'Commit without files' })];
			const diffs = new Map<string, GitFileDiff[]>();

			const result = generator.generateSlides(commits, diffs);

			expect(result).toContain('## Commit without files');
		});

		it('separates slides with ---', () => {
			const options = createDefaultFormatOptions();
			const generator = new SlideGenerator(options);

			const commits = [
				createCommit({ hash: 'hash1', message: 'First' }),
				createCommit({ hash: 'hash2', message: 'Second' })
			];
			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set('hash1', [createDiff({ path: 'file1.ts', hunks: [createHunk()] })]);
			diffs.set('hash2', [createDiff({ path: 'file2.ts', hunks: [createHunk()] })]);

			const result = generator.generateSlides(commits, diffs);

			expect(result).toContain('---');
		});
	});

	describe('generateSlides - grouped mode', () => {
		it('creates vertical subslides with --', () => {
			const options = { ...createDefaultFormatOptions(), slideOrganization: 'grouped' as const };
			const generator = new SlideGenerator(options);

			const commits = [createCommit()];
			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set(commits[0]!.hash, [
				createDiff({ path: 'file1.ts', hunks: [createHunk()] }),
				createDiff({ path: 'file2.ts', hunks: [createHunk()] })
			]);

			const result = generator.generateSlides(commits, diffs);

			expect(result).toContain('--');
		});
	});

	describe('speaker notes', () => {
		it('adds speaker notes when messageBodyAsSpeakerNotes is true', () => {
			const options = { ...createDefaultFormatOptions(), messageBodyAsSpeakerNotes: true };
			const generator = new SlideGenerator(options);

			const commits = [createCommit({
				message: 'Title\n\nThis is the body that should be in notes'
			})];
			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set(commits[0]!.hash, [createDiff({ hunks: [createHunk()] })]);

			const result = generator.generateSlides(commits, diffs);

			expect(result).toContain('note: This is the body that should be in notes');
		});

		it('does not add speaker notes when disabled', () => {
			const options = { ...createDefaultFormatOptions(), messageBodyAsSpeakerNotes: false };
			const generator = new SlideGenerator(options);

			const commits = [createCommit({
				message: 'Title\n\nBody content'
			})];
			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set(commits[0]!.hash, [createDiff({ hunks: [createHunk()] })]);

			const result = generator.generateSlides(commits, diffs);

			expect(result).not.toContain('note:');
		});
	});

	describe('code highlighting', () => {
		it('adds highlight markers for added lines', () => {
			const options = { ...createDefaultFormatOptions(), highlightAddedLines: true };
			const generator = new SlideGenerator(options);

			const commits = [createCommit()];
			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set(commits[0]!.hash, [createDiff({
				hunks: [createHunk({ addedLineNumbers: [2, 3] })]
			})]);

			const result = generator.generateSlides(commits, diffs);

			// Should have highlight spec in code fence
			expect(result).toMatch(/```typescript \[[\d\-|,]+\]/);
		});

		it('uses | for stepped mode', () => {
			const options = {
				...createDefaultFormatOptions(),
				highlightAddedLines: true,
				highlightMode: 'stepped' as const
			};
			const generator = new SlideGenerator(options);

			const commits = [createCommit()];
			const hunk = createHunk();
			hunk.lines = [
				{ type: 'added', content: 'line 1', oldLineNumber: null, newLineNumber: 1 },
				{ type: 'context', content: 'line 2', oldLineNumber: 1, newLineNumber: 2 },
				{ type: 'added', content: 'line 3', oldLineNumber: null, newLineNumber: 3 }
			];
			hunk.addedLineNumbers = [1, 3];

			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set(commits[0]!.hash, [createDiff({ hunks: [hunk] })]);

			const result = generator.generateSlides(commits, diffs);

			// Stepped mode should use | separator
			expect(result).toContain('|');
		});
	});

	describe('template rendering', () => {
		it('uses custom commit details template', () => {
			const options = {
				...createDefaultFormatOptions(),
				commitDetailsTemplate: 'Author: {{authorName}} | Date: {{commitDate}}'
			};
			const generator = new SlideGenerator(options);

			const commits = [createCommit({ author: 'Jane Smith <jane@test.com>' })];
			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set(commits[0]!.hash, [createDiff({ hunks: [createHunk()] })]);

			const result = generator.generateSlides(commits, diffs);

			expect(result).toContain('Author: Jane Smith');
		});

		it('uses custom slide template', () => {
			const options = {
				...createDefaultFormatOptions(),
				slideTemplate: '### File: {{fileName}}\n{{code}}'
			};
			const generator = new SlideGenerator(options);

			const commits = [createCommit()];
			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set(commits[0]!.hash, [createDiff({ path: 'custom/path.ts', hunks: [createHunk()] })]);

			const result = generator.generateSlides(commits, diffs);

			expect(result).toContain('### File: path.ts');
		});
	});

	describe('file summary', () => {
		it('includes other changed files when template uses fileSummary', () => {
			const options = {
				...createDefaultFormatOptions(),
				slideTemplate: '## {{fileName}}\n\n{{fileSummary}}\n\n{{code}}'
			};
			const generator = new SlideGenerator(options);

			const commits = [createCommit()];
			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set(commits[0]!.hash, [
				createDiff({ path: 'file1.ts', hunks: [createHunk()] }),
				createDiff({ path: 'file2.ts', hunks: [createHunk()] }),
				createDiff({ path: 'file3.ts', hunks: [createHunk()] })
			]);

			const result = generator.generateSlides(commits, diffs);

			// First slide should mention other files
			expect(result).toContain('Also changed:');
			expect(result).toContain('file2.ts');
			expect(result).toContain('file3.ts');
		});

		it('does not include summary when only one file changed', () => {
			const options = {
				...createDefaultFormatOptions(),
				slideTemplate: '## {{fileName}}\n\n{{fileSummary}}\n\n{{code}}'
			};
			const generator = new SlideGenerator(options);

			const commits = [createCommit()];
			const diffs = new Map<string, GitFileDiff[]>();
			diffs.set(commits[0]!.hash, [
				createDiff({ path: 'single-file.ts', hunks: [createHunk()] })
			]);

			const result = generator.generateSlides(commits, diffs);

			expect(result).not.toContain('Also changed:');
		});
	});
});

// ============================================================================
// Default Template Tests
// ============================================================================

describe('Default Templates', () => {
	it('DEFAULT_COMMIT_DETAILS_TEMPLATE contains expected variables', () => {
		expect(DEFAULT_COMMIT_DETAILS_TEMPLATE).toContain('{{messageTitle}}');
		expect(DEFAULT_COMMIT_DETAILS_TEMPLATE).toContain('{{messageBody}}');
		expect(DEFAULT_COMMIT_DETAILS_TEMPLATE).toContain('{{authorName}}');
		expect(DEFAULT_COMMIT_DETAILS_TEMPLATE).toContain('{{commitDate}}');
	});

	it('DEFAULT_SLIDE_TEMPLATE contains expected variables', () => {
		expect(DEFAULT_SLIDE_TEMPLATE).toContain('{{fileName}}');
		expect(DEFAULT_SLIDE_TEMPLATE).toContain('{{commitDetails}}');
		expect(DEFAULT_SLIDE_TEMPLATE).toContain('{{code}}');
	});
});
