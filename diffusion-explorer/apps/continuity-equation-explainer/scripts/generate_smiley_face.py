#!/usr/bin/env python3
"""
Generate smiley face distribution samples using Gaussian mixture model.
Eyes and nose are single Gaussians, mouth is a sequence of Gaussians along an arc.

Usage: python scripts/generate_smiley_face.py [output_path] [num_samples]
"""

import json
import sys
import os
import numpy as np


def make_smiley_face(num_samples: int = 400) -> np.ndarray:
    """
    Create smiley face distribution by sampling from Gaussians.

    - Eyes: Two Gaussians at top of face (negative y in screen coords)
    - Nose: Single Gaussian in center
    - Mouth: Sequence of Gaussians along a curved arc at bottom (positive y)

    Returns array of shape (num_samples, 2).
    """
    samples = []

    # Feature parameters (will be scaled up at the end)
    eye_std = 0.04   # Tighter eyes
    nose_std = 0.04  # Tighter nose
    mouth_std = 0.04  # Tighter mouth

    # Positions (y negative = top, y positive = bottom in screen coords)
    # Eyes closer together
    left_eye_pos = np.array([-0.35, -0.6])
    right_eye_pos = np.array([0.35, -0.6])
    nose_pos = np.array([0.0, -0.15])  # Shifted up (more negative y)

    # Mouth arc parameters
    mouth_center_y = 0.5  # Center of mouth arc
    mouth_radius = 0.6    # Radius of the arc
    mouth_arc_start = 0.2 * np.pi  # Start angle (radians from horizontal) - wider
    mouth_arc_end = 0.8 * np.pi    # End angle - wider
    num_mouth_gaussians = 12       # Number of Gaussians along the arc

    # Weights for each feature (determines proportion of samples)
    eye_weight = 1.0
    nose_weight = 0.5
    mouth_weight = 3.0  # More samples for the mouth since it's larger

    total_weight = 2 * eye_weight + nose_weight + mouth_weight

    # Calculate number of samples for each feature
    n_per_eye = int(num_samples * eye_weight / total_weight)
    n_nose = int(num_samples * nose_weight / total_weight)
    n_mouth = num_samples - 2 * n_per_eye - n_nose

    # Sample eyes
    left_eye_samples = np.random.normal(left_eye_pos, eye_std, (n_per_eye, 2))
    right_eye_samples = np.random.normal(right_eye_pos, eye_std, (n_per_eye, 2))
    samples.extend(left_eye_samples)
    samples.extend(right_eye_samples)

    # Sample nose
    nose_samples = np.random.normal(nose_pos, nose_std, (n_nose, 2))
    samples.extend(nose_samples)

    # Sample mouth along arc
    # Generate positions along the arc
    angles = np.linspace(mouth_arc_start, mouth_arc_end, num_mouth_gaussians)
    mouth_centers = []
    for angle in angles:
        x = mouth_radius * np.cos(angle)
        y = mouth_center_y + mouth_radius * np.sin(angle) - mouth_radius  # Shift down
        mouth_centers.append(np.array([x, y]))

    # Sample from each mouth Gaussian
    samples_per_mouth_gaussian = n_mouth // num_mouth_gaussians
    remainder = n_mouth % num_mouth_gaussians

    for i, center in enumerate(mouth_centers):
        n = samples_per_mouth_gaussian + (1 if i < remainder else 0)
        mouth_samples = np.random.normal(center, mouth_std, (n, 2))
        samples.extend(mouth_samples)

    samples = np.array(samples)

    # Mean center the samples
    mean = samples.mean(axis=0)
    samples = samples - mean

    # Scale to have std=1
    std = samples.std()
    samples = samples / std

    # Scale to target std of 1.4
    scale_factor = 1.4
    samples = samples * scale_factor

    return samples


def generate_smiley_json(output_path: str, num_samples: int = 400):
    """Generate smiley face samples and save to JSON."""
    print(f"Generating {num_samples} samples...")
    samples = make_smiley_face(num_samples=num_samples)

    # Convert to list of [x, y] pairs
    points = samples.tolist()

    # Save to JSON
    data = {"points": points}
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"Saved {len(points)} points to {output_path}")

    # Print some stats
    print(f"  X range: [{samples[:, 0].min():.3f}, {samples[:, 0].max():.3f}]")
    print(f"  Y range: [{samples[:, 1].min():.3f}, {samples[:, 1].max():.3f}]")
    print(f"  Mean: [{samples[:, 0].mean():.3f}, {samples[:, 1].mean():.3f}]")


if __name__ == "__main__":
    # Default output paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    app_dir = os.path.dirname(script_dir)

    default_outputs = [
        os.path.join(app_dir, "static/data/smiley_face.json"),
    ]

    num_samples = int(sys.argv[2]) if len(sys.argv) > 2 else 400

    if len(sys.argv) > 1:
        # Single output path specified
        generate_smiley_json(sys.argv[1], num_samples)
    else:
        # Generate for all default paths
        for output_path in default_outputs:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            generate_smiley_json(output_path, num_samples)
