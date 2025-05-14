<script lang="ts">
    import * as tf from '@tensorflow/tfjs';
    import * as d3 from 'd3';

    import { interfaceSettings } from '$lib/state';

    export let data: tf.Tensor; // Data to plot
    export let distributionId: string = "target"; // ID for the distribution canvas
    export let xLocation: number = 0; // X location of the contour
    export let opacity: number = 0.5; // Opacity of the contour
    export let colorMap: string = "Blues"; // Color map for the heatmap
    export let bandwidth: number = 30; // Bandwidth for the contour density

    let canvasElement: HTMLCanvasElement; // Create a separate canvas element for each distribution

    let colorScale = d3[`interpolate${colorMap}`];

    function plotHeatmap(
        data: tf.Tensor,
        opacity: number = 0.5,
        xLocation: number = 0,
        distributionId: string = "target"
    ) {
        console.log("Plotting heatmap for distribution: ", distributionId);
        const values = data.arraySync() as number[][];
        // const values = data;
        const width = interfaceSettings.distributionWidth;
        const height = interfaceSettings.distributionHeight;
        const ctx = canvasElement.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);

        // Rescale the data to the canvas size
        let xMin = d3.min(values, d => d[0]);
        let xMax = d3.max(values, d => d[0]);
        let yMin = d3.min(values, d => d[1]);
        let yMax = d3.max(values, d => d[1]);
        const dataWidth = xMax - xMin;
        const dataHeight = yMax - yMin;
        xMin -= 0.1 * dataWidth;
        xMax += 0.1 * dataWidth;
        yMin -= 0.1 * dataHeight;
        yMax += 0.1 * dataHeight;
        // Rescale the data points to the canvas size
        const rescaledData = new Array(values.length);
        for (let i = 0; i < values.length; i++) {
            rescaledData[i] = [
                ((values[i][0] - xMin) / (xMax - xMin)) * width,
                ((values[i][1] - yMin) / (yMax - yMin)) * height
            ];
        }
        console.log("Rescaled data: ", rescaledData);
        // console.log(values)
        // KDE parameters
        const resolution = width; // pixels per axis

        // Create a 2D grid
        const densityGrid = new Array(resolution).fill(0).map(() => new Array(resolution).fill(0));
        const stepX = width / resolution;
        const stepY = height / resolution;

        // Gaussian kernel
        function gaussian(u) {
            return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
        }
        console.log(new Date().toLocaleTimeString());
        // Estimate density at each grid point
        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                const x = i * stepX;
                const y = j * stepY;
                let sum = 0;
                for (const [px, py] of rescaledData) {
                    const dx = (x - px) / bandwidth;
                    const dy = (y - py) / bandwidth;
                    sum += gaussian(dx) * gaussian(dy);
                }
                densityGrid[i][j] = sum;
            }
        }
        console.log(new Date().toLocaleTimeString());
        // Normalize the density grid
        let maxDensity = 0;
        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                if (densityGrid[i][j] > maxDensity) {
                    maxDensity = densityGrid[i][j];
                }
            }
        }
        console.log(new Date().toLocaleTimeString());
        // Draw to canvas
        // let colorScale = d3.interpolateRgb("rgb(234, 234, 234)", "rgba(0, 0, 255, 1)");
        const imageData = ctx.createImageData(width, height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const value = densityGrid[y][x] / maxDensity; // should be in [0, 1]
                const color = d3.color(colorScale(value));
                const index = (y * width + x) * 4;

                imageData.data[index]     = color.r; // Red
                imageData.data[index + 1] = color.g; // Green
                imageData.data[index + 2] = color.b; // Blue
                imageData.data[index + 3] = 255;     // Alpha (fully opaque)
            }
        }

        ctx.putImageData(imageData, 0, 0);
        console.log(new Date().toLocaleTimeString());
    }

    // If the data points change then replot
    $: if (data && canvasElement) {
        // console.log("Plotting heatmap");
        plotHeatmap(data, opacity, xLocation, distributionId);
    }

</script>

<style>
    canvas {
        position: absolute;
        pointer-events: none; /* Prevent mouse events on the canvas */
    }
</style>

<canvas
    bind:this={canvasElement}
    id={distributionId}
    width={interfaceSettings.distributionWidth}
    height={interfaceSettings.distributionHeight}
    style={
        "width: " + interfaceSettings.distributionWidth + "px;" + 
        "height: " + interfaceSettings.distributionHeight + "px; " +
        "left: " + xLocation + "px; " +
        "opacity: " + opacity + "; " +
        "background-color: transparent; " +
        "pointer-events: none;"
    }
>
</canvas>