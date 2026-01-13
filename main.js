import { frequencyGlyph } from './frenquecyGlyph.js';
import { drawBehaviorRug } from './behaviourrug.js';
import { drawTrajectoryView } from './trajectory.js';
import { drawTrajectoryView as drawTrajectoryViewAll } from './trajectoryAll.js';
import { eventManager } from './events.js';
import { drawclusterMatrices } from './cluster.js';
import { drawTSNE, updateTSNEHighlight } from './tsne.js';
import { parseSequence, hasLentoMotif, hasTurnMotif, hasCustomMotif } from './dataUtils.js';
import { CLUSTER_COLORS } from './config.js';

let fullData;
let currentFilteredData = [];
let selectedTrajectory = null;

const filterState = {
    clusterIds: null,
    tsneIds: null,
    motifConfig: null
};

/* -------------------- EVENTS -------------------- */

eventManager.subscribe('TRAJECTORY_SELECTED', ({ trajectory, options }) => {
    selectedTrajectory = trajectory;

    if (!trajectory) {
        drawTrajectoryView([], '#trajectory-panel');
        frequencyGlyph([], '#frequency-panel');
        drawTrajectoryViewAll(currentFilteredData, '#trajectory-all-panel', { highlightId: null });
        return;
    }

    showGlyphForTrajectory(trajectory, options, null);

    const clusterVal = trajectory.cluster ?? trajectory.raw?.cluster;
    const highlightColor = clusterVal !== undefined
        ? CLUSTER_COLORS[Math.abs(+clusterVal % CLUSTER_COLORS.length)]
        : "#ffeb3b";

    drawTrajectoryViewAll(currentFilteredData, '#trajectory-all-panel', {
        highlightId: trajectory.id || trajectory.trajectory_id,
        highlightColor
    });
});

eventManager.subscribe('CLUSTERS_CHANGED', ({ clusterIds }) => {
    filterState.clusterIds = clusterIds;
    applyFilters();
});

eventManager.subscribe('TSNE_FILTER_CHANGED', ({ trajectoryIds }) => {
    filterState.tsneIds = trajectoryIds;
    applyFilters();
});

eventManager.subscribe('MOTIF_CONFIG_CHANGED', config => {
    filterState.motifConfig = config;
    applyFilters();
});

eventManager.subscribe('RESET_FILTERS', () => {
    filterState.clusterIds = null;
    filterState.tsneIds = null;
    filterState.motifConfig = null;
    selectedTrajectory = null;
    applyFilters();
});

eventManager.subscribe('RUG_BRUSH_CHANGED', ({ trajectoryIds }) => {
    // Highlight in TSNE
    updateTSNEHighlight(trajectoryIds, '#tsne-panel');
    
    // Highlight in Trajectory All
    drawTrajectoryViewAll(currentFilteredData, '#trajectory-all-panel', {
        highlightId: selectedTrajectory?.id, // Keep single selection if exists
        highlightIds: trajectoryIds,
        highlightColor: selectedTrajectory ? (selectedTrajectory.cluster !== undefined ? CLUSTER_COLORS[Math.abs(+selectedTrajectory.cluster % CLUSTER_COLORS.length)] : "#ffeb3b") : undefined
    });

    // Update Cluster Panel
    const dataForClusters = (trajectoryIds && trajectoryIds.length > 0)
        ? currentFilteredData.filter(d => trajectoryIds.includes(d.trajectory_id))
        : currentFilteredData;

    drawclusterMatrices(dataForClusters, '#cluster-panel', filterState.clusterIds, fullData);
});

/* -------------------- FILTERS -------------------- */

function applyFilters() {
    if (!fullData) return;

    let filteredForClusters = fullData;
    let filteredForRug = fullData;
    let activeFilters = [];

    if (filterState.tsneIds?.length) {
        const ids = new Set(filterState.tsneIds);
        filteredForClusters = filteredForClusters.filter(d => ids.has(d.trajectory_id));
        filteredForRug = filteredForRug.filter(d => ids.has(d.trajectory_id));
        activeFilters.push('t-SNE');
    }

    if (filterState.motifConfig) {
        const { activeMotifs, column } = filterState.motifConfig;
        const isCustomActive = activeMotifs.custom && (
            (typeof activeMotifs.custom === 'string' && activeMotifs.custom.trim() !== "") ||
            (Array.isArray(activeMotifs.custom) && activeMotifs.custom.some(p => p.speed || p.dir))
        );

        if (activeMotifs.lento || activeMotifs.turn || isCustomActive) {
            const f = d => {
                const seq = parseSequence(d[column]);
                if (activeMotifs.lento && !hasLentoMotif(seq)) return false;
                if (activeMotifs.turn && !hasTurnMotif(seq)) return false;
                if (isCustomActive && !hasCustomMotif(seq, activeMotifs.custom)) return false;
                return true;
            };
            filteredForClusters = filteredForClusters.filter(f);
            filteredForRug = filteredForRug.filter(f);
            activeFilters.push('Motifs');
        }
    }

    if (filterState.clusterIds?.length) {
        const ids = new Set(filterState.clusterIds.map(String));
        filteredForRug = filteredForRug.filter(d =>
            ids.has(String(d.clusterIds ?? d.cluster))
        );
        activeFilters.push('Clusters');
    }

    currentFilteredData = filteredForRug;

    drawTrajectoryViewAll(currentFilteredData, '#trajectory-all-panel');
    drawclusterMatrices(filteredForClusters, '#cluster-panel', filterState.clusterIds, fullData);

    if (activeFilters.length) {
        updateTSNEHighlight(currentFilteredData.map(d => d.trajectory_id), '#tsne-panel');
    } else {
        updateTSNEHighlight(null, '#tsne-panel');
    }

    drawBehaviorRug(filteredForRug, '#rug-panel', filterState.motifConfig);
}

/* -------------------- VIEWS -------------------- */

function showGlyphForTrajectory(traj, opts) {
    drawTrajectoryView([traj], '#trajectory-panel', {
        ...opts,
        highlightId: traj.id || traj.trajectory_id,
        highlightLentoIndices: opts.highlightLentoIndices,
        highlightTurnIndices: opts.highlightTurnIndices,
        highlightCustomIndices: opts.highlightCustomIndices
    });

    frequencyGlyph([traj], '#frequency-panel');
}

/* -------------------- INIT -------------------- */

async function main() {
    try {
        fullData = await d3.csv('outputs/symbolic.csv');
        if (!fullData || fullData.length === 0) throw new Error("Dataset is empty or failed to load.");
        
        currentFilteredData = fullData;

        drawTSNE(fullData, '#tsne-panel');
        drawTrajectoryViewAll(fullData, '#trajectory-all-panel');
        drawclusterMatrices(fullData, '#cluster-panel', null, fullData);

        drawBehaviorRug(fullData, '#rug-panel');
    } catch (error) {
        console.error("Initialization Error:", error);
        d3.select("body").append("div")
            .style("position", "fixed")
            .style("top", "50%")
            .style("left", "50%")
            .style("transform", "translate(-50%, -50%)")
            .style("background", "#ffcccc")
            .style("color", "#990000")
            .style("padding", "20px")
            .style("border", "1px solid #cc0000")
            .style("border-radius", "5px")
            .style("box-shadow", "0 0 10px rgba(0,0,0,0.2)")
            .html(`<strong>Error loading application:</strong><br>${error.message}`);
    }
}

main();
