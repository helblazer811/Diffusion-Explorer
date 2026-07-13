<script lang="ts">
	// Causal language modeling rollout. Each row shows the sentence
	// unfolding one more token to the right; below each row, curved
	// arcs run from every past token to the newly-added token, with
	// pulses flowing along the arcs, staggered left-to-right, to
	// emphasize the direction of causal information flow.
	//
	// Layout: N rows stacked top-to-bottom. Row t (0-indexed) has t+1
	// tokens visible plus its arc bundle. Rows appear one at a time on
	// the shared timeline; the last row holds while its pulses finish.

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
	const FOCUS_STROKE = '#F1942B';
	const NEW_TOKEN_COLOR = '#F1942B';

	// --- Content ---
	const tokens = ['the', 'cat', 'sat', 'on', 'the', 'red', 'wool', 'mat'];
	const N = tokens.length;

	// --- Geometry ---
	const TOKEN_STEP = 36;
	const TOKEN_SIZE = 11;
	const ARC_H = 16;
	const ROW_TOKEN_GAP = 4; // gap between token baseline and arc launch
	const ROW_H = TOKEN_SIZE + ROW_TOKEN_GAP + ARC_H + 6;

	const LEFT_MARGIN = 20;
	const TOP_MARGIN = 12;

	const W_INTRINSIC = LEFT_MARGIN * 2 + TOKEN_STEP * N;
	const H = TOP_MARGIN + ROW_H * N + 20;

	function tokenX(j: number): number {
		return LEFT_MARGIN + j * TOKEN_STEP + TOKEN_STEP / 2;
	}
	function rowY(t: number): number {
		return TOP_MARGIN + t * ROW_H;
	}
	function tokenBaselineY(t: number): number {
		return rowY(t) + TOKEN_SIZE / 2 + 4;
	}
	function arcBaseY(t: number): number {
		return rowY(t) + TOKEN_SIZE + ROW_TOKEN_GAP;
	}

	// --- Timeline ---
	// One row per beat, then a small hold at the end. Each row's pulses
	// finish within its own beat, staggered left-to-right, so the arcs
	// visibly resolve before the next row appears.
	const ROW_MS = 1400;
	const HOLD_MS = 2400;

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

	function clamp01(x: number): number {
		return Math.max(0, Math.min(1, x));
	}
	function smoothstep(x: number): number {
		const c = clamp01(x);
		return c * c * (3 - 2 * c);
	}

	// u ∈ [0, N + hold]. Rows appear at integer boundaries: row t appears
	// starting at u = t. Within u ∈ [t, t+1], row t's pulses animate.
	function rowAppearance(t: number): number {
		return smoothstep(u - t);
	}

	// Per-arc pulse progress. For row t and source j (j < t), we stagger
	// each arc so leftmost sources launch first and rightmost sources
	// launch last, spread across the row's beat.
	function pulseHead(t: number, j: number): number {
		const rowU = u - t; // [0, 1] while row is active
		if (rowU <= 0) return 0;
		if (rowU >= 1) return 1 + PULSE_LEN; // fully finished (past its arc)
		const nSources = t; // sources are j = 0…t-1, i.e. t of them
		// Stagger: source j (0-indexed) launches at rowU = j / (nSources + 1)
		// and finishes by rowU = (j + STAGGER_SPAN) / (nSources + 1).
		const launch = j / (nSources + 2);
		const finish = (j + STAGGER_SPAN + 0.4) / (nSources + 2);
		if (rowU < launch) return 0;
		if (rowU > finish) return 1 + PULSE_LEN;
		const local = (rowU - launch) / (finish - launch);
		// Head goes from 0 to 1 + PULSE_LEN so the tail exits the endpoint
		// cleanly rather than freezing at the target.
		return smoothstep(local) * (1 + PULSE_LEN);
	}

	const STAGGER_SPAN = 1.4;
	const PULSE_LEN = 0.32;
	const PULSE_SAMPLES = 14;

	function bezier(t: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
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

	function buildTimeline() {
		return new TimelineBuilder<State>()
			.setInitialState({ u: 0 })
			.add(
				{ name: 'rollout', reduce: (t: number) => ({ u: t * N }) },
				{ durationMs: ROW_MS * N }
			)
			.add({ name: 'hold', reduce: (_t: number) => ({ u: N }) }, { durationMs: HOLD_MS })
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
	<div class="controls">
		<PlayPauseResetButton
			{isPlaying}
			time={u / N}
			onclick={() => (isPlaying ? pause() : play())}
			onreset={reset}
		/>
	</div>
	<svg
		viewBox={`0 0 ${W_INTRINSIC} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Autoregressive rollout of a short sentence: each row adds one token to the right, with pulses flowing from past tokens to the new token along curved arcs."
	>
		{#each Array(N) as _r, t}
			{@const app = rowAppearance(t)}
			{#if app > 0.02}
				<g opacity={app}>
					<!-- Row tokens: indices 0…t are visible on this row. -->
					{#each Array(t + 1) as _tok, j}
						{@const isNew = j === t}
						<text
							x={tokenX(j)}
							y={tokenBaselineY(t)}
							text-anchor="middle"
							dominant-baseline="central"
							font-size={TOKEN_SIZE}
							font-weight={isNew ? 700 : 400}
							fill={isNew ? NEW_TOKEN_COLOR : TEXT_COLOR}
						>
							{tokens[j]}
						</text>
					{/each}

					<!-- Faint persistent guide arcs (no arrowheads) + orange
					     pulses travelling along them. -->
					{#if t > 0}
						{@const tgtX = tokenX(t)}
						{@const yBase = arcBaseY(t)}
						{#each Array(t) as _s, j}
							{@const srcX = tokenX(j)}
							{@const dx = tgtX - srcX}
							{@const cx = (srcX + tgtX) / 2}
							{@const peakY = yBase + Math.min(ARC_H, 6 + dx * 0.3)}
							<!-- Persistent light guide arc. -->
							<path
								d={`M ${srcX} ${yBase} Q ${cx} ${peakY}, ${tgtX} ${yBase}`}
								fill="none"
								stroke={MUTED}
								stroke-width="1"
								opacity={0.35}
							/>
							{@const head = pulseHead(t, j)}
							{#if head > 0 && head - PULSE_LEN < 1}
								<!-- Orange pulse along the guide. -->
								<path
									d={pulsePath(head, srcX, yBase, cx, peakY, tgtX, yBase)}
									fill="none"
									stroke={FOCUS_STROKE}
									stroke-width="2"
									stroke-linecap="round"
									opacity={0.95}
								/>
							{/if}
						{/each}
					{/if}
				</g>
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
	.controls {
		position: absolute;
		top: 0;
		left: 0;
	}
	.wrap > svg {
		width: 100%;
		max-width: 420px;
		height: auto;
		display: block;
		margin: 0 auto;
	}
</style>
