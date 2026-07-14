<script lang="ts">
	// Interactive bipartite attention-pattern figure.
	//
	// Two panels side by side, showing the same 6-token sentence
	// "the cat sat [MASK] the mat" under two attention patterns:
	//
	//   LHS (Causal): every output j only sees inputs i ≤ j.
	//   RHS (Bidirectional): every output j sees every input i.
	//
	// Each panel has three horizontal layers:
	//
	//   Word row:  plain text labels, [MASK] rendered as a rounded rect.
	//              Words sit directly above their embedding rectangles;
	//              no arrows connect them — spatial adjacency does the job.
	//   Embedding row: one small rect per position (the "top layer" of
	//                  the bipartite graph).
	//   Output row:    one small rect per position (the "bottom layer").
	//
	// Straight lines connect embeddings to outputs according to the
	// panel's attention pattern.
	//
	// Interaction:
	//   Default state highlights all edges entering the [MASK]'s output
	//   node in both panels — the causal panel shows only its past-looking
	//   edges, the bidirectional panel shows every edge into it.
	//
	//   Hovering any word / embedding / output node in a panel swaps that
	//   panel's highlight to that node's information-flow pattern:
	//   - Hovering an output j: edges INTO j (from every i that attends).
	//   - Hovering an embedding i (or its word): edges OUT of i (to every
	//     output j that attends to i).
	//   Hovering only affects the panel the pointer is in; the other panel
	//   stays on its default.

	interface Props {
		width?: number;
		maskColor?: string;
		maskTextColor?: string;
		curved?: boolean;
	}

	let {
		width = 940,
		maskColor = '#cfe0f2',
		maskTextColor = '#33506e',
		curved = true
	}: Props = $props();

	// --- Palette ---
	const TEXT_COLOR = '#333';
	const MUTED = '#c8ccd1';
	const ACCENT = '#f17720';
	const NODE_FILL = '#99BCDC';
	const NODE_STROKE_DEFAULT = '#7ba0c4';
	const HEADER_COLOR = '#666';

	// --- Content ---
	const tokens: (string | null)[] = ['the', 'cat', 'sat', null, 'the', 'mat'];
	const N = tokens.length;
	const MASK_INDEX = tokens.findIndex((t) => t === null);

	// --- Geometry ---
	const W = width;
	const H = 270;

	// Two panels side by side, with a clear visual gap so the reader
	// treats them as independent hover contexts.
	const OUTER_PAD_X = 12;
	const COL_GAP = 90;
	const PANEL_W = (W - 2 * OUTER_PAD_X - COL_GAP) / 2;
	function panelOriginX(which: number): number {
		return OUTER_PAD_X + which * (PANEL_W + COL_GAP);
	}

	// Node layout within a panel. Tokens sit tightly together inside each
	// panel so the bipartite structure reads as one integrated graph, not
	// two loose columns; the wide COL_GAP between panels keeps them
	// visually independent.
	const TOKEN_STEP = 62;
	const seqTotalW = (N - 1) * TOKEN_STEP;
	function slotXInPanel(panel: number, i: number): number {
		return panelOriginX(panel) + (PANEL_W - seqTotalW) / 2 + i * TOKEN_STEP;
	}

	const NODE_W = 22;
	const NODE_H = 22;
	const NODE_RX = 4;

	const HEADER_Y = 24;
	const WORD_Y = 72;
	const EMBED_Y = 106; // top of embedding rect
	const OUTPUT_Y = 200; // top of output rect

	function embedCX(panel: number, i: number): number {
		return slotXInPanel(panel, i);
	}
	function embedCY(): number {
		return EMBED_Y + NODE_H / 2;
	}
	function outputCX(panel: number, j: number): number {
		return slotXInPanel(panel, j);
	}
	function outputCY(): number {
		return OUTPUT_Y + NODE_H / 2;
	}

	// --- Attention patterns ---
	// canAttend[panel](i, j) = true iff output j attends to embedding i.
	// Panel 0 = causal (i ≤ j); panel 1 = bidirectional (always true).
	function canAttend(panel: number, i: number, j: number): boolean {
		if (panel === 0) return i <= j;
		return true;
	}

	// Precompute the list of (i, j) edges per panel.
	function allEdges(panel: number): Array<{ from: number; to: number }> {
		const out: Array<{ from: number; to: number }> = [];
		for (let j = 0; j < N; j++) {
			for (let i = 0; i < N; i++) {
				if (canAttend(panel, i, j)) out.push({ from: i, to: j });
			}
		}
		return out;
	}
	const edges: Array<Array<{ from: number; to: number }>> = [allEdges(0), allEdges(1)];

	// --- Selection state (shared across both panels) ---
	// Hovering a node in either panel updates the SAME selection so both
	// panels reflect the same anchor — the reader can directly compare
	// "same input/output position, different attention patterns."
	// Sticky: pointer-leave does not clear; only a new hover replaces the
	// selection. On initial mount, the selection defaults to the mask's
	// output node (which is the point of the figure).
	type HoverKind = 'input' | 'embed' | 'output';
	interface Hover {
		kind: HoverKind;
		index: number;
	}
	let selection = $state<Hover>({ kind: 'output', index: MASK_INDEX });

	function setSelection(h: Hover) {
		selection = h;
	}

	// Compute highlighted edges + nodes for a panel given the shared
	// selection. Both panels use the same selection but their own
	// attention pattern (causal vs bidirectional), so the highlighted
	// edges naturally differ.
	function highlighted(panel: number): {
		edges: Set<string>;
		embeds: Set<number>;
		outputs: Set<number>;
		wordFocus: number | null;
	} {
		const h = selection;
		const es = new Set<string>();
		const embeds = new Set<number>();
		const outputs = new Set<number>();
		let wordFocus: number | null = null;

		let mode: 'out' | 'in';
		let anchor: number;
		if (h.kind === 'output') {
			mode = 'in';
			anchor = h.index;
		} else {
			// input word or embedding — treated the same
			mode = 'out';
			anchor = h.index;
			wordFocus = h.index;
		}

		if (mode === 'in') {
			// Edges entering output `anchor`.
			outputs.add(anchor);
			for (let i = 0; i < N; i++) {
				if (canAttend(panel, i, anchor)) {
					es.add(`${i}-${anchor}`);
					embeds.add(i);
				}
			}
		} else {
			// Edges leaving embedding `anchor`.
			embeds.add(anchor);
			for (let j = 0; j < N; j++) {
				if (canAttend(panel, anchor, j)) {
					es.add(`${anchor}-${j}`);
					outputs.add(j);
				}
			}
		}
		return { edges: es, embeds, outputs, wordFocus };
	}

	const hl0 = $derived(highlighted(0));
	const hl1 = $derived(highlighted(1));
	function hl(panel: number) {
		return panel === 0 ? hl0 : hl1;
	}

	// Edge path from an embedding's bottom to an output's top.
	// When `curved`, use a cubic Bézier whose control points share the
	// endpoints' x-coords, offset vertically — the curve leaves the
	// embedding straight down and enters the output straight up, so
	// edges look like they "connect" to the rectangles rather than
	// striking them at odd angles. When straight, just a plain line.
	function edgePath(x1: number, y1: number, x2: number, y2: number): string {
		if (!curved || x1 === x2) {
			return `M ${x1} ${y1} L ${x2} ${y2}`;
		}
		const dy = y2 - y1;
		// Control points reach ~55% of the vertical gap from each end.
		// Higher values make the launch/landing more vertical; lower
		// values push the curve toward a straight diagonal.
		const t = 0.55;
		const c1x = x1;
		const c1y = y1 + dy * t;
		const c2x = x2;
		const c2y = y2 - dy * t;
		return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
	}
</script>

<div class="wrap" style="--mask-color: {maskColor}">
	<svg
		viewBox={`0 0 ${W} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Bipartite information-flow diagram comparing causal and bidirectional attention on the sentence 'the cat sat [MASK] the mat'. Left panel shows causal attention: each output attends only to itself and earlier positions. Right panel shows bidirectional attention: each output attends to every position. Hover any node to see the corresponding pattern."
	>
		{#each [0, 1] as panel}
			{@const H_ = hl(panel)}
			{@const oX = panelOriginX(panel)}

			<!-- Panel header -->
			<text
				x={oX + PANEL_W / 2}
				y={HEADER_Y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="22"
				font-weight="600"
				fill={HEADER_COLOR}
				letter-spacing="0.02em"
			>
				{panel === 0 ? 'Causal Attention' : 'Bidirectional Attention'}
			</text>

			<!-- Word row -->
			{#each tokens as tok, i}
				{@const cx = slotXInPanel(panel, i)}
				{@const isFocused = H_.wordFocus === i}
				{#if tok === null}
					{@const MASK_PILL_W = 60}
					{@const MASK_PILL_H = 28}
					<rect
						x={cx - MASK_PILL_W / 2}
						y={WORD_Y - MASK_PILL_H / 2}
						width={MASK_PILL_W}
						height={MASK_PILL_H}
						rx={4}
						ry={4}
						fill={maskColor}
						style="cursor: pointer;"
						onmouseenter={() => setSelection({ kind: 'input', index: i })}
						role="button"
						tabindex="0"
						aria-label={`Hover to show attention pattern for the mask at position ${i}`}
					/>
					<text
						x={cx}
						y={WORD_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="15"
						font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
						fill={maskTextColor}
						pointer-events="none"
					>
						[MASK]
					</text>
				{:else}
					<text
						x={cx}
						y={WORD_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="22"
						fill={isFocused ? ACCENT : TEXT_COLOR}
						font-weight={isFocused ? '600' : '400'}
						style="cursor: pointer;"
						onmouseenter={() => setSelection({ kind: 'input', index: i })}
					>
						{tok}
					</text>
				{/if}
			{/each}

			<!-- Faint edges (drawn first, underneath) -->
			{#each edges[panel] as e (`${panel}-faint-${e.from}-${e.to}`)}
				{@const key = `${e.from}-${e.to}`}
				{@const isOn = H_.edges.has(key)}
				{#if !isOn}
					<path
						d={edgePath(
							embedCX(panel, e.from),
							EMBED_Y + NODE_H,
							outputCX(panel, e.to),
							OUTPUT_Y
						)}
						fill="none"
						stroke={MUTED}
						stroke-width="2"
						opacity="0.5"
					/>
				{/if}
			{/each}

			<!-- Highlighted edges (drawn on top) — marching-ants dashes
			     animate along the path direction (embedding → output),
			     visualizing information flowing down into the target. -->
			{#each edges[panel] as e (`${panel}-lit-${e.from}-${e.to}`)}
				{@const key = `${e.from}-${e.to}`}
				{@const isOn = H_.edges.has(key)}
				{#if isOn}
					<path
						class="flow-edge"
						d={edgePath(
							embedCX(panel, e.from),
							EMBED_Y + NODE_H,
							outputCX(panel, e.to),
							OUTPUT_Y
						)}
						fill="none"
						stroke={ACCENT}
						stroke-width="3"
						opacity="0.9"
					/>
				{/if}
			{/each}

			<!-- Embedding nodes -->
			{#each tokens as _tok, i}
				{@const cx = slotXInPanel(panel, i)}
				{@const isOn = H_.embeds.has(i)}
				<rect
					x={cx - NODE_W / 2}
					y={EMBED_Y}
					width={NODE_W}
					height={NODE_H}
					rx={NODE_RX}
					ry={NODE_RX}
					fill={NODE_FILL}
					stroke={isOn ? ACCENT : NODE_STROKE_DEFAULT}
					stroke-width={isOn ? 2.5 : 1}
					opacity={isOn ? 1 : 0.65}
					style="cursor: pointer;"
					onmouseenter={() => setSelection({ kind: 'embed', index: i })}
					role="button"
					tabindex="0"
					aria-label={`Embedding at position ${i}. Hover to see which outputs it sends information to.`}
				/>
			{/each}

			<!-- Output nodes -->
			{#each tokens as _tok, j}
				{@const cx = slotXInPanel(panel, j)}
				{@const isOn = H_.outputs.has(j)}
				<rect
					x={cx - NODE_W / 2}
					y={OUTPUT_Y}
					width={NODE_W}
					height={NODE_H}
					rx={NODE_RX}
					ry={NODE_RX}
					fill={NODE_FILL}
					stroke={isOn ? ACCENT : NODE_STROKE_DEFAULT}
					stroke-width={isOn ? 2.5 : 1}
					opacity={isOn ? 1 : 0.65}
					style="cursor: pointer;"
					onmouseenter={() => setSelection({ kind: 'output', index: j })}
					role="button"
					tabindex="0"
					aria-label={`Output at position ${j}. Hover to see which inputs it attends to.`}
				/>
			{/each}

		{/each}
	</svg>
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		max-width: 940px;
		margin: 0 auto;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}

	/* Marching-ants dashes flow along each active edge from embedding
	   (top) to output (bottom). Negative dashoffset pulls the dashes
	   forward along the path's natural direction. */
	.flow-edge {
		stroke-dasharray: 8 5;
		animation: flow-march 1.2s linear infinite;
	}
	@keyframes flow-march {
		to {
			stroke-dashoffset: -26;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.flow-edge {
			animation: none;
			stroke-dasharray: none;
		}
	}
</style>
