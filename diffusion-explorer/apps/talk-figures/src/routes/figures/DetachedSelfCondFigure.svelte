<script lang="ts">
	// Default self-conditioning TRAINING recipe (the source of exposure bias):
	//
	//              z_t ────────────┬──────────────┬──────────
	//                              │              │
	//                              ▼              ▼
	//                        [ Flow Model ] ─────► [ Flow Model ] ──► x̂₁^(2)
	//                              │       (detached)
	//                              ▼
	//                            x̂₁^(1)
	//                            (gradient stopped
	//                             before being fed
	//                             into pass 2)
	//
	// The training signal only flows back through pass 2's forward call —
	// pass 1's contribution to x̂₁^(1) is treated as a fixed input. At
	// inference, no such detach exists, so the model sees inputs it was
	// never trained on the gradients of: exposure bias.
</script>

<div class="figure-wrap">
	<p class="subtitle">
		Default self-conditioning training uses a single <em>detached</em>
		carry step — the training signal never flows back through the
		earlier prediction. At inference, no detach exists → exposure bias.
	</p>

	<svg
		viewBox="0 0 1100 340"
		xmlns="http://www.w3.org/2000/svg"
		aria-label="Detached self-conditioning training diagram."
	>
		<defs>
			<marker
				id="arrowhead-detached"
				viewBox="0 -5 10 10"
				refX="9"
				refY="0"
				markerWidth="8"
				markerHeight="8"
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill="#444" />
			</marker>
			<marker
				id="arrowhead-shared"
				viewBox="0 -5 10 10"
				refX="9"
				refY="0"
				markerWidth="8"
				markerHeight="8"
				orient="auto"
			>
				<path d="M0,-5L10,0L0,5" fill="#888" />
			</marker>
		</defs>

		<!-- ============================================================ -->
		<!-- z_t rail across the top with two downward drops              -->
		<!-- ============================================================ -->

		<text x="55" y="70" class="var" text-anchor="middle">z<tspan class="sub">t</tspan></text>

		<!-- Horizontal rail -->
		<line x1="90" y1="65" x2="860" y2="65" stroke="#888" stroke-width="2" />

		<!-- Drop into Block 1 top edge -->
		<line
			x1="290"
			y1="65"
			x2="290"
			y2="180"
			stroke="#888"
			stroke-width="2"
			marker-end="url(#arrowhead-shared)"
		/>

		<!-- Drop into Block 2 top edge -->
		<line
			x1="810"
			y1="65"
			x2="810"
			y2="180"
			stroke="#888"
			stroke-width="2"
			marker-end="url(#arrowhead-shared)"
		/>

		<!-- ============================================================ -->
		<!-- Block row (y = 190 .. 250)                                    -->
		<!-- ============================================================ -->

		<rect x="170" y="190" width="240" height="80" rx="10" ry="10" class="block" />
		<text x="290" y="238" class="block-label" text-anchor="middle">Flow Model</text>

		<rect x="690" y="190" width="240" height="80" rx="10" ry="10" class="block" />
		<text x="810" y="238" class="block-label" text-anchor="middle">Flow Model</text>

		<!-- ============================================================ -->
		<!-- Recurrence path: Block 1 out → detach marker → Block 2 in     -->
		<!-- ============================================================ -->

		<!-- Arrow: Block 1 right edge → x̂₁^(1) label -->
		<line x1="410" y1="230" x2="490" y2="230" stroke="#444" stroke-width="2" />

		<!-- x̂₁^(1) label -->
		<text x="530" y="237" class="var" text-anchor="middle">
			x̂<tspan class="sub">1</tspan><tspan class="sup" dy="-8">(1)</tspan>
		</text>

		<!-- Detach "scissors" gap: a break in the recurrence line marked -->
		<!-- with two short parallel diagonal marks + a stop-gradient tag. -->
		<line x1="570" y1="230" x2="605" y2="230" stroke="#444" stroke-width="2" />

		<!-- Break marks (two short slashes rendered as text) -->
		<g transform="translate(618 230)">
			<line x1="-6" y1="-10" x2="6" y2="10" stroke="#d0342c" stroke-width="2.5" />
			<line x1="2" y1="-10" x2="14" y2="10" stroke="#d0342c" stroke-width="2.5" />
		</g>

		<!-- Continue after the break -->
		<line x1="635" y1="230" x2="690" y2="230" stroke="#444" stroke-width="2" marker-end="url(#arrowhead-detached)" />

		<!-- Detach caption: red italic label above the break marks -->
		<text x="620" y="203" class="detach-label" text-anchor="middle">detached</text>
		<text x="620" y="220" class="detach-sub" text-anchor="middle">(stop-gradient)</text>

		<!-- ============================================================ -->
		<!-- Arrow: Block 2 → x̂₁^(2)                                       -->
		<!-- ============================================================ -->

		<line
			x1="930"
			y1="230"
			x2="1030"
			y2="230"
			stroke="#444"
			stroke-width="2"
			marker-end="url(#arrowhead-detached)"
		/>

		<text x="1065" y="237" class="var" text-anchor="middle">
			x̂<tspan class="sub">1</tspan><tspan class="sup" dy="-8">(2)</tspan>
		</text>

		<!-- ============================================================ -->
		<!-- Training-signal indicator: a colored bracket / annotation      -->
		<!-- showing which forward call actually receives gradients         -->
		<!-- ============================================================ -->

		<line
			x1="690"
			y1="290"
			x2="930"
			y2="290"
			stroke="#1c9c4f"
			stroke-width="2.5"
		/>
		<text x="810" y="315" class="grad-label" text-anchor="middle">
			only this pass receives gradients
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
		max-width: 1000px;
	}

	.figure-wrap svg {
		width: 100%;
		max-width: 1100px;
		height: auto;
	}

	.block {
		fill: #ececee;
		stroke: #666;
		stroke-width: 1.5;
	}

	.block-label {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 22px;
		font-weight: 600;
		fill: #222;
	}

	.var {
		font-family: 'STIX Two Math', 'Cambria Math', 'Latin Modern Math', serif;
		font-style: italic;
		font-size: 26px;
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

	.detach-label {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 20px;
		font-weight: 700;
		fill: #d0342c;
		font-style: italic;
	}

	.detach-sub {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 13px;
		fill: #d0342c;
		font-style: italic;
	}

	.grad-label {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 16px;
		fill: #1c9c4f;
		font-style: italic;
	}
</style>
