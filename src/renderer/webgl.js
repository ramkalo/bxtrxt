import {
    canvas, gl,
    originalImage,
    fboPool, programCache, quadVAO,
    overlayCanvas, overlayCtx,
    setOriginalTexture, setFboPool,
} from './glstate.js';
import { getEffect } from '../effects/registry.js';

// Coordinate system: UNPACK_FLIP_Y_WEBGL=true on image uploads, no Y flip in vertex shader.
// vUV = (0,0) at screen/image bottom-left, (1,1) at screen/image top-right.
// For row-from-top: float row = (1.0 - vUV.y) * uResolution.y

// --- GLSL sources ---

const VERT_SRC = `#version 300 es
out vec2 vUV;
void main() {
    float x = float(gl_VertexID & 1);
    float y = float((gl_VertexID >> 1) & 1);
    gl_Position = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    vUV = vec2(x, y);
}`;

// Prepended to every fragment shader source
export const FRAG_HEADER = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform vec2 uTexelSize;
`;

const PASSTHROUGH_FRAG = `void main() { fragColor = texture(uTex, vUV); }`;

// --- Texture helpers ---

export function createTexture(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
}

// Upload an HTMLImageElement, HTMLCanvasElement, etc. to a new texture.
export function uploadToTexture(source) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
}

function createFBO(w, h) {
    const tex = createTexture(w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, width: w, height: h };
}

function destroyFBO(fb) {
    if (!fb) return;
    gl.deleteTexture(fb.tex);
    gl.deleteFramebuffer(fb.fbo);
}

function reallocFBOs(w, h) {
    destroyFBO(fboPool[0]);
    destroyFBO(fboPool[1]);
    setFboPool([createFBO(w, h), createFBO(w, h)]);
}

// --- Shader/program helpers ---

function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
    }
    return s;
}

export function getProgram(fragSrc) {
    if (programCache.has(fragSrc)) return programCache.get(fragSrc);
    const vert = compileShader(gl.VERTEX_SHADER, VERT_SRC);
    const frag = compileShader(gl.FRAGMENT_SHADER, FRAG_HEADER + fragSrc);
    if (!vert || !frag) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(prog));
        return null;
    }
    // Cache all uniform locations up front — never call getUniformLocation per frame
    prog._locs = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        if (info) prog._locs[info.name] = gl.getUniformLocation(prog, info.name);
    }
    programCache.set(fragSrc, prog);
    return prog;
}

// --- Draw helpers ---

function setStdUniforms(prog, w, h) {
    if (prog._locs.uResolution != null) gl.uniform2f(prog._locs.uResolution, w, h);
    if (prog._locs.uTexelSize  != null) gl.uniform2f(prog._locs.uTexelSize, 1 / w, 1 / h);
}

function bindTex0(prog, tex) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (prog._locs.uTex != null) gl.uniform1i(prog._locs.uTex, 0);
}

function autoBindUniforms(prog, effect, params) {
    for (const key of (effect.paramKeys || [])) {
        const loc = prog._locs[key];
        if (loc == null) continue;
        const val = params[key];
        if (typeof val === 'number')       gl.uniform1f(loc, val);
        else if (typeof val === 'boolean') gl.uniform1i(loc, val ? 1 : 0);
        // string params handled by effect.bindUniforms
    }
}

function drawQuad() {
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
}

// Render fragSrc into dstFbo (or the default framebuffer when dstFbo is null).
function runPass(fragSrc, srcTex, dstFbo, effect, params) {
    const prog = getProgram(fragSrc);
    if (!prog) return false;

    const dstW = dstFbo ? dstFbo.width  : canvas.width;
    const dstH = dstFbo ? dstFbo.height : canvas.height;

    if (dstFbo) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo.fbo);
        gl.viewport(0, 0, dstW, dstH);
    } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, dstW, dstH);
    }

    gl.useProgram(prog);
    bindTex0(prog, srcTex);
    setStdUniforms(prog, dstW, dstH);

    if (effect) {
        autoBindUniforms(prog, effect, params);
        if (effect.bindUniforms) effect.bindUniforms(gl, prog, params, dstW, dstH, srcTex);
    }
    drawQuad();
    return true;
}

// --- Original-image texture ---
let _origTex = null;
let _lastOriginalImage = null;

// Show the unprocessed original image (used by long-press compare in touch.js).
export function blitOriginalToScreen() {
    if (!_origTex) return;
    runPass(PASSTHROUGH_FRAG, _origTex, null, null, null);
}

// --- Shared effect loop ---

function _runEffects(stack) {
    let srcTex = _origTex;
    let pingIdx = 0;

    for (let i = 0; i < stack.length; i++) {
        const instance = stack[i];
        const effect = getEffect(instance.effectName);
        if (!effect || !effect.enabled(instance.params)) continue;

        if (effect.pass === 'transform') {
            if (!effect.glsl) continue;

            const curW = fboPool[0]?.width  || canvas.width;
            const curH = fboPool[0]?.height || canvas.height;
            const outDims = effect.getOutputDimensions
                ? effect.getOutputDimensions(instance.params, curW, curH)
                : { w: curW, h: curH };

            const needResize = outDims.w !== curW || outDims.h !== curH;

            const prog = getProgram(effect.glsl);
            if (!prog) continue;

            const tmpFbo = createFBO(outDims.w, outDims.h);
            gl.bindFramebuffer(gl.FRAMEBUFFER, tmpFbo.fbo);
            gl.viewport(0, 0, outDims.w, outDims.h);
            gl.useProgram(prog);
            bindTex0(prog, srcTex);
            setStdUniforms(prog, outDims.w, outDims.h);
            autoBindUniforms(prog, effect, instance.params);
            if (effect.bindUniforms) effect.bindUniforms(gl, prog, instance.params, curW, curH);
            drawQuad();

            if (needResize) {
                reallocFBOs(outDims.w, outDims.h);
                canvas.width  = outDims.w;
                canvas.height = outDims.h;
            }

            const poolDst = fboPool[pingIdx % 2];
            runPass(PASSTHROUGH_FRAG, tmpFbo.tex, poolDst, null, null);
            destroyFBO(tmpFbo);

            srcTex = poolDst.tex;
            pingIdx++;
            continue;
        }

        if (effect.pass === 'context') {
            if (!overlayCanvas || !overlayCtx || !effect.canvas2d) continue;

            runPass(PASSTHROUGH_FRAG, srcTex, null, null, null);
            overlayCtx.clearRect(0, 0, canvas.width, canvas.height);
            overlayCtx.drawImage(canvas, 0, 0);
            effect.canvas2d(overlayCtx, instance.params);

            const dstFbo = fboPool[pingIdx % 2];
            const overlayTex = uploadToTexture(overlayCanvas);
            runPass(PASSTHROUGH_FRAG, overlayTex, dstFbo, null, null);
            gl.deleteTexture(overlayTex);

            srcTex = dstFbo.tex;
            pingIdx++;
            continue;
        }

        if (effect.glslPasses) {
            const passList = typeof effect.glslPasses === 'function'
                ? effect.glslPasses(instance.params)
                : effect.glslPasses;

            // If any pass needs the pre-effect input via uTexOriginal, copy srcTex
            // into a dedicated temp FBO first. The ping-pong passes only have 2 slots
            // and will overwrite whichever pool FBO srcTex came from, corrupting it.
            const needsCopy = passList.some(p => p.needsOriginal);
            let prePassesFBO = null;
            let prePasses = srcTex;
            if (needsCopy) {
                prePassesFBO = createFBO(fboPool[0].width, fboPool[0].height);
                runPass(PASSTHROUGH_FRAG, srcTex, prePassesFBO, null, null);
                prePasses = prePassesFBO.tex;
            }

            let passSrc = srcTex;
            let lastFbo = null;

            for (const pass of passList) {
                const dstFbo = fboPool[pingIdx % 2];
                const prog = getProgram(pass.glsl);
                if (!prog) { pingIdx++; continue; }

                gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo.fbo);
                gl.viewport(0, 0, dstFbo.width, dstFbo.height);
                gl.useProgram(prog);
                bindTex0(prog, passSrc);
                setStdUniforms(prog, dstFbo.width, dstFbo.height);
                autoBindUniforms(prog, effect, instance.params);
                if (effect.bindUniforms) effect.bindUniforms(gl, prog, instance.params, dstFbo.width, dstFbo.height, passSrc);

                if (pass.needsOriginal && prog._locs.uTexOriginal != null) {
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, prePasses);
                    gl.uniform1i(prog._locs.uTexOriginal, 1);
                }
                drawQuad();

                passSrc = dstFbo.tex;
                lastFbo = dstFbo;
                pingIdx++;
            }

            if (prePassesFBO) destroyFBO(prePassesFBO);
            if (lastFbo) srcTex = lastFbo.tex;
            continue;
        }

        if (!effect.glsl) continue;

        const dstFbo = fboPool[pingIdx % 2];
        if (!runPass(effect.glsl, srcTex, dstFbo, effect, instance.params)) continue;

        srcTex = dstFbo.tex;
        pingIdx++;
    }

    runPass(PASSTHROUGH_FRAG, srcTex, null, null, null);
    if (overlayCanvas && overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

// --- Main pipeline ---

export function processWebGLStack(stack) {
    if (overlayCanvas && overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const w = originalImage.width;
    const h = originalImage.height;

    if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
    }

    if (!fboPool[0] || fboPool[0].width !== w || fboPool[0].height !== h) reallocFBOs(w, h);

    if (overlayCanvas && (overlayCanvas.width !== w || overlayCanvas.height !== h)) {
        overlayCanvas.width  = w;
        overlayCanvas.height = h;
    }

    if (originalImage !== _lastOriginalImage) {
        if (_origTex) gl.deleteTexture(_origTex);
        _origTex = uploadToTexture(originalImage);
        setOriginalTexture(_origTex);
        _lastOriginalImage = originalImage;
    }

    _runEffects(stack);
}

// --- Export pipeline ---
// Renders at full image resolution to canvas before toBlob() capture.

export function renderForExport(stack) {
    const w = originalImage.width;
    const h = originalImage.height;

    if (overlayCanvas && overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Resize to full image dims if canvas is currently at a different size
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);

        if (_origTex) gl.deleteTexture(_origTex);
        _origTex = uploadToTexture(originalImage);
        setOriginalTexture(_origTex);

        if (!fboPool[0] || fboPool[0].width !== w || fboPool[0].height !== h) reallocFBOs(w, h);

        if (overlayCanvas) {
            overlayCanvas.width  = w;
            overlayCanvas.height = h;
        }

        _lastOriginalImage = null; // force preview to re-setup after export
    }

    _runEffects(stack);
}
