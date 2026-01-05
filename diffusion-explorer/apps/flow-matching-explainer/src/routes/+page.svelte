<script>
  import { onMount } from "svelte";
  import { generateClippedGaussianSamples } from "@diffusion-explorer/diffusion";
  import { settings } from "$lib/settings";
  import { base } from "$app/paths";
  import { ArticleHeader } from "@diffusion-explorer/ui";
  import Diffeomorphism from "$lib/figures/Diffeomorphism.svelte";
  import ReverseSampling from "$lib/figures/ReverseSampling.svelte";

  // Distribution samples
  let sourceDistributionSamples = [];
  let targetDistributionSamples = [];

  // Generate source distribution (Gaussian)
  sourceDistributionSamples = generateClippedGaussianSamples(300);

  // Load target distribution from JSON
  async function loadTargetDistribution() {
    try {
      const response = await fetch(`${base}/${settings.targetDistributionPointsPath}`);
      if (!response.ok) {
        console.error("Failed to load target distribution:", response.statusText);
        return;
      }
      const data = await response.json();
      // Data is nested under 'points' property
      targetDistributionSamples = data.points || data;
    } catch (error) {
      console.error("Error loading target distribution:", error);
    }
  }

  onMount(() => {
    loadTargetDistribution();
  });
</script>

<svelte:head>
  <title>Flow Matching Explained</title>
  <meta name="description" content="An interactive explainer on flow matching for generative modeling" />
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
    Flow matching is a powerful technique for training continuous normalizing flows.
    This interactive article will guide you through the key concepts.
  </p>
</section>

<hr class="section-divider" />

<!-- Add more sections as needed -->
<section id="foundations">
  <h2 class="section-heading">Foundations</h2>
  <p>
    Content coming soon...
  </p>
</section>

<hr class="section-divider" />

<section id="diffeomorphism">
  <h2 class="section-heading">Diffeomorphism</h2>
  <Diffeomorphism
    {sourceDistributionSamples}
    {targetDistributionSamples}
    gridResolution={10}
  >
    A diffeomorphism smoothly transforms the source distribution (left) into the target distribution (right), preserving the topological structure of the space.
  </Diffeomorphism>
</section>

<hr class="section-divider" />

<section id="reverse-sampling">
  <h2 class="section-heading">Reverse Sampling</h2>
  <p>
    Flow matching models can also sample in reverse - mapping from the target
    distribution back to the source distribution by reversing the time direction.
  </p>
  <ReverseSampling
    {sourceDistributionSamples}
    {targetDistributionSamples}
    numTrajectorySamples={50}
  >
    <span class="figure-number">Figure:</span>
    <strong>Reverse sampling trajectories.</strong>
    Starting from points in the target distribution (right),
    the model traces paths back to the source distribution (left).
  </ReverseSampling>
</section>

<hr class="section-divider" />

<!-- References Section -->
<section id="references" class="references">
  <h2 class="section-heading">References</h2>
  <ol>
    <li>
      Lipman, Y., Chen, R. T., Ben-Hamu, H., Nickel, M., & Le, M. (2022).
      Flow matching for generative modeling. arXiv preprint arXiv:2210.02747.
    </li>
  </ol>
</section>
