<script lang="ts">
  import { onMount } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import { downloadJSON } from "$lib/utils";
  import {
    settings,
    type VectorFieldData,
    type RectifiedFlowData,
  } from "$lib/settings";
  import * as trainAndSample from "$lib/train_and_sample";

  import IndependentCoupling from "$lib/figures/IndependentCoupling.svelte";
  import FlowModelIntro from "$lib/figures/FlowModelIntro.svelte";
  import CurvedTrajectoryIntro from "$lib/figures/CurvedTrajectoryIntro.svelte";
  import EulerSamplerFigure from "$lib/figures/EulerSamplerFigure.svelte";
  import VectorFieldDouble from "$lib/figures/VectorFieldDouble.svelte";
  import RectifiedFlowVisualization from "$lib/figures/RectifiedFlowVisualization.svelte";
  import RectifiedFlowSuperimposed from "$lib/figures/RectifiedFlowSuperimposed.svelte";
  import LinearInterpolation from "$lib/figures/LinearInterpolation.svelte";
  import { Katex } from "@diffusion-explorer/ui";

  // ========== DATA MANAGEMENT STATE ==========

  // Data stores (shared by both components)
  const sourceDistributionSamples: Writable<number[][]> = writable([]);
  const targetDistributionSamples: Writable<number[][]> = writable([]);
  const allTimeSamples: Writable<number[][][]> = writable([]);
  const isTraining: Writable<boolean> = writable(false);

  // Vector field data store
  const vectorFieldData: Writable<VectorFieldData | null> = writable(null);

  // Rectified flow data store
  const rectifiedFlowData: Writable<RectifiedFlowData | null> = writable(null);

  // Worker references
  let trainingWorker: Worker | null = null;
  let rectifiedTrainingWorker: Worker | null = null;

  // Defer other figures until first frame renders
  let showOtherFigures = false;

  // ========== WRAPPER FUNCTIONS ==========

  async function loadTargetDistribution() {
    const samples = await trainAndSample.loadTargetDistribution(
      settings.targetDistributionPointsPath,
      settings.numSamples
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
      sourceDistributionSamples.set(result.sourceDistribution);
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

  async function trainModel() {
    const result = await trainAndSample.trainModel(
      settings.trainingObjective,
      settings.training,
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
      settings.numSamples,
      settings.numSteps,
      settings.trainingObjective,
      settings.training,
      settings.samplingWorkerUrl
    );
    allTimeSamples.set(result.allTimeSamples);
    sourceDistributionSamples.set(result.sourceDistribution);
    downloadTrajectories();
    return result.allTimeSamples;
  }

  async function generateVectorField(modelPath: string) {
    const result = await trainAndSample.generateVectorField(
      modelPath,
      settings.vectorFieldGridResolution,
      settings.vectorFieldTimeSteps,
      settings.trainingObjective,
      settings.training,
      settings.samplingWorkerUrl
    );
    vectorFieldData.set(result);
    downloadVectorField();
  }

  async function trainRectifiedFlow() {
    const result = await trainAndSample.trainRectifiedFlow(
      settings.trainingObjective,
      settings.training,
      settings.rectifiedFlowConfig,
      settings.trainWorkerUrl
    );
    rectifiedTrainingWorker = result.worker;
    rectifiedFlowData.set(result.data);
    downloadRectifiedFlowData();
    return result.data.modelPath;
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

  // ========== LIFECYCLE ==========

  onMount(async () => {
    // Load target distribution first
    await loadTargetDistribution();

    // Try to load each cached resource independently
    let trajectoriesLoaded = false;
    let vectorFieldLoaded = false;
    let rectifiedFlowLoaded = false;

    if (settings.cachedTrajectoriesPath) {
      trajectoriesLoaded = await loadCachedTrajectories(
        settings.cachedTrajectoriesPath
      );
    }

    if (settings.cachedVectorFieldPath) {
      vectorFieldLoaded = await loadCachedVectorField(
        settings.cachedVectorFieldPath
      );
    }

    if (settings.cachedRectifiedFlowTrajectoriesPath) {
      rectifiedFlowLoaded = await loadCachedRectifiedFlowTrajectories(
        settings.cachedRectifiedFlowTrajectoriesPath
      );
    }

    // Train and generate any missing data
    let modelPath: string | null = null;

    if (!trajectoriesLoaded) {
      console.log("Training new model...");
      modelPath = await trainModel();
      await generateSamples(modelPath);
    }

    if (!vectorFieldLoaded) {
      if (!modelPath) {
        console.log("Training model for vector field generation...");
        modelPath = await trainModel();
      }
      await generateVectorField(modelPath);
    }

    if (!rectifiedFlowLoaded) {
      console.log("Training rectified flow...");
      await trainRectifiedFlow();
    }

    return () => {
      if (trainingWorker) trainingWorker.terminate();
      if (rectifiedTrainingWorker) rectifiedTrainingWorker.terminate();
    };
  });
</script>

<div class="page-container">
  <div class="title-header-wrapper">
    <h1 class="article-title">A Visual Explanation of Rectified Flows</h1>
    <div class="byline-dateline-container">
      <h3 class="byline">
        By <a href="https://alechelbling.com">Alec Helbling</a>
      </h3>
      <h3 class="dateline">December 24, 2025</h3>
    </div>
  </div>

  <RectifiedFlowSuperimposed
    allRectifiedTrajectories={$rectifiedFlowData?.allRectifiedTrajectories ?? []}
    targetDistribution={$targetDistributionSamples}
    playingByDefault={true}
    onInitialized={() => {
      showOtherFigures = true;
      console.log("RectifiedFlowSuperimposed initialized, showing other figures.");
    }}
  >
    <div class="caption">
      <span class="figure-number">Figure 1:</span>
      A rectified flow learns straighter paths. Left: Before rectification - curved trajectories. Right: After rectification - straighter trajectories superimposed on target distribution.
    </div>
  </RectifiedFlowSuperimposed>

  <hr />

  <RectifiedFlowVisualization
    allRectifiedTrajectories={$rectifiedFlowData?.allRectifiedTrajectories ?? []}
    targetDistribution={$targetDistributionSamples}
    playingByDefault={true}
  >
    <div class="caption">
      <span class="figure-number">Figure 2:</span>
      A rectified flow learns straighter paths. Left: Before rectification - curved trajectories. Right: After rectification - straighter trajectories superimposed on target distribution.
    </div>
  </RectifiedFlowVisualization>


  <!-- <RectifiedFlowVisualization
    allRectifiedTrajectories={$rectifiedFlowData?.allRectifiedTrajectories ??
      []}
    onInitialized={() => {
      showOtherFigures = true;
      console.log(
        "RectifiedFlowVisualization initialized, showing other figures."
      );
    }}
  >
    {#snippet caption()}
      <div class="caption">
        <span class="figure-number">Figure 1:</span>
        <strong
          >A rectified flow is a flow-based generative model that learns
          straighter paths.</strong
        >
        Watch how paths become straighter with each rectification step. Each step
        retrains the model using trajectories from the previous step, progressively
        reducing curvature.
      </div>
    {/snippet}
  </RectifiedFlowVisualization> -->
  <!-- 

  <h2>Typography</h2>
fl
  <p>This is a paragraph with the default paragraph styles. It has a font size of 1.2rem and line height of 1.6em.</p>

  <p>Here's some <code>inline code</code> with background styling.</p>

  <h2>Inline Math</h2>

  <p>
    This paragraph demonstrates inline math equations. For example, the equation <Katex math="E = mc^2" /> .
  </p>

  <h2>Links</h2>

  <p>
    <a href="#normal">Normal link</a> |
    <a href="#visited" style="color: rgb(0, 80, 160);">Visited link (simulated)</a>
  </p>

  <h2>Form Elements</h2>

  <label>Text Input:</label>
  <input type="text" placeholder="Type something..." />

  <label>Disabled Input:</label>
  <input type="text" disabled value="Disabled input" />

  <label>Range Input:</label>
  <input type="range" min="0" max="100" value="50" />

  <label>Select Dropdown:</label>
  <select>
    <option>Option 1</option>
    <option>Option 2</option>
    <option>Option 3</option>
  </select>

  <label>Textarea:</label>
  <textarea rows="3" placeholder="Enter multiple lines..."></textarea>

  <h2>Buttons</h2>

  <button>Normal Button</button>
  <button>Click and hold to see active state</button>

  <h2>Special Classes</h2>

  <p><span class="figure-number">Figure 1:</span> This demonstrates the figure-number class with bold font weight.</p>

  <div class="acknowledgements">
    <p>This paragraph is inside the acknowledgements div, with smaller font size (1rem) and line height (1.4rem).</p>
  </div> -->

  <p>
    Recently developed flow-based generative models have led to state-of-the-art
    results in image and video generation. In particular, flow matching has
    enabled efficient, simulation-free training of continuous normalizing flows.
    However, a key barrier to deploying these methods at scale is their
    computational cost and inference latency. Generating a high-quality image
    with a flow-based model using a naive sampling strategy requires repeatedly
    evaluating a large neural network, often containing billions of parameters.
    This repeated application not only incurs a high computational cost but also
    leads to substantial latency, where it can take minutes before a user
    receives a generated image or video. As a result, it is highly desirable to
    develop methods that accelerate inference for flow-based models, allowing
    samples to be generated using only a small number of neural network
    evaluations.
  </p>

  <p>
    Training a model with flow matching alone is sufficient to generate
    high-quality samples from a target distribution. However, as illustrated in
    Figure X, the trajectories followed by individual samples during generation
    are often curved. This curvature poses a significant obstacle to fast
    sampling from flow-based models, since curved trajectories typically require
    many small integration steps to accurately simulate the underlying dynamics.
  </p>

  <h2>Brief Background on Flow Matching</h2>
  {#if showOtherFigures}
    <FlowModelIntro
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      {allTimeSamples}
      {isTraining}
      playingByDefault={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 2:</span>
        Flow matching model training and sampling visualization.
      </div>
    </FlowModelIntro>
  {/if}
  <p>
    To provide context, the broad goal of generative modeling is to draw samples
    from an unknown data distribution, such as the distribution of natural
    images. Given a finite dataset <Katex
      math={"\\mathcal{X} = \\{x_1, \\dots, x_n\\}"}
    />, where each <Katex math={"x_i \\in \\mathbb{R}^d"} /> is sampled from a target
    distribution <Katex math="q" />, the objective is to learn a model that can
    generate new samples from <Katex math="q" />. Directly modeling and sampling
    from <Katex math="q" /> is generally intractable, motivating the use of indirect
    approaches.
  </p>

  <p>
    Continuous normalizing flows address this challenge by modeling a path of
    probability distributions <Katex math={"(p_t)_{0 \\leq t \\leq 1}"} />,
    which smoothly interpolates between a simple source distribution <Katex
      math={"p_0"}
    /> at time <Katex math={"t = 0"} /> and the data distribution <Katex
      math={"p_1 = q"}
    /> at time <Katex math={"t = 1"} />. The source distribution <Katex
      math={"p_0"}
    /> is typically chosen to be easy to sample from, such as a multivariate Gaussian
    <Katex math={"p_0 = \\mathcal{N}(0, \\sigma^2 I)"} />. By sampling from <Katex
      math={"p_0"}
    /> and transforming these samples along the probability path, we can obtain samples
    distributed according to the target distribution <Katex math="q" />.
  </p>

  <p>
    A flow <Katex math={"\\psi_t(x)"} /> is a time-indexed mapping that defines trajectories
    of individual points through this probability path. When applied to samples <Katex
      math={"X_0 \\sim p_0"}
    />, the flow transports them to samples <Katex
      math={"X_1 \\sim p_1 = q"}
    />. At intermediate times, the transformed samples <Katex
      math={"X_t = \\psi_t(X_0)"}
    /> are distributed according to the corresponding distribution <Katex
      math={"p_t"}
    />. If we can successfully model this flow, then sampling from the
    generative model reduces to drawing samples from the simple source
    distribution and applying the learned transformation.
  </p>

  <p>
    Rather than modeling the flow <Katex math={"\\psi_t"} /> directly, flow-based
    generative models instead define the flow implicitly through a time-dependent
    velocity field <Katex math={"v(x, t) = v_t(x)"} />. This velocity field
    specifies the instantaneous velocity of a particle located at position <Katex
      math="x"
    /> at time <Katex math="t" />. The flow is then defined as the solution to
    an ordinary differential equation,
  </p>

  <div style="text-align: center; margin: 1.5rem 0;">
    <Katex
      math={"\\frac{d}{dt} \\psi_t(x) = v_t(x), \\quad \\psi_0(x) = x."}
      displayMode={true}
    />
  </div>

  <p>
    These equations state that the time derivative of the flow must match the
    velocity of the particle at each point in time, starting from its initial
    position at <Katex math={"t = 0"} />. Solving this ordinary differential
    equation yields the flow <Katex math={"\\psi_t(x)"} />, which transports
    samples from the source distribution to the target distribution. Sampling
    from a flow-based generative model therefore amounts to numerically
    simulating this differential equation, tracing each sample's trajectory from
    the source to the target distribution.
  </p>

  <h2>Visualizing Flow Matching</h2>
  <p></p>
  {#if showOtherFigures}
    <CurvedTrajectoryIntro
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      {allTimeSamples}
      {isTraining}
      playingByDefault={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 3:</span>
        Curved trajectories produced by flow matching visualization.
      </div>
    </CurvedTrajectoryIntro>
  {/if}
  <p></p>
  <h2>Curvature is the Enemy of Speed</h2>
  <p>
    Curved sampling trajectories are difficult to accurately simulate in a few
    steps.
  </p>

  {#if showOtherFigures}
    <EulerSamplerFigure>
      <div class="caption">
        <span class="figure-number">Figure 4:</span> Comparison of Euler method
        approximations for high-curvature (left) and low-curvature (right) functions.
        Ground truth shown in black, Euler approximation in orange.
      </div>
    </EulerSamplerFigure>
  {/if}

  <h2>The Limitations of an Independent Coupling</h2>
  <h3>What is a coupling?</h3>
  <p></p>

  {#if showOtherFigures}
    <IndependentCoupling>
      <div class="caption">
        <span class="figure-number">Figure 5:</span>
        Independent coupling visualization showing the source distribution.
      </div>
    </IndependentCoupling>
  {/if}

  {#if showOtherFigures}
    <LinearInterpolation
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      sourcePointIndex={5}
      targetPointIndex={10}
      playingByDefault={false}
    />
  {/if}

  <h2>Vector Field Visualization</h2>
  <p>
    Below we visualize the learned velocity field and how sample trajectories
    flow through it.
  </p>

  {#if showOtherFigures}
    <VectorFieldDouble
      vectorFieldData={$vectorFieldData}
      allTimeSamples={$allTimeSamples}
      playingByDefault={false}
    >
      <div class="caption">
        <span class="figure-number">Figure 6:</span>
        Left: Animated vector field showing the learned velocity at each point over time. Right: A sample trajectory (red) flowing through the vector field toward the target distribution (blue points).
      </div>
    </VectorFieldDouble>
  {/if}

  <h2>Acknowledgements</h2>
  <div class="acknowledgements">
    <p></p>
  </div>
  <!--
  <h2>Material Icons</h2>

  <p>
    <span class="material-icons">favorite</span>
    <span class="material-icons">home</span>
    <span class="material-icons">settings</span>
  </p> -->
</div>

<style>
  hr {
    border: none;
    border-top: 1px solid #e0e0e0;
  }
</style>
