import { secondTexture } from '../renderer/glstate.js';

export default {
    name: 'doubleExposure',
    label: 'Double Exposure',
    pass: 'pre-crt',
    paramKeys: [
        'doubleExposureChannelMode', 'doubleExposureBlendMode',
        'doubleExposureOrigOpacity', 'doubleExposureOpacity',
        'doubleExposureIntensity', 'doubleExposureReverseLum',
        'doubleExposureThreshSat', 'doubleExposureReverseSat',
        'doubleExposureFadeEnabled', 'doubleExposureFadeShape',
        'doubleExposureFade', 'doubleExposureFadeSlope', 'doubleExposureFadeInvert',
    ],
    handleParams: [
        'doubleExposureTexX', 'doubleExposureTexY',
        'doubleExposureFadeX', 'doubleExposureFadeY',
        'doubleExposureFadeW', 'doubleExposureFadeH', 'doubleExposureFadeAngle',
    ],
    uiGroups: [
        { keys: ['doubleExposureBlendMode', 'doubleExposureOrigOpacity', 'doubleExposureOpacity'] },
        { label: 'Threshold', keys: ['doubleExposureChannelMode', 'doubleExposureIntensity', 'doubleExposureReverseLum', 'doubleExposureThreshSat', 'doubleExposureReverseSat'] },
        { label: 'Fade', keys: ['doubleExposureFadeEnabled', 'doubleExposureFadeShape', 'doubleExposureFade', 'doubleExposureFadeSlope', 'doubleExposureFadeInvert'] },
    ],
    params: {
        doubleExposureEnabled:     { default: false },
        doubleExposureBlendMode:   { default: 'screen' },
        doubleExposureOrigOpacity: { default: 100, min: 0, max: 100 },
        doubleExposureOpacity:     { default: 100, min: 0, max: 100 },
        doubleExposureChannelMode: { default: 'all' },
        doubleExposureIntensity:   { default: 100, min: 0, max: 100 },
        doubleExposureReverseLum:  { default: false },
        doubleExposureThreshSat:   { default: 0, min: 0, max: 100 },
        doubleExposureReverseSat:  { default: false },
        doubleExposureFadeEnabled: { default: false },
        doubleExposureFadeShape:   { default: 'ellipse' },
        doubleExposureFade:        { default: 20, min: 0, max: 100 },
        doubleExposureFadeW:       { default: 40, min: 1, max: 200 },
        doubleExposureFadeH:       { default: 40, min: 1, max: 200 },
        doubleExposureFadeSlope:   { default: 3, min: 0.1, max: 8, step: 0.1 },
        doubleExposureFadeInvert:  { default: true },
        doubleExposureFadeAngle:   { default: 0, min: -180, max: 180 },
        doubleExposureFadeX:       { default: 0, min: -50, max: 50 },
        doubleExposureFadeY:       { default: 0, min: -50, max: 50 },
        doubleExposureTexX:        { default: 0, min: -100, max: 100 },
        doubleExposureTexY:        { default: 0, min: -100, max: 100 },
    },
    enabled: (p) => p.doubleExposureEnabled && !!secondTexture,
    bindUniforms: (gl, prog, p) => {
        const chanMap  = { all: 7, r: 1, g: 2, b: 4 };
        const blendMap = { normal: 0, screen: 1, multiply: 2, add: 3, overlay: 4, difference: 5 };
        const shapeMap = { ellipse: 0, rectangle: 1 };

        const set1i = (name, val) => { const loc = prog._locs[name]; if (loc != null) gl.uniform1i(loc, val); };
        const set1f = (name, val) => { const loc = prog._locs[name]; if (loc != null) gl.uniform1f(loc, val); };

        set1i('doubleExposureChannelMode', chanMap[p.doubleExposureChannelMode] ?? 7);
        set1i('doubleExposureBlendMode',   blendMap[p.doubleExposureBlendMode]  ?? 1);
        set1i('doubleExposureReverseLum',  p.doubleExposureReverseLum  ? 1 : 0);
        set1i('doubleExposureReverseSat',  p.doubleExposureReverseSat  ? 1 : 0);
        set1i('doubleExposureFadeEnabled', p.doubleExposureFadeEnabled ? 1 : 0);
        set1i('doubleExposureFadeShape',   shapeMap[p.doubleExposureFadeShape]  ?? 0);
        set1i('doubleExposureFadeInvert',  p.doubleExposureFadeInvert  ? 1 : 0);

        set1f('doubleExposureOrigOpacity', p.doubleExposureOrigOpacity);
        set1f('doubleExposureOpacity',     p.doubleExposureOpacity);
        set1f('doubleExposureIntensity',   p.doubleExposureIntensity);
        set1f('doubleExposureThreshSat',   p.doubleExposureThreshSat);
        set1f('doubleExposureFade',        p.doubleExposureFade);
        set1f('doubleExposureFadeW',       p.doubleExposureFadeW);
        set1f('doubleExposureFadeH',       p.doubleExposureFadeH);
        set1f('doubleExposureFadeSlope',   p.doubleExposureFadeSlope);
        set1f('doubleExposureFadeAngle',   p.doubleExposureFadeAngle);
        set1f('doubleExposureFadeX',       p.doubleExposureFadeX);
        set1f('doubleExposureFadeY',       p.doubleExposureFadeY);
        set1f('doubleExposureTexX',        p.doubleExposureTexX);
        set1f('doubleExposureTexY',        p.doubleExposureTexY);

        const texLoc = prog._locs['uSecondTex'];
        if (texLoc != null && secondTexture) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, secondTexture);
            gl.uniform1i(texLoc, 1);
        }
    },
    glsl: `
uniform sampler2D uSecondTex;
uniform int   doubleExposureChannelMode;
uniform int   doubleExposureBlendMode;
uniform float doubleExposureOrigOpacity;
uniform float doubleExposureOpacity;
uniform float doubleExposureIntensity;
uniform int   doubleExposureReverseLum;
uniform float doubleExposureThreshSat;
uniform int   doubleExposureReverseSat;
uniform int   doubleExposureFadeEnabled;
uniform int   doubleExposureFadeShape;
uniform float doubleExposureFade;
uniform float doubleExposureFadeW;
uniform float doubleExposureFadeH;
uniform float doubleExposureFadeSlope;
uniform int   doubleExposureFadeInvert;
uniform float doubleExposureFadeAngle;
uniform float doubleExposureFadeX;
uniform float doubleExposureFadeY;
uniform float doubleExposureTexX;
uniform float doubleExposureTexY;

float blendCh(float a, float b) {
    if      (doubleExposureBlendMode == 1) return 1.0 - (1.0-a)*(1.0-b);
    else if (doubleExposureBlendMode == 2) return a * b;
    else if (doubleExposureBlendMode == 3) return min(1.0, a + b);
    else if (doubleExposureBlendMode == 4) return a < 0.5 ? 2.0*a*b : 1.0 - 2.0*(1.0-a)*(1.0-b);
    else if (doubleExposureBlendMode == 5) return abs(a - b);
    return a;
}

void main() {
    vec4 orig = texture(uTex, vUV);

    vec2 secUV = vUV - vec2(doubleExposureTexX / 100.0, doubleExposureTexY / 100.0);
    if (secUV.x < 0.0 || secUV.x > 1.0 || secUV.y < 0.0 || secUV.y > 1.0) {
        fragColor = orig; return;
    }
    vec4 sec = texture(uSecondTex, secUV);

    float lum = dot(orig.rgb, vec3(0.299, 0.587, 0.114));
    float lumThresh = doubleExposureIntensity / 100.0;
    bool lumMet = (doubleExposureReverseLum == 1) ? (lum <= lumThresh) : (lum >= lumThresh);

    // In channel-targeted modes, saturation measures how dominant that channel is
    // over the other two (e.g. red=0.9 vs orange where red=0.4 over green).
    // In All mode, use standard HSL saturation.
    float satVal;
    if      (doubleExposureChannelMode == 1) satVal = orig.r - max(orig.g, orig.b);
    else if (doubleExposureChannelMode == 2) satVal = orig.g - max(orig.r, orig.b);
    else if (doubleExposureChannelMode == 4) satVal = orig.b - max(orig.r, orig.g);
    else {
        float cMax = max(orig.r, max(orig.g, orig.b));
        float cMin = min(orig.r, min(orig.g, orig.b));
        satVal = (cMax > 0.0) ? (cMax - cMin) / cMax : 0.0;
    }
    float satThresh = doubleExposureThreshSat / 100.0;
    bool satMet = (doubleExposureReverseSat == 1) ? (satVal <= satThresh) : (satVal >= satThresh);

    if (!lumMet || !satMet) { fragColor = orig; return; }

    // Channel targeting: skip pixel if its dominant channel doesn't match selection
    if (doubleExposureChannelMode != 7) {
        bool dominated =
            (doubleExposureChannelMode == 1 && orig.r >= orig.g && orig.r >= orig.b) ||
            (doubleExposureChannelMode == 2 && orig.g >= orig.r && orig.g >= orig.b) ||
            (doubleExposureChannelMode == 4 && orig.b >= orig.r && orig.b >= orig.g);
        if (!dominated) { fragColor = orig; return; }
    }

    // Scale original before blending — lower values let the second image dominate
    vec3 base = orig.rgb * (doubleExposureOrigOpacity / 100.0);

    vec3 result = vec3(blendCh(base.r, sec.r), blendCh(base.g, sec.g), blendCh(base.b, sec.b));

    result = mix(base, result, doubleExposureOpacity / 100.0);

    float weight = 1.0;
    if (doubleExposureFadeEnabled == 1 && doubleExposureFade > 0.0) {
        float imgX = vUV.x * uResolution.x;
        float imgY = (1.0 - vUV.y) * uResolution.y;
        float cx = (0.5 + doubleExposureFadeX / 100.0) * uResolution.x;
        float cy = (0.5 - doubleExposureFadeY / 100.0) * uResolution.y;
        float dx = imgX - cx;
        float dy = imgY - cy;
        float rad = doubleExposureFadeAngle * 3.14159265 / 180.0;
        float cosA = cos(rad), sinA = sin(rad);
        float rdx = dx * cosA + dy * sinA;
        float rdy = -dx * sinA + dy * cosA;
        float hw = max(1.0, (doubleExposureFadeW / 100.0) * uResolution.x / 2.0);
        float hh = max(1.0, (doubleExposureFadeH / 100.0) * uResolution.y / 2.0);
        float t = (doubleExposureFadeShape == 0)
            ? sqrt(pow(rdx / hw, 2.0) + pow(rdy / hh, 2.0))
            : max(abs(rdx) / hw, abs(rdy) / hh);
        float beyond = max(0.0, t - 1.0);
        float fadeAmt = doubleExposureFade / 100.0;
        weight = (doubleExposureFadeInvert == 1)
            ? clamp(beyond * doubleExposureFadeSlope * fadeAmt, 0.0, 1.0)
            : clamp(1.0 - beyond * doubleExposureFadeSlope * fadeAmt, 0.0, 1.0);
    }

    // Fade masks back to original (unscaled), not base
    result = mix(orig.rgb, result, weight);
    fragColor = vec4(result, orig.a);
}
`,
};
