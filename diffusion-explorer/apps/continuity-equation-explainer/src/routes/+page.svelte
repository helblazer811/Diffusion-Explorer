<script>
  import { ArticleHeader } from "@diffusion-explorer/ui";
  import DivergenceIntro from "$lib/figures/DivergenceIntro.svelte";
  import DivergenceTheorem from "$lib/figures/DivergenceTheorem/DivergenceTheorem.svelte";
  import { Katex } from "@diffusion-explorer/ui";
</script>

<svelte:head>
  <title>The Continuity Equation</title>
  <meta
    name="description"
    content="An interactive explainer on the continuity equation and divergence"
  />
</svelte:head>

<ArticleHeader
  title="The Continuity Equation"
  subtitle="An Interactive Introduction"
  author="Alec Helbling"
  authorLink="https://alechelbling.com"
  date="2025"
/>

<!-- Introduction Section -->
<section id="introduction">
  <h2 class="section-heading">Introduction</h2>
  <p>
    The continuity equation is a fundamental principle in physics that describes
    the conservation of some quantity. This interactive article will guide you
    through the key concepts.
  </p>
</section>

<hr class="section-divider" />

<section id="divergence">
  <h2 class="section-heading">Divergence</h2>
  <DivergenceIntro>
    <strong>Three types of vector field divergence.</strong>
    The divergence of a vector field <Katex math={"\\mathbf{F} = (F_x, F_y)"}/> is defined as
    <Katex math={"\\nabla \\cdot \\mathbf{F} = \\frac{\\partial F_x}{\\partial x} + \\frac{\\partial F_y}{\\partial y}"}/>
    and describes the rate at which "density" expands or contracts at a point.
    <em>Left:</em> A converging field (sink) has negative divergence (<Katex math={"\\nabla \\cdot \\mathbf{F} < 0"}/>).
    <em>Center:</em> A diverging field (source) has positive divergence (<Katex math={"\\nabla \\cdot \\mathbf{F} > 0"}/>).
    <em>Right:</em> An incompressible field has zero divergence (<Katex math={"\\nabla \\cdot \\mathbf{F} = 0"}/>).
  </DivergenceIntro>
</section>

<hr class="section-divider" />

<section id="divergence-theorem">
  <h2 class="section-heading">Divergence Theorem</h2>
  <p>
    The divergence theorem relates the flux of a vector field through a closed surface
    to the divergence integrated over the enclosed volume.
  </p>
  <DivergenceTheorem>
    <strong>The Divergence Theorem.</strong>
    <em>Left:</em> Surface integral showing the flux of the vector field <Katex math="F"/>
    through the boundary. The green arrow shows the outward normal <Katex math="n"/>,
    and the red arrow shows the field vector at each point.
    <em>Right:</em> Volume integral showing the grid subdivision of the interior region.
  </DivergenceTheorem>
</section>

<hr class="section-divider" />

<!-- References Section -->
<section id="references" class="references">
  <h2 class="section-heading">References</h2>
  <ol>
    <li>
      Content coming soon...
    </li>
  </ol>
</section>
