import blackBoxEffect       from './blackBox.js';
import doubleExposureEffect from './doubleExposure.js';
import basicEffect          from './basic.js';
import digitizeEffect       from './digitize.js';
import grainEffect          from './grain.js';
import chromaEffect         from './chroma.js';
import chanSatEffect        from './chanSat.js';
import vignetteEffect       from './vignette.js';
import blurEffect           from './blur.js';
import invertEffect          from './invert.js';
import { vhsEffect, vhsTimestampEffect } from './vhs.js';
import wavesEffect          from './waves.js';
import digitalSmearEffect   from './digitalSmear.js';
import corruptedEffect      from './corrupted.js';
import crtCurvatureEffect   from './crtCurvature.js';
import crtScanlinesEffect   from './crtScanlines.js';
import crtStaticEffect      from './crtStatic.js';
import transformEffect      from './transform.js';
import cropEffect           from './crop.js';
import glowEffect           from './glow.js';
import viewportEffect       from './viewport.js';
import { matrixRainEffect } from './matrixRain.js';

/**
 * Master ordered list of all effects.
 * Order matters: effects are applied in this sequence by the canvas 2D pipeline.
 * Each entry is an effect definition object:
 *   { name, label, pass, params, enabled(p), canvas2d }
 *
 * pass values:
 *   'transform' — canvas transform (crop, flip, rotate), applied first
 *   'pre-crt'   — imageData effect, applied before any context drawing
 *   'context'   — draws directly to the 2D canvas context (e.g. text overlays)
 *   'post'      — imageData effect, applied after context effects
 *
 * To add a new effect: create src/effects/myEffect.js, import it here,
 * add it to EFFECTS in the correct position. That's it.
 */
export const EFFECTS = [
    transformEffect,
    cropEffect,
    blackBoxEffect,
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
    vhsTimestampEffect,
    matrixRainEffect,
    wavesEffect,
    digitalSmearEffect,
    corruptedEffect,
    crtCurvatureEffect,
    crtScanlinesEffect,
    crtStaticEffect,
    viewportEffect,
];

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
 * The user-browseable effect catalog — excludes internal sub-effects
 * like vhsTimestampEffect which is typically stacked alongside vhsEffect.
 * Each entry: { name, label, description }
 */
export const EFFECT_CATALOG = [
    { name: 'basic',          label: 'Basic Adjustments',    description: 'Brightness, contrast, saturation, and color' },
    { name: 'blackBox',       label: 'Black Box',            description: 'Solid black rectangle / censor bar' },
    { name: 'blur',           label: 'Blur',                 description: 'Gaussian blur shaped like a vignette — sharp center, soft edges' },
    { name: 'chanSat',        label: 'Channel Saturation',   description: 'Target R, G, or B dominant pixels and boost or drain their saturation' },
    { name: 'chroma',         label: 'Chromatic Aberration', description: 'RGB channel separation glitch' },
    { name: 'corrupted',     label: 'Corrupted',            description: 'Fractal square corruption spreading from seeded points' },
    { name: 'crop',           label: 'Crop',                 description: 'Crop the image' },
    { name: 'crtCurvature',   label: 'CRT Curvature',        description: 'Barrel lens distortion' },
    { name: 'crtScanlines',   label: 'CRT Scanlines',        description: 'Horizontal scanline darkening' },
    { name: 'crtStatic',      label: 'CRT Static',           description: 'Random noise over the image' },
    { name: 'digital-smear', label: 'Digital Smear',        description: 'Wet paint brush smear with wave-modulated displacement' },
    { name: 'digitize',       label: 'Digitize',             description: 'Pixelation, color quantization, dithering, and noise' },
    { name: 'doubleExposure', label: 'Double Exposure',      description: 'Blend two images together' },
    { name: 'grain',          label: 'Film Grain',           description: 'Analog noise and grain texture' },
    { name: 'glow',           label: 'Glow',                 description: 'Bloom halo around bright areas' },
    { name: 'invert',         label: 'Invert',               description: 'Color inversion with threshold' },
    { name: 'matrixRain',   label: 'Matrix Rain',          description: 'Tile text characters across the image in configurable grid patterns' },
    { name: 'transform',      label: 'Rotate',               description: 'Flip and rotate' },
    { name: 'viewport',      label: 'Viewport',             description: 'Reveal a shaped window that cuts through selected effects' },
    { name: 'vignette',       label: 'Vignette',             description: 'Edge darkening or brightening' },
    { name: 'vhs',            label: 'VHS Line Glitch',      description: 'Tracking line glitch bands' },
    { name: 'vhsTimestamp',   label: 'VHS Timestamp',        description: 'Retro timestamp text overlay' },
    { name: 'waves',          label: 'Chroma Waves',         description: 'Per-channel wave distortion with radial fade' },
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
