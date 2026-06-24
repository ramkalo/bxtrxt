// Self-contained Cut & Paste tool.
//   Pre-cut: the overlay shows the selection shape (handles in cutOverlay.js).
//   Cut:     performCut() saves the pixels under the shape into THIS instance
//            (cutImage) and locks the selection.
//   Post-cut: renders — optionally erasing the original region (cutErase), then
//            drawing every pasted copy (cutPastes) at its transform.
//
// Rendered via the legacy context path (no blendPrefix): canvas2d receives the
// current pipeline state preloaded, so `destination-out` can punch a real hole.

import { canvas } from '../renderer/glstate.js';
import { shapeGeometry, traceShapePath } from './cutShape.js';

export function pasteCount(p) {
    try { return JSON.parse(p.cutPastes || '[]').length; } catch { return 0; }
}

// Decoded-image cache keyed by the cutout data URL (canvas2d runs every frame).
const _imgCache = new Map();
function _cutoutImage(dataUrl) {
    if (!dataUrl) return null;
    let entry = _imgCache.get(dataUrl);
    if (!entry) {
        entry = { img: new Image(), ready: false };
        entry.img.onload = () => {
            entry.ready = true;
            // Re-render once decoded. Lazy import dodges the registry import cycle.
            import('../renderer/pipeline.js').then(m => m.processImageImmediate());
        };
        entry.img.src = dataUrl;
        _imgCache.set(dataUrl, entry);
    }
    return entry.ready ? entry.img : null;
}

function applyCut(ctx, p) {
    const w = canvas.width, h = canvas.height;

    // True cut: remove the saved region from the current image.
    if (p.cutErase) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        traceShapePath(ctx, shapeGeometry(p, w, h));
        ctx.fillStyle = '#000';
        ctx.fill();
        ctx.restore();
    }

    const img = _cutoutImage(p.cutImage);
    if (!img) return;
    const natW = p.cutNatW || img.width;
    const natH = p.cutNatH || img.height;

    let pastes;
    try { pastes = JSON.parse(p.cutPastes || '[]'); } catch { return; }
    for (const t of pastes) {
        const scale = (t.scale ?? 100) / 100;
        const dw = natW * scale, dh = natH * scale;
        const cx = (0.5 + (t.x ?? 0) / 100) * w;
        const cy = (0.5 - (t.y ?? 0) / 100) * h;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((t.rot ?? 0) * Math.PI / 180);
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
    }
}

export const cutEffect = {
    name:  'cut',
    label: 'Cut Out',
    kind:  'context',
    handleParams: [
        'cutX', 'cutY', 'cutW', 'cutH',
        ...Array.from({ length: 12 }, (_, i) => [`cutV${i}x`, `cutV${i}y`]).flat(),
    ],
    params: {
        cutShape: { default: 'rectangle', label: 'Shape', options: [['rectangle', 'Rectangle'], ['ellipse', 'Ellipse'], ['triangle', 'Triangle'], ['polygon', 'Polygon']] },
        cutSides: { default: 6, min: 3, max: 12, label: 'Sides' },
        cutErase: { default: false, label: 'Erase original (cut, not copy)' },
        cutX: { default: 0 },
        cutY: { default: 0 },
        cutW: { default: 30 },
        cutH: { default: 20 },
        ...Array.from({ length: 12 }, (_, i) => ({
            [`cutV${i}x`]: { default: 0 },
            [`cutV${i}y`]: { default: 0 },
        })).reduce((acc, o) => ({ ...acc, ...o }), {}),
        cutImage:  { default: '', hidden: true },
        cutNatW:   { default: 0,  hidden: true },
        cutNatH:   { default: 0,  hidden: true },
        cutPastes: { default: '[]', hidden: true },
    },
    // Shape controls stay present once cut (the cut block dims them) so the panel
    // doesn't restructure — only the erase toggle changes nothing on cut.
    uiGroups: (p) => [{ keys: p.cutShape === 'polygon' ? ['cutShape', 'cutSides', 'cutErase'] : ['cutShape', 'cutErase'] }],
    enabled: (p) => !!p.cutImage && (p.cutErase || pasteCount(p) > 0),
    canvas2d: applyCut,
};
