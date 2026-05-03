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
uniform float glowFadeW;
uniform float glowFadeH;
uniform float glowFadeAngle;
uniform float glowFadeSlope;
uniform int   glowFadeEnabled;
uniform int   glowFadeShape;
uniform int   glowFadeInvert;

void main() {
    vec4 orig    = texture(uTexOriginal, vUV);
    vec4 blurred = texture(uTex, vUV);

    float weight = 1.0;
    if (glowFadeEnabled == 1 && glowFade > 0.0) {
        float imgX = vUV.x * uResolution.x;
        float imgY = (1.0 - vUV.y) * uResolution.y;
        float cx = (0.5 + glowFadeX / 100.0) * uResolution.x;
        float cy = (0.5 - glowFadeY / 100.0) * uResolution.y;
        float dx = imgX - cx, dy = imgY - cy;
        float rad = glowFadeAngle * 3.14159265 / 180.0;
        float cosA = cos(rad), sinA = sin(rad);
        float rdx =  dx * cosA + dy * sinA;
        float rdy = -dx * sinA + dy * cosA;
        float hw = max(1.0, (glowFadeW / 100.0) * uResolution.x / 2.0);
        float hh = max(1.0, (glowFadeH / 100.0) * uResolution.y / 2.0);
        float t;
        if (glowFadeShape == 0) {
            t = sqrt(pow(rdx/hw, 2.0) + pow(rdy/hh, 2.0));
        } else {
            t = max(abs(rdx)/hw, abs(rdy)/hh);
        }
        float beyond = max(0.0, t - 1.0);
        float fadeAmt = glowFade / 100.0;
        weight = (glowFadeInvert == 1)
            ? clamp(beyond * glowFadeSlope * fadeAmt, 0.0, 1.0)
            : clamp(1.0 - beyond * glowFadeSlope * fadeAmt, 0.0, 1.0);
    }

    float intensity = glowIntensity / 100.0;
    vec3 glow = blurred.rgb * intensity * weight;
    vec3 result = 1.0 - (1.0 - orig.rgb) * (1.0 - glow);
    fragColor = vec4(clamp(result, 0.0, 1.0), orig.a);
}
`;

export default {
    name: 'glow',
    label: 'Glow',
    pass: 'pre-crt',
    paramKeys: [
        'glowThreshold', 'glowRadius', 'glowIntensity',
        'glowFade', 'glowFadeEnabled', 'glowFadeShape', 'glowFadeSlope', 'glowFadeInvert',
        'glowFadeAngle', 'glowFadeW', 'glowFadeH', 'glowFadeX', 'glowFadeY',
    ],
    handleParams: ['glowFadeX', 'glowFadeY', 'glowFadeW', 'glowFadeH', 'glowFadeAngle'],
    params: {
        glowEnabled:    { default: false },
        glowIntensity:  { default: 80,  min: 0,    max: 300 },
        glowRadius:     { default: 60,  min: 1,    max: 60  },
        glowThreshold:  { default: 0,   min: 0,    max: 255 },
        glowFade:       { default: 0,   min: 0,    max: 100 },
        glowFadeEnabled:{ default: false },
        glowFadeShape:  { default: 'ellipse' },
        glowFadeSlope:  { default: 3,   min: 0.1,  max: 8   },
        glowFadeInvert: { default: false },
        glowFadeAngle:  { default: 0,   min: -180, max: 180 },
        glowFadeW:      { default: 50,  min: 1,    max: 200 },
        glowFadeH:      { default: 50,  min: 1,    max: 200 },
        glowFadeX:      { default: 0,   min: -50,  max: 50  },
        glowFadeY:      { default: 0,   min: -50,  max: 50  },
    },
    enabled: (p) => p.glowEnabled,
    uiGroups: [
        { keys: ['glowThreshold', 'glowRadius', 'glowIntensity'] },
        { label: 'Fade', keys: ['glowFadeEnabled', 'glowFadeShape', 'glowFade', 'glowFadeSlope', 'glowFadeInvert'] },
    ],
    bindUniforms: (gl, prog, p) => {
        const sl = prog._locs['glowFadeShape'];
        if (sl != null) gl.uniform1i(sl, { ellipse: 0, rectangle: 1 }[p.glowFadeShape] ?? 0);
        const el = prog._locs['glowFadeEnabled'];
        if (el != null) gl.uniform1i(el, p.glowFadeEnabled ? 1 : 0);
        const il = prog._locs['glowFadeInvert'];
        if (il != null) gl.uniform1i(il, p.glowFadeInvert ? 1 : 0);
    },
    glslPasses: [
        { glsl: GLOW_THRESHOLD_GLSL },
        { glsl: GLOW_BLUR_H_GLSL },
        { glsl: GLOW_BLUR_V_GLSL },
        { glsl: GLOW_COMPOSITE_GLSL, needsOriginal: true },
    ],
};
