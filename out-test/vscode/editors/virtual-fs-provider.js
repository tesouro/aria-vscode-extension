"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryEditFileSystemProvider = void 0;
const vscode = require("vscode");
class InMemoryEditFileSystemProvider {
    files = new Map();
    onDidChangeFileEmitter = new vscode.EventEmitter();
    onDidChangeFile = this.onDidChangeFileEmitter.event;
    watch() { return new vscode.Disposable(() => { }); }
    stat(uri) {
        const data = this.files.get(uri.toString());
        if (!data) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: data.byteLength };
    }
    readFile(uri) {
        const data = this.files.get(uri.toString());
        if (!data) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return data;
    }
    writeFile(uri, content) {
        this.files.set(uri.toString(), content);
        this.onDidChangeFileEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }
    delete(uri) {
        this.files.delete(uri.toString());
        this.onDidChangeFileEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }
    readDirectory() { return []; }
    createDirectory() { }
    rename() { }
    hasFile(uri) {
        return this.files.has(uri.toString());
    }
    getContent(uri) {
        const data = this.files.get(uri.toString());
        if (!data) {
            return undefined;
        }
        return Buffer.from(data).toString('utf8');
    }
    setContent(uri, text) {
        this.writeFile(uri, Buffer.from(text, 'utf8'));
    }
}
exports.InMemoryEditFileSystemProvider = InMemoryEditFileSystemProvider;
