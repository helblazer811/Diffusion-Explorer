<script lang="ts">
	// Are Masked Diffusion Language Models Actually Faster?
	//
	// Full-length post: opens with a hero showing AR vs. block-diffusion on a
	// shared clock, then introduces masked diffusion (background, MLM, and the
	// forward/reverse/loss formalism), then dives into why naive MDLM inference
	// isn't faster than AR and what it takes to recover efficiency (causal
	// attention, KV caching, block diffusion).
	import {
		ArticleHeader,
		Figure,
		Katex,
		Bibliography,
		HoverableReference,
		loadBibliography,
		collectCitations,
		type BibEntry,
		type CitationInfo
	} from '@diffusion-explorer/ui';
	import { base } from '$app/paths';
	import { onMount, onDestroy, tick } from 'svelte';
	import { writable, derived } from 'svelte/store';
	import { Player } from '@helblazer811/tempus';

	import MaskToken from './figures/MaskToken.svelte';
	import GenerationComparisonFigure from './figures/GenerationComparisonFigure.svelte';
	import InformationFlowFigure from './figures/InformationFlowFigure.svelte';
	import CausalLanguageModelingFigure from './figures/CausalLanguageModelingFigure.svelte';
	import CausalAttentionFigure from './figures/CausalAttentionFigure.svelte';
	import DualRoleHiddenStatesFigure from './figures/DualRoleHiddenStatesFigure.svelte';
	import KVCacheFigure from './figures/KVCacheFigure.svelte';
	import RepresentationRippleFigure from './figures/RepresentationRippleFigure.svelte';
	import BlockDiffusionFigure from './figures/BlockDiffusionFigure.svelte';
	import DecodingTrajectoryFigure from './figures/DecodingTrajectoryFigure.svelte';
	import ForwardReverseFigure from './figures/ForwardReverseFigure.svelte';
	import ModelPredictionFigure from './figures/ModelPredictionFigure.svelte';
	import ModelPredictionInlineFullMask from './figures/ModelPredictionInlineFullMask.svelte';
	import MLMLossInline from './figures/MLMLossInline.svelte';
	import AbsorbingMaskFigure from './figures/AbsorbingMaskFigure.svelte';
	import {
		buildForwardReverseTimeline,
		type ForwardReverseState
	} from './figures/forward_reverse_timeline';

	// Shared visibility stores: each wrapping <Figure> sets one (via
	// IntersectionObserver + tab visibility), and the figure inside reads it to
	// play/pause its tempus animation only while on-screen.
	const genCompareActive = writable(false);
	const trajectoryActive = writable(false);
	// A single Player is shared between the two ForwardReverseFigure instances
	// in §Relation to Continuous Diffusion so their continuous and masked
	// timelines stay in lockstep. Each figure's visibility is tracked so we can
	// play the shared Player whenever EITHER paired figure is on-screen.
	const forwardReverseContinuousActive = writable(false);
	const forwardReverseMaskedActive = writable(false);
	const forwardReverseSharedActive = derived(
		[forwardReverseContinuousActive, forwardReverseMaskedActive],
		([$c, $m]) => $c || $m
	);
	const modelPredictionActive = writable(false);
	const modelPredictionInlineFullMaskActive = writable(false);
	const mlmLossInlineActive = writable(false);
	const informationFlowActive = writable(false);
	const causalLMActive = writable(false);
	const causalAttentionActive = writable(false);
	const dualRoleActive = writable(false);
	const kvCacheActive = writable(false);
	const representationRippleActive = writable(false);
	const blockDiffusionActive = writable(false);
	const absorbingMaskActive = writable(false);

	// Shared clock driving both ForwardReverseFigure variants (continuous +
	// masked). Built on mount so SSR sees an undefined player (the figure
	// tolerates `sharedPlayer` being undefined at first render and picks it
	// up once passed).
	let forwardReverseSharedPlayer = $state<Player<ForwardReverseState> | undefined>(undefined);

	// Shared visual identity for every "pending token" placeholder on this page.
	// MASK_COLOR is the rectangle background; MASK_TEXT_COLOR is the [MASK]
	// label sitting on top of it — a darker shade in the same blue family.
	const MASK_COLOR = '#cfe0f2';
	const MASK_TEXT_COLOR = '#33506e';

	// Bibliography state — loaded from /bibliography.bib on mount, then the
	// DOM is walked for <HoverableReference> elements so we can render a
	// numbered <Bibliography /> at the bottom. Both stay empty on SSR
	// (adapter-static) and fill in client-side.
	let bibEntries: Map<string, BibEntry> | null = $state(null);
	let citations: CitationInfo[] = $state([]);

	onMount(async () => {
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
	// rewind when both scroll away.
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

	onDestroy(() => {
		forwardReverseSharedPlayer?.dispose();
	});
</script>

<ArticleHeader
	title="Are Masked Diffusion Language Models Actually Faster?"
	subtitle="A Visual Tour of Efficient Non-Autoregressive Generation"
	authors={[
		{ name: 'Alec Helbling', link: 'https://alechelbling.com/' }
	]}
	date="July 13, 2026"
/>

<Figure backgroundVisible={false} isActive={genCompareActive}>
	{#snippet children()}
		<GenerationComparisonFigure
			isActive={genCompareActive}
			maskColor={MASK_COLOR}
			fontSize="1.15rem"
			crossFade={false}
			scalePulse={true}
		/>
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 1.</span> Autoregressive vs. block
		diffusion, driven by one shared reveal clock. Top: tokens generated
		strictly left-to-right (AR); pending slots are a subtle dashed
		underline since AR has no <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />
		sentinel. Bottom: tokens grouped into fixed-size blocks; every token
		in a block un-masks simultaneously in one decoding step, and blocks
		complete strictly left-to-right (block diffusion). Pending slots show
		<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />. The bottom
		row finishes about 4&times; sooner than the top row on the same shared
		clock, and both then rest before the animation auto-cycles.
	{/snippet}
</Figure>

<hr class="section-divider" />

<h2 id="introduction">Introduction</h2>

<p>
	Autoregressive language models are the workhorse of modern AI.
	Practically every major LLM in production today, from GPT to Claude to
	Gemini, is autoregressive at its core: they generate text one
	token at a time, left to right, each token conditioned on everything that
	came before. A remarkable amount of engineering effort has gone into
	making this loop fast. Techniques like kernel optimization, KV caching,
	and speculative decoding <HoverableReference
		id="leviathan2023fastinferencetransformersspeculative"
		{bibEntries}
		{citations}
	/> shave cost off every generated token, and modern
	GPU architectures and custom accelerators like TPUs are co-designed with
	this particular workload in mind, all to squeeze more tokens per second
	out of the same fundamentally sequential recipe. But at some point it's
	worth asking: what comes next? What are the alternatives to
	autoregression?
</p>

<p>
	Masked diffusion language models <HoverableReference
		id="sahoo2024simpleeffectivemaskeddiffusion"
		{bibEntries}
		{citations}
	/> offer one such alternative. Where an
	autoregressive model builds a sequence left to right one token at a time,
	a masked diffusion model starts from a fully-masked sequence and
	progressively unmasks tokens in any order, potentially several at once.
	The most immediately appealing consequence is parallelism:
	because multiple tokens can be unmasked in a single reverse step,
	generation is no longer bottlenecked on producing one token at a time.
	There are other reasons to be interested. The model can revisit
	and revise tokens it already committed to, a technique called
	<em>remasking</em> <HoverableReference
		id="wang2026remaskingdiscretediffusionmodels"
		{bibEntries}
		{citations}
	/>. And there is evidence that a non-autoregressive unmasking
	order is a better inductive bias for problems whose dependency
	structure isn't left-to-right <HoverableReference
		id="kim2025trainworstplanbest"
		{bibEntries}
		{citations}
	/>. But the parallelism
	argument is the one that promises a clean systems win, and it is what
	first drew attention to this paradigm.
</p>

<p>
	But applied naively, <em>they aren't actually faster</em>. Unmasking
	many tokens per step sounds like a straightforward speedup, and it
	would be, if inference cost were just "number of forward passes." It
	isn't. Masked diffusion models leverage
	bidirectional attention, which is strictly more powerful than the
	causal attention that autoregressive models use, but at the cost of
	violating core assumptions required for KV caching. KV caching is the
	ability to reuse computed keys and values from previous passes, made
	possible by the one-way flow of information from left to right. The rest of this post is about that
	tradeoff: what assumptions enable efficient AR inference, why masked
	diffusion violates these assumptions, and how the field is putting
	the pieces back together.
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

<hr class="section-divider" />

<h2 id="accelerated-decoding">Accelerated Decoding</h2>

<p>
	Applied naively, masked diffusion is not actually faster than
	autoregression. The naïve promise &mdash; "unmask many tokens at once,
	skip the token-by-token loop" &mdash; only holds if we ignore how
	autoregressive inference is actually made cheap in practice. AR is fast
	not because it does less work per token in the abstract, but because
	the systems layer underneath it exploits a very specific property of
	the model: past hidden states never depend on future tokens. A masked
	diffusion model doesn't have that property, and once we look at what
	that costs on real hardware, the raw parallelism advantage evaporates.
	This section walks through the pieces: the causal-attention mask
	underlying AR transformers, how KV caching exploits it to make
	inference cheap, why masked diffusion breaks the caching assumption,
	and finally how block diffusion recovers a version of caching without
	giving up parallel within-block decoding.
</p>

<h3 id="information-flow">Information Flow</h3>

<p>
	Before we get to the attention-matrix picture, it helps to look at what
	is being computed at the token level. Generating the next slot in a
	sequence is, mechanically, an act of pulling information in from every
	other slot the model is allowed to attend to. The two paradigms differ in
	exactly one thing: <em>which</em> other slots are allowed to contribute.
	In a causal model, only positions to the left of the target contribute
	&mdash; information flows one way, past to future. In a bidirectional
	model &mdash; the setting a masked diffusion transformer operates in
	&mdash; every other position contributes, on both sides of the target.
</p>

<Figure backgroundVisible={false} isActive={informationFlowActive}>
	{#snippet children()}
		<InformationFlowFigure isActive={informationFlowActive} />
	{/snippet}
</Figure>

<h3 id="causal-attention">Causal Attention</h3>

<p>
	Autoregressive generation runs one token at a time, left to right. Each
	new token is predicted from every token that came before it &mdash; and
	<em>only</em> from tokens that came before it. Information flows
	strictly forward in time, so a token at position <em>t</em> is a
	function of tokens 1…<em>t</em>&minus;1, never of anything to its
	right.
</p>

<Figure backgroundVisible={false} isActive={causalLMActive}>
	{#snippet children()}
		<CausalLanguageModelingFigure isActive={causalLMActive} />
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 2.</span> Causal language modeling.
		Each row of the rollout appends one token to the right of the
		previous row. Below each new token, pulses flow along invisible
		arcs from every prior token in the sentence, staggered
		left-to-right &mdash; a visual reminder that a causal model
		conditions the next token on all past tokens and nothing else.
	{/snippet}
</Figure>

<p>
	This one-way flow is enforced inside the transformer by a specific
	attention pattern. The query at position <em>t</em> can only attend to
	keys at positions <Katex math={"\\le t"} /> &mdash; every row of the
	attention matrix is masked to a lower-triangular shape. This is
	<em>causal attention</em>, and it is the property that makes efficient
	AR inference possible.
</p>

<Figure backgroundVisible={false} isActive={causalAttentionActive}>
	{#snippet children()}
		<CausalAttentionFigure isActive={causalAttentionActive} />
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 3.</span> Causal self-attention
		(left) versus bidirectional attention (right). Each row is a query;
		each column is a key. Under the causal mask, every query attends only
		to past-and-current keys and the matrix is lower-triangular. Under
		bidirectional attention every query can see every key, so the full
		square fills in &mdash; there is no past-only structure to cache.
	{/snippet}
</Figure>

<p>
	One consequence of the causal mask is that a hidden state at position
	<em>p</em> quietly plays two different roles. While the model is
	predicting <em>x<sub>p</sub></em>, the top-of-column-<em>p</em> hidden
	state is read <em>up</em> by the LM head as a belief about what token
	should land in slot <em>p</em>. Once <em>x<sub>p</sub></em> is sampled,
	that belief is stale &mdash; every later step has direct access to the
	sampled token. But the same hidden state's K and V projections, at
	every layer, are cached and read <em>right</em> by every subsequent
	query as durable context about what sits at position <em>p</em>. Two
	roles, two directions, wildly different lifetimes.
</p>

<Figure backgroundVisible={false} isActive={dualRoleActive}>
	{#snippet children()}
		<DualRoleHiddenStatesFigure isActive={dualRoleActive} />
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 4.</span> The dual role of a
		hidden state in a causal transformer. Left: the model is predicting
		<em>x<sub>3</sub></em>; the top-of-column-3 hidden state is read up
		through the unembedding as logits for the next token &mdash; the
		<em>belief</em> role. Right: the model has advanced and is now
		predicting <em>x<sub>5</sub></em>; the K and V projections of the
		<em>same</em> hidden state at position 3, at every attention layer,
		are read by the query at position 5 as durable context &mdash; the
		<em>content</em> role. Belief lives one decode step; content lives
		for the rest of the sequence, but the KV cache freezes both.
	{/snippet}
</Figure>

<p>
	This dual-role tension shows up empirically. EAGLE-3
	<HoverableReference
		id="li2025eagle3scalinginferenceacceleration"
		{bibEntries}
		{citations}
	/>
	found that the top-layer feature of a well-trained transformer is
	over-specialized to next-token prediction, and a good draft model
	benefits from fusing low, mid, and high layer features rather than
	taking only the top &mdash; the same fact from the other direction.
	The top of the stack is a good <em>belief</em>; the whole column is
	the <em>content</em>.
</p>

<h3 id="kv-cache">KV Caching</h3>

<p>
	The one-way flow of information is what lets autoregressive inference
	reuse work across generation steps. Because past keys and values never
	depend on tokens that come later, they never need to be recomputed
	when new tokens are generated &mdash; they are safe to cache. The keys
	and values computed for each past token are stored in memory once and
	read back on every subsequent step, instead of being recomputed from
	scratch. The figure below stages the pieces before we walk through the
	mechanism: on the left, a <em>High Bandwidth Memory</em> block
	containing one KV cache per transformer layer; on the right, the
	transformer stack itself, with input tokens up top and the residual
	stream flowing down through three self-attention layers. The dashed
	cell in each row marks the token about to be generated.
</p>

<Figure backgroundVisible={false} isActive={kvCacheActive}>
	{#snippet children()}
		<KVCacheFigure isActive={kvCacheActive} maskColor={MASK_COLOR} />
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 5.</span>
		<strong>Autoregressive transformer forward pass with key-value caching.</strong>
		During the <em>prefill</em> phase, the model runs all prompt tokens
		through the network in parallel. Each attention layer computes
		key/value tensors for every prompt position and writes them into the
		layer's KV cache in High Bandwidth Memory. During the <em>decoding</em>
		phase, tokens are generated one at a time: at each new position, the
		model reads the cached keys and values for every previous position
		(instead of recomputing them from scratch) and appends its own newly
		computed K/V to the cache. Caching turns per-step work from
		<Katex math={"O(L)"} /> forward passes into <Katex math={"O(1)"} />,
		which is what makes autoregressive inference cheap enough to be
		practical.
	{/snippet}
</Figure>

<h3 id="masked-diffusion-breaks-caching">Why Masked Diffusion Breaks KV Caching</h3>

<p>
	Masked diffusion breaks the causal-attention assumption. Because the
	encoder is bidirectional, every position's hidden representation is a
	function of the <em>whole</em> current context. When a single
	<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> commits to a
	word at one reverse step, the hidden representation at every
	<em>other</em> position &mdash; including positions that stay masked
	&mdash; changes as well. Any keys or values a cache stored while
	position <em>j</em> was masked are out of date the moment <em>j</em>
	commits. The figure below shows two forward passes of the same
	transformer on an eight-token sentence: one before the commit, one
	after. Between the two passes, the colored square that stands in for
	the hidden state at each position shifts &mdash; every position, not
	just the one that was unmasked.
</p>

<Figure backgroundVisible={false} isActive={representationRippleActive}>
	{#snippet children()}
		<RepresentationRippleFigure
			isActive={representationRippleActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
		/>
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 6.</span> Two forward passes of the
		same masked transformer. In pass 1 the model sees an eight-token
		sentence with two <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />s and produces a hidden state at
		each position (the colored square beneath each token). In pass 2, one
		mask has been committed to <em>little</em> and the sequence is fed
		through again &mdash; and now the colored square at
		<em>every</em> position is different, including the one that stayed
		masked. Because attention is bidirectional, every hidden state depends
		on the whole context, so committing a single token changes the
		representation of every other token.
	{/snippet}
</Figure>

<p>
	It's worth distinguishing masked diffusion from <em>any-order
	autoregression</em> here, since they can look similar at a glance and
	the difference matters for caching. Any-order autoregression fixes an
	unmasking order ahead of time and then decodes strictly along that
	order &mdash; each position conditions only on positions earlier in
	the chosen order. That model class is strictly weaker than full masked
	diffusion: it can't adapt the unmasking order to the sample, can't
	unmask multiple positions in parallel per step, and can't revise a
	committed token. What it <em>can</em> do is cache KVs along the fixed
	order, because along that order the model is still causal. Full masked
	diffusion gives up that fixed order to buy adaptive parallel decoding,
	and pays for it with a broken cache.
</p>

<h3 id="block-diffusion">Block Diffusion</h3>

<p>
	<em>Block diffusion</em> is the compromise between the two extremes.
	Tokens are grouped into fixed-size <em>blocks</em>;
	<strong>within</strong> a block, tokens are generated in a random
	order &mdash; masked-diffusion style, with each pending slot shown as a
	gray rectangle. <strong>Across</strong> blocks, generation is strictly
	left-to-right: block <em>k</em>+1 only starts once block <em>k</em> is
	fully revealed. The result is diffusion-style parallel filling inside
	each block, autoregressive ordering between blocks &mdash; and, because
	once a block is fully unmasked its KVs are frozen with respect to any
	later block, KV caching works along the block-level order. Within-block
	inference cost is <Katex math={"O(B^2)"} /> per reverse step, and
	<Katex math={"B \\ll L"} />, so total inference cost drops close to AR
	asymptotically while keeping parallel decoding and adaptive order
	inside each block.
</p>

<Figure backgroundVisible={false} isActive={blockDiffusionActive}>
	{#snippet children()}
		<BlockDiffusionFigure
			isActive={blockDiffusionActive}
			blockSize={4}
			maskColor={MASK_COLOR}
		/>
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 7.</span> Block-diffusion generation
		on the same paragraph. Tokens are grouped into blocks of 4, laid out
		in the same 12-column grid as Figure 1. Every token in a block
		un-masks simultaneously in one decoding step; blocks themselves
		complete strictly left-to-right (autoregressive at the block level).
		A light-orange highlight follows the block currently being decoded.
	{/snippet}
</Figure>

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
	   in this app. */
	:global(.figure.no-background-figure) {
		margin-bottom: 0.15rem;
	}

	/* Fallback for display-mode equations that overflow the viewport on
	   narrow screens. Same treatment as the sibling app. */
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
