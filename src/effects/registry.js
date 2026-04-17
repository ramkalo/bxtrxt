import doubleExposureEffect from './doubleExposure.js';
import basicEffect          from './basic.js';
import digitizeEffect       from './digitize.js';
import grainEffect          from './grain.js';
import pixelArtEffect       from './pixelArt.js';
import chromaEffect         from './chroma.js';
import vignetteEffect       from './vignette.js';
import invertEffect         from './invert.js';
import { vhsEffect, vhsTimestampEffect } from './vhs.js';
import wavesEffect          from './waves.js';
import crtEffect            from './crt.js';

/**
 * Master ordered list of all effects.
 * Order matters: effects are applied in this sequence by the canvas 2D pipeline.
 * Each entry is an effect definition object:
 *   { name, label, pass, params, enabled(p), canvas2d }
 *
 * pass values:
 *   'pre-crt'  — imageData effect, applied before any context drawing
 *   'context'  — draws directly to the 2D canvas context (e.g. text overlays)
 *   'post'     — imageData effect, applied after context effects
 *
 * To add a new effect: create src/effects/myEffect.js, import it here,
 * add it to EFFECTS in the correct position. That's it.
 */
export const EFFECTS = [
    doubleExposureEffect,
    basicEffect,
    digitizeEffect,
    grainEffect,
    pixelArtEffect,
    chromaEffect,
    vignetteEffect,
    invertEffect,
    vhsEffect,
    vhsTimestampEffect,
    wavesEffect,
    crtEffect,
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
    { name: 'basic',          label: 'Basic Adjustments',   description: 'Brightness, contrast, saturation, and color' },
    { name: 'grain',          label: 'Film Grain',           description: 'Analog noise and grain texture' },
    { name: 'vignette',       label: 'Vignette',             description: 'Edge darkening or brightening' },
    { name: 'chroma',         label: 'Chromatic Aberration', description: 'RGB channel separation glitch' },
    { name: 'invert',         label: 'Invert',               description: 'Color inversion with threshold' },
    { name: 'digitize',       label: 'Digitize',             description: 'Dithering and digital noise' },
    { name: 'pixelArt',       label: 'Pixel Art',            description: 'Pixel size reduction and color quantization' },
    { name: 'vhs',            label: 'VHS Effect',           description: 'Tracking, color bleed, and VHS noise' },
    { name: 'vhsTimestamp',   label: 'VHS Timestamp',        description: 'Retro timestamp text overlay' },
    { name: 'waves',          label: 'Waves',                description: 'Wave distortion per color channel' },
    { name: 'crt',            label: 'CRT Effect',           description: 'Curvature, scanlines, and static' },
    { name: 'doubleExposure', label: 'Double Exposure',      description: 'Blend two images together' },
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
