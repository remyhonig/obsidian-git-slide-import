declare module 'cytoscape-fcose' {
	import { Core, CytoscapeOptions } from 'cytoscape';

	const fcose: (cytoscape: typeof import('cytoscape')) => void;
	export default fcose;
}
