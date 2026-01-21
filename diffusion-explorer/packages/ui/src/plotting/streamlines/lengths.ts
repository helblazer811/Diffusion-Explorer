/**
 * Streamline length computation utilities.
 *
 * Used by both CPU and GPU backends to compute cumulative arc lengths
 * along streamlines for animation purposes.
 */

/**
 * Compute cumulative lengths along a streamline (in pixel coordinates).
 *
 * @param streamline - Array of [x, y] points in pixel coordinates
 * @returns Object with segmentLengths, cumulativeLengths, and totalLength
 */
export function computeStreamlineLengths(streamline: number[][]): {
  segmentLengths: number[];
  cumulativeLengths: number[];
  totalLength: number;
} {
  const segmentLengths: number[] = [];
  const cumulativeLengths: number[] = [0];
  let totalLength = 0;

  for (let i = 1; i < streamline.length; i++) {
    const dx = streamline[i][0] - streamline[i - 1][0];
    const dy = streamline[i][1] - streamline[i - 1][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    segmentLengths.push(len);
    totalLength += len;
    cumulativeLengths.push(totalLength);
  }

  return { segmentLengths, cumulativeLengths, totalLength };
}
