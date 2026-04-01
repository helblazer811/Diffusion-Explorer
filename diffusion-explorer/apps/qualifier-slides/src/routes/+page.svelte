<script lang="ts">
  import { onMount, onDestroy, setContext } from 'svelte';
  import { writable, type Writable } from 'svelte/store';
  import { base } from '$app/paths';
  import {
    FlowModelClient,
    clipSamplesToRadius,
    clipTrajectoriesToStartingRadius,
    generateClippedGaussianSamples,
    loadCachedTrajectories as loadCachedTraj,
    loadTargetDistribution as loadTargetDist,
    loadCachedVectorField as loadCachedVF,
    loadCachedRectifiedFlowTrajectories as loadCachedRFTraj,
  } from '@diffusion-explorer/diffusion';
  import { Katex } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';

  // ========== FIGURE IMPORTS ==========

  // From continuity-equation-explainer
  import ProbabilityPathIntro from '$continuity/figures/ProbabilityPathIntro.svelte';
  import { CrownJewel } from '$continuity/figures/CrownJewel';
  import MassConservation from '$continuity/figures/MassConservation.svelte';
  import InvertibilityExplanation from '$continuity/figures/InvertibilityExplanation.svelte';
  import FlowInvertibility from '$continuity/figures/FlowInvertibility.svelte';
  import DivergenceIntro from '$continuity/figures/DivergenceIntro.svelte';
  import LikelihoodIntegration from '$continuity/figures/LikelihoodIntegration.svelte';

  // From rectified-flow-explainer
  import ProbabilityPath from '$rectified-flow/figures/ProbabilityPath.svelte';
  import CurvedTrajectorySuperimposed from '$rectified-flow/figures/CurvedTrajectorySuperimposed.svelte';
  import EulerStepComparison from '$rectified-flow/figures/EulerStepComparison.svelte';
  import IndependentCoupling from '$rectified-flow/figures/IndependentCoupling.svelte';
  import OTCoupling from '$rectified-flow/figures/OTCoupling.svelte';
  import RectifiedFlowSuperimposed from '$rectified-flow/figures/RectifiedFlowSuperimposed.svelte';
  import VectorFieldCurvatureComparison from '$rectified-flow/figures/VectorFieldCurvatureComparison.svelte';
  import EulerStepDemo from '$rectified-flow/figures/EulerStepDemo.svelte';
  import ConditionalFlowMatching from '$rectified-flow/figures/ConditionalFlowMatching.svelte';
  import LinearInterpolation from '$rectified-flow/figures/LinearInterpolation.svelte';
  import HighlightTrajectory from '$rectified-flow/figures/HighlightTrajectory.svelte';

  // Local figures
  import IndependentCouplingAnimated from '$lib/figures/IndependentCouplingAnimated.svelte';
  import FlowerImageDistribution from '$lib/figures/FlowerImageDistribution.svelte';
  import TransformingNoiseIntoData from '$lib/figures/TransformingNoiseIntoData.svelte';
  import DiffusionVsFlow from '$lib/figures/DiffusionVsFlow.svelte';
  import FlowProbabilityPath from '$lib/figures/FlowProbabilityPath.svelte';
  import Slide from '$lib/components/Slide.svelte';
  import NormalizingFlowStages from '$lib/figures/NormalizingFlowStages.svelte';
  import ChangeOfVariables from '$lib/figures/ChangeOfVariables.svelte';
  import MaxLikelihoodTraining from '$lib/figures/MaxLikelihoodTraining.svelte';

  let flowerFigure: FlowerImageDistribution;
  let noiseFigure: TransformingNoiseIntoData;
  let diffFlowFigure: DiffusionVsFlow;
  let flowPathFigure: FlowProbabilityPath;
  let normFlowFigure: NormalizingFlowStages;
  let covFigure: ChangeOfVariables;
  let composeFigure: NormalizingFlowStages;
  let mlFigure: MaxLikelihoodTraining;

  // Provide reveal instance to Slide components via context
  setContext('getReveal', () => revealInstance);

  // ========== REVEAL.JS ==========

  let revealInstance: any = null;
  let deckEl: HTMLElement;

  // ========== DATA STATE ==========

  // Shared data for rectified-flow figures
  const sourceDistributionSamples: Writable<number[][]> = writable([]);
  const targetDistributionSamples: Writable<number[][]> = writable([]);
  const allTimeSamples: Writable<number[][][]> = writable([]);
  const isTraining: Writable<boolean> = writable(false);

  let flowMatchingClient: FlowModelClient | null = null;
  let rectifiedFlowClient: FlowModelClient | null = null;

  let vectorFieldData: any = null;
  let rectifiedFlowVectorFieldData: any = null;
  let flowMatchingGridTrajectories: number[][][] | null = null;
  let rectifiedFlowGridTrajectories: number[][][][] | null = null;
  let otCouplingData: any = null;

  // Diffusion vs Flow comparison data
  let ddpmTrajectories: number[][][] = [];
  let comparisonTargetDist: number[][] = [];

  // Continuity equation data
  let ceSourceSamples: number[][] = [];
  let ceTargetSamples: number[][] = [];
  const ceAllTimeSamples = writable<number[][][]>([]);
  const ceIsTraining = writable(false);
  let flowInvertibilityData: any = null;
  let reverseSamplingData: any = null;

  let dataLoaded = false;

  // ========== HELPERS ==========

  function transposeTrajectories(trajectories: number[][][]) {
    if (!trajectories || trajectories.length === 0) return [];
    const numSamples = trajectories.length;
    const numSteps = trajectories[0].length;
    const result: number[][][] = [];
    for (let t = 0; t < numSteps; t++) {
      const samplesAtT: number[][] = [];
      for (let s = 0; s < numSamples; s++) {
        samplesAtT.push(trajectories[s][t]);
      }
      result.push(samplesAtT);
    }
    return result;
  }

  // ========== LIFECYCLE ==========

  onMount(async () => {
    // Initialize reveal.js
    const Reveal = (await import('reveal.js')).default;
    const RevealNotes = (await import('reveal.js/plugin/notes/notes')).default;
    revealInstance = new Reveal(deckEl, {
      hash: false,
      history: false,
      slideNumber: true,
      controls: false,
      progress: true,
      center: true,
      transition: 'slide',
      width: 1920,
      height: 1200,
      margin: 0.02,
      plugins: [RevealNotes],
    });

    await revealInstance.initialize();

    // ========== LOAD DATA ==========

    const sourceDistribution = generateClippedGaussianSamples(300);

    // --- Rectified flow data ---
    flowMatchingClient = new FlowModelClient(
      `${base}${settings.rf.workerUrl}`,
      `${base}${settings.rf.flowMatchingModelPath}`,
      'Flow Matching',
      { dim: settings.modelSettings.dim, hidden: settings.modelSettings.hidden },
      null
    );
    rectifiedFlowClient = new FlowModelClient(
      `${base}${settings.rf.workerUrl}`,
      `${base}${settings.rf.rectifiedFlowModelPath}`,
      'Rectified Flow',
      { dim: settings.modelSettings.dim, hidden: settings.modelSettings.hidden },
      null
    );

    // Load target distribution
    try {
      const targetRes = await fetch(`${base}/${settings.rf.targetDistributionPath}`);
      if (targetRes.ok) {
        const data = await targetRes.json();
        const samples = data.points?.slice(0, 500) || [];
        targetDistributionSamples.set(samples);
      }
    } catch (e) { console.warn('Failed to load RF target distribution:', e); }

    // Load flow matching trajectories
    try {
      const result = await loadCachedTraj(`${base}/${settings.rf.cachedFlowMatchingTrajectoriesPath}`);
      if (result) {
        allTimeSamples.set(result.trajectories);
        sourceDistributionSamples.set(
          clipSamplesToRadius(result.sourceDistribution, 2.0)
        );
      }
    } catch (e) { console.warn('Failed to load FM trajectories:', e); }

    // Load flow matching grid trajectories
    try {
      const result = await loadCachedTraj(`${base}/${settings.rf.cachedFlowMatchingGridTrajectoriesPath}`);
      if (result) {
        flowMatchingGridTrajectories = result.trajectories;
      }
    } catch (e) { console.warn('Failed to load FM grid trajectories:', e); }

    // Load rectified flow grid trajectories
    try {
      const result = await loadCachedRFTraj(`${base}/${settings.rf.cachedRectifiedFlowGridTrajectoriesPath}`);
      if (result) {
        rectifiedFlowGridTrajectories = result.allRectifiedTrajectories;
      }
    } catch (e) { console.warn('Failed to load RF grid trajectories:', e); }

    // Load vector fields
    try {
      const result = await loadCachedVF(`${base}/${settings.rf.cachedFlowMatchingVectorFieldPath}`);
      if (result) vectorFieldData = result;
    } catch (e) { console.warn('Failed to load FM vector field:', e); }

    try {
      const result = await loadCachedVF(`${base}/${settings.rf.cachedRectifiedFlowVectorFieldPath}`);
      if (result) rectifiedFlowVectorFieldData = result;
    } catch (e) { console.warn('Failed to load RF vector field:', e); }

    // Load OT coupling
    try {
      const res = await fetch(`${base}/${settings.rf.cachedOTCouplingPath}`);
      if (res.ok) otCouplingData = await res.json();
    } catch (e) { console.warn('Failed to load OT coupling:', e); }

    // --- Continuity equation data ---
    ceSourceSamples = sourceDistribution;

    try {
      const [trajResult, targetRes] = await Promise.all([
        loadCachedTraj(`${base}/${settings.ce.cachedTrajectoriesPath}`),
        fetch(`${base}/${settings.ce.targetDistributionPath}`),
      ]);

      if (trajResult) {
        ceAllTimeSamples.set(trajResult.trajectories);
        ceSourceSamples = trajResult.trajectories[0] || [];
      }

      if (targetRes.ok) {
        const targetData = await targetRes.json();
        ceTargetSamples = targetData.points || [];
      }

      // FlowInvertibility data
      const trajRes2 = await fetch(`${base}/${settings.ce.cachedTrajectoriesPath}`);
      if (trajRes2.ok) {
        const trajData = await trajRes2.json();
        flowInvertibilityData = {
          allTrajectories: trajData.allTrajectories,
          highlightedIndices: trajData.highlightedIndices || [0, 1],
          sourceDistribution,
          targetDistribution: ceTargetSamples,
          config: trajData.config,
        };
      }

      // Reverse trajectories for LikelihoodIntegration
      const revTrajRes = await fetch(`${base}/${settings.ce.cachedReverseTrajectoriesPath}`);
      if (revTrajRes.ok) {
        const revTrajData = await revTrajRes.json();
        reverseSamplingData = {
          trajectories: revTrajData.trajectories,
          sourceDistribution,
          targetDistribution: ceTargetSamples,
          config: revTrajData.config,
        };
      }
    } catch (e) { console.warn('Failed to load CE data:', e); }

    dataLoaded = true;
  });

  onDestroy(() => {
    revealInstance?.destroy();
  });
</script>

<div class="reveal" bind:this={deckEl}>
  <div class="slides">

    <!-- ============================================================ -->
    <!-- PART 1: What is a Flow? -->
    <!-- ============================================================ -->

    <!-- Slide 1: Title -->
    <section class="title-slide">
      <div class="title-content">
        <h1>A Visual Survey of Flow Based Generative Models</h1>
        <p style="font-size: 1.8em; color: #666; margin-top: 1em;">Alec Helbling</p>
        <p style="font-size: 1.2em; color: #666; margin-top: 0.3em;">ML PhD Qualifier</p>
      </div>
      <aside class="notes">
        Qualifier presentation. Focus on building intuition through interactive visualizations.
      </aside>
    </section>

    <!-- Slide 2: The Goal of Generative Modeling -->
    <Slide figure={flowerFigure}>
      <h2 class="slide-title">The Goal of Generative Modeling</h2>
      <p style="margin-top: 0.5em;">
        Model a complex data distribution <Katex math={"p(x)"} /> and efficiently generate novel samples <Katex math={"x \\sim p(x)"} />.
      </p>
      <div class="figure-container" style="position: relative;">
        <div style="position: absolute; top: -70px; left: 50%; transform: translateX(-50%); z-index: 200;">
          <Katex math={"p(x)"} displayMode={true} />
        </div>
        <div style="margin-top: 30px;">
          <FlowerImageDistribution bind:this={flowerFigure} width={1495} height={750} />
        </div>
      </div>
    </Slide>

    <!-- Slide 3: Transforming Noise into Data -->
    <Slide figure={noiseFigure}>
      <h2 class="slide-title">Transforming Noise into Data</h2>
      <div class="figure-container" style="margin-top: 140px;">
        <TransformingNoiseIntoData bind:this={noiseFigure} width={1720} height={975} />
      </div>
    </Slide>

    <!-- Slide 4: Diffusion vs Flow -->
    <Slide figure={diffFlowFigure}>
      <DiffusionVsFlow bind:this={diffFlowFigure} width={1720} height={520} animationDuration={24000} />
    </Slide>

    <!-- Slide 5: Flow-based Generative Models -->
    <Slide figure={flowPathFigure}>
      <h2 class="slide-title">Flow-based Generative Models</h2>
      <div class="figure-container" style="margin-top: 120px;">
        <FlowProbabilityPath bind:this={flowPathFigure} width={1720} height={850} contourBandwidth={20} contourGridSize={50} contourThresholds={3} />
      </div>
    </Slide>

    <!-- Slide 6: Roadmap -->
    <section class="roadmap-slide">
      <h2 class="slide-title">Presentation Roadmap</h2>
      <ol class="roadmap">
        <li class="roadmap-item">
          <p class="roadmap-title">Normalizing Flows</p>
          <p class="roadmap-ref">Rezende & Mohamed, 2015</p>
        </li>
        <li class="roadmap-item">
          <p class="roadmap-title">Continuous Normalizing Flows</p>
          <p class="roadmap-ref">Chen et al., 2018</p>
        </li>
        <li class="roadmap-item">
          <p class="roadmap-title">Flow Matching, Stochastic Interpolants</p>
          <p class="roadmap-ref">Lipman et al., 2023; Albergo & Vanden-Eijnden, 2023</p>
        </li>
        <li class="roadmap-item">
          <p class="roadmap-title">Rectified Flows</p>
          <p class="roadmap-ref">Liu et al., 2023</p>
        </li>
      </ol>
    </section>

    <!-- Slide 7: What is a Normalizing Flow? -->
    <Slide figure={normFlowFigure}>
      <h2 class="slide-title">What is a Normalizing Flow?</h2>
      <p style="margin-top: 0.5em;">
        A <strong>Normalizing Flow</strong> is a transformation of a simple
        probability distribution (e.g., a standard normal) into a more
        complex distribution by a sequence of <strong>invertible</strong> and
        <strong>differentiable</strong> mappings.
      </p>
      <div class="figure-container" style="margin-top: -20px;">
        <NormalizingFlowStages bind:this={normFlowFigure} width={1720} height={580} numStages={4} />
      </div>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          Rezende, D. &amp; Mohamed, S. (2015). Variational Inference with Normalizing Flows. <em>Proceedings of the 32nd International Conference on Machine Learning</em>, in <em>Proceedings of Machine Learning Research</em> 37:1530-1538.
        </p>
      </div>
    </Slide>

    <!-- Slide 8: Change of Variables Formula -->
    <Slide figure={covFigure}>
      <h2 class="slide-title">Change of Variables Formula</h2>
      <p style="margin-top: 0.5em;">
        The Change of Variables Formula connects the density of <Katex math={"p(x)"} /> to <Katex math={"p(z)"} />.
      </p>
      <p>
        This leverages the differentiability and invertibility of <Katex math={"f(z)"} />.
      </p>
      <div style="margin-top: 0.5em;">
        <Katex math={"p(z) \\left| \\det \\frac{\\partial f}{\\partial z} \\right|^{-1} = p(x)"} displayMode={true} />
      </div>
      <div class="figure-container" style="margin-top: -10px; height: 580px;">
        <ChangeOfVariables bind:this={covFigure} width={1720} height={580} numSamples={300} contourThresholds={3} />
      </div>
    </Slide>

    <!-- Slide: Composing Multiple Transformations -->
    <Slide figure={composeFigure}>
      <h2 class="slide-title">Composing Multiple Transformations</h2>
      <p style="margin-top: 0.3em;">
        Chain multiple invertible transformations to build expressive mappings from simple distributions.
      </p>
      <div style="margin-top: 0.15em;">
        <Katex math={"\\log p(x) = \\log p(z_0) - \\sum_{i=0}^{K-1} \\log \\left| \\det \\frac{\\partial f_i}{\\partial z_i} \\right|"} displayMode={true} />
      </div>
      <div class="figure-container" style="margin-top: -20px; height: 520px; overflow: hidden;">
        <NormalizingFlowStages bind:this={composeFigure} width={1720} height={580} numStages={4} />
      </div>
    </Slide>

    <!-- Slide: Maximum Likelihood Training -->
    <Slide figure={mlFigure}>
      <h2 class="slide-title">Maximum Likelihood Training</h2>
      <p style="margin-top: 0.3em;">
        Map data <Katex math={"x"} /> backward through the inverse flow to evaluate <Katex math={"p(z_0)"} /> and train via maximum likelihood:
      </p>
      <div style="margin-top: 0.15em;">
        <Katex math={"-\\log p(x) = -\\log p(f^{-1}(x)) - \\log \\left| \\det \\dfrac{\\partial f^{-1}}{\\partial x} \\right|"} displayMode={true} />
      </div>
      <div class="figure-container" style="margin-top: -20px; height: 520px; overflow: hidden;">
        <MaxLikelihoodTraining bind:this={mlFigure} width={1720} height={580} numStages={4} />
      </div>
    </Slide>

    <!-- Slide: Jacobian Determinants Are Expensive -->
    <section>
      <h2 class="slide-title">Jacobian Determinants Are Expensive</h2>
      <p style="margin-top: 1em;">
        The forward log-probability under a normalizing flow requires computing:
      </p>
      <div style="margin-top: 0.5em;">
        <Katex math={"\\log p(x) = \\log p(z_0) + \\sum_{i=1}^{K} \\log \\left| \\htmlClass{det-highlight}{\\det \\dfrac{\\partial f_i}{\\partial z_{i-1}}} \\right|"} displayMode={true} />
      </div>
      <div style="display: flex; justify-content: center; margin-top: 1em;">
        <div style="background: rgba(231, 76, 60, 0.1); border: 2px solid #e74c3c; border-radius: 12px; padding: 0.8em 2em; text-align: center;">
          <p style="margin: 0; color: #e74c3c; font-weight: bold; font-size: 1.05em;">
            The log-determinant of the Jacobian is <Katex math={"O(d^3)"} /> in general.
          </p>
        </div>
      </div>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          <strong>Examples of tractable designs:</strong> Planar flows <span style="font-style: italic;">(Rezende &amp; Mohamed, 2015)</span>,
          NICE <span style="font-style: italic;">(Dinh et al., 2014)</span>,
          Real NVP <span style="font-style: italic;">(Dinh et al., 2017)</span>,
          Glow <span style="font-style: italic;">(Kingma &amp; Dhariwal, 2018)</span>
        </p>
      </div>
    </section>

    <!-- Slide: Continuous Normalizing Flows -->
    <section>
      <h2 class="slide-title">Continuous Normalizing Flows</h2>
      <p style="margin-top: 0.3em;">
        CNFs replace discrete transformations with a continuous-time ODE modeled by a neural network.
      </p>
      <div class="figure-container" style="margin-top: 0.5em;">
        {#if dataLoaded}
          <ProbabilityPath
            width={1800}
            height={700}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            {allTimeSamples}
            {isTraining}
            playingByDefault={true}
            backgroundVisible={false}
            showContours={true}
            distributionScaleFactor={0.7}
            showTimeSlider={false}
            labelFontSize={50}
            latexFontSize={43}
          />
        {/if}
      </div>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          Chen et al., <span style="font-style: italic;">Neural Ordinary Differential Equations</span>, 2019
        </p>
      </div>
    </section>

    <!-- Slide: Sampling Trajectories from CNFs -->
    <section>
      <h2 class="slide-title">Sampling Trajectories from CNFs</h2>
      <div style="display: flex; align-items: center; gap: 2em; margin-top: 0.8em;">
        <div style="flex: 1;">
          <p style="margin-top: 0;">
            A CNF defines a time-dependent velocity field <Katex math={"\\color{#3b82f6}{v_\\theta(x, t)}"} /> parameterized by a neural network.
          </p>
          <p style="margin-top: 0.5em;">
            Generate samples by solving the ODE:
          </p>
          <div style="margin-top: 0.2em;">
            <Katex math={"\\frac{d\\color{#f17720}{x}}{dt} = \\color{#3b82f6}{v_\\theta(x, t)}"} displayMode={true} />
          </div>
          <p style="margin-top: 0.5em;">
            We integrate forward using numerical methods like Euler's method:
          </p>
          <div style="margin-top: 0.2em;">
            <Katex math={"\\color{#f17720}{x_{t+\\Delta t}} \\color{#333}{=} \\color{#f17720}{x_t} \\color{#333}{+} \\color{#333}{\\Delta t} \\color{#333}{\\cdot} \\color{#3b82f6}{v_\\theta(x_t, t)}"} displayMode={true} />
          </div>
        </div>
        <div style="flex: 0 0 750px;">
          {#if dataLoaded}
            <EulerStepDemo
              {flowMatchingClient}
              targetDistribution={$targetDistributionSamples}
              flowMatchingVectorField={vectorFieldData}
              canvasWidth={750}
              canvasHeight={750}
              backgroundVisible={false}
              maxUserTrajectories={1}
              showGroundTruth={false}
              showLegend={false}
              showArrowHeads={true}
              arrowScale={100}
              arrowWidth={5}
              arrowOpacity={1.0}
              trajectoryStrokeWidth={5}
              trajectoryHeadRadius={12}
              targetPointRadius={7}
              showTimeSlider={false}
            />
          {/if}
        </div>
      </div>
    </section>

    <!-- Slide: CNFs Allow More Efficient Likelihood Based Training -->
    <section>
      <h2 class="slide-title">CNFs Allow <em>More</em> Efficient Likelihood Based Training</h2>
      <p style="margin-top: 0.8em;">
        The instantaneous change of variables replaces the expensive Jacobian determinant with a <strong>trace</strong>:
      </p>
      <div style="margin-top: 0.5em;">
        <Katex math={"\\log p_1(x_1) = \\log p_0(x_0) - \\int_0^1 \\htmlClass{trace-highlight}{\\operatorname{tr}\\!\\left(\\dfrac{\\partial v_\\theta}{\\partial x}\\right)} \\, dt"} displayMode={true} />
      </div>
      <div style="display: flex; justify-content: center; margin-top: 1.5em;">
        <div style="background: rgba(34, 197, 94, 0.1); border: 2px solid #22c55e; border-radius: 12px; padding: 0.8em 2em; text-align: center;">
          <p style="margin: 0; color: #22c55e; font-weight: bold; font-size: 1.05em;">
            Trace is <Katex math={"O(d)"} /> instead of <Katex math={"O(d^3)"} /> for the full determinant
          </p>
        </div>
      </div>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          Chen et al., <span style="font-style: italic;">Neural Ordinary Differential Equations</span>, 2018
        </p>
      </div>
    </section>

    <!-- Slide: Likelihood Based Training is Expensive -->
    <section>
      <h2 class="slide-title">Likelihood Based Training is Expensive</h2>
      <p style="margin-top: 0.5em;">
        Requires solving an ODE at <em style="color: #e74c3c;">every training step</em>.
      </p>
      <div style="margin-top: 0.3em;">
        <Katex math={"\\log p_1(x_1) = \\log p_0(x_0) - \\int_0^1 \\operatorname{tr}\\!\\left(\\frac{\\partial v_t}{\\partial x}\\right) \\, dt"} displayMode={true} />
      </div>
      <div class="figure-container" style="margin-top: 0.3em; max-height: 600px; overflow: hidden;">
        {#if dataLoaded}
          <HighlightTrajectory
            width={1800}
            height={600}
            {flowMatchingClient}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            allTimeSamples={$allTimeSamples}
            isTraining={$isTraining}
            reverse={true}
            showTimeSlider={false}
            distributionScaleFactor={1.0}
            endpointRadius={10}
            trajectoryStrokeWidth={4}
            latexFontSize={36}
          />
        {/if}
      </div>
      <aside class="notes">
        Key motivation for flow matching: CNFs are expressive but training via maximum likelihood is expensive because of the trace computation and ODE simulation at every step. Flow matching avoids both.
      </aside>
    </section>

    <!-- Slide: Flow Matching -->
    <section>
      <h2 class="slide-title">Flow Matching</h2>
      <p style="margin-top: 0.5em;">
        Flow matching enables <strong>simulation-free training</strong> — training CNFs without running expensive ODE solvers at each step.
      </p>
      <div style="margin-top: 0.3em;">
        <Katex math={"\\mathcal{L}_{FM}(\\theta) = \\mathbb{E}_{t, x_0, x_1} \\left\\| v_\\theta(x_t, t) - (x_1 - x_0) \\right\\|^2"} displayMode={true} />
      </div>
      <div class="figure-container" style="margin-top: 0.3em; max-height: 550px; overflow: hidden;">
        {#if dataLoaded}
          <ConditionalFlowMatching
            width={1800}
            height={550}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
            distributionScaleFactor={0.75}
            yShiftFactor={-0.8}
            x1Pixel={{ x: 1600, y: 350 }}
            vectorScale={350}
            vectorWidth={4}
            lineWidth={4}
            dashedLineWidth={3}
            latexFontSize={36}
            distributionLabelOffsetY={40}
            vtLabelOffsetY={65}
          />
        {/if}
      </div>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          Lipman et al., <span style="font-style: italic;">Flow Matching for Generative Modeling</span>, 2023
        </p>
      </div>
    </section>

    <!-- Slide: Specifying the Probability Path -->
    <section>
      <h2 class="slide-title">Specifying the Probability Path</h2>
      <p style="margin-top: 0.5em;">
        Flow matching requires defining a probability path <Katex math={"p_t(x)"} /> for interpolating between our source <Katex math={"p_0"} /> and target <Katex math={"p_1"} /> distributions. The simplest choice is a linear path:
      </p>
      <div style="margin-top: 0.3em;">
        <Katex math={"X_t = (1 - t)X_0 + tX_1"} displayMode={true} />
      </div>
      <div class="figure-container" style="margin-top: -0.5em;">
        {#if dataLoaded}
          <LinearInterpolation
            width={1800}
            height={600}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            sourcePointIndex={5}
            targetPointIndex={230}
            playingByDefault={true}
            backgroundVisible={false}
            showEquation={false}
            sourceLabelText=""
            targetLabelText=""
            labelFontSize={50}
            latexFontSize={43}
          />
        {/if}
      </div>
    </section>

    <!-- Slide: Regressing the Velocity Field -->
    <section>
      <h2 class="slide-title">Regressing the Velocity Field</h2>
    </section>

    <!-- Slide: Practical Challenge: Curved Trajectories -->
    <section>
      <h2 class="slide-title">Practical Challenge: Curved Trajectories</h2>
    </section>

    <!-- Slide: Curvature is the Enemy of Speed -->
    <section>
      <h2 class="slide-title">Curvature is the Enemy of Speed</h2>
    </section>

    <!-- Slide: What is a Coupling? -->
    <section>
      <h2 class="slide-title">What is a Coupling?</h2>
      <p style="margin-top: 0.5em;">
        A <em>coupling</em> is a joint distribution <Katex math={"\\pi(X_0, X_1)"} /> between our source <Katex math={"\\pi(X_0) = p"} /> and target <Katex math={"\\pi(X_1) = q"} /> random variables.
      </p>
      <div class="figure-container" style="margin-top: 1.5em;">
        {#if dataLoaded}
          <IndependentCouplingAnimated
            width={1800}
            height={650}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
            numScatterSamples={150}
            numLinesToDraw={100}
            labelFontSize={50}
            sourceCenterX={0.2}
            targetCenterX={0.8}
            distributionScaleFactor={0.9}
            pointRadius={7}
          />
        {/if}
      </div>
      <aside class="notes">
        Independent coupling: randomly pair source and target samples. Lines animate left to right.
      </aside>
    </section>

    <!-- Slide: Paths Crossed at the Wrong Time -->
    <section>
      <h2 class="slide-title">Paths Crossed at the Wrong Time</h2>
    </section>

    <!-- Slide: Rectified Flows -->
    <section>
      <h2 class="slide-title">Rectified Flows</h2>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          Liu et al., <span style="font-style: italic;">Flow Straight and Fast: Learning to Generate and Transfer Data with Rectified Flow</span>, 2022
        </p>
      </div>
    </section>

    <!-- Slide: The Reflow Algorithm -->
    <section>
      <h2 class="slide-title">The Reflow Algorithm</h2>
    </section>

    <!-- Slide: Reflow Produces Straighter Trajectories -->
    <section>
      <h2 class="slide-title">Reflow Produces Straighter Trajectories</h2>
    </section>

    <!-- Slide: Key References -->
    <section>
      <h2 class="slide-title">Key References</h2>
    </section>

    <!-- Slide: Thank You -->
    <section>
      <h2 class="slide-title">Thank You</h2>
    </section>

    <!-- Slide: Flows and velocity fields -->
    <section>
      <h2 class="slide-title">Flows and Velocity Fields</h2>
      <p style="font-size: 0.8em;">
        Learn <Katex math={"v_t(x)"} />, simulate the ODE
        <Katex math={"\\frac{d}{dt}\\psi_t(x) = v_t(\\psi_t(x))"} /> via Euler's method.
      </p>
      <div class="figure-container">
        {#if dataLoaded}
          <CrownJewel contourBandwidth={10} numScatterSamples={300} />
        {/if}
      </div>
      <aside class="notes">
        CrownJewel: trajectories + density contours on two moons. Click to trace backward trajectories.
      </aside>
    </section>

    <!-- Slide 5: Discrete vs. continuous normalizing flows -->
    <section>
      <h2 class="slide-title">Discrete vs. Continuous Normalizing Flows</h2>
      <div style="display: flex; gap: 2em; justify-content: center; margin-top: 1em;">
        <div style="flex: 1; max-width: 45%; text-align: left;">
          <h3 style="font-size: 0.9em;">Discrete NFs</h3>
          <ul style="font-size: 0.75em;">
            <li>Compose invertible layers</li>
            <li>Tractable Jacobians (coupling layers)</li>
            <li>Architectural constraints</li>
          </ul>
        </div>
        <div style="flex: 1; max-width: 45%; text-align: left;">
          <h3 style="font-size: 0.9em;">Continuous NFs</h3>
          <ul style="font-size: 0.75em;">
            <li>Replace layer stack with an ODE</li>
            <li>Free architecture choice</li>
            <li>Simulation cost &rarr; flow matching removes it</li>
          </ul>
        </div>
      </div>
      <p style="font-size: 0.85em; color: #555; margin-top: 1.5em;">
        We focus on the <strong>continuous</strong> side for the rest of this talk.
      </p>
      <aside class="notes">
        Conceptual contrast. Discrete NFs have architectural constraints. CNFs free the architecture but introduce simulation cost. Flow matching then removes that cost.
      </aside>
    </section>

    <!-- Slide 6: The continuity equation -->
    <section>
      <h2 class="slide-title">The Continuity Equation</h2>
      <div style="margin: 1em 0;">
        <Katex math={"\\frac{\\partial p_t}{\\partial t} + \\nabla \\cdot (p_t v_t) = 0"} displayMode={true} />
      </div>
      <p style="font-size: 0.85em;">
        Two views of the same object: the ODE moves <em>particles</em>, the continuity equation moves <em>density</em>.
      </p>
      <div class="figure-container">
        {#if dataLoaded}
          <MassConservation />
        {/if}
      </div>
      <p style="font-size: 0.75em; color: #888; margin-top: 0.5em;">
        We'll come back to this later.
      </p>
      <aside class="notes">
        Plant the flag. State the PDE. Two views of the same object. We'll return to unpack this in Part 5.
      </aside>
    </section>

    <!-- Slide 7: Invertibility -->
    <section>
      <h2 class="slide-title">Invertibility</h2>
      <p style="font-size: 0.85em;">
        Flows are deterministic and invertible &rarr; trajectories can't merge &rarr; mass is conserved.
      </p>
      <div class="figure-container">
        {#if dataLoaded}
          <InvertibilityExplanation />
        {/if}
      </div>
      <p style="font-size: 0.75em; color: #888; margin-top: 0.5em;">
        This property will matter twice — once for likelihood, once for rectified flows.
      </p>
      <aside class="notes">
        Non-invertible counterexample. This will matter twice: for likelihood computation and for why rectified flows work.
      </aside>
    </section>

    <!-- ============================================================ -->
    <!-- PART 2: How Do You Train One? -->
    <!-- ============================================================ -->

    <!-- Slide 8: Flow matching -->
    <section>
      <h2 class="slide-title">Flow Matching: The Problem It Solves</h2>
      <ul style="font-size: 0.85em; text-align: left; max-width: 70%; margin: 0 auto;">
        <li>Can't compute <Katex math={"v_t"} /> directly</li>
        <li>Simulation-based training is expensive</li>
        <li>Flow matching: regress the velocity field with a simple MSE loss</li>
      </ul>
      <div style="margin-top: 1em;">
        <Katex math={"\\mathcal{L}(\\theta) = \\mathbb{E}_{t, X_0, X_1} \\left[ \\| v_t^\\theta(X_t) - (X_1 - X_0) \\|^2 \\right]"} displayMode={true} />
      </div>
      <aside class="notes">
        Flow matching lets us regress the velocity field directly without simulation. Simple MSE loss.
      </aside>
    </section>

    <!-- Slide 9: Linear path + conditional flow matching -->
    <section>
      <h2 class="slide-title">The Linear Path</h2>
      <p style="font-size: 0.85em;">
        <Katex math={"X_t = (1-t)X_0 + tX_1"} />. Condition on <Katex math={"x_1"} /> for a tractable loss.
      </p>
      <div class="figure-container">
        {#if dataLoaded}
          <ProbabilityPath
            width={900}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            {allTimeSamples}
            {isTraining}
            playingByDefault={true}
            backgroundVisible={false}
            showContours={true}
          />
        {/if}
      </div>
      <p style="font-size: 0.75em; color: #888;">
        Key subtlety: the model only sees <Katex math={"x_t"} />, not <Katex math={"x_1"} />.
      </p>
      <aside class="notes">
        Linear interpolation path. Condition on x_1 for tractable loss. Model only sees x_t, not x_1.
      </aside>
    </section>

    <!-- Slide 10: Stochastic interpolants -->
    <section>
      <h2 class="slide-title">Stochastic Interpolants</h2>
      <p style="font-size: 0.85em;">
        Albergo &amp; Vanden-Eijnden define <Katex math={"I_t = \\alpha_t X_0 + \\beta_t X_1"} />
      </p>
      <ul style="font-size: 0.8em; text-align: left; max-width: 65%; margin: 0.5em auto;">
        <li>Derive a velocity field from the interpolant</li>
        <li>Recover the same continuity equation</li>
        <li>The linear path <Katex math={"(1-t)X_0 + tX_1"} /> is a special case</li>
      </ul>
      <p style="font-size: 0.85em; margin-top: 1em;">
        Two communities, same destination.
      </p>
      <aside class="notes">
        Stochastic interpolants: a unifying framework. Two derivation paths converging to the same velocity field and continuity equation.
      </aside>
    </section>

    <!-- ============================================================ -->
    <!-- PART 3: What Goes Wrong? -->
    <!-- ============================================================ -->

    <!-- Slide 11: The paradox -->
    <section>
      <h2 class="slide-title">The Paradox</h2>
      <p style="font-size: 0.85em;">
        We trained on <strong>straight-line</strong> targets. Why are the learned trajectories <strong>curved</strong>?
      </p>
      <div class="figure-container">
        {#if dataLoaded && flowMatchingGridTrajectories}
          <CurvedTrajectorySuperimposed
            {flowMatchingClient}
            trajectories={flowMatchingGridTrajectories}
            sourceDistribution={$sourceDistributionSamples}
            targetDistribution={$targetDistributionSamples}
            playingByDefault={true}
            backgroundVisible={false}
          />
        {/if}
      </div>
      <aside class="notes">
        Superimposed curved trajectories. We trained on straight lines but learned curves. Why?
      </aside>
    </section>

    <!-- Slide 12: Curvature is the enemy of speed -->
    <section>
      <h2 class="slide-title">Curvature is the Enemy of Speed</h2>
      <p style="font-size: 0.85em;">
        Euler steps on curved paths miss. More curvature &rarr; more steps &rarr; more cost.
      </p>
      <div class="figure-container">
        {#if dataLoaded}
          <EulerStepComparison
            {flowMatchingClient}
            {rectifiedFlowClient}
            targetDistribution={$targetDistributionSamples}
            backgroundVisible={false}
            maxUserTrajectories={1}
          />
        {/if}
      </div>
      <aside class="notes">
        Euler step accuracy comparison. More curvature = more steps = more neural network calls = more cost.
      </aside>
    </section>

    <!-- Slide 13: What is a coupling? -->
    <section>
      <h2 class="slide-title">What is a Coupling?</h2>
      <p style="font-size: 0.85em;">
        Independent coupling: draw <Katex math={"(X_0, X_1)"} /> independently. Lots of crossing paths.
      </p>
      <div class="figure-container">
        {#if dataLoaded}
          <IndependentCoupling
            width={900}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
          />
        {/if}
      </div>
      <aside class="notes">
        Independent coupling with crossing lines. Random pairings lead to crossed paths.
      </aside>
    </section>

    <!-- Slide 14: The mechanism -->
    <section>
      <h2 class="slide-title">Crossing Paths &rarr; Curvature</h2>
      <p style="font-size: 0.8em;">
        Crossing paths &rarr; conflicting velocities at same <Katex math={"(x, t)"} /> &rarr; model averages &rarr; curvature.
      </p>
      <div class="figure-container">
        {#if dataLoaded && otCouplingData}
          <OTCoupling
            width={900}
            sourceDistributionSamples={otCouplingData.sourcePoints}
            targetDistributionSamples={otCouplingData.targetPoints}
            matching={otCouplingData.matching}
            backgroundVisible={false}
          />
        {/if}
      </div>
      <p style="font-size: 0.75em; color: #888;">
        OT coupling: fewer crossings &rarr; straighter. But hard to compute in high dimensions.
      </p>
      <aside class="notes">
        The mechanism: crossing paths cause conflicting velocities, model averages them, spatial variation of the average produces curvature. OT coupling as contrast.
      </aside>
    </section>

    <!-- ============================================================ -->
    <!-- PART 4: Rectified Flows — The Fix -->
    <!-- ============================================================ -->

    <!-- Slide 15: The idea -->
    <section>
      <h2 class="slide-title">Rectified Flows: The Idea</h2>
      <p style="font-size: 0.85em;">
        Replace the independent coupling with one <strong>induced by the model itself</strong>.
      </p>
      <ol style="font-size: 0.8em; text-align: left; max-width: 65%; margin: 0.5em auto;">
        <li>Train a flow matching model with independent coupling</li>
        <li>Flow source samples through the model &rarr; get new <Katex math={"(X_0, X_1)"} /> pairs</li>
        <li>Retrain on the induced coupling</li>
      </ol>
      <p style="font-size: 0.85em; margin-top: 1em;">
        The <strong>reflow</strong> procedure.
      </p>
      <aside class="notes">
        The idea: train, flow, retrain. Replace independent coupling with model-induced coupling.
      </aside>
    </section>

    <!-- Slide 16: The reflow algorithm + result -->
    <section>
      <h2 class="slide-title">Reflow: Before and After</h2>
      <div class="figure-container">
        {#if dataLoaded && flowMatchingGridTrajectories && rectifiedFlowGridTrajectories}
          <RectifiedFlowSuperimposed
            width={900}
            {flowMatchingClient}
            {rectifiedFlowClient}
            leftTrajectories={flowMatchingGridTrajectories}
            rightTrajectories={rectifiedFlowGridTrajectories[rectifiedFlowGridTrajectories.length - 1]
              ? clipTrajectoriesToStartingRadius(
                  rectifiedFlowGridTrajectories[rectifiedFlowGridTrajectories.length - 1],
                  2.5
                )
              : []}
            targetDistribution={$targetDistributionSamples}
            playingByDefault={true}
            backgroundVisible={false}
          />
        {/if}
      </div>
      <aside class="notes">
        Side-by-side trajectory comparison: flow matching vs. rectified flow. Notice how much straighter the rectified flow trajectories are.
      </aside>
    </section>

    <!-- Slide 17: Why it works -->
    <section>
      <h2 class="slide-title">Why Rectified Flows Work</h2>
      <p style="font-size: 0.85em;">
        Deterministic ODE trajectories can't cross (uniqueness / invertibility).
      </p>
      <p style="font-size: 0.85em;">
        Induced coupling is non-crossing &rarr; no conflicting velocities &rarr; straighter.
      </p>
      <div class="figure-container">
        {#if dataLoaded && flowInvertibilityData}
          <FlowInvertibility data={flowInvertibilityData} />
        {/if}
      </div>
      <aside class="notes">
        This is where invertibility from Slide 7 pays off. ODE trajectories can't cross, so the induced coupling is non-crossing.
      </aside>
    </section>

    <!-- Slide 18: Vector field comparison -->
    <section>
      <h2 class="slide-title">Vector Field Comparison</h2>
      <p style="font-size: 0.85em;">
        Rectified model's field is more temporally consistent &rarr; lower curvature.
      </p>
      <div class="figure-container">
        {#if dataLoaded && vectorFieldData && rectifiedFlowVectorFieldData}
          <VectorFieldCurvatureComparison
            flowMatchingVectorField={vectorFieldData}
            rectifiedFlowVectorField={rectifiedFlowVectorFieldData}
            playingByDefault={true}
            backgroundVisible={false}
            normalizeVectors={false}
            showArrowHeads={true}
            animationDuration={4000}
          />
        {/if}
      </div>
      <aside class="notes">
        Vector field comparison over time. Flow matching field changes rapidly. Rectified flow field is stable — indicating straighter paths.
      </aside>
    </section>

    <!-- ============================================================ -->
    <!-- PART 5: The Continuity Equation — Coming Back to It -->
    <!-- ============================================================ -->

    <!-- Slide 19: Returning to the continuity equation -->
    <section>
      <h2 class="slide-title">Returning to the Continuity Equation</h2>
      <p style="font-size: 0.85em;">
        Flows conserve mass because they're invertible. The divergence theorem converts flux into the PDE.
      </p>
      <div class="figure-container">
        {#if dataLoaded}
          <DivergenceIntro />
        {/if}
      </div>
      <aside class="notes">
        We planted the flag in Slide 6. Now we unpack it. Source/sink/incompressible fields. Divergence theorem connects flux to the PDE.
      </aside>
    </section>

    <!-- Slide 20: Exact likelihood -->
    <section>
      <h2 class="slide-title">Exact Likelihood</h2>
      <div style="margin: 0.5em 0;">
        <Katex math={"\\log p(x(t_1), t_1) = \\log p(x(t_0), t_0) - \\int_{t_0}^{t_1} \\nabla \\cdot v(x(t), t)\\, dt"} displayMode={true} />
      </div>
      <p style="font-size: 0.85em;">
        Run the flow backward, integrate divergence along the path. A defining capability of CNFs.
      </p>
      <div class="figure-container">
        {#if dataLoaded && reverseSamplingData}
          <LikelihoodIntegration data={reverseSamplingData} selectedIndices={[5, 15]} />
        {/if}
      </div>
      <aside class="notes">
        The continuity equation gives us log-likelihood. Run flow backward, integrate divergence. Something diffusion models can't do natively.
      </aside>
    </section>

    <!-- ============================================================ -->
    <!-- PART 6: Wrap-Up -->
    <!-- ============================================================ -->

    <!-- Slide 21: Summary -->
    <section>
      <h2 class="slide-title">Summary</h2>
      <ol style="font-size: 0.8em; text-align: left; max-width: 70%; margin: 0 auto;">
        <li><strong>Flows</strong> transform simple distributions to complex ones via learned velocity fields</li>
        <li><strong>Flow matching</strong> enables simulation-free training with a simple regression loss</li>
        <li><strong>Independent coupling</strong> &rarr; crossing paths &rarr; curvature &rarr; slow sampling</li>
        <li><strong>Rectified flows</strong> induce a non-crossing coupling &rarr; straight paths &rarr; fast sampling</li>
        <li>The <strong>continuity equation</strong> provides the density-side view, unlocking exact likelihood</li>
        <li><strong>Stochastic interpolants</strong> unify the framework</li>
      </ol>
      <aside class="notes">
        The thread: flows, flow matching, curvature from independent coupling, rectified flows fix it. Continuity equation as density-side view. Stochastic interpolants as unifying framework.
      </aside>
    </section>

    <!-- Slide 22: References -->
    <section>
      <h2 class="slide-title">Diffusion Explorer</h2>
      <p style="font-size: 0.85em;">
        All visualizations are interactive — play with these ideas yourself!
      </p>
      <p style="font-size: 0.8em; color: #666;">
        github.com/helblazer811/Diffusion-Explorer
      </p>
      <div style="margin-top: 1.5em; text-align: left; max-width: 65%; margin-left: auto; margin-right: auto;">
        <h3 style="font-size: 0.8em;">Key References</h3>
        <ul style="font-size: 0.65em;">
          <li>Lipman et al. (2022) — Flow Matching for Generative Modeling</li>
          <li>Liu et al. (2022) — Flow Straight and Fast: Rectified Flow</li>
          <li>Albergo &amp; Vanden-Eijnden (2023) — Stochastic Interpolants</li>
          <li>Chen et al. (2018) — Neural ODEs</li>
        </ul>
      </div>
      <aside class="notes">
        Plug the interactive tool. References and acknowledgements.
      </aside>
    </section>

  </div>
</div>

<style>
  :global(.trace-highlight) {
    background: rgba(34, 197, 94, 0.1);
    border: 2px solid #22c55e;
    border-radius: 8px;
    padding: 14px 10px 18px 10px;
    display: inline-block;
    overflow: visible;
  }

  :global(.det-highlight) {
    background: rgba(231, 76, 60, 0.1);
    border: 2px solid #e74c3c;
    border-radius: 8px;
    padding: 8px 10px;
    display: inline-block;
    overflow: visible;
  }

  .reveal {
    height: 100vh;
    width: 100vw;
  }

  /* Left-align everything and add 50px padding */
  :global(.reveal .slides section) {
    text-align: left;
    padding: 50px 50px 80px 50px;
  }

  :global(.reveal .slides section h1),
  :global(.reveal .slides section h2),
  :global(.reveal .slides section h3) {
    text-align: left;
  }

  .figure-container {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0.5em auto;
  }

  :global(.title-slide) {
    display: flex !important;
    align-items: center;
    justify-content: center;
    text-align: center !important;
  }

  :global(.title-slide h1) {
    text-align: center !important;
  }

  .title-content {
    text-align: center;
  }

  :global(.slide-title) {
    font-size: 1.87em !important;
  }

  :global(.roadmap-slide) {
    display: flex !important;
    flex-direction: column;
  }

  .roadmap {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1em;
    flex: 1;
    padding-left: 2em;
  }

  .roadmap-item {
    list-style-type: decimal;
  }

  .roadmap-title {
    font-size: 1.2em;
    margin: 0;
  }

  .roadmap-ref {
    font-size: 0.75em;
    color: #aaa;
    font-style: italic;
    margin: 0.2em 0 0 0;
  }

  .roadmap-desc {
    font-size: 1.06em;
    color: #888;
    margin: 0.15em 0 0 0;
  }
</style>
