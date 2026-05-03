import { canvas } from '../renderer/glstate.js';

const SOLID_COLORS = {
    'r': '#ff0000', 'g': '#00ff00', 'b': '#0000ff',
    'c': '#00ffff', 'y': '#ffff00', 'm': '#ff00ff',
    'black': '#000000', 'white': '#ffffff',
};

function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

function getStickerLocalVertices(p, w, h) {
    const sw = (p.shapeStickerW / 100) * w;
    const sh = (p.shapeStickerH / 100) * h;
    const shape = p.shapeStickerShape || 'rectangle';
    const sides = Math.max(3, Math.min(24, Math.round(p.shapeStickerSides || 6)));
    const n = shape === 'triangle' ? 3 : (shape === 'polygon' ? sides : 0);

    if (n === 0) {
        return [
            { x: -sw/2, y:  sh/2 },
            { x:  sw/2, y:  sh/2 },
            { x:  sw/2, y: -sh/2 },
            { x: -sw/2, y: -sh/2 },
        ];
    }

    const allZero = Array.from({ length: n }, (_, i) =>
        (p[`shapeStickerV${i}x`] ?? 0) === 0 && (p[`shapeStickerV${i}y`] ?? 0) === 0
    ).every(Boolean);

    const verts = [];
    for (let i = 0; i < n; i++) {
        if (allZero) {
            const a = -Math.PI / 2 + i * (2 * Math.PI / n);
            verts.push({ x: Math.cos(a) * sw / 2, y: Math.sin(a) * sh / 2 });
        } else {
            verts.push({
                x: (p[`shapeStickerV${i}x`] ?? 0) / 100 * w,
                y: (p[`shapeStickerV${i}y`] ?? 0) / 100 * h,
            });
        }
    }
    return verts;
}

function getLocalBoundingBox(verts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of verts) {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
    }
    return { minX, minY, maxX, maxY };
}

function applyShapeSticker(ctx, p) {
    const w = canvas.width;
    const h = canvas.height;

    const sx = (0.5 + p.shapeStickerX / 100) * w;
    const sy = (0.5 - p.shapeStickerY / 100) * h;
    const angleRad = (p.shapeStickerAngle || 0) * Math.PI / 180;
    const shape = p.shapeStickerShape || 'rectangle';
    const sides = Math.max(3, Math.min(24, Math.round(p.shapeStickerSides || 6)));

    const fillType = p.shapeStickerFillType || 'solid';
    const solidColor = p.shapeStickerSolidColor || 'black';
    const staticType = p.shapeStickerStaticType || 'greyscale';
    const grainSize = Math.max(1, Math.round(p.shapeStickerGrainSize || 4));
    const staticSeed = p.shapeStickerStaticSeed || 1;

    const grabX = (0.5 + (p.shapeStickerGrabX ?? 30) / 100) * w;
    const grabY = (0.5 - (p.shapeStickerGrabY ?? 30) / 100) * h;
    const grabW = Math.max(1, (p.shapeStickerGrabW ?? 20) / 100 * w);
    const grabH = Math.max(1, (p.shapeStickerGrabH ?? 20) / 100 * h);
    const grabAngle = (p.shapeStickerGrabAngle ?? 0) * Math.PI / 180;
    const grabMode = p.shapeStickerGrabMode || 'skew';

    const localVerts = getStickerLocalVertices(p, w, h);
    const isEllipse = shape === 'ellipse';

    const bbox = isEllipse
        ? (() => {
            const sw = (p.shapeStickerW / 100) * w;
            const sh = (p.shapeStickerH / 100) * h;
            return { minX: -sw/2, maxX: sw/2, minY: -sh/2, maxY: sh/2 };
          })()
        : getLocalBoundingBox(localVerts);

    const warpW = Math.max(1, Math.ceil(bbox.maxX - bbox.minX));
    const warpH = Math.max(1, Math.ceil(bbox.maxY - bbox.minY));

    const warpCanvas = new OffscreenCanvas(warpW, warpH);
    const warpCtx = warpCanvas.getContext('2d');

    if (fillType === 'solid') {
        const hex = SOLID_COLORS[solidColor] || '#000000';
        const rgb = hex.match(/\w{2}/g).map(v => parseInt(v, 16));
        const imgData = warpCtx.createImageData(warpW, warpH);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = rgb[0]; data[i+1] = rgb[1]; data[i+2] = rgb[2]; data[i+3] = 255;
        }
        warpCtx.putImageData(imgData, 0, 0);
    } else if (fillType === 'static') {
        const rand = mkRng(staticSeed);
        const cols = Math.ceil(warpW / grainSize);
        const rows = Math.ceil(warpH / grainSize);
        let sourcePixels = null;
        if (staticType === 'image-color-static') {
            sourcePixels = ctx.getImageData(0, 0, w, h);
        }
        const imgData = warpCtx.createImageData(warpW, warpH);
        const data = imgData.data;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const px = col * grainSize;
                const py = row * grainSize;
                let r, g, b;
                if (staticType === 'greyscale') {
                    const val = Math.floor(rand() * 256);
                    r = g = b = val;
                } else if (staticType === 'random-rgbcym') {
                    const colors = ['r', 'g', 'b', 'c', 'y', 'm'];
                    const c = colors[Math.floor(rand() * 6)];
                    const hex = SOLID_COLORS[c];
                    const rgb = hex.match(/\w{2}/g).map(v => parseInt(v, 16));
                    r = rgb[0]; g = rgb[1]; b = rgb[2];
                } else if (staticType === 'image-color-static' && sourcePixels) {
                    const sx = Math.floor(rand() * sourcePixels.width);
                    const sy = Math.floor(rand() * sourcePixels.height);
                    const si = (sy * sourcePixels.width + sx) * 4;
                    r = sourcePixels.data[si];
                    g = sourcePixels.data[si + 1];
                    b = sourcePixels.data[si + 2];
                } else {
                    r = g = b = 0;
                }
                for (let gy = 0; gy < grainSize && py + gy < warpH; gy++) {
                    for (let gx = 0; gx < grainSize && px + gx < warpW; gx++) {
                        const x = px + gx;
                        const y = py + gy;
                        const idx = (y * warpW + x) * 4;
                        data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = 255;
                    }
                }
            }
        }
        warpCtx.putImageData(imgData, 0, 0);
    } else if (fillType === 'image-grab') {
        const fullSrc = new OffscreenCanvas(w, h);
        fullSrc.getContext('2d').putImageData(ctx.getImageData(0, 0, w, h), 0, 0);

        const gCanvas = new OffscreenCanvas(Math.round(grabW), Math.round(grabH));
        const gCtx = gCanvas.getContext('2d');
        gCtx.translate(grabW / 2, grabH / 2);
        gCtx.rotate(-grabAngle);
        gCtx.translate(-grabX, -grabY);
        gCtx.drawImage(fullSrc, 0, 0);

        if (grabMode === 'skew') {
            warpCtx.drawImage(gCanvas, 0, 0, warpW, warpH);
        } else {
            const cx_w = -bbox.minX;
            const cy_w = bbox.maxY;
            const gW = gCanvas.width, gH = gCanvas.height;
            const tx = ((cx_w - gW / 2) % gW + gW) % gW;
            const ty = ((cy_w - gH / 2) % gH + gH) % gH;
            const pattern = warpCtx.createPattern(gCanvas, 'repeat');
            pattern.setTransform(new DOMMatrix().translate(tx, ty));
            warpCtx.fillStyle = pattern;
            warpCtx.fillRect(0, 0, warpW, warpH);
        }
    }

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angleRad);

    ctx.beginPath();
    if (isEllipse) {
        const sw = (p.shapeStickerW / 100) * w;
        const sh = (p.shapeStickerH / 100) * h;
        ctx.ellipse(0, 0, sw/2, sh/2, 0, 0, Math.PI * 2);
    } else {
        for (let i = 0; i < localVerts.length; i++) {
            const vx = localVerts[i].x;
            const vy = -localVerts[i].y;
            i === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy);
        }
        if (localVerts.length > 1) ctx.closePath();
    }
    ctx.clip();

    ctx.drawImage(warpCanvas, bbox.minX, -bbox.maxY);
    ctx.restore();
}

export const shapeStickerEffect = {
    name: 'shapeSticker',
    label: 'Shape Sticker',
    pass: 'context',
    paramKeys: [
        'shapeStickerX', 'shapeStickerY', 'shapeStickerW', 'shapeStickerH', 'shapeStickerAngle',
        'shapeStickerShape', 'shapeStickerSides',
        'shapeStickerFillType', 'shapeStickerSolidColor', 'shapeStickerStaticType',
        'shapeStickerGrainSize', 'shapeStickerStaticSeed',
        'shapeStickerGrabX', 'shapeStickerGrabY', 'shapeStickerGrabW', 'shapeStickerGrabH',
        'shapeStickerGrabAngle', 'shapeStickerGrabMode',
        ...Array.from({ length: 24 }, (_, i) => [`shapeStickerV${i}x`, `shapeStickerV${i}y`]).flat(),
    ],
    handleParams: [
        'shapeStickerX', 'shapeStickerY', 'shapeStickerW', 'shapeStickerH', 'shapeStickerAngle',
        ...Array.from({ length: 24 }, (_, i) => [`shapeStickerV${i}x`, `shapeStickerV${i}y`]).flat(),
        'shapeStickerGrabX', 'shapeStickerGrabY', 'shapeStickerGrabW', 'shapeStickerGrabH', 'shapeStickerGrabAngle',
    ],
    params: {
        shapeStickerEnabled: { default: false },
        shapeStickerX: { default: 0, min: -50, max: 50 },
        shapeStickerY: { default: 0, min: -50, max: 50 },
        shapeStickerW: { default: 30, min: 1, max: 100 },
        shapeStickerH: { default: 30, min: 1, max: 100 },
        shapeStickerAngle: { default: 0, min: -180, max: 180 },
        shapeStickerShape: { default: 'rectangle' },
        shapeStickerSides: { default: 6, min: 3, max: 24 },
        shapeStickerFillType: { default: 'solid' },
        shapeStickerSolidColor: { default: 'black' },
        shapeStickerStaticType: { default: 'greyscale' },
        shapeStickerGrainSize: { default: 4, min: 1, max: 50 },
        shapeStickerStaticSeed: { default: 1 },
        shapeStickerGrabX: { default: 30, min: -50, max: 50 },
        shapeStickerGrabY: { default: 30, min: -50, max: 50 },
        shapeStickerGrabW: { default: 20, min: 1, max: 100 },
        shapeStickerGrabH: { default: 20, min: 1, max: 100 },
        shapeStickerGrabAngle: { default: 0, min: -180, max: 180 },
        shapeStickerGrabMode: { default: 'skew' },
        ...Array.from({ length: 24 }, (_, i) => ({
            [`shapeStickerV${i}x`]: { default: 0 },
            [`shapeStickerV${i}y`]: { default: 0 },
        })).reduce((acc, obj) => ({ ...acc, ...obj }), {}),
    },
    enabled: (p) => p.shapeStickerEnabled,
    uiGroups: (p) => {
        const groups = [
            { label: 'Sticker', keys: ['shapeStickerShape', 'shapeStickerSides'] },
            { label: 'Transform', keys: ['shapeStickerX', 'shapeStickerY', 'shapeStickerW', 'shapeStickerH', 'shapeStickerAngle'] },
            { label: 'Fill', keys: ['shapeStickerFillType'] },
        ];
        if (p.shapeStickerFillType === 'solid') {
            groups.push({ label: 'Solid Color', keys: ['shapeStickerSolidColor'] });
        } else if (p.shapeStickerFillType === 'static') {
            groups.push(
                { label: 'Static Type', keys: ['shapeStickerStaticType'] },
                { label: 'Grain', keys: ['shapeStickerGrainSize', 'shapeStickerStaticSeed'] },
            );
        } else if (p.shapeStickerFillType === 'image-grab') {
            groups.push({
                label: 'Grabber',
                keys: ['shapeStickerGrabX', 'shapeStickerGrabY', 'shapeStickerGrabW', 'shapeStickerGrabH', 'shapeStickerGrabAngle', 'shapeStickerGrabMode'],
            });
        }
        return groups;
    },
    canvas2d: applyShapeSticker,
};
