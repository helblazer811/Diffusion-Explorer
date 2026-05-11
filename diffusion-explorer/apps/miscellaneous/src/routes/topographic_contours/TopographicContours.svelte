<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import * as d3 from 'd3';
  import { evaluateGrid, evaluateGMM, computeGradientDescentPath } from './gaussian-mixture.js';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  let {
    totalWidth = 800,
    gap = 16,
    gridResolution = 200,
    numContourLevels = 10,
    contourColor = '#FF3B59',
    tubeRadius = 0.04,
    tubeSegments = 6,
    pixelated = false,
  }: {
    totalWidth?: number;
    gap?: number;
    gridResolution?: number;
    numContourLevels?: number;
    contourColor?: string;
    tubeRadius?: number;
    tubeSegments?: number;
    pixelated?: boolean;
  } = $props();

  // Each canvas is square, fitting side by side within totalWidth
  const canvasSize = Math.floor((totalWidth - gap) / 2);

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  // 3D view (left)
  let container3d: HTMLDivElement | null = $state(null);
  let renderer3d: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera3d: THREE.OrthographicCamera | null = null;
  let controls: OrbitControls | null = null;
  let renderTarget3d: THREE.WebGLRenderTarget | null = null;
  let blitScene3d: THREE.Scene | null = null;
  let blitCamera3d: THREE.OrthographicCamera | null = null;

  // 2D top-down view (right)
  let container2d: HTMLDivElement | null = $state(null);
  let renderer2d: THREE.WebGLRenderer | null = null;
  let camera2d: THREE.OrthographicCamera | null = null;
  let renderTarget2d: THREE.WebGLRenderTarget | null = null;
  let blitScene2d: THREE.Scene | null = null;
  let blitCamera2d: THREE.OrthographicCamera | null = null;

  let animationFrameId = 0;
  let startTime = 0;
  let dotMesh: THREE.Mesh | null = null;
  let gradientPath: number[][] = [];
  let trailMesh: THREE.Mesh | null = null;
  let trailMaterial: THREE.MeshBasicMaterial | null = null;
  let lastTrailIdx = -1;

  // Camera animation parameters — derived from starting position (-2, -12, 8)
  const ORBIT_SPEED = 0.3;        // radians per second during orbit
  const ORBIT_RADIUS = Math.sqrt(4 + 144); // ~12.17
  const ORBIT_ELEVATION = 8;      // fixed z height
  const START_ANGLE = Math.atan2(-2, 12); // atan2(x, -y) ≈ -0.165 rad
  const CAMERA_ORBIT_DURATION = 5;
  const TRANSITION_DURATION = 3;    // seconds to ease into top-down
  const TOP_DOWN_Z = 20;

  // Gradient descent dot animation
  const GD_START_TIME = 8;         // seconds after start when dot appears
  const GD_DURATION = 8;           // seconds for the dot to traverse the path
  const DOT_RADIUS = 0.12;
  const DOT_COLOR = 0x6CE99D;

  // World-space bounds
  const DOMAIN = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
  const WORLD_SIZE_X = 20;
  const WORLD_SIZE_Y = 20; // square to match square canvases
  const TOTAL_HEIGHT = 3; // total z range for stacking contours

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------
  /** Map a GMM domain point to world-space [wx, wy, wz] where wz is the likelihood height. */
  function toWorld(px: number, py: number): [number, number, number] {
    const wx = ((px - DOMAIN.xMin) / (DOMAIN.xMax - DOMAIN.xMin) - 0.5) * WORLD_SIZE_X;
    const wy = ((py - DOMAIN.yMin) / (DOMAIN.yMax - DOMAIN.yMin) - 0.5) * WORLD_SIZE_Y;
    // Map likelihood to z: high likelihood = deep well (low z), low likelihood = high z
    const likelihood = evaluateGMM(px, py);
    const maxLikelihood = evaluateGMM(-4.0, 4.0); // approx peak of strongest component
    const wz = (1 - Math.min(likelihood / maxLikelihood, 1.0)) * TOTAL_HEIGHT;
    return [wx, wy, wz];
  }

  function buildGradientDot() {
    if (!scene) return;

    // Compute gradient descent path starting from a point away from any mode
    gradientPath = computeGradientDescentPath(7, -7, 300, 0.04);

    // Create the dot
    const geometry = new THREE.SphereGeometry(DOT_RADIUS, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: DOT_COLOR });
    dotMesh = new THREE.Mesh(geometry, material);
    dotMesh.visible = false;
    scene.add(dotMesh);

    // Trail material (tube mesh rebuilt as path progresses)
    trailMaterial = new THREE.MeshBasicMaterial({
      color: DOT_COLOR,
      transparent: true,
      opacity: 0.7,
    });
  }

  function buildContourLines() {
    if (!scene) return;

    const { values, width, height } = evaluateGrid(
      DOMAIN.xMin, DOMAIN.xMax, DOMAIN.yMin, DOMAIN.yMax, gridResolution,
    );

    // Compute threshold levels
    let maxVal = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] > maxVal) maxVal = values[i];
    }
    const minThreshold = maxVal * 0.02;
    const thresholds: number[] = [];
    for (let i = 0; i < numContourLevels; i++) {
      thresholds.push(minThreshold + (i / (numContourLevels - 1)) * (maxVal - minThreshold));
    }

    // Generate contours using d3
    const contourGenerator = d3.contours()
      .size([width, height])
      .thresholds(thresholds);

    const contourData = contourGenerator(Array.from(values));

    const baseColor = new THREE.Color(contourColor);

    for (let levelIdx = 0; levelIdx < contourData.length; levelIdx++) {
      const feature = contourData[levelIdx];
      // Invert: high likelihood = low z (energy wells), low likelihood = high z (energy plateau)
      const zHeight = (1 - levelIdx / (contourData.length - 1)) * TOTAL_HEIGHT;

      // Brightness ramp: brightest at deepest wells (highest likelihood)
      const brightness = 0.3 + 0.7 * (levelIdx / (contourData.length - 1));
      const levelColor = baseColor.clone().multiplyScalar(brightness);

      const material = new THREE.MeshBasicMaterial({ color: levelColor });

      for (const polygon of feature.coordinates) {
        for (const ring of polygon) {
          if (ring.length < 3) continue;

          const points: THREE.Vector3[] = [];
          for (const [gx, gy] of ring) {
            const wx = (gx / width - 0.5) * WORLD_SIZE_X;
            const wy = (gy / height - 0.5) * WORLD_SIZE_Y;
            points.push(new THREE.Vector3(wx, wy, zHeight));
          }

          const curve = new THREE.CatmullRomCurve3(points, false);
          const tubeGeometry = new THREE.TubeGeometry(curve, points.length, tubeRadius, tubeSegments, false);
          const mesh = new THREE.Mesh(tubeGeometry, material);
          scene.add(mesh);
        }
      }
    }
  }

  function buildWireframeSurface() {
    if (!scene) return;

    const res = 40;
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE_X, WORLD_SIZE_Y, res - 1, res - 1);
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;

    const maxLikelihood = evaluateGMM(-4.0, 4.0);
    // Cutoff: only deform the surface where likelihood is above this fraction
    const cutoffFraction = 0.01;

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i);
      const wy = posAttr.getY(i);

      const px = (wx / WORLD_SIZE_X + 0.5) * (DOMAIN.xMax - DOMAIN.xMin) + DOMAIN.xMin;
      const py = (wy / WORLD_SIZE_Y + 0.5) * (DOMAIN.yMax - DOMAIN.yMin) + DOMAIN.yMin;

      const likelihood = evaluateGMM(px, py);
      const normalized = Math.min(likelihood / maxLikelihood, 1.0);

      // Clamp to cutoff — flat at TOTAL_HEIGHT where likelihood is negligible
      const wz = normalized > cutoffFraction
        ? (1 - normalized) * TOTAL_HEIGHT
        : TOTAL_HEIGHT;

      posAttr.setZ(i, wz);
    }

    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      color: 0x555555,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------
  function createRenderer(container: HTMLDivElement): THREE.WebGLRenderer {
    const r = new THREE.WebGLRenderer({ antialias: !pixelated });
    r.setPixelRatio(pixelated ? 1 : Math.max(window.devicePixelRatio, 2));
    r.setSize(canvasSize, canvasSize);
    r.setClearColor(0x0F0E13);
    container.appendChild(r.domElement);
    return r;
  }

  function createBlitPipeline(internalSize: number) {
    const rt = new THREE.WebGLRenderTarget(internalSize, internalSize, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
    });
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const sc = new THREE.Scene();
    const mat = new THREE.MeshBasicMaterial({ map: rt.texture });
    sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    return { renderTarget: rt, blitCamera: cam, blitScene: sc };
  }

  function initScene() {
    if (!container3d || !container2d) return;

    const internalSize = pixelated ? Math.floor(canvasSize * 0.7) : canvasSize;

    // 3D renderer (left)
    renderer3d = createRenderer(container3d);
    ({ renderTarget: renderTarget3d, blitCamera: blitCamera3d, blitScene: blitScene3d } = createBlitPipeline(internalSize));

    // 2D renderer (right)
    renderer2d = createRenderer(container2d);
    ({ renderTarget: renderTarget2d, blitCamera: blitCamera2d, blitScene: blitScene2d } = createBlitPipeline(internalSize));

    // Shared scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0F0E13);

    // 3D camera — z is vertical
    const frustumSize = 17;
    camera3d = new THREE.OrthographicCamera(
      -frustumSize / 2, frustumSize / 2,
      frustumSize / 2, -frustumSize / 2,
      0.1, 100,
    );
    camera3d.up.set(0, 0, 1);
    camera3d.position.set(-2, -12, 8);
    const orbitTarget = new THREE.Vector3(0, 0, TOTAL_HEIGHT * 0.4);
    camera3d.lookAt(orbitTarget);

    // Controls for 3D view
    controls = new OrbitControls(camera3d, renderer3d.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.copy(orbitTarget);
    controls.update();

    // 2D top-down camera
    camera2d = new THREE.OrthographicCamera(
      -frustumSize / 2, frustumSize / 2,
      frustumSize / 2, -frustumSize / 2,
      0.1, 100,
    );
    camera2d.up.set(0, 1, 0);
    camera2d.position.set(0, 0, TOP_DOWN_Z);
    camera2d.lookAt(0, 0, 0);

    // Build geometry and gradient dot
    buildContourLines();
    buildGradientDot();

    // Start camera animation
    startTime = performance.now() / 1000;
    animate();
  }

  // ----------------------------------------------------------------
  // Drawing (render loop)
  // ----------------------------------------------------------------
  // Smooth ease-in-out
  function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function animate() {
    animationFrameId = requestAnimationFrame(animate);

    if (!camera3d || !controls) return;

    const elapsed = performance.now() / 1000 - startTime;
    const orbitTarget = new THREE.Vector3(0, 0, TOTAL_HEIGHT * 0.4);

    if (elapsed < CAMERA_ORBIT_DURATION) {
      // Phase 1: orbit in x/y plane
      const angle = START_ANGLE + elapsed * ORBIT_SPEED;
      camera3d.position.set(
        orbitTarget.x + ORBIT_RADIUS * Math.sin(angle),
        orbitTarget.y - ORBIT_RADIUS * Math.cos(angle),
        ORBIT_ELEVATION,
      );
      camera3d.lookAt(orbitTarget);
      controls.target.copy(orbitTarget);
    } else if (elapsed < CAMERA_ORBIT_DURATION + TRANSITION_DURATION) {
      // Phase 2: ease into top-down view
      const t = easeInOut((elapsed - CAMERA_ORBIT_DURATION) / TRANSITION_DURATION);
      const endAngle = START_ANGLE + CAMERA_ORBIT_DURATION * ORBIT_SPEED;
      const radius = ORBIT_RADIUS * (1 - t);
      const z = ORBIT_ELEVATION + (TOP_DOWN_Z - ORBIT_ELEVATION) * t;
      camera3d.position.set(
        orbitTarget.x + radius * Math.sin(endAngle),
        orbitTarget.y - radius * Math.cos(endAngle),
        z,
      );
      camera3d.up.set(0, t, 1 - t).normalize();
      camera3d.lookAt(orbitTarget);
      controls.target.copy(orbitTarget);
    } else {
      camera3d.up.set(0, 1, 0);
      controls.update();
    }
    if (dotMesh && trailMaterial && scene && gradientPath.length > 0) {
      if (elapsed >= GD_START_TIME) {
        dotMesh.visible = true;

        const gdElapsed = elapsed - GD_START_TIME;
        const t = Math.min(gdElapsed / GD_DURATION, 1);
        const easedT = 1 - Math.pow(1 - t, 2);
        const pathIdx = Math.min(
          Math.floor(easedT * (gradientPath.length - 1)),
          gradientPath.length - 1,
        );

        const [px, py] = gradientPath[pathIdx];
        const [wx, wy, wz] = toWorld(px, py);
        dotMesh.position.set(wx, wy, TOTAL_HEIGHT + DOT_RADIUS);

        // Rebuild trail tube only when path index advances
        if (pathIdx > lastTrailIdx && pathIdx >= 2) {
          lastTrailIdx = pathIdx;
          if (trailMesh) {
            trailMesh.geometry.dispose();
            scene.remove(trailMesh);
          }
          const points: THREE.Vector3[] = [];
          // Sample every few points to keep tube smooth but not too heavy
          const step = Math.max(1, Math.floor(pathIdx / 100));
          for (let i = 0; i <= pathIdx; i += step) {
            const [tpx, tpy] = gradientPath[i];
            const [twx, twy, twz] = toWorld(tpx, tpy);
            points.push(new THREE.Vector3(twx, twy, TOTAL_HEIGHT + 0.05));
          }
          if (points.length >= 2) {
            const curve = new THREE.CatmullRomCurve3(points, false);
            const tubeGeo = new THREE.TubeGeometry(curve, points.length * 2, 0.04, 6, false);
            trailMesh = new THREE.Mesh(tubeGeo, trailMaterial);
            scene.add(trailMesh);
          }
        }
      }
    }

    // Render 3D view (left)
    if (renderer3d && scene && camera3d) {
      if (pixelated && renderTarget3d && blitScene3d && blitCamera3d) {
        renderer3d.setRenderTarget(renderTarget3d);
        renderer3d.render(scene, camera3d);
        renderer3d.setRenderTarget(null);
        renderer3d.render(blitScene3d, blitCamera3d);
      } else {
        renderer3d.setRenderTarget(null);
        renderer3d.render(scene, camera3d);
      }
    }

    // Render 2D top-down view (right)
    if (renderer2d && scene && camera2d) {
      if (pixelated && renderTarget2d && blitScene2d && blitCamera2d) {
        renderer2d.setRenderTarget(renderTarget2d);
        renderer2d.render(scene, camera2d);
        renderer2d.setRenderTarget(null);
        renderer2d.render(blitScene2d, blitCamera2d);
      } else {
        renderer2d.setRenderTarget(null);
        renderer2d.render(scene, camera2d);
      }
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------
  $effect(() => {
    if (container3d && container2d) {
      initScene();
    }
  });

  onDestroy(() => {
    cancelAnimationFrame(animationFrameId);
    controls?.dispose();
    renderTarget3d?.dispose();
    renderTarget2d?.dispose();
    renderer3d?.dispose();
    renderer2d?.dispose();
    if (renderer3d && container3d && renderer3d.domElement.parentNode === container3d) {
      container3d.removeChild(renderer3d.domElement);
    }
    if (renderer2d && container2d && renderer2d.domElement.parentNode === container2d) {
      container2d.removeChild(renderer2d.domElement);
    }
  });
</script>

<div class="wrapper" style="width: {totalWidth}px; max-width: 100%;">
  <div class="canvases" style="gap: {gap}px;">
    <div class="canvas-container">
      <div
        bind:this={container3d}
        style="width: {canvasSize}px; aspect-ratio: 1;"
      ></div>
    </div>
    <div class="canvas-container">
      <div
        bind:this={container2d}
        style="width: {canvasSize}px; aspect-ratio: 1;"
      ></div>
    </div>
  </div>
</div>

<style>
  .wrapper {
    position: relative;
  }

  .canvases {
    display: flex;
  }

  .canvas-container {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
  }
</style>
