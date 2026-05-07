const THRESHOLD_GLSL = `
uniform float __P__Threshold;
uniform int   __P__ThresholdTarget;
uniform int   __P__ThresholdReverse;

bool __FN__(vec4 color) {
    float val;
    if      (__P__ThresholdTarget == 1) val = color.r;
    else if (__P__ThresholdTarget == 2) val = color.g;
    else if (__P__ThresholdTarget == 3) val = color.b;
    else                                val = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float thresh = __P__Threshold / 100.0;
    return (__P__ThresholdReverse == 1) ? (val <= thresh) : (val >= thresh);
}
`;

const BLEND_MODES = [
    ['screen',     'Screen'],
    ['multiply',   'Multiply'],
    ['add',        'Add'],
    ['overlay',    'Overlay'],
    ['difference', 'Difference'],
    ['normal',     'Normal'],
];

const BLEND_MAP = { normal: 0, screen: 1, multiply: 2, add: 3, overlay: 4, difference: 5 };

const BLEND_GLSL = `
uniform int   __P__BlendEnabled;
uniform int   __P__BlendMode;
uniform float __P__Opacity;

float __P__BlendCh(float a, float b) {
    if      (__P__BlendMode == 1) return 1.0 - (1.0-a)*(1.0-b);
    else if (__P__BlendMode == 2) return a * b;
    else if (__P__BlendMode == 3) return min(1.0, a + b);
    else if (__P__BlendMode == 4) return a < 0.5 ? 2.0*a*b : 1.0 - 2.0*(1.0-a)*(1.0-b);
    else if (__P__BlendMode == 5) return abs(a - b);
    return b;
}

vec3 __P__Blend(vec3 base, vec3 src) {
    if (__P__BlendEnabled != 1) return src;
    vec3 blended = vec3(
        __P__BlendCh(base.r, src.r),
        __P__BlendCh(base.g, src.g),
        __P__BlendCh(base.b, src.b)
    );
    return mix(base, blended, __P__Opacity / 100.0);
}
`;

const BLEND_THRESHOLD_GLSL = `
uniform float __P__Threshold;
uniform int   __P__ThresholdTarget;
uniform int   __P__ThresholdReverse;
uniform int   __P__ThresholdOnDest;

bool __FN__(vec4 destColor, vec4 srcColor) {
    if (__P__BlendEnabled != 1) return true;
    vec4 color = (__P__ThresholdOnDest == 1) ? destColor : srcColor;
    float val;
    if      (__P__ThresholdTarget == 1) val = color.r;
    else if (__P__ThresholdTarget == 2) val = color.g;
    else if (__P__ThresholdTarget == 3) val = color.b;
    else                                val = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float thresh = __P__Threshold / 100.0;
    return (__P__ThresholdReverse == 1) ? (val <= thresh) : (val >= thresh);
}
`;

export function buildThresholdControl(prefix, defaults = {}) {
    const p   = prefix;
    const cap = p.charAt(0).toUpperCase() + p.slice(1);
    const thresholdFn = `calc${cap}ThresholdMet`;
    const glsl = THRESHOLD_GLSL.replaceAll('__P__', p).replaceAll('__FN__', thresholdFn);

    return {
        glsl,
        fnName: thresholdFn,
        params: {
            [`${p}Threshold`]:        { default: defaults.threshold ?? 0, min: 0, max: 100, label: 'Threshold' },
            [`${p}ThresholdTarget`]:  { default: 'lum', options: [['lum', 'Luminance'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], label: 'Target' },
            [`${p}ThresholdReverse`]: { default: false, label: 'Reverse Threshold' },
        },
        paramKeys: [`${p}Threshold`, `${p}ThresholdTarget`, `${p}ThresholdReverse`],
        uiGroup: { label: 'Threshold', keys: [`${p}Threshold`, `${p}ThresholdTarget`, `${p}ThresholdReverse`] },
        bindUniforms(gl, prog, params) {
            const locs = prog._locs;
            const si = (k, v) => { if (locs[k] != null) gl.uniform1i(locs[k], v); };
            si(`${p}ThresholdTarget`,  { lum: 0, r: 1, g: 2, b: 3 }[params[`${p}ThresholdTarget`]] ?? 0);
            si(`${p}ThresholdReverse`, params[`${p}ThresholdReverse`] ? 1 : 0);
        },
    };
}

export function buildBlendControl(prefix, defaults = {}) {
    const p   = prefix;
    const cap = p.charAt(0).toUpperCase() + p.slice(1);
    const thresholdFn = `calc${cap}ThresholdMet`;

    const glsl = BLEND_GLSL.replaceAll('__P__', p)
               + BLEND_THRESHOLD_GLSL.replaceAll('__P__', p).replaceAll('__FN__', thresholdFn);

    return {
        glsl,
        thresholdFn,
        blendFn:   `${p}Blend`,
        blendChFn: `${p}BlendCh`,
        params: {
            [`${p}BlendEnabled`]:      { default: false, label: 'Enable Blend' },
            [`${p}BlendMode`]:         { default: defaults.mode    ?? 'normal', options: BLEND_MODES, label: 'Blend Mode' },
            [`${p}Opacity`]:           { default: defaults.opacity ?? 50, min: 0, max: 100, label: 'Opacity' },
            [`${p}Threshold`]:         { default: defaults.threshold ?? 0, min: 0, max: 100, label: 'Threshold' },
            [`${p}ThresholdTarget`]:   { default: 'lum', options: [['lum', 'Luminance'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], label: 'Threshold Target' },
            [`${p}ThresholdReverse`]:  { default: false, label: 'Reverse Threshold' },
            [`${p}ThresholdOnDest`]:   { default: true, label: 'On Destination' },
        },
        paramKeys: [
            `${p}BlendEnabled`, `${p}BlendMode`, `${p}Opacity`,
            `${p}Threshold`, `${p}ThresholdTarget`, `${p}ThresholdReverse`, `${p}ThresholdOnDest`,
        ],
        uiGroup: {
            label: 'Blend',
            keys: [`${p}BlendEnabled`, `${p}BlendMode`, `${p}Opacity`, `${p}Threshold`, `${p}ThresholdTarget`, `${p}ThresholdReverse`, `${p}ThresholdOnDest`],
        },
        bindUniforms(gl, prog, params) {
            const locs = prog._locs;
            const si = (k, v) => { if (locs[k] != null) gl.uniform1i(locs[k], v); };
            si(`${p}BlendEnabled`,     params[`${p}BlendEnabled`] ? 1 : 0);
            si(`${p}BlendMode`,        BLEND_MAP[params[`${p}BlendMode`]] ?? 1);
            si(`${p}ThresholdTarget`,  { lum: 0, r: 1, g: 2, b: 3 }[params[`${p}ThresholdTarget`]] ?? 0);
            si(`${p}ThresholdReverse`, params[`${p}ThresholdReverse`] ? 1 : 0);
            si(`${p}ThresholdOnDest`,  params[`${p}ThresholdOnDest`] ? 1 : 0);
        },
    };
}
