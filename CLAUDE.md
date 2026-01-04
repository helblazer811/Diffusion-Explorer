# Animation Design Pattern

- `draw()` should depend on animation state, not time directly. Time is used to update animation state within clips, and `draw()` renders based on that state.

## Figures

When creating or modifying figure components, reference `diffusion-explorer/apps/rectified-flow-explainer/src/lib/figures/README.md` for the standard section order and naming conventions.