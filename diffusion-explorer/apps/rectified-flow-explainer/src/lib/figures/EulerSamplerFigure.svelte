<script>
  import * as tf from '@tensorflow/tfjs';
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import DoubleFigure from '$lib/components/DoubleFigure.svelte';
  import { settings } from '$lib/settings';

  // Visibility-based animation control
  let figureIsActive;
  let isInitialized = false;
  let wasAnimatingBeforeHidden = false;
  let shouldAnimate = true;
  let activeTimeoutIds = [];

  // Pause animation when figure goes off-screen, resume when back
  $: if (figureIsActive && isInitialized) {
    if (!$figureIsActive && shouldAnimate) {
      wasAnimatingBeforeHidden = true;
      shouldAnimate = false;
      // Cancel any pending timeouts
      activeTimeoutIds.forEach(id => clearTimeout(id));
      activeTimeoutIds = [];
    } else if ($figureIsActive && wasAnimatingBeforeHidden) {
      wasAnimatingBeforeHidden = false;
      shouldAnimate = true;
      // Restart animations
      restartAnimations();
    }
  }

  // Store animation data for restart
  let animationData = null;

  function restartAnimations() {
    if (!animationData) return;
    const { highCurvatureGT, highCurvatureEuler, lowCurvatureGT, lowCurvatureEuler } = animationData;
    plotCurves(leftSvg, highCurvatureGT, highCurvatureEuler, 'left', highCurvatureYScaleFactor, highCurvatureLabel, 0);
    plotCurves(rightSvg, lowCurvatureGT, lowCurvatureEuler, 'right', lowCurvatureYScaleFactor, lowCurvatureLabel, 0);
  }

  function scheduleTimeout(fn, delay) {
    const id = setTimeout(() => {
      // Remove from active list when executed
      activeTimeoutIds = activeTimeoutIds.filter(tid => tid !== id);
      fn();
    }, delay);
    activeTimeoutIds.push(id);
    return id;
  }

  // Props
  export let width = 400;
  export let height = 450;
  export let gap = 20;
  export let groundTruthColor = '#000000';
  export let eulerColor = '#f17720';
  export let lineWidth = 2;
  export let eulerLineWidth = 2;

  // Background visibility
  export let backgroundVisible = true;

  export let marginWidth = 20;
  export let marginHeight = 20;
  export let deltaT = 2.5;
  export let groundTruthDeltaT = 0.05;
  export let domain = [0, 4 * Math.PI];
  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;
  export let animationDuration = 2000; // Duration in milliseconds for the animation
  export let animationDelay = 500; // Delay before animation starts
  export let pathPause = 0; // Pause between animating each path
  export let perEdgeAnimationDelay = 250; // Pause between animating each Euler edge segment
  export let repeatAnimation = true; // Whether to repeat the animation
  export let repeatDelay = 1000; // Delay before repeating the animation
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;
  export let highCurvatureLabel = 'Highly Curved Function';
  export let lowCurvatureLabel = 'Approximately Straight Function';

  const highCurvatureYScaleFactor = 1;
  const lowCurvatureYScaleFactor = 5;

  let leftSvg;
  let rightSvg;

  // ODE Functions
  function highCurvatureODE(t, y) {
    return tf.tidy(() => {
      const tTensor = tf.scalar(t);

      // Define dy/dt = sin(t) + 0.1 * cos(2*t)
      const dydt = tf.add(
        tf.sin(tTensor),
        tf.mul(tf.scalar(0.1), tf.cos(tf.mul(tTensor, tf.scalar(2))))
      );

      return dydt.dataSync()[0];
    });
  }

  function highCurvatureGroundTruth(t) {
    // y(t) = -cos(t) + 0.05*sin(2*t) + C
    // With y(0) = 0, C = 1
    return -Math.cos(t) + 0.05 * Math.sin(2 * t) + 1;
  }

  function lowCurvatureODE(t, y) {
    return tf.tidy(() => {
      const tTensor = tf.scalar(t);

      // Define dy/dt = 0.1 * t (integrates to parabola)
      const dydt = tf.mul(tf.scalar(0.02), tTensor);

      return dydt.dataSync()[0];
    });
  }

  function lowCurvatureGroundTruth(t) {
    // y(t) = 0.05 * t^2
    return 0.01 * t * t;
  }

  // Euler Method
  function eulerMethod(odeFunc, t0, y0, tEnd, dt) {
    const tValues = [];
    const yValues = [];

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
  function createScales(data, groundTruth, svgWidth, svgHeight, yScaleFactor = 1) {
    const allT = [...data.t, ...groundTruth.map(d => d.t)];
    const allY = [...data.y, ...groundTruth.map(d => d.y)];

    const xScale = d3.scaleLinear()
      .domain([Math.min(...allT), Math.max(...allT)])
      .range([marginWidth, svgWidth - marginWidth]);

    const yMin = Math.min(...allY);
    const yMax = Math.max(...allY);
    const yCenter = (yMin + yMax) / 2;
    const yRange = (yMax - yMin) * yScaleFactor;

    // Shift the y-center down to give more space for the label at the top
    const yCenterOffset = -yRange * 0.15;

    const yScale = d3.scaleLinear()
      .domain([yCenter - yRange / 2 - yCenterOffset, yCenter + yRange / 2 - yCenterOffset])
      .range([svgHeight - marginHeight, marginHeight]);

    return { xScale, yScale };
  }

  // Generate Ground Truth Points
  function generateGroundTruthPoints(groundTruthFunc, t0, tEnd, dt) {
    const points = [];
    let t = t0;
    while (t <= tEnd) {
      points.push({ t, y: groundTruthFunc(t) });
      t = t + dt;
    }
    return points;
  }

  // Plot Labels
  function plotLabels(svg, label, xScale, yScale) {
    if (!svg) return;

    const d3Svg = d3.select(svg);

    // Remove existing label if it exists
    d3Svg.select('.curve-label').remove();

    // Calculate center x position
    const xDomain = xScale.domain();
    const xCenter = (xDomain[0] + xDomain[1]) / 2;

    // Calculate top y position
    const yDomain = yScale.domain();
    const yTop = yDomain[1];

    // Add label at the top center
    d3Svg.append('text')
      .attr('class', 'curve-label')
      .attr('x', xScale(xCenter))
      .attr('y', yScale(yTop) - 5)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor)
      .text(label);
  }

  // Animate Euler Curve (single path)
  function animateEulerCurve(path, delay = animationDelay) {
    const totalLength = path.node()?.getTotalLength() || 0;

    path
      .attr('stroke-dasharray', `${totalLength} ${totalLength}`)
      .attr('stroke-dashoffset', totalLength)
      .transition()
      .delay(delay)
      .duration(animationDuration)
      .ease(d3.easeLinear)
      .attr('stroke-dashoffset', 0)
      .on('end', function() {
        if (repeatAnimation) {
          // Reset and repeat
          path
            .attr('stroke-dashoffset', totalLength)
            .transition()
            .delay(repeatDelay)
            .duration(animationDuration)
            .ease(d3.easeLinear)
            .attr('stroke-dashoffset', 0)
            .on('end', function repeat() {
              if (repeatAnimation) {
                path
                  .attr('stroke-dashoffset', totalLength)
                  .transition()
                  .delay(repeatDelay)
                  .duration(animationDuration)
                  .ease(d3.easeLinear)
                  .attr('stroke-dashoffset', 0)
                  .on('end', repeat);
              }
            });
        }
      });
  }

  // Animate individual Euler line segments
  function animateEulerSegments(svg, eulerPoints, xScale, yScale, delay = animationDelay) {
    const segmentDuration = perEdgeAnimationDelay > 0
      ? (animationDuration / eulerPoints.length)
      : animationDuration / eulerPoints.length;

    // Clear existing segments and arrows
    svg.selectAll('.euler-segment').remove();
    svg.selectAll('.euler-arrow').remove();

    // Define arrow marker
    const defs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');
    defs.selectAll('#arrow-marker').remove();

    defs.append('marker')
      .attr('id', 'arrow-marker')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto-start-reverse')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', eulerColor);

    for (let i = 0; i < eulerPoints.length - 1; i++) {
      const p1 = eulerPoints[i];
      const p2 = eulerPoints[i + 1];

      const x1 = xScale(p1.t);
      const y1 = yScale(p1.y);
      const x2 = xScale(p2.t);
      const y2 = yScale(p2.y);

      const segmentDelay = delay + i * (segmentDuration + perEdgeAnimationDelay);
      const isLastSegment = i === eulerPoints.length - 2;

      const line = svg.append('line')
        .attr('x1', x1)
        .attr('y1', y1)
        .attr('x2', x1)
        .attr('y2', y1)
        .attr('stroke', eulerColor)
        .attr('stroke-width', eulerLineWidth)
        .attr('class', 'euler-segment');

      const transition = line
        .transition()
        .delay(segmentDelay)
        .duration(segmentDuration)
        .ease(d3.easeLinear)
        .attr('x2', x2)
        .attr('y2', y2)
        .on('start', function() {
          // Remove previous arrow
          svg.selectAll('.euler-arrow').remove();

          // Add arrow to current segment
          const arrow = svg.append('line')
            .attr('x1', x1)
            .attr('y1', y1)
            .attr('x2', x1)
            .attr('y2', y1)
            .attr('stroke', eulerColor)
            .attr('stroke-width', eulerLineWidth)
            .attr('marker-end', 'url(#arrow-marker)')
            .attr('class', 'euler-arrow');

          // Animate arrow along with the segment
          arrow
            .transition()
            .duration(segmentDuration)
            .ease(d3.easeLinear)
            .attr('x2', x2)
            .attr('y2', y2);
        });

      // On the last segment, trigger repeat if needed
      if (isLastSegment && repeatAnimation) {
        transition.on('end', function() {
          if (shouldAnimate) {
            scheduleTimeout(() => {
              animateEulerSegments(svg, eulerPoints, xScale, yScale, 0);
            }, repeatDelay);
          }
        });
      }
    }
  }

  // Plot Curves
  function plotCurves(svg, groundTruth, eulerData, groupId, yScaleFactor = 1, label = '', animDelay = animationDelay) {
    if (!svg) return;

    const d3Svg = d3.select(svg);
    const eulerPoints = eulerData.t.map((t, i) => ({ t, y: eulerData.y[i] }));

    // Create scales
    const { xScale, yScale } = createScales(eulerData, groundTruth, width, height, yScaleFactor);

    // Clear existing content
    d3Svg.selectAll('*').remove();

    // Create line generator
    const line = d3.line()
      .x(d => xScale(d.t))
      .y(d => yScale(d.y));

    // Plot ground truth (black)
    d3Svg.append('path')
      .datum(groundTruth)
      .attr('fill', 'none')
      .attr('stroke', groundTruthColor)
      .attr('stroke-width', lineWidth)
      .attr('d', line);

    // Plot and animate Euler approximation (orange)
    if (perEdgeAnimationDelay > 0) {
      // Animate individual segments with pauses between them
      animateEulerSegments(d3Svg, eulerPoints, xScale, yScale, animDelay);
    } else {
      // Animate as a single path
      const eulerPath = d3Svg.append('path')
        .datum(eulerPoints)
        .attr('fill', 'none')
        .attr('stroke', eulerColor)
        .attr('stroke-width', eulerLineWidth)
        .attr('d', line);

      animateEulerCurve(eulerPath, animDelay);
    }

    // Add curve label at the top
    if (label) {
      plotLabels(svg, label, xScale, yScale);
    }
  }

  onMount(() => {
    // Generate data for both functions
    const [t0, tEnd] = domain;
    const y0 = 0;

    // High-curvature data
    const highCurvatureEuler = eulerMethod(highCurvatureODE, t0, y0, tEnd, deltaT);
    const highCurvatureGT = generateGroundTruthPoints(highCurvatureGroundTruth, t0, tEnd, groundTruthDeltaT);

    // Low-curvature data
    const lowCurvatureEuler = eulerMethod(lowCurvatureODE, t0, y0, tEnd, deltaT);
    const lowCurvatureGT = generateGroundTruthPoints(lowCurvatureGroundTruth, t0, tEnd, groundTruthDeltaT);

    // Store animation data for restart
    animationData = { highCurvatureGT, highCurvatureEuler, lowCurvatureGT, lowCurvatureEuler };

    // Plot both with same animation delay so they start in sync
    plotCurves(leftSvg, highCurvatureGT, highCurvatureEuler, 'left', highCurvatureYScaleFactor, highCurvatureLabel, animationDelay);
    plotCurves(rightSvg, lowCurvatureGT, lowCurvatureEuler, 'right', lowCurvatureYScaleFactor, lowCurvatureLabel, animationDelay);

    isInitialized = true;

    // Cleanup timeouts on unmount
    return () => {
      activeTimeoutIds.forEach(id => clearTimeout(id));
      activeTimeoutIds = [];
    };
  });
</script>

<DoubleFigure {gap} {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet left()}
    <svg bind:this={leftSvg} viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
    </svg>
  {/snippet}

  {#snippet right()}
    <svg bind:this={rightSvg} viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
    </svg>
  {/snippet}
</DoubleFigure>
