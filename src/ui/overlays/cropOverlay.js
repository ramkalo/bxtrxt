import { canvas } from '../../renderer/glstate.js';
import { getStack, setInstanceParam } from '../../state/effectStack.js';
import { state } from '../overlayState.js';
import { uiCtx, uiOverlay, syncSize, drawHandle, drawCornerHandle, HIT_RADIUS } from '../overlayUtils.js';

const CROP_ASPECT_MAP = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '3:2': 3 / 2 };

// Replicates crop.js computeCropRegion to work in image-pixel space.
function cropRegion(p, srcW, srcH) {
    const scale = p.cropScale / 100;
    let maxW, maxH;
    if (p.cropAspect === 'original') {
        maxW = srcW; maxH = srcH;
    } else {
        const baseRatio = CROP_ASPECT_MAP[p.cropAspect] || 1;
        const ratio = p.cropFlipAspect ? 1 / baseRatio : baseRatio;
        if (ratio > srcW / srcH) { maxW = srcW; maxH = srcW / ratio; }
        else { maxH = srcH; maxW = srcH * ratio; }
    }
    const cropW = maxW * scale;
    const cropH = maxH * scale;
    const centerX = (0.5 + p.cropX / 100) * srcW;
    const centerY = (0.5 - p.cropY / 100) * srcH;
    const sx = Math.max(0, Math.min(srcW - cropW, centerX - cropW / 2));
    const sy = Math.max(0, Math.min(srcH - cropH, centerY - cropH / 2));
    return { sx, sy, cropW, cropH, maxW, maxH };
}

// Returns the crop rect in overlay display coords, plus max box dims for corner drag.
export function computeCropRect(p) {
    const iW = canvas.width, iH = canvas.height;
    const W = uiOverlay.width, H = uiOverlay.height;
    const scaleX = W / iW, scaleY = H / iH;
    const { sx, sy, cropW, cropH, maxW, maxH } = cropRegion(p, iW, iH);
    const left   = sx * scaleX;
    const top    = sy * scaleY;
    const bw     = cropW * scaleX;
    const bh     = cropH * scaleY;
    return {
        left, top,
        right:  left + bw,
        bottom: top + bh,
        cx: left + bw / 2,
        cy: top  + bh / 2,
        bw, bh,
        maxW: maxW * scaleX,
        maxH: maxH * scaleY,
    };
}

function getCropHandles(p) {
    const { cx, cy, bw, bh, left, top, right, bottom } = computeCropRect(p);
    return {
        center: [cx, cy],
        tl: [left,  top],
        tr: [right, top],
        br: [right, bottom],
        bl: [left,  bottom],
    };
}

export function drawCrop(p) {
    syncSize();
    const W = uiOverlay.width, H = uiOverlay.height;
    uiCtx.clearRect(0, 0, W, H);

    const { cx, cy, bw, bh, left, top, right, bottom } = computeCropRect(p);

    // Dim the area outside the crop rect
    uiCtx.fillStyle = 'rgba(0,0,0,0.45)';
    uiCtx.fillRect(0, 0,      W,        top);
    uiCtx.fillRect(0, bottom, W,        H - bottom);
    uiCtx.fillRect(0, top,    left,     bh);
    uiCtx.fillRect(right, top, W - right, bh);

    uiCtx.strokeStyle = 'rgba(255,255,255,0.85)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.setLineDash([]);
    uiCtx.strokeRect(left, top, bw, bh);

    // Rule-of-thirds grid
    uiCtx.strokeStyle = 'rgba(255,255,255,0.3)';
    uiCtx.lineWidth   = 1;
    uiCtx.beginPath();
    for (let i = 1; i <= 2; i++) {
        const x = left + bw * i / 3;
        const y = top  + bh * i / 3;
        uiCtx.moveTo(x, top);    uiCtx.lineTo(x, bottom);
        uiCtx.moveTo(left, y);   uiCtx.lineTo(right, y);
    }
    uiCtx.stroke();

    drawHandle(cx, cy);
    drawCornerHandle(left,  top);
    drawCornerHandle(right, top);
    drawCornerHandle(right, bottom);
    drawCornerHandle(left,  bottom);
}

export function hitTestCrop(e) {
    const inst = getStack().find(i => i.id === state.instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const handles = getCropHandles(inst.params);
    for (const [name, [hx, hy]] of Object.entries(handles)) {
        if (Math.hypot(mx - hx, my - hy) <= HIT_RADIUS) return name;
    }
    return null;
}

export function onDragCrop(e, inst, rect) {
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W  = uiOverlay.width, H = uiOverlay.height;

    if (state.handle === 'center') {
        setInstanceParam(state.instId, 'cropX', Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100))));
        setInstanceParam(state.instId, 'cropY', Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100))));
    } else if (state.dragAnchor) {
        const { oppX, oppY, signX, signY } = state.dragAnchor;
        const { maxW, maxH } = computeCropRect(inst.params);
        const rawW = Math.max(1, Math.abs(mx - oppX));
        const rawH = Math.max(1, Math.abs(my - oppY));
        const scaleFromW = rawW / maxW;
        const scaleFromH = rawH / maxH;
        const newScaleFrac = Math.max(0.1, Math.min(1.0, (scaleFromW + scaleFromH) / 2));
        const newScale = Math.round(newScaleFrac * 100);
        const newBW = maxW * newScaleFrac;
        const newBH = maxH * newScaleFrac;
        const newCX = oppX + signX * newBW / 2;
        const newCY = oppY + signY * newBH / 2;
        setInstanceParam(state.instId, 'cropScale', newScale);
        setInstanceParam(state.instId, 'cropX', Math.round(Math.max(-50, Math.min(50,  (newCX / W - 0.5) * 100))));
        setInstanceParam(state.instId, 'cropY', Math.round(Math.max(-50, Math.min(50, -(newCY / H - 0.5) * 100))));
    }
}
