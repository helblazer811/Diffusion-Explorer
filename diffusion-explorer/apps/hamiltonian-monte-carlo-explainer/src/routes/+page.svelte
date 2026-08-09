<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    loadBibliography,
    collectCitations,
    type BibEntry,
    type CitationInfo,
  } from "@diffusion-explorer/ui";
  import { Bibliography, ArticleHeader, Katex, Sidebar } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import HamiltonianMonteCarlo from "$lib/figures/HamiltonianMonteCarlo.svelte";
  import LonelyPoint from "$lib/figures/LonelyPoint.svelte";
  import GaussianTransition from "$lib/figures/GaussianTransition.svelte";
  import GaussianRandomWalk from "$lib/figures/GaussianRandomWalk.svelte";
  import GreedyAcceptance from "$lib/figures/GreedyAcceptance.svelte";
  import StuckChainMultipleChains from "$lib/figures/StuckChainMultipleChains.svelte";
  import MCMCBurnIn from "$lib/figures/MCMCBurnIn.svelte";
  import MetropolisAlgorithm from "$lib/figures/MetropolisAlgorithm.svelte";
  import GaussianRandomWalkAutocorrelation from "$lib/figures/GaussianRandomWalkAutocorrelation.svelte";
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

<h1 id="introduction" class="section-heading">Introduction</h1>

<h1 id="mcmc" class="section-heading">Markov Chain Monte Carlo</h1>
<p>
  But how can we go from arbitrary points to samples from a complex probability
  density <span class="pi-label"><Katex math="\pi(x)" /></span>? Our journey
  starts with a <span class="lonely-label">lonely point</span>.
</p>

<LonelyPoint />

<p>
  We have a point that lives in the same space as our density
  <span class="pi-label"><Katex math="\pi(x)" /></span>, but what can we do to
  this point that allows us to draw samples from our density? What
  transformation can we apply? One naive idea is to simply move around
  randomly:
  <Katex math={`x_{t+1} = x_t + \\epsilon`} />, where
  <Katex math={`\\epsilon \\sim \\mathcal{N}(0, \\sigma^2 I)`} />.
</p>

<GaussianRandomWalk>
  {#snippet caption()}
    A Gaussian random walk: each step perturbs the point by isotropic noise.
    The trajectory wanders the space without regard for the target density.
  {/snippet}
</GaussianRandomWalk>

<p>
  Each step is drawn from a <em>proposal distribution</em> — also called a
  <em>transition probability</em> — which we write as
  <Katex math={`q(x' \\mid x)`} />, the probability of proposing the next
  state <Katex math="x'" /> given the current state <Katex math="x" />. Here
  <Katex math={`q(x' \\mid x) = \\mathcal{N}(x' \\mid x, \\sigma^2 I)`} />,
  and chaining these proposals yields the <em>Gaussian random walk</em>. The
  point wanders the state space, but the proposal is blind: it ignores the
  target density entirely. Left unchecked, it speckles its surroundings
  uniformly rather than concentrating in regions of high probability.
</p>

<GaussianTransition canvasWidth={figureWidth}>
  {#snippet caption()}
    The Gaussian proposal <Katex math={`q(x' \\mid x)`} /> sampled around the
    current state — a local cloud of candidate next points centered on
    <Katex math="x" />.
  {/snippet}
</GaussianTransition>

<p>
  The fix is to introduce an <em>acceptance rule</em>. The simplest possible
  rule is greedy: only accept a proposal if it increases the density —
  <Katex math={`x_{t+1} = x'`} /> if
  <Katex math={`\\pi(x') > \\pi(x_t)`} />, otherwise
  <Katex math={`x_{t+1} = x_t`} />.
</p>

<GreedyAcceptance canvasWidth={figureWidth}>
  {#snippet caption()}
    Greedy acceptance: each chain only moves uphill in
    <Katex math="\pi(x)" /> and quickly collapses onto the nearest mode,
    leaving the rest of the distribution unsampled.
  {/snippet}
</GreedyAcceptance>

<p>
  Greedy acceptance climbs uphill but gets trapped: each chain collapses onto
  whichever mode it found first, and the rest of the distribution goes
  unsampled. Metropolis–Hastings repairs this with stochastic acceptance, and
  Hamiltonian Monte Carlo goes further still by using gradients of
  <Katex math="\log \pi(x)" /> to make informed, momentum-driven proposals.
</p>

<h2 id="metropolis">The Metropolis Algorithm</h2>

<Sidebar>
  <p>
    The original Metropolis algorithm was actually conceived in 1953 at Los
    Alamos National Laboratory during the push to develop the hydrogen bomb.
    It provided a practical way to simulate the behavior of large systems of
    interacting particles.
  </p>
</Sidebar>

<p>
  The <em>Metropolis algorithm</em> fixes the trap by replacing the greedy
  rule with a stochastic one. We still propose a new state
  <Katex math="x'" /> from a symmetric proposal
  <Katex math={`q(x' \\mid x)`} />, but instead of only moving uphill we
  accept with probability
  <Katex
    math={`\\alpha = \\min\\!\\left(1, \\dfrac{\\pi(x')}{\\pi(x_t)}\\right)`}
  />. Uphill moves are always accepted, and downhill moves are accepted in
  proportion to how much density we are giving up. This randomness lets the
  chain escape modes and, in the long run, produce samples distributed
  according to <Katex math="\pi(x)" />.
</p>

<div id="algorithm-1">
  <MetropolisAlgorithm backgroundVisible={true}>
    <div class="caption">
      <span class="figure-number">Algorithm 1:</span>
      The Metropolis algorithm. A symmetric proposal generates candidate states,
      and a stochastic acceptance rule based on the density ratio determines
      whether each candidate is kept.
    </div>
  </MetropolisAlgorithm>
</div>

<h2 id="practical-design-choices">Practical Design Choices</h2>

<StuckChainMultipleChains canvasWidth={figureWidth}>
  {#snippet caption()}
    When you run MCMC with a single chain, it is possible to get stuck near
    particular modes and not have representative samples of the whole
    distribution in an efficient manner. This motivates the need for multiple
    chains which is done in practice.
  {/snippet}
</StuckChainMultipleChains>

<MCMCBurnIn canvasWidth={figureWidth}>
  {#snippet caption()}
    A chain started far from the mode takes a number of steps to drift toward
    the stationary distribution. The early portion of the chain — the
    <em>burn-in</em> — is unrepresentative of the target and is typically
    discarded before computing estimates.
  {/snippet}
</MCMCBurnIn>

<p>
  Even after burn-in, the random walk has a deeper problem: each sample is a
  small perturbation of the previous one, so consecutive draws are far from
  independent. We can quantify this with the <em>autocorrelation function</em>
  <Katex math={`\\rho(k)`} />, which measures the correlation between samples
  separated by <Katex math="k" /> steps. For an i.i.d. sampler,
  <Katex math={`\\rho(k)`} /> would drop to zero immediately for
  <Katex math={`k \\geq 1`} />. For a random-walk chain, it decays slowly —
  meaning hundreds of draws may carry only a handful of bits of fresh
  information about the target.
</p>

<GaussianRandomWalkAutocorrelation canvasWidth={figureWidth}>
  {#snippet caption()}
    Left: a random-walk Metropolis-Hastings chain on a 3-Gaussian mixture
    target. Right: the sample autocorrelation
    <Katex math={`\\rho(k)`} /> computed live from the chain so far. Even as
    samples accumulate, <Katex math={`\\rho(k)`} /> stays high for many lags —
    the chain produces highly correlated samples, motivating the
    momentum-driven proposals of Hamiltonian Monte Carlo.
  {/snippet}
</GaussianRandomWalkAutocorrelation>

<h1 id="hmc" class="section-heading">Hamiltonian Monte Carlo</h1>

<h2 id="probability-to-energy">From Probability to Energy</h2>

<h2 id="hamiltonian-mechanics">Hamiltonian Mechanics</h2>

<h2 id="leapfrog-integration">Leapfrog Integration</h2>

<HamiltonianMonteCarlo canvasWidth={figureWidth}>
  {#snippet caption()}
    Hamiltonian Monte Carlo: momentum-driven leapfrog trajectories follow the
    gradient of <Katex math="\log \pi(x)" /> to make long, informed proposals
    that traverse modes instead of getting stuck.
  {/snippet}
</HamiltonianMonteCarlo>

<h1 id="nuts" class="section-heading">No U-turn Sampler</h1>

<h1 id="references" class="section-heading">References</h1>
<Bibliography {citations} {bibEntries} />

<h1 id="cite" class="section-heading">How to Cite</h1>
<div class="article-footer">
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
</div>

<h1 id="comments" class="section-heading">Comments</h1>

<style>
  .pi-label,
  .pi-label :global(.katex) {
    color: #08519c;
    text-decoration: underline;
    text-decoration-color: #08519c;
    text-underline-offset: 3px;
  }
  .lonely-label {
    color: #f97316;
  }
</style>
