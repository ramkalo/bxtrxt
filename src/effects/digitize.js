import { params } from '../state/params.js';

function applyDigitize(imageData, p = params) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    // Pixelation + color quantization
    if (p.pixelSize > 1) {
        const step = 256 / p.pixelColors;
        for (let y = 0; y < height; y += p.pixelSize) {
            for (let x = 0; x < width; x += p.pixelSize) {
                let r = 0, g = 0, b = 0, count = 0;
                for (let py = 0; py < p.pixelSize && y + py < height; py++) {
                    for (let px = 0; px < p.pixelSize && x + px < width; px++) {
                        const i = ((y + py) * width + (x + px)) * 4;
                        r += data[i]; g += data[i+1]; b += data[i+2];
                        count++;
                    }
                }
                r = Math.floor(r / count / step) * step;
                g = Math.floor(g / count / step) * step;
                b = Math.floor(b / count / step) * step;
                for (let py = 0; py < p.pixelSize && y + py < height; py++) {
                    for (let px = 0; px < p.pixelSize && x + px < width; px++) {
                        const i = ((y + py) * width + (x + px)) * 4;
                        data[i] = r; data[i+1] = g; data[i+2] = b;
                    }
                }
            }
        }
    }

    // Floyd-Steinberg dithering
    if (p.digitizeDither > 0) {
        const amount = p.digitizeDither / 100;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const oldR = data[i], oldG = data[i+1], oldB = data[i+2];
                const newR = Math.round(oldR / 32) * 32;
                const newG = Math.round(oldG / 32) * 32;
                const newB = Math.round(oldB / 32) * 32;
                data[i] = newR; data[i+1] = newG; data[i+2] = newB;

                const errR = (oldR - newR) * amount;
                const errG = (oldG - newG) * amount;
                const errB = (oldB - newB) * amount;

                const spread = (nx, ny, f) => {
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const ni = (ny * width + nx) * 4;
                        data[ni]   = Math.max(0, Math.min(255, data[ni]   + errR * f));
                        data[ni+1] = Math.max(0, Math.min(255, data[ni+1] + errG * f));
                        data[ni+2] = Math.max(0, Math.min(255, data[ni+2] + errB * f));
                    }
                };
                spread(x+1, y,   7/16);
                spread(x-1, y+1, 3/16);
                spread(x,   y+1, 5/16);
                spread(x+1, y+1, 1/16);
            }
        }
    }

    // Digital noise
    if (p.digitizeNoise > 0) {
        const intensity = p.digitizeNoise / 100 * 80;
        for (let i = 0; i < data.length; i += 4) {
            const noise = (Math.random() - 0.5) * intensity;
            data[i]   = Math.max(0, Math.min(255, data[i]   + noise));
            data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise));
            data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise));
        }
    }

    return imageData;
}

export default {
    name: 'digitize',
    label: 'Digitize',
    pass: 'pre-crt',
    params: {
        digitizeEnabled: { default: false },
        pixelSize:       { default: 1,  min: 1,  max: 32 },
        pixelColors:     { default: 16, min: 2,  max: 64 },
        digitizeDither:  { default: 0,  min: 0,  max: 100 },
        digitizeNoise:   { default: 0,  min: 0,  max: 100 },
    },
    enabled: (p) => p.digitizeEnabled,
    canvas2d: applyDigitize,
};
