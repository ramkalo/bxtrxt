import { canvas } from '../../renderer/glstate.js';
import { getStack, setInstanceParam } from '../../state/effectStack.js';
import { state } from '../overlayState.js';
import { uiCtx, uiOverlay, syncSize, drawHandle, drawRotHandle, HIT_RADIUS, isInsideFadeShape } from '../overlayUtils.js';
import { drawFadeShape, getFadeHandlePositions } from './fadeOverlay.js';

// Color Gel gradient overlay. Each color zone boundary is a transition line,
// modelled on the Line Drag line: a 2D anchor point you drag (the line follows
// the cursor exactly) plus a rotation handle perpendicular to the line. Lines
// are computed in uv space so the dashed overlay always coincides with the
// actual color transition. The fade shape is drawn/edited inline too.

const ROT_OFF   = 0.18; // rotation handle distance from anchor 0 (uv)
const LINE_HIT  = 0.03; // line grab threshold (uv perpendicular distance)
const ORDER_EPS = 0.01; // keep adjacent transitions from crossing (uv)

const isGradient = (p) => (p.colorGelMode ?? 'solid') === 'gradient';
const zoneCount  = (p) => Math.max(2, Math.min(4, parseInt(p.colorGelGradStops ?? '2') || 2));
const dirOf      = (p) => { const a = (p.colorGelGradAngle ?? 45) * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; };

// Transition anchors in uv (y up). Count = zones - 1.
function anchors(p) {
    const out = [];
    for (let i = 0; i < zoneCount(p) - 1; i++) {
        const x =     (p[`colorGelT${i + 1}X`] ?? 50) / 100;
        const y = 1 - (p[`colorGelT${i + 1}Y`] ?? 50) / 100;
        out.push([x, y]);
    }
    return out;
}

const fadeCenterPx = (p, W, H) =>
    [(0.5 + (p.colorGelFadeX ?? -25) / 100) * W, (0.5 - (p.colorGelFadeY ?? -25) / 100) * H];

export function drawColorGel(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);

    if (isGradient(p)) {
        const [nx, ny] = dirOf(p);
        const lx = -ny, ly = nx; // line direction (perpendicular to gradient normal)
        const toPx = (ux, uy) => [ux * w, (1 - uy) * h];
        const as = anchors(p);

        for (const [ax, ay] of as) {
            const [x1, y1] = toPx(ax + lx * 2, ay + ly * 2);
            const [x2, y2] = toPx(ax - lx * 2, ay - ly * 2);
            uiCtx.beginPath();
            uiCtx.moveTo(x1, y1);
            uiCtx.lineTo(x2, y2);
            uiCtx.strokeStyle = 'rgba(255,255,255,0.7)';
            uiCtx.lineWidth   = 1.5;
            uiCtx.setLineDash([6, 5]);
            uiCtx.stroke();
            uiCtx.setLineDash([]);
            const [gx, gy] = toPx(ax, ay);
            drawHandle(gx, gy);
        }

        // Rotation handle: perpendicular to the first line (along the gradient
        // normal) from its anchor, like the Line Drag rotation handle.
        if (as.length) {
            const [ax, ay] = as[0];
            const [px, py] = toPx(ax, ay);
            const [rx, ry] = toPx(ax + nx * ROT_OFF, ay + ny * ROT_OFF);
            uiCtx.beginPath();
            uiCtx.moveTo(px, py);
            uiCtx.lineTo(rx, ry);
            uiCtx.strokeStyle = 'rgba(255,255,255,0.4)';
            uiCtx.lineWidth   = 1;
            uiCtx.stroke();
            drawRotHandle(rx, ry);
        }
    }

    const [fcx, fcy] = fadeCenterPx(p, w, h);
    drawFadeShape(p, fcx, fcy, w, h);
}

export function hitTestColorGel(e) {
    const inst = getStack().find(i => i.id === state.instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;

    if (isGradient(p)) {
        const [nx, ny] = dirOf(p);
        const as = anchors(p);

        if (as.length) {
            const [ax, ay] = as[0];
            const rx = (ax + nx * ROT_OFF) * W, ry = (1 - (ay + ny * ROT_OFF)) * H;
            if (Math.hypot(mx - rx, my - ry) <= HIT_RADIUS) return 'gradRot';
        }

        // nearest transition line by perpendicular uv distance
        const cx = mx / W, cy = 1 - my / H;
        let best = -1, bestD = LINE_HIT;
        for (let i = 0; i < as.length; i++) {
            const d = Math.abs((cx - as[i][0]) * nx + (cy - as[i][1]) * ny);
            if (d < bestD) { bestD = d; best = i; }
        }
        if (best >= 0) return 'line' + best;
    }

    if (p.colorGelFadeEnabled) {
        const [fcx, fcy] = fadeCenterPx(p, W, H);
        const { edgeW, edgeH, rotHandle } = getFadeHandlePositions(p, fcx, fcy, W, H);
        if (Math.hypot(mx - rotHandle[0], my - rotHandle[1]) <= HIT_RADIUS) return 'fadeRot';
        if (Math.hypot(mx - edgeW[0],     my - edgeW[1])     <= HIT_RADIUS) return 'fadeEdgeW';
        if (Math.hypot(mx - edgeH[0],     my - edgeH[1])     <= HIT_RADIUS) return 'fadeEdgeH';
        const shape = p.colorGelFadeShape ?? 'ellipse';
        const angle = (p.colorGelFadeAngle ?? 0) * Math.PI / 180;
        const a = (p.colorGelFadeW / 100) * W / 2;
        const b = (p.colorGelFadeH / 100) * H / 2;
        if (isInsideFadeShape(mx, my, fcx, fcy, a, b, angle, shape !== 'ellipse')) return 'fadeCenter';
    }
    return null;
}

export function onDragColorGel(e, inst, rect) {
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W  = uiOverlay.width, H = uiOverlay.height;
    const p  = inst.params;
    const handle = state.handle;
    const [nx, ny] = dirOf(p);

    if (handle && handle.startsWith('line')) {
        const i  = parseInt(handle.slice(4));
        const as = anchors(p);
        const cx = mx / W, cy = 1 - my / H;            // cursor uv
        const projC = cx * nx + cy * ny;
        const lo = (i > 0)              ? as[i - 1][0] * nx + as[i - 1][1] * ny : -1e9;
        const hi = (i < as.length - 1)  ? as[i + 1][0] * nx + as[i + 1][1] * ny :  1e9;
        const clamped = Math.max(lo + ORDER_EPS, Math.min(hi - ORDER_EPS, projC));
        const ax = cx + nx * (clamped - projC);
        const ay = cy + ny * (clamped - projC);
        setInstanceParam(state.instId, `colorGelT${i + 1}X`, Math.round(Math.max(0, Math.min(100, ax * 100)) * 10) / 10);
        setInstanceParam(state.instId, `colorGelT${i + 1}Y`, Math.round(Math.max(0, Math.min(100, (1 - ay) * 100)) * 10) / 10);
        return;
    }

    if (handle === 'gradRot') {
        const as = anchors(p);
        const [ax, ay] = as[0] ?? [0.5, 0.5];
        let deg = Math.atan2((1 - my / H) - ay, mx / W - ax) * 180 / Math.PI;
        if (deg > 180)  deg -= 360;
        if (deg < -180) deg += 360;
        setInstanceParam(state.instId, 'colorGelGradAngle', Math.round(deg));
        return;
    }

    const [fcx, fcy] = fadeCenterPx(p, W, H);
    if (handle === 'fadeCenter') {
        setInstanceParam(state.instId, 'colorGelFadeX', Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100))));
        setInstanceParam(state.instId, 'colorGelFadeY', Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100))));
    } else if (handle === 'fadeEdgeW') {
        setInstanceParam(state.instId, 'colorGelFadeW', Math.round(Math.max(1, Math.min(200, Math.abs(mx - fcx) / (W / 2) * 100))));
    } else if (handle === 'fadeEdgeH') {
        setInstanceParam(state.instId, 'colorGelFadeH', Math.round(Math.max(1, Math.min(200, Math.abs(my - fcy) / (H / 2) * 100))));
    } else if (handle === 'fadeRot') {
        let deg = Math.atan2(my - fcy, mx - fcx) * 180 / Math.PI + 90;
        if (deg > 180)  deg -= 360;
        if (deg < -180) deg += 360;
        setInstanceParam(state.instId, 'colorGelFadeAngle', Math.round(deg));
    }
}
