<script lang="ts">
	import 'reveal.js/dist/reveal.css';
	import 'reveal.js/dist/theme/white.css';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Qualifier Slides</title>
</svelte:head>

{@render children()}
