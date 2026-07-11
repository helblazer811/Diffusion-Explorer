<script lang="ts">
	// Small inline visualization pairing the parametric form
	// Cat(x; p_1, ..., p_K) with a matching bar chart. Static (no timeline);
	// meant to sit next to a paragraph that introduces the categorical
	// distribution — not a captioned figure.

	import { Katex } from '@diffusion-explorer/ui';

	interface Props {
		width?: number;
	}

	let { width = 380 }: Props = $props();

	// Rows mirror the `p_1, p_2, \ldots, p_K` structure on the LHS: two
	// concrete categories, an ellipsis row, then the K-th category.
	const rows: { word: string; p: number | null }[] = [
		{ word: 'little', p: 0.62 },
		{ word: 'black', p: 0.26 },
		{ word: '…', p: null },
		{ word: 'angry', p: 0.05 }
	];

	const BAR_COLOR = '#99BCDC';
	const TEXT_COLOR = '#333';

	const ROW_H = 26;
	const LABEL_W = 68;
	const MAX_BAR_W = 250;
	const BAR_H = 18;
	const H = rows.length * ROW_H + 8;
	const W = width;
</script>

<div class="wrap">
	<div class="notation">
		<Katex math={"\\mathrm{Cat}(x;\\; p_1, p_2, \\ldots, p_K)"} />
	</div>

	<svg
		class="arrow"
		width={44}
		height={20}
		viewBox="0 0 44 20"
		role="presentation"
		aria-hidden="true"
	>
		<defs>
			<marker
				id="cat-inline-arrow"
				viewBox="0 -5 10 10"
				refX={8}
				refY={0}
				markerWidth={5}
				markerHeight={5}
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill={TEXT_COLOR} />
			</marker>
		</defs>
		<line
			x1={2}
			y1={10}
			x2={38}
			y2={10}
			stroke={TEXT_COLOR}
			stroke-width="1.5"
			marker-end="url(#cat-inline-arrow)"
		/>
	</svg>

	<svg
		{width}
		height={H}
		viewBox={`0 0 ${W} ${H}`}
		role="img"
		aria-label="Bar chart: little 0.62, black 0.26, and additional categories trailing off with an ellipsis."
	>
		{#each rows as row, r}
			{@const rowY = 4 + r * ROW_H}
			{@const barX = LABEL_W}
			{#if row.p !== null}
				<text
					x={LABEL_W - 6}
					y={rowY + ROW_H / 2}
					text-anchor="end"
					dominant-baseline="central"
					font-size="14"
					fill={TEXT_COLOR}
				>
					{row.word}
				</text>
				{@const barW = row.p * MAX_BAR_W}
				{@const numInside = barW >= 32}
				<rect
					x={barX}
					y={rowY + ROW_H / 2 - BAR_H / 2}
					width={barW}
					height={BAR_H}
					rx={3}
					ry={3}
					fill={BAR_COLOR}
					opacity={0.75}
				/>
				{#if numInside}
					<text
						x={barX + barW - 6}
						y={rowY + ROW_H / 2}
						text-anchor="end"
						dominant-baseline="central"
						font-size="12"
						fill="#fff"
						font-weight="600"
					>
						{row.p.toFixed(2)}
					</text>
				{:else}
					<text
						x={barX + barW + 4}
						y={rowY + ROW_H / 2}
						text-anchor="start"
						dominant-baseline="central"
						font-size="12"
						fill="#888"
					>
						{row.p.toFixed(2)}
					</text>
				{/if}
			{:else}
				<!-- Ellipsis row: "…" placed in the label column (aligned with the
				     words above/below), no bar. -->
				<text
					x={LABEL_W - 6}
					y={rowY + ROW_H / 2}
					text-anchor="end"
					dominant-baseline="central"
					font-size="16"
					fill={TEXT_COLOR}
				>
					…
				</text>
			{/if}
		{/each}
	</svg>
</div>

<style>
	.wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin: 1rem auto;
	}
	.notation {
		font-size: 1.05em;
	}
	svg {
		display: block;
	}
	svg.arrow {
		flex-shrink: 0;
		transition: transform 0.15s ease;
	}
	/* Narrow screens: stack the notation, arrow, and bar chart vertically,
	   and rotate the arrow so it points down instead of right. */
	@media (max-width: 600px) {
		.wrap {
			flex-direction: column;
			gap: 0.75rem;
		}
		svg.arrow {
			transform: rotate(90deg);
		}
	}
</style>
