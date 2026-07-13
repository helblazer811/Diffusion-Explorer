<script lang="ts">
	// KV cache systems figure — prefill → decode animation.
	//
	// Two-column composition:
	//   LHS: "High Bandwidth Memory" box containing one KV cache per layer.
	//   RHS: text prompt at top, Embedding block, then N_LAYERS attention
	//        layers with residual-stream token rows between them, then
	//        Unembedding and an Output Tokens row.
	//
	// Column / slot semantics (causal-LM shift by one):
	//   The transformer's INPUT COLUMNS run 0..N_INPUT_COLS-1 (= N_TOKENS-1).
	//   Column c holds the residual for the token at TEXT SLOT c, and its
	//   unembed produces the logits for TEXT SLOT c+1. So the last text
	//   slot has no corresponding input column — nothing after it needs
	//   predicting. There is no explicit "<next>" placeholder token fed in.
	//
	// Animation (continuous loop):
	//   Prefill: prompt tokens flow through Embed and each attention layer
	//     in parallel across all prompt columns (0..N_PROMPT-1); K/V pairs
	//     populate every cache column simultaneously per layer.
	//   Prefill-tail unembed: the residual at column N_PROMPT-1 flows into
	//     Unembedding, producing the FIRST output token at text-slot
	//     N_PROMPT. No separate forward pass is needed for it.
	//   Decode: for each remaining text slot, one serial forward pass at
	//     the corresponding input column — embed the previously-committed
	//     token, flow through every layer (reading cache 0..col-1,
	//     appending K/V at col), unembed at col → reveal slot col+1.
	//
	// Every animated object owns one named channel in `animState`:
	//   channelName -> { progress: number }
	//   progress < 0  → object invisible (before its clip)
	//   0 ≤ p ≤ 1     → object animating
	//   progress > 1  → object invisible (after its clip)
	// Clip reducers write to exactly one channel; unwritten channels keep
	// their last value (default tempus merge semantics), so a hold clip
	// after a flow clip just marks that channel "past."
	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { TabbedFolder, type Stage } from '@diffusion-explorer/ui';

	interface Props {
		isActive?: Writable<boolean>;
		maskColor?: string;
		width?: number;
		nLayers?: number;
	}

	let { isActive, maskColor = '#cfe0f2', width = 1000, nLayers = 2 }: Props = $props();

	// N_LAYERS is a compile-time constant for this render — Svelte 5 runes
	// don't require reactivity here since the whole figure re-renders on
	// prop changes anyway. Keep the local alias so the code reads clean.
	const N_LAYERS = nLayers;

	// --- Palette (mirrors ModelPredictionFigure) ---
	const TEXT_COLOR = '#333';
	const MUTED = '#888';
	const BLOCK_LABEL_COLOR = '#5a5a5a'; // softer than TEXT_COLOR but darker than muted — used for layer/block labels and prompt text
	const TX_FILL = '#f4f6fa';
	const TX_STROKE = '#c8ccd1';
	const HBM_FILL = '#f4f6fa'; // same gray as the transformer blocks
	const HBM_STROKE = '#c8ccd1';
	const TOKEN_FILL = '#3879EF';
	const TOKEN_STROKE = '#1F55B5';
	// Active-position highlight: residual-stream cells at the position
	// currently being decoded are rendered orange so the reader can track
	// which token is flowing through the network right now.
	const ACTIVE_FILL = '#FBD3A3'; // light orange fill
	const ACTIVE_STROKE = '#F1942B'; // active accent (orange, from the palette)
	const ACTIVE_LAYER_OUTLINE = '#F1942B'; // orange marching-ants outline
	// K/V pair colors — green (K) + pink (V). Distinct from the
	// residual-stream blue and the orange active accent.
	const K_FILL = '#4AD77A';
	const V_FILL = '#EF6AAC';
	const KV_STROKE = '#8892a0';

	// --- Prompt / generation configuration ---
	// 8 total text slots. Slots 0..5 form the prompt (prefix). Slot 6 is
	// revealed by prefill's tail unembed (residual at col 5 → slot 6).
	// Slot 7 is revealed by ONE decode iteration at input column 6.
	// Punctuation split off from words (BPE-faithful).
	const inputWords: string[] = [
		'Where',
		'is',
		'the',
		'Eiffel',
		'Tower',
		'?',
		'In',
		'Paris'
	];
	const N_TOKENS = inputWords.length;
	const N_PROMPT = 6; // text-slot positions 0..N_PROMPT-1 are prefix
	// N_INPUT_COLS = the number of columns that ever appear inside the
	// transformer stack (embed, residuals, attention layers, cache). In a
	// causal LM with a KV cache, input column i produces the logits for
	// text slot i+1, so the transformer only ever needs columns
	// 0..N_TOKENS-2 to fill text slots 0..N_TOKENS-1. The last text slot
	// has no corresponding input column — nothing after it needs to be
	// predicted.
	const N_INPUT_COLS = N_TOKENS - 1;
	const promptIndices = Array.from({ length: N_PROMPT }, (_, i) => i);
	// Input column ↔ output text slot mapping. In a causal LM, input
	// column c produces the logits for text slot c+1. So:
	//   - Prefill runs input columns 0..N_PROMPT-1 (= 0..5) in parallel,
	//     and its last column's unembed (col 5) reveals text slot 6.
	//   - Decoding is one iteration per remaining slot: input col 6 →
	//     text slot 7. Text slot 6 comes "for free" out of prefill.
	// With N_TOKENS = 8 output slots, the transformer only ever needs
	// input columns 0..6 (N_INPUT_COLS = 7). The last text slot has no
	// corresponding input column — nothing after it needs predicting.
	const LAST_PREFILL_COL = N_PROMPT - 1; // 5
	// `decodeIndices` denotes the INPUT COLUMNS that decode iterations
	// operate on (each such iteration produces text slot `col + 1`).
	const decodeIndices = Array.from(
		{ length: N_TOKENS - 1 - LAST_PREFILL_COL },
		(_, i) => LAST_PREFILL_COL + 1 + i
	); // [6] — one decode iteration at column 6, produces text slot 7
	// Text slot that appears via prefill's tail unembed.
	const prefillRevealedSlot = LAST_PREFILL_COL + 1; // 6

	// --- Geometry ---
	const W = width;
	// H grows/shrinks with N_LAYERS + prefix-bracket allowance.
	const TEXT_ROW_H = 40;
	const TOKEN_ROW_H = 30;
	const LAYER_BLOCK_H = 38;
	const ROW_GAP = 22;
	const PREFIX_BRACKET_H = 20; // vertical space reserved for the bracket
	const PREFIX_LABEL_H = 18;   // vertical space for the "Prefix" label above it
	const RHS_TOP_PADDING = 12;
	const RHS_BOTTOM_PADDING = 20;
	// Vertical space reserved at the top of the SVG for the two column-header
	// labels ("Key Value Cache" over the LHS, "Autoregressive Transformer"
	// over the RHS).
	const COL_HEADER_H = 32;
	const COL_HEADER_Y = 18; // baseline-ish y for the two column headers
	const COL_HEADER_FONT_SIZE = 24;

	// Row-Y anchors. Order top→bottom:
	//   [PrefixLabel] · [PrefixBracket] · Text · Embed · (RowResid[0], Layer[0])
	//   × N_LAYERS · RowOutput.
	// Every element gets a `Y_*` top-anchor.
	const rowMetadata: { key: string; h: number }[] = [
		{ key: 'PREFIX_LABEL', h: PREFIX_LABEL_H },
		{ key: 'PREFIX_BRACKET', h: PREFIX_BRACKET_H },
		{ key: 'TEXT', h: TEXT_ROW_H },
		{ key: 'EMBED', h: LAYER_BLOCK_H }
	];
	for (let k = 0; k < N_LAYERS; k++) {
		rowMetadata.push({ key: `ROW_${k}`, h: TOKEN_ROW_H });
		rowMetadata.push({ key: `L${k}`, h: LAYER_BLOCK_H });
	}
	rowMetadata.push({ key: 'ROW_OUT', h: TOKEN_ROW_H });
	rowMetadata.push({ key: 'UNEMBED', h: LAYER_BLOCK_H });
	rowMetadata.push({ key: 'OUTPUT_TOKENS', h: TEXT_ROW_H });

	const rowYByKey: Record<string, number> = {};
	{
		let y = 20 + RHS_TOP_PADDING + COL_HEADER_H;
		for (const r of rowMetadata) {
			rowYByKey[r.key] = y;
			// prefix-label sits just above the bracket with no extra gap;
			// bracket sits just above the text row with no extra gap.
			const isPrefixCluster =
				r.key === 'PREFIX_LABEL' || r.key === 'PREFIX_BRACKET' || r.key === 'TEXT';
			const nextIsPrefixCluster =
				r.key === 'PREFIX_LABEL' || r.key === 'PREFIX_BRACKET';
			y += r.h + (isPrefixCluster && nextIsPrefixCluster ? 2 : ROW_GAP);
		}
	}
	const Y_PREFIX_LABEL = rowYByKey.PREFIX_LABEL;
	const Y_PREFIX_BRACKET = rowYByKey.PREFIX_BRACKET;
	const Y_TEXT = rowYByKey.TEXT;
	const Y_EMBED = rowYByKey.EMBED;
	// Per-layer residual row and layer top-Ys, indexed by k in [0, N_LAYERS).
	// ROW_k is the residual row ABOVE layer k (its input); ROW_OUT is below the last layer.
	const Y_ROW = Array.from({ length: N_LAYERS }, (_, k) => rowYByKey[`ROW_${k}`]);
	const Y_L = Array.from({ length: N_LAYERS }, (_, k) => rowYByKey[`L${k}`]);
	const Y_ROW_OUT = rowYByKey.ROW_OUT;
	const Y_UNEMBED = rowYByKey.UNEMBED;
	const Y_OUTPUT_TOKENS = rowYByKey.OUTPUT_TOKENS;

	// Overall SVG height: last row's y + its height + bottom padding.
	const lastRow = rowMetadata[rowMetadata.length - 1];
	const H = rowYByKey[lastRow.key] + lastRow.h + RHS_BOTTOM_PADDING;

	// Column split: HBM on the left, transformer stack on the right.
	// Wide COL_GAP intentionally — the append/read arrows live there on
	// the SVG's white background so they read clearly against neither fill.
	const COL_GAP = 130;
	const HBM_X = 20;
	const HBM_W = 360;
	const TX_COL_X = HBM_X + HBM_W + COL_GAP;
	const TX_COL_W = W - TX_COL_X - 20;

	// Attention-layer block: full column width, centered.
	const LAYER_X = TX_COL_X + 8;
	const LAYER_W = TX_COL_W - 16;

	// Token cells within a row: N_TOKENS evenly-spaced rounded squares.
	const TOKEN_SIZE = 20;
	const TOKEN_ROW_INNER_W = LAYER_W;
	const TOKEN_ROW_X = LAYER_X;
	const TOKEN_STRIDE = TOKEN_ROW_INNER_W / N_TOKENS;
	function tokenX(i: number): number {
		return TOKEN_ROW_X + i * TOKEN_STRIDE + TOKEN_STRIDE / 2 - TOKEN_SIZE / 2;
	}
	function tokenCenterX(i: number): number {
		return tokenX(i) + TOKEN_SIZE / 2;
	}

	// --- LHS: HBM box + per-layer KV-cache sub-rectangles ---
	const HBM_LABEL_H = 26;
	const CACHE_W = HBM_W * 0.9;
	const CACHE_X = HBM_X + (HBM_W - CACHE_W) / 2;
	const CACHE_H = 92;

	// K/V pair cells inside each cache.
	const KV_CELL_W = 24;
	const KV_HALF_H = 20;
	const KV_CELL_H = KV_HALF_H * 2;
	const KV_INNER_PADDING = 6;
	const KV_LABEL_W = 16;
	const KV_ROW_W = CACHE_W - 2 * KV_INNER_PADDING - KV_LABEL_W;
	const KV_STRIDE = KV_ROW_W / N_INPUT_COLS;
	function kvCellX(_cacheI: number, tokenI: number): number {
		return CACHE_X + KV_INNER_PADDING + KV_LABEL_W + tokenI * KV_STRIDE + KV_STRIDE / 2 - KV_CELL_W / 2;
	}
	const CACHE_LABEL_H = 16;

	// Attention-layer centers and cache Y-anchors, indexed by k.
	const layerCenterY = Array.from({ length: N_LAYERS }, (_, k) => Y_L[k] + LAYER_BLOCK_H / 2);
	const cacheY = layerCenterY.map((cy) => cy - CACHE_H / 2);
	function kvCellY(cacheI: number): number {
		const labelBottom = cacheY[cacheI] + CACHE_LABEL_H;
		const remaining = CACHE_H - CACHE_LABEL_H;
		return labelBottom + (remaining - KV_CELL_H) / 2;
	}
	function kvCellCenter(cacheI: number, tokenI: number): { x: number; y: number } {
		return { x: kvCellX(cacheI, tokenI) + KV_CELL_W / 2, y: kvCellY(cacheI) + KV_CELL_H / 2 };
	}

	// HBM box wraps the caches with margin for the "High Bandwidth Memory" label.
	const HBM_MARGIN_TOP = HBM_LABEL_H + 22;
	const HBM_MARGIN_BOTTOM = 18;
	const HBM_TOP = cacheY[0] - HBM_MARGIN_TOP;
	const HBM_BOTTOM = cacheY[N_LAYERS - 1] + CACHE_H + HBM_MARGIN_BOTTOM;
	const HBM_H = HBM_BOTTOM - HBM_TOP;
	const HBM_RIGHT = HBM_X + HBM_W;

	// Arrow markers.
	const MARKER_APPEND = 'kvcf-arrow-append';
	const MARKER_FLOW = 'kvcf-arrow-flow';
	const MARKER_ACTIVE = 'kvcf-arrow-active'; // orange, used by dynamic read/write arrows
	const ARROW_MARGIN = 8;
	const ARROW_X_HEAD = HBM_RIGHT + ARROW_MARGIN;
	const ARROW_X_TAIL = LAYER_X - ARROW_MARGIN;

	// Downward flow arrows between RHS rows.
	const FLOW_STROKE = '#b5bdc7';
	const FLOW_INSET = 2;
	type FlowSegment = { fromY: number; toY: number };
	// Flow arrows connect every consecutive pair of "vertical stack"
	// elements: text row → Embed top; Embed bottom → Row 0 top; Row k
	// top → Layer k top (through the residual cells); Layer k bottom →
	// Row k+1 top; and finally Row_OUT bottom → Unembed top.
	const flowSegments: FlowSegment[] = [
		{ fromY: Y_TEXT + TEXT_ROW_H, toY: Y_EMBED - FLOW_INSET },
		{ fromY: Y_EMBED + LAYER_BLOCK_H, toY: Y_ROW[0] - FLOW_INSET },
		// Row k → Layer k, and Layer k → Row k+1 (or Row_OUT for last layer).
		...Array.from({ length: N_LAYERS }, (_, k) => [
			// Residual row k → top of Layer k
			{ fromY: Y_ROW[k] + TOKEN_ROW_H, toY: Y_L[k] - FLOW_INSET },
			// Bottom of Layer k → next residual row (or Row_OUT for last)
			{
				fromY: Y_L[k] + LAYER_BLOCK_H,
				toY: (k + 1 < N_LAYERS ? Y_ROW[k + 1] : Y_ROW_OUT) - FLOW_INSET
			}
		]).flat(),
		// Row_OUT → Unembed top
		{ fromY: Y_ROW_OUT + TOKEN_ROW_H, toY: Y_UNEMBED - FLOW_INSET }
		// (Unembed → OUTPUT_TOKENS arrows rendered separately below, only
		//  for decoded columns — Unembed only produces output for those.)
	];

	// --- Prefix bracket geometry ---
	// Stems land on the CENTERS of the first and last prompt tokens (the
	// text glyphs are centered on tokenCenterX(i), not on token slot edges).
	const PREFIX_X0 = tokenCenterX(0);
	const PREFIX_X1 = tokenCenterX(N_PROMPT - 1);
	const PREFIX_TICK = 6; // downtick height on each end of the bracket

	// ================================================================
	// Flow-ghost primitive.
	// ================================================================
	function flowGhost(
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
		p: number,
		endScale = 0.55,
		fadeInEnd = 0.05,
		fadeOutStart = 0.75,
		startScale = 1
	) {
		const t = Math.max(0, Math.min(1, p));
		let opacity: number;
		if (p <= 0 || p >= 1) {
			opacity = 0;
		} else if (t < fadeInEnd) {
			opacity = t / fadeInEnd;
		} else if (t < fadeOutStart) {
			opacity = 1;
		} else {
			opacity = Math.max(0, 1 - (t - fadeOutStart) / (1 - fadeOutStart));
		}
		return {
			cx: fromX + (toX - fromX) * t,
			cy: fromY + (toY - fromY) * t,
			scale: startScale + (endScale - startScale) * t,
			opacity
		};
	}

	// Residual-stream cells at (row, position) become visible only *after*
	// the ghost that produces them has completed its clip. For prompt
	// positions the producer is a prefill_* channel; for decoded positions
	// it's a decode_* channel. Row 0 is fed by Embed; Row k (k≥1) is fed
	// by the previous layer's flow; ROW_OUT is fed by the last layer.
	//   rowIdx = 0..N_LAYERS   → 0..N_LAYERS-1 correspond to Y_ROW[k],
	//                            N_LAYERS corresponds to Y_ROW_OUT.
	function residualProducerChannel(rowIdx: number, tokenIdx: number): string {
		const isPrompt = tokenIdx < N_PROMPT;
		if (rowIdx === 0) {
			return isPrompt ? `prefill_embed_${tokenIdx}` : `decode_embed_${tokenIdx}`;
		}
		// rowIdx corresponds to the layer above it — i.e., Layer (rowIdx-1).
		// The residual EMERGING from that layer feeds this row, so the
		// producing channel is the emerge ghost.
		const k = rowIdx - 1;
		return isPrompt ? `prefill_l${k}_emerge_${tokenIdx}` : `decode_l${k}_emerge_${tokenIdx}`;
	}
	function residualVisible(rowIdx: number, tokenIdx: number): boolean {
		const ch = residualProducerChannel(rowIdx, tokenIdx);
		const p = animState[ch]?.progress ?? -1;
		return p >= 1;
	}
	// Return-ghost progress for text slot `slot`. Slot 6 is produced by
	// prefill's unembed; every other decoded slot c+1 comes from decode
	// iteration at column c. Prompt slots have no return ghost.
	function returnProgressForSlot(slot: number): number {
		if (slot < N_PROMPT) return -1;
		if (slot === prefillRevealedSlot) {
			return animState[`prefill_return`]?.progress ?? -1;
		}
		const col = slot - 1;
		return animState[`decode_return_${col}`]?.progress ?? -1;
	}
	// A residual/cache COLUMN is "active" (orange) while a decode
	// iteration is running through it. Prompt columns are never active —
	// they're background context populated during prefill. Ends once the
	// column's cache-write has landed (append.progress ≥ 1 in the last
	// layer means the iteration is essentially done from the network's
	// perspective).
	function isActiveColumn(col: number): boolean {
		if (!decodeIndices.includes(col)) return false;
		const embedP = animState[`decode_embed_${col}`]?.progress ?? -1;
		const finalAppendP =
			animState[`decode_l${N_LAYERS - 1}_append_${col}`]?.progress ?? -1;
		return embedP > 0 && finalAppendP < 1;
	}
	// A text SLOT is "active" while its unembed→return sequence is
	// running. Slot 6 goes active during prefill_unembed/prefill_return;
	// slot col+1 goes active during decode_unembed_col/decode_return_col.
	function isActiveTextSlot(slot: number): boolean {
		if (slot < N_PROMPT) return false;
		if (slot === prefillRevealedSlot) {
			const uP = animState[`prefill_unembed`]?.progress ?? -1;
			const rP = animState[`prefill_return`]?.progress ?? -1;
			return uP > 0 && rP < 1;
		}
		const col = slot - 1;
		const uP = animState[`decode_unembed_${col}`]?.progress ?? -1;
		const rP = animState[`decode_return_${col}`]?.progress ?? -1;
		return uP > 0 && rP < 1;
	}
	// Combined activity for a shared visual: text-row slot at index `i`
	// is highlighted when EITHER it's an actively-filling slot (target)
	// OR when it's the input to a currently-running decode iteration
	// (source column c = slot i, with decode running at col i).
	function isActivePosition(i: number): boolean {
		return isActiveTextSlot(i) || isActiveColumn(i);
	}
	// The Embedding block is "active" while any embed channel (prefill
	// or decode) is running.
	function isActiveEmbed(): boolean {
		for (const i of promptIndices) {
			const p = animState[`prefill_embed_${i}`]?.progress ?? -1;
			if (p > 0 && p < 1) return true;
		}
		for (const col of decodeIndices) {
			const p = animState[`decode_embed_${col}`]?.progress ?? -1;
			if (p > 0 && p < 1) return true;
		}
		return false;
	}
	// The Unembedding block is "active" during the unembed or return
	// step of prefill (producing slot 6) or any decode iteration.
	function isActiveUnembed(): boolean {
		const pU = animState[`prefill_unembed`]?.progress ?? -1;
		if (pU > 0 && pU < 1) return true;
		const pR = animState[`prefill_return`]?.progress ?? -1;
		if (pR > 0 && pR < 1) return true;
		for (const col of decodeIndices) {
			const uP = animState[`decode_unembed_${col}`]?.progress ?? -1;
			if (uP > 0 && uP < 1) return true;
			const rP = animState[`decode_return_${col}`]?.progress ?? -1;
			if (rP > 0 && rP < 1) return true;
		}
		return false;
	}
	// Cache write/read state for a specific layer. Write = any append
	// channel (prefill or decode) for this layer is running; read = any
	// decode read channel for this layer is running.
	function isCacheWriting(k: number): boolean {
		for (const i of promptIndices) {
			const p = animState[`prefill_l${k}_append_${i}`]?.progress ?? -1;
			if (p > 0 && p < 1) return true;
		}
		for (const pos of decodeIndices) {
			const p = animState[`decode_l${k}_append_${pos}`]?.progress ?? -1;
			if (p > 0 && p < 1) return true;
		}
		return false;
	}
	function isCacheReading(k: number): boolean {
		for (const pos of decodeIndices) {
			// A decode step reads from cache positions 0..pos-1. Channels
			// are named decode_l{k}_read_{pos}_from_{i}.
			for (let i = 0; i < pos; i++) {
				const p = animState[`decode_l${k}_read_${pos}_from_${i}`]?.progress ?? -1;
				if (p > 0 && p < 1) return true;
			}
		}
		return false;
	}
	// A cache is "active" (marching-ants outline in orange) while its
	// layer is currently reading from or writing to it.
	function isActiveCache(k: number): boolean {
		return isCacheWriting(k) || isCacheReading(k);
	}
	// A layer is "active" from the moment its first flow-in ghost starts
	// until its last emerge ghost completes. Covers the whole per-layer
	// arc: flow-in → cache read → cache write + emerge. Highlighted with
	// the orange marching-ants outline.
	function isActiveLayer(k: number): boolean {
		// Prefill: layer k is active while any flow, append, or emerge
		// channel for k is running, OR while an earlier one has started
		// and a later one hasn't finished.
		const promptChIds: string[] = [];
		for (const i of promptIndices) {
			promptChIds.push(`prefill_l${k}_flow_${i}`);
			promptChIds.push(`prefill_l${k}_append_${i}`);
			promptChIds.push(`prefill_l${k}_emerge_${i}`);
		}
		let anyStarted = false;
		let anyUnfinished = false;
		for (const id of promptChIds) {
			const p = animState[id]?.progress ?? -1;
			if (p > 0) anyStarted = true;
			if (p < 1) anyUnfinished = true;
		}
		if (anyStarted && anyUnfinished) return true;
		// Decode: highlight the layer from its flow-in start until its
		// cache-write (append) completes. Covers flow → read → emerge →
		// write as one continuous "layer is busy" window.
		for (const pos of decodeIndices) {
			const flowP = animState[`decode_l${k}_flow_${pos}`]?.progress ?? -1;
			const appendP = animState[`decode_l${k}_append_${pos}`]?.progress ?? -1;
			if (flowP > 0 && appendP < 1) return true;
		}
		return false;
	}

	// ================================================================
	// Ghost registry — one entry per animated flow ghost.
	// ================================================================
	type GhostKind = 'rect' | 'kvpair' | 'text';
	type GhostLayer = 'behind' | 'above-hbm' | 'above-all';
	type GhostSpec = {
		id: string; // channel name in animState
		kind: GhostKind;
		layer: GhostLayer;
		tokenIdx: number; // which token column this ghost is associated with
		from: { x: number; y: number };
		to: { x: number; y: number };
		size: { w: number; h: number };
		style: {
			fill?: string;
			stroke?: string;
			k?: string;
			v?: string;
			kvStroke?: string;
			text?: string;
			textFill?: string;
			textFontSize?: number;
		};
	};

	const RS_STYLE = { fill: TOKEN_FILL, stroke: TOKEN_STROKE };
	const KV_STYLE = { k: K_FILL, v: V_FILL, kvStroke: KV_STROKE };
	const RS_SIZE = { w: TOKEN_SIZE, h: TOKEN_SIZE };
	const KV_SIZE = { w: KV_CELL_W, h: KV_CELL_H };
	const GHOST_START_OFFSET = 0;

	// Prefill embed ghost i: text glyph at position i → Row 0 cell i.
	function buildPrefillEmbedGhosts(): GhostSpec[] {
		return promptIndices.map((i) => ({
			id: `prefill_embed_${i}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			tokenIdx: i,
			from: { x: tokenCenterX(i), y: Y_TEXT + TEXT_ROW_H / 2 - 6 },
			to: { x: tokenCenterX(i), y: Y_ROW[0] + TOKEN_ROW_H / 2 },
			size: RS_SIZE,
			style: RS_STYLE
		}));
	}

	// Prefill layer-k ghosts:
	//   flow: residual row k → top of layer k
	//   append: layer k left edge → cache k cell i (parallel with flow)
	//   emerge: bottom of layer k → next residual row (or output row)
	function buildPrefillLayerGhosts(k: number): GhostSpec[] {
		const nextResidualY =
			k + 1 < N_LAYERS ? Y_ROW[k + 1] + TOKEN_ROW_H / 2 : Y_ROW_OUT + TOKEN_ROW_H / 2;
		const flows = promptIndices.map((i) => ({
			id: `prefill_l${k}_flow_${i}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			tokenIdx: i,
			from: {
				x: tokenCenterX(i),
				y: Y_ROW[k] + TOKEN_ROW_H / 2 - GHOST_START_OFFSET
			},
			to: { x: tokenCenterX(i), y: Y_L[k] },
			size: RS_SIZE,
			style: RS_STYLE
		}));
		// Append ghosts: emerge from the OUTPUT residual row for this layer
		// (where the token just landed after emerging from the layer bottom)
		// and fly leftward+upward into their corresponding cache cells.
		// Start small (as a residual-shaped seed) and grow to K/V pair size.
		const appendFromY =
			k + 1 < N_LAYERS ? Y_ROW[k + 1] + TOKEN_ROW_H / 2 : Y_ROW_OUT + TOKEN_ROW_H / 2;
		const appends = promptIndices.map((i) => ({
			id: `prefill_l${k}_append_${i}`,
			kind: 'kvpair' as const,
			layer: 'above-hbm' as const,
			tokenIdx: i,
			from: { x: tokenCenterX(i), y: appendFromY },
			to: kvCellCenter(k, i),
			size: KV_SIZE,
			style: KV_STYLE
		}));
		// Emerge ghosts: fly out of the BOTTOM of the layer into the next
		// residual row. Rendered with flowEmerge (starts small+invisible,
		// grows to full size+opacity). This mirrors the flow-in animation.
		const emerges = promptIndices.map((i) => ({
			id: `prefill_l${k}_emerge_${i}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			tokenIdx: i,
			from: { x: tokenCenterX(i), y: Y_L[k] + LAYER_BLOCK_H },
			to: { x: tokenCenterX(i), y: nextResidualY },
			size: RS_SIZE,
			style: RS_STYLE
		}));
		return [...flows, ...appends, ...emerges];
	}

	// Decode embed ghost for one input column: text glyph at slot `col` →
	// Row 0 cell at column `col`. The token feeding input column c is the
	// token already sitting at text-slot c (in a causal LM, input at
	// column c is used to predict slot c+1, so slot c is its input).
	function buildDecodeEmbedGhost(col: number): GhostSpec {
		return {
			id: `decode_embed_${col}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			tokenIdx: col,
			from: { x: tokenCenterX(col), y: Y_TEXT + TEXT_ROW_H / 2 },
			to: { x: tokenCenterX(col), y: Y_ROW[0] + TOKEN_ROW_H / 2 },
			size: RS_SIZE,
			style: RS_STYLE
		};
	}

	// Decode unembed ghost for one input column: OUTPUT row[col] center →
	// top of Unembed block. Same visual language as the flow ghost feeding
	// the very first attention layer.
	function buildDecodeUnembedGhost(col: number): GhostSpec {
		return {
			id: `decode_unembed_${col}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			tokenIdx: col,
			from: { x: tokenCenterX(col), y: Y_ROW_OUT + TOKEN_ROW_H / 2 },
			to: { x: tokenCenterX(col), y: Y_UNEMBED },
			size: RS_SIZE,
			style: RS_STYLE
		};
	}

	// Decode return ghost for one input column: a COPY of the predicted-
	// word text flies from the Output-Tokens row (below Unembed) back up
	// to the text row slot `col + 1` — the slot this column's unembed
	// produces. The original in the Output-Tokens row stays put — the
	// ghost is an animated duplicate. Kind='text'.
	function buildDecodeReturnGhost(col: number): GhostSpec {
		const outputSlot = col + 1;
		return {
			id: `decode_return_${col}`,
			kind: 'text' as const,
			// Float on top of ALL RHS layer blocks and the HBM box so the
			// freshly-decoded word stays visible as it crosses the network
			// on its way back to the text row.
			layer: 'above-all' as const,
			tokenIdx: outputSlot,
			from: { x: tokenCenterX(outputSlot), y: Y_OUTPUT_TOKENS + TEXT_ROW_H / 2 },
			to: { x: tokenCenterX(outputSlot), y: Y_TEXT + TEXT_ROW_H / 2 },
			size: { w: TOKEN_SIZE, h: TOKEN_SIZE },
			style: { text: inputWords[outputSlot], textFill: ACTIVE_STROKE, textFontSize: 15 }
		};
	}

	// Prefill unembed ghost: at the tail of prefill, the residual at the
	// last prefix column (LAST_PREFILL_COL = 5) unembeds into text slot 6.
	// This is the "first decoded token" — it emerges directly from
	// prefill's own forward pass, before any per-token decode iteration.
	function buildPrefillUnembedGhost(): GhostSpec {
		const col = LAST_PREFILL_COL;
		return {
			id: `prefill_unembed`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			tokenIdx: col,
			from: { x: tokenCenterX(col), y: Y_ROW_OUT + TOKEN_ROW_H / 2 },
			to: { x: tokenCenterX(col), y: Y_UNEMBED },
			size: RS_SIZE,
			style: RS_STYLE
		};
	}

	// Prefill return ghost: predicted-word text flies from OUTPUT_TOKENS
	// row at slot 6 → text-slot 6. Mirror of the decode return ghost.
	function buildPrefillReturnGhost(): GhostSpec {
		const slot = prefillRevealedSlot;
		return {
			id: `prefill_return`,
			kind: 'text' as const,
			layer: 'above-all' as const,
			tokenIdx: slot,
			from: { x: tokenCenterX(slot), y: Y_OUTPUT_TOKENS + TEXT_ROW_H / 2 },
			to: { x: tokenCenterX(slot), y: Y_TEXT + TEXT_ROW_H / 2 },
			size: { w: TOKEN_SIZE, h: TOKEN_SIZE },
			style: { text: inputWords[slot], textFill: ACTIVE_STROKE, textFontSize: 15 }
		};
	}

	// Decode layer-k ghosts for one decoded position `pos`:
	//   - flow: Row k[pos] → top of layer k.
	//   - reads: cache-k cells 0..pos-1 → left edge of layer k.
	//   - append: layer k left edge → cache-k cell pos.
	//   - emerge: bottom of layer k → next residual row at column pos.
	function buildDecodeLayerGhosts(k: number, pos: number): GhostSpec[] {
		const nextResidualY =
			k + 1 < N_LAYERS ? Y_ROW[k + 1] + TOKEN_ROW_H / 2 : Y_ROW_OUT + TOKEN_ROW_H / 2;
		const flow: GhostSpec = {
			id: `decode_l${k}_flow_${pos}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			tokenIdx: pos,
			from: {
				x: tokenCenterX(pos),
				y: Y_ROW[k] + TOKEN_ROW_H / 2 - GHOST_START_OFFSET
			},
			to: { x: tokenCenterX(pos), y: Y_L[k] },
			size: RS_SIZE,
			style: RS_STYLE
		};
		const reads: GhostSpec[] = [];
		for (let i = 0; i < pos; i++) {
			const src = kvCellCenter(k, i);
			reads.push({
				id: `decode_l${k}_read_${pos}_from_${i}`,
				kind: 'kvpair' as const,
				layer: 'above-hbm' as const,
				tokenIdx: pos,
				from: src,
				to: { x: LAYER_X, y: layerCenterY[k] },
				size: KV_SIZE,
				style: KV_STYLE
			});
		}
		// Append origins from the emerged residual (where the token just
		// landed after exiting layer k's bottom), NOT from the layer center.
		const appendFromY =
			k + 1 < N_LAYERS ? Y_ROW[k + 1] + TOKEN_ROW_H / 2 : Y_ROW_OUT + TOKEN_ROW_H / 2;
		const append: GhostSpec = {
			id: `decode_l${k}_append_${pos}`,
			kind: 'kvpair' as const,
			layer: 'above-hbm' as const,
			tokenIdx: pos,
			from: { x: tokenCenterX(pos), y: appendFromY },
			to: kvCellCenter(k, pos),
			size: KV_SIZE,
			style: KV_STYLE
		};
		const emerge: GhostSpec = {
			id: `decode_l${k}_emerge_${pos}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			tokenIdx: pos,
			from: { x: tokenCenterX(pos), y: Y_L[k] + LAYER_BLOCK_H },
			to: { x: tokenCenterX(pos), y: nextResidualY },
			size: RS_SIZE,
			style: RS_STYLE
		};
		return [flow, ...reads, append, emerge];
	}

	// (col, slot) pairs describing every "unembedding event" — each entry
	// binds an input column to the output slot it produces (slot = col +
	// 1). One entry per prefill-tail unembed plus one per decode iteration.
	// Used by the SVG to render the diagonal Unembed → Output arrow and
	// the persistent output-tokens text.
	type UnembedProduction = {
		col: number;
		slot: number;
		unembedChannel: string;
		returnChannel: string;
	};
	const unembedProductions: UnembedProduction[] = [
		{
			col: LAST_PREFILL_COL,
			slot: prefillRevealedSlot,
			unembedChannel: `prefill_unembed`,
			returnChannel: `prefill_return`
		},
		...decodeIndices.map((col) => ({
			col,
			slot: col + 1,
			unembedChannel: `decode_unembed_${col}`,
			returnChannel: `decode_return_${col}`
		}))
	];

	// Build the full spec array once. (Everything geometry-derived is a
	// constant at this point in the module.)
	const ghostSpecs: GhostSpec[] = [
		...buildPrefillEmbedGhosts(),
		...Array.from({ length: N_LAYERS }, (_, k) => buildPrefillLayerGhosts(k)).flat(),
		buildPrefillUnembedGhost(),
		buildPrefillReturnGhost(),
		...decodeIndices.map((col) => buildDecodeEmbedGhost(col)),
		...decodeIndices
			.map((col) => Array.from({ length: N_LAYERS }, (_, k) => buildDecodeLayerGhosts(k, col)))
			.flat(2),
		...decodeIndices.map((col) => buildDecodeUnembedGhost(col)),
		...decodeIndices.map((col) => buildDecodeReturnGhost(col))
	];
	// Partition by z-order group. Order within each group is preserved,
	// which matters when many ghosts overlap (later ghosts paint on top).
	const behindGhosts = ghostSpecs.filter((g) => g.layer === 'behind');
	const aboveHbmGhosts = ghostSpecs.filter((g) => g.layer === 'above-hbm');
	const aboveAllGhosts = ghostSpecs.filter((g) => g.layer === 'above-all');

	// ================================================================
	// Animation state — dynamic channel bag.
	// ================================================================
	type GhostChannel = { progress: number };
	type AnimationState = Record<string, GhostChannel>;

	function buildInitialState(): AnimationState {
		const s: AnimationState = {};
		for (const g of ghostSpecs) s[g.id] = { progress: -1 };
		return s;
	}
	const INITIAL_STATE: AnimationState = buildInitialState();

	let animState = $state<AnimationState>(buildInitialState());
	let player = $state<Player<AnimationState> | undefined>(undefined);
	let stages = $state<Stage[]>([]);

	function endPhaseFor(ids: string[]): Partial<AnimationState> {
		const patch: AnimationState = {};
		for (const id of ids) patch[id] = { progress: 2 };
		return patch;
	}

	// ================================================================
	// Timeline builder.
	// ================================================================
	// Timing (ms). Tuned once here; entire animation scales together.
	const T_FLOW = 1400;
	const T_HOLD = 400;
	const T_APPEND = 1600; // decode single-position cache write
	const T_WRITE = 2200; // prefill per-token cache write (staggered — slower)
	const T_DECODE_FLOW = 1200;
	const T_DECODE_READS = 1500;
	const T_END_HOLD = 1200;
	// Stagger between successive tokens in a parallel prefill/decode-read
	// group. Small enough that they visually overlap (feel "quick and
	// overlapping" rather than one-after-another) but big enough for the
	// eye to pick up that they're not simultaneous.
	const T_STAGGER = 140;

	// Helper: create a parallel clip group. Each spec animates 0→1 on the
	// same duration and writes its progress to its own channel.
	function parallelFlow(channelIds: string[]) {
		return channelIds.map((id) => ({
			name: `flow-${id}`,
			reduce: (t: number) => ({ [id]: { progress: t } }) as Partial<AnimationState>
		}));
	}
	// Staggered parallel flow: N clips run inside ONE tempus phase, but each
	// clip's local progress is offset by `staggerFrac` from the previous.
	// The group's total duration should be passed as `durationMs =
	// baseFlowMs + (N-1) * staggerMs` so each clip gets a full 0→1 window.
	// Returns both the clip array and the correct duration for the caller.
	function staggeredParallelFlow(
		channelIds: string[],
		baseFlowMs: number,
		staggerMs: number
	): { clips: Array<{ name: string; reduce: (t: number) => Partial<AnimationState> }>; durationMs: number } {
		const n = channelIds.length;
		const durationMs = baseFlowMs + (n - 1) * staggerMs;
		const staggerFrac = staggerMs / durationMs;
		const flowFrac = baseFlowMs / durationMs;
		const clips = channelIds.map((id, i) => {
			const start = i * staggerFrac;
			const end = start + flowFrac;
			return {
				name: `flow-${id}`,
				reduce: (t: number) => {
					// Map the group's global t into this clip's local (0..1) window.
					let local: number;
					if (t <= start) local = 0;
					else if (t >= end) local = 1;
					else local = (t - start) / (end - start);
					return { [id]: { progress: local } } as Partial<AnimationState>;
				}
			};
		});
		return { clips, durationMs };
	}
	function parallelHold(channelIds: string[]) {
		return {
			name: `hold-${channelIds.join('+').slice(0, 40)}`,
			reduce: (_t: number) => endPhaseFor(channelIds)
		};
	}
	function singleFlow(id: string) {
		return {
			name: `flow-${id}`,
			reduce: (t: number) => ({ [id]: { progress: t } }) as Partial<AnimationState>
		};
	}
	function singleHold(id: string) {
		return {
			name: `hold-${id}`,
			reduce: (_t: number) => endPhaseFor([id])
		};
	}

	function buildTimeline(): {
		timeline: ReturnType<TimelineBuilder<AnimationState>['build']>;
		stages: Stage[];
	} {
		const b = new TimelineBuilder<AnimationState>().setInitialState(INITIAL_STATE);

		// Stage boundaries: each entry marks the start (in ms) of a top-level
		// phase of the algorithm. Converted to normalized [0,1] ranges at the
		// end (endTime of stage i = startTime of stage i+1; final stage runs
		// to 1.0).
		const stageStartMs: { label: string; description: string; ms: number }[] = [];
		function stage(label: string, description: string) {
			stageStartMs.push({ label, description, ms: b.totalDurationMs });
		}

		// --- Stage 1: Prefill ---
		//   Embed the prefix, then per layer: flow-in, emerge, staggered cache
		//   writes. All prefix tokens are processed in parallel; the K/V cache
		//   is populated for autoregressive decoding.
		stage(
			'Prefill',
			'The prefix tokens are embedded and pass through every attention layer in parallel. As they emerge from each layer, their K/V pairs are written to the cache. The last prefix column\'s residual then flows through Unembedding, producing the first output token — for free, as part of the same forward pass.'
		);
		const embedIds = promptIndices.map((i) => `prefill_embed_${i}`);
		b.add(parallelFlow(embedIds), { durationMs: T_FLOW });
		b.add(parallelHold(embedIds), { durationMs: T_HOLD });

		for (let k = 0; k < N_LAYERS; k++) {
			const flowIds = promptIndices.map((i) => `prefill_l${k}_flow_${i}`);
			const appendIds = promptIndices.map((i) => `prefill_l${k}_append_${i}`);
			const emergeIds = promptIndices.map((i) => `prefill_l${k}_emerge_${i}`);

			b.add(parallelFlow(flowIds), { durationMs: T_FLOW });
			b.add(parallelHold(flowIds), { durationMs: T_HOLD });

			b.add(parallelFlow(emergeIds), { durationMs: T_FLOW });
			b.add(parallelHold(emergeIds), { durationMs: T_HOLD });

			{
				const { clips, durationMs } = staggeredParallelFlow(appendIds, T_WRITE, T_STAGGER);
				b.add(clips, { durationMs });
			}
			b.add(parallelHold(appendIds), { durationMs: T_HOLD });
		}

		// Brief hold on fully-populated cache.
		b.add(
			{
				name: 'prefill-done-hold',
				reduce: (_t: number) => ({})
			},
			{ durationMs: T_HOLD }
		);

		// Prefill's last-column unembed reveals the first output token:
		// residual at column LAST_PREFILL_COL flows into Unembed, which
		// produces text slot 6. This falls out of prefill "for free" —
		// no separate forward pass needed for slot 6.
		b.add(singleFlow(`prefill_unembed`), { durationMs: T_DECODE_FLOW });
		b.add(singleHold(`prefill_unembed`), { durationMs: T_HOLD });
		b.add(singleFlow(`prefill_return`), { durationMs: T_DECODE_FLOW * 2 });

		// --- Stage 2: Decoding ---
		//   Each remaining output slot (col+1) needs one forward pass at
		//   input column col: embed the token at slot col → run through
		//   every layer (reading cache 0..col-1, writing at col) →
		//   unembed at col → reveal slot col+1.
		stage(
			'Decoding',
			'For every remaining output slot, the model runs one more forward pass — embedding the previously-committed token, reading cached K/V from every earlier position, appending its own K/V, and unembedding the result into the next text slot.'
		);
		for (const col of decodeIndices) {
			// Embed the token at text-slot `col` → residual col `col`.
			const embedId = `decode_embed_${col}`;
			b.add(singleFlow(embedId), { durationMs: T_DECODE_FLOW });
			b.add(singleHold(embedId), { durationMs: T_HOLD });

			for (let k = 0; k < N_LAYERS; k++) {
				const flowId = `decode_l${k}_flow_${col}`;
				b.add(singleFlow(flowId), { durationMs: T_DECODE_FLOW });
				b.add(singleHold(flowId), { durationMs: T_HOLD });

				// Cache read: all previously-cached positions (0..col-1).
				const readIds: string[] = [];
				for (let i = 0; i < col; i++) readIds.push(`decode_l${k}_read_${col}_from_${i}`);
				if (readIds.length > 0) {
					b.add(parallelFlow(readIds), { durationMs: T_DECODE_READS });
					b.add(parallelHold(readIds), { durationMs: T_HOLD });
				}

				// Emerge first (token exits the layer), then cache write.
				const emergeId = `decode_l${k}_emerge_${col}`;
				b.add(singleFlow(emergeId), { durationMs: T_DECODE_FLOW });
				b.add(singleHold(emergeId), { durationMs: T_HOLD });

				const appendId = `decode_l${k}_append_${col}`;
				b.add(singleFlow(appendId), { durationMs: T_APPEND });
				b.add(singleHold(appendId), { durationMs: T_HOLD });
			}

			// Unembed at column `col` → produces text slot `col + 1`.
			const unembedId = `decode_unembed_${col}`;
			b.add(singleFlow(unembedId), { durationMs: T_DECODE_FLOW });
			b.add(singleHold(unembedId), { durationMs: T_HOLD });

			// Return: predicted word flies from OUTPUT slot col+1 up to
			// text-slot col+1.
			const returnId = `decode_return_${col}`;
			b.add(singleFlow(returnId), { durationMs: T_DECODE_FLOW * 2 });
		}

		// Final hold before looping.
		b.add(
			{
				name: 'end-hold',
				reduce: (_t: number) => ({})
			},
			{ durationMs: T_END_HOLD }
		);

		const totalMs = b.totalDurationMs;
		const stages: Stage[] = stageStartMs.map((s, i) => ({
			label: s.label,
			description: s.description,
			startTime: totalMs > 0 ? s.ms / totalMs : 0,
			endTime:
				i + 1 < stageStartMs.length && totalMs > 0
					? stageStartMs[i + 1].ms / totalMs
					: 1
		}));
		return { timeline: b.build(), stages };
	}

	onMount(() => {
		const built = buildTimeline();
		stages = built.stages;
		player = new Player<AnimationState>(built.timeline, { looping: true, endPause: 0.05 });
		player.onTick((_t, s) => {
			animState = s;
		});
		const unsubActive = isActive?.subscribe((v) => {
			if (!player) return;
			if (v) player.play();
			else {
				player.pause();
				player.reset();
				animState = buildInitialState();
			}
		});
		return () => {
			unsubActive?.();
			player?.pause();
		};
	});

	// Per-ghost derived state.
	//   - Append ghosts (K/V pairs being written to the cache): start small
	//     (0.5 scale, as a residual-shaped seed) and grow to full K/V size.
	//   - Everything else moves at constant full size.
	// All ghosts are opaque during their phase, invisible before/after.
	function ghostFor(g: GhostSpec) {
		const p = animState[g.id]?.progress ?? -1;
		const isAppend = g.id.includes('_append_');
		const startScale = isAppend ? 0.5 : 1;
		return flowGhost(g.from.x, g.from.y, g.to.x, g.to.y, p, 1, 0, 1, startScale);
	}
</script>

<TabbedFolder player={player ?? null} {stages} maxWidth="{W}px" accentColor={ACTIVE_STROKE}>
	<svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet">
		<defs>
			<marker
				id={MARKER_APPEND}
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={5}
				markerHeight={5}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={MUTED} />
			</marker>
			<marker
				id={MARKER_FLOW}
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={4}
				markerHeight={4}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={FLOW_STROKE} />
			</marker>
			<marker
				id={MARKER_ACTIVE}
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={5}
				markerHeight={5}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={ACTIVE_STROKE} />
			</marker>
		</defs>

		<!-- ============================================================ -->
		<!-- Column headers: "Key Value Cache" (LHS) and                    -->
		<!-- "Autoregressive Transformer" (RHS). Slightly larger than the -->
		<!-- per-layer labels to impose visual hierarchy.                  -->
		<!-- ============================================================ -->
		<text
			x={HBM_X + HBM_W / 2}
			y={COL_HEADER_Y}
			text-anchor="middle"
			dominant-baseline="central"
			font-size={COL_HEADER_FONT_SIZE}
			font-weight="600"
			fill={BLOCK_LABEL_COLOR}
		>
			Key Value Cache
		</text>
		<text
			x={TX_COL_X + TX_COL_W / 2}
			y={COL_HEADER_Y}
			text-anchor="middle"
			dominant-baseline="central"
			font-size={COL_HEADER_FONT_SIZE}
			font-weight="600"
			fill={BLOCK_LABEL_COLOR}
		>
			Autoregressive Transformer
		</text>

		<!-- ============================================================ -->
		<!-- Flow arrows: thin vertical connectors between RHS rows.       -->
		<!-- ============================================================ -->
		{#each flowSegments as seg}
			{#each Array(N_INPUT_COLS) as _, i}
				<line
					x1={tokenCenterX(i)}
					y1={seg.fromY}
					x2={tokenCenterX(i)}
					y2={seg.toY}
					stroke={FLOW_STROKE}
					stroke-width="2"
					marker-end={`url(#${MARKER_FLOW})`}
				/>
			{/each}
		{/each}

		<!-- ============================================================ -->
		<!-- Ghosts (behind HBM / RHS layer blocks).                       -->
		<!-- ============================================================ -->
		{#each behindGhosts as g (g.id)}
			{@const gh = ghostFor(g)}
			{@const active = (animState[g.id]?.progress ?? -1) > 0 && (animState[g.id]?.progress ?? -1) < 1}
			<g
				transform="translate({gh.cx} {gh.cy}) scale({gh.scale})"
				opacity={gh.opacity}
				pointer-events="none"
			>
				{#if g.kind === 'rect'}
					<rect
						x={-g.size.w / 2}
						y={-g.size.h / 2}
						width={g.size.w}
						height={g.size.h}
						rx="5"
						ry="5"
						fill={active ? ACTIVE_FILL : g.style.fill}
						stroke={active ? ACTIVE_STROKE : g.style.stroke}
						stroke-width="1"
					/>
				{:else if g.kind === 'kvpair'}
					<rect
						x={-g.size.w / 2}
						y={-g.size.h / 2}
						width={g.size.w}
						height={g.size.h / 2}
						rx="2"
						fill={g.style.k}
						stroke={g.style.kvStroke}
						stroke-width="0.75"
					/>
					<rect
						x={-g.size.w / 2}
						y={0}
						width={g.size.w}
						height={g.size.h / 2}
						rx="2"
						fill={g.style.v}
						stroke={g.style.kvStroke}
						stroke-width="0.75"
					/>
					<text
						x={0}
						y={-g.size.h / 4}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="11"
						font-weight="600"
						fill="white"
					>
						K
					</text>
					<text
						x={0}
						y={g.size.h / 4}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="11"
						font-weight="600"
						fill="white"
					>
						V
					</text>
				{:else}
					<text
						x={0}
						y={0}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={g.style.textFontSize ?? 15}
						font-weight="600"
						fill={g.style.textFill ?? ACTIVE_STROKE}
					>
						{g.style.text ?? ''}
					</text>
				{/if}
			</g>
		{/each}

		<!-- ============================================================ -->
		<!-- LHS: HBM outer box + per-layer KV-cache sub-rectangles        -->
		<!-- ============================================================ -->
		<rect
			x={HBM_X}
			y={HBM_TOP}
			width={HBM_W}
			height={HBM_H}
			rx="10"
			ry="10"
			fill={HBM_FILL}
			stroke={HBM_STROKE}
			stroke-width="1.5"
		/>
		<text
			x={HBM_X + HBM_W / 2}
			y={HBM_TOP + HBM_LABEL_H / 2 + 4}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="18"
			font-weight="500"
			fill={BLOCK_LABEL_COLOR}
		>
			High Bandwidth Memory
		</text>

		{#each Array(N_LAYERS) as _, k}
			{@const cacheActive = isActiveCache(k)}
			<rect
				class:active-layer-outline={cacheActive}
				x={CACHE_X}
				y={cacheY[k]}
				width={CACHE_W}
				height={CACHE_H}
				rx="6"
				ry="6"
				fill="#ffffff"
				stroke={cacheActive ? ACTIVE_LAYER_OUTLINE : TX_STROKE}
				stroke-width={cacheActive ? '1.5' : '1'}
			/>
			<text
				x={CACHE_X + 8}
				y={cacheY[k] + 5}
				dominant-baseline="hanging"
				font-size="16"
				font-weight="500"
				fill={BLOCK_LABEL_COLOR}
				letter-spacing="0.02em"
			>
				Layer {k + 1} — KV Cache
			</text>

			<text
				x={CACHE_X + KV_INNER_PADDING + 2}
				y={kvCellY(k) + KV_HALF_H / 2}
				text-anchor="start"
				dominant-baseline="central"
				font-size="13"
				font-weight="600"
				fill={MUTED}
			>
				K
			</text>
			<text
				x={CACHE_X + KV_INNER_PADDING + 2}
				y={kvCellY(k) + KV_HALF_H + KV_HALF_H / 2}
				text-anchor="start"
				dominant-baseline="central"
				font-size="13"
				font-weight="600"
				fill={MUTED}
			>
				V
			</text>

			<!-- K/V pair cells: prompt positions always filled; decoded
				 input columns only filled AFTER their append clip has run.
				 There's one cache column per transformer input column
				 (N_INPUT_COLS), not per text slot — the last text slot has
				 no cache column since nothing after it needs to be
				 predicted. -->
			{#each Array(N_INPUT_COLS) as _, i}
				{@const isPromptSlot = i < N_PROMPT}
				{@const cx = kvCellX(k, i)}
				{@const cy = kvCellY(k)}
				{@const appendChannel =
					isPromptSlot ? `prefill_l${k}_append_${i}` : `decode_l${k}_append_${i}`}
				{@const appendedProgress = animState[appendChannel]?.progress ?? -1}
				{@const isFilled = appendedProgress >= 1}
				<rect
					x={cx}
					y={cy}
					width={KV_CELL_W}
					height={KV_HALF_H}
					rx="2"
					ry="2"
					fill={isFilled ? K_FILL : 'none'}
					stroke={KV_STROKE}
					stroke-width="0.75"
				/>
				<rect
					x={cx}
					y={cy + KV_HALF_H}
					width={KV_CELL_W}
					height={KV_HALF_H}
					rx="2"
					ry="2"
					fill={isFilled ? V_FILL : 'none'}
					stroke={KV_STROKE}
					stroke-width="0.75"
				/>
				{#if isFilled}
					<text
						x={cx + KV_CELL_W / 2}
						y={cy + KV_HALF_H / 2}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="11"
						font-weight="600"
						fill="white"
					>
						K
					</text>
					<text
						x={cx + KV_CELL_W / 2}
						y={cy + KV_HALF_H + KV_HALF_H / 2}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="11"
						font-weight="600"
						fill="white"
					>
						V
					</text>
				{/if}
			{/each}
		{/each}

		<!-- ============================================================ -->
		<!-- Dynamic cache-read / cache-write arrows: shown only while the -->
		<!-- corresponding channels are running. Rendered BEFORE the above- -->
		<!-- HBM ghosts so those K/V ghosts paint on top of the arrows.    -->
		<!-- Direction encodes flow (write: layer → cache; read: cache →   -->
		<!-- layer). Labels sit above the arrow.                            -->
		<!-- ============================================================ -->
		{#each layerCenterY as cy, k}
			{@const writing = isCacheWriting(k)}
			{@const reading = isCacheReading(k)}
			{#if writing}
				<line
					x1={ARROW_X_TAIL}
					y1={cy}
					x2={ARROW_X_HEAD}
					y2={cy}
					stroke={ACTIVE_STROKE}
					stroke-width="1.75"
					marker-end={`url(#${MARKER_ACTIVE})`}
				/>
				<text
					x={(ARROW_X_TAIL + ARROW_X_HEAD) / 2}
					y={cy - 40}
					text-anchor="middle"
					font-size="18"
					font-weight="500"
					letter-spacing="0.02em"
					fill={ACTIVE_STROKE}
				>
					<tspan x={(ARROW_X_TAIL + ARROW_X_HEAD) / 2} dy="0">Cache</tspan>
					<tspan x={(ARROW_X_TAIL + ARROW_X_HEAD) / 2} dy="22">Write</tspan>
				</text>
			{:else if reading}
				<line
					x1={ARROW_X_HEAD}
					y1={cy}
					x2={ARROW_X_TAIL}
					y2={cy}
					stroke={ACTIVE_STROKE}
					stroke-width="1.75"
					marker-end={`url(#${MARKER_ACTIVE})`}
				/>
				<text
					x={(ARROW_X_TAIL + ARROW_X_HEAD) / 2}
					y={cy - 40}
					text-anchor="middle"
					font-size="18"
					font-weight="500"
					letter-spacing="0.02em"
					fill={ACTIVE_STROKE}
				>
					<tspan x={(ARROW_X_TAIL + ARROW_X_HEAD) / 2} dy="0">Cache</tspan>
					<tspan x={(ARROW_X_TAIL + ARROW_X_HEAD) / 2} dy="22">Read</tspan>
				</text>
			{/if}
		{/each}

		<!-- ============================================================ -->
		<!-- Ghosts (above HBM, below RHS text/layers)                     -->
		<!-- ============================================================ -->
		{#each aboveHbmGhosts as g (g.id)}
			{@const gh = ghostFor(g)}
			<g
				transform="translate({gh.cx} {gh.cy}) scale({gh.scale})"
				opacity={gh.opacity}
				pointer-events="none"
			>
				{#if g.kind === 'rect'}
					<rect
						x={-g.size.w / 2}
						y={-g.size.h / 2}
						width={g.size.w}
						height={g.size.h}
						rx="5"
						ry="5"
						fill={g.style.fill}
						stroke={g.style.stroke}
						stroke-width="1"
					/>
				{:else}
					<rect
						x={-g.size.w / 2}
						y={-g.size.h / 2}
						width={g.size.w}
						height={g.size.h / 2}
						rx="2"
						fill={g.style.k}
						stroke={g.style.kvStroke}
						stroke-width="0.75"
					/>
					<rect
						x={-g.size.w / 2}
						y={0}
						width={g.size.w}
						height={g.size.h / 2}
						rx="2"
						fill={g.style.v}
						stroke={g.style.kvStroke}
						stroke-width="0.75"
					/>
				{/if}
			</g>
		{/each}

		<!-- ============================================================ -->
		<!-- RHS: prefix bracket, text tokens, Embed, layers, residuals    -->
		<!-- ============================================================ -->

		<!-- Prefix label (above the bracket) -->
		<text
			x={(PREFIX_X0 + PREFIX_X1) / 2}
			y={Y_PREFIX_LABEL + PREFIX_LABEL_H / 2}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="18"
			font-weight="500"
			fill={BLOCK_LABEL_COLOR}
		>
			Prefix
		</text>
		<!-- Prefix bracket -->
		<path
			d={`M ${PREFIX_X0} ${Y_PREFIX_BRACKET + PREFIX_BRACKET_H} L ${PREFIX_X0} ${Y_PREFIX_BRACKET + PREFIX_BRACKET_H - PREFIX_TICK} L ${PREFIX_X1} ${Y_PREFIX_BRACKET + PREFIX_BRACKET_H - PREFIX_TICK} L ${PREFIX_X1} ${Y_PREFIX_BRACKET + PREFIX_BRACKET_H}`}
			fill="none"
			stroke={MUTED}
			stroke-width="1.25"
			stroke-linejoin="round"
		/>

		<!-- Text tokens: prompt tokens always visible; decoded slots appear
			 as dashed placeholders and fade in as their return ghost lands
			 (prefill_return for slot 6, decode_return_{col} for slot col+1). -->
		{#each inputWords as word, i}
			{@const isPromptSlot = i < N_PROMPT}
			{@const returnP = returnProgressForSlot(i)}
			{@const opacity = isPromptSlot ? 1 : returnP >= 1 ? 1 : Math.max(0, returnP)}
			{@const active = isActivePosition(i)}
			{#if !isPromptSlot && opacity < 1}
				<rect
					x={tokenCenterX(i) - TOKEN_SIZE / 2}
					y={Y_TEXT + TEXT_ROW_H / 2 - TOKEN_SIZE / 2}
					width={TOKEN_SIZE}
					height={TOKEN_SIZE}
					rx="5"
					ry="5"
					fill="none"
					stroke={active ? ACTIVE_STROKE : TOKEN_STROKE}
					stroke-width="1"
					opacity={1 - opacity}
				/>
			{/if}
			<text
				x={tokenCenterX(i)}
				y={Y_TEXT + TEXT_ROW_H / 2}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="19"
				fill={active ? ACTIVE_STROKE : BLOCK_LABEL_COLOR}
				opacity={opacity}
			>
				{word}
			</text>
		{/each}

		<!-- Embedding block. Marching-ants outline while any embed channel
			 is running (prefill or decode). -->
		<rect
			class:active-layer-outline={isActiveEmbed()}
			x={LAYER_X}
			y={Y_EMBED}
			width={LAYER_W}
			height={LAYER_BLOCK_H}
			rx="8"
			ry="8"
			fill={TX_FILL}
			stroke={isActiveEmbed() ? ACTIVE_LAYER_OUTLINE : TX_STROKE}
			stroke-width={isActiveEmbed() ? '1.5' : '1'}
		/>
		<text
			x={LAYER_X + LAYER_W / 2}
			y={Y_EMBED + LAYER_BLOCK_H / 2}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="18"
			font-weight="500"
			fill={isActiveEmbed() ? ACTIVE_STROKE : BLOCK_LABEL_COLOR}
		>
			Embedding
		</text>

		<!-- Per-layer stack: residual row (input to layer k), then layer k block -->
		{#each Array(N_LAYERS) as _, k}
			<!-- Residual row feeding layer k. Cells that haven't been produced
				 yet are dashed placeholders; once their producing ghost
				 completes, they appear filled. The column at the currently-
				 decoded position is highlighted green. -->
			{#each Array(N_INPUT_COLS) as _, i}
				{@const visible = residualVisible(k, i)}
				{@const active = isActivePosition(i)}
				<rect
					x={tokenX(i)}
					y={Y_ROW[k] + (TOKEN_ROW_H - TOKEN_SIZE) / 2}
					width={TOKEN_SIZE}
					height={TOKEN_SIZE}
					rx="5"
					ry="5"
					fill={visible ? (active ? ACTIVE_FILL : TOKEN_FILL) : 'none'}
					stroke={active ? ACTIVE_STROKE : TOKEN_STROKE}
					stroke-width="1"
				/>
			{/each}
			<!-- Attention layer k block. When active, the SAME outline
				 animates as marching ants — no second rect stacked on top. -->
			{@const layerActive = isActiveLayer(k)}
			<rect
				class:active-layer-outline={layerActive}
				x={LAYER_X}
				y={Y_L[k]}
				width={LAYER_W}
				height={LAYER_BLOCK_H}
				rx="8"
				ry="8"
				fill={TX_FILL}
				stroke={layerActive ? ACTIVE_LAYER_OUTLINE : TX_STROKE}
				stroke-width={layerActive ? '1.5' : '1'}
			/>
			<text
				x={LAYER_X + LAYER_W / 2}
				y={Y_L[k] + LAYER_BLOCK_H / 2}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="18"
				font-weight="500"
				fill={isActiveLayer(k) ? ACTIVE_STROKE : BLOCK_LABEL_COLOR}
			>
				Attention Layer {k + 1}
			</text>
		{/each}

		<!-- Output residual row (below last layer). Uses rowIdx=N_LAYERS
			 in residualProducerChannel — producer is the last layer's flow. -->
		{#each Array(N_INPUT_COLS) as _, i}
			{@const visible = residualVisible(N_LAYERS, i)}
			{@const active = isActivePosition(i)}
			<rect
				x={tokenX(i)}
				y={Y_ROW_OUT + (TOKEN_ROW_H - TOKEN_SIZE) / 2}
				width={TOKEN_SIZE}
				height={TOKEN_SIZE}
				rx="5"
				ry="5"
				fill={visible ? (active ? ACTIVE_FILL : TOKEN_FILL) : 'none'}
				stroke={active ? ACTIVE_STROKE : TOKEN_STROKE}
				stroke-width="1"
			/>
		{/each}
		<!-- Unembedding block. Marching-ants outline while unembed/return
			 for any decoded position is running. -->
		<rect
			class:active-layer-outline={isActiveUnembed()}
			x={LAYER_X}
			y={Y_UNEMBED}
			width={LAYER_W}
			height={LAYER_BLOCK_H}
			rx="8"
			ry="8"
			fill={TX_FILL}
			stroke={isActiveUnembed() ? ACTIVE_LAYER_OUTLINE : TX_STROKE}
			stroke-width={isActiveUnembed() ? '1.5' : '1'}
		/>
		<text
			x={LAYER_X + LAYER_W / 2}
			y={Y_UNEMBED + LAYER_BLOCK_H / 2}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="18"
			font-weight="500"
			fill={isActiveUnembed() ? ACTIVE_STROKE : BLOCK_LABEL_COLOR}
		>
			Unembedding
		</text>

		<!-- Unembed → OUTPUT_TOKENS: one arrow per (input column, output
			 slot) pair. Diagonal — column c's residual maps to slot c+1
			 in the output-tokens row. This is where the shift-by-one is
			 visually explicit. Appears once the unembed animation begins
			 and stays for the rest of the loop. -->
		{#each unembedProductions as prod}
			{@const unembedP = animState[prod.unembedChannel]?.progress ?? -1}
			{#if unembedP > 0}
				<line
					x1={tokenCenterX(prod.col)}
					y1={Y_UNEMBED + LAYER_BLOCK_H}
					x2={tokenCenterX(prod.slot)}
					y2={Y_OUTPUT_TOKENS - FLOW_INSET}
					stroke={FLOW_STROKE}
					stroke-width="2"
					marker-end={`url(#${MARKER_FLOW})`}
				/>
			{/if}
		{/each}

		<!-- Output-tokens row: predicted word appears at slot col+1 once
			 Unembed produces it. Sits statically once revealed; the
			 corresponding return ghost animates a COPY up to the text row. -->
		{#each unembedProductions as prod}
			{@const unembedP = animState[prod.unembedChannel]?.progress ?? -1}
			{@const returnP = animState[prod.returnChannel]?.progress ?? -1}
			{@const shown = unembedP >= 1}
			{#if shown}
				<text
					x={tokenCenterX(prod.slot)}
					y={Y_OUTPUT_TOKENS + TEXT_ROW_H / 2}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="19"
					font-weight="600"
					fill={returnP >= 1 ? BLOCK_LABEL_COLOR : ACTIVE_STROKE}
				>
					{inputWords[prod.slot]}
				</text>
			{/if}
		{/each}

		<!-- (Dynamic read/write arrows rendered earlier, before aboveHbmGhosts,
			 so K/V pair ghosts paint on TOP of the arrow rather than under it.) -->

		<!-- ============================================================ -->
		<!-- Ghosts (above ALL — HBM, layer blocks, decoded rows).         -->
		<!-- Used by the decode-return ghost so the freshly-decoded token  -->
		<!-- floats on top of the network with a legible white backdrop.  -->
		<!-- ============================================================ -->
		{#each aboveAllGhosts as g (g.id)}
			{@const gh = ghostFor(g)}
			<g
				transform="translate({gh.cx} {gh.cy}) scale({gh.scale})"
				opacity={gh.opacity}
				pointer-events="none"
			>
				{#if g.kind === 'text'}
					{@const fs = g.style.textFontSize ?? 15}
					{@const label = g.style.text ?? ''}
					{@const bgW = Math.max(28, label.length * fs * 0.62 + 12)}
					{@const bgH = fs + 8}
					<rect
						x={-bgW / 2}
						y={-bgH / 2}
						width={bgW}
						height={bgH}
						rx="6"
						ry="6"
						fill="rgba(255, 255, 255, 0.85)"
					/>
					<text
						x={0}
						y={0}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={fs}
						font-weight="600"
						fill={g.style.textFill ?? ACTIVE_STROKE}
					>
						{label}
					</text>
				{:else if g.kind === 'rect'}
					<rect
						x={-g.size.w / 2 - 4}
						y={-g.size.h / 2 - 4}
						width={g.size.w + 8}
						height={g.size.h + 8}
						rx="6"
						ry="6"
						fill="rgba(255, 255, 255, 0.85)"
					/>
					<rect
						x={-g.size.w / 2}
						y={-g.size.h / 2}
						width={g.size.w}
						height={g.size.h}
						rx="5"
						ry="5"
						fill={g.style.fill}
						stroke={g.style.stroke}
						stroke-width="1"
					/>
				{/if}
			</g>
		{/each}
	</svg>
</TabbedFolder>

<style>
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	/* Marching-ants outline on the active attention layer. Total dash
	 * pattern (dash + gap) = 12; animating stroke-dashoffset from 0 to 12
	 * scrolls the pattern exactly one cycle. */
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
