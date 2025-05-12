
<script lang="ts">
    import * as tf from '@tensorflow/tfjs';
    import * as d3 from 'd3';

    import { interfaceSettings, domainRange } from '$lib/state';

    export let data: tf.Tensor; // Data to plot
    export let distributionId: string = "target"; // ID for the distribution canvas
    export let xLocation: number = 0; // X location of the contour
    export let opacity: number = 0.5; // Opacity of the contour
    export let colorMap: string = "Blues"; // Color map for the heatmap
    export let fillColor: string = "#7b7b7b"; // Fill color for the contour
    export let bandwidth: number = 10; // Bandwidth for the contour density
    export let showBorder: boolean = false; // Flag to indicate if the border should be shown
    export let borderColor: string = "#7b7b7b"; // Border color for the contour
    export let label: string; // Label for the distribution
    export let labelIsLatex: boolean = false; // Flag to indicate if the label is in LaTeX format

    let svgElement: SVGSVGElement; // Create a separate SVG element for each distribution

    let colorScale = d3[`interpolate${colorMap}`];

    function displayLatex(
        formula: string,
        xLocation: number,
        yLocation: number,
        distributionId: string = "target",
    ) {
        const svg = d3.select("svg");

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
        // Select the group by ID, or create if not exists
        const svg = d3.select("svg");
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
            .attr("y", yLocation)
            .attr("text-anchor", "middle")
            .style("font-size", "24px")
            .style("font-family", "Helvetica, sans-serif")
            .style("fill", "#7b7b7b")
            .text(text);
    }
    
    function plotContour(
        data: tf.Tensor,
        opacity: number = 0.9,
        xLocation: number = 0,
        distributionId: string = "target",
        numberOfContours: number = 4,
    ) {
        // Convert data to plain 2d array
        let values = data.arraySync() as number[][];
        // 2. Build histogram
        const xScale = d3.scaleLinear()
            .domain([$domainRange.xMin, $domainRange.xMax])
            .range([0, interfaceSettings.distributionWidth]);
        const yScale = d3.scaleLinear()
            .domain([$domainRange.yMin, $domainRange.yMax])
            .range([0, interfaceSettings.distributionHeight]);

        const contours = d3.contourDensity()
            .x(d => xScale(d[0]))
            .y(d => yScale(d[1]))
            .size([interfaceSettings.distributionWidth, interfaceSettings.distributionHeight])
            .bandwidth(30)
            .thresholds(numberOfContours)
            (values)

        // 4. Scales for drawing
        const svg = d3.select("svg"); 
        // Select the group by ID, or create if not exists
        // NOTE: This prevents unwanted recreation of the group
        let group = svg.select(`#${distributionId}`);
        if (group.empty()) {
            group = svg.append("g")
                .attr("id", distributionId)
                .attr("isolation", "isolate"); // Prevents blending with other groups
        } else {
            group.selectAll("*").remove(); // Clear previous contents of this group
        }
        // Prepare a color palette
        // const color = d3.scaleSequential(colorScale)
        //     .domain([0, d3.max(contours, d => d.value) * 1.2]);
        // 5. Draw contours
        group.selectAll("path")
            .data(contours)
            .enter()
            .append("path")
            .attr("d", d3.geoPath())
            // .attr("fill", d => color(d.value))
            .attr("fill", fillColor)
            .attr("stroke", borderColor)
            .attr("stroke-width", showBorder ? 3 : 0)
            .attr("stroke-opacity", opacity)
            .attr("fill-opacity", opacity)
            .attr("mix-blend-mode", "screen")
            .attr("transform", `translate(${xLocation}, 0)`);
    }

    // If the data points change then replot
    $: if (data && svgElement) {
        plotContour(data, opacity, xLocation, distributionId);
        if (label) {
            if (labelIsLatex) {
                console.log("Label is latex: ", label);
                displayLatex(label, xLocation + interfaceSettings.distributionWidth / 2, 40, distributionId);
            } else {
                displayText(label, xLocation + interfaceSettings.distributionWidth / 2, 40, distributionId);
            }
        }
    }
</script>

<style> 
    svg {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
    }
</style>

<svg
    bind:this={svgElement}
    id="svg_{distributionId}" 
    width={interfaceSettings.distributionWidth}
    height={interfaceSettings.distributionHeight}
    style={"left: " + xLocation + "px;"}
>
</svg>