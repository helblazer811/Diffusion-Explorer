<script lang="ts">
	import PullTowardMean from './PullTowardMean.svelte';
</script>

<svelte:head>
	<title>The pull toward the mean — Diffusion Explorer</title>
	<meta
		name="description"
		content="Why regression objectives initially predict the mean when little information about the data is available."
	/>
</svelte:head>

<main>
	<PullTowardMean />
	<article>
		<p class="lead">When little information is available, regression predicts the mean.</p>
		<p>
			A diffusion model is commonly trained with a squared-error regression objective. Given a noisy
			point <span class="math">x<sub>t</sub></span> and its noise level <span class="math">t</span>, the
			network predicts either the original data point, the added noise, or an equivalent quantity.
			Under squared error, the best possible prediction is a conditional expectation:
		</p>
		<p class="equation">f*(x<sub>t</sub>, t) = 𝔼[target ∣ x<sub>t</sub>, t].</p>
		<p>
			At very high noise, <span class="math">x<sub>t</sub></span> reveals almost nothing about which part
			of the dataset produced it. The conditional distribution therefore includes many plausible clean
			points. Averaging those possibilities places the prediction near the global data mean—even when
			there is no probability mass at the mean, as in the empty space between these two moons.
		</p>
		<p>
			As noise falls, the observation contains more information. The conditional distribution narrows,
			and the prediction can resolve a particular mode instead of averaging incompatible possibilities.
			This visualization uses flow matching, but the same regression-to-a-conditional-expectation mechanism
			produces its early inward velocity: before the model can distinguish a destination, its average target
			is the data mean.
		</p>
	</article>
</main>

<style>
	:global(html),
	:global(body) {
		width: 100%;
		min-height: 100%;
	}

	main {
		width: 100%;
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		box-sizing: border-box;
		padding: 32px 32px 140px;
	}

	article {
		width: min(820px, calc(100vw - 48px));
		margin-top: 64px;
		color: #273142;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
		font-size: 1.08rem;
		line-height: 1.72;
	}

	article p {
		margin: 0 0 1.3em;
	}

	.lead {
		font-size: 1.55rem;
		font-weight: 600;
		line-height: 1.35;
		letter-spacing: -0.018em;
	}

	.math,
	.equation {
		font-family: Georgia, 'Times New Roman', serif;
	}

	.equation {
		padding: 0.45rem 0 0.55rem;
		font-size: 1.35rem;
		text-align: center;
	}

	@media (max-width: 700px) {
		main { padding: 12px 12px 110px; }
		article { margin-top: 40px; font-size: 1rem; }
		.lead { font-size: 1.35rem; }
	}
</style>
