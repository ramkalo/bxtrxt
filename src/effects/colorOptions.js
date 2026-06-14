// Pure, dependency-free color-option helpers shared by effect definitions and
// the palette swatch control. Kept free of state/UI imports so effect modules
// can use it without creating an import cycle through the registry.

// Single source of truth for named color keys → hex. Includes both spellings in
// use: long (white/black/red…) and colorRemap short codes (w/bk/r/g/b/c/y/m).
export const NAMED_COLORS = {
    black: '#000000', white: '#ffffff', grey: '#808080',
    red: '#ff0000', green: '#00ff00', blue: '#0000ff',
    cyan: '#00ffff', yellow: '#ffff00', magenta: '#ff00ff',
    r: '#ff0000', g: '#00ff00', b: '#0000ff',
    c: '#00ffff', y: '#ffff00', m: '#ff00ff',
    w: '#ffffff', bk: '#000000', gr: '#808080',
};

// Canonical option set for palette color selectors: the 8 palette colors only.
export const STANDARD_COLOR_OPTIONS = [
    ['palette0', 'Color Palette 1'], ['palette1', 'Color Palette 2'],
    ['palette2', 'Color Palette 3'], ['palette3', 'Color Palette 4'],
    ['palette4', 'Color Palette 5'], ['palette5', 'Color Palette 6'],
    ['palette6', 'Color Palette 7'], ['palette7', 'Color Palette 8'],
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Resolve an option key to a single hex, or null when it has none. */
export function resolveColorKey(key, palette, customHex) {
    if (key == null || key === 'none' || key === 'paletteRandom') return null;
    if (key === 'custom') return customHex ?? null;
    if (NAMED_COLORS[key]) return NAMED_COLORS[key];
    if (HEX_RE.test(key)) return key;
    let m = key.match(/^palette(\d)$/);
    if (m && palette) return palette[+m[1]] ?? null;
    m = key.match(/^p(\d)$/);
    if (m && palette) return palette[+m[1]] ?? null;
    return null;
}
