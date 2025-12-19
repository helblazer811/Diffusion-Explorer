<script lang="ts">
  import { onMount } from 'svelte';
  import { writable, type Writable } from 'svelte/store';
  import * as tf from '@tensorflow/tfjs';
  import { 
    callTrainingWorkerThread, 
    callSamplingWorkerThreadFromInitialPoints, 
    callSamplingWorkerThreadVectorFieldGrid, 
    sampleMultivariateNormal
  } from '@diffusion-explorer/diffusion';
  import { downloadJSON } from '$lib/utils';

  import DoubleFigure from '$lib/components/DoubleFigure.svelte';
  import IndependentCoupling from '$lib/figures/IndependentCoupling.svelte';
  import FlowModelIntro from '$lib/figures/FlowModelIntro.svelte';
  import CurvedTrajectoryIntro from '$lib/figures/CurvedTrajectoryIntro.svelte';
  import EulerSamplerFigure from '$lib/figures/EulerSamplerFigure.svelte';
  import { Katex } from '@diffusion-explorer/ui';

  // ========== DATA MANAGEMENT STATE ==========

  // Data stores (shared by both components)
  const sourceDistributionSamples: Writable<number[][]> = writable([]);
  const targetDistributionSamples: Writable<number[][]> = writable([]);
  const allTimeSamples: Writable<number[][][]> = writable([]);
  const isTraining: Writable<boolean> = writable(false);

  // Vector field data store
  interface VectorFieldData {
    gridResolution: number;
    timeSteps: number[];
    domainRange: { xMin: number; xMax: number; yMin: number; yMax: number };
    velocities: number[][][];
  }

  const vectorFieldData: Writable<VectorFieldData | null> = writable(null);

  // Worker reference
  let trainingWorker: Worker | null = null;

  // Configuration
  const numSamples = 100;
  const numSteps = 300;
  const cachedTrajectoriesPath = null; // "cached_samples/smiley_face_trajectories.json";

  // Vector field configuration
  const cachedVectorFieldPath = null; // "cached_samples/smiley_face_vector_field.json";
  const vectorFieldGridResolution = 20;
  const vectorFieldTimeSteps = 10;

  const trainWorkerUrl = 'src/lib/flow_matching_workers/train.worker.js';
  const samplingWorkerUrl = 'src/lib/flow_matching_workers/sampling.worker.js';

  const settings = {
    trainingObjectiveToModelConfig: {
      "Flow Matching": { dim: 2, hidden: 64 }
    },
    datasetNameToPath: {
      smiley_face: '/data/smiley_face.json'
    },
    trainingConfig: {
      epochs: 500,
      batchSize: 1024,
      verbose: true,
      displayInterval: 100
    },
    domainRange: null
  };
  const trainingObjective = 'Flow Matching';

  // ========== DATA LOADING FUNCTIONS ==========

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

  async function loadTargetDistribution() {
    try {
      const response = await fetch('/data/smiley_face.json');
      const data = await response.json();
      const allPoints = data.points as number[][];
      const shuffled = [...allPoints].sort(() => Math.random() - 0.5);
      targetDistributionSamples.set(shuffled.slice(0, numSamples));
      console.log('Loaded target distribution samples:', numSamples);
      return true;
    } catch (error) {
      console.error('Failed to load target distribution:', error);
      return false;
    }
  }

  async function loadCachedTrajectories(path: string) {
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
        sourceDistributionSamples.set(cachedData[0]);
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

  async function loadCachedVectorField(path: string) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        console.log('Cached vector field file not found:', path);
        return false;
      }

      const cachedData = await response.json();

      // Validate format
      if (!cachedData ||
          typeof cachedData.gridResolution !== 'number' ||
          !Array.isArray(cachedData.timeSteps) ||
          !Array.isArray(cachedData.velocities)) {
        console.error('Invalid cached vector field format');
        return false;
      }

      vectorFieldData.set(cachedData);
      console.log('Loaded cached vector field:',
                  cachedData.timeSteps.length, 'timesteps,',
                  cachedData.gridResolution, 'x', cachedData.gridResolution, 'grid');
      return true;
    } catch (error) {
      console.log('Could not load cached vector field:', error);
      return false;
    }
  }

  async function generateSamples(modelPath: any, numSamples: number, numberOfSteps: number) {
    const trainingObjectiveVal = trainingObjective;
    const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];
    const initialPoints = generateClippedGaussianSamples(numSamples);

    return new Promise((resolve) => {
      callSamplingWorkerThreadFromInitialPoints(
        samplingWorkerUrl,
        modelPath, 
        trainingObjectiveVal, 
        modelConfig, 
        initialPoints, 
        numberOfSteps,
        (allSamples) => {
          allTimeSamples.set(allSamples);
          sourceDistributionSamples.set(allSamples[0]);
          console.log('Generated samples:', allSamples.length);
          resolve(allSamples);
        },
        settings.domainRange
      );
    });
  }

  async function generateVectorField(
    modelPath: any,
    gridResolution: number,
    numTimeSteps: number
  ) {
    console.log('Generating vector field...');
    const trainingObjectiveVal = trainingObjective;
    const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];

    // Determine domain range from target distribution
    const targetSamples = $targetDistributionSamples;
    if (targetSamples.length === 0) {
      console.error('No target distribution loaded');
      return;
    }

    const xValues = targetSamples.map(p => p[0]);
    const yValues = targetSamples.map(p => p[1]);
    const padding = 1.0;
    const domainRange = {
      xMin: Math.min(...xValues) - padding,
      xMax: Math.max(...xValues) + padding,
      yMin: Math.min(...yValues) - padding,
      yMax: Math.max(...yValues) + padding
    };

    // Generate time steps
    const timeSteps: number[] = [];
    for (let i = 0; i < numTimeSteps; i++) {
      timeSteps.push(i / (numTimeSteps - 1));
    }

    // Collect velocities for all time steps
    const allVelocities: number[][][] = [];

    for (let i = 0; i < timeSteps.length; i++) {
      const t = timeSteps[i];
      console.log(`Sampling vector field at t=${t.toFixed(2)}...`);

      // Use promise to wait for worker callback
      const velocities = await new Promise<number[][]>((resolve) => {
        callSamplingWorkerThreadVectorFieldGrid(
          samplingWorkerUrl,
          modelPath,
          trainingObjectiveVal,
          modelConfig,
          gridResolution,
          domainRange,
          (result) => {
            resolve(result as number[][]);
          },
          t
        );
      });

      allVelocities.push(velocities);
    }

    // Store complete vector field data
    const fieldData: VectorFieldData = {
      gridResolution,
      timeSteps,
      domainRange,
      velocities: allVelocities
    };

    vectorFieldData.set(fieldData);
    console.log('Vector field generation complete:',
                allVelocities.length, 'timesteps');
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
        trainWorkerUrl,
        trainingObjectiveVal, 
        modelConfig, 
        datasetPath, 
        trainingConfig,
        (tfModelPath) => {
          console.log('Training finished!', tfModelPath);
          isTraining.set(false);
          resolve(tfModelPath);
        },
        () => console.log("Intermediate epoch callback")
      );
    });
  }

  function downloadTrajectories() {
    const trajectories = $allTimeSamples;
    if (!trajectories || trajectories.length === 0) {
      console.error('No trajectories to download');
      return;
    }
    const filename = 'flow_matching_trajectories_' + new Date().getTime() + '.json';
    downloadJSON(trajectories, filename);
    console.log('Trajectories downloaded:', filename, trajectories.length, 'timesteps');
  }

  function downloadVectorField() {
    const field = $vectorFieldData;
    if (!field) {
      console.error('No vector field to download');
      return;
    }
    const filename = 'flow_matching_vector_field_' + new Date().getTime() + '.json';
    downloadJSON(field, filename);
    console.log('Vector field downloaded:', filename,
                field.timeSteps.length, 'timesteps,',
                field.gridResolution, 'x', field.gridResolution, 'grid');
  }

  // ========== LIFECYCLE ==========

  onMount(async () => {
    // Load target distribution first
    await loadTargetDistribution();

    // Try to load cached trajectories
    if (cachedTrajectoriesPath) {
      const cachedLoaded = await loadCachedTrajectories(cachedTrajectoriesPath);

      if (cachedLoaded) {
        console.log('Using cached trajectories');

        // Try to load vector field even if trajectories cached
        if (cachedVectorFieldPath) {
          const vectorFieldLoaded = await loadCachedVectorField(cachedVectorFieldPath);
          if (!vectorFieldLoaded) {
            console.log('Cached vector field not found, generation skipped (no model available)');
          }
        }

        return () => {
          if (trainingWorker) trainingWorker.terminate();
        };
      }
    }

    // If no cached data, train and sample
    console.log("Training new model...");
    const modelPath = await trainModel();
    await generateSamples(modelPath, numSamples, numSteps);
    downloadTrajectories();

    // Generate and download vector field
    if (cachedVectorFieldPath !== null) {
      const vectorFieldLoaded = await loadCachedVectorField(cachedVectorFieldPath);

      if (!vectorFieldLoaded) {
        console.log('Generating vector field...');
        await generateVectorField(
          modelPath,
          vectorFieldGridResolution,
          vectorFieldTimeSteps
        );
        downloadVectorField();
      }
    }

    return () => {
      if (trainingWorker) trainingWorker.terminate();
    };
  });
</script>
<div class="page-container">
  <div class="title-header-wrapper">
    <h1 class="article-title">A Visual Explanation of Rectified Flows</h1>
    <div class="byline-dateline-container">
      <h3 class="byline">By <a href="https://alechelbling.com">Alec Helbling</a></h3>
      <h3 class="dateline">December 24, 2025</h3>
    </div>
  </div>
<!-- 

  <h2>Typography</h2>
fl
  <p>This is a paragraph with the default paragraph styles. It has a font size of 1.2rem and line height of 1.6em.</p>

  <p>Here's some <code>inline code</code> with background styling.</p>

  <h2>Inline Math</h2>

  <p>
    This paragraph demonstrates inline math equations. For example, the equation <Katex math="E = mc^2" /> .
  </p>

  <h2>Links</h2>

  <p>
    <a href="#normal">Normal link</a> |
    <a href="#visited" style="color: rgb(0, 80, 160);">Visited link (simulated)</a>
  </p>

  <h2>Form Elements</h2>

  <label>Text Input:</label>
  <input type="text" placeholder="Type something..." />

  <label>Disabled Input:</label>
  <input type="text" disabled value="Disabled input" />

  <label>Range Input:</label>
  <input type="range" min="0" max="100" value="50" />

  <label>Select Dropdown:</label>
  <select>
    <option>Option 1</option>
    <option>Option 2</option>
    <option>Option 3</option>
  </select>

  <label>Textarea:</label>
  <textarea rows="3" placeholder="Enter multiple lines..."></textarea>

  <h2>Buttons</h2>

  <button>Normal Button</button>
  <button>Click and hold to see active state</button>

  <h2>Special Classes</h2>

  <p><span class="figure-number">Figure 1:</span> This demonstrates the figure-number class with bold font weight.</p>

  <div class="acknowledgements">
    <p>This paragraph is inside the acknowledgements div, with smaller font size (1rem) and line height (1.4rem).</p>
  </div> -->
  <p>Introduction content. </p>
  <h2>Brief Background on Flow Matching</h2>
  <FlowModelIntro
    sourceDistributionSamples={$sourceDistributionSamples}
    targetDistributionSamples={$targetDistributionSamples}
    {allTimeSamples}
    {isTraining}
  />
  <p></p>
  <CurvedTrajectoryIntro
    sourceDistributionSamples={$sourceDistributionSamples}
    targetDistributionSamples={$targetDistributionSamples}
    {allTimeSamples}
    {isTraining}
  />
  <p></p>
  <h2>Curvature is the Enemy of Speed </h2>
  <p>Curved sampling trajectories are difficult to accurately simulate in a few steps. </p>

  <EulerSamplerFigure>
    {#snippet caption()}
      <div class="caption">
        <span class="figure-number">Figure 2:</span> Comparison of Euler method approximations for high-curvature (left) and low-curvature (right) functions. Ground truth shown in black, Euler approximation in orange.
      </div>
    {/snippet}
  </EulerSamplerFigure>

  <h2>The Limitations of an Independent Coupling</h2>
  <h3>What is a coupling? </h3>
  <p></p>

  <IndependentCoupling />

  <DoubleFigure>
    {#snippet left()}
      <!-- Left figure content -->
    {/snippet}

    {#snippet right()}
      <!-- Right figure content -->
    {/snippet}

    {#snippet caption()}
      <div class="caption">
        <span class="figure-number">Figure 4:</span> Double figure example.
      </div>
    {/snippet}
  </DoubleFigure>
<!--
  <h2>Material Icons</h2>

  <p>
    <span class="material-icons">favorite</span>
    <span class="material-icons">home</span>
    <span class="material-icons">settings</span>
  </p> -->
</div>