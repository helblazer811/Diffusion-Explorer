// Pure, SSR-safe data layer for the flow-trajectory figure.
//
// Owns the contract with the cached artifact at
// `static/flow/flow_matching_trajectories.json` (served at
// `/flow/flow_matching_trajectories.json`): a 3-D array of shape
// `[numTrajectories][numSteps+1][2]` of world-space coordinates. The first
// point of each trajectory is a SOURCE sample (~N(0,I)); the last is a TARGET
// sample (one of two Gaussian blobs). The expensive flow-matching training +
// integration happened offline — at runtime we only parse + replay this JSON.
//
// Everything here is side-effect-free and deterministic (no RNG), so SSR and
// the client agree and tap-to-generate is reproducible.

export interface Vec2 {
	x: number;
	y: number;
}

/** A single sample trajectory ψ_t(x): source point at t=0 → target at t=1. */
export type Trajectory = Vec2[];

/** Raw JSON schema: trajectories[i][k] = [x, y]. */
export type RawTrajectories = number[][][];

/**
 * World region the figure is drawn over. The renderer places the clouds
 * side-by-side (source on the LEFT, target on the RIGHT) by panning along x, so
 * the x-extent must hold the source (~N(0,I), tails ~±2.5) shifted left by
 * PAN_X and the target blobs shifted right by PAN_X — a wide window. y stays
 * tight (~±2.6) since the pan is horizontal only.
 */
export const FLOW_DOMAIN = { xmin: -5.6, xmax: 5.6, ymin: -3.1, ymax: 3.1 };

/** Adapt the raw `[x,y]` JSON into typed `Vec2[]` trajectories. Pure. */
export function parseTrajectories(raw: RawTrajectories): Trajectory[] {
	return raw.map((traj) => traj.map(([x, y]) => ({ x, y })));
}

/** Source-sample cloud: the first point of every trajectory (t=0). Pure. */
export function sourcePoints(trajectories: Trajectory[]): Vec2[] {
	return trajectories.map((t) => t[0]);
}

/** Target-sample cloud: the last point of every trajectory (t=1). Pure. */
export function targetPoints(trajectories: Trajectory[]): Vec2[] {
	return trajectories.map((t) => t[t.length - 1]);
}

/**
 * Deterministic "next sample" picker for tap-to-generate. A small LCG step so
 * successive taps wander through the pool pseudo-randomly (rather than the
 * obvious +1 march) while staying RNG-free and reproducible. Returns an index
 * in [0, total).
 */
export function pickIndex(prev: number, total: number): number {
	if (total <= 0) return 0;
	// Numerical Recipes LCG constants; keep the arithmetic in 32-bit range.
	const next = (Math.imul(prev + 1, 1103515245) + 12345) >>> 0;
	return next % total;
}
