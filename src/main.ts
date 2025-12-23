import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings, PluginSettingTab } from './settings';
import { GitImportView } from './view/git-import-view';
import { GIT_IMPORT_VIEW_TYPE } from './view/constants';

export default class GitSlideImportPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register the ItemView
		this.registerView(
			GIT_IMPORT_VIEW_TYPE,
			(leaf) => new GitImportView(leaf, this)
		);

		// Command opens new tab
		this.addCommand({
			id: 'import-git-slides',
			name: 'Import Git commits as slides',
			callback: () => { void this.activateView(); }
		});

		this.addSettingTab(new PluginSettingTab(this.app, this));
	}

	onunload(): void {
		// Views are automatically cleaned up by Obsidian
	}

	private async activateView(): Promise<void> {
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: GIT_IMPORT_VIEW_TYPE,
			active: true
		});
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData() as Partial<PluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
