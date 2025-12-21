import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import type { App } from 'obsidian';
import type { ConceptMapData } from './graph-model';
import { CYTOSCAPE_STYLE, getLayoutOptions } from './cytoscape-config';

export class CytoscapeRenderer {
	private cy: Core | null = null;
	private container: HTMLElement;
	private app: App;
	private sourcePath: string;

	constructor(
		container: HTMLElement,
		app: App,
		sourcePath: string
	) {
		this.container = container;
		this.app = app;
		this.sourcePath = sourcePath;
	}

	render(data: ConceptMapData): void {
		const elements = this.convertToElements(data);

		if (this.cy) {
			// Update existing graph with container bounding box
			// Inset by 60px to account for node sizes (nodes can extend beyond their center point)
			const padding = 60;
			const bbox = {
				x1: padding,
				y1: padding,
				w: this.container.offsetWidth - padding * 2,
				h: this.container.offsetHeight - padding * 2
			};
			const layoutOptions = getLayoutOptions(bbox);
			this.cy.elements().remove();
			this.cy.add(elements);
			this.cy.layout(layoutOptions).run();
		} else {
			// Delay creation to ensure container is in DOM with dimensions
			setTimeout(() => {
				try {
					// Inset by 60px to account for node sizes (nodes can extend beyond their center point)
					const padding = 60;
					const bbox = {
						x1: padding,
						y1: padding,
						w: this.container.offsetWidth - padding * 2,
						h: this.container.offsetHeight - padding * 2
					};
					const layoutOptions = getLayoutOptions(bbox);

					this.cy = cytoscape({
						container: this.container,
						elements,
						style: CYTOSCAPE_STYLE as unknown as cytoscape.StylesheetStyle[],
						layout: layoutOptions,
						userZoomingEnabled: false,
						userPanningEnabled: false,
						boxSelectionEnabled: false,
						autoungrabify: true
					});

					// After layout, set zoom to 1 and center
					setTimeout(() => {
						if (this.cy) {
							this.cy.zoom(1);
							this.cy.center();
						}
					}, 100);

					this.setupEventHandlers();
				} catch (e) {
					console.error('ConceptMap: error creating cytoscape', e);
				}
			}, 50);
		}
	}

	private convertToElements(data: ConceptMapData): ElementDefinition[] {
		const nodes: ElementDefinition[] = data.nodes.map(node => ({
			group: 'nodes',
			data: {
				id: node.id,
				label: node.label,
				isLink: node.isLink,
				linkTarget: node.linkTarget,
				isEdgeLabel: node.isEdgeLabel ?? false
			}
		}));

		const edges: ElementDefinition[] = data.edges.map(edge => ({
			group: 'edges',
			data: {
				id: edge.id,
				source: edge.source,
				target: edge.target
			}
		}));

		return [...nodes, ...edges];
	}

	private setupEventHandlers(): void {
		if (!this.cy) return;

		// Handle click on linked nodes
		this.cy.on('tap', 'node[?isLink]', (evt) => {
			const node = evt.target as cytoscape.NodeSingular;
			const linkTarget = node.data('linkTarget') as string | undefined;
			if (linkTarget) {
				void this.app.workspace.openLinkText(linkTarget, this.sourcePath);
			}
		});

		// Add hover cursor for linked nodes
		this.cy.on('mouseover', 'node[?isLink]', () => {
			this.container.addClass('concept-map-link-hover');
		});

		this.cy.on('mouseout', 'node[?isLink]', () => {
			this.container.removeClass('concept-map-link-hover');
		});
	}

	destroy(): void {
		if (this.cy) {
			this.cy.destroy();
			this.cy = null;
		}
	}
}
