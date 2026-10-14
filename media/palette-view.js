const vscode = acquireVsCodeApi();
const HUES = ['Yellow', 'Orange', 'Red', 'Magenta', 'Violet', 'Blue', 'Cyan', 'Green'];
const grid = document.getElementById('grid');
const info = document.getElementById('info');
const format = document.getElementById('format');

function hex(i) {
    return '#' + [0, 1, 2].map(k => GT_PALETTE[i * 3 + k].toString(16).padStart(2, '0')).join('');
}

function render(i) {
    const h = i >> 5, s = (i >> 3) & 3, l = i & 7;
    const f = format.value;
    if (f === 'hex') return '0x' + i.toString(16).toUpperCase().padStart(2, '0');
    if (f === 'decimal') return String(i);
    return `${f}(${h}, ${s}, ${l})`;
}

for (let h = 0; h < 8; ++h) {
    const label = document.createElement('div');
    label.className = 'hue';
    label.textContent = `${h} ${HUES[h]}`;
    grid.appendChild(label);
    for (let s = 0; s < 4; ++s) {
        const row = document.createElement('div');
        row.className = 'row';
        for (let l = 0; l < 8; ++l) {
            const i = (h << 5) | (s << 3) | l;
            const b = document.createElement('button');
            b.className = 'swatch';
            b.style.background = hex(i);
            b.onmouseenter = () => {
                info.textContent = `${i} · 0x${i.toString(16).toUpperCase().padStart(2, '0')} · hue ${h} (${HUES[h]}), sat ${s}, lum ${l} · ${hex(i)} → inserts ${render(i)}`;
            };
            b.onclick = () => vscode.postMessage({ type: 'insert', text: render(i) });
            row.appendChild(b);
        }
        grid.appendChild(row);
    }
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type !== 'formats') return;
    const current = format.value;
    format.innerHTML = '';
    for (const f of ['decimal', 'hex', ...msg.macros]) {
        const o = document.createElement('option');
        o.value = f;
        o.textContent = f === 'decimal' || f === 'hex' ? f : `${f}(h, s, l)`;
        format.appendChild(o);
    }
    const options = [...format.options].map(o => o.value);
    format.value = options.includes(current) ? current : (msg.macros[0] || msg.preferred);
});

vscode.postMessage({ type: 'ready' });
