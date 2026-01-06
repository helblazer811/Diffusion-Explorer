<script lang="ts">
    import { getContext, onDestroy } from 'svelte';
    import { interfaceSettings, contourPlotSettings } from '$lib/settings';
    import { computeContours, plotContours } from '@diffusion-explorer/ui';

    const pageState = getContext<any>("pageState");
    const { targetDistributionSamples, isEditing } = pageState;

    export let drawTimeout: number = 50;

    // Canvas dimensions (matches distribution area)
    const width = interfaceSettings.distributionWidth;
    const height = interfaceSettings.distributionHeight;

    // Bounding box dimensions (80% of distribution area, centered)
    const boxWidth = width * 0.8;
    const boxHeight = height * 0.8;
    const boxX = (width - boxWidth) / 2;
    const boxY = (height - boxHeight) / 2;

    // Canvas for rendering contours
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D | null = null;
    let dpr = 1;

    let isDrawing = false;
    let lastPointer = [0, 0];
    let drawInterval: ReturnType<typeof setInterval> | null = null;

    // Contour options for local coordinate system (0-500)
    const contourOptions = {
        gridSize: 100,
        bandwidth: contourPlotSettings.bandwidth,
        thresholds: Array.from({ length: contourPlotSettings.contourLevels }, (_, i) =>
            (i + 1) / (contourPlotSettings.contourLevels + 1)
        ),
        domain: [0, width, 0, height] as [number, number, number, number],
    };

    // Identity scale since we're working in local pixel coords
    const identityScale = (v: number) => v;

    // Initialize canvas context with DPI scaling when canvas becomes available
    $: if (canvas && !ctx) {
        dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }

    // Draw contours when samples change
    $: if (ctx && $targetDistributionSamples && $targetDistributionSamples.length > 0) {
        drawContours($targetDistributionSamples);
    }

    // Clear canvas when samples are empty
    $: if (ctx && (!$targetDistributionSamples || $targetDistributionSamples.length === 0)) {
        ctx.clearRect(0, 0, width, height);
    }

    function drawContours(samples: number[][]) {
        if (!ctx || samples.length === 0) return;

        ctx.clearRect(0, 0, width, height);
        const contours = computeContours(samples, contourOptions);

        plotContours(ctx, contours, {
            xScale: identityScale,
            yScale: identityScale,
            fillColor: contourPlotSettings.targetColor,
            fill: true,
            stroke: false,
            opacity: contourPlotSettings.opacity,
        });
    }

    function handlePointerDown(event: PointerEvent) {
        const svg = event.currentTarget as SVGSVGElement;
        const pt = svg.createSVGPoint();
        pt.x = event.clientX;
        pt.y = event.clientY;
        const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());

        const x = svgP.x;
        const y = svgP.y;

        if (x > boxX && x < boxX + boxWidth && y > boxY && y < boxY + boxHeight) {
            isDrawing = true;
            lastPointer = [x, y];
            (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);

            drawInterval = setInterval(() => {
                const [currX, currY] = lastPointer;
                if (currX > boxX && currX < boxX + boxWidth && currY > boxY && currY < boxY + boxHeight) {
                    const sigma = 5.0;
                    let newSamples: number[][] = [];
                    for (let i = 0; i < 10; i++) {
                        const sampleX = currX + (Math.random() - 0.5) * 2 * sigma * 1.7;
                        const sampleY = currY + (Math.random() - 0.5) * 2 * sigma * 1.7;
                        // Keep samples in local coordinates (0-500)
                        const clippedSample = [
                            Math.max(boxX, Math.min(sampleX, boxX + boxWidth)),
                            Math.max(boxY, Math.min(sampleY, boxY + boxHeight))
                        ];
                        newSamples.push(clippedSample);
                    }
                    targetDistributionSamples.update((samples: number[][]) => [...samples, ...newSamples]);
                }
            }, drawTimeout);
        }
    }

    function handlePointerMove(event: PointerEvent) {
        if (isDrawing) {
            const svg = event.currentTarget as SVGSVGElement;
            const pt = svg.createSVGPoint();
            pt.x = event.clientX;
            pt.y = event.clientY;
            const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
            lastPointer = [svgP.x, svgP.y];
        }
    }

    function handlePointerEnd() {
        isDrawing = false;
        if (drawInterval) {
            clearInterval(drawInterval);
            drawInterval = null;
        }
    }

    onDestroy(() => {
        if (drawInterval) {
            clearInterval(drawInterval);
        }
    });
</script>

<style>
    .edit-box {
        fill: transparent;
        stroke: rgb(0, 0, 0);
        stroke-opacity: 0.2;
        stroke-width: 3;
    }

    .edit-label {
        font-size: 24px;
        fill: #aaaaaa;
        user-select: none;
        pointer-events: none;
    }

    .svg-overlay:hover .edit-label {
        visibility: hidden;
    }
</style>

{#if $isEditing}
    <canvas
        bind:this={canvas}
        class="edit-canvas target-overlay"
    ></canvas>
    <svg
        class="svg-overlay target-overlay"
        viewBox="0 0 {width} {height}"
        on:pointerdown={handlePointerDown}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerEnd}
        on:pointercancel={handlePointerEnd}
        on:pointerleave={handlePointerEnd}
    >
        <rect
            class="edit-box"
            x={boxX}
            y={boxY}
            width={boxWidth}
            height={boxHeight}
            rx="5"
            ry="5"
        />
        <text
            class="edit-label"
            x={boxX + boxWidth / 2}
            y={boxY + boxHeight / 2}
            text-anchor="middle"
            dominant-baseline="middle"
        >
            Draw a Distribution Here
        </text>
    </svg>
{/if}
