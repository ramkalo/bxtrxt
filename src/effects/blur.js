import { buildBlendControl, buildFadeControl } from './controls/index.js';

const blend = buildBlendControl('blur');
const fade  = buildFadeControl('blur');

export const blurEffect = {
    name:  'blur',
    label: 'Blur',
    kind:  'glsl',
    paramKeys: ['blurAmount', ...blend.paramKeys, ...fade.paramKeys],
    handleParams: [...fade.handleParams],
    overlays: { fade: fade.overlay },
    uiGroups: [
        { keys: ['blurEnabled', 'blurAmount', 'blurPasses'] },
        blend.uiGroup,
        fade.uiGroup,
    ],
    params: {
        blurEnabled: { default: false, label: 'Enable' },
        blurAmount:  { default: 100, min: 0, max: 100, label: 'Intensity' },
        blurPasses:  { default: 12,  min: 1, max: 24,  label: 'Blur Power' },
        ...blend.params,
        ...fade.params,
    },
    enabled:  (p) => p.blurEnabled,
    bindUniforms: (gl, prog, p) => {
        fade.bindUniforms(gl, prog, p);
        blend.bindUniforms(gl, prog, p);
    },
    glslPasses: (p) => {
        const nPasses = Math.round(p.blurPasses ?? 1);
        const passes = [];
        for (let i = 0; i < nPasses; i++) {
            passes.push({ glsl: BLUR_H_GLSL });
            passes.push({ glsl: BLUR_V_GLSL });
        }
        passes.push({ glsl: BLUR_COMPOSITE_GLSL, needsOriginal: true });
        return passes;
    },
};

const BLUR_H_GLSL = `
void main() {
    const float BLUR_RADIUS = 10.0;
    int r = int(BLUR_RADIUS + 0.5);
    float twoSigSq = 2.0 * BLUR_RADIUS * BLUR_RADIUS;
    vec4 color = vec4(0.0);
    float total = 0.0;
    for (int i = -50; i <= 50; i++) {
        if (i < -r || i > r) continue;
        float g = exp(-float(i * i) / twoSigSq);
        color += texture(uTex, clamp(vUV + vec2(float(i) * uTexelSize.x, 0.0), vec2(0.0), vec2(1.0))) * g;
        total += g;
    }
    fragColor = color / max(total, 0.0001);
}
`;

const BLUR_V_GLSL = `
void main() {
    const float BLUR_RADIUS = 10.0;
    int r = int(BLUR_RADIUS + 0.5);
    float twoSigSq = 2.0 * BLUR_RADIUS * BLUR_RADIUS;
    vec4 color = vec4(0.0);
    float total = 0.0;
    for (int i = -50; i <= 50; i++) {
        if (i < -r || i > r) continue;
        float g = exp(-float(i * i) / twoSigSq);
        color += texture(uTex, clamp(vUV + vec2(0.0, float(i) * uTexelSize.y), vec2(0.0), vec2(1.0))) * g;
        total += g;
    }
    fragColor = color / max(total, 0.0001);
}
`;

// Uniform blur across the whole image, blended back through the standard Fade
// weight (full image when fade is disabled). Replaces the old vignette-shaped mask.
const BLUR_COMPOSITE_GLSL = `
uniform sampler2D uTexOriginal;
uniform float blurAmount;
${blend.glsl}
${fade.glsl}
void main() {
    vec4 orig    = texture(uTexOriginal, vUV);
    vec4 blurred = texture(uTex, vUV);

    float weight = clamp(blurAmount / 100.0, 0.0, 1.0) * ${fade.fnName}();

    vec3 adjusted = mix(orig.rgb, blurred.rgb, weight);
    if (!${blend.thresholdFn}(orig, vec4(adjusted, orig.a))) { fragColor = orig; return; }
    fragColor = vec4(${blend.blendFn}(orig.rgb, adjusted), orig.a);
}
`;
