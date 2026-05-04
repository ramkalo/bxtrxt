// Shared mutable state for the one active overlay at a time.
// All overlay modules import this object and read/write its properties.
export const state = {
    mode:        null,   // 'fade' | 'blur' | 'crop' | 'viewport' | 'lineDrag' | 'chroma' | 'vignette' | 'crtCurvature' | 'corrupted' | 'text' | 'doubleExposure' | 'shapeSticker' | 'matrixRain' | null
    instId:      null,
    dragging:    false,
    xKey:        null,
    yKey:        null,
    shapeKey:    null,   // param key for shape enum (fade, lineDrag, doubleExposure)
    wKey:        null,
    hKey:        null,
    angleKey:    null,
    enabledKey:  null,   // param key for fade enabled boolean
    skewKey:     null,   // param key for text skew X angle
    handle:      null,   // currently grabbed handle name
    dragAnchor:  null,   // mode-specific drag anchor state
    vpResetting: false,  // re-entrancy guard for _resetPolygonVertices
};
