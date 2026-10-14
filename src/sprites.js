const vscode = require('vscode');
const { webviewHtml } = require('./project');

class SpriteViewer {
    constructor(context) {
        this.context = context;
    }

    openCustomDocument(uri) {
        return { uri, dispose() {} };
    }

    async resolveCustomEditor(document, panel) {
        const webview = panel.webview;
        webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
        webview.html = webviewHtml(webview, this.context.extensionUri, {
            title: 'GameTank Sprite',
            styles: ['sprite.css'],
            scripts: ['palette.js', 'sprite-view.js'],
            body: `<div id="bar">
  <label>Zoom <input id="zoom" type="range" min="1" max="16" value="4"></label>
  <label>Grid <select id="grid"><option value="0">off</option><option value="8">8</option><option value="16">16</option><option value="32">32</option></select></label>
  <label><input id="compare" type="checkbox"> Show file's own colours</label>
</div>
<div id="info" class="dim"></div>
<div id="warnings"></div>
<div id="views">
  <figure><canvas id="gt" class="pixels"></canvas><figcaption>On GameTank</figcaption></figure>
  <figure id="own-fig"><canvas id="own" class="pixels"></canvas><figcaption>File palette</figcaption></figure>
</div>`,
        });
        const send = async () => {
            const bytes = await vscode.workspace.fs.readFile(document.uri);
            webview.postMessage({ type: 'bmp', bytes, name: document.uri.path.split('/').pop() });
        };
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), document.uri.path.split('/').pop()));
        watcher.onDidChange(send);
        panel.onDidDispose(() => watcher.dispose());
        webview.onDidReceiveMessage(msg => { if (msg.type === 'ready') send(); });
    }
}

function register(context) {
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('gametank.sprite', new SpriteViewer(context), { supportsMultipleEditorsPerDocument: true }),
        vscode.commands.registerCommand('gametank.viewSprite', uri => {
            const target = uri || vscode.window.activeTextEditor?.document.uri;
            if (target) vscode.commands.executeCommand('vscode.openWith', target, 'gametank.sprite');
        }),
    );
}

module.exports = { register };
