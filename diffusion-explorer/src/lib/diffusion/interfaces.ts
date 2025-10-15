import * as tf from '@tensorflow/tfjs';

export interface BaseModelConfig {
    dim: number;
    hidden: number;
}

export interface ConditionalModelConfig extends BaseModelConfig {
    condDim: number;
}

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

    /**
     * Factory constructor for a Model subclass from a config object.
     * This assumes the subclass implements the same constructor signature.
     */
    static fromConfig<T extends typeof Model>(
        this: T,
        config: Partial<BaseModelConfig>
    ): InstanceType<T> {
        const { dim, hidden } = config;
        if (dim === undefined) throw new Error("Missing required field 'dim' in config");
        if (hidden === undefined) throw new Error("Missing required field 'hidden' in config");
        return new this(dim, hidden) as InstanceType<T>;
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
    sample(
        num_samples: number, 
        num_total_steps: number = 100,
        options?: object
    ): tf.Tensor3D {
        throw new Error("Method 'sample()' not implemented.");
    }

    /**
     * Draw samples from the model using the given initial points
     * @param initial_points tf.Tensor2D of shape [num_samples, dim]
     * @param num_total_steps 
     * @param options Optional parameters for future extensibility
     */
    sample_from_initial_points(initial_points: tf.Tensor2D, num_total_steps: number = 100, options: {} = {}): tf.Tensor3D {
        throw new Error("Method 'sample_from_initial_points()' not implemented.");
    }
}

export class ConditionalModel {
    protected model: tf.Sequential;
    protected dim: number;
    protected condDim: number; // dimension of the conditioning vector

    constructor(dim: number = 2, condDim: number = 0, hidden: number = 64) {
        if (new.target === ConditionalModel) {
            throw new Error("Cannot instantiate abstract class ConditionalModel directly.");
        }
        this.dim = dim;
        this.condDim = condDim;

        this.model = tf.sequential();
        // Input layer: x_t + time + conditioning
        this.model.add(tf.layers.dense({
            inputShape: [dim + 1 + condDim],
            units: hidden,
            activation: 'elu'
        }));
        this.model.add(tf.layers.dense({ units: hidden, activation: 'elu' }));
        this.model.add(tf.layers.dense({ units: hidden, activation: 'elu' }));
        this.model.add(tf.layers.dense({ units: dim })); // output matches x_t dimension
    }


    /**
     * Factory constructor for ConditionalModel subclasses from config.
     */
    static fromConfig<T extends typeof ConditionalModel>(
        this: T,
        config: Partial<ConditionalModelConfig>
    ): InstanceType<T> {
        const { dim, condDim, hidden } = config;
        if (dim === undefined) throw new Error("Missing required field 'dim' in config");
        if (condDim === undefined) throw new Error("Missing required field 'condDim' in config");
        if (hidden === undefined) throw new Error("Missing required field 'hidden' in config");
        return new this(dim, condDim, hidden) as InstanceType<T>;
    }

    async download() {
        await this.model.save('downloads://conditional_model');
    }

    setModel(model: tf.Sequential) {
        this.model = model;
    }

    /**
     * Train the model with conditional inputs
     * @param data tf.Tensor2D of shape [num_samples, dim]
     * @param cond tf.Tensor2D of shape [num_samples, condDim]
     */
    train(
        data: tf.Tensor2D,
        cond: tf.Tensor2D,
        epochs: number = 1000,
        batchSize: number = 32,
        updateInterval: number = 50,
        endEpochCallback: (epoch: number, intermediateSamples: number[][] | null) => void = () => { },
        stopTraining: () => boolean | Promise<boolean> = () => false
    ) {
        throw new Error("Method 'train()' not implemented.");
    }

    /**
     * Compute the vector field or noise prediction at (x_t, t) conditioned on c
     * @param x_t tf.Tensor2D of shape [batch, dim]
     * @param t tf.Tensor1D or tf.Tensor2D of shape [batch] or [batch,1]
     * @param c tf.Tensor2D of shape [batch, condDim]
     */
    forward(x_t: tf.Tensor2D, t: tf.Tensor1D | tf.Tensor2D, c: tf.Tensor2D): tf.Tensor {
        throw new Error("Method 'forward()' not implemented.");
    }

    step(x_t: tf.Tensor2D, t_start: tf.Tensor1D | tf.Tensor2D, t_end: tf.Tensor1D | tf.Tensor2D, c: tf.Tensor2D): tf.Tensor2D {
        throw new Error("Method 'step()' not implemented.");
    }

    sample(
        num_samples: number, 
        num_total_steps: number = 100,
        options?: { cond?: tf.Tensor1D | tf.Tensor2D, guidanceScale?: number, return_guidance?: boolean }
    ): any {
        throw new Error("Method 'sample()' not implemented.");
    }

    sample_from_initial_points(
        initial_points: tf.Tensor2D, 
        num_total_steps: number = 100,
        options?: { cond?: tf.Tensor1D | tf.Tensor2D, guidanceScale?: number, return_guidance?: boolean }
    ): any {
        throw new Error("Method 'sample_from_initial_points()' not implemented.");
    }
}
