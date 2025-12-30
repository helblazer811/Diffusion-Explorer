<script lang="ts">
  import type { BibEntry, CitationInfo } from '$lib/citations';
  import { formatAuthors } from '$lib/citations';

  // Required props
  export let id: string;
  export let bibEntries: Map<string, BibEntry> | null = null;
  export let citations: CitationInfo[] = [];

  // Internal state
  let spanElement: HTMLSpanElement;
  let showTooltip = false;
  let positionAbove = true;
  let horizontalAlign: 'left' | 'center' | 'right' = 'center';
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  // Derived values
  $: entry = bibEntries?.get(id) ?? null;
  $: number = citations.find(c => c.id === id)?.number ?? null;

  function handleMouseEnter() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    if (!entry) return;
    const rect = spanElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Vertical positioning
    positionAbove = rect.bottom > viewportHeight * 0.7;

    // Horizontal positioning
    if (rect.left < 150) {
      horizontalAlign = 'left';
    } else if (rect.right > viewportWidth - 150) {
      horizontalAlign = 'right';
    } else {
      horizontalAlign = 'center';
    }

    showTooltip = true;
  }

  function handleMouseLeave() {
    hideTimeout = setTimeout(() => {
      showTooltip = false;
    }, 150);
  }
</script>

<span
  class="hoverable-reference"
  data-cite={id}
  bind:this={spanElement}
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
  role="note"
  aria-label="Reference {number}: {entry?.title ?? 'Unknown reference'}"
>
  [{number ?? '?'}]
  {#if showTooltip && entry}
    <div
      class="tooltip"
      class:above={positionAbove}
      class:below={!positionAbove}
      class:align-left={horizontalAlign === 'left'}
      class:align-center={horizontalAlign === 'center'}
      class:align-right={horizontalAlign === 'right'}
      role="tooltip"
      on:mouseenter={handleMouseEnter}
      on:mouseleave={handleMouseLeave}
    >
      <div class="tooltip-title">{entry.title}</div>
      <div class="tooltip-authors">{formatAuthors(entry.author)}</div>
      <div class="tooltip-year">{entry.year}</div>
      {#if entry.url}
        <a href={entry.url} target="_blank" rel="noopener noreferrer" class="tooltip-link">
          View paper
        </a>
      {/if}
    </div>
  {/if}
</span>

<style>
  .hoverable-reference {
    position: relative;
    display: inline;
    color: rgb(0, 100, 200);
    cursor: default;
  }

  .tooltip {
    position: absolute;
    width: max-content;
    max-width: 300px;
    padding: 0.75rem 1rem;
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    z-index: 1000;
    text-align: left;
    line-height: 1.4;
  }

  .tooltip.align-center {
    left: 50%;
    transform: translateX(-50%);
  }

  .tooltip.align-left {
    left: 0;
    transform: none;
  }

  .tooltip.align-right {
    left: auto;
    right: 0;
    transform: none;
  }

  .tooltip.above {
    bottom: 100%;
    margin-bottom: 8px;
  }

  .tooltip.below {
    top: 100%;
    margin-top: 8px;
  }

  .tooltip-title {
    font-weight: 600;
    font-size: 0.95rem;
    color: #333;
    margin-bottom: 0.25rem;
  }

  .tooltip-authors {
    font-size: 0.9rem;
    color: #555;
    margin-bottom: 0.25rem;
  }

  .tooltip-year {
    font-size: 0.85rem;
    color: #777;
  }

  .tooltip-link {
    display: block;
    font-size: 0.85rem;
    color: rgb(0, 100, 200);
    text-decoration: none;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e0e0e0;
  }

  .tooltip-link:hover {
    text-decoration: underline;
  }

  @media (max-width: 600px) {
    .tooltip {
      max-width: 250px;
      padding: 0.5rem 0.75rem;
      font-size: 0.9rem;
    }

    .tooltip-title {
      font-size: 0.9rem;
    }

    .tooltip-authors,
    .tooltip-year {
      font-size: 0.85rem;
    }
  }
</style>
