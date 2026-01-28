# Miscellaneous Figures

A collection of standalone interactive figures for exploring diffusion models and related concepts.

## Available Figures

- **pull_toward_mean**: Flow Matching vs Diffusion comparison
- **diffusion_vs_ddim**: DDPM vs DDIM sampling comparison

## Code Structure Guidelines

### Directory Structure for New Figures

Each figure follows this standard structure:

```
diffusion-explorer/apps/miscellaneous/
├── src/routes/<figure_name>/
│   ├── +page.svelte              # Entry point, data loading, client initialization
│   └── <FigureName>.svelte       # Main component with visualization logic
├── scripts/<figure_name>/
│   ├── train.ts                  # Model training script (run via npm)
│   └── sample.ts                 # Trajectory caching script (run via npm)
└── static/<figure_name>/
    ├── models/                   # Trained model files (.json + .weights.bin)
    ├── cached_samples/           # Pre-computed trajectory JSON files
    ├── workers/                  # Bundled web worker files
    └── data/                     # Dataset files (can symlink shared data)
```

### Naming Conventions

- **Routes and static directories**: `snake_case` (e.g., `pull_toward_mean`, `diffusion_vs_ddim`)
- **Svelte components**: `PascalCase` (e.g., `PullTowardMean.svelte`, `DiffusionVsDDIM.svelte`)
- **NPM scripts**: `kebab-case` (e.g., `train:pull-toward-mean`, `sample:diffusion-vs-ddim`)

### Adding a New Figure

1. **Create route directory**: `src/routes/<figure_name>/`
2. **Create scripts**: `scripts/<figure_name>/train.ts` and `sample.ts`
3. **Create static directories**: `static/<figure_name>/models/`, `cached_samples/`, `workers/`, `data/`
4. **Update `scripts/bundle-workers.js`**: Add worker output path for the new figure
5. **Update `package.json`**: Add `train:<figure-name>` and `sample:<figure-name>` scripts
6. **Run the pipeline**:
   ```bash
   npm run train:<figure-name>
   npm run sample:<figure-name>
   npm run bundle-workers
   ```

### Worker Bundling

Workers are pre-bundled because they import npm packages that browsers cannot resolve dynamically.
The `bundle-workers.js` script uses esbuild to create browser-compatible bundles.

To add a new worker output, edit `scripts/bundle-workers.js`:

```javascript
const workers = [
  {
    entry: 'src/lib/workers/<worker_name>.worker.ts',
    output: 'static/<figure_name>/workers/<worker_name>.worker.js'
  }
];
```

### Shared Data

When multiple figures use the same dataset, create a symlink instead of duplicating:

```bash
cd static/<new_figure>/data
ln -s ../../<existing_figure>/data/<dataset>.json <dataset>.json
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```
