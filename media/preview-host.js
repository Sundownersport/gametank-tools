(() => {
const vscode = acquireVsCodeApi();

const W = 128;
const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    z: 'a', Z: 'a', x: 'b', X: 'b', c: 'c', C: 'c', Enter: 'start',
};
const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'c', 'start'];
const PAD_BUTTONS = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'a', 1: 'b', 2: 'c', 3: 'c', 9: 'start' };

// ---- C source helpers ----

const BINARY = [
    ['|'], ['^'], ['&'], ['==', '!='], ['<=', '>=', '<', '>'], ['<<', '>>'], ['+', '-'], ['*', '/', '%'],
];

function evalC(expr) {
    const toks = expr.match(/0[xX][0-9a-fA-F]+|\d+|<<|>>|<=|>=|==|!=|[()+\-*\/%<>&|^~!]|\S/g) || [];
    let i = 0;
    const fail = () => { throw new Error('bad expression'); };
    const unary = () => {
        let t = toks[i++];
        if (t === undefined) fail();
        if (t === '(') {
            if (/^(unsigned|signed|char|int|short|long|uint8_t|int8_t|uint16_t|int16_t)$/.test(toks[i] || '')) {
                while (toks[i] && toks[i] !== ')') i++;
                i++;
                return unary();
            }
            const v = binary(0);
            if (toks[i++] !== ')') fail();
            return v;
        }
        if (t === '-') return -unary();
        if (t === '+') return unary();
        if (t === '~') return ~unary();
        if (t === '!') return unary() ? 0 : 1;
        t = t.replace(/[uUlL]+$/, '');
        if (/^(0[xX][0-9a-fA-F]+|\d+)$/.test(t)) return Number(t);
        fail();
    };
    const apply = (op, a, b) => {
        switch (op) {
        case '|': return a | b;
        case '^': return a ^ b;
        case '&': return a & b;
        case '==': return +(a === b);
        case '!=': return +(a !== b);
        case '<=': return +(a <= b);
        case '>=': return +(a >= b);
        case '<': return +(a < b);
        case '>': return +(a > b);
        case '<<': return a << b;
        case '>>': return a >> b;
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b ? Math.trunc(a / b) : fail();
        case '%': return b ? a % b : fail();
        }
    };
    const binary = level => {
        if (level === BINARY.length) return unary();
        let v = binary(level + 1);
        while (BINARY[level].includes(toks[i])) v = apply(toks[i++], v, binary(level + 1));
        return v;
    };
    try {
        const v = binary(0);
        return i === toks.length ? v | 0 : undefined;
    } catch (e) {
        return undefined;
    }
}

function splitArgs(s) {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of s) {
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        cur += ch;
    }
    out.push(cur);
    return out.map(a => a.trim());
}

function parseDefines(lines) {
    const raw = {}, fns = {};
    for (const line of lines) {
        const m = line.match(/^\s*#\s*define\s+(\w+)(\(([^)]*)\))?\s+(.*?)\s*(\/\/.*|\/\*.*)?$/);
        if (!m) continue;
        if (m[2]) fns[m[1]] = { params: m[3].split(',').map(p => p.trim()), body: m[4] };
        else raw[m[1]] = m[4];
    }
    const names = Object.keys(fns);
    const callRe = names.length ? new RegExp('\\b(' + names.join('|') + ')\\s*\\(') : null;
    const values = { SCREEN_WIDTH: 128, SCREEN_HEIGHT: 128 };
    const expand = (expr, seen) => {
        for (let guard = 0; callRe && guard < 100; ++guard) {
            const call = expr.match(callRe);
            if (!call) break;
            const start = call.index + call[0].length;
            let depth = 1, i = start;
            while (i < expr.length && depth) { if (expr[i] === '(') depth++; if (expr[i] === ')') depth--; i++; }
            const args = splitArgs(expr.slice(start, i - 1));
            let body = fns[call[1]].body;
            fns[call[1]].params.forEach((p, n) => { body = body.replace(new RegExp('\\b' + p + '\\b', 'g'), '(' + args[n] + ')'); });
            expr = expr.slice(0, call.index) + '(' + body + ')' + expr.slice(i);
        }
        return expr.replace(/\b[A-Za-z_]\w*\b/g, name => {
            const v = evaluate(name, seen);
            return v === undefined ? name : '(' + v + ')';
        });
    };
    const evaluate = (name, seen = new Set()) => {
        if (name in values) return values[name];
        if (!(name in raw) || seen.has(name)) return undefined;
        seen.add(name);
        const v = evalC(expand(raw[name], seen));
        seen.delete(name);
        if (v !== undefined) values[name] = v;
        return v;
    };
    Object.keys(raw).forEach(n => evaluate(n));
    return values;
}

function parseTable(lines, name) {
    const out = [];
    let i = lines.findIndex(l => new RegExp('\\b' + name + '\\s*\\[').test(l));
    if (i < 0) return null;
    let depth = 0, cur = null, flat = null;
    for (; i < lines.length; ++i) {
        const line = lines[i];
        for (let c = 0; c < line.length; ++c) {
            const ch = line[c];
            if (ch === '"') {
                const end = line.indexOf('"', c + 1);
                if (end < 0) break;
                const row = { line: i, col: c + 1, text: line.slice(c + 1, end) };
                if (depth >= 2 && cur) { cur.rows.push(row); cur.last = i; }
                else if (depth === 1) {
                    if (!flat) { flat = { rows: [], first: i, last: i }; out.push(flat); }
                    flat.rows.push(row);
                    flat.last = i;
                }
                c = end;
            } else if (ch === '{') {
                depth++;
                if (depth === 2) { cur = { rows: [], first: i, last: i }; out.push(cur); }
            } else if (ch === '}') {
                if (depth === 2 && cur) cur.last = i;
                depth--;
                if (depth === 0) return out;
            } else if (ch === '/' && line[c + 1] === '/') {
                break;
            } else if (ch === ';' && depth === 0) {
                return out;
            }
        }
    }
    return out;
}

// ---- screen ----

let fontPixels = null;

function rgb(c) {
    return [GT_PALETTE[c * 3], GT_PALETTE[c * 3 + 1], GT_PALETTE[c * 3 + 2]];
}

function decodeBmp8(bytes) {
    const b = Uint8Array.from(bytes);
    const off = b[10] | (b[11] << 8) | (b[12] << 16);
    const w = b[18] | (b[19] << 8);
    let h = b[22] | (b[23] << 8) | (b[24] << 16) | (b[25] << 24);
    if (b[28] !== 8) return null;
    const topDown = h < 0;
    h = Math.abs(h);
    const stride = (w + 3) & ~3;
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; ++y) {
        const src = off + (topDown ? y : h - 1 - y) * stride;
        px.set(b.subarray(src, src + w), y * w);
    }
    return { w, h, px };
}

function makeGt(shared) {
    const screen = new Uint8Array(W * W);
    const gt = {
        W, H: W, screen,
        get defines() { return shared.defines; },
        get source() { return shared.source; },
        get input() { return shared.input; },
        get frame() { return shared.frame; },
        clear(c) { screen.fill(c & 255); },
        pixel(x, y, c) {
            if (x >= 0 && y >= 0 && x < W && y < W) screen[y * W + x] = c;
        },
        box(x, y, w, h, c) {
            const x0 = Math.max(0, x), y0 = Math.max(0, y);
            const x1 = Math.min(W, x + w), y1 = Math.min(W, y + h);
            for (let j = y0; j < y1; ++j) screen.fill(c & 255, j * W + x0, j * W + x1);
        },
        blit(pixels, pw, x, y, sx = 0, sy = 0, w = pw, h = Math.floor(pixels.length / pw), transparent = true) {
            for (let j = 0; j < h; ++j) {
                const dy = y + j;
                if (dy < 0 || dy >= W) continue;
                for (let i = 0; i < w; ++i) {
                    const dx = x + i;
                    if (dx < 0 || dx >= W) continue;
                    const c = pixels[(sy + j) * pw + sx + i];
                    if (c || !transparent) screen[dy * W + dx] = c;
                }
            }
        },
        text(x, y, str, color = 'white') {
            const add = color === 'black' ? 0 : 128;
            for (const chr of String(str)) {
                if (chr !== ' ' && fontPixels) {
                    const ch = (chr.charCodeAt(0) + add) & 255;
                    gt.blit(fontPixels, W, x, y, (ch & 0x0F) << 3, (ch & 0xF0) >> 1, 8, 8);
                }
                x += 8;
            }
        },
        color(h, s, l) { return ((h & 7) << 5) | ((s & 3) << 3) | (l & 7); },
        table(name) {
            const t = parseTable(shared.source.lines, name);
            if (!t) gt.problem(`No array named ${name} in ${shared.source.file}`);
            return t || [];
        },
        problem(msg) { shared.problems.push(String(msg)); },
    };
    return gt;
}

// ---- host state ----

const shared = {
    defines: {},
    source: { text: '', lines: [], file: '' },
    input: { held: {}, pressed: {} },
    frame: 0,
    problems: [],
};
const gt = makeGt(shared);
let game = null;
let mode = 'play';
let level = 0;
let levels = [];
let started = false;
let crashed = null;
let brush = null;
let hover = null;
let painting = null;
let keysDown = {};
let prevHeld = {};

const screenEl = document.getElementById('screen');
const ctx = screenEl.getContext('2d');
const small = document.createElement('canvas');
small.width = small.height = W;
const sctx = small.getContext('2d');
const img = sctx.createImageData(W, W);
screenEl.width = screenEl.height = W * 4;

window.GameTank = {
    defineGame(def) {
        game = def;
        vscode.postMessage({ type: 'ready', source: def.source || 'src/main.c' });
    },
    palette: GT_PALETTE,
};

function guard(what, fn) {
    if (crashed) return undefined;
    try {
        return fn();
    } catch (e) {
        crashed = `${what}: ${e.message}`;
        const where = (e.stack || '').split('\n').find(l => l.includes('/.gametank/'));
        if (where) crashed += ` (${where.trim().replace(/^at /, '').replace(/.*\/\.gametank\//, '.gametank/').replace(/\?[^:]*/, '')})`;
        showProblems();
        return undefined;
    }
}

function showProblems() {
    const el = document.getElementById('problems');
    el.innerHTML = '';
    const list = crashed ? [crashed, ...shared.problems] : shared.problems;
    for (const p of list) {
        const d = document.createElement('div');
        d.className = 'error';
        d.textContent = p;
        el.appendChild(d);
    }
}

function rowsOf(n) {
    return levels[n] ? JSON.stringify(levels[n].rows.map(r => r.text)) : '';
}

function loadSource(text, file) {
    const lines = text.split(/\r?\n/);
    const before = rowsOf(level);
    shared.source = { text, lines, file };
    shared.defines = parseDefines(lines);
    shared.problems = [];
    crashed = null;
    const missing = (game.requires || []).filter(n => shared.defines[n] === undefined);
    if (missing.length) {
        gt.problem('Could not read: ' + missing.join(', '));
        showProblems();
        return;
    }
    const restart = guard('load', () => game.load(gt));
    levels = (game.levels && guard('levels', () => game.levels(gt))) || [];
    if (level >= levels.length) level = Math.max(0, levels.length - 1);
    if (!started || restart === true || rowsOf(level) !== before) {
        started = true;
        guard('start', () => game.start && game.start(gt, level));
    }
    showProblems();
    buildTools();
    buildThumbs();
}

function setLevel(n) {
    level = n;
    guard('start', () => game.start && game.start(gt, level));
    document.querySelectorAll('#thumbs figure').forEach((f, i) => f.classList.toggle('on', i === level));
}

// ---- input ----

function readInput() {
    const held = { ...keysDown };
    for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
        if (!pad) continue;
        pad.buttons.forEach((b, i) => { if (b.pressed && PAD_BUTTONS[i]) held[PAD_BUTTONS[i]] = true; });
        if (pad.axes[0] < -0.5) held.left = true;
        if (pad.axes[0] > 0.5) held.right = true;
        if (pad.axes[1] < -0.5) held.up = true;
        if (pad.axes[1] > 0.5) held.down = true;
    }
    const pressed = {};
    for (const b of BUTTONS) pressed[b] = !!held[b] && !prevHeld[b];
    prevHeld = held;
    shared.input = { held, pressed };
}

screenEl.addEventListener('keydown', e => {
    if (KEYMAP[e.key]) { keysDown[KEYMAP[e.key]] = true; e.preventDefault(); return; }
    if (mode === 'edit' && editor() && /^[1-9]$/.test(e.key)) {
        const t = editor().tiles[+e.key - 1];
        if (t) setBrush(t.ch);
    }
});
screenEl.addEventListener('keyup', e => { if (KEYMAP[e.key]) { keysDown[KEYMAP[e.key]] = false; e.preventDefault(); } });
screenEl.addEventListener('blur', () => { keysDown = {}; });

// ---- editing ----

function editor() {
    return game && game.editor;
}

function val(v) {
    return typeof v === 'function' ? v(gt) : v;
}

function grid() {
    const ed = editor();
    const lv = levels[level];
    if (!ed || !lv) return null;
    return {
        x: val(ed.x) || 0, y: val(ed.y) || 0, w: val(ed.cellW) || 8, h: val(ed.cellH) || 8,
        cols: Math.max(0, ...lv.rows.map(r => r.text.length)), rows: lv.rows.length,
    };
}

function cellFromEvent(e) {
    const g = grid();
    if (!g) return null;
    const rect = screenEl.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * W;
    const py = (e.clientY - rect.top) / rect.height * W;
    const c = Math.floor((px - g.x) / g.w), r = Math.floor((py - g.y) / g.h);
    if (r < 0 || r >= g.rows || c < 0 || c >= g.cols) return null;
    return { r, c };
}

function paint(cell, ch) {
    const lv = levels[level];
    const row = lv && lv.rows[cell.r];
    if (!row || cell.c >= row.text.length || row.text[cell.c] === ch) return;
    const edits = [{ line: row.line, col: row.col + cell.c, ch }];
    if ((editor().unique || []).includes(ch)) {
        lv.rows.forEach(rw => [...rw.text].forEach((t, c) => {
            if (t === ch) edits.push({ line: rw.line, col: rw.col + c, ch: editor().empty || '.' });
        }));
    }
    const lines = shared.source.lines.slice();
    for (const e of edits) lines[e.line] = lines[e.line].slice(0, e.col) + e.ch + lines[e.line].slice(e.col + 1);
    loadSource(lines.join('\n'), shared.source.file);
    vscode.postMessage({ type: 'edit', edits });
}

screenEl.addEventListener('mousedown', e => {
    screenEl.focus();
    if (mode !== 'edit' || !editor()) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    painting = e.button === 2 ? (editor().empty || '.') : brush;
    if (painting) paint(cell, painting);
});
screenEl.addEventListener('mousemove', e => {
    if (mode !== 'edit') return;
    hover = cellFromEvent(e);
    if (painting && hover && !(editor().unique || []).includes(painting)) paint(hover, painting);
});
screenEl.addEventListener('mouseleave', () => { hover = null; });
window.addEventListener('mouseup', () => { painting = null; });
screenEl.addEventListener('contextmenu', e => e.preventDefault());

function setMode(m) {
    mode = m;
    document.getElementById('mode-play').classList.toggle('on', m === 'play');
    document.getElementById('mode-edit').classList.toggle('on', m === 'edit');
    document.getElementById('tools').style.display = m === 'edit' ? 'flex' : 'none';
    document.getElementById('hint').textContent = m === 'play'
        ? 'Click the screen, then: arrows d-pad, Z/X/C A/B/C, Enter Start. Gamepads work too.'
        : 'Left click/drag paints, right click erases, keys 1–9 pick a tile. Changes are written to the source.';
    hover = null;
    if (m === 'play' && game) setLevel(level);
    screenEl.focus();
}
document.getElementById('mode-play').onclick = () => setMode('play');
document.getElementById('mode-edit').onclick = () => setMode('edit');

function setBrush(ch) {
    brush = ch;
    document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tile === ch));
}

function toCanvas(pixels, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.className = 'pixels';
    const id = cv.getContext('2d').createImageData(w, h);
    for (let i = 0; i < w * h; ++i) {
        const [r, g, b] = rgb(pixels[i]);
        id.data[i * 4] = r; id.data[i * 4 + 1] = g; id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = 255;
    }
    cv.getContext('2d').putImageData(id, 0, 0);
    return cv;
}

function buildTools() {
    const tools = document.getElementById('tools');
    tools.innerHTML = '';
    const ed = editor();
    document.getElementById('mode-edit').style.display = ed ? '' : 'none';
    if (!ed) return;
    if (!brush || !ed.tiles.some(t => t.ch === brush)) brush = (ed.tiles[1] || ed.tiles[0]).ch;
    ed.tiles.forEach((t, n) => {
        const b = document.createElement('button');
        b.dataset.tile = t.ch;
        b.title = `${t.name} '${t.ch}'` + (n < 9 ? ` (key ${n + 1})` : '');
        if (ed.drawTile) {
            const scratch = makeGt(shared);
            const g = grid() || { w: 8, h: 8 };
            guard('drawTile', () => ed.drawTile(scratch, t.ch, 0, 0));
            if (!crashed) {
                const px = new Uint8Array(g.w * g.h);
                for (let j = 0; j < g.h; ++j) px.set(scratch.screen.subarray(j * W, j * W + g.w), j * g.w);
                b.append(toCanvas(px, g.w, g.h));
            }
        }
        b.append(`${n < 9 ? n + 1 + ' ' : ''}${t.name}`);
        b.onclick = () => { setBrush(t.ch); screenEl.focus(); };
        tools.appendChild(b);
    });
    setBrush(brush);
}

function buildThumbs() {
    const wrap = document.getElementById('thumbs');
    wrap.innerHTML = '';
    if (!game.drawLevel) return;
    levels.forEach((lv, n) => {
        const scratch = makeGt(shared);
        guard('drawLevel', () => game.drawLevel(scratch, n));
        const fig = document.createElement('figure');
        fig.className = n === level ? 'on' : '';
        const cap = document.createElement('figcaption');
        cap.textContent = lv.name || `Level ${n + 1}`;
        fig.append(toCanvas(scratch.screen, W, W), cap);
        fig.onclick = () => {
            setLevel(n);
            vscode.postMessage({ type: 'reveal', line: lv.first });
            screenEl.focus();
        };
        wrap.appendChild(fig);
    });
}

// ---- main loop ----

function present() {
    const s = gt.screen;
    for (let i = 0; i < s.length; ++i) {
        const c = s[i] * 3;
        img.data[i * 4] = GT_PALETTE[c]; img.data[i * 4 + 1] = GT_PALETTE[c + 1]; img.data[i * 4 + 2] = GT_PALETTE[c + 2]; img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, screenEl.width, screenEl.height);
    const g = mode === 'edit' && grid();
    if (!g) return;
    const k = screenEl.width / W;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= g.cols; ++c) {
        ctx.beginPath(); ctx.moveTo((g.x + c * g.w) * k + 0.5, g.y * k); ctx.lineTo((g.x + c * g.w) * k + 0.5, (g.y + g.rows * g.h) * k); ctx.stroke();
    }
    for (let r = 0; r <= g.rows; ++r) {
        ctx.beginPath(); ctx.moveTo(g.x * k, (g.y + r * g.h) * k + 0.5); ctx.lineTo((g.x + g.cols * g.w) * k, (g.y + r * g.h) * k + 0.5); ctx.stroke();
    }
    if (hover) {
        ctx.strokeStyle = 'rgba(255,255,0,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect((g.x + hover.c * g.w) * k + 1, (g.y + hover.r * g.h) * k + 1, g.w * k - 2, g.h * k - 2);
    }
}

let last = performance.now(), acc = 0;
function frame(now) {
    acc = Math.min(acc + now - last, 100);
    last = now;
    if (game && started && !crashed) {
        if (mode === 'play') {
            while (acc >= 1000 / 60) {
                readInput();
                shared.frame++;
                guard('step', () => game.step && game.step(gt));
                acc -= 1000 / 60;
            }
            guard('draw', () => game.draw(gt));
        } else {
            acc = 0;
            guard('drawLevel', () => (game.drawLevel ? game.drawLevel(gt, level) : game.draw(gt)));
        }
        present();
    }
    requestAnimationFrame(frame);
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'font' && msg.bytes) {
        const f = decodeBmp8(msg.bytes);
        fontPixels = f && f.w === W ? f.px : null;
    } else if (msg.type === 'source' && game) {
        document.getElementById('file').textContent = msg.file;
        loadSource(msg.text, msg.file);
    } else if (msg.type === 'cursor' && game) {
        const n = levels.findIndex(l => msg.line >= l.first && msg.line <= l.last);
        if (n >= 0 && n !== level) setLevel(n);
    }
});

window.addEventListener('error', e => {
    crashed = `${e.message} (${(e.filename || '').replace(/.*\/\.gametank\//, '.gametank/').replace(/\?.*/, '')}:${e.lineno})`;
    showProblems();
});

setMode('play');
requestAnimationFrame(frame);
})();
