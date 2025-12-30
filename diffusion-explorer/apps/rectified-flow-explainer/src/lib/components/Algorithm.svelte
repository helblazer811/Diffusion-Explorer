<script>
  import { setContext } from 'svelte';
  import Figure from './Figure.svelte';

  // Slots: title, inputs, outputs, steps, caption
  let { title, inputs, outputs, steps, caption, backgroundVisible = true } = $props();

  // Set up line counter context for AlgorithmLine auto-numbering
  setContext('algorithm-line-counter', { value: 0 });
</script>

<Figure {backgroundVisible} {caption}>
  {#snippet children()}
    <div class="algorithm-box">
      <div class="algorithm-title">
        {@render title?.()}
      </div>
      <div class="algorithm-content">
        {#if inputs}
          <div class="algorithm-line">
            <span class="line-label">Inputs:</span>
            <span>{@render inputs?.()}</span>
          </div>
        {/if}
        {#if outputs}
          <div class="algorithm-line">
            <span class="line-label">Outputs:</span>
            <span>{@render outputs?.()}</span>
          </div>
        {/if}
        {@render steps?.()}
      </div>
    </div>
  {/snippet}
</Figure>

<style>
  .algorithm-box {
    width: 100%;
    margin: 1rem;
  }

  .algorithm-title {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #ccc;
    color: #333;
  }

  .algorithm-content {
    font-size: 1.15rem;
    line-height: 1.8;
  }

  .algorithm-line {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 0.25rem;
  }

  .line-label {
    font-weight: 600;
    min-width: 4.5rem;
  }

  /* Expose these classes globally for steps content */
  :global(.algorithm-line) {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 0.25rem;
  }

  :global(.algorithm-line.indented) {
    padding-left: 1.5rem;
  }

  :global(.line-number) {
    color: #888;
    min-width: 1.5rem;
    text-align: right;
  }
</style>
