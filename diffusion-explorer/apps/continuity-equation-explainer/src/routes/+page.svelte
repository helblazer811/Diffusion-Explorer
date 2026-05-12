<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { writable } from "svelte/store";
  import { base } from "$app/paths";
  import {
    ArticleHeader,
    Bibliography,
    HoverableReference,
    Katex,
    loadBibliography,
    collectCitations,
    type BibEntry,
    type CitationInfo,
  } from "@diffusion-explorer/ui";
  import { generateClippedGaussianSamples, clipSamplesToRadius, clipTrajectoriesToStartingRadius, loadCachedTrajectories, FlowModelClient } from "@diffusion-explorer/diffusion";
  import { settings, type VectorFieldData } from "$lib/settings";

  // Figure imports
  import { CrownJewel } from "$lib/figures/CrownJewel";
  import ProbabilityPathIntro from "$lib/figures/ProbabilityPathIntro.svelte";
  import EulerStepDemo from "$lib/figures/EulerStepDemo.svelte";
  import FlowInvertibility from "$lib/figures/FlowInvertibility.svelte";
  import InvertibilityExplanation from "$lib/figures/InvertibilityExplanation.svelte";
  import MassConservation from "$lib/figures/MassConservation.svelte";
  import ContinuityEquationFigure from "$lib/figures/ContinuityEquationFigure.svelte";
  import DivergenceIntro from "$lib/figures/DivergenceIntro.svelte";
  import DivergenceTheoremFigure from "$lib/figures/DivergenceTheoremFigure.svelte";
  import { createClosedCurve, createWavyVectorField } from "$lib/figures/DivergenceTheorem/divergence_theorem";
  import DivergenceTheorem from "$lib/figures/DivergenceTheorem/DivergenceTheorem.svelte";
  import ReverseSampling from "$lib/figures/ReverseSampling.svelte";
  import LikelihoodIntegration from "$lib/figures/LikelihoodIntegration.svelte";
  import Diffeomorphism from "$lib/figures/Diffeomorphism.svelte";
  import OneDimensionalLikelihoodComparison from "$lib/figures/OneDimensionalLikelihoodComparison.svelte";

  // Data for ProbabilityPathIntro figure
  let probabilityPathSourceSamples: number[][] = [];
  let probabilityPathTargetSamples: number[][] = [];
  const allTimeSamples = writable<number[][][]>([]);
  const isTraining = writable<boolean>(false);

  // Shared FlowModelClient for §1 figures + a vector field computed live from the same model
  // (so the field arrows align exactly with the trajectory motion).
  let flowMatchingClient: FlowModelClient | null = null;
  let flowMatchingVectorField: VectorFieldData | null = null;

  // 1D flow trajectories for the likelihood section figure
  let oneDimensionalFlowTrajectories: number[][][] = [];

  // Bibliography state
  let bibEntries: Map<string, BibEntry> | null = null;
  let citations: CitationInfo[] = [];

  // Data for FlowInvertibility figure
  let flowInvertibilityData: {
    allTrajectories: number[][][];
    highlightedIndices: number[];
    sourceDistribution: number[][];
    targetDistribution: number[][];
    config: { numSteps: number; gaussianStd: number; clipRadius: number };
  } | null = null;

  // Data for ReverseSampling
  let reverseSamplingData: {
    trajectories: number[][][];
    sourceDistribution: number[][];
    targetDistribution: number[][];
    config: { numSamples: number; numSteps: number };
  } | null = null;


  /**
   * Transpose trajectories from [sampleIndex][timeStep][x,y] to [timeStep][sampleIndex][x,y]
   * This converts from per-sample trajectories to per-timestep samples format
   */
  function transposeTrajectories(trajectories: number[][][]): number[][][] {
    if (!trajectories || trajectories.length === 0) return [];
    const numSamples: number = trajectories.length;
    const numSteps: number = trajectories[0].length;
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

  onMount(async () => {
    // Generate source distribution (Gaussian)
    const sourceDistribution = generateClippedGaussianSamples(300);

    // Load data for ProbabilityPathIntro (same cached samples as ProbabilityPath in rectified-flow-explainer)
    try {
      const [trajResult, targetRes] = await Promise.all([
        loadCachedTrajectories(`${base}/cached_samples/trajectories.json`),
        fetch(`${base}/data/smiley_face.json`),
      ]);

      if (trajResult) {
        allTimeSamples.set(trajResult.trajectories);
        probabilityPathSourceSamples = trajResult.trajectories[0] || [];
      }

      // Use ground truth target distribution (not synthetic trajectory endpoints)
      if (targetRes.ok) {
        const targetData: { points?: number[][] } = await targetRes.json();
        probabilityPathTargetSamples = targetData.points || [];
      }
    } catch (e: unknown) {
      console.warn("Failed to load ProbabilityPathIntro data:", e);
    }

    // Load target distribution and cached trajectories for FlowInvertibility
    try {
      const [targetRes, trajRes] = await Promise.all([
        fetch(`${base}/data/smiley_face.json`),
        fetch(`${base}/cached_samples/trajectories.json`),
      ]);

      if (targetRes.ok && trajRes.ok) {
        const targetData: { points: number[][] } = await targetRes.json();
        // trajectories.json is step-major: { "0": [[x,y], ...], "1": [...], ... }.
        // Transpose to trajectory-major so each entry is one full path.
        const stepMajor: Record<string, number[][]> = await trajRes.json();
        const stepKeys = Object.keys(stepMajor)
          .map((k) => parseInt(k, 10))
          .filter((k) => !isNaN(k))
          .sort((a, b) => a - b);
        const numTraj = stepMajor[String(stepKeys[0])].length;
        const allTrajectories: number[][][] = [];
        for (let i = 0; i < numTraj; i++) {
          const traj: number[][] = [];
          for (const step of stepKeys) {
            traj.push(stepMajor[String(step)][i]);
          }
          allTrajectories.push(traj);
        }

        flowInvertibilityData = {
          allTrajectories,
          highlightedIndices: [0, 1],
          sourceDistribution,
          targetDistribution: targetData.points,
          config: { numSteps: stepKeys.length - 1, gaussianStd: 1, clipRadius: 4 },
        };
      }
    } catch (e: unknown) {
      console.warn("Failed to load FlowInvertibility data:", e);
    }

    // Load data for ReverseSampling (reverse trajectories)
    // Use the normalized targetDistribution from trajectories.json (loaded above for flowInvertibilityData)
    // to ensure the rendered distribution matches what was used to compute the trajectories
    try {
      const trajRes = await fetch(`${base}/cached_samples/reverse_trajectories.json`);

      if (trajRes.ok && flowInvertibilityData) {
        const trajData: {
          trajectories: number[][][];
          config: { numSamples: number; numSteps: number };
        } = await trajRes.json();

        reverseSamplingData = {
          trajectories: trajData.trajectories,
          sourceDistribution,
          targetDistribution: flowInvertibilityData.targetDistribution,
          config: trajData.config,
        };
      }
    } catch (e: unknown) {
      console.warn("Failed to load ReverseSampling data:", e);
    }

    // Initialize FlowModelClient using this app's existing flow_model
    try {
      flowMatchingClient = new FlowModelClient(
        `${base}${settings.flowModelWorkerUrl}`,
        `${base}${settings.flowMatchingModelPath}`,
        "Flow Matching",
        settings.flowMatchingModelConfig
      );
    } catch (e: unknown) {
      console.warn("Failed to initialize FlowModelClient for §1 figures:", e);
    }
    // Compute the vector field live from the same model that produces the trajectories
    // — guarantees the arrows align with where samples actually flow. Run sequentially so
    // we don't fan out 20 parallel model loads across the worker pool (which leaves it
    // unable to service the EulerStepDemo's trajectory sampling for several seconds).
    if (flowMatchingClient) {
      try {
        const gridResolution = 9;
        // 9 points over [-2.4, 2.4] gives spacing 0.6, which lands grid
        // columns at x = ±1.2 — right on the smiley's eye centroids
        // (x ≈ ±1.21). The EulerStepDemo display domain is wider so the
        // outer arrows render inside the canvas with breathing room.
        const domainRange = { xMin: -2.4, xMax: 2.4, yMin: -2.4, yMax: 2.4 };
        const numTimeSteps = 20;
        const timeSteps = Array.from({ length: numTimeSteps }, (_, i) => i / (numTimeSteps - 1));
        const velocities: number[][][] = [];
        let gridPoints: number[][] = [];
        for (let i = 0; i < timeSteps.length; i++) {
          const r = await flowMatchingClient.vectorFieldGrid(gridResolution, domainRange, timeSteps[i]).promise;
          velocities.push(r.velocities);
          if (i === 0) gridPoints = r.gridPoints;
        }
        flowMatchingVectorField = {
          gridResolution,
          timeSteps,
          domainRange,
          velocities,
          gridPoints,
        };
      } catch (e: unknown) {
        console.warn("Failed to compute live vector field:", e);
      }
    }

    // Load cached 1D flow trajectories for §3 figure
    try {
      const res = await fetch(`${base}/one_dimensional_flow/cached_samples/trajectories.json`);
      if (res.ok) {
        oneDimensionalFlowTrajectories = await res.json();
      }
    } catch (e: unknown) {
      console.warn("Failed to load 1D flow trajectories:", e);
    }

    // Load bibliography and collect HoverableReference citations.
    try {
      bibEntries = await loadBibliography(`${base}/bibliography.bib`);
      if (!bibEntries) {
        console.error("Failed to load bibliography from bibliography.bib");
      } else {
        await tick();
        citations = collectCitations();
      }
    } catch (e: unknown) {
      console.error("Error loading bibliography:", e);
    }
  });

  onDestroy(() => {
    flowMatchingClient?.dispose?.();
  });
</script>

<svelte:head>
  <title>From Velocity Fields to Exact Likelihoods — A Visual Introduction to the Continuity Equation</title>
  <meta
    name="description"
    content="A visual introduction to the continuity equation and exact likelihood evaluation in flow-based generative models"
  />
</svelte:head>

<ArticleHeader
  title="From Velocity Fields to Exact Likelihoods"
  subtitle="A Visual Introduction to the Continuity Equation"
  author="Alec Helbling"
  authorLink="https://alechelbling.com"
  date="2025"
/>

<ContinuityEquationFigure>
  <strong>The continuity equation, pointwise.</strong>
  Both panes show the same probability density contracting onto a fixed point <Katex math={"x"} />
  (orange dot) under a convergent flow.
  <em>Left:</em> <Katex math={"\\partial p_t(x) / \\partial t"} /> is the rate of change of
  density at <Katex math={"x"} /> — visualized by the orange bar growing as density piles up
  at the point.
  <em>Right:</em> <Katex math={"-\\nabla \\cdot (p_t v_t)"} /> at <Katex math={"x"} /> is the rate
  at which probability flux flows INTO the point — the converging orange streamlines.
  Hover
  <img
    src="{base}/icons/tap.svg"
    alt="hover"
    style="width: 22px; height: 22px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
  /> over either pane to query <Katex math={"p(\\cdot)"} /> at any other point.
</ContinuityEquationFigure>

<hr class="section-divider" />

<!-- §1 — Introduction -->
<section id="introduction">
  <h2 id="introduction-heading" class="section-heading">Introduction</h2>
  <p>
    Flow-based generative models, like other modern generative frameworks, have deep roots in
    physics. They draw on fluid mechanics and the study of dynamical systems, and the
    <em>continuity equation</em> we will derive in this article is borrowed directly from them.
    The continuity equation is the partial differential equation that links a velocity field to
    the evolution of a probability density:
  </p>
  <Katex
    math={"\\frac{\\partial p_t}{\\partial t} + \\nabla \\cdot (p_t v_t) = 0."}
    displayMode={true}
  />
  <p>
    It is what makes <em>continuous normalizing flows</em> tick — without it we could not evaluate
    exact likelihoods, train by maximum likelihood, or talk meaningfully about densities at all.
    This article derives the continuity equation from first principles using only undergraduate
    multivariable calculus, shows how it unlocks exact likelihood evaluation, and explains why the
    whole story is rigorously well-defined.
  </p>
  <p>
    We assume only the most basic familiarity with flow models. For a more thorough introduction
    to flow matching <HoverableReference id="lipman2022" {bibEntries} {citations} /> and the
    concurrent stochastic interpolant framework
    <HoverableReference id="albergo2023" {bibEntries} {citations} /> — including the training
    objective, the role of the velocity field, and how trajectories are generated — see the
    <a href="https://alechelbling.com/rectified-flow/" target="_blank" rel="noopener noreferrer"
      >rectified flow explainer</a
    > <HoverableReference id="liu2022" {bibEntries} {citations} />. The next section gives a
    compressed recap to fix the vocabulary we will use throughout.
  </p>
</section>

<hr class="section-divider" />

<!-- §2 — Background on flow models -->
<section id="background">
  <h2 id="background-heading" class="section-heading">Background on Flow Models</h2>
  <p>
    A <em>flow</em> <Katex math={"\\psi_t(x)"} /> is a time-indexed map that transports points from
    a simple source distribution <Katex math={"p_0"} /> (e.g. a standard Gaussian) to a complex
    target distribution <Katex math={"p_1 = q"} /> (e.g. natural images), tracing a continuous
    <em>probability path</em>
    <Katex math={"(p_t)_{0 \\le t \\le 1}"} /> in between. We can sample from
    <Katex math={"q"} /> by drawing <Katex math={"X_0 \\sim p_0"} /> and pushing it forward:
    <Katex math={"X_t = \\psi_t(X_0) \\sim p_t"} />.
  </p>

  <ProbabilityPathIntro
    sourceDistributionSamples={probabilityPathSourceSamples}
    targetDistributionSamples={probabilityPathTargetSamples}
    {allTimeSamples}
    {isTraining}
    backgroundVisible={false}
    showContours={true}
    height={450}
    yShiftFactor={-1.6}
    numScatterSamples={150}
  >
    <strong>The probability path of a flow model.</strong>
    Samples from a simple source distribution <Katex math={"p_0"} /> are transformed along
    trajectories to produce samples from a complex target distribution <Katex math={"p_1 = q"} />.
  </ProbabilityPathIntro>

  <p>
    Rather than parameterizing the flow <Katex math={"\\psi_t(x)"} /> directly, flow-based models
    parameterize a time-dependent <em>velocity field</em> <Katex math={"v_t(x)"} /> that
    <em>generates</em> the flow via an ODE:
  </p>
  <Katex
    math={"\\frac{d}{dt} \\psi_t(x_0) = v_t(\\psi_t(x_0)), \\quad \\psi_0(x_0) = x_0."}
    displayMode={true}
  />
  <p>
    Sampling reduces to integrating this ODE forward in time — typically with Euler steps that
    repeatedly nudge the current point along the local velocity:
    <Katex math={"x_{t + \\Delta t} = x_t + \\Delta t \\cdot v_t(x_t)"} />.
  </p>

  {#if flowInvertibilityData && flowMatchingVectorField}
    <EulerStepDemo
      {flowMatchingClient}
      targetDistribution={flowInvertibilityData.targetDistribution}
      {flowMatchingVectorField}
      backgroundVisible={false}
      maxUserTrajectories={1}
      showGroundTruth={false}
      showLegend={false}
      showArrowHeads={true}
      domainRange={{ xMin: -2.825, xMax: 2.825, yMin: -3, yMax: 2.65 }}
    >
      <strong>Euler integration through a time-dependent velocity field
        <Katex math={"v_t(x)"} />.</strong>
      The orange Euler approximation takes 16 discrete steps along the direction of the blue
      velocity field. Tap anywhere to generate a new sample.
    </EulerStepDemo>
  {/if}
</section>

<hr class="section-divider" />

<!-- §3 — Why exact likelihoods matter -->
<section id="why-likelihoods">
  <h2 id="why-likelihoods-heading" class="section-heading">Why Exact Likelihoods Matter</h2>
  <p>
    Before we dive into the machinery, it is worth pausing on <em>why</em> we care so much about
    likelihoods in the first place. One of the most unique properties — and arguably the defining
    one — of continuous normalizing flows is their ability to evaluate the exact likelihood
    <Katex math={"\\log p(x)"} /> of any observed data sample. This is something that other
    generative modeling frameworks largely cannot do.
  </p>
  <p>
    Variational autoencoders only give a lower bound on the likelihood (the ELBO). GANs do not
    expose a likelihood at all — they are sample-only generators. Diffusion models can produce
    likelihood estimates via the probability flow ODE, but most diffusion training objectives
    optimize a bound rather than the true log-likelihood. Continuous normalizing flows are the
    rare framework where the model itself <em>is</em> a tractable density we can evaluate exactly.
  </p>
  <p>Why does that matter in practice?</p>
  <ul>
    <li>
      <strong>Maximum likelihood training.</strong> If we can compute
      <Katex math={"\\log p_\\theta(x)"} /> we can train by directly maximizing it on data — the gold
      standard objective for density estimation, with well-understood statistical properties.
    </li>
    <li>
      <strong>Out-of-distribution detection.</strong> An exact density gives us a principled score
      for whether a new sample looks like the training distribution. Lower
      <Katex math={"\\log p(x)"} /> means more likely OOD.
    </li>
    <li>
      <strong>Model comparison.</strong> Two models can produce visually similar samples while
      assigning very different likelihoods to held-out data. Likelihood is the metric that
      distinguishes them.
    </li>
    <li>
      <strong>Compression and information theory.</strong> By Shannon's theorem, an exact density
      gives an exact code length — flows can be used as principled compressors.
    </li>
  </ul>
  <p>
    To make this concrete, the figure below shows a 1D flow model that turns Gaussian noise
    (left) into a three-mode mixture (right). The heatmap is the time-evolving density
    <Katex math={"p_t(x)"} /> — exactly the quantity an exact-likelihood evaluator gives you
    access to at every <Katex math={"t"} />, not just at the endpoints. Tap anywhere to spawn a
    sample trajectory.
  </p>

  {#if oneDimensionalFlowTrajectories.length > 0}
    <OneDimensionalLikelihoodComparison
      trajectories={oneDimensionalFlowTrajectories}
      width={500}
      height={280}
      likelihoodPanelWidth={160}
      animationDuration={5}
      interactive={false}
      flipTimeAxis={true}
      showLikelihoodBars={true}
      highlightedTargetYs={[4.2, -1.94]}
      showTimeSlider={false}
      endPauseDurationSeconds={6}
      barRevealDurationSeconds={1.4}
    >
      <strong>A 1D flow model and its time-evolving density.</strong>
      The blue heatmap shows the probability density at each value (vertical) as time progresses
      (horizontal), starting from a standard Gaussian on the left and ending in a three-mode
      mixture on the right. The orange curves trace two samples being integrated through the
      flow. Because the model gives us the density itself, the brightness at every
      <Katex math={"(t, x)"} /> is the exact log-likelihood <Katex math={"\\log p_t(x)"} />.
    </OneDimensionalLikelihoodComparison>
  {/if}

  <p>
    In the rest of this article we'll see <em>how</em> this evaluation is actually done. The path
    runs through a physical premise (conservation of mass), a partial differential equation (the
    continuity equation), and a small but powerful rearrangement that turns that PDE into a 1D ODE
    along a trajectory.
  </p>
</section>

<hr class="section-divider" />

<!-- §4 — Conservation of mass -->
<section id="conservation-of-mass">
  <h2 id="conservation-of-mass-heading" class="section-heading">Conservation of Mass</h2>
  <p>
    <strong>Flows conserve probability mass.</strong> Particles are not created or destroyed by
    the flow — they are merely transported around by the velocity field. The total probability is
    always one, at every time <Katex math={"t"} />:
  </p>
  <Katex math={"\\int p_t(x) \\, dx = 1 \\quad \\text{for all } t."} displayMode={true} />
  <p>
    Why is this true for flows? A flow is defined via an ODE
    <Katex math={"\\tfrac{d}{dt}\\psi_t(x) = v_t(x)"} />, so every particle at point
    <Katex math={"x"} /> has a unique velocity. There is no random component as in diffusion. Under
    mild regularity conditions on <Katex math={"v_t"} />, this ODE has a unique solution for each
    initial condition, which means distinct starting points stay distinct — points are never merged
    or split. We will prove this rigorously later in the post; for now, take it as the premise.
  </p>

  {#if flowInvertibilityData}
    <FlowInvertibility data={flowInvertibilityData}>
      <strong>An invertible flow preserves probability mass.</strong>
      An invertible flow <Katex math={"\\psi_t(x)"} /> maps distinct starting points
      <Katex math={"x_a"} /> and <Katex math={"x_b"} /> to distinct locations at all times. Because no
      samples are created or destroyed, the total probability mass is conserved:
      <Katex math={"\\int p_t(x) \\, dx = 1"} /> for all <Katex math={"t"} />.
    </FlowInvertibility>
  {/if}

  <p>
    We can restate this conservation property more explicitly in terms of a control volume. Pick
    any region <Katex math={"V"} /> in space with boundary <Katex math={"S"} />. Conservation of
    mass says: <strong>the change in probability mass inside <Katex math={"V"} /> is exactly the
    amount of probability flowing through <Katex math={"S"} /></strong>. In integral form:
  </p>
  <Katex
    math={
      "\\frac{d}{dt} \\int_V p_t(x) \\, dx = - \\int_{\\partial V} (p_t v_t) \\cdot \\hat{n}(x) \\, dS"
    }
    displayMode={true}
  />
  <p>
    where <Katex math={"p_t(x)"} /> is the probability density at time <Katex math={"t"} />,
    <Katex math={"v_t"} /> is the velocity field, and <Katex math={"\\hat{n}(x)"} /> is the outward
    unit normal to the surface <Katex math={"S"} /> at point <Katex math={"x"} />. The minus sign
    is there because mass flowing <em>out</em> of <Katex math={"V"} /> (positive flux) <em>decreases</em>
    the mass inside.
  </p>

  <MassConservation>
    <strong>Conservation of probability mass.</strong>
    The change in probability density <Katex math={"\\rho"} /> inside a volume <Katex math={"V"} />
    equals the negative flux <Katex math={"\\rho \\mathbf{v}"} /> through the boundary
    <Katex math={"S"} />.
    <em>Left:</em> The probability density <Katex math={"\\rho"} /> evolving inside the volume.
    <em>Right:</em> The flux vectors <Katex math={"\\rho \\mathbf{v}"} /> and surface normals
    <Katex math={"\\hat{n}"} /> at the boundary.
  </MassConservation>
  <p>
    This integral statement is the entire physical content we need. To convert it into the local
    PDE form, we need two pieces of standard vector calculus.
  </p>
</section>

<hr class="section-divider" />

<!-- §5 — The divergence theorem -->
<section id="divergence-theorem">
  <h2 id="divergence-theorem-heading" class="section-heading">The Divergence Theorem</h2>
  <p>
    <strong>Divergence.</strong>
    Divergence describes how much a vector field is outwardly flowing at a point. A
    <em>source</em> is a location with net outward flow; a <em>sink</em> is a location with net inward
    flow. Formally, for a 2D field <Katex math={"\\mathbf{F} = (F_x, F_y)"} />,
  </p>
  <Katex
    math={
      "\\nabla \\cdot \\mathbf{F} = \\frac{\\partial F_x}{\\partial x} + \\frac{\\partial F_y}{\\partial y}."
    }
    displayMode={true}
  />

  <DivergenceIntro>
    <strong>Three types of vector field divergence.</strong>
    The divergence of a vector field <Katex math={"\\mathbf{F} = (F_x, F_y)"} /> describes the rate
    at which "density" expands or contracts at a point.
    <em>Left:</em> A converging field (sink) has negative divergence (<Katex
      math={"\\nabla \\cdot \\mathbf{F} < 0"}
    />).
    <em>Center:</em> A diverging field (source) has positive divergence (<Katex
      math={"\\nabla \\cdot \\mathbf{F} > 0"}
    />).
    <em>Right:</em> An incompressible field has zero divergence (<Katex
      math={"\\nabla \\cdot \\mathbf{F} = 0"}
    />).
  </DivergenceIntro>

  <p>
    <strong>The theorem.</strong>
    Divergence is a local quantity (defined at each point); flux is a global quantity (integrated
    over a boundary). The <em>divergence theorem</em> connects them. Gauss' divergence theorem
    states that
  </p>
  <Katex
    math={"\\int_{\\partial V} \\mathbf{F} \\cdot \\hat{n}(x) \\, dS = \\int_V \\nabla \\cdot \\mathbf{F} \\, dx."}
    displayMode={true}
  />
  <p>
    In English: the integral of the flux <Katex math={"\\mathbf{F} \\cdot \\hat{n}"} /> through a
    closed boundary <Katex math={"S"} /> equals the integral of the divergence
    <Katex math={"\\nabla \\cdot \\mathbf{F}"} /> over the enclosed volume <Katex math={"V"} />.
    Intuitively, if you subdivide the region into infinitesimal cells, the flux contributions from
    adjacent interior cells cancel, leaving only the net outward flow at the boundary.
  </p>

  <DivergenceTheoremFigure
    curveFn={(theta) => {
      const half = 0.9;
      const t = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const seg = Math.min(3, Math.floor(t / (Math.PI / 2)));
      const local = (t - seg * (Math.PI / 2)) / (Math.PI / 2);
      switch (seg) {
        case 0: return [half, -half + local * 2 * half];
        case 1: return [half - local * 2 * half, half];
        case 2: return [-half, half - local * 2 * half];
        default: return [-half + local * 2 * half, -half];
      }
    }}
    vectorFieldFn={createWavyVectorField({ amplitude: 0.35, frequency: 1.6 })}
    gridResolution={3}
    domainMargin={0.6}
  >
    <strong>The divergence theorem on a square region.</strong>
    The region is tiled by a 3×3 grid of sub-cells. Each cell carries outward arrows — a discrete
    picture of <Katex math={"\\nabla \\cdot \\mathbf{F}"} /> inside. Left: a wave propagates from
    the center outward; as it passes each shared interior edge, the opposing arrow pair flashes and
    fades — interior contributions cancel pairwise. Only the arrows on the outer boundary survive,
    and they pulse to emphasize that they are exactly the surface integral
    <Katex math={"\\int_{\\partial V} \\mathbf{F} \\cdot \\hat{n}\\, dS"} />. Right: the same
    discrete divergence as a propagating wave of outward arrows. Streamlines of
    <Katex math={"\\mathbf{F}"} /> shown faintly behind for context.
  </DivergenceTheoremFigure>

  <!--
    Arbitrary-shape variant: hidden for now, kept in source for the future.
    <DivergenceTheoremFigure
      curveFn={createClosedCurve({
        baseRadius: 0.85,
        amplitudes: [0.22, 0.16, 0.1],
        phases: [0, 0.7, 1.3],
        frequencies: [1, 2, 3],
      })}
      vectorFieldFn={createWavyVectorField({ amplitude: 0.35, frequency: 1.6 })}
      gridResolution={8}
    >
      <strong>The same argument works for any shape.</strong>
      Replace the square with an arbitrary smooth closed curve, subdivide it more finely, and the
      same pairwise cancellation occurs — interior arrows shared between neighbors annihilate;
      only the outward-pointing arrows along the boundary remain.
    </DivergenceTheoremFigure>
  -->
</section>

<hr class="section-divider" />

<!-- §6 — The continuity equation -->
<section id="continuity-equation">
  <h2 id="continuity-equation-heading" class="section-heading">The Continuity Equation</h2>
  <p>
    We now have all the pieces. Apply the divergence theorem to the right-hand side of the
    conservation-of-mass integral:
  </p>
  <Katex
    math={
      "\\begin{align} \\frac{d}{dt} \\int_V p_t(x) \\, dx &= - \\int_{\\partial V} (p_t v_t) \\cdot \\hat{n}(x) \\, dS \\\\ &= - \\int_V \\nabla \\cdot (p_t v_t) \\, dx. \\end{align}"
    }
    displayMode={true}
  />
  <p>
    Move everything to one side, use the Leibniz integral rule to push the time derivative inside
    the integral, and merge the two integrals:
  </p>
  <Katex
    math={
      "\\int_V \\left( \\frac{\\partial p_t(x)}{\\partial t} + \\nabla \\cdot (p_t v_t) \\right) dx = 0."
    }
    displayMode={true}
  />
  <p>
    Now apply the standard <em>arbitrary-volume</em> argument. The volume <Katex math={"V"} /> was
    chosen arbitrarily — the equation holds for <em>any</em> region we pick. The only way for an
    integrand to integrate to zero over every possible region is if the integrand itself is zero
    everywhere:
  </p>

  <ContinuityEquationFigure>
    <strong>The continuity equation, pointwise.</strong>
    Both panes show the same probability density contracting onto a fixed point <Katex math={"x"} />
    (orange dot) under a convergent flow.
    <em>Left:</em> <Katex math={"\\partial p_t(x) / \\partial t"} /> is the rate of change of
    density at <Katex math={"x"} /> — visualized by the orange bar growing as density piles up
    at the point.
    <em>Right:</em> <Katex math={"-\\nabla \\cdot (p_t v_t)"} /> at <Katex math={"x"} /> is the rate
    at which probability flux flows INTO the point — the converging orange streamlines. The PDE
    above says these two quantities are equal at every point and every time.
    Hover
    <img
      src="{base}/icons/tap.svg"
      alt="hover"
      style="width: 22px; height: 22px; vertical-align: middle; margin: 0 2px; filter: invert(30%) sepia(0%) saturate(0%) brightness(60%) contrast(90%);"
    /> over either pane to query <Katex math={"p(\\cdot)"} /> at any other point.
  </ContinuityEquationFigure>

  <p>
    This is the <strong>continuity equation</strong>, the local PDE form that all valid continuous
    normalizing flows must satisfy. It says: the rate of change of density at a point is exactly
    the negative divergence of the probability flux <Katex math={"p_t v_t"} /> at that point.
  </p>
</section>

<hr class="section-divider" />

<!-- §7 — The instantaneous change of variables -->
<section id="instantaneous-change-of-variables">
  <h2 id="instantaneous-change-of-variables-heading" class="section-heading">
    Instantaneous Change of Variables
  </h2>
  <p>
    The continuity equation is a partial differential equation about <Katex math={"p_t(x)"} /> at
    fixed points in space. That is the <em>Eulerian</em> view. To evaluate the likelihood of an
    observed sample, it turns out to be far more useful to switch to the <em>Lagrangian</em> view:
    follow a single particle along its trajectory <Katex math={"\\psi_t(x_0)"} /> and ask how its
    log-density changes over time. This rearrangement is the bridge from the PDE to a practical
    likelihood evaluation method, and it is what makes continuous normalizing flows work.
  </p>
  <p>
    Recall the flow ODE,
    <Katex
      math={"\\frac{d\\psi_t(x_0)}{dt} = v_t(\\psi_t(x_0)), \\quad \\psi_0(x_0) = x_0,"}
      displayMode={true}
    />
    and the continuity equation,
  </p>
  <Katex
    math={"\\frac{\\partial p_t(x)}{\\partial t} + \\nabla \\cdot (p_t v_t) = 0."}
    displayMode={true}
  />
  <p>
    Expand the divergence of the product
    <Katex math={"\\nabla \\cdot (p_t v_t) = v_t \\cdot \\nabla p_t + p_t (\\nabla \\cdot v_t)"} />
    and rearrange:
  </p>
  <Katex
    math={
      "\\frac{\\partial p_t(x)}{\\partial t} + v_t \\cdot \\nabla p_t = -p_t (\\nabla \\cdot v_t)."
    }
    displayMode={true}
  />
  <p>The left-hand side is the <em>material derivative</em> — the rate of change of <Katex math={"p_t"} /> as seen by an observer riding along with the flow:</p>
  <Katex
    math={
      "\\frac{D p_t}{D t} \\;=\\; \\frac{\\partial p_t}{\\partial t} + v_t \\cdot \\nabla p_t."
    }
    displayMode={true}
  />
  <p>So the continuity equation becomes</p>
  <Katex math={"\\frac{D p_t}{D t} = - p_t \\, (\\nabla \\cdot v_t)."} displayMode={true} />
  <p>
    Dividing by <Katex math={"p_t"} /> and recognizing the chain-rule identity
    <Katex math={"\\frac{d}{dt} \\log p_t = \\frac{1}{p_t} \\frac{D p_t}{D t}"} /> along the
    trajectory gives the central result of this article:
  </p>
  <Katex
    math={"\\boxed{\\;\\frac{d}{dt} \\log p_t(\\psi_t(x_0)) = - \\nabla \\cdot v_t(\\psi_t(x_0)).\\;}"}
    displayMode={true}
  />
  <p>
    This is the <strong>instantaneous change of variables formula</strong>. It is the key
    workhorse of continuous normalizing flows: a partial differential equation in space has been
    reduced to a one-dimensional ODE along each trajectory. Integrating from
    <Katex math={"0"} /> to <Katex math={"t"} /> yields
  </p>
  <Katex
    math={
      "\\log p_t(\\psi_t(x_0)) - \\log p_0(x_0) = - \\int_0^t \\nabla \\cdot v_s(\\psi_s(x_0)) \\, ds."
    }
    displayMode={true}
  />
  <p>
    To evaluate <Katex math={"\\log p_T(x)"} /> for an observed sample <Katex math={"x"} />, we
    run the flow <em>backwards</em> from <Katex math={"x"} /> at time <Katex math={"T"} /> to find
    the corresponding source point <Katex math={"x_0"} />, then accumulate the divergence integral
    along the way. Reversing a flow is straightforward: just integrate the negated velocity field,
  </p>
  <Katex
    math={"\\frac{d}{dt} \\psi_t^{-1}(x) = -v_t(\\psi_t^{-1}(x)), \\quad \\psi_T^{-1}(x) = x."}
    displayMode={true}
  />

  {#if reverseSamplingData}
    <ReverseSampling data={reverseSamplingData}>
      <strong>Reverse sampling trajectories.</strong>
      Starting from points in the target distribution (right), the model traces paths back to the
      source distribution (left) by integrating <Katex math={"-v_t(x)"} />. This reverse process is
      used to compute exact likelihoods.
    </ReverseSampling>
  {/if}

  {#if reverseSamplingData}
    <LikelihoodIntegration data={reverseSamplingData} selectedIndices={[5, 15]}>
      <strong>Likelihood integration via reverse trajectories.</strong>
      Starting from points <Katex math={"x_1"} /> and <Katex math={"x_2"} /> in the target distribution,
      the model traces paths backward to the source. The log-likelihood is computed by integrating the
      divergence of the velocity field along these paths.
    </LikelihoodIntegration>
  {/if}

  <p>
    With this formula in hand, we know <em>how</em> to evaluate likelihoods. The next two sections
    address the natural follow-up questions: how do we actually parameterize and train such a
    model (§8), and why is the whole construction rigorously well-defined (§9)?
  </p>
</section>

<hr class="section-divider" />

<!-- §8 — Continuous normalizing flows -->
<section id="continuous-normalizing-flows">
  <h2 id="continuous-normalizing-flows-heading" class="section-heading">
    Continuous Normalizing Flows
  </h2>
  <p>
    Now we have everything we need to define a continuous normalizing flow
    <HoverableReference id="chen2018neural" {bibEntries} {citations} /> (CNF) — the
    continuous-time generalization of normalizing flows
    <HoverableReference id="rezende2015" {bibEntries} {citations} /> — as a
    <em>practical</em> generative model. The recipe is short:
  </p>
  <ol>
    <li>
      Parameterize the velocity field as a neural network
      <Katex math={"v_\\theta(x, t)"} /> — typically a simple MLP that takes the current point
      <Katex math={"x"} /> and time <Katex math={"t"} /> as inputs and outputs a velocity vector in
      <Katex math={"\\mathbb{R}^d"} />.
    </li>
    <li>
      Define the flow implicitly through the ODE
      <Katex math={"\\tfrac{d}{dt}\\psi_t(x_0) = v_\\theta(\\psi_t(x_0), t)"} />. Sampling means
      starting from <Katex math={"x_0 \\sim p_0"} /> and integrating forward to <Katex math={"t = 1"} />.
    </li>
    <li>
      Evaluate likelihoods using the instantaneous change of variables formula from §7: integrate
      <Katex math={"-\\nabla \\cdot v_\\theta"} /> along the reverse trajectory.
    </li>
    <li>
      Train by maximum likelihood: take gradient steps on
      <Katex math={"-\\mathbb{E}_{x \\sim q}[\\log p_\\theta(x)]"} />.
    </li>
  </ol>
  <p>
    What is striking is how little structure we need to impose on <Katex math={"v_\\theta"} />.
    Traditional discrete normalizing flows (RealNVP, Glow) had to use carefully restricted
    architectures so that their Jacobian determinants would be tractable. Here, <Katex math={"v_\\theta"} />
    can be an essentially arbitrary smooth neural network — the work of constraining the model into
    a valid density evolution is done by the continuity equation, not by hand-designed
    architectural restrictions.
  </p>
  <p>
    The price we pay for this freedom is that sampling and likelihood evaluation both require
    solving an ODE, which is more expensive per-sample than a single forward pass. But conceptually,
    the model is just an MLP plus an ODE solver.
  </p>

  <CrownJewel contourBandwidth={10} numScatterSamples={300}>
    <strong>A trained CNF in action.</strong>
    The orange contours show the evolving probability density as samples flow from a Gaussian
    source distribution to the two-moons target distribution (blue points). Click anywhere to
    trace backward trajectories showing where samples originated.
  </CrownJewel>
</section>

<hr class="section-divider" />

<!-- §9 — Why the flow is well-defined -->
<section id="well-posedness">
  <h2 id="well-posedness-heading" class="section-heading">Why the Flow Is Well-Defined</h2>
  <p>
    We have so far been waving our hands at a delicate point: when does the flow ODE
    <Katex math={"\\tfrac{d}{dt}\\psi_t(x_0) = v_\\theta(\\psi_t(x_0), t)"} /> actually have a unique
    solution? And why does the resulting <Katex math={"\\psi_t"} /> give a valid density at every
    time <Katex math={"t"} />? This section closes those gaps. None of the answers are deep; they
    are all consequences of one regularity condition on <Katex math={"v_\\theta"} />.
  </p>

  <h3 id="picard-lindelof">Lipschitz continuity and Picard–Lindelöf</h3>
  <p>
    The crucial property we need from <Katex math={"v_\\theta"} /> is <em>Lipschitz continuity</em>
    in the spatial argument: there exists a constant <Katex math={"L"} /> such that
    <Katex math={"\\|v_\\theta(x, t) - v_\\theta(y, t)\\| \\le L \\|x - y\\|"} /> for all
    <Katex math={"x, y, t"} />. For standard neural networks (MLPs with ReLU/tanh/etc.) this holds
    on any bounded region — the network is locally Lipschitz, which is enough.
  </p>
  <p>
    The <em>Picard–Lindelöf theorem</em> states that if <Katex math={"v_\\theta"} /> is Lipschitz in
    <Katex math={"x"} /> and continuous in <Katex math={"t"} />, then for every initial condition
    <Katex math={"x_0"} /> the ODE has a <em>unique</em> solution defined on some time interval
    around <Katex math={"t = 0"} />. This is the foundational result that says "the flow exists and
    is uniquely determined by the initial condition."
  </p>

  <h3 id="diffeomorphism">From uniqueness to a diffeomorphism</h3>
  <p>
    Picard–Lindelöf gives us more than just existence — it gives us <em>distinctness preservation</em>.
    If <Katex math={"x_a \\ne x_b"} />, then <Katex math={"\\psi_t(x_a) \\ne \\psi_t(x_b)"} /> for all
    <Katex math={"t"} />. Why? If two trajectories ever met at some time <Katex math={"t^*"} />,
    they would form two solutions to the same ODE backward in time from that meeting point,
    contradicting uniqueness.
  </p>

  <InvertibilityExplanation>
    <strong>What Picard–Lindelöf rules out.</strong>
    Two distinct starting points <Katex math={"x_a"} /> and <Katex math={"x_b"} /> are shown
    converging to the same location at time <Katex math={"t"} />, then following identical paths
    afterward. Picard–Lindelöf forbids this: under a Lipschitz velocity field, distinct trajectories
    can never merge.
  </InvertibilityExplanation>

  <p>
    Combined with smoothness of <Katex math={"v_\\theta"} />, this means each
    <Katex math={"\\psi_t"} /> is a <em>diffeomorphism</em>: a smooth, invertible map with a smooth
    inverse. A diffeomorphism is exactly the right kind of transformation to push a probability
    density through. Concretely:
  </p>
  <ul>
    <li><strong>Bijective:</strong> the inverse <Katex math={"\\psi_t^{-1}"} /> exists pointwise.</li>
    <li>
      <strong>No mass collapse:</strong> probability is neither created nor destroyed, justifying the
      mass-conservation premise of §4.
    </li>
    <li>
      <strong>Smooth Jacobian:</strong> the change-of-variables formula is well-defined, justifying
      the differentiation we did in §7.
    </li>
    <li>
      <strong>Reverse sampling works:</strong> integrating <Katex math={"-v_\\theta"} /> from
      <Katex math={"t = 1"} /> back to <Katex math={"t = 0"} /> exactly inverts the forward flow.
    </li>
  </ul>

  {#if flowInvertibilityData}
    <Diffeomorphism data={flowInvertibilityData}>
      <strong>A diffeomorphism in action.</strong>
      A uniform grid at <Katex math={"t = 0"} /> is pushed forward by the same flow that maps the
      Gaussian source distribution to the smiley target. The grid deforms continuously but never
      folds, never tears, and no two cells overlap — exactly the properties Picard–Lindelöf
      guarantees for any Lipschitz <Katex math={"v_\\theta"} />.
    </Diffeomorphism>
  {/if}

  <p>
    The chain is:
    <Katex math={"v_\\theta"} /> Lipschitz <Katex math={"\\Rightarrow"} /> Picard–Lindelöf gives
    unique trajectories <Katex math={"\\Rightarrow"} /> <Katex math={"\\psi_t"} /> is a diffeomorphism
    <Katex math={"\\Rightarrow"} /> <Katex math={"p_t"} /> is a valid density at every <Katex math={"t"} />.
    Crucially, this holds <em>at every gradient step</em> during training: as long as
    <Katex math={"v_\\theta"} /> stays smooth, we are guaranteed that the model represents a
    bona fide density.
  </p>
</section>

<hr class="section-divider" />

<div class="article-footer">
  <!-- Acknowledgements Section -->
  <section id="acknowledgements">
    <h2 id="acknowledgements-heading" class="section-heading">Acknowledgements</h2>
    <p>
    </p>
  </section>

  <!-- References Section -->
  <section id="references">
    <h2 id="references-heading" class="section-heading">References</h2>
    <Bibliography {citations} {bibEntries} />
  </section>

  <!-- How to Cite Section -->
  <section id="cite">
    <h2 id="cite-heading" class="section-heading">How to Cite</h2>
    <div class="cite-section">
      <p>If you found this explainer helpful, please consider citing it:</p>
      <pre><code>@article{"{"}helbling2025continuityequation,
  title = {"{"}Flow Models: A Visual Introduction to the Continuity Equation and Exact Likelihood Evaluation{"}"},
  author = {"{"}Helbling, Alec{"}"},
  year = {"{"}2025{"}"},
  url = {"{"}https://alechelbling.com/continuity-equation{"}"}
{"}"}</code></pre>
    </div>
  </section>

  <!-- Comments (giscus) — populated at runtime by /comments.js -->
  <h2 id="comments" class="section-heading">Comments</h2>
</div>
