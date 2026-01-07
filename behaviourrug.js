import { VISUALIZATION_CONFIG, SPEED_STRINGS, DIRECTION_STRINGS } from './config.js';
import { eventManager } from './events.js';

export function drawBehaviorRug(data, containerSelector) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  // ==================================================
  // 0) Estado
  // ==================================================
  let selectedTrajectoryId = null;
  let sequences = [];
  let showLentoMotif = false;
  let showDirectionChangeMotif = false;

  // ==================================================
  // 1) Preparação (detecção de colunas symbolic_movement_*)
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
      .style("color", "red")
      .text("Erro: Nenhuma coluna symbolic_movement_ encontrada.");
    return;
  }

  let currentKey = smoothingCols[0];

  // Ordena por cluster (mantém agrupamento visual)
  const sortedData = data.slice().sort((a, b) => {
    const cA = parseInt(a.cluster_markov ?? a.cluster, 10);
    const cB = parseInt(b.cluster_markov ?? b.cluster, 10);
    return (isNaN(cA) ? 0 : cA) - (isNaN(cB) ? 0 : cB);
  });

  // ==================================================
  // 2) Painel de Controles (radio)
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

  controlsDiv.append("span")
    .style("font-weight", "bold")
    .style("font-size", "12px")
    .text("Smoothing:");

  const radioGroup = controlsDiv.append("div")
    .style("display", "flex")
    .style("gap", "12px")
    .style("flex-wrap", "wrap");

  smoothingCols.forEach(key => {
    const levelNum = key.split('_')[2];

    const label = radioGroup.append("label")
      .style("font-size", "12px")
      .style("cursor", "pointer")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "4px");

    const input = label.append("input")
      .attr("type", "radio")
      .attr("name", "rug_smoothing")
      .attr("value", key)
      .property("checked", key === currentKey);

    input.on("change", function () {
      if (this.checked) {
        currentKey = this.value;
        render();
      }
    });

    label.append("span").text(levelNum);
  });

  // Separator
  controlsDiv.append("div")
    .style("width", "1px")
    .style("height", "20px")
    .style("background", "#ccc")
    .style("margin", "0 10px");

  // Dropdown for Motifs
  const dropdown = controlsDiv.append("div")
      .attr("class", "dropdown");

  const dropdownBtn = dropdown.append("button")
      .attr("class", "dropdown-toggle")
      .text("Select Motifs ▼");

  const dropdownContent = dropdown.append("div")
      .attr("class", "dropdown-content");

  // Helper to add checkbox item to dropdown
  function addDropdownItem(text, checked, onChange) {
      const label = dropdownContent.append("label");
      const input = label.append("input")
          .attr("type", "checkbox")
          .property("checked", checked);
      
      label.append("span").text(text);

      input.on("change", function() {
          onChange(this.checked);
      });
  }

  addDropdownItem("DDD", showLentoMotif, (checked) => {
      showLentoMotif = checked;
      render();
  });

  addDropdownItem("Abrupt Turn", showDirectionChangeMotif, (checked) => {
      showDirectionChangeMotif = checked;
      render();
  });

  // Toggle dropdown logic
  dropdownBtn.on("click", function(event) {
      event.stopPropagation();
      const isVisible = dropdownContent.classed("show");
      d3.selectAll(".dropdown-content").classed("show", false); // Close others if any
      dropdownContent.classed("show", !isVisible);
  });

  // Close dropdown when clicking outside
  d3.select(window).on("click.dropdown", function() {
       dropdownContent.classed("show", false);
  });
  
  // Prevent closing when clicking inside content
  dropdownContent.on("click", function(event) {
      event.stopPropagation();
  });

  // Legend control
  const legendLabel = controlsDiv.append("label")
    .style("font-size", "12px")
    .style("cursor", "pointer")
    .style("display", "flex")
    .style("align-items", "center")
    .style("gap", "4px")
    .style("margin-left", "auto") // Push to right
    .style("margin-right", "10px");

  const legendInput = legendLabel.append("input")
    .attr("type", "checkbox")
    .property("checked", false); // Default hidden

  legendLabel.append("span").text("Show Legend");

  legendInput.on("change", function () {
    toggleLegend(this.checked);
  });

  // ==================================================
  // 3) Estrutura painéis (Left | Center) + Floating Legend
  // ==================================================
  const leftWidth = VISUALIZATION_CONFIG.behaviourRug?.leftPanelWidth ?? 220;

  const wrap = container.append("div")
    .attr("class", "behavior-rug-wrap")
    .style("display", "grid")
    .style("grid-template-columns", `${leftWidth}px 1fr`)
    .style("height", `calc(100% - ${controlsHeight}px)`)
    .style("overflow-y", "auto")   // 👈 SCROLL VERTICAL
    .style("overflow-x", "hidden")
    .style("min-height", "0");



  const leftDiv = wrap.append("div")
    .attr("class", "behavior-rug-left");

  const centerDiv = wrap.append("div")
    .attr("class", "behavior-rug-center")
    .style("overflow-x", "auto") 
    .style("overflow-y", "hidden");


  // Floating Legend
  const rightDiv = container.append("div")
    .attr("class", "behavior-rug-right")
    .style("position", "absolute")
    .style("right", "20px")
    .style("top", "50px")
    .style("height", "230px")
    .style("width", "170px")
    .style("z-index", "100")
    .style("background", "rgba(255, 255, 255, 0.85)")
    .style("border", "1px solid #ddd")
    .style("border-radius", "6px")
    .style("box-shadow", "0 4px 12px rgba(0,0,0,0.15)")
    .style("padding", "10px")
    .style("display", "none") // Default hidden
    .style("max-height", "80%")
    .style("overflow-y", "hidden")
    .style("pointer-events", "auto");

  const leftSvg = leftDiv.append("svg").attr("class", "behavior-rug-svg");
  const centerSvg = centerDiv.append("svg").attr("class", "behavior-rug-svg");
  const rightSvg = rightDiv.append("svg").attr("class", "behavior-rug-svg");

  function toggleLegend(show) {
    rightDiv.style("display", show ? "block" : "none");
  }

  // ==================================================
  // 4) Helpers (speed, direction, cor monocromática)
  // ==================================================
  function normalizeToken(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_");
  }

  /**
   * Retorna um valor canônico:
   * "Muito_Lento" | "Lento" | "Medio" | "Rapido" | "Muito_Rapido"
   */
  function getSpeed(symbol) {
    if (!symbol) return null;
    const t = normalizeToken(symbol);

    if (t.includes("muito_rapido") || t.includes("muito-rapido") || t.includes("muitorapido")) return "Muito_Rapido";
    if (t.includes("muito_lento") || t.includes("muito-lento") || t.includes("muitolento")) return "Muito_Lento";

    if (t.includes(normalizeToken(SPEED_STRINGS?.LENTO ?? "lento"))) return "Lento";
    if (t.includes(normalizeToken(SPEED_STRINGS?.MEDIO ?? "medio"))) return "Medio";

    if (
      t.includes(normalizeToken(SPEED_STRINGS?.RAPIDO ?? "rapido")) ||
      (SPEED_STRINGS?.RAPIDO_ALT && t.includes(normalizeToken(SPEED_STRINGS.RAPIDO_ALT)))
    ) return "Rapido";

    return null;
  }

  function getDirection(symbol) {
    if (!symbol) return null;
    if (symbol.includes(DIRECTION_STRINGS.NORTE)) return DIRECTION_STRINGS.N;
    if (symbol.includes(DIRECTION_STRINGS.SUL)) return DIRECTION_STRINGS.S;
    if (symbol.includes(DIRECTION_STRINGS.LESTE)) return DIRECTION_STRINGS.E;
    if (symbol.includes(DIRECTION_STRINGS.OESTE)) return DIRECTION_STRINGS.W;
    return null;
  }

  /**
   * Monocromático do mais claro ao mais escuro.
   * Estratégia: mistura a cor base com branco (claro) em diferentes intensidades.
   * Você controla os "stops" pela posição (0..1).
   */
  const baseColor = VISUALIZATION_CONFIG.baseGlyphColor || "#164773";
  const mixToWhite = (t) => d3.interpolateRgb("#ffffff", baseColor)(t);

  // Ordem claro -> escuro
  const SPEED_LEVELS = ["Muito_Lento", "Lento", "Medio", "Rapido", "Muito_Rapido"];

  // Stops (0 = branco, 1 = baseColor). Ajuste livre.
  // Aqui: Muito_Lento quase branco; Muito_Rapido quase baseColor.
  const SPEED_T = {
    Muito_Lento: 0.2,
    Lento: 0.4,
    Medio: 0.6,
    Rapido: 0.8,
    Muito_Rapido: 1.0,
  };

  function colorForSpeed(speed) {
    const t = SPEED_T[speed];
    if (t === undefined) return mixToWhite(0.60); // fallback intermediário
    return mixToWhite(t);
  }

  function getLentoIndices(seq) {
    const highlightIndices = new Set();
    if (showLentoMotif) {
      const k = 3;
      for (let i = 0; i <= seq.length - k; i++) {
        let match = true;
        for (let j = 0; j < k; j++) {
          if (!seq[i + j] || seq[i + j].empty || seq[i + j].speed !== "Muito_Lento") {
            match = false;
            break;
          }
        }
        if (match) {
          for (let j = 0; j < k; j++) highlightIndices.add(i + j);
        }
      }
    }
    return highlightIndices;
  }

  function getTurnIndices(seq) {
    const highlightIndices = new Set();
    if (showDirectionChangeMotif) {
      for (let i = 0; i < seq.length - 1; i++) {
        const curr = seq[i];
        const next = seq[i + 1];
        if (curr && !curr.empty && next && !next.empty && curr.dir && next.dir) {
          if ((curr.dir == "N" && next.dir == "S") || (curr.dir == "S" && next.dir == "N") || (curr.dir == "E" && next.dir == "W") || (curr.dir == "W" && next.dir == "E")) {
            highlightIndices.add(i);
            highlightIndices.add(i + 1);
          }
        }
      }
    }
    return highlightIndices;
  }

  function highlightRow(id) {
    selectedTrajectoryId = id;

    // Clear previous selection and temporary hover states
    leftSvg.selectAll(".l-row").classed("selected", false).classed("hovered", false);
    centerSvg.selectAll(".row").classed("row-selected", false).classed("row-hover", false);

    if (!id) return;

    // Apply persistent selection on left and center
    leftSvg.selectAll(".l-row").filter(d => d.id === id).classed("selected", true).classed("hovered", false);
    centerSvg.selectAll(".row").filter(d => d.id === id).classed("row-selected", true).classed("row-hover", false);

    const datum = sequences.find(s => s.id === id);
    if (datum) {
      const lento = getLentoIndices(datum.seq);
      const turns = getTurnIndices(datum.seq);
      // Notify observers instead of calling callback
      eventManager.notify('TRAJECTORY_SELECTED', {
        trajectory: datum,
        options: { highlightLentoIndices: lento, highlightTurnIndices: turns }
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
          const rawSeq = JSON.parse(String(rawJson).replace(/'/g, '"'));
          if (Array.isArray(rawSeq)) {
            seq = rawSeq.map(s => {
              if (!s) return { empty: true };
              const speed = getSpeed(s);
              const dir = getDirection(s);
              return { raw: s, speed, dir };
            });
          }
        }
      } catch (e) { }

      const clusterVal = d.cluster;
      return {
        id: d.trajectory_id,
        trajectory_id: d.trajectory_id,
        cluster: clusterVal,
        seq,
        simbolic_movement: rawJson,
        raw: d,
      };
    });

    sequences.sort((a, b) => d3.ascending(a.cluster, b.cluster) || d3.ascending(a.id, b.id));

    if (!sequences.length) {
      centerSvg.append("text").attr("x", 20).attr("y", 50).text("Sem dados válidos.");
      return;
    }

    // Dimensões
    const cellSize = VISUALIZATION_CONFIG.cellSize ?? 12;
    const cellPadding = VISUALIZATION_CONFIG.cellPadding ?? 2;
    const rowHeight = cellSize + cellPadding;
    const colWidth = cellSize + cellPadding;

    const marginTop = VISUALIZATION_CONFIG.behaviourRug?.marginTop ?? 40;

    const maxLen = d3.max(sequences, d => d.seq.length) || 0;
    const rugWidth = maxLen * colWidth;

    const totalHeight = (sequences.length * rowHeight) + marginTop + 20;

    const leftWidth = VISUALIZATION_CONFIG.behaviourRug?.leftPanelWidth ?? 220;
    const legendWidth = VISUALIZATION_CONFIG.behaviourRug?.legendWidth ?? 220;

    leftSvg.attr("width", leftWidth).attr("height", totalHeight);
    centerSvg.attr("width", rugWidth + 10).attr("height", totalHeight);
    rightSvg.attr("width", legendWidth).attr("height", totalHeight);

    // --- LEFT (clusters + ids) ---
    const leftG = leftSvg.append("g").attr("transform", `translate(0, ${marginTop})`);

    const leftRows = leftG.selectAll(".l-row")
      .data(sequences)
      .enter()
      .append("g")
      .attr("class", "l-row")
      .attr("transform", (d, i) => `translate(0, ${i * rowHeight})`)
      .style("cursor", "pointer")
      .on("click", (e, d) => highlightRow(d.id));

    leftRows.append("rect")
      .attr("width", leftWidth)
      .attr("height", rowHeight)
      .attr("fill", "transparent");

    leftRows
      .filter((d, i) => i === 0 || d.cluster !== sequences[i - 1].cluster)
      .append("text")
      .attr("x", 6)
      .attr("y", rowHeight / 2)
      .attr("dy", ".35em")
      .attr("font-weight", "bold")
      .attr("font-size", 10)
      .attr("fill", baseColor)
      .text(d => `C ${d.cluster}`)
      .style("pointer-events", "none");

    leftRows.append("text")
      .attr("class", "label-id")
      .attr("x", leftWidth - 10)
      .attr("y", rowHeight / 2)
      .attr("dy", ".35em")
      .attr("text-anchor", "end")
      .attr("font-size", 10)
      .attr("fill", "#333")
      .text(d => d.id)
      .style("pointer-events", "none");

    // --- CENTER (glifos) ---
    const cx = cellSize / 2, cy = cellSize / 2;
    const pathN = `M0,0 L${cellSize},0 L${cx},${cy} Z`;
    const pathE = `M${cellSize},0 L${cellSize},${cellSize} L${cx},${cy} Z`;
    const pathS = `M${cellSize},${cellSize} L0,${cellSize} L${cx},${cy} Z`;
    const pathW = `M0,${cellSize} L0,0 L${cx},${cy} Z`;

    const centerG = centerSvg.append("g").attr("transform", `translate(0, ${marginTop})`);

    const rows = centerG.selectAll(".row")
      .data(sequences)
      .enter()
      .append("g")
      .attr("class", "row")
      .attr("transform", (d, i) => `translate(0, ${i * rowHeight})`)
      .style("cursor", "pointer")
      .on("mouseenter", function (e, d) {
        const row = d3.select(this);
        // apply temporary hover class unless it's already the persistent selection
        if (selectedTrajectoryId !== d.id) row.classed("row-hover", true);
        // also highlight left label row on hover (temporary)
        leftSvg.selectAll(".l-row").filter(ld => ld.id === d.id).classed("hovered", true);
      })
      .on("mouseleave", function (e, d) {
        const row = d3.select(this);
        // remove hover class unless persistently selected
        if (selectedTrajectoryId !== d.id) row.classed("row-hover", false);
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

      const lentoIndices = getLentoIndices(rowData.seq);
      const turnIndices = getTurnIndices(rowData.seq);

      const cells = rowG.selectAll(".g-cell")
        .data(rowData.seq)
        .enter()
        .append("g")
        .attr("class", "g-cell")
        .attr("transform", (d, i) => `translate(${i * colWidth}, 0)`);

      // fundo
      cells.append("rect")
        .attr("width", cellSize)
        .attr("height", cellSize)
        .attr("fill", (d, i) => {
          if (turnIndices.has(i)) return "#d2b4de";
          if (lentoIndices.has(i)) return "#fae3b1ff";
          return VISUALIZATION_CONFIG.cellBackgroundColor || "#fff";
        })
        .attr("stroke", (d, i) => {
          if (turnIndices.has(i)) return "#8e44ad";
          if (lentoIndices.has(i)) return "#fbbe63ff";
          return VISUALIZATION_CONFIG.cellBorderColor || "#ddd";
        })
        .attr("stroke-width", (d, i) => (turnIndices.has(i) || lentoIndices.has(i)) ? 1.5 : (VISUALIZATION_CONFIG.cellBorderWidth ?? 0.5))
        .style("pointer-events", (d, i) => (turnIndices.has(i) || lentoIndices.has(i)) ? "auto" : "none")
        .on("mouseover", function(event, d) {
            // Need index 'i' which is not passed directly in d3 v6+ if using arrow function with (d, i) from parent data binding?
            // Actually, in d3 v6+, listener is (event, d). 'i' is not passed directly here unless we use closure or nodes index.
            // But we can get 'i' from the parent selection loop or assume data order.
            // Easier: attach the index or motif type to the data bound or element.
            
            // However, 'cells' selection data is 'rowData.seq'.
            // d is the data item. 'i' is the index in the selection.
            // Let's use d3.select(this) to access the element if we need it, but we need 'i' to check indices.
            // We can redo the .data().enter() using .each() to capture 'i' or just use the second arg if available.
            // In d3 v6+, .on("event", (event, d) => {}) - 'this' is element.
            // But we need 'i'.
            
            // Let's use the fact that we set the style above based on 'i'.
            // Actually, we are inside `cells.append("rect")`. We can't easily access `i` in the listener unless we capture it.
            // Refactoring to .each() might be cleaner to attach listeners with closure over `i`.
        })
        .each(function(d, i) {
            const el = d3.select(this);
            const isTurn = turnIndices.has(i);
            const isLento = lentoIndices.has(i);

            if (isTurn || isLento) {
                el.on("mouseover", function(event) {
                    const tooltip = d3.select("body").selectAll(".tooltip").data([0]).join("div").attr("class", "tooltip");
                    let text = "";
                    if (isTurn) text += "Abrupt Turn";
                    if (isTurn && isLento) text += " & ";
                    if (isLento) text += "Very Slow";
                    
                    tooltip.text(text)
                        .style("opacity", 1)
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px");
                })
                .on("mousemove", function(event) {
                    d3.select(".tooltip")
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px");
                })
                .on("mouseout", function() {
                    d3.select(".tooltip").style("opacity", 0);
                });
            }
        });

      // glifos
      cells.each(function (d) {
        if (!d || d.empty) return;
        const el = d3.select(this);

        // Se speed não reconhecido, usa intermediário
        const fill = colorForSpeed(d.speed || "Medio");

        let path = null;
        if (d.dir === DIRECTION_STRINGS.N) path = pathN;
        else if (d.dir === DIRECTION_STRINGS.E) path = pathE;
        else if (d.dir === DIRECTION_STRINGS.S) path = pathS;
        else if (d.dir === DIRECTION_STRINGS.W) path = pathW;

        if (path) {
          el.append("path")
            .attr("d", path)
            .attr("fill", fill)
            .style("pointer-events", "none");
        }
      });
    });

    // --- RIGHT (legenda monocromática) ---
    drawLegend(rightSvg);

    if (selectedTrajectoryId) highlightRow(selectedTrajectoryId);
  }

  function drawLegend(svgContainer) {
    const legend = svgContainer.append("g").attr("transform", `translate(10, 0)`);

    const legDirY = 30;
    const legSize = 30;
    const legCX = legSize / 2;
    const legCY = legSize / 2;

    const legStroke = VISUALIZATION_CONFIG.frenquencyGlyph?.gridLineColor || "#999";

    // Direction (usa a cor base, já que direção não é velocidade)
    const gDir = legend.append("g").attr("transform", `translate(20, ${legDirY})`);
    gDir.append("text")
      .attr("y", -15)
      .attr("x", -10)
      .attr("font-size", 11)
      .attr("font-weight", "bold")
      .text("Direction");

    const addArrow = (d, txt, x, y, anchor) => {
      gDir.append("path")
        .attr("d", d)
        .attr("fill", baseColor)
        .attr("opacity", 0.7)
        .attr("stroke", legStroke);

      gDir.append("text")
        .attr("x", x)
        .attr("y", y)
        .text(txt)
        .attr("text-anchor", anchor)
        .attr("font-size", 9)
        .attr("alignment-baseline", "middle");
    };

    addArrow(`M0,0 L${legSize},0 L${legCX},${legCY} Z`, DIRECTION_STRINGS.N, legCX, -3, "middle");
    addArrow(`M${legSize},0 L${legSize},${legSize} L${legCX},${legCY} Z`, DIRECTION_STRINGS.E, legSize + 3, legCY, "start");
    addArrow(`M${legSize},${legSize} L0,${legSize} L${legCX},${legCY} Z`, DIRECTION_STRINGS.S, legCX, legSize + 8, "middle");
    addArrow(`M0,${legSize} L0,0 L${legCX},${legCY} Z`, DIRECTION_STRINGS.W, -3, legCY, "end");

    // Speed (claro -> escuro)
    const legSpeedY = legDirY + legSize + 40;
    const gSpeed = legend.append("g").attr("transform", `translate(10, ${legSpeedY})`);

    gSpeed.append("text")
      .attr("y", -5)
      .attr("font-size", 11)
      .attr("font-weight", "bold")
      .text("Speed");

    SPEED_LEVELS.forEach((s, i) => {
      const rowY = i * 20;
      const fill = colorForSpeed(s);

      gSpeed.append("rect")
        .attr("x", 0)
        .attr("y", rowY)
        .attr("width", 16)
        .attr("height", 16)
        .attr("fill", fill)
        .attr("stroke", "#999")
        .attr("stroke-width", 0.2);

      gSpeed.append("text")
        .attr("x", 25)
        .attr("y", rowY + 8)
        .attr("dy", ".35em")
        .attr("font-size", 10)
        .text(s);
    });
  }

  render();
}