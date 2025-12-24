<script>
  import { onMount, onDestroy, setContext } from 'svelte';
  import { writable } from 'svelte/store';

  export let children = undefined;
  export let caption = undefined;
  export let backgroundVisible = true;

  // Visibility state
  const isActive = writable(false);
  let figureElement;
  let observer = null;

  // Track both scroll visibility and tab visibility
  let isInViewport = false;
  let isTabVisible = true;

  // Expose isActive to children via context
  setContext('figureIsActive', isActive);

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
        // Trigger when any part of the figure is visible
        threshold: 0,
        // Optional: add rootMargin to trigger slightly before/after viewport
        rootMargin: '50px'
      }
    );

    // Observe the figure element
    if (figureElement) {
      observer.observe(figureElement);
    }

    // Handle tab visibility changes
    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
      updateActiveState();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup function
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

<figure class="figure" bind:this={figureElement}>
  <div
    class="figure-content"
    class:no-background={!backgroundVisible}
  >
    {@render children?.()}
  </div>
  {#if backgroundVisible}
    <figcaption class="figure-caption">
      {@render caption?.()}
    </figcaption>
  {/if}
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
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 1rem;
    user-select: none;
    -webkit-user-select: none;
  }

  .figure-content.no-background {
    background-color: transparent;
    border: none;
  }

  .figure-caption {
    font-size: 1.1rem;
    line-height: 1.5;
    color: #666;
    text-align: left;
  }
</style>