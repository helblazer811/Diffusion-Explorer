<!--
  ProbabilityPathIntro: Placeholder figure for the "What is a flow?" section.
  Shows a probability path with scatter plot and highlighted single trajectory.

  TODO: Implement full visualization showing:
  - Source distribution p_0 (Gaussian)
  - Target distribution p_1 (data distribution)
  - Probability path p_t interpolating between them
  - A single highlighted trajectory showing flow ψ_t(x)
-->

<script lang="ts">
  import { Figure, Katex } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (receives content from parent as default slot)
  export let children = undefined;

  // Layout
  export let width = 800;
  export let height = 300;

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Store reference to avoid shadowing by snippet name
  $: captionSnippet = children;
</script>

<Figure backgroundVisible={false}>
  {#snippet children()}
    <div class="placeholder-figure" style="width: 100%; max-width: {width}px; height: {height}px;">
      <div class="placeholder-content">
        <div class="placeholder-icon">📈</div>
        <div class="placeholder-title">Probability Path Visualization</div>
        <div class="placeholder-description">
          <p>
            This figure will show the probability path <Katex math={"(p_t)_{0 \\leq t \\leq 1}"} />
            interpolating from a source distribution <Katex math={"p_0"} /> to a target distribution <Katex math={"p_1 = q"} />.
          </p>
          <p>
            A single trajectory <Katex math={"\\psi_t(x)"} /> will be highlighted to show how individual samples
            are transported by the flow.
          </p>
        </div>
        <div class="placeholder-status">Coming soon</div>
      </div>
    </div>
  {/snippet}

  {#snippet caption()}
    {@render captionSnippet?.()}
  {/snippet}
</Figure>

<style>
  .placeholder-figure {
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    border: 2px dashed #cbd5e1;
    border-radius: 12px;
    margin: 0 auto;
  }

  .placeholder-content {
    text-align: center;
    padding: 2rem;
    max-width: 500px;
  }

  .placeholder-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
    opacity: 0.6;
  }

  .placeholder-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: #475569;
    margin-bottom: 1rem;
  }

  .placeholder-description {
    font-size: 0.95rem;
    color: #64748b;
    line-height: 1.6;
    margin-bottom: 1.5rem;
  }

  .placeholder-description p {
    margin: 0.5rem 0;
  }

  .placeholder-status {
    display: inline-block;
    padding: 0.375rem 1rem;
    background: #e2e8f0;
    color: #475569;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 500;
  }
</style>
