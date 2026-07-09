<script lang="ts">
	import '@diffusion-explorer/ui/styles/base.css';
	import '@diffusion-explorer/ui/styles/layout.css';
	import '../app.css';
	import { TopNav, PageContainer, TableOfContents } from '@diffusion-explorer/ui';

	let { children } = $props();
</script>

<svelte:head>
	<title>A Visual Introduction to Masked Diffusion Language Models</title>
</svelte:head>

<TopNav
	leftLink={{ href: 'https://alechelbling.com/blog.html', text: 'Other Blogs' }}
	rightLink={{
		href: 'https://github.com/helblazer811/Diffusion-Explorer',
		text: 'Link to Code',
		icon: 'github'
	}}
/>

<TableOfContents />

<PageContainer>
	{@render children()}
</PageContainer>
