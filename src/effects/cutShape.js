// Pure shape geometry for the Cut Out tool — no imports, so both the effect
// (cut.js) and the tool actions (cutTool.js) can share it without import cycles.
// Uses the same screen convention as cutOverlay.js: cx=(0.5+X/100)*w,
// cy=(0.5−Y/100)*h, so the saved hole / extracted region land exactly where the
// user positioned the selection.

export function shapeGeometry(p, w, h) {
    const cx = (0.5 + p.cutX / 100) * w;
    const cy = (0.5 - p.cutY / 100) * h;
    const shape = p.cutShape;

    if (shape === 'rectangle') {
        const hw = (p.cutW / 200) * w, hh = (p.cutH / 200) * h;
        return { kind: 'rect', cx, cy, hw, hh, bbox: [cx - hw, cy - hh, cx + hw, cy + hh] };
    }
    if (shape === 'ellipse') {
        const rx = (p.cutW / 200) * w, ry = (p.cutH / 200) * h;
        return { kind: 'ellipse', cx, cy, rx, ry, bbox: [cx - rx, cy - ry, cx + rx, cy + ry] };
    }
    const n = shape === 'triangle' ? 3 : Math.max(3, Math.min(12, Math.round(p.cutSides)));
    const verts = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
        const vx = (0.5 + (p.cutX + (p[`cutV${i}x`] ?? 0)) / 100) * w;
        const vy = (0.5 - (p.cutY + (p[`cutV${i}y`] ?? 0)) / 100) * h;
        verts.push([vx, vy]);
        minX = Math.min(minX, vx); minY = Math.min(minY, vy);
        maxX = Math.max(maxX, vx); maxY = Math.max(maxY, vy);
    }
    return { kind: 'poly', verts, bbox: [minX, minY, maxX, maxY] };
}

export function traceShapePath(ctx, g) {
    ctx.beginPath();
    if (g.kind === 'rect') {
        ctx.rect(g.cx - g.hw, g.cy - g.hh, g.hw * 2, g.hh * 2);
    } else if (g.kind === 'ellipse') {
        ctx.ellipse(g.cx, g.cy, Math.max(0.5, g.rx), Math.max(0.5, g.ry), 0, 0, Math.PI * 2);
    } else {
        ctx.moveTo(g.verts[0][0], g.verts[0][1]);
        for (let i = 1; i < g.verts.length; i++) ctx.lineTo(g.verts[i][0], g.verts[i][1]);
        ctx.closePath();
    }
}
