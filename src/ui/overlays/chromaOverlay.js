import { uiCtx, uiOverlay, syncSize, clear, drawHandle } from '../overlayUtils.js';

export function drawChroma(p) {
    syncSize();
    clear();
    if (p.chromaMode !== 'outline') return;
    const cx = (0.5 + p.chromaOutlineX / 100) * uiOverlay.width;
    const cy = (0.5 - p.chromaOutlineY / 100) * uiOverlay.height;
    drawHandle(cx, cy);
}
