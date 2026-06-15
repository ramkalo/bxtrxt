import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('chroma');
const blend = buildBlendControl('chroma');

export default {
    name: 'chroma',
    label: 'Chromatic Aberration',
    kind: 'glsl',
    paramKeys: [
        'chromaRedX', 'chromaRedY', 'chromaGreenX', 'chromaGreenY', 'chromaBlueX', 'chromaBlueY',
        'chromaScale', 'wavesPhase',
        ...blend.paramKeys,
        ...fade.paramKeys,
        'chromaOutlineX', 'chromaOutlineY',
    ],
    handleParams: ['chromaOutlineX', 'chromaOutlineY', ...fade.handleParams],
    params: {
        chromaEnabled:  { default: false, label: 'Enable' },
        chromaMode:     { default: 'classic', label: 'Mode', options: [['classic', 'Linear'], ['outline', 'Radial'], ['waves', 'Waves']] },
        chromaRedX:     { default: 0, min: -20, max: 20, label: 'Red X' },
        chromaRedY:     { default: 0, min: -20, max: 20, label: 'Red Y' },
        chromaGreenX:   { default: 0, min: -20, max: 20, label: 'Green X' },
        chromaGreenY:   { default: 0, min: -20, max: 20, label: 'Green Y' },
        chromaBlueX:    { default: 0, min: -20, max: 20, label: 'Blue X' },
        chromaBlueY:    { default: 0, min: -20, max: 20, label: 'Blue Y' },
        chromaScale:    { default: 4,   min: 1,   max: 10, label: 'Scale' },
        wavesPhase:     { default: 0,   min: 0,   max: 100, label: 'Phase' },
        ...blend.params,
        ...fade.params,
        chromaOutlineX: { default: 0, min: -50, max: 50 },
        chromaOutlineY: { default: 0, min: -50, max: 50 },
    },
    enabled: (p) => p.chromaEnabled,
    uiGroups: (p) => {
        const sharedBottom = [
            blend.uiGroup,
            fade.uiGroup,
        ];
        if (p.chromaMode === 'waves') return [
            { keys: ['chromaMode'] },
            { keys: ['chromaRedX', 'chromaGreenX', 'chromaBlueX', 'wavesPhase', 'chromaScale'],
              labels: { chromaRedX: 'Red', chromaGreenX: 'Green', chromaBlueX: 'Blue', wavesPhase: 'Phase' } },
            ...sharedBottom,
        ];
        const outline = p.chromaMode === 'outline';
        return [
            { keys: ['chromaMode'] },
            { label: 'Channel Shifts', keys: outline
                ? ['chromaRedX', 'chromaGreenX', 'chromaBlueX', 'chromaScale']
                : ['chromaRedX', 'chromaRedY', 'chromaGreenX', 'chromaGreenY', 'chromaBlueX', 'chromaBlueY', 'chromaScale'],
              labels: outline ? { chromaRedX: 'Red', chromaGreenX: 'Green', chromaBlueX: 'Blue' } : undefined },
            ...sharedBottom,
        ];
    },
    overlays: (inst) => inst.params.chromaMode === 'outline'
        ? { chroma: true }
        : { fade: fade.overlay },
    bindUniforms(gl, prog, p) {
        const modeInt = { classic: 0, outline: 1, waves: 2 }[p.chromaMode] ?? 0;
        if (prog._locs['chromaMode'] != null) gl.uniform1i(prog._locs['chromaMode'], modeInt);
        fade.bindUniforms(gl, prog, p);
        blend.bindUniforms(gl, prog, p);
    },
    glsl: `
uniform float chromaRedX; uniform float chromaRedY;
uniform float chromaGreenX; uniform float chromaGreenY;
uniform float chromaBlueX; uniform float chromaBlueY;
uniform float chromaScale;
uniform int   chromaMode;
uniform float chromaOutlineX;
uniform float chromaOutlineY;
uniform float wavesPhase;
${blend.glsl}
${fade.glsl}
vec4 chromaSample(vec2 offsetPx) {
    return texture(uTex, clamp(vUV + vec2(-offsetPx.x, -offsetPx.y) / uResolution, vec2(0.0), vec2(1.0)));
}

float wavesFormula(float xN, float yN) {
    return
        3.2 * sin(xN + 0.3 * cos(2.1 * xN) + yN) +
        2.1 * cos(0.73 * xN - 1.4 + yN * 0.7) * sin(0.5 * xN + 0.9 + yN * 0.5) +
        1.8 * sin(2.3 * xN + cos(xN) + yN * 0.3) * exp(-0.02 * pow(xN - 2.0, 2.0)) +
        0.9 * cos(3.7 * xN - 0.8 + yN * 0.4) * (1.0 / (1.0 + 0.15 * xN * xN)) +
        1.2 * sin(0.41 * xN * xN - xN + yN * 0.6);
}

void main() {
    vec4 orig = texture(uTex, vUV);

    float weight = ${fade.fnName}();

    float r, g, b;

    if (chromaMode == 2) {
        float ampR  = chromaRedX   * chromaScale * 0.3;
        float ampG  = chromaGreenX * chromaScale * 0.3;
        float ampB  = chromaBlueX  * chromaScale * 0.3;
        float phase = wavesPhase / 100.0 * 20.0;
        float xNorm = vUV.x * 10.0 + phase;
        float yNorm = (1.0 - vUV.y) * 8.0;
        float wave  = wavesFormula(xNorm, yNorm);
        r = texture(uTex, clamp(vec2(vUV.x + wave * ampR / uResolution.x, vUV.y), vec2(0.0), vec2(1.0))).r;
        g = texture(uTex, clamp(vec2(vUV.x + wave * ampG / uResolution.x, vUV.y), vec2(0.0), vec2(1.0))).g;
        b = texture(uTex, clamp(vec2(vUV.x + wave * ampB / uResolution.x, vUV.y), vec2(0.0), vec2(1.0))).b;
        vec3 adjusted = vec3(mix(orig.r, r, weight), mix(orig.g, g, weight), mix(orig.b, b, weight));
        if (!${blend.thresholdFn}(orig, vec4(adjusted, orig.a))) { fragColor = orig; return; }
        fragColor = vec4(${blend.blendFn}(orig.rgb, adjusted), orig.a);
        return;
    }

    if (chromaMode == 1) {
        vec2 focalUV = vec2(
            0.5 + chromaOutlineX / 100.0,
            0.5 + chromaOutlineY / 100.0
        );
        vec2 offset = vUV - focalUV;
        float rScale = 1.0 - chromaRedX   * chromaScale * weight * 0.001;
        float gScale = 1.0 - chromaGreenX * chromaScale * weight * 0.001;
        float bScale = 1.0 - chromaBlueX  * chromaScale * weight * 0.001;
        r = texture(uTex, clamp(focalUV + offset * rScale, vec2(0.0), vec2(1.0))).r;
        g = texture(uTex, clamp(focalUV + offset * gScale, vec2(0.0), vec2(1.0))).g;
        b = texture(uTex, clamp(focalUV + offset * bScale, vec2(0.0), vec2(1.0))).b;
    } else {
        vec2 rShift = vec2(chromaRedX,   chromaRedY)   * chromaScale * weight;
        vec2 gShift = vec2(chromaGreenX, chromaGreenY) * chromaScale * weight;
        vec2 bShift = vec2(chromaBlueX,  chromaBlueY)  * chromaScale * weight;
        r = chromaSample(rShift).r;
        g = chromaSample(gShift).g;
        b = chromaSample(bShift).b;
    }
    if (!${blend.thresholdFn}(orig, vec4(r, g, b, orig.a))) { fragColor = orig; return; }
    fragColor = vec4(${blend.blendFn}(orig.rgb, vec3(r, g, b)), orig.a);
}
`,
};
