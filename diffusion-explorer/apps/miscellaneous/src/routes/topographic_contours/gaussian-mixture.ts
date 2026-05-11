/**
 * Gaussian Mixture Model with 3 anisotropic components.
 * Evaluates the mixture PDF on a 2D grid for contour extraction.
 * Uses TensorFlow.js for automatic differentiation to solve gradient descent paths.
 */

import * as tf from '@tensorflow/tfjs';

type GaussianComponent = {
  weight: number;
  mean: [number, number];
  cov: [[number, number], [number, number]];
};

const components: GaussianComponent[] = [
  // Elongated ~45 degrees, upper-left
  { weight: 0.3, mean: [-4.0, 4.0], cov: [[2.2, 1.2], [1.2, 1.1]] },
  // Elongated ~-30 degrees, lower-right
  { weight: 0.25, mean: [4.0, -3.5], cov: [[1.6, -0.8], [-0.8, 1.3]] },
  // Horizontal elongation, center-left
  { weight: 0.2, mean: [-1.0, -1.0], cov: [[2.4, 0.2], [0.2, 0.7]] },
  // Upper-right, slight tilt
  { weight: 0.25, mean: [3.5, 4.5], cov: [[1.2, 0.4], [0.4, 1.8]] },
];

function gaussian2D(x: number, y: number, comp: GaussianComponent): number {
  const [[a, b], [, d]] = comp.cov;
  const det = a * d - b * b;
  const invA = d / det;
  const invB = -b / det;
  const invD = a / det;

  const dx = x - comp.mean[0];
  const dy = y - comp.mean[1];
  const exponent = -0.5 * (dx * dx * invA + 2 * dx * dy * invB + dy * dy * invD);

  return (1 / (2 * Math.PI * Math.sqrt(det))) * Math.exp(exponent);
}

export function evaluateGMM(x: number, y: number): number {
  let sum = 0;
  for (const comp of components) {
    sum += comp.weight * gaussian2D(x, y, comp);
  }
  return sum;
}

export function evaluateGrid(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  resolution: number,
): { values: Float64Array; width: number; height: number } {
  const values = new Float64Array(resolution * resolution);

  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const x = xMin + (i / (resolution - 1)) * (xMax - xMin);
      const y = yMin + (j / (resolution - 1)) * (yMax - yMin);
      values[j * resolution + i] = evaluateGMM(x, y);
    }
  }

  return { values, width: resolution, height: resolution };
}

/**
 * Evaluate the GMM log-likelihood using tf.js ops (differentiable).
 * Takes a 1D tensor [x, y] and returns a scalar tensor of log p(x, y).
 */
function tfLogLikelihood(xy: tf.Tensor1D): tf.Scalar {
  return tf.tidy(() => {
    const x = xy.slice(0, 1);
    const y = xy.slice(1, 1);

    let mixture = tf.scalar(0);

    for (const comp of components) {
      const [[a, b], [, d]] = comp.cov;
      const det = a * d - b * b;
      const invA = d / det;
      const invB = -b / det;
      const invD = a / det;

      const dx = x.sub(comp.mean[0]);
      const dy = y.sub(comp.mean[1]);

      const exponent = dx.mul(dx).mul(invA)
        .add(dx.mul(dy).mul(2 * invB))
        .add(dy.mul(dy).mul(invD))
        .mul(-0.5);

      const normConst = 1 / (2 * Math.PI * Math.sqrt(det));
      const density = exponent.exp().mul(normConst * comp.weight);

      mixture = mixture.add(density.reshape([]));
    }

    return mixture.log() as tf.Scalar;
  });
}

/**
 * Compute a gradient descent path on the energy E(x) = -log p(x).
 * This is equivalent to gradient ascent on log-likelihood,
 * so the dot climbs toward the nearest mode.
 *
 * @returns Array of [x, y] points along the path.
 */
export function computeGradientDescentPath(
  startX: number,
  startY: number,
  numSteps = 200,
  learningRate = 0.05,
): number[][] {
  const path: number[][] = [[startX, startY]];

  let currentX = startX;
  let currentY = startY;

  for (let i = 0; i < numSteps; i++) {
    const [gradX, gradY] = tf.tidy(() => {
      const xy = tf.tensor1d([currentX, currentY]);
      const gradFn = tf.grad((inp: tf.Tensor) => tfLogLikelihood(inp as tf.Tensor1D));
      const grads = gradFn(xy);
      return Array.from(grads.dataSync());
    });

    // Early stopping: gradient magnitude is negligible
    const gradMag = Math.sqrt(gradX * gradX + gradY * gradY);
    if (gradMag < 1e-3) break;

    // Gradient ascent on log-likelihood (= gradient descent on energy)
    currentX += learningRate * gradX;
    currentY += learningRate * gradY;
    path.push([currentX, currentY]);
  }

  return path;
}
