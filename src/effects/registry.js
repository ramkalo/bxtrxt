import doubleExposureEffect from './doubleExposure.js';
import basicEffect          from './basic.js';
import digitizeEffect       from './digitize.js';
import grainEffect          from './grain.js';
import chromaEffect         from './chroma.js';
import chanSatEffect        from './chanSat.js';
import vignetteEffect       from './vignette.js';
import blurEffect           from './blur.js';
import invertEffect          from './invert.js';
import { vhsEffect } from './vhs.js';
import { textEffect } from './text.js';
import digitalSmearEffect   from './digitalSmear.js';
import lineDragEffect       from './lineDrag.js';
import corruptedEffect      from './corrupted.js';
import crtCurvatureEffect   from './crtCurvature.js';
import crtScanlinesEffect   from './crtScanlines.js';
import moireEffect          from './moire.js';
import crtStaticEffect      from './crtStatic.js';
import transformEffect      from './transform.js';
import cropEffect           from './crop.js';
import glowEffect           from './glow.js';
import viewportEffect       from './viewport.js';
import { matrixRainEffect } from './matrixRain.js';
import { shapeStickerEffect } from './shapeSticker.js';

/**
 * @typedef {Object} EffectBase
 * @property {string} name
 * @property {string} label
 * @property {'transform'|'pre-crt'|'post'|'context'|'viewport'} pass
 * @property {Record<string, {default: *, min?: number, max?: number, step?: number}>} params
 * @property {(p: object) => boolean} enabled
 * @property {string[]} [paramKeys]       — param names auto-bound to GLSL uniforms
 * @property {string[]} [handleParams]    — param names driven by canvas drag handles
 * @property {(gl: WebGL2RenderingContext, prog: WebGLProgram, params: object, dstW: number, dstH: number, srcTex?: WebGLTexture, origTex?: WebGLTexture) => void} [bindUniforms]
 * @property {Object} [uiGroups]
 */

/**
 * @typedef {EffectBase & { glsl: string, getOutputDimensions?: (p: object, w: number, h: number) => {w: number, h: number} }} TransformEffect
 * @typedef {EffectBase & { glsl: string }} GlslEffect
 * @typedef {EffectBase & { glslPasses: Array<{glsl: string, needsOriginal?: boolean}> | ((p: object) => Array<{glsl: string, needsOriginal?: boolean}>) }} MultiPassEffect
 * @typedef {EffectBase & { canvas2d: (ctx: CanvasRenderingContext2D, params: object) => void }} ContextEffect
 * @typedef {TransformEffect|GlslEffect|MultiPassEffect|ContextEffect} EffectDef
 */

const KNOWN_PASSES = new Set(['transform', 'pre-crt', 'post', 'context', 'viewport']);

/** @param {EffectDef} effect */
function validateEffect(effect) {
    const id = `Effect "${effect?.name ?? '(unknown)'}"`;
    if (typeof effect.name   !== 'string')   throw new Error(`${id}: "name" must be a string`);
    if (typeof effect.label  !== 'string')   throw new Error(`${id}: "label" must be a string`);
    if (typeof effect.pass   !== 'string')   throw new Error(`${id}: "pass" must be a string`);
    if (typeof effect.params !== 'object')   throw new Error(`${id}: "params" must be an object`);
    if (typeof effect.enabled !== 'function') throw new Error(`${id}: "enabled" must be a function`);
    if (!KNOWN_PASSES.has(effect.pass))       throw new Error(`${id}: unknown pass "${effect.pass}"`);

    if (effect.pass === 'context') {
        if (typeof effect.canvas2d !== 'function')
            throw new Error(`${id}: pass "context" requires a canvas2d function`);
    } else {
        if (!effect.glsl && !effect.glslPasses)
            throw new Error(`${id}: pass "${effect.pass}" requires glsl or glslPasses`);
    }
}

/**
 * Master ordered list of all effects.
 * Order matters: effects are applied in this sequence by the rendering pipeline.
 *
 * pass values:
 *   'transform' — resizes canvas (crop, flip, rotate), applied first; needs glsl
 *   'pre-crt'   — GLSL/multi-pass effect before context drawing; needs glsl or glslPasses
 *   'context'   — draws to a 2D canvas context (text, stickers); needs canvas2d
 *   'post'      — GLSL/multi-pass effect after context drawing; needs glsl or glslPasses
 *   'viewport'  — composites a reveal window over the full result; needs glsl
 *
 * To add a new effect: create src/effects/myEffect.js, import it here,
 * add it to EFFECTS in the correct position. That's it.
 */
export const EFFECTS = [
    transformEffect,
    cropEffect,
    doubleExposureEffect,
    basicEffect,
    digitizeEffect,
    grainEffect,
    chromaEffect,
    chanSatEffect,
    vignetteEffect,
    blurEffect,
    glowEffect,
    invertEffect,
    vhsEffect,
    textEffect,
    matrixRainEffect,
    digitalSmearEffect,
    lineDragEffect,
    corruptedEffect,
    crtCurvatureEffect,
    crtScanlinesEffect,
    crtStaticEffect,
    moireEffect,
    viewportEffect,
    shapeStickerEffect,
];

for (const effect of EFFECTS) validateEffect(effect);

// ---------------------------------------------------------------------------
// Derived param schema — auto-generated from EFFECTS, replaces hand-maintained
// params object and controlLimits in state/params.js
// ---------------------------------------------------------------------------

/**
 * Build the initial params defaults object from all effect definitions.
 * Returns: { brightness: 0, contrast: 0, ... }
 */
export function buildParamDefaults() {
    const defaults = {};
    for (const effect of EFFECTS) {
        for (const [key, schema] of Object.entries(effect.params)) {
            defaults[key] = schema.default;
        }
    }
    return defaults;
}

/**
 * Build the controlLimits object from all effect definitions.
 * Only includes params that have min/max defined.
 * Returns: { brightness: { min: -100, max: 100 }, ... }
 */
export function buildControlLimits() {
    const limits = {};
    for (const effect of EFFECTS) {
        for (const [key, schema] of Object.entries(effect.params)) {
            if ('min' in schema && 'max' in schema) {
                limits[key] = { min: schema.min, max: schema.max };
            }
        }
    }
    return limits;
}

/**
 * The user-browseable effect catalog.
 * Each entry: { name, label, description }
 */
export const EFFECT_CATALOG = [
    { name: 'basic',          label: 'Basic Adjustments',    description: 'Brightness, contrast, saturation, and color' },
    { name: 'blur',           label: 'Blur',                 description: 'Gaussian blur shaped like a vignette — sharp center, soft edges' },
    { name: 'chanSat',        label: 'Channel Saturation',   description: 'Target R, G, or B dominant pixels and boost or drain their saturation' },
    { name: 'chroma',         label: 'Chromatic Aberration', description: 'RGB channel separation glitch' },
    { name: 'corrupted',     label: 'Corrupted',            description: 'Fractal square corruption spreading from seeded points' },
    { name: 'crop',           label: 'Crop',                 description: 'Crop the image' },
    { name: 'crtCurvature',   label: 'CRT Curvature',        description: 'Barrel lens distortion' },
    { name: 'crtScanlines',   label: 'CRT Scanlines',        description: 'Horizontal scanline darkening' },
    { name: 'crtStatic',      label: 'CRT Static',           description: 'Random noise over the image' },
    { name: 'digital-smear', label: 'Digital Smear',        description: 'Wet paint brush smear with wave-modulated displacement' },
    { name: 'lineDrag',      label: 'Line Drag',            description: 'Smear pixel columns or rows from a control line across the image' },
    { name: 'digitize',       label: 'Digitize',             description: 'Pixelation, color quantization, dithering, and noise' },
    { name: 'doubleExposure', label: 'Double Exposure',      description: 'Blend two images together' },
    { name: 'grain',          label: 'Film Grain',           description: 'Analog noise and grain texture' },
    { name: 'glow',           label: 'Glow',                 description: 'Bloom halo around bright areas' },
    { name: 'invert',         label: 'Invert',               description: 'Color inversion with threshold' },
    { name: 'matrixRain',   label: 'Matrix Rain',          description: 'Tile text characters across the image in configurable grid patterns' },
    // { name: 'moire',        label: 'Moire',                description: 'Two overlapping line grids that interfere to produce wave and band patterns' },
    { name: 'transform',      label: 'Rotate',               description: 'Flip and rotate' },
    { name: 'shapeSticker',   label: 'Shape Sticker',         description: 'Apply a shape filled with solid color, static, or image grab' },
    { name: 'text',            label: 'Text',                 description: 'Text overlay with paragraph box, formatting, and canvas handles' },
    { name: 'vhs',            label: 'VHS Line Glitch',      description: 'Tracking line glitch bands' },
    { name: 'viewport',      label: 'Viewport',             description: 'Reveal a shaped window that cuts through selected effects' },
    { name: 'vignette',       label: 'Vignette',             description: 'Edge darkening or brightening' },
];

/**
 * Return default params for a named effect, or null if not found.
 */
export function getEffectDefaults(effectName) {
    const effect = EFFECTS.find(e => e.name === effectName);
    if (!effect) return null;
    const defaults = {};
    for (const [key, schema] of Object.entries(effect.params)) {
        defaults[key] = schema.default;
    }
    return defaults;
}

/**
 * Find an effect definition by name.
 */
export function getEffect(effectName) {
    return EFFECTS.find(e => e.name === effectName) || null;
}
