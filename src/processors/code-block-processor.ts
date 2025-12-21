import type { MarkdownPostProcessorContext, Plugin } from 'obsidian';
import { ConceptMapRenderChild } from './concept-map-child';

export function registerCodeBlockProcessor(plugin: Plugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
		'concept-map',
		(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const child = new ConceptMapRenderChild(
				el,
				source,
				plugin.app,
				ctx.sourcePath
			);
			ctx.addChild(child);
		}
	);
}
