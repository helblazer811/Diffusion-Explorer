<script lang="ts">
	interface Author {
		name: string;
		link?: string;
		mark?: string;
	}

	interface Props {
		title: string;
		subtitle?: string;
		author?: string;
		authorLink?: string;
		authors?: Author[];
		note?: string;
		date?: string;
	}

	let { title, subtitle, author, authorLink, authors, note, date }: Props = $props();
</script>

<header class="title-header-wrapper">
	<h1 class="article-title">{title}</h1>
	{#if subtitle}
		<p class="article-subtitle">{subtitle}</p>
	{/if}
	{#if author || authors?.length || date}
		<div class="byline-dateline-container">
			{#if authors?.length}
				<p class="byline">
					By {#each authors as a, i}{#if a.link}<a
								href={a.link}
								target="_blank"
								rel="noopener noreferrer">{a.name}</a
							>{:else}{a.name}{/if}{#if a.mark}<sup>{a.mark}</sup>{/if}{#if i < authors.length - 1}{', '}{/if}{/each}
				</p>
			{:else if author}
				<p class="byline">
					By {#if authorLink}<a href={authorLink}>{author}</a>{:else}{author}{/if}
				</p>
			{/if}
			{#if date}
				<p class="dateline">{date}</p>
			{/if}
		</div>
	{/if}
	{#if note}
		<p class="author-note">{note}</p>
	{/if}
</header>
