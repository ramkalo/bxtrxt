export default {
    name: 'waves',
    label: 'Chroma Waves',
    pass: 'post',
    paramKeys: ['wavesR', 'wavesG', 'wavesB', 'wavesPhase',
                'wavesFadeEnabled', 'wavesFadeShape', 'wavesFade', 'wavesFadeW', 'wavesFadeH',
                'wavesFadeSlope', 'wavesFadeInvert', 'wavesFadeAngle', 'wavesFadeX', 'wavesFadeY'],
    handleParams: ['wavesFadeX', 'wavesFadeY', 'wavesFadeW', 'wavesFadeH', 'wavesFadeAngle'],
    uiGroups: [
        { keys: ['wavesR', 'wavesG', 'wavesB', 'wavesPhase'] },
        { label: 'Fade', keys: ['wavesFadeEnabled', 'wavesFadeShape', 'wavesFade', 'wavesFadeSlope', 'wavesFadeInvert'] },
    ],
    params: {
        wavesEnabled:     { default: false },
        wavesR:           { default: 0, min: -20, max: 20 },
        wavesG:           { default: 0, min: -20, max: 20 },
        wavesB:           { default: 0, min: -20, max: 20 },
        wavesPhase:       { default: 0, min: 0,   max: 100 },
        wavesFadeEnabled: { default: false },
        wavesFadeShape:   { default: 'ellipse' },
        wavesFade:        { default: 20,   min: 1,    max: 100 },
        wavesFadeW:       { default: 40, min: 1,    max: 200 },
        wavesFadeH:       { default: 40, min: 1,    max: 200 },
        wavesFadeSlope:   { default: 3,   min: 0.1,  max: 8, step: 0.1 },
        wavesFadeInvert:  { default: true },
        wavesFadeAngle:   { default: 0,   min: -180, max: 180 },
        wavesFadeX:       { default: 0,   min: -50,  max: 50 },
        wavesFadeY:       { default: 0,   min: -50,  max: 50 },
    },
    enabled: (p) => p.wavesEnabled && (p.wavesR !== 0 || p.wavesG !== 0 || p.wavesB !== 0),
    bindUniforms: (gl, prog, p) => {
        const loc = prog._locs['wavesFadeShape'];
        if (loc != null) gl.uniform1i(loc, { ellipse: 0, rectangle: 1 }[p.wavesFadeShape] ?? 0);
    },
    glsl: `
uniform float wavesR;
uniform float wavesG;
uniform float wavesB;
uniform float wavesPhase;
uniform int   wavesFadeEnabled;
uniform int   wavesFadeShape;   // 0=ellipse 1=rectangle
uniform float wavesFade;
uniform float wavesFadeW;
uniform float wavesFadeH;
uniform float wavesFadeSlope;
uniform float wavesFadeAngle;
uniform float wavesFadeX;
uniform float wavesFadeY;
uniform int   wavesFadeInvert;

float wavesFormula(float xN, float yN) {
    return
        3.2 * sin(xN + 0.3 * cos(2.1 * xN) + yN) +
        2.1 * cos(0.73 * xN - 1.4 + yN * 0.7) * sin(0.5 * xN + 0.9 + yN * 0.5) +
        1.8 * sin(2.3 * xN + cos(xN) + yN * 0.3) * exp(-0.02 * pow(xN - 2.0, 2.0)) +
        0.9 * cos(3.7 * xN - 0.8 + yN * 0.4) * (1.0 / (1.0 + 0.15 * xN * xN)) +
        1.2 * sin(0.41 * xN * xN - xN + yN * 0.6);
}

void main() {
    float ampR  = wavesR / 100.0 * 80.0;
    float ampG  = wavesG / 100.0 * 80.0;
    float ampB  = wavesB / 100.0 * 80.0;
    float phase = wavesPhase / 100.0 * 20.0;

    float xNorm = vUV.x * 10.0 + phase;
    float yNorm = (1.0 - vUV.y) * 8.0;
    float wave  = wavesFormula(xNorm, yNorm);

    vec4 orig = texture(uTex, vUV);
    float r = texture(uTex, clamp(vec2(vUV.x + wave * ampR / uResolution.x, vUV.y), vec2(0.0), vec2(1.0))).r;
    float g = texture(uTex, clamp(vec2(vUV.x + wave * ampG / uResolution.x, vUV.y), vec2(0.0), vec2(1.0))).g;
    float b = texture(uTex, clamp(vec2(vUV.x + wave * ampB / uResolution.x, vUV.y), vec2(0.0), vec2(1.0))).b;

    float weight = 1.0;
    if (wavesFadeEnabled == 1 && wavesFade > 0.0) {
        float imgX = vUV.x * uResolution.x;
        float imgY = (1.0 - vUV.y) * uResolution.y;
        float cx = (0.5 + wavesFadeX / 100.0) * uResolution.x;
        float cy = (0.5 - wavesFadeY / 100.0) * uResolution.y;
        float dx = imgX - cx, dy = imgY - cy;
        float rad = wavesFadeAngle * 3.14159265 / 180.0;
        float cosA = cos(rad), sinA = sin(rad);
        float rdx =  dx * cosA + dy * sinA;
        float rdy = -dx * sinA + dy * cosA;
        float t;
        float hw = max(1.0, (wavesFadeW / 100.0) * uResolution.x / 2.0);
        float hh = max(1.0, (wavesFadeH / 100.0) * uResolution.y / 2.0);
        if (wavesFadeShape == 0) {
            t = sqrt(pow(rdx/hw, 2.0) + pow(rdy/hh, 2.0));
        } else {
            t = max(abs(rdx)/hw, abs(rdy)/hh);
        }
        float beyond = max(0.0, t - 1.0);
        float fadeAmt = wavesFade / 100.0;
        weight = (wavesFadeInvert == 1)
            ? clamp(beyond * wavesFadeSlope * fadeAmt, 0.0, 1.0)
            : clamp(1.0 - beyond * wavesFadeSlope * fadeAmt, 0.0, 1.0);
    }

    fragColor = vec4(
        mix(orig.r, r, weight),
        mix(orig.g, g, weight),
        mix(orig.b, b, weight),
        orig.a
    );
}
`,
};
