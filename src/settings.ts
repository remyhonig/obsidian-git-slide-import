import { App, PluginSettingTab as ObsidianPluginSettingTab, Setting } from 'obsidian';
import type GitSlideImportPlugin from './main';
import {
	DEFAULT_COMMIT_DETAILS_TEMPLATE,
	DEFAULT_SLIDE_TEMPLATE
} from './git-slides/slide-generator';
import type { SlideOrganization } from './git-slides/types';

export interface SlideFormatDefaults {
	highlightAddedLines: boolean;
	highlightMode: 'all' | 'stepped';
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

		new Setting(containerEl)
			.setName('Highlight added lines')
			.setDesc('Use reveal.js line highlight syntax for added lines')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.formatDefaults.highlightAddedLines)
				.onChange(async (value) => {
					this.plugin.settings.formatDefaults.highlightAddedLines = value;
					await this.plugin.saveSettings();
				}));

		const getDisplayModeValue = (): string => {
			if (this.plugin.settings.formatDefaults.showFullFile) {
				return this.plugin.settings.formatDefaults.highlightMode === 'stepped' ? 'full-stepped' : 'full-all';
			}
			return this.plugin.settings.formatDefaults.highlightMode === 'stepped' ? 'diff-stepped' : 'diff-all';
		};
		new Setting(containerEl)
			.setName('Code display')
			.setDesc('What code to show and how to reveal highlights')
			.addDropdown(dropdown => dropdown
				.addOption('diff-all', 'Changed lines only')
				.addOption('diff-stepped', 'Changed lines, stepped reveal')
				.addOption('full-all', 'Complete file')
				.addOption('full-stepped', 'Complete file, stepped reveal')
				.setValue(getDisplayModeValue())
				.onChange(async (value) => {
					this.plugin.settings.formatDefaults.showFullFile = value.startsWith('full-');
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
