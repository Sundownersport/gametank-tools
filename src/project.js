const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function isProject(dir) {
    return fs.existsSync(path.join(dir, 'project.json')) && fs.existsSync(path.join(dir, 'makefile'));
}

function findProjects() {
    const out = [];
    for (const folder of vscode.workspace.workspaceFolders || []) {
        const root = folder.uri.fsPath;
        if (isProject(root)) { out.push(root); continue; }
        let entries = [];
        try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) {}
        for (const e of entries) {
            if (e.isDirectory() && isProject(path.join(root, e.name))) out.push(path.join(root, e.name));
        }
    }
    return out;
}

function projectFor(file) {
    let dir = path.dirname(file);
    for (let i = 0; i < 8; ++i) {
        if (isProject(dir)) return dir;
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
    }
    return undefined;
}

async function pickProject() {
    const active = vscode.window.activeTextEditor;
    if (active && active.document.uri.scheme === 'file') {
        const p = projectFor(active.document.uri.fsPath);
        if (p) return p;
    }
    const all = findProjects();
    if (all.length <= 1) return all[0];
    const pick = await vscode.window.showQuickPick(all.map(p => ({ label: path.basename(p), description: p, p })), { placeHolder: 'GameTank project' });
    return pick && pick.p;
}

function romPath(project) {
    try {
        const name = JSON.parse(fs.readFileSync(path.join(project, 'project.json'), 'utf8')).romname;
        if (name) return path.join(project, 'bin', name);
    } catch (e) {}
    const bin = path.join(project, 'bin');
    const roms = fs.existsSync(bin) ? fs.readdirSync(bin).filter(f => f.endsWith('.gtr')) : [];
    return roms.length ? path.join(bin, roms[0]) : path.join(bin, 'game.gtr');
}

function fontBytes(project) {
    const p = project && path.join(project, 'assets', 'sdk_default', 'bios8.bmp');
    return p && fs.existsSync(p) ? fs.readFileSync(p) : null;
}

function nonce() {
    return [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
}

function webviewHtml(webview, extensionUri, { title, styles = [], scripts = [], body, extraScriptSrc = '', connect = false }) {
    const media = f => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', f));
    const n = nonce();
    const csp = [
        "default-src 'none'",
        `img-src ${webview.cspSource} data: blob:`,
        `style-src ${webview.cspSource}`,
        `script-src 'nonce-${n}' ${extraScriptSrc}`,
        connect ? `connect-src ${webview.cspSource}` : '',
    ].filter(Boolean).join('; ');
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${title}</title>
${['common.css', ...styles].map(s => `<link rel="stylesheet" href="${media(s)}">`).join('\n')}
</head>
<body>
${body}
${scripts.map(s => `<script nonce="${n}" src="${typeof s === 'string' ? media(s) : s.uri}"></script>`).join('\n')}
</body>
</html>`;
}

module.exports = { findProjects, projectFor, pickProject, romPath, fontBytes, webviewHtml };
