// Data helpers for the masked-diffusion-on-text figure.
//
// We visualize the MDLM-style absorbing-state (mask) diffusion process on a
// short TinyStories-voice paragraph. Everything here is deterministic and
// SSR-safe (no Math.random, no Date.now) so the server and client agree on
// the initial render.

/** A short TinyStories-style paragraph, hand-written for the figure. */
export const TINY_STORY =
	'Once there was a little cat named Milo who lived in a tall red house. ' +
	'Every morning Milo would sit by the window and watch the birds fly. ' +
	'One day a small yellow bird landed on the sill and chirped hello.';

export interface Tokenized {
	/** The word tokens themselves (no leading whitespace or punctuation). */
	tokens: string[];
	/**
	 * The literal text that appears before each token in the original string
	 * (leading whitespace, opening quotes, etc.). Same length as `tokens`.
	 */
	leading: string[];
	/**
	 * The literal text that appears after each token before the next one
	 * (trailing punctuation and whitespace). Same length as `tokens`; the last
	 * entry may include the paragraph-final punctuation.
	 */
	trailing: string[];
}

/**
 * Split `text` into tokens while preserving whitespace so the paragraph can be
 * re-rendered faithfully whether each slot is showing its original content or
 * the sentinel `[MASK]`. Two token flavors are extracted:
 *
 *   - words: maximal runs of letters/digits/apostrophes;
 *   - punctuation: maximal runs of non-word, non-whitespace characters (`.` `,`
 *     `?` `!` `"` etc.) — each punctuation run is its own token, so periods
 *     etc. can flip to `[MASK]` independently of the words they follow.
 *
 * Whitespace is not tokenized; it lives in each token's `leading` slot so
 * re-rendering preserves the original spacing.
 */
export function tokenize(text: string): Tokenized {
	const tokenRe = /[A-Za-z0-9']+|[^A-Za-z0-9'\s]+/g;
	const tokens: string[] = [];
	const leading: string[] = [];
	const trailing: string[] = [];
	let cursor = 0;
	let match: RegExpExecArray | null;
	while ((match = tokenRe.exec(text)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		leading.push(text.slice(cursor, start));
		tokens.push(match[0]);
		trailing.push('');
		cursor = end;
	}
	if (tokens.length > 0) {
		trailing[trailing.length - 1] = text.slice(cursor);
	}
	return { tokens, leading, trailing };
}

/**
 * Build a deterministic mask-order permutation of [0, n): the order in which
 * tokens get masked during the forward process (and un-masked during the
 * reverse). Uses a tiny seeded LCG + Fisher-Yates so successive calls with
 * the same seed produce identical schedules on server and client.
 */
export function buildMaskSchedule(n: number, seed: number): number[] {
	const order = Array.from({ length: n }, (_, i) => i);
	let state = (seed | 0) >>> 0;
	// Numerical Recipes LCG constants; keep arithmetic in 32-bit range.
	const step = () => {
		state = (Math.imul(state + 1, 1103515245) + 12345) >>> 0;
		return state;
	};
	for (let i = n - 1; i > 0; i--) {
		const j = step() % (i + 1);
		const tmp = order[i];
		order[i] = order[j];
		order[j] = tmp;
	}
	return order;
}

// ============================================================================
// Faithful MDLM forward process (merged from lib/masked_diffusion/masked_diffusion.ts)
// ============================================================================

// Faithful masked-diffusion forward process (MDLM / SEDD-style absorbing
// diffusion), decoupled from any rendering concern.
//
// Continuous-time forward process on a length-N discrete sequence:
//
//     p(x_t | x_0) = ∏_i [ (1 - α(t)) · δ(x^i_t = x^i_0)   +   α(t) · δ(x^i_t = [MASK]) ]
//
// i.e. at time t, token i is masked *independently* with probability α(t),
// where α: [0, 1] → [0, 1] is a monotone schedule with α(0) = 0, α(1) = 1.
// Each token has its own mask time; the CDF of that random time is exactly α.
//
// The generative sampling story that follows from this:
//
//   Sample u_i ~ Uniform(0, 1) independently per token.
//   Token i is masked at time t   iff   α(t) > u_i.
//
// So we precompute the u_i once (seeded, SSR-safe), and the forward process at
// any t is a pure function of t (no per-tick RNG). Multiple tokens can flip in
// the same infinitesimal window when their u_i's are clustered — this is the
// key qualitative difference from a strict "one-token-per-step" schedule.

import { pickIndex } from './trajectories';

// -----------------------------------------------------------------------------
// Noise schedules α(t): [0, 1] → [0, 1], monotone, α(0) = 0, α(1) = 1.
// -----------------------------------------------------------------------------

export type Schedule = (t: number) => number;

/** α(t) = t — every token has a uniform mask time. */
export const linearSchedule: Schedule = (t) => t;

/** α(t) = 1 − cos(π t / 2) — mainstream absorbing-diffusion default. */
export const cosineSchedule: Schedule = (t) => 1 - Math.cos((Math.PI * t) / 2);

/** α(t) = sin(π t / 2) — front-heavy; mirror image of cosine. */
export const sineSchedule: Schedule = (t) => Math.sin((Math.PI * t) / 2);

// -----------------------------------------------------------------------------
// Per-token flip-time draws u_i ~ Uniform(0, 1), deterministic in `seed`.
// Chained through the same 32-bit LCG we use elsewhere for SSR-safety.
// -----------------------------------------------------------------------------

const BIG = 1 << 30;

/**
 * Draw n independent Uniform(0, 1) samples deterministically from `seed`.
 * These are the per-token "mask times" for a linear schedule; for any other
 * α, invert it to get the actual mask instant via `t_i = α⁻¹(u_i)`.
 */
export function drawFlipUniforms(n: number, seed: number): number[] {
	const out = new Array<number>(n);
	let s = (seed | 0) >>> 0;
	for (let i = 0; i < n; i++) {
		s = pickIndex(s, BIG);
		out[i] = (s + 1) / (BIG + 1);
	}
	return out;
}

// -----------------------------------------------------------------------------
// Forward process at a single time.
//
// Given per-token flip-uniforms `uniforms[i]` and a schedule α:
//   token i is MASKED at time t iff α(t) > uniforms[i].
// -----------------------------------------------------------------------------

/**
 * Return a boolean mask over the sequence: `masked[i] === true` iff token i
 * is masked at time t under the given schedule.
 *
 * At t=0: α(0) = 0, so 0 > u_i is false ∀ i → nothing masked (data).
 * At t=1: α(1) = 1, so 1 > u_i is true ∀ i (u_i < 1 a.s.) → everything masked.
 */
export function maskAt(
	uniforms: number[],
	t: number,
	schedule: Schedule = linearSchedule
): boolean[] {
	const alpha = schedule(t);
	const out = new Array<boolean>(uniforms.length);
	for (let i = 0; i < uniforms.length; i++) {
		out[i] = alpha > uniforms[i];
	}
	return out;
}

/**
 * The mask-instant `t_i ∈ [0, 1]` at which token i first flips to `[MASK]`
 * under the given schedule. Equivalent to `α⁻¹(u_i)` when α is invertible;
 * for schedules provided in this file we implement the inverse in closed form
 * so the caller doesn't need one.
 *
 * With a linear schedule this is just `u_i` itself; for cosine it's
 * `(2/π) · arccos(1 − u_i)`; for sine it's `(2/π) · arcsin(u_i)`.
 */
export function flipInstant(
	uniform: number,
	schedule: Schedule = linearSchedule
): number {
	if (schedule === cosineSchedule) return (2 / Math.PI) * Math.acos(1 - uniform);
	if (schedule === sineSchedule) return (2 / Math.PI) * Math.asin(uniform);
	// Linear (and default): identity.
	return uniform;
}

/**
 * Number of tokens masked at time t. Equivalent to `maskAt(uniforms, t).filter(Boolean).length`
 * but avoids the intermediate array — useful for animation reveal counts.
 */
export function maskedCountAt(
	uniforms: number[],
	t: number,
	schedule: Schedule = linearSchedule
): number {
	const alpha = schedule(t);
	let count = 0;
	for (let i = 0; i < uniforms.length; i++) {
		if (alpha > uniforms[i]) count++;
	}
	return count;
}
