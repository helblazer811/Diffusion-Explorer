export interface BibEntry {
  id: string;
  type: string;
  title: string;
  author: string;
  year: string;
  journal?: string;
  booktitle?: string;
}

export interface CitationInfo {
  id: string;
  number: number;
}

/**
 * Parse BibTeX content into a map of entries
 */
export function parseBibTeX(content: string): Map<string, BibEntry> {
  const entries = new Map<string, BibEntry>();

  // Match @type{id, followed by the entry content
  const entryRegex = /@(\w+)\s*\{\s*([^,]+)\s*,([^@]*)\}/g;

  let match;
  while ((match = entryRegex.exec(content)) !== null) {
    const type = match[1].toLowerCase();
    const id = match[2].trim();
    const fieldsContent = match[3];

    // Parse individual fields
    const fields: Record<string, string> = {};
    const fieldRegex = /(\w+)\s*=\s*\{([^}]*)\}/g;

    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(fieldsContent)) !== null) {
      const fieldName = fieldMatch[1].toLowerCase();
      const fieldValue = fieldMatch[2].trim();
      fields[fieldName] = fieldValue;
    }

    entries.set(id, {
      id,
      type,
      title: fields.title || '',
      author: fields.author || '',
      year: fields.year || '',
      journal: fields.journal,
      booktitle: fields.booktitle
    });
  }

  return entries;
}

/**
 * Load and parse the bibliography.bib file
 */
export async function loadBibliography(): Promise<Map<string, BibEntry>> {
  const response = await fetch('/bibliography.bib');
  const content = await response.text();
  return parseBibTeX(content);
}

/**
 * Collect citations from the page after mount.
 * Finds all span.citation[data-cite] elements, assigns numbers in order of appearance,
 * updates their text content, and adds click handlers.
 */
export function collectCitations(): CitationInfo[] {
  const spans = document.querySelectorAll('span.citation[data-cite]');
  const seen = new Map<string, number>();
  const citations: CitationInfo[] = [];
  let counter = 1;

  spans.forEach(span => {
    const id = span.getAttribute('data-cite');
    if (!id) return;

    // If this is a new citation, add it to the list
    if (!seen.has(id)) {
      seen.set(id, counter);
      citations.push({ id, number: counter });
      counter++;
    }

    // Update span text to show citation number
    const num = seen.get(id)!;
    span.textContent = `[${num}]`;
    span.setAttribute('data-number', String(num));

    // Add click handler to scroll to bibliography entry
    span.addEventListener('click', () => {
      const bibEntry = document.getElementById(`bib-${id}`);
      bibEntry?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  return citations;
}
