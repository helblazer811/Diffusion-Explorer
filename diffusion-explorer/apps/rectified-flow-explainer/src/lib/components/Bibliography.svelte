<script lang="ts">
  import type { BibEntry, CitationInfo } from '$lib/citations';
  import { formatAuthors } from '$lib/citations';

  // Props
  export let citations: CitationInfo[] = [];
  export let bibEntries: Map<string, BibEntry> | null = null;
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
          {#if entry.url}
            <a href={entry.url} target="_blank" rel="noopener noreferrer" class="bib-link">[Link]</a>
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

  .bib-link {
    color: rgb(0, 100, 200);
    text-decoration: none;
    margin-left: 0.25rem;
  }

  .bib-link:hover {
    text-decoration: underline;
  }
</style>
