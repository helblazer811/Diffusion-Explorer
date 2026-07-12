<script lang="ts">
	import { ArticleHeader, Figure } from '@diffusion-explorer/ui';
	import { writable } from 'svelte/store';
	import DFlashFigure from './DFlashFigure.svelte';

	const figureActive = writable(false);
</script>

<ArticleHeader
	title="DFlash: Speculative Decoding with a Block Diffusion Drafter"
	subtitle="A block-diffusion drafter accelerates an autoregressive LLM"
	author="Alec Helbling"
	authorLink="https://alechelbling.com"
/>

<p>
	Autoregressive decoding is sequential: each new token needs the ones
	before it, so latency grows linearly with output length. Speculative
	decoding chips away at this by running a cheap <em>drafter</em> that
	proposes γ tokens ahead of time, then having a large <em>verifier</em>
	check the whole block in a single parallel pass. Historically, drafters
	are also autoregressive, so per-block draft time still scales linearly
	in γ.
</p>

<p>
	<a href="https://arxiv.org/abs/2602.06036">DFlash</a> replaces the AR
	drafter with a lightweight block-diffusion model: one forward pass
	denoises the entire masked block in parallel, making draft cost roughly
	constant in γ. That budget saving is what lets the drafter be deeper
	than a typical AR drafter (five layers vs. EAGLE-3's one) without giving
	up wall-clock. The other twist is what conditions the drafter. During
	the target's prefill pass over the prompt, DFlash taps hidden states
	from a handful of target layers, fuses them into a compact
	<em>target features</em> tensor, and injects that tensor into every
	drafter layer's K/V &mdash; the drafter is a diffusion adapter that
	attends to the target's own representations rather than re-encoding the
	prompt itself.
</p>

<Figure backgroundVisible={false} isActive={figureActive}>
	{#snippet children()}
		<DFlashFigure isActive={figureActive} />
	{/snippet}
	{#snippet caption()}
		<strong>DFlash speculative decoding.</strong> The autoregressive
		target (right) runs its prefill pass on the prompt; hidden features
		from a subset of its layers are cached in the middle column. A small
		block-diffusion drafter (left) then runs its forward pass, reading
		those features into each of its layers' K/V, and produces all γ
		draft tokens in parallel. The block is sent back to the target for
		verification &mdash; the first two positions match and are accepted
		(green), the third disagrees and is rejected (red), so the remainder
		of the block is rolled back to a masked state.
	{/snippet}
</Figure>

<p>
	Block diffusion, an idea developed inside the masked-diffusion
	literature, folds back into autoregressive inference here as a fast
	drafter. There's more to say about drafter/verifier trade-offs, the KV
	injection wiring, and how the drafter is trained end-to-end &mdash; the
	<a href="https://arxiv.org/abs/2602.06036">DFlash paper</a> is the
	place to start.
</p>
