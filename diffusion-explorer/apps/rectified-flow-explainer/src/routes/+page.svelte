<script lang="ts">
  import { onMount, tick } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import {
    downloadJSON,
    clipSamplesToRadius,
    clipAllRectifiedTrajectoriesToStartingRadius,
  } from "$lib/flow_matching/utils";
  import {
    settings,
    type VectorFieldData,
    type RectifiedFlowData,
  } from "$lib/settings";
  import * as train from "$lib/flow_matching/train";
  import * as sample from "$lib/flow_matching/sample";
  import {
    loadBibliography,
    collectCitations,
    type BibEntry,
    type CitationInfo,
  } from "@diffusion-explorer/ui";

  import IndependentCoupling from "$lib/figures/IndependentCoupling.svelte";
  import ProbabilityPath from "$lib/figures/ProbabilityPath.svelte";
  import HighlightTrajectory from "$lib/figures/HighlightTrajectory.svelte";
  import CurvedTrajectoryIntro from "$lib/figures/CurvedTrajectoryIntro.svelte";
  import EulerSamplerFigure from "$lib/figures/EulerSamplerFigure.svelte";
  import EulerCircularDemo from "$lib/figures/EulerCircularDemo.svelte";
  import RectifiedFlowSuperimposed from "$lib/figures/RectifiedFlowSuperimposed.svelte";
  import CrownJewel from "$lib/figures/CrownJewel.svelte";
  import LinearInterpolation from "$lib/figures/LinearInterpolation.svelte";
  import IntersectingPaths from "$lib/figures/IntersectingPaths.svelte";
  import InducedCouplingDouble from "$lib/figures/InducedCouplingDouble.svelte";
  import VectorFieldCurvatureComparison from "$lib/figures/VectorFieldCurvatureComparison.svelte";
  import ConditionalVelocityField from "$lib/figures/ConditionalVelocityField.svelte";
  import ConditionalFlowMatching from "$lib/figures/ConditionalFlowMatching.svelte";
  import CurvedTrajectorySuperimposed from "$lib/figures/CurvedTrajectorySuperimposed.svelte";
  import ReflowAlgorithm from "$lib/figures/ReflowAlgorithm.svelte";
  import EulerStepComparison from "$lib/figures/EulerStepComparison.svelte";
  import { Figure, Bibliography, HoverableReference, Katex } from "@diffusion-explorer/ui";
  import { base } from "$app/paths";

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
    const samples = await sample.loadTargetDistribution(
      `${base}/${settings.targetDistributionPointsPath}`,
      settings.samplingSettings.flowMatching.numSamples
    );
    if (samples) {
      targetDistributionSamples.set(samples);
      return true;
    }
    return false;
  }

  async function loadCachedTrajectories(path: string) {
    const result = await sample.loadCachedTrajectories(path);
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
    const result = await sample.loadCachedVectorField(path);
    if (result) {
      vectorFieldData.set(result);
      return true;
    }
    return false;
  }

  async function loadCachedRectifiedFlowTrajectories(path: string) {
    const result = await sample.loadCachedRectifiedFlowTrajectories(path);
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
      const rfResult = await sample.loadCachedRectifiedFlowTrajectories(path);
      if (rfResult) {
        rectifiedFlowGridTrajectories.set(rfResult.allRectifiedTrajectories);
        return true;
      }
      return false;
    } else {
      // Flow matching grid is stored as raw array format
      const result = await sample.loadCachedTrajectories(path);
      if (result) {
        flowMatchingGridTrajectories.set(result.trajectories);
        return true;
      }
      return false;
    }
  }

  async function loadCachedRectifiedFlowVectorField(path: string) {
    const result = await sample.loadCachedVectorField(path);
    if (result) {
      rectifiedFlowVectorFieldData.set(result);
      return true;
    }
    return false;
  }

  async function trainModel() {
    const result = await train.trainModel(
      settings.trainingSettings,
      settings.trainWorkerUrl,
      () => isTraining.set(true),
      () => isTraining.set(false)
    );
    trainingWorker = result.worker;
    return result.modelPath;
  }

  async function generateSamples(modelPath: string) {
    const result = await sample.generateSamples(
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
    const result = await sample.generateVectorField(
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
    const result = await train.trainRectifiedFlow(
      settings.trainingSettings,
      settings.trainWorkerUrl
    );
    rectifiedTrainingWorker = result.worker;
    rectifiedFlowData.set(result.data);
    downloadRectifiedFlowData();
    return result.data.modelPath;
  }

  async function generateFlowMatchingGridSamples(modelPath: string) {
    const result = await sample.generateSamplesUniformGrid(
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
    const beforeResult = await sample.generateSamplesUniformGrid(
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
    const result = await sample.generateVectorField(
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
    // Prefix paths with base for production deployment
    if (settings.flowMatchingModelPath) {
      settings.flowMatchingModelPath = `${base}${settings.flowMatchingModelPath}`;
    }
    if (settings.rectifiedFlowModelPath) {
      settings.rectifiedFlowModelPath = `${base}${settings.rectifiedFlowModelPath}`;
    }
    if (settings.samplingWorkerUrl) {
      settings.samplingWorkerUrl = `${base}${settings.samplingWorkerUrl}`;
    }

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
        `${base}/${settings.cachedFlowMatchingTrajectoriesPath}`
      );
    }

    // Load flow matching vector field
    if (settings.cachedFlowMatchingVectorFieldPath) {
      flowMatchingVectorFieldLoaded = await loadCachedVectorField(
        `${base}/${settings.cachedFlowMatchingVectorFieldPath}`
      );
    }

    // Load flow matching grid trajectories
    if (settings.cachedFlowMatchingGridTrajectoriesPath) {
      flowMatchingGridTrajectoriesLoaded = await loadCachedGridTrajectories(
        `${base}/${settings.cachedFlowMatchingGridTrajectoriesPath}`,
        false
      );
    }

    // Load rectified flow trajectories
    if (settings.cachedRectifiedFlowTrajectoriesPath) {
      rectifiedFlowTrajectoriesLoaded =
        await loadCachedRectifiedFlowTrajectories(
          `${base}/${settings.cachedRectifiedFlowTrajectoriesPath}`
        );
    }

    // Load rectified flow grid trajectories
    if (settings.cachedRectifiedFlowGridTrajectoriesPath) {
      rectifiedFlowGridTrajectoriesLoaded = await loadCachedGridTrajectories(
        `${base}/${settings.cachedRectifiedFlowGridTrajectoriesPath}`,
        true
      );
    }

    // Load rectified flow vector field
    if (settings.cachedRectifiedFlowVectorFieldPath) {
      rectifiedFlowVectorFieldLoaded = await loadCachedRectifiedFlowVectorField(
        `${base}/${settings.cachedRectifiedFlowVectorFieldPath}`
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
    bibEntries = await loadBibliography(`${base}/bibliography.bib`);
    await tick(); // Ensure DOM is ready
    citations = collectCitations();

    return () => {
      if (trainingWorker) trainingWorker.terminate();
      if (rectifiedTrainingWorker) rectifiedTrainingWorker.terminate();
    };
  });
</script>

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

  <CrownJewel
    width={figureWidth}
    leftTrajectories={$flowMatchingGridTrajectories ?? []}
    rightTrajectories={$rectifiedFlowGridTrajectories?.[
      $rectifiedFlowGridTrajectories.length - 1
    ] ?? []}
    targetDistribution={$targetDistributionSamples}
    playingByDefault={true}
    backgroundVisible={false}
    onInitialized={() => {
      showOtherFigures = true;
      console.log("CrownJewel initialized, showing other figures.");
    }}
  >
    <div class="caption">
      <span class="figure-number">Figure 1:</span>
      <strong>
        A rectified flow model learns straighter <span style="color: #f17720;"
          >sampling paths</span
        > than a standard flow matching model, enabling faster simulation.
      </strong>
      Both models are trained to generate samples from the same
      <span style="color: #3b82f6;">target distribution</span>. The rectified
      flow's straighter paths allow for accurate numerical integration with
      fewer steps, reducing the computational cost of simulation and lowering
      latency. Tap
      <img
        src="{base}/icons/tap.svg"
        alt="tap"
        style="width: 28px; height: 28px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
      /> to generate a sample.
    </div>
  </CrownJewel>

  <hr class="section-divider" />

  <h1 id="introduction" class="section-heading">Introduction</h1>
  <p>
    Flow-based generative models <HoverableReference
      id="rezende2016variationalinferencenormalizingflows"
      {bibEntries}
      {citations}
    />
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
    <HoverableReference id="lipman2022" {bibEntries} {citations} />, which
    enables the training of flow models without computationally expensive
    simulation. However, a practical barrier to deploying flow models at scale
    is the need to run large neural networks—often with billions of
    parameters—many times to generate high-quality samples. This incurs not just
    high computational cost but also high latency; in some cases it can take
    minutes to generate a single sample. Thus, there is a pressing need to
    develop methods for accelerating flow-based models that minimize the number
    of necessary neural network passes.
  </p>
  <p>
    A major culprit behind the high cost incurred when sampling from flow models
    stems from the geometric properties of the learned flows. It can be
    challenging to reason about high-dimensional data, but fortunately for us,
    we can gain an intuition about many of the important geometric properties of
    flows by visualizing them in low-dimensions. In fact, we can use the exact
    same algorithms used to train large-scale models to train simple 2D flows on
    toy distributions and reproduce many phenomena of practical interest. In a
    related project we developed an <a
      href="https://github.com/helblazer811/Diffusion-Explorer"
      >interactive web app</a
    >
    called Diffusion Explorer
    <HoverableReference
      id="helbling2025diffusionexplorerinteractiveexploration"
      {bibEntries}
      {citations}
    />
    that allows users to experiment with training and sampling from flow and diffusion
    models in 2D.
  </p>
  {#if showOtherFigures}
    <div id="figure-2">
      <CurvedTrajectoryIntro
        width={figureWidth}
        sourceDistributionSamples={$sourceDistributionSamples}
        targetDistributionSamples={$targetDistributionSamples}
        allTimeSamples={$allTimeSamples}
        isTraining={$isTraining}
      >
        <div class="caption">
          <span class="figure-number">Figure 2:</span>
          <strong
            >A flow matching model produces curved <span style="color: #f17720;"
              >sampling trajectories.</span
            ></strong
          >
          This figure visualizes the transformation of a random noise source distribution
          to a simple smiley face target distribution over time. Tap
          <img
            src="{base}/icons/tap.svg"
            alt="tap"
            style="width: 28px; height: 28px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
          /> to generate a sample.
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
    <HoverableReference id="liu2022" {bibEntries} {citations} /> can straighten out
    the trajectories of flow models to enable faster sampling.
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
    original authors of flow matching can be found here <HoverableReference
      id="lipman2024flowmatchingguidecode"
      {bibEntries}
      {citations}
    />. If you already have some familiarity with flow-based generative models
    and flow matching feel free to skip ahead to
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
        showContours={true}
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
      allTimeSamples={$allTimeSamples}
      isTraining={$isTraining}
    >
      <div class="caption">
        <span class="figure-number">Figure 4:</span>
        A single <span style="color: #f17720;">sample trajectory</span>
        <Katex math={"\\psi_t(x)"} color="#f17720" /> showing how an individual point
        <Katex math={"x"} color="#f17720" />
        moves from the source distribution to the target distribution. Tap
        <img
          src="{base}/icons/tap.svg"
          alt="tap"
          style="width: 28px; height: 28px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
        /> to generate a sample.
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
        <strong> Euler's method applied to a circular vector field. </strong>
        A <span style="color: #f17720;">trajectory</span> is shown for a single
        sample that is integrated according to the
        <span style="color: #3b82f6;">velocity field</span>.
      </div>
    </EulerCircularDemo>
  {/if}

  <h2 id="flow-matching">Flow Matching</h2>
  <p>
    Now that we are equipped with some background knowledge on flow-based
    generative models, we can discuss flow matching. I will only give a high
    level overview of some of the concepts relevant to rectifed flows. Please
    check out
    <HoverableReference
      id="lipman2024flowmatchingguidecode"
      {bibEntries}
      {citations}
    />
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
        <span class="figure-number">Figure 6:</span>
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
      math={"v_t(x_t)"}
    /> with an approximation <Katex math={"v_t^\\theta(x_t)"} />, parameterized
    by a neural network, by optimizing a simple regression objective.
  </p>
  <Katex
    math={"\\mathcal{L}_{FM}(\\theta) = \\mathbb{E}_{t, X_t \\sim p_t} ||v_t(X_t) - v_t^\\theta(X_t)||^2"}
    displayMode={true}
  />
  <p>
    However, there is a catch: we do not have direct access to the true velocity
    field <Katex math={"v_t(x_t)"} />! <Katex math={"v_t(x_t)"} /> is difficult to
    directly construct in practice as it governs the transformations between two
    jointly distributed high dimensional distributions. So, how can we optimize this
    objective?
  </p>
  <p>
    Luckily, we can create a related but much simpler objective by conditioning
    our velocity field on a particular instance from our target distribution <Katex
      math={"x_1 \\sim q"}
    />. This yields the conditional velocity field <Katex
      math={"v_t(x_t | x_1) = \\frac{x_1 - x_t}{1 - t}"}
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
        <span class="figure-number">Figure 7:</span>
        The conditional velocity field <Katex math={"v_t(x|x_1)"} /> for a specific
        target point <Katex math={"x_1"} /> is a bunch of straight arrows pointing
        from the source distribution to the target point.
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
    If we then plug in our specific conditional velocity field for our choice of
    a linear probability path, we get the remarkably simple training objective:
  </p>

  <Katex
    math={"\\mathcal{L}_{CFM}(\\theta) = \\mathbb{E}_{t, X_0, X_1} ||(X_1 - X_0) - v_t^\\theta(X_t)||^2"}
    displayMode={true}
  />
  <p>
    Incredibly, the conditional flow matching and the flow matching objectives
    have the same gradients
    <Katex
      math={"\\nabla_\\theta \\mathcal{L}_{CFM}(\\theta) = \\nabla_\\theta \\mathcal{L}_{FM}(\\theta)"}
    />
    , meaning we can optimize our tractable conditional flow matching objective and
    solve the flow matching problem. During training we simply need to draw pairs
    <Katex math={"(x_0, x_1)"} />
    from our source and target distributions, interpolate between them to get
    <Katex math={"x_t"} />, and then train our velocity field <Katex
      math={"v_t^\\theta(x_t)"}
    /> to predict the straight-line velocity <Katex math={"x_1 - x_0"} />.
  </p>

  {#if showOtherFigures}
    <ConditionalFlowMatching
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      backgroundVisible={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 8:</span>
        <strong>
          Conditional flow matching trains a <span style="color: #22c55e;"
            >learned velocity field</span
          >
          to match the
          <span style="color: #f17720;">conditional velocity</span>
          <Katex math={"v_t(x_t|x_1)"} color="#f17720" />.
        </strong>
        Because the learned velocity field is not conditioned on the target point
        it must infer the likely destination using only the current location <Katex
          math={"x_t"}
        />. This leads to a certain amount of
        <span style="color: #ef4444;">error</span>
        between the true and predicted velocities, which flow matching minimizes.
      </div>
    </ConditionalFlowMatching>
  {/if}

  <p>
    A critical fact that is worth emphasizing, is that we are matching the
    conditional velocity
    <Katex math={"v_t(x_t|x_1)"} /> which is conditioned on the target point <Katex
      math={"x_1"}
    />
    with our learned velocity field <Katex math={"v_t^\\theta(x_t)"} /> which
    <strong>only "knows" about the current <Katex math={"x_t"} /></strong>. If
    we were to condition our learned vector field on <Katex math={"x_1"} />
    as well, then the problem would become trivial as the model could just predict
    some scaled version of <Katex math={"x_1 - x_t"} />. So, the model <Katex
      math={"v_t^\\theta(x_t)"}
    />
    has to identify the likely destination <Katex math={"x_1"} /> using only the
    information about the location <Katex math={"x_t"} /> at time <Katex
      math={"t"}
    />.
  </p>

  <h1 id="the-problem" class="section-heading">The Problem</h1>

  <p>
    With the fundamentals of flow models and flow matching established, we can
    now investigate some of their idiosyncrasies—and how they come up in
    practice. We showed above that the trajectories produced by a flow model
    trained with flow matching are curved (see <a
      href="#figure-2"
      class="internal-link">Figure 2</a
    >). To further illustrate this point, if we superimpose the source and
    target distributions we can see that this curvature is even more extreme
    (see
    <a href="#figure-9" class="internal-link">Figure 9</a>).
  </p>

  <div id="figure-9">
    <CurvedTrajectorySuperimposed
      trajectories={$flowMatchingGridTrajectories}
      sourceDistribution={$sourceDistributionSamples}
      targetDistribution={$targetDistributionSamples}
      playingByDefault={true}
      backgroundVisible={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 9:</span>
        <strong
          >A flow matching model produces curved sampling <span
            style="color: #f17720;">trajectories</span
          >.</strong
        >
        This curvature is even more apparent when we superimpose the trajectories
        and the <span style="color: #3b82f6;">target distribution</span>. Tap
        <img
          src="{base}/icons/tap.svg"
          alt="tap"
          style="width: 28px; height: 28px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
        /> to generate a sample.
      </div>
    </CurvedTrajectorySuperimposed>
  </div>

  <p>
    An astute reader might recall that we trained our velocity field <Katex
      math={"v_t^\\theta(x)"}
    /> to match straight trajectories <Katex math={"X_1 - X_0"} /> due to our choice
    of a linear path. So why does our model then learn curved trajectories, and why
    is this an issue? Answering the latter question—why curvature is a problem—is
    more straightforward: the answer is speed.
  </p>

  <h2 id="curvature">Curvature is the Enemy of Speed</h2>

  <p>
    When drawing new samples from a flow model we perform numerical integration
    using the trained velocity field <Katex math={"v_t^\\theta(x_t)"} />. At
    their core, numerical integration algorithms like Euler's method involve
    making finite steps in the direction of the velocity field: <Katex
      math={"x_{t + \\Delta t} = x_t + \\Delta t \\cdot v_t^\\theta(x_t)"}
    />. We are making local linear approximations of the "true trajectories".
    The degree to which this approximation is accurate depends on how curved the
    trajectories are, and the size of steps we can take without deviating from
    the true trajectory, degrading sample quality.
  </p>

  {#if showOtherFigures}
    <EulerSamplerFigure width={figureWidth} backgroundVisible={false}>
      <div class="caption">
        <span class="figure-number">Figure 10:</span>
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
    these trajectories, leading to high latency and computational cost.
    <strong
      >But why does our model learn these curved trajectories in the first
      place?</strong
    >
    The answer has to do with how our source and target random variables are jointly
    distributed, a concept called a <em>coupling</em>.
  </p>

  <h2 id="problem-coupling">What is a Coupling?</h2>
  <p>
    When training our velocity field <Katex math={"v_t^\\theta(x)"} /> with flow
    matching, we need to draw pairs <Katex math={"(x_0, x_1)"} /> from our source
    and target distributions <Katex math={"p_0"} /> and <Katex math={"q"} />.
    Something that we glossed over a bit in the section about
    <a href="#flow-matching" class="internal-link">Flow Matching</a>
    is how exactly we should draw these pairs. This is actually a crucial design
    choice, called a <em>coupling</em>, that has a significant impact on the
    geometry of the learned flow, and is the key culprit behind our curved
    trajectories.
  </p>
  <p>
    A coupling is the joint distribution <Katex math={"\\pi(x_0, x_1)"} /> between
    our source and target random variables. This coupling dictates how our pairs
    <Katex math={"(x_0, x_1)"} /> used during training are distributed. The key requirement
    of a coupling is that the marginals are the source <Katex
      math={"\\pi(x_0) = p"}
    /> and target distributions
    <Katex math={"\\pi(x_1) = q"} />.
  </p>
  <p>
    The simplest form of coupling, and the one we investigate in this article,
    is an independent coupling (see <a href="#figure-11" class="internal-link"
      >Figure 11</a
    >), where we independently draw <Katex math={"X_0 \\sim p"} /> and <Katex
      math={"X_1 \\sim q"}
    />, and we have that <Katex math={"\\pi(x_0, x_1) = \\pi(x_0)\\pi(x_1)"} />.
    This allows us to trivially construct pairs <Katex math={"(x_0, x_1)"} /> during
    training, and is a natural choice in scenarios where we don't have any known
    structure associating pairs from our source and target distributions.
  </p>
  <p>
    As mentioned above, our choice of independent coupling is the key culprit
    behind our curved trajectories. You can see in
    <a href="#figure-11" class="internal-link">Figure 11</a> that the lines
    connecting independently drawn source and target points cross each other a
    lot. These intersections lead to curved trajectories because they introduce
    branches in our paths that our learned velocity field <Katex
      math={"v_t^\\theta(x)"}
    /> can not resolve.
  </p>

  {#if showOtherFigures}
    <div id="figure-11">
      <IndependentCoupling
        width={figureWidth}
        sourceDistributionSamples={$sourceDistributionSamples}
        targetDistributionSamples={$targetDistributionSamples}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 11:</span>
          Visualization of an independent coupling connecting random source points
          to random target points.
        </div>
      </IndependentCoupling>
    </div>
  {/if}

  <h2 id="paths-crossing">Paths Crossed at the Wrong Time</h2>

  <p>
    Our learned flow model <Katex math={"v_t^\\theta(x)"} /> is not capable of accurately
    modeling the crossing paths produced by our independent coupling; this incapability
    manifests itself in curved trajectories. More precisely, say two paths formed
    by the pairs <Katex math={"(x_0^a, x_1^a)"} /> and <Katex
      math={"(x_0^b, x_1^b)"}
    /> intersect at some point <Katex math="x" /> at time <Katex math="t" />, or
    at least nearly intersect. This results in two distinct velocities
    <Katex math={"x_1^a - x_0^a"} /> and <Katex math={"x_1^b - x_0^b"} /> that our
    learned velocity field <Katex math={"v_t^\\theta(x)"} /> is supposed to match
    at the same location <Katex math="x" /> and time <Katex math="t" />.
    <strong>
      This is not possible because our learned velocity field <Katex
        math={"v_t^\\theta(x)"}
      /> is only a function of the current location <Katex math="x" /> and time <Katex
        math="t"
      />.</strong
    >
  </p>

  {#if showOtherFigures}
    <IntersectingPaths
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      backgroundVisible={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 12:</span>
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
    Our learned velocity field <Katex math={"v_t^\\theta(x)"} /> cannot accurately
    predict both desired velocities at this intersection point, and so it ends up
    predicting the average of these two velocities. This is also true more generally,
    whenever we have many paths intersecting in a small neighborhood. Our learned
    velocity field averages out the conflicting velocities by taking the conditional
    expectation of velocities passing through this point: <Katex
      math={"\\mathbb{E}[X_1 - X_0 | X_t = x]"}
    />.
    <strong>
      Finally, because the average velocity at these intersection points can
      change as we move through space, we develop curved trajectories.</strong
    >
    So, despite the fact that we train our flow model to match straight-line velocities,
    we end up with curved trajectories.
  </p>
  <h1 id="rectified-flows" class="section-heading">Rectified Flows</h1>
  <p>
    We have discussed why curved trajectories are difficult to simulate with a
    small number of steps, and now we also understand why a flow model learns
    curved trajectories when using an independent coupling. Now we ask the
    question: how can we learn straighter trajectories? A solution to this
    problem is exactly what Rectified Flows provide us with, and given all of
    the context above it is actually a startlingly simple solution laying in
    plain sight.
  </p>

  <h2 id="algorithm">The Algorithm</h2>

  <p>
    Rectified flows straighten out the trajectories of flows by replacing the
    naive independent <em>coupling</em> used in vanilla flow-matching training
    with one induced by the model itself. First, we train a model with flow
    matching using an independent coupling. Next, we generate new pairs <Katex
      math={"(X_0, X_1^1)"}
    /> by drawing <Katex math={"X_0 \\sim p"} /> and applying our learned flow model
    to get <Katex math={"X_1^1 = \\psi_1^1(X_0)"} />. This new coupling <Katex
      math={"\\pi_1 = (X_0, X_1^1)"}
    /> is then used to retrain a new flow model
    <Katex math={"v_\\theta^2"} />. By repeating this process multiple times we
    can progressively straighten out the trajectories of our flow model. The
    full procedure is outlined in the
    <a href="#algorithm-1" class="internal-link">algorithm below</a>.
  </p>
  <div id="algorithm-1">
    <ReflowAlgorithm backgroundVisible={true}>
      <div class="caption">
        <span class="figure-number">Algorithm 1:</span>
        The Reflow procedure iteratively straightens trajectories by retraining on
        the coupling induced by the previous model.
      </div>
    </ReflowAlgorithm>
  </div>

  <h2 id="why-reflow-works">Why it Works</h2>
  <p>
    We draw samples from our trained flow model by solving an ordinary
    differential equation of the form
  </p>
  <Katex
    math={"\\frac{d}{dt} \\psi_t(x) = v_t(x), \\text{ } \\psi_0(x) = x."}
    displayMode={true}
  />
  <p>
    This forms a deterministic flow, where it is guaranteed that trajectories
    <Katex math={"\\psi_t(x)"} /> are unique (under some mild regularity conditions).
    This uniqueness property is crucial to understanding why rectified flows work.
    The uniqueness of trajectories in deterministic flows means that two distinct
    trajectories cannot intersect at the same point in space and time
    <Katex math={"(x,t)"} />. If this did happen, then the two trajectories
    would have to coincide for all times, contradicting the assumption that they
    are distinct. Deterministic flows therefore forbid crossing, branching, or
    merging of trajectories. The deterministic nature of these flows is
    inherited by the coupling induced by integrating the flow.
  </p>
  <p>
    When we generate new pairs <Katex math={"(X_0, X_1^k)"} /> by flowing samples
    from our source distribution through our learned flow model, we are guaranteed
    to get a coupling where trajectories do not intersect. By retraining on this
    coupling, we are effectively removing the conflicting velocities at intersection
    points that caused curvature in the first place. As we repeat this process, the
    trajectories become progressively straighter.
  </p>
  {#if showOtherFigures}
    <div id="figure-13">
      <InducedCouplingDouble
        allRectifiedTrajectories={$rectifiedFlowData?.allRectifiedTrajectories ??
          []}
        targetDistribution={$targetDistributionSamples}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 13:</span>
          Comparison of independent coupling (left) vs induced coupling from the
          flow model (right). The induced coupling connects each source point to
          where it actually flows, resulting in less tangled paths.
        </div>
      </InducedCouplingDouble>
    </div>
  {/if}
  <h2 id="comparisons">Comparisons</h2>
  <p>
    We can also compare the trajectories learned by a standard flow matching
    model versus a rectified flow model (see
    <a href="#figure-14" class="internal-link">Figure 14</a>
    ). The rectified flow model learns significantly straighter trajectories, which
    are easier to simulate with fewer steps.
  </p>
  {#if showOtherFigures}
    <div id="figure-14">
      <RectifiedFlowSuperimposed
        width={figureWidth}
        leftTrajectories={$flowMatchingGridTrajectories ?? []}
        rightTrajectories={$rectifiedFlowGridTrajectories?.[
          $rectifiedFlowGridTrajectories.length - 1
        ] ?? []}
        targetDistribution={$targetDistributionSamples}
        playingByDefault={true}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 14:</span>
          <strong>
            A rectified flow model learns straighter <span
              style="color: #f17720;">sampling paths</span
            > than a standard flow matching model, enabling faster simulation.
          </strong>
          Both models are trained to generate samples from the same
          <span style="color: #3b82f6;">target distribution</span>. The
          rectified flow's straighter paths allow for accurate numerical
          integration with fewer steps, reducing the computational cost of
          simulation and lowering latency. Tap
          <img
            src="{base}/icons/tap.svg"
            alt="tap"
            style="width: 28px; height: 28px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
          /> to generate a sample.
        </div>
      </RectifiedFlowSuperimposed>
    </div>
  {/if}
  <p>
    This difference in curvature has a direct impact on how many steps are
    needed during sampling. We can observe this effect by comparing how well
    Euler's method approximates the "ground truth" trajectory (using many steps)
    with varying numbers of integration steps (see
    <a href="#figure-15" class="internal-link">Figure 15</a>
    ). Notice how the rectified flow model produces accurate approximations even
    with very few steps, while the flow matching model's curved trajectories
    lead to significant deviation from the true path.
  </p>
  {#if showOtherFigures}
    <div id="figure-15">
      <EulerStepComparison
        targetDistribution={$targetDistributionSamples}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 15:</span>
          <strong>
            Rectified flow enables accurate sampling with fewer Euler steps.
          </strong>
          The <span style="color: #888888;">gray trajectory</span> shows the ground
          truth (512 steps), while the <span style="color: #f17720;">orange trajectory</span>
          shows the approximation using the selected number of steps. With curved
          paths, few-step approximations deviate significantly from the true path.
          With straight paths, even a single step can produce accurate results.
          Tap <img
            src="{base}/icons/tap.svg"
            alt="tap"
            style="width: 28px; height: 28px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
          /> to select a new starting point.
        </div>
      </EulerStepComparison>
    </div>
  {/if}
  <p>
    Finally, we can compare the vector fields learned by a standard flow
    matching model versus a rectified flow model (see
    <a href="#figure-16" class="internal-link">Figure 16</a>
    ). The rectified flow model learns vector field that is more consistent over
    time, meaning the model has lower curvature in its trajectories.
  </p>
  {#if showOtherFigures}
    <div id="figure-16">
      <VectorFieldCurvatureComparison
        flowMatchingVectorField={$vectorFieldData}
        rectifiedFlowVectorField={$rectifiedFlowVectorFieldData}
        playingByDefault={true}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 16:</span>
          The curvature of a flow matching model can be seen through its rapidly
          changing vector field. In contrast, a rectified flow model learns a more
          consistent vector field over time, indicating straighter trajectories.
        </div>
      </VectorFieldCurvatureComparison>
    </div>
  {/if}
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
