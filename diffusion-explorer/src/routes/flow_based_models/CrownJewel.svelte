<!--
    Here we are just going to visualize a restricted subset of the Diffusion Explorer tool.
    We will for now just show a gaussian distribution and how it is transformed into a
    data distribution (smiley face for now) using flow-matching with an Euler sampler.
-->

<script lang="ts">
    import { onMount } from 'svelte';
    import Distribution from '$lib/components/display_area/Distribution.svelte';
    import { interfaceSettings } from '$lib/settings';

    let sharedSVGElement: SVGSVGElement;
    let gaussianSamples: number[][] = [];

    // Function to generate samples from a 2D Gaussian distribution
    function generateGaussianSamples(
        numSamples: number = 1000,
        meanX: number = 0,
        meanY: number = 0,
        stdX: number = 1,
        stdY: number = 1
    ): number[][] {
        const samples: number[][] = [];

        for (let i = 0; i < numSamples; i++) {
            // Box-Muller transform to generate normal distribution
            const u1 = Math.random();
            const u2 = Math.random();

            const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);

            const x = meanX + z0 * stdX;
            const y = meanY + z1 * stdY;

            samples.push([x, y]);
        }

        return samples;
    }

    onMount(() => {
        // Generate gaussian samples centered at origin with standard deviations
        gaussianSamples = generateGaussianSamples(2000, 0, 0, 0.3, 0.3);
    });
</script>

<style>
    .crown-jewel-container {
        width: 100%;
        max-width: var(--display-area-width);
        margin: 0 auto;
    }

    .display-area {
        width: var(--display-area-width);
        transform-origin: top left;
        aspect-ratio: calc(var(--display-area-width) / var(--display-area-height));
        position: relative;
    }

    @media (max-width: var(--display-area-width)) {
        .display-area {
            transform: scale(calc(100vw / var(--display-area-width)));
        }
    }
</style>

<div class="crown-jewel-container">
    <div class="display-area">
        <svg
            bind:this={sharedSVGElement}
            viewBox="0 0 {interfaceSettings.displayAreaWidth} {interfaceSettings.displayAreaHeight}"
            preserveAspectRatio="xMidYMid meet"
            width="100%"
            height="100%"
        >
            {#if sharedSVGElement && gaussianSamples.length > 0}
                <Distribution
                    svgElement={sharedSVGElement}
                    visible={true}
                    time={0}
                    data={gaussianSamples}
                    opacity={0.7}
                    label="2D Gaussian"
                    distributionId="gaussian"
                    showBorder={false}
                    fillColor="rgba(25, 131, 255, 0.3)"
                    borderColor="rgba(25, 131, 255, 1)"
                    activePlotTypes={["Scatter", "Contour"]}
                    scatterPlotMaximumPoints={2000}
                />
            {/if}
        </svg>
    </div>
</div>
