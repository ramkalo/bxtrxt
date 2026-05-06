import { secondTexture } from '../renderer/glstate.js';
import { buildFadeControl } from './controls/index.js';

const fade = buildFadeControl('doubleExposure');

export default {
    name: 'doubleExposure',
    label: 'Double Exposure',
    pass: 'pre-crt',
    paramKeys: [
        'doubleExposureChannelMode', 'doubleExposureBlendMode',
        'doubleExposureOrigOpacity', 'doubleExposureOpacity',
        'doubleExposureIntensity', 'doubleExposureReverseLum',
        'doubleExposureThreshSat', 'doubleExposureReverseSat',
        'doubleExposureTexX', 'doubleExposureTexY',
        ...fade.paramKeys,
    ],
    handleParams: [
        'doubleExposureTexX', 'doubleExposureTexY',
        ...fade.handleParams,
    ],
    uiGroups: [
        { keys: ['doubleExposureBlendMode', 'doubleExposureOrigOpacity', 'doubleExposureOpacity'] },
        { label: 'Threshold', keys: ['doubleExposureChannelMode', 'doubleExposureIntensity', 'doubleExposureReverseLum', 'doubleExposureThreshSat', 'doubleExposureReverseSat'] },
        fade.uiGroup,
    ],
    params: {
        doubleExposureEnabled:     { default: false, label: 'Enable' },
        doubleExposureBlendMode:   { default: 'screen', label: 'Blend Mode', options: [['screen', 'Screen'], ['multiply', 'Multiply'], ['add', 'Add'], ['overlay', 'Overlay'], ['difference', 'Difference']] },
        doubleExposureOrigOpacity: { default: 100, min: 0, max: 100, label: 'Image Opacity' },
        doubleExposureOpacity:     { default: 100, min: 0, max: 100, label: 'Blend Opacity' },
        doubleExposureChannelMode: { default: 'all', label: 'Target Channel', options: [['all', 'All'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] },
        doubleExposureIntensity:   { default: 100, min: 0, max: 100, label: 'Luminance' },
        doubleExposureReverseLum:  { default: false, label: 'Reverse' },
        doubleExposureThreshSat:   { default: 0, min: 0, max: 100, label: 'Saturation' },
        doubleExposureReverseSat:  { default: false, label: 'Reverse' },
        doubleExposureTexX:        { default: 0, min: -100, max: 100, label: 'Image X' },
        doubleExposureTexY:        { default: 0, min: -100, max: 100, label: 'Image Y' },
        ...fade.params,
    },
    enabled: (p) => p.doubleExposureEnabled && !!secondTexture,
    bindUniforms: (gl, prog, p) => {
        const chanMap  = { all: 7, r: 1, g: 2, b: 4 };
        const blendMap = { normal: 0, screen: 1, multiply: 2, add: 3, overlay: 4, difference: 5 };
        const set1i = (name, val) => { const loc = prog._locs[name]; if (loc != null) gl.uniform1i(loc, val); };

        set1i('doubleExposureChannelMode', chanMap[p.doubleExposureChannelMode] ?? 7);
        set1i('doubleExposureBlendMode',   blendMap[p.doubleExposureBlendMode]  ?? 1);

        const texLoc = prog._locs['uSecondTex'];
        if (texLoc != null && secondTexture) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, secondTexture);
            gl.uniform1i(texLoc, 1);
        }

        fade.bindUniforms(gl, prog, p);
    },
    glsl: `
uniform sampler2D uSecondTex;
uniform int   doubleExposureChannelMode;
uniform int   doubleExposureBlendMode;
uniform float doubleExposureOrigOpacity;
uniform float doubleExposureOpacity;
uniform float doubleExposureIntensity;
uniform int   doubleExposureReverseLum;
uniform float doubleExposureThreshSat;
uniform int   doubleExposureReverseSat;
uniform float doubleExposureTexX;
uniform float doubleExposureTexY;
${fade.glsl}
float blendCh(float a, float b) {
    if      (doubleExposureBlendMode == 1) return 1.0 - (1.0-a)*(1.0-b);
    else if (doubleExposureBlendMode == 2) return a * b;
    else if (doubleExposureBlendMode == 3) return min(1.0, a + b);
    else if (doubleExposureBlendMode == 4) return a < 0.5 ? 2.0*a*b : 1.0 - 2.0*(1.0-a)*(1.0-b);
    else if (doubleExposureBlendMode == 5) return abs(a - b);
    return a;
}

void main() {
    vec4 orig = texture(uTex, vUV);

    vec2 secUV = vUV - vec2(doubleExposureTexX / 100.0, doubleExposureTexY / 100.0);
    if (secUV.x < 0.0 || secUV.x > 1.0 || secUV.y < 0.0 || secUV.y > 1.0) {
        fragColor = orig; return;
    }
    vec4 sec = texture(uSecondTex, secUV);

    float lum = dot(orig.rgb, vec3(0.299, 0.587, 0.114));
    float lumThresh = doubleExposureIntensity / 100.0;
    bool lumMet = (doubleExposureReverseLum == 1) ? (lum <= lumThresh) : (lum >= lumThresh);

    // In channel-targeted modes, saturation measures how dominant that channel is
    // over the other two (e.g. red=0.9 vs orange where red=0.4 over green).
    // In All mode, use standard HSL saturation.
    float satVal;
    if      (doubleExposureChannelMode == 1) satVal = orig.r - max(orig.g, orig.b);
    else if (doubleExposureChannelMode == 2) satVal = orig.g - max(orig.r, orig.b);
    else if (doubleExposureChannelMode == 4) satVal = orig.b - max(orig.r, orig.g);
    else {
        float cMax = max(orig.r, max(orig.g, orig.b));
        float cMin = min(orig.r, min(orig.g, orig.b));
        satVal = (cMax > 0.0) ? (cMax - cMin) / cMax : 0.0;
    }
    float satThresh = doubleExposureThreshSat / 100.0;
    bool satMet = (doubleExposureReverseSat == 1) ? (satVal <= satThresh) : (satVal >= satThresh);

    if (!lumMet || !satMet) { fragColor = orig; return; }

    // Channel targeting: skip pixel if its dominant channel doesn't match selection
    if (doubleExposureChannelMode != 7) {
        bool dominated =
            (doubleExposureChannelMode == 1 && orig.r >= orig.g && orig.r >= orig.b) ||
            (doubleExposureChannelMode == 2 && orig.g >= orig.r && orig.g >= orig.b) ||
            (doubleExposureChannelMode == 4 && orig.b >= orig.r && orig.b >= orig.g);
        if (!dominated) { fragColor = orig; return; }
    }

    // Scale original before blending — lower values let the second image dominate
    vec3 base = orig.rgb * (doubleExposureOrigOpacity / 100.0);

    vec3 result = vec3(blendCh(base.r, sec.r), blendCh(base.g, sec.g), blendCh(base.b, sec.b));

    result = mix(base, result, doubleExposureOpacity / 100.0);

    float weight = ${fade.fnName}();

    // Fade masks back to original (unscaled), not base
    result = mix(orig.rgb, result, weight);
    fragColor = vec4(result, orig.a);
}
`,
};
