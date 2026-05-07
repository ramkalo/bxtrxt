import { buildBlendControl } from './controls/index.js';

const blend = buildBlendControl('crtCurvature');

export default {
    name: 'crtCurvature',
    label: 'CRT Curvature',
    pass: 'post',
    paramKeys: ['crtCurvatureStrength', 'crtCurvatureX', 'crtCurvatureY', 'crtCurvatureMajor', 'crtCurvatureMinor', 'crtCurvatureAngle', ...blend.paramKeys],
    handleParams: ['crtCurvatureX', 'crtCurvatureY', 'crtCurvatureAngle'],
    uiGroups: [
        { keys: ['crtCurvatureEnabled', 'crtCurvatureStrength'] },
        { label: 'Shape & Position', keys: ['crtCurvatureMajor', 'crtCurvatureMinor', 'crtCurvatureAngle', 'crtCurvatureX', 'crtCurvatureY'] },
        blend.uiGroup,
    ],
    params: {
        crtCurvatureEnabled:   { default: false, label: 'Enable' },
        crtCurvatureStrength:  { default: 70,   min: 0,   max: 100, label: 'Strength' },
        crtCurvatureX:         { default: 0,   min: -50, max: 50,   label: 'Center X' },
        crtCurvatureY:         { default: 0,   min: -50, max: 50,   label: 'Center Y' },
        crtCurvatureMajor:     { default: 60,  min: 0,   max: 150,  label: 'Major Axis' },
        crtCurvatureMinor:     { default: 60,  min: 0,   max: 150,  label: 'Minor Axis' },
        crtCurvatureAngle:     { default: 0,   min: 0,   max: 180,  label: 'Angle' },
        ...blend.params,
    },
    enabled: (p) => p.crtCurvatureEnabled,
    bindUniforms: (gl, prog, p) => blend.bindUniforms(gl, prog, p),
    glsl: `
uniform float crtCurvatureStrength;
uniform float crtCurvatureX;
uniform float crtCurvatureY;
uniform float crtCurvatureMajor;
uniform float crtCurvatureMinor;
uniform float crtCurvatureAngle;
${blend.glsl}
void main() {
    vec4 c = texture(uTex, vUV);
    if (!${blend.thresholdFn}(c)) { fragColor = c; return; }
    float cx = (0.5 + crtCurvatureX / 100.0) * uResolution.x;
    float cy = (0.5 - crtCurvatureY / 100.0) * uResolution.y;
    float k = crtCurvatureStrength / 100.0;

    float imgX = vUV.x * uResolution.x;
    float imgY = (1.0 - vUV.y) * uResolution.y;
    float dx = imgX - cx;
    float dy = imgY - cy;

    float angleRad = crtCurvatureAngle * 3.14159265 / 180.0;
    float cosA = cos(angleRad);
    float sinA = sin(angleRad);
    float rx = dx * cosA + dy * sinA;
    float ry = -dx * sinA + dy * cosA;

    float a = max((crtCurvatureMajor / 100.0) * 0.7071 * uResolution.x, 1e-5);
    float b = max((crtCurvatureMinor / 100.0) * 0.7071 * uResolution.y, 1e-5);

    float dist = sqrt((rx/a)*(rx/a) + (ry/b)*(ry/b));
    float falloff = max(0.0, 1.0 - dist);
    float factor = 1.0 - k * falloff;

    float srcX = cx + dx * factor;
    float srcY = cy + dy * factor;

    vec2 sampleUV = clamp(vec2(srcX / uResolution.x, 1.0 - srcY / uResolution.y), vec2(0.0), vec2(1.0));
    vec3 adjusted = texture(uTex, sampleUV).rgb;
    fragColor = vec4(${blend.blendFn}(c.rgb, adjusted), c.a);
}
`,
};
