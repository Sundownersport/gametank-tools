const vscode = acquireVsCodeApi();
const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const pauseBtn = document.getElementById('pause');
const base = document.getElementById('emu').dataset.base;

let ready = false;
let pending = null;
let hidden = false;
let userPaused = false;

function status(text) {
    statusEl.textContent = text;
}

canvas.getContext('webgl', { preserveDrawingBuffer: true });
canvas.addEventListener('mousedown', () => canvas.focus());
canvas.addEventListener('contextmenu', e => e.preventDefault());

function loadRom(name, bytes) {
    if (!ready) { pending = { name, bytes }; return; }
    const file = '/' + name;
    FS.writeFile(file, bytes);
    const result = Module.ccall('LoadRomFile', 'number', ['string'], [file]);
    if (result !== 0) { status(`Could not load ${name}`); return; }
    applyPause();
    status(`${name} loaded ${new Date().toLocaleTimeString()}`);
}

function applyPause() {
    pauseBtn.textContent = userPaused ? 'Resume' : 'Pause';
    if (ready) Module.ccall(hidden || userPaused ? 'PauseEmulation' : 'ResumeEmulation', null, [], []);
}

var Module = {
    canvas,
    locateFile: f => base + '/' + f,
    preRun: [() => {
        FS.mkdir('/idbfs');
        try {
            FS.mount(IDBFS, {}, '/idbfs');
            addRunDependency('syncfs');
            FS.syncfs(true, () => removeRunDependency('syncfs'));
        } catch (e) {
            console.error(e);
        }
    }],
    postRun: [() => {
        ready = true;
        status('Emulator ready');
        if (pending) loadRom(pending.name, pending.bytes);
        pending = null;
        vscode.postMessage({ type: 'ready' });
    }],
    print: t => console.log(t),
    printErr: t => console.error(t),
    setStatus: t => { if (t) status(t); },
};

document.getElementById('reset').onclick = () => { vscode.postMessage({ type: 'reset' }); canvas.focus(); };
pauseBtn.onclick = () => { userPaused = !userPaused; applyPause(); canvas.focus(); };
document.getElementById('shot').onclick = () => {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0);
    vscode.postMessage({ type: 'screenshot', data: out.toDataURL('image/png') });
};

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'rom') loadRom(msg.name, msg.bytes);
    else if (msg.type === 'status') status(msg.text);
    else if (msg.type === 'pause') { hidden = true; applyPause(); }
    else if (msg.type === 'resume') { hidden = false; applyPause(); }
});

window.addEventListener('error', e => status('Error: ' + e.message));
