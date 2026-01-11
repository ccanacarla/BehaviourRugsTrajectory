/**
 * Parser robusto para trajetórias espaciais vindas de Python / Pandas.
 * Aceita formatos como:
 *  - "[(0.1, 0.2), (0.3, 0.4)]"
 *  - com newlines, vírgula final, expoentes, etc.
 *  - ignora None / nan / inf
 */

import { CLUSTER_COLORS } from './config.js';
import { parseTrajectoryData } from './dataUtils.js';

/**
 * Desenha a visualização da trajetória.
 *
 * @param {Object|Array} data - Single object or Array of objects (trajectory rows).
 * @param {string} containerSelector
 * @param {Object} [opts]
 * @param {{x:[number,number], y:[number,number]}} [opts.fixedDomain]
 * @param {string} [opts.highlightId] - ID of a trajectory to highlight in multi-view.
 * @param {Array|Set} [opts.highlightIds] - IDs of multiple trajectories to highlight.
 * @param {Set} [opts.highlightLentoIndices]
 * @param {Set} [opts.highlightTurnIndices]
 */
export function drawTrajectoryView(data, containerSelector, opts = {}) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  // Handle single item or array
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return;

      const isMulti = rows.length > 1;
    const highlightId = opts.highlightId;
    const highlightIds = opts.highlightIds ? new Set(opts.highlightIds) : null;
    const highlightColor = opts.highlightColor || "#ffeb3b";
  
  const wrapper = container.append("div")
    .attr("class", "trajectory-view-wrapper")
    .style("width", "100%")
    .style("height", "auto")
    .style("border-radius", "6px")
    .style("margin-bottom", "10px")
    .style("background", "#fff")
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
      .attr("name", "traj_view_mode_all")
      .attr("value", opt.key)
      .property("checked", i === 0)
      .on("change", function () {
        if (this.checked) {
          currentKey = opt.key;
          updatePlot();
        }
      });

    label.append("span").text(opt.label);
  });

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

  // Clip path for zooming
  const clipId = `clip-${Math.random().toString(36).substr(2, 9)}`;
  const defs = svg.append("defs");
  defs.append("clipPath")
      .attr("id", clipId)
      .append("rect")
      .attr("width", innerW)
      .attr("height", innerH);

  // Note: 'g' is already defined above

  const pathsGroup = g.append("g")
      .attr("class", "paths-group")
      .attr("clip-path", `url(#${clipId})`);

  const xAxisG = g.append("g")
    .attr("transform", `translate(0, ${innerH})`);

  const yAxisG = g.append("g");

  // ==================================================
  // 3) Atualização do Plot
  // ==================================================
  function updatePlot() {
    // Parse all trajectories
    const parsedData = rows.map(d => {
        const r = d.raw || d;
        const val = r[currentKey] ? (r[currentKey].raw || r[currentKey]) : "";
        return {
            id: r.trajectory_id,
            cluster: r.cluster,
            points: parseTrajectoryData(val)
        };
    }).filter(d => d.points.length > 0);

    if (parsedData.length === 0) {
      pathsGroup.selectAll("*").remove();
      return;
    }

    // Determine domain
    let xDomain, yDomain;

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

    const xScale = d3.scaleLinear().domain(xDomain).range([0, innerW]);
    const yScale = d3.scaleLinear().domain(yDomain).range([innerH, 0]);

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
            if (highlightIds && highlightIds.has(d.id)) {
                return CLUSTER_COLORS[Math.abs(+d.cluster % CLUSTER_COLORS.length)];
            }
            return "#022fab";
        })
        .attr("stroke-width", d => {
             if (highlightId && d.id === highlightId) return 3; 
             if (highlightIds && highlightIds.has(d.id)) return 2;
             return isMulti ? 1 : 2;
        })
        .attr("opacity", d => {
             if (highlightId && d.id === highlightId) return 1;
             if (highlightIds && highlightIds.has(d.id)) return 1;
             if (highlightId || highlightIds) return 0.1; // Dim others significantly
             return isMulti ? 0.5 : 1;
        })
        // Sort to ensure highlighted is on top
        .selection().sort((a, b) => {
             const aH = (highlightId && a.id === highlightId) || (highlightIds && highlightIds.has(a.id));
             const bH = (highlightId && b.id === highlightId) || (highlightIds && highlightIds.has(b.id));
             if (aH && !bH) return 1;
             if (!aH && bH) return -1;
             return 0;
        });

    // Zoom Behavior
    const zoom = d3.zoom()
      .scaleExtent([0.5, 50])
      .extent([[0, 0], [innerW, innerH]])
      .on("zoom", (event) => {
        const newX = event.transform.rescaleX(xScale);
        const newY = event.transform.rescaleY(yScale);

        xAxisG.call(d3.axisBottom(newX).ticks(5));
        yAxisG.call(d3.axisLeft(newY).ticks(5));

        const newLine = d3.line()
          .x(p => newX(p[0]))
          .y(p => newY(p[1]));

        pathsGroup.selectAll(".traj-path")
          .attr("d", d => newLine(d.points));
      });

    // Apply zoom and reset to identity on update
    svg.call(zoom).call(zoom.transform, d3.zoomIdentity);
    svg.style("cursor", "move");

    // Title update
    let titleText;
    if (highlightId) {
        titleText = `Trajectory ${highlightId} <br> (in context of ${parsedData.length})`;
    } else {
        titleText = isMulti ? `${parsedData.length} Trajectories Selected` : `Trajectory ID: ${rows[0].trajectory_id || rows[0].id}`;
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
