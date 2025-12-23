<script lang="ts">
  import type { BibEntry, CitationInfo } from '$lib/citations';

  // Props
  export let citations: CitationInfo[] = [];
  export let bibEntries: Map<string, BibEntry> | null = null;

  /**
   * Format author string from BibTeX format (Last, First and Last, First)
   * to a more readable format (F. Last, F. Last, ...)
   */
  function formatAuthors(authorStr) {
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
</script>

{#if citations.length > 0 && bibEntries}
  <ol class="bibliography-list">
    {#each citations as citation}
      {@const entry = bibEntries.get(citation.id)}
      {#if entry}
        <li id="bib-{citation.id}">
          {formatAuthors(entry.author)} ({entry.year}).
          <em>{entry.title}</em>.
          {#if entry.journal}
            {entry.journal}.
          {:else if entry.booktitle}
            {entry.booktitle}.
          {/if}
        </li>
      {/if}
    {/each}
  </ol>
{/if}

<style>
  .bibliography-list {
    padding-left: 1.5rem;
    font-size: 1rem;
    line-height: 1.6;
  }

  .bibliography-list li {
    margin-bottom: 1rem;
  }

  .bibliography-list li:target {
    background-color: #fffbcc;
    padding: 0.25rem 0.5rem;
    margin-left: -0.5rem;
    border-radius: 4px;
    transition: background-color 0.3s ease;
  }
</style>
