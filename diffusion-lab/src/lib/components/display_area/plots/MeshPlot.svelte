<script lang="ts"> 
    import * as tf from '@tensorflow/tfjs';
    import * as d3 from 'd3';

    import { onMount } from 'svelte';
    import { 
        domainRange, 
        UIState, 
        trainingObjectiveToModelConfig, 
        trainingObjective,
        pretrainedModelPaths,
        datasetName,
        interfaceSettings

    } from '$lib/state';

    import { callSamplingWorkerThread, callSamplingWorkerThreadFromInitialPoints } from '$lib/diffusion/workers/utils';

    export let svgElement; // Shared SVG element for all distributions
    export let isActive: boolean = false; // Flag to indicate if the plot is active
    export let time: number = 0.0; // Default value for the time
    export let gridResolution: number = 10; // Resolution of the grid
    export let distributionId: string = "target"; // ID for the distribution canvas

    export let strokeWidth: number = 3; // Stroke width for the mesh lines
    export let strokeColor: string = "#424242"; // Stroke color for the mesh lines


    let trajectoryGrid: number[][][] = []; // Array to hold the trajectories [time, x, y, 2]

    function convertDataToDisplayCoordinateFrame(
        tensorData: tf.Tensor,
        time: number,
    ) {
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

    // Function to plot the mesh grid for the current timeimport * as d3 from 'd3';
    function plotMesh(time: number) {
        // Convert time to step index
        const stepIndex = Math.floor(time * ($UIState.numberOfSteps - 1));
        console.log("Step index: ", stepIndex);
        if (!svgElement || !trajectoryGrid[stepIndex]) return;

        console.log("Plotting mesh grid for time: ", stepIndex);

        let data = trajectoryGrid[stepIndex];
        // Convert data to display coordinates
        // NOTE: This is jancky af, but it works
        data = tf.tensor(data);
        data = data.reshape([gridResolution * gridResolution, 2]);
        data = convertDataToDisplayCoordinateFrame(data, time);
        data = tf.tensor(data);
        data = data.reshape([gridResolution, gridResolution, 2]);
        data = data.arraySync() as number[][][];

        const svg = d3.select(svgElement);

        // Create a group for the mesh grid
        let group = svg.select(`#${distributionId}_mesh_grid`);
        if (group.empty()) {
            group = svg.append("g").attr("id", distributionId+"_mesh_grid")
                .attr("isolation", "isolate"); // Prevents blending with other groups
        } else {
            group.selectAll("*").remove(); // Clear existing mesh
        }

        for (let i = 0; i < gridResolution; i++) {
            for (let j = 0; j < gridResolution; j++) {
                const [x, y] = data[i][j];

                // Connect to right neighbor
                if (j < gridResolution - 1) {
                    const [x2, y2] = data[i][j + 1];
                    group.append("line")
                        .attr("x1", x)
                        .attr("y1", y)
                        .attr("x2", x2)
                        .attr("y2", y2)
                        .attr("stroke", strokeColor)
                        .attr("stroke-width", strokeWidth);
                }

                // Connect to bottom neighbor
                if (i < gridResolution - 1) {
                    const [x2, y2] = data[i + 1][j];
                    group.append("line")
                        .attr("x1", x)
                        .attr("y1", y)
                        .attr("x2", x2)
                        .attr("y2", y2)
                        .attr("stroke", strokeColor)
                        .attr("stroke-width", strokeWidth);
                }
            }
        }
    }

    onMount(() => {
        // Run sampling for a uniform grid of points
        console.log("Running sampling for a uniform grid of points");
        // First uniformly sample the x and y coordinates
        const x = tf.linspace($domainRange.xMin, $domainRange.xMax, gridResolution);
        const y = tf.linspace($domainRange.yMin, $domainRange.yMax, gridResolution);
        let initialPoints = tf.stack(tf.meshgrid(x, y), 2);
        initialPoints = initialPoints.reshape([gridResolution * gridResolution, 2]); // Flatten the points to be [gridResolution * gridResolution, 2]
        // Sync the points, converting to a 2D array
        initialPoints = initialPoints.arraySync() as number[][];
        // Now call the sampling web worker
        callSamplingWorkerThreadFromInitialPoints(
            pretrainedModelPaths[$trainingObjective][$datasetName],
            $trainingObjective,
            trainingObjectiveToModelConfig[$trainingObjective],
            initialPoints,
            $UIState.numberOfSteps,
            (allSamples: number[][]) => {
                console.log("Received all samples from the worker");
                let allSamplesTensor = tf.tensor(allSamples);
                // Reshape the samples to be [time, x, y, 2]
                allSamplesTensor = allSamplesTensor.reshape([$UIState.numberOfSteps, gridResolution, gridResolution, 2]);
                // Save the samples to the trajectory grid
                trajectoryGrid = allSamplesTensor.arraySync() as number[][][];
            }
        )
    });

    $ : if (svgElement && trajectoryGrid.length > 0 && isActive) {
        // Plot the mesh grid for the current time
        plotMesh(time);
    }

    // If the plot is no longer active, remove the group
    $: if (!isActive && svgElement) {
        const svg = d3.select(svgElement);
        const group = svg.select(`#${distributionId}_mesh_grid`);
        if (!group.empty()) {
            group.remove();
        }
    }

</script>
