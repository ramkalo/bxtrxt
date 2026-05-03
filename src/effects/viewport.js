const GLSL = `
uniform sampler2D uTexWindow;
uniform float vpX;
uniform float vpY;
uniform float vpW;
uniform float vpH;
uniform float vpR;
uniform float vpInvert;
uniform int   vpShape;
uniform int   vpNumVerts;
uniform vec2  vpVerts[12];

bool inRect(vec2 uv) {
    vec2 c = vec2(0.5 + vpX / 100.0, 0.5 + vpY / 100.0);
    return abs(uv.x - c.x) < vpW / 200.0 && abs(uv.y - c.y) < vpH / 200.0;
}

bool inCircle(vec2 uv) {
    vec2 c    = vec2(0.5 + vpX / 100.0, 0.5 + vpY / 100.0);
    vec2 diff = (uv - c) * uResolution;
    float r   = vpR / 100.0 * min(uResolution.x, uResolution.y) * 0.5;
    return length(diff) < r;
}

bool inPoly(vec2 uv) {
    bool inside = false;
    int j = vpNumVerts - 1;
    for (int i = 0; i < 12; i++) {
        if (i >= vpNumVerts) break;
        vec2 vi = vpVerts[i];
        vec2 vj = vpVerts[j];
        if ((vi.y > uv.y) != (vj.y > uv.y) &&
            uv.x < (vj.x - vi.x) * (uv.y - vi.y) / (vj.y - vi.y) + vi.x) {
            inside = !inside;
        }
        j = i;
    }
    return inside;
}

void main() {
    bool inside;
    if      (vpShape == 0) inside = inRect(vUV);
    else if (vpShape == 1) inside = inCircle(vUV);
    else                   inside = inPoly(vUV);

    if (vpInvert > 0.5) inside = !inside;

    fragColor = inside ? texture(uTexWindow, vUV) : texture(uTex, vUV);
}
`;

const SHAPE_INT = { rectangle: 0, circle: 1, triangle: 2, polygon: 2 };

export default {
    name: 'viewport',
    label: 'Viewport',
    pass: 'viewport',
    paramKeys: ['vpX', 'vpY', 'vpW', 'vpH', 'vpR'],
    handleParams: [
        'vpX', 'vpY', 'vpW', 'vpH', 'vpR',
        'vpV0x',  'vpV0y',  'vpV1x',  'vpV1y',  'vpV2x',  'vpV2y',
        'vpV3x',  'vpV3y',  'vpV4x',  'vpV4y',  'vpV5x',  'vpV5y',
        'vpV6x',  'vpV6y',  'vpV7x',  'vpV7y',  'vpV8x',  'vpV8y',
        'vpV9x',  'vpV9y',  'vpV10x', 'vpV10y', 'vpV11x', 'vpV11y',
    ],
    params: {
        vpEnabled: { default: false },
        vpShape:   { default: 'rectangle' },
        vpPost:    { default: false },
        vpInvert:  { default: false },
        vpX:       { default: 0,   min: -50, max: 50  },
        vpY:       { default: 0,   min: -50, max: 50  },
        vpW:       { default: 30,  min: 1,   max: 100 },
        vpH:       { default: 20,  min: 1,   max: 100 },
        vpR:       { default: 25,  min: 1,   max: 100 },
        vpSides:   { default: 6,   min: 3,   max: 24  },
        // Vertex offsets from center (all zero = uninitialized; canvas overlay resets on first show)
        vpV0x:  { default: 0 }, vpV0y:  { default: 0 },
        vpV1x:  { default: 0 }, vpV1y:  { default: 0 },
        vpV2x:  { default: 0 }, vpV2y:  { default: 0 },
        vpV3x:  { default: 0 }, vpV3y:  { default: 0 },
        vpV4x:  { default: 0 }, vpV4y:  { default: 0 },
        vpV5x:  { default: 0 }, vpV5y:  { default: 0 },
        vpV6x:  { default: 0 }, vpV6y:  { default: 0 },
        vpV7x:  { default: 0 }, vpV7y:  { default: 0 },
        vpV8x:  { default: 0 }, vpV8y:  { default: 0 },
        vpV9x:  { default: 0 }, vpV9y:  { default: 0 },
        vpV10x: { default: 0 }, vpV10y: { default: 0 },
        vpV11x: { default: 0 }, vpV11y: { default: 0 },
    },
    enabled: (p) => p.vpEnabled,
    glsl: GLSL,

    bindUniforms(gl, prog, p) {
        // Shape uniforms only — textures are managed by _runViewportComposite
        if (prog._locs['vpShape']   != null) gl.uniform1i(prog._locs['vpShape'],   SHAPE_INT[p.vpShape] ?? 0);
        if (prog._locs['vpInvert']  != null) gl.uniform1f(prog._locs['vpInvert'],  p.vpInvert ? 1.0 : 0.0);

        // Vertex count
        let numVerts = 0;
        if (p.vpShape === 'triangle') numVerts = 3;
        else if (p.vpShape === 'polygon') numVerts = Math.max(3, Math.min(12, Math.round(p.vpSides)));
        if (prog._locs['vpNumVerts'] != null) gl.uniform1i(prog._locs['vpNumVerts'], numVerts);

        // Vertex UV positions (offset from center, converted to UV space)
        const verts = new Float32Array(24);
        for (let i = 0; i < 12; i++) {
            verts[i * 2]     = 0.5 + (p.vpX + (p[`vpV${i}x`] ?? 0)) / 100.0;
            verts[i * 2 + 1] = 0.5 + (p.vpY + (p[`vpV${i}y`] ?? 0)) / 100.0;
        }
        const vertsLoc = prog._locs['vpVerts[0]'];
        if (vertsLoc != null) gl.uniform2fv(vertsLoc, verts);
    },
};
