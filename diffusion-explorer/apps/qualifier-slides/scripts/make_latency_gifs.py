"""
Generate two GIFs showing a denoising process (noise → image).
- fast.gif: ~3 seconds, fewer frames
- slow.gif: ~60 seconds (1 minute), many frames

Uses a flower sample image and progressively removes Gaussian noise.
"""

import numpy as np
from PIL import Image
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(SCRIPT_DIR, '..', 'static')
FLOWER_PATH = os.path.join(STATIC_DIR, 'flower_samples', 'image_00001.jpg')
OUT_DIR = os.path.join(STATIC_DIR, 'latency_slide')
os.makedirs(OUT_DIR, exist_ok=True)

# Load source image
img = Image.open(FLOWER_PATH).convert('RGB').resize((512, 512), Image.LANCZOS)
img_np = np.array(img, dtype=np.float32)

def make_gif(out_path: str, num_frames: int, duration_ms: int, total_duration_ms: int = None):
    """Create a denoising GIF: pure noise → clean image.
    If total_duration_ms is set, pad the final frame to fill the remaining time."""
    frame_delay = max(duration_ms // num_frames, 20)  # ms per frame, min 20ms

    frames = []
    durations = []
    for i in range(num_frames):
        # t goes from 1 (pure noise) to 0 (clean image)
        t = 1.0 - (i / (num_frames - 1))

        # Generate noise (fixed seed for consistency)
        rng = np.random.RandomState(42)
        noise = rng.randn(*img_np.shape).astype(np.float32) * 255.0

        # Blend: at t=1 pure noise, at t=0 clean image
        blended = img_np * (1 - t) + noise * t
        blended = np.clip(blended, 0, 255).astype(np.uint8)

        frames.append(Image.fromarray(blended))
        durations.append(frame_delay)

    # If total_duration_ms specified, pad with the final (clean) frame held for remaining time
    if total_duration_ms and total_duration_ms > duration_ms:
        remaining_ms = total_duration_ms - duration_ms
        # GIF max frame delay is ~65535 centiseconds, so split into chunks
        while remaining_ms > 0:
            chunk = min(remaining_ms, 10000)  # 10s chunks max
            frames.append(frames[-1].copy())
            durations.append(chunk)
            remaining_ms -= chunk

    # Save as GIF
    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,  # loop forever
    )
    total_secs = sum(durations) / 1000
    print(f"  {out_path}: {len(frames)} frames, ~{total_secs:.1f}s total")


print("Generating fast.gif (~3s denoising, then freeze until 30s)...")
make_gif(
    os.path.join(OUT_DIR, 'fast.gif'),
    num_frames=30,
    duration_ms=3000,
    total_duration_ms=30000,
)

print("Generating slow.gif (~30 seconds)...")
make_gif(
    os.path.join(OUT_DIR, 'slow.gif'),
    num_frames=300,
    duration_ms=30000,
)

print("Done!")
