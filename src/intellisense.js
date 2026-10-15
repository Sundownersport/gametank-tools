const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { findProjects, projectFor, includeDirs } = require('./project');

const CPPTOOLS = 'ms-vscode.cpptools';
const API_VERSION = 6;
const EXTENSION_ID = 'sundownersport.gametank-tools';

const DEFINES = [
    '__CC65__=1',
    '__GAMETANK__=1',
    '__fastcall__=',
    '__cdecl__=',
    '__near__=',
    '__far__=',
    '__A__=(*(unsigned char*)0)',
    '__AX__=(*(unsigned int*)0)',
    '__EAX__=(*(unsigned long*)0)',
];

function includePath(project) {
    return [...includeDirs(project), path.join(project, 'tools', 'cc65', 'include')].filter(p => fs.existsSync(p));
}

function configFor(project) {
    return {
        includePath: includePath(project),
        defines: DEFINES,
        intelliSenseMode: 'clang-x86',
        standard: 'c99',
        compilerPath: '',
        compilerArgs: ['-funsigned-char', '-Wno-main-return-type'],
    };
}

function provider() {
    return {
        name: 'GameTank Tools',
        extensionId: EXTENSION_ID,
        async canProvideConfiguration(uri) {
            return uri.scheme === 'file' && !!projectFor(uri.fsPath);
        },
        async provideConfigurations(uris) {
            return uris.map(uri => {
                const project = projectFor(uri.fsPath);
                return project && { uri, configuration: configFor(project) };
            }).filter(Boolean);
        },
        async canProvideBrowseConfiguration() {
            return findProjects().length > 0;
        },
        async provideBrowseConfiguration() {
            const projects = findProjects();
            return { browsePath: projects.flatMap(includePath), standard: 'c99', compilerPath: '', compilerArgs: [] };
        },
        async canProvideBrowseConfigurationsPerFolder() {
            return false;
        },
        async provideFolderBrowseConfiguration() {
            return null;
        },
        dispose() {},
    };
}

async function register(context) {
    const ext = vscode.extensions.getExtension(CPPTOOLS);
    if (!ext || findProjects().length === 0) return;
    const exports = ext.isActive ? ext.exports : await ext.activate();
    if (!exports || typeof exports.getApi !== 'function') return;
    const api = await exports.getApi(API_VERSION);
    if (!api) return;
    const p = provider();
    api.registerCustomConfigurationProvider(p);
    api.notifyReady(p);
    context.subscriptions.push(api);
}

module.exports = { register };
