# Retroinator

A browser-based image processing tool with retro effects. Works offline — no server required.

**Live Demo:** https://flipflopverb.github.io/Retroinator/

## Features

- **Basic Adjustments** — Brightness, Contrast, Saturation, Highlights, Shadows, Temperature, Tint
- **Digitize** — Ordered dithering, random noise
- **Invert** — Full color invert or channel-specific (Red↔Cyan, Green↔Magenta, Blue↔Yellow, Black vs White)
- **Film Grain** — Add retro film grain texture
- **Pixel Art** — Adjustable pixel size and color palette
- **Chromatic Aberration** — Independent RGB channel offset controls
- **Vignette** — Radial darkening effect
- **VHS Effect** — Tracking errors, color bleed, noise, customizable timestamp
- **CRT Effect** — Scanlines, curvature, RGB wave distortion, static noise

## Usage

### Run Locally

```bash
# Just open the file in your browser
open index.html

# Or use any local server
python3 -m http.server 8000
# Then visit http://localhost:8000
```

### Run on GitHub Pages

1. Fork or clone this repository
2. Go to **Settings → Pages**
3. Set Source to `main` branch and root folder
4. Your app will be live at `https://yourusername.github.io/Retroinator/`

## Presets

Save your favorite settings as presets (stored in browser localStorage or exportable as JSON).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open image |
| `Ctrl+E` | Export image |
| `Ctrl+S` | Save preset |
| `Ctrl+Shift+S` | Open preset manager |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |

## Technical Details

- Works completely offline once loaded
- All processing happens in-browser (your images stay private)
- Uses WebGL for GPU-accelerated image processing

## License

MIT