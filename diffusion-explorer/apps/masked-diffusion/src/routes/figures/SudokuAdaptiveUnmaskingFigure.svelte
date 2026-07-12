<script lang="ts">
	// ----------------------------------------------------------------
	// Sudoku Adaptive Unmasking — a two-panel figure motivating the
	// "train for the worst" family of adaptive-unmasking strategies for
	// masked diffusion.
	//
	// Left panel: a 9x9 sudoku grid. Clue cells are always shown; the
	// remaining cells start fully masked ([M] on a blue rectangle) and
	// get unmasked in a data-derived adaptive order — the cells the
	// model becomes confident about earliest are revealed first. As the
	// animation progresses, the reader sees the puzzle fill in the way
	// an adaptive-unmasking decoder would fill it: high-confidence cells
	// commit first, uncertain cells wait.
	//
	// Right panel: solve rate vs. decoding budget for two strategies
	// ("adaptive" and "fixed"). The curves DRAW IN progressively over
	// the same clock — as u advances 0→1, the polylines extend from x=1
	// step out to x=64 steps, so the two panels feel like they're
	// telling one story on one axis of time.
	// ----------------------------------------------------------------

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';

	// ----------------------------------------------------------------
	// Props
	// ----------------------------------------------------------------

	interface Props {
		isActive?: Writable<boolean>;
		maskColor?: string;
		maskTextColor?: string;
		trajectoryUrl?: string;
		width?: number;
	}

	let {
		isActive,
		maskColor = '#cfe0f2',
		maskTextColor = '#33506e',
		trajectoryUrl = '/data/sudoku_uncertainty_correct.json',
		width = 780
	}: Props = $props();

	// ----------------------------------------------------------------
	// State
	// ----------------------------------------------------------------

	const TEXT_COLOR = '#333';
	const LABEL_COLOR = '#666';
	const AXIS_COLOR = '#888';
	const GRID_TICK_COLOR = '#e5e5e5';
	const ADAPTIVE_COLOR = '#f17720';
	// Gray keeps the fixed curve visually distinct from the blue [M]
	// mask token in the sudoku panel — the two aren't the same idea.
	const FIXED_COLOR = '#8a8a8a';
	const CLUE_BG = '#dcdfe3';
	const CLUE_TEXT = '#1a1a1a';
	const FILL_TEXT = '#1a1a1a';

	interface Trajectory {
		clueMask: number[];
		solution: number[];
		steps: { step: number; probs: number[][] }[];
	}

	let trajectory = $state<Trajectory | null>(null);
	// Adaptive reveal order over the 81 cells. For clue cells the order
	// is 0 (already shown at t=0); for non-clue cells, cells that become
	// confident earlier get lower orderIndex values. Positions 0..80.
	let revealOrder = $state<number[]>([]);

	// --- Line-graph data.
	// Anchored to Kim et al. 2025 ("Train for the Worst, Plan for the Best")
	// Table 2, Standard Sudoku, T=50 reverse sampling steps:
	//   MDM vanilla (random / fixed unmasking):    ~ 6.88%
	//   MDM Top-probability margin (adaptive):     ~89.49%
	// Kim et al. only report a single-point measurement at T=50; the
	// shape between step counts is a plausible interpolation with
	// saturating growth to those ceilings.
	const STEPS = [1, 2, 4, 8, 16, 32, 64];
	const ADAPTIVE_SOLVE_RATE = [0.02, 0.08, 0.22, 0.48, 0.72, 0.87, 0.9];
	const FIXED_SOLVE_RATE = [0.005, 0.01, 0.02, 0.03, 0.05, 0.065, 0.07];

	// --- Geometry.
	const W = width;
	const H = 420;
	const LEFT_PANEL_W = 340;
	const RIGHT_PANEL_W = W - LEFT_PANEL_W;

	// Sudoku grid: draw directly in the outer SVG so we can control the
	// mask-cell rendering (a [M]-labeled rounded rectangle) precisely.
	const GRID_SIZE = 300;
	const GRID_X = (LEFT_PANEL_W - GRID_SIZE) / 2;
	const GRID_Y = 60;
	const CELL = GRID_SIZE / 9;

	// Chart geometry (inside the right panel).
	const CHART_PAD_L = 60;
	const CHART_PAD_R = 30;
	const CHART_PAD_T = 60;
	const CHART_PAD_B = 60;
	const CHART_X0 = LEFT_PANEL_W + CHART_PAD_L;
	const CHART_Y0 = CHART_PAD_T;
	const CHART_W = RIGHT_PANEL_W - CHART_PAD_L - CHART_PAD_R;
	const CHART_H = H - CHART_PAD_T - CHART_PAD_B;

	const PANEL_TITLE_Y = 26;

	// Animation scalar: u ∈ [0, 1] drives every derived state below. 0
	// = fully masked / empty chart; 1 = all cells revealed / curves
	// drawn to their full extent.
	let u = $state(0);

	let player = $state<Player<{ u: number }> | undefined>(undefined);

	// ----------------------------------------------------------------
	// Helpers — adaptive order & reveal state.
	// ----------------------------------------------------------------

	/**
	 * Build a reveal order from the trajectory: sort non-clue cells by
	 * the FIRST decoding step at which their max-probability crosses a
	 * threshold. Cells that peak early appear early in the order; cells
	 * that stay uncertain end up last. Ties broken by higher peak.
	 * Clue cells get order 0 (they're visible from t=0 regardless).
	 */
	function buildRevealOrder(traj: Trajectory): number[] {
		const CONF = 0.9;
		const N = 81;
		const numSteps = traj.steps.length;
		const commitStep = new Array<number>(N).fill(numSteps);
		const peakProb = new Array<number>(N).fill(0);
		for (let s = 0; s < numSteps; s++) {
			const probs = traj.steps[s].probs;
			for (let i = 0; i < N; i++) {
				const row = probs[i];
				let m = 0;
				for (let d = 0; d < 9; d++) if (row[d] > m) m = row[d];
				if (m > peakProb[i]) peakProb[i] = m;
				if (commitStep[i] === numSteps && m >= CONF) commitStep[i] = s;
			}
		}
		// Non-clue cell indices, sorted by (commitStep asc, peakProb desc).
		const nonClue: number[] = [];
		for (let i = 0; i < N; i++) if (traj.clueMask[i] !== 1) nonClue.push(i);
		nonClue.sort((a, b) => {
			if (commitStep[a] !== commitStep[b]) return commitStep[a] - commitStep[b];
			return peakProb[b] - peakProb[a];
		});
		// Build a per-cell orderIndex: clue cells = 0, non-clue cells get
		// 1..nonClue.length in the sorted order. This ordering lets us
		// derive "is cell revealed at fraction u" as a simple comparison.
		const order = new Array<number>(N).fill(0);
		nonClue.forEach((cellIdx, k) => {
			order[cellIdx] = k + 1;
		});
		return order;
	}

	// Number of non-clue cells to reveal at the current u. u ∈ [0, 1]
	// maps to 0..totalNonClue reveals.
	const numNonClue = $derived(
		trajectory ? trajectory.clueMask.filter((m) => m !== 1).length : 0
	);
	const revealCount = $derived(Math.floor(u * numNonClue + 1e-6));

	// Per-cell visible predicate — clue always visible; non-clue visible
	// if its orderIndex is within the current reveal count.
	function isRevealed(cellIdx: number): boolean {
		if (!trajectory) return false;
		if (trajectory.clueMask[cellIdx] === 1) return true;
		const o = revealOrder[cellIdx] ?? 999;
		return o > 0 && o <= revealCount;
	}

	// ----------------------------------------------------------------
	// Helpers — chart coordinate mapping.
	// ----------------------------------------------------------------

	const LOG_MIN = Math.log2(STEPS[0]);
	const LOG_MAX = Math.log2(STEPS[STEPS.length - 1]);

	function xForStep(step: number): number {
		const t = (Math.log2(step) - LOG_MIN) / (LOG_MAX - LOG_MIN);
		return CHART_X0 + t * CHART_W;
	}
	function yForRate(rate: number): number {
		const clamped = Math.max(0, Math.min(1, rate));
		return CHART_Y0 + (1 - clamped) * CHART_H;
	}

	/**
	 * Progressively-drawn polyline points: extend from index 0 to a
	 * fractional endpoint driven by u ∈ [0, 1]. When u=0 no points are
	 * emitted; when u=1 all points are emitted; in between, we linearly
	 * interpolate between the last-fully-emitted point and the next.
	 */
	function polylineUpTo(rates: number[], u01: number): string {
		if (u01 <= 0) return '';
		const total = rates.length - 1; // number of segments
		const cursor = Math.min(total, u01 * total);
		const wholeSegs = Math.floor(cursor);
		const frac = cursor - wholeSegs;
		const pts: string[] = [];
		for (let i = 0; i <= wholeSegs; i++) {
			pts.push(`${xForStep(STEPS[i])},${yForRate(rates[i])}`);
		}
		if (wholeSegs < total && frac > 0) {
			const xA = xForStep(STEPS[wholeSegs]);
			const yA = yForRate(rates[wholeSegs]);
			const xB = xForStep(STEPS[wholeSegs + 1]);
			const yB = yForRate(rates[wholeSegs + 1]);
			pts.push(`${xA + (xB - xA) * frac},${yA + (yB - yA) * frac}`);
		}
		return pts.join(' ');
	}

	const adaptivePolyline = $derived(polylineUpTo(ADAPTIVE_SOLVE_RATE, u));
	// Fixed curve is a static baseline — always drawn in full so the
	// reader can see the reference the adaptive curve is beating.
	const fixedPolyline = polylineUpTo(FIXED_SOLVE_RATE, 1);
	const fixedPoints = FIXED_SOLVE_RATE.map((r, i) => ({
		x: xForStep(STEPS[i]),
		y: yForRate(r)
	}));

	// Which adaptive-curve endpoint dots are visible: only those the
	// cursor has reached or passed.
	function pointsUpTo(rates: number[], u01: number): { x: number; y: number }[] {
		if (u01 <= 0) return [];
		const total = rates.length - 1;
		const cursor = Math.min(total, u01 * total);
		const wholeSegs = Math.floor(cursor);
		const out: { x: number; y: number }[] = [];
		for (let i = 0; i <= wholeSegs; i++) {
			out.push({ x: xForStep(STEPS[i]), y: yForRate(rates[i]) });
		}
		return out;
	}
	const adaptivePoints = $derived(pointsUpTo(ADAPTIVE_SOLVE_RATE, u));

	const Y_TICKS = [0, 0.25, 0.5, 0.75, 1.0];
	const X_TICKS = STEPS;

	const LEGEND_X = CHART_X0 + 12;
	const LEGEND_Y = CHART_Y0 + 12;

	// ----------------------------------------------------------------
	// Animations
	// ----------------------------------------------------------------

	const FORWARD_MS = 9000;
	const END_HOLD_MS = 1800;

	function buildTimeline() {
		const forwardClip = {
			name: 'decode',
			reduce(t: number): Partial<{ u: number }> {
				return { u: t };
			}
		};
		const holdClip = {
			name: 'hold-final',
			reduce(_t: number): Partial<{ u: number }> {
				return { u: 1 };
			}
		};
		return new TimelineBuilder<{ u: number }>()
			.setInitialState({ u: 0 })
			.add(forwardClip, { durationMs: FORWARD_MS })
			.add(holdClip, { durationMs: END_HOLD_MS })
			.build();
	}

	// ----------------------------------------------------------------
	// Lifecycle
	// ----------------------------------------------------------------

	onMount(() => {
		let cancelled = false;
		fetch(trajectoryUrl)
			.then((r) => r.json())
			.then((data: Trajectory) => {
				if (cancelled) return;
				trajectory = data;
				revealOrder = buildRevealOrder(data);
			})
			.catch((err) => {
				console.error('SudokuAdaptiveUnmaskingFigure: failed to load trajectory', err);
			});

		player = new Player<{ u: number }>(buildTimeline(), {
			looping: true,
			endPause: 0.2
		});
		player.onTick((_t, s) => {
			u = s.u;
		});

		const unsubActive = isActive?.subscribe((v) => {
			if (!player) return;
			if (v) player.play();
			else {
				player.pause();
				player.reset();
				u = 0;
			}
		});

		return () => {
			cancelled = true;
			unsubActive?.();
			player?.dispose();
		};
	});

	// Precomputed grid indices 0..80.
	const CELLS = Array.from({ length: 81 }, (_, i) => i);
	// Grid line offsets 0..9.
	const LINES = Array.from({ length: 10 }, (_, k) => k);
	const isBox = (k: number) => k % 3 === 0;
</script>

<div class="wrap">
	<svg
		viewBox={`0 0 ${W} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Left: sudoku puzzle unmasking cell-by-cell in adaptive order derived from model confidence. Right: solve rate vs decoding budget for adaptive and fixed unmasking strategies, drawn in progressively."
	>
		<!-- ---------- LEFT PANEL: sudoku grid ---------- -->
		<text
			x={LEFT_PANEL_W / 2}
			y={PANEL_TITLE_Y}
			text-anchor="middle"
			font-size="18"
			font-weight="500"
			fill={TEXT_COLOR}
		>
			Adaptive Unmasking
		</text>
		<text
			x={LEFT_PANEL_W / 2}
			y={PANEL_TITLE_Y + 20}
			text-anchor="middle"
			font-size="14"
			fill={LABEL_COLOR}
		>
			{revealCount} / {numNonClue} cells committed
		</text>

		<!-- Cell backgrounds: clue cells get a light gray tint; unrevealed
		     non-clue cells get the mask-blue tint. -->
		{#each CELLS as i (i)}
			{@const row = Math.floor(i / 9)}
			{@const col = i % 9}
			{@const isClue = trajectory?.clueMask[i] === 1}
			{@const revealed = isRevealed(i)}
			<rect
				x={GRID_X + col * CELL}
				y={GRID_Y + row * CELL}
				width={CELL}
				height={CELL}
				fill={isClue ? CLUE_BG : revealed ? '#ffffff' : maskColor}
			/>
		{/each}

		<!-- Digits and [M] labels. -->
		{#each CELLS as i (i)}
			{@const row = Math.floor(i / 9)}
			{@const col = i % 9}
			{@const cx = GRID_X + col * CELL + CELL / 2}
			{@const cy = GRID_Y + row * CELL + CELL / 2}
			{@const isClue = trajectory?.clueMask[i] === 1}
			{@const revealed = isRevealed(i)}
			{@const digit = trajectory?.solution[i] ?? 0}
			{#if revealed && digit >= 1 && digit <= 9}
				<text
					x={cx}
					y={cy}
					text-anchor="middle"
					dominant-baseline="central"
					font-size={CELL * 0.55}
					fill={isClue ? CLUE_TEXT : FILL_TEXT}
					font-weight={isClue ? 500 : 400}
				>
					{digit}
				</text>
			{:else if !isClue}
				<text
					x={cx}
					y={cy}
					text-anchor="middle"
					dominant-baseline="central"
					font-size={CELL * 0.42}
					fill={maskTextColor}
					font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
					font-weight="500"
				>
					[M]
				</text>
			{/if}
		{/each}

		<!-- Grid lines: thin gray inner lines first, thick dark 3x3 box
		     lines on top. -->
		{#each LINES as k (`h${k}`)}
			<line
				x1={GRID_X}
				x2={GRID_X + GRID_SIZE}
				y1={GRID_Y + k * CELL}
				y2={GRID_Y + k * CELL}
				stroke={isBox(k) ? '#333' : '#c9c9c9'}
				stroke-width={isBox(k) ? 1.6 : 0.6}
			/>
		{/each}
		{#each LINES as k (`v${k}`)}
			<line
				x1={GRID_X + k * CELL}
				x2={GRID_X + k * CELL}
				y1={GRID_Y}
				y2={GRID_Y + GRID_SIZE}
				stroke={isBox(k) ? '#333' : '#c9c9c9'}
				stroke-width={isBox(k) ? 1.6 : 0.6}
			/>
		{/each}

		<!-- ---------- RIGHT PANEL: line chart ---------- -->
		<text
			x={LEFT_PANEL_W + RIGHT_PANEL_W / 2}
			y={PANEL_TITLE_Y}
			text-anchor="middle"
			font-size="18"
			font-weight="500"
			fill={TEXT_COLOR}
		>
			Solve Rate vs. Decoding Budget
		</text>

		<!-- Y-axis horizontal grid ticks. -->
		{#each Y_TICKS as tick (`ygrid-${tick}`)}
			<line
				x1={CHART_X0}
				y1={yForRate(tick)}
				x2={CHART_X0 + CHART_W}
				y2={yForRate(tick)}
				stroke={GRID_TICK_COLOR}
				stroke-width="0.5"
			/>
		{/each}

		<!-- Y-axis line. -->
		<line
			x1={CHART_X0}
			y1={CHART_Y0}
			x2={CHART_X0}
			y2={CHART_Y0 + CHART_H}
			stroke={AXIS_COLOR}
			stroke-width="1"
		/>

		<!-- Y-axis tick labels. -->
		{#each Y_TICKS as tick (`ylabel-${tick}`)}
			<text
				x={CHART_X0 - 8}
				y={yForRate(tick)}
				text-anchor="end"
				dominant-baseline="central"
				font-size="13"
				fill={TEXT_COLOR}
			>
				{Math.round(tick * 100)}%
			</text>
		{/each}

		<!-- Y-axis title. -->
		<text
			x={CHART_X0 - 42}
			y={CHART_Y0 + CHART_H / 2}
			text-anchor="middle"
			font-size="14"
			fill={TEXT_COLOR}
			transform={`rotate(-90, ${CHART_X0 - 42}, ${CHART_Y0 + CHART_H / 2})`}
		>
			Solve Rate
		</text>

		<!-- X-axis line. -->
		<line
			x1={CHART_X0}
			y1={CHART_Y0 + CHART_H}
			x2={CHART_X0 + CHART_W}
			y2={CHART_Y0 + CHART_H}
			stroke={AXIS_COLOR}
			stroke-width="1"
		/>

		<!-- X-axis ticks + labels (log-spaced). -->
		{#each X_TICKS as step (`xtick-${step}`)}
			<line
				x1={xForStep(step)}
				y1={CHART_Y0 + CHART_H}
				x2={xForStep(step)}
				y2={CHART_Y0 + CHART_H + 4}
				stroke={AXIS_COLOR}
				stroke-width="1"
			/>
			<text
				x={xForStep(step)}
				y={CHART_Y0 + CHART_H + 18}
				text-anchor="middle"
				font-size="13"
				fill={TEXT_COLOR}
			>
				{step}
			</text>
		{/each}

		<!-- X-axis title. -->
		<text
			x={CHART_X0 + CHART_W / 2}
			y={CHART_Y0 + CHART_H + 42}
			text-anchor="middle"
			font-size="14"
			fill={TEXT_COLOR}
		>
			Decoding Steps
		</text>

		<!-- Fixed curve (drawn first so adaptive sits on top). -->
		{#if fixedPolyline.length > 0}
			<polyline
				points={fixedPolyline}
				fill="none"
				stroke={FIXED_COLOR}
				stroke-width="2"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>
		{/if}
		{#each fixedPoints as pt, i (`fixed-pt-${i}`)}
			<circle cx={pt.x} cy={pt.y} r="3.5" fill={FIXED_COLOR} />
		{/each}

		<!-- Adaptive curve. -->
		{#if adaptivePolyline.length > 0}
			<polyline
				points={adaptivePolyline}
				fill="none"
				stroke={ADAPTIVE_COLOR}
				stroke-width="2.5"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>
		{/if}
		{#each adaptivePoints as pt, i (`adaptive-pt-${i}`)}
			<circle cx={pt.x} cy={pt.y} r="4" fill={ADAPTIVE_COLOR} />
		{/each}

		<!-- Legend. -->
		<g>
			<line
				x1={LEGEND_X}
				y1={LEGEND_Y}
				x2={LEGEND_X + 20}
				y2={LEGEND_Y}
				stroke={ADAPTIVE_COLOR}
				stroke-width="2.5"
			/>
			<circle cx={LEGEND_X + 10} cy={LEGEND_Y} r="4" fill={ADAPTIVE_COLOR} />
			<text
				x={LEGEND_X + 26}
				y={LEGEND_Y}
				dominant-baseline="central"
				font-size="12"
				fill={TEXT_COLOR}
			>
				Adaptive
			</text>
			<line
				x1={LEGEND_X}
				y1={LEGEND_Y + 20}
				x2={LEGEND_X + 20}
				y2={LEGEND_Y + 20}
				stroke={FIXED_COLOR}
				stroke-width="2"
			/>
			<circle cx={LEGEND_X + 10} cy={LEGEND_Y + 20} r="3.5" fill={FIXED_COLOR} />
			<text
				x={LEGEND_X + 26}
				y={LEGEND_Y + 20}
				dominant-baseline="central"
				font-size="12"
				fill={TEXT_COLOR}
			>
				Fixed
			</text>
		</g>
	</svg>
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		max-width: 780px;
		margin: 0 auto;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
</style>
