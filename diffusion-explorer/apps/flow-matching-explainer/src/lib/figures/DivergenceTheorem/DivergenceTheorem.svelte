<!-- Visualizes the Divergence Theorem with surface integral (left) and volume integral (right) side by side. -->

<script lang="ts">
  import { DoubleFigure } from "@diffusion-explorer/ui";
  import SurfaceIntegral from "./SurfaceIntegral.svelte";
  import VolumeIntegral from "./VolumeIntegral.svelte";
  import { createClosedCurve, createWavyVectorField, createUniformRightField } from "./divergence_theorem";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot
  export let children = undefined;

  // Layout
  export let width = 800;
  export let height = 350;
  export let gap = 20;
  export let backgroundVisible = false;

  // Animation
  export let playingByDefault = true;

  // Curve parameters
  export let baseRadius = 0.85;
  export let curveAmplitudes = [0.2, 0.15, 0.1];
  export let curvePhases = [0, 0.7, 1.3];
  export let curveFrequencies = [1, 2, 3];

  // Vector field parameters
  export let wavyAmplitude = 0.3;
  export let wavyFrequency = 1.5;

  // Grid parameters
  export let gridResolution = 6;

  // Surface styling
  export let surfaceOpacity = 0.7;
  export let surfaceFillColor = "#fff7ed";  // Slight orange tint
  export let surfaceStrokeColor = "#f97316";  // Orange
  export let surfaceStrokeWidth = 3;

  // Overlay opacity (white rectangle between streamlines and surface)
  export let overlayOpacity = 0.7;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Visibility state passed to DoubleFigure
  let figureIsActive;

  // Compute canvas dimensions
  $: canvasWidth = Math.floor((width - gap) / 2);
  $: canvasHeight = height;

  // Create the curve and field functions using imported helpers
  $: curveFn = createClosedCurve({
    baseRadius,
    amplitudes: curveAmplitudes,
    phases: curvePhases,
    frequencies: curveFrequencies
  });

  $: vectorFieldFn = createWavyVectorField({
    amplitude: wavyAmplitude,
    frequency: wavyFrequency
  });
  // $: vectorFieldFn = createUniformRightField();
</script>

<DoubleFigure {gap} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet left()}
    <SurfaceIntegral
      {curveFn}
      {vectorFieldFn}
      width={canvasWidth}
      height={canvasHeight}
      {surfaceOpacity}
      {surfaceFillColor}
      {surfaceStrokeColor}
      {surfaceStrokeWidth}
      {overlayOpacity}
      {playingByDefault}
      isActive={figureIsActive}
    />
  {/snippet}

  {#snippet right()}
    <VolumeIntegral
      {curveFn}
      {vectorFieldFn}
      width={canvasWidth}
      height={canvasHeight}
      {gridResolution}
      {surfaceOpacity}
      {surfaceFillColor}
      {surfaceStrokeColor}
      {surfaceStrokeWidth}
      {overlayOpacity}
      isActive={figureIsActive}
    />
  {/snippet}

  {#snippet caption()}
    {@render children?.()}
  {/snippet}
</DoubleFigure>
