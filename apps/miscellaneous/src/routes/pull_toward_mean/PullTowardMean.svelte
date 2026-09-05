<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { base } from '$app/paths';
	import { Figure, TimeSlider, TimelineInspector } from '@diffusion-explorer/ui';
	import {
		FlowModelClient,
		destroyWorkerPool,
		setPoolSize
	} from '@diffusion-explorer/diffusion';
	import {
		Player,
		TimelineBuilder,
		registerPlayerSource,
		registerRenderTarget,
		type Clip
	} from '@helblazer811/tempus';
	import { createInitialPoints, createTwoMoons, transposeTrajectories, type Point } from './diffusion';

	const WIDTH = 1600;
	const HEIGHT = 1000;
	const EXPORT_WIDTH = 1920;
	const EXPORT_HEIGHT = 1200;
	const PLOT = { left: 30, right: 1570, top: 24, bottom: 930 };
	const DOMAIN = { xMin: -2.5, xMax: 2.5, yMin: -1.4, yMax: 1.4 };
	const POINT_VERTICAL_OFFSET = 68;
	const target = createTwoMoons(420);
	const initialPoints = createInitialPoints(64);
	let trajectories: Point[][] = [];
	let splitProgress = 0.35;
	let loadError = '';

	type VisualState = { progress: number };
	const initialState: VisualState = { progress: 0 };

	function remapTime(t: number): number {
		// Give 64% of playback time to the path up to its closest approach to
		// the mean. The inward speed rises gently, eases down before the turn,
		// then increases again as the learned field resolves the two modes.
		const slowTimeShare = 0.64;
		if (t <= slowTimeShare) {
			const u = t / slowTimeShare;
			const inward =
				(0.85 * u + (0.65 * (1 - Math.cos(Math.PI * u))) / Math.PI - 0.125 * u * u) /
				(0.725 + 1.3 / Math.PI);
			return splitProgress * inward;
		}

		const u = (t - slowTimeShare) / (1 - slowTimeShare);
		const outward = 0.28 * u + 0.72 * u * u;
		return splitProgress + (1 - splitProgress) * outward;
	}

	const learnedFlow: Clip<VisualState> = {
		name: 'Learned flow through the mean',
		intent: 'accelerate inward, ease near the reversal, then accelerate toward both moons',
		reduce: (t) => ({ progress: remapTime(t) })
	};
	const endPause: Clip<VisualState> = {
		name: 'Pause on the data',
		intent: 'hold the completed two-moons distribution before the single replay',
		reduce: () => ({ progress: 1 })
	};

	const timeline = new TimelineBuilder<VisualState>()
		.setInitialState(initialState)
		.add(learnedFlow, { durationMs: 6825, id: 'learned-flow' })
		.add(endPause, { durationMs: 1170, id: 'end-pause' })
		.add(learnedFlow, { durationMs: 6825, id: 'learned-flow-replay' })
		.build();

	let canvas: HTMLCanvasElement;
	let player = $state(new Player(timeline, { looping: false }));
	let progress = $state(0);
	let unregisterTarget: (() => void) | undefined;
	let unregisterSource: (() => void) | undefined;

	function xPixel(x: number): number {
		return PLOT.left + ((x - DOMAIN.xMin) / (DOMAIN.xMax - DOMAIN.xMin)) * (PLOT.right - PLOT.left);
	}

	function yPixel(y: number): number {
		return (
			PLOT.bottom -
			((y - DOMAIN.yMin) / (DOMAIN.yMax - DOMAIN.yMin)) * (PLOT.bottom - PLOT.top) +
			POINT_VERTICAL_OFFSET
		);
	}

	function pointAt(trajectory: Point[], p: number): Point {
		const position = p * (trajectory.length - 1);
		const i = Math.min(Math.floor(position), trajectory.length - 2);
		const fraction = position - i;
		return {
			x: trajectory[i].x + (trajectory[i + 1].x - trajectory[i].x) * fraction,
			y: trajectory[i].y + (trajectory[i + 1].y - trajectory[i].y) * fraction
		};
	}

	function draw(state: VisualState) {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;

		ctx.setTransform(EXPORT_WIDTH / WIDTH, 0, 0, EXPORT_HEIGHT / HEIGHT, 0, 0);
		ctx.clearRect(0, 0, WIDTH, HEIGHT);
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, WIDTH, HEIGHT);

		// The target stays fixed and faint beneath the particles: one coordinate
		// system, rather than a translated source/target comparison.
		ctx.fillStyle = '#4a97df';
		for (const point of target) {
			ctx.globalAlpha = 0.27;
			ctx.beginPath();
			ctx.arc(xPixel(point.x), yPixel(point.y), 7.8, 0, Math.PI * 2);
			ctx.fill();
		}

		if (trajectories.length === 0) {
			ctx.globalAlpha = 1;
			ctx.fillStyle = loadError ? '#b42318' : '#6d7786';
			ctx.font = '600 17px Inter, ui-sans-serif, system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(loadError || 'LOADING TRAINED MODEL', WIDTH / 2, 974);
			return;
		}

		const endIndex = Math.max(0, Math.floor(state.progress * (trajectories[0].length - 1)));
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = '#ef7f32';
		ctx.lineWidth = 7.5;
		for (const trajectory of trajectories) {
			const tailStart = Math.max(0, endIndex - 54);
			ctx.globalAlpha = 0.24;
			ctx.beginPath();
			ctx.moveTo(xPixel(trajectory[tailStart].x), yPixel(trajectory[tailStart].y));
			for (let i = tailStart + 1; i <= endIndex; i++) ctx.lineTo(xPixel(trajectory[i].x), yPixel(trajectory[i].y));
			ctx.stroke();
		}

		ctx.fillStyle = '#ef7f32';
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 2.5;
		for (const trajectory of trajectories) {
			const point = pointAt(trajectory, state.progress);
			ctx.globalAlpha = 0.96;
			ctx.beginPath();
			ctx.arc(xPixel(point.x), yPixel(point.y), 10.8, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}

		ctx.globalAlpha = 1;
		ctx.fillStyle = '#434b58';
		ctx.font = '500 78px Inter, ui-sans-serif, system-ui, sans-serif';
		ctx.letterSpacing = '0px';
		ctx.textAlign = 'center';
		const phase = state.progress < splitProgress
			? 'High Noise → Predict the Mean'
			: 'Low Noise → Pull Towards Modes';
		const labelWidth = ctx.measureText(phase).width;
		ctx.fillStyle = 'rgba(255, 255, 255, 0.84)';
		ctx.beginPath();
		ctx.roundRect(WIDTH / 2 - labelWidth / 2 - 24, 24, labelWidth + 48, 104, 18);
		ctx.fill();
		ctx.fillStyle = '#434b58';
		ctx.fillText(phase, WIDTH / 2, 105);
		ctx.letterSpacing = '0px';
	}

	onMount(() => {
		let disposed = false;
		unregisterTarget = registerRenderTarget({ id: 'mean-attraction-16x10', el: canvas, kind: 'canvas' });
		unregisterSource = registerPlayerSource({
			id: 'mean-attraction-16x10',
			element: canvas,
			player
		});
		const unsubscribe = player.onTick((t, state) => {
			progress = t;
			draw(state);
		});
		draw(player.state);

		setPoolSize(1);
		const client = new FlowModelClient(
			`${base}/pull_toward_mean/workers/flow_model.worker.js`,
			`${base}/pull_toward_mean/models/flow_model.json`,
			'Flow Matching',
			{ dim: 2, hidden: 128 }
		);
		const request = client.sampleFromInitialPoints(
			initialPoints.map(({ x, y }) => [x, y]),
			160,
			{ scheduler: 'euler_midpoint' }
		);
		request.promise.then((samples) => {
			if (disposed) return;
			const samplesWithInitial = [initialPoints.map(({ x, y }) => [x, y]), ...samples];
			trajectories = transposeTrajectories(samplesWithInitial);
			const radii = samplesWithInitial.map((step) =>
				step.reduce((sum, [x, y]) => sum + Math.hypot(x, y), 0) / step.length
			);
			const closestStep = radii.indexOf(Math.min(...radii));
			splitProgress = Math.max(0.12, Math.min(0.65, closestStep / Math.max(1, samplesWithInitial.length - 1)));
			draw(player.state);
			player.play();
		}).catch((error) => {
			if (disposed) return;
			console.error(error);
			loadError = 'MODEL COULD NOT BE LOADED';
			draw(player.state);
		});

		return () => {
			disposed = true;
			unsubscribe();
		};
	});

	onDestroy(() => {
		player.dispose();
		destroyWorkerPool();
		unregisterTarget?.();
		unregisterSource?.();
	});
</script>

<div class="stage-shell">
	<Figure {player} devMode={true} backgroundVisible={false}>
		{#snippet children()}
			<canvas
				bind:this={canvas}
				width={EXPORT_WIDTH}
				height={EXPORT_HEIGHT}
				aria-label="A learned flow carries particles through the empty center of a two-moons distribution"
			></canvas>
		{/snippet}
		{#snippet footer()}
			<TimeSlider
				timeline={player as any}
				displayTime={progress}
				showTicks={false}
				showTimeLabel={false}
				color="#ef7f32"
				maxWidth="720px"
			/>
		{/snippet}
	</Figure>
</div>

<style>
	.stage-shell {
		width: min(calc(100vw - 64px), calc((100vh - 132px) * 1.6));
		margin: auto;
	}

	canvas {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: 16 / 10;
		box-sizing: border-box;
		border: 1px solid #aeb6c2;
	}

	:global(.stage-shell .figure) {
		margin: 0;
		gap: 0.55rem;
	}

	:global(.stage-shell .figure-content) {
		display: block;
	}


	:global(.stage-shell .figure-footer) {
		padding: 0;
	}

	:global(.stage-shell .figure-dev-inspector) {
		position: fixed;
		left: 18px;
		right: 18px;
		bottom: 10px;
		z-index: 20;
		background: rgba(255, 255, 255, 0.96);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.14);
	}

	@media (max-width: 700px) {
		.stage-shell { width: calc(100vw - 24px); }
	}
</style>
