<script lang="ts">
    import * as d3 from 'd3';
    import * as tf from '@tensorflow/tfjs';
    import katex from 'katex';
    import 'katex/dist/katex.min.css';

    import Heatmap from '$lib/components/display_area/Heatmap.svelte';
    import ContourPlot from '$lib/components/display_area/ContourPlot.svelte';
    
    // export let currentTime: number = 0.0; // Default value for the time
    // export let isPlaying: boolean = false; // Flag to indicate if the animation is playing
    // export let targetDistributionSamples = tf.tensor([]); // Number of samples to generate
    // export let sourceDistributionSamples = tf.tensor([]); // Number of samples to generate
    // export let currentDistributionSamples = tf.tensor([]); // Number of samples to generate
    export let data: number[][]; // Data to plot
    export let xLocation: number = 0; // X location of the contour
    export let opacity: number = 0.5; // Opacity of the contour
    export let labelIsLatex: boolean = false; // Flag to indicate if the label is in LaTeX format
    export let label: string; // Label for the distribution
    export let distributionId: string; // ID for the distribution canvas
    export let colorMap: string = "Blues"; // Color map for the heatmap
    export let displayMode: string = "contour"; // Display mode for the distribution
    export let showBorder: boolean = false; // Flag to indicate if the border should be shown
    export let fillColor: string = "#7b7b7b"; // Fill color for the contour
    export let borderColor: string = "#7b7b7b"; // Border color for the contour

</script>

{#if displayMode === "heatmap"}
    <Heatmap
        data={data}
        distributionId={distributionId}
        xLocation={xLocation}
        opacity={opacity}
        colorMap={colorMap}
    />
{:else if displayMode === "contour"}
    <ContourPlot
        data={data}
        distributionId={distributionId}
        xLocation={xLocation}
        opacity={opacity}
        colorMap={colorMap}
        label={label}
        labelIsLatex={labelIsLatex}
        showBorder={showBorder}
        fillColor={fillColor}
        borderColor={borderColor}
    />
{/if}