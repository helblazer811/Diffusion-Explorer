<script lang="ts">
	// ----------------------------------------------------------------
	// MLM preamble — framing figure at the top of the Masked Language
	// Modeling section. Two short token sequences side by side, showing
	// the two prediction problems this blog post cares about:
	//
	//   Left  ("Masked Language Model"):
	//         The cat [MASK] on the mat.
	//         ↑ predict the mask token in the middle from BOTH sides.
	//
	//   Right ("Autoregressive Model"):
	//         The cat sat on the ___
	//         ↑ predict the next token from left context only.
	//
	// Both panels use the same base sentence so the reader can see that
	// what changes between the two setups is WHICH position is blanked
	// out, not the underlying data.
	// ----------------------------------------------------------------

	interface Props {
		width?: number;
	}

	let { width = 760 }: Props = $props();

	// ---- Content ------------------------------------------------------
	// One base sentence. Each panel replaces exactly ONE position with a
	// prediction target: the mask position on the MLM side, the end
	// position on the AR side.
	const BASE = ['The', 'cat', 'sat', 'on', 'the', 'mat'];
	const MLM_MASK_INDEX = 2; // 'sat'
	// AR: keep the first five tokens, blank out the last one ('mat').
	const AR_VISIBLE = BASE.slice(0, 5);

	// ---- Layout -------------------------------------------------------
	const W = width;
	// Enough room for the token row, the header label above, and a
	// "Predict this" callout with arrow below.
	const H = 160;

	// Two panels, each centered in half of the canvas.
	const PANEL_W = W / 2;
	const LEFT_CX = PANEL_W / 2;
	const RIGHT_CX = PANEL_W + PANEL_W / 2;

	const TOKEN_H = 34;
	const TOKEN_GAP = 6;
	// Base widths per token (variable to feel like real text).
	function tokenW(text: string): number {
		// Enough padding on either side; scale roughly with char count.
		return Math.max(38, 12 + text.length * 10);
	}

	interface Slot {
		kind: 'word' | 'mask' | 'blank';
		text: string;
		width: number;
	}

	function buildMLMSlots(): Slot[] {
		return BASE.map((tok, i) => {
			if (i === MLM_MASK_INDEX) {
				return { kind: 'mask', text: '[MASK]', width: tokenW('[MASK]') };
			}
			return { kind: 'word', text: tok, width: tokenW(tok) };
		});
	}

	function buildARSlots(): Slot[] {
		const visible: Slot[] = AR_VISIBLE.map((tok) => ({
			kind: 'word',
			text: tok,
			width: tokenW(tok)
		}));
		visible.push({ kind: 'mask', text: '[MASK]', width: tokenW('[MASK]') });
		return visible;
	}

	const mlmSlots = buildMLMSlots();
	const arSlots = buildARSlots();

	function rowTotalWidth(slots: Slot[]): number {
		return slots.reduce((acc, s) => acc + s.width, 0) + TOKEN_GAP * (slots.length - 1);
	}

	// Vertical position of the token row (baseline).
	const HEADER_Y = 24; // header label
	const ROW_Y = 72; // token center
	const CALLOUT_LABEL_Y = 148; // "Predict this" text baseline
	// Arrow points from the callout up to the predict-target's bottom edge.
	const ARROW_TARGET_Y = ROW_Y + TOKEN_H / 2 + 4;
	const ARROW_START_Y = CALLOUT_LABEL_Y - 16;

	function layoutRow(cx: number, slots: Slot[]) {
		const total = rowTotalWidth(slots);
		let x = cx - total / 2;
		return slots.map((s) => {
			const slotX = x;
			x += s.width + TOKEN_GAP;
			return { ...s, x: slotX, cx: slotX + s.width / 2 };
		});
	}

	const mlmLayout = $derived(layoutRow(LEFT_CX, mlmSlots));
	const arLayout = $derived(layoutRow(RIGHT_CX, arSlots));

	// Predict targets: index of the slot the "Predict this" arrow points at.
	const mlmTargetIndex = MLM_MASK_INDEX;
	const arTargetIndex = arSlots.length - 1;
	const mlmTarget = $derived(mlmLayout[mlmTargetIndex]);
	const arTarget = $derived(arLayout[arTargetIndex]);

	// Colors.
	const HEADER_COLOR = '#333';
	const TOKEN_COLOR = '#333';
	const CALLOUT_COLOR = '#9aa0a6';
	const BLANK_STROKE = '#c7c9cc';
</script>

<div class="wrap">
	<svg
		viewBox={`0 0 ${W} ${H}`}
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Two side-by-side sequences framing what masked language modeling is trying to do. Left panel labeled Masked Language Model: the sentence 'The cat [MASK] on the mat.' with a 'Predict this' arrow pointing at the middle mask token. Right panel labeled Autoregressive Model: the same sentence with the last word blanked out, and a 'Predict this' arrow pointing at that final blank."
	>
		<defs>
			<marker
				id="preamble-arrowhead"
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={5}
				markerHeight={5}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={CALLOUT_COLOR} />
			</marker>
		</defs>

		<!-- ============= LEFT PANEL: Masked Language Model ============= -->
		<g>
			<text
				x={LEFT_CX}
				y={HEADER_Y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="18"
				font-weight="600"
				fill={HEADER_COLOR}
			>
				Masked Language Model
			</text>

			{#each mlmLayout as slot, i}
				{#if slot.kind === 'mask'}
					<line
						x1={slot.cx - slot.width / 2 + 4}
						y1={ROW_Y + TOKEN_H / 2 - 4}
						x2={slot.cx + slot.width / 2 - 4}
						y2={ROW_Y + TOKEN_H / 2 - 4}
						stroke={BLANK_STROKE}
						stroke-width="1.6"
						stroke-dasharray="4 3"
					/>
				{:else}
					<text
						x={slot.cx}
						y={ROW_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="18"
						fill={TOKEN_COLOR}
					>
						{slot.text}
					</text>
				{/if}
				{#if i === mlmLayout.length - 1}
					<!-- trailing period stays visually attached to last word -->
					<text
						x={slot.cx + slot.width / 2 - 2}
						y={ROW_Y}
						text-anchor="start"
						dominant-baseline="central"
						font-size="18"
						fill={TOKEN_COLOR}
					>
						.
					</text>
				{/if}
			{/each}

			<path
				d={`M ${mlmTarget.cx} ${ARROW_START_Y} C ${mlmTarget.cx} ${ARROW_START_Y - 12}, ${mlmTarget.cx} ${ARROW_TARGET_Y + 12}, ${mlmTarget.cx} ${ARROW_TARGET_Y}`}
				fill="none"
				stroke={CALLOUT_COLOR}
				stroke-width="1.4"
				marker-end="url(#preamble-arrowhead)"
			/>
			<text
				x={mlmTarget.cx}
				y={CALLOUT_LABEL_Y}
				text-anchor="middle"
				dominant-baseline="alphabetic"
				font-size="16"
				fill={CALLOUT_COLOR}
				font-style="italic"
			>
				Predict this
			</text>
		</g>

		<!-- ============= RIGHT PANEL: Autoregressive Model ============= -->
		<g>
			<text
				x={RIGHT_CX}
				y={HEADER_Y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="18"
				font-weight="600"
				fill={HEADER_COLOR}
			>
				Autoregressive Model
			</text>

			{#each arLayout as slot}
				{#if slot.kind === 'mask'}
					<line
						x1={slot.cx - slot.width / 2 + 4}
						y1={ROW_Y + TOKEN_H / 2 - 4}
						x2={slot.cx + slot.width / 2 - 4}
						y2={ROW_Y + TOKEN_H / 2 - 4}
						stroke={BLANK_STROKE}
						stroke-width="1.6"
						stroke-dasharray="4 3"
					/>
				{:else}
					<text
						x={slot.cx}
						y={ROW_Y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="18"
						fill={TOKEN_COLOR}
					>
						{slot.text}
					</text>
				{/if}
			{/each}

			<path
				d={`M ${arTarget.cx} ${ARROW_START_Y} C ${arTarget.cx} ${ARROW_START_Y - 12}, ${arTarget.cx} ${ARROW_TARGET_Y + 12}, ${arTarget.cx} ${ARROW_TARGET_Y}`}
				fill="none"
				stroke={CALLOUT_COLOR}
				stroke-width="1.4"
				marker-end="url(#preamble-arrowhead)"
			/>
			<text
				x={arTarget.cx}
				y={CALLOUT_LABEL_Y}
				text-anchor="middle"
				dominant-baseline="alphabetic"
				font-size="16"
				fill={CALLOUT_COLOR}
				font-style="italic"
			>
				Predict this
			</text>
		</g>
	</svg>
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		max-width: 760px;
		margin: 0 auto;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
</style>
