<!-- Displays the Reflow algorithm pseudocode -->

<script>
  import { Algorithm, AlgorithmLine as Line, Katex } from '@diffusion-explorer/ui';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Background visibility
  export let backgroundVisible = true;
</script>

<Algorithm {backgroundVisible} {caption}>
  {#snippet title()}
    Algorithm: Reflow Procedure
  {/snippet}
  {#snippet inputs()}
    Source distribution <Katex math={"p"} />, target distribution <Katex math={"q"} />, number of iterations <Katex math={"K"} />
  {/snippet}
  {#snippet outputs()}
    Rectified velocity field <Katex math={"v_\\theta^K"} />
  {/snippet}
  {#snippet steps()}
    <Line>Sample pairs <Katex math={"(X_0, X_1)"} /> from independent coupling <Katex math={"\\pi_0 = p \\times q"} /></Line>
    <Line><strong>for</strong> <Katex math={"k = 1, 2, \\ldots, K"} /> <strong>do</strong></Line>
    <Line indent>Train velocity field <Katex math={"v_\\theta^k"} /> on pairs from <Katex math={"\\pi_{k-1}"} /></Line>
    <Line indent>Generate new pairs: <Katex math={"X_1^k = \\psi_1^k(X_0)"} /> by flowing <Katex math={"X_0 \\sim p"} /> through <Katex math={"v_\\theta^k"} /></Line>
    <Line indent>Update coupling: <Katex math={"\\pi_k = (X_0, X_1^k)"} /></Line>
    <Line><strong>end for</strong></Line>
    <Line><strong>return</strong> <Katex math={"v_\\theta^K"} /></Line>
  {/snippet}
</Algorithm>
