import { VISUALIZATION_CONFIG } from './config.js';
import { eventManager } from './events.js';

export function drawclusterMatrices(data, containerSelector) {
    const container = d3.select(containerSelector);
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
    // Simplificação: Agrupamos "Muito_Rapido" com "Rapido" para visualização compacta.
    // Se desejar separar, adicione "Muito_Lento" e "Muito_Rapido" nesta lista.
    const speeds = ["Parado", "Lento", "Medio", "Rapido"];
    const directions = ["N", "E", "S", "W"];
    const states = [];

    // Gera lista de estados ordenada: Parado, Lento_N, Lento_E...
    speeds.forEach(s => {
        if (s === "Parado") {
            states.push("Parado");
        } else {
            directions.forEach(d => {
                states.push(`${s}_${d}`);
            });
        }
    });

    // Mapa auxiliar: Nome do Estado -> Índice na Matriz
    const stateToIdx = {};
    states.forEach((s, i) => stateToIdx[s] = i);
    const nStates = states.length;

    // ==================================================
    // 2. Normalização de Tokens (Parser)
    // ==================================================
    function normalizeToken(token) {
        if (!token) return null;
        // Remove acentos e converte para facilitar o match
        const t = token.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        // 1. Detecta Velocidade
        let s = null;
        if (t.includes("Parado")) s = "Parado";
        else if (t.includes("Muito_Lento") || t.includes("Muito-Lento")) s = "Lento"; // Agrupando
        else if (t.includes("Lento")) s = "Lento";
        else if (t.includes("Medio")) s = "Medio";
        else if (t.includes("Muito_Rapido") || t.includes("Muito-Rapido")) s = "Rapido"; // Agrupando
        else if (t.includes("Rapido") || t.includes("apido")) s = "Rapido";

        if (!s) return null;
        if (s === "Parado") return "Parado";

        // 2. Detecta Direção
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
    
    // Agrupa dados por cluster
    const clustersMap = d3.group(data, d => d.cluster); // CSV usa coluna 'cluster'
    const clusterResults = [];

    for (const [clusterId, trajectories] of clustersMap) {
        if (!clusterId) continue;

        // Matriz Acumuladora para o Cluster
        const sumMatrix = Array(nStates).fill(0).map(() => Array(nStates).fill(0));
        let validTrajCount = 0;

        trajectories.forEach(traj => {
            let seqRaw = [];
            try {
                // Tenta ler 'movement_list' (prioridade) ou 'simbolic_movement'
                // O CSV usa aspas simples ['A','B'], então replace(/'/g, '"') é crucial
                const rawStr = traj.movement_list || traj.simbolic_movement || "[]";
                const jsonStr = rawStr.replace(/'/g, '"');
                seqRaw = JSON.parse(jsonStr);
            } catch (e) {
                console.warn(`Erro no parse da trajetória ${traj.trajectory_id}:`, e);
                return; 
            }

            if (!Array.isArray(seqRaw) || seqRaw.length < 2) return;

            // Mapeia string bruta -> índice do estado
            const seqIndices = seqRaw.map(token => {
                const key = normalizeToken(token);
                return stateToIdx[key];
            }).filter(idx => idx !== undefined);

            if (seqIndices.length < 2) return;

            // Calcula Matriz de Transição Individual (Contagem)
            const countMatrix = Array(nStates).fill(0).map(() => Array(nStates).fill(0));
            for (let i = 0; i < seqIndices.length - 1; i++) {
                const curr = seqIndices[i];
                const next = seqIndices[i+1];
                countMatrix[curr][next] += 1;
            }

            // Normaliza (Probabilidade) e Soma ao Cluster
            // (Equivalente ao seu Python: prob_matrix = matrix / row_sums)
            for (let r = 0; r < nStates; r++) {
                const rowSum = d3.sum(countMatrix[r]);
                if (rowSum > 0) {
                    for (let c = 0; c < nStates; c++) {
                        // Acumula a probabilidade na matriz mestra
                        sumMatrix[r][c] += (countMatrix[r][c] / rowSum);
                    }
                }
            }
            validTrajCount++;
        });

        // Calcula Média do Cluster (Divide pelo N de trajetórias)
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

    // Ordena clusters numericamente
    clusterResults.sort((a, b) => parseInt(a.id) - parseInt(b.id));

    // ==================================================
    // 4. Renderização (Small Multiples)
    // ==================================================
    const cellSize = 5;
    const margin = { top: 15, right: 5, bottom: 10, left: 5 };
    const width = nStates * cellSize;
    const height = nStates * cellSize;
    
    // Escala Monocromática: Branco -> Azul Escuro
    const baseColor = VISUALIZATION_CONFIG.baseGlyphColor || "#022fab";
    const colorScale = d3.scaleSequential(t => d3.interpolateRgb("#ffffff", baseColor)(t))
        .domain([0, 1]);

    // State for selection
    const selectedClusters = new Set();

    // Subscribe to external reset
    eventManager.subscribe('RESET_FILTERS', () => {
        selectedClusters.clear();
        wrapper.selectAll("div")
            .style("border-color", "#ddd")
            .style("background", "#fff");
    });

    clusterResults.forEach(clusterData => {
        const card = wrapper.append("div")
            .attr("data-cluster-id", clusterData.id) // Helper for selection
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("align-items", "center")
            .style("background", "#fff")
            .style("border", "1px solid #ddd")
            .style("border-radius", "4px")
            .style("padding", "5px")
            .style("box-shadow", "0 1px 2px rgba(0,0,0,0.05)")
            .style("cursor", "pointer") // Indicate interactivity
            .on("click", function() {
                const id = clusterData.id;
                if (selectedClusters.has(id)) {
                    selectedClusters.delete(id);
                    d3.select(this).style("border-color", "#ddd").style("background", "#fff");
                } else {
                    selectedClusters.add(id);
                    d3.select(this).style("border-color", "#022fab").style("background", "#e6f7ff");
                }
                
                eventManager.notify('CLUSTERS_CHANGED', {
                   clusterIds: Array.from(selectedClusters)
                });
            });

        // Cabeçalho do Card
        card.append("div")
            .style("font-weight", "bold")
            .style("font-size", "11px")
            .style("margin-bottom", "2px")
            .text(`Cluster ${clusterData.id}`);
            
       /* card.append("div")
            .style("font-size", "9px")
            .style("color", "#777")
            .style("margin-bottom", "4px")
            .text(`n=${clusterData.count}`);*/

        const svg = card.append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Borda da matriz
        svg.append("rect")
            .attr("width", width)
            .attr("height", height)
            .attr("fill", "#fafafa")
            .attr("stroke", "#eee");

        // Desenha Células
        for (let r = 0; r < nStates; r++) {
            for (let c = 0; c < nStates; c++) {
                const prob = clusterData.matrix[r][c];
                if (prob <= 0.01) continue; // Otimização visual (limpeza)

                svg.append("rect")
                    .attr("x", c * cellSize)
                    .attr("y", r * cellSize)
                    .attr("width", cellSize)
                    .attr("height", cellSize)
                    .attr("fill", colorScale(prob))
                    .append("title") // Tooltip nativo simples
                    .text(`${states[r]} → ${states[c]}\nProb: ${(prob*100).toFixed(1)}%`);
            }
        }

        // Linha Diagonal (Identidade)
        svg.append("line")
            .attr("x1", 0).attr("y1", 0)
            .attr("x2", width).attr("y2", height)
            .attr("stroke", "#333")
            .attr("stroke-width", 0.5)
            .attr("stroke-dasharray", "2,2")
            .attr("opacity", 0.3)
            .style("pointer-events", "none");

        // Labels dos eixos (Simplificados)
        // Eixo Y (Origem)
        svg.append("text").attr("x", -2).attr("y", cellSize/2 + 2)
           .text("P").style("font-size", "6px").attr("text-anchor", "end");
        
        // Eixo X (Destino)
        svg.append("text").attr("x", cellSize/2).attr("y", -2)
           .text("P").style("font-size", "6px").attr("text-anchor", "middle");

        // Label explicativo (Origem -> Destino)
        svg.append("text")
           .attr("x", width / 2)
           .attr("y", height + 8)
           .text("Destino")
           .attr("text-anchor", "middle")
           .attr("font-size", "7px")
           .attr("fill", "#999");
    });
}