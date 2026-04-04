/**
 * Hungarian algorithm (Kuhn-Munkres) for minimum-cost assignment.
 * Given an n×n cost matrix, returns the optimal column assignment for each row.
 * O(n³) time complexity.
 */
export function hungarian(cost: Float64Array, n: number): Int32Array {
  const u = new Float64Array(n + 1); // row potentials
  const v = new Float64Array(n + 1); // col potentials
  const p = new Int32Array(n + 1);   // col -> row assignment
  const way = new Int32Array(n + 1); // augmenting path

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);

    do {
      used[j0] = 1;
      let i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;

      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[(i0 - 1) * n + (j - 1)] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    // Trace back augmenting path
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  // Build row -> col assignment
  const assignment = new Int32Array(n);
  for (let j = 1; j <= n; j++) {
    assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

/**
 * Reorder `target` points to optimally match `source` points
 * using Hungarian algorithm on squared Euclidean distance.
 */
export function matchHungarian(source: number[][], target: number[][]): number[][] {
  const n = source.length;

  // Build cost matrix (squared distances)
  const cost = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const [sx, sy] = source[i];
    for (let j = 0; j < n; j++) {
      const dx = target[j][0] - sx;
      const dy = target[j][1] - sy;
      cost[i * n + j] = dx * dx + dy * dy;
    }
  }

  const assignment = hungarian(cost, n);

  const reordered: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    reordered[i] = target[assignment[i]];
  }
  return reordered;
}
