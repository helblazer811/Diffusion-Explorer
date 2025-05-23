import * as tf from '@tensorflow/tfjs';

export class Model {
    protected model: tf.Sequential;
    protected dim: number;
  
    constructor(dim: number = 2, hidden: number = 64) {
        if (new.target === Model) {
            throw new Error("Cannot instantiate abstract class Model directly.");
        }
        // Initialize the network
        this.dim = dim;
        this.model = tf.sequential();
        // Add one to input layer to account for time conditionoing
        this.model.add(tf.layers.dense({ inputShape: [dim + 1], units: hidden, activation: 'elu' }));
        this.model.add(tf.layers.dense({ units: hidden, activation: 'elu' }));
        this.model.add(tf.layers.dense({ units: hidden, activation: 'elu' }));
        this.model.add(tf.layers.dense({ units: dim }));
    }

    setModel(model: tf.Sequential) {
        this.model = model;
    }

    async download() {
        await this.model.save('downloads://model'); // Prompts the user to download it
    }

    /**
     * Train the model using its respective objective
     * @param data tf.Tensor2D of shape [num_samples, dim]
     * @param epochs number of iterations to train the model
     * @param batchSize number of samples to use in each batch
     * @param updateInterval number of epochs to wait before updating the model
     * @returns 
     */
    train(
        data: tf.Tensor2D,
        epochs: number = 1000,
        batchSize: number = 32,
        updateInterval: number = 50,
        endEpochCallback: (epoch: number, intermediateSamples: number[][] | null) => void = () => { },
        stopTraining: () => boolean | Promise<boolean> = () => { false },
    ){
        throw new Error("Method 'train()' not implemented.");
    }
  
    /**
     * Compute the vector field or noise prediction at (x_t, t)
     * @param x_t tf.Tensor2D of shape [batch, dim]
     * @param t tf.Tensor1D or tf.Tensor2D of shape [batch] or [batch, 1]
     */
    forward(x_t: tf.Tensor2D, t: tf.Tensor1D | tf.Tensor2D): tf.Tensor {
        throw new Error("Method 'forward()' not implemented.");
    }
  
    /**
     * Integrate one step from t_start to t_end using midpoint method
     * @param x_t tf.Tensor2D of shape [batch, dim]
     * @param t_start tf.Tensor1D or tf.Tensor2D of shape [batch] or [batch, 1]
     * @param t_end tf.Tensor1D or tf.Tensor2D of shape [batch] or [batch, 1]
     */
    step(x_t: tf.Tensor2D, t_start: tf.Tensor1D | tf.Tensor2D, t_end: tf.Tensor1D | tf.Tensor2D): tf.Tensor2D {
        throw new Error("Method 'step()' not implemented.");
    }

    /**
     * Draw `num_samples` samples from the model at time step `t`
     * @param num_samples number of samples to draw
     * @param t timestep to draw samples at in [0, num_total_steps]
     * @param num_total_steps number of total steps to simulate the ODE
     * @returns tf.Tensor2D of shape [num_total_steps, num_samples, dim]
     */
    sample(num_samples: number, num_total_steps: number = 100): tf.Tensor3D {
        throw new Error("Method 'sample()' not implemented.");
    }

    /**
     * Draw samples from the model using the given initial points
     * @param initial_points tf.Tensor2D of shape [num_samples, dim]
     * @param num_total_steps 
     */
    sample_from_initial_points(initial_points: tf.Tensor2D, num_total_steps: number = 100): tf.Tensor3D {
        throw new Error("Method 'sample_from_initial_points()' not implemented.");
    }
}

class Sampler {

    step() {
        throw new Error('Not implemented');
    }

    sample() {
        throw new Error('Not implemented');
    }
}