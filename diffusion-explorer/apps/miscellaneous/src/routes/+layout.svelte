<script lang="ts">
	import '@diffusion-explorer/ui/styles/base.css';
	import '@diffusion-explorer/ui/styles/layout.css';
	import '../app.css';
	import { TopNav, PageContainer } from '@diffusion-explorer/ui';
	import { page } from '$app/state';

	let { children } = $props();

	// Routes that opt out of the constrained PageContainer + body padding.
	const fullBleedPrefixes = ['/helmholtz_decomposition'];
	let fullBleed = $derived(
		fullBleedPrefixes.some((p) => page.url.pathname.startsWith(p))
	);
</script>

<svelte:head>
	<title>Miscellaneous</title>
	{#if fullBleed}
		<style>
			body { padding: 0 !important; margin: 0 !important; }
		</style>
	{/if}
</svelte:head>

<TopNav
	leftLink={{ href: 'https://alechelbling.com/blog.html', text: 'Other Blogs' }}
	rightLink={{
		href: 'https://github.com/helblazer811/Diffusion-Explorer',
		text: 'Link to Code',
		icon: 'github'
	}}
/>

{#if fullBleed}
	{@render children()}
{:else}
	<PageContainer>
		{@render children()}
	</PageContainer>
{/if}
