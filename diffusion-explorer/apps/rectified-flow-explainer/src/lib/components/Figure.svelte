<script>
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';

  export let children = undefined;
  export let caption = undefined;
  export let backgroundVisible = true;
  export let onContentClick = undefined;

  // Visibility state - exported so parent can bind to it
  export let isActive = writable(false);
  let figureElement;
  let observer = null;

  // Track both scroll visibility and tab visibility
  let isInViewport = false;
  let isTabVisible = true;

  // Track if we're in mobile width mode (for click-to-toggle)
  let isMobileWidth = false;

  // Update isActive when either visibility state changes
  function updateActiveState() {
    isActive.set(isInViewport && isTabVisible);
  }

  // Handle content click (only when mobile width and callback provided)
  function handleContentClick() {
    if (isMobileWidth && onContentClick) {
      onContentClick();
    }
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

    // Track viewport width for mobile click-to-toggle
    const checkWidth = () => {
      isMobileWidth = window.innerWidth < 600;
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);

    // Cleanup function
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', checkWidth);
    };
  });

  onDestroy(() => {
    if (observer) {
      observer.disconnect();
    }
  });
</script>

<figure class="figure" class:no-background-figure={!backgroundVisible} bind:this={figureElement}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="figure-content"
    class:no-background={!backgroundVisible}
    class:clickable={onContentClick && isMobileWidth}
    onclick={handleContentClick}
  >
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

  .figure.no-background-figure {
    margin-top: 0.5rem;
  }

  .figure-caption {
    font-size: 1.1rem;
    line-height: 1.5;
    color: #666;
    text-align: left;
  }

  .figure-content.clickable {
    cursor: pointer;
  }
</style>