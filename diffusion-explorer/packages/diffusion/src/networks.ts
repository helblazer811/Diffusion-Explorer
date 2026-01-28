/**
 * Network architectures for diffusion and flow matching models.
 *
 * This module provides different neural network architectures that can be
 * selected based on the complexity of the target distribution.
 */

import * as tf from '@tensorflow/tfjs';

// ========== Types ==========

export type NetworkType = 'simple' | 'improved';

export interface NetworkConfig {
    dim: number;              // input/output spatial dimension (default 2)
    hidden: number;           // hidden layer size
    hiddenLayers?: number;    // number of hidden/residual layers (default 3)
    embSize?: number;         // embedding size for improved network (default 128)
    inputScale?: number;      // positional embedding scale for inputs (default 25.0)
}

// ========== Sinusoidal Positional Embeddings ==========

/**
 * Create sinusoidal positional embeddings.
 *
 * Generates embeddings of the form [sin(w_0*x), cos(w_0*x), sin(w_1*x), cos(w_1*x), ...]
 * where frequencies increase geometrically.
 *
 * @param x Input tensor of shape [batch] or [batch, 1]
 * @param embDim Total embedding dimension (must be even)
 * @param scale Frequency scale factor (use 1.0 for time, 25.0 for spatial coords)
 * @returns Embeddings of shape [batch, embDim]
 */
export function sinusoidalEmbedding(x: tf.Tensor, embDim: number, scale: number = 1.0): tf.Tensor2D {
    return tf.tidy(() => {
        // Ensure x is 1D [batch]
        const xFlat = x.rank === 2 ? x.squeeze([1]) : x;
        const batch = xFlat.shape[0];

        // Half the dimensions for sin, half for cos
        const halfDim = embDim / 2;

        // Create frequency bands: exp(-log(10000) * i / halfDim) for i in [0, halfDim)
        // This gives frequencies from 1 to 1/10000
        const freqIndices = tf.range(0, halfDim);
        const logTimescale = Math.log(10000.0);
        const frequencies = tf.exp(freqIndices.mul(-logTimescale / halfDim));

        // Scale input and compute angles: [batch, 1] * [halfDim] -> [batch, halfDim]
        const xScaled = xFlat.mul(scale).expandDims(1);  // [batch, 1]
        const angles = xScaled.mul(frequencies);         // [batch, halfDim]

        // Compute sin and cos embeddings
        const sinEmb = tf.sin(angles);  // [batch, halfDim]
        const cosEmb = tf.cos(angles);  // [batch, halfDim]

        // Interleave sin and cos: [sin_0, cos_0, sin_1, cos_1, ...]
        // Stack and reshape to interleave
        const stacked = tf.stack([sinEmb, cosEmb], 2);  // [batch, halfDim, 2]
        const result = stacked.reshape([batch, embDim]); // [batch, embDim]

        return result as tf.Tensor2D;
    });
}

// ========== Simple Network ==========

/**
 * Create a simple 3-layer MLP with ELU activation.
 *
 * This is the original network architecture:
 * Input: [x, t] concatenated → Dense(ELU) → Dense(ELU) → Dense(ELU) → Dense → output
 *
 * @param config Network configuration
 * @returns A tf.Sequential model
 */
export function createSimpleNetwork(config: NetworkConfig): tf.Sequential {
    const { dim, hidden } = config;
    const model = tf.sequential();

    // Input: spatial coords + time = dim + 1
    model.add(tf.layers.dense({
        inputShape: [dim + 1],
        units: hidden,
        activation: 'elu'
    }));
    model.add(tf.layers.dense({ units: hidden, activation: 'elu' }));
    model.add(tf.layers.dense({ units: hidden, activation: 'elu' }));
    model.add(tf.layers.dense({ units: dim }));  // Output: predict noise/velocity

    return model;
}

// ========== Improved Network ==========

/**
 * Improved MLP with positional embeddings and residual blocks.
 *
 * Architecture:
 * 1. Sinusoidal embedding for time t
 * 2. Sinusoidal embedding for each spatial coordinate (with scale=25.0)
 * 3. Concatenate all embeddings
 * 4. Linear projection to hidden size + GELU
 * 5. N residual blocks (Linear + GELU + residual connection)
 * 6. Final linear projection to output dimension
 *
 * This architecture is based on the approach from:
 * "Denoising Diffusion Probabilistic Models" and related works.
 */
export class ImprovedMLP {
    private config: Required<NetworkConfig>;
    private inputLayer: tf.layers.Layer;
    private residualLayers: tf.layers.Layer[];
    private outputLayer: tf.layers.Layer;

    constructor(config: NetworkConfig) {
        // Fill in defaults
        this.config = {
            dim: config.dim,
            hidden: config.hidden,
            hiddenLayers: config.hiddenLayers ?? 3,
            embSize: config.embSize ?? 128,
            inputScale: config.inputScale ?? 25.0
        };

        const { dim, hidden, hiddenLayers, embSize } = this.config;

        // Input layer: concat of time emb + coord embeddings → hidden
        // For 2D: 3 * embSize (time + x + y)
        const inputSize = (dim + 1) * embSize;
        this.inputLayer = tf.layers.dense({
            units: hidden,
            inputShape: [inputSize],
            useBias: true,
            kernelInitializer: 'glorotNormal'
        });

        // Residual layers
        this.residualLayers = [];
        for (let i = 0; i < hiddenLayers; i++) {
            this.residualLayers.push(tf.layers.dense({
                units: hidden,
                useBias: true,
                kernelInitializer: 'glorotNormal'
            }));
        }

        // Output layer: hidden → dim
        this.outputLayer = tf.layers.dense({
            units: dim,
            useBias: true,
            kernelInitializer: 'glorotNormal'
        });
    }

    /**
     * Forward pass through the network.
     * NOTE: No tf.tidy() here - it would break gradient computation during training.
     * Memory management is handled by the caller.
     *
     * @param x Spatial coordinates [batch, dim]
     * @param t Time values [batch] in range appropriate for the model
     * @param tScale Scale factor for time (e.g., 1/T to normalize to [0,1])
     * @returns Predicted noise/velocity [batch, dim]
     */
    forward(x: tf.Tensor2D, t: tf.Tensor1D | tf.Tensor2D, tScale: number = 1.0): tf.Tensor2D {
        const { dim, embSize, inputScale } = this.config;

        // Ensure t is 1D
        const tFlat = t.rank === 2 ? (t as tf.Tensor2D).squeeze([1]) : t as tf.Tensor1D;

        // Scale time to [0, 1] range if needed
        const tScaled = tFlat.mul(tScale);

        // Create embeddings (sinusoidalEmbedding uses tidy internally, which is fine for leaf tensors)
        const timeEmb = sinusoidalEmbedding(tScaled, embSize, 1.0);

        // Embed each spatial coordinate separately with scale
        const coordEmbs: tf.Tensor2D[] = [];
        for (let i = 0; i < dim; i++) {
            const coord = x.slice([0, i], [-1, 1]).squeeze([1]);
            coordEmbs.push(sinusoidalEmbedding(coord, embSize, inputScale));
        }

        // Concatenate all embeddings: [batch, (dim+1) * embSize]
        const allEmbs = tf.concat([timeEmb, ...coordEmbs], 1);

        // Input projection + GELU
        let h = this.inputLayer.apply(allEmbs) as tf.Tensor2D;

        // Apply GELU
        h = this.gelu(h);

        // Residual blocks
        for (const layer of this.residualLayers) {
            const hNew = layer.apply(h) as tf.Tensor2D;
            const hActivated = this.gelu(hNew);
            h = tf.add(h, hActivated) as tf.Tensor2D;  // Residual connection
        }

        // Output projection
        const output = this.outputLayer.apply(h) as tf.Tensor2D;

        return output;
    }

    /**
     * GELU activation function.
     * GELU(x) = 0.5 * x * (1 + tanh(sqrt(2/π) * (x + 0.044715 * x^3)))
     * NOTE: No tf.tidy() here - it would break gradient computation during training.
     */
    private gelu(x: tf.Tensor2D): tf.Tensor2D {
        const cdf = tf.mul(
            0.5,
            tf.add(
                1.0,
                tf.tanh(
                    tf.mul(
                        Math.sqrt(2 / Math.PI),
                        tf.add(x, tf.mul(0.044715, tf.pow(x, 3)))
                    )
                )
            )
        );
        return tf.mul(x, cdf) as tf.Tensor2D;
    }

    /**
     * Get all trainable weights from the network.
     */
    getWeights(): tf.Tensor[] {
        const weights: tf.Tensor[] = [];
        weights.push(...this.inputLayer.getWeights());
        for (const layer of this.residualLayers) {
            weights.push(...layer.getWeights());
        }
        weights.push(...this.outputLayer.getWeights());
        return weights;
    }

    /**
     * Set all trainable weights in the network.
     */
    setWeights(weights: tf.Tensor[]): void {
        let idx = 0;

        // Input layer (kernel + bias = 2 tensors)
        const inputWeights = this.inputLayer.getWeights();
        this.inputLayer.setWeights(weights.slice(idx, idx + inputWeights.length));
        idx += inputWeights.length;

        // Residual layers
        for (const layer of this.residualLayers) {
            const layerWeights = layer.getWeights();
            layer.setWeights(weights.slice(idx, idx + layerWeights.length));
            idx += layerWeights.length;
        }

        // Output layer
        const outputWeights = this.outputLayer.getWeights();
        this.outputLayer.setWeights(weights.slice(idx, idx + outputWeights.length));
    }

    /**
     * Get the configuration used to create this network.
     */
    getConfig(): Required<NetworkConfig> {
        return { ...this.config };
    }
}

// ========== Factory Function ==========

/**
 * Create a network based on the specified type.
 *
 * @param type 'simple' for basic MLP, 'improved' for positional embeddings + residual blocks
 * @param config Network configuration
 * @returns Either a tf.Sequential (simple) or ImprovedMLP (improved)
 */
export function createNetwork(
    type: NetworkType,
    config: NetworkConfig
): tf.Sequential | ImprovedMLP {
    switch (type) {
        case 'simple':
            return createSimpleNetwork(config);
        case 'improved':
            return new ImprovedMLP(config);
        default:
            throw new Error(`Unknown network type: ${type}`);
    }
}

/**
 * Type guard to check if a network is an ImprovedMLP.
 */
export function isImprovedMLP(network: tf.Sequential | ImprovedMLP): network is ImprovedMLP {
    return network instanceof ImprovedMLP;
}
