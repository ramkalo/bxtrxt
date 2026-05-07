import { buildBlendControl } from './controls/index.js';

const blend = buildBlendControl('moire');

export default {
    name: 'moire',
    label: 'Moire',
    pass: 'post',
    paramKeys: ['moireStrength', 'moireFrequency', 'moireOffset', 'moireAngle', 'moireRotation', ...blend.paramKeys],
    params: {
        moireEnabled:   { default: false },
        moireStrength:  { default: 80,  min: 0,   max: 100 },
        moireFrequency: { default: 8,   min: 1,   max: 80  },
        moireOffset:    { default: 10,  min: 0,   max: 50  },
        moireAngle:     { default: 5,   min: 0,   max: 45  },
        moireRotation:  { default: 0,   min: 0,   max: 360 },
        ...blend.params,
    },
    uiGroups: [
        { keys: ['moireEnabled', 'moireStrength', 'moireFrequency'] },
        { label: 'Pattern', keys: ['moireOffset', 'moireAngle', 'moireRotation'] },
        blend.uiGroup,
    ],
    enabled: (p) => p.moireEnabled,
    bindUniforms: (gl, prog, p) => blend.bindUniforms(gl, prog, p),
    glsl: `
uniform float moireStrength;
uniform float moireFrequency;
uniform float moireOffset;
uniform float moireAngle;
uniform float moireRotation;
${blend.glsl}
void main() {
    vec4 c = texture(uTex, vUV);
    if (!${blend.thresholdFn}(c)) { fragColor = c; return; }

    vec2 pos = vec2(vUV.x * uResolution.x, (1.0 - vUV.y) * uResolution.y);

    float baseRad = moireRotation * 3.14159265 / 180.0;
    float halfSep = moireAngle * 0.5 * 3.14159265 / 180.0;

    float angle1 = baseRad - halfSep;
    float angle2 = baseRad + halfSep;

    float spacing = max(moireFrequency, 1.0);
    float ratio   = 1.0 + moireOffset / 100.0;

    float proj1 = pos.x * cos(angle1) + pos.y * sin(angle1);
    float proj2 = pos.x * cos(angle2) + pos.y * sin(angle2);

    float grid1 = 0.5 + 0.5 * cos(proj1 / spacing * 6.28318530718);
    float grid2 = 0.5 + 0.5 * cos(proj2 / (spacing * ratio) * 6.28318530718);

    float pattern = grid1 * grid2;

    float intensity = (moireStrength / 100.0) * 0.9;
    vec3 adjusted = c.rgb * (1.0 - intensity * (1.0 - pattern));
    fragColor = vec4(${blend.blendFn}(c.rgb, adjusted), c.a);
}
`,
};
