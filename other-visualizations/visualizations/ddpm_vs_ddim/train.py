"""
    This is a script for training a diffusion model on a simple 
    2D spiral distribution. 
"""
import torch
import torch.nn as nn
import numpy as np
import matplotlib.pyplot as plt
import math
from tqdm import tqdm
import itertools
import torch.nn.functional as F
import pandas as pd
import seaborn as sns

from distributions import make_smiley_face_distribution, make_spiral_data, load_datasaurus, make_gaussian_mixture

class SinusoidalPositionalEmbedding(nn.Module):
    def __init__(self, embedding_dim=10, max_length=1000):
        super(SinusoidalPositionalEmbedding, self).__init__()
        self.embedding_dim = embedding_dim
        self.max_length = max_length
        
        # Compute the positional encodings once in log space
        self.positional_encodings = self._get_positional_encodings()

    def _get_positional_encodings(self):
        pe = torch.zeros(self.max_length, self.embedding_dim)
        position = torch.arange(0, self.max_length, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, self.embedding_dim, 2).float() * (-math.log(10000.0) / self.embedding_dim))
        
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        # pe = pe.unsqueeze(0)
        return pe

    def forward(self, time):
        # Add positional embeddings to the input tensor
        return self.positional_encodings[time, :]

# Make the score diction network (i.e. same role as the UNet)
class ScoreNetwork(nn.Module):
    """
        Has a simple feed forward MLP structure. 

        Takes as input the data point and a embedding encoding time.
    """

    def __init__(self, data_dim=2, time_dim=2, total_timesteps=1000):
        super(ScoreNetwork, self).__init__()
        self.data_dim = data_dim
        self.time_dim = time_dim
        # Make the positional embedding
        self.positional_embedding = SinusoidalPositionalEmbedding(
            time_dim, 
            total_timesteps
        )
        # Make the network
        self.network = nn.Sequential(
            nn.Linear(data_dim + time_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 128),
            nn.ReLU(),
            nn.Linear(128, data_dim)
        )

    def forward(self, x, time):
        """
            Forward pass of the network
        """
        # Map the time through a positional encoding
        time_embedding = self.positional_embedding(time)
        return self.network(
            torch.cat([x, time_embedding], dim=-1)
        )

class DDIMDiffusionModel(nn.Module):

    def __init__(
            self, 
            total_timesteps=1000,   
            data_dim=2, 
            time_dim=10,
            beta_start=0.0001,
            beta_end=0.02,
            eta=0.0
        ):
        super(DDPMDiffusionModel, self).__init__()

        self.total_timesteps = total_timesteps
        # Make a score network
        self.score_network = ScoreNetwork(
            data_dim=data_dim, 
            time_dim=time_dim
        )
        # Make alphas and betas
        self.betas = torch.linspace(beta_start, beta_end, total_timesteps) # Use linear schedule
        self.alphas = 1 - self.betas
        # Make cumulative products
        self.cumulative_alphas = torch.cumprod(self.alphas, dim=0)
        self.cumulative_betas = 1 - self.cumulative_alphas

        self.alphas_cumprod = torch.cumprod(self.alphas, axis=0)
        self.alphas_cumprod_prev = F.pad(
            self.alphas_cumprod[:-1], 
            (1, 0), 
            value=1.
        )

        # required for self.add_noise
        self.sqrt_alphas_cumprod = self.alphas_cumprod ** 0.5
        self.sqrt_one_minus_alphas_cumprod = (1 - self.alphas_cumprod) ** 0.5

    def get_variance(self, t):
        if t == 0:
            return 0

        variance = self.betas[t] * (1. - self.alphas_cumprod_prev[t]) / (1. - self.alphas_cumprod[t])
        variance = variance.clip(1e-20)
        return variance
    
    def predict_noise(self, x, t):
        """
            Predicts the noise at a noisy sample and time step
        """
        return self.score_network(x, t)

    def step(self, model_output, timestep, x_t, num_inference_timesteps=50):
        t = timestep
        # Get the prev timestep
        prev_timestep = timestep - self.total_timesteps // num_inference_timesteps
        # Get alphas and betas
        alpha_prod_t = self.alphas_cumprod[timestep]
        alpha_prod_t_prev = self.alphas_cumprod[prev_timestep] if prev_timestep >= 0 else self.final_alpha_cumprod
        beta_prod_t = 1 - alpha_prod_t
        # Predict the original noise
        pred_original_sample = (x_t - beta_prod_t ** (0.5) * model_output) / alpha_prod_t ** (0.5)
        pred_epsilon = model_output
        # Compute variance
        variance = self.get_variance(t)
        std_dev_t = self.eta * variance ** (0.5)
        # Predict the sample direction
        pred_sample_direction = (1 - alpha_prod_t_prev - std_dev_t**2) ** (0.5) * pred_epsilon
        # Predict the previous sample without noise
        pred_prev_sample = alpha_prod_t_prev ** (0.5) * pred_original_sample + pred_sample_direction
        # Add noise if eta > 0
        if self.eta > 0:
            noise = torch.randn_like(model_output)
            variance = std_dev_t * noise
            pred_prev_sample = pred_prev_sample + variance

        return pred_prev_sample

    def add_noise(self, x_start, x_noise, timesteps):
        s1 = self.sqrt_alphas_cumprod[timesteps]
        s2 = self.sqrt_one_minus_alphas_cumprod[timesteps]

        s1 = s1.reshape(-1, 1)
        s2 = s2.reshape(-1, 1)

        return s1 * x_start + s2 * x_noise
    
    def sample(self, num_samples=1000, num_timesteps=1000, device='cpu'):
        """Does DDIM Sampling"""
        sample = torch.randn(num_samples, 2)
        timesteps = list(range(self.total_timesteps))[::-1]
        interemediate_values = torch.empty(num_samples, num_timesteps, 2)

        for i, t in enumerate(timesteps):
            t = torch.from_numpy(np.repeat(t, num_samples)).long()
            with torch.no_grad():
                residual = self.predict_noise(sample, t)
            sample = self.step(residual, t[0], sample, num_inference_timesteps=num_timesteps)
            interemediate_values[:, i, :] = sample
        
        return sample, interemediate_values

# Make a Diffusion model object
class DDPMDiffusionModel(nn.Module):

    def __init__(
            self, 
            total_timesteps=1000,   
            data_dim=2, 
            time_dim=10,
            beta_start=0.0001,
            beta_end=0.02,
        ):
        super(DDPMDiffusionModel, self).__init__()

        self.total_timesteps = total_timesteps
        # Make a score network
        self.score_network = ScoreNetwork(
            data_dim=data_dim, 
            time_dim=time_dim
        )
        # Make alphas and betas
        self.betas = torch.linspace(beta_start, beta_end, total_timesteps) # Use linear schedule
        self.alphas = 1 - self.betas
        # Make cumulative products
        self.cumulative_alphas = torch.cumprod(self.alphas, dim=0)
        self.cumulative_betas = 1 - self.cumulative_alphas

        self.alphas_cumprod = torch.cumprod(self.alphas, axis=0)
        self.alphas_cumprod_prev = F.pad(
            self.alphas_cumprod[:-1], (1, 0), value=1.)

        # required for self.add_noise
        self.sqrt_alphas_cumprod = self.alphas_cumprod ** 0.5
        self.sqrt_one_minus_alphas_cumprod = (1 - self.alphas_cumprod) ** 0.5

        # required for reconstruct_x0
        self.sqrt_inv_alphas_cumprod = torch.sqrt(1 / self.alphas_cumprod)
        self.sqrt_inv_alphas_cumprod_minus_one = torch.sqrt(
            1 / self.alphas_cumprod - 1)

        # required for q_posterior
        self.posterior_mean_coef1 = self.betas * torch.sqrt(self.alphas_cumprod_prev) / (1. - self.alphas_cumprod)
        self.posterior_mean_coef2 = (1. - self.alphas_cumprod_prev) * torch.sqrt(self.alphas) / (1. - self.alphas_cumprod)

    def get_variance(self, t):
        if t == 0:
            return 0

        variance = self.betas[t] * (1. - self.alphas_cumprod_prev[t]) / (1. - self.alphas_cumprod[t])
        variance = variance.clip(1e-20)
        return variance
    
    def predict_noise(self, x, t):
        """
            Predicts the noise at a noisy sample and time step
        """
        return self.score_network(x, t)

    def step(self, model_output, timestep, x_t):
        t = timestep
        # Reconstruct the original sample
        s1 = self.sqrt_inv_alphas_cumprod[t]
        s2 = self.sqrt_inv_alphas_cumprod_minus_one[t]
        s1 = s1.reshape(-1, 1)
        s2 = s2.reshape(-1, 1)
        pred_original_sample = s1 * x_t - s2 * model_output
        # Predict the previous sample
        s1 = self.posterior_mean_coef1[t]
        s2 = self.posterior_mean_coef2[t]
        s1 = s1.reshape(-1, 1)
        s2 = s2.reshape(-1, 1)
        pred_prev_sample = s1 * pred_original_sample + s2 * x_t
        # Add noise back to the sample
        variance = 0
        if t > 0:
            noise = torch.randn_like(model_output)
            variance = (self.get_variance(t) ** 0.5) * noise

        pred_prev_sample = pred_prev_sample + variance

        return pred_prev_sample

    def add_noise(self, x_start, x_noise, timesteps):
        s1 = self.sqrt_alphas_cumprod[timesteps]
        s2 = self.sqrt_one_minus_alphas_cumprod[timesteps]

        s1 = s1.reshape(-1, 1)
        s2 = s2.reshape(-1, 1)

        return s1 * x_start + s2 * x_noise
    
    def sample(self, num_samples=1000, num_timesteps=1000, device='cpu'):
        """Does DDPM Sampling"""
        sample = torch.randn(num_samples, 2)
        timesteps = list(range(self.total_timesteps))[::-1]
        interemediate_values = torch.empty(num_samples, num_timesteps, 2)

        for i, t in enumerate(timesteps):
            t = torch.from_numpy(np.repeat(t, num_samples)).long()
            with torch.no_grad():
                residual = self.predict_noise(sample, t)
            sample = self.step(residual, t[0], sample)
            interemediate_values[:, i, :] = sample
        
        return sample, interemediate_values

# Train the model
def train(model, data, num_iterations=1000, batch_size=32, learning_rate=1e-4, device='cpu'):
    """
        Trains the diffusion model at denoising score matching
    """
    model = model.to(device)
    # Make the optimizer
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
    # Make the loss function
    loss_fn = nn.MSELoss()
    # Make a data loader
    data_loader = torch.utils.data.DataLoader(data, batch_size=batch_size, shuffle=True)
    cyclic_data_iterator = itertools.cycle(data_loader)
    # Save losses
    losses = []
    # Train the model
    for i in tqdm(range(num_iterations)):
        # Zero the gradients
        optimizer.zero_grad()
        # Load data batch
        noise_free_data = next(cyclic_data_iterator)
        # Make a batch of noisy data
        time_steps = torch.randint(0, model.total_timesteps, (noise_free_data.shape[0],)) # Randomly sample time steps uniformly  
        noise = torch.randn(noise_free_data.shape) # Generate standard gaussian noise 
        noisy_data = model.add_noise(noise_free_data, noise, time_steps)
        # Run the score prediction 
        predicted_noise = model.predict_noise(noisy_data, time_steps)
        # Compute the loss (i.e. MSE between predicted noise and true noise)
        loss = loss_fn(predicted_noise, noise)
        # Append the loss
        losses.append(loss.item())
        # Compute the gradients
        loss.backward()
        # Update the weights
        optimizer.step()
        # Generate some samples every 100 iterations
        if i % 10000 == 0:
            # Generate 1000 samples and plot them
            samples, _ = model.sample(num_samples=500, num_timesteps=1000, device=device)
            samples = samples.detach().cpu().numpy()
            plt.figure()
            # Plot the true data
            plt.scatter(data[:, 0], data[:, 1], label='True Data', alpha=0.5)
            plt.scatter(samples[:, 0], samples[:, 1], label='Samples', alpha=0.5)
            plt.savefig(f'plots/samples_{i}.png')

    # Plot the losses
    plt.figure()
    # Smooth the losses
    losses = np.convolve(losses, np.ones(5000) / 5000, mode='valid')
    plt.plot(losses)
    plt.savefig('plots/losses.png')

if __name__ == "__main__":
    # Make the diffusion model
    model = DDPMDiffusionModel()
    # Load the spiral dataset (just a torch tensor of dimension (N, 2))
    data = make_spiral_data(num_examples=1000, std=0.0, rescale_factor=0.3)
    # data = make_smiley_face_distribution(num_samples=10000)
    # data = load_datasaurus()
    # data = make_gaussian_mixture(num_samples=10000)
    # Run the training loop
    train(model, data, num_iterations=500000, batch_size=200, learning_rate=1e-4, device='cpu')
    # Save the state dict
    torch.save(model.state_dict(), 'models/spiral_model.pth')