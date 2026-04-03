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
  import { Katex, AnnotatedEquation } from '@diffusion-explorer/ui';
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
  import CurvedTrajectoryIntro from '$lib/figures/CurvedTrajectoryIntro.svelte';
  import EulerSamplerFigure from '$lib/figures/EulerSamplerFigure.svelte';
  import EulerStepComparison from '$rectified-flow/figures/EulerStepComparison.svelte';
  import IndependentCoupling from '$rectified-flow/figures/IndependentCoupling.svelte';
  import OTCoupling from '$rectified-flow/figures/OTCoupling.svelte';
  import RectifiedFlowSuperimposed from '$lib/figures/RectifiedFlowSuperimposed.svelte';
  import VectorFieldCurvatureComparison from '$rectified-flow/figures/VectorFieldCurvatureComparison.svelte';
  import EulerStepDemo from '$rectified-flow/figures/EulerStepDemo.svelte';
  import ConditionalFlowMatching from '$rectified-flow/figures/ConditionalFlowMatching.svelte';
  import ConditionalVelocityField from '$rectified-flow/figures/ConditionalVelocityField.svelte';
  import LinearInterpolation from '$rectified-flow/figures/LinearInterpolation.svelte';
  import HighlightTrajectory from '$rectified-flow/figures/HighlightTrajectory.svelte';
  import ReflowAlgorithm from '$rectified-flow/figures/ReflowAlgorithm.svelte';
  import IntersectingPaths from '$rectified-flow/figures/IntersectingPaths.svelte';

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
  import StochasticInterpolation from '$lib/figures/StochasticInterpolation.svelte';
  import InducedCouplingAnimated from '$lib/figures/InducedCouplingAnimated.svelte';

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

    <!-- Test Slide: Annotated Equation -->
    <section>
      <h2 class="slide-title">Annotated Equation Test</h2>
      <div style="margin-top: 2em;">
        <AnnotatedEquation
          tex={"{\\color{#3498db} p(z)} \\left| \\det {\\color{#e74c3c} \\frac{\\partial f}{\\partial z}} \\right|^{-1} = {\\color{#2ecc71} p(x)}"}
          debug={true}
          annotations={[
            { color: '#3498db', label: 'prior density', side: 'below' },
            { color: '#e74c3c', label: 'Jacobian determinant', side: 'above' },
            { color: '#2ecc71', label: 'data density', side: 'below' },
          ]}
        />
      </div>
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
        <AnnotatedEquation
          tex={"{\\color{#3498db} p(z)} \\left| \\det {\\color{#e74c3c} \\frac{\\partial f}{\\partial z}} \\right|^{-1} = {\\color{#2ecc71} p(x)}"}
          annotations={[
            { color: '#3498db', label: 'prior density', side: 'below' },
            { color: '#e74c3c', label: 'Jacobian determinant', side: 'above' },
            { color: '#2ecc71', label: 'data density', side: 'below' },
          ]}
        />
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
            labelFontFamily="Libre Baskerville, Georgia, serif"
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
            labelFontFamily="Libre Baskerville, Georgia, serif"
            latexFontSize={43}
          />
        {/if}
      </div>
    </section>

    <!-- Slide: Creating Regression Targets -->
    <section>
      <h2 class="slide-title">Creating Regression Targets</h2>
      <div class="figure-container" style="margin-top: 0.5em;">
        {#if dataLoaded}
          <ConditionalVelocityField
            width={1800}
            height={800}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
            latexFontSize={43}
          />
        {/if}
      </div>
    </section>

    <!-- Slide: Regressing the Velocity Field -->
    <section>
      <h2 class="slide-title">Regressing the Velocity Field</h2>
    </section>

    <!-- Slide: Stochastic Interpolants -->
    <section>
      <h2 class="slide-title">Stochastic Interpolants</h2>
      <p style="margin-top: 0.5em;">
        We take a deterministic path like the <span style="color: #3b82f6; font-weight: bold;">linear path</span> and stochastic interpolants add stochasticity <span style="color: #f17720; font-weight: bold;">(orange)</span>.
      </p>
      <div style="margin-top: 0.3em;">
        <Katex math={"X_t = (1-t)X_0 + tX_1 + \\sigma_t \\cdot \\varepsilon, \\quad \\varepsilon \\sim \\mathcal{N}(0, I)"} displayMode={true} />
      </div>
      <div class="figure-container" style="margin-top: -3em;">
        {#if dataLoaded}
          <StochasticInterpolation
            width={1800}
            height={600}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            sourcePointIndex={5}
            targetPointIndex={230}
            sigma={300}
            maxEpsilonNorm={1.5}
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
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          Albergo et al., <span style="font-style: italic;">Stochastic Interpolants: A Unifying Framework for Flows and Diffusions</span>, 2023
        </p>
      </div>
    </section>

    <!-- Slide: Practical Challenge: Curved Trajectories -->
    <section>
      <h2 class="slide-title">Practical Challenge: Curved Trajectories</h2>
      <p style="margin-top: 0.5em;">
        Naively training a flow matching model produces curved trajectories.
      </p>
      <div class="figure-container" style="margin-top: 1.5em;">
        {#if dataLoaded}
          <CurvedTrajectoryIntro
            flowMatchingClient={flowMatchingClient}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            allTimeSamples={$allTimeSamples}
            width={1600}
            height={700}
            distributionPointRadius={8}
            trajectoryStrokeWidth={5}
            trajectoryEndpointRadius={5}
            labelFontSize={70}
            sourceCenterX={0.15}
            targetCenterX={0.85}
            playingByDefault={true}
          />
        {/if}
      </div>
    </section>

    <!-- Slide: Curvature is the Enemy of Speed -->
    <section>
      <h2 class="slide-title">Curvature is the Enemy of Speed</h2>
      <p style="margin-top: 0.5em;">Accurately integrating curved functions requires taking smaller steps, which leads to higher sampling latency.</p>
      <div class="figure-container" style="margin-top: 1em;">
        <EulerSamplerFigure
          width={800}
          height={500}
          gap={10}
          backgroundVisible={false}
          labelFontSize={44}
          showPlayButton={false}
        />
      </div>
    </section>

    <!-- Slide: What Causes this Curvature? -->
    <section>
      <h2 class="slide-title">What Causes this Curvature?</h2>
      <p style="margin-top: 0.5em;">
        We train the velocity field <Katex math={"v_\\theta"} /> to match straight paths — why does this produce curvature?
      </p>
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
            height={800}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
            numScatterSamples={150}
            numLinesToDraw={100}
            useLatexLabels={true}
            sourceLabel={"\\pi(X_0)"}
            targetLabel={"\\pi(X_1)"}
            labelFontSize={50}
            sourceCenterX={0.2}
            targetCenterX={0.8}
            distributionScaleFactor={0.7}
            pointRadius={7}
          />
        {/if}
      </div>
      <aside class="notes">
        Independent coupling: randomly pair source and target samples. Lines animate left to right.
      </aside>
    </section>

    <!-- Slide: The Naive Independent Coupling -->
    <section>
      <h2 class="slide-title">The Naive Independent Coupling</h2>
      <p style="margin-top: 0.5em;">
        The simplest choice of coupling is the <em>independent coupling</em>, where <Katex math={"\\pi(X_0)"} /> and <Katex math={"\\pi(X_1)"} /> are independent of each other.
      </p>
      <div class="figure-container" style="margin-top: 1.5em;">
        {#if dataLoaded}
          <IndependentCouplingAnimated
            width={1800}
            height={800}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
            numScatterSamples={150}
            numLinesToDraw={100}
            useLatexLabels={true}
            sourceLabel={"\\pi(X_0)"}
            targetLabel={"\\pi(X_1)"}
            labelFontSize={50}
            sourceCenterX={0.2}
            targetCenterX={0.8}
            distributionScaleFactor={0.7}
            pointRadius={7}
          />
        {/if}
      </div>
      <aside class="notes">
        The naive independent coupling: randomly pair source and target samples.
      </aside>
    </section>

    <!-- Slide: Our Paths Crossed at the Wrong Time -->
    <section>
      <h2 class="slide-title">Our Paths Crossed at the Wrong Time</h2>
      <p style="margin-top: 0.5em;">
        The velocity field <Katex math={"v_t^\\theta"} /> cannot accurately resolve conflicting paths — the best it can do is average. This averaging leads to curved trajectories.
      </p>
      <div class="figure-container" style="margin-top: 2.5em;">
        {#if dataLoaded}
          <IntersectingPaths
            width={1800}
            height={800}
            sourceCenterX={0.2}
            targetCenterX={0.8}
            latexFontSize={40}
            labelFontSize={50}
            meanArrowLabelOffset={{ x: 60, y: -18 }}
            topArrowLabelOffset={{ x: -55, y: -60 }}
            bottomArrowLabelOffset={{ x: -55, y: 20 }}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
          />
        {/if}
      </div>
      <aside class="notes">
        Intersecting paths create conflicts for the velocity field, which must average, producing curved trajectories.
      </aside>
    </section>

    <!-- Slide: Rectified Flows -->
    <section>
      <h2 class="slide-title">Rectified Flows</h2>
      <p style="margin-top: 0.5em;">Reflow recursively trains flow matching models and uses them to produce a better coupling.</p>
      <div class="figure-container" style="margin-top: 1em;">
        {#if dataLoaded}
          <InducedCouplingAnimated
            width={1800}
            height={550}
            targetDistribution={$targetDistributionSamples}
            {flowMatchingClient}
            numSteps={200}
            numPoints={100}
            numLinesToDraw={100}
            numTrajectoriesToShow={30}
            animationDuration={24000}
            labelFontSize={50}
            toggleFontSize={28}
          />
        {/if}
      </div>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          Liu et al., <span style="font-style: italic;">Flow Straight and Fast: Learning to Generate and Transfer Data with Rectified Flow</span>, 2022
        </p>
      </div>
    </section>

    <!-- Slide: The Reflow Algorithm -->
    <section>
      <h2 class="slide-title">The Reflow Algorithm</h2>
      <div class="figure-container" style="margin-top: 2em;">
        <ReflowAlgorithm backgroundVisible={false} fontSize={36} />
      </div>
    </section>

    <!-- Slide: The Reflow Algorithm (visualization) -->
    <section>
      <h2 class="slide-title">The Reflow Algorithm</h2>
      <div class="figure-container" style="margin-top: 3em;">
        {#if dataLoaded}
          <InducedCouplingAnimated
            width={1800}
            height={550}
            targetDistribution={$targetDistributionSamples}
            {flowMatchingClient}
            numSteps={200}
            numPoints={100}
            numLinesToDraw={100}
            numTrajectoriesToShow={30}
            animationDuration={24000}
            labelFontSize={50}
            toggleFontSize={28}
          />
        {/if}
      </div>
    </section>

    <!-- Slide: Reflow Produces Straighter Trajectories -->
    <section>
      <h2 class="slide-title">Reflow Produces Straighter Trajectories</h2>
      <div class="figure-container" style="margin-top: 1em;">
        {#if dataLoaded}
          <RectifiedFlowSuperimposed
            width={1800}
            canvasWidth={700}
            canvasHeight={700}
            gap={10}
            {flowMatchingClient}
            {rectifiedFlowClient}
            leftTrajectories={flowMatchingGridTrajectories ?? []}
            rightTrajectories={rectifiedFlowGridTrajectories?.[rectifiedFlowGridTrajectories.length - 1]
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
    </section>

    <!-- Slide: Key References -->
    <section>
      <h2 class="slide-title">Key References</h2>
      <ul style="font-size: 0.75em; margin-top: 0.5em; line-height: 1.8;">
        <li>Rezende & Mohamed, <span style="font-style: italic;">Variational Inference with Normalizing Flows</span>, 2015</li>
        <li>Dinh et al., <span style="font-style: italic;">NICE: Non-linear Independent Components Estimation</span>, 2014</li>
        <li>Dinh et al., <span style="font-style: italic;">Density Estimation Using Real-Valued Non-Volume Preserving Transformations</span>, 2017</li>
        <li>Kingma & Dhariwal, <span style="font-style: italic;">Glow: Generative Flow with Invertible 1x1 Convolutions</span>, 2018</li>
        <li>Chen et al., <span style="font-style: italic;">Neural Ordinary Differential Equations</span>, 2018</li>
        <li>Lipman et al., <span style="font-style: italic;">Flow Matching for Generative Modeling</span>, 2023</li>
        <li>Albergo et al., <span style="font-style: italic;">Stochastic Interpolants: A Unifying Framework for Flows and Diffusions</span>, 2023</li>
        <li>Liu et al., <span style="font-style: italic;">Flow Straight and Fast: Learning to Generate and Transfer Data with Rectified Flow</span>, 2022</li>
      </ul>
    </section>

    <!-- Slide: Thank You -->
    <section>
      <h2 class="slide-title">Thank You</h2>
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
