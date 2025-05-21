import * as d3 from 'd3';

export function downloadJSON(data, filename = 'data.json') {
    const jsonStr = JSON.stringify(data, null, 2); // pretty-print
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url); // Clean up
}

export function convertDataToDisplayCoordinateFrame(
    data: number[][], // shape: [N, 2]
    time: number,
    distributionWidth: number,
    displayAreaWidth: number,
    domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
){
    // let data = tensorData.arraySync() as number[][]; // Convert to plain 2D array
    // 1. Scale from the abstract coordinate frame (~ -3 to 3) to the svg viewbox coordinate frame
    const xScale = d3.scaleLinear()
        .domain([domainRange.xMin, domainRange.xMax])
        .range([0, distributionWidth]);
    const yScale = d3.scaleLinear()
        .domain([domainRange.yMin, domainRange.yMax])
        .range([0, distributionWidth]);
    // 2. Apply the scale to the data
    const scaledData = data.map(d => [xScale(d[0]), yScale(d[1])]);
    // 3. Now translate the data to the correct xLocation based on the time
    const xLocation = time * (displayAreaWidth - distributionWidth);
    const translatedData = scaledData.map(d => [d[0] + xLocation, d[1]]);

    return translatedData;
}

export function convertDisplayCoordinateFrameToData(
    displayData: number[][],
    time: number,
    distributionWidth: number,
    displayAreaWidth: number,
    domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
){
    // 1. Translate the data to the abstract coordinate frame
    const xLocation = time * (displayAreaWidth - distributionWidth);
    const translatedData = displayData.map(d => [d[0] - xLocation, d[1]]);
    // 2. Scale from the svg viewbox coordinate frame to the abstract coordinate frame
    const xScale = d3.scaleLinear()
        .domain([0, distributionWidth])
        .range([domainRange.xMin, domainRange.xMax]);
    const yScale = d3.scaleLinear()
        .domain([0, distributionWidth])
        .range([domainRange.yMin, domainRange.yMax]);
    // 3. Apply the scale to the data
    const scaledData = translatedData.map(d => [xScale(d[0]), yScale(d[1])]);

    return scaledData;
}