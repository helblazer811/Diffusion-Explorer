<script lang="ts">
  import * as tf from "@tensorflow/tfjs";
  import { onMount, onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import { DoubleFigure, PlayButton } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Types
  // ----------------------------------------------------------------

  interface EulerResult {
    t: number[];
    y: number[];
  }

  interface GroundTruthPoint {
    t: number;
    y: number;
  }

  interface AnimationData {
    highCurvatureGT: GroundTruthPoint[];
    highCurvatureEuler: EulerResult;
    lowCurvatureGT: GroundTruthPoint[];
    lowCurvatureEuler: EulerResult;
  }

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Layout props
  export let width = 400;
  export let height = 550;
  export let gap = 20;
  export let marginWidth = 80;
  export let marginHeight = 60;
  export let backgroundVisible = true;

  // Styling props
  export let groundTruthColor = "#888888";
  export let eulerColor = "#f17720";
  export let lineWidth = 6;
  export let eulerLineWidth = 6;

  // Simulation props
  export let numSteps = 5;
  export let deltaT = 2.5;
  export let groundTruthDeltaT = 0.05;

  // Animation timing props
  export let perStepDuration = 400;
  export let perStepDelay = 250;
  export let fullAnimationDelay = 500;
  export let repeatAnimation = true;
  export let repeatDelay = 1500;

  // Label props
  export let labelFontSize = 52;
  export let labelColor = settings.stylingSettings.label.color;
  export let labelOpacity = settings.stylingSettings.label.opacity;
  export let labelYShiftFactor = 0;
  export let highCurvatureLabel = "Curved Function";
  export let lowCurvatureLabel = "Almost Straight Function";

  // Caption
  export let children: any = undefined;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Computed domain from numSteps and deltaT
  $: domain = [0, numSteps * deltaT];

  // Calculate total cycle duration
  $: totalCycleDuration =
    fullAnimationDelay +
    numSteps * perStepDuration +
    (numSteps - 1) * perStepDelay;

  // Y-scale factors for each panel
  const highCurvatureYScaleFactor = 1;
  const lowCurvatureYScaleFactor = 5;

  // SVG element references
  let leftSvg: SVGSVGElement | undefined;
  let rightSvg: SVGSVGElement | undefined;

  // Visibility-based animation control
  let figureIsActive: Writable<boolean>;
  let isInitialized = false;
  let wasAnimatingBeforeHidden = false;
  let shouldAnimate = true;
  let activeTimeoutIds: ReturnType<typeof setTimeout>[] = [];

  // Play button state
  let isPlaying = true;
  let normalizedTime = 0;
  let animationStartTime = 0;
  let timeTrackingFrameId: number | null = null;

  // Store animation data for restart
  let animationData: AnimationData | null = null;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // ODE Functions
  function highCurvatureODE(t: number, y: number): number {
    // Downward parabola: y = 0.1 * t * (4*PI - t)
    // dy/dt = 0.1 * (4*PI - 2*t)
    const dydt = 0.1 * (4 * Math.PI - 2 * t);
    return dydt;
  }

  function highCurvatureGroundTruth(t: number): number {
    // Parabola peaking at t = 2*PI, passing through (0,0) and (4*PI, 0)
    // y = 0.1 * t * (4*PI - t)
    return 0.1 * t * (4 * Math.PI - t);
  }

  function lowCurvatureODE(t: number, y: number): number {
    return tf.tidy(() => {
      const tTensor = tf.scalar(t);

      // Define dy/dt = 0.1 * t (integrates to parabola)
      const dydt = tf.mul(tf.scalar(0.02), tTensor);

      return dydt.dataSync()[0];
    });
  }

  function lowCurvatureGroundTruth(t: number): number {
    // y(t) = 0.05 * t^2
    return 0.01 * t * t;
  }

  // Euler Method
  function eulerMethod(odeFunc: (t: number, y: number) => number, t0: number, y0: number, tEnd: number, dt: number): EulerResult {
    const tValues: number[] = [];
    const yValues: number[] = [];

    let t = t0;
    let y = y0;

    while (t <= tEnd) {
      tValues.push(t);
      yValues.push(y);

      const dydt = odeFunc(t, y);
      y = y + dt * dydt;
      t = t + dt;
    }

    return { t: tValues, y: yValues };
  }

  // Create Scales
  function createScales(
    data: EulerResult,
    groundTruth: GroundTruthPoint[],
    svgWidth: number,
    svgHeight: number,
    yScaleFactor: number = 1
  ): { xScale: d3.ScaleLinear<number, number>; yScale: d3.ScaleLinear<number, number> } {
    const allT = [...data.t, ...groundTruth.map((d) => d.t)];
    const allY = [...data.y, ...groundTruth.map((d) => d.y)];

    const xScale = d3
      .scaleLinear()
      .domain([Math.min(...allT), Math.max(...allT)])
      .range([marginWidth, svgWidth - marginWidth]);

    const yMin = Math.min(...allY);
    const yMax = Math.max(...allY);
    const yCenter = (yMin + yMax) / 2;
    const yRange = (yMax - yMin) * yScaleFactor;

    // Shift the y-center down to give more space for the label at the top
    const yCenterOffset = -yRange * 0.15;

    const yScale = d3
      .scaleLinear()
      .domain([
        yCenter - yRange / 2 - yCenterOffset,
        yCenter + yRange / 2 - yCenterOffset,
      ])
      .range([svgHeight - marginHeight, marginHeight]);

    return { xScale, yScale };
  }

  // Generate Ground Truth Points
  function generateGroundTruthPoints(groundTruthFunc: (t: number) => number, t0: number, tEnd: number, dt: number): GroundTruthPoint[] {
    const points: GroundTruthPoint[] = [];
    let t = t0;
    while (t <= tEnd) {
      points.push({ t, y: groundTruthFunc(t) });
      t = t + dt;
    }
    return points;
  }

  function scheduleTimeout(fn: () => void, delay: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      // Remove from active list when executed
      activeTimeoutIds = activeTimeoutIds.filter((tid) => tid !== id);
      fn();
    }, delay);
    activeTimeoutIds.push(id);
    return id;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    // Generate data for both functions
    const [t0, tEnd] = domain;
    const y0 = 0;

    // High-curvature data
    const highCurvatureEuler = eulerMethod(
      highCurvatureODE,
      t0,
      y0,
      tEnd,
      deltaT
    );
    const highCurvatureGT = generateGroundTruthPoints(
      highCurvatureGroundTruth,
      t0,
      tEnd,
      groundTruthDeltaT
    );

    // Low-curvature data
    const lowCurvatureEuler = eulerMethod(
      lowCurvatureODE,
      t0,
      y0,
      tEnd,
      deltaT
    );
    const lowCurvatureGT = generateGroundTruthPoints(
      lowCurvatureGroundTruth,
      t0,
      tEnd,
      groundTruthDeltaT
    );

    // Store animation data for restart
    animationData = {
      highCurvatureGT,
      highCurvatureEuler,
      lowCurvatureGT,
      lowCurvatureEuler,
    };

    // Plot both with same animation delay so they start in sync
    plotCurves(
      leftSvg,
      highCurvatureGT,
      highCurvatureEuler,
      highCurvatureYScaleFactor,
      highCurvatureLabel,
      fullAnimationDelay
    );
    plotCurves(
      rightSvg,
      lowCurvatureGT,
      lowCurvatureEuler,
      lowCurvatureYScaleFactor,
      lowCurvatureLabel,
      fullAnimationDelay
    );

    isInitialized = true;

    // Start time tracking for play button circle
    startTimeTracking();
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function startTimeTracking() {
    animationStartTime = performance.now();
    trackTime();
  }

  function trackTime() {
    if (!isPlaying) {
      timeTrackingFrameId = null;
      return;
    }

    const elapsed = performance.now() - animationStartTime;
    const cycleTime = totalCycleDuration + repeatDelay;
    const timeInCycle = elapsed % cycleTime;

    // During animation (not in repeat delay)
    if (timeInCycle < totalCycleDuration) {
      normalizedTime = Math.min(
        1,
        (timeInCycle - fullAnimationDelay) /
          (totalCycleDuration - fullAnimationDelay)
      );
      if (normalizedTime < 0) normalizedTime = 0;
    } else {
      // During repeat delay, show full circle
      normalizedTime = 1;
    }

    timeTrackingFrameId = requestAnimationFrame(trackTime);
  }

  function stopAllAnimations() {
    // Cancel all pending timeouts
    activeTimeoutIds.forEach((id) => clearTimeout(id));
    activeTimeoutIds = [];
    // Interrupt all D3 transitions
    if (leftSvg) d3.select(leftSvg).selectAll("*").interrupt();
    if (rightSvg) d3.select(rightSvg).selectAll("*").interrupt();
    // Stop time tracking
    if (timeTrackingFrameId) {
      cancelAnimationFrame(timeTrackingFrameId);
      timeTrackingFrameId = null;
    }
  }

  function restartAnimations() {
    if (!animationData) return;
    // Stop any existing animations first
    stopAllAnimations();
    const {
      highCurvatureGT,
      highCurvatureEuler,
      lowCurvatureGT,
      lowCurvatureEuler,
    } = animationData;
    plotCurves(
      leftSvg,
      highCurvatureGT,
      highCurvatureEuler,
      highCurvatureYScaleFactor,
      highCurvatureLabel,
      0
    );
    plotCurves(
      rightSvg,
      lowCurvatureGT,
      lowCurvatureEuler,
      lowCurvatureYScaleFactor,
      lowCurvatureLabel,
      0
    );
    // Restart time tracking
    if (isPlaying) {
      startTimeTracking();
    }
  }

  // Animate individual Euler line segments
  function animateEulerSegments(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    eulerPoints: GroundTruthPoint[],
    xScale: d3.ScaleLinear<number, number>,
    yScale: d3.ScaleLinear<number, number>,
    delay: number = fullAnimationDelay
  ): void {
    // Clear existing segments and arrows
    svg.selectAll(".euler-segment").remove();
    svg.selectAll(".euler-arrow").remove();

    // Define arrow marker
    const defs = svg.select("defs").empty()
      ? svg.append("defs")
      : svg.select("defs");
    defs.selectAll("#euler-sampler-arrow-marker").remove();

    defs
      .append("marker")
      .attr("id", "euler-sampler-arrow-marker")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 8)
      .attr("refY", 5)
      .attr("markerWidth", 4)
      .attr("markerHeight", 4)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", eulerColor);

    for (let i = 0; i < eulerPoints.length - 1; i++) {
      const p1 = eulerPoints[i];
      const p2 = eulerPoints[i + 1];

      const x1 = xScale(p1.t);
      const y1 = yScale(p1.y);
      const x2 = xScale(p2.t);
      const y2 = yScale(p2.y);

      const segmentDelay = delay + i * (perStepDuration + perStepDelay);
      const isLastSegment = i === eulerPoints.length - 2;

      const line = svg
        .append("line")
        .attr("x1", x1)
        .attr("y1", y1)
        .attr("x2", x1)
        .attr("y2", y1)
        .attr("stroke", eulerColor)
        .attr("stroke-width", eulerLineWidth)
        .attr("class", "euler-segment");

      const transition = line
        .transition()
        .delay(segmentDelay)
        .duration(perStepDuration)
        .ease(d3.easeLinear)
        .attr("x2", x2)
        .attr("y2", y2)
        .on("start", function () {
          // Remove previous arrow
          svg.selectAll(".euler-arrow").remove();

          // Add arrow to current segment
          const arrow = svg
            .append("line")
            .attr("x1", x1)
            .attr("y1", y1)
            .attr("x2", x1)
            .attr("y2", y1)
            .attr("stroke", eulerColor)
            .attr("stroke-width", eulerLineWidth)
            .attr("marker-end", "url(#euler-sampler-arrow-marker)")
            .attr("class", "euler-arrow");

          // Animate arrow along with the segment
          arrow
            .transition()
            .duration(perStepDuration)
            .ease(d3.easeLinear)
            .attr("x2", x2)
            .attr("y2", y2);
        });

      // On the last segment, trigger repeat if needed
      if (isLastSegment && repeatAnimation) {
        transition.on("end", function () {
          if (shouldAnimate) {
            scheduleTimeout(() => {
              // Reset timer to sync with animation restart
              animationStartTime = performance.now();
              animateEulerSegments(svg, eulerPoints, xScale, yScale, 0);
            }, repeatDelay);
          }
        });
      }
    }
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  // Plot Labels
  function plotLabels(svg: SVGSVGElement | undefined, label: string, xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>): void {
    if (!svg) return;

    const d3Svg = d3.select(svg);

    // Remove existing label if it exists
    d3Svg.select(".curve-label").remove();

    // Calculate center x position
    const xDomain = xScale.domain();
    const xCenter = (xDomain[0] + xDomain[1]) / 2;

    // Calculate top y position with shift factor
    const yDomain = yScale.domain();
    const yTop = yDomain[1];
    const yRange = yDomain[1] - yDomain[0];
    const yShift = yRange * labelYShiftFactor;

    // Add label at the top center, shifted down by labelYShiftFactor
    d3Svg
      .append("text")
      .attr("class", "curve-label")
      .attr("x", xScale(xCenter))
      .attr("y", yScale(yTop - yShift) - 5)
      .attr("text-anchor", "middle")
      .attr("font-size", `${labelFontSize}px`)
      .attr("fill", labelColor)
      .attr("opacity", labelOpacity)
      .text(label);
  }

  // Plot Curves
  function plotCurves(
    svg: SVGSVGElement | undefined,
    groundTruth: GroundTruthPoint[],
    eulerData: EulerResult,
    yScaleFactor: number = 1,
    label: string = "",
    animDelay: number = fullAnimationDelay
  ): void {
    if (!svg) return;

    const d3Svg = d3.select(svg);
    const eulerPoints = eulerData.t.map((t, i) => ({ t, y: eulerData.y[i] }));

    // Create scales
    const { xScale, yScale } = createScales(
      eulerData,
      groundTruth,
      width,
      height,
      yScaleFactor
    );

    // Clear existing content
    d3Svg.selectAll("*").remove();

    // Create line generator
    const line = d3
      .line()
      .x((d) => xScale(d.t))
      .y((d) => yScale(d.y));

    // Plot ground truth (black)
    d3Svg
      .append("path")
      .datum(groundTruth)
      .attr("fill", "none")
      .attr("stroke", groundTruthColor)
      .attr("stroke-width", lineWidth)
      .attr("d", line);

    // Animate individual Euler segments
    animateEulerSegments(d3Svg, eulerPoints, xScale, yScale, animDelay);

    // Add curve label at the top
    if (label) {
      plotLabels(svg, label, xScale, yScale);
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function togglePlayPause() {
    isPlaying = !isPlaying;
    if (isPlaying) {
      shouldAnimate = true;
      restartAnimations();
    } else {
      shouldAnimate = false;
      stopAllAnimations();
    }
  }

  function handleVisibilityChange(isActive: boolean): void {
    if (!isActive && shouldAnimate) {
      wasAnimatingBeforeHidden = true;
      shouldAnimate = false;
      stopAllAnimations();
    } else if (isActive && wasAnimatingBeforeHidden) {
      wasAnimatingBeforeHidden = false;
      shouldAnimate = true;
      restartAnimations();
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onMount(() => {
    runInitialComputation();
  });

  onDestroy(() => {
    activeTimeoutIds.forEach((id) => clearTimeout(id));
    activeTimeoutIds = [];
    if (timeTrackingFrameId) {
      cancelAnimationFrame(timeTrackingFrameId);
    }
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Pause animation when figure goes off-screen, resume when back
  $: if (figureIsActive && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<DoubleFigure
  {gap}
  {caption}
  {backgroundVisible}
  bind:isActive={figureIsActive}
>
  {#snippet left()}
    <PlayButton {isPlaying} onclick={togglePlayPause} time={normalizedTime} />
    <svg
      bind:this={leftSvg}
      viewBox="0 0 {width} {height}"
      preserveAspectRatio="xMidYMid meet"
      style="width: 100%; height: auto; max-width: {width}px;"
    >
    </svg>
  {/snippet}

  {#snippet right()}
    <svg
      bind:this={rightSvg}
      viewBox="0 0 {width} {height}"
      preserveAspectRatio="xMidYMid meet"
      style="width: 100%; height: auto; max-width: {width}px;"
    >
    </svg>
  {/snippet}
</DoubleFigure>
