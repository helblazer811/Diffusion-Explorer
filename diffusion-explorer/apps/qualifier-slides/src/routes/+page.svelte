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
  import { Katex, AnnotatedEquation, Timeline } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';

  // ========== FIGURE IMPORTS ==========

  // From continuity-equation-explainer
  import ProbabilityPathIntro from '$continuity/figures/ProbabilityPathIntro.svelte';
  import CrownJewel from '$rectified-flow/figures/CrownJewel.svelte';
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
  import CNFGridJacobian from '$lib/figures/CNFGridJacobian.svelte';
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
  let genSamplesFigure: MaxLikelihoodTraining;
  let invertibilityFigure: FlowInvertibilitySimple;
  let massFigure: FlowInvertibilitySimple;
  let gridJacobianFigure: CNFGridJacobian;
  let trajFigure: HighlightTrajectory;
  let rectifiedFlowFigure: InducedCouplingAnimated;
  let reflowFigure: CrownJewel;
  let dataLikelihoodFigure: any;

  // Provide reveal instance to Slide components via context
  setContext('getReveal', () => revealInstance);
  setContext('annotatedEquationDefaults', { connectorStyle: 'curve' });

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
  let flowMatchingDenseTrajectories: number[][][] | null = null;
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
  let efficientTrainingPhase = 0; // 0 = show NF equation, 1 = X over it + show CNF equation
  let fmTrainingPhase = 0; // 0 = show ML equation, 1 = X over it + show FM equation
  let stochIntPhase = 0; // 0 = normal slide, 1 = white overlay + same training objective

  // SOTA image generation slide
  const sotaImageFiles = [
    'image_1.png', 'image_2.png', 'image_3.png', 'image_4.png', 'image_5.png',
  ];
  type SotaImage = { file: string; x: number; y: number; w: number; rotation: number };
  const sotaImages: SotaImage[] = (() => {
    const n = sotaImageFiles.length;
    const spacing = 1600 / n;
    return sotaImageFiles.map((file, i) => ({
      file,
      x: 80 + i * spacing,
      y: i % 2 === 0 ? 40 : 380,
      w: 500,
      rotation: (i % 2 === 0 ? -4 : 4),
    }));
  })();
  let sotaRevealCount = 0;

  // Compute expensive slide images
  const computeExpensiveFiles = ['image.png', 'image_2.png', 'image_3.png', 'image_4.png', 'image_5.png'];
  type CEImage = { file: string; x: number; y: number; w: number; rotation: number };
  const computeExpensiveImages: CEImage[] = (() => {
    const n = computeExpensiveFiles.length;
    const spacing = 1500 / n;
    return computeExpensiveFiles.map((file, i) => ({
      file,
      x: 40 + i * spacing,
      y: i % 2 === 0 ? 20 : 400,
      w: 700,
      rotation: (i % 2 === 0 ? -4 : 4),
    }));
  })();
  let ceRevealCount = 0;
  let intersectingPathsSource: number[][] = [];
  let intersectingPathsFigure: any;

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

    // Click anywhere (non-interactive) to advance
    deckEl.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('a, button, input, select, textarea, [data-no-advance]')) return;
      revealInstance.next();
    });

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

    // Load dense flow matching trajectories (for CNF grid+Jacobian slide)
    try {
      const result = await loadCachedTraj(`${base}/${settings.rf.cachedFlowMatchingDenseTrajectoriesPath}`);
      if (result) {
        flowMatchingDenseTrajectories = result.trajectories;
      }
    } catch (e) { console.warn('Failed to load FM dense trajectories:', e); }

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

    // Source distribution for IntersectingPaths: needs to match smiley face point count (500)
    intersectingPathsSource = clipSamplesToRadius(generateClippedGaussianSamples(500), 2.0);

    dataLoaded = true;
  });

  onDestroy(() => {
    revealInstance?.destroy();
  });

  // Svelte action: reveal SOTA images one by one using Timeline
  function sotaImageReveal(sectionEl: HTMLElement) {
    type SotaState = { count: number };
    const tl = new Timeline<SotaState>();
    tl.initialState = { count: 0 };
    tl.duration = sotaImages.length * 0.36; // 360ms per image
    tl.looping = false;
    tl.add({
      name: 'Reveal',
      reduce(t) { return { count: Math.floor(t * sotaImages.length + 0.999) }; },
    }, { start: 0, end: 1 });
    tl.onTick((_t, state) => { sotaRevealCount = state.count; });

    function onSlideChanged(event: any) {
      if (event.currentSlide === sectionEl) {
        sotaRevealCount = 0;
        tl.reset();
        tl.play();
      } else {
        tl.pause();
        sotaRevealCount = 0;
      }
    }
    const poll = setInterval(() => {
      if (revealInstance) {
        clearInterval(poll);
        revealInstance.on('slidechanged', onSlideChanged);
      }
    }, 100);
    return { destroy() { clearInterval(poll); tl.pause(); revealInstance?.off?.('slidechanged', onSlideChanged); } };
  }

  // Svelte action: reveal compute expensive images using Timeline
  function ceImageReveal(sectionEl: HTMLElement) {
    const tl = new Timeline<{ count: number }>();
    tl.initialState = { count: 0 };
    tl.duration = computeExpensiveImages.length * 0.72;
    tl.looping = false;
    tl.add({
      name: 'Reveal',
      reduce(t) { return { count: Math.floor(t * computeExpensiveImages.length + 0.999) }; },
    }, { start: 0, end: 1 });
    tl.onTick((_t, state) => { ceRevealCount = state.count; });

    function onSlideChanged(event: any) {
      if (event.currentSlide === sectionEl) {
        ceRevealCount = 0;
        tl.reset();
        tl.play();
      } else {
        tl.pause();
        ceRevealCount = 0;
      }
    }
    const poll = setInterval(() => {
      if (revealInstance) {
        clearInterval(poll);
        revealInstance.on('slidechanged', onSlideChanged);
      }
    }, 100);
    return { destroy() { clearInterval(poll); tl.pause(); revealInstance?.off?.('slidechanged', onSlideChanged); } };
  }

  // Svelte action: handle CNFs efficient training slide clicks
  function efficientTrainingClickHandler(node: HTMLElement) {
    function handleClick(e: MouseEvent) {
      e.stopPropagation();
      if (efficientTrainingPhase < 1) {
        efficientTrainingPhase = 1;
      } else {
        efficientTrainingPhase = 0;
        revealInstance?.next();
      }
    }
    node.addEventListener('click', handleClick);
    return { destroy() { node.removeEventListener('click', handleClick); } };
  }

  // Svelte action: handle stochastic interpolants slide clicks
  function stochIntClickHandler(node: HTMLElement) {
    function handleClick(e: MouseEvent) {
      e.stopPropagation();
      if (stochIntPhase < 1) {
        stochIntPhase = 1;
      } else {
        stochIntPhase = 0;
        revealInstance?.next();
      }
    }
    node.addEventListener('click', handleClick);
    return { destroy() { node.removeEventListener('click', handleClick); } };
  }

  // Svelte action: handle FM training slide clicks
  function fmTrainingClickHandler(node: HTMLElement) {
    function handleClick(e: MouseEvent) {
      e.stopPropagation();
      if (fmTrainingPhase < 1) {
        fmTrainingPhase = 1;
      } else {
        fmTrainingPhase = 0;
        revealInstance?.next();
      }
    }
    node.addEventListener('click', handleClick);
    return { destroy() { node.removeEventListener('click', handleClick); } };
  }

  // Svelte action: handle COV slide clicks — first toggles log form, second advances slide
  function covClickHandler(node: HTMLElement) {
    function handleClick(e: MouseEvent) {
      e.stopPropagation();
      if (!covShowLog) {
        covShowLog = true;
      } else {
        covShowLog = false;
        revealInstance?.next();
      }
    }
    node.addEventListener('click', handleClick);
    return { destroy() { node.removeEventListener('click', handleClick); } };
  }

  // Svelte action: play the video in a section when that slide becomes active
  function playVideoOnSlide(sectionEl: HTMLElement) {
    function playVideo() {
      const video = sectionEl.querySelector('video');
      if (video) video.play().catch(() => {});
    }
    function onSlideChanged(event: any) {
      if (event.currentSlide === sectionEl) playVideo();
    }
    // Poll until revealInstance is ready
    const interval = setInterval(() => {
      if (revealInstance) {
        clearInterval(interval);
        revealInstance.on('slidechanged', onSlideChanged);
        // Play immediately if this slide is already active
        if (revealInstance.getCurrentSlide?.() === sectionEl) playVideo();
      }
    }, 100);
    return {
      destroy() {
        clearInterval(interval);
        revealInstance?.off?.('slidechanged', onSlideChanged);
      }
    };
  }
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
        <p style="font-size: 1.2em; color: #999; margin-top: 0.4em;"><a href="https://alechelbling.com" style="color: #999;">alechelbling.com</a></p>
      </div>
      <aside class="notes">
        <ul>
          <li>Hi, my name is Alec, and today I'll be giving a presentation on flow based generative models. The format is really more of a tutorial on the topic where I'll discuss some of the important works in the field, and share some animated visualizations explaining some of the underlying geometric concepts.</li>
        </ul>
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
        <ul>
          <li>Just a little bit about me, I'm a 3rd year PhD student advised by Polo here in the CSE department. I have broad interests, but a lot of my research has focused on the intersection of generative models for visual modalities like images and video and machine learning interpretability, and I have in interest in applying data visualization to understand an explain these models.</li>
        </ul>
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
      <aside class="notes">
        <ul>
          <li>Starting out very broadly.</li>
          <li>Two of the core goals of generative modeling are to learn to represent a distribution p(x) of data — here the distribution is images of flowers.</li>
          <li>And our goal is model this distribution of data in a way that also allows us to efficiently generate new samples.</li>
        </ul>
      </aside>
    </Slide>

    <!-- Slide 3: Flow-based Generative Models -->
    <Slide figure={noiseFigure}>
      <h2 class="slide-title">Flow-based Generative Models</h2>
      <p style="margin-top: 0.5em;">
        Flows learn transformations of probability distributions and enable novel sample generation.
      </p>
      <div class="figure-container" style="margin-top: 30px;">
        <TransformingNoiseIntoData bind:this={noiseFigure} width={1720} height={780} />
      </div>
      <aside class="notes">
        <ul>
          <li>Flow based generative models are one of the most popular recent approaches to doing generative modeling.</li>
          <li>They learn to transform a simple distribution, like Gaussian noise, to arbitrarily complex distributions.</li>
          <li>Here I show a simple 2D Gaussian on the left connected to a funny smiley face distribution.</li>
          <li>Each of these points shown here don't need to represent 2D objects, but can represent high-dimensional data like images.</li>
        </ul>
      </aside>
    </Slide>

    <!-- Slide: Flows Underpin State of the Art Image Generation -->
    <section use:sotaImageReveal>
      <h2 class="slide-title">Flows Underpin State of the Art Image and Video Generation</h2>
      <div style="position: relative; width: 100%; height: 900px; overflow: hidden;">
        {#each sotaImages as img, i}
          {#if i < sotaRevealCount}
            <img
              src="{base}/image_generation_slide/{img.file}"
              alt=""
              style="position: absolute; left: {img.x}px; top: {img.y}px; width: {img.w}px; height: auto; border-radius: 10px; transform: rotate({img.rotation}deg); animation: sotaFadeIn 0.35s ease forwards;"
            />
          {/if}
        {/each}
      </div>
      <aside class="notes">
        <ul>
          <li>Flows underpin many of the state of the art generative models for both image and video generation.</li>
          <li>This is one of their most powerful applications.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Flow Models Apply to Many Modalities -->
    <section use:playVideoOnSlide>
      <h2 class="slide-title">Flow Models Apply to Many Modalities</h2>
      <div style="display: flex; align-items: flex-start; justify-content: center; gap: 6em; margin-top: 1.5em;">
        <div style="display: flex; flex-direction: column; align-items: center;">
          <p style="margin: 0 0 0.6em; font-size: 1.1em; font-weight: bold; color: #333;">Biology</p>
          <video
            src="{base}/protein_animation/ProteinVideo.mp4"
            loop
            muted
            playsinline
            autoplay
            style="height: 640px; border-radius: 12px;"
          ></video>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; margin-left: -120px;">
          <p style="margin: 0 0 0.6em; font-size: 1.1em; font-weight: bold; color: #333;">Language</p>
          <img
            src="{base}/flm/image.png"
            alt="Flow Language Model"
            style="height: 560px; border-radius: 12px;"
          />
        </div>
      </div>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          [1] Geffner, T., Didi, K., Zhang, Z., Reidenbach, D., Cao, Z., Yim, J., Geiger, M., Dallago, C., Kucukbenli, E., Vahdat, A. &amp; Kreis, K. (2025). <em>Proteina: Scaling Flow-based Protein Structure Generative Models</em>. arXiv:2503.00710.
        </p>
        <p style="font-size: 0.7em; color: #888; margin: 0.3em 0 0;">
          [2] Lee, C., Yoo, J., Agarwal, M., Shah, S., Huang, J., Raghunathan, A., Hong, S., Boffi, N. M. &amp; Kim, J. (2026). <em>Flow Map Language Models: One-step Language Modeling via Continuous Denoising</em>. arXiv:2602.16813.
        </p>
      </div>
      <aside class="notes">
        <ul>
          <li>In the past few years though there has been an explosion in interest in flows, and they have been applied to a variety of application settings like Biology for tasks like protein structure generation, and also even language generation.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide 4: Diffusion vs Flow (hidden for now) -->
    <!--
    <Slide figure={diffFlowFigure}>
      <DiffusionVsFlow bind:this={diffFlowFigure} width={1720} height={520} animationDuration={24000} />
    </Slide>
    -->

    <!-- Slide 5: Flow-based Generative Models (hidden for now) -->
    <!--
    <Slide figure={flowPathFigure}>
      <h2 class="slide-title">Flow-based Generative Models</h2>
      <div class="figure-container" style="margin-top: 120px;">
        <FlowProbabilityPath bind:this={flowPathFigure} width={1720} height={850} contourBandwidth={20} contourGridSize={50} contourThresholds={3} />
      </div>
    </Slide>
    -->

    <!-- Slide 6: Roadmap -->
    <section class="roadmap-slide">
      <h2 class="slide-title">What Will You Learn?</h2>
      <ol class="roadmap">
        <li class="roadmap-item">
          <p class="roadmap-question">What is a normalizing flow?</p>
          <p class="roadmap-ref">Normalizing Flows — Rezende & Mohamed, 2015</p>
        </li>
        <li class="roadmap-item">
          <p class="roadmap-question">How to make them continuous?</p>
          <p class="roadmap-ref">Continuous Normalizing Flows — Chen et al., 2018</p>
        </li>
        <li class="roadmap-item">
          <p class="roadmap-question">How to train them efficiently?</p>
          <p class="roadmap-ref">Flow Matching, Stochastic Interpolants — Lipman et al., 2023; Albergo & Vanden-Eijnden, 2023</p>
        </li>
        <li class="roadmap-item">
          <p class="roadmap-question">How can we make them low latency?</p>
          <p class="roadmap-ref">Rectified Flows — Liu et al., 2023</p>
        </li>
      </ol>
      <aside class="notes">
        <ul>
          <li>The talk is structured somewhat chronologically.</li>
          <li>I'm going to go through some of the seminal works in the space, starting with the paper that initially popularized the idea of a normalizing flow in 2015.</li>
          <li>Then we are going to talk about ways in which this method was generalized to more flexible, ways to make training more efficient, and practical concerns like the latency of sampling from the model.</li>
        </ul>
      </aside>
    </section>

    <!-- Roadmap: Normalizing Flows -->
    <section class="roadmap-slide">
      <h2 class="slide-title">What Will You Learn?</h2>
      <ol class="roadmap">
        <li class="roadmap-item roadmap-active">
          <p class="roadmap-question">What is a normalizing flow?</p>
          <p class="roadmap-ref">Normalizing Flows — Rezende & Mohamed, 2015</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">How to make them continuous?</p>
          <p class="roadmap-ref">Continuous Normalizing Flows — Chen et al., 2018</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">How to train them efficiently?</p>
          <p class="roadmap-ref">Flow Matching, Stochastic Interpolants — Lipman et al., 2023; Albergo & Vanden-Eijnden, 2023</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">How can we make them low latency?</p>
          <p class="roadmap-ref">Rectified Flows — Liu et al., 2023</p>
        </li>
      </ol>
      <aside class="notes">
        <ul>
          <li>So starting out we ask the question, what is a normalizing flow?</li>
        </ul>
      </aside>
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
        <NormalizingFlowStages bind:this={normFlowFigure} width={1720} numStages={4} showLabels={true} looping={false} animationDuration={5000} />
      </div>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          Rezende, D. &amp; Mohamed, S. (2015). Variational Inference with Normalizing Flows. <em>Proceedings of the 32nd International Conference on Machine Learning</em>, in <em>Proceedings of Machine Learning Research</em> 37:1530-1538.
        </p>
      </div>
      <aside class="notes">
        <ul>
          <li>A normalizing flow learns to transform a simple distribution to a more complex one.</li>
          <li>It does this by applying a sequence of mappings represented by these functions f.</li>
          <li>Here on the left we have a simple 2D Gaussian source distribution and it is transformed by our flow to a Gaussian mixture model.</li>
          <li>This general structure applies not just to our simple 2D setting but to much more complex high dimensional settings.</li>
        </ul>
      </aside>
    </Slide>

    <!-- Slide: Generating New Samples -->
    <Slide figure={genSamplesFigure}>
      <h2 class="slide-title">Generating New Samples</h2>
      <p style="margin-top: 0.3em;">
        Sample <Katex math={"z \\sim p(z)"} /> and push forward through <Katex math={"f_1, f_2, \\ldots, f_K"} /> to generate a new data sample <Katex math={"x"} />.
      </p>
      <div class="figure-container" style="margin-top: 80px; height: 580px; overflow: visible;">
        <MaxLikelihoodTraining bind:this={genSamplesFigure} width={1720} height={580} numStages={4} reversed={false} animateForward={true} showInverseLabel={false} showTheta={false} highlightPointIndices={[15]} highlightColor="#f17720" showImages={true} looping={true} endPause={1} />
      </div>
      <aside class="notes">
        <ul>
          <li>Once we learn a flow, we can generate new samples by drawing a sample from our simple source distribution, and then apply a sequence of these mappings.</li>
        </ul>
      </aside>
    </Slide>

    <!-- Slide: Normalizing Flows are Invertible (figure) -->
    <Slide figure={invertibilityFigure}>
      <h2 class="slide-title">Flows Preserve Probability Mass</h2>
      <p style="margin-top: 0.5em;">
        Invertibility ensures probability mass is not created or destroyed.
      </p>
      <div class="figure-container" style="margin-top: 1em;">
        {#if dataLoaded}
          <FlowInvertibilitySimple
            bind:this={invertibilityFigure}
            width={1800}
            height={850}
            {allTimeSamples}
            numLines={5}
            distributionScaleFactor={1.0}
          />
        {/if}
      </div>
      <div style="display:flex; justify-content:space-around; margin-top: 0.3em; font-size: 1.1em;">
        <Katex math={"\\int p(z)\\, dz = 1"} />
        <Katex math={"\\int p(x)\\, dx = 1"} />
      </div>
      <aside class="notes">
        <ul>
          <li>One of the defining properties of flows is that they conserve probability mass.</li>
          <li>Each of the functions in our flow is invertible, which ensures that no two points are mapped to the exact same location.</li>
          <li>This guarantees that if we start out with a normalized probability distribution on the left, that we still end up with one on the right.</li>
        </ul>
      </aside>
    </Slide>

    <!-- Slide: How Likely is My Data? -->
    <Slide figure={dataLikelihoodFigure}>
      <h2 class="slide-title">How Likely is My Data?</h2>
      <p style="margin-top: 0.5em;">
        It is easy to evaluate the likelihood for <span style="color:#4594e3;">a sample <Katex math={"z"} /> from a simple distribution <Katex math={"p(z)"} /></span>, but not for a <span style="color:#f17720;">complex distribution <Katex math={"p(x)"} /></span>.
      </p>
      <div class="figure-container" style="margin-top: 0.8em;">
        {#if dataLoaded}
          <DataLikelihood
            bind:this={dataLikelihoodFigure}
            width={1800}
            height={780}
            {allTimeSamples}
            distributionScaleFactor={1.0}
            looping={false}
          />
        {/if}
      </div>
      <aside class="notes">
        <ul>
          <li>A common question in machine learning is "how likely am I to observe a particular sample"?</li>
          <li>Answering a question like this is quite straightforward for a Gaussian distribution. We have a closed form equation that tells us this.</li>
          <li>But for more complex distributions like the smiley face example on the right, this is much less straightforward.</li>
          <li>We don't necessarily have direct access to a likelihood.</li>
        </ul>
      </aside>
    </Slide>

    <!-- Slide: Change of Variables Formula (click to toggle log form) -->
    <section use:covClickHandler style="cursor: pointer;">
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
          <ChangeOfVariablesFigure width={1800} height={800} {allTimeSamples} distributionScaleFactor={0.8} showLog={covShowLog} />
        {/if}
      </div>
      <aside class="notes">
        <ul>
          <li>Flows allow us to solve this problem of evaluating exact likelihoods.</li>
          <li>They do this by allowing us to represent the likelihood of observing our data in our complex distribution, in terms of the likelihood in our source distribution which is easy to compute.</li>
          <li>This change of variable formula tells us how to do this.</li>
          <li>Often, we will represent this equation in log form which is quite common in optimization and machine learning.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Composing Multiple Transformations -->
    <Slide figure={composeFigure}>
      <h2 class="slide-title">Composing Multiple Transformations</h2>
      <div style="margin-top: 1.5em; margin-bottom: 0.8em;">
        <AnnotatedEquation
          scale={1.3}
          verticalGap={60}
          rowSpacing={40}
          labelFontSize={36}
          tex={"\\log p(x) = \\log p(z_0) - \\sum_{i=0}^{K-1} \\log \\left| {\\color{#2ecc71} \\det \\frac{\\partial f_i}{\\partial z_i}} \\right|"}
          annotations={[
            { color: '#2ecc71', label: 'Sum of Log Volume Changes', side: 'above', align: 'left' },
          ]}
        />
      </div>
      <div class="figure-container" style="margin-top: 10px; height: 520px; overflow: hidden;">
        <NormalizingFlowStages bind:this={composeFigure} width={1720} numStages={4} showLabels={true} showTopLabels={false} static={true} />
      </div>
      <aside class="notes">
        <ul>
          <li>We can chain together multiple of these transformations, and accumulate information over them to get this extended change of variables formula for the likelihood.</li>
        </ul>
      </aside>
    </Slide>

    <!-- Slide: Jacobian Measures Local Volume Change -->
    <Slide figure={gridJacobianFigure}>
      <h2 class="slide-title">Jacobian Measures Local Volume Change</h2>
      <p style="margin-top: 0.5em;">
        Jacobian <Katex math={"\\color{#2ecc71}{\\frac{\\partial f}{\\partial z}}"} /> describes how <Katex math={"f"} /> locally stretches and compresses space
      </p>
      <div style="margin-top: 0.8em;">
        <Katex math={"\\log p(x) = \\log p(z_0) - \\sum_{i=0}^{K-1} \\log \\left| {\\color{#2ecc71} \\det \\frac{\\partial f_i}{\\partial z_i}} \\right|"} displayMode={true} />
      </div>
      <div class="figure-container" style="margin-top: 0.5em;">
        {#if dataLoaded}
          <CNFGridJacobian
            bind:this={gridJacobianFigure}
            {flowMatchingClient}
            cachedGridTrajectories={flowMatchingGridTrajectories}
            cachedDenseTrajectories={flowMatchingDenseTrajectories}
            {allTimeSamples}
            sourceDistributionSamples={$sourceDistributionSamples}
            targetDistributionSamples={$targetDistributionSamples}
            showDetLabel={false}
          />
        {/if}
      </div>
      <aside class="notes">
        <ul>
          <li>This Jacobian term in the equation tells us how much our flow is stretching and compressing space locally.</li>
          <li>We need to correct for how our transformation changes volume, which is exactly what the determinant of this Jacobian tells us.</li>
        </ul>
      </aside>
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
        <MaxLikelihoodTraining bind:this={encodeFigure} width={1720} height={580} numStages={4} reversed={true} highlightPointIndices={[15]} highlightColor="#3b82f6" showImages={true} looping={true} endPause={1} />
      </div>
      <aside class="notes">
        <ul>
          <li>So, we can use this formula to compute the likelihood of observing data like images.</li>
          <li>We go in the reverse direction of our flow, starting out with data we have and mapping it through these inverses until we arrive at our source distribution.</li>
        </ul>
      </aside>
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
        <MaxLikelihoodTraining bind:this={mlFigure} width={1720} height={520} numStages={4} reversed={true} showTopLabels={false} showImages={true} looping={true} endPause={1} />
      </div>
      <aside class="notes">
        <ul>
          <li>This lends itself to a very natural training approach.</li>
          <li>Given a set of data we aim to find a set of parameters theta for our flow that maximize the likelihood of observing our dataset, represented by the blue points here.</li>
          <li>Here this log probability here corresponds to this change of variable formula we mentioned.</li>
          <li>Once, we can evaluate likelihoods, training becomes simply finding parameters that maximize the likelihood.</li>
        </ul>
      </aside>
    </Slide>

    <!-- Slide: Why Do We Care About Likelihoods? -->
    <section>
      <h2 class="slide-title">Why Do We Care About Likelihoods?</h2>
      <ol style="font-size: 1.05em; line-height: 1.8; padding-left: 1.2em; margin-top: 0.5em;">
        <li style="margin-bottom: 0.3em;"><strong>Training</strong> — maximize <Katex math={"\\log p(x)"} /> over data</li>
        <li style="margin-bottom: 0.3em;"><strong>Model evaluation</strong> — compare density estimates</li>
        <li><strong>Anomaly detection</strong> — flag low-likelihood inputs</li>
      </ol>
      <div class="figure-container" style="margin-top: 0.5em; height: 520px; overflow: visible;">
        <MaxLikelihoodTraining width={1720} height={520} numStages={4} reversed={true} showTopLabels={false} highlightPointIndices={[15]} highlightColor="#3b82f6" showImages={true} looping={true} endPause={1} />
      </div>
      <aside class="notes">
        <ul>
          <li>To summarize, why do we care about likelihoods.</li>
          <li>They allow for a natural training objective.</li>
          <li>They allow you to compare the density of two observations.</li>
          <li>They allow other tasks like anomaly detection, where we can identify if a sample is potentially out of distribution.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Normalizing Flow Recap -->
    <section>
      <h2 class="slide-title">Normalizing Flow Recap</h2>
      <ol style="font-size: 1.05em; line-height: 1.8; padding-left: 1.2em; margin-top: 0.5em;">
        <li style="margin-bottom: 0.3em;">Transform simple source distribution to complex target</li>
        <li style="margin-bottom: 0.3em;">Exact likelihood evaluation</li>
        <li>Novel sample generation</li>
      </ol>
      <div class="figure-container" style="margin-top: 80px; height: 580px; overflow: visible;">
        <MaxLikelihoodTraining width={1720} height={580} numStages={4} reversed={false} animateForward={true} showInverseLabel={false} showTheta={false} highlightPointIndices={[15]} highlightColor="#f17720" showImages={true} looping={true} endPause={1} />
      </div>
      <aside class="notes">
        <ul>
          <li>To summarize this entire first section,</li>
          <li>Normalizing flows transform simple distributions into more complex ones.</li>
          <li>They allow you to evaluate exact likelihoods.</li>
          <li>And they allow you to generate novel samples.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Computational Efficiency is Important -->
    <section use:ceImageReveal>
      <h2 class="slide-title">GPUs are Expensive</h2>
      <div style="position: relative; width: 100%; height: 900px; overflow: visible;">
        {#each computeExpensiveImages as img, i}
          {#if i < ceRevealCount}
            <img
              src="{base}/compute_expensive/{img.file}"
              alt=""
              style="position: absolute; left: {img.x}px; top: {img.y}px; width: {img.w}px; height: auto; border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); transform: rotate({img.rotation}deg); animation: sotaFadeIn 0.35s ease forwards;"
            />
          {/if}
        {/each}
      </div>
      <aside class="notes">
        <ul>
          <li>But there is a problem.</li>
          <li>Something that many people in this room probably know too well, which is that GPUs are expensive.</li>
        </ul>
      </aside>
    </section>

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
          tex={"\\log p(x) = \\log p(z_0) - \\sum_{i=1}^{K} \\log \\left| {\\color{#e74c3c} \\det \\dfrac{\\partial f_i}{\\partial z_{i-1}}} \\right|"}
          annotations={[
            { color: '#e74c3c', label: 'O(d³) in general', side: 'below', align: 'left' },
          ]}
        />
      </div>
      <p style="margin-top: 2em;">
        Many works restrict <Katex math={"f_i"} /> for cheaper determinants.
      </p>
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          <strong>Examples:</strong> Planar flows <span style="font-style: italic;">(Rezende &amp; Mohamed, 2015)</span>,
          Real NVP <span style="font-style: italic;">(Dinh et al., 2017)</span>,
          Glow <span style="font-style: italic;">(Kingma &amp; Dhariwal, 2018)</span>
        </p>
      </div>
      <aside class="notes">
        <ul>
          <li>These determinants used when computing likelihoods for flows are expensive.</li>
          <li>They scale cubically with the dimensionality of data.</li>
          <li>A whole body of work has gone into restricting the architecture of flows so these determinants are cheaper, but this comes at the cost of model flexibility.</li>
        </ul>
      </aside>
    </section>

    <!-- Roadmap: Continuous Normalizing Flows -->
    <section class="roadmap-slide">
      <h2 class="slide-title">What Will You Learn?</h2>
      <ol class="roadmap">
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">What is a normalizing flow?</p>
          <p class="roadmap-ref">Normalizing Flows — Rezende & Mohamed, 2015</p>
        </li>
        <li class="roadmap-item roadmap-active">
          <p class="roadmap-question">How to make them continuous?</p>
          <p class="roadmap-ref">Continuous Normalizing Flows — Chen et al., 2018</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">How to train them efficiently?</p>
          <p class="roadmap-ref">Flow Matching, Stochastic Interpolants — Lipman et al., 2023; Albergo & Vanden-Eijnden, 2023</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">How can we make them low latency?</p>
          <p class="roadmap-ref">Rectified Flows — Liu et al., 2023</p>
        </li>
      </ol>
      <aside class="notes">
        <ul>
          <li>This leads us into our next topic, which is continuous normalizing flows.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Continuous Normalizing Flows (CNF) -->
    <section>
      <h2 class="slide-title">Continuous Normalizing Flows (CNF)</h2>
      <p style="margin-top: 0.3em;">
        CNFs replace discrete transformations with continuous
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
      <aside class="notes">
        <ul>
          <li>Continuous normalizing flows are a generalization of normalizing flows that replaces this finite sequence of transformations with a continuous transformation.</li>
          <li>Here our flow transforms our source distribution at time zero into our target distribution through a set of continuous transformations until matches the target distribution at time 1.</li>
        </ul>
      </aside>
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
      <aside class="notes">
        <ul>
          <li>At the individual sample level, our aim is to infer a trajectory x(t) shown in orange.</li>
          <li>We want to identify a trajectory that moves a sample from the source distribution to our target over time.</li>
        </ul>
      </aside>
    </Slide>

    <!-- Slide: CNFs Learn to Represent Velocity Fields -->
    <section>
      <h2 class="slide-title">CNFs Learn to Represent Velocity Fields</h2>
      <div style="display: flex; align-items: center; gap: 2em; margin-top: 1em;">
        <div style="flex: 1;">
          <p style="margin-top: 0;">
            CNFs model a <span style="color: #3b82f6; font-weight: bold;">velocity field</span> <Katex math={"\\color{#3b82f6}{v_\\theta}"} />.
          </p>
          <p style="margin-top: 0.5em;">
            Generate sample <span style="color: #f17720; font-weight: bold;">trajectories</span> by solving an ODE:
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
      <aside class="notes">
        <ul>
          <li>Instead of directly learning these trajectories x(t), a flow instead indirectly represents a velocity field.</li>
          <li>On the right, shown in blue we have a velocity field that tells us if we have a sample at a location at a particular time, what direction should we move that sample.</li>
          <li>The problem of inferring a trajectory becomes one of solving an ordinary differential equation.</li>
          <li>We can simulate our flow by doing numerical integration.</li>
          <li>The simplest approach is to do Euler's method. We can make small movements in the direction that our velocity field points.</li>
          <li>This gives us trajectories like the orange on on the right.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: CNFs Allow More Efficient Likelihood Based Training -->
    <section use:efficientTrainingClickHandler>
      <h2 class="slide-title">CNFs Allow More Efficient Training</h2>
      <div style="position: relative; margin-top: 1.5em;">
        <div style="opacity: {efficientTrainingPhase >= 1 ? 0.3 : 1}; transition: opacity 0.5s;">
          <p style="font-size: 1.25em; color: #888; margin-bottom: 1em; text-align: center;">Change of Variables (Normalizing Flows)</p>
          <AnnotatedEquation
            scale={1.2}
            verticalGap={50}
            labelFontSize={36}
            tex={"\\log p_1(x_1) = \\log p_0(x_0) - {\\color{#e74c3c} \\log \\left| \\det \\dfrac{\\partial f}{\\partial z} \\right|}"}
            annotations={[
              { color: '#e74c3c', label: 'This is slow — O(d³)', side: 'above', align: 'left' },
            ]}
          />
        </div>
        {#if efficientTrainingPhase >= 1}
          <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 8em; color: #e74c3c; opacity: 0.7; font-weight: bold; pointer-events: none;">✗</div>
        {/if}
      </div>
      {#if efficientTrainingPhase >= 1}
        <div style="margin-top: 2.5em;">
          <p style="font-size: 1.25em; color: #22c55e; margin-bottom: 1em; font-weight: bold; text-align: center;">Continuous Normalizing Flows</p>
          <AnnotatedEquation
            scale={1.2}
            verticalGap={50}
            labelFontSize={36}
            tex={"\\log p_1(x_1) = \\log p_0(x_0) - \\int_0^1 {\\color{#22c55e} \\operatorname{tr}\\!\\left(\\dfrac{\\partial v_\\theta}{\\partial x}\\right)} \\, dt"}
            annotations={[
              { color: '#22c55e', label: 'This is much faster — O(d)', side: 'above', align: 'left' },
            ]}
          />
        </div>
      {/if}
      <aside class="notes">
        <ul>
          <li>Continuous normalizing flows fix one of the key computational bottlenecks when training flows with maximum likelihood.</li>
          <li>This expensive determinant which in general takes O(d^3) instead becomes an O(d) trace computation, which is much more favorable.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Likelihood Based Training is Expensive -->
    <section>
      <h2 class="slide-title">Simulating ODEs is Still Expensive</h2>
      <p style="margin-top: 0.5em;">
        Requires solving an ODE at <em style="color: #e74c3c;">every training step</em>.
      </p>
      <div style="margin-top: 1.5em;">
        <AnnotatedEquation
          scale={1.3}
          verticalGap={60}
          labelFontSize={44}
          tex={"\\log p_1(x_1) = \\log p_0(x_0) - {\\color{#e74c3c} \\int_0^1 \\operatorname{tr}\\!\\left(\\frac{\\partial v_t}{\\partial x}\\right) \\, dt}"}
          annotations={[
            { color: '#e74c3c', label: 'Requires O(n) ODE solves', side: 'below', align: 'left' },
          ]}
        />
      </div>
      <div class="figure-container" style="margin-top: 0.3em; max-height: 450px; overflow: hidden;">
        {#if dataLoaded}
          <HighlightTrajectory
            width={1800}
            height={450}
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
        <ul>
          <li>However, the bottleneck has now moved.</li>
          <li>Simulating flows requires doing numerical integration, or simulation.</li>
          <li>This can be expensive, particularly if our trajectories are highly curved.</li>
          <li>With maximum likelihood training, we need to do this simulation during every training step.</li>
        </ul>
      </aside>
    </section>

    <!-- Roadmap: Flow Matching -->
    <section class="roadmap-slide">
      <h2 class="slide-title">What Will You Learn?</h2>
      <ol class="roadmap">
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">What is a normalizing flow?</p>
          <p class="roadmap-ref">Normalizing Flows — Rezende & Mohamed, 2015</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">How to make them continuous?</p>
          <p class="roadmap-ref">Continuous Normalizing Flows — Chen et al., 2018</p>
        </li>
        <li class="roadmap-item roadmap-active">
          <p class="roadmap-question">How to train them efficiently?</p>
          <p class="roadmap-ref">Flow Matching, Stochastic Interpolants — Lipman et al., 2023; Albergo & Vanden-Eijnden, 2023</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">How can we make them low latency?</p>
          <p class="roadmap-ref">Rectified Flows — Liu et al., 2023</p>
        </li>
      </ol>
      <aside class="notes">
        <ul>
          <li>This leads us into some of the more modern literature, namely flow matching and stochastic interpolants.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Flow Matching Enables Faster Training -->
    <section use:fmTrainingClickHandler>
      <h2 class="slide-title">Flow Matching Enables Faster Training</h2>
      <p style="margin-top: 0.5em;">
        Flow matching enables <strong>simulation-free training</strong> — no expensive ODE solvers at each step.
      </p>
      <div style="position: relative; margin-top: 1em;">
        <div style="opacity: {fmTrainingPhase >= 1 ? 0.3 : 1}; transition: opacity 0.5s;">
          <p style="font-size: 1.25em; color: #e74c3c; margin-bottom: 0.5em; text-align: center;">Maximum Likelihood</p>
          <AnnotatedEquation
            scale={1.5}
            verticalGap={50}
            labelFontSize={44}
            tex={"\\mathcal{L}_{ML}(\\theta) = \\log p_0(x_0) - {\\color{#e74c3c} \\int_0^1 \\operatorname{tr}\\!\\left(\\frac{\\partial v_\\theta}{\\partial x}\\right) dt}"}
            annotations={[
              { color: '#e74c3c', label: 'Expensive simulation', side: 'below', align: 'left' },
            ]}
          />
        </div>
        {#if fmTrainingPhase >= 1}
          <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 8em; color: #e74c3c; opacity: 0.7; font-weight: bold; pointer-events: none;">✗</div>
        {/if}
      </div>
      {#if fmTrainingPhase >= 1}
        <div style="margin-top: 0.8em;">
          <p style="font-size: 1.25em; color: #22c55e; margin-bottom: 0.5em; text-align: center; font-weight: bold;">Flow Matching</p>
          <AnnotatedEquation
            scale={1.5}
            verticalGap={50}
            labelFontSize={44}
            tex={"\\mathcal{L}_{FM}(\\theta) = \\mathbb{E}_{t, x_0, x_1} \\left\\| v_t^\\theta(x_t) - v_t(x_t|x_1) \\right\\|^2"}
            annotations={[
              { color: '#22c55e', label: 'Simulation free', side: 'below', align: 'left' },
            ]}
          />
        </div>
      {/if}
      <div style="position: absolute; bottom: 1em; left: 0; right: 0; border-top: 1px solid #ddd; padding-top: 0.8em; padding-left: 1em; padding-right: 1em;">
        <p style="font-size: 0.7em; color: #888; margin: 0;">
          Lipman et al., <span style="font-style: italic;">Flow Matching for Generative Modeling</span>, 2023
        </p>
      </div>
      <aside class="notes">
        <ul>
          <li>Flow matching takes this expensive maximum likelihood training objective, and replaces it with a much simpler regression objective.</li>
          <li>This objective does not require doing simulation during each training step.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Flow Matching Directly Learns Velocity -->
    <section>
      <h2 class="slide-title">Flow Matching Directly Learns Velocity</h2>
      <p style="margin-top: 0.5em;">
        Directly learns <span style="color: #3b82f6; font-weight: bold;">velocity</span> <Katex math={"\\color{#3b82f6}{v_\\theta}"} /> instead of maximizing likelihood.
      </p>
      <div class="figure-container" style="margin-top: 1em;">
        {#if dataLoaded}
          <HighlightTrajectory
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
            scatterPlotColor={'#999'}
            showVelocityArrow={true}
            velocityArrowScale={100}
            velocityArrowColor={'#3b82f6'}
            velocityArrowWidth={5}
            velocityArrowHeadSize={12}
          />
        {/if}
      </div>
      <aside class="notes">
        <ul>
          <li>Instead of doing maximum likelihood, flow matching aims to directly learn the velocity of our trajectories shown in blue here.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: The Probability Path (hidden) -->
    <!--
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
    -->

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
      <aside class="notes">
        <ul>
          <li>A design decision we when doing flow matching is how we define the ideal trajectories that we want to learn.</li>
          <li>This decision is informed by something called the probability path.</li>
          <li>The simplest, and most common choice is to draw straight lines between pairs of points in source and target distributions respectively.</li>
          <li>These correspond to the ideal trajectories that we want to learn.</li>
        </ul>
      </aside>
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
            arrowHeadSize={14}
            animationDuration={8000}
          />
        {/if}
      </div>
      <aside class="notes">
        <ul>
          <li>We can then create something called our conditional velocity field, which tells us what velocities we should have along these paths that samples move.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Regressing the Velocity Field -->
    <section>
      <h2 class="slide-title">Regressing the Velocity Field</h2>
      <p style="margin-top: 0.5em;">
        Given a point <Katex math={"x_t"} /> we want to predict the velocity <Katex math={"\\color{#22c55e}{v_t^\\theta(x_t)}"} /> that matches the target conditional velocity <Katex math={"\\color{#f17720}{v_t(x_t | x_1)}"} />.
      </p>
      <div style="margin-top: 0.3em;">
        <AnnotatedEquation
          scale={1.2}
          verticalGap={50}
          labelFontSize={36}
          tex={"\\mathcal{L}_{FM}(\\theta) = \\mathbb{E}_{t, x_0, x_1} \\left\\| {\\color{#22c55e} v_t^\\theta(x_t)} - {\\color{#f17720} v_t(x_t|x_1)} \\right\\|^2"}
          annotations={[
            { color: '#22c55e', label: 'Our Model', side: 'above', align: 'left' },
            { color: '#f17720', label: 'Target Velocity', side: 'above', align: 'right' },
          ]}
        />
      </div>
      <div class="figure-container" style="margin-top: 1.2em; max-height: 550px; overflow: hidden;">
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
            arrowHeadSize={12}
          />
        {/if}
      </div>
      <aside class="notes">
        <ul>
          <li>Our goal in flow matching is then to learn a velocity field shown in green, which we represent with a neural network, to match these target conditional velocities shown in orange.</li>
          <li>That is exactly what we aim to minimize with this equation.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Flow Matching Successfully Learns a Flow -->
    <section>
      <h2 class="slide-title">Flow Matching Successfully Learns a Flow</h2>
      <p style="margin-top: 0.5em;">
        This objective preserves exact likelihood evaluation, enables generation, and learns a transformation of the distribution.
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
      <aside class="notes">
        <ul>
          <li>Despite being structurally very different from the maximum likelihood training approach we mentioned earlier, this approach still learns a valid flow.</li>
          <li>And it does this without requiring expensive numerical integration at each point in time.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Stochastic Interpolants -->
    <section use:stochIntClickHandler>
      <div style="position: relative; width: 1920px; height: 1200px; margin: -40px auto 0;">
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
        {#if stochIntPhase >= 1}
          <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.95); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 100;">
            <h2 style="font-size: 2em; margin-bottom: 1em;">Same Training Objective</h2>
            <AnnotatedEquation
              scale={1.4}
              verticalGap={50}
              labelFontSize={36}
              tex={"\\mathcal{L}_{FM}(\\theta) = \\mathbb{E}_{t, x_0, x_1} \\left\\| {\\color{#22c55e} v_t^\\theta(x_t)} - {\\color{#f17720} v_t(x_t|x_1)} \\right\\|^2"}
              annotations={[
                { color: '#22c55e', label: 'Our Model', side: 'above', align: 'left' },
                { color: '#f17720', label: 'Target Velocity', side: 'above', align: 'right' },
              ]}
            />
          </div>
        {/if}
      </div>
      <aside class="notes">
        <ul>
          <li>Something quite interesting that is worth mentioning.</li>
          <li>A different group proposed a framework called Stochastic interpolants at around the same time that flow matching was introduced.</li>
          <li>They aimed to create a unifying framework for flows and diffusion that also incorporated stochasticity.</li>
          <li>However, they arrived at the same training objective.</li>
        </ul>
      </aside>
    </section>

    <!-- Slide: Developed Independently in Parallel -->
    <section style="position: relative; overflow: visible;">
      <h2 class="slide-title">Two Frameworks, One Idea</h2>
      <p style="margin-top: 0.5em;">
        Flow Matching and Stochastic Interpolants were developed independently and in parallel, arriving at the same core insight.
      </p>

      <!-- Flow Matching paper — left card, angled left -->
      <img
        src="{base}/images/flow_matching_paper.png"
        alt="Flow Matching paper"
        style="
          position: absolute;
          bottom: -380px;
          right: 380px;
          height: 980px;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.25);
          transform: rotate(-4deg);
          transform-origin: bottom center;
          z-index: 2;
        "
      />

      <!-- Stochastic Interpolants paper — right card, angled right -->
      <img
        src="{base}/images/stochastic_interpolants_paper.png"
        alt="Stochastic Interpolants paper"
        style="
          position: absolute;
          bottom: -200px;
          right: 680px;
          height: 980px;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.25);
          transform: rotate(-11deg);
          transform-origin: bottom center;
          z-index: 1;
        "
      />
      <aside class="notes">
        <ul>
          <li>I think they may have even presented this work at the same conference.</li>
          <li>This shows that sometimes certain ideas are almost meant to happen at a certain time.</li>
        </ul>
      </aside>
    </section>

    <!-- Roadmap: Rectified Flows -->
    <section class="roadmap-slide">
      <h2 class="slide-title">What Will You Learn?</h2>
      <ol class="roadmap">
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">What is a normalizing flow?</p>
          <p class="roadmap-ref">Normalizing Flows — Rezende & Mohamed, 2015</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">How to make them continuous?</p>
          <p class="roadmap-ref">Continuous Normalizing Flows — Chen et al., 2018</p>
        </li>
        <li class="roadmap-item roadmap-inactive">
          <p class="roadmap-question">How to train them efficiently?</p>
          <p class="roadmap-ref">Flow Matching, Stochastic Interpolants — Lipman et al., 2023; Albergo & Vanden-Eijnden, 2023</p>
        </li>
        <li class="roadmap-item roadmap-active">
          <p class="roadmap-question">How can we make them low latency?</p>
          <p class="roadmap-ref">Rectified Flows — Liu et al., 2023</p>
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
          perStepDuration={200}
          perStepDelay={125}
          fullAnimationDelay={250}
          repeatDelay={750}
        />
      </div>
    </section>

    <!-- Slide: Low Latency Is Important -->
    <section>
      <h2 class="slide-title">Low Latency Is Important</h2>
      <div style="display: flex; justify-content: center; align-items: center; gap: 4em; margin-top: 2em;">
        <div style="text-align: center;">
          <img
            src="{base}/latency_slide/fast.gif"
            alt="1-second generation"
            style="height: 600px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);"
          />
          <p style="margin-top: 0.8em; font-size: 1.2em; font-weight: bold; color: #22c55e;">~3 seconds</p>
        </div>
        <div style="text-align: center;">
          <img
            src="{base}/latency_slide/slow.gif"
            alt="60-second generation"
            style="height: 600px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);"
          />
          <p style="margin-top: 0.8em; font-size: 1.2em; font-weight: bold; color: #e74c3c;">~30 seconds</p>
        </div>
      </div>
    </section>

    <!-- Slide: What Causes this Curvature? -->
    <section>
      <h2 class="slide-title">What Causes Curved Paths?</h2>
      <p style="margin-top: 0.5em;">
        We train the velocity field <Katex math={"v_\\theta"} /> to match straight paths — why does this produce curvature?
      </p>
      <div class="figure-container" style="margin-top: 1em; max-height: 650px; overflow: hidden;">
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
            x0Pixel={{ x: 350, y: 250 }}
            x1Pixel={{ x: 1450, y: 350 }}
            vectorScale={350}
            vectorWidth={4}
            lineWidth={4}
            dashedLineWidth={3}
            latexFontSize={36}
            distributionLabelOffsetY={40}
            vtLabelOffsetY={65}
            arrowHeadSize={12}
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
        The simplest choice of coupling is the <em>independent coupling</em>, where <Katex math={"\\pi({\\color{#3b82f6}{X_0}})"} /> and <Katex math={"\\pi({\\color{#f17720}{X_1}})"} /> are independent of each other.
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
            sourceLabel={"\\pi({\\color{#3b82f6}{X_0}})"}
            targetLabel={"\\pi({\\color{#f17720}{X_1}})"}
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
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section onclick={(e) => { if (intersectingPathsFigure?.advance()) e.stopPropagation(); }}>
      <h2 class="slide-title">Our Paths Crossed at the Wrong Time</h2>
      <p style="margin-top: 0.5em;">
        The velocity field <Katex math={"\\color{#22c55e}{v_t^\\theta}"} /> cannot accurately resolve conflicting paths — the best it can do is average. This averaging leads to curved trajectories.
      </p>
      <div class="figure-container" style="margin-top: 2.5em;">
        {#if dataLoaded}
          <IntersectingPaths
            bind:this={intersectingPathsFigure}
            onNextSlide={() => revealInstance?.next()}
            width={1800}
            height={800}
            sourceCenterX={0.2}
            targetCenterX={0.8}
            arrowHeadSize={10}
            latexFontSize={40}
            labelFontSize={50}
            labelFontFamily="Libre Baskerville, Georgia, serif"
            meanArrowLabelOffset={{ x: 220, y: -18 }}
            topArrowLabelOffset={{ x: -55, y: 25 }}
            bottomArrowLabelOffset={{ x: -55, y: -15 }}
            sourceDistributionSamples={intersectingPathsSource}
            targetDistributionSamples={$targetDistributionSamples}
            backgroundVisible={false}
            {flowMatchingClient}
            showCouplingAnimation={true}
            trajectoryStartTime={0.3}
            trajectoryLineWidth={6}
            trajectoryColor={'#22c55e'}
          />
        {/if}
      </div>
      <aside class="notes">
        Intersecting paths create conflicts for the velocity field, which must average, producing curved trajectories.
      </aside>
    </section>

    <!-- Slide: Ambiguities Lead to Curved Trajectories -->
    <section>
      <h2 class="slide-title">Ambiguities Lead to Curved Trajectories</h2>
      <p style="margin-top: 0.5em;">
        The trajectories curve, but importantly, <strong>do not intersect</strong>.
      </p>
      <div class="figure-container" style="margin-top: 1em;">
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

    <!-- Slide: Rectified Flows -->
    <Slide figure={rectifiedFlowFigure}>
      <h2 class="slide-title">Rectified Flows</h2>
      <p style="margin-top: 0.5em;">Reflow recursively trains flow matching models and uses them to produce a better coupling.</p>
      <div class="figure-container" style="margin-top: 1em;">
        {#if dataLoaded}
          <InducedCouplingAnimated
            bind:this={rectifiedFlowFigure}
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
    </Slide>

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
    <Slide figure={reflowFigure}>
      <h2 class="slide-title">Reflow Produces Straighter Trajectories</h2>
      <div class="figure-container" style="margin-top: 2.5em;">
        {#if dataLoaded}
          <CrownJewel
            bind:this={reflowFigure}
            canvasWidth={750}
            canvasHeight={650}
            gap={40}
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
            labelFontSize={54}
            subtitleFontSize={42}
            trajectoryStrokeWidth={4}
            interactive={false}
            showPlayButton={false}
            durationLabelFontSize={32}
            durationLabelSpacing={10}
          />
        {/if}
      </div>
    </Slide>

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

    <!-- Slide: Check Out Diffusion Explorer -->
    <section use:playVideoOnSlide>
      <h2 class="slide-title">Check Out Diffusion Explorer</h2>
      <div style="display: flex; align-items: center; justify-content: center; gap: 3em; margin-top: 1.5em;">
        <video
          src="{base}/GitHubRecording.mp4"
          loop
          muted
          playsinline
          style="height: 680px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);"
        ></video>
        <img
          src="{base}/GitHubQRCode.png"
          alt="GitHub QR Code"
          style="width: 320px; height: 320px; border-radius: 8px;"
        />
      </div>
      <div style="position: absolute; bottom: 1.2em; left: 0; right: 0; text-align: center;">
        <a
          href="https://github.com/helblazer811/Diffusion-Explorer"
          style="font-size: 0.9em; color: #555; text-decoration: none;"
        >
          https://github.com/helblazer811/Diffusion-Explorer
        </a>
      </div>
    </section>

    <!-- Slide: Thank You / Conclusion -->
    <section>
      <h2 class="slide-title">Thank You</h2>
      <p style="margin-top: 0.6em; font-size: 1.0em; line-height: 1.6; width: 100%;">
        Normalizing flows learn invertible transformations of probability distributions, enabling exact likelihood evaluation and novel sample generation. Continuous normalizing flows, flow matching, and rectified flows extend normalizing flows making them more scalable, efficient, and general.
      </p>
      <div class="figure-container" style="margin-top: 0.3em;">
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
            showTimeSlider={false}
            labelFontSize={50}
            labelFontFamily="Libre Baskerville, Georgia, serif"
            latexFontSize={43}
          />
        {/if}
      </div>
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

  :global(.roadmap) {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1em;
    flex: 1;
    padding-left: 2em;
  }

  :global(.roadmap-item) {
    list-style-type: decimal;
    transition: opacity 0.3s;
  }

  :global(.roadmap-active) {
    opacity: 1;
  }

  :global(.roadmap-active) :global(.roadmap-question) {
    color: #f17720;
    font-weight: bold;
  }

  :global(.roadmap-active)::marker {
    color: #f17720;
  }

  :global(.roadmap-active) :global(.roadmap-ref) {
    color: #f17720 !important;
    opacity: 1 !important;
  }

  :global(.roadmap-inactive) {
    opacity: 0.12;
  }

  :global(.roadmap-inactive) :global(.roadmap-ref) {
    opacity: 1 !important;
    color: inherit !important;
  }

  :global(.bib-entry) {
    margin: 0 0 0.6em 0;
    text-indent: -1.5em;
    padding-left: 1.5em;
    break-inside: avoid;
  }

  :global(.roadmap-question) {
    font-size: 1.2em;
    margin: 0;
  }

  :global(.roadmap-ref) {
    font-size: 1.2em !important;
    font-family: Georgia, serif !important;
    font-weight: 100 !important;
    opacity: 0.6 !important;
    color: inherit !important;
    font-style: italic !important;
    margin: 0.2em 0 0 0 !important;
  }

  :global(.roadmap-desc) {
    font-size: 1.06em;
    color: #888;
    margin: 0.15em 0 0 0;
  }
  @keyframes sotaFadeIn {
    from { opacity: 0; transform: rotate(var(--rot, 0deg)) scale(0.7); }
    to { opacity: 1; transform: rotate(var(--rot, 0deg)) scale(1); }
  }
</style>
