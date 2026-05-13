import {
    canvas, gl,
    originalImage,
    fboPool, programCache, quadVAO,
    overlayCanvas, overlayCtx,
    setFboPool, setSecondTexture,
} from './glstate.js';
import { getEffect } from '../effects/registry.js';
import { isCropPreviewActive } from '../state/cropPreview.js';
import { buildBlendControl, buildFadeControl } from '../effects/controls/index.js';

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
        if (effect.bindUniforms) effect.bindUniforms(gl, prog, params, dstW, dstH, srcTex, _origTex);
    }
    drawQuad();
    return true;
}

// --- Original-image texture ---
let _origTex = null;
let _lastOriginalImage = null;

// --- Overlay texture cache ---
let _overlayTex  = null;
let _overlayTexW = 0;
let _overlayTexH = 0;

function _getOverlayTex() {
    const w = overlayCanvas.width, h = overlayCanvas.height;
    if (!_overlayTex || _overlayTexW !== w || _overlayTexH !== h) {
        if (_overlayTex) gl.deleteTexture(_overlayTex);
        _overlayTex  = createTexture(w, h);
        _overlayTexW = w;
        _overlayTexH = h;
    }
    gl.bindTexture(gl.TEXTURE_2D, _overlayTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, overlayCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return _overlayTex;
}

// --- Sticker texture cache (canvas2d blend compositor) ---
let _stickerTex  = null;
let _stickerTexW = 0;
let _stickerTexH = 0;

function _uploadStickerTex(stickerCanvas) {
    const w = stickerCanvas.width, h = stickerCanvas.height;
    if (!_stickerTex || _stickerTexW !== w || _stickerTexH !== h) {
        if (_stickerTex) gl.deleteTexture(_stickerTex);
        _stickerTex  = createTexture(w, h);
        _stickerTexW = w;
        _stickerTexH = h;
    }
    gl.bindTexture(gl.TEXTURE_2D, _stickerTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, stickerCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return _stickerTex;
}

// Caches of blend/fade controls keyed by prefix, built on first use
const _blendControlCache = new Map();
const _fadeControlCache  = new Map();
function _getBlendControl(prefix) {
    if (!_blendControlCache.has(prefix)) _blendControlCache.set(prefix, buildBlendControl(prefix));
    return _blendControlCache.get(prefix);
}
function _getFadeControl(prefix) {
    if (!_fadeControlCache.has(prefix)) _fadeControlCache.set(prefix, buildFadeControl(prefix));
    return _fadeControlCache.get(prefix);
}

function _buildCanvas2DCompositorGLSL(blend, fade) {
    const blendEnabledUniform = blend.blendFn.replace('Blend', 'BlendEnabled');
    const opacityUniform      = blend.blendFn.replace('Blend', 'Opacity');
    return `uniform sampler2D uStickerTex;

${blend.glsl}
${fade ? fade.glsl : ''}

void main() {
    vec4 c   = texture(uTex, vUV);
    vec4 src = texture(uStickerTex, vUV);
    if (src.a < 0.001) { fragColor = c; return; }
    if (!${blend.thresholdFn}(c, src)) { fragColor = c; return; }
    vec3 srcColor = (${blendEnabledUniform} == 1)
        ? vec3(${blend.blendChFn}(c.r, src.r),
               ${blend.blendChFn}(c.g, src.g),
               ${blend.blendChFn}(c.b, src.b))
        : src.rgb;
    float blendAlpha = (${blendEnabledUniform} == 1) ? ${opacityUniform} / 100.0 : 1.0;
    float weight = ${fade ? `${fade.fnName}()` : '1.0'};
    fragColor = vec4(mix(c.rgb, srcColor, src.a * blendAlpha * weight), c.a);
}`;
}

// --- Transform FBO cache ---
let _transformFBO = null;

// --- Viewport composite FBOs ---
let _vpEntryFBO = null;
let _vpPreFBO   = null;
let _vpFullFBO  = null;

function _reallocVpFBOs(w, h) {
    if (_vpEntryFBO?.width === w && _vpEntryFBO?.height === h) return;
    destroyFBO(_vpEntryFBO); _vpEntryFBO = createFBO(w, h);
    destroyFBO(_vpPreFBO);   _vpPreFBO   = createFBO(w, h);
    destroyFBO(_vpFullFBO);  _vpFullFBO  = createFBO(w, h);
}

// Show the unprocessed original image (used by long-press compare in touch.js).
export function blitOriginalToScreen() {
    if (!_origTex) return;
    runPass(PASSTHROUGH_FRAG, _origTex, null, null, null);
}

// --- Shared effect loop ---

// Run a slice of the stack, starting from startTex. Returns the resulting srcTex
// (pointing into fboPool). Does NOT blit to screen. Skips 'viewport' pass effects.
function _runLinear(stack, startTex, inheritedPalette = null) {
    let srcTex = startTex;
    let pingIdx = 0;
    let activePalette = inheritedPalette;

    for (let i = 0; i < stack.length; i++) {
        const instance = stack[i];
        const effect = getEffect(instance.effectName);

        // Track the most recent enabled color palette effect for downstream effects
        if (instance.effectName === 'colorPalette' && instance.params.paletteEnabled) {
            activePalette = Array.from({ length: 8 }, (_, j) => instance.params[`palette${j}`]);
        }

        // Merge active palette into render params without mutating instance.params
        const renderParams = activePalette
            ? { ...instance.params, _activePalette: activePalette }
            : instance.params;

        if (!effect || !effect.enabled(renderParams)) continue;
        if (effect.pass === 'viewport') continue;

        if (effect.pass === 'transform') {
            // In crop-preview mode keep the canvas at full image size
            if (instance.effectName === 'crop' && isCropPreviewActive()) continue;
            if (!effect.glsl) continue;

            const curW = fboPool[0]?.width  || canvas.width;
            const curH = fboPool[0]?.height || canvas.height;
            const outDims = effect.getOutputDimensions
                ? effect.getOutputDimensions(renderParams, curW, curH)
                : { w: curW, h: curH };

            const needResize = outDims.w !== curW || outDims.h !== curH;

            const prog = getProgram(effect.glsl);
            if (!prog) continue;

            if (!_transformFBO || _transformFBO.width !== outDims.w || _transformFBO.height !== outDims.h) {
                destroyFBO(_transformFBO);
                _transformFBO = createFBO(outDims.w, outDims.h);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, _transformFBO.fbo);
            gl.viewport(0, 0, outDims.w, outDims.h);
            gl.useProgram(prog);
            bindTex0(prog, srcTex);
            setStdUniforms(prog, outDims.w, outDims.h);
            autoBindUniforms(prog, effect, renderParams);
            if (effect.bindUniforms) effect.bindUniforms(gl, prog, renderParams, curW, curH);
            drawQuad();

            if (needResize) {
                reallocFBOs(outDims.w, outDims.h);
                canvas.width  = outDims.w;
                canvas.height = outDims.h;
            }

            const poolDst = fboPool[pingIdx % 2];
            runPass(PASSTHROUGH_FRAG, _transformFBO.tex, poolDst, null, null);

            srcTex = poolDst.tex;
            pingIdx++;
            continue;
        }

        if (effect.pass === 'context') {
            if (!overlayCanvas || !overlayCtx || !effect.canvas2d) continue;

            // Blit current state to canvas so canvas2d effects can read pixels via srcCanvas.
            // Keep overlayCanvas in sync with the current canvas size — transform passes
            // (e.g. crop) may have resized the canvas since processWebGLStack set it to
            // the full image size. If sizes differ, the blit into the pool FBO maps the
            // entire overlayCanvas texture over a smaller target, producing a stretched image.
            runPass(PASSTHROUGH_FRAG, srcTex, null, null, null);
            if (overlayCanvas.width !== canvas.width || overlayCanvas.height !== canvas.height) {
                overlayCanvas.width  = canvas.width;
                overlayCanvas.height = canvas.height;
            }

            const dstFbo = fboPool[pingIdx % 2];

            if (effect.blendPrefix) {
                // Render effect onto a transparent sticker canvas, then blend onto pipeline via WebGL.
                // Blit current pipeline state to overlayCanvas so canvas2d effects can read source pixels.
                overlayCtx.clearRect(0, 0, canvas.width, canvas.height);
                overlayCtx.drawImage(canvas, 0, 0);
                const stickerCanvas = new OffscreenCanvas(canvas.width, canvas.height);
                effect.canvas2d(stickerCanvas.getContext('2d'), renderParams, overlayCanvas);

                const stickerTex = _uploadStickerTex(stickerCanvas);
                const blend      = _getBlendControl(effect.blendPrefix);
                const fade       = _getFadeControl(effect.blendPrefix);
                const prog       = getProgram(_buildCanvas2DCompositorGLSL(blend, fade));
                if (prog) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo.fbo);
                    gl.viewport(0, 0, dstFbo.width, dstFbo.height);
                    gl.useProgram(prog);
                    bindTex0(prog, srcTex);
                    setStdUniforms(prog, dstFbo.width, dstFbo.height);
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, stickerTex);
                    if (prog._locs.uStickerTex != null) gl.uniform1i(prog._locs.uStickerTex, 1);
                    gl.activeTexture(gl.TEXTURE0);
                    autoBindUniforms(prog, effect, renderParams);
                    if (effect.bindUniforms) effect.bindUniforms(gl, prog, renderParams, dstFbo.width, dstFbo.height);
                    drawQuad();
                }
            } else {
                // Legacy path: draw directly onto overlayCanvas (for canvas2d effects without blend controls).
                overlayCtx.clearRect(0, 0, canvas.width, canvas.height);
                overlayCtx.drawImage(canvas, 0, 0);
                effect.canvas2d(overlayCtx, renderParams);
                runPass(PASSTHROUGH_FRAG, _getOverlayTex(), dstFbo, null, null);
            }

            srcTex = dstFbo.tex;
            pingIdx++;
            continue;
        }

        if (effect.glslPasses) {
            const passList = typeof effect.glslPasses === 'function'
                ? effect.glslPasses(renderParams)
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
                autoBindUniforms(prog, effect, renderParams);
                if (effect.bindUniforms) effect.bindUniforms(gl, prog, renderParams, dstFbo.width, dstFbo.height, passSrc);

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
        if (!runPass(effect.glsl, srcTex, dstFbo, effect, renderParams)) continue;

        srcTex = dstFbo.tex;
        pingIdx++;
    }

    return { tex: srcTex, palette: activePalette };
}

function _runViewportComposite(vpInst, fullTex, windowTex, targetFbo = null) {
    const effect = getEffect('viewport');
    const params = vpInst.params;
    const w = canvas.width, h = canvas.height;
    const prog = getProgram(effect.glsl);
    if (!prog) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo ? targetFbo.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    bindTex0(prog, fullTex);       // uTex = outside (full result)
    setStdUniforms(prog, w, h);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, windowTex);
    if (prog._locs['uTexWindow'] != null) gl.uniform1i(prog._locs['uTexWindow'], 1);
    gl.activeTexture(gl.TEXTURE0);

    autoBindUniforms(prog, effect, params);
    if (effect.bindUniforms) effect.bindUniforms(gl, prog, params, w, h);
    drawQuad();
}

function _runEffects(stack) {
    // Collect all enabled viewport pairs in stack order
    const pairs = [];
    for (let i = 0; i < stack.length; i++) {
        const inst = stack[i];
        if (getEffect(inst.effectName)?.pass !== 'viewport') continue;
        if (!inst.params.vpEnabled) continue;
        const entryId  = inst.params.vpEntryId;
        const entryIdx = entryId
            ? stack.findIndex(s => s.id === entryId)
            : stack.findIndex(s => s.effectName === 'viewportEntry'); // legacy fallback
        pairs.push({ vpIdx: i, vpInst: inst, entryIdx });
    }

    if (pairs.length === 0) {
        if (_vpEntryFBO) {
            destroyFBO(_vpEntryFBO); _vpEntryFBO = null;
            destroyFBO(_vpPreFBO);   _vpPreFBO   = null;
            destroyFBO(_vpFullFBO);  _vpFullFBO  = null;
        }
        const { tex: srcTex } = _runLinear(stack, _origTex);
        runPass(PASSTHROUGH_FRAG, srcTex, null, null, null);
        if (overlayCanvas && overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        return;
    }

    // Process each viewport pair sequentially. The composite result of pair N
    // becomes the input texture for pair N+1's pre-entry segment.
    let currentTex     = _origTex;
    let currentPalette = null;
    let stackPos       = 0;

    for (const { vpIdx, vpInst, entryIdx } of pairs) {
        const hasEntry    = entryIdx !== -1 && entryIdx < vpIdx && entryIdx >= stackPos;
        const preEntryEnd = hasEntry ? entryIdx : vpIdx;

        const preEntrySlice = stack.slice(stackPos, preEntryEnd);
        const midSlice      = hasEntry ? stack.slice(entryIdx + 1, vpIdx) : [];

        // Run pre-entry effects (may resize canvas via crop), then allocate FBOs
        const { tex: entryTex, palette: entryPalette } = _runLinear(preEntrySlice, currentTex, currentPalette);
        _reallocVpFBOs(canvas.width, canvas.height);
        runPass(PASSTHROUGH_FRAG, entryTex, _vpEntryFBO, null, null);

        // Run mid effects → outside texture
        const { tex: midTex, palette: midPalette } = _runLinear(midSlice, _vpEntryFBO.tex, entryPalette);
        runPass(PASSTHROUGH_FRAG, midTex, _vpFullFBO, null, null);

        // Composite: outside=fullFBO, window=entryFBO → preFBO
        _runViewportComposite(vpInst, _vpFullFBO.tex, _vpEntryFBO.tex, _vpPreFBO);

        currentTex     = _vpPreFBO.tex;
        currentPalette = midPalette;
        stackPos       = vpIdx + 1;
    }

    // Run any remaining effects after the last viewport, then output to screen
    const { tex: finalTex } = _runLinear(stack.slice(stackPos), currentTex, currentPalette);
    runPass(PASSTHROUGH_FRAG, finalTex, null, null, null);
    if (overlayCanvas && overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

// --- Main pipeline ---

export function processWebGLStack(stack) {
    if (overlayCanvas && overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const imgW = originalImage.width;
    const imgH = originalImage.height;

    // Render at the canvas element's visible CSS size so pixel-space effects
    // (grain, scanlines, pixelate, etc.) have the same visual density in the
    // preview as they do in the export when viewed at the same scale.
    // Temporarily restore canvas to image dims so CSS max-width/max-height
    // can compute the correct constrained display size.
    canvas.width  = imgW;
    canvas.height = imgH;
    const rect = canvas.getBoundingClientRect();
    const dw = Math.round(rect.width)  || imgW;
    const dh = Math.round(rect.height) || imgH;
    canvas.width  = dw;
    canvas.height = dh;
    gl.viewport(0, 0, dw, dh);

    if (!fboPool[0] || fboPool[0].width !== dw || fboPool[0].height !== dh) reallocFBOs(dw, dh);

    if (overlayCanvas && (overlayCanvas.width !== dw || overlayCanvas.height !== dh)) {
        overlayCanvas.width  = dw;
        overlayCanvas.height = dh;
    }

    if (originalImage !== _lastOriginalImage) {
        if (_origTex) gl.deleteTexture(_origTex);
        _origTex = uploadToTexture(originalImage);
        _lastOriginalImage = originalImage;
    }

    _runEffects(stack);
}

// --- Pixel sampling ---

// Render the stack up to (but not including) the given instance, read back pixels.
// Used by the palette "Build From Image" feature.
export function getPixelsBeforeInstance(stack, instId) {
    if (!_origTex || !fboPool[0]) return null;
    const idx = stack.findIndex(inst => inst.id === instId);
    if (idx === -1) return null;
    const preStack = stack.slice(0, idx);

    const { tex: srcTex } = _runLinear(preStack, _origTex);

    const w = fboPool[0].width;
    const h = fboPool[0].height;
    const tempFBO = createFBO(w, h);
    runPass(PASSTHROUGH_FRAG, srcTex, tempFBO, null, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO.fbo);
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    destroyFBO(tempFBO);
    return { pixels, width: w, height: h };
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

        if (!fboPool[0] || fboPool[0].width !== w || fboPool[0].height !== h) reallocFBOs(w, h);

        if (overlayCanvas) {
            overlayCanvas.width  = w;
            overlayCanvas.height = h;
        }

        _lastOriginalImage = null; // force preview to re-setup after export
    }

    _runEffects(stack);
}

export function cleanupWebGL() {
    fboPool.forEach(f => destroyFBO(f));
    setFboPool([null, null]);
    destroyFBO(_transformFBO); _transformFBO = null;
    destroyFBO(_vpEntryFBO);   _vpEntryFBO = null;
    destroyFBO(_vpPreFBO);     _vpPreFBO   = null;
    destroyFBO(_vpFullFBO);    _vpFullFBO  = null;
    if (_origTex)    { gl.deleteTexture(_origTex);    _origTex    = null; }
    if (_overlayTex) { gl.deleteTexture(_overlayTex); _overlayTex = null; }
    if (_stickerTex) { gl.deleteTexture(_stickerTex); _stickerTex = null; }
    _blendControlCache.clear();
    _fadeControlCache.clear();
    setSecondTexture(null);
    programCache.forEach(prog => gl.deleteProgram(prog));
    programCache.clear();
    gl.deleteVertexArray(quadVAO);
}
