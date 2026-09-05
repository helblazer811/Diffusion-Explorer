export type Point = { x: number; y: number };

function mulberry32(seed: number): () => number {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function gaussian(random: () => number): number {
	const u = Math.max(random(), 1e-9);
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function createTwoMoons(count: number, seed = 481516): Point[] {
	const random = mulberry32(seed);
	return Array.from({ length: count }, (_, index) => {
		const lower = index % 2 === 1;
		const theta = random() * Math.PI;
		const center = lower
			? { x: 0.58 - 1.55 * Math.cos(theta), y: -0.08 - Math.sin(theta) }
			: { x: -0.58 + 1.55 * Math.cos(theta), y: 0.08 + Math.sin(theta) };
		return { x: center.x + gaussian(random) * 0.06, y: center.y + gaussian(random) * 0.06 };
	});
}

export function createInitialPoints(count: number, seed = 20260904): Point[] {
	const random = mulberry32(seed);
	return Array.from({ length: count }, () => ({ x: gaussian(random), y: gaussian(random) }));
}

export function transposeTrajectories(samples: number[][][]): Point[][] {
	if (samples.length === 0) return [];
	return samples[0].map((_, particleIndex) =>
		samples.map((step) => ({ x: step[particleIndex][0], y: step[particleIndex][1] }))
	);
}
