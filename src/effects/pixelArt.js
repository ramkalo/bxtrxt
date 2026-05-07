import { buildBlendControl } from './controls/index.js';

const blend = buildBlendControl('pixelArt');

export default {
    name: 'pixelArt',
    label: 'Pixel Art',
    pass: 'pre-crt',
    paramKeys: ['pixelSize', 'pixelColors', ...blend.paramKeys],
    uiGroups: [
        { keys: ['pixelSize', 'pixelColors'] },
        blend.uiGroup,
    ],
    params: {
        pixelArtEnabled: { default: false },
        pixelSize:       { default: 24, min: 2, max: 32 },
        pixelColors:     { default: 16, min: 2, max: 64 },
        ...blend.params,
    },
    enabled: (p) => p.pixelArtEnabled,
    bindUniforms: (gl, prog, p) => blend.bindUniforms(gl, prog, p),
    glsl: `
uniform float pixelSize;
uniform float pixelColors;
${blend.glsl}
void main() {
    vec4 c = texture(uTex, vUV);
    if (!${blend.thresholdFn}(c)) { fragColor = c; return; }
    vec2 pixelCoord = vUV * uResolution;
    vec2 cellUV = floor(pixelCoord / pixelSize) * pixelSize / uResolution;
    vec4 cell = texture(uTex, clamp(cellUV, vec2(0.0), vec2(1.0)));
    vec3 col = cell.rgb * 255.0;
    float qstep = 256.0 / pixelColors;
    col.r = floor(col.r / qstep) * qstep;
    col.g = floor(col.g / qstep) * qstep;
    col.b = floor(col.b / qstep) * qstep;
    fragColor = vec4(${blend.blendFn}(c.rgb, col / 255.0), c.a);
}
`,
};
