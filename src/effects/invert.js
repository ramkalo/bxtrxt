import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('invert');
const blend = buildBlendControl('invert');

const COLOR_OPTIONS = [
    ['r',  'Red'], ['g',  'Green'], ['b',  'Blue'],
    ['c',  'Cyan'], ['y',  'Yellow'], ['m',  'Magenta'],
    ['w',  'White'], ['bk', 'Black'],
    ['p0', 'Palette 1'], ['p1', 'Palette 2'], ['p2', 'Palette 3'], ['p3', 'Palette 4'],
    ['p4', 'Palette 5'], ['p5', 'Palette 6'], ['p6', 'Palette 7'], ['p7', 'Palette 8'],
];

export default {
    name: 'invert',
    label: 'Invert',
    pass: 'pre-crt',
    paramKeys: ['invertColorA', 'invertColorB', 'invertColorC', 'invertColorD', 'invertColorE', ...fade.paramKeys, ...blend.paramKeys],
    handleParams: ['invertPosA', 'invertPosB', 'invertPosC', 'invertPosD', 'invertPosE', ...fade.handleParams],
    uiGroups: [
        { keys: ['invertColorA', 'invertColorB', 'invertColorC', 'invertColorD', 'invertColorE'] },
        fade.uiGroup,
        blend.uiGroup,
    ],
    params: {
        invertEnabled:   { default: false, label: 'Enable' },
        invertColorA:    { default: 'all', label: 'Shadows', options: [['all', 'All Colors'], ...COLOR_OPTIONS] },
        invertColorB:    { default: 'bk',  label: 'Highlights', options: COLOR_OPTIONS },
        invertColorC:    { default: 'none', label: 'Mid 1', options: COLOR_OPTIONS },
        invertColorD:    { default: 'none', label: 'Mid 2', options: COLOR_OPTIONS },
        invertColorE:    { default: 'none', label: 'Mid 3', options: COLOR_OPTIONS },
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

        const isAll = p.invertColorA === 'all';
        const allLoc = prog._locs['invertAllColors'];
        if (allLoc != null) gl.uniform1i(allLoc, isAll ? 1 : 0);

        // Pack active stops and their positions in luminance order (A, [C], [D], [E], B)
        const stops = [resolveColor(p.invertColorA, [0,0,0])];
        const poses = [p.invertPosA ?? 0];
        if (p.invertColorC !== 'none') { stops.push(resolveColor(p.invertColorC, [0,0,0])); poses.push(p.invertPosC ?? 0.25); }
        if (p.invertColorD !== 'none') { stops.push(resolveColor(p.invertColorD, [0,0,0])); poses.push(p.invertPosD ?? 0.5);  }
        if (p.invertColorE !== 'none') { stops.push(resolveColor(p.invertColorE, [0,0,0])); poses.push(p.invertPosE ?? 0.75); }
        stops.push(resolveColor(p.invertColorB, [1,1,1]));
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
uniform int   invertAllColors;
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
void main() {
    vec4 c = texture(uTex, vUV);
    float lum = 0.299*c.r + 0.587*c.g + 0.114*c.b;
    vec3 adjusted;
    if (invertAllColors == 1) {
        adjusted = vec3(1.0 - c.r, 1.0 - c.g, 1.0 - c.b);
    } else {
        int seg = 0;
        if (invertStopCount > 1 && lum >= invertStopPos1) seg = 1;
        if (invertStopCount > 2 && lum >= invertStopPos2) seg = 2;
        if (invertStopCount > 3 && lum >= invertStopPos3) seg = 3;
        if (invertStopCount > 4 && lum >= invertStopPos4) seg = 4;
        seg = min(seg, invertStopCount - 2);
        float plo = seg==0 ? invertStopPos0 : seg==1 ? invertStopPos1 : seg==2 ? invertStopPos2 : invertStopPos3;
        float phi = seg==0 ? invertStopPos1 : seg==1 ? invertStopPos2 : seg==2 ? invertStopPos3 : invertStopPos4;
        vec3  clo = seg==0 ? invertStop0 : seg==1 ? invertStop1 : seg==2 ? invertStop2 : invertStop3;
        vec3  chi = seg==0 ? invertStop1 : seg==1 ? invertStop2 : seg==2 ? invertStop3 : invertStop4;
        adjusted = mix(clo, chi, clamp((lum - plo) / max(phi - plo, 0.0001), 0.0, 1.0));
    }
    float weight = ${fade.fnName}();
    vec3 faded = mix(c.rgb, adjusted, weight);
    if (!${blend.thresholdFn}(c, vec4(faded, c.a))) { fragColor = c; return; }
    fragColor = vec4(${blend.blendFn}(c.rgb, faded), c.a);
}
`,
};
