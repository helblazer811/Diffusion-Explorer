
<script lang="ts">
    import * as d3 from 'd3';
    import * as tf from '@tensorflow/tfjs';

    import { 
        interfaceSettings,
        domainRange,
    } from '$lib/state';

    import { screenWidth } from '$lib/screen';

    export let time: number = 0.0; // Default value for the time
    export let opacity: number = 0.5; // Opacity of the contour
    export let data: tf.Tensor; // Data to plot
    export let svgElement; // Shared SVG element for all distributions
    export let distributionId: string = "target"; // ID for the distribution canvas
    export let pointColor: string = "#7b7b7b"; // Point color for the scatter plot

    function convertDataToDisplayCoordinateFrame(
        tensorData: tf.Tensor,
        time: number,
    ){
        let data = tensorData.arraySync() as number[][]; // Convert to plain 2D array
        // 1. Scale from the abstract coordinate frame (~ -3 to 3) to the svg viewbox coordinate frame
        const xScale = d3.scaleLinear()
            .domain([$domainRange.xMin, $domainRange.xMax])
            .range([0, interfaceSettings.distributionWidth]);
        const yScale = d3.scaleLinear()
            .domain([$domainRange.yMin, $domainRange.yMax])
            .range([0, interfaceSettings.distributionWidth]);
        // 2. Apply the scale to the data
        const scaledData = data.map(d => [xScale(d[0]), yScale(d[1])]);
        // 3. Now translate the data to the correct xLocation based on the time
        const xLocation = time * (interfaceSettings.displayAreaWidth - interfaceSettings.distributionWidth);
        const translatedData = scaledData.map(d => [d[0] + xLocation, d[1]]);

        return translatedData;
    }

    function plotScatterPlot(
        data: tf.Tensor,
        time: number = 0.0,
        opacity: number = 0.5,
        distributionId: string = "target",
        maximumPoints: number = 1000,
    ) {
        // Convert data to plain 2d array
        data = convertDataToDisplayCoordinateFrame(data, time);
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
            .attr("r", 3)
            .attr("opacity", opacity)
            .attr("fill", pointColor)
            // .attr("transform", `translate(${xLocation}, 0)`);
    }

    // If the data points change then replot
    $: if (data && svgElement && $screenWidth) {
        plotScatterPlot(data, time, opacity, distributionId);
    }

</script>
