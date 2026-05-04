import { uiCtx, uiOverlay, syncSize, drawHandle } from '../overlayUtils.js';

export function drawMatrixRain(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);
    const cx = (0.5 + p.matrixRainX / 100) * w;
    const cy = (0.5 - p.matrixRainY / 100) * h;
    drawHandle(cx, cy);
}
