import { TimelineBuilder } from '@helblazer811/tempus';

// Shared 4-clip timeline for ForwardReverseFigure: forward leg → hold at noise
// → reverse leg → hold at data. `u ∈ [0, 2]` encodes which leg we're on; the
// figure folds it to a 0 → 1 → 0 triangle wave on `progress` for rendering.
export interface ForwardReverseState {
	u: number;
}

export const FORWARD_REVERSE_HALF_MS = 5440; // forward or reverse leg duration
export const FORWARD_REVERSE_HOLD_MS = 1530; // hold at each endpoint
export const FORWARD_REVERSE_TOTAL_MS =
	FORWARD_REVERSE_HALF_MS * 2 + FORWARD_REVERSE_HOLD_MS * 2;

export function buildForwardReverseTimeline() {
	const forwardClip = {
		name: 'forward',
		reduce(t: number): Partial<ForwardReverseState> {
			return { u: t };
		}
	};
	const holdNoiseClip = {
		name: 'hold-noise',
		reduce(_t: number): Partial<ForwardReverseState> {
			return { u: 1 };
		}
	};
	const reverseClip = {
		name: 'reverse',
		reduce(t: number): Partial<ForwardReverseState> {
			return { u: 1 + t };
		}
	};
	const holdDataClip = {
		name: 'hold-data',
		reduce(_t: number): Partial<ForwardReverseState> {
			return { u: 0 };
		}
	};
	return new TimelineBuilder<ForwardReverseState>()
		.setInitialState({ u: 0 })
		.add(forwardClip, { durationMs: FORWARD_REVERSE_HALF_MS })
		.add(holdNoiseClip, { durationMs: FORWARD_REVERSE_HOLD_MS })
		.add(reverseClip, { durationMs: FORWARD_REVERSE_HALF_MS })
		.add(holdDataClip, { durationMs: FORWARD_REVERSE_HOLD_MS })
		.build();
}
