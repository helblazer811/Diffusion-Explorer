<script lang="ts">
	// One <section class="slide-figure"> per slide-worth of content. Each has
	// a heading (matches the slide title) and a figure area. Scroll, screen-
	// record whichever section you need, paste into PowerPoint.
	import { writable, derived } from 'svelte/store';
	import { onMount } from 'svelte';
	import { Player, TimelineBuilder } from '@helblazer811/tempus';
	import { Figure, TimeSlider } from '@diffusion-explorer/ui';
	import ForwardReverseFigure from './figures/ForwardReverseFigure.svelte';
	import SudokuFigure from './figures/SudokuFigure.svelte';
	import ModelPredictionFigure from './figures/ModelPredictionFigure.svelte';
	import OrderMattersFigure from './figures/OrderMattersFigure.svelte';
	import GenerationComparisonFigure from './figures/GenerationComparisonFigure.svelte';
	import DecodingTrajectoryFigure from './figures/DecodingTrajectoryFigure.svelte';
	import SelfConditioningBlockDiagram from './figures/SelfConditioningBlockDiagram.svelte';
	import BasinConvergenceFigure from './figures/BasinConvergenceFigure.svelte';
	import SudokuToOneHotFigure from './figures/SudokuToOneHotFigure.svelte';
	import DetachedSelfCondFigure from './figures/DetachedSelfCondFigure.svelte';
	import ExposureBiasFigure from './figures/ExposureBiasFigure.svelte';
	import RolloutDeploymentFigure from './figures/RolloutDeploymentFigure.svelte';
	import StochasticJumpOutFigure from './figures/StochasticJumpOutFigure.svelte';
	import StochasticWrongBasinFigure from './figures/StochasticWrongBasinFigure.svelte';
	import TestTimeScalingFigure from './figures/TestTimeScalingFigure.svelte';
	import {
		buildForwardReverseTimeline,
		FORWARD_REVERSE_HALF_MS,
		FORWARD_REVERSE_HOLD_MS,
		FORWARD_REVERSE_TOTAL_MS,
		type ForwardReverseState
	} from './figures/forward_reverse_timeline';

	const MASK_COLOR = '#cfe0f2';
	const MASK_TEXT_COLOR = '#33506e';

	// Visibility stores for the standalone MDM figures.
	const modelPredictionActive = writable(true);
	const orderMattersActive = writable(true);
	const generationComparisonActive = writable(true);
	const decodingTrajectoryActive = writable(true);
	const exposureBiasActive = writable(true);

	// Section 2 (Diffusion Language Models background): shared clock across
	// the two paired ForwardReverseFigure variants.
	const bgContinuousActive = writable(false);
	const bgMaskedActive = writable(false);
	const bgSharedActive = derived(
		[bgContinuousActive, bgMaskedActive],
		([$c, $m]) => $c || $m
	);
	let bgPlayer = $state<Player<ForwardReverseState> | undefined>(undefined);
	let bgU = $state(0);
	const bgGoingForward = $derived(bgU <= 1);
	const bgProgress = $derived(bgU <= 1 ? bgU : 2 - bgU);
	function onBgSeek(v: number) {
		const player = bgPlayer;
		if (!player) return;
		const forwardEnd = FORWARD_REVERSE_HALF_MS / FORWARD_REVERSE_TOTAL_MS;
		const reverseStart =
			(FORWARD_REVERSE_HALF_MS + FORWARD_REVERSE_HOLD_MS) / FORWARD_REVERSE_TOTAL_MS;
		const reverseSpan = FORWARD_REVERSE_HALF_MS / FORWARD_REVERSE_TOTAL_MS;
		const rawT = bgGoingForward ? v * forwardEnd : reverseStart + (1 - v) * reverseSpan;
		player.seek(rawT);
		bgU = bgGoingForward ? v : 2 - v;
	}

	onMount(() => {
		const p = new Player<ForwardReverseState>(buildForwardReverseTimeline(), {
			looping: true,
			endPause: 0.15
		});
		p.onTick((_t, s) => {
			bgU = s.u;
		});
		bgPlayer = p;

		const unsub = bgSharedActive.subscribe((v) => {
			if (!bgPlayer) return;
			if (v) bgPlayer.play();
			else {
				bgPlayer.pause();
				bgPlayer.reset();
			}
		});

		return () => {
			unsub();
			bgPlayer?.dispose();
		};
	});
</script>

<article>
	<header class="page-header">
		<h1>Talk Figures</h1>
		<p class="page-sub">
			Each section below corresponds to one slide in the intern talk. Screen-record the
			figure area for the animated slides.
		</p>
	</header>

	<!-- ==================================================================== -->
	<!-- SLIDE 1 · Title                                                       -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 1 · Title</h2>
		<h3 class="slide-title">Flow Reasoning Models — Scaling Reasoning Through Iterative Self-Refinement</h3>
		<div class="fig-placeholder">
			<span>Static title card — build in PowerPoint directly (no figure needed).</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 2 · Thesis                                                      -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 2 · Thesis</h2>
		<h3 class="slide-title">Can we train flow-based language models to reason?</h3>
		<div class="fig-placeholder">
			<span>
				Sudoku Extreme (left) + GSM8K Coding (right) side-by-side self-correction animation
				— already lives in the FlowReasoningModelTalk repo (ThesisFigure.svelte). Screen-
				record from there.
			</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Autoregressive vs. Masked Diffusion generation          -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · AR vs. Masked Diffusion</h2>
		<h3 class="slide-title">Autoregressive fills left-to-right; masked diffusion any-order</h3>
		<div class="centered-body">
			<GenerationComparisonFigure
				isActive={generationComparisonActive}
				maskColor={MASK_COLOR}
				fontSize="1.35rem"
				crossFade={true}
			/>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Decoding trajectory (AR vs. masked, step-by-step)       -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Decoding trajectory</h2>
		<h3 class="slide-title">Step-by-step decoding: AR vs. masked diffusion side by side</h3>
		<div class="centered-body">
			<DecodingTrajectoryFigure
				isActive={decodingTrajectoryActive}
				maskColor={MASK_COLOR}
				maskTextColor={MASK_TEXT_COLOR}
			/>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone Sudoku · incremental solving                               -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Sudoku</h2>
		<h3 class="slide-title">Sudoku Extreme solved incrementally by a flow model</h3>
		<div class="centered-body">
			<SudokuFigure size={560} />
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Masked Diffusion single-step prediction                  -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · MDM</h2>
		<h3 class="slide-title">A masked diffusion model predicts a categorical over each masked position</h3>
		<div class="centered-body">
			<ModelPredictionFigure
				isActive={modelPredictionActive}
				maskColor={MASK_COLOR}
				maskTextColor={MASK_TEXT_COLOR}
				width={880}
				fontSize={20}
			/>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Self-conditioning as recurrence                         -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Self-conditioning</h2>
		<h3 class="slide-title">Self-conditioning: feed the previous prediction back into the model</h3>
		<div class="centered-body">
			<SelfConditioningBlockDiagram />
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Exposure bias (AR): teacher forcing vs. rollout          -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Exposure bias (AR)</h2>
		<h3 class="slide-title">
			Teacher forcing trains on clean context — AR sampling has to trust its own errors
		</h3>
		<div class="centered-body">
			<ExposureBiasFigure isActive={exposureBiasActive} />
		</div>
	</section>

		<!-- ==================================================================== -->
	<!-- Standalone · Detached self-conditioning (exposure bias)              -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Exposure bias</h2>
		<h3 class="slide-title">
			Default self-conditioning trains with a single detached carry step
		</h3>
		<div class="centered-body">
			<DetachedSelfCondFigure />
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Deployment rollout (5 steps, only one pair trained)     -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Deployment rollout</h2>
		<h3 class="slide-title">
			At deployment we roll out many steps — but training saw only one pair
		</h3>
		<div class="centered-body">
			<RolloutDeploymentFigure />
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Basin convergence (correct = wide basin, spurious tight)-->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Basin convergence</h2>
		<h3 class="slide-title">
			Correct answers are wide stable basins; spurious modes are narrow
		</h3>
		<div class="centered-body">
			<BasinConvergenceFigure />
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Stochastic jump-out (random walk escapes spurious modes)-->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Stochasticity</h2>
		<h3 class="slide-title">
			Stochasticity lets the walk escape spurious basins and settle in
			the global one
		</h3>
		<div class="centered-body">
			<StochasticJumpOutFigure />
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Wrong-basin convergence                                  -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Wrong-basin convergence</h2>
		<h3 class="slide-title">
			Sometimes the walk gets stuck in a spurious basin — an incorrect answer
		</h3>
		<div class="centered-body">
			<StochasticWrongBasinFigure />
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Test-time scaling (multiple samples until success)       -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Test-time scaling</h2>
		<h3 class="slide-title">
			Draw more samples until one lands in the correct basin
		</h3>
		<div class="centered-body">
			<TestTimeScalingFigure />
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Sudoku → one-hot representation                          -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Casting to continuous</h2>
		<h3 class="slide-title">
			Casting sudoku into continuous generation: each cell becomes a one-hot
		</h3>
		<div class="centered-body">
			<SudokuToOneHotFigure />
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- Standalone · Why order matters (two tokens decoded in parallel)       -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Standalone · Joint coherence</h2>
		<h3 class="slide-title">
			Two tokens decoded in parallel: marginals look fine, joint is broken
		</h3>
		<div class="centered-body">
			<OrderMattersFigure
				isActive={orderMattersActive}
				maskColor={MASK_COLOR}
				maskTextColor={MASK_TEXT_COLOR}
				width={1000}
				fontSize={20}
			/>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 3 · Background: Diffusion Language Models                       -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 3 · Background</h2>
		<h3 class="slide-title">Diffusion Language Models</h3>

		<div class="paired-stack">
			<p class="row-descriptor"><strong>Continuous Diffusion</strong> corrupts data with Gaussian noise.</p>

			<Figure backgroundVisible={false} isActive={bgContinuousActive}>
				{#snippet children()}
					<ForwardReverseFigure
						isActive={bgContinuousActive}
						variant="continuous"
						maskColor={MASK_COLOR}
						crossFade={false}
						sharedPlayer={bgPlayer}
						showSlider={false}
						showDirectionBadge={false}
					/>
				{/snippet}
			</Figure>

			<p class="row-descriptor"><strong>Masked Diffusion</strong> corrupts data with discrete masking.</p>

			<Figure backgroundVisible={false} isActive={bgMaskedActive}>
				{#snippet children()}
					<ForwardReverseFigure
						isActive={bgMaskedActive}
						variant="masked"
						maskColor={MASK_COLOR}
						crossFade={false}
						sharedPlayer={bgPlayer}
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

			<div class="shared-slider">
				<TimeSlider
					timeline={(bgPlayer ?? null) as Player<unknown> | null}
					min={0}
					max={1}
					step={0.001}
					showTicks={true}
					showTimeLabel={false}
					minLabel="t=0"
					maxLabel="t=1"
					displayTime={bgProgress}
					onSeekByDisplayTime={onBgSeek}
					color="#f17720"
				/>
			</div>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 4 · Vision                                                      -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 4 · Vision</h2>
		<h3 class="slide-title">Why this direction: faster inference, better inductive bias for out-of-order tasks</h3>
		<div class="fig-placeholder">
			<span>
				TODO: two-panel motivation figure — (a) throughput comparison
				(Mercury / Gemini Diffusion / LLaDA), (b) small example where AR order
				hurts (e.g. a puzzle where "first token" is arbitrary).
			</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 5 · Near-term traction (DFlash)                                 -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 5 · DFlash</h2>
		<h3 class="slide-title">Near-term traction: masked diffusion drop-in to AR stacks</h3>
		<div class="fig-placeholder">
			<span>TODO: DFlash speedup figure.</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 6 · Joint coherence motivation                                  -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 6 · Joint coherence</h2>
		<h3 class="slide-title">Why flows over masked: masked factorizes, flows resolve the joint</h3>
		<div class="fig-placeholder">
			<span>
				TODO: masked diffusion sampling two tokens in parallel — each marginal
				correct, joint incorrect. (Existing OrderMattersFigure /
				IndependentFactorizationFigure in masked-diffusion blog is close.)
			</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 7 · Observation 1: naive vs. self-conditioning                  -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 7 · Self-conditioning</h2>
		<h3 class="slide-title">Naive flow training fails; self-conditioning is the fix</h3>
		<div class="fig-placeholder">
			<span>TODO: training curves or bar chart — naive flow vs. + self-conditioning.</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 8 · Observation 2: the model knows when it's wrong              -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 8 · Verification</h2>
		<h3 class="slide-title">The denoising dynamics encode correctness</h3>
		<div class="fig-placeholder">
			<span>
				TODO: stable-basin vs. drifting-error diagram + AUROC-vs-solve-rate gap
				plot. (Figure 1 + Figure 6-left in the paper.)
			</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 9 · Money slide: 8× fewer forward passes                        -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 9 · Money slide</h2>
		<h3 class="slide-title">8× fewer forward passes than the ICLR 2025 best paper</h3>
		<div class="fig-placeholder">
			<span>
				TODO: Table 2 + side-by-side video (7 NFE vs. 57 NFE with live counters).
			</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 10 · Beats recent small-model baselines                         -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 10 · Small-model baselines</h2>
		<h3 class="slide-title">Also beats recent ICML 2026 small-model methods</h3>
		<div class="fig-placeholder">
			<span>
				TODO: Figure 3 (Sudoku / Sudoku-Extreme / Zebra panels) + FLOPs plot with
				0.95 line and crossings marked.
			</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 11 · Coding preliminary                                         -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 11 · Coding</h2>
		<h3 class="slide-title">Preliminary: code generation with the same recipe</h3>
		<div class="fig-placeholder">
			<span>TODO: renoise-CE code image with red-highlighted broken tokens.</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 12 · Signs this scales                                          -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 12 · Broader signs</h2>
		<h3 class="slide-title">Other flow-based LM work is starting to work at bigger scales</h3>
		<div class="fig-placeholder">
			<span>TODO: one or two callouts from concurrent flow-LM work.</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 13 · Roadmap                                                    -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 13 · Roadmap</h2>
		<h3 class="slide-title">What I'd do next</h3>
		<div class="fig-placeholder">
			<span>TODO: three-row roadmap, each row with "what it would prove."</span>
		</div>
	</section>

	<!-- ==================================================================== -->
	<!-- SLIDE 14 · Recap                                                      -->
	<!-- ==================================================================== -->
	<section class="slide-figure">
		<h2 class="slide-num">Slide 14 · Recap</h2>
		<h3 class="slide-title">Broadly good direction · specifically promising project · paper out in 6–8 weeks</h3>
		<div class="fig-placeholder">
			<span>Static summary card — build in PowerPoint directly (no figure needed).</span>
		</div>
	</section>
</article>

<style>
	.page-header {
		margin-bottom: 3rem;
		border-bottom: 1px solid #e6e6e6;
		padding-bottom: 1.5rem;
	}

	.page-header h1 {
		font-size: 2rem;
		margin: 0 0 0.5rem 0;
	}

	.page-sub {
		color: #666;
		font-size: 1rem;
		margin: 0;
	}

	.slide-figure {
		margin: 0 0 4rem 0;
		padding: 2rem;
		background: #fff;
		border: 1px solid #e6e6e6;
		border-radius: 8px;
	}

	.slide-num {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #999;
		font-weight: 600;
		margin: 0 0 0.5rem 0;
	}

	.slide-title {
		font-size: 1.5rem;
		margin: 0 0 1.5rem 0;
		color: #222;
		font-weight: 600;
		line-height: 1.3;
	}

	.centered-body {
		display: flex;
		justify-content: center;
	}

	.paired-stack {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.row-descriptor {
		margin: 0;
		font-size: 1.5rem;
		color: #333;
		text-align: center;
	}

	.shared-slider {
		width: 100%;
		max-width: 640px;
		margin: 0.5rem auto 0;
	}

	.fig-placeholder {
		border: 2px dashed #ccc;
		border-radius: 6px;
		padding: 3rem 2rem;
		text-align: center;
		color: #888;
		font-style: italic;
		font-size: 0.95rem;
		background: #fafafa;
	}
</style>
