/**
 * Marching Squares Algorithm Implementation
 *
 * Given a continuous function over a 2D space and a threshold value,
 * this algorithm identifies contour cells and returns polygon data
 * for rendering.
 */

/**
 * The 16 possible marching squares cases.
 * Each case is represented by 4 bits (one per corner):
 *   TL TR BR BL (top-left, top-right, bottom-right, bottom-left)
 * A bit is 1 if the corner is above the threshold, 0 otherwise.
 *
 * Corner layout:
 *   TL ---- TR
 *   |       |
 *   |       |
 *   BL ---- BR
 *
 * Edge indices:
 *   top: 0, right: 1, bottom: 2, left: 3
 */

export type Point = [number, number];

export interface MarchingSquaresCell {
  /** Index 0-15 identifying which of the 16 cases this cell matches */
  caseIndex: number;
  /** Polygon vertices in normalized cell coordinates (0 to 1) */
  polygon: Point[];
  /** Whether this cell contains any filled region */
  isFilled: boolean;
}

/**
 * Edge midpoint positions in normalized cell coordinates.
 * Used to construct polygons for each case.
 */
const EDGE_MIDPOINTS: Record<string, Point> = {
  top: [0.5, 0],      // Top edge midpoint
  right: [1, 0.5],    // Right edge midpoint
  bottom: [0.5, 1],   // Bottom edge midpoint
  left: [0, 0.5],     // Left edge midpoint
};

/** Corner positions in normalized cell coordinates */
const CORNERS: Record<string, Point> = {
  tl: [0, 0],         // Top-left
  tr: [1, 0],         // Top-right
  br: [1, 1],         // Bottom-right
  bl: [0, 1],         // Bottom-left
};

/**
 * Polygon definitions for each of the 16 marching squares cases.
 * Each polygon is an array of points (corners and/or edge midpoints).
 * Points are listed in clockwise order.
 *
 * Case numbering uses binary encoding:
 *   bit 3: top-left (8)
 *   bit 2: top-right (4)
 *   bit 1: bottom-right (2)
 *   bit 0: bottom-left (1)
 */
const CASE_POLYGONS: Point[][] = [
  // Case 0: 0000 - All corners below threshold (empty)
  [],

  // Case 1: 0001 - Only bottom-left above threshold
  [CORNERS.bl, EDGE_MIDPOINTS.left, EDGE_MIDPOINTS.bottom],

  // Case 2: 0010 - Only bottom-right above threshold
  [CORNERS.br, EDGE_MIDPOINTS.bottom, EDGE_MIDPOINTS.right],

  // Case 3: 0011 - Bottom-left and bottom-right above (horizontal band at bottom)
  [CORNERS.bl, EDGE_MIDPOINTS.left, EDGE_MIDPOINTS.right, CORNERS.br],

  // Case 4: 0100 - Only top-right above threshold
  [CORNERS.tr, EDGE_MIDPOINTS.right, EDGE_MIDPOINTS.top],

  // Case 5: 0101 - Top-right and bottom-left above (saddle point - ambiguous)
  // Using the convention where we connect same-valued corners
  [CORNERS.tr, EDGE_MIDPOINTS.right, EDGE_MIDPOINTS.bottom, CORNERS.bl, EDGE_MIDPOINTS.left, EDGE_MIDPOINTS.top],

  // Case 6: 0110 - Top-right and bottom-right above (vertical band on right)
  [CORNERS.tr, EDGE_MIDPOINTS.top, EDGE_MIDPOINTS.bottom, CORNERS.br],

  // Case 7: 0111 - All except top-left above
  [CORNERS.tr, EDGE_MIDPOINTS.top, EDGE_MIDPOINTS.left, CORNERS.bl, CORNERS.br],

  // Case 8: 1000 - Only top-left above threshold
  [CORNERS.tl, EDGE_MIDPOINTS.top, EDGE_MIDPOINTS.left],

  // Case 9: 1001 - Top-left and bottom-left above (vertical band on left)
  [CORNERS.tl, EDGE_MIDPOINTS.top, EDGE_MIDPOINTS.bottom, CORNERS.bl],

  // Case 10: 1010 - Top-left and bottom-right above (saddle point - ambiguous)
  // Using the convention where we connect same-valued corners
  [CORNERS.tl, EDGE_MIDPOINTS.left, EDGE_MIDPOINTS.bottom, CORNERS.br, EDGE_MIDPOINTS.right, EDGE_MIDPOINTS.top],

  // Case 11: 1011 - All except top-right above
  [CORNERS.tl, EDGE_MIDPOINTS.top, EDGE_MIDPOINTS.right, CORNERS.br, CORNERS.bl],

  // Case 12: 1100 - Top-left and top-right above (horizontal band at top)
  [CORNERS.tl, CORNERS.tr, EDGE_MIDPOINTS.right, EDGE_MIDPOINTS.left],

  // Case 13: 1101 - All except bottom-right above
  [CORNERS.tl, CORNERS.tr, EDGE_MIDPOINTS.right, EDGE_MIDPOINTS.bottom, CORNERS.bl],

  // Case 14: 1110 - All except bottom-left above
  [CORNERS.tl, CORNERS.tr, CORNERS.br, EDGE_MIDPOINTS.bottom, EDGE_MIDPOINTS.left],

  // Case 15: 1111 - All corners above threshold (full cell)
  [CORNERS.tl, CORNERS.tr, CORNERS.br, CORNERS.bl],
];

/**
 * Determines which marching squares case a cell belongs to based on corner values.
 *
 * @param tl - Top-left corner value
 * @param tr - Top-right corner value
 * @param br - Bottom-right corner value
 * @param bl - Bottom-left corner value
 * @param threshold - The threshold value for the contour
 * @returns The case index (0-15)
 */
export function getCaseIndex(
  tl: number,
  tr: number,
  br: number,
  bl: number,
  threshold: number
): number {
  let index = 0;
  if (tl >= threshold) index |= 8;  // bit 3
  if (tr >= threshold) index |= 4;  // bit 2
  if (br >= threshold) index |= 2;  // bit 1
  if (bl >= threshold) index |= 1;  // bit 0
  return index;
}

/**
 * Gets the polygon for a marching squares cell.
 *
 * @param caseIndex - The case index (0-15)
 * @returns The polygon vertices in normalized cell coordinates
 */
export function getCasePolygon(caseIndex: number): Point[] {
  if (caseIndex < 0 || caseIndex > 15) {
    return [];
  }
  return CASE_POLYGONS[caseIndex];
}

/**
 * Gets the marching squares cell data for given corner values.
 *
 * @param tl - Top-left corner value
 * @param tr - Top-right corner value
 * @param br - Bottom-right corner value
 * @param bl - Bottom-left corner value
 * @param threshold - The threshold value for the contour
 * @returns The cell data including case index and polygon
 */
export function getMarchingSquaresCell(
  tl: number,
  tr: number,
  br: number,
  bl: number,
  threshold: number
): MarchingSquaresCell {
  const caseIndex = getCaseIndex(tl, tr, br, bl, threshold);
  const polygon = getCasePolygon(caseIndex);

  return {
    caseIndex,
    polygon,
    isFilled: polygon.length > 0,
  };
}

/**
 * Generates all 16 marching squares case polygons for reference display.
 * Useful for showing the lookup table visualization.
 *
 * @returns Array of 16 polygons, one for each case
 */
export function getAllCasePolygons(): Point[][] {
  return [...CASE_POLYGONS];
}

/**
 * Computes marching squares for an entire grid.
 *
 * @param evalFn - Function that evaluates the value at a given (x, y) position
 * @param gridWidth - Number of cells horizontally
 * @param gridHeight - Number of cells vertically
 * @param domain - The domain [xMin, xMax, yMin, yMax] to evaluate over
 * @param threshold - The threshold value for the contour
 * @returns 2D array of cell data indexed by [row][col]
 */
export function computeMarchingSquaresGrid(
  evalFn: (x: number, y: number) => number,
  gridWidth: number,
  gridHeight: number,
  domain: [number, number, number, number],
  threshold: number
): MarchingSquaresCell[][] {
  const [xMin, xMax, yMin, yMax] = domain;
  const cellWidth = (xMax - xMin) / gridWidth;
  const cellHeight = (yMax - yMin) / gridHeight;

  const result: MarchingSquaresCell[][] = [];

  // Create a cached grid of evaluated values at cell corners
  // We need (gridWidth + 1) x (gridHeight + 1) corner values
  const cornerValues: number[][] = [];
  for (let row = 0; row <= gridHeight; row++) {
    cornerValues[row] = [];
    for (let col = 0; col <= gridWidth; col++) {
      const x = xMin + col * cellWidth;
      const y = yMin + row * cellHeight;
      cornerValues[row][col] = evalFn(x, y);
    }
  }

  // Compute cell data for each cell
  for (let row = 0; row < gridHeight; row++) {
    result[row] = [];
    for (let col = 0; col < gridWidth; col++) {
      const tl = cornerValues[row][col];
      const tr = cornerValues[row][col + 1];
      const bl = cornerValues[row + 1][col];
      const br = cornerValues[row + 1][col + 1];

      result[row][col] = getMarchingSquaresCell(tl, tr, br, bl, threshold);
    }
  }

  return result;
}

/**
 * Describes which corners are filled for a given case index.
 * Useful for displaying corner indicators.
 */
export function getCaseCornerStates(caseIndex: number): {
  tl: boolean;
  tr: boolean;
  br: boolean;
  bl: boolean;
} {
  return {
    tl: (caseIndex & 8) !== 0,
    tr: (caseIndex & 4) !== 0,
    br: (caseIndex & 2) !== 0,
    bl: (caseIndex & 1) !== 0,
  };
}
