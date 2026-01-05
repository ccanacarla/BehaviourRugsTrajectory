// main.js
import { frequencyGlyph } from './frenquecyGlyph.js';
import { drawBehaviorRug } from './behaviourrug.js';
import { drawTrajectoryView } from './trajectory.js';
import { eventManager } from './events.js';
import { drawclusterMatrices } from './cluster.js';

const container = document.querySelector('.container');
let fullData; // Renomeei para garantir que tenhamos sempre o original

// Subscribe to trajectory selection
eventManager.subscribe('TRAJECTORY_SELECTED', ({ trajectory, options }) => {
    showGlyphForTrajectory(trajectory, options);
});

// Subscribe to cluster selection (Multi)
eventManager.subscribe('CLUSTERS_CHANGED', ({ clusterIds }) => {
    if (!fullData) return;
    
    let filtered = fullData;
    let title = null;

    if (clusterIds && clusterIds.length > 0) {
        // Convert to strings for safe comparison if needed, though usually consistent
        const setIds = new Set(clusterIds.map(String));
        filtered = fullData.filter(d => setIds.has(String(d.clusterIds ?? d.cluster)));
        
        if (clusterIds.length <= 3) {
            title = `Clusters: ${clusterIds.join(", ")}`;
        } else {
            title = `${clusterIds.length} Clusters Selecionados`;
        }
    }

    updateRugPanel(filtered, title);
});

async function main() {
    fullData = await d3.csv("outputs/symbolic.csv");
    // Inicia com o Heatmap para dar a visão geral primeiro (sugestão de fluxo)
    showBehaviorRug(); 
}

function clearContainer() {
    container.innerHTML = '';
    container.classList.remove('rug-view-layout');
    container.style.overflow = 'auto'; 
}

function showLinePins() {
    clearContainer();
    frequencyGlyph(fullData, '.container');
}

/**
 * Exibe o Behavior Rug.
 * @param {Array} [dataToRender] - Opcional. Se passado, renderiza apenas este subconjunto.
 * @param {String} [title] - Opcional. Título para contexto (ex: "Cluster 3").
 */
function showBehaviorRug(dataToRender = null, title = null) {
    // If container already has the layout, just update
    if (document.getElementById('rug-panel') && document.getElementById('cluster-panel')) {
        updateRugPanel(dataToRender, title);
        return;
    }

    clearContainer();
    
    const dataset = dataToRender || fullData;
    container.classList.add('rug-view-layout');
    container.style.overflow = 'hidden'; 

    container.innerHTML = `
        <div style="display:flex; flex-direction:column; height:100%;">
            <div id="rug-header"></div>
            <div style="flex:1; display:grid; grid-template-columns: 0.4fr 3.6fr 1fr; gap:10px; overflow:hidden;">
                <div id="cluster-panel"></div>
                <div id="rug-panel"></div>
                <div id="glyph-panel">
                    <div style="text-align:center; margin-top: 50%; ">
                        <p>Selecione uma trajetória</p>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove estilos inline do HTML anterior para usar o grid interno novo
    container.classList.remove('rug-view-layout'); 
    
    const clusterPanel = document.getElementById('cluster-panel');
    clusterPanel.style.background = "#fff";
    clusterPanel.style.overflowY = "auto";
    clusterPanel.style.borderRadius = "8px";
    clusterPanel.style.border = "1px solid #ddd";
    
    const rugPanel = document.getElementById('rug-panel');
    rugPanel.style.background = "#fff";
    rugPanel.style.borderRadius = "8px";
    rugPanel.style.border = "1px solid #ddd";
    rugPanel.style.overflow = "hidden";

    const glyphPanel = document.getElementById('glyph-panel');
    glyphPanel.style.background = "transparent";
    glyphPanel.style.overflowY = "auto";
    //glyphPanel.style.border = "1px solid #ddd";
    glyphPanel.style.padding = "0px"; 

    // Initial population
    drawclusterMatrices(fullData, '#cluster-panel'); // Always full data for Markov? Or filtered? Usually full for context.
    updateRugPanel(dataset, title);
}

function updateRugPanel(dataset, title) {
    const data = dataset || fullData;
    const header = document.getElementById('rug-header');
    
    if (title) {
        header.innerHTML = `<div style="padding: 5px 10px; margin: 0 0 10px 0; background: #e0eff3ff; border-bottom: 1px solid #ddd; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <span>Visualizando filtro: <strong>${title}</strong> (${data.length} trajetórias)</span>
                        <button id="clear-filter-btn" style="cursor:pointer; font-size:10px;">Remover Filtro</button>
                      </div>`;
        
        document.getElementById('clear-filter-btn').onclick = () => {
            updateRugPanel(null, null);
            eventManager.notify('RESET_FILTERS');
        };
    } else {
        header.innerHTML = '';
    }

    drawBehaviorRug(data, '#rug-panel');
}

function showGlyphForTrajectory(traj, opts) {
    const panel = document.getElementById('glyph-panel');
    panel.innerHTML = '';
    
    // Configura o painel para empilhamento vertical limpo
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '0';

    const trajDiv = document.createElement('div');
    trajDiv.id = 'trajectory-viz-container';
    trajDiv.style.width = '100%';
    trajDiv.style.flexShrink = '0'; // Evita que encolha
    panel.appendChild(trajDiv);
    drawTrajectoryView(traj, '#trajectory-viz-container', opts);
    
    const glyphDiv = document.createElement('div');
    glyphDiv.id = 'glyph-detail-container';
    glyphDiv.style.width = '100%';
    glyphDiv.style.flexShrink = '0';
    panel.appendChild(glyphDiv);
    frequencyGlyph([traj], '#glyph-detail-container');
}

function showclusterAnalysis() {
    clearContainer();
    
    const header = document.createElement("div");
    header.style.textAlign = "center";
    header.style.padding = "10px";
    header.innerHTML = `<h3>Dinâmica de Transição (Markov 1ª Ordem)</h3>
                        <p style="font-size:12px; color:#666">Probabilidade Média de Transição (Linha → Coluna). Diagonal indica estabilidade.</p>`;
    container.appendChild(header);

    const gridDiv = document.createElement("div");
    gridDiv.id = "cluster-container";
    container.appendChild(gridDiv);

    drawclusterMatrices(fullData, "#cluster-container");
}

main();