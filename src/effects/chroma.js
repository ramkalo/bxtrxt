import { params } from '../state/params.js';

function applyChromaticAberration(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const sourceData = imageData.data;
    const result = new Uint8ClampedArray(sourceData);

    // CMY offsets are complements: Cyan→G+B, Magenta→R+B, Yellow→R+G
    // Each RGB channel's effective shift is the sum of its direct + two complement contributions.
    const scale = params.chromaScale ?? 1;
    const shifts = [
        {
            x: (params.chromaRedX   + params.chromaMagentaX + params.chromaYellowX) * scale,
            y: (params.chromaRedY   + params.chromaMagentaY + params.chromaYellowY) * scale,
            channel: 0,
        },
        {
            x: (params.chromaGreenX + params.chromaCyanX    + params.chromaYellowX) * scale,
            y: (params.chromaGreenY + params.chromaCyanY    + params.chromaYellowY) * scale,
            channel: 1,
        },
        {
            x: (params.chromaBlueX  + params.chromaCyanX    + params.chromaMagentaX) * scale,
            y: (params.chromaBlueY  + params.chromaCyanY    + params.chromaMagentaY) * scale,
            channel: 2,
        },
    ];

    const thresh  = 255 * (params.chromaThreshold / 100);
    const reverse = params.chromaThresholdReverse;

    for (const shift of shifts) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const r = sourceData[idx], g = sourceData[idx+1], b = sourceData[idx+2];
                const lum = 0.299*r + 0.587*g + 0.114*b;
                const apply = reverse ? (lum <= thresh) : (lum >= thresh);
                if (!apply) continue;

                const nx = Math.round(x + shift.x);
                const ny = Math.round(y - shift.y); // Negate Y: negative = down
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
        chromaThreshold:        { default: 0, min: 0, max: 100 },
        chromaThresholdReverse: { default: false },
    },
    enabled: (p) => p.chromaEnabled,
    canvas2d: applyChromaticAberration,
};
