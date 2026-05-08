import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('invert');
const blend = buildBlendControl('invert');

export default {
    name: 'invert',
    label: 'Invert',
    pass: 'pre-crt',
    paramKeys: ['invertColorA', 'invertColorB', 'invertColorC', 'invertColorD', ...fade.paramKeys, ...blend.paramKeys],
    handleParams: [...fade.handleParams],
    uiGroups: [
        { keys: ['invertColorA', 'invertColorB', 'invertColorC', 'invertColorD'] },
        fade.uiGroup,
        blend.uiGroup,
    ],
    params: {
        invertEnabled:   { default: false, label: 'Enable' },
        invertColorA:    { default: 'all', label: 'Color A', options: [
            ['all', 'All Colors'],
            ['r',  'Red'], ['g',  'Green'], ['b',  'Blue'],
            ['c',  'Cyan'], ['y',  'Yellow'], ['m',  'Magenta'],
            ['w',  'White'], ['bk', 'Black'],
            ['p0', 'Palette 1'], ['p1', 'Palette 2'], ['p2', 'Palette 3'], ['p3', 'Palette 4'],
            ['p4', 'Palette 5'], ['p5', 'Palette 6'], ['p6', 'Palette 7'], ['p7', 'Palette 8'],
        ] },
        invertColorB:    { default: 'bk', label: 'Color B', options: [
            ['r',  'Red'], ['g',  'Green'], ['b',  'Blue'],
            ['c',  'Cyan'], ['y',  'Yellow'], ['m',  'Magenta'],
            ['w',  'White'], ['bk', 'Black'],
            ['p0', 'Palette 1'], ['p1', 'Palette 2'], ['p2', 'Palette 3'], ['p3', 'Palette 4'],
            ['p4', 'Palette 5'], ['p5', 'Palette 6'], ['p6', 'Palette 7'], ['p7', 'Palette 8'],
        ] },
        invertColorC:    { default: 'none', label: 'Color C (mid)', options: [
            ['none', 'None'],
            ['r',  'Red'], ['g',  'Green'], ['b',  'Blue'],
            ['c',  'Cyan'], ['y',  'Yellow'], ['m',  'Magenta'],
            ['w',  'White'], ['bk', 'Black'],
            ['p0', 'Palette 1'], ['p1', 'Palette 2'], ['p2', 'Palette 3'], ['p3', 'Palette 4'],
            ['p4', 'Palette 5'], ['p5', 'Palette 6'], ['p6', 'Palette 7'], ['p7', 'Palette 8'],
        ] },
        invertColorD:    { default: 'none', label: 'Color D (mid)', options: [
            ['none', 'None'],
            ['r',  'Red'], ['g',  'Green'], ['b',  'Blue'],
            ['c',  'Cyan'], ['y',  'Yellow'], ['m',  'Magenta'],
            ['w',  'White'], ['bk', 'Black'],
            ['p0', 'Palette 1'], ['p1', 'Palette 2'], ['p2', 'Palette 3'], ['p3', 'Palette 4'],
            ['p4', 'Palette 5'], ['p5', 'Palette 6'], ['p6', 'Palette 7'], ['p7', 'Palette 8'],
        ] },
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
        const aLoc    = prog._locs['invertColorA'];
        const bLoc    = prog._locs['invertColorB'];
        const cLoc    = prog._locs['invertColorC'];
        const dLoc    = prog._locs['invertColorD'];
        const allLoc  = prog._locs['invertAllColors'];
        const useCLoc = prog._locs['invertUseColorC'];
        const useDLoc = prog._locs['invertUseColorD'];
        const isAll   = p.invertColorA === 'all';
        const useC    = p.invertColorC !== 'none';
        const useD    = p.invertColorD !== 'none';
        const a = resolveColor(p.invertColorA, [0,0,0]);
        const b = resolveColor(p.invertColorB, [1,1,1]);
        const c = resolveColor(p.invertColorC, [1,1,1]);
        const d = resolveColor(p.invertColorD, [1,1,1]);
        if (aLoc    != null) gl.uniform3f(aLoc,    ...a);
        if (bLoc    != null) gl.uniform3f(bLoc,    ...b);
        if (cLoc    != null) gl.uniform3f(cLoc,    ...c);
        if (dLoc    != null) gl.uniform3f(dLoc,    ...d);
        if (allLoc  != null) gl.uniform1i(allLoc,  isAll ? 1 : 0);
        if (useCLoc != null) gl.uniform1i(useCLoc, useC  ? 1 : 0);
        if (useDLoc != null) gl.uniform1i(useDLoc, useD  ? 1 : 0);
        fade.bindUniforms(gl, prog, p);
        blend.bindUniforms(gl, prog, p);
    },
    glsl: `
uniform int  invertAllColors;
uniform int  invertUseColorC;
uniform int  invertUseColorD;
uniform vec3 invertColorA;
uniform vec3 invertColorB;
uniform vec3 invertColorC;
uniform vec3 invertColorD;
${fade.glsl}
${blend.glsl}
void main() {
    vec4 c = texture(uTex, vUV);
    float lum = 0.299*c.r + 0.587*c.g + 0.114*c.b;
    vec3 adjusted;
    if (invertAllColors == 1) {
        adjusted = vec3(1.0 - c.r, 1.0 - c.g, 1.0 - c.b);
    } else if (invertUseColorC == 1 && invertUseColorD == 1) {
        if      (lum < (1.0/3.0)) adjusted = mix(invertColorA, invertColorC, lum * 3.0);
        else if (lum < (2.0/3.0)) adjusted = mix(invertColorC, invertColorD, (lum - (1.0/3.0)) * 3.0);
        else                      adjusted = mix(invertColorD, invertColorB, (lum - (2.0/3.0)) * 3.0);
    } else if (invertUseColorC == 1) {
        adjusted = lum < 0.5
            ? mix(invertColorA, invertColorC, lum * 2.0)
            : mix(invertColorC, invertColorB, (lum - 0.5) * 2.0);
    } else if (invertUseColorD == 1) {
        adjusted = lum < 0.5
            ? mix(invertColorA, invertColorD, lum * 2.0)
            : mix(invertColorD, invertColorB, (lum - 0.5) * 2.0);
    } else {
        adjusted = mix(invertColorA, invertColorB, lum);
    }
    float weight = ${fade.fnName}();
    vec3 faded = mix(c.rgb, adjusted, weight);
    if (!${blend.thresholdFn}(c, vec4(faded, c.a))) { fragColor = c; return; }
    fragColor = vec4(${blend.blendFn}(c.rgb, faded), c.a);
}
`,
};
