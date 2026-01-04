/**
 * Parser robusto para trajetórias espaciais vindas de Python / Pandas.
 * Aceita formatos como:
 *  - "[(0.1, 0.2), (0.3, 0.4)]"
 *  - com newlines, vírgula final, expoentes, etc.
 *  - ignora None / nan / inf
 */
function parseTrajectoryData(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str;

  const s = String(str).trim();
  if (!s) return [];

  const num = "[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?";
  const pairRe = new RegExp(`\\(\\s*(${num})\\s*,\\s*(${num})\\s*\\)`, "g");

  const points = [];
  let m;

  while ((m = pairRe.exec(s)) !== null) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
  }

  if (!points.length) {
    const allNums = s.match(new RegExp(num, "g")) || [];
    for (let i = 0; i + 1 < allNums.length; i += 2) {
      const x = Number(allNums[i]);
      const y = Number(allNums[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
    }
  }

  return points;
}

/**
 * Desenha a visualização da trajetória.
 *
 * @param {Object} d - linha do CSV ou datum normalizado (com d.raw)
 * @param {string} containerSelector
 * @param {Object} [opts]
 * @param {{x:[number,number], y:[number,number]}} [opts.fixedDomain]
 *        Domínio fixo global para comparar todas as trajetórias.
 *        Ex: { x: [-10, 10], y: [-10, 10] }
 */
export function drawTrajectoryView(d, containerSelector, opts = {}) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  const row = d?.raw ? d.raw : d;

  // Se você não passar fixedDomain, usa este default (ajuste conforme seu dataset)
  const DEFAULT_FIXED_DOMAIN = opts.fixedDomain || { x: [-1, 1], y: [-1, 1] };

  const wrapper = container.append("div")
    .attr("class", "trajectory-view-wrapper")
    .style("width", "100%")
    .style("border-radius", "6px")
    .style("margin-bottom", "10px")
    .style("background", "#fff")
    .style("border", "1px solid #ddd")
    .style("padding", "0px");

  // ==================================================
  // 1) Controles
  // ==================================================
  const controls = wrapper.append("div")
    .attr("class", "trajectory-controls")
    .style("margin-bottom", "10px")
    .style("display", "flex")
    .style("flex-direction", "column") // Stacked vertically
    .style("gap", "8px")
    .style("font-size", "12px")
    .style("background", "#ccccccff")
    .style("padding", "8px")
    .style("border-radius", "6px 6px 0px 0px")
    .style("border", "1px 1px 1px 0px solid #ccc");

  // Animation state
  let isPlaying = false;
  let animationId = null;
  let currentPointIndex = 0;
  let animationPoints = [];
  let animXScale, animYScale;

  // --- Grupo A: tipo de trajetória (Now Third) ---
  const trajGroup = controls.append("div")
    .style("display", "flex")
    .style("gap", "12px")
    .style("align-items", "center");

  trajGroup.append("span")
    .style("font-weight", "bold")
    .text("Trajectory:");

  const trajOptions = [
    { label: "Original", key: "trajectory_xy" },
    { label: "Translate",    key: "trajectory_xy_translate" },
    { label: "Rotate",    key: "trajectory_xy_rotated" }
  ];

  let currentKey = trajOptions[0].key;

  trajOptions.forEach((opt, i) => {
    const label = trajGroup.append("label")
      .style("cursor", "pointer")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "4px");

    label.append("input")
      .attr("type", "radio")
      .attr("name", "traj_view_mode")
      .attr("value", opt.key)
      .property("checked", i === 0)
      .on("change", function () {
        if (this.checked) {
          stopAnimation();
          currentKey = opt.key;
          updatePlot();
        }
      });

    label.append("span").text(opt.label);
  });

  // --- Grupo B: modo de escala (Now Second) ---
  const scaleGroup = controls.append("div")
    .style("display", "flex")
    .style("gap", "12px")
    .style("align-items", "center");

  scaleGroup.append("span")
    .style("font-weight", "bold")
    .text("Scale:");

  let scaleMode = "auto";
  const scaleOptions = [
    { label: "Auto",  value: "auto" },
    { label: "Fixed",  value: "fixed" }
  ];

  scaleOptions.forEach((opt, i) => {
    const label = scaleGroup.append("label")
      .style("cursor", "pointer")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "4px");

    label.append("input")
      .attr("type", "radio")
      .attr("name", "traj_scale_mode")
      .attr("value", opt.value)
      .property("checked", i === 0)
      .on("change", function () {
        if (this.checked) {
          stopAnimation();
          scaleMode = opt.value;
          updatePlot();
        }
      });

    label.append("span").text(opt.label);
  });

  // --- Grupo C: Playback (Now First) ---
  const playbackGroup = controls.append("div")
    .style("display", "flex")
    .style("gap", "8px")
    .style("align-items", "center");

  const playBtn = playbackGroup.append("button")
      .text("Play")
      .style("cursor", "pointer")
      .style("padding", "2px 6px")
      .style("font-size", "10px");

  const timelineSlider = playbackGroup.append("input")
      .attr("type", "range")
      .attr("min", 0)
      .attr("max", 100)
      .attr("value", 0)
      .style("flex-grow", "1")
      .style("cursor", "pointer");
  
  playBtn.on("click", () => {
      if (isPlaying) pauseAnimation();
      else startAnimation();
  });

  timelineSlider.on("input", function() {
      const val = +this.value;
      if (!animationPoints.length) return;
      currentPointIndex = val;
      updateTrackerPosition();
  });

  // ==================================================
  // 2) Área do Plot
  // ==================================================
  const width = 420;
  const height = 220;
  const margin = { top: 0, right: 10, bottom: 10, left: 45 };

  const svg = wrapper.append("svg")
    .attr("width", "100%")
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .style("background", "#fff");

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const path = g.append("path")
    .attr("fill", "none")
    .attr("stroke", "#022fab")
    .attr("stroke-width", 2);

  const xAxisG = g.append("g")
    .attr("transform", `translate(0, ${innerH})`);

  const yAxisG = g.append("g");

  const startPoint = g.append("circle")
    .attr("r", 4)
    .attr("fill", "green")
    .style("display", "none");

  const endPoint = g.append("circle")
    .attr("r", 4)
    .attr("fill", "red")
    .style("display", "none");

  // Tracker for animation
  const tracker = g.append("circle")
    .attr("r", 5)
    .attr("fill", "orange")
    .attr("stroke", "white")
    .attr("stroke-width", 1.5)
    .style("display", "none");

  // ==================================================
  // 3) Atualização do Plot
  // ==================================================
  function pauseAnimation() {
      isPlaying = false;
      playBtn.text("Play");
      if (animationId) cancelAnimationFrame(animationId);
      animationId = null;
  }

  function stopAnimation() {
      pauseAnimation();
      currentPointIndex = 0;
      timelineSlider.property("value", 0);
      tracker.style("display", "none");
  }

  function startAnimation() {
      if (!animationPoints.length) return;
      isPlaying = true;
      playBtn.text("Pause");
      tracker.style("display", null);
      
      // If at end, restart
      if (currentPointIndex >= animationPoints.length - 1) {
          currentPointIndex = 0;
      }
      animate();
  }

  function updateTrackerPosition() {
      const p = animationPoints[currentPointIndex];
      if (p && animXScale && animYScale) {
          tracker
             .attr("cx", animXScale(p[0]))
             .attr("cy", animYScale(p[1]));
      }
      // Sync slider if not dragging (simple sync)
      timelineSlider.property("value", currentPointIndex);
  }

  function animate() {
      if (!isPlaying) return;
      
      updateTrackerPosition();
      currentPointIndex++;
      
      if (currentPointIndex < animationPoints.length) {
          animationId = requestAnimationFrame(animate);
      } else {
          pauseAnimation(); // End of playback
      }
  }

  function updatePlot() {
    stopAnimation(); // Reset animation on data update

    const rawString = row[currentKey];

    if (!rawString) {
      path.attr("d", null);
      startPoint.style("display", "none");
      endPoint.style("display", "none");
      wrapper.select(".chart-title").remove();
      wrapper.select(".chart-subtitle").remove();
      return;
    }

    const points = parseTrajectoryData(rawString);
    animationPoints = points; // Store for animation
    
    // Update slider max
    timelineSlider.attr("max", points.length > 0 ? points.length - 1 : 0);

    if (!points.length) {
      console.warn("Trajetória vazia ou inválida:", row.trajectory_id, currentKey);
      path.attr("d", null);
      startPoint.style("display", "none");
      endPoint.style("display", "none");
      return;
    }

    let xDomain, yDomain;

    if (scaleMode === "fixed") {
      // Domínio fixo global
      xDomain = DEFAULT_FIXED_DOMAIN.x;
      yDomain = DEFAULT_FIXED_DOMAIN.y;
    } else {
      // Domínio automático (fit to data)
      const xExtent = d3.extent(points, p => p[0]);
      const yExtent = d3.extent(points, p => p[1]);

      const xPad = (xExtent[1] - xExtent[0]) * 0.1 || 1;
      const yPad = (yExtent[1] - yExtent[0]) * 0.1 || 1;

      xDomain = [xExtent[0] - xPad, xExtent[1] + xPad];
      yDomain = [yExtent[0] - yPad, yExtent[1] + yPad];
    }

    const xScale = d3.scaleLinear()
      .domain(xDomain)
      .range([0, innerW]);

    const yScale = d3.scaleLinear()
      .domain(yDomain)
      .range([innerH, 0]);

    // Store scales for animation
    animXScale = xScale;
    animYScale = yScale;

    const line = d3.line()
      .x(p => xScale(p[0]))
      .y(p => yScale(p[1]));

    xAxisG.transition().duration(250).call(d3.axisBottom(xScale).ticks(5));
    yAxisG.transition().duration(250).call(d3.axisLeft(yScale).ticks(5));

    path.datum(points)
      .transition()
      .duration(450)
      .attr("d", line);

    // Highlight segments
    g.selectAll(".highlight-group").remove();
    const hG = g.append("g").attr("class", "highlight-group");

    const drawHighlights = (indices, color) => {
      if (!indices || indices.size === 0) return;
      
      points.forEach((p, i) => {
        // Draw segment if i and i+1 are highlighted
        if (i < points.length - 1 && indices.has(i) && indices.has(i + 1)) {
          hG.append("line")
            .attr("x1", xScale(p[0]))
            .attr("y1", yScale(p[1]))
            .attr("x2", xScale(points[i + 1][0]))
            .attr("y2", yScale(points[i + 1][1]))
            .attr("stroke", color)
            .attr("stroke-width", 4)
            .attr("stroke-opacity", 0.6)
            .attr("stroke-linecap", "round");
        }
        // Draw point if i is highlighted
        if (indices.has(i)) {
          hG.append("circle")
            .attr("cx", xScale(p[0]))
            .attr("cy", yScale(p[1]))
            .attr("r", 3)
            .attr("fill", color);
        }
      });
    };

    if (opts.highlightLentoIndices) drawHighlights(opts.highlightLentoIndices, "orange");
    if (opts.highlightTurnIndices) drawHighlights(opts.highlightTurnIndices, "#9b59b6");

    const pStart = points[0];
    const pEnd = points[points.length - 1];

    // Se escala fixa e o ponto estiver fora do domínio, ainda desenha, mas pode “sumir”.
    // Isso é esperado: você está comparando numa mesma janela.
    startPoint
      .style("display", null)
      .attr("cx", xScale(pStart[0]))
      .attr("cy", yScale(pStart[1]));

    endPoint
      .style("display", null)
      .attr("cx", xScale(pEnd[0]))
      .attr("cy", yScale(pEnd[1]));
/*
    // Título / subtítulo
    wrapper.select(".chart-title").remove();
    wrapper.select(".chart-subtitle").remove();

    wrapper.insert("div", "svg")
      .attr("class", "chart-title")
      .style("text-align", "center")
      .style("font-size", "11px")
      .style("color", "#666")
      .style("margin-bottom", "2px")
      .text(`Trajetória ID: ${row.trajectory_id} — ${currentKey}`);

    wrapper.insert("div", "svg")
      .attr("class", "chart-subtitle")
      .style("text-align", "center")
      .style("font-size", "10px")
      .style("color", "#888")
      .style("margin-bottom", "6px")
      .text(`Escala: ${scaleMode === "fixed" ? "Fixa" : "Auto"} | Domínio X: [${xDomain[0]}, ${xDomain[1]}], Y: [${yDomain[0]}, ${yDomain[1]}]`);
      */
  }
      

  updatePlot();
}
