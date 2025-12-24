import { describe, it, expect } from 'vitest';
import {
	parseDiffHunks,
	compressToRanges,
	generateHighlightString,
	deindent,
	formatDiffContent
} from './diff-parser';
import type { DiffHunk } from './types';

describe('parseDiffHunks', () => {
	it('parses a simple diff with one hunk', () => {
		const diff = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
 const d = 4;`;

		const hunks = parseDiffHunks(diff);

		expect(hunks).toHaveLength(1);
		expect(hunks[0]!.oldStart).toBe(1);
		expect(hunks[0]!.newStart).toBe(1);
		expect(hunks[0]!.addedLineNumbers).toEqual([2]);
		expect(hunks[0]!.removedLineNumbers).toEqual([]);
		expect(hunks[0]!.lines).toHaveLength(4);
	});

	it('parses a diff with added and removed lines', () => {
		const diff = `@@ -5,4 +5,4 @@
 context before
-old line
+new line
 context after`;

		const hunks = parseDiffHunks(diff);

		expect(hunks).toHaveLength(1);
		expect(hunks[0]!.addedLineNumbers).toEqual([6]);
		expect(hunks[0]!.removedLineNumbers).toEqual([6]);
		expect(hunks[0]!.lines).toHaveLength(4);

		const addedLine = hunks[0]!.lines.find(l => l.type === 'added');
		expect(addedLine?.content).toBe('new line');

		const removedLine = hunks[0]!.lines.find(l => l.type === 'removed');
		expect(removedLine?.content).toBe('old line');
	});

	it('parses multiple hunks', () => {
		const diff = `@@ -1,3 +1,4 @@
 line 1
+added in first hunk
 line 2
 line 3
@@ -10,3 +11,4 @@
 line 10
+added in second hunk
 line 11
 line 12`;

		const hunks = parseDiffHunks(diff);

		expect(hunks).toHaveLength(2);
		expect(hunks[0]!.newStart).toBe(1);
		expect(hunks[1]!.newStart).toBe(11);
	});

	it('handles hunk headers without line counts', () => {
		const diff = `@@ -5 +5 @@
-single old
+single new`;

		const hunks = parseDiffHunks(diff);

		expect(hunks).toHaveLength(1);
		expect(hunks[0]!.oldLines).toBe(1);
		expect(hunks[0]!.newLines).toBe(1);
	});

	it('handles empty diff', () => {
		const hunks = parseDiffHunks('');
		expect(hunks).toEqual([]);
	});

	it('handles diff with only context lines', () => {
		const diff = `@@ -1,3 +1,3 @@
 line 1
 line 2
 line 3`;

		const hunks = parseDiffHunks(diff);

		expect(hunks).toHaveLength(1);
		expect(hunks[0]!.addedLineNumbers).toEqual([]);
		expect(hunks[0]!.removedLineNumbers).toEqual([]);
	});

	it('preserves content after + or - prefix correctly', () => {
		const diff = `@@ -1,2 +1,2 @@
-  indented content
+  more indented content`;

		const hunks = parseDiffHunks(diff);

		expect(hunks[0]!.lines[0]!.content).toBe('  indented content');
		expect(hunks[0]!.lines[1]!.content).toBe('  more indented content');
	});

	it('handles lines with special characters', () => {
		const diff = `@@ -1,2 +1,3 @@
 const regex = /^\\s+/;
+const backticks = \`\`\`;
 const special = "{{var}}"`;

		const hunks = parseDiffHunks(diff);

		expect(hunks[0]!.lines[1]!.content).toBe('const backticks = ```;');
	});
});

describe('compressToRanges', () => {
	it('compresses consecutive numbers to ranges', () => {
		expect(compressToRanges([1, 2, 3, 5, 7, 8, 9])).toEqual(['1-3', '5', '7-9']);
	});

	it('handles single numbers', () => {
		expect(compressToRanges([1, 3, 5])).toEqual(['1', '3', '5']);
	});

	it('handles empty array', () => {
		expect(compressToRanges([])).toEqual([]);
	});

	it('handles single element', () => {
		expect(compressToRanges([5])).toEqual(['5']);
	});

	it('handles unsorted input', () => {
		expect(compressToRanges([5, 1, 3, 2, 4])).toEqual(['1-5']);
	});

	it('handles all consecutive', () => {
		expect(compressToRanges([1, 2, 3, 4, 5])).toEqual(['1-5']);
	});

	it('handles two-element range', () => {
		expect(compressToRanges([1, 2])).toEqual(['1-2']);
	});
});

describe('generateHighlightString', () => {
	const createHunk = (addedLines: number[]): DiffHunk => ({
		oldStart: 1,
		oldLines: 1,
		newStart: 1,
		newLines: 1,
		addedLineNumbers: addedLines,
		removedLineNumbers: [],
		lines: []
	});

	it('generates stepped highlight string with |', () => {
		const hunks = [createHunk([1, 2, 3]), createHunk([7, 8])];
		const result = generateHighlightString(hunks, 'stepped');
		expect(result).toBe('1-3|7-8');
	});

	it('generates all-at-once highlight string with ,', () => {
		const hunks = [createHunk([1, 2, 3]), createHunk([7, 8])];
		const result = generateHighlightString(hunks, 'all');
		expect(result).toBe('1-3,7-8');
	});

	it('returns empty string for no added lines', () => {
		const hunks = [createHunk([])];
		const result = generateHighlightString(hunks, 'stepped');
		expect(result).toBe('');
	});

	it('handles single line highlights', () => {
		const hunks = [createHunk([5])];
		const result = generateHighlightString(hunks, 'stepped');
		expect(result).toBe('5');
	});
});

describe('deindent', () => {
	it('removes common leading whitespace', () => {
		const input = `    line 1
    line 2
    line 3`;
		const expected = `line 1
line 2
line 3`;
		expect(deindent(input)).toBe(expected);
	});

	it('handles mixed indentation levels', () => {
		const input = `    outer
        inner
    outer again`;
		const expected = `outer
    inner
outer again`;
		expect(deindent(input)).toBe(expected);
	});

	it('ignores empty lines when calculating indent', () => {
		const input = `    line 1

    line 2`;
		const expected = `line 1

line 2`;
		expect(deindent(input)).toBe(expected);
	});

	it('returns unchanged if no common indent', () => {
		const input = `line 1
line 2`;
		expect(deindent(input)).toBe(input);
	});

	it('handles tabs', () => {
		const input = `\t\tline 1
\t\tline 2`;
		const expected = `line 1
line 2`;
		expect(deindent(input)).toBe(expected);
	});

	it('handles empty string', () => {
		expect(deindent('')).toBe('');
	});

	it('handles all empty lines', () => {
		const input = `

`;
		expect(deindent(input)).toBe(input);
	});
});

describe('formatDiffContent', () => {
	const createHunkWithLines = (lines: Array<{ type: 'added' | 'removed' | 'context'; content: string }>): DiffHunk => ({
		oldStart: 1,
		oldLines: 1,
		newStart: 1,
		newLines: 1,
		addedLineNumbers: [],
		removedLineNumbers: [],
		lines: lines.map((l, i) => ({
			...l,
			oldLineNumber: l.type !== 'added' ? i + 1 : null,
			newLineNumber: l.type !== 'removed' ? i + 1 : null
		}))
	});

	it('formats additions-only mode without removed lines', () => {
		const hunk = createHunkWithLines([
			{ type: 'context', content: 'context' },
			{ type: 'removed', content: 'removed' },
			{ type: 'added', content: 'added' },
			{ type: 'context', content: 'more context' }
		]);

		const result = formatDiffContent([hunk], false, 'additions-only');

		expect(result).toContain('context');
		expect(result).toContain('added');
		expect(result).toContain('more context');
		expect(result).not.toContain('removed');
	});

	it('formats full-diff mode with prefixes', () => {
		const hunk = createHunkWithLines([
			{ type: 'context', content: 'context' },
			{ type: 'removed', content: 'removed' },
			{ type: 'added', content: 'added' }
		]);

		const result = formatDiffContent([hunk], true, 'full-diff');

		expect(result).toContain('  context');
		expect(result).toContain('- removed');
		expect(result).toContain('+ added');
	});

	it('adds separator between multiple hunks', () => {
		const hunk1 = createHunkWithLines([{ type: 'added', content: 'first' }]);
		const hunk2 = createHunkWithLines([{ type: 'added', content: 'second' }]);

		const result = formatDiffContent([hunk1, hunk2], false, 'additions-only');

		expect(result).toContain('// ...');
	});

	it('deindents the output', () => {
		const hunk = createHunkWithLines([
			{ type: 'context', content: '    indented' },
			{ type: 'added', content: '    also indented' }
		]);

		const result = formatDiffContent([hunk], false, 'additions-only');

		expect(result).toBe('indented\nalso indented');
	});

	it('handles empty hunks array', () => {
		const result = formatDiffContent([], false, 'additions-only');
		expect(result).toBe('');
	});
});
