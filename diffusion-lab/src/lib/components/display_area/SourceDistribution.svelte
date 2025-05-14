<script lang="ts">
    import * as d3 from 'd3';
    import * as tf from '@tensorflow/tfjs';
    import katex from 'katex';
    import 'katex/dist/katex.min.css';

    import { onDestroy } from 'svelte';

    import ContourPlot from '$lib/components/display_area/ContourPlot.svelte';

    // Get all samples from the state
    import { domainRange, interfaceSettings } from '$lib/state';

    
    // export let currentTime: number = 0.0; // Default value for the time
    // export let isPlaying: boolean = false; // Flag to indicate if the animation is playing
    // export let targetDistributionSamples = tf.tensor([]); // Number of samples to generate
    // export let sourceDistributionSamples = tf.tensor([]); // Number of samples to generate
    // export let currentDistributionSamples = tf.tensor([]); // Number of samples to generate
    export let svgElement; // Shared SVG element for all distributions
    export let time: number = 0.0; // Default value for the time
    export let data: number[][]; // Data to plot
    export let xLocation: number = 0; // X location of the contour
    export let opacity: number = 0.5; // Opacity of the contour
    export let labelIsLatex: boolean = false; // Flag to indicate if the label is in LaTeX format
    export let label: string; // Label for the distribution
    export let distributionId: string; // ID for the distribution canvas
    export let displayMode: string = "contour"; // Display mode for the distribution
    export let showBorder: boolean = false; // Flag to indicate if the border should be shown
    export let fillColor: string = "#7b7b7b"; // Fill color for the contour
    export let borderColor: string = "#7b7b7b"; // Border color for the contour

    let cleanup = null; // Cleanup function for event listeners
    let isHovered = false;

    // callSamplingWorkerThread(
    //     defaultModelPath,
    //     defaultModelType,
    //     modelConfig[defaultModelType],
    //     get(UIState).numSamples,
    //     get(UIState).numberOfSteps,
    //     (allSamples) => {
    //         // Convert all samples to tf tensor
    //         allSamples = tf.tensor(allSamples);
    //     }
    // )

    function onMove(event: MouseEvent) {
        // Get the mouse position
        const mouseX = event.clientX;
        const mouseY = event.clientY;
        // Convert to the SVG viewBox coordinates
        const svgRect = svgElement.getBoundingClientRect();
        const svgX = mouseX - svgRect.left;
        const svgY = mouseY - svgRect.top;
        // Detect if it is within the range of the source distribution
        // meaning x in [0, distributionWidth]
        if (svgX >=0 && svgX <= interfaceSettings.distributionWidth) {
            console.log(`Mouse position: (${svgX}, ${svgY})`);
        } 
    }

    // Implement a hover effect for the distribution
    $: if (svgElement) {
        // svgElement.addEventListener('mousemove', onMove);
        // svgElement.addEventListener('mouseleave', () => isHovered = false);
        // // Clean up when component unmounts or svgElement changes
        // cleanup = () => {
        //     svgElement.removeEventListener('mousemove', onMove);
        // };
    }

    // onDestroy(() => {
    //     cleanup?.();
    // });

</script>

<ContourPlot
    svgElement={svgElement}
    data={data}
    time={time}
    distributionId={distributionId}
    xLocation={xLocation}
    opacity={opacity}
    label={label}
    labelIsLatex={labelIsLatex}
    showBorder={showBorder}
    fillColor={fillColor}
    borderColor={borderColor}
/>