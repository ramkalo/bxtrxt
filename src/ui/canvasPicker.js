import { canvas } from '../renderer/glstate.js';
import { setInstanceParam, getStack, onStackChange } from '../state/effectStack.js';
import { saveState } from '../state/undo.js';
import { setCropPreviewActive } from '../state/cropPreview.js';
import { processImageImmediate } from '../renderer/pipeline.js';

const uiOverlay = document.getElementById('uiOverlay');
const uiCtx     = uiOverlay.getContext('2d');

// Active overlay state — only one active at a time
let _mode       = null;   // 'fade' | 'blur' | 'crop' | 'viewport' | 'lineDrag' | 'chroma' | 'vignette' | 'text' | 'doubleExposure' | null
let _instId     = null;
let _dragging   = false;
let _xKey       = null;
let _yKey       = null;
let _shapeKey   = null;   // fade: param key for shape enum
let _wKey       = null;   // fade/text: param key for W
let _hKey       = null;   // fade: param key for H
let _angleKey   = null;   // fade/text: param key for rotation angle (degrees)
let _enabledKey = null;   // fade: param key for enabled boolean
let _skewKey    = null;   // text: param key for skew X angle
let _handle     = null;   // crop/viewport/text: handle name
let _dragAnchor = null;   // crop corner drag: { oppX, oppY, signX, signY }

let _vpResetting    = false;  // re-entrancy guard for _resetPolygonVertices

// Redraw whenever any stack param changes (e.g. a slider)
onStackChange((key) => {
    if (!_instId) return;
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) { _hideActive(); return; }
    if (_mode === 'fade')       drawFade(inst.params);
    if (_mode === 'blur')       drawBlur(inst.params);
    if (_mode === 'crop')       drawCrop(inst.params);
    if (_mode === 'matrixRain') drawMatrixRain(inst.params);
    if (_mode === 'lineDrag')   drawLineDrag(inst.params);
    if (_mode === 'chroma')     drawChroma(inst.params);
    if (_mode === 'vignette')   drawVignette(inst.params);
    if (_mode === 'crtCurvature') drawCRTCurvature(inst.params);
    if (_mode === 'corrupted')       drawCorrupted(inst.params);
    if (_mode === 'text')            drawTextOverlay(inst.params);
    if (_mode === 'doubleExposure')  drawDoubleExposure(inst.params);
    if (_mode === 'shapeSticker') {
        const p = inst.params;
        const shape = p.shapeStickerShape || 'rectangle';
        const sides = Math.max(3, Math.min(24, Math.round(p.shapeStickerSides || 6)));
        if (shape === 'triangle' || shape === 'polygon') {
            const n = shape === 'triangle' ? 3 : sides;
            const allZero = Array.from({ length: n }, (_, i) =>
                (p[`shapeStickerV${i}x`] ?? 0) === 0 && (p[`shapeStickerV${i}y`] ?? 0) === 0
            ).every(Boolean);
            const shouldReset = key === 'shapeStickerShape' || key === 'shapeStickerSides' ||
                key === 'shapeStickerW' || key === 'shapeStickerH';
            if (shouldReset) { _resetShapeStickerVertices(inst.id, shape, p); return; }
        }
        drawShapeSticker(p);
    }
    if (_mode === 'viewport') {
        const p = inst.params;
        const shape = p.vpShape;
        if (!_vpResetting && (shape === 'triangle' || shape === 'polygon')) {
            const n = shape === 'triangle' ? 3 : Math.max(3, Math.min(12, Math.round(p.vpSides)));
            const shouldReset = key === 'vpShape' || key === 'vpSides' ||
                Array.from({ length: n }, (_, i) =>
                    p[`vpV${i}x`] === 0 && p[`vpV${i}y`] === 0
                ).every(Boolean);
            if (shouldReset) { _resetPolygonVertices(inst.id, shape, n); return; }
        }
        drawViewport(p);
    }
});

// ── Public API ────────────────────────────────────────────────────────────────

export function showFadeOverlay(inst,
    xKey       = 'basicFadeX',
    yKey       = 'basicFadeY',
    shapeKey   = 'basicFadeShape',
    wKey       = 'basicFadeW',
    hKey       = 'basicFadeH',
    angleKey   = 'basicFadeAngle',
    enabledKey = 'basicFadeEnabled',
) {
    _shapeKey   = shapeKey;
    _wKey       = wKey;
    _hKey       = hKey;
    _angleKey   = angleKey;
    _enabledKey = enabledKey;
    _activate('fade', inst, xKey, yKey);
    drawFade(inst.params);
}

export function hideFadeOverlay() {
    if (_mode === 'fade') _hideActive();
}

export function showDoubleExposureOverlay(inst) {
    _shapeKey   = 'doubleExposureFadeShape';
    _wKey       = 'doubleExposureFadeW';
    _hKey       = 'doubleExposureFadeH';
    _angleKey   = 'doubleExposureFadeAngle';
    _enabledKey = 'doubleExposureFadeEnabled';
    _activate('doubleExposure', inst, 'doubleExposureFadeX', 'doubleExposureFadeY');
    drawDoubleExposure(inst.params);
}

export function hideDoubleExposureOverlay() {
    if (_mode === 'doubleExposure') _hideActive();
}

export function showShapeStickerOverlay(inst) {
    _activate('shapeSticker', inst, 'shapeStickerX', 'shapeStickerY');
    drawShapeSticker(inst.params);
}

export function hideShapeStickerOverlay() {
    if (_mode === 'shapeSticker') _hideActive();
}

export function showBlurOverlay(inst) {
    _activate('blur', inst, 'blurCenterX', 'blurCenterY');
    drawBlur(inst.params);
}

export function hideBlurOverlay() {
    if (_mode === 'blur') _hideActive();
}


export function showCropOverlay(inst) {
    _activate('crop', inst, 'cropX', 'cropY');
    setCropPreviewActive(true);
    processImageImmediate();   // re-render at full image size (skips crop transform)
    drawCrop(inst.params);
}

export function hideCropOverlay() {
    if (_mode !== 'crop') return;
    setCropPreviewActive(false);
    _hideActive();
    processImageImmediate();   // re-render with crop transform applied
}

export function showLineDragOverlay(inst) {
    _shapeKey   = 'lineDragFadeShape';
    _wKey       = 'lineDragFadeW';
    _hKey       = 'lineDragFadeH';
    _angleKey   = 'lineDragFadeAngle';
    _enabledKey = 'lineDragFadeEnabled';
    _activate('lineDrag', inst, 'lineDragX', 'lineDragY');
    drawLineDrag(inst.params);
}

export function hideLineDragOverlay() {
    if (_mode === 'lineDrag') _hideActive();
}

export function showChromaOverlay(inst) {
    _activate('chroma', inst, 'chromaOutlineX', 'chromaOutlineY');
    drawChroma(inst.params);
}

export function hideChromaOverlay() {
    if (_mode === 'chroma') _hideActive();
}

export function showVignetteOverlay(inst) {
    _activate('vignette', inst, 'vignetteCenterX', 'vignetteCenterY');
    drawVignette(inst.params);
}

export function hideVignetteOverlay() {
    if (_mode === 'vignette') _hideActive();
}

export function showCRTCurvatureOverlay(inst) {
    _wKey = 'crtCurvatureMajor';
    _hKey = 'crtCurvatureMinor';
    _angleKey = 'crtCurvatureAngle';
    _activate('crtCurvature', inst, 'crtCurvatureX', 'crtCurvatureY');
    drawCRTCurvature(inst.params);
}

export function hideCRTCurvatureOverlay() {
    if (_mode === 'crtCurvature') _hideActive();
}

export function showCorruptedOverlay(inst) {
    _activate('corrupted', inst, 'corruptedX', 'corruptedY');
    drawCorrupted(inst.params);
}

export function hideCorruptedOverlay() {
    if (_mode === 'corrupted') _hideActive();
}

// ── Activation / deactivation ─────────────────────────────────────────────────

function _activate(mode, inst, xKey, yKey) {
    // Clean up any previous listeners before switching
    uiOverlay.removeEventListener('pointerdown', onDown);
    uiOverlay.removeEventListener('pointermove', onHover);

    _mode     = mode;
    _instId   = inst.id;
    _dragging = false;
    _xKey     = xKey;
    _yKey     = yKey;

    uiOverlay.style.pointerEvents = 'auto';
    uiOverlay.addEventListener('pointerdown', onDown);
    uiOverlay.addEventListener('pointermove', onHover);
}

function _hideActive() {
    _mode       = null;
    _instId     = null;
    _dragging   = false;
    _xKey       = null;
    _yKey       = null;
    _shapeKey   = null;
    _wKey       = null;
    _hKey       = null;
    _angleKey   = null;
    _enabledKey = null;
    _skewKey    = null;
    _handle     = null;
    _dragAnchor = null;
    clear();
    uiOverlay.style.pointerEvents = 'none';
    uiOverlay.style.cursor = '';
    uiOverlay.removeEventListener('pointerdown', onDown);
    uiOverlay.removeEventListener('pointermove', onHover);
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function syncSize() {
    const r = canvas.getBoundingClientRect();
    uiOverlay.width  = r.width;
    uiOverlay.height = r.height;
}

function clear() {
    uiCtx.clearRect(0, 0, uiOverlay.width, uiOverlay.height);
}

function drawHandle(cx, cy) {
    // Filled dot with drop shadow
    uiCtx.beginPath();
    uiCtx.arc(cx, cy, 7, 0, Math.PI * 2);
    uiCtx.fillStyle   = 'rgba(255,255,255,0.92)';
    uiCtx.shadowColor = 'rgba(0,0,0,0.55)';
    uiCtx.shadowBlur  = 4;
    uiCtx.fill();
    uiCtx.shadowBlur  = 0;
    uiCtx.strokeStyle = 'rgba(0,0,0,0.4)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.stroke();
    // Cross-hair lines
    uiCtx.strokeStyle = 'rgba(255,255,255,0.75)';
    uiCtx.lineWidth   = 1;
    uiCtx.beginPath();
    uiCtx.moveTo(cx - 12, cy); uiCtx.lineTo(cx + 12, cy);
    uiCtx.moveTo(cx, cy - 12); uiCtx.lineTo(cx, cy + 12);
    uiCtx.stroke();
}

// Fade — center handle always visible; shape outline + edge handles when fade enabled
function drawFade(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);

    const cx = (0.5 + p[_xKey] / 100) * w;
    const cy = (0.5 - p[_yKey] / 100) * h;

    if (p[_enabledKey]) {
        const shape = p[_shapeKey] ?? 'ellipse';
        const angle = (p[_angleKey] ?? 0) * Math.PI / 180;
        const cosA  = Math.cos(angle), sinA = Math.sin(angle);
        const rotPt = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];

        uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
        uiCtx.lineWidth   = 1.5;
        uiCtx.setLineDash([5, 5]);

        let edgeW, edgeH, rotHandle, topEdge;
        if (shape === 'ellipse') {
            const a = (p[_wKey] / 100) * w / 2;
            const b = (p[_hKey] / 100) * h / 2;
            uiCtx.beginPath();
            uiCtx.ellipse(cx, cy, Math.max(1, a), Math.max(1, b), angle, 0, Math.PI * 2);
            uiCtx.stroke();
            edgeW     = rotPt(a, 0);
            edgeH     = rotPt(0, -b);
            topEdge   = edgeH;
            rotHandle = rotPt(0, -(b + 22));
        } else {
            const hw = (p[_wKey] / 100) * w / 2;
            const hh = (p[_hKey] / 100) * h / 2;
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

        // Connector: top of shape → rotation handle
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

    drawHandle(cx, cy);
}

function hitTestFade(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;
    const cx = (0.5 + p[_xKey] / 100) * W;
    const cy = (0.5 - p[_yKey] / 100) * H;

    if (Math.hypot(mx - cx, my - cy) <= HIT_RADIUS) return 'center';

    if (!p[_enabledKey]) return null;

    const angle = (p[_angleKey] ?? 0) * Math.PI / 180;
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];

    const shape = p[_shapeKey] ?? 'ellipse';
    let edgeW, edgeH, rotHandle;
    if (shape === 'ellipse') {
        const a = (p[_wKey] / 100) * W / 2;
        const b = (p[_hKey] / 100) * H / 2;
        edgeW     = rotPt(a, 0);
        edgeH     = rotPt(0, -b);
        rotHandle = rotPt(0, -(b + 22));
    } else {
        const hw = (p[_wKey] / 100) * W / 2;
        const hh = (p[_hKey] / 100) * H / 2;
        edgeW     = rotPt(hw, 0);
        edgeH     = rotPt(0, -hh);
        rotHandle = rotPt(0, -(hh + 22));
    }

    if (Math.hypot(mx - rotHandle[0], my - rotHandle[1]) <= HIT_RADIUS) return 'rot';
    if (Math.hypot(mx - edgeW[0],     my - edgeW[1])     <= HIT_RADIUS) return 'edgeW';
    if (Math.hypot(mx - edgeH[0],     my - edgeH[1])     <= HIT_RADIUS) return 'edgeH';
    return null;
}

// DoubleExposure — crosshair handle for second image position + optional fade shape handles
function drawDoubleExposure(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);

    const imgX = (0.5 + p.doubleExposureTexX / 100) * w;
    const imgY = (0.5 - p.doubleExposureTexY / 100) * h;

    // Fade shape + handles when fade enabled
    if (p[_enabledKey]) {
        const shape  = p[_shapeKey] ?? 'ellipse';
        const fAngle = (p[_angleKey] ?? 0) * Math.PI / 180;
        const cosA   = Math.cos(fAngle), sinA = Math.sin(fAngle);
        const fcx    = (0.5 + p[_xKey] / 100) * w;
        const fcy    = (0.5 - p[_yKey] / 100) * h;
        const rotPt  = (lx, ly) => [fcx + lx * cosA - ly * sinA, fcy + lx * sinA + ly * cosA];

        uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
        uiCtx.lineWidth   = 1.5;
        uiCtx.setLineDash([5, 5]);

        let edgeW, edgeH, rotHandle, topEdge;
        if (shape === 'ellipse') {
            const a = (p[_wKey] / 100) * w / 2;
            const b = (p[_hKey] / 100) * h / 2;
            uiCtx.beginPath();
            uiCtx.ellipse(fcx, fcy, Math.max(1, a), Math.max(1, b), fAngle, 0, Math.PI * 2);
            uiCtx.stroke();
            edgeW     = rotPt(a, 0);
            edgeH     = rotPt(0, -b);
            topEdge   = edgeH;
            rotHandle = rotPt(0, -(b + 22));
        } else {
            const hw = (p[_wKey] / 100) * w / 2;
            const hh = (p[_hKey] / 100) * h / 2;
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
        drawHandle(fcx, fcy);
    }

    // Second image position handle — diamond shape drawn on top
    const S = 9;
    uiCtx.beginPath();
    uiCtx.moveTo(imgX,     imgY - S);
    uiCtx.lineTo(imgX + S, imgY);
    uiCtx.lineTo(imgX,     imgY + S);
    uiCtx.lineTo(imgX - S, imgY);
    uiCtx.closePath();
    uiCtx.fillStyle   = 'rgba(255,255,255,0.92)';
    uiCtx.strokeStyle = 'rgba(0,0,0,0.4)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.fill();
    uiCtx.stroke();
}

function hitTestDoubleExposure(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;

    const imgX = (0.5 + p.doubleExposureTexX / 100) * W;
    const imgY = (0.5 - p.doubleExposureTexY / 100) * H;
    if (Math.hypot(mx - imgX, my - imgY) <= HIT_RADIUS) return 'imgPos';

    if (!p[_enabledKey]) return null;

    const fcx = (0.5 + p[_xKey] / 100) * W;
    const fcy = (0.5 - p[_yKey] / 100) * H;
    if (Math.hypot(mx - fcx, my - fcy) <= HIT_RADIUS) return 'center';

    const angle  = (p[_angleKey] ?? 0) * Math.PI / 180;
    const cosA   = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt  = (lx, ly) => [fcx + lx * cosA - ly * sinA, fcy + lx * sinA + ly * cosA];
    const shape  = p[_shapeKey] ?? 'ellipse';

    let edgeW, edgeH, rotHandle, topEdge;
    if (shape === 'ellipse') {
        const a = (p[_wKey] / 100) * W / 2;
        const b = (p[_hKey] / 100) * H / 2;
        edgeW     = rotPt(a, 0);
        edgeH     = rotPt(0, -b);
        topEdge   = edgeH;
        rotHandle = rotPt(0, -(b + 22));
    } else {
        const hw = (p[_wKey] / 100) * W / 2;
        const hh = (p[_hKey] / 100) * H / 2;
        edgeW     = rotPt(hw, 0);
        edgeH     = rotPt(0, -hh);
        topEdge   = edgeH;
        rotHandle = rotPt(0, -(hh + 22));
    }

    if (Math.hypot(mx - fcx, my - fcy) <= HIT_RADIUS) return 'center';
    if (Math.hypot(mx - edgeW[0], my - edgeW[1]) <= HIT_RADIUS) return 'edgeW';
    if (Math.hypot(mx - edgeH[0], my - edgeH[1]) <= HIT_RADIUS) return 'edgeH';
    if (Math.hypot(mx - rotHandle[0], my - rotHandle[1]) <= HIT_RADIUS) return 'rot';
    return null;
}

// ── Shape Sticker ─────────────────────────────────────────────────────

function _ssVertexScreenPositions(p) {
    const W = uiOverlay.width, H = uiOverlay.height;
    const cx = (0.5 + p.shapeStickerX / 100) * W;
    const cy = (0.5 - p.shapeStickerY / 100) * H;
    const sw = (p.shapeStickerW / 100) * W;
    const sh = (p.shapeStickerH / 100) * H;
    const angle = (p.shapeStickerAngle ?? 0) * Math.PI / 180;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const shape = p.shapeStickerShape || 'rectangle';
    const sides = Math.max(3, Math.min(24, Math.round(p.shapeStickerSides || 6)));
    const n = shape === 'triangle' ? 3 : (shape === 'polygon' ? sides : 0);
    if (n === 0) return [];
    const allZero = Array.from({ length: n }, (_, i) =>
        (p[`shapeStickerV${i}x`] ?? 0) === 0 && (p[`shapeStickerV${i}y`] ?? 0) === 0
    ).every(Boolean);
    const verts = [];
    for (let i = 0; i < n; i++) {
        let lx, ly;
        if (allZero) {
            const a = -Math.PI / 2 + i * (2 * Math.PI / n);
            lx = Math.cos(a) * sw / 2;
            ly = Math.sin(a) * sh / 2;
        } else {
            lx = (p[`shapeStickerV${i}x`] ?? 0) / 100 * W;
            ly = -(p[`shapeStickerV${i}y`] ?? 0) / 100 * H;
        }
        verts.push([cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA]);
    }
    return verts;
}

function _ssGrabHandles(p) {
    const W = uiOverlay.width, H = uiOverlay.height;
    const cx = (0.5 + (p.shapeStickerGrabX ?? 30) / 100) * W;
    const cy = (0.5 - (p.shapeStickerGrabY ?? 30) / 100) * H;
    const gw = (p.shapeStickerGrabW ?? 20) / 100 * W;
    const gh = (p.shapeStickerGrabH ?? 20) / 100 * H;
    const angle = (p.shapeStickerGrabAngle ?? 0) * Math.PI / 180;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const handle = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];
    return {
        center: [cx, cy],
        rot: handle(0, -(Math.max(gh, gw) / 2 + 22)),
        tl: handle(-gw / 2, -gh / 2),
        tr: handle(gw / 2, -gh / 2),
        br: handle(gw / 2, gh / 2),
        bl: handle(-gw / 2, gh / 2),
    };
}

function drawShapeSticker(p) {
    syncSize();
    const W = uiOverlay.width, H = uiOverlay.height;
    uiCtx.clearRect(0, 0, W, H);

    const cx = (0.5 + p.shapeStickerX / 100) * W;
    const cy = (0.5 - p.shapeStickerY / 100) * H;
    const sw = Math.max(1, (p.shapeStickerW / 100) * W);
    const sh = Math.max(1, (p.shapeStickerH / 100) * H);
    const angle = (p.shapeStickerAngle ?? 0) * Math.PI / 180;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const shape = p.shapeStickerShape || 'rectangle';
    const sides = Math.max(3, Math.min(24, Math.round(p.shapeStickerSides || 6)));

    // Get vertices in LOCAL space (Y-up, matching effect file)
    const localVerts = [];
    const n = shape === 'rectangle' ? 4 : shape === 'ellipse' ? 0 : (shape === 'triangle' ? 3 : sides);

    if (shape === 'rectangle') {
        localVerts.push({ x: -sw/2, y:  sh/2 }); // tl (Y-up, matching shapeSticker.js)
        localVerts.push({ x:  sw/2, y:  sh/2 }); // tr
        localVerts.push({ x:  sw/2, y: -sh/2 }); // br
        localVerts.push({ x: -sw/2, y: -sh/2 }); // bl
    } else if (shape === 'ellipse') {
        // For ellipse, compute bounding radius for rotation handle
    } else {
        const allZero = Array.from({ length: n }, (_, i) =>
            (p[`shapeStickerV${i}x`] ?? 0) === 0 && (p[`shapeStickerV${i}y`] ?? 0) === 0
        ).every(Boolean);
        for (let i = 0; i < n; i++) {
            if (allZero) {
                const a = -Math.PI / 2 + i * (2 * Math.PI / n);
                localVerts.push({ x: Math.cos(a) * sw / 2, y: Math.sin(a) * sh / 2 }); // Y-up
            } else {
                // Param Y is up, so use as-is for local space
                localVerts.push({
                    x: (p[`shapeStickerV${i}x`] ?? 0) / 100 * W,
                    y: (p[`shapeStickerV${i}y`] ?? 0) / 100 * H  // Y-up in local space
                });
            }
        }
    }

    // Compute shape radius for rotation handle (distance to farthest vertex)
    let shapeRadius = Math.hypot(sw/2, sh/2); // default for rectangle/ellipse
    if (n > 0) {
        for (const v of localVerts) {
            shapeRadius = Math.max(shapeRadius, Math.hypot(v.x, v.y));
        }
    }
    const rotDist = shapeRadius + 18; // 18px offset from farthest point
    const rotHandle = [
        cx + 0 * cosA - (-rotDist) * sinA,
        cy + 0 * sinA + (-rotDist) * cosA
    ];

    // Draw shape outline
    uiCtx.save();
    uiCtx.translate(cx, cy);
    uiCtx.rotate(angle);

    uiCtx.strokeStyle = 'rgba(255,255,255,0.85)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.setLineDash([]);

    if (shape === 'rectangle') {
        // Draw rectangle using vertices (consistent with polygon approach)
        uiCtx.beginPath();
        for (let i = 0; i < localVerts.length; i++) {
            const vx = localVerts[i].x;
            const vy = -localVerts[i].y; // Negate Y for canvas Y-down
            i === 0 ? uiCtx.moveTo(vx, vy) : uiCtx.lineTo(vx, vy);
        }
        uiCtx.closePath();
        uiCtx.stroke();
        uiCtx.restore();
        // Convert to screen coords (local Y-up → canvas Y-down: negate local Y)
        for (const v of localVerts) {
            const sx = cx + v.x * cosA - (-v.y) * sinA;
            const sy = cy + v.x * sinA + (-v.y) * cosA;
            drawCornerHandle(sx, sy);
        }
    } else if (shape === 'ellipse') {
        uiCtx.beginPath();
        uiCtx.ellipse(0, 0, sw/2, sh/2, 0, 0, Math.PI * 2);
        uiCtx.stroke();
        uiCtx.restore();
        const edgeW = [cx + (sw/2) * cosA, cy + (sw/2) * sinA];
        const edgeH = [cx + 0 * cosA - (sh/2) * sinA, cy + 0 * sinA + (sh/2) * cosA];
        drawCornerHandle(edgeW[0], edgeW[1]);
        drawCornerHandle(edgeH[0], edgeH[1]);
    } else {
        uiCtx.beginPath();
        for (let i = 0; i < localVerts.length; i++) {
            const vx = localVerts[i].x;
            const vy = -localVerts[i].y; // Negate Y for canvas Y-down (matching shapeSticker.js)
            i === 0 ? uiCtx.moveTo(vx, vy) : uiCtx.lineTo(vx, vy);
        }
        uiCtx.closePath();
        uiCtx.stroke();
        uiCtx.restore();
        // Convert to screen coords (local Y-up → canvas Y-down: negate local Y)
        for (const v of localVerts) {
            const sx = cx + v.x * cosA - (-v.y) * sinA;
            const sy = cy + v.x * sinA + (-v.y) * cosA;
            drawCornerHandle(sx, sy);
        }
    }

    drawRotHandle(rotHandle[0], rotHandle[1]);
    drawHandle(cx, cy);

    // Draw grabber overlay if fill type is image-grab
    if (p.shapeStickerFillType === 'image-grab') {
        const W2 = uiOverlay.width, H2 = uiOverlay.height;
        const gcx  = (0.5 + (p.shapeStickerGrabX ?? 30) / 100) * W2;
        const gcy  = (0.5 - (p.shapeStickerGrabY ?? 30) / 100) * H2;
        const gwPx = Math.max(1, (p.shapeStickerGrabW ?? 20) / 100 * W2);
        const ghPx = Math.max(1, (p.shapeStickerGrabH ?? 20) / 100 * H2);
        const gAngle = (p.shapeStickerGrabAngle ?? 0) * Math.PI / 180;
        const gHandles = _ssGrabHandles(p);

        // Grab rect — properly rotated outline
        uiCtx.save();
        uiCtx.translate(gcx, gcy);
        uiCtx.rotate(gAngle);
        uiCtx.strokeStyle = 'rgba(255,220,0,0.7)';
        uiCtx.lineWidth   = 1.5;
        uiCtx.setLineDash([3, 3]);
        uiCtx.strokeRect(-gwPx / 2, -ghPx / 2, gwPx, ghPx);
        uiCtx.setLineDash([]);
        uiCtx.restore();

        // Connector: top-centre of grab rect → rot handle
        const cosG = Math.cos(gAngle), sinG = Math.sin(gAngle);
        const topCx = gcx + (ghPx / 2) * sinG;
        const topCy = gcy - (ghPx / 2) * cosG;
        uiCtx.beginPath();
        uiCtx.moveTo(topCx, topCy);
        uiCtx.lineTo(gHandles.rot[0], gHandles.rot[1]);
        uiCtx.strokeStyle = 'rgba(255,220,0,0.4)';
        uiCtx.lineWidth   = 1;
        uiCtx.stroke();

        // Circle (move / rotate), square (resize)
        const drawYelCircle = (hx, hy) => {
            uiCtx.beginPath();
            uiCtx.arc(hx, hy, 6, 0, Math.PI * 2);
            uiCtx.fillStyle   = 'rgba(255,220,0,0.92)';
            uiCtx.shadowColor = 'rgba(0,0,0,0.55)';
            uiCtx.shadowBlur  = 4;
            uiCtx.fill();
            uiCtx.shadowBlur  = 0;
            uiCtx.strokeStyle = 'rgba(0,0,0,0.4)';
            uiCtx.lineWidth   = 1.5;
            uiCtx.stroke();
        };
        const drawYelSquare = (hx, hy) => {
            const s = 5;
            uiCtx.save();
            uiCtx.translate(hx, hy);
            uiCtx.shadowColor = 'rgba(0,0,0,0.55)';
            uiCtx.shadowBlur  = 4;
            uiCtx.fillStyle   = 'rgba(255,220,0,0.92)';
            uiCtx.fillRect(-s, -s, s * 2, s * 2);
            uiCtx.shadowBlur  = 0;
            uiCtx.strokeStyle = 'rgba(0,0,0,0.4)';
            uiCtx.lineWidth   = 1.5;
            uiCtx.strokeRect(-s, -s, s * 2, s * 2);
            uiCtx.restore();
        };

        drawYelCircle(gHandles.center[0], gHandles.center[1]);
        drawYelSquare(gHandles.tl[0],     gHandles.tl[1]);
        drawYelSquare(gHandles.tr[0],     gHandles.tr[1]);
        drawYelSquare(gHandles.br[0],     gHandles.br[1]);
        drawYelSquare(gHandles.bl[0],     gHandles.bl[1]);
        drawYelCircle(gHandles.rot[0],    gHandles.rot[1]);
    }
}

function hitTestShapeSticker(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const p = inst.params;
    const W = uiOverlay.width, H = uiOverlay.height;

    const cx = (0.5 + p.shapeStickerX / 100) * W;
    const cy = (0.5 - p.shapeStickerY / 100) * H;
    if (Math.hypot(mx - cx, my - cy) <= HIT_RADIUS) return 'center';

    const angle = (p.shapeStickerAngle ?? 0) * Math.PI / 180;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);

    // Get vertices in LOCAL space (Y-up, matching effect file)
    const sw = (p.shapeStickerW / 100) * W;
    const sh = (p.shapeStickerH / 100) * H;
    const shape = p.shapeStickerShape || 'rectangle';
    const sides = Math.max(3, Math.min(24, Math.round(p.shapeStickerSides || 6)));
    const n = shape === 'triangle' ? 3 : (shape === 'polygon' ? sides : 0);

    // Compute local vertices (Y-up)
    let localVerts = [];
    if (shape === 'rectangle') {
        localVerts = [{x:-sw/2, y:-sh/2}, {x:sw/2, y:-sh/2}, {x:sw/2, y:sh/2}, {x:-sw/2, y:sh/2}];
    } else if (shape === 'ellipse') {
        // For ellipse, use bounding box corners
        localVerts = [{x:-sw/2, y:-sh/2}, {x:sw/2, y:-sh/2}, {x:sw/2, y:sh/2}, {x:-sw/2, y:sh/2}];
    } else if (n > 0) {
        const allZero = Array.from({ length: n }, (_, i) =>
            (p[`shapeStickerV${i}x`] ?? 0) === 0 && (p[`shapeStickerV${i}y`] ?? 0) === 0
        ).every(Boolean);
        for (let i = 0; i < n; i++) {
            if (allZero) {
                const a = -Math.PI / 2 + i * (2 * Math.PI / n);
                localVerts.push({ x: Math.cos(a) * sw / 2, y: Math.sin(a) * sh / 2 }); // Y-up
            } else {
                // Param Y is up, so use as-is for local space
                localVerts.push({
                    x: (p[`shapeStickerV${i}x`] ?? 0) / 100 * W,
                    y: (p[`shapeStickerV${i}y`] ?? 0) / 100 * H  // Y-up in local space
                });
            }
        }
    }

    // Compute shape radius for rotation handle (distance to farthest vertex)
    let shapeRadius = Math.hypot(sw/2, sh/2); // default
    for (const v of localVerts) {
        shapeRadius = Math.max(shapeRadius, Math.hypot(v.x, v.y));
    }
    const rotDist = shapeRadius + 18; // 18px offset
    const rotH = [cx + 0 * cosA - (-rotDist) * sinA,
                  cy + 0 * sinA + (-rotDist) * cosA];
    if (Math.hypot(mx - rotH[0], my - rotH[1]) <= HIT_RADIUS) return 'rot';

    // Convert local verts to screen coords (negate Y for canvas)
    const screenVerts = localVerts.map(v => [
        cx + v.x * cosA - (-v.y) * sinA,
        cy + v.x * sinA + (-v.y) * cosA
    ]);

    if (shape === 'rectangle' || shape === 'ellipse') {
        const corners = {
            tr: screenVerts[1], br: screenVerts[2], bl: screenVerts[3], tl: screenVerts[0]
        };
        for (const [name, [hx, hy]] of Object.entries(corners)) {
            if (Math.hypot(mx - hx, my - hy) <= HIT_RADIUS) return name;
        }
    } else {
        for (let i = 0; i < screenVerts.length; i++) {
            if (Math.hypot(mx - screenVerts[i][0], my - screenVerts[i][1]) <= HIT_RADIUS) return `v${i}`;
        }
    }

    if (p.shapeStickerFillType === 'image-grab') {
        const gh = _ssGrabHandles(p);
        if (Math.hypot(mx - gh.center[0], my - gh.center[1]) <= HIT_RADIUS) return 'grab_center';
        if (Math.hypot(mx - gh.rot[0], my - gh.rot[1]) <= HIT_RADIUS) return 'grab_rot';
        for (const [name, pos] of [['grab_tl', gh.tl], ['grab_tr', gh.tr], ['grab_br', gh.br], ['grab_bl', gh.bl]]) {
            if (Math.hypot(mx - pos[0], my - pos[1]) <= HIT_RADIUS) return name;
        }
    }
    return null;
}

// LineDrag — dashed control line + anchor dot; fade shape handles when fade enabled
function drawLineDrag(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);

    // Anchor uses 0-100 system (0=left/top)
    const cx = (p.lineDragX / 100) * w;
    const cy = (p.lineDragY / 100) * h;

    // Dashed control line spanning the canvas at current angle
    const angleRad = p.lineDragAngle * Math.PI / 180;
    const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
    const ext = Math.max(w, h) * 2;
    uiCtx.beginPath();
    uiCtx.moveTo(cx - cos * ext, cy - sin * ext);
    uiCtx.lineTo(cx + cos * ext, cy + sin * ext);
    uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.setLineDash([5, 5]);
    uiCtx.stroke();
    uiCtx.setLineDash([]);

    // Rotation handle for line angle: perpendicular to the line, 22px away
    const perpAngleRad = angleRad + Math.PI / 2;
    const perpCos = Math.cos(perpAngleRad), perpSin = Math.sin(perpAngleRad);
    const rotHandleX = cx + perpCos * 22;
    const rotHandleY = cy + perpSin * 22;

    // Connector line from anchor to rotation handle
    uiCtx.beginPath();
    uiCtx.moveTo(cx, cy);
    uiCtx.lineTo(rotHandleX, rotHandleY);
    uiCtx.strokeStyle = 'rgba(255,255,255,0.4)';
    uiCtx.lineWidth   = 1;
    uiCtx.stroke();

    drawRotHandle(rotHandleX, rotHandleY);

    // Fade shape + handles when fade is enabled
    if (p[_enabledKey]) {
        const shape  = p[_shapeKey] ?? 'ellipse';
        const fAngle = (p[_angleKey] ?? 0) * Math.PI / 180;
        const cosA   = Math.cos(fAngle), sinA = Math.sin(fAngle);
        const fcx    = (0.5 + p.lineDragFadeX / 100) * w;
        const fcy    = (0.5 - p.lineDragFadeY / 100) * h;
        const rotPt  = (lx, ly) => [fcx + lx * cosA - ly * sinA, fcy + lx * sinA + ly * cosA];

        uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
        uiCtx.lineWidth   = 1.5;
        uiCtx.setLineDash([5, 5]);

        let edgeW, edgeH, rotHandle, topEdge;
        if (shape === 'ellipse') {
            const a = (p[_wKey] / 100) * w / 2;
            const b = (p[_hKey] / 100) * h / 2;
            uiCtx.beginPath();
            uiCtx.ellipse(fcx, fcy, Math.max(1, a), Math.max(1, b), fAngle, 0, Math.PI * 2);
            uiCtx.stroke();
            edgeW     = rotPt(a, 0);
            edgeH     = rotPt(0, -b);
            topEdge   = edgeH;
            rotHandle = rotPt(0, -(b + 22));
        } else {
            const hw = (p[_wKey] / 100) * w / 2;
            const hh = (p[_hKey] / 100) * h / 2;
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
        drawHandle(fcx, fcy);
    }

    // Anchor dot drawn last so it sits on top
    drawHandle(cx, cy);
}

function hitTestLineDrag(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;
    const W    = uiOverlay.width, H = uiOverlay.height;
    const p    = inst.params;

    // Anchor dot (0-100 system)
    const cx = (p.lineDragX / 100) * W;
    const cy = (p.lineDragY / 100) * H;
    if (Math.hypot(mx - cx, my - cy) <= HIT_RADIUS) return 'center';

    // Line rotation handle
    const angleRad = p.lineDragAngle * Math.PI / 180;
    const perpAngleRad = angleRad + Math.PI / 2;
    const perpCos = Math.cos(perpAngleRad), perpSin = Math.sin(perpAngleRad);
    const rotHandleX = cx + perpCos * 22;
    const rotHandleY = cy + perpSin * 22;
    if (Math.hypot(mx - rotHandleX, my - rotHandleY) <= HIT_RADIUS) return 'lineRot';

    if (!p[_enabledKey]) return null;

    // Fade handles (-50..50 system)
    const fAngle  = (p[_angleKey] ?? 0) * Math.PI / 180;
    const cosA    = Math.cos(fAngle), sinA = Math.sin(fAngle);
    const fcx     = (0.5 + p.lineDragFadeX / 100) * W;
    const fcy     = (0.5 - p.lineDragFadeY / 100) * H;
    const rotPt   = (lx, ly) => [fcx + lx * cosA - ly * sinA, fcy + lx * sinA + ly * cosA];
    const shape   = p[_shapeKey] ?? 'ellipse';
    let edgeW, edgeH, rotHandle;
    if (shape === 'ellipse') {
        const a   = (p[_wKey] / 100) * W / 2;
        const b   = (p[_hKey] / 100) * H / 2;
        edgeW     = rotPt(a, 0);
        edgeH     = rotPt(0, -b);
        rotHandle = rotPt(0, -(b + 22));
    } else {
        const hw  = (p[_wKey] / 100) * W / 2;
        const hh  = (p[_hKey] / 100) * H / 2;
        edgeW     = rotPt(hw, 0);
        edgeH     = rotPt(0, -hh);
        rotHandle = rotPt(0, -(hh + 22));
    }

    if (Math.hypot(mx - rotHandle[0], my - rotHandle[1]) <= HIT_RADIUS) return 'rot';
    if (Math.hypot(mx - edgeW[0],     my - edgeW[1])     <= HIT_RADIUS) return 'edgeW';
    if (Math.hypot(mx - edgeH[0],     my - edgeH[1])     <= HIT_RADIUS) return 'edgeH';
    if (Math.hypot(mx - fcx,          my - fcy)          <= HIT_RADIUS) return 'fadeCenter';
    return null;
}

// Blur — ellipse/rectangle always visible, handle dot always visible
function drawChroma(p) {
    syncSize();
    clear();
    if (p.chromaMode !== 'outline') return;
    const cx = (0.5 + p.chromaOutlineX / 100) * uiOverlay.width;
    const cy = (0.5 - p.chromaOutlineY / 100) * uiOverlay.height;
    drawHandle(cx, cy);
}

function drawBlur(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);

    const cx    = (0.5 + p.blurCenterX / 100) * w;
    const cy    = (0.5 - p.blurCenterY / 100) * h;
    const a     = Math.max(1, (p.blurMajor / 100) * 0.7071 * w);
    const b     = Math.max(1, (p.blurMinor / 100) * 0.7071 * h);
    const angle = p.blurAngle * Math.PI / 180;
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];

    uiCtx.save();
    uiCtx.translate(cx, cy);
    uiCtx.rotate(angle);
    uiCtx.beginPath();
    if (p.blurMode === 'rectangle') {
        uiCtx.rect(-a, -b, 2 * a, 2 * b);
    } else {
        uiCtx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
    }
    uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.setLineDash([5, 5]);
    uiCtx.stroke();
    uiCtx.setLineDash([]);
    uiCtx.restore();

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
    drawHandle(cx, cy);
}

function drawVignette(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);

    const cx    = (0.5 + p.vignetteCenterX / 100) * w;
    const cy    = (0.5 - p.vignetteCenterY / 100) * h;
    const a     = Math.max(1, (p.vignetteMajor / 100) * 0.7071 * w);
    const b     = Math.max(1, (p.vignetteMinor / 100) * 0.7071 * h);
    const angle = p.vignetteAngle * Math.PI / 180;
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];

    uiCtx.save();
    uiCtx.translate(cx, cy);
    uiCtx.rotate(angle);
    uiCtx.beginPath();
    if (p.vignetteMode === 'rectangle') {
        uiCtx.rect(-a, -b, 2 * a, 2 * b);
    } else {
        uiCtx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
    }
    uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.setLineDash([5, 5]);
    uiCtx.stroke();
    uiCtx.setLineDash([]);
    uiCtx.restore();

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
    drawHandle(cx, cy);
}

function drawCorrupted(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);
    const cx = (0.5 + p.corruptedX / 100) * w;
    const cy = (0.5 - p.corruptedY / 100) * h;
    drawHandle(cx, cy);
}

function drawCRTCurvature(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);

    const cx    = (0.5 + p.crtCurvatureX / 100) * w;
    const cy    = (0.5 - p.crtCurvatureY / 100) * h;
    const a     = Math.max(1, (p.crtCurvatureMajor / 100) * 0.7071 * w);
    const b     = Math.max(1, (p.crtCurvatureMinor / 100) * 0.7071 * h);
    const angle = p.crtCurvatureAngle * Math.PI / 180;
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];

    uiCtx.save();
    uiCtx.translate(cx, cy);
    uiCtx.rotate(angle);
    uiCtx.beginPath();
    uiCtx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
    uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.setLineDash([5, 5]);
    uiCtx.stroke();
    uiCtx.setLineDash([]);
    uiCtx.restore();

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
    drawHandle(cx, cy);
}

function hitTestCorrupted(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;
    const cx = (0.5 + p.corruptedX / 100) * W;
    const cy = (0.5 - p.corruptedY / 100) * H;
    if (Math.hypot(mx - cx, my - cy) <= HIT_RADIUS) return 'center';
    return null;
}

function hitTestCRTCurvature(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;
    const cx    = (0.5 + p.crtCurvatureX / 100) * W;
    const cy    = (0.5 - p.crtCurvatureY / 100) * H;
    const a     = Math.max(1, (p.crtCurvatureMajor / 100) * 0.7071 * W);
    const b     = Math.max(1, (p.crtCurvatureMinor / 100) * 0.7071 * H);
    const angle = p.crtCurvatureAngle * Math.PI / 180;
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];
    const edgeW     = rotPt(a, 0);
    const edgeH     = rotPt(0, -b);
    const rotHandle = rotPt(0, -(b + 22));

    if (Math.hypot(mx - cx,           my - cy)           <= HIT_RADIUS) return 'center';
    if (Math.hypot(mx - rotHandle[0], my - rotHandle[1]) <= HIT_RADIUS) return 'rot';
    if (Math.hypot(mx - edgeW[0],     my - edgeW[1])     <= HIT_RADIUS) return 'edgeW';
    if (Math.hypot(mx - edgeH[0],     my - edgeH[1])     <= HIT_RADIUS) return 'edgeH';
    return null;
}

function hitTestVignette(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;
    const cx    = (0.5 + p.vignetteCenterX / 100) * W;
    const cy    = (0.5 - p.vignetteCenterY / 100) * H;
    const a     = Math.max(1, (p.vignetteMajor / 100) * 0.7071 * W);
    const b     = Math.max(1, (p.vignetteMinor / 100) * 0.7071 * H);
    const angle = p.vignetteAngle * Math.PI / 180;
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];
    const edgeW     = rotPt(a, 0);
    const edgeH     = rotPt(0, -b);
    const rotHandle = rotPt(0, -(b + 22));

    if (Math.hypot(mx - cx,           my - cy)           <= HIT_RADIUS) return 'center';
    if (Math.hypot(mx - rotHandle[0], my - rotHandle[1]) <= HIT_RADIUS) return 'rot';
    if (Math.hypot(mx - edgeW[0],     my - edgeW[1])     <= HIT_RADIUS) return 'edgeW';
    if (Math.hypot(mx - edgeH[0],     my - edgeH[1])     <= HIT_RADIUS) return 'edgeH';
    return null;
}

function hitTestBlur(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const p = inst.params;
    const cx    = (0.5 + p.blurCenterX / 100) * W;
    const cy    = (0.5 - p.blurCenterY / 100) * H;
    const a     = Math.max(1, (p.blurMajor / 100) * 0.7071 * W);
    const b     = Math.max(1, (p.blurMinor / 100) * 0.7071 * H);
    const angle = p.blurAngle * Math.PI / 180;
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt = (lx, ly) => [cx + lx * cosA - ly * sinA, cy + lx * sinA + ly * cosA];
    const edgeW     = rotPt(a, 0);
    const edgeH     = rotPt(0, -b);
    const rotHandle = rotPt(0, -(b + 22));

    if (Math.hypot(mx - cx,           my - cy)           <= HIT_RADIUS) return 'center';
    if (Math.hypot(mx - rotHandle[0], my - rotHandle[1]) <= HIT_RADIUS) return 'rot';
    if (Math.hypot(mx - edgeW[0],     my - edgeW[1])     <= HIT_RADIUS) return 'edgeW';
    if (Math.hypot(mx - edgeH[0],     my - edgeH[1])     <= HIT_RADIUS) return 'edgeH';
    return null;
}

// Sets all shapeSticker vertex params to a regular polygon inscribed in the current bounds.
function _resetShapeStickerVertices(instId, shape, p) {
    const n = shape === 'triangle' ? 3 : Math.max(3, Math.min(24, Math.round(p.shapeStickerSides || 6)));
    const startAngle = -Math.PI / 2;
    for (let i = 0; i < 24; i++) {
        const a  = startAngle + i * (2 * Math.PI / n);
        const vx = i < n ? Math.round(Math.cos(a) * p.shapeStickerW / 2 * 100) / 100 : 0;
        const vy = i < n ? Math.round(-Math.sin(a) * p.shapeStickerH / 2 * 100) / 100 : 0;
        setInstanceParam(instId, `shapeStickerV${i}x`, vx);
        setInstanceParam(instId, `shapeStickerV${i}y`, vy);
    }
    const inst = getStack().find(i => i.id === instId);
    if (inst) drawShapeSticker(inst.params);
}

function drawRotHandle(cx, cy) {
    uiCtx.beginPath();
    uiCtx.arc(cx, cy, 6, 0, Math.PI * 2);
    uiCtx.fillStyle   = 'rgba(255,255,255,0.92)';
    uiCtx.shadowColor = 'rgba(0,0,0,0.55)';
    uiCtx.shadowBlur  = 4;
    uiCtx.fill();
    uiCtx.shadowBlur  = 0;
    uiCtx.strokeStyle = 'rgba(0,0,0,0.4)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.stroke();
}

function drawCornerHandle(cx, cy) {
    const s = 5;
    uiCtx.save();
    uiCtx.translate(cx, cy);
    uiCtx.shadowColor = 'rgba(0,0,0,0.55)';
    uiCtx.shadowBlur  = 4;
    uiCtx.fillStyle   = 'rgba(255,255,255,0.92)';
    uiCtx.fillRect(-s, -s, s * 2, s * 2);
    uiCtx.shadowBlur  = 0;
    uiCtx.strokeStyle = 'rgba(0,0,0,0.4)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.strokeRect(-s, -s, s * 2, s * 2);
    uiCtx.restore();
}

// ── Crop overlay ──────────────────────────────────────────────────────────────

const CROP_ASPECT_MAP = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '3:2': 3 / 2 };

// Replicates crop.js computeCropRegion so we can work in image-pixel space.
function _cropRegion(p, srcW, srcH) {
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
function computeCropRect(p) {
    const iW = canvas.width, iH = canvas.height;
    const W = uiOverlay.width, H = uiOverlay.height;
    const scaleX = W / iW, scaleY = H / iH;
    const { sx, sy, cropW, cropH, maxW, maxH } = _cropRegion(p, iW, iH);
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

function hitTestCrop(e) {
    const inst = getStack().find(i => i.id === _instId);
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

function drawCrop(p) {
    syncSize();
    const W = uiOverlay.width, H = uiOverlay.height;
    uiCtx.clearRect(0, 0, W, H);

    const { cx, cy, bw, bh, left, top, right, bottom } = computeCropRect(p);

    // Dim the area outside the crop rect
    uiCtx.fillStyle = 'rgba(0,0,0,0.45)';
    uiCtx.fillRect(0, 0,      W,        top);           // above
    uiCtx.fillRect(0, bottom, W,        H - bottom);    // below
    uiCtx.fillRect(0, top,    left,     bh);            // left
    uiCtx.fillRect(right, top, W - right, bh);          // right

    // Crop border
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

    // Handles
    drawHandle(cx, cy);
    drawCornerHandle(left,  top);
    drawCornerHandle(right, top);
    drawCornerHandle(right, bottom);
    drawCornerHandle(left,  bottom);
}

// ── Viewport overlay ──────────────────────────────────────────────────────────

export function showTextOverlay(inst) {
    _activate('text', inst, 'textTLx', 'textTLy');
    drawTextOverlay(inst.params);
}

export function hideTextOverlay() {
    if (_mode === 'text') _hideActive();
}

function _textCorners(p, W, H) {
    const tlx  = (p.textTLx ?? 10) / 100 * W,  tly  = (p.textTLy ?? 65) / 100 * H;
    const trx  = (p.textTRx ?? 90) / 100 * W,  try_ = (p.textTRy ?? 65) / 100 * H;
    const brx  = (p.textBRx ?? 90) / 100 * W,  bry  = (p.textBRy ?? 95) / 100 * H;
    const blx  = (p.textBLx ?? 10) / 100 * W,  bly  = (p.textBLy ?? 95) / 100 * H;
    // Centroid of all 4 corners
    const cx = (tlx + trx + brx + blx) / 4;
    const cy = (tly + try_ + bry + bly) / 4;
    // Rotation handle: 22px above top-edge midpoint, outward from box
    const topMidX = (tlx + trx) / 2, topMidY = (tly + try_) / 2;
    const edgeX = trx - tlx, edgeY = try_ - tly;
    const edgeLen = Math.hypot(edgeX, edgeY) || 1;
    let rpx = -edgeY / edgeLen, rpy = edgeX / edgeLen;
    const botMidX = (blx + brx) / 2, botMidY = (bly + bry) / 2;
    if (rpx * (botMidX - topMidX) + rpy * (botMidY - topMidY) > 0) { rpx = -rpx; rpy = -rpy; }
    const rhx = topMidX + 22 * rpx, rhy = topMidY + 22 * rpy;
    return { tlx, tly, trx, try_, brx, bry, blx, bly, cx, cy, topMidX, topMidY, rhx, rhy };
}

function drawTextOverlay(p) {
    syncSize();
    const W = uiOverlay.width, H = uiOverlay.height;
    uiCtx.clearRect(0, 0, W, H);

    const { tlx, tly, trx, try_, brx, bry, blx, bly, cx, cy, topMidX, topMidY, rhx, rhy } = _textCorners(p, W, H);

    // Box outline
    uiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
    uiCtx.lineWidth   = 1.5;
    uiCtx.setLineDash([5, 5]);
    uiCtx.beginPath();
    uiCtx.moveTo(tlx, tly);
    uiCtx.lineTo(trx, try_);
    uiCtx.lineTo(brx, bry);
    uiCtx.lineTo(blx, bly);
    uiCtx.closePath();
    uiCtx.stroke();
    uiCtx.setLineDash([]);

    // Rotation handle connector + handle
    uiCtx.beginPath();
    uiCtx.moveTo(topMidX, topMidY);
    uiCtx.lineTo(rhx, rhy);
    uiCtx.strokeStyle = 'rgba(255,255,255,0.4)';
    uiCtx.lineWidth   = 1;
    uiCtx.stroke();
    drawRotHandle(rhx, rhy);

    // Four independent corner handles + center
    drawCornerHandle(tlx, tly);
    drawCornerHandle(trx, try_);
    drawCornerHandle(brx, bry);
    drawCornerHandle(blx, bly);
    drawHandle(cx, cy);
}

function hitTestText(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = uiOverlay.width, H = uiOverlay.height;
    const { tlx, tly, trx, try_, brx, bry, blx, bly, cx, cy, rhx, rhy } = _textCorners(inst.params, W, H);
    const d = (ax, ay) => Math.hypot(mx - ax, my - ay);

    if (d(rhx, rhy)  <= HIT_RADIUS) return 'rot';
    if (d(tlx, tly)  <= HIT_RADIUS) return 'tl';
    if (d(trx, try_) <= HIT_RADIUS) return 'tr';
    if (d(brx, bry)  <= HIT_RADIUS) return 'br';
    if (d(blx, bly)  <= HIT_RADIUS) return 'bl';
    if (d(cx,  cy)   <= HIT_RADIUS) return 'center';
    return null;
}

export function showMatrixRainOverlay(inst) {
    _activate('matrixRain', inst, 'matrixRainX', 'matrixRainY');
    drawMatrixRain(inst.params);
}

export function hideMatrixRainOverlay() {
    if (_mode === 'matrixRain') _hideActive();
}

function drawMatrixRain(p) {
    syncSize();
    const w = uiOverlay.width, h = uiOverlay.height;
    uiCtx.clearRect(0, 0, w, h);
    const cx = (0.5 + p.matrixRainX / 100) * w;
    const cy = (0.5 - p.matrixRainY / 100) * h;
    drawHandle(cx, cy);
}

export function showViewportOverlay(inst) {
    _activate('viewport', inst, 'vpX', 'vpY');
    const p = inst.params;

    // Only reset vertices when they're all at zero (freshly added effect).
    // If the user has configured them, preserve their work.
    const shape = p.vpShape;
    if (shape === 'triangle' || shape === 'polygon') {
        const n = shape === 'triangle' ? 3 : Math.max(3, Math.min(12, Math.round(p.vpSides)));
        const allZero = Array.from({ length: n }, (_, i) =>
            p[`vpV${i}x`] === 0 && p[`vpV${i}y`] === 0
        ).every(Boolean);
        if (allZero) {
            _resetPolygonVertices(inst.id, shape, n);
            return;
        }
    }
    drawViewport(p);
}

export function hideViewportOverlay() {
    if (_mode === 'viewport') _hideActive();
}

// Computes regular polygon vertex offsets for the active shape and updates params.
function _resetPolygonVertices(instId, shape, sides) {
    _vpResetting = true;
    let n, startAngle;
    if (shape === 'triangle') {
        n = 3;
        startAngle = Math.PI / 2; // top vertex at top (Y-up param space)
    } else {
        n = Math.max(3, Math.min(12, sides));
        startAngle = 0; // first vertex at right
    }
    const R = 25; // radius in -50..50 param space
    for (let i = 0; i < 12; i++) {
        const angle = startAngle + i * (2 * Math.PI / n);
        const x = i < n ? Math.round(R * Math.cos(angle) * 100) / 100 : 0;
        const y = i < n ? Math.round(R * Math.sin(angle) * 100) / 100 : 0;
        setInstanceParam(instId, `vpV${i}x`, x);
        setInstanceParam(instId, `vpV${i}y`, y);
    }
    _vpResetting = false;
    const inst = getStack().find(i => i.id === instId);
    if (inst) drawViewport(inst.params);
}

// Returns { cx, cy } of viewport center in overlay pixels, plus shape geometry.
function _vpCenter(p) {
    const W = uiOverlay.width, H = uiOverlay.height;
    return {
        cx: (0.5 + p.vpX / 100) * W,
        cy: (0.5 - p.vpY / 100) * H,
        W, H,
    };
}

// Returns the vertex screen positions for triangle/polygon mode.
function _vpVertexScreenPositions(p) {
    const { W, H } = _vpCenter(p);
    const shape = p.vpShape;
    const n = shape === 'triangle' ? 3 : Math.max(3, Math.min(12, Math.round(p.vpSides)));
    const verts = [];
    for (let i = 0; i < n; i++) {
        verts.push([
            (0.5 + (p.vpX + (p[`vpV${i}x`] ?? 0)) / 100) * W,
            (0.5 - (p.vpY + (p[`vpV${i}y`] ?? 0)) / 100) * H,
        ]);
    }
    return verts;
}

function drawViewport(p) {
    syncSize();
    const W = uiOverlay.width, H = uiOverlay.height;
    uiCtx.clearRect(0, 0, W, H);

    const { cx, cy } = _vpCenter(p);

    if (p.vpShape === 'rectangle') {
        const hw = (p.vpW / 200) * W;
        const hh = (p.vpH / 200) * H;
        const left = cx - hw, top = cy - hh, right = cx + hw, bottom = cy + hh;

        // Dim outside
        uiCtx.fillStyle = 'rgba(0,0,0,0.45)';
        uiCtx.fillRect(0, 0, W, top);
        uiCtx.fillRect(0, bottom, W, H - bottom);
        uiCtx.fillRect(0, top, left, hh * 2);
        uiCtx.fillRect(right, top, W - right, hh * 2);

        // Border
        uiCtx.strokeStyle = 'rgba(255,255,255,0.85)';
        uiCtx.lineWidth   = 1.5;
        uiCtx.setLineDash([]);
        uiCtx.strokeRect(left, top, hw * 2, hh * 2);

        drawHandle(cx, cy);
        drawCornerHandle(left,  top);
        drawCornerHandle(right, top);
        drawCornerHandle(right, bottom);
        drawCornerHandle(left,  bottom);

    } else if (p.vpShape === 'circle') {
        const r = (p.vpR / 100) * Math.min(W, H) * 0.5;

        // Dim outside using composite: fill screen then clip circle
        uiCtx.save();
        uiCtx.fillStyle = 'rgba(0,0,0,0.45)';
        uiCtx.fillRect(0, 0, W, H);
        uiCtx.globalCompositeOperation = 'destination-out';
        uiCtx.beginPath();
        uiCtx.arc(cx, cy, r, 0, Math.PI * 2);
        uiCtx.fill();
        uiCtx.restore();

        // Border
        uiCtx.strokeStyle = 'rgba(255,255,255,0.85)';
        uiCtx.lineWidth   = 1.5;
        uiCtx.setLineDash([]);
        uiCtx.beginPath();
        uiCtx.arc(cx, cy, r, 0, Math.PI * 2);
        uiCtx.stroke();

        drawHandle(cx, cy);
        // Edge handle at right side of circle
        drawCornerHandle(cx + r, cy);

    } else {
        // triangle / polygon
        const verts = _vpVertexScreenPositions(p);

        // Dim outside polygon
        uiCtx.save();
        uiCtx.fillStyle = 'rgba(0,0,0,0.45)';
        uiCtx.fillRect(0, 0, W, H);
        uiCtx.globalCompositeOperation = 'destination-out';
        uiCtx.beginPath();
        if (verts.length > 0) {
            uiCtx.moveTo(verts[0][0], verts[0][1]);
            for (let i = 1; i < verts.length; i++) uiCtx.lineTo(verts[i][0], verts[i][1]);
            uiCtx.closePath();
        }
        uiCtx.fill();
        uiCtx.restore();

        // Border
        uiCtx.strokeStyle = 'rgba(255,255,255,0.85)';
        uiCtx.lineWidth   = 1.5;
        uiCtx.setLineDash([]);
        uiCtx.beginPath();
        if (verts.length > 0) {
            uiCtx.moveTo(verts[0][0], verts[0][1]);
            for (let i = 1; i < verts.length; i++) uiCtx.lineTo(verts[i][0], verts[i][1]);
            uiCtx.closePath();
        }
        uiCtx.stroke();

        drawHandle(cx, cy);
        for (const [vx, vy] of verts) drawCornerHandle(vx, vy);
    }
}

function hitTestViewport(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const p  = inst.params;
    const { cx, cy, W, H } = _vpCenter(p);

    // Center handle
    if (Math.hypot(mx - cx, my - cy) <= HIT_RADIUS) return 'center';

    if (p.vpShape === 'rectangle') {
        const hw = (p.vpW / 200) * W;
        const hh = (p.vpH / 200) * H;
        const corners = {
            tl: [cx - hw, cy - hh],
            tr: [cx + hw, cy - hh],
            br: [cx + hw, cy + hh],
            bl: [cx - hw, cy + hh],
        };
        for (const [name, [hx, hy]] of Object.entries(corners)) {
            if (Math.hypot(mx - hx, my - hy) <= HIT_RADIUS) return name;
        }
    } else if (p.vpShape === 'circle') {
        const r = (p.vpR / 100) * Math.min(W, H) * 0.5;
        if (Math.hypot(mx - (cx + r), my - cy) <= HIT_RADIUS) return 'edgeR';
    } else {
        const verts = _vpVertexScreenPositions(p);
        for (let i = 0; i < verts.length; i++) {
            if (Math.hypot(mx - verts[i][0], my - verts[i][1]) <= HIT_RADIUS) return `v${i}`;
        }
    }
    return null;
}

// ── Pointer events ────────────────────────────────────────────────────────────

const HIT_RADIUS = 18;

function getCentre() {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return null;
    const p = inst.params;
    return {
        cx: (0.5 + p[_xKey] / 100) * uiOverlay.width,
        cy: (0.5 - p[_yKey] / 100) * uiOverlay.height,
    };
}

function hitTest(e) {
    const c = getCentre();
    if (!c) return false;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - rect.left) - c.cx;
    const dy = (e.clientY - rect.top)  - c.cy;
    return Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS;
}

const CROP_CURSOR = { center: 'grab', tl: 'nw-resize', tr: 'ne-resize', br: 'se-resize', bl: 'sw-resize' };

function onHover(e) {
    if (_dragging) return;
    if (_mode === 'crop') {
        const h = hitTestCrop(e);
        uiOverlay.style.cursor = h ? (CROP_CURSOR[h] || 'default') : 'default';
    } else if (_mode === 'viewport') {
        const h = hitTestViewport(e);
        uiOverlay.style.cursor = h === 'center' ? 'grab' : h ? 'nwse-resize' : 'default';
    } else if (_mode === 'fade') {
        const h = hitTestFade(e);
        uiOverlay.style.cursor = h === 'center' ? 'grab' : h === 'rot' ? 'crosshair' : h === 'edgeW' ? 'ew-resize' : h === 'edgeH' ? 'ns-resize' : 'default';
    } else if (_mode === 'lineDrag') {
        const h = hitTestLineDrag(e);
        uiOverlay.style.cursor = (h === 'center' || h === 'fadeCenter') ? 'grab'
            : (h === 'rot' || h === 'lineRot') ? 'crosshair'
            : h === 'edgeW' ? 'ew-resize'
            : h === 'edgeH' ? 'ns-resize' : 'default';
    } else if (_mode === 'vignette') {
        const h = hitTestVignette(e);
        uiOverlay.style.cursor = h === 'center' ? 'grab'
            : h === 'rot'   ? 'crosshair'
            : h === 'edgeW' ? 'ew-resize'
            : h === 'edgeH' ? 'ns-resize' : 'default';
    } else if (_mode === 'blur') {
        const h = hitTestBlur(e);
        uiOverlay.style.cursor = h === 'center' ? 'grab'
            : h === 'rot'   ? 'crosshair'
            : h === 'edgeW' ? 'ew-resize'
            : h === 'edgeH' ? 'ns-resize' : 'default';
    } else if (_mode === 'doubleExposure') {
        const h = hitTestDoubleExposure(e);
        uiOverlay.style.cursor = (h === 'imgPos' || h === 'center') ? 'grab'
            : h === 'rot' ? 'crosshair'
            : h === 'edgeW' ? 'ew-resize'
            : h === 'edgeH' ? 'ns-resize' : 'default';
    } else if (_mode === 'corrupted') {
        uiOverlay.style.cursor = hitTestCorrupted(e) ? 'grab' : 'default';
    } else if (_mode === 'text') {
        const h = hitTestText(e);
        uiOverlay.style.cursor = h === 'center' ? 'grab'
            : h === 'rot' ? 'crosshair'
            : (h === 'tl' || h === 'br') ? 'nwse-resize'
            : (h === 'tr' || h === 'bl') ? 'nesw-resize'
            : 'default';
    } else if (_mode === 'shapeSticker') {
        const h = hitTestShapeSticker(e);
        uiOverlay.style.cursor = (h === 'center' || h === 'grab_center') ? 'grab'
            : (h === 'rot' || h === 'grab_rot') ? 'crosshair'
            : (h === 'edgeW' || h === 'edgeH' || h === 'grab_tl' || h === 'grab_tr' || h === 'grab_br' || h === 'grab_bl') ? 'nwse-resize'
            : (h && h.startsWith('v')) ? 'move'
            : h ? 'nwse-resize' : 'default';
    } else {
        uiOverlay.style.cursor = hitTest(e) ? 'grab' : 'default';
    }
}

function onDown(e) {
    if (_mode === 'crop') {
        const h = hitTestCrop(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = h === 'center' ? 'grabbing' : (CROP_CURSOR[h] || 'default');
        // Record anchor for corner drags (opposite corner stays fixed)
        if (h !== 'center') {
            const inst = getStack().find(i => i.id === _instId);
            if (inst) {
                const { cx, cy, bw, bh } = computeCropRect(inst.params);
                const SIGNS = { tl: [-1, -1], tr: [+1, -1], br: [+1, +1], bl: [-1, +1] };
                const [signX, signY] = SIGNS[h];
                _dragAnchor = {
                    oppX: cx - signX * bw / 2,
                    oppY: cy - signY * bh / 2,
                    signX, signY,
                };
            }
        }
    } else if (_mode === 'viewport') {
        const h = hitTestViewport(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = h === 'center' ? 'grabbing' : 'nwse-resize';
    } else if (_mode === 'fade') {
        const h = hitTestFade(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = h === 'center' ? 'grabbing' : h === 'rot' ? 'crosshair' : h === 'edgeW' ? 'ew-resize' : 'ns-resize';
    } else if (_mode === 'doubleExposure') {
        const h = hitTestDoubleExposure(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = (h === 'imgPos' || h === 'center') ? 'grabbing'
            : h === 'rot' ? 'crosshair' : h === 'edgeW' ? 'ew-resize' : 'ns-resize';
    } else if (_mode === 'lineDrag') {
        const h = hitTestLineDrag(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = (h === 'center' || h === 'fadeCenter') ? 'grabbing'
            : (h === 'rot' || h === 'lineRot') ? 'crosshair'
            : h === 'edgeW' ? 'ew-resize' : 'ns-resize';
    } else if (_mode === 'vignette') {
        const h = hitTestVignette(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = h === 'center' ? 'grabbing'
            : h === 'rot' ? 'crosshair' : 'nwse-resize';
    } else if (_mode === 'blur') {
        const h = hitTestBlur(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = h === 'center' ? 'grabbing'
            : h === 'rot' ? 'crosshair' : 'nwse-resize';
    } else if (_mode === 'crtCurvature') {
        const h = hitTestCRTCurvature(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = h === 'center' ? 'grabbing'
            : h === 'rot' ? 'crosshair' : 'nwse-resize';
    } else if (_mode === 'corrupted') {
        const h = hitTestCorrupted(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = 'grabbing';
    } else if (_mode === 'text') {
        const h = hitTestText(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = h === 'center' ? 'grabbing' : h === 'rot' ? 'crosshair' : 'nwse-resize';
        if (h === 'center' || h === 'rot') {
            const rect2 = canvas.getBoundingClientRect();
            const inst2 = getStack().find(i => i.id === _instId);
            const p2    = inst2?.params ?? {};
            const W2    = uiOverlay.width, H2 = uiOverlay.height;
            const { cx, cy } = _textCorners(p2, W2, H2);
            _dragAnchor = {
                startX: e.clientX - rect2.left, startY: e.clientY - rect2.top,
                cxPx: cx, cyPx: cy,
                startAngle: Math.atan2((e.clientY - rect2.top) - cy, (e.clientX - rect2.left) - cx),
                tlx0: p2.textTLx ?? 10, tly0: p2.textTLy ?? 65,
                trx0: p2.textTRx ?? 90, try0: p2.textTRy ?? 65,
                brx0: p2.textBRx ?? 90, bry0: p2.textBRy ?? 95,
                blx0: p2.textBLx ?? 10, bly0: p2.textBLy ?? 95,
            };
        }
    } else if (_mode === 'shapeSticker') {
        const h = hitTestShapeSticker(e);
        if (!h) return;
        _handle   = h;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = (h === 'center' || h === 'grab_center') ? 'grabbing'
            : (h === 'rot' || h === 'grab_rot') ? 'crosshair'
            : 'nwse-resize';
    } else {
        if (!hitTest(e)) return;
        _dragging = true;
        uiOverlay.setPointerCapture(e.pointerId);
        uiOverlay.style.cursor = 'grabbing';
    }
    uiOverlay.addEventListener('pointermove', onDrag);
    uiOverlay.addEventListener('pointerup',   onUp);
}

function onDrag(e) {
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return;
    const rect = canvas.getBoundingClientRect();

    if (_mode === 'crop') {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const W  = uiOverlay.width, H = uiOverlay.height;
        if (_handle === 'center') {
            const x = Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100)));
            const y = Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100)));
            setInstanceParam(_instId, 'cropX', x);
            setInstanceParam(_instId, 'cropY', y);
        } else if (_dragAnchor) {
            const { oppX, oppY, signX, signY } = _dragAnchor;
            const { maxW, maxH } = computeCropRect(inst.params);
            const rawW = Math.max(1, Math.abs(mx - oppX));
            const rawH = Math.max(1, Math.abs(my - oppY));
            const scaleFromW = rawW / maxW;
            const scaleFromH = rawH / maxH;
            const newScaleFrac = Math.max(0.1, Math.min(1.0, (scaleFromW + scaleFromH) / 2));
            const newScale = Math.round(newScaleFrac * 100);
            const newBW = maxW * newScaleFrac;
            const newBH = maxH * newScaleFrac;
            // New center: midpoint between fixed opp corner and new active corner
            const newCX = oppX + signX * newBW / 2;
            const newCY = oppY + signY * newBH / 2;
            const newCropX = Math.round(Math.max(-50, Math.min(50,  (newCX / W - 0.5) * 100)));
            const newCropY = Math.round(Math.max(-50, Math.min(50, -(newCY / H - 0.5) * 100)));
            setInstanceParam(_instId, 'cropScale', newScale);
            setInstanceParam(_instId, 'cropX', newCropX);
            setInstanceParam(_instId, 'cropY', newCropY);
        }
    } else if (_mode === 'viewport') {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const W  = uiOverlay.width, H = uiOverlay.height;
        const inst = getStack().find(i => i.id === _instId);
        if (!inst) return;
        const p = inst.params;

        if (_handle === 'center') {
            const x = Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100)));
            const y = Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100)));
            setInstanceParam(_instId, 'vpX', x);
            setInstanceParam(_instId, 'vpY', y);
        } else if (_handle === 'tl' || _handle === 'tr' || _handle === 'br' || _handle === 'bl') {
            const cx = (0.5 + p.vpX / 100) * W;
            const cy = (0.5 - p.vpY / 100) * H;
            const newW = Math.round(Math.max(1, Math.min(100, Math.abs(mx - cx) * 2 / W * 100)));
            const newH = Math.round(Math.max(1, Math.min(100, Math.abs(my - cy) * 2 / H * 100)));
            setInstanceParam(_instId, 'vpW', newW);
            setInstanceParam(_instId, 'vpH', newH);
        } else if (_handle === 'edgeR') {
            const cx = (0.5 + p.vpX / 100) * W;
            const cy = (0.5 - p.vpY / 100) * H;
            const dist = Math.hypot(mx - cx, my - cy);
            const r = Math.round(Math.max(1, Math.min(100, dist / (Math.min(W, H) * 0.5) * 100)));
            setInstanceParam(_instId, 'vpR', r);
        } else if (_handle && _handle.startsWith('v')) {
            const idx = parseInt(_handle.slice(1), 10);
            const ox = Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100)) - p.vpX);
            const oy = Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100)) - p.vpY);
            setInstanceParam(_instId, `vpV${idx}x`, Math.max(-50, Math.min(50, ox)));
            setInstanceParam(_instId, `vpV${idx}y`, Math.max(-50, Math.min(50, oy)));
        }
    } else if (_mode === 'fade') {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const W  = uiOverlay.width, H = uiOverlay.height;
        const p  = inst.params;
        const cx = (0.5 + p[_xKey] / 100) * W;
        const cy = (0.5 - p[_yKey] / 100) * H;
        if (_handle === 'center') {
            const x = Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100)));
            const y = Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100)));
            setInstanceParam(_instId, _xKey, x);
            setInstanceParam(_instId, _yKey, y);
        } else if (_handle === 'edgeW') {
            const newW = Math.abs(mx - cx) / (W / 2) * 100;
            setInstanceParam(_instId, _wKey, Math.round(Math.max(1, Math.min(200, newW))));
        } else if (_handle === 'edgeH') {
            const newH = Math.abs(my - cy) / (H / 2) * 100;
            setInstanceParam(_instId, _hKey, Math.round(Math.max(1, Math.min(200, newH))));
        } else if (_handle === 'rot') {
            let deg = Math.atan2(my - cy, mx - cx) * 180 / Math.PI + 90;
            if (deg > 180)  deg -= 360;
            if (deg < -180) deg += 360;
            setInstanceParam(_instId, _angleKey, Math.round(deg));
        }
    } else if (_mode === 'doubleExposure') {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const W  = uiOverlay.width, H = uiOverlay.height;
        const p  = inst.params;
        const fcx = (0.5 + p[_xKey] / 100) * W;
        const fcy = (0.5 - p[_yKey] / 100) * H;
        if (_handle === 'imgPos') {
            const x = Math.round(Math.max(-100, Math.min(100,  (mx / W - 0.5) * 100)));
            const y = Math.round(Math.max(-100, Math.min(100, -(my / H - 0.5) * 100)));
            setInstanceParam(_instId, 'doubleExposureTexX', x);
            setInstanceParam(_instId, 'doubleExposureTexY', y);
        } else if (_handle === 'center') {
            const x = Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100)));
            const y = Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100)));
            setInstanceParam(_instId, _xKey, x);
            setInstanceParam(_instId, _yKey, y);
        } else if (_handle === 'edgeW') {
            setInstanceParam(_instId, _wKey, Math.round(Math.max(1, Math.min(200, Math.abs(mx - fcx) / (W / 2) * 100))));
        } else if (_handle === 'edgeH') {
            setInstanceParam(_instId, _hKey, Math.round(Math.max(1, Math.min(200, Math.abs(my - fcy) / (H / 2) * 100))));
        } else if (_handle === 'rot') {
            let deg = Math.atan2(my - fcy, mx - fcx) * 180 / Math.PI + 90;
            if (deg > 180)  deg -= 360;
            if (deg < -180) deg += 360;
            setInstanceParam(_instId, _angleKey, Math.round(deg));
        }
    } else if (_mode === 'lineDrag') {
        const mx  = e.clientX - rect.left;
        const my  = e.clientY - rect.top;
        const W   = uiOverlay.width, H = uiOverlay.height;
        const p   = inst.params;
        const cx = (p.lineDragX / 100) * W;
        const cy = (p.lineDragY / 100) * H;
        const fcx = (0.5 + p.lineDragFadeX / 100) * W;
        const fcy = (0.5 - p.lineDragFadeY / 100) * H;
        if (_handle === 'center') {
            const x = Math.round(Math.max(0, Math.min(100, (mx / W) * 100)));
            const y = Math.round(Math.max(0, Math.min(100, (my / H) * 100)));
            setInstanceParam(_instId, 'lineDragX', x);
            setInstanceParam(_instId, 'lineDragY', y);
        } else if (_handle === 'fadeCenter') {
            const x = Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100)));
            const y = Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100)));
            setInstanceParam(_instId, 'lineDragFadeX', x);
            setInstanceParam(_instId, 'lineDragFadeY', y);
        } else if (_handle === 'lineRot') {
            let deg = Math.atan2(my - cy, mx - cx) * 180 / Math.PI + 90;
            if (deg > 180)  deg -= 360;
            if (deg < -180) deg += 360;
            setInstanceParam(_instId, 'lineDragAngle', Math.round(deg));
        } else if (_handle === 'edgeW') {
            const newW = Math.abs(mx - fcx) / (W / 2) * 100;
            setInstanceParam(_instId, _wKey, Math.round(Math.max(1, Math.min(200, newW))));
        } else if (_handle === 'edgeH') {
            const newH = Math.abs(my - fcy) / (H / 2) * 100;
            setInstanceParam(_instId, _hKey, Math.round(Math.max(1, Math.min(200, newH))));
        } else if (_handle === 'rot') {
            let deg = Math.atan2(my - fcy, mx - fcx) * 180 / Math.PI + 90;
            if (deg > 180)  deg -= 360;
            if (deg < -180) deg += 360;
            setInstanceParam(_instId, _angleKey, Math.round(deg));
        }
    } else if (_mode === 'vignette') {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const W  = uiOverlay.width, H = uiOverlay.height;
        const p  = inst.params;
        const cx = (0.5 + p.vignetteCenterX / 100) * W;
        const cy = (0.5 - p.vignetteCenterY / 100) * H;
        if (_handle === 'center') {
            setInstanceParam(_instId, 'vignetteCenterX', Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100))));
            setInstanceParam(_instId, 'vignetteCenterY', Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100))));
        } else if (_handle === 'edgeW') {
            const ang  = p.vignetteAngle * Math.PI / 180;
            const proj = (mx - cx) * Math.cos(ang) + (my - cy) * Math.sin(ang);
            setInstanceParam(_instId, 'vignetteMajor', Math.round(Math.max(1, Math.min(150, Math.abs(proj) / (0.7071 * W) * 100))));
        } else if (_handle === 'edgeH') {
            const ang  = p.vignetteAngle * Math.PI / 180;
            const proj = -(mx - cx) * Math.sin(ang) + (my - cy) * Math.cos(ang);
            setInstanceParam(_instId, 'vignetteMinor', Math.round(Math.max(1, Math.min(150, Math.abs(proj) / (0.7071 * H) * 100))));
        } else if (_handle === 'rot') {
            let deg = Math.atan2(my - cy, mx - cx) * 180 / Math.PI + 90;
            deg = ((deg % 180) + 180) % 180;
            setInstanceParam(_instId, 'vignetteAngle', Math.round(deg));
        }
    } else if (_mode === 'blur') {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const W  = uiOverlay.width, H = uiOverlay.height;
        const p  = inst.params;
        const cx = (0.5 + p.blurCenterX / 100) * W;
        const cy = (0.5 - p.blurCenterY / 100) * H;
        if (_handle === 'center') {
            setInstanceParam(_instId, 'blurCenterX', Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100))));
            setInstanceParam(_instId, 'blurCenterY', Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100))));
        } else if (_handle === 'edgeW') {
            const ang  = p.blurAngle * Math.PI / 180;
            const proj = (mx - cx) * Math.cos(ang) + (my - cy) * Math.sin(ang);
            setInstanceParam(_instId, 'blurMajor', Math.round(Math.max(1, Math.min(150, Math.abs(proj) / (0.7071 * W) * 100))));
        } else if (_handle === 'edgeH') {
            const ang  = p.blurAngle * Math.PI / 180;
            const proj = -(mx - cx) * Math.sin(ang) + (my - cy) * Math.cos(ang);
            setInstanceParam(_instId, 'blurMinor', Math.round(Math.max(1, Math.min(150, Math.abs(proj) / (0.7071 * H) * 100))));
        } else if (_handle === 'rot') {
            let deg = Math.atan2(my - cy, mx - cx) * 180 / Math.PI + 90;
            deg = ((deg % 180) + 180) % 180;
            setInstanceParam(_instId, 'blurAngle', Math.round(deg));
        }
    } else if (_mode === 'crtCurvature') {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const W  = uiOverlay.width, H = uiOverlay.height;
        const p  = inst.params;
        const cx = (0.5 + p.crtCurvatureX / 100) * W;
        const cy = (0.5 - p.crtCurvatureY / 100) * H;
        if (_handle === 'center') {
            setInstanceParam(_instId, 'crtCurvatureX', Math.round(Math.max(-50, Math.min(50,  (mx / W - 0.5) * 100))));
            setInstanceParam(_instId, 'crtCurvatureY', Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100))));
        } else if (_handle === 'edgeW') {
            const ang  = p.crtCurvatureAngle * Math.PI / 180;
            const proj = (mx - cx) * Math.cos(ang) + (my - cy) * Math.sin(ang);
            setInstanceParam(_instId, 'crtCurvatureMajor', Math.round(Math.max(1, Math.min(150, Math.abs(proj) / (0.7071 * W) * 100))));
        } else if (_handle === 'edgeH') {
            const ang  = p.crtCurvatureAngle * Math.PI / 180;
            const proj = -(mx - cx) * Math.sin(ang) + (my - cy) * Math.cos(ang);
            setInstanceParam(_instId, 'crtCurvatureMinor', Math.round(Math.max(1, Math.min(150, Math.abs(proj) / (0.7071 * H) * 100))));
        } else if (_handle === 'rot') {
            let deg = Math.atan2(my - cy, mx - cx) * 180 / Math.PI + 90;
            deg = ((deg % 180) + 180) % 180;
            setInstanceParam(_instId, 'crtCurvatureAngle', Math.round(deg));
        }
    } else if (_mode === 'text') {
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const W  = uiOverlay.width, H = uiOverlay.height;
        const toP = (v, range) => v / range * 100;

        if (_handle === 'center' && _dragAnchor) {
            const dx = toP(mx - _dragAnchor.startX, W);
            const dy = toP(my - _dragAnchor.startY, H);
            setInstanceParam(_instId, 'textTLx', _dragAnchor.tlx0 + dx);
            setInstanceParam(_instId, 'textTLy', _dragAnchor.tly0 + dy);
            setInstanceParam(_instId, 'textTRx', _dragAnchor.trx0 + dx);
            setInstanceParam(_instId, 'textTRy', _dragAnchor.try0 + dy);
            setInstanceParam(_instId, 'textBRx', _dragAnchor.brx0 + dx);
            setInstanceParam(_instId, 'textBRy', _dragAnchor.bry0 + dy);
            setInstanceParam(_instId, 'textBLx', _dragAnchor.blx0 + dx);
            setInstanceParam(_instId, 'textBLy', _dragAnchor.bly0 + dy);
        } else if (_handle === 'rot' && _dragAnchor) {
            const { cxPx, cyPx, startAngle } = _dragAnchor;
            const delta = Math.atan2(my - cyPx, mx - cxPx) - startAngle;
            const cos = Math.cos(delta), sin = Math.sin(delta);
            const rotPt = (xPct, yPct) => {
                const dx = xPct / 100 * W - cxPx, dy = yPct / 100 * H - cyPx;
                return [(cxPx + dx * cos - dy * sin) / W * 100,
                        (cyPx + dx * sin + dy * cos) / H * 100];
            };
            const [ntlx, ntly] = rotPt(_dragAnchor.tlx0, _dragAnchor.tly0);
            const [ntrx, ntry] = rotPt(_dragAnchor.trx0, _dragAnchor.try0);
            const [nbrx, nbry] = rotPt(_dragAnchor.brx0, _dragAnchor.bry0);
            const [nblx, nbly] = rotPt(_dragAnchor.blx0, _dragAnchor.bly0);
            setInstanceParam(_instId, 'textTLx', ntlx); setInstanceParam(_instId, 'textTLy', ntly);
            setInstanceParam(_instId, 'textTRx', ntrx); setInstanceParam(_instId, 'textTRy', ntry);
            setInstanceParam(_instId, 'textBRx', nbrx); setInstanceParam(_instId, 'textBRy', nbry);
            setInstanceParam(_instId, 'textBLx', nblx); setInstanceParam(_instId, 'textBLy', nbly);
        } else if (_handle === 'tl') {
            setInstanceParam(_instId, 'textTLx', toP(mx, W));
            setInstanceParam(_instId, 'textTLy', toP(my, H));
        } else if (_handle === 'tr') {
            setInstanceParam(_instId, 'textTRx', toP(mx, W));
            setInstanceParam(_instId, 'textTRy', toP(my, H));
        } else if (_handle === 'br') {
            setInstanceParam(_instId, 'textBRx', toP(mx, W));
            setInstanceParam(_instId, 'textBRy', toP(my, H));
        } else if (_handle === 'bl') {
            setInstanceParam(_instId, 'textBLx', toP(mx, W));
            setInstanceParam(_instId, 'textBLy', toP(my, H));
        }
    } else if (_mode === 'shapeSticker') {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const W  = uiOverlay.width, H = uiOverlay.height;
        const p   = inst.params;
        const cx  = (0.5 + p.shapeStickerX / 100) * W;
        const cy  = (0.5 - p.shapeStickerY / 100) * H;
        const sw  = (p.shapeStickerW / 100) * W;
        const sh  = (p.shapeStickerH / 100) * H;
        const angle = (p.shapeStickerAngle ?? 0) * Math.PI / 180;
        const cosA = Math.cos(angle), sinA = Math.sin(angle);
        const shape = p.shapeStickerShape || 'rectangle';
        const sides = Math.max(3, Math.min(24, Math.round(p.shapeStickerSides || 6)));

        if (_handle === 'center') {
            const x = Math.round(Math.max(-50, Math.min(50, (mx / W - 0.5) * 100)) * 100) / 100;
            const y = Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100)) * 100) / 100;
            setInstanceParam(_instId, 'shapeStickerX', x);
            setInstanceParam(_instId, 'shapeStickerY', y);
        } else if (_handle === 'rot') {
            let deg = Math.atan2(my - cy, mx - cx) * 180 / Math.PI + 90;
            if (deg > 180)  deg -= 360;
            if (deg < -180) deg += 360;
            setInstanceParam(_instId, 'shapeStickerAngle', Math.round(deg));
        } else if (_handle === 'grab_center') {
            const x = Math.round(Math.max(-50, Math.min(50, (mx / W - 0.5) * 100)) * 100) / 100;
            const y = Math.round(Math.max(-50, Math.min(50, -(my / H - 0.5) * 100)) * 100) / 100;
            setInstanceParam(_instId, 'shapeStickerGrabX', x);
            setInstanceParam(_instId, 'shapeStickerGrabY', y);
        } else if (_handle === 'grab_rot') {
            const gcx = (0.5 + (p.shapeStickerGrabX ?? 30) / 100) * W;
            const gcy = (0.5 - (p.shapeStickerGrabY ?? 30) / 100) * H;
            let deg = Math.atan2(my - gcy, mx - gcx) * 180 / Math.PI + 90;
            if (deg > 180)  deg -= 360;
            if (deg < -180) deg += 360;
            setInstanceParam(_instId, 'shapeStickerGrabAngle', Math.round(deg));
        } else if (_handle === 'grab_tl' || _handle === 'grab_tr' || _handle === 'grab_br' || _handle === 'grab_bl') {
            const gcx = (0.5 + (p.shapeStickerGrabX ?? 30) / 100) * W;
            const gcy = (0.5 - (p.shapeStickerGrabY ?? 30) / 100) * H;
            const gsw = (p.shapeStickerGrabW ?? 20) / 100 * W;
            const gsh = (p.shapeStickerGrabH ?? 20) / 100 * H;
            const gAngle = (p.shapeStickerGrabAngle ?? 0) * Math.PI / 180;
            const gcosA = Math.cos(gAngle), gsinA = Math.sin(gAngle);
            const dx  = mx - gcx, dy = my - gcy;
            const lx  =  dx * gcosA + dy * gsinA;
            const ly  = -dx * gsinA + dy * gcosA;
            setInstanceParam(_instId, 'shapeStickerGrabW', Math.round(Math.max(1, Math.min(100, Math.abs(lx) * 2 / W * 100))));
            setInstanceParam(_instId, 'shapeStickerGrabH', Math.round(Math.max(1, Math.min(100, Math.abs(ly) * 2 / H * 100))));
        } else if (_handle && _handle.startsWith('v')) {
            const idx = parseInt(_handle.slice(1), 10);
            const dx  = mx - cx, dy = my - cy;
            const lx  =  dx * cosA + dy * sinA;
            const ly  = -dx * sinA + dy * cosA;
            const vx  = Math.round(Math.max(-50, Math.min(50, lx / W * 100)) * 100) / 100;
            const vy  = Math.round(Math.max(-50, Math.min(50, -ly / H * 100)) * 100) / 100;
            setInstanceParam(_instId, `shapeStickerV${idx}x`, vx);
            setInstanceParam(_instId, `shapeStickerV${idx}y`, vy);
        } else if (_handle === 'edgeW') {
            const lx  = (mx - cx) * cosA + (my - cy) * sinA;
            setInstanceParam(_instId, 'shapeStickerW', Math.round(Math.max(1, Math.min(100, Math.abs(lx) * 2 / W * 100))));
        } else if (_handle === 'edgeH') {
            const ly  = -(mx - cx) * sinA + (my - cy) * cosA;
            setInstanceParam(_instId, 'shapeStickerH', Math.round(Math.max(1, Math.min(100, Math.abs(ly) * 2 / H * 100))));
        } else {
            const lx  = (mx - cx) * cosA + (my - cy) * sinA;
            const ly  = -(mx - cx) * sinA + (my - cy) * cosA;
            setInstanceParam(_instId, 'shapeStickerW', Math.round(Math.max(1, Math.min(100, Math.abs(lx) * 2 / W * 100))));
            setInstanceParam(_instId, 'shapeStickerH', Math.round(Math.max(1, Math.min(100, Math.abs(ly) * 2 / H * 100))));
        }
    } else {
        const x = Math.round(Math.max(-50, Math.min(50, ((e.clientX - rect.left) / rect.width  - 0.5) * 100)));
        const y = Math.round(Math.max(-50, Math.min(50, -((e.clientY - rect.top)  / rect.height - 0.5) * 100)));
        setInstanceParam(_instId, _xKey, x);
        setInstanceParam(_instId, _yKey, y);
    }
    // onStackChange fires → draw() called automatically
}

function onUp() {
    _dragging   = false;
    _handle     = null;
    _dragAnchor = null;
    uiOverlay.style.cursor = 'default';
    uiOverlay.removeEventListener('pointermove', onDrag);
    uiOverlay.removeEventListener('pointerup',   onUp);
    saveState();
    const inst = getStack().find(i => i.id === _instId);
    if (!inst) return;
    if (_mode === 'fade')       drawFade(inst.params);
    if (_mode === 'blur')       drawBlur(inst.params);
    if (_mode === 'crop')       drawCrop(inst.params);
    if (_mode === 'matrixRain') drawMatrixRain(inst.params);
    if (_mode === 'viewport')   drawViewport(inst.params);
    if (_mode === 'lineDrag')   drawLineDrag(inst.params);
    if (_mode === 'chroma')     drawChroma(inst.params);
    if (_mode === 'vignette')        drawVignette(inst.params);
    if (_mode === 'text')            drawTextOverlay(inst.params);
    if (_mode === 'doubleExposure')  drawDoubleExposure(inst.params);
    if (_mode === 'shapeSticker')   drawShapeSticker(inst.params);
}
