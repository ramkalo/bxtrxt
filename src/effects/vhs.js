import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('vhs');
const blend = buildBlendControl('vhs');

export const vhsEffect = {
    name: 'vhs',
    label: 'VHS Line Glitch',
    pass: 'pre-crt',
    paramKeys: ['vhsTracking', 'vhsTrackingThickness', 'vhsTrackingAmount', 'vhsTrackingSeed', 'vhsTrackingColor',
                'vhsTrackingAngle', 'vhsTrackingWobble', 'vhsTrackingWobbleSeed', ...fade.paramKeys, ...blend.paramKeys],
    handleParams: [...fade.handleParams],
    uiGroups: [
        { keys: ['vhsTracking', 'vhsTrackingThickness', 'vhsTrackingAmount', 'vhsTrackingSeed', 'vhsTrackingColor', 'vhsTrackingAngle', 'vhsTrackingWobble', 'vhsTrackingWobbleSeed', 'vhsTrackingWobbleBtn'] },
        fade.uiGroup,
        blend.uiGroup,
    ],
    params: {
        vhsEnabled:            { default: false, label: 'Enable' },
        vhsTracking:           { default: 0,  min: 0,    max: 100, label: 'Line Glitch' },
        vhsTrackingThickness:  { default: 3,  min: 1,    max: 50,  label: 'Thickness' },
        vhsTrackingAmount:     { default: 2,  min: 2,    max: 20,  label: 'Amount' },
        vhsTrackingSeed:       { default: 1,                        label: 'Spacing' },
        vhsTrackingColor:      { default: 'shift', label: 'Line Color', options: [['shift', 'Shift (default)'], ['white', 'White'], ['black', 'Black'], ['noise', 'Noise'], ['color', 'Color Noise']] },
        vhsTrackingAngle:      { default: 0,  min: -180, max: 180, label: 'Line Angle' },
        vhsTrackingWobble:     { default: 0,  min: 0,    max: 90,  label: 'Angle Wobble' },
        vhsTrackingWobbleSeed: { default: 1,  min: 1,    max: 999, step: 1, label: 'Wobble Seed' },
        vhsTrackingWobbleBtn:  { default: null, button: 'vhsTrackingWobbleSeed', label: 'Wobble Lines' },
        ...fade.params,
        ...blend.params,
    },
    enabled: (p) => p.vhsEnabled,
    overlays: { fade: fade.overlay },
    bindUniforms: (gl, prog, p) => {
        const loc = prog._locs['vhsTrackingColor'];
        if (loc != null) gl.uniform1i(loc, { shift: 0, white: 1, black: 2, noise: 3, color: 4 }[p.vhsTrackingColor] ?? 0);
        fade.bindUniforms(gl, prog, p);
        blend.bindUniforms(gl, prog, p);
    },
    glsl: `
uniform float vhsTracking;
uniform float vhsTrackingAmount;
uniform float vhsTrackingThickness;
uniform float vhsTrackingSeed;
uniform int   vhsTrackingColor;
uniform float vhsTrackingAngle;
uniform float vhsTrackingWobble;
uniform float vhsTrackingWobbleSeed;
${fade.glsl}
${blend.glsl}
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec4 c = texture(uTex, vUV);
    if (!${blend.thresholdFn}(c)) { fragColor = c; return; }
    vec4 col = c;

    if (vhsTracking > 0.0) {
        float px = vUV.x * uResolution.x;
        float py = (1.0 - vUV.y) * uResolution.y;
        int numBands = int(vhsTrackingAmount);
        float maxShift = ceil(vhsTracking / 100.0 * uResolution.x * 0.2);
        uint lcgState = uint(max(vhsTrackingSeed, 1.0)) * uint(1664525) + uint(1013904223);

        float baseRad   = vhsTrackingAngle  * (3.14159265 / 180.0);
        float wobbleRad = vhsTrackingWobble * (3.14159265 / 180.0);

        for (int t = 0; t < 20; t++) {
            if (t >= numBands) break;
            lcgState = uint(1664525) * lcgState + uint(1013904223);
            float bandY = float(lcgState) / 4294967296.0 * uResolution.y;
            bandY = clamp(bandY, 0.0, uResolution.y - 1.0);

            uint wblState = uint(t + 1) ^ uint(max(vhsTrackingWobbleSeed, 1.0));
            wblState = uint(1664525) * wblState + uint(1013904223);
            wblState = uint(1664525) * wblState + uint(1013904223);
            float wblRand   = float(wblState) / 4294967296.0 * 2.0 - 1.0;
            float lineAngle = baseRad + wobbleRad * wblRand;

            float proj = px * sin(lineAngle) + py * cos(lineAngle);

            uint hsh = (uint(t + 1) * uint(2654435761)) % uint(1000);
            float shift = (float(hsh) / 999.0 * 2.0 - 1.0) * maxShift;
            float thickMult = 0.5 + float((uint(t + 1) * uint(2246822519)) % uint(1000)) / 999.0;
            float bandThickness = max(1.0, vhsTrackingThickness * thickMult);

            if (proj >= bandY && proj < bandY + bandThickness) {
                if      (vhsTrackingColor == 1) { col = vec4(1.0); }
                else if (vhsTrackingColor == 2) { col = vec4(0.0, 0.0, 0.0, 1.0); }
                else if (vhsTrackingColor == 3) { float n = hash21(vUV); col = vec4(n, n, n, 1.0); }
                else if (vhsTrackingColor == 4) { col = vec4(hash21(vUV), hash21(vUV + vec2(0.1)), hash21(vUV + vec2(0.2)), 1.0); }
                else { col = texture(uTex, vec2(clamp(vUV.x + shift / uResolution.x, 0.0, 1.0), vUV.y)); }
                break;
            }
        }
    }

    float weight = ${fade.fnName}();
    vec3 faded   = mix(c.rgb, col.rgb, weight);
    fragColor = vec4(${blend.blendFn}(c.rgb, faded), c.a);
}
`,
};
