# Scripts

This directory contains Node.js scripts for training models, caching samples, and deploying the site.

## Prerequisites

All scripts use TensorFlow.js with the WASM backend for Apple Silicon compatibility. No additional setup required beyond `npm install`.

## Training Scripts

### Train All Models

```bash
npm run train-models
```

Runs both flow matching and rectified flow training sequentially. This is the recommended way to train from scratch.

### Train Flow Matching Model

```bash
npm run train:flow-matching
```

Trains a flow matching model on the smiley face dataset.

- **Output**: `static/models/flow_matching_model.json` + weights
- **Duration**: ~14 seconds
- **Epochs**: 2000

### Train Rectified Flow Model

```bash
npm run train:rectified-flow
```

Trains a rectified flow model using iterative reflow on the smiley face dataset.

- **Output**: `static/models/rectified_flow_model.json` + weights
- **Duration**: ~1 minute
- **Epochs**: 2000 per rectification step (2 steps total = 4000 epochs)

## Sample Caching

### Generate Cached Samples

```bash
npm run cache-samples
```

Generates pre-computed trajectory samples for faster page load. Only generates missing cache files.

To force regeneration of all caches:

```bash
npm run cache-samples -- --force
```

**Cache files generated:**

| File | Description |
|------|-------------|
| `flow_matching_trajectories.json` | 150 random trajectories from flow matching model |
| `rectified_flow_trajectories.json` | 150 random trajectories from rectified flow model |
| `flow_matching_grid_trajectories.json` | 6x6 uniform grid trajectories |
| `rectified_flow_grid_trajectories.json` | 6x6 uniform grid trajectories |

**Configuration** (in `cache-samples.ts`):

- `numSamples`: Number of random samples (default: 300, matches target distribution)
- `numSteps`: Integration steps per trajectory (default: 200)
- `gridResolution`: Grid size for uniform sampling (default: 6)
- `domainRange`: Spatial bounds for grid (default: -1.5 to 1.5)

## Deployment

### Build and Deploy

```bash
npm run deploy
```

Builds the production site and deploys to GitHub Pages. Requires the `gh-pages` package and appropriate repository permissions.

### Build Only

```bash
npm run build
```

Builds the site to `build/` without deploying.

## Workflow

Typical workflow for updating the site:

```bash
# 1. Train models (if needed)
npm run train-models

# 2. Generate sample caches
npm run cache-samples -- --force

# 3. Test locally
npm run dev

# 4. Build and deploy
npm run deploy
```

## File Structure

```
scripts/
├── README.md                  # This file
├── train-models.ts            # Orchestrator for all training
├── train-flow-matching.ts     # Flow matching training
├── train-rectified-flow.ts    # Rectified flow training
├── cache-samples.ts           # Sample cache generation
├── bundle-workers.js          # Web worker bundling (run by build)
└── deploy.js                  # GitHub Pages deployment
```
