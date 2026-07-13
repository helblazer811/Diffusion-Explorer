<script lang="ts">
	import { ArticleHeader, Figure } from '@diffusion-explorer/ui';
	import { writable } from 'svelte/store';
	import IndependentFactorizationFigure from './IndependentFactorizationFigure.svelte';

	const MASK_COLOR = '#cfe0f2';
	const MASK_TEXT_COLOR = '#33506e';

	const figureActive = writable(false);
</script>

<ArticleHeader
	title="Remasking"
	subtitle="How independent-per-position sampling breaks joint constraints, and remasking recovers them"
	author="Alec Helbling"
	authorLink="https://alechelbling.com"
/>

<p>
	Because a masked diffusion model factorizes its reverse step across
	positions, each masked slot receives an independent categorical
	distribution &mdash; the sampler draws each token <em>without conditioning
	on its neighbors' draws</em>. When the correct completion has a joint
	constraint that ties two masked positions together, that constraint is
	invisible to the per-position sampler, so a single reverse pass can
	produce a nonsensical output.
</p>

<Figure backgroundVisible={false} isActive={figureActive}>
	{#snippet children()}
		<IndependentFactorizationFigure
			isActive={figureActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
		/>
	{/snippet}
	{#snippet caption()}
		<strong>Independent factorization breaks joint constraints, and
		remasking recovers them.</strong> Phase <strong>A</strong>: the
		transformer emits an independent 50/50 distribution over
		{'{Alice, Bob}'} at each masked position; independent sampling
		lands on the duplicate "Alice and Alice", violating the joint
		constraint that the two subjects should differ. Phase
		<strong>B</strong>: one of the two positions is remasked while the
		other stays visible. The transformer now conditions on that
		visible token, its distribution at the remasked slot collapses
		onto the correct complement, and argmax produces the coherent
		"Alice and Bob".
	{/snippet}
</Figure>
