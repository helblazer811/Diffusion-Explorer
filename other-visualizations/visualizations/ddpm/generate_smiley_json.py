#!/usr/bin/env python3
"""
Generate smiley face distribution samples and save to JSON.
Run this from the ddpm directory after modifying distributions.py.
"""

import json
import sys
import os

# Add current dir to path for imports
sys.path.insert(0, os.path.dirname(__file__))

from distributions import make_smiley_face_distribution

def generate_smiley_json(output_path: str, num_samples: int = 400):
    """Generate smiley face samples and save to JSON."""
    print(f"Generating {num_samples} samples...")
    samples = make_smiley_face_distribution(num_samples=num_samples)

    # Convert to list of [x, y] pairs
    points = samples.numpy().tolist()

    # Save to JSON
    data = {"points": points}
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"Saved {len(points)} points to {output_path}")

if __name__ == "__main__":
    # Default output path
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    default_output = os.path.join(
        base_dir,
        "diffusion-explorer/apps/continuity-equation-explainer/static/flow_invertibility/data/smiley_face.json"
    )

    output_path = sys.argv[1] if len(sys.argv) > 1 else default_output
    num_samples = int(sys.argv[2]) if len(sys.argv) > 2 else 400

    generate_smiley_json(output_path, num_samples)
