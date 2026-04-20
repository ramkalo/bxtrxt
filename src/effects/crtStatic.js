function applyStatic(imageData, p) {
    if (p.crtStatic <= 0) return imageData;

    const data      = imageData.data;
    const intensity = p.crtStatic / 100;
    const type      = p.crtStaticType;

    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 255 * intensity;
        if (type === 'white') {
            data[i]     = Math.max(0, Math.min(255, data[i]     + noise));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
        } else if (type === 'color') {
            data[i]     = Math.max(0, Math.min(255, data[i]     + noise * Math.random()));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * Math.random()));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * Math.random()));
        } else if (type === 'luma') {
            const gray    = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const newGray = Math.max(0, Math.min(255, gray + noise));
            const ratio   = newGray / (gray || 1);
            data[i]     *= ratio;
            data[i + 1] *= ratio;
            data[i + 2] *= ratio;
        }
    }

    return imageData;
}

export default {
    name: 'crtStatic',
    label: 'CRT Static',
    pass: 'post',
    paramKeys: ['crtStatic', 'crtStaticType'],
    params: {
        crtStaticEnabled: { default: false },
        crtStatic:        { default: 0, min: 0, max: 100 },
        crtStaticType:    { default: 'white' },
    },
    enabled: (p) => p.crtStaticEnabled,
    canvas2d: applyStatic,
    bindUniforms: (gl, prog, params) => {
        const loc = prog._locs['crtStaticType'];
        if (loc != null) gl.uniform1i(loc, { white: 0, color: 1, luma: 2 }[params.crtStaticType] ?? 0);
    },
    glsl: `
uniform float crtStatic;
uniform int   crtStaticType;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec4 c = texture(uTex, vUV);
    float intensity = crtStatic / 100.0;
    float noise = (hash21(vUV) - 0.5) * 255.0 * intensity;
    vec3 col = c.rgb * 255.0;
    if (crtStaticType == 0) { // white
        col = clamp(col + noise, 0.0, 255.0);
    } else if (crtStaticType == 1) { // color
        float nr = (hash21(vUV + vec2(0.1)) - 0.5) * 255.0 * intensity;
        float ng = (hash21(vUV + vec2(0.2)) - 0.5) * 255.0 * intensity;
        float nb = (hash21(vUV + vec2(0.3)) - 0.5) * 255.0 * intensity;
        col = clamp(col + vec3(nr, ng, nb), 0.0, 255.0);
    } else { // luma
        float gray    = 0.299*col.r + 0.587*col.g + 0.114*col.b;
        float newGray = clamp(gray + noise, 0.0, 255.0);
        float ratio   = newGray / max(gray, 0.001);
        col = clamp(col * ratio, 0.0, 255.0);
    }
    fragColor = vec4(col / 255.0, c.a);
}
`,
};
