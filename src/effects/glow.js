let cachedBrightData = null;

function applyGlow(imageData, p) {
    const { width, height, data } = imageData;
    const threshold  = p.glowThreshold;
    const intensity  = p.glowIntensity / 100;

    if (!cachedBrightData || cachedBrightData.length !== data.length) {
        cachedBrightData = new Uint8ClampedArray(data.length);
    }
    const brightData = cachedBrightData;
    for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum > threshold) {
            const factor = (lum - threshold) / (255 - threshold);
            brightData[i]     = data[i]     * factor;
            brightData[i + 1] = data[i + 1] * factor;
            brightData[i + 2] = data[i + 2] * factor;
            brightData[i + 3] = 255;
        }
    }

    // Spread the bright layer using the browser's native blur (implementation detail,
    // not exposed to the user — the output is a glow halo, not a blurred image).
    const src = document.createElement('canvas');
    src.width = width; src.height = height;
    src.getContext('2d').putImageData(new ImageData(brightData, width, height), 0, 0);

    const spread = document.createElement('canvas');
    spread.width = width; spread.height = height;
    const sCtx = spread.getContext('2d');
    sCtx.filter = `blur(${p.glowRadius}px)`;
    sCtx.drawImage(src, 0, 0);
    sCtx.filter = 'none';

    const glow = sCtx.getImageData(0, 0, width, height).data;

    // Precompute radial fade: weight = 1 at center, falls to (1 - fade) at corners.
    const fade = p.glowFade / 100;
    const cx = width  * (0.5 + p.glowFadeX / 100);
    const cy = height * (0.5 - p.glowFadeY / 100);
    const maxDist = Math.sqrt(Math.max(cx, width - cx) ** 2 + Math.max(cy, height - cy) ** 2);

    // Screen-blend the glow halo onto the original so bright areas bloom
    // without softening the underlying image.
    for (let i = 0; i < data.length; i += 4) {
        const idx = i >> 2;
        const dx  = (idx % width)        - cx;
        const dy  = Math.floor(idx / width) - cy;
        const weight = 1 - fade * (Math.sqrt(dx * dx + dy * dy) / maxDist);

        const gR = glow[i]     * intensity * weight;
        const gG = glow[i + 1] * intensity * weight;
        const gB = glow[i + 2] * intensity * weight;
        data[i]     = 255 - (255 - data[i])     * (255 - gR) / 255;
        data[i + 1] = 255 - (255 - data[i + 1]) * (255 - gG) / 255;
        data[i + 2] = 255 - (255 - data[i + 2]) * (255 - gB) / 255;
    }

    return imageData;
}

const GLOW_THRESHOLD_GLSL = `
uniform float glowThreshold;

void main() {
    vec4 c = texture(uTex, vUV);
    float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114)) * 255.0;
    if (lum > glowThreshold) {
        float factor = (lum - glowThreshold) / max(255.0 - glowThreshold, 0.001);
        fragColor = vec4(c.rgb * factor, 1.0);
    } else {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
}
`;

const GLOW_BLUR_H_GLSL = `
uniform float glowRadius;

void main() {
    int r = int(glowRadius + 0.5);
    float sigma = max(glowRadius, 1.0);
    float twoSigSq = 2.0 * sigma * sigma;
    vec4 color = vec4(0.0);
    float total = 0.0;
    for (int i = -60; i <= 60; i++) {
        if (i < -r || i > r) continue;
        float g = exp(-float(i * i) / twoSigSq);
        color += texture(uTex, clamp(vUV + vec2(float(i) * uTexelSize.x, 0.0), vec2(0.0), vec2(1.0))) * g;
        total += g;
    }
    fragColor = color / max(total, 0.0001);
}
`;

const GLOW_BLUR_V_GLSL = `
uniform float glowRadius;

void main() {
    int r = int(glowRadius + 0.5);
    float sigma = max(glowRadius, 1.0);
    float twoSigSq = 2.0 * sigma * sigma;
    vec4 color = vec4(0.0);
    float total = 0.0;
    for (int i = -60; i <= 60; i++) {
        if (i < -r || i > r) continue;
        float g = exp(-float(i * i) / twoSigSq);
        color += texture(uTex, clamp(vUV + vec2(0.0, float(i) * uTexelSize.y), vec2(0.0), vec2(1.0))) * g;
        total += g;
    }
    fragColor = color / max(total, 0.0001);
}
`;

const GLOW_COMPOSITE_GLSL = `
uniform sampler2D uTexOriginal;
uniform float glowIntensity;
uniform float glowFade;
uniform float glowFadeX;
uniform float glowFadeY;

void main() {
    vec4 orig    = texture(uTexOriginal, vUV);
    vec4 blurred = texture(uTex, vUV);

    float cx = (0.5 + glowFadeX / 100.0) * uResolution.x;
    float cy = (0.5 - glowFadeY / 100.0) * uResolution.y;
    float mxX = max(cx, uResolution.x - cx);
    float mxY = max(cy, uResolution.y - cy);
    float maxDist = sqrt(mxX * mxX + mxY * mxY);
    float imgX = vUV.x * uResolution.x;
    float imgY = (1.0 - vUV.y) * uResolution.y;
    float d = distance(vec2(imgX, imgY), vec2(cx, cy));
    float weight = max(1.0 - (glowFade / 100.0) * (d / max(maxDist, 0.001)), 0.0);

    float intensity = glowIntensity / 100.0;
    vec3 glow = blurred.rgb * intensity * weight;
    // Screen blend
    vec3 result = 1.0 - (1.0 - orig.rgb) * (1.0 - glow);
    fragColor = vec4(clamp(result, 0.0, 1.0), orig.a);
}
`;

export default {
    name: 'glow',
    label: 'Glow',
    pass: 'pre-crt',
    paramKeys: ['glowThreshold', 'glowRadius', 'glowIntensity', 'glowFade', 'glowFadeX', 'glowFadeY'],
    params: {
        glowEnabled:   { default: false },
        glowThreshold: { default: 150, min: 0,   max: 255 },
        glowRadius:    { default: 12,  min: 1,   max: 60  },
        glowIntensity: { default: 80,  min: 0,   max: 200 },
        glowFade:      { default: 0,   min: 0,   max: 100 },
        glowFadeX:     { default: 0,   min: -50, max: 50  },
        glowFadeY:     { default: 0,   min: -50, max: 50  },
    },
    enabled: (p) => p.glowEnabled,
    canvas2d: applyGlow,
    glslPasses: [
        { glsl: GLOW_THRESHOLD_GLSL },
        { glsl: GLOW_BLUR_H_GLSL },
        { glsl: GLOW_BLUR_V_GLSL },
        { glsl: GLOW_COMPOSITE_GLSL, needsOriginal: true },
    ],
};
