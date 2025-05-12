import * as tf from '@tensorflow/tfjs';

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