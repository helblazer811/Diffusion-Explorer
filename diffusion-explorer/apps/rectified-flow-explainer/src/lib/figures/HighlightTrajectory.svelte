<!-- This figure highlights a single trajectory with low-opacity distributions and a label annotation. -->

<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import { base } from '$app/paths';
  import Figure from '$lib/components/Figure.svelte';
  import { settings } from '$lib/settings';
  import { createSourceTargetScales } from '$lib/d3_helpers';
  import { plotKatexInSVG } from '@diffusion-explorer/ui';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props (from parent +page.svelte)
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];
  export let allTimeSamples;
  export let isTraining;

  // Props/Configuration
  export let width = 750;
  export let height = 275;

  // Styling props for visualization
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = 0.1; // Very low opacity for distributions
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;

  // Animation settings
  export let animationDuration = 8000; // Duration in milliseconds
  export let animationPauseTime = 1000; // Pause time between loops in milliseconds

  // Trajectory styling props
  export let trajectoryColor = '#f17720'; // Orange
  export let trajectoryFullOpacity = 0.4;
  export let trajectoryProgressOpacity = 0.8;
  export let trajectoryStrokeWidth = 3;
  export let trajectoryPointRadius = 5;

  // Annotation styling props
  export let annotationLabel = 'Sample Trajectory';
  export let annotationFontSize = 22;
  export let annotationColor = '#666';
  export let annotationLineColor = '#888';

  // Interaction props
  export let draggable = false; // Enable/disable drag handle for trajectory selection

  // Selected trajectory index (single trajectory)
  let selectedTrajectoryIndex = null;
  let svgElement;
  let scales = null;
  let time = 0; // Animation time parameter (0 to 1)
  let animationFrameId = null;
  let trajectoryLength = 0; // Cache total path length
  let animationStartTime = null;

  // Drag handle state
  let dragInitialized = false;

  // Local animation control state
  let isPlaying = true;
  let isPausedByFigure = false;

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Update isPausedByFigure when isPlaying changes
  $: isPausedByFigure = !isPlaying;

  // Pause animation when figure goes off-screen, resume when back
  $: if (figureIsActive && isInitialized) {
    if (!$figureIsActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
    } else if ($figureIsActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
    }
  }

  /**
   * Compute pixel x position for a data point at a given time.
   */
  function getPixelX(dataX, dataMeanX, t) {
    if (!scales) return 0;
    const centerPixelX = scales.sourceCenterPixelX + t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - dataMeanX) * scales.xScaleFactor;
  }

  /**
   * Find the nearest trajectory index based on SVG pixel coordinates.
   * Converts pixel coords to data coords and finds closest starting point.
   */
  function nearestTrajectoryIndex(svgX, svgY) {
    const allSamples = $allTimeSamples;
    if (!allSamples || allSamples.length === 0 || !scales) return 0;

    const startingPoints = allSamples[0]; // Time = 0 starting positions

    // Compute combined mean for positioning (same as in generateTrajectoryPath)
    const allSourceX = sourceDistributionSamples.map(p => p[0]);
    const allTargetX = targetDistributionSamples.map(p => p[0]);
    const combinedMeanX = [...allSourceX, ...allTargetX].reduce((a, b) => a + b, 0) / (allSourceX.length + allTargetX.length);

    // Convert SVG coords to data coords (at t=0, use source center)
    const dataX = (svgX - scales.sourceCenterPixelX) / scales.xScaleFactor + combinedMeanX;
    const dataY = scales.yScale.invert(svgY);

    // Find nearest starting point
    let minDist = Infinity;
    let minIndex = 0;
    for (let i = 0; i < startingPoints.length; i++) {
      const [px, py] = startingPoints[i];
      const dist = Math.sqrt((px - dataX) ** 2 + (py - dataY) ** 2);
      if (dist < minDist) {
        minDist = dist;
        minIndex = i;
      }
    }
    return minIndex;
  }

  /**
   * Select a single trajectory index within clipping radius.
   */
  function selectTrajectoryIndex(allSamples, clippingRadius) {
    if (!allSamples || allSamples.length === 0) return null;

    const startingPoints = allSamples[0]; // Timestep 0

    // Filter to indices within clipping radius
    for (let i = 0; i < startingPoints.length; i++) {
      const [x, y] = startingPoints[i];
      const distance = Math.sqrt(x * x + y * y);
      if (distance <= clippingRadius) {
        return i; // Return first valid index
      }
    }
    return 0; // Fallback to first index
  }

  /**
   * Generate SVG path data for a trajectory
   */
  function generateTrajectoryPath(trajectoryIndex) {
    const allSamples = $allTimeSamples;
    if (!allSamples || allSamples.length === 0 || !scales) return '';

    // Compute combined mean for positioning
    const allSourceX = sourceDistributionSamples.map(p => p[0]);
    const allTargetX = targetDistributionSamples.map(p => p[0]);
    const combinedMeanX = [...allSourceX, ...allTargetX].reduce((a, b) => a + b, 0) / (allSourceX.length + allTargetX.length);

    const pathData = [];

    for (let step = 0; step < allSamples.length; step++) {
      const samples = allSamples[step];
      if (!samples || !samples[trajectoryIndex]) continue;

      const [x, y] = samples[trajectoryIndex];
      const timeAtStep = step / (allSamples.length - 1);

      const svgX = getPixelX(x, combinedMeanX, timeAtStep);
      const svgY = scales.yScale(y);

      if (step === 0) {
        pathData.push(`M ${svgX},${svgY}`);
      } else {
        pathData.push(`L ${svgX},${svgY}`);
      }
    }

    return pathData.join(' ');
  }

  /**
   * Get a point on the trajectory at a given normalized position (0-1)
   */
  function getTrajectoryPointAt(normalizedPosition) {
    const svg = d3.select(svgElement);
    const pathElement = svg.select('.trajectory-progress').node();
    if (pathElement && trajectoryLength > 0) {
      const length = trajectoryLength * normalizedPosition;
      return pathElement.getPointAtLength(length);
    }
    return { x: width / 2, y: height / 2 };
  }

  /**
   * Initialize trajectory path in the SVG
   */
  function initTrajectory() {
    const svg = d3.select(svgElement);
    const trajectoryGroup = svg.select('#trajectories');

    if (selectedTrajectoryIndex === null) return;

    const fullPath = generateTrajectoryPath(selectedTrajectoryIndex);

    // Full trajectory path (lighter, always complete)
    trajectoryGroup
      .append('path')
      .attr('class', 'trajectory-full')
      .attr('d', fullPath)
      .attr('stroke', trajectoryColor)
      .attr('stroke-width', trajectoryStrokeWidth)
      .attr('stroke-opacity', trajectoryFullOpacity)
      .attr('fill', 'none')
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');

    // Animated progress path using stroke-dasharray
    const progressPath = trajectoryGroup
      .append('path')
      .attr('class', 'trajectory-progress')
      .attr('d', fullPath)
      .attr('stroke', trajectoryColor)
      .attr('stroke-width', trajectoryStrokeWidth)
      .attr('stroke-opacity', trajectoryProgressOpacity)
      .attr('fill', 'none')
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');

    // Get the total path length for dasharray animation
    trajectoryLength = progressPath.node().getTotalLength();

    // Set up stroke-dasharray animation
    progressPath
      .attr('stroke-dasharray', trajectoryLength)
      .attr('stroke-dashoffset', trajectoryLength);

    // Current position marker
    trajectoryGroup
      .append('circle')
      .attr('class', 'trajectory-point')
      .attr('r', trajectoryPointRadius)
      .attr('fill', trajectoryColor)
      .attr('fill-opacity', trajectoryProgressOpacity);

    // Initial render at time=0
    updateTrajectory(0);
  }

  /**
   * Initialize the annotation (label and dashed line)
   */
  function initAnnotation() {
    const svg = d3.select(svgElement);
    const annotationGroup = svg.select('#annotation');

    // Get trajectory start and end points to find x center
    const startPoint = getTrajectoryPointAt(0);
    const endPoint = getTrajectoryPointAt(1);
    const trajectoryCenterX = (startPoint.x + endPoint.x) / 2;

    // Get trajectory midpoint for y positioning
    const midpoint = getTrajectoryPointAt(0.5);

    // Label position: centered over trajectory's x center, above trajectory
    const labelX = trajectoryCenterX;
    const labelY = midpoint.y - 60; // Position closer to trajectory

    // Draw label text and KaTeX together, centered
    // "Sample Trajectory" on top, "ψ_t(x_0)" below
    const labelOffsetX = 10; // Shift labels to the right
    annotationGroup
      .append('text')
      .attr('class', 'annotation-label')
      .attr('x', labelX + labelOffsetX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('font-size', annotationFontSize)
      .attr('fill', annotationColor)
      .attr('font-family', 'sans-serif')
      .text(annotationLabel);

    // Draw ψ_t(x_0) KaTeX label below "Sample Trajectory" - centered
    const katexLabelOffsetX = 32; // Offset to center the KaTeX label (approx half width of ψ_t(x_0))
    plotKatexInSVG(annotationGroup, '\\psi_t(x_0)', labelX - katexLabelOffsetX, labelY + 5, {
      fontSize: annotationFontSize,
      bg: false,
      color: annotationColor
    });

    // Draw point at initial location (reuse startPoint from above)
    annotationGroup
      .append('circle')
      .attr('class', 'start-point')
      .attr('cx', startPoint.x)
      .attr('cy', startPoint.y)
      .attr('r', 5)
      .attr('fill', trajectoryColor);

    // Draw x_0 KaTeX label above the initial point
    const katexOffsetX = 12; // Offset to center the KaTeX label
    plotKatexInSVG(annotationGroup, 'x_0', startPoint.x - katexOffsetX, startPoint.y - 40, {
      fontSize: 20,
      bg: false,
      color: annotationColor
    });
  }

  /**
   * Redraw the trajectory and annotation when selection changes.
   */
  function redrawTrajectory() {
    const svg = d3.select(svgElement);
    svg.select('#trajectories').selectAll('*').remove();
    svg.select('#annotation').selectAll('*').remove();
    initTrajectory();
    initAnnotation();
    updateTrajectory(time);

    // Update drag handle position to new trajectory start point
    const startPoint = getTrajectoryPointAt(0);
    svg.select('#dragHandle .drag-icon')
      .attr('x', startPoint.x)
      .attr('y', startPoint.y);
  }

  /**
   * Initialize the drag handle on the current trajectory's starting point.
   * Allows user to drag and select different trajectories in real-time.
   */
  function initDragHandle() {
    if (dragInitialized) return;
    dragInitialized = true;

    const svg = d3.select(svgElement);
    const handleGroup = svg.select('#dragHandle');

    // Get current starting point position
    const startPoint = getTrajectoryPointAt(0);

    // Add the pointer icon image
    handleGroup.append('image')
      .attr('class', 'drag-icon')
      .attr('xlink:href', base + '/PointerIcon.svg')
      .attr('x', startPoint.x)
      .attr('y', startPoint.y)
      .attr('transform', 'translate(-15, -15)') // Center the 30x30 icon
      .attr('width', 30)
      .attr('height', 30)
      .style('cursor', 'grab');

    // Set up drag behavior (real-time trajectory updates during drag)
    const drag = d3.drag()
      .on('start', function() { d3.select(this).style('cursor', 'grabbing'); })
      .on('drag', function(event) {
        let [x, y] = d3.pointer(event, svg.node());

        // Clamp to SVG bounds (vector field area)
        x = Math.max(marginWidth, Math.min(x, width - marginWidth));
        y = Math.max(marginHeight, Math.min(y, height - marginHeight));

        // Update icon position during drag
        handleGroup.select('.drag-icon')
          .attr('x', x)
          .attr('y', y);

        // Real-time: find and select nearest trajectory immediately
        const newIndex = nearestTrajectoryIndex(x, y);
        if (newIndex !== selectedTrajectoryIndex) {
          selectedTrajectoryIndex = newIndex;
          redrawTrajectory();
        }
      })
      .on('end', function() {
        // Ensure icon snaps to final trajectory starting point
        const snapPoint = getTrajectoryPointAt(0);
        handleGroup.select('.drag-icon')
          .attr('x', snapPoint.x)
          .attr('y', snapPoint.y);

        d3.select(this).style('cursor', 'grab');
      });

    handleGroup.call(drag);
  }

  /**
   * Update trajectory visualization for current animation time
   */
  function updateTrajectory(time) {
    const svg = d3.select(svgElement);
    const allSamples = $allTimeSamples;
    if (!allSamples || allSamples.length === 0) return;

    // Linear interpolation: reveal path proportional to time
    const visibleLength = trajectoryLength * time;

    svg.select('.trajectory-progress')
      .attr('stroke-dashoffset', trajectoryLength - visibleLength);

    // Update current position marker at the end of the visible path
    const pathElement = svg.select('.trajectory-progress').node();
    if (pathElement && trajectoryLength > 0) {
      const point = pathElement.getPointAtLength(visibleLength);
      svg.select('.trajectory-point')
        .attr('cx', point.x)
        .attr('cy', point.y);
    }
  }

  function initializeLayers() {
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();
    svg.append('g').attr('id', 'sourceScatter');
    svg.append('g').attr('id', 'targetScatter');
    svg.append('g').attr('id', 'trajectories');
    svg.append('g').attr('id', 'annotation');
    svg.append('g').attr('id', 'dragHandle');
  }

  function initScatter(points, color, groupId, opacity = pointOpacity) {
    if (!svgElement || !scales || points.length === 0) return;
    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);
    group.selectAll('circle').data(points).enter().append('circle')
      .attr('r', pointRadius).attr('fill', color).attr('opacity', opacity);
  }

  function updateScatter(points, groupId, isSource) {
    if (!svgElement || !scales || points.length === 0) return;
    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);
    const { yScale, xScaleFactor, sourceCenterPixelX, targetCenterPixelX, sourceMeanX, targetMeanX } = scales;
    const centerPixelX = isSource ? sourceCenterPixelX : targetCenterPixelX;
    const meanX = isSource ? sourceMeanX : targetMeanX;
    group.selectAll('circle').data(points)
      .attr('cx', d => centerPixelX + (d[0] - meanX) * xScaleFactor)
      .attr('cy', d => yScale(d[1]));
  }

  function draw() {
    if (!svgElement || !scales) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;
    updateScatter(sourceDistributionSamples, 'sourceScatter', true);
    updateScatter(targetDistributionSamples, 'targetScatter', false);
    updateTrajectory(time);
  }

  function initializeVisualization() {
    if (!svgElement) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    initializeLayers();
    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width, height, marginWidth, marginHeight, sourceCenterX, targetCenterX, yShiftFactor
    });

    initScatter(sourceDistributionSamples, sourcePointColor, 'sourceScatter');
    initScatter(targetDistributionSamples, targetPointColor, 'targetScatter');

    selectedTrajectoryIndex = selectTrajectoryIndex($allTimeSamples, settings.stylingSettings.scatterPlot.clippingRadius);
    initTrajectory();
    draw();
    initAnnotation();
    if (draggable) {
      initDragHandle();
    }
  }

  function startAnimation() {
    let isPaused = false;
    let pauseStartTime = null;
    let pausedElapsedTime = 0;

    function animate(currentTime) {
      if (isPausedByFigure) {
        if (animationStartTime !== null && pausedElapsedTime === 0) {
          pausedElapsedTime = currentTime - animationStartTime;
        }
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      if (pausedElapsedTime > 0) {
        animationStartTime = currentTime - pausedElapsedTime;
        pausedElapsedTime = 0;
      }

      if (animationStartTime === null) animationStartTime = currentTime;
      const elapsed = currentTime - animationStartTime;

      if (elapsed >= animationDuration) {
        if (!isPaused) {
          isPaused = true;
          pauseStartTime = currentTime;
          time = 1;
          draw();
        }
        if (pauseStartTime && currentTime - pauseStartTime >= animationPauseTime) {
          animationStartTime = currentTime;
          isPaused = false;
          pauseStartTime = null;
          time = 0;
        }
      } else {
        time = Math.min(elapsed / animationDuration, 1);
        draw();
      }
      animationFrameId = requestAnimationFrame(animate);
    }
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // Reactive initialization flag
  let isInitialized = false;

  // Update visualization when time changes
  $: if (isInitialized) {
    draw();
  }

  // React to data changes and initialize visualization once
  $: if (!isInitialized &&
         sourceDistributionSamples.length > 0 &&
         targetDistributionSamples.length > 0 &&
         $allTimeSamples.length > 0 &&
         svgElement) {
    initializeVisualization();
    startAnimation();
    isInitialized = true;
  }

  // Cleanup on component destroy
  onMount(() => {
    return () => {
      stopAnimation();
    };
  });
</script>

<Figure {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
      </svg>
    </div>
  {/snippet}
</Figure>
