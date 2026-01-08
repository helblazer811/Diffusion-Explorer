<script>
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';

  // Content slots
  export let left = undefined;
  export let center = undefined;
  export let right = undefined;
  export let caption = undefined;

  // Panel titles and labels (as snippet slots)
  export let leftTitle = undefined;
  export let centerTitle = undefined;
  export let rightTitle = undefined;
  export let leftLabel = undefined;
  export let centerLabel = undefined;
  export let rightLabel = undefined;

  // Layout props
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

<figure class="triple-figure" bind:this={figureElement}>
  <div class="triple-figure-container" style="gap: {gap}px;">
    <div class="figure-panel">
      {#if leftTitle}
        <div class="panel-title">{@render leftTitle?.()}</div>
      {/if}
      <div class="figure-content" class:no-background={!backgroundVisible}>
        {@render left?.()}
      </div>
      {#if leftLabel}
        <div class="panel-label">{@render leftLabel?.()}</div>
      {/if}
    </div>
    <div class="figure-panel">
      {#if centerTitle}
        <div class="panel-title">{@render centerTitle?.()}</div>
      {/if}
      <div class="figure-content" class:no-background={!backgroundVisible}>
        {@render center?.()}
      </div>
      {#if centerLabel}
        <div class="panel-label">{@render centerLabel?.()}</div>
      {/if}
    </div>
    <div class="figure-panel">
      {#if rightTitle}
        <div class="panel-title">{@render rightTitle?.()}</div>
      {/if}
      <div class="figure-content" class:no-background={!backgroundVisible}>
        {@render right?.()}
      </div>
      {#if rightLabel}
        <div class="panel-label">{@render rightLabel?.()}</div>
      {/if}
    </div>
  </div>
  {#if caption}
    <figcaption class="figure-caption">
      {@render caption?.()}
    </figcaption>
  {/if}
</figure>

<style>
  .triple-figure {
    width: 100%;
    margin: 2rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .triple-figure-container {
    width: 100%;
    display: flex;
    flex-direction: row;
    justify-content: space-between;
  }

  .figure-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .panel-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: #444;
    text-align: center;
    padding-bottom: 0.25rem;
  }

  .figure-content {
    position: relative;
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 0.5rem;
    user-select: none;
    -webkit-user-select: none;
  }

  .figure-content.no-background {
    background-color: transparent;
    border: none;
  }

  .panel-label {
    font-size: 1.35rem;
    color: #444;
    text-align: center;
    width: 100%;
    display: flex;
    justify-content: center;
    padding: 0.5rem 0;
  }

  .figure-caption {
    font-size: 1.1rem;
    line-height: 1.5;
    color: #666;
    text-align: left;
  }
</style>
