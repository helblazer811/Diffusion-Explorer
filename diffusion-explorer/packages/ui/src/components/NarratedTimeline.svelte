<script module lang="ts">
  export type Chapter = { time: number; label: string };
</script>

<script lang="ts">
  // NarratedTimeline — a normal range-slider scrubber with a
  // hover-preview: as the cursor moves over the track, a small tooltip
  // shows which chapter's narration corresponds to that time. When the
  // cursor is not over the track, the message reflects the currently
  // playing chapter.

  import { onDestroy, onMount, tick } from 'svelte';
  import type { Player } from '@helblazer811/tempus';
  import Slider from './Slider.svelte';

  // Native <input type="range"> thumb width. Must match the CSS in
  // Slider.svelte's ::-webkit-slider-thumb and ::-moz-range-thumb rules
  // (currently both 10px). Used to correct for the browser's intrinsic
  // thumb-travel padding: the thumb's center only traverses from
  // THUMB_W/2 to (trackWidth - THUMB_W/2), not the full 0..trackWidth.
  const THUMB_W = 10;

  export let timeline: Player<unknown> | null = null;
  export let chapters: Chapter[] = [];
  export let min = 0;
  // Domain for chapter times and the slider position. Defaults to the
  // normalized [0, 1] domain used by tempus `Player.t` / `Player.seek()`
  // so the component drops in against a Player without any conversion.
  export let max = 1;
  export let color = '#4594e3';
  export let narrationColor = '#F1942B';
  export let narrationSize = '16px';
  export let showPlayButton = true;
  export let disabled = false;
  export let maxWidth = '644px';

  // --- Derived: sort chapters ---
  $: sortedChapters = [...chapters].sort((a, b) => a.time - b.time);

  // --- Player state ---
  let sliderValue = 0;
  let playing = false;
  let unsubscribe: (() => void) | null = null;

  $: if (timeline) {
    sliderValue = timeline.t;
    playing = timeline.isPlaying;

    unsubscribe?.();
    unsubscribe = timeline.onTick((t) => {
      sliderValue = t;
      playing = timeline!.isPlaying;
    });
  } else {
    unsubscribe?.();
    unsubscribe = null;
  }

  onDestroy(() => {
    unsubscribe?.();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', measureTrack);
    }
    resizeObs?.disconnect();
  });

  // --- Chapter lookup (floor semantics: last chapter whose time ≤ value) ---
  function chapterAt(t: number): { index: number; chapter: Chapter | null } {
    if (sortedChapters.length === 0) return { index: -1, chapter: null };
    let idx = -1;
    for (let i = 0; i < sortedChapters.length; i++) {
      if (sortedChapters[i].time <= t + 1e-9) idx = i;
      else break;
    }
    return { index: idx, chapter: idx >= 0 ? sortedChapters[idx] : null };
  }

  // --- Hover preview: time under the cursor while over the slider input ---
  // We only surface the bubble when the pointer is directly over the range
  // input element itself, not over the wrapping padding/spacer around it.
  // `hoverFraction` is a normalized 0..1 position along the input's
  // thumb-travel range (i.e., along the actual visible track).
  let trackWrapEl: HTMLDivElement | null = null;
  let hoverFraction: number | null = null;
  let hoverLabel = '';

  function handleTrackMouseMove(event: MouseEvent) {
    if (!trackWrapEl) return;
    const target = event.target as HTMLElement | null;
    // Only fire when the pointer is directly over the range input (the
    // slider track itself), not over surrounding padding or the bubble.
    if (!(target instanceof HTMLInputElement) || target.type !== 'range') {
      hoverFraction = null;
      hoverLabel = '';
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    hoverFraction = frac;
    const t = min + frac * (max - min);
    hoverLabel = chapterAt(t).chapter?.label ?? '';
  }

  function handleTrackMouseLeave() {
    hoverFraction = null;
    hoverLabel = '';
  }

  // --- Live slider-track geometry ---------------------------------------
  // The bubble / connector need to align with the actual <input type="range">
  // element inside the Slider component, not with the wrapping div. The
  // range input's bounding box is where the thumb travels between
  // (THUMB_W/2) and (width − THUMB_W/2); its vertical center is the track
  // line. We measure both relative to .track-wrap on mount and window resize.
  // Live-measured slider geometry (updated on mount + resize).
  // Assigning to these plain `let`s triggers Svelte's legacy reactivity so
  // the template rebinds the pixel-based bubble/connector positions.
  let trackLeft = 0;   // input.left − trackWrap.left, in px
  let trackWidth = 0;  // input.width, in px
  let trackCenterY = 0; // input center Y − trackWrap.top, in px
  let resizeObs: ResizeObserver | null = null;

  function measureTrack() {
    if (!trackWrapEl) return;
    const input = trackWrapEl.querySelector<HTMLInputElement>('input[type="range"]');
    if (!input) return;
    const inRect = input.getBoundingClientRect();
    const wrapRect = trackWrapEl.getBoundingClientRect();
    if (inRect.width <= 0 || wrapRect.width <= 0) return;
    trackLeft = inRect.left - wrapRect.left;
    trackWidth = inRect.width;
    trackCenterY = inRect.top + inRect.height / 2 - wrapRect.top;
  }

  onMount(() => {
    tick().then(measureTrack);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', measureTrack);
      if (trackWrapEl && 'ResizeObserver' in window) {
        resizeObs = new ResizeObserver(measureTrack);
        resizeObs.observe(trackWrapEl);
      }
    }
  });


  // --- Slider input: seek the underlying player ---
  function handleSliderInput(event: Event) {
    const raw = parseFloat((event.currentTarget as HTMLInputElement).value);
    if (timeline && 'seek' in timeline) timeline.seek(raw);
    sliderValue = raw;
  }

  // Drag-pause (mirrors TimeSlider behavior).
  let wasPlayingAtDragStart = false;
  function handleDragStart() {
    if (!timeline) return;
    wasPlayingAtDragStart = timeline.isPlaying;
    timeline.pause();
  }
  function handleDragEnd() {
    if (!timeline) return;
    if (wasPlayingAtDragStart) timeline.play();
    wasPlayingAtDragStart = false;
  }

  function togglePlay() {
    if (!timeline) return;
    if (timeline.isPlaying) timeline.pause();
    else timeline.play();
    playing = timeline.isPlaying;
  }

  // --- Derived ---
  $: playheadFraction = (sliderValue - min) / (max - min);
  // Live pixel offsets (relative to .track-wrap) for the bubbles/
  // connectors — computed from measured track geometry so they line up
  // with the actual browser-drawn thumb position, not the raw percentage.
  // Reference trackLeft/trackWidth explicitly so legacy reactivity picks
  // up the dependency and re-derives when measureTrack() writes to them.
  $: playheadX =
    trackWidth > 0
      ? trackLeft + THUMB_W / 2 + Math.max(0, Math.min(1, playheadFraction)) * (trackWidth - THUMB_W)
      : 0;
  $: hoverX =
    hoverFraction !== null && trackWidth > 0
      ? trackLeft + THUMB_W / 2 + Math.max(0, Math.min(1, hoverFraction)) * (trackWidth - THUMB_W)
      : 0;
  $: activeChapter = chapterAt(sliderValue).chapter;
  $: activeLabel = activeChapter?.label ?? '';
  // The chapter the cursor is currently over (null when not hovering).
  $: hoverChapter =
    hoverFraction !== null
      ? chapterAt(min + hoverFraction * (max - min)).chapter
      : null;
  // Are we hovering over a chapter DIFFERENT from the one the playhead is on?
  $: isPreviewingOtherChapter =
    hoverChapter !== null &&
    activeChapter !== null &&
    hoverChapter.label !== activeChapter.label;
  $: activeBubbleOpacity = isPreviewingOtherChapter ? 0.35 : 1;
  $: showHoverBubble = isPreviewingOtherChapter;
</script>

<div class="narrated-timeline" class:disabled>
  <div class="row" style="max-width: {maxWidth};">
    {#if showPlayButton}
      <button
        type="button"
        class="play-button"
        onclick={togglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
        {disabled}
      >
        {#if playing}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        {:else}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        {/if}
      </button>
    {/if}

    <div
      class="track-wrap"
      bind:this={trackWrapEl}
      onmousemove={handleTrackMouseMove}
      onmouseleave={handleTrackMouseLeave}
      role="presentation"
    >
      <Slider
        value={sliderValue}
        {min}
        {max}
        step={0.001}
        {disabled}
        {color}
        showTicks={false}
        showLabel={false}
        dragEnabled={true}
        onInput={handleSliderInput}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        {maxWidth}
      />

      <!-- Active bubble + its connector line down to the current playhead.
           Dimmed to `activeBubbleOpacity` while the reader is hover-previewing
           a different chapter, so both bubbles stay legible at once.
           Positions are measured PIXEL offsets so they line up with the
           real thumb position (compensating for the browser's native
           thumb-travel padding on <input type="range">). -->
      {#if activeLabel && trackWidth > 0}
        <div
          class="bubble bubble-active"
          aria-live="polite"
          style="left: {playheadX}px; top: {trackCenterY}px; color: {narrationColor}; font-size: {narrationSize}; opacity: {activeBubbleOpacity};"
        >
          {activeLabel}
        </div>
        <div
          class="bubble-connector bubble-connector-active"
          style="left: {playheadX}px; top: {trackCenterY}px; background: {narrationColor}; opacity: {activeBubbleOpacity};"
        ></div>
      {/if}

      <!-- Hover-preview bubble + its connector, only shown when the cursor
           is on a chapter different from the active one. -->
      {#if showHoverBubble && hoverFraction !== null && hoverLabel && trackWidth > 0}
        <div
          class="bubble bubble-hover"
          aria-live="polite"
          style="left: {hoverX}px; top: {trackCenterY}px; color: {narrationColor}; font-size: {narrationSize};"
        >
          {hoverLabel}
        </div>
        <div
          class="bubble-connector bubble-connector-hover"
          style="left: {hoverX}px; top: {trackCenterY}px; background: {narrationColor};"
        ></div>
      {/if}
    </div>

    <div class="spacer"></div>
  </div>
</div>

<style>
  .narrated-timeline {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Reserve minimal headroom above the slider for the hover bubble. */
    padding-top: 1.6em;
  }

  .narrated-timeline.disabled {
    pointer-events: none;
    opacity: 0.5;
  }

  .row {
    display: flex;
    align-items: center;
    width: 100%;
  }

  .play-button {
    width: 32px;
    height: 32px;
    padding: 0;
    margin-right: 12px;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    transition: opacity 0.2s;
    flex-shrink: 0;
    color: #333;
  }
  .play-button:hover {
    opacity: 1;
  }
  .play-button:disabled {
    cursor: not-allowed;
    opacity: 0.3;
  }

  .track-wrap {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }

  /* Narration bubble anchored to the actual thumb-center pixel position.
     `left` is a pixel offset (from .track-wrap's left edge, computed live
     in script), `top` is the measured track-center Y (also from live
     geometry) — this way the bubble lines up exactly with the visible
     thumb, not the raw wrapper edge. */
  .bubble {
    position: absolute;
    left: 0;
    top: 0;
    /* Lift the bubble so its bottom edge sits `--bubble-gap` above the
       track center. */
    --bubble-gap: 22px;
    transform: translate(-50%, calc(-100% - var(--bubble-gap)));
    white-space: nowrap;
    font-weight: 500;
    letter-spacing: 0.02em;
    line-height: 1.3;
    pointer-events: none;
    z-index: 4;
    transition: opacity 0.18s ease;
  }
  /* The active bubble smoothly follows the playhead; the hover bubble is
     placed instantaneously by the cursor (no left-transition — that
     introduced visible lag between the cursor and the stem). */
  .bubble-active {
    transition: left 40ms linear, opacity 0.18s ease;
  }
  .bubble-hover {
    transition: opacity 0.18s ease;
  }

  /* Thin vertical connector from the track center up into the bubble
     underside — anchored to the SAME (left, top) as the bubble so it's
     horizontally centered on the thumb. `top` is set inline to the
     measured track center; we grow upward from there. */
  .bubble-connector {
    position: absolute;
    left: 0;
    top: 0;
    /* Centered on the thumb, then nudged 1px right so the stem sits
       just to the right of the thumb's midline. */
    transform: translate(calc(-50% + 1px), -100%);
    width: 1.5px;
    /* Shorter than --bubble-gap (22px) so the top of the line stops a
       few pixels below the bubble baseline. */
    height: 16px;
    pointer-events: none;
    z-index: 3;
    transition: opacity 0.18s ease;
  }
  /* Active connector smooths with the playhead's tempus ticks so it
     glides along with the fill; hover connector reacts instantly to
     cursor movement (no left-transition, otherwise the stem lags the
     cursor visibly). */
  .bubble-connector-active {
    transition: left 40ms linear, opacity 0.18s ease;
  }

  .spacer {
    width: 32px;
    margin-left: 12px;
    flex-shrink: 0;
  }
</style>
