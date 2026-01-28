# Streamline Generation Visualization

## Overview

A DoubleFigure visualization comparing naive pathline integration (crowded) vs. streamline generation with spatial filtering (clean).

## Design Decisions

- **Vector Field**: Double vortex (two counter-rotating vortices)
- **Seed Points**: ~25 random seeds
- **Grid Density**: 15x15 collision detection grid
- **Left Panel**: Sequential pathline integration - one at a time, no culling
- **Right Panel**: Sequential integration with grid-based collision detection
- **Collision Animation**: Flash + fade as single normalized animation (0-1)

## Files

```
src/routes/streamline_generation/
├── +page.svelte                    # Route wrapper
├── StreamlineGeneration.svelte     # Main figure component
└── animations.ts                   # Animation classes and helpers
```

## Animation Architecture

### Precomputation (runInitialComputation)

1. Generate seed points
2. Integrate pathlines with RK4
3. For right panel: detect collisions, truncate pathlines at collision point
4. Store full pathlines (left) and truncated pathlines (right)

### Timeline Construction (setupTimeline)

- **Integration clips**: Advance `segmentIndex` from 0 to pathline length
- **Flash+Fade clips**: Added after integration for colliding pathlines
- Duration proportional to pathline length (constant time per step)
- Colliding pathlines are shorter, so animation is shorter

### Flash+Fade Animation

- 0.0-0.3: Grid cell flashes red (alpha ramps up)
- 0.3-1.0: Grid cell fades + trajectory fades out

## Running

```bash
cd diffusion-explorer/apps/miscellaneous
npm run dev
# Navigate to /streamline_generation
```

## Verification

1. Left panel shows sequential pathline integration (becomes crowded)
2. Right panel shows sequential integration with collision detection
3. Collision animation: grid cell flashes red, trajectory fades out
4. Final result: right panel is less crowded than left
5. TimeSlider controls work correctly
6. Animation pauses/resumes on visibility change
