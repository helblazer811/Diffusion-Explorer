
<script lang="ts">
    import * as d3 from 'd3';
    import * as tf from '@tensorflow/tfjs';
    import { get } from 'svelte/store';
    import { base } from '$app/paths';
    // Import state and settings
    import { datasetName, domainRange, trainingObjective, numberOfSteps } from '$lib/state';
    import { interfaceSettings, pretrainedModelPaths, trainingObjectiveToModelConfig } from '$lib/settings';
    // Import utils
    import { convertDataToDisplayCoordinateFrame } from '$lib/components/display_area/plots/utils';
    import { callSamplingWorkerThreadFromInitialPoints } from '$lib/diffusion/workers/utils';

    export let isActive: boolean = true; // Flag to indicate if the plot is active
    export let opacity: number = 0.3; // Opacity of the contour
    // export let allTimeSamples: tf.Tensor; // Data to plot
    export let svgElement; // Shared SVG element for all distributions
    export let distributionId: string = "target"; // ID for the distribution canvas
    export let pointColor: string = "#7b7b7b"; // Point color for the scatter plot
    export let gridResolution: number = 25; // Resolution of the grid

    // Choose some arbitrary initial condition
    let initialCondition: number[] = undefined; // Initial condition for the trajectories
    let trajectories: number[][] = undefined; // Array to hold the trajectories [time, x * y, 2]

    function plotTrajectory(
        initialCondition: number[] = [0.0, 0.0], // Initial condition for the trajectories
        trajectories: number[][],
        opacity: number = 0.5,
        distributionId: string = "target",
    ) {
        // Find the initial trajectory closest to the given initial condition for time = 0
        let distances = [];
        for (let i = 0; i < trajectories.length; i++) {
            const trajectoryInitialCondition = trajectories[i][0];
            const distance = Math.sqrt(
                Math.pow(trajectoryInitialCondition[0] - initialCondition[0], 2) +
                Math.pow(trajectoryInitialCondition[1] - initialCondition[1], 2)
            );
            distances.push(distance);
        }
        const minDistanceIndex = distances.indexOf(Math.min(...distances));
        const trajectory = trajectories[minDistanceIndex]; // Get the trajectory closest to the initial condition
        // If the data is too large, sample it down to a smaller size
        // trajectoriesNormalized = trajectoriesNormalized.slice(
        //     0, 
        //     Math.min(trajectoriesNormalized.length, maximumPoints)
        // );
        // Make a scatter plot
        const svg = d3.select(svgElement);
        // Select the group by ID, or create if not exists
        // NOTE: This prevents unwanted recreation of the group
        let group = svg.select(`#${distributionId}_trajectories`);
        if (group.empty()) {
            group = svg.append("g").attr("id", distributionId+"_trajectories")
                .attr("isolation", "isolate"); // Prevents blending with other groups
        } else {
            group.selectAll("*").remove(); // Clear previous contents of this group
        }
        // D3 line generator for 2D points
        const line = d3.line()
            .x(d => d[0])
            .y(d => d[1])
            .curve(d3.curveLinear); // You can also try d3.curveBasis for smoother paths
        // Draw each trajectory
        // for (const trajectory of trajectoriesNormalized) {
        group.append("path")
            .datum(trajectory) // Each trajectory is an array of [x, y] points
            .attr("d", line)
            .attr("fill", "none")
            .attr("stroke", pointColor)
            .attr("stroke-width", 3.0)
            .attr("opacity", opacity);
        // }
    }

    async function runSampling(
        currentDatasetName: string,
        currentTrainingObjective: string,
        initialPoints: number[][],
    ) {
        // Now call the sampling web worker
        callSamplingWorkerThreadFromInitialPoints(
            base + pretrainedModelPaths[currentTrainingObjective][currentDatasetName],
            currentTrainingObjective,
            trainingObjectiveToModelConfig[currentTrainingObjective],
            initialPoints,
            get(numberOfSteps),
            (allSamples: number[][]) => {
                // allSamples: [time, x * y, 2]
                console.log(allSamples.length)
                // Normalize the trajectories so they fit correclty in the display area
                let trajectoriesNormalized = [];
                for (let t = 0; t < allSamples.length; t++) {
                    const pointsAtTimeT = allSamples[t]; // Get the points at time t
                    // Convert the data to a tensor
                    const pointsAtTimeTTensor = tf.tensor(pointsAtTimeT);
                    // console.log(allTimeSamples.shape);
                    const trajectoryNormalized = convertDataToDisplayCoordinateFrame(
                        pointsAtTimeTTensor, 
                        t / allSamples.length, // Normalize the time
                        interfaceSettings.distributionWidth, 
                        interfaceSettings.displayAreaWidth, 
                        get(domainRange)
                    );
                    trajectoriesNormalized.push(trajectoryNormalized);
                }
                trajectories = tf.stack(trajectoriesNormalized);
                // Transpose trajecotries form [time, x * y, 2] to [x * y, time, 2]
                trajectories = tf.transpose(trajectories, [1, 0, 2]);
                trajectories = trajectories.arraySync() as number[][]; // Convert to a 2D array
            }
        )
    }

    // If the dataset name or trainingObjective changes, re-run the sampling
    $ : if ($datasetName && $trainingObjective) {
        console.log("Dataset or training objective changed, re-running sampling");
        // Run sampling for a uniform grid of points
        const currentDatasetName = $datasetName;
        const currentTrainingObjective = $trainingObjective;
        // First uniformly sample the x and y coordinates
        const width = get(domainRange).xMax - get(domainRange).xMin;
        const height = get(domainRange).yMax - get(domainRange).yMin;
        // Make range of data bit wider
        const xMin = get(domainRange).xMin + 0.0 * width;
        const xMax = get(domainRange).xMax - 0.0 * width;
        const yMin = get(domainRange).yMin + 0.0 * height;
        const yMax = get(domainRange).yMax - 0.0 * height;
        const x = tf.linspace(xMin, xMax, gridResolution);
        const y = tf.linspace(yMin, yMax, gridResolution);
        let initialPoints: tf.Tensor = tf.stack(tf.meshgrid(x, y), 2);
        initialPoints = initialPoints.reshape([gridResolution * gridResolution, 2]); // Flatten the points to be [gridResolution * gridResolution, 2]
        // Sync the points, converting to a 2D array
        initialPoints = initialPoints.arraySync() as number[][];
        // Now call the sampling web worker
        runSampling(currentDatasetName, currentTrainingObjective, initialPoints);
    }

    // If the data points change then replot
    $ : if (svgElement && trajectories && isActive) {
        // If initial condition is undefined then randomly choose one from trajectories[0]
        // initialCondition = initialCondition || trajectories[0][Math.floor(Math.random() * trajectories[0].length)];
        // Initialize the initial condition to the mean of the time = 0 points
        if (initialCondition === undefined) {
            const initialConditions = trajectories.map(trajectory => trajectory[0]);
            const xMean = d3.mean(initialConditions, d => d[0]);
            const yMean = d3.mean(initialConditions, d => d[1]);
            initialCondition = [xMean, yMean];
        }
        // Plot the trajectory closest to the given initial condition
        plotTrajectory(initialCondition, trajectories, opacity, distributionId);
    }

    // If the plot is no longer active, remove the group
    $: if (!isActive && svgElement) {
        const svg = d3.select(svgElement);
        const group = svg.select(`#${distributionId}_trajectories`);
        if (!group.empty()) {
            group.remove();
        }
    }

</script>
