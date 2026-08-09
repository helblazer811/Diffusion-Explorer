<script lang="ts">
	// Stochasticity-lets-you-escape-spurious-modes figure.
	//
	// 3-Gaussian mixture rendered as blue CONTOURS on a DPR-scaled canvas
	// (matching the SmileyDiffusionFlow crispness pattern — internal buffer
	// is W*dpr × H*dpr for a doubled pixel resolution on high-DPI screens).
	// One wide/deep central basin + two narrower spurious basins.
	//
	// Orange trajectory (pre-designed anchor path + OU-filtered noise)
	// visits both spurious basins, escapes via noise, and settles in the
	// global basin. Same tempus Player loop as the smiley figure.
	import { onMount } from 'svelte';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import type { Vec2 } from './trajectories';

	// --- Canvas geometry ------------------------------------------------

	const W = 700;
	const H = 460;

	// --- Density: 3-component Gaussian mixture in world frame (~[-1,1]^2)

	interface Basin {
		mx: number;
		my: number;
		sx: number;
		sy: number;
		w: number;
		kind: 'global' | 'spurious';
	}
	const BASINS: Basin[] = [
		// Global basin: still the widest and deepest, but not by much.
		{ mx: 0, my: 0.35, sx: 0.2, sy: 0.2, w: 1.6, kind: 'global' },
		// Three spurious basins: left, right, and directly below the global.
		{ mx: -0.75, my: -0.35, sx: 0.14, sy: 0.14, w: 0.6, kind: 'spurious' },
		{ mx: 0.75, my: -0.35, sx: 0.15, sy: 0.15, w: 0.6, kind: 'spurious' },
		{ mx: 0, my: -0.6, sx: 0.14, sy: 0.14, w: 0.6, kind: 'spurious' }
	];

	function density(x: number, y: number): number {
		let d = 0;
		for (const b of BASINS) {
			const dx = (x - b.mx) / b.sx;
			const dy = (y - b.my) / b.sy;
			d += b.w * Math.exp(-0.5 * (dx * dx + dy * dy));
		}
		return d;
	}

	// World-to-pixel mapping.
	const WORLD_SCALE = 210;
	function worldToPx(p: Vec2): Vec2 {
		return { x: W / 2 + p.x * WORLD_SCALE, y: H / 2 - p.y * WORLD_SCALE };
	}
	function pxToWorld(px: number, py: number): Vec2 {
		return { x: (px - W / 2) / WORLD_SCALE, y: -(py - H / 2) / WORLD_SCALE };
	}

	// --- Trajectory design ----------------------------------------------

	interface Anchor {
		p: Vec2;
		dwell: number;
	}
	const ANCHORS: Anchor[] = [
		{ p: { x: -1.0, y: -0.05 }, dwell: 0.5 }, // start upper-left
		{ p: { x: -0.75, y: -0.35 }, dwell: 1.5 }, // left spurious
		{ p: { x: 0.75, y: -0.35 }, dwell: 1.5 }, // right spurious (direct hop)
		{ p: { x: 0, y: -0.6 }, dwell: 1.5 }, // bottom spurious
		{ p: { x: 0, y: 0.35 }, dwell: 3.0 } // converge in global basin
	];
	const T_TOTAL = ANCHORS.reduce((s, a) => s + a.dwell, 0);

	function anchorAt(u: number): Vec2 {
		const target = u * T_TOTAL;
		let acc = 0;
		for (let i = 0; i < ANCHORS.length - 1; i++) {
			const seg = ANCHORS[i].dwell;
			if (target <= acc + seg) {
				const s = (target - acc) / seg;
				const e = s * s * (3 - 2 * s);
				return {
					x: ANCHORS[i].p.x + (ANCHORS[i + 1].p.x - ANCHORS[i].p.x) * e,
					y: ANCHORS[i].p.y + (ANCHORS[i + 1].p.y - ANCHORS[i].p.y) * e
				};
			}
			acc += seg;
		}
		return ANCHORS[ANCHORS.length - 1].p;
	}

	function lcg(seed: number): () => number {
		let s = seed >>> 0;
		return () => {
			s = (s * 1103515245 + 12345) >>> 0;
			return (s & 0x7fffffff) / 0x7fffffff - 0.5;
		};
	}

	const N_SAMPLES = 400;
	const trajectory: Vec2[] = (() => {
		const rx = lcg(123);
		const ry = lcg(9973);
		const out: Vec2[] = [];
		let nx = 0;
		let ny = 0;
		const NOISE_SIGMA = 0.28;
		const NOISE_ALPHA = 0.16;
		for (let i = 0; i < N_SAMPLES; i++) {
			const u = i / (N_SAMPLES - 1);
			const a = anchorAt(u);
			const taper = 1 - Math.pow(u, 2.4);
			nx = (1 - NOISE_ALPHA) * nx + NOISE_ALPHA * rx() * NOISE_SIGMA;
			ny = (1 - NOISE_ALPHA) * ny + NOISE_ALPHA * ry() * NOISE_SIGMA;
			out.push({ x: a.x + nx * taper, y: a.y + ny * taper });
		}
		return out;
	})();

	// --- Style ----------------------------------------------------------
	const BASIN_HUE = { r: 46, g: 100, b: 168 }; // deep blue
	const PATH_COLOR = '#f17720';
	const PATH_WIDTH = 2.5;
	const PATH_OPACITY = 0.9;
	const HEAD_R = 5.5;
	const STAR_COLOR = '#1c9c4f';
	const STAR_OUTER_R = 12;
	const STAR_INNER_R = 5;
	const X_COLOR = '#d0342c';
	const X_R = 9;

	// --- Canvas plumbing ------------------------------------------------

	let canvasEl: HTMLCanvasElement | null = $state(null);
	let ctx: CanvasRenderingContext2D | null = null;
	let bgCanvas: HTMLCanvasElement | null = null;
	let dpr = 1;

	// --- Contour background: bake once on an offscreen DPR-scaled canvas.
	// High-res because we render at W*dpr × H*dpr and the density is
	// evaluated on that same pixel grid — every pixel is a real sample,
	// not an interpolation from a coarse grid. That's the resolution win.
	function bakeContours() {
		if (typeof document === 'undefined') return;

		// Internal buffer: DPR-scaled. This is what makes it crisp.
		const bufW = W * dpr;
		const bufH = H * dpr;
		const c = document.createElement('canvas');
		c.width = bufW;
		c.height = bufH;
		const g = c.getContext('2d');
		if (!g) return;

		// 1) Evaluate density on the full high-res pixel grid.
		const flat = new Float32Array(bufW * bufH);
		let maxD = 0;
		for (let j = 0; j < bufH; j++) {
			// Map the internal-buffer y coord back to the logical W×H frame,
			// then to world coords, so the density plot doesn't stretch under DPR.
			const py = (j / (bufH - 1)) * H;
			for (let i = 0; i < bufW; i++) {
				const px = (i / (bufW - 1)) * W;
				const wp = pxToWorld(px, py);
				const d = density(wp.x, wp.y);
				flat[j * bufW + i] = d;
				if (d > maxD) maxD = d;
			}
		}

		// 2) Paint filled bands: each pixel colored by which density band it
		//    falls into. Multiple thresholds give the "stepped" contour-fill
		//    look. Since every pixel gets its own decision the edges are
		//    naturally 1-buffer-pixel thin — no interpolation artifacts.
		const LEVELS = [0.05, 0.12, 0.22, 0.36, 0.55, 0.78];
		const img = g.createImageData(bufW, bufH);
		for (let k = 0; k < bufW * bufH; k++) {
			const t = flat[k] / maxD;
			// Count how many thresholds this pixel is above.
			let bandIdx = 0;
			for (let li = 0; li < LEVELS.length; li++) {
				if (t >= LEVELS[li]) bandIdx = li + 1;
				else break;
			}
			// Alpha grows with bandIdx; white bg peeks through when bandIdx = 0.
			const alpha = bandIdx === 0 ? 0 : 0.09 + (bandIdx - 1) * 0.09;
			img.data[4 * k + 0] = BASIN_HUE.r;
			img.data[4 * k + 1] = BASIN_HUE.g;
			img.data[4 * k + 2] = BASIN_HUE.b;
			img.data[4 * k + 3] = Math.round(alpha * 255);
		}
		// Background first (white), then the bands.
		g.fillStyle = '#ffffff';
		g.fillRect(0, 0, bufW, bufH);
		// putImageData ignores alpha compositing — draw via a temp canvas.
		const layer = document.createElement('canvas');
		layer.width = bufW;
		layer.height = bufH;
		const lg = layer.getContext('2d');
		if (lg) {
			lg.putImageData(img, 0, 0);
			g.drawImage(layer, 0, 0);
		}

		// 3) Contour lines: draw a crisp 1-buffer-pixel stroke at each
		//    threshold boundary. Compute in high-res so the lines are thin
		//    and don't look chunky on high-DPI displays.
		g.strokeStyle = `rgb(${BASIN_HUE.r}, ${BASIN_HUE.g}, ${BASIN_HUE.b})`;
		g.lineWidth = 1;
		g.globalAlpha = 0.55;
		for (const level of LEVELS) {
			const t = level * maxD;
			g.beginPath();
			for (let j = 0; j < bufH - 1; j++) {
				for (let i = 0; i < bufW - 1; i++) {
					const a = flat[j * bufW + i];
					const b = flat[j * bufW + i + 1];
					const cD = flat[(j + 1) * bufW + i];
					if ((a - t) * (b - t) < 0 || (a - t) * (cD - t) < 0) {
						g.rect(i + 0.5, j + 0.5, 1, 1);
					}
				}
			}
			g.fill();
		}
		g.globalAlpha = 1;

		bgCanvas = c;
	}

	function drawX(cx: number, cy: number, r: number) {
		if (!ctx) return;
		ctx.lineCap = 'round';
		// White halo for legibility over any contour tint.
		ctx.strokeStyle = 'rgba(255,255,255,0.9)';
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(cx - r, cy - r);
		ctx.lineTo(cx + r, cy + r);
		ctx.moveTo(cx + r, cy - r);
		ctx.lineTo(cx - r, cy + r);
		ctx.stroke();
		// Red foreground.
		ctx.strokeStyle = X_COLOR;
		ctx.lineWidth = 3.5;
		ctx.beginPath();
		ctx.moveTo(cx - r, cy - r);
		ctx.lineTo(cx + r, cy + r);
		ctx.moveTo(cx + r, cy - r);
		ctx.lineTo(cx - r, cy + r);
		ctx.stroke();
	}

	function drawStar(cx: number, cy: number, outerR: number, innerR: number) {
		if (!ctx) return;
		const N = 5;
		ctx.beginPath();
		for (let i = 0; i < 2 * N; i++) {
			const r = i % 2 === 0 ? outerR : innerR;
			// Start with a point straight up (angle -π/2).
			const theta = -Math.PI / 2 + (i * Math.PI) / N;
			const px = cx + r * Math.cos(theta);
			const py = cy + r * Math.sin(theta);
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		}
		ctx.closePath();
		ctx.fillStyle = STAR_COLOR;
		ctx.fill();
		ctx.strokeStyle = 'rgba(255,255,255,0.9)';
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}

	function drawTrajectory(progress: number) {
		if (!ctx) return;
		const n = trajectory.length;
		const upto = Math.max(1, Math.floor(progress * (n - 1)) + 1);

		ctx.beginPath();
		for (let i = 0; i < upto; i++) {
			const px = worldToPx(trajectory[i]);
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

		const f = progress * (n - 1);
		const i = Math.min(n - 1, Math.floor(f));
		const j = Math.min(n - 1, i + 1);
		const a = f - i;
		const wp = {
			x: trajectory[i].x + (trajectory[j].x - trajectory[i].x) * a,
			y: trajectory[i].y + (trajectory[j].y - trajectory[i].y) * a
		};
		const pt = worldToPx(wp);
		ctx.beginPath();
		ctx.arc(pt.x, pt.y, HEAD_R, 0, Math.PI * 2);
		ctx.fillStyle = PATH_COLOR;
		ctx.fill();
		ctx.strokeStyle = 'rgba(255,255,255,0.9)';
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}

	// --- Player ---------------------------------------------------------

	interface State {
		u: number;
	}
	let uProgress = $state(0);
	let player: Player<State> | undefined;

	function buildTimeline() {
		return new TimelineBuilder<State>()
			.setInitialState({ u: 0 })
			.add(
				{
					name: 'walk',
					reduce(t: number) {
						return { u: t };
					}
				},
				{ durationMs: 8000 }
			)
			.add(
				{
					name: 'hold',
					reduce(_t: number) {
						return { u: 1 };
					}
				},
				{ durationMs: 2500 }
			)
			.build();
	}

	function draw() {
		if (!ctx || !canvasEl) return;
		ctx.clearRect(0, 0, W, H);
		if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);
		// Star at the global basin's center marks the "correct answer."
		const starPx = worldToPx({ x: BASINS[0].mx, y: BASINS[0].my });
		drawStar(starPx.x, starPx.y, STAR_OUTER_R, STAR_INNER_R);
		// Red ✗ at every spurious basin.
		for (const b of BASINS) {
			if (b.kind !== 'spurious') continue;
			const p = worldToPx({ x: b.mx, y: b.my });
			drawX(p.x, p.y, X_R);
		}
		drawTrajectory(uProgress);
	}

	onMount(() => {
		if (!canvasEl) return;
		dpr = Math.max(2, window.devicePixelRatio || 1);
		canvasEl.width = W * dpr;
		canvasEl.height = H * dpr;
		ctx = canvasEl.getContext('2d');
		ctx?.scale(dpr, dpr);
		bakeContours();
		draw();

		player = new Player<State>(buildTimeline(), { looping: true, endPause: 0.4 });
		player.onTick((_t, s) => {
			uProgress = s.u;
			draw();
		});
		player.play();

		return () => {
			player?.dispose();
		};
	});
</script>

<div class="figure-wrap">
	<div class="legend" role="list" aria-label="Legend">
		<div class="legend-item" role="listitem">
			<svg viewBox="-10 -10 20 20" width="18" height="18" aria-hidden="true">
				<polygon
					points="0,-9 2.65,-2.78 9,-2.78 3.85,1.05 5.85,7.28 0,3.4 -5.85,7.28 -3.85,1.05 -9,-2.78 -2.65,-2.78"
					fill="#1c9c4f"
					stroke="rgba(255,255,255,0.9)"
					stroke-width="1"
				/>
			</svg>
			<span>Correct answer</span>
		</div>
		<div class="legend-item" role="listitem">
			<svg viewBox="-10 -10 20 20" width="18" height="18" aria-hidden="true">
				<g stroke-linecap="round">
					<line x1="-7" y1="-7" x2="7" y2="7" stroke="#d0342c" stroke-width="3.5" />
					<line x1="7" y1="-7" x2="-7" y2="7" stroke="#d0342c" stroke-width="3.5" />
				</g>
			</svg>
			<span>Incorrect answer</span>
		</div>
		<div class="legend-item" role="listitem">
			<svg viewBox="-10 -10 20 20" width="18" height="18" aria-hidden="true">
				<circle cx="0" cy="0" r="5" fill="#f17720" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" />
			</svg>
			<span>Sample trajectory</span>
		</div>
	</div>

	<div class="stage" style="max-width: {W}px; aspect-ratio: {W} / {H};">
		<canvas
			bind:this={canvasEl}
			aria-label="Stochastic random walk escaping spurious basins to converge to the global basin."
		></canvas>
	</div>
</div>

<style>
	.figure-wrap {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 1.5rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 0.95rem;
		color: #222;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.stage {
		display: block;
		width: 100%;
		margin: 0 auto;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		background: #ffffff;
	}
</style>
