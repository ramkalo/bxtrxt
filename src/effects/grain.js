import { params } from '../state/params.js';

function applyGrain(imageData, p = params) {
    const data      = imageData.data;
    const width     = imageData.width;
    const height    = imageData.height;
    const intensity = p.grainIntensity / 100 * 150;
    const gs        = Math.max(1, Math.round(p.grainSize ?? 1));

    // Build a downsampled noise grid so pixels in the same cell share one value.
    // At gs=1 this is identical to per-pixel noise; larger values create grain clumps.
    const noiseW    = Math.ceil(width  / gs);
    const noiseH    = Math.ceil(height / gs);
    const noiseGrid = new Float32Array(noiseW * noiseH);
    for (let i = 0; i < noiseGrid.length; i++) {
        noiseGrid[i] = (Math.random() - 0.5) * intensity;
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i     = (y * width + x) * 4;
            const noise = noiseGrid[(Math.floor(y / gs) * noiseW) + Math.floor(x / gs)];
            data[i]   = Math.max(0, Math.min(255, data[i]   + noise));
            data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise));
            data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise));
        }
    }
    return imageData;
}

export default {
    name: 'grain',
    label: 'Film Grain',
    pass: 'pre-crt',
    params: {
        grainEnabled:   { default: false },
        grainIntensity: { default: 0, min: 0, max: 100 },
        grainSize:      { default: 1, min: 1, max: 10 },
    },
    enabled: (p) => p.grainEnabled && p.grainIntensity > 0,
    canvas2d: applyGrain, // (imageData, p?) → imageData
};
