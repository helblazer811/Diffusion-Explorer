<script lang="ts">
	// Dual-Role Hidden States figure.
	//
	// Two side-by-side mini transformers (6 token positions × 2 attention
	// layers) at two different moments in autoregressive decoding, both
	// zooming in on the same target position (p=3):
	//
	//   LHS — "belief" role. The model is currently predicting x₃. The
	//         top-of-column-3 hidden state (penultimate embedding) is
	//         highlighted; pulses flow UP through Unembedding into the
	//         Output row's slot 3, showing that the state at position 3
	//         is being read as logits over the next token.
	//
	//   RHS — "content" role. The model has advanced and is now predicting
	//         x₅. The K and V slots at column 3, at BOTH attention layers,
	//         are highlighted; pulses arc RIGHT to the column-5 query at
	//         that layer, showing that the same hidden state at position
	//         3 is now being read as durable context by every later query.
	//
	// The point of the pair: the same hidden state serves two roles with
	// wildly different lifetimes. Belief lives one decode step; content
	// lives for the rest of the sequence. The KV cache freezes both.
	//
	// Primitives: transformer-stack colors and shapes are ported from
	// KVCacheFigure; pulse-along-arc helpers are the same as in
	// CausalLanguageModelingFigure / InformationFlowFigure.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { PlayPauseResetButton } from '@diffusion-explorer/ui';

	interface Props {
		isActive?: Writable<boolean>;
		width?: number;
	}

	let { isActive, width = 820 }: Props = $props();

	// --- Palette (subset of KVCacheFigure) ---
	const TEXT_COLOR = '#5a5a5a';
	const MUTED = '#8892a0';
	const BLOCK_LABEL_COLOR = '#5a5a5a';
	const TX_FILL = '#f4f6fa';
	const TX_STROKE = '#c8ccd1';
	const TOKEN_FILL = '#3879EF';
	const TOKEN_STROKE = '#1F55B5';
	const FADED_TOKEN_FILL = '#dfe5ee';
	const FADED_TOKEN_STROKE = '#b7c1cd';
	const ACTIVE_FILL = '#FBD3A3';
	const ACTIVE_STROKE = '#F1942B';
	const K_FILL = '#4AD77A';
	const V_FILL = '#EF6AAC';
	const KV_STROKE = '#8892a0';
	const FADED_K_FILL = '#c9ecd2';
	const FADED_V_FILL = '#f5cddf';

	// --- Content ---
	const tokens = ['the', 'cat', 'sat', 'on', 'the', 'mat'];
	const N = tokens.length;
	const TARGET = 3; // "the same hidden state at position 3 plays two roles"
	const RHS_QUERY = 5; // later query on RHS that reads back to col 3
	const N_LAYERS = 2;

	// LHS reveals prefix up through TARGET-1 (positions 0..2 committed;
	// position 3 is the slot being predicted; 4,5 not yet reached).
	const LHS_COMMITTED = TARGET; // count of committed tokens
	// RHS reveals prefix up through RHS_QUERY-1 (positions 0..4 committed;
	// position 5 is the query slot being predicted).
	const RHS_COMMITTED = RHS_QUERY;

	// --- Panel geometry ---
	// Each panel is a mini transformer stack, rendered top-to-bottom:
	//   Output tokens row
	//   Unembedding block
	//   Residual row (top of stack, layer-2 output)
	//   Attention Layer 2 block
	//   K/V row L2
	//   Residual row (between layers)
	//   Attention Layer 1 block
	//   K/V row L1
	//   Residual row (embed output)
	//   Embedding block
	//   Input tokens row
	const TOKEN_STEP = 46;
	const CELL_SIZE = 20;
	const KV_HALF_H = 16;
	const KV_W = 22;
	const BLOCK_H = 30;
	const ROW_GAP = 10;
	const HEADER_H = 46;

	// Rows keyed top-to-bottom.
	const rowLabels = {
		OUTPUT: 'output',
		UNEMBED: 'unembed',
		RES_TOP: 'res_top',
		L2: 'layer2',
		KV2: 'kv2',
		RES_MID: 'res_mid',
		L1: 'layer1',
		KV1: 'kv1',
		RES_BOT: 'res_bot',
		EMBED: 'embed',
		INPUT: 'input'
	} as const;

	// Per-row heights.
	const heightOf: Record<string, number> = {
		[rowLabels.OUTPUT]: 24,
		[rowLabels.UNEMBED]: BLOCK_H,
		[rowLabels.RES_TOP]: CELL_SIZE,
		[rowLabels.L2]: BLOCK_H,
		[rowLabels.KV2]: KV_HALF_H * 2,
		[rowLabels.RES_MID]: CELL_SIZE,
		[rowLabels.L1]: BLOCK_H,
		[rowLabels.KV1]: KV_HALF_H * 2,
		[rowLabels.RES_BOT]: CELL_SIZE,
		[rowLabels.EMBED]: BLOCK_H,
		[rowLabels.INPUT]: 24
	};

	// Compute cumulative top-Y per row.
	const stackOrder = [
		rowLabels.OUTPUT,
		rowLabels.UNEMBED,
		rowLabels.RES_TOP,
		rowLabels.L2,
		rowLabels.KV2,
		rowLabels.RES_MID,
		rowLabels.L1,
		rowLabels.KV1,
		rowLabels.RES_BOT,
		rowLabels.EMBED,
		rowLabels.INPUT
	];

	const PANEL_TOP_PAD = 6;
	const PANEL_PAD_X = 14;
	const panelInnerW = TOKEN_STEP * N;

	// yTop of each row, computed from PANEL_TOP_PAD + HEADER_H down.
	const rowTop: Record<string, number> = (() => {
		const out: Record<string, number> = {};
		let y = PANEL_TOP_PAD + HEADER_H;
		for (const key of stackOrder) {
			out[key] = y;
			y += heightOf[key] + ROW_GAP;
		}
		return out;
	})();
	const stackBottom =
		rowTop[rowLabels.INPUT] + heightOf[rowLabels.INPUT];

	const PANEL_W = panelInnerW + PANEL_PAD_X * 2;
	const PANEL_H = stackBottom + 14;

	const COL_GAP = 28;
	const OUTER_PAD_X = 10;
	const W_INTRINSIC = PANEL_W * 2 + COL_GAP + OUTER_PAD_X * 2;
	const H = PANEL_H + 30;

	const LEFT_X = OUTER_PAD_X;
	const RIGHT_X = OUTER_PAD_X + PANEL_W + COL_GAP;

	// Column x-center inside a panel (0-indexed).
	function colXInPanel(j: number): number {
		return PANEL_PAD_X + j * TOKEN_STEP + TOKEN_STEP / 2;
	}
	function cellLeftInPanel(j: number): number {
		return colXInPanel(j) - CELL_SIZE / 2;
	}
	function kvLeftInPanel(j: number): number {
		return colXInPanel(j) - KV_W / 2;
	}

	// Y-centers per row.
	function rowCenterY(key: string): number {
		return rowTop[key] + heightOf[key] / 2;
	}

	// --- Palette helpers ---
	function residualFill(committed: boolean, isTarget: boolean): string {
		if (isTarget) return ACTIVE_FILL;
		return committed ? TOKEN_FILL : FADED_TOKEN_FILL;
	}
	function residualStroke(committed: boolean, isTarget: boolean): string {
		if (isTarget) return ACTIVE_STROKE;
		return committed ? TOKEN_STROKE : FADED_TOKEN_STROKE;
	}
	function kvFillPair(committed: boolean, isTarget: boolean): { k: string; v: string; stroke: string } {
		if (isTarget) return { k: K_FILL, v: V_FILL, stroke: ACTIVE_STROKE };
		if (!committed) return { k: FADED_K_FILL, v: FADED_V_FILL, stroke: KV_STROKE };
		return { k: K_FILL, v: V_FILL, stroke: KV_STROKE };
	}

	// --- Pulse-along-arc (adapted from CausalLanguageModelingFigure) ---
	const PULSE_LEN = 0.28;
	const PULSE_SAMPLES = 14;

	function bezier(
		t: number,
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		x2: number,
		y2: number
	): { x: number; y: number } {
		const mt = 1 - t;
		return {
			x: mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
			y: mt * mt * y0 + 2 * mt * t * y1 + t * t * y2
		};
	}

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
		const clampedHead = Math.min(1, head);
		if (clampedHead <= 0 || tail >= 1) return '';
		let d = '';
		for (let s = 0; s <= PULSE_SAMPLES; s++) {
			const t = tail + (clampedHead - tail) * (s / PULSE_SAMPLES);
			const p = bezier(t, x0, y0, x1, y1, x2, y2);
			d += (s === 0 ? 'M ' : 'L ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ' ';
		}
		return d;
	}

	function pulseHead(phase: number): number {
		const w = (u + phase) % 1;
		return w * (1 + PULSE_LEN);
	}

	// Reactive belief-pulse head so we can reference it at SVG top level
	// (Svelte 5 disallows {@const} outside of block-scoped children).
	const lhsHead = $derived(pulseHead(0));

	// --- Animation state ---
	let u = $state(0);
	let player = $state<Player<{ u: number }> | undefined>(undefined);
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

	const LOOP_MS = 2400;
	function buildTimeline() {
		return new TimelineBuilder<{ u: number }>()
			.setInitialState({ u: 0 })
			.add({ name: 'loop', reduce: (t: number) => ({ u: t }) }, { durationMs: LOOP_MS })
			.build();
	}

	onMount(() => {
		player = new Player<{ u: number }>(buildTimeline(), { looping: true, endPause: 0 });
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

	// --- LHS belief-arrow geometry ---
	// The belief arrow rises straight up from the top-of-col-TARGET residual
	// cell, through the Unembedding block, into the Output row's slot at
	// column TARGET. A quadratic Bezier with a horizontally-centered
	// control point gives a very slight bow so the pulse reads as
	// motion; the source and target are vertically aligned.
	const lhsBeliefArrow = (() => {
		const px = LEFT_X + colXInPanel(TARGET);
		const y0 = rowTop[rowLabels.RES_TOP]; // top edge of the top residual cell
		const y2 = rowTop[rowLabels.OUTPUT] + heightOf[rowLabels.OUTPUT] / 2 + 2; // near output-row center
		const y1 = (y0 + y2) / 2;
		return { x0: px, y0, x1: px, y1, x2: px, y2 };
	})();

	// --- RHS content-arrow geometry ---
	// One arc per (layer × K or V) — 4 arcs total. Each arc launches from a
	// K/V cell at column TARGET and lands at the column RHS_QUERY residual
	// cell at that same layer (approximating "K/V of column 3 is read by
	// the query at column 5 within the attention op at that layer").
	interface ContentArc {
		x0: number;
		y0: number;
		x1: number;
		y1: number;
		x2: number;
		y2: number;
		phase: number;
	}
	function buildContentArcs(): ContentArc[] {
		const arcs: ContentArc[] = [];
		const layerKvRows = [rowLabels.KV1, rowLabels.KV2];
		let idx = 0;
		const total = layerKvRows.length * 2; // K + V per layer
		for (const kvRow of layerKvRows) {
			const kvTop = rowTop[kvRow];
			const kSrcY = kvTop + KV_HALF_H / 2; // K half center
			const vSrcY = kvTop + KV_HALF_H + KV_HALF_H / 2; // V half center
			const srcX = RIGHT_X + colXInPanel(TARGET);
			const tgtX = RIGHT_X + colXInPanel(RHS_QUERY);
			// Target y: center of the query column's residual cell at this
			// layer's output — use the residual row immediately ABOVE this
			// KV row (which is the block that consumed this KV). For KV1,
			// the consuming residual is RES_MID; for KV2, it's RES_TOP.
			const resRow = kvRow === rowLabels.KV1 ? rowLabels.RES_MID : rowLabels.RES_TOP;
			const tgtY = rowCenterY(resRow);
			// Peak: bow upward (smaller y) between src and tgt.
			const midX = (srcX + tgtX) / 2;
			for (const srcY of [kSrcY, vSrcY]) {
				const dx = tgtX - srcX;
				const peakY = Math.min(srcY, tgtY) - Math.min(24, 8 + dx * 0.12);
				arcs.push({
					x0: srcX + KV_W / 2 - 2, // launch from right edge of the K/V cell
					y0: srcY,
					x1: midX,
					y1: peakY,
					x2: tgtX,
					y2: tgtY,
					phase: idx / total
				});
				idx++;
			}
		}
		return arcs;
	}
	const contentArcs = buildContentArcs();

	function guideD(a: { x0: number; y0: number; x1: number; y1: number; x2: number; y2: number }): string {
		return `M ${a.x0} ${a.y0} Q ${a.x1} ${a.y1}, ${a.x2} ${a.y2}`;
	}
</script>

<div class="wrap" style="max-width: {width}px;">
	<div class="controls">
		<PlayPauseResetButton
			{isPlaying}
			time={u}
			onclick={() => (isPlaying ? pause() : play())}
			onreset={reset}
		/>
	</div>
	<svg
		viewBox={`0 0 ${W_INTRINSIC} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Two mini transformer stacks side by side. Left panel highlights the top-of-column-3 hidden state feeding the unembedding to produce logits for x3 (the belief role). Right panel highlights the K and V cache slots at column 3 for both attention layers, with pulses arcing right to the column-5 query (the content role)."
	>
		{#each [{ x: LEFT_X, title: 'Belief', subtitle: "encodes uncertainty about x₃", committed: LHS_COMMITTED, target: TARGET, targetIsFuture: true }, { x: RIGHT_X, title: 'Content', subtitle: "encodes semantics of x₃ for later queries", committed: RHS_COMMITTED, target: RHS_QUERY, targetIsFuture: true }] as panel, panelIdx}
			<!-- Header -->
			<text
				x={panel.x + PANEL_W / 2}
				y={PANEL_TOP_PAD + 16}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="15"
				font-weight="600"
				fill={BLOCK_LABEL_COLOR}
			>
				{panel.title} role
			</text>
			<text
				x={panel.x + PANEL_W / 2}
				y={PANEL_TOP_PAD + 34}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="12"
				fill={MUTED}
			>
				{panel.subtitle}
			</text>

			<!-- Output tokens row: only the target slot's committed prediction
			     is drawn; others are blank. The current target slot renders as
			     a dashed underline placeholder (the slot being predicted). -->
			{#each tokens as tok, j}
				{@const cx = panel.x + colXInPanel(j)}
				{@const yc = rowCenterY(rowLabels.OUTPUT)}
				{#if j === panel.target}
					<!-- Dashed underline placeholder for the slot being predicted -->
					<line
						x1={cx - CELL_SIZE / 2 + 2}
						y1={yc + 8}
						x2={cx + CELL_SIZE / 2 - 2}
						y2={yc + 8}
						stroke="#c8c8c8"
						stroke-width="1"
						stroke-dasharray="3 3"
					/>
				{/if}
			{/each}

			<!-- Unembedding block: highlighted on the belief-role panel because
			     that's what reads the top hidden state into logits. -->
			{@const unembedActive = panelIdx === 0}
			<rect
				x={panel.x + PANEL_PAD_X}
				y={rowTop[rowLabels.UNEMBED]}
				width={panelInnerW}
				height={heightOf[rowLabels.UNEMBED]}
				rx={6}
				ry={6}
				fill={TX_FILL}
				stroke={unembedActive ? ACTIVE_STROKE : TX_STROKE}
				stroke-width={unembedActive ? 1.4 : 1}
				class:active-layer-outline={unembedActive}
			/>
			<text
				x={panel.x + PANEL_W / 2}
				y={rowCenterY(rowLabels.UNEMBED)}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="12"
				font-weight="500"
				fill={unembedActive ? ACTIVE_STROKE : BLOCK_LABEL_COLOR}
			>
				Unembedding
			</text>

			<!-- Top residual row: highlight target on belief panel, faded on content panel. -->
			{#each tokens as _tok, j}
				{@const committed = j < panel.committed}
				{@const isTargetBelief = panelIdx === 0 && j === TARGET}
				{@const cx = panel.x + colXInPanel(j)}
				<rect
					x={cx - CELL_SIZE / 2}
					y={rowTop[rowLabels.RES_TOP]}
					width={CELL_SIZE}
					height={CELL_SIZE}
					rx={4}
					ry={4}
					fill={residualFill(committed, isTargetBelief)}
					stroke={residualStroke(committed, isTargetBelief)}
					stroke-width={isTargetBelief ? 1.5 : 1}
					class:active-layer-outline={isTargetBelief}
				/>
			{/each}

			<!-- Attention Layer 2 block -->
			<rect
				x={panel.x + PANEL_PAD_X}
				y={rowTop[rowLabels.L2]}
				width={panelInnerW}
				height={heightOf[rowLabels.L2]}
				rx={6}
				ry={6}
				fill={TX_FILL}
				stroke={TX_STROKE}
				stroke-width={1}
			/>
			<text
				x={panel.x + PANEL_W / 2}
				y={rowCenterY(rowLabels.L2)}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="12"
				font-weight="500"
				fill={BLOCK_LABEL_COLOR}
			>
				Attention Layer 2
			</text>

			<!-- K/V row for Layer 2 — highlight target column on content panel. -->
			{#each tokens as _tok, j}
				{@const committed = j < panel.committed}
				{@const isTargetContent = panelIdx === 1 && j === TARGET}
				{@const kvX = panel.x + kvLeftInPanel(j)}
				{@const kvY = rowTop[rowLabels.KV2]}
				{@const pair = kvFillPair(committed, isTargetContent)}
				{#if committed || isTargetContent}
					<rect
						x={kvX}
						y={kvY}
						width={KV_W}
						height={KV_HALF_H}
						rx={2}
						ry={2}
						fill={pair.k}
						stroke={pair.stroke}
						stroke-width={isTargetContent ? 1.5 : 0.75}
						class:active-layer-outline={isTargetContent}
					/>
					<rect
						x={kvX}
						y={kvY + KV_HALF_H}
						width={KV_W}
						height={KV_HALF_H}
						rx={2}
						ry={2}
						fill={pair.v}
						stroke={pair.stroke}
						stroke-width={isTargetContent ? 1.5 : 0.75}
						class:active-layer-outline={isTargetContent}
					/>
				{/if}
			{/each}

			<!-- Mid residual row -->
			{#each tokens as _tok, j}
				{@const committed = j < panel.committed}
				{@const cx = panel.x + colXInPanel(j)}
				<rect
					x={cx - CELL_SIZE / 2}
					y={rowTop[rowLabels.RES_MID]}
					width={CELL_SIZE}
					height={CELL_SIZE}
					rx={4}
					ry={4}
					fill={residualFill(committed, false)}
					stroke={residualStroke(committed, false)}
					stroke-width={1}
				/>
			{/each}

			<!-- Attention Layer 1 block -->
			<rect
				x={panel.x + PANEL_PAD_X}
				y={rowTop[rowLabels.L1]}
				width={panelInnerW}
				height={heightOf[rowLabels.L1]}
				rx={6}
				ry={6}
				fill={TX_FILL}
				stroke={TX_STROKE}
				stroke-width={1}
			/>
			<text
				x={panel.x + PANEL_W / 2}
				y={rowCenterY(rowLabels.L1)}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="12"
				font-weight="500"
				fill={BLOCK_LABEL_COLOR}
			>
				Attention Layer 1
			</text>

			<!-- K/V row for Layer 1 -->
			{#each tokens as _tok, j}
				{@const committed = j < panel.committed}
				{@const isTargetContent = panelIdx === 1 && j === TARGET}
				{@const kvX = panel.x + kvLeftInPanel(j)}
				{@const kvY = rowTop[rowLabels.KV1]}
				{@const pair = kvFillPair(committed, isTargetContent)}
				{#if committed || isTargetContent}
					<rect
						x={kvX}
						y={kvY}
						width={KV_W}
						height={KV_HALF_H}
						rx={2}
						ry={2}
						fill={pair.k}
						stroke={pair.stroke}
						stroke-width={isTargetContent ? 1.5 : 0.75}
						class:active-layer-outline={isTargetContent}
					/>
					<rect
						x={kvX}
						y={kvY + KV_HALF_H}
						width={KV_W}
						height={KV_HALF_H}
						rx={2}
						ry={2}
						fill={pair.v}
						stroke={pair.stroke}
						stroke-width={isTargetContent ? 1.5 : 0.75}
						class:active-layer-outline={isTargetContent}
					/>
				{/if}
			{/each}

			<!-- Bottom residual row (embedding output) -->
			{#each tokens as _tok, j}
				{@const committed = j < panel.committed}
				{@const cx = panel.x + colXInPanel(j)}
				<rect
					x={cx - CELL_SIZE / 2}
					y={rowTop[rowLabels.RES_BOT]}
					width={CELL_SIZE}
					height={CELL_SIZE}
					rx={4}
					ry={4}
					fill={residualFill(committed, false)}
					stroke={residualStroke(committed, false)}
					stroke-width={1}
				/>
			{/each}

			<!-- Embedding block -->
			<rect
				x={panel.x + PANEL_PAD_X}
				y={rowTop[rowLabels.EMBED]}
				width={panelInnerW}
				height={heightOf[rowLabels.EMBED]}
				rx={6}
				ry={6}
				fill={TX_FILL}
				stroke={TX_STROKE}
				stroke-width={1}
			/>
			<text
				x={panel.x + PANEL_W / 2}
				y={rowCenterY(rowLabels.EMBED)}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="12"
				font-weight="500"
				fill={BLOCK_LABEL_COLOR}
			>
				Embedding
			</text>

			<!-- Input tokens row -->
			{#each tokens as tok, j}
				{@const committed = j < panel.committed}
				{@const cx = panel.x + colXInPanel(j)}
				{@const yc = rowCenterY(rowLabels.INPUT)}
				{#if committed}
					<text
						x={cx}
						y={yc}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="12"
						fill={TEXT_COLOR}
					>
						{tok}
					</text>
				{:else}
					<line
						x1={cx - CELL_SIZE / 2 + 2}
						y1={yc + 8}
						x2={cx + CELL_SIZE / 2 - 2}
						y2={yc + 8}
						stroke="#dcdcdc"
						stroke-width="1"
						stroke-dasharray="3 3"
					/>
				{/if}
			{/each}
		{/each}

		<!-- ============================================================ -->
		<!-- LHS belief arrow: top-of-col-3 → unembedding → output slot 3 -->
		<!-- ============================================================ -->
		<path
			d={guideD(lhsBeliefArrow)}
			fill="none"
			stroke={MUTED}
			stroke-width="1"
			opacity={0.35}
		/>
		{#if lhsHead > 0 && lhsHead - PULSE_LEN < 1}
			<path
				d={pulsePath(
					lhsHead,
					lhsBeliefArrow.x0,
					lhsBeliefArrow.y0,
					lhsBeliefArrow.x1,
					lhsBeliefArrow.y1,
					lhsBeliefArrow.x2,
					lhsBeliefArrow.y2
				)}
				fill="none"
				stroke={ACTIVE_STROKE}
				stroke-width="2.2"
				stroke-linecap="round"
				opacity={0.95}
			/>
		{/if}

		<!-- ============================================================ -->
		<!-- RHS content arcs: K/V of col-3 at each layer → col-5 query   -->
		<!-- ============================================================ -->
		{#each contentArcs as a}
			<path d={guideD(a)} fill="none" stroke={MUTED} stroke-width="1" opacity={0.32} />
		{/each}
		{#each contentArcs as a}
			{@const head = pulseHead(a.phase)}
			{#if head > 0 && head - PULSE_LEN < 1}
				<path
					d={pulsePath(head, a.x0, a.y0, a.x1, a.y1, a.x2, a.y2)}
					fill="none"
					stroke={ACTIVE_STROKE}
					stroke-width="2"
					stroke-linecap="round"
					opacity={0.95}
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
	.controls {
		position: absolute;
		top: 0;
		left: 0;
	}
	.wrap > svg {
		width: 100%;
		height: auto;
		display: block;
		margin: 0 auto;
	}
	.active-layer-outline {
		stroke-dasharray: 6 6;
		animation: marching-ants 0.6s linear infinite;
	}
	@keyframes marching-ants {
		from {
			stroke-dashoffset: 0;
		}
		to {
			stroke-dashoffset: -12;
		}
	}
</style>
