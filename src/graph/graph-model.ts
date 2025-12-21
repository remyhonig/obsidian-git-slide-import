import type { Statement } from '../parser/types';

export interface GraphNode {
	id: string;
	label: string;
	isLink: boolean;
	linkTarget: string | null;
	isEdgeLabel?: boolean;
}

export interface GraphEdge {
	id: string;
	source: string;
	target: string;
}

export interface ConceptMapData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export function buildGraphData(statements: Statement[]): ConceptMapData {
	const nodeMap = new Map<string, GraphNode>();
	const edges: GraphEdge[] = [];

	// Track edge labels between same source-target pairs
	const edgeLabelMap = new Map<string, { nodeId: string; labels: string[] }>();

	statements.forEach((stmt, index) => {
		// Add subject node if not exists
		if (!nodeMap.has(stmt.subject.id)) {
			nodeMap.set(stmt.subject.id, {
				id: stmt.subject.id,
				label: stmt.subject.label,
				isLink: stmt.subject.isLink,
				linkTarget: stmt.subject.linkTarget
			});
		}

		// Add object node if not exists
		if (!nodeMap.has(stmt.object.id)) {
			nodeMap.set(stmt.object.id, {
				id: stmt.object.id,
				label: stmt.object.label,
				isLink: stmt.object.isLink,
				linkTarget: stmt.object.linkTarget
			});
		}

		// Create unique key for source-target pair
		const pairKey = `${stmt.subject.id}|${stmt.object.id}`;
		const existingLabelNode = edgeLabelMap.get(pairKey);

		if (existingLabelNode) {
			// Append verb to existing label node
			existingLabelNode.labels.push(stmt.verb);
			const node = nodeMap.get(existingLabelNode.nodeId);
			if (node) {
				node.label = existingLabelNode.labels.join('\n');
			}
		} else {
			// Create edge label as a node
			const labelNodeId = `label-${index}`;
			nodeMap.set(labelNodeId, {
				id: labelNodeId,
				label: stmt.verb,
				isLink: false,
				linkTarget: null,
				isEdgeLabel: true
			});

			edgeLabelMap.set(pairKey, { nodeId: labelNodeId, labels: [stmt.verb] });

			// Create two edges: source -> label -> target
			edges.push({
				id: `edge-${index}-a`,
				source: stmt.subject.id,
				target: labelNodeId
			});
			edges.push({
				id: `edge-${index}-b`,
				source: labelNodeId,
				target: stmt.object.id
			});
		}
	});

	return {
		nodes: Array.from(nodeMap.values()),
		edges
	};
}
