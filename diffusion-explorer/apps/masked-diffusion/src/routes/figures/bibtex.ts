// Minimal BibTeX parser + formatter for the blog's References section.
//
// Only handles the entry shapes actually used on this site (@misc, @article,
// @inproceedings). Understands brace-quoted values and simple author lists
// separated by " and ".

export interface BibEntry {
	type: string;
	key: string;
	fields: Record<string, string>;
}

/** Parse a raw .bib document into a list of entries in file order. */
export function parseBibtex(source: string): BibEntry[] {
	const entries: BibEntry[] = [];
	let i = 0;
	while (i < source.length) {
		// Advance to next @
		while (i < source.length && source[i] !== '@') i++;
		if (i >= source.length) break;
		i++; // skip @
		// Type up to '{'
		const typeStart = i;
		while (i < source.length && source[i] !== '{') i++;
		const type = source.slice(typeStart, i).trim().toLowerCase();
		if (i >= source.length) break;
		i++; // skip '{'
		// Key up to ','
		const keyStart = i;
		while (i < source.length && source[i] !== ',') i++;
		const key = source.slice(keyStart, i).trim();
		if (i >= source.length) break;
		i++; // skip ','
		// Fields until the matching closing '}' at brace-depth 0.
		const fields: Record<string, string> = {};
		let depth = 1;
		while (i < source.length && depth > 0) {
			// Skip whitespace / trailing commas
			while (i < source.length && /[\s,]/.test(source[i])) i++;
			if (i >= source.length) break;
			if (source[i] === '}') {
				depth--;
				i++;
				break;
			}
			// Read field name up to '='
			const nameStart = i;
			while (i < source.length && source[i] !== '=' && source[i] !== '}') i++;
			if (i >= source.length || source[i] === '}') break;
			const name = source.slice(nameStart, i).trim().toLowerCase();
			i++; // skip '='
			while (i < source.length && /\s/.test(source[i])) i++;
			// Value: either {…balanced braces…} or "…quoted…" or bare-number.
			let value = '';
			if (source[i] === '{') {
				let d = 1;
				i++;
				const valStart = i;
				while (i < source.length && d > 0) {
					if (source[i] === '{') d++;
					else if (source[i] === '}') {
						d--;
						if (d === 0) break;
					}
					i++;
				}
				value = source.slice(valStart, i);
				if (source[i] === '}') i++;
			} else if (source[i] === '"') {
				i++;
				const valStart = i;
				while (i < source.length && source[i] !== '"') i++;
				value = source.slice(valStart, i);
				if (source[i] === '"') i++;
			} else {
				const valStart = i;
				while (i < source.length && !/[,}\s]/.test(source[i])) i++;
				value = source.slice(valStart, i);
			}
			fields[name] = value.trim();
		}
		entries.push({ type, key, fields });
	}
	return entries;
}

/**
 * Split a BibTeX author field ("A and B and C") into names. Handles
 * "Last, First" and "First Last" both; we don't reformat, just split.
 */
export function splitAuthors(authorField: string): string[] {
	return authorField
		.split(/\s+and\s+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/** A safely-derived link URL for an entry (prefers `url`, falls back to arXiv). */
export function entryUrl(entry: BibEntry): string | null {
	if (entry.fields.url) return entry.fields.url;
	if (entry.fields.doi) return `https://doi.org/${entry.fields.doi}`;
	if (entry.fields.eprint && entry.fields.archiveprefix?.toLowerCase() === 'arxiv') {
		return `https://arxiv.org/abs/${entry.fields.eprint}`;
	}
	return null;
}
