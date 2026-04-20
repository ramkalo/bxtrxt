import { params } from '../state/params.js';

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r)      h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
    if (s === 0) {
        const v = Math.round(l * 255);
        return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [
        Math.round(hue2rgb(h + 1 / 3) * 255),
        Math.round(hue2rgb(h)         * 255),
        Math.round(hue2rgb(h - 1 / 3) * 255),
    ];
}

function applyChannelSaturation(imageData, p = params) {
    const data = imageData.data;
    const targetR = p.chanSatRed;
    const targetG = p.chanSatGreen;
    const targetB = p.chanSatBlue;
    if (!targetR && !targetG && !targetB) return imageData;

    const threshold = p.chanSatThreshold / 100;
    const satDelta  = p.chanSatAmount    / 100;
    const blend     = p.chanSatBlend     / 100;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];

        const [h, s, l] = rgbToHsl(r, g, b);
        if (s < threshold) continue;

        // Hue buckets (0–1 scale): Red wraps 300°–60°, Green 60°–180°, Blue 180°–300°
        const isRed   = h < 1 / 6 || h >= 5 / 6;
        const isGreen = h >= 1 / 6 && h < 1 / 2;
        const isBlue  = h >= 1 / 2 && h < 5 / 6;
        if (!(isRed && targetR) && !(isGreen && targetG) && !(isBlue && targetB)) continue;
        const newS = Math.min(1, Math.max(0, s + satDelta));
        const [mr, mg, mb] = hslToRgb(h, newS, l);

        data[i]     = Math.round(r + (mr - r) * blend);
        data[i + 1] = Math.round(g + (mg - g) * blend);
        data[i + 2] = Math.round(b + (mb - b) * blend);
    }

    return imageData;
}

export default {
    name:  'chanSat',
    label: 'Channel Saturation',
    pass:  'pre-crt',
    paramKeys: ['chanSatRed', 'chanSatGreen', 'chanSatBlue', 'chanSatThreshold', 'chanSatAmount', 'chanSatBlend'],
    params: {
        chanSatEnabled:   { default: false },
        chanSatRed:       { default: false },
        chanSatGreen:     { default: false },
        chanSatBlue:      { default: false },
        chanSatThreshold: { default: 20,  min: 0,    max: 100 },
        chanSatAmount:    { default: 0,   min: -100, max: 100  },
        chanSatBlend:     { default: 100, min: 0,    max: 100  },
    },
    enabled:  (p) => p.chanSatEnabled,
    canvas2d: applyChannelSaturation,
    glsl: `
uniform float chanSatThreshold;
uniform float chanSatAmount;
uniform float chanSatBlend;
uniform int   chanSatRed;
uniform int   chanSatGreen;
uniform int   chanSatBlue;

vec3 rgb2hsl(vec3 c) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float l  = (mx + mn) * 0.5;
    if (mx == mn) return vec3(0.0, 0.0, l);
    float d = mx - mn;
    float s = (l > 0.5) ? d / (2.0 - mx - mn) : d / (mx + mn);
    float h;
    if      (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else                h = (c.r - c.g) / d + 4.0;
    return vec3(h / 6.0, s, l);
}
float h2r(float p, float q, float t) {
    if (t < 0.0) t += 1.0; if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q-p)*6.0*t;
    if (t < 0.5)     return q;
    if (t < 2.0/3.0) return p + (q-p)*(2.0/3.0-t)*6.0;
    return p;
}
vec3 hsl2rgb(float h, float s, float l) {
    if (s == 0.0) return vec3(l);
    float q = (l < 0.5) ? l*(1.0+s) : l+s-l*s;
    float p = 2.0*l - q;
    return vec3(h2r(p,q,h+1.0/3.0), h2r(p,q,h), h2r(p,q,h-1.0/3.0));
}

void main() {
    vec4 c = texture(uTex, vUV);
    vec3 hsl = rgb2hsl(c.rgb);
    float h = hsl.x, s = hsl.y, l = hsl.z;
    float threshold = chanSatThreshold / 100.0;
    float satDelta  = chanSatAmount    / 100.0;
    float blend     = chanSatBlend     / 100.0;
    if (s < threshold) { fragColor = c; return; }
    bool isRed   = h < 1.0/6.0 || h >= 5.0/6.0;
    bool isGreen = h >= 1.0/6.0 && h < 0.5;
    bool isBlue  = h >= 0.5     && h < 5.0/6.0;
    bool match = (isRed&&chanSatRed==1)||(isGreen&&chanSatGreen==1)||(isBlue&&chanSatBlue==1);
    if (!match) { fragColor = c; return; }
    float newS   = clamp(s + satDelta, 0.0, 1.0);
    vec3  modRgb = hsl2rgb(h, newS, l);
    fragColor = vec4(c.rgb + (modRgb - c.rgb) * blend, c.a);
}
`,
};
