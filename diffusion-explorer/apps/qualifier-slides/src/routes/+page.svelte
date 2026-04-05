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
  import ChangeOfVariablesAnnotated from '$lib/figures/ChangeOfVariablesAnnotated.svelte';
  import EulerODECurvature from '$lib/figures/EulerODECurvature.svelte';
  import EulerStepComparison from '$rectified-flow/figures/EulerStepComparison.svelte';
  import IndependentCoupling from '$rectified-flow/figures/IndependentCoupling.svelte';
  import OTCoupling from '$rectified-flow/figures/OTCoupling.svelte';
  import RectifiedFlowSuperimposed from '$rectified-flow/figures/RectifiedFlowSuperimposed.svelte';
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
  import CouplingPairsAnimated from '$lib/figures/CouplingPairsAnimated.svelte';
  import FlowInvertibilitySimple from '$lib/figures/FlowInvertibilitySimple.svelte';
  import ChangeOfVariablesIntro from '$lib/figures/ChangeOfVariablesIntro.svelte';
  import FlowerImageDistribution from '$lib/figures/FlowerImageDistribution.svelte';
  import TransformingNoiseIntoData from '$lib/figures/TransformingNoiseIntoData.svelte';
  import DiffusionVsFlow from '$lib/figures/DiffusionVsFlow.svelte';
  import FlowProbabilityPath from '$lib/figures/FlowProbabilityPath.svelte';
  import Slide from '$lib/components/Slide.svelte';
  import NormalizingFlowStages from '$lib/figures/NormalizingFlowStages.svelte';
  import ChangeOfVariables from '$lib/figures/ChangeOfVariables.svelte';
  import MaxLikelihoodTraining from '$lib/figures/MaxLikelihoodTraining.svelte';
  import StochasticInterpolation from '$lib/figures/StochasticInterpolation.svelte';
  import InducedCouplingAnimated from '$rectified-flow/figures/InducedCouplingAnimated.svelte';
  import DataLikelihood from '$lib/figures/DataLikelihood.svelte';
  import ChangeOfVariablesFigure from '$lib/figures/ChangeOfVariablesFigure.svelte';

  let flowerFigure: FlowerImageDistribution;
  let noiseFigure: TransformingNoiseIntoData;
  let diffFlowFigure: DiffusionVsFlow;
  let flowPathFigure: FlowProbabilityPath;
  let normFlowFigure: NormalizingFlowStages;
  let covFigure: ChangeOfVariables;
  let composeFigure: NormalizingFlowStages;
  let mlFigure: MaxLikelihoodTraining;
  let encodeFigure: MaxLikelihoodTraining;
  let invertibilityFigure: FlowInvertibilitySimple;
  let massFigure: FlowInvertibilitySimple;
  let jacobianFigure: ChangeOfVariablesIntro;
  let trajFigure: HighlightTrajectory;

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
  let covShowLog = false;

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

    <!-- Slide: About Me -->
    <section>
      <h2 class="slide-title">About Me</h2>
      <div style="display: flex; align-items: center; gap: 3em; margin-top: 4em;">
        <div style="flex: 6; display: flex; align-items: center; justify-content: center;">
          <ul style="font-size: 1.3em; line-height: 1.8;">
            <li>3rd year PhD student</li>
            <li>Advised by Polo Chau</li>
            <li>Research focus: generative models, interpretability, visualization</li>
          </ul>
        </div>
        <div style="flex: 4; display: flex; align-items: center; justify-content: center;">
          <img src="https://alechelbling.com/data/images/alec_photo.jpg" alt="Alec Helbling" style="width: 450px; height: 450px; border-radius: 16px; object-fit: cover;" />
        </div>
      </div>
      <aside class="notes">
        Brief introduction before diving into the technical content.
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

    <!-- Slide 4: Diffusion vs Flow (hidden for now) -->
    <!--
    <Slide figure={diffFlowFigure}>
      <DiffusionVsFlow bind:this={diffFlowFigure} width={1720} height={520} animationDuration={24000} />
    </Slide>
    -->

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

    <!-- Roadmap: Normalizing Flows -->
    <section class="roadmap-slide">
      <h2 class="slide-title">Presentation Roadmap</h2>
      <ol class="roadmap">
        <li class="roadmap-item roadmap-active">
          <p class="roadmap-title">Normalizing Flows</p>
          <p class="roadmap-ref">Rezende & Mohamed, 2015</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Continuous Normalizing Flows</p>
          <p class="roadmap-ref">Chen et al., 2018</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Flow Matching, Stochastic Interpolants</p>
          <p class="roadmap-ref">Lipman et al., 2023; Albergo & Vanden-Eijnden, 2023</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Rectified Flows</p>
          <p class="roadmap-ref">Liu et al., 2023</p>
        </li>
      </ol>
    </section>

    <!-- Slide 7: What is a Normalizing Flow? -->
    <Slide figure={normFlowFigure}>
      <h2 class="slide-title">What is a Normalizing Flow?</h2>
      <p style="margin-top: 0.5em;">
        A <strong>Normalizing Flow</strong> transforms a simple
        distribution <Katex math={"p(z)"}/> into a complex
        distribution <Katex math={"p(x)"}/> by a sequence of mappings <Katex math={"f_i(z)"}/>.
      </p>
      <div class="figure-container" style="margin-top: -50px;">
        <NormalizingFlowStages bind:this={normFlowFigure} width={1720} numStages={4} showLabels={true} looping={false} />
      </div>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          Rezende, D. &amp; Mohamed, S. (2015). Variational Inference with Normalizing Flows. <em>Proceedings of the 32nd International Conference on Machine Learning</em>, in <em>Proceedings of Machine Learning Research</em> 37:1530-1538.
        </p>
      </div>
    </Slide>

    <!-- Slide: Normalizing Flows are Invertible (figure) -->
    <Slide figure={invertibilityFigure}>
      <h2 class="slide-title">Flows are Invertible and Differentiable</h2>
      <p style="margin-top: 0.5em;">
        Invertibility ensures probability mass is not created or destroyed.
      </p>
      <div class="figure-container" style="margin-top: 2.5em;">
        {#if dataLoaded}
          <FlowInvertibilitySimple
            bind:this={invertibilityFigure}
            width={1800}
            height={850}
            {allTimeSamples}
            numLines={5}
            distributionScaleFactor={1.0}
            overlayText={"f(z) maps all points to distinct locations"}
          />
        {/if}
      </div>
    </Slide>

    <!-- Slide: How Likely is My Data? -->
    <section>
      <h2 class="slide-title">How Likely is My Data?</h2>
      <p style="margin-top: 0.5em;">
        It is easy to evaluate the density for a <span style="color: #4594e3;">simple distribution</span> <Katex math={"\\color{#4594e3}{p(z)}"} />, but not straightforward for a <span style="color: #f17720;">complex distribution</span> <Katex math={"\\color{#f17720}{p(x)}"} />.
      </p>
      <div class="figure-container" style="margin-top: 1.5em;">
        {#if dataLoaded}
          <DataLikelihood width={1800} height={850} {allTimeSamples} distributionScaleFactor={1.0} />
        {/if}
      </div>
    </section>

    <!-- Slide: Change of Variables Formula (click to toggle log form) -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section on:click={() => covShowLog = !covShowLog} style="cursor: pointer;">
      <h2 class="slide-title">Change of Variables Formula</h2>
      <p style="margin-top: 0.3em;">
        Flows link the <span style="color: #4594e3;">source density</span> <Katex math={"\\color{#4594e3}{p(z)}"} /> to the <span style="color: #f17720;">data density</span> <Katex math={"\\color{#f17720}{p(x)}"} />.
      </p>
      <div style="margin-top: 1.5em; height: 185px; overflow: visible; display: flex; align-items: center; justify-content: center; position: relative; z-index: 2;">
        {#if !covShowLog}
          <AnnotatedEquation
            scale={1.4}
            verticalGap={20}
            labelFontSize={36}
            boxPadding={4}
            tex={"{\\color{#4594e3} p(z)} \\left| \\det \\frac{\\partial f}{\\partial z} \\right|^{-1} = {\\color{#f17720} p(x)}"}
            annotations={[
              { color: '#4594e3', label: 'Source Density', side: 'above', align: 'left' },
              { color: '#f17720', label: 'Data Density', side: 'above', align: 'right' },
            ]}
          />
        {:else}
          <AnnotatedEquation
            scale={1.4}
            verticalGap={20}
            labelFontSize={36}
            boxPadding={4}
            tex={"{\\color{#4594e3} \\log p(z)} - \\log \\left| \\det \\frac{\\partial f}{\\partial z} \\right| = {\\color{#f17720} \\log p(x)}"}
            annotations={[
              { color: '#4594e3', label: 'Source Density', side: 'above', align: 'left' },
              { color: '#f17720', label: 'Data Density', side: 'above', align: 'right' },
            ]}
          />
        {/if}
      </div>
      <div class="figure-container" style="margin-top: 0px; position: relative; z-index: 1;">
        {#if dataLoaded}
          <ChangeOfVariablesFigure width={1800} height={800} {allTimeSamples} distributionScaleFactor={0.8} />
        {/if}
      </div>
    </section>

    <!-- Slide: Jacobian Measures Local Volume Change -->
    <Slide figure={jacobianFigure}>
      <h2 class="slide-title">Jacobian Measures Local Volume Change</h2>
      <p style="margin-top: 0.5em;">
        Determinant of the Jacobian <Katex math={"\\color{#2ecc71}{\\left| \\det \\frac{\\partial f}{\\partial z} \\right|}"} /> measures how <Katex math={"f"} /> locally stretches and compresses space.
      </p>
      <div class="figure-container" style="margin-top: 1.5em;">
        {#if dataLoaded}
          <ChangeOfVariablesIntro
            bind:this={jacobianFigure}
            width={1800}
            height={800}
            {allTimeSamples}
            numFrames={5}
            distributionScaleFactor={1.0}
          />
        {/if}
      </div>
    </Slide>

    <!-- Slide: Composing Multiple Transformations -->
    <Slide figure={composeFigure}>
      <h2 class="slide-title">Composing Multiple Transformations</h2>
      <div style="margin-top: 1.5em; margin-bottom: 0.8em;">
        <AnnotatedEquation
          scale={1.3}
          verticalGap={60}
          rowSpacing={40}
          labelFontSize={48}
          tex={"\\log p(x) = \\log p(z_0) + {\\color{#2ecc71} \\sum_{i=0}^{K-1} \\log \\left| \\det \\frac{\\partial f_i}{\\partial z_i} \\right|}"}
          annotations={[
            { color: '#2ecc71', label: 'Sum of Log Volume Changes', side: 'above', align: 'left' },
          ]}
        />
      </div>
      <div class="figure-container" style="margin-top: 10px; height: 520px; overflow: hidden;">
        <NormalizingFlowStages bind:this={composeFigure} width={1720} numStages={4} showLabels={true} static={true} />
      </div>
    </Slide>

    <!-- Slide: Computing the Likelihood of Data -->
    <Slide figure={encodeFigure}>
      <h2 class="slide-title">Computing the Likelihood of Data</h2>
      <p style="margin-top: 0.3em;">
        Map data <Katex math={"x"} /> through the inverses <Katex math={"f_i^{-1}"} /> to compute <Katex math={"\\color{#3b82f6}{\\log p(x)}"} />.
      </p>
      <div style="margin-top: 1em; margin-bottom: 0.8em;">
        <AnnotatedEquation
          scale={1.3}
          verticalGap={20}
          rowSpacing={35}
          labelFontSize={36}
          tex={"{\\color{#3b82f6} \\log p(x)} = \\log p(z_0) + \\sum_{i=0}^{K-1} \\log \\left| \\det \\frac{\\partial f_i^{-1}}{\\partial z_{i+1}} \\right|"}
          annotations={[
            { color: '#3b82f6', label: 'Data Log-Likelihood', side: 'above', align: 'right' },
          ]}
        />
      </div>
      <div class="figure-container" style="margin-top: -20px; height: 580px; overflow: visible;">
        <MaxLikelihoodTraining bind:this={encodeFigure} width={1720} height={580} numStages={4} reversed={true} highlightPointIndices={[15]} highlightColor="#3b82f6" showImages={true} />
      </div>
    </Slide>

    <!-- Slide: Maximum Likelihood Training -->
    <Slide figure={mlFigure}>
      <h2 class="slide-title">Maximum Likelihood Training</h2>
      <p style="margin-top: 0.3em;">
        Learn <Katex math={"f_{i,\\theta}"} /> that maximize the log-likelihood of observed <span style="color: #3b82f6; font-weight: bold;">data</span>:
      </p>
      <div style="margin-top: 1.5em; margin-bottom: -20px;">
        <AnnotatedEquation
          scale={1.1}
          verticalGap={50}
          labelFontSize={42}
          boxPadding={4}
          tex={"{\\color{#f17720} f_{1,\\theta}^*, \\ldots, f_{K,\\theta}^*} = \\arg\\max_\\theta \\sum_{{\\color{#3b82f6} x \\in \\mathcal{D}}} \\log p_\\theta(x)"}
          annotations={[
            { color: '#3b82f6', label: 'Data', side: 'below' },
            { color: '#f17720', label: 'Learned Flows', side: 'above', align: 'left' },
          ]}
        />
      </div>
      <div class="figure-container" style="margin-top: -20px; height: 520px; overflow: visible;">
        <MaxLikelihoodTraining bind:this={mlFigure} width={1720} height={520} numStages={4} reversed={true} showImages={true} />
      </div>
    </Slide>

    <!-- Slide: Jacobian Determinants Are Expensive -->
    <section>
      <h2 class="slide-title">Jacobian Determinants Are Expensive</h2>
      <p style="margin-top: 0.5em;">
        In general, flows require computing <span style="color: #e74c3c; font-weight: bold;">expensive determinants</span>.
      </p>
      <div style="margin-top: 2em;">
        <AnnotatedEquation
          scale={1.8}
          verticalGap={85}
          labelFontSize={42}
          tex={"\\log p(x) = \\log p(z_0) + \\sum_{i=1}^{K} \\log \\left| {\\color{#e74c3c} \\det \\dfrac{\\partial f_i}{\\partial z_{i-1}}} \\right|"}
          annotations={[
            { color: '#e74c3c', label: 'O(d³) in general', side: 'below', align: 'left' },
          ]}
        />
      </div>
      <p style="margin-top: 2em;">
        A substantial body of work restricts <Katex math={"f_i"} /> to make evaluating the determinants more efficient.
      </p>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          <strong>Examples:</strong> Planar flows <span style="font-style: italic;">(Rezende &amp; Mohamed, 2015)</span>,
          Real NVP <span style="font-style: italic;">(Dinh et al., 2017)</span>,
          Glow <span style="font-style: italic;">(Kingma &amp; Dhariwal, 2018)</span>
        </p>
      </div>
    </section>

    <!-- Roadmap: Continuous Normalizing Flows -->
    <section class="roadmap-slide">
      <h2 class="slide-title">Presentation Roadmap</h2>
      <ol class="roadmap">
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Normalizing Flows</p>
          <p class="roadmap-ref">Rezende & Mohamed, 2015</p>
        </li>
        <li class="roadmap-item roadmap-active">
          <p class="roadmap-title">Continuous Normalizing Flows</p>
          <p class="roadmap-ref">Chen et al., 2018</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Flow Matching, Stochastic Interpolants</p>
          <p class="roadmap-ref">Lipman et al., 2023; Albergo & Vanden-Eijnden, 2023</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Rectified Flows</p>
          <p class="roadmap-ref">Liu et al., 2023</p>
        </li>
      </ol>
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
            height={600}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            {allTimeSamples}
            {isTraining}
            playingByDefault={true}
            backgroundVisible={false}
            showContours={true}
            distributionScaleFactor={0.7}
            showTimeSlider={true}
            useRawSlider={true}
            sliderMaxWidth="1100px"
            sliderLabelSize="30px"
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

    <!-- Slide: Sampling Trajectories From a CNF -->
    <Slide figure={trajFigure}>
      <h2 class="slide-title">Sampling Trajectories From a CNF</h2>
      <p style="margin-top: 0.5em;">
        Individual samples have trajectories <Katex math={"\\color{#f17720}{x(t)}"} /> from <Katex math={"x_0 \\sim p_0"} /> to <Katex math={"x_1 \\sim p_1"} />.
      </p>
      <div class="figure-container" style="margin-top: 1em;">
        {#if dataLoaded}
          <HighlightTrajectory
            bind:this={trajFigure}
            width={1800}
            height={700}
            {flowMatchingClient}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            allTimeSamples={$allTimeSamples}
            isTraining={$isTraining}
            numTrajectoriesToShow={1}
            reverse={false}
            showTimeSlider={true}
            useRawSlider={true}
            sliderMaxWidth="1100px"
            sliderLabelSize="30px"
            distributionScaleFactor={0.8}
            endpointRadius={12}
            trajectoryStrokeWidth={5}
            latexFontSize={43}
            animationDuration={8000}
            pauseBeforeRestart={3000}
            sourceLabelText={"p_0"}
            targetLabelText={"p_1"}
            labelFontSize={50}
          />
        {/if}
      </div>
    </Slide>

    <!-- Slide: CNFs Learn to Represent Velocity Fields -->
    <section>
      <h2 class="slide-title">CNFs Learn to Represent Velocity Fields</h2>
      <div style="display: flex; align-items: center; gap: 2em; margin-top: 1em;">
        <div style="flex: 1;">
          <p style="margin-top: 0;">
            CNFs model a velocity field <Katex math={"\\color{#3b82f6}{v_\\theta}"} />.
          </p>
          <p style="margin-top: 0.5em;">
            Generate sample trajectories by solving an ODE:
          </p>
          <div style="margin-top: 0.2em;">
            <Katex math={"\\frac{d\\color{#f17720}{x}}{dt} = \\color{#3b82f6}{v_\\theta(x, t)}"} displayMode={true} />
          </div>
          <p style="margin-top: 0.5em;">
            Using numerical integration methods like Euler's method:
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
              arrowHeadRadius={8}
              arrowScale={100}
              arrowWidth={5}
              arrowOpacity={1.0}
              trajectoryStrokeWidth={5}
              trajectoryHeadRadius={8}
              targetPointRadius={7}
              showTimeSlider={true}
              useRawSlider={true}
              sliderMaxWidth="700px"
              sliderLabelSize="30px"
            />
          {/if}
        </div>
      </div>
    </section>

    <!-- Slide: CNFs Allow More Efficient Likelihood Based Training -->
    <section>
      <h2 class="slide-title">CNFs Allow More Efficient Training</h2>
      <p style="margin-top: 0.8em;">
        The instantaneous change of variables replaces the expensive Jacobian determinant with a <span style="color: #22c55e;">trace</span>:
      </p>
      <div style="margin-top: 3em;">
        <AnnotatedEquation
          scale={1.5}
          verticalGap={60}
          tex={"\\log p_1(x_1) = \\log p_0(x_0) - \\int_0^1 {\\color{#22c55e} \\operatorname{tr}\\!\\left(\\dfrac{\\partial v_\\theta}{\\partial x}\\right)} \\, dt"}
          annotations={[
            { color: '#22c55e', label: 'Trace is only O(d)', side: 'above', align: 'left' },
          ]}
        />
      </div>
    </section>

    <!-- Slide: Likelihood Based Training is Expensive -->
    <section>
      <h2 class="slide-title">Training is Still Expensive</h2>
      <p style="margin-top: 0.5em;">
        Requires solving an ODE at <em style="color: #e74c3c;">every training step</em>.
      </p>
      <div style="margin-top: 0.3em;">
        <AnnotatedEquation
          scale={1.3}
          verticalGap={60}
          labelFontSize={36}
          tex={"\\log p_1(x_1) = \\log p_0(x_0) - {\\color{#e74c3c} \\int_0^1 \\operatorname{tr}\\!\\left(\\frac{\\partial v_t}{\\partial x}\\right) \\, dt}"}
          annotations={[
            { color: '#e74c3c', label: 'Requires O(n) ODE solves', side: 'below', align: 'left' },
          ]}
        />
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
            sourceLabelText={"p_0"}
            targetLabelText={"p_1"}
            labelFontSize={50}
          />
        {/if}
      </div>
      <aside class="notes">
        Key motivation for flow matching: CNFs are expressive but training via maximum likelihood is expensive because of the trace computation and ODE simulation at every step. Flow matching avoids both.
      </aside>
    </section>

    <!-- Roadmap: Flow Matching -->
    <section class="roadmap-slide">
      <h2 class="slide-title">Presentation Roadmap</h2>
      <ol class="roadmap">
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Normalizing Flows</p>
          <p class="roadmap-ref">Rezende & Mohamed, 2015</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Continuous Normalizing Flows</p>
          <p class="roadmap-ref">Chen et al., 2018</p>
        </li>
        <li class="roadmap-item roadmap-active">
          <p class="roadmap-title">Flow Matching, Stochastic Interpolants</p>
          <p class="roadmap-ref">Lipman et al., 2023; Albergo & Vanden-Eijnden, 2023</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Rectified Flows</p>
          <p class="roadmap-ref">Liu et al., 2023</p>
        </li>
      </ol>
    </section>

    <!-- Slide: Flow Matching -->
    <section>
      <h2 class="slide-title">Flow Matching</h2>
      <p style="margin-top: 0.5em;">
        Flow matching enables <strong>simulation-free training</strong> — training CNFs without running expensive ODE solvers at each step.
      </p>
      <div style="margin-top: 0.3em;">
        <Katex math={"\\mathcal{L}_{FM}(\\theta) = \\mathbb{E}_{t, x_0, x_1} \\left\\| {\\color{#22c55e} v_t^\\theta(x_t)} - {\\color{#f17720} v_t(x_t|x_1)} \\right\\|^2"} displayMode={true} />
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

    <!-- Slide: The Probability Path -->
    <section>
      <h2 class="slide-title">The Probability Path</h2>
      <p style="margin-top: 0.5em;">
        A <span style="color: #f17720; font-weight: bold;">probability path</span> <Katex math={"\\color{#f17720}{p_t(x)}"} /> describes how the distribution evolves continuously from source <Katex math={"p_0"} /> to target <Katex math={"p_1"} />.
      </p>
      <div class="figure-container" style="margin-top: 0.5em;">
        {#if dataLoaded}
          <ProbabilityPath
            width={1800}
            height={600}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            {allTimeSamples}
            {isTraining}
            playingByDefault={true}
            backgroundVisible={false}
            showContours={true}
            distributionScaleFactor={0.7}
            showTimeSlider={true}
            useRawSlider={true}
            sliderMaxWidth="1100px"
            sliderLabelSize="30px"
            labelFontSize={50}
            labelFontFamily="Libre Baskerville, Georgia, serif"
            latexFontSize={43}
          />
        {/if}
      </div>
    </section>

    <!-- Slide: Specifying the Probability Path -->
    <section>
      <h2 class="slide-title">The Linear Probability Path</h2>
      <p style="margin-top: 0.5em;">
        The simplest choice of path is to linearly interpolate our source <Katex math={"X_0"} /> and target <Katex math={"X_1"} /> random variables:
      </p>
      <div class="figure-container" style="margin-top: 0.5em;">
        {#if dataLoaded}
          <LinearInterpolation
            width={1800}
            height={700}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            sourcePointIndex={5}
            targetPointIndex={230}
            playingByDefault={true}
            backgroundVisible={false}
            showEquation={true}
            equationText={"X_t = (1 - t)X_0 + tX_1"}
            useLatexLabels={true}
            sourceLabelText={"X_0"}
            targetLabelText={"X_1"}
            labelFontSize={50}
            labelFontFamily="Libre Baskerville, Georgia, serif"
            latexFontSize={43}
            sliderMaxWidth="1200px"
            sliderLabelSize="30px"
            showPlayButton={false}
          />
        {/if}
      </div>
    </section>

    <!-- Slide: The Conditional Velocity Field -->
    <section>
      <h2 class="slide-title">The Conditional Velocity Field</h2>
      <p style="margin-top: 0.5em;">
        The <span style="color: #f17720; font-weight: bold;">conditional velocity field</span> <Katex math={"\\color{#f17720}{v_t(x_t | x_1)}"} /> is the velocity that moves <Katex math={"x_t"} /> along the path toward <Katex math={"x_1"} />.
      </p>
      <div class="figure-container" style="margin-top: 1.5em;">
        {#if dataLoaded}
          <ConditionalVelocityField
            width={1800}
            height={840}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
            playingByDefault={true}
            singlePathMode={true}
            sourceCenterX={0.2}
            targetCenterX={0.8}
            yShiftFactor={-0.5}
            distributionScaleFactor={0.65}
            pointOpacity={0.4}
            distributionLabelOffsetY={40}
            latexFontSize={43}
            vectorScale={0.4}
            vectorWidth={4.5}
            animationDuration={8000}
          />
        {/if}
      </div>
    </section>

    <!-- Slide: Regressing the Velocity Field -->
    <section>
      <h2 class="slide-title">Regressing the Velocity Field</h2>
      <p style="margin-top: 0.5em;">
        Given a point <Katex math={"x_t"} /> we want to predict the velocity <Katex math={"\\color{#22c55e}{v_t^\\theta(x_t)}"} /> that matches the target conditional velocity <Katex math={"\\color{#f17720}{v_t(x_t | x_1)}"} />.
      </p>
      <div style="margin-top: 0.3em;">
        <Katex math={"\\mathcal{L}_{FM}(\\theta) = \\mathbb{E}_{t, x_0, x_1} \\left\\| {\\color{#22c55e} v_t^\\theta(x_t)} - {\\color{#f17720} v_t(x_t|x_1)} \\right\\|^2"} displayMode={true} />
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
    </section>

    <!-- Slide: Stochastic Interpolants -->
    <section>
      <h2 class="slide-title">Stochastic Interpolants</h2>
      <p style="margin-top: 0.5em;">
        We take a deterministic path like the <span style="color: #3b82f6; font-weight: bold;">linear path</span> and <span style="color: #f17720; font-weight: bold;">stochastic interpolants</span> add stochasticity.
      </p>
      <div style="margin-top: 0.3em;">
        <AnnotatedEquation
          scale={1.3}
          verticalGap={50}
          labelFontSize={42}
          tex={"X_t = (1-t)X_0 + tX_1 + {\\color{#f17720} \\sigma_t \\cdot \\varepsilon}, \\quad \\varepsilon \\sim \\mathcal{N}(0, I)"}
          annotations={[
            { color: '#f17720', label: 'Noise', side: 'below' },
          ]}
        />
      </div>
      <div class="figure-container" style="margin-top: -3em;">
        {#if dataLoaded}
          <StochasticInterpolation
            width={1800}
            height={600}
            sourcePointColor={"#999"}
            targetPointColor={"#999"}
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

    <!-- Slide: Developed Independently in Parallel -->
    <section>
      <h2 class="slide-title">Two Frameworks, One Idea</h2>
      <p style="margin-top: 0.5em;">
        Flow Matching and Stochastic Interpolants were developed independently and in parallel, arriving at the same core insight.
      </p>
      <div style="display: flex; align-items: flex-start; justify-content: center; gap: 3em; margin-top: 2em;">
        <div style="flex: 1; text-align: center;">
          <img src="{base}/images/flow_matching_paper.png" alt="Flow Matching paper" style="max-height: 600px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" />
          <p style="font-size: 0.7em; color: #888; margin-top: 0.5em;">Lipman et al., 2023</p>
        </div>
        <div style="flex: 1; text-align: center;">
          <img src="{base}/images/stochastic_interpolants_paper.png" alt="Stochastic Interpolants paper" style="max-height: 600px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" />
          <p style="font-size: 0.7em; color: #888; margin-top: 0.5em;">Albergo & Vanden-Eijnden, 2023</p>
        </div>
      </div>
    </section>

    <!-- Roadmap: Rectified Flows -->
    <section class="roadmap-slide">
      <h2 class="slide-title">Presentation Roadmap</h2>
      <ol class="roadmap">
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Normalizing Flows</p>
          <p class="roadmap-ref">Rezende & Mohamed, 2015</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Continuous Normalizing Flows</p>
          <p class="roadmap-ref">Chen et al., 2018</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-title">Flow Matching, Stochastic Interpolants</p>
          <p class="roadmap-ref">Lipman et al., 2023; Albergo & Vanden-Eijnden, 2023</p>
        </li>
        <li class="roadmap-item roadmap-active">
          <p class="roadmap-title">Rectified Flows</p>
          <p class="roadmap-ref">Liu et al., 2023</p>
        </li>
      </ol>
    </section>

    <!-- Slide: Practical Challenge: Curved Trajectories -->
    <section>
      <h2 class="slide-title">Practical Challenge: Curved Trajectories</h2>
      <p style="margin-top: 0.5em;">
        Naively training a flow matching model produces curved trajectories.
      </p>
      <div class="figure-container" style="margin-top: 1.5em;">
        {#if dataLoaded}
          <ChangeOfVariablesAnnotated
            flowMatchingClient={flowMatchingClient}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            allTimeSamples={$allTimeSamples}
            width={1600}
            height={700}
            distributionPointRadius={8}
            trajectoryStrokeWidth={5}
            trajectoryEndpointRadius={5}
            trajectoryColor="#f17720"
            labelFontSize={50}
            sourceCenterX={0.2}
            targetCenterX={0.8}
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
        <EulerODECurvature
          width={800}
          height={500}
          gap={10}
          backgroundVisible={false}
          labelFontSize={56}
          showPlayButton={false}
        />
      </div>
    </section>

    <!-- Slide: What Causes this Curvature? -->
    <section>
      <h2 class="slide-title">What Causes Curved Paths?</h2>
      <p style="margin-top: 0.5em;">
        We train the velocity field <Katex math={"v_\\theta"} /> to match straight paths — why does this produce curvature?
      </p>
      <div class="figure-container" style="margin-top: 0.3em; max-height: 650px; overflow: hidden;">
        {#if dataLoaded}
          <ConditionalFlowMatching
            width={1800}
            height={650}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
            distributionScaleFactor={0.85}
            yShiftFactor={-0.8}
            sourceCenterX={0.25}
            targetCenterX={0.75}
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
        A <em>coupling</em> is a joint distribution <Katex math={"\\pi({\\color{#3b82f6}{X_0}}, {\\color{#f17720}{X_1}})"} /> between our source <Katex math={"\\pi({\\color{#3b82f6}{X_0}})"} /> and target <Katex math={"\\pi({\\color{#f17720}{X_1}})"} /> random variables.
      </p>
      <div class="figure-container" style="margin-top: 1.5em;">
        {#if dataLoaded}
          <CouplingPairsAnimated
            width={1800}
            height={800}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
            numScatterSamples={150}
            sourceLabel={"\\pi({\\color{#3b82f6}{X_0}})"}
            targetLabel={"\\pi({\\color{#f17720}{X_1}})"}
            labelFontSize={50}
            latexFontSize={43}
            sourceCenterX={0.2}
            targetCenterX={0.8}
            distributionScaleFactor={0.7}
            pointRadius={7}
            numPairs={10}
            pairDuration={2500}
          />
        {/if}
      </div>
      <aside class="notes">
        Coupling: pairs drawn one at a time with labels showing (x_0, x_1).
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
            labelFontFamily="Libre Baskerville, Georgia, serif"
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
            height={600}
            targetDistribution={$targetDistributionSamples}
            {flowMatchingClient}
            numSteps={200}
            numPoints={100}
            numLinesToDraw={100}
            numTrajectoriesToShow={30}
            animationDuration={24000}
            labelFontSize={50}
            labelFontFamily="Libre Baskerville, Georgia, serif"
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

    <!-- Slide: The Reflow Algorithm (hidden for now) -->
    <!--
    <section>
      <h2 class="slide-title">The Reflow Algorithm</h2>
      <div class="figure-container" style="margin-top: 2em;">
        <ReflowAlgorithm backgroundVisible={false} fontSize={36} />
      </div>
    </section>

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
            labelFontFamily="Libre Baskerville, Georgia, serif"
            toggleFontSize={28}
          />
        {/if}
      </div>
    </section>
    -->

    <!-- Slide: Reflow Produces Straighter Trajectories -->
    <section>
      <h2 class="slide-title">Reflow Produces Straighter Trajectories</h2>
      <div class="figure-container" style="margin-top: 2em;">
        {#if dataLoaded}
          <RectifiedFlowSuperimposed
            width={1800}
            canvasWidth={650}
            canvasHeight={650}
            gap={20}
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
            showTimeSlider={false}
            labelFontSize={40}
            trajectoryStrokeWidth={4}
          />
        {/if}
      </div>
    </section>

    <!-- Slide: Key References -->
    <section>
      <h2 class="slide-title">Key References</h2>
      <div style="font-size: 0.85em; margin-top: 1em; line-height: 1.8;">
        <p class="bib-entry">[1] D. Rezende & S. Mohamed. "Variational Inference with Normalizing Flows." <em>ICML</em>, 2015.</p>
        <p class="bib-entry">[2] R. Chen et al. "Neural Ordinary Differential Equations." <em>NeurIPS</em>, 2018.</p>
        <p class="bib-entry">[3] Y. Lipman et al. "Flow Matching for Generative Modeling." <em>ICLR</em>, 2023.</p>
        <p class="bib-entry">[4] M. Albergo & E. Vanden-Eijnden. "Stochastic Interpolants: A Unifying Framework for Flows and Diffusions." <em>ICML</em>, 2023.</p>
        <p class="bib-entry">[5] Q. Liu et al. "Flow Straight and Fast: Learning to Generate and Transfer Data with Rectified Flow." <em>ICLR</em>, 2023.</p>
      </div>
    </section>

    <!-- Slide: Conclusion -->
    <section>
      <h2 class="slide-title">Conclusion</h2>
      <ul style="margin-top: 1em; font-size: 1.05em; line-height: 1.8;">
        <li><strong>Normalizing Flows</strong> — invertible mappings with tractable densities via the change of variables formula</li>
        <li><strong>Continuous Normalizing Flows</strong> — replace discrete layers with a continuous-time ODE, avoiding expensive Jacobian determinants</li>
        <li><strong>Flow Matching &amp; Stochastic Interpolants</strong> — scalable training via regression on conditional velocity fields</li>
        <li><strong>Rectified Flows</strong> — straighten trajectories through reflow for efficient few-step sampling</li>
      </ul>
    </section>

    <!-- Slide: Thank You -->
    <section>
      <h2 class="slide-title">Thank You</h2>
    </section>

  </div>
</div>

<style>
  :global(.reveal) {
    user-select: none;
    -webkit-user-select: none;
  }

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
    transition: opacity 0.3s;
  }

  .roadmap-active {
    opacity: 1;
  }

  .roadmap-active .roadmap-title {
    color: #f17720;
    font-weight: bold;
  }

  .roadmap-inactive {
    opacity: 0.35;
  }

  :global(.bib-entry) {
    margin: 0 0 0.6em 0;
    text-indent: -1.5em;
    padding-left: 1.5em;
    break-inside: avoid;
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
