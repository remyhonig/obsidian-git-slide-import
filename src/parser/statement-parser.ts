import type { ParsedNode, ParseResult, Statement } from './types';

const STATEMENT_PATTERN = /^(.+?)\s*->\s*(.+?)\s*->\s*(.+?)$/;
const LINK_PATTERN = /^\[\[(.+?)\]\]$/;

function normalizeId(text: string): string {
	return text.toLowerCase().replace(/\s+/g, '-');
}

function parseNode(text: string): ParsedNode {
	const trimmed = text.trim();
	const linkMatch = trimmed.match(LINK_PATTERN);

	if (linkMatch && linkMatch[1]) {
		const linkTarget = linkMatch[1];
		return {
			id: normalizeId(linkTarget),
			label: linkTarget,
			isLink: true,
			linkTarget
		};
	}

	return {
		id: normalizeId(trimmed),
		label: trimmed,
		isLink: false,
		linkTarget: null
	};
}

export function parseStatements(source: string): ParseResult {
	const lines = source.split('\n');
	const statements: Statement[] = [];
	const errors: ParseResult['errors'] = [];

	lines.forEach((line, index) => {
		const trimmed = line.trim();

		// Skip empty lines and comments
		if (!trimmed || trimmed.startsWith('//')) {
			return;
		}

		const match = trimmed.match(STATEMENT_PATTERN);
		if (!match || !match[1] || !match[2] || !match[3]) {
			errors.push({
				line: index + 1,
				message: 'Invalid statement syntax. Expected: Subject -> verb -> Object',
				rawLine: line
			});
			return;
		}

		const subjectRaw = match[1];
		const verb = match[2];
		const objectRaw = match[3];
		statements.push({
			subject: parseNode(subjectRaw),
			verb: verb.trim(),
			object: parseNode(objectRaw),
			lineNumber: index + 1
		});
	});

	return { statements, errors };
}
