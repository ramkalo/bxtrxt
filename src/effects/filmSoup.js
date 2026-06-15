import { buildBlendControl } from './controls/index.js';

const blend = buildBlendControl('filmSoup');

const MAX_BUBBLES = 256; // max bubbles packed in the data texture (texture width)

// --- seeded RNG (same generator family as corrupted.js) ---
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function clampNum(v, lo, hi, def) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, n));
}

// --- bubble generation (CPU, cached) ---
const _gpuCache = { key: null, tex: null, count: 0 };

function filmSoupCacheKey(p, w, h) {
    const place = p.filmSoupPlace ?? 'generated';
    const parts = [w, h, place];
    if (place === 'manual') {
        parts.push(p.filmSoupBubbles ?? '[]', p.filmSoupSize, p.filmSoupSizeDev);
    } else {
        parts.push(p.filmSoupSeed, p.filmSoupSize, p.filmSoupSizeDev, p.filmSoupNum, p.filmSoupDistribution);
    }
    return parts.join('|');
}

function c255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

// Procedurally generate the bubble set. Returns [[cx, cy, r, ph, s], ...] where
// cx/cy are [0,1] UV, r is a fraction of height, ph is the irregularity phase seed,
// s is the per-bubble size-deviation factor [-1,1]. Bubbles live in a height-normalised
// space so circles stay round (x divided by aspect).
function generateBubbles(p, aspect) {
    const rng = mulberry32(clampNum(p.filmSoupSeed, 1, 99999, 42) | 0);
    const num   = clampNum(p.filmSoupNum, 1, MAX_BUBBLES, 8) | 0;
    const size  = clampNum(p.filmSoupSize, 1, 60, 14);
    const dev   = clampNum(p.filmSoupSizeDev, 0, 100, 30);
    const dist  = clampNum(p.filmSoupDistribution, -50, 50, 0) / 50; // -1 perimeter .. +1 center
    const baseR = (size / 100) * 0.5;
    const bubbles = [];

    for (let k = 0; k < num; k++) {
        let cx = rng();
        let cy = rng();
        // Bipolar distribution around the image (center offset applied later in shader):
        // +dist pulls toward the image centre (tight cluster); -dist pushes toward the
        // nearest image edge (perimeter ring); 0 = even.
        if (dist > 0) {
            const t = Math.min(dist, 0.92);
            cx += (0.5 - cx) * t;
            cy += (0.5 - cy) * t;
        } else if (dist < 0) {
            const t = -dist;
            const ex = cx < 0.5 ? 0.0 : 1.0;
            const ey = cy < 0.5 ? 0.0 : 1.0;
            if (Math.min(cx, 1 - cx) < Math.min(cy, 1 - cy)) cx += (ex - cx) * t;
            else                                             cy += (ey - cy) * t;
        }
        const s = (rng() - 0.5) * 2;   // per-bubble size-deviation factor [-1,1]
        const radius = Math.max(0.002, baseR * (1 + s * dev / 100));
        bubbles.push([cx, cy, radius, rng(), s]);
    }
    return bubbles;
}

// Manual bubbles are stored as JSON [{x, y, ph, s}, ...] (x/y in percent 0-100).
// Radius is computed at build time from the live Size / Size Deviation sliders.
function parseManualBubbles(json) {
    let arr;
    try { arr = JSON.parse(json || '[]'); } catch { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_BUBBLES).map(b => [
        (b.x ?? 50) / 100, (b.y ?? 50) / 100,
        b.ph ?? 0.5, typeof b.s === 'number' ? b.s : 0,
    ]);
}

// Seed a manual-bubble JSON list from the current procedural layout (used when the
// effect switches to manual placement, so editing starts from the bubbles you see).
export function seedManualBubbles(p) {
    return JSON.stringify(generateBubbles(p, 1).map(([cx, cy, r, ph, s]) => ({
        x: Math.round(cx * 100), y: Math.round(cy * 100), ph, s,
    })));
}

function generateBubbleTex(p, w, h) {
    const aspect = w / h;
    const data = new Uint8Array(MAX_BUBBLES * 4);

    const place = p.filmSoupPlace ?? 'generated';
    let bubbles;
    if (place === 'manual') {
        const size  = clampNum(p.filmSoupSize, 1, 60, 14);
        const dev   = clampNum(p.filmSoupSizeDev, 0, 100, 30);
        const baseR = (size / 100) * 0.5;
        bubbles = parseManualBubbles(p.filmSoupBubbles).map(([cx, cy, ph, s]) =>
            [cx, cy, Math.max(0.002, baseR * (1 + s * dev / 100)), ph]);
    } else {
        bubbles = generateBubbles(p, aspect);
    }

    const count = Math.min(MAX_BUBBLES, bubbles.length);
    for (let k = 0; k < count; k++) {
        const [cx, cy, r, ph] = bubbles[k];
        const idx = k * 4;
        data[idx]     = c255(cx * 255);
        data[idx + 1] = c255(cy * 255);
        data[idx + 2] = c255(r * 255);   // radius as fraction of height (0..1)
        data[idx + 3] = c255(ph * 255);  // irregularity phase seed
    }
    return { data, count };
}

function filmSoupBindUniforms(gl, prog, p, dstW, dstH) {
    const locs = prog._locs;
    const setI = (k, v) => { if (locs[k] != null) gl.uniform1i(locs[k], v); };
    const setF = (k, v) => { if (locs[k] != null) gl.uniform1f(locs[k], v); };

    // (Re)generate the bubble data texture only when generation params change.
    const key = filmSoupCacheKey(p, dstW, dstH);
    if (key !== _gpuCache.key || !_gpuCache.tex) {
        if (_gpuCache.tex) { gl.deleteTexture(_gpuCache.tex); _gpuCache.tex = null; }
        const { data, count } = generateBubbleTex(p, dstW, dstH);
        gl.activeTexture(gl.TEXTURE3);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MAX_BUBBLES, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        _gpuCache.tex = tex;
        _gpuCache.count = count;
        _gpuCache.key = key;
    }

    // Bubble data on TEXTURE3 (0 = full/outside, 1 = window, 2 = blend map).
    if (locs['uBubbleTex'] != null) {
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, _gpuCache.tex);
        gl.uniform1i(locs['uBubbleTex'], 3);
    }

    setF('uAspect', dstW / dstH);
    setI('fsBubCount', _gpuCache.count);
    setF('fsEdgeSoft', clampNum(p.filmSoupEdgeSoft, 0, 100, 35) / 100);
    setF('fsIrregular', clampNum(p.filmSoupIrregular, 0, 100, 25) / 100);
    setF('fsElongate', clampNum(p.filmSoupElongate, 0, 100, 0) / 100);
    setI('fsMeltSide', (p.filmSoupMeltSide ?? 'inside') === 'outside' ? 1 : 0);

    // Center handle = global offset applied to all bubbles (top-down space).
    setF('fsCenterX', clampNum(p.filmSoupCenterX, -50, 50, 0) / 100);
    setF('fsCenterY', clampNum(p.filmSoupCenterY, -50, 50, 0) / 100);

    setF('fsVigBright', clampNum(p.filmSoupVigBright, -50, 50, 0) / 50);
    setF('fsVigFeather', clampNum(p.filmSoupVigFeather, 0, 100, 30) / 100);
    setI('fsVigInside', p.filmSoupVigInside ? 1 : 0);
    setI('fsVigOutside', p.filmSoupVigOutside ? 1 : 0);

    blend.bindUniforms(gl, prog, p);
}

export default {
    name:  'filmSoup',
    label: 'Film Soup',
    kind:  'reveal',
    reveal:    { enabledKey: 'filmSoupEnabled', entryIdKey: 'filmSoupMeltId', entryEffectName: 'filmSoupMelt' },
    autoEntry: { entryEffectName: 'filmSoupMelt', entryIdKey: 'filmSoupMeltId' },
    paramKeys: [...blend.paramKeys],
    uiGroups: (p) => {
        const manual = (p.filmSoupPlace ?? 'generated') === 'manual';

        const keys = ['filmSoupPlace', 'filmSoupSize', 'filmSoupSizeDev'];
        if (!manual) keys.push('filmSoupNum', 'filmSoupDistribution');
        keys.push('filmSoupElongate', 'filmSoupIrregular', 'filmSoupMeltSide', 'filmSoupEdgeSoft');
        if (!manual) keys.push('filmSoupSeed', 'filmSoupRegen');

        return [
            { keys },
            { label: 'Bubble Vignette', keys: ['filmSoupVigBright', 'filmSoupVigFeather', 'filmSoupVigInside', 'filmSoupVigOutside'] },
            blend.uiGroup,
        ];
    },
    params: {
        filmSoupEnabled:   { default: false, label: 'Enable' },
        filmSoupPlace:     { default: 'generated', label: 'Placement', options: [['generated', 'Generated'], ['manual', 'Manual (drag on canvas)']] },
        filmSoupBubbles:   { default: '[]', hidden: true },
        filmSoupSize:      { default: 14, min: 1, max: 60, label: 'Bubble Size' },
        filmSoupSizeDev:   { default: 30, min: 0, max: 100, label: 'Size Deviation' },
        filmSoupNum:       { default: 8, min: 1, max: MAX_BUBBLES, label: 'Number of Bubbles' },
        filmSoupDistribution: { default: 0, min: -50, max: 50, label: 'Distribution (Perimeter ↔ Center)' },
        filmSoupElongate:  { default: 0, min: 0, max: 100, label: 'Elongate' },
        filmSoupCenterX:   { default: 0, min: -50, max: 50, hidden: true },
        filmSoupCenterY:   { default: 0, min: -50, max: 50, hidden: true },
        filmSoupIrregular: { default: 25, min: 0, max: 100, label: 'Irregularity' },
        filmSoupMeltSide:  { default: 'inside', label: 'Melt', options: [['inside', 'Inside Bubbles'], ['outside', 'Outside Bubbles']] },
        filmSoupEdgeSoft:  { default: 35, min: 0, max: 100, label: 'Edge Softness' },
        filmSoupSeed:      { default: 42, min: 1, max: 99999, label: 'Seed' },
        filmSoupRegen:     { default: false, label: 'Regenerate Bubbles', button: 'filmSoupSeed' },
        filmSoupVigBright:  { default: 0, min: -50, max: 50, label: 'Vignette Brightness' },
        filmSoupVigFeather: { default: 30, min: 0, max: 100, label: 'Vignette Feather' },
        filmSoupVigInside:  { default: false, label: 'Vignette Inside Edge' },
        filmSoupVigOutside: { default: false, label: 'Vignette Outside Edge' },
        ...blend.params,
    },
    enabled: (p) => p.filmSoupEnabled,
    // When switching to Manual placement, seed the editable bubble list from the current
    // procedural layout — only if empty, so we never clobber hand-placed bubbles.
    paramActions: {
        filmSoupPlace: (val, params) => {
            if (val !== 'manual') return {};
            const existing = params.filmSoupBubbles;
            if (existing && existing !== '[]') return {};
            return { filmSoupBubbles: seedManualBubbles(params) };
        },
    },
    bindUniforms: filmSoupBindUniforms,
    glsl: `
const int MAX_BUBBLES = ${MAX_BUBBLES};

uniform sampler2D uTexWindow;   // pipeline state at the melt point (revealed inside bubbles)
uniform sampler2D uBubbleTex;
uniform float uAspect;
uniform int   fsBubCount;
uniform float fsEdgeSoft;
uniform float fsIrregular;
uniform float fsElongate;   // 0..1
uniform int   fsMeltSide;
uniform float fsCenterX;     // global bubble offset (top-down UV fraction)
uniform float fsCenterY;

uniform float fsVigBright;   // -1..1
uniform float fsVigFeather;  // 0..1
uniform int   fsVigInside;
uniform int   fsVigOutside;

${blend.glsl}

float fsHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Coverage of the bubble set at uv (1 = fully revealed). md = signed dist to nearest edge
// (negative inside a bubble), computed before the melt-side invert so the vignette stays
// keyed to the geometric bubble perimeter.
float fsBubbleMask(vec2 uv, out float mdOut) {
    float md = 1e9;
    // Bubble centres are stored top-down (y=0 at top) to match the canvas overlay,
    // so flip vUV.y which is bottom-up.
    vec2 puv = vec2(uv.x, 1.0 - uv.y);
    vec2 ctr = vec2(fsCenterX, fsCenterY);
    float elong = 1.0 + fsElongate * 1.5;
    for (int k = 0; k < MAX_BUBBLES; k++) {
        if (k >= fsBubCount) break;
        vec4 b = texelFetch(uBubbleTex, ivec2(k, 0), 0);
        vec2 d = puv - (b.xy + ctr);
        d.x *= uAspect;
        float L = length(d);
        // Cheap early-out: a conservative lower bound on this bubble's exact signed
        // distance. Elongation only shrinks length (>= L/elong); the wobble can grow the
        // radius up to ~0.77*irr. If even that bound can't beat the running nearest, this
        // bubble is irrelevant to the mask — skip all the trig. Most bubbles are far from
        // any given pixel, so this is the dominant speedup at high bubble counts.
        if (L / elong - b.z * (1.0 + 0.77 * fsIrregular) > md) continue;
        float ang = atan(d.y, d.x);
        // Soap-bubble outline: sum of low harmonics with per-bubble random amplitude +
        // phase, decaying by 1/n so curves stay smooth & rounded.
        float wob = 0.0;
        for (int n = 2; n <= 5; n++) {
            float fn  = float(n);
            float amp = fsHash(vec2(b.w, fn)) * 2.0 - 1.0;
            float ph  = fsHash(vec2(b.w, fn + 11.3)) * 6.2831853;
            wob += amp * sin(fn * ang + ph) / fn;
        }
        float radius = max(b.z * (1.0 + fsIrregular * 0.6 * wob), b.z * 0.1);
        // Elongate: stretch the distance metric along each bubble's own random axis so
        // it extends in one direction (radius wobble still keyed to the unrotated angle).
        float ea = fsHash(vec2(b.w, 7.3)) * 6.2831853;
        float ce = cos(ea), se = sin(ea);
        vec2 dr = vec2(ce * d.x + se * d.y, -se * d.x + ce * d.y);
        dr.x /= elong;
        md = min(md, length(dr) - radius);
    }
    mdOut = md;
    float fw = mix(0.0015, 0.09, fsEdgeSoft);
    float inside = 1.0 - smoothstep(-fw, fw, md);
    if (fsMeltSide == 1) inside = 1.0 - inside;
    return inside;
}

void main() {
    vec3 full = texture(uTex, vUV).rgb;        // outside / fully processed
    vec3 melt = texture(uTexWindow, vUV).rgb;  // melt-point state (revealed)

    float md;
    float mask = fsBubbleMask(vUV, md);
    vec3 revealed = mix(full, melt, mask);

    // Per-bubble rim vignette (brightness band hugging the perimeter)
    float bw = max(mix(0.0, 0.15, fsVigFeather), 1e-4);
    float band = 0.0;
    if (fsVigInside  == 1 && md <= 0.0) band = max(band, smoothstep(-bw, 0.0, md));
    if (fsVigOutside == 1 && md >  0.0) band = max(band, 1.0 - smoothstep(0.0, bw, md));
    revealed = clamp(revealed * (1.0 + fsVigBright * band), 0.0, 1.0);

    vec4 c = vec4(full, texture(uTex, vUV).a);
    if (!${blend.thresholdFn}(c, vec4(revealed, c.a))) { fragColor = c; return; }
    fragColor = vec4(${blend.blendFn}(c.rgb, revealed), c.a);
}
`,
};
