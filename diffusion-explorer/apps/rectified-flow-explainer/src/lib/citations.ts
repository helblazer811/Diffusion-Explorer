export interface BibEntry {
  id: string;
  type: string;
  title: string;
  author: string;
  year: string;
  journal?: string;
  booktitle?: string;
  url?: string;
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
      booktitle: fields.booktitle,
      url: fields.url
    });
  }

  return entries;
}

/**
 * Load and parse the bibliography.bib file
 * @param bibPath - Full path to the bibliography file (should include base path)
 */
export async function loadBibliography(bibPath: string): Promise<Map<string, BibEntry>> {
  const response = await fetch(bibPath);
  const content = await response.text();
  return parseBibTeX(content);
}

/**
 * Collect citations from the page after mount.
 * Finds all span.citation[data-cite] and span.hoverable-reference[data-cite] elements,
 * assigns numbers in order of appearance.
 * For regular citations: updates text content and adds click handlers.
 * For hoverable references: just collects IDs for numbering (component handles display).
 */
export function collectCitations(): CitationInfo[] {
  const spans = document.querySelectorAll('span.citation[data-cite], span.hoverable-reference[data-cite]');
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

    const num = seen.get(id)!;
    const isHoverable = span.classList.contains('hoverable-reference');

    // Only modify regular citations (hoverable references handle their own display)
    if (!isHoverable) {
      // Update span text to show citation number
      span.textContent = `[${num}]`;
      span.setAttribute('data-number', String(num));

      // Add click handler to scroll to bibliography entry
      span.addEventListener('click', () => {
        const bibEntry = document.getElementById(`bib-${id}`);
        bibEntry?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  });

  return citations;
}

/**
 * Format author string from BibTeX format (Last, First and Last, First)
 * to a more readable format (F. Last, F. Last, ...)
 */
export function formatAuthors(authorStr: string): string {
  if (!authorStr) return '';

  // Split by " and " to get individual authors
  const authors = authorStr.split(' and ').map(author => author.trim());

  return authors.map(author => {
    // Handle "Last, First" format
    if (author.includes(',')) {
      const [last, first] = author.split(',').map(s => s.trim());
      // Get first initial(s)
      const initials = first.split(' ')
        .map(name => name.charAt(0) + '.')
        .join(' ');
      return `${initials} ${last}`;
    }
    // Handle "First Last" format
    const parts = author.split(' ');
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const firstNames = parts.slice(0, -1);
      const initials = firstNames.map(name => name.charAt(0) + '.').join(' ');
      return `${initials} ${last}`;
    }
    return author;
  }).join(', ');
}
