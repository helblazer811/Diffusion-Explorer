<!-- This figure shows a source distribution mapped to a target distribution. Also shows the trajectory of an individual sample. -->

<script lang="ts">
  import { onMount } from 'svelte';
  import { writable, get } from 'svelte/store';
  import * as tf from '@tensorflow/tfjs';
  import * as d3 from 'd3';
  import { callTrainingWorkerThread, callSamplingWorkerThread, sampleMultivariateNormal } from '$lib/diffusion';
  import { downloadJSON } from '$lib/utils';

  // Props/Configuration
  export let width = 800;
  export let height = 300;
  export let cachedTrajectoriesPath: string | null = null;
  export let numSamples = 100;

  // Styling props for visualization
  export let sourcePointColor = '#3b82f6';
  export let targetPointColor = '#f17720';
  export let margin = 20;
  export let sourceLabelText = 'Source Distribution';
  export let targetLabelText = 'Target Distribution';
  export let labelFontSize = 22;
  export let labelColor = '#666';
  export let pointRadius = 5;
  export let pointOpacity = 0.4;
  export let flowWidth = 10; // Gap between source and target in data units

  // Animation settings
  export let animationDuration = 3000; // Duration in milliseconds
  export let animationPauseTime = 1000; // Pause time between loops in milliseconds

  // Contour plot settings
  export let showContours = true;
  export let contourBandwidth = 0.3;
  export let contourLevels = 5;
  export let contourOpacity = 0.5;
  export let sourceContourColor = '#3b82f6';
  export let targetContourColor = '#f17720';
  export let intermediateContourColor = '#888888';
  export let trainingObjective = 'Flow Matching';

  // Stores for training state
  const isTraining = writable(false);

  // Stores for sampling state
  const allTimeSamples = writable<number[][][]>([]);
  const isPlaying = writable(false);

  // Distribution samples
  let sourceDistributionSamples: number[][] = [];
  let targetDistributionSamples: number[][] = [];
  let currentSamples: number[][] = [];

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


  /**
   * Generate samples from a trained model for a set of initial points
   * @param modelPath - Path to the trained model
   * @param initialPoints - Optional initial points to sample from (if not provided, uses random Gaussian)
   * @param numSamples - Number of samples to generate (default: 100)
   * @param numberOfSteps - Number of steps for the sampling process (default: 50)
   * @param cachedSamplesPath - Optional path to cached samples
   */
  async function generateSamples(
    modelPath,
    numSamples = 100,
    numberOfSteps = 200
  ) {
    const trainingObjectiveVal = trainingObjective;
    const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];

    // Generate samples using the sampling worker
    return new Promise((resolve) => {
      callSamplingWorkerThread(
        modelPath,
        trainingObjectiveVal,
        modelConfig,
        numSamples,
        numberOfSteps,
        (allSamples) => {
          allTimeSamples.set(allSamples);
          // Extract initial and final timesteps as source and target distributions
          if (allSamples.length > 0) {
            sourceDistributionSamples = allSamples[0];
            targetDistributionSamples = allSamples[allSamples.length - 1];
            // Initialize current samples with first timestep if not already set
            if (currentSamples.length === 0 && allSamples[0]) {
              currentSamples = allSamples[0];
            }
          }
          if (!get(isTraining)) {
            isPlaying.set(true);
          }
          console.log('Generated samples:', allSamples.length);
          resolve(allSamples);
        },
        settings.domainRange
      );
    });
  }

  /**
   * Load cached trajectories from a file path
   * @param path - Path to the cached trajectories JSON file
   * @returns true if successfully loaded, false otherwise
   */
  async function loadCachedTrajectories(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        console.log('Cached trajectories file not found:', path);
        return false;
      }

      const cachedData = await response.json();

      // Validate that cached data is an array
      if (!cachedData || !Array.isArray(cachedData)) {
        console.error('Invalid cached trajectories format');
        return false;
      }

      // Set the trajectories
      allTimeSamples.set(cachedData);

      // Extract initial points (first timestep) as source distribution
      // Extract final points (last timestep) as target distribution
      if (cachedData.length > 0 && cachedData[0]) {
        sourceDistributionSamples = cachedData[0];
        targetDistributionSamples = cachedData[cachedData.length - 1];
        currentSamples = cachedData[0]; // Initialize current samples with source
        console.log('Loaded cached trajectories:', cachedData.length, 'timesteps');
        isPlaying.set(true);
        return true;
      }

      console.error('Cached trajectories array is empty');
      return false;
    } catch (error) {
      console.log('Could not load cached trajectories:', error);
      return false;
    }
  }

  /**
   * Create D3 scales for plotting
   */
  function createScales(sourcePoints: number[][], targetPoints: number[][]) {
    const drawableWidth = width - 2 * margin;
    const drawableHeight = height - 2 * margin;
    const aspectRatio = drawableHeight / drawableWidth;

    // Shift target points by flowWidth for extent calculation
    const shiftedTargetPoints = targetPoints.map(p => [p[0] + flowWidth, p[1]]);

    // Combine both point sets to get overall extent
    const allPoints = [...sourcePoints, ...shiftedTargetPoints];

    const xExtent = d3.extent(allPoints, d => d[0]);
    const yExtent = d3.extent(allPoints, d => d[1]);

    const xRange = xExtent[1] - xExtent[0];
    const yRange = yExtent[1] - yExtent[0];

    const xCenter = (xExtent[0] + xExtent[1]) / 2;
    const yCenter = (yExtent[0] + yExtent[1]) / 2;

    // Adjust ranges to match aspect ratio
    let adjustedXRange = xRange;
    let adjustedYRange = yRange;

    if (yRange / xRange > aspectRatio) {
      adjustedXRange = yRange / aspectRatio;
    } else {
      adjustedYRange = xRange * aspectRatio;
    }

    // Shift y center down to accommodate labels at the top
    const yCenterOffset = -adjustedYRange * 0.07;

    xScale = d3.scaleLinear()
      .domain([xCenter - adjustedXRange / 2, xCenter + adjustedXRange / 2])
      .range([margin, width - margin]);

    yScale = d3.scaleLinear()
      .domain([yCenter - adjustedYRange / 2 - yCenterOffset, yCenter + adjustedYRange / 2 - yCenterOffset])
      .range([margin, height - margin]);
  }

  /**
   * Generic function to plot scatter plot
   * @param points - Array of 2D points
   * @param color - Color for the points
   * @param groupId - SVG group ID
   * @param time - Time parameter (0 to 1) that controls horizontal shift
   */
  function plotScatter(points: number[][], color: string, groupId: string, time: number) {
    if (!svgElement || !xScale || !yScale || points.length === 0) return;

    const svg = d3.select(svgElement);

    // Remove existing group if it exists
    svg.select(`#${groupId}`).remove();

    // Create a group for this scatter plot
    const group = svg.append('g').attr('id', groupId);

    // Calculate x-shift based on time
    const xShift = time * flowWidth;

    // Plot points with shift applied in data space
    group.selectAll('circle')
      .data(points)
      .enter()
      .append('circle')
      .attr('class', (d, i) => `${groupId}-point point-${i}`)
      .attr('cx', d => xScale(d[0] + xShift))
      .attr('cy', d => yScale(d[1]))
      .attr('r', pointRadius)
      .attr('fill', color)
      .attr('opacity', pointOpacity);
  }

  /**
   * Plot contour map for a distribution
   */
  function plotContourMap(points: number[][], color: string, opacity: number, groupId: string, time: number = 0) {
    if (!svgElement || !xScale || !yScale || points.length === 0) return;

    const svg = d3.select(svgElement);

    // Remove existing group if it exists
    svg.select(`#${groupId}`).remove();

    // Calculate x-shift based on time
    const xShift = time * flowWidth;

    // Apply shift in data space
    const shiftedPoints = points.map(p => [p[0] + xShift, p[1]]);

    // Transform points to SVG coordinate space
    const transformedPoints = shiftedPoints.map(p => [xScale(p[0]), yScale(p[1])]);

    // Create contour density
    const contours = d3.contourDensity()
      .x(d => d[0])
      .y(d => d[1])
      .size([width, height])
      .bandwidth(contourBandwidth * width / 10)
      .thresholds(contourLevels)
      (transformedPoints);

    // Create a group for this contour plot
    const group = svg.append('g').attr('id', groupId);

    // Draw contours
    group.selectAll('path')
      .data(contours)
      .enter()
      .append('path')
      .attr('d', d3.geoPath())
      .attr('fill', color)
      .attr('stroke', 'none')
      .attr('fill-opacity', opacity);
  }

  /**
   * Plot labels for source and target distributions
   */
  function plotLabels(sourcePoints: number[][], targetPoints: number[][]) {
    if (!svgElement || !xScale || !yScale) return;

    const svg = d3.select(svgElement);

    // Find the maximum y-value across both distributions
    const sourceYMax = Math.max(...sourcePoints.map(p => p[1]));
    const targetYMax = Math.max(...targetPoints.map(p => p[1]));
    const overallYMax = Math.max(sourceYMax, targetYMax);
    const labelY = overallYMax + 0.5;

    // Calculate x centers for each distribution
    const sourceXCenter = sourcePoints.reduce((sum, p) => sum + p[0], 0) / sourcePoints.length;
    const targetXCenter = targetPoints.reduce((sum, p) => sum + p[0], 0) / targetPoints.length;

    // Remove existing labels if they exist
    svg.select('#sourceLabel').remove();
    svg.select('#targetLabel').remove();

    // Add source label (time = 0, no shift)
    svg.append('text')
      .attr('id', 'sourceLabel')
      .attr('x', xScale(sourceXCenter))
      .attr('y', yScale(labelY))
      .attr('text-anchor', 'middle')
      .attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor)
      .text(sourceLabelText);

    // Add target label (time = 1, shift by flowWidth)
    svg.append('text')
      .attr('id', 'targetLabel')
      .attr('x', xScale(targetXCenter + flowWidth))
      .attr('y', yScale(labelY))
      .attr('text-anchor', 'middle')
      .attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor)
      .text(targetLabelText);
  }

  /**
   * Plot source and target distributions
   */
  function plotDistributions() {
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) {
      return;
    }

    // Create scales using both source and target samples
    createScales(sourceDistributionSamples, targetDistributionSamples);

    // Plot contour maps for source and target distributions
    plotContourMap(sourceDistributionSamples, sourceContourColor, contourOpacity, 'sourceContour', 0);
    plotContourMap(targetDistributionSamples, targetContourColor, contourOpacity, 'targetContour', 1);

    // Plot scatter plots for both distributions
    plotScatter(sourceDistributionSamples, sourcePointColor, 'sourceScatter', 0);
    plotScatter(targetDistributionSamples, targetPointColor, 'targetScatter', 1);

    // Plot contour map and scatter for intermediate samples at current time
    const allSamples = get(allTimeSamples);
    if (allSamples.length > 0) {
      const numSteps = allSamples.length;
      // Convert time (0-1) to step index
      const currentStep = Math.round(time * (numSteps - 1));
      const intermediateSamples = allSamples[currentStep];

      if (intermediateSamples && intermediateSamples.length > 0) {
        plotContourMap(intermediateSamples, intermediateContourColor, contourOpacity, 'intermediateContour', time);
        plotScatter(intermediateSamples, intermediateContourColor, 'intermediateScatter', time);
      }
    }
  }

  /**
   * Start the animation loop
   */
  function startAnimation() {
    let startTime: number | null = null;
    let isPaused = false;
    let pauseStartTime: number | null = null;

    function animate(currentTime: number) {
      if (startTime === null) {
        startTime = currentTime;
      }

      const elapsed = currentTime - startTime;

      // Check if we're in pause period
      if (elapsed >= animationDuration) {
        if (!isPaused) {
          isPaused = true;
          pauseStartTime = currentTime;
          time = 1; // Ensure we end at 1
          plotDistributions();
        }

        if (pauseStartTime && currentTime - pauseStartTime >= animationPauseTime) {
          // Reset for next loop
          startTime = currentTime;
          isPaused = false;
          pauseStartTime = null;
          time = 0;
        }
      } else {
        // Update time during animation
        time = Math.min(elapsed / animationDuration, 1);
        plotDistributions();
      }

      animationFrameId = requestAnimationFrame(animate);
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Stop the animation loop
   */
  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  /**
   * Train a flow matching model
   */
  async function trainModel() {
    console.log('Starting model training...');
    const trainingObjectiveVal = trainingObjective;
    const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];
    const trainingConfig = settings.trainingConfig;
    const datasetPath = settings.datasetNameToPath['smiley_face'];

    isTraining.set(true);

    // Start training worker thread
    return new Promise((resolve) => {
      console.log("Starting training worker thread...");
      trainingWorker = callTrainingWorkerThread(
        trainingObjectiveVal,
        modelConfig,
        datasetPath,
        trainingConfig,
        (tfModelPath) => {
          console.log('Training finished!', tfModelPath);
          isTraining.set(false);

          // Download the trained model metadata
          const modelMetadata = {
            modelPath: tfModelPath,
            trainingObjective: trainingObjectiveVal,
            dataset: 'smiley_face',
            modelConfig: modelConfig,
            trainingConfig: trainingConfig,
            timestamp: new Date().toISOString(),
            domainRange: settings.domainRange
          };

          const filename = `flow_matching_model_smiley_face_${Date.now()}.json`;
          downloadJSON(modelMetadata, filename);
          console.log('Model metadata downloaded:', filename);

          resolve(tfModelPath);
        },
        () => {
          console.log("Intermediate epoch callback");
        } // Empty callback for intermediate epochs
      );
    });
  }

  // Initialize component on mount
  onMount(async () => {
    // Load target distribution (smiley face) and use as source
    const response = await fetch('/data/smiley_face.json');
    const data = await response.json();
    const allPoints = data.points as number[][];

    // Randomly subsample numSamples points
    const shuffled = [...allPoints].sort(() => Math.random() - 0.5);
    sourceDistributionSamples = shuffled.slice(0, numSamples);
    currentSamples = sourceDistributionSamples;

    console.log('Loaded source distribution samples:', sourceDistributionSamples.length);

    // Try to load cached trajectories if path is provided
    let cachedLoaded = false;
    if (cachedTrajectoriesPath) {
      cachedLoaded = await loadCachedTrajectories(cachedTrajectoriesPath);

      // Plot cached distributions
      if (cachedLoaded) {
        plotDistributions();
        startAnimation();
      }
    }

    // If cached trajectories were not loaded, train and sample automatically
    if (!cachedLoaded) {
      console.log("Failed to load cached trajectories, training new model...");
      // Train the model
      const modelPath = await trainModel();

      // Generate samples from the trained model
      await generateSamples(modelPath, numSamples, 50);

      // Plot the distributions after samples are generated
      plotDistributions();
      startAnimation();
    }

    // Clean up worker on component destroy
    return () => {
      stopAnimation();
      if (trainingWorker) {
        trainingWorker.terminate();
      }
    };
  });
</script>

<svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
</svg>