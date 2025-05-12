
<script lang="ts"> 
    import * as d3 from 'd3';
    import * as tf from '@tensorflow/tfjs';
    import {
        interfaceSettings, 
        datasetName, 
        currentDistributionSamples, 
        allTimeSamples,
        currentTime,
        isPlaying
    } from '$lib/state';

    export let data; // Data to plot
    export let distributionId = "target"; // ID for the distribution canvas

    let svgElement: SVGSVGElement; // Create a separate SVG element for each distribution

    function handleClick(){
        // Change this dataset to be the current one
        datasetName.set(distributionId);
        // Empty out the current Distribution samples and the all time samples
        currentDistributionSamples.set(tf.tensor([]));
        allTimeSamples.set(tf.tensor([]));
        // Set time to zero 
        currentTime.set(0);
        // Pause the animation
        isPlaying.set(false);
    }

    async function plotPoints(
        data: tf.Tensor, // Data to plot
        distributionId: string = "target", // ID for the distribution canvas
    ){
        // Replace distributionId spaces with underscores
        const replacedDistributionId = distributionId.replace(/\s+/g, '_');
        // Convert data to plain 2d array
        data = await data.arraySync() as number[][];
        // Comptue the range of the data
        let xMin = d3.min(data, d => d[0]);
        let xMax = d3.max(data, d => d[0]);
        let yMin = d3.min(data, d => d[1]);
        let yMax = d3.max(data, d => d[1]);
        const margin = 0.2;
        const xRange = xMax - xMin;
        const yRange = yMax - yMin;
        xMin -= margin * xRange;
        xMax += margin * xRange;
        yMin -= margin * yRange;
        yMax += margin * yRange;
        const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, interfaceSettings.miniDistributionWidth]);
        const yScale = d3.scaleLinear().domain([yMin, yMax]).range([0, interfaceSettings.miniDistributionWidth]);
        // Make a scatter plot
        const svg = d3.select(svgElement); 
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
            .attr("r", 1)
            .attr("fill", interfaceSettings.pointColor);
    }

    // If data changes, replot the points
    $: if (data && svgElement) {
        plotPoints(data, distributionId);
    }

</script>

<style>
    .mini-distribution {
        width: var(--mini-distribution-width);
        height: var(--mini-distribution-width);
        position: relative;
        /* Rounded corners */
        border-radius: 5px;
        /* margin-left: 20px; */
    }

    .active-dataset {
        border: 3px solid #393939;
        opacity: 1;
        /* Add drop shadow */
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }

    .inactive-dataset {
        opacity: 0.2;
        border: 3px solid #c4c4c4;
    }

    .inactive-dataset:hover {
        cursor: pointer;
        border: 3px solid #242424;
    }

    svg {
        width: 100%;
        height: 100%;
    }

</style>

<div 
    class={distributionId === $datasetName ? "mini-distribution active-dataset" : "mini-distribution inactive-dataset"}
    on:click={handleClick}
>
    <svg 
        bind:this={svgElement}
        id="{distributionId}"
    ></svg>
</div>