<script lang="ts">
  import DoubleFigure from '$lib/components/DoubleFigure.svelte';
  import IndependentCoupling from '$lib/figures/IndependentCoupling.svelte';
  import FlowModelIntro from '$lib/figures/FlowModelIntro.svelte';
  import EulerSamplerFigure from '$lib/figures/EulerSamplerFigure.svelte';
  import { Katex } from '@diffusion-explorer/ui';
</script>
<div class="page-container">
  <div class="title-header-wrapper">
    <h1 class="article-title">A Visual Explanation of Rectified Flows</h1>
    <div class="byline-dateline-container">
      <h3 class="byline">By <a href="alechelbling.com">Alec Helbling</a></h3>
      <h3 class="dateline">December 24, 2025</h3>
    </div>
  </div>
<!-- 

  <h2>Typography</h2>
fl
  <p>This is a paragraph with the default paragraph styles. It has a font size of 1.2rem and line height of 1.6em.</p>

  <p>Here's some <code>inline code</code> with background styling.</p>

  <h2>Inline Math</h2>

  <p>
    This paragraph demonstrates inline math equations. For example, the equation <Katex math="E = mc^2" /> .
  </p>

  <h2>Links</h2>

  <p>
    <a href="#normal">Normal link</a> |
    <a href="#visited" style="color: rgb(0, 80, 160);">Visited link (simulated)</a>
  </p>

  <h2>Form Elements</h2>

  <label>Text Input:</label>
  <input type="text" placeholder="Type something..." />

  <label>Disabled Input:</label>
  <input type="text" disabled value="Disabled input" />

  <label>Range Input:</label>
  <input type="range" min="0" max="100" value="50" />

  <label>Select Dropdown:</label>
  <select>
    <option>Option 1</option>
    <option>Option 2</option>
    <option>Option 3</option>
  </select>

  <label>Textarea:</label>
  <textarea rows="3" placeholder="Enter multiple lines..."></textarea>

  <h2>Buttons</h2>

  <button>Normal Button</button>
  <button>Click and hold to see active state</button>

  <h2>Special Classes</h2>

  <p><span class="figure-number">Figure 1:</span> This demonstrates the figure-number class with bold font weight.</p>

  <div class="acknowledgements">
    <p>This paragraph is inside the acknowledgements div, with smaller font size (1rem) and line height (1.4rem).</p>
  </div> -->
  <p>Introduction content. </p>
  <h2>Brief Background on Flow Matching</h2>
  <FlowModelIntro />
  <p></p>
  <h2>Curvature is the Enemy of Speed </h2>
  <p>Curved sampling trajectories are difficult to accurately simulate in a few steps. </p>

  <EulerSamplerFigure>
    {#snippet caption()}
      <div class="caption">
        <span class="figure-number">Figure 2:</span> Comparison of Euler method approximations for high-curvature (left) and low-curvature (right) functions. Ground truth shown in black, Euler approximation in orange.
      </div>
    {/snippet}
  </EulerSamplerFigure>

  <h2>The Limitations of an Independent Coupling</h2>
  <h3>What is a coupling? </h3>
  <p></p>

  <IndependentCoupling />

  <DoubleFigure>
    {#snippet left()}
      <!-- Left figure content -->
    {/snippet}

    {#snippet right()}
      <!-- Right figure content -->
    {/snippet}

    {#snippet caption()}
      <div class="caption">
        <span class="figure-number">Figure 4:</span> Double figure example.
      </div>
    {/snippet}
  </DoubleFigure>
<!--
  <h2>Material Icons</h2>

  <p>
    <span class="material-icons">favorite</span>
    <span class="material-icons">home</span>
    <span class="material-icons">settings</span>
  </p> -->
</div>