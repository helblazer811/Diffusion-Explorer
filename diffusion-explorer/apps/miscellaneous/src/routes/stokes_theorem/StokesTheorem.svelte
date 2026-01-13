<!-- Visualizes Stokes' Theorem with line integral (left) and curl integral (right) side by side. -->

<script lang="ts">
  import { DoubleFigure, Katex } from "@diffusion-explorer/ui";
  import LineIntegral from "./LineIntegral.svelte";
  import CurlIntegral from "./CurlIntegral.svelte";
  import { createClosedCurve, createWavyVectorField } from "./stokes_theorem";

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

  // Curve parameters (irregular blob shape)
  export let baseRadius = 1.3;
  export let curveAmplitudes = [0.3, 0.22, 0.15];
  export let curvePhases = [0, 0.7, 1.3];
  export let curveFrequencies = [1, 2, 3];

  // Vector field parameters (wavy field like divergence theorem)
  export let wavyAmplitude = 0.3;
  export let wavyFrequency = 1.5;

  // Surface styling (orange tint like divergence theorem)
  export let surfaceOpacity = 0.7;
  export let surfaceFillColor = "#fff7ed"; // Slight orange tint
  export let surfaceStrokeColor = "#f97316"; // Orange
  export let surfaceStrokeWidth = 3;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Visibility state passed to DoubleFigure
  let figureIsActive;

  // Compute canvas dimensions
  $: canvasWidth = Math.floor((width - gap) / 2);
  $: canvasHeight = height;

  // Create the curve and field functions
  $: curveFn = createClosedCurve({
    baseRadius,
    amplitudes: curveAmplitudes,
    phases: curvePhases,
    frequencies: curveFrequencies,
  });

  $: vectorFieldFn = createWavyVectorField({
    amplitude: wavyAmplitude,
    frequency: wavyFrequency,
  });
</script>

<h2 class="stokes-theorem-title">A Visualization of Stokes' Theorem</h2>

<div class="stokes-theorem-equation">
  <Katex
    math={"\\qquad \\oint_C \\mathbf{F} \\cdot d\\mathbf{r} \\qquad\\qquad = \\qquad\\qquad \\iint_S (\\nabla \\times \\mathbf{F}) \\cdot dS"}
    displayMode={true}
  />
</div>

<DoubleFigure {gap} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet left()}
    <LineIntegral
      {curveFn}
      {vectorFieldFn}
      width={canvasWidth}
      height={canvasHeight}
      {surfaceOpacity}
      {surfaceFillColor}
      {surfaceStrokeColor}
      {surfaceStrokeWidth}
      {playingByDefault}
      isActive={figureIsActive}
      labelText="C"
    />
  {/snippet}

  {#snippet right()}
    <CurlIntegral
      {curveFn}
      {vectorFieldFn}
      width={canvasWidth}
      height={canvasHeight}
      {surfaceOpacity}
      {surfaceFillColor}
      {surfaceStrokeColor}
      {surfaceStrokeWidth}
      {playingByDefault}
      isActive={figureIsActive}
      labelText="S"
    />
  {/snippet}

  {#snippet caption()}
    {@render children?.()}
  {/snippet}
</DoubleFigure>

<style>
  .stokes-theorem-title {
    text-align: center;
    margin-bottom: 0.5em;
    color: #4b5563;
    font-weight: 600;
    font-size: 1.9rem;
  }

  .stokes-theorem-equation {
    text-align: center;
    margin-bottom: 0.75em;
    color: #4b5563;
  }
</style>
