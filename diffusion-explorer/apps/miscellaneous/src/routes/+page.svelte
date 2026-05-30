<script lang="ts">
	import { ArticleHeader } from '@diffusion-explorer/ui';
</script>

<ArticleHeader
	title="Miscellaneous"
	subtitle="A collection of experiments and visualizations"
	author="Alec Helbling"
	authorLink="https://alechelbling.com"
/>

<hr class="section-divider" />

<section id="experiments">
	<h2 class="section-heading">Experiments</h2>
	<ul class="experiment-list">
		<li><a href="/divergence_and_curl">Divergence and Curl</a></li>
		<li><a href="/helmholtz_decomposition">Helmholtz Decomposition</a></li>
		<li><a href="/helmholtz_decomposition_dlic">Helmholtz Decomposition (DLIC)</a></li>
		<li><a href="/helmholtz_decomposition_streaklet">Helmholtz Decomposition (Streaklet)</a></li>
		<li><a href="/diffusion_horizontal">Diffusion Horizontal</a></li>
		<li><a href="/diffusion_vs_ddim">Diffusion vs DDIM</a></li>
		<li><a href="/optimal_transport_coupling">Optimal Transport Coupling</a></li>
		<li><a href="/pull_toward_mean">Pull Toward Mean</a></li>
		<li><a href="/one_dimensional_flow">One-Dimensional Flow</a></li>
		<li><a href="/stokes_theorem">Stokes' Theorem</a></li>
		<li><a href="/stokes_theorem_square">Stokes' Theorem (Square Grid)</a></li>
		<li><a href="/path_independence">Path Independence</a></li>
		<li><a href="/streamline_propagation">Streamline Propagation</a></li>
		<li><a href="/streamline_generation">Streamline Generation</a></li>
		<li><a href="/marching_squares">Marching Squares</a></li>
		<li><a href="/discrete_to_continuous_flow">Discrete to Continuous Flow</a></li>
		<li><a href="/topographic_contours">Topographic Contours</a></li>
		<li><a href="/eulerian_vs_lagrangian">Eulerian vs Lagrangian</a></li>
		<li><a href="/van_der_pol">Van der Pol Limit Cycle</a></li>
		<li><a href="/limit_cycle_stability">Limit Cycle Stability</a></li>
		<li><a href="/lorenz_attractor">Lorenz Attractor</a></li>
		<li><a href="/class_conditioning">Class Conditioning</a></li>
		<li><a href="/svgd">SVGD (Stein Variational Gradient Descent)</a></li>
		<li><a href="/s_curve_springs">Dimensionality Reduction as Solving a Spring System</a></li>
	</ul>
</section>

<style>
	.experiment-list {
		list-style: none;
		padding: 0;
		margin: 1rem 0;
	}

	.experiment-list li {
		margin: 0.75rem 0;
	}

	.experiment-list a {
		color: #3b82f6;
		text-decoration: none;
		font-size: 1.1rem;
	}

	.experiment-list a:hover {
		text-decoration: underline;
	}
</style>
