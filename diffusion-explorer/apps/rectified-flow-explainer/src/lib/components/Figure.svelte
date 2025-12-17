<script lang="ts">
  interface Props {
    children?: import('svelte').Snippet;
    caption?: import('svelte').Snippet;
  }

  let { children, caption }: Props = $props();
</script>

<figure class="figure">
  <div class="figure-content">
    {@render children?.()}
  </div>
  <figcaption class="figure-caption">
    {@render caption?.()}
  </figcaption>
</figure>

<style>
  .figure {
    width: 100%;
    margin: 2rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .figure-content {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }

  .figure-caption {
    font-size: 1.1rem;
    line-height: 1.5;
    color: #555;
    text-align: left;
  }
</style>