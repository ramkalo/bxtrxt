const NAMED_TEXT_COLORS = {
    white:   'rgba(255,255,255,0.92)',
    black:   'rgba(0,0,0,0.92)',
    red:     '#ff4444',
    green:   '#44ff44',
    blue:    '#4488ff',
    cyan:    '#00ffff',
    yellow:  '#ffff00',
    magenta: '#ff44ff',
};

const BG_COLORS = {
    black:         'rgba(0,0,0,0.88)',
    white:         'rgba(255,255,255,0.88)',
    'semi-black':  'rgba(0,0,0,0.45)',
    'semi-white':  'rgba(255,255,255,0.45)',
};

function seededRandom(seed, idx) {
    let h = ((seed * 2654435761) ^ (idx * 2246822519)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x45d9f3b) >>> 0;
    h ^= h >>> 16;
    return h / 0x100000000;
}

function samplePalette(ctx, seed, count = 64) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const data = ctx.getImageData(0, 0, W, H).data;
    const palette = [];
    for (let i = 0; i < count; i++) {
        const px = Math.floor(seededRandom(seed, i * 2) * W);
        const py = Math.floor(seededRandom(seed, i * 2 + 1) * H);
        const off = (py * W + px) * 4;
        palette.push(`rgb(${data[off]},${data[off + 1]},${data[off + 2]})`);
    }
    return palette;
}

function resolveTextColor(key, rng, palette) {
    if (NAMED_TEXT_COLORS[key]) return NAMED_TEXT_COLORS[key];
    if (key === 'greyNoise') { const v = Math.floor(rng() * 256); return `rgb(${v},${v},${v})`; }
    if (key === 'colorNoise') return `hsl(${Math.floor(rng() * 360)},100%,55%)`;
    if (key === 'paletteNoise' && palette?.length) return palette[Math.floor(rng() * palette.length)];
    return 'rgba(255,255,255,0.92)';
}

function wrapLine(ctx, text, maxW) {
    if (!text) return [''];
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        const test = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = w; }
        else cur = test;
    }
    lines.push(cur);
    return lines;
}

export function applyText(ctx, p) {
    const opacity = p.textOpacity ?? 1;
    
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    const tlx  = (p.textTLx ?? 10) / 100 * W,  tly  = (p.textTLy ?? 65) / 100 * H;
    const trx  = (p.textTRx ?? 90) / 100 * W,  try_ = (p.textTRy ?? 65) / 100 * H;
    const brx  = (p.textBRx ?? 90) / 100 * W,  bry  = (p.textBRy ?? 95) / 100 * H;
    const blx  = (p.textBLx ?? 10) / 100 * W,  bly  = (p.textBLy ?? 95) / 100 * H;

    // Reference width = top edge length (used for word wrap and alignment math)
    const tw = Math.hypot(trx - tlx, try_ - tly);
    // Reference height = left edge length (used for vAlign)
    const th = Math.hypot(blx - tlx, bly - tly);
    if (tw < 1 || th < 1) return;

    const size  = p.textSize ?? 64;
    const lineH = size * (p.textLineHeight ?? 1.2);

    const variant = `${p.textItalic ? 'italic ' : ''}${p.textBold ? 'bold ' : ''}`;

    ctx.save();
    ctx.font = `${variant}${size}px ${p.textFont ?? "'JetBrains Mono', monospace"}`;
    ctx.textBaseline = 'top';
    ctx.lineWidth    = Math.max(1, size * 0.04);

    // Word-wrap using top-edge width as the reference (measureText ignores transforms)
    const rawLines = (p.text ?? '').split('\n');
    let lines = [];
    if (p.textWrap !== false) {
        for (const rl of rawLines) lines.push(...wrapLine(ctx, rl, tw));
    } else {
        lines = rawLines;
    }
    if (!lines.length) lines = [''];

    const totalH = lines.length * lineH;
    const va = p.textVAlign ?? 'top';
    let startY = 0;
    if      (va === 'middle') startY = (th - totalH) / 2;
    else if (va === 'bottom') startY = th - totalH;

    const colorKey    = p.textColor ?? 'white';
    const strokeColor = (colorKey === 'black') ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
    const seed        = p.textNoiseSeed ?? 0;
    const palette     = colorKey === 'paletteNoise' ? samplePalette(ctx, seed) : null;
    let   noiseIdx    = 0;

    // Background: fill the actual quad shape
    if (p.textBg && p.textBg !== 'none' && BG_COLORS[p.textBg]) {
        ctx.fillStyle = BG_COLORS[p.textBg];
        ctx.beginPath();
        ctx.moveTo(tlx, tly);
        ctx.lineTo(trx, try_);
        ctx.lineTo(brx, bry);
        ctx.lineTo(blx, bly);
        ctx.closePath();
        ctx.fill();
    }

    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeColor;

    // Rubber-sheet rendering: per-character bilinear Jacobian transform.
    // For each character at source position (u, v), the Jacobian of the bilinear
    // quad map gives the correct shear+scale to deform glyphs like a rubber sheet.
    const align = p.textAlign ?? 'left';

    for (let i = 0; i < lines.length; i++) {
        const line  = lines[i];
        const lineY = startY + i * lineH;
        const v     = lineY / th;

        const chars  = [...line];
        const widths = chars.map(ch => ctx.measureText(ch).width);
        const lineW  = widths.reduce((s, w) => s + w, 0);

        let charX = 0;
        let justifyGap = 0;
        const isJustify = align === 'justify'
            && i < lines.length - 1
            && line.includes(' ');

        if (align === 'center') {
            charX = (tw - lineW) / 2;
        } else if (align === 'right') {
            charX = tw - lineW;
        } else if (isJustify) {
            const spaceCount = chars.filter(ch => ch === ' ').length;
            if (spaceCount > 0) justifyGap = (tw - lineW) / spaceCount;
        }

        for (let j = 0; j < chars.length; j++) {
            const ch    = chars[j];
            const charW = widths[j];
            const u     = charX / tw;

            // Bilinear output position P(u, v)
            const ox = (1 - u) * (1 - v) * tlx + u * (1 - v) * trx
                     + u * v * brx + (1 - u) * v * blx;
            const oy = (1 - u) * (1 - v) * tly + u * (1 - v) * try_
                     + u * v * bry + (1 - u) * v * bly;

            // Jacobian columns: horizontal and vertical tangent vectors
            const dPdu_x = (1 - v) * (trx - tlx) + v * (brx - blx);
            const dPdu_y = (1 - v) * (try_ - tly) + v * (bry - bly);
            const dPdv_x = (1 - u) * (blx - tlx) + u * (brx - trx);
            const dPdv_y = (1 - u) * (bly - tly) + u * (bry - try_);

            ctx.save();
            ctx.fillStyle = resolveTextColor(colorKey, () => seededRandom(seed, noiseIdx++), palette);
            ctx.transform(
                dPdu_x / tw,  dPdu_y / tw,
                dPdv_x / th,  dPdv_y / th,
                ox, oy
            );

            ctx.strokeText(ch, 0, 0);
            ctx.fillText(ch, 0, 0);
            if (p.textStrike) {
                ctx.fillRect(0, size * 0.42, charW, Math.max(1, size * 0.06));
            }

            ctx.restore();

            charX += charW;
            if (isJustify && ch === ' ') charX += justifyGap;
        }
    }

    ctx.restore();
}

export const textEffect = {
    name: 'text',
    label: 'Text',
    pass: 'context',
    paramKeys: [
        'text', 'textFont', 'textSize', 'textBold', 'textItalic', 'textStrike', 'textLineHeight',
        'textColor', 'textBg',
        'textWrap', 'textAlign', 'textVAlign',
        'textTLx', 'textTLy', 'textTRx', 'textTRy',
        'textBRx', 'textBRy', 'textBLx', 'textBLy',
        'textOpacity', 'textNoiseSeed',
    ],
    handleParams: ['textTLx', 'textTLy', 'textTRx', 'textTRy', 'textBRx', 'textBRy', 'textBLx', 'textBLy'],
    params: {
        textEnabled:    { default: false },
        text:           { default: 'DEC 31 1999 11:59:59' },
        textFont:       { default: "'JetBrains Mono', monospace" },
        textSize:       { default: 128,  min: 8,   max: 1024 },
        textBold:       { default: false },
        textItalic:     { default: false },
        textStrike:     { default: false },
        textLineHeight: { default: 1.2, min: 0.5, max: 3, step: 0.1 },
        textColor:          { default: 'white' },
        textNoiseSeed:      { default: 0 },
        textNoiseRandomize: { default: null },
        textOpacity: { default: 1, min: 0, max: 1, step: 0.01 },
        textBg:         { default: 'none' },
        textWrap:       { default: true },
        textAlign:      { default: 'center' },
        textVAlign:     { default: 'middle' },
        // All 4 corners stored independently (% of canvas W/H).
        // TL, TR, BR, BL — each corner only controls itself.
        textTLx:        { default: 10 },
        textTLy:        { default: 65 },
        textTRx:        { default: 90 },
        textTRy:        { default: 65 },
        textBRx:        { default: 90 },
        textBRy:        { default: 95 },
        textBLx:        { default: 10 },
        textBLy:        { default: 95 },
        textBoxReset:   { default: null },
    },
    enabled: (p) => p.textEnabled && !!p.text,
    uiGroups: [
        { keys: ['text', 'textFont', 'textSize', 'textBold', 'textItalic', 'textStrike', 'textLineHeight'] },
        { label: 'Color', keys: ['textColor', 'textNoiseRandomize', 'textBg', 'textOpacity'] },
        { label: 'Layout', keys: ['textWrap', 'textAlign', 'textVAlign', 'textBoxReset'] },
    ],
    canvas2d: applyText,
};
