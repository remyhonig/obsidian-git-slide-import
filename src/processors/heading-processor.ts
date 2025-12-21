import { TFile, type MarkdownPostProcessorContext, type Plugin } from 'obsidian';
import { ConceptMapRenderChild } from './concept-map-child';
import type { PluginSettings } from '../settings';

export function registerHeadingProcessor(
	plugin: Plugin,
	getSettings: () => PluginSettings
): void {
	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const settings = getSettings();
			const headingName = settings.headingName;

			// Look for our heading in the rendered content
			const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6');

			headings.forEach(heading => {
				if (heading.textContent?.trim() === headingName) {
					processConceptMapHeading(
						heading as HTMLElement,
						ctx,
						plugin
					);
				}
			});
		}
	);
}

function processConceptMapHeading(
	headingEl: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	plugin: Plugin
): void {
	const sectionInfo = ctx.getSectionInfo(headingEl);
	if (!sectionInfo) return;

	const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(file instanceof TFile)) return;

	// Read file content and extract section
	void plugin.app.vault.cachedRead(file).then(content => {
		const lines = content.split('\n');
		const headingLevel = parseInt(headingEl.tagName.charAt(1));
		const headingPattern = new RegExp(`^#{1,${headingLevel}}\\s`);

		// Find content under this heading until next heading of same or higher level
		const startLine = sectionInfo.lineStart + 1;
		let endLine = lines.length;

		for (let i = startLine; i < lines.length; i++) {
			const line = lines[i];
			if (line && headingPattern.test(line)) {
				endLine = i;
				break;
			}
		}

		const sectionContent = lines.slice(startLine, endLine).join('\n').trim();

		if (!sectionContent) return;

		// Create container for the concept map
		const container = document.createElement('div');
		container.addClass('concept-map-heading-wrapper');

		// Insert after the heading
		headingEl.after(container);

		// Create and register render child
		const child = new ConceptMapRenderChild(
			container,
			sectionContent,
			plugin.app,
			ctx.sourcePath
		);
		ctx.addChild(child);
	});
}
