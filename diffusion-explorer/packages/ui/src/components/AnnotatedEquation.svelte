<script>
  import { onMount, onDestroy } from "svelte";
  import { loadMathJax } from "../plotting/mathjax";

  /**
   * LaTeX string. Use {\\color{#hex} content} to mark annotatable terms.
   * @type {string}
   */
  export let tex = "";

  /**
   * Each annotation matches a color used in the tex string.
   * @type {Array<{
   *   color: string,
   *   label: string,
   *   side?: 'above' | 'below',
   *   align?: 'left' | 'right',
   *   opacity?: number,
   * }>}
   */
  export let annotations = [];

  /** @type {number} Scale factor (applied via CSS font-size on the container) */
  export let scale = 1.6;

  /** @type {number} Vertical distance from term edge to the horizontal arm (px) */
  export let verticalGap = 36;

  /** @type {number} Extra vertical spacing per stacked annotation on the same side (px) */
  export let rowSpacing = 24;

  /** @type {number} Length of the horizontal arm (px) */
  export let horizontalExtent = 50;

  /** @type {number} Font size for annotation labels (px) */
  export let labelFontSize = 36;

  /** @type {boolean} Show stroke outline on annotation boxes */
  export let showBoxStroke = false;

  /** @type {number} Padding around annotated term boxes (px) */
  export let boxPadding = 10;

  /** @type {number} Border radius of annotation boxes (px) */
  export let boxRadius = 8;

  /** @type {boolean} Show debug bounding boxes */
  export let debug = false;

  let container;
  let svgOverlay;
  let eqDiv;
  let resizeObserver;
  let mounted = false;

  let colorGroupEls = new Map();

  onMount(async () => {
    await loadMathJax();
    mounted = true;
    await renderAndAnnotate();

    resizeObserver = new ResizeObserver(() => drawAnnotations());
    resizeObserver.observe(container);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
  });

  $: if (mounted && tex) {
    renderAndAnnotate();
  }

  async function renderAndAnnotate() {
    if (!eqDiv || !mounted) return;
    clearOverlay();

    const node = await window.MathJax.tex2svgPromise(tex, { display: true });
    const svg = node.querySelector("svg");
    if (!svg) return;

    svg.removeAttribute("style");
    svg.style.display = "inline-block";
    svg.style.verticalAlign = "middle";
    eqDiv.innerHTML = "";
    eqDiv.appendChild(svg);

    colorGroupEls = new Map();
    for (const ann of annotations) {
      const group = svg.querySelector(`g[fill="${ann.color}"]`);
      if (group) {
        colorGroupEls.set(ann.color, group);
        group.setAttribute("fill", "currentColor");
        group.setAttribute("stroke", "currentColor");
      }
    }

    // Compute how much vertical space annotations need and set padding
    const aboveCount = annotations.filter((a) => a.side === "above").length;
    const belowCount = annotations.filter((a) => !a.side || a.side === "below").length;
    const maxAboveStack = Math.max(0, aboveCount - 1);
    const maxBelowStack = Math.max(0, belowCount - 1);
    const topPad = aboveCount > 0 ? (verticalGap + maxAboveStack * rowSpacing + labelFontSize + 16) * 2.5 : 8;
    const bottomPad = belowCount > 0 ? (verticalGap + maxBelowStack * rowSpacing + labelFontSize + 16) * 2.5 : 8;
    container.style.paddingTop = `${topPad}px`;
    container.style.paddingBottom = `${bottomPad}px`;
    container.style.paddingLeft = `${(horizontalExtent + 32) * 4}px`;
    container.style.paddingRight = `${(horizontalExtent + 32) * 4}px`;

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    drawAnnotations();
  }

  function clearOverlay() {
    if (!svgOverlay) return;
    while (svgOverlay.firstChild) {
      svgOverlay.removeChild(svgOverlay.firstChild);
    }
  }

  function drawAnnotations() {
    if (!container || !svgOverlay) return;
    clearOverlay();

    const cRect = container.getBoundingClientRect();
    svgOverlay.setAttribute("viewBox", `0 0 ${cRect.width} ${cRect.height}`);

    // Measure all term boxes
    const measured = [];
    for (const annot of annotations) {
      const groupEl = colorGroupEls.get(annot.color);
      if (!groupEl) continue;

      const r = groupEl.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      measured.push({
        ...annot,
        box: {
          x: r.left - cRect.left,
          y: r.top - cRect.top,
          w: r.width,
          h: r.height,
        },
      });
    }

    if (measured.length === 0) return;

    // Compute equation center for auto-align
    const eqRect = eqDiv.getBoundingClientRect();
    const eqCenterX = eqRect.left + eqRect.width / 2 - cRect.left;

    // Resolve side and align for each annotation
    const resolved = measured.map((m) => {
      const side = m.side || "below";
      const cx = m.box.x + m.box.w / 2;
      const align = m.align || (cx < eqCenterX ? "left" : "right");
      return { ...m, resolvedSide: side, resolvedAlign: align };
    });

    // Stacking: group by quadrant (side + align), sort by distance from center
    // More central terms get shorter connectors (stackIndex=0)
    const quadrants = {};
    for (const item of resolved) {
      const key = `${item.resolvedSide}-${item.resolvedAlign}`;
      if (!quadrants[key]) quadrants[key] = [];
      quadrants[key].push(item);
    }
    for (const key of Object.keys(quadrants)) {
      quadrants[key].sort(
        (a, b) =>
          Math.abs(a.box.x + a.box.w / 2 - eqCenterX) -
          Math.abs(b.box.x + b.box.w / 2 - eqCenterX)
      );
      quadrants[key].forEach((item, i) => {
        item.stackIndex = i;
      });
    }

    // Compute equation bounds in container-local coords
    const eqTop = eqRect.top - cRect.top;
    const eqBottom = eqRect.bottom - cRect.top;

    // Draw
    for (const item of resolved) {
      if (debug) drawDebugBox(item.box, item);
      drawBox(item.box, item);
      drawLConnector(item, eqTop, eqBottom);
    }

  }

  function drawDebugBox(box, annot) {
    svgOverlay.appendChild(
      makeSVG("rect", {
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        fill: "none",
        stroke: annot.color,
        "stroke-width": 1,
        "stroke-dasharray": "4,3",
        opacity: 0.6,
      })
    );
  }

  function drawBox(box, annot) {
    svgOverlay.appendChild(
      makeSVG("rect", {
        x: box.x - boxPadding,
        y: box.y - boxPadding,
        width: box.w + boxPadding * 2,
        height: box.h + boxPadding * 2,
        rx: boxRadius,
        fill: annot.color,
        "fill-opacity": annot.opacity ?? 0.2,
        stroke: showBoxStroke ? annot.color : "none",
        "stroke-width": showBoxStroke ? 1.5 : 0,
      })
    );
  }

  function drawLConnector(item, eqTop, eqBottom) {
    const { box, color, label, resolvedSide, resolvedAlign, stackIndex } = item;
    const cx = box.x + box.w / 2;
    const vOffset = verticalGap + stackIndex * rowSpacing;

    // Arrow tip: slightly above/below the box
    const arrowGap = 4;
    let tipY, elbowY;
    if (resolvedSide === "above") {
      tipY = box.y - boxPadding - arrowGap;
      elbowY = eqTop - vOffset;
    } else {
      tipY = box.y + box.h + boxPadding + arrowGap;
      elbowY = eqBottom + vOffset;
    }

    // Render text first to measure its width
    const labelGapY = 14;  // vertical gap above the elbow line
    const labelGapX = 12;  // horizontal gap away from the vertical part
    const textAnchor = resolvedAlign === "left" ? "end" : "start";
    const textY = elbowY - labelGapY;
    const textStartX = resolvedAlign === "left" ? cx - labelGapX : cx + labelGapX;

    // Place text temporarily to measure
    const text = makeSVG("text", {
      x: textStartX,
      y: textY,
      "text-anchor": textAnchor,
      "dominant-baseline": "alphabetic",
      "font-size": labelFontSize,
      "font-family": "inherit",
      fill: color,
    });
    text.textContent = label;
    svgOverlay.appendChild(text);

    // Measure text width and compute horizontal arm endpoint
    // Extend a bit past the text
    const textWidth = text.getComputedTextLength();
    const elbowOverhang = 10;
    let endX;
    if (resolvedAlign === "left") {
      endX = textStartX - textWidth - elbowOverhang;
    } else {
      endX = textStartX + textWidth + elbowOverhang;
    }

    // Define arrowhead marker for this color
    let defs = svgOverlay.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      svgOverlay.prepend(defs);
    }
    const markerId = `arrowhead-${color.replace("#", "")}`;
    if (!defs.querySelector(`#${markerId}`)) {
      const marker = makeSVG("marker", {
        id: markerId,
        viewBox: "0 0 10 10",
        refX: "5",
        refY: "5",
        markerWidth: "6",
        markerHeight: "6",
        orient: "auto",
      });
      marker.appendChild(
        makeSVG("path", {
          d: "M 0 0 L 10 5 L 0 10 Z",
          fill: color,
        })
      );
      defs.appendChild(marker);
    }

    // L-shaped path: horizontal arm spans the text width, then vertical to arrow tip
    svgOverlay.appendChild(
      makeSVG("path", {
        d: `M ${endX} ${elbowY} L ${cx} ${elbowY} L ${cx} ${tipY}`,
        fill: "none",
        stroke: color,
        "stroke-width": 2,
        "marker-end": `url(#arrowhead-${markerId})`,
      })
    );
  }

  function makeSVG(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }
</script>

<div class="eq-wrap" bind:this={container} style="font-size: {scale}em;">
  <svg bind:this={svgOverlay} class="annot-overlay" aria-hidden="true"></svg>

  <div class="eq-content" bind:this={eqDiv}></div>
</div>

<style>
  .eq-wrap {
    position: relative;
    display: inline-block;
    padding: 8px;
  }

  .eq-content {
    position: relative;
  }

  .annot-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
</style>
