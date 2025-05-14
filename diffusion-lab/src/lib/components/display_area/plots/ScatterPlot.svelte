
<script lang="ts">
    import * as d3 from 'd3';
    import * as tf from '@tensorflow/tfjs';

    import { interfaceSettings } from '$lib/state';

    function plotScatterPlot(
        data: tf.Tensor,
        opacity: number = 0.5,
        xLocation: number = 0,
        distributionId: string = "target",
        maximumPoints: number = 1000,
    ) {
        // Convert data to plain 2d array
        data = data.arraySync() as number[][];
        // If the data is too large, sample it down to a smaller size
        data = data.slice(0, Math.min(data.length, maximumPoints));
        // Comptue the range of the data
        let xMin = d3.min(data, d => d[0]);
        let xMax = d3.max(data, d => d[0]);
        let yMin = d3.min(data, d => d[1]);
        let yMax = d3.max(data, d => d[1]);
        const margin = 0.1;
        const xRange = xMax - xMin;
        const yRange = yMax - yMin;
        xMin -= margin * xRange;
        xMax += margin * xRange;
        yMin -= margin * yRange;
        yMax += margin * yRange;

        const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, interfaceSettings.distributionWidth]);
        const yScale = d3.scaleLinear().domain([yMin, yMax]).range([0, interfaceSettings.distributionHeight]);

        // Make a scatter plot
        const svg = d3.select("svg");
        // Select the group by ID, or create if not exists
        // NOTE: This prevents unwanted recreation of the group
        let group = svg.select(`#${distributionId}`);
        if (group.empty()) {
            group = svg.append("g").attr("id", distributionId);
        } else {
            group.selectAll("*").remove(); // Clear previous contents of this group
        }
        
        // Draw the points
        group.selectAll("circle")
            .data(data)
            .enter()
            .append("circle")
            .attr("cx", d => xScale(d[0]))
            .attr("cy", d => yScale(d[1]))
            .attr("r", 3)
            .attr("opacity", opacity)
            .attr("fill", interfaceSettings.pointColor)
            .attr("transform", `translate(${xLocation}, 0)`);
    }
</script>
