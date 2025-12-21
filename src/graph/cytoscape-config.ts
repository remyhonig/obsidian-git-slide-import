// Style configuration for concept map nodes and edges
// Styled to match classic concept map appearance (cream nodes, black borders)

export const CYTOSCAPE_STYLE = [
	// Concept nodes (yellow boxes)
	{
		selector: 'node',
		style: {
			'label': 'data(label)',
			'text-valign': 'center',
			'text-halign': 'center',
			'background-color': '#ffffcc',
			'border-color': '#000000',
			'border-width': 1,
			'color': '#000000',
			'font-size': 14,
			'font-family': 'Arial, sans-serif',
			'shape': 'roundrectangle',
			'text-wrap': 'none',
			'padding': 8,
			'width': (node: cytoscape.NodeSingular) => {
				const label = node.data('label') || '';
				return Math.max(50, label.length * 9 + 16);
			},
			'height': 30
		}
	},
	// Linked concept nodes (blue border)
	{
		selector: 'node[?isLink]',
		style: {
			'border-color': '#0066cc',
			'border-width': 2
		}
	},
	// Edge label nodes (no box, just text)
	{
		selector: 'node[?isEdgeLabel]',
		style: {
			'background-color': '#f5f5dc',
			'background-opacity': 1,
			'border-width': 0,
			'font-size': 12,
			'padding': 2,
			'width': (node: cytoscape.NodeSingular) => {
				const label = node.data('label') || '';
				return Math.max(30, label.length * 7 + 6);
			},
			'height': 16,
			'shape': 'rectangle'
		}
	},
	// Edges - no arrows on edges going to label nodes
	{
		selector: 'edge',
		style: {
			'width': 1,
			'line-color': '#000000',
			'target-arrow-color': '#000000',
			'target-arrow-shape': 'none',
			'curve-style': 'bezier'
		}
	},
	// Only show arrow on edges from label nodes to targets
	{
		selector: 'edge[source ^= "label-"]',
		style: {
			'target-arrow-shape': 'triangle',
			'arrow-scale': 1
		}
	}
];

export interface LayoutOptions {
	name: string;
	fit: boolean;
	padding: number;
	[key: string]: unknown;
}

export function getLayoutOptions(boundingBox?: { x1: number; y1: number; w: number; h: number }): LayoutOptions {
	return {
		name: 'cose',
		fit: false,
		padding: 40,
		animate: false,
		randomize: true,
		componentSpacing: 40,
		nodeOverlap: 10,
		nodeRepulsion: 2000,
		idealEdgeLength: 50,
		nestingFactor: 1.2,
		gravity: 1,
		numIter: 2000,
		boundingBox: boundingBox
	};
}
