/**
 * Main view for importing git commits as slides
 * Opens as an editor tab instead of a modal
 */

import { ItemView, WorkspaceLeaf, Notice, Setting, debounce, ViewStateResult, setIcon } from 'obsidian';
import type GitSlideImportPlugin from '../main';
import { GIT_IMPORT_VIEW_TYPE } from './constants';
import { GitService } from '../git-slides/git-service';
import {
	SlideGenerator,
	createDefaultFormatOptions,
	DEFAULT_COMMIT_DETAILS_TEMPLATE,
	DEFAULT_SLIDE_TEMPLATE
} from '../git-slides/slide-generator';
import { parseDiffHunks } from '../git-slides/diff-parser';
import { detectLanguage } from '../git-slides/language-detector';
import type {
	GitCommit,
	GitFileDiff,
	GitFileChange,
	CommitFilter,
	SlideFormatOptions,
	SlideOrganization,
	TimePeriod
} from '../git-slides/types';

/** File status icons matching GitHub's PR view style */
const FILE_STATUS_ICONS: Record<GitFileChange['status'], { icon: string; cls: string; title: string }> = {
	added: { icon: '+', cls: 'status-added', title: 'Added' },
	modified: { icon: '●', cls: 'status-modified', title: 'Modified' },
	deleted: { icon: '−', cls: 'status-deleted', title: 'Deleted' },
	renamed: { icon: '→', cls: 'status-renamed', title: 'Renamed' }
};

/** Filter presets for popular frameworks and languages */
interface FilterPreset {
	name: string;
	include: string;
	exclude: string;
}

const FILTER_PRESETS: FilterPreset[] = [
	{
		name: 'All files',
		include: '',
		exclude: ''
	},
	{
		name: 'Markdown',
		include: '\\.md$',
		exclude: ''
	},
	{
		name: 'JavaScript/TypeScript',
		include: '\\.(ts|js|tsx|jsx|mjs|cjs|json|yaml|yml)$',
		exclude: '(node_modules|dist|build|\\.min\\.|package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml)$'
	},
	{
		name: 'React',
		include: '\\.(tsx|jsx|ts|js|css|scss|json|yaml|yml)$',
		exclude: '(node_modules|dist|build|\\.min\\.|package-lock\\.json|yarn\\.lock)$'
	},
	{
		name: 'Vue.js',
		include: '\\.(vue|ts|js|css|scss|json|yaml|yml)$',
		exclude: '(node_modules|dist|build|\\.min\\.|package-lock\\.json|yarn\\.lock)$'
	},
	{
		name: 'PHP/Laravel',
		include: '\\.(php|blade\\.php|json|yaml|yml)$',
		exclude: '(vendor|storage|bootstrap/cache|composer\\.lock)$'
	},
	{
		name: 'PHP/Symfony',
		include: '\\.(php|twig|json|yaml|yml)$',
		exclude: '(vendor|var|composer\\.lock)$'
	},
	{
		name: 'Java/Spring',
		include: '\\.(java|xml|properties|json|yaml|yml)$',
		exclude: '(target|build|\\.idea|\\.gradle)$'
	},
	{
		name: 'Python',
		include: '\\.(py|json|yaml|yml|toml)$',
		exclude: '(__pycache__|venv|\\.venv|\\.(pyc|pyo)|poetry\\.lock)$'
	},
	{
		name: 'Go',
		include: '\\.(go|mod|sum|json|yaml|yml)$',
		exclude: '(vendor)$'
	},
	{
		name: 'Rust',
		include: '\\.(rs|toml|json|yaml|yml)$',
		exclude: '(target|Cargo\\.lock)$'
	},
	{
		name: 'Ruby',
		include: '\\.(rb|erb|json|yaml|yml)$',
		exclude: '(vendor|Gemfile\\.lock)$'
	}
];

/** Which column is currently focused for keyboard navigation */
type FocusedColumn = 'commits' | 'files' | 'preview' | 'render';

export class GitImportView extends ItemView {
	private plugin: GitSlideImportPlugin;

	// State
	private repoPath: string | null = null;
	private repoName: string = 'Git Import';
	private gitService: GitService | null = null;
	private branches: string[] = [];
	private commits: GitCommit[] = [];
	private selectedCommit: GitCommit | null = null;
	private selectedCommitHashes: Set<string> = new Set();
	private selectedFiles: Map<string, Set<string>> = new Map();
	private currentFiles: GitFileChange[] = [];
	private formatOptions: SlideFormatOptions;
	private filter: CommitFilter = {
		branch: null,
		sinceDate: this.getQuarterAgo(),
		period: 'present' as TimePeriod,
		fileRegex: null,
		maxCommits: 100
	};

	private getQuarterAgo(): Date {
		const date = new Date();
		date.setMonth(date.getMonth() - 3);
		return date;
	}

	// File filter patterns
	// Default to "All files" preset (no filters)
	private includePattern = '';
	private excludePattern = '';

	// Keyboard navigation state
	private focusedColumn: FocusedColumn = 'commits';
	private focusedCommitIndex = 0;
	private focusedFileIndex = 0;

	// Cache for preview generation
	private previewCache: Map<string, GitFileDiff[]> = new Map();
	private isGeneratingPreview = false;

	// UI element references
	private repoBtn: HTMLButtonElement | null = null;
	private branchSelectEl: HTMLSelectElement | null = null;
	private selectionPanelEl: HTMLElement | null = null;
	private commitPanelEl: HTMLElement | null = null;
	private filePanelEl: HTMLElement | null = null;
	private commitListEl: HTMLElement | null = null;
	private fileListEl: HTMLElement | null = null;
	private fileCommitMessageEl: HTMLElement | null = null;
	private fileDiffPreviewEl: HTMLElement | null = null;
	private previewEl: HTMLElement | null = null;
	private markdownPreviewEl: HTMLElement | null = null;
	private slidesPreviewEl: HTMLElement | null = null;
	private renderPanelEl: HTMLElement | null = null;
	private importBtn: HTMLButtonElement | null = null;
	private includeInputEl: HTMLInputElement | null = null;
	private excludeInputEl: HTMLInputElement | null = null;
	private dateInputEl: HTMLInputElement | null = null;

	// Preview tab state
	private activePreviewTab: 'markdown' | 'slides' = 'slides';
	private slideCountBadgeEl: HTMLElement | null = null;
	private slidesTabEl: HTMLButtonElement | null = null;
	private markdownTabEl: HTMLButtonElement | null = null;

	// Currently selected file for diff preview
	private selectedFile: GitFileChange | null = null;

	// Debounced preview update
	private debouncedUpdatePreview = debounce(
		() => { void this.generatePreview(); },
		300,
		true
	);

	// Debounced settings save
	private debouncedSaveSettings = debounce(
		() => { void this.saveSettings(); },
		500,
		true
	);

	constructor(leaf: WorkspaceLeaf, plugin: GitSlideImportPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.formatOptions = this.createFormatOptionsFromDefaults();
		// Load file filters from settings
		this.includePattern = this.plugin.settings.fileFilters.includePattern;
		this.excludePattern = this.plugin.settings.fileFilters.excludePattern;
	}

	/**
	 * Save current format options and filters to plugin settings
	 */
	private async saveSettings(): Promise<void> {
		// Update format defaults from current options
		this.plugin.settings.formatDefaults.highlightAddedLines = this.formatOptions.highlightAddedLines;
		this.plugin.settings.formatDefaults.highlightMode = this.formatOptions.highlightMode;
		this.plugin.settings.formatDefaults.lineChangeDisplay = this.formatOptions.lineChangeDisplay;
		this.plugin.settings.formatDefaults.showFullFile = this.formatOptions.showFullFile;
		this.plugin.settings.formatDefaults.contextLines = this.formatOptions.contextLines;
		this.plugin.settings.formatDefaults.slideOrganization = this.formatOptions.slideOrganization;
		this.plugin.settings.formatDefaults.commitDetailsTemplate = this.formatOptions.commitDetailsTemplate;
		this.plugin.settings.formatDefaults.slideTemplate = this.formatOptions.slideTemplate;
		this.plugin.settings.formatDefaults.dateFormat = this.formatOptions.dateFormat;

		// Update file filters
		this.plugin.settings.fileFilters.includePattern = this.includePattern;
		this.plugin.settings.fileFilters.excludePattern = this.excludePattern;

		await this.plugin.saveSettings();
	}

	getViewType(): string {
		return GIT_IMPORT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.repoName;
	}

	getIcon(): string {
		return 'git-branch';
	}

	// State persistence (repo path only)
	getState(): Record<string, unknown> {
		return { repoPath: this.repoPath };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = state as { repoPath?: string };
		if (s?.repoPath) {
			// Defer opening until after UI is built
			await new Promise(resolve => setTimeout(resolve, 100));
			await this.openRepository(s.repoPath);
		}
		result.history = false;
	}

	private createFormatOptionsFromDefaults(): SlideFormatOptions {
		const defaults = createDefaultFormatOptions();
		const formatDefaults = this.plugin.settings.formatDefaults;
		return {
			...defaults,
			highlightAddedLines: formatDefaults.highlightAddedLines,
			highlightMode: formatDefaults.highlightMode,
			lineChangeDisplay: formatDefaults.lineChangeDisplay,
			showFullFile: formatDefaults.showFullFile,
			contextLines: formatDefaults.contextLines,
			includeCommitMessage: formatDefaults.includeCommitMessage,
			includeFileSummary: formatDefaults.includeFileSummary,
			slideOrganization: formatDefaults.slideOrganization,
			commitDetailsTemplate: formatDefaults.commitDetailsTemplate,
			slideTemplate: formatDefaults.slideTemplate,
			dateFormat: formatDefaults.dateFormat
		};
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass('git-import-view');
		this.buildUI();
		this.setupKeyboardNavigation();
		await Promise.resolve();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
		this.gitService = null;
		this.previewCache.clear();
		await Promise.resolve();
	}

	private setupKeyboardNavigation(): void {
		this.containerEl.addEventListener('keydown', (e: KeyboardEvent) => {
			// Don't intercept if focus is on an input element (except Tab navigation)
			const target = e.target as HTMLElement;
			const isFormElement = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA';

			if (e.key === 'Tab') {
				e.preventDefault();
				if (e.shiftKey) {
					this.navigateColumn('prev');
				} else {
					this.navigateColumn('next');
				}
				return;
			}

			if (isFormElement) {
				return;
			}

			switch (e.key) {
				case 'ArrowUp':
					// Only prevent default for list navigation, let preview scroll naturally
					if (this.focusedColumn === 'commits' || this.focusedColumn === 'files') {
						e.preventDefault();
						this.navigateVertical(-1);
					}
					break;
				case 'ArrowDown':
					// Only prevent default for list navigation, let preview scroll naturally
					if (this.focusedColumn === 'commits' || this.focusedColumn === 'files') {
						e.preventDefault();
						this.navigateVertical(1);
					}
					break;
				case ' ':
					e.preventDefault();
					this.toggleCurrentSelection();
					break;
			}
		});
	}

	private navigateVertical(direction: -1 | 1): void {
		if (this.focusedColumn === 'commits') {
			const newIndex = this.focusedCommitIndex + direction;
			if (newIndex >= 0 && newIndex < this.commits.length) {
				this.focusedCommitIndex = newIndex;
				this.updateFocusHighlight();
				// Auto-select commit to show its files
				const commit = this.commits[this.focusedCommitIndex];
				if (commit) {
					void this.selectCommit(commit);
				}
			}
		} else {
			const newIndex = this.focusedFileIndex + direction;
			if (newIndex >= 0 && newIndex < this.currentFiles.length) {
				this.focusedFileIndex = newIndex;
				this.updateFocusHighlight();
				// Show diff for focused file
				this.selectFileAtIndex(newIndex);
			}
		}
	}

	private navigateColumn(direction: 'next' | 'prev'): void {
		const columns: FocusedColumn[] = ['commits', 'files', 'preview', 'render'];
		const currentIndex = columns.indexOf(this.focusedColumn);
		let newIndex: number;

		if (direction === 'next') {
			newIndex = (currentIndex + 1) % columns.length;
		} else {
			newIndex = (currentIndex - 1 + columns.length) % columns.length;
		}

		this.focusedColumn = columns[newIndex]!;
		this.onColumnFocus();
		this.updateFocusHighlight();
	}

	private onColumnFocus(): void {
		// Focus appropriate element and auto-select first item when needed
		if (this.focusedColumn === 'commits') {
			this.commitListEl?.focus();
			// Keep current selection if valid, otherwise select first
			if (this.commits.length > 0) {
				if (this.focusedCommitIndex < 0 || this.focusedCommitIndex >= this.commits.length) {
					this.focusedCommitIndex = 0;
				}
				const commit = this.commits[this.focusedCommitIndex];
				if (commit) {
					void this.selectCommit(commit);
				}
			}
		} else if (this.focusedColumn === 'files') {
			this.fileListEl?.focus();
			if (this.currentFiles.length > 0) {
				this.focusedFileIndex = 0;
				this.selectFileAtIndex(0);
			}
		} else if (this.focusedColumn === 'preview') {
			// Focus the preview area for scrolling with arrow keys
			this.previewEl?.focus();
		} else if (this.focusedColumn === 'render') {
			// Focus the copy button
			this.importBtn?.focus();
		}
	}

	private selectFileAtIndex(index: number): void {
		const file = this.currentFiles[index];
		if (!file || !this.selectedCommit) return;

		// Update file selection visual
		this.fileListEl?.querySelectorAll('.git-import-file').forEach(el => {
			el.removeClass('file-selected');
		});
		const fileEls = this.fileListEl?.querySelectorAll('.git-import-file');
		fileEls?.[index]?.addClass('file-selected');

		// Show diff for this file
		this.selectedFile = file;
		void this.showFileDiff(this.selectedCommit.hash, file);
	}

	private toggleCurrentSelection(): void {
		if (this.focusedColumn === 'commits') {
			// Space on commit = select it and move focus to files
			const commit = this.commits[this.focusedCommitIndex];
			if (commit) {
				void this.selectCommit(commit);
				this.focusedColumn = 'files';
				this.focusedFileIndex = 0;
				this.updateFocusHighlight();
			}
		} else if (this.focusedColumn === 'files') {
			const file = this.currentFiles[this.focusedFileIndex];
			if (file && this.selectedCommit) {
				const commitHash = this.selectedCommit.hash;
				if (!this.selectedFiles.has(commitHash)) {
					this.selectedFiles.set(commitHash, new Set());
				}
				const selectedForCommit = this.selectedFiles.get(commitHash)!;
				const isSelected = selectedForCommit.has(file.path);

				if (isSelected) {
					selectedForCommit.delete(file.path);
				} else {
					selectedForCommit.add(file.path);
					// Also mark the commit as having selections
					this.selectedCommitHashes.add(commitHash);
				}
				this.updateFileCheckbox(file.path, !isSelected);
				this.updateCommitHasSelections(commitHash);
				this.updateImportButton();
				this.debouncedUpdatePreview();
			}
		} else if (this.focusedColumn === 'preview') {
			// Toggle between slides and markdown tabs
			if (this.activePreviewTab === 'slides') {
				this.switchToMarkdownTab();
			} else {
				this.switchToSlidesTab();
			}
		}
	}

	private switchToSlidesTab(): void {
		this.activePreviewTab = 'slides';
		this.slidesTabEl?.addClass('active');
		this.markdownTabEl?.removeClass('active');
		this.markdownPreviewEl?.addClass('is-hidden');
		this.slidesPreviewEl?.removeClass('is-hidden');
	}

	private switchToMarkdownTab(): void {
		this.activePreviewTab = 'markdown';
		this.markdownTabEl?.addClass('active');
		this.slidesTabEl?.removeClass('active');
		this.slidesPreviewEl?.addClass('is-hidden');
		this.markdownPreviewEl?.removeClass('is-hidden');
	}

	private renderEmptyState(container: HTMLElement, icon: string, message: string): void {
		container.empty();
		const emptyState = container.createDiv({ cls: 'git-import-empty-state' });
		const iconEl = emptyState.createDiv({ cls: 'git-import-empty-icon' });
		setIcon(iconEl, icon);
		emptyState.createDiv({ cls: 'git-import-empty-message', text: message });
	}

	private renderClickableVariables(
		container: HTMLElement,
		variables: string[],
		getTextarea: () => HTMLTextAreaElement | null
	): void {
		const varsContainer = container.createDiv({ cls: 'git-import-template-vars' });

		for (const varName of variables) {
			const varTag = varsContainer.createSpan({
				cls: 'git-import-var-tag',
				text: `{{${varName}}}`
			});

			varTag.addEventListener('click', () => {
				const textarea = getTextarea();
				if (!textarea) return;

				const varText = `{{${varName}}}`;
				const start = textarea.selectionStart;
				const end = textarea.selectionEnd;
				const value = textarea.value;

				// Insert at cursor position
				textarea.value = value.slice(0, start) + varText + value.slice(end);

				// Move cursor after inserted text
				const newPos = start + varText.length;
				textarea.setSelectionRange(newPos, newPos);
				textarea.focus();

				// Trigger change event
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
			});
		}
	}

	private updateFocusHighlight(): void {
		// Remove all focus highlights from list items
		this.commitListEl?.querySelectorAll('.git-import-commit').forEach(el => {
			el.removeClass('keyboard-focus');
		});
		this.fileListEl?.querySelectorAll('.git-import-file').forEach(el => {
			el.removeClass('keyboard-focus');
		});

		// Remove column focus indicators
		this.commitPanelEl?.removeClass('column-focused');
		this.filePanelEl?.removeClass('column-focused');
		this.previewEl?.parentElement?.removeClass('column-focused');
		this.renderPanelEl?.removeClass('column-focused');

		// Add focus highlight based on current column
		if (this.focusedColumn === 'commits') {
			this.commitPanelEl?.addClass('column-focused');
			const commitEls = this.commitListEl?.querySelectorAll('.git-import-commit');
			const focusedEl = commitEls?.[this.focusedCommitIndex];
			focusedEl?.addClass('keyboard-focus');
			focusedEl?.scrollIntoView({ block: 'nearest' });
		} else if (this.focusedColumn === 'files') {
			this.filePanelEl?.addClass('column-focused');
			const fileEls = this.fileListEl?.querySelectorAll('.git-import-file');
			const focusedEl = fileEls?.[this.focusedFileIndex];
			focusedEl?.addClass('keyboard-focus');
			focusedEl?.scrollIntoView({ block: 'nearest' });
		} else if (this.focusedColumn === 'preview') {
			this.previewEl?.parentElement?.addClass('column-focused');
		} else if (this.focusedColumn === 'render') {
			this.renderPanelEl?.addClass('column-focused');
		}
	}

	private updateFileCheckbox(path: string, checked: boolean): void {
		const fileEls = this.fileListEl?.querySelectorAll('.git-import-file');
		for (const el of Array.from(fileEls ?? [])) {
			const pathEl = el.querySelector('.git-import-file-path');
			if (pathEl?.textContent === path) {
				const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
				if (checkbox) checkbox.checked = checked;
				break;
			}
		}
	}

	private buildUI(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('git-import-content');

		// Filter section (includes repo selector)
		this.buildFilterSection(contentEl);

		// Four-panel content area
		this.buildPanels(contentEl);
	}

	private buildFilterSection(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'git-import-filters' });

		// Repository selector button (shows repo name when selected)
		const repoGroup = section.createDiv({ cls: 'git-import-filter-group' });
		this.repoBtn = repoGroup.createEl('button', {
			text: 'Select repository...',
			cls: 'git-import-repo-btn'
		});
		this.repoBtn.addEventListener('click', () => { void this.selectRepository(); });

		// Branch selector with icon
		const branchGroup = section.createDiv({ cls: 'git-import-filter-group' });
		const branchIcon = branchGroup.createSpan({ cls: 'git-import-branch-icon' });
		setIcon(branchIcon, 'git-branch');
		this.branchSelectEl = branchGroup.createEl('select');
		this.branchSelectEl.disabled = true;
		this.branchSelectEl.addEventListener('change', () => {
			this.filter.branch = this.branchSelectEl?.value || null;
			void this.loadCommits();
		});

		// Date range picker
		const dateGroup = section.createDiv({ cls: 'git-import-filter-group' });
		this.dateInputEl = dateGroup.createEl('input', {
			type: 'date',
			value: this.formatDateForInput(this.filter.sinceDate),
			cls: 'git-import-date-input'
		});
		this.dateInputEl.addEventListener('change', () => {
			this.filter.sinceDate = this.dateInputEl?.value ? new Date(this.dateInputEl.value) : null;
			void this.loadCommits();
		});

		// Period dropdown (in same group as date)
		dateGroup.createEl('span', { text: '–', cls: 'git-import-date-separator' });
		const periodSelect = dateGroup.createEl('select');
		const periods: { value: TimePeriod; label: string }[] = [
			{ value: 'present', label: 'Present' },
			{ value: 'day', label: '+1 day' },
			{ value: 'week', label: '+1 week' },
			{ value: 'month', label: '+1 month' },
			{ value: 'quarter', label: '+3 months' },
			{ value: 'year', label: '+1 year' }
		];
		for (const period of periods) {
			const opt = periodSelect.createEl('option', { text: period.label, value: period.value });
			if (period.value === this.filter.period) opt.selected = true;
		}
		periodSelect.addEventListener('change', () => {
			this.filter.period = periodSelect.value as TimePeriod;
			void this.loadCommits();
		});

		// Preset selector
		const presetGroup = section.createDiv({ cls: 'git-import-filter-group' });
		const presetSelect = presetGroup.createEl('select');
		for (const preset of FILTER_PRESETS) {
			const opt = presetSelect.createEl('option', { text: preset.name, value: preset.name });
			if (preset.name === 'All files') opt.selected = true;
		}
		presetSelect.addEventListener('change', () => {
			const preset = FILTER_PRESETS.find(p => p.name === presetSelect.value);
			if (preset) {
				this.includePattern = preset.include;
				this.excludePattern = preset.exclude;
				if (this.includeInputEl) this.includeInputEl.value = preset.include;
				if (this.excludeInputEl) this.excludeInputEl.value = preset.exclude;
				// Reload commits - some may now be filtered out
				void this.loadCommits();
				this.debouncedSaveSettings();
			}
		});

		// Focus pattern (primary filter - what you care about)
		const focusGroup = section.createDiv({ cls: 'git-import-filter-group git-import-filter-regex' });
		focusGroup.createEl('label', { text: 'Focus on:' });
		this.includeInputEl = focusGroup.createEl('input', {
			type: 'text',
			placeholder: 'e.g. \\.md$',
			value: this.includePattern,
			cls: 'git-import-regex-input'
		});
		this.includeInputEl.addEventListener('change', () => {
			this.includePattern = this.includeInputEl?.value ?? '';
			// Reload commits - some may now be filtered out
			void this.loadCommits();
			this.debouncedSaveSettings();
		});

		// Exclude pattern (secondary - refinement, collapsible)
		const excludeWrapper = section.createDiv({ cls: 'git-import-exclude-wrapper' });

		// Toggle button for exclude section
		const excludeToggle = excludeWrapper.createEl('button', {
			cls: 'git-import-exclude-toggle clickable-icon',
			attr: { 'aria-label': 'Toggle exclude filter' }
		});
		setIcon(excludeToggle, 'chevron-right');

		const excludeGroup = excludeWrapper.createDiv({ cls: 'git-import-filter-group git-import-filter-regex git-import-exclude-content is-collapsed' });
		excludeGroup.createEl('label', { text: 'Also exclude:' });
		this.excludeInputEl = excludeGroup.createEl('input', {
			type: 'text',
			placeholder: 'e.g. \\.lock$',
			value: this.excludePattern,
			cls: 'git-import-regex-input'
		});
		this.excludeInputEl.addEventListener('change', () => {
			this.excludePattern = this.excludeInputEl?.value ?? '';
			// Reload commits - some may now be filtered out
			void this.loadCommits();
			this.debouncedSaveSettings();
		});

		// Toggle collapse behavior
		excludeToggle.addEventListener('click', () => {
			const isCollapsed = excludeGroup.classList.toggle('is-collapsed');
			setIcon(excludeToggle, isCollapsed ? 'chevron-right' : 'chevron-down');
			// If expanded and has a value, highlight it
			if (!isCollapsed && this.excludePattern) {
				excludeToggle.classList.add('has-value');
			}
		});

		// Show indicator if exclude has a value while collapsed
		if (this.excludePattern) {
			excludeToggle.classList.add('has-value');
		}

		// Update indicator when exclude changes
		this.excludeInputEl.addEventListener('input', () => {
			const hasValue = (this.excludeInputEl?.value ?? '').length > 0;
			excludeToggle.classList.toggle('has-value', hasValue);
		});
	}

	private formatDateForInput(date: Date | null): string {
		if (!date) return '';
		return date.toISOString().split('T')[0] ?? '';
	}

	private buildPanels(container: HTMLElement): void {
		const panels = container.createDiv({ cls: 'git-import-panels' });

		// Column 1: Selection (Commits above Files)
		this.selectionPanelEl = panels.createDiv({ cls: 'git-import-panel git-import-panel-selection' });

		// Resize handle for first column
		const resizeHandle = panels.createDiv({ cls: 'git-import-resize-handle' });
		this.setupResizeHandle(resizeHandle, this.selectionPanelEl);

		// Commits section (top half)
		this.commitPanelEl = this.selectionPanelEl.createDiv({ cls: 'git-import-section git-import-section-commits' });
		this.commitPanelEl.createDiv({ cls: 'git-import-panel-header', text: 'Commits' });
		this.commitListEl = this.commitPanelEl.createDiv({ cls: 'git-import-panel-content' });
		this.commitListEl.setAttribute('tabindex', '0');
		this.renderEmptyState(this.commitListEl, 'folder-open', 'Select a repository');

		// Vertical resize handle between commits and files
		const verticalResizeHandle = this.selectionPanelEl.createDiv({ cls: 'git-import-resize-handle-vertical' });
		this.setupVerticalResizeHandle(verticalResizeHandle, this.commitPanelEl);

		// Files section (bottom half)
		this.filePanelEl = this.selectionPanelEl.createDiv({ cls: 'git-import-section git-import-section-files' });
		this.filePanelEl.createDiv({ cls: 'git-import-panel-header', text: 'Files' });
		// Commit message header (shows selected commit's message)
		this.fileCommitMessageEl = this.filePanelEl.createDiv({ cls: 'git-import-commit-header is-hidden' });
		// File list area
		this.fileListEl = this.filePanelEl.createDiv({ cls: 'git-import-panel-content git-import-file-list' });
		this.fileListEl.setAttribute('tabindex', '0');
		this.renderEmptyState(this.fileListEl, 'git-commit', 'Select a commit');
		// Diff preview area at bottom
		this.fileDiffPreviewEl = this.filePanelEl.createDiv({ cls: 'git-import-file-diff is-hidden' });
		this.fileDiffPreviewEl.createDiv({ cls: 'git-import-file-diff-header', text: 'Diff' });
		this.fileDiffPreviewEl.createDiv({ cls: 'git-import-file-diff-content' });

		// Column 2: Preview with tabs
		const previewPanel = panels.createDiv({ cls: 'git-import-panel git-import-panel-preview' });

		// Tabbed header
		const previewHeader = previewPanel.createDiv({ cls: 'git-import-panel-header git-import-preview-header' });
		const tabsEl = previewHeader.createDiv({ cls: 'git-import-preview-tabs' });

		this.slidesTabEl = tabsEl.createEl('button', {
			cls: 'git-import-preview-tab active'
		});
		this.slidesTabEl.createSpan({ text: 'Slides' });
		this.slideCountBadgeEl = this.slidesTabEl.createSpan({ cls: 'git-import-tab-badge', text: '0' });

		this.markdownTabEl = tabsEl.createEl('button', {
			text: 'Markdown',
			cls: 'git-import-preview-tab'
		});

		this.slidesTabEl.addEventListener('click', () => {
			this.switchToSlidesTab();
		});

		this.markdownTabEl.addEventListener('click', () => {
			this.switchToMarkdownTab();
		});

		this.previewEl = previewPanel.createDiv({ cls: 'git-import-panel-content git-import-preview-content' });
		this.previewEl.setAttribute('tabindex', '0');

		// Slides preview (visual)
		this.slidesPreviewEl = this.previewEl.createDiv({ cls: 'git-import-slides-preview' });
		this.renderEmptyState(this.slidesPreviewEl, 'presentation', 'Select commits and files');

		// Markdown preview (raw code)
		this.markdownPreviewEl = this.previewEl.createDiv({ cls: 'git-import-markdown-preview is-hidden' });
		this.renderEmptyState(this.markdownPreviewEl, 'code', 'Select commits and files');

		// Column 3: Render (settings + copy button)
		this.renderPanelEl = panels.createDiv({ cls: 'git-import-panel git-import-panel-render' });

		// Render header with Copy button
		const renderHeader = this.renderPanelEl.createDiv({ cls: 'git-import-panel-header git-import-render-header' });
		renderHeader.createSpan({ text: 'Render' });
		this.importBtn = renderHeader.createEl('button', {
			text: 'Copy',
			cls: 'git-import-copy-btn'
		});
		this.importBtn.disabled = true;
		this.importBtn.addEventListener('click', () => void this.copyToClipboard());

		const renderContent = this.renderPanelEl.createDiv({ cls: 'git-import-panel-content git-import-settings-content' });
		this.buildSettingsPanel(renderContent);
	}

	private buildSettingsPanel(container: HTMLElement): void {
		// Slide organization with visual diagrams
		const orgSetting = container.createDiv({ cls: 'git-import-setting git-import-org-setting' });
		orgSetting.createEl('div', { cls: 'setting-item-name', text: 'Slide organization' });

		const orgOptions = orgSetting.createDiv({ cls: 'git-import-org-options' });

		// Colors = commits (blue = commit A, green = commit B)
		// Shapes = files (circle = file1, square = file2)
		const blue = '#4a9eff';
		const green = '#4ade80';
		const muted = '#888';

		const modes: { value: SlideOrganization; label: string; desc: string; svg: string }[] = [
			{
				value: 'flat',
				label: 'Flat',
				desc: 'Chronological. One slide per file, no grouping.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<circle cx="10" cy="14" r="6" fill="${blue}"/>
					<rect x="22" y="8" width="12" height="12" rx="2" fill="${blue}"/>
					<circle cx="50" cy="14" r="6" fill="${green}"/>
					<rect x="62" y="8" width="12" height="12" rx="2" fill="${green}"/>
					<path d="M17 14h4M35 14h8M57 14h4" stroke="${muted}" stroke-width="1"/>
				</svg>`
			},
			{
				value: 'grouped',
				label: 'Grouped',
				desc: 'Chronological. Files as vertical subslides within each commit.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<circle cx="10" cy="6" r="5" fill="${blue}"/>
					<rect x="5" y="15" width="10" height="10" rx="2" fill="${blue}" opacity="0.6"/>
					<circle cx="50" cy="6" r="5" fill="${green}"/>
					<rect x="45" y="15" width="10" height="10" rx="2" fill="${green}" opacity="0.6"/>
					<path d="M10 12v2M50 12v2" stroke="${muted}" stroke-width="1" stroke-dasharray="2,1"/>
					<path d="M22 6h20M62 6h10" stroke="${muted}" stroke-width="1"/>
				</svg>`
			},
			{
				value: 'progressive',
				label: 'By file',
				desc: 'Grouped by file. Shows each file evolving across commits.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<circle cx="10" cy="14" r="6" fill="${blue}"/>
					<circle cx="28" cy="14" r="6" fill="${green}"/>
					<rect x="42" y="8" width="12" height="12" rx="2" fill="${blue}"/>
					<rect x="62" y="8" width="12" height="12" rx="2" fill="${green}"/>
					<path d="M17 14h4M35 14h6M55 14h6" stroke="${muted}" stroke-width="1"/>
				</svg>`
			},
			{
				value: 'per-hunk',
				label: 'Per hunk',
				desc: 'Chronological. Each diff section becomes a separate slide.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<circle cx="6" cy="14" r="4" fill="${blue}"/>
					<circle cx="18" cy="14" r="4" fill="${blue}"/>
					<rect x="26" y="10" width="8" height="8" rx="1" fill="${blue}"/>
					<circle cx="44" cy="14" r="4" fill="${green}"/>
					<rect x="52" y="10" width="8" height="8" rx="1" fill="${green}"/>
					<rect x="66" y="10" width="8" height="8" rx="1" fill="${green}"/>
				</svg>`
			}
		];

		for (const mode of modes) {
			const option = orgOptions.createDiv({
				cls: `git-import-org-option ${this.formatOptions.slideOrganization === mode.value ? 'is-selected' : ''}`
			});

			// SVG diagram
			const svgContainer = option.createDiv({ cls: 'git-import-org-svg' });
			const parser = new DOMParser();
			const svgDoc = parser.parseFromString(mode.svg, 'image/svg+xml');
			const svgEl = svgDoc.documentElement;
			if (svgEl instanceof SVGElement) {
				svgContainer.appendChild(svgEl);
			}

			// Label and description
			const textContainer = option.createDiv({ cls: 'git-import-org-text' });
			textContainer.createDiv({ cls: 'git-import-org-label', text: mode.label });
			textContainer.createDiv({ cls: 'git-import-org-desc', text: mode.desc });

			option.addEventListener('click', () => {
				orgOptions.querySelectorAll('.git-import-org-option').forEach(el => el.removeClass('is-selected'));
				option.addClass('is-selected');
				this.formatOptions.slideOrganization = mode.value;
				this.debouncedUpdatePreview();
				this.debouncedSaveSettings();
			});
		}

		// Combined code display mode (full file vs diff, highlight style)
		const displaySetting = container.createDiv({ cls: 'git-import-setting git-import-org-setting' });
		displaySetting.createEl('div', { cls: 'setting-item-name', text: 'Code display' });

		const displayOptions = displaySetting.createDiv({ cls: 'git-import-org-options' });

		// Colors for display mode diagrams
		const lineColor = '#888';
		const highlightColor = '#4ade80';
		const stepColor = '#4a9eff';

		const getDisplayModeValue = (): string => {
			if (!this.formatOptions.highlightAddedLines) {
				return this.formatOptions.showFullFile ? 'full-plain' : 'diff-plain';
			}
			if (this.formatOptions.showFullFile) {
				return this.formatOptions.highlightMode === 'stepped' ? 'full-stepped' : 'full-all';
			}
			return this.formatOptions.highlightMode === 'stepped' ? 'diff-stepped' : 'diff-all';
		};

		const displayModes: { value: string; label: string; desc: string; svg: string }[] = [
			{
				value: 'diff-plain',
				label: 'Changes only',
				desc: 'Show only the changed lines, no highlighting.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<rect x="4" y="4" width="32" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="10" width="28" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="16" width="36" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="22" width="24" height="3" rx="1" fill="${lineColor}"/>
				</svg>`
			},
			{
				value: 'diff-all',
				label: 'Highlight new',
				desc: 'Show changed lines with new lines highlighted.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<rect x="4" y="4" width="32" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="10" width="28" height="3" rx="1" fill="${highlightColor}"/>
					<rect x="4" y="16" width="36" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="22" width="24" height="3" rx="1" fill="${highlightColor}"/>
				</svg>`
			},
			{
				value: 'diff-stepped',
				label: 'Stepped reveal',
				desc: 'Changed lines with new lines revealed one by one.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<rect x="4" y="4" width="32" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="10" width="28" height="3" rx="1" fill="${highlightColor}"/>
					<circle cx="72" cy="11.5" r="5" fill="${stepColor}"/>
					<text x="72" y="14" text-anchor="middle" fill="white" font-size="8" font-weight="bold">1</text>
					<rect x="4" y="16" width="36" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="22" width="24" height="3" rx="1" fill="${highlightColor}"/>
					<circle cx="72" cy="23.5" r="5" fill="${stepColor}"/>
					<text x="72" y="26" text-anchor="middle" fill="white" font-size="8" font-weight="bold">2</text>
				</svg>`
			},
			{
				value: 'full-plain',
				label: 'Full file',
				desc: 'Show complete file content, no highlighting.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<rect x="4" y="2" width="20" height="2" rx="1" fill="${lineColor}" opacity="0.4"/>
					<rect x="4" y="6" width="32" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="11" width="28" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="16" width="36" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="21" width="24" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="26" width="18" height="2" rx="1" fill="${lineColor}" opacity="0.4"/>
				</svg>`
			},
			{
				value: 'full-all',
				label: 'Full + highlight',
				desc: 'Complete file with new lines highlighted.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<rect x="4" y="2" width="20" height="2" rx="1" fill="${lineColor}" opacity="0.4"/>
					<rect x="4" y="6" width="32" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="11" width="28" height="3" rx="1" fill="${highlightColor}"/>
					<rect x="4" y="16" width="36" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="21" width="24" height="3" rx="1" fill="${highlightColor}"/>
					<rect x="4" y="26" width="18" height="2" rx="1" fill="${lineColor}" opacity="0.4"/>
				</svg>`
			},
			{
				value: 'full-stepped',
				label: 'Full + stepped',
				desc: 'Complete file with new lines revealed one by one.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<rect x="4" y="2" width="20" height="2" rx="1" fill="${lineColor}" opacity="0.4"/>
					<rect x="4" y="6" width="32" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="11" width="28" height="3" rx="1" fill="${highlightColor}"/>
					<circle cx="72" cy="12.5" r="5" fill="${stepColor}"/>
					<text x="72" y="15" text-anchor="middle" fill="white" font-size="8" font-weight="bold">1</text>
					<rect x="4" y="16" width="36" height="3" rx="1" fill="${lineColor}"/>
					<rect x="4" y="21" width="24" height="3" rx="1" fill="${highlightColor}"/>
					<circle cx="72" cy="22.5" r="5" fill="${stepColor}"/>
					<text x="72" y="25" text-anchor="middle" fill="white" font-size="8" font-weight="bold">2</text>
					<rect x="4" y="26" width="18" height="2" rx="1" fill="${lineColor}" opacity="0.4"/>
				</svg>`
			}
		];

		const currentDisplayMode = getDisplayModeValue();

		for (const mode of displayModes) {
			const option = displayOptions.createDiv({
				cls: `git-import-org-option ${currentDisplayMode === mode.value ? 'is-selected' : ''}`
			});

			// SVG diagram
			const svgContainer = option.createDiv({ cls: 'git-import-org-svg' });
			const parser = new DOMParser();
			const svgDoc = parser.parseFromString(mode.svg, 'image/svg+xml');
			const svgEl = svgDoc.documentElement;
			if (svgEl instanceof SVGElement) {
				svgContainer.appendChild(svgEl);
			}

			// Label and description
			const textContainer = option.createDiv({ cls: 'git-import-org-text' });
			textContainer.createDiv({ cls: 'git-import-org-label', text: mode.label });
			textContainer.createDiv({ cls: 'git-import-org-desc', text: mode.desc });

			option.addEventListener('click', () => {
				displayOptions.querySelectorAll('.git-import-org-option').forEach(el => el.removeClass('is-selected'));
				option.addClass('is-selected');
				this.formatOptions.showFullFile = mode.value.startsWith('full-');
				this.formatOptions.highlightAddedLines = !mode.value.endsWith('-plain');
				this.formatOptions.highlightMode = mode.value.endsWith('-stepped') ? 'stepped' : 'all';
				this.previewCache.clear();
				this.debouncedUpdatePreview();
				this.debouncedSaveSettings();
			});
		}

		// Line change display setting
		const lineChangeSetting = container.createDiv({ cls: 'git-import-setting git-import-org-setting' });
		lineChangeSetting.createEl('div', { cls: 'setting-item-name', text: 'Line changes' });

		const lineChangeOptions = lineChangeSetting.createDiv({ cls: 'git-import-org-options' });

		// Colors for line change diagrams
		const addColor = '#4ade80';
		const removeColor = '#f87171';

		const lineChangeModes: { value: string; label: string; desc: string; svg: string }[] = [
			{
				value: 'additions-only',
				label: 'Additions only',
				desc: 'Show only new lines. Removed lines are hidden.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<text x="4" y="9" fill="${addColor}" font-size="10" font-weight="bold">+</text>
					<rect x="14" y="4" width="28" height="3" rx="1" fill="${addColor}"/>
					<text x="4" y="17" fill="${addColor}" font-size="10" font-weight="bold">+</text>
					<rect x="14" y="12" width="32" height="3" rx="1" fill="${addColor}"/>
					<text x="4" y="25" fill="${addColor}" font-size="10" font-weight="bold">+</text>
					<rect x="14" y="20" width="24" height="3" rx="1" fill="${addColor}"/>
				</svg>`
			},
			{
				value: 'full-diff',
				label: 'Full diff',
				desc: 'Show both additions and deletions with +/- markers.',
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
					<text x="4" y="9" fill="${removeColor}" font-size="10" font-weight="bold">−</text>
					<rect x="14" y="4" width="28" height="3" rx="1" fill="${removeColor}"/>
					<text x="4" y="17" fill="${addColor}" font-size="10" font-weight="bold">+</text>
					<rect x="14" y="12" width="32" height="3" rx="1" fill="${addColor}"/>
					<text x="4" y="25" fill="${addColor}" font-size="10" font-weight="bold">+</text>
					<rect x="14" y="20" width="24" height="3" rx="1" fill="${addColor}"/>
				</svg>`
			}
		];

		for (const mode of lineChangeModes) {
			const option = lineChangeOptions.createDiv({
				cls: `git-import-org-option ${this.formatOptions.lineChangeDisplay === mode.value ? 'is-selected' : ''}`
			});

			// SVG diagram
			const svgContainer = option.createDiv({ cls: 'git-import-org-svg' });
			const parser = new DOMParser();
			const svgDoc = parser.parseFromString(mode.svg, 'image/svg+xml');
			const svgEl = svgDoc.documentElement;
			if (svgEl instanceof SVGElement) {
				svgContainer.appendChild(svgEl);
			}

			// Label and description
			const textContainer = option.createDiv({ cls: 'git-import-org-text' });
			textContainer.createDiv({ cls: 'git-import-org-label', text: mode.label });
			textContainer.createDiv({ cls: 'git-import-org-desc', text: mode.desc });

			option.addEventListener('click', () => {
				lineChangeOptions.querySelectorAll('.git-import-org-option').forEach(el => el.removeClass('is-selected'));
				option.addClass('is-selected');
				this.formatOptions.lineChangeDisplay = mode.value as 'additions-only' | 'full-diff';
				this.previewCache.clear();
				this.debouncedUpdatePreview();
				this.debouncedSaveSettings();
			});
		}

		// Context lines
		const contextSetting = container.createDiv({ cls: 'git-import-setting' });
		new Setting(contextSetting)
			.setName('Context lines')
			.setDesc('Unchanged lines to show around each change.')
			.addSlider(slider => slider
				.setLimits(0, 10, 1)
				.setValue(this.formatOptions.contextLines)
				.setDynamicTooltip()
				.onChange(value => {
					this.formatOptions.contextLines = value;
					this.previewCache.clear();
					this.debouncedUpdatePreview();
					this.debouncedSaveSettings();
				}));

		// Templates section header
		container.createEl('h4', { text: 'Templates', cls: 'git-import-section-header' });

		// Commit details template
		const commitDetailsTemplateEl = container.createDiv({ cls: 'git-import-setting git-import-template-setting' });
		const commitDetailsVars = ['authorName', 'authorEmail', 'commitDate', 'messageTitle', 'messageBody', 'commitHash', 'commitHashShort'];
		let commitDetailsTextarea: HTMLTextAreaElement | null = null;

		new Setting(commitDetailsTemplateEl)
			.setName('Commit details')
			.addTextArea(text => {
				commitDetailsTextarea = text.inputEl;
				text.setValue(this.formatOptions.commitDetailsTemplate)
					.onChange(value => {
						this.formatOptions.commitDetailsTemplate = value;
						this.debouncedUpdatePreview();
						this.debouncedSaveSettings();
					});
			});

		// Add clickable variables
		this.renderClickableVariables(commitDetailsTemplateEl, commitDetailsVars, () => commitDetailsTextarea);

		// Add reset button for commit details template
		const commitDetailsResetBtn = commitDetailsTemplateEl.createEl('button', {
			text: 'Reset to default',
			cls: 'git-import-reset-btn'
		});
		commitDetailsResetBtn.addEventListener('click', () => {
			this.formatOptions.commitDetailsTemplate = DEFAULT_COMMIT_DETAILS_TEMPLATE;
			if (commitDetailsTextarea) commitDetailsTextarea.value = DEFAULT_COMMIT_DETAILS_TEMPLATE;
			this.debouncedUpdatePreview();
		});

		// Slide template
		const slideTemplateEl = container.createDiv({ cls: 'git-import-setting git-import-template-setting' });
		const slideVars = ['fileName', 'filePath', 'fileSummary', 'code', 'commitDetails', ...commitDetailsVars];
		let slideTextarea: HTMLTextAreaElement | null = null;

		new Setting(slideTemplateEl)
			.setName('Slide template')
			.addTextArea(text => {
				slideTextarea = text.inputEl;
				text.setValue(this.formatOptions.slideTemplate)
					.onChange(value => {
						this.formatOptions.slideTemplate = value;
						this.debouncedUpdatePreview();
						this.debouncedSaveSettings();
					});
			});

		// Add clickable variables
		this.renderClickableVariables(slideTemplateEl, slideVars, () => slideTextarea);

		// Add reset button for slide template
		const slideResetBtn = slideTemplateEl.createEl('button', {
			text: 'Reset to default',
			cls: 'git-import-reset-btn'
		});
		slideResetBtn.addEventListener('click', () => {
			this.formatOptions.slideTemplate = DEFAULT_SLIDE_TEMPLATE;
			if (slideTextarea) slideTextarea.value = DEFAULT_SLIDE_TEMPLATE;
			this.debouncedUpdatePreview();
		});

		// Date format
		const dateFormatEl = container.createDiv({ cls: 'git-import-setting' });
		new Setting(dateFormatEl)
			.setName('Date format')
			.setDesc('Date formatting pattern.')
			.addText(text => text
				.setValue(this.formatOptions.dateFormat)
				.onChange(value => {
					this.formatOptions.dateFormat = value;
					this.debouncedSaveSettings();
					this.debouncedUpdatePreview();
				}));
	}

	private async selectRepository(): Promise<void> {
		try {
			const electron = window.require?.('electron') as {
				remote?: {
					dialog: {
						showOpenDialog: (options: {
							properties: string[];
							title: string;
						}) => Promise<{ canceled: boolean; filePaths: string[] }>;
					};
				};
			} | undefined;

			const dialog = electron?.remote?.dialog;
			if (!dialog) {
				new Notice('Folder picker not available. Please use the desktop app.');
				return;
			}

			const result = await dialog.showOpenDialog({
				properties: ['openDirectory'],
				title: 'Select Git repository'
			});

			if (!result.canceled && result.filePaths.length > 0) {
				const selectedPath = result.filePaths[0];
				if (selectedPath) {
					await this.openRepository(selectedPath);
				}
			}
		} catch (error) {
			new Notice('Failed to open folder picker. Please ensure you are running the desktop app.');
			console.error('Folder picker error:', error);
		}
	}

	private async openRepository(path: string): Promise<void> {
		this.repoPath = path;
		this.gitService = new GitService(path);

		const isValid = await this.gitService.isValidRepo();
		if (!isValid) {
			new Notice('Selected folder is not a valid Git repository');
			this.repoPath = null;
			this.gitService = null;
			return;
		}

		// Update tab title with repo name
		const segments = path.split(/[/\\]/);
		this.repoName = segments[segments.length - 1] || 'Git Import';
		// Trigger Obsidian to refresh the tab header
		(this.leaf as { updateHeader?: () => void }).updateHeader?.();

		if (this.repoBtn) {
			// Show last part of path in button
			this.repoBtn.setText(this.repoName);
			this.repoBtn.setAttribute('title', path); // Full path on hover
			this.repoBtn.addClass('has-repo');
		}

		// Reset all state for new repository
		this.previewCache.clear();
		this.commits = [];
		this.selectedCommit = null;
		this.selectedCommitHashes.clear();
		this.selectedFiles.clear();
		this.currentFiles = [];
		this.selectedFile = null;
		this.focusedCommitIndex = 0;
		this.focusedFileIndex = 0;
		this.focusedColumn = 'commits';

		// Clear UI panels
		if (this.fileListEl) {
			this.renderEmptyState(this.fileListEl, 'git-commit', 'Select a commit');
		}
		if (this.fileCommitMessageEl) {
			this.fileCommitMessageEl.empty();
			this.fileCommitMessageEl.addClass('is-hidden');
		}
		this.hideDiffPreview();
		if (this.slidesPreviewEl) {
			this.renderEmptyState(this.slidesPreviewEl, 'presentation', 'Select commits and files');
		}
		if (this.markdownPreviewEl) {
			this.renderEmptyState(this.markdownPreviewEl, 'code', 'Select commits and files');
		}
		this.updateImportButton();

		// Set date to 3 months before the latest commit
		await this.setDateFromLatestCommit();

		await this.loadBranches();
		await this.loadCommits();
	}

	private async setDateFromLatestCommit(): Promise<void> {
		if (!this.gitService) return;

		const latestDate = await this.gitService.getLatestCommitDate();
		if (latestDate) {
			// Set to 3 months before the latest commit
			const sinceDate = new Date(latestDate);
			sinceDate.setMonth(sinceDate.getMonth() - 3);
			this.filter.sinceDate = sinceDate;

			// Update the date input field
			if (this.dateInputEl) {
				this.dateInputEl.value = this.formatDateForInput(sinceDate);
			}
		}
	}

	private async loadBranches(): Promise<void> {
		if (!this.gitService || !this.branchSelectEl) return;

		try {
			this.branches = await this.gitService.getLocalBranches();

			// Prefer main/master, fall back to current branch
			const defaultBranch = this.branches.find(b => b === 'main')
				?? this.branches.find(b => b === 'master')
				?? await this.gitService.getCurrentBranch();

			this.branchSelectEl.empty();

			const allOption = this.branchSelectEl.createEl('option', {
				text: '(all branches)',
				value: ''
			});
			if (!this.filter.branch && !defaultBranch) {
				allOption.selected = true;
			}

			for (const branch of this.branches) {
				const option = this.branchSelectEl.createEl('option', {
					text: branch,
					value: branch
				});
				if (branch === defaultBranch && !this.filter.branch) {
					option.selected = true;
					this.filter.branch = branch;
				}
			}

			this.branchSelectEl.disabled = false;
		} catch (error) {
			console.error('Failed to load branches:', error);
			new Notice('Failed to load branches');
		}
	}

	private async loadCommits(): Promise<void> {
		if (!this.gitService || !this.commitListEl) return;

		this.commitListEl.empty();
		this.commitListEl.setText('Loading commits...');
		this.previewCache.clear();

		try {
			let allCommits = await this.gitService.getCommits(this.filter);

			// Filter commits based on file patterns - only show commits with matching files
			if (this.includePattern || this.excludePattern) {
				const filteredCommits: GitCommit[] = [];
				for (const commit of allCommits) {
					const files = await this.gitService.getCommitFiles(commit.hash);
					const hasMatchingFiles = this.filesMatchFilter(files);
					if (hasMatchingFiles) {
						filteredCommits.push(commit);
					}
				}
				allCommits = filteredCommits;
			}

			this.commits = allCommits;
			this.commitListEl.empty();

			if (this.commits.length === 0) {
				this.renderEmptyState(this.commitListEl, 'filter-x', 'No commits match filters');
				return;
			}

			// Reset focus
			this.focusedCommitIndex = 0;
			this.focusedColumn = 'commits';

			for (let i = 0; i < this.commits.length; i++) {
				const commit = this.commits[i]!;
				const commitEl = this.commitListEl.createDiv({ cls: 'git-import-commit' });
				if (i === 0) commitEl.addClass('keyboard-focus');

				// Mark commits that have files selected
				const hasSelectedFiles = (this.selectedFiles.get(commit.hash)?.size ?? 0) > 0;
				if (hasSelectedFiles) commitEl.addClass('has-selections');

				const infoEl = commitEl.createDiv({ cls: 'git-import-commit-info' });
				commitEl.dataset.hash = commit.hash;
				infoEl.addEventListener('click', () => {
					this.focusedCommitIndex = i;
					this.focusedColumn = 'commits';
					this.updateFocusHighlight();
					void this.selectCommit(commit);
				});

				const msgEl = infoEl.createSpan({ cls: 'git-import-commit-message' });
				msgEl.setText(commit.message);

				const dateEl = infoEl.createSpan({ cls: 'git-import-commit-date' });
				dateEl.setText(this.formatDate(commit.date));
			}

			this.debouncedUpdatePreview();
		} catch (error) {
			console.error('Failed to load commits:', error);
			this.commitListEl.empty();
			this.commitListEl.setText('Failed to load commits');
		}
	}

	private async selectCommit(commit: GitCommit): Promise<void> {
		this.selectedCommit = commit;

		const commitEls = this.commitListEl?.querySelectorAll('.git-import-commit');
		commitEls?.forEach(el => el.removeClass('selected'));

		const selectedEl = Array.from(commitEls ?? []).find(el => {
			return (el as HTMLElement).dataset.hash === commit.hash;
		});
		selectedEl?.addClass('selected');

		// Update commit message header
		if (this.fileCommitMessageEl) {
			this.fileCommitMessageEl.empty();
			this.fileCommitMessageEl.removeClass('is-hidden');

			// Top row: hash and date
			const topRow = this.fileCommitMessageEl.createDiv({ cls: 'git-import-header-row' });
			const hashEl = topRow.createSpan({ cls: 'git-import-header-hash' });
			hashEl.setText(commit.hashShort);
			const dateEl = topRow.createSpan({ cls: 'git-import-header-date' });
			dateEl.setText(this.formatDate(commit.date));

			// Message (can wrap to multiple lines)
			const msgEl = this.fileCommitMessageEl.createDiv({ cls: 'git-import-header-message' });
			msgEl.setText(commit.message);
		}

		await this.loadFilesForCommit(commit);
	}

	/**
	 * Check if any files in the list match the current include/exclude filters
	 */
	private filesMatchFilter(files: GitFileChange[]): boolean {
		return this.filterFiles(files).length > 0;
	}

	/**
	 * Apply include/exclude filters to a list of files
	 */
	private filterFiles(files: GitFileChange[]): GitFileChange[] {
		let result = files;

		if (this.includePattern) {
			try {
				const includeRegex = new RegExp(this.includePattern);
				result = result.filter(f => includeRegex.test(f.path));
			} catch {
				// Invalid regex, ignore
			}
		}

		if (this.excludePattern) {
			try {
				const excludeRegex = new RegExp(this.excludePattern);
				result = result.filter(f => !excludeRegex.test(f.path));
			} catch {
				// Invalid regex, ignore
			}
		}

		return result;
	}

	private async loadFilesForCommit(commit: GitCommit): Promise<void> {
		if (!this.gitService || !this.fileListEl) return;

		this.fileListEl.empty();
		this.fileListEl.setText('Loading files...');

		try {
			const allFiles = await this.gitService.getCommitFilesWithStats(commit.hash);
			this.currentFiles = this.filterFiles(allFiles);

			this.fileListEl.empty();

			if (this.currentFiles.length === 0) {
				this.fileListEl.setText('No files match the filter');
				return;
			}

			// Reset file focus
			this.focusedFileIndex = 0;

			if (!this.selectedFiles.has(commit.hash)) {
				this.selectedFiles.set(commit.hash, new Set());
			}
			const selectedForCommit = this.selectedFiles.get(commit.hash)!;

			for (let i = 0; i < this.currentFiles.length; i++) {
				const file = this.currentFiles[i]!;
				const fileEl = this.fileListEl.createDiv({ cls: 'git-import-file' });

				const checkbox = fileEl.createEl('input', { type: 'checkbox' });
				checkbox.tabIndex = -1; // Prevent checkbox from stealing focus
				checkbox.checked = selectedForCommit.has(file.path);
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) {
						selectedForCommit.add(file.path);
						this.selectedCommitHashes.add(commit.hash);
					} else {
						selectedForCommit.delete(file.path);
					}
					this.updateCommitHasSelections(commit.hash);
					this.updateImportButton();
					this.debouncedUpdatePreview();
				});

				const statusInfo = FILE_STATUS_ICONS[file.status];
				const statusEl = fileEl.createSpan({
					cls: `git-import-file-status ${statusInfo.cls}`,
					text: statusInfo.icon,
					title: statusInfo.title
				});
				statusEl.setAttribute('aria-label', statusInfo.title);

				const pathEl = fileEl.createSpan({ cls: 'git-import-file-path' });
				pathEl.setText(file.path);

				const statsEl = fileEl.createSpan({ cls: 'git-import-file-stats' });
				if (file.additions > 0) {
					statsEl.createSpan({ cls: 'additions', text: `+${file.additions}` });
				}
				if (file.deletions > 0) {
					statsEl.createSpan({ cls: 'deletions', text: `-${file.deletions}` });
				}

				// Click handler to show diff preview
				fileEl.addEventListener('click', (e) => {
					// Don't trigger when clicking checkbox
					if ((e.target as HTMLElement).tagName === 'INPUT') return;

					// Update focus state
					this.focusedFileIndex = i;
					this.focusedColumn = 'files';
					this.updateFocusHighlight();

					// Select file and show diff
					this.selectFileAtIndex(i);
				});
			}

			// Clear diff preview when loading new file list
			this.selectedFile = null;
			this.hideDiffPreview();
		} catch (error) {
			console.error('Failed to load files:', error);
			this.fileListEl.empty();
			this.fileListEl.setText('Failed to load files');
		}
	}

	private async showFileDiff(commitHash: string, file: GitFileChange): Promise<void> {
		if (!this.gitService || !this.fileDiffPreviewEl) return;

		const contentEl = this.fileDiffPreviewEl.querySelector('.git-import-file-diff-content');
		const headerEl = this.fileDiffPreviewEl.querySelector('.git-import-file-diff-header');
		if (!contentEl || !headerEl) return;

		// Show the diff panel
		this.fileDiffPreviewEl.removeClass('is-hidden');

		// Update header with file name
		headerEl.setText(file.path.split('/').pop() ?? file.path);

		// Show loading state
		contentEl.empty();
		contentEl.setText('Loading diff...');

		try {
			const diffOutput = await this.gitService.getFileDiff(commitHash, file.path, 3);

			contentEl.empty();

			if (!diffOutput.trim()) {
				contentEl.setText('No diff available');
				return;
			}

			// Render diff with syntax highlighting (skip header/meta lines)
			const preEl = contentEl.createEl('pre');
			const lines = diffOutput.split('\n');
			const lineChangeDisplay = this.formatOptions.lineChangeDisplay;

			for (const line of lines) {
				// Skip diff header lines (diff, index, ---, +++, @@)
				if (line.startsWith('diff ') || line.startsWith('index ') ||
					line.startsWith('---') || line.startsWith('+++') ||
					line.startsWith('@@')) {
					continue;
				}

				// Handle removed lines based on display mode
				if (line.startsWith('-')) {
					if (lineChangeDisplay === 'additions-only') {
						continue; // Skip removed lines entirely
					}
				}

				const lineEl = preEl.createEl('div', { cls: 'diff-line' });

				if (line.startsWith('+')) {
					lineEl.addClass('diff-added');
				} else if (line.startsWith('-')) {
					lineEl.addClass('diff-removed');
				}

				lineEl.setText(line || ' ');
			}
		} catch (error) {
			console.error('Failed to load diff:', error);
			contentEl.empty();
			contentEl.setText('Failed to load diff');
		}
	}

	private hideDiffPreview(): void {
		if (this.fileDiffPreviewEl) {
			this.fileDiffPreviewEl.addClass('is-hidden');
			const contentEl = this.fileDiffPreviewEl.querySelector('.git-import-file-diff-content');
			if (contentEl) contentEl.empty();
		}
	}

	private updateCommitHasSelections(hash: string): void {
		const commitEls = this.commitListEl?.querySelectorAll('.git-import-commit');
		for (const el of Array.from(commitEls ?? [])) {
			if ((el as HTMLElement).dataset.hash === hash) {
				const hasFiles = (this.selectedFiles.get(hash)?.size ?? 0) > 0;
				el.classList.toggle('has-selections', hasFiles);
				break;
			}
		}
	}

	private updateImportButton(): void {
		if (!this.importBtn) return;

		let hasSelection = false;
		for (const [hash, files] of this.selectedFiles) {
			if (this.selectedCommitHashes.has(hash) && files.size > 0) {
				hasSelection = true;
				break;
			}
		}

		this.importBtn.disabled = !hasSelection;
	}

	private async generatePreview(): Promise<void> {
		if (!this.previewEl || !this.gitService || !this.slidesPreviewEl || !this.markdownPreviewEl) return;

		const selectedCommits = this.commits.filter(c => this.selectedCommitHashes.has(c.hash));

		let hasFiles = false;
		for (const commit of selectedCommits) {
			const files = this.selectedFiles.get(commit.hash);
			if (files && files.size > 0) {
				hasFiles = true;
				break;
			}
		}

		if (selectedCommits.length === 0 || !hasFiles) {
			this.renderEmptyState(this.slidesPreviewEl, 'presentation', 'Select commits and files');
			this.renderEmptyState(this.markdownPreviewEl, 'code', 'Select commits and files');
			this.updateSlideCountBadge(0);
			return;
		}

		if (this.isGeneratingPreview) return;
		this.isGeneratingPreview = true;

		this.slidesPreviewEl.empty();
		this.slidesPreviewEl.setText('Generating preview...');
		this.markdownPreviewEl.empty();
		this.markdownPreviewEl.setText('Generating preview...');

		try {
			const fileDiffs = new Map<string, GitFileDiff[]>();

			for (const commit of selectedCommits) {
				const files = this.selectedFiles.get(commit.hash);
				if (!files || files.size === 0) continue;

				const cacheKey = `${commit.hash}-${this.formatOptions.contextLines}-${this.formatOptions.showFullFile}`;
				let cachedDiffs = this.previewCache.get(cacheKey);

				if (!cachedDiffs) {
					cachedDiffs = [];
					this.previewCache.set(cacheKey, cachedDiffs);
				}

				// Collect diffs for selected files, fetching any that aren't cached
				const diffs: GitFileDiff[] = [];

				for (const filePath of files) {
					// Check if this file is already in cache
					let diff = cachedDiffs.find(d => d.path === filePath);

					if (!diff) {
						// Fetch and add to cache
						const diffOutput = await this.gitService.getFileDiff(
							commit.hash,
							filePath,
							this.formatOptions.contextLines
						);

						let content: string | null = null;
						if (this.formatOptions.showFullFile) {
							content = await this.gitService.getFileContent(commit.hash, filePath);
						}

						diff = {
							path: filePath,
							hunks: parseDiffHunks(diffOutput),
							newContent: content,
							language: detectLanguage(filePath)
						};

						cachedDiffs.push(diff);
					}

					diffs.push(diff);
				}

				fileDiffs.set(commit.hash, diffs);
			}

			const generator = new SlideGenerator(this.formatOptions);
			const markdown = generator.generateSlides(selectedCommits, fileDiffs);

			// Update markdown preview
			this.markdownPreviewEl.empty();
			const preEl = this.markdownPreviewEl.createEl('pre');
			const codeEl = preEl.createEl('code');
			codeEl.setText(markdown);

			// Update slides preview
			this.renderSlidesPreview(markdown);

		} catch (error) {
			console.error('Preview generation failed:', error);
			this.slidesPreviewEl.empty();
			this.slidesPreviewEl.setText('Failed to generate preview');
			this.markdownPreviewEl.empty();
			this.markdownPreviewEl.setText('Failed to generate preview');
		} finally {
			this.isGeneratingPreview = false;
		}
	}

	private renderSlidesPreview(markdown: string): void {
		if (!this.slidesPreviewEl) return;

		this.slidesPreviewEl.empty();

		// Parse markdown into slides (split by --- separator)
		const slideContents = markdown.split(/\n---\n/);

		// Create slide container
		const slidesContainer = this.slidesPreviewEl.createDiv({ cls: 'slides-preview-container' });

		let slideNumber = 0;
		for (const slideContent of slideContents) {
			const trimmedContent = slideContent.trim();
			if (!trimmedContent) continue;

			// Check for vertical slides (split by --)
			const verticalSlides = trimmedContent.split(/\n--\n/);

			if (verticalSlides.length > 1) {
				// Has vertical slides - create a group
				const groupEl = slidesContainer.createDiv({ cls: 'slide-group' });

				for (let i = 0; i < verticalSlides.length; i++) {
					const vsContent = verticalSlides[i]?.trim();
					if (!vsContent) continue;

					slideNumber++;
					const slideEl = groupEl.createDiv({ cls: 'slide-preview' });
					if (i > 0) slideEl.addClass('vertical-slide');

					this.renderSlideContent(slideEl, vsContent, slideNumber);
				}
			} else {
				// Single horizontal slide
				slideNumber++;
				const slideEl = slidesContainer.createDiv({ cls: 'slide-preview' });
				this.renderSlideContent(slideEl, trimmedContent, slideNumber);
			}
		}

		// Update slide count badge
		this.updateSlideCountBadge(slideNumber);
	}

	private updateSlideCountBadge(count: number): void {
		if (this.slideCountBadgeEl) {
			this.slideCountBadgeEl.setText(String(count));
		}
	}

	private renderSlideContent(slideEl: HTMLElement, content: string, slideNumber: number): void {
		// Slide number badge
		slideEl.createDiv({ cls: 'slide-number', text: String(slideNumber) });

		// Content area
		const contentEl = slideEl.createDiv({ cls: 'slide-content' });

		// Parse the markdown content
		const lines = content.split('\n');
		let inCodeBlock = false;
		let codeBlockFenceLength = 0; // Track the fence length to match closing
		let codeBlockLang = '';
		let codeBlockHighlights = '';
		let codeLines: string[] = [];

		for (const line of lines) {
			// Check for code block start/end (handles variable-length fences like ``` or ````)
			const fenceMatch = line.match(/^(`{3,})/);
			const fenceLength = fenceMatch?.[1]?.length ?? 0;

			if (fenceLength > 0) {
				if (!inCodeBlock) {
					// Starting a code block - track fence length
					inCodeBlock = true;
					codeBlockFenceLength = fenceLength;
					// Extract language and highlight annotation (like ```ts [1-2|3-4])
					const match = line.match(/^`{3,}(\w*)\s*(?:\[([^\]]*)\])?/);
					codeBlockLang = match?.[1] ?? '';
					codeBlockHighlights = match?.[2] ?? '';
					codeLines = [];
				} else if (fenceLength >= codeBlockFenceLength && line.trim() === '`'.repeat(fenceLength)) {
					// Ending a code block - fence must be at least as long and be only backticks
					inCodeBlock = false;
					codeBlockFenceLength = 0;

					// Parse highlight groups
					const highlightGroups = this.parseHighlightGroups(codeBlockHighlights);

					// Render the code block with syntax highlighting
					const codeContainer = contentEl.createDiv({ cls: 'slide-code-block' });
					if (codeBlockLang) {
						codeContainer.createDiv({
							cls: 'slide-code-lang',
							text: codeBlockLang
						});
					}
					const preEl = codeContainer.createEl('pre');
					const codeEl = preEl.createEl('code');
					this.renderHighlightedCode(codeEl, codeLines.join('\n'), codeBlockLang, highlightGroups);
				} else {
					// Inside code block, this is content (nested fence with different length)
					codeLines.push(line);
				}
				continue;
			}

			if (inCodeBlock) {
				codeLines.push(line);
				continue;
			}

			// Parse regular markdown
			if (line.startsWith('## ')) {
				// H2 heading - slide title
				contentEl.createEl('h2', {
					cls: 'slide-title',
					text: line.substring(3).trim()
				});
			} else if (line.startsWith('### ')) {
				// H3 heading - subtitle
				contentEl.createEl('h3', {
					cls: 'slide-subtitle',
					text: line.substring(4).trim()
				});
			} else if (line.startsWith('#### ')) {
				// H4 heading
				contentEl.createEl('h4', {
					cls: 'slide-h4',
					text: line.substring(5).trim()
				});
			} else if (line.startsWith('> ')) {
				// Blockquote - often used for commit messages
				contentEl.createEl('blockquote', {
					cls: 'slide-quote',
					text: line.substring(2).trim()
				});
			} else if (line.startsWith('- ') || line.startsWith('* ')) {
				// List item
				contentEl.createEl('div', {
					cls: 'slide-list-item',
					text: '• ' + line.substring(2).trim()
				});
			} else if (line.startsWith('_') && line.endsWith('_') && line.length > 2) {
				// Italic text (file summary, etc.)
				contentEl.createEl('em', {
					cls: 'slide-meta',
					text: line.slice(1, -1)
				});
			} else if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
				// Bold text
				contentEl.createEl('strong', {
					cls: 'slide-bold',
					text: line.slice(2, -2)
				});
			} else if (line.trim()) {
				// Regular text
				contentEl.createEl('p', {
					cls: 'slide-text',
					text: line.trim()
				});
			}
		}
	}

	/**
	 * Parse highlight groups from annotation like "1-3|5-7" or "1,3,5|7-9"
	 * Returns an array where each element is a Set of line numbers for that step
	 */
	private parseHighlightGroups(annotation: string): Set<number>[] {
		if (!annotation.trim()) return [];

		const groups: Set<number>[] = [];
		// Split by | for stepped highlights
		const steps = annotation.split('|');

		for (const step of steps) {
			const lineNumbers = new Set<number>();
			// Split by comma for multiple ranges in one step
			const parts = step.split(',');

			for (const part of parts) {
				const trimmed = part.trim();
				if (trimmed.includes('-')) {
					// Range like "1-3"
					const [startStr, endStr] = trimmed.split('-');
					const start = parseInt(startStr ?? '', 10);
					const end = parseInt(endStr ?? '', 10);
					if (!isNaN(start) && !isNaN(end)) {
						for (let i = start; i <= end; i++) {
							lineNumbers.add(i);
						}
					}
				} else {
					// Single line number
					const num = parseInt(trimmed, 10);
					if (!isNaN(num)) {
						lineNumbers.add(num);
					}
				}
			}

			if (lineNumbers.size > 0) {
				groups.push(lineNumbers);
			}
		}

		return groups;
	}

	/**
	 * Render code with syntax highlighting and line highlight indicators
	 */
	private renderHighlightedCode(
		container: HTMLElement,
		code: string,
		language: string,
		highlightGroups: Set<number>[] = []
	): void {
		const lines = code.split('\n');

		// Build a map of line number -> step numbers (1-indexed)
		const lineToSteps = new Map<number, number[]>();
		for (let stepIdx = 0; stepIdx < highlightGroups.length; stepIdx++) {
			const group = highlightGroups[stepIdx];
			if (!group) continue;
			for (const lineNum of group) {
				if (!lineToSteps.has(lineNum)) {
					lineToSteps.set(lineNum, []);
				}
				lineToSteps.get(lineNum)!.push(stepIdx + 1);
			}
		}

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? '';
			const lineNum = i + 1;
			const steps = lineToSteps.get(lineNum);
			const isHighlighted = steps && steps.length > 0;

			const lineEl = container.createDiv({
				cls: isHighlighted ? 'code-line highlighted' : 'code-line'
			});

			// Add step indicator badges if this line is highlighted
			if (steps && steps.length > 0) {
				const badgeContainer = lineEl.createDiv({ cls: 'line-step-badges' });
				for (const step of steps) {
					badgeContainer.createSpan({
						cls: 'line-step-badge',
						text: String(step)
					});
				}
			}

			// Line content wrapper
			const lineContent = lineEl.createDiv({ cls: 'code-line-content' });

			// Tokenize and highlight the line
			this.highlightLine(lineContent, line, language);

			// Add newline except for last line
			if (i < lines.length - 1) {
				lineContent.appendText('\n');
			}
		}
	}

	/**
	 * Highlight a single line of code
	 */
	private highlightLine(container: HTMLElement, line: string, language: string): void {
		// Language-specific keyword sets
		const keywords: Record<string, string[]> = {
			typescript: ['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super', 'extends', 'implements', 'static', 'public', 'private', 'protected', 'readonly', 'async', 'await', 'yield', 'of', 'in', 'instanceof', 'typeof', 'void', 'delete', 'as', 'is', 'keyof', 'infer', 'never', 'unknown', 'any'],
			javascript: ['const', 'let', 'var', 'function', 'class', 'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super', 'extends', 'static', 'async', 'await', 'yield', 'of', 'in', 'instanceof', 'typeof', 'void', 'delete'],
			python: ['def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'raise', 'with', 'as', 'pass', 'break', 'continue', 'lambda', 'yield', 'global', 'nonlocal', 'assert', 'del', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'async', 'await'],
			java: ['public', 'private', 'protected', 'static', 'final', 'abstract', 'class', 'interface', 'extends', 'implements', 'import', 'package', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default', 'try', 'catch', 'finally', 'throw', 'throws', 'new', 'this', 'super', 'void', 'instanceof', 'synchronized', 'volatile', 'transient', 'native', 'enum'],
			go: ['func', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'break', 'continue', 'default', 'defer', 'go', 'select', 'chan', 'map', 'struct', 'interface', 'type', 'const', 'var', 'nil', 'true', 'false', 'make', 'new', 'append', 'len', 'cap'],
			rust: ['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'crate', 'self', 'super', 'return', 'if', 'else', 'for', 'while', 'loop', 'match', 'break', 'continue', 'move', 'ref', 'as', 'in', 'where', 'async', 'await', 'dyn', 'unsafe', 'extern', 'type', 'true', 'false', 'Some', 'None', 'Ok', 'Err'],
			php: ['function', 'class', 'interface', 'trait', 'extends', 'implements', 'public', 'private', 'protected', 'static', 'final', 'abstract', 'return', 'if', 'else', 'elseif', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default', 'try', 'catch', 'finally', 'throw', 'new', 'use', 'namespace', 'echo', 'print', 'require', 'include', 'true', 'false', 'null', 'array', 'fn'],
			ruby: ['def', 'class', 'module', 'end', 'return', 'if', 'elsif', 'else', 'unless', 'case', 'when', 'for', 'while', 'until', 'do', 'break', 'next', 'redo', 'retry', 'begin', 'rescue', 'ensure', 'raise', 'yield', 'self', 'super', 'nil', 'true', 'false', 'and', 'or', 'not', 'in', 'then', 'attr_reader', 'attr_writer', 'attr_accessor', 'require', 'include', 'extend', 'private', 'protected', 'public'],
			yaml: ['true', 'false', 'null', 'yes', 'no', 'on', 'off'],
			css: ['@import', '@media', '@keyframes', '@font-face', '@supports', '@page', '@namespace', '!important'],
			html: ['DOCTYPE', 'html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'form', 'input', 'button', 'script', 'style', 'link', 'meta', 'title', 'header', 'footer', 'nav', 'main', 'section', 'article', 'aside']
		};

		// Aliases
		const langAliases: Record<string, string> = {
			ts: 'typescript',
			tsx: 'typescript',
			js: 'javascript',
			jsx: 'javascript',
			py: 'python',
			rb: 'ruby',
			rs: 'rust',
			yml: 'yaml',
			sh: 'bash',
			shell: 'bash'
		};

		const normalizedLang = langAliases[language] ?? language;
		const langKeywords = keywords[normalizedLang] ?? keywords['typescript'] ?? [];

		// Languages that use # for comments
		const hashCommentLangs = ['python', 'ruby', 'bash', 'shell', 'yaml', 'perl', 'r'];
		const usesHashComments = hashCommentLangs.includes(normalizedLang);

		// Build language-appropriate patterns
		let patterns: { pattern: RegExp; className: string }[] = [];

		if (normalizedLang === 'yaml') {
			// YAML needs special handling - render directly and return
			this.highlightYamlLine(container, line);
			return;
		} else {
			patterns = [
				// Comments (single line) - C-style
				{ pattern: /\/\/.*$/, className: 'hl-comment' },
				// Multi-line comment markers (simplified)
				{ pattern: /\/\*.*?\*\//, className: 'hl-comment' },
				// Strings (double and single quotes, template literals)
				{ pattern: /"(?:[^"\\]|\\.)*"/, className: 'hl-string' },
				{ pattern: /'(?:[^'\\]|\\.)*'/, className: 'hl-string' },
				{ pattern: /`(?:[^`\\]|\\.)*`/, className: 'hl-string' },
				// Numbers
				{ pattern: /\b\d+\.?\d*\b/, className: 'hl-number' },
				// Operators and punctuation
				{ pattern: /[{}()[\];,.]/, className: 'hl-punctuation' },
				{ pattern: /[+\-*/%=<>!&|^~?:]+/, className: 'hl-operator' },
			];

			// Add hash comments only for languages that use them
			if (usesHashComments) {
				patterns.unshift({ pattern: /#.*$/, className: 'hl-comment' });
			}
		}

		let remaining = line;

		while (remaining.length > 0) {
			let matched = false;

			// Try to match a pattern
			for (const { pattern, className } of patterns) {
				const match = remaining.match(pattern);
				if (match && match.index === 0) {
					container.createSpan({ cls: className, text: match[0] });
					remaining = remaining.slice(match[0].length);
					matched = true;
					break;
				}
			}

			if (matched) continue;

			// Try to match a keyword or identifier
			const wordMatch = remaining.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
			if (wordMatch && wordMatch[0]) {
				const word = wordMatch[0];
				const firstChar = word[0];
				if (langKeywords.includes(word)) {
					container.createSpan({ cls: 'hl-keyword', text: word });
				} else if (firstChar && firstChar === firstChar.toUpperCase() && word.length > 1) {
					// Likely a class/type name
					container.createSpan({ cls: 'hl-type', text: word });
				} else {
					container.createSpan({ text: word });
				}
				remaining = remaining.slice(word.length);
				continue;
			}

			// No match - output single character
			container.appendText(remaining[0] ?? '');
			remaining = remaining.slice(1);
		}
	}

	/**
	 * Special highlighter for YAML syntax
	 */
	private highlightYamlLine(container: HTMLElement, line: string): void {
		// Check for comment
		const commentMatch = line.match(/^(\s*)(#.*)$/);
		if (commentMatch) {
			if (commentMatch[1]) container.appendText(commentMatch[1]);
			container.createSpan({ cls: 'hl-comment', text: commentMatch[2] ?? '' });
			return;
		}

		// Check for key: value pattern
		const keyValueMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*)(:)(.*)$/);
		if (keyValueMatch) {
			const [, indent, key, colon, rest] = keyValueMatch;
			if (indent) container.appendText(indent);
			container.createSpan({ cls: 'hl-yaml-key', text: key ?? '' });
			container.createSpan({ cls: 'hl-punctuation', text: colon ?? '' });
			if (rest) {
				this.highlightYamlValue(container, rest);
			}
			return;
		}

		// Check for list item
		const listMatch = line.match(/^(\s*)(-)(\s*)(.*)$/);
		if (listMatch) {
			const [, indent, dash, space, rest] = listMatch;
			if (indent) container.appendText(indent);
			container.createSpan({ cls: 'hl-punctuation', text: dash ?? '' });
			if (space) container.appendText(space);
			if (rest) {
				// Check if it's a key-value in list
				const kvMatch = rest.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)(:)(.*)$/);
				if (kvMatch) {
					const [, k, c, v] = kvMatch;
					container.createSpan({ cls: 'hl-yaml-key', text: k ?? '' });
					container.createSpan({ cls: 'hl-punctuation', text: c ?? '' });
					if (v) this.highlightYamlValue(container, v);
				} else {
					this.highlightYamlValue(container, rest);
				}
			}
			return;
		}

		// Plain text
		container.appendText(line);
	}

	/**
	 * Highlight YAML value portion
	 */
	private highlightYamlValue(container: HTMLElement, value: string): void {
		// Check for string
		const stringMatch = value.match(/^(\s*)(["'])(.*)\2(\s*)$/);
		if (stringMatch) {
			const [, leadSpace, quote, content, trailSpace] = stringMatch;
			if (leadSpace) container.appendText(leadSpace);
			container.createSpan({ cls: 'hl-string', text: `${quote}${content}${quote}` });
			if (trailSpace) container.appendText(trailSpace);
			return;
		}

		// Check for number
		const numberMatch = value.match(/^(\s*)(\d+\.?\d*)(\s*)$/);
		if (numberMatch) {
			const [, leadSpace, num, trailSpace] = numberMatch;
			if (leadSpace) container.appendText(leadSpace);
			container.createSpan({ cls: 'hl-number', text: num ?? '' });
			if (trailSpace) container.appendText(trailSpace);
			return;
		}

		// Check for boolean/null
		const boolMatch = value.match(/^(\s*)(true|false|null|yes|no|on|off|~)(\s*)$/i);
		if (boolMatch) {
			const [, leadSpace, bool, trailSpace] = boolMatch;
			if (leadSpace) container.appendText(leadSpace);
			container.createSpan({ cls: 'hl-keyword', text: bool ?? '' });
			if (trailSpace) container.appendText(trailSpace);
			return;
		}

		// Check for anchor/alias
		const anchorMatch = value.match(/^(\s*)([&*])([a-zA-Z_][a-zA-Z0-9_]*)(.*)$/);
		if (anchorMatch) {
			const [, leadSpace, symbol, name, rest] = anchorMatch;
			if (leadSpace) container.appendText(leadSpace);
			container.createSpan({ cls: 'hl-type', text: `${symbol}${name}` });
			if (rest) container.appendText(rest);
			return;
		}

		// Plain value (unquoted string)
		container.createSpan({ cls: 'hl-string', text: value });
	}

	private async copyToClipboard(): Promise<void> {
		if (!this.gitService) return;

		const selectedCommits = this.commits.filter(c => this.selectedCommitHashes.has(c.hash));

		if (selectedCommits.length === 0) {
			new Notice('No commits selected');
			return;
		}

		try {
			const fileDiffs = new Map<string, GitFileDiff[]>();

			for (const commit of selectedCommits) {
				const files = this.selectedFiles.get(commit.hash);
				if (!files || files.size === 0) continue;

				const diffs: GitFileDiff[] = [];

				for (const filePath of files) {
					const diffOutput = await this.gitService.getFileDiff(
						commit.hash,
						filePath,
						this.formatOptions.contextLines
					);

					let content: string | null = null;
					if (this.formatOptions.showFullFile) {
						content = await this.gitService.getFileContent(commit.hash, filePath);
					}

					diffs.push({
						path: filePath,
						hunks: parseDiffHunks(diffOutput),
						newContent: content,
						language: detectLanguage(filePath)
					});
				}

				fileDiffs.set(commit.hash, diffs);
			}

			const generator = new SlideGenerator(this.formatOptions);
			const markdown = generator.generateSlides(selectedCommits, fileDiffs);

			await navigator.clipboard.writeText(markdown);
			new Notice(`Copied ${selectedCommits.length} commit(s) as slides`);

		} catch (error) {
			console.error('Copy failed:', error);
			new Notice('Failed to copy slides. Check console for details.');
		}
	}

	private setupResizeHandle(handle: HTMLElement, panel: HTMLElement): void {
		let isResizing = false;
		let startX = 0;
		let startWidth = 0;

		const onMouseMove = (e: MouseEvent) => {
			if (!isResizing) return;
			const delta = e.clientX - startX;
			const newWidth = Math.max(200, Math.min(600, startWidth + delta));
			panel.style.flex = `0 0 ${newWidth}px`;
		};

		const onMouseUp = () => {
			isResizing = false;
			document.body.classList.remove('is-resizing-panels');
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		};

		handle.addEventListener('mousedown', (e) => {
			isResizing = true;
			startX = e.clientX;
			startWidth = panel.getBoundingClientRect().width;
			document.body.classList.add('is-resizing-panels');
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
			e.preventDefault();
		});
	}

	private setupVerticalResizeHandle(handle: HTMLElement, panel: HTMLElement): void {
		let isResizing = false;
		let startY = 0;
		let startHeight = 0;

		const onMouseMove = (e: MouseEvent) => {
			if (!isResizing) return;
			const delta = e.clientY - startY;
			const newHeight = Math.max(100, Math.min(500, startHeight + delta));
			panel.style.flex = `0 0 ${newHeight}px`;
		};

		const onMouseUp = () => {
			isResizing = false;
			document.body.classList.remove('is-resizing-panels-vertical');
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		};

		handle.addEventListener('mousedown', (e) => {
			isResizing = true;
			startY = e.clientY;
			startHeight = panel.getBoundingClientRect().height;
			document.body.classList.add('is-resizing-panels-vertical');
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
			e.preventDefault();
		});
	}

	private formatDate(date: Date): string {
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric'
		});
	}
}
