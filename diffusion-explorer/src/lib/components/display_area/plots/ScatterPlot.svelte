
<script lang="ts">
    import * as d3 from 'd3';
    import * as tf from '@tensorflow/tfjs';

    import { domainRange } from '$lib/state';
    import { scatterPlotSettings, interfaceSettings } from '$lib/settings';
    import { screenWidth } from '$lib/screen';
    import { convertDataToDisplayCoordinateFrame } from '$lib/components/display_area/plots/utils';

    export let svgElement; // Shared SVG element for all distributions
    export let isActive: boolean = true; // Flag to indicate if the plot is active
    export let isEnabled: boolean = true; // Flag to indicate if the plot is enabled
    export let time: number = 0.0; // Default value for the time
    export let opacity: number; // Opacity of the contour
    export let data: tf.Tensor; // Data to plot
    export let distributionId: string = "target"; // ID for the distribution canvas
    export let pointColor: string; // Point color for the scatter plot

    function plotScatterPlot(
        data: tf.Tensor,
        time: number = 0.0,
        opacity: number = 0.5,
        distributionId: string = "target",
        maximumPoints: number = 1000,
    ) {
        // Convert data to plain 2d array
        data = convertDataToDisplayCoordinateFrame(
            data, 
            time, 
            interfaceSettings.distributionWidth, 
            interfaceSettings.displayAreaWidth, 
            $domainRange
        );
        // If the data is too large, sample it down to a smaller size
        data = data.slice(0, Math.min(data.length, maximumPoints));
        // Make a scatter plot
        const svg = d3.select(svgElement);
        // Select the group by ID, or create if not exists
        // NOTE: This prevents unwanted recreation of the group
        let group = svg.select(`#${distributionId}_scatter`);
        if (group.empty()) {
            group = svg.append("g").attr("id", distributionId+"_scatter")
                .attr("isolation", "isolate"); // Prevents blending with other groups
        } else {
            group.selectAll("*").remove(); // Clear previous contents of this group
        }
        
        // Draw the points
        group.selectAll("circle")
            .data(data)
            .enter()
            .append("circle")
            .attr("cx", d => d[0])
            .attr("cy", d => d[1])
            .attr("r", scatterPlotSettings.pointRadius)
            .attr("opacity", scatterPlotSettings.pointOpacity)
            .attr("fill", pointColor)
            // .attr("transform", `translate(${xLocation}, 0)`);
    }

    // If the data points change then replot
    $: if (data && svgElement && $screenWidth && isActive) {
        plotScatterPlot(data, time, opacity, distributionId);
    }

    // If the plot is no longer active, remove the group
    $: if (!isActive && svgElement) {
        const svg = d3.select(svgElement);
        const group = svg.select(`#${distributionId}_scatter`);
        if (!group.empty()) {
            group.remove();
        }
    }

</script>
