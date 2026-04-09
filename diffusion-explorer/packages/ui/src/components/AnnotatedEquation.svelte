<script>
  import { onMount, onDestroy, getContext } from "svelte";
  import { loadMathJax } from "../plotting/mathjax";

  const _ctx = getContext('annotatedEquationDefaults') ?? {};

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
  export let verticalGap = 56;

  /** @type {number} Extra vertical gap added to 'below' annotations where the label sits above the elbow (px) */
  export let belowExtraGap = 20;

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

  /** @type {'elbow' | 'curve'} Connector style: L-shaped elbow or smooth cubic bezier */
  export let connectorStyle = _ctx.connectorStyle ?? 'elbow';

  /** @type {number} Extra horizontal push applied to label text in curve mode (px) */
  export let curveOffset = _ctx.curveOffset ?? 40;

  let container;
  let svgOverlay;
  let eqDiv;
  let resizeObserver;
  let mounted = false;

  let colorGroupEls = new Map();

  let resizeTimer = null;
  let revealHandlers = [];
  let scaleDown = 1; // dynamic scale to fit within parent width
  let insideReveal = false; // skip scaleDown when Reveal.js handles scaling

  onMount(async () => {
    // Detect Reveal.js early — it handles viewport scaling, so skip scaleDown
    if (typeof window !== 'undefined' && window.Reveal) {
      insideReveal = true;
    }

    await loadMathJax();
    mounted = true;
    await renderAndAnnotate();

    resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { updateScaleDown(); drawAnnotations(); }, 300);
    });
    resizeObserver.observe(container.parentElement || container);

    // Listen to Reveal.js lifecycle events for overview mode transitions
    if (typeof window !== 'undefined' && window.Reveal) {
      const onOverviewShown = () => { inOverview = true; clearOverlay(); };
      const onOverviewHidden = () => { inOverview = false; setTimeout(() => drawAnnotations(), 100); };
      const onSlideChanged = () => setTimeout(() => drawAnnotations(), 50);

      window.Reveal.on('overviewshown', onOverviewShown);
      window.Reveal.on('overviewhidden', onOverviewHidden);
      window.Reveal.on('slidechanged', onSlideChanged);

      revealHandlers = [
        ['overviewshown', onOverviewShown],
        ['overviewhidden', onOverviewHidden],
        ['slidechanged', onSlideChanged],
      ];
    }
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    // Clean up Reveal.js listeners
    if (typeof window !== 'undefined' && window.Reveal) {
      for (const [event, handler] of revealHandlers) {
        window.Reveal.off(event, handler);
      }
    }
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

    // Compute padding: just enough for the annotations
    const aboveCount = annotations.filter((a) => a.side === "above").length;
    const belowCount = annotations.filter((a) => !a.side || a.side === "below").length;
    const maxAboveStack = Math.max(0, aboveCount - 1);
    const maxBelowStack = Math.max(0, belowCount - 1);
    const topPad = aboveCount > 0 ? verticalGap + maxAboveStack * rowSpacing + labelFontSize * 1.5 + 8 : 4;
    const bottomPad = belowCount > 0 ? verticalGap + belowExtraGap + maxBelowStack * rowSpacing + labelFontSize + 20 : 4;
    container.style.paddingTop = `${topPad}px`;
    container.style.paddingBottom = `${bottomPad}px`;
    // No horizontal padding — annotations draw outside bounds via overflow: visible
    container.style.paddingLeft = '0px';
    container.style.paddingRight = '0px';

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    updateScaleDown();
    drawAnnotations();
  }

  let measuring = false;
  function updateScaleDown() {
    if (!container || measuring) return;
    // Reveal.js already scales the entire slide to fit the viewport —
    // applying our own scaleDown fights with it and causes equations to
    // overflow on mobile or disappear when switching back to desktop.
    if (insideReveal) {
      scaleDown = 1;
      container.style.transform = 'none';
      return;
    }
    measuring = true;
    // Temporarily reset scale to measure natural width
    const prevTransform = container.style.transform;
    container.style.transform = 'none';
    const parent = container.parentElement;
    if (!parent) { container.style.transform = prevTransform; measuring = false; return; }
    const parentWidth = parent.clientWidth;
    const naturalWidth = container.scrollWidth;
    const newScale = (naturalWidth > parentWidth && parentWidth > 0)
      ? parentWidth / naturalWidth
      : 1;
    // Only update if meaningfully different
    if (Math.abs(newScale - scaleDown) > 0.01) {
      scaleDown = newScale;
    }
    container.style.transform = scaleDown < 1 ? `scale(${scaleDown})` : 'none';
    container.style.transformOrigin = 'center top';
    measuring = false;
  }

  function clearOverlay() {
    if (!svgOverlay) return;
    while (svgOverlay.firstChild) {
      svgOverlay.removeChild(svgOverlay.firstChild);
    }
  }

  let inOverview = false;

  function drawAnnotations() {
    if (!container || !svgOverlay) return;
    if (inOverview) return;
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

    // Pre-compute text extents to detect horizontal overlaps on the same side.
    // Render temporary hidden text elements to measure widths.
    const labelGapX = 12;
    for (const item of resolved) {
      const cx = item.box.x + item.box.w / 2;
      const extraPush = connectorStyle === 'curve' ? curveOffset : 0;
      const textStartX = item.resolvedAlign === "left" ? cx - labelGapX - extraPush : cx + labelGapX + extraPush;
      const tmpText = makeSVG("text", {
        x: textStartX,
        y: 0,
        "text-anchor": item.resolvedAlign === "left" ? "end" : "start",
        "font-size": labelFontSize,
        "font-family": "inherit",
        visibility: "hidden",
      });
      tmpText.textContent = item.label;
      svgOverlay.appendChild(tmpText);
      const textWidth = tmpText.getComputedTextLength();
      svgOverlay.removeChild(tmpText);

      const elbowOverhang = 10;
      if (item.resolvedAlign === "left") {
        item.labelLeft = textStartX - textWidth - elbowOverhang;
        item.labelRight = cx;
      } else {
        item.labelLeft = cx;
        item.labelRight = textStartX + textWidth + elbowOverhang;
      }
    }

    // Check for horizontal overlaps on the same side.
    // If two annotations on the same side overlap horizontally,
    // the more central one gets bumped further away (higher elbowLevel).
    for (const item of resolved) {
      item.elbowLevel = 0;
    }

    const sides = ["above", "below"];
    for (const side of sides) {
      const sideItems = resolved.filter((it) => it.resolvedSide === side);
      // Sort by distance from center (outermost first)
      sideItems.sort(
        (a, b) =>
          Math.abs(b.box.x + b.box.w / 2 - eqCenterX) -
          Math.abs(a.box.x + a.box.w / 2 - eqCenterX)
      );

      // Greedily assign levels: for each item, check if it overlaps
      // with any already-placed item at the same level
      for (let i = 0; i < sideItems.length; i++) {
        const curr = sideItems[i];
        let level = 0;
        let hasOverlap = true;
        while (hasOverlap) {
          hasOverlap = false;
          for (let j = 0; j < i; j++) {
            const other = sideItems[j];
            if (other.elbowLevel === level) {
              // Check horizontal overlap
              if (curr.labelLeft < other.labelRight && curr.labelRight > other.labelLeft) {
                hasOverlap = true;
                level++;
                break;
              }
            }
          }
        }
        curr.elbowLevel = level;
      }
    }

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

  function ensureArrowMarker(color) {
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
    return markerId;
  }

  function drawLConnector(item, eqTop, eqBottom) {
    const { box, color, label, resolvedSide, resolvedAlign, stackIndex } = item;
    const markerId = ensureArrowMarker(color);

    // Above/below annotations
    const cx = box.x + box.w / 2;
    const arrowGap = 10;
    const levelOffset = (item.elbowLevel || 0) * rowSpacing;
    let tipY, elbowY;
    if (resolvedSide === "above") {
      tipY = box.y - boxPadding - arrowGap;
      elbowY = eqTop - verticalGap - levelOffset;
    } else {
      tipY = box.y + box.h + boxPadding + arrowGap;
      elbowY = eqBottom + verticalGap + belowExtraGap + levelOffset;
    }

    const labelGapY = labelFontSize * 0.4;
    const labelGapX = 12;
    const textAnchor = resolvedAlign === "left" ? "end" : "start";
    const textY = elbowY - labelGapY;
    const extraPush = connectorStyle === 'curve' ? curveOffset : 0;
    const textStartX = resolvedAlign === "left" ? cx - labelGapX - extraPush : cx + labelGapX + extraPush;

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

    if (connectorStyle === 'curve') {
      // Arrow departs from the vertical center of the label text, with a small gap
      const textCenterY = textY - labelFontSize * 0.3;
      const arrowGapX = 10;
      const arrowStartX = resolvedAlign === "left" ? textStartX + arrowGapX : textStartX - arrowGapX;
      // Cubic bezier: CP1 pulls horizontally to cx at text center; CP2 guides approach along cx
      const cp1x = cx, cp1y = textCenterY;
      const cp2x = cx, cp2y = (textCenterY + tipY) / 2;
      svgOverlay.appendChild(
        makeSVG("path", {
          d: `M ${arrowStartX} ${textCenterY} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${cx} ${tipY}`,
          fill: "none",
          stroke: color,
          "stroke-width": 2.5,
          "marker-end": `url(#${markerId})`,
        })
      );
    } else {
      // Elbow: horizontal arm from label end to cx, then vertical to term
      const textWidth = text.getComputedTextLength();
      const elbowOverhang = 10;
      let endX;
      if (resolvedAlign === "left") {
        endX = textStartX - textWidth - elbowOverhang;
      } else {
        endX = textStartX + textWidth + elbowOverhang;
      }
      svgOverlay.appendChild(
        makeSVG("path", {
          d: `M ${endX} ${elbowY} L ${cx} ${elbowY} L ${cx} ${tipY}`,
          fill: "none",
          stroke: color,
          "stroke-width": 2.5,
          "marker-end": `url(#${markerId})`,
        })
      );
    }
  }

  function makeSVG(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }
</script>

<div class="eq-wrap" bind:this={container} style="font-size: {scale}em; transform: {scaleDown < 1 ? `scale(${scaleDown})` : 'none'}; transform-origin: center top;">
  <svg bind:this={svgOverlay} class="annot-overlay" aria-hidden="true"></svg>

  <div class="eq-content" bind:this={eqDiv}></div>
</div>

<style>
  .eq-wrap {
    position: relative;
    display: block;
    margin: 0 auto;
    width: fit-content;
    max-width: 100%;
    padding: 8px;
    overflow: visible;
  }

  .eq-content {
    position: relative;
    text-align: center;
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
