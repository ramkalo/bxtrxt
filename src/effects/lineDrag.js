import { buildFadeControl, buildBlendControl } from './controls/index.js';

const fade  = buildFadeControl('lineDrag');
const blend = buildBlendControl('lineDrag');

export default {
    name:  'lineDrag',
    label: 'Line Drag',
    kind:  'glsl',

    handleParams: ['lineDragX', 'lineDragY', 'lineDragAngle', ...fade.handleParams],

    paramKeys: [
        'lineDragX', 'lineDragY', 'lineDragAngle', 'lineDragDir',
        ...blend.paramKeys,
        ...fade.paramKeys,
    ],

    params: {
        lineDragEnabled: { default: false, label: 'Enable' },
        lineDragX:       { default: 50, min: 0, max: 100, label: 'X' },
        lineDragY:       { default: 50, min: 0, max: 100, label: 'Y' },
        lineDragAngle:   { default: 0, min: -89, max: 89, step: 1, label: 'Angle' },
        lineDragDir:     { default: 'down', label: 'Direction', options: [['down', 'Down'], ['up', 'Up'], ['right', 'Right'], ['left', 'Left']] },
        ...blend.params,
        ...fade.params,
    },

    uiGroups: [
        { keys: ['lineDragEnabled', 'lineDragAngle', 'lineDragDir'] },
        blend.uiGroup,
        fade.uiGroup,
    ],

    enabled: (p) => p.lineDragEnabled,

    bindUniforms: (gl, prog, p) => {
        const s  = prog._locs;
        const si = (k, v) => { if (s[k] != null) gl.uniform1i(s[k], v); };
        si('lineDragDir', { down: 0, up: 1, right: 2, left: 3 }[p.lineDragDir] ?? 0);
        fade.bindUniforms(gl, prog, p);
        blend.bindUniforms(gl, prog, p);
    },

    glsl: `
uniform float lineDragX;
uniform float lineDragY;
uniform float lineDragAngle;
uniform int   lineDragDir;
${blend.glsl}
${fade.glsl}
void main() {
    vec2 uv = vUV;

    float lineX = lineDragX / 100.0;
    float lineY = 1.0 - lineDragY / 100.0;
    float slope = -tan(lineDragAngle * 3.14159265 / 180.0);

    vec2 sampleUV;
    bool inDragRegion;

    if (lineDragDir == 0 || lineDragDir == 1) {
        float sampleY = clamp(lineY + slope * (uv.x - lineX), 0.0, 1.0);
        bool  below   = uv.y < sampleY;
        inDragRegion  = (lineDragDir == 0) ? below : !below;
        sampleUV      = vec2(uv.x, sampleY);
    } else {
        if (abs(slope) < 0.001) {
            fragColor = texture(uTex, uv);
            return;
        }
        float sampleX = clamp(lineX + (uv.y - lineY) / slope, 0.0, 1.0);
        bool  rightOf = uv.x > sampleX;
        inDragRegion  = (lineDragDir == 2) ? rightOf : !rightOf;
        sampleUV      = vec2(sampleX, uv.y);
    }

    vec4 origColor    = texture(uTex, uv);
    vec4 sampledColor = texture(uTex, sampleUV);

    bool passThreshold = ${blend.thresholdFn}(origColor, sampledColor);
    vec4 effectColor = (inDragRegion && passThreshold) ? sampledColor : origColor;

    float weight = ${fade.fnName}();

    vec3 mixed = mix(origColor.rgb, effectColor.rgb, weight);
    fragColor = vec4(${blend.blendFn}(origColor.rgb, mixed), origColor.a);
}
`,
};
