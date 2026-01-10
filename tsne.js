import { eventManager } from './events.js';
import { CLUSTER_COLORS } from './config.js';

export function drawTSNE(data, containerSelector) {
    const container = d3.select(containerSelector);
    container.selectAll("*").remove();
    
    // Check if container has size, if not, might need a default or wait
    let rect = container.node().getBoundingClientRect();
    if (rect.width === 0) {
        // Fallback or force some height if it's hidden initially
        // But usually it should have size from CSS
    }

    const margin = {top: 15, right: 15, bottom: 15, left: 15};
    // Use container dimensions
    const width = (rect.width || 300) - margin.left - margin.right;
    const height = (rect.height || 300) - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("id", "tsne-svg") // Add ID for easier selection
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Title
    container.append("div")
        .style("position", "absolute")
        .style("top", "5px")
        .style("left", "10px")
        .style("font-size", "12px")
        .style("font-weight", "bold")
        .style("pointer-events", "none")
        .style("z-index", "10")
        .text("t-SNE");

    // Scales
    const xExtent = d3.extent(data, d => +d.tsne_1);
    const yExtent = d3.extent(data, d => +d.tsne_2);

    const xScale = d3.scaleLinear()
        .domain(xExtent)
        .range([0, width])
        .nice();

    const yScale = d3.scaleLinear()
        .domain(yExtent)
        .range([height, 0])
        .nice();

    // Points
    const points = svg.selectAll("circle")
        .data(data)
        .enter()
        .append("circle")
        .attr("cx", d => xScale(+d.tsne_1))
        .attr("cy", d => yScale(+d.tsne_2))
        .attr("r", 3)
        .attr("fill", d => CLUSTER_COLORS[Math.abs(+d.cluster % CLUSTER_COLORS.length)])
        .attr("opacity", 0.6)
        .attr("stroke", "none");

    // Brush
    const brush = d3.brush()
        .extent([[-5, -5], [width+5, height+5]]) // slightly larger to capture edge points
        .on("start brush end", brushed);

    svg.append("g")
        .attr("class", "brush")
        .call(brush);

    // Handle Reset
    eventManager.subscribe('RESET_FILTERS', () => {
         svg.select(".brush").call(brush.move, null);
         points.attr("opacity", 0.6).attr("fill", d => CLUSTER_COLORS[Math.abs(+d.cluster % CLUSTER_COLORS.length)]);
    });

    function brushed({selection, type}) {
        if (!selection) {
            if (type === 'end') {
                 // Only notify on clear if it was an explicit clear or end without selection
                 // Usually d3 brush end with null selection means cleared
                 eventManager.notify('TSNE_FILTER_CHANGED', { trajectoryIds: null });
                 points.attr("opacity", 0.6);
            }
            return;
        }

        const [[x0, y0], [x1, y1]] = selection;
        const selectedIds = [];

        points.each(function(d) {
            const cx = xScale(+d.tsne_1);
            const cy = yScale(+d.tsne_2);
            const isSelected = x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1;
            
            if (isSelected) {
                selectedIds.push(d.trajectory_id);
            }
        });

        // Visual feedback during brush
        points.attr("opacity", d => {
             const cx = xScale(+d.tsne_1);
             const cy = yScale(+d.tsne_2);
             return (x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1) ? 0.9 : 0.1;
        });

        if (type === 'end') {
            eventManager.notify('TSNE_FILTER_CHANGED', { trajectoryIds: selectedIds });
        }
    }
}

/**
 * Updates the visual highlight state of the t-SNE points.
 * @param {Array|null} activeIds - List of trajectory IDs to highlight. If null, resets to default.
 * @param {String} containerSelector - Selector for the t-SNE container (e.g. '#tsne-panel')
 */
export function updateTSNEHighlight(activeIds, containerSelector) {
    // We select the circles inside the container's SVG
    const container = d3.select(containerSelector);
    if (container.empty()) return;

    const circles = container.selectAll("circle");
    
    // If no active list provided (e.g. clear filters), reset to default state
    if (!activeIds) {
        circles
            .attr("opacity", 0.6)
            .attr("stroke", "none");
        return;
    }

    const idSet = new Set(activeIds);
    
    circles.each(function(d) {
        const isActive = idSet.has(d.trajectory_id);
        d3.select(this)
            .attr("opacity", isActive ? 0.9 : 0.05) // Make non-matches very dim
            .attr("stroke", isActive ? "#333" : "none")
            .attr("stroke-width", isActive ? 0.5 : 0);
    });
}
