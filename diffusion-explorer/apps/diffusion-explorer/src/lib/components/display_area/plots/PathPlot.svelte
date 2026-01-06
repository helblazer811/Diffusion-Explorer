
<script lang="ts">
    import * as d3 from 'd3';
    import { base } from '$app/paths';
    import { onDestroy, getContext } from 'svelte';
    import { FlowModelClient, DiffusionModelClient } from '@diffusion-explorer/diffusion';
    // Import settings
    import { interfaceSettings, domainRange } from '$lib/settings';

    // Import pageState
    const pageState = getContext("pageState");
    const { numberOfSteps } = pageState;

    export let isActive: boolean = true; // Flag to indicate if the plot is active
    export let isEnabled: boolean = true; // Flag to indicate if the plot is enabled
    export let opacity: number = 0.3; // Opacity of the contour
    export let time: number = 0.0; // Default value for the time
    export let svgElement; // Shared SVG element for all distributions
    export let distributionId: string = "target"; // ID for the distribution canvas
    export let trajectoryColor: string = "rgb(255, 100, 0)";

    // Props for worker-based sampling
    export let modelPath: string = ''; // Path to current model JSON
    export let trainingObjective: string = 'Flow Matching'; // "Flow Matching" or "Diffusion"
    export let modelConfig: object = { dim: 2, hidden: 64 }; // Model configuration

    // Worker URL
    const flowModelWorkerUrl = '/workers/flow_model.worker.js';
    const diffusionModelWorkerUrl = '/workers/diffusion_model.worker.js';

    // Choose some arbitrary initial condition
    let handleGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
    let initialized: boolean = false; // Flag to indicate if the plot is initialized

    // Default handle position (center of distribution)
    const defaultPosition = [
        interfaceSettings.distributionWidth / 2,
        interfaceSettings.distributionHeight / 2
    ];
    let handlePosition: number[] = [...defaultPosition];

    // Streaming state
    let isStreaming = false;
    let activeRequestId: string | null = null;
    let streamedTrajectory: number[][] | null = null; // Full trajectory once complete (in pixel coords)
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let client: FlowModelClient | DiffusionModelClient | null = null;

    // Create client when model path changes
    $: if (modelPath) {
        const workerUrl = trainingObjective === 'Flow Matching' ? flowModelWorkerUrl : diffusionModelWorkerUrl;
        client = trainingObjective === 'Flow Matching'
            ? new FlowModelClient(workerUrl, modelPath, trainingObjective, modelConfig)
            : new DiffusionModelClient(workerUrl, modelPath, modelConfig);
    }

    // Coordinate conversion helpers
    function pixelToDomainX(px: number): number {
        return domainRange.xMin + (px / interfaceSettings.distributionWidth) * (domainRange.xMax - domainRange.xMin);
    }
    function pixelToDomainY(py: number): number {
        return domainRange.yMin + (py / interfaceSettings.distributionHeight) * (domainRange.yMax - domainRange.yMin);
    }
    function domainToPixelX(dx: number): number {
        return ((dx - domainRange.xMin) / (domainRange.xMax - domainRange.xMin)) * interfaceSettings.distributionWidth;
    }
    function domainToPixelY(dy: number): number {
        return ((dy - domainRange.yMin) / (domainRange.yMax - domainRange.yMin)) * interfaceSettings.distributionHeight;
    }

    // Trigger sampling from a given pixel position
    async function triggerSampleFromPosition(position: number[]) {
        if (!client || !modelPath) return;

        // Convert pixel position to domain coordinates
        const domainX = pixelToDomainX(position[0]);
        const domainY = pixelToDomainY(position[1]);

        isStreaming = true;
        // Store trajectory in DOMAIN coordinates (not pixel)
        let tempTrajectory: number[][] = [];

        // Add initial point in domain coordinates
        tempTrajectory.push([domainX, domainY]);

        const numSteps = $numberOfSteps || 100;

        const { requestId, promise } = client.sampleFromInitialPoints(
            [[domainX, domainY]],
            numSteps,
            {},
            // Per-step callback - update streamedTrajectory incrementally for live display
            (step, x_t) => {
                tempTrajectory.push([x_t[0][0], x_t[0][1]]);
                // Reassign to trigger Svelte reactivity for incremental display
                streamedTrajectory = [...tempTrajectory];
            }
        );

        activeRequestId = requestId;

        try {
            await promise;
            // Only set trajectory once complete
            streamedTrajectory = tempTrajectory;
        } catch (e) {
            // Request was cancelled, ignore
            console.log('Sample request cancelled or failed:', e);
        } finally {
            isStreaming = false;
            activeRequestId = null;
        }
    }

    // Cleanup on destroy
    onDestroy(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (activeRequestId && client) {
            client.stopRequest(activeRequestId);
        }
    });

    // Draw trajectory from streamed data (stored in domain coordinates)
    // When streaming, only shows up to current time (no future preview until complete)
    function drawTrajectory(domainTrajectory: number[][], currentTime: number, streaming: boolean) {
        if (!domainTrajectory || domainTrajectory.length === 0) return;

        const svg = d3.select(svgElement);

        // Select the group by ID, or create if not exists
        let group = svg.select(`#${distributionId}_trajectories`);
        if (group.empty()) {
            group = svg.append("g")
                .attr("id", distributionId + "_trajectories")
                .attr("isolation", "isolate");
        } else {
            group.selectAll("*").remove(); // Clear previous contents
        }

        const numPoints = domainTrajectory.length;
        const numSteps = $numberOfSteps || 100;

        // Convert domain coordinates to display coordinates with temporal x-translation
        // Use expected total steps for consistent spacing even during streaming
        const displayTrajectory = domainTrajectory.map((point, index) => {
            const pointTime = index / numSteps; // Use total expected steps, not current length

            // Domain → pixel
            const pixelX = domainToPixelX(point[0]);
            const pixelY = domainToPixelY(point[1]);

            // Apply temporal x-translation (same as convertDataToDisplayCoordinateFrame)
            const xOffset = pointTime * (interfaceSettings.displayAreaWidth - interfaceSettings.distributionWidth);

            return [pixelX + xOffset, pixelY];
        });

        // Calculate indices
        const loadedIndex = numPoints - 1; // Last loaded point index
        const timeIndex = Math.floor(currentTime * numSteps); // Current time index based on total steps

        // While streaming: only show up to min(timeIndex, loadedIndex)
        // After complete: show past up to timeIndex, future from timeIndex onward
        const showUpToIndex = streaming
            ? Math.min(timeIndex, loadedIndex)
            : Math.min(timeIndex, loadedIndex);

        const pastSeg = displayTrajectory.slice(0, showUpToIndex + 1);

        // D3 line generator for 2D points
        const line = d3.line<number[]>()
            .x(d => d[0])
            .y(d => d[1])
            .curve(d3.curveLinear);

        // White outline (drawn first, underneath)
        if (pastSeg.length > 0) {
            group.append("path")
                .datum(pastSeg)
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", "white")
                .attr("stroke-width", 7)
                .attr("stroke-linejoin", "round")
                .attr("stroke-linecap", "round")
                .attr("opacity", opacity);

            // Past segment – darker / more opaque
            group.append("path")
                .datum(pastSeg)
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", trajectoryColor)
                .attr("stroke-width", 3);
        }

        // Future segment – only show when NOT streaming and we have points beyond current time
        if (!streaming && timeIndex < loadedIndex) {
            const futureSeg = displayTrajectory.slice(timeIndex);
            group.append("path")
                .datum(futureSeg)
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", trajectoryColor)
                .attr("stroke-width", 3)
                .attr("opacity", opacity);
        }

        // Draw a circle at the current point (or last loaded point if streaming)
        const currentPoint = displayTrajectory[showUpToIndex];
        if (currentPoint) {
            group.append("circle")
                .attr("cx", currentPoint[0])
                .attr("cy", currentPoint[1])
                .attr("r", 5)
                .attr("fill", trajectoryColor);
        }

        // Raise the drag handle above the trajectory
        const handle = svg.select(`#${distributionId}_handle`);
        if (!handle.empty()) {
            handle.raise();
        }
    }

    // Redraw trajectory when time changes or trajectory updates
    $: if (svgElement && streamedTrajectory && streamedTrajectory.length > 0 && isActive) {
        drawTrajectory(streamedTrajectory, time, isStreaming);
    }

    // Setup behavior for the drag handle, will run a single time
    $: if (!initialized && svgElement && isActive) {
        initialized = true;
        const svg = d3.select(svgElement);

        // 1. Create a group for the drag handle
        handleGroup = svg.append("g")
            .attr("id", `${distributionId}_handle`)
            .style("cursor", "grab");

        // Display the handle from the PointerIcon.svg file
        handleGroup.append("image")
            .attr("xlink:href", base + "/PointerIcon.svg")
            .attr("x", handlePosition[0])
            .attr("y", handlePosition[1])
            .attr("transform", "translate(-20, -20)") // Center the image
            .attr("width", 40)
            .attr("height", 40)
            .attr("z-index", 1000);

        // 2. Create a drag behavior with debounce for worker sampling
        const drag = d3.drag<SVGGElement, unknown>()
            .on("start", () => handleGroup.style("cursor", "grabbing"))
            .on("drag", (event) => {
                // pointer coords relative to the SVG
                let [x, y] = d3.pointer(event, svg.node());
                // Clamp coordinates to distribution area
                x = Math.max(0, Math.min(x, interfaceSettings.distributionWidth));
                y = Math.max(0, Math.min(y, interfaceSettings.distributionHeight));

                // Move the icon
                handleGroup.select("image")
                    .attr("x", x)
                    .attr("y", y);
                // Also move the label if present
                handleGroup.select("text")
                    .attr("x", x)
                    .attr("y", y - 25);

                // Update handle position
                handlePosition = [x, y];

                // Clear any pending sample request
                if (debounceTimer) clearTimeout(debounceTimer);

                // Cancel any in-flight streaming
                if (activeRequestId && client) {
                    client.stopRequest(activeRequestId);
                    activeRequestId = null;
                    isStreaming = false;
                }

                // Clear displayed trajectory while dragging
                streamedTrajectory = null;
                // Clear the trajectory group
                const trajectoryGroup = svg.select(`#${distributionId}_trajectories`);
                if (!trajectoryGroup.empty()) {
                    trajectoryGroup.selectAll("*").remove();
                }

                // Debounce: trigger sample after 200ms of no movement
                debounceTimer = setTimeout(() => {
                    triggerSampleFromPosition(handlePosition);
                }, 200);
            })
            .on("end", () => handleGroup.style("cursor", "grab"));

        // 3. Attach the drag behavior to the group
        handleGroup.call(drag);

        // 4. Trigger initial sample from default position
        triggerSampleFromPosition(handlePosition);
    }

    // If the plot is no longer active, remove the group
    $: if (!isActive && svgElement) {
        const svg = d3.select(svgElement);
        const group = svg.select(`#${distributionId}_trajectories`);
        if (!group.empty()) {
            group.remove();
        }
        // Hide the drag handle
        const handle = svg.select(`#${distributionId}_handle`);
        if (!handle.empty()) {
            handle.remove();
        }
        initialized = false;
        streamedTrajectory = null;
    }

</script>
