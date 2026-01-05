# @diffusion-explorer/diffusion

TensorFlow.js implementations of Flow Matching and Diffusion models for 2D visualization.

## Package Structure

```
packages/diffusion/
├── src/
│   ├── flow_matching/       # Flow matching implementation
│   │   ├── flow_matching.ts # FlowModel class
│   │   ├── schedulers.ts    # ODE integrators (euler, euler_midpoint)
│   │   └── client.ts        # Web worker client
│   ├── diffusion/           # DDPM diffusion implementation
│   │   ├── diffusion.ts     # DiffusionModel class
│   │   ├── schedulers.ts    # Noise schedules and samplers (DDPM, DDIM)
│   │   └── client.ts        # Web worker client
│   ├── interfaces.ts        # Shared Model base class
│   └── utils.ts             # Shared utilities
├── scripts/                 # Training verification scripts
├── tests/                   # Unit tests
└── models/                  # Saved model weights (gitignored)
```

## Scripts

```bash
# Run unit tests
npm test

# Train flow matching model (verifies implementation)
npm run train:flow

# Train diffusion model (verifies implementation)
npm run train:diffusion
```

## Testing

Tests use a custom tsx runner due to V8/TensorFlow.js WASM memory issues with Vitest. The test suite covers:

- Model instantiation and forward pass
- Training (loss reduction)
- Sampling (trajectory generation)
- Noise schedule computation

Full training verification is done via the training scripts.

## Usage

```typescript
import { FlowModel } from '@diffusion-explorer/diffusion';
import { DiffusionModel } from '@diffusion-explorer/diffusion';

// Flow Matching
const flowModel = new FlowModel(dim, hiddenSize);
await flowModel.train(data, epochs, batchSize, updateInterval, stopFn, callback);
const trajectories = await flowModel.sample(numSamples, numSteps);

// Diffusion (DDPM)
const diffusionModel = new DiffusionModel(dim, hiddenSize, T, betaStart, betaEnd);
await diffusionModel.train(data, epochs, batchSize, updateInterval, stopFn, callback);
const trajectories = await diffusionModel.sample(numSamples, numSteps, { scheduler: 'ddpm' });
```

## Web Worker Usage

For browser environments, use the client classes to run models in web workers:

```typescript
import { FlowModelClient } from '@diffusion-explorer/diffusion';

const client = new FlowModelClient();
await client.initialize(dim, hiddenSize);
await client.train(dataArray, epochs, batchSize, updateInterval, onEpoch);
const samples = await client.sample(numSamples, numSteps);
```
