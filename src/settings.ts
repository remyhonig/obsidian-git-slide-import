import { App, PluginSettingTab as ObsidianPluginSettingTab, Setting } from 'obsidian';
import type MainPlugin from './main';

export interface PluginSettings {
	exampleSetting: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	exampleSetting: 'default'
};

export class PluginSettingTab extends ObsidianPluginSettingTab {
	plugin: MainPlugin;

	constructor(app: App, plugin: MainPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Example setting')
			.setDesc('This is an example setting.')
			.addText(text => text
				.setPlaceholder('Enter a value')
				.setValue(this.plugin.settings.exampleSetting)
				.onChange(async (value) => {
					this.plugin.settings.exampleSetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
