import { canvas } from '../../renderer/glstate.js';
import { getStack, setInstanceParam } from '../../state/effectStack.js';
import { state } from '../overlayState.js';
import { uiCtx, uiOverlay, syncSize, drawHandle, drawCornerHandle, drawRotHandle, HIT_RADIUS, isInsideFadeShape } from '../overlayUtils.js';

// Which point handles are live for the current params.
function showBubble(p) { return !!p.resinBubEnabled; }
function showImage(p)  { return (p.resinTexture === 'image') || ((p.resinMode ?? 'glossy') === 'chrome'); }

function labelAt(cx, cy, text) {
    uiCtx.font = '10px sans-serif';
    uiCtx.fillStyle = 'rgba(255,255,255,0.9)';
    uiCtx.strokeStyle = 'rgba(0,0,0,0.6)';
    uiCtx.lineWidth = 2;
    uiCtx.strokeText(text, cx + 10, cy - 8);
    uiCtx.fillText(text, cx + 10, cy - 8);
}

export function drawResin(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);

    // Fade shape + handles (same geometry as the line-drag overlay).
    if (p[state.enabledKey]) {
        const shape  = p[state.shapeKey] ?? 'ellipse';
        const fAngle = (p[state.angleKey] ?? 0) * Math.PI / 180;
        const cosA   = Math.cos(fAngle), sinA = Math.sin(fAngle);
        const fcx    = (0.5 + p.resinFadeX / 100) * w;
        const fcy    = (0.5 - p.resinFadeY / 100) * h;
        const rotPt  = (lx, ly) => [fcx + lx * cosA - ly * sinA, fcy + lx * sinA + ly * cosA];
        const a = (p[state.wKey] / 100) * w / 2;
        const b = (p[state.hKey] / 100) * h / 2;

        uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
        uiCtx.lineWidth   = 1.5;
        uiCtx.setLineDash([5, 5]);
        if (shape === 'ellipse') {
            uiCtx.beginPath();
            uiCtx.ellipse(fcx, fcy, Math.max(1, a), Math.max(1, b), fAngle, 0, Math.PI * 2);
            uiCtx.stroke();
        } else {
            uiCtx.save();
            uiCtx.translate(fcx, fcy);
            uiCtx.rotate(fAngle);
            uiCtx.beginPath();
            uiCtx.rect(-a, -b, a * 2, b * 2);
            uiCtx.stroke();
            uiCtx.restore();
        }
        uiCtx.setLineDash([]);

        const edgeW     = rotPt(a, 0);
        const edgeH     = rotPt(0, -b);
        const rotHandle = rotPt(0, -(b + 22));
        uiCtx.beginPath();
        uiCtx.moveTo(edgeH[0], edgeH[1]);
        uiCtx.lineTo(rotHandle[0], rotHandle[1]);
        uiCtx.strokeStyle = 'rgba(255,255,255,0.4)';
        uiCtx.lineWidth   = 1;
        uiCtx.stroke();
        drawCornerHandle(edgeW[0], edgeW[1]);
        drawCornerHandle(edgeH[0], edgeH[1]);
        drawRotHandle(rotHandle[0], rotHandle[1]);
    }

    // Point handles: light, bubble center, image position.
    const lx = (p.resinLightX / 100) * w, ly = (p.resinLightY / 100) * h;
    drawHandle(lx, ly); labelAt(lx, ly, 'Light');

    if (showBubble(p)) {
        const bx = (p.resinBubCenterX / 100) * w, by = (p.resinBubCenterY / 100) * h;
        drawHandle(bx, by); labelAt(bx, by, 'Bubbles');
    }
    if (showImage(p)) {
        const ix = (p.resinImgX / 100) * w, iy = (p.resinImgY / 100) * h;
        drawHandle(ix, iy); labelAt(ix, iy, 'Image');
    }
}

export function hitTestResin(e) {
    const inst = getStack().find(i => i.id === state.instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;

    // Point handles take priority (drawn on top).
    if (Math.hypot(mx - (p.resinLightX / 100) * W, my - (p.resinLightY / 100) * H) <= HIT_RADIUS) return 'light';
    if (showBubble(p) && Math.hypot(mx - (p.resinBubCenterX / 100) * W, my - (p.resinBubCenterY / 100) * H) <= HIT_RADIUS) return 'bubble';
    if (showImage(p)  && Math.hypot(mx - (p.resinImgX / 100) * W,       my - (p.resinImgY / 100) * H)       <= HIT_RADIUS) return 'image';

    if (!p[state.enabledKey]) return null;

    const fAngle = (p[state.angleKey] ?? 0) * Math.PI / 180;
    const cosA = Math.cos(fAngle), sinA = Math.sin(fAngle);
    const fcx = (0.5 + p.resinFadeX / 100) * W;
    const fcy = (0.5 - p.resinFadeY / 100) * H;
    const rotPt = (a, b) => [fcx + a * cosA - b * sinA, fcy + a * sinA + b * cosA];
    const shape = p[state.shapeKey] ?? 'ellipse';
    const fa = (p[state.wKey] / 100) * W / 2;
    const fb = (p[state.hKey] / 100) * H / 2;
    const edgeW = rotPt(fa, 0), edgeH = rotPt(0, -fb), rotHandle = rotPt(0, -(fb + 22));
    if (Math.hypot(mx - rotHandle[0], my - rotHandle[1]) <= HIT_RADIUS) return 'rot';
    if (Math.hypot(mx - edgeW[0],     my - edgeW[1])     <= HIT_RADIUS) return 'edgeW';
    if (Math.hypot(mx - edgeH[0],     my - edgeH[1])     <= HIT_RADIUS) return 'edgeH';
    if (isInsideFadeShape(mx, my, fcx, fcy, fa, fb, fAngle, shape !== 'ellipse')) return 'fadeCenter';
    return null;
}

export function onDragResin(e, inst, rect) {
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;
    const clamp100 = (v) => Math.round(Math.max(0, Math.min(100, v)));

    if (state.handle === 'light') {
        setInstanceParam(state.instId, 'resinLightX', clamp100((mx / W) * 100));
        setInstanceParam(state.instId, 'resinLightY', clamp100((my / H) * 100));
    } else if (state.handle === 'bubble') {
        setInstanceParam(state.instId, 'resinBubCenterX', clamp100((mx / W) * 100));
        setInstanceParam(state.instId, 'resinBubCenterY', clamp100((my / H) * 100));
    } else if (state.handle === 'image') {
        setInstanceParam(state.instId, 'resinImgX', clamp100((mx / W) * 100));
        setInstanceParam(state.instId, 'resinImgY', clamp100((my / H) * 100));
    } else if (state.handle === 'fadeCenter') {
        setInstanceParam(state.instId, 'resinFadeX', Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100))));
        setInstanceParam(state.instId, 'resinFadeY', Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100))));
    } else if (state.handle === 'edgeW') {
        const fcx = (0.5 + p.resinFadeX / 100) * W;
        setInstanceParam(state.instId, state.wKey, Math.round(Math.max(1, Math.min(200, Math.abs(mx - fcx) / (W / 2) * 100))));
    } else if (state.handle === 'edgeH') {
        const fcy = (0.5 - p.resinFadeY / 100) * H;
        setInstanceParam(state.instId, state.hKey, Math.round(Math.max(1, Math.min(200, Math.abs(my - fcy) / (H / 2) * 100))));
    } else if (state.handle === 'rot') {
        const fcx = (0.5 + p.resinFadeX / 100) * W;
        const fcy = (0.5 - p.resinFadeY / 100) * H;
        let deg = Math.atan2(my - fcy, mx - fcx) * 180 / Math.PI + 90;
        if (deg > 180)  deg -= 360;
        if (deg < -180) deg += 360;
        setInstanceParam(state.instId, state.angleKey, Math.round(deg));
    }
}
