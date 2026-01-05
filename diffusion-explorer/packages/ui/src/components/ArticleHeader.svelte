<script lang="ts">
	interface Props {
		title: string;
		subtitle?: string;
		author?: string;
		authorLink?: string;
		date?: string;
	}

	let { title, subtitle, author, authorLink, date }: Props = $props();
</script>

<header class="title-header-wrapper">
	<h1 class="article-title">{title}</h1>
	{#if subtitle}
		<p class="article-subtitle">{subtitle}</p>
	{/if}
	{#if author || date}
		<div class="byline-dateline-container">
			{#if author}
				<p class="byline">
					By {#if authorLink}<a href={authorLink}>{author}</a>{:else}{author}{/if}
				</p>
			{/if}
			{#if date}
				<p class="dateline">{date}</p>
			{/if}
		</div>
	{/if}
</header>
