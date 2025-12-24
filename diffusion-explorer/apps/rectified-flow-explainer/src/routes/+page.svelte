<script lang="ts">
  import { onMount, tick } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import { downloadJSON } from "$lib/utils";
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
  import FlowModelIntro from "$lib/figures/FlowModelIntro.svelte";
  import CurvedTrajectoryIntro from "$lib/figures/CurvedTrajectoryIntro.svelte";
  import EulerSamplerFigure from "$lib/figures/EulerSamplerFigure.svelte";
  import RectifiedFlowVisualization from "$lib/figures/RectifiedFlowVisualization.svelte";
  import RectifiedFlowSuperimposed from "$lib/figures/RectifiedFlowSuperimposed.svelte";
  import LinearInterpolation from "$lib/figures/LinearInterpolation.svelte";
  import IntersectingPaths from "$lib/figures/IntersectingPaths.svelte";
  import InducedCouplingDouble from "$lib/figures/InducedCouplingDouble.svelte";
  import TableOfContents from "$lib/components/TableOfContents.svelte";
  import Bibliography from "$lib/components/Bibliography.svelte";
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

  // Figure width (shared across all figures)
  const figureWidth = settings.globalStyling.figureWidth;

  // Bibliography state
  let bibEntries: Map<string, BibEntry> | null = null;
  let citations: CitationInfo[] = [];

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

<TableOfContents />

<div class="page-container">
  <div class="title-header-wrapper">
    <h1 class="article-title">A Visual Introduction to Rectified Flows</h1>
    <div class="byline-dateline-container">
      <h3 class="byline">
        By <a href="https://alechelbling.com">Alec Helbling</a>
      </h3>
      <h3 class="dateline">December 24, 2025</h3>
    </div>
  </div>

  <RectifiedFlowSuperimposed
    width={figureWidth}
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
      A rectified flow learns straighter paths. Left: Before rectification - curved trajectories. Right: After rectification - straighter trajectories.
    </div>
  </RectifiedFlowSuperimposed>

  <hr class="section-divider" />

  <h2 id="introduction" class="visually-hidden">Introduction</h2>
  <p>
    Recently developed flow-based generative models have led to state-of-the-art results in image and video generation. In particular, flow matching <span class="citation" data-cite="lipman2022"></span> has enabled efficient training of flow-based models without the need for computationally expensive simulation. However, naively generating a high-quality image with a flow model requires repeatedly running a large neural network—typically with billions of parameters—many times. This incurs both high computational cost and latency, where it can take minutes before a user is served a generated image or video. Thus, it is desirable to develop methods for accelerating inference of flow-based models, allowing us to sample from them with few repeated runs of a neural network.
  </p>

  <p>
    Training a model with flow matching alone is sufficient to generate high-quality samples from our target distribution. However, as we can see below, the trajectories of samples from a model trained with flow matching often produce curved paths. <strong>This curvature, its consequences, and how to mitigate them are the central focus of this article.</strong> In particular, we will discuss why trajectories generated by flow models have this curvature, why these trajectories are challenging to efficiently simulate, and how a simple approach called rectified flows <span class="citation" data-cite="liu2022"></span> can remove this curvature leading to straighter models that can be efficiently simulated.
  </p>

  {#if showOtherFigures}
    <CurvedTrajectoryIntro
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      {allTimeSamples}
      {isTraining}
      playingByDefault={true}
    >
      <div class="caption">
        <span class="figure-number">Figure 2:</span>
        The curved trajectories produced by a model trained with flow matching.
      </div>
    </CurvedTrajectoryIntro>
  {/if}

  <h2 id="background">Background</h2>

  <h3 id="flow-based-models">Flow-Based Generative Models</h3>

  <p>
    The broad goal of generative models is to draw samples from some complex distribution of data that we only have empirical observations from (e.g., natural images). Given a finite number of samples <Katex math={"\\mathcal{X} = \\{x_1, \\dots, x_n\\}"} /> where <Katex math={"x_i \\in \\mathbb{R}^d"} /> from a target distribution <Katex math="q" />, our goal is to learn a model that can generate new samples from <Katex math="q" />, which is quite challenging to do directly.
  </p>

  <p>
    A continuous normalizing flow models a <em>path of probability distributions</em> <Katex math={"(p_t)_{0 \\leq t \\leq 1}"} /> which are a continuous collection of probability distributions indexed by time <Katex math={"t \\in [0, 1]"} /> that bridge a simple source distribution <Katex math={"p_0"} /> at time <Katex math={"t=0"} /> to our data distribution <Katex math={"p_1 = q"} />. By drawing samples from our simple source distribution, often represented by an easy to sample from multivariate Gaussian <Katex math={"p_0 = \\mathcal{N}(0, \\sigma^2 I)"} />, and transforming them according to our probability path we can produce samples distributed according to our data distribution <Katex math={"p_1 = q"} />.
  </p>

  <p>
    A <em>flow</em> <Katex math={"\\psi_t(x)"} /> is a time-indexed mapping that specifies trajectories of points over time; when applied to our samples <Katex math={"X_0 \\sim p_0"} /> it transports them from the source distribution to the target distribution <Katex math={"X_1 \\sim p_1 = q"} />. The intermediate samples produced by our flow <Katex math={"X_t = \\psi_t(X_0)"} /> are distributed according to our probability path <Katex math={"X_t \\sim p_t"} />. If we can somehow learn to model this flow, then we can draw samples from our simple source distribution <Katex math={"p_0"} /> and transform them to realistic approximations of real world data with distribution <Katex math="q" />.
  </p>

  {#if showOtherFigures}
    <FlowModelIntro
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      {allTimeSamples}
      {isTraining}
      playingByDefault={true}
    >
      <div class="caption">
        <span class="figure-number">Figure 3:</span>
        The probability path <Katex math={"p_t"} /> of a continuous normalizing flow as it is transformed from a simple source distribution <Katex math={"p_0"} /> to a more complex data distribution <Katex math={"p_1 = q"} />. We can also see the trajectory of individual samples as they move from the source to target distribution.
      </div>
    </FlowModelIntro>
  {/if}

  <p>
    Instead of directly modeling our flow, say with a neural network, we instead <em>generate</em> it by modeling a velocity field <Katex math={"v_t(x)"} /> that tells us the velocity of a particle at location <Katex math="x" /> at time <Katex math="t" />. A flow is defined in relation to this velocity field through some simple ordinary differential equations:
  </p>

  <div style="text-align: center; margin: 1.5rem 0;">
    <Katex
      math={"\\frac{d}{dt} \\psi_t(x) = v_t(x), \\quad \\psi_0(x) = x."}
      displayMode={true}
    />
  </div>

  <p>
    These ordinary differential equations tell us that the derivative of our flow at time <Katex math="t" /> must match the velocity <Katex math={"v_t(x)"} /> of our particle <Katex math="x" /> at time <Katex math="t" /> and start from an initial location <Katex math="x" /> when <Katex math={"t=0"} />. The solution to these ordinary differential equations involving <Katex math={"v_t(x)"} /> is itself the flow <Katex math={"\\psi_t(x)"} />. Sampling from a flow-based generative model therefore amounts to numerically simulating this differential equation, tracing each sample's trajectory from the source to the target distribution.
  </p>

  <h3 id="flow-matching">Flow Matching</h3>

  <p>
    So, if we can learn an approximation <Katex math={"v_t^\\theta(x)"} />, parameterized by a neural network, of the velocity field <Katex math={"v_t(x)"} /> then we can construct our flow <Katex math={"\\psi_t(x)"} /> and draw new samples from our data distribution <Katex math="q" /> by simulating a solution to these ODEs. How can we learn this vector field <Katex math={"v_t^\\theta(x)"} />? A solution to this problem is exactly what flow matching provides us with.
  </p>

  <p>
    Flow matching can be broken down into two key steps: (1) we need to define our probability path <Katex math={"p_t(x)"} /> for interpolating between our source <Katex math="p" /> and target distribution <Katex math="q" />, and (2) we need to train a velocity field <Katex math={"v_t^\\theta(x)"} /> that generates the path <Katex math={"p_t"} /> through regression.
  </p>

  <p>
    For our first step, we need to design our probability path <Katex math={"p_t(x)"} />. For the duration of this article, we will specify our source distribution <Katex math={"p_0(x) = \\mathcal{N}(x|0, I)"} /> as a multivariate standard Gaussian distribution. We will then construct the path <Katex math={"p_t(x)"} /> as a mixture of conditional probability paths <Katex math={"p_{t|1}(x|x_1) = \\mathcal{N}(x|t x_1, (1-t)^2 I)"} /> where each is conditioned on data examples <Katex math={"x_1 \\sim q"} /> and has a Gaussian distribution. This is called the <em>linear path</em>, and it allows us to construct a random variable <Katex math={"X_t"} /> that is distributed according to our path <Katex math={"p_t"} /> through a simple linear interpolation between our source random variable <Katex math={"X_0 \\sim p_0"} /> and target random variable <Katex math={"X_1 \\sim q"} />:
  </p>

  <div style="text-align: center; margin: 1.5rem 0;">
    <Katex
      math={"X_t = (1-t)X_0 + tX_1 \\sim p_t"}
      displayMode={true}
    />
  </div>

  {#if showOtherFigures}
    <LinearInterpolation
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
      sourcePointIndex={5}
      targetPointIndex={10}
      playingByDefault={true}
    >
      <div class="caption">
        <span class="figure-number">Figure 4:</span>
        Linear interpolation between a source point <Katex math={"x_0"} /> and target point <Katex math={"x_1"} />, producing the interpolated sample <Katex math={"x_t"} /> at time <Katex math="t" />.
      </div>
    </LinearInterpolation>
  {/if}

  <p>
    Now, the second step of flow matching is to "match" the true velocity field <Katex math={"v_t(x)"} /> with an approximation <Katex math={"v_t^\\theta(x)"} />, parameterized by a neural network, by optimizing a simple regression objective. However, it's challenging to directly optimize this objective because <Katex math={"v_t(x)"} /> is difficult to directly construct in practice as it governs the transformations between two high dimensional distributions.
  </p>

  <p>
    Luckily, we can create a related but much simpler objective by conditioning our velocity field on a particular instance from our target distribution <Katex math={"x_1 \\sim q"} />. This yields the conditional velocity field <Katex math={"v_t(x | x_1) = \\frac{x_1 - x}{1 - t}"} />. With this we can create a regression objective called <em>conditional flow matching</em>. Incredibly, the conditional flow matching and the flow matching objectives have the same gradients, meaning we can optimize our tractable conditional flow matching objective and solve the flow matching problem.
  </p>

  <p>
    If we then plug in our specific conditional velocity field for our choice of a linear probability path, we get the remarkably simple training objective:
  </p>

  <div style="text-align: center; margin: 1.5rem 0;">
    <Katex
      math={"\\mathcal{L}_{CFM}(\\theta) = \\mathbb{E}_{t, X_0, X_1} ||(X_1 - X_0) - v_t^\\theta(X_t)||^2"}
      displayMode={true}
    />
  </div>

  <h2 id="curved-trajectories">The Problem: Curved Trajectories</h2>

  <p>
    With the fundamentals of flow models and flow matching established, we can now investigate some of their idiosyncrasies—and how they come up in practice. As shown above, a model trained with flow matching can learn to generate samples resembling our desired target distribution. However, you can see that the trajectories of these samples are curved.
  </p>

  <p>
    An astute reader might recall that we trained our velocity field <Katex math={"v_t^\\theta(x)"} /> to match straight trajectories <Katex math={"X_1 - X_0"} /> due to our choice of a linear path. So, why does our model then learn curved trajectories, and why is this an issue? Answering the latter question—why curvature is a problem—is more straightforward: the answer is speed.
  </p>

  <h2 id="curvature">Curvature is the Enemy of Speed</h2>

  <p>
    When drawing new samples from a flow model we perform numerical integration using the trained velocity field <Katex math={"v_t^\\theta(x)"} />. At its core, numerical integration algorithms like Euler's method involve making finite steps in the direction of the velocity field: <Katex math={"x_{i+1} = x_i + \\alpha \\cdot v_t^\\theta(x_i)"} />. We are making local linear approximations of the "true trajectories". The degree to which this approximation is accurate depends on how curved the trajectories are, and the size of steps we can take without deviating from the true trajectory and degrading our sample quality too much.
  </p>

  {#if showOtherFigures}
    <EulerSamplerFigure width={figureWidth}>
      <div class="caption">
        <span class="figure-number">Figure 5:</span>
        Comparison of Euler method approximations for high-curvature (left) and low-curvature (right) functions. Ground truth shown in black, Euler approximation in orange. Highly curved trajectories require many steps to simulate accurately.
      </div>
    </EulerSamplerFigure>
  {/if}

  <p>
    The punch line: curvature is the enemy of speed. Highly curved trajectories are challenging to accurately simulate with a small number of steps. This means we need to make many calls to our large neural network representing our vector field <Katex math={"v_t^\\theta(x)"} /> in order to accurately approximate these trajectories, leading to high latency and computational cost. However, as we can see above on the right, there is still hope. If our ground truth trajectories are approximately straight we can simulate them accurately with a small number of steps! <strong>So the question arises, how can we encourage our model to produce straighter paths?</strong> First, it is important to answer our question from earlier: why is our model learning curved trajectories in the first place? The answer lies in how our source <Katex math={"X_0"} /> and target random variables <Katex math={"X_1"} /> are jointly distributed, which is called their <em>coupling</em>.
  </p>

  <h2 id="coupling">The Problem with an Independent Coupling</h2>

  <h3 id="what-is-coupling">What is a coupling?</h3>

  <p>
    A coupling is what tells us how samples from our source distribution <Katex math={"p(x_0)"} /> are paired with samples in our target distribution <Katex math={"q(x_1)"} />. It is the joint distribution <Katex math={"\\pi(x_0, x_1)"} /> whose marginals are <Katex math={"p(x_0)"} /> and <Katex math={"q(x_1)"} /> respectively.
  </p>

  <p>
    In this article, we use an independent coupling where the joint distribution is defined as <Katex math={"\\pi(x_0, x_1) = p(x_0)q(x_1)"} /> which also means that we construct pairs <Katex math={"(x_0, x_1)"} /> by drawing independent samples <Katex math={"X_0 \\sim p"} /> and <Katex math={"X_1 \\sim q"} />. This choice makes sense for image data because we don't necessarily have some additional paired structure to define our joint distribution.
  </p>

  {#if showOtherFigures}
    <IndependentCoupling
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
    >
      <div class="caption">
        <span class="figure-number">Figure 6:</span>
        Visualization of an independent coupling connecting random source points to random target points.
      </div>
    </IndependentCoupling>
  {/if}

  <p>
    So, we created an independent coupling by pairing random source points <Katex math={"x_0 \\sim p"} /> and target points <Katex math={"x_1 \\sim q"} />. We can visualize these points with lines <Katex math={"x_1 - x_0"} />, which is exactly the velocities that we are going to target with our flow matching objective due to our choice of linear path. <strong>What you might notice about this visualization is that these lines cross each other a lot.</strong> This crossing of trajectories is at the core of why our learned velocity field <Katex math={"v_t^\\theta(x)"} /> learns curved trajectories despite the fact that it is being trained to model linear paths.
  </p>

  <p>
    The reason our trained velocity field <Katex math={"v_t^\\theta"} /> induces curved trajectories despite the fact it is regressing straight paths <Katex math={"X_1 - X_0"} /> is because at a given time <Katex math="t" /> our velocity field is only a function of the current <Katex math={"X_t"} />.
  </p>

  {#if showOtherFigures}
    <IntersectingPaths
      width={figureWidth}
      sourceDistributionSamples={$sourceDistributionSamples}
      targetDistributionSamples={$targetDistributionSamples}
    >
      <div class="caption">
        <span class="figure-number">Figure 7:</span>
        Two pairs <Katex math={"(x_0^a, x_1^a)"} /> and <Katex math={"(x_0^b, x_1^b)"} /> that intersect at a point <Katex math="x" /> at time <Katex math="t" />. The velocity field <Katex math={"v_t^\\theta(x)"} /> cannot accurately predict both conflicting velocities—the best it can do is predict the conditional expectation (green arrow).
      </div>
    </IntersectingPaths>
  {/if}

  <p>
    Above we can see a scenario where we have two pairs <Katex math={"(x_0^a, x_1^a)"} /> and <Katex math={"(x_0^b, x_1^b)"} /> that intersect at some point <Katex math="x" /> at a particular time <Katex math="t" />. Our velocity field <Katex math={"v_t^\\theta(x)"} /> which is a function of this <Katex math="x" /> has no way of accurately predicting the two conflicting velocities <Katex math={"x_1^a - x_0^a"} /> and <Katex math={"x_1^b - x_0^b"} />. It is not possible. The best it can do is predict the conditional expectation of velocities passing through <Katex math="x" />: <Katex math={"\\mathbb{E}[X_1 - X_0 | X_t = x]"} />. So our learned velocity field resolves <em>branches</em> in the probability path by averaging them out (shown in green).
  </p>

  <h2 id="rectified-flows">Rectified Flows</h2>

  {#if showOtherFigures}
    <InducedCouplingDouble
      allRectifiedTrajectories={$rectifiedFlowData?.allRectifiedTrajectories ?? []}
      targetDistribution={$targetDistributionSamples}
    >
      <div class="caption">
        <span class="figure-number">Figure 8:</span>
        Comparison of independent coupling (left) vs induced coupling from the flow model (right). The induced coupling connects each source point to where it actually flows, resulting in less tangled paths.
      </div>
    </InducedCouplingDouble>

    <RectifiedFlowVisualization
      width={figureWidth}
      allRectifiedTrajectories={$rectifiedFlowData?.allRectifiedTrajectories ?? []}
      targetDistribution={$targetDistributionSamples}
      playingByDefault={true}
    >
      <div class="caption">
        <span class="figure-number">Figure 9:</span>
        Watch how paths become straighter with each rectification step. Each step retrains the model using trajectories from the previous step, progressively reducing curvature.
      </div>
    </RectifiedFlowVisualization>
  {/if}

  <p>
    <strong>Finally, we will discuss how a simple technique called rectified flows can mitigate this curvature.</strong> Rectified flows aim to straighten out the trajectories of these flows. They do this by replacing the naive independent <em>coupling</em>—how data points <Katex math={"x_1"} /> and their noisy counterparts <Katex math={"x_0"} /> are paired—used in vanilla flow-matching training with one induced by the model itself. By recursively replacing the coupling with a straighter one, the model finally converges on generating straight paths.
  </p>

  <p>
    Why does the coupling induced by training a flow matching model work? If the velocity field is learning a curved trajectory for a particular sample, then it is "sacrificing" loss because a perfect model would have no curvature at all because it is regressing <Katex math={"X_1 - X_0"} />. The learned velocity field can't model crossing trajectories because it is conditioned only on the current <Katex math="x" />. So the tradeoff is that it tries to learn the direction that works well on average, meaning it can never achieve minimal loss with a tangled coupling.
  </p>

  <p>
    If a model is learning a high curvature trajectory then it really wants that sample's path to lead somewhere that is in conflict with its target destination for a given coupling, and is willing to trade off a significant amount of loss for the sake of modeling other samples. It is almost like these curved trajectory samples are outliers that the model is ignoring. By untangling the coupling you are allowing the model to resolve this conflict.
  </p>

  <h2 id="acknowledgements">Acknowledgements</h2>
  <div class="acknowledgements">
    <p></p>
  </div>

  <h2 id="references">References</h2>
  <Bibliography {citations} {bibEntries} />

  <h2 id="cite">How to Cite</h2>
  <div class="cite-section">
    <p>If you found this explainer helpful, please consider citing it:</p>
    <pre><code>@article{'{'}helbling2025rectifiedflows,
  title = {'{'}A Visual Introduction to Rectified Flows{'}'},
  author = {'{'}Helbling, Alec{'}'},
  year = {'{'}2025{'}'},
  url = {'{'}https://alechelbling.com/rectified-flows{'}'}
{'}'}</code></pre>
  </div>
</div>

<style>
  .section-divider {
    border: none;
    border-top: 1px solid rgba(0, 0, 0, 0.15);
    margin: 2rem 0;
  }
</style>
