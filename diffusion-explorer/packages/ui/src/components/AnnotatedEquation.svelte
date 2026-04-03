<script>
  import { onMount, onDestroy } from "svelte";
  import { loadMathJax } from "../plotting/mathjax";

  /**
   * LaTeX string. Use {\\color{#hex} content} to mark annotatable terms.
   * The braces scope the color switch so it doesn't leak.
   * @type {string}
   */
  export let tex = "";

  /**
   * Each annotation matches a color used in the tex string.
   * @type {Array<{
   *   color: string,
   *   label: string,
   *   side?: 'above' | 'below' | 'left' | 'right',
   *   offset?: number,
   * }>}
   */
  export let annotations = [];

  /** @type {number} Scale factor (applied via CSS font-size on the container) */
  export let scale = 3;

  /** @type {number} Default offset from term edge to label (px) */
  export let defaultOffset = 32;

  /** @type {boolean} Show debug bounding boxes */
  export let debug = false;

  let container;
  let svgOverlay;
  let eqDiv;
  let resizeObserver;
  let mounted = false;

  // Maps color -> SVG <g> element (recorded before color reset)
  let colorGroupEls = new Map();

  const uid = "eq" + Math.random().toString(36).slice(2, 8);

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

    // Render equation to SVG via MathJax and insert as inline SVG in the DOM
    const node = await window.MathJax.tex2svgPromise(tex, { display: true });
    const svg = node.querySelector("svg");
    if (!svg) return;

    svg.removeAttribute("style");
    svg.style.display = "inline-block";
    svg.style.verticalAlign = "middle";
    eqDiv.innerHTML = "";
    eqDiv.appendChild(svg);

    // Find color groups and record them, then reset colors to black
    colorGroupEls = new Map();
    for (const ann of annotations) {
      const group = svg.querySelector(`g[fill="${ann.color}"]`);
      if (group) {
        colorGroupEls.set(ann.color, group);
        group.setAttribute("fill", "currentColor");
        group.setAttribute("stroke", "currentColor");
      }
    }

    // Wait for browser layout
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    drawAnnotations();
  }

  function clearOverlay() {
    if (!svgOverlay) return;
    while (svgOverlay.children.length > 1) {
      svgOverlay.removeChild(svgOverlay.lastChild);
    }
  }

  function drawAnnotations() {
    if (!container || !svgOverlay) return;
    clearOverlay();

    const cRect = container.getBoundingClientRect();
    svgOverlay.setAttribute("viewBox", `0 0 ${cRect.width} ${cRect.height}`);

    for (const annot of annotations) {
      const groupEl = colorGroupEls.get(annot.color);
      if (!groupEl) continue;

      const r = groupEl.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      const box = {
        x: r.left - cRect.left,
        y: r.top - cRect.top,
        w: r.width,
        h: r.height,
      };

      if (debug) drawDebugBox(box, annot);
      drawBox(box, annot);
      drawArrowAndLabel(box, annot);
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
    const pad = 3;
    svgOverlay.appendChild(
      makeSVG("rect", {
        x: box.x - pad,
        y: box.y - pad,
        width: box.w + pad * 2,
        height: box.h + pad * 2,
        rx: 4,
        fill: annot.color + "1a",
        stroke: annot.color,
        "stroke-width": 1.5,
      })
    );
  }

  function drawArrowAndLabel(box, annot) {
    const { side = "below", offset = defaultOffset, color, label } = annot;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;

    let x1, y1, x2, y2, textX, textY, textAnchor;

    if (side === "above") {
      x1 = cx;   y1 = box.y - 3;
      x2 = cx;   y2 = box.y - offset;
      textX = cx; textY = y2 - 8;
      textAnchor = "middle";
    } else if (side === "below") {
      x1 = cx;   y1 = box.y + box.h + 3;
      x2 = cx;   y2 = box.y + box.h + offset;
      textX = cx; textY = y2 + 14;
      textAnchor = "middle";
    } else if (side === "left") {
      x1 = box.x - 3;       y1 = cy;
      x2 = box.x - offset;   y2 = cy;
      textX = x2 - 6;        textY = cy + 4;
      textAnchor = "end";
    } else {
      x1 = box.x + box.w + 3;       y1 = cy;
      x2 = box.x + box.w + offset;   y2 = cy;
      textX = x2 + 6;                textY = cy + 4;
      textAnchor = "start";
    }

    // Curved dashed arrow
    const my = (y1 + y2) / 2;
    svgOverlay.appendChild(
      makeSVG("path", {
        d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`,
        fill: "none",
        stroke: color,
        "stroke-width": 1.2,
        "stroke-dasharray": "4 3",
        "marker-end": `url(#${uid}-arrowhead)`,
      })
    );

    // Label pill
    const pillW = label.length * 6.8 + 16;
    const pillX =
      textAnchor === "middle"
        ? textX - pillW / 2
        : textAnchor === "end"
          ? textX - pillW
          : textX;
    svgOverlay.appendChild(
      makeSVG("rect", {
        x: pillX,
        y: textY - 14,
        width: pillW,
        height: 18,
        rx: 9,
        fill: color + "1a",
        stroke: color,
        "stroke-width": 0.8,
      })
    );

    const text = makeSVG("text", {
      x: textX,
      y: textY,
      "text-anchor": textAnchor,
      "font-size": 11,
      "font-family": "sans-serif",
      fill: color,
    });
    text.textContent = label;
    svgOverlay.appendChild(text);
  }

  function makeSVG(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }
</script>

<div class="eq-wrap" bind:this={container} style="font-size: {scale}em;">
  <div bind:this={eqDiv}></div>

  <svg bind:this={svgOverlay} class="annot-overlay" aria-hidden="true">
    <defs>
      <marker
        id="{uid}-arrowhead"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path
          d="M2 2L8 5L2 8"
          fill="none"
          stroke="context-stroke"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </marker>
    </defs>
  </svg>
</div>

<style>
  .eq-wrap {
    position: relative;
    display: inline-block;
    padding: 48px 32px;
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
