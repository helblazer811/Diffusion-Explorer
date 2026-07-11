<script lang="ts">
	// Causal self-attention figure — zoomed-in view of a single attention
	// layer + its KV cache.
	//
	// Layout:
	//   LHS: a small static "KV Cache" block, styled after the per-layer
	//        cache rectangles in the KVCacheFigure (green K row on top,
	//        pink V row below, one K/V pair per token).
	//   RHS: the causal self-attention matrix (Q rows × K columns) inside
	//        a gray "Attention Layer" container. The matrix fills in
	//        row-by-row over time; each query row only attends to
	//        past-and-current keys (lower-triangular). Below the matrix,
	//        past → current arrows label the one-directional flow of
	//        information.
	//
	// This figure zooms in on the causal structure introduced in the
	// KV Caching figure above: the cache on the left is what the causal
	// mask on the right makes possible.

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
	const CELL_STROKE = '#e2e6ec'; // subtle heatmap-cell outline
	const FOCUS_STROKE = '#F1942B';
	const FWD_ARROW = '#F1942B';
	const LAYER_FILL = '#f4f6fa';
	const LAYER_STROKE = '#c8ccd1';
	const K_FILL = '#4AD77A';
	const V_FILL = '#EF6AAC';
	const KV_STROKE = '#8892a0';

	// Heatmap endpoints: low attention → white, high attention → orange.
	// Interpolated in sRGB (good enough for a 0–1 fill on a small grid).
	const HEAT_LOW = { r: 255, g: 255, b: 255 };
	const HEAT_HIGH = { r: 241, g: 148, b: 43 }; // matches FWD_ARROW #F1942B

	function heatColor(t: number): string {
		const c = Math.max(0, Math.min(1, t));
		const r = Math.round(HEAT_LOW.r + (HEAT_HIGH.r - HEAT_LOW.r) * c);
		const g = Math.round(HEAT_LOW.g + (HEAT_HIGH.g - HEAT_LOW.g) * c);
		const b = Math.round(HEAT_LOW.b + (HEAT_HIGH.b - HEAT_LOW.b) * c);
		return `rgb(${r}, ${g}, ${b})`;
	}

	// --- Content ---
	const tokens = ['Where', 'is', 'the', 'Eiffel', 'Tower', '?', 'In', 'Paris'];
	const N = tokens.length;

	// Deterministic mock attention weights, row-normalized (softmax-shaped).
	// Each row is a query; each column is a key. Values in [0, 1]; row i has
	// nonzero weight only on columns j ≤ i (causal), and every allowed row
	// sums to ~1. Hand-picked so different rows have visually distinct
	// distributions — some rows sharpen on one column, some are spread out.
	const rawWeights: number[][] = [
		[1.0, 0, 0, 0, 0, 0, 0, 0],
		[0.35, 0.65, 0, 0, 0, 0, 0, 0],
		[0.15, 0.25, 0.6, 0, 0, 0, 0, 0],
		[0.1, 0.15, 0.15, 0.6, 0, 0, 0, 0],
		[0.08, 0.1, 0.12, 0.35, 0.35, 0, 0, 0],
		[0.05, 0.08, 0.1, 0.15, 0.22, 0.4, 0, 0],
		[0.04, 0.06, 0.08, 0.12, 0.15, 0.2, 0.35, 0],
		[0.03, 0.05, 0.06, 0.1, 0.12, 0.14, 0.2, 0.3]
	];
	// Per-row max for scaling into the heatmap: each row's heaviest cell
	// hits the deep-orange end of the ramp, lighter cells scale down.
	const rowMax: number[] = rawWeights.map((row) =>
		row.reduce((m, v) => Math.max(m, v), 0)
	);
	function attnHeat(i: number, j: number): number {
		if (j > i || rowMax[i] === 0) return 0;
		return rawWeights[i][j] / rowMax[i];
	}

	// --- Overall geometry ---
	const W = width;

	// Attention Layer (RHS) container geometry.
	const CELL = 20;
	const GAP = 3;
	const CELL_STEP = CELL + GAP;
	const gridW = N * CELL_STEP - GAP;
	const gridH = N * CELL_STEP - GAP;

	// Inner padding inside the "Attention Layer" gray container.
	const LAYER_TITLE_H = 30;
	const LAYER_PAD_L = 108; // room for the "QUERIES" title + Q-token labels inside
	const LAYER_PAD_R = 16;
	const LAYER_PAD_T = LAYER_TITLE_H + 40; // room for Keys title + K-token labels inside
	const LAYER_PAD_B = 16;

	const LAYER_W = LAYER_PAD_L + gridW + LAYER_PAD_R;
	const LAYER_H = LAYER_PAD_T + gridH + LAYER_PAD_B;

	// LHS: KV Cache mini-block. Sized proportionally to feel like a zoom-in
	// of a single layer's cache from KVCacheFigure.
	const CACHE_W = 240;
	const CACHE_LABEL_H = 24;
	const KV_CELL_W = 22;
	const KV_HALF_H = 18;
	const KV_CELL_H = KV_HALF_H * 2;
	const KV_INNER_PADDING = 8;
	const KV_LABEL_W = 16;
	const KV_ROW_W = CACHE_W - 2 * KV_INNER_PADDING - KV_LABEL_W;
	const KV_STRIDE = KV_ROW_W / N;
	const CACHE_H = CACHE_LABEL_H + KV_CELL_H + 24; // label + K/V cells + padding

	// Column layout: cache on the left, attention layer on the right.
	const COL_GAP = 40;
	const LEFT_MARGIN = 20;
	const CACHE_X = LEFT_MARGIN;
	const LAYER_X = CACHE_X + CACHE_W + COL_GAP;

	// Total viewBox width from computed layout (fall back to `width` for
	// SVG width; the intrinsic layout width `W_INTRINSIC` sets the viewBox).
	const W_INTRINSIC = LAYER_X + LAYER_W + LEFT_MARGIN;

	// Vertical layout: attention layer starts near the top; cache is
	// centered vertically against it.
	const TOP_MARGIN = 30;
	const LAYER_Y = TOP_MARGIN;
	const CACHE_Y = LAYER_Y + (LAYER_H - CACHE_H) / 2;

	// Room below the layer for the forward-arrow row + caption.
	const ARROW_ROW_H = 60;
	const H = LAYER_Y + LAYER_H + ARROW_ROW_H + 30;

	// Attention-matrix geometry inside the layer container.
	const gridX = LAYER_X + LAYER_PAD_L;
	const gridY = LAYER_Y + LAYER_PAD_T;

	function cellX(j: number): number {
		return gridX + j * CELL_STEP;
	}
	function cellY(i: number): number {
		return gridY + i * CELL_STEP;
	}
	function kLabelX(j: number): number {
		return gridX + j * CELL_STEP + CELL / 2;
	}
	function qLabelY(i: number): number {
		return gridY + i * CELL_STEP + CELL / 2;
	}

	// K-axis title (inside the layer, above the grid) and Q-axis title
	// (inside the layer, to the left of the grid, rotated).
	const K_TITLE_Y = LAYER_Y + LAYER_TITLE_H + 8;
	const K_LABEL_Y = gridY - 14;

	// Cache cell x-positions (K/V pairs, one per token).
	function kvCellX(tokenI: number): number {
		return CACHE_X + KV_INNER_PADDING + KV_LABEL_W + tokenI * KV_STRIDE + KV_STRIDE / 2 - KV_CELL_W / 2;
	}
	const KV_CELL_Y = CACHE_Y + CACHE_LABEL_H + 4;

	// Forward-arrow row sits just below the attention layer.
	const FWD_ARROW_Y = LAYER_Y + LAYER_H + 22;

	// --- Timeline ---
	const REVEAL_MS = 8000;
	const FWD_MS = 1800;
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

	const fwdProgress = $derived(smoothstep(phaseProgress(2)));

	function buildTimeline() {
		return new TimelineBuilder<State>()
			.setInitialState({ u: 0 })
			.add(
				{ name: 'reveal', reduce: (t: number) => ({ u: 0 + t }) },
				{ durationMs: REVEAL_MS }
			)
			.add(
				{ name: 'fwd-arrows', reduce: (t: number) => ({ u: 1 + t }) },
				{ durationMs: FWD_MS }
			)
			.add({ name: 'hold', reduce: (_t: number) => ({ u: 3 }) }, { durationMs: HOLD_MS })
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
		time={u / 3}
		onclick={() => (isPlaying ? pause() : play())}
		onreset={reset}
	/>
	<svg
		viewBox={`0 0 ${W_INTRINSIC} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Zoomed-in view of a single self-attention layer with its KV cache on the left, plus an animated causal attention matrix on the right filling in row-by-row."
	>
		<defs>
			<marker
				id="caf-fwd"
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={5}
				markerHeight={5}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={FWD_ARROW} />
			</marker>
		</defs>

		<!-- =============================================================
		     LHS: static KV Cache block (mirrors KVCacheFigure per-layer cache).
		     ============================================================= -->
		<rect
			x={CACHE_X}
			y={CACHE_Y}
			width={CACHE_W}
			height={CACHE_H}
			rx="6"
			ry="6"
			fill="#ffffff"
			stroke={LAYER_STROKE}
			stroke-width="1"
		/>
		<text
			x={CACHE_X + 8}
			y={CACHE_Y + 6}
			dominant-baseline="hanging"
			font-size="14"
			font-weight="500"
			fill={BLOCK_LABEL_COLOR}
			letter-spacing="0.02em"
		>
			KV Cache
		</text>

		<!-- K/V row labels -->
		<text
			x={CACHE_X + KV_INNER_PADDING + 2}
			y={KV_CELL_Y + KV_HALF_H / 2}
			text-anchor="start"
			dominant-baseline="central"
			font-size="11"
			font-weight="600"
			fill={MUTED}
		>
			K
		</text>
		<text
			x={CACHE_X + KV_INNER_PADDING + 2}
			y={KV_CELL_Y + KV_HALF_H + KV_HALF_H / 2}
			text-anchor="start"
			dominant-baseline="central"
			font-size="11"
			font-weight="600"
			fill={MUTED}
		>
			V
		</text>

		<!-- K/V pair cells, one per token, statically filled. -->
		{#each tokens as _tok, i}
			{@const cx = kvCellX(i)}
			<rect
				x={cx}
				y={KV_CELL_Y}
				width={KV_CELL_W}
				height={KV_HALF_H}
				rx="2"
				ry="2"
				fill={K_FILL}
				stroke={KV_STROKE}
				stroke-width="0.75"
			/>
			<rect
				x={cx}
				y={KV_CELL_Y + KV_HALF_H}
				width={KV_CELL_W}
				height={KV_HALF_H}
				rx="2"
				ry="2"
				fill={V_FILL}
				stroke={KV_STROKE}
				stroke-width="0.75"
			/>
		{/each}

		<!-- =============================================================
		     RHS: Attention Layer container with the causal matrix inside.
		     ============================================================= -->
		<rect
			x={LAYER_X}
			y={LAYER_Y}
			width={LAYER_W}
			height={LAYER_H}
			rx="10"
			ry="10"
			fill={LAYER_FILL}
			stroke={LAYER_STROKE}
			stroke-width="1"
		/>
		<text
			x={LAYER_X + LAYER_W / 2}
			y={LAYER_Y + LAYER_TITLE_H / 2 + 6}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="15"
			font-weight="600"
			fill={BLOCK_LABEL_COLOR}
			letter-spacing="0.02em"
		>
			Attention Layer
		</text>

		<!-- Axis titles inside the layer -->
		<text
			x={gridX + gridW / 2}
			y={K_TITLE_Y}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="12"
			font-weight="600"
			letter-spacing="0.06em"
			fill={TEXT_COLOR}
		>
			KEYS
		</text>
		<text
			x={LAYER_X + LAYER_PAD_L / 2 - 20}
			y={gridY + gridH / 2}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="12"
			font-weight="600"
			letter-spacing="0.06em"
			fill={TEXT_COLOR}
			transform={`rotate(-90 ${LAYER_X + LAYER_PAD_L / 2 - 20} ${gridY + gridH / 2})`}
		>
			QUERIES
		</text>

		<!-- K token labels (above grid) -->
		{#each tokens as tok, j}
			<text
				x={kLabelX(j)}
				y={K_LABEL_Y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="11"
				fill={MUTED}
			>
				{tok}
			</text>
		{/each}

		<!-- Q token labels (left of grid) -->
		{#each tokens as tok, i}
			<text
				x={gridX - 10}
				y={qLabelY(i)}
				text-anchor="end"
				dominant-baseline="central"
				font-size="11"
				fill={MUTED}
			>
				{tok}
			</text>
		{/each}

		<!-- Heatmap cells: only lower-triangular cells appear, one row per
		     beat. Fill colour ramps from white (low attention) to orange
		     (high attention) using each row's row-normalized weights. -->
		{#each tokens as _q, i}
			{#each tokens as _k, j}
				{@const allowed = j <= i}
				{@const rp = rowProgress(i)}
				{@const isFocus = focusRow === i}
				{#if allowed && rp > 0.02}
					<rect
						x={cellX(j)}
						y={cellY(i)}
						width={CELL}
						height={CELL}
						rx={2}
						ry={2}
						fill={heatColor(attnHeat(i, j))}
						stroke={CELL_STROKE}
						stroke-width="0.75"
						opacity={rp}
					/>
					{#if isFocus}
						<rect
							x={cellX(j) - 1}
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

		<!-- =============================================================
		     Forward arrows below the layer + label
		     ============================================================= -->
		<g opacity={fwdProgress}>
			{#each Array(N - 1) as _, j}
				{@const x1 = kLabelX(j) + 6}
				{@const x2 = kLabelX(j + 1) - 6}
				<line
					x1={x1}
					y1={FWD_ARROW_Y}
					x2={x2}
					y2={FWD_ARROW_Y}
					stroke={FWD_ARROW}
					stroke-width="2"
					marker-end="url(#caf-fwd)"
				/>
			{/each}
			<text
				x={gridX + gridW / 2}
				y={FWD_ARROW_Y + 22}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="13"
				font-weight="600"
				fill={FWD_ARROW}
			>
				One-directional flow of information
			</text>
		</g>
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
