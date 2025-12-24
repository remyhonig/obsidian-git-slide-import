/**
 * Core type definitions for the Git Slide Import plugin
 */

/** Single commit representation */
export interface GitCommit {
	hash: string;
	hashShort: string;
	message: string;
	author: string;
	date: Date;
	files: GitFileChange[];
}

/** File change within a commit */
export interface GitFileChange {
	path: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed';
	additions: number;
	deletions: number;
}

/** Detailed file diff information */
export interface GitFileDiff {
	path: string;
	hunks: DiffHunk[];
	newContent: string | null;
	language: string;
}

/** Single diff hunk */
export interface DiffHunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	addedLineNumbers: number[];
	removedLineNumbers: number[];
	lines: DiffLine[];
}

/** Individual line in a diff */
export interface DiffLine {
	type: 'context' | 'added' | 'removed';
	content: string;
	oldLineNumber: number | null;
	newLineNumber: number | null;
}

/** Time period options for filtering */
export type TimePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'present';

/** Filter criteria for commit selection */
export interface CommitFilter {
	branch: string | null;
	sinceDate: Date | null;
	period: TimePeriod;
	fileRegex: string | null;
	maxCommits: number;
}

/** How to organize slides */
export type SlideOrganization = 'flat' | 'grouped' | 'progressive' | 'per-hunk';

/** How to display line changes */
export type LineChangeDisplay = 'additions-only' | 'full-diff';

/** Slide generation configuration */
export interface SlideFormatOptions {
	showLineNumbers: boolean;
	highlightAddedLines: boolean;
	highlightMode: 'all' | 'stepped';
	lineChangeDisplay: LineChangeDisplay;
	includeCommitMessage: boolean;
	includeFileSummary: boolean;
	includeAuthorDate: boolean;
	showFullFile: boolean;
	contextLines: number;
	slideOrganization: SlideOrganization;
	slideTitle: 'commit' | 'file' | 'both';
	commitDetailsTemplate: string;
	slideTemplate: string;
	dateFormat: string;
}

/** User's import selection */
export interface ImportSelection {
	repoPath: string;
	selectedCommits: string[];
	selectedFiles: Map<string, string[]>;
	formatOptions: SlideFormatOptions;
}

/** Generated slide content */
export interface GeneratedSlide {
	title: string;
	content: string;
	notes: string | null;
}
