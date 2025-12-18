<!-- This figure shows curved trajectories from flow matching, demonstrating non-straight paths. -->

<script lang="ts">
  import { onMount } from 'svelte';
  import { writable, get } from 'svelte/store';
  import * as tf from '@tensorflow/tfjs';
  import * as d3 from 'd3';
  import { callTrainingWorkerThread, callSamplingWorkerThreadFromInitialPoints, sampleMultivariateNormal } from '$lib/diffusion';
  import { downloadJSON } from '$lib/utils';
  import Figure from '$lib/components/Figure.svelte';
  import PlayButton from '$lib/components/PlayButton.svelte';

  // Caption props
  export let figureNumber = '2';
  export let captionText = 'Curved trajectories produced by flow matching visualization.';

  // Props/Configuration
  export let width = 800;
  export let height = 300;
  export let cachedTrajectoriesPath: string | null = "cached_samples/smiley_face_trajectories.json";
  export let numSamples = 100;
  export let numSteps = 300;

  // Trajectory props
  export let numTrajectories = 20; // Number of trajectories to display

  // Styling props for visualization
  export let sourcePointColor = '#3b82f6'; // Blue
  export let targetPointColor = '#3b82f6'; // Blue
  export let marginWidth = 60;
  export let marginHeight = 20;
  export let sourceLabelText = 'Source Distribution';
  export let targetLabelText = 'Target Distribution';
  export let labelFontSize = 22;
  export let labelColor = '#666';
  export let pointRadius = 5;
  export let pointOpacity = 0.25;
  export let flowWidth = 10; // Gap between source and target in data units
  export let yShiftFactor = -0.5; // Vertical shift for distributions (positive shifts down)

  // Animation settings
  export let animationDuration = 8000; // Duration in milliseconds
  export let animationPauseTime = 1000; // Pause time between loops in milliseconds

  // Trajectory styling props
  export let trajectoryColor = '#f17720'; // Orange
  export let trajectoryFullOpacity = 0.4;
  export let trajectoryProgressOpacity = 0.8;
  export let trajectoryStrokeWidth = 2;
  export let trajectoryPointRadius = 4;
  export let trainingObjective = 'Flow Matching';

  // Visibility controls for each visualization element
  export let showSourceScatter = true;
  export let showTargetScatter = true;

  // Stores for training state
  const isTraining = writable(false);

  // Stores for sampling state
  const allTimeSamples = writable<number[][][]>([]);

  // Distribution samples
  let sourceDistributionSamples: number[][] = [];
  let targetDistributionSamples: number[][] = [];
  let currentSamples: number[][] = [];

  // Selected trajectory indices
  let selectedTrajectoryIndices: number[] = [];

  // Default settings (can be customized)
  const settings = {
    trainingObjectiveToModelConfig: {
      "Flow Matching": {
          dim: 2,
          hidden: 64,
      },
    },
    datasetNameToPath: {
      smiley_face: '/data/smiley_face.json',
    },
    trainingConfig: {
      epochs: 500,
      batchSize: 1024,
      verbose: true,
      displayInterval: 100
    },
    domainRange: null
  };

  let trainingWorker: Worker | null = null;
  let svgElement: SVGSVGElement;
  let xScale = null;
  let yScale = null;
  let time = 0; // Animation time parameter (0 to 1)
  let animationFrameId: number | null = null;

  // Local animation control state
  let isPlaying = true;
  let isPausedByFigure = false;

  // Update isPausedByFigure when isPlaying changes
  $: isPausedByFigure = !isPlaying;

  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  /**
   * Randomly select a subset of trajectory indices to display
   * @param numSamples - Total number of available trajectories
   * @param numToSelect - Number of trajectories to display
   * @returns Array of selected indices
   */
  function selectTrajectoryIndices(numSamples: number, numToSelect: number): number[] {
    // If requesting more than available, return all indices
    if (numToSelect >= numSamples) {
      return Array.from({ length: numSamples }, (_, i) => i);
    }

    // Use uniform spacing for better coverage
    const step = numSamples / numToSelect;
    const indices: number[] = [];
    for (let i = 0; i < numToSelect; i++) {
      indices.push(Math.floor(i * step));
    }

    return indices;
  }

  /**
   * Generate SVG path data for a trajectory
   * @param trajectoryIndex - Index of the sample to trace
   * @param endStep - Final timestep to include (for progress path)
   * @returns SVG path data string ("M x,y L x,y L x,y ...")
   */
  function generateTrajectoryPath(trajectoryIndex: number, endStep: number | null = null): string {
    const allSamples = get(allTimeSamples);
    if (!allSamples || allSamples.length === 0) return '';

    const maxStep = endStep !== null ? endStep : allSamples.length - 1;
    const pathData: string[] = [];

    for (let step = 0; step <= maxStep; step++) {
      const samples = allSamples[step];
      if (!samples || !samples[trajectoryIndex]) continue;

      const [x, y] = samples[trajectoryIndex];
      // Apply x-shift based on time progression
      const timeAtStep = step / (allSamples.length - 1);
      const xShifted = x + timeAtStep * flowWidth;

      // Transform to SVG coordinates
      const svgX = xScale(xShifted);
      const svgY = yScale(y);

      if (step === 0) {
        pathData.push(`M ${svgX},${svgY}`);
      } else {
        pathData.push(`L ${svgX},${svgY}`);
      }
    }

    return pathData.join(' ');
  }

  /**
   * Initialize trajectory paths in the SVG
   */
  function initTrajectories() {
    const svg = d3.select(svgElement);
    const trajectoryGroup = svg.select('#trajectories');

    // Create full path (background) and progress path (foreground) for each trajectory
    selectedTrajectoryIndices.forEach(idx => {
      // Full trajectory path (lighter, always complete)
      trajectoryGroup
        .append('path')
        .attr('class', `trajectory-full-${idx}`)
        .attr('stroke', trajectoryColor)
        .attr('stroke-width', trajectoryStrokeWidth)
        .attr('stroke-opacity', trajectoryFullOpacity)
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');

      // Progress path (darker, animated to current time)
      trajectoryGroup
        .append('path')
        .attr('class', `trajectory-progress-${idx}`)
        .attr('stroke', trajectoryColor)
        .attr('stroke-width', trajectoryStrokeWidth)
        .attr('stroke-opacity', trajectoryProgressOpacity)
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');

      // Current position marker
      trajectoryGroup
        .append('circle')
        .attr('class', `trajectory-point-${idx}`)
        .attr('r', trajectoryPointRadius)
        .attr('fill', trajectoryColor)
        .attr('fill-opacity', trajectoryProgressOpacity);
    });

    // Initial render at time=0
    updateTrajectories(0);
  }

  /**
   * Update trajectory visualization for current animation time
   * @param time - Normalized time from 0 to 1
   */
  function updateTrajectories(time: number) {
    const svg = d3.select(svgElement);
    const allSamples = get(allTimeSamples);
    if (!allSamples || allSamples.length === 0) return;

    const currentStep = Math.round(time * (allSamples.length - 1));

    selectedTrajectoryIndices.forEach(idx => {
      // Update full path (always complete, doesn't change after first render)
      const fullPath = generateTrajectoryPath(idx, null);
      svg.select(`.trajectory-full-${idx}`)
        .attr('d', fullPath);

      // Update progress path (up to current time)
      const progressPath = generateTrajectoryPath(idx, currentStep);
      svg.select(`.trajectory-progress-${idx}`)
        .attr('d', progressPath);

      // Update current position marker
      const currentSamples = allSamples[currentStep];
      if (currentSamples && currentSamples[idx]) {
        const [x, y] = currentSamples[idx];
        const xShifted = x + time * flowWidth;
        svg.select(`.trajectory-point-${idx}`)
          .attr('cx', xScale(xShifted))
          .attr('cy', yScale(y));
      }
    });
  }

  /**
   * Generate samples from 2D standard normal and clip outliers beyond 3 sigma
   * @param numSamples - Number of samples to generate
   * @returns Array of [x, y] points within 3 standard deviations
   */
  function generateClippedGaussianSamples(numSamples: number): number[][] {
    return tf.tidy(() => {
      const mean = [0, 0];
      const cov = [[1, 0], [0, 1]];
      const maxStdDev = 2.0;
      const threshold = maxStdDev * Math.sqrt(2);

      let allClippedSamples: number[][] = [];
      let attempts = 0;
      const maxAttempts = 10;
      const batchSize = Math.ceil(numSamples * 1.5);

      while (allClippedSamples.length < numSamples && attempts < maxAttempts) {
        attempts++;
        const rawSamplesTensor = sampleMultivariateNormal(mean, cov, batchSize) as tf.Tensor2D;
        const rawSamplesArray = rawSamplesTensor.arraySync() as number[][];

        for (const sample of rawSamplesArray) {
          const [x, y] = sample;
          const distance = Math.sqrt(x * x + y * y);
          if (distance <= threshold) {
            allClippedSamples.push(sample);
            if (allClippedSamples.length >= numSamples) break;
          }
        }
      }
      return allClippedSamples.slice(0, numSamples);
    });
  }

  async function generateSamples(modelPath, numSamples = 100, numberOfSteps = 200) {
    const trainingObjectiveVal = trainingObjective;
    const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];
    const initialPoints = generateClippedGaussianSamples(numSamples);

    return new Promise((resolve) => {
      callSamplingWorkerThreadFromInitialPoints(
        modelPath, trainingObjectiveVal, modelConfig, initialPoints, numberOfSteps,
        (allSamples) => {
          allTimeSamples.set(allSamples);
          sourceDistributionSamples = allSamples[0];
          currentSamples = sourceDistributionSamples;
          console.log('Generated samples:', allSamples.length);
          resolve(allSamples);
        },
        settings.domainRange
      );
    });
  }

  async function loadTargetDistribution() {
    try {
      const response = await fetch('/data/smiley_face.json');
      const data = await response.json();
      const allPoints = data.points as number[][];
      const shuffled = [...allPoints].sort(() => Math.random() - 0.5);
      targetDistributionSamples = shuffled.slice(0, numSamples);
      console.log('Loaded target distribution samples:', targetDistributionSamples.length);
      return true;
    } catch (error) {
      console.error('Failed to load target distribution:', error);
      return false;
    }
  }

  function downloadTrajectories() {
    const trajectories = get(allTimeSamples);
    if (!trajectories || trajectories.length === 0) {
      console.error('No trajectories to download');
      return;
    }
    const filename = 'flow_matching_trajectories_' + new Date().getTime() + '.json';
    downloadJSON(trajectories, filename);
    console.log('Trajectories downloaded:', filename, trajectories.length, 'timesteps');
  }

  async function loadCachedTrajectories(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        console.log('Cached trajectories file not found:', path);
        return false;
      }
      const cachedData = await response.json();
      if (!cachedData || !Array.isArray(cachedData)) {
        console.error('Invalid cached trajectories format');
        return false;
      }
      allTimeSamples.set(cachedData);
      if (cachedData.length > 0 && cachedData[0]) {
        sourceDistributionSamples = cachedData[0];
        currentSamples = cachedData[0];
        console.log('Loaded cached trajectories:', cachedData.length, 'timesteps');
        return true;
      }
      console.error('Cached trajectories array is empty');
      return false;
    } catch (error) {
      console.log('Could not load cached trajectories:', error);
      return false;
    }
  }

  function createScales(sourcePoints: number[][], targetPoints: number[][]) {
    const drawableWidth = width - 2 * marginWidth;
    const drawableHeight = height - 2 * marginHeight;
    const aspectRatio = drawableHeight / drawableWidth;

    const shiftedTargetPoints = targetPoints.map(p => [p[0] + flowWidth, p[1]]);
    const allPoints = [...sourcePoints, ...shiftedTargetPoints];

    const xExtent = d3.extent(allPoints, d => d[0]);
    const yExtent = d3.extent(allPoints, d => d[1]);
    const xRange = xExtent[1] - xExtent[0];
    const yRange = yExtent[1] - yExtent[0];
    const xCenter = (xExtent[0] + xExtent[1]) / 2;
    const yCenter = (yExtent[0] + yExtent[1]) / 2;

    let adjustedXRange = xRange;
    let adjustedYRange = yRange;

    if (yRange / xRange > aspectRatio) {
      adjustedXRange = yRange / aspectRatio;
    } else {
      adjustedYRange = xRange * aspectRatio;
    }

    const yCenterOffset = -adjustedYRange * 0.07 - yShiftFactor;

    xScale = d3.scaleLinear()
      .domain([xCenter - adjustedXRange / 2, xCenter + adjustedXRange / 2])
      .range([marginWidth, width - marginWidth]);

    yScale = d3.scaleLinear()
      .domain([yCenter - adjustedYRange / 2 - yCenterOffset, yCenter + adjustedYRange / 2 - yCenterOffset])
      .range([marginHeight, height - marginHeight]);
  }

  function initializeLayers() {
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();
    svg.append('g').attr('id', 'sourceScatter');
    svg.append('g').attr('id', 'targetScatter');
    svg.append('g').attr('id', 'trajectories');
    svg.append('g').attr('id', 'labels');
  }

  function initScatter(points: number[][], color: string, groupId: string, opacity: number = pointOpacity) {
    if (!svgElement || !xScale || !yScale || points.length === 0) return;
    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);
    group.selectAll('circle').data(points).enter().append('circle')
      .attr('r', pointRadius).attr('fill', color).attr('opacity', opacity);
  }

  function updateScatter(points: number[][], groupId: string, time: number) {
    if (!svgElement || !xScale || !yScale || points.length === 0) return;
    const xShift = time * flowWidth;
    const svg = d3.select(svgElement);
    const group = svg.select(`#${groupId}`);
    group.selectAll('circle').data(points)
      .attr('cx', d => xScale(d[0] + xShift))
      .attr('cy', d => yScale(d[1]));
  }

  function plotLabels() {
    if (!svgElement || !xScale || !yScale) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    const svg = d3.select(svgElement);
    const labelsGroup = svg.select('#labels');
    labelsGroup.selectAll('*').remove();

    const sourceLabelX = xScale(0);
    const targetLabelX = xScale(flowWidth);
    const yDomain = yScale.domain();
    const yTop = yDomain[0];
    const labelY = yScale(yTop) + 0.5 * labelFontSize;

    labelsGroup.append('text')
      .attr('x', sourceLabelX).attr('y', labelY)
      .attr('text-anchor', 'middle').attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor).attr('stroke', '#ffffff')
      .attr('stroke-width', '4').attr('paint-order', 'stroke')
      .text(sourceLabelText);

    labelsGroup.append('text')
      .attr('x', targetLabelX).attr('y', labelY)
      .attr('text-anchor', 'middle').attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor).attr('stroke', '#ffffff')
      .attr('stroke-width', '4').attr('paint-order', 'stroke')
      .text(targetLabelText);
  }

  function draw() {
    if (!svgElement || !xScale || !yScale) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;
    if (showSourceScatter) updateScatter(sourceDistributionSamples, 'sourceScatter', 0);
    if (showTargetScatter) updateScatter(targetDistributionSamples, 'targetScatter', 1);
    updateTrajectories(time);
  }

  function initializeVisualization() {
    if (!svgElement) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    initializeLayers();
    createScales(sourceDistributionSamples, targetDistributionSamples);

    if (showSourceScatter) initScatter(sourceDistributionSamples, sourcePointColor, 'sourceScatter');
    if (showTargetScatter) initScatter(targetDistributionSamples, targetPointColor, 'targetScatter');

    selectedTrajectoryIndices = selectTrajectoryIndices(numSamples, numTrajectories);
    initTrajectories();
    draw();
    plotLabels();
  }

  function startAnimation() {
    let startTime: number | null = null;
    let isPaused = false;
    let pauseStartTime: number | null = null;
    let pausedElapsedTime = 0;

    function animate(currentTime: number) {
      if (isPausedByFigure) {
        if (startTime !== null && pausedElapsedTime === 0) {
          pausedElapsedTime = currentTime - startTime;
        }
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      if (pausedElapsedTime > 0) {
        startTime = currentTime - pausedElapsedTime;
        pausedElapsedTime = 0;
      }

      if (startTime === null) startTime = currentTime;
      const elapsed = currentTime - startTime;

      if (elapsed >= animationDuration) {
        if (!isPaused) {
          isPaused = true;
          pauseStartTime = currentTime;
          time = 1;
          draw();
        }
        if (pauseStartTime && currentTime - pauseStartTime >= animationPauseTime) {
          startTime = currentTime;
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

  async function trainModel() {
    console.log('Starting model training...');
    const trainingObjectiveVal = trainingObjective;
    const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];
    const trainingConfig = settings.trainingConfig;
    const datasetPath = settings.datasetNameToPath['smiley_face'];
    isTraining.set(true);

    return new Promise((resolve) => {
      console.log("Starting training worker thread...");
      trainingWorker = callTrainingWorkerThread(
        trainingObjectiveVal, modelConfig, datasetPath, trainingConfig,
        (tfModelPath) => {
          console.log('Training finished!', tfModelPath);
          isTraining.set(false);
          resolve(tfModelPath);
        },
        () => console.log("Intermediate epoch callback")
      );
    });
  }

  onMount(async () => {
    await loadTargetDistribution();

    if (cachedTrajectoriesPath) {
      const cachedLoaded = await loadCachedTrajectories(cachedTrajectoriesPath);
      if (cachedLoaded) {
        console.log('Loaded cached trajectories');
        initializeVisualization();
        startAnimation();
        return () => {
          stopAnimation();
          if (trainingWorker) trainingWorker.terminate();
        };
      }
    }

    console.log("Training new model...");
    const modelPath = await trainModel();
    await generateSamples(modelPath, numSamples, numSteps);
    downloadTrajectories();
    initializeVisualization();
    startAnimation();

    return () => {
      stopAnimation();
      if (trainingWorker) trainingWorker.terminate();
    };
  });
</script>

<Figure>
  {#snippet children()}
    <PlayButton {isPlaying} onclick={toggleAnimation} />
    <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
    </svg>
  {/snippet}
  {#snippet caption()}
    <div class="caption">
      <span class="figure-number">Figure {figureNumber}:</span> {captionText}
    </div>
  {/snippet}
</Figure>
