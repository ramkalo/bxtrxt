import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('digitize');
const blend = buildBlendControl('digitize');

export default {
    name: 'digitize',
    label: 'Digitize',
    pass: 'pre-crt',
    paramKeys: ['pixelSize', 'pixelColors', 'digitizeDither', 'digitizeNoise', ...fade.paramKeys, ...blend.paramKeys],
    handleParams: [...fade.handleParams],
    uiGroups: [
        { keys: ['pixelSize', 'pixelColors', 'digitizeDither', 'digitizeNoise'] },
        fade.uiGroup,
        blend.uiGroup,
    ],
    params: {
        digitizeEnabled: { default: false, label: 'Enable' },
        pixelSize:       { default: 1,  min: 1,  max: 32,  label: 'Pixel Size' },
        pixelColors:     { default: 16, min: 2,  max: 64,  label: '# Colors' },
        digitizeDither:  { default: 0,  min: 0,  max: 100, label: 'Dithering' },
        digitizeNoise:   { default: 0,  min: 0,  max: 100, label: 'Noise' },
        ...fade.params,
        ...blend.params,
    },
    enabled: (p) => p.digitizeEnabled,
    overlays: { fade: fade.overlay },
    bindUniforms: (gl, prog, p) => { fade.bindUniforms(gl, prog, p); blend.bindUniforms(gl, prog, p); },
    glsl: `
uniform float pixelSize;
uniform float pixelColors;
uniform float digitizeDither;
uniform float digitizeNoise;
${fade.glsl}
${blend.glsl}
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec4 c = texture(uTex, vUV);
    if (!${blend.thresholdFn}(c)) { fragColor = c; return; }
    vec2 pixelCoord = vUV * uResolution;

    vec2 cellUV = (pixelSize > 1.0)
        ? floor(pixelCoord / pixelSize) * pixelSize / uResolution
        : vUV;
    vec4 cell = texture(uTex, clamp(cellUV, vec2(0.0), vec2(1.0)));
    vec3 col = cell.rgb * 255.0;

    float qstep = 256.0 / pixelColors;
    col.r = floor(col.r / qstep) * qstep;
    col.g = floor(col.g / qstep) * qstep;
    col.b = floor(col.b / qstep) * qstep;

    if (digitizeDither > 0.0) {
        const float bayer[16] = float[16](
             0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
            12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
             3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
            15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
        );
        int bx = int(mod(pixelCoord.x, 4.0));
        int by = int(mod(pixelCoord.y, 4.0));
        float threshold = bayer[by * 4 + bx];
        float ditherAmt = digitizeDither / 100.0;
        col += (threshold - 0.5) * 32.0 * ditherAmt;
        col.r = round(col.r / 32.0) * 32.0;
        col.g = round(col.g / 32.0) * 32.0;
        col.b = round(col.b / 32.0) * 32.0;
    }

    if (digitizeNoise > 0.0) {
        col += (hash21(vUV) - 0.5) * (digitizeNoise / 100.0) * 80.0;
    }

    float weight  = ${fade.fnName}();
    vec3 adjusted = clamp(col, 0.0, 255.0) / 255.0;
    vec3 faded    = mix(c.rgb, adjusted, weight);
    fragColor = vec4(${blend.blendFn}(c.rgb, faded), c.a);
}
`,
};
