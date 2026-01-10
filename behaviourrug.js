import { VISUALIZATION_CONFIG, DIRECTION_STRINGS, CLUSTER_COLORS } from './config.js';
import { eventManager } from './events.js';
import {
  getSpeed, getDirection, getLentoIndices, getTurnIndices, getCustomMotifIndices,
  parseTrajectoryData, calculateDuration, calculateStraightLineDistance
} from './dataUtils.js';

/**
 * Draws the Behavior Rug visualization.
 * @param {Array} data - Dataset to render.
 * @param {String} containerSelector - Target DOM.
 * @param {Object} [config=null] - Optional initial configuration { activeMotifs, column }.
 */
export function drawBehaviorRug(data, containerSelector, config = null) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  // ==================================================
  // 0) Estado
  // ==================================================
  let selectedTrajectoryId = null;
  let sequences = [];

  // Initialize state from external config if available
  let activeMotifs = config?.activeMotifs ? { ...config.activeMotifs } : { lento: false, turn: false, custom: [{}, {}, {}] };
  if (!Array.isArray(activeMotifs.custom)) {
    activeMotifs.custom = [{}, {}, {}];
  }

  // ==================================================
  // 1) Preparação
  // ==================================================
  const columns = data.columns || Object.keys(data[0] || {});
  const smoothingCols = columns.filter(col => col.startsWith("symbolic_movement_"));
  smoothingCols.sort((a, b) => {
    const numA = parseInt(a.split('_')[2], 10) || 0;
    const numB = parseInt(b.split('_')[2], 10) || 0;
    return numA - numB;
  });

  if (smoothingCols.length === 0) {
    container.append("div")
      .attr("class", "panel-placeholder")
      .text("Select a cluster to view the Behavior Rug visualization.");
    return;
  }

  let currentKey = config?.column || smoothingCols[0];
  let currentSort = "cluster"; // cluster, duration, distance
  let sortDirection = "asc"; // asc, desc

  const sortedData = data.slice().sort((a, b) => {
    const cA = parseInt(a.cluster_markov ?? a.cluster, 10);
    const cB = parseInt(b.cluster_markov ?? b.cluster, 10);
    return (isNaN(cA) ? 0 : cA) - (isNaN(cB) ? 0 : cB);
  });

  // ==================================================
  // 2) Painel de Controles
  // ==================================================
  const controlsHeight = 44;
  const controlsDiv = container.append("div")
    .attr("class", "rug-controls")
    .style("padding", "10px")
    .style("background", "#ccccccff")
    .style("border-bottom", "1px solid #ccc")
    .style("display", "flex")
    .style("align-items", "center")
    .style("gap", "15px")
    .style("flex-shrink", "0");

  // Sort Controls
  controlsDiv.append("span")
    .text("Sort:");

  const sortSelect = controlsDiv.append("select")
    .attr("class", "dropdown-toggle")
    .style("font-size", "11px")
    .on("change", function () {
      currentSort = this.value;
      render();
    });

  const sortOptions = [
    { label: "Cluster", value: "cluster" },
    { label: "Duration", value: "duration" },
    { label: "Distance", value: "distance" }
  ];

  sortOptions.forEach(opt => {
    sortSelect.append("option")
      .attr("value", opt.value).text(opt.label);
  });

  const sortDirSelect = controlsDiv.append("select")
    .style("font-size", "11px")
    .attr("class", "dropdown-toggle")
    .style("margin-left", "5px")
    .on("change", function () {
      sortDirection = this.value;
      render();
    });

  sortDirSelect.append("option").attr("value", "asc").text("Asc");
  sortDirSelect.append("option").attr("value", "desc").text("Desc");

  controlsDiv.append("div")
    .attr("class", "divider");

  controlsDiv.append("span")
    .text("Smoothing:");

  const radioGroup = controlsDiv.append("div")
    .attr("class", "rug-radio-group");


  smoothingCols.forEach(key => {
    const levelNum = key.split('_')[2];
    const label = radioGroup.append("label")
      .style("font-size", "12px").style("cursor", "pointer")
      .style("display", "flex").style("align-items", "center").style("gap", "4px");

    const input = label.append("input")
      .attr("type", "radio").attr("name", "rug_smoothing").attr("value", key)
      .property("checked", key === currentKey);

    input.on("change", function () {
      if (this.checked) {
        currentKey = this.value;
        notifyMotifConfig();
        render();
      }
    });
    label.append("span").text(levelNum);
  });

  controlsDiv.append("div").style("width", "1px").style("height", "20px").style("background", "#ccc").style("margin", "0 10px");

  // Dropdown for Motifs
  const dropdown = controlsDiv.append("div").attr("class", "dropdown");
  const dropdownBtn = dropdown.append("button").attr("class", "dropdown-toggle").text("Filter by Motifs");
  const dropdownContent = dropdown.append("div").attr("class", "dropdown-content");

  function notifyMotifConfig() {
    eventManager.notify('MOTIF_CONFIG_CHANGED', {
      activeMotifs: activeMotifs,
      column: currentKey
    });
  }

  function addDropdownItem(text, key, checked, onChange) {
    const label = dropdownContent.append("label");
    const input = label.append("input")
      .attr("type", "checkbox")
      .property("checked", checked);
    label.append("span").text(text);
    input.on("change", function () { onChange(this.checked); });
  }

  addDropdownItem("DDD (Very Slow)", "lento", activeMotifs.lento, (checked) => {
    activeMotifs.lento = checked;
    notifyMotifConfig();
    render();
  });

  addDropdownItem("Abrupt Turn", "turn", activeMotifs.turn, (checked) => {
    activeMotifs.turn = checked;
    notifyMotifConfig();
    render();
  });

  // Custom Motif Builder
  dropdownContent.append("div")
    .style("border-top", "1px solid #eee")
    .style("margin", "5px 0");

  const motifBuilder = dropdownContent.append("div")
    .attr("class", "motif-builder")
    .on("click", e => e.stopPropagation());

  motifBuilder.append("span")
    .text("Custom Motif Builder (max 3 steps):");

  const speeds = ["Muito_Lento", "Lento", "Medio", "Rapido", "Muito_Rapido"];
  const directions = ["N", "E", "S", "W"];

  function updateMotifUI() {
    motifBuilder.selectAll(".motif-step").remove();
    motifBuilder.selectAll(".motif-apply-container").remove();

    activeMotifs.custom.forEach((step, i) => {
      const isPrevStepEmpty = i > 0 && !(activeMotifs.custom[i - 1].speed || activeMotifs.custom[i - 1].dir);

      const stepDiv = motifBuilder.append("div")
        .attr("class", "motif-step")
        .style("opacity", isPrevStepEmpty ? 0.5 : 1)
        .style("pointer-events", isPrevStepEmpty ? "none" : "all");

      const title = stepDiv.append("div").attr("class", "motif-step-title");
      title.append("span").text(`Step ${i + 1}:`);

      if (step.speed || step.dir) {
        title.append("span")
          .attr("class", "motif-clear-btn")
          .text("Clear")
          .on("click", () => {
            activeMotifs.custom[i] = {};
            updateMotifUI();
          });
      }

      // Speed buttons
      const speedGroup = stepDiv.append("div").attr("class", "motif-button-group");
      speeds.forEach(s => {
        speedGroup.append("button")
          .attr("class", `motif-btn ${step.speed === s ? "active" : ""}`)
          .text(s.replace("_", " "))
          .on("click", () => {
            step.speed = (step.speed === s) ? null : s;
            updateMotifUI();
          });
      });

      // Direction buttons
      const dirGroup = stepDiv.append("div").attr("class", "motif-button-group");
      directions.forEach(d => {
        dirGroup.append("button")
          .attr("class", `motif-btn ${step.dir === d ? "active" : ""}`)
          .text(d)
          .on("click", () => {
            step.dir = (step.dir === d) ? null : d;
            updateMotifUI();
          });
      });
    });

    const applyContainer = motifBuilder.append("div").attr("class", "motif-apply-container");
    const isAnyCustomActive = activeMotifs.custom.some(p => p.speed || p.dir);

    applyContainer.append("button")
      .attr("class", "dropdown-toggle")
      .style("background", isAnyCustomActive ? "#164773" : "#ccc")
      .style("color", "#fff")
      .style("border", "none")
      .style("cursor", isAnyCustomActive ? "pointer" : "not-allowed")
      .attr("disabled", isAnyCustomActive ? null : true)
      .text("Apply Motif Filter")
      .on("click", () => {
        notifyMotifConfig();
        render();
      });

    applyContainer.append("span")
      .attr("class", "motif-clear-btn")
      .text("Clear All")
      .on("click", () => {
        activeMotifs.custom = [{}, {}, {}];
        updateMotifUI();
        notifyMotifConfig();
        render();
      });
  }

  updateMotifUI();

  dropdownBtn.on("click", function (event) {
    event.stopPropagation();
    const isVisible = dropdownContent.classed("show");
    d3.selectAll(".dropdown-content").classed("show", false);
    dropdownContent.classed("show", !isVisible);
  });

  d3.select(window).on("click.dropdown", function () { dropdownContent.classed("show", false); });
  dropdownContent.on("click", function (event) { event.stopPropagation(); });

  const legendLabel = controlsDiv.append("label")
    .attr("class", "rug-legend-toggle");


  const legendInput = legendLabel.append("input").attr("type", "checkbox").property("checked", false);
  legendLabel.append("span").text("Show Legend");
  legendInput.on("change", function () { toggleLegend(this.checked); });

  // ==================================================
  // 3) Estrutura painéis
  // ==================================================
  const leftWidth = VISUALIZATION_CONFIG.behaviourRug?.leftPanelWidth ?? 70;
  const wrap = container.append("div")
    .attr("class", "behavior-rug-wrap")
    .style("display", "grid")
    .style("grid-template-columns", `${leftWidth}px 1fr`)
    .style("height", `calc(100% - ${controlsHeight}px)`)
    .style("overflow-y", "auto")
    .style("overflow-x", "hidden")
    .style("min-height", "0");

  const leftDiv = wrap.append("div").attr("class", "behavior-rug-left");
  const centerDiv = wrap.append("div").attr("class", "behavior-rug-center").style("overflow-x", "auto").style("overflow-y", "hidden");

  const rightDiv = container.append("div")
    .attr("class", "behavior-rug-right");
    
  const leftSvg = leftDiv.append("svg").attr("class", "behavior-rug-svg");
  const centerSvg = centerDiv.append("svg").attr("class", "behavior-rug-svg");
  const rightSvg = rightDiv.append("svg").attr("class", "behavior-rug-svg");

  function toggleLegend(show) { rightDiv.style("display", show ? "block" : "none"); }

  // ==================================================
  // 4) Helpers
  // ==================================================
  const baseColor = VISUALIZATION_CONFIG.baseGlyphColor || "#164773";
  const mixToWhite = (t) => d3.interpolateRgb("#ffffff", baseColor)(t);
  const SPEED_LEVELS = ["Muito_Lento", "Lento", "Medio", "Rapido", "Muito_Rapido"];
  const SPEED_T = { Muito_Lento: 0.2, Lento: 0.4, Medio: 0.6, Rapido: 0.8, Muito_Rapido: 1.0 };
  const colorForSpeed = (speed) => mixToWhite(SPEED_T[speed] ?? 0.60);

  function highlightRow(id) {
    selectedTrajectoryId = id;
    leftSvg.selectAll(".l-row").classed("selected", false).classed("hovered", false);
    centerSvg.selectAll(".row").classed("row-selected", false).classed("row-hover", false);
    if (!id) return;

    leftSvg.selectAll(".l-row").filter(d => d.id === id).classed("selected", true);
    centerSvg.selectAll(".row").filter(d => d.id === id).classed("row-selected", true);

    const datum = sequences.find(s => s.id === id);
    if (datum) {
      console.log(datum.seq, activeMotifs.custom);
      console.log(getCustomMotifIndices(datum.seq, activeMotifs.custom));
      eventManager.notify('TRAJECTORY_SELECTED', {
        trajectory: datum,
        options: {
          highlightLentoIndices: getLentoIndices(datum.seq, activeMotifs.lento),
          highlightTurnIndices: getTurnIndices(datum.seq, activeMotifs.turn),
          highlightCustomIndices: getCustomMotifIndices(datum.seq, activeMotifs.custom)
        }


      });
    }
  }

  // ==================================================
  // 5) Render
  // ==================================================
  function render() {
    leftSvg.selectAll("*").remove();
    centerSvg.selectAll("*").remove();
    rightSvg.selectAll("*").remove();

    sequences = sortedData.map(d => {
      let seq = [];
      const rawJson = d[currentKey];
      try {
        if (rawJson) {
          const jsonStr = String(rawJson).replace(/'/g, '"');
          const rawSeq = JSON.parse(jsonStr);
          if (Array.isArray(rawSeq)) {
            seq = rawSeq.map(s => {
              if (!s) return { empty: true };
              return { raw: s, speed: getSpeed(s), dir: getDirection(s) };
            });
          }
        }
      } catch (e) { }

      const points = parseTrajectoryData(d.trajectory_xy);
      const distance = calculateStraightLineDistance(points);
      const duration = calculateDuration(points);

      return {
        id: d.trajectory_id,
        trajectory_id: d.trajectory_id,
        cluster: d.cluster,
        seq,
        simbolic_movement: rawJson,
        raw: d,
        distance,
        duration
      };
    });

    const multiplier = sortDirection === "asc" ? 1 : -1;

    if (currentSort === "duration") {
      sequences.sort((a, b) => (d3.ascending(a.duration, b.duration) * multiplier) || d3.ascending(a.cluster, b.cluster));
    } else if (currentSort === "distance") {
      sequences.sort((a, b) => (d3.ascending(a.distance, b.distance) * multiplier) || d3.ascending(a.cluster, b.cluster));
    } else {
      sequences.sort((a, b) => (d3.ascending(parseInt(a.cluster), parseInt(b.cluster)) * multiplier) || d3.ascending(a.id, b.id));
    }

    if (!sequences.length) {
      centerSvg.append("text").attr("x", 20).attr("y", 50).text("Sem dados válidos.");
      return;
    }

    const cellSize = VISUALIZATION_CONFIG.cellSize ?? 12;
    const cellPadding = VISUALIZATION_CONFIG.cellPadding ?? 2;
    const rowHeight = cellSize + cellPadding;
    const colWidth = cellSize + cellPadding;
    const marginTop = VISUALIZATION_CONFIG.behaviourRug?.marginTop ?? 40;
    const maxLen = d3.max(sequences, d => d.seq.length) || 0;
    const rugWidth = maxLen * colWidth;
    const totalHeight = (sequences.length * rowHeight) + marginTop + 20;

    leftSvg.attr("width", leftWidth).attr("height", totalHeight);
    centerSvg.attr("width", rugWidth + 10).attr("height", totalHeight);
    rightSvg.attr("width", VISUALIZATION_CONFIG.behaviourRug?.legendWidth ?? 150).attr("height", totalHeight);

    const leftG = leftSvg.append("g").attr("transform", `translate(0, ${marginTop})`);
    const leftRows = leftG.selectAll(".l-row")
      .data(sequences).enter().append("g").attr("class", "l-row")
      .attr("transform", (d, i) => `translate(0, ${i * rowHeight})`)
      .style("cursor", "pointer")
      .on("click", (e, d) => highlightRow(d.id));

    leftRows.append("rect")
      .attr("x", 2)
      .attr("y", 2)
      .attr("width", leftWidth - 2)
      .attr("height", rowHeight - 2)
      .attr("rx", 4)   // opcional: canto arredondado
      .attr("ry", 4)
      .attr("fill", d => CLUSTER_COLORS[Math.abs(+d.cluster % CLUSTER_COLORS.length)])
      .attr("fill-opacity", 0.25);

    leftRows.append("text")
      .attr("class", "label-id")
      .attr("x", leftWidth - 10)
      .attr("y", rowHeight / 2)
      .attr("dy", ".35em")
      .attr("text-anchor", "end")
      .attr("font-size", 10)
      .attr("fill", "#333")
      .text(d => d.id);

    const cx = cellSize / 2, cy = cellSize / 2;
    const pathN = `M0,0 L${cellSize},0 L${cx},${cy} Z`;
    const pathE = `M${cellSize},0 L${cellSize},${cellSize} L${cx},${cy} Z`;
    const pathS = `M${cellSize},${cellSize} L0,${cellSize} L${cx},${cy} Z`;
    const pathW = `M0,${cellSize} L0,0 L${cx},${cy} Z`;

    const centerG = centerSvg.append("g").attr("transform", `translate(0, ${marginTop})`);
    const rows = centerG.selectAll(".row")
      .data(sequences).enter().append("g").attr("class", "row")
      .attr("transform", (d, i) => `translate(0, ${i * rowHeight})`)
      .style("cursor", "pointer")
      .on("mouseenter", function (e, d) {
        if (selectedTrajectoryId !== d.id) d3.select(this).classed("row-hover", true);
        leftSvg.selectAll(".l-row").filter(ld => ld.id === d.id).classed("hovered", true);
      })
      .on("mouseleave", function (e, d) {
        d3.select(this).classed("row-hover", false);
        leftSvg.selectAll(".l-row").filter(ld => ld.id === d.id).classed("hovered", false);
      })
      .on("click", (e, d) => highlightRow(d.id));

    rows.append("rect")
      .attr("class", "row-bg")
      .attr("width", rugWidth)
      .attr("height", rowHeight)
      .attr("fill", "transparent");

    rows.each(function (rowData) {
      const rowG = d3.select(this);
      const lentoIndices = getLentoIndices(rowData.seq, activeMotifs.lento);
      const turnIndices = getTurnIndices(rowData.seq, activeMotifs.turn);
      const customIndices = getCustomMotifIndices(rowData.seq, activeMotifs.custom);

      const cells = rowG.selectAll(".g-cell")
        .data(rowData.seq).enter().append("g").attr("class", "g-cell")
        .attr("transform", (d, i) => `translate(${i * colWidth}, 0)`);

      cells.append("rect")
        .attr("width", cellSize).attr("height", cellSize)
        .attr("fill", (d, i) => {
          if (customIndices.has(i)) return "#a2d9ce"; // Cyan-ish for Custom
          if (turnIndices.has(i)) return "#d2b4de";
          if (lentoIndices.has(i)) return "#fae3b1ff";
          return VISUALIZATION_CONFIG.cellBackgroundColor || "#fff";
        })
        .attr("stroke", (d, i) => {
          if (customIndices.has(i)) return "#16a085";
          if (turnIndices.has(i)) return "#8e44ad";
          if (lentoIndices.has(i)) return "#fbbe63ff";
          return VISUALIZATION_CONFIG.cellBorderColor || "#ddd";
        })
        .attr("stroke-width", (d, i) => (turnIndices.has(i) || lentoIndices.has(i) || customIndices.has(i)) ? 1.5 : (VISUALIZATION_CONFIG.cellBorderWidth ?? 0.5))
        .each(function (d, i) {
          const el = d3.select(this);
          const isTurn = turnIndices.has(i);
          const isLento = lentoIndices.has(i);
          const isCustom = customIndices.has(i);
          if (isTurn || isLento || isCustom) {
            el.on("mouseover", function (event) {
              const parts = [];
              if (isCustom) parts.push("Custom Motif");
              if (isTurn) parts.push("Abrupt Turn");
              if (isLento) parts.push("Very Slow");

              const tooltip = d3.select("body").selectAll(".tooltip").data([0]).join("div").attr("class", "tooltip");
              tooltip.text(parts.join(" & "))
                .style("opacity", 1).style("left", (event.pageX + 10) + "px").style("top", (event.pageY - 10) + "px");
            })
              .on("mousemove", function (event) { d3.select(".tooltip").style("left", (event.pageX + 10) + "px").style("top", (event.pageY - 10) + "px"); })
              .on("mouseout", function () { d3.select(".tooltip").style("opacity", 0); });
          }
        });

      cells.each(function (d) {
        if (!d || d.empty) return;
        const fill = colorForSpeed(d.speed || "Medio");
        let path = null;
        if (d.dir === DIRECTION_STRINGS.N) path = pathN;
        else if (d.dir === DIRECTION_STRINGS.E) path = pathE;
        else if (d.dir === DIRECTION_STRINGS.S) path = pathS;
        else if (d.dir === DIRECTION_STRINGS.W) path = pathW;
        if (path) d3.select(this).append("path").attr("d", path).attr("fill", fill).style("pointer-events", "none");
      });
    });

    drawLegend(rightSvg);
    if (selectedTrajectoryId) highlightRow(selectedTrajectoryId);
  }

  function drawLegend(svgContainer) {
    const legend = svgContainer.append("g").attr("transform", `translate(10, 0)`);
    const legDirY = 30; const legSize = 30; const legCX = legSize / 2; const legCY = legSize / 2;
    const legStroke = VISUALIZATION_CONFIG.frenquencyGlyph?.gridLineColor || "#999";
    const gDir = legend.append("g").attr("transform", `translate(20, ${legDirY})`);
    gDir.append("text").attr("y", -15).attr("x", -10).attr("font-size", 11).attr("font-weight", "bold").text("Direction");
    const addArrow = (d, txt, x, y, anchor) => {
      gDir.append("path").attr("d", d).attr("fill", baseColor).attr("opacity", 0.7).attr("stroke", legStroke);
      gDir.append("text").attr("x", x).attr("y", y).text(txt).attr("text-anchor", anchor).attr("font-size", 9).attr("alignment-baseline", "middle");
    };
    addArrow(`M0,0 L${legSize},0 L${legCX},${legCY} Z`, "N", legCX, -3, "middle");
    addArrow(`M${legSize},0 L${legSize},${legSize} L${legCX},${legCY} Z`, "E", legSize + 3, legCY, "start");
    addArrow(`M${legSize},${legSize} L0,${legSize} L${legCX},${legCY} Z`, "S", legCX, legSize + 8, "middle");
    addArrow(`M0,${legSize} L0,0 L${legCX},${legCY} Z`, "W", -3, legCY, "end");

    const legSpeedY = legDirY + legSize + 40;
    const gSpeed = legend.append("g").attr("transform", `translate(10, ${legSpeedY})`);
    gSpeed.append("text").attr("y", -5).attr("font-size", 11).attr("font-weight", "bold").text("Speed");
    SPEED_LEVELS.forEach((s, i) => {
      const rowY = i * 20;
      gSpeed.append("rect").attr("x", 0).attr("y", rowY).attr("width", 16).attr("height", 16).attr("fill", colorForSpeed(s)).attr("stroke", "#999").attr("stroke-width", 0.2);
      gSpeed.append("text").attr("x", 25).attr("y", rowY + 8).attr("dy", ".35em").attr("font-size", 10).text(s);
    });
  }

  render();
}
