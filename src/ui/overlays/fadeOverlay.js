import { canvas } from '../../renderer/glstate.js';
import { getStack, setInstanceParam } from '../../state/effectStack.js';
import { state } from '../overlayState.js';
import { uiCtx, uiOverlay, syncSize, drawHandle, drawRotHandle, drawCornerHandle, HIT_RADIUS } from '../overlayUtils.js';

function drawFadeShape(p, cx, cy, w, h) {
    if (!p[state.enabledKey]) return;

    const shape = p[state.shapeKey] ?? 'ellipse';
    const angle = (p[state.angleKey] ?? 0) * Math.PI / 180;
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];

    uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.setLineDash([5, 5]);

    let edgeW, edgeH, rotHandle, topEdge;
    if (shape === 'ellipse') {
        const a = (p[state.wKey] / 100) * w / 2;
        const b = (p[state.hKey] / 100) * h / 2;
        uiCtx.beginPath();
        uiCtx.ellipse(cx, cy, Math.max(1, a), Math.max(1, b), angle, 0, Math.PI * 2);
        uiCtx.stroke();
        edgeW     = rotPt(a, 0);
        edgeH     = rotPt(0, -b);
        topEdge   = edgeH;
        rotHandle = rotPt(0, -(b + 22));
    } else {
        const hw = (p[state.wKey] / 100) * w / 2;
        const hh = (p[state.hKey] / 100) * h / 2;
        uiCtx.save();
        uiCtx.translate(cx, cy);
        uiCtx.rotate(angle);
        uiCtx.beginPath();
        uiCtx.rect(-hw, -hh, hw * 2, hh * 2);
        uiCtx.stroke();
        uiCtx.restore();
        edgeW     = rotPt(hw, 0);
        edgeH     = rotPt(0, -hh);
        topEdge   = edgeH;
        rotHandle = rotPt(0, -(hh + 22));
    }

    uiCtx.setLineDash([]);
    uiCtx.beginPath();
    uiCtx.moveTo(topEdge[0], topEdge[1]);
    uiCtx.lineTo(rotHandle[0], rotHandle[1]);
    uiCtx.strokeStyle = 'rgba(255,255,255,0.4)';
    uiCtx.lineWidth   = 1;
    uiCtx.stroke();

    drawCornerHandle(edgeW[0], edgeW[1]);
    drawCornerHandle(edgeH[0], edgeH[1]);
    drawRotHandle(rotHandle[0], rotHandle[1]);

    return { edgeW, edgeH, rotHandle };
}

function getFadeHandlePositions(p, cx, cy, W, H) {
    const shape = p[state.shapeKey] ?? 'ellipse';
    const angle = (p[state.angleKey] ?? 0) * Math.PI / 180;
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];
    if (shape === 'ellipse') {
        const a = (p[state.wKey] / 100) * W / 2;
        const b = (p[state.hKey] / 100) * H / 2;
        return { edgeW: rotPt(a, 0), edgeH: rotPt(0, -b), rotHandle: rotPt(0, -(b + 22)) };
    }
    const hw = (p[state.wKey] / 100) * W / 2;
    const hh = (p[state.hKey] / 100) * H / 2;
    return { edgeW: rotPt(hw, 0), edgeH: rotPt(0, -hh), rotHandle: rotPt(0, -(hh + 22)) };
}

export function drawFade(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);
    const cx = (0.5 + p[state.xKey] / 100) * w;
    const cy = (0.5 - p[state.yKey] / 100) * h;
    drawFadeShape(p, cx, cy, w, h);
    drawHandle(cx, cy);
}

export function hitTestFade(e) {
    const inst = getStack().find(i => i.id === state.instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;
    const cx = (0.5 + p[state.xKey] / 100) * W;
    const cy = (0.5 - p[state.yKey] / 100) * H;

    if (Math.hypot(mx - cx, my - cy) <= HIT_RADIUS) return 'center';
    if (!p[state.enabledKey]) return null;

    const { edgeW, edgeH, rotHandle } = getFadeHandlePositions(p, cx, cy, W, H);
    if (Math.hypot(mx - rotHandle[0], my - rotHandle[1]) <= HIT_RADIUS) return 'rot';
    if (Math.hypot(mx - edgeW[0],     my - edgeW[1])     <= HIT_RADIUS) return 'edgeW';
    if (Math.hypot(mx - edgeH[0],     my - edgeH[1])     <= HIT_RADIUS) return 'edgeH';
    return null;
}

export function onDragFade(e, inst, rect) {
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W  = uiOverlay.width, H = uiOverlay.height;
    const p  = inst.params;
    const cx = (0.5 + p[state.xKey] / 100) * W;
    const cy = (0.5 - p[state.yKey] / 100) * H;

    if (state.handle === 'center') {
        setInstanceParam(state.instId, state.xKey, Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100))));
        setInstanceParam(state.instId, state.yKey, Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100))));
    } else if (state.handle === 'edgeW') {
        setInstanceParam(state.instId, state.wKey, Math.round(Math.max(1, Math.min(200, Math.abs(mx - cx) / (W / 2) * 100))));
    } else if (state.handle === 'edgeH') {
        setInstanceParam(state.instId, state.hKey, Math.round(Math.max(1, Math.min(200, Math.abs(my - cy) / (H / 2) * 100))));
    } else if (state.handle === 'rot') {
        let deg = Math.atan2(my - cy, mx - cx) * 180 / Math.PI + 90;
        if (deg > 180)  deg -= 360;
        if (deg < -180) deg += 360;
        setInstanceParam(state.instId, state.angleKey, Math.round(deg));
    }
}
