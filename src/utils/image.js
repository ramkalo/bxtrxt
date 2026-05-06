import {
    setOriginalImage, originalImage,
    setSecondImage, secondImage,
    setSecondTexture,
} from '../renderer/glstate.js';
import { uploadToTexture } from '../renderer/webgl.js';
import { processImage } from '../renderer/pipeline.js';
import { showNotification } from './notifications.js';

export function loadImage(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            setOriginalImage(img);

            document.getElementById('imageInfo').textContent = `${img.width} \u00d7 ${img.height}px`;
            document.getElementById('dropZone').classList.add('hidden');
            document.getElementById('exportBtn').disabled = false;
            document.getElementById('savePresetBtn').disabled = false;
            document.getElementById('exportBtnMobile').disabled = false;
            document.getElementById('savePresetBtnMobile').disabled = false;

            rescaleSecondImage();
            processImage();
            showNotification('Image loaded');
        };
        img.onerror = function() {
            showNotification('Failed to load image');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

export function loadSecondImage(file) {
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            setSecondImage(img);
            rescaleSecondImage();
            const nameEl = document.getElementById('secondImageName');
            if (nameEl) nameEl.textContent = file.name;
            processImage();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

export function loadBlankCanvas(width, height, color) {
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);

    setOriginalImage(offscreen);

    document.getElementById('imageInfo').textContent = `${width} × ${height}px`;
    document.getElementById('dropZone').classList.add('hidden');
    document.getElementById('exportBtn').disabled = false;
    document.getElementById('savePresetBtn').disabled = false;
    document.getElementById('exportBtnMobile').disabled = false;
    document.getElementById('savePresetBtnMobile').disabled = false;

    processImage();
    showNotification(`Blank ${color === '#ffffff' ? 'white' : 'black'} canvas loaded`);
}

export function rescaleSecondImage() {
    if (!secondImage || !originalImage) return;
    // Upload second image as a texture; the shader samples with the same UV coordinates,
    // so it is automatically scaled to match the primary image dimensions.
    if (setSecondTexture) {
        const prev = null; // old texture cleanup handled by setSecondTexture caller if needed
        const tex = uploadToTexture(secondImage);
        setSecondTexture(tex);
    }
}
