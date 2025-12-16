import numpy as np
import json

def generate_filled_inner_and_hollow_outer_circle(
    inner_radius=0.8,
    outer_radius=2.0,
    inner_points=300,
    outer_points=800,
    outer_noise_std=0.05,
    seed=42
):
    np.random.seed(seed)
    points = []

    # --- Filled inner circle (disk) ---
    for _ in range(inner_points):
        r = inner_radius * np.sqrt(np.random.rand())  # sqrt for uniform area density
        theta = 2 * np.pi * np.random.rand()
        x = r * np.cos(theta)
        y = r * np.sin(theta)
        points.append([x, y])

    # --- Hollow outer circle (ring) ---
    angles = np.linspace(0, 2 * np.pi, outer_points, endpoint=False)
    for angle in angles:
        x = outer_radius * np.cos(angle)
        y = outer_radius * np.sin(angle)
        noisy_point = np.random.normal(loc=[x, y], scale=outer_noise_std, size=(1, 2))
        points.extend(noisy_point.tolist())

    # Round for JSON readability
    points = [[round(x, 2), round(y, 2)] for x, y in points]
    return {"points": points}

def save_to_json(data, filename="circle_with_hole.json"):
    with open(filename, "w") as f:
        json.dump(data, f, indent=2)

if __name__ == "__main__":
    data = generate_filled_inner_and_hollow_outer_circle()
    save_to_json(data)
