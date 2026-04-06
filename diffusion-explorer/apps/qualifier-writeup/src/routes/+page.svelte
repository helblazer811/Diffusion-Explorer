<script lang="ts">
  import { onMount, tick } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import {
    FlowModelClient,
    clipSamplesToRadius,
    clipTrajectoriesToStartingRadius,
  } from "@diffusion-explorer/diffusion";
  import {
    settings,
    type VectorFieldData,
    type RectifiedFlowData,
    type OTCouplingData,
  } from "$lib/settings";
  import * as sample from "$lib/flow_matching/sample";
  import {
    loadBibliography,
    collectCitations,
    type BibEntry,
    type CitationInfo,
  } from "@diffusion-explorer/ui";

  import IndependentCoupling from "$lib/figures/IndependentCoupling.svelte";
  import OTCoupling from "$lib/figures/OTCoupling.svelte";
  import ProbabilityPath from "$lib/figures/ProbabilityPath.svelte";
  import HighlightTrajectory from "$lib/figures/HighlightTrajectory.svelte";
  import CurvedTrajectoryIntro from "$lib/figures/CurvedTrajectoryIntro.svelte";
  import EulerSamplerFigure from "$lib/figures/EulerSamplerFigure.svelte";
  import EulerStepDemo from "$lib/figures/EulerStepDemo.svelte";
  import RectifiedFlowSuperimposed from "$lib/figures/RectifiedFlowSuperimposed.svelte";
  import CrownJewel from "$lib/figures/CrownJewel.svelte";
  import LinearInterpolation from "$lib/figures/LinearInterpolation.svelte";
  import IntersectingPaths from "$lib/figures/IntersectingPaths.svelte";
  import InducedCouplingAnimated from "$lib/figures/InducedCouplingAnimated.svelte";
  import VectorFieldCurvatureComparison from "$lib/figures/VectorFieldCurvatureComparison.svelte";
  import ConditionalVelocityField from "$lib/figures/ConditionalVelocityField.svelte";
  import ConditionalFlowMatching from "$lib/figures/ConditionalFlowMatching.svelte";
  import CurvedTrajectorySuperimposed from "$lib/figures/CurvedTrajectorySuperimposed.svelte";
  import ReflowAlgorithm from "$lib/figures/ReflowAlgorithm.svelte";
  import EulerStepComparison from "$lib/figures/EulerStepComparison.svelte";
  // Cross-app imports from qualifier-slides (normalizing flows figures)
  import NormalizingFlowStages from "$qualifier-slides/figures/NormalizingFlowStages.svelte";
  import ChangeOfVariables from "$qualifier-slides/figures/ChangeOfVariables.svelte";
  import MaxLikelihoodTraining from "$qualifier-slides/figures/MaxLikelihoodTraining.svelte";
  import FlowInvertibilitySimple from "$qualifier-slides/figures/FlowInvertibilitySimple.svelte";
  import DataLikelihood from "$qualifier-slides/figures/DataLikelihood.svelte";
  import ChangeOfVariablesIntro from "$qualifier-slides/figures/ChangeOfVariablesIntro.svelte";
  import StochasticInterpolation from "$qualifier-slides/figures/StochasticInterpolation.svelte";
  import { Bibliography, HoverableReference, Katex, ArticleHeader } from "@diffusion-explorer/ui";
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

  // OT coupling data store
  const otCouplingData: Writable<OTCouplingData | null> = writable(null);

  // Defer other figures until first frame renders
  let showOtherFigures = false;

  // Figure width (shared across all figures)
  const figureWidth = settings.stylingSettings.global.figureWidth;

  // Bibliography state
  let bibEntries: Map<string, BibEntry> | null = null;
  let citations: CitationInfo[] = [];

  // Shared FlowModelClient instances (created in onMount with correct base path)
  // These are passed as props to components that need them for interactive sampling
  let flowMatchingClient: FlowModelClient | null = null;
  let rectifiedFlowClient: FlowModelClient | null = null;

  // ========== WRAPPER FUNCTIONS ==========

  async function loadTargetDistribution() {
    try {
      const samples = await sample.loadTargetDistribution(
        `${base}/${settings.targetDistributionPointsPath}`,
        settings.samplingSettings.numSamples
      );
      if (samples) {
        targetDistributionSamples.set(samples);
        return true;
      }
      console.error(`Failed to load target distribution from ${settings.targetDistributionPointsPath}`);
      return false;
    } catch (error) {
      console.error(`Error loading target distribution:`, error);
      return false;
    }
  }

  async function loadCachedTrajectories(path: string) {
    try {
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
      console.error(`Failed to load cached trajectories from ${path}`);
      return false;
    } catch (error) {
      console.error(`Error loading cached trajectories from ${path}:`, error);
      return false;
    }
  }

  async function loadCachedVectorField(path: string) {
    try {
      const result = await sample.loadCachedVectorField(path);
      if (result) {
        vectorFieldData.set(result);
        return true;
      }
      console.error(`Failed to load cached vector field from ${path}`);
      return false;
    } catch (error) {
      console.error(`Error loading cached vector field from ${path}:`, error);
      return false;
    }
  }

  async function loadCachedRectifiedFlowTrajectories(path: string) {
    try {
      const result = await sample.loadCachedRectifiedFlowTrajectories(path);
      if (result) {
        rectifiedFlowData.set(result);
        return true;
      }
      console.error(`Failed to load cached rectified flow trajectories from ${path}`);
      return false;
    } catch (error) {
      console.error(`Error loading cached rectified flow trajectories from ${path}:`, error);
      return false;
    }
  }

  async function loadCachedGridTrajectories(
    path: string,
    isRectifiedFlow: boolean
  ) {
    try {
      if (isRectifiedFlow) {
        // Rectified flow grid is stored in RectifiedFlowData format: { allRectifiedTrajectories, modelPath }
        const rfResult = await sample.loadCachedRectifiedFlowTrajectories(path);
        if (rfResult) {
          rectifiedFlowGridTrajectories.set(rfResult.allRectifiedTrajectories);
          return true;
        }
        console.error(`Failed to load rectified flow grid trajectories from ${path}`);
        return false;
      } else {
        // Flow matching grid is stored as raw array format
        const result = await sample.loadCachedTrajectories(path);
        if (result) {
          flowMatchingGridTrajectories.set(result.trajectories);
          return true;
        }
        console.error(`Failed to load flow matching grid trajectories from ${path}`);
        return false;
      }
    } catch (error) {
      console.error(`Error loading grid trajectories from ${path}:`, error);
      return false;
    }
  }

  async function loadCachedRectifiedFlowVectorField(path: string) {
    try {
      const result = await sample.loadCachedVectorField(path);
      if (result) {
        rectifiedFlowVectorFieldData.set(result);
        return true;
      }
      console.error(`Failed to load cached rectified flow vector field from ${path}`);
      return false;
    } catch (error) {
      console.error(`Error loading cached rectified flow vector field from ${path}:`, error);
      return false;
    }
  }

  async function loadCachedOTCoupling(path: string) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        console.error(`Failed to load OT coupling from ${path}: ${response.status}`);
        return false;
      }
      const data: OTCouplingData = await response.json();
      otCouplingData.set(data);
      return true;
    } catch (error) {
      console.error(`Error loading OT coupling from ${path}:`, error);
      return false;
    }
  }


  // ========== LIFECYCLE ==========

  onMount(async () => {
    // Create shared FlowModelClient instances with correctly prefixed paths
    // These are passed as props to components that need them for interactive sampling
    flowMatchingClient = new FlowModelClient(
      `${base}${settings.flowModelWorkerUrl}`,
      `${base}${settings.flowMatchingModelPath}`,
      "Flow Matching",
      { dim: settings.modelSettings.dim, hidden: settings.modelSettings.hidden },
      settings.modelSettings.domainRange
    );
    rectifiedFlowClient = new FlowModelClient(
      `${base}${settings.flowModelWorkerUrl}`,
      `${base}${settings.rectifiedFlowModelPath}`,
      "Flow Matching",
      { dim: settings.modelSettings.dim, hidden: settings.modelSettings.hidden },
      settings.modelSettings.domainRange
    );

    // Load target distribution first
    await loadTargetDistribution();

    // Load cached resources (if paths are configured)
    if (settings.cachedFlowMatchingTrajectoriesPath) {
      await loadCachedTrajectories(`${base}/${settings.cachedFlowMatchingTrajectoriesPath}`);
    }

    if (settings.cachedFlowMatchingVectorFieldPath) {
      await loadCachedVectorField(`${base}/${settings.cachedFlowMatchingVectorFieldPath}`);
    }

    if (settings.cachedFlowMatchingGridTrajectoriesPath) {
      await loadCachedGridTrajectories(`${base}/${settings.cachedFlowMatchingGridTrajectoriesPath}`, false);
    }

    if (settings.cachedRectifiedFlowTrajectoriesPath) {
      await loadCachedRectifiedFlowTrajectories(`${base}/${settings.cachedRectifiedFlowTrajectoriesPath}`);
    }

    if (settings.cachedRectifiedFlowGridTrajectoriesPath) {
      await loadCachedGridTrajectories(`${base}/${settings.cachedRectifiedFlowGridTrajectoriesPath}`, true);
    }

    if (settings.cachedRectifiedFlowVectorFieldPath) {
      await loadCachedRectifiedFlowVectorField(`${base}/${settings.cachedRectifiedFlowVectorFieldPath}`);
    }

    if (settings.cachedOTCouplingPath) {
      await loadCachedOTCoupling(`${base}/${settings.cachedOTCouplingPath}`);
    }

    // Load bibliography (citations will be collected after showOtherFigures becomes true)
    try {
      bibEntries = await loadBibliography(`${base}/bibliography.bib`);
      if (!bibEntries) {
        console.error('Failed to load bibliography from bibliography.bib');
      }
    } catch (error) {
      console.error('Error loading bibliography:', error);
    }

    // Note: Workers are now pooled and managed by FlowModelClient,
    // so no cleanup is needed here
  });

  // Recollect citations when showOtherFigures changes (ensures all HoverableReferences are in DOM)
  $: if (showOtherFigures && bibEntries) {
    tick().then(() => {
      citations = collectCitations();
    });
  }
</script>

<ArticleHeader
    title="A Visual Survey of Flow-Based Generative Models"
    author="Alec Helbling"
    authorLink="https://alechelbling.com"
    date="April 3, 2026"
  />

  <CrownJewel
    width={figureWidth}
    {flowMatchingClient}
    {rectifiedFlowClient}
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
        A rectified flow model (right) learns straighter <span style="color: #f17720;"
          >sampling paths</span
        > than a standard flow matching model (left), enabling faster simulation.
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
    enables training without computationally expensive
    simulation and allows the use of arbitrary noise distributions. 
    However, a practical barrier to deploying flow models at scale
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
        {flowMatchingClient}
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

  <!-- ============================================================ -->
  <!-- SECTION 2: NORMALIZING FLOWS [NEW]                           -->
  <!-- ============================================================ -->
  <h1 id="normalizing-flows" class="section-heading">Normalizing Flows</h1>

  <h2 id="what-is-a-normalizing-flow">What is a Normalizing Flow?</h2>
  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    A normalizing flow
    <HoverableReference id="rezende2016variationalinferencenormalizingflows" {bibEntries} {citations} />
    is a generative model that transforms a simple probability distribution—one
    that is easy to sample from and evaluate, such as a multivariate Gaussian—into
    a complex target distribution through a sequence of invertible, differentiable
    transformations. Concretely, given a base random variable <Katex math={"z_0 \\sim p_0"} />
    drawn from a simple distribution <Katex math={"p_0"} />, we apply a chain of
    transformations <Katex math={"f_1, f_2, \\ldots, f_K"} /> to obtain
    <Katex math={"x = f_K \\circ \\cdots \\circ f_1(z_0)"} />.
  </p>
  <p>
    Each transformation <Katex math={"f_i"} /> must be invertible and differentiable,
    so that we can both generate new samples (by applying the transformations forward)
    and compute the likelihood of observed data (by inverting the transformations to
    map data back to the base distribution). The name "normalizing flow" reflects the
    idea that the sequence of transformations "flows" samples from a simple ("normal")
    distribution toward the complex data distribution.
  </p>

  {#if showOtherFigures}
    <div id="figure-3">
      <NormalizingFlowStages
        width={figureWidth}
        numStages={4}
        showLabels={true}
      />
      <div class="caption">
        <span class="figure-number">Figure 3:</span>
        A normalizing flow applies a sequence of invertible transformations to
        transform a simple source distribution into a complex target distribution.
      </div>
    </div>
  {/if}

  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    A crucial requirement of normalizing flows is that each transformation
    <Katex math={"f_i"} /> be:
  </p>
  <ol>
    <li>
      <strong>Invertible.</strong> Invertibility ensures that probability
      mass is conserved—no mass is created or destroyed as we transform our
      distribution. Every point in the source distribution maps to exactly one point
      in the target distribution, and vice versa. This bijective property is what
      allows us to precisely track how probability density changes as we apply the
      flow.
    </li>
    <li>
      <strong>Differentiable.</strong> Differentiability enables us to compute how much the
      transformation locally stretches or compresses space. This local volume change,
      captured by the Jacobian determinant, is the key ingredient for computing
      likelihoods under the transformed distribution.
    </li>
  </ol>

  {#if showOtherFigures}
    <div id="figure-4">
      <FlowInvertibilitySimple
        width={figureWidth}
        height={400}
        {allTimeSamples}
        numLines={5}
        distributionScaleFactor={1.3}
        labelFontSize={24}
        lineWidth={3}
        pointRadius={3}
        arrowHeadRadius={7}
        marginTop={0}
      >
        <div class="caption">
          <span class="figure-number">Figure 4:</span>
          A normalizing flow maps all points to distinct locations, ensuring that
          probability mass is conserved through the transformation. The invertibility
          of the flow means that we can always map back from the target distribution
          to the source distribution.
        </div>
      </FlowInvertibilitySimple>
    </div>
  {/if}

  <h2 id="evaluating-data-likelihood">Evaluating the Data Likelihood</h2>
  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    A central advantage of normalizing flows over many other generative models is
    their ability to compute exact likelihoods. Evaluating the density of a point
    under a simple distribution like a Gaussian is straightforward—we have a
    closed-form expression. But evaluating the density under a complex data
    distribution is not so easy. Normalizing flows solve this problem by providing
    a principled way to relate the density of a data point <Katex math={"x"} />
    under the complex distribution to the density of its preimage
    <Katex math={"z = f^{-1}(x)"} /> under the simple base distribution, using
    the change of variables formula.
  </p>

  {#if showOtherFigures}
    <div id="figure-5">
      <DataLikelihood
        width={figureWidth}
        height={400}
        {allTimeSamples}
        distributionScaleFactor={1.0}
      />
      <div class="caption">
        <span class="figure-number">Figure 5:</span>
        It is easy to evaluate the density for a <span style="color: #4594e3;">simple distribution</span>,
        but not straightforward for a <span style="color: #f17720;">complex distribution</span>.
        Normalizing flows provide a way to compute the density of a data point under the complex
        distribution by mapping it back to the simple distribution.
      </div>
    </div>
  {/if}

  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    <strong>The Change of Variables Formula.</strong> The change of variables formula provides the mathematical link between the
    density of the base distribution and the density of the transformed
    distribution. For an invertible transformation <Katex math={"f"} /> that maps
    <Katex math={"z"} /> to <Katex math={"x = f(z)"} />, the density of
    <Katex math={"x"} /> is given by:
  </p>
  <Katex
    math={"p(x) = p(z) \\left| \\det \\frac{\\partial f}{\\partial z} \\right|^{-1}"}
    displayMode={true}
  />
  <p>
    The term <Katex math={"\\left| \\det \\frac{\\partial f}{\\partial z} \\right|"} />
    is the absolute value of the determinant of the Jacobian matrix of <Katex math={"f"} />.
    It measures how much the transformation locally stretches or compresses volume.
    When the transformation expands a region of space, the density must decrease
    proportionally (and vice versa) so that the total probability mass is conserved.
  </p>

  {#if showOtherFigures}
    <div id="figure-6">
      <ChangeOfVariables
        width={figureWidth}
        height={350}
      />
      <div class="caption">
        <span class="figure-number">Figure 6:</span>
        The change of variables formula tracks how probability density changes
        through an invertible transformation using the Jacobian determinant.
      </div>
    </div>
  {/if}

  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    <strong>Jacobian Measures Local Volume Change.</strong> To build further intuition for the change of variables formula, we can
    visualize what the Jacobian determinant is actually measuring. The determinant
    of the Jacobian <Katex math={"\\left| \\det \\frac{\\partial f}{\\partial z} \\right|"} />
    captures the local volume change induced by the transformation <Katex math={"f"} />.
    Imagine a small region of space around a point <Katex math={"z"} />—the Jacobian
    tells us how much this region is stretched, compressed, or rotated as it is
    mapped to the region around <Katex math={"f(z)"} />. If the determinant is
    greater than one, the transformation is locally expanding space (and the density
    decreases). If it is less than one, space is being compressed (and the density
    increases).
  </p>

  {#if showOtherFigures}
    <div id="figure-7">
      <ChangeOfVariablesIntro
        width={figureWidth}
        height={400}
        {allTimeSamples}
        numFrames={5}
        distributionScaleFactor={1.0}
      />
      <div class="caption">
        <span class="figure-number">Figure 7:</span>
        The determinant of the Jacobian
        <Katex math={"\\left| \\det \\frac{\\partial f}{\\partial z} \\right|"} />
        measures how the transformation <Katex math={"f"} /> locally stretches and
        compresses space, providing geometric intuition for the change of variables formula.
      </div>
    </div>
  {/if}

  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    <strong>Composing Multiple Transformations.</strong> In practice, a single transformation is rarely expressive enough to bridge the
    gap between a simple base distribution and a complex data distribution. Instead,
    normalizing flows compose multiple transformations
    <Katex math={"f_1, f_2, \\ldots, f_K"} />, each contributing a small change.
    The change of variables formula extends naturally to compositions—the
    log-likelihood under the full flow is the log-likelihood under the base
    distribution plus the sum of log-determinants at each stage:
  </p>
  <Katex
    math={"\\log p(x) = \\log p(z_0) + \\sum_{i=0}^{K-1} \\log \\left| \\det \\frac{\\partial f_i}{\\partial z_i} \\right|"}
    displayMode={true}
  />

  {#if showOtherFigures}
    <div id="figure-8">
      <NormalizingFlowStages
        width={figureWidth}
        numStages={4}
        showLabels={true}
        static={true}
      />
      <div class="caption">
        <span class="figure-number">Figure 8:</span>
        Composing multiple invertible transformations. The log-likelihood of a data
        point is computed by accumulating the log-determinant of the Jacobian at each
        stage of the flow.
      </div>
    </div>
  {/if}

  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    <strong>Computing the Likelihood of Data.</strong> To compute the likelihood of an observed data point <Katex math={"x"} />, we
    map it backward through the inverse transformations
    <Katex math={"f_K^{-1}, \\ldots, f_1^{-1}"} /> to recover its representation
    in the base space. At each step, we accumulate the log-determinant of the
    Jacobian of the inverse transformation. This gives us the log-likelihood of the
    data point:
  </p>
  <Katex
    math={"\\log p(x) = \\log p(z_0) + \\sum_{i=0}^{K-1} \\log \\left| \\det \\frac{\\partial f_i^{-1}}{\\partial z_{i+1}} \\right|"}
    displayMode={true}
  />

  {#if showOtherFigures}
    <div id="figure-9">
      <MaxLikelihoodTraining
        width={figureWidth}
        height={350}
        reversed={true}
        highlightPointIndices={[15]}
        highlightColor="#3b82f6"
      />
      <div class="caption">
        <span class="figure-number">Figure 9:</span>
        To compute the likelihood of a <span style="color: #3b82f6;">data point</span>,
        we map it backward through the inverse transformations, accumulating the
        log-determinant of the Jacobian at each stage.
      </div>
    </div>
  {/if}

  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    <strong>Maximum Likelihood Training.</strong> With the ability to compute exact log-likelihoods, we can train normalizing flows
    by maximizing the log-likelihood of observed data. Given a dataset
    <Katex math={"\\mathcal{D}"} />, we optimize the parameters <Katex math={"\\theta"} />
    of our flow transformations to maximize:
  </p>
  <Katex
    math={"f_{1,\\theta}^*, \\ldots, f_{K,\\theta}^* = \\arg\\max_\\theta \\sum_{x \\in \\mathcal{D}} \\log p_\\theta(x)"}
    displayMode={true}
  />
  <p>
    For each data point, we invert the flow, evaluate the base distribution density,
    and accumulate the log-determinant corrections. This provides an exact gradient
    signal for training, in contrast to models that rely on approximate inference.
  </p>

  {#if showOtherFigures}
    <div id="figure-10">
      <MaxLikelihoodTraining
        width={figureWidth}
        height={350}
      />
      <div class="caption">
        <span class="figure-number">Figure 10:</span>
        Maximum likelihood training learns flow transformations that maximize the
        log-likelihood of the observed data by propagating data points backward
        through the inverse flow.
      </div>
    </div>
  {/if}

  <h2 id="jacobian-expensive">Jacobian Determinants Are Expensive</h2>
  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    While normalizing flows provide an elegant framework for exact likelihood
    computation, there is a major practical obstacle: computing the determinant of
    the Jacobian matrix is expensive. For a transformation in <Katex math={"d"} />
    dimensions, computing the full Jacobian determinant requires
    <Katex math={"O(d^3)"} /> operations in general:
  </p>
  <Katex
    math={"\\log p(x) = \\log p(z_0) + \\sum_{i=1}^{K} \\log \\left| {\\color{#e74c3c} \\det \\dfrac{\\partial f_i}{\\partial z_{i-1}}} \\right|"}
    displayMode={true}
  />
  <p>
    This cubic cost is prohibitive for high-dimensional data like images, where
    <Katex math={"d"} /> can be in the tens of thousands or more. A substantial body
    of work has addressed this by restricting the form of the transformations
    <Katex math={"f_i"} /> to make the Jacobian determinant cheaper to compute—for
    example, planar flows, Real NVP, and Glow use architectures with triangular
    Jacobians, reducing the determinant to a product of diagonal entries. However,
    these restrictions limit the expressiveness of the flow. An alternative approach,
    which we discuss next, is to move to a continuous-time formulation that avoids
    the Jacobian determinant entirely.
  </p>

  <!-- ============================================================ -->
  <!-- SECTION 3: CONTINUOUS NORMALIZING FLOWS [NEW]                -->
  <!-- ============================================================ -->
  <h1 id="continuous-normalizing-flows" class="section-heading">Continuous Normalizing Flows</h1>

  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    Rather than composing a fixed number of discrete transformations, continuous
    normalizing flows (CNFs) (Chen et al., 2018)
    replace the sequence of layers with a single continuous-time ordinary
    differential equation (ODE) parameterized by a neural network. Instead of
    applying <Katex math={"K"} /> separate transformations, we define a smooth
    trajectory through the space of probability distributions.
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
    <a href="#figure-11" class="internal-link">Figure 11</a>). We index this path
    by a time variable <Katex math={"t \\in [0, 1]"} />, where
    <Katex math={"t=0"} /> corresponds to the source distribution and <Katex
      math={"t=1"}
    /> corresponds to the target distribution. By drawing samples from <Katex
      math={"p_0"}
    /> and transforming them over time we can produce samples
    distributed according to our data distribution <Katex math={"p_1 = q"} />.
  </p>

  {#if showOtherFigures}
    <div id="figure-11">
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
          <span class="figure-number">Figure 11:</span>
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

  <h2 id="sampling-trajectories">Sampling Trajectories From a CNF</h2>
  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    Individual samples drawn from the source distribution <Katex math={"p_0"} />
    have trajectories <Katex math={"x(t)"} /> that trace a path from
    <Katex math={"x_0 \\sim p_0"} /> to <Katex math={"x_1 \\sim p_1"} /> as
    time progresses from <Katex math={"t=0"} /> to <Katex math={"t=1"} />.
    These trajectories are the paths that individual "particles" take as the
    continuous normalizing flow transforms the source distribution into the target
    distribution. Understanding these trajectories is important because the
    geometry of these paths—how straight or curved they are—will turn out to have
    significant implications for the efficiency of sampling.
  </p>

  {#if showOtherFigures}
    <div id="figure-12">
      <HighlightTrajectory
        width={figureWidth}
        {flowMatchingClient}
        sourceDistributionSamples={$sourceDistributionSamples}
        targetDistributionSamples={$targetDistributionSamples}
        allTimeSamples={$allTimeSamples}
        isTraining={$isTraining}
      >
        <div class="caption">
          <span class="figure-number">Figure 12:</span>
          A single <span style="color: #f17720;">sample trajectory</span>
          <Katex math={"\\psi_t(x)"} color="#f17720" /> showing how an individual point
          <Katex math={"x"} color="#f17720" />
          moves from the source distribution to the target distribution.
          Tap
          <img
            src="{base}/icons/tap.svg"
            alt="tap"
            style="width: 28px; height: 28px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
          /> to generate a sample.
        </div>
      </HighlightTrajectory>
    </div>
  {/if}

  <h2 id="velocity-fields">CNFs Learn Velocity Fields</h2>
  <p>
    Rather than directly modeling the flow
    <Katex math={"\\psi_t(x)"} />, continuous normalizing flows model a
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
  <p>
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
    <EulerStepDemo
      {flowMatchingClient}
      targetDistribution={$targetDistributionSamples}
      flowMatchingVectorField={$vectorFieldData}
      backgroundVisible={false}
      maxUserTrajectories={1}
      showGroundTruth={false}
      showLegend={false}
      showArrowHeads={true}
    >
      <div class="caption">
        <span class="figure-number">Figure 13:</span>
        <strong> Euler integration through a time-dependent <span style="color: #3b82f6;">velocity field</span> <Katex math={"v_t(x)"} />. </strong>
        The <span style="color: #f17720;">Euler approximation</span> takes
        16 discrete steps along the direction of the <span style="color: #3b82f6;">velocity field</span>. Tap
        <img
          src="{base}/icons/tap.svg"
          alt="tap"
          style="width: 28px; height: 28px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
        /> to generate a sample.
      </div>
    </EulerStepDemo>
  {/if}

  <h2 id="training-efficiency">Training Efficiency</h2>
  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    A key advantage of the continuous-time formulation is that it enables more
    efficient likelihood computation. Recall that discrete normalizing flows
    require computing the full Jacobian determinant at each layer, which costs
    <Katex math={"O(d^3)"} />. In the continuous setting, the instantaneous change
    of variables formula replaces the expensive determinant with a much cheaper
    <span style="color: #22c55e;">trace</span>:
  </p>
  <Katex
    math={"\\log p_1(x_1) = \\log p_0(x_0) - \\int_0^1 {\\color{#22c55e} \\operatorname{tr}\\!\\left(\\dfrac{\\partial v_\\theta}{\\partial x}\\right)} \\, dt"}
    displayMode={true}
  />
  <p>
    The trace of the Jacobian is only <Katex math={"O(d)"} />, a dramatic
    improvement over the <Katex math={"O(d^3)"} /> cost of the full determinant.
    This makes CNFs practical for higher-dimensional data where discrete
    normalizing flows with unrestricted architectures would be computationally
    prohibitive.
  </p>
  <p>
    Despite this efficiency gain, likelihood-based training of
    CNFs still has a significant drawback: it requires solving an ODE at
    <em>every training step</em>. To compute the log-likelihood of a data point, we
    must integrate the trace of the Jacobian along the entire trajectory from
    <Katex math={"t=0"} /> to <Katex math={"t=1"} />, which
    <span style="color: #e74c3c;">requires solving the ODE for each training example</span>.
    This simulation is computationally expensive and becomes a bottleneck during training.
  </p>
  <Katex
    math={"\\log p_1(x_1) = \\log p_0(x_0) - {\\color{#e74c3c} \\int_0^1 \\operatorname{tr}\\!\\left(\\frac{\\partial v_t}{\\partial x}\\right) \\, dt}"}
    displayMode={true}
  />

  {#if showOtherFigures}
    <div id="figure-14">
      <HighlightTrajectory
        width={figureWidth}
        {flowMatchingClient}
        sourceDistributionSamples={$sourceDistributionSamples}
        targetDistributionSamples={$targetDistributionSamples}
        allTimeSamples={$allTimeSamples}
        isTraining={$isTraining}
        reverse={true}
      >
        <div class="caption">
          <span class="figure-number">Figure 14:</span>
          Likelihood-based training of CNFs requires solving the ODE at every training
          step—tracing each <span style="color: #f17720;">trajectory</span> from the
          target distribution back to the source distribution to compute the
          log-likelihood. This expense motivates simulation-free training methods
          like flow matching.
        </div>
      </HighlightTrajectory>
    </div>
  {/if}

  <!-- ============================================================ -->
  <!-- SECTION 4: FLOW MATCHING [EXISTING - was section 2.2]        -->
  <!-- ============================================================ -->
  <h1 id="flow-matching" class="section-heading">Flow Matching</h1>
  <p>
    Now that we have discussed the foundations of normalizing flows and continuous
    normalizing flows, we can discuss flow matching—a simulation-free training
    method that avoids the expensive ODE solving required by likelihood-based
    training. Please check out
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

  <h2 id="probability-path">Defining the Probability Path</h2>
  <p>
    We will focus on a
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
        <span class="figure-number">Figure 15:</span>
        Linear interpolation between a source point <Katex math={"x_0"} /> and target
        point <Katex math={"x_1"} />, producing the interpolated sample <Katex
          math={"x_t"}
        /> at time <Katex math="t" />.
      </div>
    </LinearInterpolation>
  {/if}

  <h2 id="regressing-velocity-field">Regressing the Velocity Field</h2>
  <p>
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
        <span class="figure-number">Figure 16:</span>
        The conditional velocity field <Katex math={"v_t(x|x_1)"} /> for a specific
        target point <Katex math={"x_1"} /> can be represented by a bunch of straight arrows pointing
        from the source distribution points to the target point.
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
        <span class="figure-number">Figure 17:</span>
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

  <h2 id="stochastic-interpolants">Stochastic Interpolants</h2>
  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    Stochastic interpolants
    <HoverableReference id="albergo2023" {bibEntries} {citations} />
    generalize the flow matching framework by adding controlled noise to the
    interpolation path. Rather than following a purely deterministic linear path
    between source and target, stochastic interpolants introduce a noise term
    <Katex math={"\\sigma_t \\cdot \\varepsilon"} /> where
    <Katex math={"\\varepsilon \\sim \\mathcal{N}(0, I)"} />:
  </p>
  <Katex
    math={"X_t = (1-t)X_0 + tX_1 + \\sigma_t \\cdot \\varepsilon, \\quad \\varepsilon \\sim \\mathcal{N}(0, I)"}
    displayMode={true}
  />
  <p>
    The noise schedule <Katex math={"\\sigma_t"} /> controls how much stochasticity
    is introduced at each time step. When <Katex math={"\\sigma_t = 0"} /> for all
    <Katex math={"t"} />, we recover the deterministic flow matching setting.
    When <Katex math={"\\sigma_t > 0"} />, the interpolant becomes stochastic,
    bridging the gap between deterministic flow models and stochastic diffusion
    models. This unifying perspective reveals that many seemingly different
    generative modeling approaches are special cases of a single framework.
  </p>

  {#if showOtherFigures}
    <div id="figure-18">
      <StochasticInterpolation
        width={figureWidth}
        height={450}
        sourceDistributionSamples={$sourceDistributionSamples}
        targetDistributionSamples={$targetDistributionSamples}
        sourcePointIndex={5}
        targetPointIndex={10}
        sigma={300}
        maxEpsilonNorm={1.5}
        playingByDefault={true}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 18:</span>
          <strong>Stochastic interpolants</strong> add noise to the deterministic
          <span style="color: #3b82f6;">linear path</span>, producing
          <span style="color: #f17720;">stochastic trajectories</span> that spread
          around the deterministic path. The amount of noise is controlled by the
          schedule <Katex math={"\\sigma_t"} />.
        </div>
      </StochasticInterpolation>
    </div>
  {/if}

  <p style="color: red; font-style: italic;">[Draft content — to be revised]</p>
  <p>
    <strong>Two Frameworks, One Idea.</strong> Remarkably, the flow matching framework
    <HoverableReference id="lipman2022" {bibEntries} {citations} />
    and the stochastic interpolants framework
    <HoverableReference id="albergo2023" {bibEntries} {citations} />
    were developed independently and in parallel, arriving at the same core insight:
    that one can train continuous normalizing flows by regressing onto conditional
    velocity fields without simulation. Despite different mathematical
    formulations and notation, both frameworks provide simulation-free training
    objectives that are equivalent under appropriate choices of interpolation
    schedules.
  </p>

  <h1 id="curvature-speed" class="section-heading">Curvature is the Enemy of Speed</h1>

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
    <a href="#figure-19" class="internal-link">Figure 19</a>).
  </p>

  <div id="figure-19">
    <CurvedTrajectorySuperimposed
      {flowMatchingClient}
      trajectories={$flowMatchingGridTrajectories}
      sourceDistribution={$sourceDistributionSamples}
      targetDistribution={$targetDistributionSamples}
      playingByDefault={true}
      backgroundVisible={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 19:</span>
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
        <span class="figure-number">Figure 20:</span>
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
    is an independent coupling (see <a href="#figure-21" class="internal-link"
      >Figure 21</a
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
    <a href="#figure-21" class="internal-link">Figure 21</a> that the lines
    connecting independently drawn source and target points cross each other a
    lot. These intersections lead to curved trajectories because they introduce
    branches in our paths that our learned velocity field <Katex
      math={"v_t^\\theta(x)"}
    /> can not resolve.
  </p>

  {#if showOtherFigures}
    <div id="figure-21">
      <IndependentCoupling
        width={figureWidth}
        sourceDistributionSamples={$sourceDistributionSamples}
        targetDistributionSamples={$targetDistributionSamples}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 21:</span>
          Visualization of an independent coupling connecting random source points
          to random target points.
        </div>
      </IndependentCoupling>
    </div>
  {/if}

  <p>
    An alternative to the independent coupling is an
    <em>optimal transport coupling</em>
    (see <a href="#figure-22" class="internal-link">Figure 22</a>), which
    connects source and target points in a way that minimizes the overall cost
    of transporting mass from the source to the target distribution. This
    coupling tends to produce fewer crossing paths, which leads to straighter
    trajectories. However, optimal transport couplings are more challenging to
    compute, especially in high dimensions, and so they are less commonly used
    in practice.
  </p>

  {#if showOtherFigures && $otCouplingData}
    <div id="figure-22">
      <OTCoupling
        width={figureWidth}
        sourceDistributionSamples={$otCouplingData.sourcePoints}
        targetDistributionSamples={$otCouplingData.targetPoints}
        matching={$otCouplingData.matching}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 22:</span>
          Visualization of an <strong>optimal transport coupling</strong> computed via Sinkhorn algorithm.
          Unlike the independent coupling, the OT coupling minimizes transport cost, resulting in
          less tangled paths with fewer crossings.
        </div>
      </OTCoupling>
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
    <div id="figure-23">
      <IntersectingPaths
        width={figureWidth}
        height={400}
        sourceCenterX={0.25}
        targetCenterX={0.75}
        latexFontSize={20}
        sourceDistributionSamples={$sourceDistributionSamples}
        targetDistributionSamples={$targetDistributionSamples}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 23:</span>
          Two pairs <Katex math={"(x_0^a, x_1^a)"} /> and <Katex
            math={"(x_0^b, x_1^b)"}
          /> that intersect at a point <Katex math="x" /> at time <Katex
            math="t"
          />. The velocity field <Katex math={"v_t^\\theta(x)"} /> cannot accurately
          predict both conflicting velocities—the best it can do is predict the conditional
          expectation (green arrow).
        </div>
      </IntersectingPaths>
    </div>
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
    points that caused curvature in the first place. 
  </p>
  {#if showOtherFigures}
    <div id="figure-24">
      <InducedCouplingAnimated
        width={figureWidth}
        targetDistribution={$targetDistributionSamples}
        {flowMatchingClient}
        numSteps={settings.samplingSettings.numSteps}
        numPoints={100}
        numLinesToDraw={100}
        numTrajectoriesToShow={30}
      >
        <div class="caption">
          <span class="figure-number">Figure 24:</span>
          <strong>The coupling induced by the flow model produces less tangled paths.</strong>
          We start out with a naive independent coupling, where paths cross each other frequently. 
          If we produce an induced coupling by flowing source points through the learned flow model, we get a coupling with
          significantly fewer intersections. 
        </div>
      </InducedCouplingAnimated>
    </div>
  {/if}
  <h2 id="comparisons">Comparisons</h2>
  <p>
    We can also compare the trajectories learned by a standard flow matching
    model versus a rectified flow model (see
    <a href="#figure-25" class="internal-link">Figure 25</a>
    ). The rectified flow model learns significantly straighter trajectories, which
    are easier to simulate with fewer steps.
  </p>
  {#if showOtherFigures}
    <div id="figure-25">
      <RectifiedFlowSuperimposed
        width={figureWidth}
        {flowMatchingClient}
        {rectifiedFlowClient}
        leftTrajectories={$flowMatchingGridTrajectories ?? []}
        rightTrajectories={$rectifiedFlowGridTrajectories?.[$rectifiedFlowGridTrajectories.length - 1]
          ? clipTrajectoriesToStartingRadius(
              $rectifiedFlowGridTrajectories[$rectifiedFlowGridTrajectories.length - 1],
              2.5
            )
          : []}
        targetDistribution={$targetDistributionSamples}
        playingByDefault={true}
        backgroundVisible={false}
      >
        <div class="caption">
          <span class="figure-number">Figure 25:</span>
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
    <a href="#figure-26" class="internal-link">Figure 26</a>
    ). Notice how the rectified flow model produces accurate approximations even
    with very few steps, while the flow matching model's curved trajectories
    lead to significant deviation from the true path.
  </p>
  {#if showOtherFigures}
    <div id="figure-26">
      <EulerStepComparison
        {flowMatchingClient}
        {rectifiedFlowClient}
        targetDistribution={$targetDistributionSamples}
        backgroundVisible={false}
        maxUserTrajectories={1}
      >
        <div class="caption">
          <span class="figure-number">Figure 26:</span>
          <strong>
            The straight trajectories of rectified flows enable accurate simulation with fewer Euler steps.
          </strong>
          We compare the <span style="color: #f17720;">Euler approximations</span> of a flow matching model (left) and a rectified flow model (right) using varying numbers of steps.
          We can see that the rectified flow's straighter trajectories allow for accurate approximations even with very few steps, leading to 
          compared to the <span style="color: #22c55e;">ground truth</span> leading to lower <span style="color: #dc2626;">error</span>.
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
    <a href="#figure-27" class="internal-link">Figure 27</a>
    ). The rectified flow model learns vector field that is more consistent over
    time, meaning the model has lower curvature in its trajectories.
  </p>
  {#if showOtherFigures}
    <div id="figure-27">
      <VectorFieldCurvatureComparison
        flowMatchingVectorField={$vectorFieldData}
        rectifiedFlowVectorField={$rectifiedFlowVectorFieldData}
        playingByDefault={true}
        backgroundVisible={false}
        normalizeVectors={false}
        showArrowHeads={true}
        animationDuration={4000}
      >
        <div class="caption">
          <span class="figure-number">Figure 27:</span>
          The curvature of a flow matching model can be seen through its rapidly
          changing vector field. In contrast, a rectified flow model learns a more
          consistent vector field over time, indicating straighter trajectories.
        </div>
      </VectorFieldCurvatureComparison>
    </div>
  {/if}
  <h1 id="acknowledgements" class="section-heading">Acknowledgements</h1>
  <p>I'd like to acknowledge my friend <a href="https://sebasguthdz.github.io/">Sebastián Gutiérrez Hernández</a> for his valuable feedback on this project, particularly on the 
    formal explanations presented in this article. I would also like to thank <a href="https://bhoov.com/">Benjamin Hoover</a>, <a href="https://poloclub.github.io/">Polo Chau</a>, and <a href="https://the-vivek.netlify.app/">Vivek Anand</a> for their 
    feedback on the visualizations and writing. 
  </p>

  <h1 id="references" class="section-heading">References</h1>
  <Bibliography {citations} {bibEntries} />

<h1 id="cite" class="section-heading">How to Cite</h1>
<div class="cite-section">
  <p>If you found this explainer helpful, please consider citing it:</p>
  <pre><code
      >@article{"{"}helbling2026flowsurvey,
title = {"{"}A Visual Survey of Flow-Based Generative Models{"}"},
author = {"{"}Helbling, Alec{"}"},
year = {"{"}2026{"}"},
url = {"{"}https://alechelbling.com/qualifier-writeup{"}"}
{"}"}</code
    ></pre>
</div>
