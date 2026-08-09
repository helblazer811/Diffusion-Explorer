<script lang="ts">
	// Test-time scaling: run several sample trajectories in sequence. The
	// first three converge to spurious basins (from three different starting
	// points); the fourth finds the correct basin. Earlier finished
	// trajectories are kept faintly visible so the viewer can see all
	// attempts side by side.
	//
	// Same 4-basin backdrop, star/X markers, and legend as the two sibling
	// figures. Same DPR-scaled contour bake for crispness.
	import { onMount } from 'svelte';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import type { Vec2 } from './trajectories';

	// --- Canvas geometry ------------------------------------------------

	const W = 700;
	const H = 460;

	// --- Density: same 4-basin mixture ---------------------------------

	interface Basin {
		mx: number;
		my: number;
		sx: number;
		sy: number;
		w: number;
		kind: 'global' | 'spurious';
	}
	const BASINS: Basin[] = [
		{ mx: 0, my: 0.35, sx: 0.2, sy: 0.2, w: 1.6, kind: 'global' },
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

	const WORLD_SCALE = 210;
	function worldToPx(p: Vec2): Vec2 {
		return { x: W / 2 + p.x * WORLD_SCALE, y: H / 2 - p.y * WORLD_SCALE };
	}
	function pxToWorld(px: number, py: number): Vec2 {
		return { x: (px - W / 2) / WORLD_SCALE, y: -(py - H / 2) / WORLD_SCALE };
	}

	// --- Trajectory design ----------------------------------------------
	// 4 attempts. Each is a piecewise-linear anchor path + OU-filtered
	// noise, tapered to zero as it approaches its final anchor. The three
	// "wrong" attempts end in different spurious basins; the fourth ends
	// in the global basin.

	interface Anchor {
		p: Vec2;
		dwell: number;
	}
	interface Attempt {
		anchors: Anchor[];
		seed: number;
		outcome: 'correct' | 'spurious';
	}

	// Different start locations + destinations so each trajectory reads
	// distinctly. Middle-y = 0 is between the global basin (0.35) and the
	// lower ring of spurious basins (~-0.4 to -0.6) — starts sit around
	// that height.
	const ATTEMPTS: Attempt[] = [
		{
			anchors: [
				{ p: { x: -1.0, y: 0.15 }, dwell: 0.8 },
				{ p: { x: -0.75, y: -0.35 }, dwell: 4.5 } // → left spurious
			],
			seed: 731,
			outcome: 'spurious'
		},
		{
			anchors: [
				{ p: { x: 1.0, y: 0.15 }, dwell: 0.8 },
				{ p: { x: 0.75, y: -0.35 }, dwell: 4.5 } // → right spurious
			],
			seed: 2011,
			outcome: 'spurious'
		},
		{
			anchors: [
				{ p: { x: -0.1, y: -0.05 }, dwell: 0.8 },
				{ p: { x: 0, y: -0.6 }, dwell: 4.5 } // → bottom spurious
			],
			seed: 4177,
			outcome: 'spurious'
		},
		{
			anchors: [
				{ p: { x: 0.9, y: 0.0 }, dwell: 0.6 },
				{ p: { x: 0.4, y: 0.2 }, dwell: 0.8 },
				{ p: { x: 0, y: 0.35 }, dwell: 4.0 } // → global basin ★
			],
			seed: 8837,
			outcome: 'correct'
		}
	];

	function lcg(seed: number): () => number {
		let s = seed >>> 0;
		return () => {
			s = (s * 1103515245 + 12345) >>> 0;
			return (s & 0x7fffffff) / 0x7fffffff - 0.5;
		};
	}

	const N_SAMPLES_PER = 320;

	function buildTrajectory(attempt: Attempt): Vec2[] {
		const total = attempt.anchors.reduce((s, a) => s + a.dwell, 0);
		function anchorAt(u: number): Vec2 {
			const target = u * total;
			let acc = 0;
			for (let i = 0; i < attempt.anchors.length - 1; i++) {
				const seg = attempt.anchors[i].dwell;
				if (target <= acc + seg) {
					const s = (target - acc) / seg;
					const e = s * s * (3 - 2 * s);
					return {
						x: attempt.anchors[i].p.x + (attempt.anchors[i + 1].p.x - attempt.anchors[i].p.x) * e,
						y: attempt.anchors[i].p.y + (attempt.anchors[i + 1].p.y - attempt.anchors[i].p.y) * e
					};
				}
				acc += seg;
			}
			return attempt.anchors[attempt.anchors.length - 1].p;
		}
		const rx = lcg(attempt.seed);
		const ry = lcg(attempt.seed * 17 + 3);
		const out: Vec2[] = [];
		let nx = 0;
		let ny = 0;
		const NOISE_SIGMA = 0.28;
		const NOISE_ALPHA = 0.16;
		for (let i = 0; i < N_SAMPLES_PER; i++) {
			const u = i / (N_SAMPLES_PER - 1);
			const a = anchorAt(u);
			const taper = 1 - Math.pow(u, 2.4);
			nx = (1 - NOISE_ALPHA) * nx + NOISE_ALPHA * rx() * NOISE_SIGMA;
			ny = (1 - NOISE_ALPHA) * ny + NOISE_ALPHA * ry() * NOISE_SIGMA;
			out.push({ x: a.x + nx * taper, y: a.y + ny * taper });
		}
		return out;
	}

	const TRAJECTORIES: Vec2[][] = ATTEMPTS.map(buildTrajectory);

	// --- Style ----------------------------------------------------------
	const BASIN_HUE = { r: 46, g: 100, b: 168 };
	const PATH_COLOR = '#f17720';
	const PATH_WIDTH = 2.5;
	const PATH_OPACITY_ACTIVE = 0.9;
	const PATH_OPACITY_DONE = 0.32; // faded when this attempt has finished
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

	function bakeContours() {
		if (typeof document === 'undefined') return;
		const bufW = W * dpr;
		const bufH = H * dpr;
		const c = document.createElement('canvas');
		c.width = bufW;
		c.height = bufH;
		const g = c.getContext('2d');
		if (!g) return;

		const flat = new Float32Array(bufW * bufH);
		let maxD = 0;
		for (let j = 0; j < bufH; j++) {
			const py = (j / (bufH - 1)) * H;
			for (let i = 0; i < bufW; i++) {
				const px = (i / (bufW - 1)) * W;
				const wp = pxToWorld(px, py);
				const d = density(wp.x, wp.y);
				flat[j * bufW + i] = d;
				if (d > maxD) maxD = d;
			}
		}

		const LEVELS = [0.05, 0.12, 0.22, 0.36, 0.55, 0.78];
		const img = g.createImageData(bufW, bufH);
		for (let k = 0; k < bufW * bufH; k++) {
			const t = flat[k] / maxD;
			let bandIdx = 0;
			for (let li = 0; li < LEVELS.length; li++) {
				if (t >= LEVELS[li]) bandIdx = li + 1;
				else break;
			}
			const alpha = bandIdx === 0 ? 0 : 0.09 + (bandIdx - 1) * 0.09;
			img.data[4 * k + 0] = BASIN_HUE.r;
			img.data[4 * k + 1] = BASIN_HUE.g;
			img.data[4 * k + 2] = BASIN_HUE.b;
			img.data[4 * k + 3] = Math.round(alpha * 255);
		}
		g.fillStyle = '#ffffff';
		g.fillRect(0, 0, bufW, bufH);
		const layer = document.createElement('canvas');
		layer.width = bufW;
		layer.height = bufH;
		const lg = layer.getContext('2d');
		if (lg) {
			lg.putImageData(img, 0, 0);
			g.drawImage(layer, 0, 0);
		}

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

	function drawStar(cx: number, cy: number, outerR: number, innerR: number) {
		if (!ctx) return;
		const N = 5;
		ctx.beginPath();
		for (let i = 0; i < 2 * N; i++) {
			const r = i % 2 === 0 ? outerR : innerR;
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

	function drawX(cx: number, cy: number, r: number) {
		if (!ctx) return;
		ctx.lineCap = 'round';
		ctx.strokeStyle = 'rgba(255,255,255,0.9)';
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(cx - r, cy - r);
		ctx.lineTo(cx + r, cy + r);
		ctx.moveTo(cx + r, cy - r);
		ctx.lineTo(cx - r, cy + r);
		ctx.stroke();
		ctx.strokeStyle = X_COLOR;
		ctx.lineWidth = 3.5;
		ctx.beginPath();
		ctx.moveTo(cx - r, cy - r);
		ctx.lineTo(cx + r, cy + r);
		ctx.moveTo(cx + r, cy - r);
		ctx.lineTo(cx - r, cy + r);
		ctx.stroke();
	}

	function drawTrajectory(pts: Vec2[], upto: number, opacity: number, drawHead: boolean) {
		if (!ctx) return;
		if (upto < 2) return;

		ctx.beginPath();
		for (let i = 0; i < upto; i++) {
			const px = worldToPx(pts[i]);
			if (i === 0) ctx.moveTo(px.x, px.y);
			else ctx.lineTo(px.x, px.y);
		}
		ctx.strokeStyle = PATH_COLOR;
		ctx.globalAlpha = opacity;
		ctx.lineWidth = PATH_WIDTH;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.stroke();
		ctx.globalAlpha = 1;

		if (drawHead && upto >= 1) {
			const pt = worldToPx(pts[Math.min(pts.length - 1, upto - 1)]);
			ctx.beginPath();
			ctx.arc(pt.x, pt.y, HEAD_R, 0, Math.PI * 2);
			ctx.fillStyle = PATH_COLOR;
			ctx.fill();
			ctx.strokeStyle = 'rgba(255,255,255,0.9)';
			ctx.lineWidth = 1.5;
			ctx.stroke();
		}
	}

	// --- Player ---------------------------------------------------------
	// `u ∈ [0, 1]` walks through all four attempts in sequence.

	interface State {
		u: number;
	}
	let uProgress = $state(0);
	let player: Player<State> | undefined;

	// Per-attempt walk duration + a small gap between attempts.
	const N_ATTEMPTS = ATTEMPTS.length;
	const WALK_MS = 3200; // each attempt's walk time
	const GAP_MS = 400; // pause between attempts

	function buildTimeline() {
		const b = new TimelineBuilder<State>().setInitialState({ u: 0 });
		// Split u ∈ [0, 1] into N equal segments — one per attempt.
		// tempus timelines take absolute clip durations; the reducer here maps
		// the CURRENT clip's local t back to a slice of u.
		for (let i = 0; i < N_ATTEMPTS; i++) {
			const uStart = i / N_ATTEMPTS;
			const uEnd = (i + 1) / N_ATTEMPTS;
			b.add(
				{
					name: `walk-${i}`,
					reduce(t: number) {
						return { u: uStart + (uEnd - uStart) * t };
					}
				},
				{ durationMs: WALK_MS }
			);
			if (i < N_ATTEMPTS - 1) {
				b.add(
					{
						name: `gap-${i}`,
						reduce(_t: number) {
							return { u: uEnd };
						}
					},
					{ durationMs: GAP_MS }
				);
			}
		}
		// Final hold after the last attempt lands in the correct basin.
		b.add(
			{
				name: 'final-hold',
				reduce(_t: number) {
					return { u: 1 };
				}
			},
			{ durationMs: 2500 }
		);
		return b.build();
	}

	function draw() {
		if (!ctx || !canvasEl) return;
		ctx.clearRect(0, 0, W, H);
		if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);

		// Marker layer.
		const starPx = worldToPx({ x: BASINS[0].mx, y: BASINS[0].my });
		drawStar(starPx.x, starPx.y, STAR_OUTER_R, STAR_INNER_R);
		for (const b of BASINS) {
			if (b.kind !== 'spurious') continue;
			const p = worldToPx({ x: b.mx, y: b.my });
			drawX(p.x, p.y, X_R);
		}

		// Which attempt is currently active? Map uProgress ∈ [0, 1] onto
		// [0, N_ATTEMPTS] and take the floor.
		const scaled = uProgress * N_ATTEMPTS;
		const activeIdx = Math.min(N_ATTEMPTS - 1, Math.floor(scaled));
		const localT = scaled - activeIdx; // 0..1 within the active attempt

		// Finished attempts: draw fully, faded.
		for (let i = 0; i < activeIdx; i++) {
			drawTrajectory(TRAJECTORIES[i], TRAJECTORIES[i].length, PATH_OPACITY_DONE, false);
		}

		// Active attempt: draw up to localT with the moving head.
		const active = TRAJECTORIES[activeIdx];
		const upto = Math.max(2, Math.floor(localT * (active.length - 1)) + 1);
		drawTrajectory(active, upto, PATH_OPACITY_ACTIVE, true);
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
			aria-label="Test-time scaling: four sample trajectories in sequence; only the fourth reaches the correct basin."
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
