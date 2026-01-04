// main.js
import { linePins } from './linePins.js';
import { drawBehaviorRug } from './behaviourrug.js';
import { drawTrajectoryView } from './trajectoryView.js';
import { eventManager } from './events.js';
import { drawMarkovMatrices } from './matrixMarkov.js';

const container = document.querySelector('.container');
let fullData; // Renomeei para garantir que tenhamos sempre o original

// Subscribe to trajectory selection
eventManager.subscribe('TRAJECTORY_SELECTED', ({ trajectory, options }) => {
    showGlyphForTrajectory(trajectory, options);
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
    linePins(fullData, '.container');
}

/**
 * Exibe o Behavior Rug.
 * @param {Array} [dataToRender] - Opcional. Se passado, renderiza apenas este subconjunto.
 * @param {String} [title] - Opcional. Título para contexto (ex: "Cluster 3").
 */
function showBehaviorRug(dataToRender = null, title = null) {
    clearContainer();
    
    // Se não passar dados filtrados, usa tudo
    const dataset = dataToRender || fullData;

    container.classList.add('rug-view-layout');
    container.style.overflow = 'hidden'; 

    // Adicionei um header pequeno para indicar se estamos filtrando
    let headerHtml = '';
    if (title) {
        headerHtml = `<div style="padding: 5px 10px; background: #fffbe6; border-bottom: 1px solid #ddd; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <span>Visualizando filtro: <strong>${title}</strong> (${dataset.length} trajetórias)</span>
                        <button id="clear-filter-btn" style="cursor:pointer; font-size:10px;">Remover Filtro</button>
                      </div>`;
    }

    container.innerHTML = `
        <div style="display:flex; flex-direction:column; height:100%;">
            ${headerHtml}
            <div style="flex:1; display:grid; grid-template-columns: 3fr 1fr; gap:10px; overflow:hidden;">
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
    // O container principal não é mais grid direto, mas sim o div interno
    container.classList.remove('rug-view-layout'); 
    // Ajuste CSS necessário para esse novo layout interno:
    const rugPanel = document.getElementById('rug-panel');
    rugPanel.style.background = "#fff";
    rugPanel.style.overflow = "hidden";
    rugPanel.style.border = "1px solid #ddd";

    const glyphPanel = document.getElementById('glyph-panel');
    glyphPanel.style.background = "transparent";
    glyphPanel.style.overflowY = "auto";
    glyphPanel.style.padding = "0px"; // Removed padding

    drawBehaviorRug(dataset, '#rug-panel');

    // Botão para limpar filtro
    const btn = document.getElementById('clear-filter-btn');
    if (btn) {
        btn.onclick = () => showBehaviorRug(null, null); // Reseta
    }
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
    linePins([traj], '#glyph-detail-container');
}

function showMarkovAnalysis() {
    clearContainer();
    
    const header = document.createElement("div");
    header.style.textAlign = "center";
    header.style.padding = "10px";
    header.innerHTML = `<h3>Dinâmica de Transição (Markov 1ª Ordem)</h3>
                        <p style="font-size:12px; color:#666">Probabilidade Média de Transição (Linha → Coluna). Diagonal indica estabilidade.</p>`;
    container.appendChild(header);

    const gridDiv = document.createElement("div");
    gridDiv.id = "markov-container";
    container.appendChild(gridDiv);

    drawMarkovMatrices(fullData, "#markov-container");
}

main();