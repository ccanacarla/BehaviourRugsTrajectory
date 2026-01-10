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
 * @param {Object|Array} data - Single object or Array of objects (trajectory rows).
 * @param {string} containerSelector
 * @param {Object} [opts]
 * @param {{x:[number,number], y:[number,number]}} [opts.fixedDomain]
 * @param {string} [opts.highlightId] - ID of a trajectory to highlight in multi-view.
 * @param {Set} [opts.highlightLentoIndices]
 * @param {Set} [opts.highlightTurnIndices]
 * @param {Set} [opts.highlightCustomIndices]
 */
export function drawTrajectoryView(data, containerSelector, opts = {}) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  // Handle single item or array
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return;

      const isMulti = rows.length > 1;
    const highlightId = opts.highlightId;
    const highlightColor = opts.highlightColor || "#7f7f7eff";
  
    // Se você não passar fixedDomain, usa este default (ajuste conforme seu dataset)
    const DEFAULT_FIXED_DOMAIN = opts.fixedDomain || { x: [-1, 1], y: [-1, 1] };
  const wrapper = container.append("div")
    .attr("class", "trajectory-view-wrapper")
    .style("width", "100%")
    .style("border-radius", "6px")
    .style("margin-bottom", "10px")
    .style("background", "#fff")
    .style("height", "auto")
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

  // Animation state (Only for single trajectory)
  let isPlaying = false;
  let animationId = null;
  let currentPointIndex = 0;
  let animationPoints = [];
  let animXScale, animYScale;

  // --- Grupo A: tipo de trajetória ---
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

  // --- Grupo B: modo de escala ---
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

  // --- Grupo C: Playback ---
  let playBtn, timelineSlider;
  
  // Show playback if single OR if multi-view but highlighting one specific trajectory
  // (Optional: for now, keep simplistic and only show play if truly single row passed, 
  // or disable playback when viewing context to avoid confusion)
  if (!isMulti) {
      const playbackGroup = controls.append("div")
        .style("display", "flex")
        .style("gap", "8px")
        .style("align-items", "center");

      playBtn = playbackGroup.append("button")
          .text("Play")
          .style("cursor", "pointer")
          .style("padding", "2px 6px")
          .style("font-size", "10px");

      timelineSlider = playbackGroup.append("input")
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
  }

  // ==================================================
  // 2) Área do Plot
  // ==================================================
  const width = 420;
  const height = 220;
  const margin = { top: 0, right: 20, bottom: 10, left: 45 };

  const svg = wrapper.append("svg")
    .attr("width", "100%")
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .style("background", "#fff");

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})
`);

  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const pathsGroup = g.append("g").attr("class", "paths-group");

  const xAxisG = g.append("g")
    .attr("transform", `translate(0, ${innerH})
`);

  const yAxisG = g.append("g");

  // Single mode markers
  const startPoint = g.append("circle")
    .attr("r", 4)
    .attr("fill", "green")
    .style("display", "none");

  const endPoint = g.append("circle")
    .attr("r", 4)
    .attr("fill", "red")
    .style("display", "none");

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
      if(playBtn) playBtn.text("Play");
      if (animationId) cancelAnimationFrame(animationId);
      animationId = null;
  }

  function stopAnimation() {
      pauseAnimation();
      currentPointIndex = 0;
      if(timelineSlider) timelineSlider.property("value", 0);
      tracker.style("display", "none");
  }

  function startAnimation() {
      if (!animationPoints.length) return;
      isPlaying = true;
      if(playBtn) playBtn.text("Pause");
      tracker.style("display", null);
      
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
      if(timelineSlider) timelineSlider.property("value", currentPointIndex);
  }

  function animate() {
      if (!isPlaying) return;
      updateTrackerPosition();
      currentPointIndex++;
      if (currentPointIndex < animationPoints.length) {
          animationId = requestAnimationFrame(animate);
      } else {
          pauseAnimation(); 
      }
  }

  function updatePlot() {
    stopAnimation();
    
    // Parse all trajectories
    const parsedData = rows.map(d => {
        const r = d.raw || d;
        const val = r[currentKey] ? (r[currentKey].raw || r[currentKey]) : "";
        return {
            id: r.trajectory_id,
            points: parseTrajectoryData(val)
        };
    }).filter(d => d.points.length > 0);

    if (parsedData.length === 0) {
      pathsGroup.selectAll("*").remove();
      return;
    }

    // Determine target for single-mode features
    // If multi but highlightId exists, we can optionally point to that. 
    // But for simplicity, animation/start/end is only for strict single mode.
    if (!isMulti) {
        animationPoints = parsedData[0].points;
        if(timelineSlider) timelineSlider.attr("max", animationPoints.length > 0 ? animationPoints.length - 1 : 0);
    }

    // Determine domain
    let xDomain, yDomain;

    if (scaleMode === "fixed") {
      xDomain = DEFAULT_FIXED_DOMAIN.x;
      yDomain = DEFAULT_FIXED_DOMAIN.y;
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      
      parsedData.forEach(d => {
          const xe = d3.extent(d.points, p => p[0]);
          const ye = d3.extent(d.points, p => p[1]);
          if (xe[0] < minX) minX = xe[0];
          if (xe[1] > maxX) maxX = xe[1];
          if (ye[0] < minY) minY = ye[0];
          if (ye[1] > maxY) maxY = ye[1];
      });

      const xPad = (maxX - minX) * 0.1 || 1;
      const yPad = (maxY - minY) * 0.1 || 1;
      xDomain = [minX - xPad, maxX + xPad];
      yDomain = [minY - yPad, maxY + yPad];
    }

    const xScale = d3.scaleLinear().domain(xDomain).range([0, innerW]);
    const yScale = d3.scaleLinear().domain(yDomain).range([innerH, 0]);

    animXScale = xScale;
    animYScale = yScale;

    const line = d3.line()
      .x(p => xScale(p[0]))
      .y(p => yScale(p[1]));

    xAxisG.transition().duration(250).call(d3.axisBottom(xScale).ticks(5));
    yAxisG.transition().duration(250).call(d3.axisLeft(yScale).ticks(5));

    // Bind data to paths
    const paths = pathsGroup.selectAll(".traj-path")
        .data(parsedData, d => d.id);

    paths.exit().remove();

    const pathsEnter = paths.enter().append("path")
        .attr("class", "traj-path")
        .attr("fill", "none")
        .attr("stroke-linecap", "round");

    pathsEnter.merge(paths)
        .transition()
        .duration(450)
        .attr("d", d => line(d.points))
        .attr("stroke", d => {
            if (highlightId && d.id === highlightId) return highlightColor; // Selected: Dynamic color
            return "#022fab";
        })
        .attr("stroke-width", d => {
             if (highlightId && d.id === highlightId) return 3; 
             return isMulti ? 1 : 2;
        })
        .attr("opacity", d => {
             if (highlightId && d.id === highlightId) return 1;
             if (highlightId) return 0.1; // Dim others significantly
             return isMulti ? 0.3 : 1;
        })
        // Sort to ensure highlighted is on top
        .selection().sort((a, b) => {
             if (a.id === highlightId) return 1;
             if (b.id === highlightId) return -1;
             return 0;
        });

    // Clean up single-mode overlays if switching to multi
    g.selectAll(".highlight-group").remove();
    startPoint.style("display", "none");
    endPoint.style("display", "none");

    // Re-add single mode overlays if strictly single
    if (!isMulti && parsedData[0]) {
        const points = parsedData[0].points;
        const pStart = points[0];
        const pEnd = points[points.length - 1];

        startPoint.style("display", null)
            .attr("cx", xScale(pStart[0])).attr("cy", yScale(pStart[1]));
        endPoint.style("display", null)
            .attr("cx", xScale(pEnd[0])).attr("cy", yScale(pEnd[1]));

        if (opts.highlightLentoIndices || opts.highlightTurnIndices || opts.highlightCustomIndices) {
            const hG = g.append("g").attr("class", "highlight-group");
            const drawHighlights = (indices, color, type) => {
                if (!indices || indices.size === 0) return;
                points.forEach((p, i) => {
                    if (i < points.length - 1 && indices.has(i) && indices.has(i + 1)) {
                        hG.append("line")
                            .attr("x1", xScale(p[0])).attr("y1", yScale(p[1]))
                            .attr("x2", xScale(points[i+1][0])).attr("y2", yScale(points[i+1][1]))
                            .attr("stroke", color).attr("stroke-width", 4)
                            .attr("stroke-opacity", 0.6);
                    }
                    if (indices.has(i)) {
                        hG.append("circle")
                            .attr("cx", xScale(p[0])).attr("cy", yScale(p[1]))
                            .attr("r", 3).attr("fill", color);
                    }
                });
            };
            if (opts.highlightLentoIndices) drawHighlights(opts.highlightLentoIndices, "orange", "Very Slow");
            if (opts.highlightTurnIndices) drawHighlights(opts.highlightTurnIndices, "#9b59b6", "Abrupt Turn");
            if (opts.highlightCustomIndices) drawHighlights(opts.highlightCustomIndices, "#16a085", "Custom Motif");
        }
    }

    // Title update
    let titleText;
    if (highlightId) {
        titleText = `Trajectory ${highlightId} <br> (in context of ${parsedData.length})`;
    } else {
        titleText = isMulti ? `${parsedData.length} Trajectories Selected` : `Trajetória ID: ${rows[0].trajectory_id || rows[0].id}`;
    }

    wrapper.select(".chart-title").remove();
    wrapper.insert("div", "svg")
       .attr("class", "chart-title")
       .style("text-align", "center")
       .style("font-size", "11px")
       .style("color", "#666")
       .style("margin-bottom", "2px")
       .html(`${titleText}`);
  }

  updatePlot();
}
