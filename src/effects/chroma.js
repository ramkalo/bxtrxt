export default {
    name: 'chroma',
    label: 'Chromatic Aberration',
    pass: 'pre-crt',
    paramKeys: ['chromaRedX', 'chromaRedY', 'chromaGreenX', 'chromaGreenY', 'chromaBlueX', 'chromaBlueY', 'chromaScale', 'chromaThreshold', 'chromaThresholdReverse', 'chromaFade', 'chromaFadeRadius', 'chromaFadeInvert', 'chromaFadeX', 'chromaFadeY', 'chromaOutlineX', 'chromaOutlineY',
                'wavesPhase'],
    handleParams: ['chromaOutlineX', 'chromaOutlineY'],
    params: {
        chromaEnabled:   { default: false },
        chromaMode:      { default: 'classic' },
        chromaRedX:      { default: 0, min: -20, max: 20 },
        chromaRedY:      { default: 0, min: -20, max: 20 },
        chromaGreenX:    { default: 0, min: -20, max: 20 },
        chromaGreenY:    { default: 0, min: -20, max: 20 },
        chromaBlueX:     { default: 0, min: -20, max: 20 },
        chromaBlueY:     { default: 0, min: -20, max: 20 },
        chromaScale:            { default: 1,   min: 1,   max: 10 },
        chromaThreshold:        { default: 0,   min: 0,   max: 100 },
        chromaThresholdReverse: { default: false },
        chromaFade:             { default: 0,   min: 0,   max: 100 },
        chromaFadeRadius:       { default: 100, min: 1,   max: 100 },
        chromaFadeInvert:       { default: false },
        chromaFadeX:            { default: 0,   min: -50, max: 50 },
        chromaFadeY:            { default: 0,   min: -50, max: 50 },
        chromaOutlineX:         { default: 0,   min: -50, max: 50 },
        chromaOutlineY:         { default: 0,   min: -50, max: 50 },
        wavesPhase:             { default: 0,   min: 0,   max: 100 },
    },
    enabled: (p) => p.chromaEnabled,
    uiGroups: (p) => {
        const sharedBottom = [
            { label: 'Scale & Threshold', keys: ['chromaScale', 'chromaThreshold', 'chromaThresholdReverse'] },
            { label: 'Fade', keys: ['chromaFade', 'chromaFadeRadius', 'chromaFadeInvert', 'chromaFadeX', 'chromaFadeY'] },
        ];
        if (p.chromaMode === 'waves') return [
            { keys: ['chromaMode'] },
            { keys: ['chromaRedX', 'chromaGreenX', 'chromaBlueX', 'wavesPhase'],
              labels: { chromaRedX: 'Red', chromaGreenX: 'Green', chromaBlueX: 'Blue', wavesPhase: 'Phase' } },
            ...sharedBottom,
        ];
        const outline = p.chromaMode === 'outline';
        return [
            { keys: ['chromaMode'] },
            { label: 'Channel Shifts', keys: outline
                ? ['chromaRedX', 'chromaGreenX', 'chromaBlueX']
                : ['chromaRedX', 'chromaRedY', 'chromaGreenX', 'chromaGreenY', 'chromaBlueX', 'chromaBlueY'],
              labels: outline ? { chromaRedX: 'Red', chromaGreenX: 'Green', chromaBlueX: 'Blue' } : undefined },
            ...sharedBottom,
        ];
    },
    bindUniforms(gl, prog, p) {
        const modeInt = { classic: 0, outline: 1, waves: 2 }[p.chromaMode] ?? 0;
        if (prog._locs['chromaMode'] != null) gl.uniform1i(prog._locs['chromaMode'], modeInt);
    },
    glsl: `
uniform float chromaRedX; uniform float chromaRedY;
uniform float chromaGreenX; uniform float chromaGreenY;
uniform float chromaBlueX; uniform float chromaBlueY;
uniform float chromaScale;
uniform float chromaThreshold;
uniform int   chromaThresholdReverse;
uniform float chromaFade;
uniform float chromaFadeRadius;
uniform int   chromaFadeInvert;
uniform float chromaFadeX;
uniform float chromaFadeY;
uniform int   chromaMode;
uniform float chromaOutlineX;
uniform float chromaOutlineY;
uniform float wavesPhase;

vec4 chromaSample(vec2 offsetPx) {
    return texture(uTex, clamp(vUV + vec2(-offsetPx.x, -offsetPx.y) / uResolution, vec2(0.0), vec2(1.0)));
}

float wavesFormula(float xN, float yN) {
    return
        3.2 * sin(xN + 0.3 * cos(2.1 * xN) + yN) +
        2.1 * cos(0.73 * xN - 1.4 + yN * 0.7) * sin(0.5 * xN + 0.9 + yN * 0.5) +
        1.8 * sin(2.3 * xN + cos(xN) + yN * 0.3) * exp(-0.02 * pow(xN - 2.0, 2.0)) +
        0.9 * cos(3.7 * xN - 0.8 + yN * 0.4) * (1.0 / (1.0 + 0.15 * xN * xN)) +
        1.2 * sin(0.41 * xN * xN - xN + yN * 0.6);
}

void main() {
    vec4 orig = texture(uTex, vUV);

    // Shared threshold check
    float lum = dot(orig.rgb, vec3(0.299, 0.587, 0.114)) * 255.0;
    float thresh = 255.0 * (chromaThreshold / 100.0);
    bool applyChroma = (chromaThresholdReverse == 1) ? (lum <= thresh) : (lum >= thresh);
    if (!applyChroma) { fragColor = orig; return; }

    // Shared radial fade weight
    float imgX = vUV.x * uResolution.x;
    float imgY = (1.0 - vUV.y) * uResolution.y;
    float cx = (0.5 + chromaFadeX / 100.0) * uResolution.x;
    float cy = (0.5 - chromaFadeY / 100.0) * uResolution.y;
    float mxX = max(cx, uResolution.x - cx);
    float mxY = max(cy, uResolution.y - cy);
    float maxDist = sqrt(mxX*mxX + mxY*mxY);
    float fadeDist = max(1.0, maxDist * (chromaFadeRadius / 100.0));
    float rawDist = distance(vec2(imgX, imgY), vec2(cx, cy));
    float fadeAmt = chromaFade / 100.0;
    float weight;
    if (chromaFadeInvert == 1) {
        if (rawDist < fadeDist) { fragColor = orig; return; }
        float outerRange = max(maxDist - fadeDist, 0.001);
        weight = 1.0 - fadeAmt * (1.0 - min(1.0, (rawDist - fadeDist) / outerRange));
    } else {
        if (rawDist >= fadeDist) { fragColor = orig; return; }
        weight = 1.0 - fadeAmt * (rawDist / fadeDist);
    }

    float r, g, b;

    if (chromaMode == 2) {
        float ampR  = chromaRedX   * chromaScale * 0.3;
        float ampG  = chromaGreenX * chromaScale * 0.3;
        float ampB  = chromaBlueX  * chromaScale * 0.3;
        float phase = wavesPhase / 100.0 * 20.0;
        float xNorm = vUV.x * 10.0 + phase;
        float yNorm = (1.0 - vUV.y) * 8.0;
        float wave  = wavesFormula(xNorm, yNorm);
        r = texture(uTex, clamp(vec2(vUV.x + wave * ampR / uResolution.x, vUV.y), vec2(0.0), vec2(1.0))).r;
        g = texture(uTex, clamp(vec2(vUV.x + wave * ampG / uResolution.x, vUV.y), vec2(0.0), vec2(1.0))).g;
        b = texture(uTex, clamp(vec2(vUV.x + wave * ampB / uResolution.x, vUV.y), vec2(0.0), vec2(1.0))).b;
        fragColor = vec4(mix(orig.r, r, weight), mix(orig.g, g, weight), mix(orig.b, b, weight), orig.a);
        return;
    }

    if (chromaMode == 1) {
        vec2 focalUV = vec2(
            0.5 + chromaOutlineX / 100.0,
            0.5 + chromaOutlineY / 100.0
        );
        vec2 offset = vUV - focalUV;
        float rScale = 1.0 - chromaRedX   * chromaScale * weight * 0.001;
        float gScale = 1.0 - chromaGreenX * chromaScale * weight * 0.001;
        float bScale = 1.0 - chromaBlueX  * chromaScale * weight * 0.001;
        r = texture(uTex, clamp(focalUV + offset * rScale, vec2(0.0), vec2(1.0))).r;
        g = texture(uTex, clamp(focalUV + offset * gScale, vec2(0.0), vec2(1.0))).g;
        b = texture(uTex, clamp(focalUV + offset * bScale, vec2(0.0), vec2(1.0))).b;
    } else {
        vec2 rShift = vec2(chromaRedX,   chromaRedY)   * chromaScale * weight;
        vec2 gShift = vec2(chromaGreenX, chromaGreenY) * chromaScale * weight;
        vec2 bShift = vec2(chromaBlueX,  chromaBlueY)  * chromaScale * weight;
        r = chromaSample(rShift).r;
        g = chromaSample(gShift).g;
        b = chromaSample(bShift).b;
    }
    fragColor = vec4(r, g, b, orig.a);
}
`,
};
