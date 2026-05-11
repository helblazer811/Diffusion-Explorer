# Continuity Equation Explainer — Visualization TODO

Dense list of every visualization needed for the reorganized post.
Ordering matches the new 8-section structure (+ closing).

Legend:
- [x] = exists in `src/lib/figures/`
- [~] = exists but needs revision / extension
- [ ] = not yet built

---

## §1 — Vector fields, flows, and the puzzle

- [x] **CrownJewel**: hero figure, Gaussian → 2-moons with click-to-trace reverse trajectory.
- [x] **ProbabilityPathIntro**: animated probability path `p_0 → p_1 = q` with contours + scatter.
- [ ] **VectorFieldVocabulary** (NEW, small/inline): a stationary `v_t(x)` vector field rendered three ways side-by-side — (a) raw arrows, (b) streamlines, (c) sample trajectories. Anchors visual vocabulary used everywhere downstream.
- [ ] **DensityFromVelocityPuzzle** (NEW): given a fixed `v_t(x)`, show two candidate density evolutions and ask the reader "which one is consistent with the field?" Reveal the correct one. Sets up the question the continuity equation answers.
- [ ] **FlowVsVelocityField** (NEW): a small toggle showing the same dynamics rendered as either ψ_t(x) (warping a grid) or v_t(x) (instantaneous arrows). Hover to swap. Frames the "velocity field generates the flow" point.

## §2 — Why exact likelihoods matter

- [ ] **LikelihoodCapabilityMatrix** (NEW): a clean comparison table/figure — VAE (lower bound), GAN (no likelihood), Diffusion (no exact likelihood, ELBO/NLL bound), Normalizing Flow (exact). Visual checkmarks/X-marks, not just text.
- [ ] **MLEvsSampleQuality** (NEW): a small didactic figure showing two trained models with same FID-style sample quality but different log-likelihoods on a held-out set. Drives home why likelihood matters even when samples look identical.
- [ ] **OODDetectionDemo** (NEW): scatter of in-distribution vs OOD samples colored by `log p(x)` evaluated under a CNF. Shows OOD samples have measurably lower likelihood. Use a 2D toy distribution (e.g., two-moons in-dist, uniform-square OOD).
- [ ] **DensityHeatmap** (NEW, supporting): heatmap of `log p(x)` over R^2 for a trained CNF, contrasted with samples. Reinforces "we have the actual function, not just samples."
- [ ] **LikelihoodTrainingCurve** (NEW, optional): training-time NLL curve, with sample snapshots overlaid at a few iterations, to motivate maximum likelihood as a tractable training signal.

## §3 — Conservation of mass

- [x] **MassConservation**: dual-pane — left: density inside V; right: flux + normals at boundary S. Driving home `d/dt ∫_V ρ = -∮_∂V ρ v · n̂`.
- [ ] **MassConservationIntegralAnnotation** (NEW or §3-extension of MassConservation): overlay live integral values — area inside V, surface flux out — and show numerically that they balance frame-by-frame. Currently the figure is qualitative; we need a quantitative version.
- [ ] **MassPremiseCartoon** (NEW, small): one-panel "no particles created or destroyed" cartoon showing a closed sack/region with arrows in vs arrows out, total = 0. Acts as the intuitive premise before the integral form.
- [ ] **NonConservingCounterexample** (NEW, optional): a "broken flow" where probability mass leaks (e.g., a stochastic perturbation, or a non-invertible map) — contrasts with the conservation case to show what we're ruling out.

## §4 — The continuity equation

- [x] **DivergenceIntro**: three panels — sink, source, incompressible.
- [~] **DivergenceIntro extension**: add a 4th panel with mixed/saddle-style divergence, OR add a hover that displays `∇·F` as a heatmap underneath the arrows. Right now only three discrete cases are shown.
- [x] **DivergenceTheoremSquare** (Square decomposition). Verify it's actually mounted in the post — currently it's imported but not used in the JSX. Either add it back or delete the import.
- [x] **DivergenceTheorem** (full version with SurfaceIntegral / VolumeIntegral). Currently commented out — decide whether to use it or remove.
- [ ] **DivergenceTheoremGridCancellation** (NEW or extend DivergenceTheoremSquare): animate the "interior arrows cancel, only boundary arrows remain" intuition. Subdivide a region into a 4×4 grid, fade interior arrows, leave only outward boundary contributions.
- [ ] **PDEDerivationSlideshow** (NEW): step-by-step animated derivation, one equation per step, with the relevant region or operator highlighted. ~6 steps from `d/dt ∫ ρ = -∮ ρv·n̂` to `∂_t ρ + ∇·(ρv) = 0`. Probably the single most important new figure.
- [ ] **ArbitraryVolumeArgument** (NEW, small): show three concentric/overlapping V regions where the integrand must be zero — visualizes the "true for all V ⇒ integrand = 0" step.

## §5 — From PDE to log-densities (instantaneous change of variables)

- [x] **LikelihoodIntegration**: trajectories with cumulative likelihood integration along path.
- [x] **ReverseSampling**: data → noise reverse trajectories via `-v_t`.
- [ ] **EulerianVsLagrangian** (NEW): side-by-side toggle — Eulerian (fixed grid, ∂ρ/∂t at each cell) vs Lagrangian (following a particle, Dρ/Dt). The conceptual hinge of §5; without this most readers won't follow the rearrangement.
- [ ] **LogDensityAlongTrajectory** (NEW): pick 2-3 trajectories from CrownJewel; plot `log p_t(ψ_t(x_0))` as a curve over t, with a synced animation marker. Makes "the log-likelihood evolves as a 1D ODE along the trajectory" tangible.
- [ ] **DivergenceColoredTrajectories** (NEW or extend ReverseSampling): color the trajectory by local `∇·v_t` value — red where divergence is positive (density spreading), blue where negative (compressing). Shows where likelihood loses/gains mass.
- [ ] **MaterialDerivativeBoxes** (NEW, didactic): a small expandable box showing the ∂_t + v·∇ → D/Dt rewrite, possibly with a tooltip showing each term's geometric meaning.

## §6 — Continuous normalizing flows

- [x] **FlowInvertibility**: cached forward trajectories with highlighted indices.
- [ ] **CNFArchitectureDiagram** (NEW): clean schematic — `(x, t) → MLP(θ) → v_θ(x, t) → ODE solver → ψ_t(x)`. Static SVG-style figure, no animation.
- [ ] **CNFTrainingLoop** (NEW): training-time animation — sample a batch, compute log-likelihood via §5 formula, take a gradient step on θ, repeat. Show the loss curve and a sample-quality snapshot evolving in lockstep.
- [ ] **VelocityFieldEvolution** (NEW): show `v_θ(x, t)` as the model trains — a grid of 4-6 snapshots from initialization to convergence, demonstrating that the network learns a structured transport plan.
- [ ] **SamplingSweepslider** (NEW, interactive): user drags `t` from 0 to 1, sees both the velocity field `v_θ(·, t)` and the resulting density `p_t` update. Forward direction only.

## §7 — Why the flow is well-defined (well-posedness)

- [x] **InvertibilityExplanation**: non-invertible counterexample where `x_a` and `x_b` collide.
- [ ] **LipschitzVsNonLipschitz** (NEW): two side-by-side 1D vector fields — one Lipschitz (uniqueness holds), one non-Lipschitz at a point (e.g., `dx/dt = sqrt(x)`) where multiple trajectories pass through the origin. Shows what Picard–Lindelöf rules out.
- [ ] **PicardLindelofIteration** (NEW, optional): visualize the Picard iteration converging to the true trajectory — successive approximations stacked. Probably skippable for a blog post; decide based on length.
- [x] **Diffeomorphism**: take a uniform grid at `t=0`, push it through a smooth analytic velocity field. The grid deforms but never folds, never tears, never two cells overlap. Orange arrows show each corner's cumulative displacement. Visual proof of "diffeomorphism."
- [ ] **CollidingTrajectoriesForbidden** (NEW or extend InvertibilityExplanation): show two trajectories approaching each other but, under Lipschitz `v_θ`, separating before they meet — contrasts with the existing non-invertible example.
- [ ] **WellPosednessRecap** (NEW, small): a chain-of-implications diagram: `v_θ Lipschitz → P-L → unique trajectories → ψ_t bijective → ψ_t diffeomorphism → valid density at every t`. Compresses §7 into one image readers can come back to.

## §8 — Making it tractable: Hutchinson trace estimator

- [ ] **DivergenceAsTrace** (NEW): show the Jacobian matrix `∂v/∂x` as a `d × d` grid; highlight the diagonal; sum it; label as `∇·v = tr(J)`. Pure didactic — establishes the trace identity.
- [ ] **ExactTraceCost** (NEW): animate computing the trace by `d` separate backprops — one per diagonal entry. Show wall-clock or step counter blowing up with `d`.
- [ ] **HutchinsonOneShot** (NEW): contrast — sample `ε ~ N(0, I)`, do one JVP `ε^T (∂v/∂x) ε`, show the unbiased estimate. Single-pass complexity highlighted.
- [ ] **HutchinsonVarianceConvergence** (NEW): plot Hutchinson estimate vs true trace as `N` (samples) increases — variance shrinks; mean converges. Use a small `d=4` example so the true trace is computable.
- [ ] **ComplexityComparisonBar** (NEW, small): two bars — exact trace `O(d)` vs Hutchinson `O(1)` — at `d ∈ {10, 100, 1000, 10000}`. Closes the loop on "this is what makes CNFs practical at scale."

## §9 — Closing

- [ ] **WhatYouLearnedRecap** (NEW): one-figure recap. Stack the key equations (continuity equation, instantaneous change of variables, Hutchinson) with a 1-line caption per. Probably reuse CrownJewel as the visual anchor with the equations annotated.

---

## Cross-cutting / infrastructure

- [ ] **Style consistency pass**: every new figure should match the existing color tokens (orange contours, blue scatter), use the standard caption conventions in `src/lib/figures/README.md`, and follow the section-order convention.
- [ ] **Figure README update**: add the new figures listed here to `src/lib/figures/README.md` so future revisions stay in line.
- [ ] **Caching strategy**: any figure that requires trained-model output (CNFTrainingLoop, OODDetectionDemo, VelocityFieldEvolution, DensityHeatmap) needs cached JSON in `static/cached_samples/` — plan compute budget before building the Svelte component.
- [ ] **Equation-figure cross-refs**: every equation that has a corresponding figure should link to it (anchor scrolling). Currently the post has no internal cross-references.
- [ ] **Mobile fallbacks**: dual-pane figures (MassConservation, EulerianVsLagrangian, FlowVsVelocityField) need mobile stacked layouts — verify each new component handles `< 600px` width.

---

## Priority cuts (if time-constrained)

The post can ship without the following without losing rigor — they are nice-to-haves:
- PicardLindelofIteration (§7)
- LikelihoodTrainingCurve (§2)
- MaterialDerivativeBoxes (§5)
- MassPremiseCartoon (§3) — text suffices

Cannot cut (load-bearing for the new structure):
- LikelihoodCapabilityMatrix (§2 — the whole motivation hinges on it)
- PDEDerivationSlideshow (§4 — the derivation is dense without animation)
- EulerianVsLagrangian (§5 — the conceptual pivot)
- LipschitzVsNonLipschitz (§7 — without it, the well-posedness argument is hand-wavy; Diffeomorphism is now built)
- HutchinsonOneShot + ComplexityComparisonBar (§8 — the practical climax)
