<script lang="ts">
    import * as d3 from 'd3';

    import { interfaceSettings, domainRange } from '$lib/settings';
    import { targetDistributionSamples, isEditing } from '$lib/state';

    // import { convertDataToDisplayCoordinateFrame } from '$lib/components/display_area/plots/utils';
    
    export let svgElement: SVGSVGElement;
    export let drawTimeout: number = 30; // Number of milliseconds to wait before drawing the next point when mouse holding
    export let active: boolean = false;

    let initialized = false; // Flag to indicate if the edit area has been initialized
    let drawInterval;
    let groupElement: SVGGElement; // Group element for the distribution

    // Change the visibility of the distribution edit window based on the active state
    $ : if (active && initialized) {
        groupElement.style.visibility = "visible";
    } else if (!active && initialized) {
        groupElement.style.visibility = "hidden";
    }

    $ : if (svgElement && !initialized) {
        initialized = true; // Set the flag to true to prevent re-initialization
        const svg = d3.select(svgElement);
        // Create a group for the distribution edit window
        const groupD3Element = svg.append('g')
            .attr('id', 'distribution-edit-window')
            // .style('display', 'none') // Initially hidden
            .style('visibility', 'hidden') // Initially hidden
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
            .attr('fill', 'transparent')
            .attr('stroke', '#aaaaaa')
            .attr('stroke-width', 3)
            // .attr('stroke-dasharray', '5, 5')
            .attr('rx', 5) // Rounded corners
            .attr('ry', 5);

        let isDrawing = false;
        let lastPointer = [0, 0];

        groupD3Element
            .on('mousedown', function (event) {
                const [x, y] = d3.pointer(event);
                if (x > xCoordinate && x < xCoordinate + width && y > yCoordinate && y < yCoordinate + height) {
                    isDrawing = true;
                    lastPointer = [x, y];

                    drawInterval = setInterval(() => {
                        const [currX, currY] = lastPointer;
                        if (currX > xCoordinate && currX < xCoordinate + width && currY > yCoordinate && currY < yCoordinate + height) {
                            const sigma = 5.0;
                            const sampleX = d3.randomNormal(currX, sigma)();
                            const sampleY = d3.randomNormal(currY, sigma)();
                            // Clip the sample to the bounding box
                            const clippedSample = [
                                Math.max(xCoordinate, Math.min(sampleX, xCoordinate + width)),
                                Math.max(yCoordinate, Math.min(sampleY, yCoordinate + height))
                            ];
                            // Convert the sample to data coordinates
                            targetDistributionSamples.update(samples => {
                                return [...samples, clippedSample];
                            });
                            console.log($targetDistributionSamples)
                        }
                    }, drawTimeout);
                }
            })
            .on('mousemove', function (event) {
                if (isDrawing) {
                    lastPointer = d3.pointer(event, svgElement);
                }
            })
            .on('mouseup', () => {
                isDrawing = false;
                clearInterval(drawInterval);
            })
            .on('mouseleave', () => {
                isDrawing = false;
                clearInterval(drawInterval);
            });
    }

</script>