<script lang="ts">
  import { onMount } from 'svelte';
  import { writable, type Writable } from 'svelte/store';
  import * as tf from '@tensorflow/tfjs';
  import {
    callTrainingWorkerThread,
    callRectifiedFlowTrainingWorker,
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
  import VectorField from '$lib/figures/VectorField.svelte';
  import RectifiedFlowVisualization from '$lib/figures/RectifiedFlowVisualization.svelte';
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
    gridPoints: number[][];
  }

  const vectorFieldData: Writable<VectorFieldData | null> = writable(null);

  // Rectified flow data store
  interface RectifiedFlowData {
    allRectifiedTrajectories: number[][][][]; // [rectified_step][num_timesteps][num_samples][dim]
    modelPath: string;
  }
  const rectifiedFlowData: Writable<RectifiedFlowData | null> = writable(null);

  // Worker reference
  let trainingWorker: Worker | null = null;
  let rectifiedTrainingWorker: Worker | null = null;

  // Configuration
  const numSamples = 100;
  const numSteps = 300;
  const cachedTrajectoriesPath = "cached_samples/smiley_face_trajectories.json";

  // Vector field configuration
  const cachedVectorFieldPath = "cached_samples/smiley_face_vector_field.json";
  const vectorFieldGridResolution = 12;
  const vectorFieldTimeSteps = 200;

  // Rectified flow configuration
  const cachedRectifiedFlowPath: string | null = "cached_samples/smiley_face_rectified_flow_trajectories.json"; // Set to null to always train
  const rectifiedFlowConfig = {
    num_rectified_steps: 3,
    epochs_per_rectified_step: 100,
    batchSize: 32,
    num_simulation_steps: 200,
    sourceDistributionPath: null // null means generate Gaussian
  };

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

    // Use hardcoded domain range
    const domainRange = {
      xMin: -2.5,
      xMax: 2.5,
      yMin: -2.5,
      yMax: 2.5
    };

    // Generate time steps
    const timeSteps: number[] = [];
    for (let i = 0; i < numTimeSteps; i++) {
      timeSteps.push(i / (numTimeSteps - 1));
    }

    // Collect velocities and grid points for all time steps
    const allVelocities: number[][][] = [];
    let gridPoints: number[][] = [];

    for (let i = 0; i < timeSteps.length; i++) {
      const t = timeSteps[i];
      console.log(`Sampling vector field at t=${t.toFixed(2)}...`);

      // Use promise to wait for worker callback
      const result = await new Promise<{velocities: number[][], gridPoints?: number[][]}>((resolve) => {
        const worker = callSamplingWorkerThreadVectorFieldGrid(
          samplingWorkerUrl,
          modelPath,
          trainingObjectiveVal,
          modelConfig,
          gridResolution,
          domainRange,
          (velocities) => {
            // Worker callback - need to access the raw message
            resolve({ velocities: velocities as number[][] });
          },
          t
        );

        // Override the worker message handler to capture gridPoints
        worker.onmessage = (e) => {
          if (e.data.type === 'result') {
            resolve({
              velocities: e.data.velocities,
              gridPoints: e.data.gridPoints
            });
          }
        };
      });

      allVelocities.push(result.velocities);

      // Capture grid points from first call (same for all time steps)
      if (i === 0 && result.gridPoints) {
        gridPoints = result.gridPoints;
      }
    }

    // Store complete vector field data
    const fieldData: VectorFieldData = {
      gridResolution,
      timeSteps,
      domainRange,
      velocities: allVelocities,
      gridPoints
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

  function downloadRectifiedFlowData() {
    const data = $rectifiedFlowData;
    if (!data) {
      console.error('No rectified flow data to download');
      return;
    }
    const filename = 'rectified_flow_trajectories_' + new Date().getTime() + '.json';
    downloadJSON(data, filename);
    console.log('Rectified flow data downloaded:', filename,
                data.allRectifiedTrajectories.length, 'rectified steps');
  }

  async function loadCachedRectifiedFlow(path: string) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        console.log('Cached rectified flow file not found:', path);
        return false;
      }

      const cachedData = await response.json();

      // Validate format
      if (!cachedData ||
          !Array.isArray(cachedData.allRectifiedTrajectories) ||
          typeof cachedData.modelPath !== 'string') {
        console.error('Invalid cached rectified flow format');
        return false;
      }

      rectifiedFlowData.set(cachedData);
      console.log('Loaded cached rectified flow:',
                  cachedData.allRectifiedTrajectories.length, 'rectified steps');
      return true;
    } catch (error) {
      console.log('Could not load cached rectified flow:', error);
      return false;
    }
  }

  async function trainRectifiedFlow() {
    console.log('Starting rectified flow training...');
    const trainingObjectiveVal = trainingObjective;
    const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];
    const datasetPath = settings.datasetNameToPath['smiley_face'];

    return new Promise((resolve) => {
      const allTrajectories: number[][][][] = [];

      console.log("Starting rectified flow training worker thread...");
      rectifiedTrainingWorker = callRectifiedFlowTrainingWorker(
        trainWorkerUrl,
        trainingObjectiveVal,
        modelConfig,
        datasetPath,
        rectifiedFlowConfig,
        // Finish callback
        (tfModelPath: string, allRectifiedTrajectories: number[][][][]) => {
          console.log('Rectified flow training finished!', tfModelPath);
          console.log('Collected', allRectifiedTrajectories.length, 'rectified steps');

          // Store in state
          const data: RectifiedFlowData = {
            allRectifiedTrajectories,
            modelPath: tfModelPath
          };
          rectifiedFlowData.set(data);

          // Download to JSON
          downloadRectifiedFlowData();

          resolve(tfModelPath);
        },
        // Epoch callback
        (epoch: number, rectifiedStep: number, intermediateSamples: number[][] | null) => {
          console.log(`Rectified step ${rectifiedStep}, epoch ${epoch}`);
        },
        // Rectified step callback
        (rectifiedStep: number, trajectories: number[][] | null) => {
          console.log(`Completed rectified step ${rectifiedStep}`);
          if (trajectories) {
            allTrajectories.push(trajectories);
            console.log('  Trajectories shape:', trajectories.length, 'samples');
          }
        }
      );
    });
  }

  // ========== LIFECYCLE ==========

  onMount(async () => {
    // Load target distribution first
    await loadTargetDistribution();

    // Try to load cached trajectories
    if (cachedTrajectoriesPath && cachedVectorFieldPath) {
      const trajectoriesLoaded = await loadCachedTrajectories(cachedTrajectoriesPath);
      const vectorFieldLoaded = await loadCachedVectorField(cachedVectorFieldPath);

      if (trajectoriesLoaded && vectorFieldLoaded) {
        console.log('Using cached trajectories and vector field');

        // Try to load cached rectified flow if path is provided
        if (cachedRectifiedFlowPath) {
          const rectifiedFlowLoaded = await loadCachedRectifiedFlow(cachedRectifiedFlowPath);
          if (!rectifiedFlowLoaded) {
            console.log('Training rectified flow...');
            await trainRectifiedFlow();
          }
        } else {
          // No cached path, train rectified flow
          console.log('Training rectified flow (no cache)...');
          await trainRectifiedFlow();
        }

        return () => {
          if (trainingWorker) trainingWorker.terminate();
          if (rectifiedTrainingWorker) rectifiedTrainingWorker.terminate();
        };
      }
    }

    // If no cached data, train and sample
    console.log("Training new model...");
    const modelPath = await trainModel();
    await generateSamples(modelPath, numSamples, numSteps);
    downloadTrajectories();
    // Generate the vector field
    await generateVectorField(
      modelPath,
      vectorFieldGridResolution,
      vectorFieldTimeSteps
    );
    downloadVectorField();

    // Train rectified flow
    if (cachedRectifiedFlowPath) {
      const rectifiedFlowLoaded = await loadCachedRectifiedFlow(cachedRectifiedFlowPath);
      if (!rectifiedFlowLoaded) {
        console.log('Training rectified flow...');
        await trainRectifiedFlow();
      }
    } else {
      console.log('Training rectified flow (no cache)...');
      await trainRectifiedFlow();
    }

    return () => {
      if (trainingWorker) trainingWorker.terminate();
      if (rectifiedTrainingWorker) rectifiedTrainingWorker.terminate();
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

  <RectifiedFlowVisualization
    allRectifiedTrajectories={$rectifiedFlowData?.allRectifiedTrajectories ?? []}
    numTrajectoriesToShow={10}
    animationDuration={3000}
    pauseBetweenSteps={1000}
    pauseBeforeRestart={2000}
  >
    {#snippet caption()}
      <div class="caption">
        <span class="figure-number">Figure 1:</span>
        <strong>A rectified flow is a flow-based generative model that learns straighter paths.</strong>
        Watch how paths become straighter
        with each rectification step. Each step retrains the model using trajectories
        from the previous step, progressively reducing curvature.
      </div>
    {/snippet}
  </RectifiedFlowVisualization>
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
  <p>Recently developed flow-based generative models have led to state-of-the-art results in image and video generation. In particular, flow matching has enabled efficient, simulation-free training of continuous normalizing flows. However, a key barrier to deploying these methods at scale is their computational cost and inference latency. Generating a high-quality image with a flow-based model using a naive sampling strategy requires repeatedly evaluating a large neural network, often containing billions of parameters. This repeated application not only incurs a high computational cost but also leads to substantial latency, where it can take minutes before a user receives a generated image or video. As a result, it is highly desirable to develop methods that accelerate inference for flow-based models, allowing samples to be generated using only a small number of neural network evaluations.</p>

  <p>Training a model with flow matching alone is sufficient to generate high-quality samples from a target distribution. However, as illustrated in Figure X, the trajectories followed by individual samples during generation are often curved. This curvature poses a significant obstacle to fast sampling from flow-based models, since curved trajectories typically require many small integration steps to accurately simulate the underlying dynamics.</p>

  <h2>Brief Background on Flow Matching</h2>

  <p>To provide context, the broad goal of generative modeling is to draw samples from an unknown data distribution, such as the distribution of natural images. Given a finite dataset <Katex math={"\\mathcal{X} = \\{x_1, \\dots, x_n\\}"} />, where each <Katex math={"x_i \\in \\mathbb{R}^d"} /> is sampled from a target distribution <Katex math="q" />, the objective is to learn a model that can generate new samples from <Katex math="q" />. Directly modeling and sampling from <Katex math="q" /> is generally intractable, motivating the use of indirect approaches.</p>

  <p>Continuous normalizing flows address this challenge by modeling a path of probability distributions <Katex math={"(p_t)_{0 \\leq t \\leq 1}"} />, which smoothly interpolates between a simple source distribution <Katex math={"p_0"} /> at time <Katex math={"t = 0"} /> and the data distribution <Katex math={"p_1 = q"} /> at time <Katex math={"t = 1"} />. The source distribution <Katex math={"p_0"} /> is typically chosen to be easy to sample from, such as a multivariate Gaussian <Katex math={"p_0 = \\mathcal{N}(0, \\sigma^2 I)"} />. By sampling from <Katex math={"p_0"} /> and transforming these samples along the probability path, we can obtain samples distributed according to the target distribution <Katex math="q" />.</p>

  <p>A flow <Katex math={"\\psi_t(x)"} /> is a time-indexed mapping that defines trajectories of individual points through this probability path. When applied to samples <Katex math={"X_0 \\sim p_0"} />, the flow transports them to samples <Katex math={"X_1 \\sim p_1 = q"} />. At intermediate times, the transformed samples <Katex math={"X_t = \\psi_t(X_0)"} /> are distributed according to the corresponding distribution <Katex math={"p_t"} />. If we can successfully model this flow, then sampling from the generative model reduces to drawing samples from the simple source distribution and applying the learned transformation.</p>

  <p>Rather than modeling the flow <Katex math={"\\psi_t"} /> directly, flow-based generative models instead define the flow implicitly through a time-dependent velocity field <Katex math={"v(x, t) = v_t(x)"} />. This velocity field specifies the instantaneous velocity of a particle located at position <Katex math="x" /> at time <Katex math="t" />. The flow is then defined as the solution to an ordinary differential equation,</p>

  <div style="text-align: center; margin: 1.5rem 0;">
    <Katex math={"\\frac{d}{dt} \\psi_t(x) = v_t(x), \\quad \\psi_0(x) = x."} displayMode={true} />
  </div>

  <p>These equations state that the time derivative of the flow must match the velocity of the particle at each point in time, starting from its initial position at <Katex math={"t = 0"} />. Solving this ordinary differential equation yields the flow <Katex math={"\\psi_t(x)"} />, which transports samples from the source distribution to the target distribution. Sampling from a flow-based generative model therefore amounts to numerically simulating this differential equation, tracing each sample's trajectory from the source to the target distribution.</p>

  <h2>Visualizing Flow Matching</h2>
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

  <h2>Vector Field Visualization</h2>
  <p>Below we visualize the learned velocity field and how sample trajectories flow through it.</p>

  <VectorField
    vectorFieldData={$vectorFieldData}
    allTimeSamples={$allTimeSamples}
    figureNumber="4"
    captionText="Left: Animated vector field showing the learned velocity at each point over time. Right: A sample trajectory (red) flowing through the vector field toward the target distribution (blue points)."
  />

  <h2>Acknowledgements</h2>
  <div class="acknowledgements">
    <p></p>
  </div>
<!--
  <h2>Material Icons</h2>

  <p>
    <span class="material-icons">favorite</span>
    <span class="material-icons">home</span>
    <span class="material-icons">settings</span>
  </p> -->
</div>