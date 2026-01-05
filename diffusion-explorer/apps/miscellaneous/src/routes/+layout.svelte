<script lang="ts">
	import '@diffusion-explorer/ui/styles/base.css';
	import '@diffusion-explorer/ui/styles/layout.css';
	import '../app.css';
	import { TopNav, PageContainer } from '@diffusion-explorer/ui';

	let { children } = $props();
</script>

<svelte:head>
	<title>Miscellaneous</title>
</svelte:head>

<TopNav
	leftLink={{ href: 'https://alechelbling.com/blog.html', text: 'Other Blogs' }}
	rightLink={{
		href: 'https://github.com/helblazer811/Diffusion-Explorer',
		text: 'Link to Code',
		icon: 'github'
	}}
/>

<PageContainer>
	{@render children()}
</PageContainer>
