// Playback helpers for the Sudoku panel of the thesis figure.
//
// The JSON at static/data/sudoku_thesis.json is a copy of the FlowMapReasoning
// interactive_blog's sudoku_uncertainty_correct.json — an offline capture of
// one puzzle's per-step per-cell probability trajectory from the trained flow
// model. Shape:
//
//   { meta, clueMask: number[81], solution: number[81],
//     steps: [{ step: number, probs: number[81][9] }] }
//
// The panel plays this back in "correctness" mode: at each stepIndex we take
// the argmax digit per cell and render it green if it matches `solution`, red
// if it doesn't. Cells listed in `clueMask` stay as-given.

/** Per-cell distribution over digits 1..9. Shape: [81][9]. */
export type CellProbs = number[][];

/** A single candidate digit to render in a cell, with its display opacity. */
export interface Candidate {
	digit: number;
	p: number;
	opacity: number;
}

/**
 * Map one cell's 9-way distribution to a candidate list for uncertainty-mode
 * rendering. Copied verbatim from FlowMapReasoning/interactive_blog/src/lib/
 * sudoku_uncertainty.ts so SudokuGrid.svelte (duplicated into this folder)
 * can resolve `import { cellCandidates } from './sudoku_playback'`.
 *
 * The thesis panel runs in correctness mode, not uncertainty mode, so this
 * function isn't exercised — but SudokuGrid imports it unconditionally.
 */
export function cellCandidates(
	row: number[] | undefined,
	{ eps = 0.02, minOpacity = 0.08 }: { eps?: number; minOpacity?: number } = {}
): Candidate[] {
	if (!row) return [];
	const out: Candidate[] = [];
	for (let d = 0; d < 9; d++) {
		const p = row[d] ?? 0;
		if (p <= eps) continue;
		const opacity = Math.min(1, Math.max(minOpacity, p));
		out.push({ digit: d + 1, p, opacity });
	}
	return out;
}

// ============================================================================
// Playback-specific pieces
// ============================================================================

export interface SudokuStep {
	step: number;
	probs: CellProbs;
}

export interface SudokuThesisData {
	meta: Record<string, unknown>;
	clueMask: number[];
	solution: number[];
	steps: SudokuStep[];
}

/**
 * Argmax digit per cell for a single step. Returns a length-81 array of
 * 1..9 digits (or the argmax + 1; ties broken by lowest index, which is
 * what a plain Array.reduce gives us).
 */
export function argmaxDigits(probs: CellProbs): number[] {
	const out = new Array<number>(probs.length);
	for (let c = 0; c < probs.length; c++) {
		const row = probs[c];
		let best = 0;
		let bestP = row[0] ?? 0;
		for (let d = 1; d < row.length; d++) {
			if (row[d] > bestP) {
				bestP = row[d];
				best = d;
			}
		}
		out[c] = best + 1;
	}
	return out;
}
