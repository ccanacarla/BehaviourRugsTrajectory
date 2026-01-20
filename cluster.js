import { VISUALIZATION_CONFIG, CLUSTER_COLORS } from './config.js';
import { eventManager } from './events.js';
import { parseTrajectoryData, calculateStraightLineDistance } from './dataUtils.js';

/**
 * Draws the cluster matrices (Markov transition probabilities) and summary statistics.
 * @param {Array} data - The dataset to visualize (filtered or full).
 * @param {String} containerSelector - The DOM selector for the container.
 * @param {Array} [activeClusterIds=null] - List of currently selected cluster IDs.
 * @param {Array} [fullData=null] - The full dataset for percentage calculation.
 */
export function drawclusterMatrices(data, containerSelector, activeClusterIds = null, fullData = null) {
    const container = d3.select(containerSelector);

    container.selectAll("*").remove();

    const wrapper = container.append("div")
        .attr("class", "cluster-grid-wrapper")
        .style("display", "flex")
        .style("flex-wrap", "wrap")
        .style("gap", "12px")
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
    
    // Global Analysis for Metric Reference (Quintiles)
    const sourceData = fullData || data;
    const globalMetrics = {
        speed: [],
        distance: [],
        entropy: [],
        dwell: []
    };

    sourceData.forEach(d => {
        const s = parseFloat(d.high_speed_ratio || 0);
        const e = parseFloat(d.shannon_entropy || 0);
        const dw = parseFloat(d.avg_dwell_time || 0);
        
        if (!isNaN(s)) globalMetrics.speed.push(s);
        if (!isNaN(e)) globalMetrics.entropy.push(e);
        if (!isNaN(dw)) globalMetrics.dwell.push(dw);
        
        // Distance needs parsing
        const pts = parseTrajectoryData(d.trajectory_xy);
        const dist = calculateStraightLineDistance(pts);
        if (!isNaN(dist)) globalMetrics.distance.push(dist);
    });

    // Helper to get quintile thresholds
    const getThresholds = (arr) => {
        arr.sort((a, b) => a - b);
        if (arr.length === 0) return [0, 0, 0, 0];
        return [
            d3.quantile(arr, 0.2),
            d3.quantile(arr, 0.4),
            d3.quantile(arr, 0.6),
            d3.quantile(arr, 0.8)
        ];
    };

    const metricThresholds = {
        speed: getThresholds(globalMetrics.speed),
        distance: getThresholds(globalMetrics.distance),
        entropy: getThresholds(globalMetrics.entropy),
        dwell: getThresholds(globalMetrics.dwell)
    };

    // Total counts for global percentage
    const totalCounts = {};
    let globalTotal = 0;
    if (fullData) {
        const fullMap = d3.group(fullData, d => d.cluster);
        for (const [cid, rows] of fullMap) {
            let valid = 0;
            rows.forEach(r => {
                try {
                   const raw = JSON.parse((r.movement_list || r.simbolic_movement || "[]").replace(/'/g, '"'));
                   if(Array.isArray(raw) && raw.length >= 2) valid++;
                } catch(e){}
            });
            totalCounts[cid] = valid;
            globalTotal += valid;
        }
    } else {
        globalTotal = data.length;
    }

    const clustersMap = d3.group(data, d => d.cluster);
    const clusterResults = [];

    for (const [clusterId, trajectories] of clustersMap) {
        if (!clusterId) continue;

        const sumMatrix = Array(nStates).fill(0).map(() => Array(nStates).fill(0));
        let validTrajCount = 0;
        
        // Sums for averages
        let sumSpeed = 0;
        let sumDistance = 0;
        let sumEntropy = 0;
        let sumDwell = 0;
        let countMetrics = 0;

        trajectories.forEach(traj => {
            // Metrics Calculation
            const speed = parseFloat(traj.high_speed_ratio || 0);
            const entropy = parseFloat(traj.shannon_entropy || 0);
            const dwell = parseFloat(traj.avg_dwell_time || 0);
            
            // Calculate distance on the fly if needed
            const points = parseTrajectoryData(traj.trajectory_xy);
            const dist = calculateStraightLineDistance(points);

            if (!isNaN(speed) && !isNaN(entropy) && !isNaN(dwell) && !isNaN(dist)) {
                sumSpeed += speed;
                sumDistance += dist;
                sumEntropy += entropy;
                sumDwell += dwell;
                countMetrics++;
            }

            // Matrix Calculation
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

        // Compute Cluster Averages
        const avgSpeed = countMetrics > 0 ? sumSpeed / countMetrics : 0;
        const avgDistance = countMetrics > 0 ? sumDistance / countMetrics : 0;
        const avgEntropy = countMetrics > 0 ? sumEntropy / countMetrics : 0;
        const avgDwell = countMetrics > 0 ? sumDwell / countMetrics : 0;

        clusterResults.push({
            id: clusterId,
            matrix: avgMatrix,
            count: validTrajCount,
            total: totalCounts[clusterId] || validTrajCount,
            metrics: {
                speed: avgSpeed,
                distance: avgDistance,
                entropy: avgEntropy,
                dwell: avgDwell
            }
        });
    }

    clusterResults.sort((a, b) => parseInt(a.id) - parseInt(b.id));

    // ==================================================
    // 4. Renderização
    // ==================================================
    const cellSize = 5;
    const margin = { top: 5, right: 5, bottom: 5, left: 5 };
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
        return;
    }

    // Helper to generate compact progress bar with value and score using quintile thresholds
    function createMetricBar(container, value, thresholds, maxValue) {
        const barContainer = container.append("div")
            .style("display", "flex")
            .style("flex-direction", "row")
            .style("align-items", "center")
            .style("gap", "4px")
            .style("flex", "1");
        
        // Calculate score (1-5)
        let score = 1;
        if (value > thresholds[3]) score = 5;
        else if (value > thresholds[2]) score = 4;
        else if (value > thresholds[1]) score = 3;
        else if (value > thresholds[0]) score = 2;
        
        // Color: solid blue (no variation)
        const barColor = "#999";
        
        // Progress bar
        const barWrapper = barContainer.append("div")
            .style("flex", "0 1 35px")
            .style("min-width", "25px")
            .style("height", "8px")
            .style("background", "#e0e0e0")
            .style("border-radius", "2px")
            .style("overflow", "hidden")
            .style("position", "relative");
        
        const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;
        barWrapper.append("div")
            .style("height", "100%")
            .style("width", percentage + "%")
            .style("background", barColor)
            .style("transition", "width 0.3s ease")
            .style("border-radius", "2px");
        
        // Value label
        barContainer.append("div")
            .style("font-size", "8px")
            .style("color", "#888")
            .style("text-align", "right")
            .style("min-width", "10px")
            .text(value.toFixed(2));
    }

    clusterResults.forEach(clusterData => {
        const cId = clusterData.id;
        const cColor = CLUSTER_COLORS[Math.abs(+cId % CLUSTER_COLORS.length)];
        const isSelected = selectedSet.has(cId);
        
        // Calculate percentages
        // 'n' is clusterData.count
        // '%' is (n / globalTotal) * 100
        const percentage = globalTotal > 0 
            ? ((clusterData.count / globalTotal) * 100).toFixed(1) 
            : "0.0";

        const card = wrapper.append("div")
            .attr("data-cluster-id", cId)
            .style("display", "flex")
            .style("flex-direction", "column") // Top-down layout
            .style("background", isSelected ? d3.color(cColor).copy({ opacity: 0.1 }) : "#fff")
            .style("border", isSelected ? `1px solid ${cColor}` : "1px solid #ddd")
            .style("border-radius", "4px")
            .style("box-shadow", "0 1px 2px rgba(0,0,0,0.05)")
            .style("cursor", "pointer")
            .style("padding", "0") // Padding moved to internal containers
            .on("click", function () {
                const newSet = new Set(selectedSet);
                if (newSet.has(cId)) {
                    newSet.delete(cId);
                }
                else {
                    newSet.add(cId);
                }

                eventManager.notify('CLUSTERS_CHANGED', {
                    clusterIds: Array.from(newSet)
                });
            });

        // 1. Header (Full Width)
        const header = card.append("div")
            .style("background", d3.color(cColor).copy({ opacity: 0.8 }))
            .style("color", "#333")
            .style("padding", "4px 0")
            .style("border-radius", "3px 3px 0 0")
            .style("width", "100%")
            .style("text-align", "center")
            .style("display", "flex")
            .style("flex-direction", "column");

        header.append("div")
            .style("font-weight", "bold")            
            .style("font-size", "12px")
            .style("color", "#333")
            .text(`Cluster ${cId}`);

        header.append("div")
            .style("font-size", "9px")
            .style("opacity", "0.95")
            .text(`n: ${clusterData.count} (${percentage}%)`);

        // 2. Content Row (Matrix & Stats)
        const contentRow = card.append("div")
            .style("display", "flex")
            .style("flex-direction", "row")
            .style("padding", "2px");

        // 2a. Left Side: Matrix
        const leftCol = contentRow.append("div")
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("align-items", "center")
            .style("margin-right", "4px");

        const svg = leftCol.append("svg")
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

        // 2b. Right Side: Statistics
        const rightCol = contentRow.append("div")
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("justify-content", "center")
            .style("font-size", "9px")
            .style("gap", "2px")
            .style("min-width", "100px")
            .style("flex", "1");

        // Calculate max values for normalization
        const maxSpeed = Math.max(...clusterResults.map(c => c.metrics.speed));
        const maxDistance = Math.max(...clusterResults.map(c => c.metrics.distance));
        const maxEntropy = Math.max(...clusterResults.map(c => c.metrics.entropy));
        const maxDwell = Math.max(...clusterResults.map(c => c.metrics.dwell));

        // Metric rows with labels and bars
        const addMetricBar = (label, value, thresholds, maxVal) => {
            const row = rightCol.append("div")
                .style("display", "flex")
                .style("flex-direction", "row")
                .style("align-items", "center")
                .style("gap", "1px");
            
            row.append("span")
                .style("font-size", "8px")
                .style("line-height", "1.2")
                .style("min-width", "35px")
                .text(label);
            
            createMetricBar(row, value, thresholds, maxVal);
        };

        addMetricBar("Speed", clusterData.metrics.speed, metricThresholds.speed, maxSpeed);
        addMetricBar("Distance", clusterData.metrics.distance, metricThresholds.distance, maxDistance);
        addMetricBar("Entropy", clusterData.metrics.entropy, metricThresholds.entropy, maxEntropy);
        addMetricBar("Dwell", clusterData.metrics.dwell, metricThresholds.dwell, maxDwell);
    });
}