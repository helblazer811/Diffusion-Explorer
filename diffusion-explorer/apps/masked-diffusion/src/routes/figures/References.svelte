<script lang="ts">
	// Fetches a static .bib file and renders each entry as a formatted line
	// (authors, year, title with a link). Loads on mount; renders an empty
	// placeholder before the fetch completes so SSR is stable.

	import { onMount } from 'svelte';
	import {
		parseBibtex,
		splitAuthors,
		entryUrl,
		type BibEntry
	} from './bibtex';

	interface Props {
		/** Public URL of the .bib file. */
		src?: string;
	}

	let { src = '/references.bib' }: Props = $props();

	let entries = $state<BibEntry[]>([]);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			const r = await fetch(src);
			if (!r.ok) throw new Error(`fetch ${src}: ${r.status}`);
			const text = await r.text();
			entries = parseBibtex(text);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	});

	function formatAuthors(authors: string[]): string {
		if (authors.length === 0) return '';
		if (authors.length === 1) return authors[0];
		if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
		return `${authors.slice(0, -1).join(', ')}, and ${authors[authors.length - 1]}`;
	}
</script>

{#if error}
	<p class="ref-error">Failed to load references: {error}</p>
{:else if entries.length === 0}
	<p class="ref-empty">&nbsp;</p>
{:else}
	<ol class="ref-list">
		{#each entries as entry (entry.key)}
			{@const authors = splitAuthors(entry.fields.author ?? '')}
			{@const url = entryUrl(entry)}
			<li id={entry.key}>
				<span class="ref-authors">{formatAuthors(authors)}</span>{#if entry.fields.year},
					<span class="ref-year">{entry.fields.year}</span>{/if}. {#if url}<a
						class="ref-title"
						href={url}
						target="_blank"
						rel="noreferrer noopener">{entry.fields.title}</a
					>{:else}<span class="ref-title">{entry.fields.title}</span>{/if}{#if entry.fields.journal}.
					<em>{entry.fields.journal}</em>{:else if entry.fields.booktitle}.
					<em>{entry.fields.booktitle}</em>{:else if entry.fields.eprint && entry.fields.archiveprefix?.toLowerCase() === 'arxiv'}.
					<em>arXiv:{entry.fields.eprint}</em>{/if}.
			</li>
		{/each}
	</ol>
{/if}

<style>
	.ref-list {
		list-style: decimal;
		padding-left: 1.5rem;
		margin: 0.5rem 0;
	}
	.ref-list li {
		margin-bottom: 0.7rem;
		line-height: 1.55;
	}
	.ref-authors {
		font-weight: 500;
	}
	.ref-title {
		color: rgb(0, 100, 200);
		text-decoration: none;
	}
	a.ref-title:hover {
		text-decoration: underline;
	}
	.ref-error {
		color: #a33;
		font-style: italic;
	}
	.ref-empty {
		color: #888;
	}
</style>
