<script lang="ts">
  import { onMount } from "svelte";
  import { generateClippedGaussianSamples } from "@diffusion-explorer/diffusion";
  import { settings } from "$lib/settings";
  import { base } from "$app/paths";
  import { ArticleHeader } from "@diffusion-explorer/ui";
  import Diffeomorphism from "$lib/figures/Diffeomorphism.svelte";
  import ConditionalProbabilityPath from "$lib/figures/ConditionalProbabilityPath.svelte";
  import ReverseSampling from "$lib/figures/ReverseSampling.svelte";
  import { Katex } from "@diffusion-explorer/ui";
  // Distribution samples
  let sourceDistributionSamples: number[][] = [];
  let targetDistributionSamples: number[][] = [];

  // Generate source distribution (Gaussian)
  sourceDistributionSamples = generateClippedGaussianSamples(300);

  // Load target distribution from JSON
  async function loadTargetDistribution() {
    try {
      const response = await fetch(
        `${base}/${settings.targetDistributionPointsPath}`
      );
      if (!response.ok) {
        console.error(
          "Failed to load target distribution:",
          response.statusText
        );
        return;
      }
      const data: { points?: number[][] } = await response.json();
      // Data is nested under 'points' property
      targetDistributionSamples = data.points || (data as unknown as number[][]);
    } catch (error: unknown) {
      console.error("Error loading target distribution:", error);
    }
  }

  onMount(() => {
    loadTargetDistribution();
  });
</script>

<svelte:head>
  <title>Flow Matching Explained</title>
  <meta
    name="description"
    content="An interactive explainer on flow matching for generative modeling"
  />
</svelte:head>

<ArticleHeader
  title="Flow Matching"
  subtitle="An Interactive Introduction"
  author="Alec Helbling"
  authorLink="https://alechelbling.com"
  date="2025"
/>

<!-- Introduction Section -->
<section id="introduction">
  <h2 class="section-heading">Introduction</h2>
  <p>
    Flow matching is a powerful technique for training continuous normalizing
    flows. This interactive article will guide you through the key concepts.
  </p>
</section>

<hr class="section-divider" />

<!-- Add more sections as needed -->
<section id="foundations">
  <h2 class="section-heading">Foundations</h2>
  <p>Content coming soon...</p>
</section>

<hr class="section-divider" />

<section id="diffeomorphism">
  <h2 class="section-heading">Diffeomorphism</h2>
  <Diffeomorphism
    {sourceDistributionSamples}
    {targetDistributionSamples}
    gridResolution={10}
  >
    A diffeomorphism smoothly transforms the source distribution (left) into the
    target distribution (right), preserving the topological structure of the
    space.
  </Diffeomorphism>
</section>

<hr class="section-divider" />

<section id="conditional-probability-path">
  <h2 class="section-heading">Conditional Probability Path</h2>
  <p>
    The key insight of flow matching is that we can decompose the marginal velocity field
    into conditional velocity fields. Given a target sample <Katex math="x_1"/>, the
    conditional velocity field is simply:
  </p>
  <p style="text-align: center; margin: 1rem 0;">
    <Katex math={"v_t(x | x_1) = \\frac{x_1 - x}{1 - t}"} displayMode={true} />
  </p>
  <p>
    This formula defines straight-line paths from any source point to the target point
    <Katex math="x_1"/>. Below, we visualize how samples from the source distribution
    flow toward a single target point.
  </p>
  <ConditionalProbabilityPath
    {sourceDistributionSamples}
    {targetDistributionSamples}
    targetPoint={targetDistributionSamples.length > 0 ? [targetDistributionSamples[0][0], targetDistributionSamples[0][1]] : null}
    backgroundVisible={false}
    highlightPointColor="#666"
    highlightPointRadius={5}
    showContours={true}
    intermediatePointOpacity={0.4}
    numSamples={150}
    targetPointOpacity={0.15}
    height={360}
    marginHeight={5}
    yShiftFactor={-1.3}
  >
    <span class="figure-number">Figure:</span>
    <strong>Conditional probability path.</strong>
    Samples from the source distribution (left) flow along straight lines toward a
    single target point <Katex math="x_1"/> (highlighted). The intermediate distribution
    <Katex math="p_t"/> shows the evolving particle positions.
  </ConditionalProbabilityPath>
</section>

<hr class="section-divider" />

<section id="reverse-sampling">
  <h2 class="section-heading">Reverse Sampling</h2>
  <p>
    Flow matching models can also sample in reverse - mapping from the target
    distribution back to the source distribution by reversing the time
    direction.
  </p>
  <ReverseSampling
    {sourceDistributionSamples}
    {targetDistributionSamples}
    numTrajectorySamples={50}
  >
    <span class="figure-number">Figure:</span>
    <strong>Reverse sampling trajectories.</strong>
    Starting from points in the target distribution (right), the model traces paths
    back to the source distribution (left).
  </ReverseSampling>
</section>

<hr class="section-divider" />

<!-- References Section -->
<section id="references" class="references">
  <h2 class="section-heading">References</h2>
  <ol>
    <li>
      Lipman, Y., Chen, R. T., Ben-Hamu, H., Nickel, M., & Le, M. (2022). Flow
      matching for generative modeling. arXiv preprint arXiv:2210.02747.
    </li>
  </ol>
</section>
