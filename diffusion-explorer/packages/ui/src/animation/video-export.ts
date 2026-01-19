import type { Timeline } from './timeline';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMTarget } from 'webm-muxer';
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4Target } from 'mp4-muxer';

// ===== Types =====

export interface VideoExportOptions {
  fps: number;                              // Frames per second (default: 30)
  format: 'frames' | 'webm' | 'mp4';        // Output format
  bitrate?: number;                         // Bitrate in bps (default: 8_000_000)
  filename?: string;                        // Base filename
  onProgress?: (progress: number) => void;  // Progress callback (0-1)
}

export interface ExportableAnimation<TState> {
  timeline: Timeline<TState>;
  draw: (state: TState) => void;
  canvas: HTMLCanvasElement | HTMLCanvasElement[];
}

// ===== Core Export Function =====

/**
 * Export a timeline animation to video or individual frames.
 *
 * This works by programmatically rendering each frame:
 * 1. Pause the timeline
 * 2. For each frame at desired FPS: seek to that time, get state, call draw, snapshot canvas
 * 3. Encode frames to WebM using WebCodecs (hardware accelerated, no WASM)
 *
 * @param animation - The animation to export (timeline, draw function, canvas or canvases)
 * @param options - Export options (fps, format, bitrate, etc.)
 * @returns For single canvas: Blob (video) or Blob[] (frames)
 *          For multiple canvases: Blob[] (videos) or Blob[][] (frames per canvas)
 */
export async function exportAnimation<TState>(
  animation: ExportableAnimation<TState>,
  options: VideoExportOptions
): Promise<Blob | Blob[] | Blob[][]> {
  const { canvas } = animation;
  const isMultiCanvas = Array.isArray(canvas);
  const canvases = isMultiCanvas ? canvas : [canvas];

  // Capture canvas snapshots for all canvases (no PNG encoding, just canvas copies)
  const allSnapshots = await captureCanvasSnapshots(
    { ...animation, canvases },
    options
  );

  if (options.format === 'frames') {
    // Convert canvas snapshots to PNG blobs
    const allFrames = await Promise.all(
      allSnapshots.map(snapshots =>
        Promise.all(snapshots.map(canvas => canvasToBlob(canvas)))
      )
    );
    return isMultiCanvas ? allFrames : allFrames[0];
  }

  // Encode each canvas's snapshots to WebM video
  const videos = await encodeVideosWebCodecs(allSnapshots, options);

  return isMultiCanvas ? videos : videos[0];
}

// ===== Canvas Snapshot Capture =====

interface CaptureInput<TState> {
  timeline: Timeline<TState>;
  draw: (state: TState) => void;
  canvases: HTMLCanvasElement[];
}

/**
 * Capture canvas snapshots by stepping through the timeline.
 * Returns canvas elements (not blobs) to avoid PNG encoding overhead.
 */
async function captureCanvasSnapshots<TState>(
  animation: CaptureInput<TState>,
  options: VideoExportOptions
): Promise<HTMLCanvasElement[][]> {
  const { timeline, draw, canvases } = animation;
  const { fps, onProgress } = options;

  const totalFrames = Math.ceil(timeline.duration * fps);
  // snapshots[canvasIndex][frameIndex]
  const snapshots: HTMLCanvasElement[][] = canvases.map(() => []);

  // Save state
  const wasPlaying = timeline.isPlaying;
  const savedTime = timeline.time;
  timeline.pause();

  try {
    for (let i = 0; i < totalFrames; i++) {
      const normalizedT = totalFrames === 1 ? 0 : i / (totalFrames - 1);

      // Seek and render
      timeline.seek(normalizedT);
      draw(timeline.state);

      // Snapshot each canvas (fast copy, no encoding)
      for (let c = 0; c < canvases.length; c++) {
        const frozen = document.createElement('canvas');
        frozen.width = canvases[c].width;
        frozen.height = canvases[c].height;
        frozen.getContext('2d')!.drawImage(canvases[c], 0, 0);
        snapshots[c].push(frozen);
      }

      onProgress?.((i + 1) / totalFrames * 0.5); // First 50% is capture

      // Yield to event loop periodically
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    return snapshots;
  } finally {
    // Restore state
    timeline.seek(savedTime / timeline.duration);
    if (wasPlaying) timeline.play();
  }
}

// ===== WebCodecs Video Encoding =====

/**
 * Encode canvas snapshots to videos using WebCodecs.
 * Hardware accelerated, no WASM, no dropped frames.
 * Supports WebM (VP9) and MP4 (H.264).
 */
async function encodeVideosWebCodecs(
  allSnapshots: HTMLCanvasElement[][],
  options: VideoExportOptions
): Promise<Blob[]> {
  const { fps, format, bitrate = 8_000_000, onProgress } = options;
  const numVideos = allSnapshots.length;
  const videos: Blob[] = [];

  const isMP4 = format === 'mp4';

  for (let v = 0; v < numVideos; v++) {
    const snapshots = allSnapshots[v];
    const width = snapshots[0].width;
    const height = snapshots[0].height;

    let muxer: WebMMuxer<WebMTarget> | MP4Muxer<MP4Target>;
    let target: WebMTarget | MP4Target;

    if (isMP4) {
      target = new MP4Target();
      muxer = new MP4Muxer({
        target,
        video: {
          codec: 'avc',
          width,
          height,
        },
        fastStart: 'in-memory',
      });
    } else {
      target = new WebMTarget();
      muxer = new WebMMuxer({
        target,
        video: {
          codec: 'V_VP9',
          width,
          height,
        },
      });
    }

    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { throw e; },
    });

    // Configure encoder with appropriate codec
    encoder.configure({
      codec: isMP4 ? 'avc1.640028' : 'vp09.00.10.08', // H.264 High or VP9
      width,
      height,
      bitrate,
      framerate: fps,
    });

    for (let i = 0; i < snapshots.length; i++) {
      const timestamp = (i * 1_000_000) / fps; // microseconds

      const videoFrame = new VideoFrame(snapshots[i], { timestamp });
      encoder.encode(videoFrame);
      videoFrame.close();

      // Progress: second 50% is encoding, divided among videos
      const overallProgress = 0.5 + 0.5 * ((v + (i + 1) / snapshots.length) / numVideos);
      onProgress?.(overallProgress);
    }

    await encoder.flush();
    encoder.close();
    muxer.finalize();

    const mimeType = isMP4 ? 'video/mp4' : 'video/webm';
    videos.push(new Blob([target.buffer], { type: mimeType }));
  }

  return videos;
}

// ===== Utility Functions =====

/**
 * Convert a canvas to a PNG blob.
 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to convert canvas to blob'));
    }, 'image/png');
  });
}

/**
 * Trigger a download for a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download multiple frames as individual PNG files.
 */
export async function downloadFrames(frames: Blob[], baseFilename: string): Promise<void> {
  for (let i = 0; i < frames.length; i++) {
    const paddedIndex = i.toString().padStart(5, '0');
    downloadBlob(frames[i], `${baseFilename}_${paddedIndex}.png`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
