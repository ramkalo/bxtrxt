import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('invert');
const blend = buildBlendControl('invert');

// Palette-only options. Keys are p0..p7 (resolved against the active palette in
// both the renderer and the swatch control).
const COLOR_OPTIONS = [
    ['p0', 'Color Palette 1'], ['p1', 'Color Palette 2'], ['p2', 'Color Palette 3'], ['p3', 'Color Palette 4'],
    ['p4', 'Color Palette 5'], ['p5', 'Color Palette 6'], ['p6', 'Color Palette 7'], ['p7', 'Color Palette 8'],
];
// Optional stops (C/D/E) can also be turned off.
const COLOR_OPTIONS_OPT = [['none', 'None'], ...COLOR_OPTIONS];

export default {
    name: 'colorRemap',
    label: 'Color Remap',
    kind: 'glsl',
    paramKeys: ['invertMode', 'invertColorA', 'invertColorB', 'invertColorC', 'invertColorD', 'invertColorE', ...fade.paramKeys, ...blend.paramKeys],
    handleParams: ['invertPosA', 'invertPosB', 'invertPosC', 'invertPosD', 'invertPosE', ...fade.handleParams],
    uiGroups: (p) => {
        const mode = p.invertMode ?? 'luminance';
        const isHue    = mode === 'hue';
        const isSimple = mode === 'simple';
        const colorLabels = isHue
            ? { invertColorA: 'Hue Start', invertColorC: 'Hue Low', invertColorD: 'Hue Mid',
                invertColorE: 'Hue High',  invertColorB: 'Hue End' }
            : { invertColorA: 'Shadows',   invertColorC: 'Dark Mid', invertColorD: 'Mid',
                invertColorE: 'Light Mid', invertColorB: 'Highlights' };
        const groups = [{ keys: ['invertMode'] }];
        if (!isSimple) {
            groups.push({
                keys: ['invertColorA', 'invertColorC', 'invertColorD', 'invertColorE', 'invertColorB'],
                labels: colorLabels,
            });
        }
        groups.push(fade.uiGroup, blend.uiGroup);
        return groups;
    },
    params: {
        invertEnabled:   { default: false, label: 'Enable' },
        invertMode:      { default: 'simple', label: 'Mode', options: [['luminance', 'Luminance Remap'], ['hue', 'Hue Remap'], ['simple', 'Simple Invert']] },
        invertColorA:    { default: 'p0',   label: 'Shadows',    type: 'paletteSelect', options: COLOR_OPTIONS },
        invertColorB:    { default: 'p7',   label: 'Highlights', type: 'paletteSelect', options: COLOR_OPTIONS },
        invertColorC:    { default: 'none', label: 'Dark Mid',   type: 'paletteSelect', options: COLOR_OPTIONS_OPT },
        invertColorD:    { default: 'none', label: 'Mid',        type: 'paletteSelect', options: COLOR_OPTIONS_OPT },
        invertColorE:    { default: 'none', label: 'Light Mid',  type: 'paletteSelect', options: COLOR_OPTIONS_OPT },
        invertPosA:      { default: 0    },
        invertPosC:      { default: 0.25 },
        invertPosD:      { default: 0.5  },
        invertPosE:      { default: 0.75 },
        invertPosB:      { default: 1    },
        ...fade.params,
        ...blend.params,
    },
    enabled: (p) => p.invertEnabled,
    overlays: { fade: fade.overlay },
    bindUniforms: (gl, prog, p) => {
        const colorVec = {
            r: [1,0,0], g: [0,1,0], b: [0,0,1],
            c: [0,1,1], y: [1,1,0], m: [1,0,1],
            bk: [0,0,0], w: [1,1,1],
        };
        const hexToRgb = (hex) => {
            const h = hex.replace('#', '');
            return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
        };
        const resolveColor = (key, fallback) => {
            if (colorVec[key]) return colorVec[key];
            if (key?.startsWith('p') && p._activePalette) {
                const hex = p._activePalette[parseInt(key.slice(1))];
                if (hex) return hexToRgb(hex);
            }
            return fallback;
        };

        const modeMap = { luminance: 0, hue: 1, simple: 2 };
        const modeLoc = prog._locs['invertMode'];
        if (modeLoc != null) gl.uniform1i(modeLoc, modeMap[p.invertMode ?? 'luminance'] ?? 0);

        // Pack active stops in gradient order (A, [C], [D], [E], B)
        const stops = [resolveColor(p.invertColorA, [1,1,1])];
        const poses = [p.invertPosA ?? 0];
        if (p.invertColorC !== 'none') { stops.push(resolveColor(p.invertColorC, [0,0,0])); poses.push(p.invertPosC ?? 0.25); }
        if (p.invertColorD !== 'none') { stops.push(resolveColor(p.invertColorD, [0,0,0])); poses.push(p.invertPosD ?? 0.5);  }
        if (p.invertColorE !== 'none') { stops.push(resolveColor(p.invertColorE, [0,0,0])); poses.push(p.invertPosE ?? 0.75); }
        stops.push(resolveColor(p.invertColorB, [0,0,0]));
        poses.push(p.invertPosB ?? 1);

        const countLoc = prog._locs['invertStopCount'];
        if (countLoc != null) gl.uniform1i(countLoc, stops.length);
        for (let i = 0; i < 5; i++) {
            const sLoc = prog._locs[`invertStop${i}`];
            const pLoc = prog._locs[`invertStopPos${i}`];
            if (sLoc != null) gl.uniform3f(sLoc, ...(stops[i] ?? [0,0,0]));
            if (pLoc != null) gl.uniform1f(pLoc,   poses[i] ?? 1);
        }

        fade.bindUniforms(gl, prog, p);
        blend.bindUniforms(gl, prog, p);
    },
    glsl: `
uniform int   invertMode;
uniform int   invertStopCount;
uniform vec3  invertStop0;
uniform vec3  invertStop1;
uniform vec3  invertStop2;
uniform vec3  invertStop3;
uniform vec3  invertStop4;
uniform float invertStopPos0;
uniform float invertStopPos1;
uniform float invertStopPos2;
uniform float invertStopPos3;
uniform float invertStopPos4;
${fade.glsl}
${blend.glsl}
float invertGetHue(vec3 col) {
    float maxC = max(col.r, max(col.g, col.b));
    float minC = min(col.r, min(col.g, col.b));
    float delta = maxC - minC;
    if (delta < 0.0001) return 0.0;
    float h;
    if (maxC == col.r)      h = mod((col.g - col.b) / delta, 6.0) / 6.0;
    else if (maxC == col.g) h = ((col.b - col.r) / delta + 2.0) / 6.0;
    else                    h = ((col.r - col.g) / delta + 4.0) / 6.0;
    return h < 0.0 ? h + 1.0 : h;
}
void main() {
    vec4 c = texture(uTex, vUV);
    vec3 adjusted;
    if (invertMode == 2) {
        adjusted = vec3(1.0 - c.r, 1.0 - c.g, 1.0 - c.b);
    } else {
        float val = (invertMode == 1) ? invertGetHue(c.rgb)
                                      : (0.299*c.r + 0.587*c.g + 0.114*c.b);
        int seg = 0;
        if (invertStopCount > 1 && val >= invertStopPos1) seg = 1;
        if (invertStopCount > 2 && val >= invertStopPos2) seg = 2;
        if (invertStopCount > 3 && val >= invertStopPos3) seg = 3;
        if (invertStopCount > 4 && val >= invertStopPos4) seg = 4;
        seg = min(seg, invertStopCount - 2);
        float plo = seg==0 ? invertStopPos0 : seg==1 ? invertStopPos1 : seg==2 ? invertStopPos2 : invertStopPos3;
        float phi = seg==0 ? invertStopPos1 : seg==1 ? invertStopPos2 : seg==2 ? invertStopPos3 : invertStopPos4;
        vec3  clo = seg==0 ? invertStop0 : seg==1 ? invertStop1 : seg==2 ? invertStop2 : invertStop3;
        vec3  chi = seg==0 ? invertStop1 : seg==1 ? invertStop2 : seg==2 ? invertStop3 : invertStop4;
        adjusted = mix(clo, chi, clamp((val - plo) / max(phi - plo, 0.0001), 0.0, 1.0));
    }
    float weight = ${fade.fnName}();
    vec3 faded = mix(c.rgb, adjusted, weight);
    if (!${blend.thresholdFn}(c, vec4(faded, c.a))) { fragColor = c; return; }
    fragColor = vec4(${blend.blendFn}(c.rgb, faded), c.a);
}
`,
};
