<script lang="ts">
	// A Visual Introduction to Masked Diffusion Language Models.
	//
	// This is the single-page app entry for the masked-diffusion blog inside
	// the Diffusion-Explorer monorepo. Layout primitives come from the shared
	// UI package; the figure components live alongside this page under
	// ./figures/.
	import { ArticleHeader, Figure, Katex } from '@diffusion-explorer/ui';
	import { base } from '$app/paths';
	import { writable } from 'svelte/store';

	import GenerationComparisonFigure from './figures/GenerationComparisonFigure.svelte';
	import BlockDiffusionFigure from './figures/BlockDiffusionFigure.svelte';
	import DecodingTrajectoryFigure from './figures/DecodingTrajectoryFigure.svelte';
	import ForwardReverseFigure from './figures/ForwardReverseFigure.svelte';
	import ModelPredictionFigure from './figures/ModelPredictionFigure.svelte';
	import References from './figures/References.svelte';

	// Shared visibility stores: each wrapping <Figure> sets one (via
	// IntersectionObserver + tab visibility), and the figure inside reads it to
	// play/pause its tempus animation only while on-screen.
	const genCompareActive = writable(false);
	const blockDiffusionActive = writable(false);
	const trajectoryActive = writable(false);
	const forwardReverseActive = writable(false);
	const modelPredictionActive = writable(false);

	// Shared visual identity for every "pending token" placeholder on this page
	// (the colored rectangles in Figures 1–3).
	const MASK_COLOR = '#cfe0f2';
</script>

<ArticleHeader
	title="A Visual Introduction to Masked Diffusion Language Models"
	subtitle="Breaking Free From the Tyranny of Autoregression"
	author="Alec Helbling"
	authorLink="https://alechelbling.com"
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
		since AR has no <code>[MASK]</code> sentinel. Bottom: tokens generated in a
		fixed random order (masked diffusion); pending slots show
		<code>[MASK]</code>. The animation auto-cycles.
	{/snippet}
</Figure>

<hr class="section-divider" />

<h2 id="background">Background</h2>

<p>
	We follow the formulation of <a href="https://arxiv.org/abs/2406.07524">Sahoo
	et al. 2024</a> ("Simple and Effective Masked Diffusion Language Models,"
	MDLM). Below are the three equations that define the process: the forward
	corruption, the reverse posterior, and the training loss.
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

<h3 id="training-loss">Training Loss</h3>

<p>
	The continuous-time NELBO collapses (after the SUBS parameterization) into
	a simple weighted cross-entropy on <em>only</em> the masked positions:
</p>

<Katex
	displayMode
	displayFontSize="1.15em"
	math={"\\mathcal{L} = \\mathbb{E}_t\\, \\mathbb{E}_{q(\\mathbf{z}_t \\mid \\mathbf{x})} \\left[ \\dfrac{\\alpha'_t}{1 - \\alpha_t} \\sum_{\\ell=1}^L \\mathbf{1}[\\mathbf{z}_t^\\ell = \\mathbf{m}]\\, \\log \\langle \\mathbf{x}_\\theta^\\ell(\\mathbf{z}_t, t),\\, \\mathbf{x}^\\ell \\rangle \\right]"}
/>

<p>
	This is exactly BERT-style masked-language-modeling with a random masking
	rate that follows the schedule <Katex math={"\\alpha_t"} />, weighted by
	<Katex math={"\\alpha'_t / (1 - \\alpha_t)"} />. Unmasked positions
	contribute zero to the loss (carry-over guarantees a perfect prediction
	there).
</p>

<h2 id="model-prediction">Model Prediction</h2>

<p>
	At every reverse step the model
	<Katex math={"\\mathbf{x}_\\theta(\\mathbf{z}_t, t)"} /> outputs a
	categorical distribution over the vocabulary at each masked position.
	Below, an 8-token sentence with two masked positions is fed into a
	Transformer; the two masked positions receive predicted distributions
	over plausible words. We fill in the argmax at each masked position to
	produce the decoded sentence.
</p>

<Figure backgroundVisible={false} isActive={modelPredictionActive}>
	{#snippet children()}
		<ModelPredictionFigure isActive={modelPredictionActive} maskColor={MASK_COLOR} />
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 2.</span> The reverse-step model
		prediction pipeline. The masked input sequence is fed into the
		Transformer, which emits a categorical distribution at each masked
		position; the argmax pick fills that position in the decoded sequence.
		Auto-cycles: input → transformer → distributions → decoded output.
	{/snippet}
</Figure>

<h2 id="block-diffusion">Block Diffusion</h2>

<p>
	<em>Block diffusion</em> (a.k.a. block-autoregressive generation) sits in
	between the two extremes above. Tokens are grouped into fixed-size
	<em>blocks</em>; <strong>within</strong> a block, tokens are generated in a
	random order &mdash; masked-diffusion style, with each pending slot shown as
	a gray rectangle. <strong>Across</strong> blocks, generation is strictly
	left-to-right: block <em>k</em>+1 only starts once block <em>k</em> is fully
	revealed. The result is diffusion-style parallel filling inside each block,
	autoregressive ordering between blocks.
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
		<span class="figure-number">Figure 3.</span> Block-diffusion generation on
		the same paragraph. Tokens are split into blocks of 6; within a block,
		tokens fill in randomly (diffusion), and blocks complete left-to-right
		(autoregressive). Pending slots are gray rectangles sized to the eventual
		word so no reflow occurs on reveal.
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
		<span class="figure-number">Figure 4.</span> Decoding trajectories for
		autoregressive (left) and masked-diffusion (right) generation on a short
		line. Each row is one decoding step; rows fade in top-to-bottom on a
		shared clock. Pending slots are colored rectangles sized to the
		eventual token so the columns stay aligned across rows.
	{/snippet}
</Figure>

<h2 id="forward-and-reverse">Forward and Reverse Diffusion</h2>

<p>
	Discrete and continuous diffusion are the same idea in two costumes. The
	<em>continuous</em> view (top): a data point drawn from a smiley-shaped
	distribution (left) is pushed by Brownian-motion-like noise until it is
	indistinguishable from a standard Gaussian (right); the reverse process
	learns to undo that. The <em>discrete</em> view (bottom): word tokens of
	a sentence get progressively replaced by a mask sentinel until the
	sequence is fully absorbed, and the reverse process fills it back in.
	The slider below controls both figures in lockstep.
</p>

<Figure backgroundVisible={false} isActive={forwardReverseActive}>
	{#snippet children()}
		<ForwardReverseFigure
			isActive={forwardReverseActive}
			maskColor="#99BCDC"
			crossFade={false}
		/>
	{/snippet}
	{#snippet caption()}
		<span class="figure-number">Figure 5.</span>
		<strong>The forward and reverse diffusion process of masked and
			continuous diffusion models.</strong> A continuous diffusion model
		gradually transforms a data sample into a standard Gaussian by adding
		Brownian-motion noise; the reverse process, learned by a neural network,
		walks that trajectory back into the data distribution. A masked diffusion
		model slowly corrupts discrete tokens into an absorbing
		<span style="color:#99BCDC; font-weight:600;">mask</span> state; the
		reverse process fills those masked positions back in one (or many) at a
		time. One shared time slider scrubs both.
	{/snippet}
</Figure>

<h2 id="remasking">Remasking</h2>

<p>&nbsp;</p>

<h2 id="adaptive-unmasking">Adaptive Unmasking Strategies</h2>

<p>&nbsp;</p>

<h2 id="references">References</h2>

<References src={`${base}/references.bib`} />

<style>
	.section-divider {
		border: none;
		border-top: 1px solid #e0e0e0;
		margin: 2.5rem 0;
	}
</style>
