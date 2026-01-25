import { eventManager } from './events.js';
import { CLUSTER_COLORS } from './config.js';

let currentMode = 'symbolic'; // 'symbolic' or 'physical'

export function drawTSNE(data, containerSelector) {
    const container = d3.select(containerSelector);
    container.selectAll("*").remove();
    
    // Wrapper similar to trajectoryAllPanel
    const wrapper = container.append("div")
        .attr("class", "tsne-view-wrapper")
        .style("width", "100%")
        .style("height", "100%")
        .style("display", "flex")
        .style("flex-direction", "column")
        .style("background", "#fff")
        .style("border-radius", "6px")
        .style("overflow", "hidden"); // Prevent overflow

    // ==================================================
    // 1) Controls
    // ==================================================
    const controls = wrapper.append("div")
        .attr("class", "tsne-controls")
        .style("flex", "0 0 auto") // Fixed height based on content
        .style("display", "flex")
        .style("justify-content", "space-between")
        .style("align-items", "center")
        .style("gap", "8px")
        .style("font-size", "12px")
        .style("background", "#ccccccff")
        .style("padding", "8px")
        .style("border-bottom", "1px solid #ccc");

    // Title in Controls
    controls.append("span")
        .style("font-weight", "bold")
        .text("t-SNE");

    // Radio Buttons Group
    const modeGroup = controls.append("div")
        .style("display", "flex")
        .style("gap", "12px")
        .style("align-items", "center");

    const modes = [
        { id: 'symbolic', label: 'Movement Symbolic' },
        { id: 'physical', label: 'Metrics' }
    ];

    modes.forEach(m => {
        const label = modeGroup.append("label")
            .style("cursor", "pointer")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", "4px");

        const radio = label.append("input")
            .attr("type", "radio")
            .attr("name", "tsne-mode")
            .attr("id", `tsne-mode-${m.id}`)
            .attr("value", m.id)
            .style("cursor", "pointer")
            .on("change", () => setMode(m.id));
        
        if (m.id === currentMode) {
            radio.property("checked", true);
        }

        label.append("span").text(m.label);
    });

    // ==================================================
    // 2) SVG Area
    // ==================================================
    const svgContainer = wrapper.append("div")
        .style("flex", "1 1 auto") // Grow to fill remaining space
        .style("position", "relative")
        .style("width", "100%")
        .style("height", "100%"); // Needs to fill parent

    // Get dimensions from the flexible container
    // We might need to wait for layout or use 100% width/height on SVG
    const rect = container.node().getBoundingClientRect();
    // Estimate available height if rect is full container
    const headerHeight = 35; // approx
    const width = rect.width || 300;
    const height = (rect.height || 300) - headerHeight; 
    
    const margin = {top: 10, right: 15, bottom: 15, left: 15};

    // Use viewBox for responsiveness, but try to respect the container's aspect ratio
    const svg = svgContainer.append("svg")
        .attr("id", "tsne-svg")
        .attr("width", "100%")
        .attr("height", "100%")
        //.attr("viewBox", `0 0 ${width} ${height}`) // Use absolute units for internal coord system if preferred, or calculated
        .style("display", "block");

    // We can use a fixed internal coordinate system and rely on SVG scaling
    // OR we can recalc on resize. For now, let's use the estimated dimensions for the viewBox
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    function updateButtons() {
        wrapper.select(`#tsne-mode-${currentMode}`).property("checked", true);
    }

    // --- State Variables ---
    let xScale, yScale;
    let brush;
    
    // Initial Render of points
    const points = g.selectAll("circle")
        .data(data)
        .enter()
        .append("circle")
        .attr("r", 3)
        .attr("fill", d => CLUSTER_COLORS[Math.abs(+d.cluster % CLUSTER_COLORS.length)])
        .attr("opacity", 0.6)
        .attr("stroke", "none");

    // --- Brush ---
    brush = d3.brush()
        .extent([[-5, -5], [innerWidth+5, innerHeight+5]])
        .on("start brush end", brushed);

    const brushG = g.append("g")
        .attr("class", "brush")
        .call(brush);

    // --- Logic ---

    function setMode(mode) {
        currentMode = mode;
        updateButtons();
        updatePlot();
        brushG.call(brush.move, null);
    }

    function getCols() {
        return currentMode === 'symbolic' 
            ? ['tsne_1', 'tsne_2'] 
            : ['tsne_phis_cluster_1', 'tsne_phis_cluster_2'];
    }

    function updatePlot() {
        const [colX, colY] = getCols();

        const xExtent = d3.extent(data, d => +d[colX]);
        const yExtent = d3.extent(data, d => +d[colY]);

        xScale = d3.scaleLinear()
            .domain(xExtent)
            .range([0, innerWidth])
            .nice();

        yScale = d3.scaleLinear()
            .domain(yExtent)
            .range([innerHeight, 0])
            .nice();

        points.transition().duration(500)
            .attr("cx", d => xScale(+d[colX]))
            .attr("cy", d => yScale(+d[colY]));
    }

    function brushed({selection, type}) {
        if (!selection) {
            if (type === 'end') {
                 eventManager.notify('TSNE_FILTER_CHANGED', { trajectoryIds: null });
                 points.attr("opacity", 0.6);
            }
            return;
        }

        const [[x0, y0], [x1, y1]] = selection;
        const selectedIds = [];
        const [colX, colY] = getCols();

        points.each(function(d) {
            const cx = xScale(+d[colX]);
            const cy = yScale(+d[colY]);
            const isSelected = x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1;
            
            if (isSelected) {
                selectedIds.push(d.trajectory_id);
            }
        });

        points.attr("opacity", d => {
             const cx = xScale(+d[colX]);
             const cy = yScale(+d[colY]);
             return (x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1) ? 0.9 : 0.1;
        });

        if (type === 'end') {
            eventManager.notify('TSNE_FILTER_CHANGED', { trajectoryIds: selectedIds });
        }
    }

    // Handle Reset
    eventManager.subscribe('RESET_FILTERS', () => {
         brushG.call(brush.move, null);
         points.attr("opacity", 0.6)
               .attr("fill", d => CLUSTER_COLORS[Math.abs(+d.cluster % CLUSTER_COLORS.length)])
               .attr("stroke", "none");
    });

    // Initialize
    setMode(currentMode);
}

/**
 * Updates the visual highlight state of the t-SNE points.
 * @param {Array|null} activeIds - List of trajectory IDs to highlight. If null, resets to default.
 * @param {String} containerSelector - Selector for the t-SNE container (e.g. '#tsne-panel')
 */
export function updateTSNEHighlight(activeIds, containerSelector) {
    const container = d3.select(containerSelector);
    if (container.empty()) return;

    const circles = container.selectAll("circle");
    
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
            .attr("opacity", isActive ? 0.9 : 0.05)
            .attr("stroke", isActive ? "#333" : "none")
            .attr("stroke-width", isActive ? 0.5 : 0);
    });
}