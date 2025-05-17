
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
    export let time: number = 0.0; // Default value for the time
    export let svgElement; // Shared SVG element for all distributions
    export let distributionId: string = "target"; // ID for the distribution canvas
    export let trajectoryColor: string = "rgb(255, 100, 0)";
    export let gridResolution: number = 25; // Resolution of the grid

    // Choose some arbitrary initial condition
    let handleGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
    let initialized: boolean = false; // Flag to indicate if the plot is initialized
    let initialCondition: number[] = undefined; // Initial condition for the trajectories
    let trajectories: number[][] = undefined; // Array to hold the trajectories [time, x * y, 2]

    // tiny helper so we don’t allocate an array every drag tick
    function nearestTrajectoryIndex(pt: [number, number]) {
        let distances = [];
        for (let i = 0; i < trajectories.length; i++) {
            const trajectoryInitialCondition = trajectories[i][0];
            const distance = Math.sqrt(
                Math.pow(trajectoryInitialCondition[0] - pt[0], 2) +
                Math.pow(trajectoryInitialCondition[1] - pt[1], 2)
            );
            distances.push(distance);
        }
        const minDistanceIndex = distances.indexOf(Math.min(...distances));
        return minDistanceIndex;
    }

    function plotTrajectory(
        initialCondition: number[] = [0.0, 0.0], // Initial condition for the trajectories
        trajectories: number[][],
        time: number = 0.0, // Default value for the time
        opacity: number = 0.5,
        distributionId: string = "target",
    ) {
        // Find the initial trajectory closest to the given initial condition for time = 0
        const minDistanceIndex = nearestTrajectoryIndex(initialCondition);
        const trajectory = trajectories[minDistanceIndex]; // Get the trajectory closest to the initial condition
        // Get the sequence before and after the current time
        const stepIndex = Math.floor(time * (trajectory.length - 1));
        const pastSeg = trajectory.slice(0, stepIndex + 1);   // inclusive of current point
        const futureSeg = trajectory.slice(stepIndex);          // from current point onward
        // Make a scatter plot
        const svg = d3.select(svgElement);
        // Select the group by ID, or create if not exists
        // NOTE: This prevents unwanted recreation of the group
        let group = svg.select(`#${distributionId}_trajectories`);
        if (group.empty()) {
            group = svg.append("g")
                .attr("id", distributionId+"_trajectories")
                .attr("isolation", "isolate"); // Prevents blending with other groups
        } else {
            group.selectAll("*").remove(); // Clear previous contents of this group
        }
        // D3 line generator for 2D points
        const line = d3.line()
            .x(d => d[0])
            .y(d => d[1])
            .curve(d3.curveLinear); // You can also try d3.curveBasis for smoother paths

        // Draw a white outline with a slightly larger stroke width
        // White outline (drawn first, underneath)
        group.append("path")
            .datum(pastSeg)
            .attr("d", line)
            .attr("fill", "none")
            .attr("stroke", "white")
            .attr("stroke-width", 7) // slightly larger than the main stroke
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round")
            .attr("opacity", opacity); // match opacity

        // Draw an arrow head aat the end
        // Define the arrowhead marker (only needs to be done once per SVG)
        const defs = group.append("defs");

        // defs.append("marker")
        //     .attr("id", "arrowhead")
        //     .attr("viewBox", "0 -5 10 10")
        //     .attr("refX", 0) // position of the arrow along the path
        //     .attr("refY", 0)
        //     .attr("markerWidth", 6)
        //     .attr("markerHeight", 6)
        //     .attr("orient", "auto")
        //     .attr("markerUnits", "strokeWidth")
        //     .append("path")
        //     .attr("d", "M0,-5L10,0L0,5")
        //     .attr("fill", trajectoryColor)
        //     // .attr("filter", "url(#path-shadow)") // Apply the shadow filter

        // // Add a drop shadow filter
        // const svgDefs = group.append("defs");

        // svgDefs.append("filter")
        //     .attr("id", "path-shadow")
        //     .attr("x", "0%")
        //     .attr("y", "0%")
        //     .attr("width", "200%")
        //     .attr("height", "200%")
        //     .append("feDropShadow")
        //     .attr("dx", 0)  // horizontal offset
        //     .attr("dy", 0)  // vertical offset
        //     .attr("stdDeviation", 2)  // blur radius
        //     .attr("flood-color", "#fff")  // shadow color
        //     .attr("flood-opacity", 0.7);  // shadow opacity

        // Past segment – darker / more opaque
        group.append("path")
            .datum(pastSeg)
            .attr("d", line)
            .attr("fill", "none")
            .attr("stroke", trajectoryColor)
            .attr("stroke-width", 3)
            .attr("marker-end", "url(#arrowhead)")
            // .attr("filter", "url(#path-shadow)") // Apply the shadow filter
            // .attr("opacity", opacity);

        // Future segment – lighter / more transparent
        group.append("path")
            .datum(futureSeg)
            .attr("d", line)
            .attr("fill", "none")
            .attr("stroke", trajectoryColor)
            .attr("stroke-width", 3)
            .attr("opacity", opacity) // tweak to taste

        // Draw a circle at the current point
        group.append("circle")
            .attr("cx", trajectory[stepIndex][0])
            .attr("cy", trajectory[stepIndex][1])
            .attr("r", 5)
            .attr("fill", trajectoryColor)
            // .attr("opacity", opacity);
    }

    async function runSampling(
        currentDatasetName: string,
        currentTrainingObjective: string,
        initialPoints: number[][],
    ) {
        // NOTE: Moved this out here to avoid unwanted re-runs from the $: block
        // Now call the sampling web worker
        callSamplingWorkerThreadFromInitialPoints(
            base + pretrainedModelPaths[currentTrainingObjective][currentDatasetName],
            currentTrainingObjective,
            trainingObjectiveToModelConfig[currentTrainingObjective],
            initialPoints,
            get(numberOfSteps),
            (allSamples: number[][]) => {
                // allSamples: [time, x * y, 2]
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

    // Setup behavior for the drag handle, will run a single time
    $: if (!initialized && svgElement && initialCondition && isActive) {
        initialized = true;
        console.log("Initializing drag handle");
        const svg = d3.select(svgElement);

        // 1. Create a group for the drag handle
        handleGroup = svg.append("g")
            .attr("id", `${distributionId}_handle`)
            .style("cursor", "grab");

        // Display the handle from the PointerIcon.svg file
        handleGroup.append("image")
            .attr("xlink:href", base + "/PointerIcon.svg")
            .attr("x", initialCondition[0])
            .attr("y", initialCondition[1])
            .attr("transform", "translate(-20, -20)") // Center the image
            .attr("width", 40)
            .attr("height", 40)
            .attr("z-index", 1000) // Bring the handle to the front
        // handleGroup.append("circle")
        //     .attr("cx", initialCondition[0])
        //     .attr("cy", initialCondition[1])
        //     .attr("r", 10)
        //     .attr("fill", "#fff")
        //     .attr("stroke", trajectoryColor)
        //     .attr("stroke-width", 2)
        //     .attr("z-index", 1000) // Bring the handle to the front
        
        // Add a label to the drag handle
        handleGroup.append("text")
            .attr("x", initialCondition[0])
            .attr("y", initialCondition[1] - 45)      // 15 px above the circle
            .attr("text-anchor", "middle")            // center the label
            .attr("font-size", 24)
            .attr("font-family", "sans-serif")
            .attr("fill", "#333333")                   // label color
            .style("pointer-events", "none")          // so the label itself isn’t draggable
            .text("Initial Condition");

        // 2. Create a drag behavior
        const drag = d3.drag<SVGGElement, unknown>()
            .on("start", () => handleGroup.style("cursor", "grabbing"))
            .on("drag", (event) => {
                // pointer coords relative to the SVG
                let [x, y] = d3.pointer(event, svg.node());
                // Clamp the coordinates to the source distribution area [0, 0] to [settings.distributionWidth, settings.distributionHeight]
                x = Math.max(0, Math.min(x, interfaceSettings.distributionWidth));
                y = Math.max(0, Math.min(y, interfaceSettings.distributionHeight));
                // move the icon
                handleGroup.select("image")
                    .attr("x", x)
                    .attr("y", y);
                // Also move the label
                handleGroup.select("text")
                    .attr("x", x)
                    .attr("y", y - 25);
                // update state → fires your reactive plot block
                initialCondition = [x, y];          // must assign a *new* array
            })
            .on("end", () => handleGroup.style("cursor", "grab"));

        // 3. Attach the drag behavior to the group
        handleGroup.call(drag);
    }

    // If the dataset name or trainingObjective changes, re-run the sampling
    $ : if ($datasetName && $trainingObjective) {
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
    $ : if (svgElement && trajectories && isActive && time) {
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
        plotTrajectory(initialCondition, trajectories, time, opacity, distributionId);
    }

    // If the plot is no longer active, remove the group
    $: if (!isActive && svgElement) {
        const svg = d3.select(svgElement);
        const group = svg.select(`#${distributionId}_trajectories`);
        if (!group.empty()) {
            group.remove();
        }
        // Hide the drag handle
        const handleGroup = svg.select(`#${distributionId}_handle`);
        if (!handleGroup.empty()) {
            handleGroup.remove();
        }
        initialized = false; // Reset the initialized flag
    }

</script>
