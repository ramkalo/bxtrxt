import { canvas } from '../../renderer/glstate.js';
import { setInstanceParam, getStack } from '../../state/effectStack.js';
import { state } from '../overlayState.js';
import { uiCtx, uiOverlay, syncSize, HIT_RADIUS, drawHandle, drawCornerHandle, drawRotHandle, strokeAntLine, isInsideFadeShape } from '../overlayUtils.js';

function _pts(p, W, H) {
    return {
        x1: (p.tunnelX1 ?? 25) / 100 * W,
        y1: (p.tunnelY1 ?? 50) / 100 * H,
        x2: (p.tunnelX2 ?? 75) / 100 * W,
        y2: (p.tunnelY2 ?? 50) / 100 * H,
        cx: (p.tunnelCx ?? 50) / 100 * W,
        cy: (p.tunnelCy ?? 40) / 100 * H,
    };
}

function _fadePx(p, W, H) {
    return {
        fcx: (0.5 + (p.tunnelFadeX ?? 0) / 100) * W,
        fcy: (0.5 - (p.tunnelFadeY ?? 0) / 100) * H,
    };
}

export function drawTunnelOverlay(p) {
    syncSize();
    const W = uiOverlay.width, H = uiOverlay.height;
    uiCtx.clearRect(0, 0, W, H);

    const { x1, y1, x2, y2, cx, cy } = _pts(p, W, H);

    // Bezier curve
    uiCtx.beginPath();
    uiCtx.moveTo(x1, y1);
    uiCtx.quadraticCurveTo(cx, cy, x2, y2);
    strokeAntLine();

    // Dashed guide line from curve midpoint (t=0.5) to control handle
    const bmx = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
    const bmy = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
    uiCtx.save();
    uiCtx.beginPath();
    uiCtx.moveTo(bmx, bmy);
    uiCtx.lineTo(cx, cy);
    uiCtx.setLineDash([4, 4]);
    uiCtx.strokeStyle = 'rgba(255,255,255,0.4)';
    uiCtx.lineWidth = 1;
    uiCtx.stroke();
    uiCtx.setLineDash([]);
    uiCtx.restore();

    drawHandle(x1, y1);       // start — circle
    drawHandle(x2, y2);       // end — circle
    drawCornerHandle(cx, cy); // control point — square

    // Fade ghost shape + handles when fade is enabled
    if (state.enabledKey && p[state.enabledKey]) {
        const shape  = p[state.shapeKey] ?? 'ellipse';
        const fAngle = (p[state.angleKey] ?? 0) * Math.PI / 180;
        const cosA   = Math.cos(fAngle), sinA = Math.sin(fAngle);
        const { fcx, fcy } = _fadePx(p, W, H);
        const rotPt  = (lx, ly) => [fcx + lx * cosA - ly * sinA, fcy + lx * sinA + ly * cosA];

        uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
        uiCtx.lineWidth   = 1.5;
        uiCtx.setLineDash([5, 5]);

        let edgeW, edgeH, rotHandle, topEdge;
        if (shape === 'ellipse') {
            const a = (p[state.wKey] / 100) * W / 2;
            const b = (p[state.hKey] / 100) * H / 2;
            uiCtx.beginPath();
            uiCtx.ellipse(fcx, fcy, Math.max(1, a), Math.max(1, b), fAngle, 0, Math.PI * 2);
            uiCtx.stroke();
            edgeW     = rotPt(a, 0);
            edgeH     = rotPt(0, -b);
            topEdge   = edgeH;
            rotHandle = rotPt(0, -(b + 22));
        } else {
            const hw = (p[state.wKey] / 100) * W / 2;
            const hh = (p[state.hKey] / 100) * H / 2;
            uiCtx.save();
            uiCtx.translate(fcx, fcy);
            uiCtx.rotate(fAngle);
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
    }
}

export function hitTestTunnel(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;

    const inst = getStack().find(i => i.id === state.instId);
    if (!inst) return null;
    const p = inst.params;

    // Fade handles take priority
    if (state.enabledKey && p[state.enabledKey]) {
        const fAngle  = (p[state.angleKey] ?? 0) * Math.PI / 180;
        const cosA    = Math.cos(fAngle), sinA = Math.sin(fAngle);
        const { fcx, fcy } = _fadePx(p, W, H);
        const rotPt   = (lx, ly) => [fcx + lx * cosA - ly * sinA, fcy + lx * sinA + ly * cosA];
        const shape   = p[state.shapeKey] ?? 'ellipse';
        const fa = (p[state.wKey] / 100) * W / 2;
        const fb = (p[state.hKey] / 100) * H / 2;
        let edgeW, edgeH, rotHandle;
        if (shape === 'ellipse') {
            edgeW     = rotPt(fa, 0);
            edgeH     = rotPt(0, -fb);
            rotHandle = rotPt(0, -(fb + 22));
        } else {
            edgeW     = rotPt(fa, 0);
            edgeH     = rotPt(0, -fb);
            rotHandle = rotPt(0, -(fb + 22));
        }
        if (Math.hypot(mx - rotHandle[0], my - rotHandle[1]) <= HIT_RADIUS) return 'rot';
        if (Math.hypot(mx - edgeW[0],     my - edgeW[1])     <= HIT_RADIUS) return 'edgeW';
        if (Math.hypot(mx - edgeH[0],     my - edgeH[1])     <= HIT_RADIUS) return 'edgeH';
        if (isInsideFadeShape(mx, my, fcx, fcy, fa, fb, fAngle, shape !== 'ellipse')) return 'fadeCenter';
    }

    // Tunnel handles
    const { x1, y1, x2, y2, cx, cy } = _pts(p, W, H);

    if (Math.hypot(mx - cx, my - cy) <= HIT_RADIUS) return 'ctrl';
    if (Math.hypot(mx - x1, my - y1) <= HIT_RADIUS) return 'start';
    if (Math.hypot(mx - x2, my - y2) <= HIT_RADIUS) return 'end';

    const STEPS = 30;
    for (let i = 0; i <= STEPS; i++) {
        const t  = i / STEPS;
        const mt = 1 - t;
        const bx = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
        const by = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
        if (Math.hypot(mx - bx, my - by) <= HIT_RADIUS * 1.5) return 'move';
    }

    return null;
}

export function onDragTunnel(e, inst, rect) {
    const W = uiOverlay.width, H = uiOverlay.height;
    const h = state.handle;

    // Fade handle drags — computed directly from mouse position, no dragAnchor needed
    if (h === 'fadeCenter') {
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        setInstanceParam(inst.id, 'tunnelFadeX', Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100))));
        setInstanceParam(inst.id, 'tunnelFadeY', Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100))));
        return;
    }
    if (h === 'edgeW') {
        const mx  = e.clientX - rect.left;
        const fcx = (0.5 + (inst.params.tunnelFadeX ?? 0) / 100) * W;
        setInstanceParam(inst.id, state.wKey, Math.round(Math.max(1, Math.min(200, Math.abs(mx - fcx) / (W / 2) * 100))));
        return;
    }
    if (h === 'edgeH') {
        const my  = e.clientY - rect.top;
        const fcy = (0.5 - (inst.params.tunnelFadeY ?? 0) / 100) * H;
        setInstanceParam(inst.id, state.hKey, Math.round(Math.max(1, Math.min(200, Math.abs(my - fcy) / (H / 2) * 100))));
        return;
    }
    if (h === 'rot') {
        const mx  = e.clientX - rect.left, my = e.clientY - rect.top;
        const fcx = (0.5 + (inst.params.tunnelFadeX ?? 0) / 100) * W;
        const fcy = (0.5 - (inst.params.tunnelFadeY ?? 0) / 100) * H;
        let deg = Math.atan2(my - fcy, mx - fcx) * 180 / Math.PI + 90;
        if (deg > 180)  deg -= 360;
        if (deg < -180) deg += 360;
        setInstanceParam(inst.id, state.angleKey, Math.round(deg));
        return;
    }

    // Tunnel handle drags — use dragAnchor
    if (!state.dragAnchor) return;
    const dx = ((e.clientX - rect.left) - state.dragAnchor.startX) / W * 100;
    const dy = ((e.clientY - rect.top)  - state.dragAnchor.startY) / H * 100;
    const a  = state.dragAnchor;

    if (h === 'start') {
        setInstanceParam(inst.id, 'tunnelX1', a.x10 + dx);
        setInstanceParam(inst.id, 'tunnelY1', a.y10 + dy);
    } else if (h === 'end') {
        setInstanceParam(inst.id, 'tunnelX2', a.x20 + dx);
        setInstanceParam(inst.id, 'tunnelY2', a.y20 + dy);
    } else if (h === 'ctrl') {
        setInstanceParam(inst.id, 'tunnelCx', a.cx0 + dx);
        setInstanceParam(inst.id, 'tunnelCy', a.cy0 + dy);
    } else if (h === 'move') {
        setInstanceParam(inst.id, 'tunnelX1', a.x10 + dx);
        setInstanceParam(inst.id, 'tunnelY1', a.y10 + dy);
        setInstanceParam(inst.id, 'tunnelX2', a.x20 + dx);
        setInstanceParam(inst.id, 'tunnelY2', a.y20 + dy);
        setInstanceParam(inst.id, 'tunnelCx', a.cx0 + dx);
        setInstanceParam(inst.id, 'tunnelCy', a.cy0 + dy);
    }
}
