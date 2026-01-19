/**
 * Shared utilities for LIC and DLIC computation.
 */

import type { LICResult, LICColorOptions, LICDomain, VectorFieldFn } from './types';

/**
 * Evaluate a vector field function on a grid and store in a Float32Array buffer.
 * This pre-computes the vector field on CPU so the GPU shader can sample from it.
 */
export function evaluateVectorFieldToBuffer(
  vectorField: VectorFieldFn,
  width: number,
  height: number,
  domain: LICDomain
): Float32Array {
  const buffer = new Float32Array(width * height * 2);

  const xScale = (domain.xMax - domain.xMin) / width;
  const yScale = (domain.yMax - domain.yMin) / height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Map pixel center to world coordinates
      const worldX = domain.xMin + (x + 0.5) * xScale;
      const worldY = domain.yMin + (y + 0.5) * yScale;

      const [vx, vy] = vectorField(worldX, worldY);

      // Convert world-space velocity to pixel-space velocity
      const pxVx = vx / xScale;
      const pxVy = vy / yScale;

      const idx = (y * width + x) * 2;
      buffer[idx] = pxVx;
      buffer[idx + 1] = pxVy;
    }
  }

  return buffer;
}

/**
 * Create an LICResult object from raw output data.
 */
export function createLICResult(
  data: Float32Array,
  magnitude: Float32Array,
  width: number,
  height: number
): LICResult {
  return {
    data,
    magnitude,
    width,
    height,

    toImageData(): ImageData {
      const imageData = new ImageData(width, height);
      const pixels = imageData.data;

      for (let i = 0; i < data.length; i++) {
        const value = Math.round(data[i] * 255);
        const pixelIdx = i * 4;
        pixels[pixelIdx] = value;     // R
        pixels[pixelIdx + 1] = value; // G
        pixels[pixelIdx + 2] = value; // B
        pixels[pixelIdx + 3] = 255;   // A
      }

      return imageData;
    },

    toColoredImageData(options: LICColorOptions): ImageData {
      const { palette, minMagnitude, maxMagnitude, backgroundColor = [0, 0, 0] } = options;
      const [bgR, bgG, bgB] = backgroundColor;

      // Find magnitude range if not provided
      let minMag = minMagnitude;
      let maxMag = maxMagnitude;

      if (minMag === undefined || maxMag === undefined) {
        let dataMin = Infinity;
        let dataMax = -Infinity;
        for (let i = 0; i < magnitude.length; i++) {
          const m = magnitude[i];
          if (m < dataMin) dataMin = m;
          if (m > dataMax) dataMax = m;
        }
        minMag = minMag ?? dataMin;
        maxMag = maxMag ?? dataMax;
      }

      const magRange = maxMag - minMag;
      const imageData = new ImageData(width, height);
      const pixels = imageData.data;

      for (let i = 0; i < data.length; i++) {
        const intensity = data[i];
        const mag = magnitude[i];

        // Normalize magnitude to [0, 1]
        const normalizedMag = magRange > 0 ? (mag - minMag) / magRange : 0.5;

        // Get color from palette
        const [r, g, b] = palette(normalizedMag);

        // Blend between background color and palette color based on intensity
        const pixelIdx = i * 4;
        pixels[pixelIdx] = Math.round(bgR + (r - bgR) * intensity);     // R
        pixels[pixelIdx + 1] = Math.round(bgG + (g - bgG) * intensity); // G
        pixels[pixelIdx + 2] = Math.round(bgB + (b - bgB) * intensity); // B
        pixels[pixelIdx + 3] = 255;                                     // A
      }

      return imageData;
    },

    async toImageBitmap(): Promise<ImageBitmap> {
      const imageData = this.toImageData();
      return createImageBitmap(imageData);
    }
  };
}
