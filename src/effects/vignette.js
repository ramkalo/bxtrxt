import { buildBlendControl } from './controls/index.js';

const blend = buildBlendControl('vignette');

export default {
    name: 'vignette',
    label: 'Vignette',
    pass: 'pre-crt',
    paramKeys: ['vignetteMode', 'vignetteMajor', 'vignetteMinor', 'vignetteAngle', 'vignetteCenterX', 'vignetteCenterY', 'vignetteEdge', 'vignetteCenter', 'vignetteTransition', ...blend.paramKeys],
    handleParams: ['vignetteCenterX', 'vignetteCenterY', 'vignetteMajor', 'vignetteMinor', 'vignetteAngle'],
    uiGroups: [
        { keys: ['vignetteMode', 'vignetteEdge', 'vignetteCenter', 'vignetteTransition'] },
        blend.uiGroup,
    ],
    params: {
        vignetteEnabled: { default: false, label: 'Enable' },
        vignetteMode:    { default: 'ellipse', label: 'Mode', options: [['ellipse', 'Ellipse'], ['rectangle', 'Rectangle']] },
        vignetteMajor:   { default: 40, min: 0, max: 150, label: 'Major Axis' },
        vignetteMinor:   { default: 40, min: 0, max: 150, label: 'Minor Axis' },
        vignetteAngle:   { default: 0,   min: 0, max: 180, label: 'Angle' },
        vignetteCenterX: { default: 0,   min: -50, max: 50,  label: 'Center X' },
        vignetteCenterY: { default: 0,   min: -50, max: 50,  label: 'Center Y' },
        vignetteEdge:    { default: 0,   min: -100, max: 100, label: 'Edge Brightness' },
        vignetteCenter:     { default: 0,   min: -100, max: 100, label: 'Center Brightness' },
        vignetteTransition: { default: 2,   min: 0.5,  max: 5, step: 0.1, label: 'Transition' },
        ...blend.params,
    },
    enabled: (p) => p.vignetteEnabled,
    bindUniforms: (gl, prog, p) => {
        const loc = prog._locs['vignetteMode'];
        if (loc != null) gl.uniform1i(loc, p.vignetteMode === 'rectangle' ? 1 : 0);
        blend.bindUniforms(gl, prog, p);
    },
    glsl: `
uniform float vignetteMajor;
uniform float vignetteMinor;
uniform float vignetteAngle;
uniform float vignetteCenterX;
uniform float vignetteCenterY;
uniform float vignetteEdge;
uniform float vignetteCenter;
uniform float vignetteTransition;
uniform int   vignetteMode;
${blend.glsl}
void main() {
    vec4 c = texture(uTex, vUV);
    if (!${blend.thresholdFn}(c)) { fragColor = c; return; }
    float a = max((vignetteMajor / 100.0) * 0.7071, 1e-5);
    float b = max((vignetteMinor / 100.0) * 0.7071, 1e-5);
    float centerUX = 0.5 + vignetteCenterX / 100.0;
    float centerUY = 0.5 - vignetteCenterY / 100.0;
    float angleRad = vignetteAngle * 3.14159265 / 180.0;
    float cosA = cos(angleRad), sinA = sin(angleRad);
    float dx = vUV.x - centerUX;
    float dy = (1.0 - vUV.y) - centerUY;
    float rx =  cosA*dx + sinA*dy;
    float ry = -sinA*dx + cosA*dy;
    float dist = (vignetteMode == 1)
        ? max(abs(rx)/a, abs(ry)/b)
        : sqrt((rx/a)*(rx/a) + (ry/b)*(ry/b));
    float falloff      = pow(clamp(dist - 1.0, 0.0, 1.0), max(vignetteTransition, 0.01));
    float edgeFactor   = max(0.0, 1.0 + falloff * (vignetteEdge   / 100.0));
    float centerFactor = max(0.0, 1.0 + (1.0 - falloff) * (vignetteCenter / 100.0));
    vec3 adjusted = clamp(c.rgb * edgeFactor * centerFactor, 0.0, 1.0);
    fragColor = vec4(${blend.blendFn}(c.rgb, adjusted), c.a);
}
`,
};
