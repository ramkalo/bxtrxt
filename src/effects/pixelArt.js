import { params } from '../state/params.js';

function applyPixelArt(imageData, p = params) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const pixelSize = p.pixelSize;
    const step = 256 / p.pixelColors;

    for (let y = 0; y < height; y += pixelSize) {
        for (let x = 0; x < width; x += pixelSize) {
            let r = 0, g = 0, b = 0, count = 0;

            for (let py = 0; py < pixelSize && y + py < height; py++) {
                for (let px = 0; px < pixelSize && x + px < width; px++) {
                    const i = ((y + py) * width + (x + px)) * 4;
                    r += data[i]; g += data[i+1]; b += data[i+2];
                    count++;
                }
            }

            r = Math.floor(r / count / step) * step;
            g = Math.floor(g / count / step) * step;
            b = Math.floor(b / count / step) * step;

            for (let py = 0; py < pixelSize && y + py < height; py++) {
                for (let px = 0; px < pixelSize && x + px < width; px++) {
                    const i = ((y + py) * width + (x + px)) * 4;
                    data[i] = r; data[i+1] = g; data[i+2] = b;
                }
            }
        }
    }
    return imageData;
}

export default {
    name: 'pixelArt',
    label: 'Pixel Art',
    pass: 'pre-crt',
    paramKeys: ['pixelSize', 'pixelColors'],
    params: {
        pixelArtEnabled: { default: false },
        pixelSize:       { default: 24, min: 2, max: 32 },
        pixelColors:     { default: 16, min: 2, max: 64 },
    },
    enabled: (p) => p.pixelArtEnabled,
    canvas2d: applyPixelArt,
    glsl: `
uniform float pixelSize;
uniform float pixelColors;

void main() {
    vec2 pixelCoord = vUV * uResolution;
    vec2 cellUV = floor(pixelCoord / pixelSize) * pixelSize / uResolution;
    vec4 c = texture(uTex, clamp(cellUV, vec2(0.0), vec2(1.0)));
    vec3 col = c.rgb * 255.0;
    float qstep = 256.0 / pixelColors;
    col.r = floor(col.r / qstep) * qstep;
    col.g = floor(col.g / qstep) * qstep;
    col.b = floor(col.b / qstep) * qstep;
    fragColor = vec4(col / 255.0, c.a);
}
`,
};
