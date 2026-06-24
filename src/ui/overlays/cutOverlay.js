import { canvas } from '../../renderer/glstate.js';
import { getStack, setInstanceParam } from '../../state/effectStack.js';
import { state } from '../overlayState.js';
import { uiCtx, uiOverlay, syncSize, drawRotHandle, drawCornerHandle, strokeAntLine, HIT_RADIUS } from '../overlayUtils.js';

// The Cut Out overlay has two modes, switched by whether a shape has been cut yet:
//   • SELECT mode (no cutImage): position the selection shape — same as Viewport.
//   • PASTE  mode (cutImage set): move/scale/rotate each pasted copy.
const _hasCut = (p) => !!p.cutImage;

// ── public entry points (canvasPicker dispatches to these) ──────────────────────
export function drawCut(p) {
    syncSize();
    uiCtx.clearRect(0, 0, uiOverlay.width, uiOverlay.height);
    _hasCut(p) ? _drawPaste(p) : _drawSelect(p);
}

export function hitTestCut(e) {
    const inst = getStack().find(i => i.id === state.instId);
    if (!inst) return null;
    return _hasCut(inst.params) ? _hitPaste(e, inst.params) : _hitSelect(e, inst.params);
}

export function onDragCut(e, inst, rect) {
    _hasCut(inst.params) ? _dragPaste(e, inst, rect) : _dragSelect(e, inst, rect);
}

// ════════════════════════════════════════════════════════════════════════════════
// SELECT mode — shape placement (mirrors viewportOverlay.js)
// ════════════════════════════════════════════════════════════════════════════════
function cutCenter(p) {
    const W = uiOverlay.width, H = uiOverlay.height;
    return { cx: (0.5 + p.cutX / 100) * W, cy: (0.5 - p.cutY / 100) * H, W, H };
}

function cutVertexScreenPositions(p) {
    const { W, H } = cutCenter(p);
    const n = p.cutShape === 'triangle' ? 3 : Math.max(3, Math.min(12, Math.round(p.cutSides)));
    const verts = [];
    for (let i = 0; i < n; i++) {
        verts.push([
            (0.5 + (p.cutX + (p[`cutV${i}x`] ?? 0)) / 100) * W,
            (0.5 - (p.cutY + (p[`cutV${i}y`] ?? 0)) / 100) * H,
        ]);
    }
    return verts;
}

export function resetCutVertices(instId, shape, sides) {
    state.cutResetting = true;
    let n, startAngle;
    if (shape === 'triangle') { n = 3; startAngle = Math.PI / 2; }
    else { n = Math.max(3, Math.min(12, sides)); startAngle = 0; }
    const R = 25;
    for (let i = 0; i < 12; i++) {
        const angle = startAngle + i * (2 * Math.PI / n);
        const x = i < n ? Math.round(R * Math.cos(angle) * 100) / 100 : 0;
        const y = i < n ? Math.round(R * Math.sin(angle) * 100) / 100 : 0;
        setInstanceParam(instId, `cutV${i}x`, x);
        setInstanceParam(instId, `cutV${i}y`, y);
    }
    state.cutResetting = false;
    const inst = getStack().find(i => i.id === instId);
    if (inst) drawCut(inst.params);
}

function _drawSelect(p) {
    const W = uiOverlay.width, H = uiOverlay.height;
    const { cx, cy } = cutCenter(p);

    if (p.cutShape === 'rectangle') {
        const hw = (p.cutW / 200) * W, hh = (p.cutH / 200) * H;
        const left = cx - hw, top = cy - hh, right = cx + hw, bottom = cy + hh;
        uiCtx.fillStyle = 'rgba(0,0,0,0.45)';
        uiCtx.fillRect(0, 0, W, top);
        uiCtx.fillRect(0, bottom, W, H - bottom);
        uiCtx.fillRect(0, top, left, hh * 2);
        uiCtx.fillRect(right, top, W - right, hh * 2);
        uiCtx.strokeStyle = 'rgba(255,255,255,0.85)'; uiCtx.lineWidth = 1.5; uiCtx.setLineDash([]);
        uiCtx.strokeRect(left, top, hw * 2, hh * 2);
        drawCornerHandle(left, top); drawCornerHandle(right, top);
        drawCornerHandle(right, bottom); drawCornerHandle(left, bottom);
    } else if (p.cutShape === 'ellipse') {
        const rx = (p.cutW / 200) * W, ry = (p.cutH / 200) * H;
        uiCtx.save();
        uiCtx.fillStyle = 'rgba(0,0,0,0.45)'; uiCtx.fillRect(0, 0, W, H);
        uiCtx.globalCompositeOperation = 'destination-out';
        uiCtx.beginPath(); uiCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); uiCtx.fill();
        uiCtx.restore();
        uiCtx.strokeStyle = 'rgba(255,255,255,0.85)'; uiCtx.lineWidth = 1.5; uiCtx.setLineDash([]);
        uiCtx.beginPath(); uiCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); uiCtx.stroke();
        drawCornerHandle(cx + rx, cy); drawCornerHandle(cx, cy + ry);
    } else {
        const verts = cutVertexScreenPositions(p);
        const tracePoly = () => {
            uiCtx.beginPath();
            if (verts.length) {
                uiCtx.moveTo(verts[0][0], verts[0][1]);
                for (let i = 1; i < verts.length; i++) uiCtx.lineTo(verts[i][0], verts[i][1]);
                uiCtx.closePath();
            }
        };
        uiCtx.save();
        uiCtx.fillStyle = 'rgba(0,0,0,0.45)'; uiCtx.fillRect(0, 0, W, H);
        uiCtx.globalCompositeOperation = 'destination-out';
        tracePoly(); uiCtx.fill();
        uiCtx.restore();
        uiCtx.strokeStyle = 'rgba(255,255,255,0.85)'; uiCtx.lineWidth = 1.5; uiCtx.setLineDash([]);
        tracePoly(); uiCtx.stroke();
        for (const [vx, vy] of verts) drawCornerHandle(vx, vy);
    }
}

function _pointInPoly(mx, my, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const [xi, yi] = verts[i], [xj, yj] = verts[j];
        if (((yi > my) !== (yj > my)) && (mx < (xj - xi) * (my - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

function _hitSelect(e, p) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const { cx, cy, W, H } = cutCenter(p);
    // Resize handles take priority; otherwise clicking inside the shape body moves it.
    if (p.cutShape === 'rectangle') {
        const hw = (p.cutW / 200) * W, hh = (p.cutH / 200) * H;
        const corners = { tl: [cx - hw, cy - hh], tr: [cx + hw, cy - hh], br: [cx + hw, cy + hh], bl: [cx - hw, cy + hh] };
        for (const [name, [hx, hy]] of Object.entries(corners)) {
            if (Math.hypot(mx - hx, my - hy) <= HIT_RADIUS) return name;
        }
        if (Math.abs(mx - cx) <= hw && Math.abs(my - cy) <= hh) return 'center';
    } else if (p.cutShape === 'ellipse') {
        const rx = (p.cutW / 200) * W, ry = (p.cutH / 200) * H;
        if (Math.hypot(mx - (cx + rx), my - cy) <= HIT_RADIUS) return 'edgeR';
        if (Math.hypot(mx - cx, my - (cy + ry)) <= HIT_RADIUS) return 'edgeB';
        if (rx > 0 && ry > 0 && ((mx - cx) / rx) ** 2 + ((my - cy) / ry) ** 2 <= 1) return 'center';
    } else {
        const verts = cutVertexScreenPositions(p);
        for (let i = 0; i < verts.length; i++) {
            if (Math.hypot(mx - verts[i][0], my - verts[i][1]) <= HIT_RADIUS) return `v${i}`;
        }
        if (_pointInPoly(mx, my, verts)) return 'center';
    }
    return null;
}

function _dragSelect(e, inst, rect) {
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;
    if (state.handle === 'center') {
        const a = state.dragAnchor || { grabDX: 0, grabDY: 0 };
        const tx = mx + a.grabDX, ty = my + a.grabDY;
        setInstanceParam(state.instId, 'cutX', Math.round(Math.max(-50, Math.min(50,  (tx / W - 0.5) * 100))));
        setInstanceParam(state.instId, 'cutY', Math.round(Math.max(-50, Math.min(50, -(ty / H - 0.5) * 100))));
    } else if (state.handle === 'tl' || state.handle === 'tr' || state.handle === 'br' || state.handle === 'bl') {
        const cx = (0.5 + p.cutX / 100) * W, cy = (0.5 - p.cutY / 100) * H;
        setInstanceParam(state.instId, 'cutW', Math.round(Math.max(1, Math.min(100, Math.abs(mx - cx) * 2 / W * 100))));
        setInstanceParam(state.instId, 'cutH', Math.round(Math.max(1, Math.min(100, Math.abs(my - cy) * 2 / H * 100))));
    } else if (state.handle === 'edgeR') {
        const cx = (0.5 + p.cutX / 100) * W;
        setInstanceParam(state.instId, 'cutW', Math.round(Math.max(1, Math.min(100, Math.abs(mx - cx) * 2 / W * 100))));
    } else if (state.handle === 'edgeB') {
        const cy = (0.5 - p.cutY / 100) * H;
        setInstanceParam(state.instId, 'cutH', Math.round(Math.max(1, Math.min(100, Math.abs(my - cy) * 2 / H * 100))));
    } else if (state.handle && state.handle.startsWith('v')) {
        const idx = parseInt(state.handle.slice(1), 10);
        const ox = Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100)) - p.cutX);
        const oy = Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100)) - p.cutY);
        setInstanceParam(state.instId, `cutV${idx}x`, Math.max(-50, Math.min(50, ox)));
        setInstanceParam(state.instId, `cutV${idx}y`, Math.max(-50, Math.min(50, oy)));
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// PASTE mode — manipulate each pasted copy
// ════════════════════════════════════════════════════════════════════════════════
function readPastes(p) {
    try { return JSON.parse(p.cutPastes || '[]'); } catch { return []; }
}

// Screen-space geometry of one paste's box + handles.
function pasteGeom(p, t) {
    const W = uiOverlay.width, H = uiOverlay.height;
    const sc = W / Math.max(1, canvas.width);
    const hw = ((p.cutNatW || 0) * (t.scale ?? 100) / 100 / 2) * sc;
    const hh = ((p.cutNatH || 0) * (t.scale ?? 100) / 100 / 2) * sc;
    const cx = (0.5 + (t.x ?? 0) / 100) * W;
    const cy = (0.5 - (t.y ?? 0) / 100) * H;
    const ang = (t.rot ?? 0) * Math.PI / 180;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const rot = (lx, ly) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
    return {
        cx, cy, hw, hh, sc, cos, sin,
        tl: rot(-hw, -hh), tr: rot(hw, -hh), br: rot(hw, hh), bl: rot(-hw, hh),
        rh: rot(0, -(hh + 22)), top: rot(0, -hh),
    };
}

// Outline of where the shape was cut from — kept visible after cutting. Drawn as a
// black/white dashed line so it reads on any background, dimmer than live handles.
function _drawGhost(p) {
    const { cx, cy, W, H } = cutCenter(p);
    const trace = () => {
        uiCtx.beginPath();
        if (p.cutShape === 'rectangle') {
            const hw = (p.cutW / 200) * W, hh = (p.cutH / 200) * H;
            uiCtx.rect(cx - hw, cy - hh, hw * 2, hh * 2);
        } else if (p.cutShape === 'ellipse') {
            uiCtx.ellipse(cx, cy, (p.cutW / 200) * W, (p.cutH / 200) * H, 0, 0, Math.PI * 2);
        } else {
            const verts = cutVertexScreenPositions(p);
            if (verts.length) {
                uiCtx.moveTo(verts[0][0], verts[0][1]);
                for (let i = 1; i < verts.length; i++) uiCtx.lineTo(verts[i][0], verts[i][1]);
                uiCtx.closePath();
            }
        }
    };
    uiCtx.save();
    uiCtx.lineWidth = 1.5;
    uiCtx.setLineDash([5, 4]);
    trace();
    uiCtx.strokeStyle = 'rgba(0,0,0,0.55)';   uiCtx.lineDashOffset = 4; uiCtx.stroke();
    trace();
    uiCtx.strokeStyle = 'rgba(255,255,255,0.7)'; uiCtx.lineDashOffset = 0; uiCtx.stroke();
    uiCtx.restore();
}

function _drawPaste(p) {
    _drawGhost(p);
    const pastes = readPastes(p);
    const active = state.cutActive;
    pastes.forEach((t, i) => {
        const g = pasteGeom(p, t);
        uiCtx.beginPath();
        uiCtx.moveTo(g.tl[0], g.tl[1]); uiCtx.lineTo(g.tr[0], g.tr[1]);
        uiCtx.lineTo(g.br[0], g.br[1]); uiCtx.lineTo(g.bl[0], g.bl[1]); uiCtx.closePath();
        if (i === active) {
            strokeAntLine();
            uiCtx.beginPath(); uiCtx.moveTo(g.top[0], g.top[1]); uiCtx.lineTo(g.rh[0], g.rh[1]);
            uiCtx.strokeStyle = 'rgba(255,255,255,0.4)'; uiCtx.lineWidth = 1; uiCtx.stroke();
            drawRotHandle(g.rh[0], g.rh[1]);
            drawCornerHandle(g.tl[0], g.tl[1]); drawCornerHandle(g.tr[0], g.tr[1]);
            drawCornerHandle(g.br[0], g.br[1]); drawCornerHandle(g.bl[0], g.bl[1]);
        } else {
            uiCtx.strokeStyle = 'rgba(255,255,255,0.45)'; uiCtx.lineWidth = 1; uiCtx.setLineDash([4, 4]);
            uiCtx.stroke(); uiCtx.setLineDash([]);
        }
    });
}

function _hitPaste(e, p) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const pastes = readPastes(p);
    const active = state.cutActive;

    // Active copy's handles take priority.
    if (active >= 0 && active < pastes.length) {
        const g = pasteGeom(p, pastes[active]);
        const d = (pt) => Math.hypot(mx - pt[0], my - pt[1]);
        if (d(g.rh) <= HIT_RADIUS) return 'rot';
        if (d(g.tl) <= HIT_RADIUS) return 'tl';
        if (d(g.tr) <= HIT_RADIUS) return 'tr';
        if (d(g.br) <= HIT_RADIUS) return 'br';
        if (d(g.bl) <= HIT_RADIUS) return 'bl';
    }
    // Otherwise, topmost copy whose box contains the point → select it.
    for (let i = pastes.length - 1; i >= 0; i--) {
        const g = pasteGeom(p, pastes[i]);
        const dx = mx - g.cx, dy = my - g.cy;
        const lx = dx * g.cos + dy * g.sin, ly = -dx * g.sin + dy * g.cos;
        if (Math.abs(lx) <= g.hw && Math.abs(ly) <= g.hh) return `body:${i}`;
    }
    return null;
}

function _dragPaste(e, inst, rect) {
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;
    const pastes = readPastes(p);
    const idx = state.cutActive;
    if (idx < 0 || idx >= pastes.length) return;
    const t = pastes[idx];

    if (state.handle === 'center') {
        const a = state.dragAnchor || { grabDX: 0, grabDY: 0 };
        const tx = mx + a.grabDX, ty = my + a.grabDY;
        t.x = Math.round(Math.max(-50, Math.min(50,  (tx / W - 0.5) * 100)));
        t.y = Math.round(Math.max(-50, Math.min(50, -(ty / H - 0.5) * 100)));
    } else if (state.handle === 'rot') {
        const g = pasteGeom(p, t);
        let deg = Math.atan2(my - g.cy, mx - g.cx) * 180 / Math.PI + 90;
        if (deg > 180) deg -= 360; if (deg < -180) deg += 360;
        t.rot = Math.round(deg);
    } else if (state.handle === 'tl' || state.handle === 'tr' || state.handle === 'br' || state.handle === 'bl') {
        const g = pasteGeom(p, t);
        const halfDiag1 = 0.5 * Math.hypot(p.cutNatW || 0, p.cutNatH || 0) * g.sc;
        if (halfDiag1 > 0) {
            const dist = Math.hypot(mx - g.cx, my - g.cy);
            t.scale = Math.round(Math.max(1, Math.min(400, dist / halfDiag1 * 100)));
        }
    }
    setInstanceParam(state.instId, 'cutPastes', JSON.stringify(pastes));
}
