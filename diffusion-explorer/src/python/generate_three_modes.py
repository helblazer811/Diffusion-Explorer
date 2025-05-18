import numpy as np
import json

def generate_three_mode_gaussian_mixture(
    num_modes=3,
    points_per_mode=200,
    radius=2.0,
    std=0.2,
    seed=42
):
    np.random.seed(seed)
    points = []

    # Compute equally spaced mode centers on a circle
    angles = np.linspace(0, 2 * np.pi, num_modes, endpoint=False)
    centers = [(radius * np.cos(a), radius * np.sin(a)) for a in angles]

    for cx, cy in centers:
        # Sample points around each center
        samples = np.random.normal(loc=[cx, cy], scale=std, size=(points_per_mode, 2))
        points.extend(samples.tolist())

    # Round for JSON readability
    points = [[round(x, 2), round(y, 2)] for x, y in points]
    return {"points": points}

def save_to_json(data, filename="three_mode_gmm.json"):
    with open(filename, "w") as f:
        json.dump(data, f, indent=2)

if __name__ == "__main__":
    data = generate_three_mode_gaussian_mixture()
    save_to_json(data)
