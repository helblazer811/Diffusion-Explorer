<script lang="ts">
    // Import components
    import ContourPlot from '$lib/components/display_area/plots/ContourPlot.svelte';
    import ScatterPlot from '$lib/components/display_area/plots/ScatterPlot.svelte';
    import MeshPlot from '$lib/components/display_area/plots/MeshPlot.svelte';
    import TrajectoriesPlot from '$lib/components/display_area/plots/TrajectoriesPlot.svelte';
    // Props
    export let svgElement; // Shared SVG element for all distributions
    export let time: number = 0.0; // Default value for the time
    export let data: number[][]; // Data to plot
    export let allTimeSamples: number[][][]; // All time samples for the distribution
    export let xLocation: number = 0; // X location of the contour
    export let opacity: number = 0.5; // Opacity of the contour
    export let labelIsLatex: boolean = false; // Flag to indicate if the label is in LaTeX format
    export let label: string; // Label for the distribution
    export let distributionId: string; // ID for the distribution canvas
    export let activePlotTypes: string[] = ["Contour Plot"]; // Active plot types for the distribution
    export let showBorder: boolean = false; // Flag to indicate if the border should be shown
    export let fillColor: string = "#7b7b7b"; // Fill color for the contour
    export let borderColor: string = "#7b7b7b"; // Border color for the contour

</script>

<ScatterPlot
    svgElement={svgElement}
    isActive={activePlotTypes.includes("Scatter Plot")}
    data={data}
    time={time}
    distributionId={distributionId}
    xLocation={xLocation}
    opacity={opacity}
    pointColor={borderColor}
/>
<ContourPlot
    svgElement={svgElement}
    isActive={activePlotTypes.includes("Contour Plot")}
    data={data}
    time={time}
    distributionId={distributionId}
    opacity={opacity}
    label={label}
    labelIsLatex={labelIsLatex}
    showBorder={showBorder}
    fillColor={fillColor}
    borderColor={borderColor}
/>
<MeshPlot
    svgElement={svgElement}
    isActive={activePlotTypes.includes("Mesh Plot")}
    data={data}
    time={time}
    distributionId={distributionId}
    opacity={opacity}
/>
<TrajectoriesPlot
    svgElement={svgElement}
    isActive={activePlotTypes.includes("Trajectories")}
    allTimeSamples={allTimeSamples}
    distributionId={distributionId}
/>