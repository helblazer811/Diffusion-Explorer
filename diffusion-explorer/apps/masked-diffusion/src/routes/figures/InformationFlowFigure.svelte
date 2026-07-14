<script lang="ts">
	// Information flow: Causal vs Bidirectional attention on a frozen sentence.
	//
	// Two panels, same 8-token sentence, both showing an intermediate
	// generation moment:
	//   LHS (Causal): 7 tokens committed on the left, rightmost slot empty.
	//                 7 arcs, one from each past token, all landing on slot 7.
	//                 Information flows one way — past → future.
	//   RHS (Bidirectional): 7 tokens committed, position 4 is a [MASK].
	//                 7 arcs from every other position (left AND right of the
	//                 mask) all landing on slot 4. Information flows both ways.
	//
	// The token layout is completely frozen — nothing about slots changes over
	// time. The only animation is short dashed pulses that travel along each
	// arc from source to target on a loop, conveying directionality. Reused
	// bezier / pulsePath helpers from CausalLanguageModelingFigure.svelte.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';

	interface Props {
		isActive?: Writable<boolean>;
		width?: number;
	}

	let { isActive, width = 780 }: Props = $props();

	// --- Palette (matches CausalLanguageModelingFigure) ---
	const TEXT_COLOR = '#5a5a5a';
	const MUTED = '#8892a0';
	const FOCUS_STROKE = '#F1942B';
	const HEADER_COLOR = '#666666';

	// --- Content: short six-token sentence for a legible picture ---
	const tokens = ['the', 'cat', 'sat', 'on', 'the', 'mat'];
	const N = tokens.length;

	// Causal panel: rightmost slot (index 5) is not yet generated.
	const CAUSAL_TARGET = N - 1;
	const CAUSAL_EMPTY = new Set([CAUSAL_TARGET]);
	// Sources for the causal side: every past position.
	const causalArcSources = Array.from({ length: CAUSAL_TARGET }, (_, i) => i);

	// Bidirectional panel: an interior slot (index 3) is the arc target. It
	// stays a committed token — no [MASK] — so the picture reads as "any
	// bidirectional attention pattern," not specifically masked diffusion.
	// An asymmetric interior position (2 sources left, 3 sources right)
	// makes "both directions" visually obvious without being perfectly
	// symmetric.
	const BIDIR_TARGET = 3;
	const BIDIR_TARGETS = new Set([BIDIR_TARGET]);
	const bidirArcSources = Array.from({ length: N }, (_, i) => i).filter((i) => i !== BIDIR_TARGET);

	// --- Per-panel geometry (arcs sit ABOVE the row of tokens) ---
	const TOKEN_STEP = 44;
	const TOKEN_SIZE = 13;
	const SLOT_W = 40;
	const SLOT_H = 20;
	const ARC_H = 42; // vertical rise of the arcs above the token baseline
	const HEADER_TITLE_H = 22;
	const HEADER_SUBTITLE_H = 20;
	const HEADER_H = HEADER_TITLE_H + HEADER_SUBTITLE_H;
	const HEADER_TO_ARCS_GAP = 14;
	const ARCS_TO_ROW_GAP = 6;
	const PANEL_PAD_X = 14;
	const PANEL_TOP_PAD = 8;
	const PANEL_BOTTOM_PAD = 12;

	const panelInnerW = TOKEN_STEP * N;
	const PANEL_W = panelInnerW + PANEL_PAD_X * 2;
	const PANEL_H =
		PANEL_TOP_PAD + HEADER_H + HEADER_TO_ARCS_GAP + ARC_H + ARCS_TO_ROW_GAP + SLOT_H + PANEL_BOTTOM_PAD;

	const COL_GAP = 32;
	const OUTER_PAD_X = 8;
	const W_INTRINSIC = PANEL_W * 2 + COL_GAP + OUTER_PAD_X * 2;
	const H = PANEL_H;

	// Panel-relative coordinate helpers.
	function tokenXInPanel(j: number): number {
		return PANEL_PAD_X + j * TOKEN_STEP + TOKEN_STEP / 2;
	}
	const headerTitleY = PANEL_TOP_PAD + HEADER_TITLE_H / 2;
	const headerSubtitleY = PANEL_TOP_PAD + HEADER_TITLE_H + HEADER_SUBTITLE_H / 2;
	// Arc baseline sits just above the token row; arcs peak UP from there.
	const arcBaseY = PANEL_TOP_PAD + HEADER_H + HEADER_TO_ARCS_GAP + ARC_H;
	const tokenBaselineY = arcBaseY + ARCS_TO_ROW_GAP + SLOT_H / 2;

	const LEFT_X = OUTER_PAD_X;
	const RIGHT_X = OUTER_PAD_X + PANEL_W + COL_GAP;

	// --- Animation state ---
	// u is a scalar in [0, 1) that wraps continuously; each arc's dashed
	// pulse rides on (u + phase_j) mod 1.
	let u = $state(0);
	let player = $state<Player<{ u: number }> | undefined>(undefined);

	// --- Pulse geometry (adapted from CausalLanguageModelingFigure) ---
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

	// Continuous loop: head = ((u + phase) mod 1) * (1 + PULSE_LEN).
	// The (1 + PULSE_LEN) scaling lets the tail exit the endpoint cleanly
	// each cycle rather than freezing at the target.
	function pulseHead(phase: number): number {
		const w = (u + phase) % 1;
		return w * (1 + PULSE_LEN);
	}

	// Precompute arc geometry for a panel: source list, target index, and
	// per-arc quadratic-bezier control points.
	interface Arc {
		src: number;
		x0: number;
		y0: number;
		x1: number;
		y1: number;
		x2: number;
		y2: number;
		phase: number;
	}

	function buildArcs(panelX: number, sources: number[], target: number): Arc[] {
		// Phase-stagger sources across [0, 1) so pulses don't fire in lockstep.
		return sources.map((src, idx) => {
			const x0 = panelX + tokenXInPanel(src);
			const y0 = arcBaseY;
			const x2 = panelX + tokenXInPanel(target);
			const y2 = arcBaseY;
			const cx = (x0 + x2) / 2;
			// Peak Y is ABOVE the row (subtract to move up). Scale peak with
			// horizontal distance so short arcs stay shallow and long arcs
			// rise higher.
			const dx = Math.abs(x2 - x0);
			const peakY = y0 - Math.min(ARC_H, 10 + dx * 0.4);
			return {
				src,
				x0,
				y0,
				x1: cx,
				y1: peakY,
				x2,
				y2,
				phase: idx / sources.length
			};
		});
	}

	const causalArcs = buildArcs(LEFT_X, causalArcSources, CAUSAL_TARGET);
	const bidirArcs = buildArcs(RIGHT_X, bidirArcSources, BIDIR_TARGET);

	// Static guide-arc `d` string per arc (drawn once, no animation).
	function guideD(a: Arc): string {
		return `M ${a.x0} ${a.y0} Q ${a.x1} ${a.y1}, ${a.x2} ${a.y2}`;
	}

	// --- Timeline: one continuous loop that ramps u from 0 → 1, repeating. ---
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
</script>

<div class="wrap" style="max-width: {width}px;">
	<svg
		viewBox={`0 0 ${W_INTRINSIC} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Two panels comparing information flow. Left panel labeled Causal Attention shows a six-token sentence with the rightmost slot empty; dashed pulses along arcs flow from every past token into that empty slot. Right panel labeled Bidirectional Attention shows the same sentence fully committed; dashed pulses along arcs flow into one highlighted interior token from every other position on both sides."
	>
		<!-- ============================================================ -->
		<!-- LHS: Causal Attention -->
		<!-- ============================================================ -->
		<g>
			<!-- Header -->
			<text
				x={LEFT_X + PANEL_W / 2}
				y={headerTitleY}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="16"
				font-weight="600"
				fill={HEADER_COLOR}
			>
				Causal Attention
			</text>
			<text
				x={LEFT_X + PANEL_W / 2}
				y={headerSubtitleY}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="13"
				fill={MUTED}
			>
				information flows one way
			</text>

			<!-- Tokens: 0..6 committed, 7 = dashed-underline placeholder -->
			{#each tokens as tok, j}
				{@const cx = LEFT_X + tokenXInPanel(j)}
				{#if CAUSAL_EMPTY.has(j)}
					<!-- Empty slot: dashed underline placeholder -->
					<line
						x1={cx - SLOT_W / 2 + 4}
						y1={tokenBaselineY + SLOT_H / 2 - 1}
						x2={cx + SLOT_W / 2 - 4}
						y2={tokenBaselineY + SLOT_H / 2 - 1}
						stroke="#c8c8c8"
						stroke-width="1"
						stroke-dasharray="3 3"
					/>
				{:else}
					<text
						x={cx}
						y={tokenBaselineY}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={TOKEN_SIZE}
						fill={TEXT_COLOR}
					>
						{tok}
					</text>
				{/if}
			{/each}

			<!-- Guide arcs (drawn once, faint) -->
			{#each causalArcs as a}
				<path
					d={guideD(a)}
					fill="none"
					stroke={MUTED}
					stroke-width="1"
					opacity={0.32}
				/>
			{/each}

			<!-- Dashed pulses traveling along each arc -->
			{#each causalArcs as a}
				{@const head = pulseHead(a.phase)}
				{#if head > 0 && head - PULSE_LEN < 1}
					<path
						d={pulsePath(head, a.x0, a.y0, a.x1, a.y1, a.x2, a.y2)}
						fill="none"
						stroke={FOCUS_STROKE}
						stroke-width="2"
						stroke-linecap="round"
						opacity={0.95}
					/>
				{/if}
			{/each}
		</g>

		<!-- ============================================================ -->
		<!-- RHS: Bidirectional Attention -->
		<!-- ============================================================ -->
		<g>
			<!-- Header -->
			<text
				x={RIGHT_X + PANEL_W / 2}
				y={headerTitleY}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="16"
				font-weight="600"
				fill={HEADER_COLOR}
			>
				Bidirectional Attention
			</text>
			<text
				x={RIGHT_X + PANEL_W / 2}
				y={headerSubtitleY}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="13"
				fill={MUTED}
			>
				information flows both ways
			</text>

			<!-- Tokens: same as the causal panel — the target slot is shown
			     as a dashed-underline placeholder (a slot about to be
			     filled), and every other slot shows its committed word.
			     Both panels use the exact same slot vocabulary; only the
			     direction of the arcs differs between them. -->
			{#each tokens as tok, j}
				{@const cx = RIGHT_X + tokenXInPanel(j)}
				{#if BIDIR_TARGETS.has(j)}
					<line
						x1={cx - SLOT_W / 2 + 4}
						y1={tokenBaselineY + SLOT_H / 2 - 1}
						x2={cx + SLOT_W / 2 - 4}
						y2={tokenBaselineY + SLOT_H / 2 - 1}
						stroke="#c8c8c8"
						stroke-width="1"
						stroke-dasharray="3 3"
					/>
				{:else}
					<text
						x={cx}
						y={tokenBaselineY}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={TOKEN_SIZE}
						fill={TEXT_COLOR}
					>
						{tok}
					</text>
				{/if}
			{/each}

			<!-- Guide arcs -->
			{#each bidirArcs as a}
				<path
					d={guideD(a)}
					fill="none"
					stroke={MUTED}
					stroke-width="1"
					opacity={0.32}
				/>
			{/each}

			<!-- Dashed pulses traveling along each arc -->
			{#each bidirArcs as a}
				{@const head = pulseHead(a.phase)}
				{#if head > 0 && head - PULSE_LEN < 1}
					<path
						d={pulsePath(head, a.x0, a.y0, a.x1, a.y1, a.x2, a.y2)}
						fill="none"
						stroke={FOCUS_STROKE}
						stroke-width="2"
						stroke-linecap="round"
						opacity={0.95}
					/>
				{/if}
			{/each}
		</g>
	</svg>
</div>

<style>
	.wrap {
		width: 100%;
		margin: 0 auto;
	}
	.wrap > svg {
		width: 100%;
		height: auto;
		display: block;
		margin: 0 auto;
	}
</style>
