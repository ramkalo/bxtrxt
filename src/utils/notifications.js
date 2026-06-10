export function showNotification(message) {
    const n = document.getElementById('notification');
    n.textContent = message;
    n.classList.add('show');
    setTimeout(() => n.classList.remove('show'), 2000);
}

export function showProcessIndicator(show) {
    document.getElementById('processIndicator').classList.toggle('visible', show);
}

// Persistent toast with a Reload button, shown when a new app version is ready.
// Unlike showNotification it does not auto-dismiss — the user chooses when to
// reload (which activates the waiting service worker).
export function showUpdatePrompt(onReload) {
    const el = document.getElementById('update-prompt');
    if (!el) return;
    el.querySelector('#update-reload-btn').onclick = onReload;
    el.classList.add('show');
}
