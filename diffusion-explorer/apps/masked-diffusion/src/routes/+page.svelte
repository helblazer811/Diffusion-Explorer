<script lang="ts">
	// A Visual Introduction to Masked Diffusion Language Models.
	//
	// This is the single-page app entry for the masked-diffusion blog inside
	// the Diffusion-Explorer monorepo. Layout primitives come from the shared
	// UI package; the figure components live alongside this page under
	// ./figures/.
	import {
		ArticleHeader,
		Figure,
		Katex,
		Bibliography,
		HoverableReference,
		TimeSlider,
		loadBibliography,
		collectCitations,
		type BibEntry,
		type CitationInfo
	} from '@diffusion-explorer/ui';
	import { base } from '$app/paths';
	import { onMount, onDestroy, tick } from 'svelte';
	import { writable, derived } from 'svelte/store';
	import { Player } from '@helblazer811/tempus';

	import DecodingTrajectoryFigure from './figures/DecodingTrajectoryFigure.svelte';
	import ForwardReverseFigure from './figures/ForwardReverseFigure.svelte';
	import ModelPredictionFigure from './figures/ModelPredictionFigure.svelte';
	import ModelPredictionInlineFullMask from './figures/ModelPredictionInlineFullMask.svelte';
	import MLMLossInline from './figures/MLMLossInline.svelte';
	import MLMPreambleFigure from './figures/MLMPreambleFigure.svelte';
	import MaskedTransformerFigure from './figures/MaskedTransformerFigure.svelte';
	import CausalAttentionFigure from './figures/CausalAttentionFigure.svelte';
	import AttentionPatternFigure from './figures/AttentionPatternFigure.svelte';
	import MaskToken from './figures/MaskToken.svelte';
	import AbsorbingMaskFigure from './figures/AbsorbingMaskFigure.svelte';
	import OrderMattersFigure from './figures/OrderMattersFigure.svelte';
	import SequentialRecoveryFigure from './figures/SequentialRecoveryFigure.svelte';
	import RepresentationRippleFigure from './figures/RepresentationRippleFigure.svelte';
	import {
		buildForwardReverseTimeline,
		type ForwardReverseState,
		FORWARD_REVERSE_HALF_MS,
		FORWARD_REVERSE_HOLD_MS,
		FORWARD_REVERSE_TOTAL_MS
	} from './figures/forward_reverse_timeline';

	// Shared visibility stores: each wrapping <Figure> sets one (via
	// IntersectionObserver + tab visibility), and the figure inside reads it to
	// play/pause its tempus animation only while on-screen.
	const trajectoryActive = writable(false);
	// Visibility stores for the four ForwardReverseFigure instances on this
	// page: the two stacked panels of the top-of-page hero, plus the two
	// panels in the "Relation to Continuous Diffusion" section. All four
	// share ONE Player (built below) so their timelines stay in lockstep —
	// which means the hero and the §Relation figures also stay in lockstep
	// with each other when both are on-screen.
	const heroContinuousActive = writable(false);
	const heroMaskedActive = writable(false);
	const forwardReverseContinuousActive = writable(false);
	const forwardReverseMaskedActive = writable(false);
	// True when ANY of the four paired figures is on-screen. Used to gate the
	// shared Player: it plays while any is visible and pauses+resets otherwise.
	const forwardReverseSharedActive = derived(
		[heroContinuousActive, heroMaskedActive, forwardReverseContinuousActive, forwardReverseMaskedActive],
		([$hc, $hm, $c, $m]) => $hc || $hm || $c || $m
	);
	const modelPredictionActive = writable(false);
	const modelPredictionInlineFullMaskActive = writable(false);
	const mlmLossInlineActive = writable(false);
	const maskedTransformerActive = writable(false);
	const causalAttentionActive = writable(false);
	const absorbingMaskActive = writable(false);
	const orderMattersActive = writable(false);
	const sequentialRecoveryActive = writable(false);
	const representationRippleActive = writable(false);

	// Shared clock driving both ForwardReverseFigure variants (continuous +
	// masked). Built on mount so SSR sees an undefined player (the figure
	// tolerates `sharedPlayer` being undefined at first render and picks it
	// up once passed).
	let forwardReverseSharedPlayer = $state<Player<ForwardReverseState> | undefined>(undefined);

	// Mirror the shared player's `u` state so the hero can render its own
	// (single, larger) direction badge above the two paired panels. `u` runs
	// 0 → 1 (forward leg) → 2 (reverse leg) → 0 (loop), so `u <= 1` reads as
	// "going forward" (data → noise on both panels).
	let heroU = $state(0);
	const heroGoingForward = $derived(heroU <= 1);
	// Noising time in [0, 1]: 0 = clean data, 1 = fully corrupted. Folds the
	// forward+hold+reverse+hold loop back onto a single monotone axis so the
	// hero's slider shows "how corrupted are we" rather than raw animation
	// clock time. Matches how the per-panel sliders inside ForwardReverseFigure
	// bind `displayTime={progress}`.
	const heroProgress = $derived(heroU <= 1 ? heroU : 2 - heroU);
	// Seek the shared clock in response to slider drag. Maps a noising-time
	// value v ∈ [0, 1] back to a raw player time t ∈ [0, 1] over the full
	// 4-clip loop. Grabbing the slider mid-forward keeps you on the forward
	// leg (skipping the noise-hold); mid-reverse keeps you on the reverse leg.
	function onHeroSeek(v: number) {
		const player = forwardReverseSharedPlayer;
		if (!player) return;
		const forwardEnd = FORWARD_REVERSE_HALF_MS / FORWARD_REVERSE_TOTAL_MS;
		const reverseStart = (FORWARD_REVERSE_HALF_MS + FORWARD_REVERSE_HOLD_MS) / FORWARD_REVERSE_TOTAL_MS;
		const reverseSpan = FORWARD_REVERSE_HALF_MS / FORWARD_REVERSE_TOTAL_MS;
		const rawT = heroGoingForward ? v * forwardEnd : reverseStart + (1 - v) * reverseSpan;
		player.seek(rawT);
		heroU = heroGoingForward ? v : 2 - v;
	}

	// Shared visual identity for every "pending token" placeholder on this page
	// (the colored rectangles in Figures 1–3). MASK_COLOR is the rectangle
	// background; MASK_TEXT_COLOR is the [MASK] label sitting on top of it —
	// a darker shade in the same blue family.
	const MASK_COLOR = '#cfe0f2';
	const MASK_TEXT_COLOR = '#33506e';

	// Bibliography state — loaded from /bibliography.bib on mount, then the
	// DOM is walked for <HoverableReference> elements so we can render a
	// numbered <Bibliography /> at the bottom. Both stay empty on SSR
	// (adapter-static) and fill in client-side.
	let bibEntries: Map<string, BibEntry> | null = $state(null);
	let citations: CitationInfo[] = $state([]);

	onMount(async () => {
		// Build the shared clock for the paired continuous+masked forward-reverse
		// figures. Both ForwardReverseFigure instances subscribe to this Player,
		// so their sliders and animations stay in exact lockstep.
		forwardReverseSharedPlayer = new Player<ForwardReverseState>(
			buildForwardReverseTimeline(),
			{ looping: true, endPause: 0.15 }
		);

		try {
			bibEntries = await loadBibliography(`${base}/bibliography.bib`);
		} catch (error) {
			console.error('Error loading bibliography:', error);
		}
		await tick();
		citations = collectCitations();
	});

	// Play the shared clock whenever either paired figure is visible; pause and
	// rewind when both scroll away. Runs client-side only via $effect.
	$effect(() => {
		const player = forwardReverseSharedPlayer;
		if (!player) return;
		const unsub = forwardReverseSharedActive.subscribe((anyOn) => {
			if (anyOn) player.play();
			else {
				player.pause();
				player.reset();
			}
		});
		return unsub;
	});

	// Mirror the shared player's `u` so the hero's direction badge stays in
	// sync with what the two panels are showing.
	$effect(() => {
		const player = forwardReverseSharedPlayer;
		if (!player) return;
		const unsubTick = player.onTick((_t, s) => {
			heroU = s.u;
		});
		return unsubTick;
	});

	onDestroy(() => {
		forwardReverseSharedPlayer?.dispose();
	});
</script>

<ArticleHeader
	title="A Visual Introduction to Masked Diffusion Models"
	authors={[
		{ name: 'Alec Helbling', link: 'https://alechelbling.com/' }
	]}
	date="July 9, 2026"
/>

<!-- Hero: continuous diffusion on top, masked diffusion below, sharing one
	 clock via `forwardReverseSharedPlayer`. One big direction badge sits
	 above the pair, a bold descriptor line names the two variants, then the
	 two <Figure> wrappers stack with their per-panel badges and sliders
	 suppressed. A single shared <TimeSlider> scrubs both. The same paired
	 figures reappear inside §Relation to Continuous Diffusion further down
	 the page (with their per-panel badges and sliders intact, formatted as
	 two separate figures with explanatory prose between). -->
<div class="hero-pair">
	<div class="hero-badge" class:is-reverse={!heroGoingForward} aria-hidden="true">
		<svg
			class="hero-badge-arrow"
			viewBox="0 0 440 40"
			role="presentation"
		>
			<defs>
				<marker
					id="hero-arrowhead"
					viewBox="0 0 12 12"
					refX="10"
					refY="6"
					markerWidth="12"
					markerHeight="12"
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					<path d="M0,0 L12,6 L0,12 Z" fill="#f17720" />
				</marker>
			</defs>
			<line
				x1={heroGoingForward ? 20 : 420}
				y1={20}
				x2={heroGoingForward ? 420 : 20}
				y2={20}
				stroke="#f17720"
				stroke-width="3.5"
				stroke-dasharray="12 8"
				marker-end="url(#hero-arrowhead)"
			/>
		</svg>
		<span class="hero-badge-text">
			{heroGoingForward ? 'Forward' : 'Reverse'}
		</span>
	</div>

	<p class="hero-descriptor">
		<strong>Continuous Diffusion</strong> corrupts data with Gaussian
		noise.
	</p>

	<Figure backgroundVisible={false} isActive={heroContinuousActive}>
		{#snippet children()}
			<ForwardReverseFigure
				isActive={heroContinuousActive}
				variant="continuous"
				maskColor={MASK_COLOR}
				crossFade={false}
				sharedPlayer={forwardReverseSharedPlayer}
				showSlider={false}
				showDirectionBadge={false}
			/>
		{/snippet}
	</Figure>

	<p class="hero-descriptor hero-descriptor-masked">
		<strong>Masked Diffusion</strong> corrupts data with discrete
		masking.
	</p>

	<Figure backgroundVisible={false} isActive={heroMaskedActive}>
		{#snippet children()}
			<ForwardReverseFigure
				isActive={heroMaskedActive}
				variant="masked"
				maskColor={MASK_COLOR}
				crossFade={false}
				sharedPlayer={forwardReverseSharedPlayer}
				showSlider={false}
				showDirectionBadge={false}
				maskedLayout="grid"
				gridColumns={11}
				text={'Once there was a small cat named Milo. ' +
					'He lived in a tall red house on a big green hill. ' +
					'Every day he sat by the door and saw the birds fly by. ' +
					'One day a bird came and sang a song for him. ' +
					'He felt very happy that day.'}
			/>
		{/snippet}
	</Figure>

	<div class="hero-slider">
		<TimeSlider
			timeline={(forwardReverseSharedPlayer ?? null) as Player<unknown> | null}
			min={0}
			max={1}
			step={0.001}
			showTicks={true}
			showTimeLabel={false}
			minLabel="t=0"
			maxLabel="t=1"
			displayTime={heroProgress}
			onSeekByDisplayTime={onHeroSeek}
			color="#f17720"
		/>
	</div>

	<p class="hero-caption">
		<span class="figure-number">Figure 1.</span>
		<strong>Continuous diffusion (top) and masked diffusion (bottom)
		run on one shared clock.</strong> Both are diffusion processes,
		each defined by a forward corruption that destroys information
		over time and a learned reverse process that undoes it. Continuous
		diffusion progressively perturbs the input with Gaussian noise
		until it is indistinguishable from noise; masked diffusion
		progressively replaces tokens with a special
		<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />
		symbol until the sequence is fully absorbed. Drag the slider or
		let the animation cycle to see the corruption process advance in
		lockstep across both panels.
	</p>
</div>

<hr class="section-divider" />

<h2 id="introduction">Introduction</h2>

<p>
	Autoregressive language models are the workhorse of modern AI.
	Practically every major LLM in production today, from GPT to Claude to
	Gemini, is autoregressive at its core: they generate text one token at
	a time, left to right, each token conditioned on everything that came
	before. Autoregressive models have earned their dominance: the recipe
	works, scales, and produces the frontier systems we use every day. But
	are there other viable paradigms for language modeling?
</p>

<p>
	One alternative is <em>masked diffusion language models</em>
	<HoverableReference
		id="sahoo2024simpleeffectivemaskeddiffusion"
		{bibEntries}
		{citations}
	/><HoverableReference
		id="shi2025simplifiedgeneralizedmaskeddiffusion"
		{bibEntries}
		{citations}
	/>. Diffusion is the dominant paradigm for image and video generation.
	On text it has more recently shown promise, with the largest masked
	diffusion language models scaling to 8 billion parameters
	<HoverableReference
		id="nie2025largelanguagediffusionmodels"
		{bibEntries}
		{citations}
	/>. Like their continuous cousins, masked diffusion language models
	frame generation as reversing a corruption process: they start from a
	fully-masked sequence and progressively unmask tokens in any order,
	potentially several at once. This opens up several core capabilities.
	Multiple tokens can be unmasked in a single reverse step, so
	generation is no longer strictly serial &mdash; a potential path to
	faster inference than one-token-at-a-time autoregression. Tokens
	can also be revisited and revised after they're first produced, a
	technique called <em>remasking</em>
	<HoverableReference
		id="wang2026remaskingdiscretediffusionmodels"
		{bibEntries}
		{citations}
	/>. And the unmasking order isn't fixed left-to-right, letting the
	model attack problems in an order that matches their dependency
	structure, useful for tasks like Sudoku
	<HoverableReference
		id="kim2025trainworstplanbest"
		{bibEntries}
		{citations}
	/>.
</p>

<p>
	These capabilities are real, but not without their idiosyncrasies.
	Parallel decoding isn't a free speedup. Autoregressive models cache
	their past keys and values, something not possible due to the
	bidirectional attention of masked transformers. I hope to cover this
	in a future post. Committing multiple tokens at once can also produce
	jointly incoherent output: the reverse step samples each position
	independently, so two locally-plausible draws can be globally wrong.
	Choosing an unmasking order is itself a design decision. Random works,
	but adaptive orderings, picking the highest-confidence position first,
	do noticeably better on structured problems
	<HoverableReference
		id="kim2025trainworstplanbest"
		{bibEntries}
		{citations}
	/>. The rest of this post covers what a masked diffusion model is,
	how it generalizes BERT-style masked language modeling, the shared
	theoretical scaffolding it inherits from continuous diffusion, and
	the practical quirks that come with the paradigm.
</p>

<hr class="section-divider" />

<h2 id="masked-language-modeling">Masked Language Modeling</h2>

<p>
	Before we get to masked diffusion, it is worth revisiting the idea it
	builds on: <em>masked language modeling</em>
	<HoverableReference
		id="devlin2019bertpretrainingdeepbidirectional"
		{bibEntries}
		{citations}
	/>. A masked language model is trained to predict the value of a
	token given surrounding context. That target position can be anywhere
	in the sequence, not necessarily just the end, and the model uses
	whatever tokens are visible on <em>either</em> side as context.
</p>

<Figure backgroundVisible={false}>
	{#snippet children()}
		<MLMPreambleFigure />
	{/snippet}
</Figure>

<p>
	From this angle, an autoregressive model can be thought of as a
	particular instance of a masked language model with a restricted
	unmasking pattern: the target position is always the next one, and
	the visible context is always the tokens to its left.
</p>

<h3 id="mlm-framework">The Framework</h3>

<p>
	Concretely: masked positions are marked with a special
	<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> symbol,
	and at every masked position the model outputs a
	<em>categorical distribution</em> over the vocabulary, which we
	sample from to fill the slot.
</p>

<Figure backgroundVisible={false} isActive={modelPredictionActive}>
	{#snippet children()}
		<ModelPredictionFigure
			isActive={modelPredictionActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
		/>
	{/snippet}
</Figure>

<p>
	This is exactly the pretraining objective of BERT
	<HoverableReference
		id="devlin2019bertpretrainingdeepbidirectional"
		{bibEntries}
		{citations}
	/>. For each training sentence <Katex math={"\\mathbf{x}"} />, BERT samples
	a random subset of positions <Katex math={"M \\subset \\{1, \\ldots, L\\}"} />
	&mdash; canonically <em>15%</em> of them &mdash; and replaces each of those
	tokens with <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> to produce a corrupted sequence
	<Katex math={"\\tilde{\\mathbf{x}}"} />. A bidirectional transformer
	parameterizes <Katex math={"p_\\theta"} />, which predicts a categorical
	distribution over the vocabulary at every masked position, and the loss is
	cross-entropy on those positions only:
</p>

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"\\mathcal{L}_{\\mathrm{MLM}} = -\\, \\mathbb{E}_{\\mathbf{x},\\, M} \\left[ \\sum_{\\ell \\in M} \\log p_\\theta(\\mathbf{x}^\\ell \\mid \\tilde{\\mathbf{x}}) \\right]"}
/>

<p>
	<strong>Cross-entropy is KL to the one-hot target.</strong> For a
	one-hot target the negative log-likelihood equals
	<Katex math={"D_{\\mathrm{KL}}(\\mathbf{x}^\\ell \\,\\|\\, p_\\theta(\\cdot \\mid \\tilde{\\mathbf{x}}))"} />
	exactly, and minimizing it pulls the model's predicted distribution
	toward the target.
</p>

<Figure backgroundVisible={false} isActive={mlmLossInlineActive}>
	{#snippet children()}
		<MLMLossInline isActive={mlmLossInlineActive} />
	{/snippet}
</Figure>

<p>
	This loss is fantastic for <em>representation learning</em>: fill-in-the-blank
	is a hard enough task that the transformer has to build genuinely useful
	features to solve it, which is why BERT is such a strong starting point
	for downstream classifiers and encoders.
</p>

<h3 id="masked-transformers">Masked Transformers</h3>

<p>
	The neural network doing the predicting is a <em>transformer</em>:
	the same stack a modern large language model would use, with an
	embedding layer at the input, an alternation of self-attention blocks
	and feed-forward MLPs in the middle, a residual stream, layer
	normalization, and a tied unembedding at the top that maps back to a
	categorical distribution over the vocabulary at every position.
</p>

<Figure backgroundVisible={false} isActive={maskedTransformerActive}>
	{#snippet children()}
		<MaskedTransformerFigure
			isActive={maskedTransformerActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
		/>
	{/snippet}
</Figure>

<p>
	<strong>Self Attention</strong>. Inside each self-attention block,
	a familiar equation. Every position's hidden state is projected
	into a query, key, and value vector, and each query mixes the
	values in proportion to how much its own key aligns with every
	other position's key:
</p>

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d}} + M\\right) V"}
/>

<p>
	<strong>Causal vs Bidirectional Attention</strong>. The only piece
	that changes between an autoregressive and a masked transformer is
	the mask <Katex math={"M"} />: it is upper-triangular full of
	<Katex math={"-\\infty"} /> in the causal case, and all zeros in
	the bidirectional case.
</p>

<p>
	What distinguishes a masked transformer from the autoregressive stack
	behind a GPT is a single detail inside the self-attention layers:
	the attention pattern is <em>bidirectional</em>. Every position's
	query attends to every other position's keys, not just the ones to
	its left.
</p>

<p>
	At the graph level, this is which input positions actually route
	information into a given output.
</p>

<Figure backgroundVisible={false}>
	{#snippet children()}
		<AttentionPatternFigure maskColor={MASK_COLOR} maskTextColor={MASK_TEXT_COLOR} />
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 6.</span>
		Bipartite view of information flow. In each panel, the top row of
		rectangles is the embedding at each position; the bottom row is
		the output at each position; a line means &ldquo;that output
		attends to that embedding.&rdquo; By default both panels highlight
		the pattern for the <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />'s
		output &mdash; under causal attention it only sees itself and the
		three tokens to its left; under bidirectional attention it sees
		every position. Hover or tap
		<img
			src="{base}/icons/tap.svg"
			alt="tap"
			style="width: 24px; height: 24px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
		/> any node to see the pattern for that position.
	{/snippet}
</Figure>

<p>
	Under the hood, this is enforced by a mask matrix added to the
	attention logits before the softmax &mdash; every entry
	<Katex math={"(i, j)"} /> the query is not allowed to attend to gets
	set to <Katex math={"-\\infty"} />, so its softmax weight becomes
	zero.
</p>

<Figure backgroundVisible={false} isActive={causalAttentionActive}>
	{#snippet children()}
		<CausalAttentionFigure isActive={causalAttentionActive} />
	{/snippet}
	{#snippet caption()}
		The underlying attention masks. Each row is a query; each column
		is a key. Under the causal mask used by autoregressive
		transformers, every query attends only to past-and-current keys
		and the matrix is lower-triangular. Under bidirectional attention
		every query sees every key, and the full square fills in.
	{/snippet}
</Figure>

<p>
	This is exactly the attention pattern BERT and other MLMs use. In an
	autoregressive transformer the query at position <em>t</em> can only
	attend to keys at positions <Katex math={"\\le t"} />, so information
	flows strictly one way: past to future. In a masked transformer that
	constraint is lifted. Every hidden state is a function of the whole
	current context &mdash; both the tokens to its left and the tokens
	to its right. That is the property that lets the model fill in an
	interior <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />
	sensibly: it can condition on evidence from either side.
</p>

<h3 id="generative-bert">Generative BERT</h3>

<p>
	<strong>How would we go about <em>generating</em> a novel sequence with a
	model trained like this?</strong> BERT was never designed to
	<em>generate</em> text, and it turns out that a 15%-MLM model can't
	quite do it &mdash; for a subtle reason we will unpack in the next
	section. The natural thing to try is to hand it an input that is
	<em>entirely</em> <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> and ask it to fill in every
	position at once:
</p>

<Figure backgroundVisible={false} isActive={modelPredictionInlineFullMaskActive}>
	{#snippet children()}
		<ModelPredictionInlineFullMask
			isActive={modelPredictionInlineFullMaskActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
		/>
	{/snippet}
</Figure>

<p>
	But BERT has never seen an input like this: BERT-style models are
	typically trained with only a small fraction of their tokens masked
	(~15%), so with nothing to condition on the outputs are essentially
	untrained. And the problem isn't unique to the 100% case &mdash;
	generating from scratch requires a model that behaves sensibly at
	<em>every</em> masking rate from &ldquo;fully masked&rdquo; to
	&ldquo;almost done&rdquo;, a continuum this fixed schedule never
	visits. This is the gap masked diffusion closes: train the same
	architecture on a whole <em>family</em> of masking rates, and it
	turns from a representation learner into a generative model.
</p>

<hr class="section-divider" />

<h2 id="masked-diffusion-models">Masked Diffusion Models</h2>

<p>
	A different way to see the two paradigms: freeze the decoder after each
	step and stack the intermediate lines from top to bottom. Row 0 is the
	empty (fully-masked) sequence; row <em>k</em> is the sequence after
	<em>k</em> tokens have been generated; the last row is the fully-decoded
	line. The <em>autoregressive</em> block reveals slots strictly
	left-to-right; the <em>masked diffusion</em> block reveals slots in a
	random order &mdash; you can see this by tracking which column gains a
	word from one row to the next.
</p>

<Figure backgroundVisible={false} isActive={trajectoryActive}>
	{#snippet children()}
		<DecodingTrajectoryFigure isActive={trajectoryActive} maskColor={MASK_COLOR} />
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 9.</span> Decoding trajectories for
		autoregressive (left) and masked-diffusion (right) generation on a short
		line. Each row is one decoding step; rows fade in top-to-bottom on a
		shared clock. Pending slots are colored rectangles sized to the
		eventual token so the columns stay aligned across rows.
	{/snippet}
</Figure>

<p>
	Everything downstream of this choice treats the transformer as a black
	box &mdash; a function <Katex math={"p_\\theta(\\cdot \\mid \\mathbf{z}_t, t)"} />
	that maps a partially-masked sequence and a timestep to a categorical
	distribution over the vocabulary at each masked position. The rest of
	this section is about how to train and sample from that function.
</p>

<p>
	Turning &ldquo;train on every masking rate&rdquo; into an actual algorithm
	takes a bit of scaffolding. We need to say <em>how</em> to corrupt a
	sequence to any target rate (the <strong>forward process</strong>), how to
	invert one step of that corruption at inference time (the
	<strong>reverse process</strong>), and how to weight the different rates
	against each other when we train (the <strong>training loss</strong>).
	Once those three pieces are in place, generation is just the iterative
	unmasking loop from the previous section &mdash; run in reverse from a
	fully-masked start. We follow the MDLM formulation throughout
	<HoverableReference
		id="sahoo2024simpleeffectivemaskeddiffusion"
		{bibEntries}
		{citations}
	/>.
</p>

<h3 id="forward-process">Masking as the Forward Process</h3>

<p>
	Let <Katex math={"x \\in \\mathcal{V}^L"} /> be a clean sequence of length
	<Katex math={"L"} /> over vocabulary <Katex math={"\\mathcal{V}"} />, and
	let <Katex math={"\\mathbf{m}"} /> denote the special
	<em>absorbing</em> mask token. A monotone schedule
	<Katex math={"\\alpha_t : [0, 1] \\to [0, 1]"} /> with
	<Katex math={"\\alpha_0 = 1"} /> (all clean) and
	<Katex math={"\\alpha_1 = 0"} /> (fully masked) defines the noising
	marginal:
</p>

<p>
	We write these per-position distributions as
	<Katex math={"\\mathrm{Cat}(x;\\, p_1, \\ldots, p_K)"} />, a
	<em>categorical</em> distribution over <Katex math={"K"} /> outcomes
	with probabilities <Katex math={"p_k"} /> summing to one.
</p>

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"q(\\mathbf{z}_t \\mid \\mathbf{x}) = \\prod_{\\ell=1}^L \\mathrm{Cat}\\!\\left(\\mathbf{z}_t^\\ell;\\; \\alpha_t\\, \\mathbf{x}^\\ell + (1 - \\alpha_t)\\, \\mathbf{m}\\right)"}
/>

<p>
	Each position is <em>independently</em> either kept as its original token
	with probability <Katex math={"\\alpha_t"} /> or absorbed into
	<Katex math={"\\mathbf{m}"} /> with probability
	<Katex math={"1 - \\alpha_t"} />. Once a position is masked, it stays
	masked at all later times &mdash; that is what makes the process
	<em>absorbing</em>.
</p>

<Figure backgroundVisible={false} isActive={absorbingMaskActive}>
	{#snippet children()}
		<AbsorbingMaskFigure
			isActive={absorbingMaskActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
		/>
	{/snippet}
	{#snippet caption()}
		<strong>The absorbing forward process.</strong> A short sequence is
		unrolled vertically, one row per forward-process timestep. Row 0 is
		fully clean; each subsequent row corrupts one or two more positions
		to the <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />
		sentinel. Once a position is masked it stays masked in every row
		below &mdash; the mask token is <em>absorbing</em>, and each column
		has a single point of no return.
	{/snippet}
</Figure>

<h3 id="reverse-process">Reverse Process</h3>

<p>
	The model <Katex math={"p_\\theta(\\cdot \\mid \\mathbf{z}_t, t)"} />
	predicts a categorical over the <em>clean</em> token at each masked
	position (the <em>SUBS</em> parameterization: mask probability is
	fixed at zero, and unmasked positions carry over unchanged). Plugging
	<Katex math={"p_\\theta"} /> into the true posterior of the forward
	process gives the reverse step
	<Katex math={"p_\\theta(\\mathbf{z}_s \\mid \\mathbf{z}_t)"} /> for
	<Katex math={"s < t"} />:
</p>

<div class="equation-scroll">
<Katex
	displayMode
	displayFontSize="1.15em"
	math={"q(\\mathbf{z}_s^\\ell \\mid \\mathbf{z}_t^\\ell, \\mathbf{x}^\\ell) = \\begin{cases} \\delta(\\mathbf{z}_s^\\ell = \\mathbf{z}_t^\\ell) & \\text{if } \\mathbf{z}_t^\\ell \\ne \\mathbf{m}, \\\\[4pt] \\mathrm{Cat}\\!\\left(\\mathbf{z}_s^\\ell;\\; \\dfrac{(1 - \\alpha_s)\\, \\mathbf{m} + (\\alpha_s - \\alpha_t)\\, \\mathbf{x}^\\ell}{1 - \\alpha_t}\\right) & \\text{if } \\mathbf{z}_t^\\ell = \\mathbf{m}. \\end{cases}"}
/>
</div>

<p>
	Unmasked positions carry over deterministically. Masked positions either
	stay masked with weight
	<Katex math={"(1 - \\alpha_s) / (1 - \\alpha_t)"} /> or unmask to the
	predicted clean token with weight
	<Katex math={"(\\alpha_s - \\alpha_t) / (1 - \\alpha_t)"} />.
</p>

<h3 id="training-loss">Training Loss</h3>

<p>
	The model is trained by minimizing a weighted cross-entropy on the
	masked positions, averaged over noise levels
	<Katex math={"t"} /> and corruptions <Katex math={"\\mathbf{z}_t"} />
	drawn from the forward process:
</p>

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"\\mathcal{L}_{\\mathrm{MDLM}}(\\theta) \\;=\\; -\\, \\mathbb{E}_{t}\\, \\mathbb{E}_{q(\\mathbf{z}_t \\mid \\mathbf{x})} \\left[ \\dfrac{\\alpha'_t}{1 - \\alpha_t} \\sum_{\\ell \\in M_t} \\log p_\\theta(\\mathbf{x}^\\ell \\mid \\mathbf{z}_t) \\right]."}
/>

<p>
	Here <Katex math={"M_t"} /> is the set of positions masked in
	<Katex math={"\\mathbf{z}_t"} />, and
	<Katex math={"\\alpha'_t / (1 - \\alpha_t)"} /> is a per-timestep
	weight that comes out of the forward-process schedule. Concretely, at
	each training step we sample a random <Katex math={"t"} />, mask that
	fraction of the tokens, and take a cross-entropy on the model's
	predictions at the masked positions.
</p>

<h3 id="relation-to-continuous-diffusion">Relation to Continuous Diffusion</h3>

<p>
	In <strong>continuous diffusion</strong>, the forward process transforms
	data into a Gaussian, destroying information, and the reverse process
	aims to generate new data by reversing this information-destroying
	process.
</p>

<div class="hero-badge" class:is-reverse={!heroGoingForward} aria-hidden="true">
	<svg class="hero-badge-arrow" viewBox="0 0 440 40" role="presentation">
		<defs>
			<marker
				id="relation-arrowhead-continuous"
				viewBox="0 0 12 12"
				refX="10"
				refY="6"
				markerWidth="12"
				markerHeight="12"
				markerUnits="userSpaceOnUse"
				orient="auto"
			>
				<path d="M0,0 L12,6 L0,12 Z" fill="#f17720" />
			</marker>
		</defs>
		<line
			x1={heroGoingForward ? 20 : 420}
			y1={20}
			x2={heroGoingForward ? 420 : 20}
			y2={20}
			stroke="#f17720"
			stroke-width="3.5"
			stroke-dasharray="12 8"
			marker-end="url(#relation-arrowhead-continuous)"
		/>
	</svg>
	<span class="hero-badge-text">
		{heroGoingForward ? 'Forward' : 'Reverse'}
	</span>
</div>

<Figure backgroundVisible={false} isActive={forwardReverseContinuousActive}>
	{#snippet children()}
		<ForwardReverseFigure
			isActive={forwardReverseContinuousActive}
			variant="continuous"
			maskColor={MASK_COLOR}
			crossFade={false}
			sharedPlayer={forwardReverseSharedPlayer}
			showDirectionBadge={false}
		/>
	{/snippet}
</Figure>

<p>
	In <strong>masked diffusion</strong>, the forward process destroys
	information through discrete masking, and likewise generation is framed
	as reversing this forward masking process.
</p>

<div class="hero-badge" class:is-reverse={!heroGoingForward} aria-hidden="true">
	<svg class="hero-badge-arrow" viewBox="0 0 440 40" role="presentation">
		<defs>
			<marker
				id="relation-arrowhead-masked"
				viewBox="0 0 12 12"
				refX="10"
				refY="6"
				markerWidth="12"
				markerHeight="12"
				markerUnits="userSpaceOnUse"
				orient="auto"
			>
				<path d="M0,0 L12,6 L0,12 Z" fill="#f17720" />
			</marker>
		</defs>
		<line
			x1={heroGoingForward ? 20 : 420}
			y1={20}
			x2={heroGoingForward ? 420 : 20}
			y2={20}
			stroke="#f17720"
			stroke-width="3.5"
			stroke-dasharray="12 8"
			marker-end="url(#relation-arrowhead-masked)"
		/>
	</svg>
	<span class="hero-badge-text">
		{heroGoingForward ? 'Forward' : 'Reverse'}
	</span>
</div>

<Figure backgroundVisible={false} isActive={forwardReverseMaskedActive}>
	{#snippet children()}
		<ForwardReverseFigure
			isActive={forwardReverseMaskedActive}
			variant="masked"
			maskColor={MASK_COLOR}
			crossFade={false}
			sharedPlayer={forwardReverseSharedPlayer}
			showDirectionBadge={false}
			maskedLayout="grid"
			gridColumns={11}
			text={'Once there was a small cat named Milo. ' +
				'He lived in a tall red house on a big green hill. ' +
				'Every day he sat by the door and saw the birds fly by. ' +
				'One day a bird came and sang a song for him. ' +
				'He felt very happy that day.'}
		/>
	{/snippet}
</Figure>

<hr class="section-divider" />

<h2 id="deriving-training-loss">Deriving the Training Loss</h2>

<p>
	The previous section stated the MDLM training loss without saying
	where it comes from. Where does this specific objective come from?
	And is the analogy to diffusion just heuristic, or something deeper?
	The rest of this section derives it from first principles.
</p>

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"\\mathcal{L}_{\\mathrm{MDLM}}(\\theta) \\;=\\; -\\, \\mathbb{E}_{t}\\, \\mathbb{E}_{q(\\mathbf{z}_t \\mid \\mathbf{x})} \\left[ \\dfrac{\\alpha'_t}{1 - \\alpha_t} \\sum_{\\ell \\in M_t} \\log p_\\theta(\\mathbf{x}^\\ell \\mid \\mathbf{z}_t) \\right]."}
/>

<p class="stub-lead"><strong>Framing.</strong></p>

<ul class="stub-list">
	<li>
		Masked diffusion is not diffusion in a hand-wavy sense. The model
		has a well-defined joint distribution
		<Katex math={"p_\\theta(\\mathbf{x})"} /> as the marginal of a
		stochastic reverse process.
	</li>
	<li>
		We can honestly bound
		<Katex math={"\\log p_\\theta(\\mathbf{x})"} /> with the standard
		diffusion ELBO &mdash; the same one continuous diffusion uses. Cite
		Sohl-Dickstein 2015 and Ho et al. 2020 for the ELBO's origin in the
		diffusion context. (Need to add both to
		<code>bibliography.bib</code>.)
	</li>
	<li>
		Aside for readers who wondered "isn't this just cross-entropy
		training?": unlike AR, whose <Katex math={"p_\\theta(\\mathbf{x})"} />
		is a direct network output (product of per-token conditionals),
		MDLM's <Katex math={"p_\\theta(\\mathbf{x})"} /> is a marginal over
		a stochastic reverse process, so we can't compute it exactly. ELBO
		gives a tractable lower bound.
	</li>
	<li>
		Punchline: under our absorbing corruption + SUBS parameterization,
		the ELBO collapses dramatically to a weighted masked-language-
		modeling loss. This section is that collapse, one term at a time.
	</li>
</ul>

<p class="stub-lead"><strong>The Diffusion ELBO.</strong></p>

<ul class="stub-list">
	<li>
		State the standard three-term diffusion ELBO decomposition
		(reconstruction + prior + matching sum). Display equation:
	</li>
</ul>

<div class="equation-scroll">
<Katex
	displayMode
	displayFontSize="1.05em"
	math={"\\log p_\\theta(\\mathbf{x}) \\;\\ge\\; \\underbrace{\\mathbb{E}_q[\\log p_\\theta(\\mathbf{x} \\mid \\mathbf{z}_0)]}_{\\text{reconstruction}} \\;-\\; \\underbrace{D_{\\mathrm{KL}}(q(\\mathbf{z}_T \\mid \\mathbf{x}) \\,\\|\\, p(\\mathbf{z}_T))}_{\\text{prior}} \\;-\\; \\sum_{t=2}^{T} \\underbrace{\\mathbb{E}_q[D_{\\mathrm{KL}}(q(\\mathbf{z}_{t-1} \\mid \\mathbf{z}_t, \\mathbf{x}) \\,\\|\\, p_\\theta(\\mathbf{z}_{t-1} \\mid \\mathbf{z}_t))]}_{\\text{matching}}"}
/>
</div>

<ul class="stub-list">
	<li>One sentence per term naming what each measures.</li>
	<li>
		Say we'll take them in order and see what each collapses to under
		the MDLM assumptions.
	</li>
</ul>

<p class="stub-lead"><strong>The Reconstruction Term Vanishes.</strong></p>

<ul class="stub-list">
	<li>
		In MDLM's absorbing schedule <Katex math={"\\alpha_0 = 1"} />, so
		<Katex math={"q(\\mathbf{z}_0 \\mid \\mathbf{x})"} /> is a Dirac on
		<Katex math={"\\mathbf{x}"} /> itself &mdash; nothing gets masked at
		<Katex math={"t = 0"} />.
	</li>
	<li>
		Therefore
		<Katex math={"\\log p_\\theta(\\mathbf{x} \\mid \\mathbf{z}_0) = \\log p_\\theta(\\mathbf{x} \\mid \\mathbf{x})"} />,
		which is trivially handled by the SUBS carryover rule: the reverse
		step at <Katex math={"t = 0"} /> copies unmasked positions through.
		Zero contribution.
	</li>
	<li>One-liner: reconstruction term drops.</li>
</ul>

<p class="stub-lead"><strong>The Prior Term Vanishes.</strong></p>

<ul class="stub-list">
	<li>
		At <Katex math={"t = T = 1"} />, <Katex math={"\\alpha_1 = 0"} />, so
		<Katex math={"q(\\mathbf{z}_1 \\mid \\mathbf{x})"} /> is a Dirac on
		the fully-masked sequence
		<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />
		<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> &hellip;
		<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />.
	</li>
	<li>
		The sampling prior <Katex math={"p(\\mathbf{z}_1)"} /> is <em>also</em>
		the fully-masked sequence (that's where we start sampling from in
		the reverse process).
	</li>
	<li>
		Both distributions are Diracs on the same point,
		so <Katex math={"D_{\\mathrm{KL}} = 0"} /> exactly.
	</li>
	<li>One-liner: prior term drops.</li>
</ul>

<p class="stub-lead"><strong>What Survives: The Matching Sum.</strong></p>

<ul class="stub-list">
	<li>Only the sum over <Katex math={"t"} /> remains. Restate:</li>
</ul>

<Katex
	displayMode
	displayFontSize="1.05em"
	math={"\\mathcal{L} \\;=\\; \\sum_t \\mathbb{E}_q\\!\\left[D_{\\mathrm{KL}}(q(\\mathbf{z}_s \\mid \\mathbf{z}_t, \\mathbf{x}) \\,\\|\\, p_\\theta(\\mathbf{z}_s \\mid \\mathbf{z}_t))\\right]"}
/>

<ul class="stub-list">
	<li>
		All the work of MDLM training is in fitting per-timestep reverse-
		step distributions to the ground-truth posterior.
	</li>
</ul>

<p class="stub-lead"><strong>Substituting the Masked Transformer via SUBS.</strong></p>

<ul class="stub-list">
	<li>
		Now we need to say what
		<Katex math={"p_\\theta(\\mathbf{z}_s \\mid \\mathbf{z}_t)"} />
		actually is. The masked transformer outputs a per-position
		categorical over
		<Katex math={"\\mathcal{V} \\cup \\{\\mathbf{m}\\}"} />. SUBS turns
		this into a valid reverse-step distribution.
	</li>
	<li>Two rules:</li>
	<li style="margin-left: 1.5em;">
		<strong>Zero-mask.</strong> The network's probability of
		<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> is
		forced to zero and the vocabulary categorical is renormalized. The
		mask symbol isn't a real answer.
	</li>
	<li style="margin-left: 1.5em;">
		<strong>Carryover.</strong> At unmasked positions, the reverse step
		is a Dirac on the current token. Only masked positions are
		stochastic.
	</li>
	<li>
		Result: at each currently-masked position, the reverse distribution
		is a two-outcome categorical over "stay masked" (weight
		<Katex math={"(1 - \\alpha_s)/(1 - \\alpha_t)"} />) and "flip to a
		clean token" (weight
		<Katex math={"(\\alpha_s - \\alpha_t)/(1 - \\alpha_t)"} />,
		distributed per the zero-mask network output).
	</li>
</ul>

<p class="stub-lead"><strong>KL Collapse at One Timestep.</strong></p>

<ul class="stub-list">
	<li>Compute one summand's KL under SUBS.</li>
	<li>
		At unmasked positions: <Katex math={"q"} /> and
		<Katex math={"p_\\theta"} /> both Dirac on the same value, so KL
		contribution is zero. Only masked positions matter.
	</li>
	<li>
		At masked position <Katex math={"\\ell"} />: <Katex math={"q"} /> is
		a 2-outcome categorical, <Katex math={"p_\\theta"} /> under SUBS is
		a 2-outcome categorical of the same shape. Both put mass
		<Katex math={"(1 - \\alpha_s)/(1 - \\alpha_t)"} /> on "stay masked";
		only the "flip to clean token" part differs
		(<Katex math={"q"} /> knows the true <Katex math={"\\mathbf{x}^\\ell"} />,
		<Katex math={"p_\\theta"} /> has the network's guess).
	</li>
	<li>Display equation:</li>
</ul>

<Katex
	displayMode
	displayFontSize="1.05em"
	math={"D_{\\mathrm{KL}}(q \\,\\|\\, p_\\theta) \\;=\\; \\frac{\\alpha_s - \\alpha_t}{1 - \\alpha_t} \\, \\big[ -\\log p_\\theta(\\mathbf{x}^\\ell \\mid \\mathbf{z}_t) \\big] \\quad \\text{for } \\ell \\in M_t"}
/>

<ul class="stub-list">
	<li>
		Punchline: this is cross-entropy at position <Katex math={"\\ell"} />,
		times a schedule-dependent scalar.
	</li>
</ul>

<p class="stub-lead"><strong>Final Loss: The Continuous-Time Limit.</strong></p>

<ul class="stub-list">
	<li>
		Sum over <Katex math={"t"} /> becomes an integral over
		<Katex math={"t \\in [0, 1]"} /> as we take
		<Katex math={"T \\to \\infty"} />.
	</li>
	<li>
		<Katex math={"(\\alpha_s - \\alpha_t) \\to \\alpha'_t \\, dt"} />.
	</li>
	<li>
		Integral becomes an expectation over <Katex math={"t"} />.
	</li>
	<li>Display equation:</li>
</ul>

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"\\mathcal{L}_{\\mathrm{MDLM}} \\;=\\; \\mathbb{E}_t\\!\\left[\\frac{\\alpha'_t}{1 - \\alpha_t} \\, \\mathcal{L}_{\\mathrm{MLM}}(\\mathbf{z}_t)\\right]"}
/>

<ul class="stub-list">
	<li>
		Where the inner <Katex math={"\\mathcal{L}_{\\mathrm{MLM}}(\\mathbf{z}_t)"} />
		is the MLM loss from §MLM evaluated on the corrupted sequence
		<Katex math={"\\mathbf{z}_t"} />.
	</li>
	<li>
		One-sentence interpretation: the MDLM loss is the MLM loss,
		averaged over all masking rates, weighted by
		<Katex math={"\\alpha'_t / (1 - \\alpha_t)"} />.
	</li>
</ul>

<p class="stub-lead"><strong>Upshot.</strong></p>

<ul class="stub-list">
	<li>
		The MDLM loss is not a heuristic. It <em>is</em> the standard
		diffusion ELBO evaluated under the absorbing-corruption + SUBS
		assumptions.
	</li>
	<li>Every simplification was a consequence of a specific choice:</li>
	<li style="margin-left: 1.5em;">
		Reconstruction vanishes because <Katex math={"\\alpha_0 = 1"} />
		(absorbing).
	</li>
	<li style="margin-left: 1.5em;">
		Prior vanishes because the prior matches the corrupt endpoint
		(absorbing).
	</li>
	<li style="margin-left: 1.5em;">
		Unmasked positions drop because SUBS carryover makes them
		deterministic.
	</li>
	<li style="margin-left: 1.5em;">
		The surviving weighted cross-entropy: because SUBS produces a
		2-outcome categorical whose KL against <Katex math={"q"} />
		collapses cleanly.
	</li>
	<li>Natural handoff to §Relation to Continuous Diffusion next.</li>
</ul>

<hr class="section-divider" />

<h2 id="order-matters">Generation Order Matters</h2>

<p>
	The previous section defined what a masked diffusion model <em>is</em>.
	Once you actually try to sample from one, a quirk that doesn't come up
	in autoregressive generation starts to matter, and it traces back to
	the structural fact that the reverse step factorizes across positions.
</p>

<p>
	The forward process corrupts each token position independently; that's
	how the model is trained. The reverse step inherits the same shape.
	In one forward pass the model produces, for every masked position, a
	categorical distribution over the vocabulary &mdash; and if a step
	unmasks more than one position, those samples are drawn independently.
	The sampler treats
	<Katex math={"p_\\theta(\\mathbf{x}_M \\mid \\mathbf{x}_U)"} /> as
	<Katex math={"\\prod_{i \\in M} p_\\theta(\\mathbf{x}^i \\mid \\mathbf{x}_U)"} />
	&mdash; a product of per-position marginals, not the true joint. The
	reverse distribution is <em>factorized</em>.
</p>

<p>
	The consequence is easy to see on a short example. Consider the sentence
	&ldquo;The dog is [MASK] so he wants to [MASK].&rdquo; A well-trained model
	will produce roughly even marginals at each masked slot &mdash; the first
	between something like <em>tired</em> and <em>hungry</em>, the second
	between <em>eat</em> and <em>sleep</em>. Both marginals are individually
	plausible. But the joint concentrates on the two coherent pairs
	(<em>tired</em>, <em>sleep</em>) and (<em>hungry</em>, <em>eat</em>); the
	other two are semantically incoherent. Sampling the two positions
	independently produces an incoherent pair roughly half the time.
</p>

<Figure backgroundVisible={false} isActive={orderMattersActive}>
	{#snippet children()}
		<OrderMattersFigure
			isActive={orderMattersActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
		/>
	{/snippet}
</Figure>

<p>
	Order is the fix. Commit the first mask &mdash; say to <em>tired</em>
	&mdash; and the next forward pass conditions on that commit; the second
	position's marginal now concentrates sharply on <em>sleep</em>. This is
	why real inference typically unmasks a small number of tokens per step
	and iterates: each step's marginal is close to the correct conditional
	given every commit so far. Which mask to fill next is a real lever too.
	Adaptive orderings that pick the most confident (or lowest-entropy)
	position at each step consistently outperform a random schedule on
	tasks whose dependency structure isn't left-to-right
	<HoverableReference
		id="kim2025trainworstplanbest"
		{bibEntries}
		{citations}
	/>.
</p>

<Figure backgroundVisible={false} isActive={sequentialRecoveryActive}>
	{#snippet children()}
		<SequentialRecoveryFigure
			isActive={sequentialRecoveryActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
		/>
	{/snippet}
	{#snippet caption()}
		Rolling out one commit at a time recovers the joint. Pass&nbsp;1 uses
		the same near-50/50 marginals as the previous figure, but commits
		only the first mask to its argmax, <em>tired</em>. Pass&nbsp;2 re-runs
		the model with <em>tired</em> in place; the second position's
		marginal has now concentrated sharply on <em>sleep</em>, and the
		coherent sentence falls out.
	{/snippet}
</Figure>

<p>
	The punchline: parallel decoding is not a structural free lunch.
	Committing <Katex math={"K"} /> tokens in one step means sampling from a
	product of <Katex math={"K"} /> marginals rather than the
	<Katex math={"K"} />-way joint &mdash; the more masks you fill at once,
	the further you draw from the true distribution the model was trained
	on. Sequential decoding trades wall-clock for coherence; parallel
	decoding trades coherence for wall-clock. This tension isn't an
	implementation quirk; it's the modeling reason behind the caching
	story in the follow-up post.
</p>

<!-- Hidden: "Every Commit Rewrites Every Logit" subsection. Kept in
     source for future use; not rendered. -->
{#if false}
	<h3 id="bidirectional-context-updates">Every Commit Rewrites Every Logit</h3>

	<p>
		The factorized reverse step said something about which positions'
		<em>samples</em> depend on each other. There's a companion fact about
		which positions' <em>logits</em> depend on each other, and it comes
		from bidirectional attention. Every hidden state in a masked
		transformer attends to every other position, so committing a single
		token doesn't just fix that one slot &mdash; it changes the
		representation at every other position, including the ones that stay
		masked.
	</p>

	<Figure backgroundVisible={false} isActive={representationRippleActive}>
		{#snippet children()}
			<RepresentationRippleFigure
				isActive={representationRippleActive}
				maskColor={MASK_COLOR}
				maskTextColor={MASK_TEXT_COLOR}
			/>
		{/snippet}
	</Figure>

	<p>
		This is a feature, not a bug. In autoregressive generation, past
		key-value activations are frozen the moment a token commits; the model
		can only condition forward. In a masked diffusion model there is no
		&ldquo;past&rdquo; &mdash; the state is bidirectional through and
		through, so every commit is an opportunity to sharpen beliefs about
		every remaining position, including ones to its left. It's what makes
		iterative refinement worth doing. It's also what makes those iterations
		expensive, but that's a story for the next post.
	</p>
{/if}

<h2 id="extensions">Extensions and Further Reading</h2>

<!-- PLAN: a short pointer section. Not survey-depth — each bullet is a
	one-or-two-sentence teaser plus a citation. Groupings:

	- Efficiency (block diffusion, semi-AR, KV-cache workarounds). One
	  paragraph. Forward-reference the companion post on efficient
	  non-autoregressive generation for the deep dive.

	- Adaptive unmasking strategies (confidence-based, entropy-based,
	  learned schedulers). Kim et al. 2025 (kim2025trainworstplanbest) is
	  the anchor citation. Set up §Idiosyncrasies §Order Matters as the
	  starting point.

	- Remasking / anytime generation. Wang et al. 2026
	  (wang2026remaskingdiscretediffusionmodels). Ties back to
	  §Idiosyncrasies §Joint Incoherence as the motivation.

	- Large-scale MDLMs in the wild. LLaDA, Mercury (Inception Labs) as
	  headline examples that this is not a toy paradigm. Need to add bib
	  entries for these — currently NOT in bibliography.bib.

	Optional adds if space allows (probably cut):
	- Discrete diffusion beyond absorbing state (D3PM lineage).
	- Multimodal masked diffusion (mask-based generation for images/audio).
	- Distillation / few-step MDLM sampling. -->

<h2 id="acknowledgements">Acknowledgements</h2>

<h2 id="references">References</h2>

<Bibliography {citations} {bibEntries} />

<!-- Comments (giscus) — populated at runtime by /comments.js -->
<h2 id="comments" class="section-heading">Comments</h2>

<style>
	/* Visible outline stubs for sections whose prose is still in-progress.
	   `.stub-note` is a section-level intro comment; `.stub-list` is a
	   bulleted plan of what each paragraph will contain. Both render at
	   reduced opacity with a subtle tint so a scanning reader can tell
	   the section isn't final. Remove these blocks and their styling once
	   the section is written. */
	.stub-note,
	.stub-list {
		background: #fff8ec;
		border-left: 3px solid #f1942b;
		padding: 0.5rem 0.8rem;
		color: #6b5a3a;
		font-size: 0.95rem;
	}
	.stub-note {
		font-style: italic;
	}
	.stub-list {
		margin: 0.5rem 0;
	}
	.stub-list li {
		margin: 0.25rem 0;
	}
	/* Bold lead-in phrase that sits above each stub-list block, functioning
	   as the paragraph's inline "title" now that we no longer use h3
	   headings for these sub-topics. Slightly bigger than body text and
	   uses the accent-orange to match the stub-note bar on the left. */
	.stub-lead {
		font-size: 1.05rem;
		color: #6b5a3a;
		margin: 1.25rem 0 0.25rem;
	}
	.stub-lead strong {
		color: #b06a10;
	}

	.section-divider {
		border: none;
		border-top: 1px solid #e0e0e0;
		margin: 2.5rem 0;
	}

	/* Tighten the bottom margin on inline (backgroundVisible={false}) figures
	   in this app. The shared Figure component sets 0.5rem top/bottom for the
	   .no-background-figure variant; we override just the bottom here. */
	:global(.figure.no-background-figure) {
		margin-bottom: 0.15rem;
	}

	/* Hero pair — stack the two ForwardReverseFigure panels tightly so they
	   read as one visual unit rather than two adjacent figures. A single
	   direction badge sits above the pair; a single TimeSlider sits below.
	   The per-panel badges and sliders inside each ForwardReverseFigure are
	   suppressed via `showDirectionBadge={false}` and `showSlider={false}`. */
	.hero-pair {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.hero-pair :global(.figure.no-background-figure) {
		margin-top: 0;
		margin-bottom: 0;
	}

	/* Direction badge above the hero pair — same design as the per-panel
	   badge inside ForwardReverseFigure but larger, centered, and with a
	   pulsing-dashed-line animation on the arrow so the eye picks up the
	   direction of travel. The `stroke-dashoffset` animation drifts the
	   dash pattern along the line's length; reversing the animation
	   direction (via the `.is-reverse` modifier) drifts it the other way. */
	.hero-badge {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 440px;
		max-width: 100%;
		height: 40px;
		margin: 0 auto 0.5rem;
		pointer-events: none;
	}
	.hero-badge-arrow {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* Belt-and-suspenders: keep the arrow head from being clipped when the
		   SVG is stretched. viewBox padding (x1/x2 = 20/300 on a 0-320 box)
		   already leaves room, but overflow: visible ensures no clip either
		   way. */
		overflow: visible;
	}
	.hero-badge-arrow line {
		animation: hero-dash-drift 1.4s linear infinite;
	}
	@keyframes hero-dash-drift {
		from {
			stroke-dashoffset: 0;
		}
		to {
			/* One full dash + gap period = 12 + 8 = 20 units. Drifting by
			   -20 makes the dashes visually flow toward the arrow tip. */
			stroke-dashoffset: -20;
		}
	}
	.hero-badge-text {
		position: relative;
		z-index: 1;
		padding: 0 0.8rem;
		background: #ffffff;
		font-size: 1.3rem;
		font-weight: 600;
		color: #666;
		letter-spacing: 0.02em;
	}

	/* Descriptor line sitting between the direction badge and the paired
	   panels. Names both variants of the diffusion process the panels are
	   about to show. */
	.hero-descriptor {
		text-align: center;
		font-size: 1.3rem;
		color: #444;
		margin: 0 auto 0.75rem;
		max-width: 42rem;
	}

	/* Second descriptor (above the masked panel) gets extra top margin so it
	   visually pairs with the panel below it rather than the panel above. */
	.hero-descriptor-masked {
		margin-top: 1.75rem;
	}

	/* Single TimeSlider below the pair, bound to the shared player. */
	.hero-slider {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		margin-top: 0.5rem;
	}

	/* Caption for the whole hero pair, rendered as a plain <p> below the
	   slider so the slider sits between the animation and the caption text.
	   Styled to match the shared Figure component's `.figure-caption` in the
	   ui package. */
	.hero-caption {
		font-size: 1.1rem;
		line-height: 1.5;
		color: #666;
		text-align: left;
		margin: 0.75rem 0 0;
	}

	/* Fallback for display-mode equations that overflow the viewport on
	   narrow screens. The shared <Katex> component sets overflow: visible on
	   its wrapper, so wide equations spill off the right edge on mobile.
	   Instead of horizontal scroll, we proportionally shrink the equation
	   with transform: scale() at two breakpoints. transform doesn't shrink
	   the layout box, so we compensate with negative vertical margins to
	   avoid awkward whitespace above and below. */
	.equation-scroll {
		display: flex;
		justify-content: center;
		max-width: 100%;
	}
	@media (max-width: 720px) {
		.equation-scroll > :global(*) {
			transform: scale(0.75);
			transform-origin: center;
		}
		.equation-scroll {
			margin-top: -0.6em;
			margin-bottom: -0.6em;
		}
	}
	@media (max-width: 430px) {
		.equation-scroll > :global(*) {
			transform: scale(0.55);
			transform-origin: center;
		}
		.equation-scroll {
			margin-top: -1.2em;
			margin-bottom: -1.2em;
		}
	}
</style>
