<script lang="ts">
  interface Props {
    left?: import('svelte').Snippet;
    right?: import('svelte').Snippet;
    caption?: import('svelte').Snippet;
    gap?: number;
    inline?: boolean;
  }

  let { left, right, caption, gap = 20, inline = false }: Props = $props();
</script>

<figure class="double-figure">
  <div class="double-figure-container" style="gap: {gap}px;">
    <div class="figure-content left-figure" class:inline>
      {@render left?.()}
    </div>
    <div class="figure-content right-figure" class:inline>
      {@render right?.()}
    </div>
  </div>
  {#if !inline}
    <figcaption class="figure-caption">
      {@render caption?.()}
    </figcaption>
  {/if}
</figure>

<style>
  .double-figure {
    width: 100%;
    margin: 2rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .double-figure-container {
    width: 100%;
    display: flex;
    flex-direction: row;
    justify-content: space-between;
  }

  .figure-content {
    position: relative;
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }

  .figure-content.inline {
    background-color: transparent;
    border: none;
  }

  .left-figure {
    /* Additional styling for left figure if needed */
  }

  .right-figure {
    /* Additional styling for right figure if needed */
  }

  .figure-caption {
    font-size: 1.1rem;
    line-height: 1.5;
    color: #555;
    text-align: left;
  }
</style>
