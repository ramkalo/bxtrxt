import { canvas } from '../renderer/glstate.js';

function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

function applyBlackBox(ctx, p) {
    const w = canvas.width;
    const h = canvas.height;
    const cx = (0.5 + p.blackBoxX / 100) * w;
    const cy = (0.5 - p.blackBoxY / 100) * h;
    const bw = Math.max(1, Math.round(p.blackBoxW / 100 * w));
    const bh = Math.max(1, Math.round(p.blackBoxH / 100 * h));
    const angleRad = p.blackBoxAngle * Math.PI / 180;
    const fill = p.blackBoxFill || 'black';
    const grainSize = Math.max(1, Math.round(p.blackBoxGrainSize || 1));

    const colorMap = {
        black: '#000000', white: '#ffffff',
        red: '#ff0000', green: '#00ff00', blue: '#0000ff',
        cyan: '#00ffff', yellow: '#ffff00', magenta: '#ff00ff',
    };

    const isGrain = fill === 'random' || fill === 'bw' || fill === 'image' || fill === 'image-static' || fill === 'image-grab';

    // Capture underlying pixels BEFORE drawing — required for image-based fills
    let sourcePixels = null;
    if (fill === 'image' || fill === 'image-static') {
        const x0 = Math.max(0, Math.round(cx - bw / 2));
        const y0 = Math.max(0, Math.round(cy - bh / 2));
        const capW = Math.min(bw, w - x0);
        const capH = Math.min(bh, h - y0);
        if (capW > 0 && capH > 0) sourcePixels = ctx.getImageData(x0, y0, capW, capH);
    }

    // Capture full canvas for image-grab — grab box can be anywhere (including rotated)
    let grabSourcePixels = null;
    if (fill === 'image-grab') {
        grabSourcePixels = ctx.getImageData(0, 0, w, h);
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);

    if (isGrain) {
        // Build grain on an OffscreenCanvas, then ctx.drawImage() respects the active transform
        const off = new OffscreenCanvas(bw, bh);
        const offCtx = off.getContext('2d');
        const imgData = offCtx.createImageData(bw, bh);
        const data = imgData.data;
        const rand = mkRng(p.blackBoxStaticSeed ?? 1);
        const cols = Math.ceil(bw / grainSize);
        const rows = Math.ceil(bh / grainSize);

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const px = col * grainSize;
                const py = row * grainSize;
                let r, g, b;

                if (fill === 'random') {
                    r = Math.floor(rand() * 256);
                    g = Math.floor(rand() * 256);
                    b = Math.floor(rand() * 256);
                } else if (fill === 'bw') {
                    const val = rand() > 0.5 ? 255 : 0;
                    r = g = b = val;
                } else if (fill === 'image' && sourcePixels) {
                    const sx = Math.min(px, sourcePixels.width  - 1);
                    const sy = Math.min(py, sourcePixels.height - 1);
                    const si = (sy * sourcePixels.width + sx) * 4;
                    r = sourcePixels.data[si];
                    g = sourcePixels.data[si + 1];
                    b = sourcePixels.data[si + 2];
                } else if (fill === 'image-static' && sourcePixels) {
                    const sx = Math.floor(rand() * sourcePixels.width);
                    const sy = Math.floor(rand() * sourcePixels.height);
                    const si = (sy * sourcePixels.width + sx) * 4;
                    r = sourcePixels.data[si];
                    g = sourcePixels.data[si + 1];
                    b = sourcePixels.data[si + 2];
                } else if (fill === 'image-grab' && grabSourcePixels) {
                    const gcx = (0.5 + (p.blackBoxGrabX ?? 30) / 100) * w;
                    const gcy = (0.5 - (p.blackBoxGrabY ?? 30) / 100) * h;
                    const gbw = Math.max(1, (p.blackBoxGrabW ?? 20) / 100 * w);
                    const gbh = Math.max(1, (p.blackBoxGrabH ?? 10) / 100 * h);
                    const grabAngle = (p.blackBoxGrabAngle ?? 0) * Math.PI / 180;
                    const cosG = Math.cos(grabAngle), sinG = Math.sin(grabAngle);
                    const grabMode = p.blackBoxGrabMode || 'skew';

                    let u = px / bw;
                    let v = py / bh;
                    let s, t;
                    if (grabMode === 'wrap') {
                        s = ((u * bw / gbw) % 1 + 1) % 1;
                        t = ((v * bh / gbh) % 1 + 1) % 1;
                    } else {
                        s = u;
                        t = v;
                    }
                    const lx = (s - 0.5) * gbw;
                    const ly = (t - 0.5) * gbh;
                    const wx = Math.round(gcx + lx * cosG - ly * sinG);
                    const wy = Math.round(gcy + lx * sinG + ly * cosG);
                    const sx = Math.max(0, Math.min(w - 1, wx));
                    const sy = Math.max(0, Math.min(h - 1, wy));
                    const si = (sy * w + sx) * 4;
                    r = grabSourcePixels.data[si];
                    g = grabSourcePixels.data[si + 1];
                    b = grabSourcePixels.data[si + 2];
                } else {
                    r = g = b = 0;
                }

                for (let gy = 0; gy < grainSize && py + gy < bh; gy++) {
                    for (let gx = 0; gx < grainSize && px + gx < bw; gx++) {
                        const i = ((py + gy) * bw + (px + gx)) * 4;
                        data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = 255;
                    }
                }
            }
        }

        offCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(off, -bw / 2, -bh / 2);
    } else {
        ctx.fillStyle = colorMap[fill] || '#000000';
        ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    }

    ctx.restore();
}

export default {
    name: 'blackBox',
    label: 'Black Box',
    pass: 'context',
    paramKeys: ['blackBoxX', 'blackBoxY', 'blackBoxW', 'blackBoxH', 'blackBoxAngle', 'blackBoxFill', 'blackBoxGrainSize', 'blackBoxStaticSeed', 'blackBoxGrabX', 'blackBoxGrabY', 'blackBoxGrabW', 'blackBoxGrabH', 'blackBoxGrabAngle', 'blackBoxGrabMode'],
    params: {
        blackBoxEnabled: { default: false },
        blackBoxX:       { default: 0,  min: -50,  max: 50  },
        blackBoxY:       { default: 0,  min: -50,  max: 50  },
        blackBoxW:       { default: 30, min: 1,    max: 100 },
        blackBoxH:       { default: 10, min: 1,    max: 100 },
        blackBoxAngle:   { default: 0,  min: -180, max: 180 },
        blackBoxFill:       { default: 'black' },
        blackBoxGrainSize:  { default: 1,     min: 1, max: 20 },
        blackBoxStaticSeed: { default: 1 },
        blackBoxGrabX:     { default: 30, min: -50,  max: 50  },
        blackBoxGrabY:     { default: 30, min: -50,  max: 50  },
        blackBoxGrabW:     { default: 20, min: 1,    max: 100 },
        blackBoxGrabH:     { default: 10, min: 1,    max: 100 },
        blackBoxGrabAngle: { default: 0,  min: -180, max: 180 },
        blackBoxGrabMode:  { default: 'skew' },
    },
    enabled:      (p) => p.blackBoxEnabled,
    handleParams: ['blackBoxX', 'blackBoxY', 'blackBoxW', 'blackBoxH', 'blackBoxAngle', 'blackBoxGrabX', 'blackBoxGrabY', 'blackBoxGrabW', 'blackBoxGrabH', 'blackBoxGrabAngle', 'blackBoxGrabMode'],
    canvas2d: applyBlackBox,
};