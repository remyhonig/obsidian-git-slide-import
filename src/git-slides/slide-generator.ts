/**
 * Generate Advanced Slides markdown from git commits and diffs
 */

import type { GitCommit, GitFileDiff, SlideFormatOptions, GeneratedSlide } from './types';
import { generateHighlightString, formatDiffContent, deindent } from './diff-parser';

/**
 * Create a code fence that won't break if content contains backticks.
 * Uses more backticks than the longest sequence found in the content.
 */
function createSafeCodeBlock(content: string, langSpec: string): string {
	// Find the longest sequence of backticks in the content
	const backtickMatches = content.match(/`+/g);
	const maxBackticks = backtickMatches
		? Math.max(...backtickMatches.map(m => m.length))
		: 0;

	// Use at least 3 backticks, or one more than the longest sequence found
	const fenceLength = Math.max(3, maxBackticks + 1);
	const fence = '`'.repeat(fenceLength);

	return `${fence}${langSpec}\n${content.trimEnd()}\n${fence}`;
}

/** Variables available in templates */
interface TemplateVariables {
	authorName: string;
	authorEmail: string;
	commitDate: string;
	messageTitle: string;
	messageBody: string;
	commitHash: string;
	commitHashShort: string;
	fileName?: string;
	filePath?: string;
	fileSummary?: string;
	code?: string;
	commitDetails?: string;
	[key: string]: string | undefined;
}

export class SlideGenerator {
	private options: SlideFormatOptions;

	constructor(options: SlideFormatOptions) {
		this.options = options;
	}

	/**
	 * Generate all slides from selected commits and files
	 * Commits should already be in chronological order (oldest first)
	 */
	generateSlides(
		commits: GitCommit[],
		fileDiffs: Map<string, GitFileDiff[]>
	): string {
		switch (this.options.slideOrganization) {
			case 'flat':
				return this.generateFlatSlides(commits, fileDiffs);
			case 'grouped':
				return this.generateGroupedSlides(commits, fileDiffs);
			case 'progressive':
				return this.generateProgressiveSlides(commits, fileDiffs);
			case 'per-hunk':
				return this.generatePerHunkSlides(commits, fileDiffs);
			default:
				return this.generateFlatSlides(commits, fileDiffs);
		}
	}

	/**
	 * Flat mode: One horizontal slide per file, simple linear flow
	 */
	private generateFlatSlides(
		commits: GitCommit[],
		fileDiffs: Map<string, GitFileDiff[]>
	): string {
		const slides: GeneratedSlide[] = [];

		for (const commit of commits) {
			const diffs = fileDiffs.get(commit.hash) ?? [];

			if (diffs.length === 0) {
				slides.push(this.generateCommitOnlySlide(commit));
			} else {
				for (const diff of diffs) {
					slides.push(this.generateFileSlide(commit, diff, diffs));
				}
			}
		}

		return slides
			.map(slide => this.formatSlide(slide))
			.join('\n\n---\n\n');
	}

	/**
	 * Grouped mode: Commit intro slide with vertical subslides for each file
	 */
	private generateGroupedSlides(
		commits: GitCommit[],
		fileDiffs: Map<string, GitFileDiff[]>
	): string {
		const slides: GeneratedSlide[] = [];

		for (const commit of commits) {
			const diffs = fileDiffs.get(commit.hash) ?? [];

			if (diffs.length === 0) {
				slides.push(this.generateCommitOnlySlide(commit));
			} else {
				slides.push(this.generateCommitWithSubslides(commit, diffs));
			}
		}

		return slides
			.map(slide => this.formatSlide(slide))
			.join('\n\n---\n\n');
	}

	/**
	 * Progressive mode: Same file shown evolving across commits
	 */
	private generateProgressiveSlides(
		commits: GitCommit[],
		fileDiffs: Map<string, GitFileDiff[]>
	): string {
		// Group diffs by file path
		const fileHistory = new Map<string, { commit: GitCommit; diff: GitFileDiff }[]>();

		for (const commit of commits) {
			const diffs = fileDiffs.get(commit.hash) ?? [];
			for (const diff of diffs) {
				if (!fileHistory.has(diff.path)) {
					fileHistory.set(diff.path, []);
				}
				fileHistory.get(diff.path)!.push({ commit, diff });
			}
		}

		// Generate slides for each file's evolution
		const slides: GeneratedSlide[] = [];

		for (const [filePath, history] of fileHistory) {
			for (let i = 0; i < history.length; i++) {
				const { commit, diff } = history[i]!;
				const stepLabel = history.length > 1 ? ` (${i + 1}/${history.length})` : '';

				const commitVars = this.getCommitVariables(commit);
				const fileVars = this.getFileVariables(diff, [diff]);
				const codeBlock = this.generateCodeBlock(diff);
				const commitDetails = this.renderTemplate(this.options.commitDetailsTemplate, commitVars);

				const slideVars: TemplateVariables = {
					...commitVars,
					...fileVars,
					fileName: (fileVars.fileName ?? filePath) + stepLabel,
					code: codeBlock,
					commitDetails
				};

				const content = this.renderTemplate(this.options.slideTemplate, slideVars);

				slides.push({
					title: filePath,
					content,
					notes: null
				});
			}
		}

		return slides
			.map(slide => this.formatSlide(slide))
			.join('\n\n---\n\n');
	}

	/**
	 * Per-hunk mode: Each diff hunk gets its own slide
	 */
	private generatePerHunkSlides(
		commits: GitCommit[],
		fileDiffs: Map<string, GitFileDiff[]>
	): string {
		const slides: GeneratedSlide[] = [];

		for (const commit of commits) {
			const diffs = fileDiffs.get(commit.hash) ?? [];

			if (diffs.length === 0) {
				slides.push(this.generateCommitOnlySlide(commit));
				continue;
			}

			for (const diff of diffs) {
				const commitVars = this.getCommitVariables(commit);

				// Generate a slide for each hunk
				for (let hunkIdx = 0; hunkIdx < diff.hunks.length; hunkIdx++) {
					const hunk = diff.hunks[hunkIdx]!;
					const hunkLabel = diff.hunks.length > 1 ? ` (hunk ${hunkIdx + 1}/${diff.hunks.length})` : '';

					// Generate code block for just this hunk
					const includeRemoved = this.options.lineChangeDisplay !== 'additions-only';
					const hunkContent = formatDiffContent([hunk], includeRemoved, this.options.lineChangeDisplay);
					const lang = diff.language;

					// Calculate highlights for this hunk
					let highlights = '';
					if (this.options.highlightAddedLines && hunk.addedLineNumbers.length > 0) {
						const addedLines: number[] = [];
						let lineNum = 1;
						for (const line of hunk.lines) {
							if (line.type === 'removed' && !includeRemoved) continue;
							if (line.type === 'added') {
								addedLines.push(lineNum);
							}
							lineNum++;
						}
						if (addedLines.length > 0) {
							highlights = this.compressToRanges(addedLines).join(
								this.options.highlightMode === 'stepped' ? '|' : ','
							);
						}
					}

					const highlightSpec = highlights ? ` [${highlights}]` : '';
					const codeBlock = createSafeCodeBlock(hunkContent, lang + highlightSpec);

					const fileVars: TemplateVariables = {
						...commitVars,
						fileName: this.getFileName(diff.path) + hunkLabel,
						filePath: diff.path,
						fileSummary: '',
						code: codeBlock,
						commitDetails: this.renderTemplate(this.options.commitDetailsTemplate, commitVars)
					};

					const content = this.renderTemplate(this.options.slideTemplate, fileVars);

					slides.push({
						title: diff.path,
						content,
						notes: null
					});
				}
			}
		}

		return slides
			.map(slide => this.formatSlide(slide))
			.join('\n\n---\n\n');
	}

	/**
	 * Generate a slide for a commit with no files selected
	 */
	private generateCommitOnlySlide(commit: GitCommit): GeneratedSlide {
		const vars = this.getCommitVariables(commit);
		const content = this.renderTemplate(DEFAULT_COMMIT_ONLY_TEMPLATE, vars);

		return {
			title: vars.messageTitle,
			content,
			notes: null
		};
	}

	/**
	 * Generate a slide for a single file within a commit
	 */
	private generateFileSlide(
		commit: GitCommit,
		diff: GitFileDiff,
		allDiffs: GitFileDiff[]
	): GeneratedSlide {
		const commitVars = this.getCommitVariables(commit);
		const fileVars = this.getFileVariables(diff, allDiffs);
		const codeBlock = this.generateCodeBlock(diff);

		// Render commit details using the template
		const commitDetails = this.renderTemplate(this.options.commitDetailsTemplate, commitVars);

		// Build all variables for the slide template
		const slideVars: TemplateVariables = {
			...commitVars,
			...fileVars,
			code: codeBlock,
			commitDetails
		};

		const content = this.renderTemplate(this.options.slideTemplate, slideVars);

		return {
			title: fileVars.fileName ?? diff.path,
			content,
			notes: null
		};
	}

	/**
	 * Generate a commit slide with subslides for each file (vertical slides in reveal.js)
	 */
	private generateCommitWithSubslides(
		commit: GitCommit,
		diffs: GitFileDiff[]
	): GeneratedSlide {
		const commitVars = this.getCommitVariables(commit);
		const parts: string[] = [];

		// Main slide with commit info
		const commitDetails = this.renderTemplate(this.options.commitDetailsTemplate, commitVars);
		parts.push(`## ${commitVars.messageTitle}\n\n${commitDetails}`);

		// Subslides for each file (using vertical slide separator)
		for (const diff of diffs) {
			const fileVars = this.getFileVariables(diff, diffs);
			const codeBlock = this.generateCodeBlock(diff);

			const slideVars: TemplateVariables = {
				...commitVars,
				...fileVars,
				code: codeBlock,
				commitDetails: '' // Don't repeat commit details on subslides
			};

			const fileSlide = this.renderTemplate(this.options.slideTemplate, slideVars);
			parts.push(fileSlide);
		}

		// Join with vertical slide separator (---)
		return {
			title: commitVars.messageTitle,
			content: parts.join('\n\n--\n\n'),
			notes: null
		};
	}

	/**
	 * Generate a slide for an entire commit with multiple files
	 */
	private generateCommitSlide(
		commit: GitCommit,
		diffs: GitFileDiff[]
	): GeneratedSlide {
		const commitVars = this.getCommitVariables(commit);
		const parts: string[] = [];

		// Title
		parts.push(`## ${commitVars.messageTitle}`);

		// Commit details
		const commitDetails = this.renderTemplate(this.options.commitDetailsTemplate, commitVars);
		if (commitDetails) {
			parts.push(commitDetails);
		}

		// Code blocks for each file
		for (const diff of diffs) {
			parts.push(`### ${this.getFileName(diff.path)}`);
			parts.push(this.generateCodeBlock(diff));
		}

		return {
			title: commitVars.messageTitle,
			content: parts.join('\n\n'),
			notes: null
		};
	}

	/**
	 * Generate the code block with highlight syntax
	 */
	private generateCodeBlock(diff: GitFileDiff): string {
		const lang = diff.language;

		let content: string;
		let highlights = '';

		if (this.options.showFullFile && diff.newContent) {
			// Show full file with added lines highlighted (deindented)
			content = deindent(diff.newContent);
			if (this.options.highlightAddedLines && diff.hunks.length > 0) {
				highlights = generateHighlightString(diff.hunks, this.options.highlightMode);
			}
		} else {
			// Show only diff content (formatDiffContent already deindents)
			const includeRemoved = this.options.lineChangeDisplay !== 'additions-only';
			content = formatDiffContent(diff.hunks, includeRemoved, this.options.lineChangeDisplay);
			if (this.options.highlightAddedLines && diff.hunks.length > 0) {
				// Recalculate line numbers for the extracted content
				highlights = this.calculateDiffHighlights(diff, includeRemoved);
			}
		}

		// Format: ```typescript [1-3|5-7] (with safe fencing for nested backticks)
		const highlightSpec = highlights ? ` [${highlights}]` : '';
		const langSpec = `${lang}${highlightSpec}`;

		return createSafeCodeBlock(content, langSpec);
	}

	/**
	 * Calculate highlight line numbers for extracted diff content
	 * (when showing just the diff, line numbers are relative to the extracted content)
	 */
	private calculateDiffHighlights(diff: GitFileDiff, includeRemoved: boolean = false): string {
		const addedLineNumbers: number[] = [];
		let currentLine = 1;

		for (let hunkIdx = 0; hunkIdx < diff.hunks.length; hunkIdx++) {
			const hunk = diff.hunks[hunkIdx]!;

			for (const line of hunk.lines) {
				if (line.type === 'removed' && !includeRemoved) continue;

				if (line.type === 'added') {
					addedLineNumbers.push(currentLine);
				}
				currentLine++;
			}

			// Account for hunk separator if not last hunk
			if (hunkIdx < diff.hunks.length - 1) {
				currentLine++; // "// ..." separator
			}
		}

		if (addedLineNumbers.length === 0) return '';

		// Compress to ranges
		const ranges = this.compressToRanges(addedLineNumbers);
		const separator = this.options.highlightMode === 'stepped' ? '|' : ',';
		return ranges.join(separator);
	}

	private compressToRanges(lineNumbers: number[]): string[] {
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

	private generateTitle(commit: GitCommit, diff: GitFileDiff): string {
		switch (this.options.slideTitle) {
			case 'commit':
				return commit.message;
			case 'file':
				return this.getFileName(diff.path);
			case 'both':
				return `${commit.hashShort}: ${this.getFileName(diff.path)}`;
			default:
				return commit.message;
		}
	}

	private getFileName(path: string): string {
		return path.split('/').pop() ?? path;
	}

	private formatSlide(slide: GeneratedSlide): string {
		if (slide.notes) {
			return slide.content + '\n\nnote: ' + slide.notes;
		}
		return slide.content;
	}

	/**
	 * Parse commit message into title and body
	 * Rules:
	 * 1. First line is the title, after one or more empty lines the body follows
	 * 2. If no empty line but there's a newline, split at first newline
	 * 3. If no newline but first line is very long (>72 chars), split at first period
	 */
	private parseCommitMessage(message: string): { title: string; body: string } {
		if (!message) {
			return { title: '', body: '' };
		}

		// Check for empty line separator (standard git convention)
		const emptyLineMatch = message.match(/^(.+?)\n\s*\n([\s\S]*)$/);
		if (emptyLineMatch) {
			return {
				title: emptyLineMatch[1]?.trim() ?? '',
				body: emptyLineMatch[2]?.trim() ?? ''
			};
		}

		// Check for simple newline separator
		const newlineIndex = message.indexOf('\n');
		if (newlineIndex !== -1) {
			return {
				title: message.slice(0, newlineIndex).trim(),
				body: message.slice(newlineIndex + 1).trim()
			};
		}

		// If very long single line (>72 chars), try to split at first period
		if (message.length > 72) {
			const periodIndex = message.indexOf('. ');
			if (periodIndex !== -1 && periodIndex < 100) {
				return {
					title: message.slice(0, periodIndex + 1).trim(),
					body: message.slice(periodIndex + 2).trim()
				};
			}
		}

		// Single line message, no body
		return { title: message.trim(), body: '' };
	}

	/**
	 * Extract commit-related template variables
	 */
	private getCommitVariables(commit: GitCommit): TemplateVariables {
		const { title: messageTitle, body: messageBody } = this.parseCommitMessage(commit.message);

		// Parse author name and email (format: "Name <email>" or just "Name")
		const authorMatch = commit.author.match(/^(.+?)\s*<(.+)>$/);
		const authorName = authorMatch ? authorMatch[1]?.trim() ?? commit.author : commit.author;
		const authorEmail = authorMatch ? authorMatch[2]?.trim() ?? '' : '';

		return {
			authorName,
			authorEmail,
			commitDate: this.formatDateWithFormat(commit.date),
			messageTitle,
			messageBody,
			commitHash: commit.hash,
			commitHashShort: commit.hashShort
		};
	}

	/**
	 * Extract file-related template variables
	 */
	private getFileVariables(diff: GitFileDiff, allDiffs: GitFileDiff[]): TemplateVariables {
		const fileName = this.getFileName(diff.path);
		const filePath = diff.path;

		// Generate file summary
		let fileSummary = '';
		if (allDiffs.length > 1) {
			const otherFiles = allDiffs
				.filter(d => d.path !== diff.path)
				.map(d => this.getFileName(d.path))
				.slice(0, 5);

			if (otherFiles.length > 0) {
				const moreCount = allDiffs.length - 1 - otherFiles.length;
				fileSummary = `Also changed: ${otherFiles.join(', ')}`;
				if (moreCount > 0) {
					fileSummary += ` and ${moreCount} more`;
				}
			}
		}

		return {
			authorName: '',
			authorEmail: '',
			commitDate: '',
			messageTitle: '',
			messageBody: '',
			commitHash: '',
			commitHashShort: '',
			fileName,
			filePath,
			fileSummary
		};
	}

	/**
	 * Render a template with variables
	 * Substitutes {{variable}} with value, or removes the line if value is empty
	 */
	private renderTemplate(template: string, vars: TemplateVariables): string {
		let result = template;

		// Substitute variables: {{var}}
		// If a line contains only a variable that resolves to empty, remove the entire line
		result = result.replace(/^[ \t]*\{\{(\w+)\}\}[ \t]*$/gm, (_, varName: string) => {
			const value = vars[varName]?.trim();
			return value ?? '';
		});

		// Substitute remaining inline variables
		result = result.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
			return vars[varName] ?? '';
		});

		// Clean up multiple consecutive blank lines
		result = result.replace(/\n{3,}/g, '\n\n');

		return result.trim();
	}

	private formatDate(date: Date): string {
		return date.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	private formatDateWithFormat(date: Date): string {
		const format = this.options.dateFormat;

		// Simple date format implementation
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const fullMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

		const day = date.getDate();
		const month = date.getMonth();
		const year = date.getFullYear();
		const hours = date.getHours();
		const minutes = date.getMinutes();

		return format
			.replace('yyyy', String(year))
			.replace('yy', String(year).slice(-2))
			.replace('MMMM', fullMonths[month] ?? '')
			.replace('MMM', months[month] ?? '')
			.replace('MM', String(month + 1).padStart(2, '0'))
			.replace('dd', String(day).padStart(2, '0'))
			.replace('d', String(day))
			.replace('HH', String(hours).padStart(2, '0'))
			.replace('mm', String(minutes).padStart(2, '0'));
	}
}

/** Default template for commit details */
export const DEFAULT_COMMIT_DETAILS_TEMPLATE = `> **{{messageTitle}}**

{{messageBody}}

*{{authorName}} • {{commitDate}}*`;

/** Default template for a slide */
export const DEFAULT_SLIDE_TEMPLATE = `## {{fileName}}

{{commitDetails}}

{{code}}`;

/** Default template for commit-only slide (no files) */
export const DEFAULT_COMMIT_ONLY_TEMPLATE = `## {{messageTitle}}

{{messageBody}}

*{{authorName}} <{{authorEmail}}> • {{commitDate}} • {{commitHashShort}}*`;

/**
 * Create default slide format options
 */
export function createDefaultFormatOptions(): SlideFormatOptions {
	return {
		showLineNumbers: true,
		highlightAddedLines: true,
		highlightMode: 'stepped',
		lineChangeDisplay: 'additions-only',
		includeCommitMessage: true,
		includeFileSummary: true,
		includeAuthorDate: true,
		showFullFile: false,
		contextLines: 3,
		slideOrganization: 'flat',
		slideTitle: 'both',
		commitDetailsTemplate: DEFAULT_COMMIT_DETAILS_TEMPLATE,
		slideTemplate: DEFAULT_SLIDE_TEMPLATE,
		dateFormat: 'MMM d, yyyy'
	};
}
