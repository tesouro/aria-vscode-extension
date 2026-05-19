"use strict";
/**
 * VS Code API stub for unit tests.
 *
 * Loaded via `node --require ./out-test/tests/vscode-mock.js` before any test
 * file runs.  It hooks into Node's module resolution so that every
 * `require('vscode')` inside the modules-under-test returns this stub instead
 * of the real extension host API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockVscode = void 0;
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
const Module = require('module');
const STUB_KEY = '__aria_vscode_test_stub__';
// ── Intercept require('vscode') resolution ───────────────────────────────────
const originalResolveFilename = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, ...rest) {
    if (request === 'vscode') {
        return STUB_KEY;
    }
    return originalResolveFilename(request, ...rest);
};
// ── Fake implementations ──────────────────────────────────────────────────────
class FakeEventEmitter {
    _ls = [];
    event = (fn) => {
        this._ls.push(fn);
        return {
            dispose: () => {
                const i = this._ls.indexOf(fn);
                if (i >= 0) {
                    this._ls.splice(i, 1);
                }
            },
        };
    };
    fire(e) { for (const f of this._ls) {
        f(e);
    } }
    dispose() { this._ls.length = 0; }
}
class FakeTreeItem {
    label;
    description;
    tooltip;
    contextValue;
    iconPath;
    command;
    collapsibleState;
    constructor(label, collapsibleState) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}
class FakeUri {
    scheme;
    fsPath;
    constructor(scheme, fsPath) {
        this.scheme = scheme;
        this.fsPath = fsPath;
    }
    static file(p) { return new FakeUri('file', p); }
    static parse(v) { return new FakeUri('file', v); }
    toString() { return `${this.scheme}://${this.fsPath}`; }
}
class FakeThemeIcon {
    id;
    constructor(id) {
        this.id = id;
    }
}
class FakeLMToolResult {
    parts;
    constructor(parts) {
        this.parts = parts;
    }
}
class FakeLMTextPart {
    value;
    constructor(value) {
        this.value = value;
    }
}
// ── Mock export object ────────────────────────────────────────────────────────
exports.mockVscode = {
    TreeItem: FakeTreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter: FakeEventEmitter,
    Uri: FakeUri,
    ThemeIcon: FakeThemeIcon,
    LanguageModelToolResult: FakeLMToolResult,
    LanguageModelTextPart: FakeLMTextPart,
    window: {
        showWarningMessage: (..._args) => Promise.resolve(undefined),
        showErrorMessage: (..._args) => Promise.resolve(undefined),
        showInformationMessage: (..._args) => Promise.resolve(undefined),
    },
    workspace: {
        getConfiguration: (_section) => ({
            get: (_key, defaultValue) => defaultValue,
        }),
    },
    authentication: {
        getSession: (_providerId, _scopes, _options) => Promise.resolve(undefined),
    },
    commands: {
        executeCommand: (_command, ..._args) => Promise.resolve(undefined),
    },
    lm: {
        registerTool: (_name, _tool) => ({ dispose: () => { } }),
    },
};
// ── Register stub in require cache ────────────────────────────────────────────
require.cache[STUB_KEY] = {
    id: STUB_KEY,
    filename: STUB_KEY,
    loaded: true,
    exports: exports.mockVscode,
    children: [],
    path: '',
    paths: [],
    parent: undefined,
};
