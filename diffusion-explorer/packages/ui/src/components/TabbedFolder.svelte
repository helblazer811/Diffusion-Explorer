<script module lang="ts">
  export type Stage = {
    label: string;
    description: string;
    startTime: number;
    endTime: number;
  };
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Snippet } from 'svelte';
  import type { Player } from '@helblazer811/tempus';

  interface Props {
    player: Player<unknown> | null;
    stages: Stage[];
    children: Snippet;
    maxWidth?: string;
    accentColor?: string;
    borderColor?: string;
    bodyBackground?: string;
    inactiveTabBackground?: string;
    tabTextColor?: string;
    /** Tab bar height in px. */
    tabHeight?: number;
    /** Radius (px) of the concave curves where each tab meets the folder body. */
    tabFlareRadius?: number;
    /** Gap between adjacent tabs along the folder body top, in px. */
    tabGap?: number;
    /** Distance (px) from the folder's left edge to the first tab's left flare start. */
    tabInsetLeft?: number;
    /** Radius (px) for the folder body's rounded corners. */
    cornerRadius?: number;
    /** Stroke width for the folder outline. */
    strokeWidth?: number;
  }

  let {
    player,
    stages,
    children,
    maxWidth = '100%',
    accentColor = '#F1942B',
    borderColor = '#c8ccd1',
    bodyBackground = '#f9f9f9',
    inactiveTabBackground = '#eaecef',
    tabTextColor = '#555',
    tabHeight = 34,
    tabFlareRadius = 8,
    tabGap = 4,
    tabInsetLeft = 16,
    cornerRadius = 6,
    strokeWidth = 1
  }: Props = $props();

  // --- Player time tracking ---
  let currentTime = $state(0);
  let unsubscribe: (() => void) | null = null;

  $effect(() => {
    unsubscribe?.();
    unsubscribe = null;
    if (player) {
      currentTime = player.t;
      unsubscribe = player.onTick((t) => {
        currentTime = t;
      });
    }
  });

  onDestroy(() => {
    unsubscribe?.();
  });

  // Floor-search: last stage whose startTime <= currentTime.
  const activeIndex = $derived.by(() => {
    if (stages.length === 0) return -1;
    let idx = 0;
    for (let i = 0; i < stages.length; i++) {
      if (stages[i].startTime <= currentTime + 1e-9) idx = i;
      else break;
    }
    return idx;
  });

  const activeStage = $derived(activeIndex >= 0 ? stages[activeIndex] : null);

  function selectStage(i: number) {
    const s = stages[i];
    if (!s || !player) return;
    player.seek(s.startTime);
  }

  // --- Layout: measure tab widths, container width ---
  // Each tab label lives in a hidden measurer div; we bind clientWidth per tab
  // to compute the SVG geometry. Falls back to a coarse estimate before mount.
  let containerWidth = $state(0);
  let tabWidths: number[] = $state([]);

  // Rebuild the widths array whenever stages change.
  $effect(() => {
    if (tabWidths.length !== stages.length) {
      tabWidths = stages.map((_, i) => tabWidths[i] ?? 90);
    }
  });

  // Tab layout. Each tab has:
  //   - Flat top region of width `tabWidths[i]` (where the label sits)
  //   - Vertical sides, then concave (inward-curving) flares at the bottom
  //     where the tab meets the folder body — a smooth transition instead of
  //     a sharp 90° step.
  // Each tab's footprint at the folder body top spans
  // [tLefts[i] - flareR, tLefts[i] + tabWidths[i] + flareR]. Gap between the
  // flare-out points of adjacent tabs is `tabGap`.
  const tabLefts = $derived.by(() => {
    const arr: number[] = [];
    const flareR = Math.max(0, tabFlareRadius);
    // Every tab is inset from the folder's left edge so its concave left
    // flare fits on the folder body top. Starting inset = `tabInsetLeft`,
    // which by default sits `flareR` past the folder body's rounded top-left
    // corner so the flare doesn't overlap the corner.
    let x = tabInsetLeft;
    for (let i = 0; i < tabWidths.length; i++) {
      arr.push(x);
      x += (tabWidths[i] ?? 0) + 2 * flareR + tabGap;
    }
    return arr;
  });

  // Body geometry — the "folder body" sits below the tab bar.
  // Overall SVG dimensions: width = containerWidth, height = tabHeight + bodyContentHeight.
  // We only measure the SHELL height; content height comes from the child slot.
  let contentHeight = $state(200);
  const svgHeight = $derived(tabHeight + contentHeight);
  const svgWidth = $derived(containerWidth || 800);

  // Build a single stroked outline path around the tabs + folder body.
  // Coordinate system: SVG top-left = (0, 0). Tab tops sit at y = strokeWidth/2.
  // Folder body top edge is at y = tabHeight.
  // Path traces clockwise from bottom-left.
  const outlinePath = $derived.by(() => {
    if (stages.length === 0) return '';
    const sw = strokeWidth / 2;
    const w = Math.max(1, svgWidth - strokeWidth);
    const h = Math.max(1, svgHeight - strokeWidth);
    const yTabTop = sw;
    const yBodyTop = tabHeight;
    const xLeft = sw;
    const xRight = xLeft + w;
    const yBottom = sw + h;
    const r = Math.min(cornerRadius, Math.min(w, h) / 2);
    const flareR = Math.max(0, tabFlareRadius);

    let d = '';
    // Start at the folder body's bottom-left rounded corner and trace clockwise.
    d += `M ${xLeft} ${yBottom - r}`;
    d += ` L ${xLeft} ${yBodyTop + r}`;
    // Rounded top-left of the folder body.
    d += ` Q ${xLeft} ${yBodyTop} ${xLeft + r} ${yBodyTop}`;

    // For each tab i, at the folder body top:
    //   1. Across the folder body top to the tab's left flare start
    //   2. Concave left flare up into the tab
    //   3. Straight up to the top-left rounded corner
    //   4. Rounded top-left convex corner
    //   5. Across the top
    //   6. Rounded top-right convex corner
    //   7. Straight down the right side
    //   8. Concave right flare back out to the folder body top
    for (let i = 0; i < stages.length; i++) {
      const tLeft = tabLefts[i] + xLeft;
      const tWidth = tabWidths[i] ?? 0;
      const tRight = tLeft + tWidth;

      d += ` L ${tLeft - flareR} ${yBodyTop}`;
      d += ` A ${flareR} ${flareR} 0 0 0 ${tLeft} ${yBodyTop - flareR}`;
      d += ` L ${tLeft} ${yTabTop + r}`;
      d += ` Q ${tLeft} ${yTabTop} ${tLeft + r} ${yTabTop}`;
      d += ` L ${tRight - r} ${yTabTop}`;
      d += ` Q ${tRight} ${yTabTop} ${tRight} ${yTabTop + r}`;
      d += ` L ${tRight} ${yBodyTop - flareR}`;
      d += ` A ${flareR} ${flareR} 0 0 0 ${tRight + flareR} ${yBodyTop}`;
    }

    // After the last tab: across the remaining folder body top.
    d += ` L ${xRight - r} ${yBodyTop}`;

    // Top-right corner of folder body.
    d += ` Q ${xRight} ${yBodyTop} ${xRight} ${yBodyTop + r}`;
    // Down the right side.
    d += ` L ${xRight} ${yBottom - r}`;
    // Bottom-right corner.
    d += ` Q ${xRight} ${yBottom} ${xRight - r} ${yBottom}`;
    // Across the bottom.
    d += ` L ${xLeft + r} ${yBottom}`;
    // Bottom-left corner.
    d += ` Q ${xLeft} ${yBottom} ${xLeft} ${yBottom - r}`;
    d += ' Z';
    return d;
  });

  // Per-tab fill path. Silhouette matches the outline pass for this tab:
  // concave flare on the left → up the left side → rounded top → down the
  // right side → concave flare back out to the folder body top.
  function tabFillPath(i: number): string {
    const sw = strokeWidth / 2;
    const tLeft = tabLefts[i] + sw;
    const tWidth = tabWidths[i] ?? 0;
    const tRight = tLeft + tWidth;
    const yTabTop = sw;
    const yBodyTop = tabHeight;
    const r = Math.min(cornerRadius, tWidth / 2);
    const flareR = Math.max(0, tabFlareRadius);
    // Start at the left flare's outer point on the folder body top.
    let d = `M ${tLeft - flareR} ${yBodyTop}`;
    // Concave flare up into the tab's left side.
    d += ` A ${flareR} ${flareR} 0 0 0 ${tLeft} ${yBodyTop - flareR}`;
    // Up the left side.
    d += ` L ${tLeft} ${yTabTop + r}`;
    // Top-left convex corner.
    d += ` Q ${tLeft} ${yTabTop} ${tLeft + r} ${yTabTop}`;
    // Across the top.
    d += ` L ${tRight - r} ${yTabTop}`;
    // Top-right convex corner.
    d += ` Q ${tRight} ${yTabTop} ${tRight} ${yTabTop + r}`;
    // Down the right side.
    d += ` L ${tRight} ${yBodyTop - flareR}`;
    // Concave flare back down to the folder body top.
    d += ` A ${flareR} ${flareR} 0 0 0 ${tRight + flareR} ${yBodyTop}`;
    d += ' Z';
    return d;
  }

  // Body fill path — a rounded rectangle for the folder body area.
  const bodyFillPath = $derived.by(() => {
    const sw = strokeWidth / 2;
    const w = Math.max(1, svgWidth - strokeWidth);
    const yTop = tabHeight;
    const yBottom = sw + Math.max(1, svgHeight - strokeWidth);
    const r = Math.min(cornerRadius, Math.min(w, yBottom - yTop) / 2);
    const xL = sw;
    const xR = sw + w;
    let d = `M ${xL} ${yTop}`;
    d += ` L ${xR} ${yTop}`;
    d += ` L ${xR} ${yBottom - r}`;
    d += ` Q ${xR} ${yBottom} ${xR - r} ${yBottom}`;
    d += ` L ${xL + r} ${yBottom}`;
    d += ` Q ${xL} ${yBottom} ${xL} ${yBottom - r}`;
    d += ' Z';
    return d;
  });
</script>

<div
  class="tabbed-folder"
  bind:clientWidth={containerWidth}
  style="
    max-width: {maxWidth};
    --accent: {accentColor};
    --border: {borderColor};
    --body-bg: {bodyBackground};
    --tab-inactive-bg: {inactiveTabBackground};
    --tab-text: {tabTextColor};
    --stroke-width: {strokeWidth}px;
    --tab-height: {tabHeight}px;
  "
>
  {#if stages.length > 0 && svgWidth > 0}
    <svg
      class="folder-shell"
      width={svgWidth}
      height={svgHeight}
      viewBox="0 0 {svgWidth} {svgHeight}"
      aria-hidden="true"
    >
      <!-- Fills: inactive tabs, body, then active tab (on top of body top edge) -->
      {#each stages as _, i}
        {#if i !== activeIndex}
          <path d={tabFillPath(i)} fill={inactiveTabBackground} />
        {/if}
      {/each}
      <path d={bodyFillPath} fill={bodyBackground} />
      {#if activeIndex >= 0}
        <path d={tabFillPath(activeIndex)} fill={bodyBackground} />
      {/if}
      <!-- Bottom edge stroke for inactive tabs: without this the tab bottom
           blends into the folder body since both are sitting at yBodyTop.
           Stroke each inactive tab's fill silhouette so its bottom line is
           drawn along with its sides and top. -->
      {#each stages as _, i}
        {#if i !== activeIndex}
          <path
            d={tabFillPath(i)}
            fill="none"
            stroke={borderColor}
            stroke-width={strokeWidth}
            stroke-linejoin="round"
          />
        {/if}
      {/each}
      <!-- Outer outline stroke on top of all fills -->
      <path
        d={outlinePath}
        fill="none"
        stroke={borderColor}
        stroke-width={strokeWidth}
        stroke-linejoin="round"
      />
    </svg>
  {/if}

  <!-- HTML tab label buttons, positioned to sit on top of the SVG tabs.
       Buttons auto-size to their text; we measure their rendered width and
       feed it back into the SVG shell geometry. -->
  <div class="tab-labels" style="height: {tabHeight}px;">
    {#each stages as s, i}
      <button
        type="button"
        role="tab"
        aria-selected={i === activeIndex}
        class="tab-label"
        class:active={i === activeIndex}
        style="left: {tabLefts[i]}px;"
        bind:clientWidth={tabWidths[i]}
        onclick={() => selectStage(i)}
      >
        <span class="tab-label-text">{s.label}</span>
      </button>
    {/each}
  </div>

  <div class="folder-content" bind:clientHeight={contentHeight}>
    {#if activeStage}
      <div class="header">
        <div class="header-description">{activeStage.description}</div>
      </div>
    {/if}

    <div class="content">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .tabbed-folder {
    position: relative;
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }

  .folder-shell {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 0;
    display: block;
  }

  .tab-labels {
    position: relative;
    z-index: 1;
    width: 100%;
  }

  .tab-label {
    position: absolute;
    top: 0;
    /* left/width set inline */
    height: var(--tab-height);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 18px;
    box-sizing: border-box;
    background: transparent;
    border: none;
    margin: 0;
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--tab-text);
    cursor: pointer;
    transition: color 0.15s ease;
    white-space: nowrap;
    line-height: 1;
  }

  .tab-label:hover:not(.active) {
    color: #333;
  }

  .tab-label:focus {
    outline: none;
  }

  .tab-label:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
    border-radius: 6px;
  }

  .tab-label.active {
    color: #222;
    font-weight: 600;
  }

  .tab-label-text {
    display: inline-block;
  }

  .folder-content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
  }

  .header {
    padding: 10px 16px 8px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }

  .header-description {
    font-size: 0.92rem;
    line-height: 1.45;
    color: #666;
  }

  .content {
    padding: 8px 12px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
  }

  .content :global(svg),
  .content :global(canvas) {
    width: 100%;
    height: auto;
    display: block;
  }

  @media (max-width: 600px) {
    .tab-label {
      font-size: 0.85rem;
      padding: 0 12px;
    }
    .header-description {
      font-size: 0.85rem;
    }
  }
</style>
