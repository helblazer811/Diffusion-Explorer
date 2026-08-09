<script lang="ts">
	// Talk-figures blog: a scrollable page where each slide-worth of content
	// is a clearly separated section. Author them here, screen-record, paste
	// into PowerPoint.
	import '@diffusion-explorer/ui/styles/base.css';
	import '@diffusion-explorer/ui/styles/layout.css';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Talk Figures — Flow Reasoning Models</title>
</svelte:head>

<main class="page">
	{@render children()}
</main>

<style>
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 3rem 1.5rem 6rem;
	}
</style>
