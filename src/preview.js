const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { pickProject, fontBytes, webviewHtml } = require('./project');

const DOCS = 'https://github.com/Sundownersport/gametank-tools#live-preview';
const panels = new Map();

function pluginPath(project) {
    return path.join(project, '.gametank', 'preview.js');
}

class PreviewPanel {
    constructor(context, project) {
        this.context = context;
        this.project = project;
        this.sourceUri = undefined;
        this.panel = vscode.window.createWebviewPanel('gametank.preview', `Preview: ${path.basename(project)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media'), vscode.Uri.file(path.join(project, '.gametank'))],
        });
        this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
        this.disposables = [];

        const pluginWatch = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.join(project, '.gametank'), '**/*.js'));
        const reload = () => { clearTimeout(this.reloadTimer); this.reloadTimer = setTimeout(() => this.render(), 200); };
        pluginWatch.onDidChange(reload);
        pluginWatch.onDidCreate(reload);
        this.disposables.push(pluginWatch);

        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => { if (this.isSource(e.document)) this.schedulePush(); }),
            vscode.window.onDidChangeTextEditorSelection(e => {
                if (this.isSource(e.textEditor.document)) this.panel.webview.postMessage({ type: 'cursor', line: e.selections[0].active.line });
            }),
        );

        this.panel.onDidDispose(() => {
            this.disposables.forEach(d => d.dispose());
            clearTimeout(this.pushTimer);
            clearTimeout(this.reloadTimer);
            panels.delete(project);
        });
        this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
        this.render();
    }

    render() {
        const webview = this.panel.webview;
        const plugin = vscode.Uri.file(pluginPath(this.project));
        const stamp = fs.existsSync(plugin.fsPath) ? fs.statSync(plugin.fsPath).mtimeMs : 0;
        webview.html = webviewHtml(webview, this.context.extensionUri, {
            title: 'GameTank Preview',
            styles: ['preview.css'],
            scripts: ['palette.js', 'preview-host.js', { uri: `${webview.asWebviewUri(plugin)}?v=${stamp}` }],
            body: `<div id="top">
  <div id="modes">
    <button id="mode-play" class="on">Play</button>
    <button id="mode-edit">Edit</button>
  </div>
  <span id="file"></span>
</div>
<div id="screen-wrap"><canvas id="screen" class="pixels" tabindex="0"></canvas></div>
<div id="hint" class="dim"></div>
<div id="tools"></div>
<div id="problems"></div>
<div id="thumbs"></div>`,
        });
    }

    isSource(doc) {
        return this.sourceUri && doc.uri.toString() === this.sourceUri.toString();
    }

    schedulePush() {
        clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(() => this.pushSource(), 100);
    }

    async pushSource() {
        if (!this.sourceUri) return;
        let doc;
        try {
            doc = await vscode.workspace.openTextDocument(this.sourceUri);
        } catch (e) {
            vscode.window.showErrorMessage(`GameTank preview: cannot open ${this.sourceUri.fsPath}`);
            return;
        }
        this.panel.webview.postMessage({ type: 'source', text: doc.getText(), file: path.relative(this.project, this.sourceUri.fsPath) });
    }

    async onMessage(msg) {
        if (msg.type === 'ready') {
            this.sourceUri = vscode.Uri.file(path.resolve(this.project, msg.source));
            const font = fontBytes(this.project);
            this.panel.webview.postMessage({ type: 'font', bytes: font ? new Uint8Array(font) : null });
            this.pushSource();
        } else if (msg.type === 'edit' && this.sourceUri) {
            const we = new vscode.WorkspaceEdit();
            for (const e of msg.edits) {
                const start = new vscode.Position(e.line, e.col);
                if ('insert' in e) we.insert(this.sourceUri, start, e.insert);
                else we.replace(this.sourceUri, new vscode.Range(start, start.translate(0, 1)), e.ch);
            }
            await vscode.workspace.applyEdit(we);
        } else if (msg.type === 'reveal' && this.sourceUri) {
            const doc = await vscode.workspace.openTextDocument(this.sourceUri);
            const column = vscode.window.visibleTextEditors.find(e => this.isSource(e.document))?.viewColumn || vscode.ViewColumn.One;
            const editor = await vscode.window.showTextDocument(doc, { viewColumn: column, preserveFocus: true });
            const pos = new vscode.Position(msg.line, 0);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
        }
    }
}

async function open(context) {
    const project = await pickProject();
    if (!project) {
        vscode.window.showErrorMessage('GameTank Tools: no GameTank project (project.json and makefile) found.');
        return;
    }
    if (!fs.existsSync(pluginPath(project))) {
        const choice = await vscode.window.showInformationMessage(
            `${path.basename(project)} has no live preview yet. A game adds one with .gametank/preview.js.`,
            'How to write one');
        if (choice) vscode.env.openExternal(vscode.Uri.parse(DOCS));
        return;
    }
    const existing = panels.get(project);
    if (existing) {
        existing.panel.reveal(undefined, true);
        return;
    }
    panels.set(project, new PreviewPanel(context, project));
}

function register(context) {
    context.subscriptions.push(vscode.commands.registerCommand('gametank.openPreview', () => open(context)));
}

module.exports = { register };
