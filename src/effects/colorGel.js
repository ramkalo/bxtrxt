import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('colorGel');
const blend = buildBlendControl('colorGel');

function hexToRgb01(hex) {
    const n = parseInt((hex || '#ffffff').replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
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

    const mode  = (p.colorGelMode ?? 'solid') === 'gradient' ? 1 : 0;
    const stops = clampIntStr(p.colorGelGradStops, 2, 3, 2);
    setI('cgMode', mode);
    setI('cgStops', stops);
    setF('cgOpacity', clampNum(p.colorGelOpacity, 0, 100, 60) / 100);
    setF('cgAngle', clampNum(p.colorGelGradAngle, -180, 180, 45) * Math.PI / 180);
    setF('cgMid', clampNum(p.colorGelGradMid, 1, 99, 50) / 100);

    const colors = new Float32Array(9);
    colors.set(hexToRgb01(p.colorGelColor  ?? '#ff3b3b'), 0);
    colors.set(hexToRgb01(p.colorGelColor2 ?? '#ffd000'), 3);
    colors.set(hexToRgb01(p.colorGelColor3 ?? '#1e90ff'), 6);
    set3v('cgColors[0]', colors);

    fade.bindUniforms(gl, prog, p);
    blend.bindUniforms(gl, prog, p);
}

export default {
    name:  'colorGel',
    label: 'Color Gel',
    pass:  'pre-crt',
    handleParams: [...fade.handleParams],
    overlays: { fade: fade.overlay },
    paramKeys: [...fade.paramKeys, ...blend.paramKeys],
    uiGroups: (p) => {
        const keys = ['colorGelMode', 'colorGelOpacity', 'colorGelColor'];
        if ((p.colorGelMode ?? 'solid') === 'gradient') {
            keys.push('colorGelGradStops', 'colorGelColor2');
            if (clampIntStr(p.colorGelGradStops, 2, 3, 2) >= 3) {
                keys.push('colorGelGradMid', 'colorGelColor3');
            }
            keys.push('colorGelGradAngle');
        }
        return [{ keys }, blend.uiGroup, fade.uiGroup];
    },
    params: {
        colorGelEnabled:   { default: false, label: 'Enable' },
        colorGelMode:      { default: 'solid', label: 'Mode', options: [['solid', 'Solid'], ['gradient', 'Gradient']] },
        colorGelOpacity:   { default: 60, min: 0, max: 100, label: 'Opacity' },
        colorGelColor:     { default: '#ff3b3b', type: 'color', label: 'Color' },
        colorGelGradStops: { default: '2', label: 'Gradient Stops', options: [['2', '2 Colors'], ['3', '3 Colors']] },
        colorGelColor2:    { default: '#ffd000', type: 'color', label: 'Color 2' },
        colorGelGradMid:   { default: 50, min: 1, max: 99, label: 'Middle Position' },
        colorGelColor3:    { default: '#1e90ff', type: 'color', label: 'Color 3' },
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
uniform vec3  cgColors[3];
uniform float cgMid;

${fade.glsl}
${blend.glsl}

vec3 colorGelColorAt(vec2 uv) {
    if (cgMode == 0) return cgColors[0];
    vec2 dir = vec2(cos(cgAngle), sin(cgAngle));
    float t = clamp(dot(uv - 0.5, dir) + 0.5, 0.0, 1.0);
    if (cgStops < 3) return mix(cgColors[0], cgColors[1], t);
    if (t < cgMid) return mix(cgColors[0], cgColors[1], clamp(t / max(cgMid, 1e-4), 0.0, 1.0));
    return mix(cgColors[1], cgColors[2], clamp((t - cgMid) / max(1.0 - cgMid, 1e-4), 0.0, 1.0));
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
