const FADE_GLSL = `
uniform float __P__Fade;
uniform float __P__FadeX;
uniform float __P__FadeY;
uniform float __P__FadeW;
uniform float __P__FadeH;
uniform float __P__FadeSlope;
uniform float __P__FadeAngle;
uniform int   __P__FadeEnabled;
uniform int   __P__FadeShape;
uniform int   __P__FadeInvert;

float __FN__() {
    if (__P__FadeEnabled != 1 || __P__Fade <= 0.0) return 1.0;
    float imgX = vUV.x * uResolution.x;
    float imgY = (1.0 - vUV.y) * uResolution.y;
    float cx = (0.5 + __P__FadeX / 100.0) * uResolution.x;
    float cy = (0.5 - __P__FadeY / 100.0) * uResolution.y;
    float dx = imgX - cx, dy = imgY - cy;
    float rad = __P__FadeAngle * 3.14159265 / 180.0;
    float cosA = cos(rad), sinA = sin(rad);
    float rdx =  dx * cosA + dy * sinA;
    float rdy = -dx * sinA + dy * cosA;
    float hw = max(1.0, (__P__FadeW / 100.0) * uResolution.x / 2.0);
    float hh = max(1.0, (__P__FadeH / 100.0) * uResolution.y / 2.0);
    float t = (__P__FadeShape == 0)
        ? sqrt(pow(rdx / hw, 2.0) + pow(rdy / hh, 2.0))
        : max(abs(rdx) / hw, abs(rdy) / hh);
    float beyond = max(0.0, t - 1.0);
    float fadeAmt = __P__Fade / 100.0;
    return (__P__FadeInvert == 1)
        ? clamp(beyond * __P__FadeSlope * fadeAmt, 0.0, 1.0)
        : clamp(1.0 - beyond * __P__FadeSlope * fadeAmt, 0.0, 1.0);
}
`;

export function buildFadeControl(prefix, defaults = {}) {
    const p  = prefix;
    const cap = p.charAt(0).toUpperCase() + p.slice(1);
    const fn  = `calc${cap}FadeWeight`;
    const glsl = FADE_GLSL.replaceAll('__P__', p).replaceAll('__FN__', fn);

    return {
        glsl,
        fnName: fn,
        params: {
            [`${p}FadeEnabled`]: { default: false,                                    label: 'Enable Fade' },
            [`${p}FadeShape`]:   { default: 'ellipse', options: [['ellipse', 'Ellipse'], ['rectangle', 'Rectangle']], label: 'Shape' },
            [`${p}Fade`]:        { default: defaults.fade    ?? 20,  min: 0,   max: 100,        label: 'Fade' },
            [`${p}FadeW`]:       { default: defaults.w       ?? 40,  min: 1,   max: 200,        label: 'Width' },
            [`${p}FadeH`]:       { default: defaults.h       ?? 40,  min: 1,   max: 200,        label: 'Height' },
            [`${p}FadeSlope`]:   { default: defaults.slope   ?? 3,   min: 0.1, max: 8, step: 0.1, label: 'Transition Slope' },
            [`${p}FadeInvert`]:  { default: defaults.invert  ?? false,                           label: 'Invert Fade' },
            [`${p}FadeAngle`]:   { default: 0,   min: -180, max: 180 },
            [`${p}FadeX`]:       { default: 0,   min: -50,  max: 50 },
            [`${p}FadeY`]:       { default: 0,   min: -50,  max: 50 },
        },
        paramKeys: [
            `${p}FadeEnabled`, `${p}FadeShape`, `${p}Fade`,
            `${p}FadeW`, `${p}FadeH`, `${p}FadeSlope`, `${p}FadeInvert`,
            `${p}FadeAngle`, `${p}FadeX`, `${p}FadeY`,
        ],
        handleParams: [`${p}FadeX`, `${p}FadeY`, `${p}FadeW`, `${p}FadeH`, `${p}FadeAngle`],
        uiGroup: {
            label: 'Fade',
            keys: [`${p}FadeEnabled`, `${p}FadeShape`, `${p}Fade`, `${p}FadeSlope`, `${p}FadeInvert`],
        },
        overlay: {
            xKey:       `${p}FadeX`,
            yKey:       `${p}FadeY`,
            shapeKey:   `${p}FadeShape`,
            wKey:       `${p}FadeW`,
            hKey:       `${p}FadeH`,
            angleKey:   `${p}FadeAngle`,
            enabledKey: `${p}FadeEnabled`,
        },
        bindUniforms(gl, prog, params) {
            const locs = prog._locs;
            const si = (k, v) => { if (locs[k] != null) gl.uniform1i(locs[k], v); };
            si(`${p}FadeShape`, params[`${p}FadeShape`] === 'rectangle' ? 1 : 0);
        },
    };
}
