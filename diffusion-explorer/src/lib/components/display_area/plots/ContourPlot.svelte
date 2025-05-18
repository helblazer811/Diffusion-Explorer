
<script lang="ts">
    import * as tf from '@tensorflow/tfjs';
    import * as d3 from 'd3';

    import { domainRange } from '$lib/state';
    import { screenWidth } from '$lib/screen';
    import { interfaceSettings } from '$lib/settings';
    import { convertDataToDisplayCoordinateFrame } from '$lib/components/display_area/plots/utils';

    export let isActive: boolean = true; // Flag to indicate if the plot is active
    export let isEnabled: boolean = true; // Flag to indicate if the plot is enabled
    export let svgElement; // Shared SVG element for all distributions
    export let time: number = 0.0; // Default value for the time
    export let data: tf.Tensor; // Data to plot
    export let distributionId: string = "target"; // ID for the distribution canvas
    export let opacity: number = 0.5; // Opacity of the contour
    export let fillColor: string = "#7b7b7b"; // Fill color for the contour
    export let bandwidth: number = 30; // Bandwidth for the contour density
    export let numberOfContours: number = 4; // Number of contours to draw
    export let showBorder: boolean = false; // Flag to indicate if the border should be shown
    export let borderColor: string = "#7b7b7b"; // Border color for the contour
    export let label: string; // Label for the distribution
    export let labelIsLatex: boolean = false; // Flag to indicate if the label is in LaTeX format

    function displayLatex(
        formula: string,
        xLocation: number,
        yLocation: number,
        distributionId: string = "target",
    ) {
        const svg = d3.select(svgElement);

        let group = svg.select(`#${distributionId}_latex`);
        if (group.empty()) {
            group = svg.append("foreignObject")
                .attr("id", distributionId + "_latex");
        } else {
            group.selectAll("*").remove();
        }

        group.attr("x", xLocation)
            .attr("y", yLocation)
            .attr("width", 300)
            .attr("height", 100);

        const div = group.append("xhtml:div")
            .style("width", "100%")
            .style("height", "100%")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("font", "34px 'KaTeX_Main', serif")
            .style("color", "#7b7b7b");

        katex.render(formula, div.node(), {
            throwOnError: false
        });
    }

    function displayText(
        text: string,
        xLocation: number,
        yLocation: number,
        distributionId: string = "target",
    ) {
        const screen = $screenWidth || 800;
        // Select the group by ID, or create if not exists
        const svg = d3.select(svgElement);
        // NOTE: This prevents unwanted recreation of the group
        let group = svg.select(`#${distributionId}_text`);
        if (group.empty()) {
            group = svg.append("g").attr("id", distributionId+"_text");
        } else {
            group.selectAll("*").remove(); // Clear previous contents of this group
        }
        // Plot title above the contour 
        group.append("text")
            .attr("x", xLocation)
            .attr("y", screen > 600 ? yLocation: yLocation + 20)
            .attr("text-anchor", "middle")
            .style("font-size", screen > 600 ? "24px" : "40px")
            .style("font-family", "Helvetica, sans-serif")
            .style("fill", "#7b7b7b")
            .text(text);
    }
    
    function plotContour(
        data: tf.Tensor,
        time: number,
        opacity: number = 0.9,
        // xLocation: number = 0,
        distributionId: string = "target",
        densityResolution: number = 100,
    ) {
        // 1. Convert data to display coordinate frame
        let translatedData = convertDataToDisplayCoordinateFrame(
            data, 
            time, 
            interfaceSettings.distributionWidth, 
            interfaceSettings.displayAreaWidth, 
            $domainRange
        );
        const contours = d3.contourDensity()
            .x(d => d[0])
            .y(d => d[1])
            .size([interfaceSettings.displayAreaWidth, interfaceSettings.displayAreaHeight])
            .bandwidth(bandwidth) // Tune this to spread the density
            .thresholds(numberOfContours)
            (translatedData);
        // 4. Scales for drawing
        const svg = d3.select(svgElement); 
        // Select the group by ID, or create if not exists
        // NOTE: This prevents unwanted recreation of the group
        let group = svg.select(`#${distributionId}_contour`);
        if (group.empty()) {
            group = svg.append("g")
                .attr("id", distributionId+"_contour")
                // .attr("isolation", "isolate"); // Prevents blending with other groups
        } else {
            group.selectAll("*").remove(); // Clear previous contents of this group
        }
        // 5. Draw contours
        group.selectAll("path")
            .data(contours)
            .enter()
            .append("path")
            .attr("d", d3.geoPath())
            .attr("fill", fillColor)
            .attr("stroke", borderColor)
            .attr("stroke-width", showBorder ? 3 : 0)
            .attr("stroke-opacity", opacity)
            .attr("fill-opacity", opacity)
            .attr("mix-blend-mode", "screen")

    }

    // If the data points change then replot
    $: if (data && svgElement && $screenWidth && isActive) {
        plotContour(data, time, opacity, distributionId);
        if (label) {
            const xLocation = time * (interfaceSettings.displayAreaWidth - interfaceSettings.distributionWidth) + (interfaceSettings.distributionWidth / 2);
            if (labelIsLatex) {
                displayLatex(label, xLocation, 40, distributionId);
            } else {
                displayText(label, xLocation, 40, distributionId);
            }
        }
    }
    // If the plot is no longer active, remove the group
    $: if (!isActive && svgElement) {
        const svg = d3.select(svgElement);
        const group = svg.select(`#${distributionId}_contour`);
        if (!group.empty()) {
            group.remove();
        }
    }
</script>
<!-- 
<style> 
    svg {
        position: absolute;
        top: 0;
        width: 100%;
        height: 100%;
        pointer-events: none; /* Optional: allow interaction to pass through */
    }
</style>

<svg
    bind:this={svgElement}
    id="svg_{distributionId}" 
    viewBox="0 0 {interfaceSettings.displayAreaWidth} {interfaceSettings.distributionHeight}"
    style={"left: " + xLocation + "px;"}
    preserveAspectRatio="xMidYMid meet"
>
</svg> -->