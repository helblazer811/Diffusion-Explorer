<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import { Timeline, useVisibilityHandler, Katex } from '@diffusion-explorer/ui';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  let {
    width = 1100,
    height = 550,
    numImages = 30,
    seed = 42,
    revealInterval = 300,
  }: {
    width?: number;
    height?: number;
    numImages?: number;
    seed?: number;
    revealInterval?: number;
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let containerEl: HTMLDivElement;

  type ImageItem = {
    src: string;
    x: number;
    y: number;
    size: number;
    blur: number;
    z: number;
    rotation: number;
  };

  let imageData: ImageItem[] = $state([]);

  const imageFiles = [
    'image_00001.jpg', 'image_00100.jpg', 'image_00200.jpg',
    'image_00300.jpg', 'image_00400.jpg', 'image_00500.jpg',
    'image_00600.jpg', 'image_00700.jpg', 'image_00800.jpg',
    'image_00900.jpg', 'image_01000.jpg', 'image_01100.jpg',
    'image_01200.jpg', 'image_01300.jpg', 'image_01400.jpg',
    'image_01500.jpg', 'image_01600.jpg', 'image_01700.jpg',
    'image_01800.jpg', 'image_01900.jpg', 'image_02000.jpg',
    'image_02100.jpg', 'image_02200.jpg', 'image_02300.jpg',
    'image_02400.jpg', 'image_02500.jpg', 'image_02600.jpg',
    'image_02700.jpg', 'image_02800.jpg', 'image_02900.jpg',
  ];

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function mulberry32(a: number) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function gaussianPair(rng: () => number): [number, number] {
    const u1 = rng();
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    return [r * Math.cos(theta), r * Math.sin(theta)];
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function generateLayout(): ImageItem[] {
    const rng = mulberry32(seed);
    const cy = height / 2;

    // Two Gaussian clusters, spread apart horizontally
    const clusters = [
      { cx: width * 0.30, cy: cy },
      { cx: width * 0.70, cy: cy },
    ];
    const spreadX = width * 0.14;
    const spreadY = height * 0.22;

    const items: ImageItem[] = [];

    for (let i = 0; i < numImages; i++) {
      // Pick a cluster
      const cluster = clusters[i % clusters.length];
      const [gx, gy] = gaussianPair(rng);
      const margin = 120;
      let x = cluster.cx + gx * spreadX;
      let y = cluster.cy + gy * spreadY;

      // Clamp to keep images within bounds with margin
      x = Math.max(margin, Math.min(width - margin, x));
      y = Math.max(margin, Math.min(height - margin, y));

      const dist = Math.sqrt(gx * gx + gy * gy) / 3;
      const depthNorm = Math.min(dist, 1);

      const minSize = 60;
      const maxSize = 160;
      const size = maxSize - depthNorm * (maxSize - minSize);
      const blur = depthNorm * 4;
      const z = Math.round((1 - depthNorm) * 100);
      const rotation = (rng() - 0.5) * 20;

      items.push({
        src: `${base}/flower_samples/${imageFiles[i % imageFiles.length]}`,
        x: x - size / 2,
        y: y - size / 2,
        size,
        blur,
        z,
        rotation,
      });
    }

    // Sort by z descending: foreground (high z) first in array for reveal order,
    // but CSS z-index handles visual stacking
    items.sort((a, b) => b.z - a.z);
    return items;
  }

  // ----------------------------------------------------------------
  // Animation
  // ----------------------------------------------------------------

  // State: opacity per image (keyed by index)
  type AnimState = Record<string, number>;

  const fadeDuration = 0.15; // fraction of timeline each fade takes
  const totalDuration = (revealInterval * numImages) / 1000; // seconds

  const timeline = new Timeline<AnimState>();
  timeline.duration = totalDuration;

  // Build initial state: all images start at opacity 0, callout hidden
  const initState: AnimState = {};
  for (let i = 0; i < numImages; i++) {
    initState[`img${i}`] = 0;
  }
  initState['callout'] = 0;
  timeline.initialState = initState;

  // Reserve last 15% of timeline for the callout
  const imagePhase = 0.8; // images fade in during first 80%
  const calloutStart = 0.83;
  const calloutEnd = 0.95;

  // Add a fade-in clip for each image, staggered within image phase
  for (let i = 0; i < numImages; i++) {
    const start = (i / numImages) * imagePhase;
    const end = Math.min(start + fadeDuration, imagePhase);
    const key = `img${i}`;

    timeline.add({
      name: `FadeIn_${i}`,
      reduce(t: number) {
        return { [key]: t } as Partial<AnimState>;
      },
    }, { start, end });
  }

  // Callout annotation fade-in
  timeline.add({
    name: 'CalloutFadeIn',
    reduce(t: number) {
      return { callout: t } as Partial<AnimState>;
    },
  }, { start: calloutStart, end: calloutEnd });

  let opacities = $state<AnimState>(initState);

  timeline.onTick((_t: number, state: Readonly<AnimState>) => {
    opacities = { ...state };
  });

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  let visible = $state(false);
  let hasPlayed = false;

  const { visibilityAction } = useVisibilityHandler(() => visible, timeline);

  $effect(() => {
    if (visible && !hasPlayed) {
      hasPlayed = true;
      timeline.reset();
      timeline.play();
    }
  });

  export function restart() {
    timeline.reset();
    timeline.play();
  }

  onMount(() => {
    imageData = generateLayout();
  });

  onDestroy(() => {
    timeline.pause();
  });
</script>

<div
  class="flower-distribution"
  bind:this={containerEl}
  use:visibilityAction
  style="width: {width}px; height: {height}px; position: relative; overflow: hidden;"
>
  {#each imageData as img, i}
    <img
      src={img.src}
      alt=""
      style="
        position: absolute;
        left: {img.x}px;
        top: {img.y}px;
        width: {img.size}px;
        height: {img.size}px;
        object-fit: cover;
        border-radius: 8px;
        z-index: {img.z};
        transform: rotate({img.rotation}deg) scale({0.5 + 0.5 * (opacities[`img${i}`] ?? 0)});
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        opacity: {opacities[`img${i}`] ?? 0};
      "
    />
  {/each}

  <!-- Callout: line + "x" label from top-right-most image -->
  {#if imageData.length > 0}
    {@const target = imageData.reduce((best, img) => (img.x - img.y > best.x - best.y) ? img : best, imageData[0])}
    {@const imgRight = target.x + target.size + 5}
    {@const imgTop = target.y}
    {@const labelCx = imgRight + 60}
    {@const labelCy = imgTop - 50}
    {@const calloutOpacity = opacities['callout'] ?? 0}
    <svg
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 200; pointer-events: none; opacity: {calloutOpacity};"
    >
      <line
        x1={imgRight}
        y1={imgTop + 10}
        x2={labelCx}
        y2={labelCy + 20}
        stroke="#333"
        stroke-width="2"
      />
    </svg>
    <div
      style="
        position: absolute;
        left: {labelCx}px;
        top: {labelCy}px;
        transform: translate(-50%, -50%);
        z-index: 200;
        opacity: {calloutOpacity};
        font-size: 1.4em;
        background: white;
        padding: 2px 8px;
        border-radius: 4px;
      "
    >
      <Katex math={"x"} />
    </div>
  {/if}
</div>
