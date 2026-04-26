const logoModules = import.meta.glob('../assets/Logo/*.jpg', { eager: true, query: '?url', import: 'default' });
const logos = Object.values(logoModules);

function pickRandom(exclude) {
    if (logos.length <= 1) return logos[0];
    let pick;
    do { pick = logos[Math.floor(Math.random() * logos.length)]; } while (pick === exclude);
    return pick;
}

export function initLogo() {
    const el = document.getElementById('logo');
    if (!el || logos.length === 0) return;
    el.src = pickRandom();
    el.addEventListener('click', () => { el.src = pickRandom(el.src); });
}
