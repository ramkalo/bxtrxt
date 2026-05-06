import { buildFadeControl, buildThresholdControl } from './controls/index.js';

const fade      = buildFadeControl('lineDrag');
const threshold = buildThresholdControl('lineDrag');

export default {
    name:  'lineDrag',
    label: 'Line Drag',
    pass:  'pre-crt',

    handleParams: ['lineDragX', 'lineDragY', 'lineDragAngle', ...fade.handleParams],

    paramKeys: [
        'lineDragX', 'lineDragY', 'lineDragAngle', 'lineDragDir',
        'lineDragThresholdOnDest',
        ...threshold.paramKeys,
        ...fade.paramKeys,
    ],

    params: {
        lineDragEnabled:          { default: false, label: 'Enable' },
        lineDragX:                { default: 50, min: 0, max: 100, label: 'X' },
        lineDragY:                { default: 50, min: 0, max: 100, label: 'Y' },
        lineDragAngle:            { default: 0, min: -89, max: 89, step: 1, label: 'Angle' },
        lineDragDir:              { default: 'down', label: 'Direction', options: [['down', 'Down'], ['up', 'Up'], ['right', 'Right'], ['left', 'Left']] },
        lineDragThresholdOnDest:  { default: false, label: 'On Destination' },
        ...threshold.params,
        ...fade.params,
    },

    uiGroups: [
        { keys: ['lineDragEnabled', 'lineDragAngle', 'lineDragDir'] },
        { label: 'Threshold', keys: ['lineDragThresholdOnDest', ...threshold.uiGroup.keys] },
        fade.uiGroup,
    ],

    enabled: (p) => p.lineDragEnabled,

    bindUniforms: (gl, prog, p) => {
        const s  = prog._locs;
        const si = (k, v) => { if (s[k] != null) gl.uniform1i(s[k], v); };
        si('lineDragDir', { down: 0, up: 1, right: 2, left: 3 }[p.lineDragDir] ?? 0);
        fade.bindUniforms(gl, prog, p);
        threshold.bindUniforms(gl, prog, p);
    },

    glsl: `
uniform float lineDragX;
uniform float lineDragY;
uniform float lineDragAngle;
uniform int   lineDragDir;
uniform int   lineDragThresholdOnDest;
${threshold.glsl}
${fade.glsl}
void main() {
    vec2 uv = vUV;

    // Anchor in UV space; negate slope because UV y=0 is bottom (screen y is flipped)
    float lineX = lineDragX / 100.0;
    float lineY = 1.0 - lineDragY / 100.0;
    float slope = -tan(lineDragAngle * 3.14159265 / 180.0);

    // Step 1-2: determine drag region and sample point
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

    // Step 3: sample colors
    vec4 origColor    = texture(uTex, uv);
    vec4 sampledColor = texture(uTex, sampleUV);

    // Step 4: threshold check
    vec4 checkColor = (lineDragThresholdOnDest == 1) ? origColor : sampledColor;
    bool passThreshold = ${threshold.fnName}(checkColor);
    vec4 effectColor = (inDragRegion && passThreshold) ? sampledColor : origColor;

    // Step 5: fade weight
    float weight = ${fade.fnName}();

    // Step 6: output
    fragColor = mix(origColor, effectColor, weight);
}
`,
};
