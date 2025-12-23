/**
 * Main modal dialog for importing git commits as slides
 */

import { App, Modal, Notice, Setting, MarkdownView, debounce } from 'obsidian';
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
import type { SlideFormatDefaults } from '../settings';

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
type FocusedColumn = 'commits' | 'files';

export class GitImportModal extends Modal {
	private formatDefaults: SlideFormatDefaults;

	// State
	private repoPath: string | null = null;
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
	private includePattern = '';
	private excludePattern = '(node_modules|vendor|dist|build|\\.min\\.|package-lock\\.json|composer\\.lock|yarn\\.lock|pnpm-lock\\.yaml|Cargo\\.lock|Gemfile\\.lock|poetry\\.lock)$';

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
	private commitPanelEl: HTMLElement | null = null;
	private filePanelEl: HTMLElement | null = null;
	private commitListEl: HTMLElement | null = null;
	private fileListEl: HTMLElement | null = null;
	private fileCommitMessageEl: HTMLElement | null = null;
	private fileDiffPreviewEl: HTMLElement | null = null;
	private previewEl: HTMLElement | null = null;
	private markdownPreviewEl: HTMLElement | null = null;
	private slidesPreviewEl: HTMLElement | null = null;
	private importBtn: HTMLButtonElement | null = null;
	private includeInputEl: HTMLInputElement | null = null;
	private excludeInputEl: HTMLInputElement | null = null;

	// Preview tab state
	private activePreviewTab: 'markdown' | 'slides' = 'slides';
	private slideCountBadgeEl: HTMLElement | null = null;

	// Currently selected file for diff preview
	private selectedFile: GitFileChange | null = null;

	// Debounced preview update
	private debouncedUpdatePreview = debounce(
		() => { void this.generatePreview(); },
		300,
		true
	);

	constructor(app: App, formatDefaults: SlideFormatDefaults) {
		super(app);
		this.formatDefaults = formatDefaults;
		this.formatOptions = this.createFormatOptionsFromDefaults();
	}

	private createFormatOptionsFromDefaults(): SlideFormatOptions {
		const defaults = createDefaultFormatOptions();
		return {
			...defaults,
			highlightAddedLines: this.formatDefaults.highlightAddedLines,
			highlightMode: this.formatDefaults.highlightMode,
			showFullFile: this.formatDefaults.showFullFile,
			contextLines: this.formatDefaults.contextLines,
			includeCommitMessage: this.formatDefaults.includeCommitMessage,
			includeFileSummary: this.formatDefaults.includeFileSummary,
			slideOrganization: this.formatDefaults.slideOrganization,
			commitDetailsTemplate: this.formatDefaults.commitDetailsTemplate,
			slideTemplate: this.formatDefaults.slideTemplate,
			dateFormat: this.formatDefaults.dateFormat
		};
	}

	onOpen(): void {
		this.modalEl.addClass('git-import-modal');
		this.setTitle('Import Git commits as slides');
		this.buildUI();
		this.setupKeyboardNavigation();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private setupKeyboardNavigation(): void {
		this.modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
			// Don't intercept if focus is on an input element
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
				return;
			}

			switch (e.key) {
				case 'ArrowUp':
					e.preventDefault();
					this.navigateVertical(-1);
					break;
				case 'ArrowDown':
					e.preventDefault();
					this.navigateVertical(1);
					break;
				case 'ArrowLeft':
					e.preventDefault();
					this.navigateHorizontal('left');
					break;
				case 'ArrowRight':
					e.preventDefault();
					this.navigateHorizontal('right');
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

	private navigateHorizontal(direction: 'left' | 'right'): void {
		if (direction === 'left' && this.focusedColumn === 'files') {
			this.focusedColumn = 'commits';
			this.updateFocusHighlight();
			this.expandCommitsColumn();
		} else if (direction === 'right' && this.focusedColumn === 'commits' && this.currentFiles.length > 0) {
			this.focusedColumn = 'files';
			this.focusedFileIndex = 0;
			this.updateFocusHighlight();
			this.collapseCommitsColumn();
			// Show diff for first file
			this.selectFileAtIndex(0);
		}
	}

	private collapseCommitsColumn(): void {
		this.commitPanelEl?.addClass('collapsed');
		this.filePanelEl?.addClass('expanded');
	}

	private expandCommitsColumn(): void {
		this.commitPanelEl?.removeClass('collapsed');
		this.filePanelEl?.removeClass('expanded');
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
			const commit = this.commits[this.focusedCommitIndex];
			if (commit) {
				const isSelected = this.selectedCommitHashes.has(commit.hash);
				if (isSelected) {
					this.selectedCommitHashes.delete(commit.hash);
					this.selectedFiles.delete(commit.hash);
				} else {
					this.selectedCommitHashes.add(commit.hash);
				}
				this.updateCommitCheckbox(commit.hash, !isSelected);
				this.updateImportButton();
				this.debouncedUpdatePreview();
			}
		} else {
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
					// Also select the commit
					this.selectedCommitHashes.add(commitHash);
					this.updateCommitCheckbox(commitHash, true);
				}
				this.updateFileCheckbox(file.path, !isSelected);
				this.updateImportButton();
				this.debouncedUpdatePreview();
			}
		}
	}

	private updateFocusHighlight(): void {
		// Remove all focus highlights
		this.commitListEl?.querySelectorAll('.git-import-commit').forEach(el => {
			el.removeClass('keyboard-focus');
		});
		this.fileListEl?.querySelectorAll('.git-import-file').forEach(el => {
			el.removeClass('keyboard-focus');
		});

		// Add focus highlight to current item
		if (this.focusedColumn === 'commits') {
			const commitEls = this.commitListEl?.querySelectorAll('.git-import-commit');
			const focusedEl = commitEls?.[this.focusedCommitIndex];
			focusedEl?.addClass('keyboard-focus');
			focusedEl?.scrollIntoView({ block: 'nearest' });
		} else {
			const fileEls = this.fileListEl?.querySelectorAll('.git-import-file');
			const focusedEl = fileEls?.[this.focusedFileIndex];
			focusedEl?.addClass('keyboard-focus');
			focusedEl?.scrollIntoView({ block: 'nearest' });
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

		// Footer with buttons and keyboard hints
		this.buildFooter(contentEl);
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

		// Branch selector
		const branchGroup = section.createDiv({ cls: 'git-import-filter-group' });
		branchGroup.createEl('label', { text: 'Branch:' });
		this.branchSelectEl = branchGroup.createEl('select');
		this.branchSelectEl.disabled = true;
		this.branchSelectEl.addEventListener('change', () => {
			this.filter.branch = this.branchSelectEl?.value || null;
			void this.loadCommits();
		});

		// Start date picker
		const dateGroup = section.createDiv({ cls: 'git-import-filter-group' });
		dateGroup.createEl('label', { text: 'From:' });
		const dateInput = dateGroup.createEl('input', {
			type: 'date',
			value: this.formatDateForInput(this.filter.sinceDate),
			cls: 'git-import-date-input'
		});
		dateInput.addEventListener('change', () => {
			this.filter.sinceDate = dateInput.value ? new Date(dateInput.value) : null;
			void this.loadCommits();
		});

		// Period dropdown
		const periodGroup = section.createDiv({ cls: 'git-import-filter-group' });
		periodGroup.createEl('label', { text: 'Until:' });
		const periodSelect = periodGroup.createEl('select');
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
		presetGroup.createEl('label', { text: 'Preset:' });
		const presetSelect = presetGroup.createEl('select');
		presetSelect.createEl('option', { text: '(custom)', value: '' });
		for (const preset of FILTER_PRESETS) {
			presetSelect.createEl('option', { text: preset.name, value: preset.name });
		}
		presetSelect.addEventListener('change', () => {
			const preset = FILTER_PRESETS.find(p => p.name === presetSelect.value);
			if (preset) {
				this.includePattern = preset.include;
				this.excludePattern = preset.exclude;
				if (this.includeInputEl) this.includeInputEl.value = preset.include;
				if (this.excludeInputEl) this.excludeInputEl.value = preset.exclude;
				if (this.selectedCommit) {
					void this.loadFilesForCommit(this.selectedCommit);
				}
			}
		});

		// Include pattern
		const includeGroup = section.createDiv({ cls: 'git-import-filter-group git-import-filter-regex' });
		includeGroup.createEl('label', { text: 'Include:' });
		this.includeInputEl = includeGroup.createEl('input', {
			type: 'text',
			placeholder: 'regex pattern',
			value: this.includePattern,
			cls: 'git-import-regex-input'
		});
		this.includeInputEl.addEventListener('change', () => {
			this.includePattern = this.includeInputEl?.value ?? '';
			if (this.selectedCommit) {
				void this.loadFilesForCommit(this.selectedCommit);
			}
		});

		// Exclude pattern
		const excludeGroup = section.createDiv({ cls: 'git-import-filter-group git-import-filter-regex' });
		excludeGroup.createEl('label', { text: 'Exclude:' });
		this.excludeInputEl = excludeGroup.createEl('input', {
			type: 'text',
			placeholder: 'regex pattern',
			value: this.excludePattern,
			cls: 'git-import-regex-input'
		});
		this.excludeInputEl.addEventListener('change', () => {
			this.excludePattern = this.excludeInputEl?.value ?? '';
			if (this.selectedCommit) {
				void this.loadFilesForCommit(this.selectedCommit);
			}
		});
	}

	private formatDateForInput(date: Date | null): string {
		if (!date) return '';
		return date.toISOString().split('T')[0] ?? '';
	}

	private buildPanels(container: HTMLElement): void {
		const panels = container.createDiv({ cls: 'git-import-panels' });

		// Column 1: Commits
		this.commitPanelEl = panels.createDiv({ cls: 'git-import-panel git-import-panel-commits' });
		this.commitPanelEl.createDiv({ cls: 'git-import-panel-header', text: 'Commits' });
		this.commitListEl = this.commitPanelEl.createDiv({ cls: 'git-import-panel-content' });
		this.commitListEl.setAttribute('tabindex', '0');
		this.commitListEl.setText('Select a repository to see commits');

		// Column 2: Files
		this.filePanelEl = panels.createDiv({ cls: 'git-import-panel git-import-panel-files' });
		this.filePanelEl.createDiv({ cls: 'git-import-panel-header', text: 'Files' });
		// Commit message header (shows selected commit's message)
		this.fileCommitMessageEl = this.filePanelEl.createDiv({ cls: 'git-import-commit-header is-hidden' });
		// File list area
		this.fileListEl = this.filePanelEl.createDiv({ cls: 'git-import-panel-content git-import-file-list' });
		this.fileListEl.setAttribute('tabindex', '0');
		this.fileListEl.setText('Select a commit to see files');
		// Diff preview area at bottom
		this.fileDiffPreviewEl = this.filePanelEl.createDiv({ cls: 'git-import-file-diff is-hidden' });
		this.fileDiffPreviewEl.createDiv({ cls: 'git-import-file-diff-header', text: 'Diff' });
		this.fileDiffPreviewEl.createDiv({ cls: 'git-import-file-diff-content' });

		// Column 3: Preview with tabs
		const previewPanel = panels.createDiv({ cls: 'git-import-panel git-import-panel-preview' });

		// Tabbed header
		const previewHeader = previewPanel.createDiv({ cls: 'git-import-panel-header git-import-preview-header' });
		const tabsEl = previewHeader.createDiv({ cls: 'git-import-preview-tabs' });

		const slidesTab = tabsEl.createEl('button', {
			cls: 'git-import-preview-tab active'
		});
		slidesTab.createSpan({ text: 'Slides' });
		this.slideCountBadgeEl = slidesTab.createSpan({ cls: 'git-import-tab-badge', text: '0' });

		const markdownTab = tabsEl.createEl('button', {
			text: 'Markdown',
			cls: 'git-import-preview-tab'
		});

		slidesTab.addEventListener('click', () => {
			this.activePreviewTab = 'slides';
			slidesTab.addClass('active');
			markdownTab.removeClass('active');
			this.markdownPreviewEl?.addClass('is-hidden');
			this.slidesPreviewEl?.removeClass('is-hidden');
		});

		markdownTab.addEventListener('click', () => {
			this.activePreviewTab = 'markdown';
			markdownTab.addClass('active');
			slidesTab.removeClass('active');
			this.slidesPreviewEl?.addClass('is-hidden');
			this.markdownPreviewEl?.removeClass('is-hidden');
		});

		this.previewEl = previewPanel.createDiv({ cls: 'git-import-panel-content git-import-preview-content' });

		// Slides preview (visual)
		this.slidesPreviewEl = this.previewEl.createDiv({ cls: 'git-import-slides-preview' });
		this.slidesPreviewEl.setText('Select commits and files to see preview');

		// Markdown preview (raw code)
		this.markdownPreviewEl = this.previewEl.createDiv({ cls: 'git-import-markdown-preview is-hidden' });
		this.markdownPreviewEl.setText('Select commits and files to see preview');

		// Column 4: Settings
		const settingsPanel = panels.createDiv({ cls: 'git-import-panel git-import-panel-settings' });
		settingsPanel.createDiv({ cls: 'git-import-panel-header', text: 'Slide options' });
		const settingsContent = settingsPanel.createDiv({ cls: 'git-import-panel-content git-import-settings-content' });
		this.buildSettingsPanel(settingsContent);
	}

	private buildSettingsPanel(container: HTMLElement): void {
		// Slide organization
		const orgSetting = container.createDiv({ cls: 'git-import-setting' });
		new Setting(orgSetting)
			.setName('Slide organization')
			.setDesc('Flat: one slide per file. Grouped: commit intro + vertical subslides per file. Progressive: same file evolving across commits. Per-hunk: each diff hunk gets its own slide.')
			.addDropdown(dropdown => dropdown
				.addOption('flat', 'Flat')
				.addOption('grouped', 'Grouped by commit')
				.addOption('progressive', 'Progressive')
				.addOption('per-hunk', 'Per hunk')
				.setValue(this.formatOptions.slideOrganization)
				.onChange(value => {
					this.formatOptions.slideOrganization = value as SlideOrganization;
					this.debouncedUpdatePreview();
				}));

		// Highlight added lines
		const highlightSetting = container.createDiv({ cls: 'git-import-setting' });
		new Setting(highlightSetting)
			.setName('Highlight new code')
			.setDesc('Draw attention to added lines using reveal.js line highlight syntax.')
			.addToggle(toggle => toggle
				.setValue(this.formatOptions.highlightAddedLines)
				.onChange(value => {
					this.formatOptions.highlightAddedLines = value;
					this.debouncedUpdatePreview();
				}));

		// Combined code display mode (full file + reveal style)
		const displayModeSetting = container.createDiv({ cls: 'git-import-setting' });
		const getDisplayModeValue = (): string => {
			if (this.formatOptions.showFullFile) {
				return this.formatOptions.highlightMode === 'stepped' ? 'full-stepped' : 'full-all';
			}
			return this.formatOptions.highlightMode === 'stepped' ? 'diff-stepped' : 'diff-all';
		};
		new Setting(displayModeSetting)
			.setName('Code display')
			.setDesc('What code to show and how to reveal highlights.')
			.addDropdown(dropdown => dropdown
				.addOption('diff-all', 'Changed lines only')
				.addOption('diff-stepped', 'Changed lines, stepped reveal')
				.addOption('full-all', 'Complete file')
				.addOption('full-stepped', 'Complete file, stepped reveal')
				.setValue(getDisplayModeValue())
				.onChange(value => {
					this.formatOptions.showFullFile = value.startsWith('full-');
					this.formatOptions.highlightMode = value.endsWith('-stepped') ? 'stepped' : 'all';
					this.previewCache.clear();
					this.debouncedUpdatePreview();
				}));

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
				}));

		// Templates section header
		container.createEl('h4', { text: 'Templates', cls: 'git-import-section-header' });

		// Commit details template
		const commitDetailsTemplateEl = container.createDiv({ cls: 'git-import-setting git-import-template-setting' });
		new Setting(commitDetailsTemplateEl)
			.setName('Commit details')
			.setDesc('Variables: {{authorName}}, {{authorEmail}}, {{commitDate}}, {{messageTitle}}, {{messageBody}}, {{commitHash}}, {{commitHashShort}}')
			.addTextArea(text => text
				.setValue(this.formatOptions.commitDetailsTemplate)
				.onChange(value => {
					this.formatOptions.commitDetailsTemplate = value;
					this.debouncedUpdatePreview();
				}));

		// Add reset button for commit details template
		const commitDetailsResetBtn = commitDetailsTemplateEl.createEl('button', {
			text: 'Reset to default',
			cls: 'git-import-reset-btn'
		});
		commitDetailsResetBtn.addEventListener('click', () => {
			this.formatOptions.commitDetailsTemplate = DEFAULT_COMMIT_DETAILS_TEMPLATE;
			const textarea = commitDetailsTemplateEl.querySelector('textarea');
			if (textarea) textarea.value = DEFAULT_COMMIT_DETAILS_TEMPLATE;
			this.debouncedUpdatePreview();
		});

		// Slide template
		const slideTemplateEl = container.createDiv({ cls: 'git-import-setting git-import-template-setting' });
		new Setting(slideTemplateEl)
			.setName('Slide template')
			.setDesc('Variables: {{fileName}}, {{filePath}}, {{fileSummary}}, {{code}}, {{commitDetails}} + all commit variables')
			.addTextArea(text => text
				.setValue(this.formatOptions.slideTemplate)
				.onChange(value => {
					this.formatOptions.slideTemplate = value;
					this.debouncedUpdatePreview();
				}));

		// Add reset button for slide template
		const slideResetBtn = slideTemplateEl.createEl('button', {
			text: 'Reset to default',
			cls: 'git-import-reset-btn'
		});
		slideResetBtn.addEventListener('click', () => {
			this.formatOptions.slideTemplate = DEFAULT_SLIDE_TEMPLATE;
			const textarea = slideTemplateEl.querySelector('textarea');
			if (textarea) textarea.value = DEFAULT_SLIDE_TEMPLATE;
			this.debouncedUpdatePreview();
		});

		// Date format
		const dateFormatEl = container.createDiv({ cls: 'git-import-setting' });
		new Setting(dateFormatEl)
			.setName('Date format')
			.setDesc('Use: yyyy, MMM/MMMM, d/dd, HH:mm')
			.addText(text => text
				.setValue(this.formatOptions.dateFormat)
				.setPlaceholder('MMM d, yyyy')
				.onChange(value => {
					this.formatOptions.dateFormat = value;
					this.debouncedUpdatePreview();
				}));
	}

	private buildFooter(container: HTMLElement): void {
		const footer = container.createDiv({ cls: 'git-import-footer' });

		// Keyboard hints on the left
		const hint = footer.createDiv({ cls: 'git-import-keyboard-hint' });
		hint.setText('↑↓ navigate • ←→ switch columns • space select');

		// Buttons on the right
		const buttons = footer.createDiv({ cls: 'git-import-footer-buttons' });

		const cancelBtn = buttons.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.importBtn = buttons.createEl('button', {
			text: 'Import to note',
			cls: 'mod-cta'
		});
		this.importBtn.disabled = true;
		this.importBtn.addEventListener('click', () => void this.doImport());
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

		if (this.repoBtn) {
			// Show last part of path in button
			const segments = path.split(/[/\\]/);
			const repoName = segments[segments.length - 1] || 'Repository';
			this.repoBtn.setText(repoName);
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
			this.fileListEl.empty();
			this.fileListEl.setText('Select a commit to see files');
		}
		if (this.fileCommitMessageEl) {
			this.fileCommitMessageEl.empty();
			this.fileCommitMessageEl.addClass('is-hidden');
		}
		this.hideDiffPreview();
		if (this.slidesPreviewEl) {
			this.slidesPreviewEl.empty();
			this.slidesPreviewEl.setText('Select commits and files to see preview');
		}
		if (this.markdownPreviewEl) {
			this.markdownPreviewEl.empty();
			this.markdownPreviewEl.setText('Select commits and files to see preview');
		}
		this.updateImportButton();

		await this.loadBranches();
		await this.loadCommits();
	}

	private async loadBranches(): Promise<void> {
		if (!this.gitService || !this.branchSelectEl) return;

		try {
			this.branches = await this.gitService.getLocalBranches();
			const currentBranch = await this.gitService.getCurrentBranch();

			this.branchSelectEl.empty();

			const allOption = this.branchSelectEl.createEl('option', {
				text: '(all branches)',
				value: ''
			});
			if (!this.filter.branch) {
				allOption.selected = true;
			}

			for (const branch of this.branches) {
				const option = this.branchSelectEl.createEl('option', {
					text: branch,
					value: branch
				});
				if (branch === currentBranch && !this.filter.branch) {
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
			this.commits = await this.gitService.getCommits(this.filter);
			this.commitListEl.empty();

			if (this.commits.length === 0) {
				this.commitListEl.setText('No commits found');
				return;
			}

			// Reset focus
			this.focusedCommitIndex = 0;
			this.focusedColumn = 'commits';

			for (let i = 0; i < this.commits.length; i++) {
				const commit = this.commits[i]!;
				const commitEl = this.commitListEl.createDiv({ cls: 'git-import-commit' });
				if (i === 0) commitEl.addClass('keyboard-focus');

				const checkbox = commitEl.createEl('input', { type: 'checkbox' });
				checkbox.checked = this.selectedCommitHashes.has(commit.hash);
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) {
						this.selectedCommitHashes.add(commit.hash);
					} else {
						this.selectedCommitHashes.delete(commit.hash);
						this.selectedFiles.delete(commit.hash);
					}
					this.updateImportButton();
					this.debouncedUpdatePreview();
				});

				const infoEl = commitEl.createDiv({ cls: 'git-import-commit-info' });
				infoEl.addEventListener('click', () => {
					this.focusedCommitIndex = i;
					this.focusedColumn = 'commits';
					this.updateFocusHighlight();
					void this.selectCommit(commit);
				});

				const hashEl = infoEl.createSpan({ cls: 'git-import-commit-hash' });
				hashEl.setText(commit.hashShort);

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
			const hashEl = el.querySelector('.git-import-commit-hash');
			return hashEl?.textContent === commit.hashShort;
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

	private async loadFilesForCommit(commit: GitCommit): Promise<void> {
		if (!this.gitService || !this.fileListEl) return;

		this.fileListEl.empty();
		this.fileListEl.setText('Loading files...');

		try {
			this.currentFiles = await this.gitService.getCommitFilesWithStats(commit.hash);

			// Apply include pattern
			if (this.includePattern) {
				try {
					const includeRegex = new RegExp(this.includePattern);
					this.currentFiles = this.currentFiles.filter(f => includeRegex.test(f.path));
				} catch {
					// Invalid regex, ignore
				}
			}

			// Apply exclude pattern
			if (this.excludePattern) {
				try {
					const excludeRegex = new RegExp(this.excludePattern);
					this.currentFiles = this.currentFiles.filter(f => !excludeRegex.test(f.path));
				} catch {
					// Invalid regex, ignore
				}
			}

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
				checkbox.checked = selectedForCommit.has(file.path);
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) {
						selectedForCommit.add(file.path);
						this.selectedCommitHashes.add(commit.hash);
						this.updateCommitCheckbox(commit.hash, true);
					} else {
						selectedForCommit.delete(file.path);
					}
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

			// Render diff with syntax highlighting
			const preEl = contentEl.createEl('pre');
			const lines = diffOutput.split('\n');

			for (const line of lines) {
				const lineEl = preEl.createEl('div', { cls: 'diff-line' });

				if (line.startsWith('+') && !line.startsWith('+++')) {
					lineEl.addClass('diff-added');
				} else if (line.startsWith('-') && !line.startsWith('---')) {
					lineEl.addClass('diff-removed');
				} else if (line.startsWith('@@')) {
					lineEl.addClass('diff-hunk');
				} else if (line.startsWith('diff ') || line.startsWith('index ') ||
					line.startsWith('---') || line.startsWith('+++')) {
					lineEl.addClass('diff-meta');
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

	private updateCommitCheckbox(hash: string, checked: boolean): void {
		const commitEls = this.commitListEl?.querySelectorAll('.git-import-commit');
		for (const el of Array.from(commitEls ?? [])) {
			const hashEl = el.querySelector('.git-import-commit-hash');
			if (hashEl?.textContent) {
				const commit = this.commits.find(c => c.hashShort === hashEl.textContent);
				if (commit?.hash === hash) {
					const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
					if (checkbox) checkbox.checked = checked;
					break;
				}
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
			this.slidesPreviewEl.empty();
			this.slidesPreviewEl.setText('Select commits and files to see preview');
			this.markdownPreviewEl.empty();
			this.markdownPreviewEl.setText('Select commits and files to see preview');
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
		let codeBlockLang = '';
		let codeBlockHighlights = '';
		let codeLines: string[] = [];

		for (const line of lines) {
			// Check for code block start/end
			if (line.startsWith('```')) {
				if (!inCodeBlock) {
					// Starting a code block
					inCodeBlock = true;
					// Extract language and highlight annotation (like ```ts [1-2|3-4])
					const match = line.match(/^```(\w*)\s*(?:\[([^\]]*)\])?/);
					codeBlockLang = match?.[1] ?? '';
					codeBlockHighlights = match?.[2] ?? '';
					codeLines = [];
				} else {
					// Ending a code block
					inCodeBlock = false;

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
				{ pattern: /[{}()\[\];,.]/, className: 'hl-punctuation' },
				{ pattern: /[+\-*/%=<>!&|^~?:]+/, className: 'hl-operator' },
			];

			// Add hash comments only for languages that use them
			if (usesHashComments) {
				patterns.unshift({ pattern: /#.*$/, className: 'hl-comment' });
			}
		}

		let remaining = line;
		let pos = 0;

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

	private async doImport(): Promise<void> {
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

			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

			if (activeView?.editor) {
				const editor = activeView.editor;
				const cursor = editor.getCursor();
				editor.replaceRange(markdown, cursor);
				new Notice(`Imported ${selectedCommits.length} commit(s) as slides`);
			} else {
				await navigator.clipboard.writeText(markdown);
				new Notice('No active note. Slides copied to clipboard.');
			}

			this.close();
		} catch (error) {
			console.error('Import failed:', error);
			new Notice('Failed to import commits. Check console for details.');
		}
	}

	private formatDate(date: Date): string {
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric'
		});
	}
}
