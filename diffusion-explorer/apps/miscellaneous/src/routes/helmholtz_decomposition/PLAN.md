# Helmholtz Decomposition Visualization

## Overview

Visualize the Helmholtz decomposition theorem which states any smooth vector field can be decomposed into:
- **Curl-free (irrotational)** component: $-\nabla \phi$ (gradient of scalar potential)
- **Divergence-free (solenoidal)** component: $\nabla \times \mathbf{A}$ (curl of vector potential)

$$\mathbf{F} = -\nabla \phi + \nabla \times \mathbf{A}$$

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│                  Helmholtz Decomposition                    │  <- Title (spans all)
├─────────────────────────────────────────────────────────────┤
│     F = -∇φ + ∇×A   (or equivalent KaTeX equation)          │  <- KaTeX equation
├─────────────────┬───────┬─────────────────┬───────┬─────────┤
│                 │       │                 │       │         │
│   Curl-free     │   +   │ Divergence-free │   =   │Combined │
│   -∇φ           │       │   ∇×A           │       │   F     │
│                 │       │                 │       │         │
│  (converging)   │       │   (rotating)    │       │ (spiral)│
│                 │       │                 │       │         │
└─────────────────┴───────┴─────────────────┴───────┴─────────┘
```

## Vector Field Construction

Build a **converging spiral** by decomposing into components:

### 1. Curl-free component (no rotation, only convergence)
Pure radial inward flow - converges to origin with zero curl:
```typescript
// Curl-free: radial inward (gradient of -r²/2)
const curlFree = (x: number, y: number): [number, number] => {
  const scale = -0.5;  // Negative for convergence
  return [scale * x, scale * y];
};
```

### 2. Divergence-free component (rotation only, no convergence)
Pure rotation - circulates around origin with zero divergence:
```typescript
// Divergence-free: counterclockwise rotation (curl of z-component potential)
const divFree = (x: number, y: number): [number, number] => {
  const scale = 1.0;
  return [-scale * y, scale * x];  // Perpendicular to radial
};
```

### 3. Combined field (converging spiral)
Sum of both components:
```typescript
const combined = (x: number, y: number): [number, number] => {
  const [cfx, cfy] = curlFree(x, y);
  const [dfx, dfy] = divFree(x, y);
  return [cfx + dfx, cfy + dfy];
};
```

This produces a spiral that converges inward while rotating - exactly what you get from $\mathbf{F} = -\nabla\phi + \nabla\times\mathbf{A}$.

## Implementation Details

### Files to Create

1. `+page.svelte` - Route page wrapper
2. `HelmholtzDecomposition.svelte` - Main figure component

### Component Structure

Follow the standard figure section order from README.md:

```svelte
<script lang="ts">
// ----------------------------------------------------------------
// Props
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------
// Three canvases, three StreamlineAnimation instances

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
// Vector field functions: curlFree, divFree, combined

// ----------------------------------------------------------------
// Setup
// ----------------------------------------------------------------
// Create StreamlineAnimation for each canvas

// ----------------------------------------------------------------
// Animations
// ----------------------------------------------------------------
// Single timeline controlling all three animations in sync

// ----------------------------------------------------------------
// Drawing
// ----------------------------------------------------------------
// draw() calls animation.draw() for each canvas

// ----------------------------------------------------------------
// Event Handlers
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Lifecycle
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Reactive Blocks
// ----------------------------------------------------------------
</script>
```

### Animation

Use `StreamlineAnimation` from `@diffusion-explorer/ui`:

```typescript
import { StreamlineAnimation } from '@diffusion-explorer/ui';

// Create animation for each field
const curlFreeAnim = StreamlineAnimation.create<AnimationState>({
  vectorFieldFn: curlFree,
  domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
  toPixel,
  color: '#ef4444',  // Red
  density: 1.0,
});
```

All three animations share the same timeline phase so pulses move in sync.

### Styling

- Custom CSS grid layout (not DoubleFigure component)
- Three equal-width canvas columns
- `+` and `=` signs as flex items between canvases
- Title spans full width above
- KaTeX equation centered below title

```css
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.canvases-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.operator {
  font-size: 2rem;
  font-weight: bold;
  padding: 0 0.5rem;
}
```

### Labels

Below each canvas:
- Left: "Curl-free $-\nabla\phi$"
- Center: "Divergence-free $\nabla \times \mathbf{A}$"
- Right: "Combined $\mathbf{F}$"

## Verification

1. Run dev server: `npm run dev` from miscellaneous app
2. Navigate to `/helmholtz_decomposition`
3. Verify:
   - Left canvas shows pure radial convergence (straight lines to center)
   - Center canvas shows pure rotation (circular streamlines)
   - Right canvas shows spiral (combination)
   - All three animate with red pulsing streamlines
   - `+` and `=` operators visible between canvases
   - Title and equation render correctly with KaTeX
