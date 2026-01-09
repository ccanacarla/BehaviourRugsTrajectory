import { SPEED_STRINGS, DIRECTION_STRINGS } from './config.js';

export function normalizeToken(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_");
}

export function getSpeed(symbol) {
    if (!symbol) return null;
    const t = normalizeToken(symbol);

    if (t.includes("muito_rapido") || t.includes("muito-rapido") || t.includes("muitorapido")) return "Muito_Rapido";
    if (t.includes("muito_lento") || t.includes("muito-lento") || t.includes("muitolento")) return "Muito_Lento";

    if (t.includes(normalizeToken(SPEED_STRINGS?.LENTO ?? "lento"))) return "Lento";
    if (t.includes(normalizeToken(SPEED_STRINGS?.MEDIO ?? "medio"))) return "Medio";

    if (
      t.includes(normalizeToken(SPEED_STRINGS?.RAPIDO ?? "rapido")) ||
      (SPEED_STRINGS?.RAPIDO_ALT && t.includes(normalizeToken(SPEED_STRINGS.RAPIDO_ALT)))
    ) return "Rapido";
    
    if (t.includes("parado")) return "Parado";

    return null;
}

export function getDirection(symbol) {
    if (!symbol) return null;
    const t = normalizeToken(symbol);
    
    if (t.includes(normalizeToken(DIRECTION_STRINGS.NORTE)) || t.includes("_n")) return DIRECTION_STRINGS.N;
    if (t.includes(normalizeToken(DIRECTION_STRINGS.SUL)) || t.includes("_s")) return DIRECTION_STRINGS.S;
    if (t.includes(normalizeToken(DIRECTION_STRINGS.LESTE)) || t.includes("_e") || t.includes("_l")) return DIRECTION_STRINGS.E;
    if (t.includes(normalizeToken(DIRECTION_STRINGS.OESTE)) || t.includes("_o") || t.includes("_w")) return DIRECTION_STRINGS.W;
    
    return null;
}

export function parseSequence(rawJson) {
    let seq = [];
    try {
        if (rawJson) {
            const jsonStr = String(rawJson).replace(/'/g, '"');
            const rawSeq = JSON.parse(jsonStr);
            if (Array.isArray(rawSeq)) {
                seq = rawSeq.map(s => {
                    if (!s) return { empty: true };
                    const speed = getSpeed(s);
                    const dir = getDirection(s);
                    return { raw: s, speed, dir };
                });
            }
        }
    } catch (e) {}
    return seq;
}

export function getLentoIndices(seq, active = true) {
    const highlightIndices = new Set();
    if (!active) return highlightIndices;
    const k = 3;
    for (let i = 0; i <= seq.length - k; i++) {
        let match = true;
        for (let j = 0; j < k; j++) {
            if (!seq[i + j] || seq[i + j].empty || seq[i + j].speed !== "Muito_Lento") {
                match = false;
                break;
            }
        }
        if (match) {
            for (let j = 0; j < k; j++) highlightIndices.add(i + j);
        }
    }
    return highlightIndices;
}

export function getTurnIndices(seq, active = true) {
    const highlightIndices = new Set();
    if (!active) return highlightIndices;
    for (let i = 0; i < seq.length - 1; i++) {
        const curr = seq[i];
        const next = seq[i + 1];
        if (curr && !curr.empty && next && !next.empty && curr.dir && next.dir) {
            if ((curr.dir == "N" && next.dir == "S") || (curr.dir == "S" && next.dir == "N") || (curr.dir == "E" && next.dir == "W") || (curr.dir == "W" && next.dir == "E")) {
                highlightIndices.add(i);
                highlightIndices.add(i + 1);
            }
        }
    }
    return highlightIndices;
}

export function hasLentoMotif(seq) {
    return getLentoIndices(seq).size > 0;
}

export function hasTurnMotif(seq) {
    return getTurnIndices(seq).size > 0;
}