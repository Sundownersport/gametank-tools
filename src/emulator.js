const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { pickProject, projectFor, romPath, webviewHtml } = require('./project');
const { runBuild } = require('./tasks');

const panels = new Map();

function emulatorAvailable(extensionUri) {
    return fs.existsSync(path.join(extensionUri.fsPath, 'media', 'emulator', 'index.wasm'));
}

class EmulatorPanel {
    constructor(context, rom) {
        this.rom = rom;
        this.panel = vscode.window.createWebviewPanel('gametank.emulator', path.basename(rom), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        });
        this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
        const emu = vscode.Uri.joinPath(context.extensionUri, 'media', 'emulator');
        this.panel.webview.html = webviewHtml(this.panel.webview, context.extensionUri, {
            title: 'GameTank Emulator',
            styles: ['emulator.css'],
            scripts: ['emulator.js', { uri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(emu, 'index.js')) }],
            extraScriptSrc: "'wasm-unsafe-eval'",
            connect: true,
            body: `<div id="bar">
  <button id="reset" title="Reload the ROM and reset">Reset</button>
  <button id="pause">Pause</button>
  <button id="shot" title="Save a screenshot">Screenshot</button>
  <span id="status">Loading emulator…</span>
</div>
<div id="wrap"><canvas id="canvas" tabindex="0" width="512" height="512"></canvas></div>
<div id="keys">Arrows: d-pad · Z/X/C: A/B/C · Enter: Start · Gamepads work too. Click the screen first.</div>
<div id="emu" data-base="${this.panel.webview.asWebviewUri(emu)}"></div>`,
        });

        this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(rom), path.basename(rom)));
        const reload = () => this.scheduleSend();
        this.watcher.onDidChange(reload);
        this.watcher.onDidCreate(reload);

        this.panel.onDidChangeViewState(e => this.post({ type: e.webviewPanel.visible ? 'resume' : 'pause' }));
        this.panel.onDidDispose(() => {
            this.watcher.dispose();
            clearTimeout(this.timer);
            panels.delete(this.rom);
        });
        this.panel.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'ready') this.send();
            else if (msg.type === 'reset') this.send();
            else if (msg.type === 'screenshot') this.saveScreenshot(msg.data);
        });
    }

    post(msg) {
        this.panel.webview.postMessage(msg);
    }

    scheduleSend() {
        clearTimeout(this.timer);
        let lastSize = -1;
        const check = () => {
            let size = -1;
            try { size = fs.statSync(this.rom).size; } catch (e) {}
            if (size > 0 && size === lastSize) return this.send();
            lastSize = size;
            this.timer = setTimeout(check, 250);
        };
        this.timer = setTimeout(check, 250);
    }

    send() {
        if (!fs.existsSync(this.rom)) {
            this.post({ type: 'status', text: `${path.basename(this.rom)} not built yet. Waiting for it…` });
            return;
        }
        const bytes = fs.readFileSync(this.rom);
        this.post({ type: 'rom', name: path.basename(this.rom), bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) });
    }

    async saveScreenshot(dataUrl) {
        const project = projectFor(this.rom) || path.dirname(this.rom);
        const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(project, `${path.parse(this.rom).name}-${Date.now()}.png`)),
            filters: { PNG: ['png'] },
        });
        if (!target) return;
        await vscode.workspace.fs.writeFile(target, Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
}

function show(context, rom) {
    if (!emulatorAvailable(context.extensionUri)) {
        vscode.window.showErrorMessage('GameTank Tools: the emulator files are missing from media/emulator. Install a release build or run scripts/fetch-emulator.sh.');
        return undefined;
    }
    let p = panels.get(rom);
    if (p) {
        p.panel.reveal(undefined, true);
        p.send();
    } else {
        p = new EmulatorPanel(context, rom);
        panels.set(rom, p);
    }
    return p;
}

async function runRom(context, uri) {
    let rom = uri && uri.fsPath;
    if (!rom) {
        const project = await pickProject();
        if (project) rom = romPath(project);
    }
    if (!rom) {
        const picked = await vscode.window.showOpenDialog({ filters: { 'GameTank ROM': ['gtr'] } });
        if (!picked) return;
        rom = picked[0].fsPath;
    }
    show(context, rom);
}

async function buildAndRun(context) {
    const project = await pickProject();
    if (!project) {
        vscode.window.showErrorMessage('GameTank Tools: no GameTank project (project.json and makefile) found.');
        return;
    }
    await vscode.workspace.saveAll(false);
    const p = show(context, romPath(project));
    const code = await runBuild(project);
    if (code !== 0) {
        if (p) p.post({ type: 'status', text: 'Build failed. See the terminal and Problems panel.' });
        return;
    }
    if (p) p.scheduleSend();
}

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('gametank.runRom', uri => runRom(context, uri)),
        vscode.commands.registerCommand('gametank.buildAndRun', () => buildAndRun(context)),
    );
}

module.exports = { register };
