<script lang="ts">
  import { onMount, onDestroy, getContext, type Snippet } from 'svelte';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  interface FigureRef {
    restart?: () => void;
    pause?: () => void;
  }

  let {
    figure = undefined,
    class: className = '',
    style = '',
    children,
  }: {
    figure?: FigureRef;
    class?: string;
    style?: string;
    children: Snippet;
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let sectionEl: HTMLElement;
  let reveal: any = null;
  let unsubscribe: (() => void) | null = null;

  // Access reveal instance from context (set by +page.svelte)
  const getReveal = getContext<() => any>('getReveal');

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  function onSlideChanged(event: any) {
    if (event.currentSlide === sectionEl) {
      figure?.restart?.();
    } else {
      figure?.pause?.();
    }
  }

  function handleClick() {
    figure?.restart?.();
  }

  onMount(() => {
    // Poll for reveal instance (it's initialized async)
    const check = setInterval(() => {
      reveal = getReveal?.();
      if (reveal) {
        clearInterval(check);
        reveal.on('slidechanged', onSlideChanged);
        unsubscribe = () => reveal.off('slidechanged', onSlideChanged);
      }
    }, 100);

    // Safety cleanup if reveal never arrives
    return () => clearInterval(check);
  });

  onDestroy(() => {
    unsubscribe?.();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
  bind:this={sectionEl}
  class={className}
  style="{style}{figure ? ' cursor: pointer;' : ''}"
  onclick={figure ? handleClick : undefined}
>
  {@render children()}
</section>
