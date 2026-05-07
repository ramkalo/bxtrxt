import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('invert');
const blend = buildBlendControl('invert');

export default {
    name: 'invert',
    label: 'Invert',
    pass: 'pre-crt',
    paramKeys: ['invertColorA', 'invertColorB', ...fade.paramKeys, ...blend.paramKeys],
    handleParams: [...fade.handleParams],
    uiGroups: [
        { keys: ['invertColorA', 'invertColorB'] },
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
        ] },
        invertColorB:    { default: 'bk', label: 'Color B', options: [
            ['r',  'Red'], ['g',  'Green'], ['b',  'Blue'],
            ['c',  'Cyan'], ['y',  'Yellow'], ['m',  'Magenta'],
            ['w',  'White'], ['bk', 'Black'],
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
        const aLoc   = prog._locs['invertColorA'];
        const bLoc   = prog._locs['invertColorB'];
        const allLoc = prog._locs['invertAllColors'];
        const isAll  = p.invertColorA === 'all';
        const a = colorVec[p.invertColorA] ?? [0,0,0];
        const b = colorVec[p.invertColorB] ?? [1,1,1];
        if (aLoc   != null) gl.uniform3f(aLoc,   ...a);
        if (bLoc   != null) gl.uniform3f(bLoc,   ...b);
        if (allLoc != null) gl.uniform1i(allLoc, isAll ? 1 : 0);
        fade.bindUniforms(gl, prog, p);
        blend.bindUniforms(gl, prog, p);
    },
    glsl: `
uniform int  invertAllColors;
uniform vec3 invertColorA;
uniform vec3 invertColorB;
${fade.glsl}
${blend.glsl}
void main() {
    vec4 c = texture(uTex, vUV);
    if (!${blend.thresholdFn}(c)) { fragColor = c; return; }
    float lum = 0.299*c.r + 0.587*c.g + 0.114*c.b;
    vec3 adjusted = (invertAllColors == 1)
        ? vec3(1.0 - c.r, 1.0 - c.g, 1.0 - c.b)
        : mix(invertColorA, invertColorB, lum);
    float weight = ${fade.fnName}();
    vec3 faded = mix(c.rgb, adjusted, weight);
    fragColor = vec4(${blend.blendFn}(c.rgb, faded), c.a);
}
`,
};
