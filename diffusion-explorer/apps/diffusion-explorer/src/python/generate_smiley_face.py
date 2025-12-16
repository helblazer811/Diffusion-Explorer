import numpy as np
import json

def generate_smiley_face(points_per_eye=50, points_per_mouth=200, eye_std=0.1, mouth_std=0.08, seed=42):
    np.random.seed(seed)

    points = []

    # Eyes: two Gaussian blobs
    eye_y = 1.0
    eye_x_offset = 1.0
    left_eye_center = [-eye_x_offset, eye_y]
    right_eye_center = [eye_x_offset, eye_y]

    for cx, cy in [left_eye_center, right_eye_center]:
        samples = np.random.normal(loc=[cx, cy], scale=eye_std, size=(points_per_eye, 2))
        points.extend(samples.tolist())

    # Mouth: arc-shaped Gaussians
    mouth_radius = 1.5
    mouth_y_shift = -2.5  # Move mouth further below the eyes
    mouth_angle_range = np.linspace(np.pi / 6, 5 * np.pi / 6, points_per_mouth)
    mouth_points = []
    for angle in mouth_angle_range:
        cx = mouth_radius * np.cos(angle)
        cy = mouth_y_shift + mouth_radius * np.sin(angle)
        sample = np.random.normal(loc=[cx, cy], scale=mouth_std, size=(1, 2))
        mouth_points.extend(sample.tolist())

    # Flip the mouth points about the center of them 
    mouth_y_mean = np.mean([y for _, y in mouth_points])
    mouth_points = [[x, 2 * mouth_y_mean - y] for x, y in mouth_points]
    points.extend(mouth_points)
    # Round for JSON readability
    points = [[round(x, 2), round(y, 2)] for x, y in points]
    # Flip the points along the y-axis for a more natural smiley face orientation
    points = [[x, -y] for x, y in points]

    return {"points": points}

def save_to_json(data, filename="smiley_face.json"):
    with open(filename, "w") as f:
        json.dump(data, f, indent=2)

if __name__ == "__main__":
    data = generate_smiley_face()
    save_to_json(data)
