<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let revealInstance: any = null;
	let deckEl: HTMLElement;

	onMount(async () => {
		const Reveal = (await import('reveal.js')).default;
		const RevealNotes = (await import('reveal.js/plugin/notes/notes')).default;

		revealInstance = new Reveal(deckEl, {
			hash: true,
			slideNumber: true,
			controls: true,
			progress: true,
			center: true,
			transition: 'slide',
			width: 1920,
			height: 1080,
			plugins: [RevealNotes],
		});

		await revealInstance.initialize();
	});

	onDestroy(() => {
		revealInstance?.destroy();
	});
</script>

<div class="reveal" bind:this={deckEl}>
	<div class="slides">
		<!-- Title Slide -->
		<section>
			<h1>Qualifier Presentation</h1>
			<p>Interactive figures powered by Diffusion Explorer</p>
		</section>

		<!-- Example: Embedding a figure -->
		<section>
			<h2>Embedded Figure Example</h2>
			<div class="figure-container">
				<p style="color: #888;">
					Import a figure component here, e.g.:<br/>
					<code>import MyFigure from '$rectified-flow/figures/MyFigure.svelte';</code>
				</p>
			</div>
		</section>

		<!-- Example: Vertical slides (sub-sections) -->
		<section>
			<section>
				<h2>Vertical Slide 1</h2>
				<p>Use vertical slides for drilling into a topic</p>
			</section>
			<section>
				<h2>Vertical Slide 2</h2>
				<p>Press down arrow to navigate</p>
			</section>
		</section>

		<!-- Closing slide -->
		<section>
			<h2>Thank You</h2>
		</section>
	</div>
</div>

<style>
	.reveal {
		height: 100vh;
		width: 100vw;
	}
</style>
