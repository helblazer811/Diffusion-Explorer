<script lang="ts">
	// Causal vs bidirectional attention — side-by-side comparison of the
	// two attention masks. Static: both matrices are shown in their
	// final state the whole time, no animation.
	//
	// Layout:
	//   LHS: causal self-attention matrix (Q rows × K columns). Each query
	//        row only attends to past-and-current keys — the upper triangle
	//        is drawn as gray "masked" grid cells so the shape of the
	//        constraint is legible.
	//   RHS: bidirectional attention matrix. Every query attends to every
	//        key — the full square is filled in with the heatmap.

	import type { Writable } from 'svelte/store';

	interface Props {
		// Kept for API parity with the previous animated version; unused now.
		isActive?: Writable<boolean>;
		width?: number;
	}

	let { width = 780 }: Props = $props();

	// --- Palette ---
	const TEXT_COLOR = '#5a5a5a';
	const MUTED = '#8892a0';
	const BLOCK_LABEL_COLOR = '#5a5a5a';
	const CELL_STROKE = '#e2e6ec';
	const MASKED_CELL_FILL = '#e9ecef';
	const MASKED_CELL_STROKE = '#d5d9dd';
	// Mask-token label color: darker shade in the mask-blue family so
	// [MASK] axis labels read as the same visual element as elsewhere.
	const MASK_TEXT_COLOR = '#33506e';

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
	// Matches AttentionPatternFigure so the two visualizations share the
	// same worked example. Position 3 is [MASK].
	const tokens: (string | null)[] = ['the', 'cat', 'sat', null, 'the', 'mat'];
	const N = tokens.length;
	const MASK_LABEL = '[MASK]';

	// Deterministic mock attention weights for the causal side, row-normalized.
	// Row i has nonzero weight only on columns j ≤ i (lower-triangular).
	const causalWeights: number[][] = [
		[1.0, 0, 0, 0, 0, 0],
		[0.35, 0.65, 0, 0, 0, 0],
		[0.15, 0.25, 0.6, 0, 0, 0],
		[0.1, 0.2, 0.3, 0.4, 0, 0],
		[0.08, 0.12, 0.2, 0.25, 0.35, 0],
		[0.05, 0.08, 0.15, 0.22, 0.2, 0.3]
	];

	// Bidirectional weights: every row attends to every column. Values in
	// [0, 1]; rows are hand-picked to be DISTINCTLY ASYMMETRIC across the
	// diagonal — i.e. p[i][j] ≠ p[j][i]. This makes it obvious that
	// bidirectional attention is not just a symmetric relationship: the
	// query row and the key column play different roles.
	const bidirWeights: number[][] = [
		// row 0 ("the"): attends heavily to "cat" (its noun) and "mat"
		[0.05, 0.55, 0.05, 0.05, 0.05, 0.25],
		// row 1 ("cat"): attends heavily to "sat" and "[MASK]"
		[0.05, 0.1, 0.4, 0.35, 0.05, 0.05],
		// row 2 ("sat"): attends to "cat" and "mat", less to itself
		[0.05, 0.35, 0.1, 0.1, 0.05, 0.35],
		// row 3 ("[MASK]"): attends broadly, peak on "sat" and "mat"
		[0.05, 0.1, 0.35, 0.05, 0.1, 0.35],
		// row 4 ("the"): attends heavily to "mat" (its noun)
		[0.05, 0.05, 0.05, 0.1, 0.05, 0.7],
		// row 5 ("mat"): attends heavily to "cat" and "sat"
		[0.1, 0.3, 0.35, 0.05, 0.1, 0.1]
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

	const CELL = 30;
	const GAP = 12; // spacing between cells (also drives label spacing)
	const CELL_STEP = CELL + GAP;
	const gridW = N * CELL_STEP - GAP;
	const gridH = N * CELL_STEP - GAP;

	// Room around each matrix for the KEYS title + K-token labels (top) and
	// the QUERIES title + Q-token labels (left).
	const TITLE_H = 26;
	const PAD_L = 76;
	const PAD_R = 8;
	const PAD_T = TITLE_H + 52;
	const PAD_B = 12;

	const PANEL_W = PAD_L + gridW + PAD_R;
	const PANEL_H = PAD_T + gridH + PAD_B;

	const COL_GAP = 24;
	const LEFT_MARGIN = 12;
	const LEFT_X = LEFT_MARGIN;
	const RIGHT_X = LEFT_X + PANEL_W + COL_GAP;

	const W_INTRINSIC = RIGHT_X + PANEL_W + LEFT_MARGIN;

	const TOP_MARGIN = 20;
	const PANEL_Y = TOP_MARGIN;

	const H = PANEL_Y + PANEL_H + 12;

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
	const K_TITLE_Y = PANEL_Y + TITLE_H + 18;
</script>

<div class="wrap">
	<svg
		viewBox={`0 0 ${W_INTRINSIC} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Side-by-side comparison of causal self-attention (left, lower-triangular with the masked upper-triangle drawn as gray cells) and bidirectional attention (right, fully filled)."
	>
		{#each [{ x: LEFT_X, title: 'Causal Self-Attention', heat: causalHeat, weights: causalWeights, causal: true }, { x: RIGHT_X, title: 'Bidirectional Attention', heat: bidirHeat, weights: bidirWeights, causal: false }] as panel}
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
				letter-spacing="0"
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
				letter-spacing="0"
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
					font-size={tok === null ? 11 : 13}
					font-family={tok === null
						? 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace'
						: 'inherit'}
					fill={MUTED}
				>
					{tok ?? MASK_LABEL}
				</text>
			{/each}

			<!-- Q token labels (left of grid) -->
			{#each tokens as tok, i}
				<text
					x={gridX(panel.x) - 10}
					y={qLabelY(i)}
					text-anchor="end"
					dominant-baseline="central"
					font-size={tok === null ? 11 : 13}
					font-family={tok === null
						? 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace'
						: 'inherit'}
					fill={MUTED}
				>
					{tok ?? MASK_LABEL}
				</text>
			{/each}

			<!-- Heatmap cells. Causal panel: cells with j > i are masked out —
			     drawn as gray placeholder cells so the shape of the mask is
			     visible instead of empty space. Each cell shows its attention
			     weight (0.0 for masked cells). -->
			{#each tokens as _q, i}
				{#each tokens as _k, j}
					{@const isMasked = panel.causal && j > i}
					{@const cxCell = cellX(panel.x, j) + CELL / 2}
					{@const cyCell = cellY(i) + CELL / 2}
					{@const weight = isMasked ? 0 : panel.weights[i][j]}
					{@const heat = isMasked ? 0 : panel.heat(i, j)}
					{#if isMasked}
						<rect
							x={cellX(panel.x, j)}
							y={cellY(i)}
							width={CELL}
							height={CELL}
							rx={5}
							ry={5}
							fill={MASKED_CELL_FILL}
							stroke={MASKED_CELL_STROKE}
							stroke-width="0.75"
							opacity="0.55"
						/>
					{:else}
						<rect
							x={cellX(panel.x, j)}
							y={cellY(i)}
							width={CELL}
							height={CELL}
							rx={5}
							ry={5}
							fill={heatColor(heat)}
							stroke={CELL_STROKE}
							stroke-width="0.75"
						/>
					{/if}
					<text
						x={cxCell}
						y={cyCell}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="11"
						font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
						fill={isMasked ? '#b5b8bd' : '#5a5a5a'}
					>
						{weight.toFixed(1)}
					</text>
				{/each}
			{/each}
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
