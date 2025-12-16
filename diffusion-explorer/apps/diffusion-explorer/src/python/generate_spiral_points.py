import numpy as np
import json

def generate_triangle_gaussians(points_per_cluster=200, std_dev=0.3, seed=42):
    np.random.seed(seed)

    # Define the three centers of an equilateral triangle
    radius = 1.8
    angles = [0, 2 * np.pi / 3, 4 * np.pi / 3]
    centers = [
        [radius * np.cos(a), radius * np.sin(a)] for a in angles
    ]

    points = []
    for cx, cy in centers:
        samples = np.random.normal(loc=[cx, cy], scale=std_dev, size=(points_per_cluster, 2))
        points.extend(samples.tolist())

    # Round for JSON readability
    points = [[round(x, 2), round(y, 2)] for x, y in points]
    return {"points": points}

def save_to_json(data, filename="triangle_gaussians.json"):
    with open(filename, "w") as f:
        json.dump(data, f, indent=2)

if __name__ == "__main__":
    data = generate_triangle_gaussians(points_per_cluster=20)
    save_to_json(data)
