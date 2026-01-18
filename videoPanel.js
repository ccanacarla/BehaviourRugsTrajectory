import { CLUSTER_COLORS } from './config.js';
import { parseTrajectoryData } from './dataUtils.js';

// Constante determinística do projeto
const TOTAL_VIDEO_FRAMES = 1470;

export function initVideoPanel(containerSelector) {
    console.log("Initializing Video Panel in:", containerSelector);
    const container = d3.select(containerSelector);
    container.html('');

    // --- Placeholder ---
    const placeholder = container.append("div")
        .attr("class", "panel-placeholder");
        
    placeholder.append("p").text("Select a trajectory");

    // --- Estrutura DOM (Classes definidas no CSS) ---

    // 1. Container Principal
    const mainContainer = container.append("div")
        .attr("class", "video-player-container")
        .style("display", "none");

    // 2. Área de Visualização
    const viewArea = mainContainer.append("div")
        .attr("class", "video-view-area");

    // Wrapper interno para Aspect Ratio (Video + Canvas)
    const contentWrapper = viewArea.append("div")
        .style("position", "relative")
        .style("width", "0px")
        .style("height", "0px");

    const video = contentWrapper.append("video")
        .attr("class", "video-element")
        .attr("muted", true)
        .attr("playsinline", true);

    const canvas = contentWrapper.append("canvas")
        .attr("class", "canvas-overlay");

    /*
    // Legenda
    const legend = contentWrapper.append("div")
        .attr("class", "video-legend-overlay")
        .html(`<span style="color:#aaa;">▬ Trajetória</span>`);
*/
    // 3. Barra de Controles
    const controlsContainer = mainContainer.append("div")
        .attr("class", "video-controls");

    const playPauseBtn = controlsContainer.append("button")
        .attr("class", "video-btn")
        .text("⏸ Pause");

    const progressTrack = controlsContainer.append("div")
        .attr("class", "video-progress-track");

    const progressBar = progressTrack.append("div")
        .attr("class", "video-progress-fill");

    // --- Contexto e Variáveis de Estado ---
    const ctx = canvas.node().getContext("2d");
    let stopCurrentVideo = null;

    // --- Lógica de Redimensionamento (Aspect Fit) ---
    const resizeContent = () => {
        const vidNode = video.node();
        const vw = vidNode.videoWidth;
        const vh = vidNode.videoHeight;

        if (!vw || !vh) return;

        const areaNode = viewArea.node();
        const areaWidth = areaNode.clientWidth;
        const areaHeight = areaNode.clientHeight;

        const videoRatio = vw / vh;
        const areaRatio = areaWidth / areaHeight;

        let finalW, finalH;

        if (areaRatio > videoRatio) {
            // Altura limita
            finalH = areaHeight;
            finalW = finalH * videoRatio;
        } else {
            // Largura limita
            finalW = areaWidth;
            finalH = finalW / videoRatio;
        }

        contentWrapper
            .style("width", `${finalW}px`)
            .style("height", `${finalH}px`);

        // Sincroniza resolução do canvas
        canvas.node().width = vw;
        canvas.node().height = vh;
    };

    const resizeObserver = new ResizeObserver(() => {
        window.requestAnimationFrame(resizeContent);
    });
    resizeObserver.observe(viewArea.node());

    // --- Objeto Público ---
    return {
        update: (trajectory, options) => {
            // Limpa vídeo anterior
            if (stopCurrentVideo) {
                stopCurrentVideo();
                stopCurrentVideo = null;
            }

            ctx.clearRect(0, 0, canvas.node().width, canvas.node().height);

            if (!trajectory) {
                mainContainer.style("display", "none");
                placeholder.style("display", "flex");
                video.node().src = "";
                return;
            }

            // Ativa UI
            placeholder.style("display", "none");
            mainContainer.style("display", "flex");
            
            video.style("display", "block");
            controlsContainer.classed("active", true);
            playPauseBtn.text("⏸ Pause");

            // Inicia Lógica do Vídeo
            const controller = setupVideoLogic(
                video.node(),
                canvas.node(),
                ctx,
                trajectory,
                options || {},
                {
                    onProgress: (pct) => progressBar.style("width", `${pct * 100}%`),
                    onPauseStateChange: (isPaused) => playPauseBtn.text(isPaused ? "▶ Play" : "⏸ Pause"),
                    onMetadataLoaded: resizeContent
                }
            );

            stopCurrentVideo = controller.stop;

            playPauseBtn.on("click", () => controller.togglePause());
        }
    };
}

function setupVideoLogic(video, canvas, ctx, trajectory, options, callbacks) {
    const userId = trajectory.user_id || trajectory.raw?.user_id;

    // Usa parseTrajectoryData importado de dataUtils.js
    const rawTraj = trajectory.traj_ || trajectory.trajectory_xy || trajectory.raw?.traj_ || trajectory.raw?.trajectory_xy;
    const points = parseTrajectoryData(rawTraj);

    if (!userId || !points.length) return { stop: () => { }, togglePause: () => { } };

    // Define cor baseada no Cluster usando constante global
    const clusterId = parseInt(trajectory.cluster_ ?? trajectory.cluster ?? 0);
    const safeClusterIndex = Math.abs(clusterId % CLUSTER_COLORS.length);
    const clusterColor = options.highlightColor || CLUSTER_COLORS[safeClusterIndex];

    // Calcula transparência usando d3.color (já disponível globalmente ou via import d3)
    const c = d3.color(clusterColor);
    c.opacity = 0.7;
    const trailColor = c.formatRgb();

    // Frames
    const startFrame = parseInt(trajectory.frame_inicial ?? trajectory.raw?.frame_inicial ?? 0);
    const endFrame = parseInt(trajectory.frame_final ?? trajectory.raw?.frame_final ?? (startFrame + points.length));
    const segmentLen = Math.max(1, endFrame - startFrame);

    // Normalização (Verifica se dados estão entre -1.5 e 1.5 aproximadamente)
    const isNormalized = points.every(p => Math.abs(p[0]) <= 2.0 && Math.abs(p[1]) <= 2.0);

    // Carrega Vídeo
    const videoPath = `outputs/videos/${userId}.mp4`;
    if (!video.src.includes(videoPath)) {
        video.src = videoPath;
        video.load();
    }

    let requestCallbackId = null;

    const onFrame = (now, metadata) => {
        if (!video.duration) {
            requestCallbackId = video.requestVideoFrameCallback(onFrame);
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const progressGlobal = metadata.mediaTime / video.duration;
        const currentGlobalFrame = Math.round(progressGlobal * (TOTAL_VIDEO_FRAMES - 1));

        // Loop no segmento
        if (currentGlobalFrame > endFrame) {
            const startTime = (startFrame / TOTAL_VIDEO_FRAMES) * video.duration;
            video.currentTime = startTime + 0.01;
            requestCallbackId = video.requestVideoFrameCallback(onFrame);
            return;
        }

        // Desenhar
        if (currentGlobalFrame >= startFrame && currentGlobalFrame <= endFrame) {
            const segmentProgress = (currentGlobalFrame - startFrame) / segmentLen;
            const pointIndex = Math.round(segmentProgress * (points.length - 1));

            if (callbacks.onProgress) callbacks.onProgress(segmentProgress);

            if (pointIndex >= 0 && pointIndex < points.length) {
                const w = canvas.width;
                const h = canvas.height;

                // Desenha Rastro
                if (pointIndex > 0) {
                    ctx.beginPath();
                    const p0 = points[0];
                    ctx.moveTo(
                        isNormalized ? p0[0] * w : p0[0],
                        isNormalized ? p0[1] * h : p0[1]
                    );
                    for (let i = 1; i <= pointIndex; i++) {
                        const p = points[i];
                        ctx.lineTo(
                            isNormalized ? p[0] * w : p[0],
                            isNormalized ? p[1] * h : p[1]
                        );
                    }
                    ctx.strokeStyle = trailColor;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                // Desenha Objeto (Retângulo)
                const p = points[pointIndex];
                const x = isNormalized ? p[0] * w : p[0];
                const y = isNormalized ? p[1] * h : p[1];

                ctx.strokeStyle = clusterColor;
                ctx.lineWidth = 2;
                ctx.strokeRect(x - 15, y - 15, 30, 30);
            }
        } else if (currentGlobalFrame < startFrame) {
            // Força busca inicial se o vídeo estiver muito longe
            const startTime = (startFrame / TOTAL_VIDEO_FRAMES) * video.duration;
            if (Math.abs(video.currentTime - startTime) > 0.5) {
                video.currentTime = startTime;
            }
        }

        if (!video.paused && !video.ended) {
            requestCallbackId = video.requestVideoFrameCallback(onFrame);
        }
    };

    const startPlayback = () => {
        if (callbacks.onMetadataLoaded) callbacks.onMetadataLoaded();

        if (video.duration) {
            const startTime = (startFrame / TOTAL_VIDEO_FRAMES) * video.duration;
            video.currentTime = startTime;
        }

        video.play()
            .then(() => {
                callbacks.onPauseStateChange(false);
                if (!requestCallbackId) requestCallbackId = video.requestVideoFrameCallback(onFrame);
            })
            .catch(e => console.warn("Autoplay blocked:", e));
    };

    if (video.readyState >= 1) {
        startPlayback();
    } else {
        video.onloadedmetadata = () => startPlayback();
    }

    // Listeners de estado do vídeo
    video.onpause = () => {
        callbacks.onPauseStateChange(true);
        if (requestCallbackId) {
            video.cancelVideoFrameCallback(requestCallbackId);
            requestCallbackId = null;
        }
    };

    video.onplay = () => {
        callbacks.onPauseStateChange(false);
        requestCallbackId = video.requestVideoFrameCallback(onFrame);
    };

    return {
        stop: () => {
            video.pause();
            if (requestCallbackId) video.cancelVideoFrameCallback(requestCallbackId);
            video.src = "";
            video.onloadedmetadata = null;
            video.onpause = null;
            video.onplay = null;
        },
        togglePause: () => {
            if (video.paused) video.play(); else video.pause();
        }
    };
}