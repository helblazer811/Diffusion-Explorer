<script lang="ts">
	// Canvas renderer for the smiley-face DDPM figure.
	//
	// Layout (adapted from the Diffusion-Explorer horizontal diffusion figure):
	//   * Left column, static — the SOURCE distribution (smiley face) in blue.
	//   * Right column, static — the TARGET distribution (Gaussian cloud) in
	//     blue.
	//   * A single orange sample point traces a Brownian-motion path from the
	//     source to the target via the DDPM forward SDE; the trajectory was
	//     precomputed upstream and is passed in as a Vec2[T+1] array.
	//
	// The trajectory point's position at each tick uses its world (x, y) BUT
	// with the x coordinate re-centered on a horizontal column that lerps
	// between the source and target anchor columns as `progress` moves 0 → 1.
	// That way the point visibly walks left → right across the canvas even
	// though the underlying SDE has zero net x-drift on average.

	import { onMount } from 'svelte';
	import type { Vec2 } from './trajectories';

	interface Props {
		trajectory: Vec2[];
		source: Vec2[]; // smiley face — drawn on the left
		target: Vec2[]; // Gaussian cloud — drawn on the right
		progress?: number;
		width?: number;
		height?: number | null;
	}

	let {
		trajectory,
		source,
		target,
		progress = 0,
		width = 800,
		height = 220
	}: Props = $props();

	// Palette: gray smiley on the left, light-blue Gaussian on the right (the
	// blue matches the [MASK] rectangles below so masking and Gaussian noise
	// read as the same "noise" concept).
	const SMILEY_COLOR = '#a8adb5';
	const GAUSSIAN_COLOR = '#4a8fc9';
	const STATIC_R = 3.5;
	const STATIC_OPACITY = 0.55;
	const PATH_COLOR = '#f17720';
	const PATH_WIDTH = 2.5;
	const PATH_OPACITY = 0.85;
	const DOT_R = 5;

	// Horizontal anchor columns (fractions of canvas width).
	const SRC_X_FRAC = 0.15;
	const TGT_X_FRAC = 0.85;

	// Pixel scale for world (x, y) coordinates.
	const WORLD_SCALE = 60;

	const W = $derived(width);
	const H = $derived(height ?? 220);

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let ctx: CanvasRenderingContext2D | null = null;
	let dpr = 1;
	let bgCanvas: HTMLCanvasElement | null = null;

	function meanX(pts: Vec2[]): number {
		let sum = 0;
		for (const p of pts) sum += p.x;
		return pts.length ? sum / pts.length : 0;
	}

	function drawCloud(
		g: CanvasRenderingContext2D,
		pts: Vec2[],
		centerPx: number,
		cx: number,
		color: string
	) {
		g.globalAlpha = STATIC_OPACITY;
		g.fillStyle = color;
		const cy = H / 2;
		for (const p of pts) {
			const px = centerPx + (p.x - cx) * WORLD_SCALE;
			const py = cy + p.y * WORLD_SCALE;
			g.beginPath();
			g.arc(px, py, STATIC_R, 0, Math.PI * 2);
			g.fill();
		}
		g.globalAlpha = 1;
	}

	function bakeBackground() {
		if (typeof document === 'undefined') return;
		const c = document.createElement('canvas');
		c.width = W * dpr;
		c.height = H * dpr;
		const g = c.getContext('2d');
		if (!g) return;
		g.scale(dpr, dpr);

		drawCloud(g, source, SRC_X_FRAC * W, meanX(source), SMILEY_COLOR);
		drawCloud(g, target, TGT_X_FRAC * W, meanX(target), GAUSSIAN_COLOR);
		bgCanvas = c;
	}

	// Map a trajectory point (in world x/y) to canvas pixel space, using the
	// same per-cloud recentering scheme as the static source/target clouds:
	// at t=0 the anchor column is source, at t=1 it's target, and world offsets
	// are measured against a world-space center that lerps between the source
	// and target means. This way the trajectory point sits ON its literal world
	// coordinate over the smiley at t=0 and over the Gaussian at t=1.
	function pathPointToPx(p: Vec2, tOnPath: number): { x: number; y: number } {
		const centerPx = SRC_X_FRAC * W + (TGT_X_FRAC - SRC_X_FRAC) * W * tOnPath;
		const cy = H / 2;
		const srcCx = meanX(source);
		const tgtCx = meanX(target);
		const worldCx = srcCx + (tgtCx - srcCx) * tOnPath;
		return { x: centerPx + (p.x - worldCx) * WORLD_SCALE, y: cy + p.y * WORLD_SCALE };
	}

	function drawTrajectory() {
		if (!ctx || !trajectory.length) return;
		const n = trajectory.length;
		const upto = Math.max(1, Math.floor(progress * (n - 1)) + 1);

		ctx.beginPath();
		for (let i = 0; i < upto; i++) {
			const ti = i / (n - 1);
			const px = pathPointToPx(trajectory[i], ti);
			if (i === 0) ctx.moveTo(px.x, px.y);
			else ctx.lineTo(px.x, px.y);
		}
		ctx.strokeStyle = PATH_COLOR;
		ctx.globalAlpha = PATH_OPACITY;
		ctx.lineWidth = PATH_WIDTH;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.stroke();
		ctx.globalAlpha = 1;

		// Moving head at the interpolated playhead.
		const f = progress * (n - 1);
		const i = Math.min(n - 1, Math.floor(f));
		const j = Math.min(n - 1, i + 1);
		const a = f - i;
		const wp = {
			x: trajectory[i].x + (trajectory[j].x - trajectory[i].x) * a,
			y: trajectory[i].y + (trajectory[j].y - trajectory[i].y) * a
		};
		const pt = pathPointToPx(wp, progress);
		ctx.beginPath();
		ctx.arc(pt.x, pt.y, DOT_R, 0, Math.PI * 2);
		ctx.fillStyle = PATH_COLOR;
		ctx.fill();
	}

	function draw() {
		if (!ctx || !canvasEl) return;
		ctx.clearRect(0, 0, W, H);
		if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);
		drawTrajectory();
	}

	onMount(() => {
		if (!canvasEl) return;
		dpr = Math.max(2, window.devicePixelRatio || 1);
		canvasEl.width = W * dpr;
		canvasEl.height = H * dpr;
		ctx = canvasEl.getContext('2d');
		ctx?.scale(dpr, dpr);
		bakeBackground();
		draw();
	});

	$effect(() => {
		void source;
		void target;
		void W;
		void H;
		if (ctx && canvasEl) {
			canvasEl.width = W * dpr;
			canvasEl.height = H * dpr;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.scale(dpr, dpr);
			bakeBackground();
			draw();
		}
	});
	$effect(() => {
		void progress;
		void trajectory;
		if (ctx) draw();
	});
</script>

<div class="smiley-flow">
	<div class="stage" style="max-width: {W}px; aspect-ratio: {W} / {H};">
		<canvas
			bind:this={canvasEl}
			aria-label="A single sample point tracing a Brownian-motion path from the data distribution (smiley face, left) to a Gaussian (right) under the DDPM forward SDE."
		></canvas>
	</div>
</div>

<style>
	.smiley-flow {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.stage {
		width: 100%;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: 4px;
	}

</style>
