import { buildBlendControl } from './controls/index.js';

const blend = buildBlendControl('viewport');

const SHAPE_INT = { rectangle: 0, ellipse: 1, triangle: 2, polygon: 2, text: 3 };

const FONT_OPTIONS = [
    ["'JetBrains Mono', monospace",  'JetBrains Mono'],
    ['monospace',                    'Monospace'],
    ["'Courier New', monospace",     'Courier New'],
    ["'Arial', sans-serif",          'Arial'],
    ["'Georgia', serif",             'Georgia'],
    ["'Times New Roman', serif",     'Times New Roman'],
    ['neogreekrunic',                'neogreekrunic'],
    ['splitbitsv2',                  'splitbitsv2'],
    ['quadramatic',                  'quadramatic'],
    ['Regulon18-Regular',            'Regulon18'],
    ['amazingdigital100acrewoods',   'AmazingDigital100AcreWoods'],
];

// Rasterize vpText to fit the vp box, white-on-transparent, for use as a reveal
// mask texture. Mirrors the overlay's screen convention (y-down): the box geometry
// is baked into the mask so the shader only needs to sample alpha.
function buildTextMask(p, w, h) {
    const text = (p.vpText ?? '').trim();
    if (!text) return null;

    const cx = (0.5 + p.vpX / 100) * w;
    const cy = (0.5 - p.vpY / 100) * h;
    const boxW = (p.vpW / 100) * w;   // full width  (2 * hw)
    const boxH = (p.vpH / 100) * h;   // full height (2 * hh)
    if (boxW < 1 || boxH < 1) return null;

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const font = p.vpTextFont ?? "'JetBrains Mono', monospace";

    // Measure at a base size, then scale to fit the box in both axes (single line).
    const BASE = 100;
    ctx.font = `${BASE}px ${font}`;
    const metrics = ctx.measureText(text);
    const textW = metrics.width || 1;
    const fitW = boxW / textW;
    const fitH = boxH / BASE;
    const size = Math.max(1, BASE * Math.min(fitW, fitH));

    ctx.font = `${size}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, cx, cy);
    return canvas;
}

export const viewportEffect = {
    name: 'viewport',
    label: 'Viewport',
    kind: 'reveal',
    reveal: { enabledKey: 'vpEnabled', entryIdKey: 'vpEntryId', entryEffectName: 'viewportEntry' },
    autoEntry: { entryEffectName: 'viewportEntry', entryIdKey: 'vpEntryId' },
    paramKeys: ['vpX', 'vpY', 'vpW', 'vpH', ...blend.paramKeys],
    handleParams: [
        'vpX', 'vpY', 'vpW', 'vpH',
        'vpV0x',  'vpV0y',  'vpV1x',  'vpV1y',  'vpV2x',  'vpV2y',
        'vpV3x',  'vpV3y',  'vpV4x',  'vpV4y',  'vpV5x',  'vpV5y',
        'vpV6x',  'vpV6y',  'vpV7x',  'vpV7y',  'vpV8x',  'vpV8y',
        'vpV9x',  'vpV9y',  'vpV10x', 'vpV10y', 'vpV11x', 'vpV11y',
    ],
    params: {
        vpEnabled: { default: false, label: 'Enable' },
        vpShape:   { default: 'rectangle', label: 'Shape', options: [['rectangle', 'Rectangle'], ['ellipse', 'Ellipse'], ['triangle', 'Triangle'], ['polygon', 'Polygon'], ['text', 'Text']] },
        vpInvert:  { default: false, label: 'Invert' },
        vpText:    { default: 'BXTRXT', label: 'Text', maxLength: 16 },
        vpTextFont: { default: "'JetBrains Mono', monospace", label: 'Font', fontSelector: true, options: FONT_OPTIONS },
        vpX:       { default: 0  },
        vpY:       { default: 0  },
        vpW:       { default: 30 },
        vpH:       { default: 20 },
        vpSides:   { default: 6,   min: 3,   max: 12,  label: 'Sides' },
        vpV0x:  { default: 0 }, vpV0y:  { default: 0 },
        vpV1x:  { default: 0 }, vpV1y:  { default: 0 },
        vpV2x:  { default: 0 }, vpV2y:  { default: 0 },
        vpV3x:  { default: 0 }, vpV3y:  { default: 0 },
        vpV4x:  { default: 0 }, vpV4y:  { default: 0 },
        vpV5x:  { default: 0 }, vpV5y:  { default: 0 },
        vpV6x:  { default: 0 }, vpV6y:  { default: 0 },
        vpV7x:  { default: 0 }, vpV7y:  { default: 0 },
        vpV8x:  { default: 0 }, vpV8y:  { default: 0 },
        vpV9x:  { default: 0 }, vpV9y:  { default: 0 },
        vpV10x: { default: 0 }, vpV10y: { default: 0 },
        vpV11x: { default: 0 }, vpV11y: { default: 0 },
        ...blend.params,
    },
    uiGroups: (p) => [
        { keys: p.vpShape === 'polygon' ? ['vpShape', 'vpSides', 'vpInvert']
              : p.vpShape === 'text'    ? ['vpShape', 'vpText', 'vpTextFont', 'vpInvert']
              : ['vpShape', 'vpInvert'] },
        blend.uiGroup,
    ],
    enabled: (p) => p.vpEnabled,
    revealMask: (p, w, h) => (p.vpShape === 'text' ? buildTextMask(p, w, h) : null),
    glsl: `
uniform sampler2D uTexWindow;
uniform sampler2D uTexMask;
uniform float vpX;
uniform float vpY;
uniform float vpW;
uniform float vpH;
uniform float vpInvert;
uniform int   vpShape;
uniform int   vpNumVerts;
uniform vec2  vpVerts[12];
${blend.glsl}
bool inRect(vec2 uv) {
    vec2 c = vec2(0.5 + vpX / 100.0, 0.5 + vpY / 100.0);
    return abs(uv.x - c.x) < vpW / 200.0 && abs(uv.y - c.y) < vpH / 200.0;
}

bool inEllipse(vec2 uv) {
    vec2 c  = vec2(0.5 + vpX / 100.0, 0.5 + vpY / 100.0);
    float rx = vpW / 200.0;
    float ry = vpH / 200.0;
    vec2 d  = uv - c;
    return (d.x * d.x) / (rx * rx) + (d.y * d.y) / (ry * ry) < 1.0;
}

bool inPoly(vec2 uv) {
    bool inside = false;
    int j = vpNumVerts - 1;
    for (int i = 0; i < 12; i++) {
        if (i >= vpNumVerts) break;
        vec2 vi = vpVerts[i];
        vec2 vj = vpVerts[j];
        if ((vi.y > uv.y) != (vj.y > uv.y) &&
            uv.x < (vj.x - vi.x) * (uv.y - vi.y) / (vj.y - vi.y) + vi.x) {
            inside = !inside;
        }
        j = i;
    }
    return inside;
}

void main() {
    vec4 c = texture(uTex, vUV);
    bool inside;
    if      (vpShape == 0) inside = inRect(vUV);
    else if (vpShape == 1) inside = inEllipse(vUV);
    else if (vpShape == 3) inside = texture(uTexMask, vUV).a > 0.5;
    else                   inside = inPoly(vUV);

    if (vpInvert > 0.5) inside = !inside;

    vec3 adjusted = inside ? texture(uTexWindow, vUV).rgb : c.rgb;
    if (!${blend.thresholdFn}(c, vec4(adjusted, c.a))) { fragColor = c; return; }
    fragColor = vec4(${blend.blendFn}(c.rgb, adjusted), c.a);
}
`,

    bindUniforms(gl, prog, p) {
        if (prog._locs['vpShape']   != null) gl.uniform1i(prog._locs['vpShape'],   SHAPE_INT[p.vpShape] ?? 0);
        if (prog._locs['vpInvert']  != null) gl.uniform1f(prog._locs['vpInvert'],  p.vpInvert ? 1.0 : 0.0);

        let numVerts = 0;
        if (p.vpShape === 'triangle') numVerts = 3;
        else if (p.vpShape === 'polygon') numVerts = Math.max(3, Math.min(12, Math.round(p.vpSides)));
        if (prog._locs['vpNumVerts'] != null) gl.uniform1i(prog._locs['vpNumVerts'], numVerts);

        const verts = new Float32Array(24);
        for (let i = 0; i < 12; i++) {
            verts[i * 2]     = 0.5 + (p.vpX + (p[`vpV${i}x`] ?? 0)) / 100.0;
            verts[i * 2 + 1] = 0.5 + (p.vpY + (p[`vpV${i}y`] ?? 0)) / 100.0;
        }
        const vertsLoc = prog._locs['vpVerts[0]'];
        if (vertsLoc != null) gl.uniform2fv(vertsLoc, verts);

        blend.bindUniforms(gl, prog, p);
    },
};
