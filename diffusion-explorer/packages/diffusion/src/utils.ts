import * as tf from '@tensorflow/tfjs';

// ========== DATA LOADING / CACHING FUNCTIONS ==========

/**
 * Load target distribution from a JSON file and randomly sample points.
 */
export async function loadTargetDistribution(
  dataPath: string,
  numSamples: number
): Promise<number[][] | null> {
  try {
    const response = await fetch(dataPath);
    const data = await response.json();
    const allPoints = data.points as number[][];
    // Fisher-Yates shuffle for unbiased random sampling
    const shuffled = [...allPoints];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, numSamples);
  } catch (error) {
    console.error('Failed to load target distribution:', error);
    return null;
  }
}

/**
 * Load cached trajectories from a JSON file.
 * Returns trajectories and the source distribution (first timestep).
 */
export async function loadCachedTrajectories(
  path: string
): Promise<{ trajectories: number[][][]; sourceDistribution: number[][] } | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      console.log('Cached trajectories file not found:', path);
      return null;
    }

    const cachedData = await response.json();
    if (!cachedData || !Array.isArray(cachedData)) {
      console.error('Invalid cached trajectories format from file: ', path);
      return null;
    }

    if (cachedData.length > 0 && cachedData[0]) {
      return {
        trajectories: cachedData,
        sourceDistribution: cachedData[0]
      };
    }

    console.error('Cached trajectories array is empty');
    return null;
  } catch (error) {
    console.log('Could not load cached trajectories:', error);
    return null;
  }
}

/**
 * Generic interface for vector field data (used by loadCachedVectorField).
 */
export interface VectorFieldData {
  gridResolution: number;
  timeSteps: number[];
  domainRange: { xMin: number; xMax: number; yMin: number; yMax: number };
  velocities: number[][][];
  gridPoints: number[][];
}

/**
 * Load cached vector field data from a JSON file.
 */
export async function loadCachedVectorField(
  path: string
): Promise<VectorFieldData | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      console.log('Cached vector field file not found:', path);
      return null;
    }

    const cachedData = await response.json();

    // Validate format
    if (!cachedData ||
        typeof cachedData.gridResolution !== 'number' ||
        !Array.isArray(cachedData.timeSteps) ||
        !Array.isArray(cachedData.velocities)) {
      console.error('Invalid cached vector field format');
      return null;
    }

    return cachedData;
  } catch (error) {
    console.log('Could not load cached vector field:', error);
    return null;
  }
}

/**
 * Generic interface for rectified flow data (used by loadCachedRectifiedFlowTrajectories).
 */
export interface RectifiedFlowData {
  allRectifiedTrajectories: number[][][][];
  modelPath: string;
}

/**
 * Load cached rectified flow trajectories from a JSON file.
 */
export async function loadCachedRectifiedFlowTrajectories(
  path: string
): Promise<RectifiedFlowData | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      console.log('Cached rectified flow file not found:', path);
      return null;
    }

    const cachedData = await response.json();

    // Validate format
    if (!cachedData ||
        !Array.isArray(cachedData.allRectifiedTrajectories) ||
        typeof cachedData.modelPath !== 'string') {
      console.error('Invalid cached rectified flow format');
      return null;
    }

    return cachedData;
  } catch (error) {
    console.log('Could not load cached rectified flow:', error);
    return null;
  }
}

// ========== MODEL UTILITIES ==========

/**
 * Download a trained model from IndexedDB to the user's device.
 * Triggers a browser download of two files: {downloadName}.json and {downloadName}.weights.bin
 * @param modelPath The IndexedDB path (e.g., "indexeddb://Flow_Matching_123456")
 * @param downloadName The base filename for download (e.g., "flow_matching_model")
 */
export async function downloadModelFromIndexedDB(
  modelPath: string,
  downloadName: string
): Promise<void> {
  try {
    const model = await tf.loadLayersModel(modelPath);
    await model.save(`downloads://${downloadName}`);
    console.log(`Model downloaded as ${downloadName}.json and ${downloadName}.weights.bin`);
  } catch (error) {
    console.error(`Failed to download model from ${modelPath}:`, error);
  }
}

/**
 * Validates that a model path exists by checking for model.json
 * @throws Error if the model path does not exist
 */
export async function validateModelPath(modelPath: string): Promise<void> {
  // Determine the model.json URL - if path already ends with .json, use it directly
  // Otherwise append /model.json
  const modelJsonPath = modelPath.endsWith('.json')
    ? modelPath
    : modelPath.endsWith('/')
      ? `${modelPath}model.json`
      : `${modelPath}/model.json`;

  try {
    const response = await fetch(modelJsonPath);
    if (!response.ok) {
      throw new Error(`Model not found at path: ${modelPath} (HTTP ${response.status} for ${modelJsonPath})`);
    }
    // Verify it's valid JSON
    const data = await response.json();
    if (!data.modelTopology && !data.weightsManifest) {
      throw new Error(`Invalid model.json format at: ${modelJsonPath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Model not found')) {
      throw error;
    }
    throw new Error(`Failed to validate model at path: ${modelPath} - ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ========== BROWSER UTILITIES ==========

/**
 * Download data as a JSON file in the browser.
 * @param data The data to serialize and download
 * @param filename The filename for the download (default: 'data.json')
 */
export function downloadJSON(data: any, filename: string = 'data.json'): void {
  const jsonStr = JSON.stringify(data, null, 2); // pretty-print
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url); // Clean up
}

// ========== COORDINATE TRANSFORMATIONS ==========

export function convertDataToDisplayCoordinateFrame(
    data: tf.Tensor, // shape: [T, N, 2]
    domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
    distributionWidth: number,
    displayAreaWidth: number,
    numSteps: number,
): tf.Tensor {
    return tf.tidy(() => {
        const min = tf.tensor([domainRange.xMin, domainRange.yMin]);
        const range = tf.tensor([domainRange.xMax - domainRange.xMin, domainRange.yMax - domainRange.yMin]);
        const offsetScale = tf.tensor([displayAreaWidth - distributionWidth, 0]);

        const dataNorm = data.sub(min).div(range);           // [T, N, 2]
        const dataScaled = dataNorm.mul(distributionWidth);  // [T, N, 2]

        const time = tf.linspace(0, 1, numSteps).reshape([numSteps, 1, 1]); // [T, 1, 1]
        const offset = time.mul(offsetScale);                // [T, 1, 2]
        const result = dataScaled.add(offset);               // [T, N, 2]

        return result;
    });
}

// Generate a single standard normal sample using Box-Muller
function standardNormal() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random(); // Avoid 0
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Generate a vector of standard normal variables
function sampleStandardNormals(dim) {
    return Array.from({ length: dim }, standardNormal);
}

// Perform Cholesky decomposition (returns lower-triangular matrix)
function choleskyDecomposition(cov) {
    const n = cov.length;
    const L = Array.from({ length: n }, () => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let sum = cov[i][j];
            for (let k = 0; k < j; k++) {
                sum -= L[i][k] * L[j][k];
            }
            if (i === j) {
                L[i][j] = Math.sqrt(sum);
            } else {
                L[i][j] = sum / L[j][j];
            }
        }
    }
    return L;
}

// Multiply matrix L by vector z
function matVecMultiply(L, z) {
    const n = L.length;
    const result = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            result[i] += L[i][j] * z[j];
        }
    }
    return result;
}

// Add two vectors
function vecAdd(a, b) {
    return a.map((val, i) => val + b[i]);
}

// Sample from a multivariate normal distribution
export function sampleMultivariateNormal(mean, cov, numSamples = 1) {
    if (numSamples == 1) {
        const dim = mean.length;
        const L = choleskyDecomposition(cov);
        const z = sampleStandardNormals(dim);
        const x = matVecMultiply(L, z);
        return vecAdd(x, mean);
    } else {
        const samples = [];
        for (let i = 0; i < numSamples; i++) {
            const sample = sampleMultivariateNormal(mean, cov);
            samples.push(sample);
        }
        return tf.tensor(samples);
    }
}

export function sampleGaussianMixture(
    numSamples: number
):tf.Tensor2D {
    console.log(tf.getBackend());
    // Return a mixture of 3 Gaussian distributions spaced out like a triangle
    const means = [
        tf.tensor([0, 4 / Math.sqrt(3)]),
        tf.tensor([-2, -2 / Math.sqrt(3)]),
        tf.tensor([2, -2 / Math.sqrt(3)])
    ];
    const covs = [
        tf.tensor([[0.5, 0.0], [0.0, 0.5]]),
        tf.tensor([[0.5, 0.0], [0.0, 0.5]]),
        tf.tensor([[0.5, 0.0], [0.0, 0.5]])
    ]

    const samplesPerComponent = Math.floor(numSamples / means.length);
    const sampleGap = numSamples - samplesPerComponent * means.length; // Remaining samples to be added to the last component
    const samples = [];
    for (let i = 0; i < means.length; i++) {
        const currentMean = means[i].arraySync();
        const currentCov = covs[i].arraySync();
        const numCurrentSamples = i === means.length - 1 ? samplesPerComponent + sampleGap: samplesPerComponent;
        const componentSamples = sampleMultivariateNormal(
            currentMean,
            currentCov,
            numCurrentSamples
        );
        samples.push(componentSamples);
    }
    const allSamples = tf.concat(samples, 0);

    return allSamples;
}

// ========== GRID AND SAMPLING HELPERS ==========

export interface DomainRange {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
}

/**
 * Generate a uniform grid of points for sampling.
 * @param gridResolution Number of points along each axis
 * @param domainRange The domain range for x and y coordinates
 * @param asTensor If true, returns tf.Tensor2D; if false (default), returns number[][]
 */
export function generateUniformGridSamples(
    gridResolution: number,
    domainRange: DomainRange,
    asTensor: true
): tf.Tensor2D;
export function generateUniformGridSamples(
    gridResolution: number,
    domainRange: DomainRange,
    asTensor?: false
): number[][];
export function generateUniformGridSamples(
    gridResolution: number,
    domainRange: DomainRange,
    asTensor: boolean = false
): tf.Tensor2D | number[][] {
    const { xMin, xMax, yMin, yMax } = domainRange;

    if (asTensor) {
        // Use tf.linspace + meshgrid for tensor output
        const x = tf.linspace(xMin, xMax, gridResolution);
        const y = tf.linspace(yMin, yMax, gridResolution);
        const points = tf.stack(tf.meshgrid(x, y), 2);
        return points.reshape([gridResolution * gridResolution, 2]) as tf.Tensor2D;
    } else {
        // Pure JS for array output
        const samples: number[][] = [];
        for (let i = 0; i < gridResolution; i++) {
            for (let j = 0; j < gridResolution; j++) {
                const x = xMin + (xMax - xMin) * (i / (gridResolution - 1));
                const y = yMin + (yMax - yMin) * (j / (gridResolution - 1));
                samples.push([x, y]);
            }
        }
        return samples;
    }
}

/**
 * Generate clipped Gaussian samples within a maximum radius.
 * Uses rejection sampling to ensure all samples fall within 2 standard deviations.
 * @param numSamples Number of samples to generate
 * @returns Array of [x, y] coordinates
 */
export function generateClippedGaussianSamples(numSamples: number): number[][] {
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

            const clippedBatch = clipSamplesToRadius(rawSamplesArray, threshold);
            allClippedSamples = allClippedSamples.concat(clippedBatch);
        }
        return allClippedSamples.slice(0, numSamples);
    });
}

// ========== CLIPPING FUNCTIONS ==========

/**
 * Clip samples to only include those within a given radius from the origin.
 * @param samples Array of [x, y] coordinates
 * @param radius Maximum distance from origin to include
 * @returns Filtered array containing only samples within the radius
 */
export function clipSamplesToRadius(samples: number[][], radius: number): number[][] {
    return samples.filter(sample => {
        const [x, y] = sample;
        const distance = Math.sqrt(x * x + y * y);
        return distance <= radius;
    });
}

/**
 * Clip trajectories to only include samples whose starting point is within a given radius.
 * @param trajectories Array of trajectories: [timestep][sample][dim]
 * @param radius Maximum distance from origin for starting points
 * @returns Filtered trajectories with only samples that start within the radius
 */
export function clipTrajectoriesToStartingRadius(
    trajectories: number[][][],
    radius: number
): number[][][] {
    if (!trajectories || trajectories.length === 0) return trajectories;

    // Get starting points (timestep 0)
    const startingPoints = trajectories[0];

    // Find indices of samples whose starting point is within the radius
    const validIndices: number[] = [];
    for (let i = 0; i < startingPoints.length; i++) {
        const [x, y] = startingPoints[i];
        const distance = Math.sqrt(x * x + y * y);
        if (distance <= radius) {
            validIndices.push(i);
        }
    }

    // Filter all timesteps to keep only valid samples
    return trajectories.map(timestep =>
        validIndices.map(i => timestep[i])
    );
}

/**
 * Clip all rectified flow trajectories to only include samples whose starting point is within a given radius.
 * @param allRectifiedTrajectories Array: [rectifiedStep][timestep][sample][dim]
 * @param radius Maximum distance from origin for starting points
 * @returns Filtered trajectories for all rectified steps
 */
export function clipAllRectifiedTrajectoriesToStartingRadius(
    allRectifiedTrajectories: number[][][][],
    radius: number
): number[][][][] {
    if (!allRectifiedTrajectories || allRectifiedTrajectories.length === 0) {
        return allRectifiedTrajectories;
    }

    return allRectifiedTrajectories.map(rectStep =>
        clipTrajectoriesToStartingRadius(rectStep, radius)
    );
}