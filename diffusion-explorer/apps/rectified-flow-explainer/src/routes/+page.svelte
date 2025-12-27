<script lang="ts">
  import { onMount, tick } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import {
    downloadJSON,
    clipSamplesToRadius,
    clipAllRectifiedTrajectoriesToStartingRadius,
  } from "$lib/utils";
  import {
    settings,
    type VectorFieldData,
    type RectifiedFlowData,
  } from "$lib/settings";
  import * as trainAndSample from "$lib/train_and_sample";
  import {
    loadBibliography,
    collectCitations,
    type BibEntry,
    type CitationInfo,
  } from "$lib/citations";

  import IndependentCoupling from "$lib/figures/IndependentCoupling.svelte";
  import ProbabilityPath from "$lib/figures/ProbabilityPath.svelte";
  import HighlightTrajectory from "$lib/figures/HighlightTrajectory.svelte";
  import CurvedTrajectoryIntro from "$lib/figures/CurvedTrajectoryIntro.svelte";
  import EulerSamplerFigure from "$lib/figures/EulerSamplerFigure.svelte";
  import EulerCircularDemo from "$lib/figures/EulerCircularDemo.svelte";
  import RectifiedFlowVisualization from "$lib/figures/RectifiedFlowVisualization.svelte";
  import RectifiedFlowSuperimposed from "$lib/figures/RectifiedFlowSuperimposed.svelte";
  import LinearInterpolation from "$lib/figures/LinearInterpolation.svelte";
  import IntersectingPaths from "$lib/figures/IntersectingPaths.svelte";
  import InducedCouplingDouble from "$lib/figures/InducedCouplingDouble.svelte";
  import VectorFieldCurvatureComparison from "$lib/figures/VectorFieldCurvatureComparison.svelte";
  import ConditionalVelocityField from "$lib/figures/ConditionalVelocityField.svelte";
  import ConditionalFlowMatching from "$lib/figures/ConditionalFlowMatching.svelte";
  import CurvedTrajectorySuperimposed from "$lib/figures/CurvedTrajectorySuperimposed.svelte";
  import Figure from "$lib/components/Figure.svelte";
  import Algorithm from "$lib/components/Algorithm.svelte";
  import TableOfContents from "$lib/components/TableOfContents.svelte";
  import Bibliography from "$lib/components/Bibliography.svelte";
  import { Katex } from "@diffusion-explorer/ui";

  // ========== DATA MANAGEMENT STATE ==========

  // Data stores (shared by both components)
  const sourceDistributionSamples: Writable<number[][]> = writable([]);
  const targetDistributionSamples: Writable<number[][]> = writable([]);
  const allTimeSamples: Writable<number[][][]> = writable([]);
  const isTraining: Writable<boolean> = writable(false);

  // Vector field data stores
  const vectorFieldData: Writable<VectorFieldData | null> = writable(null);
  const rectifiedFlowVectorFieldData: Writable<VectorFieldData | null> =
    writable(null);

  // Rectified flow data store
  const rectifiedFlowData: Writable<RectifiedFlowData | null> = writable(null);

  // Grid trajectory stores
  const flowMatchingGridTrajectories: Writable<number[][][] | null> =
    writable(null);
  const rectifiedFlowGridTrajectories: Writable<number[][][][] | null> =
    writable(null);

  // Worker references
  let trainingWorker: Worker | null = null;
  let rectifiedTrainingWorker: Worker | null = null;

  // Defer other figures until first frame renders
  let showOtherFigures = false;

  // Figure width (shared across all figures)
  const figureWidth = settings.stylingSettings.global.figureWidth;

  // Bibliography state
  let bibEntries: Map<string, BibEntry> | null = null;
  let citations: CitationInfo[] = [];

  // ========== WRAPPER FUNCTIONS ==========

  async function loadTargetDistribution() {
    const samples = await trainAndSample.loadTargetDistribution(
      settings.targetDistributionPointsPath,
      settings.samplingSettings.flowMatching.numSamples
    );
    if (samples) {
      targetDistributionSamples.set(samples);
      return true;
    }
    return false;
  }

  async function loadCachedTrajectories(path: string) {
    const result = await trainAndSample.loadCachedTrajectories(path);
    if (result) {
      allTimeSamples.set(result.trajectories);
      sourceDistributionSamples.set(
        clipSamplesToRadius(
          result.sourceDistribution,
          settings.stylingSettings.scatterPlot.clippingRadius
        )
      );
      return true;
    }
    return false;
  }

  async function loadCachedVectorField(path: string) {
    const result = await trainAndSample.loadCachedVectorField(path);
    if (result) {
      vectorFieldData.set(result);
      return true;
    }
    return false;
  }

  async function loadCachedRectifiedFlowTrajectories(path: string) {
    const result =
      await trainAndSample.loadCachedRectifiedFlowTrajectories(path);
    if (result) {
      rectifiedFlowData.set(result);
      return true;
    }
    return false;
  }

  async function loadCachedGridTrajectories(
    path: string,
    isRectifiedFlow: boolean
  ) {
    if (isRectifiedFlow) {
      // Rectified flow grid is stored in RectifiedFlowData format: { allRectifiedTrajectories, modelPath }
      const rfResult =
        await trainAndSample.loadCachedRectifiedFlowTrajectories(path);
      if (rfResult) {
        rectifiedFlowGridTrajectories.set(rfResult.allRectifiedTrajectories);
        return true;
      }
      return false;
    } else {
      // Flow matching grid is stored as raw array format
      const result = await trainAndSample.loadCachedTrajectories(path);
      if (result) {
        flowMatchingGridTrajectories.set(result.trajectories);
        return true;
      }
      return false;
    }
  }

  async function loadCachedRectifiedFlowVectorField(path: string) {
    const result = await trainAndSample.loadCachedVectorField(path);
    if (result) {
      rectifiedFlowVectorFieldData.set(result);
      return true;
    }
    return false;
  }

  async function trainModel() {
    const result = await trainAndSample.trainModel(
      settings.trainingSettings,
      settings.trainWorkerUrl,
      () => isTraining.set(true),
      () => isTraining.set(false)
    );
    trainingWorker = result.worker;
    return result.modelPath;
  }

  async function generateSamples(modelPath: string) {
    const result = await trainAndSample.generateSamples(
      modelPath,
      settings.samplingSettings.flowMatching.numSamples,
      settings.samplingSettings.flowMatching.numSteps,
      settings.trainingSettings,
      settings.samplingWorkerUrl
    );
    allTimeSamples.set(result.allTimeSamples);
    sourceDistributionSamples.set(
      clipSamplesToRadius(
        result.sourceDistribution,
        settings.stylingSettings.scatterPlot.clippingRadius
      )
    );
    downloadTrajectories();
    return result.allTimeSamples;
  }

  async function generateVectorField(modelPath: string) {
    const result = await trainAndSample.generateVectorField(
      modelPath,
      settings.samplingSettings.flowMatchingVectorField.gridResolution,
      settings.samplingSettings.flowMatchingVectorField.numTimeSteps,
      settings.samplingSettings.flowMatchingVectorField.domainRange,
      settings.trainingSettings,
      settings.samplingWorkerUrl
    );
    vectorFieldData.set(result);
    downloadVectorField();
  }

  async function trainRectifiedFlow() {
    const result = await trainAndSample.trainRectifiedFlow(
      settings.trainingSettings,
      settings.trainWorkerUrl
    );
    rectifiedTrainingWorker = result.worker;
    rectifiedFlowData.set(result.data);
    downloadRectifiedFlowData();
    return result.data.modelPath;
  }

  async function generateFlowMatchingGridSamples(modelPath: string) {
    const result = await trainAndSample.generateSamplesUniformGrid(
      modelPath,
      settings.samplingSettings.flowMatchingGrid.gridResolution,
      settings.samplingSettings.flowMatchingGrid.gridDomainRange,
      settings.samplingSettings.flowMatchingGrid.numSteps,
      settings.trainingSettings,
      settings.samplingWorkerUrl
    );
    flowMatchingGridTrajectories.set(result.allTimeSamples);
    downloadFlowMatchingGridTrajectories();
    return result.allTimeSamples;
  }

  async function generateRectifiedFlowGridSamples(modelPath: string) {
    // Generate grid samples for each rectified step (before and after rectification)
    // We need the model from step 0 (before) and step 1+ (after)
    const gridTrajectories: number[][][][] = [];

    // For the "before" visualization, use the flow matching model (step 0)
    const beforeResult = await trainAndSample.generateSamplesUniformGrid(
      modelPath, // This should be the final rectified model
      settings.samplingSettings.rectifiedFlowGrid.gridResolution,
      settings.samplingSettings.rectifiedFlowGrid.gridDomainRange,
      settings.samplingSettings.rectifiedFlowGrid.numSteps,
      settings.trainingSettings,
      settings.samplingWorkerUrl
    );
    gridTrajectories.push(beforeResult.allTimeSamples);

    // For now, we only have one model, so use same for "after"
    // In a full implementation, you'd sample from intermediate models
    gridTrajectories.push(beforeResult.allTimeSamples);

    rectifiedFlowGridTrajectories.set(gridTrajectories);
    downloadRectifiedFlowGridTrajectories();
    return gridTrajectories;
  }

  async function generateRectifiedFlowVectorField(modelPath: string) {
    const result = await trainAndSample.generateVectorField(
      modelPath,
      settings.samplingSettings.rectifiedFlowVectorField.gridResolution,
      settings.samplingSettings.rectifiedFlowVectorField.numTimeSteps,
      settings.samplingSettings.rectifiedFlowVectorField.domainRange,
      settings.trainingSettings,
      settings.samplingWorkerUrl
    );
    rectifiedFlowVectorFieldData.set(result);
    downloadRectifiedFlowVectorField();
    return result;
  }

  // ========== DOWNLOAD FUNCTIONS ==========

  function downloadTrajectories() {
    const trajectories = $allTimeSamples;
    if (!trajectories || trajectories.length === 0) {
      console.error("No trajectories to download");
      return;
    }
    const filename =
      "flow_matching_trajectories_" + new Date().getTime() + ".json";
    downloadJSON(trajectories, filename);
    console.log(
      "Trajectories downloaded:",
      filename,
      trajectories.length,
      "timesteps"
    );
  }

  function downloadVectorField() {
    const field = $vectorFieldData;
    if (!field) {
      console.error("No vector field to download");
      return;
    }
    const filename =
      "flow_matching_vector_field_" + new Date().getTime() + ".json";
    downloadJSON(field, filename);
    console.log(
      "Vector field downloaded:",
      filename,
      field.timeSteps.length,
      "timesteps,",
      field.gridResolution,
      "x",
      field.gridResolution,
      "grid"
    );
  }

  function downloadRectifiedFlowData() {
    const data = $rectifiedFlowData;
    if (!data) {
      console.error("No rectified flow data to download");
      return;
    }
    const filename =
      "rectified_flow_trajectories_" + new Date().getTime() + ".json";
    downloadJSON(data, filename);
    console.log(
      "Rectified flow data downloaded:",
      filename,
      data.allRectifiedTrajectories.length,
      "rectified steps"
    );
  }

  function downloadFlowMatchingGridTrajectories() {
    const trajectories = $flowMatchingGridTrajectories;
    if (!trajectories || trajectories.length === 0) {
      console.error("No flow matching grid trajectories to download");
      return;
    }
    const filename =
      "flow_matching_grid_trajectories_" + new Date().getTime() + ".json";
    downloadJSON(trajectories, filename);
    console.log(
      "Flow matching grid trajectories downloaded:",
      filename,
      trajectories.length,
      "timesteps"
    );
  }

  function downloadRectifiedFlowGridTrajectories() {
    const trajectories = $rectifiedFlowGridTrajectories;
    if (!trajectories || trajectories.length === 0) {
      console.error("No rectified flow grid trajectories to download");
      return;
    }
    const filename =
      "rectified_flow_grid_trajectories_" + new Date().getTime() + ".json";
    // Wrap in RectifiedFlowData format for consistency
    const data = {
      allRectifiedTrajectories: trajectories,
      modelPath: "generated",
    };
    downloadJSON(data, filename);
    console.log(
      "Rectified flow grid trajectories downloaded:",
      filename,
      trajectories.length,
      "rectified steps"
    );
  }

  function downloadRectifiedFlowVectorField() {
    const field = $rectifiedFlowVectorFieldData;
    if (!field) {
      console.error("No rectified flow vector field to download");
      return;
    }
    const filename =
      "rectified_flow_vector_field_" + new Date().getTime() + ".json";
    downloadJSON(field, filename);
    console.log(
      "Rectified flow vector field downloaded:",
      filename,
      field.timeSteps.length,
      "timesteps,",
      field.gridResolution,
      "x",
      field.gridResolution,
      "grid"
    );
  }

  // ========== LIFECYCLE ==========

  onMount(async () => {
    // Load target distribution first
    await loadTargetDistribution();

    // Try to load each cached resource independently
    let flowMatchingTrajectoriesLoaded = false;
    let flowMatchingVectorFieldLoaded = false;
    let flowMatchingGridTrajectoriesLoaded = false;
    let rectifiedFlowTrajectoriesLoaded = false;
    let rectifiedFlowGridTrajectoriesLoaded = false;
    let rectifiedFlowVectorFieldLoaded = false;

    // Load flow matching trajectories
    if (settings.cachedFlowMatchingTrajectoriesPath) {
      flowMatchingTrajectoriesLoaded = await loadCachedTrajectories(
        settings.cachedFlowMatchingTrajectoriesPath
      );
    }

    // Load flow matching vector field
    if (settings.cachedFlowMatchingVectorFieldPath) {
      flowMatchingVectorFieldLoaded = await loadCachedVectorField(
        settings.cachedFlowMatchingVectorFieldPath
      );
    }

    // Load flow matching grid trajectories
    if (settings.cachedFlowMatchingGridTrajectoriesPath) {
      flowMatchingGridTrajectoriesLoaded = await loadCachedGridTrajectories(
        settings.cachedFlowMatchingGridTrajectoriesPath,
        false
      );
    }

    // Load rectified flow trajectories
    if (settings.cachedRectifiedFlowTrajectoriesPath) {
      rectifiedFlowTrajectoriesLoaded =
        await loadCachedRectifiedFlowTrajectories(
          settings.cachedRectifiedFlowTrajectoriesPath
        );
    }

    // Load rectified flow grid trajectories
    if (settings.cachedRectifiedFlowGridTrajectoriesPath) {
      rectifiedFlowGridTrajectoriesLoaded = await loadCachedGridTrajectories(
        settings.cachedRectifiedFlowGridTrajectoriesPath,
        true
      );
    }

    // Load rectified flow vector field
    if (settings.cachedRectifiedFlowVectorFieldPath) {
      rectifiedFlowVectorFieldLoaded = await loadCachedRectifiedFlowVectorField(
        settings.cachedRectifiedFlowVectorFieldPath
      );
    }

    // Train and generate any missing flow matching data
    let flowMatchingModelPath: string | null = null;

    if (!flowMatchingTrajectoriesLoaded) {
      console.log("Training new flow matching model...");
      flowMatchingModelPath = await trainModel();
      await generateSamples(flowMatchingModelPath);
    }

    if (!flowMatchingVectorFieldLoaded) {
      if (!flowMatchingModelPath) {
        console.log("Training model for vector field generation...");
        flowMatchingModelPath = await trainModel();
      }
      await generateVectorField(flowMatchingModelPath);
    }

    if (!flowMatchingGridTrajectoriesLoaded) {
      if (!flowMatchingModelPath) {
        console.log("Training model for grid trajectories...");
        flowMatchingModelPath = await trainModel();
      }
      await generateFlowMatchingGridSamples(flowMatchingModelPath);
    }

    // Train and generate any missing rectified flow data
    let rectifiedFlowModelPath: string | null = null;

    if (!rectifiedFlowTrajectoriesLoaded) {
      console.log("Training rectified flow...");
      rectifiedFlowModelPath = await trainRectifiedFlow();
    } else {
      // Get the model path from loaded data
      rectifiedFlowModelPath = $rectifiedFlowData?.modelPath ?? null;
    }

    if (!rectifiedFlowGridTrajectoriesLoaded && rectifiedFlowModelPath) {
      console.log("Generating rectified flow grid samples...");
      await generateRectifiedFlowGridSamples(rectifiedFlowModelPath);
    }

    if (!rectifiedFlowVectorFieldLoaded && rectifiedFlowModelPath) {
      console.log("Generating rectified flow vector field...");
      await generateRectifiedFlowVectorField(rectifiedFlowModelPath);
    }

    // Load bibliography and collect citations
    bibEntries = await loadBibliography();
    await tick(); // Ensure DOM is ready
    citations = collectCitations();

    return () => {
      if (trainingWorker) trainingWorker.terminate();
      if (rectifiedTrainingWorker) rectifiedTrainingWorker.terminate();
    };
  });
</script>

<div class="top-nav">
  <a href="https://alechelbling.com/blog.html" class="nav-link">Other Blogs</a>
  <a
    href="https://github.com/helblazer811/Diffusion-Explorer"
    target="_blank"
    rel="noopener noreferrer"
    class="nav-link"
  >
    Link to Code
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path
        d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
      />
    </svg>
  </a>
</div>

<TableOfContents />

<div class="page-container">
  <div class="title-header-wrapper">
    <h1 class="article-title">A Visual Introduction to Rectified Flows</h1>
    <!-- <h2 class="article-subtitle">Why flow matching trajectories are curved and how to straighten them.</h2> -->
    <div class="byline-dateline-container">
      <h2 class="byline">
        By <a href="https://alechelbling.com">Alec Helbling</a>
      </h2>
      <h2 class="dateline">December 24, 2025</h2>
    </div>
  </div>

  <RectifiedFlowVisualization
    width={figureWidth}
    allRectifiedTrajectories={clipAllRectifiedTrajectoriesToStartingRadius(
      $rectifiedFlowData?.allRectifiedTrajectories ?? [],
      settings.stylingSettings.scatterPlot.clippingRadius
    )}
    targetDistribution={$targetDistributionSamples}
    playingByDefault={true}
    onInitialized={() => {
      showOtherFigures = true;
      console.log(
        "RectifiedFlowVisualization initialized, showing other figures."
      );
    }}
  >
    <div class="caption">
      <span class="figure-number">Figure 1:</span>
      Watch how paths become straighter with each rectification step. Each step retrains
      the model using trajectories from the previous step, progressively reducing
      curvature.
    </div>
  </RectifiedFlowVisualization>

  <hr class="section-divider" />

  <h1 id="introduction" class="section-heading">Introduction</h1>
  <p>
    Flow-based generative models <span
      class="citation"
      data-cite="rezende2016variationalinferencenormalizingflows"
    ></span>
    have emerged as a powerful class of models for generating high-quality samples
    of complex data such as images and videos. These models leverage neural networks
    to transform random noise into complex data by applying a sequence of invertible
    transformations, allowing for both novel sample generation and likelihood estimation.
    <!-- Diffusion models [Citation Needed] have shown the incredible ability to
    generate compelling novel samples of complex data like images and videos.
    Diffusion models generate new data by starting from pure noise and
    iteratively refining it into a realistic sample, guided by patterns learned
    from training data.  -->
    The success of flow models is in part due to the introduction of flow matching
    <span class="citation" data-cite="lipman2022"></span>, which enables the
    training of flow models without computationally expensive simulation.
    However, a practical barrier to deploying flow models at scale is the need
    to run large neural networks—often with billions of parameters—many times to
    generate high-quality samples. This incurs not just high computational cost
    but also high latency; in some cases it can take minutes to generate a
    single sample. Thus, there is a pressing need to develop methods for
    accelerating flow-based models that minimize the number of necessary neural
    network passes.
  </p>
  <p>
    A major culprit behind the high cost incurred when sampling from flow models
    stems from the geometric properties of the learned flows. It can be
    challenging to reason about high-dimensional data, but fortunately for us,
    we can gain an intuition about many of the important geometric properties of
    flows by visualizing them in low-dimensions. In fact, we can use the exact
    same algorithms used to train large-scale models to train simple 2D flows on
    toy distributions and reproduce many phenomena of practical interest.
  </p>
  {#if showOtherFigures}
    <div id="figure-2">
      <CurvedTrajectoryIntro
        width={figureWidth}
        sourceDistributionSamples={$sourceDistributionSamples}
        targetDistributionSamples={$targetDistributionSamples}
        {allTimeSamples}
        {isTraining}
        playingByDefault={true}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 2:</span>
          The <span style="color: #f17720;">curved trajectories</span> produced by
          a model trained with flow matching.
        </div>
      </CurvedTrajectoryIntro>
    </div>
  {/if}
  <p>
    Sampling from a flow model involves simulating the trajectory of an abstract
    particle as it moves from random noise to real data by repeatedly querying a
    neural network to determine the particle's velocity at each point in time.
    When these trajectories are highly curved, accurately simulating them
    requires taking many small steps of our expensive neural network. Shown in <a
      href="#figure-2"
      class="internal-link">Figure 2</a
    >
    above, we can see that a flow model trained to generate samples from a simple
    smiley face distribution produces trajectories that are curved.
    <strong
      >This curvature, its consequences, and how to mitigate them are the
      central focus of this article.</strong
    >
    We will discuss why trajectories generated by flow models have this geometry,
    why they are challenging to efficiently simulate, and how a simple approach called
    rectified flows
    <span class="citation" data-cite="liu2022"></span> can straighten out the trajectories
    of flow models to enable faster sampling.
  </p>

  <!-- To sample from a flow model we model the
    trajectory of a particle starting out as random noise, we then use a neural
    network to predict the velocity of this particle, which points in the
    direction of real data. By repeatedly taking many incremental steps we form
    a trajectory that moves the sample from noise to real data. If we can take
    larger steps along this trajectory, we can reduce the number of times we
    need to run our, typically very large and expensive, neural network. A key
    property that governs how effectively we can approximate this trajectory
    with fewer steps is how curved it is. Very curved paths lead to an
    accumulation of numerical errors when making discrete linear jumps. In
    contrast, straight paths (or approximately straight anyway) can be simulated
    with just one or a few steps. Unfortunately, we will observe that models
    trained with flow matching produce curved trajectories. -->

  <h1 id="background" class="section-heading">Background</h1>
  <p>
    Before diving into the details behind why models trained with flow matching
    produce curved trajectories and how rectified flows can help, we will first
    cover some necessary background on flow-based generative models and flow
    matching. Separately, a great introduction to this topic by some of the
    original authors of flow matching can be found here <span
      class="citation"
      data-cite="lipman2024flowmatchingguidecode"
    ></span>. If you already have some familiarity with flow-based generative
    models and flow matching feel free to skip ahead to
    <a href="#the-problem" class="internal-link">The Problem</a>.
  </p>

  <h2 id="flow-based-models">Flow-Based Generative Models</h2>

  <p>
    The broad goal of generative modeling is to draw samples from some complex
    distribution of data (e.g., natural images) that we have empirical
    observations from, but where the true distribution is unknown. More
    concretely, given a finite number of samples <Katex
      math={"\\mathcal{X} = \\{x_1, \\dots, x_n\\}"}
    /> from a target distribution
    <Katex math="q" />, our goal is to learn a model that can generate new
    samples from <Katex math="q" />.
  </p>

  <p>
    A flow model learns to bridge a simple source probability distribution <Katex
      math={"p"}
    />
    that is easy to draw samples from, like a multivariate Gaussian <Katex
      math={"\\mathcal{N}(0, \\sigma^2 I)"}
    />, to a complex data distribution <Katex math="q" /> by defining a continuous
    transformation between the two. We define a continuous sequence of probability
    distributions, called a
    <em>probability path</em>
    <Katex math={"(p_t)_{0 \\leq t \\leq 1}"} />, that smoothly interpolates
    between our simple source distribution <Katex math={"p_0"} /> and our data distribution
    <Katex math={"p_1 = q"} /> (see
    <a href="#figure-3" class="internal-link">Figure 3</a>). We index this path
    by an abstract time variable <Katex math={"t \\in [0, 1]"} />, where
    <Katex math={"t=0"} /> corresponds to the source distribution and <Katex
      math={"t=1"}
    /> corresponds to the target distribution. By drawing samples from <Katex
      math={"p_0"}
    /> and transforming them according to our probability path we can produce samples
    distributed according to our data distribution <Katex math={"p_1 = q"} />.
  </p>

  {#if showOtherFigures}
    <div id="figure-3">
      <ProbabilityPath
        width={figureWidth}
        sourceDistributionSamples={$sourceDistributionSamples}
        targetDistributionSamples={$targetDistributionSamples}
        {allTimeSamples}
        {isTraining}
        playingByDefault={true}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 3:</span>
          The <span style="color: #f17720;">probability path</span>
          <Katex math={"p_t"} color="#f17720" /> of a continuous normalizing flow
          as it is transformed from a simple source distribution <Katex
            math={"p_0"}
          /> to a more complex data distribution <Katex math={"p_1 = q"} />. We
          can also see the trajectory of individual samples as they move from
          the source to target distribution.
        </div>
      </ProbabilityPath>
    </div>
  {/if}

  <p>
    A <em>flow</em>
    <Katex math={"\\psi_t(x)"} /> is a time-indexed mapping from <Katex
      math={"\\mathbb{R}^d"}
    /> to <Katex math={"\\mathbb{R}^d"} />
    that specifies
    <em>trajectories</em>
    of points over time; when applied to our samples <Katex
      math={"X_0 \\sim p_0"}
    /> it transports them from the source distribution to the target distribution
    <Katex math={"X_1 \\sim p_1 = q"} />. The intermediate samples produced by
    our flow <Katex math={"X_t = \\psi_t(X_0)"} /> are distributed according to our
    probability path <Katex math={"X_t \\sim p_t"} />. If we can somehow learn
    to model this flow, then we can draw samples from our simple source
    distribution <Katex math={"p_0"} /> and transform them to realistic approximations
    of real world data with distribution <Katex math="q" />.
  </p>

  {#if showOtherFigures}
    <HighlightTrajectory
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      {allTimeSamples}
      {isTraining}
    >
      <div class="caption">
        <span class="figure-number">Figure 4:</span>
        A single <span style="color: #f17720;">sample trajectory</span>
        <Katex math={"\\psi_t(x)"} color="#f17720" /> showing how an individual point
        moves from the source distribution to the target distribution.
      </div>
    </HighlightTrajectory>
  {/if}

  <p>
    Perhaps somewhat counterintuitively, rather than directly modeling the flow
    <Katex math={"\\psi_t(x)"} />, flow-based generative models instead model a
    time-dependent
    <em>velocity field</em>
    <Katex math={"v_t(x)"} /> that "generates" the flow. By taking this velocity
    field we can solve a set of ordinary differential equations (ODEs) to recover
    the flow, in a process called <em>simulation</em>. By starting from some
    initial point <Katex math="x" /> at time <Katex math="t=0" />, we can trace
    the trajectory of this point over time according to the velocity field <Katex
      math={"v_t(x)"}
    /> using the following ODEs
  </p>
  <Katex
    math={"\\frac{d}{dt} \\psi_t(x) = v_t(x), \\quad \\psi_0(x) = x."}
    displayMode={true}
  />
  <!-- Notably, the vector field we learn is time-dependent, meaning 
    that the velocity of a particle at location <Katex math="x" /> can change
    over time <Katex math="t" />.  -->
  <p>
    <!-- These ordinary differential equations tell us that the derivative of our
    flow at time <Katex math="t" /> must match the velocity <Katex
      math={"v_t(x)"}
    /> of our particle <Katex math="x" /> at time <Katex math="t" /> and start from
    an initial location <Katex math="x" /> when <Katex math={"t=0"} />.  -->
    The solution to these ordinary differential equations involving <Katex
      math={"v_t(x)"}
    /> is itself the flow <Katex math={"\\psi_t(x)"} />. There are a variety of
    numerical methods for simulating these ODEs which approximate the continuous
    trajectory by taking a series of discrete steps. Perhaps the simplest such
    method is
    <a
      href="https://en.wikipedia.org/wiki/Euler_method"
      target="_blank"
      rel="noopener noreferrer">Euler's method</a
    >, which approximates the trajectory of the flow by taking small linear
    steps in the direction of the velocity field at each time step <Katex
      math={"x_{t + \\Delta t} = x_t + \\Delta t \\cdot v_t(x_t)"}
    />.
  </p>

  {#if showOtherFigures}
    <EulerCircularDemo backgroundVisible={false}>
      <div class="caption">
        <span class="figure-number">Figure 5:</span>
        Euler's method applied to a circular vector field. The
        <span style="color: #3b82f6;">arrows</span> show the velocity field, and
        the orange path shows the trajectory computed by taking discrete steps in
        the direction of the velocity.
      </div>
    </EulerCircularDemo>
  {/if}

  <h2 id="flow-matching">Flow Matching</h2>
  <p>
    Now that we are equipped with some background knowledge on flow-based
    generative models, we can discuss flow matching. I will only give a high
    level overview of some of the concepts relevant to rectifed flows. Please
    check out
    <span class="citation" data-cite="lipman2024flowmatchingguidecode"></span>
    for a more thorough introduction.
  </p>
  <p>
    The motivation behind flow matching is to be able to learn our vector field <Katex
      math={"v_t(x)"}
    /> without having to do expensive simulation, meaning without having to use Euler
    integration or some other technique to solve ODEs. Flow matching allows us to
    learn <Katex math={"v_t(x)"} />
    by solving a simple regression loss!
  </p>
  <p>Flow matching can be broken down into two key steps:</p>
  <ol>
    <li>
      We need to define our probability path <Katex math={"p_t(x)"} /> for interpolating
      between our source <Katex math="p" /> and target distribution <Katex
        math="q"
      />.
    </li>
    <li>
      We need to train a velocity field <Katex math={"v_t^\\theta(x)"} /> that generates
      the path <Katex math={"p_t"} /> through regression.
    </li>
  </ol>

  <p>
    <strong>Step 1: Defining the Probability Path. </strong> We will focus on a
    specific choice of probability path called the
    <em>linear path</em>. The linear path can be defined through a simple linear
    interpolation between our source and target distributions:
  </p>
  <Katex math={"X_t = (1-t)X_0 + tX_1 \\sim p_t"} displayMode={true} />
  <p>
    In the examples I provide throughout this article, our source distribution
    <Katex math="p_0" /> is always a standard Gaussian distribution <Katex
      math={"p_0(x) = \\mathcal{N}(x|0, I)"}
    />, and our target distribution <Katex math="q" /> is a complex 2D distribution
    representing a smiley face. However, in general, flow matching affords much more
    flexibility in the choice of probability paths and source distributions.
  </p>
  <!-- <p>
    We will then construct the path <Katex math={"p_t(x)"} /> as a mixture of conditional
    probability paths
    <Katex math={"p_{t|1}(x|x_1) = \\mathcal{N}(x|t x_1, (1-t)^2 I)"} /> where each
    is conditioned on data examples <Katex math={"x_1 \\sim q"} />
    and has a Gaussian distribution. This is called the <em>linear path</em>,
    and it allows us to construct a random variable <Katex math={"X_t"} /> that is
    distributed according to our path <Katex math={"p_t"} /> through a simple linear
    interpolation between our source random variable <Katex
      math={"X_0 \\sim p_0"}
    /> and target random variable <Katex math={"X_1 \\sim q"} />:
  </p> -->

  {#if showOtherFigures}
    <LinearInterpolation
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      sourcePointIndex={5}
      targetPointIndex={10}
      playingByDefault={true}
      backgroundVisible={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 4:</span>
        Linear interpolation between a source point <Katex math={"x_0"} /> and target
        point <Katex math={"x_1"} />, producing the interpolated sample <Katex
          math={"x_t"}
        /> at time <Katex math="t" />.
      </div>
    </LinearInterpolation>
  {/if}

  <p>
    <strong>Step 2: Regressing the Velocity Field. </strong>
    Now, the second step of flow matching is to "match" the true velocity field <Katex
      math={"v_t(x)"}
    /> with an approximation <Katex math={"v_t^\\theta(x)"} />, parameterized by
    a neural network, by optimizing a simple regression objective.
  </p>
  <Katex
    math={"\\mathcal{L}_{FM}(\\theta) = \\mathbb{E}_{t, X_t \\sim p_t} ||v_t(X_t) - v_t^\\theta(X_t)||^2"}
    displayMode={true}
  />
  <p>
    However, there is a catch: we do not have direct access to the true velocity
    field <Katex math={"v_t(x)"} />! <Katex math={"v_t(x)"} /> is difficult to directly
    construct in practice as it governs the transformations between two high dimensional
    distributions. So, how can we possibly optimize this objective?
  </p>
  <p>
    Luckily, we can create a related but much simpler objective by conditioning
    our velocity field on a particular instance from our target distribution <Katex
      math={"x_1 \\sim q"}
    />. This yields the conditional velocity field <Katex
      math={"v_t(x | x_1) = \\frac{x_1 - x}{1 - t}"}
    />.
  </p>

  {#if showOtherFigures}
    <ConditionalVelocityField
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      backgroundVisible={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 5:</span>
        The <span style="color: #f17720;">conditional velocity field</span>
        <Katex math={"v_t(x|x_1) = \\frac{x_1 - x}{1 - t}"} color="#f17720" />
        points from an intermediate sample <Katex math={"x_t"} /> toward the target
        <Katex math={"x_1"} />.
      </div>
    </ConditionalVelocityField>
  {/if}

  <p>
    Equipped with this conditional vector field, we can create a regression
    objective called
    <em>conditional flow matching</em>. 
  </p>
  <Katex
    math={"\\mathcal{L}_{CFM}(\\theta) = \\mathbb{E}_{t, X_0, X_1} ||v_t(X_t | X_1) - v_t^\\theta(X_t)||^2"}
    displayMode={true}
  />
  <p>
    If we then plug in our specific conditional
    velocity field for our choice of a linear probability path, we get the remarkably
    simple training objective:
  </p>

  <Katex
    math={"\\mathcal{L}_{CFM}(\\theta) = \\mathbb{E}_{t, X_0, X_1} ||(X_1 - X_0) - v_t^\\theta(X_t)||^2"}
    displayMode={true}
  />
  <p>
    Incredibly, the conditional flow
    matching and the flow matching objectives have the same gradients
    <Katex
      math={"\\nabla_\\theta \\mathcal{L}_{CFM}(\\theta) = \\nabla_\\theta \\mathcal{L}_{FM}(\\theta)"}
    />
    , meaning we can optimize our tractable conditional flow matching objective and
    solve the flow matching problem.
    During training we simply need to draw pairs <Katex math={"(X_0, X_1)"} />
    from our source and target distributions, interpolate between them to get
    <Katex math={"X_t"} />, and then train our velocity field <Katex
      math={"v_t^\\theta(x)"}
    /> to predict the straight-line velocity <Katex math={"X_1 - X_0"} />.
  </p>

  {#if showOtherFigures}
    <ConditionalFlowMatching
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      backgroundVisible={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 6:</span>
        The <span style="color: #22c55e;">learned velocity field</span>
        <Katex math={"v_t^\\theta(x)"} color="#22c55e" /> approximates the
        <span style="color: #f17720;">conditional velocity</span>
        <Katex math={"v_t(x|x_1)"} color="#f17720" />. The dashed line shows the
        <span style="color: #ef4444;">error</span> between the true and predicted
        velocities.
      </div>
    </ConditionalFlowMatching>
  {/if}

  <p>
    A critical fact that is worth emphasizing, is that we are matching the
    conditional velocity
    <Katex math={"v_t(x|x_1)"} /> which is conditioned on the target point <Katex
      math={"x_1"}
    />
    with our learned velocity field <Katex math={"v_t^\\theta(x)"} /> which
    <strong>only "knows" about the current <Katex math={"x"} /></strong>. If we
    were to condition our learned vector field on <Katex math={"x_1"} />
    as well, then the problem would become trivial as the model could just predict
    some scaled version of <Katex math={"x_1 - x"} />. So, the model <Katex
      math={"v_t^\\theta(x)"}
    />
    has to identify the likely destination <Katex math={"x_1"} /> using only the
    information about the location <Katex math={"x"} /> at time <Katex
      math={"t"}
    />.
  </p>

  <h1 id="the-problem" class="section-heading">The Problem</h1>

  <p>
    With the fundamentals of flow models and flow matching established, we can
    now investigate some of their idiosyncrasies—and how they come up in
    practice. As shown above, a model trained with flow matching can learn to
    generate samples resembling our desired target distribution. However, you
    can see that the trajectories of these samples are curved (see <a
      href="#figure-2"
      class="internal-link">Figure 2</a
    >). If we superimpose the source and target distributions we can see that
    this curvature is even more extreme (see
    <a href="#figure-7" class="internal-link">Figure 7</a>). Now we will revisit
    why this is a problem.
  </p>

  <CurvedTrajectorySuperimposed
    trajectories={$flowMatchingGridTrajectories}
    sourceDistribution={$sourceDistributionSamples}
    targetDistribution={$targetDistributionSamples}
    playingByDefault={true}
    backgroundVisible={false}
  >
    <div class="caption">
      <span class="figure-number">Figure 7:</span>
      <span style="color: #f17720;">Curved trajectories</span> with source and target distributions superimposed.
    </div>
  </CurvedTrajectorySuperimposed>

  <h2 id="curvature">Curvature is the Enemy of Speed</h2>

  <p>
    An astute reader might recall that we trained our velocity field <Katex
      math={"v_t^\\theta(x)"}
    /> to match straight trajectories <Katex math={"X_1 - X_0"} /> due to our choice
    of a linear path. So, why does our model then learn curved trajectories, and
    why is this an issue? Answering the latter question—why curvature is a problem—is
    more straightforward: the answer is speed.
  </p>

  <p>
    When drawing new samples from a flow model we perform numerical integration
    using the trained velocity field <Katex math={"v_t^\\theta(x)"} />. At its
    core, numerical integration algorithms like Euler's method involve making
    finite steps in the direction of the velocity field: <Katex
      math={"x_{i+1} = x_i + \\alpha \\cdot v_t^\\theta(x_i)"}
    />. We are making local linear approximations of the "true trajectories".
    The degree to which this approximation is accurate depends on how curved the
    trajectories are, and the size of steps we can take without deviating from
    the true trajectory and degrading our sample quality too much.
  </p>

  {#if showOtherFigures}
    <EulerSamplerFigure width={figureWidth}>
      <div class="caption">
        <span class="figure-number">Figure 5:</span>
        Comparison of Euler method approximations for high-curvature (left) and low-curvature
        (right) functions. Ground truth shown in black, Euler approximation in orange.
        Highly curved trajectories require many steps to simulate accurately.
      </div>
    </EulerSamplerFigure>
  {/if}

  <p>
    The punch line: curvature is the enemy of speed. Highly curved trajectories
    are challenging to accurately simulate with a small number of steps. This
    means we need to make many calls to our large neural network representing
    our vector field <Katex math={"v_t^\\theta(x)"} /> in order to accurately approximate
    these trajectories, leading to high latency and computational cost. However,
    as we can see above on the right, there is still hope. If our ground truth trajectories
    are approximately straight we can simulate them accurately with a small number
    of steps!
    <strong
      >So the question arises, how can we encourage our model to produce
      straighter paths?</strong
    >
    First, it is important to answer our question from earlier: why is our model
    learning curved trajectories in the first place? The answer lies in how our source
    <Katex math={"X_0"} /> and target random variables <Katex math={"X_1"} /> are
    jointly distributed, which is called their <em>coupling</em>.
  </p>

  <h2 id="problem-coupling">Coupling </h2>

  <p>
    A design choice available to us is also how the source and target points
    are jointly distributed. This joint distribution <Katex
      math={"\\pi(x_0, x_1)"} /> is called a <em>coupling</em> between the source
    and target distributions. Different couplings will lead to different
    behaviors of the learned flow. The key requirement is that the marginals are the source <Katex 
      math={"\\pi(x_0) = p_0"} /> and target distributions <Katex math={"\\pi(x_1) = q"} />. 
    </p>
    <p>
      The simplest form of couping is an independent coupling.


    The simplest choice is to
    draw them independently: <Katex math={"X_0 \\sim p_0"} /> and <Katex math={"X_1 \\sim q"} />.

    This simply requires us to draw pairs from our source and target
    distributions
    <Katex math={"X_0 \\sim p_0"} /> and <Katex math={"X_1 \\sim q"} />,
    linearly interpolate between them to get <Katex math={"X_t"} />, and then
    train our velocity field
    <Katex math={"v_t^\\theta(x)"} /> to predict the straight-line velocity <Katex
      math={"X_1 - X_0"}
    />.
  </p>

  <p>
    A coupling is what tells us how samples from our source distribution <Katex
      math={"p(x_0)"}
    /> are paired with samples in our target distribution <Katex
      math={"q(x_1)"}
    />. It is the joint distribution <Katex math={"\\pi(x_0, x_1)"} /> whose marginals
    are <Katex math={"p(x_0)"} /> and <Katex math={"q(x_1)"} /> respectively.
  </p>

  <h2 id="paths-crossing">Our Paths Crossed at the Wrong Time</h2>

  <p>
    In this article, we use an independent coupling where the joint distribution
    is defined as <Katex math={"\\pi(x_0, x_1) = p(x_0)q(x_1)"} /> which also means
    that we construct pairs <Katex math={"(x_0, x_1)"} /> by drawing independent
    samples <Katex math={"X_0 \\sim p"} /> and <Katex math={"X_1 \\sim q"} />.
    This choice makes sense for image data because we don't necessarily have
    some additional paired structure to define our joint distribution.
  </p>

  {#if showOtherFigures}
    <IndependentCoupling
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      backgroundVisible={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 6:</span>
        Visualization of an independent coupling connecting random source points
        to random target points.
      </div>
    </IndependentCoupling>
  {/if}

  <p>
    We can visualize these pairs with lines <Katex math={"x_1 - x_0"} />, which
    is exactly the velocities that we are going to target with our flow matching
    objective due to our choice of linear path.
    <strong
      >What you might notice about this visualization is that these lines cross
      each other a lot.</strong
    >
    This crossing of trajectories is at the core of why our learned velocity field
    <Katex math={"v_t^\\theta(x)"} /> learns curved trajectories despite the fact
    that it is being trained to model linear paths.
  </p>

  <p>
    The reason our trained velocity field <Katex math={"v_t^\\theta"} /> induces
    curved trajectories despite the fact it is regressing straight paths <Katex
      math={"X_1 - X_0"}
    /> is because at a given time <Katex math="t" /> our velocity field is only a
    function of the current <Katex math={"X_t"} />.
  </p>

  {#if showOtherFigures}
    <IntersectingPaths
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      backgroundVisible={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 7:</span>
        Two pairs <Katex math={"(x_0^a, x_1^a)"} /> and <Katex
          math={"(x_0^b, x_1^b)"}
        /> that intersect at a point <Katex math="x" /> at time <Katex
          math="t"
        />. The velocity field <Katex math={"v_t^\\theta(x)"} /> cannot accurately
        predict both conflicting velocities—the best it can do is predict the conditional
        expectation (green arrow).
      </div>
    </IntersectingPaths>
  {/if}

  <p>
    Above we can see a scenario where we have two pairs <Katex
      math={"(x_0^a, x_1^a)"}
    /> and <Katex math={"(x_0^b, x_1^b)"} /> that intersect at some point <Katex
      math="x"
    /> at a particular time <Katex math="t" />. Our velocity field <Katex
      math={"v_t^\\theta(x)"}
    /> which is a function of this <Katex math="x" /> has no way of accurately predicting
    the two conflicting velocities <Katex math={"x_1^a - x_0^a"} /> and <Katex
      math={"x_1^b - x_0^b"}
    />. It is not possible. The best it can do is predict the conditional
    expectation of velocities passing through <Katex math="x" />: <Katex
      math={"\\mathbb{E}[X_1 - X_0 | X_t = x]"}
    />. So our learned velocity field resolves <em>branches</em> in the probability
    path by averaging them out (shown in green).
  </p>

  <h1 id="rectified-flows" class="section-heading">Rectified Flows</h1>

  <h2 id="algorithm">Algorithm</h2>

  <Algorithm backgroundVisible={true}>
    {#snippet caption()}
      <div class="caption">
        <span class="figure-number">Algorithm 1:</span>
        The Reflow procedure iteratively straightens trajectories by retraining on
        the coupling induced by the previous model.
      </div>
    {/snippet}
    {#snippet title()}
      Algorithm: Reflow Procedure
    {/snippet}
    {#snippet inputs()}
      Source distribution <Katex math={"p"} />, target distribution <Katex
        math={"q"}
      />, number of iterations <Katex math={"K"} />
    {/snippet}
    {#snippet outputs()}
      Rectified velocity field <Katex math={"v_\\theta^K"} />
    {/snippet}
    {#snippet steps()}
      <div class="algorithm-line">
        <span class="line-number">1:</span>
        <span
          >Sample pairs <Katex math={"(X_0, X_1)"} /> from independent coupling <Katex
            math={"\\pi_0 = p \\times q"}
          /></span
        >
      </div>
      <div class="algorithm-line">
        <span class="line-number">2:</span>
        <span
          ><strong>for</strong>
          <Katex math={"k = 1, 2, \\ldots, K"} /> <strong>do</strong></span
        >
      </div>
      <div class="algorithm-line indented">
        <span class="line-number">3:</span>
        <span
          >Train velocity field <Katex math={"v_\\theta^k"} /> on pairs from <Katex
            math={"\\pi_{k-1}"}
          /></span
        >
      </div>
      <div class="algorithm-line indented">
        <span class="line-number">4:</span>
        <span
          >Generate new pairs: <Katex math={"X_1^k = \\psi_1^k(X_0)"} /> by flowing
          <Katex math={"X_0 \\sim p"} /> through <Katex
            math={"v_\\theta^k"}
          /></span
        >
      </div>
      <div class="algorithm-line indented">
        <span class="line-number">5:</span>
        <span>Update coupling: <Katex math={"\\pi_k = (X_0, X_1^k)"} /></span>
      </div>
      <div class="algorithm-line">
        <span class="line-number">6:</span>
        <span><strong>end for</strong></span>
      </div>
      <div class="algorithm-line">
        <span class="line-number">7:</span>
        <span><strong>return</strong> <Katex math={"v_\\theta^K"} /></span>
      </div>
    {/snippet}
  </Algorithm>

  <h2 id="comparisons">Comparisons</h2>

  {#if showOtherFigures}
    <RectifiedFlowSuperimposed
      width={figureWidth}
      leftTrajectories={$flowMatchingGridTrajectories ?? []}
      rightTrajectories={$rectifiedFlowGridTrajectories?.[
        $rectifiedFlowGridTrajectories.length - 1
      ] ?? []}
      targetDistribution={$targetDistributionSamples}
      playingByDefault={true}
    >
      <div class="caption">
        <span class="figure-number">Figure 8:</span>
        A rectified flow learns straighter paths. Left: Before rectification - curved
        trajectories. Right: After rectification - straighter trajectories.
      </div>
    </RectifiedFlowSuperimposed>

    <VectorFieldCurvatureComparison
      flowMatchingVectorField={$vectorFieldData}
      rectifiedFlowVectorField={$rectifiedFlowVectorFieldData}
      playingByDefault={true}
      backgroundVisible={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 9:</span>
        Comparison of vector fields. Left: Flow matching produces velocity vectors
        that vary significantly across time. Right: Rectified flow produces more
        consistent velocity vectors throughout the trajectory.
      </div>
    </VectorFieldCurvatureComparison>

    <InducedCouplingDouble
      allRectifiedTrajectories={clipAllRectifiedTrajectoriesToStartingRadius(
        $rectifiedFlowData?.allRectifiedTrajectories ?? [],
        settings.stylingSettings.scatterPlot.clippingRadius
      )}
      targetDistribution={$targetDistributionSamples}
    >
      <div class="caption">
        <span class="figure-number">Figure 10:</span>
        Comparison of independent coupling (left) vs induced coupling from the flow
        model (right). The induced coupling connects each source point to where it
        actually flows, resulting in less tangled paths.
      </div>
    </InducedCouplingDouble>
  {/if}

  <p>
    <strong
      >Finally, we will discuss how a simple technique called rectified flows
      can mitigate this curvature.</strong
    >
    Rectified flows aim to straighten out the trajectories of these flows. They do
    this by replacing the naive independent <em>coupling</em>—how data points <Katex
      math={"x_1"}
    /> and their noisy counterparts <Katex math={"x_0"} /> are paired—used in vanilla
    flow-matching training with one induced by the model itself. By recursively replacing
    the coupling with a straighter one, the model finally converges on generating
    straight paths.
  </p>

  <p>
    Why does the coupling induced by training a flow matching model work? If the
    velocity field is learning a curved trajectory for a particular sample, then
    it is "sacrificing" loss because a perfect model would have no curvature at
    all because it is regressing <Katex math={"X_1 - X_0"} />. The learned
    velocity field can't model crossing trajectories because it is conditioned
    only on the current <Katex math="x" />. So the tradeoff is that it tries to
    learn the direction that works well on average, meaning it can never achieve
    minimal loss with a tangled coupling.
  </p>

  <p>
    If a model is learning a high curvature trajectory then it really wants that
    sample's path to lead somewhere that is in conflict with its target
    destination for a given coupling, and is willing to trade off a significant
    amount of loss for the sake of modeling other samples. It is almost like
    these curved trajectory samples are outliers that the model is ignoring. By
    untangling the coupling you are allowing the model to resolve this conflict.
  </p>

  <h1 id="acknowledgements" class="section-heading">Acknowledgements</h1>
  <div class="acknowledgements">
    <p></p>
  </div>

  <h1 id="references" class="section-heading">References</h1>
  <Bibliography {citations} {bibEntries} />

  <h1 id="cite" class="section-heading">How to Cite</h1>
  <div class="cite-section">
    <p>If you found this explainer helpful, please consider citing it:</p>
    <pre><code
        >@article{"{"}helbling2025rectifiedflows,
  title = {"{"}A Visual Introduction to Rectified Flows{"}"},
  author = {"{"}Helbling, Alec{"}"},
  year = {"{"}2025{"}"},
  url = {"{"}https://alechelbling.com/rectified-flows{"}"}
{"}"}</code
      ></pre>
  </div>
</div>
