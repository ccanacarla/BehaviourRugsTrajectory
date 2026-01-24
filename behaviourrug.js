import { VISUALIZATION_CONFIG, DIRECTION_STRINGS, CLUSTER_COLORS } from './config.js';
import { eventManager } from './events.js';
import {
  getSpeed, getDirection, getCustomMotifIndices, getAllCustomMotifIndices,
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

  if (!data || data.length === 0) {
    container.append("div")
      .attr("class", "panel-placeholder")
      .append("p")
      .text("Select a trajectory");
    return;
  }

  // ==================================================
  // 0) Estado
  // ==================================================
  let selectedTrajectoryId = null;
  let sequences = [];

  // Interaction Mode State
  let interactionMode = false;
  let selectionState = {
    step: 0, // 0: start, 1: end, 2: reset
    trajectoryId: null,
    startIndex: null,
    endIndex: null
  };

  // Initialize state from external config if available
  // activeMotifs.custom is now an Array of Motif Objects: { id, name, color, pattern }
  let activeMotifs = config?.activeMotifs ? { ...config.activeMotifs } : { custom: [] };
  
  // Ensure backward compatibility or initialization
  if (!Array.isArray(activeMotifs.custom)) {
     // If it was the old single object style, convert or reset? 
     // For safety, let's reset or try to migrate if it has data.
     if (typeof activeMotifs.custom === 'object' && activeMotifs.custom.some && activeMotifs.custom.some(p => p.speed || p.dir)) {
         activeMotifs.custom = [{
             id: Date.now(),
             name: activeMotifs.customName || "Legacy Motif",
             color: activeMotifs.customColor || "#16a085",
             pattern: activeMotifs.custom
         }];
     } else {
         activeMotifs.custom = [];
     }
  }

  // Builder State (for the "Create New" form)
  let builderState = {
      name: "New Motif",
      color: "#e74c3c", // Default red-ish
      pattern: [{}, {}, {}]
  };

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

  let currentKey = config?.column || smoothingCols[0];

  let currentSort = "cluster"; // cluster, duration, distance
  let sortDirection = "asc"; // asc, desc

  const sortedData = data.slice().sort((a, b) => {
    const cA = parseInt(a.cluster_markov ?? a.cluster, 10);
    const cB = parseInt(b.cluster_markov ?? b.cluster, 10);
    return (isNaN(cA) ? 0 : cA) - (isNaN(cB) ? 0 : cB);
  });

  const processedData = sortedData.map(d => {
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
      user_id: d.user_id,
      cluster: d.cluster,
      seq,
      simbolic_movement: rawJson,
      raw: d,
      distance,
      duration,
      shannon_entropy: d.shannon_entropy,
      avg_dwell_time: d.avg_dwell_time,
      high_speed_ratio: d.high_speed_ratio
    };
  });

  // ==================================================
  // 2) Painel de Controles
  // ==================================================
  const controlsHeight = 44;
  const controlsDiv = container.append("div")
    .attr("class", "rug-controls");

  // Sort Controls
  const sortControlGroup = controlsDiv.append("div")
    .style("display", "flex")
    .style("align-items", "center")
    .style("gap", "0");

  sortControlGroup.append("span")
    .text("Sort:")
    .style("font-weight", "bold")
    .style("margin-right", "5px");

  const sortSelect = sortControlGroup.append("select")
    .attr("class", "dropdown-toggle")
    .on("change", function () {
      currentSort = this.value;
      render();
    });

  const sortOptions = [
    { label: "Cluster", value: "cluster" },
    { label: "Duration", value: "duration" },
    { label: "Distance", value: "distance" },
    { label: "Shannon Entropy", value: "shannon_entropy" },
    { label: "Avg Dwell Time", value: "avg_dwell_time" },
    { label: "High Speed Ratio", value: "high_speed_ratio" }
  ];


  sortOptions.forEach(opt => {
    sortSelect.append("option")
      .attr("value", opt.value)
      .text(opt.label);

  });



  const sortDirBtn = sortControlGroup.append("button")
    .attr("class", "sort-direction-btn")
    .style("background", "transparent")
    .style("font-size", "14px")
    .text("⬆")
    .on("click", function () {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
      d3.select(this).text(sortDirection === "asc" ? "⬆" : "⬇");
      render();
    });

  


    /*
  controlsDiv.append("span")
    .style("font-weight", "bold")
    .text("Smoothing:");

  const radioGroup = controlsDiv.append("div")
    .attr("class", "rug-radio-group");


  smoothingCols.forEach(key => {
    const levelNum = key.split('_')[2];
    const label = radioGroup.append("label");

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
*/
  controlsDiv.append("div").style("width", "1px").style("height", "20px").style("background", "#ccc").style("margin", "0 10px");

  // User Filter
  const userFilterGroup = controlsDiv.append("div")
    .style("display", "flex")
    .style("align-items", "center")
    .style("gap", "5px");

  userFilterGroup.append("span")
    .text("User:")
    .style("font-weight", "bold");

  const userIds = config?.allUserIds || Array.from(new Set(data.map(d => d.user_id))).sort((a, b) => a - b);
  const userSelect = userFilterGroup.append("select")
    .attr("class", "dropdown-toggle")
    .on("change", function () {
      eventManager.notify('USER_FILTER_CHANGED', { userId: this.value || null });
    });

  userSelect.append("option")
    .attr("value", "")
    .text("All");

  userIds.forEach(id => {
    userSelect.append("option")
      .attr("value", id)
      .property("selected", config?.userId === String(id))
      .text(id);
  });

  controlsDiv.append("div").style("width", "1px").style("height", "20px").style("background", "#ccc").style("margin", "0 10px");

  // Dropdown for Motifs
  const dropdown = controlsDiv.append("div").attr("class", "dropdown");
  dropdown.append("span")
    .style("font-weight", "bold")
    .style("margin-right", "5px")
    .text("Motif:");
  const dropdownBtn = dropdown.append("button").attr("class", "dropdown-toggle").text("Build");
  const dropdownContent = dropdown.append("div").style("background", "white").style("transform", "translateX(-100px)").attr("class", "dropdown-content");

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
    motifBuilder.selectAll("*").remove();
    
    // --- PART 1: Active Motifs List ---
    if (activeMotifs.custom.length > 0) {
        motifBuilder.append("div")
            .style("font-size", "11px")
            .style("font-weight", "bold")
            .style("margin-bottom", "5px")
            .text("Active Custom Motifs:");
            
        activeMotifs.custom.forEach((m, idx) => {
            const row = motifBuilder.append("div")
                .style("display", "flex")
                .style("align-items", "center")
                .style("justify-content", "space-between")
                .style("background", "#f9f9f9")
                .style("border", "1px solid #eee")
                .style("padding", "4px")
                .style("margin-bottom", "4px")
                .style("border-radius", "4px");
            
            const info = row.append("div").style("display", "flex").style("align-items", "center").style("gap", "6px");
            
            info.append("div")
                .style("width", "12px").style("height", "12px")
                .style("background", m.color)
                .style("border-radius", "2px");
                
            info.append("span").style("font-size", "11px").text(m.name);
            
            row.append("span")
                .attr("class", "motif-clear-btn")
                .text("Delete")
                .on("click", () => {
                    activeMotifs.custom.splice(idx, 1);
                    updateMotifUI();
                    notifyMotifConfig();
                    render();
                });
        });
        
        motifBuilder.append("hr").style("border", "0").style("border-top", "1px solid #eee").style("margin", "8px 0");
    }

    // --- PART 2: Builder ---
    motifBuilder.append("div")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .style("margin-bottom", "5px")
        .text("Create New Motif:");

    const settingsDiv = motifBuilder.append("div")
      .attr("class", "motif-custom-settings")
      .style("display", "flex")
      .style("gap", "10px")
      .style("margin-bottom", "10px")
      .style("align-items", "center");

    settingsDiv.append("span").text("Name:").style("font-size", "11px");
    settingsDiv.append("input")
      .attr("type", "text")
      .attr("class", "dropdown-toggle")
      .style("width", "90px")
      .property("value", builderState.name)
      .on("input", function() {
        builderState.name = this.value;
      });

    settingsDiv.append("span").text("Color:").style("font-size", "11px");
    settingsDiv.append("input")
      .attr("type", "color")
      .style("padding", "0")
      .style("border", "none")
      .style("width", "25px")
      .style("height", "25px")
      .style("cursor", "pointer")
      .property("value", builderState.color)
      .on("input", function() {
        builderState.color = this.value;
      });

    // Steps Builder
    builderState.pattern.forEach((step, i) => {
      const isPrevStepEmpty = i > 0 && !(builderState.pattern[i - 1].speed || builderState.pattern[i - 1].dir);

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
            builderState.pattern[i] = {};
            updateMotifUI();
          });
      }

      // Speed buttons
      const speedGroup = stepDiv.append("div").attr("class", "motif-button-group");
      speeds.forEach(s => {
        speedGroup.append("button")
          .attr("class", `motif-btn ${step.speed === s ? "active" : ""}`)
          .text(s.replace("_", " "))
          .on("mouseover", function() { d3.select(this).style("color", "black"); })
          .on("mouseout", function() { d3.select(this).style("color", null); })
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
          .on("mouseover", function() { d3.select(this); })
          .on("mouseout", function() { d3.select(this).style("color", null); })
          .on("click", () => {
            step.dir = (step.dir === d) ? null : d;
            updateMotifUI();
          });
      });
    });

    const applyContainer = motifBuilder.append("div").attr("class", "motif-apply-container");
    const isBuilderValid = builderState.pattern.some(p => p.speed || p.dir);

    applyContainer.append("button")
      .attr("class", "dropdown-toggle")
      .style("background", isBuilderValid ? "#164773" : "#ccc")
      .style("color", "#fff")
      .style("border", "none")
      .style("cursor", isBuilderValid ? "pointer" : "not-allowed")
      .attr("disabled", isBuilderValid ? null : true)
      .text("Add Motif to List")
      .on("click", () => {
        if (!isBuilderValid) return;
        
        // Add to active motifs
        activeMotifs.custom.push({
            id: Date.now(),
            name: builderState.name || "Custom Motif",
            color: builderState.color,
            pattern: JSON.parse(JSON.stringify(builderState.pattern)) // Deep copy
        });
        
        // Reset builder
        builderState.name = "New Motif";
        builderState.pattern = [{}, {}, {}];
        // Keep color or randomize? Let's randomize slightly or keep same
        
        updateMotifUI();
        notifyMotifConfig();
        render();
      });

    applyContainer.append("span")
      .attr("class", "motif-clear-btn")
      .text("Reset Builder")
      .on("click", () => {
        builderState.pattern = [{}, {}, {}];
        updateMotifUI();
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

  // Interaction Mode Button
  controlsDiv.append("button")
      .attr("class", "dropdown-toggle")
      .style("margin-left", "10px")
      .text("Frame Interval: OFF")
      .on("click", function() {
          interactionMode = !interactionMode;
          d3.select(this).text(`Frame Interval: ${interactionMode ? "ON" : "OFF"}`);
          d3.select(this)
            .style("background", interactionMode ? "#8e44ad" : null)
            .style("color", interactionMode ? "white" : null);
          
          // Reset state when toggling
          selectionState = { step: 0, trajectoryId: null, startIndex: null, endIndex: null };
          
          // Clear visuals
          centerSvg.selectAll(".frame-selected-start").classed("frame-selected-start", false);
          centerSvg.selectAll(".frame-selected-interval").classed("frame-selected-interval", false);
          eventManager.notify('FRAME_SELECT_TRAJECTORY', null); // Notify reset

          console.log(`Interaction Mode: ${interactionMode ? "ON" : "OFF"}`);
      });

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
    if (!id) {
      eventManager.notify('TRAJECTORY_SELECTED', { trajectory: null, options: null });
      return;
    }

    leftSvg.selectAll(".l-row").filter(d => d.id === id).classed("selected", true);
    centerSvg.selectAll(".row").filter(d => d.id === id).classed("row-selected", true);

    const datum = sequences.find(s => s.id === id);
    if (datum) {
      const allMatches = getAllCustomMotifIndices(datum.seq, activeMotifs.custom);
      console.log(datum.seq, activeMotifs.custom);
      console.log(allMatches);
      
      eventManager.notify('TRAJECTORY_SELECTED', {
        trajectory: datum,
        options: {
          customMotifs: allMatches
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

    sequences = processedData.slice();

    const multiplier = sortDirection === "asc" ? 1 : -1;

    if (currentSort === "duration") {
      sequences.sort((a, b) => (d3.ascending(a.duration, b.duration) * multiplier) || d3.ascending(a.cluster, b.cluster));
    } else if (currentSort === "distance") {
      sequences.sort((a, b) => (d3.ascending(a.distance, b.distance) * multiplier) || d3.ascending(a.cluster, b.cluster));
    } else if (currentSort === "shannon_entropy") {
      sequences.sort((a, b) => (d3.ascending(+a.shannon_entropy, +b.shannon_entropy) * multiplier) || d3.ascending(a.cluster, b.cluster));
    } else if (currentSort === "avg_dwell_time") {
      sequences.sort((a, b) => (d3.ascending(+a.avg_dwell_time, +b.avg_dwell_time) * multiplier) || d3.ascending(a.cluster, b.cluster));
    } else if (currentSort === "high_speed_ratio") {
      sequences.sort((a, b) => (d3.ascending(+a.high_speed_ratio, +b.high_speed_ratio) * multiplier) || d3.ascending(a.cluster, b.cluster));
    } else {
      sequences.sort((a, b) => (d3.ascending(parseInt(a.cluster), parseInt(b.cluster)) * multiplier) || d3.ascending(a.id, b.id));
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
      .on("click", (e, d) => highlightRow(selectedTrajectoryId === d.id ? null : d.id));

    leftRows.append("rect")
      .attr("x", 10)
      .attr("y", 0)
      .attr("width", leftWidth - 10)
      .attr("height", cellSize)
      .attr("rx", 4)   // opcional: canto arredondado
      .attr("ry", 4)
      .attr("fill", d => CLUSTER_COLORS[Math.abs(+d.cluster % CLUSTER_COLORS.length)])
      .attr("fill-opacity", 0.25);

    leftRows.append("text")
      .attr("class", "label-id")
      .attr("x", leftWidth - 10)
      .attr("y", cellSize / 2)
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

    // ==================================================
    // Brush Implementation
    // ==================================================
    const brush = d3.brushY()
      .extent([[0, 0], [leftWidth, sequences.length * rowHeight]])
      .on("start brush end", brushed);

    leftG.append("g")
      .attr("class", "brush")
      .call(brush);

    function brushed({ selection }) {
      if (!selection) {
        eventManager.notify('RUG_BRUSH_CHANGED', { trajectoryIds: null });
        leftRows.classed("selected", false); // Clear visual selection in rug
        if (selectedTrajectoryId) highlightRow(selectedTrajectoryId); // Restore single selection if any
        return;
      }

      const [y0, y1] = selection;
      const selectedIds = [];

      leftRows.classed("selected", d => {
        const y = sequences.indexOf(d) * rowHeight;
        const h = rowHeight;
        // Check intersection (simple: center of row is inside brush)
        // Or overlap: y < y1 && y + h > y0
        const isSelected = y < y1 && y + h > y0;
        if (isSelected) selectedIds.push(d.id);
        return isSelected;
      });

      eventManager.notify('RUG_BRUSH_CHANGED', { trajectoryIds: selectedIds });
    }

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
      .on("click", (e, d) => highlightRow(selectedTrajectoryId === d.id ? null : d.id));

    rows.append("rect")
      .attr("class", "row-bg")
      .attr("rx", 4)   // opcional: canto arredondado
      .attr("ry", 4)
      .attr("width", rugWidth)
      .attr("height", rowHeight)
      .attr("fill", "transparent");

    rows.each(function (rowData) {
      const rowG = d3.select(this);
      const allMatches = getAllCustomMotifIndices(rowData.seq, activeMotifs.custom);
      const getMatchesAt = (idx) => allMatches.filter(m => m.indices.has(idx));

      const cells = rowG.selectAll(".g-cell")
        .data(rowData.seq).enter().append("g").attr("class", "g-cell")
        .attr("transform", (d, i) => `translate(${i * colWidth}, 0)`);

      cells.append("rect")
        .attr("width", cellSize).attr("height", cellSize)
        .attr("rx", 2)   // opcional: canto arredondado
        .attr("ry", 2)
        .attr("fill", (d, i) => {
          const m = getMatchesAt(i);
          if (m.length > 0) return m[m.length - 1].color;
          return VISUALIZATION_CONFIG.cellBackgroundColor || "#fff";
        })
        .attr("fill-opacity", (d, i) => {
          if (getMatchesAt(i).length > 0) return 0.4;
          return 1;
        })
        .attr("stroke", (d, i) => {
          const m = getMatchesAt(i);
          if (m.length > 0) return m[m.length - 1].color;
          return VISUALIZATION_CONFIG.cellBorderColor || "#ddd";
        })
        .attr("stroke-width", (d, i) => getMatchesAt(i).length > 0 ? 1.5 : (VISUALIZATION_CONFIG.cellBorderWidth ?? 0.5))
        .each(function (d, i) {
          const el = d3.select(this);

          // Interaction Mode Handler
          el.on("click", function(event) {
            if (!interactionMode) return; // Allow bubbling to row if not in interaction mode

            event.stopPropagation();
            
            const startFrameOffset = parseInt(rowData.raw.frame_inicial) || 0;

            if (selectionState.step === 0) {
              // 1st Click: Start
              selectionState.trajectoryId = rowData.id;
              selectionState.startIndex = i;
              selectionState.step = 1;
              
              // Visual feedback for start frame
              d3.select(this).classed("frame-selected-start", true);

              eventManager.notify('FRAME_SELECT_TRAJECTORY', {
                  trajectoryId: rowData.id,
                  user_id: rowData.user_id,
                  startFrame: startFrameOffset + i,
                  endFrame: null,
                  startIndex: i,
                  endIndex: null
              });

              console.log(`[Interaction] Start selected at index ${i} (Frame ${startFrameOffset + i}) for Trajectory ${rowData.id}`);
            } else if (selectionState.step === 1) {
              // 2nd Click: End
              if (selectionState.trajectoryId !== rowData.id) {
                 console.warn("[Interaction] Selected a different trajectory. Resetting selection.");
                 // Clear visuals
                 centerSvg.selectAll(".frame-selected-start").classed("frame-selected-start", false);
                 selectionState = { step: 0, trajectoryId: null, startIndex: null, endIndex: null };
                 return;
              }

              selectionState.endIndex = i;
              selectionState.step = 2;

              const fStartIdx = Math.min(selectionState.startIndex, selectionState.endIndex);
              const fEndIdx = Math.max(selectionState.startIndex, selectionState.endIndex);

              const fStart = startFrameOffset + fStartIdx;
              const fEnd = startFrameOffset + fEndIdx;
              
              // Visual feedback for interval
              d3.select(this.parentNode.parentNode).selectAll(".g-cell rect")
                .filter((d, idx) => idx >= fStartIdx && idx <= fEndIdx)
                .classed("frame-selected-interval", true);

              console.log(`[Interaction] End selected at index ${i} (Frame ${startFrameOffset + i})`);
              console.log(`Trajectory Frame Interval: ${fStart} - ${fEnd}`);

              eventManager.notify('FRAME_SELECT_TRAJECTORY', {
                  trajectoryId: rowData.id,
                  user_id: rowData.user_id,
                  startFrame: fStart,
                  endFrame: fEnd,
                  startIndex: fStartIdx,
                  endIndex: fEndIdx
              });

            } else {
              // 3rd Click: Reset
              selectionState = { step: 0, trajectoryId: null, startIndex: null, endIndex: null };
              
              // Clear visuals
              centerSvg.selectAll(".frame-selected-start").classed("frame-selected-start", false);
              centerSvg.selectAll(".frame-selected-interval").classed("frame-selected-interval", false);

              eventManager.notify('FRAME_SELECT_TRAJECTORY', null);

              console.log("[Interaction] Selection reset.");
            }
          });

          const matches = getMatchesAt(i);
          if (matches.length > 0) {
            el.on("mouseover", function (event) {
              const parts = matches.map(m => m.name);
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
