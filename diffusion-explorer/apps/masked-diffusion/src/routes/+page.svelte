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
		loadBibliography,
		collectCitations,
		type BibEntry,
		type CitationInfo
	} from '@diffusion-explorer/ui';
	import { base } from '$app/paths';
	import { onMount, tick } from 'svelte';
	import { writable } from 'svelte/store';

	import GenerationComparisonFigure from './figures/GenerationComparisonFigure.svelte';
	import BlockDiffusionFigure from './figures/BlockDiffusionFigure.svelte';
	import CategoricalInline from './figures/CategoricalInline.svelte';
	import DecodingTrajectoryFigure from './figures/DecodingTrajectoryFigure.svelte';
	import ForwardReverseFigure from './figures/ForwardReverseFigure.svelte';
	import ModelPredictionFigure from './figures/ModelPredictionFigure.svelte';
	import ModelPredictionInlineFullMask from './figures/ModelPredictionInlineFullMask.svelte';
	import MLMLossInline from './figures/MLMLossInline.svelte';
	import MaskToken from './figures/MaskToken.svelte';
	import IndependentFactorizationFigure from './figures/IndependentFactorizationFigure.svelte';
	import RepresentationRippleFigure from './figures/RepresentationRippleFigure.svelte';
	import KVCacheFigure from './figures/KVCacheFigure.svelte';
	import CausalAttentionFigure from './figures/CausalAttentionFigure.svelte';
	import AbsorbingMaskFigure from './figures/AbsorbingMaskFigure.svelte';
	import SudokuAdaptiveUnmaskingFigure from './figures/SudokuAdaptiveUnmaskingFigure.svelte';

	// Shared visibility stores: each wrapping <Figure> sets one (via
	// IntersectionObserver + tab visibility), and the figure inside reads it to
	// play/pause its tempus animation only while on-screen.
	const genCompareActive = writable(false);
	const blockDiffusionActive = writable(false);
	const trajectoryActive = writable(false);
	const forwardReverseContinuousActive = writable(false);
	const forwardReverseMaskedActive = writable(false);
	const modelPredictionActive = writable(false);
	const modelPredictionInlineFullMaskActive = writable(false);
	const mlmLossInlineActive = writable(false);
	const independentFactorizationActive = writable(false);
	const representationRippleActive = writable(false);
	const kvCacheActive = writable(false);
	const causalAttentionActive = writable(false);
	const absorbingMaskActive = writable(false);
	const sudokuAdaptiveActive = writable(false);

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
		try {
			bibEntries = await loadBibliography(`${base}/bibliography.bib`);
		} catch (error) {
			console.error('Error loading bibliography:', error);
		}
		await tick();
		citations = collectCitations();
	});
</script>

<ArticleHeader
	title="Breaking Free From the Tyranny of Autoregression"
	subtitle="A Visual Introduction to Masked Diffusion Language Models"
	authors={[
		{ name: 'Alec Helbling', link: 'https://alechelbling.com/' }
	]}
	date="July 9, 2026"
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
		<span class="figure-number">Figure 1.</span> Autoregressive vs. masked
		diffusion, driven by one shared reveal clock. Top: tokens generated in
		left-to-right order (AR); pending slots are a subtle dashed underline
		since AR has no <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> sentinel. Bottom: tokens generated in a
		fixed random order (masked diffusion); pending slots show
		<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} />. The animation auto-cycles.
	{/snippet}
</Figure>

<hr class="section-divider" />

<h2 id="introduction">Introduction</h2>

<p>
	Autoregressive language models are the workhorse of modern AI.
	Practically every major LLM in production today, from GPT-4 to Claude to
	Gemini to Llama, is autoregressive at its core: they generate text one
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
	This opens up three capabilities autoregression fundamentally lacks. The
	first is <strong>parallelism</strong>: because multiple tokens can be
	unmasked in a single step, generation is no longer bottlenecked on
	producing one token at a time, which offers a path to real wall-clock
	speedups. The second is <strong>error correction</strong>: because the
	model revisits the whole sequence at every step, a token committed early
	does not have to stay committed, and later evidence can revise it. The
	third is <strong>any-order reasoning</strong>: many of the problems we
	want LLMs to solve, like multi-step proofs, do not have a natural
	left-to-right solution order, and forcing the model to commit to the
	beginning of the answer first is often a strange thing to ask.
</p>

<!-- SCAFFOLD: outline of what the post will cover. Remove once prose is
	written and the sections below are fleshed out. Sub-bullets marked
	[STUB] point at sections that currently exist as empty placeholders in
	this file; [DONE] point at sections that already have real content.
	[FIGURE] tags note where an existing figure already covers a bullet;
	[NEEDED] tags mark a figure that still needs to be built. -->
<h2 id="outline">Outline</h2>

<ul>
	<li>
		<strong>Introduction.</strong> A brief orientation before the deep dive.
		<ul>
			<li>
				<strong>What is masked diffusion, at a glance?</strong> The forward
				process replaces tokens with <MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> until the sequence
				is fully absorbed; the reverse process predicts them back &mdash;
				and that reverse process <em>is</em> the trained model.
				[FIGURE: <em>Figure&nbsp;1 &mdash; AR vs. MDLM generation</em>
				(GenerationComparisonFigure), already at the top of the page.]
			</li>
			<li>
				<strong>Why should you care?</strong>
				<ul>
					<li>
						<strong>Speed.</strong> Non-autoregressive generation lets the
						model unmask many tokens per step &mdash; potential
						wall-clock speedups over AR.
					</li>
					<li>
						<strong>Error correction.</strong> Unlike AR, which commits
						once and never revises, a masked-diffusion model can revisit
						and rewrite tokens it already emitted.
					</li>
					<li>
						<strong>Structured reasoning.</strong> On tasks like Sudoku
						or logic puzzles, the left-to-right order AR imposes fights
						the problem's actual dependency structure; MDLMs let the
						model choose an order that matches the problem.
					</li>
				</ul>
			</li>
		</ul>
	</li>

	<li>
		<strong>How masked diffusion works.</strong> The mechanism.
		<ul>
			<li>
				<strong>Forward process</strong> &mdash; token-by-token absorbing
				corruption on a continuous-time schedule. [DONE: <a href="#forward-process">Forward Process</a>]
			</li>
			<li>
				<strong>Reverse process</strong> &mdash; a parameterized denoiser
				predicting the clean token at each masked position; cross-entropy
				loss on masked positions only. [DONE:
				<a href="#reverse-process">Reverse Process</a>,
				<a href="#training-loss">Training Loss</a>,
				<a href="#model-prediction">Model Prediction</a>]
				[FIGURE: <em>Figure&nbsp;2 &mdash; masked input &rarr;
				Transformer &rarr; per-position probability distribution &rarr;
				argmax decode</em> (ModelPredictionFigure),
				<a href="#model-prediction">§Model Prediction</a>.]
				[FIGURE: <em>Figure&nbsp;4 &mdash; decoding-trajectory grid,
				AR vs. MDLM</em> (DecodingTrajectoryFigure),
				<a href="#decoding-trajectories">§Decoding Trajectories</a>
				&mdash; each row is a decoding step, columns stay aligned.]
			</li>
			<li>
				<strong>Relation to continuous diffusion.</strong> Same
				reverse-process framing (learned denoiser inverting a corruption
				schedule); different corruption (discrete absorbing state vs.
				Gaussian noise); different loss (cross-entropy vs. score matching);
				inference is a stochastic categorical transition, not an SDE/ODE.
				[DONE: <a href="#relation-to-continuous-diffusion">Relation to Continuous Diffusion</a>]
				[FIGURE: <em>Figure&nbsp;5 &mdash; continuous
				(Gaussian &leftrightarrow; smiley) and discrete
				(tokens &leftrightarrow; mask) diffusion on one shared time
				slider</em> (ForwardReverseFigure),
				<a href="#relation-to-continuous-diffusion">§Relation to Continuous Diffusion</a>.]
			</li>
			<li>
				<em>Older frameworks</em> &mdash; D3PM, argmax flows, categorical
				diffusions predate the current MDLM formulation. One-line nod for
				lineage; cut if space is tight.
			</li>
		</ul>
	</li>

	<li>
		<strong>Pathologies and how people fix them.</strong> The intellectual
		core &mdash; where the interesting design choices live.
		<ul>
			<li>
				<strong>Token order matters.</strong> The naive schedule unmasks
				in a random order, but <em>which</em> token to reveal next is
				itself a decision.
				<ul>
					<li>
						Adaptive / confidence-based / entropy-based decoding lets
						the model pick.
					</li>
					<li>
						Nod to Kim et&nbsp;al., <em>Train for the Worst, Plan for
						the Best</em> <HoverableReference
							id="kim2025trainworstplanbest"
							{bibEntries}
							{citations}
						/> &mdash; adaptive inference is a real lever.
					</li>
					<li>
						On Sudoku, &ldquo;which cell to fill next&rdquo; <em>is</em>
						the solution strategy.
					</li>
					<li>
						[STUB: <a href="#adaptive-unmasking">Adaptive Unmasking Strategies</a>]
					</li>
				</ul>
			</li>
			<li>
				<strong>Joint incoherence from factorized independent
					sampling.</strong> The core weakness.
				<ul>
					<li>
						Standard MDLMs sample all masked tokens
						<em>independently</em> from a factorized distribution at
						each step.
					</li>
					<li>
						Marginally correct per-token, but the joint draw can be
						internally inconsistent.
					</li>
					<li>
						<strong>Sudoku as the sharp example</strong>: two
						independent 50/50 draws in the same row can both land on
						<code>7</code> &mdash; locally plausible, globally illegal.
					</li>
					<li>
						Motivates low unmasking-rate-per-step and iterative
						refinement.
					</li>
				</ul>
			</li>
			<li>
				<strong>Remasking as error correction.</strong> The payoff of
				everything above.
				<ul>
					<li>
						The reverse process doesn't have to be monotonic: the model
						can <em>re-mask</em> a token it committed to if it now
						looks unlikely.
					</li>
					<li>
						Turns generation into an <em>anytime</em> process &mdash;
						pay more compute, get more consistency.
					</li>
					<li>
						[STUB: <a href="#remasking">Remasking</a>]
					</li>
				</ul>
			</li>
		</ul>
	</li>

	<li>
		<strong>Accelerated Decoding.</strong> The systems story: masked
		diffusion doesn't hand us a speedup for free, and recovering AR-grade
		efficiency takes real work.
		<ul>
			<li>
				<strong>Parallel decoding is not automatic speedup.</strong>
				MDLMs can unmask many tokens per reverse step, but AR
				generation is fast in practice because of years of systems
				work &mdash; most importantly the KV cache. It's not obvious
				how much of that infrastructure survives the switch to a
				bidirectional model. Preamble to the section.
			</li>
			<li>
				<strong>KV caching in autoregressive models.</strong>
				Background on why AR inference is cheap in practice. In a
				causal transformer, token <em>t</em>'s attention only reads
				keys/values from positions <Katex math={"\\le t"} />. Those
				KVs never change on later steps, so you cache them once and
				each new token costs one forward pass over a single query row
				instead of the full sequence.
				[FIGURE: <em>Figure&nbsp;5 &mdash; AR transformer with KV
				cache in High Bandwidth Memory</em> (KVCacheFigure),
				<a href="#kv-cache">§KV Caching</a>.]
			</li>
			<li>
				<strong>Masked diffusion violates the caching
					assumption.</strong> Any position can be masked, and any
				position attends to any other &mdash; including positions to
				its right that will be unmasked later. When a
				<MaskToken color={MASK_COLOR} textColor={MASK_TEXT_COLOR} /> at position <em>j</em> commits, its
				key/value at every layer changes, and every earlier position
				that attended to <em>j</em> now has stale KVs. In the general
				case every reverse step recomputes attention over the whole
				sequence: <Katex math={"O(L^2 \\cdot T)"} /> for <em>T</em>
				reverse steps, vs. AR's amortized <Katex math={"O(L^2)"} />.
				[FIGURE: <em>Figure&nbsp;4 &mdash; representation ripple
				across two forward passes</em> (RepresentationRippleFigure),
				<a href="#kv-cache">§KV Caching</a>.]
			</li>
			<li>
				<strong>Any-order autoregression vs. full masked
					diffusion.</strong> A subtle but important distinction. If
				you fix an unmasking order ahead of time, you're doing
				<em>any-order autoregression</em> (XLNet-style), which is
				compatible with KV caching along that order but gives up
				MDLM's key advantages: order-agnostic training and parallel
				decoding within a step. Full MDLM lets the model choose what
				to unmask each step based on all remaining context, and
				unmask several at once &mdash; and that's exactly what
				breaks the standard cache.
			</li>
			<li>
				<strong>Block diffusion as the remedy.</strong> Constrain the
				attention pattern: full bidirectional attention
				<em>within</em> a block, causal attention <em>across</em>
				blocks. Once a block is fully unmasked its KVs are frozen and
				later blocks read from them via the cache. Within-block cost
				is <Katex math={"O(B^2)"} /> per reverse step, and
				<Katex math={"B \\ll L"} />, so total inference cost drops
				close to AR asymptotically while keeping parallel decoding
				and adaptive order inside each block. This is what
				&ldquo;block diffusion&rdquo; <em>is</em>, viewed from the
				systems side.
				[FIGURE: <em>Figure&nbsp;3 &mdash; block-diffusion generation
				on a paragraph</em> (BlockDiffusionFigure),
				<a href="#block-diffusion">§Block Diffusion</a>.]
			</li>
			<li>
				<em>Other schemes</em> &mdash; prefix-caching for
				unmasked-and-unchanged positions across steps, sparse
				attention patterns, semi-AR MDLMs. Cut if space is tight.
			</li>
		</ul>
	</li>

	<li>
		<strong>Landscape and frontier.</strong> Where the field is going.
		<ul>
			<li>
				<strong>LLaDA</strong>, <strong>Mercury</strong> (Inception Labs)
				&mdash; large-scale MDLMs showing this is not a toy paradigm.
			</li>
		</ul>
	</li>

	<li>
		<strong>Figure inventory</strong> (scratch bookkeeping &mdash; delete
		with the rest of the outline).
		<ul>
			<li>
				<strong>Existing (5):</strong>
				Fig&nbsp;1 <em>GenerationComparisonFigure</em> (AR vs. MDLM reveal
				&mdash; the crown jewel, at top of page).
				Fig&nbsp;2 <em>ModelPredictionFigure</em>
				(<a href="#model-prediction">§Model Prediction</a>).
				Fig&nbsp;3 <em>BlockDiffusionFigure</em>
				(<a href="#block-diffusion">§Block Diffusion</a>).
				Fig&nbsp;4 <em>DecodingTrajectoryFigure</em>
				(<a href="#decoding-trajectories">§Decoding Trajectories</a>).
				Fig&nbsp;5 <em>ForwardReverseFigure</em>
				(<a href="#relation-to-continuous-diffusion">§Relation to Continuous Diffusion</a>).
			</li>
			<li>
				<strong>Needed (2):</strong> attention-dependency figure
				(AR causal mask vs. MDLM bidirectional mask, side by side)
				and KV-cache visualization (grid of position&nbsp;&times;&nbsp;layer
				cells lighting up green/red across reverse steps &mdash;
				AR, naive MDLM, block-diffusion). Both live in §4.
			</li>
		</ul>
	</li>
</ul>

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

<h3 id="forward-process">Forward Process</h3>

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
	<em>categorical</em> distribution over
	<Katex math={"K"} /> outcomes with probabilities
	<Katex math={"p_k"} /> summing to one &mdash; the discrete analogue of
	picking one word from a weighted bag:
</p>

<CategoricalInline />

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

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"q(\\mathbf{z}_s^\\ell \\mid \\mathbf{z}_t^\\ell, \\mathbf{x}^\\ell) = \\begin{cases} \\delta(\\mathbf{z}_s^\\ell = \\mathbf{z}_t^\\ell) & \\text{if } \\mathbf{z}_t^\\ell \\ne \\mathbf{m}, \\\\[4pt] \\mathrm{Cat}\\!\\left(\\mathbf{z}_s^\\ell;\\; \\dfrac{(1 - \\alpha_s)\\, \\mathbf{m} + (\\alpha_s - \\alpha_t)\\, \\mathbf{x}^\\ell}{1 - \\alpha_t}\\right) & \\text{if } \\mathbf{z}_t^\\ell = \\mathbf{m}. \\end{cases}"}
/>

<p>
	Unmasked positions carry over deterministically. Masked positions either
	stay masked with weight
	<Katex math={"(1 - \\alpha_s) / (1 - \\alpha_t)"} /> or unmask to the
	predicted clean token with weight
	<Katex math={"(\\alpha_s - \\alpha_t) / (1 - \\alpha_t)"} />.
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
		/>
	{/snippet}
</Figure>

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
	math={"\\mathcal{L} = \\mathbb{E}_t\\, \\mathbb{E}_{q(\\mathbf{z}_t \\mid \\mathbf{x})} \\left[ \\dfrac{\\alpha'_t}{1 - \\alpha_t} \\sum_{\\ell=1}^L \\mathbf{1}[\\mathbf{z}_t^\\ell = \\mathbf{m}]\\, \\log p_\\theta(\\mathbf{x}^\\ell \\mid \\mathbf{z}_t) \\right]"}
/>

<p>
	Compare this to the BERT loss
	<Katex math={"\\mathcal{L}_{\\mathrm{MLM}}"} /> from §Masked Language
	Modeling: the summand is the same &mdash; cross-entropy at masked
	positions &mdash; the only difference is that BERT samples one fixed
	masking rate whereas MDLM averages over the whole schedule
	<Katex math={"\\alpha_t"} />, with each rate weighted by
	<Katex math={"\\alpha'_t / (1 - \\alpha_t)"} />. Unmasked positions still
	contribute zero to the loss, since carry-over guarantees a perfect
	prediction there.
</p>

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
	This section walks through the pieces: how AR wins with KV caching,
	why the causal-attention mask is what makes caching possible, why
	masked diffusion breaks the caching assumption, and finally how block
	diffusion recovers a version of caching without giving up parallel
	within-block decoding.
</p>

<h3 id="kv-cache">Background: KV Caching</h3>

<p>
	Autoregressive attention is fast at inference because it can reuse work
	across generation steps. The keys and values computed for each past token
	are stored in memory once and read back on every subsequent step &mdash;
	instead of being recomputed from scratch. The figure below stages the
	pieces before we walk through the mechanism: on the left, a
	<em>High Bandwidth Memory</em> block containing one KV cache per
	transformer layer; on the right, the transformer stack itself, with
	input tokens up top and the residual stream flowing down through three
	self-attention layers. The dashed cell in each row marks the token
	about to be generated.
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

<h3 id="causal-attention">Causal Attention</h3>

<p>
	Why does the KV cache work? The property that makes it possible is the
	<em>causal attention</em> structure. In an autoregressive transformer,
	the query at position <em>t</em> can only attend to keys at positions
	<Katex math={"\\le t"} /> &mdash; every row of the attention matrix is
	masked to a lower-triangular shape. That means information flows
	strictly one way, from past to future: a token at position <em>t</em>
	knows about tokens 1…<em>t</em>, and no token to its right ever
	influences it. Because past keys and values never depend on tokens that
	come later, they never need to be recomputed when new tokens are
	generated &mdash; they are safe to cache.
</p>

<Figure backgroundVisible={false} isActive={causalAttentionActive}>
	{#snippet children()}
		<CausalAttentionFigure isActive={causalAttentionActive} />
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 6.</span> Causal self-attention
		unrolled over time. Each row is a query at one position; each column
		is a key. The attention mask restricts every query to attend only to
		past-and-current keys, so cells appear only along the lower triangle,
		one row per beat. Below the matrix, the horizontal arrows show the
		one-directional flow of information from past to future &mdash; the
		asymmetry that makes KV caching work.
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
		<span class="figure-number">Figure 7.</span> Two forward passes of the
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
			blockSize={6}
			maskColor={MASK_COLOR}
		/>
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 8.</span> Block-diffusion generation
		on the same paragraph. Tokens are split into blocks of 6; within a
		block, tokens fill in randomly (diffusion), and blocks complete
		left-to-right (autoregressive). Pending slots are gray rectangles
		sized to the eventual word so no reflow occurs on reveal.
	{/snippet}
</Figure>

<h2 id="decoding-trajectories">Decoding Trajectories</h2>

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

<h2 id="remasking">Remasking</h2>

<p>
	Because a masked diffusion model factorizes its reverse step across
	positions, each masked slot receives an independent categorical
	distribution — the sampler draws each token <em>without conditioning
	on its neighbors' draws</em>. When the correct completion has a joint
	constraint that ties two masked positions together, that constraint is
	invisible to the per-position sampler, so a single reverse pass can
	produce a nonsensical output.
</p>

<Figure backgroundVisible={false} isActive={independentFactorizationActive}>
	{#snippet children()}
		<IndependentFactorizationFigure
			isActive={independentFactorizationActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
		/>
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 10.</span>
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

<h2 id="adaptive-unmasking">Adaptive Unmasking Strategies</h2>

<Figure backgroundVisible={false} isActive={sudokuAdaptiveActive}>
	{#snippet children()}
		<SudokuAdaptiveUnmaskingFigure
			isActive={sudokuAdaptiveActive}
			maskColor={MASK_COLOR}
			maskTextColor={MASK_TEXT_COLOR}
		/>
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 11.</span>
		<strong>Adaptive unmasking commits confident cells first.</strong>
		Left: a real 32-step decoding trajectory of a sudoku puzzle,
		showing per-cell probability distributions collapsing as the
		model resolves the grid. Right: solve rate as a function of
		decoding budget — an adaptive strategy that reveals the
		highest-confidence cell at each step reaches high solve rates
		with far fewer steps than a fixed-order schedule.
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
</style>
