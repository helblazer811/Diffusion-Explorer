<script lang="ts">
	// Deployment-time rollout of a self-conditioned flow model over 5 steps:
	//
	//   z_{0.0} → [Flow] → x̂₁^(0) → [Flow] → x̂₁^(1) → [Flow] → x̂₁^(2) → [Flow] → x̂₁^(3) → [Flow] → x̂₁^(4)
	//       │                z_{0.25}          z_{0.5}            z_{0.75}           z_{1.0}
	//       ▼               (top rail feeding each block from above)
	//
	// Only the FIRST pair (z_{0.0} → x̂₁^(0) → block 2 with z_{0.25}) matches
	// what training saw — the rest of the rollout is out-of-distribution.
	// The trained pair is highlighted in green; the rest is grayed.
	const N_STEPS = 5;
	// Time values corresponding to each block's z_t input. Evenly spaced
	// across [0, 1] for the illustration.
	const T_VALS = [0, 0.25, 0.5, 0.75, 1.0] as const;
</script>

<div class="figure-wrap">
	<p class="subtitle">
		At deployment we roll the model out for many steps — but training
		only ever saw a single detached carry pair.
	</p>

	<svg
		viewBox="0 0 1600 400"
		xmlns="http://www.w3.org/2000/svg"
		aria-label="Rollout of a self-conditioned flow model at deployment vs. the single trained pair."
	>
		<defs>
			<marker
				id="arrowhead-gray"
				viewBox="0 -5 10 10"
				refX="9"
				refY="0"
				markerWidth="8"
				markerHeight="8"
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill="#888" />
			</marker>
			<marker
				id="arrowhead-black"
				viewBox="0 -5 10 10"
				refX="9"
				refY="0"
				markerWidth="8"
				markerHeight="8"
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill="#444" />
			</marker>
		</defs>

		<!-- ================================================================ -->
		<!-- Row of 5 Flow Model blocks + interleaved x̂₁ recurrence labels    -->
		<!-- Blocks are 200 wide × 70 tall on a common y = 190 center row.    -->
		<!-- ================================================================ -->

		<!-- Precomputed geometry (JS-free): -->
		<!-- Block i left edge x = 50 + i * (200 + 90) = 50 + i*290           -->
		<!-- Block centers x = 50 + i*290 + 100                               -->

		<!-- z_t rail across the top, feeding each block from above -->
		<line x1="150" y1="90" x2="1310" y2="90" stroke="#888" stroke-width="2" />

		{#each T_VALS as t, i}
			{@const bx = 50 + i * 290}
			{@const cx = bx + 100}
			<!-- z_{t} label -->
			<text x={cx} y="70" class="var" text-anchor="middle">
				z<tspan class="sub">{t.toFixed(2)}</tspan>
			</text>

			<!-- Drop from rail into block top edge -->
			<line
				x1={cx}
				y1="95"
				x2={cx}
				y2="180"
				stroke="#888"
				stroke-width="2"
				marker-end="url(#arrowhead-gray)"
			/>

			<!-- Flow Model block -->
			<rect
				x={bx}
				y="190"
				width="200"
				height="70"
				rx="10"
				ry="10"
				class="block"
				class:trained={i === 0}
			/>
			<text x={cx} y="233" class="block-label" text-anchor="middle">Flow Model</text>

			<!-- Recurrence arrow going into the next block, with a x̂₁^{(i)}
			     label between blocks. Skip on the last block. -->
			{#if i < N_STEPS - 1}
				{@const ax1 = bx + 200}
				{@const ax2 = bx + 290}
				<line x1={ax1} y1="225" x2={ax1 + 30} y2="225" stroke="#444" stroke-width="2" />
				<text x={(ax1 + ax2) / 2} y="232" class="var-small" text-anchor="middle">
					x̂<tspan class="sub">1</tspan><tspan class="sup" dy="-6">({i})</tspan>
				</text>
				<line
					x1={ax2 - 30}
					y1="225"
					x2={ax2}
					y2="225"
					stroke="#444"
					stroke-width="2"
					marker-end="url(#arrowhead-black)"
				/>
			{/if}
		{/each}

		<!-- Final x̂₁^{(N-1)} output on the far right -->
		<line
			x1={50 + (N_STEPS - 1) * 290 + 200}
			y1="225"
			x2={50 + (N_STEPS - 1) * 290 + 260}
			y2="225"
			stroke="#444"
			stroke-width="2"
			marker-end="url(#arrowhead-black)"
		/>
		<text
			x={50 + (N_STEPS - 1) * 290 + 300}
			y="232"
			class="var"
			text-anchor="middle"
		>
			x̂<tspan class="sub">1</tspan><tspan class="sup" dy="-8">({N_STEPS - 1})</tspan>
		</text>

		<!-- ================================================================ -->
		<!-- Highlight bracket under the first PAIR of blocks (trained span)  -->
		<!-- ================================================================ -->

		<!-- Trained: covers block 1 (x=50..250) + block 2 (x=340..540)      -->
		<line x1="50" y1="300" x2="540" y2="300" stroke="#1c9c4f" stroke-width="3" />
		<line x1="50" y1="295" x2="50" y2="305" stroke="#1c9c4f" stroke-width="3" />
		<line x1="540" y1="295" x2="540" y2="305" stroke="#1c9c4f" stroke-width="3" />
		<text x="295" y="330" class="grad-label" text-anchor="middle">
			trained (single detached carry pair)
		</text>

		<!-- Rest of the rollout: red, "never seen during training"           -->
		<line x1="550" y1="300" x2={50 + N_STEPS * 290 - 90} y2="300" stroke="#d0342c" stroke-width="3" />
		<line x1="550" y1="295" x2="550" y2="305" stroke="#d0342c" stroke-width="3" />
		<line
			x1={50 + N_STEPS * 290 - 90}
			y1="295"
			x2={50 + N_STEPS * 290 - 90}
			y2="305"
			stroke="#d0342c"
			stroke-width="3"
		/>
		<text x={(550 + 50 + N_STEPS * 290 - 90) / 2} y="330" class="untrained-label" text-anchor="middle">
			deployment rollout (never seen during training)
		</text>
	</svg>
</div>

<style>
	.figure-wrap {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.subtitle {
		margin: 0 0 0.75rem 0;
		font-size: 1.15rem;
		color: #333;
		font-style: italic;
		text-align: center;
		max-width: 1100px;
	}

	.figure-wrap svg {
		width: 100%;
		max-width: 1600px;
		height: auto;
	}

	.block {
		fill: #ececee;
		stroke: #666;
		stroke-width: 1.5;
	}

	/* Only the first block belongs to the trained pair — tint it green. */
	.block.trained {
		fill: #e1f3e6;
		stroke: #1c9c4f;
		stroke-width: 2;
	}

	.block-label {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 19px;
		font-weight: 600;
		fill: #222;
	}

	.var {
		font-family: 'STIX Two Math', 'Cambria Math', 'Latin Modern Math', serif;
		font-style: italic;
		font-size: 22px;
		fill: #111;
	}

	.var-small {
		font-family: 'STIX Two Math', 'Cambria Math', 'Latin Modern Math', serif;
		font-style: italic;
		font-size: 18px;
		fill: #111;
	}

	.sub {
		font-size: 0.72em;
		baseline-shift: sub;
	}

	.sup {
		font-size: 0.7em;
		font-style: normal;
	}

	.grad-label {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 16px;
		fill: #1c9c4f;
		font-style: italic;
		font-weight: 600;
	}

	.untrained-label {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 16px;
		fill: #d0342c;
		font-style: italic;
		font-weight: 600;
	}
</style>
