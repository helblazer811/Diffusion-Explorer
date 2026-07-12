<script lang="ts">
	// DFlash speculative-decoding figure. Zoomed-in view of one draft/verify
	// cycle. LHS is a small block-diffusion drafter; RHS is a big AR target
	// with a prefilled prefix. Between them, a feature cache column holds
	// the target's tapped hidden states, which the drafter reads from during
	// its forward pass — analogous to how KVCacheFigure shows KV reads.
	//
	// Animation phases:
	//   P1 target-prefill      — prompt flows through target; each tapped
	//                            layer's hidden state fills a feature cell.
	//   P2 parallel-denoise    — drafter runs; each drafter layer's activation
	//                            is preceded by a "read from features" ghost.
	//                            γ−1 masked drafter positions reveal in parallel.
	//   P3 verify              — drafted block flies to target; target activates;
	//                            first 2 tokens accept (green), 3rd rejects (red).
	//   P4 hold                — settled state; loop.
	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import type { Chapter } from '@diffusion-explorer/ui';

	interface Props {
		isActive?: Writable<boolean>;
		width?: number;
	}
	let { isActive, width = 1000 }: Props = $props();

	// --- Palette (matches KVCacheFigure for visual continuity) ---
	const MUTED = '#888';
	const BLOCK_LABEL_COLOR = '#5a5a5a';
	const TX_FILL = '#f4f6fa';
	const TX_STROKE = '#c8ccd1';
	const TOKEN_FILL = '#3879EF';
	const TOKEN_STROKE = '#1F55B5';
	const ACTIVE_FILL = '#FBD3A3';
	const ACTIVE_STROKE = '#F1942B';
	const ACTIVE_LAYER_OUTLINE = '#F1942B';
	// Feature cache colors — distinct from token blue and K/V green/pink.
	const FEAT_FILL = '#c4b8ff';
	const FEAT_STROKE = '#6b5cd6';
	const INJECT_COLOR = '#7c6cff';
	// Verification flash colors.
	const ACCEPT_GREEN = '#4AD77A';
	const ACCEPT_GREEN_STROKE = '#2FA359';
	const REJECT_RED = '#EF6A6A';
	const REJECT_RED_STROKE = '#B34141';
	const FLOW_STROKE = '#b5bdc7';

	// --- Sequence configuration ---
	// Target: 8 positions total. Positions 0..N_PROMPT-1 are the prompt
	// (prefilled). Positions N_PROMPT..N_PROMPT+GAMMA-1 are the drafted
	// block (γ=3 draft positions). N_PROMPT+GAMMA..last are empty.
	// The rightmost prompt token acts as the anchor (rendered normally,
	// but its position marks where the draft block starts).
	const targetWords: string[] = ['Where', 'is', 'the', 'Eiffel', 'Tower', '?'];
	const N_PROMPT = targetWords.length;
	const GAMMA = 3;
	const N_TARGET_TOKENS = N_PROMPT + GAMMA; // 9 slots total? — actually 6+3=9
	const targetPromptIndices = Array.from({ length: N_PROMPT }, (_, i) => i);
	const draftBlockIndices = Array.from({ length: GAMMA }, (_, i) => N_PROMPT + i);
	// Fixed accept/reject pattern for one loop iteration.
	// Index 0 of draftBlockIndices → accept; index 1 → accept; index 2 → reject.
	const acceptMask: boolean[] = [true, true, false];
	// Words the drafter proposes (used to render text on the target after verify).
	const draftedWords: string[] = ['In', 'Paris', 'today'];

	// --- Target (RHS) geometry — 4 layers ---
	const N_TARGET_LAYERS = 4;
	// --- Drafter (LHS) geometry — 2 layers, narrower panel, smaller layer bands ---
	const N_DRAFTER_LAYERS = 2;
	// Tapped target layers: uniformly sample from shallow→deep, avoiding
	// the very first and very last.
	const tappedTargetLayers = Array.from({ length: N_DRAFTER_LAYERS }, (_, i) => {
		// Spread N_DRAFTER_LAYERS taps evenly across layers 1..N_TARGET_LAYERS-1.
		const t = (i + 1) / (N_DRAFTER_LAYERS + 1);
		return Math.round(t * (N_TARGET_LAYERS - 1));
	});
	// Which drafter layer receives which tap. We use a 1:1 mapping: drafter
	// layer k reads from feature cell k (which itself sources from
	// tappedTargetLayers[k] of the target).
	const N_FEAT_CELLS = N_DRAFTER_LAYERS;

	// --- Row geometry ---
	const TEXT_ROW_H = 40;
	const TOKEN_ROW_H = 30;
	const LAYER_BLOCK_H = 38;
	const LAYER_BLOCK_H_DRAFTER = 30; // shorter to signal "lightweight"
	const ROW_GAP = 22;
	const PREFIX_BRACKET_H = 20;
	const PREFIX_LABEL_H = 18;
	const TOP_PADDING = 12;
	const BOTTOM_PADDING = 20;
	const COL_HEADER_H = 32;
	const COL_HEADER_Y = 18;
	const COL_HEADER_FONT_SIZE = 22;

	// --- Target row stack (RHS) — anchors ---
	const targetRowMeta: { key: string; h: number }[] = [
		{ key: 'PREFIX_LABEL', h: PREFIX_LABEL_H },
		{ key: 'PREFIX_BRACKET', h: PREFIX_BRACKET_H },
		{ key: 'TEXT', h: TEXT_ROW_H },
		{ key: 'EMBED', h: LAYER_BLOCK_H }
	];
	for (let k = 0; k < N_TARGET_LAYERS; k++) {
		targetRowMeta.push({ key: `ROW_${k}`, h: TOKEN_ROW_H });
		targetRowMeta.push({ key: `L${k}`, h: LAYER_BLOCK_H });
	}
	targetRowMeta.push({ key: 'ROW_OUT', h: TOKEN_ROW_H });

	const targetY: Record<string, number> = {};
	{
		let y = 20 + TOP_PADDING + COL_HEADER_H;
		for (const r of targetRowMeta) {
			targetY[r.key] = y;
			const inPrefix = r.key === 'PREFIX_LABEL' || r.key === 'PREFIX_BRACKET' || r.key === 'TEXT';
			const nextInPrefix = r.key === 'PREFIX_LABEL' || r.key === 'PREFIX_BRACKET';
			y += r.h + (inPrefix && nextInPrefix ? 2 : ROW_GAP);
		}
	}
	const T_PREFIX_LABEL_Y = targetY.PREFIX_LABEL;
	const T_PREFIX_BRACKET_Y = targetY.PREFIX_BRACKET;
	const T_TEXT_Y = targetY.TEXT;
	const T_EMBED_Y = targetY.EMBED;
	const T_ROW_Y = Array.from({ length: N_TARGET_LAYERS }, (_, k) => targetY[`ROW_${k}`]);
	const T_L_Y = Array.from({ length: N_TARGET_LAYERS }, (_, k) => targetY[`L${k}`]);
	const T_ROW_OUT_Y = targetY.ROW_OUT;

	// --- Drafter row stack (LHS) — anchors ---
	// No prefix label/bracket; context comes from feature injections.
	// Vertically centered against the target so the drafter sits roughly
	// mid-height of the target stack.
	const drafterRowMeta: { key: string; h: number }[] = [
		{ key: 'TEXT', h: TEXT_ROW_H },
		{ key: 'EMBED', h: LAYER_BLOCK_H_DRAFTER }
	];
	for (let k = 0; k < N_DRAFTER_LAYERS; k++) {
		drafterRowMeta.push({ key: `ROW_${k}`, h: TOKEN_ROW_H });
		drafterRowMeta.push({ key: `L${k}`, h: LAYER_BLOCK_H_DRAFTER });
	}
	drafterRowMeta.push({ key: 'ROW_OUT', h: TOKEN_ROW_H });

	const drafterInnerH = (() => {
		let h = 0;
		for (const r of drafterRowMeta) h += r.h + ROW_GAP;
		return h - ROW_GAP;
	})();
	const targetInnerH = (() => {
		const first = 20 + TOP_PADDING + COL_HEADER_H;
		return (T_ROW_OUT_Y + TOKEN_ROW_H) - first;
	})();
	// Drafter Y starts at the target embed row and extends downward.
	// This aligns the drafter's layer stack with the middle band of the target
	// so injection arrows are roughly horizontal.
	const drafterTopY = T_EMBED_Y + (targetInnerH - drafterInnerH - COL_HEADER_H) / 2 + 12;

	const drafterY: Record<string, number> = {};
	{
		let y = drafterTopY;
		for (const r of drafterRowMeta) {
			drafterY[r.key] = y;
			y += r.h + ROW_GAP;
		}
	}
	const D_TEXT_Y = drafterY.TEXT;
	const D_EMBED_Y = drafterY.EMBED;
	const D_ROW_Y = Array.from({ length: N_DRAFTER_LAYERS }, (_, k) => drafterY[`ROW_${k}`]);
	const D_L_Y = Array.from({ length: N_DRAFTER_LAYERS }, (_, k) => drafterY[`L${k}`]);
	const D_ROW_OUT_Y = drafterY.ROW_OUT;

	// --- Overall canvas ---
	const W = width;
	// Height dominated by the taller of the two stacks. Target is taller.
	const H = T_ROW_OUT_Y + TOKEN_ROW_H + BOTTOM_PADDING + 30;

	// --- Column horizontal split ---
	// Drafter panel (LHS): narrower.
	// Feature cache column: narrow strip in the gutter, anchored to the RHS.
	// Target panel (RHS): wider, with the full-width transformer.
	const LHS_X = 20;
	const LHS_W = 240; // drafter is noticeably smaller
	const GUTTER_W = 190; // the aisle where injection + verify arrows travel
	const FEAT_COL_W = 60;
	const RHS_X = LHS_X + LHS_W + GUTTER_W;
	const RHS_W = W - RHS_X - 20;

	// Feature cache column: sits just to the RIGHT of the drafter, in the gutter.
	// (The features "belong" to the target, but we place them close to the
	// drafter so per-layer read arrows are short.)
	const FEAT_X = LHS_X + LHS_W + 30;

	// --- Target layer geometry (RHS) ---
	const T_LAYER_X = RHS_X + 8;
	const T_LAYER_W = RHS_W - 16;
	const T_TOKEN_SIZE = 20;
	const T_TOKEN_STRIDE = T_LAYER_W / N_TARGET_TOKENS;
	function tX(i: number): number {
		return T_LAYER_X + i * T_TOKEN_STRIDE + T_TOKEN_STRIDE / 2 - T_TOKEN_SIZE / 2;
	}
	function tCx(i: number): number {
		return tX(i) + T_TOKEN_SIZE / 2;
	}

	// --- Drafter layer geometry (LHS) ---
	const D_LAYER_X = LHS_X + 8;
	const D_LAYER_W = LHS_W - 16;
	const D_TOKEN_SIZE = 18; // slightly smaller than target — subtle size cue
	// Drafter renders GAMMA positions across its width.
	const D_TOKEN_STRIDE = D_LAYER_W / GAMMA;
	function dX(i: number): number {
		return D_LAYER_X + i * D_TOKEN_STRIDE + D_TOKEN_STRIDE / 2 - D_TOKEN_SIZE / 2;
	}
	function dCx(i: number): number {
		return dX(i) + D_TOKEN_SIZE / 2;
	}

	// --- Feature cache column ---
	// One rounded-rect cell per tapped layer, stacked vertically.
	// Vertically aligned so each cell sits at roughly the same y as its
	// corresponding drafter layer center (so the injection arrow is roughly
	// horizontal).
	const FEAT_CELL_H = 26;
	const FEAT_CELL_W = FEAT_COL_W - 8;
	function featCellY(k: number): number {
		// Align feature cell k with drafter layer k's center.
		const layerCenter = D_L_Y[k] + LAYER_BLOCK_H_DRAFTER / 2;
		return layerCenter - FEAT_CELL_H / 2;
	}
	function featCellCenter(k: number): { x: number; y: number } {
		return { x: FEAT_X + FEAT_CELL_W / 2, y: featCellY(k) + FEAT_CELL_H / 2 };
	}
	// Feature column label sits above the topmost cell.
	const FEAT_LABEL_Y = featCellY(0) - 22;

	// --- Prefix bracket geometry (target) ---
	const PREFIX_X0 = tCx(0);
	const PREFIX_X1 = tCx(N_PROMPT - 1);
	const PREFIX_TICK = 6;

	// ================================================================
	// Flow-ghost primitive (verbatim from KVCacheFigure).
	// ================================================================
	function flowGhost(
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
		p: number,
		endScale = 1,
		fadeInEnd = 0.05,
		fadeOutStart = 0.85,
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

	// ================================================================
	// Animation state — dynamic channel bag.
	// ================================================================
	type GhostChannel = { progress: number };
	type AnimationState = Record<string, GhostChannel>;

	// Ghost specs.
	type GhostKind = 'rect' | 'feat' | 'text';
	type GhostLayer = 'behind' | 'above';
	type GhostSpec = {
		id: string;
		kind: GhostKind;
		layer: GhostLayer;
		from: { x: number; y: number };
		to: { x: number; y: number };
		size: { w: number; h: number };
		style: { fill: string; stroke: string; text?: string };
	};

	const T_RECT_STYLE = { fill: TOKEN_FILL, stroke: TOKEN_STROKE };
	const T_RECT_SIZE = { w: T_TOKEN_SIZE, h: T_TOKEN_SIZE };
	const D_RECT_STYLE = { fill: TOKEN_FILL, stroke: TOKEN_STROKE };
	const D_RECT_SIZE = { w: D_TOKEN_SIZE, h: D_TOKEN_SIZE };
	const FEAT_STYLE = { fill: FEAT_FILL, stroke: FEAT_STROKE };
	const FEAT_SIZE = { w: FEAT_CELL_W - 8, h: FEAT_CELL_H - 6 };

	// --- Ghost builders ---

	// Target prefill: text → row 0.
	function buildTargetPrefillEmbed(): GhostSpec[] {
		return targetPromptIndices.map((i) => ({
			id: `t_prefill_embed_${i}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			from: { x: tCx(i), y: T_TEXT_Y + TEXT_ROW_H / 2 },
			to: { x: tCx(i), y: T_ROW_Y[0] + TOKEN_ROW_H / 2 },
			size: T_RECT_SIZE,
			style: T_RECT_STYLE
		}));
	}
	// Target prefill layer k: row_k → layer top; layer bottom → next row.
	function buildTargetPrefillLayer(k: number): GhostSpec[] {
		const nextY = k + 1 < N_TARGET_LAYERS ? T_ROW_Y[k + 1] + TOKEN_ROW_H / 2 : T_ROW_OUT_Y + TOKEN_ROW_H / 2;
		const flows = targetPromptIndices.map((i) => ({
			id: `t_prefill_flow_${k}_${i}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			from: { x: tCx(i), y: T_ROW_Y[k] + TOKEN_ROW_H / 2 },
			to: { x: tCx(i), y: T_L_Y[k] },
			size: T_RECT_SIZE,
			style: T_RECT_STYLE
		}));
		const emerges = targetPromptIndices.map((i) => ({
			id: `t_prefill_emerge_${k}_${i}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			from: { x: tCx(i), y: T_L_Y[k] + LAYER_BLOCK_H },
			to: { x: tCx(i), y: nextY },
			size: T_RECT_SIZE,
			style: T_RECT_STYLE
		}));
		return [...flows, ...emerges];
	}
	// Feature-fill ghost: after tapped-layer's emerge completes, a "feature"
	// ghost travels from that layer's left edge to feature cell k.
	function buildFeatureFillGhost(featIdx: number): GhostSpec {
		const srcLayer = tappedTargetLayers[featIdx];
		return {
			id: `feat_fill_${featIdx}`,
			kind: 'feat' as const,
			layer: 'above' as const,
			from: { x: T_LAYER_X, y: T_L_Y[srcLayer] + LAYER_BLOCK_H / 2 },
			to: featCellCenter(featIdx),
			size: FEAT_SIZE,
			style: FEAT_STYLE
		};
	}
	// Drafter embed ghost — from drafter text row → row 0.
	function buildDrafterEmbedGhosts(): GhostSpec[] {
		const positions = Array.from({ length: GAMMA }, (_, i) => i);
		return positions.map((i) => ({
			id: `d_embed_${i}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			from: { x: dCx(i), y: D_TEXT_Y + TEXT_ROW_H / 2 },
			to: { x: dCx(i), y: D_ROW_Y[0] + TOKEN_ROW_H / 2 },
			size: D_RECT_SIZE,
			style: D_RECT_STYLE
		}));
	}
	// Drafter layer k flow & emerge.
	function buildDrafterLayerGhosts(k: number): GhostSpec[] {
		const nextY = k + 1 < N_DRAFTER_LAYERS ? D_ROW_Y[k + 1] + TOKEN_ROW_H / 2 : D_ROW_OUT_Y + TOKEN_ROW_H / 2;
		const positions = Array.from({ length: GAMMA }, (_, i) => i);
		const flows = positions.map((i) => ({
			id: `d_flow_${k}_${i}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			from: { x: dCx(i), y: D_ROW_Y[k] + TOKEN_ROW_H / 2 },
			to: { x: dCx(i), y: D_L_Y[k] },
			size: D_RECT_SIZE,
			style: D_RECT_STYLE
		}));
		const emerges = positions.map((i) => ({
			id: `d_emerge_${k}_${i}`,
			kind: 'rect' as const,
			layer: 'behind' as const,
			from: { x: dCx(i), y: D_L_Y[k] + LAYER_BLOCK_H_DRAFTER },
			to: { x: dCx(i), y: nextY },
			size: D_RECT_SIZE,
			style: D_RECT_STYLE
		}));
		return [...flows, ...emerges];
	}
	// Feature injection ghost: feature cell k → drafter layer k left edge.
	function buildInjectionGhost(k: number): GhostSpec {
		const src = featCellCenter(k);
		const dst = { x: D_LAYER_X, y: D_L_Y[k] + LAYER_BLOCK_H_DRAFTER / 2 };
		return {
			id: `inject_${k}`,
			kind: 'feat' as const,
			layer: 'above' as const,
			from: src,
			to: dst,
			size: FEAT_SIZE,
			style: FEAT_STYLE
		};
	}
	// Verification ghost: drafter output position i → target text row at
	// position N_PROMPT + i. Uses the accepted color at the end.
	function buildVerifyGhost(i: number): GhostSpec {
		return {
			id: `verify_${i}`,
			kind: 'rect' as const,
			layer: 'above' as const,
			from: { x: dCx(i), y: D_ROW_OUT_Y + TOKEN_ROW_H / 2 },
			to: { x: tCx(N_PROMPT + i), y: T_TEXT_Y + TEXT_ROW_H / 2 },
			size: T_RECT_SIZE,
			style: T_RECT_STYLE
		};
	}

	const ghostSpecs: GhostSpec[] = [
		...buildTargetPrefillEmbed(),
		...Array.from({ length: N_TARGET_LAYERS }, (_, k) => buildTargetPrefillLayer(k)).flat(),
		...Array.from({ length: N_FEAT_CELLS }, (_, k) => buildFeatureFillGhost(k)),
		...buildDrafterEmbedGhosts(),
		...Array.from({ length: N_DRAFTER_LAYERS }, (_, k) => buildDrafterLayerGhosts(k)).flat(),
		...Array.from({ length: N_DRAFTER_LAYERS }, (_, k) => buildInjectionGhost(k)),
		...Array.from({ length: GAMMA }, (_, i) => buildVerifyGhost(i))
	];
	const behindGhosts = ghostSpecs.filter((g) => g.layer === 'behind');
	const aboveGhosts = ghostSpecs.filter((g) => g.layer === 'above');

	function buildInitialState(): AnimationState {
		const s: AnimationState = {};
		for (const g of ghostSpecs) s[g.id] = { progress: -1 };
		return s;
	}
	const INITIAL_STATE: AnimationState = buildInitialState();

	let animState = $state<AnimationState>(buildInitialState());
	let player = $state<Player<AnimationState> | undefined>(undefined);
	let chapters = $state<Chapter[]>([]);

	// --- Derived state predicates ---

	// Target layer k is active during its prefill flow/emerge.
	function isTargetLayerActive(k: number): boolean {
		for (const i of targetPromptIndices) {
			const f = animState[`t_prefill_flow_${k}_${i}`]?.progress ?? -1;
			const e = animState[`t_prefill_emerge_${k}_${i}`]?.progress ?? -1;
			if (f > 0 && f < 1) return true;
			if (e > 0 && e < 1) return true;
		}
		// Also active during verify pass — target is re-running over the block.
		const vp = animState.verify_pass?.progress ?? -1;
		return vp > 0 && vp < 1;
	}
	function isTargetEmbedActive(): boolean {
		for (const i of targetPromptIndices) {
			const p = animState[`t_prefill_embed_${i}`]?.progress ?? -1;
			if (p > 0 && p < 1) return true;
		}
		return false;
	}
	// Drafter layer k is active during its flow/emerge AND during its injection.
	function isDrafterLayerActive(k: number): boolean {
		for (let i = 0; i < GAMMA; i++) {
			const f = animState[`d_flow_${k}_${i}`]?.progress ?? -1;
			const e = animState[`d_emerge_${k}_${i}`]?.progress ?? -1;
			if (f > 0 && f < 1) return true;
			if (e > 0 && e < 1) return true;
		}
		const inj = animState[`inject_${k}`]?.progress ?? -1;
		return inj > 0 && inj < 1;
	}
	function isDrafterEmbedActive(): boolean {
		for (let i = 0; i < GAMMA; i++) {
			const p = animState[`d_embed_${i}`]?.progress ?? -1;
			if (p > 0 && p < 1) return true;
		}
		return false;
	}
	// A residual cell is visible after its producer ghost completes.
	function targetResidualVisible(rowIdx: number, i: number): boolean {
		if (i >= N_PROMPT) return false;
		if (rowIdx === 0) {
			return (animState[`t_prefill_embed_${i}`]?.progress ?? -1) >= 1;
		}
		const k = rowIdx - 1;
		return (animState[`t_prefill_emerge_${k}_${i}`]?.progress ?? -1) >= 1;
	}
	function drafterResidualVisible(rowIdx: number, i: number): boolean {
		if (rowIdx === 0) {
			return (animState[`d_embed_${i}`]?.progress ?? -1) >= 1;
		}
		const k = rowIdx - 1;
		return (animState[`d_emerge_${k}_${i}`]?.progress ?? -1) >= 1;
	}
	// Drafter's output (masked positions) becomes visible after the parallel
	// denoise reveal channel completes.
	function drafterOutputVisible(i: number): boolean {
		return (animState.d_reveal?.progress ?? -1) >= 1;
	}
	// Feature cell k is filled after its feat_fill ghost completes.
	function featCellFilled(k: number): boolean {
		return (animState[`feat_fill_${k}`]?.progress ?? -1) >= 1;
	}
	// Target output text at position (N_PROMPT + i) — states:
	//   before verify pass → hidden
	//   verify pass in progress → dashed placeholder
	//   after verify:
	//     accepted → shown in ACCEPT_GREEN, then locked as prompt-styled text
	//     rejected → briefly REJECT_RED, then reverts to [MASK]
	function draftedTokenState(i: number): 'hidden' | 'flashing' | 'accepted' | 'rejected-hold' | 'reverted' {
		const commitP = animState.commit?.progress ?? -1;
		const holdP = animState.hold?.progress ?? -1;
		if (commitP < 0) return 'hidden';
		if (commitP > 0 && commitP < 1) return 'flashing';
		// After commit completes:
		if (acceptMask[i]) return 'accepted';
		// Rejected: during the rollback (part of hold's first half), briefly red,
		// then reverts.
		if (holdP > 0 && holdP < 0.4) return 'rejected-hold';
		return 'reverted';
	}

	// ================================================================
	// Timeline builder.
	// ================================================================
	const T_FLOW = 900;
	const T_HOLD = 300;
	const T_FEAT_FILL = 800;
	const T_INJECT = 900;
	const T_DRAFT_REVEAL = 600;
	const T_VERIFY = 1100;
	const T_COMMIT = 900;
	const T_END_HOLD = 1400;

	function parallelFlow(ids: string[]) {
		return ids.map((id) => ({
			name: `flow-${id}`,
			reduce: (t: number) => ({ [id]: { progress: t } }) as Partial<AnimationState>
		}));
	}
	function parallelHold(ids: string[]) {
		return {
			name: `hold-${ids.join('+').slice(0, 40)}`,
			reduce: (_t: number) => {
				const patch: AnimationState = {};
				for (const id of ids) patch[id] = { progress: 2 };
				return patch;
			}
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
			reduce: (_t: number) => ({ [id]: { progress: 2 } }) as Partial<AnimationState>
		};
	}

	function buildTimeline(): {
		timeline: ReturnType<TimelineBuilder<AnimationState>['build']>;
		chapters: Chapter[];
	} {
		const b = new TimelineBuilder<AnimationState>().setInitialState(INITIAL_STATE);
		const raw: { ms: number; label: string }[] = [];
		function chap(label: string) {
			raw.push({ ms: b.totalDurationMs, label });
		}

		// --- P1: Target prefill ---
		chap('Prefill: target embeds prompt');
		const embedIds = targetPromptIndices.map((i) => `t_prefill_embed_${i}`);
		b.add(parallelFlow(embedIds), { durationMs: T_FLOW });
		b.add(parallelHold(embedIds), { durationMs: T_HOLD });

		for (let k = 0; k < N_TARGET_LAYERS; k++) {
			const flowIds = targetPromptIndices.map((i) => `t_prefill_flow_${k}_${i}`);
			const emergeIds = targetPromptIndices.map((i) => `t_prefill_emerge_${k}_${i}`);
			chap(`Prefill: target attention layer ${k + 1}`);
			b.add(parallelFlow(flowIds), { durationMs: T_FLOW });
			b.add(parallelHold(flowIds), { durationMs: T_HOLD });
			b.add(parallelFlow(emergeIds), { durationMs: T_FLOW });
			b.add(parallelHold(emergeIds), { durationMs: T_HOLD });
			// If this layer is a tapped layer, cache its features.
			const featIdx = tappedTargetLayers.indexOf(k);
			if (featIdx !== -1) {
				chap(`Prefill: cache hidden features from layer ${k + 1}`);
				b.add(singleFlow(`feat_fill_${featIdx}`), { durationMs: T_FEAT_FILL });
				b.add(singleHold(`feat_fill_${featIdx}`), { durationMs: T_HOLD });
			}
		}

		// --- P2: Drafter parallel denoise, with per-layer feature injection ---
		chap('Draft: embed masked block');
		const dEmbedIds = Array.from({ length: GAMMA }, (_, i) => `d_embed_${i}`);
		b.add(parallelFlow(dEmbedIds), { durationMs: T_FLOW });
		b.add(parallelHold(dEmbedIds), { durationMs: T_HOLD });

		for (let k = 0; k < N_DRAFTER_LAYERS; k++) {
			chap(`Draft: inject features into drafter layer ${k + 1}`);
			b.add(singleFlow(`inject_${k}`), { durationMs: T_INJECT });
			b.add(singleHold(`inject_${k}`), { durationMs: T_HOLD });

			chap(`Draft: drafter attention layer ${k + 1}`);
			const flowIds = Array.from({ length: GAMMA }, (_, i) => `d_flow_${k}_${i}`);
			const emergeIds = Array.from({ length: GAMMA }, (_, i) => `d_emerge_${k}_${i}`);
			b.add(parallelFlow(flowIds), { durationMs: T_FLOW });
			b.add(parallelHold(flowIds), { durationMs: T_HOLD });
			b.add(parallelFlow(emergeIds), { durationMs: T_FLOW });
			b.add(parallelHold(emergeIds), { durationMs: T_HOLD });
		}

		// Reveal drafter's output block — all γ positions denoise in parallel.
		chap('Draft: parallel unmasking of γ tokens');
		b.add(singleFlow('d_reveal'), { durationMs: T_DRAFT_REVEAL });
		b.add(singleHold('d_reveal'), { durationMs: T_HOLD });

		// --- P3: Verify — drafted block flies to target, target verifies ---
		chap('Verify: send draft to target');
		const verifyIds = Array.from({ length: GAMMA }, (_, i) => `verify_${i}`);
		b.add(parallelFlow(verifyIds), { durationMs: T_VERIFY });
		b.add(parallelHold(verifyIds), { durationMs: T_HOLD });

		chap('Verify: target checks the block in parallel');
		b.add(singleFlow('verify_pass'), { durationMs: T_FLOW });
		b.add(singleHold('verify_pass'), { durationMs: T_HOLD });

		chap('Verify: accept prefix, reject on mismatch');
		b.add(singleFlow('commit'), { durationMs: T_COMMIT });
		b.add(singleHold('commit'), { durationMs: T_HOLD });

		// --- P4: Hold ---
		b.add(singleFlow('hold'), { durationMs: T_END_HOLD });

		const totalMs = b.totalDurationMs;
		const chs: Chapter[] = raw.map((c) => ({
			time: totalMs > 0 ? c.ms / totalMs : 0,
			label: c.label
		}));
		return { timeline: b.build(), chapters: chs };
	}

	onMount(() => {
		const built = buildTimeline();
		chapters = built.chapters;
		player = new Player<AnimationState>(built.timeline, { looping: true, endPause: 0.05 });
		player.onTick((_t, s) => {
			animState = s;
		});
		const unsub = isActive?.subscribe((v) => {
			if (!player) return;
			if (v) player.play();
			else {
				player.pause();
				player.reset();
				animState = buildInitialState();
			}
		});
		return () => {
			unsub?.();
			player?.pause();
		};
	});

	function ghostFor(g: GhostSpec) {
		const p = animState[g.id]?.progress ?? -1;
		return flowGhost(g.from.x, g.from.y, g.to.x, g.to.y, p);
	}
</script>

<div class="wrap" style="max-width: {W}px">
	<svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet">
		<defs>
			<marker id="dflash-arrow-flow" viewBox="0 -5 10 10" refX="8" refY="0" markerWidth="4" markerHeight="4" orient="auto">
				<path d="M0,-5L10,0L0,5" fill={FLOW_STROKE} />
			</marker>
			<marker id="dflash-arrow-inject" viewBox="0 -5 10 10" refX="8" refY="0" markerWidth="5" markerHeight="5" orient="auto">
				<path d="M0,-5L10,0L0,5" fill={INJECT_COLOR} />
			</marker>
		</defs>

		<!-- Column headers -->
		<text
			x={LHS_X + LHS_W / 2}
			y={COL_HEADER_Y}
			text-anchor="middle"
			dominant-baseline="central"
			font-size={COL_HEADER_FONT_SIZE}
			font-weight="600"
			fill={BLOCK_LABEL_COLOR}
		>
			DFlash Drafter
		</text>
		<text
			x={RHS_X + RHS_W / 2}
			y={COL_HEADER_Y}
			text-anchor="middle"
			dominant-baseline="central"
			font-size={COL_HEADER_FONT_SIZE}
			font-weight="600"
			fill={BLOCK_LABEL_COLOR}
		>
			Autoregressive Target
		</text>

		<!-- ============================================================ -->
		<!-- Behind-layer ghosts (rendered under the RHS/LHS blocks).      -->
		<!-- ============================================================ -->
		{#each behindGhosts as g (g.id)}
			{@const gh = ghostFor(g)}
			<g transform="translate({gh.cx} {gh.cy})" opacity={gh.opacity} pointer-events="none">
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
			</g>
		{/each}

		<!-- ============================================================ -->
		<!-- TARGET (RHS)                                                  -->
		<!-- ============================================================ -->

		<!-- Prefix label + bracket -->
		<text
			x={(PREFIX_X0 + PREFIX_X1) / 2}
			y={T_PREFIX_LABEL_Y + PREFIX_LABEL_H / 2}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="16"
			font-weight="500"
			fill={BLOCK_LABEL_COLOR}
		>
			Prefix
		</text>
		<path
			d={`M ${PREFIX_X0} ${T_PREFIX_BRACKET_Y + PREFIX_BRACKET_H} L ${PREFIX_X0} ${T_PREFIX_BRACKET_Y + PREFIX_BRACKET_H - PREFIX_TICK} L ${PREFIX_X1} ${T_PREFIX_BRACKET_Y + PREFIX_BRACKET_H - PREFIX_TICK} L ${PREFIX_X1} ${T_PREFIX_BRACKET_Y + PREFIX_BRACKET_H}`}
			fill="none"
			stroke={MUTED}
			stroke-width="1.25"
			stroke-linejoin="round"
		/>

		<!-- Text row: prompt tokens always visible; drafted-block slots
			 render according to draftedTokenState(). -->
		{#each Array(N_TARGET_TOKENS) as _, i}
			{#if i < N_PROMPT}
				<text
					x={tCx(i)}
					y={T_TEXT_Y + TEXT_ROW_H / 2}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="17"
					fill={BLOCK_LABEL_COLOR}
				>
					{targetWords[i]}
				</text>
			{:else}
				{@const bi = i - N_PROMPT}
				{@const st = draftedTokenState(bi)}
				{#if st === 'hidden'}
					<!-- dashed placeholder while drafter runs -->
					<rect
						x={tCx(i) - T_TOKEN_SIZE / 2}
						y={T_TEXT_Y + TEXT_ROW_H / 2 - T_TOKEN_SIZE / 2}
						width={T_TOKEN_SIZE}
						height={T_TOKEN_SIZE}
						rx="5"
						ry="5"
						fill="none"
						stroke={TOKEN_STROKE}
						stroke-width="1"
						stroke-dasharray="3 3"
					/>
				{:else if st === 'flashing' || st === 'accepted'}
					<!-- Solid fill in accept green during flash, then locked green as prompt-styled text -->
					<rect
						x={tCx(i) - T_TOKEN_SIZE / 2}
						y={T_TEXT_Y + TEXT_ROW_H / 2 - T_TOKEN_SIZE / 2}
						width={T_TOKEN_SIZE}
						height={T_TOKEN_SIZE}
						rx="5"
						ry="5"
						fill={acceptMask[bi] ? ACCEPT_GREEN : (st === 'flashing' ? ACCEPT_GREEN : REJECT_RED)}
						stroke={acceptMask[bi] ? ACCEPT_GREEN_STROKE : (st === 'flashing' ? ACCEPT_GREEN_STROKE : REJECT_RED_STROKE)}
						stroke-width="1"
					/>
					<text
						x={tCx(i)}
						y={T_TEXT_Y + TEXT_ROW_H / 2}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="12"
						font-weight="600"
						fill="#fff"
					>
						{draftedWords[bi]}
					</text>
				{:else if st === 'rejected-hold'}
					<rect
						x={tCx(i) - T_TOKEN_SIZE / 2}
						y={T_TEXT_Y + TEXT_ROW_H / 2 - T_TOKEN_SIZE / 2}
						width={T_TOKEN_SIZE}
						height={T_TOKEN_SIZE}
						rx="5"
						ry="5"
						fill={REJECT_RED}
						stroke={REJECT_RED_STROKE}
						stroke-width="1"
					/>
					<text
						x={tCx(i)}
						y={T_TEXT_Y + TEXT_ROW_H / 2}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="12"
						font-weight="600"
						fill="#fff"
					>
						{draftedWords[bi]}
					</text>
				{:else}
					<!-- reverted → [MASK] slot -->
					<rect
						x={tCx(i) - T_TOKEN_SIZE / 2}
						y={T_TEXT_Y + TEXT_ROW_H / 2 - T_TOKEN_SIZE / 2}
						width={T_TOKEN_SIZE}
						height={T_TOKEN_SIZE}
						rx="5"
						ry="5"
						fill="#cfe0f2"
						stroke="#7ea3c8"
						stroke-width="1"
					/>
					<text
						x={tCx(i)}
						y={T_TEXT_Y + TEXT_ROW_H / 2}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="9"
						fill="#33506e"
					>
						[MASK]
					</text>
				{/if}
			{/if}
		{/each}

		<!-- Target embedding block -->
		<rect
			class:active-layer-outline={isTargetEmbedActive()}
			x={T_LAYER_X}
			y={T_EMBED_Y}
			width={T_LAYER_W}
			height={LAYER_BLOCK_H}
			rx="8"
			ry="8"
			fill={TX_FILL}
			stroke={isTargetEmbedActive() ? ACTIVE_LAYER_OUTLINE : TX_STROKE}
			stroke-width={isTargetEmbedActive() ? '1.5' : '1'}
		/>
		<text
			x={T_LAYER_X + T_LAYER_W / 2}
			y={T_EMBED_Y + LAYER_BLOCK_H / 2}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="16"
			font-weight="500"
			fill={isTargetEmbedActive() ? ACTIVE_STROKE : BLOCK_LABEL_COLOR}
		>
			Embedding
		</text>

		<!-- Target layer stack: residual row + attention layer -->
		{#each Array(N_TARGET_LAYERS) as _, k}
			{#each Array(N_TARGET_TOKENS) as _, i}
				{@const visible = targetResidualVisible(k, i)}
				<rect
					x={tX(i)}
					y={T_ROW_Y[k] + (TOKEN_ROW_H - T_TOKEN_SIZE) / 2}
					width={T_TOKEN_SIZE}
					height={T_TOKEN_SIZE}
					rx="5"
					ry="5"
					fill={visible ? TOKEN_FILL : 'none'}
					stroke={TOKEN_STROKE}
					stroke-width="1"
				/>
			{/each}
			{@const active = isTargetLayerActive(k)}
			{@const isTapped = tappedTargetLayers.includes(k)}
			<rect
				class:active-layer-outline={active}
				x={T_LAYER_X}
				y={T_L_Y[k]}
				width={T_LAYER_W}
				height={LAYER_BLOCK_H}
				rx="8"
				ry="8"
				fill={TX_FILL}
				stroke={active ? ACTIVE_LAYER_OUTLINE : (isTapped ? FEAT_STROKE : TX_STROKE)}
				stroke-width={active ? '1.5' : isTapped ? '1.5' : '1'}
			/>
			<text
				x={T_LAYER_X + T_LAYER_W / 2}
				y={T_L_Y[k] + LAYER_BLOCK_H / 2}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="15"
				font-weight="500"
				fill={active ? ACTIVE_STROKE : BLOCK_LABEL_COLOR}
			>
				Attention Layer {k + 1}
			</text>
		{/each}
		<!-- Target output residual row -->
		{#each Array(N_TARGET_TOKENS) as _, i}
			{@const visible = targetResidualVisible(N_TARGET_LAYERS, i)}
			<rect
				x={tX(i)}
				y={T_ROW_OUT_Y + (TOKEN_ROW_H - T_TOKEN_SIZE) / 2}
				width={T_TOKEN_SIZE}
				height={T_TOKEN_SIZE}
				rx="5"
				ry="5"
				fill={visible ? TOKEN_FILL : 'none'}
				stroke={TOKEN_STROKE}
				stroke-width="1"
			/>
		{/each}

		<!-- ============================================================ -->
		<!-- FEATURE CACHE COLUMN (in the gutter, near the drafter)        -->
		<!-- ============================================================ -->
		<text
			x={FEAT_X + FEAT_CELL_W / 2}
			y={FEAT_LABEL_Y}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="12"
			font-weight="500"
			fill={FEAT_STROKE}
		>
			Target Features
		</text>
		{#each Array(N_FEAT_CELLS) as _, k}
			{@const filled = featCellFilled(k)}
			<rect
				x={FEAT_X}
				y={featCellY(k)}
				width={FEAT_CELL_W}
				height={FEAT_CELL_H}
				rx="6"
				ry="6"
				fill={filled ? FEAT_FILL : 'none'}
				stroke={FEAT_STROKE}
				stroke-width="1"
				stroke-dasharray={filled ? undefined : '3 3'}
			/>
			<text
				x={FEAT_X + FEAT_CELL_W / 2}
				y={featCellY(k) + FEAT_CELL_H / 2}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="10"
				font-weight="600"
				fill={filled ? '#fff' : FEAT_STROKE}
				opacity={filled ? 1 : 0.6}
			>
				h{k + 1}
			</text>
		{/each}

		<!-- ============================================================ -->
		<!-- DRAFTER (LHS)                                                 -->
		<!-- ============================================================ -->
		<!-- Drafter text row: anchor token (last prompt token) + γ−1 masked -->
		{#each Array(GAMMA) as _, i}
			{#if i === 0}
				<!-- anchor token — visually distinct with green outline -->
				<rect
					x={dCx(i) - D_TOKEN_SIZE / 2}
					y={D_TEXT_Y + TEXT_ROW_H / 2 - D_TOKEN_SIZE / 2}
					width={D_TOKEN_SIZE}
					height={D_TOKEN_SIZE}
					rx="5"
					ry="5"
					fill="none"
					stroke={ACCEPT_GREEN_STROKE}
					stroke-width="1.5"
				/>
				<text
					x={dCx(i)}
					y={D_TEXT_Y + TEXT_ROW_H / 2}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="12"
					font-weight="500"
					fill={ACCEPT_GREEN_STROKE}
				>
					{targetWords[N_PROMPT - 1]}
				</text>
			{:else}
				<rect
					x={dCx(i) - D_TOKEN_SIZE / 2}
					y={D_TEXT_Y + TEXT_ROW_H / 2 - D_TOKEN_SIZE / 2}
					width={D_TOKEN_SIZE}
					height={D_TOKEN_SIZE}
					rx="5"
					ry="5"
					fill="#cfe0f2"
					stroke="#7ea3c8"
					stroke-width="1"
				/>
				<text
					x={dCx(i)}
					y={D_TEXT_Y + TEXT_ROW_H / 2}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="8"
					fill="#33506e"
				>
					[MASK]
				</text>
			{/if}
		{/each}

		<!-- Drafter embedding block -->
		<rect
			class:active-layer-outline={isDrafterEmbedActive()}
			x={D_LAYER_X}
			y={D_EMBED_Y}
			width={D_LAYER_W}
			height={LAYER_BLOCK_H_DRAFTER}
			rx="7"
			ry="7"
			fill={TX_FILL}
			stroke={isDrafterEmbedActive() ? ACTIVE_LAYER_OUTLINE : TX_STROKE}
			stroke-width={isDrafterEmbedActive() ? '1.5' : '1'}
		/>
		<text
			x={D_LAYER_X + D_LAYER_W / 2}
			y={D_EMBED_Y + LAYER_BLOCK_H_DRAFTER / 2}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="13"
			font-weight="500"
			fill={isDrafterEmbedActive() ? ACTIVE_STROKE : BLOCK_LABEL_COLOR}
		>
			Embedding
		</text>

		<!-- Drafter layer stack -->
		{#each Array(N_DRAFTER_LAYERS) as _, k}
			{#each Array(GAMMA) as _, i}
				{@const visible = drafterResidualVisible(k, i)}
				<rect
					x={dX(i)}
					y={D_ROW_Y[k] + (TOKEN_ROW_H - D_TOKEN_SIZE) / 2}
					width={D_TOKEN_SIZE}
					height={D_TOKEN_SIZE}
					rx="5"
					ry="5"
					fill={visible ? TOKEN_FILL : 'none'}
					stroke={TOKEN_STROKE}
					stroke-width="1"
				/>
			{/each}
			{@const active = isDrafterLayerActive(k)}
			<rect
				class:active-layer-outline={active}
				x={D_LAYER_X}
				y={D_L_Y[k]}
				width={D_LAYER_W}
				height={LAYER_BLOCK_H_DRAFTER}
				rx="7"
				ry="7"
				fill={TX_FILL}
				stroke={active ? ACTIVE_LAYER_OUTLINE : TX_STROKE}
				stroke-width={active ? '1.5' : '1'}
			/>
			<text
				x={D_LAYER_X + D_LAYER_W / 2}
				y={D_L_Y[k] + LAYER_BLOCK_H_DRAFTER / 2}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="12"
				font-weight="500"
				fill={active ? ACTIVE_STROKE : BLOCK_LABEL_COLOR}
			>
				Attention {k + 1}
			</text>
		{/each}
		<!-- Drafter output row: anchor + γ−1 proposed tokens (revealed together) -->
		{#each Array(GAMMA) as _, i}
			{@const visible = drafterOutputVisible(i)}
			<rect
				x={dX(i)}
				y={D_ROW_OUT_Y + (TOKEN_ROW_H - D_TOKEN_SIZE) / 2}
				width={D_TOKEN_SIZE}
				height={D_TOKEN_SIZE}
				rx="5"
				ry="5"
				fill={visible ? TOKEN_FILL : 'none'}
				stroke={visible ? TOKEN_STROKE : '#7ea3c8'}
				stroke-width="1"
				stroke-dasharray={visible ? undefined : '3 3'}
			/>
			{#if visible}
				<text
					x={dCx(i)}
					y={D_ROW_OUT_Y + TOKEN_ROW_H / 2}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="9"
					font-weight="600"
					fill="#fff"
				>
					{draftedWords[i]}
				</text>
			{/if}
		{/each}

		<!-- ============================================================ -->
		<!-- Above-layer ghosts (feature ghosts, injection, verify).       -->
		<!-- ============================================================ -->
		{#each aboveGhosts as g (g.id)}
			{@const gh = ghostFor(g)}
			<g transform="translate({gh.cx} {gh.cy})" opacity={gh.opacity} pointer-events="none">
				{#if g.kind === 'feat'}
					<rect
						x={-g.size.w / 2}
						y={-g.size.h / 2}
						width={g.size.w}
						height={g.size.h}
						rx="5"
						ry="5"
						fill={FEAT_FILL}
						stroke={FEAT_STROKE}
						stroke-width="1"
					/>
				{:else}
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
</div>

<style>
	.wrap {
		width: 100%;
		margin: 0 auto;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	:global(.active-layer-outline) {
		stroke-dasharray: 6 6;
		animation: marching-ants 0.6s linear infinite;
	}
	@keyframes marching-ants {
		to {
			stroke-dashoffset: -12;
		}
	}
</style>
