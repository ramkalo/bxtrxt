import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('digitalSmear');
const blend = buildBlendControl('digitalSmear');

export default {
    name:  'digital-smear',
    label: 'Digital Smear',
    pass:  'pre-crt',
    paramKeys: ['smearWidth', 'smearDirection', 'smearShift', ...fade.paramKeys, ...blend.paramKeys],
    handleParams: [...fade.handleParams],
    uiGroups: [
        { keys: ['smearWidth', 'smearDirection', 'smearShift'] },
        fade.uiGroup,
        blend.uiGroup,
    ],
    params: {
        smearEnabled:   { default: false, label: 'Enable' },
        smearWidth:     { default: 15,  min: 5,  max: 50,  label: 'Width' },
        smearDirection: { default: 'ltr', label: 'Direction', options: [['ltr', 'Left → Right'], ['rtl', 'Right → Left'], ['ttb', 'Top → Bottom'], ['btu', 'Bottom → Top']] },
        smearShift:     { default: 0,   min: 0,  max: 100, label: 'Shift' },
        ...fade.params,
        ...blend.params,
    },
    enabled:  (p) => p.smearEnabled && p.smearWidth > 0,
    overlays: { fade: fade.overlay },
    bindUniforms: (gl, prog, p) => {
        const loc = prog._locs['smearDirection'];
        if (loc != null) gl.uniform1i(loc, { ltr: 0, rtl: 1, ttb: 2, btt: 3 }[p.smearDirection] ?? 0);
        fade.bindUniforms(gl, prog, p);
        blend.bindUniforms(gl, prog, p);
    },
    glsl: `
uniform float smearWidth;
uniform int   smearDirection;
uniform float smearShift;
${fade.glsl}
${blend.glsl}
float wavesFormula(float xN, float yN) {
    return
        3.2 * sin(xN + 0.3 * cos(2.1 * xN) + yN) +
        2.1 * cos(0.73 * xN - 1.4 + yN * 0.7) * sin(0.5 * xN + 0.9 + yN * 0.5) +
        1.8 * sin(2.3 * xN + cos(xN) + yN * 0.3) * exp(-0.02 * pow(xN - 2.0, 2.0)) +
        0.9 * cos(3.7 * xN - 0.8 + yN * 0.4) * (1.0 / (1.0 + 0.15 * xN * xN)) +
        1.2 * sin(0.41 * xN * xN - xN + yN * 0.6);
}

void main() {
    vec4 c = texture(uTex, vUV);
    if (!${blend.thresholdFn}(c)) { fragColor = c; return; }
    float amp   = smearWidth / 10.0;
    float phase = smearShift / 100.0 * 20.0;
    vec2 uv = vUV;

    if (smearDirection == 0 || smearDirection == 1) {
        float xNorm = (1.0 - vUV.y) * 10.0 + phase;
        float yNorm = vUV.x * 8.0;
        float wave  = wavesFormula(xNorm, yNorm);
        float dx    = wave * amp * (smearDirection == 0 ? 1.0 : -1.0);
        uv.x = clamp(vUV.x + dx / uResolution.x, 0.0, 1.0);
    } else {
        float xNorm = vUV.x * 10.0 + phase;
        float yNorm = (1.0 - vUV.y) * 8.0;
        float wave  = wavesFormula(xNorm, yNorm);
        float dy    = wave * amp * (smearDirection == 2 ? 1.0 : -1.0);
        uv.y = clamp(vUV.y - dy / uResolution.y, 0.0, 1.0);
    }

    float weight  = ${fade.fnName}();
    vec3 adjusted = texture(uTex, uv).rgb;
    vec3 faded    = mix(c.rgb, adjusted, weight);
    fragColor = vec4(${blend.blendFn}(c.rgb, faded), c.a);
}
`,
};
