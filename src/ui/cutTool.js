import { canvas } from '../renderer/glstate.js';
import { getStack, setInstanceParam } from '../state/effectStack.js';
import { saveState } from '../state/undo.js';
import { processImageImmediate } from '../renderer/pipeline.js';
import { showNotification } from '../utils/notifications.js';
import { state } from './overlayState.js';
import { shapeGeometry, traceShapePath } from '../effects/cutShape.js';

export const MAX_PASTES = 50;

// Cut: save the pixels under the selection shape into this instance and lock it.
export function performCut(instId) {
    const inst = getStack().find(i => i.id === instId);
    if (!inst) return;
    const p = inst.params;
    const w = canvas.width, h = canvas.height;

    // Full-res snapshot of the current composited image.
    const srcFull = document.createElement('canvas');
    srcFull.width = w; srcFull.height = h;
    srcFull.getContext('2d').drawImage(canvas, 0, 0);

    const g = shapeGeometry(p, w, h);
    const bx0 = Math.max(0, Math.floor(g.bbox[0]));
    const by0 = Math.max(0, Math.floor(g.bbox[1]));
    const bx1 = Math.min(w, Math.ceil(g.bbox[2]));
    const by1 = Math.min(h, Math.ceil(g.bbox[3]));
    const cw = bx1 - bx0, ch = by1 - by0;
    if (cw < 1 || ch < 1) { showNotification('Shape is off-canvas — reposition it'); return; }

    // Clip to the shape and copy the region into a transparent cutout.
    const cut = document.createElement('canvas');
    cut.width = cw; cut.height = ch;
    const cctx = cut.getContext('2d');
    cctx.save();
    cctx.translate(-bx0, -by0);
    traceShapePath(cctx, g);
    cctx.clip();
    cctx.drawImage(srcFull, 0, 0);
    cctx.restore();

    saveState();
    setInstanceParam(instId, 'cutImage', cut.toDataURL('image/png'));
    setInstanceParam(instId, 'cutNatW', cw);
    setInstanceParam(instId, 'cutNatH', ch);
    setInstanceParam(instId, 'cutPastes', '[]');
    state.cutActive = -1;
    processImageImmediate();
    showNotification('Shape cut — click Paste to place copies');
}

// New Shape: clear the saved cutout + its copies and return to selection mode so
// the user can position and cut a different shape (a fresh start).
export function clearCut(instId) {
    const inst = getStack().find(i => i.id === instId);
    if (!inst || !inst.params.cutImage) return;
    saveState();
    setInstanceParam(instId, 'cutImage', '');
    setInstanceParam(instId, 'cutPastes', '[]');
    state.cutActive = -1;
    processImageImmediate();
    showNotification('Pick a new shape, then click Cut');
}

function _readPastes(p) {
    try { return JSON.parse(p.cutPastes || '[]'); } catch { return []; }
}

// Paste: drop a new copy at the image center; it becomes the active (selected) copy.
export function addPaste(instId) {
    const inst = getStack().find(i => i.id === instId);
    if (!inst || !inst.params.cutImage) return;
    const pastes = _readPastes(inst.params);
    if (pastes.length >= MAX_PASTES) { showNotification(`Max ${MAX_PASTES} copies per Cut Out`); return; }
    saveState();
    pastes.push({ x: 0, y: 0, scale: 100, rot: 0 });
    state.cutActive = pastes.length - 1;
    setInstanceParam(instId, 'cutPastes', JSON.stringify(pastes));
    processImageImmediate();
}

// Delete the currently selected copy.
export function deleteActivePaste(instId) {
    const inst = getStack().find(i => i.id === instId);
    if (!inst) return;
    const pastes = _readPastes(inst.params);
    const idx = state.cutActive;
    if (idx == null || idx < 0 || idx >= pastes.length) return;
    saveState();
    pastes.splice(idx, 1);
    state.cutActive = Math.min(idx, pastes.length - 1);
    setInstanceParam(instId, 'cutPastes', JSON.stringify(pastes));
    processImageImmediate();
}
