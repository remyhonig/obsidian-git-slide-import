import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings, PluginSettingTab } from './settings';

export default class MainPlugin extends Plugin {
	settings: PluginSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new PluginSettingTab(this.app, this));
	}

	onunload() {
		// Cleanup code here
	}

	async loadSettings() {
		const savedData = await this.loadData() as Partial<PluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
