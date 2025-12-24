import { App, PluginSettingTab as ObsidianPluginSettingTab, Setting } from 'obsidian';
import type GitSlideImportPlugin from './main';
import {
	DEFAULT_COMMIT_DETAILS_TEMPLATE,
	DEFAULT_SLIDE_TEMPLATE
} from './git-slides/slide-generator';
import type { SlideOrganization, LineChangeDisplay } from './git-slides/types';

export interface SlideFormatDefaults {
	highlightAddedLines: boolean;
	highlightMode: 'all' | 'stepped';
	lineChangeDisplay: LineChangeDisplay;
	showFullFile: boolean;
	contextLines: number;
	includeCommitMessage: boolean;
	includeFileSummary: boolean;
	slideOrganization: SlideOrganization;
	commitDetailsTemplate: string;
	slideTemplate: string;
	dateFormat: string;
}

export interface PluginSettings {
	formatDefaults: SlideFormatDefaults;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	formatDefaults: {
		highlightAddedLines: true,
		highlightMode: 'stepped',
		lineChangeDisplay: 'additions-only',
		showFullFile: false,
		contextLines: 3,
		includeCommitMessage: true,
		includeFileSummary: true,
		slideOrganization: 'flat',
		commitDetailsTemplate: DEFAULT_COMMIT_DETAILS_TEMPLATE,
		slideTemplate: DEFAULT_SLIDE_TEMPLATE,
		dateFormat: 'MMM d, yyyy'
	}
};

export class PluginSettingTab extends ObsidianPluginSettingTab {
	plugin: GitSlideImportPlugin;

	constructor(app: App, plugin: GitSlideImportPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Git slide import' });
		containerEl.createEl('p', {
			text: 'Default settings for slide generation. These can be overridden in the import modal.',
			cls: 'setting-item-description'
		});

		const getDisplayModeValue = (): string => {
			if (!this.plugin.settings.formatDefaults.highlightAddedLines) {
				return this.plugin.settings.formatDefaults.showFullFile ? 'full-plain' : 'diff-plain';
			}
			if (this.plugin.settings.formatDefaults.showFullFile) {
				return this.plugin.settings.formatDefaults.highlightMode === 'stepped' ? 'full-stepped' : 'full-all';
			}
			return this.plugin.settings.formatDefaults.highlightMode === 'stepped' ? 'diff-stepped' : 'diff-all';
		};
		new Setting(containerEl)
			.setName('Code display')
			.setDesc('What code to show and how to highlight new lines')
			.addDropdown(dropdown => dropdown
				.addOption('diff-plain', 'Changed lines only')
				.addOption('diff-all', 'Changed lines, highlight new')
				.addOption('diff-stepped', 'Changed lines, stepped reveal')
				.addOption('full-plain', 'Complete file')
				.addOption('full-all', 'Complete file, highlight new')
				.addOption('full-stepped', 'Complete file, stepped reveal')
				.setValue(getDisplayModeValue())
				.onChange(async (value) => {
					this.plugin.settings.formatDefaults.showFullFile = value.startsWith('full-');
					this.plugin.settings.formatDefaults.highlightAddedLines = !value.endsWith('-plain');
					this.plugin.settings.formatDefaults.highlightMode = value.endsWith('-stepped') ? 'stepped' : 'all';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Context lines')
			.setDesc('Number of lines of context around changes (when not showing full file)')
			.addText(text => text
				.setPlaceholder('3')
				.setValue(String(this.plugin.settings.formatDefaults.contextLines))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num >= 0) {
						this.plugin.settings.formatDefaults.contextLines = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Include commit message')
			.setDesc('Add the commit message to each slide')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.formatDefaults.includeCommitMessage)
				.onChange(async (value) => {
					this.plugin.settings.formatDefaults.includeCommitMessage = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Include file summary')
			.setDesc('Show summary of other files changed in the commit')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.formatDefaults.includeFileSummary)
				.onChange(async (value) => {
					this.plugin.settings.formatDefaults.includeFileSummary = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Slide organization')
			.setDesc('Flat: one slide per file. Grouped: commit intro + vertical subslides per file. Progressive: same file evolving across commits. Per-hunk: each diff hunk gets its own slide.')
			.addDropdown(dropdown => dropdown
				.addOption('flat', 'Flat')
				.addOption('grouped', 'Grouped by commit')
				.addOption('progressive', 'Progressive')
				.addOption('per-hunk', 'Per hunk')
				.setValue(this.plugin.settings.formatDefaults.slideOrganization)
				.onChange(async (value) => {
					this.plugin.settings.formatDefaults.slideOrganization = value as SlideOrganization;
					await this.plugin.saveSettings();
				}));
	}
}
