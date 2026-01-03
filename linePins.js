import { VISUALIZATION_CONFIG, SPEED_STRINGS, DIRECTION_STRINGS } from './config.js';

export function linePins(data, targetSelector = ".container") {
  const container = d3.select(targetSelector);
  container.selectAll("*").remove();

  const isSingle = data.length === 1;

  // Se for visualização única, não aplicamos altura fixa ou scroll wrapper forçado
  // Se for múltiplo, usamos o wrapper para organizar o grid.
  let contentWrapper;
  
  if (isSingle) {
    contentWrapper = container.append("div")
      .style("display", "flex")
      .style("justify-content", "center")
      .style("width", "100%");
  } else {
    contentWrapper = container.append("div")
      .attr("class", "line-pins-scroll-wrapper")
      .style("width", "100%")
      .style("max-height", "80vh") // Mantido apenas para a visualização "Grid completa"
      .style("overflow-y", "auto");
  }

  // ==================================================
  // Configuração
  // ==================================================
  const size = VISUALIZATION_CONFIG.linePins.glyphSize;
  const half = size / 2;
  const step = half / VISUALIZATION_CONFIG.linePins.glyphLevels;
  const baseColor = VISUALIZATION_CONFIG.baseGlyphColor;

  const speedMap = {
    [SPEED_STRINGS.PARADO]: 0,
    [SPEED_STRINGS.LENTO]: 1,
    [SPEED_STRINGS.MEDIO]: 2,
    [SPEED_STRINGS.RAPIDO]: 3,
    [SPEED_STRINGS.RAPIDO_ALT]: 3
  };

  const dirMap = {
    [DIRECTION_STRINGS.N]: 0,
    [DIRECTION_STRINGS.E]: 1,
    [DIRECTION_STRINGS.S]: 2,
    [DIRECTION_STRINGS.W]: 3
  };

  // Helper de Caminho (Geometry)
  function getRegionPath(direction, level) {
    if (level === 0) return `M${-step},${-step} L${step},${-step} L${step},${step} L${-step},${step} Z`;
    
    const innerR = level * step;
    const outerR = (level + 1) * step;
    
    if (direction === 0) return `M${-innerR},${-innerR} L${innerR},${-innerR} L${outerR},${-outerR} L${-outerR},${-outerR} Z`; // N
    if (direction === 1) return `M${innerR},${-innerR} L${innerR},${innerR} L${outerR},${outerR} L${outerR},${-outerR} Z`; // E
    if (direction === 2) return `M${innerR},${innerR} L${-innerR},${innerR} L${-outerR},${outerR} L${outerR},${outerR} Z`; // S
    if (direction === 3) return `M${-innerR},${innerR} L${-innerR},${-innerR} L${-outerR},${-outerR} L${-outerR},${outerR} Z`; // W
    return "";
  }

  // ==================================================
  // Processamento e Renderização
  // ==================================================
  data.forEach(d => {
    let seq = [];
    try {
      const raw = JSON.parse(d.simbolic_movement.replace(/'/g, '"'));
      if (Array.isArray(raw)) seq = raw;
    } catch (e) {}
    if (seq.length === 0 && !isSingle) return; 

    // Agregação
    const counts = {}; 
    let maxCount = 0;

    seq.forEach(s => {
      if (!s) return;
      // Detecção simples de string (pode ser otimizada com Regex ou includes)
      let spVal = -1, dirVal = -1;

      if (s.includes("Parado")) spVal = 0;
      else if (s.includes("Lento")) spVal = 1;
      else if (s.includes("Medio")) spVal = 2;
      else if (s.includes("apido")) spVal = 3;

      if (s.includes("Norte")) dirVal = 0;
      else if (s.includes("Leste")) dirVal = 1;
      else if (s.includes("Sul")) dirVal = 2;
      else if (s.includes("Oeste")) dirVal = 3;

      if (spVal === 0) {
        counts["0"] = (counts["0"] || 0) + 1;
        maxCount = Math.max(maxCount, counts["0"]);
      } else if (spVal > 0 && dirVal > -1) {
        const key = `${spVal}_${dirVal}`;
        counts[key] = (counts[key] || 0) + 1;
        maxCount = Math.max(maxCount, counts[key]);
      }
    });

    // Render Container Individual
    const plotDiv = contentWrapper.append("div")
      .attr("class", "plot-container");

    plotDiv.append("h4")
      .text(d.trajectory_id)
      .style("margin-bottom", "5px")
      .style("font-size", "12px");

    const svg = plotDiv.append("svg")
      .attr("width", size + 20)
      .attr("height", size + 20);

    const g = svg.append("g")
      .attr("transform", `translate(${size / 2 + 10}, ${size / 2 + 10})`);

    // Fundo
    g.append("rect")
      .attr("x", -half).attr("y", -half)
      .attr("width", size).attr("height", size)
      .attr("fill", VISUALIZATION_CONFIG.cellBackgroundColor)
      .attr("stroke", VISUALIZATION_CONFIG.cellBorderColor);

    // Desenha Níveis
    // Nível 0 (Parado)
    const countP = counts["0"] || 0;
    if (countP > 0) {
        g.append("path")
         .attr("d", getRegionPath(null, 0))
         .attr("fill", baseColor)
         .attr("opacity", countP / maxCount);
    }

    // Níveis 1-3
    for (let l = 1; l <= 3; l++) {
      for (let dir = 0; dir < 4; dir++) {
        const c = counts[`${l}_${dir}`] || 0;
        if (c > 0) {
            g.append("path")
             .attr("d", getRegionPath(dir, l))
             .attr("fill", baseColor)
             .attr("opacity", c / maxCount)
             .append("title").text(`Count: ${c}`);
        }
      }
    }

    // Grid Overlay (Linhas)
    const gridColor = VISUALIZATION_CONFIG.linePins.gridLineColor;
    const gridW = VISUALIZATION_CONFIG.linePins.gridLineWidth;
    
    // Diagonais
    g.append("line").attr("x1", -half).attr("y1", -half).attr("x2", half).attr("y2", half).attr("stroke", gridColor).attr("stroke-width", gridW);
    g.append("line").attr("x1", half).attr("y1", -half).attr("x2", -half).attr("y2", half).attr("stroke", gridColor).attr("stroke-width", gridW);
    
    // Quadrados concêntricos
    for (let i = 1; i <= 4; i++) {
        const r = i * step;
        g.append("rect").attr("x", -r).attr("y", -r).attr("width", r*2).attr("height", r*2).attr("fill", "none").attr("stroke", gridColor).attr("stroke-width", gridW);
    }
  });
}