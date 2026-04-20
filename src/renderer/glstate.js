export const canvas = document.getElementById('mainCanvas');

export let gl = null;
export let originalTexture = null;
export let secondTexture = null;
export let fboPool = [null, null]; // [{ fbo, tex, width, height }, ...]
export let programCache = new Map(); // fragSrc → WebGLProgram (with ._locs)
export let quadVAO = null;

export let overlayCanvas = document.getElementById('overlayCanvas');
export let overlayCtx = null;

export let originalImage = null;
export let secondImage = null;

function init() {
    const ctx = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false });
    if (!ctx) throw new Error('WebGL2 is required. Please use Chrome, Firefox, or Edge.');
    gl = ctx;
    quadVAO = gl.createVertexArray();
    if (overlayCanvas) overlayCtx = overlayCanvas.getContext('2d');
}
init();

export function setOriginalImage(v)   { originalImage = v; }
export function setSecondImage(v)     { secondImage = v; }
export function setOriginalTexture(v) { originalTexture = v; }
export function setSecondTexture(v)   { if (secondTexture && gl) gl.deleteTexture(secondTexture); secondTexture = v; }
export function setFboPool(v)         { fboPool = v; }
