from torch.distributions import MultivariateNormal
import torch
import numpy as np

# def rejection_sampling_2d(pdf, num_samples, bounds):
#     samples = []

#     while len(samples) < num_samples:
#         x = np.random.uniform(bounds[0][0], bounds[0][1])
#         y = np.random.uniform(bounds[1][0], bounds[1][1])
#         xy = np.array([x, y])[None, :]
#         if np.random.uniform(0, 1) < pdf(xy):
#             samples.append([x, y])

#     return np.array(samples)


def sample_from_pdf(pdf, n_samples=1000, bounds=None):
    xmin, xmax, ymin, ymax = bounds
    # Generate random uniform samples for x and y coordinates separately
    u_x = np.random.uniform(0, 1, n_samples)
    u_y = np.random.uniform(0, 1, n_samples)

    # Generate linearly spaced points in the range of the distribution for both dimensions
    x_values = np.linspace(xmin, xmax, n_samples)
    y_values = np.linspace(ymin, ymax, n_samples)

    # Evaluate the 2D PDF at the meshgrid of x and y values
    X, Y = np.meshgrid(x_values, y_values)
    # Stack the 2D coordinates
    XY = np.stack([X, Y], axis=-1).reshape(-1, 2)
    print(f"XY shape: {XY.shape}")

    pdf_values = pdf(XY)

    # Calculate the 2D cumulative distribution function (CDF)
    cdf = np.cumsum(pdf_values.ravel())

    # Normalize the CDF
    cdf = cdf / cdf[-1]

    # Find indices corresponding to the random samples in the CDF
    indices = np.searchsorted(cdf, u_x * u_y)

    # Map indices to 2D coordinates
    indices_x = indices % n_samples
    indices_y = indices // n_samples

    # Return samples from the inverse transform sampling
    x_vals, y_vals = x_values[indices_x], y_values[indices_y]
    print(f"x_vals shape: {x_vals.shape}")
    print(f"y_vals shape: {y_vals.shape}")
    samples = np.concatenate((x_vals[:, None], y_vals[:, None]), axis=-1)

    return samples


def smiley_face_pdf(z):
    if isinstance(z, np.ndarray):
        z = torch.Tensor(z)
    # z = np.reshape(z, [z.shape[0], 2])
    # Make the mouth (arc at bottom of face, positive y)
    # Ring centered at origin, radius 2, but only show bottom portion (y > 0)
    norm = torch.sqrt(z[:, 0] ** 2 + z[:, 1] ** 2)
    # Select points where y is positive (bottom of ring in screen coords)
    exp1 = torch.exp(-0.5 * ((z[:, 1] - 1.0) / 0.3) ** 2)  # Center arc around y=1
    u = 0.5 * ((norm - 2) / 0.1) ** 2 - torch.log(exp1)  # Tighter radial
    mouth_weight = 2.0
    sum_pdf = mouth_weight * torch.exp(-u)
    # Make the eyes (smaller std for tighter features) - at top (negative y)
    feature_var = 0.025  # Smaller variance for tighter dots
    eye1 = MultivariateNormal(torch.tensor([0.7, -1.0]), torch.eye(2) * feature_var)
    eye2 = MultivariateNormal(torch.tensor([-0.7, -1.0]), torch.eye(2) * feature_var)
    # Compute the pdfs
    eye1_pdf = eye1.log_prob(z)
    eye2_pdf = eye2.log_prob(z)
    # Eyes get higher weight (they're further from center, need boost)
    eye_weight = 5.0
    sum_pdf = (
        sum_pdf
        + eye_weight * torch.exp(eye1_pdf)
        + eye_weight * torch.exp(eye2_pdf)
    )
    # Add nose point (slightly above mouth, below eyes)
    nose_weight = 2.0
    nose = MultivariateNormal(torch.tensor([0.0, 0.3]), torch.eye(2) * feature_var)
    nose_pdf = nose.log_prob(z)
    sum_pdf = sum_pdf + nose_weight * torch.exp(nose_pdf)

    return sum_pdf


def make_smiley_face_distribution(num_samples=1000):
    """
    This function samples from the smiley face distribution
    using rejection sampling
    """
    bounds = [-2.5, 2.5, -2.5, 2.5]
    samples = sample_from_pdf(smiley_face_pdf, num_samples, bounds=bounds)

    print(f"Samples shape: {samples.shape}")

    return torch.Tensor(samples)


# Function for generating spiral data
def make_spiral_data(num_examples=1000, std=0.0, rescale_factor=0.3):
    """
    Generates a spiral dataset with noise
    """
    # Generate the data
    t = np.linspace(0, 4 * np.pi, num_examples)
    samples = []

    for example_index in range(num_examples):
        # Randomly draw from a random normal distribution centered along the spiral
        # Randomly draw an angle from [0, 4 * np.pi]
        angle = np.random.uniform(0, 4 * np.pi, 1)
        # Data sample
        dist_x = rescale_factor * angle * np.cos(angle)
        dist_y = rescale_factor * angle * np.sin(angle)
        # Sample from a gaussian centered at t
        sample = np.random.normal(np.concatenate((dist_x, dist_y)), [std, std], (1, 2))
        samples.append(sample)

    samples = np.stack(samples)
    samples = torch.Tensor(samples).squeeze()
    print(f"Samples shape: {samples.shape}")
    # data = torch.random
    # torch.random.normal(num_examples, std=std)
    # # Stack the data
    # data = torch.stack([x, y], dim=-1) * rescale_factor
    return samples


def load_datasaurus(num=5000):
    datasaurus_data = pd.read_csv("datasaurus.csv")
    datasaurus_data = datasaurus_data[datasaurus_data["dataset"] == "dino"]
    # # Convert x and y to torch tensors
    x = torch.tensor(datasaurus_data["x"].values, dtype=torch.float32)
    y = torch.tensor(datasaurus_data["y"].values, dtype=torch.float32)
    datasaurus_data = torch.stack([x, y], dim=-1)
    # Center and standardize the data
    datasaurus_data = (
        datasaurus_data - datasaurus_data.mean(dim=0)
    ) / datasaurus_data.std(dim=0)

    return datasaurus_data


def make_gaussian_mixture(number_of_gaussians=3, num_samples=10000):
    """"""
    # Define parameters for each Gaussian
    mean1 = np.array([2.2, 1.5])
    covariance1 = (
        np.eye(2) * 0.4
    )  # Identity covariance matrix for isotropic distribution

    mean2 = np.array([-2.5, 2.5])
    covariance2 = np.eye(2) * 0.5

    mean3 = np.array([0, -2])
    covariance3 = np.eye(2) * 0.7
    # Generate random samples from each Gaussian
    samples1 = np.random.multivariate_normal(mean1, covariance1, num_samples)
    samples2 = np.random.multivariate_normal(mean2, covariance2, num_samples)
    samples3 = np.random.multivariate_normal(mean3, covariance3, num_samples)
    # Concatenate the samples
    samples = np.concatenate((samples1, samples2, samples3), axis=0)
    samples = torch.Tensor(samples).float()

    samples /= 2

    return samples
