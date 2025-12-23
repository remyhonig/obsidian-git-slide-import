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

		new Setting(containerEl)
			.setName('Highlight mode')
			.setDesc('How to display highlighted lines (all at once or stepped)')
			.addDropdown(dropdown => dropdown
				.addOption('all', 'All at once')
				.addOption('stepped', 'Stepped (reveal one by one)')
				.setValue(this.plugin.settings.formatDefaults.highlightMode)
				.onChange(async (value) => {
					this.plugin.settings.formatDefaults.highlightMode = value as 'all' | 'stepped';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show full file')
			.setDesc('Show entire file content instead of just the diff')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.formatDefaults.showFullFile)
				.onChange(async (value) => {
					this.plugin.settings.formatDefaults.showFullFile = value;
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
			.setDesc('How to organize slides for multiple files')
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
