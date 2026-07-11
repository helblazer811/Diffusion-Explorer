<script lang="ts">
	// Inline text-flow companion to the SVG mask cells used throughout the
	// article. Renders "[MASK]" inside a rounded blue rectangle whose fill
	// matches the mask rectangles in figures. Colors are provided by the
	// page so every mention of [MASK] — prose and figure alike — shares one
	// palette.

	interface Props {
		color?: string;
		textColor?: string;
	}

	let { color = '#cfe0f2', textColor = '#33506e' }: Props = $props();
</script>

<span class="mask-token" style="background: {color}; color: {textColor};">[MASK]</span>

<style>
	.mask-token {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
		font-size: 0.85em;
		font-weight: 500;
		padding: 0.2em 0.3em;
		border-radius: 3px;
		white-space: nowrap;
		line-height: 1.25;
	}
</style>
