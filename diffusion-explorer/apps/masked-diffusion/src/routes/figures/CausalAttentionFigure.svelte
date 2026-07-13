<script lang="ts">
	// Causal vs bidirectional attention — side-by-side comparison of the
	// two attention patterns.
	//
	// Layout:
	//   LHS: causal self-attention matrix (Q rows × K columns). Each query
	//        row only attends to past-and-current keys — lower-triangular.
	//   RHS: bidirectional attention matrix. Every query attends to every
	//        key — the full square is filled in.
	//
	// Both matrices fill in row-by-row over time so the difference in
	// coverage between the two masks is immediately visible.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { PlayPauseResetButton } from '@diffusion-explorer/ui';

	interface Props {
		isActive?: Writable<boolean>;
		width?: number;
	}

	let { isActive, width = 780 }: Props = $props();

	// --- Palette ---
	const TEXT_COLOR = '#5a5a5a';
	const MUTED = '#8892a0';
	const BLOCK_LABEL_COLOR = '#5a5a5a';
	const CELL_STROKE = '#e2e6ec';
	const FOCUS_STROKE = '#F1942B';

	// Heatmap endpoints: low attention → white, high attention → orange.
	const HEAT_LOW = { r: 255, g: 255, b: 255 };
	const HEAT_HIGH = { r: 241, g: 148, b: 43 };

	function heatColor(t: number): string {
		const c = Math.max(0, Math.min(1, t));
		const r = Math.round(HEAT_LOW.r + (HEAT_HIGH.r - HEAT_LOW.r) * c);
		const g = Math.round(HEAT_LOW.g + (HEAT_HIGH.g - HEAT_LOW.g) * c);
		const b = Math.round(HEAT_LOW.b + (HEAT_HIGH.b - HEAT_LOW.b) * c);
		return `rgb(${r}, ${g}, ${b})`;
	}

	// --- Content ---
	const tokens = ['the', 'cat', 'sat', 'on', 'the', 'red', 'wool', 'mat'];
	const N = tokens.length;

	// Deterministic mock attention weights for the causal side, row-normalized.
	// Row i has nonzero weight only on columns j ≤ i (lower-triangular).
	const causalWeights: number[][] = [
		[1.0, 0, 0, 0, 0, 0, 0, 0],
		[0.35, 0.65, 0, 0, 0, 0, 0, 0],
		[0.15, 0.25, 0.6, 0, 0, 0, 0, 0],
		[0.1, 0.15, 0.15, 0.6, 0, 0, 0, 0],
		[0.08, 0.1, 0.12, 0.35, 0.35, 0, 0, 0],
		[0.05, 0.08, 0.1, 0.15, 0.22, 0.4, 0, 0],
		[0.04, 0.06, 0.08, 0.12, 0.15, 0.2, 0.35, 0],
		[0.03, 0.05, 0.06, 0.1, 0.12, 0.14, 0.2, 0.3]
	];

	// Bidirectional weights: every row attends to every column. Values in
	// [0, 1]; each row hand-picked with a distinct shape so different rows
	// have visually distinct distributions (some sharp on one column, some
	// spread out — same character as the causal side, just unrestricted).
	const bidirWeights: number[][] = [
		[0.5, 0.1, 0.06, 0.08, 0.08, 0.05, 0.06, 0.07],
		[0.2, 0.45, 0.1, 0.06, 0.05, 0.04, 0.05, 0.05],
		[0.08, 0.12, 0.4, 0.15, 0.1, 0.05, 0.05, 0.05],
		[0.05, 0.05, 0.08, 0.5, 0.18, 0.04, 0.04, 0.06],
		[0.04, 0.05, 0.06, 0.28, 0.4, 0.05, 0.06, 0.06],
		[0.05, 0.06, 0.05, 0.1, 0.12, 0.35, 0.12, 0.15],
		[0.05, 0.05, 0.06, 0.08, 0.1, 0.08, 0.42, 0.16],
		[0.05, 0.05, 0.05, 0.1, 0.12, 0.05, 0.13, 0.45]
	];

	function rowMax(weights: number[][]): number[] {
		return weights.map((row) => row.reduce((m, v) => Math.max(m, v), 0));
	}
	const causalRowMax = rowMax(causalWeights);
	const bidirRowMax = rowMax(bidirWeights);

	function causalHeat(i: number, j: number): number {
		if (j > i || causalRowMax[i] === 0) return 0;
		return causalWeights[i][j] / causalRowMax[i];
	}
	function bidirHeat(i: number, j: number): number {
		if (bidirRowMax[i] === 0) return 0;
		return bidirWeights[i][j] / bidirRowMax[i];
	}

	// --- Overall geometry ---
	const W = width;

	const CELL = 20;
	const GAP = 14;
	const CELL_STEP = CELL + GAP;
	const gridW = N * CELL_STEP - GAP;
	const gridH = N * CELL_STEP - GAP;

	// Room around each matrix for the "QUERIES" title + Q-token labels
	// (left) and the title + "KEYS" title + K-token labels (top).
	const TITLE_H = 26;
	const PAD_L = 60;
	const PAD_R = 8;
	const PAD_T = TITLE_H + 54;
	const PAD_B = 12;

	// Room below the matrix for the "input tokens → output token" arrow
	// diagram that visualises which columns flow into the current query row.
	const ARROW_ROW_GAP = 18; // gap between grid bottom and input-token strip
	const ARROW_ARC_H = 46; // vertical height of the arcs
	const ARROW_ROW_H = ARROW_ROW_GAP + ARROW_ARC_H + 14; // total extra height

	const PANEL_W = PAD_L + gridW + PAD_R;
	const PANEL_H = PAD_T + gridH + PAD_B + ARROW_ROW_H;

	const COL_GAP = 24;
	const LEFT_MARGIN = 12;
	const LEFT_X = LEFT_MARGIN;
	const RIGHT_X = LEFT_X + PANEL_W + COL_GAP;

	const W_INTRINSIC = RIGHT_X + PANEL_W + LEFT_MARGIN;

	const TOP_MARGIN = 20;
	const PANEL_Y = TOP_MARGIN;

	const H = PANEL_Y + PANEL_H + 30;

	function gridX(panelX: number): number {
		return panelX + PAD_L;
	}
	const gridY = PANEL_Y + PAD_T;

	function cellX(panelX: number, j: number): number {
		return gridX(panelX) + j * CELL_STEP;
	}
	function cellY(i: number): number {
		return gridY + i * CELL_STEP;
	}
	function kLabelX(panelX: number, j: number): number {
		return gridX(panelX) + j * CELL_STEP + CELL / 2;
	}
	function qLabelY(i: number): number {
		return gridY + i * CELL_STEP + CELL / 2;
	}

	const K_LABEL_Y = gridY - 14;
	const K_TITLE_Y = PANEL_Y + TITLE_H + 12;

	// Arrow-row geometry: a row of input tokens below the matrix, with
	// arcs flowing from sources to the current query's target token.
	const gridBottomY = gridY + gridH;
	// Baseline the arcs launch from and land on (same y for source + target
	// so the arc reads as a clean input→output loop).
	const ARROW_BASE_Y = gridBottomY + ARROW_ROW_GAP + ARROW_ARC_H;
	const ARROW_LABEL_Y = ARROW_BASE_Y + 14;
	// Peak of the arcs (the "flow" upward toward the matrix). Arcs never
	// enter the grid area.
	const ARROW_PEAK_Y = gridBottomY + ARROW_ROW_GAP;

	// --- Timeline ---
	const REVEAL_MS = 8000;
	const HOLD_MS = 3200;

	interface State {
		u: number;
	}
	let u = $state(0);
	let player = $state<Player<State> | undefined>(undefined);
	let isPlaying = $state(false);

	function play() {
		if (!player) return;
		player.play();
		isPlaying = true;
	}
	function pause() {
		if (!player) return;
		player.pause();
		isPlaying = false;
	}
	function reset() {
		if (!player) return;
		player.pause();
		player.reset();
		u = 0;
		isPlaying = false;
	}

	function smoothstep(x: number): number {
		const c = Math.max(0, Math.min(1, x));
		return c * c * (3 - 2 * c);
	}

	function phaseProgress(p: number): number {
		return Math.max(0, Math.min(1, u - (p - 1)));
	}

	function rowProgress(i: number): number {
		const p1 = phaseProgress(1);
		return smoothstep(Math.max(0, Math.min(1, p1 * N - i)));
	}

	const focusRow = $derived.by<number | null>(() => {
		const p1 = phaseProgress(1);
		if (p1 <= 0 || p1 >= 1) return null;
		const idx = Math.floor(p1 * N);
		return Math.min(N - 1, idx);
	});

	// Fractional progress within the current row's dwell window, in [0, 1).
	// A row is "focused" for 1/N of phase 1; we want pulses to loop several
	// times within that window, so we multiply the intra-row fraction and
	// keep the fractional part.
	const PULSES_PER_ROW = 2;
	const rowFrac = $derived.by<number>(() => {
		const p1 = phaseProgress(1);
		if (p1 <= 0 || p1 >= 1) return 0;
		const within = p1 * N - Math.floor(p1 * N); // [0, 1)
		const scaled = within * PULSES_PER_ROW;
		return scaled - Math.floor(scaled);
	});

	// Evaluate a quadratic Bezier at parameter t.
	function bezier(t: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
		const mt = 1 - t;
		return {
			x: mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
			y: mt * mt * y0 + 2 * mt * t * y1 + t * t * y2
		};
	}

	// A "pulse" is a short segment of the arc that travels along it. This
	// builds an SVG path `d` for the segment [tStart, tEnd] of the arc via
	// short line samples — cheap and readable, no dash-offset tricks.
	const PULSE_LEN = 0.28; // fraction of the arc lit up at any moment
	const PULSE_SAMPLES = 12;
	function pulsePath(
		head: number,
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		x2: number,
		y2: number
	): string {
		const tail = Math.max(0, head - PULSE_LEN);
		let d = '';
		for (let s = 0; s <= PULSE_SAMPLES; s++) {
			const t = tail + (head - tail) * (s / PULSE_SAMPLES);
			const p = bezier(t, x0, y0, x1, y1, x2, y2);
			d += (s === 0 ? 'M ' : 'L ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ' ';
		}
		return d;
	}

	function buildTimeline() {
		return new TimelineBuilder<State>()
			.setInitialState({ u: 0 })
			.add(
				{ name: 'reveal', reduce: (t: number) => ({ u: 0 + t }) },
				{ durationMs: REVEAL_MS }
			)
			.add({ name: 'hold', reduce: (_t: number) => ({ u: 2 }) }, { durationMs: HOLD_MS })
			.build();
	}

	onMount(() => {
		player = new Player<State>(buildTimeline(), { looping: true, endPause: 0.05 });
		player.onTick((_t, s) => {
			u = s.u;
		});
		const unsubActive = isActive?.subscribe((v) => {
			if (!player) return;
			if (v) {
				player.play();
				isPlaying = true;
			} else {
				player.pause();
				player.reset();
				u = 0;
				isPlaying = false;
			}
		});
		return () => {
			unsubActive?.();
			player?.dispose();
		};
	});
</script>

<div class="wrap">
	<PlayPauseResetButton
		{isPlaying}
		time={u / 2}
		onclick={() => (isPlaying ? pause() : play())}
		onreset={reset}
	/>
	<svg
		viewBox={`0 0 ${W_INTRINSIC} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Side-by-side comparison of causal self-attention (left, lower-triangular) and bidirectional attention (right, fully filled)."
	>
		{#each [{ x: LEFT_X, title: 'Causal Self-Attention', heat: causalHeat, causal: true }, { x: RIGHT_X, title: 'Bidirectional Attention', heat: bidirHeat, causal: false }] as panel}
			<!-- Panel title, centered above the KEYS axis (the grid), not the
			     whole panel — the panel is asymmetric due to the QUERIES pad. -->
			<text
				x={gridX(panel.x) + gridW / 2}
				y={PANEL_Y + TITLE_H / 2 + 4}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="15"
				font-weight="600"
				fill={BLOCK_LABEL_COLOR}
				letter-spacing="0.02em"
			>
				{panel.title}
			</text>

			<!-- Axis titles -->
			<text
				x={gridX(panel.x) + gridW / 2}
				y={K_TITLE_Y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="14"
				font-weight="600"
				letter-spacing="0.06em"
				fill={TEXT_COLOR}
			>
				KEYS
			</text>
			{@const qx = panel.x + 12}
			<text
				x={qx}
				y={gridY + gridH / 2}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="14"
				font-weight="600"
				letter-spacing="0.06em"
				fill={TEXT_COLOR}
				transform={`rotate(-90 ${qx} ${gridY + gridH / 2})`}
			>
				QUERIES
			</text>

			<!-- K token labels (above grid) -->
			{#each tokens as tok, j}
				<text
					x={kLabelX(panel.x, j)}
					y={K_LABEL_Y}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="13"
					fill={MUTED}
				>
					{tok}
				</text>
			{/each}

			<!-- Q token labels (left of grid) -->
			{#each tokens as tok, i}
				<text
					x={gridX(panel.x) - 10}
					y={qLabelY(i)}
					text-anchor="end"
					dominant-baseline="central"
					font-size="13"
					fill={MUTED}
				>
					{tok}
				</text>
			{/each}

			<!-- Heatmap cells -->
			{#each tokens as _q, i}
				{#each tokens as _k, j}
					{@const allowed = panel.causal ? j <= i : true}
					{@const rp = rowProgress(i)}
					{@const isFocus = focusRow === i}
					{#if allowed && rp > 0.02}
						<rect
							x={cellX(panel.x, j)}
							y={cellY(i)}
							width={CELL}
							height={CELL}
							rx={2}
							ry={2}
							fill={heatColor(panel.heat(i, j))}
							stroke={CELL_STROKE}
							stroke-width="0.75"
							opacity={rp}
						/>
						{#if isFocus}
							<rect
								x={cellX(panel.x, j) - 1}
								y={cellY(i) - 1}
								width={CELL + 2}
								height={CELL + 2}
								rx={3}
								ry={3}
								fill="none"
								stroke={FOCUS_STROKE}
								stroke-width="1.5"
								opacity={0.9}
							/>
						{/if}
					{/if}
				{/each}
			{/each}

			<!-- Input-token strip below the matrix -->
			{#each tokens as tok, j}
				{@const isTarget = focusRow === j}
				<text
					x={kLabelX(panel.x, j)}
					y={ARROW_LABEL_Y}
					text-anchor="middle"
					dominant-baseline="hanging"
					font-size="13"
					font-weight={isTarget ? 700 : 400}
					fill={isTarget ? FOCUS_STROKE : MUTED}
				>
					{tok}
				</text>
			{/each}

			<!-- Pulses travel along invisible arcs from each source token to
			     the current query's target token. Only a short lit segment
			     of each arc is drawn; the underlying arc itself is hidden. -->
			{#if focusRow !== null}
				{@const tgt = focusRow}
				{@const tgtX = kLabelX(panel.x, tgt)}
				{#each tokens as _tok, j}
					{@const allowed = panel.causal ? j <= tgt : true}
					{#if allowed && j !== tgt}
						{@const srcX = kLabelX(panel.x, j)}
						{@const dx = Math.abs(tgtX - srcX)}
						{@const peakY = ARROW_BASE_Y - Math.min(ARROW_ARC_H, 10 + dx * 0.55)}
						{@const y0 = ARROW_BASE_Y - 6}
						{@const cx = (srcX + tgtX) / 2}
						{@const head = rowFrac * (1 + PULSE_LEN)}
						{#if head > 0 && head - PULSE_LEN < 1}
							<path
								d={pulsePath(Math.min(1, head), srcX, y0, cx, peakY, tgtX, y0)}
								fill="none"
								stroke={FOCUS_STROKE}
								stroke-width="2"
								stroke-linecap="round"
								opacity={0.9}
							/>
						{/if}
					{/if}
				{/each}
			{/if}
		{/each}
	</svg>
</div>

<style>
	.wrap {
		width: 100%;
		max-width: 780px;
		margin: 0 auto;
		position: relative;
	}
	.wrap > svg {
		width: 100%;
		height: auto;
		display: block;
	}
</style>
