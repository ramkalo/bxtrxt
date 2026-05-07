import { secondTexture } from '../renderer/glstate.js';
import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('doubleExposure');
const blend = buildBlendControl('doubleExposure');

export default {
    name: 'doubleExposure',
    label: 'Double Exposure',
    pass: 'pre-crt',
    paramKeys: [
        'doubleExposureBlendMode',
        'doubleExposureOrigOpacity', 'doubleExposureOpacity',
        'doubleExposureTexX', 'doubleExposureTexY',
        ...fade.paramKeys,
        ...blend.paramKeys,
    ],
    handleParams: [
        'doubleExposureTexX', 'doubleExposureTexY',
        ...fade.handleParams,
    ],
    uiGroups: [
        { keys: ['doubleExposureBlendMode', 'doubleExposureOrigOpacity', 'doubleExposureOpacity'] },
        fade.uiGroup,
        blend.uiGroup,
    ],
    params: {
        doubleExposureEnabled:     { default: false, label: 'Enable' },
        doubleExposureBlendMode:   { default: 'screen', label: 'Blend Mode', options: [['screen', 'Screen'], ['multiply', 'Multiply'], ['add', 'Add'], ['overlay', 'Overlay'], ['difference', 'Difference']] },
        doubleExposureOrigOpacity: { default: 100, min: 0, max: 100, label: 'Image Opacity' },
        doubleExposureOpacity:     { default: 100, min: 0, max: 100, label: 'Blend Opacity' },
        doubleExposureTexX:        { default: 0, min: -100, max: 100, label: 'Image X' },
        doubleExposureTexY:        { default: 0, min: -100, max: 100, label: 'Image Y' },
        ...fade.params,
        ...blend.params,
    },
    enabled: (p) => p.doubleExposureEnabled && !!secondTexture,
    bindUniforms: (gl, prog, p) => {
        const blendMap = { normal: 0, screen: 1, multiply: 2, add: 3, overlay: 4, difference: 5 };
        const set1i = (name, val) => { const loc = prog._locs[name]; if (loc != null) gl.uniform1i(loc, val); };

        set1i('doubleExposureBlendMode', blendMap[p.doubleExposureBlendMode] ?? 1);

        const texLoc = prog._locs['uSecondTex'];
        if (texLoc != null && secondTexture) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, secondTexture);
            gl.uniform1i(texLoc, 1);
        }

        fade.bindUniforms(gl, prog, p);
        blend.bindUniforms(gl, prog, p);
    },
    glsl: `
uniform sampler2D uSecondTex;
uniform int   doubleExposureBlendMode;
uniform float doubleExposureOrigOpacity;
uniform float doubleExposureOpacity;
uniform float doubleExposureTexX;
uniform float doubleExposureTexY;
${fade.glsl}
${blend.glsl}
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
    if (!${blend.thresholdFn}(orig)) { fragColor = orig; return; }

    vec2 secUV = vUV - vec2(doubleExposureTexX / 100.0, doubleExposureTexY / 100.0);
    if (secUV.x < 0.0 || secUV.x > 1.0 || secUV.y < 0.0 || secUV.y > 1.0) {
        fragColor = orig; return;
    }
    vec4 sec = texture(uSecondTex, secUV);

    vec3 base = orig.rgb * (doubleExposureOrigOpacity / 100.0);

    vec3 result = vec3(blendCh(base.r, sec.r), blendCh(base.g, sec.g), blendCh(base.b, sec.b));

    result = mix(base, result, doubleExposureOpacity / 100.0);

    float weight = ${fade.fnName}();

    result = mix(orig.rgb, result, weight);
    fragColor = vec4(${blend.blendFn}(orig.rgb, result), orig.a);
}
`,
};
