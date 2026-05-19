/**
 * VS Code API stub for unit tests.
 *
 * Loaded via `node --require ./out-test/tests/vscode-mock.js` before any test
 * file runs.  It hooks into Node's module resolution so that every
 * `require('vscode')` inside the modules-under-test returns this stub instead
 * of the real extension host API.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */

const Module = require('module') as any;

const STUB_KEY = '__aria_vscode_test_stub__';

// ── Intercept require('vscode') resolution ───────────────────────────────────

const originalResolveFilename = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === 'vscode') { return STUB_KEY; }
  return originalResolveFilename(request, ...rest);
};

// ── Fake implementations ──────────────────────────────────────────────────────

class FakeEventEmitter<T = unknown> {
  private readonly _ls: Array<(e: T) => void> = [];
  readonly event = (fn: (e: T) => void): { dispose(): void } => {
    this._ls.push(fn);
    return {
      dispose: () => {
        const i = this._ls.indexOf(fn);
        if (i >= 0) { this._ls.splice(i, 1); }
      },
    };
  };
  fire(e: T): void { for (const f of this._ls) { f(e); } }
  dispose(): void { this._ls.length = 0; }
}

class FakeTreeItem {
  description?: string;
  tooltip?: string;
  contextValue?: string;
  iconPath?: unknown;
  command?: unknown;
  collapsibleState?: number;
  constructor(public label: string, collapsibleState?: number) {
    this.collapsibleState = collapsibleState;
  }
}

class FakeUri {
  readonly scheme: string;
  readonly fsPath: string;
  private constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = fsPath;
  }
  static file(p: string) { return new FakeUri('file', p); }
  static parse(v: string) { return new FakeUri('file', v); }
  toString() { return `${this.scheme}://${this.fsPath}`; }
}

class FakeThemeIcon { constructor(public readonly id: string) {} }
class FakeLMToolResult { constructor(public parts: unknown[]) {} }
class FakeLMTextPart { constructor(public value: string) {} }

// ── Mock export object ────────────────────────────────────────────────────────

export const mockVscode = {
  TreeItem: FakeTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: FakeEventEmitter,
  Uri: FakeUri,
  ThemeIcon: FakeThemeIcon,
  LanguageModelToolResult: FakeLMToolResult,
  LanguageModelTextPart: FakeLMTextPart,
  window: {
    showWarningMessage: (..._args: unknown[]) => Promise.resolve(undefined as unknown),
    showErrorMessage: (..._args: unknown[]) => Promise.resolve(undefined as unknown),
    showInformationMessage: (..._args: unknown[]) => Promise.resolve(undefined as unknown),
  },
  workspace: {
    getConfiguration: (_section?: string) => ({
      get: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
    }),
  },
  authentication: {
    getSession: (_providerId: string, _scopes: string[], _options?: unknown) =>
      Promise.resolve(undefined as unknown),
  },
  commands: {
    executeCommand: (_command: string, ..._args: unknown[]) => Promise.resolve(undefined),
  },
  lm: {
    registerTool: (_name: string, _tool: unknown) => ({ dispose: () => {} }),
  },
};

// ── Register stub in require cache ────────────────────────────────────────────

(require as any).cache[STUB_KEY] = {
  id: STUB_KEY,
  filename: STUB_KEY,
  loaded: true,
  exports: mockVscode,
  children: [],
  path: '',
  paths: [],
  parent: undefined,
};
