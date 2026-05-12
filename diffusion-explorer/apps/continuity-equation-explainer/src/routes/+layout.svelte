<script lang="ts">
	import '@diffusion-explorer/ui/styles/base.css';
	import '@diffusion-explorer/ui/styles/layout.css';
	import '../app.css';
	import { TableOfContents, TopNav, PageContainer } from '@diffusion-explorer/ui';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>The Continuity Equation</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<TopNav
	leftLink={{ href: 'https://alechelbling.com/blog.html', text: 'Other Blogs' }}
	rightLink={{
		href: 'https://github.com/helblazer811/Diffusion-Explorer',
		text: 'Link to Code',
		icon: 'github'
	}}
/>

<TableOfContents dividerIds={['acknowledgements-heading']} />

<PageContainer>
	{@render children()}
</PageContainer>
