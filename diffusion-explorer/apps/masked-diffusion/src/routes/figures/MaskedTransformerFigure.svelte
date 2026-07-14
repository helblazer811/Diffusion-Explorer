<script lang="ts">
	// ----------------------------------------------------------------
	// Masked Transformer — horizontal architecture diagram.
	//
	// Left → right layout:
	//   Input token column (4 tokens; one is [MASK])
	//   Embedding block
	//   Residual column (4 squares)
	//   Attention Layer 1
	//   Residual column
	//   Attention Layer 2
	//   Residual column
	//   Unembedding block
	//
	// One block is active at a time (marching-ants outline); as it
	// finishes, the next residual column fills in orange and reverts
	// to blue. The forward-pass animation loops.
	// ----------------------------------------------------------------

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';

	interface Props {
		isActive?: Writable<boolean>;
		width?: number;
		inputTokens?: (string | null)[];
		/** Word shown in orange at the masked slot in the OUTPUT column
		 *  once the Unembedding phase completes. */
		sampledWord?: string;
		nLayers?: number;
		maskColor?: string;
		maskTextColor?: string;
	}

	let {
		isActive,
		width = 780,
		inputTokens = ['The', 'cat', null, 'mat'],
		sampledWord = 'sat',
		nLayers = 2,
		maskColor = '#cfe0f2',
		maskTextColor = '#33506e'
	}: Props = $props();

	// --- Palette ---
	const BLOCK_LABEL_COLOR = '#5a5a5a';
	const TX_FILL = '#f4f6fa';
	const TX_STROKE = '#c8ccd1';
	const TOKEN_FILL = '#3879EF';
	const TOKEN_STROKE = '#1F55B5';
	const FLOW_STROKE = '#b5bdc7';
	const ACCENT = '#F1942B';
	const ACTIVE_FILL = '#FBD3A3';

	// --- Geometry ---
	const W = width;
	const N_TOKENS = inputTokens.length;
	const N_LAYERS = nLayers;

	const TOKEN_SIZE = 28;
	const TOKEN_V_STRIDE = 42;
	const STRIP_TOP = 20;
	const STRIP_H = N_TOKENS * TOKEN_V_STRIDE;
	const STRIP_BOTTOM = STRIP_TOP + STRIP_H;

	const COL_GAP = 46;
	const TOKEN_COL_W = 60;
	const BLOCK_W = 44;
	const BLOCK_H = STRIP_H - 6;

	interface Col {
		key: string;
		w: number;
	}
	const cols: Col[] = [
		{ key: 'INPUT', w: TOKEN_COL_W },
		{ key: 'EMBED', w: BLOCK_W }
	];
	for (let k = 0; k < N_LAYERS; k++) {
		cols.push({ key: `RES_${k}`, w: TOKEN_SIZE });
		cols.push({ key: `L${k}`, w: BLOCK_W });
	}
	cols.push({ key: 'RES_OUT', w: TOKEN_SIZE });
	cols.push({ key: 'UNEMBED', w: BLOCK_W });
	cols.push({ key: 'OUTPUT', w: TOKEN_COL_W });

	const stripW = cols.reduce((s, c) => s + c.w, 0) + (cols.length - 1) * COL_GAP;
	const STRIP_LEFT = (W - stripW) / 2;
	const colX: Record<string, number> = {};
	{
		let x = STRIP_LEFT;
		for (const c of cols) {
			colX[c.key] = x;
			x += c.w + COL_GAP;
		}
	}

	function tokenY(i: number): number {
		return STRIP_TOP + i * TOKEN_V_STRIDE + TOKEN_V_STRIDE / 2;
	}
	function colCX(key: string): number {
		const c = cols.find((c) => c.key === key)!;
		return colX[key] + c.w / 2;
	}

	// Symmetric top/bottom padding.
	const H = STRIP_BOTTOM + STRIP_TOP;

	interface Seg {
		fromColKey: string;
		toColKey: string;
	}
	const arrowSegments: Seg[] = [];
	arrowSegments.push({ fromColKey: 'INPUT', toColKey: 'EMBED' });
	arrowSegments.push({ fromColKey: 'EMBED', toColKey: 'RES_0' });
	for (let k = 0; k < N_LAYERS; k++) {
		arrowSegments.push({ fromColKey: `RES_${k}`, toColKey: `L${k}` });
		const next = k + 1 < N_LAYERS ? `RES_${k + 1}` : 'RES_OUT';
		arrowSegments.push({ fromColKey: `L${k}`, toColKey: next });
	}
	arrowSegments.push({ fromColKey: 'RES_OUT', toColKey: 'UNEMBED' });
	arrowSegments.push({ fromColKey: 'UNEMBED', toColKey: 'OUTPUT' });

	// -------------------- Timeline --------------------
	// Phases (loops):
	//   0: Embedding active + RES_0 fills
	//   1..N_LAYERS: layer k active + next residual column fills
	//   N_LAYERS + 1: Unembedding active
	const N_PHASES = 1 + N_LAYERS + 1;

	const P_STEP = 1200;
	const P_HOLD = 400;
	const END_HOLD = 1200;

	interface State {
		u: number;
	}
	let u = $state(0);
	let player = $state<Player<State> | undefined>(undefined);

	function smoothstep(x: number): number {
		const c = Math.max(0, Math.min(1, x));
		return c * c * (3 - 2 * c);
	}
	function phaseProgress(p: number): number {
		return Math.max(0, Math.min(1, u - p));
	}

	const PHASE_EMBED = 0;
	const PHASE_LAYER_START = 1;
	const PHASE_UNEMBED = 1 + N_LAYERS;

	// Residual column k (k in [0, N_LAYERS]; k = N_LAYERS = RES_OUT) is
	// "arrived" only once its producing phase completes — its ghost has
	// finished flying. Before that, the destination is empty (dashed
	// placeholder). This aligns cell-fill exactly with ghost arrival.
	function rowArrived(k: number): boolean {
		const producingPhase = k === 0 ? PHASE_EMBED : PHASE_LAYER_START + k - 1;
		return u >= producingPhase + 1;
	}
	function isActiveBlock(phase: number): boolean {
		return u >= phase && u < phase + 1;
	}
	const rowArrivedArr = $derived(
		Array.from({ length: N_LAYERS + 1 }, (_, k) => rowArrived(k))
	);
	const embedActive = $derived(isActiveBlock(PHASE_EMBED));
	const unembedActive = $derived(isActiveBlock(PHASE_UNEMBED));
	const outputArrived = $derived(u >= PHASE_UNEMBED + 1);
	const unembedProgress = $derived(phaseProgress(PHASE_UNEMBED));

	// --- Flying token ghosts ---
	// Each phase carries ghosts from a source column center to a
	// destination column center; y is fixed at the token row. Linear
	// lerp along x by the phase's progress p ∈ [0,1].
	interface Flight {
		phase: number;
		fromColKey: string;
		toColKey: string;
	}
	const flights: Flight[] = [
		{ phase: PHASE_EMBED, fromColKey: 'INPUT', toColKey: 'RES_0' }
	];
	for (let k = 0; k < N_LAYERS; k++) {
		flights.push({
			phase: PHASE_LAYER_START + k,
			fromColKey: `RES_${k}`,
			toColKey: k + 1 < N_LAYERS ? `RES_${k + 1}` : 'RES_OUT'
		});
	}
	// Unembedding phase is split into two visual halves inside one
	// phase: embedding rects flow INTO the Unembed block (first half),
	// then predicted words flow OUT of it (second half). The two
	// half-flights below use the same phase but different `renderKind`.

	function buildTimeline() {
		const b = new TimelineBuilder<State>().setInitialState({ u: 0 });
		for (let p = 0; p < N_PHASES; p++) {
			const from = p;
			const to = p + 1;
			b.add(
				{
					name: `phase-${p}`,
					reduce: (t: number) => ({ u: from + t * (to - from) })
				},
				{ durationMs: P_STEP }
			);
			b.add(
				{
					name: `hold-${p}`,
					reduce: (_t: number) => ({ u: to })
				},
				{ durationMs: p === N_PHASES - 1 ? END_HOLD : P_HOLD }
			);
		}
		return b.build();
	}

	onMount(() => {
		player = new Player<State>(buildTimeline(), { looping: true, endPause: 0.05 });
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
			unsubActive?.();
			player?.dispose();
		};
	});

	const MARKER_FLOW = 'mtf-arrow-flow';
</script>

<div class="wrap">
	<svg
		viewBox={`0 0 ${W} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Horizontal architecture diagram of a bidirectional transformer for masked language modeling. From left to right: an input token column with one [MASK], an Embedding block, alternating residual columns and Attention Layer blocks, and an Unembedding block. Each block lights up in sequence as the forward pass propagates through the network; the animation loops."
	>
		<defs>
			<marker
				id={MARKER_FLOW}
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={5}
				markerHeight={5}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={FLOW_STROKE} />
			</marker>
		</defs>

		<!-- Flow arrows drawn FIRST so block rects painted after cover
		     the segments that pass behind them. Arrowheads land at the
		     left edge of each next block, reading as "entering" it. -->
		{#each arrowSegments as seg}
			{@const fromCol = cols.find((c) => c.key === seg.fromColKey)}
			{@const toCol = cols.find((c) => c.key === seg.toColKey)}
			{#if fromCol && toCol}
				{@const x1 = colX[seg.fromColKey] + fromCol.w}
				{@const x2 = colX[seg.toColKey] - 2}
				{#each Array(N_TOKENS) as _, i}
					<line
						x1={x1}
						y1={tokenY(i)}
						x2={x2}
						y2={tokenY(i)}
						stroke={FLOW_STROKE}
						stroke-width="1.6"
						marker-end={`url(#${MARKER_FLOW})`}
					/>
				{/each}
			{/if}
		{/each}

		<!-- Input tokens (left column) -->
		{#each inputTokens as tok, i}
			{@const cx = colCX('INPUT')}
			{@const cy = tokenY(i)}
			{#if tok === null}
				<rect
					x={cx - TOKEN_COL_W / 2 + 4}
					y={cy - 14}
					width={TOKEN_COL_W - 8}
					height={28}
					rx={5}
					ry={5}
					fill={maskColor}
				/>
				<text
					x={cx}
					y={cy}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="12"
					font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
					fill={maskTextColor}
				>
					[MASK]
				</text>
			{:else}
				<text
					x={cx}
					y={cy}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="16"
					fill={BLOCK_LABEL_COLOR}
				>
					{tok}
				</text>
			{/if}
		{/each}

		<!-- Residual columns (drawn BEFORE the block rects so ghosts,
		     drawn just after, sit above residuals but below blocks). -->
		{#each Array(N_LAYERS) as _, k}
			{#each Array(N_TOKENS) as _, i}
				<rect
					x={colX[`RES_${k}`]}
					y={tokenY(i) - TOKEN_SIZE / 2}
					width={TOKEN_SIZE}
					height={TOKEN_SIZE}
					rx="5"
					ry="5"
					fill="none"
					stroke={FLOW_STROKE}
					stroke-width="1.2"
					stroke-dasharray="3 2"
					opacity={rowArrivedArr[k] ? 0 : 1}
				/>
				<rect
					x={colX[`RES_${k}`]}
					y={tokenY(i) - TOKEN_SIZE / 2}
					width={TOKEN_SIZE}
					height={TOKEN_SIZE}
					rx="5"
					ry="5"
					fill={TOKEN_FILL}
					stroke={TOKEN_STROKE}
					stroke-width="1"
					opacity={rowArrivedArr[k] ? 1 : 0}
				/>
			{/each}
		{/each}
		{#each Array(N_TOKENS) as _, i}
			<rect
				x={colX['RES_OUT']}
				y={tokenY(i) - TOKEN_SIZE / 2}
				width={TOKEN_SIZE}
				height={TOKEN_SIZE}
				rx="5"
				ry="5"
				fill="none"
				stroke={FLOW_STROKE}
				stroke-width="1.2"
				stroke-dasharray="3 2"
				opacity={rowArrivedArr[N_LAYERS] ? 0 : 1}
			/>
			<rect
				x={colX['RES_OUT']}
				y={tokenY(i) - TOKEN_SIZE / 2}
				width={TOKEN_SIZE}
				height={TOKEN_SIZE}
				rx="5"
				ry="5"
				fill={TOKEN_FILL}
				stroke={TOKEN_STROKE}
				stroke-width="1"
				opacity={rowArrivedArr[N_LAYERS] ? 1 : 0}
			/>
		{/each}

		<!-- Flying token ghosts. Drawn AFTER residuals but BEFORE block
		     rects so they visibly float above residual columns and then
		     get hidden by the block they're passing through. Orange
		     while moving. The Unembed phase is special: an embedding
		     rect flies INTO the Unembed block during the first half of
		     the phase, then the predicted words fly OUT of it during
		     the second half. -->
		{#each flights as flight}
			{@const p = phaseProgress(flight.phase)}
			{#if p > 0 && p < 1 && flight.phase !== PHASE_UNEMBED}
				{@const fromX = colCX(flight.fromColKey)}
				{@const toX = colCX(flight.toColKey)}
				{@const cx = fromX + (toX - fromX) * p}
				{#each Array(N_TOKENS) as _, i}
					<rect
						x={cx - TOKEN_SIZE / 2}
						y={tokenY(i) - TOKEN_SIZE / 2}
						width={TOKEN_SIZE}
						height={TOKEN_SIZE}
						rx="5"
						ry="5"
						fill={ACTIVE_FILL}
						stroke={ACCENT}
						stroke-width="1"
					/>
				{/each}
			{/if}
		{/each}
		<!-- Unembed phase: two half-flights within one phase. -->
		{#if unembedProgress > 0 && unembedProgress < 0.5}
			{@const halfP = unembedProgress / 0.5}
			{@const fromX = colCX('RES_OUT')}
			{@const toX = colCX('UNEMBED')}
			{@const cx = fromX + (toX - fromX) * halfP}
			{#each Array(N_TOKENS) as _, i}
				<rect
					x={cx - TOKEN_SIZE / 2}
					y={tokenY(i) - TOKEN_SIZE / 2}
					width={TOKEN_SIZE}
					height={TOKEN_SIZE}
					rx="5"
					ry="5"
					fill={ACTIVE_FILL}
					stroke={ACCENT}
					stroke-width="1"
				/>
			{/each}
		{:else if unembedProgress >= 0.5 && unembedProgress < 1}
			{@const halfP = (unembedProgress - 0.5) / 0.5}
			{@const fromX = colCX('UNEMBED')}
			{@const toX = colCX('OUTPUT')}
			{@const cx = fromX + (toX - fromX) * halfP}
			{#each Array(N_TOKENS) as _, i}
				{@const tok = inputTokens[i]}
				<text
					x={cx}
					y={tokenY(i)}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="16"
					font-weight={tok === null ? '600' : '500'}
					fill={ACCENT}
				>
					{tok === null ? sampledWord : tok}
				</text>
			{/each}
		{/if}

		<!-- Embedding block (painted OVER ghosts so mid-flight ghosts
		     are hidden inside blocks). -->
		<rect
			class:active-layer-outline={embedActive}
			x={colX['EMBED']}
			y={STRIP_TOP + 3}
			width={BLOCK_W}
			height={BLOCK_H}
			rx="8"
			ry="8"
			fill={TX_FILL}
			stroke={embedActive ? ACCENT : TX_STROKE}
			stroke-width={embedActive ? '1.5' : '1'}
		/>
		<text
			x={colCX('EMBED')}
			y={STRIP_TOP + BLOCK_H / 2 + 3}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="13"
			font-weight="500"
			fill={embedActive ? ACCENT : BLOCK_LABEL_COLOR}
			transform={`rotate(-90 ${colCX('EMBED')} ${STRIP_TOP + BLOCK_H / 2 + 3})`}
		>
			Embedding
		</text>

		<!-- Attention layers -->
		{#each Array(N_LAYERS) as _, k}
			{@const layerActive = isActiveBlock(PHASE_LAYER_START + k)}
			<rect
				class:active-layer-outline={layerActive}
				x={colX[`L${k}`]}
				y={STRIP_TOP + 3}
				width={BLOCK_W}
				height={BLOCK_H}
				rx="8"
				ry="8"
				fill={TX_FILL}
				stroke={layerActive ? ACCENT : TX_STROKE}
				stroke-width={layerActive ? '1.5' : '1'}
			/>
			<text
				x={colCX(`L${k}`)}
				y={STRIP_TOP + BLOCK_H / 2 + 3}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="13"
				font-weight="500"
				fill={layerActive ? ACCENT : BLOCK_LABEL_COLOR}
				transform={`rotate(-90 ${colCX(`L${k}`)} ${STRIP_TOP + BLOCK_H / 2 + 3})`}
			>
				Attention Layer {k + 1}
			</text>
		{/each}

		<!-- Unembedding block -->
		<rect
			class:active-layer-outline={unembedActive}
			x={colX['UNEMBED']}
			y={STRIP_TOP + 3}
			width={BLOCK_W}
			height={BLOCK_H}
			rx="8"
			ry="8"
			fill={TX_FILL}
			stroke={unembedActive ? ACCENT : TX_STROKE}
			stroke-width={unembedActive ? '1.5' : '1'}
		/>
		<text
			x={colCX('UNEMBED')}
			y={STRIP_TOP + BLOCK_H / 2 + 3}
			text-anchor="middle"
			dominant-baseline="central"
			font-size="13"
			font-weight="500"
			fill={unembedActive ? ACCENT : BLOCK_LABEL_COLOR}
			transform={`rotate(-90 ${colCX('UNEMBED')} ${STRIP_TOP + BLOCK_H / 2 + 3})`}
		>
			Unembedding
		</text>

		<!-- Output tokens (right column). Non-mask positions echo the
		     input and appear once Unembedding completes; the mask
		     position appears as the sampled word in orange at the same
		     moment. Before Unembedding finishes, dashed placeholders
		     show where the predictions will land. -->
		{#each inputTokens as tok, i}
			{@const cx = colCX('OUTPUT')}
			{@const cy = tokenY(i)}
			{@const isMask = tok === null}
			{#if outputArrived}
				<text
					x={cx}
					y={cy}
					text-anchor="middle"
					dominant-baseline="central"
					font-size="16"
					font-weight={isMask ? '600' : '400'}
					fill={isMask ? ACCENT : BLOCK_LABEL_COLOR}
				>
					{isMask ? sampledWord : tok}
				</text>
			{/if}
		{/each}

	</svg>
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		margin: 0 auto;
	}
	svg {
		width: 100%;
		max-width: 780px;
		height: auto;
		display: block;
		margin: 0 auto;
	}
	.active-layer-outline {
		stroke-dasharray: 6 6;
		animation: mtf-marching-ants 0.6s linear infinite;
	}
	@keyframes mtf-marching-ants {
		from {
			stroke-dashoffset: 0;
		}
		to {
			stroke-dashoffset: -12;
		}
	}
</style>
