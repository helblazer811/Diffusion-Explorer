<script lang="ts"> 
    import * as d3 from 'd3';

    import { get } from 'svelte/store';
    import { allTimeGridSamples } from '$lib/state';

    export let svgElement; // Shared SVG element for all distributions
    export let isActive: boolean = false; // Flag to indicate if the plot is active
    export let isEnabled: boolean = true; // Flag to indicate if the plot is enabled
    export let time: number = 0.0; // Default value for the time
    export let distributionId: string = "target"; // ID for the distribution canvas
    export let strokeWidth: number = 3; // Stroke width for the mesh lines
    export let strokeColor: string = "#424242"; // Stroke color for the mesh lines

    // Function to plot the mesh grid for the current timeimport * as d3 from 'd3';
    function plotMesh(time: number) {
        const trajectoryGrid = get(allTimeGridSamples);
        const gridResolution = trajectoryGrid[0].length;
        const numberOfSteps = trajectoryGrid.length;
        
        // Convert time to step index
        const stepIndex = Math.floor(time * (numberOfSteps - 1));
        if (!svgElement || ![stepIndex]) return;

        let data = trajectoryGrid[stepIndex];

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

    $ : if (svgElement && $allTimeGridSamples && $allTimeGridSamples.length > 0 && isActive && isEnabled) {
        // Plot the mesh grid for the current time
        plotMesh(time);
    }

    // If the plot is no longer active, remove the group, or if the plot is disabled
    $: if (!isActive && svgElement || !isEnabled && svgElement) {
        const svg = d3.select(svgElement);
        const group = svg.select(`#${distributionId}_mesh_grid`);
        if (!group.empty()) {
            group.remove();
        }
    }

</script>
