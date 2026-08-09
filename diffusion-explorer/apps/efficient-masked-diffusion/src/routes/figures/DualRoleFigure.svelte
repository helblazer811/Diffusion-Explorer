<script lang="ts">
	// Dual-Role figure — 3-layer bipartite version.
	//
	// Two panels side by side. Each panel shows 4 rows of hidden-state
	// nodes (input row + 3 layer output rows), with the FULL causal
	// attention pattern drawn as faint curved cubic-Bezier arcs between
	// every consecutive pair of rows. Both panels have the same 7-token
	// sentence and the same causal architecture; they differ only in
	// which arcs get lit up.
	//
	//   LHS ("Belief role"): at each layer, the arcs INTO column 3
	//        (from every j ≤ 3) are highlighted — column 3 is receiving
	//        information from earlier positions. After the final layer,
	//        column 3's top-row node fans DOWN via 4 more curved arcs
	//        to a bar chart of next-token probabilities (the LM head
	//        reading the final hidden state).
	//
	//   RHS ("Content role"): at each layer, the arcs OUT OF column 3
	//        (to every j ≥ 3, but we focus on the FUTURE queries 4, 5, 6)
	//        are highlighted — column 3 is sending durable context to
	//        every later query. No bar chart.
	//
	// Visual language copied from blog 1's AttentionPatternFigure:
	//   - Two panels side by side with wide COL_GAP.
	//   - Node rectangles with rounded corners; committed columns fill,
	//     uncommitted faded, target column outlined in accent.
	//   - Curved cubic-Bezier `edgePath` function whose control points
	//     share the endpoints' x-coords so edges enter/exit rectangles
	//     vertically.
	//   - Faint guides drawn first (below), lit pulses drawn last (above).

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';

	// ----------------------------------------------------------------
	// Props
	// ----------------------------------------------------------------

	interface Props {
		isActive?: Writable<boolean>;
		width?: number;
		maskColor?: string;
		maskTextColor?: string;
		fontSize?: number;
	}

	let {
		isActive,
		width = 940,
		maskColor: _maskColor = '#cfe0f2',
		maskTextColor: _maskTextColor = '#33506e',
		fontSize = 16
	}: Props = $props();

	// ----------------------------------------------------------------
	// State
	// ----------------------------------------------------------------

	let u = $state(0);
	let player = $state<Player<{ u: number }> | undefined>(undefined);

	// --- Palette ---
	const TEXT_COLOR = '#333';
	const MUTED = '#c8ccd1';
	const HEADER_COLOR = '#666';
	const SUBHEADER_COLOR = '#8892a0';
	const NODE_FILL = '#99BCDC';
	const NODE_STROKE_DEFAULT = '#7ba0c4';
	const FADED_NODE_FILL = '#e6ecf3';
	const FADED_NODE_STROKE = '#c8d3de';
	const ACCENT = '#f17720';
	const ACTIVE_STROKE = '#F1942B';
	const BAR_COLOR = '#99BCDC';
	const BAR_MUTED = '#888';

	// --- Content ---
	const tokens = ['the', 'cat', 'sat', 'on', 'the', 'warm', 'mat'];
	const N = tokens.length;
	const TARGET = 3;
	const RHS_QUERIES = [4, 5, 6];
	const COMMITTED = TARGET;
	const N_LAYERS = 2;

	const candidates: { word: string; p: number }[] = [
		{ word: 'sat', p: 0.62 }, // argmax
		{ word: 'lay', p: 0.21 },
		{ word: 'ran', p: 0.12 },
		{ word: 'ate', p: 0.05 }
	];
	const ARGMAX_INDEX = 0;

	// ----------------------------------------------------------------
	// Panel geometry (from AttentionPatternFigure)
	// ----------------------------------------------------------------

	const W = width;
	const OUTER_PAD_X = 12;
	const COL_GAP = 40;
	const PANEL_W = (W - 2 * OUTER_PAD_X - COL_GAP) / 2;
	function panelOriginX(which: number): number {
		return OUTER_PAD_X + which * (PANEL_W + COL_GAP);
	}
	const LEFT_X = panelOriginX(0);
	const RIGHT_X = panelOriginX(1);

	const TOKEN_STEP = 48;
	const seqTotalW = (N - 1) * TOKEN_STEP;
	function slotXInPanel(panel: number, i: number): number {
		return panelOriginX(panel) + (PANEL_W - seqTotalW) / 2 + i * TOKEN_STEP;
	}

	// Node rectangle sizing.
	const NODE_W = 22;
	const NODE_H = 22;
	const NODE_RX = 4;

	// Vertical layout — 4 rows of nodes stacked.
	const HEADER_Y = 24;
	const SUBHEADER_Y = 42;
	const WORD_Y = 74;
	const ROW_Y0 = 108; // top of first (bottom-most) node row — INPUT row
	const ROW_STEP = 78; // vertical distance between consecutive node rows

	// Row Y positions (top of rectangle). Rows are ordered bottom-up in
	// terms of computation flow but drawn top-down in Y: layer 0 (input)
	// is at the TOP of the SVG, layer 3 (final) is at the BOTTOM. This
	// matches AttentionPatternFigure's "input on top, output on bottom"
	// convention.
	const N_ROWS = N_LAYERS + 1; // 4 rows: input + 3 layer outputs
	function rowY(row: number): number {
		return ROW_Y0 + row * ROW_STEP;
	}
	function rowCY(row: number): number {
		return rowY(row) + NODE_H / 2;
	}
	const FINAL_ROW = N_ROWS - 1; // row 3, bottom-most node row

	// LHS bar-chart panel geometry (verbatim from ModelPredictionFigure).
	const BAR_ROW_H = 26;
	const BAR_LABEL_W = 72;
	const BAR_MAX_W = 210;
	const BAR_H = 18;
	const BAR_PROB_W = 40;
	const BAR_PANEL_INNER_W = BAR_LABEL_W + BAR_MAX_W + BAR_PROB_W + 16; // 338
	const BAR_HEADER_OFFSET = 22;
	// Bar chart sits below the final node row with a band for the
	// straight belief arrow.
	const ARC_BAND_H = 60;
	const BAR_Y_TOP = rowY(FINAL_ROW) + NODE_H + ARC_BAND_H + BAR_HEADER_OFFSET;
	const BAR_PANEL_HEADER_Y = BAR_Y_TOP - BAR_HEADER_OFFSET;

	const BAR_PANEL_X = (() => {
		const desired = slotXInPanel(0, TARGET) - BAR_PANEL_INNER_W / 2;
		const minX = LEFT_X + 4;
		const maxX = LEFT_X + PANEL_W - BAR_PANEL_INNER_W - 4;
		return Math.max(minX, Math.min(maxX, desired));
	})();

	// Font-size ladder.
	const panelHeaderSize = fontSize * (15 / 16);
	const barWordSize = fontSize * (14 / 16);
	const probNumSize = fontSize * (12 / 16);

	// SVG height. LHS ends at bar-panel bottom; RHS ends at final row's
	// bottom + a label margin.
	const BAR_PANEL_BOTTOM = BAR_Y_TOP + candidates.length * BAR_ROW_H + 6;
	const RHS_BOTTOM = rowY(FINAL_ROW) + NODE_H + 24;
	const H_INTRINSIC = Math.max(BAR_PANEL_BOTTOM, RHS_BOTTOM) + 14;

	// ----------------------------------------------------------------
	// Helpers
	// ----------------------------------------------------------------

	function smoothstep(x: number): number {
		const c = Math.max(0, Math.min(1, x));
		return c * c * (3 - 2 * c);
	}

	function phaseP(uStart: number, uEnd: number, uu: number): number {
		return Math.max(0, Math.min(1, (uu - uStart) / (uEnd - uStart)));
	}

	// Cubic-Bezier edge from (x1, y1) top → (x2, y2) bottom with control
	// points sharing the endpoint x-coords. Direct copy of
	// AttentionPatternFigure.svelte:207-221.
	function edgePath(x1: number, y1: number, x2: number, y2: number): string {
		if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
		const dy = y2 - y1;
		const t = 0.55;
		return `M ${x1} ${y1} C ${x1} ${y1 + dy * t}, ${x2} ${y2 - dy * t}, ${x2} ${y2}`;
	}

	function cubicPoint(
		s: number,
		x1: number,
		y1: number,
		x2: number,
		y2: number
	): { x: number; y: number } {
		const dy = y2 - y1;
		const t = 0.55;
		const c1x = x1;
		const c1y = y1 + dy * t;
		const c2x = x2;
		const c2y = y2 - dy * t;
		const mt = 1 - s;
		const x = mt * mt * mt * x1 + 3 * mt * mt * s * c1x + 3 * mt * s * s * c2x + s * s * s * x2;
		const y = mt * mt * mt * y1 + 3 * mt * mt * s * c1y + 3 * mt * s * s * c2y + s * s * s * y2;
		return { x, y };
	}

	const PULSE_LEN = 0.28;
	const PULSE_SAMPLES = 16;

	function pulsePath(
		head: number,
		x1: number,
		y1: number,
		x2: number,
		y2: number
	): string {
		const tail = Math.max(0, head - PULSE_LEN);
		const clampedHead = Math.min(1, head);
		if (clampedHead <= 0 || tail >= 1) return '';
		let d = '';
		for (let s = 0; s <= PULSE_SAMPLES; s++) {
			const sVal = tail + (clampedHead - tail) * (s / PULSE_SAMPLES);
			const p = cubicPoint(sVal, x1, y1, x2, y2);
			d += (s === 0 ? 'M ' : 'L ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ' ';
		}
		return d;
	}

	// ----------------------------------------------------------------
	// Setup — precomputed edge geometry
	// ----------------------------------------------------------------

	// All causal edges at layer L (0-indexed) connect row L (source, on
	// top) to row L+1 (destination, below). Source j attends TO
	// destination i iff j ≤ i (causal).
	interface Edge {
		layer: number; // 0..N_LAYERS-1
		src: number; // source column (row `layer`)
		dst: number; // destination column (row `layer+1`)
	}
	const allCausalEdges: Edge[] = (() => {
		const out: Edge[] = [];
		for (let L = 0; L < N_LAYERS; L++) {
			for (let i = 0; i < N; i++) {
				for (let j = 0; j <= i; j++) {
					out.push({ layer: L, src: j, dst: i });
				}
			}
		}
		return out;
	})();

	function edgeSrcPoint(panel: number, e: Edge): { x: number; y: number } {
		return { x: slotXInPanel(panel, e.src), y: rowY(e.layer) + NODE_H };
	}
	function edgeDstPoint(panel: number, e: Edge): { x: number; y: number } {
		return { x: slotXInPanel(panel, e.dst), y: rowY(e.layer + 1) };
	}

	// LHS belief-role highlighted edges at each layer: edges INTO column 3
	// (dst === TARGET). One edge per source j ≤ TARGET, per layer.
	const beliefLitEdges: Edge[] = allCausalEdges.filter((e) => e.dst === TARGET);

	// RHS content-role highlighted edges at each layer: edges FROM column 3
	// (src === TARGET) TO future query columns (dst ∈ RHS_QUERIES). Only
	// those specific arcs — not all outgoing edges from column 3.
	const contentLitEdges: Edge[] = allCausalEdges.filter(
		(e) => e.src === TARGET && RHS_QUERIES.includes(e.dst)
	);

	// LHS belief arrow: a single straight arrow from the target column's
	// final-row node bottom down to the top of the bar-chart panel
	// header (this is the "read this hidden state as logits" arrow).
	const beliefArrow = (() => {
		const x = slotXInPanel(0, TARGET);
		const y0 = rowY(FINAL_ROW) + NODE_H + 4;
		const y1 = BAR_PANEL_HEADER_Y - 18;
		return { x, y0, y1 };
	})();

	// ----------------------------------------------------------------
	// Animations
	// ----------------------------------------------------------------

	const LOOP_MS = 1800;
	function buildTimeline() {
		return new TimelineBuilder<{ u: number }>()
			.setInitialState({ u: 0 })
			.add({ name: 'loop', reduce: (t: number) => ({ u: t }) }, { durationMs: LOOP_MS })
			.build();
	}

	// ----------------------------------------------------------------
	// Lifecycle
	// ----------------------------------------------------------------

	onMount(() => {
		player = new Player<{ u: number }>(buildTimeline(), { looping: true, endPause: 0 });
		player.onTick((_t, s) => {
			u = s.u;
		});
		const unsubActive = isActive?.subscribe((v) => {
			if (!player) return;
			if (v) {
				player.play();
			} else {
				player.pause();
				player.reset();
				u = 0;
			}
		});
		return () => {
			unsubActive?.();
			player?.dispose();
		};
	});

	// ----------------------------------------------------------------
	// Reactive Blocks — pulse heads
	// ----------------------------------------------------------------

	function pulseHead(phase: number): number {
		const w = (u + phase) % 1;
		return w * (1 + PULSE_LEN);
	}

	// Belief layer pulses: one pulse per lit edge, staggered by layer so
	// L1 fires first, then L2, then L3. Within a layer, the edges from
	// different source columns fire together (they're "the layer's
	// aggregation into column 3").
	const beliefLayerHeads = $derived(
		Array.from({ length: N_LAYERS }, (_, L) => pulseHead(L / (N_LAYERS + 1)))
	);

	// Belief arrow pulse: fires after the final layer pulse.
	const beliefArrowHead = $derived(pulseHead(N_LAYERS / (N_LAYERS + 1)));

	// Content layer pulses: one pulse per lit edge (each layer × each
	// future query). Stagger by (layer, query) so they fan out layer by
	// layer, but all queries at a given layer fire close together.
	const contentHeads = $derived(
		contentLitEdges.map((e) => {
			const layerFraction = e.layer / N_LAYERS;
			const queryOffset = RHS_QUERIES.indexOf(e.dst) * 0.03;
			return pulseHead(layerFraction + queryOffset);
		})
	);

	// Argmax flash — peaks as the belief arrow's pulse lands.
	const argmaxFlashP = $derived(smoothstep(phaseP(0.85, 1.0, beliefArrowHead)));

	// Bar-panel opacity — fade in gradually so the panel appears just
	// before the belief bar pulses start arriving.
	const barPanelOpacity = $derived(smoothstep(phaseP(0.05, 0.3, u)));
</script>

<div class="wrap" style="max-width: {width}px;">
	<svg
		viewBox={`0 0 ${W} ${H_INTRINSIC}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Two-panel figure. Both panels show 4 rows of hidden-state nodes for a 7-token sentence connected by causal-attention curved arcs across 3 layers. Left panel (Belief role) highlights all incoming arcs into column 3 at each layer, then fans column 3's final hidden state to a bar chart of next-token probabilities; the argmax (sat) flashes. Right panel (Content role) highlights the outgoing arcs from column 3 to future queries at columns 4, 5, and 6 at every layer."
	>
		{#each [{ x: LEFT_X, title: 'Belief', subtitle: 'read down as a distribution over the next token', panelIdx: 0 }, { x: RIGHT_X, title: 'Content', subtitle: 'read across as context by every future query', panelIdx: 1 }] as panel}
			<!-- ============================================================ -->
			<!-- Panel headers                                                -->
			<!-- ============================================================ -->
			<text
				x={panel.x + PANEL_W / 2}
				y={HEADER_Y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="15"
				font-weight="600"
				fill={HEADER_COLOR}
			>
				{panel.title} role
			</text>
			<text
				x={panel.x + PANEL_W / 2}
				y={SUBHEADER_Y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="12"
				fill={SUBHEADER_COLOR}
			>
				{panel.subtitle}
			</text>

			<!-- ============================================================ -->
			<!-- Token labels (only above the TOP row of nodes, row 0)        -->
			<!-- ============================================================ -->
			{#each tokens as tok, i}
				{@const cx = slotXInPanel(panel.panelIdx, i)}
				{@const isTarget = i === TARGET}
				{@const isCommitted = i < COMMITTED}
				{#if isCommitted}
					<text
						x={cx}
						y={WORD_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={fontSize}
						fill={TEXT_COLOR}
					>
						{tok}
					</text>
				{:else if isTarget}
					<text
						x={cx}
						y={WORD_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={fontSize}
						font-style="italic"
						fill={ACCENT}
					>
						x₃?
					</text>
				{:else}
					<text
						x={cx}
						y={WORD_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={fontSize}
						fill={MUTED}
					>
						{tok}
					</text>
				{/if}
			{/each}

			<!-- ============================================================ -->
			<!-- FAINT causal edges: all valid (i≤j) edges, all layers        -->
			<!-- Drawn FIRST so they sit behind nodes and lit pulses.         -->
			<!-- ============================================================ -->
			{#each allCausalEdges as e}
				{@const src = edgeSrcPoint(panel.panelIdx, e)}
				{@const dst = edgeDstPoint(panel.panelIdx, e)}
				<path
					d={edgePath(src.x, src.y, dst.x, dst.y)}
					fill="none"
					stroke={MUTED}
					stroke-width="1.2"
					opacity="0.4"
				/>
			{/each}

			<!-- ============================================================ -->
			<!-- Node rectangles: 4 rows × 7 columns                          -->
			<!-- ============================================================ -->
			{#each Array(N_ROWS) as _, row}
				{#each tokens as _tok, i}
					{@const cx = slotXInPanel(panel.panelIdx, i)}
					{@const isTarget = i === TARGET}
					{@const isCommitted = i < COMMITTED}
					<rect
						x={cx - NODE_W / 2}
						y={rowY(row)}
						width={NODE_W}
						height={NODE_H}
						rx={NODE_RX}
						ry={NODE_RX}
						fill={isTarget || isCommitted ? NODE_FILL : FADED_NODE_FILL}
						stroke={isTarget ? ACTIVE_STROKE : isCommitted ? NODE_STROKE_DEFAULT : FADED_NODE_STROKE}
						stroke-width={isTarget ? 2 : 1}
					/>
				{/each}
			{/each}

			<!-- ============================================================ -->
			<!-- LHS ONLY: bar-chart panel below the arc band                 -->
			<!-- ============================================================ -->
			{#if panel.panelIdx === 0}
				<g opacity={barPanelOpacity}>
					<text
						x={BAR_PANEL_X + BAR_PANEL_INNER_W / 2}
						y={BAR_PANEL_HEADER_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={panelHeaderSize}
						letter-spacing="0.05em"
						font-weight="600"
						fill={BAR_MUTED}
					>
						PROBABILITIES
					</text>
					{#each candidates as row, r}
						{@const barRowY = BAR_Y_TOP + r * BAR_ROW_H}
						{@const isArgmax = r === ARGMAX_INDEX}
						{@const flash = isArgmax ? argmaxFlashP : 0}
						{@const grow = 1 + 0.1 * flash}
						{@const barW = row.p * BAR_MAX_W * grow}
						{@const barX = BAR_PANEL_X + BAR_LABEL_W}
						{@const numFitsInside = barW >= 32}
						<text
							x={BAR_PANEL_X + BAR_LABEL_W - 6}
							y={barRowY + BAR_ROW_H / 2}
							text-anchor="end"
							dominant-baseline="central"
							font-size={barWordSize}
							fill={flash > 0 ? ACCENT : TEXT_COLOR}
							font-weight={flash > 0 ? '600' : '400'}
						>
							{row.word}
						</text>
						<rect
							x={barX}
							y={barRowY + BAR_ROW_H / 2 - (BAR_H * grow) / 2}
							width={barW}
							height={BAR_H * grow}
							rx={3}
							ry={3}
							fill={flash > 0 ? ACCENT : BAR_COLOR}
							opacity={flash > 0 ? 0.75 + 0.2 * flash : 0.75}
						/>
						{#if numFitsInside}
							<text
								x={barX + barW - 6}
								y={barRowY + BAR_ROW_H / 2}
								text-anchor="end"
								dominant-baseline="central"
								font-size={probNumSize}
								fill="#fff"
								font-weight="600"
							>
								{row.p.toFixed(2)}
							</text>
						{:else}
							<text
								x={barX + barW + 4}
								y={barRowY + BAR_ROW_H / 2}
								text-anchor="start"
								dominant-baseline="central"
								font-size={probNumSize}
								fill={BAR_MUTED}
							>
								{row.p.toFixed(2)}
							</text>
						{/if}
					{/each}
				</g>
			{/if}
		{/each}

		<!-- ============================================================ -->
		<!-- LHS: lit belief edges (into column 3, all layers) + pulses    -->
		<!-- ============================================================ -->
		{#each beliefLitEdges as e}
			{@const src = edgeSrcPoint(0, e)}
			{@const dst = edgeDstPoint(0, e)}
			<path
				d={edgePath(src.x, src.y, dst.x, dst.y)}
				fill="none"
				stroke={ACCENT}
				stroke-width="1.6"
				opacity="0.35"
			/>
		{/each}
		{#each beliefLitEdges as e}
			{@const src = edgeSrcPoint(0, e)}
			{@const dst = edgeDstPoint(0, e)}
			{@const head = beliefLayerHeads[e.layer]}
			{#if head > 0 && head - PULSE_LEN < 1}
				<path
					d={pulsePath(head, src.x, src.y, dst.x, dst.y)}
					fill="none"
					stroke={ACCENT}
					stroke-width="2.4"
					stroke-linecap="round"
					opacity="0.95"
				/>
			{/if}
		{/each}

		<!-- ============================================================ -->
		<!-- LHS: straight arrow from final target node → bar panel        -->
		<!-- ============================================================ -->
		<defs>
			<marker
				id="dr-belief-arrowhead"
				viewBox="0 -5 10 10"
				refX="8"
				refY="0"
				markerWidth="6"
				markerHeight="6"
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={ACCENT} />
			</marker>
		</defs>
		<line
			x1={beliefArrow.x}
			y1={beliefArrow.y0}
			x2={beliefArrow.x}
			y2={beliefArrow.y1}
			stroke={ACCENT}
			stroke-width="2"
			opacity={0.85 * barPanelOpacity}
			marker-end="url(#dr-belief-arrowhead)"
		/>

		<!-- ============================================================ -->
		<!-- RHS: lit content edges (out of column 3 → future queries)    -->
		<!-- ============================================================ -->
		{#each contentLitEdges as e}
			{@const src = edgeSrcPoint(1, e)}
			{@const dst = edgeDstPoint(1, e)}
			<path
				d={edgePath(src.x, src.y, dst.x, dst.y)}
				fill="none"
				stroke={ACCENT}
				stroke-width="1.6"
				opacity="0.35"
			/>
		{/each}
		{#each contentLitEdges as e, idx}
			{@const src = edgeSrcPoint(1, e)}
			{@const dst = edgeDstPoint(1, e)}
			{@const head = contentHeads[idx]}
			{#if head > 0 && head - PULSE_LEN < 1}
				<path
					d={pulsePath(head, src.x, src.y, dst.x, dst.y)}
					fill="none"
					stroke={ACCENT}
					stroke-width="2.4"
					stroke-linecap="round"
					opacity="0.95"
				/>
			{/if}
		{/each}
	</svg>
</div>

<style>
	.wrap {
		width: 100%;
		margin: 0 auto;
		position: relative;
	}
	.wrap > svg {
		width: 100%;
		height: auto;
		display: block;
		margin: 0 auto;
	}
</style>
