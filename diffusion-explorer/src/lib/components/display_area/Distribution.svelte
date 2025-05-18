<script lang="ts">
    // Import components
    import ContourPlot from '$lib/components/display_area/plots/ContourPlot.svelte';
    import ScatterPlot from '$lib/components/display_area/plots/ScatterPlot.svelte';
    import MeshPlot from '$lib/components/display_area/plots/MeshPlot.svelte';
    import PathPlot from '$lib/components/display_area/plots/PathPlot.svelte';
    // Import settings
    import { contourPlotSettings, interfaceSettings, meshPlotSettings, scatterPlotSettings } from '$lib/settings';
    import { trainingObjectiveToDisplayOptions } from '$lib/settings';
    // Import state
    import { trainingObjective } from '$lib/state';
    // Props
    export let svgElement; // Shared SVG element for all distributions
    export let time: number = 0.0; // Default value for the time
    export let visible: boolean = true; // Flag to indicate if the distribution should be hidden
    export let data: number[][]; // Data to plot
    export let allTimeSamples: number[][][]; // All time samples for the distribution
    export let xLocation: number = 0; // X location of the contour
    export let opacity: number = 0.5; // Opacity of the contour
    export let labelIsLatex: boolean = false; // Flag to indicate if the label is in LaTeX format
    export let label: string; // Label for the distribution
    export let distributionId: string; // ID for the distribution canvas
    export let activePlotTypes: string[] = ["Contour"]; // Active plot types for the distribution
    export let showBorder: boolean = false; // Flag to indicate if the border should be shown
    export let fillColor: string = "#7b7b7b"; // Fill color for the contour
    export let borderColor: string = "#7b7b7b"; // Border color for the contour

    let groupElement: SVGGElement; // Group element for the distribution

    // Handle the distribution being hidden
    $: if (visible && groupElement) {
        // Show the distribution
        groupElement.style.display = "block";
    } else if (groupElement) {
        // Hide the distribution
        groupElement.style.display = "none";
    }

</script>

<g id="group-{distributionId}" class="distribution-group" bind:this={groupElement}>
    <ScatterPlot
        svgElement={groupElement}
        isActive={activePlotTypes.includes("Scatter")}
        isEnabled={trainingObjectiveToDisplayOptions[$trainingObjective]["Plot Types"].includes("Scatter")}
        data={data}
        time={time}
        distributionId={distributionId}
        xLocation={xLocation}
        opacity={scatterPlotSettings.pointOpacity}
        pointColor={scatterPlotSettings.pointColor}
    />
    <ContourPlot
        svgElement={groupElement}
        isActive={activePlotTypes.includes("Contour")}
        isEnabled={trainingObjectiveToDisplayOptions[$trainingObjective]["Plot Types"].includes("Contour")}
        data={data}
        time={time}
        distributionId={distributionId}
        label={label}
        labelIsLatex={labelIsLatex}
        fillColor={fillColor}
        borderColor={borderColor}
    />
    <MeshPlot
        svgElement={groupElement}
        isActive={activePlotTypes.includes("Mesh")}
        isEnabled={trainingObjectiveToDisplayOptions[$trainingObjective]["Plot Types"].includes("Mesh")}
        time={time}
        distributionId={distributionId}
        opacity={opacity}
        gridResolution={meshPlotSettings.gridResolution}
    />
    <PathPlot
        svgElement={groupElement}
        time={time}
        isActive={activePlotTypes.includes("Path")}
        isEnabled={trainingObjectiveToDisplayOptions[$trainingObjective]["Plot Types"].includes("Path")}
        distributionId={distributionId}
    />
</g>