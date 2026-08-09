<script lang="ts">
	// Exposure-bias figure. Two panels stacked on the same 5-token prompt.
	//
	//   Top    "Teacher Forcing"          — the whole 5-token context is given
	//                                       clean and static; the model predicts
	//                                       exactly one next token, which pops
	//                                       into a placeholder slot. Context is
	//                                       always correct — this is what the
	//                                       model sees during training.
	//   Bottom "Autoregressive Sampling"  — the whole sequence is model-
	//                                       generated. The animation infills the
	//                                       tokens one at a time; one of the
	//                                       sampled tokens is wrong (red), and
	//                                       every token sampled after it is
	//                                       conditioned on that corrupted
	//                                       context (pink) — so the final
	//                                       prediction is off.

	import { onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { TimelineBuilder, Player } from '@helblazer811/tempus';

	interface Props {
		isActive?: Writable<boolean>;
	}

	let { isActive }: Props = $props();

	const CONTEXT: string[] = ['The', 'cat', 'sat', 'on', 'the'];
	const CLEAN_NEXT = 'mat';

	interface ARToken {
		text: string;
		error?: boolean;
		downstream?: boolean;
	}
	const AR_TOKENS: ARToken[] = [
		{ text: 'The' },
		{ text: 'cat' },
		{ text: 'sat' },
		{ text: 'a', error: true },
		{ text: 'hot', downstream: true },
		{ text: 'stove', downstream: true }
	];

	const N_AR = AR_TOKENS.length;

	const REVEAL_MS = 8000;
	const HOLD_MS = 4000;

	interface State {
		progress: number;
	}
	let progress = $state(0);

	const REVEAL_OFFSET = 0.35;
	function arOpacity(i: number): number {
		return progress * N_AR >= i + REVEAL_OFFSET ? 1 : 0;
	}
	const AR_DONE_EPS = 1e-4;
	const arTargetIndex = $derived(
		progress >= 1 - AR_DONE_EPS ? -1 : Math.min(N_AR - 1, Math.floor(progress * N_AR))
	);

	const TF_REVEAL_AT = 0.85;
	const tfNextRevealed = $derived(progress >= TF_REVEAL_AT);
	const tfHighlight = $derived(progress >= TF_REVEAL_AT - 0.1 && progress < 1 - AR_DONE_EPS);

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

<div class="wrap">
	<div class="panel">
		<div class="panel-label">
			<strong>Teacher Forcing</strong>
			<span class="sub">— training: context is always clean</span>
		</div>
		<div class="row">
			{#each CONTEXT as tok, i (i)}
				<div class="cell clean" aria-label={tok}>
					<span class="content visible">{tok}</span>
				</div>
			{/each}
			<div class="arrow" aria-hidden="true">→</div>
			<div
				class="cell predicted"
				class:filled={tfNextRevealed}
				class:highlight={tfHighlight}
				aria-label={CLEAN_NEXT}
			>
				<span class="content" class:visible={tfNextRevealed}>{CLEAN_NEXT}</span>
				<span class="placeholder" class:hidden={tfNextRevealed}>?</span>
			</div>
		</div>
		<div class="note">Every token in the prefix is ground-truth.</div>
	</div>

	<div class="panel">
		<div class="panel-label">
			<strong>Autoregressive Sampling</strong>
			<span class="sub">— deployment: context is model-generated</span>
		</div>
		<div class="row">
			{#each AR_TOKENS as ar, i (i)}
				{@const revealed = arOpacity(i) > 0}
				{@const isPrediction = i === N_AR - 1}
				{#if isPrediction}
					<div class="arrow" aria-hidden="true">→</div>
				{/if}
				<div
					class="cell"
					class:sampled={revealed && !ar.error && !ar.downstream}
					class:error={revealed && ar.error}
					class:downstream={revealed && ar.downstream}
					class:highlight={i === arTargetIndex}
					aria-label={ar.text}
				>
					<span class="content" class:visible={revealed}>{ar.text}</span>
					<span class="placeholder" class:hidden={revealed}>?</span>
				</div>
			{/each}
		</div>
		<div class="note">One wrong sample corrupts the prefix — later tokens condition on it.</div>
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2rem;
		width: 100%;
		margin: 0 auto;
	}

	.panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
	}

	.panel-label {
		font-size: 1.25rem;
		color: #444;
	}
	.panel-label strong {
		font-weight: 600;
	}
	.panel-label .sub {
		color: #888;
		font-weight: 400;
		margin-left: 0.4rem;
	}

	.row {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: nowrap;
	}

	.arrow {
		font-size: 1.4rem;
		color: #999;
		padding: 0 0.25rem;
	}

	.cell {
		position: relative;
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr;
		align-items: center;
		justify-items: center;
		min-width: 3.4em;
		padding: 0.35em 0.6em;
		border-radius: 6px;
		font-size: 1.15rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
		background: #f2f4f7;
		color: #333;
		border: 1px solid transparent;
		transition:
			background 220ms ease,
			border-color 220ms ease,
			color 220ms ease;
	}

	.cell .content,
	.cell .placeholder {
		grid-row: 1;
		grid-column: 1;
		transition: opacity 180ms ease;
	}
	.cell .content {
		opacity: 0;
	}
	.cell .content.visible {
		opacity: 1;
	}
	.cell .placeholder {
		color: #b8b8b8;
	}
	.cell .placeholder.hidden {
		opacity: 0;
	}

	.cell.clean,
	.cell.sampled {
		background: #eef2f6;
		color: #333;
	}

	.cell.error {
		background: #fde3e3;
		color: #9c1a1a;
		border-color: #f5b3b3;
	}

	.cell.downstream {
		background: #fdeeee;
		color: #7a3a3a;
		border-color: #f2cccc;
	}

	.cell.highlight {
		outline: 2px solid #f7a869;
		outline-offset: -1px;
	}

	.cell.predicted {
		background: transparent;
		border: 1px dashed #b8b8b8;
	}
	.cell.predicted.filled {
		background: #e5f4e6;
		color: #1e6b3a;
		border: 1px solid #b3d9be;
	}

	.note {
		font-size: 0.95rem;
		color: #777;
	}
</style>
