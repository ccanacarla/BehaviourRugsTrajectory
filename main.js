import { frequencyGlyph } from './frenquecyGlyph.js';
import { drawBehaviorRug } from './behaviourrug.js';
import { drawTrajectoryView } from './trajectory.js';
import { drawTrajectoryView as drawTrajectoryViewAll } from './trajectoryAll.js';
import { eventManager } from './events.js';
import { drawclusterMatrices } from './cluster.js';
import { drawTSNE, updateTSNEHighlight } from './tsne.js';
import { parseSequence, hasLentoMotif, hasTurnMotif, hasCustomMotif } from './dataUtils.js';
import { CLUSTER_COLORS } from './config.js';
import { initVideoPanel } from './videoPanel.js';
import { generatePDFReport } from './reportGenerator.js';
import { drawConfusionMatrix } from './confusionMatrix.js';

let fullData;
let currentFilteredData = [];
let selectedTrajectory = null;
let videoPanel;

const filterState = {
    clusterIds: null,
    tsneIds: null,
    matrixIds: null,
    motifConfig: null,
    userId: null
};

/* -------------------- EVENTS -------------------- */

eventManager.subscribe('TRAJECTORY_SELECTED', ({ trajectory, options }) => {
    selectedTrajectory = trajectory;

    if (!trajectory) {
        drawTrajectoryView([], '#trajectory-panel');
        frequencyGlyph([], '#frequency-panel');
        drawTrajectoryViewAll(currentFilteredData, '#trajectory-all-panel', { highlightId: null });
        if (videoPanel) videoPanel.update(null);
        return;
    }

    showGlyphForTrajectory(trajectory, options);

    const clusterVal = trajectory.cluster ?? trajectory.raw?.cluster;
    const highlightColor = clusterVal !== undefined
        ? CLUSTER_COLORS[Math.abs(+clusterVal % CLUSTER_COLORS.length)]
        : "#ffeb3b";

    drawTrajectoryViewAll(currentFilteredData, '#trajectory-all-panel', {
        highlightId: trajectory.id || trajectory.trajectory_id,
        highlightColor
    });

    if (videoPanel) videoPanel.update(trajectory, { highlightColor });
});

eventManager.subscribe('FRAME_SELECT_TRAJECTORY', (data) => {
    if (videoPanel) {
        if (data && (!selectedTrajectory || (selectedTrajectory.id !== data.trajectoryId))) {
            const traj = currentFilteredData.find(d => d.trajectory_id === data.trajectoryId) || 
                         fullData.find(d => d.trajectory_id === data.trajectoryId);
            if (traj) {
                const clusterVal = traj.cluster ?? traj.raw?.cluster;
                const highlightColor = clusterVal !== undefined
                    ? CLUSTER_COLORS[Math.abs(+clusterVal % CLUSTER_COLORS.length)]
                    : "#ffeb3b";
                videoPanel.update(traj, { highlightColor });
                
                // Update selection if needed (e.g. if we want to force the selection immediately)
                selectedTrajectory = traj;
            }
        }
        videoPanel.setSelection(data);
    }

    // Update Trajectory View Highlight
    if (data && selectedTrajectory && selectedTrajectory.id === data.trajectoryId) {
        drawTrajectoryView([selectedTrajectory], '#trajectory-panel', {
            highlightId: selectedTrajectory.id,
            highlightSegmentInterval: { startIndex: data.startIndex, endIndex: data.endIndex }
        });
    } else if (!data && selectedTrajectory) {
        // Clear highlight if data is null (reset)
        drawTrajectoryView([selectedTrajectory], '#trajectory-panel', {
            highlightId: selectedTrajectory.id,
            highlightSegmentInterval: null
        });
    }
});

eventManager.subscribe('CLUSTERS_CHANGED', ({ clusterIds }) => {
    filterState.clusterIds = clusterIds;
    applyFilters();
});

eventManager.subscribe('TSNE_FILTER_CHANGED', ({ trajectoryIds }) => {
    filterState.tsneIds = trajectoryIds;
    applyFilters();
});

eventManager.subscribe('CONFUSION_MATRIX_FILTER_CHANGED', ({ trajectoryIds }) => {
    filterState.matrixIds = trajectoryIds;
    applyFilters();
});

eventManager.subscribe('MOTIF_CONFIG_CHANGED', config => {
    filterState.motifConfig = config;
    applyFilters();
});

eventManager.subscribe('USER_FILTER_CHANGED', ({ userId }) => {
    filterState.userId = userId;
    applyFilters();
});

eventManager.subscribe('RESET_FILTERS', () => {
    filterState.clusterIds = null;
    filterState.tsneIds = null;
    filterState.matrixIds = null;
    filterState.motifConfig = null;
    filterState.userId = null;
    selectedTrajectory = null;
    if (videoPanel) videoPanel.update(null);
    applyFilters();
});

eventManager.subscribe('RUG_BRUSH_CHANGED', ({ trajectoryIds }) => {
    updateTSNEHighlight(trajectoryIds, '#tsne-panel');
    
    drawTrajectoryViewAll(currentFilteredData, '#trajectory-all-panel', {
        highlightId: selectedTrajectory?.id,
        highlightIds: trajectoryIds,
        highlightColor: selectedTrajectory 
            ? (selectedTrajectory.cluster !== undefined ? CLUSTER_COLORS[Math.abs(+selectedTrajectory.cluster % CLUSTER_COLORS.length)] : "#ffeb3b") 
            : undefined
    });

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

    // 1. User Filter
    if (filterState.userId) {
        filteredForClusters = filteredForClusters.filter(d => d.user_id === filterState.userId);
        filteredForRug = filteredForRug.filter(d => d.user_id === filterState.userId);
        activeFilters.push('User');
    }

    // 2. t-SNE Filter
    if (filterState.tsneIds?.length) {
        const ids = new Set(filterState.tsneIds);
        filteredForClusters = filteredForClusters.filter(d => ids.has(d.trajectory_id));
        filteredForRug = filteredForRug.filter(d => ids.has(d.trajectory_id));
        activeFilters.push('t-SNE');
    }

    // 3. Motif Filter
    if (filterState.motifConfig) {
        const { activeMotifs, column } = filterState.motifConfig;
        
        const isCustomActive = activeMotifs.custom && (
            (typeof activeMotifs.custom === 'string' && activeMotifs.custom.trim() !== "") ||
            (Array.isArray(activeMotifs.custom) && activeMotifs.custom.length > 0 && (activeMotifs.custom[0].speed !== undefined || activeMotifs.custom[0].dir !== undefined || Object.keys(activeMotifs.custom[0]).length === 0) && activeMotifs.custom.some(p => p.speed || p.dir)) ||
            (Array.isArray(activeMotifs.custom) && activeMotifs.custom.some(m => m.pattern && m.pattern.some(p => p.speed || p.dir)))
        );

        if (activeMotifs.lento || activeMotifs.turn || isCustomActive) {
            const f = d => {
                const seq = parseSequence(d[column]);
                if (activeMotifs.lento && !hasLentoMotif(seq)) return false;
                if (activeMotifs.turn && !hasTurnMotif(seq)) return false;
                if (isCustomActive && !hasCustomMotif(seq, activeMotifs.custom)) return false;
                return true;
            };
            
            const tempFiltered = filteredForRug.filter(f);
            
            if (tempFiltered.length === 0) {
                alert("No trajectories were found with this motif. The filter has been removed.");
                filterState.motifConfig = null;
                applyFilters(); 
                return;
            }

            filteredForClusters = filteredForClusters.filter(f);
            filteredForRug = tempFiltered;
            activeFilters.push('Motifs');
        }
    }

    // SNAPSHOT for Confusion Matrix (Before Matrix and Cluster Filters)
    const dataForMatrix = filteredForRug;

    // 4. Matrix Filter (Confusion Matrix Selection)
    if (filterState.matrixIds?.length) {
        const ids = new Set(filterState.matrixIds);
        filteredForClusters = filteredForClusters.filter(d => ids.has(d.trajectory_id));
        filteredForRug = filteredForRug.filter(d => ids.has(d.trajectory_id));
        activeFilters.push('Matrix');
    }

    // 5. Cluster Filter (Manual Selection)
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
    
    // Use the snapshot to keep the matrix populated regardless of its own selection
    drawConfusionMatrix(dataForMatrix, '#confusion-matrix-panel', fullData, filterState.clusterIds);

    updateTSNEHighlight(
        activeFilters.length ? currentFilteredData.map(d => d.trajectory_id) : null, 
        '#tsne-panel'
    );

    const allUserIds = Array.from(new Set(fullData.map(d => d.user_id))).sort((a, b) => a - b);
    drawBehaviorRug(filteredForRug, '#rug-panel', { 
        ...filterState.motifConfig, 
        userId: filterState.userId,
        allUserIds: allUserIds
    });
}

/* -------------------- VIEWS -------------------- */

function showGlyphForTrajectory(traj, opts = {}) {
    drawTrajectoryView([traj], '#trajectory-panel', {
        ...opts,
        highlightId: traj.id || traj.trajectory_id
    });
    frequencyGlyph([traj], '#frequency-panel');
}

/* -------------------- INIT -------------------- */

async function main() {
    try {
        videoPanel = initVideoPanel('#video-panel');

        fullData = await d3.csv('outputs/symbolic.csv');
        if (!fullData || fullData.length === 0) throw new Error("Dataset is empty or failed to load.");

        currentFilteredData = fullData;

        drawTSNE(fullData, '#tsne-panel');
        drawTrajectoryViewAll(fullData, '#trajectory-all-panel');
        
        /*
        // Add Report Button
        const leftCol = d3.select('.left-column');
        // Check if button already exists to avoid duplicates if re-run (though main runs once)
        if (leftCol.select("#btn-pdf-report").empty()) {
            leftCol.append("button")
                .attr("id", "btn-pdf-report")
                .attr("class", "rug-btn")
                .style("margin-top", "10px") // Margin top since it's below
                .style("padding", "8px")
                .style("background", "#164773")
                .style("color", "white")
                .style("border", "none")
                .style("border-radius", "4px")
                .style("cursor", "pointer")
                .style("font-size", "12px")
                .style("font-weight", "bold")
                .text("📄 Generate PDF Report")
                .on("click", function() {
                    const btn = d3.select(this);
                    const originalText = btn.text();
                    
                    // Ask user for optional comment
                    const userComment = prompt("Add a comment to the report (optional):", "");
                    
                    // If user cancelled (userComment === null), don't proceed
                    if (userComment === null) return;
                    
                    btn.text("Generating...").attr("disabled", true).style("background", "#ccc");
                    
                    // Allow UI to update before starting heavy task
                    setTimeout(async () => {
                        try {
                            await generatePDFReport(filterState, currentFilteredData, selectedTrajectory, userComment);
                        } catch (e) {
                            console.error(e);
                            alert("Failed to generate report: " + e.message);
                        } finally {
                            btn.text(originalText).attr("disabled", null).style("background", "#164773");
                        }
                    }, 50);
                });
        }*/

        applyFilters();

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
            .html(`<strong>Error loading application:</strong><br>${error.message}`);
    }
}

main();