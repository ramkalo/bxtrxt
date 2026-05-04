import { getStack, setInstanceParam } from '../../state/effectStack.js';
import { state } from '../overlayState.js';
import { uiCtx, uiOverlay, syncSize, drawHandle, drawEllipseOrRect, hitTestEllipseHandles } from '../overlayUtils.js';

export function drawCRTCurvature(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);
    const cx    = (0.5 + p.crtCurvatureX / 100) * w;
    const cy    = (0.5 - p.crtCurvatureY / 100) * h;
    const a     = Math.max(1, (p.crtCurvatureMajor / 100) * 0.7071 * w);
    const b     = Math.max(1, (p.crtCurvatureMinor / 100) * 0.7071 * h);
    const angle = p.crtCurvatureAngle * Math.PI / 180;
    drawEllipseOrRect(cx, cy, a, b, angle, false); // CRT is always ellipse
    drawHandle(cx, cy);
}

export function hitTestCRTCurvature(e) {
    const inst = getStack().find(i => i.id === state.instId);
    if (!inst) return null;
    const p  = inst.params;
    const cx = (0.5 + p.crtCurvatureX / 100) * uiOverlay.width;
    const cy = (0.5 - p.crtCurvatureY / 100) * uiOverlay.height;
    const a  = Math.max(1, (p.crtCurvatureMajor / 100) * 0.7071 * uiOverlay.width);
    const b  = Math.max(1, (p.crtCurvatureMinor / 100) * 0.7071 * uiOverlay.height);
    return hitTestEllipseHandles(e, cx, cy, a, b, p.crtCurvatureAngle * Math.PI / 180);
}

export function onDragCRTCurvature(e, inst, rect) {
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W  = uiOverlay.width, H = uiOverlay.height;
    const p  = inst.params;
    const cx = (0.5 + p.crtCurvatureX / 100) * W;
    const cy = (0.5 - p.crtCurvatureY / 100) * H;

    if (state.handle === 'center') {
        setInstanceParam(state.instId, 'crtCurvatureX', Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100))));
        setInstanceParam(state.instId, 'crtCurvatureY', Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100))));
    } else if (state.handle === 'edgeW') {
        const ang  = p.crtCurvatureAngle * Math.PI / 180;
        const proj = (mx - cx) * Math.cos(ang) + (my - cy) * Math.sin(ang);
        setInstanceParam(state.instId, 'crtCurvatureMajor', Math.round(Math.max(1, Math.min(150, Math.abs(proj) / (0.7071 * W) * 100))));
    } else if (state.handle === 'edgeH') {
        const ang  = p.crtCurvatureAngle * Math.PI / 180;
        const proj = -(mx - cx) * Math.sin(ang) + (my - cy) * Math.cos(ang);
        setInstanceParam(state.instId, 'crtCurvatureMinor', Math.round(Math.max(1, Math.min(150, Math.abs(proj) / (0.7071 * H) * 100))));
    } else if (state.handle === 'rot') {
        let deg = Math.atan2(my - cy, mx - cx) * 180 / Math.PI + 90;
        deg = ((deg % 180) + 180) % 180;
        setInstanceParam(state.instId, 'crtCurvatureAngle', Math.round(deg));
    }
}
