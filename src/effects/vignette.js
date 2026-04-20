import { params } from '../state/params.js';

function applyVignette(imageData, p = params) {
    const data   = imageData.data;
    const width  = imageData.width;
    const height = imageData.height;

    const mode        = p.vignetteMode ?? 'ellipse';
    const edgeScale   = p.vignetteEdge   / 100;
    const centerScale = p.vignetteCenter / 100;
    const angleRad    = (p.vignetteAngle ?? 0) * Math.PI / 180;
    const cosA        = Math.cos(angleRad);
    const sinA        = Math.sin(angleRad);
    // 0.7071 = half-diagonal of unit UV square → major/minor=100 reaches the corners
    const a = (p.vignetteMajor / 100) * 0.7071;
    const b = (p.vignetteMinor / 100) * 0.7071;
    const centerUX = 0.5 + p.vignetteCenterX / 100;
    const centerUY = 0.5 - p.vignetteCenterY / 100; // flip Y: negative = down

    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            // Normalised UV offset from vignette center
            const dx = px / width  - centerUX;
            const dy = py / height - centerUY;

            // Rotate into the vignette's local axis frame
            const rx =  cosA * dx + sinA * dy;
            const ry = -sinA * dx + cosA * dy;

            // Distance metric: ellipse or rectangle
            const dist = (mode === 'rectangle')
                ? Math.max(Math.abs(rx) / a, Math.abs(ry) / b)
                : Math.sqrt((rx / a) * (rx / a) + (ry / b) * (ry / b));

            const falloff      = Math.pow(Math.min(dist, 1.0), 2);
            const edgeFactor   = Math.max(0, 1.0 + falloff * edgeScale);
            const centerFactor = Math.max(0, 1.0 + (1.0 - falloff) * centerScale);
            const vignette     = edgeFactor * centerFactor;

            const i = (py * width + px) * 4;
            data[i]   = Math.max(0, Math.min(255, data[i]   * vignette));
            data[i+1] = Math.max(0, Math.min(255, data[i+1] * vignette));
            data[i+2] = Math.max(0, Math.min(255, data[i+2] * vignette));
        }
    }
    return imageData;
}

export default {
    name: 'vignette',
    label: 'Vignette',
    pass: 'pre-crt',
    paramKeys: ['vignetteMode', 'vignetteMajor', 'vignetteMinor', 'vignetteAngle', 'vignetteCenterX', 'vignetteCenterY', 'vignetteEdge', 'vignetteCenter'],
    params: {
        vignetteEnabled: { default: false },
        vignetteMode:    { default: 'ellipse' },
        vignetteMajor:   { default: 100, min: 0, max: 150 },
        vignetteMinor:   { default: 100, min: 0, max: 150 },
        vignetteAngle:   { default: 0,   min: 0, max: 180 },
        vignetteCenterX: { default: 0,   min: -50, max: 50  },
        vignetteCenterY: { default: 0,   min: -50, max: 50  },
        vignetteEdge:    { default: 0,   min: -100, max: 100 },
        vignetteCenter:  { default: 0,   min: -100, max: 100 },
    },
    enabled: (p) => p.vignetteEnabled,
    canvas2d: applyVignette,
    bindUniforms: (gl, prog, params) => {
        const loc = prog._locs['vignetteMode'];
        if (loc != null) gl.uniform1i(loc, params.vignetteMode === 'rectangle' ? 1 : 0);
    },
    glsl: `
uniform float vignetteMajor;
uniform float vignetteMinor;
uniform float vignetteAngle;
uniform float vignetteCenterX;
uniform float vignetteCenterY;
uniform float vignetteEdge;
uniform float vignetteCenter;
uniform int   vignetteMode;

void main() {
    vec4 c = texture(uTex, vUV);
    float a = max((vignetteMajor / 100.0) * 0.7071, 1e-5);
    float b = max((vignetteMinor / 100.0) * 0.7071, 1e-5);
    float centerUX = 0.5 + vignetteCenterX / 100.0;
    float centerUY = 0.5 - vignetteCenterY / 100.0;
    float angleRad = vignetteAngle * 3.14159265 / 180.0;
    float cosA = cos(angleRad), sinA = sin(angleRad);
    float dx = vUV.x - centerUX;
    float dy = (1.0 - vUV.y) - centerUY;
    float rx =  cosA*dx + sinA*dy;
    float ry = -sinA*dx + cosA*dy;
    float dist = (vignetteMode == 1)
        ? max(abs(rx)/a, abs(ry)/b)
        : sqrt((rx/a)*(rx/a) + (ry/b)*(ry/b));
    float falloff      = pow(min(dist, 1.0), 2.0);
    float edgeFactor   = max(0.0, 1.0 + falloff * (vignetteEdge   / 100.0));
    float centerFactor = max(0.0, 1.0 + (1.0 - falloff) * (vignetteCenter / 100.0));
    fragColor = vec4(clamp(c.rgb * edgeFactor * centerFactor, 0.0, 1.0), c.a);
}
`,
};
