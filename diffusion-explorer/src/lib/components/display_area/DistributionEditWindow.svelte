<script lang="ts">
    import { get } from 'svelte/store';
    import * as tf from '@tensorflow/tfjs';
    import * as d3 from 'd3';

    import { interfaceSettings } from '$lib/settings';
    import { targetDistributionSamples, domainRange, isEditing } from '$lib/state';
    import { convertDisplayCoordinateFrameToData } from '$lib/components/display_area/plots/utils';

    // import { convertDataToDisplayCoordinateFrame } from '$lib/components/display_area/plots/utils';
    
    export let svgElement: SVGSVGElement;
    export let drawTimeout: number = 100; // Number of milliseconds to wait before drawing the next point when mouse holding
    export let active: boolean = false;

    let initialized = false; // Flag to indicate if the edit area has been initialized
    let drawInterval;
    let groupElement: SVGGElement; // Group element for the distribution

    // Change the visibility of the distribution edit window based on the active state
    $ : if (active && initialized) {
        console.log("Setting distribution edit window to active");
        groupElement.style.display = "block";
    } else if (!active && initialized) {
        console.log("Setting distribution edit window to inactive");
        groupElement.style.display = "none";
    }

    $ : if (svgElement && !initialized) {
        initialized = true; // Set the flag to true to prevent re-initialization
        const svg = d3.select(svgElement);
        console.log("Loading distribution edit window");
        // Create a group for the distribution edit window
        const groupD3Element = svg.append('g')
            .attr('id', 'distribution-edit-window')
            .style('display', 'none') // Initially hidden
        groupElement = groupD3Element.node();
        // Compute location of bounding box 
        const time = 1.0; // Time of target distribution
        const width = interfaceSettings.distributionWidth * 0.8;
        const height = interfaceSettings.distributionHeight * 0.8;
        const xCoordinate = time * (interfaceSettings.displayAreaWidth - interfaceSettings.distributionWidth) + (interfaceSettings.distributionWidth - width) / 2;
        const yCoordinate = (interfaceSettings.displayAreaHeight - height) / 2;
        // Draw a rectangle in the svg at the given location
        groupD3Element.append('rect')
            .attr('x', xCoordinate)
            .attr('y', yCoordinate)
            .attr('width', width)
            .attr('height', height)
            .attr('fill', 'none')
            .attr('stroke', '#aaaaaa')
            .attr('stroke-width', 3)
            // .attr('stroke-dasharray', '5, 5')
            .attr('rx', 5) // Rounded corners
            .attr('ry', 5);

        let isDrawing = false;

        groupD3Element.on('mousedown', function (event) {
            const [x, y] = d3.pointer(event);
            if (x > xCoordinate && x < xCoordinate + width && y > yCoordinate && y < yCoordinate + height) {
                isDrawing = true;
                drawInterval = setInterval(() => {
                    const [currX, currY] = d3.pointer(event, svg.node());
                    if (currX > xCoordinate && currX < xCoordinate + width && currY > yCoordinate && currY < yCoordinate + height) {
                        const sigma = 0.1;
                        const sampleX = d3.randomNormal(currX, sigma)();
                        const sampleY = d3.randomNormal(currY, sigma)();
                        const sampleTensor = [[sampleX, sampleY]];
                        const rescaledData = convertDisplayCoordinateFrameToData(
                            sampleTensor,
                            time,
                            interfaceSettings.distributionWidth,
                            interfaceSettings.displayAreaWidth,
                            get(domainRange)
                        );
                        targetDistributionSamples.update(samples => {
                            return tf.concat([samples, rescaledData], 0);
                        });
                    }
                }, drawTimeout); // Sample every 50ms
            }
        });

        groupD3Element.on('mouseup', () => {
            isDrawing = false;
            clearInterval(drawInterval);
        });

        groupD3Element.on('mouseleave', () => {
            isDrawing = false;
            clearInterval(drawInterval);
        });
    }

</script>