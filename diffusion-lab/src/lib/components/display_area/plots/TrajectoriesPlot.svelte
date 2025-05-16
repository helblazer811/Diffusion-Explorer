
<script lang="ts">
    import * as d3 from 'd3';
    import * as tf from '@tensorflow/tfjs';

    import { datasetName, domainRange } from '$lib/state';
    import { interfaceSettings } from '$lib/settings';
    import { screenWidth } from '$lib/screen';
    import { convertDataToDisplayCoordinateFrame } from '$lib/components/display_area/plots/utils';

    export let isActive: boolean = true; // Flag to indicate if the plot is active
    export let opacity: number = 0.3; // Opacity of the contour
    export let allTimeSamples: tf.Tensor; // Data to plot
    export let svgElement; // Shared SVG element for all distributions
    export let distributionId: string = "target"; // ID for the distribution canvas
    export let pointColor: string = "#7b7b7b"; // Point color for the scatter plot

    function plotTrajectories(
        allTimeSamples: tf.Tensor,
        opacity: number = 0.5,
        distributionId: string = "target",
        maximumPoints: number = 10,
    ) {
        // Change the coordinate frame of the data
        let allTrajectoriesNormalized = [];
        // Iterate through the times
        for (let t = 0; t < allTimeSamples.shape[0]; t++) {
            const pointsAtTimeT = tf.gather(allTimeSamples, t, 0); // Get the points at time t
            // Convert data to plain 2d array
            // console.log(allTimeSamples.shape);
            const trajectoryNormalized = convertDataToDisplayCoordinateFrame(
                pointsAtTimeT, 
                t / allTimeSamples.shape[0], // Normalize the time
                interfaceSettings.distributionWidth, 
                interfaceSettings.displayAreaWidth, 
                $domainRange
            );
            allTrajectoriesNormalized.push(trajectoryNormalized);
        }
        allTrajectoriesNormalized = tf.stack(allTrajectoriesNormalized);
        // Transpose the [time, points, 2] array to [points, time, 2]
        allTrajectoriesNormalized = tf.transpose(allTrajectoriesNormalized, [1, 0, 2]);
        console.log(allTrajectoriesNormalized.shape);
        // Convert to a plain 2D array
        allTrajectoriesNormalized = allTrajectoriesNormalized.arraySync() as number[][][];
        // data = convertDataToDisplayCoordinateFrame(
        //     data, 
        //     time, 
        //     interfaceSettings.distributionWidth, 
        //     interfaceSettings.displayAreaWidth, 
        //     $domainRange
        // );
        // If the data is too large, sample it down to a smaller size
        allTrajectoriesNormalized = allTrajectoriesNormalized.slice(
            0, 
            Math.min(allTrajectoriesNormalized.length, maximumPoints)
        );
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
        for (const trajectory of allTrajectoriesNormalized) {
            group.append("path")
                .datum(trajectory) // Each trajectory is an array of [x, y] points
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", pointColor)
                .attr("stroke-width", 3.0)
                .attr("opacity", opacity);
        }
    }

    // If the data points change then replot
    $: if (allTimeSamples && svgElement && $screenWidth && isActive) {
        plotTrajectories(allTimeSamples, opacity, distributionId);
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
