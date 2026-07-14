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
	import CausalAttentionFigure from './figures/CausalAttentionFigure.svelte';
	import ForwardReverseFigure from './figures/ForwardReverseFigure.svelte';
	import ModelPredictionFigure from './figures/ModelPredictionFigure.svelte';
	import ModelPredictionInlineFullMask from './figures/ModelPredictionInlineFullMask.svelte';
	import MLMLossInline from './figures/MLMLossInline.svelte';
	import MaskToken from './figures/MaskToken.svelte';
	import AbsorbingMaskFigure from './figures/AbsorbingMaskFigure.svelte';
	import OrderMattersFigure from './figures/OrderMattersFigure.svelte';
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
	const causalAttentionActive = writable(false);
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
	const absorbingMaskActive = writable(false);
	const orderMattersActive = writable(false);
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
	Multiple tokens can be unmasked in one reverse step, so generation is
	no longer serial. Tokens can be revisited and revised after they're
	first produced, a technique called <em>remasking</em>
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
	builds on: <em>masked language modeling</em>. The task is simple to state.
	Take a sentence, replace a few of its tokens with a special
	<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> symbol, and ask a neural network to predict the
	original tokens at the masked positions. For each masked position, the
	network emits a full <em>categorical distribution</em> over the vocabulary,
	and we take the argmax (or sample from it) to fill the slot in.
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
	<Katex math={"\\mathbf{x}_\\theta"} /> then predicts a categorical
	distribution over the vocabulary at every masked position, and the loss is
	cross-entropy on those positions only:
</p>

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"\\mathcal{L}_{\\mathrm{MLM}} = -\\, \\mathbb{E}_{\\mathbf{x},\\, M} \\left[ \\sum_{\\ell \\in M} \\log p_\\theta(\\mathbf{x}^\\ell \\mid \\tilde{\\mathbf{x}}) \\right]"}
/>

<p>
	Geometrically, cross-entropy is a force pulling the model's predicted
	distribution <Katex math={"\\mathbf{x}_\\theta^\\ell"} /> toward the
	one-hot target <Katex math={"\\mathbf{x}^\\ell"} />. As training
	progresses, whatever mass the model is currently spreading over
	near-miss vocabulary words gets pulled onto the single correct word.
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
	for downstream classifiers and encoders. But BERT was never designed to
	<em>generate</em> text, and it turns out that a 15%-MLM model can't do it,
	for a subtle reason.
</p>

<p>
	<strong>How would we go about <em>generating</em> a novel sequence with a
	model trained like this?</strong> The natural thing to try is to hand it
	an input that
	is <em>entirely</em> <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> and ask it to fill in every
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
	But this input is drawn from a distribution the model has never
	encountered during training: every training example BERT ever saw had
	85% of its tokens still visible as context. With no real tokens to
	condition on, the model has nothing to anchor its predictions to &mdash;
	the outputs are essentially untrained behavior. And the problem is not
	unique to the 100% case. To generate a sequence <em>from scratch</em>
	we need a model that behaves sensibly all the way from &ldquo;fully
	masked&rdquo; to &ldquo;almost done&rdquo;, which is a continuum of
	masking rates that BERT's fixed 15% schedule simply never visits.
</p>

<p>
	This is the gap masked diffusion closes. The core observation is small
	but transformative: instead of training on a single fixed masking rate,
	train the same architecture on a whole <em>family</em> of masking rates
	&mdash; every rate from 0% to 100%. The resulting model can be handed an
	input at any level of corruption and produce a sensible prediction, and
	that turns it from a representation learner into a generative model.
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

<h3 id="the-transformer">The Transformer</h3>

<p>
	The neural network doing the work in a masked diffusion model is the same
	transformer stack a modern large language model would use &mdash; the
	same embedding layer, the same alternation of self-attention blocks and
	feed-forward MLPs, the same residual stream and layer normalization,
	the same tied unembedding at the top. What changes is a single detail
	inside the self-attention layers: the attention pattern is
	<em>bidirectional</em>. Every position's query attends to every other
	position's keys, not just the ones to its left.
</p>

<Figure backgroundVisible={false} isActive={causalAttentionActive}>
	{#snippet children()}
		<CausalAttentionFigure isActive={causalAttentionActive} />
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 10.</span> Causal self-attention
		(left) versus bidirectional attention (right). Each row is a query;
		each column is a key. Under the causal mask used by autoregressive
		transformers, every query attends only to past-and-current keys and
		the matrix is lower-triangular. Under bidirectional attention every
		query sees every key, and the full square fills in.
	{/snippet}
</Figure>

<p>
	This is exactly the attention pattern BERT and other MLMs use. In an
	autoregressive transformer the query at position <em>t</em> can only
	attend to keys at positions <Katex math={"\\le t"} />, so information
	flows strictly one way: past to future. In a masked diffusion
	transformer that constraint is lifted. Every hidden state is a function
	of the whole current context &mdash; both the tokens to its left and
	the tokens to its right. That is the property that lets the model fill
	in an interior <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />
	sensibly: it can condition on evidence from either side.
</p>

<p>
	Everything downstream of this choice treats the transformer as a black
	box &mdash; a function <Katex math={"\\mathbf{x}_\\theta(\\mathbf{z}_t, t)"} />
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
	The model <Katex math={"\\mathbf{x}_\\theta(\\mathbf{z}_t, t)"} /> is
	trained to predict a categorical over the <em>clean</em> token at each
	masked position (the <em>SUBS</em> parameterization: mask probability is
	fixed at zero, and unmasked positions carry over unchanged). Plugging
	<Katex math={"\\mathbf{x}_\\theta"} /> into the true posterior of the
	forward process gives the reverse step
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
	With the forward and reverse processes fixed, the training objective
	writes itself. We want the model to be accurate at <em>every</em> masking
	rate visited by the schedule, so we take an expectation of the
	per-rate MLM loss from the previous section over
	<Katex math={"t"} /> as well as over the corruption
	<Katex math={"q(\\mathbf{z}_t \\mid \\mathbf{x})"} /> at that rate. The
	continuous-time NELBO
	<HoverableReference
		id="sahoo2024simpleeffectivemaskeddiffusion"
		{bibEntries}
		{citations}
	/> collapses (after the SUBS parameterization) to exactly this &mdash; a
	weighted cross-entropy on the masked positions:
</p>

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"\\mathcal{L}_{\\mathrm{MDLM}} = \\mathbb{E}_t \\left[ \\dfrac{\\alpha'_t}{1 - \\alpha_t} \\smash{\\underbrace{\\left(-\\, \\mathbb{E}_{q(\\mathbf{z}_t \\mid \\mathbf{x})} \\left[ \\sum_{\\ell \\in M_t} \\log p_\\theta(\\mathbf{x}^\\ell \\mid \\mathbf{z}_t) \\right]\\right)}_{\\mathcal{L}_{\\mathrm{MLM}}(\\mathbf{z}_t)}} \\right]"}
/>

<p>
	Here <Katex math={"M_t = \\{\\ell : \\mathbf{z}_t^\\ell = \\mathbf{m}\\}"} />
	is the set of positions masked at time <Katex math={"t"} />, so the
	underbraced term is literally the MLM loss from the previous section,
	evaluated on the corrupted sequence <Katex math={"\\mathbf{z}_t"} />. The
	MDLM objective is that same MLM loss, averaged over all rates
	<Katex math={"t"} /> in the schedule and weighted by
	<Katex math={"\\alpha'_t / (1 - \\alpha_t)"} />. Unmasked positions
	contribute zero, since carry-over guarantees a perfect prediction there.
</p>

<h3 id="mdlm-loss-as-elbo">The MDLM Loss as an ELBO</h3>

<p>
	It's worth asking where the weighting
	<Katex math={"\\alpha'_t / (1 - \\alpha_t)"} /> comes from. The MLM
	term is easy to motivate &mdash; we already know cross-entropy at
	masked positions from the previous section &mdash; but why this
	particular schedule-dependent prefactor? The answer is that MDLM's
	training objective is not a heuristic. It is the negative
	<em>evidence lower bound</em> (ELBO) of an absorbing-state discrete
	diffusion process, and the weighting drops out of a standard
	variational argument. This section sketches that argument at a
	high level; the full derivation lives in the MDLM paper
	<HoverableReference
		id="sahoo2024simpleeffectivemaskeddiffusion"
		{bibEntries}
		{citations}
	/>.
</p>

<p>
	The setup mirrors continuous diffusion almost verbatim. We want to
	model a data distribution <Katex math={"p(\\mathbf{x})"} /> over
	sequences that is otherwise intractable to write down. Instead of
	fitting it directly, we introduce a hand-crafted forward corruption
	<Katex math={"q(\\mathbf{z}_t \\mid \\mathbf{x})"} /> &mdash; the
	absorbing-mask schedule from a few sections up &mdash; and a
	parameterized reverse step
	<Katex math={"p_\\theta(\\mathbf{z}_s \\mid \\mathbf{z}_t)"} /> that
	tries to undo it. The variational bound then decomposes the intractable
	log-likelihood into a sum of tractable KL divergences, one per timestep:
</p>

<div class="equation-scroll">
<Katex
	displayMode
	displayFontSize="1.15em"
	math={"\\log p_\\theta(\\mathbf{x}) \\;\\ge\\; - \\sum_t \\mathbb{E}_q \\big[ \\mathrm{KL}\\!\\left( q(\\mathbf{z}_s \\mid \\mathbf{z}_t, \\mathbf{x}) \\;\\|\\; p_\\theta(\\mathbf{z}_s \\mid \\mathbf{z}_t) \\right) \\big] \\;+\\; \\text{(boundary terms)}"}
/>
</div>

<p>
	This is the same ELBO you would write down for continuous diffusion,
	just with a categorical corruption process instead of a Gaussian one.
	Maximizing this lower bound on <Katex math={"\\log p(\\mathbf{x})"} />
	is our training objective. The interesting step is what happens to a
	single term in the sum.
</p>

<p>
	Under the SUBS parameterization from the previous subsection, the true
	posterior <Katex math={"q(\\mathbf{z}_s \\mid \\mathbf{z}_t, \\mathbf{x})"} />
	is deterministic at unmasked positions and a simple two-outcome
	categorical at masked positions. Plugging in
	<Katex math={"p_\\theta(\\mathbf{z}_s \\mid \\mathbf{z}_t)"} /> and
	unrolling the KL yields, at each masked position <Katex math={"\\ell"} />,
	a scalar multiple of cross-entropy against the clean token:
</p>

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"\\mathrm{KL}\\!\\left( q \\;\\|\\; p_\\theta \\right) \\;=\\; \\frac{\\alpha_s - \\alpha_t}{1 - \\alpha_t} \\, \\big[ -\\log p_\\theta(\\mathbf{x}^\\ell \\mid \\mathbf{z}_t) \\big] \\quad \\text{for } \\ell \\in M_t"}
/>

<p>
	Two things fall out. First, the summand is cross-entropy at masked
	positions &mdash; exactly the object introduced in the MLM section.
	Second, it comes with a schedule-dependent prefactor
	<Katex math={"(\\alpha_s - \\alpha_t) / (1 - \\alpha_t)"} />. Taking
	the continuous-time limit of the sum turns
	<Katex math={"(\\alpha_s - \\alpha_t)"} /> into
	<Katex math={"\\alpha'_t \\, dt"} />, and the sum becomes an integral
	over <Katex math={"t"} /> whose integrand is
	<Katex math={"\\alpha'_t / (1 - \\alpha_t)"} /> times the per-rate MLM
	loss. That is exactly the objective from the previous subsection.
</p>

<p>
	The upshot: MDLM is not diffusion-<em>flavored</em>. It is a specific
	instance of the same variational recipe that produces continuous
	diffusion &mdash; data plus a hand-crafted noising process, a
	parameterized reverse step, an ELBO on the log-likelihood, a per-step
	KL that collapses to a familiar loss. What differs is the corruption
	(categorical absorbing state instead of Gaussian noise) and, as a
	consequence, the shape of the per-step KL and the resulting weighting.
	The scaffolding is otherwise identical.
</p>

<h3 id="relation-to-continuous-diffusion">Relation to Continuous Diffusion</h3>

<p>
	In <strong>continuous diffusion</strong>, the forward process transforms
	data into a Gaussian, destroying information, and the reverse process
	aims to generate new data by reversing this information-destroying
	process.
</p>

<Figure backgroundVisible={false} isActive={forwardReverseContinuousActive}>
	{#snippet children()}
		<ForwardReverseFigure
			isActive={forwardReverseContinuousActive}
			variant="continuous"
			maskColor="#99BCDC"
			crossFade={false}
			sharedPlayer={forwardReverseSharedPlayer}
		/>
	{/snippet}
</Figure>

<p>
	In <strong>masked diffusion</strong>, the forward process destroys
	information through discrete masking, and likewise generation is framed
	as reversing this forward masking process.
</p>

<Figure backgroundVisible={false} isActive={forwardReverseMaskedActive}>
	{#snippet children()}
		<ForwardReverseFigure
			isActive={forwardReverseMaskedActive}
			variant="masked"
			maskColor="#99BCDC"
			crossFade={false}
			sharedPlayer={forwardReverseSharedPlayer}
		/>
	{/snippet}
</Figure>

<h2 id="idiosyncrasies">Idiosyncrasies of Masked Diffusion</h2>

<p>
	The previous section defined what a masked diffusion model <em>is</em>.
	Once you actually try to sample from one, two quirks that don't come up
	in autoregressive generation start to matter. Both trace back to the
	same structural fact &mdash; the reverse step factorizes across
	positions &mdash; and they set the terms of the speed-versus-coherence
	tradeoffs that dominate the follow-up post on efficient decoding.
</p>

<h3 id="order-matters">Generation Order Matters</h3>

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
	&ldquo;The dog is [MASK] and wants to [MASK].&rdquo; A well-trained model
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
