import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('grain');
const blend = buildBlendControl('grain');

export default {
    name: 'grain',
    label: 'Film Grain',
    pass: 'pre-crt',
    paramKeys: ['grainIntensity', 'grainSize', ...fade.paramKeys, ...blend.paramKeys],
    handleParams: [...fade.handleParams],
    uiGroups: [
        { keys: ['grainIntensity', 'grainSize'] },
        fade.uiGroup,
        blend.uiGroup,
    ],
    params: {
        grainEnabled:   { default: false, label: 'Enable' },
        grainIntensity: { default: 0, min: 0, max: 100, label: 'Intensity' },
        grainSize:      { default: 1, min: 1, max: 10,  label: 'Grain Size' },
        ...fade.params,
        ...blend.params,
    },
    enabled: (p) => p.grainEnabled && p.grainIntensity > 0,
    overlays: { fade: fade.overlay },
    bindUniforms: (gl, prog, p) => { fade.bindUniforms(gl, prog, p); blend.bindUniforms(gl, prog, p); },
    glsl: `
uniform float grainIntensity;
uniform float grainSize;
${fade.glsl}
${blend.glsl}
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec4 c = texture(uTex, vUV);
    if (!${blend.thresholdFn}(c)) { fragColor = c; return; }
    float intensity = grainIntensity / 100.0 * 150.0;
    float gs = max(1.0, grainSize);
    vec2 cellUV = floor(vUV * uResolution / gs) * gs / uResolution;
    float noise = (hash21(cellUV) - 0.5) * intensity;
    float weight  = ${fade.fnName}();
    vec3 adjusted = clamp(c.rgb * 255.0 + noise, 0.0, 255.0) / 255.0;
    vec3 faded    = mix(c.rgb, adjusted, weight);
    fragColor = vec4(${blend.blendFn}(c.rgb, faded), c.a);
}
`,
};
