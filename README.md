# Diffusion Explorer: Interactive Visualizations of Diffusion and Flow Based Generative Models


https://github.com/user-attachments/assets/07cb1f45-13c9-4cad-8709-ec95829e1d7e
<!-- <video controls>
  <source src="DiffusionLabDemoVideo.mov">
  Your browser does not support the video tag.
</video> -->

---

Diffusion Explorer is an interactive tool (check out a beta version [here](https://alechelbling.com/Diffusion-Explorer)) for communicating the geometric intuitions behind diffusion and flow based generative models. This project is currently a work in progress. 

### What can Diffusion Explorer Do

Diffusion Explorer is mainly an educaitonal tool with the following key functionality. It 

1. Implements various training objectives like Flow Matching and Denoising Score Matching
2. Shows the dynamics of generated samples over time for pretrained models
3. Allows a user to observe how generated samples change through training
4. Enables training on custom hand drawn distributions

### Try Out Diffusion Explorer Locally

You can try out Diffusion Explorer locally by running the project.

First, clone the project
```
    git clone https://github.com/helblazer811/Diffusion-Explorer
```
Then change the directory and install dependencies
```
    cd diffusion-explorer
    npm install
```
Now run the local server
```
    npm run dev
```
and then access it in your browser at the specified port. 

### Other Visualizations

You can also see some other interesting (non-interactive) visualizations in `/other-visualizations`. 
