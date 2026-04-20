import { params } from '../state/params.js';

let cachedBuffer = null;

function applyChromaticAberration(imageData, p = params) {
    const width = imageData.width;
    const height = imageData.height;
    const sourceData = imageData.data;
    
    if (!cachedBuffer || cachedBuffer.length !== sourceData.length) {
        cachedBuffer = new Uint8ClampedArray(sourceData.length);
    }
    const result = cachedBuffer;

    // CMY offsets are complements: Cyan→G+B, Magenta→R+B, Yellow→R+G
    // Each RGB channel's effective shift is the sum of its direct + two complement contributions.
    const scale = p.chromaScale ?? 1;
    const shifts = [
        {
            x: (p.chromaRedX   + p.chromaMagentaX + p.chromaYellowX) * scale,
            y: (p.chromaRedY   + p.chromaMagentaY + p.chromaYellowY) * scale,
            channel: 0,
        },
        {
            x: (p.chromaGreenX + p.chromaCyanX    + p.chromaYellowX) * scale,
            y: (p.chromaGreenY + p.chromaCyanY    + p.chromaYellowY) * scale,
            channel: 1,
        },
        {
            x: (p.chromaBlueX  + p.chromaCyanX    + p.chromaMagentaX) * scale,
            y: (p.chromaBlueY  + p.chromaCyanY    + p.chromaMagentaY) * scale,
            channel: 2,
        },
    ];

    const thresh  = 255 * (p.chromaThreshold / 100);
    const reverse = p.chromaThresholdReverse;

    const fadeAmount = p.chromaFade / 100;
    const cx = width  * (0.5 + p.chromaFadeX / 100);
    const cy = height * (0.5 - p.chromaFadeY / 100);
    const maxDist = Math.sqrt(Math.max(cx, width - cx) ** 2 + Math.max(cy, height - cy) ** 2);
    const fadeDist = Math.max(1, maxDist * (p.chromaFadeRadius / 100));

    for (const shift of shifts) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const r = sourceData[idx], g = sourceData[idx+1], b = sourceData[idx+2];
                const lum = 0.299*r + 0.587*g + 0.114*b;
                const apply = reverse ? (lum <= thresh) : (lum >= thresh);
                if (!apply) continue;

                const dx = x - cx;
                const dy = y - cy;
                const rawDist = Math.sqrt(dx * dx + dy * dy);
                let weight;
                if (p.chromaFadeInvert) {
                    if (rawDist < fadeDist) continue;
                    const outerRange = maxDist - fadeDist;
                    const outerT = outerRange > 0 ? Math.min(1, (rawDist - fadeDist) / outerRange) : 1;
                    weight = 1 - fadeAmount * (1 - outerT);
                } else {
                    if (rawDist >= fadeDist) continue;
                    weight = 1 - fadeAmount * (rawDist / fadeDist);
                }

                const nx = Math.round(x + shift.x * weight);
                const ny = Math.round(y - shift.y * weight);
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    result[idx + shift.channel] =
                        sourceData[(ny * width + nx) * 4 + shift.channel];
                }
            }
        }
    }

    imageData.data.set(result);
    return imageData;
}

export default {
    name: 'chroma',
    label: 'Chromatic Aberration',
    pass: 'pre-crt',
    paramKeys: ['chromaRedX', 'chromaRedY', 'chromaGreenX', 'chromaGreenY', 'chromaBlueX', 'chromaBlueY', 'chromaCyanX', 'chromaCyanY', 'chromaMagentaX', 'chromaMagentaY', 'chromaYellowX', 'chromaYellowY', 'chromaScale', 'chromaThreshold', 'chromaThresholdReverse', 'chromaFade', 'chromaFadeRadius', 'chromaFadeInvert', 'chromaFadeX', 'chromaFadeY'],
    params: {
        chromaEnabled:   { default: false },
        chromaRedX:      { default: 0, min: -20, max: 20 },
        chromaRedY:      { default: 0, min: -20, max: 20 },
        chromaGreenX:    { default: 0, min: -20, max: 20 },
        chromaGreenY:    { default: 0, min: -20, max: 20 },
        chromaBlueX:     { default: 0, min: -20, max: 20 },
        chromaBlueY:     { default: 0, min: -20, max: 20 },
        chromaCyanX:     { default: 0, min: -20, max: 20 },
        chromaCyanY:     { default: 0, min: -20, max: 20 },
        chromaMagentaX:  { default: 0, min: -20, max: 20 },
        chromaMagentaY:  { default: 0, min: -20, max: 20 },
        chromaYellowX:   { default: 0, min: -20, max: 20 },
        chromaYellowY:   { default: 0, min: -20, max: 20 },
        chromaScale:            { default: 1, min: 1, max: 10 },
        chromaThreshold:        { default: 0,  min: 0,   max: 100 },
        chromaThresholdReverse: { default: false },
        chromaFade:             { default: 0,   min: 0,   max: 100 },
        chromaFadeRadius:       { default: 100, min: 1,   max: 100 },
        chromaFadeInvert:       { default: false },
        chromaFadeX:            { default: 0,   min: -50, max: 50  },
        chromaFadeY:            { default: 0,   min: -50, max: 50  },
    },
    enabled: (p) => p.chromaEnabled,
    canvas2d: applyChromaticAberration,
    glsl: `
uniform float chromaRedX; uniform float chromaRedY;
uniform float chromaGreenX; uniform float chromaGreenY;
uniform float chromaBlueX; uniform float chromaBlueY;
uniform float chromaCyanX; uniform float chromaCyanY;
uniform float chromaMagentaX; uniform float chromaMagentaY;
uniform float chromaYellowX; uniform float chromaYellowY;
uniform float chromaScale;
uniform float chromaThreshold;
uniform int   chromaThresholdReverse;
uniform float chromaFade;
uniform float chromaFadeRadius;
uniform int   chromaFadeInvert;
uniform float chromaFadeX;
uniform float chromaFadeY;

vec4 chromaSample(vec2 offsetPx) {
    return texture(uTex, clamp(vUV + offsetPx / uResolution, vec2(0.0), vec2(1.0)));
}

void main() {
    vec4 orig = texture(uTex, vUV);
    float lum = dot(orig.rgb, vec3(0.299, 0.587, 0.114)) * 255.0;
    float thresh = 255.0 * (chromaThreshold / 100.0);
    bool applyChroma = (chromaThresholdReverse == 1) ? (lum <= thresh) : (lum >= thresh);
    if (!applyChroma) { fragColor = orig; return; }

    // Radial fade weight
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

    // Per-channel shifts (CMY are additive — see CPU comment)
    // UV convention: +x = right, +y = toward image top  (matches CPU x + shift.x, y - shift.y)
    vec2 rShift = vec2(chromaRedX   + chromaMagentaX + chromaYellowX,
                       chromaRedY   + chromaMagentaY + chromaYellowY) * chromaScale * weight;
    vec2 gShift = vec2(chromaGreenX + chromaCyanX    + chromaYellowX,
                       chromaGreenY + chromaCyanY    + chromaYellowY) * chromaScale * weight;
    vec2 bShift = vec2(chromaBlueX  + chromaCyanX    + chromaMagentaX,
                       chromaBlueY  + chromaCyanY    + chromaMagentaY) * chromaScale * weight;

    float r = chromaSample(rShift).r;
    float g = chromaSample(gShift).g;
    float b = chromaSample(bShift).b;
    fragColor = vec4(r, g, b, orig.a);
}
`,
};
