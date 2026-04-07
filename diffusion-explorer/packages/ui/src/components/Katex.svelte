<script>
	import katex from "katex";
	export let math;
	export let displayMode = false;
	export let displayFontSize = "1.5em";
	export let color = null;

	const options = {
		displayMode: displayMode,
		throwOnError: true,
		trust: true
	}

	$: katexString = katex.renderToString(math, options);
	$: colorStyle = color ? `color: ${color};` : '';
</script>

<svelte:head>
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.12.0/dist/katex.min.css" integrity="sha384-AfEj0r4/OFrOo5t7NnNe46zW/tFgW6x/bCJG8FqQCEo3+Aro6EYUG4+cU+KJWu/X" crossorigin="anonymous">
</svelte:head>

{#if displayMode}
	<span class="katex-display-wrapper" style="font-size: {displayFontSize}; {colorStyle}">
		{@html katexString}
	</span>
{:else}
	<span style={colorStyle}>{@html katexString}</span>
{/if}

<style>
	.katex-display-wrapper {
		display: block;
		width: 100%;
		max-width: 100%;
		overflow: hidden;
	}

	.katex-display-wrapper :global(.katex-display) {
		margin: 0;
		overflow: hidden !important;
	}

	@media (max-width: 600px) {
		.katex-display-wrapper {
			font-size: 1.2em !important;
		}
	}

	@media (max-width: 400px) {
		.katex-display-wrapper {
			font-size: 1em !important;
		}
	}
</style>
