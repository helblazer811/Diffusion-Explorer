# A Visual Introduction to Masked Diffusion Language Models

## Overview

Single-page interactive blog explaining Masked Diffusion Language Models
(MDLM) — the forward corruption, reverse posterior, training loss, and
several animated comparisons against autoregressive generation. Follows
Sahoo et al. 2024 ("Simple and Effective Masked Diffusion Language
Models," arXiv:2406.07524).

## Design Decisions

- **App-level base path**: `/masked-diffusion` in production, empty in dev.
- **All layout primitives from `@diffusion-explorer/ui`** (`ArticleHeader`,
  `Figure`, `Katex`, `TopNav`, `PageContainer`, `TableOfContents`,
  `TimeSlider`) — no local `src/lib/` scaffolding.
- **Figures live in `src/routes/figures/`**, colocated with the single
  page. Each figure owns its own tempus timeline and gates on
  `isActive` from its wrapping `<Figure>`.
- **Faithful MDLM forward process** (`masked_diffusion_math.ts`):
  independent per-token flip times drawn from a cosine schedule inverse-
  CDF, so multiple tokens can flip in the same instant.
- **Shared mask color** (`--mask-color: #cfe0f2`) across the paragraph
  figures; one darker variant (`#99BCDC`) for the paired continuous-vs-
  discrete figure to match the smiley-face Gaussian.

## Files

```
src/routes/
├── +layout.svelte              # TopNav + TableOfContents + PageContainer
├── +page.svelte                # The article + all figure invocations
└── figures/
    ├── GenerationComparisonFigure.svelte   # crown jewel — AR vs. MDM
    ├── ModelPredictionFigure.svelte        # animated pipeline diagram
    ├── BlockDiffusionFigure.svelte         # block-AR generation
    ├── DecodingTrajectoryFigure.svelte     # side-by-side history view
    ├── ForwardReverseFigure.svelte         # smiley diffusion + paragraph
    ├── SmileyDiffusionFlow.svelte          # dumb canvas renderer
    ├── References.svelte                   # .bib parser + list
    ├── masked_diffusion_math.ts            # schedules, flip times, tokens
    ├── smiley_diffusion.ts                 # DDPM SDE integrator + smiley
    ├── trajectories.ts                     # seeded LCG
    └── bibtex.ts                           # tiny BibTeX parser

static/
├── references.bib              # Sahoo et al. 2024 (MDLM)
└── data/smiley_face.json       # 300-point smiley cloud
```

## Animation Architecture

Every animated figure follows the same pattern:

- One tempus `TimelineBuilder` per figure, built inside `onMount`.
- Timeline runs in phases (e.g. reveal → hold → reverse-reveal → hold).
- `Player` subscribes to `isActive` (from wrapping `<Figure>`) — plays
  on-screen, pauses/resets off-screen.
- No d3, no data-driven scaling; SVG geometry is inlined in the template
  with `@const` bindings and per-tick reactive props.

`ModelPredictionFigure` is the most elaborate: 7 phases (some pinned to
always-visible from the start; some looped), plus a sample-flash
highlight on the chosen bar with orange accent.

## Running

```bash
cd diffusion-explorer/apps/masked-diffusion
npm run dev
# Navigate to http://localhost:5173/
```

## Verification

1. Article header renders title, italic subtitle, author + link, date.
2. Crown-jewel figure (AR vs. Masked Diffusion) auto-cycles.
3. All three Background equations render via `@diffusion-explorer/ui`
   `Katex`.
4. `ModelPredictionFigure` cycles input → transformer → distributions →
   sampled-flash → decoded output, with a ~7 s hold at the end.
5. `ForwardReverseFigure` shows the smiley face loaded from
   `static/data/smiley_face.json` and a bounded Brownian trajectory.
6. References section lists the Sahoo et al. 2024 entry with a working
   arXiv link.
7. `npm run build` prerenders the site under `/masked-diffusion`.
8. `npm run check` passes.
