# Diffusion Explorer: Interactive Visualizations of Diffusion and Flow Based Generative Models

https://github.com/user-attachments/assets/07cb1f45-13c9-4cad-8709-ec95829e1d7e

---

Diffusion Explorer is an interactive tool (check out a beta version [here](https://alechelbling.com/Diffusion-Explorer)) for communicating the geometric intuitions behind diffusion and flow based generative models. This project is currently a work in progress.

## What can Diffusion Explorer Do

Diffusion Explorer is mainly an educational tool with the following key functionality:

1. Implements various training objectives like Flow Matching and Denoising Score Matching
2. Shows the dynamics of generated samples over time for pretrained models
3. Allows a user to observe how generated samples change through training
4. Enables training on custom hand drawn distributions

## Rectified Flow Explainer

https://github.com/helblazer811/Diffusion-Explorer/blob/306f8375979abba0516495a28ccdd2968185cd27/media/RectifiedFlowIntro.mp4

An interactive blog post explaining Rectified Flow, a technique for straightening the trajectories learned by flow matching models. The explainer features animated visualizations that demonstrate:

- How flow matching learns curved trajectories between distributions
- Why curved paths are problematic for few-step sampling
- How rectified flow iteratively straightens trajectories
- The connection between straight paths and optimal transport

**Live demo:** [alechelbling.com/blog/rectified-flow](https://alechelbling.com/blog/rectified-flow)

### Running Locally

```bash
cd diffusion-explorer/apps/rectified-flow-explainer
npm install
npm run dev
```

Then open your browser to the URL shown in the terminal (typically `http://localhost:5173`).

### Training Models

To retrain the flow matching and rectified flow models:

```bash
npm run train:flow-matching    # Train base flow matching model
npm run train:rectified-flow   # Train rectified flow model (3 steps)
npm run cache-samples          # Regenerate cached trajectories
```

## Try Out Diffusion Explorer Locally

You can try out Diffusion Explorer locally by running the project.

First, clone the project:
```bash
git clone https://github.com/helblazer811/Diffusion-Explorer
```

Then change the directory and install dependencies:
```bash
cd diffusion-explorer
npm install
```

Now run the local server:
```bash
npm run dev
```

and then access it in your browser at the specified port.

## Other Visualizations

You can also see some other interesting (non-interactive) visualizations in `/other-visualizations`.
