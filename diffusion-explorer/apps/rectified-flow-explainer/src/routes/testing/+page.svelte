<script>
  import { onMount } from 'svelte';
  import { latexToSvg } from '@diffusion-explorer/ui';

  let svgHtml = '';

  onMount(async () => {
    svgHtml = await latexToSvg('\\psi_t(x)');
  });
</script>

<div style="padding: 2rem;">
  <h1>MathJax SVG Testing</h1>

  <p>Pure SVG element:</p>
  {@html svgHtml}
</div>
