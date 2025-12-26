<script>
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';

  export let left = undefined;
  export let right = undefined;
  export let footer = undefined;
  export let caption = undefined;
  export let gap = 20;
  export let backgroundVisible = true;

  // Visibility state - exported so parent can bind to it
  export let isActive = writable(false);
  let figureElement;
  let observer = null;

  // Track both scroll visibility and tab visibility
  let isInViewport = false;
  let isTabVisible = true;

  // Update isActive when either visibility state changes
  function updateActiveState() {
    isActive.set(isInViewport && isTabVisible);
  }

  onMount(() => {
    // Create IntersectionObserver to track scrolling visibility
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isInViewport = entry.isIntersecting;
          updateActiveState();
        });
      },
      {
        threshold: 0,
        rootMargin: '50px'
      }
    );

    if (figureElement) {
      observer.observe(figureElement);
    }

    // Handle tab visibility changes
    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
      updateActiveState();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  onDestroy(() => {
    if (observer) {
      observer.disconnect();
    }
  });
</script>

<figure class="double-figure" bind:this={figureElement}>
  <div class="double-figure-container" style="gap: {gap}px;">
    <div class="figure-content left-figure" class:no-background={!backgroundVisible}>
      {@render left?.()}
    </div>
    <div class="figure-content right-figure" class:no-background={!backgroundVisible}>
      {@render right?.()}
    </div>
  </div>
  {#if footer}
    <div class="figure-footer">
      {@render footer?.()}
    </div>
  {/if}
  <figcaption class="figure-caption">
    {@render caption?.()}
  </figcaption>
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
    user-select: none;
    -webkit-user-select: none;
  }

  .figure-content.no-background {
    background-color: transparent;
    border: none;
  }

  .left-figure {
    /* Additional styling for left figure if needed */
  }

  .right-figure {
    /* Additional styling for right figure if needed */
  }

  .figure-footer {
    display: flex;
    justify-content: center;
    width: 100%;
  }

  .figure-caption {
    font-size: 1.1rem;
    line-height: 1.5;
    color: #666;
    text-align: left;
  }
</style>
