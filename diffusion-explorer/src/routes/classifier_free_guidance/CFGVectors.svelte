<script lang="ts">
    import { interfaceSettings, domainRange } from '$lib/settings';
    import * as tf from '@tensorflow/tfjs';

    export let samples: tf.Tensor2D; // Samples from current time step
    export let epsUncond: tf.Tensor2D; // Unconditional epsilons
    export let epsCond: tf.Tensor2D; // Conditional epsilons
    export let guidance: number = 0.0; // Guidance scale
    export let time: number = 0.0; // Current time step (0 to 1)

    // Props for customization
    export let startX: number = 0; // Start position in data coordinates
    export let startY: number = 0;
    export let vectorX: number = 1; // Vector direction/magnitude
    export let vectorY: number = 1;
    export let color: string = "#ff6b6b";
    export let strokeWidth: number = 2;
    export let arrowHeadSize: number = 10;
    export let label: string = "";

    // State for arrow head points
    let arrowHead1X = 0;
    let arrowHead1Y = 0;
    let arrowHead2X = 0;
    let arrowHead2Y = 0;

    // Convert data coordinates to display coordinates
    function dataToDisplay(dataX: number, dataY: number) {
        const displayAreaWidth = interfaceSettings.displayAreaWidth;
        const displayAreaHeight = interfaceSettings.displayAreaHeight;
        const xMin = domainRange.xMin;
        const xMax = domainRange.xMax;
        const yMin = domainRange.yMin;
        const yMax = domainRange.yMax;
        
        // Map from data domain to display coordinates
        const x = ((dataX - xMin) / (xMax - xMin)) * displayAreaWidth;
        const y = displayAreaHeight - ((dataY - yMin) / (yMax - yMin)) * displayAreaHeight;
        
        return { x, y };
    }

    // Calculate start and end points in display coordinates
    $: startPoint = dataToDisplay(startX, startY);
    $: endPoint = dataToDisplay(startX + vectorX, startY + vectorY);

    // Calculate arrow head points
    $: {
        const dx = endPoint.x - startPoint.x;
        const dy = endPoint.y - startPoint.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length > 0) {
            // Normalize
            const ux = dx / length;
            const uy = dy / length;
            
            // Perpendicular vector
            const px = -uy;
            const py = ux;
            
            // Arrow head points
            arrowHead1X = endPoint.x - arrowHeadSize * ux - arrowHeadSize * 0.5 * px;
            arrowHead1Y = endPoint.y - arrowHeadSize * uy - arrowHeadSize * 0.5 * py;
            arrowHead2X = endPoint.x - arrowHeadSize * ux + arrowHeadSize * 0.5 * px;
            arrowHead2Y = endPoint.y - arrowHeadSize * uy + arrowHeadSize * 0.5 * py;
        }
    }

    // Label position (slightly offset from the middle of the vector)
    $: labelX = (startPoint.x + endPoint.x) / 2 + 10;
    $: labelY = (startPoint.y + endPoint.y) / 2 - 10;

</script>

<style>
    .vector-group {
        pointer-events: none;
    }

    .vector-line {
        stroke-linecap: round;
    }

    .vector-label {
        font-size: 14px;
        font-weight: bold;
        fill: currentColor;
        user-select: none;
    }

    .arrow-head {
        fill: currentColor;
    }
</style>

<g class="vector-group" style="color: {color}">
    <!-- Main vector line -->
    <line
        class="vector-line"
        x1={startPoint.x}
        y1={startPoint.y}
        x2={endPoint.x}
        y2={endPoint.y}
        stroke={color}
        stroke-width={strokeWidth}
    />
    
    <!-- Arrow head -->
    <path
        class="arrow-head"
        d="M {endPoint.x} {endPoint.y} L {arrowHead1X} {arrowHead1Y} L {arrowHead2X} {arrowHead2Y} Z"
        fill={color}
    />
    
    <!-- Label (if provided) -->
    {#if label}
        <text
            class="vector-label"
            x={labelX}
            y={labelY}
            text-anchor="middle"
            fill={color}
        >
            {label}
        </text>
    {/if}
</g>
