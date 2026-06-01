<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    loadBibliography,
    collectCitations,
    type BibEntry,
    type CitationInfo,
  } from "@diffusion-explorer/ui";
  import { Bibliography, ArticleHeader, Katex } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import HamiltonianMonteCarlo from "$lib/figures/HamiltonianMonteCarlo.svelte";
  import LonelyPoint from "$lib/figures/LonelyPoint.svelte";
  import GaussianTransition from "$lib/figures/GaussianTransition.svelte";
  import GaussianRandomWalk from "$lib/figures/GaussianRandomWalk.svelte";
  import GreedyAcceptance from "$lib/figures/GreedyAcceptance.svelte";
  import { base } from "$app/paths";

  const figureWidth = settings.stylingSettings.global.figureWidth;

  let bibEntries: Map<string, BibEntry> | null = null;
  let citations: CitationInfo[] = [];

  onMount(async () => {
    try {
      bibEntries = await loadBibliography(`${base}/bibliography.bib`);
      if (!bibEntries) {
        console.error("Failed to load bibliography from bibliography.bib");
      }
    } catch (error) {
      console.error("Error loading bibliography:", error);
    }

    await tick();
    citations = collectCitations();
  });
</script>

<ArticleHeader
  title="A Visual Introduction to Hamiltonian Monte Carlo"
  author="Alec Helbling"
  authorLink="https://alechelbling.com"
  date="May 31, 2026"
/>

<h1 id="mcmc" class="section-heading">Markov Chain Monte Carlo</h1>
<p>
  But how can we go from arbitrary points to samples from a complex probability
  density <Katex math="\pi(x)" />? Our journey starts with a lonely point.
</p>

<LonelyPoint />

<p>
  We have a point that lives in the same space as our density
  <Katex math="\pi(x)" />, but what can we do to this point that allows us to
  draw samples from our density? What transformation can we apply? One naive
  idea is to simply move around randomly:
</p>

<p>
  <Katex
    displayMode={true}
    math={`x_{t+1} = x_t + \\epsilon, \\qquad \\epsilon \\sim \\mathcal{N}(0, \\sigma^2 I).`}
  />
</p>

<GaussianTransition canvasWidth={figureWidth} />

<p>
  Chaining these proposals together yields a <em>Gaussian random walk</em>.
  The point wanders the state space, but the proposal is blind: it ignores the
  target density entirely. Left unchecked, it speckles its surroundings
  uniformly rather than concentrating in regions of high probability.
</p>

<GaussianRandomWalk canvasWidth={figureWidth} />

<p>
  The fix is to introduce an <em>acceptance rule</em>. The simplest possible
  rule is greedy: only accept a proposal if it increases the density.
</p>

<p>
  <Katex
    displayMode={true}
    math={`x_{t+1} = \\begin{cases} x' & \\text{if } \\pi(x') > \\pi(x_t) \\\\ x_t & \\text{otherwise} \\end{cases}`}
  />
</p>

<GreedyAcceptance canvasWidth={figureWidth} />

<p>
  Greedy acceptance climbs uphill but gets trapped: each chain collapses onto
  whichever mode it found first, and the rest of the distribution goes
  unsampled. Metropolis–Hastings repairs this with stochastic acceptance, and
  Hamiltonian Monte Carlo goes further still by using gradients of
  <Katex math="\log \pi(x)" /> to make informed, momentum-driven proposals.
</p>

<HamiltonianMonteCarlo canvasWidth={figureWidth} />

<div class="article-footer">
  <h2 id="references" class="section-heading">References</h2>
  <Bibliography {citations} {bibEntries} />

  <h2 id="cite" class="section-heading">How to Cite</h2>
  <div class="cite-section">
    <p>If you found this explainer helpful, please consider citing it:</p>
    <pre><code
        >@article{"{"}helbling2026hamiltonianmontecarlo,
title = {"{"}A Visual Introduction to Hamiltonian Monte Carlo{"}"},
author = {"{"}Helbling, Alec{"}"},
year = {"{"}2026{"}"},
url = {"{"}https://alechelbling.com/hamiltonian-monte-carlo{"}"}
{"}"}</code
      ></pre>
  </div>

  <h2 id="comments" class="section-heading">Comments</h2>
</div>
