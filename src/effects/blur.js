import { buildBlendControl } from './controls/index.js';

const blend = buildBlendControl('blur');

export default {
    name:  'blur',
    label: 'Blur',
    pass:  'pre-crt',
    paramKeys: ['blurEdge', 'blurCenter', 'blurPasses', 'blurMode', 'blurMajor', 'blurMinor', 'blurAngle', 'blurCenterX', 'blurCenterY', ...blend.paramKeys],
    handleParams: ['blurMajor', 'blurMinor', 'blurAngle'],
    uiGroups: [
        { keys: ['blurEdge', 'blurCenter', 'blurPasses', 'blurMode'] },
        blend.uiGroup,
    ],
    params: {
        blurEnabled: { default: false, label: 'Enable' },
        blurEdge:    { default: 100, min: 0,   max: 100, label: 'Edge Intensity' },
        blurCenter:  { default: 0,   min: 0,   max: 100, label: 'Center Intensity' },
        blurPasses:  { default: 1,   min: 1,   max: 24,   label: 'Blur Power' },
        blurMode:    { default: 'ellipse', label: 'Mode', options: [['ellipse', 'Ellipse'], ['rectangle', 'Rectangle']] },
        blurMajor:   { default: 35, min: 0,   max: 150, label: 'Major Axis' },
        blurMinor:   { default: 35, min: 0,   max: 150, label: 'Minor Axis' },
        blurAngle:   { default: 0,   min: 0,   max: 180, label: 'Angle' },
        blurCenterX: { default: 0,   min: -50, max: 50,  label: 'Center X' },
        blurCenterY: { default: 0,   min: -50, max: 50,  label: 'Center Y' },
        ...blend.params,
    },
    enabled:  (p) => p.blurEnabled,
    bindUniforms: (gl, prog, p) => {
        const loc = prog._locs['blurMode'];
        if (loc != null) gl.uniform1i(loc, p.blurMode === 'rectangle' ? 1 : 0);
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

const BLUR_COMPOSITE_GLSL = `
uniform sampler2D uTexOriginal;
uniform float blurEdge;
uniform float blurCenter;
uniform float blurMajor;
uniform float blurMinor;
uniform float blurAngle;
uniform float blurCenterX;
uniform float blurCenterY;
uniform int   blurMode;
${blend.glsl}
void main() {
    vec4 orig    = texture(uTexOriginal, vUV);
    if (!${blend.thresholdFn}(orig)) { fragColor = orig; return; }
    vec4 blurred = texture(uTex, vUV);

    float centerUX = 0.5 + blurCenterX / 100.0;
    float centerUY = 0.5 - blurCenterY / 100.0;
    float dx = vUV.x - centerUX;
    float dy = (1.0 - vUV.y) - centerUY;

    float angleRad = blurAngle * 3.14159265 / 180.0;
    float cosA = cos(angleRad), sinA = sin(angleRad);
    float rx =  cosA * dx + sinA * dy;
    float ry = -sinA * dx + cosA * dy;

    float a = (blurMajor / 100.0) * 0.7071;
    float b = (blurMinor / 100.0) * 0.7071;
    float dist = (blurMode == 1)
        ? max(abs(rx) / max(a, 0.001), abs(ry) / max(b, 0.001))
        : sqrt(pow(rx / max(a, 0.001), 2.0) + pow(ry / max(b, 0.001), 2.0));
    float falloff = pow(clamp(dist, 0.0, 1.0), 2.0);
    float edgeStr   = blurEdge   / 100.0;
    float centerStr = blurCenter / 100.0;
    float weight = clamp(falloff * edgeStr + (1.0 - falloff) * centerStr, 0.0, 1.0);

    vec3 adjusted = mix(orig.rgb, blurred.rgb, weight);
    fragColor = vec4(${blend.blendFn}(orig.rgb, adjusted), orig.a);
}
`;
