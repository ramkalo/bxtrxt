import { canvas, originalImage } from '../renderer/glstate.js';
import { renderForExport } from '../renderer/webgl.js';
import { getStack } from '../state/effectStack.js';

export function exportImage(format, filename) {
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const ext = format === 'jpg' ? 'jpg' : 'png';

    if (!originalImage) return;

    // Render at full image resolution (no DPR scaling) before capturing
    renderForExport(getStack());

    canvas.toBlob(async function(blob) {
        const objectURL = URL.createObjectURL(blob);
        const previewModal = document.getElementById('exportPreviewModal');
        const previewImg = document.getElementById('exportPreviewImg');
        const hint = document.getElementById('exportHint');

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        if (isIOS) {
            previewImg.src = objectURL;
            previewModal.dataset.objectUrl = objectURL;
            previewModal.classList.remove('hidden');
            hint.classList.remove('hidden');
        } else if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{ description: 'Image', accept: { [mimeType]: [`.${ext}`] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                previewImg.src = objectURL;
                previewModal.dataset.objectUrl = objectURL;
                previewModal.classList.remove('hidden');
                hint.classList.add('hidden');
            } catch (err) {
                URL.revokeObjectURL(objectURL);
                if (err.name !== 'AbortError') throw err;
            }
        } else {
            hint.classList.add('hidden');
            previewImg.src = objectURL;
            previewModal.dataset.objectUrl = objectURL;
            previewModal.classList.remove('hidden');
            const link = document.createElement('a');
            link.download = filename;
            link.href = objectURL;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }, mimeType);
}
