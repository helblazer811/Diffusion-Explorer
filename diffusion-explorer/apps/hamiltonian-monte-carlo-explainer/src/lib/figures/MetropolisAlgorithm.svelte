<!-- Displays the Metropolis algorithm pseudocode -->

<script>
  import { Algorithm, AlgorithmLine as Line, Katex } from '@diffusion-explorer/ui';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Background visibility
  export let backgroundVisible = true;

  // Font size override (in px)
  export let fontSize = null;
</script>

<Algorithm {backgroundVisible} {caption} {fontSize}>
  {#snippet title()}
    Algorithm: Metropolis
  {/snippet}
  {#snippet inputs()}
    Target density <Katex math={"\\pi(x)"} />, symmetric proposal <Katex math={"q(x' \\mid x) = q(x \\mid x')"} />, initial state <Katex math={"x_0"} />, number of steps <Katex math={"T"} />
  {/snippet}
  {#snippet outputs()}
    Chain of samples <Katex math={"\\{x_0, x_1, \\ldots, x_T\\}"} />
  {/snippet}
  {#snippet steps()}
    <Line><strong>for</strong> <Katex math={"t = 0, 1, \\ldots, T-1"} /> <strong>do</strong></Line>
    <Line indent>Propose <Katex math={"x' \\sim q(x' \\mid x_t)"} /></Line>
    <Line indent>Compute acceptance ratio <Katex math={"\\alpha = \\min\\!\\left(1, \\dfrac{\\pi(x')}{\\pi(x_t)}\\right)"} /></Line>
    <Line indent>Draw <Katex math={"u \\sim \\mathcal{U}(0, 1)"} /></Line>
    <Line indent><strong>if</strong> <Katex math={"u < \\alpha"} /> <strong>then</strong> <Katex math={"x_{t+1} \\leftarrow x'"} /> <strong>else</strong> <Katex math={"x_{t+1} \\leftarrow x_t"} /></Line>
    <Line><strong>end for</strong></Line>
    <Line><strong>return</strong> <Katex math={"\\{x_0, x_1, \\ldots, x_T\\}"} /></Line>
  {/snippet}
</Algorithm>
