import { VISUALIZATION_CONFIG, CLUSTER_COLORS } from './config.js';
import { eventManager } from './events.js';

/**
 * Draws the cluster matrices (Markov transition probabilities).
 * @param {Array} data - The dataset to visualize (filtered or full).
 * @param {String} containerSelector - The DOM selector for the container.
 * @param {Array} [activeClusterIds=null] - List of currently selected cluster IDs.
 */
export function drawclusterMatrices(data, containerSelector, activeClusterIds = null) {
    const container = d3.select(containerSelector);

    // Check if we are updating existing DOM (optimization/cleanliness) or rebuilding
    // For now, simpler to rebuild since data shape changes with filters
    container.selectAll("*").remove();

    const wrapper = container.append("div")
        .attr("class", "cluster-grid-wrapper")
        .style("display", "flex")
        .style("flex-wrap", "wrap")
        .style("gap", "8px")
        .style("justify-content", "center")
        .style("padding", "10px");

    // ==================================================
    // 1. Definição do Espaço de Estados
    // ==================================================
    const speeds = ["Parado", "Lento", "Medio", "Rapido"];
    const directions = ["N", "E", "S", "W"];
    const states = [];

    speeds.forEach(s => {
        if (s === "Parado") {
            states.push("Parado");
        } else {
            directions.forEach(d => {
                states.push(`${s}_${d}`);
            });
        }
    });

    const stateToIdx = {};
    states.forEach((s, i) => stateToIdx[s] = i);
    const nStates = states.length;

    // ==================================================
    // 2. Normalização de Tokens (Parser)
    // ==================================================
    function normalizeToken(token) {
        if (!token) return null;
        const t = token.normalize("NFD").replace(/[̀-ͯ]/g, "");

        let s = null;
        if (t.includes("Parado")) s = "Parado";
        else if (t.includes("Muito_Lento") || t.includes("Muito-Lento")) s = "Lento";
        else if (t.includes("Lento")) s = "Lento";
        else if (t.includes("Medio")) s = "Medio";
        else if (t.includes("Muito_Rapido") || t.includes("Muito-Rapido")) s = "Rapido";
        else if (t.includes("Rapido") || t.includes("apido")) s = "Rapido";

        if (!s) return null;
        if (s === "Parado") return "Parado";

        let d = null;
        if (t.includes("Norte") || t.includes("_N")) d = "N";
        else if (t.includes("Leste") || t.includes("East") || t.includes("_E") || t.includes("_L")) d = "E";
        else if (t.includes("Sul") || t.includes("_S")) d = "S";
        else if (t.includes("Oeste") || t.includes("West") || t.includes("_W") || t.includes("_O")) d = "W";

        if (s && d) return `${s}_${d}`;
        return null;
    }

    // ==================================================
    // 3. Processamento dos Dados
    // ==================================================
    const clustersMap = d3.group(data, d => d.cluster);
    const clusterResults = [];

    for (const [clusterId, trajectories] of clustersMap) {
        if (!clusterId) continue;

        const sumMatrix = Array(nStates).fill(0).map(() => Array(nStates).fill(0));
        let validTrajCount = 0;

        trajectories.forEach(traj => {
            let seqRaw = [];
            try {
                const rawStr = traj.movement_list || traj.simbolic_movement || "[]";
                const jsonStr = rawStr.replace(/'/g, '"');
                seqRaw = JSON.parse(jsonStr);
            } catch (e) {
                return;
            }

            if (!Array.isArray(seqRaw) || seqRaw.length < 2) return;

            const seqIndices = seqRaw.map(token => {
                const key = normalizeToken(token);
                return stateToIdx[key];
            }).filter(idx => idx !== undefined);

            if (seqIndices.length < 2) return;

            const countMatrix = Array(nStates).fill(0).map(() => Array(nStates).fill(0));
            for (let i = 0; i < seqIndices.length - 1; i++) {
                const curr = seqIndices[i];
                const next = seqIndices[i + 1];
                countMatrix[curr][next] += 1;
            }

            for (let r = 0; r < nStates; r++) {
                const rowSum = d3.sum(countMatrix[r]);
                if (rowSum > 0) {
                    for (let c = 0; c < nStates; c++) {
                        sumMatrix[r][c] += (countMatrix[r][c] / rowSum);
                    }
                }
            }
            validTrajCount++;
        });

        const avgMatrix = Array(nStates).fill(0).map(() => Array(nStates).fill(0));
        if (validTrajCount > 0) {
            for (let r = 0; r < nStates; r++) {
                for (let c = 0; c < nStates; c++) {
                    avgMatrix[r][c] = sumMatrix[r][c] / validTrajCount;
                }
            }
        }

        clusterResults.push({
            id: clusterId,
            matrix: avgMatrix,
            count: validTrajCount
        });
    }

    clusterResults.sort((a, b) => parseInt(a.id) - parseInt(b.id));

    // ==================================================
    // 4. Renderização
    // ==================================================
    const cellSize = 5;
    const margin = { top: 10, right: 5, bottom: 0, left: 5 };
    const width = nStates * cellSize;
    const height = nStates * cellSize;

    const baseColor = VISUALIZATION_CONFIG.baseGlyphColor || "#022fab";
    const heatmapColorScale = d3.scaleSequential(t => d3.interpolateRgb("#ffffff", baseColor)(t))
        .domain([0, 1]);

    const selectedSet = new Set(activeClusterIds || []);

    if (clusterResults.length === 0) {
        container.append("div")
            .style("padding", "10px")
            .style("font-size", "12px")
            .style("color", "#777")
            .text("No data for the current filters.");
    }

    clusterResults.forEach(clusterData => {
        const cId = clusterData.id;
        const cColor = CLUSTER_COLORS[Math.abs(+cId % CLUSTER_COLORS.length)];
        const isSelected = selectedSet.has(cId);

        const card = wrapper.append("div")
            .attr("data-cluster-id", cId)
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("align-items", "center")
            .style("padding", "5px")
            .style("background", isSelected ? d3.color(cColor).copy({ opacity: 0.1 }) : "#fff")
            .style("border", isSelected ? `1px solid ${cColor}` : "1px solid #ddd")
            .style("border-radius", "4px")
            .style("box-shadow", "0 1px 2px rgba(0,0,0,0.05)")
            .style("cursor", "pointer")
            .on("click", function () {
                const newSet = new Set(selectedSet);
                if (newSet.has(cId)) {
                    newSet.delete(cId);
                } else {
                    newSet.add(cId);
                }

                eventManager.notify('CLUSTERS_CHANGED', {
                    clusterIds: Array.from(newSet)
                });
            });

        card.append("div")
            .style("font-weight", "bold")
            .style("border-radius", "4px 4px 0 0")
            .style("font-size", "11px")
            .style("text-align", "center")   // <-- correção
            .style("background", d3.color(cColor).copy({ opacity: 0.8 }))
            .style("width", "100%")
            .style("padding", "2px 0")
            .text(`Cluster ${cId}`);


        card.append("div")
            .style("font-size", "9px")
            .style("margin-bottom", "2px")
            .style("text-align", "center")   // <-- correção
            .style("padding", "2px 0")
            .style("background", d3.color(cColor).copy({ opacity: 0.8 }))
            .style("width", "100%")
            .text(`n=${clusterData.count}`);

        const svg = card.append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        svg.append("rect")
            .attr("width", width)
            .attr("height", height)
            .attr("fill", "#fafafa")
            .attr("stroke", "#eee");

        for (let r = 0; r < nStates; r++) {
            for (let c = 0; c < nStates; c++) {
                const prob = clusterData.matrix[r][c];
                if (prob <= 0.01) continue;

                svg.append("rect")
                    .attr("x", c * cellSize)
                    .attr("y", r * cellSize)
                    .attr("width", cellSize)
                    .attr("height", cellSize)
                    .attr("fill", heatmapColorScale(prob))
                    .append("title")
                    .text(`${states[r]} → ${states[c]}\nProb: ${(prob * 100).toFixed(1)}%`);
            }
        }

        svg.append("line")
            .attr("x1", 0).attr("y1", 0)
            .attr("x2", width).attr("y2", height)
            .attr("stroke", "#333")
            .attr("stroke-width", 0.5)
            .attr("stroke-dasharray", "2,2")
            .attr("opacity", 0.3)
            .style("pointer-events", "none");

        /*svg.append("text").attr("x", -2).attr("y", cellSize / 2 + 2)
            .text("P").style("font-size", "6px").attr("text-anchor", "end");

        svg.append("text").attr("x", cellSize / 2).attr("y", -2)
            .text("P").style("font-size", "6px").attr("text-anchor", "middle");*/

        /*svg.append("text")
            .attr("x", width / 2)
            .attr("y", height + 8)
            .text("Destino")
            .attr("text-anchor", "middle")
            .attr("font-size", "7px")
            .attr("fill", "#999");*/
    });
}