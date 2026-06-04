# Adding Fonts

Place the font file (`.ttf`, `.otf`, `.woff`, `.woff2`) in this folder, then update three files:

---

## 1. `css/styles.css`

Add a `@font-face` block after the existing ones:

```css
@font-face {
    font-family: 'YourFontName';
    src: url('/fonts/your-font-file.ttf') format('truetype');
    font-display: swap;
}
```

Use `format('opentype')` for `.otf`, `format('woff')` for `.woff`, `format('woff2')` for `.woff2`.

---

## 2. `src/main.js`

Add a preload call near the bottom of the file alongside the existing ones:

```js
document.fonts.load('1px YourFontName');
```

---

## 3. `src/effects/text.js` and `src/effects/matrixRain.js`

In each file, find the `options` array for the `textFont` / `matrixRainFont` param and add an entry:

```js
['YourFontName', 'Display Label'],
```

The first value is the CSS `font-family` name (must match `@font-face`). The second is what appears in the UI dropdown.

---

The font name used across all four places must be identical.
