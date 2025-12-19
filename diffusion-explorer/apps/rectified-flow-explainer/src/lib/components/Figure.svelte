<script lang="ts">
  let { children, caption } = $props();
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
    position: relative; /* Required for absolute positioning of PlayButton */
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
    padding: 1rem;
  }

  .figure-caption {
    font-size: 1.1rem;
    line-height: 1.5;
    color: #555;
    text-align: left;
  }
</style>