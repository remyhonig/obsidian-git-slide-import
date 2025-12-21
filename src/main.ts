import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings, PluginSettingTab } from './settings';
import { registerCodeBlockProcessor } from './processors/code-block-processor';
import { registerHeadingProcessor } from './processors/heading-processor';

export default class MainPlugin extends Plugin {
	settings: PluginSettings;

	async onload() {
		await this.loadSettings();

		// Register code block processor for ```concept-map blocks
		registerCodeBlockProcessor(this);

		// Register post processor for heading-based content
		registerHeadingProcessor(this, () => this.settings);

		// Add settings tab
		this.addSettingTab(new PluginSettingTab(this.app, this));
	}

	onunload() {
		// Cleanup handled by MarkdownRenderChild instances
	}

	async loadSettings() {
		const savedData = await this.loadData() as Partial<PluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
