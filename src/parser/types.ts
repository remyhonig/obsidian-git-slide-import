export interface ParsedNode {
	id: string;
	label: string;
	isLink: boolean;
	linkTarget: string | null;
}

export interface Statement {
	subject: ParsedNode;
	verb: string;
	object: ParsedNode;
	lineNumber: number;
}

export interface ParseError {
	line: number;
	message: string;
	rawLine: string;
}

export interface ParseResult {
	statements: Statement[];
	errors: ParseError[];
}
