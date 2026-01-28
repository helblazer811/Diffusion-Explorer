---
name: format-figure
description: Reformats a figure component file to conform to the standard section order and naming conventions defined in the figure guidelines.
---

# Format Figure

Reformats a Svelte figure component to follow the standard design pattern.

## Instructions

When the user invokes this skill, follow these steps:

### 1. Determine the target file

- If a file path is provided as an argument, use that
- If the user has been working on a figure file in this conversation, use that
- Otherwise, ask the user to specify the file path

### 2. Read the guidelines and target file

Read both files:
- Guidelines: `diffusion-explorer/apps/rectified-flow-explainer/src/lib/figures/README.md`
- The target figure file

### 3. Analyze the current structure

Identify the existing code sections within the `<script>` tag. Look for:
- Props (export let statements)
- State (local variables, canvas, ctx, scales, flags)
- Helper functions (pure utility functions)
- Setup functions (runInitialComputation or similar)
- Animation setup (setupTimeline or similar)
- Drawing functions (draw and draw helpers)
- Event handlers (canvas clicks, slider input, visibility changes)
- Lifecycle (onMount, onDestroy)
- Reactive blocks ($: statements)

Note which sections are present, their current order, and whether they have proper section comment separators.

### 4. Identify issues

Report to the user:
- Missing section separators
- Sections in wrong order
- Non-standard function names (e.g., `render` instead of `draw`)
- Missing visibility handling (if the figure has animations)

### 5. Propose reformatted code

Reorganize the `<script>` section into this order:

```
// ----------------------------------------------------------------
// Props
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Setup
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Animations
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Drawing
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Event Handlers
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Lifecycle
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Reactive Blocks
// ----------------------------------------------------------------
```

Rules:
- Preserve all code functionality
- Only include sections that have content (don't add empty sections)
- Use the exact separator format: 64 dashes
- Keep related code together within sections
- Rename non-standard functions if applicable (e.g., `render` -> `draw`)

### 6. Ask for confirmation

Use AskUserQuestion to present the proposed changes and ask for approval:
- Summarize what will change (sections reordered, separators added, etc.)
- Ask if the user wants to proceed

### 7. Apply changes

If approved, use the Edit tool to apply the reformatted code.

### 8. Verify

Run type-check to ensure no errors were introduced:

```bash
cd diffusion-explorer && npm run check
```

Report the result to the user.

## Notes

- The draw function should take animation state as a parameter, not time directly
- For animated figures, ensure visibility handling is present using `useVisibilityHandler`
- The `setupTimeline()` function should configure the timeline and register `onTick`
- Reactive blocks (`$:`) should always be at the end of the script
- There should be no magic numbers in functions. Configurable parameters that change the computation that is done or how the animation is styled should be exposed as props and grouped appropriately. 
