# masked-diffusion

A Visual Introduction to Masked Diffusion Language Models — an interactive
blog explaining the MDLM formulation (Sahoo et al. 2024), how it compares
to autoregressive generation, and what the reverse-step model actually
predicts.

## Development

```bash
npm install                     # from monorepo root
cd apps/masked-diffusion
npm run dev
```

Then open `http://localhost:5173/`.

## Building

```bash
npm run build
npm run preview                 # serves the built site locally
```

The production build lands under the `/masked-diffusion` base path
(configured in `svelte.config.js`), matching sibling apps in the monorepo.

## Structure

See `PLAN.md` for a full layout of routes and figure components.
