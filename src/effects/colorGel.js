import { buildFadeControl, buildBlendControl } from './controls/index.js';
import { resolveColorKey, STANDARD_COLOR_OPTIONS } from './colorOptions.js';

const fade  = buildFadeControl('colorGel');
const blend = buildBlendControl('colorGel');

function hexToRgb01(hex) {
    const n = parseInt((hex || '#ffffff').replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Resolve a palette-key (or legacy literal hex) to rgb01 against the active palette.
function gelRgb(key, palette, fallback) {
    return hexToRgb01(resolveColorKey(key, palette) ?? fallback);
}

function clampNum(v, lo, hi, def) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, n));
}

function clampIntStr(v, lo, hi, def) {
    const n = parseInt(v);
    if (!isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, n));
}

function colorGelBindUniforms(gl, prog, p) {
    const locs = prog._locs;
    const setI  = (k, v) => { if (locs[k] != null) gl.uniform1i(locs[k], v); };
    const setF  = (k, v) => { if (locs[k] != null) gl.uniform1f(locs[k], v); };
    const set3v = (k, a) => { if (locs[k] != null) gl.uniform3fv(locs[k], a); };
    const set1v = (k, a) => { if (locs[k] != null) gl.uniform1fv(locs[k], a); };

    const mode  = (p.colorGelMode ?? 'solid') === 'gradient' ? 1 : 0;
    const stops = clampIntStr(p.colorGelGradStops, 2, 4, 2);
    setI('cgMode', mode);
    setI('cgStops', stops);
    setF('cgOpacity', clampNum(p.colorGelOpacity, 0, 100, 60) / 100);
    setF('cgAngle', clampNum(p.colorGelGradAngle, -180, 180, 45) * Math.PI / 180);
    // Transition half-width: 0 → sharp edge, 100 → very gradual slope.
    setF('cgSoft', (clampNum(p.colorGelGradSoftness, 0, 100, 50) / 100) * 0.5);

    const pal = p._activePalette;
    const colors = new Float32Array(12);
    colors.set(gelRgb(p.colorGelColor,  pal, '#ff3b3b'), 0);
    colors.set(gelRgb(p.colorGelColor2, pal, '#ffd000'), 3);
    colors.set(gelRgb(p.colorGelColor3, pal, '#1e90ff'), 6);
    colors.set(gelRgb(p.colorGelColor4, pal, '#a020f0'), 9);
    set3v('cgColors[0]', colors);

    // Per-transition anchor points (uv). X/Y are 0-100 with Y top-down (like
    // Line Drag), so uv.y = 1 - Y/100. The shader uses the perpendicular distance
    // from each anchor along the gradient normal, so the dashed overlay line
    // always coincides with the actual color transition.
    const ax = new Float32Array(3), ay = new Float32Array(3);
    for (let i = 0; i < 3; i++) {
        ax[i] =     clampNum(p[`colorGelT${i + 1}X`], 0, 100, 50) / 100;
        ay[i] = 1 - clampNum(p[`colorGelT${i + 1}Y`], 0, 100, 50) / 100;
    }
    set1v('cgAnchorX[0]', ax);
    set1v('cgAnchorY[0]', ay);

    fade.bindUniforms(gl, prog, p);
    blend.bindUniforms(gl, prog, p);
}

export default {
    name:  'colorGel',
    label: 'Color Gel',
    kind:  'glsl',
    // Angle + transition anchors are driven by the canvas overlay (dashed lines
    // + rotation handle), so they're hidden from the controls panel.
    handleParams: ['colorGelGradAngle',
        'colorGelT1X', 'colorGelT1Y', 'colorGelT2X', 'colorGelT2Y', 'colorGelT3X', 'colorGelT3Y',
        ...fade.handleParams],
    overlays: {},
    paramKeys: [...fade.paramKeys, ...blend.paramKeys],
    uiGroups: (p) => {
        const keys = ['colorGelMode', 'colorGelOpacity', 'colorGelColor'];
        if ((p.colorGelMode ?? 'solid') === 'gradient') {
            const n = clampIntStr(p.colorGelGradStops, 2, 4, 2);
            keys.push('colorGelGradStops', 'colorGelColor2');
            if (n >= 3) keys.push('colorGelColor3');
            if (n >= 4) keys.push('colorGelColor4');
            keys.push('colorGelGradSoftness');
        }
        return [{ keys }, blend.uiGroup, fade.uiGroup];
    },
    // When the zone count changes, space the transition anchors evenly along the
    // gradient axis (through the image center) at the current angle.
    paramActions: {
        colorGelGradStops: (val, params) => {
            const n = Math.max(2, Math.min(4, parseInt(val) || 2));
            const a = (params.colorGelGradAngle ?? 45) * Math.PI / 180;
            const dx = Math.cos(a), dy = Math.sin(a);
            const u = {};
            for (let i = 0; i < 3; i++) {
                const off = (i + 1) / n - 0.5;       // -0.5..0.5 along the axis
                const ux = 0.5 + off * dx;           // uv (y up)
                const uy = 0.5 + off * dy;
                u[`colorGelT${i + 1}X`] = Math.round(ux * 1000) / 10;       // 0-100
                u[`colorGelT${i + 1}Y`] = Math.round((1 - uy) * 1000) / 10; // 0-100, top-down
            }
            return u;
        },
    },
    params: {
        colorGelEnabled:   { default: false, label: 'Enable' },
        colorGelMode:      { default: 'solid', label: 'Mode', options: [['solid', 'Solid'], ['gradient', 'Gradient']] },
        colorGelOpacity:   { default: 60, min: 0, max: 100, label: 'Opacity' },
        colorGelColor:     { default: 'palette0', type: 'paletteSelect', options: STANDARD_COLOR_OPTIONS, label: 'Color' },
        colorGelGradStops: { default: '2', label: 'Color Zones', options: [['2', '2 Colors'], ['3', '3 Colors'], ['4', '4 Colors']] },
        colorGelColor2:    { default: 'palette1', type: 'paletteSelect', options: STANDARD_COLOR_OPTIONS, label: 'Color 2' },
        colorGelColor3:    { default: 'palette2', type: 'paletteSelect', options: STANDARD_COLOR_OPTIONS, label: 'Color 3' },
        colorGelColor4:    { default: 'palette3', type: 'paletteSelect', options: STANDARD_COLOR_OPTIONS, label: 'Color 4' },
        colorGelT1X:       { default: 50, min: 0, max: 100, label: 'Transition 1 X' },
        colorGelT1Y:       { default: 50, min: 0, max: 100, label: 'Transition 1 Y' },
        colorGelT2X:       { default: 50, min: 0, max: 100, label: 'Transition 2 X' },
        colorGelT2Y:       { default: 50, min: 0, max: 100, label: 'Transition 2 Y' },
        colorGelT3X:       { default: 50, min: 0, max: 100, label: 'Transition 3 X' },
        colorGelT3Y:       { default: 50, min: 0, max: 100, label: 'Transition 3 Y' },
        colorGelGradSoftness: { default: 50, min: 0, max: 100, label: 'Transition Softness' },
        colorGelGradAngle: { default: 45, min: -180, max: 180, label: 'Angle' },
        ...fade.params,
        ...blend.params,
    },
    enabled: (p) => p.colorGelEnabled,
    bindUniforms: colorGelBindUniforms,
    glsl: `
uniform int   cgMode;
uniform float cgOpacity;
uniform int   cgStops;
uniform float cgAngle;
uniform vec3  cgColors[4];
uniform float cgAnchorX[3];
uniform float cgAnchorY[3];
uniform float cgSoft;

${fade.glsl}
${blend.glsl}

vec3 colorGelColorAt(vec2 uv) {
    if (cgMode == 0) return cgColors[0];
    // Gradient normal; each transition is the line through its anchor
    // perpendicular to this direction. s = signed perpendicular distance.
    vec2 n = vec2(cos(cgAngle), sin(cgAngle));
    vec3 col = cgColors[0];
    float soft = max(1e-4, cgSoft);
    for (int i = 0; i < 3; i++) {
        if (i >= cgStops - 1) break;
        vec2 a = vec2(cgAnchorX[i], cgAnchorY[i]);
        float s = dot(uv - a, n);
        float w = smoothstep(-soft, soft, s);
        col = mix(col, cgColors[i + 1], w);
    }
    return col;
}

void main() {
    vec4 c = texture(uTex, vUV);
    vec3 gel = colorGelColorAt(vUV);
    vec3 tinted = mix(c.rgb, gel, cgOpacity);
    float w = ${fade.fnName}();
    vec3 faded = mix(c.rgb, tinted, w);
    if (!${blend.thresholdFn}(c, vec4(faded, c.a))) { fragColor = c; return; }
    fragColor = vec4(${blend.blendFn}(c.rgb, faded), c.a);
}
`,
};
