# Todo

## Masked Diffusion

- Title / subtitle
  - [ ] Change blog 1 title to "Masked Diffusion Language Models" with subtitle "A Visual Introduction".
- Masked Language Modeling section — restructure + additions

  Target section order:
  1. Preamble "what's the goal" figure (new)
  2. "The Framework" subsection (existing high-level content, wrapped)
  3. "Neural Network Architecture" subsection (new)
     - Basic transformer overview
     - "Bidirectional Attention" (relocated Transformer section, renamed) — contrasted with causal attention

  Items:
  - [x] Preamble figure at the top of the section framing what MLM is trying to do. Two short token sequences side by side:
    - Left: masked language model — a sequence with a `[MASK]` in the middle. Label above: "Masked Language Model".
    - Right: autoregressive model — a sequence with a blank at the end (next token). Label above: "Autoregressive Model".
    - Below each: "Predict this" with an arrow pointing at the blank (mask on the left, last empty slot on the right).
  - [x] Wrap the current body of Masked Language Modeling (the high-level "here's how you train one" content) into a subsection. Working title: "The Framework" (open to a better name).
  - [x] Add a new "Masked Transformers" subsection right after "The Framework":
    - [x] Subsection heading + placeholder in place.
    - [x] Introduce the basic transformer network (animated MaskedTransformerFigure with forward-pass activation flow + sampling roulette).
    - [x] Contrast bidirectional attention with causal attention (InformationFlowFigure imported from blog 2).
  - [x] Move the existing "Transformer" section from Masked Diffusion Language Models into "Masked Transformers".

  Bar-chart (ModelPredictionFigure / MLMLossInline) — these three items describe one coherent redesign of the categorical prediction visual:
  - [ ] Use the same categorical distribution as the preamble example at the top of the section, so the two match visually.
  - [x] Don't always pick the argmax bar — sample from the categorical so the chosen token isn't always the tallest.
  - [x] Add a "sampling roulette" animation: briefly blink/highlight random bars in sequence, eventually landing on the chosen one — conveys that the pick is a random draw, not an argmax.
  - [x] Add a right-side label to the bar chart: "Randomly sample from this distribution."

  Consistency notes / open questions:
  - The three bar-chart items should be implemented together (same figure, same distribution).
  - The "sample, don't argmax" behavior needs to be consistent across every place a prediction is drawn from the categorical (MLMLossInline, ModelPredictionFigure, ModelPredictionInlineFullMask). Check the other prediction visuals in the section don't visibly argmax while this one samples — that would read as inconsistent.
  - The preamble figure's example (the specific tokens/context) should be the same one used by the bar-chart animation later in the section, so the reader recognizes it.
- Absorbing process figure
  - [x] Remove the `z_t_i` from the figure.
  - [x] Increase text size a bit.
  - [x] Move "forward process" label to two lines.
  - [x] Move the label to the bottom, after the entire rollout, pointing toward a masked token.
  - [x] Increase the font size of the tokens a bit.
  - [x] Increase the gap a bit between tokens.
  - [ ] Move the time axis (with "Forward Process" label) to the left side of the figure.
  - [ ] "Once masked, stays masked." can be on one line.
- Forward/reverse masking vs. continuous diffusion figure
  - [x] Make the "MASK" token label text the same size as the rest of the text.
- Blog 1 hero (paired forward/reverse figure at top)
  - [ ] Currently masks one token at a time — not faithful to MDM. Should allow multiple tokens to flip in the same infinitesimal window (independent per-token flip times), like the AbsorbingMask figure does. Make it faithful to MDM.
  - [ ] The orange used for the diffusion path and the orange used for the forward/reverse direction arrow look like different shades — unify them.
- Autoregressive vs. masked diffusion figure (Masked Diffusion Models section)
  - [x] On mobile, reduce the vertical gap between the two sides.
- Reverse process section
  - [x] Shrink the long equation on mobile instead of using the horizontal-scroll style.
- Novel-sequence generation figure (after "How would we go about generating a novel sequence with a model trained like this?")
  - [x] Drop the play/pause/reset button.
- Section heading rename
  - [ ] "Masking as the Forward Process" → "Masking as Corruption".
- Training loss equation with underbraces
  - [x] Pull the expectation and negative into the underbraced "existing MDM loss" part so it exactly matches; currently it doesn't.
  - [ ] Rewrite as an `align` with two equations: the simple form on the first line, then the rearranged form with the negative log-likelihood pulled into the underbrace on the second line — showing that the MDLM loss is just a weighted average of masked transformer losses.

## Efficient Masked Diffusion

- Hero / crown jewel figure
  - [x] Make the little clock logos shake when done.
  - [x] Try making the orange fill the entire hour hand in a lighter orange, to see if it's a more visible form of progress.
  - [x] Add "fast" in light gray text to the left of the block diffusion clock, and "slow" next to the autoregressive clock.
  - [ ] Capitalize "fast"/"slow" labels and lower the font weight a bit.
  - [ ] Hour hand should not be orange; instead, fill in the pie-slice of the circle from 12 o'clock up to the hour hand.
  - [ ] Fix mobile responsiveness of the crown-jewel text grid (tokens overflow / wrap badly on narrow viewports).

## Both / cross-cutting

- General figure layout
  - [x] Lower the bottom margin a bit on in-text figures.
  - [ ] Standardize the sizing of the masked-transformer visualizations across all figures: consistent transformer-block height and consistent token size (ModelPredictionFigure, ModelPredictionInlineFullMask, MLMLossInline, and any other figure that renders the transformer block + token row).
- General equation layout
  - [ ] Make all LaTeX equations resize on mobile to fit within the column width; they currently overflow.
