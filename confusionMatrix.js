import { CLUSTER_COLORS } from './config.js';
import { eventManager } from './events.js';

let selection = null;

eventManager.subscribe('RESET_FILTERS', () => {
    selection = null;
    // We don't necessarily need to redraw here as main.js will trigger a redraw with reset data
    // but if we wanted to clear highlighting immediately without data change, we could.
    // Since main.js calls drawConfusionMatrix on reset, the visual update happens there.
});

export function drawConfusionMatrix(data, containerSelector, fullData = null) {
    const container = d3.select(containerSelector);
    container.selectAll("*").remove();

    if (!data || data.length === 0) {
        container.append("div")
            .attr("class", "panel-placeholder")
            .append("p").text("No data for Confusion Matrix");
        return;
    }

    // 1. Prepare Data & Domains
    // Use fullData for domains if available to keep matrix stable
    const domainData = fullData || data;
    
    const xLabels = Array.from(new Set(domainData.map(d => d.phys_cluster))).sort((a, b) => a - b);
    const yLabels = Array.from(new Set(domainData.map(d => d.cluster))).sort((a, b) => a - b);

    // Initialize matrix
    const matrix = {};
    yLabels.forEach(yVal => {
        matrix[yVal] = {};
        xLabels.forEach(xVal => {
            matrix[yVal][xVal] = { count: 0, ids: [] };
        });
    });

    // Fill matrix with CURRENT (filtered) data
    data.forEach(d => {
        const xVal = d.phys_cluster;
        const yVal = d.cluster;
        if (matrix[yVal] && matrix[yVal][xVal]) {
            matrix[yVal][xVal].count++;
            matrix[yVal][xVal].ids.push(d.trajectory_id);
        }
    });

    // Flatten for D3
    const flatData = [];
    yLabels.forEach(yVal => {
        xLabels.forEach(xVal => {
            flatData.push({
                yVal: yVal,
                xVal: xVal,
                count: matrix[yVal][xVal].count,
                ids: matrix[yVal][xVal].ids
            });
        });
    });

    const maxCount = d3.max(flatData, d => d.count) || 1; // avoid divide by zero

    // 2. Setup Dimensions
    const margin = { top: 10, right: 30, bottom: 45, left: 60 };
    const containerRect = container.node().getBoundingClientRect();
    const width = containerRect.width || 200;
    const height = 220; 
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // 3. Scales
    const x = d3.scaleBand()
        .range([0, innerWidth])
        .domain(xLabels)
        .padding(0.05);

    const y = d3.scaleBand()
        .range([innerHeight, 0])
        .domain(yLabels)
        .padding(0.05);

    const color = d3.scaleSequential()
        .interpolator(d3.interpolateBlues)
        .domain([0, maxCount]);

    // 4. Draw
    // X Axis
    svg.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x));
    
    svg.append("text")
        .attr("class", "axis-label")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 30)
        .style("text-anchor", "middle")
        .style("font-size", "10px")
        .text("Cluster - Qualitative");

    // Y Axis
    svg.append("g")
        .call(d3.axisLeft(y));

    svg.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("y", -30)
        .attr("x", -innerHeight / 2)
        .style("text-anchor", "middle")
        .style("font-size", "10px")
        .text("Cluster Symbolic - Qualitative");

    // Cells
    const cells = svg.selectAll(".cell")
        .data(flatData)
        .enter()
        .append("rect")
        .attr("class", "cell")
        .attr("x", d => x(d.xVal))
        .attr("y", d => y(d.yVal))
        .attr("width", x.bandwidth())
        .attr("height", y.bandwidth())
        .style("fill", d => d.count === 0 ? "#f9f9f9" : color(d.count))
        .style("cursor", "pointer")
        .style("stroke", d => {
            if (selection && selection.yVal === d.yVal && selection.xVal === d.xVal) {
                return "#e74c3c"; // Selected highlight color
            }
            return "#ddd";
        })
        .style("stroke-width", d => {
            if (selection && selection.yVal === d.yVal && selection.xVal === d.xVal) {
                return 3; 
            }
            return 1;
        })
        .on("click", (event, d) => {
            // Toggle selection
            if (selection && selection.yVal === d.yVal && selection.xVal === d.xVal) {
                selection = null;
                eventManager.notify('CONFUSION_MATRIX_FILTER_CHANGED', { trajectoryIds: null });
            } else {
                selection = { yVal: d.yVal, xVal: d.xVal };
                
                let targetIds = d.ids;
                if (fullData) {
                    targetIds = fullData
                        .filter(item => item.cluster === d.yVal && item.phys_cluster === d.xVal)
                        .map(item => item.trajectory_id);
                }
                
                eventManager.notify('CONFUSION_MATRIX_FILTER_CHANGED', { trajectoryIds: targetIds });
            }
        });

    // Text counts
    svg.selectAll(".cell-text")
        .data(flatData)
        .enter()
        .append("text")
        .attr("class", "cell-text")
        .attr("x", d => x(d.xVal) + x.bandwidth() / 2)
        .attr("y", d => y(d.yVal) + y.bandwidth() / 2)
        .style("text-anchor", "middle")
        .style("alignment-baseline", "middle")
        .style("font-size", "10px")
        .style("pointer-events", "none")
        .style("fill", d => d.count > maxCount / 2 ? "white" : "black")
        .text(d => d.count > 0 ? d.count : "");

}
