import { VISUALIZATION_CONFIG, SPEED_STRINGS, DIRECTION_STRINGS } from './config.js';

export function frequencyGlyph(data, targetSelector = ".container") {
  const container = d3.select(targetSelector);
  container.selectAll("*").remove();

  const isSingle = data.length === 1;

  let contentWrapper;
  
  if (isSingle) {
    contentWrapper = container.append("div")
      .style("display", "flex")
      .style("justify-content", "center")
      .style("width", "100%");
  } else {
    contentWrapper = container.append("div")
      .attr("class", "frenquency-glyph-scroll-wrapper")
      .style("width", "100%")
      .style("max-height", "80vh")
      .style("overflow-y", "auto");
  }

  // ==================================================
  // Configuração
  // ==================================================
  const size = VISUALIZATION_CONFIG.frenquencyGlyph.glyphSize;
  const half = size / 2;
  const step = half / VISUALIZATION_CONFIG.frenquencyGlyph.glyphLevels;
  const baseColor = "#050505ff";

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

    const counts = {}; 
    let maxCount = 0;

    seq.forEach(s => {
      if (!s) return;
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

    const plotDiv = contentWrapper.append("div")
      .attr("class", "plot-container")
      .style("display", "flex")
      .style("flex-direction", "column")
      .style("align-items", "center");

    plotDiv.append("h4")
      .html(`<strong>Frequency of states</strong><br>${d.trajectory_id}`)
      .style("margin-bottom", "10px")
      .style("font-size", "12px")
      .style("font-weight", "normal")
      .style("text-align", "center");

    const margin = 35;
    const svg = plotDiv.append("svg")
      .attr("width", size + margin)
      .attr("height", size + margin);

    const g = svg.append("g")
      .attr("transform", `translate(${size / 2 + margin / 2}, ${size / 2 + margin / 2})`);

    g.append("rect")
      .attr("x", -half).attr("y", -half)
      .attr("width", size).attr("height", size)
      .attr("fill", VISUALIZATION_CONFIG.cellBackgroundColor)
      .attr("stroke", VISUALIZATION_CONFIG.cellBorderColor);

    const countP = counts["0"] || 0;
    if (countP > 0) {
      const pStep = half / VISUALIZATION_CONFIG.frenquencyGlyph.glyphLevels;
      g.append("path")
       .attr("d", `M${-pStep},${-pStep} L${pStep},${-pStep} L${pStep},${pStep} L${-pStep},${pStep} Z`)
       .attr("fill", baseColor)
       .attr("opacity", countP / maxCount);
    }

    for (let l = 1; l <= 3; l++) {
      for (let dir = 0; dir < 4; dir++) {
        const c = counts[`${l}_${dir}`] || 0;
        if (c > 0) {
          const innerR = l * step;
          const outerR = (l + 1) * step;
          let path = "";
          if (dir === 0) path = `M${-innerR},${-innerR} L${innerR},${-innerR} L${outerR},${-outerR} L${-outerR},${-outerR} Z`;
          if (dir === 1) path = `M${innerR},${-innerR} L${innerR},${innerR} L${outerR},${outerR} L${outerR},${-outerR} Z`;
          if (dir === 2) path = `M${innerR},${innerR} L${-innerR},${innerR} L${-outerR},${outerR} L${outerR},${outerR} Z`;
          if (dir === 3) path = `M${-innerR},${innerR} L${-innerR},${-innerR} L${-outerR},${-outerR} L${-outerR},${outerR} Z`;
          
          g.append("path")
           .attr("d", path)
           .attr("fill", baseColor)
           .attr("opacity", c / maxCount)
           .append("title").text(`Count: ${c}`);
        }
      }
    }

    const gridColor = VISUALIZATION_CONFIG.frenquencyGlyph.gridLineColor;
    const gridW = VISUALIZATION_CONFIG.frenquencyGlyph.gridLineWidth;
    
    g.append("line").attr("x1", -half).attr("y1", -half).attr("x2", half).attr("y2", half).attr("stroke", gridColor).attr("stroke-width", gridW);
    g.append("line").attr("x1", half).attr("y1", -half).attr("x2", -half).attr("y2", half).attr("stroke", gridColor).attr("stroke-width", gridW);
    
    for (let i = 1; i <= 4; i++) {
        const r = i * step;
        g.append("rect").attr("x", -r).attr("y", -r).attr("width", r*2).attr("height", r*2).attr("fill", "none").attr("stroke", gridColor).attr("stroke-width", gridW);
    }

    const labelOffset = half + 10;
    const labels = [
        { text: "N", x: 0, y: -labelOffset },
        { text: "E", x: labelOffset, y: 0 },
        { text: "S", x: 0, y: labelOffset },
        { text: "W", x: -labelOffset, y: 0 }
    ];

    labels.forEach(l => {
        g.append("text")
            .attr("x", l.x)
            .attr("y", l.y)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .style("font-size", "10px")
            .style("fill", "#666")
            .style("font-weight", "bold")
            .text(l.text);
    });

    if (isSingle) {
        const formatMetric = (val) => {
            const num = parseFloat(val);
            return isNaN(num) ? "N/A" : num.toFixed(3);
        };

        const metricsDiv = plotDiv.append("div")
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("align-items", "center")
            .style("margin-top", "10px")
            .style("font-size", "11px")
            .style("color", "#555");

        const metrics = [
            { label: "Shannon Entropy", value: d.shannon_entropy, desc: "Measures the uncertainty or diversity of movement states. Higher values indicate more varied behavior." },
            { label: "Avg Dwell Time", value: d.avg_dwell_time, desc: "The average number of consecutive time steps spent in the same state (speed and direction)." },
            { label: "High Speed Ratio", value: d.high_speed_ratio, desc: "The fraction of the total trajectory duration spent in high or very high speed states." }
        ];

        metrics.forEach(m => {
            metricsDiv.append("div")
                .style("cursor", "help")
                .style("margin-bottom", "4px")
                .style("text-align", "center")
                .html(`<strong>${m.label}:</strong> ${formatMetric(m.value)}`)
                .on("mouseover", (event) => {
                    const tooltip = d3.select("body").selectAll(".tooltip").data([0]).join("div").attr("class", "tooltip");
                    tooltip.text(m.desc)
                        .style("opacity", 1)
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px");
                })
                .on("mousemove", (event) => {
                    d3.select(".tooltip")
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px");
                })
                .on("mouseout", () => {
                    d3.select(".tooltip").style("opacity", 0);
                });
        });
    }
  });
}