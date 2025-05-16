import * as d3 from 'd3';
import * as tf from '@tensorflow/tfjs';

export function convertDataToDisplayCoordinateFrame(
    tensorData: tf.Tensor,
    time: number,
    distributionWidth: number,
    displayAreaWidth: number,
    domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
){
    let data = tensorData.arraySync() as number[][]; // Convert to plain 2D array
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