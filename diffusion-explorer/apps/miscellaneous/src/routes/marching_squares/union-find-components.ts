/**
 * Union-Find with incremental connected component tracking for marching squares.
 * Tracks components as cells are added one by one.
 */

export interface CellInfo {
  row: number;
  col: number;
  caseIndex: number;
  polygon: [number, number][];
}

export class IncrementalComponentTracker {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();
  private cellData: Map<string, CellInfo> = new Map();

  private cellKey(row: number, col: number): string {
    return `${row},${col}`;
  }

  // Find with path compression
  find(key: string): string {
    if (!this.parent.has(key)) return key;
    const p = this.parent.get(key)!;
    if (p === key) return key;
    const root = this.find(p);
    this.parent.set(key, root); // path compression
    return root;
  }

  // Union by rank
  union(key1: string, key2: string): void {
    const root1 = this.find(key1);
    const root2 = this.find(key2);
    if (root1 === root2) return;

    const rank1 = this.rank.get(root1) ?? 0;
    const rank2 = this.rank.get(root2) ?? 0;

    if (rank1 < rank2) {
      this.parent.set(root1, root2);
    } else if (rank1 > rank2) {
      this.parent.set(root2, root1);
    } else {
      this.parent.set(root2, root1);
      this.rank.set(root1, rank1 + 1);
    }
  }

  // Add cell and union with existing neighbors
  addCell(cell: CellInfo): void {
    const key = this.cellKey(cell.row, cell.col);
    this.parent.set(key, key);
    this.rank.set(key, 0);
    this.cellData.set(key, cell);

    // Check 4-connected neighbors
    const neighbors = [
      [cell.row - 1, cell.col], // up
      [cell.row + 1, cell.col], // down
      [cell.row, cell.col - 1], // left
      [cell.row, cell.col + 1], // right
    ];

    for (const [nr, nc] of neighbors) {
      const neighborKey = this.cellKey(nr, nc);
      if (this.cellData.has(neighborKey)) {
        this.union(key, neighborKey);
      }
    }
  }

  // Get all cells in a component (by any member's key)
  getComponentCells(key: string): CellInfo[] {
    const root = this.find(key);
    const cells: CellInfo[] = [];

    for (const [cellKey, cellInfo] of this.cellData) {
      if (this.find(cellKey) === root) {
        cells.push(cellInfo);
      }
    }

    return cells;
  }

  // Get all unique components
  getAllComponents(): Map<string, CellInfo[]> {
    const components = new Map<string, CellInfo[]>();

    for (const [key, cell] of this.cellData) {
      const root = this.find(key);
      if (!components.has(root)) {
        components.set(root, []);
      }
      components.get(root)!.push(cell);
    }

    return components;
  }

  // Clear all data
  clear(): void {
    this.parent.clear();
    this.rank.clear();
    this.cellData.clear();
  }
}
