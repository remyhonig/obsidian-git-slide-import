import { App, MarkdownRenderChild } from 'obsidian';
import { CytoscapeRenderer } from '../graph/cytoscape-renderer';
import { buildGraphData } from '../graph/graph-model';
import { parseStatements } from '../parser/statement-parser';

export class ConceptMapRenderChild extends MarkdownRenderChild {
	private renderer: CytoscapeRenderer | null = null;
	private source: string;
	private app: App;
	private sourcePath: string;

	constructor(
		containerEl: HTMLElement,
		source: string,
		app: App,
		sourcePath: string
	) {
		super(containerEl);
		this.source = source;
		this.app = app;
		this.sourcePath = sourcePath;
	}

	onload(): void {
		this.render();
	}

	onunload(): void {
		if (this.renderer) {
			this.renderer.destroy();
			this.renderer = null;
		}
	}

	private render(): void {
		// Clear container
		this.containerEl.empty();

		// Parse statements
		const { statements, errors } = parseStatements(this.source);

		// Show errors if any
		if (errors.length > 0) {
			const errorDiv = this.containerEl.createDiv({ cls: 'concept-map-errors' });
			errors.forEach(err => {
				errorDiv.createDiv({
					text: `Line ${err.line}: ${err.message}`,
					cls: 'concept-map-error'
				});
			});
		}

		if (statements.length === 0) {
			if (errors.length === 0) {
				this.containerEl.createDiv({
					text: 'No concept map statements found. Use: Subject -> verb -> Object',
					cls: 'concept-map-empty'
				});
			}
			return;
		}

		// Build graph data and render
		const graphData = buildGraphData(statements);

		const graphContainer = this.containerEl.createDiv({
			cls: 'concept-map-container'
		});

		this.renderer = new CytoscapeRenderer(
			graphContainer,
			this.app,
			this.sourcePath
		);
		this.renderer.render(graphData);
	}
}
