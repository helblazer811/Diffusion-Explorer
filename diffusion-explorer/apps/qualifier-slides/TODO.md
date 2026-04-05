# Qualifier Slides TODO

- [x] Change the references slide to single column format
- [x] Fix sizing/spacing in the "Reflow Produces Straighter Trajectories" slide
- [x] Rename "Step 1: Specifying the Probability Path" to "The Linear Probability Path" and simplify the text to: "The simplest choice of path is to linearly interpolate our source X_0 and target X_1 random variables."
- [x] Add new slide "The Conditional Velocity Field" after the Linear Probability Path slide:
  - Reuse the linear path canvas figure but add an arrow v_t(x_t | x_1) that moves along with x_t
  - Only move x_t forward (no reverse), then restart animation with a new random (x_0, x_1) pair
  - Each iteration: choose a new random pair, show the linear interpolation and vector moving along it
  - Top sentence should define the conditional velocity field v_t(x_t | x_1)
- [x] Add new slide "Regressing the Velocity Field" after the Conditional Velocity Field slide:
  - Reuse the existing ConditionalFlowMatching canvas and equation from the current Flow Matching slide
  - Top sentence: "Given a point x_t we want to predict the velocity v_t^\theta(x_t) that matches the target conditional velocity v_t(x_t | x_1)."
  - Ties together the previous slides into the flow matching training objective
- [x] Lower font size of source and target distribution labels in "Practical Challenge: Curved Trajectories" slide
- [x] Increase label size for "curved function" and "almost straight function" in the "Curvature is the Enemy of Speed" slide
- [x] Rename "What Causes this Curvature?" to "What Causes Curved Paths?", scale up canvas height, increase distribution scale factor, and move distributions closer together
- [x] Reduce canvas height in the "Rectified Flows" slide
