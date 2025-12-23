/**
 * Parse unified diff format into structured data
 */

import type { DiffHunk } from './types';

/**
 * Parse unified diff output into structured hunks
 */
export function parseDiffHunks(diffOutput: string): DiffHunk[] {
	const hunks: DiffHunk[] = [];
	const lines = diffOutput.split('\n');

	let currentHunk: DiffHunk | null = null;
	let newLineNum = 0;
	let oldLineNum = 0;

	for (const line of lines) {
		// Hunk header: @@ -10,5 +12,7 @@
		const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);

		if (hunkMatch) {
			if (currentHunk) {
				hunks.push(currentHunk);
			}

			const oldStart = parseInt(hunkMatch[1] ?? '0');
			const oldLines = parseInt(hunkMatch[2] || '1');
			const newStart = parseInt(hunkMatch[3] ?? '0');
			const newLines = parseInt(hunkMatch[4] || '1');

			currentHunk = {
				oldStart,
				oldLines,
				newStart,
				newLines,
				addedLineNumbers: [],
				removedLineNumbers: [],
				lines: []
			};

			oldLineNum = oldStart;
			newLineNum = newStart;
			continue;
		}

		if (!currentHunk) continue;

		// Skip diff metadata lines
		if (line.startsWith('diff ') || line.startsWith('index ') ||
			line.startsWith('--- ') || line.startsWith('+++ ') ||
			line.startsWith('Binary ')) {
			continue;
		}

		// Parse content lines
		if (line.startsWith('+')) {
			currentHunk.addedLineNumbers.push(newLineNum);
			currentHunk.lines.push({
				type: 'added',
				content: line.substring(1),
				oldLineNumber: null,
				newLineNumber: newLineNum
			});
			newLineNum++;
		} else if (line.startsWith('-')) {
			currentHunk.removedLineNumbers.push(oldLineNum);
			currentHunk.lines.push({
				type: 'removed',
				content: line.substring(1),
				oldLineNumber: oldLineNum,
				newLineNumber: null
			});
			oldLineNum++;
		} else if (line.startsWith(' ') || line === '') {
			// Context line or empty line within diff
			currentHunk.lines.push({
				type: 'context',
				content: line.startsWith(' ') ? line.substring(1) : line,
				oldLineNumber: oldLineNum,
				newLineNumber: newLineNum
			});
			oldLineNum++;
			newLineNum++;
		}
	}

	if (currentHunk) {
		hunks.push(currentHunk);
	}

	return hunks;
}

/**
 * Compress array of line numbers into ranges
 * [1,2,3,5,7,8,9] -> ["1-3", "5", "7-9"]
 */
export function compressToRanges(lineNumbers: number[]): string[] {
	if (lineNumbers.length === 0) return [];

	const sorted = [...lineNumbers].sort((a, b) => a - b);
	const ranges: string[] = [];
	let start = sorted[0]!;
	let end = sorted[0]!;

	for (let i = 1; i < sorted.length; i++) {
		const current = sorted[i]!;
		if (current === end + 1) {
			end = current;
		} else {
			ranges.push(start === end ? `${start}` : `${start}-${end}`);
			start = current;
			end = current;
		}
	}

	ranges.push(start === end ? `${start}` : `${start}-${end}`);
	return ranges;
}

/**
 * Generate reveal.js highlight string from diff hunks
 * Format: "1-3|5-7" for stepped, "1-3,5-7" for all at once
 */
export function generateHighlightString(
	hunks: DiffHunk[],
	mode: 'all' | 'stepped'
): string {
	// Collect all added line numbers
	const allAddedLines: number[] = [];

	for (const hunk of hunks) {
		allAddedLines.push(...hunk.addedLineNumbers);
	}

	if (allAddedLines.length === 0) {
		return '';
	}

	const ranges = compressToRanges(allAddedLines);

	// Join with | for stepped, , for all at once
	const separator = mode === 'stepped' ? '|' : ',';
	return ranges.join(separator);
}

/**
 * Remove common leading whitespace from all lines
 */
export function deindent(text: string): string {
	const lines = text.split('\n');

	// Find minimum indentation (ignoring empty lines)
	let minIndent = Infinity;
	for (const line of lines) {
		if (line.trim() === '') continue;
		const match = line.match(/^(\s*)/);
		const indent = match?.[1]?.length ?? 0;
		if (indent < minIndent) {
			minIndent = indent;
		}
	}

	// If no indentation found or all lines are empty, return as-is
	if (minIndent === Infinity || minIndent === 0) {
		return text;
	}

	// Remove the common indentation from all lines
	return lines
		.map(line => line.slice(minIndent))
		.join('\n');
}

/**
 * Format diff content, optionally filtering to only added lines with context
 */
export function formatDiffContent(
	hunks: DiffHunk[],
	includeRemoved: boolean = false
): string {
	const outputLines: string[] = [];

	for (let i = 0; i < hunks.length; i++) {
		const hunk = hunks[i]!;

		for (const line of hunk.lines) {
			if (line.type === 'removed' && !includeRemoved) continue;
			outputLines.push(line.content);
		}

		// Add separator between hunks if more than one
		if (i < hunks.length - 1) {
			outputLines.push('// ...');
		}
	}

	return deindent(outputLines.join('\n'));
}
