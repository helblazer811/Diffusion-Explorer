<script lang="ts">
	// Paired forward-and-reverse diffusion figure. A single tempus timeline drives
	// two visualisations in lockstep:
	//
	//   Top row: one 2-D point diffusing from the data distribution (a smiley
	//            face, LEFT) to a standard Gaussian (RIGHT) under the DDPM /
	//            VP-SDE forward process — a single Brownian-looking sample path.
	//   Bottom row: a short paragraph whose word tokens are progressively
	//            replaced by a colored placeholder rectangle — the
	//            absorbing-state (masked) forward diffusion process on text.
	//
	// The timeline plays a triangle wave in [0, 1]: progress rises 0 → 1
	// (forward: data → noise; paragraph gets masked), then falls 1 → 0
	// (reverse: noise → data; paragraph is un-masked). A single TimeSlider
	// controls the shared playhead and doubles as the play/pause button.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { Player } from '@helblazer811/tempus';
	import { base } from '$app/paths';
	import SmileyDiffusionFlow from './SmileyDiffusionFlow.svelte';
	import { TimeSlider } from '@diffusion-explorer/ui';
	import {
		gaussianCloud,
		buildBrownianPath,
		jitterAndSubsampleSmiley
	} from './smiley_diffusion';
	import type { Vec2 } from './trajectories';
	import { TINY_STORY, tokenize } from './masked_diffusion_math';
	import {
		drawFlipUniforms,
		cosineSchedule,
		flipInstant
	} from './masked_diffusion_math';
	import {
		buildForwardReverseTimeline,
		FORWARD_REVERSE_HALF_MS,
		FORWARD_REVERSE_HOLD_MS,
		FORWARD_REVERSE_TOTAL_MS,
		type ForwardReverseState
	} from './forward_reverse_timeline';

	interface Props {
		isActive?: Writable<boolean>;
		size?: number;
		text?: string;
		seed?: number;
		maskColor?: string;
		/** Toggle the scale-pulse on each mask cell around its flip instant. */
		scalePulse?: boolean;
		/** Toggle the smooth word↔mask opacity cross-fade at each flip instant. */
		crossFade?: boolean;
		/** Which of the two tracks to render. 'both' keeps the original figure;
		 *  'continuous' shows only the smiley-diffusion track; 'masked' shows
		 *  only the masked-text track. In every case the same triangle-wave
		 *  timeline drives what's rendered, so a single time slider still scrubs
		 *  it correctly. */
		variant?: 'both' | 'continuous' | 'masked';
		/** Optional externally-owned Player. When provided, this figure skips
		 *  building its own timeline/player and only subscribes to the shared
		 *  clock. Used to keep the paired continuous+masked figures in the
		 *  "Relation to Continuous Diffusion" section in exact lockstep. The
		 *  parent owns play/pause/reset lifecycle and disposal. */
		sharedPlayer?: Player<ForwardReverseState>;
		/** When false, suppress the per-figure <TimeSlider>. Used by the
		 *  top-of-page hero, which renders a single slider outside the two
		 *  paired figures and drives them via `sharedPlayer`. */
		showSlider?: boolean;
		/** How the masked panel renders its tokens.
		 *   - 'flowing' (default): a natural paragraph with variable-width
		 *     slots and preserved whitespace. Used in §Relation to Continuous
		 *     Diffusion.
		 *   - 'grid': a fixed-width 12-column token grid with literal [MASK]
		 *     pill placeholders, matching the crown-jewel layout used by
		 *     GenerationComparisonFigure in the sequel post. Semantics stay
		 *     plain-MDM (each token has its own random flip time). */
		maskedLayout?: 'flowing' | 'grid';
		/** When false, suppress the per-figure "Forward"/"Reverse" direction
		 *  badge that normally sits above the section. Used by the top-of-page
		 *  hero, which renders a single shared badge above the whole pair. */
		showDirectionBadge?: boolean;
		/** Number of columns in the grid-layout masked panel. Only meaningful
		 *  when `maskedLayout='grid'`. Default 12. The hero uses 11 so the
		 *  bottom panel's tokens-per-row is one less than the crown jewel in
		 *  the sequel post, giving a slightly taller grid at the same width. */
		gridColumns?: number;
	}

	let {
		isActive,
		size = 800,
		text = TINY_STORY,
		seed = 7,
		maskColor = '#cfe0f2',
		scalePulse = true,
		crossFade = true,
		variant = 'both',
		sharedPlayer,
		showSlider = true,
		maskedLayout = 'flowing',
		showDirectionBadge = true,
		gridColumns = 12
	}: Props = $props();

	const showContinuous = variant === 'both' || variant === 'continuous';
	const showMasked = variant === 'both' || variant === 'masked';
	// Unique per-instance so two side-by-side variants don't collide on the
	// same SVG marker ID.
	const arrowMarkerId = `direction-arrowhead-${variant}`;

	// --- Continuous flow: smiley face loaded from static asset (source), and
	// a Gaussian cloud generated deterministically (target). A single sample
	// point traces a Brownian-motion path from a smiley point to a Gaussian
	// sample via the DDPM forward SDE.
	let smiley = $state<Vec2[]>([]);
	const gaussian = gaussianCloud(300, seed * 7919 + 1, 0.55);
	// Start the trajectory at the right eye of the smiley (its densest cluster
	// in the smiley_face.json dataset). The SDE will carry it out under drift +
	// diffusion toward the Gaussian on the right. We probe seeds and pick the
	// first path that stays within the visible canvas bounds — Brownian motion
	// has no built-in bound, so a naive seed sometimes wanders off-screen.
	const X0: Vec2 = { x: 1.0, y: -1.0 };
	// Bounded-Brownian: probe seeds in a fixed order and pick the first path
	// whose (recentered) pixel coordinates stay inside the canvas rectangle
	// with a margin. The order is deterministic so once a good seed is picked,
	// it never changes.
	function pickBoundedTrajectorySeed(baseSeed: number): number {
		const WORLD_SCALE = 60;
		const SRC_X_FRAC = 0.15;
		const TGT_X_FRAC = 0.85;
		const W = size;
		const H = 220; // must match CANVAS_HEIGHT below
		const cy = H / 2;
		const margin = 12; // px
		const yLoBound = margin;
		const yHiBound = H - margin;
		const xLoBound = margin;
		const xHiBound = W - margin;
		// The trajectory's per-frame visual world-center is a lerp between the
		// smiley's mean-x (~0 for the smiley_face.json) and the Gaussian's
		// mean-x (~0). Both means are near 0, so worldCx ≈ 0 across the path.
		const worldCx = 0;
		for (let k = 0; k < 4096; k++) {
			const candidate = (baseSeed + k * 2654435761) >>> 0;
			const path = buildBrownianPath(X0, candidate, 200);
			let ok = true;
			for (let i = 0; i < path.length; i++) {
				const t = i / (path.length - 1);
				const centerPx = SRC_X_FRAC * W + (TGT_X_FRAC - SRC_X_FRAC) * W * t;
				const px = centerPx + (path[i].x - worldCx) * WORLD_SCALE;
				const py = cy + path[i].y * WORLD_SCALE;
				if (px < xLoBound || px > xHiBound || py < yLoBound || py > yHiBound) {
					ok = false;
					break;
				}
			}
			if (ok) return candidate;
		}
		return baseSeed;
	}
	const trajectorySeed = pickBoundedTrajectorySeed(seed * 131 + 3);
	const trajectory = buildBrownianPath(X0, trajectorySeed, 200);

	// Canvas height for the top row.
	const CANVAS_HEIGHT = 220;

	// --- Masked text: uses the faithful MDLM forward process. Each token gets
	// its own independent Uniform(0,1) draw u_i; under a cosine schedule, its
	// mask instant is t_i = (2/π) · arccos(1 − u_i). This means multiple
	// tokens can flip in the same infinitesimal window (their u_i are
	// clustered), matching the true stochastic forward process rather than a
	// strict one-token-per-step permutation.
	const tokenized = $derived(tokenize(text));
	const tokens = $derived(tokenized.tokens);
	const leading = $derived(tokenized.leading);
	const trailing = $derived(tokenized.trailing);
	const N = $derived(tokens.length);
	const uniforms = $derived(drawFlipUniforms(N, seed));
	// Per-token mask instant in [0, 1] under the chosen schedule.
	// The token "birds" is pinned to the earliest possible flip instant so
	// it's always the first word to become [MASK] on the forward pass —
	// useful when this figure sits in a still image and the callout below
	// needs to point at a token that's already been masked. The rest of the
	// sequence keeps its stochastic cosine-schedule order.
	const flipTimes = $derived.by(() => {
		const t = uniforms.map((u) => flipInstant(u, cosineSchedule));
		for (let i = 0; i < tokens.length; i++) {
			if (tokens[i] === 'birds') t[i] = 0.001;
		}
		return t;
	});

	// --- Timeline: forward leg → hold at noise → reverse leg → hold at data.
	// We fold to a 0 → 1 → 0 triangle wave on `progress`; `u ∈ [0, 2]` encodes
	// which leg we're on for the direction label + slider seek mapping.
	// Constants + builder live in ./forward_reverse_timeline so a parent can
	// build an equivalent shared Player and pass it in via `sharedPlayer`.
	const HALF_MS = FORWARD_REVERSE_HALF_MS;
	const HOLD_MS = FORWARD_REVERSE_HOLD_MS;
	const TOTAL_MS = FORWARD_REVERSE_TOTAL_MS;

	type TState = ForwardReverseState;
	let u = $state(0);

	const progress = $derived(u <= 1 ? u : 2 - u);
	const goingForward = $derived(u <= 1);

	// Cross-fade half-width in units of *time* (t is in [0, 1]). Wider = slower,
	// more overlapping transitions between tokens whose flip instants are near
	// each other.
	const FADE_WIDTH_T = 0.09;
	// Scale-pulse peak applied to the mask rectangle at the flip instant.
	const SCALE_PEAK = 0.12;

	function distFromFlip(i: number): number {
		// Signed distance in *time* from token i's flip instant.
		// d > 0 → past the flip (masked); d < 0 → not yet flipped (revealed).
		return progress - flipTimes[i];
	}

	function tokenOpacity(i: number): number {
		// Opacity of the REVEALED (real word) span. Placeholder = 1 − this.
		const d = distFromFlip(i);
		if (!crossFade) return d >= 0 ? 0 : 1; // hard step at the flip instant
		if (d >= FADE_WIDTH_T) return 0;
		if (d <= -FADE_WIDTH_T) return 1;
		const uu = (d + FADE_WIDTH_T) / (2 * FADE_WIDTH_T);
		return 1 - uu * uu * (3 - 2 * uu);
	}

	// Scale pulse on the mask cell across the fade window: peaks at d=0 (the
	// exact flip instant) and decays smoothly to 1.0 outside the window. Reads
	// as the token "popping" during its transition. Disabled when the parent
	// sets `scalePulse={false}`.
	function maskScale(i: number): number {
		if (!scalePulse) return 1;
		const d = distFromFlip(i);
		if (Math.abs(d) >= FADE_WIDTH_T) return 1;
		const u = d / FADE_WIDTH_T; // ∈ [-1, 1]
		const bell = 1 - u * u;
		return 1 + SCALE_PEAK * bell;
	}

	let player = $state<Player<TState> | undefined>(undefined);

	onMount(() => {
		let unsubActive: (() => void) | undefined;

		if (!sharedPlayer) {
			// This instance owns its clock. Build a Player + wire visibility.
			player = new Player<TState>(buildForwardReverseTimeline(), {
				looping: true,
				endPause: 0.15
			});
			player.onTick((_t, s) => {
				u = s.u;
			});

			unsubActive = isActive?.subscribe((v) => {
				if (!player) return;
				if (v) player.play();
				else {
					player.pause();
					player.reset();
					u = 0;
				}
			});
		}

		// Load the smiley-face point cloud (300 [x, y] pairs).
		fetch(`${base}/data/smiley_face.json`)
			.then((r) => r.json())
			.then((raw: { points: number[][] }) => {
				const loaded = raw.points.map(([x, y]) => ({ x, y }));
				smiley = jitterAndSubsampleSmiley(loaded, seed * 977 + 5);
			})
			.catch((err) => console.error('failed to load smiley_face.json', err));

		return () => {
			unsubActive?.();
			if (!sharedPlayer) player?.dispose();
		};
	});

	// When a `sharedPlayer` is passed in (possibly after mount, since the
	// parent may build it in its own onMount), subscribe to its tick stream.
	// The parent owns play/pause/reset and disposal for a shared player, so
	// we only mirror state here. Runs client-side only.
	$effect(() => {
		if (!sharedPlayer) return;
		player = sharedPlayer;
		const unsubTick = sharedPlayer.onTick((_t, s) => {
			u = s.u;
		});
		return () => {
			unsubTick();
		};
	});

	// Map slider value ∈ [0,1] (the shared `progress`) back to a raw player time
	// t ∈ [0,1] over the full 4-clip loop. Grabbing the slider mid-forward keeps
	// you on the forward leg (skipping over the noise hold); likewise for reverse.
	function onSeekByDisplayTime(v: number) {
		if (!player) return;
		const forwardEnd = HALF_MS / TOTAL_MS;
		const reverseStart = (HALF_MS + HOLD_MS) / TOTAL_MS;
		const reverseSpan = HALF_MS / TOTAL_MS;
		const rawT = goingForward ? v * forwardEnd : reverseStart + (1 - v) * reverseSpan;
		player.seek(rawT);
		u = goingForward ? v : 2 - v;
	}
</script>

{#snippet directionBadge()}
	<div class="direction-badge direction-badge-inline" class:is-reverse={!goingForward} aria-hidden="true">
		<svg class="direction-arrow" viewBox="0 0 240 32" preserveAspectRatio="none">
			<defs>
				<marker
					id={arrowMarkerId}
					viewBox="0 -5 10 10"
					refX={8}
					refY={0}
					markerWidth={5}
					markerHeight={5}
					orient="auto"
				>
					<path d="M0,-5L10,0L0,5" fill="#c8ccd1" />
				</marker>
			</defs>
			<line
				x1={goingForward ? 4 : 236}
				y1={16}
				x2={goingForward ? 236 : 4}
				y2={16}
				stroke="#c8ccd1"
				stroke-width="2.5"
				marker-end="url(#{arrowMarkerId})"
			/>
		</svg>
		<span class="direction-text">
			{goingForward ? 'Forward' : 'Reverse'}
		</span>
	</div>
{/snippet}

<div class="wrap" style="--mask-color: {maskColor}">
	{#if showContinuous}
		<div class="section">
			{#if showDirectionBadge}{@render directionBadge()}{/if}
			<div class="canvas-row">
				<SmileyDiffusionFlow
					{trajectory}
					source={smiley}
					target={gaussian}
					{progress}
					width={size}
					height={CANVAS_HEIGHT}
				/>
			</div>
		</div>
	{/if}

	{#if showMasked}
		<div class="section">
			{#if showDirectionBadge}{@render directionBadge()}{/if}
			{#if maskedLayout === 'grid'}
				<!-- Grid layout: a fixed-column token grid with fixed-width slots
					 and literal [MASK] pill placeholders. Matches the crown-jewel
					 aesthetic used by GenerationComparisonFigure in the sequel
					 post. Semantics stay plain-MDM (each token has its own
					 random flip time via `tokenOpacity(i)`). The column count is
					 configurable via `gridColumns` (default 12); the hero uses
					 11 to give the panel a slightly taller shape at the same
					 width. -->
				<div class="grid-paragraph" style="--grid-columns: {gridColumns};">
					{#each tokens as tok, i (i)}
						<div class="grid-slot" aria-label={tok}>
							<span class="grid-word" style="opacity: {tokenOpacity(i)}"
								>{tok}</span
							><span class="grid-mask" style="opacity: {1 - tokenOpacity(i)}"
								>[MASK]</span
							>
						</div>
					{/each}
				</div>
			{:else}
				<p class="paragraph">
					{#each tokens as tok, i (i)}
						<span class="pre">{leading[i]}</span><span class="slot" aria-label={tok}>
							<span class="word" style="opacity: {tokenOpacity(i)}">{tok}</span
							><span
								class="mask"
								style="opacity: {1 - tokenOpacity(i)}; transform: scale({maskScale(i)});"
								>&nbsp;</span
							>
						</span><span class="post">{trailing[i]}</span>
					{/each}
				</p>
			{/if}
		</div>
	{/if}

	{#if showSlider}
		<div class="slider-row">
			<TimeSlider
				timeline={player ?? null}
				min={0}
				max={1}
				step={0.001}
				showTicks={true}
				showTimeLabel={false}
				minLabel="t=0"
				maxLabel="t=1"
				displayTime={progress}
				{onSeekByDisplayTime}
				color="#f17720"
			/>
		</div>
	{/if}
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		margin: 0 auto;
	}

	.section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
	}

	.section-label {
		font-size: 1.15rem;
		font-weight: 600;
		color: #666;
	}

	.canvas-row {
		display: flex;
		justify-content: center;
		width: 100%;
	}

	.paragraph {
		font-size: 1.2rem;
		line-height: 1.9;
		color: #333;
		margin: 0.5rem 0;
		text-align: left;
		max-width: 780px;
	}

	.pre,
	.post {
		white-space: pre-wrap;
	}

	.slot {
		display: inline-grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr;
		vertical-align: middle;
		line-height: inherit;
		align-items: center;
		justify-items: center;
		margin: 0 2px;
	}
	.slot > .word,
	.slot > .mask {
		grid-row: 1;
		grid-column: 1;
		white-space: nowrap;
	}

	.mask {
		width: 100%;
		height: 1em;
		background: var(--mask-color, #cfe0f2);
		border-radius: 3px;
		color: transparent;
	}

	/* Grid layout: alternate rendering of the masked panel used when
	   `maskedLayout='grid'` (top-of-page hero). Tokens are laid out on a
	   12-column grid with fixed-width cells and literal [MASK] pill
	   placeholders. Matches the crown-jewel aesthetic in the sequel post. */
	.grid-paragraph {
		font-size: 1.05rem;
		line-height: 1.4;
		color: #333;
		margin: 0.5rem 0;
		width: 100%;
		max-width: 780px;
		display: grid;
		grid-template-columns: repeat(var(--grid-columns, 12), 1fr);
		gap: 0.5rem 4px;
	}
	.grid-slot {
		grid-column: span 1;
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr;
		align-items: center;
		justify-items: center;
		min-width: 0;
		min-height: 1.4em;
	}
	.grid-slot > .grid-word,
	.grid-slot > .grid-mask {
		grid-row: 1;
		grid-column: 1;
		white-space: nowrap;
	}
	.grid-mask {
		background: var(--mask-color, #cfe0f2);
		color: #33506e;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
		font-size: 0.7em;
		font-weight: 500;
		padding: 0.15em 0.15em;
		border-radius: 3px;
		line-height: 1.25;
		max-width: 100%;
		box-sizing: border-box;
	}

	.slider-row {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
	}

	.direction-badge {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 240px;
		height: 32px;
		margin: 0 auto 0.4rem;
		pointer-events: none;
	}

	.direction-arrow {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.direction-text {
		position: relative;
		z-index: 1;
		padding: 0 0.6rem;
		background: #ffffff;
		font-size: 1.15rem;
		font-weight: 600;
		color: #666;
		letter-spacing: 0.02em;
	}
</style>
