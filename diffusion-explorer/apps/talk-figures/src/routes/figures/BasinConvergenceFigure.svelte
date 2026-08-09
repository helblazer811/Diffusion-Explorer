<script lang="ts">
	// Static heatmap of a 3-component Gaussian mixture, rendered on a
	// <canvas> because a 300×200 pixel grid via SVG rects is wasteful.
	//
	//   * Wide component (correct answer): larger σ, moderate weight → its
	//     basin covers more of the domain, so refinement dynamics converge
	//     to it from more starting points.
	//   * Two narrower components (spurious): smaller σ, similar peak
	//     height, but their basins are tight.
	//
	// All three basins render in the same viridis-ish palette; a green ✓
	// annotation labels the correct basin and red ✗ annotations label the
	// spurious ones. The point of the figure is: correct answers are
	// stable fixed points with wide basins of attraction; spurious modes
	// exist but are narrow and easier to leave under re-noising.

	import { onMount } from 'svelte';

	interface Component {
		mx: number; // mean x in [0, 1] domain
		my: number; // mean y in [0, 1]
		sx: number; // std x
		sy: number; // std y
		w: number; // mixture weight
		label: 'correct' | 'spurious';
	}

	// Layout: correct basin on the left (wide), two spurious on the right (tight).
	const COMPONENTS: Component[] = [
		{ mx: 0.28, my: 0.55, sx: 0.14, sy: 0.14, w: 1.0, label: 'correct' },
		{ mx: 0.68, my: 0.3, sx: 0.055, sy: 0.055, w: 0.55, label: 'spurious' },
		{ mx: 0.82, my: 0.75, sx: 0.05, sy: 0.05, w: 0.55, label: 'spurious' }
	];

	const WIDTH = 700;
	const HEIGHT = 460;

	let canvasEl: HTMLCanvasElement | null = $state(null);

	function densityAt(x: number, y: number): number {
		// Sum of un-normalized Gaussians × weight.
		let d = 0;
		for (const c of COMPONENTS) {
			const dx = (x - c.mx) / c.sx;
			const dy = (y - c.my) / c.sy;
			d += c.w * Math.exp(-0.5 * (dx * dx + dy * dy));
		}
		return d;
	}

	// Viridis-ish palette sampled at 6 stops. Interpolated linearly between
	// stops. Same palette across all basins — the annotations, not the color,
	// distinguish correct from spurious.
	const STOPS: [number, [number, number, number]][] = [
		[0.0, [253, 253, 250]], // near-white background
		[0.2, [220, 232, 214]],
		[0.4, [167, 207, 195]],
		[0.6, [95, 158, 174]],
		[0.8, [55, 92, 140]],
		[1.0, [42, 45, 92]]
	];

	function palette(t: number): [number, number, number] {
		t = Math.max(0, Math.min(1, t));
		for (let i = 0; i < STOPS.length - 1; i++) {
			const [t0, c0] = STOPS[i];
			const [t1, c1] = STOPS[i + 1];
			if (t <= t1) {
				const a = (t - t0) / (t1 - t0);
				return [
					c0[0] + (c1[0] - c0[0]) * a,
					c0[1] + (c1[1] - c0[1]) * a,
					c0[2] + (c1[2] - c0[2]) * a
				];
			}
		}
		return STOPS[STOPS.length - 1][1];
	}

	function draw() {
		if (!canvasEl) return;
		const dpr = Math.max(2, window.devicePixelRatio || 1);
		canvasEl.width = WIDTH * dpr;
		canvasEl.height = HEIGHT * dpr;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		ctx.scale(dpr, dpr);

		// First pass: compute density on a coarse grid to find max for normalization.
		const NX = WIDTH;
		const NY = HEIGHT;
		let maxD = 0;
		const flat = new Float32Array(NX * NY);
		for (let j = 0; j < NY; j++) {
			const y = j / (NY - 1);
			for (let i = 0; i < NX; i++) {
				const x = i / (NX - 1);
				const d = densityAt(x, y);
				flat[j * NX + i] = d;
				if (d > maxD) maxD = d;
			}
		}

		// Second pass: paint using palette.
		const img = ctx.createImageData(NX, NY);
		for (let k = 0; k < NX * NY; k++) {
			const t = maxD > 0 ? flat[k] / maxD : 0;
			const [r, g, b] = palette(t);
			img.data[4 * k + 0] = r;
			img.data[4 * k + 1] = g;
			img.data[4 * k + 2] = b;
			img.data[4 * k + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);
	}

	onMount(() => {
		draw();
	});
</script>

<div class="figure-wrap">
	<div class="stage" style="width: {WIDTH}px; height: {HEIGHT}px;">
		<canvas bind:this={canvasEl} width={WIDTH} height={HEIGHT}></canvas>

		<!-- Annotations overlaid on top of the canvas at each component's mean. -->
		{#each COMPONENTS as c}
			<div
				class="marker {c.label}"
				style="left: {c.mx * 100}%; top: {c.my * 100}%;"
				aria-label={c.label === 'correct' ? 'correct basin' : 'spurious basin'}
			>
				<div class="mark">
					{#if c.label === 'correct'}
						<!-- Check -->
						<svg viewBox="0 0 24 24" width="42" height="42">
							<path
								d="M4 12 L10 18 L20 6"
								fill="none"
								stroke="#1c9c4f"
								stroke-width="4"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{:else}
						<!-- X -->
						<svg viewBox="0 0 24 24" width="34" height="34">
							<path
								d="M5 5 L19 19 M19 5 L5 19"
								fill="none"
								stroke="#d0342c"
								stroke-width="4"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{/if}
				</div>
				<div class="label">
					{c.label === 'correct' ? 'Correct answer' : 'Spurious basin'}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.figure-wrap {
		width: 100%;
		display: flex;
		justify-content: center;
	}

	.stage {
		position: relative;
		max-width: 100%;
		border-radius: 8px;
		overflow: hidden;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.marker {
		position: absolute;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		pointer-events: none;
	}

	.mark {
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.85);
		border-radius: 50%;
		padding: 6px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
	}

	.marker.correct .mark {
		padding: 10px;
	}

	.label {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 15px;
		font-weight: 600;
		color: #222;
		background: rgba(255, 255, 255, 0.9);
		padding: 3px 10px;
		border-radius: 4px;
		white-space: nowrap;
	}

	.marker.correct .label {
		color: #1c9c4f;
	}

	.marker.spurious .label {
		color: #d0342c;
	}
</style>
