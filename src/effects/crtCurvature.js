let cachedSrcData = null;
let cachedResult = null;

function applyCurvature(imageData, p) {
    if (p.crtCurvature <= 0) return imageData;

    const width  = imageData.width;
    const height = imageData.height;
    const data   = imageData.data;

    const neededSize = width * height * 4;
    if (!cachedSrcData || cachedSrcData.length !== data.length) {
        cachedSrcData = new Uint8ClampedArray(data.length);
    }
    const srcData = cachedSrcData;
    srcData.set(data);
    
    if (!cachedResult || cachedResult.length !== neededSize) {
        cachedResult = new Uint8ClampedArray(neededSize);
    }
    const result = cachedResult;
    const centerX   = (0.5 + p.crtCurvatureX / 100) * width;
    const centerY   = (0.5 - p.crtCurvatureY / 100) * height;
    const maxRadius = Math.min(width, height) * (p.crtCurvatureRadius / 100);
    const k         = (p.crtCurvature / 100) * (p.crtCurvatureIntensity / 100);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = x - centerX, dy = y - centerY;
            const r  = Math.sqrt(dx * dx + dy * dy);
            let srcX = x, srcY = y;
            if (r > 0 && r < maxRadius) {
                const factor = 1 - k * Math.pow(1 - r / maxRadius, 2);
                srcX = centerX + dx * factor;
                srcY = centerY + dy * factor;
            }
            const sx = Math.floor(Math.max(0, Math.min(width  - 1, srcX)));
            const sy = Math.floor(Math.max(0, Math.min(height - 1, srcY)));
            const i = (y * width + x) * 4;
            const s = (sy * width + sx) * 4;
            result[i]     = srcData[s];
            result[i + 1] = srcData[s + 1];
            result[i + 2] = srcData[s + 2];
            result[i + 3] = 255;
        }
    }

    imageData.data.set(result);
    return imageData;
}

export default {
    name: 'crtCurvature',
    label: 'CRT Curvature',
    pass: 'post',
    paramKeys: ['crtCurvature', 'crtCurvatureRadius', 'crtCurvatureIntensity', 'crtCurvatureX', 'crtCurvatureY'],
    params: {
        crtCurvatureEnabled:   { default: false },
        crtCurvature:          { default: 0,   min: 0,   max: 100 },
        crtCurvatureRadius:    { default: 100, min: 0,   max: 100 },
        crtCurvatureIntensity: { default: 100, min: 0,   max: 100 },
        crtCurvatureX:         { default: 0,   min: -50, max: 50  },
        crtCurvatureY:         { default: 0,   min: -50, max: 50  },
    },
    enabled: (p) => p.crtCurvatureEnabled,
    canvas2d: applyCurvature,
    glsl: `
uniform float crtCurvature;
uniform float crtCurvatureRadius;
uniform float crtCurvatureIntensity;
uniform float crtCurvatureX;
uniform float crtCurvatureY;

void main() {
    float cx = (0.5 + crtCurvatureX / 100.0) * uResolution.x;
    float cy = (0.5 - crtCurvatureY / 100.0) * uResolution.y;
    float maxRadius = min(uResolution.x, uResolution.y) * (crtCurvatureRadius / 100.0);
    float k = (crtCurvature / 100.0) * (crtCurvatureIntensity / 100.0);

    float imgX = vUV.x * uResolution.x;
    float imgY = (1.0 - vUV.y) * uResolution.y;
    float dx = imgX - cx;
    float dy = imgY - cy;
    float r  = sqrt(dx * dx + dy * dy);

    float srcX = imgX;
    float srcY = imgY;
    if (r > 0.0 && r < maxRadius) {
        float factor = 1.0 - k * pow(1.0 - r / maxRadius, 2.0);
        srcX = cx + dx * factor;
        srcY = cy + dy * factor;
    }

    vec2 sampleUV = clamp(vec2(srcX / uResolution.x, 1.0 - srcY / uResolution.y), vec2(0.0), vec2(1.0));
    fragColor = texture(uTex, sampleUV);
}
`,
};
