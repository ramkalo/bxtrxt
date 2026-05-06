import { buildFadeControl } from './controls/index.js';

const fade = buildFadeControl('glow');

const GLOW_THRESHOLD_GLSL = `
uniform float glowThreshold;

void main() {
    vec4 c = texture(uTex, vUV);
    float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114)) * 255.0;
    if (lum > glowThreshold) {
        float factor = (lum - glowThreshold) / max(255.0 - glowThreshold, 0.001);
        fragColor = vec4(c.rgb * factor, 1.0);
    } else {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
}
`;

const GLOW_BLUR_H_GLSL = `
uniform float glowRadius;

void main() {
    int r = int(glowRadius + 0.5);
    float sigma = max(glowRadius, 1.0);
    float twoSigSq = 2.0 * sigma * sigma;
    vec4 color = vec4(0.0);
    float total = 0.0;
    for (int i = -60; i <= 60; i++) {
        if (i < -r || i > r) continue;
        float g = exp(-float(i * i) / twoSigSq);
        color += texture(uTex, clamp(vUV + vec2(float(i) * uTexelSize.x, 0.0), vec2(0.0), vec2(1.0))) * g;
        total += g;
    }
    fragColor = color / max(total, 0.0001);
}
`;

const GLOW_BLUR_V_GLSL = `
uniform float glowRadius;

void main() {
    int r = int(glowRadius + 0.5);
    float sigma = max(glowRadius, 1.0);
    float twoSigSq = 2.0 * sigma * sigma;
    vec4 color = vec4(0.0);
    float total = 0.0;
    for (int i = -60; i <= 60; i++) {
        if (i < -r || i > r) continue;
        float g = exp(-float(i * i) / twoSigSq);
        color += texture(uTex, clamp(vUV + vec2(0.0, float(i) * uTexelSize.y), vec2(0.0), vec2(1.0))) * g;
        total += g;
    }
    fragColor = color / max(total, 0.0001);
}
`;

const GLOW_COMPOSITE_GLSL = `
uniform sampler2D uTexOriginal;
uniform float glowIntensity;
${fade.glsl}
void main() {
    vec4 orig    = texture(uTexOriginal, vUV);
    vec4 blurred = texture(uTex, vUV);

    float weight = ${fade.fnName}();

    float intensity = glowIntensity / 100.0;
    vec3 glow = blurred.rgb * intensity * weight;
    vec3 result = 1.0 - (1.0 - orig.rgb) * (1.0 - glow);
    fragColor = vec4(clamp(result, 0.0, 1.0), orig.a);
}
`;

export default {
    name: 'glow',
    label: 'Glow',
    pass: 'pre-crt',
    paramKeys: [
        'glowThreshold', 'glowRadius', 'glowIntensity',
        ...fade.paramKeys,
    ],
    handleParams: [...fade.handleParams],
    params: {
        glowEnabled:   { default: false, label: 'Enable' },
        glowIntensity: { default: 80,  min: 0,   max: 300, label: 'Intensity' },
        glowRadius:    { default: 60,  min: 1,   max: 60,  label: 'Radius' },
        glowThreshold: { default: 0,   min: 0,   max: 255, label: 'Threshold' },
        ...fade.params,
    },
    enabled: (p) => p.glowEnabled,
    uiGroups: [
        { keys: ['glowThreshold', 'glowRadius', 'glowIntensity'] },
        fade.uiGroup,
    ],
    overlays: { fade: fade.overlay },
    bindUniforms: (gl, prog, p) => fade.bindUniforms(gl, prog, p),
    glslPasses: [
        { glsl: GLOW_THRESHOLD_GLSL },
        { glsl: GLOW_BLUR_H_GLSL },
        { glsl: GLOW_BLUR_V_GLSL },
        { glsl: GLOW_COMPOSITE_GLSL, needsOriginal: true },
    ],
};
