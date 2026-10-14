const vscode = require('vscode');
const path = require('path');
const { findProjects } = require('./project');

const COMMANDS = {
    build: 'make import && make',
    clean: 'make clean',
    prereqs: 'make prereqs',
};

function folderFor(project) {
    return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project)) || vscode.TaskScope.Workspace;
}

function makeTask(project, name, definition = { type: 'gametank', task: name }) {
    const multi = findProjects().length > 1;
    const label = multi ? `${name} (${path.basename(project)})` : name;
    const task = new vscode.Task(
        { ...definition, project },
        folderFor(project),
        label,
        'gametank',
        new vscode.ShellExecution(COMMANDS[name], { cwd: project }),
        name === 'build' ? ['$gametank'] : [],
    );
    if (name === 'build') task.group = vscode.TaskGroup.Build;
    if (name === 'clean') task.group = vscode.TaskGroup.Clean;
    return task;
}

const provider = {
    provideTasks() {
        return findProjects().flatMap(p => Object.keys(COMMANDS).map(n => makeTask(p, n)));
    },
    resolveTask(task) {
        const name = task.definition.task;
        if (!COMMANDS[name]) return undefined;
        const project = task.definition.project || findProjects()[0];
        return project ? makeTask(project, name, task.definition) : undefined;
    },
};

function runBuild(project) {
    const task = makeTask(project, 'build');
    return new Promise(async resolve => {
        const execution = await vscode.tasks.executeTask(task);
        const sub = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution !== execution) return;
            sub.dispose();
            resolve(e.exitCode);
        });
    });
}

function register(context) {
    context.subscriptions.push(vscode.tasks.registerTaskProvider('gametank', provider));
}

module.exports = { register, runBuild };
