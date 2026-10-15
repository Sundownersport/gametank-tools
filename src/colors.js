const vscode = require('vscode');
const PALETTE = require('../media/palette.js');
const { webviewHtml } = require('./project');

const NUM = '(0[xX][0-9a-fA-F]+|\\d+)';
const COLOR_NAME = /^(C|COL|CLR|COLOU?R)_\w|_(COL|CLR|COLOU?R)$/i;
const COLOR_CALLS = { queue_draw_box: 4, queue_clear_screen: 0, queue_clear_border: 0 };

function toColor(index) {
    return new vscode.Color(PALETTE[index * 3] / 255, PALETTE[index * 3 + 1] / 255, PALETTE[index * 3 + 2] / 255, 1);
}

function nearest(color) {
    const r = color.red * 255, g = color.green * 255, b = color.blue * 255;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < 256; ++i) {
        const d = (PALETTE[i * 3] - r) ** 2 + (PALETTE[i * 3 + 1] - g) ** 2 + (PALETTE[i * 3 + 2] - b) ** 2;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

function hsl(index) {
    return [index >> 5, (index >> 3) & 3, index & 7];
}

function formatNumber(index, like) {
    if (/^0[xX]/.test(like)) return '0x' + index.toString(16).toUpperCase().padStart(2, '0');
    return String(index);
}

function hslMacros(text) {
    const out = [];
    const re = /^[ \t]*#[ \t]*define[ \t]+(\w+)\([ \t]*(\w+)[ \t]*,[ \t]*(\w+)[ \t]*,[ \t]*(\w+)[ \t]*\)(.*)$/gm;
    let m;
    while ((m = re.exec(text))) {
        const body = m[5].replace(/\s+/g, '');
        if (body.includes(`(${m[2]})<<5`) || body.includes(`${m[2]}<<5`)) out.push(m[1]);
    }
    return out;
}

function parseNum(s) {
    return /^0[xX]/.test(s) ? parseInt(s, 16) : parseInt(s, 10);
}

function findColors(doc) {
    const text = doc.getText();
    const found = [];
    const add = (start, end, index, kind, extra) => {
        if (index < 0 || index > 255) return;
        found.push({ range: new vscode.Range(doc.positionAt(start), doc.positionAt(end)), index, kind, ...extra });
    };

    for (const name of hslMacros(text)) {
        const re = new RegExp(`\\b${name}\\s*\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)`, 'g');
        let m;
        while ((m = re.exec(text))) {
            const [h, s, l] = [m[1], m[2], m[3]].map(parseNum);
            if (h > 7 || s > 3 || l > 7) continue;
            add(m.index, m.index + m[0].length, (h << 5) | (s << 3) | l, 'macro', { name });
        }
    }

    const defRe = new RegExp(`^[ \\t]*#[ \\t]*define[ \\t]+(\\w+)[ \\t]+${NUM}[ \\t]*(?:$|//|/\\*)`, 'gm');
    let m;
    while ((m = defRe.exec(text))) {
        if (!COLOR_NAME.test(m[1])) continue;
        const start = m.index + m[0].lastIndexOf(m[2]);
        add(start, start + m[2].length, parseNum(m[2]), 'number', { raw: m[2] });
    }

    const callRe = new RegExp(`\\b(${Object.keys(COLOR_CALLS).join('|')})\\s*\\(([^;]*?)\\)\\s*;`, 'g');
    while ((m = callRe.exec(text))) {
        const argsStart = m.index + m[0].indexOf('(') + 1;
        let pos = argsStart;
        m[2].split(',').forEach((arg, i) => {
            const trimmed = arg.trim();
            if (i === COLOR_CALLS[m[1]] && new RegExp(`^${NUM}$`).test(trimmed)) {
                const start = pos + arg.indexOf(trimmed);
                add(start, start + trimmed.length, parseNum(trimmed), 'number', { raw: trimmed });
            }
            pos += arg.length + 1;
        });
    }
    return found;
}

const colorProvider = {
    provideDocumentColors(doc) {
        return findColors(doc).map(c => new vscode.ColorInformation(c.range, toColor(c.index)));
    },
    provideColorPresentations(color, { document, range }) {
        const index = nearest(color);
        const hit = findColors(document).find(c => c.range.isEqual(range));
        const [h, s, l] = hsl(index);
        let label;
        if (hit && hit.kind === 'macro') label = `${hit.name}(${h}, ${s}, ${l})`;
        else label = formatNumber(index, hit ? hit.raw : document.getText(range));
        const p = new vscode.ColorPresentation(label);
        p.textEdit = new vscode.TextEdit(range, label);
        return [p];
    },
};

let palettePanel;
let lastEditor;

function showPalette(context) {
    if (palettePanel) { palettePanel.reveal(undefined, true); return; }
    palettePanel = vscode.window.createWebviewPanel('gametank.palette', 'GameTank Palette', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    palettePanel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    palettePanel.webview.html = webviewHtml(palettePanel.webview, context.extensionUri, {
        title: 'GameTank Palette',
        styles: ['palette.css'],
        scripts: ['palette.js', 'palette-view.js'],
        body: `<div id="bar">
  <label>Insert as <select id="format"></select></label>
  <span id="info" class="dim">Hover a colour. Click inserts it at the cursor.</span>
</div>
<div id="grid"></div>`,
    });
    const sendFormats = () => {
        const doc = lastEditor && lastEditor.document;
        const macros = doc ? hslMacros(doc.getText()) : [];
        palettePanel.webview.postMessage({ type: 'formats', macros, preferred: vscode.workspace.getConfiguration('gametank').get('colors.format') });
    };
    palettePanel.webview.onDidReceiveMessage(async msg => {
        if (msg.type === 'ready') sendFormats();
        else if (msg.type === 'insert') {
            const editor = lastEditor;
            if (!editor || editor.document.isClosed) {
                vscode.window.showWarningMessage('GameTank palette: click into a source file first.');
                return;
            }
            await editor.edit(b => editor.selections.forEach(sel => b.replace(sel, msg.text)));
            vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
        }
    });
    const sub = vscode.window.onDidChangeActiveTextEditor(e => { if (e) { lastEditor = e; sendFormats(); } });
    palettePanel.onDidDispose(() => { sub.dispose(); palettePanel = undefined; });
}

function register(context) {
    lastEditor = vscode.window.activeTextEditor;
    context.subscriptions.push(
        vscode.languages.registerColorProvider([{ language: 'c' }, { language: 'cpp' }], colorProvider),
        vscode.commands.registerCommand('gametank.showPalette', () => showPalette(context)),
        vscode.window.onDidChangeActiveTextEditor(e => { if (e) lastEditor = e; }),
    );
}

module.exports = { register, findColors, hslMacros, nearest };
