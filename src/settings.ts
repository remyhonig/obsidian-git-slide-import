import { App, PluginSettingTab as ObsidianPluginSettingTab, Setting } from 'obsidian';
import type MainPlugin from './main';

export interface PluginSettings {
	headingName: string;
	defaultHeight: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	headingName: 'Concept Map',
	defaultHeight: 400
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

		containerEl.createEl('h2', { text: 'Concept map' });

		new Setting(containerEl)
			.setName('Heading name')
			.setDesc('Heading text that triggers concept map rendering')
			.addText(text => text
				.setPlaceholder('Concept map')
				.setValue(this.plugin.settings.headingName)
				.onChange(async (value) => {
					this.plugin.settings.headingName = value || 'Concept Map';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default height')
			.setDesc('Default height of the concept map container (in pixels)')
			.addText(text => text
				.setPlaceholder('400')
				.setValue(String(this.plugin.settings.defaultHeight))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.defaultHeight = num;
						await this.plugin.saveSettings();
					}
				}));
	}
}
