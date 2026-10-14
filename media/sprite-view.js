const vscode = acquireVsCodeApi();
const state = vscode.getState() || { zoom: 4, grid: '0', compare: false };
const zoomEl = document.getElementById('zoom');
const gridEl = document.getElementById('grid');
const compareEl = document.getElementById('compare');
const info = document.getElementById('info');
const warnings = document.getElementById('warnings');
const gtCanvas = document.getElementById('gt');
const ownCanvas = document.getElementById('own');
let bmp = null;

zoomEl.value = state.zoom;
gridEl.value = state.grid;
compareEl.checked = state.compare;

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function i32(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24); }

function decode(b) {
    if (b[0] !== 0x42 || b[1] !== 0x4D) return { error: 'Not a BMP file.' };
    const off = i32(b, 10), hdr = i32(b, 14), w = i32(b, 18);
    let h = i32(b, 22);
    const bpp = u16(b, 28), compression = i32(b, 30);
    if (bpp !== 8) return { error: `This is a ${bpp}-bit BMP. GameTank sprites must be 8-bit indexed, using the GameTank palette.` };
    if (compression !== 0) return { error: 'Compressed BMPs are not supported. Save it uncompressed.' };
    const topDown = h < 0;
    h = Math.abs(h);
    const colors = i32(b, 46) || 256;
    const pal = [];
    for (let i = 0; i < colors; ++i) {
        const p = 14 + hdr + i * 4;
        pal.push([b[p + 2], b[p + 1], b[p]]);
    }
    const stride = (w + 3) & ~3;
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; ++y) {
        const src = off + (topDown ? y : h - 1 - y) * stride;
        px.set(b.subarray(src, src + w), y * w);
    }
    return { w, h, px, pal };
}

function paint(canvas, colorOf) {
    const z = +zoomEl.value, g = +gridEl.value;
    canvas.width = bmp.w;
    canvas.height = bmp.h;
    canvas.style.width = bmp.w * z + 'px';
    canvas.style.height = bmp.h * z + 'px';
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(bmp.w, bmp.h);
    for (let i = 0; i < bmp.px.length; ++i) {
        const [r, gg, b] = colorOf(bmp.px[i]);
        id.data.set([r, gg, b, 255], i * 4);
    }
    ctx.putImageData(id, 0, 0);
    canvas.parentElement.style.setProperty('--grid', g ? `${g * z}px` : '0');
    canvas.parentElement.classList.toggle('grid', !!g);
}

function draw() {
    if (!bmp) return;
    paint(gtCanvas, c => [GT_PALETTE[c * 3], GT_PALETTE[c * 3 + 1], GT_PALETTE[c * 3 + 2]]);
    document.getElementById('own-fig').style.display = compareEl.checked ? '' : 'none';
    if (compareEl.checked) paint(ownCanvas, c => bmp.pal[c] || [0, 0, 0]);
    vscode.setState({ zoom: zoomEl.value, grid: gridEl.value, compare: compareEl.checked });
}

function checkPalette() {
    let off = 0;
    for (let i = 0; i < 256 && i < bmp.pal.length; ++i) {
        const p = bmp.pal[i];
        const d = Math.abs(p[0] - GT_PALETTE[i * 3]) + Math.abs(p[1] - GT_PALETTE[i * 3 + 1]) + Math.abs(p[2] - GT_PALETTE[i * 3 + 2]);
        if (d > 24) off++;
    }
    return off;
}

function hover(e, canvas) {
    if (!bmp) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * bmp.w);
    const y = Math.floor((e.clientY - rect.top) / rect.height * bmp.h);
    if (x < 0 || y < 0 || x >= bmp.w || y >= bmp.h) return;
    const c = bmp.px[y * bmp.w + x];
    info.textContent = `${bmp.name} · ${bmp.w}×${bmp.h} · x ${x}, y ${y} · colour ${c} (hue ${c >> 5}, sat ${(c >> 3) & 3}, lum ${c & 7})${c === 0 ? ' · transparent' : ''}`;
}

gtCanvas.addEventListener('mousemove', e => hover(e, gtCanvas));
ownCanvas.addEventListener('mousemove', e => hover(e, ownCanvas));
zoomEl.oninput = draw;
gridEl.onchange = draw;
compareEl.onchange = draw;

window.addEventListener('message', e => {
    if (e.data.type !== 'bmp') return;
    const d = decode(Uint8Array.from(e.data.bytes));
    warnings.innerHTML = '';
    if (d.error) {
        bmp = null;
        warnings.innerHTML = '<div class="error"></div>';
        warnings.firstChild.textContent = d.error;
        return;
    }
    bmp = { ...d, name: e.data.name };
    info.textContent = `${bmp.name} · ${bmp.w}×${bmp.h} · colour 0 is transparent in sprites`;
    const off = checkPalette();
    if (off > 0) {
        warnings.innerHTML = '<div class="error"></div>';
        warnings.firstChild.textContent = `${off} palette entries in this file differ from the GameTank palette, so your art program shows different colours than the GameTank will. Tick "Show file's own colours" to compare.`;
    }
    draw();
});

vscode.postMessage({ type: 'ready' });
