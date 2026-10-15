const vscode = require('vscode');
const path = require('path');
const { spawn } = require('child_process');
const { findProjects, hasTarget } = require('./project');

const started = new vscode.EventEmitter();
const ended = new vscode.EventEmitter();

function steps(project, name) {
    if (name === 'build') return hasTarget(project, 'import') ? [['import'], []] : [[]];
    return hasTarget(project, name) ? [[name]] : null;
}

class MakeTerminal {
    constructor(project, runs) {
        this.project = project;
        this.runs = runs;
        this.writeEmitter = new vscode.EventEmitter();
        this.closeEmitter = new vscode.EventEmitter();
        this.onDidWrite = this.writeEmitter.event;
        this.onDidClose = this.closeEmitter.event;
    }

    write(text) {
        this.writeEmitter.fire(text.replace(/\r?\n/g, '\r\n'));
    }

    open() {
        started.fire(this.project);
        this.next(0);
    }

    finish(code) {
        if (this.done) return;
        this.done = true;
        this.closeEmitter.fire(code);
        ended.fire({ project: this.project, code });
    }

    next(i) {
        if (i >= this.runs.length) {
            this.finish(0);
            return;
        }
        const args = this.runs[i];
        this.write(`> make ${args.join(' ')}\n`);
        this.child = spawn('make', args, { cwd: this.project });
        this.child.stdout.on('data', d => this.write(d.toString()));
        this.child.stderr.on('data', d => this.write(d.toString()));
        this.child.on('error', e => {
            this.write(e.code === 'ENOENT' ? 'make was not found on PATH. Install make, cc65 and Node.js; see the gametank_sdk README.\n' : `${e.message}\n`);
            this.child = null;
            this.finish(1);
        });
        this.child.on('close', code => {
            this.child = null;
            if (code === 0) this.next(i + 1);
            else this.finish(code === null ? 1 : code);
        });
    }

    close() {
        if (this.child) this.child.kill();
    }

    handleInput(data) {
        if (data === '\x03' && this.child) this.child.kill();
    }
}

function folderFor(project) {
    return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project)) || vscode.TaskScope.Workspace;
}

function makeTask(project, name, definition = { type: 'gametank', task: name }) {
    const runs = steps(project, name);
    if (!runs) return undefined;
    const multi = findProjects().length > 1;
    const label = multi ? `${name} (${path.basename(project)})` : name;
    const task = new vscode.Task(
        { ...definition, project },
        folderFor(project),
        label,
        'gametank',
        new vscode.CustomExecution(async () => new MakeTerminal(project, runs)),
        name === 'build' ? ['$gametank'] : [],
    );
    if (name === 'build') task.group = vscode.TaskGroup.Build;
    if (name === 'clean') task.group = vscode.TaskGroup.Clean;
    return task;
}

const provider = {
    provideTasks() {
        return findProjects().flatMap(p => ['build', 'clean', 'prereqs'].map(n => makeTask(p, n)).filter(Boolean));
    },
    resolveTask(task) {
        const project = task.definition.project || findProjects()[0];
        return project ? makeTask(project, task.definition.task, task.definition) : undefined;
    },
};

function runBuild(project) {
    return new Promise(resolve => {
        const sub = ended.event(e => {
            if (e.project !== project) return;
            sub.dispose();
            resolve(e.code);
        });
        vscode.tasks.executeTask(makeTask(project, 'build'));
    });
}

function register(context) {
    context.subscriptions.push(vscode.tasks.registerTaskProvider('gametank', provider));
}

module.exports = { register, runBuild, onBuildStart: started.event, onBuildEnd: ended.event };
