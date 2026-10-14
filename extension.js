const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { findProjects } = require('./src/project');

function updateContext() {
    const projects = findProjects();
    vscode.commands.executeCommand('setContext', 'gametank.hasProject', projects.length > 0);
    vscode.commands.executeCommand('setContext', 'gametank.hasPreview', projects.some(p => fs.existsSync(path.join(p, '.gametank', 'preview.js'))));
}

function activate(context) {
    require('./src/tasks').register(context);
    require('./src/emulator').register(context);
    require('./src/preview').register(context);
    require('./src/colors').register(context);
    require('./src/sprites').register(context);

    updateContext();
    const watcher = vscode.workspace.createFileSystemWatcher('**/{project.json,.gametank/preview.js}');
    watcher.onDidCreate(updateContext);
    watcher.onDidDelete(updateContext);
    context.subscriptions.push(watcher, vscode.workspace.onDidChangeWorkspaceFolders(updateContext));
}

function deactivate() {}

module.exports = { activate, deactivate };
