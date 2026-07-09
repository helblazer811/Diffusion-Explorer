// Pure, SSR-safe helpers for the smiley-face DDPM/VP-SDE figure.
//
// Everything here is deterministic (seeded LCG, no Math.random / Date.now) so
// server and client agree on the initial render.

import type { Vec2 } from './trajectories';
import { pickIndex } from './trajectories';

// -----------------------------------------------------------------------------
// Seeded Gaussian draws (Box–Muller). Same shape as softmax_flow.ts's inline
// helper; we copy it here so this module has no cross-flow-module dependency.
// -----------------------------------------------------------------------------

/** Draw one standard-normal pair via Box–Muller; returns the next LCG state. */
export function seededGaussianPair(seed: number): {
	u: number;
	v: number;
	state: number;
} {
	const BIG = 1 << 30;
	// pickIndex takes (prev, total) and returns next value modulo total; we use
	// it as our LCG step and then map the integer to (0, 1).
	const a = pickIndex(seed, BIG);
	const b = pickIndex(a, BIG);
	// Guard against 0 (log(0) = -inf).
	const r1 = (a + 1) / (BIG + 1);
	const r2 = (b + 1) / (BIG + 1);
	const radius = Math.sqrt(-2 * Math.log(r1));
	const angle = 2 * Math.PI * r2;
	return { u: radius * Math.cos(angle), v: radius * Math.sin(angle), state: b };
}

/** Draw a single N(0,I) 2-vector (chains through the seed state). */
export function seededGaussian2(seed: number): { p: Vec2; state: number } {
	const { u, v, state } = seededGaussianPair(seed);
	return { p: { x: u, y: v }, state };
}

/** Deterministic Gaussian cloud of `n` 2-D samples for the "noise" side. */
export function gaussianCloud(n: number, seed: number, sigma = 1): Vec2[] {
	const out: Vec2[] = [];
	let s = seed >>> 0;
	for (let i = 0; i < n; i++) {
		const { p, state } = seededGaussian2(s);
		s = state;
		out.push({ x: sigma * p.x, y: sigma * p.y });
	}
	return out;
}

// -----------------------------------------------------------------------------
// Smiley post-processing: subsample the loaded point cloud and add a small
// Gaussian jitter — larger on the eye/mouth points (which live in a specific
// upper-y band) than on the face outline. All deterministic in `seed`.
// -----------------------------------------------------------------------------

export function jitterAndSubsampleSmiley(
	pts: Vec2[],
	seed: number,
	{
		keep = 0.75,
		outlineSigma = 0.02,
		featureSigma = 0.09,
		// Eyes/mouth region in the smiley_face.json dataset lives roughly in
		// y ∈ [-1.3, -0.4]. The rest is face outline.
		featureYMin = -1.3,
		featureYMax = -0.4
	}: {
		keep?: number;
		outlineSigma?: number;
		featureSigma?: number;
		featureYMin?: number;
		featureYMax?: number;
	} = {}
): Vec2[] {
	if (!pts.length) return pts;
	// Deterministic Fisher–Yates shuffle → keep first `keep · N`.
	const shuffled = pts.slice();
	let s = seed >>> 0;
	for (let i = shuffled.length - 1; i > 0; i--) {
		s = pickIndex(s, i + 1);
		const j = s;
		const tmp = shuffled[i];
		shuffled[i] = shuffled[j];
		shuffled[j] = tmp;
	}
	const keepN = Math.max(1, Math.floor(shuffled.length * keep));
	const kept = shuffled.slice(0, keepN);

	// Jitter each point; larger sigma on eye/mouth points.
	const out: Vec2[] = new Array(kept.length);
	for (let i = 0; i < kept.length; i++) {
		const p = kept[i];
		const inFeature = p.y >= featureYMin && p.y <= featureYMax;
		const sigma = inFeature ? featureSigma : outlineSigma;
		const { p: g, state } = seededGaussian2(s);
		s = state;
		out[i] = { x: p.x + sigma * g.x, y: p.y + sigma * g.y };
	}
	return out;
}

// -----------------------------------------------------------------------------
// Smiley target: face outline + eyes + mouth arc, roughly in [-1, 1]^2.
// Pure geometry; no RNG. Returns ~n points.
// -----------------------------------------------------------------------------

export function smileyPoints(n = 150): Vec2[] {
	const out: Vec2[] = [];
	const R = 1.0; // face radius
	const nFace = Math.round(n * 0.6); // ~60% of points on the outline
	for (let k = 0; k < nFace; k++) {
		const theta = (2 * Math.PI * k) / nFace;
		out.push({ x: R * Math.cos(theta), y: R * Math.sin(theta) });
	}
	// Eyes: two small filled disks at (±0.4R, +0.4R). ~8 points each on two rings.
	const eyeCenters = [
		{ x: -0.4 * R, y: 0.4 * R },
		{ x: 0.4 * R, y: 0.4 * R }
	];
	for (const c of eyeCenters) {
		out.push(c);
		for (let ring = 1; ring <= 2; ring++) {
			const rr = 0.05 * R * ring;
			const nRing = 6 * ring;
			for (let k = 0; k < nRing; k++) {
				const theta = (2 * Math.PI * k) / nRing;
				out.push({ x: c.x + rr * Math.cos(theta), y: c.y + rr * Math.sin(theta) });
			}
		}
	}
	// Mouth: an arc opening upward (a smile) at radius 0.55R, angles π + [π/6, 5π/6].
	const nMouth = Math.round(n * 0.15);
	const mouthR = 0.55 * R;
	const yOff = -0.05 * R;
	for (let k = 0; k < nMouth; k++) {
		const t = k / (nMouth - 1);
		const theta = Math.PI + (Math.PI / 6) + t * ((5 * Math.PI) / 6 - Math.PI / 6);
		out.push({ x: mouthR * Math.cos(theta), y: mouthR * Math.sin(theta) + yOff });
	}
	return out;
}

// -----------------------------------------------------------------------------
// VP-SDE forward sample path for ONE data point x_0. Discretizes the DDPM
// forward SDE
//   dx = -1/2 · beta(t) · x · dt + sqrt(beta(t)) · dW
// with a linear beta schedule (beta_min → beta_max) and Euler–Maruyama steps.
// The result is a Vec2[T+1] Brownian-looking path from x_0 at t=0 toward
// x_T ~ N(0, I) at t=1. Deterministic in `seed` so SSR agrees with client.
// -----------------------------------------------------------------------------

export function buildBrownianPath(
	x0: Vec2,
	seed: number,
	steps = 200,
	betaMin = 0.1,
	betaMax = 20
): Vec2[] {
	const path: Vec2[] = new Array(steps + 1);
	path[0] = { x: x0.x, y: x0.y };
	const dt = 1 / steps;
	let x = x0.x;
	let y = x0.y;
	let s = seed >>> 0;
	for (let k = 1; k <= steps; k++) {
		const t = k / steps;
		const beta = betaMin + t * (betaMax - betaMin);
		const drift = -0.5 * beta * dt;
		const diffusion = Math.sqrt(beta * dt);
		const { p, state } = seededGaussian2(s);
		s = state;
		x = x + drift * x + diffusion * p.x;
		y = y + drift * y + diffusion * p.y;
		path[k] = { x, y };
	}
	return path;
}
