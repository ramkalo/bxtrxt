import { canvas } from '../renderer/glstate.js';
import { setInstanceParam, getStack, onStackChange } from '../state/effectStack.js';
import { saveState } from '../state/undo.js';
import { setCropPreviewActive } from '../state/cropPreview.js';
import { processImageImmediate } from '../renderer/pipeline.js';

import { state } from './overlayState.js';
import { uiOverlay, hitTestCentre } from './overlayUtils.js';

import { drawFade,           hitTestFade,           onDragFade           } from './overlays/fadeOverlay.js';
import { drawDoubleExposure, hitTestDoubleExposure, onDragDoubleExposure } from './overlays/doubleExposureOverlay.js';
import { drawShapeSticker,   hitTestShapeSticker,   onDragShapeSticker,  resetShapeStickerVertices } from './overlays/shapeStickerOverlay.js';
import { drawBlur,           hitTestBlur,           onDragBlur           } from './overlays/blurOverlay.js';
import { drawCrop,           hitTestCrop,           onDragCrop,          computeCropRect } from './overlays/cropOverlay.js';
import { drawLineDrag,       hitTestLineDrag,       onDragLineDrag       } from './overlays/lineDragOverlay.js';
import { drawChroma                                                       } from './overlays/chromaOverlay.js';
import { drawVignette,       hitTestVignette,       onDragVignette       } from './overlays/vignetteOverlay.js';
import { drawCRTCurvature,   hitTestCRTCurvature,   onDragCRTCurvature  } from './overlays/crtOverlay.js';
import { drawCorrupted,      hitTestCorrupted                            } from './overlays/corruptedOverlay.js';
import { drawTextOverlay,    hitTestText,            onDragText,          textCorners } from './overlays/textOverlay.js';
import { drawMatrixRain                                                   } from './overlays/matrixRainOverlay.js';
import { drawViewport,       hitTestViewport,        onDragViewport,      resetPolygonVertices } from './overlays/viewportOverlay.js';

// ── onStackChange redraw dispatcher ──────────────────────────────────────────

onStackChange((key) => {
    if (!state.instId) return;
    const inst = getStack().find(i => i.id === state.instId);
    if (!inst) { _hideActive(); return; }
    if (state.mode === 'fade')          drawFade(inst.params);
    if (state.mode === 'blur')          drawBlur(inst.params);
    if (state.mode === 'crop')          drawCrop(inst.params);
    if (state.mode === 'matrixRain')    drawMatrixRain(inst.params);
    if (state.mode === 'lineDrag')      drawLineDrag(inst.params);
    if (state.mode === 'chroma')        drawChroma(inst.params);
    if (state.mode === 'vignette')      drawVignette(inst.params);
    if (state.mode === 'crtCurvature')  drawCRTCurvature(inst.params);
    if (state.mode === 'corrupted')     drawCorrupted(inst.params);
    if (state.mode === 'text')          drawTextOverlay(inst.params);
    if (state.mode === 'doubleExposure') drawDoubleExposure(inst.params);
    if (state.mode === 'shapeSticker') {
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
            if (shouldReset) { resetShapeStickerVertices(inst.id, shape, p); return; }
        }
        drawShapeSticker(p);
    }
    if (state.mode === 'viewport') {
        const p = inst.params;
        const shape = p.vpShape;
        if (!state.vpResetting && (shape === 'triangle' || shape === 'polygon')) {
            const n = shape === 'triangle' ? 3 : Math.max(3, Math.min(12, Math.round(p.vpSides)));
            const shouldReset = key === 'vpShape' || key === 'vpSides' ||
                Array.from({ length: n }, (_, i) =>
                    p[`vpV${i}x`] === 0 && p[`vpV${i}y`] === 0
                ).every(Boolean);
            if (shouldReset) { resetPolygonVertices(inst.id, shape, n); return; }
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
    state.shapeKey   = shapeKey;
    state.wKey       = wKey;
    state.hKey       = hKey;
    state.angleKey   = angleKey;
    state.enabledKey = enabledKey;
    _activate('fade', inst, xKey, yKey);
    drawFade(inst.params);
}

export function hideFadeOverlay() {
    if (state.mode === 'fade') _hideActive();
}

export function showDoubleExposureOverlay(inst) {
    state.shapeKey   = 'doubleExposureFadeShape';
    state.wKey       = 'doubleExposureFadeW';
    state.hKey       = 'doubleExposureFadeH';
    state.angleKey   = 'doubleExposureFadeAngle';
    state.enabledKey = 'doubleExposureFadeEnabled';
    _activate('doubleExposure', inst, 'doubleExposureFadeX', 'doubleExposureFadeY');
    drawDoubleExposure(inst.params);
}

export function hideDoubleExposureOverlay() {
    if (state.mode === 'doubleExposure') _hideActive();
}

export function showShapeStickerOverlay(inst) {
    _activate('shapeSticker', inst, 'shapeStickerX', 'shapeStickerY');
    drawShapeSticker(inst.params);
}

export function hideShapeStickerOverlay() {
    if (state.mode === 'shapeSticker') _hideActive();
}

export function showBlurOverlay(inst) {
    _activate('blur', inst, 'blurCenterX', 'blurCenterY');
    drawBlur(inst.params);
}

export function hideBlurOverlay() {
    if (state.mode === 'blur') _hideActive();
}

export function showCropOverlay(inst) {
    _activate('crop', inst, 'cropX', 'cropY');
    setCropPreviewActive(true);
    processImageImmediate();
    drawCrop(inst.params);
}

export function hideCropOverlay() {
    if (state.mode !== 'crop') return;
    setCropPreviewActive(false);
    _hideActive();
    processImageImmediate();
}

export function showLineDragOverlay(inst) {
    state.shapeKey   = 'lineDragFadeShape';
    state.wKey       = 'lineDragFadeW';
    state.hKey       = 'lineDragFadeH';
    state.angleKey   = 'lineDragFadeAngle';
    state.enabledKey = 'lineDragFadeEnabled';
    _activate('lineDrag', inst, 'lineDragX', 'lineDragY');
    drawLineDrag(inst.params);
}

export function hideLineDragOverlay() {
    if (state.mode === 'lineDrag') _hideActive();
}

export function showChromaOverlay(inst) {
    _activate('chroma', inst, 'chromaOutlineX', 'chromaOutlineY');
    drawChroma(inst.params);
}

export function hideChromaOverlay() {
    if (state.mode === 'chroma') _hideActive();
}

export function showVignetteOverlay(inst) {
    _activate('vignette', inst, 'vignetteCenterX', 'vignetteCenterY');
    drawVignette(inst.params);
}

export function hideVignetteOverlay() {
    if (state.mode === 'vignette') _hideActive();
}

export function showCRTCurvatureOverlay(inst) {
    state.wKey     = 'crtCurvatureMajor';
    state.hKey     = 'crtCurvatureMinor';
    state.angleKey = 'crtCurvatureAngle';
    _activate('crtCurvature', inst, 'crtCurvatureX', 'crtCurvatureY');
    drawCRTCurvature(inst.params);
}

export function hideCRTCurvatureOverlay() {
    if (state.mode === 'crtCurvature') _hideActive();
}

export function showCorruptedOverlay(inst) {
    _activate('corrupted', inst, 'corruptedX', 'corruptedY');
    drawCorrupted(inst.params);
}

export function hideCorruptedOverlay() {
    if (state.mode === 'corrupted') _hideActive();
}

export function showTextOverlay(inst) {
    _activate('text', inst, 'textTLx', 'textTLy');
    drawTextOverlay(inst.params);
}

export function hideTextOverlay() {
    if (state.mode === 'text') _hideActive();
}

export function showMatrixRainOverlay(inst) {
    _activate('matrixRain', inst, 'matrixRainX', 'matrixRainY');
    drawMatrixRain(inst.params);
}

export function hideMatrixRainOverlay() {
    if (state.mode === 'matrixRain') _hideActive();
}

export function showViewportOverlay(inst) {
    _activate('viewport', inst, 'vpX', 'vpY');
    const p = inst.params;
    const shape = p.vpShape;
    if (shape === 'triangle' || shape === 'polygon') {
        const n = shape === 'triangle' ? 3 : Math.max(3, Math.min(12, Math.round(p.vpSides)));
        const allZero = Array.from({ length: n }, (_, i) =>
            p[`vpV${i}x`] === 0 && p[`vpV${i}y`] === 0
        ).every(Boolean);
        if (allZero) { resetPolygonVertices(inst.id, shape, n); return; }
    }
    drawViewport(p);
}

export function hideViewportOverlay() {
    if (state.mode === 'viewport') _hideActive();
}

// ── Activation / deactivation ─────────────────────────────────────────────────

function _activate(mode, inst, xKey, yKey) {
    uiOverlay.removeEventListener('pointerdown', onDown);
    uiOverlay.removeEventListener('pointermove', onHover);

    state.mode     = mode;
    state.instId   = inst.id;
    state.dragging = false;
    state.xKey     = xKey;
    state.yKey     = yKey;

    uiOverlay.style.pointerEvents = 'auto';
    uiOverlay.addEventListener('pointerdown', onDown);
    uiOverlay.addEventListener('pointermove', onHover);
}

function _hideActive() {
    state.mode       = null;
    state.instId     = null;
    state.dragging   = false;
    state.xKey       = null;
    state.yKey       = null;
    state.shapeKey   = null;
    state.wKey       = null;
    state.hKey       = null;
    state.angleKey   = null;
    state.enabledKey = null;
    state.skewKey    = null;
    state.handle     = null;
    state.dragAnchor = null;
    uiOverlay.getContext('2d').clearRect(0, 0, uiOverlay.width, uiOverlay.height);
    uiOverlay.style.pointerEvents = 'none';
    uiOverlay.style.cursor = '';
    uiOverlay.removeEventListener('pointerdown', onDown);
    uiOverlay.removeEventListener('pointermove', onHover);
}

// ── Pointer events ────────────────────────────────────────────────────────────

const CROP_CURSOR = { center: 'grab', tl: 'nw-resize', tr: 'ne-resize', br: 'se-resize', bl: 'sw-resize' };

function getCursorForMode(mode, h) {
    switch (mode) {
        case 'crop':
            return h ? (CROP_CURSOR[h] || 'default') : 'default';
        case 'viewport':
            return h === 'center' ? 'grab' : h ? 'nwse-resize' : 'default';
        case 'fade':
            return h === 'center' ? 'grab' : h === 'rot' ? 'crosshair' : h === 'edgeW' ? 'ew-resize' : h === 'edgeH' ? 'ns-resize' : 'default';
        case 'lineDrag':
            return (h === 'center' || h === 'fadeCenter') ? 'grab'
                : (h === 'rot' || h === 'lineRot') ? 'crosshair'
                : h === 'edgeW' ? 'ew-resize'
                : h === 'edgeH' ? 'ns-resize' : 'default';
        case 'vignette':
        case 'blur':
        case 'crtCurvature':
            return h === 'center' ? 'grab' : h === 'rot' ? 'crosshair' : h === 'edgeW' ? 'ew-resize' : h === 'edgeH' ? 'ns-resize' : 'default';
        case 'doubleExposure':
            return (h === 'imgPos' || h === 'center') ? 'grab' : h === 'rot' ? 'crosshair' : h === 'edgeW' ? 'ew-resize' : h === 'edgeH' ? 'ns-resize' : 'default';
        case 'corrupted':
            return h ? 'grab' : 'default';
        case 'text':
            return h === 'center' ? 'grab' : h === 'rot' ? 'crosshair'
                : (h === 'tl' || h === 'br') ? 'nwse-resize'
                : (h === 'tr' || h === 'bl') ? 'nesw-resize' : 'default';
        case 'shapeSticker':
            return (h === 'center' || h === 'grab_center') ? 'grab'
                : (h === 'rot' || h === 'grab_rot') ? 'crosshair'
                : (h && h.startsWith('v')) ? 'move'
                : h ? 'nwse-resize' : 'default';
        default:
            return h ? 'grab' : 'default';
    }
}

const HIT_FNS = {
    crop:           hitTestCrop,
    viewport:       hitTestViewport,
    fade:           hitTestFade,
    doubleExposure: hitTestDoubleExposure,
    lineDrag:       hitTestLineDrag,
    vignette:       hitTestVignette,
    blur:           hitTestBlur,
    crtCurvature:   hitTestCRTCurvature,
    corrupted:      hitTestCorrupted,
    text:           hitTestText,
    shapeSticker:   hitTestShapeSticker,
};

const DRAG_FNS = {
    crop:           onDragCrop,
    viewport:       onDragViewport,
    fade:           onDragFade,
    doubleExposure: onDragDoubleExposure,
    lineDrag:       onDragLineDrag,
    vignette:       onDragVignette,
    blur:           onDragBlur,
    crtCurvature:   onDragCRTCurvature,
    text:           onDragText,
    shapeSticker:   onDragShapeSticker,
};

const DRAW_FNS = {
    fade:           drawFade,
    blur:           drawBlur,
    crop:           drawCrop,
    matrixRain:     drawMatrixRain,
    viewport:       drawViewport,
    lineDrag:       drawLineDrag,
    chroma:         drawChroma,
    vignette:       drawVignette,
    text:           drawTextOverlay,
    doubleExposure: drawDoubleExposure,
    shapeSticker:   drawShapeSticker,
    corrupted:      drawCorrupted,
    crtCurvature:   drawCRTCurvature,
};

function onHover(e) {
    if (state.dragging) return;
    const hitFn = HIT_FNS[state.mode];
    const h = hitFn ? hitFn(e) : (hitTestCentre(e) ? 'center' : null);
    uiOverlay.style.cursor = getCursorForMode(state.mode, h);
}

function onDown(e) {
    const hitFn = HIT_FNS[state.mode];
    const h = hitFn ? hitFn(e) : (hitTestCentre(e) ? 'center' : null);
    if (!h) return;

    state.handle   = h;
    state.dragging = true;
    uiOverlay.setPointerCapture(e.pointerId);
    uiOverlay.style.cursor = getCursorForMode(state.mode, h).replace('grab', 'grabbing');

    // Special dragAnchor setup for crop corner drags
    if (state.mode === 'crop' && h !== 'center') {
        const inst = getStack().find(i => i.id === state.instId);
        if (inst) {
            const { cx, cy, bw, bh } = computeCropRect(inst.params);
            const SIGNS = { tl: [-1, -1], tr: [+1, -1], br: [+1, +1], bl: [-1, +1] };
            const [signX, signY] = SIGNS[h];
            state.dragAnchor = {
                oppX: cx - signX * bw / 2,
                oppY: cy - signY * bh / 2,
                signX, signY,
            };
        }
    }

    // Special dragAnchor setup for text center/rot drags
    if (state.mode === 'text' && (h === 'center' || h === 'rot')) {
        const rect2 = canvas.getBoundingClientRect();
        const inst2 = getStack().find(i => i.id === state.instId);
        const p2    = inst2?.params ?? {};
        const W2    = uiOverlay.width, H2 = uiOverlay.height;
        const { cx, cy } = textCorners(p2, W2, H2);
        state.dragAnchor = {
            startX: e.clientX - rect2.left, startY: e.clientY - rect2.top,
            cxPx: cx, cyPx: cy,
            startAngle: Math.atan2((e.clientY - rect2.top) - cy, (e.clientX - rect2.left) - cx),
            tlx0: p2.textTLx ?? 10, tly0: p2.textTLy ?? 65,
            trx0: p2.textTRx ?? 90, try0: p2.textTRy ?? 65,
            brx0: p2.textBRx ?? 90, bry0: p2.textBRy ?? 95,
            blx0: p2.textBLx ?? 10, bly0: p2.textBLy ?? 95,
        };
    }

    uiOverlay.addEventListener('pointermove', onDrag);
    uiOverlay.addEventListener('pointerup',   onUp);
}

function onDrag(e) {
    const inst = getStack().find(i => i.id === state.instId);
    if (!inst) return;
    const rect = canvas.getBoundingClientRect();

    const dragFn = DRAG_FNS[state.mode];
    if (dragFn) {
        dragFn(e, inst, rect);
    } else {
        // Generic center drag for modes with no special drag logic (chroma, matrixRain, corrupted)
        const x = Math.round(Math.max(-50, Math.min(50, ((e.clientX - rect.left) / rect.width  - 0.5) * 100)));
        const y = Math.round(Math.max(-50, Math.min(50, -((e.clientY - rect.top)  / rect.height - 0.5) * 100)));
        setInstanceParam(state.instId, state.xKey, x);
        setInstanceParam(state.instId, state.yKey, y);
    }
    // onStackChange fires → draw() called automatically
}

function onUp() {
    state.dragging   = false;
    state.handle     = null;
    state.dragAnchor = null;
    uiOverlay.style.cursor = 'default';
    uiOverlay.removeEventListener('pointermove', onDrag);
    uiOverlay.removeEventListener('pointerup',   onUp);
    saveState();
    const inst = getStack().find(i => i.id === state.instId);
    if (!inst) return;
    DRAW_FNS[state.mode]?.(inst.params);
}
