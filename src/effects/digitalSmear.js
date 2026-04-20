import { params } from '../state/params.js';

let cachedBuffer = null;

function wavesFormula(xNorm, yNorm) {
    return (
        3.2 * Math.sin(xNorm + 0.3 * Math.cos(2.1 * xNorm) + yNorm) +
        2.1 * Math.cos(0.73 * xNorm - 1.4 + yNorm * 0.7) * Math.sin(0.5 * xNorm + 0.9 + yNorm * 0.5) +
        1.8 * Math.sin(2.3 * xNorm + Math.cos(xNorm) + yNorm * 0.3) * Math.exp(-0.02 * Math.pow(xNorm - 2, 2)) +
        0.9 * Math.cos(3.7 * xNorm - 0.8 + yNorm * 0.4) * (1 / (1 + 0.15 * xNorm * xNorm)) +
        1.2 * Math.sin(0.41 * xNorm * xNorm - xNorm + yNorm * 0.6)
    );
}

function applyDigitalSmear(imageData, p = params) {
    const width  = imageData.width;
    const height = imageData.height;
    const src    = imageData.data;
    
    if (!cachedBuffer || cachedBuffer.length !== src.length) {
        cachedBuffer = new Uint8ClampedArray(src.length);
    }
    const result = cachedBuffer;
    const amp    = p.smearWidth / 10;
    const phase  = p.smearShift / 100 * 20;
    const dir    = p.smearDirection ?? 'ltr';

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let srcX = x;
            let srcY = y;

            if (dir === 'ltr' || dir === 'rtl') {
                const xNorm = y / height * 10 + phase;
                const yNorm = x / width * 8;
                const wave  = wavesFormula(xNorm, yNorm);
                const dx    = Math.round(wave * amp);
                srcX = Math.max(0, Math.min(width  - 1, x + (dir === 'ltr' ? dx : -dx)));
            } else {
                const xNorm = x / width * 10 + phase;
                const yNorm = y / height * 8;
                const wave  = wavesFormula(xNorm, yNorm);
                const dy    = Math.round(wave * amp);
                srcY = Math.max(0, Math.min(height - 1, y + (dir === 'ttb' ? dy : -dy)));
            }

            const di = (y * width + x) * 4;
            const si = (srcY * width + srcX) * 4;
            result[di]     = src[si];
            result[di + 1] = src[si + 1];
            result[di + 2] = src[si + 2];
            result[di + 3] = src[si + 3];
        }
    }

    imageData.data.set(result);
    return imageData;
}

export default {
    name:  'digital-smear',
    label: 'Digital Smear',
    pass:  'pre-crt',
    paramKeys: ['smearWidth', 'smearDirection', 'smearShift'],
    params: {
        smearEnabled:   { default: false },
        smearWidth:     { default: 15,  min: 5,  max: 50  },
        smearDirection: { default: 'ltr' },
        smearShift:     { default: 0,   min: 0,  max: 100 },
    },
    enabled:  (p) => p.smearEnabled && p.smearWidth > 0,
    canvas2d: applyDigitalSmear,
    bindUniforms: (gl, prog, p) => {
        const loc = prog._locs['smearDirection'];
        if (loc != null) gl.uniform1i(loc, { ltr: 0, rtl: 1, ttb: 2, btt: 3 }[p.smearDirection] ?? 0);
    },
    glsl: `
uniform float smearWidth;
uniform int   smearDirection;
uniform float smearShift;

float wavesFormula(float xN, float yN) {
    return
        3.2 * sin(xN + 0.3 * cos(2.1 * xN) + yN) +
        2.1 * cos(0.73 * xN - 1.4 + yN * 0.7) * sin(0.5 * xN + 0.9 + yN * 0.5) +
        1.8 * sin(2.3 * xN + cos(xN) + yN * 0.3) * exp(-0.02 * pow(xN - 2.0, 2.0)) +
        0.9 * cos(3.7 * xN - 0.8 + yN * 0.4) * (1.0 / (1.0 + 0.15 * xN * xN)) +
        1.2 * sin(0.41 * xN * xN - xN + yN * 0.6);
}

void main() {
    float amp   = smearWidth / 10.0;
    float phase = smearShift / 100.0 * 20.0;
    vec2 uv = vUV;

    if (smearDirection == 0 || smearDirection == 1) { // ltr / rtl
        float xNorm = (1.0 - vUV.y) * 10.0 + phase;
        float yNorm = vUV.x * 8.0;
        float wave  = wavesFormula(xNorm, yNorm);
        float dx    = wave * amp * (smearDirection == 0 ? 1.0 : -1.0);
        uv.x = clamp(vUV.x + dx / uResolution.x, 0.0, 1.0);
    } else { // ttb / btt
        float xNorm = vUV.x * 10.0 + phase;
        float yNorm = (1.0 - vUV.y) * 8.0;
        float wave  = wavesFormula(xNorm, yNorm);
        float dy    = wave * amp * (smearDirection == 2 ? 1.0 : -1.0);
        uv.y = clamp(vUV.y - dy / uResolution.y, 0.0, 1.0);
    }

    fragColor = texture(uTex, uv);
}
`,
};
