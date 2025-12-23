import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings, PluginSettingTab } from './settings';
import { GitImportModal } from './modal/git-import-modal';

export default class GitSlideImportPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addCommand({
			id: 'import-git-slides',
			name: 'Import Git commits as slides',
			callback: () => {
				new GitImportModal(this.app, this.settings.formatDefaults).open();
			}
		});

		this.addSettingTab(new PluginSettingTab(this.app, this));
	}

	onunload(): void {
		// Cleanup if needed
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData() as Partial<PluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
