<script lang="ts">
	// Two generation processes on the same paragraph, stacked vertically
	// (AR on top, masked diffusion below) and driven by a single shared clock:
	//
	//   Row 1  Autoregressive — tokens generated strictly left-to-right, one at
	//          a time. Before a token is generated its slot is empty (a subtle
	//          placeholder underline so the reader can see where it will land);
	//          there is no [MASK] sentinel — AR does not represent unfinished
	//          tokens at all.
	//   Row 2  Masked Diffusion — tokens generated in a fixed random order.
	//          Before a token is generated its slot shows the [MASK] sentinel.
	//
	// A single tempus Player drives a global `revealedCount ∈ [0, N]` and both
	// rows read from it: AR reveals index `i` iff `i < revealedCount`, and the
	// mask-diffusion row reveals index `i` iff `posInSchedule[i] < revealedCount`.
	// The two rows finish together after the same number of steps, so the point
	// of the figure is *which cells fill in when*, not which finishes first.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';
	import { TINY_STORY, tokenize } from './masked_diffusion_math';

	interface Props {
		isActive?: Writable<boolean>;
		text?: string;
		seed?: number;
		/** Background color of the pending-token rectangle. */
		maskColor?: string;
		/** Paragraph font size (any CSS length). */
		fontSize?: string;
		/** Toggle the smooth word↔mask opacity cross-fade at each flip instant. */
		crossFade?: boolean;
		/** Toggle the scale-pulse on each mask cell around its flip instant. */
		scalePulse?: boolean;
	}

	let {
		isActive,
		text = TINY_STORY,
		seed = 7,
		maskColor = '#c4c8ce',
		fontSize = '1.05rem',
		crossFade = true,
		scalePulse = false
	}: Props = $props();

	// Tokenization. Block diffusion in this figure reveals whole blocks at
	// once (all tokens in a block share the block's flip instant), so we no
	// longer draw per-token schedule times here.
	const tokenized = $derived(tokenize(text));
	const tokens = $derived(tokenized.tokens);
	const leading = $derived(tokenized.leading);
	const trailing = $derived(tokenized.trailing);
	const N = $derived(tokens.length);

	// Block-diffusion partition for the bottom row. Blocks complete strictly
	// left-to-right (block b+1 starts only after block b is fully revealed),
	// but within a block tokens un-mask in a random order according to their
	// per-token flip time — same cosine-schedule ordering as the plain MDM,
	// applied within each block's own time slice.
	const BLOCK_SIZE = 4;
	const nBlocks = $derived(Math.ceil(N / BLOCK_SIZE));
	const blockOf = $derived.by(() => {
		const b = new Array<number>(N);
		for (let i = 0; i < N; i++) b[i] = Math.floor(i / BLOCK_SIZE);
		return b;
	});
	// Tokens partitioned into their blocks. Each entry is the array of token
	// indices in that block, in original order. The block-diffusion row loops
	// over this so the whole block's tokens sit inside a single `<span
	// class="block">` wrapper — that wrapper carries the highlight background
	// as one continuous rounded rectangle, avoiding per-piece geometry
	// mismatches from decorating each token/whitespace span separately.
	const blockGroups = $derived.by(() => {
		const groups: number[][] = Array.from({ length: nBlocks }, () => []);
		for (let i = 0; i < N; i++) groups[blockOf[i]].push(i);
		return groups;
	});

	// One reveal clip + a hold at the end so the reader has time to see AR
	// finish, notice the block row already finished ~4× earlier, and read the
	// paragraph before both rows reset in lockstep. HOLD_MS is deliberately
	// long — the "block already done, AR still going" gap is the whole point
	// of the figure.
	const REVEAL_MS = 26000;
	const HOLD_MS = 5000;

	// Three-phase reveal schedule so the opening reads as "AR unmasks one
	// token per step; block-diffusion unmasks a whole block per step", both
	// running slowly for a few steps so the 6-vs-1-per-step contrast is
	// unmistakable. A brief pause lets it sink in, then both rows accelerate
	// so the block row still finishes visibly before AR.
	//   [0, SLOW_END]              slow phase   — AR reveals SLOW_STEPS tokens,
	//                                             block reveals SLOW_STEPS blocks
	//                                             (all cells in each block land
	//                                             together). Both rows tick at
	//                                             the same rate: one step here.
	//   [SLOW_END, PAUSE_END]      pause        — both frozen mid-decode.
	//   [PAUSE_END, 1]             fast finale  — AR finishes the rest at a
	//                                             brisker cadence; block runs
	//                                             BLOCK_SPEEDUP× faster.
	const SLOW_STEPS = 3;
	const SLOW_END = 0.16;
	const PAUSE_END = 0.16;

	interface State {
		progress: number;
	}

	let progress = $state(0);

	// Row-time warp: map the linear `progress ∈ [0, 1]` onto a per-row
	// "row-time" that runs SLOW_STEPS decoding steps at the same slow cadence
	// (one AR token per step; one whole block per step), pauses, then races.
	// In the fast phase both rows advance at the SAME per-step rate (equal
	// progress per unit), so block diffusion still finishes ~4× sooner in
	// wall-clock than AR simply because it needs 4× fewer steps.
	//   slow:   progress ∈ [0, SLOW_END]           →  row-time 0 → slowEnd
	//   pause:  progress ∈ [SLOW_END, PAUSE_END]   →  row-time = slowEnd
	//   fast:   progress ≥ PAUSE_END               →  row-time slowEnd → 1
	// AR's fast phase spans the rest of the clip; the block row completes
	// (nBlocks - SLOW_STEPS) steps at the same per-step rate and then holds.
	function warpRowTime(p: number, slowUnits: number, totalUnits: number): number {
		const slowEnd = slowUnits / totalUnits;
		if (p <= SLOW_END) return (p / SLOW_END) * slowEnd;
		if (p <= PAUSE_END) return slowEnd;
		// Per-step progress budget shared by both rows so their per-step wall-
		// clock rates match. AR (the longer row) sets the budget so it finishes
		// exactly at progress = 1.
		const perStep = (1 - PAUSE_END) / (N - SLOW_STEPS);
		const stepsDone = Math.min(totalUnits - slowUnits, (p - PAUSE_END) / perStep);
		return Math.min(1, slowEnd + (stepsDone / totalUnits));
	}
	const arRowTime = $derived(warpRowTime(progress, SLOW_STEPS, N));
	const bdRowTime = $derived(warpRowTime(progress, SLOW_STEPS, nBlocks));

	// Reveal offset inside a decoding step, in fractional-slot units. The
	// highlight lands on a unit at slot start (row-time-per-unit = i) and
	// its content pops in shortly after — a small delay is enough to read
	// as "the model is producing this token" without dragging.
	const REVEAL_OFFSET = 0.2;

	// Autoregressive: strict left-to-right. Tokens pop in on a hard step at
	// row-time * N = i + REVEAL_OFFSET, just after the highlight lands.
	function arOpacity(i: number): number {
		return arRowTime * N >= i + REVEAL_OFFSET ? 1 : 0;
	}

	// Block diffusion: blocks complete strictly left-to-right. All tokens in
	// a block reveal shortly after the highlight lands on the block, giving
	// a moment of anticipation before the whole block flips at once.
	function bdDist(i: number): number {
		const b = blockOf[i];
		return bdRowTime - (b + REVEAL_OFFSET) / nBlocks;
	}

	// Block diffusion: whole-block reveal on a hard step at the block's slot
	// midpoint — no cross-fade — so each block appears as a single discrete
	// decoding event.
	function bdOpacity(i: number): number {
		return bdDist(i) >= 0 ? 1 : 0;
	}

	// bdScale is unused now that reveals are instant (no fade window to pulse
	// through). Keeping the function so the template can call it uniformly.
	function bdScale(_i: number): number {
		return 1;
	}

	// Per-row progress values driving the clock icons — feed the warped
	// row-times so the clock hands mirror the same slow-pause-fast schedule
	// each row is actually running.
	const arRowProgress = $derived(arRowTime);
	const bdRowProgress = $derived(bdRowTime);

	// Currently-decoding target for each row, used to paint a light-orange
	// rounded rectangle behind the cell(s) about to unmask. AR highlights a
	// single token; block diffusion highlights every token in the block
	// currently being decoded.
	//
	// Once the row is fully done we set the target to -1 so the highlight
	// disappears during the hold clip rather than lingering on the final
	// token/block.
	const AR_DONE_EPS = 1e-4;
	const arTargetIndex = $derived(
		arRowTime >= 1 - AR_DONE_EPS ? -1 : Math.min(N - 1, Math.floor(arRowTime * N))
	);
	const bdTargetBlock = $derived(
		bdRowTime >= 1 - AR_DONE_EPS ? -1 : Math.min(nBlocks - 1, Math.floor(bdRowTime * nBlocks))
	);

	// "Just decoded" window — used to flash a brief blink on the token/block
	// the instant it first reveals. Reveal happens at row-time-per-unit =
	// index + REVEAL_OFFSET (see arOpacity / bdDist), so the class latches
	// from that instant for FLASH_STEPS fraction of the slot. Restricted to
	// the slow opening phase — the fast finale zips by too quickly for the
	// flash to read as anything but visual noise.
	const FLASH_STEPS = 0.6;
	const arJustDecoded = $derived.by(() => {
		if (progress > SLOW_END) return -1;
		if (arTargetIndex < 0) return -1;
		const revealedFrac = arRowTime * N - arTargetIndex - REVEAL_OFFSET;
		return revealedFrac >= 0 && revealedFrac < FLASH_STEPS ? arTargetIndex : -1;
	});
	const bdJustDecoded = $derived.by(() => {
		if (progress > SLOW_END) return -1;
		if (bdTargetBlock < 0) return -1;
		const revealedFrac = bdRowTime * nBlocks - bdTargetBlock - REVEAL_OFFSET;
		return revealedFrac >= 0 && revealedFrac < FLASH_STEPS ? bdTargetBlock : -1;
	});

	// Clock geometry (SVG viewBox = 0 0 40 40, center at (20, 20)).
	const CLOCK_SIZE = 40;
	const CLOCK_R_OUTER = 17;
	const CLOCK_R_RING = 14;   // inner edge of the orange ring (bezel = 3px)
	const CLOCK_R_FACE = 13;   // inside face (behind hands)
	// Hand lengths, measured from center.
	const MIN_HAND_LEN = 11;

	let player: Player<State> | undefined;

	function buildTimeline() {
		const revealClip = {
			name: 'reveal',
			reduce(t: number): Partial<State> {
				return { progress: t };
			}
		};
		const holdClip = {
			name: 'hold',
			reduce(_t: number): Partial<State> {
				return { progress: 1 };
			}
		};
		return new TimelineBuilder<State>()
			.setInitialState({ progress: 0 })
			.add(revealClip, { durationMs: REVEAL_MS })
			.add(holdClip, { durationMs: HOLD_MS })
			.build();
	}

	onMount(() => {
		player = new Player<State>(buildTimeline(), {
			looping: true,
			endPause: 0.5
		});
		player.onTick((_t, s) => {
			progress = s.progress;
		});

		const unsubActive = isActive?.subscribe((v) => {
			if (!player) return;
			if (v) player.play();
			else {
				player.pause();
				player.reset();
				progress = 0;
			}
		});

		return () => {
			unsubActive?.();
			player?.dispose();
		};
	});
</script>

{#snippet clockIcon(rowProgress: number)}
	{@const hourAngle = rowProgress * 360}
	{@const minuteAngle = rowProgress * 360 * 12}
	<svg
		class="clock"
		class:done={rowProgress >= 0.999}
		viewBox="0 0 {CLOCK_SIZE} {CLOCK_SIZE}"
		width={CLOCK_SIZE}
		height={CLOCK_SIZE}
		aria-hidden="true"
	>
		<!-- Outer bezel: dark circle, then a white ring, then the face fill.
			 Stacking three circles is simpler and crisper than nested paths. -->
		<circle cx="20" cy="20" r={CLOCK_R_OUTER} fill="#666" />
		<circle cx="20" cy="20" r={CLOCK_R_RING} fill="#ffffff" />
		<circle cx="20" cy="20" r={CLOCK_R_FACE} fill="#f7f7f7" />
		<!-- Hour hand as a filled rounded rectangle in lighter orange. Progress
			 is shown by rotating the hand clockwise: 0 → 12 o'clock, 1 → back
			 to 12 o'clock after a full sweep. Drawn pointing straight up in
			 its base pose (base at y=20, tip at y=20-11), rotated about the
			 clock center. -->
		<rect
			x={20 - 1.5}
			y={20 - 11}
			width="3"
			height="11"
			rx="1.5"
			ry="1.5"
			fill="#ffb373"
			transform="rotate({hourAngle} 20 20)"
		/>
		<!-- Minute hand (long, thin). Spins 12× faster than the hour hand. -->
		<line
			x1="20"
			y1="20"
			x2="20"
			y2={20 - MIN_HAND_LEN}
			stroke="#666"
			stroke-width="1.9"
			stroke-linecap="round"
			transform="rotate({minuteAngle} 20 20)"
		/>
		<!-- Center pin. -->
		<circle cx="20" cy="20" r="1.3" fill="#666" />
	</svg>
{/snippet}

<div class="wrap" style="--mask-color: {maskColor}; --paragraph-font-size: {fontSize};">
	<div class="row">
		<div class="row-header">
			<div class="label"><strong>Autoregressive</strong> &mdash; One Token at a Time</div>
			<div class="clock-group">
				<span class="speed">slow</span>
				{@render clockIcon(arRowProgress)}
			</div>
		</div>
		<div class="paragraph">
			{#each tokens as tok, i (i)}
				<div
					class="unit"
					class:highlight={i === arTargetIndex}
					class:just-decoded={i === arJustDecoded}
				>
					<div class="slot" aria-label={tok}>
						<span class="content" style="opacity: {arOpacity(i)}">{tok}</span
						><span class="placeholder ar" style="opacity: {1 - arOpacity(i)}"
							>&nbsp;</span
						>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="row">
		<div class="row-header">
			<div class="label"><strong>Block Diffusion</strong> &mdash; Multiple Tokens Simultaneously</div>
			<div class="clock-group">
				<span class="speed">fast</span>
				{@render clockIcon(bdRowProgress)}
			</div>
		</div>
		<div class="paragraph">
			{#each blockGroups as blockIndices, b (b)}
				<div
					class="block"
					class:highlight={b === bdTargetBlock}
					class:just-decoded={b === bdJustDecoded}
				>
					{#each blockIndices as i (i)}
						<div class="slot" aria-label={tokens[i]}>
							<span class="content" style="opacity: {bdOpacity(i)}">{tokens[i]}</span
							><span class="placeholder mask" style="opacity: {1 - bdOpacity(i)}"
								>[MASK]</span
							>
						</div>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.6rem;
		width: 100%;
		margin: 0 auto;
	}

	.row {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		min-width: 0;
	}


	/* Row header sits above the paragraph and holds the row label on the
	   left with a small clock icon pinned to the right. The header spans
	   the row's full width so the clock reads as belonging to that row and
	   the two clocks are vertically aligned across rows. */
	.row-header {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.label {
		font-size: 1.3rem;
		font-weight: 400;
		color: #666;
	}
	.label strong {
		font-weight: 600;
	}

	/* Groups the "fast" / "slow" text label with its clock so the pair sits
	   flush-right in the row-header. The clock stays pinned to the right edge
	   in both rows, keeping the two clocks vertically aligned across rows,
	   with the speed label placed just to the left of each clock. */
	.clock-group {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.35rem;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.speed {
		font-size: 0.9rem;
		font-weight: 500;
		color: #9aa0a6;
		line-height: 1;
	}

	.clock {
		flex-shrink: 0;
		display: block;
		transform-origin: center;
	}

	.clock.done {
		animation: clock-shake 0.5s ease-out 1;
	}

	@keyframes clock-shake {
		0%   { transform: translateX(0)      rotate(0deg); }
		15%  { transform: translateX(-1.5px) rotate(-8deg); }
		30%  { transform: translateX(1.5px)  rotate(8deg); }
		45%  { transform: translateX(-1.2px) rotate(-6deg); }
		60%  { transform: translateX(1.2px)  rotate(6deg); }
		75%  { transform: translateX(-0.6px) rotate(-3deg); }
		90%  { transform: translateX(0.6px)  rotate(3deg); }
		100% { transform: translateX(0)      rotate(0deg); }
	}

	/* Token grid: 12 constant-width cells per row. AR: each token is one cell.
	   Block diffusion: each 4-token block spans 4 cells, so 3 blocks per row,
	   with a subgrid inside so the 4 tokens still line up with the parent
	   grid's columns. */
	.paragraph {
		font-size: var(--paragraph-font-size, 1.05rem);
		line-height: 1.4;
		color: #333;
		margin: 0;
		width: 100%;
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		gap: 0.5rem 4px;
	}

	/* Wrapper around one decoding unit — a single AR token, or a whole block
	   of tokens for the block-diffusion row. Toggling `.highlight` paints a
	   light-orange rounded rectangle behind it. Horizontal padding is zero
	   so the block-to-block gap equals the token-to-token gap; the highlight
	   pill still reads clearly thanks to border-radius alone. */
	.unit {
		grid-column: span 1;
		border-radius: 6px;
		padding: 0.15em 0;
		display: flex;
		justify-content: center;
	}
	.block {
		grid-column: span 4;
		display: grid;
		grid-template-columns: subgrid;
		border-radius: 6px;
		padding: 0.15em 0;
	}
	.unit.highlight,
	.block.highlight {
		background: #fde0c8;
	}

	/* Blink flash on the wrapper the instant it first reveals its content.
	   The whole wrapper's background pulses between the deep orange accent
	   and the resting highlight color twice, so the eye catches every
	   decoding step even when scanning across the row. */
	.unit.just-decoded,
	.block.just-decoded {
		animation: reveal-blink 200ms ease-in-out 2;
	}
	@keyframes reveal-blink {
		0%, 100% {
			background: #fde0c8;
		}
		50% {
			background: #f7a869;
		}
	}

	.slot {
		/* Stack the revealed content and the placeholder in the same grid
		   cell so they cross-fade in place without shifting layout. */
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr;
		align-items: center;
		justify-items: center;
		min-width: 0;
		min-height: 1.4em;
	}

	.slot > .content,
	.slot > .placeholder {
		grid-row: 1;
		grid-column: 1;
		white-space: nowrap;
	}

	.placeholder.ar {
		/* No [MASK] for autoregressive — a subtle grey underline to hint at
		 * where the next token will land, so the row keeps its line rhythm.
		 * Sized to the cell width so it reads as a placeholder for the whole
		 * slot rather than a stray character. */
		width: 60%;
		height: 1em;
		border-bottom: 1px dashed #c8c8c8;
		color: transparent;
	}

	.placeholder.mask {
		/* Literal [MASK] pill — visually consistent with the inline <MaskToken>
		 * component used elsewhere in the blog, but sized to fit inside the
		 * constant-width column of the token grid without spilling into
		 * neighboring slots. */
		background: var(--mask-color, #cfe0f2);
		color: #33506e;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
		font-size: 0.7em;
		font-weight: 500;
		padding: 0.15em 0.15em;
		border-radius: 3px;
		white-space: nowrap;
		line-height: 1.25;
		max-width: 100%;
		box-sizing: border-box;
	}
</style>
