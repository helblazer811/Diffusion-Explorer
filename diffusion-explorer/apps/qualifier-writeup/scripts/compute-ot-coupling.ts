// Compute Optimal Transport coupling between Gaussian and smiley face distributions using Sinkhorn
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Configuration
const CONFIG = {
  numSamples: 150,
  epsilon: 0.1,  // Increased for better convergence
  maxIter: 500,  // More iterations for convergence
  tolerance: 1e-6,
  clippingRadius: 2.0,  // Clip Gaussian samples to this radius (matches settings.stylingSettings.scatterPlot.clippingRadius)
  targetDistributionPath: 'static/data/smiley_face.json',
  outputPath: 'static/cached_samples/ot_coupling.json',
};

// Initialize WASM backend
async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
}

// Load target distribution from JSON file
function loadTargetDistribution(filePath: string, numSamples: number): number[][] {
  const fullPath = path.join(ROOT, filePath);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  const points: number[][] = data.points;

  // Shuffle and take numSamples
  const shuffled = [...points].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, numSamples);
}

// Generate a single standard normal sample using Box-Muller transform
function generateSingleGaussianSample(dim: number = 2): number[] {
  const sample: number[] = [];
  for (let d = 0; d < dim; d++) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    sample.push(z);
  }
  return sample;
}

// Compute L2 norm of a point
function norm(point: number[]): number {
  return Math.sqrt(point.reduce((sum, x) => sum + x * x, 0));
}

// Generate clipped Gaussian samples (rejection sampling within radius)
function generateClippedGaussianSamples(numSamples: number, clippingRadius: number, dim: number = 2): number[][] {
  const samples: number[][] = [];

  while (samples.length < numSamples) {
    const sample = generateSingleGaussianSample(dim);
    if (norm(sample) <= clippingRadius) {
      samples.push(sample);
    }
  }

  return samples;
}

// Compute pairwise squared Euclidean distances
// X: [n, d], Y: [m, d] -> C: [n, m]
function pairwiseSqDistances(X: tf.Tensor2D, Y: tf.Tensor2D): tf.Tensor2D {
  const X2 = tf.sum(tf.square(X), 1).expandDims(1); // [n, 1]
  const Y2 = tf.sum(tf.square(Y), 1).expandDims(0); // [1, m]
  const XY = tf.matMul(X, Y.transpose());            // [n, m]

  return X2.add(Y2).sub(XY.mul(2)) as tf.Tensor2D;   // [n, m]
}

// Log-domain Sinkhorn algorithm for numerical stability
function sinkhorn(
  C: tf.Tensor2D,
  a: tf.Tensor1D,
  b: tf.Tensor1D,
  options: { epsilon: number; maxIter: number; tolerance: number }
): { P: tf.Tensor2D; iterations: number } {
  const { epsilon, maxIter, tolerance } = options;

  // K = exp(-C / epsilon)
  const K = tf.exp(C.div(-epsilon)) as tf.Tensor2D;

  const n = a.shape[0];
  const m = b.shape[0];

  // Initialize scaling vectors
  let u = tf.ones([n]);
  let v = tf.ones([m]);

  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    // u = a / (K @ v)
    const Kv = tf.matMul(K, v.expandDims(1)).squeeze([1]) as tf.Tensor1D;
    const uNew = a.div(Kv.add(1e-10)) as tf.Tensor1D;

    // v = b / (K^T @ u)
    const KTu = tf.matMul(K.transpose(), uNew.expandDims(1)).squeeze([1]) as tf.Tensor1D;
    const vNew = b.div(KTu.add(1e-10)) as tf.Tensor1D;

    // Check convergence
    const uDiff = tf.sum(tf.abs(uNew.sub(u))).arraySync() as number;
    const vDiff = tf.sum(tf.abs(vNew.sub(v))).arraySync() as number;

    // Clean up old tensors
    u.dispose();
    v.dispose();
    Kv.dispose();
    KTu.dispose();

    u = uNew;
    v = vNew;
    iterations = iter + 1;

    if (uDiff < tolerance && vDiff < tolerance) {
      console.log(`  Sinkhorn converged at iteration ${iterations}`);
      break;
    }
  }

  // P = diag(u) @ K @ diag(v)
  // Equivalent to: P[i,j] = u[i] * K[i,j] * v[j]
  const uExpanded = u.expandDims(1); // [n, 1]
  const vExpanded = v.expandDims(0); // [1, m]
  const P = K.mul(uExpanded).mul(vExpanded) as tf.Tensor2D;

  // Cleanup
  K.dispose();
  u.dispose();
  v.dispose();
  uExpanded.dispose();
  vExpanded.dispose();

  return { P, iterations };
}

// Extract 1-to-1 matching from coupling matrix via row argmax
function extractMatching(P: tf.Tensor2D): number[] {
  const matching = P.argMax(1).arraySync() as number[];
  return matching;
}

// Helper: Format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

async function main() {
  // Initialize backend
  await initBackend();

  console.log('\n========================================');
  console.log('  OT Coupling Computation (Sinkhorn)');
  console.log('========================================\n');

  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}`);
  console.log(`\nConfiguration:`);
  console.log(`  Samples: ${CONFIG.numSamples}`);
  console.log(`  Epsilon: ${CONFIG.epsilon}`);
  console.log(`  Max iterations: ${CONFIG.maxIter}`);

  const startTime = Date.now();

  // Step 1: Load target distribution (smiley face)
  console.log(`\nStep 1: Loading target distribution...`);
  const targetPoints = loadTargetDistribution(CONFIG.targetDistributionPath, CONFIG.numSamples);
  console.log(`  Loaded ${targetPoints.length} target points`);

  // Step 2: Generate clipped Gaussian samples (source)
  console.log(`\nStep 2: Generating clipped Gaussian samples (radius=${CONFIG.clippingRadius})...`);
  const sourcePoints = generateClippedGaussianSamples(CONFIG.numSamples, CONFIG.clippingRadius, 2);
  console.log(`  Generated ${sourcePoints.length} source points`);

  // Step 3: Compute cost matrix
  console.log(`\nStep 3: Computing cost matrix...`);
  const X = tf.tensor2d(sourcePoints);
  const Y = tf.tensor2d(targetPoints);
  const C = pairwiseSqDistances(X, Y);
  console.log(`  Cost matrix shape: [${C.shape.join(', ')}]`);

  // Step 4: Define uniform marginals
  const n = sourcePoints.length;
  const m = targetPoints.length;
  const a = tf.fill([n], 1 / n) as tf.Tensor1D;
  const b = tf.fill([m], 1 / m) as tf.Tensor1D;

  // Step 5: Run Sinkhorn
  console.log(`\nStep 4: Running Sinkhorn algorithm...`);
  const { P, iterations } = sinkhorn(C, a, b, {
    epsilon: CONFIG.epsilon,
    maxIter: CONFIG.maxIter,
    tolerance: CONFIG.tolerance,
  });
  console.log(`  Iterations: ${iterations}`);

  // Verify marginals
  const rowSums = P.sum(1).arraySync() as number[];
  const colSums = P.sum(0).arraySync() as number[];
  const rowSumTotal = rowSums.reduce((acc, val) => acc + val, 0);
  const colSumTotal = colSums.reduce((acc, val) => acc + val, 0);
  console.log(`  Row sum total: ${rowSumTotal.toFixed(6)} (should be ~1)`);
  console.log(`  Col sum total: ${colSumTotal.toFixed(6)} (should be ~1)`);

  // Step 6: Extract matching
  console.log(`\nStep 5: Extracting 1-to-1 matching...`);
  const matching = extractMatching(P);
  console.log(`  Matching length: ${matching.length}`);

  // Compute transport cost
  const transportCost = tf.sum(tf.mul(C, P)).arraySync() as number;
  console.log(`  Transport cost: ${transportCost.toFixed(4)}`);

  // Step 7: Save to JSON
  console.log(`\nStep 6: Saving to ${CONFIG.outputPath}...`);
  const outputData = {
    sourcePoints,
    targetPoints,
    matching,
    epsilon: CONFIG.epsilon,
    numSamples: CONFIG.numSamples,
  };

  const outputFile = path.join(ROOT, CONFIG.outputPath);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
  console.log(`  Saved!`);

  // Cleanup
  X.dispose();
  Y.dispose();
  C.dispose();
  a.dispose();
  b.dispose();
  P.dispose();

  console.log('\n========================================');
  console.log('  OT Coupling Computation Complete!');
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('OT coupling computation failed:', err);
  process.exit(1);
});
