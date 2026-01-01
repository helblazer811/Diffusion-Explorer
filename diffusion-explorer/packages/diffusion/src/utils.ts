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

/**
 * Generate a uniform grid of points for sampling.
 * @param gridResolution Number of points along each axis
 * @param domainRange The domain range for x and y coordinates
 * @returns A tensor of shape [gridResolution * gridResolution, 2] containing the flattened grid points
 */
export function sampleUniformGrid(
    gridResolution: number,
    domainRange: { xMin: number, xMax: number, yMin: number, yMax: number }
): tf.Tensor {
    // First uniformly sample the x and y coordinates
    const width = domainRange.xMax - domainRange.xMin;
    const height = domainRange.yMax - domainRange.yMin;
    // Make range of data bit wider (currently 0.0, so no expansion)
    const xMin = domainRange.xMin + 0.0 * width;
    const xMax = domainRange.xMax - 0.0 * width;
    const yMin = domainRange.yMin + 0.0 * height;
    const yMax = domainRange.yMax - 0.0 * height;
    const x = tf.linspace(xMin, xMax, gridResolution);
    const y = tf.linspace(yMin, yMax, gridResolution);
    let initialPoints: tf.Tensor = tf.stack(tf.meshgrid(x, y), 2);
    initialPoints = initialPoints.reshape([gridResolution * gridResolution, 2]); // Flatten the points to be [gridResolution * gridResolution, 2]
    return initialPoints;
}