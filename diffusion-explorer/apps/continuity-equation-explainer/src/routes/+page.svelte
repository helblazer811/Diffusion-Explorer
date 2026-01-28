<script>
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import { base } from "$app/paths";
  import { ArticleHeader, Katex } from "@diffusion-explorer/ui";
  import { generateClippedGaussianSamples, clipSamplesToRadius, clipTrajectoriesToStartingRadius, loadCachedTrajectories } from "@diffusion-explorer/diffusion";
  import { settings } from "$lib/settings";

  // Figure imports
  import ProbabilityPathIntro from "$lib/figures/ProbabilityPathIntro.svelte";
  import FlowInvertibility from "$lib/figures/FlowInvertibility.svelte";
  import InvertibilityExplanation from "$lib/figures/InvertibilityExplanation.svelte";
  import MassConservation from "$lib/figures/MassConservation.svelte";
  import DivergenceIntro from "$lib/figures/DivergenceIntro.svelte";
  import DivergenceTheoremSquare from "$lib/figures/DivergenceTheoremSquare/DivergenceTheoremSquare.svelte";
  import ReverseSampling from "$lib/figures/ReverseSampling.svelte";

  // Data for ProbabilityPathIntro figure
  let probabilityPathSourceSamples = [];
  let probabilityPathTargetSamples = [];
  const allTimeSamples = writable([]);
  const isTraining = writable(false);

  // Data for FlowInvertibility figure
  let flowInvertibilityData = null;

  // Data for ReverseSampling
  let reverseSamplingData = null;

  /**
   * Transpose trajectories from [sampleIndex][timeStep][x,y] to [timeStep][sampleIndex][x,y]
   * This converts from per-sample trajectories to per-timestep samples format
   */
  function transposeTrajectories(trajectories) {
    if (!trajectories || trajectories.length === 0) return [];
    const numSamples = trajectories.length;
    const numSteps = trajectories[0].length;
    const result = [];
    for (let t = 0; t < numSteps; t++) {
      const samplesAtT = [];
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
      const result = await loadCachedTrajectories(`${base}/flow_invertibility/cached_samples/flow_matching_trajectories.json`);
      if (result) {
        // Clip trajectories to only include samples starting within radius
        const clippingRadius = settings.stylingSettings.scatterPlot.clippingRadius;
        const clippedTrajectories = clipTrajectoriesToStartingRadius(result.trajectories, clippingRadius);
        allTimeSamples.set(clippedTrajectories);
        // Use clipped source and target from trajectories
        probabilityPathSourceSamples = clippedTrajectories[0] || [];
        probabilityPathTargetSamples = clippedTrajectories[clippedTrajectories.length - 1] || [];
      }
    } catch (e) {
      console.warn("Failed to load ProbabilityPathIntro data:", e);
    }

    // Load target distribution and cached trajectories for FlowInvertibility
    try {
      const [targetRes, trajRes] = await Promise.all([
        fetch(`${base}/flow_invertibility/data/smiley_face.json`),
        fetch(`${base}/flow_invertibility/cached_samples/trajectories.json`),
      ]);

      if (targetRes.ok && trajRes.ok) {
        const targetData = await targetRes.json();
        const trajData = await trajRes.json();

        flowInvertibilityData = {
          allTrajectories: trajData.allTrajectories,
          highlightedIndices: trajData.highlightedIndices || [0, 1],
          sourceDistribution,
          targetDistribution: targetData.points,
          config: trajData.config,
        };
      }
    } catch (e) {
      console.warn("Failed to load FlowInvertibility data:", e);
    }

    // Load data for ReverseSampling (reverse trajectories)
    // Use the normalized targetDistribution from trajectories.json (loaded above for flowInvertibilityData)
    // to ensure the rendered distribution matches what was used to compute the trajectories
    try {
      const trajRes = await fetch(`${base}/flow_invertibility/cached_samples/reverse_trajectories.json`);

      if (trajRes.ok && flowInvertibilityData) {
        const trajData = await trajRes.json();

        reverseSamplingData = {
          trajectories: trajData.trajectories,
          sourceDistribution,
          targetDistribution: flowInvertibilityData.targetDistribution,
          config: trajData.config,
        };
      }
    } catch (e) {
      console.warn("Failed to load ReverseSampling data:", e);
    }
  });
</script>

<svelte:head>
  <title>Flow Models: The Continuity Equation</title>
  <meta
    name="description"
    content="A visual introduction to the continuity equation and exact likelihood evaluation in flow-based generative models"
  />
</svelte:head>

<ArticleHeader
  title="Flow Models: A Visual Introduction to the Continuity Equation and Exact Likelihood Evaluation"
  author="Alec Helbling"
  authorLink="https://alechelbling.com"
  date="2025"
/>

<!-- Introduction Section -->
<section id="introduction">
  <h2 id="introduction-heading" class="section-heading">Introduction</h2>
  <p>
    Computer scientists have a time-honored tradition of stealing concepts from physics and rebranding
    them with a nice computational flair, and of course this article is no different. Flow-based
    generative models and diffusion models have become the dominant frameworks for generating
    realistic synthetic examples of modalities like images and videos. Both of these frameworks have
    deep roots in physics. Diffusion models are derived from Brownian motion, which was originally
    conceived to model the random molecular motion of gases. Flow models are inspired by fluid
    mechanics and the study of dynamical systems. It is perhaps unsurprising then that a deeper
    understanding of the mathematical and physical underpinnings of generative models can be
    extraordinarily valuable.
  </p>
  <p>
    Continuous normalizing flows aim to generate new samples from distributions of data (e.g. images)
    by <em>flowing</em> samples from a simple source distribution, like a standard Gaussian, to a
    complex data distribution by following the dynamics of a learned vector field. One of the
    defining capabilities of flow based generative models is their ability to compute the exact
    likelihood of samples; this is something that other generative modeling frameworks like diffusion
    are incapable of. The <em>continuity equation</em> is a partial differential equation that flow
    models must satisfy, and it directly leads to their ability to perform exact likelihood
    estimation. Unsurprisingly, this is also borrowed from classical physics.
  </p>
  <Katex
    math={"\\frac{\\partial p_t}{\\partial t} + \\nabla \\cdot (p_t v_t) = 0"}
    displayMode={true}
  />
  <p>
    In this article, we give a visual overview of the theoretical underpinnings of the continuity
    equation. We expose how the deterministic nature of flow models naturally leads to the
    conservation of probability mass, ensuring that at all times we have a valid probability
    distribution. By combining this mass conservation property with some surprisingly simple
    undergraduate level physics concepts, we can derive the continuity equation and in turn derive a
    method for exact likelihood computation.
  </p>
</section>

<hr class="section-divider" />

<!-- Background on Flow Models -->
<section id="background">
  <h2 id="background-heading" class="section-heading">Background on Flow Models</h2>

  <h3 id="what-is-a-flow">What is a flow?</h3>

  <ProbabilityPathIntro
    sourceDistributionSamples={probabilityPathSourceSamples}
    targetDistributionSamples={probabilityPathTargetSamples}
    {allTimeSamples}
    {isTraining}
    backgroundVisible={false}
    showContours={true}
    height={450}
    distributionScaleFactor={0.7}
    yShiftFactor={-0.6}
    numScatterSamples={150}
  >
    <strong>The probability path of a flow model.</strong>
    Samples from a simple source distribution <Katex math={"p_0"} /> are transformed along
    trajectories to produce samples from a complex target distribution <Katex math={"p_1 = q"} />.
  </ProbabilityPathIntro>

  <p>
    The broad goal of generative modeling is to draw samples from some complex distribution of data
    (e.g., natural images) that we have empirical observations from, but where the true distribution
    is unknown. More concretely, given a finite number of training samples
    <Katex math={"X = \\{x_1, \\ldots, x_n\\}"} /> from a target distribution <Katex math={"q"} />, our goal
    is to learn a model that can generate new samples from <Katex math={"q"} />.
  </p>
  <p>
    A flow model learns to bridge a simple source probability distribution <Katex math={"p"} /> that is
    easy to draw samples from, like a multivariate Gaussian
    <Katex math={"\\mathcal{N}(0, \\sigma^2 I)"} />, to a complex data distribution <Katex math={"q"} /> by
    defining a continuous transformation between the two. We define a continuous sequence of
    probability distributions, called a <em>probability path</em>
    <Katex math={"(p_t)_{0 \\leq t \\leq 1}"} />, that smoothly interpolates between our simple
    source distribution <Katex math={"p_0"} /> and our data distribution <Katex math={"p_1 = q"} />. We
    index this path by an abstract time variable <Katex math={"t \\in [0, 1]"} />, where
    <Katex math={"t = 0"} /> corresponds to the source distribution and <Katex math={"t = 1"} />
    corresponds to the target distribution. By drawing samples from <Katex math={"p_0"} /> and
    transforming them along this path, we can produce samples distributed according to our data
    distribution <Katex math={"p_1 = q"} />.
  </p>
  <p>
    A <em>flow</em> <Katex math={"\\psi_t(x)"} /> is a time-indexed mapping from
    <Katex math={"\\mathbb{R}^d"} /> to <Katex math={"\\mathbb{R}^d"} /> that specifies trajectories of
    points over time; when applied to our samples <Katex math={"X_0 \\sim p_0"} /> it transports them
    from the source distribution to the target distribution <Katex math={"X_1 \\sim p_1 = q"} />. The
    intermediate samples produced by our flow <Katex math={"X_t = \\psi_t(X_0)"} /> are distributed
    according to our probability path <Katex math={"X_t \\sim p_t"} />. If we can somehow learn to
    model this flow, then we can draw samples from our simple source distribution
    <Katex math={"p_0"} /> and transform them to realistic approximations of real world data with
    distribution <Katex math={"q"} />.
  </p>
  <p>
    Perhaps somewhat counterintuitively, rather than directly modeling the flow
    <Katex math={"\\psi_t(x)"} />, flow-based generative models instead model a time-dependent velocity
    field <Katex math={"v_t(x)"} /> that "generates" the flow. By taking this velocity field we can
    solve a set of ordinary differential equations (ODEs) to recover the flow, in a process called
    simulation. By starting from some initial point <Katex math={"x_0"} /> at time
    <Katex math={"t = 0"} />, we can trace the trajectory of this point over time according to the
    velocity field <Katex math={"v_t(x)"} /> using the following ODE:
  </p>
  <Katex
    math={"\\frac{d}{dt} \\psi_t(x_0) = v_t(\\psi_t(x_0)), \\quad \\psi_0(x_0) = x_0."}
    displayMode={true}
  />
  <p>
    The solution to this ordinary differential equation involving <Katex math={"v_t(x)"} /> is itself
    the flow <Katex math={"\\psi_t(x)"} />. There are a variety of numerical methods for simulating
    these ODEs which approximate the continuous trajectory by taking a series of discrete steps.
  </p>

  <h3 id="exact-likelihood">Exact Likelihood Estimation with a Flow</h3>
  <p>
    One of the most unique properties, and perhaps the defining one, of continuous normalizing flows
    is their ability to evaluate the exact likelihood of observing data samples
    <Katex math={"\\log p(x)"} />. This can be done by integrating along the trajectory of the vector
    field:
  </p>
  <Katex
    math={
      "\\log p(x(t_1), t_1) = \\log p(x(t_0), t_0) - \\int_{t_0}^{t_1} \\nabla \\cdot v(x(t), t)\\, dt."
    }
    displayMode={true}
  />
  <p>
    This is not a capability of many other generative modeling frameworks like diffusion. Exact
    likelihood estimation has numerous benefits. For example, it allows for principled maximum
    likelihood based training. It can even be applied to applications like out of distribution
    detection. However, it may not be immediately obvious why flow models have this capability,
    which is the focus of the rest of this article.
  </p>
</section>

<hr class="section-divider" />

<!-- Derivation of the Continuity Equation -->
<section id="derivation">
  <h2 id="derivation-heading" class="section-heading">Derivation of the Continuity Equation</h2>
  <p>
    We know that the <em>continuity equation</em> is what unlocks the ability to do exact likelihood
    evaluation with flows: but where does it come from? Answering this question requires a number of
    steps, but thankfully none of the steps require any concepts that are out of reach to anyone who
    has taken an undergraduate multivariable calculus class!
  </p>
  <p>At a high level the steps of this derivation are:</p>
  <ol>
    <li>We argue why flow models conserve probability mass.</li>
    <li>We introduce the concept of divergence, and the divergence theorem.</li>
    <li>We reframe mass conservation in terms of the divergence of the probability flux.</li>
    <li>We then show how this leads to the continuity equation.</li>
    <li>
      We show how the continuity equation lends itself to exact likelihood estimation with
      continuous normalizing flows.
    </li>
  </ol>

  <h3 id="mass-conservation">Flows Conserve Probability Mass</h3>
  <p>
    <strong
      >Flows are deterministic and invertible, which ensures they conserve probability mass.</strong
    >
  </p>
  <p>A defining property of continuous normalizing flows is that they are deterministic. A flow is defined via the ordinary differential equation:</p>
  <Katex
    math={"\\frac{d}{dt}\\psi_t(x) = v_t(x), \\quad \\psi_0(x) = x."}
    displayMode={true}
  />
  <p>
    This means that every particle at point <Katex math={"x"} /> has a unique velocity
    <Katex math={"v_t(x)"} />, there is no random component to the trajectories as in diffusion.
  </p>
  <p>
    A less obvious fact about flows is that they are invertible under certain regularity conditions
    (i.e., Lipschitz continuity). Invertibility tells us that each point <Katex math={"x"} /> is
    mapped to a unique point <Katex math={"\\psi_t(x)"} /> at a given point in time. There are no two
    points <Katex math={"x_a"} /> and <Katex math={"x_b"} /> such that
    <Katex math={"\\psi_t(x_a) = \\psi_t(x_b)"} />, otherwise we would not be able to form an inverse
    <Katex math={"\\psi_t^{-1}(x)"} /> that recovers the initial points <Katex math={"x_a"} /> and
    <Katex math={"x_b"} /> given <Katex math={"\\psi_t(x_a)"} />. This invertibility arises due to
    something called the Picard-Lindelöf theorem, which guarantees the existence, uniqueness, and
    continuous dependence of our flow on initial conditions. Ok, but what does invertibility buy us?
  </p>
  <p>
    <strong
      >Invertibility guarantees that points are not created or destroyed by our flow (mapped to the
      same destination). If points are not created or destroyed, then a flow conserves probability
      mass!</strong
    >
    This allows us to apply classic properties from physics relating to the conservation of mass to flows.
  </p>

  <InvertibilityExplanation>
    <strong>Non-invertible flow.</strong>
    Two distinct starting points <Katex math={"x_a"} /> and <Katex math={"x_b"} /> converge to the same
    location at time <Katex math={"t"} />, then follow identical paths afterward. This violates
    invertibility because we cannot uniquely determine the origin of a particle at the merged
    location.
  </InvertibilityExplanation>

  {#if flowInvertibilityData}
    <FlowInvertibility data={flowInvertibilityData}>
      <strong>Invertible flow preserves probability mass.</strong>
      An invertible flow <Katex math={"\\psi_t(x)"} /> maps distinct starting points
      <Katex math={"x_a"} /> and <Katex math={"x_b"} /> to distinct locations at all times. Because no
      samples are created or destroyed, the total probability mass is conserved:
      <Katex math={"\\int p_t(x) \\, dx = 1"} /> for all <Katex math={"t"} />.
    </FlowInvertibility>
  {/if}

  <h3 id="explicit-conservation">Explicit Conservation of Mass Property</h3>
  <p>
    We can restate this conservation of mass property more explicitly. Say we have some volume
    <Katex math={"V"} /> in space with a boundary <Katex math={"S"} />.
    <strong
      >It follows from the conservation of mass that the change in probability mass inside of our
      volume <Katex math={"V"} /> is exactly the amount of probability mass flowing through our
      boundary <Katex math={"S"} />.</strong
    >
    This can be stated as
  </p>
  <Katex
    math={
      "\\frac{d}{dt} \\iint_V p_t(x) \\, dV = - \\oint_S (p_t v_t) \\cdot \\hat{n}(x) \\, dS"
    }
    displayMode={true}
  />
  <p>
    where <Katex math={"p_t(x)"} /> corresponds to our probability density at time
    <Katex math={"t"} />, <Katex math={"v_t"} /> is our velocity field and
    <Katex math={"\\hat{n}(x)"} /> produces a vector normal to the surface <Katex math={"S"} /> at
    point <Katex math={"x"} />. We now have a single equation for compactly capturing our conservation
    of mass property.
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

  <h3 id="divergence">Divergence and the Divergence Theorem</h3>
  <p>
    Now that we have a formal description of the conservation of mass property of our flow, we still
    need to demonstrate how it can be converted into the continuity equation. This requires
    introducing the concept of divergence and the divergence theorem.
  </p>

  <h4>Divergence</h4>
  <p>
    Divergence is a quantity that describes how much a vector field is outwardly flowing at a point.
    A <em>source</em> is a location with net outward flow, and a <em>sink</em> is a location with net
    inward flow. Divergence is a useful quantity for describing interesting properties of probability
    flows.
  </p>

  <DivergenceIntro>
    <strong>Three types of vector field divergence.</strong>
    The divergence of a vector field <Katex math={"\\mathbf{F} = (F_x, F_y)"} /> is defined as
    <Katex
      math={
        "\\nabla \\cdot \\mathbf{F} = \\frac{\\partial F_x}{\\partial x} + \\frac{\\partial F_y}{\\partial y}"
      }
    />
    and describes the rate at which "density" expands or contracts at a point.
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

  <h4 id="divergence-theorem">Divergence Theorem</h4>
  <p>
    Using something called the divergence theorem, we can directly relate divergence to the
    probability <em>flux</em> through a boundary. This helps us convert our statement about the
    conservation of mass to one about divergence. Gauss' Divergence Theorem states that
  </p>
  <Katex
    math={"\\oint_S \\mathbf{F} \\cdot \\hat{n}(x) \\, dS = \\iint_V \\nabla \\cdot \\mathbf{F} \\, dV"}
    displayMode={true}
  />
  <p>
    In English, this means that the integral of the flux
    <Katex math={"\\mathbf{F} \\cdot \\hat{n}(x)"} /> around a boundary <Katex math={"S"} /> is
    equal to the integral of the divergence <Katex math={"\\nabla \\cdot \\mathbf{F}"} /> across the
    volume <Katex math={"V"} /> with boundary <Katex math={"S"} />. This allows us to convert a statement
    about the flux of a vector field through a boundary into one about the divergence over the volume.
  </p>
  <p>
    Intuitively, we can see why divergence theorem is true in the figure below. If we subdivide a
    region into infinitesimal grids you can see that the flows of adjacent grid cells in the
    interior counteract each other, this leaves a net component of divergence that is outward.
  </p>

  <DivergenceTheoremSquare />

  <p>We can apply this theorem to our conservation of mass equation to arrive at</p>
  <Katex
    math={
      "\\begin{align} \\frac{d}{dt} \\iint_V p_t(x) \\, dV &= - \\oint_S (p_t v_t) \\cdot \\hat{n}(x) \\, dS \\\\ \\frac{d}{dt} \\iint_V p_t(x) \\, dV &= - \\iint_V \\nabla \\cdot (p_t v_t) \\, dV \\end{align}"
    }
    displayMode={true}
  />
  <p>
    So we now have now expressed our conservation of mass in terms of the divergence of the
    probability flux through our volume.
  </p>

  <h3 id="putting-together">Putting it All Together</h3>
  <p>
    Finally, we can tie all of these steps together and derive the continuity equation. First we can
    move everything to one side and combine the integrals.
  </p>
  <Katex
    math={
      "\\begin{align} \\frac{d}{dt} \\iint_V p_t(x) \\, dV &= - \\iint_V \\nabla \\cdot (p_t v_t) \\, dV \\\\ \\frac{d}{dt} \\iint_V p_t(x) \\, dV + \\iint_V \\nabla \\cdot (p_t v_t) \\, dV &= 0 \\end{align}"
    }
    displayMode={true}
  />
  <p>
    Now we can use the Leibniz integral rule to move our derivative to the inside of our integrals
    to get
  </p>
  <Katex
    math={
      "\\iint_V \\frac{\\partial p_t(x)}{\\partial t} \\, dV + \\iint_V \\nabla \\cdot (p_t v_t) \\, dV = 0"
    }
    displayMode={true}
  />
  <p>And we can merge the integrals</p>
  <Katex
    math={
      "\\iint_V \\left( \\frac{\\partial p_t(x)}{\\partial t} + \\nabla \\cdot (p_t v_t) \\right) dV = 0"
    }
    displayMode={true}
  />
  <p>
    Now, we can use a standard argument that this statement is true for arbitrary volumes
    <Katex math={"V"} />, rather than a particular volume. The only way for an integral of some
    quantity
    <Katex math={"\\frac{\\partial p_t(x)}{\\partial t} + \\nabla \\cdot (p_t v_t)"} /> to be zero
    for arbitrary volumes is if the integrand is zero. So
  </p>
  <Katex
    math={"\\frac{\\partial p_t(x)}{\\partial t} + \\nabla \\cdot (p_t v_t) = 0"}
    displayMode={true}
  />
  <p>
    This is the final partial differential equation form that the continuity equation is typically
    presented in! This is an equation that all valid continuous normalizing flows are guaranteed to
    satisfy, and as we mentioned previously it is what allows CNFs to perform exact likelihood
    evaluation.
  </p>
</section>

<hr class="section-divider" />

<!-- Evaluating Exact Likelihoods -->
<section id="exact-likelihoods">
  <h2 id="exact-likelihoods-heading" class="section-heading">Evaluating Exact Likelihoods</h2>
  <p>
    Now that we are equipped with the continuity equation, we want to finally derive the capability
    of flows to evaluate exact likelihoods.
  </p>
  <p>
    First, instead of thinking about how the density changes at fixed points in space, we can follow
    the trajectories of our samples as they flow. Going back to the ODE which defines our flow we
    have that
  </p>
  <Katex
    math={"\\frac{d\\psi_t(x_0)}{dt} = v_t(\\psi_t(x_0)), \\quad \\psi_0(x_0) = x_0"}
    displayMode={true}
  />
  <p>We can express the continuity equation in this form as</p>
  <Katex
    math={"\\frac{\\partial p_t(\\psi_t(x_0))}{\\partial t} + \\nabla \\cdot (p_t v_t) = 0"}
    displayMode={true}
  />
  <p>We can then expand the divergence term:</p>
  <Katex
    math={
      "\\begin{align} \\frac{\\partial p_t(\\psi_t(x_0))}{\\partial t} + v_t \\cdot \\nabla p_t + p_t(\\nabla \\cdot v_t) &= 0 \\\\ \\frac{\\partial p_t(\\psi_t(x_0))}{\\partial t} + v_t \\cdot \\nabla p_t &= -p_t(\\nabla \\cdot v_t) \\end{align}"
    }
    displayMode={true}
  />
  <p>The term on the left is called the <em>material derivative</em></p>
  <Katex
    math={
      "\\frac{Dp_t}{Dt} = \\frac{\\partial p_t(\\psi_t(x_0))}{\\partial t} + v_t \\cdot \\nabla p_t"
    }
    displayMode={true}
  />
  <p>Substituting this into our expanded continuity equation gives us</p>
  <Katex math={"\\frac{Dp_t}{Dt} = - p_t (\\nabla \\cdot v_t)"} displayMode={true} />
  <p>The final piece of our transformation comes from the definition of the derivative of a logarithm</p>
  <Katex
    math={"\\frac{d}{dt} \\log p_t(\\psi_t(x_0)) = \\frac{1}{p_t} \\frac{dp_t}{dt}"}
    displayMode={true}
  />
  <p>If we multiply both sides of our material derivative expression we get:</p>
  <Katex
    math={"\\frac{1}{p_t} \\frac{D p_t(\\psi_t(x_0))}{Dt} = - \\nabla \\cdot v_t"}
    displayMode={true}
  />
  <p>And we can use our log identity to get</p>
  <Katex
    math={"\\frac{d}{dt} \\log p_t(\\psi_t(x_0)) = - \\nabla \\cdot v_t"}
    displayMode={true}
  />
  <p>Finally, by the fundamental theorem of calculus we get</p>
  <Katex
    math={
      "\\log p_t(\\psi_t(x_0)) - \\log p_0(x_0) = - \\int_0^t \\nabla \\cdot v_s(\\psi_s(x_0)) \\, ds"
    }
    displayMode={true}
  />
  <p>
    In order to compute the exact likelihood <Katex math={"\\log p_T(x)"} /> we must run the flow
    backwards given a sample <Katex math={"x"} /> at time <Katex math={"T"} />. Thankfully, we can do
    this in quite a straightforward way by simply moving in the negative direction predicted by our
    velocity field <Katex math={"-v_t(x)"} />:
  </p>
  <Katex
    math={"\\frac{d}{dt} \\psi_t^{-1}(x) = -v_t(\\psi_t^{-1}(x)), \\quad \\psi_T^{-1}(x) = x"}
    displayMode={true}
  />
  <p>This is another situation where we are benefiting from the invertibility of our flow!</p>

  {#if reverseSamplingData}
    <ReverseSampling data={reverseSamplingData}>
      <strong>Reverse sampling trajectories.</strong>
      Starting from points in the target distribution (right), the model traces paths back to the
      source distribution (left) by integrating <Katex math={"-v_t(x)"} />. This reverse process is
      used to compute exact likelihoods.
    </ReverseSampling>
  {/if}

  <h3 id="computational-concerns">Computational Concerns</h3>
  <p>
    In practice, it is challenging to compute the exact divergence
    <Katex math={"\\nabla \\cdot v_t = \\sum_{i = 1}^d \\frac{\\partial v_t^{(i)}}{\\partial x_i}"} />
    which requires <Katex math={"\\mathcal{O}(d)"} /> separate backpropagations through our network.
    For high dimensional <Katex math={"d"} /> this is not feasible. This is why many approaches settle
    for approximate methods like Hutchinson's trace estimator which says that
  </p>
  <Katex
    math={
      "\\nabla \\cdot v_t \\approx \\epsilon^T \\nabla_x(v_t^T \\epsilon), \\quad \\epsilon \\sim \\mathcal{N}(0, I)"
    }
    displayMode={true}
  />
  <p>
    This can be computed in a single backpropagation using a Jacobian vector product, something
    automatic differentiation systems excel at.
  </p>
</section>

<hr class="section-divider" />

<!-- Acknowledgements Section -->
<section id="acknowledgements">
  <h2 id="acknowledgements-heading" class="section-heading">Acknowledgements</h2>
  <p>
  </p>
</section>

<hr class="section-divider" />

<!-- References Section -->
<section id="references" class="references">
  <h2 id="references-heading" class="section-heading">References</h2>
  <ol>
    <li>
      Lipman, Y., Chen, R. T., Ben-Hamu, H., Nickel, M., & Le, M. (2022). Flow matching for
      generative modeling. <em>arXiv preprint arXiv:2210.02747</em>.
    </li>
    <li>
      Chen, R. T., Rubanova, Y., Bettencourt, J., & Duvenaud, D. K. (2018). Neural ordinary
      differential equations. <em>Advances in neural information processing systems</em>, 31.
    </li>
    <li>
      Rezende, D., & Mohamed, S. (2015). Variational inference with normalizing flows.
      <em>International conference on machine learning</em>.
    </li>
    <li>
      Liu, X., Gong, C., & Liu, Q. (2022). Flow straight and fast: Learning to generate and transfer
      data with rectified flow. <em>arXiv preprint arXiv:2209.03003</em>.
    </li>
  </ol>
</section>

<hr class="section-divider" />

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
